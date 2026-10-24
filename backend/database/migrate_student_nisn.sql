-- Add the optional 10-digit national student identifier (NISN).
-- Run from backend: node scripts/runMigration.js database/migrate_student_nisn.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS nisn VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_nisn_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_nisn_check
            CHECK (nisn IS NULL OR nisn ~ '^[0-9]{10}$');
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_nisn_unique
    ON users (nisn) WHERE nisn IS NOT NULL;
