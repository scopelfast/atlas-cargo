# Script para iniciar ngrok e atualizar .env automaticamente
# Uso: .\iniciar-ngrok.ps1

Write-Host "🔍 Verificando se o servidor está rodando na porta 3000..." -ForegroundColor Cyan

# Verificar se o servidor está rodando
$porta = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $porta) {
    Write-Host "❌ Servidor não está rodando na porta 3000!" -ForegroundColor Red
    Write-Host "💡 Execute primeiro: npm run dev" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Pressione qualquer tecla para sair..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "✅ Servidor detectado na porta 3000" -ForegroundColor Green
Write-Host ""

# Verificar se o ngrok está instalado
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
    Write-Host "⚠️  ngrok não encontrado no PATH" -ForegroundColor Yellow
    Write-Host "💡 Baixe em: https://ngrok.com/download" -ForegroundColor Yellow
    Write-Host "💡 Ou execute: ngrok.exe http 3000 (se estiver na mesma pasta)" -ForegroundColor Yellow
    Write-Host ""
    
    # Tentar encontrar ngrok.exe na pasta atual ou comum
    $possiblePaths = @(
        ".\ngrok.exe",
        "C:\ngrok\ngrok.exe",
        "$env:USERPROFILE\Downloads\ngrok.exe"
    )
    
    $found = $false
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            Write-Host "✅ Encontrado: $path" -ForegroundColor Green
            $ngrokPath = $path
            $found = $true
            break
        }
    }
    
    if (-not $found) {
        Write-Host "❌ ngrok não encontrado. Por favor, instale o ngrok primeiro." -ForegroundColor Red
        Write-Host ""
        Write-Host "Pressione qualquer tecla para sair..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit 1
    }
}

Write-Host "🚀 Iniciando ngrok..." -ForegroundColor Cyan
Write-Host "📝 Quando o ngrok iniciar, copie a URL HTTPS e pressione Ctrl+C" -ForegroundColor Yellow
Write-Host "💡 A URL será algo como: https://abc123-def456.ngrok-free.dev" -ForegroundColor Yellow
Write-Host ""

# Iniciar ngrok em background e capturar a URL
$ngrokProcess = Start-Process -FilePath $ngrokPath.Source -ArgumentList "http 3000" -NoNewWindow -PassThru

# Aguardar um pouco para o ngrok iniciar
Start-Sleep -Seconds 3

# Tentar obter a URL da API do ngrok (localhost:4040)
try {
    $response = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
    if ($response.tunnels -and $response.tunnels.Count -gt 0) {
        $publicUrl = $response.tunnels[0].public_url
        Write-Host ""
        Write-Host "✅ URL do ngrok detectada: $publicUrl" -ForegroundColor Green
        Write-Host ""
        
        # Perguntar se deseja atualizar o .env
        $resposta = Read-Host "Deseja atualizar o arquivo .env com esta URL? (S/N)"
        if ($resposta -eq "S" -or $resposta -eq "s" -or $resposta -eq "Y" -or $resposta -eq "y") {
            $envPath = Join-Path $PSScriptRoot ".env"
            if (Test-Path $envPath) {
                $envContent = Get-Content $envPath -Raw
                
                # Atualizar ou adicionar PUBLIC_URL
                if ($envContent -match "PUBLIC_URL=") {
                    $envContent = $envContent -replace "PUBLIC_URL=.*", "PUBLIC_URL=$publicUrl"
                } else {
                    $envContent += "`nPUBLIC_URL=$publicUrl"
                }
                
                Set-Content -Path $envPath -Value $envContent -NoNewline
                Write-Host "✅ Arquivo .env atualizado com sucesso!" -ForegroundColor Green
                Write-Host "💡 Reinicie o servidor Node.js para aplicar as mudanças" -ForegroundColor Yellow
            } else {
                Write-Host "⚠️  Arquivo .env não encontrado. Criando..." -ForegroundColor Yellow
                Set-Content -Path $envPath -Value "PUBLIC_URL=$publicUrl"
                Write-Host "✅ Arquivo .env criado!" -ForegroundColor Green
            }
        }
    }
} catch {
    Write-Host "⚠️  Não foi possível detectar a URL automaticamente" -ForegroundColor Yellow
    Write-Host "💡 Verifique manualmente no terminal do ngrok e atualize o .env" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📌 Mantenha este terminal aberto enquanto usar o ngrok" -ForegroundColor Cyan
Write-Host "📌 Para parar o ngrok, pressione Ctrl+C" -ForegroundColor Cyan
Write-Host ""

# Manter o processo rodando
Wait-Process -Id $ngrokProcess.Id

