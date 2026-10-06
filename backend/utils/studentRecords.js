const db = require('../config/database');
const { attachPembinaLists } = require('./ipt');

async function getStudentRecords(userId) {
    const [prestasi] = await db.query(
        'SELECT * FROM prestasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );
    await attachPembinaLists(prestasi, 'prestasi_pembina', 'prestasi_id');

    const [organisasi] = await db.query(
        'SELECT * FROM organisasi WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );

    const [kepanitiaan] = await db.query(
        'SELECT * FROM kepanitiaan WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );

    const [event] = await db.query(
        'SELECT * FROM event WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );

    const [pelanggaran] = await db.query(
        'SELECT * FROM pelanggaran WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );

    const [perilaku] = await db.query(
        'SELECT * FROM perilaku WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
        [userId, 'approved']
    );

    const prestasiCount = prestasi.length;

    return {
        total_prestasi: prestasiCount,
        total_organisasi: organisasi.length,
        total_kepanitiaan: kepanitiaan.length,
        total_event: event.length,
        total_pelanggaran: pelanggaran.length,
        total_perilaku: perilaku.length,
        prestasi,
        organisasi,
        kepanitiaan,
        event,
        pelanggaran,
        perilaku
    };
}

module.exports = { getStudentRecords };
