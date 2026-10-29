/**
 * AetherClaw (灵爪) - Cross-Platform Runtime Adapter (Windows & Linux)
 *
 * - 自动识别 Windows / Linux / macOS，选择 PowerShell 或 Bash
 * - Windows 使用 -EncodedCommand (Base64 UTF-16LE)，彻底避免引号/`$` 转义问题与注入
 * - 超时后杀掉整个进程树（Windows: taskkill /T，Linux: 进程组 kill）
 * - 输出大小上限，防止内存被撑爆
 * - 实时 CPU / 内存指标采样，供 Web 控制台动态仪表盘使用
 */

const os = require('os');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { StringDecoder } = require('string_decoder');

// Dangerous command patterns blocked by default safety guardrails.
// 命令在匹配前会先做空白归一化，避免用多余空格/制表符绕过。
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive\s+--force|--force\s+--recursive)\s+(--no-preserve-root\s+)?(\/|~|\$home|\*)(\s|$)/i,
  /\brm\s+.*--no-preserve-root/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+.*\bof=\/dev\/(sd|hd|nvme|disk|mmcblk)/i,
  />\s*\/dev\/(sd|hd|nvme|mmcblk)\w*/i,
  /\b(shutdown|poweroff|halt|reboot)\b(\s+-\w+)*(\s+now)?\s*$/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\bchmod\s+-R\s+0?777\s+\/(\s|$)/i,
  /Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition/i,
  /\bformat\s+[a-z]:/i,
  /Remove-Item\s+(.*\s)?[a-z]:\\?(\s|$|\*)(.*-Recurse)?/i,
  /Remove-Item\s+.*-Recurse.*\b[a-z]:\\?(\s|$|\*)/i,
  /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?(\s|$)/i,
  /\bdel\s+\/[fsq]+\s+.*[a-z]:\\\*/i,
  /\bbcdedit\b.*\/delete/i,
  /\breg\s+delete\s+HKLM\\SYSTEM/i,
  /(curl|wget|iwr|Invoke-WebRequest)[^|;]*\|\s*(sudo\s+)?(ba|z)?sh\b/i,
  /(iex|Invoke-Expression)\s*\(?\s*(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|New-Object\s+Net\.WebClient)/i
];

const MAX_OUTPUT_BYTES = 1024 * 1024 * 2;

// rm 的"递归 + 危险目标"检测：按命令分隔符切段后逐段分析，
// 能识别 `rm -r -f /`、`sudo rm -rf /*`、`rm -rf ~/`、`echo ok; rm -rf /` 等变体。
const DANGEROUS_RM_TARGET = /^(\/|\/\*|~|~\/|~\/\*|\$home|\$\{home\}|\$home\/|\$home\/\*|\*)$/i;
function isDangerousRm(command) {
  return command.split(/&&|\|\||;|\|/).some((segment) => {
    const tokens = segment.trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ''));
    const at = tokens.findIndex((t) => /(^|\/)rm$/.test(t));
    if (at === -1) return false;
    const rest = tokens.slice(at + 1);
    const flags = rest.filter((t) => t.startsWith('-'));
    const targets = rest.filter((t) => !t.startsWith('-'));
    const recursive = flags.some((f) => /^-[a-z]*r[a-z]*$/i.test(f) || f === '--recursive');
    return recursive && targets.some((t) => DANGEROUS_RM_TARGET.test(t));
  });
}

class PlatformAdapter {
  constructor() {
    this.platform = os.platform(); // 'win32', 'linux', 'darwin'
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
    this._lastCpu = this._snapshotCpu();
  }

  /** 当前操作系统的可读摘要信息 */
  getSystemSummary() {
    const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(2);
    const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(2);
    const cpus = os.cpus() || [];
    return {
      osType: this.isWindows ? 'Windows' : (this.isLinux ? 'Linux' : this.platform),
      isWindows: this.isWindows,
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
      nodeVersion: process.version,
      uptimeSeconds: Math.round(os.uptime())
    };
  }

  /** Windows 用 PowerShell，Linux 用 bash/sh */
  getDefaultShell() {
    if (this.isWindows) return 'powershell.exe';
    // 精简容器（如 Alpine）可能没有 bash：依次回退到 $SHELL → /bin/bash → /bin/sh
    const candidates = [process.env.SHELL, '/bin/bash', '/bin/sh'].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || '/bin/sh';
  }

  _snapshotCpu() {
    const cpus = os.cpus() || [];
    let idle = 0;
    let total = 0;
    for (const c of cpus) {
      for (const t of Object.keys(c.times)) total += c.times[t];
      idle += c.times.idle;
    }
    return { idle, total };
  }

  /** 实时资源指标（CPU 使用率为两次采样的差值） */
  getMetrics() {
    const now = this._snapshotCpu();
    const dIdle = now.idle - this._lastCpu.idle;
    const dTotal = now.total - this._lastCpu.total;
    this._lastCpu = now;
    const cpuPercent = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;
    const total = os.totalmem();
    const free = os.freemem();
    return {
      cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
      memPercent: Math.round(((total - free) / total) * 100),
      memUsedGB: +((total - free) / 1024 ** 3).toFixed(2),
      memTotalGB: +(total / 1024 ** 3).toFixed(2),
      loadAvg: os.loadavg().map(n => +n.toFixed(2)),
      timestamp: Date.now()
    };
  }

  /** 检查命令是否触发安全拦截规则 */
  checkSafety(command) {
    const normalized = String(command || '').replace(/\s+/g, ' ').trim();
    if (isDangerousRm(normalized)) {
      return { safe: false, reason: 'Blocked potentially destructive command: recursive rm on a root/home/wildcard target' };
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          safe: false,
          reason: `Blocked potentially destructive command matching pattern: ${pattern}`
        };
      }
    }
    return { safe: true };
  }

  _killTree(child) {
    if (!child || !child.pid) return;
    try {
      if (this.isWindows) {
        exec(`taskkill /pid ${child.pid} /T /F`, () => {});
        try { child.kill('SIGKILL'); } catch (_) {}
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch (e) {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
  }

  /**
   * 跨平台执行终端命令。
   * 返回 { success, exitCode, stdout, stderr, timedOut, durationMs, platform }
   */
  executeCommand(command, options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const cwd = options.cwd || process.cwd();
    const started = Date.now();
    const label = this.isWindows ? 'Windows (PowerShell)' : 'Linux (Bash)';

    const safety = this.checkSafety(command);
    if (!safety.safe) {
      return Promise.resolve({
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `[Security Guardrail] ${safety.reason}`,
        blocked: true,
        timedOut: false,
        durationMs: 0,
        platform: label
      });
    }

    return new Promise((resolve) => {
      let child;
      try {
        if (this.isWindows) {
          const script = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`;
          const encoded = Buffer.from(script, 'utf16le').toString('base64');
          child = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { cwd, windowsHide: true }
          );
        } else {
          child = spawn(this.getDefaultShell(), ['-c', command], { cwd, detached: true });
        }
      } catch (err) {
        return resolve({
          success: false, exitCode: -1, stdout: '', stderr: err.message,
          timedOut: false, durationMs: Date.now() - started, platform: label
        });
      }

      let stdout = '';
      let stderr = '';
      const outDec = new StringDecoder('utf8');
      const errDec = new StringDecoder('utf8');
      let size = 0;
      let timedOut = false;
      let truncated = false;
      let settled = false;

      const collect = (which) => (chunk) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        if (which === 'out') stdout += outDec.write(chunk);
        else stderr += errDec.write(chunk);
      };
      child.stdout.on('data', collect('out'));
      child.stderr.on('data', collect('err'));

      const timer = setTimeout(() => {
        timedOut = true;
        this._killTree(child);
        setTimeout(() => finish(-1, 'Process terminated after timeout'), 300).unref();
      }, timeoutMs);

      const finish = (code, errMsg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stdout += outDec.end();
        stderr += errDec.end();
        const cleanErr = stderr.trim() || errMsg || '';
        resolve({
          success: code === 0 && !timedOut,
          exitCode: typeof code === 'number' ? code : -1,
          stdout: stdout.trim() + (truncated ? '\n…[output truncated]' : ''),
          stderr: timedOut ? `${cleanErr}\n[Timeout] Command exceeded ${timeoutMs}ms and was terminated.`.trim() : cleanErr,
          timedOut,
          durationMs: Date.now() - started,
          platform: label
        });
      };

      child.on('error', (err) => finish(-1, err.message));
      child.on('close', (code) => finish(code));
    });
  }

  /** 跨平台打开浏览器（URL 仅允许 http/https，避免命令注入） */
  openBrowser(url) {
    if (!/^https?:\/\/[\w.\-:[\]/?#=&%~+@!,;]+$/i.test(url)) return;
    try {
      if (this.isWindows) {
        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } else {
        const opener = this.isLinux ? 'xdg-open' : 'open';
        const c = spawn(opener, [url], { detached: true, stdio: 'ignore' });
        c.on('error', () => {});
        c.unref();
      }
    } catch (_) { /* headless server: ignore */ }
  }
}

module.exports = new PlatformAdapter();
