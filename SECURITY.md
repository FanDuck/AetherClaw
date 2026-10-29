# 🛡️ 安全策略与防护机制 (Security Policy)

AetherClaw (灵爪) 作为一个具备本地操作系统执行能力的自主 AI Agent 框架，将安全性视为核心设计原则。

## 1. 内置安全护栏 (Built-in Safety Guardrails)

1. **高危命令正则拦截 (`src/core/platform.js`)**
   - 默认拦截包括但不限于：`rm -rf /`、`mkfs.*`、`dd if=... of=/dev/...`、`Format-Volume`、`Remove-Item -Recurse C:\` 以及各类 Shell Fork 炸弹。
2. **命令执行超时熔断**
   - 所有通过 `shell_exec` 执行的子进程默认受 `15000ms` (15 秒) 超时限制，防止恶意或异常脚本挂起系统。
3. **默认仅绑定本地回环地址 (`127.0.0.1`)**
   - Web 控制台默认监听 `127.0.0.1:3721`，仅限本机访问，防止局域网或公网未授权调用。
4. **本地密钥脱敏与 Git 隔离**
   - `/api/status` 接口对 `apiKey` 进行首尾掩码脱敏处理（如 `sk-1...abcd`）。
   - `.gitignore` 严格忽略 `.env` 与 `data/config.local.json`，避免用户误将私钥提交至公开仓库。

## 2. 报告安全漏洞 (Reporting a Vulnerability)

如果你在 AetherClaw 中发现了潜在的安全绕过风险或漏洞，请通过 GitHub Issues 或联系仓库维护者 [@FanDuck](https://github.com/FanDuck) 进行反馈，我们将在第一时间修复并发布安全补丁。
