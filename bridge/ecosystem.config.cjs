module.exports = {
  apps: [
    {
      name: 'win-bridge-operator',
      cwd: __dirname,
      script: 'operator.mjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: '8081' },
    },
  ],
}
