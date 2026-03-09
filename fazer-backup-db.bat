@echo off
chcp 65001 >nul
title Backup Atlas Cargo PRD (PostgreSQL)

echo.
echo ==========================================
echo   Iniciando Backup do PostgreSQL...
echo ==========================================
echo.

:: Configurando a senha fornecida no .env
set "PGPASSWORD=Atlas2020$$"

:: O comando usa as aspas no SET para garantir que o & e o * sejam lidos corretamente como texto

"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U atlascargo -h localhost -p 5432 -F c -b -v -f "C:\gitHub\SysScopel\atlas_cargo_prd_backup.dump" atlas_cargo_prd

if %errorlevel% neq 0 (
  echo.
  echo Erro ao realizar o backup! Verifique se o banco de dados esta rodando e acessivel.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Backup concluido com sucesso!
echo   Arquivo gerado: atlas_cargo_prd_backup.dump
echo ==========================================
echo.
pause
