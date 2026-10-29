#requires -Version 5.1
<#
.SYNOPSIS
  Возвращает приложение «Яндекс Музыка» к заводскому виду:
  восстанавливает app.asar и exe из бэкапов, убирает файл состояния.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic'),
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$exe = Join-Path $InstallDir 'Яндекс Музыка.exe'
$resources = Join-Path $InstallDir 'resources'
$asar = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'
$exeBackup = Join-Path $InstallDir 'Яндекс Музыка.exe.orig'
$stateFile = Join-Path $resources 'custom-theme-state.json'

if (-not (Test-Path $backup)) {
    Write-Host 'Резервной копии app.asar.orig нет — приложение и так не патчено.'
    exit 0
}

$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($procs.Count -gt 0) {
    Write-Host "Закрываю приложение ($($procs.Count) процессов)..."
    $procs | Stop-Process -Force
    Start-Sleep -Milliseconds 1500
}

if (Test-Path $exeBackup) {
    Copy-Item -LiteralPath $exeBackup -Destination $exe -Force
    Write-Host 'Оригинальный exe восстановлен.'
}
Copy-Item -LiteralPath $backup -Destination $asar -Force
Write-Host 'Оригинальный app.asar восстановлен.'

# копия темы у приложения больше не нужна
$themeCopy = Join-Path $InstallDir 'theme'
if (Test-Path $themeCopy) {
    Remove-Item $themeCopy -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'Копия темы у приложения удалена.'
}

Remove-Item $stateFile -Force -ErrorAction SilentlyContinue

if (-not $NoRestart) {
    Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    Write-Host 'Приложение запущено.'
}
