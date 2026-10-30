# Auditoria Técnica de Páginas de 16 KB em Bibliotecas Nativas (.so)
# Requisito Google Play / Android 15 (API 35) e 16 (API 36)
param(
    [string]$ApkPath = "mobile\build\app\outputs\flutter-apk\app-release.apk"
)

if (-not (Test-Path $ApkPath)) {
    Write-Error "APK não encontrado em $ApkPath"
    exit 1
}

Write-Host "🔍 [AUDITORIA TÉCNICA 16 KB — GOOGLE PLAY DATA & NATIVE LIBRARIES]" -ForegroundColor Cyan
Write-Host "Arquivo analisado: $ApkPath"
$apkItem = Get-Item $ApkPath
Write-Host "Tamanho: $([math]::Round($apkItem.Length / 1MB, 2)) MB ($($apkItem.Length) bytes)"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ApkPath)
$soList = $zip.Entries | Where-Object { $_.FullName -like "lib/*.so" }

$report = @()
foreach ($entry in $soList) {
    $stream = $entry.Open()
    $ms = New-Object System.IO.MemoryStream
    $stream.CopyTo($ms)
    $bytes = $ms.ToArray()
    $stream.Dispose()
    $ms.Dispose()

    if ($bytes.Length -lt 52 -or $bytes[0] -ne 0x7F -or $bytes[1] -ne 0x45 -or $bytes[2] -ne 0x4C -or $bytes[3] -ne 0x46) {
        continue
    }

    $is64 = ($bytes[4] -eq 2)
    $alignments = @()

    if ($is64) {
        $phOff = [BitConverter]::ToInt64($bytes, 32)
        $phEntSize = [BitConverter]::ToInt16($bytes, 54)
        $phNum = [BitConverter]::ToInt16($bytes, 56)
        for ($i = 0; $i -lt $phNum; $i++) {
            $off = $phOff + ($i * $phEntSize)
            if ($off + $phEntSize -gt $bytes.Length) { break }
            $pType = [BitConverter]::ToUInt32($bytes, $off)
            if ($pType -eq 1) { # PT_LOAD
                $pAlign = [BitConverter]::ToUInt64($bytes, $off + 48)
                $alignments += $pAlign
            }
        }
    } else {
        $phOff = [BitConverter]::ToInt32($bytes, 28)
        $phEntSize = [BitConverter]::ToInt16($bytes, 42)
        $phNum = [BitConverter]::ToInt16($bytes, 44)
        for ($i = 0; $i -lt $phNum; $i++) {
            $off = $phOff + ($i * $phEntSize)
            if ($off + $phEntSize -gt $bytes.Length) { break }
            $pType = [BitConverter]::ToUInt32($bytes, $off)
            if ($pType -eq 1) { # PT_LOAD
                $pAlign = [BitConverter]::ToUInt32($bytes, $off + 28)
                $alignments += $pAlign
            }
        }
    }

    $minAlign = ($alignments | Measure-Object -Minimum).Minimum
    $maxAlign = ($alignments | Measure-Object -Maximum).Maximum
    $status = if ($minAlign -ge 16384) { "ALINHADO 16KB+" } else { "4KB (REQUER ATUALIZAÇÃO UPSTREAM)" }

    $report += [PSCustomObject]@{
        Biblioteca = $entry.FullName
        Arch64 = $is64
        MinAlignBytes = $minAlign
        MaxAlignBytes = $maxAlign
        Status16Kb = $status
    }
}
$zip.Dispose()

$report | Format-Table -AutoSize

$total = $report.Count
$compat = ($report | Where-Object { $_.MinAlignBytes -ge 16384 }).Count
$needUpstream = ($report | Where-Object { $_.MinAlignBytes -lt 16384 }).Count

Write-Host "Total de binários .so auditados: $total"
Write-Host "Binários compatíveis (16 KB / 64 KB): $compat" -ForegroundColor Green
Write-Host "Binários com 4 KB (requer atualização upstream de plugin): $needUpstream" -ForegroundColor Yellow
