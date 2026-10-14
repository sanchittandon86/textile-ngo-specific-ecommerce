# Textile Store Backend

Node.js / Express.js / PostgreSQL backend for the textile store. Includes
public catalog APIs (categories, products), a server-side **guest cart**,
**guest checkout / order retrieval**, and **Razorpay payment integration**
(the only supported payment method — no COD) that let customers shop and
pay without creating an account. See
[docs/checkout-api.md](docs/checkout-api.md) for checkout/order endpoints
and [docs/payments-api.md](docs/payments-api.md) for the Razorpay payment
flow — this file covers environment setup, the catalog APIs, and the
guest cart.

## Environment variables

Configured in `.env` (not committed, values below are placeholders):

```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=textile_store
DB_USER=<your-db-user>
DB_PASSWORD=<your-db-password>
```

## Running the backend

```bash
npm install
npm run dev     # nodemon, auto-restarts on changes
# or
npm start       # plain node
```

Server listens at `http://localhost:3000`.

## Running tests

```bash
npm test
```

Tests mock the PostgreSQL pool (`src/config/db.js`) with Jest, so they run
without a live database and never touch real data.

## Database migration (guest cart tables)

The guest cart feature requires two new tables: `carts` and `cart_items`.
The migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF
NOT EXISTS`) and never drops or truncates data.

Run it with `psql` against the existing `textile_store` database:

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/001_create_guest_cart.sql
```

Verify the tables were created:

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d carts"
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d cart_items"
```

A second migration, `migrations/002_create_guest_checkout.sql`, adds the
`orders`/`order_items` tables for guest checkout. See
[docs/checkout-api.md](docs/checkout-api.md) for its command, verification
steps, and the checkout/order endpoints themselves.

A third migration, `migrations/003_create_razorpay_payments.sql`, adds the
`payments`/`payment_webhook_events` tables and tightens two `orders`
constraints for Razorpay integration. See
[docs/payments-api.md](docs/payments-api.md) for its command,
verification steps, required `RAZORPAY_*` environment variables, and the
payment endpoints themselves.

**Running the migration file does not happen automatically** — it must be
applied manually (or via your deployment's migration step) before the cart
endpoints will work, since they query tables that don't exist until this
script runs.

## Guest cart architecture

- A guest cart is identified by a random 256-bit token (`crypto.randomBytes(32)`,
  hex-encoded to 64 characters), generated when `POST /api/cart` is called.
- The raw token is returned to the client **only once**, in the create-cart
  response. The browser is responsible for persisting it (e.g.
  `localStorage`) and sending it on every subsequent cart request as the
  `X-Cart-Token` header.
- The server never stores or logs the raw token. Only its SHA-256 hash is
  stored, in `carts.token_hash`. Anyone reading the database cannot
  reconstruct a usable token.
- Each cart expires 30 days after creation (`carts.expires_at`). An expired
  or unknown token is rejected with `401 Unauthorized`; the client must then
  create a new cart.
- Adding an item to the cart does **not** reserve or deduct inventory. Stock
  is only checked (not decremented) when items are added/updated, and is
  re-validated again at checkout (checkout is out of scope here).

### Security considerations

- Tokens are generated with a cryptographically secure RNG and have 256
  bits of entropy — not guessable.
- Token format is validated (64 lowercase/uppercase hex characters) before
  any database query runs, rejecting malformed input cheaply with `401`.
- All SQL uses parameterized queries; no string-interpolated user input
  reaches SQL. The only non-parameterized SQL fragment is the sort-column
  allowlist in the products route (pre-existing) and the fixed `INTERVAL
  '30 days'` literal in the cart migration/insert, neither of which is
  user-controlled.
- Error responses never include stack traces, SQL text, or credentials.
- Prices and totals are always computed by PostgreSQL from the current
  `products.price` value inside the same query/transaction — the client
  cannot influence pricing by sending a price in the request body (no price
  field is ever accepted from the client).

### Cart expiration / cleanup

Expired carts are left in the table (so reads correctly 401 on them) but
should be periodically purged. Because `cart_items.cart_id` has
`ON DELETE CASCADE`, deleting a cart automatically deletes its items — no
extra cleanup statement is needed for items.

No background worker or scheduler dependency was added to the app itself
(none was required). Instead, run this SQL on a schedule using whatever the
deployment environment already provides, for example:

- A `cron` job on the host running `psql -c "DELETE FROM carts WHERE expires_at < NOW();"`
- A managed Postgres provider's scheduled SQL/job feature
- `pg_cron` if the extension is available on the database

Example cron entry (daily at 3am):

```
0 3 * * * psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "DELETE FROM carts WHERE expires_at < NOW();"
```

## API reference

All responses use the shape:

```json
{ "success": true, "data": { } }
```

or on failure:

```json
{ "success": false, "message": "Human-readable error message" }
```

### Existing public APIs (unchanged)

- `GET /api/health`
- `GET /api/categories`
- `GET /api/products`
- `GET /api/products/search?q=...`
- `GET /api/products/:slug`

### Guest cart APIs

All cart-item endpoints (everything except `POST /api/cart`) require the
header:

```
X-Cart-Token: <64-character hex token returned by POST /api/cart>
```

#### Create cart — `POST /api/cart`

No token required/sent.

Request: no body.

Response `201`:

```json
{
  "success": true,
  "data": {
    "cartToken": "b7e0a1...64 hex chars",
    "expiresAt": "2026-11-12T10:00:00.000Z"
  }
}
```

#### Get cart — `GET /api/cart`

Headers: `X-Cart-Token: <token>`

Response `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "productId": 5,
        "name": "Cotton Bedsheet",
        "slug": "cotton-bedsheet",
        "imageUrl": "https://.../image.jpg",
        "unitPrice": "1499.00",
        "quantity": 2,
        "lineTotal": "2998.00",
        "availableStock": 10,
        "isPublished": true,
        "isAvailable": true
      }
    ],
    "total": "2998.00"
  }
}
```

`total` only sums items that are published and have sufficient stock
(`isAvailable: true`); it is computed by PostgreSQL, not JavaScript.

#### Add item — `POST /api/cart/items`

Headers: `X-Cart-Token: <token>`

Request:

```json
{ "productId": 5, "quantity": 2 }
```

Response `200`: updated cart, same shape as `GET /api/cart`.

Errors:
- `400` invalid `productId`/`quantity`
- `404` product does not exist or is unpublished
- `409` resulting quantity (existing + requested) exceeds stock

#### Update item quantity — `PATCH /api/cart/items/:productId`

Headers: `X-Cart-Token: <token>`

Request:

```json
{ "quantity": 3 }
```

Response `200`: updated cart.

Errors:
- `400` invalid `productId`/`quantity`
- `404` item not in cart, or product no longer exists/published
- `409` requested quantity exceeds stock

#### Remove item — `DELETE /api/cart/items/:productId`

Headers: `X-Cart-Token: <token>`

Response `200`: updated cart.
Errors: `404` if the item is not in the cart.

#### Empty cart — `DELETE /api/cart`

Headers: `X-Cart-Token: <token>`

Response `200`:

```json
{ "success": true, "data": { "items": [], "total": "0.00" } }
```

### Status codes used across the cart API

| Code | Meaning |
|------|---------|
| 200  | successful read/update/delete |
| 201  | cart created |
| 400  | invalid request body/params (bad JSON, bad productId/quantity) |
| 401  | missing, malformed, unknown, or expired cart token |
| 404  | product or cart item not found |
| 409  | requested quantity exceeds available stock |
| 500  | unexpected server/database error |

## Postman examples

1. **Create cart**
   `POST http://localhost:3000/api/cart` — no body. Copy `data.cartToken`
   from the response into a Postman variable, e.g. `{{cartToken}}`.

2. **Get cart**
   `GET http://localhost:3000/api/cart`
   Header: `X-Cart-Token: {{cartToken}}`

3. **Add item**
   `POST http://localhost:3000/api/cart/items`
   Header: `X-Cart-Token: {{cartToken}}`
   Body (JSON): `{ "productId": 1, "quantity": 2 }`

4. **Update quantity**
   `PATCH http://localhost:3000/api/cart/items/1`
   Header: `X-Cart-Token: {{cartToken}}`
   Body (JSON): `{ "quantity": 5 }`

5. **Remove item**
   `DELETE http://localhost:3000/api/cart/items/1`
   Header: `X-Cart-Token: {{cartToken}}`

6. **Empty cart**
   `DELETE http://localhost:3000/api/cart`
   Header: `X-Cart-Token: {{cartToken}}`

## Browser integration notes

- After calling `POST /api/cart`, store `data.cartToken` in `localStorage`
  (survives browser restarts) rather than a session-only store, so the cart
  persists "across browser sessions" as required.
- Send it as `X-Cart-Token` on every subsequent cart request.
- If any cart request returns `401`, treat the stored token as dead: discard
  it, call `POST /api/cart` again, and store the new token.
