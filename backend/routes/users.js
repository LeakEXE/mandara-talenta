const express = require('express');
const router = express.Router();
const VALID_TEACHER_JABATAN = ['Guru', 'Pegawai'];
const VALID_JURUSAN = ['TKJ 1', 'TKJ 2', 'DPIB 1', 'DPIB 2', 'TKR 1', 'TKR 2'];
const bcrypt = require('bcryptjs');
const { auth, superAdminOnly, teacherOrSuperAdmin } = require('../middleware/auth');
const db = require('../config/database');
const { getStudentRecords } = require('../utils/studentRecords');
const { validateTahunPelajaran, calculateCurrentClass, shouldGraduate, getClassInfo, calculateFullClass, getCurrentAcademicYear } = require('../utils/academicYear');
const { logActivity } = require('../utils/logger');
const { gradePrefixFromKelas, getIptAwalForGrade } = require('../utils/iptConfig');
const { syncBiodataChange } = require('../utils/biodataSync');
const { deletePhotoIfOrphan } = require('../utils/fileUtils');
const { generateUsername, validateUsernameFormat, isUsernameAvailable } = require('../utils/username');

// Postgres LIKE is case-sensitive, so all user-facing name/NIS searches must
// use ILIKE. Multi-word queries are tokenized: every token must appear in the
// name (any order), OR the full phrase matches NIS/NIP/username.
// '!' is used as ESCAPE char (instead of backslash) to avoid clashing with
// Postgres standard_conforming_strings and the ? -> $n converter.
function escapeLikePattern(s) {
    return String(s).replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

function buildTokenSearchClause(nameField, extraFields, search) {
    const tokens = String(search || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const full = `%${escapeLikePattern(String(search).trim())}%`;
    const clauses = [];
    const params = [];
    if (tokens.length === 1) {
        clauses.push(`${nameField} ILIKE ? ESCAPE '!'`);
        params.push(full);
    } else {
        clauses.push(`(${tokens.map(() => `${nameField} ILIKE ? ESCAPE '!'`).join(' AND ')})`);
        tokens.forEach((t) => params.push(`%${escapeLikePattern(t)}%`));
    }
    extraFields.forEach((f) => {
        clauses.push(`${f} ILIKE ? ESCAPE '!'`);
        params.push(full);
    });
    return { clause: `(${clauses.join(' OR ')})`, params };
}

async function applyIptAwalUpdate(userId, newIptAwal, adminId) {
    const parsedAwal = parseInt(newIptAwal, 10);
    if (Number.isNaN(parsedAwal) || parsedAwal < 0) {
        const error = new Error('IPT awal tidak valid');
        error.statusCode = 400;
        throw error;
    }

    const [users] = await db.query(
        'SELECT id, role, ipt_awal, ipt_total FROM users WHERE id = ?',
        [userId]
    );

    if (users.length === 0) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
    }

    const user = users[0];
    if (user.role === 'superadmin') {
        const error = new Error('Tidak dapat mengubah IPT superadmin');
        error.statusCode = 400;
        throw error;
    }

    const oldAwal = user.ipt_awal ?? 0;
    const delta = parsedAwal - oldAwal;
    // No floor: IPT totals may legitimately go negative (heavy pelanggaran),
    // so the stored total always equals ipt_awal + approved records.
    const newTotal = (user.ipt_total ?? 0) + delta;

    await db.query(
        'UPDATE users SET ipt_awal = ?, ipt_total = ? WHERE id = ?',
        [parsedAwal, newTotal, userId]
    );

    if (delta !== 0) {
        await db.query(
            `INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan)
             VALUES (?, 'manual', ?, ?, ?, ?)`,
            [userId, delta, user.ipt_total ?? 0, newTotal, 'Penyesuaian IPT awal oleh superadmin']
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [adminId, 'UPDATE_IPT_AWAL', `Updated IPT awal for user ID ${userId} to ${parsedAwal}`]
        );
    }

    return { ipt_awal: parsedAwal, ipt_total: newTotal };
}

// Bulk update IPT awal for multiple users
// Grade bucket from kelas string, mirroring the frontend rule
// (first token uppercased: "XI TKJ 1" -> "XI").
function gradeOfKelas(kelas) {
    const prefix = String(kelas || '').split(' ')[0].toUpperCase();
    return prefix === 'X' || prefix === 'XI' || prefix === 'XII' ? prefix : null;
}

router.post('/bulk-update-ipt-awal', auth, superAdminOnly, async (req, res) => {
    try {
        // Mode 2 (preferred): apply grade defaults to ALL current students.
        // The old frontend sent explicit ID lists from a paginated /users
        // fetch, so anyone past page 1 was silently skipped.
        if (req.body.grades && typeof req.body.grades === 'object') {
            const parsedGrades = {};
            for (const grade of ['X', 'XI', 'XII']) {
                const v = parseInt(req.body.grades[grade], 10);
                if (Number.isNaN(v) || v < 0) {
                    return res.status(400).json({ message: `IPT awal Kelas ${grade} harus angka valid (min 0)` });
                }
                parsedGrades[grade] = v;
            }
            const [allSiswa] = await db.query(
                "SELECT id, kelas, ipt_awal FROM users WHERE role = 'siswa'"
            );
            const applied = {};
            for (const grade of ['X', 'XI', 'XII']) {
                const targets = allSiswa.filter(
                    (s) => gradeOfKelas(s.kelas) === grade && (s.ipt_awal ?? 0) !== parsedGrades[grade]
                );
                let ok = 0;
                for (const t of targets) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        await applyIptAwalUpdate(t.id, parsedGrades[grade], req.user.id);
                        ok++;
                    } catch (error) {
                        console.error(`Bulk IPT awal failed for user ${t.id}:`, error.message);
                    }
                }
                applied[grade] = { updated: ok, of: targets.length };
            }
            return res.json({ message: 'IPT awal berhasil diterapkan ke semua siswa', applied });
        }

        // Mode 1 (legacy): explicit ID list.
        const { userIds, iptAwal } = req.body;
        
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: 'User IDs array is required' });
        }
        
        const parsedAwal = parseInt(iptAwal, 10);
        if (Number.isNaN(parsedAwal) || parsedAwal < 0) {
            return res.status(400).json({ message: 'IPT awal harus angka valid (min 0)' });
        }
        
        // Note: IPT awal should stay >= 0, but IPT total can go negative due to pelanggaran

        const results = [];
        
        for (const userId of userIds) {
            try {
                const result = await applyIptAwalUpdate(userId, parsedAwal, req.user.id);
                results.push({ userId, success: true, ...result });
            } catch (error) {
                results.push({ userId, success: false, message: error.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        res.json({ 
            message: `IPT awal berhasil diupdate untuk ${successCount} dari ${userIds.length} pengguna`,
            results 
        });
    } catch (error) {
        console.error('Bulk update IPT awal error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Siswa headcount per grade (for KonfigurasiIPT labels — paginated /users
// can't answer "how many" without fetching every page).
router.get('/counts-by-grade', auth, superAdminOnly, async (req, res) => {
    try {
        const [allSiswa] = await db.query(
            "SELECT kelas FROM users WHERE role = 'siswa'"
        );
        const counts = { X: 0, XI: 0, XII: 0 };
        for (const s of allSiswa) {
            const grade = gradeOfKelas(s.kelas);
            if (grade) counts[grade]++;
        }
        res.json(counts);
    } catch (error) {
        console.error('Counts by grade error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student data by NIS (for auto-fill in input forms) - MUST BE BEFORE /:id
router.get('/nis/:nis', auth, async (req, res) => {
    try {
        console.log('Fetching student by NIS:', req.params.nis);
        const [users] = await db.query(
            'SELECT id, nama, nis, kelas, grha FROM users WHERE nis = ? AND role = ?',
            [req.params.nis, 'siswa']
        );
        
        console.log('Found students:', users.length);
        
        if (users.length === 0) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching student by NIS:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Batch student lookup by NIS (one request for file-manager filtering
// instead of N single lookups) - MUST BE BEFORE /:id
router.post('/nis-batch', auth, async (req, res) => {
    try {
        const list = Array.isArray(req.body?.nis)
            ? [...new Set(req.body.nis.map((n) => String(n)).filter(Boolean))].slice(0, 200)
            : [];
        if (list.length === 0) {
            return res.json({});
        }
        const [rows] = await db.query(
            `SELECT id, nama, nis, kelas, grha FROM users WHERE nis IN (${list.map(() => '?').join(',')}) AND role = 'siswa'`,
            list
        );
        const map = {};
        rows.forEach((r) => { map[r.nis] = r; });
        res.json(map);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student data by name (for auto-fill in input forms) - MUST BE BEFORE /:id
router.get('/nama/:nama', auth, async (req, res) => {
    try {
        console.log('Fetching student by name:', req.params.nama);
        const [users] = await db.query(
            'SELECT id, nama, nis, kelas, grha FROM users WHERE nama = ? AND role = ?',
            [req.params.nama, 'siswa']
        );
        
        console.log('Found students:', users.length);
        
        if (users.length === 0) {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching student by name:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all users (Superadmin and Teacher) - with pagination
router.get('/', auth, teacherOrSuperAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', role: roleFilter } = req.query;
        const offset = (page - 1) * limit;

        // If guru/pegawai, only return students (excluding graduated)
        if (req.user.role === 'guru' || req.user.role === 'pegawai') {
            let query = 'SELECT id, nama, nis, nip, role, kelas, grha, wali_kelas, ipt_total, ipt_awal, created_at, tahun_pelajaran, is_graduated, jurusan, detail, alamat, no_hp FROM users WHERE role = ? AND (is_graduated = 0 OR is_graduated IS NULL)';
            let params = ['siswa'];

            if (search) {
                const tokenSearch = buildTokenSearchClause('nama', ['nis'], search);
                query += ` AND ${tokenSearch.clause}`;
                params.push(...tokenSearch.params);
            }

            query += ' ORDER BY nama ASC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));

            const [users] = await db.query(query, params);

            // Get total count for pagination
            let countQuery = 'SELECT COUNT(*) as total FROM users WHERE role = ? AND (is_graduated = 0 OR is_graduated IS NULL)';
            let countParams = ['siswa'];
            if (search) {
                const tokenSearch = buildTokenSearchClause('nama', ['nis'], search);
                countQuery += ` AND ${tokenSearch.clause}`;
                countParams.push(...tokenSearch.params);
            }
            const [countResult] = await db.query(countQuery, countParams);

            // Calculate and update class for each student
            const usersWithCalculatedClass = users.map(user => {
                const calculatedClass = calculateFullClass(user.tahun_pelajaran, user.jurusan);
                return {
                    ...user,
                    kelas: calculatedClass || user.kelas
                };
            });

            return res.json({
                users: usersWithCalculatedClass,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0].total,
                    totalPages: Math.ceil(countResult[0].total / limit)
                }
            });
        }

        // If superadmin, return all users (including graduated)
        let query = 'SELECT id, nama, nis, nip, username, role, kelas, grha, wali_kelas, ipt_total, ipt_awal, created_at, tahun_pelajaran, is_graduated, jurusan, detail, alamat, no_hp FROM users WHERE 1=1';
        let params = [];

        // Get filter values from query
        const jabatanFilter = req.query.jabatan;
        const grhaFilter = req.query.grha;
        const jurusanFilter = req.query.jurusan;
        const tahunPelajaranFilter = req.query.tahun_pelajaran;
        const kelasFilter = req.query.kelas;

        if (roleFilter) {
            query += ' AND role = ?';
            params.push(roleFilter);
        }

        // Add jabatan filter for guru and pegawai roles
        if (jabatanFilter && (roleFilter === 'guru' || roleFilter === 'pegawai')) {
            query += ' AND detail = ?';
            params.push(jabatanFilter);
        }

        // Add grha filter
        if (grhaFilter) {
            query += ' AND grha = ?';
            params.push(grhaFilter);
        }

        // Add jurusan filter
        if (jurusanFilter) {
            query += ' AND jurusan = ?';
            params.push(jurusanFilter);
        }

        // Add tahun_pelajaran filter
        if (tahunPelajaranFilter) {
            query += ' AND tahun_pelajaran = ?';
            params.push(tahunPelajaranFilter);
        }

        // Add kelas filter
        if (kelasFilter) {
            query += ' AND kelas = ?';
            params.push(kelasFilter);
        }

        if (search) {
            const tokenSearch = buildTokenSearchClause('nama', ['nis', 'nip', 'username'], search);
            query += ` AND ${tokenSearch.clause}`;
            params.push(...tokenSearch.params);
        }

        query += ' ORDER BY nama ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [users] = await db.query(query, params);

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        let countParams = [];

        if (roleFilter) {
            countQuery += ' AND role = ?';
            countParams.push(roleFilter);
        }

        // Add jabatan filter for count query
        if (jabatanFilter && (roleFilter === 'guru' || roleFilter === 'pegawai')) {
            countQuery += ' AND detail = ?';
            countParams.push(jabatanFilter);
        }

        // Add grha filter for count query
        if (grhaFilter) {
            countQuery += ' AND grha = ?';
            countParams.push(grhaFilter);
        }

        // Add jurusan filter for count query
        if (jurusanFilter) {
            countQuery += ' AND jurusan = ?';
            countParams.push(jurusanFilter);
        }

        // Add tahun_pelajaran filter for count query
        if (tahunPelajaranFilter) {
            countQuery += ' AND tahun_pelajaran = ?';
            countParams.push(tahunPelajaranFilter);
        }

        // Add kelas filter for count query
        if (kelasFilter) {
            countQuery += ' AND kelas = ?';
            countParams.push(kelasFilter);
        }

        if (search) {
            const tokenSearch = buildTokenSearchClause('nama', ['nis', 'nip', 'username'], search);
            countQuery += ` AND ${tokenSearch.clause}`;
            countParams.push(...tokenSearch.params);
        }

        const [countResult] = await db.query(countQuery, countParams);

        // Calculate and update class for each student
        const usersWithCalculatedClass = users.map(user => {
            if (user.role === 'siswa') {
                const calculatedClass = calculateFullClass(user.tahun_pelajaran, user.jurusan);
                return {
                    ...user,
                    kelas: calculatedClass || user.kelas
                };
            }
            return user;
        });

        res.json({
            users: usersWithCalculatedClass,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total,
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get pending password reset requests for SuperAdmin - MUST BE BEFORE /:id
router.get('/password-reset-approvals', auth, superAdminOnly, async (req, res) => {
    try {
        const [approvals] = await db.query(
            `SELECT p.id, p.user_id, p.requested_by, p.status AS superadmin_status,
                    p.superadmin_notes, p.created_at,
                    u.nama, COALESCE(u.nis, u.nip) AS nis, u.role,
                    requester.nama AS requested_by_name
             FROM password_reset_requests p
             JOIN users u ON p.user_id = u.id
             JOIN users requester ON p.requested_by = requester.id
             WHERE p.status = 'pending'
             ORDER BY p.created_at DESC`
        );
        res.json(approvals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Bulk update IPT awal (Superadmin only) - MUST BE BEFORE /:id
router.put('/bulk/ipt-awal', auth, superAdminOnly, async (req, res) => {
    try {
        const { user_ids: userIds, ipt_awal: iptAwal } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: 'Pilih minimal satu pengguna' });
        }

        const results = [];
        for (const rawId of userIds) {
            const userId = parseInt(rawId, 10);
            if (Number.isNaN(userId)) {
                continue;
            }
            const updated = await applyIptAwalUpdate(userId, iptAwal, req.user.id);
            results.push({ userId, ...updated });
        }

        res.json({
            message: `IPT awal berhasil diupdate untuk ${results.length} pengguna`,
            updated: results.length,
            results
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Student lookup for staff (guru/pegawai/superadmin) - MUST BE BEFORE /:id
const LOOKUP_KELAS_OPTIONS = [
    'X TKJ 1', 'X TKJ 2', 'X TO 1', 'X TO 2',
    'X DPIB 1', 'X DPIB 2',
    'XI TKJ 1', 'XI TKJ 2', 'XI TO 1', 'XI TO 2',
    'XI DPIB 1', 'XI DPIB 2',
    'XII TKJ 1', 'XII TKJ 2', 'XII TO 1', 'XII TO 2',
    'XII DPIB 1', 'XII DPIB 2'
];
const LOOKUP_GRHA_OPTIONS = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
];

router.get('/lookup', auth, teacherOrSuperAdmin, async (req, res) => {
    try {
        const {
            search = '',
            kelas_include = '',
            kelas_exclude = '',
            grha_include = '',
            grha_exclude = '',
            tahun_pelajaran = '',
            status = '',
            ipt_status = '',
            page = 1,
            limit = 20
        } = req.query;

        const splitList = (value, whitelist) => String(value || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && whitelist.includes(s));
        const kelasInc = splitList(kelas_include, LOOKUP_KELAS_OPTIONS);
        const kelasExc = splitList(kelas_exclude, LOOKUP_KELAS_OPTIONS);
        const grhaInc = splitList(grha_include, LOOKUP_GRHA_OPTIONS);
        const grhaExc = splitList(grha_exclude, LOOKUP_GRHA_OPTIONS);
        const tahunFilter = validateTahunPelajaran(tahun_pelajaran) ? tahun_pelajaran : '';

        // Min IPT thresholds per grade (same source as /ipt-config/min-ipt-per-grade).
        // Inlined as validated integers (never raw user input).
        const [minRows] = await db.query(
            `SELECT field1, point_value FROM ipt_config
             WHERE category = 'pengaturan' AND field1 IN ('min_ipt', 'min_ipt_X', 'min_ipt_XI', 'min_ipt_XII')`
        );
        const byField = {};
        for (const row of minRows || []) byField[row.field1] = parseInt(row.point_value, 10);
        const legacy = Number.isFinite(byField.min_ipt) && byField.min_ipt > 0 ? byField.min_ipt : 0;
        const pickThr = (grade) => {
            const value = byField[`min_ipt_${grade}`];
            return Number.isInteger(value) && value >= 0 ? value : legacy;
        };
        const thrCase = `(CASE WHEN (u.kelas LIKE 'XII %' OR u.kelas = 'XII') THEN ${pickThr('XII')} WHEN (u.kelas LIKE 'XI %' OR u.kelas = 'XI') THEN ${pickThr('XI')} WHEN (u.kelas LIKE 'X %' OR u.kelas = 'X') THEN ${pickThr('X')} ELSE 0 END)`;

        const where = [`u.role = 'siswa'`];
        const params = [];
        const placeholders = (values) => values.map(() => '?').join(', ');

        const searchText = String(search).trim();
        if (searchText) {
            const tokenSearch = buildTokenSearchClause('u.nama', ['u.nis'], searchText);
            where.push(tokenSearch.clause);
            params.push(...tokenSearch.params);
        }
        if (kelasInc.length) {
            where.push(`u.kelas IN (${placeholders(kelasInc)})`);
            params.push(...kelasInc);
        }
        if (kelasExc.length) {
            where.push(`(u.kelas NOT IN (${placeholders(kelasExc)}) OR u.kelas IS NULL)`);
            params.push(...kelasExc);
        }
        if (grhaInc.length) {
            where.push(`u.grha IN (${placeholders(grhaInc)})`);
            params.push(...grhaInc);
        }
        if (grhaExc.length) {
            where.push(`(u.grha NOT IN (${placeholders(grhaExc)}) OR u.grha IS NULL)`);
            params.push(...grhaExc);
        }
        if (tahunFilter) {
            where.push('u.tahun_pelajaran = ?');
            params.push(tahunFilter);
        }
        if (status === 'aktif') {
            where.push('(u.is_graduated = 0 OR u.is_graduated IS NULL)');
        } else if (status === 'lulus') {
            where.push('u.is_graduated = 1');
        }
        if (ipt_status === 'below') {
            where.push(`(${thrCase} > 0 AND u.ipt_total IS NOT NULL AND u.ipt_total < ${thrCase})`);
        } else if (ipt_status === 'normal') {
            where.push(`NOT (${thrCase} > 0 AND u.ipt_total IS NOT NULL AND u.ipt_total < ${thrCase})`);
        }

        const whereSql = `WHERE ${where.join(' AND ')}`;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(80, Math.max(1, parseInt(limit, 10) || 20));
        const offsetNum = (pageNum - 1) * limitNum;
        const currentYear = getCurrentAcademicYear();

        const [rows] = await db.query(
            `SELECT u.id, u.nama, u.nis, u.username, u.kelas, u.grha, u.foto, u.ipt_total, u.ipt_awal,
                    u.tahun_pelajaran, u.is_graduated, u.jurusan, g.nama AS wali_kelas_nama
             FROM users u
             LEFT JOIN wali_kelas_assignment wka ON wka.kelas = u.kelas AND wka.tahun_ajaran = ?
             LEFT JOIN users g ON g.id = wka.guru_id
             ${whereSql}
             ORDER BY u.nama ASC LIMIT ? OFFSET ?`,
            [currentYear, ...params, limitNum, offsetNum]
        );
        const [countRows] = await db.query(
            `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${whereSql}`,
            params
        );
        const total = Number(countRows[0]?.total) || 0;

        const users = rows.map((user) => {
            const calculatedClass = calculateFullClass(user.tahun_pelajaran, user.jurusan);
            return { ...user, kelas: calculatedClass || user.kelas };
        });

        res.json({
            users,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.max(1, Math.ceil(total / limitNum))
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student approved records (Guru/Superadmin)
router.get('/:id/records', auth, teacherOrSuperAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const [user] = await db.query('SELECT id, role FROM users WHERE id = ?', [userId]);

        if (user.length === 0 || user[0].role !== 'siswa') {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const records = await getStudentRecords(userId);
        res.json(records);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get student IPT history (Guru/Superadmin)
router.get('/:id/ipt-history', auth, teacherOrSuperAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const [user] = await db.query('SELECT id, role FROM users WHERE id = ?', [userId]);

        if (user.length === 0 || user[0].role !== 'siswa') {
            return res.status(404).json({ message: 'Siswa tidak ditemukan' });
        }

        const [history] = await db.query(
            'SELECT id, user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan, created_at FROM ipt_history WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user by ID - IDOR protection: users can only access their own data unless they are admin/teacher
router.get('/:id', auth, async (req, res) => {
    try {
        const requestedUserId = parseInt(req.params.id);
        const currentUserId = req.user.id;
        const currentUserRole = req.user.role;

        // IDOR protection: Only allow access if:
        // 1. User is requesting their own data, OR
        // 2. User is a superadmin, OR
        // 3. User is a teacher
        if (requestedUserId !== currentUserId && currentUserRole !== 'superadmin' && currentUserRole !== 'guru' && currentUserRole !== 'pegawai') {
            return res.status(403).json({ message: 'Access denied. You can only view your own profile.' });
        }

        const [users] = await db.query(
            'SELECT id, nama, nis, nip, role, kelas, grha, wali_kelas, ipt_total, alamat, no_hp, detail, detail AS jabatan, created_at FROM users WHERE id = ?',
            [requestedUserId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const user = users[0];
        
        // If user is a student, fetch wali kelas information
        if (user.role === 'siswa' && user.kelas) {
            const [waliData] = await db.query(`
                SELECT u.nama as wali_kelas_nama, u.nip as wali_kelas_nip
                FROM wali_kelas_assignment wka
                JOIN users u ON wka.guru_id = u.id
                WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
                ORDER BY wka.id DESC
                LIMIT 1
            `, [user.kelas]);
            
            if (waliData.length > 0) {
                user.wali_kelas_nama = waliData[0].wali_kelas_nama;
                user.wali_kelas_nip = waliData[0].wali_kelas_nip;
            }
        }
        
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create student account (Superadmin only — other roles have no create access)
router.post('/create-student', auth, superAdminOnly, async (req, res) => {
    try {
        const { nama, nis, jurusan, password, wali_kelas, grha, tahun_pelajaran } = req.body;

        // Validate tahun_pelajaran format
        if (!tahun_pelajaran || !validateTahunPelajaran(tahun_pelajaran)) {
            return res.status(400).json({ message: 'Tahun pelajaran tidak valid. Format harus YYYY-YYYY (contoh: 2024-2025)' });
        }

        // Calculate initial class based on enrollment year
        const calculatedClass = calculateFullClass(tahun_pelajaran, jurusan);

        // Check for duplicate in users table
        const [existing] = await db.query(
            'SELECT id FROM users WHERE nis = ?',
            [nis]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'NIS sudah terdaftar' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        // Auto-generate a username from the name (no random suffix; NIS feeds
        // the deterministic duplicate suffix, user changes it on first login)
        const username = await generateUsername(nama, { nis });

        const ipt_awal = await getIptAwalForGrade(gradePrefixFromKelas(calculatedClass));
        const [result] = await db.query(
            'INSERT INTO users (nama, nis, username, password, role, kelas, wali_kelas, grha, jurusan, ipt_total, ipt_awal, tahun_pelajaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [nama, nis, username, hashedPassword, 'siswa', calculatedClass, wali_kelas, grha, jurusan, ipt_awal, ipt_awal, tahun_pelajaran]
        );

        // Create default permissions
        await db.query(
            'INSERT INTO permissions (user_id) VALUES (?)',
            [result.insertId]
        );

        // Log IPT history
        await db.query(
            'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
            [result.insertId, 'initial', ipt_awal, 0, ipt_awal, 'IPT awal diberikan']
        );

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'CREATE_STUDENT', `Created student account for ${nama} (${nis})`]
        );

        res.status(201).json({ message: 'Akun siswa berhasil dibuat!', username });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create teacher account
router.post('/create-teacher', auth, superAdminOnly, async (req, res) => {
    try {
        const { nama, nip, password, jabatan, detail, alamat, no_hp, wali_kelas } = req.body;
        const teacherJabatan = jabatan || detail;
        if (!VALID_TEACHER_JABATAN.includes(teacherJabatan)) {
            return res.status(400).json({ message: `Jabatan tidak valid. Gunakan: ${VALID_TEACHER_JABATAN.join(', ')}` });
        }

        // Check for duplicate ("-" is the placeholder for staff without a
        // NIP and may be shared by any number of accounts)
        const [existing] = await db.query(
            'SELECT id FROM users WHERE nip = ?',
            [nip]
        );

        if (existing.length > 0 && nip !== '-') {
            return res.status(400).json({ message: 'NIP already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        // Set role based on jabatan to ensure proper filtering
        const userRole = teacherJabatan === 'Pegawai' ? 'pegawai' : 'guru';

        // Auto-generate a username from the name (no random suffix; NIP feeds
        // the deterministic duplicate suffix, user changes it on first login)
        const username = await generateUsername(nama, { nip });

        const [result] = await db.query(
            'INSERT INTO users (nama, nip, username, password, role, detail, alamat, no_hp, wali_kelas, ipt_total, ipt_awal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [nama, nip, username, hashedPassword, userRole, teacherJabatan, alamat, no_hp, wali_kelas, 0, 0]
        );

        // Create default permissions
        await db.query(
            'INSERT INTO permissions (user_id) VALUES (?)',
            [result.insertId]
        );

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'CREATE_TEACHER', `Created teacher account for ${nama} (${nip})`]
        );

        res.status(201).json({ message: 'Teacher account created successfully', username });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update user
router.put('/:id', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUser = req.user;

        // Check permissions
        if (currentUser.role !== 'superadmin' && currentUser.id !== userId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Teachers can only edit their own biodata, not superadmin
        if (currentUser.role === 'guru' || currentUser.role === 'pegawai') {
            const [targetUser] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
            if (targetUser.length > 0 && targetUser[0].role === 'superadmin') {
                return res.status(403).json({ message: 'Cannot edit superadmin account' });
            }
        }

        const { nama, nis, nip, jurusan, tahun_pelajaran, alamat, no_hp, jabatan, detail } = req.body;

        // Get current user data for logging (dan untuk validasi jabatan)
        const [targetUserData] = await db.query('SELECT nama, nis, role, detail, jurusan, tahun_pelajaran FROM users WHERE id = ?', [userId]);
        const storedJabatan = targetUserData[0]?.detail || null;
        const oldUserName = targetUserData[0]?.nama || null;
        const oldNis = targetUserData[0]?.nis || null;

        // Server-side field guard: non-superadmin may only change the fields
        // their role is allowed (UI hiding alone is not enforcement).
        // Wali Kelas is intentionally never editable here (derived data).
        if (currentUser.role !== 'superadmin') {
            const EDITABLE_FIELDS = {
                siswa: new Set(['nama', 'nis', 'jurusan', 'tahun_pelajaran', 'no_hp', 'alamat']),
                guru: new Set(['nip', 'nama', 'jabatan', 'detail', 'no_hp', 'alamat']),
                pegawai: new Set(['nip', 'nama', 'jabatan', 'detail', 'no_hp', 'alamat']),
                superadmin: new Set(['nama', 'nip', 'nis', 'jurusan', 'tahun_pelajaran', 'no_hp', 'alamat', 'jabatan', 'detail'])
            };
            const allowed = EDITABLE_FIELDS[targetUserData[0]?.role] || new Set();
            const forbidden = Object.keys(req.body || {}).filter((k) => !allowed.has(k));
            if (forbidden.length > 0) {
                return res.status(403).json({ message: `Field tidak diizinkan untuk role ini: ${forbidden.join(', ')}` });
            }
        }

        // Uniqueness checks (exclude self)
        if (nis !== undefined && nis !== oldNis) {
            const [dup] = await db.query('SELECT id FROM users WHERE nis = ? AND id <> ?', [nis, userId]);
            if (dup.length > 0) {
                return res.status(400).json({ message: 'NIS sudah dipakai akun lain' });
            }
        }
        if (nip !== undefined) {
            const [targetNip] = await db.query('SELECT nip FROM users WHERE id = ?', [userId]);
            // "-" marks staff without a NIP and is exempt from uniqueness
            if (nip !== targetNip[0]?.nip && nip !== '-') {
                const [dup] = await db.query('SELECT id FROM users WHERE nip = ? AND id <> ?', [nip, userId]);
                if (dup.length > 0) {
                    return res.status(400).json({ message: 'NIP sudah dipakai akun lain' });
                }
            }
        }
        if (jurusan !== undefined && !VALID_JURUSAN.includes(jurusan)) {
            return res.status(400).json({ message: `Jurusan tidak valid. Gunakan: ${VALID_JURUSAN.join(', ')}` });
        }
        if (tahun_pelajaran !== undefined && !validateTahunPelajaran(tahun_pelajaran)) {
            return res.status(400).json({ message: 'Tahun pelajaran tidak valid. Format harus YYYY-YYYY (contoh: 2024-2025)' });
        }

        let teacherJabatan = jabatan || detail;
        if (!teacherJabatan) {
            // Tidak dikirim / kosong -> pertahankan nilai yang sudah ada
            teacherJabatan = storedJabatan;
        } else if (teacherJabatan !== storedJabatan && !VALID_TEACHER_JABATAN.includes(teacherJabatan)) {
            // Hanya nilai BARU yang divalidasi; nilai lama (legacy) yang tidak
            // diubah tetap diterima agar edit biodata lain tidak terkunci
            return res.status(400).json({ message: `Jabatan tidak valid. Gunakan: ${VALID_TEACHER_JABATAN.join(', ')}` });
        }

        // Update role based on jabatan change
        const targetUserRole = targetUserData[0]?.role;
        let newRole = targetUserRole;
        if (teacherJabatan === 'Pegawai' && targetUserRole === 'guru') {
            newRole = 'pegawai';
        } else if (teacherJabatan === 'Guru' && targetUserRole === 'pegawai') {
            newRole = 'guru';
        }

        // Only touch columns actually sent (absent keys must not NULL existing data)
        const setClauses = [];
        const setParams = [];
        if (nama !== undefined) {
            setClauses.push('nama = ?');
            setParams.push(nama);
        }
        if (nis !== undefined) {
            setClauses.push('nis = ?');
            setParams.push(nis);
        }
        if (nip !== undefined) {
            setClauses.push('nip = ?');
            setParams.push(nip);
        }
        if (jurusan !== undefined) {
            setClauses.push('jurusan = ?');
            setParams.push(jurusan);
        }
        if (tahun_pelajaran !== undefined) {
            setClauses.push('tahun_pelajaran = ?');
            setParams.push(tahun_pelajaran);
        }
        // Siswa class derives from jurusan + tahun pelajaran: recalculate
        // whenever either changes so kelas never goes stale.
        if ((jurusan !== undefined || tahun_pelajaran !== undefined) && targetUserData[0]?.role === 'siswa') {
            const effectiveJurusan = jurusan !== undefined ? jurusan : targetUserData[0]?.jurusan;
            const effectiveTahun = tahun_pelajaran !== undefined ? tahun_pelajaran : targetUserData[0]?.tahun_pelajaran;
            const recalculated = calculateFullClass(effectiveTahun, effectiveJurusan);
            if (recalculated) {
                setClauses.push('kelas = ?');
                setParams.push(recalculated);
            }
        }
        if (alamat !== undefined) {
            setClauses.push('alamat = ?');
            setParams.push(alamat);
        }
        if (no_hp !== undefined) {
            setClauses.push('no_hp = ?');
            setParams.push(no_hp);
        }
        if (jabatan !== undefined || detail !== undefined) {
            setClauses.push('detail = ?');
            setParams.push(teacherJabatan);
            if (newRole !== targetUserRole) {
                setClauses.push('role = ?');
                setParams.push(newRole);
            }
        }
        if (setClauses.length === 0) {
            return res.status(400).json({ message: 'Tidak ada field yang diubah' });
        }

        await db.query(
            `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
            [...setParams, userId]
        );

        // Propagate renamed biodata into record snapshots, pembina names, logs.
        await syncBiodataChange(userId, { nama: oldUserName, nis: oldNis });

        // Log activity
        await logActivity(currentUser.id, 'UPDATE_BIODATA', `User ${currentUser.nama} (${currentUser.role}) updated biodata for ${targetUserData[0]?.nama || userId} (${targetUserData[0]?.role})`, req.ip);

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

async function deleteUserAndDependencies(conn, userId) {
    const tryQuery = async (sql, params) => {
        try {
            await conn.query(sql, params);
            return true;
        } catch (e) {
            // Some installations/older schemas may not have certain columns (e.g. pembina_id).
            // In that case we retry with a simpler query instead of failing deletion.
            if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === '42703')) {
                return false;
            }
            throw e;
        }
    };

    // Tables with FK references to users.id but without ON DELETE CASCADE in skema.sql
    // (these can block deleting a student/teacher who has pending approvals/notifications)
    await conn.query('DELETE FROM notifications WHERE user_id = ?', [userId]);

    // Approval tables: some schemas use pembina_id, some don't.
    if (!(await tryQuery('DELETE FROM prestasi_approvals WHERE user_id = ? OR pembina_id = ?', [userId, userId]))) {
        await conn.query('DELETE FROM prestasi_approvals WHERE user_id = ?', [userId]);
    }
    if (!(await tryQuery('DELETE FROM event_approvals WHERE user_id = ? OR pembina_id = ?', [userId, userId]))) {
        await conn.query('DELETE FROM event_approvals WHERE user_id = ?', [userId]);
    }
    if (!(await tryQuery('DELETE FROM organisasi_approvals WHERE user_id = ? OR pembina_id = ?', [userId, userId]))) {
        await conn.query('DELETE FROM organisasi_approvals WHERE user_id = ?', [userId]);
    }

    // Siswa approvals: schema should have created_by, but keep it simple if not.
    if (!(await tryQuery('DELETE FROM siswa_approvals WHERE user_id = ? OR created_by = ?', [userId, userId]))) {
        await conn.query('DELETE FROM siswa_approvals WHERE user_id = ?', [userId]);
    }

    // These *do* have cascades in most schemas, but delete defensively anyway.
    await conn.query('DELETE FROM student_creation_approvals WHERE requested_by = ?', [userId]);
    await conn.query('DELETE FROM biodata_update_approvals WHERE user_id = ? OR requested_by = ?', [userId, userId]);

    await conn.query('DELETE FROM users WHERE id = ?', [userId]);
}

// Bulk delete users (Superadmin only) - must be BEFORE /:id
router.post('/bulk-delete', auth, superAdminOnly, async (req, res) => {
    let conn;
    try {
        const userIds = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
        const parsed = [...new Set(userIds.map((id) => parseInt(id, 10)).filter((n) => Number.isInteger(n) && n > 0))];

        if (parsed.length === 0) {
            return res.status(400).json({ message: 'user_ids harus berisi minimal 1 id' });
        }

        conn = await db.getConnection();
        await conn.beginTransaction();

        // Prevent deleting any superadmin
        const [superadmins] = await conn.query(
            `SELECT id FROM users WHERE id IN (${parsed.map(() => '?').join(',')}) AND role = 'superadmin'`,
            parsed
        );
        if (superadmins.length > 0) {
            await conn.rollback();
            return res.status(403).json({ message: 'Tidak bisa menghapus akun SuperAdmin' });
        }

        // Remember avatars: user rows vanish below, and orphaned avatar
        // files are deleted after the commit succeeds.
        const [avatarRows] = await conn.query(
            `SELECT foto FROM users WHERE id IN (${parsed.map(() => '?').join(',')}) AND foto IS NOT NULL AND foto <> ''`,
            parsed
        );

        for (const id of parsed) {
            await deleteUserAndDependencies(conn, id);
        }

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'BULK_DELETE_USER', `Deleted ${parsed.length} users: ${parsed.join(',')}`]
        );

        await conn.commit();

        // User rows are gone: delete avatar files nothing references anymore.
        for (const r of avatarRows) {
            if (r.foto) await deletePhotoIfOrphan(db, r.foto, { folderHint: 'avatars' });
        }

        res.json({ message: `Berhasil menghapus ${parsed.length} akun` });
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (_) {}
        }
        console.error(error);
        res.status(500).json({ message: error.message || 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});

// Delete user
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // Prevent deleting superadmin
        const [user] = await db.query('SELECT role, foto FROM users WHERE id = ?', [userId]);
        if (user.length > 0 && user[0].role === 'superadmin') {
            return res.status(403).json({ message: 'Cannot delete superadmin account' });
        }
        const avatarFoto = user[0]?.foto || null;

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await deleteUserAndDependencies(conn, userId);
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'DELETE_USER', `Deleted user ID ${userId}`]
            );
            await conn.commit();
        } catch (e) {
            try { await conn.rollback(); } catch (_) {}
            throw e;
        } finally {
            conn.release();
        }

        // User row is gone: delete the avatar file nothing references anymore.
        if (avatarFoto) {
            await deletePhotoIfOrphan(db, avatarFoto, { folderHint: 'avatars' });
        }

        // Log activity
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
});

// Update IPT awal (Superadmin only)
router.put('/:id/ipt', auth, superAdminOnly, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { ipt_awal: iptAwal } = req.body;

        const updated = await applyIptAwalUpdate(userId, iptAwal, req.user.id);
        res.json({ message: 'IPT awal berhasil diupdate', ...updated });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Update biodata directly, no approval needed.
// Superadmin may edit anyone; guru/pegawai may edit siswa biodata only.
router.put('/:id/biodata', auth, teacherOrSuperAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { nama, nis, jurusan, grha, tahun_pelajaran, nip, jabatan, detail, alamat, no_hp } = req.body;
        const teacherJabatan = jabatan || detail;

        // Get user current data
        const [user] = await db.query('SELECT nama, role, detail, nis, nip, alamat, no_hp FROM users WHERE id = ?', [userId]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const role = user[0].role;
        const oldName = user[0].nama;
        const oldNis = user[0].nis || null;
        const oldNip = user[0].nip || null;

        // Guru/pegawai edit other accounts here only for siswa targets
        // (own-account edits go through PUT /:id; staff accounts stay
        // superadmin-only). UI gating alone is not enforcement.
        if (req.user.role !== 'superadmin' && role !== 'siswa') {
            return res.status(403).json({ message: 'Hanya biodata siswa yang dapat diubah' });
        }

        if (role === 'siswa') {
            // Validate tahun_pelajaran format if provided
            if (tahun_pelajaran && !validateTahunPelajaran(tahun_pelajaran)) {
                return res.status(400).json({ message: 'Tahun pelajaran tidak valid. Format harus YYYY-YYYY (contoh: 2024-2025)' });
            }

            // Calculate new class based on updated jurusan and tahun_pelajaran
            const calculatedClass = calculateFullClass(tahun_pelajaran, jurusan);

            // Update siswa biodata
            await db.query(
                'UPDATE users SET nama = ?, nis = ?, jurusan = ?, grha = ?, tahun_pelajaran = ?, kelas = ? WHERE id = ?',
                [nama, nis, jurusan, grha, tahun_pelajaran, calculatedClass, userId]
            );

            // Propagate the edited biodata into record snapshots, logs, notifications.
            await syncBiodataChange(userId, { nama: oldName, nis: oldNis });

            // Log activity
            await logActivity(req.user.id, 'UPDATE_BIODATA_DIRECT', `${req.user.nama} (${req.user.role}) directly updated biodata for student ${oldName} (${nis}) to ${nama}`, req.ip);
        } else if (role === 'guru' || role === 'pegawai') {
            const storedDetail = user[0].detail || null;
            const newJabatan = teacherJabatan || storedDetail;
            // Nilai BARU harus valid; nilai lama (legacy) yang tidak diubah tetap diterima
            if (newJabatan && newJabatan !== storedDetail && !VALID_TEACHER_JABATAN.includes(newJabatan)) {
                return res.status(400).json({ message: `Jabatan tidak valid. Gunakan: ${VALID_TEACHER_JABATAN.join(', ')}` });
            }
            // Update guru biodata (preserve alamat/no_hp when the form does not send them)
            const newAlamat = alamat !== undefined ? alamat : user[0].alamat;
            const newNoHp = no_hp !== undefined ? no_hp : user[0].no_hp;
            // Keep role in sync with jabatan so role-based pages (e.g. /izin-akun)
            // don't show a stale role after a Guru <-> Pegawai change.
            let newRole = role;
            if (newJabatan === 'Pegawai') {
                newRole = 'pegawai';
            } else if (newJabatan === 'Guru') {
                newRole = 'guru';
            }
            await db.query(
                'UPDATE users SET nama = ?, nip = ?, detail = ?, alamat = ?, no_hp = ?, role = ? WHERE id = ?',
                [nama, nip, newJabatan, newAlamat, newNoHp, newRole, userId]
            );

            // Propagate the renamed teacher into pembina names, logs, notifications.
            await syncBiodataChange(userId, { nama: oldName, nip: oldNip });

            // Log activity
            await logActivity(req.user.id, 'UPDATE_BIODATA_DIRECT', `${req.user.nama} (${req.user.role}) directly updated biodata for teacher ${oldName} (${nip}) to ${nama}`, req.ip);
        }

        res.json({ message: 'Biodata updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Change another user's username (Superadmin only, e.g. from Kelola Akun).
// No current-password check: the superadmin acts on someone else's account.
router.put('/:id/username', auth, superAdminOnly, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { username } = req.body;
        const formatError = validateUsernameFormat(username);
        if (formatError) {
            return res.status(400).json({ message: formatError });
        }
        const [target] = await db.query('SELECT id, nama, username FROM users WHERE id = ?', [userId]);
        if (target.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (!(await isUsernameAvailable(username, userId))) {
            return res.status(400).json({ message: 'Username sudah dipakai' });
        }
        await db.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
        await logActivity(req.user.id, 'CHANGE_USERNAME_BY_ADMIN', `Superadmin changed username of user #${userId} (${target[0].nama}) from ${target[0].username} to ${username}`, req.ip);
        res.json({ message: 'Username berhasil diubah', username });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve/Reject password reset request (SuperAdmin only)
// Grant = set a temporary password + force /setup-akun on next session.
router.put('/password-reset-approvals/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const approvalId = parseInt(req.params.id);
        const { status, notes, tempPassword } = req.body;

        const [approval] = await db.query(
            'SELECT id, user_id, requested_by, status, created_at FROM password_reset_requests WHERE id = ?',
            [approvalId]
        );
        if (approval.length === 0) {
            return res.status(404).json({ message: 'Permintaan reset password tidak ditemukan' });
        }
        const data = approval[0];
        if (data.status !== 'pending') {
            return res.status(400).json({ message: 'Permintaan ini sudah diproses' });
        }

        if (status === 'approved') {
            if (!tempPassword || tempPassword.length < 6) {
                return res.status(400).json({ message: 'Password sementara minimal 6 karakter' });
            }

            const [target] = await db.query('SELECT id FROM users WHERE id = ?', [data.user_id]);
            if (target.length === 0) {
                return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
            }

            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            // Flag forces the user through /setup-akun so the temporary
            // password is replaced right after their next login.
            await db.query(
                'UPDATE users SET password = ?, must_change_credentials = TRUE WHERE id = ?',
                [hashedPassword, data.user_id]
            );

            await db.query(
                'UPDATE password_reset_requests SET status = ?, superadmin_notes = ?, superadmin_approved_at = NOW() WHERE id = ?',
                ['approved', notes || 'Disetujui oleh SuperAdmin', approvalId]
            );

            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approved', 'Reset Password Disetujui', ?, ?, 'password_reset')`,
                [data.user_id, 'Permintaan reset password Anda disetujui. Silakan login dengan password sementara yang diberikan SuperAdmin, lalu ikuti proses penggantian password.', approvalId]
            );

            await logActivity(req.user.id, 'APPROVE_PASSWORD_RESET', `SuperAdmin mereset password akun user #${data.user_id}`, req.ip);

            res.json({ message: 'Password berhasil direset. User akan diminta mengganti password saat login berikutnya.' });
        } else {
            const rejectNotes = String(notes || '').trim();
            if (!rejectNotes) {
                return res.status(400).json({ message: 'Catatan penolakan wajib diisi' });
            }

            await db.query(
                'UPDATE password_reset_requests SET status = ?, superadmin_notes = ? WHERE id = ?',
                ['rejected', rejectNotes, approvalId]
            );

            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'rejected', 'Permintaan Reset Password Ditolak', ?, ?, 'password_reset')`,
                [data.user_id, `Permintaan reset password ditolak: ${rejectNotes}`, approvalId]
            );

            await logActivity(req.user.id, 'REJECT_PASSWORD_RESET', `SuperAdmin menolak permintaan reset password user #${data.user_id}`, req.ip);

            res.json({ message: 'Permintaan reset password ditolak' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Direct password reset (SuperAdmin only, no request row needed).
// Sets a temporary password + forces /setup-akun on next login, same
// outcome as approving a reset request. Any pending reset requests for
// the user are auto-resolved so the Approvals queue doesn't go stale.
router.put('/:id/reset-password', auth, superAdminOnly, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (Number.isNaN(userId)) {
            return res.status(400).json({ message: 'ID pengguna tidak valid' });
        }
        const { tempPassword } = req.body || {};
        if (typeof tempPassword !== 'string' || tempPassword.length < 6) {
            return res.status(400).json({ message: 'Password sementara minimal 6 karakter' });
        }
        if (tempPassword.length > 72) {
            return res.status(400).json({ message: 'Password sementara maksimal 72 karakter' });
        }

        const [target] = await db.query('SELECT id, nama, role FROM users WHERE id = ?', [userId]);
        if (target.length === 0) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
        }
        if (target[0].role === 'superadmin') {
            return res.status(403).json({ message: 'Tidak dapat mereset password akun superadmin' });
        }

        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        await db.query(
            'UPDATE users SET password = ?, must_change_credentials = TRUE WHERE id = ?',
            [hashedPassword, userId]
        );

        // Auto-resolve any pending reset requests for this user.
        const [pending] = await db.query(
            "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
            [userId]
        );
        for (const row of pending) {
            await db.query(
                "UPDATE password_reset_requests SET status = 'approved', superadmin_notes = 'Direset langsung oleh SuperAdmin', superadmin_approved_at = NOW() WHERE id = ?",
                [row.id]
            );
        }

        await db.query(
            `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
             VALUES (?, 'approved', 'Password Direset SuperAdmin', ?, NULL, 'password_reset')`,
            [userId, 'Password Anda direset oleh SuperAdmin. Silakan login dengan password sementara yang diberikan, lalu ikuti proses penggantian password.']
        );

        await logActivity(req.user.id, 'ADMIN_RESET_PASSWORD', `SuperAdmin mereset langsung password akun user #${userId} (${target[0].nama})`, req.ip);

        res.json({ message: `Password ${target[0].nama} berhasil direset. User akan diminta mengganti password saat login berikutnya.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
