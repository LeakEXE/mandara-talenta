// Bulk password reset for staff accounts (guru/pegawai).
// Sets one shared temporary password + optionally forces /setup-akun on next
// login same outcome as PUT /users/:id/reset-password, but for every staff
// account at once. Superadmin and siswa accounts are never touched.
//
// Usage:
//   cd backend && node scripts/bulkResetStaffPasswords.js --password=<new> [--role=guru|pegawai] [--yes] [--dry-run] [--no-force-setup] [--limit=N]
//
//   --password=<new>  Required. Temporary password, 6-72 chars (bcrypt limit).
//   --role=<r>        Only 'guru' or only 'pegawai'. Default: both.
//   --yes             Required to actually apply. Without it (or with
//                     --dry-run) the script only previews the affected rows.
//   --no-force-setup  Leave must_change_credentials untouched. By default it
//                     is set TRUE so staff must replace the temp password at
//                     next login.
//   --limit=N         Only process the first N matching rows.
//   --dry-run         Preview without writing. Implied when --yes is absent.
//
// Distribute the password to staff yourself afterwards it is never written
// to logs or disk by this script.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('../config/database');

function parseArgs(argv) {
    const opts = { role: null, dryRun: false, yes: false, forceSetup: true, limit: null, password: null };
    for (const a of argv) {
        if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--yes') opts.yes = true;
        else if (a === '--no-force-setup') opts.forceSetup = false;
        else if (a.startsWith('--role=')) opts.role = a.slice('--role='.length);
        else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
        else if (/^--limit=\d+$/.test(a)) opts.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10));
    }
    return opts;
}

function validateOptions(opts) {
    if (opts.role !== null && opts.role !== 'guru' && opts.role !== 'pegawai') {
        throw new Error("--role must be 'guru' or 'pegawai'");
    }
    if (typeof opts.password !== 'string' || opts.password.length < 6) {
        throw new Error('--password is required (minimal 6 karakter)');
    }
    if (opts.password.length > 72) {
        throw new Error('--password maksimal 72 karakter (batas bcrypt)');
    }
}

async function main(argv) {
    const opts = parseArgs(argv || process.argv.slice(2));
    validateOptions(opts);
    const apply = opts.yes && !opts.dryRun;

    const roles = opts.role ? [opts.role] : ['guru', 'pegawai'];
    let sql = `SELECT id, nama, nip, role FROM users WHERE role IN (${roles.map(() => '?').join(', ')}) ORDER BY id`;
    if (opts.limit !== null) sql += ` LIMIT ${opts.limit}`;
    const [rows] = await db.query(sql, roles);
    console.log(`Found ${rows.length} staff account(s) [${roles.join(', ')}]${apply ? '' : ' (preview - pass --yes to apply)'}`);
    for (const row of rows) {
        console.log(`  id=${row.id} nama=${row.nama} nip=${row.nip || '-'} role=${row.role}`);
    }
    if (rows.length === 0 || !apply) {
        if (rows.length > 0 && !apply) console.log('Dry run - no rows were updated. Re-run with --yes to apply.');
        return { applied: 0, total: rows.length };
    }

    const hashedPassword = bcrypt.hashSync(opts.password, 10);
    let applied = 0;
    for (const row of rows) {
        // Role guard repeated in the WHERE clause: superadmin/siswa rows can
        // never be touched even if the SELECT above were ever widened.
        // eslint-disable-next-line no-await-in-loop
        const [result] = await db.query(
            opts.forceSetup
                ? 'UPDATE users SET password = ?, must_change_credentials = TRUE WHERE id = ? AND role IN (?, ?)'
                : 'UPDATE users SET password = ? WHERE id = ? AND role IN (?, ?)',
            [hashedPassword, row.id, 'guru', 'pegawai']
        );
        if (result.affectedRows === 0) {
            console.log(`  id=${row.id} SKIPPED (role changed mid-run?)`);
            continue;
        }
        // Auto-resolve pending reset requests, like the single reset endpoint.
        // eslint-disable-next-line no-await-in-loop
        await db.query(
            "UPDATE password_reset_requests SET status = 'rejected', superadmin_notes = 'Digantikan oleh reset massal' WHERE user_id = ? AND status = 'pending'",
            [row.id]
        );
        applied++;
    }

    // Audit trail under the first superadmin account (activity_logs.user_id
    // is a FK, so a real id is required); skip quietly if none exists.
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
    if (admins.length > 0) {
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [admins[0].id, 'BULK_RESET_STAFF_PASSWORDS', `Reset password massal untuk ${applied} akun (${roles.join('/')})${opts.forceSetup ? ', wajib ganti saat login berikutnya' : ''}`]
        );
    }

    console.log(`Done. Reset password for ${applied}/${rows.length} account(s). Distribute the new password to staff yourself - it was not written anywhere.`);
    return { applied, total: rows.length };
}

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error('Bulk reset failed:', err.message);
            process.exit(1);
        }
    );
}

module.exports = { parseArgs, validateOptions, main };
