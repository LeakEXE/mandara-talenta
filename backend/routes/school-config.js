const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { auth, superAdminOnly } = require('../middleware/auth');
const multer = require('multer');
const { ensureUploadSubdir, UPLOAD_DIR } = require('../utils/paths');

// Configure multer for logo uploads. Generate a safe filename instead of
// trusting the multipart filename, which can contain path traversal segments.
const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('logos'));
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 10);
        // Derive the extension from the validated MIME type, never from the
        // client-supplied filename (which could be .html/.svg).
        const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
        cb(null, `${timestamp}_${random}${ext}`);
    }
});

const logoUpload = multer({
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
            const error = new Error('Only JPEG and PNG images are allowed');
            error.status = 400;
            return cb(error);
        }
        cb(null, true);
    }
});

// GET public school branding
router.get('/public', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT school_name, school_description, logo_url, support_link, announcement FROM school_config LIMIT 1'
    );

    if (rows.length === 0) {
      return res.json({
        school_name: 'SMK Negeri Bali Mandara',
        school_description: 'Mandara Talenta (Manajemen dan Pengembangan Karakter Talenta) • Panel Admin',
        logo_url: null,
        support_link: null
      });
    }

    // Public pages (login/forgot-password) need the school logo, but /uploads
    // itself requires a session. Point them at the controlled public logo
    // endpoint below instead of exposing all uploaded files.
    const config = rows[0];
    if (config.logo_url) {
      const normalizedLogo = String(config.logo_url).replace(/\\/g, '/');
      if (/^(https?:\/\/|data:|\/\/)/i.test(normalizedLogo)) {
        config.logo_url = normalizedLogo;
      } else if (/^\/?uploads\/logos\//.test(normalizedLogo)) {
        config.logo_url = '/api/school-config/public/logo';
      } else {
        config.logo_url = normalizedLogo.startsWith('/') ? normalizedLogo : `/${normalizedLogo}`;
      }
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching public school config:', error);
    res.status(500).json({ message: 'Failed to fetch school configuration' });
  }
});

// GET the configured school logo for unauthenticated branding pages.
// Only the exact file stored in school_config.logo_url is served; arbitrary
// filenames under uploads/ are not reachable through this route.
router.get('/public/logo', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT logo_url FROM school_config LIMIT 1');
    const logoUrl = rows[0]?.logo_url;

    if (!logoUrl || /^https?:\/\//i.test(String(logoUrl))) {
      return res.status(404).end();
    }

    const normalized = String(logoUrl).replace(/\\/g, '/');
    if (!normalized.startsWith('uploads/logos/') && !normalized.startsWith('/uploads/logos/')) {
      return res.status(404).end();
    }

    const filename = path.basename(normalized);
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(filename)) {
      return res.status(404).end();
    }

    const logoPath = path.resolve(UPLOAD_DIR, 'logos', filename);
    if (!fs.existsSync(logoPath)) {
      return res.status(404).end();
    }

    // Restrict the response so an SVG logo opened directly cannot execute
    // scripts in the application's origin. Raster images are unaffected.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(logoPath);
  } catch (error) {
    console.error('Error serving public school logo:', error);
    res.status(500).end();
  }
});

// Apply auth middleware to all routes
router.use(auth);

// GET school configuration
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, school_name, school_description, principal_name, principal_nip, logo_url, support_link, announcement, created_at, updated_at FROM school_config LIMIT 1'
    );

    if (rows.length === 0) {
        console.log('No school config found, returning default');
      return res.json({
        id: null,
        school_name: 'SMK Negeri Bali Mandara',
        school_description: 'Sistem Individual Card (IPT) • Panel Admin',
        principal_name: 'Nama Kepala Sekolah',
        principal_nip: '',
        logo_url: null,
        support_link: null,
        created_at: null,
        updated_at: null
      });
    }

    const config = rows[0];
    // Transform logo_url to ensure it's a proper relative path
    if (config.logo_url && !config.logo_url.startsWith('http')) {
      config.logo_url = config.logo_url.startsWith('/') ? config.logo_url : `/${config.logo_url}`;
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching school config:', error);
    res.status(500).json({ message: 'Failed to fetch school configuration' });
  }
});

// PUT school configuration (superadmin only)
router.put('/', async (req, res) => {
  try {
    const { school_name, school_description, principal_name, principal_nip, logo_url, support_link, announcement } = req.body;
    
    // Check if user is superadmin
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only superadmin can update school configuration' });
    }
    
    // Check if config exists
    const [existing] = await db.query('SELECT id FROM school_config LIMIT 1');
    
    if (existing.length > 0) {
      // Update existing config
      await db.query(
        `UPDATE school_config 
         SET school_name = ?, school_description = ?, principal_name = ?, principal_nip = ?, logo_url = ?, support_link = ?, announcement = ?, updated_at = NOW()
         WHERE id = ?`,
        [school_name, school_description, principal_name, principal_nip, logo_url, support_link ?? null, announcement ?? null, existing[0].id]
      );
    } else {
      // Insert new config
      await db.query(
        `INSERT INTO school_config (school_name, school_description, principal_name, principal_nip, logo_url, support_link, announcement, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [school_name, school_description, principal_name, principal_nip, logo_url, support_link ?? null, announcement ?? null]
      );
    }
    
    // Fetch and return updated config
    const [rows] = await db.query('SELECT * FROM school_config LIMIT 1');
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating school config:', error);
    res.status(500).json({ message: 'Failed to update school configuration' });
  }
});

// Upload logo endpoint. The role gate runs before multer so non-superadmins
// cannot write files to disk even if they never reach the handler.
router.post('/upload-logo', superAdminOnly, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const logoUrl = `/uploads/logos/${req.file.filename}`;

    // Update school config with new logo
    const [existing] = await db.query('SELECT id FROM school_config LIMIT 1');

    if (existing.length > 0) {
      await db.query(
        'UPDATE school_config SET logo_url = ?, updated_at = NOW() WHERE id = ?',
        [logoUrl, existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO school_config (logo_url, created_at, updated_at) VALUES (?, NOW(), NOW())',
        [logoUrl]
      );
    }

    res.json({ logoUrl });
  } catch (error) {
    console.error('Error in logo upload:', error);
    res.status(500).json({ message: 'Failed to upload logo' });
  }
});

module.exports = router;
