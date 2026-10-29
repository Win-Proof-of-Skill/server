module.exports = {
  apps: [{
    name: 'win-feed', cwd: __dirname, script: 'service.mjs', instances: 1, exec_mode: 'fork',
    autorestart: true, restart_delay: 3000, kill_timeout: 30000, max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      WIN_FEED_PORT: process.env.WIN_FEED_PORT || '8790',
      WIN_FEED_GATEWAY: process.env.WIN_FEED_GATEWAY || 'http://127.0.0.1:3030',
      WIN_FEED_DATA: process.env.WIN_FEED_DATA,
      WIN_FEED_NETWORK_ID: process.env.WIN_FEED_NETWORK_ID,
      WIN_FEED_ORIGIN: process.env.WIN_FEED_ORIGIN,
    },
  }],
};
