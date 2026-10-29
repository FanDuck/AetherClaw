/**
 * AetherClaw (灵爪) - Interactive Command-Line Interface (CLI)
 * 适用于无图形界面的 Linux 服务器或偏好终端交互的开发者。
 */

const readline = require('readline');
const platform = require('../core/platform');
const agent = require('../core/agent');
const memory = require('../core/memory');
const pkg = require('../../package.json');

function startCLI() {
  const sys = platform.getSystemSummary();
  console.log(`\n============================================================`);
  console.log(`🦅 AetherClaw (灵爪) Interactive CLI v${pkg.version}`);
  console.log(`🖥️  Environment: ${sys.osType} (${sys.shell})`);
  console.log(`💡 Commands: /help, /skills (查看技能), /memory (查看记忆), /exit (退出)`);
  console.log(`============================================================\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🦅 AetherClaw > '
  });

  // 管道输入结束 / Ctrl+D 时，等当前任务跑完再退出，避免截断正在执行的命令
  let running = 0;
  let closed = false;
  rl.on('close', () => {
    closed = true;
    if (running === 0) process.exit(0);
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/exit' || input === 'exit' || input === 'quit') {
      console.log('👋 再见！AetherClaw 已安全退出。');
      process.exit(0);
    }

    if (input === '/help') {
      console.log([
        '',
        '可用指令：',
        '  /skills   查看已掌握的技能',
        '  /memory   查看长期语义记忆',
        '  /exit     退出',
        '示例任务：',
        '  请对当前系统进行全面健康巡检',
        '  执行命令: Get-Date   (Windows)   /   执行命令: uname -a   (Linux)',
        '  记住：我喜欢简洁的中文技术报告',
        '  创建技能：高占用进程排查',
        '  执行技能: 跨平台系统健康巡检',
        ''
      ].join('\n'));
      rl.prompt();
      return;
    }

    if (input === '/skills') {
      const skills = memory.listSkills();
      console.log(`\n🧬 已掌握技能 (${skills.length}):`);
      for (const s of skills) {
        console.log(`  - [${s.id}] ${s.name}: ${s.description}`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    if (input === '/memory') {
      const mems = memory.state.semanticMemories;
      console.log(`\n🧠 长期语义记忆 (${mems.length}):`);
      for (const m of mems) {
        console.log(`  - (${m.category}) ${m.content}`);
      }
      console.log('');
      rl.prompt();
      return;
    }

    running++;
    try {
      const res = await agent.run(input, (step) => {
        console.log(`  ⚡ [${step.type}] ${step.title}`);
      });
      console.log(`\n${res.finalAnswer}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}\n`);
    } finally {
      running--;
    }

    if (closed && running === 0) process.exit(0);
    if (!closed) rl.prompt();
  });
}

module.exports = { startCLI };
