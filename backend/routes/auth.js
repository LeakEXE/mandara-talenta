const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { loginLimiter } = require('../middleware/security');
const { logActivity } = require('../utils/logger');

// Helper: true when the request actually arrived over HTTPS (direct or via proxy)
const isRequestSecure = (req) => {
    if (!req) return false;
    if (req.secure) return true;
    return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
};

// Helper function to set secure HTTP-only cookie.
// `secure` follows the real connection: a Secure cookie set over plain HTTP
// is rejected by browsers, which would break login entirely on HTTP deployments.
// Once HTTPS terminates in front of the app, Secure flips back on automatically.
const setAuthCookie = (res, token, req) => {
    res.cookie('token', token, {
        httpOnly: true,
        secure: isRequestSecure(req),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/'
    });
};

// Login (per-route limiter; don't share the budget with other /api/auth routes)
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        const [users] = await db.query(
            'SELECT id, nama, nis, nip, username, password, role, kelas, grha, wali_kelas, ipt_total, ipt_awal, alamat, no_hp, detail, foto, tahun_pelajaran, is_graduated, jurusan, must_change_credentials FROM users WHERE LOWER(username) = LOWER(?)',
            [username]
        );

        if (users.length === 0) {
            return res.status(400).json({ message: 'Username tidak ditemukan. Gunakan username Anda (bukan NIS/NIP).' });
        }

const user = users[0];

        if (user.nis === 'ADMIN001' && user.password === '$2a$10$YourHashedPasswordHere') {
            const setupPassword = process.env.SUPERADMIN_SETUP_PASSWORD;
            if (!setupPassword) {
                return res.status(503).json({ message: 'Superadmin belum di-initialize. Set SUPERADMIN_SETUP_PASSWORD di file .env.' });
            }
            if (password === setupPassword) {
                const hashedPassword = bcrypt.hashSync(password, 10);
                await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
                user.password = hashedPassword;
            } else {
                return res.status(400).json({ message: 'Invalid setup password' });
            }
        } else {
            const isMatch = bcrypt.compareSync(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ message: 'Invalid password' });
            }
        }

        const token = jwt.sign(
            { id: user.id, nama: user.nama, role: user.role, nis: user.nis, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Set token in HTTP-only cookie
        setAuthCookie(res, token, req);

        // Log activity (try-catch to prevent login failure if logs table doesn't exist)
        try {
            await db.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [user.id, 'LOGIN', 'User logged in']
            );
        } catch (logError) {
            console.log('Activity log failed (table might not exist):', logError.message);
        }

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                nama: user.nama,
                nis: user.nis,
                nip: user.nip,
                username: user.username,
                role: user.role,
                kelas: user.kelas,
                grha: user.grha,
                wali_kelas: user.wali_kelas,
                ipt_total: user.ipt_total,
                foto: user.foto || null,
                must_change_credentials: !!user.must_change_credentials
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error: ' + error.message + '. Pastikan database sudah di-setup dengan benar.' });
    }
});

// Logout - clear the HTTP-only cookie (same Secure policy as login, so it actually clears)
router.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: isRequestSecure(req),
        sameSite: 'lax',
        path: '/'
    });
    res.json({ message: 'Logout successful' });
});

// Verify token endpoint (for frontend to check authentication status)
router.get('/verify', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ valid: true, user: decoded });
    } catch (error) {
        res.status(401).json({ valid: false, message: 'Invalid token' });
    }
});

// Public forgot-password request (no session required).
// Creates the same password_reset_requests row the old Profile button made,
// for superadmin approval. Always returns a generic message so callers can't
// enumerate which usernames exist. Per-account spam is stopped by pending-dedup
// + 12h cooldown below.
// per-account spam by pending-dedup + 12h cooldown below.
const FORGOT_GENERIC_MESSAGE = 'Jika username terdaftar, permintaan reset telah dikirim ke SuperAdmin. Hubungi admin sekolah untuk tindak lanjut.';
const FORGOT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

router.post('/forgot-password', async (req, res) => {
    try {
        const rawUsername = req.body?.username;
        if (typeof rawUsername !== 'string' || rawUsername.trim().length === 0) {
            return res.status(400).json({ message: 'Username wajib diisi' });
        }
        const username = rawUsername.trim();
        if (username.length > 50) {
            return res.status(400).json({ message: 'Username wajib diisi' });
        }

        const [users] = await db.query(
            'SELECT id, nama, role FROM users WHERE LOWER(username) = LOWER(?)',
            [username]
        );
        if (users.length === 0) {
            return res.json({ message: FORGOT_GENERIC_MESSAGE });
        }
        const target = users[0];
        if (target.role === 'superadmin') {
            return res.json({ message: FORGOT_GENERIC_MESSAGE });
        }

        // One live request at a time (same rule as the old Profile flow)
        const [pending] = await db.query(
            "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
            [target.id]
        );
        if (pending.length > 0) {
            return res.json({ message: FORGOT_GENERIC_MESSAGE });
        }

        // 12h cooldown since the previous request (approved/rejected/pending),
        // so a reject -> re-request loop can't spam superadmin notifications.
        const [last] = await db.query(
            `SELECT created_at FROM password_reset_requests
              WHERE user_id = ?
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [target.id]
        );
        if (last.length > 0) {
            const lastTime = new Date(last[0].created_at).getTime();
            if (!Number.isNaN(lastTime) && Date.now() - lastTime < FORGOT_COOLDOWN_MS) {
                return res.json({ message: FORGOT_GENERIC_MESSAGE });
            }
        }

        // Self-request: requested_by = user_id (column is NOT NULL).
        const [result] = await db.query(
            'INSERT INTO password_reset_requests (user_id, requested_by) VALUES (?, ?)',
            [target.id, target.id]
        );

        const [superadmins] = await db.query("SELECT id FROM users WHERE role = 'superadmin'");
        for (const admin of superadmins) {
            await db.query(
                `INSERT INTO notifications (user_id, type, title, message, related_id, related_type)
                 VALUES (?, 'approval_needed', 'Permintaan Reset Password', ?, ?, 'password_reset')`,
                [admin.id, `${target.nama} mengajukan permintaan reset password akunnya.`, result.insertId]
            );
        }

        await logActivity(target.id, 'PASSWORD_RESET_REQUEST', `${target.nama} mengajukan permintaan reset password (via lupa-password)`, req.ip);

        return res.json({ message: FORGOT_GENERIC_MESSAGE });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
