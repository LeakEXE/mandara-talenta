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

// Load environment before local modules that read process.env at require time
// (security headers, upload paths, database pool).
dotenv.config({ path: path.join(__dirname, '.env') });

const { enforceCredentialsChanged, authForUploads } = require('./middleware/auth');
const { UPLOAD_DIR } = require('./utils/paths');
const {
  securityHeaders,
  errorHandler,
  securityLogger
} = require('./middleware/security');

const app = express();

// hCaptcha is mandatory on login. If either backend key is missing, login
// fails closed with 503 rather than silently disabling the CAPTCHA.
if (process.env.NODE_ENV === 'production'
  && (!process.env.HCAPTCHA_SITE_KEY || !process.env.HCAPTCHA_SECRET_KEY)) {
  console.error('[security] HCAPTCHA_SITE_KEY / HCAPTCHA_SECRET_KEY is missing; login will fail closed.');
}

// Prometheus scrape endpoint for the Grafana stack. Mounted before rate
// limiting and auth so the scraper is never blocked or challenged.
// Scrape target: http://<host>:5000/metrics
const { httpMetricsMiddleware, metricsAuth, metricsHandler } = require('./utils/prometheus');
app.get('/metrics', metricsAuth, metricsHandler);
app.use(httpMetricsMiddleware);

// Trust proxy: Cloudflare Tunnel is the only ingress. cloudflared runs on a
// separate LAN host and sets X-Forwarded-For / CF-Connecting-IP, so one trusted
// hop is required for express-rate-limit to see the real client IP.
// IMPORTANT: this is safe only while ports 3000/5000 are firewalled to the
// cloudflared host. A directly-connected LAN client could otherwise spoof the
// forwarded headers. `TRUST_PROXY=false` is supported for unusual local-only
// setups; any other non-numeric value is rejected rather than silently
// trusting every proxy.
if (process.env.TRUST_PROXY === undefined || process.env.TRUST_PROXY === '') {
  app.set('trust proxy', 1);
} else if (/^\d+$/.test(process.env.TRUST_PROXY)) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10));
} else if (process.env.TRUST_PROXY === 'false') {
  app.set('trust proxy', false);
} else {
  console.warn('[security] Invalid TRUST_PROXY value; using 1 trusted hop');
  app.set('trust proxy', 1);
}

// Security Middleware - Security headers (Helmet)
app.use(securityHeaders);

// API responses contain user-specific data and must not be stored by browser
// or intermediary caches. The public logo route overrides this with its own
// short-lived public cache policy.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CORS - allow only explicit origins in production. In development all
// origins are allowed for convenience. Origin matching is exact
// (scheme + host + port), not hostname-only.
const CORS_PUBLIC_ORIGIN = 'https://talenta.skanbara.my.id';
const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => normalizeOrigin(value.trim()))
  .filter(Boolean);

const productionOrigins = [...new Set([
  CORS_PUBLIC_ORIGIN,
  ...configuredOrigins.filter((origin) => origin.startsWith('https://'))
])];

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (server-to-server, curl, mobile apps).
    if (!origin) return callback(null, true);

    // Development: keep the existing permissive behavior.
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    const normalized = normalizeOrigin(origin);
    if (normalized && productionOrigins.includes(normalized)) {
      return callback(null, true);
    }

    console.error(`[CORS] rejected origin "${origin}" (allowed: ${productionOrigins.join(', ') || '(none)'})`);
    const error = new Error('Not allowed by CORS');
    error.status = 403;
    callback(error);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// Body parsing must run before validation/logging middleware that inspects
// req.body. Do NOT reintroduce HTML-escaping input filters here: output
// encoding belongs at render time, and escaping passwords breaks login.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser middleware - required for HTTP-only cookie authentication
app.use(cookieParser());

// Request logging for security audit (after body parsing, with redaction)
app.use(securityLogger);

// First-login enforcement: users flagged must_change_credentials can only
// reach login/logout plus the credential-setup endpoints (see middleware/auth.js)
app.use(enforceCredentialsChanged);

// Uploads contain student evidence: require a valid session and keep them
// same-origin. Express/Helmet supplies the security headers; no wildcard CORS.
app.use('/uploads', authForUploads, (req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
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
// cloudflared runs on another LAN host, so it must reach this app over the
// LAN. Set HOST to this server's LAN IP (preferred) or 0.0.0.0, and firewall
// port 5000 so only the cloudflared host can connect. The 127.0.0.1 default
// remains for local-only development.
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Security middleware active: Helmet, rate limiting, request redaction`);
});
