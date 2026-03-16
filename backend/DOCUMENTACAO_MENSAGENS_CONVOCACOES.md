# 📱 Documentação - Mensagens de Convocações

## Visão Geral

Este documento descreve o sistema de mensagens de convocações, incluindo os padrões de mensagens, métodos de envio e funcionalidades implementadas.

## Mensagens Padronizadas

### 1. Mensagem de Convocação Inicial

Quando uma convocação é criada e enviada, o motorista recebe:

```
Olá [NOME], como está? Você está sendo convocado para uma viagem.

  CARGA DISPONÍVEL

  ID: [ID_VIAGEM]
  Tipo: [CÓDIGO - TIPO_VIAGEM]   (ex: 01 - Coleta)
  Classe: [CLASSE_FROTA]
  Rota: [ORIGEM -> DESTINO]
  País: [PAÍS_ORIGEM] → [PAÍS_DESTINO]   (quando disponível)
  Pontos de parada:   (quando o roteiro tiver pontos cadastrados)
  • País, Estado, Cidade
  • ...

  HORÁRIOS
  Carregamento: DD/MM/AAAA HH:mm
  Descarga: DD/MM/AAAA HH:mm

  REQUISITOS (se a viagem exige rastreado)
  ✅ Exige veículo rastreado: SIM

  CONTRATADOR
  [NOME_CONTRATADOR]

  VALORES
  Frete: R$ [VALOR]
  Peso: [PESO] ton
  Cubagem: [CUBAGEM] m³

  DETALHES DA VIAGEM (se houver)
  [OBSERVAÇÕES]

  Acesse o link para mais detalhes:
  [LINK_CONVOCACAO]
```

**Características:**
- Saudação: "Olá [nome], como está? Você está sendo convocado..."
- Tipo exibido com código + descrição (ex: 01 - Coleta)
- Rota: origem -> destino; linha de País quando cidade tem país cadastrado; pontos de parada do roteiro (País, Estado, Cidade)
- Link único para cada motorista responder

### 2. Mensagem de Confirmação (motorista selecionado)

Quando a convocação é confirmada pelo operador:

```
🎉 PARABÉNS! Você foi selecionado!

Olá [PRIMEIRO_NOME], como está?

Temos uma ótima notícia! Você foi SELECIONADO para realizar a viagem:

🆔 ID da Viagem: [ID_VIAGEM]
✅ Sua convocação foi CONFIRMADA!
Agora, por favor, aguarde o contato do nosso time, com mais instruções dos próximos passos.

Obrigado pela parceria! 🚛

Aplicativo do motorista:
[LINK_APP_MOTORISTA]
```

**Características:**
- Sempre chamar o motorista pelo nome (primeiro nome)
- Link do app: configurável em **Configurações do Sistema** (chave `link_app_motorista`) ou variável de ambiente APP_URL/PUBLIC_URL

### 3. Mensagem para quem aceitou mas não foi escolhido

Quando outro motorista é confirmado, os que tinham aceito recebem:

```
Olá [PRIMEIRO_NOME], como está?
Para a viagem [ID_VIAGEM] outro motorista foi selecionado.
Agradecemos seu interesse e não se preocupe! Você poderá ser convocado em novas viagens.

Obrigado pela parceria! 🚛
```

**Características:**
- Tom cordial; reforça que poderá ser convocado em novas viagens
- Sempre pelo primeiro nome

## Métodos de Envio

### 1. Envio Manual

**Como funciona:**
- Sistema gera link do WhatsApp com mensagem pré-formatada
- WhatsApp é aberto automaticamente no navegador
- Operador revisa e clica em "Enviar"

**Vantagens:**
- Zero custo
- Controle total sobre o envio
- Pode personalizar antes de enviar

**Desvantagens:**
- Requer ação manual do operador
- Mais lento para múltiplos envios

### 2. Envio Automático via WaboxApp

**Como funciona:**
- Sistema envia mensagem diretamente via API do WaboxApp
- Mensagem é entregue automaticamente ao motorista
- Log de envio é registrado para auditoria

**Vantagens:**
- Envio instantâneo e automático
- Mais profissional
- Economiza tempo do operador
- Log completo de envios

**Desvantagens:**
- Requer configuração do WaboxApp
- Custo mensal (plano gratuito: 100 mensagens/mês)

## Fluxo de Uso

### Criar e Enviar Convocações

1. **Preparar Anúncio:**
   - Aba "Compatíveis" → Selecionar motoristas
   - Clicar em "📢 Preparar Anúncio"
   - Revisar e personalizar mensagem (opcional)
   - Clicar em "Disparar Convocações"

2. **Escolher Método de Envio:**
   - **Manual:** Links do WhatsApp são exibidos, operador clica e envia
   - **WaboxApp:** Se configurado, botão "Enviar Automaticamente" aparece

3. **Envio:**
   - **Manual:** WhatsApp abre com mensagem pré-formatada
   - **WaboxApp:** Mensagens são enviadas automaticamente

### Confirmar Convocação

1. **Motorista Aceita:**
   - Motorista acessa link e clica em "Aceitar"
   - Status muda para "ACEITA"

2. **Operador Confirma:**
   - Aba "Convocações" → Localizar convocação ACEITA
   - Clicar em botão "✅ Confirmar"

3. **Escolher Método de Envio:**
   - Modal aparece com opções:
     - **🤖 WaboxApp (Automático):** Mensagem enviada automaticamente
     - **👤 Manual:** WhatsApp abre para envio manual

4. **Envio:**
   - **WaboxApp:** Mensagem de confirmação enviada automaticamente
   - **Manual:** WhatsApp abre com mensagem pré-formatada

## Link do aplicativo do motorista (mensagem de confirmação)

O link que aparece na mensagem de confirmação ("Aplicativo do motorista") pode ser definido de duas formas:

1. **Configurações do Sistema (banco):** na tabela `CONFIGURACAO`, chave `link_app_motorista`, valor = URL (ex: `https://meudominio.com/motorista/`).
2. **Variáveis de ambiente:** se a chave não existir no banco, o sistema usa `APP_URL` ou `PUBLIC_URL` do `.env`.

Assim o operador não precisa alterar código para trocar o link do app.

---

## Configuração WaboxApp

### Variáveis de Ambiente

Adicione no arquivo `backend/.env`:

```env
# Habilitar/desabilitar envio automático
WABOXAPP_ENABLED=true

# Token da API WaboxApp
WABOXAPP_TOKEN=seu_token_aqui

# UID da API WaboxApp
WABOXAPP_UID=seu_uid_aqui
```

### Como Obter Credenciais

1. Acesse: https://www.waboxapp.com/
2. Crie uma conta (plano gratuito: 100 mensagens/mês)
3. Conecte seu WhatsApp
4. No dashboard, encontre:
   - **Token:** String longa
   - **UID:** ID numérico do usuário

### Verificar Status

Endpoint para verificar uso de mensagens:
```
GET /api/convocacoes/status-mensagens
```

Resposta:
```json
{
  "tabelaExiste": true,
  "mensagensEnviadas": 85,
  "mensagensSucesso": 83,
  "mensagensErro": 2,
  "limiteGratuito": 100,
  "mensagensRestantes": 15,
  "porcentagemUsada": 85.00,
  "alerta": {
    "nivel": "ALTO",
    "mensagem": "⚠️ ATENÇÃO! Você já usou 85 de 100 mensagens (85.0%). Restam apenas 15 mensagens gratuitas.",
    "cor": "orange"
  }
}
```

## Personalização de Mensagens

### Mensagem de Convocação

A mensagem é gerada automaticamente com base nos dados da viagem:
- Dados da viagem (ID, tipo, classe, rota)
- Horários (carregamento e descarga)
- Valores (frete, peso, cubagem)
- Observações (se houver)
- Link único para resposta

### Mensagem de Confirmação

A mensagem é gerada automaticamente quando a convocação é confirmada:
- Dados da viagem confirmada
- Contato do contratador
- Tom profissional e acolhedor

## Logs e Auditoria

### Tabela de Log

Todos os envios via WaboxApp são registrados na tabela `LOG_ENVIO_WHATSAPP`:
- ID da convocação
- Nome do motorista
- Celular
- Texto enviado
- Status (sucesso/erro)
- Data/hora do envio
- ID retornado pela API

### Consultar Logs

```sql
SELECT 
  IDLOG,
  IDCONVOCACAO,
  NOME_MOTORISTA,
  NRCELULAR,
  TEXTO_ENVIADO,
  STATUS_ENVIO,
  DHENVIO,
  IDRESPOSTA_API
FROM [dbo].[LOG_ENVIO_WHATSAPP]
ORDER BY DHENVIO DESC
```

## Troubleshooting

### WaboxApp não está enviando

1. Verificar se `WABOXAPP_ENABLED=true`
2. Verificar se `WABOXAPP_TOKEN` e `WABOXAPP_UID` estão preenchidos
3. Verificar se não excedeu limite de mensagens
4. Verificar logs no console do servidor
5. Verificar status via `/api/convocacoes/status-mensagens`

### Mensagem não está sendo formatada corretamente

1. Verificar se dados da viagem estão completos
2. Verificar se nome do motorista está cadastrado
3. Verificar se datas estão no formato correto
4. Verificar logs no console do navegador

### Link não está funcionando

1. Verificar se `PUBLIC_URL` está configurado no `.env`
2. Verificar se URL está acessível publicamente
3. Para desenvolvimento local, usar ngrok ou similar

## Melhores Práticas

1. **Sempre revisar mensagem antes de enviar** (método manual)
2. **Monitorar uso de mensagens** via endpoint de status
3. **Manter dados atualizados** (viagem, motorista, contratador)
4. **Usar WaboxApp para envios em massa** (mais eficiente)
5. **Usar método manual para casos especiais** (personalização)

## Suporte

Para dúvidas ou problemas:
1. Verificar logs do servidor
2. Verificar logs do navegador (F12)
3. Consultar documentação do WaboxApp: https://www.waboxapp.com/docs
4. Verificar status do sistema via endpoints de monitoramento

