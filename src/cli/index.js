/**
 * AetherClaw (灵爪) - Interactive Command-Line Interface (CLI)
 * 适用于无图形界面的 Linux 服务器或偏好终端交互的开发者。
 */

const readline = require('readline');
const platform = require('../core/platform');
const agent = require('../core/agent');
const memory = require('../core/memory');

function startCLI() {
  const sys = platform.getSystemSummary();
  console.log(`\n============================================================`);
  console.log(`🦅 AetherClaw (灵爪) Interactive CLI v1.0.0`);
  console.log(`🖥️  Environment: ${sys.osType} (${sys.shell})`);
  console.log(`💡 Commands: /skills (查看技能), /memory (查看记忆), /exit (退出)`);
  console.log(`============================================================\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🦅 AetherClaw > '
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

    try {
      const res = await agent.run(input, (step) => {
        console.log(`  ⚡ [${step.type}] ${step.title}`);
      });
      console.log(`\n${res.finalAnswer}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}\n`);
    }

    rl.prompt();
  });
}

module.exports = { startCLI };
