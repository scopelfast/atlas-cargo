@echo off
:: =====================================================
:: Script: atualizar-versao.bat
:: Descrição: Facilita atualização de versão e deploy
:: =====================================================

cd /d %~dp0

echo.
echo ========================================
echo   Sistema de Atualização - Atlas Cargo
echo ========================================
echo.

:: Mostrar versão atual
echo Verificando versão atual...
findstr "APP_VERSION" public\js\version.js
echo.

:: Perguntar nova versão
set /p NOVA_VERSAO="Digite a NOVA VERSAO (ex: 20250102-1600 ou v1.0.1): "

if "%NOVA_VERSAO%"=="" (
    echo.
    echo [ERRO] Versão não pode ser vazia!
    pause
    exit /b
)

echo.
echo Atualizando versão para: %NOVA_VERSAO%
echo.

:: Criar backup do version.js
copy public\js\version.js public\js\version.js.bak >nul 2>&1

:: Atualizar o arquivo version.js usando PowerShell
powershell -Command "(Get-Content public\js\version.js) -replace \"window.APP_VERSION = '[^']*';\", \"window.APP_VERSION = '%NOVA_VERSAO%';\" | Set-Content public\js\version.js"

echo [OK] Versão atualizada com sucesso!
echo.

:: Mostrar nova versão
echo Nova versão definida:
findstr "APP_VERSION" public\js\version.js
echo.

:: Perguntar se quer fazer commit
set /p COMMIT="Deseja fazer commit e push? (S/N): "

if /i "%COMMIT%"=="S" (
    echo.
    echo Adicionando arquivos ao Git...
    git add .
    
    echo.
    echo Fazendo commit...
    git commit -m "Atualização versão %NOVA_VERSAO% - Cache busting"
    
    echo.
    echo Atualizando do repositório remoto...
    git pull origin main
    
    echo.
    echo Enviando para o repositório...
    git push origin main
    
    echo.
    echo [OK] Deploy concluído com sucesso!
) else (
    echo.
    echo [AVISO] Lembre-se de fazer commit manualmente!
)

echo.
echo ========================================
echo   Atualização concluída!
echo ========================================
echo.
echo Próximos passos:
echo 1. Publique os arquivos no servidor
echo 2. Teste em: http://cargas.integrabrasil.com:8083/
echo 3. Verifique se a nova versão aparece no console (F12)
echo.
pause

