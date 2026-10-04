#Requires -Version 5.1
<#
.SYNOPSIS
    Waline on Worker 部署脚本
.DESCRIPTION
    自动完成依赖安装、D1 数据库创建、Schema 初始化、JWT_SECRET 配置和 Worker 部署。
#>

$ErrorActionPreference = "Stop"
$Config = if (Test-Path "temp/wrangler.private.toml") { "temp/wrangler.private.toml" } else { "wrangler.toml" }

Write-Host "=== Waline on Worker - 部署脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 检查依赖
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 请启用 Corepack 并安装 pnpm" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host "[1/5] 安装依赖..." -ForegroundColor Yellow
pnpm install --frozen-lockfile

# 检查 wrangler 登录状态
Write-Host ""
Write-Host "[2/5] 检查 Wrangler 登录状态..." -ForegroundColor Yellow
try {
    $null = pnpm exec wrangler whoami 2>&1
} catch {
    Write-Host "未登录 Wrangler，请先运行: pnpm exec wrangler login" -ForegroundColor Red
    exit 1
}

# 创建 D1 数据库（如果 wrangler.toml 中 database_id 为占位符）
Write-Host ""
Write-Host "[3/5] 检查 D1 数据库..." -ForegroundColor Yellow
$tomlContent = Get-Content $Config -Raw
if ($tomlContent -match 'database_id\s*=\s*""') {
    Write-Host "创建 D1 数据库..."
    $dbOutput = pnpm exec wrangler d1 create waline-db --config $Config 2>&1 | Out-String
    Write-Host $dbOutput

    if ($dbOutput -match 'database_id\s*=\s*"([^"]+)"') {
        $dbId = $Matches[1]
        $tomlContent = $tomlContent -replace 'database_id\s*=\s*""', "database_id = `"$dbId`""
        Set-Content $Config $tomlContent -NoNewline
        Write-Host "已更新 $Config: database_id = $dbId" -ForegroundColor Green
    } else {
        Write-Host "警告: 无法自动提取 database_id，请手动编辑 $Config" -ForegroundColor DarkYellow
    }
}

# 初始化数据库
Write-Host ""
Write-Host "[4/5] 初始化数据库 Schema..." -ForegroundColor Yellow
pnpm exec wrangler d1 execute waline-db --file=./schema.sql --remote --config $Config

# 设置 JWT_SECRET
Write-Host ""
Write-Host "[5/5] 配置 Secrets..." -ForegroundColor Yellow
$reply = Read-Host "是否需要生成并设置 JWT_SECRET? (y/N)"
if ($reply -match '^[Yy]$') {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwtSecret = [Convert]::ToBase64String($bytes).Substring(0, 32)
    $jwtSecret | pnpm exec wrangler secret put JWT_SECRET --config $Config
    Write-Host "JWT_SECRET 已设置" -ForegroundColor Green
}

# 部署
Write-Host ""
Write-Host "=== 开始部署 ===" -ForegroundColor Cyan
pnpm exec wrangler deploy --config $Config

Write-Host ""
Write-Host "=== 部署完成 ===" -ForegroundColor Green
Write-Host ""
Write-Host "下一步:" -ForegroundColor Cyan
Write-Host "  1. 首位注册的用户将自动成为管理员"
Write-Host "  2. 在你的网站中配置 @waline/client 指向 Worker URL"
Write-Host "  3. 可选: 在 wrangler.toml 中配置 SECURE_DOMAINS 限制跨域访问"
