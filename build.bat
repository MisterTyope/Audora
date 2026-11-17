@echo off
rem Construit l'appli Android (dist\Audora.apk), Audora pour Windows (dist\Audora\Audora.exe)
rem puis l'installateur (dist\Audora-Setup-X.Y.Z.exe, avec son empreinte .sha256).
rem L'apk est integre a Audora : la page Telephone le propose au telephone par le Wi-Fi.
cd /d "%~dp0"
rem Installe ce qui manque ; seul yt-dlp est mis a jour (YouTube change souvent).
python -m pip install -r requirements.txt pyinstaller
python -m pip install --upgrade --upgrade-strategy only-if-needed yt-dlp yt-dlp-ejs
python android\build_apk.py || goto :error
rem ffmpeg, ffprobe et node embarques : Audora marche aussi sur un PC qui ne les a pas.
python vendor_tools.py || goto :error
python -m PyInstaller --noconfirm --onedir --windowed --name Audora --icon icon.ico --add-data "web;web" --add-data "icon.ico;." --add-data "dist\Audora.apk;." --add-data "dist\Audora.json;." --add-data "vendor\bin;bin" --collect-data yt_dlp_ejs app.py || goto :error
rmdir /s /q build 2>nul
del Audora.spec 2>nul

for /f "delims=" %%v in ('python -c "from core.version import VERSION; print(VERSION)"') do set VERSION=%%v
set ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
if not exist "%ISCC%" set ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if exist "%ISCC%" (
  "%ISCC%" /Q /DAppVersion=%VERSION% installer\audora.iss || goto :error
  python -c "import hashlib,os,sys; p=sys.argv[1]; open(p+'.sha256','w').write(hashlib.sha256(open(p,'rb').read()).hexdigest()+'  '+os.path.basename(p)+chr(10))" dist\Audora-Setup-%VERSION%.exe
  echo Installateur : dist\Audora-Setup-%VERSION%.exe
) else (
  echo Inno Setup absent : pas d'installateur ^(winget install JRSoftware.InnoSetup^).
)
echo.
echo Termine : dist\Audora\Audora.exe
pause
exit /b 0
:error
echo La construction a echoue.
pause
exit /b 1
