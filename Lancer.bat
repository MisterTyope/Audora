@echo off
rem Lance Audora (depuis les sources) sans fenetre de console.
rem En cas de souci : %LOCALAPPDATA%\Audora\erreur.log
cd /d "%~dp0"
start "" pythonw app.py
