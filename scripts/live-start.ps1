#requires -Version 5.1
<#
.SYNOPSIS
  Включает режим живой отладки: создаёт theme_live в проекте.

.DESCRIPTION
  Приложение читает тему в таком порядке:
    1. <проект>\theme_live  — если папка существует;
    2. <установка>\theme    — копия, которую кладёт apply.ps1.

  Пока существует theme_live, правки в ней подхватываются на лету.
  Папка theme (источник, который хранится в git) при этом не меняется.

  Чтобы сохранить правки: scripts\live-stop.ps1 — он перенесёт изменения
  из theme_live в theme и в копию у приложения и удалит theme_live.
#>
param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
$theme = Join-Path $root 'theme'
$live = Join-Path $root 'theme_live'

if (-not (Test-Path $theme)) { throw "нет папки theme: $theme" }

if (Test-Path $live) { Remove-Item $live -Recurse -Force }
New-Item -ItemType Directory -Force -Path $live | Out-Null
Copy-Item -Path (Join-Path $theme '*') -Destination $live -Recurse -Force

Write-Host "Живая отладка включена: $live"
Write-Host "Правьте файлы здесь — приложение подхватит изменения без перезапуска."
Write-Host "Завершить и сохранить изменения: scripts\live-stop.ps1"
