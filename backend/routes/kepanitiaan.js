const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');

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
router.put('/:id/approve', auth, async (req, res) => {
    try {
        const kepanitiaanId = req.params.id;
        
        const [kepanitiaan] = await db.query('SELECT * FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
        if (kepanitiaan.length === 0) {
            return res.status(404).json({ message: 'Kepanitiaan not found' });
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
        
        // Update status and photo path
        await db.query('UPDATE kepanitiaan SET status = ?, foto = ? WHERE id = ?', ['approved', newFotoPath, kepanitiaanId]);
        
        // Update user IPT (can go negative due to pelanggaran, can recover with kepanitiaan)
        const [user] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [kepanitiaanData.user_id]);
        const iptSebelum = user[0].ipt_total;
        const iptSesudah = iptSebelum + kepanitiaanData.point;
        
        await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, kepanitiaanData.user_id]);
        
        await db.query(
            'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
            [kepanitiaanData.user_id, 'kepanitiaan', kepanitiaanData.point, iptSebelum, iptSesudah, buildKeterangan('kepanitiaan', kepanitiaanData)]
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_KEPANITIAAN', `Approved kepanitiaan ID ${kepanitiaanId}`]
        );

        res.json({ message: 'Kepanitiaan approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject kepanitiaan
router.put('/:id/reject', auth, async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        const kepanitiaanId = req.params.id;
        
        const [rows] = await db.query('SELECT foto FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);

        await db.query('UPDATE kepanitiaan SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, kepanitiaanId]);

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'kepanitiaan', id: kepanitiaanId }, folderHint: 'kepanitiaan' });
        }

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_KEPANITIAAN', `Rejected kepanitiaan ID ${kepanitiaanId}`]
        );

        res.json({ message: 'Kepanitiaan rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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

        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (foto) {
                const oldPath = resolveUploadPath(path.join('uploads/kepanitiaan', foto));
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            
            // Rename new file
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${jabatan_kepanitiaan}${ext}`;
            const oldPath = resolveUploadPath(path.join('uploads/kepanitiaan', req.file.filename));
            const newPath = resolveUploadPath(path.join('uploads/kepanitiaan', newFileName));
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        // Recalculate points if jabatan_kepanitiaan changed
        const point = await calculateKepanitiaanPoints(jabatan_kepanitiaan);

        await db.query(
            'UPDATE kepanitiaan SET nama = ?, nis = ?, kelas = ?, grha = ?, jabatan_kepanitiaan = ?, kategori_kepanitiaan = ?, foto = ?, point = ? WHERE id = ?',
            [nama, nis, kelas, grha, jabatan_kepanitiaan, kategori_kepanitiaan, foto, point, kepanitiaanId]
        );

        // If status is approved and point changed, update user IPT
        if (kepanitiaanData.status === 'approved' && kepanitiaanData.point !== point) {
            const pointDiff = point - kepanitiaanData.point;
            const [userBefore] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [kepanitiaanData.user_id]);
            const iptSebelum = userBefore[0].ipt_total;
            const iptSesudah = iptSebelum + pointDiff;
            
            await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, kepanitiaanData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [kepanitiaanData.user_id, 'kepanitiaan_update', pointDiff, iptSebelum, iptSesudah, `Update Kepanitiaan: ${jabatan_kepanitiaan}`]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_KEPANITIAAN', `Updated kepanitiaan ID ${kepanitiaanId}`]
        );

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

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js) — this also heals any pre-existing drift.
        if (kepanitiaanData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [kepanitiaanData.user_id]);
            await conn.query('DELETE FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(kepanitiaanData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, kepanitiaanData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [kepanitiaanData.user_id, 'kepanitiaan_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Kepanitiaan: ${kepanitiaanData.jabatan_kepanitiaan}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM kepanitiaan WHERE id = ?', [kepanitiaanId]);
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
