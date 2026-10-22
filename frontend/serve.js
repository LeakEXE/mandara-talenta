const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
// cloudflared runs on another LAN host, so it must reach the frontend over the
// LAN. Prefer this server's LAN IP; 0.0.0.0 is the general fallback. Firewall
// port 3000 so only the cloudflared host can connect. The 127.0.0.1 default
// remains for local-only development.
const HOST = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');

// Keep the HTML response protected even if this process is the public origin
// (the API server has its own Helmet configuration).
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "media-src 'self'",
    "frame-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProduction ? ['upgrade-insecure-requests'] : [])
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// Cache policy for the built frontend:
// - CRA content-hashes filenames under /static/, so those can be cached forever.
// - Everything else (index.html, manifest.json, icons, logos) keeps stable URLs,
//   so it must revalidate after every deploy.
const setFrontendCacheHeaders = (res, filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/static/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
};

// Serve static files from the build directory
app.use(express.static(path.join(__dirname, 'build'), { setHeaders: setFrontendCacheHeaders }));

// Handle client-side routing - serve index.html for all routes
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Frontend server running on http://${HOST}:${PORT}`);
  console.log(`Serving build directory: ${path.join(__dirname, 'build')}`);
});
