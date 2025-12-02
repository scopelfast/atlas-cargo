@echo off
:: ================================================
:: Script: Liberar Porta 8083 no Firewall
:: ================================================

echo.
echo ========================================
echo   LIBERANDO PORTA 8083 NO FIREWALL
echo ========================================
echo.

:: Verificar se está rodando como administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Este script precisa ser executado como ADMINISTRADOR!
    echo.
    echo Clique com botao direito no arquivo e escolha:
    echo "Executar como administrador"
    echo.
    pause
    exit /b 1
)

echo Criando regra de firewall...
echo.

netsh advfirewall firewall add rule name="Node.js 3000 Local" dir=in action=allow protocol=TCP localport=3000

if %errorLevel% equ 0 (
    echo.
    echo ========================================
    echo   [OK] PORTA 3000 LIBERADA!
    echo ========================================
    echo.
    echo Agora voce pode acessar do celular (mesmo WiFi):
    echo http://192.168.1.173:3000/motorista/
    echo.
) else (
    echo.
    echo [ERRO] Falha ao criar regra!
    echo.
)

pause

