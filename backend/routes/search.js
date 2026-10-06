const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../config/database');

// Search students by name or NIS
router.get('/students', auth, async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ message: 'Query parameter is required' });
        }

        // Postgres LIKE is case-sensitive, so use ILIKE. Tokenize multi-word
        // queries: every token must appear in the name (any order), OR the
        // full phrase matches NIS. '!' is ESCAPE to avoid backslash issues.
        const escapeLikePattern = (s) => String(s).replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
        const tokens = String(query).trim().split(/\s+/).filter(Boolean);
        const fullPattern = `%${escapeLikePattern(String(query).trim())}%`;
        let searchClause;
        let searchParams;
        if (tokens.length <= 1) {
            searchClause = `(u.nama ILIKE ? ESCAPE '!' OR u.nis ILIKE ? ESCAPE '!')`;
            searchParams = [fullPattern, fullPattern];
        } else {
            searchClause = `((${tokens.map(() => `u.nama ILIKE ? ESCAPE '!'`).join(' AND ')}) OR u.nis ILIKE ? ESCAPE '!')`;
            searchParams = [...tokens.map((t) => `%${escapeLikePattern(t)}%`), fullPattern];
        }

        // Optimized single query with subqueries instead of N+1
        const [students] = await db.query(`
            SELECT
                u.id,
                u.nama,
                u.nis,
                u.kelas,
                u.grha,
                u.ipt_total,
                COALESCE(prestasi.count, 0) as total_prestasi
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) as count
                FROM prestasi
                WHERE status = 'approved'
                GROUP BY user_id
            ) prestasi ON u.id = prestasi.user_id
            WHERE u.role = 'siswa'
            AND ${searchClause}
            LIMIT 20
        `, searchParams);

        res.json(students);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student details with achievements
router.get('/student/:userId', auth, async (req, res) => {
    try {
        const userId = req.params.userId;

        const [student] = await db.query(
            'SELECT id, nama, nis, kelas, grha, ipt_total FROM users WHERE id = ? AND role = ?',
            [userId, 'siswa']
        );

        if (student.length === 0) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const [prestasi] = await db.query(
            'SELECT * FROM prestasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [userId, 'approved']
        );

        const [organisasi] = await db.query(
            'SELECT * FROM organisasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [userId, 'approved']
        );

        const [event] = await db.query(
            'SELECT * FROM event WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [userId, 'approved']
        );

        res.json({
            student: student[0],
            prestasi,
            organisasi,
            event,
            total_prestasi: prestasi.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// IPT category leaderboards (Top 20) — ranked by approved IPT points.
// Pelanggaran stores deductions as negative points, so it ranks most-negative first.
const LEADERBOARD_CATEGORIES = {
    prestasi: { table: 'prestasi', pointCol: 'point' },
    organisasi: { table: 'organisasi', pointCol: 'point' },
    kepanitiaan: { table: 'kepanitiaan', pointCol: 'point' },
    event: { table: 'event', pointCol: 'point' },
    pelanggaran: { table: 'pelanggaran', pointCol: 'point_dikurangi', order: 'ASC' },
    perilaku: { table: 'perilaku', pointCol: 'point' },
    pembina: { table: 'pembina', special: true } // Special case for pembina leaderboard
};

// Get leaderboard for one IPT category — GET /search/leaderboard/category/:category
router.get('/leaderboard/category/:category', auth, async (req, res) => {
    try {
        // Whitelisted map only — no raw user input reaches the SQL
        const config = LEADERBOARD_CATEGORIES[req.params.category];
        if (!config) {
            return res.status(400).json({ message: 'Kategori tidak valid' });
        }

        // Special case for pembina leaderboard: total IPT earned by the
        // pembina's mentored students (approved prestasi only).
        // Kelompok lomba counts exactly ONCE per group: rows linked by
        // grup_lomba collapse to a single contribution; legacy rows without
        // a group id fall back to matching (nama_lomba, juara, kategori).
        // Individu rows (and legacy NULLs) sum normally — every member keeps
        // full personal IPT; only the pembina total counts the group once.
        // Pembina is joined by id (name match only as legacy fallback).
        if (config.special) {
            const [teachers] = await db.query(`
                SELECT
                    u.id,
                    u.nama,
                    u.nip,
                    u.role,
                    u.foto,
                    u.detail as jabatan,
                    COALESCE(SUM(x.point), 0) as total_point
                FROM users u
                LEFT JOIN (
                    SELECT COALESCE(p.pembina_id, u2.id) AS pembina_ref, p.point
                    FROM prestasi p
                    LEFT JOIN users u2 ON u2.nama = p.pembina AND u2.role IN ('guru', 'pegawai')
                    WHERE p.status = 'approved'
                      AND p.pembina IS NOT NULL AND p.pembina <> ''
                      AND (p.kategori_lomba IS NULL OR p.kategori_lomba <> 'kelompok')
                    UNION ALL
                    SELECT COALESCE(p.pembina_id, u2.id) AS pembina_ref, MAX(p.point) AS point
                    FROM prestasi p
                    LEFT JOIN users u2 ON u2.nama = p.pembina AND u2.role IN ('guru', 'pegawai')
                    WHERE p.status = 'approved'
                      AND p.kategori_lomba = 'kelompok'
                      AND p.pembina IS NOT NULL AND p.pembina <> ''
                    GROUP BY
                        COALESCE(p.pembina_id, u2.id),
                        COALESCE(p.grup_lomba, p.nama_lomba || '|' || COALESCE(p.juara, '') || '|' || COALESCE(p.kategori, ''))
                ) x ON x.pembina_ref = u.id
                WHERE u.role = 'guru' OR u.role = 'pegawai'
                GROUP BY u.id, u.nama, u.nip, u.role, u.foto, u.detail
                HAVING COALESCE(SUM(x.point), 0) > 0
                ORDER BY COALESCE(SUM(x.point), 0) DESC, u.nama ASC
                LIMIT 20
            `);

            console.log('Pembina leaderboard data:', teachers);

            return res.json(teachers.map((teacher, index) => ({
                ...teacher,
                jabatan: teacher.jabatan || 'Guru', // Default to 'Guru' if empty
                total_point: Number(teacher.total_point) || 0,
                rank: index + 1
            })));
        }

        const order = config.order === 'ASC' ? 'ASC' : 'DESC';

        const [students] = await db.query(`
            SELECT
                u.id,
                u.nama,
                u.nis,
                u.kelas,
                u.grha,
                u.foto,
                COALESCE(SUM(t.${config.pointCol}), 0) as total_point
            FROM users u
            JOIN ${config.table} t ON t.user_id = u.id AND t.status = 'approved'
            WHERE u.role = 'siswa'
            GROUP BY u.id, u.nama, u.nis, u.kelas, u.grha, u.foto
            ORDER BY total_point ${order}, u.nama ASC
            LIMIT 20
        `);

        res.json(students.map((student, index) => ({
            ...student,
            total_point: Number(student.total_point) || 0,
            rank: index + 1
        })));
    } catch (error) {
        console.error('Error fetching category leaderboard:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approved prestasi mentored by one pembina (any authenticated user — same
// exposure level as the pembina leaderboard itself). Attribution mirrors the
// leaderboard: pembina_id match, with legacy name-match fallback.
router.get('/leaderboard/pembina/:pembinaId/records', auth, async (req, res) => {
    try {
        const pembinaId = parseInt(req.params.pembinaId, 10);
        if (!Number.isInteger(pembinaId)) {
            return res.status(400).json({ message: 'ID pembina tidak valid' });
        }
        const [teachers] = await db.query(
            "SELECT id, nama FROM users WHERE id = ? AND role IN ('guru', 'pegawai')",
            [pembinaId]
        );
        if (teachers.length === 0) {
            return res.status(404).json({ message: 'Pembina tidak ditemukan' });
        }
        const [rows] = await db.query(
            `SELECT p.id, p.user_id, p.nama_lomba, p.juara, p.kategori,
                    p.jenis_lomba, p.kategori_lomba, p.grup_lomba, p.point,
                    p.foto, p.created_at,
                    u.nama AS student_nama, u.nis AS student_nis, u.kelas AS student_kelas
             FROM prestasi p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN users t ON t.nama = p.pembina AND t.role IN ('guru', 'pegawai')
             WHERE p.status = 'approved'
               AND p.pembina IS NOT NULL AND p.pembina <> ''
               AND COALESCE(p.pembina_id, t.id) = ?
             ORDER BY p.created_at DESC`,
            [pembinaId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching pembina records:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
