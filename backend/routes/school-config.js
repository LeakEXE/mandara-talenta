const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth } = require('../middleware/auth');
const multer = require('multer');
const { ensureUploadSubdir } = require('../utils/paths');

// Configure multer for logo uploads
const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureUploadSubdir('logos'));
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

const logoUpload = multer({ storage: logoStorage });

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

    // Transform logo_url to ensure it's a proper relative path
    const config = rows[0];
    if (config.logo_url && !config.logo_url.startsWith('http')) {
      // Ensure relative path starts with /
      config.logo_url = config.logo_url.startsWith('/') ? config.logo_url : `/${config.logo_url}`;
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching public school config:', error);
    res.status(500).json({ message: 'Failed to fetch school configuration' });
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

// Upload logo endpoint
router.post('/upload-logo', logoUpload.single('logo'), async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only superadmin can upload logo' });
    }
    
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: 'Only JPEG and PNG images are allowed' });
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
