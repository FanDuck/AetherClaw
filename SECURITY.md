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

5. **跨站与重绑定防护**：校验 `Host` 头（防 DNS Rebinding）与 `Origin`（防恶意网页调用本地 Agent），无 CORS 通配。
6. **RFC 6750 标准 `Authorization: Bearer <token>` 鉴权 & 默认关闭纯明文公网暴露**：
   - 全面采用请求头 `Authorization: Bearer <token>` 鉴权，**禁止通过 URL `?token=` 明文参数传递令牌**（防止浏览器历史、Referer 与代理日志泄露）。
   - 默认拦截未加密的 `0.0.0.0` 纯明文公网绑定并自动回退至 `127.0.0.1`；官方提供开箱即用的 [`deploy/Caddyfile`](deploy/Caddyfile) 与 [`deploy/nginx.conf`](deploy/nginx.conf) 实现 TLS 1.3 / HTTPS 加密卸载与 HSTS 强制校验 (`BEHIND_TLS_PROXY=true`)。
7. **受限 Docker 容器与 Google gVisor (`runsc`) 沙箱执行模式 (`SANDBOX_MODE`)**：
   - 支持将工具命令切换至受限 Docker 容器沙箱（`--cap-drop=ALL --security-opt=no-new-privileges --read-only --network=none --pids-limit=64 --user 65534:65534`）或 **gVisor (`--runtime=runsc`)** 用户态内核沙箱中隔离执行。
8. **严格 CSP 与输出转义**，防御 XSS；**Windows 命令使用 `-EncodedCommand`**，规避转义注入；超时终止整个进程树。
9. **系统服务级沙箱加固**：官方提供带 `ProtectSystem=strict`、`NoNewPrivileges=true` 的 [`deploy/aetherclaw.service`](deploy/aetherclaw.service) (`systemd`) 与 [`pm2.config.js`](pm2.config.js)。

> ⚠️ 正则护栏是最后一道防线而非沙箱。请勿在不可信环境将 Agent 暴露到公网；生产环境建议配合容器/低权限用户运行。

## 2. 报告安全漏洞 (Reporting a Vulnerability)

如果你在 AetherClaw 中发现了潜在的安全绕过风险或漏洞，请通过 GitHub Issues 或联系仓库维护者 [@FanDuck](https://github.com/FanDuck) 进行反馈，我们将在第一时间修复并发布安全补丁。
