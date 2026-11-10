[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Files,
    [ValidateRange(1, 600)]
    [int]$TimeoutSeconds = 120,
    [string]$DartExe = 'C:\flutter\bin\cache\dart-sdk\bin\dart.exe'
)

$ErrorActionPreference = 'Stop'
$mobile = Split-Path -Parent $PSScriptRoot
$lib = Join-Path $mobile 'lib'
$libPrefix = $lib + [IO.Path]::DirectorySeparatorChar
$targets = foreach ($file in $Files) {
    $path = (Resolve-Path -LiteralPath (Join-Path $mobile $file)).ProviderPath
    if (!$path.StartsWith($libPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetExtension($path) -ne '.dart' -or
        !(Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Informe um arquivo .dart em lib/, relativo a mobile: $file"
    }
    $path.Substring($mobile.Length + 1)
}

$analyzer = (Resolve-Path -LiteralPath $DartExe).ProviderPath
$clock = [Diagnostics.Stopwatch]::StartNew()
$work = Join-Path ([IO.Path]::GetTempPath()) ('lumora-dart-check-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $work, (Join-Path $work '.dart_tool')

# Usa a configuração local de dependências. O diretório temporário exclui os builds.
Copy-Item -LiteralPath $lib -Destination $work -Recurse
foreach ($file in @('pubspec.yaml', 'analysis_options.yaml', '.dart_tool/package_config.json')) {
    Copy-Item -LiteralPath (Join-Path $mobile $file) -Destination (Join-Path $work $file)
}

Write-Output "Arquivos e saídas desta execução: $work"
$result = 0
$index = 0
foreach ($target in ($targets | Select-Object -Unique)) {
    $remaining = ($TimeoutSeconds * 1000) - [int]$clock.ElapsedMilliseconds
    if ($remaining -le 0) {
        Write-Output "Prazo de $TimeoutSeconds segundos atingido antes de analisar $target."
        $result = 124
        break
    }

    $index++
    $stdout = Join-Path $work "analyze-$index.out"
    $stderr = Join-Path $work "analyze-$index.err"
    Write-Output "Analisando $target"
    $process = Start-Process -FilePath $analyzer -ArgumentList @('analyze', ('"{0}"' -f $target)) -WorkingDirectory $work -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru

    if (!$process.WaitForExit($remaining)) {
        if (!$process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
        Get-Content -LiteralPath $stdout, $stderr
        Write-Output "Análise interrompida após $TimeoutSeconds segundos."
        $result = 124
        break
    }

    $process.Refresh()
    Get-Content -LiteralPath $stdout, $stderr
    Write-Output "Código de saída de $target = $($process.ExitCode)"
    if ($result -eq 0 -and $process.ExitCode -ne 0) {
        $result = $process.ExitCode
    }
}

Write-Output ('Duração total: {0:N2} s' -f $clock.Elapsed.TotalSeconds)
exit $result
