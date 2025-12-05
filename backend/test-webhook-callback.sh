#!/bin/bash
# Script de teste para o webhook callback Meta
# Uso: ./test-webhook-callback.sh

URL="http://localhost:3000/api/webhook-meta-callback"
# Para produção: URL="http://cargas.integrabrasil.com:8083/api/webhook-meta-callback"

echo ""
echo "=== TESTE 1: Aceitar Convocação (com localização) ==="
echo "Enviando para: $URL"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 181,
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733,
    "STATUS": "ACEITA"
  }' | jq '.'

echo ""
echo "=== TESTE 2: Recusar Convocação ==="
echo "Enviando para: $URL"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 180,
    "CDMOTIVORECUSA": 1,
    "STATUS": "RECUSADA"
  }' | jq '.'

echo ""
echo "=== TESTE 3: Apenas Localização ==="
echo "Enviando para: $URL"
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 179,
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733
  }' | jq '.'

echo ""
echo "=== Testes concluídos ==="

