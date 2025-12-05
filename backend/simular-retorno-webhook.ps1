# Script para SIMULAR retornos do webhook Meta
# Use este script para testar o endpoint de callback

param(
    [int]$IDCONVOCACAO = 181,
    [string]$Cenario = "aceitar"  # aceitar, recusar, localizacao
)

$url = "http://localhost:3000/api/webhook-meta-callback"
# Para produção: $url = "http://cargas.integrabrasil.com:8083/api/webhook-meta-callback"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "SIMULANDO RETORNO DO WEBHOOK META" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Convocação: $IDCONVOCACAO" -ForegroundColor Yellow
Write-Host "Cenário: $Cenario" -ForegroundColor Yellow
Write-Host "URL: $url`n" -ForegroundColor Yellow

$body = @{}

switch ($Cenario.ToLower()) {
    "aceitar" {
        Write-Host "📤 Simulando: Motorista ACEITOU a convocação" -ForegroundColor Green
        $body = @{
            IDCONVOCACAO = $IDCONVOCACAO
            STATUS = "ACEITA"
            LATITUDE = -25.4284
            LONGITUDE = -49.2733
        }
    }
    "recusar" {
        Write-Host "❌ Simulando: Motorista RECUSOU a convocação" -ForegroundColor Red
        $body = @{
            IDCONVOCACAO = $IDCONVOCACAO
            STATUS = "RECUSADA"
            CDMOTIVORECUSA = 1
        }
    }
    "localizacao" {
        Write-Host "📍 Simulando: Apenas localização (aceita automaticamente se PENDENTE)" -ForegroundColor Blue
        $body = @{
            IDCONVOCACAO = $IDCONVOCACAO
            LATITUDE = -25.4284
            LONGITUDE = -49.2733
        }
    }
    default {
        Write-Host "❌ Cenário inválido! Use: aceitar, recusar ou localizacao" -ForegroundColor Red
        exit 1
    }
}

$jsonBody = $body | ConvertTo-Json

Write-Host "`nEnviando dados:" -ForegroundColor Cyan
Write-Host $jsonBody -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Body $jsonBody -ContentType "application/json"
    
    Write-Host "`n✅ SUCESSO! Resposta do servidor:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10 | Write-Host -ForegroundColor Green
    
    Write-Host "`n📋 Campos atualizados:" -ForegroundColor Cyan
    if ($response.camposAtualizados) {
        $response.camposAtualizados.PSObject.Properties | ForEach-Object {
            Write-Host "  - $($_.Name): $($_.Value)" -ForegroundColor White
        }
    }
    
    Write-Host "`n💡 Próximos passos:" -ForegroundColor Yellow
    Write-Host "  1. Verifique o console do servidor para ver os logs [WEBHOOK CALLBACK META]" -ForegroundColor Gray
    Write-Host "  2. Execute a query SQL para verificar se os dados foram gravados:" -ForegroundColor Gray
    Write-Host "     SELECT * FROM [dbo].[CONVOCACAO] WHERE IDCONVOCACAO = $IDCONVOCACAO" -ForegroundColor Gray
    Write-Host "  3. Verifique na interface se o STATUS da convocação foi atualizado" -ForegroundColor Gray
    
} catch {
    Write-Host "`n❌ ERRO ao enviar requisição:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        Write-Host "`nDetalhes do erro:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    
    Write-Host "`n💡 Verifique:" -ForegroundColor Yellow
    Write-Host "  - Se o servidor está rodando (npm run dev)" -ForegroundColor Gray
    Write-Host "  - Se a URL está correta: $url" -ForegroundColor Gray
    Write-Host "  - Se a convocação $IDCONVOCACAO existe no banco de dados" -ForegroundColor Gray
}

Write-Host "`n========================================`n" -ForegroundColor Cyan

