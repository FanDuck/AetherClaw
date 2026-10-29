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
   * 构造受限 Docker / gVisor (runsc) 沙箱容器参数：
   *  - 丢弃全部 Linux Capabilities (--cap-drop=ALL)
   *  - 禁止提权 (--security-opt=no-new-privileges)
   *  - 根文件系统只读 (--read-only) + 内存临时目录 (--tmpfs /tmp)
   *  - 默认断网隔离 (--network=none) + 内存/CPU/进程数硬限制 (--pids-limit=64)
   *  - 非特权 nobody 用户 (65534:65534) 运行
   *  - 若 sandboxMode === 'gvisor'，启用 Google gVisor 内核级隔离 (--runtime=runsc)
   */
  buildSandboxArgs(command, options = {}) {
    const mode = options.sandboxMode === 'gvisor' ? 'gvisor' : 'docker';
    const image = options.sandboxImage || 'alpine:3.20';
    const memMB = Math.max(64, Math.min(4096, Number(options.sandboxMemoryMB) || 256));
    const net = options.sandboxNetwork === 'bridge' ? 'bridge' : 'none';
    const cwd = options.cwd || process.cwd();
    const mountMode = options.allowFileWrite === false ? 'ro' : 'rw';
    const containerName = `ac-sbx-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const args = [
      'run',
      '--rm',
      '--name', containerName,
      ...(mode === 'gvisor' ? ['--runtime=runsc'] : []),
      `--network=${net}`,
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      `--memory=${memMB}m`,
      `--memory-swap=${memMB}m`,
      '--cpus=1',
      '--pids-limit=64',
      '--user', '65534:65534',
      // 使用 --mount 而非 -v：Windows 盘符路径 (E:\\xx) 中的冒号不会被误解析为分隔符
      '--mount', `type=bind,source=${cwd},target=/workspace${mountMode === 'ro' ? ',readonly' : ''}`,
      '-w', '/workspace',
      image,
      'sh', '-c', command
    ];
    return { containerName, args, mode, image };
  }

  /**
   * 命令真正的执行目标：沙箱模式下命令运行在 Linux 容器 (sh) 中，
   * 即使宿主机是 Windows，也必须生成 Linux 命令，否则 PowerShell 命令会在容器内全部失败。
   */
  getExecTarget(sandboxMode = 'host') {
    const sandboxed = sandboxMode === 'docker' || sandboxMode === 'gvisor';
    const isWindows = sandboxed ? false : this.isWindows;
    return {
      sandboxed,
      isWindows,
      osType: sandboxed ? `Linux container (${sandboxMode === 'gvisor' ? 'gVisor runsc' : 'Docker'})` : (this.isWindows ? 'Windows' : (this.isLinux ? 'Linux' : this.platform)),
      shell: sandboxed ? 'sh (Alpine / BusyBox)' : this.getDefaultShell(),
      shellName: isWindows ? 'PowerShell' : (sandboxed ? 'sh' : 'Bash')
    };
  }

  /**
   * 探测沙箱运行时是否可用（docker 命令、守护进程、gVisor runsc 运行时、沙箱镜像是否已存在）。
   * 返回 { ok, mode, message }，用于保存配置时给出明确提示，而不是等到执行命令时才失败。
   */
  probeSandbox(mode = 'host', image = 'alpine:3.20') {
    if (mode !== 'docker' && mode !== 'gvisor') {
      return Promise.resolve({ ok: true, mode: 'host', message: '宿主机受控模式（危险命令护栏生效）' });
    }
    const run = (cmd) => new Promise((resolve) => {
      exec(cmd, { timeout: 8000, windowsHide: true }, (err, stdout) => resolve({ err, out: String(stdout || '').trim() }));
    });
    return (async () => {
      if (!/^[a-zA-Z0-9._/:@-]{2,120}$/.test(String(image))) {
        return { ok: false, mode, message: `沙箱镜像名不合法: ${image}` };
      }
      const info = await run('docker info --format "{{json .Runtimes}}"');
      if (info.err) {
        return { ok: false, mode, message: '未检测到可用的 Docker：请先安装并启动 Docker Desktop / Docker Engine，否则沙箱模式下所有终端命令都会失败。' };
      }
      if (mode === 'gvisor' && !/runsc/.test(info.out)) {
        return { ok: false, mode, message: 'Docker 中未注册 gVisor 运行时 (runsc)：请参考 https://gvisor.dev/docs/user_guide/install/ 安装后执行 `sudo runsc install` 并重启 Docker。' };
      }
      const img = await run(`docker image inspect ${image} --format "{{.Id}}"`);
      if (img.err) {
        return { ok: true, mode, message: `沙箱可用，但本地尚无镜像 ${image}：首次执行命令会自动拉取（可能超过命令超时），建议先手动执行 docker pull ${image}。` };
      }
      return { ok: true, mode, message: `沙箱可用（${mode === 'gvisor' ? 'gVisor runsc' : 'Docker'}，镜像 ${image}）` };
    })();
  }

  /**
   * 跨平台执行终端命令（支持宿主机受控模式 + Docker 受限容器沙箱 + gVisor 内核沙箱）。
   * 返回 { success, exitCode, stdout, stderr, timedOut, durationMs, platform, sandboxMode }
   */
  executeCommand(command, options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const cwd = options.cwd || process.cwd();
    const sandboxMode = ['docker', 'gvisor'].includes(options.sandboxMode) ? options.sandboxMode : 'host';
    const started = Date.now();
    const label = sandboxMode === 'gvisor'
      ? 'Sandbox (gVisor runsc)'
      : (sandboxMode === 'docker'
          ? 'Sandbox (Docker Restricted)'
          : (this.isWindows ? 'Windows (PowerShell)' : 'Linux (Bash)'));

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
        platform: label,
        sandboxMode
      });
    }

    return new Promise((resolve) => {
      let child;
      let sandboxInfo = null;
      try {
        if (sandboxMode === 'docker' || sandboxMode === 'gvisor') {
          sandboxInfo = this.buildSandboxArgs(command, { ...options, cwd, sandboxMode });
          child = spawn('docker', sandboxInfo.args, { cwd, windowsHide: true });
        } else if (this.isWindows) {
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
          timedOut: false, durationMs: Date.now() - started, platform: label, sandboxMode
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
        if (sandboxInfo && sandboxInfo.containerName) {
          exec(`docker kill ${sandboxInfo.containerName}`, () => {});
        }
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
          platform: label,
          sandboxMode
        });
      };

      child.on('error', (err) => {
        if (sandboxInfo && err && err.code === 'ENOENT') {
          return finish(-1, '[Sandbox] 未找到 docker 命令：请安装并启动 Docker，或在「API 与安全设置」中把沙箱模式切回「宿主机受控模式」。');
        }
        finish(-1, err.message);
      });
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
