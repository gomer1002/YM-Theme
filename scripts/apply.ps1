#requires -Version 5.1
<#
.SYNOPSIS
  Устанавливает/обновляет тему YaMusicCustom в установленном приложении
  «Яндекс Музыка» (Windows, Electron).

.DESCRIPTION
  Что делает скрипт:
    1. Закрывает запущенное приложение.
    2. Один раз сохраняет оригиналы: resources\app.asar -> app.asar.orig
       и «Яндекс Музыка.exe» -> «Яндекс Музыка.exe.orig».
    3. Собирает app.asar = оригинал + загрузчик темы (src\loader.js).
    4. Пересчитывает встроенный в exe SHA-256 заголовка asar (иначе Electron
       отказывается запускаться: включена фьюза AsarIntegrityValidation).
    5. Атомарно подменяет файлы и запускает приложение.

  Повторный запуск безопасен: патч всегда собирается из app.asar.orig.
  После обновления приложения достаточно запустить скрипт ещё раз.

.PARAMETER NoRestart
  Не запускать приложение после патча.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic'),
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONIOENCODING = 'utf-8'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $InstallDir 'Яндекс Музыка.exe'
$resources = Join-Path $InstallDir 'resources'
$asar = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'
$exeBackup = Join-Path $InstallDir 'Яндекс Музыка.exe.orig'
$stateFile = Join-Path $resources 'custom-theme-state.json'

$python = $null
foreach ($candidate in @('python', 'python3')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source; break }
}
if (-not $python) {
    Write-Host ''
    Write-Host 'ОШИБКА: не найден Python в PATH.' -ForegroundColor Red
    Write-Host 'Для сборки app.asar нужен Python 3.8 или новее.'
    Write-Host 'Установите его с https://www.python.org/downloads/ и при установке'
    Write-Host 'включите галочку "Add python.exe to PATH", затем запустите скрипт снова.'
    Write-Host ''
    exit 1
}

$pythonMajor = & $python -c "import sys; print(sys.version_info[0])" 2>$null
$pythonMinor = & $python -c "import sys; print(sys.version_info[1])" 2>$null
if (-not ($pythonMajor -eq '3' -and [int]$pythonMinor -ge 8)) {
    Write-Host ''
    Write-Host "ОШИБКА: найден Python $pythonMajor.$pythonMinor, нужен 3.8 или новее." -ForegroundColor Red
    Write-Host "Путь: $python"
    Write-Host ''
    exit 1
}

if (-not (Test-Path $asar)) { throw "не найден $asar" }
if (-not (Test-Path $exe)) { throw "не найден $exe" }

$version = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "Версия приложения: $version"

# если приложение обновилось — старые бэкапы не подходят
if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($state.version -and $state.version -ne $version) {
        Write-Host "Приложение обновилось ($($state.version) -> $version), пересоздаю бэкапы."
        Remove-Item $backup -Force -ErrorAction SilentlyContinue
        Remove-Item $exeBackup -Force -ErrorAction SilentlyContinue
    }
}

$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($procs.Count -gt 0) {
    Write-Host "Закрываю приложение ($($procs.Count) процессов)..."
    # приложение умеет перезапускаться после падения — гасим, пока не погаснет
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        if ($procs.Count -eq 0) { break }
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 700
    }
    $left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
    if ($left.Count -gt 0) { throw 'приложение всё ещё запущено' }
}

if (-not (Test-Path $backup)) {
    Write-Host "Сохраняю оригинал: app.asar.orig"
    Copy-Item -LiteralPath $asar -Destination $backup
}

# копия темы рядом с приложением: сюда приложение будет смотреть, если папки
# theme_live в проекте нет (то есть когда проект удалён или не нужен)
$themeSrc = Join-Path $root 'theme'
$themeLive = Join-Path $root 'theme_live'
$themeCopy = Join-Path $InstallDir 'theme'

if (-not (Test-Path $themeSrc)) { throw "не найдена папка с темой: $themeSrc" }
if (Test-Path $themeCopy) { Remove-Item $themeCopy -Recurse -Force }
New-Item -ItemType Directory -Force -Path $themeCopy | Out-Null
Copy-Item -Path (Join-Path $themeSrc '*') -Destination $themeCopy -Recurse -Force
Write-Host "Тема скопирована в приложение: $themeCopy"

$tmp = Join-Path $resources 'app.asar.new'
if (Test-Path $tmp) { Remove-Item $tmp -Force }

& $python (Join-Path $root 'tools\make_patched_asar.py') `
    --src $backup `
    --dst $tmp `
    --live-dir $themeLive `
    --theme-copy $themeCopy
if ($LASTEXITCODE -ne 0) { throw 'сборка патча не удалась' }

& $python (Join-Path $root 'tools\patch_exe_integrity.py') `
    --exe $exe `
    --old $asar `
    --new $tmp
if ($LASTEXITCODE -ne 0) { throw 'не удалось обновить хеш в exe' }

Copy-Item -LiteralPath $tmp -Destination $asar -Force
Remove-Item -LiteralPath $tmp -Force

@{ version = $version; applied = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8

Write-Host 'Патч установлен.'

if (-not $NoRestart) {
    Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    Write-Host 'Приложение запущено.'
}
