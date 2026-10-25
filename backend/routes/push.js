const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { auth } = require('../middleware/auth');
const db = require('../config/database');
const { getPublicKey, validateSubscription } = require('../services/webPush');
const subscriptionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { message: 'Terlalu banyak permintaan pengaturan notifikasi perangkat' }
});

router.get('/config', auth, (req, res) => {
    const publicKey = getPublicKey();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enabled: Boolean(publicKey), publicKey });
});

router.post('/subscriptions/status', auth, subscriptionLimiter, async (req, res) => {
    const subscription = req.body?.subscription;
    const validationError = validateSubscription(subscription);
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }
    try {
        const [rows] = await db.query(
            'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
            [req.user.id, subscription.endpoint]
        );
        res.json({ registered: rows.length > 0 });
    } catch (error) {
        console.error('Failed to check push subscription status:', error);
        res.status(500).json({ message: 'Gagal memeriksa status notifikasi perangkat' });
    }
});

router.post('/subscriptions', auth, subscriptionLimiter, async (req, res) => {
    const publicKey = getPublicKey();
    if (!publicKey) {
        return res.status(503).json({ message: 'Notifikasi browser sedang tidak tersedia' });
    }
    const subscription = req.body?.subscription;
    const validationError = validateSubscription(subscription);
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }
    try {
        const [result] = await db.query(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (endpoint) DO UPDATE
             SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()
             WHERE push_subscriptions.user_id = EXCLUDED.user_id
             RETURNING id`,
            [req.user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
        );
        if (!result.insertId) {
            return res.status(409).json({ message: 'Perangkat ini sudah terhubung ke akun lain' });
        }
        res.status(201).json({ message: 'Notifikasi perangkat berhasil diaktifkan' });
    } catch (error) {
        console.error('Failed to register push subscription:', error);
        res.status(500).json({ message: 'Gagal mengaktifkan notifikasi perangkat' });
    }
});

router.delete('/subscriptions', auth, subscriptionLimiter, async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 4096) {
        return res.status(400).json({ message: 'Push endpoint tidak valid' });
    }
    try {
        const [result] = await db.query(
            'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
            [req.user.id, endpoint]
        );
        res.json({ removed: result.affectedRows > 0 });
    } catch (error) {
        console.error('Failed to remove push subscription:', error);
        res.status(500).json({ message: 'Gagal menonaktifkan notifikasi perangkat' });
    }
});

module.exports = router;
