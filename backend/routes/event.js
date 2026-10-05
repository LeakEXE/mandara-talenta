const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { buildIptCardBreakdown } = require('../utils/iptCardBreakdown');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('event'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, fileFilter: evidenceFileFilter, limits: EVIDENCE_LIMITS });
const { calculateEventPoints } = require('../constants/points');
const { buildKeterangan } = require('../utils/ipt');

// Get all event (for approvals)
router.get('/all', auth, async (req, res) => {
    try {
        const [events] = await db.query(`
            SELECT e.*, u.nama as user_name 
            FROM event e 
            JOIN users u ON e.user_id = u.id 
            ORDER BY e.created_at DESC
        `);
        res.json(events);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user's event
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const [events] = await db.query(
            'SELECT id, user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status, rejection_reason, created_at FROM event WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
            [req.params.userId, 'approved']
        );
        res.json(events);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create event
router.post('/', auth, upload.single('foto'), async (req, res) => {
    try {
        const { nama, nis, kelas, grha, nama_event, tingkat } = req.body;
        let foto = req.file ? req.file.filename : null;

        // Rename file to NIS_Nama Event format
        if (req.file && foto) {
            const oldPath = resolveUploadPath(path.join('uploads/event', foto));
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${nama_event}${ext}`;
            const newPath = resolveUploadPath(path.join('uploads/event', newFileName));

            // Rename the file
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        const point = await calculateEventPoints(tingkat);

        const [result] = await db.query(
            'INSERT INTO event (user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, nama, nis, kelas, grha, nama_event, tingkat, foto, point]
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'SUBMIT_EVENT', `Submitted event: ${nama_event}`]
        );

        res.status(201).json({ message: 'Event submitted for approval', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve event (superadmin only)
router.put('/:id/approve', auth, superAdminOnly, async (req, res) => {
    try {
        const eventId = req.params.id;
        
        const [event] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status, rejection_reason, created_at FROM event WHERE id = ?', [eventId]);
        if (event.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const eventData = event[0];
        let newFotoPath = eventData.foto;
        
        // Move photo to approved folder if it exists
        if (eventData.foto) {
            const movedPath = movePhotoToApprovedFolder(path.join('uploads/event', eventData.foto), 'event');
            if (movedPath) {
                newFotoPath = path.join('uploads', movedPath).replace(/\\/g, '/');
            }
        }
        
        // Update status and photo path
        await db.query('UPDATE event SET status = ?, foto = ? WHERE id = ?', ['approved', newFotoPath, eventId]);
        
        // Update user IPT (can go negative due to pelanggaran, can recover with event)
        const [user] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [eventData.user_id]);
        const iptSebelum = user[0].ipt_total;
        const iptSesudah = iptSebelum + eventData.point;
        
        await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, eventData.user_id]);
        
        await db.query(
            'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
            [eventData.user_id, 'event', eventData.point, iptSebelum, iptSesudah, buildKeterangan('event', eventData)]
        );

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_EVENT', `Approved event ID ${eventId}`]
        );

        res.json({ message: 'Event approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject event (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    try {
        const { rejection_reason } = req.body;
        const eventId = req.params.id;
        
        const [rows] = await db.query('SELECT foto FROM event WHERE id = ?', [eventId]);

        await db.query('UPDATE event SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, eventId]);

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'event', id: eventId }, folderHint: 'event' });
        }

        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_EVENT', `Rejected event ID ${eventId}`]
        );

        res.json({ message: 'Event rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update event
router.put('/:id', auth, upload.single('foto'), async (req, res) => {
    try {
        const eventId = req.params.id;
        const { nama, nis, kelas, grha, nama_event, tingkat } = req.body;
        
        const [event] = await db.query('SELECT id, user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status, rejection_reason, created_at FROM event WHERE id = ?', [eventId]);
        if (event.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const eventData = event[0];
        let foto = eventData.foto;

        // Handle new photo upload
        if (req.file) {
            // Delete old photo if exists
            if (foto) {
                const oldPath = resolveUploadPath(path.join('uploads/event', foto));
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            
            // Rename new file
            const ext = path.extname(req.file.originalname);
            const newFileName = `${nis}_${nama_event}${ext}`;
            const oldPath = resolveUploadPath(path.join('uploads/event', req.file.filename));
            const newPath = resolveUploadPath(path.join('uploads/event', newFileName));
            fs.renameSync(oldPath, newPath);
            foto = newFileName;
        }

        // Recalculate points if tingkat changed
        const point = await calculateEventPoints(tingkat);

        await db.query(
            'UPDATE event SET nama = ?, nis = ?, kelas = ?, grha = ?, nama_event = ?, tingkat = ?, foto = ?, point = ? WHERE id = ?',
            [nama, nis, kelas, grha, nama_event, tingkat, foto, point, eventId]
        );

        // If status is approved and point changed, update user IPT
        if (eventData.status === 'approved' && eventData.point !== point) {
            const pointDiff = point - eventData.point;
            const [userBefore] = await db.query('SELECT ipt_total FROM users WHERE id = ?', [eventData.user_id]);
            const iptSebelum = userBefore[0].ipt_total;
            const iptSesudah = iptSebelum + pointDiff;
            
            await db.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, eventData.user_id]);
            
            await db.query(
                'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                [eventData.user_id, 'event_update', pointDiff, iptSebelum, iptSesudah, `Update Event: ${nama_event}`]
            );
        }

        // Log activity
        await db.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'UPDATE_EVENT', `Updated event ID ${eventId}`]
        );

        res.json({ message: 'Event updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete event (superadmin only)
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const eventId = req.params.id;

        const [event] = await conn.query('SELECT id, user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status, rejection_reason, created_at FROM event WHERE id = ?', [eventId]);
        if (event.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Event not found' });
        }

        const eventData = event[0];

        // If approved, delete the row first, then recompute the student's
        // total from the remaining approved records (same formula as
        // syncIpt.js) — this also heals any pre-existing drift.
        if (eventData.status === 'approved') {
            const [user] = await conn.query('SELECT ipt_total FROM users WHERE id = ? FOR UPDATE', [eventData.user_id]);
            await conn.query('DELETE FROM event WHERE id = ?', [eventId]);
            if (user.length > 0) {
                const iptSebelum = user[0].ipt_total;
                const card = await buildIptCardBreakdown(eventData.user_id, null, conn.query);
                const iptSesudah = card ? card.breakdown_total : iptSebelum;
                if (iptSesudah !== iptSebelum) {
                    await conn.query('UPDATE users SET ipt_total = ? WHERE id = ?', [iptSesudah, eventData.user_id]);

                    // Log IPT history
                    await conn.query(
                        'INSERT INTO ipt_history (user_id, jenis_perubahan, point_change, ipt_sebelum, ipt_sesudah, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
                        [eventData.user_id, 'event_delete', iptSesudah - iptSebelum, iptSebelum, iptSesudah, `Delete Event: ${eventData.nama_event}`]
                    );
                }
            }
        } else {
            // Pending/rejected records never touched IPT — just remove the row.
            await conn.query('DELETE FROM event WHERE id = ?', [eventId]);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_EVENT', `Deleted event ID ${eventId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file — never strand them).
        if (eventData.foto) {
            await deletePhotoIfOrphan(db, eventData.foto, { folderHint: 'event' });
        }

        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

module.exports = router;
