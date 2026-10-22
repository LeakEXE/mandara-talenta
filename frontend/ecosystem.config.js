module.exports = {
  apps: [{
    name: 'mandara-talenta-frontend',
    script: 'serve.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      // cloudflared is on another LAN host. Prefer the server's LAN IP; use
      // 0.0.0.0 only with a firewall rule that allows just the cloudflared host.
      HOST: process.env.HOST || '0.0.0.0'
    }
  }]
};
