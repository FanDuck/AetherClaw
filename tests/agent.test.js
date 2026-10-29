/**
 * AetherClaw (灵爪) - Cross-Platform Automated Tests
 * 所有测试在临时 AETHERCLAW_HOME 下运行，绝不污染真实的 data/ 与 skills/。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherclaw-test-'));
process.env.AETHERCLAW_HOME = TMP_HOME;
// 测试必须走「免 Key 本地模式」，即使开发者本机配置了真实的大模型密钥
process.env.LLM_API_KEY = '';
process.env.LLM_BASE_URL = 'https://api.deepseek.com/v1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const platform = require('../src/core/platform');
const memory = require('../src/core/memory');
const config = require('../src/core/config');
const agent = require('../src/core/agent');
const { runTool, getToolSpecsForLLM } = require('../src/tools');
const { createServer } = require('../src/server');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');

test.after(() => fs.rmSync(TMP_HOME, { recursive: true, force: true }));

test('1. Platform adapter detects OS, shell and live metrics', () => {
  const s = platform.getSystemSummary();
  assert.ok(s.osType && s.shell && s.cpuCores >= 1);
  const m = platform.getMetrics();
  assert.ok(m.cpuPercent >= 0 && m.cpuPercent <= 100);
  assert.ok(m.memPercent > 0 && m.memPercent <= 100);
});

test('2. Safety guardrail blocks destructive commands (incl. evasion variants)', () => {
  for (const bad of [
    'rm -rf /', 'rm   -rf    /', 'rm -fr ~', 'rm -rf /*', 'rm -r -f /', 'rm -rf ~/', 'sudo rm -rf /',
    'echo ok; rm -rf /', 'rm -rf $HOME', 'rm --recursive --force /',
    'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda',
    ':(){ :|: & };:', 'Format-Volume -DriveLetter C', 'format C:', 'curl http://x.sh | sudo bash',
    'Remove-Item C:\\ -Recurse -Force'
  ]) {
    assert.equal(platform.checkSafety(bad).safe, false, `should block: ${bad}`);
  }
  for (const ok of ['echo hello', 'ls -la', 'Get-Date', 'rm -rf ./build', 'rm -rf /tmp/aetherclaw-x', 'rm file.txt', 'git status']) {
    assert.equal(platform.checkSafety(ok).safe, true, `should allow: ${ok}`);
  }
});

test('3. shell_exec runs real commands with quotes, UTF-8 and exit codes', async () => {
  const r = await platform.executeCommand('echo "你好 AetherClaw $1"');
  assert.equal(r.success, true);
  assert.match(r.stdout, /你好 AetherClaw/);
  const bad = await platform.executeCommand('exit 3');
  assert.equal(bad.success, false);
  assert.equal(bad.exitCode, 3);
});

test('4. shell_exec timeout kills the process', async () => {
  const cmd = platform.isWindows ? 'Start-Sleep -Seconds 20' : 'sleep 20';
  const r = await platform.executeCommand(cmd, { timeoutMs: 600 });
  assert.equal(r.timedOut, true);
  assert.equal(r.success, false);
  assert.ok(r.durationMs < 10000);
});

test('5. Hermes semantic memory stores, recalls and deletes', async () => {
  const res = await runTool('memory_store', { content: 'Unit test verification memory', category: 'test', tags: ['unittest'] });
  assert.equal(res.success, true);
  const recall = await runTool('memory_recall', { query: 'verification' });
  assert.ok(recall.matches.some(m => m.id === res.memory.id));
  assert.equal(memory.deleteMemory(res.memory.id), true);
});

test('6. Skill evolution writes JSON + SKILL.md and sanitizes ids', async () => {
  const res = await runTool('skill_create', {
    id: '../../evil id', name: 'Test Skill', description: 'd', triggerKeywords: ['t'], steps: ['a'],
    win32Command: 'Get-Date', linuxCommand: 'date'
  });
  assert.equal(res.success, true);
  assert.doesNotMatch(res.skill.id, /[\\/.]/);
  assert.ok(fs.existsSync(path.join(TMP_HOME, 'skills', `${res.skill.id}.md`)));
  assert.ok(fs.existsSync(path.join(TMP_HOME, 'skills', `${res.skill.id}.json`)));
});

test('7. Agent streams steps and produces a report end-to-end', async () => {
  const seen = [];
  const result = await agent.run('分析当前目录的文件结构', (s) => seen.push(s.type));
  assert.match(result.finalAnswer, /目录分析报告/);
  assert.ok(seen.includes('tool_call') && seen.includes('observation'));
});

// ---------- HTTP server security ----------
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('8. Server: serves UI, blocks cross-origin & rebinding, sets security headers', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const ui = await request(port, { path: '/', headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(ui.status, 200);
    assert.ok(ui.headers['content-security-policy']);
    assert.equal(ui.headers['x-content-type-options'], 'nosniff');

    const logo = await request(port, { path: '/assets/logo.png', headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(logo.status, 200);
    assert.equal(logo.headers['content-type'], 'image/png');

    const evilOrigin = await request(port, {
      method: 'POST', path: '/api/chat', body: '{"prompt":"x"}',
      headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }
    });
    assert.equal(evilOrigin.status, 403);

    const rebinding = await request(port, { path: '/api/status', headers: { Host: 'evil.example' } });
    assert.equal(rebinding.status, 403);

    const ok = await request(port, { path: '/api/status', headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(ok.status, 200);
    assert.ok(JSON.parse(ok.body).tools.length >= 9);
    assert.ok(!('apiKey' in JSON.parse(ok.body).config));
  } finally {
    server.close();
  }
});

test('9. Server: token auth enforced and SSE stream delivers steps + done', async () => {
  const server = createServer({ token: 's3cret' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const H = { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await request(port, { path: '/api/status', headers: H })).status, 401);
    const stream = await request(port, {
      method: 'POST', path: '/api/chat/stream', body: JSON.stringify({ prompt: '分析当前目录的文件结构' }),
      headers: { ...H, 'x-aetherclaw-token': 's3cret' }
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers['content-type'], /text\/event-stream/);
    assert.match(stream.body, /event: step/);
    assert.match(stream.body, /event: done/);
  } finally {
    server.close();
  }
});

// ---------- 回归测试：本轮审查修复的问题 ----------

test('10. CLI entry (bin/aetherclaw.js) really runs: --version / --help / --run validation', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aetherclaw.js'), ...args], { encoding: 'utf8', env: process.env });
  const v = run('--version');
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), pkg.version);
  assert.match(run('--help').stdout, /Usage:/);
  const missing = run('--run');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--run/);
});

test('11. Memory recall works for Chinese text (bigram matching) and strict mode returns nothing for unrelated queries', async () => {
  const saved = await runTool('memory_store', { content: '用户偏好结构化中文技术汇报', category: 'user_preference' });
  try {
    const hit = await runTool('memory_recall', { query: '我喜欢简洁的中文技术报告' });
    assert.ok(hit.matches.some(m => m.id === saved.memory.id), 'Chinese query should hit the Chinese memory');
    const miss = await runTool('memory_recall', { query: 'zzqqxx_no_such_thing' });
    assert.deepEqual(miss.matches, []);
  } finally {
    memory.deleteMemory(saved.memory.id);
  }
  assert.ok(memory.tokenize('中文技术').includes('技术'));
});

test('12. "执行技能" really executes the skill command and counts usage without bumping version', async () => {
  const before = memory.listSkills().find(s => s.id === 'sys_health_check');
  const res = await agent.run('执行技能: sys_health_check');
  assert.match(res.finalAnswer, /技能已执行/);
  assert.ok(res.steps.some(s => s.type === 'tool_call' && s.tool === 'shell_exec'));
  const after = memory.listSkills().find(s => s.id === 'sys_health_check');
  assert.equal(after.usageCount, before.usageCount + 1);
  assert.equal(after.version, before.version);
  const none = await agent.run('执行技能: 不存在的技能名称xyz');
  assert.match(none.finalAnswer, /没有找到/);
});

test('13. Config: .env parser, baseUrl validation, key masking, never leaks apiKey', () => {
  const env = config.parseEnv('# c\nA=1\nexport B="two words"\nC=\'x\' # tail\nD=val # comment\n\nbad line');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x', D: 'val' });

  assert.throws(() => config.update({ baseUrl: 'ftp://nope' }), /http\(s\)/);
  assert.throws(() => config.update({ baseUrl: 'javascript:alert(1)' }), /http\(s\)/);
  try {
    const short = config.update({ apiKey: 'short' });
    assert.equal(short.apiKeyMasked, '****');
    const long = config.update({ apiKey: 'sk-1234567890abcdef' });
    assert.equal(long.apiKeyMasked, 'sk-1...cdef');
    assert.ok(!('apiKey' in long));
    assert.ok(!JSON.stringify(long).includes('1234567890'));
  } finally {
    config.update({ clearApiKey: true });
  }
});

test('14. File tools: secrets are protected, allowFileWrite is honored, binary files refused', async () => {
  const denyRead = await runTool('file_read', { filePath: '.env' });
  assert.match(denyRead.error, /protected|denied/i);
  const denyCfg = await runTool('file_read', { filePath: path.join(TMP_HOME, 'data', 'config.local.json') });
  assert.match(denyCfg.error, /denied/i);
  const denyWrite = await runTool('file_write', { filePath: path.join(TMP_HOME, 'sub', '.env'), content: 'X=1' });
  assert.match(denyWrite.error, /denied/i);

  const target = path.join(TMP_HOME, 'sub', 'hello.txt');
  const w = await runTool('file_write', { filePath: target, content: '你好, AetherClaw' });
  assert.equal(w.success, true);
  const r = await runTool('file_read', { filePath: target });
  assert.equal(r.content, '你好, AetherClaw');

  fs.writeFileSync(path.join(TMP_HOME, 'bin.dat'), Buffer.from([1, 2, 0, 3, 4]));
  assert.match((await runTool('file_read', { filePath: path.join(TMP_HOME, 'bin.dat') })).error, /Binary/);

  try {
    config.update({ allowFileWrite: false });
    const blocked = await runTool('file_write', { filePath: target, content: 'nope' });
    assert.match(blocked.error, /disabled/);
  } finally {
    config.update({ allowFileWrite: true });
  }
});

test('15. autoEvolveSkills=false hides skill_create from the LLM; unknown tools are rejected safely', async () => {
  assert.ok(getToolSpecsForLLM({ autoEvolveSkills: true }).some(t => t.function.name === 'skill_create'));
  assert.ok(!getToolSpecsForLLM({ autoEvolveSkills: false }).some(t => t.function.name === 'skill_create'));
  assert.match((await runTool('constructor', {})).error, /Unknown tool/);
  assert.match((await runTool('__proto__', {})).error, /Unknown tool/);
});

test('16. web_fetch only allows http(s) URLs', async () => {
  assert.match((await runTool('web_fetch', { url: 'file:///etc/passwd' })).error, /http/);
  assert.match((await runTool('web_fetch', { url: 'not a url' })).error, /Invalid URL/);
});

test('17. Server: multi-byte UTF-8 split across TCP chunks is decoded correctly; bad config is rejected', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const host = `127.0.0.1:${port}`;
  try {
    const payload = Buffer.from(JSON.stringify({ content: '你好世界-分块测试', category: 'chunk_test' }), 'utf8');
    const split = payload.indexOf(Buffer.from('你', 'utf8')) + 1; // 切在「你」的 3 个字节中间
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/memory',
        headers: { Host: host, 'Content-Type': 'application/json', 'Content-Length': payload.length }
      }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
      req.on('error', reject);
      req.write(payload.subarray(0, split));
      setTimeout(() => req.end(payload.subarray(split)), 80);
    });
    assert.equal(res.status, 200);
    const stored = JSON.parse(res.body).memory;
    assert.equal(stored.content, '你好世界-分块测试');
    memory.deleteMemory(stored.id);

    const badCfg = await request(port, {
      method: 'POST', path: '/api/config', body: JSON.stringify({ baseUrl: 'ftp://x' }),
      headers: { Host: host, 'Content-Type': 'application/json' }
    });
    assert.equal(badCfg.status, 400);
  } finally {
    server.close();
  }
});

test('18. Multi-turn context: follow-up saves last result to file and conversation can be cleared', async () => {
  await agent.run('分析当前目录的文件结构');
  const recent = memory.getRecentConversation(2);
  assert.ok(recent.length >= 2);
  assert.equal(recent[recent.length - 1].role, 'assistant');

  const outPath = path.join(TMP_HOME, '巡检报告.md');
  const follow = await agent.run(`把刚才的结果保存为 ${outPath}`);
  assert.match(follow.finalAnswer, /保存为文件/);
  assert.ok(fs.existsSync(outPath));
  fs.unlinkSync(outPath);

  memory.clearEpisodes();
  assert.equal(memory.getRecentConversation(5).length, 0);
});

test('19. Skill import/export/delete and built-in skill protection', () => {
  const sampleMd = [
    '---',
    'id: imported_demo',
    'name: 导入测试技能',
    '---',
    '# 导入测试技能',
    '> 从 SKILL.md 导入的跨平台技能',
    '## Trigger Keywords',
    '- `导入测试`',
    '- `demo_import`',
    '## Execution Steps',
    '1. 第一步检查',
    '2. 第二步汇报',
    '## Cross-Platform Command Templates',
    '- **Windows (PowerShell)**: `Get-Date`',
    '- **Linux (Bash)**: `date`'
  ].join('\n');

  const imported = memory.importSkillFromMarkdown(sampleMd);
  assert.equal(imported.id, 'imported_demo');
  assert.equal(imported.commandTemplate.win32, 'Get-Date');
  assert.equal(imported.commandTemplate.linux, 'date');

  const exported = memory.getSkillMarkdown('imported_demo');
  assert.ok(exported && exported.markdown.includes('导入测试技能'));

  assert.equal(memory.deleteSkill('imported_demo'), true);
  assert.equal(memory.getSkillMarkdown('imported_demo'), null);

  assert.throws(() => memory.deleteSkill('sys_health_check'), /Built-in skill/);
});

test('20. Native LLM SSE stream parser emits token deltas and reassembles tool_calls', async () => {
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"，世界！"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"system_","arguments":"{\\"a\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"info","arguments":"1}"}}]}}]}\n\n',
    'data: [DONE]\n\n'
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of sseChunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    }
  });
  const tokens = [];
  const msg = await agent.consumeLLMStream({ body: stream }, (d) => tokens.push(d));
  assert.equal(tokens.join(''), '你好，世界！');
  assert.equal(msg.content, '你好，世界！');
  assert.equal(msg.tool_calls.length, 1);
  assert.equal(msg.tool_calls[0].function.name, 'system_info');
  assert.equal(msg.tool_calls[0].function.arguments, '{"a":1}');
});

test('21. Regression: clearing skill commands, Chinese skill ID non-collision, and malformed URL handling', async () => {
  // 1) Chinese skill names with shared ASCII suffixes must not collide when id is omitted
  const s1 = memory.createOrUpdateSkill({ name: '清理 v1', description: '清理缓存', win32Command: 'echo 1' });
  const s2 = memory.createOrUpdateSkill({ name: '转换 v1', description: '转换格式', win32Command: 'echo 2' });
  assert.notEqual(s1.id, s2.id);

  // 2) Updating a skill with empty string "" must clear the command template rather than keeping the old one
  const updated = memory.createOrUpdateSkill({ id: s1.id, name: '清理 v1', win32Command: '' });
  assert.equal(updated.commandTemplate.win32, '');
  memory.deleteSkill(s1.id);
  memory.deleteSkill(s2.id);

  // 3) Malformed percent-encoded URL must return 400 instead of crashing with 500 URIError
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const badUrl = await request(port, {
      method: 'DELETE',
      path: '/api/memory/%E0%A4%A',
      headers: { Host: `127.0.0.1:${port}` }
    });
    assert.equal(badUrl.status, 400);
  } finally {
    server.close();
  }
});

test('22. API Key Vault (add/switch/delete/clear) & real-time API connectivity test + model list fetch', async () => {
  // Mock OpenAI-compatible server for connectivity and models endpoint
  const mockLLM = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || '';
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }));
    }
    if (req.url === '/v1/chat/completions') {
      if (auth !== 'Bearer sk-valid-secret-key-123456') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ message: { role: 'assistant', content: 'OK' } }]
      }));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => mockLLM.listen(0, '127.0.0.1', r));
  const llmPort = mockLLM.address().port;
  const mockBaseUrl = `http://127.0.0.1:${llmPort}/v1`;

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const host = `127.0.0.1:${port}`;

  try {
    // 1) Save two API profiles into the vault
    const p1Res = await request(port, {
      method: 'POST', path: '/api/config/profiles',
      headers: { Host: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '主力有效Key', baseUrl: mockBaseUrl, model: 'deepseek-chat', apiKey: 'sk-valid-secret-key-123456' })
    });
    assert.equal(p1Res.status, 200);
    const cfg1 = JSON.parse(p1Res.body).config;
    assert.equal(cfg1.apiProfiles.length, 1);
    assert.equal(cfg1.apiProfiles[0].apiKey, undefined); // never leaks plaintext key
    assert.equal(cfg1.apiProfiles[0].apiKeyMasked, 'sk-v...3456');

    const p2Res = await request(port, {
      method: 'POST', path: '/api/config/profiles',
      headers: { Host: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '备用失效Key', baseUrl: mockBaseUrl, model: 'deepseek-chat', apiKey: 'sk-invalid-key-00000000' })
    });
    const cfg2 = JSON.parse(p2Res.body).config;
    assert.equal(cfg2.apiProfiles.length, 2);
    const profValidId = cfg2.apiProfiles.find(p => p.name === '主力有效Key').id;
    const profInvalidId = cfg2.apiProfiles.find(p => p.name === '备用失效Key').id;

    // 2) Test connectivity of the invalid profile -> ok: false, status: 401
    const badTest = await request(port, {
      method: 'POST', path: '/api/config/test',
      headers: { Host: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profInvalidId })
    });
    const badData = JSON.parse(badTest.body);
    assert.equal(badData.ok, false);
    assert.equal(badData.status, 401);
    assert.match(badData.diagnosis, /鉴权失败/);

    // 3) Activate the valid profile and test connectivity -> ok: true, status: 200
    const actRes = await request(port, {
      method: 'POST', path: `/api/config/profiles/${profValidId}/activate`,
      headers: { Host: host }
    });
    assert.equal(JSON.parse(actRes.body).config.activeProfileId, profValidId);

    const okTest = await request(port, {
      method: 'POST', path: '/api/config/test',
      headers: { Host: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const okData = JSON.parse(okTest.body);
    assert.equal(okData.ok, true);
    assert.equal(okData.status, 200);
    assert.match(okData.diagnosis, /连通成功/);

    // 4) Fetch models list
    const modelsRes = await request(port, {
      method: 'POST', path: '/api/config/models',
      headers: { Host: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: mockBaseUrl })
    });
    const modelsData = JSON.parse(modelsRes.body);
    assert.deepEqual(modelsData.models, ['deepseek-chat', 'deepseek-reasoner']);

    // 5) Delete profiles and clear active API key
    await request(port, { method: 'DELETE', path: `/api/config/profiles/${profInvalidId}`, headers: { Host: host } });
    await request(port, { method: 'DELETE', path: `/api/config/profiles/${profValidId}`, headers: { Host: host } });
    const clrRes = await request(port, { method: 'DELETE', path: '/api/config/apikey', headers: { Host: host } });
    const finalCfg = JSON.parse(clrRes.body).config;
    assert.equal(finalCfg.hasApiKey, false);
    assert.equal(finalCfg.apiProfiles.length, 0);
  } finally {
    server.close();
    mockLLM.close();
  }
});

test('23. Edge-case fixes: saveProfile reuses active key & deduplicates, clearApiKey resets local LLM URL, and AbortSignal cancels run cleanly', async () => {
  // 1) Set an active API key via update(), then call saveProfile() without passing apiKey -> reuses active key and deduplicates
  config.update({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-active-reuse-key-9999' });
  const afterFirst = config.saveProfile({ name: '复用测试', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' });
  assert.equal(afterFirst.apiProfiles.length, 1);
  assert.equal(afterFirst.apiProfiles[0].apiKeyMasked, 'sk-a...9999');

  // Calling saveProfile again with identical name+baseUrl+model updates in-place instead of duplicating
  const afterSecond = config.saveProfile({ name: '复用测试', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' });
  assert.equal(afterSecond.apiProfiles.length, 1);
  config.deleteProfile(afterSecond.apiProfiles[0].id);

  // 2) If baseUrl was set to local Ollama (http://127.0.0.1:11434/v1), clearApiKey resets baseUrl so zero-key local mode is restored
  config.update({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' });
  const resetCfg = config.update({ clearApiKey: true });
  assert.equal(resetCfg.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(resetCfg.hasApiKey, false);

  // 3) Pre-aborted AbortSignal cancels agent.run cleanly without falling back to local engine
  const ac = new AbortController();
  ac.abort();
  const abortedRes = await agent.run('请对当前系统进行全面健康巡检', null, { signal: ac.signal });
  assert.equal(abortedRes.mode, 'aborted');
});

test('24. Enterprise hardening: Docker/gVisor sandbox args, Header Bearer Token (no URL ?token= leak), TLS proxy guard, and PM2/systemd/GHCR configs', async () => {
  // 1) Restricted Docker & gVisor (runsc) sandbox argument builder
  const dockerSbx = platform.buildSandboxArgs('echo hello', { sandboxMode: 'docker', allowFileWrite: false });
  assert.ok(dockerSbx.args.includes('--cap-drop=ALL'));
  assert.ok(dockerSbx.args.includes('--security-opt=no-new-privileges'));
  assert.ok(dockerSbx.args.includes('--read-only'));
  assert.ok(dockerSbx.args.includes('--network=none'));
  assert.ok(dockerSbx.args.includes('--mount'));
  assert.ok(dockerSbx.args.some(a => a.includes('target=/workspace,readonly')));

  const execTarget = platform.getExecTarget('docker');
  assert.equal(execTarget.isWindows, false);
  assert.equal(execTarget.sandboxed, true);

  const gvisorSbx = platform.buildSandboxArgs('uname -a', { sandboxMode: 'gvisor', sandboxMemoryMB: 512 });
  assert.ok(gvisorSbx.args.includes('--runtime=runsc'));
  assert.ok(gvisorSbx.args.includes('--memory=512m'));

  // 2) Authorization: Bearer <token> accepted, URL ?token= rejected, behindTlsProxy enforced
  const server = createServer({ token: 'bearer_secret_2026' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const host = `127.0.0.1:${port}`;
  try {
    // URL query ?token= must be rejected (401) to prevent plaintext token leakage in logs/history
    const urlLeakTry = await request(port, { path: '/api/status?token=bearer_secret_2026', headers: { Host: host } });
    assert.equal(urlLeakTry.status, 401);
    assert.match(urlLeakTry.headers['www-authenticate'] || '', /Bearer/);

    // Standard Authorization: Bearer <token> header succeeds (200)
    const bearerOk = await request(port, {
      path: '/api/status',
      headers: { Host: host, Authorization: 'Bearer bearer_secret_2026' }
    });
    assert.equal(bearerOk.status, 200);

    // When behindTlsProxy=true, plaintext X-Forwarded-Proto: http is rejected with 403
    config.update({ behindTlsProxy: true });
    const plainHttp = await request(port, {
      path: '/api/status',
      headers: { Host: host, Authorization: 'Bearer bearer_secret_2026', 'X-Forwarded-Proto': 'http' }
    });
    assert.equal(plainHttp.status, 403);

    const tlsHttps = await request(port, {
      path: '/api/status',
      headers: { Host: host, Authorization: 'Bearer bearer_secret_2026', 'X-Forwarded-Proto': 'https' }
    });
    assert.equal(tlsHttps.status, 200);
  } finally {
    config.update({ behindTlsProxy: false, sandboxMode: 'host' });
    server.close();
  }

  // 3) Official deployment files exist and are valid (pm2.config.js, systemd unit, Caddyfile, nginx.conf, GHCR workflow)
  const pm2Cfg = require('../pm2.config.js');
  assert.ok(Array.isArray(pm2Cfg.apps) && pm2Cfg.apps[0].name === 'aetherclaw');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'deploy', 'aetherclaw.service')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'deploy', 'Caddyfile')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'deploy', 'nginx.conf')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'docker-publish.yml')));
});

test('25. Runtime enforcement of autoEvolveSkills=false and full 9-tool coverage in zero-key local engine', async () => {
  // 1) Runtime check in skill_create.execute when autoEvolveSkills=false
  try {
    config.update({ autoEvolveSkills: false });
    const blocked = await runTool('skill_create', { id: 'nope', name: 'nope', description: 'nope', steps: ['1'] });
    assert.match(blocked.error, /disabled/);
  } finally {
    config.update({ autoEvolveSkills: true });
  }

  // 2) Local autonomous engine supports file_read and memory_recall intents directly
  const readRes = await agent.run('读取文件: package.json');
  assert.match(readRes.finalAnswer, /aetherclaw/);

  const recallRes = await agent.run('查看记忆');
  assert.match(recallRes.finalAnswer, /Hermes 长期记忆检索结果/);
});
