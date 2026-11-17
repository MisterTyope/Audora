@echo off
rem Lance tous les tests automatiques d'Audora (Python + JavaScript). Aucun ne touche a tes vraies donnees.
cd /d "%~dp0"
python -m pytest tests -q -p no:cacheprovider || goto :error
node --test tests\mixes.test.mjs || goto :error
echo.
echo Tous les tests sont passes.
pause
exit /b 0
:error
echo.
echo Un test a echoue : voir le detail ci-dessus.
pause
exit /b 1
