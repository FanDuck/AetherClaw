/**
 * AetherClaw (灵爪) - Autonomous Task Scheduler (OpenClaw Heartbeat & Cron Engine)
 * 支持在后台按固定周期自动唤醒 Agent 执行巡检、整理或自定义指令，
 * 并可在任务完成后自动通过 Webhook（飞书/钉钉/企业微信/Bark/自定义）推送报告。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, ensureDir, atomicWrite } = require('./paths');

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');

class TaskScheduler {
  constructor() {
    this.ensureDir();
    this.schedules = this.load();
    this.timer = null;
    this.runningIds = new Set();
    this.runner = null; // (schedule) => Promise<{ finalAnswer, mode }>
    this.notifier = null; // ({ title, content }) => Promise<any>
  }

  ensureDir() {
    ensureDir(DATA_DIR);
  }

  load() {
    if (fs.existsSync(SCHEDULES_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {
        // Ignore corrupt schedule file and start clean
      }
    }
    return [];
  }

  save() {
    this.ensureDir();
    atomicWrite(SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2));
  }

  /**
   * 绑定 Agent 执行器与通知推送器
   */
  bind({ runner, notifier } = {}) {
    if (typeof runner === 'function') this.runner = runner;
    if (typeof notifier === 'function') this.notifier = notifier;
  }

  /**
   * 启动后台定时巡检轮询（使用 unref() 避免阻塞测试或进程退出）
   */
  start(pollIntervalMs = 15000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, pollIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list() {
    return this.schedules.map(s => ({ ...s }));
  }

  /**
   * 新增或更新一条定时任务
   */
  createOrUpdate(input = {}) {
    const name = String(input.name || '').trim();
    const prompt = String(input.prompt || '').trim();
    if (!prompt) {
      throw Object.assign(new Error('定时任务指令 (prompt) 不能为空'), { status: 400 });
    }
    const intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(input.intervalMinutes) || 60)));
    const enabled = input.enabled !== false;
    const notifyOnComplete = Boolean(input.notifyOnComplete);

    const existingIdx = input.id ? this.schedules.findIndex(s => s.id === input.id) : -1;
    const now = Date.now();
    const id = existingIdx >= 0 ? this.schedules[existingIdx].id : `sched_${crypto.randomBytes(4).toString('hex')}`;
    const prev = existingIdx >= 0 ? this.schedules[existingIdx] : {};

    const entry = {
      id,
      name: name || prompt.slice(0, 28),
      prompt,
      intervalMinutes,
      enabled,
      notifyOnComplete,
      createdAt: prev.createdAt || new Date(now).toISOString(),
      lastRunAt: prev.lastRunAt || null,
      nextRunAt: enabled ? new Date(now + intervalMinutes * 60 * 1000).toISOString() : null,
      lastStatus: prev.lastStatus || 'idle',
      lastResultPreview: prev.lastResultPreview || '',
      runCount: prev.runCount || 0
    };

    if (existingIdx >= 0) {
      this.schedules[existingIdx] = entry;
    } else {
      this.schedules.unshift(entry);
    }
    this.save();
    return { ...entry };
  }

  /**
   * 切换定时任务启停状态
   */
  toggle(id, enabled) {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx < 0) {
      throw Object.assign(new Error(`未找到定时任务: ${id}`), { status: 404 });
    }
    const target = this.schedules[idx];
    const nextEnabled = typeof enabled === 'boolean' ? enabled : !target.enabled;
    target.enabled = nextEnabled;
    target.nextRunAt = nextEnabled
      ? new Date(Date.now() + (target.intervalMinutes || 60) * 60 * 1000).toISOString()
      : null;
    this.save();
    return { ...target };
  }

  /**
   * 删除一条定时任务
   */
  remove(id) {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter(s => s.id !== id);
    this.save();
    return this.schedules.length < before;
  }

  /**
   * 批量导入定时任务（用于备份恢复）
   */
  importSchedules(items = []) {
    if (!Array.isArray(items)) return 0;
    let count = 0;
    for (const raw of items) {
      if (!raw || typeof raw.prompt !== 'string' || !raw.prompt.trim()) continue;
      this.createOrUpdate({
        id: raw.id,
        name: raw.name,
        prompt: raw.prompt,
        intervalMinutes: raw.intervalMinutes || 60,
        enabled: raw.enabled !== false,
        notifyOnComplete: Boolean(raw.notifyOnComplete)
      });
      count++;
    }
    return count;
  }

  /**
   * 立即执行某条定时任务
   */
  async runNow(id) {
    const target = this.schedules.find(s => s.id === id);
    if (!target) {
      throw Object.assign(new Error(`未找到定时任务: ${id}`), { status: 404 });
    }
    if (this.runningIds.has(id)) {
      return { ...target, alreadyRunning: true };
    }
    if (!this.runner) {
      throw new Error('Scheduler runner is not bound');
    }

    this.runningIds.add(id);
    target.lastStatus = 'running';
    target.lastRunAt = new Date().toISOString();
    this.save();

    try {
      const res = await this.runner(target);
      const answer = String((res && res.finalAnswer) || '定时任务执行完成').trim();
      target.lastStatus = 'success';
      target.lastResultPreview = answer.slice(0, 300);
      target.runCount = (target.runCount || 0) + 1;
      if (target.enabled) {
        target.nextRunAt = new Date(Date.now() + (target.intervalMinutes || 60) * 60 * 1000).toISOString();
      }
      this.save();

      if (target.notifyOnComplete && this.notifier) {
        try {
          await this.notifier({
            title: `定时任务完成：${target.name}`,
            content: answer.slice(0, 1200)
          });
        } catch (_) {
          // Notification failure should not fail the schedule run itself
        }
      }
      return { ...target };
    } catch (err) {
      target.lastStatus = 'error';
      target.lastResultPreview = `执行失败: ${err.message || String(err)}`;
      if (target.enabled) {
        target.nextRunAt = new Date(Date.now() + (target.intervalMinutes || 60) * 60 * 1000).toISOString();
      }
      this.save();
      return { ...target };
    } finally {
      this.runningIds.delete(id);
    }
  }

  /**
   * 检查并触发到期的定时任务
   */
  async tick() {
    const now = Date.now();
    for (const sched of this.schedules) {
      if (!sched.enabled || this.runningIds.has(sched.id)) continue;
      const dueAt = sched.nextRunAt ? Date.parse(sched.nextRunAt) : 0;
      if (!dueAt || now >= dueAt) {
        await this.runNow(sched.id);
      }
    }
  }
}

module.exports = new TaskScheduler();
