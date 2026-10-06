const express = require('express');
const router = express.Router();
const { auth, checkInputAccess, superAdminOnly, checkPermission } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { calculatePelanggaranPoints } = require('../constants/points');
const { resolveStudentIdByNis } = require('../utils/ipt');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan, evidenceSourcePath, replaceEvidenceFile } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('pelanggaran'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });

// Get all pelanggaran (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [pelanggaran] = await db.query(`
            SELECT p.*, u.nama as user_name 
            FROM pelanggaran p 
            JOIN users u ON p.user_id = u.id 
            ORDER BY p.created_at DESC
        `);
        res.json(pelanggaran);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's pelanggaran
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [pelanggaran] = await db.query(
            'SELECT * FROM pelanggaran WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        res.json(pelanggaran);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create pelanggaran
router.post('/', auth, checkPermission('pelanggaran'), upload.single('foto'), async (req, res) => {
    try {
        const { nama, nis, kelas, grha, keterangan, jenis_pelanggaran } = req.body;
        let foto = req.file ? req.file.filename : null;

        // Rename file to NIS_Keterangan_UniqueId format
        if (req.file && foto) {
            const oldPath = resolveUploadPath(path.join('uploads/pelanggaran', foto));
            const ext = path.extname(req.file.originalname);
            const uniqueId = Date.now().toString(36);
            const newFileName = `${nis}_${keterangan}_${uniqueId}${ext}`;
            const newPath = resolveUploadPath(path.join('uploads/pelanggaran', newFileName));

            // Rename the file
            fs.renameSync(oldPath, newPath);
            // Store the canonical full relative path (bare names break
            // viewers that concatenate the URL directly).
            foto = `uploads/pelanggaran/${newFileName}`;
        }

        const point_dikurangi = await calculatePelanggaranPoints(jenis_pelanggaran);
        const userId = await resolveStudentIdByNis(nis, req.user.id);

        const [result] = await db.query(
            'INSERT INTO pelanggaran (user_id, submitted_by, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, req.user.id, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi]
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'SUBMIT_PELANGGARAN', `Submitted pelanggaran: ${jenis_pelanggaran}`]
        );

        res.status(201).json({ message: 'Pelanggaran submitted for approval', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Approve pelanggaran
router.put('/:id/approve', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const pelanggaranId = req.params.id;

        const [pelanggaran] = await conn.query(
            'SELECT * FROM pelanggaran WHERE id = ? AND status = ?',
            [pelanggaranId, 'pending']
        );
        if (pelanggaran.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pelanggaran not found or already processed' });
        }

        const pelanggaranData = pelanggaran[0];
        let newFotoPath = pelanggaranData.foto;

        // Move photo to approved folder if it exists. evidenceSourcePath
        // handles every stored shape (full 'uploads/...' or bare filename);
        // a plain path.join here would double full paths and silently skip.
        if (pelanggaranData.foto) {
            const movedPath = movePhotoToApprovedFolder(evidenceSourcePath(pelanggaranData.foto, 'pelanggaran'), 'pelanggaran');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query(
            'UPDATE pelanggaran SET status = ?, foto = ? WHERE id = ? AND status = ?',
            ['approved', newFotoPath, pelanggaranId, 'pending']
        );
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pelanggaran not found or already processed' });
        }

        // Recompute the total from approved records (same formula as
        // syncIpt.js) — never arithmetic, so double-approvals and drift
        // are impossible.
        await recomputeAndStoreIpt(pelanggaranData.user_id, {
            jenis: 'pelanggaran',
            keterangan: `Pelanggaran: ${pelanggaranData.jenis_pelanggaran}`,
            executor: conn.query,
            recordType: 'pelanggaran',
            recordId: pelanggaranId,
        });

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_PELANGGARAN', `Approved pelanggaran ID ${pelanggaranId}`]
        );

        await conn.commit();

        res.json({ message: 'Pelanggaran approved successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Reject pelanggaran
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { rejection_reason } = req.body;
        const pelanggaranId = req.params.id;

        const [rows] = await conn.query('SELECT id, user_id, foto, status, jenis_pelanggaran FROM pelanggaran WHERE id = ?', [pelanggaranId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pelanggaran not found' });
        }
        const wasApproved = rows[0].status === 'approved';

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE pelanggaran SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, pelanggaranId]);

        // A rejected record stops counting: recompute WITHOUT a tombstone
        // row ('*_reject' is not in the ipt_history CHECK list), then remove
        // every history trace of this record like a delete does.
        if (wasApproved) {
            await recomputeAndStoreIpt(rows[0].user_id, {
                jenis: 'pelanggaran_reject',
                keterangan: `Reject Pelanggaran: ${rejection_reason || 'Tanpa alasan'}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(rows[0].user_id, 'pelanggaran', pelanggaranId, recordLifecycleKeterangans('pelanggaran', rows[0]), conn.query);
        }

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_PELANGGARAN', `Rejected pelanggaran ID ${pelanggaranId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'pelanggaran', id: pelanggaranId }, folderHint: 'pelanggaran' });
        }

        res.json({ message: 'Pelanggaran rejected' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Update pelanggaran
router.put('/:id', auth, upload.single('foto'), async (req, res) => {
    try {
        const pelanggaranId = req.params.id;
        const { nama, nis, kelas, grha, keterangan, jenis_pelanggaran } = req.body;
        
        const [pelanggaran] = await db.query('SELECT * FROM pelanggaran WHERE id = ?', [pelanggaranId]);
        if (pelanggaran.length === 0) {
            return res.status(404).json({ message: 'Pelanggaran not found' });
        }

        const pelanggaranData = pelanggaran[0];
        let foto = pelanggaranData.foto;

        // Swap evidence for the new upload (keeps the timestamp-unique
        // multer name; approved rows land in approved/).
        if (req.file) {
            const next = await replaceEvidenceFile(db, {
                oldFoto: foto,
                uploadedFilename: req.file.filename,
                recordType: 'pelanggaran',
                approved: pelanggaranData.status === 'approved',
                exclude: { table: 'pelanggaran', id: pelanggaranId }
            });
            if (next) foto = next;
        }

        // Recalculate points if jenis_pelanggaran changed
        const point_dikurangi = await calculatePelanggaranPoints(jenis_pelanggaran);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE pelanggaran SET nama = ?, nis = ?, kelas = ?, grha = ?, keterangan = ?, foto = ?, jenis_pelanggaran = ?, point_dikurangi = ? WHERE id = ?',
                [nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, pelanggaranId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Pelanggaran not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits — and any pre-existing drift — land
            // exactly. Pending records never touched IPT.
            if (pelanggaranData.status === 'approved') {
                await recomputeAndStoreIpt(pelanggaranData.user_id, {
                    jenis: 'pelanggaran_update',
                    keterangan: `Update Pelanggaran: ${jenis_pelanggaran}`,
                    executor: conn.query,
                    recordType: 'pelanggaran',
                    recordId: pelanggaranId,
                });
            }

            // Log activity
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'UPDATE_PELANGGARAN', `Updated pelanggaran ID ${pelanggaranId}`]
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        res.json({ message: 'Pelanggaran updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete pelanggaran (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const pelanggaranId = req.params.id;

        const [pelanggaran] = await conn.query('SELECT * FROM pelanggaran WHERE id = ?', [pelanggaranId]);
        if (pelanggaran.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pelanggaran not found' });
        }

        const pelanggaranData = pelanggaran[0];
        const wasApproved = pelanggaranData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [pelanggaranData.user_id]);
        }
        await conn.query('DELETE FROM pelanggaran WHERE id = ?', [pelanggaranId]);

        // Approved violations contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) — removing
        // a violation raises the total back and any pre-existing drift is
        // healed as well. Pending/rejected records never touched IPT.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(pelanggaranData.user_id, {
                jenis: 'pelanggaran_delete',
                keterangan: `Delete Pelanggaran: ${pelanggaranData.jenis_pelanggaran}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(pelanggaranData.user_id, 'pelanggaran', pelanggaranId, recordLifecycleKeterangans('pelanggaran', pelanggaranData), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_PELANGGARAN', `Deleted pelanggaran ID ${pelanggaranId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (rows sharing one file must never strand each other).
        if (pelanggaranData.foto) {
            await deletePhotoIfOrphan(db, pelanggaranData.foto, { folderHint: 'pelanggaran' });
        }

        res.json({ message: 'Pelanggaran deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
