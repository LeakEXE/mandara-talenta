const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS, EVIDENCE_MAX_FILES } = require('../utils/evidenceUpload');
const crypto = require('crypto');
const path = require('path');
const {
    uploadedPaths,
    attachEvidence,
    listEvidence,
    replaceEvidence,
    updateEvidenceSelection,
    parseEvidenceIdList,
    validateEvidenceSelection,
    withEvidenceUploadCleanup,
    deleteEvidenceForRecord,
    moveEvidenceToApproved,
    deleteEvidenceFilesIfOrphan
} = require('../utils/evidenceStore');
const { ensureUploadSubdir } = require('../utils/paths');
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('prestasi'));
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculatePrestasiPoints } = require('../constants/points');
const { buildKeterangan, resolvePembina, resolvePembinaIds, setPembinaLinks, attachPembinaLists, resolveStudentIdByNis } = require('../utils/ipt');
const { normalizeTanggalPelaksanaan } = require('../utils/prestasiFields');

// Get all prestasi (for approvals) — server-side pagination + filters
router.get('/all', auth, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = (page - 1) * limit;

        const where = [];
        const params = [];

        if (req.query.search) {
            where.push('(p.nama ILIKE ? OR p.nis ILIKE ? OR p.nama_lomba ILIKE ? OR p.jenis_lomba ILIKE ? OR p.kategori_lomba ILIKE ? OR p.juara ILIKE ? OR p.kategori ILIKE ? OR p.pembina ILIKE ? OR p.status ILIKE ?)');
            const q = `%${req.query.search}%`;
            params.push(q, q, q, q, q, q, q, q, q);
        }
        if (req.query.status && req.query.status !== 'semua') {
            where.push('p.status = ?');
            params.push(req.query.status);
        }
        if (req.query.jenis_lomba && req.query.jenis_lomba !== 'semua') {
            where.push('p.jenis_lomba = ?');
            params.push(req.query.jenis_lomba);
        }
        if (req.query.kategori_lomba && req.query.kategori_lomba !== 'semua') {
            where.push('p.kategori_lomba = ?');
            params.push(req.query.kategori_lomba);
        }
        if (req.query.juara && req.query.juara !== 'semua') {
            where.push('p.juara = ?');
            params.push(req.query.juara);
        }
        if (req.query.kategori && req.query.kategori !== 'semua') {
            where.push('p.kategori = ?');
            params.push(req.query.kategori);
        }
        if (req.query.date_from) {
            where.push('p.tanggal_pelaksanaan >= ?');
            params.push(req.query.date_from);
        }
        if (req.query.date_to) {
            where.push('p.tanggal_pelaksanaan <= ?');
            params.push(req.query.date_to);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        // Count distinct records: individual prestasi = 1 per row, group prestasi = 1 per grup_lomba
        const countQuery = `
            SELECT COUNT(DISTINCT grp) as total FROM (
                SELECT CASE 
                    WHEN p.kategori_lomba = 'kelompok' THEN p.grup_lomba 
                    ELSE p.id::text 
                END as grp
                FROM prestasi p
                ${whereSql}
            ) t
        `;
        const [countRows] = await db.query(countQuery, params);
        const total = countRows[0].total;

        // For pagination: fetch one row per group (kelompok) or per row (individu)
        // Use ROW_NUMBER to pick the first student of each group
        const dataQuery = `
            SELECT p.*, u.nama as user_name 
            FROM (
                SELECT p.*, 
                    ROW_NUMBER() OVER (
                        PARTITION BY CASE 
                            WHEN p.kategori_lomba = 'kelompok' THEN p.grup_lomba 
                            ELSE p.id::text 
                        END
                        ORDER BY p.created_at DESC
                    ) as rn
                FROM prestasi p
                ${whereSql}
            ) p
            JOIN users u ON p.user_id = u.id
            WHERE p.rn = 1
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `;
        const [prestasi] = await db.query(dataQuery, [...params, limit, offset]);

        await attachPembinaLists(prestasi, 'prestasi_pembina', 'prestasi_id');
        await attachEvidence(prestasi, 'prestasi');

        res.json({
            data: prestasi,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all teachers (for pembina dropdown)
router.get('/teachers', auth, async (req, res) => {
    try {
        const [teachers] = await db.query(
            'SELECT id, nama, nip FROM users WHERE role = ? OR role = ? ORDER BY nama ASC',
            ['guru', 'pegawai']
        );
        res.json(teachers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's prestasi
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [prestasi] = await db.query(
            'SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, point, status, rejection_reason, created_at FROM prestasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        await attachEvidence(prestasi, 'prestasi');
        res.json(prestasi);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create prestasi
router.post('/', auth, withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'prestasi'), async (req, res) => {
    try {
        const { nama, nis, nama_lomba, kelas, pembina, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        let tanggalPelaksanaan = null;
        try {
            tanggalPelaksanaan = normalizeTanggalPelaksanaan(req.body.tanggal_pelaksanaan);
        } catch (err) {
            return res.status(err.statusCode || 400).json({ message: err.message });
        }
        const fotoPaths = uploadedPaths(req, 'prestasi');

        const point = await calculatePrestasiPoints(juara, kategori);

        const { id: resolvedPembinaId, nama: resolvedPembinaName } = await resolvePembina(req.body.pembina_id, pembina);
        const mentorList = await resolvePembinaIds(req.body.pembina_ids);
        const mentorIds = mentorList.length > 0
            ? mentorList.map((m) => m.id)
            : (resolvedPembinaId ? [resolvedPembinaId] : []);

        const [result] = await db.query(
            'INSERT INTO prestasi (user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, tanggal_pelaksanaan, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, nama_lomba, fotoPaths[0] || null, kelas, resolvedPembinaName, resolvedPembinaId, grha, juara, kategori, jenis_lomba, kategori_lomba, tanggalPelaksanaan, point]
        );
        await replaceEvidence('prestasi', result.insertId, fotoPaths);
        await setPembinaLinks(db.query, 'prestasi_pembina', 'prestasi_id', result.insertId, mentorIds);

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'SUBMIT_PRESTASI', `Submitted prestasi: ${nama_lomba}`]
        );

        res.status(201).json({ message: 'Prestasi submitted for approval', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve prestasi (superadmin only)
router.put('/:id/approve', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const prestasiId = req.params.id;

        const [prestasi] = await conn.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Prestasi not found' });
        }
        if (prestasi[0].status !== 'pending') {
            await conn.rollback();
            return res.status(400).json({ message: 'Prestasi ini sudah diproses' });
        }

        const prestasiData = prestasi[0];
        const sourceEvidence = await listEvidence('prestasi', prestasiId, conn.query);
        const movedEvidence = moveEvidenceToApproved(sourceEvidence.map((item) => item.path), 'prestasi');
        const finalEvidence = sourceEvidence.map((item) => movedEvidence.get(item.path) || item.path);

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE prestasi SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', finalEvidence[0] || null, prestasiId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Prestasi ini sudah diproses' });
        }
        await replaceEvidence('prestasi', prestasiId, finalEvidence, conn.query);

        // Recompute the total from approved records (same formula as
        // syncIpt.js) never arithmetic, so double-approvals and drift
        // are impossible.
        await recomputeAndStoreIpt(prestasiData.user_id, {
            jenis: 'prestasi',
            keterangan: buildKeterangan('prestasi', prestasiData),
            executor: conn.query,
            recordType: 'prestasi',
            recordId: prestasiId,
        });

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_PRESTASI', `Approved prestasi ID ${prestasiId}`]
        );

        await conn.commit();

        res.json({ message: 'Prestasi approved successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Reject prestasi (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { rejection_reason } = req.body;
        const prestasiId = req.params.id;

        const [rows] = await conn.query('SELECT id, user_id, foto, status, nama_lomba FROM prestasi WHERE id = ?', [prestasiId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Prestasi not found' });
        }
        const wasApproved = rows[0].status === 'approved';
        let rejectedEvidence = [];

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE prestasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, prestasiId]);
        rejectedEvidence = (await listEvidence('prestasi', prestasiId, conn.query)).map((item) => item.path);
        await deleteEvidenceForRecord('prestasi', prestasiId, conn.query);

        // A rejected record stops counting: recompute WITHOUT a tombstone
        // row ('*_reject' is not in the ipt_history CHECK list), then remove
        // every history trace of this record like a delete does.
        if (wasApproved) {
            await recomputeAndStoreIpt(rows[0].user_id, {
                jenis: 'prestasi_reject',
                keterangan: `Reject Prestasi: ${rejection_reason || 'Tanpa alasan'}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(rows[0].user_id, 'prestasi', prestasiId, recordLifecycleKeterangans('prestasi', rows[0]), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_PRESTASI', `Rejected prestasi ID ${prestasiId}`]
        );

        await conn.commit();

        // Delete evidence files when no other row references them anymore.
        await deleteEvidenceFilesIfOrphan(rejectedEvidence, {
            exclude: { table: 'prestasi', id: prestasiId },
            folderHint: 'prestasi'
        });

        res.json({ message: 'Prestasi rejected' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Update prestasi (for superadmin)
router.put('/:id', auth, withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'prestasi'), async (req, res) => {
    try {
        const prestasiId = req.params.id;
        const { nama, nis, nama_lomba, kelas, pembina, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        let tanggalPelaksanaan = null;
        try {
            tanggalPelaksanaan = normalizeTanggalPelaksanaan(req.body.tanggal_pelaksanaan);
        } catch (err) {
            return res.status(err.statusCode || 400).json({ message: err.message });
        }

        const [prestasi] = await db.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            return res.status(404).json({ message: 'Prestasi not found' });
        }

        const prestasiData = prestasi[0];
        const isGroup = prestasiData.kategori_lomba === 'kelompok' && prestasiData.grup_lomba;

        // Kelompok member list (JSON string in multipart, same as submit).
        // Shared-field edits apply to every surviving sibling; membership
        // itself is diffed below (added rows + reverted removals).
        let anggota = null;
        if (isGroup && req.body.anggota !== undefined) {
            try {
                anggota = typeof req.body.anggota === 'string' ? JSON.parse(req.body.anggota) : req.body.anggota;
            } catch {
                return res.status(400).json({ message: 'Format data anggota tidak valid' });
            }
            if (!Array.isArray(anggota) || anggota.length < 2) {
                return res.status(400).json({ message: 'Lomba kelompok membutuhkan minimal 2 anggota' });
            }
        }

        // Recalculate points (shared by the whole group)
        const point = await calculatePrestasiPoints(juara, kategori);

        // Keep pembina link consistent when the name changes
        const { id: resolvedPembinaId, nama: resolvedPembinaName } = await resolvePembina(req.body.pembina_id, pembina);
        const mentorList = await resolvePembinaIds(req.body.pembina_ids);
        const mentorIds = mentorList.length > 0
            ? mentorList.map((m) => m.id)
            : (resolvedPembinaId ? [resolvedPembinaId] : []);

        // Evidence: uploads keep their timestamp-unique multer name. Queued
        // rows keep the type-folder path; approved rows land in approved/.
        const uploaded = uploadedPaths(req, 'prestasi');
        const removeIds = parseEvidenceIdList(req.body.remove_evidence_ids);
        await validateEvidenceSelection('prestasi', prestasiId, removeIds, uploaded.length);
        const moved = prestasiData.status === 'approved'
            ? moveEvidenceToApproved(uploaded, 'prestasi')
            : new Map();
        const newEvidence = uploaded.map((p) => moved.get(p) || p);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            if (!isGroup) {
                let finalEvidence = null;
                let removedEvidence = [];
                if (newEvidence.length > 0 || removeIds.length > 0) {
                    const result = await updateEvidenceSelection('prestasi', prestasiId, {
                        removeIds,
                        newPaths: newEvidence
                    }, conn.query);
                    finalEvidence = result.finalPaths;
                    removedEvidence = result.removedPaths;
                }
                const foto = finalEvidence ? (finalEvidence[0] || null) : prestasiData.foto;

                const [upd] = await conn.query(
                    'UPDATE prestasi SET nama = ?, nis = ?, nama_lomba = ?, foto = ?, kelas = ?, pembina = ?, pembina_id = ?, grha = ?, juara = ?, kategori = ?, jenis_lomba = ?, kategori_lomba = ?, tanggal_pelaksanaan = ?, point = ? WHERE id = ?',
                    [nama, nis, nama_lomba, foto, kelas, resolvedPembinaName, resolvedPembinaId, grha, juara, kategori, jenis_lomba, kategori_lomba, tanggalPelaksanaan, point, prestasiId]
                );
                if (upd.affectedRows === 0) {
                    await conn.rollback();
                    return res.status(404).json({ message: 'Prestasi not found' });
                }
                await setPembinaLinks(conn.query, 'prestasi_pembina', 'prestasi_id', prestasiId, mentorIds);

                // Approved records feed the total: recompute it (same formula as
                // syncIpt.js) so point edits and any pre-existing drift land
                // exactly. Pending records never touched IPT.
                if (prestasiData.status === 'approved') {
                    await recomputeAndStoreIpt(prestasiData.user_id, {
                        jenis: 'prestasi_update',
                        keterangan: `Update Prestasi: ${nama_lomba}`,
                        executor: conn.query,
                        recordType: 'prestasi',
                        recordId: prestasiId,
                    });
                }
                await conn.commit();
                await deleteEvidenceFilesIfOrphan(removedEvidence, { folderHint: 'prestasi' });
            } else {
                // ---- kelompok path: shared fields + membership diff ----
                const [siblings] = await conn.query(
                    'SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, point, status, rejection_reason, created_at FROM prestasi WHERE grup_lomba = ?',
                    [prestasiData.grup_lomba]
                );

                // Resolve the target membership (explicit list, or unchanged).
                let members;
                if (anggota) {
                    members = [];
                    for (const a of anggota) {
                        if (!a || !a.nis) {
                            await conn.rollback();
                            return res.status(400).json({ message: 'Setiap anggota harus memiliki NIS' });
                        }
                        // Throws 400 when the NIS is unknown
                        const memberId = await resolveStudentIdByNis(a.nis, req.user.id);
                        const [studentData] = await conn.query('SELECT id, nama, nis, kelas, grha FROM users WHERE id = ?', [memberId]);
                        members.push(studentData[0]);
                    }
                } else {
                    members = siblings.map((s) => ({ id: s.user_id, nama: s.nama, nis: s.nis, kelas: s.kelas, grha: s.grha }));
                }

                const existingIds = new Set(siblings.map((s) => s.user_id));
                const newIds = new Set(members.map((m) => m.id));
                const kept = siblings.filter((s) => newIds.has(s.user_id));
                const added = members.filter((m) => !existingIds.has(m.id));
                const removed = siblings.filter((s) => !newIds.has(s.user_id));
                const wasApproved = prestasiData.status === 'approved';
                const touchedUserIds = new Set();

                // Group members share one evidence set. The edit modal shows
                // one member's rows, so resolve removals against that set and
                // then mirror the final set onto every surviving member.
                const currentEvidence = await listEvidence('prestasi', prestasiId, conn.query);
                const currentEvidenceIds = new Set(currentEvidence.map((item) => Number(item.id)).filter((id) => id > 0));
                for (const id of new Set(removeIds)) {
                    if (!currentEvidenceIds.has(id)) {
                        await conn.rollback();
                        return res.status(400).json({ message: 'File bukti yang akan dihapus tidak ditemukan pada data ini' });
                    }
                }
                const removeSet = new Set(removeIds);
                const removedEvidenceItems = currentEvidence.filter((item) => item.id && removeSet.has(Number(item.id)));
                const keptEvidenceItems = currentEvidence.filter((item) => !item.id || !removeSet.has(Number(item.id)));
                const evidenceChanged = newEvidence.length > 0 || removedEvidenceItems.length > 0;
                const finalEvidence = [...keptEvidenceItems.map((item) => item.path), ...newEvidence];
                const sharedFoto = evidenceChanged
                    ? (finalEvidence[0] || null)
                    : (siblings[0]?.foto || prestasiData.foto);
                const removedEvidence = evidenceChanged
                    ? removedEvidenceItems.map((item) => item.path)
                    : [];

                // Serialize concurrent mutations of every touched student.
                if (wasApproved) {
                    for (const uid of new Set([...kept.map((s) => s.user_id), ...added.map((m) => m.id), ...removed.map((s) => s.user_id)])) {
                        // eslint-disable-next-line no-await-in-loop
                        await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [uid]);
                    }
                }

                // Shared-field update for surviving rows (identity untouched).
                for (const s of kept) {
                    // eslint-disable-next-line no-await-in-loop
                    await conn.query(
                        'UPDATE prestasi SET nama_lomba = ?, juara = ?, kategori = ?, jenis_lomba = ?, kategori_lomba = ?, pembina = ?, pembina_id = ?, foto = ?, tanggal_pelaksanaan = ?, point = ? WHERE id = ?',
                        [nama_lomba, juara, kategori, jenis_lomba, 'kelompok', resolvedPembinaName, resolvedPembinaId, sharedFoto, tanggalPelaksanaan, point, s.id]
                    );
                    if (evidenceChanged) {
                        // eslint-disable-next-line no-await-in-loop
                        await replaceEvidence('prestasi', s.id, finalEvidence, conn.query);
                    }
                    // eslint-disable-next-line no-await-in-loop
                    await setPembinaLinks(conn.query, 'prestasi_pembina', 'prestasi_id', s.id, mentorIds);
                    touchedUserIds.add(s.user_id);
                }

                // Added members: new rows carrying the shared fields.
                for (const m of added) {
                    // eslint-disable-next-line no-await-in-loop
                    const [addedRow] = await conn.query(
                        'INSERT INTO prestasi (user_id, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [m.id, m.nama, m.nis, nama_lomba, m.kelas || '', resolvedPembinaName, resolvedPembinaId, m.grha || '', juara, kategori, jenis_lomba, 'kelompok', prestasiData.grup_lomba, tanggalPelaksanaan, sharedFoto, point, prestasiData.status]
                    );
                    if (evidenceChanged) {
                        // eslint-disable-next-line no-await-in-loop
                        await replaceEvidence('prestasi', addedRow.insertId, finalEvidence, conn.query);
                    }
                    // eslint-disable-next-line no-await-in-loop
                    await setPembinaLinks(conn.query, 'prestasi_pembina', 'prestasi_id', addedRow.insertId, mentorIds);
                    touchedUserIds.add(m.id);
                }

                // Removed members: rows deleted, IPT reverted when approved.
                for (const s of removed) {
                    // eslint-disable-next-line no-await-in-loop
                    await conn.query('DELETE FROM prestasi WHERE id = ?', [s.id]);
                    // eslint-disable-next-line no-await-in-loop
                    await deleteEvidenceForRecord('prestasi', s.id, conn.query);
                    touchedUserIds.add(s.user_id);
                    if (wasApproved) {
                        // eslint-disable-next-line no-await-in-loop
                        await recomputeAndStoreIpt(s.user_id, {
                            jenis: 'prestasi_delete',
                            keterangan: `Delete Prestasi: ${s.nama_lomba}`,
                            executor: conn.query,
                            skipHistory: true,
                        });
                        // eslint-disable-next-line no-await-in-loop
                        await purgeRecordHistory(s.user_id, 'prestasi', s.id, recordLifecycleKeterangans('prestasi', s), conn.query);
                    }
                }

                // Recompute every touched total when approved (pending never fed IPT).
                if (wasApproved) {
                    for (const uid of touchedUserIds) {
                        // eslint-disable-next-line no-await-in-loop
                        await recomputeAndStoreIpt(uid, {
                            jenis: 'prestasi_update',
                            keterangan: `Update Prestasi kelompok: ${nama_lomba}`,
                            executor: conn.query,
                        });
                    }
                }

                await conn.commit();
                // Removed shared files are orphaned only once no row uses them.
                await deleteEvidenceFilesIfOrphan(removedEvidence, { folderHint: 'prestasi' });
            }

            // Log activity
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'UPDATE_PRESTASI', `Updated prestasi ID ${prestasiId}`]
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        res.json({ message: 'Prestasi updated successfully' });
    } catch (error) {
        console.error(error);
        const status = error.statusCode || 500;
        res.status(status).json({ message: status >= 500 ? 'Server error' : error.message });
    }
});

// Delete prestasi (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const prestasiId = req.params.id;

        const [prestasi] = await conn.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Prestasi not found' });
        }

        const prestasiData = prestasi[0];
        const wasApproved = prestasiData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [prestasiData.user_id]);
        }
        await conn.query('DELETE FROM prestasi WHERE id = ?', [prestasiId]);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) this
        // also heals any pre-existing drift. Pending/rejected records never
        // touched IPT, so nothing more to do for them.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(prestasiData.user_id, {
                jenis: 'prestasi_delete',
                keterangan: `Delete Prestasi: ${prestasiData.nama_lomba}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(prestasiData.user_id, 'prestasi', prestasiId, recordLifecycleKeterangans('prestasi', prestasiData), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_PRESTASI', `Deleted prestasi ID ${prestasiId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file never strand them).
        if (prestasiData.foto) {
            await deletePhotoIfOrphan(db, prestasiData.foto, { folderHint: 'prestasi' });
        }

        res.json({ message: 'Prestasi deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
