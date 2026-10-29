#requires -Version 5.1
<#
.SYNOPSIS
  Показывает состояние установки: версия, патчено ли приложение и есть ли бэкапы.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic')
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONIOENCODING = 'utf-8'

$exe = Join-Path $InstallDir 'Яндекс Музыка.exe'
$resources = Join-Path $InstallDir 'resources'
$asar = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'
$exeBackup = Join-Path $InstallDir 'Яндекс Музыка.exe.orig'
$stateFile = Join-Path $resources 'custom-theme-state.json'

if (-not (Test-Path $asar)) { throw "не найден $asar" }

"Установка  : $InstallDir"
"Версия     : $((Get-Item $exe).VersionInfo.ProductVersion)"
"app.asar   : {0:N0} байт" -f (Get-Item $asar).Length

$patched = $false
$stream = [System.IO.File]::OpenRead($asar)
try {
    $tail = 64KB
    $buffer = New-Object byte[] $tail
    $stream.Seek([Math]::Max(0, $stream.Length - $tail), 'Begin') | Out-Null
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $text = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    $patched = $text.Contains('YaMusicCustom:loader')
}
finally { $stream.Dispose() }

if ($patched) { 'Состояние  : ПАТЧЕНО (тема активна)' } else { 'Состояние  : оригинал, без патча' }

if (Test-Path $backup) {
    "Бэкап asar : есть ({0:N0} байт)" -f (Get-Item $backup).Length
}
else {
    'Бэкап asar : нет (появится после первого apply.ps1)'
}

if (Test-Path $exeBackup) {
    "Бэкап exe  : есть ({0:N0} байт)" -f (Get-Item $exeBackup).Length
}
else {
    'Бэкап exe  : нет'
}

if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    "Патч от    : $($state.applied) (версия $($state.version))"
}

$root = Split-Path -Parent $PSScriptRoot
$themeLive = Join-Path $root 'theme_live'
$themeCopy = Join-Path $InstallDir 'theme'
"Тема live  : $(if (Test-Path $themeLive) { 'есть (theme_live в проекте)' } else { 'нет' })"
"Тема копия : $(if (Test-Path $themeCopy) { 'есть (' + $themeCopy + ')' } else { 'нет' })"

$logFile = Join-Path $env:APPDATA 'YandexMusic\custom-theme.log'
if (Test-Path $logFile) {
    $active = (Get-Content $logFile | Select-String 'theme dir: ' | Select-Object -Last 1)
    if ($active) { "Активная   : $($active.Line -replace '^\[[^\]]+\] theme dir: ', '')" }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if ($python -and $patched) {
    & $python.Source (Join-Path $root 'tools\patch_exe_integrity.py') --exe $exe --old $asar --verify
}
elseif (-not $python -and $patched) {
    'Проверка хеша exe: пропущена (Python не найден в PATH)'
}
