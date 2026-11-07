@echo off
title Highway Rush 3D - Servidor Local (Fullscreen)
echo Iniciando servidor do jogo em http://localhost:8080 ...
start "" msedge --app="http://localhost:8080/?fullscreen=1" --start-fullscreen 2>nul || start "" chrome --app="http://localhost:8080/?fullscreen=1" --start-fullscreen 2>nul || start "" "http://localhost:8080/?fullscreen=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

