/**
 * AetherClaw (灵爪) - Main Entry Point
 * 支持：
 * - `node src/index.js` 或 `npm start`：启动可视化 Web 控制台
 * - `node src/index.js --cli` 或 `npm run cli`：启动终端交互模式
 * - `node src/index.js --run "指令内容"`：单次命令执行模式
 * - `--open` 启动后自动打开浏览器，`--help` 查看帮助，`--version` 查看版本
 */

const pkg = require('../package.json');

const HELP = `AetherClaw (灵爪) v${pkg.version}

Usage:
  aetherclaw                  Start the visual Web Console (default http://127.0.0.1:3721)
  aetherclaw --open           Start the Web Console and open it in your browser
  aetherclaw --cli            Start the interactive terminal CLI
  aetherclaw --run "<task>"   Run a single task and print the result
  aetherclaw --upgrade        One-click self-upgrade (git pull / docker compose pull)
  aetherclaw --version        Print version
  aetherclaw --help           Show this help

Environment (or put them in a .env file, see .env.example):
  PORT, HOST, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, AETHERCLAW_TOKEN, AETHERCLAW_HOME,
  SANDBOX_MODE (host|docker|gvisor), BEHIND_TLS_PROXY (true|false)
`;

async function main(argv = process.argv.slice(2)) {
  const args = argv;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(pkg.version);
    return;
  }
  if (args.includes('--upgrade')) {
    const { execSync } = require('child_process');
    console.log('🔄 正在检查并升级 AetherClaw (灵爪)...');
    try {
      const out = execSync('git pull --ff-only', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(out.trim() || '✅ 已是最新版本！');
      console.log('💡 若使用 Docker 部署，可执行: docker compose pull && docker compose up -d');
    } catch (err) {
      console.error('⚠️ 自动 git pull 未成功，你可以通过以下命令一键升级：\n  • Git 部署: git pull --ff-only\n  • Docker 镜像: docker compose pull && docker compose up -d');
      process.exitCode = 1;
    }
    return;
  }

  // 延迟加载：--help / --version 不应触发创建 data/ 与 skills/ 目录
  // One-shot task mode: node src/index.js --run "巡检系统"
  const runIdx = args.indexOf('--run');
  if (runIdx !== -1) {
    const prompt = args[runIdx + 1];
    if (!prompt || prompt.startsWith('--')) {
      console.error('❌ --run 需要提供任务内容，例如: aetherclaw --run "请对当前系统进行全面健康巡检"');
      process.exitCode = 2;
      return;
    }
    const agent = require('./core/agent');
    const result = await agent.run(prompt, (step) => {
      console.log(`⚡ [${step.type}] ${step.title}`);
    });
    console.log('\n' + result.finalAnswer);
    return;
  }

  // Interactive CLI mode
  if (args.includes('--cli')) {
    require('./cli').startCLI();
    return;
  }

  // Default: Visual Web Console mode
  const { startWebServer } = require('./server');
  await startWebServer({ openBrowser: args.includes('--open') });
}

if (require.main === module) {
  main().catch((err) => {
    if (err && err.code === 'EADDRINUSE') {
      // 端口占用的提示已在 server 中打印，这里只需设置退出码
      process.exit(1);
    }
    console.error('Failed to start AetherClaw:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { main };
