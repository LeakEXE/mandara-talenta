// Bulk update student data from CSV, keyed by NIS.
// Only safe contact/welfare columns are writable: jenis_kelamin, desil,
// no_hp, alamat, grha. Identity, credentials, class and IPT columns are
// never touched. Unknown NIS rows are skipped (never created).
//
// Usage:
//   cd backend && node scripts/updateStudentsFromCsv.js <file.csv> [--yes] [--dry-run] [--delimiter=,|;]
//
//   --yes              Required to actually apply. Without it (or with
//                      --dry-run) only a preview is printed.
//   --delimiter=<d>    Force ',' or ';'. Default: sniffed from the header
//                      (Indonesian Excel exports use ';').
//   --dry-run          Preview without writing. Implied when --yes is absent.
//
// CSV format: header row + data rows, e.g.
//   nis,jenis_kelamin,desil,no_hp
//   1540,L,3,08123456789
// Empty cell = leave the stored value unchanged (never cleared).
// Menulis 'Tidak terdata' (atau '-') pada kolom desil = eksplisit unknown:
// menimpa nilai lama menjadi NULL.
// Accepts 'Jenis Kelamin'/'Desil'/... header aliases like KelolaAkun import.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/database');
const { normalizeGender, normalizeDesil } = require('../utils/studentFields');

// Writable columns: header aliases (lowercased, trimmed) -> users column.
const COLUMN_MAP = {
    jenis_kelamin: 'jenis_kelamin',
    'jenis kelamin': 'jenis_kelamin',
    jeniskelamin: 'jenis_kelamin',
    gender: 'jenis_kelamin',
    jk: 'jenis_kelamin',
    'l/p': 'jenis_kelamin',
    desil: 'desil',
    no_hp: 'no_hp',
    nohp: 'no_hp',
    'no hp': 'no_hp',
    'no. hp': 'no_hp',
    alamat: 'alamat',
    address: 'alamat',
    grha: 'grha',
    gra: 'grha',
};

function parseArgs(argv) {
    const opts = { file: null, yes: false, dryRun: false, delimiter: null };
    for (const a of argv) {
        if (a === '--yes') opts.yes = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a.startsWith('--delimiter=')) opts.delimiter = a.slice('--delimiter='.length);
        else if (!a.startsWith('--') && !opts.file) opts.file = a;
    }
    return opts;
}

// Minimal CSV parser: delimiter-aware, double-quote escaping, CRLF + BOM safe.
function parseCsv(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            pushField();
        } else if (ch === '\r') {
            // skip, \n ends the row
        } else if (ch === '\n') {
            pushField();
            rows.push(row);
            row = [];
        } else {
            field += ch;
        }
    }
    pushField();
    rows.push(row);
    // Drop trailing empty rows (final newline)
    while (rows.length > 0 && rows[rows.length - 1].every((c) => String(c).trim() === '')) {
        rows.pop();
    }
    return rows;
}

function sniffDelimiter(headerLine) {
    const semis = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    return semis >= commas && semis > 0 ? ';' : ',';
}

async function main(argv) {
    const opts = parseArgs(argv || process.argv.slice(2));
    if (!opts.file) {
        throw new Error('Usage: node scripts/updateStudentsFromCsv.js <file.csv> [--yes] [--dry-run] [--delimiter=,|;]');
    }
    if (opts.delimiter !== null && opts.delimiter !== ',' && opts.delimiter !== ';') {
        throw new Error('--delimiter must be "," or ";"');
    }
    const filePath = path.isAbsolute(opts.file) ? opts.file : path.join(process.cwd(), opts.file);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const apply = opts.yes && !opts.dryRun;

    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delimiter = opts.delimiter || sniffDelimiter(firstLine);
    const rows = parseCsv(text, delimiter);
    if (rows.length < 2) {
        throw new Error('CSV has no data rows (needs a header row + at least one data row)');
    }

    const headers = rows[0].map((h) => String(h).trim().toLowerCase());
    const nisIdx = headers.indexOf('nis');
    if (nisIdx < 0) {
        throw new Error("CSV must have a 'nis' header column");
    }
    const colIdx = [];
    headers.forEach((h, i) => {
        if (i !== nisIdx && COLUMN_MAP[h]) colIdx.push([i, COLUMN_MAP[h]]);
    });
    if (colIdx.length === 0) {
        throw new Error(`No writable columns found. Allowed: ${[...new Set(Object.values(COLUMN_MAP))].join(', ')} (+ 'nis' key)`);
    }

    console.log(`File: ${filePath} (delimiter '${delimiter}')${apply ? '' : ' (preview - pass --yes to apply)'}`);
    console.log(`Key: nis | columns: ${colIdx.map(([, c]) => c).join(', ')}`);

    const stats = { updated: 0, unchanged: 0, unknownNis: 0, failed: 0 };
    const updates = [];

    for (let r = 1; r < rows.length; r++) {
        const lineNo = r + 1;
        const nis = String(rows[r][nisIdx] ?? '').trim();
        if (!nis) {
            console.log(`  baris ${lineNo}: dilewati (NIS kosong)`);
            stats.failed += 1;
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const [found] = await db.query('SELECT id, nama, role FROM users WHERE nis = ?', [nis]);
        const user = found[0];
        if (!user) {
            console.log(`  baris ${lineNo}: NIS ${nis} tidak ditemukan - dilewati`);
            stats.unknownNis += 1;
            continue;
        }
        if (user.role !== 'siswa') {
            console.log(`  baris ${lineNo}: NIS ${nis} bukan siswa (${user.role}) - dilewati`);
            stats.failed += 1;
            continue;
        }

        const sets = [];
        const params = [];
        let rowError = null;
        for (const [i, col] of colIdx) {
            const raw = rows[r][i] === undefined ? '' : String(rows[r][i]).trim();
            if (raw === '') continue; // empty = leave unchanged
            // 'Tidak terdata' (atau '-') pada kolom desil = eksplisit unknown:
            // timpa nilai lama menjadi NULL (beda dengan sel kosong).
            if (col === 'desil' && /^(tidak terdata|-)$/i.test(raw)) {
                sets.push('desil = ?');
                params.push(null);
                continue;
            }
            try {
                if (col === 'jenis_kelamin') {
                    sets.push('jenis_kelamin = ?');
                    params.push(normalizeGender(raw).value);
                } else if (col === 'desil') {
                    sets.push('desil = ?');
                    params.push(normalizeDesil(raw).value);
                } else {
                    sets.push(`${col} = ?`);
                    params.push(raw);
                }
            } catch (err) {
                rowError = err.message;
                break;
            }
        }
        if (rowError) {
            console.log(`  baris ${lineNo}: NIS ${nis} (${user.nama}) - GAGAL: ${rowError}`);
            stats.failed += 1;
            continue;
        }
        if (sets.length === 0) {
            stats.unchanged += 1;
            continue;
        }
        updates.push({ nis, nama: user.nama, id: user.id, sets, params });
        console.log(`  baris ${lineNo}: NIS ${nis} (${user.nama}) -> ${sets.map((s) => s.split(' ')[0]).join(', ')}`);
    }

    console.log(`Ringkasan: ${updates.length} akan diupdate, ${stats.unchanged} tanpa perubahan, ${stats.unknownNis} NIS tak dikenal, ${stats.failed} gagal`);
    if (!apply) {
        console.log('Dry run - nothing was touched. Re-run with --yes to apply.');
        return { applied: false, stats };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const u of updates) {
            // eslint-disable-next-line no-await-in-loop
            await conn.query(`UPDATE users SET ${u.sets.join(', ')} WHERE id = ?`, [...u.params, u.id]);
        }
        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        throw error;
    } finally {
        conn.release();
    }
    stats.updated = updates.length;
    console.log(`Done. ${stats.updated} siswa diupdate.`);
    return { applied: true, stats };
}

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error('Update failed:', err.message);
            process.exit(1);
        }
    );
}

module.exports = { parseArgs, parseCsv, sniffDelimiter, COLUMN_MAP, main };
