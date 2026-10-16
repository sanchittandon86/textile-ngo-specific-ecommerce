-- Migration: 006_create_order_fulfillment.sql
-- Purpose: Let admin advance an order's fulfillment status
-- (processing -> shipped -> delivered) with tracking info and a
-- logged history of each transition. Idempotent. Does not modify or
-- delete any existing data.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/006_create_order_fulfillment.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d orders"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d order_status_history"

BEGIN;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tracking_carrier VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);

-- Logs every admin-initiated fulfillment transition (from_status is NULL
-- impossible in practice since every order starts with a status, but
-- left nullable for forward-compatibility with any future system-level
-- insert that doesn't have a prior status to reference).
CREATE TABLE IF NOT EXISTS order_status_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status VARCHAR(30),
    to_status   VARCHAR(30) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
    ON order_status_history (order_id);

COMMIT;
