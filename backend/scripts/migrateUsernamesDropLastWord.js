// Data migration: apply the "drop last word" username rule to existing rows.
// Base rule (see slugFromName in utils/username.js): the auto username is the
// letter-only slug of `nama` minus the LAST word, e.g.
// "I Komang Sumawa Adi Putra" -> "ikomangsumawaadi".
//
// What it does:
// - Recomputes every non-superadmin username via generateUsername() (same
//   generator used for new accounts) and updates rows whose stored username
//   differs, e.g. old 20-char truncation "ikomangsumawaadiput" becomes
//   "ikomangsumawaadi". Rows already matching are left untouched.
// - Superadmin rows are NEVER touched (renaming ADMIN001 would lock you out).
// - Writes an audit CSV (id,nama,old_username,new_username) under logs/ so
//   superadmin can inform affected users of their new login name.
//
// WARNING: this cannot tell auto-generated names apart from user-chosen
// custom names — a custom name that differs from the recomputed one WILL be
// renamed. Always review the --dry-run output first.
//
// Usage:
//   cd backend && node scripts/migrateUsernamesDropLastWord.js [--dry-run] [--force-setup] [--limit=N]
//
//   --dry-run     Print what WOULD change without updating any rows.
//   --force-setup Also set must_change_credentials = TRUE for renamed rows,
//                 forcing them through /setup-akun where they see the new
//                 username. By default the flag is left untouched.
//   --limit=N     Only process the first N matching rows (for batched runs).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../config/database');
const { generateUsername, GENERATED_USERNAME_RE } = require('../utils/username');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE_SETUP = args.includes('--force-setup');
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
        let sql = `SELECT id, nama, nis, nip, username FROM users
               WHERE role <> 'superadmin'
               ORDER BY id`;
        if (LIMIT !== null) sql += ` LIMIT ${LIMIT}`;
        const [rows] = await db.query(sql);
        console.log(`Found ${rows.length} user(s) (superadmin excluded)${DRY_RUN ? ' (dry run)' : ''}`);

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
            const csvPath = path.join(logsDir, `username-drop-last-word-${DRY_RUN ? 'dryrun-' : ''}${stamp}.csv`);
            const csv = ['id,nama,old_username,new_username']
                .concat(mappings.map((m) => [m.id, csvEscape(m.nama), csvEscape(m.oldUsername), csvEscape(m.newUsername)].join(',')))
                .join('\n');
            fs.writeFileSync(csvPath, csv);
            console.log(`Audit CSV written to ${csvPath}`);
        }

        if (DRY_RUN) {
            console.log('Dry run — no rows were updated. Re-run without --dry-run to apply.');
        } else {
            console.log(`Done. Migrated ${mappings.length} username(s) to the drop-last-word form.`);
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
