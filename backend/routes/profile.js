const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../config/database');
const { getStudentRecords } = require('../utils/studentRecords');
const { logActivity } = require('../utils/logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { validateUsernameFormat, isUsernameAvailable } = require('../utils/username');

// Configure multer for avatar uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('avatars'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
        }
    }
});

// Get user profile
router.get('/', auth, async (req, res) => {
    try {
        const [user] = await db.query(
            'SELECT id, nama, nis, nip, username, role, kelas, grha, wali_kelas, ipt_total, ipt_awal, alamat, no_hp, detail, detail AS jabatan, foto, created_at, tahun_pelajaran, is_graduated, jurusan, must_change_credentials FROM users WHERE id = ?',
            [req.user.id]
        );

        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userData = user[0];
        
        // If user is a student, fetch wali kelas information
        if (userData.role === 'siswa' && userData.kelas) {
            const [waliData] = await db.query(`
                SELECT u.nama as wali_kelas_nama, u.nip as wali_kelas_nip
                FROM wali_kelas_assignment wka
                JOIN users u ON wka.guru_id = u.id
                WHERE wka.kelas = ? AND SPLIT_PART(wka.tahun_ajaran, '-', 1)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
                ORDER BY wka.id DESC
                LIMIT 1
            `, [userData.kelas]);
            
            if (waliData.length > 0) {
                userData.wali_kelas_nama = waliData[0].wali_kelas_nama;
                userData.wali_kelas_nip = waliData[0].wali_kelas_nip;
            }
        }

        // If user is a teacher (guru/pegawai), check if they are assigned as wali kelas
        if (userData.role === 'guru' || userData.role === 'pegawai') {
            const { getCurrentAcademicYear } = require('../utils/academicYear');
            const currentYear = getCurrentAcademicYear();
            
            console.log('Profile - Checking wali kelas for guru:', req.user.id, 'Current year:', currentYear);
            
            // Check for wali kelas assignment in current academic year
            const [waliAssignment] = await db.query(`
                SELECT kelas, tahun_ajaran
                FROM wali_kelas_assignment
                WHERE guru_id = ? AND tahun_ajaran = ?
                LIMIT 1
            `, [req.user.id, currentYear]);
            
            console.log('Profile - Wali assignment result:', waliAssignment);
            
            if (waliAssignment.length > 0) {
                userData.wali_kelas = waliAssignment[0].kelas;
                console.log('Profile - Set wali_kelas from current year:', userData.wali_kelas);
            } else {
                // If no assignment in current year, check if there's any assignment at all
                // This handles cases where assignment was made for a different year
                const [anyAssignment] = await db.query(`
                    SELECT kelas, tahun_ajaran
                    FROM wali_kelas_assignment
                    WHERE guru_id = ?
                    ORDER BY tahun_ajaran DESC
                    LIMIT 1
                `, [req.user.id]);
                
                console.log('Profile - Any assignment result:', anyAssignment);
                
                if (anyAssignment.length > 0) {
                    userData.wali_kelas = anyAssignment[0].kelas;
                    console.log('Profile - Set wali_kelas from any assignment:', userData.wali_kelas);
                } else {
                    userData.wali_kelas = null;
                    console.log('Profile - No wali kelas assignment found');
                }
            }
        }

        res.json(userData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Upload avatar
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const avatarPath = '/uploads/avatars/' + req.file.filename;

        // Delete old avatar if exists
        const [user] = await db.query('SELECT foto FROM users WHERE id = ?', [req.user.id]);
        if (user.length > 0 && user[0].foto) {
            const oldAvatarPath = resolveUploadPath(user[0].foto);
            if (fs.existsSync(oldAvatarPath)) {
                fs.unlinkSync(oldAvatarPath);
            }
        }

        // Update user avatar in database
        await db.query(
            'UPDATE users SET foto = ? WHERE id = ?',
            [avatarPath, req.user.id]
        );

        res.json({ message: 'Avatar uploaded successfully', avatarPath });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete avatar
router.delete('/avatar', auth, async (req, res) => {
    try {
        const [user] = await db.query('SELECT foto FROM users WHERE id = ?', [req.user.id]);
        
        if (user.length > 0 && user[0].foto) {
            const oldAvatarPath = resolveUploadPath(user[0].foto);
            if (fs.existsSync(oldAvatarPath)) {
                fs.unlinkSync(oldAvatarPath);
            }
        }

        await db.query(
            'UPDATE users SET foto = NULL WHERE id = ?',
            [req.user.id]
        );

        res.json({ message: 'Avatar deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user IPT history
router.get('/ipt-history', auth, async (req, res) => {
    try {
        const [history] = await db.query(
            'SELECT * FROM ipt_history WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's approved data summary
router.get('/summary', auth, async (req, res) => {
    try {
        const records = await getStudentRecords(req.user.id);
        res.json(records);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Check username availability (used live by the setup screen)
router.get('/check-username', auth, async (req, res) => {
    try {
        const { username } = req.query;
        const formatError = validateUsernameFormat(username);
        if (formatError) {
            return res.json({ available: false, message: formatError });
        }
        const available = await isUsernameAvailable(username, req.user.id);
        res.json({ available, message: available ? 'Username tersedia' : 'Username sudah dipakai' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Change own username (requires current password)
router.put('/username', auth, async (req, res) => {
    try {
        const { username, currentPassword } = req.body;
        const formatError = validateUsernameFormat(username);
        if (formatError) {
            return res.status(400).json({ message: formatError });
        }
        if (!currentPassword) {
            return res.status(400).json({ message: 'Password saat ini diperlukan' });
        }
        const [user] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isMatch = await bcrypt.compare(currentPassword, user[0].password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Password saat ini salah' });
        }
        if (!(await isUsernameAvailable(username, req.user.id))) {
            return res.status(400).json({ message: 'Username sudah dipakai' });
        }
        await db.query('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id]);
        await logActivity(req.user.id, 'CHANGE_USERNAME', `User changed username to ${username}`, req.ip);
        res.json({ message: 'Username berhasil diubah', username });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Change password
router.post('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters' });
        }

        // Get user with current password
        const [user] = await db.query('SELECT password, nama, role FROM users WHERE id = ?', [req.user.id]);

        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user[0].password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear the first-login flag (username may
        // have been changed already on the setup screen - that is optional)
        await db.query('UPDATE users SET password = ?, must_change_credentials = FALSE WHERE id = ?', [hashedPassword, req.user.id]);

        // Log activity
        await logActivity(req.user.id, 'CHANGE_PASSWORD', `User ${user[0].nama} (${user[0].role}) changed password`, req.ip);

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
