@echo off
title Highway Rush 3D - Servidor Local
echo Iniciando servidor do jogo em http://localhost:8080 ...
start "" "http://localhost:8080"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
