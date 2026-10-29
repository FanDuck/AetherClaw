# 📝 版本更新日志 (Changelog)

本项目遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范。

## [v1.5.0] - 2026-10-29

### 🛡️ 生产级容器沙箱、Bearer Token 鉴权、TLS 反向代理与多架构 GHCR 预构建镜像
- **受限 Docker 容器与 Google gVisor (`runsc`) 工具沙箱 (`SANDBOX_MODE`)**：
  - `shell_exec` 与 Web 控制台设置新增三种隔离级别切换：`host`（宿主机护栏模式）、`docker`（受限容器沙箱：`--cap-drop=ALL --security-opt=no-new-privileges --read-only --network=none --pids-limit=64 --user 65534:65534`）以及 `gvisor`（Google gVisor `--runtime=runsc` 内核级沙箱）。
- **RFC 6750 标准 `Authorization: Bearer <token>` 鉴权 & 默认关闭纯明文公网暴露**：
  - 全面支持 `Authorization: Bearer <token>` 请求头鉴权（弹窗式密钥输入），**彻底禁止通过 URL `?token=` 明文参数传递令牌**，杜绝浏览器历史记录与代理日志泄露。
  - 默认拦截未配置 TLS 的 `0.0.0.0` 纯明文公网绑定并自动回退至 `127.0.0.1`；官方提供 [`deploy/Caddyfile`](deploy/Caddyfile) 与 [`deploy/nginx.conf`](deploy/nginx.conf) 配置模板，支持 `BEHIND_TLS_PROXY=true` 强制 HTTPS 校验与 HSTS 响应头。
- **官方 `systemd` 服务单元文件与 `pm2.config.js`**：
  - 新增 [`deploy/aetherclaw.service`](deploy/aetherclaw.service)（含 `NoNewPrivileges=true`、`ProtectSystem=strict` 等 systemd 内核级加固）与 [`pm2.config.js`](pm2.config.js) 进程守护配置。
- **GHCR 多架构预构建 Docker 镜像自动发布与一键升级**：
  - 新增 [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)，自动构建并发布 `linux/amd64` 与 `linux/arm64` 预构建镜像至 `ghcr.io/fanduck/aetherclaw:latest`。
  - 新增 `aetherclaw --upgrade`、[`upgrade.sh`](upgrade.sh) 与 [`upgrade.bat`](upgrade.bat)，支持单命令拉起（`docker compose up -d`）与一键升级（`docker compose pull && docker compose up -d`）。

## [v1.4.0] - 2026-10-29

### 🔑 大模型 API 多密钥管理中心与连通性诊断 (API Key Vault & Live Diagnostics)
- **实时 API 连通性测试与故障中文诊断 (`POST /api/config/test`)**：
  - 在「⚙️ API 与安全设置」弹窗中一键测试当前输入或已存密钥的连通性，实时测算响应延迟 (`latencyMs`) 并返回中文诊断报告（自动识别 `401/403` 密钥无效、`404` 路径或模型名错误、`429/402` 余额或并发受限、网络超时等）。
- **多 API Key 密钥库（添加 / 切换 / 测速 / 删除）**：
  - 支持将多个不同服务商或账号的 API Key 存入本地加密权限 (`0600`) 的密钥保险箱 (`apiProfiles`)，所有接口响应均自动脱敏（仅展示 `sk-xxxx...xxxx`），支持在网页上一键切换当前生效密钥、单独测速或随时删除。
  - 新增 **「🗑️ 删除当前激活 Key (切回免Key模式)」**（`DELETE /api/config/apikey`）与密码框 **「👁️ 显示/隐藏」** 切换按钮。
- **一键从接口拉取可用模型列表 (`POST /api/config/models`)**：
  - 自动请求 `<baseUrl>/models` 并将可用模型渲染为可点击芯片，无需手敲复杂的模型名称。
- **9 大主流服务商预设 & 可视化安全护栏开关**：
  - 内置 DeepSeek V3、DeepSeek R1、OpenAI、通义千问、硅基流动 (SiliconFlow)、智谱 GLM、Kimi、Google Gemini、Ollama 本地（免 Key）一键预设。
  - 在设置弹窗中新增 OpenClaw 执行权限开关（终端执行 `allowShellExec`、文件写入 `allowFileWrite`、技能进化 `autoEvolveSkills`、最大推理步数 `maxSteps`）。
- **任务中途一键停止 (`⏹️ 停止`)**：
  - 发送区新增流式任务实时中断按钮，可随时取消正在生成或规划的任务。

## [v1.3.0] - 2026-10-29

### 🚀 四大核心能力强化 (Major Enhancements)
- **多轮连续对话上下文 & 会话管理**：
  - 大模型模式自动注入最近 6 轮对话历史；免 Key 本地模式支持跨轮追问（如发送「`把刚才的结果保存为 report.md`」即可自动提取上一轮巡检/分析报告并写入本地文件）。
  - Web 控制台新增 **「🧹 清空会话」**（`DELETE /api/conversation`）与 **「📥 导出对话 (.md)」** 按钮。
- **大模型原生 Token 级 SSE 实时流式输出 (`consumeLLMStream`)**：
  - 接入 DeepSeek / OpenAI / 通义千问 / Ollama 时，自动开启 `stream: true` 逐 Token 实时流式推送（`event: token`），并自动重组分段流式下发的 `tool_calls`，首字响应延迟大幅降低。
- **Web 控制台技能可视化编辑器 & 一键导入/导出 `SKILL.md`**：
  - 无需手动编辑代码文件，可在网页直接新建、编辑、删除自定义技能，或一键上传导入/下载导出开源标准的 `SKILL.md` 文件（`POST /api/skills/import`、`GET /api/skills/:id/md`、`DELETE /api/skills/:id`）。
- **Docker 容器化一键部署套件 (`Dockerfile` + `docker-compose.yml`)**：
  - 基于 `node:22-alpine`，内置 `bash`、`procps`、`coreutils`、`curl` 与 `/healthz` 健康检查，支持在 Linux 服务器或群晖/飞牛 NAS 上通过 `docker compose up -d` 安全隔离运行。
- **测试与 CI 升级**：自动化测试套件扩充至 **20 项**，GitHub Actions 升级至最新 `v7` / `v3` 并优化 Windows 进程树超时回收速度。

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
