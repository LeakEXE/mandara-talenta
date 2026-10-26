const express = require('express');
const router = express.Router();
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS, EVIDENCE_MAX_FILES, assertEvidenceRequired } = require('../utils/evidenceUpload');
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
const { resolveStudentIdByNis, resolvePembina, resolvePembinaIds, resolveRequiredPembina, setPembinaLinks, attachPembinaLists, applyIptChange, applyPerilakuIptChange, buildKeterangan } = require('../utils/ipt');
const { normalizeTanggalPelaksanaan } = require('../utils/prestasiFields');
const {
    getApprovalStatusColumn,
    getRowApprovalStatus,
    fetchPendingApprovals,
    approveSubmission,
    rejectSubmission
} = require('../utils/approvalSchema');
const {
    uploadedPaths,
    attachEvidence,
    listEvidence,
    replaceEvidence,
    parseEvidenceIdList,
    validateEvidenceSelection,
    copyEvidence,
    deleteEvidenceForRecord,
    moveEvidenceToApproved,
    deleteEvidenceFilesIfOrphan,
    withEvidenceUploadCleanup
} = require('../utils/evidenceStore');
const { ensureUploadSubdir, UPLOAD_DIR, resolveUploadPath } = require('../utils/paths');
const { getCurrentAcademicYear } = require('../utils/academicYear');
const fs = require('fs');
// Local file storage only - Google Drive removed

// Reject blank required fields with a clear 400. Without this, an empty NIS
// falls through to resolveStudentIdByNis' self-fallback and files the record
// under the submitter with blank identity; unknown point keys silently score 0.
// All submit handlers below surface error.statusCode, so throwing is enough.
function requireFields(body, fields) {
    const missing = fields.filter((f) => {
        const v = body?.[f];
        return v === undefined || v === null || String(v).trim() === '';
    });
    if (missing.length > 0) {
        const error = new Error(`Field wajib diisi: ${missing.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }
}

// Notify superadmins AND staff holding the approval scope for this type.
async function getApprovalRecipients(jenis, context = {}) {
    const { kelas = [], pembinaIds = [], pembinaNames = [] } = context;
    const [admins] = await db.query(`SELECT id FROM users WHERE role = 'superadmin'`);
    const ids = new Set(admins.map((a) => a.id));

    // Staff related to THIS submission only: wali kelas of the students'
    // classes (current academic year) plus the listed pembina. School-wide
    // fan-out to every scope holder spams unrelated users on a shared NAT
    // where everyone already shares one IP budget.
    const related = new Set(pembinaIds.filter(Number.isInteger));
    if (pembinaNames.length > 0) {
        const [byName] = await db.query(
            `SELECT id FROM users WHERE nama IN (?) AND role IN ('guru', 'pegawai')`,
            [pembinaNames]
        );
        for (const r of byName) related.add(r.id);
    }
    const classList = [...new Set((Array.isArray(kelas) ? kelas : [kelas]).filter(Boolean))];
    if (classList.length > 0) {
        try {
            const [wali] = await db.query(
                `SELECT guru_id FROM wali_kelas_assignment WHERE kelas IN (?) AND tahun_ajaran = ?`,
                [classList, getCurrentAcademicYear()]
            );
            for (const w of wali) {
                if (Number.isInteger(w.guru_id)) related.add(w.guru_id);
            }
        } catch {
            // assignment lookup failed: fall through to the safety net below
        }
    }

    const holdersOf = async (idSet) => {
        if (idSet.size === 0) return [];
        const [rows] = await db.query(
            `SELECT user_id AS id FROM approval_scopes WHERE jenis = ? AND user_id IN (${[...idSet].map(() => '?').join(',')})`,
            [jenis, ...idSet]
        );
        return rows;
    };

    let scoped = await holdersOf(related);
    if (scoped.length === 0) {
        // Safety net: nobody related holds the scope notify all holders
        // of the jenis so the submission never sits unhandled.
        const [all] = await db.query(`SELECT user_id AS id FROM approval_scopes WHERE jenis = ?`, [jenis]);
        scoped = all;
    }
    for (const s of scoped) ids.add(s.id);
    return [...ids].map((id) => ({ id }));
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
router.post('/prestasi/submit', auth, checkInputAccess('prestasi'), withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'prestasi'), async (req, res) => {
    try {
        assertEvidenceRequired(req.files);
        const userRole = req.user.role;
        const { nama, nis, nama_lomba, pembina, pembina_id, grha, juara, kategori, jenis_lomba = 'akademik', kategori_lomba = 'individu' } = req.body;
        let tanggalPelaksanaan = null;
        try {
            tanggalPelaksanaan = normalizeTanggalPelaksanaan(req.body.tanggal_pelaksanaan);
        } catch (err) {
            return res.status(err.statusCode || 400).json({ message: err.message });
        }
        // Kelompok carries its members in `anggota` (validated below); individu
        // must name a real student up front (empty NIS used to self-file).
        if (kategori_lomba === 'kelompok') {
            requireFields(req.body, ['nama_lomba', 'juara', 'kategori']);
        } else {
            requireFields(req.body, ['nama', 'nis', 'grha', 'nama_lomba', 'juara', 'kategori']);
        }
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
        const fotoPaths = uploadedPaths(req, 'prestasi');
        console.log('Prestasi - Using local paths:', fotoPaths);

        const { pembinaId: resolvedPembinaId, pembinaName: resolvedPembinaName, mentorIds } =
            await resolveRequiredPembina(pembina_id, pembina, req.body.pembina_ids);

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

        // Move photo once (shared evidence for all members) but ONLY for
        // direct-add rows, which are approved immediately. Queued submissions
        // keep the type-folder path; PUT /superadmin/:type/:id moves it on
        // approval (like the other four types already do).
        const directAdd = await canDirectAdd(req.user.id, userRole, 'prestasi');
        let sharedFotoPaths = fotoPaths;
        if (directAdd && fotoPaths.length > 0) {
            const moved = moveEvidenceToApproved(fotoPaths, 'prestasi');
            sharedFotoPaths = fotoPaths.map((p) => moved.get(p) || p);
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
                        (user_id, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, foto, point, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                        [m.id, m.nama, m.nis, nama_lomba, m.kelas || '', resolvedPembinaName, resolvedPembinaId, m.grha || '', juara, kategori, jenis_lomba, kategori_lomba, grupLomba, tanggalPelaksanaan, sharedFotoPaths[0] || null, point]
                    );
                    await replaceEvidence('prestasi', result.insertId, sharedFotoPaths, conn.query);
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
        // (one row per member, same grup_lomba). All rows and their evidence
        // commit together so a group submission is never half-created.
        const insertedIds = [];
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            for (const m of members) {
                const [result] = await conn.query(
                    `INSERT INTO prestasi_approvals
                    (user_id, submitted_by, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, foto)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [m.id, req.user.id, m.nama, m.nis, nama_lomba, m.kelas || '', resolvedPembinaName, resolvedPembinaId, m.grha || '', juara, kategori, jenis_lomba, kategori_lomba, grupLomba, tanggalPelaksanaan, fotoPaths[0] || null]
                );
                await replaceEvidence('prestasi_approvals', result.insertId, fotoPaths, conn.query);
                await setPembinaLinks(conn.query, 'prestasi_approval_pembina', 'approval_id', result.insertId, mentorIds);
                insertedIds.push(result.insertId);
            }
            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

        // Log activity
        const memberSummary = members.map(m => `${m.nama} (${m.nis})`).join(', ');
        await logActivity(req.user.id, 'SUBMIT_PRESTASI', `User ${req.user.nama} (${req.user.role}) submitted prestasi for ${memberSummary}: ${nama_lomba}`, req.ip);

        // Notify superadmins + related scope-holders (wali kelas / pembina)
        const recipients = await getApprovalRecipients('prestasi', {
            kelas: members.map((m) => m.kelas),
            pembinaIds: mentorIds
        });
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
router.post('/pelanggaran/submit', auth, checkInputAccess('pelanggaran'), withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'pelanggaran'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, keterangan, jenis_pelanggaran } = req.body;
        requireFields(req.body, ['nama', 'nis', 'grha', 'keterangan', 'jenis_pelanggaran']);
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        const fotoPaths = uploadedPaths(req, 'pelanggaran');
        console.log('Pelanggaran - Using local paths:', fotoPaths);
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

            // Move every file to the organized folder once.
            const moved = moveEvidenceToApproved(fotoPaths, 'pelanggaran');
            const finalFotoPaths = fotoPaths.map((p) => moved.get(p) || p);

            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO pelanggaran
                    (user_id, submitted_by, nama, nis, kelas, grha, keterangan, foto, jenis_pelanggaran, point_dikurangi, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, req.user.id, nama, nis, calculatedClass, grha, keterangan, finalFotoPaths[0] || null, jenis_pelanggaran, point]
                );
                insertedId = result.insertId;
                await replaceEvidence('pelanggaran', insertedId, finalFotoPaths, conn.query);

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
            [userId, req.user.id, nama, nis, calculatedClass, grha, keterangan, fotoPaths[0] || null, jenis_pelanggaran, point]
        );
        await replaceEvidence('pelanggaran', result.insertId, fotoPaths, db.query);

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

router.post('/event/submit', auth, checkInputAccess('event'), withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'event'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, nama_event, tingkat } = req.body;
        requireFields(req.body, ['nama', 'nis', 'grha', 'nama_event', 'tingkat']);
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        const fotoPaths = uploadedPaths(req, 'event');
        console.log('Event - Using local paths:', fotoPaths);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'event'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'event')) {
            console.log('Event - Direct submission (privileged)');
            const point = await calculateEventPoints(tingkat);
            
            // Move every file to the organized folder once.
            const moved = moveEvidenceToApproved(fotoPaths, 'event');
            const finalFotoPaths = fotoPaths.map((p) => moved.get(p) || p);

            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO event 
                    (user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, nama_event, tingkat, finalFotoPaths[0] || null, point]
                );
                insertedId = result.insertId;
                await replaceEvidence('event', insertedId, finalFotoPaths, conn.query);

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
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, nama_event, tingkat, fotoPaths[0] || null]
        );
        await replaceEvidence('event_approvals', result.insertId, fotoPaths, db.query);

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_EVENT', `User ${req.user.nama} (${req.user.role}) submitted event for ${nama} (${nis}): ${nama_event}`, req.ip);

        // Notify superadmins + related scope-holders (wali kelas / pembina)
        const recipients = await getApprovalRecipients('event', {
            kelas: calculatedClass,
            pembinaNames: pembina ? [pembina] : []
        });
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
router.post('/organisasi/submit', auth, checkInputAccess('organisasi'), withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'organisasi'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, jabatan_organisasi, kategori_organisasi } = req.body;
        requireFields(req.body, ['nama', 'nis', 'grha', 'jabatan_organisasi', 'kategori_organisasi']);
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        const fotoPaths = uploadedPaths(req, 'organisasi');
        console.log('Organisasi - Using local paths:', fotoPaths);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'organisasi'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'organisasi')) {
            console.log('Organisasi - Direct submission (privileged)');
            const point = await calculateOrganisasiPoints(kategori_organisasi, jabatan_organisasi);
            
            // Move every file to the organized folder once.
            const moved = moveEvidenceToApproved(fotoPaths, 'organisasi');
            const finalFotoPaths = fotoPaths.map((p) => moved.get(p) || p);

            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO organisasi 
                    (user_id, nama, nis, kelas, grha, jabatan_organisasi, foto, kategori_organisasi, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, jabatan_organisasi, finalFotoPaths[0] || null, kategori_organisasi, point]
                );
                insertedId = result.insertId;
                await replaceEvidence('organisasi', insertedId, finalFotoPaths, conn.query);

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
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, jabatan_organisasi, kategori_organisasi, fotoPaths[0] || null]
        );
        await replaceEvidence('organisasi_approvals', result.insertId, fotoPaths, db.query);

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_ORGANISASI', `User ${req.user.nama} (${req.user.role}) submitted organisasi for ${nama} (${nis}): ${kategori_organisasi}`, req.ip);

        // Notify superadmins + related scope-holders (wali kelas / pembina)
        const recipients = await getApprovalRecipients('organisasi', {
            kelas: calculatedClass,
            pembinaNames: pembina ? [pembina] : []
        });
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
router.post('/kepanitiaan/submit', auth, checkInputAccess('kepanitiaan'), withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), 'kepanitiaan'), async (req, res) => {
    try {
        const userRole = req.user.role;
        const { nama, nis, grha, pembina, jabatan_kepanitiaan, kategori_kepanitiaan } = req.body;
        requireFields(req.body, ['nama', 'nis', 'grha', 'jabatan_kepanitiaan', 'kategori_kepanitiaan']);
        const userId = await resolveStudentIdByNis(nis, req.user.id);
        const fotoPaths = uploadedPaths(req, 'kepanitiaan');
        console.log('Kepanitiaan - Using local paths:', fotoPaths);
        
        // Get student's calculated class from database
        const [studentData] = await db.query('SELECT kelas FROM users WHERE id = ?', [userId]);
        const calculatedClass = studentData[0]?.kelas || '';
        
        // DIRECT ADD (superadmin, or guru/pegawai holding the 'kepanitiaan'
        // approval scope): approved insert + IPT change, skips approval queue
        if (await canDirectAdd(req.user.id, userRole, 'kepanitiaan')) {
            console.log('Kepanitiaan - Direct submission (privileged)');
            const point = await calculateKepanitiaanPoints(jabatan_kepanitiaan);
            
            // Move every file to the organized folder once.
            const moved = moveEvidenceToApproved(fotoPaths, 'kepanitiaan');
            const finalFotoPaths = fotoPaths.map((p) => moved.get(p) || p);

            const conn = await db.getConnection();
            let insertedId = null;
            try {
                await conn.beginTransaction();
                const [result] = await conn.query(
                    `INSERT INTO kepanitiaan 
                    (user_id, nama, nis, kelas, grha, jabatan_kepanitiaan, foto, kategori_kepanitiaan, point, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
                    [userId, nama, nis, calculatedClass, grha, jabatan_kepanitiaan, finalFotoPaths[0] || null, kategori_kepanitiaan, point]
                );
                insertedId = result.insertId;
                await replaceEvidence('kepanitiaan', insertedId, finalFotoPaths, conn.query);

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
            [userId, req.user.id, nama, nis, calculatedClass, grha, pembina, jabatan_kepanitiaan, kategori_kepanitiaan, fotoPaths[0] || null]
        );
        await replaceEvidence('kepanitiaan_approvals', result.insertId, fotoPaths, db.query);

        // Log activity
        await logActivity(req.user.id, 'SUBMIT_KEPANITIAAN', `User ${req.user.nama} (${req.user.role}) submitted kepanitiaan for ${nama} (${nis}): ${kategori_kepanitiaan}`, req.ip);

        // Notify superadmins + related scope-holders (wali kelas / pembina)
        const recipients = await getApprovalRecipients('kepanitiaan', {
            kelas: calculatedClass,
            pembinaNames: pembina ? [pembina] : []
        });
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

const pendingEditConfig = {
    prestasi: { table: 'prestasi_approvals', evidenceType: 'prestasi', statusColumn: 'superadmin_status' },
    event: { table: 'event_approvals', evidenceType: 'event', statusColumn: 'superadmin_status' },
    organisasi: { table: 'organisasi_approvals', evidenceType: 'organisasi', statusColumn: 'superadmin_status' },
    kepanitiaan: { table: 'kepanitiaan_approvals', evidenceType: 'kepanitiaan', statusColumn: 'superadmin_status' },
    pelanggaran: { table: 'pelanggaran', evidenceType: 'pelanggaran', statusColumn: 'status' }
};
const pendingEditUploads = Object.fromEntries(
    Object.entries(pendingEditConfig).map(([type, config]) => [
        type,
        withEvidenceUploadCleanup(upload.array('foto', EVIDENCE_MAX_FILES), config.evidenceType)
    ])
);
const pendingEditOptions = {
    prestasi: {
        juara: ['peserta', 'finalis', 'harapan_iii', 'harapan_ii', 'harapan_i', 'juara_iii', 'juara_ii', 'juara_i'],
        kategori: ['sekolah', 'kecamatan', 'kabupaten', 'provinsi', 'nasional', 'internasional'],
        jenis_lomba: ['akademik', 'non_akademik']
    },
    event: {
        tingkat: ['sekolah', 'kecamatan', 'kabupaten', 'provinsi', 'nasional', 'internasional']
    },
    organisasi: {
        jabatan_organisasi: ['ketua', 'wakil ketua', 'sekretaris', 'bendahara', 'koordinator', 'anggota']
    },
    kepanitiaan: {
        jabatan_kepanitiaan: ['ketua', 'wakil ketua', 'sekretaris', 'bendahara', 'koordinator', 'anggota']
    }
};

router.put('/user-submissions/:type/:id', auth, (req, res, next) => {
    const uploadMiddleware = pendingEditUploads[req.params.type];
    if (!uploadMiddleware) {
        return res.status(400).json({ message: 'Jenis pengajuan tidak valid' });
    }
    return uploadMiddleware(req, res, next);
}, async (req, res) => {
    const config = pendingEditConfig[req.params.type];
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID pengajuan tidak valid' });
    }

    let conn;
    let transactionStarted = false;
    let removedEvidencePaths = [];
    let updatedRows = [];
    try {
        const { type } = req.params;
        const requestedGroupCategory = type === 'prestasi' && String(req.body.kategori_lomba) === 'kelompok';
        const rowStatusColumn = type === 'pelanggaran' ? 'status' : await getApprovalStatusColumn();
        conn = await db.getConnection();
        await conn.beginTransaction();
        transactionStarted = true;

        const [selectedRows] = await conn.query(
            `SELECT * FROM ${config.table} WHERE id = ? FOR UPDATE`,
            [id]
        );
        if (selectedRows.length === 0) {
            await conn.rollback();
            transactionStarted = false;
            return res.status(404).json({ message: 'Pengajuan tidak ditemukan' });
        }
        const selected = selectedRows[0];
        if (Number(selected.submitted_by) !== Number(req.user.id)) {
            await conn.rollback();
            transactionStarted = false;
            return res.status(403).json({ message: 'Anda hanya dapat mengedit pengajuan yang Anda kirim' });
        }
        if (getRowApprovalStatus(selected) !== 'pending') {
            await conn.rollback();
            transactionStarted = false;
            return res.status(409).json({ message: 'Pengajuan sudah diproses dan tidak dapat diedit' });
        }

        let groupRows = [selected];
        if (type === 'prestasi' && selected.grup_lomba) {
            const [siblings] = await conn.query(
                `SELECT * FROM prestasi_approvals WHERE grup_lomba = ? ORDER BY id FOR UPDATE`,
                [selected.grup_lomba]
            );
            if (siblings.some((row) => Number(row.submitted_by) !== Number(req.user.id))) {
                await conn.rollback();
                transactionStarted = false;
                return res.status(403).json({ message: 'Tidak semua anggota kelompok dikirim oleh akun Anda' });
            }
            if (siblings.some((row) => getRowApprovalStatus(row) !== 'pending')) {
                await conn.rollback();
                transactionStarted = false;
                return res.status(409).json({ message: 'Kelompok sudah diproses dan tidak dapat diedit' });
            }
            groupRows = siblings;
        } else if (requestedGroupCategory) {
            const error = new Error('Kategori kelompok tidak memiliki data grup yang valid');
            error.statusCode = 400;
            throw error;
        }

        const requiredText = (key, label, maxLength) => {
            const value = String(req.body[key] ?? '').trim();
            if (!value) {
                const error = new Error(`${label} wajib diisi`);
                error.statusCode = 400;
                throw error;
            }
            if (value.length > maxLength) {
                const error = new Error(`${label} maksimal ${maxLength} karakter`);
                error.statusCode = 400;
                throw error;
            }
            return value;
        };
        const requiredChoice = (key, label, choices, maxLength = 50) => {
            const value = requiredText(key, label, maxLength);
            if (!choices.includes(value)) {
                const error = new Error(`${label} tidak valid`);
                error.statusCode = 400;
                throw error;
            }
            return value;
        };

        let updateColumns = [];
        let updateValues = [];
        let resolvedPrestasi = null;
        let members = [];
        if (type === 'prestasi') {
            const kategoriLomba = selected.grup_lomba ? 'kelompok' : String(req.body.kategori_lomba || 'individu');
            if (!['individu', 'kelompok'].includes(kategoriLomba) || (!!selected.grup_lomba !== (kategoriLomba === 'kelompok'))) {
                const error = new Error('Kategori kelompok tidak dapat diubah pada pengajuan yang sudah dikirim');
                error.statusCode = 400;
                throw error;
            }
            const juara = requiredChoice('juara', 'Juara', pendingEditOptions.prestasi.juara);
            const kategori = requiredChoice('kategori', 'Tingkat lomba', pendingEditOptions.prestasi.kategori);
            const jenisLomba = requiredChoice('jenis_lomba', 'Jenis lomba', pendingEditOptions.prestasi.jenis_lomba);
            const namaLomba = requiredText('nama_lomba', 'Nama lomba', 255);
            let tanggalPelaksanaan;
            try {
                tanggalPelaksanaan = normalizeTanggalPelaksanaan(req.body.tanggal_pelaksanaan);
            } catch (error) {
                error.statusCode = error.statusCode || 400;
                throw error;
            }
            const { pembinaId, pembinaName, mentorIds } =
                await resolveRequiredPembina(req.body.pembina_id, req.body.pembina, req.body.pembina_ids);
            resolvedPrestasi = { juara, kategori, jenisLomba, namaLomba, tanggalPelaksanaan, pembinaId, pembinaName, mentorIds, kategoriLomba };
            updateColumns = ['nama_lomba', 'juara', 'kategori', 'jenis_lomba', 'kategori_lomba', 'tanggal_pelaksanaan', 'pembina', 'pembina_id'];
            updateValues = [namaLomba, juara, kategori, jenisLomba, kategoriLomba, tanggalPelaksanaan, pembinaName, pembinaId];
            if (selected.grup_lomba) {
                let requestedMembers;
                try {
                    requestedMembers = typeof req.body.anggota === 'string' ? JSON.parse(req.body.anggota) : req.body.anggota;
                } catch {
                    const error = new Error('Format data anggota tidak valid');
                    error.statusCode = 400;
                    throw error;
                }
                if (!Array.isArray(requestedMembers) || requestedMembers.length < 2) {
                    const error = new Error('Lomba kelompok membutuhkan minimal 2 anggota');
                    error.statusCode = 400;
                    throw error;
                }
                const nises = requestedMembers.map((member) => String(member?.nis ?? '').trim());
                if (nises.some((nis) => !nis) || new Set(nises).size !== nises.length) {
                    const error = new Error('NIS anggota harus diisi dan tidak boleh duplikat');
                    error.statusCode = 400;
                    throw error;
                }
                const [studentRows] = await conn.query(
                    `SELECT id, nama, nis, kelas, grha FROM users WHERE role = 'siswa' AND nis IN (?)`,
                    [nises]
                );
                const studentByNis = new Map(studentRows.map((student) => [String(student.nis), student]));
                if (studentByNis.size !== nises.length) {
                    const error = new Error('Satu atau lebih NIS anggota tidak ditemukan sebagai siswa');
                    error.statusCode = 400;
                    throw error;
                }
                members = nises.map((nis) => studentByNis.get(nis));
            }
        } else if (type === 'event') {
            updateColumns = ['nama_event', 'tingkat'];
            updateValues = [
                requiredText('nama_event', 'Nama event', 255),
                requiredChoice('tingkat', 'Tingkat event', pendingEditOptions.event.tingkat)
            ];
        } else if (type === 'organisasi') {
            updateColumns = ['kategori_organisasi', 'jabatan_organisasi'];
            updateValues = [
                requiredText('kategori_organisasi', 'Organisasi', 255),
                requiredChoice('jabatan_organisasi', 'Jabatan', pendingEditOptions.organisasi.jabatan_organisasi, 100)
            ];
        } else if (type === 'kepanitiaan') {
            updateColumns = ['kategori_kepanitiaan', 'jabatan_kepanitiaan'];
            updateValues = [
                requiredText('kategori_kepanitiaan', 'Nama kepanitiaan', 255),
                requiredChoice('jabatan_kepanitiaan', 'Jabatan', pendingEditOptions.kepanitiaan.jabatan_kepanitiaan, 100)
            ];
        } else {
            const jenisPelanggaran = requiredText('jenis_pelanggaran', 'Jenis pelanggaran', 100);
            const keterangan = requiredText('keterangan', 'Detail pelanggaran', 5000);
            const pointDikurangi = await calculatePelanggaranPoints(jenisPelanggaran);
            if (!pointDikurangi) {
                const error = new Error('Detail pelanggaran belum memiliki konfigurasi tingkat atau point aktif');
                error.statusCode = 400;
                throw error;
            }
            updateColumns = ['jenis_pelanggaran', 'keterangan', 'point_dikurangi'];
            updateValues = [jenisPelanggaran, keterangan, pointDikurangi];
        }

        const uploaded = uploadedPaths(req, config.evidenceType);
        const removeEvidenceIds = parseEvidenceIdList(req.body.remove_evidence_ids);
        const evidenceChanged = uploaded.length > 0 || removeEvidenceIds.length > 0;
        const evidenceAnchor = groupRows[0];
        let finalEvidencePaths = null;
        if (evidenceChanged) {
            await validateEvidenceSelection(config.table, evidenceAnchor.id, removeEvidenceIds, uploaded.length, conn.query);
            const currentEvidence = await listEvidence(config.table, evidenceAnchor.id, conn.query);
            const removeSet = new Set(removeEvidenceIds);
            finalEvidencePaths = [
                ...currentEvidence.filter((item) => !item.id || !removeSet.has(Number(item.id))).map((item) => item.path),
                ...uploaded
            ];
            for (const row of groupRows) {
                const rowEvidence = await listEvidence(config.table, row.id, conn.query);
                removedEvidencePaths.push(...rowEvidence.map((item) => item.path));
            }
        }

        const existingByUserId = new Map(groupRows.map((row) => [Number(row.user_id), row]));
        const desiredUserIds = new Set(members.map((student) => Number(student.id)));
        const rowsToDelete = selected.grup_lomba
            ? groupRows.filter((row) => !desiredUserIds.has(Number(row.user_id)))
            : [];

        for (const row of groupRows.filter((groupRow) => !rowsToDelete.includes(groupRow))) {
            const assignments = updateColumns.map((column) => `${column} = ?`);
            const values = [...updateValues];
            if (selected.grup_lomba) {
                const member = members.find((student) => Number(student.id) === Number(row.user_id));
                if (member) {
                    assignments.push('nama = ?', 'nis = ?', 'kelas = ?', 'grha = ?');
                    values.push(member.nama, member.nis, member.kelas || '', member.grha || '');
                }
            }
            values.push(row.id, req.user.id, 'pending');
            const [updated] = await conn.query(
                `UPDATE ${config.table} SET ${assignments.join(', ')} WHERE id = ? AND submitted_by = ? AND ${rowStatusColumn} = ?`,
                values
            );
            updatedRows.push(row.id);
            if (type === 'prestasi') {
                await setPembinaLinks(conn.query, 'prestasi_approval_pembina', 'approval_id', row.id, resolvedPrestasi.mentorIds);
            }
            if (evidenceChanged) {
                await replaceEvidence(config.table, row.id, finalEvidencePaths, conn.query);
            }
        }

        if (selected.grup_lomba) {
            for (const member of members.filter((student) => !existingByUserId.has(Number(student.id)))) {
                const [inserted] = await conn.query(
                    `INSERT INTO prestasi_approvals
                    (user_id, submitted_by, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [member.id, req.user.id, member.nama, member.nis, resolvedPrestasi.namaLomba, member.kelas || '', resolvedPrestasi.pembinaName, resolvedPrestasi.pembinaId, member.grha || '', resolvedPrestasi.juara, resolvedPrestasi.kategori, resolvedPrestasi.jenisLomba, 'kelompok', selected.grup_lomba, resolvedPrestasi.tanggalPelaksanaan]
                );
                await setPembinaLinks(conn.query, 'prestasi_approval_pembina', 'approval_id', inserted.insertId, resolvedPrestasi.mentorIds);
                if (evidenceChanged) {
                    await replaceEvidence(config.table, inserted.insertId, finalEvidencePaths, conn.query);
                } else {
                    await copyEvidence(config.table, evidenceAnchor.id, config.table, inserted.insertId, new Map(), conn.query);
                }
                updatedRows.push(inserted.insertId);
            }
            for (const row of rowsToDelete) {
                const rowEvidence = await deleteEvidenceForRecord(config.table, row.id, conn.query);
                removedEvidencePaths.push(...rowEvidence);
                await conn.query('DELETE FROM prestasi_approval_pembina WHERE approval_id = ?', [row.id]);
                await conn.query(
                    `DELETE FROM prestasi_approvals WHERE id = ? AND submitted_by = ? AND ${rowStatusColumn} = ?`,
                    [row.id, req.user.id, 'pending']
                );
            }
        }

        await conn.commit();
        transactionStarted = false;
        conn.release();
        conn = null;

        if (removedEvidencePaths.length > 0) {
            try {
                await deleteEvidenceFilesIfOrphan(removedEvidencePaths, { folderHint: config.evidenceType });
            } catch (cleanupError) {
                console.error('Failed to clean up pending submission evidence', cleanupError);
            }
        }
        try {
            await logActivity(req.user.id, 'EDIT_PENDING_SUBMISSION', `${req.user.nama} updated pending ${type} submission ${id}`, req.ip);
        } catch (logError) {
            console.error('Failed to log pending submission edit', logError);
        }
        return res.json({
            message: 'Pengajuan berhasil diperbarui',
            ids: [...new Set(updatedRows)]
        });
    } catch (error) {
        if (transactionStarted && conn) {
            try { await conn.rollback(); } catch (rollbackError) { console.error('Failed to roll back pending edit', rollbackError); }
        }
        console.error('Pending submission edit failed:', error);
        return res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
    } finally {
        if (conn) conn.release();
    }
});

// REMOVED: Pembina approval route - now only superadmin approval

// SuperAdmin Approve/Reject (single-step approval)
// Non-superadmin callers must hold the approval scope for that exact type.
router.put('/superadmin/:type/:id', auth, approverFor('type'), async (req, res) => {
    let conn = null;
    try {
        const { type, id } = req.params;
        const { status, notes } = req.body;

        console.log(`SuperAdmin ${status} request: type=${type}, id=${id}`);

        // Perilaku no longer goes through approval submissions apply directly.
        if (type === 'perilaku') {
            return res.status(400).json({ message: 'Perilaku tidak lagi memerlukan persetujuan langsung tersimpan saat diinput' });
        }

        if (type === 'pelanggaran') {
            return handleLegacyApproval(type, id, status, notes, req.user.id, req.user.role, req.ip, res);
        }

        let table, pointField, allowedColumns;
        switch(type) {
            case 'prestasi':
                table = 'prestasi_approvals';
                pointField = 'juara';
                allowedColumns = ['id', 'user_id', 'submitted_by', 'nama', 'nis', 'nama_lomba', 'foto', 'kelas', 'pembina', 'pembina_id', 'grha', 'juara', 'kategori', 'jenis_lomba', 'kategori_lomba', 'grup_lomba', 'tanggal_pelaksanaan', 'superadmin_status', 'created_at'];
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
        // own row, IPT entry, and notification full points per member).
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

        // Load the complete evidence set once per row. Group members normally
        // share the same files, so move each physical file only once.
        const evidenceByRow = new Map();
        const allEvidencePaths = [];
        for (const row of targetRows) {
            const items = await listEvidence(table, row.id, db.query);
            const paths = items.map((item) => item.path);
            evidenceByRow.set(row.id, paths);
            allEvidencePaths.push(...paths);
        }
        const movedEvidence = status === 'approved'
            ? moveEvidenceToApproved(allEvidencePaths, type)
            : new Map();

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

            // Move every file to the approved folder once. Group rows share
            // the same physical files, so the path map is reused below.
            const rowEvidence = evidenceByRow.get(row.id) || (data.foto ? [data.foto] : []);
            const finalEvidencePaths = rowEvidence.map((p) => movedEvidence.get(p) || p);
            const finalFotoPath = finalEvidencePaths[0] || null;

            // Insert to actual table
            let insertQuery, insertParams;
            if (type === 'prestasi') {
                insertQuery = `INSERT INTO prestasi (user_id, nama, nis, nama_lomba, kelas, pembina, pembina_id, grha, juara, kategori, jenis_lomba, kategori_lomba, grup_lomba, tanggal_pelaksanaan, foto, point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`;
                insertParams = [data.user_id, data.nama || 'Unknown', data.nis || '', data.nama_lomba || '', data.kelas || '', data.pembina || '', data.pembina_id || null, data.grha || '', data.juara || '', data.kategori || '', data.jenis_lomba || 'akademik', data.kategori_lomba || 'individu', data.grup_lomba || null, data.tanggal_pelaksanaan || null, finalFotoPath || null, pointChange];
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
            await replaceEvidence(type, mainRow.insertId, finalEvidencePaths, conn.query);

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
            // (the files were just moved to the approved folder above).
            await replaceEvidence(table, row.id, finalEvidencePaths, conn.query);

            await applyIptChange(
                data.user_id,
                type,
                pointChange,
                buildKeterangan(type, data),
                conn.query,
                { type, id: mainRow.insertId }
            );

            // Conditional staging flip: 0 rows means a concurrent decision
            // already processed this row abort the whole decision.
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

            // Delete the evidence files when no other row references them
            // anymore (kelompok siblings share files, never strand them).
            // Deferred until after commit: the check must read committed state.
            const rowEvidence = evidenceByRow.get(row.id) || (data.foto ? [data.foto] : []);
            await deleteEvidenceForRecord(table, row.id, conn.query);
            if (rowEvidence.length > 0) {
                deferredOrphans.push({ paths: rowEvidence, table, id: row.id, folderHint: type });
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
            await deleteEvidenceFilesIfOrphan(o.paths, {
                exclude: { table: o.table, id: o.id },
                folderHint: o.folderHint
            });
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
            'prestasi': ['id', 'user_id', 'nama', 'nis', 'jenis', 'nama_lomba', 'foto', 'kelas', 'pembina', 'grha', 'juara', 'kategori', 'tanggal_pelaksanaan', 'point', 'status', 'rejection_reason', 'created_at'],
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
                        // jadi langsung dijumlahkan tanpa tanda minus.
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

        const evidencePaths = await listEvidence(table, id, db.query);
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

            await deleteEvidenceForRecord(table, id, conn.query);

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
        await deleteEvidenceFilesIfOrphan(evidencePaths, {
            exclude: { table, id },
            folderHint: type
        });
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

        await Promise.all([
            attachPembinaLists(prestasi, 'prestasi_approval_pembina', 'approval_id'),
            attachEvidence(prestasi, 'prestasi_approvals'),
            attachEvidence(event, 'event_approvals'),
            attachEvidence(organisasi, 'organisasi_approvals'),
            attachEvidence(kepanitiaan, 'kepanitiaan_approvals'),
            attachEvidence(pelanggaran, 'pelanggaran')
        ]);

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

        await Promise.all([
            attachEvidence(prestasi, 'prestasi_approvals'),
            attachEvidence(event, 'event_approvals'),
            attachEvidence(organisasi, 'organisasi_approvals'),
            attachEvidence(kepanitiaan, 'kepanitiaan_approvals'),
            attachEvidence(pelanggaran, 'pelanggaran')
        ]);

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
                    WHEN n.related_type = 'kepanitiaan' THEN (SELECT kategori_kepanitiaan FROM kepanitiaan_approvals WHERE id = n.related_id)
                    WHEN n.related_type = 'password_reset' THEN (SELECT u.nama FROM password_reset_requests r JOIN users u ON u.id = r.user_id WHERE r.id = n.related_id)
                    WHEN n.related_type = 'wali_kelas' THEN (SELECT kelas FROM wali_kelas_assignment WHERE id = n.related_id)
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
