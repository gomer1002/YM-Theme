#requires -Version 5.1
<#
.SYNOPSIS
  Выключает режим живой отладки: переносит theme_live обратно в тему.

.DESCRIPTION
  Копирует <проект>\theme_live -> <проект>\theme (источник, который лежит
  в git) и -> <установка>\theme (копия, которую читает приложение),
  после чего удаляет theme_live.

  Приложение само переключится на копию у себя: загрузчик замечает
  исчезновение theme_live и перечитывает тему. Перезапуск не нужен,
  apply.ps1 — тоже (пересобирать app.asar не требуется).
#>
param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
$theme = Join-Path $root 'theme'
$live = Join-Path $root 'theme_live'
$install = Join-Path $env:LOCALAPPDATA 'Programs\YandexMusic'
$themeCopy = Join-Path $install 'theme'

if (-not (Test-Path $live)) {
    Write-Host "theme_live нет — живая отладка не включена."
    exit 0
}

# 1. изменения -> источник в проекте
if (Test-Path $theme) { Remove-Item $theme -Recurse -Force }
New-Item -ItemType Directory -Force -Path $theme | Out-Null
Copy-Item -Path (Join-Path $live '*') -Destination $theme -Recurse -Force
Write-Host "Изменения перенесены в проект: $theme"

# 2. изменения -> копия у приложения (её читает загрузчик)
if (Test-Path $themeCopy) { Remove-Item $themeCopy -Recurse -Force }
New-Item -ItemType Directory -Force -Path $themeCopy | Out-Null
Copy-Item -Path (Join-Path $live '*') -Destination $themeCopy -Recurse -Force
Write-Host "Копия у приложения обновлена: $themeCopy"

# 3. выключаем live-режим
Remove-Item $live -Recurse -Force
Write-Host "theme_live удалён — приложение переключилось на копию у себя."
