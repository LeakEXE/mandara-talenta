const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const { evidenceFileFilter, EVIDENCE_LIMITS } = require('../utils/evidenceUpload');
const path = require('path');
const fs = require('fs');
const { movePhotoToApprovedFolder, deletePhotoIfOrphan, replaceEvidenceFile } = require('../utils/fileUtils');
const { ensureUploadSubdir, resolveUploadPath } = require('../utils/paths');
const { recomputeAndStoreIpt, purgeRecordHistory, recordLifecycleKeterangans } = require('../utils/ipt');

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
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const eventId = req.params.id;

        const [event] = await conn.query('SELECT id, user_id, nama, nis, kelas, grha, nama_event, tingkat, foto, point, status, rejection_reason, created_at FROM event WHERE id = ?', [eventId]);
        if (event.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Event not found' });
        }
        if (event[0].status !== 'pending') {
            await conn.rollback();
            return res.status(400).json({ message: 'Event ini sudah diproses' });
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

        // Conditional update closes the race between the SELECT above and
        // this write (two admins approving at once): only one wins.
        const [updated] = await conn.query('UPDATE event SET status = ?, foto = ? WHERE id = ? AND status = ?', ['approved', newFotoPath, eventId, 'pending']);
        if (updated.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Event ini sudah diproses' });
        }

        // Recompute the total from approved records (same formula as
        // syncIpt.js) never arithmetic, so double-approvals and drift
        // are impossible.
        await recomputeAndStoreIpt(eventData.user_id, {
            jenis: 'event',
            keterangan: buildKeterangan('event', eventData),
            executor: conn.query,
            recordType: 'event',
            recordId: eventId,
        });

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'APPROVE_EVENT', `Approved event ID ${eventId}`]
        );

        await conn.commit();

        res.json({ message: 'Event approved successfully' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
    }
});

// Reject event (superadmin only)
router.put('/:id/reject', auth, superAdminOnly, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { rejection_reason } = req.body;
        const eventId = req.params.id;

        const [rows] = await conn.query('SELECT id, user_id, foto, status, nama_event FROM event WHERE id = ?', [eventId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Event not found' });
        }
        const wasApproved = rows[0].status === 'approved';

        // Serialize concurrent mutations of this student, then reject.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [rows[0].user_id]);
        }

        await conn.query('UPDATE event SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', rejection_reason, eventId]);

        // A rejected record stops counting: recompute WITHOUT a tombstone
        // row ('*_reject' is not in the ipt_history CHECK list), then remove
        // every history trace of this record like a delete does.
        if (wasApproved) {
            await recomputeAndStoreIpt(rows[0].user_id, {
                jenis: 'event_reject',
                keterangan: `Reject Event: ${rejection_reason || 'Tanpa alasan'}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(rows[0].user_id, 'event', eventId, recordLifecycleKeterangans('event', rows[0]), conn.query);
        }

        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'REJECT_EVENT', `Rejected event ID ${eventId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        if (rows[0]?.foto) {
            await deletePhotoIfOrphan(db, rows[0].foto, { exclude: { table: 'event', id: eventId }, folderHint: 'event' });
        }

        res.json({ message: 'Event rejected' });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        conn.release();
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

        // Swap evidence for the new upload (keeps the timestamp-unique
        // multer name; approved rows land in approved/).
        if (req.file) {
            const next = await replaceEvidenceFile(db, {
                oldFoto: foto,
                uploadedFilename: req.file.filename,
                recordType: 'event',
                approved: eventData.status === 'approved',
                exclude: { table: 'event', id: eventId }
            });
            if (next) foto = next;
        }

        // Recalculate points if tingkat changed
        const point = await calculateEventPoints(tingkat);

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [upd] = await conn.query(
                'UPDATE event SET nama = ?, nis = ?, kelas = ?, grha = ?, nama_event = ?, tingkat = ?, foto = ?, point = ? WHERE id = ?',
                [nama, nis, kelas, grha, nama_event, tingkat, foto, point, eventId]
            );
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ message: 'Event not found' });
            }

            // Approved records feed the total: recompute it (same formula as
            // syncIpt.js) so point edits and any pre-existing drift land
            // exactly. Pending records never touched IPT.
            if (eventData.status === 'approved') {
                await recomputeAndStoreIpt(eventData.user_id, {
                    jenis: 'event_update',
                    keterangan: `Update Event: ${nama_event}`,
                    executor: conn.query,
                    recordType: 'event',
                    recordId: eventId,
                });
            }

            // Log activity
            await conn.query(
                'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
                [req.user.id, 'UPDATE_EVENT', `Updated event ID ${eventId}`]
            );

            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        } finally {
            conn.release();
        }

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
        const wasApproved = eventData.status === 'approved';

        // Serialize concurrent mutations of this student, then remove the row.
        if (wasApproved) {
            await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [eventData.user_id]);
        }
        await conn.query('DELETE FROM event WHERE id = ?', [eventId]);

        // Approved records contributed to the total: recompute it from the
        // remaining approved records (same formula as syncIpt.js) this
        // also heals any pre-existing drift. Pending/rejected records never
        // touched IPT, so nothing more to do for them.
        if (wasApproved) {
            // Recompute WITHOUT a tombstone row, then remove every history
            // trace of this record so it stops showing in history views.
            await recomputeAndStoreIpt(eventData.user_id, {
                jenis: 'event_delete',
                keterangan: `Delete Event: ${eventData.nama_event}`,
                executor: conn.query,
                skipHistory: true,
            });
            await purgeRecordHistory(eventData.user_id, 'event', eventId, recordLifecycleKeterangans('event', eventData), conn.query);
        }

        // Log activity
        await conn.query(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.user.id, 'DELETE_EVENT', `Deleted event ID ${eventId}`]
        );

        await conn.commit();

        // Delete the evidence file when no other row references it anymore
        // (kelompok siblings may share one file never strand them).
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
