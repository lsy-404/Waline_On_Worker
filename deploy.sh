#!/usr/bin/env bash
set -euo pipefail

echo "=== Waline on Worker - 部署脚本 ==="
echo ""

CONFIG="wrangler.toml"
if [ -f "temp/wrangler.private.toml" ]; then
  CONFIG="temp/wrangler.private.toml"
fi

# 检查依赖
command -v pnpm >/dev/null 2>&1 || { echo "错误: 请启用 Corepack 并安装 pnpm"; exit 1; }

# 安装依赖
echo "[1/5] 安装依赖..."
pnpm install --frozen-lockfile

# 检查 wrangler 登录状态
echo ""
echo "[2/5] 检查 Wrangler 登录状态..."
if ! pnpm exec wrangler whoami >/dev/null 2>&1; then
  echo "未登录 Wrangler，请先运行: pnpm exec wrangler login"
  exit 1
fi

# 创建 D1 数据库（如果 wrangler.toml 中 database_id 为占位符）
echo ""
echo "[3/5] 检查 D1 数据库..."
if grep -q 'database_id = ""' "$CONFIG" 2>/dev/null; then
  echo "创建 D1 数据库..."
  DB_OUTPUT=$(pnpm exec wrangler d1 create waline-db --config "$CONFIG" 2>&1)
  echo "$DB_OUTPUT"

  DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+')
  if [ -n "$DB_ID" ]; then
    sed -i "s/database_id = \"\"/database_id = \"$DB_ID\"/" "$CONFIG"
    echo "已更新 $CONFIG: database_id = $DB_ID"
  else
    echo "警告: 无法自动提取 database_id，请手动编辑 $CONFIG"
  fi
fi

# 初始化数据库
echo ""
echo "[4/5] 初始化数据库 Schema..."
pnpm exec wrangler d1 execute waline-db --file=./schema.sql --remote --config "$CONFIG"

# 设置 JWT_SECRET（如果未设置）
echo ""
echo "[5/5] 配置 Secrets..."
echo "是否需要生成并设置 JWT_SECRET? (y/N)"
read -r REPLY
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
  echo "$JWT_SECRET" | pnpm exec wrangler secret put JWT_SECRET --config "$CONFIG"
  echo "JWT_SECRET 已设置"
fi

# 部署
echo ""
echo "=== 开始部署 ==="
pnpm exec wrangler deploy --config "$CONFIG"

echo ""
echo "=== 部署完成 ==="
echo ""
echo "下一步:"
echo "  1. 首位注册的用户将自动成为管理员"
echo "  2. 在你的网站中配置 @waline/client 指向 Worker URL"
echo "  3. 可选: 在 wrangler.toml 中配置 SECURE_DOMAINS 限制跨域访问"
