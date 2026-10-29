/**
 * AetherClaw (灵爪) - Zero-Code Configuration Manager
 * 支持通过可视化 Web 界面、本地 JSON、`.env` 文件或环境变量管理大模型 API 与 Agent 参数。
 * 优先级：Web 界面保存的 data/config.local.json  >  环境变量 / .env  >  内置默认值
 */

const fs = require('fs');
const path = require('path');

const { HOME, DATA_DIR, ensureDir, atomicWrite } = require('./paths');
const LOCAL_CONFIG_PATH = path.join(DATA_DIR, 'config.local.json');

/**
 * 零依赖 .env 解析器：支持 KEY=VALUE、引号、`export ` 前缀、行内/整行 # 注释。
 */
function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[m[1]] = value;
  }
  return out;
}

/** 读取项目目录下的 .env；已存在的真实环境变量优先，不会被 .env 覆盖。 */
function loadDotEnv(file = path.join(HOME, '.env')) {
  try {
    if (!fs.existsSync(file)) return;
    const vars = parseEnv(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (_) { /* 无法读取 .env 时静默忽略，使用默认值 */ }
}
loadDotEnv();

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_CONFIG = {
  providerName: 'DeepSeek / OpenAI Compatible',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  port: envInt('PORT', 3721),
  host: process.env.HOST || '127.0.0.1',
  allowShellExec: process.env.ALLOW_SHELL_EXEC !== 'false',
  allowFileWrite: process.env.ALLOW_FILE_WRITE !== 'false',
  shellTimeoutMs: envInt('SHELL_TIMEOUT_MS', 15000),
  llmTimeoutMs: envInt('LLM_TIMEOUT_MS', 60000),
  autoEvolveSkills: process.env.AUTO_EVOLVE_SKILLS !== 'false',
  maxSteps: 8,
  agentName: 'AetherClaw (灵爪)'
};

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function maskKey(key) {
  if (!key) return '';
  // 过短的密钥不展示任何明文字符
  return key.length < 12 ? '****' : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

class ConfigManager {
  constructor() {
    this.ensureDataDir();
    this.config = this.load();
  }

  ensureDataDir() {
    ensureDir(DATA_DIR);
  }

  load() {
    let saved = {};
    if (fs.existsSync(LOCAL_CONFIG_PATH)) {
      try {
        saved = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
      } catch (e) {
        saved = {};
      }
    }
    return { ...DEFAULT_CONFIG, ...saved };
  }

  get() {
    return { ...this.config };
  }

  /**
   * 获取脱敏后的配置（用于在 Web 界面展示，防止泄露完整 API Key）
   */
  getSafeConfig() {
    const cfg = this.get();
    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0 && cfg.apiKey !== 'your_api_key_here');
    // 绝不把明文密钥下发给前端 / API 调用方
    const { apiKey, ...rest } = cfg;
    return {
      ...rest,
      hasApiKey: hasKey,
      apiKeyMasked: hasKey ? maskKey(apiKey) : ''
    };
  }

  update(partial) {
    this.ensureDataDir();
    const next = { ...this.config };
    if (typeof partial.providerName === 'string') next.providerName = partial.providerName.trim();
    if (typeof partial.baseUrl === 'string' && partial.baseUrl.trim() !== '') {
      const url = partial.baseUrl.trim().replace(/\/+$/, '');
      if (!isValidHttpUrl(url)) {
        throw Object.assign(new Error('baseUrl must be a valid http(s) URL'), { status: 400 });
      }
      next.baseUrl = url;
    }
    if (typeof partial.apiKey === 'string' && partial.apiKey.trim() !== '') {
      next.apiKey = partial.apiKey.trim();
    }
    if (partial.clearApiKey === true) {
      next.apiKey = '';
    }
    if (typeof partial.model === 'string' && partial.model.trim() !== '') next.model = partial.model.trim();
    if (typeof partial.allowShellExec === 'boolean') next.allowShellExec = partial.allowShellExec;
    if (typeof partial.allowFileWrite === 'boolean') next.allowFileWrite = partial.allowFileWrite;
    if (typeof partial.autoEvolveSkills === 'boolean') next.autoEvolveSkills = partial.autoEvolveSkills;
    if (typeof partial.maxSteps === 'number' && Number.isFinite(partial.maxSteps)) {
      next.maxSteps = Math.max(1, Math.min(20, Math.round(partial.maxSteps)));
    }

    this.config = next;
    // 0o600：密钥文件仅当前用户可读（Linux/macOS 生效；Windows 沿用用户目录 ACL）
    atomicWrite(LOCAL_CONFIG_PATH, JSON.stringify(this.config, null, 2), 0o600);
    return this.getSafeConfig();
  }
}

module.exports = new ConfigManager();
module.exports.parseEnv = parseEnv;
module.exports.loadDotEnv = loadDotEnv;
