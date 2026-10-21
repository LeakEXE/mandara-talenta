const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
  console.log(`Serving build directory: ${path.join(__dirname, 'build')}`);
});
