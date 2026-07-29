@echo off
rem Double-click this to start Sherry Player.
cd /d "%~dp0"
start "" http://localhost:8123/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
