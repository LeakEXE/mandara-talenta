const jwt = require('jsonwebtoken');
const db = require('../config/database');

const getRequestToken = (req) => {
    let token = req.cookies?.token;
    if (!token) {
        token = req.header('Authorization')?.replace('Bearer ', '');
    }
    return token;
};

const auth = async (req, res, next) => {
    const token = getRequestToken(req);
    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: 'Token is not valid' });
    }

    try {
        // enforceCredentialsChanged() runs before API routes and refreshes
        // role/nama from the database. For routes it skips (profile/setup),
        // fetch the current values here so demotions still take effect.
        if (req.authFresh && req.user?.id === decoded.id) {
            decoded.role = req.user.role;
            decoded.nama = req.user.nama;
        } else {
            const [rows] = await db.query(
                'SELECT role, nama FROM users WHERE id = ?',
                [decoded.id]
            );
            if (rows.length === 0) {
                return res.status(401).json({ message: 'Token is not valid' });
            }
            decoded.role = rows[0].role;
            decoded.nama = rows[0].nama;
        }

        req.user = decoded;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Lightweight auth for /uploads: images/PDFs only need a valid session, not a
// fresh role lookup on every file request. API routes use auth() + the global
// enforceCredentialsChanged() role refresh instead.
const authForUploads = (req, res, next) => {
    const token = getRequestToken(req);
    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

// Paths that stay reachable while must_change_credentials is set:
// login/logout plus reading + completing the first-login setup itself.
const CREDENTIAL_SETUP_PATHS = new Set([
    '/api/auth/login',
    '/api/auth/logout',
    '/api/profile/change-password',
    '/api/profile/username',
    '/api/profile/check-username'
]);

// Paths reachable without any session at all (the login page fetches these
// before the user authenticates e.g. school branding for the logo).
const PUBLIC_PATHS = new Set([
    '/api/school-config/public',
    '/api/school-config/public/logo',
    '/api/auth/forgot-password'
]);

// Blocks every /api call (except the setup paths above and GET /api/profile)
// for users that still must change their credentials on first login.
// Must be mounted globally AFTER cookie parsing. Verifies the JWT inline
// (instead of reusing auth()) so failed auth always terminates the request.
const enforceCredentialsChanged = async (req, res, next) => {
    try {
        if (!req.path.startsWith('/api/')) {
            return next();
        }
        if (CREDENTIAL_SETUP_PATHS.has(req.path) || PUBLIC_PATHS.has(req.path)) {
            return next();
        }
        if (req.method === 'GET' && req.path === '/api/profile') {
            return next();
        }
        const token = getRequestToken(req);
        if (!token) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Token is not valid' });
        }
        const [rows] = await db.query(
            'SELECT role, nama, must_change_credentials FROM users WHERE id = ?',
            [decoded.id]
        );
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Token is not valid' });
        }

        // Refresh role/nama from the database so role changes take effect
        // immediately instead of waiting for the 24h JWT to expire.
        req.user = {
            ...decoded,
            role: rows[0].role,
            nama: rows[0].nama
        };
        req.authFresh = true;

        if (rows[0].must_change_credentials === true || rows[0].must_change_credentials === 1) {
            return res.status(403).json({
                message: 'Anda harus mengganti username dan password terlebih dahulu',
                mustChangeCredentials: true
            });
        }
        next();
    } catch (error) {
        console.error('Credential enforcement error:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Server error' });
        }
    }
};

// Middleware to check if user has permission for specific input type
const checkPermission = (permissionType) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      // Superadmin always has access
      if (userRole === 'superadmin') {
        return next();
      }
      
      // Perilaku stays guru/pegawai-only; pelanggaran may also be granted to students.
      if (userRole === 'siswa' && permissionType === 'perilaku') {
        return res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengakses halaman ini.' });
      }
      
      // For pelanggaran/perilaku, require an explicit individual permission
      // (applies to students as well as teachers/pegawai).
      if (permissionType === 'pelanggaran' || permissionType === 'perilaku') {
        const [permissions] = await db.query(
          `SELECT can_input_${permissionType} as has_permission FROM permissions WHERE user_id = ?`,
          [userId]
        );
        
        const hasPermission = permissions.length > 0 ? permissions[0].has_permission : false;
        
        if (!hasPermission) {
          return res.status(403).json({ 
            message: `Anda tidak memiliki izin untuk input data ${permissionType}. Silakan hubungi SuperAdmin.` 
          });
        }
      }
      
      next();
    } catch (error) {
      console.error('Error checking permission:', error);
      res.status(500).json({ message: 'Server error' });
    }
  };
};

const superAdminOnly = (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied. Superadmin only.' });
    }
    next();
};

// Superadmin OR staff explicitly granted approval scope(s).
// (approval_scopes.jenis, managed by superadmin in Izin Akun).
// Siswa can never approve, even if a scope row were ever set.
const APPROVAL_TYPES = ['prestasi', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran'];

async function getApprovalScopes(userId) {
    const [rows] = await db.query(
        'SELECT jenis FROM approval_scopes WHERE user_id = ?',
        [userId]
    );
    return rows.map((r) => r.jenis);
}

// General gate: caller must hold at least one approval scope.
// (Used by /pending-count and /all, which span multiple types.)
const approverOnly = async (req, res, next) => {
    try {
        if (req.user.role === 'superadmin') {
            return next();
        }
        if (req.user.role === 'siswa') {
            return res.status(403).json({ message: 'Access denied. Approval permission required.' });
        }
        const scopes = await getApprovalScopes(req.user.id);
        if (scopes.length === 0) {
            return res.status(403).json({ message: 'Access denied. Approval permission required.' });
        }
        req.approvalScopes = scopes;
        next();
    } catch (error) {
        console.error('Error checking approval permission:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Type-specific gate for routes like PUT /approvals/superadmin/:type/:id.
// Non-superadmin callers must hold the scope for that exact type.
const approverFor = (paramName = 'type') => {
    return async (req, res, next) => {
        try {
            if (req.user.role === 'superadmin') {
                return next();
            }
            const type = req.params[paramName];
            if (!APPROVAL_TYPES.includes(type)) {
                return res.status(400).json({ message: 'Invalid approval type' });
            }
            const scopes = await getApprovalScopes(req.user.id);
            if (!scopes.includes(type)) {
                return res.status(403).json({ message: `Anda tidak memiliki izin menyetujui pengajuan ${type}.` });
            }
            req.approvalScopes = scopes;
            next();
        } catch (error) {
            console.error('Error checking approval permission:', error);
            res.status(500).json({ message: 'Server error' });
        }
    };
};

const teacherOrSuperAdmin = (req, res, next) => {
    if (req.user.role !== 'superadmin' && req.user.role !== 'guru' && req.user.role !== 'pegawai') {
        return res.status(403).json({ message: 'Access denied. Teacher or Superadmin only.' });
    }
    next();
};

const teacherOnly = (req, res, next) => {
    if (req.user.role !== 'guru' && req.user.role !== 'pegawai') {
        return res.status(403).json({ message: 'Access denied. Teachers only.' });
    }
    next();
};

// Middleware to check input access permission
const checkInputAccess = (jenisInput) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      // Superadmin always has access
      if (userRole === 'superadmin') {
        return next();
      }
      
      // Perilaku stays guru/pegawai-only regardless of any stored permission flags.
      if (userRole === 'siswa' && jenisInput === 'perilaku') {
        return res.status(403).json({ 
          message: `Anda tidak memiliki izin untuk input data ${jenisInput}. Silakan hubungi SuperAdmin.` 
        });
      }

      // Pelanggaran is opt-in for students: it must be granted explicitly as an
      // individual permission in Izin Akun. A missing/neutral individual flag does
      // NOT fall through to the role/global switch, so students never receive it
      // by default (new accounts included).
      const requiresIndividualGrant = userRole === 'siswa' && jenisInput === 'pelanggaran';
      
      // Check global access status
      const [globalControl] = await db.query(
        'SELECT is_enabled FROM input_access_control WHERE control_type = ? AND jenis_input = ?',
        ['global', jenisInput]
      );
      
      // Check role-based access
      const [roleControl] = await db.query(
        'SELECT is_enabled FROM input_access_control WHERE control_type = ? AND role_target = ? AND jenis_input = ?',
        ['role', userRole, jenisInput]
      );
      
      // Check individual permission
      const [individualPerm] = await db.query(
        `SELECT can_input_${jenisInput} as has_permission FROM permissions WHERE user_id = ?`,
        [userId]
      );
      
      // Priority: Individual > Role > Global
      let hasAccess = true;
      let accessSource = 'default';
      
      const permValue = individualPerm.length > 0 ? individualPerm[0].has_permission : null;
      
      // Explicitly check: true/1 = allow, false/0 = deny, null/undefined = fall through
      if (permValue === true || permValue === 1) {
        hasAccess = true;
        accessSource = 'individual';
      } else if (permValue === false || permValue === 0) {
        hasAccess = false;
        accessSource = 'individual';
      } else if (requiresIndividualGrant) {
        hasAccess = false;
        accessSource = 'individual-required';
      } else if (roleControl.length > 0) {
        hasAccess = roleControl[0].is_enabled;
        accessSource = 'role';
      } else if (globalControl.length > 0) {
        hasAccess = globalControl[0].is_enabled;
        accessSource = 'global';
      }
      
      console.log(`[Access Check] User ${userId} (${userRole}) - ${jenisInput}: ${hasAccess} (source: ${accessSource})`);
      console.log(`  - Individual: ${permValue !== null ? permValue : 'null'}`);
      console.log(`  - Role (${userRole}): ${roleControl.length > 0 ? roleControl[0].is_enabled : 'not set'}`);
      console.log(`  - Global: ${globalControl.length > 0 ? globalControl[0].is_enabled : 'not set'}`);
      
      if (!hasAccess) {
        return res.status(403).json({ 
          message: `Anda tidak memiliki izin untuk input data ${jenisInput}. Silakan hubungi SuperAdmin.` 
        });
      }
      
      next();
    } catch (error) {
      console.error('Error checking input access:', error);
      // If there's an error checking, allow access (fail open for better UX)
      next();
    }
  };
};

module.exports = { auth, authForUploads, superAdminOnly, approverOnly, approverFor, getApprovalScopes, APPROVAL_TYPES, enforceCredentialsChanged, teacherOrSuperAdmin, teacherOnly, checkInputAccess, checkPermission };
