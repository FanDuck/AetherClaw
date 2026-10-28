---
id: workspace_organizer
name: 项目目录结构分析与整理 (Workspace Analyzer)
version: 1.0.0
created_at: 2026-10-28T23:53:07.453Z
---

# 项目目录结构分析与整理 (Workspace Analyzer)

> 扫描指定文件夹下的文件结构、统计各类文件数量并生成清晰的目录概览。

## Trigger Keywords (触发关键词)
- `整理`
- `目录`
- `分析文件夹`
- `文件列表`
- `workspace`
- `tree`

## Execution Steps (执行步骤)
1. 调用 file_list 工具列出目标路径下的全部文件与子文件夹
2. 按文件扩展名分类统计数量与大小
3. 生成可视化的 Markdown 结构说明或整理建议

## Cross-Platform Command Templates (跨平台命令模板)
- **Windows (PowerShell)**: `Get-ChildItem -Force | Select-Object Mode, LastWriteTime, Length, Name | Format-Table -AutoSize`
- **Linux (Bash)**: `ls -la`
