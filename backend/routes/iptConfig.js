const express = require('express');
const router = express.Router();
const { auth, superAdminOnly } = require('../middleware/auth');
const db = require('../config/database');
const { clearConfigCache, getIptAwalPerGrade, IPT_AWAL_GRADES } = require('../utils/iptConfig');

async function getOrganisasiOptions(activeOnly = false) {
    const [rows] = await db.query(
        `SELECT id, name, is_active, created_at, updated_at
         FROM ipt_organisasi
         ${activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY name`
    );
    return rows;
}

async function getPerilakuRatings(activeOnly = false) {
    const [rows] = await db.query(
        `SELECT id, name, is_active, created_at, updated_at
         FROM ipt_perilaku_tingkat
         ${activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY name`
    );
    return rows;
}

async function getPelanggaranConfigs(activeOnly = false) {
    const activeClause = activeOnly ? 'WHERE l.is_active = TRUE' : '';
    const [rows] = await db.query(`
        SELECT CONCAT('level-', l.id) id, 'pelanggaran' category,
               l.name field1, NULL field2, l.point_value,
               l.description, l.is_active, l.created_at, l.updated_at
        FROM ipt_pelanggaran_level l ${activeClause}
        UNION ALL
        SELECT CONCAT('detail-', d.id), 'pelanggaran',
               d.name, l.name, l.point_value,
               NULL, d.is_active, d.created_at, d.updated_at
        FROM ipt_pelanggaran_detail d
        JOIN ipt_pelanggaran_level l ON l.id = d.level_id
        ${activeOnly ? 'WHERE d.is_active = TRUE AND l.is_active = TRUE' : ''}
        ORDER BY category, field1
    `);
    return rows;
}

function parsePelanggaranId(id) {
    const match = /^(level|detail)-(\d+)$/.exec(String(id));
    return match ? { type: match[1], value: Number(match[2]) } : null;
}

// Get all IPT configurations
router.get('/all', auth, superAdminOnly, async (req, res) => {
    try {
        const [configs] = await db.query(`
            SELECT 
                id,
                category,
                field1,
                field2,
                point_value,
                description,
                is_active,
                created_at,
                updated_at,
                updated_by,
                (SELECT nama FROM users WHERE id = ipt_config.updated_by) as updated_by_name
            FROM ipt_config
            ORDER BY category, field1, field2
        `);
        res.json(configs.concat(await getPelanggaranConfigs()));
    } catch (error) {
        console.error('Error fetching IPT configurations:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get configurations by category
router.get('/category/:category', auth, superAdminOnly, async (req, res) => {
    try {
        const { category } = req.params;
        const [configs] = await db.query(`
            SELECT 
                id,
                category,
                field1,
                field2,
                point_value,
                description,
                is_active,
                created_at,
                updated_at,
                updated_by,
                (SELECT nama FROM users WHERE id = ipt_config.updated_by) as updated_by_name
            FROM ipt_config
            WHERE category = ?
            ORDER BY field1, field2
        `, [category]);
        res.json(category === 'pelanggaran' ? await getPelanggaranConfigs() : configs);
    } catch (error) {
        console.error('Error fetching IPT configurations by category:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get active configurations for calculation (public - can be used by all authenticated users)
router.get('/active', auth, async (req, res) => {
    try {
        const [configs] = await db.query(`
            SELECT category, field1, field2, point_value
            FROM ipt_config
            WHERE is_active = TRUE
            ORDER BY category, field1, field2
        `);
        
        // Group by category for easier access
        const grouped = {};
        const allConfigs = configs.concat(await getPelanggaranConfigs(true));
        allConfigs.forEach(config => {
            if (!grouped[config.category]) {
                grouped[config.category] = [];
            }
            grouped[config.category].push({
                field1: config.field1,
                field2: config.field2,
                point_value: config.point_value
            });

        });
        
        res.json(grouped);
    } catch (error) {
        console.error('Error fetching active IPT configurations:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/organisasi-options', auth, async (req, res) => {
    try {
        res.json((await getOrganisasiOptions()).filter(option => option.is_active));
    } catch (error) {
        console.error('Error fetching organisasi options:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/organisasi-options', auth, superAdminOnly, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: 'Nama organisasi wajib diisi' });
        const [result] = await db.query(
            'INSERT INTO ipt_organisasi (name, is_active) VALUES (?, TRUE)', [name.trim()]
        );
        const options = await getOrganisasiOptions();
        res.status(201).json(options.find(option => option.id === result.insertId));
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: 'Organisasi sudah terdaftar' });
        console.error('Error creating organisasi option:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/organisasi-options/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const [option] = await db.query('SELECT name FROM ipt_organisasi WHERE id = ?', [req.params.id]);
        if (!option.length) return res.status(404).json({ message: 'Organisasi tidak ditemukan' });
        const [configs] = await db.query(
            `SELECT COUNT(*) count FROM ipt_config WHERE category = 'organisasi' AND field1 = ?`,
            [option[0].name]
        );
        if (configs[0].count > 0) {
            return res.status(409).json({
                message: `Organisasi ${option[0].name} tidak dapat dihapus karena masih memiliki konfigurasi point IPT`
            });
        }
        await db.query('DELETE FROM ipt_organisasi WHERE id = ?', [req.params.id]);
        res.json({ message: 'Organisasi berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting organisasi option:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/perilaku-ratings', auth, async (req, res) => {
    try {
        res.json(await getPerilakuRatings(true));
    } catch (error) {
        console.error('Error fetching perilaku ratings:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/perilaku-ratings', auth, superAdminOnly, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: 'Nama tingkat penilaian wajib diisi' });
        const [result] = await db.query(
            'INSERT INTO ipt_perilaku_tingkat (name, is_active) VALUES (?, TRUE)', [name.trim()]
        );
        const options = await getPerilakuRatings();
        res.status(201).json(options.find(option => option.id === result.insertId));
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: 'Tingkat penilaian sudah terdaftar' });
        console.error('Error creating perilaku rating:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/perilaku-ratings/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const [option] = await db.query('SELECT name FROM ipt_perilaku_tingkat WHERE id = ?', [req.params.id]);
        if (!option.length) return res.status(404).json({ message: 'Tingkat penilaian tidak ditemukan' });
        // Tingkat dipakai bersama semua karakter (field1 format baru,
        // field2 format lama) -> tolak hapus bila masih dirujuk
        const [configs] = await db.query(
            `SELECT COUNT(*) count FROM ipt_config WHERE category = 'perilaku' AND (field1 = ? OR field2 = ?)`,
            [option[0].name, option[0].name]
        );
        if (configs[0].count > 0) {
            return res.status(409).json({
                message: `Tingkat penilaian ${option[0].name} tidak dapat dihapus karena masih memiliki konfigurasi point IPT`
            });
        }
        await db.query('DELETE FROM ipt_perilaku_tingkat WHERE id = ?', [req.params.id]);
        res.json({ message: 'Tingkat penilaian berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting perilaku rating:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ---- Batas minimum Total IPT per tingkat (X, XI, XII) ----
// Display-only setting: totals below the grade's threshold render red.
// 0 = nonaktif untuk tingkat tersebut. Missing grade rows fall back to the
// legacy single `min_ipt` row (if any), then 0 so existing deployments keep
// their current value for all grades until saved per grade here.
const MIN_IPT_CATEGORY = 'pengaturan';
const MIN_IPT_GRADES = ['X', 'XI', 'XII'];

// Dibaca semua role yang login dipakai untuk menandai total IPT di bawah batas (merah).
router.get('/min-ipt-per-grade', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT field1, point_value FROM ipt_config
             WHERE category = ? AND field1 IN ('min_ipt', 'min_ipt_X', 'min_ipt_XI', 'min_ipt_XII')`,
            [MIN_IPT_CATEGORY]
        );
        const byField = {};
        for (const row of rows) byField[row.field1] = parseInt(row.point_value, 10);
        const legacy = Number.isFinite(byField['min_ipt']) && byField['min_ipt'] > 0 ? byField['min_ipt'] : 0;
        const pick = (grade) => {
            const value = byField[`min_ipt_${grade}`];
            return Number.isFinite(value) && value >= 0 ? value : legacy;
        };
        res.json({ X: pick('X'), XI: pick('XI'), XII: pick('XII') });
    } catch (error) {
        console.error('Error fetching min IPT config:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Hanya superadmin yang boleh mengubah batas.
router.put('/min-ipt-per-grade', auth, superAdminOnly, async (req, res) => {
    try {
        const { X, XI, XII } = req.body || {};
        const values = { X, XI, XII };
        for (const grade of MIN_IPT_GRADES) {
            const value = Number(values[grade]);
            if (!Number.isInteger(value) || value < 0 || value > 100000) {
                return res.status(400).json({ message: `Batas minimum Kelas ${grade} harus bilangan bulat 0 - 100000` });
            }
        }

        const userId = req.user.id;
        for (const grade of MIN_IPT_GRADES) {
            const field = `min_ipt_${grade}`;
            const [existing] = await db.query(
                'SELECT id FROM ipt_config WHERE category = ? AND field1 = ? ORDER BY id LIMIT 1',
                [MIN_IPT_CATEGORY, field]
            );
            if (existing.length) {
                await db.query(
                    'UPDATE ipt_config SET point_value = ?, is_active = TRUE, updated_by = ? WHERE id = ?',
                    [Number(values[grade]), userId, existing[0].id]
                );
            } else {
                await db.query(
                    `INSERT INTO ipt_config (category, field1, field2, field3, point_value, description, is_active, updated_by)
                     VALUES (?, ?, NULL, NULL, ?, ?, TRUE, ?)`,
                    [MIN_IPT_CATEGORY, field, Number(values[grade]),
                     `Batas minimum Total IPT Kelas ${grade} - total di bawah nilai ini ditampilkan merah (0 = nonaktif)`,
                     userId]
                );
            }
        }

        clearConfigCache();
        res.json({ X: Number(values.X), XI: Number(values.XI), XII: Number(values.XII) });
    } catch (error) {
        console.error('Error updating min IPT config:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ---- IPT awal defaults per grade (X, XI, XII) ----
// Readable by all logged-in users; only superadmin may change (PUT below).
// Missing rows fall back to 80 (matches users.ipt_awal column default).
router.get('/ipt-awal-per-grade', auth, async (req, res) => {
    try {
        res.json(await getIptAwalPerGrade());
    } catch (error) {
        console.error('Error fetching IPT awal per grade:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Save all three grade defaults at once. Does NOT touch existing students
// the Edit IPT Awal page applies values to current students via bulk-update.
router.put('/ipt-awal-per-grade', auth, superAdminOnly, async (req, res) => {
    try {
        const { X, XI, XII } = req.body || {};
        const values = { X, XI, XII };
        for (const grade of IPT_AWAL_GRADES) {
            const value = Number(values[grade]);
            if (!Number.isInteger(value) || value < 0 || value > 100000) {
                return res.status(400).json({ message: `IPT awal Kelas ${grade} harus bilangan bulat 0 - 100000` });
            }
        }

        const userId = req.user.id;
        for (const grade of IPT_AWAL_GRADES) {
            const field = `ipt_awal_${grade}`;
            const [existing] = await db.query(
                'SELECT id FROM ipt_config WHERE category = ? AND field1 = ? ORDER BY id LIMIT 1',
                ['pengaturan', field]
            );
            if (existing.length) {
                await db.query(
                    'UPDATE ipt_config SET point_value = ?, is_active = TRUE, updated_by = ? WHERE id = ?',
                    [Number(values[grade]), userId, existing[0].id]
                );
            } else {
                await db.query(
                    `INSERT INTO ipt_config (category, field1, field2, field3, point_value, description, is_active, updated_by)
                     VALUES (?, ?, NULL, NULL, ?, ?, TRUE, ?)`,
                    ['pengaturan', field, Number(values[grade]),
                     `IPT awal default untuk siswa Kelas ${grade}`,
                     userId]
                );
            }
        }

        clearConfigCache();
        res.json(await getIptAwalPerGrade());
    } catch (error) {
        console.error('Error updating IPT awal per grade:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get single configuration
router.get('/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const pelanggaranId = parsePelanggaranId(id);
        if (pelanggaranId) {
            const configs = await getPelanggaranConfigs();
            const config = configs.find(item => item.id === id);
            return config ? res.json(config) : res.status(404).json({ message: 'Configuration not found' });
        }
        const [configs] = await db.query(`
            SELECT 
                id,
                category,
                field1,
                field2,
                point_value,
                description,
                is_active,
                created_at,
                updated_at,
                updated_by,
                (SELECT nama FROM users WHERE id = ipt_config.updated_by) as updated_by_name
            FROM ipt_config
            WHERE id = ?
        `, [id]);
        
        if (configs.length === 0) {
            return res.status(404).json({ message: 'Configuration not found' });
        }
        
        res.json(configs[0]);
    } catch (error) {
        console.error('Error fetching IPT configuration:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create new configuration
router.post('/', auth, superAdminOnly, async (req, res) => {
    try {
        const { category, field1, field2, point_value, description, is_active } = req.body;
        const userId = req.user.id;
        if (category === 'pelanggaran') {
            if (field2) {
                if (!field1 || !String(field1).trim()) {
                    return res.status(400).json({ message: 'Detail pelanggaran wajib diisi' });
                }
                const [level] = await db.query('SELECT id FROM ipt_pelanggaran_level WHERE name = ?', [field2]);
                if (!level.length) return res.status(400).json({ message: 'Violation level not found' });
                const [result] = await db.query(
                    'INSERT INTO ipt_pelanggaran_detail (name, level_id, is_active) VALUES (?, ?, ?)',
                    [String(field1).trim(), level[0].id, is_active !== undefined ? is_active : true]
                );
                clearConfigCache();
                return res.status(201).json((await getPelanggaranConfigs()).find(item => item.id === `detail-${result.insertId}`));
            }
            if (!field1 || !String(field1).trim()) {
                return res.status(400).json({ message: 'Tingkat pelanggaran wajib diisi' });
            }
            const levelPoint = Number(point_value);
            if (!Number.isFinite(levelPoint) || levelPoint >= 0) {
                return res.status(400).json({ message: 'Point pelanggaran harus negatif (< 0)' });
            }
            const [result] = await db.query(
                'INSERT INTO ipt_pelanggaran_level (name, point_value, description, is_active) VALUES (?, ?, ?, ?)',
                [String(field1).trim(), levelPoint, description || null, is_active !== undefined ? is_active : true]
            );
            clearConfigCache();
            return res.status(201).json((await getPelanggaranConfigs()).find(item => item.id === `level-${result.insertId}`));
        }
        
        if (!category || !field1 || point_value === undefined) {
            return res.status(400).json({ message: 'Category, field1, and point_value are required' });
        }
        
        const [result] = await db.query(`
            INSERT INTO ipt_config (category, field1, field2, point_value, description, is_active, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [category, field1, field2 || null, point_value, description || null, is_active !== undefined ? is_active : true, userId]);
        
        clearConfigCache();
        const [newConfig] = await db.query('SELECT id, category, field1, field2, field3, point_value, description, is_active, created_at, updated_at, updated_by FROM ipt_config WHERE id = ?', [result.insertId]);
        res.status(201).json(newConfig[0]);
    } catch (error) {
        console.error('Error creating IPT configuration:', error);
        if (error.code === '23505') {
            if (req.body?.category === 'pelanggaran' && req.body?.field2) {
                return res.status(400).json({ message: 'Detail pelanggaran sudah ada' });
            }
            return res.status(400).json({ message: 'Configuration with this category, field1, and field2 already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// Update configuration
router.put('/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { category, field1, field2, point_value, description, is_active } = req.body;
        const userId = req.user.id;
        const pelanggaranId = parsePelanggaranId(id);
        if (pelanggaranId) {
            if (pelanggaranId.type === 'level') {
                if (point_value !== undefined) {
                    const lvlPoint = Number(point_value);
                    if (!Number.isFinite(lvlPoint) || lvlPoint >= 0) {
                        return res.status(400).json({ message: 'Point pelanggaran harus negatif (< 0)' });
                    }
                }
                const sets = [];
                const values = [];
                if (point_value !== undefined) { sets.push('point_value = ?'); values.push(Number(point_value)); }
                if (description !== undefined) { sets.push('description = ?'); values.push(description ?? null); }
                if (is_active !== undefined) { sets.push('is_active = ?'); values.push(is_active); }
                if (sets.length) {
                    values.push(pelanggaranId.value);
                    await db.query(`UPDATE ipt_pelanggaran_level SET ${sets.join(', ')} WHERE id = ?`, values);
                    clearConfigCache();
                }
                return res.json((await getPelanggaranConfigs()).find(item => item.id === id));
            }

            // Detail pelanggaran: boleh pindah tingkat (field2) dan/atau toggle aktif
            const detailSets = [];
            const detailValues = [];
            if (field2 !== undefined && field2 !== null && String(field2).trim() !== '') {
                const [lvl] = await db.query('SELECT id FROM ipt_pelanggaran_level WHERE name = ?', [String(field2).trim()]);
                if (!lvl.length) {
                    return res.status(400).json({ message: 'Tingkat pelanggaran tidak ditemukan' });
                }
                detailSets.push('level_id = ?');
                detailValues.push(lvl[0].id);
            }
            if (is_active !== undefined) {
                detailSets.push('is_active = ?');
                detailValues.push(is_active);
            }
            if (detailSets.length) {
                detailValues.push(pelanggaranId.value);
                await db.query(`UPDATE ipt_pelanggaran_detail SET ${detailSets.join(', ')} WHERE id = ?`, detailValues);
                clearConfigCache();
            }
            return res.json((await getPelanggaranConfigs()).find(item => item.id === id));
        }
        
        // Check if configuration exists
        const [existing] = await db.query('SELECT id, category, field1, field2, field3, point_value, description, is_active, created_at, updated_at, updated_by FROM ipt_config WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Configuration not found' });
        }

        // Point pelanggaran (termasuk baris legacy di ipt_config) harus negatif
        const targetCategory = category || existing[0].category;
        if (targetCategory === 'pelanggaran' && point_value !== undefined) {
            const pv = Number(point_value);
            if (!Number.isFinite(pv) || pv >= 0) {
                return res.status(400).json({ message: 'Point pelanggaran harus negatif (< 0)' });
            }
        }
        
        await db.query(`
            UPDATE ipt_config
            SET category = ?, field1 = ?, field2 = ?, point_value = ?, description = ?, is_active = ?, updated_by = ?
            WHERE id = ?
        `, [
            category || existing[0].category,
            field1 || existing[0].field1,
            field2 !== undefined ? field2 : existing[0].field2,
            point_value !== undefined ? point_value : existing[0].point_value,
            description !== undefined ? description : existing[0].description,
            is_active !== undefined ? is_active : existing[0].is_active,
            userId,
            id
        ]);
        
        clearConfigCache();
        const [updatedConfig] = await db.query('SELECT id, category, field1, field2, field3, point_value, description, is_active, created_at, updated_at, updated_by FROM ipt_config WHERE id = ?', [id]);
        res.json(updatedConfig[0]);
    } catch (error) {
        console.error('Error updating IPT configuration:', error);
        if (error.code === '23505') {
            return res.status(400).json({ message: 'Configuration with this category, field1, and field2 already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete configuration
router.delete('/:id', auth, superAdminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const pelanggaranId = parsePelanggaranId(id);
        if (pelanggaranId) {
            const table = pelanggaranId.type === 'level' ? 'ipt_pelanggaran_level' : 'ipt_pelanggaran_detail';
            const [result] = await db.query(`DELETE FROM ${table} WHERE id = ?`, [pelanggaranId.value]);
            if (result.affectedRows) {
                clearConfigCache();
                return res.json({ message: 'Configuration deleted successfully' });
            }
            return res.status(404).json({ message: 'Configuration not found' });
        }
        
        const [result] = await db.query('DELETE FROM ipt_config WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Configuration not found' });
        }
        
        clearConfigCache();
        res.json({ message: 'Configuration deleted successfully' });
    } catch (error) {
        console.error('Error deleting IPT configuration:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete all configurations by category
router.delete('/all/:category', auth, superAdminOnly, async (req, res) => {
    try {
        const { category } = req.params;

        if (category === 'pelanggaran') {
            await db.query('DELETE FROM ipt_pelanggaran_detail');
            await db.query('DELETE FROM ipt_pelanggaran_level');
        } else {
            await db.query('DELETE FROM ipt_config WHERE category = ?', [category]);
        }

        clearConfigCache();
        res.json({ message: `All ${category} configurations deleted successfully` });
    } catch (error) {
        console.error('Error deleting IPT configurations by category:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
