-- Migration: 003_create_razorpay_payments.sql
-- Purpose: Add Razorpay payment-attempt tracking and webhook-event
-- deduplication, and tighten order constraints now that Razorpay is the
-- only supported payment method. Idempotent where possible. Does not
-- drop, truncate, or delete any existing data.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/003_create_razorpay_payments.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d payments"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d payment_webhook_events"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d orders"
--
-- Note: this migration must run AFTER 001_create_guest_cart.sql and
-- 002_create_guest_checkout.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS payments (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id            BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

    -- Nullable until the Razorpay order-creation API call returns
    -- successfully (see docs/payments-api.md for why creation is split
    -- into "reserve a slot" then "call Razorpay" then "record the result").
    razorpay_order_id   VARCHAR(64) UNIQUE,

    -- Populated only once a payment is actually captured.
    razorpay_payment_id VARCHAR(64) UNIQUE,

    amount              NUMERIC(12,2),
    currency            CHAR(3) NOT NULL DEFAULT 'INR',

    status              VARCHAR(20) NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'captured', 'failed')),
    failure_reason      TEXT,
    verified_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one *active* (not yet failed) payment attempt per order at a
-- time. This is the uniqueness guard that prevents two concurrent
-- POST /api/payments/create-order calls for the same order from both
-- proceeding to call Razorpay and create two separate Razorpay orders.
-- A failed attempt frees the slot so the customer can retry payment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_order_active
    ON payments (order_id)
    WHERE status = 'created';

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razorpay_event_id   VARCHAR(64) NOT NULL UNIQUE,
    event_type          VARCHAR(50) NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Razorpay is now the only payment method (no COD). Tighten the existing
-- constraint rather than leaving a dead 'cod' option in the schema.
-- Guarded: only touches the constraint, never existing rows, and is
-- skipped entirely if it has already been applied.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_method_check'
    ) THEN
        ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check;
    END IF;

    ALTER TABLE orders
        ADD CONSTRAINT orders_payment_method_check
        CHECK (payment_method = 'online');
END $$;

-- Add the one new order-status value needed for the rare "payment was
-- captured by Razorpay but stock ran out before we could decrement it"
-- case (see docs/payments-api.md). No automatic refund is implemented;
-- this status exists so that case is visible for manual admin handling
-- instead of silently mis-reporting the order as normally processing.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check'
    ) THEN
        ALTER TABLE orders DROP CONSTRAINT orders_status_check;
    END IF;

    ALTER TABLE orders
        ADD CONSTRAINT orders_status_check
        CHECK (status IN (
            'pending', 'pending_payment', 'processing', 'shipped',
            'delivered', 'cancelled', 'paid_fulfillment_blocked'
        ));
END $$;

COMMIT;
