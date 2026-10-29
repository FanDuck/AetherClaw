/**
 * AetherClaw (灵爪) - Official PM2 Process Manager Configuration
 *
 * 适用场景：Windows / Linux / macOS 生产常驻守护进程
 * 使用方法：
 *   1. 安装 PM2: npm install -g pm2
 *   2. 启动服务: pm2 start pm2.config.js
 *   3. 开机自启: pm2 save && pm2 startup
 *   4. 查看状态: pm2 status aetherclaw | pm2 logs aetherclaw
 */

module.exports = {
  apps: [
    {
      name: 'aetherclaw',
      script: './src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3721,
        SANDBOX_MODE: 'host'
      },
      env_production: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3721,
        BEHIND_TLS_PROXY: 'true',
        SANDBOX_MODE: 'docker'
      }
    }
  ]
};
