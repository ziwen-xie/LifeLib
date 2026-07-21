$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

Write-Host "Starting the LifeLibrary desktop app..." -ForegroundColor Cyan
npm start
