# ============================================
# CSP — One-Click Setup & Launch (Windows)
# Usage: .\setup.ps1
# ============================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host @"
╔══════════════════════════════════════════════╗
║   Customer Service Platform — Setup          ║
║   Multi-Agent System v1.0                    ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# ── Prerequisites check ──────────────────────
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js: $(node -v)" -ForegroundColor Green

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker not found. Install Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker: $(docker --version)" -ForegroundColor Green

# ── Environment file ─────────────────────────
Write-Host "`n[2/7] Setting up environment..." -ForegroundColor Yellow

if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.example" ".env.local"
    Write-Host "  Created .env.local from .env.example" -ForegroundColor Green
    Write-Host "  IMPORTANT: Edit .env.local and set your OPENAI_API_KEY" -ForegroundColor Magenta
} else {
    Write-Host "  .env.local already exists — skipping" -ForegroundColor Green
}

# ── Docker services ──────────────────────────
Write-Host "`n[3/7] Starting Docker services..." -ForegroundColor Yellow
docker compose up -d 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "  Waiting for PostgreSQL..." -ForegroundColor Gray
$retries = 0
do {
    Start-Sleep -Seconds 3
    $healthy = docker compose ps postgres 2>$null | Select-String "healthy"
    $retries++
} while (-not $healthy -and $retries -lt 20)

if ($retries -ge 20) {
    Write-Host "  WARNING: PostgreSQL may not be ready yet" -ForegroundColor Magenta
} else {
    Write-Host "  PostgreSQL is healthy" -ForegroundColor Green
}

Write-Host "  Waiting for Redis..." -ForegroundColor Gray
$retries = 0
do {
    Start-Sleep -Seconds 2
    $healthy = docker compose ps redis 2>$null | Select-String "healthy"
    $retries++
} while (-not $healthy -and $retries -lt 20)

if ($retries -lt 20) {
    Write-Host "  Redis is healthy" -ForegroundColor Green
}

# ── BGE-M3 Embedding Model ──────────────────
Write-Host "`n[4/8] Deploying BGE-M3 local embedding model..." -ForegroundColor Yellow
& "$root\setup-bge-m3.ps1"

# ── Install dependencies ─────────────────────
Write-Host "`n[5/8] Installing dependencies..." -ForegroundColor Yellow
npm install 2>&1 | ForEach-Object { Write-Host "  $_" }

# ── Database setup ───────────────────────────
Write-Host "`n[6/8] Setting up database..." -ForegroundColor Yellow

Write-Host "  Generating Prisma client..." -ForegroundColor Gray
npx prisma generate 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "  Running migrations..." -ForegroundColor Gray
npx prisma db push 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "  Applying RLS policies..." -ForegroundColor Gray
$pgContainer = docker compose ps -q postgres
if ($pgContainer) {
    docker exec -i $pgContainer psql -U csp_admin -d customer_service -f /docker-entrypoint-initdb.d/init.sql 2>&1 | ForEach-Object { Write-Host "  $_" }
}

# ── Seed data ────────────────────────────────
Write-Host "`n[7/8] Seeding demo data..." -ForegroundColor Yellow
npx tsx prisma/seed.ts 2>&1 | ForEach-Object { Write-Host "  $_" }

# ── Start dev server ─────────────────────────
Write-Host "`n[8/8] Starting development server..." -ForegroundColor Yellow
Write-Host @"

╔══════════════════════════════════════════════╗
║  Setup complete!                              ║
║                                                ║
║  Frontend:  http://localhost:3000              ║
║  API:       http://localhost:3000/api          ║
║  Socket.IO: ws://localhost:3000                ║
║  PostgreSQL: localhost:5432                    ║
║  Redis:     localhost:6379                     ║
║  Milvus:    localhost:19530                    ║
║                                                ║
║  Starting server now...                        ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

npm run server
