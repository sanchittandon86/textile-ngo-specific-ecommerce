-- Migration: 005_create_product_import_support.sql
-- Purpose: Support the admin bulk catalog import feature.
-- Idempotent. Never drops or truncates data.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/005_create_product_import_support.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d products"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d product_images"

BEGIN;

-- Immutable business identifier used by the bulk import to decide
-- create-vs-update. Nullable (not backfilled) so the existing product
-- row, created before this feature existed, is left untouched -- a
-- UNIQUE constraint allows any number of NULLs in Postgres, so that's
-- safe. Every row imported through the bulk import flow is required
-- (at the application layer) to have a non-empty sku; this column does
-- not enforce NOT NULL at the DB level to avoid a backfill decision for
-- pre-existing data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'sku'
    ) THEN
        ALTER TABLE products ADD COLUMN sku VARCHAR(50) UNIQUE;
    END IF;
END $$;

-- Product image gallery. products.image_url (a single legacy field) is
-- intentionally left in place and kept in sync with the primary image
-- here by the import service, since the public storefront reads
-- products.image_url directly and is out of scope to modify.
CREATE TABLE IF NOT EXISTS product_images (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id           BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    cloudinary_public_id TEXT NOT NULL UNIQUE,
    image_url            TEXT NOT NULL,
    -- The original URL from the admin's Excel file, kept so re-importing
    -- the same file can detect "this image didn't change" and skip
    -- re-uploading to Cloudinary (see docs/product-import.md).
    source_url           TEXT NOT NULL,
    alt_text             VARCHAR(255),
    sort_order           INTEGER NOT NULL DEFAULT 0,
    is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_images_product_sort UNIQUE (product_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);

-- At most one primary image per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary
    ON product_images (product_id)
    WHERE is_primary;

COMMIT;
