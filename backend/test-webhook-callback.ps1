# Script de teste para o webhook callback Meta
# Uso: .\test-webhook-callback.ps1

$url = "http://localhost:3000/api/webhook-meta-callback"
# Para produção: $url = "http://cargas.integrabrasil.com:8083/api/webhook-meta-callback"

# Teste 1: Aceitar convocação com localização
Write-Host "`n=== TESTE 1: Aceitar Convocação (com localização) ===" -ForegroundColor Green
$body1 = @{
    IDCONVOCACAO = 181
    LATITUDE = -25.4284
    LONGITUDE = -49.2733
    STATUS = "ACEITA"
} | ConvertTo-Json

Write-Host "Enviando para: $url" -ForegroundColor Yellow
Write-Host "Body: $body1" -ForegroundColor Cyan

try {
    $response1 = Invoke-RestMethod -Uri $url -Method POST -Body $body1 -ContentType "application/json"
    Write-Host "✅ Resposta:" -ForegroundColor Green
    $response1 | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Erro:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }
}

# Teste 2: Recusar convocação
Write-Host "`n=== TESTE 2: Recusar Convocação ===" -ForegroundColor Green
$body2 = @{
    IDCONVOCACAO = 180
    CDMOTIVORECUSA = 1
    STATUS = "RECUSADA"
} | ConvertTo-Json

Write-Host "Enviando para: $url" -ForegroundColor Yellow
Write-Host "Body: $body2" -ForegroundColor Cyan

try {
    $response2 = Invoke-RestMethod -Uri $url -Method POST -Body $body2 -ContentType "application/json"
    Write-Host "✅ Resposta:" -ForegroundColor Green
    $response2 | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Erro:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }
}

# Teste 3: Apenas localização (deve aceitar se estiver PENDENTE)
Write-Host "`n=== TESTE 3: Apenas Localização ===" -ForegroundColor Green
$body3 = @{
    IDCONVOCACAO = 179
    LATITUDE = -25.4284
    LONGITUDE = -49.2733
} | ConvertTo-Json

Write-Host "Enviando para: $url" -ForegroundColor Yellow
Write-Host "Body: $body3" -ForegroundColor Cyan

try {
    $response3 = Invoke-RestMethod -Uri $url -Method POST -Body $body3 -ContentType "application/json"
    Write-Host "✅ Resposta:" -ForegroundColor Green
    $response3 | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Erro:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }
}

Write-Host "`n=== Testes concluídos ===" -ForegroundColor Yellow

