---
id: custom_93324
name: 高占用进程自动排查
version: 1.0.0
created_at: 2026-10-29T00:01:33.324Z
---

# 高占用进程自动排查

> 由用户指令「创建技能：高占用进程自动排查」自动进化生成的跨平台可复用技能。

## Trigger Keywords (触发关键词)
- `高占用进程自动排查`
- `自动化`
- `custom`

## Execution Steps (执行步骤)
1. 1. 自动检测当前操作系统环境 (Windows PowerShell / Linux Bash)
2. 2. 执行对应的系统状态检查与目录扫描
3. 3. 输出结构化执行报告并更新技能调用计数

## Cross-Platform Command Templates (跨平台命令模板)
- **Windows (PowerShell)**: `Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name, Id, CPU`
- **Linux (Bash)**: `ps aux --sort=-%cpu | head -n 6`
