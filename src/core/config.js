/**
 * AetherClaw (灵爪) - Zero-Code Configuration Manager
 * 支持通过可视化 Web 界面、本地 JSON 或环境变量管理大模型 API 与 Agent 参数。
 */

const fs = require('fs');
const path = require('path');

const { DATA_DIR, ensureDir, atomicWrite } = require('./paths');
const LOCAL_CONFIG_PATH = path.join(DATA_DIR, 'config.local.json');

const DEFAULT_CONFIG = {
  providerName: 'DeepSeek / OpenAI Compatible',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  port: Number(process.env.PORT || 3721),
  host: process.env.HOST || '127.0.0.1',
  allowShellExec: process.env.ALLOW_SHELL_EXEC !== 'false',
  shellTimeoutMs: Number(process.env.SHELL_TIMEOUT_MS || 15000),
  autoEvolveSkills: process.env.AUTO_EVOLVE_SKILLS !== 'false',
  maxSteps: 8,
  agentName: 'AetherClaw (灵爪)'
};

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
      apiKeyMasked: hasKey
        ? `${cfg.apiKey.slice(0, 4)}...${cfg.apiKey.slice(-4)}`
        : ''
    };
  }

  update(partial) {
    this.ensureDataDir();
    const next = { ...this.config };
    if (typeof partial.providerName === 'string') next.providerName = partial.providerName.trim();
    if (typeof partial.baseUrl === 'string') next.baseUrl = partial.baseUrl.trim().replace(/\/+$/, '');
    if (typeof partial.apiKey === 'string' && partial.apiKey.trim() !== '') {
      next.apiKey = partial.apiKey.trim();
    }
    if (partial.clearApiKey === true) {
      next.apiKey = '';
    }
    if (typeof partial.model === 'string') next.model = partial.model.trim();
    if (typeof partial.allowShellExec === 'boolean') next.allowShellExec = partial.allowShellExec;
    if (typeof partial.autoEvolveSkills === 'boolean') next.autoEvolveSkills = partial.autoEvolveSkills;
    if (typeof partial.maxSteps === 'number') next.maxSteps = Math.max(1, Math.min(20, partial.maxSteps));

    this.config = next;
    atomicWrite(LOCAL_CONFIG_PATH, JSON.stringify(this.config, null, 2));
    return this.getSafeConfig();
  }
}

module.exports = new ConfigManager();
