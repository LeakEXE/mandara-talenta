const io = require('@pm2/io');
io.init({
  metrics: {
    eventLoop: true,
    http: true,
    runtime: true,
    // NOTE: network meter intentionally OFF. @pm2/io's network metric wraps
    // net.Socket.prototype.read and adds a new 'data' listener on EVERY read
    // without ever removing it (network.js in @pm2/io). Under keep-alive load
    // (k6 reuses sockets heavily) this piles listeners onto one socket and
    // trips "MaxListenersExceededWarning: 11 data listeners added to [Socket]".
    // Re-enable only if that upstream leak is fixed.
    network: false
  }
});

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { enforceCredentialsChanged } = require('./middleware/auth');
const { UPLOAD_DIR } = require('./utils/paths');
const {
  securityHeaders,
  sqlInjectionPrevention, 
  xssPrevention, 
  sanitizeInput, 
  errorHandler,
  securityLogger
} = require('./middleware/security');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Prometheus scrape endpoint for the Grafana stack. Mounted before rate
// limiting and auth so the scraper is never blocked or challenged.
// Scrape target: http://<host>:5000/metrics
const { httpMetricsMiddleware, metricsAuth, metricsHandler } = require('./utils/prometheus');
app.get('/metrics', metricsAuth, metricsHandler);
app.use(httpMetricsMiddleware);

// Trust proxy: express-rate-limit needs this whenever an upstream proxy sets
// X-Forwarded-For (CRA dev proxy, nginx, ...), otherwise it throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and can't identify users accurately.
// - Development: ON (1 hop = CRA dev proxy).
// - Production: OFF by default so clients can't spoof IPs to dodge rate
//   limits; set TRUST_PROXY=1 (or hop count) only if actually behind a proxy.
if (process.env.TRUST_PROXY !== undefined) {
  app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? parseInt(process.env.TRUST_PROXY, 10) : true);
} else if (process.env.NODE_ENV !== 'production') {
  app.set('trust proxy', 1);
}

// Security Middleware - Security headers (Helmet)
app.use(securityHeaders);

// NOTE: no global rate/speed limiting. The whole school sits behind one NAT
// IP, so per-IP budgets (previously 100 req/min) throttled legitimate users.
// Brute-force protection lives on the login route itself (see routes/auth.js).

// Security Middleware - Request logging for security audit
app.use(securityLogger);

// Security Middleware - SQL Injection prevention
app.use(sqlInjectionPrevention);

// Security Middleware - XSS prevention
app.use(xssPrevention);

// Security Middleware - Input sanitization
app.use(sanitizeInput);

// CORS - Allow requests from same origin or configured origins
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // In development, allow all
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, check allowed origins
    const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://202.162.215.133:3000',
      'http://202.162.215.133'
    ]).map((s) => s.trim()).filter(Boolean);

    // Allow if origin is in allowed list or same host, different port.
    // URL parsing is guarded: a malformed entry must deny, never 500.
    const isAllowed = allowedOrigins.some((allowed) => {
      // Exact match
      if (allowed === origin) return true;
      try {
        const allowedUrl = new URL(allowed);
        const originUrl = new URL(origin);
        return allowedUrl.hostname === originUrl.hostname;
      } catch {
        console.error(`[CORS] skipping malformed allowed origin: "${allowed}"`);
        return false;
      }
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.error(`[CORS] rejected origin "${origin}" (allowed: ${allowedOrigins.join(', ') || '(none)'})`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser middleware - required for HTTP-only cookie authentication
app.use(cookieParser());

// First-login enforcement: users flagged must_change_credentials can only
// reach login/logout plus the credential-setup endpoints (see middleware/auth.js)
app.use(enforceCredentialsChanged);

// Static folder for uploads - with CORS headers for images
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(UPLOAD_DIR));

// Cache policy for the built frontend:
// - CRA content-hashes filenames under /static/, so those can be cached forever.
// - Everything else (index.html, manifest.json, icons, logos) keeps stable URLs,
//   so it must revalidate after every deploy. Without this, browsers can keep
//   showing an old favicon/PWA icon even though the file on disk changed.
const setFrontendCacheHeaders = (res, filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/static/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
};

// Serve React frontend static files (consolidated deployment)
const frontendBuildPath = path.join(__dirname, '../frontend/build');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath, { setHeaders: setFrontendCacheHeaders }));
  console.log('Serving React frontend from:', frontendBuildPath);
} else {
  console.warn('Frontend build directory not found at:', frontendBuildPath);
  console.warn('Please run "npm run build" in the frontend directory first');
}

// Routes - per-route limiters live inside ./routes/auth (login/forgot);
// mounting the limiter here would make them share one budget.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/prestasi', require('./routes/prestasi'));
app.use('/api/organisasi', require('./routes/organisasi'));
app.use('/api/kepanitiaan', require('./routes/kepanitiaan'));
app.use('/api/event', require('./routes/event'));
app.use('/api/pelanggaran', require('./routes/pelanggaran'));
app.use('/api/perilaku', require('./routes/perilaku'));
app.use('/api/approvals', require('./routes/approvals'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/input-access', require('./routes/input-access'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/wali-kelas', require('./routes/waliKelas'));
app.use('/api/search', require('./routes/search'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/file-viewer', require('./routes/file-viewer'));
app.use('/api/academic-year', require('./routes/academicYear'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/ipt-config', require('./routes/iptConfig'));
// Deprecated alias: pre-rebrand clients may still call /api/ipc-config.
app.use('/api/ipc-config', require('./routes/iptConfig'));
app.use('/api/school-config', require('./routes/school-config'));

// Catch-all route for React SPA client-side routing (must be after API routes)
app.get('*', (req, res) => {
  // Skip API routes and static file routes
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ message: 'Not found' });
  }
  
  // Skip favicon requests
  if (req.path === '/favicon.ico') {
    return res.status(404).end();
  }
  
  const frontendBuildPath = path.join(__dirname, '../frontend/build');
  const indexPath = path.join(frontendBuildPath, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    // SPA entry point: always revalidate so a new deploy is picked up.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ message: 'Frontend build not found. Please run "npm run build" in the frontend directory.' });
  }
});

// Global error handler - Security: Don't expose internal details
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // Listen on all interfaces for cross-device access

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Access from other devices using your computer's IP address`);
    console.log(`Security middleware active: Helmet, Rate Limiting, SQL Injection Prevention, XSS Prevention`);
});
