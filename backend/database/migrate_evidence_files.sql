-- Add multi-file evidence support while keeping the legacy `foto` column as
-- the first/primary file. Run once on an existing database:
--   node scripts/runMigration.js database/migrate_evidence_files.sql

CREATE TABLE IF NOT EXISTS record_evidence (
    id SERIAL PRIMARY KEY,
    record_type VARCHAR(32) NOT NULL,
    record_id INTEGER NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_record_evidence_record
    ON record_evidence(record_type, record_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_record_evidence_unique
    ON record_evidence(record_type, record_id, file_path);

-- Backfill every existing single-file record into the new set. The old `foto`
-- values stay untouched so older clients and screens keep working.
INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'prestasi', id, foto, 0 FROM prestasi WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'event', id, foto, 0 FROM event WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'organisasi', id, foto, 0 FROM organisasi WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'kepanitiaan', id, foto, 0 FROM kepanitiaan WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'pelanggaran', id, foto, 0 FROM pelanggaran WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'prestasi_approvals', id, foto, 0 FROM prestasi_approvals WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'event_approvals', id, foto, 0 FROM event_approvals WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'organisasi_approvals', id, foto, 0 FROM organisasi_approvals WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;

INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
SELECT 'kepanitiaan_approvals', id, foto, 0 FROM kepanitiaan_approvals WHERE foto IS NOT NULL AND foto <> ''
ON CONFLICT DO NOTHING;
