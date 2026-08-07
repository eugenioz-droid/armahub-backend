@echo off
chcp 65001 >nul 2>&1
echo.
echo ============================================
echo   ArmaHub Smoke Test - Instalador y Runner
echo ============================================
echo.

REM Buscar Python
where python >nul 2>&1
if %errorlevel%==0 (
    set PYTHON=python
    goto :found
)
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" (
    set PYTHON="%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe"
    goto :found
)
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PYTHON="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :found
)
echo ERROR: No se encontro Python. Instala desde Microsoft Store.
pause
exit /b 1

:found
echo   Python encontrado: %PYTHON%
echo   Instalando dependencias...
%PYTHON% -m pip install requests --quiet 2>nul
echo   Listo. Ejecutando smoke test...
echo.
%PYTHON% "%~dp0smoke_test.py"
echo.
echo   (Selecciona todo el texto: clic derecho - Seleccionar todo - Enter)
echo   (Pegalo en el chat de Copilot)
echo.
pause
