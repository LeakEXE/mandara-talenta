const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { UPLOAD_DIR, resolveUploadPath } = require('./paths');
const {
    movePhotoToApprovedFolder,
    evidenceSourcePath,
    deletePhotoIfOrphan
} = require('./fileUtils');
const { EVIDENCE_MAX_FILES } = require('./evidenceUpload');

// Every table that can own evidence. Values are the actual table names so the
// polymorphic record_evidence rows stay easy to inspect and clean up.
const EVIDENCE_RECORD_TYPES = new Set([
    'prestasi',
    'event',
    'organisasi',
    'kepanitiaan',
    'pelanggaran',
    'prestasi_approvals',
    'event_approvals',
    'organisasi_approvals',
    'kepanitiaan_approvals'
]);

function assertRecordType(recordType) {
    if (!EVIDENCE_RECORD_TYPES.has(recordType)) {
        throw new Error(`Invalid evidence record type: ${recordType}`);
    }
}

function normalizeEvidencePath(filePath) {
    if (!filePath) return null;
    const value = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '');
    return value || null;
}

function normalizeEvidencePaths(paths) {
    const seen = new Set();
    const out = [];
    for (const value of paths || []) {
        const normalized = normalizeEvidencePath(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function uploadedPaths(req, recordType) {
    assertRecordType(recordType);
    const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    return normalizeEvidencePaths(files.map((file) => `uploads/${recordType}/${file.filename}`));
}

function parseEvidenceIdList(value) {
    if (value === undefined || value === null || value === '') return [];
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            parsed = value.split(',');
        }
    }
    if (!Array.isArray(parsed)) parsed = [parsed];
    return [...new Set(parsed
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0))];
}

async function listEvidence(recordType, recordId, executor = db.query) {
    assertRecordType(recordType);
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) return [];

    const [rows] = await executor(
        `SELECT id, file_path, sort_order
         FROM record_evidence
         WHERE record_type = ? AND record_id = ?
         ORDER BY sort_order, id`,
        [recordType, id]
    );

    if (rows.length > 0) {
        return rows.map((row) => ({ id: row.id, path: row.file_path }));
    }

    // Legacy fallback: rows created before record_evidence existed.
    const [recordRows] = await executor(
        `SELECT foto FROM ${recordType} WHERE id = ?`,
        [id]
    );
    const legacy = recordRows[0]?.foto;
    return legacy ? [{ id: null, path: legacy }] : [];
}

async function attachEvidence(rows, recordType, executor = db.query) {
    assertRecordType(recordType);
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    const ids = rows
        .map((row) => Number(row.id))
        .filter((id) => Number.isInteger(id) && id > 0);

    let byRecord = new Map();
    if (ids.length > 0) {
        const [evidenceRows] = await executor(
            `SELECT id, record_id, file_path, sort_order
             FROM record_evidence
             WHERE record_type = ? AND record_id IN (?)
             ORDER BY sort_order, id`,
            [recordType, ids]
        );
        for (const row of evidenceRows) {
            const key = Number(row.record_id);
            if (!byRecord.has(key)) byRecord.set(key, []);
            byRecord.get(key).push({ id: row.id, path: row.file_path });
        }
    }

    for (const row of rows) {
        const items = byRecord.get(Number(row.id)) || [];
        row.evidence = items.length > 0
            ? items
            : (row.foto || row.foto_path
                ? [{ id: null, path: row.foto || row.foto_path }]
                : []);
    }
    return rows;
}

async function replaceEvidence(recordType, recordId, paths, executor = db.query) {
    assertRecordType(recordType);
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Invalid evidence record id');
    }

    const normalized = normalizeEvidencePaths(paths);
    if (normalized.length > EVIDENCE_MAX_FILES) {
        const error = new Error(`Maksimal ${EVIDENCE_MAX_FILES} file bukti per data`);
        error.statusCode = 400;
        throw error;
    }

    await executor(
        'DELETE FROM record_evidence WHERE record_type = ? AND record_id = ?',
        [recordType, id]
    );

    for (let i = 0; i < normalized.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await executor(
            `INSERT INTO record_evidence (record_type, record_id, file_path, sort_order)
             VALUES (?, ?, ?, ?)`,
            [recordType, id, normalized[i], i]
        );
    }

    await executor(
        `UPDATE ${recordType} SET foto = ? WHERE id = ?`,
        [normalized[0] || null, id]
    );

    return normalized;
}

async function appendEvidence(recordType, recordId, paths, executor = db.query) {
    const current = await listEvidence(recordType, recordId, executor);
    const combined = normalizeEvidencePaths([
        ...current.map((item) => item.path),
        ...(paths || [])
    ]);
    return replaceEvidence(recordType, recordId, combined, executor);
}

async function updateEvidenceSelection(recordType, recordId, { removeIds = [], newPaths = [] }, executor = db.query) {
    const current = await listEvidence(recordType, recordId, executor);
    const removeSet = new Set(parseEvidenceIdList(removeIds));
    const currentIds = new Set(current.map((item) => Number(item.id)).filter((id) => id > 0));

    for (const id of removeSet) {
        if (!currentIds.has(id)) {
            const error = new Error('File bukti yang akan dihapus tidak ditemukan pada data ini');
            error.statusCode = 400;
            throw error;
        }
    }

    const removed = current.filter((item) => item.id && removeSet.has(Number(item.id)));
    const kept = current.filter((item) => !item.id || !removeSet.has(Number(item.id)));
    const finalPaths = normalizeEvidencePaths([
        ...kept.map((item) => item.path),
        ...(newPaths || [])
    ]);

    await replaceEvidence(recordType, recordId, finalPaths, executor);
    return {
        removedPaths: removed.map((item) => item.path),
        finalPaths
    };
}

async function validateEvidenceSelection(recordType, recordId, removeIds, newFileCount, executor = db.query) {
    const current = await listEvidence(recordType, recordId, executor);
    const removeSet = new Set(parseEvidenceIdList(removeIds));
    const currentIds = new Set(current.map((item) => Number(item.id)).filter((id) => id > 0));

    for (const id of removeSet) {
        if (!currentIds.has(id)) {
            const error = new Error('File bukti yang akan dihapus tidak ditemukan pada data ini');
            error.statusCode = 400;
            throw error;
        }
    }

    const keptCount = current.filter((item) => !item.id || !removeSet.has(Number(item.id))).length;
    if (keptCount + newFileCount > EVIDENCE_MAX_FILES) {
        const error = new Error(`Maksimal ${EVIDENCE_MAX_FILES} file bukti per data`);
        error.statusCode = 400;
        throw error;
    }
}

function withEvidenceUploadCleanup(uploadMiddleware, recordType) {
    assertRecordType(recordType);
    return (req, res, next) => {
        uploadMiddleware(req, res, (error) => {
            if (error) return next(error);

            const uploaded = uploadedPaths(req, recordType);
            if (uploaded.length > 0) {
                res.once('finish', () => {
                    if (res.statusCode < 400) return;
                    const approvedPaths = uploaded.map((filePath) =>
                        `uploads/approved/${recordType}/${path.basename(filePath)}`
                    );
                    deleteEvidenceFilesIfOrphan(
                        [...uploaded, ...approvedPaths],
                        { folderHint: recordType }
                    ).catch((cleanupError) => {
                        console.error('Failed to clean up rejected evidence upload', cleanupError);
                    });
                });
            }
            next();
        });
    };
}

async function copyEvidence(fromType, fromId, toType, toId, pathMap = new Map(), executor = db.query) {
    const source = await listEvidence(fromType, fromId, executor);
    const mapped = source.map((item) => pathMap.get(item.path) || item.path);
    return replaceEvidence(toType, toId, mapped, executor);
}

async function deleteEvidenceForRecord(recordType, recordId, executor = db.query) {
    const current = await listEvidence(recordType, recordId, executor);
    assertRecordType(recordType);
    await executor(
        'DELETE FROM record_evidence WHERE record_type = ? AND record_id = ?',
        [recordType, Number(recordId)]
    );
    return current.map((item) => item.path);
}

function moveEvidenceToApproved(paths, recordType) {
    assertRecordType(recordType);
    const pathMap = new Map();

    for (const original of normalizeEvidencePaths(paths)) {
        const normalized = normalizeEvidencePath(original);
        if (!normalized) continue;

        // Already in the permanent approved folder.
        if (normalized.toLowerCase().startsWith('uploads/approved/')) {
            pathMap.set(original, normalized);
            continue;
        }

        const source = evidenceSourcePath(normalized, recordType);
        const moved = source ? movePhotoToApprovedFolder(source, recordType) : null;
        if (moved) {
            pathMap.set(original, `uploads/${moved}`.replace(/\\/g, '/'));
            continue;
        }

        // A group member may already have moved the shared file. Reuse the
        // approved copy when the stored source no longer exists.
        const filename = path.basename(normalized);
        const approvedGuess = `uploads/approved/${recordType}/${filename}`;
        try {
            if (fs.existsSync(resolveUploadPath(approvedGuess))) {
                pathMap.set(original, approvedGuess);
                continue;
            }
        } catch {
            // Keep the stored path below.
        }
        pathMap.set(original, normalized);
    }

    return pathMap;
}

async function deleteEvidenceFilesIfOrphan(paths, { exclude = null, folderHint = null } = {}, executor = db) {
    for (const filePath of normalizeEvidencePaths(paths)) {
        // eslint-disable-next-line no-await-in-loop
        await deletePhotoIfOrphan(executor, filePath, { exclude, folderHint });
    }
}

module.exports = {
    EVIDENCE_RECORD_TYPES,
    assertRecordType,
    normalizeEvidencePath,
    normalizeEvidencePaths,
    uploadedPaths,
    parseEvidenceIdList,
    listEvidence,
    attachEvidence,
    replaceEvidence,
    appendEvidence,
    updateEvidenceSelection,
    validateEvidenceSelection,
    withEvidenceUploadCleanup,
    copyEvidence,
    deleteEvidenceForRecord,
    moveEvidenceToApproved,
    deleteEvidenceFilesIfOrphan
};
