# 📝 版本更新日志 (Changelog)

本项目遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范。

## [v1.1.0] - 2026-10-29

### 🔐 安全加固 (Security)
- **修复**：`/api/status` 之前会把明文 API Key 随"脱敏配置"一并返回，现已彻底移除（新增自动化测试防回归）。
- **修复**：移除 `Access-Control-Allow-Origin: *`。新增 **Host 校验（防 DNS Rebinding）** 与 **Origin 同源校验（防恶意网页 CSRF 本地 Agent）**。
- 绑定非回环地址（如 `HOST=0.0.0.0`）时强制 **Token 鉴权**（未设置 `AETHERCLAW_TOKEN` 则自动生成并打印）。
- 新增 CSP、`X-Content-Type-Options`、`X-Frame-Options` 等安全响应头；Web 界面全部动态内容统一转义，消除 XSS 风险。
- Windows 命令改用 `-EncodedCommand` 执行，避免引号/`$` 转义问题与命令注入；超时后**杀掉整个进程树**。
- 危险命令规则大幅扩充（空白归一化防绕过、`curl | sh`、`dd`、`shutdown`、`Remove-Item C:\` 等）。

### ✨ 新特性 (Features)
- **SSE 实时流式推送**：新增 `POST /api/chat/stream`，Agent 每一步（思考 → 工具 → 观察）实时呈现。
- **全新动态 Web 控制台**：粒子网络动态背景（鼠标交互）、极光渐变、实时 CPU/内存环形仪表盘、步骤时间线滑入动画、打字机式回答、思考中弹跳指示、Toast 通知、按钮水波纹、标签滑动指示条；自动遵循系统"减少动态效果"设置。
- 新增 `GET /api/metrics`、`GET /healthz`；支持 `AETHERCLAW_HOME` 重定向数据目录；SIGINT/SIGTERM 优雅退出。

### 🛠️ 健壮性 (Reliability)
- 数据/配置/技能文件改为**原子写入**，崩溃不再产生损坏 JSON。
- 修复 System Prompt 在 Windows 下错误推荐 Linux 命令模板的 Bug；工具输出回灌模型前自动裁剪长度。
- 运行期数据（`data/`、自进化 `skills/custom_*`）不再被提交进仓库；测试改在临时目录运行，不再污染真实数据。
- 测试用例由 5 个扩充至 9 个，覆盖安全护栏、超时杀进程、鉴权、SSE、跨域拦截。

## [v1.0.0] - 2026-10-29

### 🎉 首个正式开源版本发布 (Initial Release)
- 🦞 **OpenClaw 跨平台操控引擎**：
  - 新增 `PlatformAdapter` (`src/core/platform.js`)，原生支持 Windows (`PowerShell` UTF-8 防乱码) 与 Linux (`Bash`)。
  - 内置 9 大核心工具：`system_info`、`shell_exec`、`file_list`、`file_read`、`file_write`、`web_fetch`、`memory_store`、`memory_recall`、`skill_create`。
  - 内置高危破坏性命令拦截护栏与超时熔断机制。
- 🪽 **Hermes 三层记忆与技能自我进化系统**：
  - 支持情景记忆 (`Episodic`)、语义记忆 (`Semantic`) 与程序性技能 (`Procedural Skills`)。
  - 支持自动生成开源标准的 `skills/*.md` (`SKILL.md`) 与 `skills/*.json` 双格式技能包。
- 🖥️ **可视化 Web 控制台 + 终端 CLI 双模式**：
  - 提供零代码大模型 API 配置弹窗（内置 DeepSeek、OpenAI、通义千问、Ollama 预设）。
  - 提供免 API Key 本地自主执行引擎，支持一键系统巡检、目录分析、记忆存取与技能进化。
  - 提供 Windows (`start-windows.bat`) 与 Linux (`start-linux.sh`) 一键启动脚本。
