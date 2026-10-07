const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../config/database');

// Get dashboard statistics
router.get('/stats', auth, async (req, res) => {
    try {
        // Run independent queries in parallel for better performance
        const [
            [totalStudents],
            [totalTeachers],
            [byGrha],
            [byKelas],
            [prestasiCounts],
            [totalPelanggaran],
            [pelanggaranByGrha],
            [pelanggaranByKelas],
            [activityCounts],
            [iptStats],
            [topIptStudents]
        ] = await Promise.all([
            // Total students
            db.query("SELECT COUNT(*) as count FROM users WHERE role = 'siswa'"),

            // Total teachers
            db.query("SELECT COUNT(*) as count FROM users WHERE role = 'guru' OR role = 'pegawai'"),

            // Total by grha
            db.query(`
                SELECT grha, COUNT(*) as count
                FROM users
                WHERE role = 'siswa' AND grha IS NOT NULL
                GROUP BY grha
            `),

            // Total by kelas
            db.query(`
                SELECT kelas, COUNT(*) as count
                FROM users
                WHERE role = 'siswa' AND kelas IS NOT NULL AND is_graduated = 0
                GROUP BY kelas
                ORDER BY kelas
            `),

            // Prestasi count (single category no more akademik/nonakademik split)
            db.query(`
                SELECT COUNT(*) as total
                FROM prestasi
                WHERE status = 'approved'
            `),

            // Total pelanggaran
            db.query("SELECT COUNT(*) as count FROM pelanggaran WHERE status = 'approved'"),

            // Total pelanggaran by grha
            db.query(`
                SELECT u.grha, COUNT(p.id) as count
                FROM users u
                LEFT JOIN pelanggaran p ON u.id = p.user_id AND p.status = 'approved'
                WHERE u.role = 'siswa' AND u.grha IS NOT NULL
                GROUP BY u.grha
            `),

            // Total pelanggaran by kelas (mirrors the grha query)
            db.query(`
                SELECT u.kelas, COUNT(p.id) as count
                FROM users u
                LEFT JOIN pelanggaran p ON u.id = p.user_id AND p.status = 'approved'
                WHERE u.role = 'siswa' AND u.kelas IS NOT NULL
                GROUP BY u.kelas
                ORDER BY u.kelas
            `),

            // Activity counts (combined query for organisasi, kepanitiaan, event, perilaku)
            db.query(`
                SELECT
                    (SELECT COUNT(*) FROM organisasi WHERE status = 'approved') as organisasi,
                    (SELECT COUNT(*) FROM kepanitiaan WHERE status = 'approved') as kepanitiaan,
                    (SELECT COUNT(*) FROM event WHERE status = 'approved') as event,
                    (SELECT COUNT(*) FROM perilaku WHERE status = 'approved') as perilaku,
                    (SELECT COALESCE(SUM(point), 0) FROM prestasi WHERE status = 'approved') as points_prestasi,
                    (SELECT COALESCE(SUM(point), 0) FROM organisasi WHERE status = 'approved') as points_organisasi,
                    (SELECT COALESCE(SUM(point), 0) FROM kepanitiaan WHERE status = 'approved') as points_kepanitiaan,
                    (SELECT COALESCE(SUM(point), 0) FROM event WHERE status = 'approved') as points_event
            `),

            // IPT Statistics
            db.query(`
                SELECT
                    AVG(ipt_total) as rata_rata,
                    MAX(ipt_total) as tertinggi,
                    MIN(ipt_total) as terendah
                FROM users
                WHERE role = 'siswa' AND is_graduated = 0 AND ipt_total IS NOT NULL
            `),

            // Siswa dengan IPT tertinggi
            db.query(`
                SELECT id, nama, nis, kelas, grha, foto, ipt_total
                FROM users
                WHERE role = 'siswa' AND is_graduated = 0 AND ipt_total IS NOT NULL
                ORDER BY ipt_total DESC
                LIMIT 5
            `)
        ]);

        res.json({
            total_students: totalStudents[0].count,
            total_teachers: totalTeachers[0].count,
            by_grha: byGrha,
            by_kelas: byKelas,
            total_prestasi: prestasiCounts[0].total || 0,
            pelanggaran_by_grha: pelanggaranByGrha,
            pelanggaran_by_kelas: pelanggaranByKelas,
            total_pelanggaran: totalPelanggaran[0].count,
            total_organisasi: activityCounts[0].organisasi || 0,
            total_kepanitiaan: activityCounts[0].kepanitiaan || 0,
            total_event: activityCounts[0].event || 0,
            total_perilaku: activityCounts[0].perilaku || 0,
            points_prestasi: Number(activityCounts[0].points_prestasi) || 0,
            points_organisasi: Number(activityCounts[0].points_organisasi) || 0,
            points_kepanitiaan: Number(activityCounts[0].points_kepanitiaan) || 0,
            points_event: Number(activityCounts[0].points_event) || 0,
            ipt_stats: {
                rata_rata: Math.round(iptStats[0].rata_rata || 0),
                tertinggi: iptStats[0].tertinggi || 0,
                terendah: iptStats[0].terendah || 0
            },
            top_ipt_students: topIptStudents
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
