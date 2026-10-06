const express = require('express');
const router = express.Router();
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const { auth, approverOnly, approverFor, checkInputAccess, getApprovalScopes } = require('../middleware/auth');
const db = require('../config/database');
const { logActivity } = require('../utils/logger');
const {
    calculatePrestasiPoints,
    calculateEventPoints,
    calculateOrganisasiPoints,
    calculateKepanitiaanPoints,
    calculatePelanggaranPoints
} = require('../constants/points');
const { resolveStudentIdByNis, resolvePembina, resolvePembinaIds, setPembinaLinks, attachPembinaLists, applyIptChange, applyPerilakuIptChange, buildKeterangan } = require('../utils/ipt');
const {
    getApprovalStatusColumn,
    getRowApprovalStatus,
    fetchPendingApprovals,
    approveSubmission,
    rejectSubmission
} = require('../utils/approvalSchema');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan } = require('../utils/fileUtils');
const { ensureUploadSubdir, UPLOAD_DIR, resolveUploadPath } = require('../utils/paths');
const fs = require('fs');
// Local file storage only - Google Drive removed

// Notify superadmins AND staff holding the approval scope for this type.
async function getApprovalRecipients(jenis) {
    const [recipients] = await db.query(
        `SELECT DISTINCT u.id FROM users u
         WHERE u.role = 'superadmin'
            OR EXISTS (SELECT 1 FROM approval_scopes s WHERE s.user_id = u.id AND s.jenis = ?)`,
        [jenis]
    );
    return recipients;
}

// Direct-add privilege for record submissions (all types except perilaku,
// which always applies directly via its own route).
// - superadmin: always direct.
// - guru/pegawai: direct ONLY when holding the approval scope for that type.
// - everyone else (siswa, unscoped staff): goes through the approval queue.
async function canDirectAdd(userId, userRole, jenis) {
    if (userRole === 'superadmin') return true;
    if (userRole !== 'guru' && userRole !== 'pegawai') return false;
    const scopes = await getApprovalScopes(userId);
    return scopes.includes(jenis);
}

// Configure multer for file uploads - use type-specific folders
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Determine upload subfolder based on route
        let subdir = 'approvals';
        if (req.originalUrl.includes('/prestasi/')) {
            subdir = 'prestasi';
        } else if (req.originalUrl.includes('/event/')) {
            subdir = 'event';
        } else if (req.originalUrl.includes('/organisasi/')) {
            subdir = 'organisasi';
        } else if (req.originalUrl.includes('/kepanitiaan/')) {
            subdir = 'kepanitiaan';
        } else if (req.originalUrl.includes('/pelanggaran/')) {
            subdir = 'pelanggaran';
        }

        // Absolute path (<backend>/uploads/...) + auto-create, independent of cwd
        cb(null, ensureUploadSubdir(subdir));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });

// Helper function to save file locally - extracts the DB-relative path from the absolute file path
const saveFileLocally = (filePath) => {
    // filePath is absolute (multer destinations are absolute).
    // DB format stays 'uploads/<type>/<file>' no matter where UPLOAD_DIR lives.
    // filePath is absolute like: c:\...\backend\uploads\prestasi\filename.jpg
    // We want: uploads/prestasi/filename.jpg

    const rel = path.relative(UPLOAD_DIR, filePath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) {
        return `uploads/${rel}`;
    }

    // If file is outside UPLOAD_DIR, use the filename and default to approvals folder
    console.warn('Upload file outside UPLOAD_DIR, using fallback:', filePath);
    const filename = path.basename(filePath);
    return `uploads/approvals/${filename}`;
};

// ==================== SUBMIT FOR APPROVAL ====================

// Submit Prestasi for Approval (or Direct Submit for Superadmin)
router.post('/prestasi/submit', auth, checkInputAccess('prestasi'), upload.single('foto'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, nama_lomba, pembina, pembina_id, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        // Kelompok mode: anggota = [{ nama, nis }, ...] (min 2). Individu: single nama/nis.
        let anggota = [];
        if (kategori_lomba === 'kelompok') {
            try {
                anggota = typeof req.body.anggota === 'string' ? JSON.parse(req.body.anggota) : (req.body.anggota || []);
            } catch {
                return res.status(400).json({ message: 'Format data anggota tidak valid' });
            }
            if (!Array.isArray(anggota) || anggota.length < 2) {
                return res.status(400).json({ message: 'Lomba kelompok membutuhkan minimal 2 anggota' });
            }
        } else {
            anggota = [{ nama, nis }];
        }
        let fotoPath = req.file ? saveFileLocally(req.file.path) : null;
        console.log('Prestasi - Using local path:', fotoPath);

        // Resolve pembina to a guru user id (frontend sends pembina_id from the teachers dropdown).
        const { id: resolvedPembinaId, nama: resolvedPembinaName } = await resolvePembina(pembina_id, pembina);
        if ((pembina_id || pembina) && !resolvedPembinaId && !resolvedPembinaName) {
            return res.status(400).json({ message: 'Data pembina tidak valid' });
        }
        // Multi-pembina: frontend sends pembina_ids (JSON array of guru ids);
        // falls back to the single primary above for old clients.
        const mentorList = await resolvePembinaIds(req.body.pembina_ids);
        const mentorIds = mentorList.length > 0
            ? mentorList.map((m) => m.id)
            : (resolvedPembinaId ? [resolvedPembinaId] : []);

        // Resolve every member (kelas/grha diambil dari database per siswa).
        // One shared grup_lomba id links kelompok members (used by the
        // pembina leaderboard so a group lomba counts exactly once).
        const grupLomba = kategori_lomba === 'kelompok'
            ? `grp_${Date.now().toString(36)}${Math.round(Math.random() * 1E6).toString(36)}`
            : null;
        const members = [];
        for (const a of anggota) {
            if (!a || !a.nis) {
                return res.status(400).json({ message: 'Setiap anggota harus memiliki NIS' });
            }
            // Throws 400 when the NIS is unknown
            const memberId = await resolveStudentIdByNis(a.nis, req.user.id);
            const [studentData] = await db.query('SELECT id, nama, nis, kelas, grha FROM users WHERE id = ?', [memberId]);
            members.push(studentData[0]);
        }

        // Move photo once (shared evidence for all members) — but ONLY for
        // direct-add rows, which are approved immediately. Queued submissions
        // keep the type-folder path; PUT /superadmin/:type/:id moves it on
        // approval (like the other four types already do).
        const directAdd = await canDirectAdd(req.user.id, userRole, 'prestasi');
        let sharedFotoPath = fotoPath;
        if (directAdd && fotoPath) {
            const movedPath = movePhotoToApprovedFolder(fotoPath, 'prestasi');
            if (movedPath) {
                sharedFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'prestasi'
        // approval scope): approved rows + IPT, skips approval queue
        if (directAdd) {
            console.log('Prestasi - Direct submission (privileged)');
            const point = await calculatePrestasiPoints(juara, kategori);

            // One transaction for the whole kelompok: all members' rows and
            // IPT updates commit atomically, never partially.
            const conn = await db.getConnection();
            const insertedIds = [];
            try {
                await conn.beginTransaction();
                for (const m of members) {
                    const [result] = await conn.query(
                        `INSERT INTO prestasi
                        (user_id, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, foto, point, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                        [m.id, m.nama, m.nis, nama_lomba, m.kelas || '', resolvedPembinaName, resolvedPembinaId, m.grha || '', juara, kategori, jenis_lomba, kategori_lomba, grupLomba, sharedFotoPath, point]
                    );
                    await setPembinaLinks(conn.query, 'prestasi_pembina', 'prestasi_id', result.insertId, mentorIds);
                    await applyIptChange(m.id, 'prestasi', point, buildKeterangan('prestasi', { nama_lomba, juara, kategori }), conn.query, { type: 'prestasi', id: result.insertId });
                    insertedIds.push(result.insertId);
                }
                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }

            console.log('Prestasi - Directly added (privileged):', insertedIds);

            return res.status(201).json({
                message: members.length > 1 ? `Prestasi kelompok berhasil ditambahkan untuk ${members.length} siswa` : 'Prestasi berhasil ditambahkan',
                ids: insertedIds,
                direct: true
            });
        }

        // QUEUE: siswa + staff without the approval scope submit for approval
        // (one row per member, same grup_lomba)
        const insertedIds = [];
        for (const m of members) {
            const [result] = await db.query(
                `INSERT INTO prestasi_approvals
                (user_id, submitted_by, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, foto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [m.id, req.user.id, m.nama, m.nis, nama_lomba, m.kelas || '', resolvedPembinaName, resolvedPembinaId, m.grha || '', juara, kategori, jenis_lomba, kategori_lomba, grupLomba, fotoPath]
            );
            await setPembinaLinks(db.query, 'prestasi_approval_pembina', 'approval_id', result.insertId, mentorIds);
            insertedIds.push(result.insertId);
        }

        // Log activity
        const memberSummary = members.map(m => `${m.nama} (${m.nis})`).join(', ');
        await logActivity(req.user.id, 'SUBMIT_PRESTASI', `User ${req.user.nama} (${req.user.role}) submitted prestasi for ${memberSummary}: ${nama_lomba}`, req.ip);

        // Notify superadmins AND staff holding the 'prestasi' approval scope
        const recipients = await getApprovalRecipients('prestasi');
        console.log('Prestasi - Recipients found:', recipients.length);
        for (const recipient of recipients) {
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approval_needed', 'Persetujuan Prestasi', ?, ?, 'prestasi')`,
                [recipient.id, `${memberSummary} mengajukan prestasi: ${nama_lomba}`, insertedIds[0]]
            );
            console.log('Prestasi - Notification sent to approver:', recipient.id);
        }

        res.status(201).json({
            message: members.length > 1 ? `Prestasi kelompok berhasil diajukan untuk ${members.length} siswa` : 'Prestasi berhasil diajukan untuk persetujuan',
            ids: insertedIds,
            direct: false
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Submit Pelanggaran for Approval (or Direct Submit for Superadmin)
router.post('/pelanggaran/submit', auth, checkInputAccess('pelanggaran'), upload.single('foto'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, keterangan, jenis_pelanggaran } = req.body;
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        let foto_path = req.file ? saveFileLocally(req.file.path) : null;
        console.log('Pelanggaran - Using local path:', foto_path);
        const point = await calculatePelanggaranPoints(jenis_pelanggaran);
        if (!point) {
            return res.status(400).json({ message: 'Detail pelanggaran belum memiliki konfigurasi tingkat atau point aktif' });
        }

        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';

        // DIRECT ADD (superadmin, or guru/pegawai holding the 'pelanggaran'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'pelanggaran')) {
            console.log('Pelanggaran - Direct submission (privileged)');

            // Move photo to organized folder if exists
            let finalFotoPath = foto_path;
            if (foto_path) {
                const movedPath = movePhotoToApprovedFolder(foto_path, 'pelanggaran');
                if (movedPath) {
                    finalFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
                }
            }

            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO pelanggaran
                    (user_id, submitted_by, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, req.user.id, nama, nis, calculatedClass, grha, keterangan, finalFotoPath, jenis_pelanggaran, point]
                );
                insertedId = result.insertId;

                await applyIptChange(userId, 'pelanggaran', point, buildKeterangan('pelanggaran', { jenis_pelanggaran }), conn.query, { type: 'pelanggaran', id: insertedId });

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }

            // Log activity
            await logActivity(req.user.id, 'SUBMIT_PELANGGARAN', `${req.user.nama} (${req.user.role}) directly added pelanggaran for ${nama} (${nis}): ${jenis_pelanggaran}`, req.ip);

            console.log('Pelanggaran - Directly added (privileged):', insertedId);

            return res.status(201).json({
                message: 'Pelanggaran berhasil ditambahkan',
                id: insertedId,
                direct: true
            });
        }

        // QUEUE: siswa + staff without the approval scope submit with pending status
        const [result] = await db.query(
            `INSERT INTO pelanggaran
            (user_id, submitted_by, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [userId, req.user.id, nama, nis, calculatedClass, grha, keterangan, foto_path, jenis_pelanggaran, point]
        );

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_PELANGGARAN', `${req.user.nama} submitted pelanggaran for approval: ${jenis_pelanggaran}`, req.ip);

        console.log('Pelanggaran - Submitted for approval:', result.insertId);

        return res.status(201).json({
            message: 'Pelanggaran berhasil diajukan untuk persetujuan',
            id: result.insertId,
            direct: false
        });

    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

router.post('/event/submit', auth, checkInputAccess('event'), upload.single('foto'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, nama_event, tingkat } = req.body;
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        let foto_path = req.file ? saveFileLocally(req.file.path) : null;
        console.log('Event - Using local path:', foto_path);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'event'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'event')) {
            console.log('Event - Direct submission (privileged)');
            const point = await calculateEventPoints(tingkat);
            
            // Move photo to organized folder if exists
            let finalFotoPath = foto_path;
            if (foto_path) {
                const movedPath = movePhotoToApprovedFolder(foto_path, 'event');
                if (movedPath) {
                    finalFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
                }
            }
            
            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO event 
                    (user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, nama_event, tingkat, finalFotoPath, point]
                );
                insertedId = result.insertId;

                await applyIptChange(userId, 'event', point, buildKeterangan('event', { nama_event, tingkat }), conn.query, { type: 'event', id: insertedId });

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }

            console.log('Event - Directly added (privileged):', insertedId);
            
            return res.status(201).json({ 
                message: 'Event berhasil ditambahkan', 
                id: insertedId,
                direct: true
            });
        }

        // QUEUE: siswa + staff without the approval scope submit for approval
        const [result] = await db.query(
            `INSERT INTO event_approvals
            (user_id, submitted_by, nama, nis, kelas, grha, pembina, nama_event, tingkat, foto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, nama_event, tingkat, foto_path]
        );

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_EVENT', `User ${req.user.nama} (${req.user.role}) submitted event for ${nama} (${nis}): ${nama_event}`, req.ip);

        // Notify superadmins AND staff holding the 'event' approval scope
        const recipients = await getApprovalRecipients('event');
        console.log('Event - Recipients found:', recipients.length);
        for (const recipient of recipients) {
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approval_needed', 'Persetujuan Event', ?, ?, 'event')`,
                [recipient.id, `${nama} (${nis}) mengajukan event: ${nama_event}`, result.insertId]
            );
            console.log('Event - Notification sent to approver:', recipient.id);
        }

        res.status(201).json({
            message: 'Event berhasil diajukan untuk persetujuan',
            id: result.insertId,
            direct: false
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Submit Organisasi for Approval (or Direct Submit for Superadmin)
router.post('/organisasi/submit', auth, checkInputAccess('organisasi'), upload.single('foto'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, jabatan_organisasi, kategori_organisasi } = req.body;
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        let foto_path = req.file ? saveFileLocally(req.file.path) : null;
        console.log('Organisasi - Using local path:', foto_path);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'organisasi'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'organisasi')) {
            console.log('Organisasi - Direct submission (privileged)');
            const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);
            
            // Move photo to organized folder if exists
            let finalFotoPath = foto_path;
            if (foto_path) {
                const movedPath = movePhotoToApprovedFolder(foto_path, 'organisasi');
                if (movedPath) {
                    finalFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
                }
            }
            
            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO organisasi 
                    (user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, jabatan_organisasi, finalFotoPath, kategori_organisasi, point]
                );
                insertedId = result.insertId;

                await applyIptChange(
                    userId,
                    'organisasi',
                    point,
                    buildKeterangan('organisasi', { kategori_organisasi, jabatan_organisasi }),
                    conn.query,
                    { type: 'organisasi', id: insertedId }
                );

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }

            console.log('Organisasi - Directly added (privileged):', insertedId);
            
            return res.status(201).json({ 
                message: 'Organisasi berhasil ditambahkan', 
                id: insertedId,
                direct: true
            });
        }
        
        // QUEUE: siswa + staff without the approval scope submit for approval
        const [result] = await db.query(
            `INSERT INTO organisasi_approvals
            (user_id, submitted_by, nama, nis, kelas, grha, pembina, jabatan_organisasi, kategori_organisasi, foto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, jabatan_organisasi, kategori_organisasi, foto_path]
        );

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_ORGANISASI', `User ${req.user.nama} (${req.user.role}) submitted organisasi for ${nama} (${nis}): ${kategori_organisasi}`, req.ip);

        // Notify superadmins AND staff holding the 'organisasi' approval scope
        const recipients = await getApprovalRecipients('organisasi');
        console.log('Organisasi - Recipients found:', recipients.length);
        for (const recipient of recipients) {
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approval_needed', 'Persetujuan Organisasi', ?, ?, 'organisasi')`,
                [recipient.id, `${nama} (${nis}) mengajukan organisasi: ${kategori_organisasi}`, result.insertId]
            );
            console.log('Organisasi - Notification sent to approver:', recipient.id);
        }

        res.status(201).json({
            message: 'Organisasi berhasil diajukan untuk persetujuan',
            id: result.insertId,
            direct: false
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Submit Kepanitiaan for Approval (or Direct Submit for Superadmin)
router.post('/kepanitiaan/submit', auth, checkInputAccess('kepanitiaan'), upload.single('foto'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, jabatan_kepanitiaan, kategori_kepanitiaan } = req.body;
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        let foto_path = req.file ? saveFileLocally(req.file.path) : null;
        console.log('Kepanitiaan - Using local path:', foto_path);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'kepanitiaan'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'kepanitiaan')) {
            console.log('Kepanitiaan - Direct submission (privileged)');
            const point = await calculateKepanitiaanPoints(jabatan_kepanitiaan);
            
            // Move photo to organized folder if exists
            let finalFotoPath = foto_path;
            if (foto_path) {
                const movedPath = movePhotoToApprovedFolder(foto_path, 'kepanitiaan');
                if (movedPath) {
                    finalFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
                }
            }
            
            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO kepanitiaan 
                    (user_id, nama, nis, kelas, grha, jabatan_kepanitiaan, foto, kategori_kepanitiaan, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, jabatan_kepanitiaan, finalFotoPath, kategori_kepanitiaan, point]
                );
                insertedId = result.insertId;

                await applyIptChange(
                    userId,
                    'kepanitiaan',
                    point,
                    buildKeterangan('kepanitiaan', { kategori_kepanitiaan, jabatan_kepanitiaan }),
                    conn.query,
                    { type: 'kepanitiaan', id: insertedId }
                );

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }

            console.log('Kepanitiaan - Directly added (privileged):', insertedId);
            
            return res.status(201).json({ 
                message: 'Kepanitiaan berhasil ditambahkan', 
                id: insertedId,
                direct: true
            });
        }
        
        // QUEUE: siswa + staff without the approval scope submit for approval
        const [result] = await db.query(
            `INSERT INTO kepanitiaan_approvals
            (user_id, submitted_by, nama, nis, kelas, grha, pembina, jabatan_kepanitiaan, kategori_kepanitiaan, foto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, jabatan_kepanitiaan, kategori_kepanitiaan, foto_path]
        );

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_KEPANITIAAN', `User ${req.user.nama} (${req.user.role}) submitted kepanitiaan for ${nama} (${nis}): ${kategori_kepanitiaan}`, req.ip);

        // Notify superadmins AND staff holding the 'kepanitiaan' approval scope
        const recipients = await getApprovalRecipients('kepanitiaan');
        console.log('Kepanitiaan - Recipients found:', recipients.length);
        for (const recipient of recipients) {
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approval_needed', 'Persetujuan Kepanitiaan', ?, ?, 'kepanitiaan')`,
                [recipient.id, `${nama} (${nis}) mengajukan kepanitiaan: ${kategori_kepanitiaan}`, result.insertId]
            );
            console.log('Kepanitiaan - Notification sent to approver:', recipient.id);
        }

        res.status(201).json({
            message: 'Kepanitiaan berhasil diajukan untuk persetujuan',
            id: result.insertId,
            direct: false
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// ==================== APPROVAL ACTIONS ====================

// REMOVED: Pembina approval route - now only superadmin approval

// SuperAdmin Approve/Reject (single-step approval)
// Non-superadmin callers must hold the approval scope for that exact type.
router.put('/superadmin/:type/:id', auth, approverFor('type'), async (req, res) => {
    let conn = null;
    try {
        const { type, id } = req.params;
        const { status, notes } = req.body;

        console.log(`SuperAdmin ${status} request: type=${type}, id=${id}`);

        // Perilaku no longer goes through approval — submissions apply directly.
        if (type === 'perilaku') {
            return res.status(400).json({ message: 'Perilaku tidak lagi memerlukan persetujuan — langsung tersimpan saat diinput' });
        }

        if (type === 'pelanggaran') {
            return handleLegacyApproval(type, id, status, notes, req.user.id, req.user.role, req.ip, res);
        }

        let table, pointField, allowedColumns;
        switch(type) {
            case 'prestasi':
                table = 'prestasi_approvals';
                pointField = 'juara';
                allowedColumns = ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'nama_lomba', 'foto', 'kelas', 'pembina', 'pembina_id', 'grha', 'juara', 'kategori', 'jenis_lomba', 'kategori_lomba', 'grup_lomba', 'superadmin_status', 'created_at'];
                break;
            case 'event':
                table = 'event_approvals';
                pointField = 'tingkat';
                allowedColumns = ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'kelas', 'grha', 'pembina', 'nama_event', 'tingkat', 'foto', 'superadmin_status', 'created_at'];
                break;
            case 'organisasi':
                table = 'organisasi_approvals';
                pointField = 'jabatan_organisasi';
                allowedColumns = ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'kelas', 'grha', 'jabatan_organisasi', 'foto', 'kategori_organisasi', 'superadmin_status', 'created_at'];
                break;
            case 'kepanitiaan':
                table = 'kepanitiaan_approvals';
                pointField = 'jabatan_kepanitiaan';
                allowedColumns = ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'kelas', 'grha', 'jabatan_kepanitiaan', 'foto', 'kategori_kepanitiaan', 'superadmin_status', 'created_at'];
                break;
            default:
                return res.status(400).json({ message: 'Invalid type' });
        }

        // Get submission data - use explicit column list instead of SELECT *
        const [submission] = await db.query(`SELECT ${allowedColumns.join(', ')} FROM ${table} WHERE id = ?`, [id]);
        if (submission.length === 0) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const data = submission[0];
        console.log('Submission data:', data);

        const approvalStatus = getRowApprovalStatus(data);
        if (approvalStatus !== 'pending') {
            return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
        }

        // Approvers cannot decide on their own submissions (superadmin excluded)
        if (req.user.role !== 'superadmin' && data.submitted_by !== null && data.submitted_by !== undefined && Number(data.submitted_by) === Number(req.user.id)) {
            return res.status(403).json({ message: 'Anda tidak dapat menyetujui pengajuan sendiri' });
        }

        const actorLabel = req.user.role === 'superadmin' ? 'SuperAdmin' : 'Approver';

        // Kelompok prestasi: one decision covers the whole group. Collect
        // still-pending sibling rows sharing this grup_lomba (each keeps its
        // own row, IPT entry, and notification — full points per member).
        let targetRows = [data];
        if (type === 'prestasi' && data.grup_lomba) {
            const [siblings] = await db.query(
                `SELECT ${allowedColumns.join(', ')} FROM ${table} WHERE grup_lomba = ? AND id <> ?`,
                [data.grup_lomba, data.id]
            );
            for (const sib of siblings) {
                if (getRowApprovalStatus(sib) === 'pending') targetRows.push(sib);
            }
        }
        const isGroupDecision = targetRows.length > 1;

        // One transaction for the whole decision (all kelompok members):
        // staging flips, main-table inserts, IPT recompute, and
        // notifications commit atomically. Pool-only side effects
        // (activity log, orphan-file cleanup) are deferred until after
        // the commit and flushed below.
        conn = await db.getConnection();
        await conn.beginTransaction();
        const deferredLogs = [];
        const deferredOrphans = [];
        let responseMessage = '';

        if (status === 'approved') {
            for (const row of targetRows) {
            const data = row;
            // Calculate points
            let pointChange = 0;
            if (type === 'prestasi') {
                pointChange = await calculatePrestasiPoints(data.juara, data.kategori);
            } else if (type === 'event') {
                pointChange = await calculateEventPoints(data.tingkat);
            } else if (type === 'kepanitiaan') {
                pointChange = await calculateKepanitiaanPoints(data[pointField]);
            } else {
                pointChange = await calculateOrganisasiPoints(data.kategori_organisasi, data[pointField]);
            }

            // Move photo to organized folder if exists
            // `foto` is the current column name (`foto_path` kept as fallback for older DBs)
            let finalFotoPath = data.foto ?? data.foto_path;
            if (finalFotoPath) {
                const movedPath = movePhotoToApprovedFolder(finalFotoPath, type);
                if (movedPath) {
                    finalFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
                } else {
                    // The file may already have been moved to the approved folder
                    // (e.g. approving another member of the same kelompok submission
                    // that shares one evidence file). Fall back to the approved
                    // location when the stored path no longer exists on disk.
                    const approvedGuess = path.join('uploads', 'approved', type, path.basename(finalFotoPath)).replace(/\\/g, '/');
                    let storedExists = false;
                    try {
                        storedExists = fs.existsSync(resolveUploadPath(finalFotoPath));
                    } catch {
                        storedExists = false;
                    }
                    if (!storedExists) {
                        try {
                            if (fs.existsSync(resolveUploadPath(approvedGuess))) {
                                console.log(`Approval evidence already in approved folder, reusing: ${approvedGuess}`);
                                finalFotoPath = approvedGuess;
                            }
                        } catch {
                            // keep the stored path
                        }
                    }
                }
            }

            // Insert to actual table
            let insertQuery, insertParams;
            if (type === 'prestasi') {
                insertQuery = `INSERT INTO prestasi (user_id, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`;
                insertParams = [data.user_id, data.nama || 'Unknown', data.nis || '', data.nama_lomba || '', data.kelas || '', data.pembina || '', data.pembina_id || null, data.grha || '', data.juara || '', data.kategori || '', data.jenis_lomba || 'akademik', data.kategori_lomba || 'individu', data.grup_lomba || null, finalFotoPath || null, pointChange];
            } else if (type === 'event') {
                insertQuery = `INSERT INTO event (user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`;
                insertParams = [data.user_id, data.nama || 'Unknown', data.nis || '', data.kelas || '', data.grha || '', data.nama_event || '', data.tingkat || '', finalFotoPath || null, pointChange];
            } else if (type === 'kepanitiaan') {
                insertQuery = `INSERT INTO kepanitiaan (user_id, nama, nis, kelas, grha, jabatan_kepanitiaan, kategori_kepanitiaan, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`;
                insertParams = [data.user_id, data.nama || 'Unknown', data.nis || '', data.kelas || '', data.grha || '', data.jabatan_kepanitiaan || '', data.kategori_kepanitiaan || '', finalFotoPath || null, pointChange];
            } else {
                insertQuery = `INSERT INTO organisasi (user_id, nama, nis, kelas, grha, jabatan_organisasi, kategori_organisasi, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`;
                insertParams = [data.user_id, data.nama || 'Unknown', data.nis || '', data.kelas || '', data.grha || '', data.jabatan_organisasi || '', data.kategori_organisasi || '', finalFotoPath || null, pointChange];
            }

            const [mainRow] = await conn.query(insertQuery, insertParams);

            // Prestasi: carry mentor links from the approval row to the new
            // record (falls back to the primary pembina for pre-migration rows).
            if (type === 'prestasi') {
                const [alinks] = await conn.query(
                    'SELECT guru_id FROM prestasi_approval_pembina WHERE approval_id = ?',
                    [row.id]
                );
                const copyIds = alinks.length > 0
                    ? alinks.map((l) => l.guru_id)
                    : (data.pembina_id ? [data.pembina_id] : []);
                await setPembinaLinks(conn.query, 'prestasi_pembina', 'prestasi_id', mainRow.insertId, copyIds);
            }

            // Keep the submission row pointing at the real file location
            // (the file was just moved to the approved folder above).
            if (finalFotoPath) {
                await conn.query(`UPDATE ${table} SET foto = ? WHERE id = ?`, [finalFotoPath, row.id]);
            }

            await applyIptChange(
                data.user_id,
                type,
                pointChange,
                buildKeterangan(type, data),
                conn.query,
                { type, id: mainRow.insertId }
            );

            // Conditional staging flip: 0 rows means a concurrent decision
            // already processed this row — abort the whole decision.
            const marked = await approveSubmission(table, row.id, notes || 'Disetujui oleh SuperAdmin', conn.query);
            if (!marked) {
                await conn.rollback();
                return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
            }

            // Deferred until after commit (logActivity writes via the pool).
            deferredLogs.push([req.user.id, `APPROVE_${type.toUpperCase()}`, `${actorLabel} ${req.user.nama} approved ${type} for ${data.nama} (${data.nis}): ${data[pointField]}`, req.ip]);

            // Notify student
            await conn.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) VALUES (?, 'approved', 'Pengajuan Disetujui', ?, ?, ?)`,
                [data.user_id, `Pengajuan ${type} Anda telah disetujui`, row.id, type]
            );

            }
            responseMessage = isGroupDecision ? `${type} kelompok berhasil disetujui untuk ${targetRows.length} siswa` : `${type} berhasil disetujui`;
        } else {
            for (const row of targetRows) {
            const data = row;
            const marked = await rejectSubmission(table, row.id, notes || 'Ditolak oleh SuperAdmin', conn.query);
            if (!marked) {
                await conn.rollback();
                return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
            }

            // Delete the evidence file when no other row references it anymore
            // (kelompok siblings share one file — never strand them).
            // Deferred until after commit: the check must read committed state.
            const fotoVal = data.foto ?? data.foto_path;
            if (fotoVal) {
                deferredOrphans.push({ foto: fotoVal, table, id: row.id, folderHint: type });
            }

            // Deferred until after commit (logActivity writes via the pool).
            deferredLogs.push([req.user.id, `REJECT_${type.toUpperCase()}`, `${actorLabel} ${req.user.nama} rejected ${type} for ${data.nama} (${data.nis}): ${notes || 'No reason'}`, req.ip]);

            // Notify student of rejection
            await conn.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) VALUES (?, 'rejected', 'Pengajuan Ditolak', ?, ?, ?)`,
                [data.user_id, `Pengajuan ${type} Anda ditolak: ${notes || 'Tanpa alasan'}`, row.id, type]
            );

            }
            responseMessage = isGroupDecision ? `${type} kelompok berhasil ditolak untuk ${targetRows.length} siswa` : `${type} berhasil ditolak`;
        }

        await conn.commit();

        for (const o of deferredOrphans) {
            await deletePhotoIfOrphan(db, o.foto, { exclude: { table: o.table, id: o.id }, folderHint: o.folderHint });
        }
        for (const args of deferredLogs) {
            await logActivity(...args);
        }

        res.json({ message: responseMessage });
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (_) {}
        }
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});

async function handleLegacyApproval(type, id, status, notes, approverId, approverRole, ipAddress, res) {
    const table = type;
    const actorLabel = approverRole === 'superadmin' ? 'SuperAdmin' : 'Approver';
    try {
        // Define allowed columns for each table type
        const tableColumns = {
            'prestasi': ['id', 'user_id', 'nama', 'nis', 'jenis', 'nama_lomba', 'foto', 'kelas', 'pembina', 'grha', 'juara', 'kategori', 'point', 'status', 'rejection_reason', 'created_at'],
            'event': ['id', 'user_id', 'nama', 'nis', 'kelas', 'grha', 'pembina', 'nama_event', 'tingkat', 'foto', 'point', 'status', 'rejection_reason', 'created_at'],
            'organisasi': ['id', 'user_id', 'nama', 'nis', 'kelas', 'grha', 'jabatan_organisasi', 'foto', 'kategori_organisasi', 'point', 'status', 'rejection_reason', 'created_at'],
            'kepanitiaan': ['id', 'user_id', 'nama', 'nis', 'kelas', 'grha', 'jabatan_kepanitiaan', 'foto', 'point', 'status', 'rejection_reason', 'created_at'],
            'pelanggaran': ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'kelas', 'grha', 'keterangan', 'foto', 'jenis_pelanggaran', 'point_dikurangi', 'status', 'rejection_reason', 'created_at'],
            'perilaku': ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'kelas', 'grha', 'karakter_siswa', 'point', 'status', 'rejection_reason', 'created_at']
        };

        const allowedColumns = tableColumns[table] || ['id', 'user_id', 'nama', 'status', 'created_at'];
        const [rows] = await db.query(`SELECT ${allowedColumns.join(', ')} FROM ${table} WHERE id = ?`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        const data = rows[0];

        if (data.status !== 'pending') {
            return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
        }

        // Approvers cannot decide on their own submissions (superadmin excluded)
        if (approverRole !== 'superadmin' && data.submitted_by !== null && data.submitted_by !== undefined && Number(data.submitted_by) === Number(approverId)) {
            return res.status(403).json({ message: 'Anda tidak dapat menyetujui pengajuan sendiri' });
        }

        if (status === 'approved') {
            const conn = await db.getConnection();
            const deferredLogs = [];
            try {
                await conn.beginTransaction();
                const [marked] = await conn.query(`UPDATE ${table} SET status = 'approved' WHERE id = ? AND status = 'pending'`, [id]);
                if (marked.affectedRows === 0) {
                    await conn.rollback();
                    return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
                }

                if (type === 'pelanggaran') {
                    await applyIptChange(
                        data.user_id,
                        'pelanggaran',
                        // point_dikurangi sudah negatif (hasil calculatePelanggaranPoints),
                        // jadi langsung dijumlahkan — tanpa tanda minus.
                        data.point_dikurangi,
                        `Pelanggaran: ${data.jenis_pelanggaran}`,
                        conn.query,
                        { type: 'pelanggaran', id }
                    );
                } else {
                    await applyPerilakuIptChange(
                        data.user_id,
                        data.point,
                        `Perilaku: ${data.karakter_siswa}`,
                        id,
                        conn.query,
                        { type: 'perilaku', id }
                    );
                }

                // Deferred until after commit (logActivity writes via the pool).
                deferredLogs.push([approverId, `APPROVE_${type.toUpperCase()}`, `${actorLabel} approved ${type} for ${data.nama} (${data.nis})`, ipAddress]);

                await conn.query(
                    `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) VALUES (?, 'approved', 'Pengajuan Disetujui', ?, ?, ?)`,
                    [data.user_id, `Pengajuan ${type} Anda telah disetujui`, id, type]
                );

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            } finally {
                conn.release();
            }
            for (const args of deferredLogs) {
                await logActivity(...args);
            }

            return res.json({ message: `${type} berhasil disetujui` });
        }

        const conn = await db.getConnection();
        const deferredLogs = [];
        try {
            await conn.beginTransaction();
            const [marked] = await conn.query(
                `UPDATE ${table} SET status = 'rejected', rejection_reason = ? WHERE id = ? AND status = 'pending'`,
                [notes || 'Ditolak oleh SuperAdmin', id]
            );
            if (marked.affectedRows === 0) {
                await conn.rollback();
                return res.status(400).json({ message: 'Pengajuan ini sudah diproses' });
            }

            // Deferred until after commit (logActivity writes via the pool).
            deferredLogs.push([approverId, `REJECT_${type.toUpperCase()}`, `${actorLabel} rejected ${type} for ${data.nama} (${data.nis}): ${notes || 'No reason'}`, ipAddress]);

            await conn.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type) VALUES (?, 'rejected', 'Pengajuan Ditolak', ?, ?, ?)`,
                [data.user_id, `Pengajuan ${type} Anda ditolak: ${notes || 'Tanpa alasan'}`, id, type]
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }
        for (const args of deferredLogs) {
            await logActivity(...args);
        }

        return res.json({ message: `${type} berhasil ditolak` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
}

// ==================== GET APPROVALS ====================

// Get pending approvals count (scoped to the caller's approval scopes unless superadmin)
router.get('/pending-count', auth, approverOnly, async (req, res) => {
    try {
        const col = await getApprovalStatusColumn();
        const scopes = req.user.role === 'superadmin' ? null : (req.approvalScopes || []);

        const counts = { prestasi: 0, event: 0, organisasi: 0, kepanitiaan: 0, pelanggaran: 0 };
        const canSee = (jenis) => scopes === null || scopes.includes(jenis);

        if (canSee('prestasi')) {
            const [prestasiCount] = await db.query(
                `SELECT COUNT(*) as count FROM prestasi_approvals WHERE ${col} = 'pending'`
            );
            counts.prestasi = prestasiCount[0].count || 0;
        }
        if (canSee('event')) {
            const [eventCount] = await db.query(
                `SELECT COUNT(*) as count FROM event_approvals WHERE ${col} = 'pending'`
            );
            counts.event = eventCount[0].count || 0;
        }
        if (canSee('organisasi')) {
            const [organisasiCount] = await db.query(
                `SELECT COUNT(*) as count FROM organisasi_approvals WHERE ${col} = 'pending'`
            );
            counts.organisasi = organisasiCount[0].count || 0;
        }
        if (canSee('kepanitiaan')) {
            const [kepanitiaanCount] = await db.query(
                `SELECT COUNT(*) as count FROM kepanitiaan_approvals WHERE ${col} = 'pending'`
            );
            counts.kepanitiaan = kepanitiaanCount[0].count || 0;
        }
        if (canSee('pelanggaran')) {
            const [pelanggaranCount] = await db.query(
                "SELECT COUNT(*) as count FROM pelanggaran WHERE status = 'pending'"
            );
            counts.pelanggaran = pelanggaranCount[0].count || 0;
        }

        const total = counts.prestasi + counts.event + counts.organisasi + counts.kepanitiaan + counts.pelanggaran;

        res.json({ total, ...counts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all approvals (scoped to the caller's approval scopes unless superadmin)
router.get('/all', auth, approverOnly, async (req, res) => {
    try {
        const scopes = req.user.role === 'superadmin' ? null : (req.approvalScopes || []);
        const canSee = (jenis) => scopes === null || scopes.includes(jenis);

        const [prestasi, event, organisasi, kepanitiaan] = await Promise.all([
            canSee('prestasi') ? fetchPendingApprovals('prestasi_approvals', 'p') : [],
            canSee('event') ? fetchPendingApprovals('event_approvals', 'e') : [],
            canSee('organisasi') ? fetchPendingApprovals('organisasi_approvals', 'o') : [],
            canSee('kepanitiaan') ? fetchPendingApprovals('kepanitiaan_approvals', 'k') : []
        ]);

        // "Diajukan Oleh" = actual submitter (submitted_by), not the target
        // student (user_id). COALESCE covers legacy rows with submitted_by NULL.
        let pelanggaran = [];
        if (canSee('pelanggaran')) {
            const [rows] = await db.query(`
                SELECT p.*,
                       COALESCE(s.nama, u.nama) as user_name,
                       s.nama as submitted_by_name,
                       s.role as submitted_by_role
                FROM pelanggaran p
                JOIN users u ON p.user_id = u.id
                LEFT JOIN users s ON p.submitted_by = s.id
                WHERE p.status = 'pending'
            `);
            pelanggaran = rows;
        }

        res.json({
            prestasi: prestasi.map(p => ({ ...p, type: 'prestasi', status: getRowApprovalStatus(p) })),
            event: event.map(e => ({ ...e, type: 'event', status: getRowApprovalStatus(e) })),
            organisasi: organisasi.map(o => ({ ...o, type: 'organisasi', status: getRowApprovalStatus(o) })),
            kepanitiaan: kepanitiaan.map(k => ({ ...k, type: 'kepanitiaan', status: getRowApprovalStatus(k) })),
            pelanggaran: pelanggaran.map(p => ({ ...p, type: 'pelanggaran' }))
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get approvals for Pembina (Guru) - REMOVED: No longer needed

// Get user's submissions
router.get('/user-submissions', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const col = await getApprovalStatusColumn();

        const [prestasi] = await db.query(`
            SELECT *,
                   superadmin_status as status,
                   'prestasi' as type
            FROM prestasi_approvals
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);
        await attachPembinaLists(prestasi, 'prestasi_approval_pembina', 'approval_id');

        const [event] = await db.query(`
            SELECT *,
                   superadmin_status as status,
                   'event' as type
            FROM event_approvals
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        const [organisasi] = await db.query(`
            SELECT *,
                   superadmin_status as status,
                   'organisasi' as type
            FROM organisasi_approvals
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        const [kepanitiaan] = await db.query(`
            SELECT *,
                   superadmin_status as status,
                   'kepanitiaan' as type
            FROM kepanitiaan_approvals
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        const [pelanggaran] = await db.query(`
            SELECT *,
                   status,
                   'pelanggaran' as type
            FROM pelanggaran
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        const [perilaku] = await db.query(`
            SELECT *,
                   status,
                   'perilaku' as type
            FROM perilaku
            WHERE user_id = ? OR submitted_by = ?
            ORDER BY created_at DESC
        `, [userId, userId]);

        res.json({
            prestasi,
            event,
            organisasi,
            kepanitiaan,
            pelanggaran,
            perilaku
        });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// ==================== NOTIFICATIONS ====================

// Get unread notifications count
router.get('/notifications/count', auth, async (req, res) => {
    try {
        const [result] = await db.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [req.user.id]
        );
        res.json({ count: result[0].count });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Get all notifications
router.get('/notifications', auth, async (req, res) => {
    try {
        const [notifications] = await db.query(
            `SELECT n.*, 
                CASE 
                    WHEN n.related_type = 'prestasi' THEN (SELECT nama_lomba FROM prestasi_approvals WHERE id = n.related_id)
                    WHEN n.related_type = 'event' THEN (SELECT nama_event FROM event_approvals WHERE id = n.related_id)
                    WHEN n.related_type = 'organisasi' THEN (SELECT kategori_organisasi FROM organisasi_approvals WHERE id = n.related_id)
                    WHEN n.related_type = 'student_creation' THEN (SELECT nama FROM student_creation_approvals WHERE id = n.related_id)
                    WHEN n.related_type = 'biodata' THEN (SELECT u.nama FROM biodata_update_approvals b JOIN users u ON b.user_id = u.id WHERE b.id = n.related_id)
                    WHEN n.related_type = 'pelanggaran' THEN (SELECT keterangan FROM pelanggaran WHERE id = n.related_id)
                    WHEN n.related_type = 'perilaku' THEN (SELECT karakter_siswa FROM perilaku WHERE id = n.related_id)
                END as detail_name
             FROM notifications n 
             WHERE n.user_id = ? 
             ORDER BY n.created_at DESC 
             LIMIT 50`,
            [req.user.id]
        );
        
        res.json(notifications);
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Mark single notification as read
router.put('/notifications/:id/read', auth, async (req, res) => {
    try {
        const [result] = await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

// Mark all notifications as read
router.put('/notifications/read-all', auth, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [req.user.id]
        );
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error(error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    }
});

module.exports = router;
