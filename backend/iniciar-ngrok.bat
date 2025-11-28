@echo off
REM Script para iniciar ngrok e atualizar .env automaticamente
REM Uso: iniciar-ngrok.bat

echo 🔍 Verificando se o servidor está rodando na porta 3000...

REM Verificar se o servidor está rodando
netstat -ano | findstr :3000 >nul
if errorlevel 1 (
    echo ❌ Servidor não está rodando na porta 3000!
    echo 💡 Execute primeiro: npm run dev
    pause
    exit /b 1
)

echo ✅ Servidor detectado na porta 3000
echo.

REM Verificar se o ngrok está instalado
where ngrok >nul 2>&1
if errorlevel 1 (
    echo ⚠️  ngrok não encontrado no PATH
    echo 💡 Baixe em: https://ngrok.com/download
    echo 💡 Ou coloque ngrok.exe nesta pasta
    echo.
    
    REM Verificar se ngrok.exe está na pasta atual
    if exist "ngrok.exe" (
        echo ✅ Encontrado: ngrok.exe
        set NGROK_CMD=ngrok.exe
    ) else (
        echo ❌ ngrok não encontrado. Por favor, instale o ngrok primeiro.
        pause
        exit /b 1
    )
) else (
    set NGROK_CMD=ngrok
)

echo 🚀 Iniciando ngrok...
echo 📝 Quando o ngrok iniciar, copie a URL HTTPS
echo 💡 A URL será algo como: https://abc123-def456.ngrok-free.dev
echo.
echo ⚠️  IMPORTANTE: Após o ngrok iniciar, você precisará:
echo    1. Copiar a URL HTTPS que aparece
echo    2. Atualizar o arquivo .env manualmente
echo    3. Reiniciar o servidor Node.js
echo.
echo Pressione qualquer tecla para iniciar o ngrok...
pause >nul

REM Iniciar ngrok
%NGROK_CMD% http 3000

