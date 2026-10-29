@echo off
setlocal
chcp 65001 >nul
title AetherClaw - Cross-Platform Autonomous Agent
echo ============================================================
echo   AetherClaw (灵爪) - 正在启动可视化控制台 (Windows)...
echo ============================================================

where node >nul 2>nul
if errorlevel 1 goto :no_node

node "%~dp0src\index.js" --open
if errorlevel 1 goto :failed
goto :done

:no_node
echo.
echo [错误] 没有检测到 Node.js，请先安装后再双击本文件：
echo        https://nodejs.org/zh-cn  下载 LTS 版本，一路下一步即可
echo.
pause
exit /b 1

:failed
echo.
echo [提示] 启动失败。如果上方提示端口被占用，说明 AetherClaw 可能已经在运行，
echo        直接在浏览器打开 http://127.0.0.1:3721 即可。

:done
pause
