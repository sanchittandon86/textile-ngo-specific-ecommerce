-- Migration: 004_create_admin_auth.sql
-- Purpose: Admin authentication, ported from
-- https://github.com/sanchittandon86/Login-application (same schema,
-- same session-revocation design). Table named admin_users (not
-- "users") since this project has no customer accounts at all --
-- customers are always guests. Rows are seeded directly
-- (scripts/seed-admin.js); there is no public registration endpoint.
-- Idempotent. Never drops or truncates data.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/004_create_admin_auth.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d admin_users"
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d admin_refresh_tokens"

BEGIN;

CREATE TABLE IF NOT EXISTS admin_users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_refresh_tokens (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id    BIGINT NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
    -- Only the SHA-256 hash of the refresh token is ever stored.
    token_hash  TEXT NOT NULL UNIQUE,
    session_id  UUID NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_admin_id ON admin_refresh_tokens (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_session_id ON admin_refresh_tokens (session_id);

COMMIT;
