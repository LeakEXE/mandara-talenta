const db = require('../config/database');
const {
    PERILAKU_POINTS,
    lookupPerilakuPoint
} = require('../constants/points');

const TRAIT_FIELD_MAP = {
    'tanggung jawab': 'tanggung_jawab',
    disiplin: 'disiplin',
    kepedulian: 'kepedulian',
    kemandirian: 'kemandirian',
    spiritual: 'spiritual',
    kejujuran: 'kejujuran',
    'kepercayaan diri': 'kepercayaan_diri'
};

function createEmptyPoints(iptAwal = 80) {
    return {
        point_awal: iptAwal,
        prestasi: 0,
        prestasi_akademik: 0,
        prestasi_non_akademik: 0,
        tanggung_jawab: 0,
        disiplin: 0,
        kepedulian: 0,
        kemandirian: 0,
        spiritual: 0,
        kejujuran: 0,
        kepercayaan_diri: 0,
        organisasi: 0,
        kepanitiaan: 0,
        event: 0,
        pelanggaran_ringan: 0,
        pelanggaran_sedang: 0,
        pelanggaran_berat: 0,
        pelanggaran_lainnya: 0,
        // Semua tingkat pelanggaran untuk cetakan individual:
        // [{ id, name, point_value, total }] — total bertanda (negatif = pengurangan).
        pelanggaran_levels: []
    };
}

async function addPerilakuPoints(points, karakterSiswa) {
    if (!karakterSiswa) {
        return;
    }

    const text = String(karakterSiswa).trim();
    if (!text) {
        return;
    }

    if (text.includes(':')) {
        const parts = text.split(',');
        for (const part of parts) {
            const [label, value] = part.split(':').map((s) => s.trim());
            const field = TRAIT_FIELD_MAP[label?.toLowerCase()];
            if (!field || !value) {
                continue;
            }
            const point = await lookupPerilakuPoint(field, value);
            points[field] += point || PERILAKU_POINTS[value.toLowerCase()] || 0;
        }
        return;
    }

    // Legacy single-rating string — apply to tanggung_jawab as before
    const point = await lookupPerilakuPoint('tanggung_jawab', text);
    points.tanggung_jawab += point || PERILAKU_POINTS[text.toLowerCase()] || 0;
}

function calculateBreakdownTotal(points) {
    let total = points.point_awal || 80;
    total += points.prestasi || 0;
    total += points.tanggung_jawab || 0;
    total += points.disiplin || 0;
    total += points.kepedulian || 0;
    total += points.kemandirian || 0;
    total += points.spiritual || 0;
    total += points.kejujuran || 0;
    total += points.kepercayaan_diri || 0;
    total += points.organisasi || 0;
    total += points.kepanitiaan || 0;
    total += points.event || 0;
    // Pelanggaran disimpan sebagai point negatif (pengurangan), sama seperti
    // yang diterapkan applyIptChange ke users.ipt_total — jadi cukup dijumlahkan.
    total += points.pelanggaran_ringan || 0;
    total += points.pelanggaran_sedang || 0;
    total += points.pelanggaran_berat || 0;
    total += points.pelanggaran_lainnya || 0;
    return total;
}

async function buildIptCardBreakdown(userId, cutoff = null, queryFn = null) {
    // Optional query executor (e.g. a transaction connection's query fn).
    // Record reads go through it so callers inside a transaction observe
    // their own uncommitted writes; config lookups (ipt_config, levels)
    // stay on the pool via lookupPerilakuPoint — those tables are never
    // mutated inside such a transaction. Defaults to the pool.
    const q = queryFn || db.query;
    const [students] = await q(
        `SELECT id, nama, nis, kelas, grha, ipt_total, ipt_awal
         FROM users
         WHERE id = ? AND role = 'siswa'`,
        [userId]
    );

    if (students.length === 0) {
        return null;
    }

    const student = students[0];
    const points = createEmptyPoints(student.ipt_awal ?? 80);

    // Cutoff opsional (string 'YYYY-MM-DD'): hanya record dengan
    // created_at SEBELUM tanggal ini yang dihitung. Tanpa cutoff = semua.
    const before = cutoff ? ' AND created_at < ?' : '';
    const beforeParam = (params) => (cutoff ? [...params, cutoff] : params);

    const [prestasi] = await q(
        `SELECT point, jenis_lomba FROM prestasi WHERE user_id = ? AND status = 'approved'${before}`,
        beforeParam([userId])
    );
    points.prestasi = prestasi.reduce((sum, row) => sum + (row.point || 0), 0);
    // Rincian prestasi per kategori untuk cetakan individual.
    // jenis_lomba 'non_akademik' -> Non-akademik; lainnya (termasuk NULL/legacy) -> Akademik.
    for (const row of prestasi) {
        if (row.jenis_lomba === 'non_akademik') {
            points.prestasi_non_akademik += row.point || 0;
        } else {
            points.prestasi_akademik += row.point || 0;
        }
    }

    const [organisasi] = await q(
        `SELECT point FROM organisasi WHERE user_id = ? AND status = 'approved'${before}`,
        beforeParam([userId])
    );
    points.organisasi = organisasi.reduce((sum, row) => sum + (row.point || 0), 0);

    const [kepanitiaan] = await q(
        `SELECT point FROM kepanitiaan WHERE user_id = ? AND status = 'approved'${before}`,
        beforeParam([userId])
    );
    points.kepanitiaan = kepanitiaan.reduce((sum, row) => sum + (row.point || 0), 0);

    const [event] = await q(
        `SELECT point FROM event WHERE user_id = ? AND status = 'approved'${before}`,
        beforeParam([userId])
    );
    points.event = event.reduce((sum, row) => sum + (row.point || 0), 0);

    const [levels] = await q(
        'SELECT id, name, point_value, is_active FROM ipt_pelanggaran_level'
    );

    // jenis_pelanggaran menyimpan NAMA DETAIL (bukan nama tingkat), jadi record
    // dipetakan: detail -> tingkat, dengan fallback nama record = nama tingkat
    // (data lama). created_at perlu diberi alias p. karena ada banyak tabel.
    const beforeP = cutoff ? ' AND p.created_at < ?' : '';
    const [pelanggaran] = await q(
        `SELECT p.jenis_pelanggaran, p.point_dikurangi,
                COALESCE(d.level_id, by_name.id) AS level_id
         FROM pelanggaran p
         LEFT JOIN ipt_pelanggaran_detail d ON d.name = p.jenis_pelanggaran
         LEFT JOIN ipt_pelanggaran_level by_name ON by_name.name = p.jenis_pelanggaran
         WHERE p.user_id = ? AND p.status = 'approved'${beforeP}`,
        beforeParam([userId])
    );

    const levelById = new Map(levels.map((l) => [l.id, l]));
    const levelTotals = new Map(); // level_id -> akumulasi point (negatif)
    let unresolved = 0;

    pelanggaran.forEach((row) => {
        const delta = row.point_dikurangi || 0;
        const level = row.level_id != null ? levelById.get(row.level_id) : null;

        if (!level) {
            // Detail/tingkat sudah dihapus — tetap dihitung sebagai "lainnya".
            unresolved += delta;
            points.pelanggaran_lainnya += delta;
            return;
        }

        levelTotals.set(level.id, (levelTotals.get(level.id) || 0) + delta);

        // Legacy buckets untuk leger per kelas (kolom Ringan/Sedang/Berat).
        const name = level.name.toLowerCase();
        if (name.includes('ringan')) {
            points.pelanggaran_ringan += delta;
        } else if (name.includes('sedang')) {
            points.pelanggaran_sedang += delta;
        } else if (name.includes('berat')) {
            points.pelanggaran_berat += delta;
        } else {
            // Tingkat custom (mis. "anjay") -> hanya masuk "lainnya" di leger,
            // tapi tetap punya baris sendiri di cetakan individual.
            points.pelanggaran_lainnya += delta;
        }
    });

    // Baris cetak: SEMUA tingkat (aktif atau punya record siswa), diurutkan
    // dari point terkecil ke terbesar yang dipotong (-1, -5, -25, -125, ...).
    const pelanggaranLevels = levels
        .filter((l) => l.is_active || (levelTotals.get(l.id) || 0) !== 0)
        .map((l) => ({
            id: l.id,
            name: l.name,
            point_value: l.point_value,
            total: levelTotals.get(l.id) || 0
        }))
        .sort((a, b) => (b.point_value - a.point_value) || String(a.name).localeCompare(String(b.name)));

    if (unresolved !== 0) {
        pelanggaranLevels.push({ id: null, name: 'Lainnya', point_value: null, total: unresolved });
    }
    points.pelanggaran_levels = pelanggaranLevels;

    // Perilaku memakai penilaian TERAKHIR; dengan cutoff berarti
    // penilaian terakhir SEBELUM tanggal cutoff (kondisi saat itu).
    const [perilaku] = await q(
        `SELECT karakter_siswa, point FROM perilaku
         WHERE user_id = ? AND status = 'approved'${before}
         ORDER BY created_at DESC LIMIT 1`,
        beforeParam([userId])
    );
    if (perilaku.length > 0) {
        await addPerilakuPoints(points, perilaku[0].karakter_siswa);
    }

    const breakdownTotal = calculateBreakdownTotal(points);

    return {
        student,
        points,
        ipt_total: breakdownTotal,
        breakdown_total: breakdownTotal
    };
}

module.exports = {
    buildIptCardBreakdown,
    calculateBreakdownTotal,
    createEmptyPoints
};
