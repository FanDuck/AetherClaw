#!/usr/bin/env bash
# ============================================================================
# AetherClaw (灵爪) - Linux / macOS 一键升级脚本 (Git & Docker 双模支持)
# ============================================================================
set -e

echo "============================================================"
echo "🦅 AetherClaw (灵爪) 一键升级工具"
echo "============================================================"

if command -v docker >/dev/null 2>&1 && [ -f "docker-compose.yml" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^aetherclaw$'; then
  echo "🐳 检测到正在运行的 Docker 容器，正在拉取最新 GHCR 预构建镜像并热更新..."
  docker compose pull
  docker compose up -d
  echo "✅ Docker 容器已升级至最新版本！"
  exit 0
fi

if command -v git >/dev/null 2>&1 && [ -d ".git" ]; then
  echo "📦 正在从 GitHub 拉取最新代码..."
  git pull --ff-only
  echo "✅ 代码已更新至最新版本！若使用了 systemd 或 PM2，请执行:"
  echo "   sudo systemctl restart aetherclaw   或   pm2 restart aetherclaw"
else
  echo "💡 单命令拉起/升级预构建 Docker 镜像："
  echo "   docker pull ghcr.io/fanduck/aetherclaw:latest"
  echo "   docker compose up -d"
fi
