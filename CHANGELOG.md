# 📝 版本更新日志 (Changelog)

本项目遵循 [语义化版本 2.0.0 (Semantic Versioning)](https://semver.org/lang/zh-CN/) 规范。

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
