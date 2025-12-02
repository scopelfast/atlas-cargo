# 📱 PLANEJAMENTO COMPLETO: APP DO MOTORISTA

## 🎯 VISÃO GERAL

### Objetivo:
Criar um aplicativo móvel para motoristas acessarem cargas disponíveis, fazerem cadastro, aceitarem viagens e serem rastreados em tempo real.

---

## 🔍 FUNCIONALIDADES PRINCIPAIS

### 1. **CADASTRO E LOGIN** 👤
- [ ] Cadastro de novo motorista
  - Nome completo
  - CPF
  - CNH (número, categoria, validade)
  - Telefone/WhatsApp
  - Email
  - Endereço
  - Foto do motorista
  - Foto da CNH
  - Dados do veículo (placa, tipo, capacidade)
- [ ] Login com CPF/Email + Senha
- [ ] Recuperação de senha
- [ ] Perfil do motorista (editar dados)

### 2. **VISUALIZAR CARGAS DISPONÍVEIS** 📦
- [ ] Lista de cargas/viagens disponíveis
  - Origem → Destino
  - Distância
  - Valor do frete
  - Tipo de carga
  - Peso/Volume
  - Data/hora prevista
  - Prazo de entrega
- [ ] Filtros:
  - Por região/estado
  - Por tipo de veículo
  - Por faixa de valor
  - Por distância
- [ ] Detalhes da carga (ver mais informações)
- [ ] Botão "ACEITAR CARGA"

### 3. **MINHAS VIAGENS** 🚚
- [ ] Viagens aceitas (aguardando confirmação)
- [ ] Viagens em andamento
- [ ] Viagens concluídas (histórico)
- [ ] Viagens canceladas

### 4. **VIAGEM EM ANDAMENTO** 📍
- [ ] **Iniciar viagem** (botão)
- [ ] **Rastreamento em tempo real**
  - GPS automático (envia posição a cada X minutos)
  - Mostrar rota no mapa
  - Distância percorrida
  - Tempo estimado de chegada
- [ ] **Registrar eventos:**
  - Parada para descanso
  - Parada para abastecimento
  - Parada para refeição
  - Problema mecânico
  - Acidente/imprevisto
  - Checkpoint (passou por ponto X)
- [ ] **Anexar fotos:**
  - Foto da carga (na coleta)
  - Foto da carga (na entrega)
  - Foto de problemas (se houver)
  - Comprovante de entrega (assinatura)
- [ ] **Finalizar viagem** (botão)

### 5. **NOTIFICAÇÕES** 🔔
- [ ] Nova carga disponível na sua região
- [ ] Carga aceita/confirmada
- [ ] Carga cancelada
- [ ] Mensagem do operador
- [ ] Lembrete de atualizar localização

### 6. **CHAT/MENSAGENS** 💬
- [ ] Chat com operador/empresa
- [ ] Enviar mensagens
- [ ] Receber mensagens
- [ ] Notificações de novas mensagens

### 7. **FINANCEIRO** 💰
- [ ] Viagens a receber
- [ ] Viagens pagas
- [ ] Histórico de pagamentos
- [ ] Extrato

---

## 🏗️ ARQUITETURA TÉCNICA

### **Opção 1: PWA (Progressive Web App)** ⭐ RECOMENDADO
- ✅ **Vantagens:**
  - Funciona em Android e iOS
  - Não precisa instalar da loja
  - Mais rápido de desenvolver
  - Usa tecnologias que você já conhece (HTML/CSS/JS)
  - Acessa câmera, GPS, notificações
  - Pode ser "instalado" na tela inicial
  - Atualização automática
  - **✅ FUNCIONA 100% OFFLINE** (Service Worker + IndexedDB)
- ⚠️ **Desvantagens:**
  - Menos integrado que app nativo
  - Algumas limitações em iOS

### **Opção 2: App Nativo (React Native / Flutter)**
- ✅ **Vantagens:**
  - Melhor performance
  - Acesso total ao hardware
  - Melhor UX/UI
  - Pode publicar nas lojas
- ⚠️ **Desvantagens:**
  - Precisa aprender nova tecnologia
  - Mais complexo de desenvolver
  - Mais tempo para desenvolver

### **🎯 RECOMENDAÇÃO: PWA (Progressive Web App)**

**Por quê?**
1. Você já domina HTML/CSS/JS/Node.js
2. Reutiliza backend atual
3. Desenvolvimento mais rápido (1-2 meses vs 4-6 meses)
4. Funciona em qualquer celular
5. Sem taxas de loja (Apple/Google)
6. Atualização instantânea

---

## 🗄️ BANCO DE DADOS (Novas Tabelas)

### **Tabela: MOTORISTA** (já existe parcialmente em CADASTROGERAL)
```sql
- CDMOTORISTA (PK)
- CDCADASTRO (FK → CADASTROGERAL)
- NRCNH
- CATEGORIACNH
- VALIDADECNH
- FOTOCNH (caminho arquivo)
- FOTOMOTORISTA (caminho arquivo)
- STATUSAPROVACAO (P=Pendente, A=Aprovado, R=Rejeitado)
- DHCADASTRO
- DHAPROVACAO
```

### **Tabela: MOTORISTA_VEICULO**
```sql
- IDMOTORISTAVEÍCULO (PK)
- CDMOTORISTA (FK)
- PLACA
- CDTIPOEQUIPAMENTO (FK)
- CAPACIDADEKG
- CAPACIDADEM3
- FGPRINCIPAL (S/N)
- FGACTIVE (S/N)
```

### **Tabela: VIAGEM_STATUS_HISTORICO**
```sql
- IDSTATUSHISTORICO (PK)
- IDVIAGEM (FK)
- CDMOTORISTA (FK)
- STATUS (D=Disponível, A=Aceita, I=Iniciada, F=Finalizada, C=Cancelada)
- DHREGISTRO
- LATITUDE
- LONGITUDE
- OBSERVACAO
```

### **Tabela: VIAGEM_RASTREAMENTO**
```sql
- IDRASTREAMENTO (PK)
- IDVIAGEM (FK)
- CDMOTORISTA (FK)
- LATITUDE
- LONGITUDE
- VELOCIDADE
- PRECISAO
- DHREGISTRO
- TIPO (A=Automático, M=Manual)
```

### **Tabela: VIAGEM_EVENTO**
```sql
- IDEVENTO (PK)
- IDVIAGEM (FK)
- CDMOTORISTA (FK)
- TIPO (P=Parada, A=Abastecimento, R=Refeição, M=Mecânico, I=Imprevisto)
- DESCRICAO
- LATITUDE
- LONGITUDE
- DHEVENTO
- FOTO (caminho arquivo)
```

### **Tabela: VIAGEM_CHAT**
```sql
- IDMENSAGEM (PK)
- IDVIAGEM (FK)
- CDMOTORISTA (FK)
- CDUSUARIO (FK)
- TIPO (M=Motorista, O=Operador)
- MENSAGEM
- DHLEITURA
- DHENVIO
```

---

## 🌐 APIs NECESSÁRIAS

### **Backend - Novas Rotas:**

#### **1. Auth/Cadastro Motorista:**
```
POST   /api/motorista/cadastro         - Cadastrar novo motorista
POST   /api/motorista/login            - Login do motorista
POST   /api/motorista/recuperar-senha  - Recuperar senha
GET    /api/motorista/perfil/:id       - Ver perfil
PUT    /api/motorista/perfil/:id       - Editar perfil
POST   /api/motorista/upload-foto      - Upload de foto
```

#### **2. Cargas Disponíveis:**
```
GET    /api/motorista/cargas-disponiveis  - Listar cargas
GET    /api/motorista/carga/:id           - Detalhes da carga
POST   /api/motorista/aceitar-carga/:id   - Aceitar carga
```

#### **3. Minhas Viagens:**
```
GET    /api/motorista/minhas-viagens/:id  - Lista de viagens do motorista
GET    /api/motorista/viagem/:id          - Detalhes da viagem
POST   /api/motorista/iniciar-viagem/:id  - Iniciar viagem
POST   /api/motorista/finalizar-viagem/:id - Finalizar viagem
```

#### **4. Rastreamento:**
```
POST   /api/motorista/posicao             - Enviar posição GPS
GET    /api/motorista/rota/:idviagem      - Ver rota da viagem
POST   /api/motorista/evento              - Registrar evento (parada, etc)
```

#### **5. Chat:**
```
GET    /api/motorista/chat/:idviagem      - Ver mensagens
POST   /api/motorista/chat/:idviagem      - Enviar mensagem
```

---

## 📱 TELAS DO APP (UI/UX)

### **Fluxo de Navegação:**

```
LOGIN/CADASTRO
    ↓
DASHBOARD (Home)
    ├─→ CARGAS DISPONÍVEIS
    │       ├─→ DETALHES DA CARGA
    │       └─→ ACEITAR CARGA
    ├─→ MINHAS VIAGENS
    │       ├─→ EM ANDAMENTO
    │       │       ├─→ RASTREAMENTO
    │       │       ├─→ REGISTRAR EVENTO
    │       │       ├─→ CHAT
    │       │       └─→ FINALIZAR
    │       ├─→ AGUARDANDO
    │       └─→ HISTÓRICO
    ├─→ PERFIL
    │       ├─→ MEUS DADOS
    │       ├─→ MEUS VEÍCULOS
    │       └─→ DOCUMENTOS
    ├─→ FINANCEIRO
    └─→ NOTIFICAÇÕES
```

---

## 🔐 SEGURANÇA

### **Autenticação:**
- JWT Token (mesmo sistema atual)
- Token expira em 7 dias
- Refresh token automático

### **Permissões:**
- App só acessa dados do próprio motorista
- Não pode ver dados de outros motoristas
- Operador pode ver todos os motoristas

### **Geolocalização:**
- Solicitar permissão ao usuário
- Funcionar em background (se possível)
- Criptografar coordenadas no envio

---

## 📊 RASTREAMENTO EM TEMPO REAL

### **Como Funciona:**

1. **Motorista inicia viagem**
2. **App solicita permissão de GPS**
3. **App envia posição a cada X minutos** (configurável)
4. **Backend salva na tabela VIAGEM_RASTREAMENTO**
5. **Dashboard mostra no mapa em tempo real**

### **Configurações:**
- Intervalo padrão: **5 minutos**
- Modo econômico: **15 minutos**
- Modo preciso: **2 minutos**

### **Tecnologia:**
- HTML5 Geolocation API
- WebSocket (opcional, para tempo real no dashboard)
- Ou polling (requisição a cada X segundos)

---

## 📅 FASES DE DESENVOLVIMENTO

### **FASE 1: MVP (Mínimo Viável) - 1 mês**
- [ ] Cadastro e login de motorista
- [ ] Ver cargas disponíveis
- [ ] Aceitar carga
- [ ] Rastreamento básico (enviar GPS manualmente)

### **FASE 2: Rastreamento - 2 semanas**
- [ ] GPS automático em background
- [ ] Dashboard mostrando motorista no mapa
- [ ] Histórico de rota

### **FASE 3: Eventos e Fotos - 2 semanas**
- [ ] Registrar eventos (paradas, problemas)
- [ ] Tirar fotos
- [ ] Upload de fotos

### **FASE 4: Chat e Notificações - 2 semanas**
- [ ] Sistema de mensagens
- [ ] Notificações push
- [ ] Chat em tempo real

### **FASE 5: Financeiro - 1 semana**
- [ ] Extrato de viagens
- [ ] Valores a receber
- [ ] Histórico de pagamentos

---

## 💰 TECNOLOGIAS RECOMENDADAS

### **Frontend (PWA):**
- HTML5 / CSS3 / JavaScript
- Framework: **Vue.js** ou **React** (ou Vanilla JS)
- UI: **Tailwind CSS** ou **Bootstrap**
- Mapa: **Leaflet.js** ou **Google Maps API**
- PWA: **Service Worker** + **Manifest.json**

### **Backend (Já Existente):**
- Node.js + Express ✅
- SQL Server ✅
- JWT Auth ✅

### **Adicionais:**
- **Socket.io** (chat em tempo real - opcional)
- **Firebase Cloud Messaging** (notificações push)
- **Cloudinary** (armazenar fotos)

---

## 📝 PRÓXIMOS PASSOS

### **1. Decisões Importantes:**
- [ ] Confirmar que será PWA (não app nativo)
- [ ] Definir intervalo de GPS (5 min?)
- [ ] Definir regras de aprovação de motorista
- [ ] Definir como será o pagamento/financeiro

### **2. Preparação:**
- [ ] Criar tabelas no banco
- [ ] Criar rotas da API
- [ ] Criar estrutura de pastas do PWA
- [ ] Configurar manifesto PWA

### **3. Desenvolvimento MVP:**
- [ ] Tela de login/cadastro
- [ ] Tela de cargas disponíveis
- [ ] Tela de detalhes da carga
- [ ] Botão aceitar carga
- [ ] Rastreamento básico

---

## 🎯 PERGUNTAS PARA DECIDIR:

1. **Tipo de App:**
   - PWA (recomendado) ✅
   - ou App Nativo? ❓

2. **Aprovação de Motorista:**
   - Automática? (qualquer um pode se cadastrar)
   - ou Manual? (admin aprova) ← RECOMENDADO

3. **Rastreamento:**
   - Intervalo: 5 minutos? 10 minutos?
   - Funciona em background?

4. **Financeiro:**
   - Motorista vê valores?
   - Motorista registra despesas?

5. **Pagamento das Cargas:**
   - Motorista aceita e já fica confirmado?
   - ou Operador precisa aprovar?

---

## 📊 ESTIMATIVA DE TEMPO:

| Fase | Tempo | Entregas |
|------|-------|----------|
| **Fase 1 (MVP)** | 4 semanas | Login + Cargas + Aceitar |
| **Fase 2 (GPS)** | 2 semanas | Rastreamento automático |
| **Fase 3 (Eventos)** | 2 semanas | Fotos + Eventos |
| **Fase 4 (Chat)** | 2 semanas | Mensagens + Notificações |
| **Fase 5 (Financeiro)** | 1 semana | Extrato |
| **TOTAL** | **~3 meses** | App completo |

---

## 🎉 RESULTADO FINAL:

**Um PWA completo para motoristas:**
- ✅ Funciona em qualquer celular (Android/iOS)
- ✅ Rastreamento em tempo real
- ✅ Chat com operador
- ✅ Notificações
- ✅ Histórico de viagens
- ✅ Fácil de atualizar
- ✅ Sem taxas de loja

---

**Pronto para começar? Vamos discutir as decisões primeiro!** 🚀

