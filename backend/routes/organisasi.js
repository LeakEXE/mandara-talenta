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
        cb(null, ensureUploadSubdir('organisasi'));
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculateOrganisasiPoints } = require('../constants/points');
const { buildKeterangan } = require('../utils/ipt');

// Get all organisasi (for approvals) — server-side pagination + filters
router.get('/all', auth, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = (page - 1) * limit;

        const where = [];
        const params = [];

        if (req.query.search) {
            where.push('(o.nama ILIKE ? OR o.nis ILIKE ? OR o.jabatan_organisasi ILIKE ? OR o.kategori_organisasi ILIKE ? OR o.status ILIKE ?)');
            const q = `%${req.query.search}%`;
            params.push(q, q, q, q, q);
        }
        if (req.query.status && req.query.status !== 'semua') {
            where.push('o.status = ?');
            params.push(req.query.status);
        }
        if (req.query.jabatan_organisasi && req.query.jabatan_organisasi !== 'semua') {
            where.push('o.jabatan_organisasi = ?');
            params.push(req.query.jabatan_organisasi);
        }
        if (req.query.date_from) {
            where.push('o.created_at >= ?');
            params.push(req.query.date_from);
        }
        if (req.query.date_to) {
            where.push('o.created_at <= ?');
            params.push(req.query.date_to);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [countRows] = await db.query(`SELECT COUNT(*) as total FROM organisasi o ${whereSql}`, params);
        const total = countRows[0].total;

        const [organisasi] = await db.query(`
            SELECT o.*, u.nama as user_name 
            FROM organisasi o 
            JOIN users u ON o.user_id = u.id 
            ${whereSql}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        await attachEvidence(organisasi, 'organisasi');
        res.json({
            data: organisasi,
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

// Get user's organisasi
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [organisasi] = await db.query(
            'SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        await attachEvidence(organisasi, 'organisasi');
        res.json(organisasi);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create organisasi
router.post('/', auth, withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'organisasi'), async (req, res) => {
    try {
        const { nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi } = req.body;
        const fotoPaths = uploadedPaths(req, 'organisasi');

        const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);

        const [result] = await db.query(
            'INSERT INTO organisasi (user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, kelas, grha, jabatan_organisasi, fotoPaths[0] || null, kategori_organisasi, point]
        );
        await replaceEvidence('organisasi', result.insertId, fotoPaths);

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'SUBMIT_ORGANISASI', `Submitted organisasi: ${jabatan_organisasi}`]
        );

        res.status(201).json({ message: 'Organisasi submitted for approval', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve organisasi (superadmin only)
router.put('/:id/approve', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const organisasiId = req.params.id;

        const [organisasi] = await conn.query('SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE id = ?', [organisasiId]);
        if (organisasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Organisasi not found' });
        }
        if (organisasi[0].status !== 'pending') {
            await conn.rollback();
            return res.status(400).json({ message: 'Organisasi ini sudah diproses' });
        }

        const organisasiData = organisasi[0];
        const sourceEvidence = await listEvidence('organisasi', organisasiId, conn.query);
        const movedEvidence = moveEvidenceToApproved(sourceEvidence.map((item) => item.path), 'organisasi');
        const finalEvidence = sourceEvidence.map((item) => movedEvidence.get(item.path) || item.path);

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE organisasi SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', finalEvidence[0] || null, organisasiId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Organisasi ini sudah diproses' });
        }
        await replaceEvidence('organisasi', organisasiId, finalEvidence, conn.query);

        // Recompute the total from approved records (same formula as
        // syncIpt.js) never arithmetic, so double-approvals and drift
        // are impossible.
        await recomputeAndStoreIpt(organisasiData.user_id, {
            jenis: 'organisasi',
            keterangan: buildKeterangan('organisasi', organisasiData),
            executor: conn.query,
            recordType: 'organisasi',
            recordId: organisasiId,
        });

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_ORGANISASI', `Approved organisasi ID ${organisasiId}`]
        );

        await conn.commit();

        res.json({ message: 'Organisasi approved successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Reject organisasi (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { rejection_reason } = req.body;
        const organisasiId = req.params.id;

        const [rows] = await conn.query('SELECT id, user_id, foto, status, jabatan_organisasi FROM organisasi WHERE id = ?', [organisasiId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Organisasi not found' });
        }
        const wasApproved = rows[0].status === 'approved';
        let rejectedEvidence = [];

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE organisasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, organisasiId]);
        rejectedEvidence = (await listEvidence('organisasi', organisasiId, conn.query)).map((item) => item.path);
        await deleteEvidenceForRecord('organisasi', organisasiId, conn.query);

        // A rejected record stops counting: recompute WITHOUT a tombstone
        // row ('*_reject' is not in the ipt_history CHECK list), then remove
        // every history trace of this record like a delete does.
        if (wasApproved) {
            await recomputeAndStoreIpt(rows[0].user_id, {
                jenis: 'organisasi_reject',
                keterangan: `Reject Organisasi: ${rejection_reason || 'Tanpa alasan'}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(rows[0].user_id, 'organisasi', organisasiId, recordLifecycleKeterangans('organisasi', rows[0]), conn.query);
        }

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_ORGANISASI', `Rejected organisasi ID ${organisasiId}`]
        );

        await conn.commit();

        // Delete evidence files when no other row references them anymore.
        await deleteEvidenceFilesIfOrphan(rejectedEvidence, {
            exclude: { table: 'organisasi', id: organisasiId },
            folderHint: 'organisasi'
        });

        res.json({ message: 'Organisasi rejected' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Update organisasi
router.put('/:id', auth, withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'organisasi'), async (req, res) => {
    try {
        const organisasiId = req.params.id;
        const { nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi } = req.body;
        
        const [organisasi] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE id = ?', [organisasiId]);
        if (organisasi.length === 0) {
            return res.status(404).json({ message: 'Organisasi not found' });
        }

        const organisasiData = organisasi[0];
        const uploaded = uploadedPaths(req, 'organisasi');
        const removeIds = parseEvidenceIdList(req.body.remove_evidence_ids);
        await validateEvidenceSelection('organisasi', organisasiId, removeIds, uploaded.length);
        const moved = organisasiData.status === 'approved'
            ? moveEvidenceToApproved(uploaded, 'organisasi')
            : new Map();
        const newEvidence = uploaded.map((p) => moved.get(p) || p);

        // Recalculate points if jabatan_organisasi changed
        const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            let finalEvidence = null;
            let removedEvidence = [];
            if (newEvidence.length > 0 || removeIds.length > 0) {
                const result = await updateEvidenceSelection('organisasi', organisasiId, {
                    removeIds,
                    newPaths: newEvidence
                }, conn.query);
                finalEvidence = result.finalPaths;
                removedEvidence = result.removedPaths;
            }
            const foto = finalEvidence ? (finalEvidence[0] || null) : organisasiData.foto;

            const [upd] = await conn.query(
                'UPDATE organisasi SET nama = ?, nis = ?, kelas = ?, grha = ?, jabatan_organisasi = ?, kategori_organisasi = ?, foto = ?, point = ? WHERE id = ?',
                [nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi, foto, point, organisasiId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Organisasi not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits and any pre-existing drift land
            // exactly. Pending records never touched IPT.
            if (organisasiData.status === 'approved') {
                await recomputeAndStoreIpt(organisasiData.user_id, {
                    jenis: 'organisasi_update',
                    keterangan: `Update Organisasi: ${jabatan_organisasi}`,
                    executor: conn.query,
                    recordType: 'organisasi',
                    recordId: organisasiId,
                });
            }

            // Log activity
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'UPDATE_ORGANISASI', `Updated organisasi ID ${organisasiId}`]
            );

            await conn.commit();
            await deleteEvidenceFilesIfOrphan(removedEvidence, { folderHint: 'organisasi' });
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        res.json({ message: 'Organisasi updated successfully' });
    } catch (error) {
        console.error(error);
        const status = error.statusCode || 500;
        res.status(status).json({ message: status >= 500 ? 'Server error' : error.message });
    }
});

// Delete organisasi (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const organisasiId = req.params.id;

        const [organisasi] = await conn.query('SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE id = ?', [organisasiId]);
        if (organisasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Organisasi not found' });
        }

        const organisasiData = organisasi[0];
        const wasApproved = organisasiData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [organisasiData.user_id]);
        }
        const evidencePaths = (await listEvidence('organisasi', organisasiId, conn.query)).map((item) => item.path);
        await conn.query('DELETE FROM organisasi WHERE id = ?', [organisasiId]);
        await deleteEvidenceForRecord('organisasi', organisasiId, conn.query);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) this
        // also heals any pre-existing drift. Pending/rejected records never
        // touched IPT, so nothing more to do for them.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(organisasiData.user_id, {
                jenis: 'organisasi_delete',
                keterangan: `Delete Organisasi: ${organisasiData.jabatan_organisasi}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(organisasiData.user_id, 'organisasi', organisasiId, recordLifecycleKeterangans('organisasi', organisasiData), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_ORGANISASI', `Deleted organisasi ID ${organisasiId}`]
        );

        await conn.commit();

        // Delete evidence files when no other row references them anymore.
        await deleteEvidenceFilesIfOrphan(evidencePaths, { folderHint: 'organisasi' });

        res.json({ message: 'Organisasi deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
