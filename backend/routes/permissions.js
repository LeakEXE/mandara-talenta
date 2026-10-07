const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');

// Get all permissions
router.get('/', auth, superAdminOnly, async (req, res) => {
    try {
        const [permissions] = await db.query(`
            SELECT p.*, u.nama, u.nis, u.nip, u.role 
            FROM permissions p 
            JOIN users u ON p.user_id = u.id
        `);
        res.json(permissions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user permissions
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [permissions] = await db.query(
            'SELECT id, user_id, can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku FROM permissions WHERE user_id = ?',
            [req.params.userId]
        );
        
        if (permissions.length === 0) {
            return res.json({
                can_input_prestasi: false,
                can_input_organisasi: false,
                can_input_kepanitiaan: false,
                can_input_event: false,
                can_input_pelanggaran: false,
                can_input_perilaku: false,
                can_view_all_data: false
            });
        }
        
        res.json(permissions[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get current user's permissions
router.get('/my-permissions', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const [permissions] = await db.query(
            'SELECT id, user_id, can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku FROM permissions WHERE user_id = ?',
            [userId]
        );
        const [scopeRows] = await db.query(
            'SELECT jenis FROM approval_scopes WHERE user_id = ? ORDER BY jenis',
            [userId]
        );
        const approval_scopes = scopeRows.map((r) => r.jenis);
        
        if (permissions.length === 0) {
            return res.json({
                can_input_prestasi: false,
                can_input_organisasi: false,
                can_input_kepanitiaan: false,
                can_input_event: false,
                can_input_pelanggaran: false,
                can_input_perilaku: false,
                can_view_all_data: false,
                approval_scopes
            });
        }
        
        res.json({ ...permissions[0], approval_scopes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update user permissions
router.put('/user/:userId', auth, superAdminOnly, async (req, res) => {
    try {
        const userId = req.params.userId;
        const { can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku, can_view_all_data } = req.body;

        // Check if permissions exist for this user
        const [existing] = await db.query('SELECT id FROM permissions WHERE user_id = ?', [userId]);
        
        if (existing.length === 0) {
            // Create new permissions record
            await db.query(
                'INSERT INTO permissions (user_id, can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku, can_view_all_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku, can_view_all_data]
            );
        } else {
            // Update existing permissions
            await db.query(
                'UPDATE permissions SET can_input_prestasi = ?, can_input_organisasi = ?, can_input_kepanitiaan = ?, can_input_event = ?, can_input_pelanggaran = ?, can_input_perilaku = ?, can_view_all_data = ? WHERE user_id = ?',
                [can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event, can_input_pelanggaran, can_input_perilaku, can_view_all_data, userId]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_PERMISSIONS', `Updated permissions for user ID ${userId}`]
        );

        res.json({ message: 'Permissions updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Set permissions for all students (bulk)
router.post('/bulk-students', auth, superAdminOnly, async (req, res) => {
    try {
        const { can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event } = req.body;

        // This endpoint only targets students (u.role = 'siswa'), and pelanggaran/perilaku
        // are guru-only input types always force them off regardless of the request body.
        await db.query(
            `UPDATE permissions p 
             JOIN users u ON p.user_id = u.id 
             SET p.can_input_prestasi = ?, 
                 p.can_input_organisasi = ?, 
                 p.can_input_kepanitiaan = ?,
                 p.can_input_event = ?,
                 p.can_input_pelanggaran = false,
                 p.can_input_perilaku = false 
             WHERE u.role = 'siswa'`,
            [can_input_prestasi, can_input_organisasi, can_input_kepanitiaan, can_input_event]
        );

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'BULK_UPDATE_PERMISSIONS', 'Updated permissions for all students']
        );

        res.json({ message: 'Bulk permissions updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
