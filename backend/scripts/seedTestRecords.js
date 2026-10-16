// Seed test records for every IPT input type.
// Each type gets exactly <count> records (individu only, so 1 record = 1 row).
//
// Usage:
//   cd backend && node scripts/seedTestRecords.js <count> [--types=prestasi,organisasi,kepanitiaan,event,pelanggaran,perilaku] [--status=approved] [--dry-run]
//
//   <count>    required, positive integer - records to create PER type.
//   --types    comma-separated subset of the 6 types (default: all).
//   --status   pending|approved|rejected (default: approved).
//   --dry-run  print what would be inserted without touching the DB.
//
// Records are attached to random existing siswa users (foto = NULL) and
// student IPT totals are recomputed once per affected user at the end.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../config/database');
const {
    calculatePrestasiPoints,
    calculateEventPoints,
    calculateOrganisasiPoints,
    calculateKepanitiaanPoints,
    calculatePelanggaranPoints,
    calculatePerilakuPointsFromFields,
    formatPerilakuKarakter,
    PERILAKU_CHARACTER_FIELDS,
} = require('../constants/points');
const { recomputeAndStoreIpt, buildKeterangan } = require('../utils/ipt');

const ALL_TYPES = ['prestasi', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran', 'perilaku'];
const VALID_STATUS = ['pending', 'approved', 'rejected'];

const JABATAN = ['ketua', 'wakil ketua', 'sekretaris', 'bendahara', 'koordinator', 'anggota'];
const PERILAKU_RATINGS = ['sangat baik', 'baik', 'cukup baik', 'kurang baik'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad2 = (n) => String(n).padStart(2, '0');
const randomPastDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - randInt(1, 365));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const tag = () => Date.now().toString(36);

function parseArgs(argv) {
    const opts = { count: null, types: [...ALL_TYPES], status: 'approved', dryRun: false };
    for (const a of argv) {
        if (a === '--dry-run') opts.dryRun = true;
        else if (a.startsWith('--types=')) {
            const list = a.slice('--types='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
            const bad = list.filter((t) => !ALL_TYPES.includes(t));
            if (bad.length > 0) throw new Error(`Unknown type(s): ${bad.join(', ')}. Valid: ${ALL_TYPES.join(', ')}`);
            if (list.length === 0) throw new Error('--types needs at least one type');
            opts.types = [...new Set(list)];
        } else if (a.startsWith('--status=')) {
            const s = a.slice('--status='.length).toLowerCase();
            if (!VALID_STATUS.includes(s)) throw new Error(`--status must be one of: ${VALID_STATUS.join(', ')}`);
            opts.status = s;
        } else if (/^\d+$/.test(a)) {
            if (opts.count !== null) throw new Error('Pass <count> only once');
            opts.count = parseInt(a, 10);
        } else {
            throw new Error(`Unknown argument: ${a}`);
        }
    }
    if (opts.count === null) throw new Error('Missing <count>. Usage: node scripts/seedTestRecords.js <count> [--types=...] [--status=...] [--dry-run]');
    if (opts.count < 1) throw new Error('<count> must be a positive integer');
    if (opts.count > 10000) throw new Error('<count> is capped at 10000 per type for safety');
    return opts;
}

async function loadReferenceData() {
    const [students] = await db.query(
        "SELECT id, nama, nis, kelas, grha FROM users WHERE role = 'siswa' ORDER BY id"
    );
    if (students.length === 0) throw new Error('No siswa users found - create student accounts first');

    const [staff] = await db.query(
        "SELECT id, nama FROM users WHERE role IN ('guru', 'pegawai') ORDER BY id"
    );
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
    const submittedBy = staff.length > 0 ? staff[0].id : (admins[0]?.id ?? null);

    const [prestasiCfg] = await db.query(
        "SELECT field1 AS tingkat, field2 AS juara FROM ipt_config WHERE category = 'prestasi' AND is_active = TRUE AND field1 IS NOT NULL AND field2 IS NOT NULL"
    );
    const [orgNames] = await db.query('SELECT name FROM ipt_organisasi WHERE is_active = TRUE ORDER BY name');
    const [kepJabatan] = await db.query(
        "SELECT field1 AS jabatan FROM ipt_config WHERE category = 'kepanitiaan' AND is_active = TRUE AND field1 IS NOT NULL"
    );
    const [eventTingkat] = await db.query(
        "SELECT field1 AS tingkat FROM ipt_config WHERE category = 'event' AND is_active = TRUE AND field1 IS NOT NULL"
    );
    let pelanggaranJenis = [];
    try {
        const [rows] = await db.query(
            'SELECT name FROM ipt_pelanggaran_detail WHERE is_active = TRUE ORDER BY name'
        );
        pelanggaranJenis = rows.map((r) => r.name).filter(Boolean);
    } catch (_) {
        pelanggaranJenis = [];
    }
    if (pelanggaranJenis.length === 0) {
        const [levels] = await db.query('SELECT name FROM ipt_pelanggaran_level WHERE is_active = TRUE ORDER BY name');
        pelanggaranJenis = levels.map((r) => r.name).filter(Boolean);
    }
    let karakterNames = [];
    try {
        const [rows] = await db.query('SELECT name FROM ipt_perilaku_karakter WHERE is_active = TRUE ORDER BY name');
        karakterNames = rows.map((r) => r.name).filter(Boolean);
    } catch (_) {
        karakterNames = [];
    }

    return {
        students,
        pembina: staff.length > 0 ? staff[0] : null,
        submittedBy,
        prestasiCombos: prestasiCfg.length > 0
            ? prestasiCfg
            : [{ tingkat: 'sekolah', juara: 'juara_i' }, { tingkat: 'kabupaten', juara: 'juara_ii' }],
        orgNames: orgNames.length > 0 ? orgNames.map((r) => r.name) : ['OSIS', 'MPK', 'PRAMUKA'],
        kepJabatan: kepJabatan.length > 0 ? kepJabatan.map((r) => r.jabatan) : JABATAN,
        eventTingkat: eventTingkat.length > 0 ? eventTingkat.map((r) => r.tingkat) : ['sekolah', 'kabupaten', 'provinsi'],
        pelanggaranJenis: pelanggaranJenis.length > 0 ? pelanggaranJenis : ['ringan', 'sedang', 'berat'],
        karakterNames,
    };
}

async function seedPrestasi(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const combo = pick(ref.prestasiCombos);
        const point = await calculatePrestasiPoints(combo.juara, combo.tingkat);
        const row = {
            nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha,
            nama_lomba: `Seed Lomba ${tag()}-${i}`,
            juara: combo.juara, kategori: combo.tingkat,
            jenis_lomba: pick(['akademik', 'non_akademik']),
            kategori_lomba: 'individu',
            tanggal_pelaksanaan: randomPastDate(),
            point,
        };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO prestasi (user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, tanggal_pelaksanaan, point, status) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [s.id, row.nama, row.nis, row.nama_lomba, row.kelas, ref.pembina?.nama ?? null, ref.pembina?.id ?? null,
                row.grha, row.juara, row.kategori, row.jenis_lomba, row.kategori_lomba, row.tanggal_pelaksanaan, row.point, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

async function seedOrganisasi(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const kategori = pick(ref.orgNames);
        const jabatan = pick(JABATAN);
        const point = await calculateOrganisasiPoints(kategori, jabatan);
        const row = { nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha, jabatan_organisasi: jabatan, kategori_organisasi: kategori, point };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO organisasi (user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
            [s.id, row.nama, row.nis, row.kelas, row.grha, row.jabatan_organisasi, row.kategori_organisasi, row.point, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

async function seedKepanitiaan(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const jabatan = pick(ref.kepJabatan);
        const point = await calculateKepanitiaanPoints(jabatan);
        const row = {
            nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha,
            jabatan_kepanitiaan: jabatan, kategori_kepanitiaan: `Seed Panitia ${tag()}-${i}`, point,
        };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO kepanitiaan (user_id, nama, nis, kelas, grha, jabatan_kepanitiaan, foto, kategori_kepanitiaan, point, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
            [s.id, row.nama, row.nis, row.kelas, row.grha, row.jabatan_kepanitiaan, row.kategori_kepanitiaan, row.point, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

async function seedEvent(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const tingkat = pick(ref.eventTingkat);
        const point = await calculateEventPoints(tingkat);
        const row = {
            nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha,
            nama_event: `Seed Event ${tag()}-${i}`, tingkat, point,
        };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO event (user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
            [s.id, row.nama, row.nis, row.kelas, row.grha, row.nama_event, row.tingkat, row.point, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

async function seedPelanggaran(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const jenis = pick(ref.pelanggaranJenis);
        const point = await calculatePelanggaranPoints(jenis);
        const row = {
            nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha,
            keterangan: `Seed pelanggaran ${tag()}-${i}`, jenis_pelanggaran: jenis, point_dikurangi: point,
        };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO pelanggaran (user_id, submitted_by, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
            [s.id, ref.submittedBy, row.nama, row.nis, row.kelas, row.grha, row.keterangan, row.jenis_pelanggaran, row.point_dikurangi, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

async function seedPerilaku(ref, count, status, dryRun) {
    const ids = [];
    for (let i = 1; i <= count; i++) {
        const s = pick(ref.students);
        const fields = {};
        for (const f of PERILAKU_CHARACTER_FIELDS) fields[f] = pick(PERILAKU_RATINGS);
        const karakter = formatPerilakuKarakter(fields);
        const point = await calculatePerilakuPointsFromFields(fields);
        const row = { nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha, karakter_siswa: karakter, point };
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        const [r] = await db.query(
            'INSERT INTO perilaku (user_id, submitted_by, nama, nis, kelas, grha, karakter_siswa, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [s.id, ref.submittedBy, row.nama, row.nis, row.kelas, row.grha, row.karakter_siswa, row.point, status]
        );
        ids.push({ id: r.insertId, userId: s.id, data: row });
    }
    return ids;
}

const SEEDERS = {
    prestasi: seedPrestasi,
    organisasi: seedOrganisasi,
    kepanitiaan: seedKepanitiaan,
    event: seedEvent,
    pelanggaran: seedPelanggaran,
    perilaku: seedPerilaku,
};

async function main(argv) {
    const opts = parseArgs(argv || process.argv.slice(2));
    console.log(`Seeding ${opts.count} record(s) per type for: ${opts.types.join(', ')} (status=${opts.status})${opts.dryRun ? ' [DRY RUN]' : ''}`);

    const ref = await loadReferenceData();
    console.log(`Students available: ${ref.students.length}. Pembina: ${ref.pembina?.nama ?? '(none)'}.`);

    const created = {};
    for (const type of opts.types) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await SEEDERS[type](ref, opts.count, opts.status, opts.dryRun);
        created[type] = rows;
        console.log(`  ${type}: ${opts.dryRun ? opts.count : rows.length} record(s)${opts.dryRun ? ' (would insert)' : ' inserted'}`);
    }

    if (!opts.dryRun && opts.status === 'approved') {
        const affected = new Set();
        for (const type of opts.types) for (const r of created[type]) affected.add(r.userId);
        console.log(`Recomputing IPT totals for ${affected.size} student(s)...`);
        let n = 0;
        for (const userId of affected) {
            // eslint-disable-next-line no-await-in-loop
            await recomputeAndStoreIpt(userId, {
                jenis: 'sync',
                keterangan: `Seed test records (${opts.types.map((t) => `${opts.count}x ${t}`).join(', ')})`,
            });
            n++;
        }
        console.log(`IPT recomputed for ${n} student(s).`);
    } else if (!opts.dryRun) {
        console.log(`Status is '${opts.status}', skipping IPT recompute (only approved records affect totals).`);
    }

    return created;
}

if (require.main === module) {
    main().then(
        () => process.exit(0),
        (err) => {
            console.error(`Seed failed: ${err.message}`);
            process.exit(1);
        }
    );
}

module.exports = { parseArgs, main, ALL_TYPES };
