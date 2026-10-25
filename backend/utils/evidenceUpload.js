const path = require('path');

// Shared upload policy for IPT record evidence (bukti) across all inputs.
// Accepts images + PDF (NOT office docs). Avatars and school logos keep
// their own image-only configs in profile.js / school-config.js.
const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const EVIDENCE_MAX_FILES = 5;

const EVIDENCE_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
];

const EVIDENCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

function evidenceFileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (EVIDENCE_MIMETYPES.includes(file.mimetype) && EVIDENCE_EXTENSIONS.includes(ext)) {
        return cb(null, true);
    }
    cb(new Error('Hanya file gambar (JPG, PNG, GIF, WebP) dan PDF yang diizinkan (maks 10MB)'));
}

function assertEvidenceRequired(files) {
    if (!Array.isArray(files) || files.length === 0) {
        const error = new Error('Minimal satu file bukti wajib diunggah');
        error.statusCode = 400;
        throw error;
    }
}

const EVIDENCE_LIMITS = {
    fileSize: EVIDENCE_MAX_SIZE,
    files: EVIDENCE_MAX_FILES
};

module.exports = {
    EVIDENCE_MAX_SIZE,
    EVIDENCE_MAX_FILES,
    EVIDENCE_MIMETYPES,
    EVIDENCE_EXTENSIONS,
    evidenceFileFilter,
    assertEvidenceRequired,
    EVIDENCE_LIMITS
};
