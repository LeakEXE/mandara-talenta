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
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

// Get all perilaku (for approvals) — server-side pagination + filters
router.get('/all', auth, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = (page - 1) * limit;

        const where = [];
        const params = [];

        if (req.query.search) {
            where.push('(p.nama ILIKE ? OR p.nis ILIKE ? OR p.karakter_siswa ILIKE ? OR p.status ILIKE ?)');
            const q = `%${req.query.search}%`;
            params.push(q, q, q, q);
        }
        if (req.query.status && req.query.status !== 'semua') {
            where.push('p.status = ?');
            params.push(req.query.status);
        }
        if (req.query.karakter_siswa && req.query.karakter_siswa !== 'semua') {
            where.push('p.karakter_siswa = ?');
            params.push(req.query.karakter_siswa);
        }
        if (req.query.date_from) {
            where.push('p.created_at >= ?');
            params.push(req.query.date_from);
        }
        if (req.query.date_to) {
            where.push('p.created_at <= ?');
            params.push(req.query.date_to);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const [countRows] = await db.query(`SELECT COUNT(*) as total FROM perilaku p ${whereSql}`, params);
        const total = countRows[0].total;

        const [perilaku] = await db.query(`
            SELECT p.*, u.nama as user_name 
            FROM perilaku p 
            JOIN users u ON p.user_id = u.id 
            ${whereSql}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json({
            data: perilaku,
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

// Create perilaku always applies directly, no approval queue.
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

        // Empty NIS used to fall through to resolveStudentIdByNis' self-fallback,
        // filing the record under the submitter with blank identity.
        for (const f of ['nama', 'nis', 'grha']) {
            if (req.body?.[f] === undefined || req.body?.[f] === null || String(req.body[f]).trim() === '') {
                const error = new Error(`Field wajib diisi: ${f}`);
                error.statusCode = 400;
                throw error;
            }
        }
        const hasKarakter = (karakter_siswa && String(karakter_siswa).trim() !== '') ||
            [tanggung_jawab, disiplin, kepedulian, kemandirian, spiritual, kejujuran, kepercayaan_diri]
                .some((v) => v !== undefined && v !== null && String(v).trim() !== '');
        if (!hasKarakter) {
            const error = new Error('Field wajib diisi: karakter_siswa');
            error.statusCode = 400;
            throw error;
        }

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

        const conn = await db.getConnection();
        let insertedId = null;
        try {
            await conn.beginTransaction();
            const [result] = await conn.query(
                `INSERT INTO perilaku (user_id, submitted_by, nama, nis, kelas, grha, karakter_siswa, point, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                [userId, req.user.id, nama, nis, kelas, grha, karakter, point]
            );
            insertedId = result.insertId;

            await applyPerilakuIptChange(
                userId,
                point,
                buildKeterangan('perilaku', { karakter_siswa: karakter }),
                result.insertId,
                conn.query,
                { type: 'perilaku', id: result.insertId }
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_PERILAKU', `${req.user.nama} (${req.user.role}) directly submitted perilaku for ${nama} (${nis}): ${karakter}`, req.ip);

        res.status(201).json({
            message: 'Perilaku berhasil ditambahkan',
            id: insertedId
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

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE perilaku SET nama = ?, nis = ?, kelas = ?, grha = ?, karakter_siswa = ?, point = ? WHERE id = ?',
                [nama, nis, kelas, grha, karakter, point, perilakuId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Perilaku not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js). Only the latest approved perilaku counts, so
            // editing a non-latest one correctly changes nothing the old
            // diff arithmetic got that case wrong.
            if (perilakuData.status === 'approved') {
                await recomputeAndStoreIpt(perilakuData.user_id, {
                    jenis: 'perilaku_update',
                    keterangan: `Update Perilaku: ${karakter}`,
                    executor: conn.query,
                    recordType: 'perilaku',
                    recordId: perilakuId,
                });
            }

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        // Log activity (after commit logActivity writes via the pool and
        // swallows its own errors, so it must never run inside the txn).
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
        const wasApproved = perilakuData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [perilakuData.user_id]);
        }
        await conn.query('DELETE FROM perilaku WHERE id = ?', [perilakuId]);

        // Recompute from the remaining approved records (same formula as
        // syncIpt.js). Note the breakdown only counts the LATEST approved
        // perilaku, so deleting a non-latest one correctly changes nothing.
        // Pending/rejected records never touched IPT.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(perilakuData.user_id, {
                jenis: 'perilaku_delete',
                keterangan: `Delete Perilaku: ${perilakuData.karakter_siswa}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(perilakuData.user_id, 'perilaku', perilakuId, recordLifecycleKeterangans('perilaku', perilakuData), conn.query);
        }

        await conn.commit();

        // Log activity (after commit logActivity writes via the pool and
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
