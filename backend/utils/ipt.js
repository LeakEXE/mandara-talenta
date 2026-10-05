const db = require('../config/database');
const { buildIptCardBreakdown } = require('./iptCardBreakdown');

// Resolve a pembina to { id, nama } from either a guru user id or a name.
// Returns { id: null, nama: fallback } when unresolvable (caller decides).
async function resolvePembina(pembinaId, pembinaName) {
    if (pembinaId) {
        const [rows] = await db.query("SELECT id, nama FROM users WHERE id = ? AND role IN ('guru', 'pegawai')", [pembinaId]);
        if (rows.length > 0) {
            return { id: rows[0].id, nama: rows[0].nama };
        }
    }
    if (pembinaName) {
        const [rows] = await db.query("SELECT id, nama FROM users WHERE nama = ? AND role IN ('guru', 'pegawai')", [pembinaName]);
        if (rows.length > 0) {
            return { id: rows[0].id, nama: rows[0].nama };
        }
        return { id: null, nama: pembinaName };
    }
    return { id: null, nama: '' };
}

// Single source of truth for ipt_history "keterangan" text on every
// create/approve path (direct superadmin submit AND approval of
// teacher/student submissions). All inputs must use this so history
// reads identically in /wali-kelas, reports, and profile.
function buildKeterangan(type, data) {
    const d = data || {};
    switch (type) {
        case 'prestasi':
            return `Prestasi: ${d.nama_lomba || '-'} - ${d.juara || '-'} ${d.kategori || ''}`.trim();
        case 'event':
            return `Event: ${d.nama_event || '-'} - ${d.tingkat || '-'}`;
        case 'organisasi':
            return `Organisasi: ${d.kategori_organisasi || '-'} - ${d.jabatan_organisasi || '-'}`;
        case 'kepanitiaan':
            return `Kepanitiaan: ${d.kategori_kepanitiaan || '-'} - ${d.jabatan_kepanitiaan || '-'}`;
        case 'pelanggaran':
            return `Pelanggaran: ${d.jenis_pelanggaran || '-'}`;
        case 'perilaku':
            return `Perilaku: ${d.karakter_siswa || d.karakter || '-'}`;
        default:
            return `${type}: ${d.keterangan || ''}`.trim();
    }
}

async function resolveStudentIdByNis(nis, fallbackUserId) {
    if (!nis) {
        return fallbackUserId;
    }

    const [rows] = await db.query(
        'SELECT id FROM users WHERE nis = ? AND role = ?',
        [nis, 'siswa']
    );

    if (rows.length === 0) {
        const error = new Error('Siswa dengan NIS tersebut tidak ditemukan');
        error.statusCode = 400;
        throw error;
    }

    return rows[0].id;
}

async function applyIptChange(userId, jenis, pointChange, keterangan, executor = null) {
    // Recompute instead of adding: the record mutation (INSERT approved /
    // status flip) must already be visible — via the caller's transaction
    // when executor is given, else committed — so the new total always
    // equals ipt_awal + approved records. Heals pre-existing drift and
    // makes double-apply harmless. `pointChange` is kept for signature
    // compatibility but no longer drives the math.
    return recomputeAndStoreIpt(userId, { jenis, keterangan, executor });
}

// Recompute a student's total from approved records (same formula as
// syncIpt.js) and store it when different, with an audit history row.
// `executor` is a transaction connection's query fn, or null for the pool.
// The FOR UPDATE lock serializes concurrent mutations of one student when
// inside a transaction (outside one it is a harmless no-op).
async function recomputeAndStoreIpt(userId, { jenis, keterangan, executor = null }) {
    const q = executor || db.query;
    const [user] = await q('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (user.length === 0) {
        return null;
    }

    const iptSebelum = user[0].ipt_total;
    const card = await buildIptCardBreakdown(userId, null, executor);
    const iptSesudah = card ? card.breakdown_total : iptSebelum;
    if (iptSesudah === iptSebelum) {
        return { iptSebelum, iptSesudah, changed: false };
    }

    await q('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, userId]);
    await q(
        `INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, jenis, iptSesudah - iptSebelum, iptSebelum, iptSesudah, keterangan]
    );

    return { iptSebelum, iptSesudah, changed: true };
}

async function applyPerilakuIptChange(userId, newPoint, keterangan, excludePerilakuId = null, executor = null) {
    const q = executor || db.query;
    const params = [userId, 'approved'];
    let sql = 'SELECT id, point FROM perilaku WHERE user_id = ? AND status = ?';
    if (excludePerilakuId) {
        sql += ' AND id <> ?';
        params.push(excludePerilakuId);
    }

    const [previous] = await q(sql, params);
    let supersededCount = 0;

    for (const old of previous) {
        await q(
            `UPDATE perilaku SET status = 'rejected', rejection_reason = ? WHERE id = ?`,
            ['Diganti oleh penilaian perilaku baru', old.id]
        );
        supersededCount++;
    }

    // Only the latest approved perilaku counts (see buildIptCardBreakdown),
    // so recompute converges to the right total however many rows were
    // superseded — no net-diff arithmetic needed.
    const stored = await recomputeAndStoreIpt(userId, { jenis: 'perilaku', keterangan, executor });

    return { ...(stored || {}), supersededCount };
}

module.exports = { resolveStudentIdByNis, resolvePembina, applyIptChange, applyPerilakuIptChange, buildKeterangan, recomputeAndStoreIpt };
