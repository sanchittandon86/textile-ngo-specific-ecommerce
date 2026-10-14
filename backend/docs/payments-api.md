# Razorpay Payment API

Razorpay is the **only** supported payment method for guest checkout —
there is no cash-on-delivery or other alternative. This builds on the
guest cart (see the main [README](../README.md)) and guest checkout/order
APIs (see [docs/checkout-api.md](checkout-api.md)); read those first if
you haven't. Shipping is handled manually by the admin and is out of
scope here.

## Conflicts this introduced with the existing checkout design

These were resolved deliberately, not accidentally — documented here so
the reasoning is visible later:

1. **COD removed.** `checkout.service.js` previously accepted `"cod"` and
   `"online"` as payment methods. It now only accepts `"online"`; `"cod"`
   is rejected with `400`. The `orders.payment_method` database
   `CHECK` constraint was tightened to match (migration 003) — a
   constraint change only, no data was touched.
2. **Stock decrement moved from checkout-time to payment-confirmation-time.**
   Previously, checkout decremented stock immediately for every order,
   including `online` ones, with a documented limitation that an abandoned
   online order permanently consumed stock. With Razorpay as the *only*
   path now, that would make abandoned-payment stock loss the common case,
   not a rare edge case — unacceptable. Checkout now only validates stock
   is currently sufficient; the actual decrement happens once, atomically,
   when a payment is confirmed (`/verify` or the webhook). See
   [Inventory and stock-decrement policy](#inventory-and-stock-decrement-policy)
   below for the residual risk this still carries and why it's an
   acceptable, explicitly-documented tradeoff rather than a bug.

## Environment variables

Add these three to `.env` (see `.env.example` for the placeholder names —
never commit real values):

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from the Razorpay Dashboard
  → Settings → API Keys. `KEY_ID` is also returned to the frontend (it's
  public by design, needed to open Razorpay Checkout); `KEY_SECRET` is
  never sent to the client and only read server-side.
- `RAZORPAY_WEBHOOK_SECRET` — from the Razorpay Dashboard → Settings →
  Webhooks, when you create the webhook pointed at
  `POST /api/payments/webhook` (see [Webhook configuration](#webhook-configuration)
  below). This is a **separate secret from `KEY_SECRET`** — the code
  never uses `KEY_SECRET` to verify webhooks, and vice versa.

If these aren't set, the server still starts normally and every other
route (health/categories/products/cart/checkout, and `/verify`/`/webhook`
themselves, which don't call the Razorpay API) keeps working. Only
`POST /api/payments/create-order` will fail — with a clean `500`, not a
crash — because it's the one call that actually needs to reach Razorpay's
API. (Earlier in development, constructing the Razorpay SDK client eagerly
at module-load time caused a missing `RAZORPAY_KEY_ID` to crash the entire
app on startup, breaking every unrelated route. `src/config/razorpay.js`
now constructs it lazily, on first use, specifically to avoid that.)

## Migration

Adds `payments` and `payment_webhook_events`, and tightens two existing
`orders` constraints (payment method, and one new status value). Never
drops/truncates data; running it twice is a no-op.

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/003_create_razorpay_payments.sql
```

Verify:

```bash
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d payments"
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d payment_webhook_events"
psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d orders"
```

Must run after `001_create_guest_cart.sql` and
`002_create_guest_checkout.sql`.

### Schema decisions made explicit

- **`payments.razorpay_order_id` is nullable.** Creating a payment attempt
  is split into two steps — see
  [Why create-order is two steps](#why-create-order-is-two-steps) — and
  the row exists (reserving its slot) before Razorpay has returned an
  order id.
- **`uq_payments_order_active`**: a partial unique index on
  `payments(order_id) WHERE status = 'created'`. At most one *active*
  (non-terminal) payment attempt can exist per order at a time. This is
  the single synchronization point that prevents two concurrent
  `create-order` calls for the same order from both proceeding to call
  Razorpay. A `failed` attempt frees the slot so the customer can retry.
- **`payment_webhook_events`** stores every processed Razorpay event id.
  Its own unique constraint on `razorpay_event_id` is the entire duplicate-
  delivery defense: a retried webhook delivery hits a unique-violation on
  insert and is acknowledged without being reprocessed.
- **New order status: `paid_fulfillment_blocked`.** See
  [Inventory and stock-decrement policy](#inventory-and-stock-decrement-policy).
- `payments.status` is intentionally a 3-value enum
  (`created` / `captured` / `failed`), not a mirror of every Razorpay
  payment/order status. Razorpay's own richer status machine is reduced
  to the three states this codebase actually acts on, to avoid building
  unused state-handling for statuses (e.g. `authorized` under manual
  capture settings) this integration doesn't use.

## Why create-order is two steps

`POST /api/payments/create-order` deliberately never holds a database
transaction open while calling the Razorpay API:

1. **Reserve a slot**: `INSERT INTO payments (order_id, ...) VALUES (...,'created')`.
   The partial unique index makes this the serialization point for
   concurrent requests — no transaction needed, one statement is already
   atomic.
2. **Call Razorpay** (`razorpay.orders.create(...)`), with no open
   transaction or lock held.
3. **Record the result**: `UPDATE payments SET razorpay_order_id = ..., amount = ... WHERE id = ...`.

If step 2 throws (bad credentials, network failure, Razorpay downtime),
the reserved row is immediately marked `failed` so the unique-index slot
is freed and the customer can retry — verified live (see
[Testing](#testing) below): a `create-order` call against fake Razorpay
credentials failed cleanly with a `500`, left the attempt `failed`, and a
second `create-order` call for the same order successfully created a new
attempt row rather than being blocked.

If a request is retried while an attempt is still mid-flight (`status =
'created'` but `razorpay_order_id` still `NULL`), the retry gets a `409`
asking it to try again shortly, rather than racing a second Razorpay API
call for the same order.

## Endpoints

All responses use `{ "success": true, "data": {...} }` or
`{ "success": false, "message": "..." }`.

### `POST /api/payments/create-order`

Headers: `X-Order-Token: <order token from checkout>`

Request:

```json
{ "orderNumber": "ORD-20261013-F0595B0FA8" }
```

The amount is **never** taken from the request — it's always
`orders.total_amount`, read fresh from the database and converted to
paise with a Postgres `ROUND(total_amount * 100)` (a fixed unit
conversion for Razorpay's API contract, not a monetary calculation, so
this one case computes it this way rather than via an extra SQL round
trip).

Response `201`:

```json
{
  "success": true,
  "data": {
    "razorpayOrderId": "order_XXXXXXXXXXXXXX",
    "amount": "3048.00",
    "currency": "INR",
    "keyId": "rzp_test_xxxxxxxxxxxxxx",
    "orderNumber": "ORD-20261013-F0595B0FA8"
  }
}
```

`keyId` is the public `RAZORPAY_KEY_ID` — safe to send to the frontend,
needed to open Razorpay Checkout. `KEY_SECRET` is never returned.

If an attempt for this order is already in flight (`status = 'created'`
with a `razorpay_order_id` already set), calling this again returns the
**same** `razorpayOrderId`/`amount` instead of creating a second Razorpay
order — this is what makes retried/duplicate clicks safe.

Errors:
- `400` — order number doesn't match the expected format
- `401` — missing/malformed `X-Order-Token`
- `404` — order number unknown, or token doesn't match (generic, same as
  `GET /api/orders/:orderNumber`)
- `409` — order already paid, order not in `pending_payment`/`pending`
  state, or an attempt is already being created (retry shortly)
- `500` — the Razorpay API call itself failed (credentials, network,
  Razorpay downtime) — the attempt is marked `failed` so retrying is safe

### `POST /api/payments/verify`

Headers: `X-Order-Token: <order token from checkout>`

Called by the frontend after Razorpay Checkout's success callback. **This
callback is never trusted by itself** — the signature is independently
recomputed server-side.

Request:

```json
{
  "orderNumber": "ORD-20261013-F0595B0FA8",
  "razorpayOrderId": "order_XXXXXXXXXXXXXX",
  "razorpayPaymentId": "pay_XXXXXXXXXXXXXX",
  "razorpaySignature": "<hex signature from Razorpay Checkout>"
}
```

Verification, in order:
1. Format-validate all three Razorpay fields.
2. Resolve the order via the guest order-access token (same mechanism as
   `GET /api/orders/:orderNumber`).
3. Look up the stored payment attempt by `(order_id, razorpayOrderId)` —
   **this is the "confirm the Razorpay order ID belongs to the expected
   store order" check.** No match → `400`.
4. If already `captured` → return success immediately, unchanged
   (`alreadyProcessed: true`) — this is what makes repeated verify calls
   safe.
5. If already `failed` → `409`.
6. Recompute `hmac_sha256(razorpayOrderId + "|" + razorpayPaymentId, RAZORPAY_KEY_SECRET)`
   (Razorpay's documented formula) and compare to the supplied signature
   with `crypto.timingSafeEqual`. Mismatch → mark the attempt `failed`,
   return `400`.
7. On a valid signature: capture the payment (see
   [Capture: shared by `/verify` and the webhook](#capture-shared-by-verify-and-the-webhook)).

Response `200` (capture):

```json
{
  "success": true,
  "data": {
    "orderNumber": "ORD-20261013-F0595B0FA8",
    "status": "processing",
    "paymentStatus": "paid",
    "alreadyProcessed": false
  }
}
```

`status` is `"paid_fulfillment_blocked"` instead of `"processing"` in the
rare oversold case — see
[Inventory and stock-decrement policy](#inventory-and-stock-decrement-policy).

Errors:
- `400` — invalid/missing fields, Razorpay order ID doesn't match this
  order, or invalid signature
- `401`/`404` — guest order-access failure (same as checkout/order APIs)
- `409` — this payment attempt already failed
- `500` — unexpected database error (transaction rolled back)

### `POST /api/payments/webhook`

No guest auth header — this is a server-to-server call from Razorpay,
authenticated entirely by its signature.

Configure in the Razorpay Dashboard to send at least `payment.captured`
and `payment.failed`. Verification:

1. `X-Razorpay-Signature` is required.
2. Signature = `hmac_sha256(raw_request_body, RAZORPAY_WEBHOOK_SECRET)`
   (Razorpay's documented webhook formula — **note this uses the webhook
   secret, never `RAZORPAY_KEY_SECRET`**), compared with
   `crypto.timingSafeEqual`. Invalid → `400`, body never parsed as JSON.
3. The body is parsed only after signature verification passes.
4. The event's top-level `id` is inserted into `payment_webhook_events`.
   A unique-constraint conflict means this exact event was already
   processed — acknowledged with `200` immediately, no reprocessing.
5. `payment.captured` → capture (shared logic with `/verify`, see below).
6. `payment.failed` → mark the attempt failed, **unless it's already
   `captured`**, in which case this is a no-op (a failed-payment event
   must never downgrade an already-successful payment — verified live,
   see [Testing](#testing)).
7. Any other event type is acknowledged (`200`) and ignored.

This route receives `req.body` as a raw `Buffer`, not parsed JSON — see
[Raw body handling](#raw-body-handling-for-the-webhook) for why and how.

Responses: `200` for anything handled or safely ignored (including
duplicates) so Razorpay doesn't keep retrying something it doesn't need
to. `400` for a bad/missing signature. `500` only for a genuine unexpected
failure (e.g. a DB error during processing) — Razorpay retries on
non-2xx, which is correct here since the delivery wasn't actually
processed.

## Capture: shared by `/verify` and the webhook

Both `/verify` (after a valid signature) and the webhook's
`payment.captured` handler call the same `capturePayment(paymentId, razorpayPaymentId)`
function. It is the **only** place stock is decremented, and it's safe to
call from both paths concurrently:

1. `BEGIN`.
2. `SELECT ... FROM payments WHERE id = $1 FOR UPDATE` — locks the
   specific payment attempt.
3. If already `captured` (the other path won the race while this one was
   waiting for the lock): `COMMIT` and return the current order state,
   unchanged. **Stock is decremented at most once per order, no matter
   how many times `/verify` and the webhook both fire for it.**
4. Otherwise: lock the order row, read its `order_items`, lock the
   affected `products` rows (ascending id order, same convention as
   checkout, to avoid deadlocking against a concurrent checkout), and for
   each item run a guarded decrement:
   `UPDATE products SET stock_quantity = stock_quantity - $qty WHERE id = $id AND stock_quantity >= $qty`.
5. Mark the payment `captured`. Mark the order `payment_status = 'paid'`
   and `status = 'processing'` — or `'paid_fulfillment_blocked'` if any
   item's guarded decrement affected 0 rows (see next section).
6. `COMMIT`.

No Razorpay API call happens anywhere in this function — signature
verification is purely local HMAC math, so holding this transaction open
never means holding it open across a network call.

## Inventory and stock-decrement policy

- **Stock is decremented exactly once, at payment-confirmation time**
  (whichever of `/verify` or the webhook gets there first), not at
  checkout time. See [Conflicts](#conflicts-this-introduced-with-the-existing-checkout-design)
  above for why this changed.
- **Residual risk, documented rather than hidden:** without a stock
  *reservation* system between checkout and payment (not implemented —
  would need a TTL + release job, explicitly out of scope), two guests
  can both pass checkout's stock check for the last unit of a product and
  both reach Razorpay's payment screen. If both payments are captured,
  the second one to reach `capturePayment` will find the guarded
  decrement affects 0 rows for that item.
- In that case, the payment is still marked `captured`/`paid` — **because
  Razorpay actually captured real money; this code cannot pretend that
  didn't happen** — but the order's status becomes
  `paid_fulfillment_blocked` instead of `processing`, flagging it for
  manual admin review. **No automatic refund is implemented or attempted**
  — issuing one would require deciding refund policy, handling Razorpay's
  refund API and its own async settlement, and testing it with real
  transactions, none of which is in scope here. An admin must resolve
  `paid_fulfillment_blocked` orders by hand (refund, restock, or
  substitute).
- A `payment.failed` event **never** touches the `orders` table at all —
  only the specific `payments` row. This means a failed attempt can never
  change order state, regardless of event ordering, which is also why a
  late `payment.failed` for an already-`captured` payment is safe by
  construction (see `capturePayment`'s guard, step 3 above).

## Raw body handling for the webhook

`app.js` registers a path-scoped raw-body parser **before** the global
`express.json()`:

```js
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" })
);
app.use(express.json({ limit: "100kb" }));
```

body-parser (which both `express.raw()` and `express.json()` use
internally) sets an internal flag once a request body has been parsed and
every parser skips re-parsing if that flag is already set. So: webhook
requests get raw-Buffer parsing only (the global `json()` further down
sees the flag and skips); every other route is completely unaffected and
still gets normal parsed JSON. This matters because Razorpay's webhook
signature is computed over the **exact raw bytes** it sent — re-serializing
a JSON-parsed object (even one that looks identical) can produce different
bytes (key order, whitespace, number formatting) and silently break
signature verification.

## Webhook configuration (Razorpay Dashboard)

1. Dashboard → Settings → Webhooks → **Add New Webhook**.
2. URL: `https://<your-public-host>/api/payments/webhook` (must be
   publicly reachable — use a tunnel like `ngrok` for local testing).
3. Active events: enable at least `payment.captured` and `payment.failed`.
4. Set a secret — this is `RAZORPAY_WEBHOOK_SECRET`, **not** the same
   value as `RAZORPAY_KEY_SECRET`.
5. Save, then copy the secret into `.env`.

## Postman examples

1. **Create payment order**
   `POST http://localhost:3000/api/payments/create-order`
   Header: `X-Order-Token: {{orderToken}}`
   Body: `{ "orderNumber": "{{orderNumber}}" }`
   Save `data.razorpayOrderId`, `data.amount`, `data.keyId` — these feed
   Razorpay Checkout on the frontend.

2. **Verify payment** (after Razorpay Checkout's success callback)
   `POST http://localhost:3000/api/payments/verify`
   Header: `X-Order-Token: {{orderToken}}`
   Body:
   ```json
   {
     "orderNumber": "{{orderNumber}}",
     "razorpayOrderId": "{{razorpayOrderId}}",
     "razorpayPaymentId": "{{razorpayPaymentId}}",
     "razorpaySignature": "{{razorpaySignature}}"
   }
   ```

3. **Webhook** is server-to-server (Razorpay → your server), not
   something you'd normally call from Postman — Razorpay signs it with
   your webhook secret, which Postman doesn't have. To test it manually,
   compute `hmac_sha256(raw_body, RAZORPAY_WEBHOOK_SECRET)` yourself and
   set it as `X-Razorpay-Signature`, sending the exact same raw bytes you
   hashed as the body — this is exactly how it was verified live (see
   below).

## Testing

```bash
npm test
```

`tests/payments.test.js` mocks both the Postgres pool (`src/config/db.js`)
and the Razorpay SDK (`src/config/razorpay.js`), so no real network calls
happen and no real charges are possible. It covers: payment-order creation
for a valid unpaid order, missing/unauthorized guest-order access, creation
for an already-paid order, the Razorpay API call itself failing (attempt
marked failed, clean `500`), successful verification + capture + stock
decrement, duplicate verification requests (idempotent), invalid
signature, mismatched Razorpay order id, a valid webhook signature
capturing a payment, an invalid webhook signature, duplicate webhook
delivery, a failed-payment event that arrives after capture (never
overwrites it), a failed attempt followed by a successful retry, and
database-rollback-on-failure. `tests/checkout.test.js` and
`tests/cart.test.js` were updated/re-verified alongside this (COD
rejection, no stock decrement at checkout time) and `tests/api.test.js`
(health/categories/products) was re-run unchanged.

**What was additionally verified live**, against a real local Postgres
database with the migration applied and the real server running (with
`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` set to test-only values
passed as environment variables — never written into `.env` or any
tracked file):
- Checkout rejects `"cod"` with `400`; a Razorpay (`"online"`) checkout
  succeeds and leaves `stock_quantity` untouched.
- `create-order` called against the **real Razorpay API** with
  fake/invalid credentials failed cleanly (`500`), marked the attempt
  `failed`, and a subsequent retry for the same order successfully
  created a new attempt (confirming the unique-index slot was freed).
- `/verify`, called with a genuinely valid signature (computed with the
  server's actual `RAZORPAY_KEY_SECRET`) against a payment attempt
  inserted directly via SQL (simulating what a real `create-order` success
  would have produced), correctly captured the payment, decremented stock
  by exactly the ordered quantity, and transitioned the order to
  `paid`/`processing`.
- A duplicate `/verify` call with the same signature returned
  `alreadyProcessed: true` and did **not** decrement stock again.
- A real webhook delivery (`payment.captured`), signed with the server's
  actual `RAZORPAY_WEBHOOK_SECRET` over the exact raw JSON bytes sent,
  correctly captured a different payment attempt and decremented stock.
- Replaying that exact same webhook delivery was acknowledged as a
  duplicate and did not decrement stock again.
- A webhook with an invalid signature was rejected with `400` and never
  touched the database.
- A `payment.failed` webhook event, sent for a payment that was already
  `captured`, was safely ignored — the payment row stayed `captured` and
  the order stayed `paid`/`processing` (this exercise also caught and
  fixed a cosmetic bug: the response originally always said "Payment
  failure recorded" even when nothing was actually recorded due to the
  guard; it now says "Ignored: payment was already captured" in that
  case).
- Existing health/categories/products/cart/checkout endpoints all
  returned `200` throughout. All test data created during this pass was
  deleted afterward and the one real product's `stock_quantity`/
  `is_published` were restored to their original values.

**Not run, and not claimed:**
- No successful real call to Razorpay's live order-creation API — this
  environment either has no route to `api.razorpay.com` or the
  placeholder credentials used were rejected (the failure's `error.message`
  was empty, consistent with a network-level failure rather than an
  auth-rejection response body). Either way, no real Razorpay order was
  ever created, and the graceful-failure path is what was actually
  exercised, not a successful creation.
- No real charge was made or attempted anywhere, mocked or live.
- No automated integration suite against a dedicated test database, and
  no true concurrent-load test (e.g. firing real parallel HTTP requests)
  — the locking/idempotency design was verified by construction and by
  the manual live sequence above, not by a load test.
- Automatic refunds: not implemented, not tested, not claimed anywhere in
  this codebase or its responses.

## How to run the backend

```bash
npm install
npm run dev     # http://localhost:3000, nodemon
```

## Known limitations

- No stock reservation/TTL between checkout and payment — see
  [Inventory and stock-decrement policy](#inventory-and-stock-decrement-policy)
  for the specific oversold scenario this allows and how it's handled
  (`paid_fulfillment_blocked`, manual admin resolution, no auto-refund).
- No automatic refunds anywhere in this codebase.
- No admin UI/endpoints to resolve `paid_fulfillment_blocked` orders,
  transition fulfillment status, or cancel orders — out of scope here.
- Shipping is entirely manual (per the task's own scope) — no shipping
  APIs, rates, or tracking.
- `payments.status` models only 3 states (`created`/`captured`/`failed`);
  Razorpay's richer status machine (e.g. `authorized` under manual-capture
  settings) isn't modeled, since this integration doesn't use those
  settings.
