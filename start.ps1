# CSP 客服平台 - 一键启动
$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CSP 客服平台 - 启动中..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "[1/3] 启动 Docker 服务..." -ForegroundColor Yellow
docker compose up -d postgres redis
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker 启动失败，请确认 Docker Desktop 已运行" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

Write-Host "[等待] 等待 PostgreSQL 就绪..." -ForegroundColor Yellow
do {
    $health = docker inspect csp-postgres --format="{{.State.Health.Status}}" 2>$null
    if ($health -ne "healthy") {
        Start-Sleep -Seconds 2
    }
} while ($health -ne "healthy")
Write-Host "[OK] PostgreSQL 已就绪" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] 数据库迁移..." -ForegroundColor Yellow
npx prisma db push --skip-generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] 迁移失败，继续启动..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3/3] 启动前端开发服务器..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   前端: http://localhost:3000" -ForegroundColor Green
Write-Host "   关闭本窗口即可停止所有服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Start-Process "http://localhost:3000"
npx next dev --port 3000

Write-Host ""
Write-Host "服务已停止。" -ForegroundColor Yellow
Read-Host "按 Enter 退出"
