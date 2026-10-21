@echo off
title Lions Library - GitHub Sync
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-push.ps1"
pause