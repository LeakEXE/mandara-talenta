// Bulk password reset: set one temporary password for every non-superadmin
// account and force each of them through /setup-akun on next login
// (must_change_credentials = TRUE), where they must set their own password.
// The temp password is never written to disk or logs — distribute it yourself.
//
// Usage:
//   cd backend && node scripts/resetAllPasswords.js --password=<temp> [--dry-run] [--limit=N]
//
//   --password=<temp>  REQUIRED. Temporary password (min 6 chars, matching the
//                      app's own minimum). Everyone gets the same one.
//   --dry-run          List who WOULD be affected without updating any rows.
//   --limit=N          Only process the first N matching rows (batched runs).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
let PASSWORD = null;
let LIMIT = null;
for (const a of args) {
    let m = /^--password=(.+)$/.exec(a);
    if (m) PASSWORD = m[1];
    m = /^--limit=(\d+)$/.exec(a);
    if (m) LIMIT = Math.max(1, parseInt(m[1], 10));
}

function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

(async () => {
    try {
        if (!PASSWORD || PASSWORD.length < 6) {
            console.error('Refusing: pass --password=<temp> with at least 6 characters.');
            process.exit(2);
        }

        let sql = `SELECT id, nama, username, role FROM users
               WHERE role <> 'superadmin'
               ORDER BY id`;
        if (LIMIT !== null) sql += ` LIMIT ${LIMIT}`;
        const [rows] = await db.query(sql);
        console.log(`Found ${rows.length} non-superadmin user(s)${DRY_RUN ? ' (dry run)' : ''}`);

        const hashed = bcrypt.hashSync(PASSWORD, 10);
        let updated = 0;
        for (const row of rows) {
            if (!DRY_RUN) {
                // eslint-disable-next-line no-await-in-loop
                await db.query(
                    'UPDATE users SET password = ?, must_change_credentials = TRUE WHERE id = ?',
                    [hashed, row.id]
                );
            }
            updated += 1;
            console.log(`  id=${row.id} ${row.role} "${row.username}" (${row.nama})`);
        }

        if (rows.length > 0) {
            const logsDir = path.join(__dirname, '..', '..', 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const csvPath = path.join(logsDir, `password-reset-all-${DRY_RUN ? 'dryrun-' : ''}${stamp}.csv`);
            const csv = ['id,nama,username,role']
                .concat(rows.map((r) => [r.id, csvEscape(r.nama), csvEscape(r.username), r.role].join(',')))
                .join('\n');
            fs.writeFileSync(csvPath, csv);
            console.log(`Audit CSV written to ${csvPath} (usernames only — the temp password is NOT recorded)`);
        }

        if (DRY_RUN) {
            console.log('Dry run — no passwords were changed. Re-run without --dry-run to apply.');
        } else {
            console.log(`Done. Reset ${updated} password(s). Tell users the temp password; they will be forced to change it at next login.`);
        }
        try {
            if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
        } catch (_) { /* ignore pool shutdown errors */ }
        process.exit(0);
    } catch (err) {
        console.error('Reset failed:', err.message);
        try {
            if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
        } catch (_) { /* ignore */ }
        process.exit(1);
    }
})();
