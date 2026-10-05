// Data migration: normalize pelanggaran.foto to the canonical full relative
// shape ('uploads/pelanggaran/f' or 'uploads/approved/pelanggaran/f').
//
// Background: the type-route submit/update used to store bare filenames
// ('abc.jpg'), which break viewers that concatenate the URL directly, and
// the approve photo-move silently skipped full-path values. The code paths
// are fixed; this repairs rows written before the fix.
//
// What it does per row with a non-empty foto:
// - bare name (no slashes): probes disk for uploads/pelanggaran/<f>, then
//   uploads/approved/pelanggaran/<f>; rewrites to whichever exists.
//   If neither exists the row is reported UNRESOLVED and left untouched.
// - leading slashes/backslashes: pure string normalization (same file).
// - already canonical: skipped.
//
// Usage:
//   cd backend && node scripts/normalizePelanggaranFoto.js [--dry-run]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../config/database');
const { resolveUploadPath } = require('../utils/paths');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function canonicalize(foto) {
    const orig = String(foto || '').trim();
    if (!orig) return null;
    const s = orig.replace(/\\/g, '/');
    const noLead = s.replace(/^\/+/, '');
    if (!noLead) return null;
    // Same file on disk either way (resolveUploadPath treats both
    // identically): pure string normalization, always safe.
    if (s !== noLead || /\\/.test(orig)) return { kind: 'slashes', target: noLead };
    if (!noLead.includes('/')) return { kind: 'bare', name: noLead };
    if (noLead.toLowerCase().startsWith('uploads/')) return { kind: 'canonical' };
    return { kind: 'unknown' };
}

async function main() {
    try {
        const [rows] = await db.query(
            "SELECT id, foto FROM pelanggaran WHERE foto IS NOT NULL AND foto <> '' ORDER BY id"
        );
        console.log(`Found ${rows.length} pelanggaran row(s) with foto${DRY_RUN ? ' (dry run)' : ''}`);

        let fixed = 0;
        let skipped = 0;
        let unresolved = 0;
        for (const row of rows) {
            const c = canonicalize(row.foto);
            if (!c || c.kind === 'canonical') {
                skipped++;
                continue;
            }
            if (c.kind === 'unknown') {
                console.log(`  id=${row.id} SKIPPED (unrecognized shape "${row.foto}")`);
                unresolved++;
                continue;
            }
            if (c.kind === 'slashes') {
                console.log(`  id=${row.id} normalize slashes "${row.foto}" -> "${c.target}"`);
                if (!DRY_RUN) {
                    // eslint-disable-next-line no-await-in-loop
                    await db.query('UPDATE pelanggaran SET foto = ? WHERE id = ?', [c.target, row.id]);
                }
                fixed++;
                continue;
            }
            // bare: locate the actual file before rewriting
            const candidates = [`uploads/pelanggaran/${c.name}`, `uploads/approved/pelanggaran/${c.name}`];
            const hit = candidates.find((rel) => {
                try {
                    return fs.existsSync(resolveUploadPath(rel));
                } catch {
                    return false;
                }
            });
            if (!hit) {
                console.log(`  id=${row.id} UNRESOLVED (no file on disk for "${row.foto}")`);
                unresolved++;
                continue;
            }
            console.log(`  id=${row.id} "${row.foto}" -> "${hit}"`);
            if (!DRY_RUN) {
                // eslint-disable-next-line no-await-in-loop
                await db.query('UPDATE pelanggaran SET foto = ? WHERE id = ?', [hit, row.id]);
            }
            fixed++;
        }

        console.log(`Done. fixed=${fixed} skipped=${skipped} unresolved=${unresolved}${DRY_RUN ? ' (dry run — no rows updated)' : ''}`);
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
}

if (require.main === module) {
    main();
}

module.exports = { canonicalize };
