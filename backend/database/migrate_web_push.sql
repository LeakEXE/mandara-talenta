-- Native Web Push subscriptions and durable delivery queue.
-- Run once on an existing database:
--   node scripts/runMigration.js database/migrate_web_push.sql

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_delivery_queue (
    id BIGSERIAL PRIMARY KEY,
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_push_delivery UNIQUE (notification_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_pending
    ON push_delivery_queue(status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_subscription
    ON push_delivery_queue(subscription_id);

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_terminal
    ON push_delivery_queue(created_at)
    WHERE status IN ('sent', 'failed');

CREATE OR REPLACE FUNCTION enqueue_notification_push_deliveries()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO push_delivery_queue (notification_id, subscription_id)
    SELECT NEW.id, s.id
    FROM push_subscriptions s
    WHERE s.user_id = NEW.user_id
    ON CONFLICT (notification_id, subscription_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_enqueue_notification_push_deliveries'
          AND tgrelid = 'notifications'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_enqueue_notification_push_deliveries
            AFTER INSERT ON notifications
            FOR EACH ROW
            EXECUTE FUNCTION enqueue_notification_push_deliveries();
    END IF;
END;
$$;
