const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// A 5xx means the server or a dependency (hCaptcha, database) failed, not that
// the submitted credentials were wrong. Do not spend the failed-credential
// budget on those responses. 429 is still counted so a limiter cannot reset
// its own budget by answering with 429.
const didNotFailCredentials = (req, res) => (
  res.statusCode < 400 || res.statusCode >= 500
);

// Rate limiting for login attempts - per source IP.
// `trust proxy` is configured in server.js so this sees the real client IP
// behind Cloudflare Tunnel instead of the local tunnel address.
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 100, // limit each IP to 100 FAILED login attempts per windowMs
  message: {
    message: 'Terlalu banyak percobaan login, coba lagi setelah 15 menit'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  requestWasSuccessful: didNotFailCredentials
});

// Second login budget keyed by username. This catches distributed attempts
// against one account while the IP limiter catches attempts from one source.
const loginAccountLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 20, // failed attempts per username per windowMs
  message: {
    message: 'Terlalu banyak percobaan login untuk akun ini, coba lagi setelah 15 menit'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: didNotFailCredentials,
  keyGenerator: (req) => {
    const username = typeof req.body?.username === 'string'
      ? req.body.username.trim().toLowerCase().slice(0, 100)
      : '';
    // Missing usernames share one bucket; malformed requests are still counted.
    return username || 'unknown-username';
  }
});

// Outage-only safety valve: when hCaptcha or the database is down, login
// returns 5xx and the credential limiters intentionally ignore it. This short
// window still caps how many failing login requests one IP can make, without
// locking users out for 15 minutes after the dependency recovers.
const loginOutageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    message: 'Layanan login sedang sibuk, coba lagi sebentar lagi'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Count only service failures (and the limiter's own 429). Normal 4xx
  // credential failures are already covered by loginLimiter.
  requestWasSuccessful: (req, res) => res.statusCode < 500 && res.statusCode !== 429
});

// Forgot-password is public, so give it a small IP budget in addition to the
// per-account cooldown in routes/auth.js.
const forgotPasswordLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 10,
  message: {
    message: 'Terlalu banyak permintaan reset password, coba lagi nanti'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Security headers configuration.
// The public site is served over HTTPS by Cloudflare Tunnel even though the
// local origin is HTTP. `useDefaults: false` keeps Helmet from adding
// `upgrade-insecure-requests` during local HTTP development; it is added only
// in production.
const isProduction = process.env.NODE_ENV === 'production';

// Official hCaptcha CSP guidance: use the wildcard domains, never hard-code
// region-specific asset subdomains such as newassets.hcaptcha.com.
const HCAPTCHA_CSP_SOURCES = ['https://hcaptcha.com', 'https://*.hcaptcha.com'];

const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", ...HCAPTCHA_CSP_SOURCES],
      scriptSrc: ["'self'", ...HCAPTCHA_CSP_SOURCES],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...HCAPTCHA_CSP_SOURCES],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      // Allow blob: so client-generated PDF previews (URL.createObjectURL)
      // can render in <iframe>. frameAncestors is 'self' (not 'none') so our
      // own EvidenceViewer iframes may embed /uploads PDFs; external sites
      // still cannot frame this app (clickjacking protection intact).
      frameSrc: ["'self'", "blob:", ...HCAPTCHA_CSP_SOURCES],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(isProduction ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  // xssFilter is obsolete. Helmet's default is X-XSS-Protection: 0;
  // specifying the legacy option only makes the config misleading.
});

// Error handler that doesn't expose internal details.
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const rawStatus = err?.status ?? err?.statusCode;
  let status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 500;

  // Multer reports upload problems as errors without an HTTP status.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    status = 413;
  } else if (typeof err?.code === 'string' && err.code.startsWith('LIMIT_')) {
    status = 400;
  }

  // Keep 5xx details server-side. 4xx messages are client-actionable (bad JSON,
  // disallowed CORS origin, etc.) and do not expose stack traces.
  if (status >= 500) {
    console.error('Error:', err);
  } else {
    console.warn(`[${status}] ${req.method} ${req.path}: ${err?.message || 'Request error'}`);
  }

  let message = err?.message || 'Internal server error';
  if (process.env.NODE_ENV === 'production') {
    if (status >= 500) {
      message = 'Internal server error';
    } else if (err?.type === 'entity.parse.failed') {
      message = 'Invalid JSON body';
    }
  }

  res.status(status).json({
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err?.stack })
  });
};

const SENSITIVE_KEY = /pass(?:word|wd)?|token|captcha|authorization|cookie|secret|api[_-]?key|reset/i;
const REDACTED = '[REDACTED]';
const MAX_LOG_STRING = 500;
const MAX_LOG_BODY_BYTES = 64 * 1024;

const redact = (value, depth = 0) => {
  if (depth > 4) return '[Truncated]';

  if (typeof value === 'string') {
    return value.length > MAX_LOG_STRING
      ? `${value.slice(0, MAX_LOG_STRING)}...[truncated]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(child, depth + 1);
    }
    return result;
  }

  return value;
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '[Unserializable body]';
  }
};

const sanitizeLogText = (value) => String(value || '')
  .replace(/[\r\n\t]/g, ' ')
  .slice(0, 1000);

const redactUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return sanitizeLogText(rawUrl);
  }
};

// Request logging for security audit. Runs after body parsing in server.js so
// bodies are visible, but sensitive fields are redacted before they reach logs.
const securityLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.socket?.remoteAddress;
  const method = req.method;
  const url = sanitizeLogText(redactUrl(req.originalUrl || req.url || ''));
  const userAgent = sanitizeLogText(req.get('user-agent'));
  const contentLength = Number(req.get('content-length') || 0);
  const bodyStr = req.body === undefined || contentLength > MAX_LOG_BODY_BYTES
    ? ''
    : safeStringify(req.body);

  const suspiciousPatterns = /(<script|javascript:|onerror=|onload=|SELECT.*FROM|DROP.*TABLE)/i;

  if (suspiciousPatterns.test(url) || suspiciousPatterns.test(userAgent) || suspiciousPatterns.test(bodyStr)) {
    console.warn(`[SECURITY ALERT] ${timestamp} - Suspicious request from ${ip}: ${method} ${url}`);
    console.warn(`  User-Agent: ${userAgent}`);
    if (bodyStr) console.warn(`  Body: ${bodyStr}`);
  }

  next();
};

module.exports = {
  loginLimiter,
  loginAccountLimiter,
  loginOutageLimiter,
  forgotPasswordLimiter,
  securityHeaders,
  errorHandler,
  securityLogger
};
