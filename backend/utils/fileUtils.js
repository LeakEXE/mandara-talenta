const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR, resolveUploadPath } = require('./paths');

// Helper function to sanitize file paths
const sanitizePath = (inputPath) => {
    if (!inputPath) return null;
    
    // Remove any null bytes
    const sanitized = inputPath.replace(/\0/g, '');
    
    // Remove directory traversal attempts
    const withoutTraversal = sanitized.replace(/\.\./g, '').replace(/\\/g, '/');
    
    // Remove URL-encoded traversal attempts
    const decoded = decodeURIComponent(withoutTraversal);
    const finalSanitized = decoded.replace(/\.\./g, '');
    
    return finalSanitized;
};

// Helper function to validate path is within allowed directory
const validatePath = (requestedPath, allowedBase) => {
    if (!requestedPath || !allowedBase) return false;
    
    const resolvedRequested = path.resolve(requestedPath);
    const resolvedAllowed = path.resolve(allowedBase);
    
    // Ensure the resolved path starts with the allowed base directory
    if (!resolvedRequested.startsWith(resolvedAllowed)) {
        return false;
    }
    
    // Additional check: ensure no symbolic links escape the allowed directory
    try {
        const realRequested = fs.realpathSync(resolvedRequested);
        const realAllowed = fs.realpathSync(resolvedAllowed);
        return realRequested.startsWith(realAllowed);
    } catch (error) {
        // If realpath fails (file doesn't exist), use the resolved path check
        return true;
    }
};

/**
 * Move photo to organized folder structure when record is approved
 * Creates directory structure: uploads/approved/[type]/[year]/[filename]
 * @param {string} currentFilePath - Current file path (e.g., 'uploads/prestasi/filename.jpg')
 * @param {string} recordType - Type of record (prestasi, pelanggaran, etc.)
 * @returns {string} New file path relative to project root, or null if no photo
 */
const movePhotoToApprovedFolder = (currentFilePath, recordType) => {
    if (!currentFilePath) {
        return null;
    }

    try {
        // Sanitize the current file path
        const sanitizedPath = sanitizePath(currentFilePath);
        if (!sanitizedPath) {
            console.warn('Invalid file path provided');
            return null;
        }

        // Whitelist of allowed record types
        const allowedTypes = ['prestasi', 'pelanggaran', 'organisasi', 'kepanitiaan', 'event', 'perilaku'];
        if (!allowedTypes.includes(recordType)) {
            console.warn(`Invalid record type: ${recordType}`);
            return null;
        }

        // Absolute folder path: <backend>/uploads/approved/[type]/ (cwd-independent)
        const approvedDir = path.join(UPLOAD_DIR, 'approved', recordType);
        const uploadsBase = UPLOAD_DIR;
        
        // Ensure directory exists
        if (!fs.existsSync(approvedDir)) {
            fs.mkdirSync(approvedDir, { recursive: true });
        }

        // Get filename from current path
        const filename = path.basename(sanitizedPath);
        
        // Full paths (DB stores 'uploads/...' relative strings; resolve against UPLOAD_DIR)
        const oldFullPath = resolveUploadPath(sanitizedPath);
        const newFullPath = path.join(approvedDir, filename);

        // Validate source path is within uploads directory
        if (!validatePath(oldFullPath, uploadsBase)) {
            console.warn(`Source file path is outside allowed directory: ${oldFullPath}`);
            return null;
        }

        // Validate destination path is within uploads directory
        if (!validatePath(newFullPath, uploadsBase)) {
            console.warn(`Destination file path is outside allowed directory: ${newFullPath}`);
            return null;
        }

        // Check if source file exists
        if (!fs.existsSync(oldFullPath)) {
            console.warn(`Source file not found: ${oldFullPath}`);
            return null;
        }

        // Move file (rename from old location to new location)
        fs.renameSync(oldFullPath, newFullPath);

        // Return relative path for database storage
        return path.join('approved', recordType, filename).replace(/\\/g, '/');
    } catch (error) {
        console.error('Error moving photo to approved folder:', error);
        return null;
    }
};

/**
 * Delete photo file from disk
 * @param {string} filePath - File path relative to project root
 * @returns {boolean} True if deleted successfully
 */
const deletePhotoFile = (filePath) => {    if (!filePath) {
        return false;
    }

    try {
        const sanitizedPath = sanitizePath(filePath);
        if (!sanitizedPath) {
            console.warn('Invalid file path provided');
            return false;
        }

        const fullPath = resolveUploadPath(sanitizedPath);
        const uploadsBase = UPLOAD_DIR;
        
        // Validate path is within uploads directory
        if (!validatePath(fullPath, uploadsBase)) {
            console.warn(`File path is outside allowed directory: ${fullPath}`);
            return false;
        }
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting photo file:', error);
        return false;
    }
};

/**
 * Every table/column that can reference an evidence file, avatar, or logo.
 * Used both to avoid deleting live files and to flag orphans in file-manager.
 * (perilaku has no file column; siswa_approvals/biodata/password tables hold no files.)
 */
const FOTO_REFERENCES = [
    { table: 'prestasi', column: 'foto' },
    { table: 'event', column: 'foto' },
    { table: 'organisasi', column: 'foto' },
    { table: 'kepanitiaan', column: 'foto' },
    { table: 'pelanggaran', column: 'foto' },
    { table: 'prestasi_approvals', column: 'foto' },
    { table: 'event_approvals', column: 'foto' },
    { table: 'organisasi_approvals', column: 'foto' },
    { table: 'kepanitiaan_approvals', column: 'foto' },
    { table: 'users', column: 'foto' },
    { table: 'school_config', column: 'logo_url' }
];

/**
 * Normalize a stored file reference for comparison.
 * DB holds three shapes: 'uploads/<type>/f' (central flow + approved rows),
 * '/uploads/...' (leading slash, e.g. avatars), and bare 'f' (per-type direct rows).
 * All three normalize to a path relative to uploads/ (or the bare name).
 */
const normalizeFotoValue = (v) => String(v || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//i, '');

/**
 * Collect every live file reference in the DB.
 * @param {object} db - db wrapper (or transaction conn) with .query()
 * @param {{table:string,id:number}|null} exclude - row to ignore (the one being rejected/deleted)
 * @returns {{full:Set<string>, base:Set<string>}} normalized paths + basenames
 */
async function collectFotoReferences(db, exclude = null) {
    const full = new Set();
    const base = new Set();
    for (const { table, column } of FOTO_REFERENCES) {
        let rows;
        try {
            if (exclude && exclude.table === table) {
                [rows] = await db.query(
                    `SELECT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> '' AND id <> ?`,
                    [exclude.id]
                );
            } else {
                [rows] = await db.query(
                    `SELECT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`
                );
            }
        } catch {
            continue; // missing table/column on older schemas
        }
        for (const r of rows || []) {
            const n = normalizeFotoValue(r.v);
            if (!n) continue;
            full.add(n);
            base.add(n.split('/').pop());
        }
    }
    return { full, base };
}

/**
 * Is a file (listing path like '/uploads/approved/prestasi/f.jpg', a DB-style
 * 'uploads/...' value, or a bare filename) still referenced by any DB row?
 * Basename fallback errs toward "referenced" never strand a live file over
 * a naming collision; true orphans surface in file-manager instead.
 */
function isFotoReferenced(refs, filePath) {
    const n = normalizeFotoValue(filePath);
    if (!n) return false;
    if (refs.full.has(n)) return true;
    return refs.base.has(n.split('/').pop());
}

/**
 * Delete the physical file only when no DB row references it anymore.
 * Group siblings often share one evidence file this is what keeps a reject
 * or record-delete from pulling it out from under the others.
 * @param {object} db - db wrapper (or transaction conn)
 * @param {string} storedValue - the foto value from the row being rejected/deleted
 * @param {object} opts - { exclude: {table,id}|null, folderHint: uploads subfolder for bare filenames }
 * @returns {boolean} True if a file was actually deleted
 */
async function deletePhotoIfOrphan(db, storedValue, opts = {}) {
    const { exclude = null, folderHint = null } = opts;
    const norm = normalizeFotoValue(storedValue);
    if (!norm) return false;

    const refs = await collectFotoReferences(db, exclude);
    const base = norm.split('/').pop();
    if (refs.full.has(norm) || refs.base.has(base)) return false; // still referenced

    // Locate on disk: full refs resolve under UPLOAD_DIR, bare names need
    // their type folder (e.g. per-type direct rows store just 'f.jpg').
    const abs = norm.includes('/')
        ? path.join(UPLOAD_DIR, norm)
        : (folderHint ? path.join(UPLOAD_DIR, folderHint, norm) : null);
    if (!abs || !validatePath(abs, UPLOAD_DIR)) return false;

    try {
        if (!fs.existsSync(abs)) return false; // already gone (e.g. moved on approve)
        fs.unlinkSync(abs);
        return true;
    } catch (error) {
        console.error('Error deleting orphan photo:', abs, error.message);
        return false;
    }
}

/**
 * Resolve any stored evidence shape to the DB-canonical source path
 * ('uploads/<type>/f') for filesystem operations.
 * Handles 'uploads/<type>/f', '/uploads/...' (leading slash), and bare
 * filenames from per-type direct rows. Returns null for empty input.
 */
const evidenceSourcePath = (foto, recordType) => {
    if (!foto) return null;
    const s = String(foto).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s) return null;
    if (s.toLowerCase().startsWith('uploads/')) return s;
    return `uploads/${recordType}/${s}`;
};

/**
 * Swap a record's evidence file for a freshly uploaded one (record updates).
 * - Keeps multer's timestamp-unique filename. The old NIS_Name renames baked
 *   free-text fields (spaces, slashes) into filenames, breaking viewer URLs.
 * - Deletes the previous file only when no other row references it
 *   (kelompok siblings share one evidence file).
 * - Stores the DB-canonical 'uploads/<type>/f' path; moves to approved/ when
 *   the record is already approved.
 * @param {object} db - db wrapper with .query()
 * @param {object} opts - { oldFoto, uploadedFilename, recordType, approved, exclude:{table,id}|null }
 * @returns {string|null} DB path to store, or null when the swap failed
 *   (caller keeps the old value in that case).
 */
async function replaceEvidenceFile(db, { oldFoto, uploadedFilename, recordType, approved, exclude = null }) {
    try {
        let stored = `uploads/${recordType}/${uploadedFilename}`;
        if (approved) {
            const moved = movePhotoToApprovedFolder(stored, recordType);
            if (moved) stored = path.join('uploads', moved).replace(/\\/g, '/');
        }
        if (oldFoto) {
            await deletePhotoIfOrphan(db, oldFoto, { exclude, folderHint: recordType });
        }
        return stored;
    } catch (error) {
        console.error('Error replacing evidence file:', error.message);
        return null;
    }
}

module.exports = {
    movePhotoToApprovedFolder,
    deletePhotoFile,
    replaceEvidenceFile,
    sanitizePath,
    validatePath,
    evidenceSourcePath,
    FOTO_REFERENCES,
    normalizeFotoValue,
    collectFotoReferences,
    isFotoReferenced,
    deletePhotoIfOrphan
};
