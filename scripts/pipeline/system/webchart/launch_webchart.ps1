# WebChart launcher - starts the backend (8512) and frontend dev server (5173) each in
# their own hidden window (skipping any that are already running), waits for the frontend
# to answer, then opens it in the default browser.

$ErrorActionPreference = "SilentlyContinue"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$webchart = Join-Path $repoRoot "scripts\pipeline\system\webchart"
$logDir = Join-Path $env:TEMP "webchart_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Port($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

function Start-Hidden($workDir, $command, $logName) {
    $logFile = Join-Path $logDir $logName
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-Command", "cd '$workDir'; $command *> '$logFile'" `
        -WindowStyle Hidden
}

if (-not (Test-Port 8512)) {
    Write-Host "Starting backend (8512)..."
    Start-Hidden $repoRoot "python -m uvicorn scripts.pipeline.system.webchart.backend.main:app --port 8512" "backend.log"
} else {
    Write-Host "Backend (8512) already running."
}

if (-not (Test-Port 5173)) {
    Write-Host "Starting frontend (5173)..."
    Start-Hidden (Join-Path $webchart "frontend") "npm run dev" "frontend.log"
} else {
    Write-Host "Frontend (5173) already running."
}

Write-Host "Waiting for frontend to come up..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port 5173) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}

if ($ready) {
    Start-Sleep -Milliseconds 500
    Start-Process "http://localhost:5173"
} else {
    Write-Host "Frontend did not come up in time - check logs in $logDir"
    Start-Sleep -Seconds 5
}
