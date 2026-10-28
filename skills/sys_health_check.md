---
id: sys_health_check
name: 跨平台系统健康巡检 (System Health Check)
version: 1.0.0
created_at: 2026-10-28T23:53:07.453Z
---

# 跨平台系统健康巡检 (System Health Check)

> 自动检测当前 Windows 或 Linux 系统的 CPU、内存、磁盘空间与运行环境状态，生成诊断报告。

## Trigger Keywords (触发关键词)
- `巡检`
- `健康`
- `系统状态`
- `电脑状态`
- `health`
- `diagnostic`
- `status`

## Execution Steps (执行步骤)
1. 调用 system_info 工具获取操作系统、CPU 核心数、内存占用等核心指标
2. 在 Windows 下使用 PowerShell (Get-PSDrive C) 或在 Linux 下使用 (df -h /) 检查磁盘空间
3. 汇总各项指标并向用户输出结构化的健康诊断建议

## Cross-Platform Command Templates (跨平台命令模板)
- **Windows (PowerShell)**: `Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name="Used(GB)";Expression={[math]::round($_.Used/1GB,2)}}, @{Name="Free(GB)";Expression={[math]::round($_.Free/1GB,2)}} | Format-Table -AutoSize`
- **Linux (Bash)**: `df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs`
