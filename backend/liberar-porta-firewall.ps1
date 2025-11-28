# Script para liberar a porta 3000 no Firewall do Windows
# Execute como Administrador: PowerShell -ExecutionPolicy Bypass -File .\liberar-porta-firewall.ps1

Write-Host "Liberando porta 3000 no Firewall do Windows..." -ForegroundColor Yellow

# Verificar se ja existe uma regra para a porta 3000
$existingRule = Get-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000" -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "Regra ja existe. Removendo regra antiga..." -ForegroundColor Yellow
    Remove-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000"
}

# Criar nova regra de entrada para a porta 3000
try {
    New-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Description "Permite acesso ao servidor Node.js na porta 3000" | Out-Null
    
    Write-Host "Porta 3000 liberada com sucesso no Firewall!" -ForegroundColor Green
    
    # Detectar IP atual para mostrar na mensagem
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" } | Select-Object -First 1).IPAddress
    if ($localIP) {
        Write-Host "Agora voce pode acessar o servidor pelo IP da rede: http://${localIP}:3000" -ForegroundColor Cyan
    } else {
        Write-Host "Execute 'ipconfig' para descobrir seu IP e acesse: http://SEU_IP:3000" -ForegroundColor Cyan
    }
} catch {
    Write-Host "Erro ao criar regra do firewall: $_" -ForegroundColor Red
    Write-Host "Certifique-se de executar este script como Administrador!" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Verificando regras criadas..." -ForegroundColor Yellow
Get-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000" | Format-Table DisplayName, Enabled, Direction, Action

