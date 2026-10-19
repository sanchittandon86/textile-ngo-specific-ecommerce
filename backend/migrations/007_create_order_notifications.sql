-- Migration: 007_create_order_notifications.sql
-- Purpose: Track transactional email/WhatsApp notification delivery per
-- order, so sends are idempotent and failures are retryable. Idempotent
-- migration. Does not modify any existing table.
--
-- Run with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/007_create_order_notifications.sql
--
-- Verify with:
--   psql -h localhost -p 5432 -U <DB_USER> -d textile_store -c "\d order_notifications"

BEGIN;

CREATE TABLE IF NOT EXISTS order_notifications (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id             BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

    notification_type    VARCHAR(30) NOT NULL
                          CHECK (notification_type IN (
                            'ORDER_PLACED', 'PAYMENT_SUCCESS', 'ORDER_SHIPPED',
                            'ORDER_DELIVERED', 'REFUND_INITIATED', 'REFUND_COMPLETED'
                          )),

    channel              VARCHAR(10) NOT NULL
                          CHECK (channel IN ('EMAIL', 'WHATSAPP')),

    -- Nullable: a channel can be attempted with no usable recipient (e.g.
    -- no email on file) and still gets a tracked FAILED row rather than
    -- being silently dropped.
    recipient            VARCHAR(255),

    status                VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'SENT', 'FAILED')),

    provider_message_id  VARCHAR(255),
    error_message        TEXT,
    sent_at               TIMESTAMPTZ,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The idempotency backstop: at most one notification row per
    -- order/type/channel triple, ever. A natural re-trigger of the same
    -- event (e.g. a duplicate webhook delivery) finds this row already
    -- exists and does not attempt to send again -- see
    -- notification.service.js. Deliberately retrying a FAILED row is a
    -- separate, explicit action (retryNotification) that updates this
    -- same row rather than inserting a new one.
    CONSTRAINT uq_order_notifications_order_type_channel
        UNIQUE (order_id, notification_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_order_notifications_order_id
    ON order_notifications (order_id);

-- Used to find FAILED notifications for retry.
CREATE INDEX IF NOT EXISTS idx_order_notifications_status
    ON order_notifications (status);

COMMIT;
