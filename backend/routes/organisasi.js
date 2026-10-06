const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan, replaceEvidenceFile } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('organisasi'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculateOrganisasiPoints } = require('../constants/points');
const { buildKeterangan } = require('../utils/ipt');

// Get all organisasi (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [organisasi] = await db.query(`
            SELECT o.*, u.nama as user_name 
            FROM organisasi o 
            JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC
        `);
        res.json(organisasi);
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
        res.json(organisasi);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create organisasi
router.post('/', auth, upload.single('foto'), async (req, res) => {
    try {
        const { nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi } = req.body;
        let foto = req.file ? req.file.filename : null;

        // Rename file to NIS_Jabatan Organisasi format
        if (req.file && foto) {
            const oldPath = resolveUploadPath(path.join('uploads/organisasi', foto));
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${jabatan_organisasi}${ext}`;
            const newPath = resolveUploadPath(path.join('uploads/organisasi', newFileName));

            // Rename the file
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);

        const [result] = await db.query(
            'INSERT INTO organisasi (user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point]
        );

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
        let newFotoPath = organisasiData.foto;

        // Move photo to approved folder if it exists
        if (organisasiData.foto) {
            const movedPath = movePhotoToApprovedFolder(path.join('uploads/organisasi', organisasiData.foto), 'organisasi');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE organisasi SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', newFotoPath, organisasiId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Organisasi ini sudah diproses' });
        }

        // Recompute the total from approved records (same formula as
        // syncIpt.js) — never arithmetic, so double-approvals and drift
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

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE organisasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, organisasiId]);

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

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'organisasi', id: organisasiId }, folderHint: 'organisasi' });
        }

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
router.put('/:id', auth, upload.single('foto'), async (req, res) => {
    try {
        const organisasiId = req.params.id;
        const { nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi } = req.body;
        
        const [organisasi] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE id = ?', [organisasiId]);
        if (organisasi.length === 0) {
            return res.status(404).json({ message: 'Organisasi not found' });
        }

        const organisasiData = organisasi[0];
        let foto = organisasiData.foto;

        // Swap evidence for the new upload (keeps the timestamp-unique
        // multer name; approved rows land in approved/).
        if (req.file) {
            const next = await replaceEvidenceFile(db, {
                oldFoto: foto,
                uploadedFilename: req.file.filename,
                recordType: 'organisasi',
                approved: organisasiData.status === 'approved',
                exclude: { table: 'organisasi', id: organisasiId }
            });
            if (next) foto = next;
        }

        // Recalculate points if jabatan_organisasi changed
        const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE organisasi SET nama = ?, nis = ?, kelas = ?, grha = ?, jabatan_organisasi = ?, kategori_organisasi = ?, foto = ?, point = ? WHERE id = ?',
                [nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi, foto, point, organisasiId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Organisasi not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits — and any pre-existing drift — land
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
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        res.json({ message: 'Organisasi updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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
        await conn.query('DELETE FROM organisasi WHERE id = ?', [organisasiId]);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) — this
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

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file — never strand them).
        if (organisasiData.foto) {
            await deletePhotoIfOrphan(db, organisasiData.foto, { folderHint: 'organisasi' });
        }

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
