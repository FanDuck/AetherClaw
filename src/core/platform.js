/**
 * AetherClaw (灵爪) - Cross-Platform Runtime Adapter (Windows & Linux)
 * 负责自动识别当前操作系统（Windows / Linux / macOS），自动适配 PowerShell 与 Bash 命令执行及安全防护。
 */

const os = require('os');
const path = require('path');
const { exec } = require('child_process');

// Dangerous command patterns blocked by default safety guardrails
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(\s|$)/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev\//i,
  /Format-Volume/i,
  /Remove-Item\s+.*-Recurse.*C:\\(\s|$)/i,
  /:\(\)\{\s*:\|:&\s*\};:/
];

class PlatformAdapter {
  constructor() {
    this.platform = os.platform(); // 'win32', 'linux', 'darwin'
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
  }

  /**
   * 获取当前操作系统的可读摘要信息
   */
  getSystemSummary() {
    const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(2);
    const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(2);
    const cpus = os.cpus() || [];
    return {
      osType: this.isWindows ? 'Windows' : (this.isLinux ? 'Linux' : this.platform),
      platform: this.platform,
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      shell: this.getDefaultShell(),
      cpuModel: cpus[0] ? cpus[0].model.trim() : 'Unknown CPU',
      cpuCores: cpus.length,
      memory: `${freeMemGB} GB free / ${totalMemGB} GB total`,
      homedir: os.homedir(),
      cwd: process.cwd(),
      nodeVersion: process.version
    };
  }

  /**
   * 根据操作系统选择最佳默认 Shell（Windows 用 PowerShell，Linux 用 bash/sh）
   */
  getDefaultShell() {
    if (this.isWindows) {
      return 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * 检查命令是否触发安全拦截规则
   */
  checkSafety(command) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safe: false,
          reason: `Blocked potentially destructive command matching pattern: ${pattern}`
        };
      }
    }
    return { safe: true };
  }

  /**
   * 跨平台执行终端命令（支持 Windows PowerShell UTF-8 与 Linux Bash）
   */
  executeCommand(command, options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const cwd = options.cwd || process.cwd();

    const safety = this.checkSafety(command);
    if (!safety.safe) {
      return Promise.resolve({
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `[Security Guardrail] ${safety.reason}`,
        platform: this.platform
      });
    }

    return new Promise((resolve) => {
      let execCmd = command;
      let execOptions = {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 4
      };

      if (this.isWindows) {
        // Wrap with UTF-8 encoding in PowerShell to prevent garbled Chinese output
        const escaped = command.replace(/"/g, '\\"');
        execCmd = `powershell.exe -NoProfile -NonInteractive -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${escaped}"`;
      } else {
        execOptions.shell = this.getDefaultShell();
      }

      exec(execCmd, execOptions, (error, stdout, stderr) => {
        resolve({
          success: !error,
          exitCode: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
          stdout: (stdout || '').trim(),
          stderr: (stderr || (error ? error.message : '')).trim(),
          platform: this.isWindows ? 'Windows (PowerShell)' : 'Linux (Bash)'
        });
      });
    });
  }

  /**
   * 跨平台自动打开浏览器
   */
  openBrowser(url) {
    const cmd = this.isWindows
      ? `start "" "${url}"`
      : (this.isLinux ? `xdg-open "${url}"` : `open "${url}"`);
    exec(cmd, () => {});
  }
}

module.exports = new PlatformAdapter();
