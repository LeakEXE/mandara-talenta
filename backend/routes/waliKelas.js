const express = require('express');
const router = express.Router();
const { auth, superAdminOnly, teacherOnly } = require('../middleware/auth');
const db = require('../config/database');
const { validateTahunPelajaran, getCurrentAcademicYear, calculateCurrentClass } = require('../utils/academicYear');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');

function getRequestedAcademicYear(req) {
    const tahunAjaran = req.query.tahun_ajaran || getCurrentAcademicYear();
    if (!validateTahunPelajaran(tahunAjaran)) {
        const error = new Error('Tahun ajaran tidak valid. Format harus YYYY-YYYY (contoh: 2026-2027)');
        error.statusCode = 400;
        throw error;
    }
    return tahunAjaran;
}

// Get all wali kelas assignments (Superadmin)
router.get('/', auth, superAdminOnly, async (req, res) => {
    try {
        const [assignments] = await db.query(`
            SELECT wka.*, u.nama as guru_nama, u.nip, u.foto as guru_foto, u.id as guru_id
            FROM wali_kelas_assignment wka 
            JOIN users u ON wka.guru_id = u.id
            ORDER BY wka.tahun_ajaran DESC, wka.kelas ASC
        `);
        res.json(assignments);
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get available teachers (not assigned as wali kelas)
router.get('/available-teachers', auth, superAdminOnly, async (req, res) => {
    try {
        const tahunAjaran = getRequestedAcademicYear(req);
        const [teachers] = await db.query(`
            SELECT u.id, u.nama, u.nip, u.detail 
            FROM users u
            WHERE (u.role = 'guru' OR u.role = 'pegawai')
            AND u.id NOT IN (
                SELECT guru_id FROM wali_kelas_assignment 
                WHERE tahun_ajaran = ?
            )
        `, [tahunAjaran]);
        res.json(teachers);
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get class statistics (Superadmin - shows all classes)
router.get('/class-statistics', auth, superAdminOnly, async (req, res) => {
    try {
        const tahunAjaran = getRequestedAcademicYear(req);
        // Get all classes with wali kelas
        const [classes] = await db.query(`
            SELECT 
                wka.kelas,
                wka.guru_id,
                u.nama as wali_nama,
                u.nip as wali_nip,
                u.foto as wali_foto
            FROM wali_kelas_assignment wka
            LEFT JOIN users u ON wka.guru_id = u.id
            WHERE wka.tahun_ajaran = ?
            ORDER BY wka.kelas ASC
        `, [tahunAjaran]);

        // Get statistics for each class
        const classStats = await Promise.all(
            classes.map(async (cls) => {
                // Get students in this class based on academic year
                // Calculate the expected class for each student based on their enrollment year
                const [allStudents] = await db.query(`
                    SELECT id, nama, nis, username, grha, ipt_total, foto, tahun_pelajaran, jurusan, kelas as current_kelas
                    FROM users 
                    WHERE role = 'siswa' AND (is_graduated = 0 OR is_graduated IS NULL)
                    ORDER BY nama ASC
                `);

                // Filter students who should be in this class for the selected academic year
                const students = allStudents.filter(student => {
                    const expectedClass = calculateCurrentClass(student.tahun_pelajaran, tahunAjaran);
                    if (!expectedClass) return false; // Graduated students
                    
                    // Build full class name (e.g., "X TKJ 1")
                    const fullClass = student.jurusan ? `${expectedClass} ${student.jurusan}` : expectedClass;
                    return fullClass === cls.kelas;
                });

                const studentIds = students.map(s => s.id);

                // Get total prestasi
                let totalPrestasi = 0;
                if (studentIds.length > 0) {
                    const [prestasiResult] = await db.query(`
                        SELECT COUNT(*) as total 
                        FROM prestasi 
                        WHERE user_id IN (?) AND status = 'approved'
                    `, [studentIds]);
                    totalPrestasi = prestasiResult[0]?.total || 0;
                }

                // Get total event
                let totalEvent = 0;
                if (studentIds.length > 0) {
                    const [eventResult] = await db.query(`
                        SELECT COUNT(*) as total 
                        FROM event 
                        WHERE user_id IN (?) AND status = 'approved'
                    `, [studentIds]);
                    totalEvent = eventResult[0]?.total || 0;
                }

                // Get total organisasi
                let totalOrganisasi = 0;
                if (studentIds.length > 0) {
                    const [orgResult] = await db.query(`
                        SELECT COUNT(*) as total 
                        FROM organisasi 
                        WHERE user_id IN (?) AND status = 'approved'
                    `, [studentIds]);
                    totalOrganisasi = orgResult[0]?.total || 0;
                }

                // Get total kepanitiaan
                let totalKepanitiaan = 0;
                if (studentIds.length > 0) {
                    const [kepResult] = await db.query(`
                        SELECT COUNT(*) as total 
                        FROM kepanitiaan 
                        WHERE user_id IN (?) AND status = 'approved'
                    `, [studentIds]);
                    totalKepanitiaan = kepResult[0]?.total || 0;
                }

                // Get total pelanggaran
                let totalPelanggaran = 0;
                if (studentIds.length > 0) {
                    const [pelanggaranResult] = await db.query(`
                        SELECT COUNT(*) as total 
                        FROM pelanggaran 
                        WHERE user_id IN (?) AND status = 'approved'
                    `, [studentIds]);
                    totalPelanggaran = pelanggaranResult[0]?.total || 0;
                }

                // Get average IPT
                let avgIpt = 80;
                if (students.length > 0) {
                    const totalIpt = students.reduce((sum, s) => sum + (s.ipt_total || 80), 0);
                    avgIpt = Math.round(totalIpt / students.length);
                }

                return {
                    kelas: cls.kelas,
                    wali: {
                        id: cls.guru_id,
                        nama: cls.wali_nama,
                        nip: cls.wali_nip,
                        foto: cls.wali_foto
                    },
                    totalSiswa: students.length,
                    totalPrestasi,
                    totalEvent,
                    totalOrganisasi,
                    totalKepanitiaan,
                    totalPelanggaran,
                    rataRataIPT: avgIpt,
                    students: await Promise.all(students.map(async (student) => {
                        const cardData = await buildIptCardBreakdown(student.id);
                        return {
                            ...student,
                            ipt_points: cardData?.points || {}
                        };
                    }))
                };
            })
        );

        res.json(classStats);
    } catch (error) {
        console.error('Error fetching class statistics:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get wali kelas info by class (for PDF generation)
router.get('/class/:kelas', auth, async (req, res) => {
    try {
        const { kelas } = req.params;
        const tahunAjaran = getRequestedAcademicYear(req);

        const [waliData] = await db.query(`
            SELECT u.nama, u.nip
            FROM wali_kelas_assignment wka
            JOIN users u ON wka.guru_id = u.id
            WHERE wka.kelas = ? AND wka.tahun_ajaran = ?
            ORDER BY wka.id DESC
            LIMIT 1
        `, [kelas, tahunAjaran]);

        if (waliData.length === 0) {
            return res.json({ nama: null, nip: null });
        }

        res.json({
            nama: waliData[0].nama,
            nip: waliData[0].nip
        });
    } catch (error) {
        console.error('Error fetching wali kelas by class:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get my class info (Teacher - wali kelas)
router.get('/my-class', auth, teacherOnly, async (req, res) => {
    try {
        const guruId = req.user.id;
        const currentYear = getCurrentAcademicYear();
        
        console.log('My-class - Guru ID:', guruId, 'Current year:', currentYear);

        // Check if this teacher is assigned as wali kelas
        const [assignment] = await db.query(`
            SELECT * FROM wali_kelas_assignment 
            WHERE guru_id = ? AND tahun_ajaran = ?
            LIMIT 1
        `, [guruId, currentYear]);

        console.log('My-class - Assignment result:', assignment);

        if (assignment.length === 0) {
            console.log('My-class - No assignment found for current year, checking any assignment');
            // Check if there's any assignment at all
            const [anyAssignment] = await db.query(`
                SELECT * FROM wali_kelas_assignment 
                WHERE guru_id = ?
                ORDER BY tahun_ajaran DESC
                LIMIT 1
            `, [guruId]);
            
            console.log('My-class - Any assignment result:', anyAssignment);
            
            if (anyAssignment.length > 0) {
                console.log('My-class - Using assignment from year:', anyAssignment[0].tahun_ajaran);
                // Use the most recent assignment regardless of year
                const kelas = anyAssignment[0].kelas;
                const tahunAjaran = anyAssignment[0].tahun_ajaran;
                
                // Get students for this class
                const [allStudents] = await db.query(`
                    SELECT 
                        u.id, u.nama, u.nis, u.username, u.grha, u.ipt_total, u.ipt_awal,
                        u.alamat, u.no_hp, u.wali_kelas, u.foto, u.created_at, u.tahun_pelajaran, u.jurusan
                    FROM users u
                    WHERE u.role = 'siswa' AND (u.is_graduated = 0 OR u.is_graduated IS NULL)
                    ORDER BY u.nama ASC
                `);

                // Filter students who should be in this class for the assignment's academic year
                const students = allStudents.filter(student => {
                    const expectedClass = calculateCurrentClass(student.tahun_pelajaran, tahunAjaran);
                    if (!expectedClass) return false; // Graduated students
                    
                    // Build full class name (e.g., "X TKJ 1")
                    const fullClass = student.jurusan ? `${expectedClass} ${student.jurusan}` : expectedClass;
                    return fullClass === kelas;
                });

                // Get detailed stats for each student
                const studentsWithStats = await Promise.all(
                    students.map(async (student) => {
                        // Prestasi count
                        const [prestasiCount] = await db.query(`
                            SELECT COUNT(*) as total FROM prestasi 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        // Event count
                        const [eventCount] = await db.query(`
                            SELECT COUNT(*) as total FROM event 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        // Organisasi count
                        const [orgCount] = await db.query(`
                            SELECT COUNT(*) as total FROM organisasi 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        // Kepanitiaan count
                        const [kepCount] = await db.query(`
                            SELECT COUNT(*) as total FROM kepanitiaan 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        // Pelanggaran count
                        const [pelanggaranCount] = await db.query(`
                            SELECT COUNT(*) as total FROM pelanggaran 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        // Perilaku count
                        const [perilakuCount] = await db.query(`
                            SELECT COUNT(*) as total FROM perilaku 
                            WHERE user_id = ? AND status = 'approved'
                        `, [student.id]);

                        return {
                            ...student,
                            stats: {
                                prestasi: prestasiCount[0].total,
                                event: eventCount[0].total,
                                organisasi: orgCount[0].total,
                                kepanitiaan: kepCount[0].total,
                                pelanggaran: pelanggaranCount[0].total,
                                perilaku: perilakuCount[0].total
                            }
                        };
                    })
                );

                // Calculate class totals
                const totalPrestasi = studentsWithStats.reduce((sum, s) => sum + s.stats.prestasi, 0);
                const totalEvent = studentsWithStats.reduce((sum, s) => sum + s.stats.event, 0);
                const totalOrganisasi = studentsWithStats.reduce((sum, s) => sum + s.stats.organisasi, 0);
                const totalKepanitiaan = studentsWithStats.reduce((sum, s) => sum + s.stats.kepanitiaan, 0);
                const totalPelanggaran = studentsWithStats.reduce((sum, s) => sum + s.stats.pelanggaran, 0);
                const avgIpt = students.length > 0 
                    ? Math.round(students.reduce((sum, s) => sum + (s.ipt_total || 80), 0) / students.length)
                    : 80;

                res.json({
                    kelas,
                    tahunAjaran: tahunAjaran,
                    totalSiswa: students.length,
                    totalPrestasi,
                    totalEvent,
                    totalOrganisasi,
                    totalKepanitiaan,
                    totalPelanggaran,
                    rataRataIPT: avgIpt,
                    students: studentsWithStats
                });
                return;
            }
            
            return res.status(404).json({ message: 'Anda belum ditunjuk sebagai wali kelas' });
        }

        const kelas = assignment[0].kelas;

        // Get all students and filter by calculated class for current academic year
        const [allStudents] = await db.query(`
            SELECT 
                u.id, u.nama, u.nis, u.username, u.grha, u.ipt_total, u.ipt_awal,
                u.alamat, u.no_hp, u.wali_kelas, u.foto, u.created_at, u.tahun_pelajaran, u.jurusan
            FROM users u
            WHERE u.role = 'siswa' AND (u.is_graduated = 0 OR u.is_graduated IS NULL)
            ORDER BY u.nama ASC
        `);

        // Filter students who should be in this class for the assignment's academic year
        const students = allStudents.filter(student => {
            const expectedClass = calculateCurrentClass(student.tahun_pelajaran, assignment[0].tahun_ajaran);
            if (!expectedClass) return false; // Graduated students
            
            // Build full class name (e.g., "X TKJ 1")
            const fullClass = student.jurusan ? `${expectedClass} ${student.jurusan}` : expectedClass;
            return fullClass === kelas;
        });

        // Get detailed stats for each student
        const studentsWithStats = await Promise.all(
            students.map(async (student) => {
                // Prestasi count
                const [prestasiCount] = await db.query(`
                    SELECT COUNT(*) as total FROM prestasi 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                // Event count
                const [eventCount] = await db.query(`
                    SELECT COUNT(*) as total FROM event 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                // Organisasi count
                const [orgCount] = await db.query(`
                    SELECT COUNT(*) as total FROM organisasi 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                // Kepanitiaan count
                const [kepCount] = await db.query(`
                    SELECT COUNT(*) as total FROM kepanitiaan 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                // Pelanggaran count
                const [pelanggaranCount] = await db.query(`
                    SELECT COUNT(*) as total FROM pelanggaran 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                // Perilaku count
                const [perilakuCount] = await db.query(`
                    SELECT COUNT(*) as total FROM perilaku 
                    WHERE user_id = ? AND status = 'approved'
                `, [student.id]);

                return {
                    ...student,
                    stats: {
                        prestasi: prestasiCount[0].total,
                        event: eventCount[0].total,
                        organisasi: orgCount[0].total,
                        kepanitiaan: kepCount[0].total,
                        pelanggaran: pelanggaranCount[0].total,
                        perilaku: perilakuCount[0].total
                    }
                };
            })
        );

        // Calculate class totals
        const totalPrestasi = studentsWithStats.reduce((sum, s) => sum + s.stats.prestasi, 0);
        const totalEvent = studentsWithStats.reduce((sum, s) => sum + s.stats.event, 0);
        const totalOrganisasi = studentsWithStats.reduce((sum, s) => sum + s.stats.organisasi, 0);
        const totalKepanitiaan = studentsWithStats.reduce((sum, s) => sum + s.stats.kepanitiaan, 0);
        const totalPelanggaran = studentsWithStats.reduce((sum, s) => sum + s.stats.pelanggaran, 0);
        const avgIpt = students.length > 0 
            ? Math.round(students.reduce((sum, s) => sum + (s.ipt_total || 80), 0) / students.length)
            : 80;

        res.json({
            kelas,
            tahunAjaran: assignment[0].tahun_ajaran,
            totalSiswa: students.length,
            totalPrestasi,
            totalEvent,
            totalOrganisasi,
            totalKepanitiaan,
            totalPelanggaran,
            rataRataIPT: avgIpt,
            students: studentsWithStats
        });
    } catch (error) {
        console.error('Error fetching my class:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Create wali kelas assignment
router.post('/', auth, superAdminOnly, async (req, res) => {
    try {
        const { guru_id, kelas, tahun_ajaran } = req.body;
        if (!validateTahunPelajaran(tahun_ajaran)) {
            return res.status(400).json({ message: 'Tahun ajaran tidak valid. Format harus YYYY-YYYY (contoh: 2026-2027)' });
        }

        const [existingClass] = await db.query(
            'SELECT id FROM wali_kelas_assignment WHERE kelas = ? AND tahun_ajaran = ?',
            [kelas, tahun_ajaran]
        );
        if (existingClass.length > 0) {
            return res.status(400).json({ message: `Kelas ${kelas} sudah memiliki Wali Kelas untuk tahun ajaran ${tahun_ajaran}` });
        }

        const [existingTeacher] = await db.query(
            'SELECT id FROM wali_kelas_assignment WHERE guru_id = ? AND tahun_ajaran = ?',
            [guru_id, tahun_ajaran]
        );
        if (existingTeacher.length > 0) {
            return res.status(400).json({ message: `Guru tersebut sudah menjadi Wali Kelas untuk tahun ajaran ${tahun_ajaran}` });
        }

        // Get guru info for notification and validate role
        const [guru] = await db.query('SELECT nama, nip, role FROM users WHERE id = ?', [guru_id]);
        if (guru.length === 0) {
            return res.status(404).json({ message: 'Guru tidak ditemukan' });
        }
        
        // Only teachers (guru/pegawai) can be wali kelas
        if (guru[0].role !== 'guru' && guru[0].role !== 'pegawai') {
            return res.status(400).json({ message: 'Hanya guru/pegawai yang dapat menjadi Wali Kelas' });
        }
        
        const guruNama = guru[0]?.nama || 'Guru';

        const [result] = await db.query(
            'INSERT INTO wali_kelas_assignment (guru_id, kelas, tahun_ajaran) VALUES (?, ?, ?)',
            [guru_id, kelas, tahun_ajaran]
        );

        // Update the denormalized wali_kelas field in users table
        // This ensures the field is always synced regardless of academic year
        await db.query('UPDATE users SET wali_kelas = ? WHERE id = ?', [kelas, guru_id]);

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'ASSIGN_WALI_KELAS', `Assigned teacher ${guruNama} as wali kelas for ${kelas}`]
        );

        // Notify the assigned teacher only (school-wide broadcast to all
        // staff removed: notifications stay relevant to the recipient).
        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) 
             VALUES (?, 'wali_kelas_assigned', 'Anda Ditunjuk sebagai Wali Kelas', ?, ?, 'wali_kelas')`,
            [guru_id, `Anda telah ditunjuk sebagai Wali Kelas ${kelas} untuk tahun ajaran ${tahun_ajaran}. Sekarang Anda dapat mengakses menu Wali Kelas.`, result.insertId]
        );

        res.status(201).json({ 
            message: `Wali kelas berhasil ditunjuk. ${guruNama} sekarang adalah Wali Kelas ${kelas}`,
            assignmentId: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get students with class mismatches (for debugging)
router.get('/class-mismatches', auth, superAdminOnly, async (req, res) => {
    try {
        const { calculateFullClass } = require('../utils/academicYear');
        const tahunAjaran = getRequestedAcademicYear(req);
        
        // Get all students
        const [students] = await db.query(`
            SELECT id, nama, nis, kelas, tahun_pelajaran, jurusan, is_graduated
            FROM users 
            WHERE role = 'siswa' AND (is_graduated = 0 OR is_graduated IS NULL)
        `);
        
        const mismatches = [];
        
        for (const student of students) {
            if (student.tahun_pelajaran && student.jurusan) {
                const calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan);
                
                if (calculatedClass && calculatedClass !== student.kelas) {
                    mismatches.push({
                        id: student.id,
                        nama: student.nama,
                        nis: student.nis,
                        current_kelas: student.kelas,
                        expected_kelas: calculatedClass,
                        tahun_pelajaran: student.tahun_pelajaran,
                        jurusan: student.jurusan
                    });
                }
            }
        }
        
        res.json({
            tahun_ajaran: tahunAjaran,
            totalStudents: students.length,
            mismatchCount: mismatches.length,
            mismatches
        });
    } catch (error) {
        console.error('Error fetching class mismatches:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete wali kelas assignment
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const assignmentId = req.params.id;

        const [assignment] = await db.query(
            'SELECT guru_id, kelas, tahun_ajaran FROM wali_kelas_assignment WHERE id = ?',
            [assignmentId]
        );

        if (assignment.length === 0) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        const guruId = assignment[0].guru_id;
        const kelas = assignment[0].kelas;

        // Get guru info
        const [guru] = await db.query('SELECT nama FROM users WHERE id = ?', [guruId]);
        const guruNama = guru[0]?.nama || 'Guru';

        // Remove wali_kelas from user (always clear it when assignment is deleted)
        await db.query('UPDATE users SET wali_kelas = NULL WHERE id = ?', [guruId]);

        // Delete assignment
        await db.query('DELETE FROM wali_kelas_assignment WHERE id = ?', [assignmentId]);

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REMOVE_WALI_KELAS', `Removed ${guruNama} as wali kelas for ${kelas}`]
        );

        // Notify the removed teacher
        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) 
             VALUES (?, 'wali_kelas_removed', 'Anda Dicopot sebagai Wali Kelas', ?, ?, 'wali_kelas')`,
            [guruId, `Anda telah dicopot dari jabatan Wali Kelas ${kelas}. Menu Wali Kelas tidak lagi tersedia.`, assignmentId]
        );

        res.json({ 
            message: `${guruNama} berhasil dicopot dari jabatan Wali Kelas ${kelas}` 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
