const express = require('express');
const router = express.Router();
const { auth, checkInputAccess, superAdminOnly, checkPermission } = require('../middleware/auth');
const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const {
    calculatePerilakuPoints,
    calculatePerilakuPointsFromFields,
    formatPerilakuKarakter
} = require('../constants/points');
const { resolveStudentIdByNis, applyPerilakuIptChange, buildKeterangan } = require('../utils/ipt');
const { movePhotoToApprovedFolder } = require('../utils/fileUtils');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');

// Get all perilaku (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [perilaku] = await db.query(`
            SELECT p.*, u.nama as user_name 
            FROM perilaku p 
            JOIN users u ON p.user_id = u.id 
            ORDER BY p.created_at DESC
        `);
        res.json(perilaku);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's perilaku
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [perilaku] = await db.query(
            'SELECT id, user_id, nama, nis, kelas, grha, karakter_siswa, point, status, rejection_reason, created_at FROM perilaku WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        res.json(perilaku);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create perilaku — always applies directly, no approval queue.
// Whoever holds input access submits an approved row and the student's
// IPT is updated immediately via the standard supersede semantics.
router.post('/', auth, checkPermission('perilaku'), async (req, res) => {
    try {
        const {
            nama,
            nis,
            kelas,
            grha,
            karakter_siswa,
            tanggung_jawab,
            disiplin,
            kepedulian,
            kemandirian,
            spiritual,
            kejujuran,
            kepercayaan_diri
        } = req.body;

        const userId = await resolveStudentIdByNis(nis, req.user.id);
        const karakter = karakter_siswa || formatPerilakuKarakter({
            tanggung_jawab,
            disiplin,
            kepedulian,
            kemandirian,
            spiritual,
            kejujuran,
            kepercayaan_diri
        });
        const point = karakter_siswa
            ? await calculatePerilakuPoints(karakter_siswa)
            : await calculatePerilakuPointsFromFields({
                tanggung_jawab,
                disiplin,
                kepedulian,
                kemandirian,
                spiritual,
                kejujuran,
                kepercayaan_diri
            });

        const [result] = await db.query(
            `INSERT INTO perilaku (user_id, submitted_by, nama, nis, kelas, grha, karakter_siswa, point, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
            [userId, req.user.id, nama, nis, kelas, grha, karakter, point]
        );

        await applyPerilakuIptChange(
            userId,
            point,
            buildKeterangan('perilaku', { karakter_siswa: karakter }),
            result.insertId
        );

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_PERILAKU', `${req.user.nama} (${req.user.role}) directly submitted perilaku for ${nama} (${nis}): ${karakter}`, req.ip);

        res.status(201).json({
            message: 'Perilaku berhasil ditambahkan',
            id: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Update perilaku
router.put('/:id', auth, async (req, res) => {
    try {
        const perilakuId = req.params.id;
        const { nama, nis, kelas, grha, karakter_siswa, tanggung_jawab, disiplin, kepedulian, kemandirian, spiritual, kejujuran, kepercayaan_diri } = req.body;
        
        const [perilaku] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, karakter_siswa, point, status, rejection_reason, created_at FROM perilaku WHERE id = ?', [perilakuId]);
        if (perilaku.length === 0) {
            return res.status(404).json({ message: 'Perilaku not found' });
        }

        const perilakuData = perilaku[0];
        const karakter = karakter_siswa || formatPerilakuKarakter({
            tanggung_jawab,
            disiplin,
            kepedulian,
            kemandirian,
            spiritual,
            kejujuran,
            kepercayaan_diri
        });
        const point = karakter_siswa
            ? await calculatePerilakuPoints(karakter_siswa)
            : await calculatePerilakuPointsFromFields({
                tanggung_jawab,
                disiplin,
                kepedulian,
                kemandirian,
                spiritual,
                kejujuran,
                kepercayaan_diri
            });

        await db.query(
            'UPDATE perilaku SET nama = ?, nis = ?, kelas = ?, grha = ?, karakter_siswa = ?, point = ? WHERE id = ?',
            [nama, nis, kelas, grha, karakter, point, perilakuId]
        );

        // If status is approved and point changed, update user IPT
        if (perilakuData.status === 'approved' && perilakuData.point !== point) {
            const pointDiff = point - perilakuData.point;
            const [userBefore] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [perilakuData.user_id]);
            const iptSebelum = userBefore[0].ipt_total;
            const iptSesudah = iptSebelum + pointDiff;
            
            // Update user IPT (can go negative due to pelanggaran, can recover with perilaku)
            await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, perilakuData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [perilakuData.user_id, 'perilaku_update', pointDiff, iptSebelum, iptSesudah, `Update Perilaku: ${karakter}`]
            );
        }

        // Log activity
        await logActivity(req.user.id, 'UPDATE_PERILAKU', `User ${req.user.nama} (${req.user.role}) updated perilaku ID ${perilakuId}`, req.ip);

        res.json({ message: 'Perilaku updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete perilaku (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const perilakuId = req.params.id;

        const [perilaku] = await conn.query('SELECT id, user_id, nama, nis, kelas, grha, karakter_siswa, point, status, rejection_reason, created_at FROM perilaku WHERE id = ?', [perilakuId]);
        if (perilaku.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Perilaku not found' });
        }

        const perilakuData = perilaku[0];

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js). Note the breakdown only counts the LATEST approved
        // perilaku, so deleting a non-latest one correctly changes nothing.
        if (perilakuData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [perilakuData.user_id]);
            await conn.query('DELETE FROM perilaku WHERE id = ?', [perilakuId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(perilakuData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, perilakuData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [perilakuData.user_id, 'perilaku_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Perilaku: ${perilakuData.karakter_siswa}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM perilaku WHERE id = ?', [perilakuId]);
        }

        await conn.commit();

        // Log activity (after commit — logActivity writes via the pool and
        // swallows its own errors, so it must never run inside the txn).
        await logActivity(req.user.id, 'DELETE_PERILAKU', `SuperAdmin ${req.user.nama} deleted perilaku for ${perilakuData.nama} (${perilakuData.nis}): ${perilakuData.karakter_siswa}`, req.ip);

        res.json({ message: 'Perilaku deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
