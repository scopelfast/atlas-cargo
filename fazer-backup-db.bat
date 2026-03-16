@echo off
chcp 65001 >nul
title Backup Atlas Cargo PRD (PostgreSQL)

echo.
echo ==========================================
echo   Iniciando Backup do PostgreSQL...
echo ==========================================
echo.

:: Configurando a senha (ajuste se necessario)
set "PGPASSWORD=SistMSQLServer2025&*"

:: Nome do arquivo com data e hora para nao sobrescrever backups antigos
for /f "tokens=1-6 delims=/: " %%a in ("%date% %time%") do set DTS=%%c%%a%%b_%%d%%e%%f
set DTS=%DTS: =0%
set "ARQUIVO=%~dp0atlas_cargo_prd_backup_%DTS%.sql"

"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U sa -h localhost -p 5432 -F p -b -v -f "%ARQUIVO%" atlas_cargo_prd

if %errorlevel% neq 0 (
  echo.
  echo Erro ao realizar o backup! Verifique se o banco de dados esta rodando e acessivel.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Backup concluido com sucesso!
echo   Arquivo gerado: %ARQUIVO%
echo ==========================================
echo.
pause
