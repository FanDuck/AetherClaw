#!/usr/bin/env node
// 注意：src/index.js 仅在被直接执行时才自动运行，因此这里必须显式调用 main()
require('../src/index.js').main().catch((err) => {
  if (!(err && err.code === 'EADDRINUSE')) {
    console.error('Failed to start AetherClaw:', err && err.message ? err.message : err);
  }
  process.exit(1);
});
