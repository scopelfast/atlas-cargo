# Script para atualizar automaticamente o IP local no arquivo .env
# Detecta o IP atual da rede Wi-Fi/Ethernet e atualiza PUBLIC_URL

Write-Host "Detectando IP local da rede..." -ForegroundColor Yellow

# Obter o IP do adaptador Wi-Fi ou Ethernet ativo
$networkAdapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*"
} | Sort-Object InterfaceIndex

if ($networkAdapters.Count -eq 0) {
    Write-Host "Erro: Nenhum adaptador de rede ativo encontrado!" -ForegroundColor Red
    exit 1
}

# Pegar o primeiro IP válido (geralmente o Wi-Fi ou Ethernet principal)
$localIP = $networkAdapters[0].IPAddress
$port = 3000
$publicUrl = "http://${localIP}:${port}"

Write-Host "IP detectado: $localIP" -ForegroundColor Green
Write-Host "URL publica: $publicUrl" -ForegroundColor Cyan

# Caminho do arquivo .env
$envPath = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envPath)) {
    Write-Host "Arquivo .env nao encontrado em: $envPath" -ForegroundColor Red
    Write-Host "Criando arquivo .env..." -ForegroundColor Yellow
    
    # Criar arquivo .env básico se não existir
    @"
# Configuracoes do Backend
DB_SERVER=seu_servidor
DB_PORT=1433
DB_DATABASE=seu_banco
DB_USER=seu_usuario
DB_PASSWORD=sua_senha

# URL Publica para links de convocacao
PUBLIC_URL=$publicUrl
PORT=3000
"@ | Out-File -FilePath $envPath -Encoding UTF8
    
    Write-Host "Arquivo .env criado com sucesso!" -ForegroundColor Green
} else {
    Write-Host "Atualizando arquivo .env..." -ForegroundColor Yellow
    
    # Ler conteúdo atual
    $envContent = Get-Content $envPath -Raw
    
    # Atualizar ou adicionar PUBLIC_URL
    if ($envContent -match "PUBLIC_URL\s*=") {
        $envContent = $envContent -replace "PUBLIC_URL\s*=.*", "PUBLIC_URL=$publicUrl"
        Write-Host "PUBLIC_URL atualizado no .env" -ForegroundColor Green
    } else {
        # Adicionar PUBLIC_URL se não existir
        if (-not $envContent.EndsWith("`n")) {
            $envContent += "`n"
        }
        $envContent += "PUBLIC_URL=$publicUrl`n"
        Write-Host "PUBLIC_URL adicionado ao .env" -ForegroundColor Green
    }
    
    # Salvar arquivo
    $envContent | Out-File -FilePath $envPath -Encoding UTF8 -NoNewline
    
    Write-Host ""
    Write-Host "Arquivo .env atualizado com sucesso!" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuracao atualizada:" -ForegroundColor Yellow
Write-Host "  IP Local: $localIP" -ForegroundColor White
Write-Host "  URL Publica: $publicUrl" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANTE:" -ForegroundColor Yellow
Write-Host "1. Reinicie o servidor (Ctrl+C e depois 'npm run dev')" -ForegroundColor White
Write-Host "2. Certifique-se de que a porta 3000 esta liberada no firewall" -ForegroundColor White
Write-Host "3. Teste acessando: $publicUrl/dashboard.html" -ForegroundColor White
Write-Host ""

