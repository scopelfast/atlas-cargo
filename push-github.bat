@echo off
REM Script batch para agilizar push para GitHub
REM Uso: push-github.bat "Mensagem do commit"

setlocal

if "%1"=="" (
    set mensagem=Atualização do sistema
) else (
    set mensagem=%1
)

echo.
echo ========================================
echo   Push para GitHub - Sistema DivulgaCarga
echo ========================================
echo.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0push-github.ps1" -mensagem "%mensagem%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Erro ao executar o script!
    pause
    exit /b %ERRORLEVEL%
)

echo.
pause

