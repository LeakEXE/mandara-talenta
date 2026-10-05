// Full data reset: wipes every IPT record, approval queue, log, notification
// and wali-kelas assignment, plus their evidence files — everything EXCEPT
// users/permissions and all configurations (IPT points, school, access).
// Student totals are reset to their ipt_awal (otherwise phantom points
// from the wiped records would remain).
//
// Wiped tables (19): prestasi, organisasi, kepanitiaan, event, pelanggaran,
//   perilaku, prestasi/event/organisasi/kepanitiaan/siswa/biodata_update/
//   student_creation approvals, password_reset_requests, activity_logs,
//   ipt_history, input_access_logs, notifications, wali_kelas_assignment.
// Kept: users, permissions, approval_scopes, ipt_config (+organisasi,
//   perilaku, pelanggaran tables), school_config, input_access_control.
// Emptied upload folders: prestasi, event, organisasi, kepanitiaan,
//   pelanggaran, perilaku, approvals, approved/. Kept: avatars/, logos/.
//
// Usage:
//   cd backend && node scripts/resetAllRecords.js [--yes] [--dry-run]
//
//   Without --yes (or with --dry-run) only a per-table/per-folder preview
//   is printed and nothing is touched.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../config/database');
const { UPLOAD_DIR } = require('../utils/paths');

const WIPE_TABLES = [
    'prestasi',
    'organisasi',
    'kepanitiaan',
    'event',
    'pelanggaran',
    'perilaku',
    'prestasi_approvals',
    'event_approvals',
    'organisasi_approvals',
    'kepanitiaan_approvals',
    'siswa_approvals',
    'biodata_update_approvals',
    'student_creation_approvals',
    'password_reset_requests',
    'activity_logs',
    'ipt_history',
    'input_access_logs',
    'notifications',
    'wali_kelas_assignment',
];

// Evidence folders emptied (contents only, folders themselves stay).
// avatars/ (users) and logos/ (school_config) are always kept.
const EVIDENCE_FOLDERS = [
    'prestasi',
    'event',
    'organisasi',
    'kepanitiaan',
    'pelanggaran',
    'perilaku',
    'approvals',
    'approved',
];

function parseArgs(argv) {
    const opts = { yes: false, dryRun: false };
    for (const a of argv) {
        if (a === '--yes') opts.yes = true;
        else if (a === '--dry-run') opts.dryRun = true;
    }
    return opts;
}

function countFilesRecursive(dir) {
    let count = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) count += countFilesRecursive(full);
        else if (entry.isFile()) count += 1;
    }
    return count;
}

function emptyFolder(dir) {
    let removed = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return { removed, missing: true };
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        try {
            if (entry.isDirectory()) {
                removed += countFilesRecursive(full);
                fs.rmSync(full, { recursive: true, force: true });
            } else if (entry.isFile()) {
                fs.rmSync(full, { force: true });
                removed += 1;
            }
        } catch (err) {
            throw new Error(`gagal menghapus ${full}: ${err.message}`);
        }
    }
    return { removed, missing: false };
}

async function tableCounts(queryFn) {
    const counts = {};
    for (const table of WIPE_TABLES) {
        // Table names are hardcoded constants above, never user input.
        // eslint-disable-next-line no-await-in-loop
        const [rows] = await queryFn(`SELECT COUNT(*) AS total FROM ${table}`);
        counts[table] = Number(rows[0]?.total) || 0;
    }
    return counts;
}

async function main(argv) {
    const opts = parseArgs(argv || process.argv.slice(2));
    const apply = opts.yes && !opts.dryRun;

    const counts = await tableCounts(db.query);
    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Record/log/notification rows to wipe: ${totalRows}${apply ? '' : ' (preview — pass --yes to apply)'}`);
    for (const table of WIPE_TABLES) {
        console.log(`  ${table}: ${counts[table]}`);
    }

    const fileCounts = {};
    let totalFiles = 0;
    for (const folder of EVIDENCE_FOLDERS) {
        fileCounts[folder] = countFilesRecursive(path.join(UPLOAD_DIR, folder));
        totalFiles += fileCounts[folder];
        console.log(`  uploads/${folder}/: ${fileCounts[folder]} file(s)`);
    }
    console.log(`Evidence files to delete: ${totalFiles} (avatars/ and logos/ kept)`);

    const [userRows] = await db.query('SELECT COUNT(*) AS total FROM users');
    console.log(`User accounts kept: ${userRows[0]?.total || 0} (ipt_total reset to ipt_awal)`);

    if (!apply) {
        console.log('Dry run — nothing was touched. Re-run with --yes to apply.');
        return { applied: false };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        // One multi-table TRUNCATE: safe without CASCADE because no kept
        // table holds a foreign key INTO any wiped table (all FKs point at
        // users/configs, which stay). RESTART IDENTITY restarts IDs from 1.
        await conn.query(`TRUNCATE ${WIPE_TABLES.join(', ')} RESTART IDENTITY`);
        // Totals must follow the wiped records, or phantom points remain.
        await conn.query('UPDATE users SET ipt_total = ipt_awal');
        // Audit trail for the reset itself (activity_logs was just emptied).
        const [admins] = await conn.query("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
        if (admins.length > 0) {
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [admins[0].id, 'RESET_ALL_RECORDS', `Reset massal: ${totalRows} baris record/log/notifikasi dihapus, ${totalFiles} file bukti dihapus, ipt_total dikembalikan ke ipt_awal`]
            );
        }
        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        throw error;
    } finally {
        conn.release();
    }
    console.log('Database reset committed.');

    // Filesystem has no rollback — runs only after the DB commit succeeded.
    let removedFiles = 0;
    for (const folder of EVIDENCE_FOLDERS) {
        // eslint-disable-next-line no-await-in-loop
        const { removed } = emptyFolder(path.join(UPLOAD_DIR, folder));
        removedFiles += removed;
    }
    console.log(`Done. Wiped ${totalRows} row(s) + ${removedFiles} evidence file(s); users, permissions and all configurations kept.`);
    return { applied: true, totalRows, removedFiles };
}

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error('Reset failed:', err.message);
            process.exit(1);
        }
    );
}

module.exports = { parseArgs, tableCounts, countFilesRecursive, emptyFolder, main, WIPE_TABLES, EVIDENCE_FOLDERS };
