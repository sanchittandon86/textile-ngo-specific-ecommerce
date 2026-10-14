-- Migration: 001_create_guest_cart.sql
-- Purpose: Create tables for the server-side guest cart feature.
-- Safe to run multiple times (idempotent). Does not modify or delete
-- any existing data in categories/products.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/001_create_guest_cart.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d carts"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d cart_items"

BEGIN;

CREATE TABLE IF NOT EXISTS carts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash  CHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Speeds up the periodic cleanup job that deletes expired carts.
CREATE INDEX IF NOT EXISTS idx_carts_expires_at ON carts (expires_at);

CREATE TABLE IF NOT EXISTS cart_items (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cart_id     BIGINT NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
    product_id  BIGINT NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cart_items_cart_product UNIQUE (cart_id, product_id)
);

-- Speeds up "fetch all items for a cart" (GET /api/cart, empty cart, etc).
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items (cart_id);

-- Speeds up lookups/joins by product (e.g. stock/availability checks).
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items (product_id);

COMMIT;
