$ErrorActionPreference = "Stop"
$repoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
Set-Location $repoRoot

$pgBinDir = "C:\Program Files\PostgreSQL\18\bin"
$pgIsReadyExe = Join-Path $pgBinDir "pg_isready.exe"
$pgCtlExe = Join-Path $pgBinDir "pg_ctl.exe"
$postgresExe = Join-Path $pgBinDir "postgres.exe"

$pgdataDir = (Join-Path $repoRoot "backend\pgdata")
$pidFile = Join-Path $pgdataDir "postmaster.pid"

if (-not (Test-Path $pgdataDir)) {
    throw "Diretório do cluster não encontrado: $pgdataDir"
}

Write-Host "Verificando se PostgreSQL já está em execução na porta 5433..."
$alreadyRunning = $false
& $pgIsReadyExe -h 127.0.0.1 -p 5433 -q
if ($LASTEXITCODE -eq 0) {
    # Testar se o cluster ativo é o nosso cluster local
    if (Test-Path $pidFile) {
        $pidLines = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($pidLines.Count -ge 2) {
            $runningPid = [int]$pidLines[0]
            $runningDir = $pidLines[1].Trim().Replace('/', '\')
            if ($runningDir -eq $pgdataDir -and (Get-Process -Id $runningPid -ErrorAction SilentlyContinue)) {
                $alreadyRunning = $true
                Write-Host "PostgreSQL já está em execução e validado para este cluster (PID $runningPid)."
            }
        }
    }
    if (-not $alreadyRunning) {
        Write-Warning "Porta 5433 já está ocupada por outra instância de banco não pertencente a $pgdataDir!"
    }
}

$weStartedPg = $false
$pgProcess = $null

if (-not $alreadyRunning) {
    # Verificar se há arquivo de controle órfão (sem processo ativo correspondente)
    if (Test-Path $pidFile) {
        $pidLines = Get-Content $pidFile -ErrorAction SilentlyContinue
        $pidInFile = $null
        if ($pidLines.Count -ge 1 -and [int]::TryParse($pidLines[0], [ref]$pidInFile)) {
            $proc = Get-Process -Id $pidInFile -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -like "*postgres*") {
                throw "Arquivo postmaster.pid aponta para processo ativo ($pidInFile). Encerre-o antes de iniciar."
            }
        }
        Write-Host "Limpando postmaster.pid órfão (processo inativo comprovado)..."
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Iniciando PostgreSQL 18 local na porta 5433..."
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $postgresExe
    $startInfo.Arguments = "-D `"$pgdataDir`" -p 5433"
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $pgProcess = [System.Diagnostics.Process]::Start($startInfo)
    $weStartedPg = $true

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        & $pgIsReadyExe -h 127.0.0.1 -p 5433 -q
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            Write-Host "PostgreSQL pronto na porta 5433 (PID $($pgProcess.Id))!"
            break
        }
    }

    if (-not $ready) {
        throw "Timeout aguardando PostgreSQL iniciar na porta 5433."
    }
}

try {
    $scriptToRun = $args[0]
    $extraArgs = @()
    if ($args.Count -gt 1) {
        $extraArgs = $args[1..($args.Count - 1)]
    }
    if (-not $scriptToRun) {
        $scriptToRun = "backend/test/capacity-benchmark-v3.ts"
    }
    Write-Host "Executando script: $scriptToRun $extraArgs..."
    node backend/node_modules/tsx/dist/cli.mjs $scriptToRun @extraArgs
    $benchExit = $LASTEXITCODE
    Write-Host "Execução concluída com exit code: $benchExit"
    exit $benchExit
} finally {
    if ($weStartedPg -and $pgProcess -and (-not $pgProcess.HasExited)) {
        Write-Host "Encerrando graciosamente PostgreSQL criado por este script (PID $($pgProcess.Id))..."
        & $pgCtlExe stop -D "$pgdataDir" -m fast -s
        Start-Sleep -Seconds 1
        if (-not $pgProcess.HasExited) {
            $pgProcess.Kill()
        }
        Write-Host "PostgreSQL encerrado com sucesso."
    }
}
