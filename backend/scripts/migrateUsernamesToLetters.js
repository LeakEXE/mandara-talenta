// Data migration: convert old auto-generated usernames (which had a random
// numbers/letters tail, e.g. "deanputra4821" or "deanputraqkzx") to the clean
// form: plain letters of the name, e.g. "deanputra".
//
// What it does:
// - By default finds every users row whose username is missing or NOT
//   letter-only (anything failing /^[A-Za-z]{5,20}$/: contains digits/symbols,
//   too short/long). Already letter-only usernames are left untouched -
//   unless --all is passed (see below).
// - Generates the clean username from `nama` via generateUsername() (same
//   generator used for new accounts: no random suffix; duplicates get a
//   deterministic suffix from NIS/NIP, then a,b,c... enumeration) and updates
//   the row. Uniqueness is checked against the live table.
// - Writes an audit CSV (id,nama,old_username,new_username) under logs/ so
//   superadmin can inform affected users of their new login name.
//
// Usage:
//   cd backend && node scripts/migrateUsernamesToLetters.js [--dry-run] [--force-setup] [--limit=N] [--all]
//
//   --dry-run     Print what WOULD change without updating any rows.
//   --force-setup Also set must_change_credentials = TRUE for renamed rows,
//                 forcing them through /setup-akun where they see the new
//                 username. By default the flag is left untouched.
//   --limit=N     Only process the first N matching rows (for batched runs).
//   --all         Also normalize already letter-only usernames (e.g. names
//                 that still carry a random-letter tail from the previous
//                 generator). Recomputes every username from nama+NIS/NIP.
//                 Review the --dry-run output first: user-chosen custom names
//                 will be renamed too.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../config/database');
const { generateUsername, GENERATED_USERNAME_RE } = require('../utils/username');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE_SETUP = args.includes('--force-setup');
const ALL = args.includes('--all');
let LIMIT = null;
for (const a of args) {
    const m = /^--limit=(\d+)$/.exec(a);
    if (m) LIMIT = Math.max(1, parseInt(m[1], 10));
}

function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

(async () => {
    try {
        let sql = ALL
            ? `SELECT id, nama, nis, nip, username FROM users ORDER BY id`
            : `SELECT id, nama, nis, nip, username FROM users
               WHERE username IS NULL OR username = '' OR username !~ '^[A-Za-z]{5,20}$'
               ORDER BY id`;
        if (LIMIT !== null) sql += ` LIMIT ${LIMIT}`;
        const [rows] = await db.query(sql);
        console.log(`Found ${rows.length} user(s)${ALL ? ' (all rows)' : ' with non-letter-only username'}${DRY_RUN ? ' (dry run)' : ''}`);

        const mappings = [];
        for (const row of rows) {
            const source = row.nama && String(row.nama).trim() ? row.nama : (row.username || 'user');
            // eslint-disable-next-line no-await-in-loop
            const next = await generateUsername(source, { nis: row.nis, nip: row.nip, excludeUserId: row.id });
            if (!GENERATED_USERNAME_RE.test(next)) {
                throw new Error(`Generated username failed letter-only check: ${next}`);
            }
            if (String(row.username || '').toLowerCase() === next.toLowerCase()) {
                console.log(`  id=${row.id} nama=${row.nama} "${row.username}" unchanged`);
                continue;
            }
            mappings.push({ id: row.id, nama: row.nama, oldUsername: row.username, newUsername: next });
            if (!DRY_RUN) {
                // eslint-disable-next-line no-await-in-loop
                await db.query(
                    FORCE_SETUP
                        ? 'UPDATE users SET username = ?, must_change_credentials = TRUE WHERE id = ?'
                        : 'UPDATE users SET username = ? WHERE id = ?',
                    [next, row.id]
                );
            }
            console.log(`  id=${row.id} nama=${row.nama} "${row.username}" -> "${next}"`);
        }

        if (mappings.length > 0) {
            const logsDir = path.join(__dirname, '..', '..', 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const csvPath = path.join(logsDir, `username-migration-${DRY_RUN ? 'dryrun-' : ''}${stamp}.csv`);
            const csv = ['id,nama,old_username,new_username']
                .concat(mappings.map((m) => [m.id, csvEscape(m.nama), csvEscape(m.oldUsername), csvEscape(m.newUsername)].join(',')))
                .join('\n');
            fs.writeFileSync(csvPath, csv);
            console.log(`Audit CSV written to ${csvPath}`);
        }

        if (DRY_RUN) {
            console.log('Dry run - no rows were updated. Re-run without --dry-run to apply.');
        } else {
            console.log(`Done. Migrated ${mappings.length} username(s) to letter-only.`);
            if (mappings.length > 0 && !FORCE_SETUP) {
                console.log('Note: must_change_credentials was left untouched. Re-run with --force-setup to route renamed users through /setup-akun.');
            }
        }
        try {
            if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
        } catch (_) { /* ignore pool shutdown errors */ }
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        try {
            if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
        } catch (_) { /* ignore */ }
        process.exit(1);
    }
})();
