module.exports = {
  apps: [{
    name: 'mandara-talenta',
    script: 'backend/server.js',
    // Run with backend/ as cwd so any relative path behaves like dev.
    // (All upload paths are absolute via backend/utils/paths.js; this is belt-and-suspenders.)
    cwd: require('path').join(__dirname, 'backend'),
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    min_uptime: '10s',
    restart_delay: 4000,
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      // cloudflared runs on another LAN host, so the origin cannot bind to
      // loopback. Prefer this server's LAN IP here; 0.0.0.0 is the general
      // fallback. Restrict ports 3000/5000 to the cloudflared host at the
      // firewall.
      HOST: process.env.HOST || '0.0.0.0',
      TRUST_PROXY: '1'
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 5000,
      HOST: '127.0.0.1',
      TRUST_PROXY: '1'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};