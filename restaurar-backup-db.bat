@echo off
chcp 65001 >nul
title Restaurar Backup Atlas Cargo PRD (PostgreSQL)

echo.
echo ==========================================
echo   Restaurar Backup do PostgreSQL
echo ==========================================
echo.

:: Ajuste usuário, senha e banco conforme o servidor
set "PGPASSWORD=SistMSQLServer2025&*"
set "DB_USER=sa"
set "DB_HOST=localhost"
set "DB_PORT=5432"
set "DB_NAME=atlas_cargo_prd"

if "%~1"=="" (
  echo Uso: restaurar-backup-db.bat "caminho\do\backup.sql"
  echo Ex.: restaurar-backup-db.bat "atlas_cargo_prd_backup_20261703_131038,55.sql"
  echo.
  pause
  exit /b 1
)

set "ARQUIVO=%~1"
if not exist "%ARQUIVO%" (
  echo Arquivo nao encontrado: %ARQUIVO%
  pause
  exit /b 1
)

echo Banco: %DB_NAME%
echo Arquivo: %ARQUIVO%
echo.

"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U %DB_USER% -h %DB_HOST% -p %DB_PORT% -d %DB_NAME% -f "%ARQUIVO%"

if %errorlevel% neq 0 (
  echo.
  echo Erro na restauracao. Verifique o arquivo e a conexao.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Restauracao concluida com sucesso!
echo ==========================================
echo.
pause
