/**
 * AetherClaw (灵爪) - Runtime paths & atomic file helpers
 * 通过环境变量 AETHERCLAW_HOME 可以把 data/ 与 skills/ 重定向到任意目录（测试、Docker、多实例隔离）。
 */
const fs = require('fs');
const path = require('path');

const HOME = process.env.AETHERCLAW_HOME
  ? path.resolve(process.env.AETHERCLAW_HOME)
  : process.cwd();

const DATA_DIR = path.join(HOME, 'data');
const SKILLS_DIR = path.join(HOME, 'skills');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 原子写入：先写临时文件再 rename，进程崩溃/断电也不会留下半截 JSON。 */
function atomicWrite(file, content, mode) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, mode ? { encoding: 'utf8', mode } : 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { HOME, DATA_DIR, SKILLS_DIR, ensureDir, atomicWrite };
