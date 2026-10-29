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

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > MAX_BODY) {
        tooLarge = true;
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
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
      // 1) Host 校验 (DNS rebinding)
      const cfg = config.get();
      if (isLoopbackHost(cfg.host) && !isLoopbackHost(hostnameOf(req.headers.host))) {
        return sendJson(res, 403, { error: 'Forbidden: invalid Host header' });
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

      // 3) Token 鉴权（API 路径；页面本身不含敏感数据）
      if (pathname.startsWith('/api/') && token) {
        const supplied = req.headers['x-aetherclaw-token'] || urlObj.searchParams.get('token') || '';
        if (!timingSafeEqual(supplied, token)) {
          return sendJson(res, 401, { error: 'Unauthorized: missing or invalid token' });
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

      if (req.method === 'GET' && (pathname === '/assets/logo.png' || pathname === '/favicon.ico')) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(LOGO_PATH));
      }

      if (req.method === 'GET' && pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, version: pkg.version, uptimeMs: Date.now() - startedAt });
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
        const send = (event, data) => {
          if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        busy++;
        try {
          const result = await agent.run(prompt, (step) => send('step', step));
          send('done', {
            mode: result.mode,
            finalAnswer: result.finalAnswer,
            memories: memory.state.semanticMemories,
            skills: memory.listSkills(),
            episodes: memory.state.episodicHistory.slice(0, 15)
          });
        } catch (err) {
          send('error', { error: err.message || 'Agent failed' });
        } finally {
          busy--;
          res.end();
        }
        return;
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
        const id = decodeURIComponent(pathname.replace('/api/memory/', ''));
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
          commandTemplate: { win32: body.win32Command || '', linux: body.linuxCommand || '' }
        });
        return sendJson(res, 200, { success: true, skill, skills: memory.listSkills() });
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
  let token = process.env.AETHERCLAW_TOKEN || '';
  const exposed = !isLoopbackHost(cfg.host);
  if (exposed && !token) {
    token = crypto.randomBytes(16).toString('hex');
  }
  const server = createServer({ token });

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${cfg.port} is already in use. Set PORT=xxxx or stop the other process.`);
      }
      reject(err);
    });
    server.listen(cfg.port, cfg.host, () => {
      const base = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`;
      const url = token ? `${base}/?token=${token}` : base;
      const sys = platform.getSystemSummary();
      console.log(`\n============================================================`);
      console.log(`🦅 AetherClaw (灵爪) Autonomous Agent Framework v${pkg.version}`);
      console.log(`🖥️  OS Runtime : ${sys.osType} (${platform.getDefaultShell()})`);
      console.log(`🌐 Web Console: ${url}`);
      if (exposed) {
        console.log(`🔐 Listening on ${cfg.host} (network-exposed) — token auth is REQUIRED.`);
        console.log(`   Token: ${token}`);
      }
      console.log(`============================================================\n`);
      if (openBrowser) platform.openBrowser(url);
      resolve({ server, url, token });
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
