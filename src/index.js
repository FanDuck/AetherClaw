/**
 * AetherClaw (灵爪) - Main Entry Point
 * 支持：
 * - `node src/index.js` 或 `npm start`：启动可视化 Web 控制台
 * - `node src/index.js --cli` 或 `npm run cli`：启动终端交互模式
 * - `node src/index.js --run "指令内容"`：单次命令执行模式
 */

const { startWebServer } = require('./server');
const { startCLI } = require('./cli');
const agent = require('./core/agent');

async function main() {
  const args = process.argv.slice(2);

  // One-shot task mode: node src/index.js --run "巡检系统"
  const runIdx = args.indexOf('--run');
  if (runIdx !== -1 && args[runIdx + 1]) {
    const prompt = args[runIdx + 1];
    const result = await agent.run(prompt, (step) => {
      console.log(`⚡ [${step.type}] ${step.title}`);
    });
    console.log('\n' + result.finalAnswer);
    return;
  }

  // Interactive CLI mode
  if (args.includes('--cli')) {
    startCLI();
    return;
  }

  // Default: Visual Web Console mode
  const shouldOpen = args.includes('--open');
  await startWebServer({ openBrowser: shouldOpen });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start AetherClaw:', err);
    process.exit(1);
  });
}

module.exports = { main };
