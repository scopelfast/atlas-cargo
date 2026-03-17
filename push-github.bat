@echo off
chcp 65001 >nul
title AtlasCargo - Subir para GitHub
cd /d "%~dp0"

echo.
echo ==========================================
echo   AtlasCargo - Subir para GitHub
echo ==========================================
echo.

git status --short
if %errorlevel% neq 0 (
  echo Erro: nao foi possivel acessar o Git. Verifique se esta na pasta do projeto.
  pause
  exit /b 1
)

echo.
set /p MSG="Digite a mensagem do commit (ou Enter para 'Atualizacao'): "
if "%MSG%"=="" set MSG=Atualizacao

echo.
echo Adicionando arquivos...
git add -A
REM Garantir que .env nunca seja commitado (seguranca)
git reset HEAD -- .env .env.local backend/.env backend/.env.local 2>nul

echo Fazendo commit: %MSG%
git commit -m "%MSG%"
if %errorlevel% neq 0 (
  echo Nenhuma alteracao para commitar, ou erro no commit.
  pause
  exit /b 0
)

echo.
echo Enviando para GitHub...
git push origin main
if %errorlevel% neq 0 (
  echo.
  echo O remoto tem commits que voce nao tem localmente.
  echo Como a sua maquina e a fonte, pode sobrescrever o remoto.
  set /p FORCAR="Sobrescrever o GitHub com sua versao? (S/N): "
  if /i "%FORCAR%"=="S" git push origin main --force
  if /i "%FORCAR%"=="S" if %errorlevel% equ 0 echo Concluido. Remoto atualizado com sua versao.
  if /i "%FORCAR%"=="S" if %errorlevel% neq 0 echo Erro no push --force.
  if /i not "%FORCAR%"=="S" echo Push cancelado. Nada foi enviado.
  echo.
  pause
  exit /b 0
)

echo.
echo ==========================================
echo   Concluido. Alteracoes enviadas.
echo ==========================================
echo.
pause
