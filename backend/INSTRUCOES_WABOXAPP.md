# 📱 Instruções de Configuração - Waboxapp

## Passo 1: Adicionar Variáveis no .env

Abra o arquivo `backend/.env` e adicione estas linhas no final:

```env
# ============================================================================
# Configuração Waboxapp - Envio Automático de WhatsApp
# ============================================================================

# Habilitar/desabilitar envio automático (false = desabilitado, sistema funciona normalmente)
WABOXAPP_ENABLED=false

# Token da API Waboxapp (obtido no dashboard: https://www.waboxapp.com/)
WABOXAPP_TOKEN=

# UID da API Waboxapp (obtido no dashboard)
WABOXAPP_UID=
```

**⚠️ IMPORTANTE:**
- Deixe `WABOXAPP_ENABLED=false` até estar pronto para testar
- Deixe `WABOXAPP_TOKEN` e `WABOXAPP_UID` vazios por enquanto
- O sistema continuará funcionando normalmente sem essas configurações

## Passo 2: Criar Conta no Waboxapp (quando estiver pronto)

### 2.1. Criar Conta e Conectar WhatsApp

1. **Acesse:** https://www.waboxapp.com/
2. **Crie uma conta** (plano gratuito disponível com até 100 mensagens/mês)
3. **💰 PREÇOS DO WABOXAPP (Atualizado):**
   - **Gratuito:** Até 100 mensagens/mês (envio + recebimento)
   - **$12/mês:** Até 1.000 mensagens/mês
   - **$17/mês:** Até 10.000 mensagens/mês
   - **$28/mês:** Até 25.000 mensagens/mês
   - **Pay as you go:** Você pode começar testando sem custo
4. **⚠️ SOBRE O CARTÃO DE CRÉDITO:**
   - O Waboxapp pede cartão para o plano **pós-pago** (post-paid)
   - **NÃO há cobrança** se você não exceder 100 mensagens/mês (limite gratuito)
   - Eles só cobram se você ultrapassar o limite do plano escolhido
   - Você pode cancelar a qualquer momento
   - **Alternativa:** Se não quiser fornecer cartão, veja outras opções na seção "Alternativas ao Waboxapp" abaixo
4. **Faça login** no dashboard
5. **Conecte seu número de WhatsApp:**
   - No dashboard, procure por "Conectar WhatsApp" ou "Connect WhatsApp"
   - Escaneie o QR Code com seu WhatsApp (Menu → Dispositivos conectados → Conectar um dispositivo)
   - Aguarde a confirmação de conexão

### 2.2. Onde Encontrar o TOKEN e UID

Após conectar seu WhatsApp, você encontrará suas credenciais em uma destas localizações no dashboard:

**Opção 1 - Página de API/Documentação:**
- Procure por "API", "Documentation" ou "Configurações"
- Geralmente há uma seção mostrando:
  - **Token:** (uma string longa)
  - **UID:** (seu ID de usuário, geralmente um número)

**Opção 2 - Configurações da Conta:**
- Vá em "Settings" ou "Configurações"
- Procure por "API Credentials" ou "Credenciais da API"
- Você verá:
  - **WABOXAPP_TOKEN:** (copie este valor)
  - **WABOXAPP_UID:** (copie este valor)

**Opção 3 - Ao criar um novo chat/instância:**
- Alguns dashboards mostram o Token e UID logo após conectar o WhatsApp
- Anote esses valores imediatamente

### 2.3. Copiar e Colar no .env

1. Copie o **TOKEN** completo
2. Copie o **UID** completo
3. Abra o arquivo `backend/.env`
4. Cole os valores:
   ```env
   WABOXAPP_TOKEN=cole_o_token_aqui
   WABOXAPP_UID=cole_o_uid_aqui
   ```

## Passo 3: Ativar quando estiver pronto

Quando estiver pronto para testar:
1. Preencha `WABOXAPP_TOKEN` e `WABOXAPP_UID`
2. Altere `WABOXAPP_ENABLED=true`
3. Reinicie o servidor: `npm run dev`

## Alternativas ao Waboxapp (se não quiser fornecer cartão)

Se você preferir não fornecer cartão de crédito, existem outras opções:

### Opção 1: WhatsApp Business API Oficial (Recomendado para produção)
- **Custo:** Variável, mas mais confiável
- **Requisitos:** Aprovação do Meta/Facebook
- **Vantagem:** Solução oficial e estável
- **Desvantagem:** Processo de aprovação mais demorado

### Opção 2: Evolution API / Baileys (Open Source)
- **Custo:** Gratuito (self-hosted)
- **Requisitos:** Servidor próprio, conhecimento técnico
- **Vantagem:** Totalmente gratuito, sem limites
- **Desvantagem:** Requer manutenção e configuração técnica

### Opção 3: Continuar com Método Manual (Atual)
- **Custo:** Zero
- **Como funciona:** O operador clica no link WhatsApp e envia manualmente
- **Vantagem:** Sem custos, sem dependências externas
- **Desvantagem:** Requer ação manual do operador

### Opção 4: Outros Serviços de API WhatsApp
- **Twilio WhatsApp API:** Pago, mas sem necessidade de cartão para teste
- **ChatAPI:** Oferece plano gratuito limitado
- **360dialog:** Solução profissional com teste gratuito

## 💰 Análise de Custo - Waboxapp

### Cálculo Baseado no Volume Estimado

**Cenário:** 50+ mensagens por dia
- **50 mensagens/dia × 30 dias = 1.500 mensagens/mês**
- **100 mensagens/dia × 30 dias = 3.000 mensagens/mês**

### Plano Necessário:
- **1.500 mensagens/mês:** Plano de **$17/mês** (até 10.000 mensagens)
- **3.000 mensagens/mês:** Plano de **$17/mês** (até 10.000 mensagens)

### Custo Mensal Estimado:
- **$17/mês** (aproximadamente R$ 85/mês, dependendo da cotação do dólar)

### Comparação:
- **Método Manual (Atual):** R$ 0/mês
- **Waboxapp:** R$ 85/mês (aproximado)
- **Economia de tempo:** Automatiza o envio, economizando tempo do operador

**💡 Recomendação:** 
- Para sua apresentação de hoje, continue com o método manual atual (zero custo).
- Depois, avalie se o custo de R$ 85/mês compensa a economia de tempo e a profissionalização do processo.
- Você pode testar o plano gratuito (100 mensagens) antes de decidir.

## 🔔 Sistema de Monitoramento e Alertas

### Como Funciona o Monitoramento

O sistema possui um **monitoramento automático** que verifica quantas mensagens foram enviadas no mês atual e alerta quando você está próximo do limite gratuito.

### Endpoint de Monitoramento

Você pode verificar o status a qualquer momento fazendo uma requisição GET para:
```
GET /api/convocacoes/status-mensagens
```

**Resposta de exemplo:**
```json
{
  "tabelaExiste": true,
  "mensagensEnviadas": 85,
  "mensagensSucesso": 83,
  "mensagensErro": 2,
  "limiteGratuito": 100,
  "mensagensRestantes": 15,
  "porcentagemUsada": 85.00,
  "periodo": {
    "inicio": "2025-11-01",
    "fim": "2025-11-30",
    "mes": "novembro de 2025"
  },
  "alerta": {
    "nivel": "ALTO",
    "mensagem": "⚠️ ATENÇÃO! Você já usou 85 de 100 mensagens (85.0%). Restam apenas 15 mensagens gratuitas.",
    "cor": "orange"
  },
  "recomendacao": null
}
```

### Níveis de Alerta

O sistema gera alertas em três níveis:

1. **🟡 ALERTA MÉDIO (80% do limite):**
   - Mensagem informativa
   - Ainda há mensagens disponíveis
   - Cor: Amarelo

2. **🟠 ALERTA ALTO (90% do limite):**
   - Atenção! Poucas mensagens restantes
   - Considere fazer upgrade ou usar método manual
   - Cor: Laranja

3. **🔴 ALERTA CRÍTICO (100% do limite):**
   - Limite atingido!
   - Não é mais possível enviar mensagens automáticas
   - Sistema volta automaticamente para método manual
   - Cor: Vermelho

### Avisos do Waboxapp

Além do nosso sistema de monitoramento, o **Waboxapp também pode enviar avisos**:

- **Email:** Eles podem enviar emails quando você está próximo do limite
- **Dashboard:** No painel do Waboxapp, você pode ver o uso em tempo real
- **Cobrança:** Se você exceder o limite gratuito e tiver cartão cadastrado, eles cobrarão automaticamente

### ⚠️ IMPORTANTE - Sobre Cobranças

- **Plano Gratuito (100 mensagens):** Se você exceder, o Waboxapp **pode bloquear** o envio ou **cobrar** se você tiver cartão cadastrado
- **Recomendação:** 
  - Monitore o uso através do endpoint `/api/convocacoes/status-mensagens`
  - Quando chegar a 80%, considere fazer upgrade ou usar método manual
  - Se não quiser ser cobrado, **não cadastre cartão** e use apenas o plano gratuito

### Como Usar o Monitoramento

**Opção 1 - Verificar Manualmente:**
- Faça uma requisição GET para `/api/convocacoes/status-mensagens`
- Verifique o campo `alerta` na resposta
- Se houver alerta, tome as ações necessárias

**Opção 2 - Integrar no Frontend (Futuro):**
- Você pode criar uma tela de dashboard que mostra o uso
- Exibir alertas visuais quando estiver próximo do limite
- Bloquear o botão "Enviar Automaticamente" quando o limite for atingido

## Funcionalidades Implementadas

### 1. Envio de Convocações Iniciais

Quando você cria convocações e clica em "Disparar Convocações", o sistema:
- Gera mensagem personalizada para cada motorista: `Olá [NOME]! Você foi convocado para uma viagem.`
- Inclui todos os detalhes da carga (ID, rota, horários, valores, etc.)
- Adiciona link único para cada motorista responder
- Permite escolher entre envio manual (abre WhatsApp) ou automático via WaboxApp

### 2. Confirmação de Convocação

Quando uma convocação é aceita e você confirma o motorista:
- Sistema oferece escolha entre **Manual** ou **WaboxApp (Automático)**
- Se escolher WaboxApp, a mensagem de confirmação é enviada automaticamente
- Mensagem de confirmação padronizada:
  ```
  🎉 PARABÉNS! Você foi selecionado!
  
  Olá [NOME],
  
  Temos uma ótima notícia! Você foi SELECIONADO para realizar a viagem:
  
  🆔 ID da Viagem: [ID]
  🗺️ Rota: [Rota]
  📅 Carregamento: [Data/Hora]
  📅 Descarga: [Data/Hora]
  
  ✅ Sua convocação foi CONFIRMADA!
  
  Por favor, entre em contato conosco para os próximos passos.
  
  📞 Entre em Contato:
  [Nome do Contratador]
  📱 [Telefone]
  
  Aguardamos seu retorno! 🚛
  ```

### 3. Mensagens Padronizadas

**Mensagem de Convocação:**
- Personalizada com nome do motorista
- Inclui todos os detalhes da viagem
- Link único para resposta

**Mensagem de Confirmação:**
- Personalizada com nome do motorista
- Informa que foi selecionado
- Detalhes da viagem confirmada
- Contato do contratador

## Segurança

- ✅ Sistema funciona normalmente se variáveis não estiverem configuradas
- ✅ Botão "Enviar Automaticamente" só aparece se `WABOXAPP_ENABLED=true`
- ✅ Se Waboxapp falhar, sistema volta para método manual automaticamente
- ✅ **Você pode usar o sistema normalmente sem configurar nenhuma API externa**
- ✅ **Sistema de monitoramento alerta quando está próximo do limite**
- ✅ **Tabela de log registra todos os envios para auditoria**
- ✅ **Opção de escolha entre manual e automático em todas as etapas**

