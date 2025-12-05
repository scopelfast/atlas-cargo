# Teste do Webhook Callback Meta

## Endpoint
```
POST /api/webhook-meta-callback
```

## URL Completa
- **Local:** `http://localhost:3000/api/webhook-meta-callback`
- **Produção:** `http://cargas.integrabrasil.com:8083/api/webhook-meta-callback`

## Parâmetros Aceitos

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| IDCONVOCACAO | Integer | ✅ Sim | ID da convocação |
| LATITUDE | Decimal | ❌ Não | Latitude da localização |
| LONGITUDE | Decimal | ❌ Não | Longitude da localização |
| CDMOTIVORECUSA | Integer | ❌ Não | Código do motivo de recusa |
| STATUS | String | ❌ Não | Status explícito (ACEITA, RECUSADA, etc.) |

## Exemplos de Teste

### 1. Aceitar Convocação (com localização)
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 181,
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733,
    "STATUS": "ACEITA"
  }'
```

### 2. Recusar Convocação
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 180,
    "CDMOTIVORECUSA": 1,
    "STATUS": "RECUSADA"
  }'
```

### 3. Apenas Localização (aceita automaticamente se PENDENTE)
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 179,
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733
  }'
```

## Resposta de Sucesso
```json
{
  "success": true,
  "message": "Dados recebidos e atualizados com sucesso!",
  "camposAtualizados": {
    "STATUS": "ACEITA",
    "DHRESPOSTA": "atualizado",
    "LATITUDE": "atualizado",
    "LONGITUDE": "atualizado",
    "CDMOTIVORECUSA": "não fornecido",
    "DHMAINTENANCE": "atualizado",
    "SGUSER": "DESKRIO"
  }
}
```

## Resposta de Erro
```json
{
  "error": "IDCONVOCACAO é obrigatório."
}
```

## Scripts de Teste

- **PowerShell:** `test-webhook-callback.ps1`
- **Bash:** `test-webhook-callback.sh`

Execute os scripts ou use os comandos curl acima para testar o endpoint.

