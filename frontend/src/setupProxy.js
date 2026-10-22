// CRA dev-server escape hatch (no eject needed): force /uploads (and /api)
// through to the backend even when the browser asks for text/html
// (iframe navigations, new tabs). Otherwise historyApiFallback serves
// index.html and PDFs render as a blank app instead of the document.
const { createProxyMiddleware } = require('http-proxy-middleware');

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:5000';

module.exports = function (app) {
  app.use(
    ['/uploads', '/api'],
    createProxyMiddleware({ target: BACKEND, changeOrigin: true })
  );
};
