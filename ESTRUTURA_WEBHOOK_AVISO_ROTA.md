# Estrutura JSON para Webhook - Aviso Rota Integra

## Endpoint
```
POST https://ia.riochat.com.br/webhook/aviso-rota-integra
Content-Type: application/json
```

## Estrutura do Payload

O webhook recebe um **array de objetos**, onde cada objeto representa uma convocação:

```json
[
  {
    "IDCONVOCACAO": 154,
    "NRCELULAR": "41999598887",
    "TXTCONVOCACAO": "Olá *CASSIANO KLEMERSON DE LIMA TAVARES*! Você foi convocado para uma viagem.\n\n🚚 *CARGA DISPONÍVEL*\n\n🆔 *ID:* 82319\n📦 *Tipo:* 15 - Direct-load\n🚛 *Classe:* 40.01 - Carreta Aberta 5 eixos\n🗺️ *Rota:* 3698 - Santa Luzia - MG / Santana do Paraiso - MG\n\n⏰ *HORÁRIOS*\n📅 *Carregamento:* 24/11/2025 00:00\n📅 *Descarga:* 24/11/2025 00:00\n\n👤 *CONTRATADOR*\nDIOGO YUKIO AVANCO CARVALHO\n\n💰 *VALORES*\n💵 *Frete:* R$ 123,00\n📊 *Peso:* 13231,123 ton\n📦 *Cubagem:* 123,2 m³\n\n🔗 *Acesse o link para mais detalhes:*\n\nhttp://localhost:3000/convocacao/154",
    "LINKCONVOCACAO": "http://localhost:3000/convocacao/154"
  },
  {
    "IDCONVOCACAO": 155,
    "NRCELULAR": "41999598887",
    "TXTCONVOCACAO": "Olá *CLAUDIO DOS SANTOS OLIVEIRA*! Você foi convocado para uma viagem.\n\n🚚 *CARGA DISPONÍVEL*\n\n🆔 *ID:* 82319\n📦 *Tipo:* 15 - Direct-load\n🚛 *Classe:* 40.01 - Carreta Aberta 5 eixos\n🗺️ *Rota:* 3698 - Santa Luzia - MG / Santana do Paraiso - MG\n\n⏰ *HORÁRIOS*\n📅 *Carregamento:* 24/11/2025 00:00\n📅 *Descarga:* 24/11/2025 00:00\n\n👤 *CONTRATADOR*\nDIOGO YUKIO AVANCO CARVALHO\n\n💰 *VALORES*\n💵 *Frete:* R$ 123,00\n📊 *Peso:* 13231,123 ton\n📦 *Cubagem:* 123,2 m³\n\n🔗 *Acesse o link para mais detalhes:*\n\nhttp://localhost:3000/convocacao/155",
    "LINKCONVOCACAO": "http://localhost:3000/convocacao/155"
  }
]
```

## Campos do Objeto

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `IDCONVOCACAO` | Integer | ID único da convocação no sistema | `154` |
| `NRCELULAR` | String | Número do celular do motorista (apenas dígitos, sem formatação) | `"41999598887"` |
| `TXTCONVOCACAO` | String | Texto completo da mensagem formatada para WhatsApp (pode conter emojis e formatação Markdown) | `"Olá *NOME*! Você foi convocado..."` |
| `LINKCONVOCACAO` | String | URL completa do link da convocação | `"http://localhost:3000/convocacao/154"` |

## Observações

1. **Array de Objetos**: O webhook recebe um array, permitindo enviar múltiplas convocações em uma única requisição.

2. **NRCELULAR**: 
   - Pode ser `null` se o motorista não tiver celular cadastrado
   - Quando presente, contém apenas dígitos (sem formatação)

3. **TXTCONVOCACAO**: 
   - Contém o texto completo formatado para WhatsApp
   - Inclui emojis e formatação Markdown (negrito com `*texto*`)
   - Pode conter quebras de linha (`\n`)
   - Sempre inclui o link da convocação no final

4. **LINKCONVOCACAO**: 
   - URL completa e acessível
   - Em ambiente local: `http://localhost:3000/convocacao/{ID}`
   - Em produção: `http://cargas.integrabrasil.com:8083/convocacao/{ID}`

## Exemplo de Requisição Completa

```http
POST https://ia.riochat.com.br/webhook/aviso-rota-integra HTTP/1.1
Content-Type: application/json

[
  {
    "IDCONVOCACAO": 154,
    "NRCELULAR": "41999598887",
    "TXTCONVOCACAO": "Olá *CASSIANO KLEMERSON DE LIMA TAVARES*! Você foi convocado para uma viagem.\n\n🚚 *CARGA DISPONÍVEL*\n\n🆔 *ID:* 82319\n📦 *Tipo:* 15 - Direct-load\n🚛 *Classe:* 40.01 - Carreta Aberta 5 eixos\n🗺️ *Rota:* 3698 - Santa Luzia - MG / Santana do Paraiso - MG\n\n⏰ *HORÁRIOS*\n📅 *Carregamento:* 24/11/2025 00:00\n📅 *Descarga:* 24/11/2025 00:00\n\n👤 *CONTRATADOR*\nDIOGO YUKIO AVANCO CARVALHO\n\n💰 *VALORES*\n💵 *Frete:* R$ 123,00\n📊 *Peso:* 13231,123 ton\n📦 *Cubagem:* 123,2 m³\n\n🔗 *Acesse o link para mais detalhes:*\n\nhttp://localhost:3000/convocacao/154",
    "LINKCONVOCACAO": "http://localhost:3000/convocacao/154"
  }
]
```

## Resposta Esperada

O webhook deve retornar um status HTTP 200 (OK) para indicar sucesso no processamento.

## Logs de Debug

O sistema gera logs no console do navegador com o prefixo `[WEBHOOK]` mostrando:
- Quantas convocações estão sendo enviadas
- A estrutura JSON completa que será enviada
- Resultado do envio (sucesso ou erro)

