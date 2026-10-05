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
        cb(null, ensureUploadSubdir('prestasi'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculatePrestasiPoints } = require('../constants/points');
const { buildKeterangan, resolvePembina } = require('../utils/ipt');

// Get all prestasi (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [prestasi] = await db.query(`
            SELECT p.*, u.nama as user_name 
            FROM prestasi p 
            JOIN users u ON p.user_id = u.id 
            ORDER BY p.created_at DESC
        `);
        res.json(prestasi);
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
            'SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, point, status, rejection_reason, created_at FROM prestasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        res.json(prestasi);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create prestasi
router.post('/', auth, upload.single('foto'), async (req, res) => {
    try {
        const { nama, nis, nama_lomba, kelas, pembina, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        let foto = req.file ? req.file.filename : null;

        // Rename file to NIS_Nama Lomba format
        if (req.file && foto) {
            const oldPath = resolveUploadPath(path.join('uploads/prestasi', foto));
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${nama_lomba}${ext}`;
            const newPath = resolveUploadPath(path.join('uploads/prestasi', newFileName));

            // Rename the file
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        const point = await calculatePrestasiPoints(juara, kategori);

        const { id: resolvedPembinaId, nama: resolvedPembinaName } = await resolvePembina(req.body.pembina_id, pembina);

        const [result] = await db.query(
            'INSERT INTO prestasi (user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, nama_lomba, foto, kelas, resolvedPembinaName, resolvedPembinaId, grha, juara, kategori, jenis_lomba, kategori_lomba, point]
        );

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
    try {
        const prestasiId = req.params.id;
        
        const [prestasi] = await db.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            return res.status(404).json({ message: 'Prestasi not found' });
        }

        const prestasiData = prestasi[0];
        let newFotoPath = prestasiData.foto;
        
        // Move photo to approved folder if it exists
        if (prestasiData.foto) {
            const movedPath = movePhotoToApprovedFolder(path.join('uploads/prestasi', prestasiData.foto), 'prestasi');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }
        
        // Update status and photo path
        await db.query('UPDATE prestasi SET status = ?, foto = ? WHERE id = ?', ['approved', newFotoPath, prestasiId]);
        
        // Update user IPT (can go negative due to pelanggaran, can recover with prestasi)
        const [user] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [prestasiData.user_id]);
        const iptSebelum = user[0].ipt_total;
        const iptSesudah = iptSebelum + prestasiData.point;
        
        await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, prestasiData.user_id]);
        
        // Log IPT history
        await db.query(
            'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
            [prestasiData.user_id, 'prestasi', prestasiData.point, iptSebelum, iptSesudah, buildKeterangan('prestasi', prestasiData)]
        );

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_PRESTASI', `Approved prestasi ID ${prestasiId}`]
        );

        res.json({ message: 'Prestasi approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject prestasi (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        const prestasiId = req.params.id;
        
        const [rows] = await db.query('SELECT foto FROM prestasi WHERE id = ?', [prestasiId]);

        await db.query('UPDATE prestasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, prestasiId]);

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'prestasi', id: prestasiId }, folderHint: 'prestasi' });
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_PRESTASI', `Rejected prestasi ID ${prestasiId}`]
        );

        res.json({ message: 'Prestasi rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update prestasi (for superadmin)
router.put('/:id', auth, upload.single('foto'), async (req, res) => {
    try {
        const prestasiId = req.params.id;
        const { nama, nis, nama_lomba, kelas, pembina, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        
        const [prestasi] = await db.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            return res.status(404).json({ message: 'Prestasi not found' });
        }

        const prestasiData = prestasi[0];
        let foto = prestasiData.foto;

        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (foto) {
                const oldPath = resolveUploadPath(path.join('uploads/prestasi', foto));
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            
            // Rename new file
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${nama_lomba}${ext}`;
            const oldPath = resolveUploadPath(path.join('uploads/prestasi', req.file.filename));
            const newPath = resolveUploadPath(path.join('uploads/prestasi', newFileName));
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        // Recalculate points if juara or kategori changed
        const point = await calculatePrestasiPoints(juara, kategori);

        // Keep pembina link consistent when the name changes
        const { id: resolvedPembinaId, nama: resolvedPembinaName } = await resolvePembina(req.body.pembina_id, pembina);

        await db.query(
            'UPDATE prestasi SET nama = ?, nis = ?, nama_lomba = ?, foto = ?, kelas = ?, pembina = ?, pembina_id = ?, grha = ?, juara = ?, kategori = ?, jenis_lomba = ?, kategori_lomba = ?, point = ? WHERE id = ?',
            [nama, nis, nama_lomba, foto, kelas, resolvedPembinaName, resolvedPembinaId, grha, juara, kategori, jenis_lomba, kategori_lomba, point, prestasiId]
        );

        // If status is approved and point changed, update user IPT
        if (prestasiData.status === 'approved' && prestasiData.point !== point) {
            const pointDiff = point - prestasiData.point;
            await db.query('UPDATE users SET ipt_total = ipt_total + ? WHERE id = ?', [pointDiff, prestasiData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [prestasiData.user_id, 'prestasi_update', pointDiff, prestasiData.ipt_sebelum || prestasiData.ipt_total, prestasiData.ipt_total + pointDiff, `Update Prestasi: ${nama_lomba}`]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_PRESTASI', `Updated prestasi ID ${prestasiId}`]
        );

        res.json({ message: 'Prestasi updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete prestasi (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const prestasiId = req.params.id;

        const [prestasi] = await conn.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Prestasi not found' });
        }

        const prestasiData = prestasi[0];

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js) — this also heals any pre-existing drift.
        if (prestasiData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [prestasiData.user_id]);
            await conn.query('DELETE FROM prestasi WHERE id = ?', [prestasiId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(prestasiData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, prestasiData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [prestasiData.user_id, 'prestasi_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Prestasi: ${prestasiData.nama_lomba}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM prestasi WHERE id = ?', [prestasiId]);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_PRESTASI', `Deleted prestasi ID ${prestasiId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file — never strand them).
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
