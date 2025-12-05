@echo off
chcp 65001 >nul
cls

echo ╔════════════════════════════════════════════════════════════╗
echo ║     📱 COMPILAR APP ANDROID - DIVULGACARGA 🚀             ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo 🔍 Verificando dispositivos conectados...
echo.
adb devices
echo.

echo ═══════════════════════════════════════════════════════════
echo.
echo Escolha uma opção:
echo.
echo [1] 🚀 Instalar no celular (recomendado)
echo [2] 📦 Gerar APK de teste
echo [3] 🧹 Limpar e reinstalar
echo [4] ❌ Cancelar
echo.
set /p opcao="Digite o número da opção: "

if "%opcao%"=="1" goto instalar
if "%opcao%"=="2" goto gerar_apk
if "%opcao%"=="3" goto limpar
if "%opcao%"=="4" goto fim
goto fim

:instalar
echo.
echo ═══════════════════════════════════════════════════════════
echo 🚀 Instalando APP no dispositivo...
echo ═══════════════════════════════════════════════════════════
echo.
echo ⚠️  Certifique-se de que:
echo    ✅ Celular está conectado via USB
echo    ✅ Depuração USB está ativada
echo    ✅ Backend está rodando (porta 3000)
echo    ✅ IP configurado em src/services/api.js
echo.
pause
echo.
echo 📦 Instalando dependências (se necessário)...
call npm install
echo.
echo 🔨 Compilando e instalando...
call npm run android
echo.
echo ✅ Processo concluído!
goto fim

:gerar_apk
echo.
echo ═══════════════════════════════════════════════════════════
echo 📦 Gerando APK de teste...
echo ═══════════════════════════════════════════════════════════
echo.
cd android
echo 🔨 Compilando APK Debug...
call gradlew assembleDebug
cd ..
echo.
echo ✅ APK gerado com sucesso!
echo.
echo 📂 Localização:
echo    android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo 💡 Para instalar:
echo    1. Copie o APK para o celular
echo    2. Abra o arquivo no celular
echo    3. Permita instalação de fontes desconhecidas
echo.
pause
goto fim

:limpar
echo.
echo ═══════════════════════════════════════════════════════════
echo 🧹 Limpando e reinstalando...
echo ═══════════════════════════════════════════════════════════
echo.
echo 🗑️  Limpando cache do Gradle...
cd android
call gradlew clean
cd ..
echo.
echo 🗑️  Limpando cache do Metro...
call npm start -- --reset-cache &
timeout /t 5 /nobreak >nul
taskkill /F /IM node.exe
echo.
echo 📦 Reinstalando dependências...
rmdir /S /Q node_modules
call npm install
echo.
echo 🚀 Instalando no dispositivo...
call npm run android
echo.
echo ✅ Processo concluído!
goto fim

:fim
echo.
echo ═══════════════════════════════════════════════════════════
echo.
pause

