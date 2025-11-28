# Script completo para iniciar ngrok e atualizar .env
# Execute com: powershell -ExecutionPolicy Bypass -File .\iniciar-ngrok-completo.ps1

Write-Host "🔍 Verificando se o servidor está rodando na porta 3000..." -ForegroundColor Cyan

# Verificar se o servidor está rodando
$porta = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $porta) {
    Write-Host "❌ Servidor não está rodando na porta 3000!" -ForegroundColor Red
    Write-Host "💡 Execute primeiro: npm run dev" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "✅ Servidor detectado na porta 3000" -ForegroundColor Green
Write-Host ""

# Verificar se o ngrok está instalado
$ngrokPath = $null
$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue

if ($ngrokCmd) {
    $ngrokPath = $ngrokCmd.Source
    Write-Host "✅ ngrok encontrado: $ngrokPath" -ForegroundColor Green
} else {
    # Tentar encontrar ngrok.exe em locais comuns
    $possiblePaths = @(
        ".\ngrok.exe",
        "C:\ngrok\ngrok.exe",
        "$env:USERPROFILE\Downloads\ngrok.exe",
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe"
    )
    
    $found = $false
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $ngrokPath = (Resolve-Path $path).Path
            Write-Host "✅ ngrok encontrado: $ngrokPath" -ForegroundColor Green
            $found = $true
            break
        }
    }
    
    if (-not $found) {
        Write-Host "❌ ngrok não encontrado!" -ForegroundColor Red
        Write-Host "💡 Baixe em: https://ngrok.com/download" -ForegroundColor Yellow
        Write-Host "💡 Extraia e coloque ngrok.exe nesta pasta ou adicione ao PATH" -ForegroundColor Yellow
        Write-Host ""
        pause
        exit 1
    }
}

Write-Host ""
Write-Host "🚀 Iniciando ngrok..." -ForegroundColor Cyan
Write-Host "📝 Aguarde alguns segundos para o ngrok iniciar..." -ForegroundColor Yellow
Write-Host ""

# Iniciar ngrok em uma nova janela
Start-Process -FilePath $ngrokPath -ArgumentList "http 3000"

# Aguardar o ngrok iniciar
Start-Sleep -Seconds 5

# Tentar obter a URL da API do ngrok
try {
    $response = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
    if ($response.tunnels -and $response.tunnels.Count -gt 0) {
        $publicUrl = $response.tunnels[0].public_url
        Write-Host "✅ URL do ngrok detectada: $publicUrl" -ForegroundColor Green
        Write-Host ""
        
        # Atualizar o .env
        $envPath = Join-Path $PSScriptRoot ".env"
        if (Test-Path $envPath) {
            $envContent = Get-Content $envPath -Raw
            
            # Atualizar ou adicionar PUBLIC_URL
            if ($envContent -match "PUBLIC_URL=.*") {
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
        
        Write-Host ""
        Write-Host "📌 URL configurada: $publicUrl" -ForegroundColor Cyan
        Write-Host "📌 Teste acessando: $publicUrl/convocacao/38" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️  Não foi possível detectar a URL automaticamente" -ForegroundColor Yellow
        Write-Host "💡 Verifique a janela do ngrok e atualize o .env manualmente" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Não foi possível detectar a URL automaticamente" -ForegroundColor Yellow
    Write-Host "💡 Verifique a janela do ngrok e atualize o .env manualmente" -ForegroundColor Yellow
    Write-Host "💡 A URL será algo como: https://abc123-def456.ngrok-free.dev" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📌 O ngrok está rodando em uma nova janela" -ForegroundColor Cyan
Write-Host "📌 Mantenha essa janela aberta enquanto usar o ngrok" -ForegroundColor Cyan
Write-Host "📌 Para parar o ngrok, feche a janela do ngrok" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pressione qualquer tecla para continuar..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

