-- PostgreSQL schema for Mandara Talenta
-- Import into an existing database, e.g.:  psql -d ipt_school -f skema.sql
-- This file contains all tables: users, permissions, prestasi, organisasi, event, pelanggaran, perilaku,
-- ipt configuration, activity_logs, ipt_history, wali_kelas_assignment, approvals,
-- notifications, input_access_control
--
-- Notes vs the legacy MySQL schema:
-- * ENUM(...)        -> TEXT + CHECK constraint (same allowed values)
-- * INT AUTO_INCREMENT -> SERIAL (Postgres auto-increment)
-- * updated_at auto-update (MySQL ON UPDATE CURRENT_TIMESTAMP) -> trigger set_updated_at()
-- * is_graduated stays SMALLINT (0/1) so existing `= 0` queries keep working
-- * input_access_control has UNIQUE(control_type, role_target, jenis_input)
--   to support the ON CONFLICT upserts used by the backend

-- Auto-update helper for updated_at columns (replaces MySQL ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================== CORE TABLES ====================

-- Users Table
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) UNIQUE,
    nip VARCHAR(30) UNIQUE,
    username VARCHAR(20) UNIQUE,
    password VARCHAR(255) NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('superadmin', 'guru', 'pegawai', 'siswa')),
    kelas VARCHAR(50),
    grha VARCHAR(50),
    jurusan VARCHAR(50) DEFAULT NULL,
    wali_kelas VARCHAR(50),
    ipt_total INTEGER DEFAULT 80,
    ipt_awal INTEGER DEFAULT 80,
    alamat TEXT,
    no_hp VARCHAR(20),
    detail VARCHAR(100),
    foto VARCHAR(255),
    tahun_pelajaran VARCHAR(9) DEFAULT NULL,
    is_graduated SMALLINT DEFAULT 0,
    must_change_credentials BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username));

-- Permissions Table
DROP TABLE IF EXISTS permissions CASCADE;
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    can_input_prestasi BOOLEAN DEFAULT FALSE,
    can_input_organisasi BOOLEAN DEFAULT FALSE,
    can_input_kepanitiaan BOOLEAN DEFAULT FALSE,
    can_input_event BOOLEAN DEFAULT FALSE,
    can_input_pelanggaran BOOLEAN DEFAULT FALSE,
    can_input_perilaku BOOLEAN DEFAULT FALSE,
    can_view_all_data BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Per-type approval scopes: which submission types a staff member may approve.
-- Managed by superadmin in Izin Akun. Superadmins bypass scopes entirely.
DROP TABLE IF EXISTS approval_scopes CASCADE;
CREATE TABLE approval_scopes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    jenis TEXT NOT NULL CHECK (jenis IN ('prestasi', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_approval_scope UNIQUE (user_id, jenis)
);

-- ==================== IPT CONFIGURATION TABLES ====================

-- Organization options managed by IPT configuration
DROP TABLE IF EXISTS ipt_organisasi CASCADE;
CREATE TABLE ipt_organisasi (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_ipt_organisasi_updated BEFORE UPDATE ON ipt_organisasi
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TABLE IF EXISTS ipt_perilaku_karakter CASCADE;
CREATE TABLE ipt_perilaku_karakter (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_ipt_perilaku_karakter_updated BEFORE UPDATE ON ipt_perilaku_karakter
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TABLE IF EXISTS ipt_perilaku_tingkat CASCADE;
CREATE TABLE ipt_perilaku_tingkat (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_ipt_perilaku_tingkat_updated BEFORE UPDATE ON ipt_perilaku_tingkat
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Main IPT point configuration
DROP TABLE IF EXISTS ipt_config CASCADE;
CREATE TABLE ipt_config (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    field1 VARCHAR(100) DEFAULT NULL,
    field2 VARCHAR(100) DEFAULT NULL,
    field3 VARCHAR(100) DEFAULT NULL,
    point_value INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER DEFAULT NULL,
    CONSTRAINT unique_config UNIQUE (category, field1, field2, field3),
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_ipt_config_updated BEFORE UPDATE ON ipt_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pelanggaran configuration is split into levels and coarse details
DROP TABLE IF EXISTS ipt_pelanggaran_detail CASCADE;
DROP TABLE IF EXISTS ipt_pelanggaran_level CASCADE;
CREATE TABLE ipt_pelanggaran_level (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    point_value INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_ipt_pelanggaran_level_updated BEFORE UPDATE ON ipt_pelanggaran_level
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ipt_pelanggaran_detail (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    level_id INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (level_id) REFERENCES ipt_pelanggaran_level(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE TRIGGER trg_ipt_pelanggaran_detail_updated BEFORE UPDATE ON ipt_pelanggaran_detail
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==================== DATA TABLES ====================

-- Prestasi Table
DROP TABLE IF EXISTS prestasi CASCADE;
CREATE TABLE prestasi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    nama_lomba VARCHAR(255) NOT NULL,
    foto VARCHAR(255),
    kelas VARCHAR(50),
    pembina VARCHAR(100),
    grha VARCHAR(50),
    juara VARCHAR(100) NOT NULL,
    kategori VARCHAR(100) NOT NULL,
    jenis_lomba VARCHAR(50) DEFAULT 'akademik',
    kategori_lomba VARCHAR(50) DEFAULT 'individu',
    pembina_id INTEGER NULL,
    grup_lomba VARCHAR(64) NULL,
    point INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (pembina_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Organisasi Table
DROP TABLE IF EXISTS organisasi CASCADE;
CREATE TABLE organisasi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    jabatan_organisasi VARCHAR(100) NOT NULL,
    foto VARCHAR(255),
    kategori_organisasi VARCHAR(100),
    point INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Kepanitiaan Table
DROP TABLE IF EXISTS kepanitiaan CASCADE;
CREATE TABLE kepanitiaan (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    jabatan_kepanitiaan VARCHAR(100) NOT NULL,
    foto VARCHAR(255),
    kategori_kepanitiaan VARCHAR(100),
    point INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Event Table
DROP TABLE IF EXISTS event CASCADE;
CREATE TABLE event (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    nama_event VARCHAR(255) NOT NULL,
    tingkat VARCHAR(100) NOT NULL,
    foto VARCHAR(255),
    point INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Pelanggaran Table
DROP TABLE IF EXISTS pelanggaran CASCADE;
CREATE TABLE pelanggaran (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    keterangan TEXT NOT NULL,
    foto VARCHAR(255),
    jenis_pelanggaran VARCHAR(100) NOT NULL,
    point_dikurangi INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Perilaku Table
DROP TABLE IF EXISTS perilaku CASCADE;
CREATE TABLE perilaku (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    karakter_siswa TEXT NOT NULL,
    point INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ==================== LOGGING & HISTORY TABLES ====================

-- Activity Logs Table
-- The `action` column uses SCREAMING_SNAKE_CASE naming convention
-- (e.g. LOGIN, SUBMIT_PRESTASI, APPROVE_PRESTASI, CREATE_TEACHER).
DROP TABLE IF EXISTS activity_logs CASCADE;
CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action VARCHAR(255) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- IPT History Table
DROP TABLE IF EXISTS ipt_history CASCADE;
CREATE TABLE ipt_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    jenis_perubahan TEXT NOT NULL CHECK (jenis_perubahan IN ('prestasi', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran', 'perilaku', 'initial', 'manual', 'sync', 'prestasi_update', 'prestasi_delete', 'organisasi_update', 'organisasi_delete', 'kepanitiaan_update', 'kepanitiaan_delete', 'event_update', 'event_delete', 'pelanggaran_update', 'pelanggaran_delete', 'perilaku_update', 'perilaku_delete')),
    point_change INTEGER NOT NULL,
    ipt_sebelum INTEGER NOT NULL,
    ipt_sesudah INTEGER NOT NULL,
    keterangan TEXT,
    -- Link to the source record (NULL for initial/manual/sync rows).
    -- Lets record deletes remove exactly their own history rows.
    record_type TEXT DEFAULT NULL,
    record_id INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ipt_history_record ON ipt_history (user_id, record_type, record_id);

-- ==================== WALI KELAS TABLES ====================

-- Wali Kelas Assignment Table
DROP TABLE IF EXISTS wali_kelas_assignment CASCADE;
CREATE TABLE wali_kelas_assignment (
    id SERIAL PRIMARY KEY,
    guru_id INTEGER NOT NULL,
    kelas VARCHAR(50) NOT NULL,
    tahun_ajaran VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_guru_kelas UNIQUE (guru_id, kelas, tahun_ajaran),
    CONSTRAINT unique_kelas_tahun_ajaran UNIQUE (kelas, tahun_ajaran)
);

-- ==================== APPROVAL TABLES ====================

-- Prestasi Approvals Table
DROP TABLE IF EXISTS prestasi_approvals CASCADE;
CREATE TABLE prestasi_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nis VARCHAR(50) NOT NULL,
    nama_lomba VARCHAR(255) NOT NULL,
    kelas VARCHAR(50),
    pembina VARCHAR(255),
    grha VARCHAR(50),
    juara VARCHAR(50),
    kategori VARCHAR(50),
    jenis_lomba VARCHAR(50) DEFAULT 'akademik',
    kategori_lomba VARCHAR(50) DEFAULT 'individu',
    grup_lomba VARCHAR(64) NULL,
    foto VARCHAR(255),
    pembina_status TEXT DEFAULT 'pending' CHECK (pembina_status IN ('pending', 'approved', 'rejected')),
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    pembina_id INTEGER NULL,
    pembina_approved_at TIMESTAMP NULL,
    superadmin_approved_at TIMESTAMP NULL,
    pembina_notes TEXT,
    superadmin_notes TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (pembina_id) REFERENCES users(id),
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_prestasi_approvals_updated BEFORE UPDATE ON prestasi_approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Event Approvals Table
DROP TABLE IF EXISTS event_approvals CASCADE;
CREATE TABLE event_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nis VARCHAR(50) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    pembina VARCHAR(255),
    nama_event VARCHAR(255) NOT NULL,
    tingkat VARCHAR(50),
    foto VARCHAR(255),
    pembina_status TEXT DEFAULT 'pending' CHECK (pembina_status IN ('pending', 'approved', 'rejected')),
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    pembina_id INTEGER NULL,
    pembina_approved_at TIMESTAMP NULL,
    superadmin_approved_at TIMESTAMP NULL,
    pembina_notes TEXT,
    superadmin_notes TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (pembina_id) REFERENCES users(id),
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_event_approvals_updated BEFORE UPDATE ON event_approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Organisasi Approvals Table
DROP TABLE IF EXISTS organisasi_approvals CASCADE;
CREATE TABLE organisasi_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nis VARCHAR(50) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    pembina VARCHAR(255),
    jabatan_organisasi VARCHAR(100),
    kategori_organisasi VARCHAR(255),
    foto VARCHAR(255),
    pembina_status TEXT DEFAULT 'pending' CHECK (pembina_status IN ('pending', 'approved', 'rejected')),
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    pembina_id INTEGER NULL,
    pembina_approved_at TIMESTAMP NULL,
    superadmin_approved_at TIMESTAMP NULL,
    pembina_notes TEXT,
    superadmin_notes TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (pembina_id) REFERENCES users(id),
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_organisasi_approvals_updated BEFORE UPDATE ON organisasi_approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Kepanitiaan Approvals Table
DROP TABLE IF EXISTS kepanitiaan_approvals CASCADE;
CREATE TABLE kepanitiaan_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nis VARCHAR(50) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    pembina VARCHAR(255),
    jabatan_kepanitiaan VARCHAR(100),
    kategori_kepanitiaan VARCHAR(255),
    foto VARCHAR(255),
    pembina_status TEXT DEFAULT 'pending' CHECK (pembina_status IN ('pending', 'approved', 'rejected')),
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    pembina_id INTEGER NULL,
    pembina_approved_at TIMESTAMP NULL,
    superadmin_approved_at TIMESTAMP NULL,
    pembina_notes TEXT,
    superadmin_notes TEXT,
    submitted_by INTEGER NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (pembina_id) REFERENCES users(id),
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_kepanitiaan_approvals_updated BEFORE UPDATE ON kepanitiaan_approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Siswa Approvals Table (for new student accounts created by guru)
DROP TABLE IF EXISTS siswa_approvals CASCADE;
CREATE TABLE siswa_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nis VARCHAR(50) NOT NULL,
    kelas VARCHAR(50),
    grha VARCHAR(50),
    password_hash VARCHAR(255),
    ipt_awal INTEGER DEFAULT 80,
    created_by INTEGER NOT NULL,
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    superadmin_approved_at TIMESTAMP NULL,
    superadmin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TRIGGER trg_siswa_approvals_updated BEFORE UPDATE ON siswa_approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Biodata Update Approvals Table
DROP TABLE IF EXISTS biodata_update_approvals CASCADE;
CREATE TABLE biodata_update_approvals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    nama_baru VARCHAR(100),
    nis_baru VARCHAR(20),
    kelas_baru VARCHAR(50),
    jurusan_baru VARCHAR(50) DEFAULT NULL,
    tahun_pelajaran_baru VARCHAR(9) DEFAULT NULL,
    grha_baru VARCHAR(50),
    nama_lama VARCHAR(100),
    nis_lama VARCHAR(20),
    kelas_lama VARCHAR(50),
    jurusan_lama VARCHAR(50) DEFAULT NULL,
    tahun_pelajaran_lama VARCHAR(9) DEFAULT NULL,
    grha_lama VARCHAR(50),
    requested_by INTEGER NOT NULL,
    pembina_status TEXT DEFAULT 'pending' CHECK (pembina_status IN ('pending', 'approved', 'rejected')),
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    pembina_notes TEXT,
    superadmin_notes TEXT,
    pembina_approved_at TIMESTAMP NULL,
    superadmin_approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Student Creation Approvals Table
DROP TABLE IF EXISTS student_creation_approvals CASCADE;
CREATE TABLE student_creation_approvals (
    id SERIAL PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    nis VARCHAR(20) NOT NULL,
    kelas VARCHAR(50) NOT NULL,
    grha VARCHAR(50),
    jurusan VARCHAR(50) DEFAULT NULL,
    tahun_pelajaran VARCHAR(9) DEFAULT NULL,
    password VARCHAR(255) NOT NULL,
    requested_by INTEGER NOT NULL,
    superadmin_status TEXT DEFAULT 'pending' CHECK (superadmin_status IN ('pending', 'approved', 'rejected')),
    superadmin_notes TEXT,
    superadmin_approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Password Reset Requests Table
-- Self-service reset request from a logged-in user; superadmin grants by
-- setting a temporary password (must_change_credentials = TRUE) or rejects.
DROP TABLE IF EXISTS password_reset_requests CASCADE;
CREATE TABLE password_reset_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    requested_by INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    superadmin_notes TEXT,
    superadmin_approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ==================== NOTIFICATIONS TABLE ====================

-- Notifications Table
DROP TABLE IF EXISTS notifications CASCADE;
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    related_id INTEGER,
    related_type TEXT NOT NULL CHECK (related_type IN ('prestasi', 'event', 'organisasi', 'kepanitiaan', 'siswa', 'student_creation', 'biodata', 'input_access', 'wali_kelas', 'pelanggaran', 'perilaku', 'password_reset')),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ==================== SCHOOL CONFIGURATION TABLE ====================

-- School Configuration Table
DROP TABLE IF EXISTS school_config CASCADE;
CREATE TABLE school_config (
    id SERIAL PRIMARY KEY,
    school_name VARCHAR(255) DEFAULT 'SMK Negeri Bali Mandara',
    school_description VARCHAR(255) DEFAULT 'Mandara Talenta (Manajemen dan Pengembangan Karakter Talenta) • Panel Admin',
    principal_name VARCHAR(255) DEFAULT 'Nama Kepala Sekolah',
    principal_nip VARCHAR(50) DEFAULT '',
    logo_url VARCHAR(255) DEFAULT NULL,
    support_link VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_school_config_updated BEFORE UPDATE ON school_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==================== INPUT ACCESS CONTROL TABLES ====================

-- Input Access Control Table
DROP TABLE IF EXISTS input_access_control CASCADE;
CREATE TABLE input_access_control (
    id SERIAL PRIMARY KEY,
    control_type TEXT NOT NULL CHECK (control_type IN ('global', 'role')),
    role_target TEXT DEFAULT 'all' CHECK (role_target IN ('siswa', 'guru', 'pegawai', 'all')),
    jenis_input TEXT NOT NULL CHECK (jenis_input IN ('prestasi', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran', 'perilaku', 'all')),
    is_enabled BOOLEAN DEFAULT TRUE,
    updated_by INTEGER NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_access_control UNIQUE (control_type, role_target, jenis_input)
);
CREATE TRIGGER trg_input_access_control_updated BEFORE UPDATE ON input_access_control
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Input Access Logs Table
DROP TABLE IF EXISTS input_access_logs CASCADE;
CREATE TABLE input_access_logs (
    id SERIAL PRIMARY KEY,
    control_type TEXT NOT NULL CHECK (control_type IN ('global', 'role', 'individual')),
    target_role TEXT DEFAULT NULL CHECK (target_role IN ('siswa', 'guru', 'pegawai', 'all')),
    target_user_id INTEGER DEFAULT NULL,
    jenis_input VARCHAR(50) NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('enabled', 'disabled')),
    performed_by INTEGER NOT NULL,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==================== INDEXES ====================

-- Indexes for Prestasi Approvals
CREATE INDEX idx_prestasi_user ON prestasi_approvals(user_id);
CREATE INDEX idx_prestasi_status ON prestasi_approvals(pembina_status, superadmin_status);
CREATE INDEX IF NOT EXISTS idx_prestasi_approvals_grup ON prestasi_approvals(grup_lomba);

-- Indexes for Prestasi (pembina leaderboard joins/filters on pembina_id)
CREATE INDEX IF NOT EXISTS idx_prestasi_pembina ON prestasi(pembina_id);

-- Indexes for Event Approvals
CREATE INDEX idx_event_user ON event_approvals(user_id);
CREATE INDEX idx_event_status ON event_approvals(pembina_status, superadmin_status);

-- Indexes for Organisasi Approvals
CREATE INDEX idx_organisasi_user ON organisasi_approvals(user_id);
CREATE INDEX idx_organisasi_status ON organisasi_approvals(pembina_status, superadmin_status);

-- Indexes for Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, is_read);

-- Indexes for Academic Year System
CREATE INDEX idx_is_graduated ON users(is_graduated);
CREATE INDEX idx_tahun_pelajaran ON users(tahun_pelajaran);
CREATE INDEX idx_jurusan ON users(jurusan);

-- ==================== DEFAULT DATA ====================

-- Insert Superadmin Account
-- Note: replace the placeholder hash with a real bcrypt hash of your password:
--   node -e "console.log(require('bcryptjs').hashSync('admin123', 10))"
INSERT INTO users (nama, nis, password, role, ipt_total, ipt_awal) VALUES
('Super Admin', 'ADMIN001', '$2a$10$YourHashedPasswordHere', 'superadmin', 0, 0);

-- Insert default values for input access control (semua input diaktifkan secara default)
INSERT INTO input_access_control (control_type, role_target, jenis_input, is_enabled, updated_by) VALUES
('global', 'all', 'prestasi', TRUE, 1),
('global', 'all', 'organisasi', TRUE, 1),
('global', 'all', 'kepanitiaan', TRUE, 1),
('global', 'all', 'event', TRUE, 1),
('global', 'all', 'pelanggaran', TRUE, 1),
('global', 'all', 'perilaku', TRUE, 1);

-- ==================== DEFAULT IPT POINT CONFIGURATION ====================
-- Matches KonfigurasiIPT reset-defaults / ipt_config_schema.sql

INSERT INTO ipt_pelanggaran_level (name, point_value, description, is_active) VALUES
('ringan', -1, 'Point untuk pelanggaran ringan', TRUE),
('sedang', -5, 'Point untuk pelanggaran sedang', TRUE),
('berat', -25, 'Point untuk pelanggaran berat', TRUE);

INSERT INTO ipt_config (category, field1, field2, field3, point_value, description) VALUES
-- PRESTASI (field1=tingkat, field2=juara)
('prestasi', 'sekolah', 'juara_i', NULL, 5, 'Juara I tingkat sekolah'),
('prestasi', 'sekolah', 'juara_ii', NULL, 4, 'Juara II tingkat sekolah'),
('prestasi', 'sekolah', 'juara_iii', NULL, 3, 'Juara III tingkat sekolah'),
('prestasi', 'sekolah', 'harapan_i', NULL, 2, 'Harapan I tingkat sekolah'),
('prestasi', 'sekolah', 'harapan_ii', NULL, 2, 'Harapan II tingkat sekolah'),
('prestasi', 'sekolah', 'harapan_iii', NULL, 1, 'Harapan III tingkat sekolah'),
('prestasi', 'sekolah', 'finalis', NULL, 1, 'Finalis tingkat sekolah'),
('prestasi', 'sekolah', 'peserta', NULL, 1, 'Peserta tingkat sekolah'),
('prestasi', 'kecamatan', 'juara_i', NULL, 8, 'Juara I tingkat kecamatan'),
('prestasi', 'kecamatan', 'juara_ii', NULL, 7, 'Juara II tingkat kecamatan'),
('prestasi', 'kecamatan', 'juara_iii', NULL, 6, 'Juara III tingkat kecamatan'),
('prestasi', 'kecamatan', 'harapan_i', NULL, 5, 'Harapan I tingkat kecamatan'),
('prestasi', 'kecamatan', 'harapan_ii', NULL, 4, 'Harapan II tingkat kecamatan'),
('prestasi', 'kecamatan', 'harapan_iii', NULL, 3, 'Harapan III tingkat kecamatan'),
('prestasi', 'kecamatan', 'finalis', NULL, 2, 'Finalis tingkat kecamatan'),
('prestasi', 'kecamatan', 'peserta', NULL, 1, 'Peserta tingkat kecamatan'),
('prestasi', 'kabupaten', 'juara_i', NULL, 12, 'Juara I tingkat kabupaten'),
('prestasi', 'kabupaten', 'juara_ii', NULL, 10, 'Juara II tingkat kabupaten'),
('prestasi', 'kabupaten', 'juara_iii', NULL, 8, 'Juara III tingkat kabupaten'),
('prestasi', 'kabupaten', 'harapan_i', NULL, 7, 'Harapan I tingkat kabupaten'),
('prestasi', 'kabupaten', 'harapan_ii', NULL, 6, 'Harapan II tingkat kabupaten'),
('prestasi', 'kabupaten', 'harapan_iii', NULL, 5, 'Harapan III tingkat kabupaten'),
('prestasi', 'kabupaten', 'finalis', NULL, 4, 'Finalis tingkat kabupaten'),
('prestasi', 'kabupaten', 'peserta', NULL, 3, 'Peserta tingkat kabupaten'),
('prestasi', 'provinsi', 'juara_i', NULL, 30, 'Juara I tingkat provinsi'),
('prestasi', 'provinsi', 'juara_ii', NULL, 25, 'Juara II tingkat provinsi'),
('prestasi', 'provinsi', 'juara_iii', NULL, 20, 'Juara III tingkat provinsi'),
('prestasi', 'provinsi', 'harapan_i', NULL, 15, 'Harapan I tingkat provinsi'),
('prestasi', 'provinsi', 'harapan_ii', NULL, 12, 'Harapan II tingkat provinsi'),
('prestasi', 'provinsi', 'harapan_iii', NULL, 10, 'Harapan III tingkat provinsi'),
('prestasi', 'provinsi', 'finalis', NULL, 8, 'Finalis tingkat provinsi'),
('prestasi', 'provinsi', 'peserta', NULL, 5, 'Peserta tingkat provinsi'),
('prestasi', 'nasional', 'juara_i', NULL, 40, 'Juara I tingkat nasional'),
('prestasi', 'nasional', 'juara_ii', NULL, 35, 'Juara II tingkat nasional'),
('prestasi', 'nasional', 'juara_iii', NULL, 30, 'Juara III tingkat nasional'),
('prestasi', 'nasional', 'harapan_i', NULL, 25, 'Harapan I tingkat nasional'),
('prestasi', 'nasional', 'harapan_ii', NULL, 20, 'Harapan II tingkat nasional'),
('prestasi', 'nasional', 'harapan_iii', NULL, 15, 'Harapan III tingkat nasional'),
('prestasi', 'nasional', 'finalis', NULL, 15, 'Finalis tingkat nasional'),
('prestasi', 'nasional', 'peserta', NULL, 10, 'Peserta tingkat nasional'),
('prestasi', 'internasional', 'juara_i', NULL, 50, 'Juara I tingkat internasional'),
('prestasi', 'internasional', 'juara_ii', NULL, 45, 'Juara II tingkat internasional'),
('prestasi', 'internasional', 'juara_iii', NULL, 40, 'Juara III tingkat internasional'),
('prestasi', 'internasional', 'harapan_i', NULL, 35, 'Harapan I tingkat internasional'),
('prestasi', 'internasional', 'harapan_ii', NULL, 30, 'Harapan II tingkat internasional'),
('prestasi', 'internasional', 'harapan_iii', NULL, 25, 'Harapan III tingkat internasional'),
('prestasi', 'internasional', 'finalis', NULL, 20, 'Finalis tingkat internasional'),
('prestasi', 'internasional', 'peserta', NULL, 15, 'Peserta tingkat internasional'),
-- PERILAKU (satu tingkat penilaian berlaku untuk semua karakter; tingkat di field1)
('perilaku', 'sangat baik', NULL, NULL, 4, 'Penilaian sangat baik (semua karakter)'),
('perilaku', 'baik', NULL, NULL, 3, 'Penilaian baik (semua karakter)'),
('perilaku', 'cukup baik', NULL, NULL, 2, 'Penilaian cukup baik (semua karakter)'),
('perilaku', 'kurang baik', NULL, NULL, 1, 'Penilaian kurang baik (semua karakter)'),
-- KEPANITIAAN
('kepanitiaan', 'ketua', NULL, NULL, 5, 'Ketua kepanitiaan'),
('kepanitiaan', 'wakil ketua', NULL, NULL, 4, 'Wakil ketua kepanitiaan'),
('kepanitiaan', 'sekretaris', NULL, NULL, 4, 'Sekretaris kepanitiaan'),
('kepanitiaan', 'bendahara', NULL, NULL, 3, 'Bendahara kepanitiaan'),
('kepanitiaan', 'koordinator', NULL, NULL, 2, 'Koordinator kepanitiaan'),
('kepanitiaan', 'anggota', NULL, NULL, 1, 'Anggota kepanitiaan'),
-- ORGANISASI
('organisasi', 'OSIS', 'ketua', NULL, 5, 'Ketua OSIS'),
('organisasi', 'OSIS', 'wakil ketua', NULL, 4, 'Wakil ketua OSIS'),
('organisasi', 'OSIS', 'sekretaris', NULL, 4, 'Sekretaris OSIS'),
('organisasi', 'OSIS', 'bendahara', NULL, 3, 'Bendahara OSIS'),
('organisasi', 'OSIS', 'koordinator', NULL, 2, 'Koordinator OSIS'),
('organisasi', 'OSIS', 'anggota', NULL, 1, 'Anggota OSIS'),
('organisasi', 'KY', 'ketua', NULL, 5, 'Ketua KY'),
('organisasi', 'KY', 'wakil ketua', NULL, 4, 'Wakil ketua KY'),
('organisasi', 'KY', 'sekretaris', NULL, 4, 'Sekretaris KY'),
('organisasi', 'KY', 'bendahara', NULL, 3, 'Bendahara KY'),
('organisasi', 'KY', 'koordinator', NULL, 2, 'Koordinator KY'),
('organisasi', 'KY', 'anggota', NULL, 1, 'Anggota KY'),
('organisasi', 'MPK', 'ketua', NULL, 5, 'Ketua MPK'),
('organisasi', 'MPK', 'wakil ketua', NULL, 4, 'Wakil ketua MPK'),
('organisasi', 'MPK', 'sekretaris', NULL, 4, 'Sekretaris MPK'),
('organisasi', 'MPK', 'bendahara', NULL, 3, 'Bendahara MPK'),
('organisasi', 'MPK', 'koordinator', NULL, 2, 'Koordinator MPK'),
('organisasi', 'MPK', 'anggota', NULL, 1, 'Anggota MPK'),
('organisasi', 'PRAMUKA', 'ketua', NULL, 5, 'Ketua PRAMUKA'),
('organisasi', 'PRAMUKA', 'wakil ketua', NULL, 4, 'Wakil ketua PRAMUKA'),
('organisasi', 'PRAMUKA', 'sekretaris', NULL, 4, 'Sekretaris PRAMUKA'),
('organisasi', 'PRAMUKA', 'bendahara', NULL, 3, 'Bendahara PRAMUKA'),
('organisasi', 'PRAMUKA', 'koordinator', NULL, 2, 'Koordinator PRAMUKA'),
('organisasi', 'PRAMUKA', 'anggota', NULL, 1, 'Anggota PRAMUKA'),
('organisasi', 'PKS', 'ketua', NULL, 5, 'Ketua PKS'),
('organisasi', 'PKS', 'wakil ketua', NULL, 4, 'Wakil ketua PKS'),
('organisasi', 'PKS', 'sekretaris', NULL, 4, 'Sekretaris PKS'),
('organisasi', 'PKS', 'bendahara', NULL, 3, 'Bendahara PKS'),
('organisasi', 'PKS', 'koordinator', NULL, 2, 'Koordinator PKS'),
('organisasi', 'PKS', 'anggota', NULL, 1, 'Anggota PKS'),
('organisasi', 'PMR', 'ketua', NULL, 5, 'Ketua PMR'),
('organisasi', 'PMR', 'wakil ketua', NULL, 4, 'Wakil ketua PMR'),
('organisasi', 'PMR', 'sekretaris', NULL, 4, 'Sekretaris PMR'),
('organisasi', 'PMR', 'bendahara', NULL, 3, 'Bendahara PMR'),
('organisasi', 'PMR', 'koordinator', NULL, 2, 'Koordinator PMR'),
('organisasi', 'PMR', 'anggota', NULL, 1, 'Anggota PMR'),
('organisasi', 'PASKIBRA', 'ketua', NULL, 5, 'Ketua PASKIBRA'),
('organisasi', 'PASKIBRA', 'wakil ketua', NULL, 4, 'Wakil ketua PASKIBRA'),
('organisasi', 'PASKIBRA', 'sekretaris', NULL, 4, 'Sekretaris PASKIBRA'),
('organisasi', 'PASKIBRA', 'bendahara', NULL, 3, 'Bendahara PASKIBRA'),
('organisasi', 'PASKIBRA', 'koordinator', NULL, 2, 'Koordinator PASKIBRA'),
('organisasi', 'PASKIBRA', 'anggota', NULL, 1, 'Anggota PASKIBRA'),
('organisasi', 'SLT', 'ketua', NULL, 5, 'Ketua SLT'),
('organisasi', 'SLT', 'wakil ketua', NULL, 4, 'Wakil ketua SLT'),
('organisasi', 'SLT', 'sekretaris', NULL, 4, 'Sekretaris SLT'),
('organisasi', 'SLT', 'bendahara', NULL, 3, 'Bendahara SLT'),
('organisasi', 'SLT', 'koordinator', NULL, 2, 'Koordinator SLT'),
('organisasi', 'SLT', 'anggota', NULL, 1, 'Anggota SLT'),
-- EVENT
('event', 'sekolah', NULL, NULL, 2, 'Event tingkat sekolah'),
('event', 'kecamatan', NULL, NULL, 4, 'Event tingkat kecamatan'),
('event', 'kabupaten', NULL, NULL, 6, 'Event tingkat kabupaten'),
('event', 'provinsi', NULL, NULL, 8, 'Event tingkat provinsi'),
('event', 'nasional', NULL, NULL, 10, 'Event tingkat nasional'),
('event', 'internasional', NULL, NULL, 12, 'Event tingkat internasional'),
-- PENGATURAN (bukan poin: field1 = nama pengaturan, point_value = nilainya; 0 = nonaktif)
('pengaturan', 'min_ipt', NULL, NULL, 0, 'Batas minimum Total IPT - total di bawah nilai ini ditampilkan merah (0 = nonaktif)');

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
