# Guest Checkout API

Guest checkout lets a customer turn their guest cart (see the main
[README](../README.md) for cart docs) into an order without creating an
account. It builds on the existing `X-Cart-Token` guest cart and adds a
second, independent guest **order** access token.

## Migration

Applies two new tables: `orders`, `order_items`. Idempotent
(`CREATE TABLE IF NOT EXISTS`), never drops or truncates data.

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/002_create_guest_checkout.sql
```

Verify:

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d orders"
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d order_items"
```

This must be run (once) against your database before the checkout
endpoints will work — they query tables that don't exist until this
migration is applied. `001_create_guest_cart.sql` must already have been
applied first, since `orders`/`order_items` build on top of the cart
schema's concepts and `order_items.product_id` references `products(id)`
the same way `cart_items` does.

### Schema decisions made explicit

- **`order_items.product_id` is nullable with `ON DELETE SET NULL`.** A
  product can be deleted from the catalog later without being blocked by
  old orders, and without destroying order history. `product_name`,
  `product_slug`, and `unit_price` are snapshotted onto `order_items` at
  checkout time specifically so the historical record stays intact even if
  the product row changes or disappears.
- **`orders.order_number`** is a public, human-shareable reference
  (`ORD-YYYYMMDD-<10 hex chars>`, ~40 bits of randomness in the suffix). It
  is intentionally *not* the security boundary — see the next section.
- Two defense-in-depth `CHECK` constraints guard the money columns:
  `orders.total_amount = subtotal + shipping_fee - discount_amount` and
  `order_items.line_total = unit_price * quantity`. These make it
  impossible for a future code bug to silently persist an inconsistent
  total.

## Guest order access token

- At order creation, the server generates a second, independent 256-bit
  random token (`crypto.randomBytes(32)`, hex-encoded), separate from the
  cart token. Only its SHA-256 hash is stored, in `orders.order_token_hash`.
- The raw order token is returned **once**, in the `POST /api/checkout`
  response. The client must store it (e.g. `localStorage`, keyed by order
  number) to retrieve the order later — there is no other way to get it
  back, and it is never logged.
- **Order lookup requires both the order number and the token together**
  (`WHERE order_number = $1 AND order_token_hash = $2`). Neither the
  order number nor the database id is ever, by itself, sufficient to read
  an order — this is deliberate, so order numbers (which look sequential
  per day) can't be enumerated to read other customers' orders.
- An unknown order number and a valid order number with the wrong token
  both return the same generic `404 Order not found` — the response never
  reveals which case occurred.

## Endpoints

All responses use `{ "success": true, "data": {...} }` or
`{ "success": false, "message": "..." }`, consistent with the rest of the
API.

### `GET /api/checkout/summary`

Headers: `X-Cart-Token: <cart token>`

Preview-only. Returns current server-side prices and an **estimated**
total. Checkout itself re-fetches everything from the database and
revalidates stock — nothing here is trusted at order-creation time.

Response `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "productId": 1,
        "name": "Floral Cotton Bedsheet",
        "slug": "floral-cotton-bedsheet",
        "imageUrl": null,
        "unitPrice": "1499.00",
        "quantity": 2,
        "lineTotal": "2998.00",
        "availableStock": 20,
        "isPublished": true,
        "isAvailable": true
      }
    ],
    "subtotal": "2998.00",
    "shippingFee": "50.00",
    "estimatedTotal": "3048.00",
    "currency": "INR"
  }
}
```

### `POST /api/checkout`

Headers: `X-Cart-Token: <cart token>`

Request:

```json
{
  "customer": {
    "name": "Test Customer",
    "email": "customer@example.com",
    "phone": "9876543210"
  },
  "shippingAddress": {
    "line1": "123 Example Road",
    "line2": "Near Main Market",
    "city": "Mumbai",
    "state": "Maharashtra",
    "postalCode": "400001",
    "country": "India"
  },
  "paymentMethod": "online"
}
```

Field notes:
- `customer.email` is optional; `customer.name` and `customer.phone` are
  required. Phone must be 10–15 digits.
- `shippingAddress.line2` is optional; all other address fields are
  required. `country` defaults to `"India"` if omitted.
- **`paymentMethod` must be `"online"`.** Razorpay is the only supported
  payment method — there is no COD. `"cod"` (and anything else) is
  rejected with `400`. See
  [docs/payments-api.md](payments-api.md) for the Razorpay flow that
  follows checkout.
- Any price, total, or item data the client includes in the body besides
  the three fields above is **ignored** — everything monetary is
  recomputed from the cart and the database.

Response `201`:

```json
{
  "success": true,
  "data": {
    "orderNumber": "ORD-20261013-F0595B0FA8",
    "orderToken": "<64-char hex token, shown only here>",
    "status": "pending_payment",
    "paymentStatus": "pending",
    "paymentMethod": "online",
    "items": [
      {
        "productId": 1,
        "name": "Floral Cotton Bedsheet",
        "slug": "floral-cotton-bedsheet",
        "unitPrice": "1499.00",
        "quantity": 2,
        "lineTotal": "2998.00"
      }
    ],
    "subtotal": "2998.00",
    "shippingFee": "50.00",
    "discountAmount": "0.00",
    "totalAmount": "3048.00",
    "currency": "INR",
    "createdAt": "2026-10-13T10:25:58.957Z"
  }
}
```

`status` always starts as `"pending_payment"`. `paymentStatus` always
starts as `"pending"` — **order creation never implies payment has been
collected or confirmed.** The order only becomes payable once Razorpay is
involved — see [docs/payments-api.md](payments-api.md).

What happens inside the transaction, in order:
1. `DELETE FROM cart_items WHERE cart_id = $1 RETURNING ...` — atomically
   consumes the cart. If 0 rows come back, the cart was empty → `400`, no
   order is created.
2. The affected products are locked with `SELECT ... FOR UPDATE`, in
   ascending `id` order (prevents deadlocks between concurrent checkouts
   touching overlapping products). This is a read/validation lock only —
   see the note below on why stock is *not* decremented here.
3. Each item is checked against the locked, live row: must still exist and
   be published (else `404`) and have enough stock for the cart's quantity
   (else `409`).
4. Subtotal, total, and all line totals are computed with Postgres numeric
   SQL (`UNNEST`-based batch queries) — never JavaScript floating-point math.
5. The order and its items are inserted and the transaction commits.
   **Stock is intentionally not touched here** — see
   [docs/payments-api.md](payments-api.md#inventory-and-stock-decrement-policy)
   for exactly when and how it's decremented.

If any step fails, the whole transaction rolls back — **and because the
cart was consumed with `DELETE ... RETURNING` inside that same
transaction, a rollback also restores the cart's items exactly as they
were.** A failed checkout never leaves the customer's cart empty.

Errors:
- `400` — invalid customer/address/payment method, or empty cart
- `401` — missing/malformed/unknown/expired cart token
- `404` — a cart item's product no longer exists or is unpublished
- `409` — a cart item's quantity exceeds current stock
- `500` — unexpected database error (transaction rolled back)

### `GET /api/orders/:orderNumber`

Headers: `X-Order-Token: <order token from the checkout response>`

Response `200`:

```json
{
  "success": true,
  "data": {
    "orderNumber": "ORD-20261013-F0595B0FA8",
    "status": "pending_payment",
    "paymentStatus": "pending",
    "paymentMethod": "online",
    "customer": {
      "name": "Test Customer",
      "email": "customer@example.com",
      "phone": "9876543210"
    },
    "shippingAddress": {
      "line1": "123 Example Road",
      "line2": "Near Main Market",
      "city": "Mumbai",
      "state": "Maharashtra",
      "postalCode": "400001",
      "country": "India"
    },
    "items": [
      {
        "productId": 1,
        "name": "Floral Cotton Bedsheet",
        "slug": "floral-cotton-bedsheet",
        "unitPrice": "1499.00",
        "quantity": 2,
        "lineTotal": "2998.00"
      }
    ],
    "subtotal": "2998.00",
    "shippingFee": "50.00",
    "discountAmount": "0.00",
    "totalAmount": "3048.00",
    "currency": "INR",
    "createdAt": "2026-10-13T10:25:58.957Z"
  }
}
```

Errors:
- `400` — order number doesn't match the expected format
- `401` — missing or malformed `X-Order-Token`
- `404` — order number unknown, or token doesn't match (same generic
  message either way)
- `500` — unexpected database error

`order_token_hash` and every other internal-only column are never included
in any response.

## Inventory behavior

**Stock is no longer decremented at checkout time.** This changed when
Razorpay payment integration was added (see
[docs/payments-api.md](payments-api.md) for the full design). Checkout
only *validates* that enough stock currently exists; the actual decrement
happens exactly once, at the point a Razorpay payment is confirmed
(`POST /api/payments/verify` or the Razorpay webhook). This avoids
permanently consuming stock for an order the customer never actually pays
for — which checkout alone cannot know, since Razorpay is the only
payment method and checkout happens before payment.

- **Never trust a client redirect as proof of payment.** Nothing in this
  codebase sets `payment_status = 'paid'` from a client call; there is no
  endpoint that allows a client to mark an order paid.
- Concurrent checkouts for the same product are serialized by
  `SELECT ... FOR UPDATE` on the product row, so two simultaneous
  checkouts can never oversell the same unit of stock — the second
  transaction blocks until the first commits/rolls back, then re-reads the
  now-current `stock_quantity`.
- Concurrent checkouts for the *same cart* (e.g. a double-click on "place
  order") are handled by the `DELETE FROM cart_items ... RETURNING`
  pattern described above: only one of the two requests can ever see
  non-empty rows to act on.

## Postman examples

1. **Checkout summary**
   `GET http://localhost:3000/api/checkout/summary`
   Header: `X-Cart-Token: {{cartToken}}`

2. **Create order**
   `POST http://localhost:3000/api/checkout`
   Header: `X-Cart-Token: {{cartToken}}`
   Body: see the request example above (`"paymentMethod": "online"` —
   the only accepted value).
   Save `data.orderNumber` and `data.orderToken` from the response, then
   continue with Razorpay payment — see
   [docs/payments-api.md](payments-api.md).

3. **Get order**
   `GET http://localhost:3000/api/orders/{{orderNumber}}`
   Header: `X-Order-Token: {{orderToken}}`

## Testing

```bash
npm test
```

Checkout/order tests live in `tests/checkout.test.js` and mock the shared
Postgres pool (`src/config/db.js`), so they run without a live database.
They cover: successful checkout (Razorpay/`online`), rejection of `cod`
and any other payment method, empty cart, missing/malformed cart token,
invalid customer/address data, out-of-stock rejection (409, no order/stock
mutation), deleted/unpublished product (404), a tampered client-supplied
price/total being ignored, database-failure rollback, successful order
retrieval, missing/wrong order token, and malformed order number.

In addition to the mocked suite, this implementation was manually
exercised end-to-end against a real local Postgres database (migration
applied, server started with `npm run dev`, full HTTP flow driven with
`curl`): cart creation → add item → checkout summary → checkout → order
retrieval with correct/wrong/missing token → out-of-stock rejection at
checkout time with cart-restore-on-rollback verified → unpublished-product
rejection at checkout time → existing public APIs re-confirmed working
throughout. All test data created during that manual pass was deleted
afterward and the one real product's `stock_quantity`/`is_published` were
restored to their original values. See
[docs/payments-api.md](payments-api.md) for the equivalent live
verification of the Razorpay payment flow, done after that flow was
added.

**Not run:** a dedicated automated integration suite against a real test
database, and a true concurrent-load test (e.g. firing N simultaneous
checkout requests at once) — the row-locking design was verified by
simulating the race by hand (lowering stock mid-cart-build, then
checking out) rather than with real parallel requests.

## How to run the backend

```bash
npm install
npm run dev     # http://localhost:3000, nodemon
```

## Known limitations

- Payment gateway integration (Razorpay) now exists — see
  [docs/payments-api.md](payments-api.md) for its endpoints, flow, and its
  own set of documented limitations (e.g. no reservation/TTL on stock
  between checkout and payment, no automatic refunds).
- No admin endpoints to transition `orders.status`
  (`processing` → `shipped` → `delivered`) or to cancel an order — out of
  scope per the task.
- No discount-code system; `discount_amount` is always `0.00`, the column
  exists for future use.
- Shipping fee is a single flat constant (`₹50.00`); no per-weight/
  per-region/free-shipping-threshold logic.
- No automated test was run against a real Postgres instance under actual
  concurrent load; the locking strategy is standard and was exercised
  manually (see above) but not load-tested.
