/**
 * AetherClaw (灵爪) - Visual Web Console HTTP & REST API Server
 * 零第三方依赖（Node 原生 http）。安全设计：
 *  - 默认仅监听回环地址；校验 Host 头，防御 DNS Rebinding
 *  - 校验 Origin，防御恶意网页对本地 Agent 的跨站请求 (CSRF)
 *  - 绑定非回环地址时强制 Token 鉴权
 *  - 严格安全响应头 (CSP / nosniff / frame-ancestors)
 *  - 支持 SSE 流式推送 Agent 每一步轨迹，供 Web 控制台实时动画
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const platform = require('../core/platform');
const config = require('../core/config');
const memory = require('../core/memory');
const agent = require('../core/agent');
const { TOOLS } = require('../tools');
const pkg = require('../../package.json');

const UI_HTML_PATH = path.join(__dirname, '..', 'ui', 'index.html');
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo.png');
const LOGO_SVG_PATH = path.join(__dirname, '..', '..', 'assets', 'logo.svg');
const MAX_BODY = 1024 * 1024 * 2;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackHost(host) {
  return LOOPBACK.has(host);
}

function hostnameOf(hostHeader = '') {
  // "localhost:3721" -> "localhost"; "[::1]:3721" -> "[::1]"
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0];
}

function securityHeaders(extra = {}, hsts = false) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...(hsts ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' } : {}),
    ...extra
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    // 以 Buffer 累积，最后统一按 UTF-8 解码：
    // 逐块 `raw += chunk` 会在多字节字符（如中文）恰好被分到两个 chunk 时产生乱码。
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON payload'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * 提取请求头中的鉴权令牌：优先使用标准 RFC 6750 `Authorization: Bearer <token>`，
 * 兼容 `X-AetherClaw-Token` 请求头；禁止通过 URL Query (`?token=`) 传参以防日志/历史记录泄露。
 */
function extractAuthToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.headers['x-aetherclaw-token']) return String(req.headers['x-aetherclaw-token']).trim();
  return '';
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (_) {
    throw Object.assign(new Error('Malformed URL parameter'), { status: 400 });
  }
}

/**
 * @param {{token?: string}} [opts]
 */
function createServer(opts = {}) {
  const token = opts.token || process.env.AETHERCLAW_TOKEN || '';
  const startedAt = Date.now();
  let busy = 0;

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    try {
      // 1) Host 校验 (DNS rebinding) & TLS 反向代理强制 HTTPS 检查
      const cfg = config.get();
      if (isLoopbackHost(cfg.host) && !isLoopbackHost(hostnameOf(req.headers.host))) {
        return sendJson(res, 403, { error: 'Forbidden: invalid Host header' });
      }
      if (cfg.behindTlsProxy) {
        const xfp = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
        if (xfp && xfp !== 'https') {
          return sendJson(res, 403, { error: 'Forbidden: HTTPS (TLS) is required by behindTlsProxy policy' }, {
            'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
          });
        }
      }

      // 2) 跨站请求防护：带 Origin 的请求必须与 Host 同源
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try { originHost = new URL(origin).host; } catch (_) { /* ignore */ }
        if (originHost !== req.headers.host) {
          return sendJson(res, 403, { error: 'Forbidden: cross-origin request blocked' });
        }
      }

      // 3) Header Bearer Token 鉴权（API 路径；禁止明文 URL ?token= 传参）
      if (pathname.startsWith('/api/') && token) {
        const supplied = extractAuthToken(req);
        if (!timingSafeEqual(supplied, token)) {
          return sendJson(
            res,
            401,
            { error: 'Unauthorized: missing or invalid Authorization: Bearer <token> header' },
            { 'WWW-Authenticate': 'Bearer realm="AetherClaw"' }
          );
        }
      }

      // ---- Static: Web Console ----
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
        res.writeHead(200, securityHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        }));
        return res.end(html);
      }

      if (req.method === 'GET' && pathname === '/assets/logo.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(LOGO_SVG_PATH));
      }

      if (req.method === 'GET' && (pathname === '/assets/logo.png' || pathname === '/favicon.ico')) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(LOGO_PATH));
      }

      if (req.method === 'GET' && pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, version: pkg.version, uptimeMs: Date.now() - startedAt, activeTasks: busy });
      }

      // ---- API ----
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, {
          version: pkg.version,
          system: platform.getSystemSummary(),
          metrics: platform.getMetrics(),
          config: config.getSafeConfig(),
          memories: memory.state.semanticMemories,
          episodes: memory.state.episodicHistory.slice(0, 15),
          skills: memory.listSkills(),
          tools: Object.values(TOOLS).map(t => ({ name: t.name, description: t.description }))
        });
      }

      if (req.method === 'GET' && pathname === '/api/metrics') {
        return sendJson(res, 200, platform.getMetrics());
      }

      if (req.method === 'POST' && pathname === '/api/config') {
        const body = await parseBody(req);
        return sendJson(res, 200, { success: true, config: config.update(body) });
      }

      if (req.method === 'DELETE' && pathname === '/api/config/apikey') {
        return sendJson(res, 200, { success: true, config: config.update({ clearApiKey: true }) });
      }

      if (req.method === 'POST' && pathname === '/api/config/test') {
        const body = await parseBody(req);
        const result = await config.testConnection(body);
        return sendJson(res, 200, { ...result, config: config.getSafeConfig() });
      }

      if (req.method === 'POST' && pathname === '/api/config/models') {
        const body = await parseBody(req);
        const models = await config.fetchModels(body);
        return sendJson(res, 200, { success: true, models });
      }

      if (req.method === 'POST' && pathname === '/api/config/profiles') {
        const body = await parseBody(req);
        return sendJson(res, 200, { success: true, config: config.saveProfile(body) });
      }

      if (req.method === 'POST' && /^\/api\/config\/profiles\/[^/]+\/activate$/.test(pathname)) {
        const id = safeDecode(pathname.replace(/^\/api\/config\/profiles\/|\/activate$/g, ''));
        return sendJson(res, 200, { success: true, config: config.activateProfile(id) });
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/config/profiles/')) {
        const id = safeDecode(pathname.replace('/api/config/profiles/', ''));
        return sendJson(res, 200, { success: true, config: config.deleteProfile(id) });
      }

      // Plain JSON chat
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await parseBody(req);
        const prompt = (body.prompt || '').trim();
        if (!prompt) return sendJson(res, 400, { error: 'Prompt cannot be empty' });
        busy++;
        try {
          const result = await agent.run(prompt);
          return sendJson(res, 200, {
            ...result,
            memories: memory.state.semanticMemories,
            skills: memory.listSkills(),
            episodes: memory.state.episodicHistory.slice(0, 15)
          });
        } finally {
          busy--;
        }
      }

      // Streaming chat (Server-Sent Events): 每一步实时推送
      if (req.method === 'POST' && pathname === '/api/chat/stream') {
        const body = await parseBody(req);
        const prompt = (body.prompt || '').trim();
        if (!prompt) return sendJson(res, 400, { error: 'Prompt cannot be empty' });

        res.writeHead(200, securityHeaders({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        }));
        const reqAbort = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) reqAbort.abort();
        });
        const send = (event, data) => {
          if (!res.writableEnded && !reqAbort.signal.aborted) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        };
        busy++;
        try {
          const result = await agent.run(prompt, (step) => send('step', step), {
            onToken: (delta) => send('token', { delta }),
            signal: reqAbort.signal
          });
          if (!reqAbort.signal.aborted) {
            send('done', {
              mode: result.mode,
              finalAnswer: result.finalAnswer,
              memories: memory.state.semanticMemories,
              skills: memory.listSkills(),
              episodes: memory.state.episodicHistory.slice(0, 15)
            });
          }
        } catch (err) {
          if (!reqAbort.signal.aborted) {
            send('error', { error: err.message || 'Agent failed' });
          }
        } finally {
          busy--;
          if (!res.writableEnded) res.end();
        }
        return;
      }

      if (req.method === 'DELETE' && pathname === '/api/conversation') {
        memory.clearEpisodes();
        return sendJson(res, 200, { success: true, episodes: [] });
      }

      if (req.method === 'POST' && pathname === '/api/memory') {
        const body = await parseBody(req);
        if (!body.content || typeof body.content !== 'string') {
          return sendJson(res, 400, { error: 'content is required' });
        }
        const item = memory.addMemory({
          content: body.content,
          category: body.category || 'knowledge',
          tags: body.tags || []
        });
        return sendJson(res, 200, { success: true, memory: item, memories: memory.state.semanticMemories });
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/memory/')) {
        const id = safeDecode(pathname.replace('/api/memory/', ''));
        memory.deleteMemory(id);
        return sendJson(res, 200, { success: true, memories: memory.state.semanticMemories });
      }

      if (req.method === 'POST' && pathname === '/api/skills') {
        const body = await parseBody(req);
        const skill = memory.createOrUpdateSkill({
          id: body.id,
          name: body.name,
          description: body.description,
          triggerKeywords: body.triggerKeywords || [],
          steps: body.steps || [],
          commandTemplate: {
            win32: typeof body.win32Command === 'string' ? body.win32Command : undefined,
            linux: typeof body.linuxCommand === 'string' ? body.linuxCommand : undefined
          }
        });
        return sendJson(res, 200, { success: true, skill, skills: memory.listSkills() });
      }

      if (req.method === 'POST' && pathname === '/api/skills/import') {
        const body = await parseBody(req);
        const skill = memory.importSkillFromMarkdown(body.markdown || '');
        return sendJson(res, 200, { success: true, skill, skills: memory.listSkills() });
      }

      if (req.method === 'GET' && /^\/api\/skills\/[^/]+\/md$/.test(pathname)) {
        const id = safeDecode(pathname.replace(/^\/api\/skills\/|\/md$/g, ''));
        const exported = memory.getSkillMarkdown(id);
        if (!exported) return sendJson(res, 404, { error: `Skill not found: ${id}` });
        if (urlObj.searchParams.get('download') === '1') {
          res.writeHead(200, securityHeaders({
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${exported.filename}"`
          }));
          return res.end(exported.markdown);
        }
        return sendJson(res, 200, exported);
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/skills/')) {
        const id = safeDecode(pathname.replace('/api/skills/', ''));
        const removed = memory.deleteSkill(id);
        return sendJson(res, 200, { success: removed, skills: memory.listSkills() });
      }

      return sendJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (err) {
      if (res.headersSent) return res.end();
      return sendJson(res, err.status || 500, { error: err.message || 'Internal Server Error' });
    }
  });

  server.keepAliveTimeout = 5000;
  return server;
}

function startWebServer({ openBrowser = false } = {}) {
  const cfg = config.get();
  let listenHost = cfg.host;
  let token = process.env.AETHERCLAW_TOKEN || '';
  const requestedPublic = !isLoopbackHost(listenHost);

  // 默认关闭纯明文公网暴露：若尝试绑定非回环地址 (如 0.0.0.0)，必须显式配置 BEHIND_TLS_PROXY=true 或 ALLOW_INSECURE_HTTP=true
  let blockedPlaintextPublic = false;
  if (requestedPublic && !cfg.behindTlsProxy && !cfg.allowInsecureHttp) {
    listenHost = '127.0.0.1';
    blockedPlaintextPublic = true;
  }

  const exposed = !isLoopbackHost(listenHost) || cfg.behindTlsProxy;
  if (exposed && !token) {
    token = crypto.randomBytes(24).toString('hex');
  }
  const server = createServer({ token });

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${cfg.port} is already in use. Set PORT=xxxx or stop the other process.`);
      }
      reject(err);
    });
    server.listen(cfg.port, listenHost, () => {
      const url = `http://${listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost}:${cfg.port}`;
      const sys = platform.getSystemSummary();
      console.log(`\n============================================================`);
      console.log(`🦅 AetherClaw (灵爪) Autonomous Agent Framework v${pkg.version}`);
      console.log(`🖥️  OS Runtime : ${sys.osType} (${platform.getDefaultShell()}) | Sandbox: ${cfg.sandboxMode || 'host'}`);
      console.log(`🌐 Web Console: ${url}`);
      if (blockedPlaintextPublic) {
        console.log(`🛡️  [安全护栏] 已自动阻止纯明文公网绑定 (${cfg.host}) 并回退至本地回环 (127.0.0.1)。`);
        console.log(`   👉 生产环境请前置 Nginx (deploy/nginx.conf) 或 Caddy (deploy/Caddyfile) 配置 HTTPS/TLS，`);
        console.log(`      或设置 BEHIND_TLS_PROXY=true 与 AETHERCLAW_TOKEN 后启动。`);
      }
      if (token) {
        console.log(`🔐 Header Bearer Token 鉴权已启用 (Authorization: Bearer <token>)`);
        console.log(`   Token: ${token}`);
      }
      console.log(`============================================================\n`);
      if (openBrowser) platform.openBrowser(url);
      resolve({ server, url, token, listenHost });
    });

    const shutdown = () => {
      console.log('\n👋 Shutting down AetherClaw...');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

module.exports = { createServer, startWebServer };
