# ============================================
# BGE-M3 本地 Embedding 模型部署脚本
# 支持: Ollama 原生 / Docker GPU / Docker CPU
# ============================================
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host @"
╔══════════════════════════════════════════════╗
║   Deploy BGE-M3 Local Embedding Model       ║
╚══════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host "BGE-M3: 1024-dim, 100+ languages, 8192 token context" -ForegroundColor Gray
Write-Host ""

# ── Check if Ollama is installed natively ──
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue

if ($ollamaCmd) {
    Write-Host "[Option 1] Native Ollama detected" -ForegroundColor Green
    $ollamaVer = & ollama --version 2>&1
    Write-Host "  $ollamaVer" -ForegroundColor Gray

    # Check if ollama serve is already running
    $ollamaRunning = $false
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
        $ollamaRunning = $true
    } catch {}

    if (-not $ollamaRunning) {
        Write-Host "  Starting Ollama service..." -ForegroundColor Yellow
        Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden

        # Wait for service to be ready
        $s = 0
        while ($s -lt 20) {
            Start-Sleep -Seconds 2; $s++
            try {
                $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
                Write-Host "  Ollama service ready (${s}x2s)" -ForegroundColor Green
                break
            } catch {}
        }
    } else {
        Write-Host "  Ollama service already running" -ForegroundColor Green
    }

    # Pull BGE-M3
    $installed = $null
    $rawList = & ollama list 2>&1
    if ($rawList -match "bge-m3") {
        $installed = $true
    }

    if ($installed) {
        Write-Host "  BGE-M3 already installed" -ForegroundColor Green
    } else {
        Write-Host "  Pulling BGE-M3 (~1.2GB, one-time download)..." -ForegroundColor Yellow
        $null = & ollama pull bge-m3 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  BGE-M3 installed" -ForegroundColor Green
        } else {
            Write-Host "  Pull may have failed, testing anyway..." -ForegroundColor Yellow
        }
    }

    # Verify embedding works
    Write-Host "  Testing BGE-M3 embedding..." -ForegroundColor Yellow
    $testBody = '{"model":"bge-m3","input":"Hello world"}'
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:11434/v1/embeddings" `
            -Method Post -Body $testBody -ContentType "application/json" -TimeoutSec 60
        $dim = $result.data[0].embedding.Count
        Write-Host "  SUCCESS! Embedding dimension: $dim" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: Embedding test failed — $($_.Exception.Message)" -ForegroundColor Magenta
    }

    Write-Host ""
    Write-Host "  Native deployment done." -ForegroundColor Cyan
    Write-Host "  Endpoint: http://localhost:11434/v1" -ForegroundColor White
    Write-Host "  Model:    bge-m3" -ForegroundColor White
    exit 0
}

# ── No native Ollama, try Docker ──
Write-Host "[Option 2] Native Ollama not found, trying Docker..." -ForegroundColor Yellow

$dockerOk = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerOk) {
    Write-Host ""
    Write-Host "ERROR: Neither Ollama nor Docker found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install one of:" -ForegroundColor Yellow
    Write-Host "  1. Ollama: https://ollama.com/download/windows" -ForegroundColor White
    Write-Host "     then: ollama pull bge-m3" -ForegroundColor Gray
    Write-Host "  2. Docker Desktop + docker compose --profile embedding-cpu up -d" -ForegroundColor White
    exit 1
}

# Fast GPU check (no image pull)
$hasGpu = $false
$dockerInfo = docker info 2>&1 | Out-String
if ($dockerInfo -match "nvidia|gpu" -and $dockerInfo -match "Runtimes") {
    $hasGpu = $true
}

if ($hasGpu) {
    Write-Host "  GPU runtime detected — using GPU profile" -ForegroundColor Green
    docker compose --profile embedding up -d ollama 2>&1 | Out-Host
} else {
    Write-Host "  No GPU runtime — using CPU profile" -ForegroundColor Yellow
    docker compose --profile embedding-cpu up -d ollama-cpu 2>&1 | Out-Host
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Docker compose failed. Is Docker Engine running?" -ForegroundColor Red
    exit 1
}

# Wait for BGE-M3 to be pulled inside container
Write-Host "  Waiting for BGE-M3 pull inside container (2-5 min on first run)..." -ForegroundColor Yellow
$retries = 0
$testBody = '{"model":"bge-m3","input":"test"}'
do {
    Start-Sleep -Seconds 10; $retries++
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:11434/v1/embeddings" `
            -Method Post -Body $testBody -ContentType "application/json" -TimeoutSec 10
        $dim = $result.data[0].embedding.Count
        Write-Host "  BGE-M3 ready! Dimension: $dim" -ForegroundColor Green
        break
    } catch {
        Write-Host "  ... waiting (attempt $retries/30)" -ForegroundColor Gray
    }
} while ($retries -lt 30)

if ($retries -ge 30) {
    Write-Host "  TIMEOUT: check logs with: docker logs csp-ollama" -ForegroundColor Magenta
    Write-Host "  Or pull manually: docker exec -it csp-ollama ollama pull bge-m3" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  Docker deployment done." -ForegroundColor Cyan
    Write-Host "  Endpoint: http://localhost:11434/v1" -ForegroundColor White
    Write-Host "  Model:    bge-m3" -ForegroundColor White
}
