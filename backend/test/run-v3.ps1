$ErrorActionPreference = "Stop"
$repoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
Set-Location $repoRoot

$pidFile = "backend/pgdata/postmaster.pid"
if (Test-Path $pidFile) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Iniciando PostgreSQL 18 local na porta 5433..."
$pg = Start-Process -FilePath "C:\Program Files\PostgreSQL\18\bin\postgres.exe" -ArgumentList "-D backend/pgdata -p 5433" -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 500
        & "C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -p 5433 -q
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            Write-Host "PostgreSQL pronto na porta 5433!"
            break
        }
    }

    if (-not $ready) {
        throw "Timeout aguardando PostgreSQL iniciar na porta 5433."
    }

    Write-Host "Executando Benchmark de Capacidade V3..."
    node backend/node_modules/tsx/dist/cli.mjs backend/test/capacity-benchmark-v3.ts
    $benchExit = $LASTEXITCODE
    Write-Host "Benchmark concluido com exit code: $benchExit"
    exit $benchExit
} finally {
    Write-Host "Encerrando PostgreSQL (PID $($pg.Id))..."
    Stop-Process -Id $pg.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (Test-Path $pidFile) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

