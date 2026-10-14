-- Migration: 002_create_guest_checkout.sql
-- Purpose: Create tables for guest checkout / order management.
-- Safe to run multiple times (idempotent). Does not modify or delete any
-- existing data in categories/products/carts/cart_items.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/002_create_guest_checkout.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d orders"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d order_items"

BEGIN;

CREATE TABLE IF NOT EXISTS orders (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Public, human-shareable reference (e.g. ORD-20261013-9F3A2B7C1D).
    -- Not itself the access-control mechanism -- see order_token_hash.
    order_number            VARCHAR(32) NOT NULL UNIQUE,

    -- SHA-256 hash of a 256-bit random guest access token. The raw token is
    -- returned to the client exactly once, at order-creation time, and is
    -- never stored or logged. Looking up an order requires BOTH the
    -- order_number AND a token whose hash matches this column -- order
    -- number or database id alone is never sufficient to read an order.
    order_token_hash        CHAR(64) NOT NULL UNIQUE,

    -- Fulfillment lifecycle (not payment status).
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (status IN (
                               'pending', 'pending_payment', 'processing',
                               'shipped', 'delivered', 'cancelled'
                             )),

    -- Payment lifecycle. Always starts 'pending' -- creating an order never
    -- implies payment has been collected or confirmed, for COD or online.
    payment_status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),

    payment_method          VARCHAR(20) NOT NULL
                             CHECK (payment_method IN ('cod', 'online')),

    customer_name           VARCHAR(150) NOT NULL,
    customer_email          VARCHAR(255),
    customer_phone          VARCHAR(20) NOT NULL,

    shipping_address_line1  VARCHAR(255) NOT NULL,
    shipping_address_line2  VARCHAR(255),
    shipping_city           VARCHAR(100) NOT NULL,
    shipping_state          VARCHAR(100) NOT NULL,
    shipping_postal_code    VARCHAR(20) NOT NULL,
    shipping_country        VARCHAR(100) NOT NULL DEFAULT 'India',

    subtotal                NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    shipping_fee            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
    discount_amount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount            NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    -- Defense in depth: the stored total must always equal the stored
    -- components. Catches any future bug that inserts an inconsistent row.
    CONSTRAINT chk_orders_total_consistent
        CHECK (total_amount = subtotal + shipping_fee - discount_amount),

    currency                CHAR(3) NOT NULL DEFAULT 'INR',

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

    -- Nullable + ON DELETE SET NULL: a product can be removed from the
    -- catalog later without blocking that deletion and without destroying
    -- order history. product_name/product_slug/unit_price below are
    -- snapshots taken at checkout time, so the historical record stays
    -- intact even if the product row disappears or changes.
    product_id      BIGINT REFERENCES products (id) ON DELETE SET NULL,

    product_name    VARCHAR(200) NOT NULL,
    product_slug    VARCHAR(200),
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    line_total      NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
    CONSTRAINT chk_order_items_line_total
        CHECK (line_total = unit_price * quantity),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);

COMMIT;
