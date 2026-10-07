const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth, teacherOnly } = require('../middleware/auth');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');
const { calculateFullClass } = require('../utils/academicYear');
const { generateRaportIPT, generateRaportIPTBuffer, generateLegerIPTBuffer, formatDateIndo } = require('../utils/pdfGenerator');
const { getSchoolSignature } = require('../utils/schoolConfig');
const { getRequestedSemester, getRequestedTahunPelajaran, getCutoffDate } = require('../utils/reportParams');
const path = require('path');
const fs = require('fs');

// Helper function to check if teacher is wali kelas and get their class
const getTeacherWaliKelasClass = async (guruId) => {
    const [assignment] = await db.query(
        `SELECT kelas FROM wali_kelas_assignment 
         WHERE guru_id = ? AND SPLIT_PART(tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
         LIMIT 1`,
        [guruId]
    );
    return assignment.length > 0 ? assignment[0].kelas : null;
};

// Get all students for reports (grouped by class) with full IPT breakdown
router.get('/students', auth, async (req, res) => {
    try {
        let query = `
            SELECT 
                id,
                nama,
                nis,
                kelas,
                ipt_total,
                ipt_awal,
                tahun_pelajaran,
                jurusan,
                is_graduated
            FROM users 
            WHERE role = 'siswa' AND (is_graduated = 0 OR is_graduated IS NULL)
        `;
        
        let queryParams = [];
        
        // If user is a teacher (guru), restrict to their wali kelas class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (waliKelasClass) {
                query += ` AND kelas = ?`;
                queryParams.push(waliKelasClass);
            } else {
                // If teacher is not a wali kelas, return empty array
                return res.json([]);
            }
        }
        
        query += ` ORDER BY kelas, nama`;
        
        const [students] = await db.query(query, queryParams);
        
        // Calculate current class for each student based on tahun_pelajaran
        const studentsWithCalculatedClass = students.map(student => {
            if (student.tahun_pelajaran && student.jurusan) {
                const calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan);
                return {
                    ...student,
                    kelas: calculatedClass || student.kelas // Use calculated class, fallback to stored
                };
            }
            return student;
        });
        
        // Get full IPT breakdown for each student to ensure synchronization
        const studentsWithBreakdown = await Promise.all(
            studentsWithCalculatedClass.map(async (student) => {
                const cardData = await buildIptCardBreakdown(student.id);
                if (cardData) {
                    return {
                        ...student,
                        points: cardData.points,
                        ipt_total: cardData.ipt_total,
                        breakdown_total: cardData.breakdown_total
                    };
                }
                return student;
            })
        );
        
        res.json(studentsWithBreakdown);
    } catch (error) {
        console.error('Error fetching students for reports:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get students filtered by class with full IPT breakdown
router.get('/students/class/:kelas', auth, async (req, res) => {
    try {
        const { kelas } = req.params;
        const query = `
            SELECT 
                id,
                nama,
                nis,
                kelas,
                ipt_total,
                ipt_awal,
                tahun_pelajaran,
                jurusan,
                is_graduated
            FROM users 
            WHERE role = 'siswa' AND kelas = ? AND (is_graduated = 0 OR is_graduated IS NULL)
            ORDER BY nama
        `;
        
        const [students] = await db.query(query, [kelas]);
        
        // Calculate current class for each student based on tahun_pelajaran
        const studentsWithCalculatedClass = students.map(student => {
            if (student.tahun_pelajaran && student.jurusan) {
                const calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan);
                return {
                    ...student,
                    kelas: calculatedClass || student.kelas // Use calculated class, fallback to stored
                };
            }
            return student;
        });
        
        // Get full IPT breakdown for each student to ensure synchronization
        const studentsWithBreakdown = await Promise.all(
            studentsWithCalculatedClass.map(async (student) => {
                const cardData = await buildIptCardBreakdown(student.id);
                if (cardData) {
                    return {
                        ...student,
                        points: cardData.points,
                        ipt_total: cardData.ipt_total,
                        breakdown_total: cardData.breakdown_total
                    };
                }
                return student;
            })
        );
        
        res.json(studentsWithBreakdown);
    } catch (error) {
        console.error('Error fetching students by class:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get class statistics
router.get('/statistics', auth, async (req, res) => {
    try {
        const query = `
            SELECT
                kelas,
                COUNT(*) as total_siswa,
                AVG(ipt_total) as rata_rata_ipt,
                MAX(ipt_total) as ipt_tertinggi,
                MIN(ipt_total) as ipt_terendah
            FROM users
            WHERE role = 'siswa' AND kelas IS NOT NULL
            GROUP BY kelas
            ORDER BY kelas
        `;

        const [stats] = await db.query(query);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching class statistics:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get class IPT report (students sorted by NIS with IPT totals and full breakdown)
router.get('/class-ipt/:kelas', auth, async (req, res) => {
    try {
        const { kelas } = req.params;
        
        // If user is a teacher, check if they can access this class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (!waliKelasClass || waliKelasClass !== kelas) {
                return res.status(403).json({ message: 'Anda hanya dapat mengakses kelas Anda sendiri' });
            }
        }
        
        const query = `
            SELECT
                id,
                nama,
                nis,
                kelas,
                grha,
                ipt_total,
                ipt_awal,
                tahun_pelajaran,
                jurusan,
                is_graduated
            FROM users
            WHERE role = 'siswa' AND kelas = ? AND (is_graduated = 0 OR is_graduated IS NULL)
            ORDER BY CASE WHEN nis ~ '^[0-9]+$' THEN nis::BIGINT ELSE NULL END ASC NULLS LAST, nis ASC
        `;

        const [students] = await db.query(query, [kelas]);
        
        // Calculate current class for each student based on tahun_pelajaran
        const studentsWithCalculatedClass = students.map(student => {
            if (student.tahun_pelajaran && student.jurusan) {
                const calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan);
                return {
                    ...student,
                    kelas: calculatedClass || student.kelas // Use calculated class, fallback to stored
                };
            }
            return student;
        });
        
        // Get full IPT breakdown for each student to ensure synchronization
        const studentsWithBreakdown = await Promise.all(
            studentsWithCalculatedClass.map(async (student) => {
                const cardData = await buildIptCardBreakdown(student.id);
                if (cardData) {
                    return {
                        ...student,
                        points: cardData.points,
                        ipt_total: cardData.ipt_total,
                        breakdown_total: cardData.breakdown_total
                    };
                }
                return student;
            })
        );
        
        res.json(studentsWithBreakdown);
    } catch (error) {
        console.error('Error fetching class IPT report:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Individual Point Talent data for print (superadmin / guru)
router.get('/ipt-card/:userId', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (Number.isNaN(userId)) {
            return res.status(400).json({ message: 'ID siswa tidak valid' });
        }

        // NOTE: no wali-kelas gate here — every guru/pegawai may view any
        // student's card (read-only; same data the leaderboard exposes).
        // Print-scope endpoints below (/reports/students, /class-ipt/:kelas)
        // intentionally stay wali-kelas-restricted.

        const cardData = await buildIptCardBreakdown(userId, getCutoffDate(req));
        if (!cardData) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const { student } = cardData;
        
        // Calculate current class based on tahun_pelajaran
        let calculatedClass = student.kelas;
        if (student.tahun_pelajaran && student.jurusan) {
            calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan) || student.kelas;
        }
        
        // Update student object with calculated class
        student.kelas = calculatedClass;

        const [waliRows] = await db.query(
            `SELECT u.nama AS wali_nama, u.nip AS wali_nip, wka.tahun_ajaran
             FROM wali_kelas_assignment wka
             JOIN users u ON wka.guru_id = u.id
             WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
             ORDER BY wka.id DESC
             LIMIT 1`,
            [calculatedClass]
        );

        const wali = waliRows.length
            ? { nama: waliRows[0].wali_nama, nip: waliRows[0].wali_nip, tahun_ajaran: waliRows[0].tahun_ajaran }
            : null;

        const [history] = await db.query(
            `SELECT id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan, created_at
             FROM ipt_history
             WHERE user_id = ?
             ORDER BY created_at ASC, id ASC`,
            [userId]
        );

        res.json({
            student,
            wali,
            points: cardData.points,
            ipt_total: cardData.ipt_total,
            breakdown_total: cardData.breakdown_total,
            history
        });
    } catch (error) {
        console.error('Error fetching IPT card data:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Generate PDF for Individual Point Talent (Download)
router.get('/ipt-card-pdf/:userId', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (Number.isNaN(userId)) {
            return res.status(400).json({ message: 'ID siswa tidak valid' });
        }

        // If user is a teacher, check if the student is in their wali kelas class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (!waliKelasClass) {
                return res.status(403).json({ message: 'Anda bukan wali kelas' });
            }
            
            // Check if the student belongs to their class
            const [studentCheck] = await db.query(
                `SELECT kelas FROM users WHERE id = ? AND role = 'siswa'`,
                [userId]
            );
            
            if (studentCheck.length === 0) {
                return res.status(404).json({ message: 'Siswa tidak ditemukan' });
            }
            
            if (studentCheck[0].kelas !== waliKelasClass) {
                return res.status(403).json({ message: 'Anda hanya dapat mengakses siswa di kelas Anda' });
            }
        }

        const cardData = await buildIptCardBreakdown(userId, getCutoffDate(req));
        if (!cardData) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const { student, points } = cardData;
        
        // Calculate current class based on tahun_pelajaran
        let calculatedClass = student.kelas;
        if (student.tahun_pelajaran && student.jurusan) {
            calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan) || student.kelas;
        }
        
        // Get wali kelas data
        const [waliRows] = await db.query(
            `SELECT u.nama AS wali_nama, u.nip AS wali_nip
             FROM wali_kelas_assignment wka
             JOIN users u ON wka.guru_id = u.id
             WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
             ORDER BY wka.id DESC
             LIMIT 1`,
            [calculatedClass]
        );

        const wali = waliRows.length > 0 ? waliRows[0] : null;

        // Calculate totals
        const pointAwal = Number(points.point_awal) || 80;
        const jumlahPrestasi = Number(points.prestasi) || 0;
        
        const karakterTanggungJawab = Number(points.tanggung_jawab) || 0;
        const karakterDisiplin = Number(points.disiplin) || 0;
        const karakterKepedulian = Number(points.kepedulian) || 0;
        const karakterKemandirian = Number(points.kemandirian) || 0;
        const karakterSpiritual = Number(points.spiritual) || 0;
        const karakterKejujuran = Number(points.kejujuran) || 0;
        const karakterKepercayaanDiri = Number(points.kepercayaan_diri) || 0;
        const jumlahKarakter = karakterTanggungJawab + karakterDisiplin + karakterKepedulian + 
                              karakterKemandirian + karakterSpiritual + karakterKejujuran + karakterKepercayaanDiri;
        
        const organisasi = Number(points.organisasi) || 0;
        const kepanitiaan = Number(points.kepanitiaan) || 0;
        const event = Number(points.event) || 0;
        const jumlahKeaktifan = organisasi + kepanitiaan + event;
        
        const pelanggaranRingan = Number(points.pelanggaran_ringan) || 0;
        const pelanggaranSedang = Number(points.pelanggaran_sedang) || 0;
        const pelanggaranBerat = Number(points.pelanggaran_berat) || 0;
        const jumlahPelanggaran = pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + (Number(points.pelanggaran_lainnya) || 0);
        
        const totalPointIPT = pointAwal + jumlahPrestasi + jumlahKarakter + jumlahKeaktifan + jumlahPelanggaran;

        // Prepare data for template
        const templateData = {
            logo_path: 'header.png', // Path to logo file
            nama_siswa: student.nama || '-',
            kelas: calculatedClass || '-',
            nis: student.nis || '-',
            grha: student.grha || '-',
            wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            semester: getRequestedSemester(req),
            tahun_pelajaran: getRequestedTahunPelajaran(req),
            point_awal: pointAwal,
            jumlah_prestasi: jumlahPrestasi,
            karakter_tanggung_jawab: karakterTanggungJawab,
            karakter_disiplin: karakterDisiplin,
            karakter_kepedulian: karakterKepedulian,
            karakter_kemandirian: karakterKemandirian,
            karakter_spiritual: karakterSpiritual,
            karakter_kejujuran: karakterKejujuran,
            karakter_kepercayaan_diri: karakterKepercayaanDiri,
            jumlah_karakter: jumlahKarakter,
            organisasi: organisasi,
            kepanitiaan: kepanitiaan,
            event: event,
            jumlah_keaktifan: jumlahKeaktifan,
            pelanggaran_ringan: pelanggaranRingan,
            pelanggaran_sedang: pelanggaranSedang,
            pelanggaran_berat: pelanggaranBerat,
            jumlah_pelanggaran: jumlahPelanggaran,
            total_point_ipt: totalPointIPT,
            ...(await getSchoolSignature()),
            tanggal_cetak: formatDateIndo(),
            nama_wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            nip_wali_kelas: wali?.wali_nip || '-'
        };

        // Generate PDF buffer directly
        const pdfBuffer = await generateRaportIPTBuffer(templateData);

        // Set proper headers for PDF (attachment for download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="IPT_${student.nama || 'SISWA'}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        // Send the PDF buffer
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating IPT card PDF:', error);
        res.status(500).json({ message: 'Server error saat generate PDF' });
    }
});

// Generate PDF for Individual Point Talent (Preview)
router.get('/ipt-card-preview/:userId', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (Number.isNaN(userId)) {
            return res.status(400).json({ message: 'ID siswa tidak valid' });
        }

        // If user is a teacher, check if the student is in their wali kelas class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (!waliKelasClass) {
                return res.status(403).json({ message: 'Anda bukan wali kelas' });
            }
            
            // Check if the student belongs to their class
            const [studentCheck] = await db.query(
                `SELECT kelas FROM users WHERE id = ? AND role = 'siswa'`,
                [userId]
            );
            
            if (studentCheck.length === 0) {
                return res.status(404).json({ message: 'Siswa tidak ditemukan' });
            }
            
            if (studentCheck[0].kelas !== waliKelasClass) {
                return res.status(403).json({ message: 'Anda hanya dapat mengakses siswa di kelas Anda' });
            }
        }

        const cardData = await buildIptCardBreakdown(userId, getCutoffDate(req));
        if (!cardData) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const { student, points } = cardData;
        
        // Calculate current class based on tahun_pelajaran
        let calculatedClass = student.kelas;
        if (student.tahun_pelajaran && student.jurusan) {
            calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan) || student.kelas;
        }
        
        // Get wali kelas data
        const [waliRows] = await db.query(
            `SELECT u.nama AS wali_nama, u.nip AS wali_nip
             FROM wali_kelas_assignment wka
             JOIN users u ON wka.guru_id = u.id
             WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
             ORDER BY wka.id DESC
             LIMIT 1`,
            [calculatedClass]
        );

        const wali = waliRows.length > 0 ? waliRows[0] : null;

        // Calculate totals
        const pointAwal = Number(points.point_awal) || 80;
        const jumlahPrestasi = Number(points.prestasi) || 0;
        
        const karakterTanggungJawab = Number(points.tanggung_jawab) || 0;
        const karakterDisiplin = Number(points.disiplin) || 0;
        const karakterKepedulian = Number(points.kepedulian) || 0;
        const karakterKemandirian = Number(points.kemandirian) || 0;
        const karakterSpiritual = Number(points.spiritual) || 0;
        const karakterKejujuran = Number(points.kejujuran) || 0;
        const karakterKepercayaanDiri = Number(points.kepercayaan_diri) || 0;
        const jumlahKarakter = karakterTanggungJawab + karakterDisiplin + karakterKepedulian + 
                              karakterKemandirian + karakterSpiritual + karakterKejujuran + karakterKepercayaanDiri;
        
        const organisasi = Number(points.organisasi) || 0;
        const kepanitiaan = Number(points.kepanitiaan) || 0;
        const event = Number(points.event) || 0;
        const jumlahKeaktifan = organisasi + kepanitiaan + event;
        
        const pelanggaranRingan = Number(points.pelanggaran_ringan) || 0;
        const pelanggaranSedang = Number(points.pelanggaran_sedang) || 0;
        const pelanggaranBerat = Number(points.pelanggaran_berat) || 0;
        const jumlahPelanggaran = pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + (Number(points.pelanggaran_lainnya) || 0);
        
        const totalPointIPT = pointAwal + jumlahPrestasi + jumlahKarakter + jumlahKeaktifan + jumlahPelanggaran;

        // Prepare data for template
        const templateData = {
            logo_path: 'header.png', // Path to logo file
            nama_siswa: student.nama || '-',
            kelas: calculatedClass || '-',
            nis: student.nis || '-',
            grha: student.grha || '-',
            wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            semester: getRequestedSemester(req),
            tahun_pelajaran: getRequestedTahunPelajaran(req),
            point_awal: pointAwal,
            jumlah_prestasi: jumlahPrestasi,
            karakter_tanggung_jawab: karakterTanggungJawab,
            karakter_disiplin: karakterDisiplin,
            karakter_kepedulian: karakterKepedulian,
            karakter_kemandirian: karakterKemandirian,
            karakter_spiritual: karakterSpiritual,
            karakter_kejujuran: karakterKejujuran,
            karakter_kepercayaan_diri: karakterKepercayaanDiri,
            jumlah_karakter: jumlahKarakter,
            organisasi: organisasi,
            kepanitiaan: kepanitiaan,
            event: event,
            jumlah_keaktifan: jumlahKeaktifan,
            pelanggaran_ringan: pelanggaranRingan,
            pelanggaran_sedang: pelanggaranSedang,
            pelanggaran_berat: pelanggaranBerat,
            jumlah_pelanggaran: jumlahPelanggaran,
            total_point_ipt: totalPointIPT,
            ...(await getSchoolSignature()),
            tanggal_cetak: formatDateIndo(),
            nama_wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            nip_wali_kelas: wali?.wali_nip || '-'
        };

        // Generate PDF buffer directly
        const pdfBuffer = await generateRaportIPTBuffer(templateData);

        // Set proper headers for PDF (inline for preview, attachment for download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="IPT_${student.nama || 'SISWA'}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        // Send the PDF buffer
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating IPT card PDF:', error);
        res.status(500).json({ message: 'Server error saat generate PDF' });
    }
});

// Generate PDF for Class IPT Report (Download)
router.get('/leger-pdf/:kelas', auth, async (req, res) => {
    try {
        const { kelas } = req.params;
        
        // If user is a teacher, check if they can access this class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (!waliKelasClass) {
                return res.status(403).json({ message: 'Anda bukan wali kelas' });
            }
            if (kelas !== waliKelasClass) {
                return res.status(403).json({ message: 'Anda hanya dapat mengakses kelas Anda' });
            }
        }

        // Get all students in the class with their IPT breakdown
        const [students] = await db.query(
            `SELECT id, nama, nis, kelas, grha, ipt_total, ipt_awal, tahun_pelajaran, jurusan
             FROM users 
             WHERE role = 'siswa' AND kelas = ? AND (is_graduated = 0 OR is_graduated IS NULL)
             ORDER BY nama ASC`,
            [kelas]
        );

        if (students.length === 0) {
            return res.status(404).json({ message: 'Tidak ada siswa di kelas ini' });
        }

        // Build IPT breakdown for each student
        const studentsData = [];
        for (const student of students) {
            const cardData = await buildIptCardBreakdown(student.id);
            if (cardData && cardData.points) {
                const points = cardData.points;
                
                const pointAwal = Number(points.point_awal) || 80;
                const jumlahPrestasi = Number(points.prestasi) || 0;
                
                const karakterTanggungJawab = Number(points.tanggung_jawab) || 0;
                const karakterDisiplin = Number(points.disiplin) || 0;
                const karakterKepedulian = Number(points.kepedulian) || 0;
                const karakterKemandirian = Number(points.kemandirian) || 0;
                const karakterSpiritual = Number(points.spiritual) || 0;
                const karakterKejujuran = Number(points.kejujuran) || 0;
                const karakterKepercayaanDiri = Number(points.kepercayaan_diri) || 0;
                const jumlahKarakter = karakterTanggungJawab + karakterDisiplin + karakterKepedulian + 
                                      karakterKemandirian + karakterSpiritual + karakterKejujuran + karakterKepercayaanDiri;
                
                const organisasi = Number(points.organisasi) || 0;
                const kepanitiaan = Number(points.kepanitiaan) || 0;
                const event = Number(points.event) || 0;
                const jumlahKeaktifan = organisasi + kepanitiaan + event;
                
                const pelanggaranRingan = Number(points.pelanggaran_ringan) || 0;
                const pelanggaranSedang = Number(points.pelanggaran_sedang) || 0;
                const pelanggaranBerat = Number(points.pelanggaran_berat) || 0;
                const jumlahPelanggaran = pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + (Number(points.pelanggaran_lainnya) || 0);
                
                const totalPointIPT = pointAwal + jumlahPrestasi + jumlahKarakter + jumlahKeaktifan + jumlahPelanggaran;

                // Calculate current class
                let calculatedClass = student.kelas;
                if (student.tahun_pelajaran && student.jurusan) {
                    calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan) || student.kelas;
                }

                studentsData.push({
                    nama: student.nama || '-',
                    nis: student.nis || '-',
                    kelas: calculatedClass || '-',
                    ghra: student.grha || '-',
                    jumlahPrestasi: jumlahPrestasi,
                    tanggungJawab: karakterTanggungJawab,
                    disiplin: karakterDisiplin,
                    kepedulian: karakterKepedulian,
                    kemandirian: karakterKemandirian,
                    spiritual: karakterSpiritual,
                    kejujuran: karakterKejujuran,
                    kepercayaanDiri: karakterKepercayaanDiri,
                    jumlahKarakter: jumlahKarakter,
                    organisasi: organisasi,
                    kepanitiaan: kepanitiaan,
                    event: event,
                    jumlahKeaktifan: jumlahKeaktifan,
                    ringan: pelanggaranRingan,
                    sedang: pelanggaranSedang,
                    berat: pelanggaranBerat,
                    jumlahPelanggaran: jumlahPelanggaran,
                    totalPoint: totalPointIPT
                });
            }
        }

        // Get wali kelas data
        const [waliRows] = await db.query(
            `SELECT u.nama AS wali_nama, u.nip AS wali_nip
             FROM wali_kelas_assignment wka
             JOIN users u ON wka.guru_id = u.id
             WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
             ORDER BY wka.id DESC
             LIMIT 1`,
            [kelas]
        );

        const wali = waliRows.length > 0 ? waliRows[0] : null;

        // Prepare data for template (new format)
        const dataKelas = {
            nama_kelas: kelas,
            tahun_pelajaran: new Date().getFullYear() + '/' + (new Date().getFullYear() + 1),
            kop_surat_path_file: 'header.png',
            ...(await getSchoolSignature()),
            tanggal_cetak: formatDateIndo(),
            nama_wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            nip_wali_kelas: wali?.wali_nip || '-'
        };

        // Generate PDF buffer directly with new signature
        const pdfBuffer = await generateLegerIPTBuffer(dataKelas, studentsData);

        // Set proper headers for PDF (attachment for download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Leger_IPT_Kelas_${kelas}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        // Send the PDF buffer
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating Leger IPT PDF:', error);
        res.status(500).json({ message: 'Server error saat generate PDF' });
    }
});

// Generate PDF for Class IPT Report (Preview)
router.get('/leger-preview/:kelas', auth, async (req, res) => {
    try {
        const { kelas } = req.params;
        
        // If user is a teacher, check if they can access this class
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            const waliKelasClass = await getTeacherWaliKelasClass(req.user.id);
            if (!waliKelasClass) {
                return res.status(403).json({ message: 'Anda bukan wali kelas' });
            }
            if (kelas !== waliKelasClass) {
                return res.status(403).json({ message: 'Anda hanya dapat mengakses kelas Anda' });
            }
        }

        // Get all students in the class with their IPT breakdown
        const [students] = await db.query(
            `SELECT id, nama, nis, kelas, grha, ipt_total, ipt_awal, tahun_pelajaran, jurusan
             FROM users 
             WHERE role = 'siswa' AND kelas = ? AND (is_graduated = 0 OR is_graduated IS NULL)
             ORDER BY nama ASC`,
            [kelas]
        );

        if (students.length === 0) {
            return res.status(404).json({ message: 'Tidak ada siswa di kelas ini' });
        }

        // Build IPT breakdown for each student
        const studentsData = [];
        for (const student of students) {
            const cardData = await buildIptCardBreakdown(student.id);
            if (cardData && cardData.points) {
                const points = cardData.points;
                
                const pointAwal = Number(points.point_awal) || 80;
                const jumlahPrestasi = Number(points.prestasi) || 0;
                
                const karakterTanggungJawab = Number(points.tanggung_jawab) || 0;
                const karakterDisiplin = Number(points.disiplin) || 0;
                const karakterKepedulian = Number(points.kepedulian) || 0;
                const karakterKemandirian = Number(points.kemandirian) || 0;
                const karakterSpiritual = Number(points.spiritual) || 0;
                const karakterKejujuran = Number(points.kejujuran) || 0;
                const karakterKepercayaanDiri = Number(points.kepercayaan_diri) || 0;
                const jumlahKarakter = karakterTanggungJawab + karakterDisiplin + karakterKepedulian + 
                                      karakterKemandirian + karakterSpiritual + karakterKejujuran + karakterKepercayaanDiri;
                
                const organisasi = Number(points.organisasi) || 0;
                const kepanitiaan = Number(points.kepanitiaan) || 0;
                const event = Number(points.event) || 0;
                const jumlahKeaktifan = organisasi + kepanitiaan + event;
                
                const pelanggaranRingan = Number(points.pelanggaran_ringan) || 0;
                const pelanggaranSedang = Number(points.pelanggaran_sedang) || 0;
                const pelanggaranBerat = Number(points.pelanggaran_berat) || 0;
                const jumlahPelanggaran = pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + (Number(points.pelanggaran_lainnya) || 0);
                
                const totalPointIPT = pointAwal + jumlahPrestasi + jumlahKarakter + jumlahKeaktifan + jumlahPelanggaran;

                // Calculate current class
                let calculatedClass = student.kelas;
                if (student.tahun_pelajaran && student.jurusan) {
                    calculatedClass = calculateFullClass(student.tahun_pelajaran, student.jurusan) || student.kelas;
                }

                studentsData.push({
                    nama: student.nama || '-',
                    nis: student.nis || '-',
                    kelas: calculatedClass || '-',
                    ghra: student.grha || '-',
                    jumlahPrestasi: jumlahPrestasi,
                    tanggungJawab: karakterTanggungJawab,
                    disiplin: karakterDisiplin,
                    kepedulian: karakterKepedulian,
                    kemandirian: karakterKemandirian,
                    spiritual: karakterSpiritual,
                    kejujuran: karakterKejujuran,
                    kepercayaanDiri: karakterKepercayaanDiri,
                    jumlahKarakter: jumlahKarakter,
                    organisasi: organisasi,
                    kepanitiaan: kepanitiaan,
                    event: event,
                    jumlahKeaktifan: jumlahKeaktifan,
                    ringan: pelanggaranRingan,
                    sedang: pelanggaranSedang,
                    berat: pelanggaranBerat,
                    jumlahPelanggaran: jumlahPelanggaran,
                    totalPoint: totalPointIPT
                });
            }
        }

        // Get wali kelas data
        const [waliRows] = await db.query(
            `SELECT u.nama AS wali_nama, u.nip AS wali_nip
             FROM wali_kelas_assignment wka
             JOIN users u ON wka.guru_id = u.id
             WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
             ORDER BY wka.id DESC
             LIMIT 1`,
            [kelas]
        );

        const wali = waliRows.length > 0 ? waliRows[0] : null;

        // Prepare data for template (new format)
        const dataKelas = {
            nama_kelas: kelas,
            tahun_pelajaran: new Date().getFullYear() + '/' + (new Date().getFullYear() + 1),
            kop_surat_path_file: 'header.png',
            ...(await getSchoolSignature()),
            tanggal_cetak: formatDateIndo(),
            nama_wali_kelas: wali?.wali_nama || 'Wali Kelas Belum Ditentukan',
            nip_wali_kelas: wali?.wali_nip || '-'
        };

        // Generate PDF buffer directly with new signature
        const pdfBuffer = await generateLegerIPTBuffer(dataKelas, studentsData);

        // Set proper headers for PDF (inline for preview)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Leger_IPT_Kelas_${kelas}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        // Send the PDF buffer
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating Leger IPT PDF:', error);
        res.status(500).json({ message: 'Server error saat generate PDF' });
    }
});

module.exports = router;
