@echo off
rem Construit l'appli Android (dist\Audora.apk) puis Audora pour Windows (dist\Audora\Audora.exe).
rem L'apk est integre a Audora : la page Telephone le propose au telephone par le Wi-Fi.
cd /d "%~dp0"
python -m pip install --upgrade -r requirements.txt pyinstaller
python android\build_apk.py || goto :error
python -m PyInstaller --noconfirm --onedir --windowed --name Audora --icon icon.ico --add-data "web;web" --add-data "icon.ico;." --add-data "dist\Audora.apk;." --add-data "dist\Audora.json;." app.py || goto :error
echo.
echo Termine : dist\Audora\Audora.exe
pause
exit /b 0
:error
echo La construction a echoue.
pause
exit /b 1
