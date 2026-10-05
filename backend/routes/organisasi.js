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
    try {
        const organisasiId = req.params.id;
        
        const [organisasi] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status, rejection_reason, created_at FROM organisasi WHERE id = ?', [organisasiId]);
        if (organisasi.length === 0) {
            return res.status(404).json({ message: 'Organisasi not found' });
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
        
        // Update status and photo path
        await db.query('UPDATE organisasi SET status = ?, foto = ? WHERE id = ?', ['approved', newFotoPath, organisasiId]);
        
        // Update user IPT (can go negative due to pelanggaran, can recover with organisasi)
        const [user] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [organisasiData.user_id]);
        const iptSebelum = user[0].ipt_total;
        const iptSesudah = iptSebelum + organisasiData.point;
        
        await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, organisasiData.user_id]);
        
        await db.query(
            'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
            [organisasiData.user_id, 'organisasi', organisasiData.point, iptSebelum, iptSesudah, buildKeterangan('organisasi', organisasiData)]
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_ORGANISASI', `Approved organisasi ID ${organisasiId}`]
        );

        res.json({ message: 'Organisasi approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject organisasi (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        const organisasiId = req.params.id;
        
        const [rows] = await db.query('SELECT foto FROM organisasi WHERE id = ?', [organisasiId]);

        await db.query('UPDATE organisasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, organisasiId]);

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'organisasi', id: organisasiId }, folderHint: 'organisasi' });
        }

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_ORGANISASI', `Rejected organisasi ID ${organisasiId}`]
        );

        res.json({ message: 'Organisasi rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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

        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (foto) {
                const oldPath = resolveUploadPath(path.join('uploads/organisasi', foto));
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            
            // Rename new file
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${jabatan_organisasi}${ext}`;
            const oldPath = resolveUploadPath(path.join('uploads/organisasi', req.file.filename));
            const newPath = resolveUploadPath(path.join('uploads/organisasi', newFileName));
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        // Recalculate points if jabatan_organisasi changed
        const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);

        await db.query(
            'UPDATE organisasi SET nama = ?, nis = ?, kelas = ?, grha = ?, jabatan_organisasi = ?, kategori_organisasi = ?, foto = ?, point = ? WHERE id = ?',
            [nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi, foto, point, organisasiId]
        );

        // If status is approved and point changed, update user IPT
        if (organisasiData.status === 'approved' && organisasiData.point !== point) {
            const pointDiff = point - organisasiData.point;
            const [userBefore] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [organisasiData.user_id]);
            const iptSebelum = userBefore[0].ipt_total;
            const iptSesudah = iptSebelum + pointDiff;
            
            await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, organisasiData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [organisasiData.user_id, 'organisasi_update', pointDiff, iptSebelum, iptSesudah, `Update Organisasi: ${jabatan_organisasi}`]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_ORGANISASI', `Updated organisasi ID ${organisasiId}`]
        );

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

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js) — this also heals any pre-existing drift.
        if (organisasiData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [organisasiData.user_id]);
            await conn.query('DELETE FROM organisasi WHERE id = ?', [organisasiId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(organisasiData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, organisasiData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [organisasiData.user_id, 'organisasi_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Organisasi: ${organisasiData.jabatan_organisasi}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM organisasi WHERE id = ?', [organisasiId]);
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
