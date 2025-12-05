#!/bin/bash
# Script para SIMULAR retornos do webhook Meta
# Uso: ./simular-retorno-webhook.sh [IDCONVOCACAO] [cenario]
# Cenários: aceitar, recusar, localizacao

IDCONVOCACAO=${1:-181}
CENARIO=${2:-aceitar}
URL="http://localhost:3000/api/webhook-meta-callback"
# Para produção: URL="http://cargas.integrabrasil.com:8083/api/webhook-meta-callback"

echo ""
echo "========================================"
echo "SIMULANDO RETORNO DO WEBHOOK META"
echo "========================================"
echo ""
echo "Convocação: $IDCONVOCACAO"
echo "Cenário: $CENARIO"
echo "URL: $URL"
echo ""

case $CENARIO in
    aceitar)
        echo "📤 Simulando: Motorista ACEITOU a convocação"
        BODY=$(cat <<EOF
{
  "IDCONVOCACAO": $IDCONVOCACAO,
  "STATUS": "ACEITA",
  "LATITUDE": -25.4284,
  "LONGITUDE": -49.2733
}
EOF
)
        ;;
    recusar)
        echo "❌ Simulando: Motorista RECUSOU a convocação"
        BODY=$(cat <<EOF
{
  "IDCONVOCACAO": $IDCONVOCACAO,
  "STATUS": "RECUSADA",
  "CDMOTIVORECUSA": 1
}
EOF
)
        ;;
    localizacao)
        echo "📍 Simulando: Apenas localização (aceita automaticamente se PENDENTE)"
        BODY=$(cat <<EOF
{
  "IDCONVOCACAO": $IDCONVOCACAO,
  "LATITUDE": -25.4284,
  "LONGITUDE": -49.2733
}
EOF
)
        ;;
    *)
        echo "❌ Cenário inválido! Use: aceitar, recusar ou localizacao"
        exit 1
        ;;
esac

echo ""
echo "Enviando dados:"
echo "$BODY" | jq '.'
echo ""

RESPONSE=$(curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "$BODY")

if [ $? -eq 0 ]; then
    echo "✅ SUCESSO! Resposta do servidor:"
    echo "$RESPONSE" | jq '.'
    
    echo ""
    echo "💡 Próximos passos:"
    echo "  1. Verifique o console do servidor para ver os logs [WEBHOOK CALLBACK META]"
    echo "  2. Execute a query SQL para verificar se os dados foram gravados:"
    echo "     SELECT * FROM [dbo].[CONVOCACAO] WHERE IDCONVOCACAO = $IDCONVOCACAO"
    echo "  3. Verifique na interface se o STATUS da convocação foi atualizado"
else
    echo "❌ ERRO ao enviar requisição"
    echo ""
    echo "💡 Verifique:"
    echo "  - Se o servidor está rodando (npm run dev)"
    echo "  - Se a URL está correta: $URL"
    echo "  - Se a convocação $IDCONVOCACAO existe no banco de dados"
fi

echo ""
echo "========================================"
echo ""

