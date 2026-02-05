/**
 * PM2 Ecosystem Configuration
 * 
 * Production deployment using PM2 process manager.
 * 
 * Usage:
 *   pm2 start ecosystem.config.cjs              # Start daemon
 *   pm2 logs                                    # View logs
 *   pm2 monit                                   # Monitor dashboard
 *   pm2 save                                    # Save process list
 *   pm2 startup                                 # Generate startup script
 */

module.exports = {
  apps: [
    // ========================================================================
    // Agent Daemon (Task Processor)
    // ========================================================================
    {
      name: 'loa-agent-daemon',
      script: 'dist/index.js',
      args: '--daemon',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      
      // Environment
      env: {
        NODE_ENV: 'production',
      },
      
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 10000,  // Longer delay for daemon
      
      // Logging
      error_file: '/var/log/loa-agent/daemon-error.log',
      out_file: '/var/log/loa-agent/daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 60000,  // Wait up to 60s for in-progress tasks
      listen_timeout: 10000,
    },
  ],
};
