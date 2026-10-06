const db = require('../config/database');
const { buildIptCardBreakdown } = require('./iptCardBreakdown');

// Resolve a pembina to { id, nama } from either a guru user id or a name.
// Returns { id: null, nama: fallback } when unresolvable (caller decides).
async function resolvePembina(pembinaId, pembinaName) {    if (pembinaId) {
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

// Resolve MULTIPLE pembina to [{ id, nama }] from guru user ids.
// Accepts an array, a JSON string, or a single id. Dedupes, drops
// non-staff ids. Returns [] when nothing resolves (caller decides).
async function resolvePembinaIds(input) {
    let ids = input;
    if (typeof ids === 'string') {
        try {
            ids = JSON.parse(ids);
        } catch {
            ids = [ids];
        }
    }
    if (!Array.isArray(ids)) ids = [ids];
    const uniq = [...new Set(
        ids.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v))
    )];
    if (uniq.length === 0) return [];
    const [rows] = await db.query(
        "SELECT id, nama FROM users WHERE id IN (?) AND role IN ('guru', 'pegawai')",
        [uniq]
    );
    const byId = new Map(rows.map((r) => [r.id, r.nama]));
    // Preserve caller order (primary = first).
    return uniq.filter((id) => byId.has(id)).map((id) => ({ id, nama: byId.get(id) }));
}

// Replace all mentor links for one prestasi / prestasi_approvals row.
// linkTable: 'prestasi_pembina' (idCol 'prestasi_id') or
// 'prestasi_approval_pembina' (idCol 'approval_id').
async function setPembinaLinks(executor, linkTable, idCol, rowId, guruIds) {
    const query = executor || db.query;
    await query(`DELETE FROM ${linkTable} WHERE ${idCol} = ?`, [rowId]);
    const uniq = [...new Set(
        (guruIds || []).map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v))
    )];
    for (const gid of uniq) {
        // Explicit RETURNING: the db wrapper auto-appends RETURNING id to
        // bare INSERTs, but link tables have no id column.
        // eslint-disable-next-line no-await-in-loop
        await query(`INSERT INTO ${linkTable} (${idCol}, guru_id) VALUES (?, ?) RETURNING guru_id`, [rowId, gid]);
    }
}

// Attach pembina_list: [names] to prestasi-family rows (by row id).
// linkTable/idCol as in setPembinaLinks. Rows without links keep
// pembina_list undefined so callers fall back to the primary `pembina`.
async function attachPembinaLists(rows, linkTable, idCol, executor) {
    const query = executor || db.query;
    if (!rows || rows.length === 0) return rows;
    const ids = [...new Set(rows.map((r) => r.id))];
    const [links] = await query(
        `SELECT l.${idCol} AS row_id, u.nama
         FROM ${linkTable} l JOIN users u ON u.id = l.guru_id
         WHERE l.${idCol} IN (?) ORDER BY u.nama ASC`,
        [ids]
    );
    const byRow = new Map();
    for (const l of links) {
        if (!byRow.has(l.row_id)) byRow.set(l.row_id, []);
        byRow.get(l.row_id).push(l.nama);
    }
    for (const r of rows) {
        if (byRow.has(r.id)) r.pembina_list = byRow.get(r.id);
    }
    return rows;
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

async function applyIptChange(userId, jenis, pointChange, keterangan, executor = null, recordRef = null) {
    // Recompute instead of adding: the record mutation (INSERT approved /
    // status flip) must already be visible — via the caller's transaction
    // when executor is given, else committed — so the new total always
    // equals ipt_awal + approved records. Heals pre-existing drift and
    // makes double-apply harmless. `pointChange` is kept for signature
    // compatibility but no longer drives the math. `recordRef` links the
    // history row to its source record ({ type, id }).
    return recomputeAndStoreIpt(userId, { jenis, keterangan, executor, recordType: recordRef?.type ?? null, recordId: recordRef?.id ?? null });
}

// Recompute a student's total from approved records (same formula as
// syncIpt.js) and store it when different, with an audit history row.
// `executor` is a transaction connection's query fn, or null for the pool.
// The FOR UPDATE lock serializes concurrent mutations of one student when
// inside a transaction (outside one it is a harmless no-op).
async function recomputeAndStoreIpt(userId, { jenis, keterangan, executor = null, recordType = null, recordId = null, skipHistory = false }) {
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
    if (!skipHistory) {
        await q(
            `INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan, record_type, record_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, jenis, iptSesudah - iptSebelum, iptSebelum, iptSesudah, keterangan, recordType, recordId == null ? null : Number(recordId)]
        );
    }

    return { iptSebelum, iptSesudah, changed: true };
}

// Every keterangan text a record's lifecycle can leave in ipt_history:
// grant (approve/direct wording), updates, legacy wordings, and old
// delete-tombstones. Used to purge pre-linkage rows (record_type IS NULL)
// when a record is deleted — exact strings only, never fuzzy matching.
const RECORD_LABEL_FIELD = {
    prestasi: 'nama_lomba',
    organisasi: 'jabatan_organisasi',
    kepanitiaan: 'jabatan_kepanitiaan',
    event: 'nama_event',
    pelanggaran: 'jenis_pelanggaran',
    perilaku: 'karakter_siswa'
};

function recordLifecycleKeterangans(type, data) {
    const d = data || {};
    const label = d[RECORD_LABEL_FIELD[type]];
    const cap = type.charAt(0).toUpperCase() + type.slice(1);
    const set = new Set([buildKeterangan(type, d)]);
    if (label) {
        set.add(`Update ${cap}: ${label}`);
        set.add(`Delete ${cap}: ${label}`);
    }
    if (type === 'prestasi' && d.nama_lomba) {
        // Wording used by older backend versions (see historyEvidence).
        set.add(`Poin dari Prestasi: ${d.nama_lomba}`);
    }
    return [...set].filter(Boolean);
}

// Remove every history trace of a deleted record so it stops showing in
// history views: exact-linked rows (record_type/record_id) plus best-effort
// pre-linkage rows matching its lifecycle keterangans. Rows of other
// records, users, and sync/manual/initial entries are never touched.
async function purgeRecordHistory(userId, recordType, recordId, lifecycleKeterangans, executor = null) {
    const q = executor || db.query;
    const rid = recordId == null ? null : Number(recordId);
    await q(
        'DELETE FROM ipt_history WHERE user_id = ? AND record_type = ? AND record_id = ?',
        [userId, recordType, rid]
    );
    if (Array.isArray(lifecycleKeterangans) && lifecycleKeterangans.length > 0) {
        const placeholders = lifecycleKeterangans.map(() => '?').join(', ');
        await q(
            `DELETE FROM ipt_history WHERE user_id = ? AND record_type IS NULL AND keterangan IN (${placeholders})`,
            [userId, ...lifecycleKeterangans]
        );
    }
}

async function applyPerilakuIptChange(userId, newPoint, keterangan, excludePerilakuId = null, executor = null, recordRef = null) {
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
    const stored = await recomputeAndStoreIpt(userId, {
        jenis: 'perilaku',
        keterangan,
        executor,
        recordType: recordRef?.type ?? null,
        recordId: recordRef?.id ?? null,
    });

    return { ...(stored || {}), supersededCount };
}

module.exports = { resolveStudentIdByNis, resolvePembina, resolvePembinaIds, setPembinaLinks, attachPembinaLists, applyIptChange, applyPerilakuIptChange, buildKeterangan, recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans };
