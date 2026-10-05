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
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

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
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const prestasiId = req.params.id;

        const [prestasi] = await conn.query('SELECT id, user_id, nama, nis, nama_lomba, foto, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, point, status, rejection_reason, created_at FROM prestasi WHERE id = ?', [prestasiId]);
        if (prestasi.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Prestasi not found' });
        }
        if (prestasi[0].status !== 'pending') {
            await conn.rollback();
            return res.status(400).json({ message: 'Prestasi ini sudah diproses' });
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

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE prestasi SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', newFotoPath, prestasiId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Prestasi ini sudah diproses' });
        }

        // Recompute the total from approved records (same formula as
        // syncIpt.js) — never arithmetic, so double-approvals and drift
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

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE prestasi SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, prestasiId]);

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

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'prestasi', id: prestasiId }, folderHint: 'prestasi' });
        }

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

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE prestasi SET nama = ?, nis = ?, nama_lomba = ?, foto = ?, kelas = ?, pembina = ?, pembina_id = ?, grha = ?, juara = ?, kategori = ?, jenis_lomba = ?, kategori_lomba = ?, point = ? WHERE id = ?',
                [nama, nis, nama_lomba, foto, kelas, resolvedPembinaName, resolvedPembinaId, grha, juara, kategori, jenis_lomba, kategori_lomba, point, prestasiId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Prestasi not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits — and any pre-existing drift — land
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
        const wasApproved = prestasiData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [prestasiData.user_id]);
        }
        await conn.query('DELETE FROM prestasi WHERE id = ?', [prestasiId]);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) — this
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
