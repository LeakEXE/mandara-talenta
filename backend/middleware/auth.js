const jwt = require('jsonwebtoken');
const db = require('../config/database');

const auth = async (req, res, next) => {
    try {
        // First try to get token from HTTP-only cookie
        let token = req.cookies.token;
        
        // Fallback to Authorization header for backward compatibility during transition
        if (!token) {
            token = req.header('Authorization')?.replace('Bearer ', '');
        }
        
        if (!token) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Tokens issued before 'nama' was added to the JWT payload don't have it;
        // fetch it once from the DB so req.user.nama is never undefined.
        // (New tokens include nama, so this query only runs for old tokens.)
        if (decoded.nama === undefined) {
            const [rows] = await db.query('SELECT nama FROM users WHERE id = ?', [decoded.id]);
            if (rows.length > 0) {
                decoded.nama = rows[0].nama;
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
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
        const token = req.cookies?.token || req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Token is not valid' });
        }
        req.user = decoded;
        const [rows] = await db.query(
            'SELECT must_change_credentials FROM users WHERE id = ?',
            [decoded.id]
        );
        if (rows.length > 0 && (rows[0].must_change_credentials === true || rows[0].must_change_credentials === 1)) {
            return res.status(403).json({
                message: 'Anda harus mengganti username dan password terlebih dahulu',
                mustChangeCredentials: true
            });
        }
        next();
    } catch (error) {
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
      
      // For students, they don't have access to pelanggaran/perilaku
      if (userRole === 'siswa' && (permissionType === 'pelanggaran' || permissionType === 'perilaku')) {
        return res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengakses halaman ini.' });
      }
      
      // For teachers and pegawai, check individual permission
      if ((userRole === 'guru' || userRole === 'pegawai') && (permissionType === 'pelanggaran' || permissionType === 'perilaku')) {
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
      
      // Students never get access to pelanggaran/perilaku (guru-only input),
      // mirroring checkPermission above regardless of any stored permission flags.
      if (userRole === 'siswa' && (jenisInput === 'pelanggaran' || jenisInput === 'perilaku')) {
        return res.status(403).json({ 
          message: `Anda tidak memiliki izin untuk input data ${jenisInput}. Silakan hubungi SuperAdmin.` 
        });
      }
      
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

module.exports = { auth, superAdminOnly, approverOnly, approverFor, getApprovalScopes, APPROVAL_TYPES, enforceCredentialsChanged, teacherOrSuperAdmin, teacherOnly, checkInputAccess, checkPermission };
