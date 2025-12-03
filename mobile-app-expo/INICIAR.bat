@echo off
chcp 65001 >nul
cls

echo ╔════════════════════════════════════════════════════════════╗
echo ║     📱 EXPO - INICIAR APP MOTORISTA 🚀                     ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo ✅ Backend deve estar rodando: http://192.168.1.173:3000
echo ✅ Expo Go deve estar instalado no celular
echo ✅ Celular e PC na mesma rede WiFi
echo.
echo ═══════════════════════════════════════════════════════════
echo.

echo 🔄 Instalando dependências...
call npm install

echo.
echo ═══════════════════════════════════════════════════════════
echo.
echo 🚀 Iniciando Expo...
echo.
echo 📱 Quando aparecer o QR CODE:
echo    1. Abrir "Expo Go" no celular
echo    2. Tocar em "Scan QR Code"
echo    3. Apontar câmera para o QR Code
echo    4. APP abre automaticamente!
echo.
echo ═══════════════════════════════════════════════════════════
echo.
pause

call npx expo start --tunnel

pause

