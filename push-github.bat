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
  echo Erro no push. Verifique conexao e credenciais.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Concluido. Alteracoes enviadas.
echo ==========================================
echo.
pause
