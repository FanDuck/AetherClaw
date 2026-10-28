/**
 * AetherClaw (灵爪) - Visual Web Console HTTP & REST API Server
 * 零第三方重依赖，基于 Node.js 原生 HTTP 模块构建，在 Windows 与 Linux 下即装即用。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const platform = require('../core/platform');
const config = require('../core/config');
const memory = require('../core/memory');
const agent = require('../core/agent');
const { TOOLS } = require('../tools');

const UI_HTML_PATH = path.join(__dirname, '..', 'ui', 'index.html');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024 * 2) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 200, { ok: true });
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = urlObj.pathname;

    try {
      // Serve Web Console UI
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = fs.readFileSync(UI_HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // System & Dashboard Overview
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, {
          system: platform.getSystemSummary(),
          config: config.getSafeConfig(),
          memories: memory.state.semanticMemories,
          episodes: memory.state.episodicHistory.slice(0, 15),
          skills: memory.listSkills(),
          tools: Object.values(TOOLS).map(t => ({
            name: t.name,
            description: t.description
          }))
        });
      }

      // Update Configuration (Zero-Code API Config)
      if (req.method === 'POST' && pathname === '/api/config') {
        const body = await parseBody(req);
        const updated = config.update(body);
        return sendJson(res, 200, { success: true, config: updated });
      }

      // Chat / Run Autonomous Agent Task
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await parseBody(req);
        const prompt = (body.prompt || '').trim();
        if (!prompt) {
          return sendJson(res, 400, { error: 'Prompt cannot be empty' });
        }
        const result = await agent.run(prompt);
        return sendJson(res, 200, {
          ...result,
          memories: memory.state.semanticMemories,
          skills: memory.listSkills(),
          episodes: memory.state.episodicHistory.slice(0, 15)
        });
      }

      // Add Semantic Memory manually
      if (req.method === 'POST' && pathname === '/api/memory') {
        const body = await parseBody(req);
        const item = memory.addMemory({
          content: body.content,
          category: body.category || 'knowledge',
          tags: body.tags || []
        });
        return sendJson(res, 200, {
          success: true,
          memory: item,
          memories: memory.state.semanticMemories
        });
      }

      // Delete Semantic Memory
      if (req.method === 'DELETE' && pathname.startsWith('/api/memory/')) {
        const id = decodeURIComponent(pathname.replace('/api/memory/', ''));
        memory.deleteMemory(id);
        return sendJson(res, 200, {
          success: true,
          memories: memory.state.semanticMemories
        });
      }

      // Create or Evolve Skill manually
      if (req.method === 'POST' && pathname === '/api/skills') {
        const body = await parseBody(req);
        const skill = memory.createOrUpdateSkill({
          id: body.id,
          name: body.name,
          description: body.description,
          triggerKeywords: body.triggerKeywords || [],
          steps: body.steps || [],
          commandTemplate: {
            win32: body.win32Command || '',
            linux: body.linuxCommand || ''
          }
        });
        return sendJson(res, 200, {
          success: true,
          skill,
          skills: memory.listSkills()
        });
      }

      return sendJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });
}

function startWebServer({ openBrowser = false } = {}) {
  const cfg = config.get();
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      const url = `http://${cfg.host}:${cfg.port}`;
      console.log(`\n============================================================`);
      console.log(`🦅 AetherClaw (灵爪) Autonomous Agent Framework v1.0.0`);
      console.log(`🖥️  OS Runtime : ${platform.getSystemSummary().osType} (${platform.getDefaultShell()})`);
      console.log(`🌐 Web Console: ${url}`);
      console.log(`============================================================\n`);
      if (openBrowser) {
        platform.openBrowser(url);
      }
      resolve({ server, url });
    });
  });
}

module.exports = {
  createServer,
  startWebServer
};
