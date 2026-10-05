const express = require('express');
const router = express.Router();
const { auth, checkInputAccess, superAdminOnly, checkPermission } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { calculatePelanggaranPoints } = require('../constants/points');
const { resolveStudentIdByNis, applyIptChange } = require('../utils/ipt');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');

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
            foto = newFileName;
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
    try {
        const pelanggaranId = req.params.id;
        
        const [pelanggaran] = await db.query(
            'SELECT * FROM pelanggaran WHERE id = ? AND status = ?',
            [pelanggaranId, 'pending']
        );
        if (pelanggaran.length === 0) {
            return res.status(404).json({ message: 'Pelanggaran not found or already processed' });
        }

        const pelanggaranData = pelanggaran[0];
        let newFotoPath = pelanggaranData.foto;
        
        // Move photo to approved folder if it exists
        if (pelanggaranData.foto) {
            const movedPath = movePhotoToApprovedFolder(path.join('uploads/pelanggaran', pelanggaranData.foto), 'pelanggaran');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\\\/g, '/');
            }
        }
        
        await db.query(
            'UPDATE pelanggaran SET status = ?, foto = ? WHERE id = ? AND status = ?',
            ['approved', newFotoPath, pelanggaranId, 'pending']
        );
        
        await applyIptChange(
            pelanggaranData.user_id,
            'pelanggaran',
            pelanggaranData.point_dikurangi,
            `Pelanggaran: ${pelanggaranData.jenis_pelanggaran}`
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_PELANGGARAN', `Approved pelanggaran ID ${pelanggaranId}`]
        );

        res.json({ message: 'Pelanggaran approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject pelanggaran
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        const pelanggaranId = req.params.id;
        
        const [rows] = await db.query('SELECT foto FROM pelanggaran WHERE id = ?', [pelanggaranId]);

        await db.query('UPDATE pelanggaran SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, pelanggaranId]);

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'pelanggaran', id: pelanggaranId }, folderHint: 'pelanggaran' });
        }

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_PELANGGARAN', `Rejected pelanggaran ID ${pelanggaranId}`]
        );

        res.json({ message: 'Pelanggaran rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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

        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (foto) {
                const oldPath = resolveUploadPath(path.join('uploads/pelanggaran', foto));
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            
            // Rename new file
            const ext = path.extname(req.file.originalname);
            const uniqueId = Date.now().toString(36);
            const newFileName = `${nis}_${keterangan}_${uniqueId}${ext}`;
            const oldPath = resolveUploadPath(path.join('uploads/pelanggaran', req.file.filename));
            const newPath = resolveUploadPath(path.join('uploads/pelanggaran', newFileName));
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        // Recalculate points if jenis_pelanggaran changed
        const point_dikurangi = await calculatePelanggaranPoints(jenis_pelanggaran);

        await db.query(
            'UPDATE pelanggaran SET nama = ?, nis = ?, kelas = ?, grha = ?, keterangan = ?, foto = ?, jenis_pelanggaran = ?, point_dikurangi = ? WHERE id = ?',
            [nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, pelanggaranId]
        );

        // If status is approved and point changed, update user IPT
        if (pelanggaranData.status === 'approved' && pelanggaranData.point_dikurangi !== point_dikurangi) {
            const pointDiff = point_dikurangi - pelanggaranData.point_dikurangi;
            const [userBefore] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [pelanggaranData.user_id]);
            const iptSebelum = userBefore[0].ipt_total;
            const iptSesudah = iptSebelum + pointDiff;
            
            await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, pelanggaranData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [pelanggaranData.user_id, 'pelanggaran_update', pointDiff, iptSebelum, iptSesudah, `Update Pelanggaran: ${jenis_pelanggaran}`]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_PELANGGARAN', `Updated pelanggaran ID ${pelanggaranId}`]
        );

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

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js) — removing a violation raises the total back and
        // any pre-existing drift is healed as well.
        if (pelanggaranData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [pelanggaranData.user_id]);
            await conn.query('DELETE FROM pelanggaran WHERE id = ?', [pelanggaranId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(pelanggaranData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, pelanggaranData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [pelanggaranData.user_id, 'pelanggaran_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Pelanggaran: ${pelanggaranData.jenis_pelanggaran}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM pelanggaran WHERE id = ?', [pelanggaranId]);
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
