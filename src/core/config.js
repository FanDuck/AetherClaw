/**
 * AetherClaw (灵爪) - Zero-Code Configuration Manager
 * 支持通过可视化 Web 界面、本地 JSON、`.env` 文件或环境变量管理大模型 API 与 Agent 参数。
 * 优先级：Web 界面保存的 data/config.local.json  >  环境变量 / .env  >  内置默认值
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  activeProfileId: '',
  apiProfiles: [],
  port: envInt('PORT', 3721),
  host: process.env.HOST || '127.0.0.1',
  allowShellExec: process.env.ALLOW_SHELL_EXEC !== 'false',
  allowFileWrite: process.env.ALLOW_FILE_WRITE !== 'false',
  sandboxMode: ['host', 'docker', 'gvisor'].includes(process.env.SANDBOX_MODE) ? process.env.SANDBOX_MODE : 'host',
  sandboxImage: process.env.SANDBOX_IMAGE || 'alpine:3.20',
  sandboxMemoryMB: envInt('SANDBOX_MEMORY_MB', 256),
  sandboxNetwork: process.env.SANDBOX_NETWORK === 'bridge' ? 'bridge' : 'none',
  behindTlsProxy: process.env.BEHIND_TLS_PROXY === 'true',
  allowInsecureHttp: process.env.ALLOW_INSECURE_HTTP === 'true',
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

function isLocalEndpoint(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1' || u.hostname === '[::1]';
  } catch (_) {
    return false;
  }
}

function maskKey(key) {
  if (!key) return '';
  // 过短的密钥不展示任何明文字符
  return key.length < 12 ? '****' : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function inferProviderName(baseUrl, fallback = 'OpenAI Compatible') {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('deepseek.com')) return 'DeepSeek';
  if (u.includes('openai.com')) return 'OpenAI';
  if (u.includes('dashscope.aliyuncs.com')) return '通义千问 (阿里云)';
  if (u.includes('moonshot.cn')) return 'Kimi (Moonshot)';
  if (u.includes('siliconflow.cn')) return '硅基流动 (SiliconFlow)';
  if (u.includes('bigmodel.cn')) return '智谱清言 (GLM)';
  if (u.includes('generativelanguage.googleapis.com')) return 'Google Gemini';
  if (u.includes('11434') || isLocalEndpoint(baseUrl)) return 'Ollama / 本地模型';
  return fallback;
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
    const merged = { ...DEFAULT_CONFIG, ...saved };
    if (!Array.isArray(merged.apiProfiles)) merged.apiProfiles = [];
    return merged;
  }

  persist() {
    this.ensureDataDir();
    // 0o600：密钥文件仅当前用户可读（Linux/macOS 生效；Windows 沿用用户目录 ACL）
    atomicWrite(LOCAL_CONFIG_PATH, JSON.stringify(this.config, null, 2), 0o600);
  }

  get() {
    return {
      ...this.config,
      apiProfiles: Array.isArray(this.config.apiProfiles) ? this.config.apiProfiles.map(p => ({ ...p })) : []
    };
  }

  /**
   * 获取脱敏后的配置（用于在 Web 界面展示，防止泄露完整 API Key）
   */
  getSafeConfig() {
    const cfg = this.get();
    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0 && cfg.apiKey !== 'your_api_key_here');
    // 绝不把明文密钥下发给前端 / API 调用方
    const { apiKey, apiProfiles = [], ...rest } = cfg;
    const safeProfiles = apiProfiles.map(({ apiKey: pk, ...pRest }) => {
      const pHasKey = Boolean(pk && pk.trim().length > 0);
      return {
        ...pRest,
        hasApiKey: pHasKey,
        apiKeyMasked: pHasKey ? maskKey(pk) : (isLocalEndpoint(pRest.baseUrl) ? '免 Key (本地)' : '未配置')
      };
    });
    return {
      ...rest,
      hasApiKey: hasKey,
      apiKeyMasked: hasKey ? maskKey(apiKey) : '',
      apiProfiles: safeProfiles
    };
  }

  update(partial) {
    const next = { ...this.config };
    if (!Array.isArray(next.apiProfiles)) next.apiProfiles = [];

    if (typeof partial.providerName === 'string' && partial.providerName.trim() !== '') {
      next.providerName = partial.providerName.trim();
    }
    if (typeof partial.baseUrl === 'string' && partial.baseUrl.trim() !== '') {
      const url = partial.baseUrl.trim().replace(/\/+$/, '');
      if (!isValidHttpUrl(url)) {
        throw Object.assign(new Error('baseUrl must be a valid http(s) URL'), { status: 400 });
      }
      next.baseUrl = url;
      if (!partial.providerName) {
        next.providerName = inferProviderName(url, next.providerName);
      }
    }
    if (typeof partial.apiKey === 'string' && partial.apiKey.trim() !== '') {
      next.apiKey = partial.apiKey.trim();
    }
    if (partial.clearApiKey === true) {
      next.apiKey = '';
      next.activeProfileId = '';
      if (isLocalEndpoint(next.baseUrl)) {
        next.baseUrl = 'https://api.deepseek.com/v1';
        next.providerName = 'DeepSeek / OpenAI Compatible';
      }
    }
    if (typeof partial.model === 'string' && partial.model.trim() !== '') next.model = partial.model.trim();
    if (typeof partial.allowShellExec === 'boolean') next.allowShellExec = partial.allowShellExec;
    if (typeof partial.allowFileWrite === 'boolean') next.allowFileWrite = partial.allowFileWrite;
    if (typeof partial.autoEvolveSkills === 'boolean') next.autoEvolveSkills = partial.autoEvolveSkills;
    if (typeof partial.sandboxMode === 'string' && ['host', 'docker', 'gvisor'].includes(partial.sandboxMode)) {
      next.sandboxMode = partial.sandboxMode;
    }
    if (typeof partial.sandboxImage === 'string' && /^[a-zA-Z0-9._/:@-]{2,120}$/.test(partial.sandboxImage.trim())) {
      next.sandboxImage = partial.sandboxImage.trim();
    }
    if (typeof partial.sandboxNetwork === 'string' && ['none', 'bridge'].includes(partial.sandboxNetwork)) {
      next.sandboxNetwork = partial.sandboxNetwork;
    }
    if (typeof partial.behindTlsProxy === 'boolean') next.behindTlsProxy = partial.behindTlsProxy;
    if (typeof partial.maxSteps === 'number' && Number.isFinite(partial.maxSteps)) {
      next.maxSteps = Math.max(1, Math.min(20, Math.round(partial.maxSteps)));
    }

    // 如果请求显式指定同时存入密钥保险箱 (saveToVault: true)，自动同步进 apiProfiles
    if (partial.saveToVault === true && (next.apiKey || isLocalEndpoint(next.baseUrl))) {
      const profName = (partial.profileName || '').trim() || `${inferProviderName(next.baseUrl)} (${next.model})`;
      const existingIdx = next.apiProfiles.findIndex(
        p => (partial.profileId && p.id === partial.profileId) || (p.baseUrl === next.baseUrl && p.model === next.model && p.name === profName)
      );
      const profId = existingIdx >= 0 ? next.apiProfiles[existingIdx].id : `prof_${crypto.randomBytes(4).toString('hex')}`;
      const record = {
        id: profId,
        name: profName,
        providerName: inferProviderName(next.baseUrl),
        baseUrl: next.baseUrl,
        model: next.model,
        apiKey: next.apiKey,
        updatedAt: new Date().toISOString()
      };
      if (existingIdx >= 0) {
        next.apiProfiles[existingIdx] = { ...next.apiProfiles[existingIdx], ...record };
      } else {
        next.apiProfiles.unshift(record);
      }
      next.activeProfileId = profId;
    }

    this.config = next;
    this.persist();
    return this.getSafeConfig();
  }

  /**
   * 新增或更新一条 API Key 配置档案
   */
  saveProfile(input = {}) {
    const baseUrl = String(input.baseUrl || this.config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!isValidHttpUrl(baseUrl)) {
      throw Object.assign(new Error('接口地址 (Base URL) 必须是合法的 http(s) URL'), { status: 400 });
    }
    const model = String(input.model || this.config.model || 'deepseek-chat').trim();
    const providerName = String(input.providerName || inferProviderName(baseUrl)).trim();
    const name = String(input.name || `${providerName} · ${model}`).trim();
    const profiles = Array.isArray(this.config.apiProfiles) ? [...this.config.apiProfiles] : [];
    const existingIdx = input.id
      ? profiles.findIndex(p => p.id === input.id)
      : profiles.findIndex(p => p.name === name && p.baseUrl === baseUrl && p.model === model);
    const prevKey = existingIdx >= 0 ? profiles[existingIdx].apiKey : (this.config.apiKey || '');
    const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() !== '' ? input.apiKey.trim() : prevKey;

    if (!apiKey && !isLocalEndpoint(baseUrl)) {
      throw Object.assign(new Error('远程大模型服务需要填写 API Key（本地 Ollama 除外）'), { status: 400 });
    }

    const id = existingIdx >= 0 ? profiles[existingIdx].id : `prof_${crypto.randomBytes(4).toString('hex')}`;
    const entry = {
      ...(existingIdx >= 0 ? profiles[existingIdx] : {}),
      id,
      name,
      providerName,
      baseUrl,
      model,
      apiKey,
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      profiles[existingIdx] = entry;
    } else {
      profiles.unshift(entry);
    }

    this.config.apiProfiles = profiles;
    if (input.activate !== false) {
      this.config.activeProfileId = id;
      this.config.providerName = providerName;
      this.config.baseUrl = baseUrl;
      this.config.model = model;
      this.config.apiKey = apiKey;
    }
    this.persist();
    return this.getSafeConfig();
  }

  /**
   * 激活并切换到某条已保存的 API Key 档案
   */
  activateProfile(id) {
    const profiles = Array.isArray(this.config.apiProfiles) ? this.config.apiProfiles : [];
    const found = profiles.find(p => p.id === id);
    if (!found) {
      throw Object.assign(new Error(`未找到该 API 配置档案: ${id}`), { status: 404 });
    }
    this.config.activeProfileId = found.id;
    this.config.providerName = found.providerName || inferProviderName(found.baseUrl);
    this.config.baseUrl = found.baseUrl;
    this.config.model = found.model;
    this.config.apiKey = found.apiKey || '';
    this.persist();
    return this.getSafeConfig();
  }

  /**
   * 删除某条已保存的 API Key 档案；若该档案当前处于激活态，可同步清除当前激活 Key
   */
  deleteProfile(id) {
    const profiles = Array.isArray(this.config.apiProfiles) ? this.config.apiProfiles : [];
    const target = profiles.find(p => p.id === id);
    if (!target) {
      throw Object.assign(new Error(`未找到该 API 配置档案: ${id}`), { status: 404 });
    }
    this.config.apiProfiles = profiles.filter(p => p.id !== id);
    if (this.config.activeProfileId === id || (target.apiKey && this.config.apiKey === target.apiKey)) {
      this.config.activeProfileId = '';
      if (this.config.apiProfiles.length > 0) {
        const nextActive = this.config.apiProfiles[0];
        this.config.activeProfileId = nextActive.id;
        this.config.providerName = nextActive.providerName || inferProviderName(nextActive.baseUrl);
        this.config.baseUrl = nextActive.baseUrl;
        this.config.model = nextActive.model;
        this.config.apiKey = nextActive.apiKey || '';
      } else {
        this.config.apiKey = '';
      }
    }
    this.persist();
    return this.getSafeConfig();
  }

  /**
   * 测试大模型 API 连通性、鉴权有效性与响应延迟
   */
  async testConnection(params = {}) {
    let baseUrl = String(params.baseUrl || this.config.baseUrl || '').trim().replace(/\/+$/, '');
    let model = String(params.model || this.config.model || '').trim();
    let apiKey = typeof params.apiKey === 'string' && params.apiKey.trim() !== '' ? params.apiKey.trim() : '';

    if (params.profileId) {
      const prof = (this.config.apiProfiles || []).find(p => p.id === params.profileId);
      if (!prof) throw Object.assign(new Error(`未找到配置档案: ${params.profileId}`), { status: 404 });
      baseUrl = prof.baseUrl;
      model = prof.model;
      apiKey = prof.apiKey || '';
    } else if (!apiKey) {
      apiKey = this.config.apiKey || '';
    }

    if (!isValidHttpUrl(baseUrl)) {
      return {
        ok: false,
        status: 400,
        latencyMs: 0,
        diagnosis: '接口地址 (Base URL) 格式不正确，必须以 http:// 或 https:// 开头。'
      };
    }

    if (!apiKey && !isLocalEndpoint(baseUrl)) {
      return {
        ok: false,
        status: 401,
        latencyMs: 0,
        diagnosis: '未填写 API Key。远程大模型服务必须提供有效的 API Key（仅本地 Ollama 等免 Key 服务可留空）。'
      };
    }

    const endpoint = `${baseUrl}/chat/completions`;
    const timeoutMs = Math.min(20000, Math.max(2000, Number(params.timeoutMs) || 10000));
    const t0 = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Ping! Reply with OK only.' }],
          max_tokens: 12,
          temperature: 0
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      const latencyMs = Date.now() - t0;
      const rawText = await response.text();
      let data = {};
      try { data = JSON.parse(rawText); } catch (_) { /* ignore */ }

      if (!response.ok) {
        const errMsg = (data.error && (data.error.message || data.error.code)) || rawText.slice(0, 180) || `HTTP ${response.status}`;
        let diagnosis = `接口返回错误 (HTTP ${response.status})：${errMsg}`;
        if (response.status === 401 || response.status === 403) {
          diagnosis = `🔑 鉴权失败 (HTTP ${response.status})：API Key 无效、已过期或无权访问该模型 (${ errMsg })。`;
        } else if (response.status === 404) {
          diagnosis = `🔍 路径或模型不存在 (HTTP 404)：请检查 Base URL 是否以 /v1 结尾，以及模型名称「${model}」是否正确 (${errMsg})。`;
        } else if (response.status === 402 || response.status === 429) {
          diagnosis = `💳 额度不足或请求受限 (HTTP ${response.status})：请检查账户余额或并发限制 (${errMsg})。`;
        }
        this._recordProfileTestResult(params.profileId, false, latencyMs);
        return { ok: false, status: response.status, latencyMs, model, diagnosis };
      }

      const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
        ? String(data.choices[0].message.content).trim()
        : 'OK';
      const usedModel = data.model || model;
      this._recordProfileTestResult(params.profileId, true, latencyMs);

      return {
        ok: true,
        status: response.status,
        latencyMs,
        model: usedModel,
        reply: reply.slice(0, 80),
        diagnosis: `✅ 连通成功！模型「${usedModel}」响应正常（耗时 ${latencyMs} ms，回复: "${reply.slice(0, 40)}"）。`
      };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      this._recordProfileTestResult(params.profileId, false, latencyMs);
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|aborted/i.test(err.message);
      return {
        ok: false,
        status: 0,
        latencyMs,
        model,
        diagnosis: isTimeout
          ? `⏱️ 连接超时（>${timeoutMs} ms）：服务器无响应，请检查网络代理或接口地址是否可达。`
          : `🌐 网络连接失败：无法访问 ${endpoint}（${err.message}）。若使用本地 Ollama，请确认已启动服务。`
      };
    }
  }

  /**
   * 从 OpenAI 兼容接口拉取可用模型列表 (GET /v1/models)
   */
  async fetchModels(params = {}) {
    let baseUrl = String(params.baseUrl || this.config.baseUrl || '').trim().replace(/\/+$/, '');
    let apiKey = typeof params.apiKey === 'string' && params.apiKey.trim() !== '' ? params.apiKey.trim() : (this.config.apiKey || '');
    if (params.profileId) {
      const prof = (this.config.apiProfiles || []).find(p => p.id === params.profileId);
      if (prof) {
        baseUrl = prof.baseUrl;
        apiKey = prof.apiKey || '';
      }
    }
    if (!isValidHttpUrl(baseUrl)) {
      throw Object.assign(new Error('请先填写合法的 Base URL'), { status: 400 });
    }
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    let res;
    try {
      res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000)
      });
    } catch (err) {
      throw Object.assign(new Error(`无法连接模型接口 ${baseUrl}/models (${err.message})`), { status: 400 });
    }
    if (!res.ok) {
      throw Object.assign(
        new Error(res.status === 401 || res.status === 403 ? `API Key 无效或无权限 (HTTP ${res.status})` : `获取模型列表失败 (HTTP ${res.status})`),
        { status: 400 }
      );
    }
    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      throw Object.assign(new Error('接口未返回有效的 JSON 模型列表'), { status: 400 });
    }
    const list = Array.isArray(json.data)
      ? json.data.map(m => m.id || m.name).filter(Boolean)
      : (Array.isArray(json.models) ? json.models.map(m => m.name || m.id).filter(Boolean) : []);
    return list.slice(0, 60);
  }

  _recordProfileTestResult(profileId, ok, latencyMs) {
    const id = profileId || this.config.activeProfileId;
    if (!id || !Array.isArray(this.config.apiProfiles)) return;
    const idx = this.config.apiProfiles.findIndex(p => p.id === id);
    if (idx < 0) return;
    this.config.apiProfiles[idx] = {
      ...this.config.apiProfiles[idx],
      lastTestOk: ok,
      lastLatencyMs: latencyMs,
      lastTestedAt: new Date().toISOString()
    };
    this.persist();
  }
}

module.exports = new ConfigManager();
module.exports.parseEnv = parseEnv;
module.exports.loadDotEnv = loadDotEnv;
module.exports.isLocalEndpoint = isLocalEndpoint;
