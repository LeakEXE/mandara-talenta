// Student welfare field validation (jenis_kelamin + desil).
// Shared by routes/users.js and scripts/updateStudentsFromCsv.js so the
// rules cannot drift. Empty/undefined means "leave unchanged" for updates
// and NULL for creates — use { value, present } results.

function normalizeNisn(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { present: false, value: null };
    }
    const value = String(raw).trim();
    if (!/^\d{10}$/.test(value)) {
        const err = new Error('NISN harus terdiri dari tepat 10 angka.');
        err.statusCode = 400;
        throw err;
    }
    return { present: true, value };
}

function normalizeGender(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { present: false, value: null };
    }
    const v = String(raw).trim().toUpperCase();
    if (v !== 'L' && v !== 'P') {
        const err = new Error("Jenis kelamin tidak valid. Gunakan 'L' atau 'P'.");
        err.statusCode = 400;
        throw err;
    }
    return { present: true, value: v };
}

function normalizeDesil(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { present: false, value: null };
    }
    const text = String(raw).trim();
    // Integer 1-10 only (no decimals, no text). Number('') is 0, but empty
    // is already handled above, so a 0 here is genuinely invalid.
    if (!/^(10|[1-9])$/.test(text)) {
        const err = new Error('Desil tidak valid. Gunakan angka 1-10.');
        err.statusCode = 400;
        throw err;
    }
    return { present: true, value: parseInt(text, 10) };
}

// DTSEN welfare labels for display (frontend mirrors this map).
const DESIL_LABELS = {
    1: 'Sangat miskin',
    2: 'Miskin',
    3: 'Hampir miskin',
    4: 'Rentan miskin',
    5: 'Menengah bawah',
    6: 'Menengah',
    7: 'Menengah',
    8: 'Menengah atas',
    9: 'Kaya',
    10: 'Sangat kaya',
};

module.exports = { normalizeNisn, normalizeGender, normalizeDesil, DESIL_LABELS };
