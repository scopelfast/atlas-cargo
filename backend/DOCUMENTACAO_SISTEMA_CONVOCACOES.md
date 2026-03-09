# 📚 Documentação Completa - Sistema de Convocações

**Módulo:** Gerenciar Viagens - Sistema de Convocações  
**Versão:** 1.0.0  
**Data:** 2026-11-21  
**Status:** ✅ Produção

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Conceitos Fundamentais](#conceitos-fundamentais)
3. [Fluxo Completo do Processo](#fluxo-completo-do-processo)
   - [3. Preparação do Anúncio](#3-preparação-do-anúncio)
   - [4. Disparo de Convocações](#4-disparo-de-convocações)
     - [4.1. Caminho Completo: "Preparar Anúncio" → "Enviar via WhatsApp"](#41-caminho-completo-preparar-anúncio--enviar-via-whatsapp)
     - [4.2. Caminho Simples: "Disparar Convocações"](#42-caminho-simples-disparar-convocações-apenas-registro)
     - [Comparação dos Caminhos](#-comparação-dos-caminhos)
     - [Recomendação de Uso](#-recomendação-de-uso)
4. [Aba Compatíveis](#aba-compatíveis)
5. [Aba Convocações](#aba-convocações)
6. [Status das Convocações](#status-das-convocações)
7. [Regras de Negócio](#regras-de-negócio)
8. [Validações e Restrições](#validações-e-restrições)
9. [Integração WhatsApp](#integração-whatsapp)
10. [Página Pública do Motorista](#página-pública-do-motorista)
11. [Troubleshooting](#troubleshooting)
12. [Glossário](#glossário)

---

## 🎯 Visão Geral

O **Sistema de Convocações** é o coração da ferramenta Atlas Cargo, responsável por:

- Identificar motoristas compatíveis com viagens pendentes
- Enviar convites personalizados via WhatsApp
- Gerenciar respostas dos motoristas
- Confirmar atribuição de viagens
- Garantir que apenas um motorista seja confirmado por viagem

### Objetivo Principal

Automatizar e otimizar o processo de contratação de motoristas para viagens, garantindo:
- ✅ Compatibilidade técnica (classe de frota, rastreador)
- ✅ Compatibilidade geográfica (origem/destino)
- ✅ Rastreabilidade completa do processo
- ✅ Comunicação eficiente via WhatsApp
- ✅ Prevenção de conflitos (uma viagem = um motorista)

---

## 🔑 Conceitos Fundamentais

### Viagem Pendente

Uma viagem está **pendente de contratação** quando:
- ✅ Status da viagem é **"Programada" (P)** ou **"Preparação" (D)**
- ✅ Não possui nenhuma convocação com status **"ACEITA"** ou **"CONFIRMADA"**

### Motorista Compatível

Um motorista é considerado **compatível** quando atende **TODOS** os critérios:

1. **Classe de Frota Compatível**
   - O motorista possui pelo menos uma classe de frota ativa (`CLASSEFROTA_CG.FGACTIVE = 'S'`)
   - A classe de frota do motorista é igual à classe de frota da viagem

2. **Veículo Rastreado (quando exigido)**
   - Se a viagem **exige** veículo rastreado (`FGRASTREADO = 'S'`):
     - O motorista **DEVE** ter veículo rastreado (`CADASTROGERAL.FGRASTREADO = 'S'`)
   - Se a viagem **NÃO exige** veículo rastreado:
     - Qualquer motorista pode ser selecionado (com ou sem rastreador)

3. **Localização (Micro-região ou Cidade)**
   - O motorista deve estar cadastrado em uma cidade que:
     - Pertence à mesma **micro-região** da cidade de origem OU
     - Pertence à mesma **micro-região** da cidade de destino OU
     - É a própria cidade de origem OU
     - É a própria cidade de destino

### Convocação

Registro que representa um convite enviado a um motorista para realizar uma viagem específica.

**Campos principais:**
- `IDCONVOCACAO`: Identificador único
- `IDVIAGEM`: Viagem relacionada
- `CDCADASTRO_MOTORISTA`: Motorista convidado
- `STATUS`: Estado atual (PENDENTE, ACEITA, RECUSADA, CONFIRMADA)
- `NRCELULAR`: Telefone do motorista (gravado no momento do envio)
- `TXTCONVOCACAO`: Texto completo do anúncio enviado
- `LINKCONVOCACAO`: Link único para o motorista responder
- `DHCONVOCACAO`: Data/hora da criação
- `DHRESPOSTA`: Data/hora da resposta (quando ACEITA ou RECUSADA)
- `SGUSUARIO_OPERADOR`: Login do operador que criou a convocação

---

## 🔄 Fluxo Completo do Processo

### 1. Identificação de Viagens Pendentes

**Onde:** Aba "Compatíveis" → Botão "Carregar Viagens Pendentes"

**O que acontece:**
- Sistema busca viagens com status "Programada" ou "Preparação"
- Filtra apenas viagens que **NÃO** possuem convocação ACEITA ou CONFIRMADA
- Lista é ordenada por ID da viagem (descendente - mais recentes primeiro)
- Preenche o dropdown "Selecione uma Viagem"

**Regras:**
- ✅ Apenas viagens ativas (`FGACTIVE = 'A'`)
- ✅ Apenas viagens sem motorista confirmado
- ✅ Ordenação: ID maior primeiro

---

### 2. Busca de Motoristas Compatíveis

**Onde:** Aba "Compatíveis" → Selecionar viagem → Botão "Buscar Motoristas Compatíveis"

**O que acontece:**
- Sistema aplica os 3 critérios de compatibilidade (classe, rastreador, localização)
- Lista motoristas compatíveis em uma grid
- Ordena por: Transportador → Classe de Frota

**Critérios aplicados (TODOS devem ser verdadeiros):**

#### 2.1. Classe de Frota
```sql
-- Motorista deve ter a mesma classe de frota da viagem
cfcg.CDCLASSEFROTA = @CDCLASSEFROTA
AND cfcg.FGACTIVE = 'S'  -- Classe ativa
```

#### 2.2. Veículo Rastreado
```sql
-- Se viagem exige rastreador:
IF @FGRASTREADO = 'S' THEN
  cg.FGRASTREADO = 'S'  -- Motorista DEVE ter rastreador
ELSE
  -- Qualquer motorista (com ou sem rastreador)
END
```

#### 2.3. Localização (Micro-região)
```sql
-- Motorista da mesma micro-região da origem OU destino
(
  cid_motorista.CDMICROREGIAO = cid_origem.CDMICROREGIAO OR
  cid_motorista.CDMICROREGIAO = cid_destino.CDMICROREGIAO OR
  cid_motorista.CDCIDADE = cid_origem.CDCIDADE OR
  cid_motorista.CDCIDADE = cid_destino.CDCIDADE
)
```

**Informações exibidas na grid:**
- ✅ Checkbox para seleção
- ✅ Nome do motorista
- ✅ ID do motorista
- ✅ Cidade e micro-região
- ✅ Classe de frota
- ✅ Nome do transportador
- ✅ Botão WhatsApp (para contato direto)

**O que NÃO aparece:**
- ❌ Equipamento (coluna removida)
- ❌ Contato (substituído por botão WhatsApp)

---

### 3. Preparação do Anúncio

**Onde:** Aba "Compatíveis" → Selecionar motoristas → Botão "📢 Preparar Anúncio"

**O que acontece:**
- Sistema busca dados completos da viagem
- Monta texto formatado do anúncio
- Exibe preview no modal
- Permite copiar o texto ou enviar via WhatsApp

**Formato do Anúncio:**

```
🚚 *CARGA DISPONÍVEL*

🆔 *ID:* [ID_VIAGEM]
📦 *Tipo:* [TIPO_VIAGEM]
🚛 *Classe:* [CLASSE_FROTA]
🗺️ *Rota:* [ROTEIRO]

⏰ *HORÁRIOS*
📅 *Carregamento:* [DATA_HORA_INICIO]
📅 *Descarga:* [DATA_HORA_FIM]

👤 *CONTRATADOR*
[NOME_CONTRATADOR]

💰 *VALORES*
💵 *Frete:* R$ [VALOR_FRETE]
📊 *Peso:* [PESO] ton
📦 *Cubagem:* [CUBAGEM] m³

📝 *DETALHES DA VIAGEM*
[OBSERVACOES]

🔗 *ACESSE PARA RESPONDER*
[LINK_UNICO_CONVOCACAO]
👆 *Toque no link acima para responder*
```

**Observações:**
- ❌ **NÃO** exibe "Exige Veículo Rastreado" se não for exigido
- ❌ **NÃO** exibe bordas decorativas
- ❌ **NÃO** exibe origem/destino separados (apenas rota)
- ❌ **NÃO** exibe distância
- ✅ **SEMPRE** exibe "DETALHES DA VIAGEM" (se houver observações)
- ✅ Link único será adicionado automaticamente para cada motorista

**Ações disponíveis no modal:**
- 📋 **Copiar Texto**: Copia o texto formatado para área de transferência
- 📱 **Enviar via WhatsApp**: Cria convocações, gera links e abre WhatsApp (veja seção 4.1)

---

### 4. Disparo de Convocações

⚠️ **IMPORTANTE:** Existem **DOIS CAMINHOS DIFERENTES** para disparar convocações. Escolha o adequado para sua necessidade:

---

#### 4.1. Caminho Completo: "Preparar Anúncio" → "Enviar via WhatsApp"

**Onde:** Aba "Compatíveis" → Selecionar motoristas → Botão "📢 Preparar Anúncio" → Botão "📱 Enviar via WhatsApp" (dentro do modal)

**Quando usar:**
- ✅ Quando você quer **enviar mensagens via WhatsApp** para os motoristas
- ✅ Quando você precisa **visualizar o anúncio antes** de enviar
- ✅ Quando você quer **copiar o texto** para enviar manualmente
- ✅ **RECOMENDADO** para uso normal do sistema

**O que acontece (em ordem):**

##### 4.1.1. Validações Iniciais
- ✅ Pelo menos um motorista selecionado
- ✅ Viagem selecionada
- ✅ Anúncio preparado (modal aberto)

##### 4.1.2. Criação das Convocações
- Sistema cria um registro na tabela `CONVOCACAO` para cada motorista selecionado
- Status inicial: **PENDENTE**
- Grava: `IDVIAGEM`, `CDCADASTRO_MOTORISTA`, `SGUSUARIO_OPERADOR` (login do usuário logado)
- Gera ID único para cada convocação

##### 4.1.3. Geração de Links Únicos
- Para cada convocação criada, gera um link único:
  - Formato: `{PUBLIC_URL}/convocacao/{IDCONVOCACAO}`
  - Exemplo: `https://laurence-boisterous-almost.ngrok-free.dev/convocacao/123`

##### 4.1.4. Formatação do Texto com Link
- Adiciona o link único ao texto base do anúncio
- Formatação varia conforme tipo de URL:

**URL Pública (HTTPS - ngrok ou domínio):**
```
🔗 *ACESSE PARA RESPONDER*

https://exemplo.com/convocacao/123

👆 *Toque no link acima para responder*

💡 *Aviso:* Na primeira vez, você verá uma página de segurança. Clique em "Visit Site" para continuar.
```

**URL Local (HTTP - IP local):**
```
🔗 *ACESSE PARA RESPONDER*

📋 *Copie este link e cole no navegador:*
http://SEU_IP:3000/convocacao/123 (ou use PUBLIC_URL do .env)

💡 *Importante:*
• Links locais não são clicáveis no WhatsApp
• Copie o link acima (toque e segure)
• Cole no navegador do celular
• Certifique-se de estar na mesma rede Wi-Fi
```

##### 4.1.5. Atualização no Banco
- Atualiza cada convocação com:
  - `NRCELULAR`: Telefone formatado do motorista
  - `TXTCONVOCACAO`: Texto completo enviado
  - `LINKCONVOCACAO`: Link único gerado

##### 4.1.6. Envio via WhatsApp
- Abre WhatsApp Web/App para cada motorista
- Mensagem pré-formatada com o texto completo
- Cada motorista recebe seu link único
- Delay de 500ms entre cada abertura (para não bloquear navegador)

**Resultado:**
- ✅ Convocações criadas no banco
- ✅ Links únicos gerados
- ✅ Texto e link salvos no banco (`TXTCONVOCACAO`, `LINKCONVOCACAO`)
- ✅ Telefone salvo no banco (`NRCELULAR`)
- ✅ WhatsApp aberto para cada motorista
- ✅ Histórico completo gravado
- ✅ Modal fechado automaticamente

---

#### 4.2. Caminho Simples: "Disparar Convocações" (Apenas Registro)

**Onde:** Aba "Compatíveis" → Selecionar motoristas → Botão "Disparar Convocações" (botão direto, sem modal)

**Quando usar:**
- ✅ Quando você quer **apenas registrar** as convocações no banco
- ✅ Quando você vai **enviar mensagens manualmente** (fora do sistema)
- ✅ Quando você precisa criar convocações **sem enviar WhatsApp**
- ⚠️ **NÃO RECOMENDADO** para uso normal (use o caminho completo)

**O que acontece:**

##### 4.2.1. Validações Iniciais
- ✅ Pelo menos um motorista selecionado
- ✅ Viagem selecionada
- ⚠️ **NÃO** requer anúncio preparado

##### 4.2.2. Criação das Convocações
- Sistema cria um registro na tabela `CONVOCACAO` para cada motorista selecionado
- Status inicial: **PENDENTE**
- Grava: `IDVIAGEM`, `CDCADASTRO_MOTORISTA`, `SGUSUARIO_OPERADOR` (login do usuário logado)
- Gera ID único para cada convocação

**O que NÃO acontece:**
- ❌ **NÃO** gera links únicos
- ❌ **NÃO** atualiza `NRCELULAR`, `TXTCONVOCACAO`, `LINKCONVOCACAO`
- ❌ **NÃO** abre WhatsApp
- ❌ **NÃO** envia mensagens

**Resultado:**
- ✅ Convocações criadas no banco (apenas dados básicos)
- ❌ Links **NÃO** gerados
- ❌ Texto **NÃO** salvo
- ❌ Telefone **NÃO** salvo
- ❌ WhatsApp **NÃO** aberto
- ⚠️ Convocações ficam incompletas (sem link para o motorista responder)

---

### 📊 Comparação dos Caminhos

| Característica | Preparar Anúncio → Enviar via WhatsApp | Disparar Convocações |
|----------------|----------------------------------------|----------------------|
| **Cria convocações no banco** | ✅ Sim | ✅ Sim |
| **Gera links únicos** | ✅ Sim | ❌ Não |
| **Salva texto do anúncio** | ✅ Sim (`TXTCONVOCACAO`) | ❌ Não |
| **Salva telefone** | ✅ Sim (`NRCELULAR`) | ❌ Não |
| **Salva link** | ✅ Sim (`LINKCONVOCACAO`) | ❌ Não |
| **Abre WhatsApp** | ✅ Sim | ❌ Não |
| **Envia mensagens** | ✅ Sim | ❌ Não |
| **Permite visualizar antes** | ✅ Sim (modal) | ❌ Não |
| **Permite copiar texto** | ✅ Sim | ❌ Não |
| **Uso recomendado** | ✅ **SIM** | ⚠️ Apenas casos específicos |

---

### 💡 Recomendação de Uso

**Para 99% dos casos, use:**
1. Selecionar motoristas compatíveis
2. Clicar em "📢 Preparar Anúncio"
3. Visualizar o preview do anúncio
4. Clicar em "📱 Enviar via WhatsApp"
5. Sistema faz tudo automaticamente

**Use "Disparar Convocações" apenas se:**
- Você vai enviar mensagens manualmente (fora do sistema)
- Você precisa apenas registrar no banco sem enviar
- Você tem um processo customizado de envio

---

### 5. Resposta do Motorista

**Onde:** Página pública `/convocacao/{id}` (acessada via link do WhatsApp)

**O que acontece:**

#### 5.1. Acesso à Página
- Motorista clica no link recebido via WhatsApp
- Sistema busca dados da convocação
- Exibe informações da viagem de forma clara e visual

#### 5.2. Visualização
- Dados da viagem (origem, destino, horários, valores)
- Status atual da convocação
- Botões de ação (se ainda PENDENTE)

#### 5.3. Resposta
- Motorista pode **ACEITAR** ou **RECUSAR**
- Modal de confirmação personalizado (não usa `confirm()` nativo)
- Ao confirmar:
  - Status muda para **ACEITA** ou **RECUSADA**
  - `DHRESPOSTA` é gravado com data/hora atual
  - Mensagem de sucesso exibida
  - Botões desabilitados

**Regras:**
- ✅ Apenas convocações **PENDENTE** podem ser respondidas
- ✅ Uma vez respondida, não pode ser alterada pelo motorista
- ✅ Sistema registra quem respondeu (`SGUSER = 'MOTORISTA'`)

---

### 6. Confirmação pelo Operador

**Onde:** Aba "Convocações" → Grid → Botão "✅ Confirmar" (apenas para status ACEITA)

**O que acontece:**

#### 6.1. Validações
- ✅ Convocação deve estar com status **ACEITA**
- ✅ Não pode existir outra convocação **CONFIRMADA** para a mesma viagem
- ✅ Operador deve estar autenticado

#### 6.2. Processo de Confirmação
1. Modal de confirmação exibido com:
   - ID da viagem
   - Nome do motorista
   - Aviso sobre recusa automática de outras convocações

2. Ao confirmar:
   - **Transação no banco de dados** (garante atomicidade)
   - Convocação selecionada muda para **CONFIRMADA**
   - **TODAS** as outras convocações da mesma viagem (PENDENTE ou ACEITA) são automaticamente **RECUSADAS**
   - `DHRESPOSTA` é atualizado para as convocações recusadas
   - Lista é recarregada automaticamente

**Regras Críticas:**
- ⚠️ **UMA VIAGEM = UM MOTORISTA CONFIRMADO**
- ⚠️ Não é possível confirmar mais de uma convocação por viagem
- ⚠️ Não é possível confirmar convocação que não esteja ACEITA
- ⚠️ Processo é **irreversível** (após confirmar, outras são recusadas)

---

## 📊 Status das Convocações

### PENDENTE
- **Quando:** Convocação criada, mas motorista ainda não respondeu
- **Ações disponíveis:**
  - Motorista pode ACEITAR ou RECUSAR
  - Operador pode visualizar
- **Visual:** Badge amarelo (`#fff3cd`)

### ACEITA
- **Quando:** Motorista aceitou a proposta via link
- **Ações disponíveis:**
  - Operador pode **CONFIRMAR** (botão verde aparece)
  - Motorista não pode mais alterar
- **Visual:** Badge verde (`#d4edda`)
- **Importante:** Ainda não está atribuída definitivamente

### CONFIRMADA
- **Quando:** Operador confirmou manualmente que a viagem foi atribuída
- **Ações disponíveis:**
  - Apenas visualização
  - Não pode ser alterada
- **Visual:** Badge azul (`#cce5ff`)
- **Importante:** Viagem está definitivamente atribuída a este motorista

### RECUSADA
- **Quando:**
  - Motorista recusou a proposta, OU
  - Outra convocação da mesma viagem foi confirmada (recusa automática)
- **Ações disponíveis:**
  - Apenas visualização
  - Não pode ser alterada
- **Visual:** Badge vermelho (`#f8d7da`)

---

## 🔒 Regras de Negócio

### Regra 1: Compatibilidade de Classe de Frota
- ✅ Motorista **DEVE** ter a mesma classe de frota da viagem
- ✅ Classe deve estar ativa (`FGACTIVE = 'S'`)
- ❌ Motorista sem classe compatível **NÃO** aparece na lista

### Regra 2: Veículo Rastreado
- ✅ Se viagem exige rastreador → Apenas motoristas com rastreador
- ✅ Se viagem não exige → Todos os motoristas (com ou sem)
- ❌ Motorista sem rastreador **NÃO** aparece se viagem exige

### Regra 3: Localização (Micro-região)
- ✅ Motorista da mesma micro-região da origem OU destino
- ✅ Motorista da própria cidade de origem OU destino
- ❌ Motorista de outra micro-região **NÃO** aparece

### Regra 4: Viagem Pendente
- ✅ Apenas viagens "Programada" ou "Preparação" aparecem
- ✅ Apenas viagens sem convocação ACEITA ou CONFIRMADA
- ❌ Viagem já atribuída **NÃO** aparece como pendente

### Regra 5: Uma Viagem = Um Motorista
- ✅ Apenas **UMA** convocação pode estar CONFIRMADA por viagem
- ✅ Ao confirmar uma, outras são automaticamente recusadas
- ❌ Não é possível confirmar duas convocações da mesma viagem

### Regra 6: Confirmação Manual
- ✅ Apenas convocações **ACEITA** podem ser confirmadas
- ✅ Apenas operador autenticado pode confirmar
- ❌ Motorista não pode confirmar (apenas aceitar)
- ❌ Sistema não confirma automaticamente

### Regra 7: Histórico Completo
- ✅ Todas as convocações são gravadas (mesmo recusadas)
- ✅ Texto completo do anúncio é salvo
- ✅ Link único é salvo
- ✅ Telefone é salvo no momento do envio
- ✅ Operador que criou é registrado

---

## ⚠️ Validações e Restrições

### Validações no Frontend

#### Ao Buscar Motoristas Compatíveis
- ✅ Viagem deve estar selecionada
- ✅ Mensagem de erro se nenhum motorista encontrado

#### Ao Preparar Anúncio
- ✅ Viagem deve estar selecionada
- ✅ Dados da viagem devem estar disponíveis
- ✅ Preview é exibido antes do envio

#### Ao Disparar Convocações
- ✅ Pelo menos um motorista selecionado
- ✅ Viagem selecionada
- ✅ Anúncio preparado
- ✅ Usuário autenticado (login no header)

#### Ao Confirmar Convocação
- ✅ Convocação deve estar ACEITA
- ✅ Não pode existir outra CONFIRMADA para a mesma viagem
- ✅ Modal de confirmação com aviso

### Validações no Backend

#### Ao Criar Convocações
- ✅ `idViagem` obrigatório
- ✅ `motoristas` array não vazio
- ✅ Usuário autenticado (`user-login` header)
- ✅ Usuário deve existir e estar ativo no banco
- ✅ Viagem deve existir

#### Ao Confirmar Convocação
- ✅ Convocação deve existir
- ✅ Status deve ser ACEITA
- ✅ Não pode existir outra CONFIRMADA para a mesma viagem
- ✅ Transação garante atomicidade (tudo ou nada)

#### Ao Responder Convocação (Motorista)
- ✅ Convocação deve existir
- ✅ Status deve ser PENDENTE
- ✅ Status informado deve ser ACEITA ou RECUSADA

---

## 📱 Integração WhatsApp

### Configuração de URL Pública

**Variável de ambiente:** `PUBLIC_URL` no arquivo `.env`

**Exemplos:**
```env
# Para ngrok (acesso externo)
PUBLIC_URL=https://laurence-boisterous-almost.ngrok-free.dev

# Para IP local (apenas mesma rede)
PUBLIC_URL=http://SEU_IP:3000 (substitua SEU_IP pelo seu IP atual)
```

### Comportamento por Tipo de URL

#### URL Pública (HTTPS)
- ✅ Link é **clicável** no WhatsApp
- ✅ Funciona de qualquer lugar
- ⚠️ Se ngrok: primeira visita mostra página de aviso (normal)

#### URL Local (HTTP)
- ❌ Link **NÃO é clicável** no WhatsApp
- ✅ Instruções claras para copiar/colar
- ✅ Funciona apenas na mesma rede Wi-Fi

### Formato da Mensagem

**Estrutura:**
1. Anúncio formatado (emoji, negrito, seções)
2. Link único da convocação
3. Instruções de acesso
4. Avisos (se necessário)

**Características:**
- ✅ Formatação Markdown do WhatsApp (negrito, emoji)
- ✅ Texto conciso e profissional
- ✅ Informações essenciais destacadas
- ✅ Link sempre presente

---

## 🌐 Página Pública do Motorista

### URL
`{PUBLIC_URL}/convocacao/{IDCONVOCACAO}`

### Funcionalidades

#### Visualização
- ✅ Dados completos da viagem
- ✅ Status atual da convocação
- ✅ Horários formatados corretamente (sem diferença de fuso)
- ✅ Design responsivo (funciona no celular)

#### Ações Disponíveis
- ✅ Botão "✅ Aceitar Convocação" (se PENDENTE)
- ✅ Botão "❌ Recusar Convocação" (se PENDENTE)
- ✅ Modal de confirmação personalizado (não usa `confirm()` nativo)

#### Restrições
- ❌ Apenas convocações PENDENTE podem ser respondidas
- ❌ Uma vez respondida, não pode ser alterada
- ❌ Não requer autenticação (acesso público)

### Segurança
- ✅ Validação de ID da convocação
- ✅ Verificação de status antes de permitir ação
- ✅ Registro de quem respondeu (`SGUSER = 'MOTORISTA'`)

---

## 🔍 Troubleshooting

### Problema: "Nenhum motorista compatível encontrado"

**Possíveis causas:**
1. ❌ Nenhum motorista tem a classe de frota da viagem
2. ❌ Viagem exige rastreador e nenhum motorista tem
3. ❌ Nenhum motorista está na micro-região correta
4. ❌ Motoristas não estão ativos (`FGACTIVE = 'A'`)

**Solução:**
- Verificar cadastro dos motoristas
- Verificar classe de frota atribuída
- Verificar se têm rastreador (se exigido)
- Verificar cidade/micro-região cadastrada

### Problema: "Erro ao criar convocações"

**Possíveis causas:**
1. ❌ Usuário não autenticado
2. ❌ Usuário não existe no banco
3. ❌ Viagem não existe
4. ❌ Erro de conexão com banco

**Solução:**
- Verificar se está logado
- Verificar se usuário existe em `USUARIO`
- Verificar conexão com banco
- Verificar logs do servidor

### Problema: "Não consigo confirmar convocação"

**Possíveis causas:**
1. ❌ Convocação não está ACEITA
2. ❌ Já existe outra CONFIRMADA para a mesma viagem
3. ❌ Convocação não existe

**Solução:**
- Verificar status da convocação
- Verificar se outra já foi confirmada
- Verificar ID da convocação

### Problema: "Link não funciona no WhatsApp"

**Possíveis causas:**
1. ❌ URL local (HTTP) - não é clicável
2. ❌ URL pública com erro
3. ❌ ngrok não está rodando

**Solução:**
- Usar URL pública (HTTPS) para links clicáveis
- Se usar IP local, seguir instruções de copiar/colar
- Verificar se ngrok está ativo

### Problema: "Datas aparecem com 3 horas de diferença"

**Causa:**
- Conversão incorreta de fuso horário

**Solução:**
- ✅ Já corrigido no código
- Datas são tratadas como locais (sem conversão UTC)
- Se ainda ocorrer, limpar cache do navegador

### Problema: "Qual botão devo usar para enviar convocações?"

**Resposta:**
- ✅ **Use "Preparar Anúncio" → "Enviar via WhatsApp"** (caminho completo)
  - Cria convocações
  - Gera links únicos
  - Salva texto e telefone
  - Abre WhatsApp automaticamente
  - **RECOMENDADO para 99% dos casos**

- ⚠️ **Use "Disparar Convocações"** apenas se:
  - Você vai enviar mensagens manualmente (fora do sistema)
  - Você precisa apenas registrar no banco sem enviar
  - Você tem um processo customizado de envio

**Importante:**
- "Disparar Convocações" **NÃO** abre WhatsApp
- "Disparar Convocações" **NÃO** gera links
- "Disparar Convocações" **NÃO** salva texto/telefone
- Convocações criadas por "Disparar Convocações" ficam incompletas (sem link para resposta)

---

## 📖 Glossário

| Termo | Definição |
|-------|-----------|
| **Viagem Pendente** | Viagem que precisa de motorista, sem convocação aceita/confirmada |
| **Motorista Compatível** | Motorista que atende todos os critérios (classe, rastreador, localização) |
| **Convocação** | Registro de convite enviado a um motorista |
| **Micro-região** | Agrupamento geográfico de cidades (campo `CDMICROREGIAO`) |
| **Classe de Frota** | Tipo de veículo necessário para a viagem |
| **Link Único** | URL exclusiva para cada convocação, permitindo resposta individual |
| **Status PENDENTE** | Convocação criada, aguardando resposta do motorista |
| **Status ACEITA** | Motorista aceitou a proposta |
| **Status CONFIRMADA** | Operador confirmou que viagem foi atribuída |
| **Status RECUSADA** | Motorista recusou ou foi recusada automaticamente |
| **PUBLIC_URL** | URL pública configurável para links de convocação |
| **Atomicidade** | Garantia de que operação acontece completamente ou não acontece |

---

## 📝 Notas Importantes

### Para Operadores

#### ⚠️ IMPORTANTE: Diferença entre os Botões de Convocações

**Existem DOIS botões diferentes na aba "Compatíveis":**

1. **"📢 Preparar Anúncio" → "📱 Enviar via WhatsApp"** (DENTRO DO MODAL)
   - ✅ **RECOMENDADO** para uso normal
   - ✅ Cria convocações, gera links, salva texto e telefone
   - ✅ Abre WhatsApp automaticamente para cada motorista
   - ✅ Processo completo e automatizado

2. **"Disparar Convocações"** (BOTÃO DIRETO)
   - ⚠️ Apenas cria registros no banco
   - ❌ **NÃO** gera links
   - ❌ **NÃO** salva texto ou telefone
   - ❌ **NÃO** abre WhatsApp
   - ⚠️ Use apenas se for enviar mensagens manualmente

**Regra de Ouro:**
- 🎯 **SEMPRE** use "Preparar Anúncio" → "Enviar via WhatsApp" para envio normal
- 🎯 Use "Disparar Convocações" apenas em casos muito específicos

#### Outras Recomendações

1. ⚠️ **SEMPRE** verifique os dados antes de confirmar uma convocação
2. ⚠️ **NÃO** é possível desfazer uma confirmação
3. ⚠️ Ao confirmar, outras convocações são automaticamente recusadas
4. ✅ Use os filtros para encontrar convocações específicas
5. ✅ Verifique o histórico completo antes de tomar decisões
6. ✅ Visualize o preview do anúncio antes de enviar (usando "Preparar Anúncio")

### Para Desenvolvedores

1. ✅ Todas as operações críticas usam transações
2. ✅ Validações no frontend e backend
3. ✅ Logs detalhados para debugging
4. ✅ Tratamento de erros em todas as funções
5. ✅ Datas formatadas corretamente (sem diferença de fuso)

### Para Administradores

1. ✅ Configure `PUBLIC_URL` corretamente no `.env`
2. ✅ Mantenha dados de motoristas atualizados
3. ✅ Verifique classes de frota atribuídas
4. ✅ Monitore convocações pendentes
5. ✅ Revise periodicamente convocações não respondidas

---

## 🎓 Treinamento Recomendado

### Módulo 1: Conceitos Básicos
- O que é uma convocação
- Diferença entre ACEITA e CONFIRMADA
- Como funciona a compatibilidade

### Módulo 2: Operação Básica
- Como buscar motoristas compatíveis
- Como preparar e enviar anúncios
- Como visualizar convocações

### Módulo 3: Operação Avançada
- Como confirmar convocações
- Como usar filtros
- Como interpretar status

### Módulo 4: Troubleshooting
- Problemas comuns e soluções
- Quando buscar ajuda técnica
- Como reportar problemas

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Consultar esta documentação
2. Verificar logs do sistema
3. Contatar equipe técnica

---

---

## 🔄 Atualizações Recentes (2026-11-23)

### Melhorias Implementadas

#### Proteção contra Execução Múltipla do init.sql
- ✅ Sistema agora garante que o `init.sql` execute apenas uma vez por sessão
- ✅ Flags de controle (`initExecutado`, `sqlExecutado`) previnem execuções duplicadas
- ✅ Event listeners com `once: true` garantem execução única

#### Prevenção de Mudanças Automáticas de Aba
- ✅ Sistema previne que a aba volte automaticamente para "Filtros" após operações
- ✅ Flag `bloqueandoMudancaAba` protege durante operações críticas
- ✅ Proteção especial para viagens em edição
- ✅ Campo "ID Viagem" no filtro é preenchido automaticamente ao editar

#### Execução Completa do init.sql
- ✅ Sistema aguarda completamente a execução de todo o SQL antes de mudar abas
- ✅ Verificação de sucesso de todos os comandos
- ✅ Delay adicional para garantir conclusão de operações assíncronas
- ✅ Logs informativos para debug

#### Melhorias na Interface
- ✅ Ordenação em tabelas (Motoristas Compatíveis e Convocações)
- ✅ Modal de links WhatsApp para múltiplos envios
- ✅ Prevenção de duplicação de convocações (reutiliza PENDENTE existente)
- ✅ Atualização automática de mensagens ao reenviar

---

**Documentação mantida por:** Equipe Atlas Cargo  
**Última atualização:** 2026-11-23  
**Versão do documento:** 1.1.0

