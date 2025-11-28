# Script para atualizar PUBLIC_URL no .env com a URL do ngrok
# Execute quando o ngrok estiver rodando

Write-Host "Buscando URL do ngrok..." -ForegroundColor Yellow

# Tentar obter a URL da API do ngrok (localhost:4040)
try {
    $response = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
    if ($response.tunnels -and $response.tunnels.Count -gt 0) {
        $publicUrl = $response.tunnels[0].public_url
        Write-Host "URL do ngrok detectada: $publicUrl" -ForegroundColor Green
        Write-Host ""
        
        # Atualizar o .env
        $envPath = Join-Path $PSScriptRoot ".env"
        if (Test-Path $envPath) {
            $envContent = Get-Content $envPath -Raw
            
            # Atualizar ou adicionar PUBLIC_URL
            if ($envContent -match "PUBLIC_URL\s*=") {
                $envContent = $envContent -replace "PUBLIC_URL\s*=.*", "PUBLIC_URL=$publicUrl"
                Write-Host "PUBLIC_URL atualizado no .env" -ForegroundColor Green
            } else {
                if (-not $envContent.EndsWith("`n")) {
                    $envContent += "`n"
                }
                $envContent += "PUBLIC_URL=$publicUrl`n"
                Write-Host "PUBLIC_URL adicionado ao .env" -ForegroundColor Green
            }
            
            # Salvar arquivo
            $envContent | Out-File -FilePath $envPath -Encoding UTF8 -NoNewline
            
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host "Configuracao atualizada:" -ForegroundColor Yellow
            Write-Host "  URL Publica: $publicUrl" -ForegroundColor White
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "IMPORTANTE:" -ForegroundColor Yellow
            Write-Host "1. Reinicie o servidor (Ctrl+C e depois 'npm run dev')" -ForegroundColor White
            Write-Host "2. Os links de convocacao agora funcionarao no WhatsApp!" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "Arquivo .env nao encontrado!" -ForegroundColor Red
        }
    } else {
        Write-Host "Nenhum tunnel ativo encontrado no ngrok" -ForegroundColor Red
    }
} catch {
    Write-Host "Erro ao conectar com ngrok: $_" -ForegroundColor Red
    Write-Host "Certifique-se de que o ngrok esta rodando na porta 4040" -ForegroundColor Yellow
    Write-Host "Execute: ngrok http 3000" -ForegroundColor Yellow
}

