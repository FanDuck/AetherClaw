@echo off
chcp 65001 >nul
echo ============================================================
echo 🦅 AetherClaw (灵爪) Windows 一键升级脚本
echo ============================================================

where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist ".git" (
        echo 📦 正在从 GitHub 拉取最新代码...
        git pull --ff-only
        echo ✅ 升级完成！重新运行 start-windows.bat 即可生效。
        pause
        exit /b 0
    )
)

echo 💡 如使用 Docker Desktop，正在拉取最新预构建镜像...
docker compose pull && docker compose up -d
pause
