// Client-side mirror of backend/utils/evidenceUpload.js policy.
// Keep both in sync: images + PDF, five files max, 10MB per file.
export const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const EVIDENCE_MAX_FILES = 5;

const EVIDENCE_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
];

const EVIDENCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

// Returns an Indonesian error message, or null when the file is acceptable.
export function validateEvidenceFile(file) {
    if (!file) return null;
    const ext = '.' + (String(file.name).split('.').pop() || '').toLowerCase();
    if (!EVIDENCE_MIMETYPES.includes(file.type) || !EVIDENCE_EXTENSIONS.includes(ext)) {
        return 'File harus berupa gambar (JPG, PNG, GIF, WebP) atau PDF.';
    }
    if (file.size > EVIDENCE_MAX_SIZE) {
        return 'Ukuran file maksimal 10MB.';
    }
    return null;
}

export function validateEvidenceFiles(files, existingCount = 0) {
    const list = Array.from(files || []);
    if (existingCount + list.length > EVIDENCE_MAX_FILES) {
        return `Maksimal ${EVIDENCE_MAX_FILES} file bukti per data.`;
    }
    for (const file of list) {
        const error = validateEvidenceFile(file);
        if (error) return error;
    }
    return null;
}

export function evidenceItemsForRecord(record) {
    if (Array.isArray(record?.evidence) && record.evidence.length > 0) {
        return record.evidence;
    }
    const legacyPath = record?.foto || record?.foto_path;
    return legacyPath ? [{ id: null, path: legacyPath }] : [];
}
