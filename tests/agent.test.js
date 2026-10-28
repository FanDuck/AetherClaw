/**
 * AetherClaw (灵爪) - Cross-Platform Automated Unit & Integration Tests
 * Validates Windows & Linux OS adaptation, safety guardrails, Hermes memory, skill evolution, and Agent execution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../src/core/platform');
const memory = require('../src/core/memory');
const agent = require('../src/core/agent');
const { runTool } = require('../src/tools');

test('1. Cross-Platform Adapter detects OS and shell properly', () => {
  const summary = platform.getSystemSummary();
  assert.ok(summary.osType);
  assert.ok(summary.shell);
  assert.ok(summary.cpuCores >= 1);
});

test('2. Safety Guardrail blocks destructive shell commands', () => {
  const check1 = platform.checkSafety('rm -rf /');
  assert.equal(check1.safe, false);
  const check2 = platform.checkSafety('echo hello');
  assert.equal(check2.safe, true);
});

test('3. Hermes Semantic Memory stores and retrieves knowledge', async () => {
  const res = await runTool('memory_store', {
    content: 'Unit test verification memory item',
    category: 'test',
    tags: ['unittest']
  });
  assert.equal(res.success, true);
  assert.ok(res.memory.id);

  const recall = await runTool('memory_recall', { query: 'verification' });
  assert.ok(recall.matches.some(m => m.id === res.memory.id));

  memory.deleteMemory(res.memory.id);
});

test('4. Hermes Procedural Skill Evolution creates JSON + SKILL.md', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const res = await runTool('skill_create', {
    id: 'test_skill_demo',
    name: 'Test Skill Demo',
    description: 'Automated test skill',
    triggerKeywords: ['test_demo'],
    steps: ['Step 1', 'Step 2'],
    win32Command: 'Get-Date',
    linuxCommand: 'date'
  });
  assert.equal(res.success, true);
  assert.equal(res.skill.id, 'test_skill_demo');
  // Clean up test skill files
  const jsonFile = path.join(process.cwd(), 'skills', 'test_skill_demo.json');
  const mdFile = path.join(process.cwd(), 'skills', 'test_skill_demo.md');
  if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
  if (fs.existsSync(mdFile)) fs.unlinkSync(mdFile);
});

test('5. Autonomous Agent executes health check end-to-end', async () => {
  const result = await agent.run('分析当前目录的文件结构');
  assert.ok(result.finalAnswer.includes('当前项目目录分析报告'));
  assert.ok(Array.isArray(result.steps));
  assert.ok(result.steps.length >= 2);
});
