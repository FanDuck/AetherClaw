# 📝 版本更新日志 (Changelog)

本项目遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范。

## [v1.2.0] - 2026-10-29

### ✨ 核心功能与体验升级 (Enhancements)
- **纯矢量品牌 Logo 统一 (`assets/logo.svg`)**：修复 GitHub CSP 对 SVG 内嵌 Base64 位图的拦截问题，将横幅 (`assets/banner.svg`)、控制台预览图 (`assets/console-preview.svg`) 与 Web 控制台左上角全部升级为 100% 纯矢量高清 Logo。
- **技能一键真实执行 (`执行技能: <名称>`)**：点击右侧技能面板的「运行」按钮或输入 `执行技能: xxx` 时，直接匹配并执行该技能在当前系统（Windows PowerShell / Linux Bash）下的命令模板，并独立累计调用次数（不再误增版本号）。
- **中文二元分词语义记忆检索 (`tokenize`)**：支持中英文混合分词检索，中文长句无需空格即可精准命中历史记忆；`memory_recall` 工具在无相关记忆时不再返回无关兜底项。
- **内置零依赖 `.env` 加载器**：复制 `.env.example` 为 `.env` 后无需安装任何第三方库即可在启动时自动加载。
- **CLI 全局命令与参数完善 (`bin/aetherclaw.js`)**：修复全局命令入口未调用 `main()` 的问题，新增 `--version`、`--help` 及 `--run` 参数校验。

### 🛡️ 安全与跨平台健壮性加固 (Security & Reliability)
- **分段式 `rm` 危险命令语法级检测 (`isDangerousRm`)**：可精准拦截 `rm -r -f /`、`sudo rm -rf /*`、`echo ok; rm -rf ~/` 等变体。
- **敏感文件读写保护 (`isProtectedPath`)**：`file_read` 与 `file_write` 自动拒绝对 `.env` 与 `config.local.json` 的直接访问，防止提示词注入窃取密钥；自动检测并拒绝把二进制文件当成文本读取。
- **TCP 分块 UTF-8 解码修复 (`parseBody`)**：修复多字节中文字符跨 TCP 数据包分块时产生乱码的隐患。
- **跨平台换行符规范 (`.gitattributes`)**：强制 `.bat` 使用 `CRLF`、`.sh` 使用 `LF`，确保从 GitHub 下载 ZIP 在 Windows 与 Linux 下均可直接运行。
- **GitHub Release 自动化流水线 (`.github/workflows/release.yml`)**：推送版本标签时自动提取 `CHANGELOG.md` 生成官方 GitHub Release；CI 矩阵覆盖 Node 18 / 20 / 22，自动化测试扩充至 **17 项**。

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
