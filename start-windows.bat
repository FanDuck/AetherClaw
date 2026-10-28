@echo off
chcp 65001 >nul
title AetherClaw (灵爪) - Cross-Platform Autonomous Agent
echo ============================================================
echo 🦅 正在启动 AetherClaw (灵爪) 智能体可视化控制台 (Windows)...
echo ============================================================
node "%~dp0src\index.js" --open
pause
