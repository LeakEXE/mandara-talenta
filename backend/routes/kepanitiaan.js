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
        cb(null, ensureUploadSubdir('kepanitiaan'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculateKepanitiaanPoints } = require('../constants/points');
const { buildKeterangan } = require('../utils/ipt');

// Get all kepanitiaan (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [kepanitiaan] = await db.query(`
            SELECT k.*, u.nama as user_name 
            FROM kepanitiaan k 
            JOIN users u ON k.user_id = u.id 
            ORDER BY k.created_at DESC
        `);
        res.json(kepanitiaan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's kepanitiaan
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [kepanitiaan] = await db.query(
            'SELECT * FROM kepanitiaan WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        res.json(kepanitiaan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create kepanitiaan
router.post('/', auth, upload.single('foto'), async (req, res) => {
    try {
        const { nama, nis, kelas, grha, jabatan_kepanitiaan, kategori_kepanitiaan } = req.body;
        let foto = req.file ? req.file.filename : null;

        // Rename file to NIS_Jabatan Kepanitiaan format
        if (req.file && foto) {
            const oldPath = resolveUploadPath(path.join('uploads/kepanitiaan', foto));
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${jabatan_kepanitiaan}${ext}`;
            const newPath = resolveUploadPath(path.join('uploads/kepanitiaan', newFileName));

            // Rename the file
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        const point = await calculateKepanitiaanPoints(jabatan_kepanitiaan);

        const [result] = await db.query(
            'INSERT INTO kepanitiaan (user_id, nama, nis, kelas, grha, jabatan_kepanitiaan, foto, kategori_kepanitiaan, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, kelas, grha, jabatan_kepanitiaan, foto, kategori_kepanitiaan, point]
        );

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'SUBMIT_KEPANITIAAN', `Submitted kepanitiaan: ${jabatan_kepanitiaan}`]
        );

        res.status(201).json({ message: 'Kepanitiaan submitted for approval', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve kepanitiaan
router.put('/:id/approve', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const kepanitiaanId = req.params.id;

        const [kepanitiaan] = await conn.query('SELECT * FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
        if (kepanitiaan.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Kepanitiaan not found' });
        }
        if (kepanitiaan[0].status !== 'pending') {
            await conn.rollback();
            return res.status(400).json({ message: 'Kepanitiaan ini sudah diproses' });
        }

        const kepanitiaanData = kepanitiaan[0];
        let newFotoPath = kepanitiaanData.foto;

        // Move photo to approved folder if it exists
        if (kepanitiaanData.foto) {
            const movedPath = movePhotoToApprovedFolder(path.join('uploads/kepanitiaan', kepanitiaanData.foto), 'kepanitiaan');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE kepanitiaan SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', newFotoPath, kepanitiaanId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Kepanitiaan ini sudah diproses' });
        }

        // Recompute the total from approved records (same formula as
        // syncIpt.js) — never arithmetic, so double-approvals and drift
        // are impossible.
        await recomputeAndStoreIpt(kepanitiaanData.user_id, {
            jenis: 'kepanitiaan',
            keterangan: buildKeterangan('kepanitiaan', kepanitiaanData),
            executor: conn.query,
            recordType: 'kepanitiaan',
            recordId: kepanitiaanId,
        });

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_KEPANITIAAN', `Approved kepanitiaan ID ${kepanitiaanId}`]
        );

        await conn.commit();

        res.json({ message: 'Kepanitiaan approved successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Reject kepanitiaan
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { rejection_reason } = req.body;
        const kepanitiaanId = req.params.id;

        const [rows] = await conn.query('SELECT id, user_id, foto, status, jabatan_kepanitiaan FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Kepanitiaan not found' });
        }
        const wasApproved = rows[0].status === 'approved';

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE kepanitiaan SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, kepanitiaanId]);

        // A rejected record stops counting: recompute WITHOUT a tombstone
        // row ('*_reject' is not in the ipt_history CHECK list), then remove
        // every history trace of this record like a delete does.
        if (wasApproved) {
            await recomputeAndStoreIpt(rows[0].user_id, {
                jenis: 'kepanitiaan_reject',
                keterangan: `Reject Kepanitiaan: ${rejection_reason || 'Tanpa alasan'}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(rows[0].user_id, 'kepanitiaan', kepanitiaanId, recordLifecycleKeterangans('kepanitiaan', rows[0]), conn.query);
        }

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_KEPANITIAAN', `Rejected kepanitiaan ID ${kepanitiaanId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'kepanitiaan', id: kepanitiaanId }, folderHint: 'kepanitiaan' });
        }

        res.json({ message: 'Kepanitiaan rejected' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Update kepanitiaan
router.put('/:id', auth, upload.single('foto'), async (req, res) => {
    try {
        const kepanitiaanId = req.params.id;
        const { nama, nis, kelas, grha, jabatan_kepanitiaan, kategori_kepanitiaan } = req.body;
        
        const [kepanitiaan] = await db.query('SELECT * FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
        if (kepanitiaan.length === 0) {
            return res.status(404).json({ message: 'Kepanitiaan not found' });
        }

        const kepanitiaanData = kepanitiaan[0];
        let foto = kepanitiaanData.foto;

        // Swap evidence for the new upload (keeps the timestamp-unique
        // multer name; approved rows land in approved/).
        if (req.file) {
            const next = await replaceEvidenceFile(db, {
                oldFoto: foto,
                uploadedFilename: req.file.filename,
                recordType: 'kepanitiaan',
                approved: kepanitiaanData.status === 'approved',
                exclude: { table: 'kepanitiaan', id: kepanitiaanId }
            });
            if (next) foto = next;
        }

        // Recalculate points if jabatan_kepanitiaan changed
        const point = await calculateKepanitiaanPoints(jabatan_kepanitiaan);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE kepanitiaan SET nama = ?, nis = ?, kelas = ?, grha = ?, jabatan_kepanitiaan = ?, kategori_kepanitiaan = ?, foto = ?, point = ? WHERE id = ?',
                [nama, nis, kelas, grha, jabatan_kepanitiaan, kategori_kepanitiaan, foto, point, kepanitiaanId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Kepanitiaan not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits — and any pre-existing drift — land
            // exactly. Pending records never touched IPT.
            if (kepanitiaanData.status === 'approved') {
                await recomputeAndStoreIpt(kepanitiaanData.user_id, {
                    jenis: 'kepanitiaan_update',
                    keterangan: `Update Kepanitiaan: ${jabatan_kepanitiaan}`,
                    executor: conn.query,
                    recordType: 'kepanitiaan',
                    recordId: kepanitiaanId,
                });
            }

            // Log activity
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'UPDATE_KEPANITIAAN', `Updated kepanitiaan ID ${kepanitiaanId}`]
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        res.json({ message: 'Kepanitiaan updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete kepanitiaan (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const kepanitiaanId = req.params.id;

        const [kepanitiaan] = await conn.query('SELECT * FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
        if (kepanitiaan.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Kepanitiaan not found' });
        }

        const kepanitiaanData = kepanitiaan[0];
        const wasApproved = kepanitiaanData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [kepanitiaanData.user_id]);
        }
        await conn.query('DELETE FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) — this
        // also heals any pre-existing drift. Pending/rejected records never
        // touched IPT, so nothing more to do for them.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(kepanitiaanData.user_id, {
                jenis: 'kepanitiaan_delete',
                keterangan: `Delete Kepanitiaan: ${kepanitiaanData.jabatan_kepanitiaan}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(kepanitiaanData.user_id, 'kepanitiaan', kepanitiaanId, recordLifecycleKeterangans('kepanitiaan', kepanitiaanData), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_KEPANITIAAN', `Deleted kepanitiaan ID ${kepanitiaanId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file — never strand them).
        if (kepanitiaanData.foto) {
            await deletePhotoIfOrphan(db, kepanitiaanData.foto, { folderHint: 'kepanitiaan' });
        }

        res.json({ message: 'Kepanitiaan deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
