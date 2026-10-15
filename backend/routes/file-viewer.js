const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const { UPLOAD_DIR } = require('../utils/paths');
const { collectFotoReferences, isFotoReferenced } = require('../utils/fileUtils');

// Single source of truth: every directory under uploads/ the manager may open.
// (The folder grid lists all directories, so anything missing here 403s on click.)
const ALLOWED_FOLDERS = ['prestasi', 'pelanggaran', 'organisasi', 'kepanitiaan', 'event', 'perilaku', 'avatars', 'approved', 'approvals', 'logos'];

// Helper function to sanitize and validate file paths
const sanitizePath = (inputPath) => {
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

// Get all folders in uploads directory
router.get('/folders', auth, superAdminOnly, async (req, res) => {
    try {
        const uploadsDir = UPLOAD_DIR;
        
        if (!fs.existsSync(uploadsDir)) {
            return res.json([]);
        }

        const items = fs.readdirSync(uploadsDir, { withFileTypes: true });
        const folders = items
            .filter(item => item.isDirectory())
            .map(folder => ({
                name: folder.name,
                path: `/uploads/${folder.name}`,
                type: 'folder'
            }));

        res.json(folders);
    } catch (error) {
        console.error('Error listing folders:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get files in a specific folder
router.get('/files/:folderName', auth, superAdminOnly, async (req, res) => {
    try {
        const { folderName } = req.params;
        
        // Sanitize folder name to prevent path traversal
        const sanitizedFolderName = sanitizePath(folderName);
        
        // Whitelist of allowed folder names
        const allowedFolders = ALLOWED_FOLDERS;
        if (!allowedFolders.includes(sanitizedFolderName)) {
            return res.status(403).json({ message: 'Invalid folder name' });
        }
        
        const folderPath = path.join(UPLOAD_DIR, sanitizedFolderName);
        const uploadsDir = UPLOAD_DIR;

        // Validate path is within uploads directory
        if (!validatePath(folderPath, uploadsDir)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!fs.existsSync(folderPath)) {
            return res.status(404).json({ message: 'Folder not found' });
        }

        const items = fs.readdirSync(folderPath, { withFileTypes: true });
        // Walk recursively: approved/<jenis>/ files live one level down,
        // and a flat list keeps the table + filters + paging working.
        const walk = (dir, rel) => {
            const out = [];
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
                const entryAbs = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    out.push(...walk(entryAbs, entryRel));
                } else if (entry.isFile()) {
                    const stats = fs.statSync(entryAbs);
                    out.push({
                        name: entry.name,
                        path: `/uploads/${sanitizedFolderName}/${entryRel}`,
                        subfolder: rel || '',
                        size: stats.size,
                        created: stats.birthtime,
                        type: 'file'
                    });
                }
            }
            return out;
        };
        const files = walk(folderPath, '');

        // DB cross-check: flag files no record references anymore (rejected
        // submissions, deleted rows). Superadmin can filter + delete them here.
        const refs = await collectFotoReferences(db);
        for (const f of files) {
            f.referenced = isFotoReferenced(refs, f.path);
        }

        // For avatars folder, include the linked username
        if (sanitizedFolderName === 'avatars') {
            const [avatarRows] = await db.query(
                'SELECT username, foto FROM users WHERE foto IS NOT NULL AND foto <> \'\''
            );
            const fileToUsername = {};
            for (const row of avatarRows) {
                const normalized = String(row.foto).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^uploads\//i, '');
                const basename = normalized.split('/').pop();
                fileToUsername[basename] = row.username;
                fileToUsername[normalized] = row.username;
            }
            for (const f of files) {
                const basename = f.name;
                f.username = fileToUsername[basename] || fileToUsername[f.path.replace(/^\/+/, '')] || null;
            }
        }

        res.json(files);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a file (supports nested paths, e.g. approved/prestasi/x.jpg)
router.delete('/file/:folderName/*', auth, superAdminOnly, async (req, res) => {
    try {
        const { folderName } = req.params;
        const nestedPath = req.params[0] || '';
        
        // Sanitize inputs to prevent path traversal
        const sanitizedFolderName = sanitizePath(folderName);
        const sanitizedFileName = sanitizePath(nestedPath);
        
        // Whitelist of allowed folder names
        const allowedFolders = ALLOWED_FOLDERS;
        if (!allowedFolders.includes(sanitizedFolderName)) {
            return res.status(403).json({ message: 'Invalid folder name' });
        }
        
        const filePath = path.join(UPLOAD_DIR, sanitizedFolderName, sanitizedFileName);
        const uploadsDir = UPLOAD_DIR;

        // Validate path is within uploads directory
        if (!validatePath(filePath, uploadsDir)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'File not found' });
        }

        fs.unlinkSync(filePath);
        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
