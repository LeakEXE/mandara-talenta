// Tanggal pelaksanaan lomba validation, shared by routes/prestasi.js and
// routes/approvals.js so the rules cannot drift. Empty/undefined means
// "unknown" (NULL) — the field is optional on every write path.
function normalizeTanggalPelaksanaan(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
    }
    const text = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const err = new Error('Tanggal pelaksanaan tidak valid. Gunakan format YYYY-MM-DD.');
        err.statusCode = 400;
        throw err;
    }
    const [y, m, d] = text.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        const err = new Error('Tanggal pelaksanaan tidak valid (tanggal tidak ada di kalender).');
        err.statusCode = 400;
        throw err;
    }
    return text;
}

module.exports = { normalizeTanggalPelaksanaan };
