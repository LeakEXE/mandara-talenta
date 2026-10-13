-- IPT Configuration Schema (PostgreSQL)
-- Standalone seed / upgrade file for ipt point configuration tables.
-- Safe to run after core tables exist (users must exist for FK on updated_by when inserting with updated_by).
-- Prefer full install via skema.sql; use this to re-seed or upgrade an existing DB.

-- ==================== IPT CONFIGURATION TABLES ====================

CREATE TABLE IF NOT EXISTS ipt_organisasi (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ipt_perilaku_karakter (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ipt_perilaku_tingkat (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ipt_config (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    field1 VARCHAR(200) DEFAULT NULL,
    field2 VARCHAR(100) DEFAULT NULL,
    field3 VARCHAR(100) DEFAULT NULL,
    point_value INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER,
    CONSTRAINT unique_config UNIQUE (category, field1, field2, field3),
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ipt_pelanggaran_level (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    point_value INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ipt_pelanggaran_detail (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    level_id INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (level_id) REFERENCES ipt_pelanggaran_level(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Config-driven values (no hard type lock): ensure prestasi/event columns are VARCHAR.
-- No-op on fresh installs created from skema.sql; kept idempotent for upgrades.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prestasi') THEN
        BEGIN
            ALTER TABLE prestasi ALTER COLUMN juara TYPE VARCHAR(100);
        EXCEPTION WHEN others THEN NULL;
        END;
        BEGIN
            ALTER TABLE prestasi ALTER COLUMN kategori TYPE VARCHAR(100);
        EXCEPTION WHEN others THEN NULL;
        END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event') THEN
        BEGIN
            ALTER TABLE event ALTER COLUMN tingkat TYPE VARCHAR(100);
        EXCEPTION WHEN others THEN NULL;
        END;
    END IF;
END $$;

-- ==================== DEFAULT CONFIGURATION DATA ====================
-- Only inserts when table is empty for ipt_config (avoids duplicate unique key errors on re-run)

INSERT INTO ipt_pelanggaran_level (name, point_value, description, is_active)
SELECT 'ringan', -1, 'Point untuk pelanggaran ringan', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ipt_pelanggaran_level LIMIT 1)
UNION ALL
SELECT 'sedang', -5, 'Point untuk pelanggaran sedang', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ipt_pelanggaran_level LIMIT 1)
UNION ALL
SELECT 'berat', -25, 'Point untuk pelanggaran berat', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ipt_pelanggaran_level LIMIT 1);

INSERT INTO ipt_config (category, field1, field2, field3, point_value, description)
SELECT v.category, v.field1, v.field2, v.field3, v.point_value, v.description
FROM (
    SELECT 'prestasi' AS category, 'kecamatan' AS field1, 'juara 1' AS field2, NULL::VARCHAR(100) AS field3, 50 AS point_value, 'Juara 1 tingkat kecamatan' AS description UNION ALL
    SELECT 'prestasi', 'kecamatan', 'juara 2', NULL, 40, 'Juara 2 tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'juara 3', NULL, 30, 'Juara 3 tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'juara harapan 1', NULL, 25, 'Juara Harapan 1 tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'juara harapan 2', NULL, 20, 'Juara Harapan 2 tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'juara harapan 3', NULL, 15, 'Juara Harapan 3 tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'finalis', NULL, 10, 'Finalis tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kecamatan', 'peserta', NULL, 5, 'Peserta tingkat kecamatan' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara 1', NULL, 60, 'Juara 1 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara 2', NULL, 50, 'Juara 2 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara 3', NULL, 40, 'Juara 3 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara harapan 1', NULL, 35, 'Juara Harapan 1 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara harapan 2', NULL, 30, 'Juara Harapan 2 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'juara harapan 3', NULL, 25, 'Juara Harapan 3 tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'finalis', NULL, 15, 'Finalis tingkat kabupaten' UNION ALL
    SELECT 'prestasi', 'kabupaten', 'peserta', NULL, 8, 'Peserta tingkat kabupaten' UNION ALL
    SELECT 'perilaku', 'sangat baik', NULL, NULL, 5, 'Penilaian sangat baik (semua karakter)' UNION ALL
    SELECT 'perilaku', 'baik', NULL, NULL, 4, 'Penilaian baik (semua karakter)' UNION ALL
    SELECT 'perilaku', 'cukup baik', NULL, NULL, 3, 'Penilaian cukup baik (semua karakter)' UNION ALL
    SELECT 'perilaku', 'kurang baik', NULL, NULL, 1, 'Penilaian kurang baik (semua karakter)' UNION ALL
    SELECT 'kepanitiaan', 'ketua', NULL, NULL, 10, 'Ketua kepanitiaan' UNION ALL
    SELECT 'kepanitiaan', 'wakil ketua', NULL, NULL, 8, 'Wakil ketua kepanitiaan' UNION ALL
    SELECT 'kepanitiaan', 'sekretaris', NULL, NULL, 7, 'Sekretaris kepanitiaan' UNION ALL
    SELECT 'kepanitiaan', 'bendahara', NULL, NULL, 7, 'Bendahara kepanitiaan' UNION ALL
    SELECT 'kepanitiaan', 'koordinator', NULL, NULL, 5, 'Koordinator kepanitiaan' UNION ALL
    SELECT 'kepanitiaan', 'anggota', NULL, NULL, 3, 'Anggota kepanitiaan' UNION ALL
    SELECT 'organisasi', 'OSIS', 'ketua', NULL, 10, 'Ketua OSIS' UNION ALL
    SELECT 'organisasi', 'OSIS', 'wakil ketua', NULL, 8, 'Wakil ketua OSIS' UNION ALL
    SELECT 'organisasi', 'OSIS', 'sekretaris', NULL, 7, 'Sekretaris OSIS' UNION ALL
    SELECT 'organisasi', 'OSIS', 'bendahara', NULL, 7, 'Bendahara OSIS' UNION ALL
    SELECT 'organisasi', 'OSIS', 'koordinator', NULL, 5, 'Koordinator OSIS' UNION ALL
    SELECT 'organisasi', 'OSIS', 'anggota', NULL, 3, 'Anggota OSIS' UNION ALL
    SELECT 'organisasi', 'KY', 'ketua', NULL, 10, 'Ketua KY' UNION ALL
    SELECT 'organisasi', 'KY', 'wakil ketua', NULL, 8, 'Wakil ketua KY' UNION ALL
    SELECT 'organisasi', 'KY', 'sekretaris', NULL, 7, 'Sekretaris KY' UNION ALL
    SELECT 'organisasi', 'KY', 'bendahara', NULL, 7, 'Bendahara KY' UNION ALL
    SELECT 'organisasi', 'KY', 'koordinator', NULL, 5, 'Koordinator KY' UNION ALL
    SELECT 'organisasi', 'KY', 'anggota', NULL, 3, 'Anggota KY' UNION ALL
    SELECT 'organisasi', 'MPK', 'ketua', NULL, 10, 'Ketua MPK' UNION ALL
    SELECT 'organisasi', 'MPK', 'wakil ketua', NULL, 8, 'Wakil ketua MPK' UNION ALL
    SELECT 'organisasi', 'MPK', 'sekretaris', NULL, 7, 'Sekretaris MPK' UNION ALL
    SELECT 'organisasi', 'MPK', 'bendahara', NULL, 7, 'Bendahara MPK' UNION ALL
    SELECT 'organisasi', 'MPK', 'koordinator', NULL, 5, 'Koordinator MPK' UNION ALL
    SELECT 'organisasi', 'MPK', 'anggota', NULL, 3, 'Anggota MPK' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'ketua', NULL, 10, 'Ketua PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'wakil ketua', NULL, 8, 'Wakil ketua PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'sekretaris', NULL, 7, 'Sekretaris PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'bendahara', NULL, 7, 'Bendahara PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'koordinator', NULL, 5, 'Koordinator PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PRAMUKA', 'anggota', NULL, 3, 'Anggota PRAMUKA' UNION ALL
    SELECT 'organisasi', 'PKS', 'ketua', NULL, 10, 'Ketua PKS' UNION ALL
    SELECT 'organisasi', 'PKS', 'wakil ketua', NULL, 8, 'Wakil ketua PKS' UNION ALL
    SELECT 'organisasi', 'PKS', 'sekretaris', NULL, 7, 'Sekretaris PKS' UNION ALL
    SELECT 'organisasi', 'PKS', 'bendahara', NULL, 7, 'Bendahara PKS' UNION ALL
    SELECT 'organisasi', 'PKS', 'koordinator', NULL, 5, 'Koordinator PKS' UNION ALL
    SELECT 'organisasi', 'PKS', 'anggota', NULL, 3, 'Anggota PKS' UNION ALL
    SELECT 'organisasi', 'PMR', 'ketua', NULL, 10, 'Ketua PMR' UNION ALL
    SELECT 'organisasi', 'PMR', 'wakil ketua', NULL, 8, 'Wakil ketua PMR' UNION ALL
    SELECT 'organisasi', 'PMR', 'sekretaris', NULL, 7, 'Sekretaris PMR' UNION ALL
    SELECT 'organisasi', 'PMR', 'bendahara', NULL, 7, 'Bendahara PMR' UNION ALL
    SELECT 'organisasi', 'PMR', 'koordinator', NULL, 5, 'Koordinator PMR' UNION ALL
    SELECT 'organisasi', 'PMR', 'anggota', NULL, 3, 'Anggota PMR' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'ketua', NULL, 10, 'Ketua PASKIBRAKA' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'wakil ketua', NULL, 8, 'Wakil ketua PASKIBRAKA' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'sekretaris', NULL, 7, 'Sekretaris PASKIBRAKA' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'bendahara', NULL, 7, 'Bendahara PASKIBRAKA' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'koordinator', NULL, 5, 'Koordinator PASKIBRAKA' UNION ALL
    SELECT 'organisasi', 'PASKIBRAKA', 'anggota', NULL, 3, 'Anggota PASKIBRAKA' UNION ALL
    SELECT 'event', 'sekolah', NULL, NULL, 5, 'Event tingkat sekolah' UNION ALL
    SELECT 'event', 'kecamatan', NULL, NULL, 10, 'Event tingkat kecamatan' UNION ALL
    SELECT 'event', 'kabupaten', NULL, NULL, 15, 'Event tingkat kabupaten' UNION ALL
    SELECT 'event', 'provinsi', NULL, NULL, 20, 'Event tingkat provinsi' UNION ALL
    SELECT 'event', 'nasional', NULL, NULL, 25, 'Event tingkat nasional' UNION ALL
    SELECT 'event', 'internasional', NULL, NULL, 30, 'Event tingkat internasional'
) AS v
WHERE NOT EXISTS (SELECT 1 FROM ipt_config LIMIT 1);

-- Pengaturan tampilan: batas minimum Total IPT (0 = nonaktif)
INSERT INTO ipt_config (category, field1, field2, field3, point_value, description)
SELECT 'pengaturan', 'min_ipt', NULL, NULL, 0,
       'Batas minimum Total IPT - total di bawah nilai ini ditampilkan merah (0 = nonaktif)'
WHERE NOT EXISTS (
    SELECT 1 FROM ipt_config WHERE category = 'pengaturan' AND field1 = 'min_ipt'
);

INSERT INTO ipt_organisasi (name)
SELECT DISTINCT field1 FROM ipt_config
WHERE category = 'organisasi' AND field1 IS NOT NULL
ON CONFLICT (name) DO NOTHING;

INSERT INTO ipt_perilaku_karakter (name) VALUES
('tanggung_jawab'), ('disiplin'), ('kepedulian'), ('kemandirian'),
('spiritual'), ('kejujuran'), ('kepercayaan_diri')
ON CONFLICT (name) DO NOTHING;

INSERT INTO ipt_perilaku_tingkat (name) VALUES
('sangat baik'), ('baik'), ('cukup baik'), ('kurang baik')
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_ipt_config_category ON ipt_config(category);
CREATE INDEX IF NOT EXISTS idx_ipt_config_field1 ON ipt_config(field1);
CREATE INDEX IF NOT EXISTS idx_ipt_config_field2 ON ipt_config(field2);
CREATE INDEX IF NOT EXISTS idx_ipt_config_active ON ipt_config(is_active);
