# 🔗 APP MOTORISTA - INTEGRAÇÃO COM SISTEMA EXISTENTE

## ✅ O QUE JÁ TEMOS (Aproveitar!)

### **1. BANCO DE DADOS EXISTENTE:**

#### **Tabela: CADASTROGERAL** ✅
```sql
-- Motoristas JÁ estão aqui!
SELECT * FROM CADASTROGERAL 
WHERE FGTIPOCADASTRO = 'M'  -- M = Motorista
```

**Campos existentes:**
- CDCADASTRO (ID)
- CGCCPF (CPF)
- RZSOCIAL (Nome completo)
- NRCELULAR (Telefone/WhatsApp)
- ENDEMAIL (Email)
- ENDERECO, CDCIDADE, etc
- FGACTIVE (Ativo/Inativo)
- FGTIPOCADASTRO = 'M' ← Motorista

#### **Tabela: VIAGEMMESTRE** ✅
```sql
-- Viagens já existem!
SELECT * FROM VIAGEMMESTRE
```

**Campos existentes:**
- IDVIAGEM
- CDTIPOVIAGEM
- CDSITUACAOVIAGEM
- FGSITVIAGEM
- CDCONTRATADOR
- IDROTEIRO
- DTPREVINICIO, DTPREVFINAL
- VLFRETE, PESO, CUBAGEM
- OBSERV

#### **Tabela: CONVOCACAO** ✅
```sql
-- Sistema de convocação JÁ existe!
SELECT * FROM CONVOCACAO
```

**Campos existentes:**
- IDCONVOCACAO
- IDVIAGEM
- CDCADASTRO_MOTORISTA
- STATUS (PENDENTE, ACEITA, RECUSADA, CONFIRMADA, etc)
- DHCONVOCACAO
- DHRESPOSTA
- NRCELULAR
- TXTCONVOCACAO
- LINKCONVOCACAO
- LATITUDE, LONGITUDE

---

## 🆕 O QUE PRECISA ADICIONAR

### **Novas Tabelas (Complementares):**

#### **1. MOTORISTA_COMPLEMENTO** (dados adicionais da CNH)
```sql
CREATE TABLE MOTORISTA_COMPLEMENTO (
  CDCADASTRO INT PRIMARY KEY,  -- FK para CADASTROGERAL
  NRCNH VARCHAR(11) UNIQUE,
  CATEGORIACNH VARCHAR(5),
  VALIDADECNH DATE,
  DATAPRIMEIRAHAB DATE,
  FOTOCNH VARCHAR(500),        -- Caminho da foto da CNH
  FOTOMOTORISTA VARCHAR(500),  -- Caminho da selfie
  RGMOTORISTA VARCHAR(20),
  NOMEMAE VARCHAR(100),
  STATUSAPROVACAO CHAR(1) DEFAULT 'P', -- P=Pendente, A=Aprovado, R=Rejeitado
  DHAPROVACAO DATETIME,
  APROVADOPOR INT,             -- FK para USUARIO
  MOTIVOREPROVACAO VARCHAR(500),
  DHMAINTENANCE DATETIME,
  SGUSER VARCHAR(50),
  SERVERORIG VARCHAR(50),
  
  CONSTRAINT FK_MOTORISTA_CADASTRO FOREIGN KEY (CDCADASTRO) 
    REFERENCES CADASTROGERAL(CDCADASTRO)
);
```

#### **2. MOTORISTA_VEICULO**
```sql
CREATE TABLE MOTORISTA_VEICULO (
  IDVEICULOMOTORISTA INT IDENTITY(1,1) PRIMARY KEY,
  CDCADASTRO INT NOT NULL,     -- Motorista (FK CADASTROGERAL)
  PLACA VARCHAR(10) NOT NULL UNIQUE,
  RENAVAM VARCHAR(11),
  CDTIPOEQUIPAMENTO SMALLINT,  -- FK TIPOEQUIPAMENTO
  MARCAMODELO VARCHAR(100),
  ANOFABRICACAO INT,
  ANOMODELO INT,
  COR VARCHAR(30),
  CAPACIDADEKG DECIMAL(10,2),
  CAPACIDADEM3 DECIMAL(10,3),
  FOTOVEICULO VARCHAR(500),
  FOTOCRLV VARCHAR(500),
  FGPRINCIPAL CHAR(1) DEFAULT 'N',
  FGACTIVE CHAR(1) DEFAULT 'S',
  DHMAINTENANCE DATETIME,
  
  CONSTRAINT FK_VEICULO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
    REFERENCES CADASTROGERAL(CDCADASTRO),
  CONSTRAINT FK_VEICULO_TIPO FOREIGN KEY (CDTIPOEQUIPAMENTO) 
    REFERENCES TIPOEQUIPAMENTO(CDTIPOEQUIPAMENTO)
);
```

#### **3. VIAGEM_RASTREAMENTO**
```sql
CREATE TABLE VIAGEM_RASTREAMENTO (
  IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  CDCADASTRO INT NOT NULL,     -- Motorista
  LATITUDE DECIMAL(10,8) NOT NULL,
  LONGITUDE DECIMAL(11,8) NOT NULL,
  VELOCIDADE DECIMAL(5,2),
  PRECISAO INT,
  BATERIA INT,                 -- % bateria do celular
  DHREGISTRO DATETIME NOT NULL,
  TIPO CHAR(1) DEFAULT 'A',    -- A=Automático, M=Manual
  FONTE VARCHAR(20) DEFAULT 'APP', -- APP, WEB, API
  
  CONSTRAINT FK_RASTREAMENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM),
  CONSTRAINT FK_RASTREAMENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
    REFERENCES CADASTROGERAL(CDCADASTRO)
);

CREATE INDEX IDX_RASTREAMENTO_VIAGEM ON VIAGEM_RASTREAMENTO(IDVIAGEM);
CREATE INDEX IDX_RASTREAMENTO_DATA ON VIAGEM_RASTREAMENTO(DHREGISTRO);
CREATE INDEX IDX_RASTREAMENTO_MOTORISTA ON VIAGEM_RASTREAMENTO(CDCADASTRO);
```

#### **4. VIAGEM_EVENTO**
```sql
CREATE TABLE VIAGEM_EVENTO (
  IDEVENTO INT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  CDCADASTRO INT NOT NULL,
  TIPO CHAR(1) NOT NULL,       -- P=Parada, A=Abast, R=Refeição, M=Mecânico, I=Imprevisto, C=Coleta, E=Entrega
  DESCRICAO VARCHAR(500),
  LATITUDE DECIMAL(10,8),
  LONGITUDE DECIMAL(11,8),
  DHEVENTO DATETIME NOT NULL,
  FOTO VARCHAR(500),
  
  CONSTRAINT FK_EVENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM),
  CONSTRAINT FK_EVENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
    REFERENCES CADASTROGERAL(CDCADASTRO)
);
```

#### **5. VIAGEM_COMPROVANTE**
```sql
CREATE TABLE VIAGEM_COMPROVANTE (
  IDCOMPROVANTE INT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  TIPO CHAR(1),                -- C=Coleta, E=Entrega
  NOMERECEBEDOR VARCHAR(100),
  CPFRECEBEDOR VARCHAR(14),
  DHENTREGA DATETIME,
  ASSINATURA VARCHAR(MAX),     -- Base64 da assinatura
  FOTO VARCHAR(500),
  OBSERVACAO VARCHAR(500),
  LATITUDE DECIMAL(10,8),
  LONGITUDE DECIMAL(11,8),
  
  CONSTRAINT FK_COMPROVANTE_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM)
);
```

---

## 🔗 COMO INTEGRAR COM O SISTEMA ATUAL

### **FLUXO COMPLETO INTEGRADO:**

```
SISTEMA ATUAL (Web - Operador):
    ↓
1. Operador cria viagem em VIAGEMMESTRE
    ↓
2. Sistema dispara convocação via WhatsApp
    ↓
3. Cria registro em CONVOCACAO
    ↓
MOTORISTA RECEBE (WhatsApp):
    ↓
4. Link: https://cargas.integrabrasil.com/convocacao/12345
    ↓
5. Motorista clica
    ↓
6. Abre página de convocação (JÁ EXISTE!)
    ↓
7. Motorista aceita/recusa
    ↓
8. Atualiza STATUS na tabela CONVOCACAO
    ↓
NOVO: APP DO MOTORISTA:
    ↓
9. Motorista baixa/acessa PWA
    ↓
10. Faz login (usando CADASTROGERAL)
    ↓
11. Vê "Minhas Viagens" (busca em CONVOCACAO onde STATUS = ACEITA ou CONFIRMADA)
    ↓
12. Inicia viagem
    ↓
13. App envia GPS para VIAGEM_RASTREAMENTO
    ↓
14. App registra eventos em VIAGEM_EVENTO
    ↓
15. App registra comprovante em VIAGEM_COMPROVANTE
    ↓
DASHBOARD (Web - Operador):
    ↓
16. Operador vê motorista no mapa (dados de VIAGEM_RASTREAMENTO)
    ↓
17. Operador vê eventos e fotos
    ↓
18. Operador vê comprovante de entrega
```

---

## 🎯 APROVEITAMENTO DO SISTEMA ATUAL

### **O Que JÁ Funciona e Vamos Usar:**

#### **1. Autenticação** ✅
- Login já existe (JWT)
- Apenas adicionar rota `/api/motorista/login` que:
  - Busca em CADASTROGERAL com FGTIPOCADASTRO = 'M'
  - Valida senha (criar campo SENHA na MOTORISTA_COMPLEMENTO)
  - Retorna token JWT

#### **2. Cadastro de Motorista** ✅
- Usa CADASTROGERAL (já existe!)
- Adiciona dados complementares em MOTORISTA_COMPLEMENTO
- FGTIPOCADASTRO = 'M'

#### **3. Viagens** ✅
- Usa VIAGEMMESTRE (já existe!)
- Usa CONVOCACAO (já existe!)
- Apenas adiciona rastreamento e eventos

#### **4. Convocação via WhatsApp** ✅
- Sistema JÁ funciona!
- Motorista recebe link
- Aceita/recusa na página
- APP mostra as viagens aceitas

---

## 📋 NOVO PLANEJAMENTO INTEGRADO

### **FASE 0: Decisões** (Hoje - 30min)
- [ ] Confirmar integração com sistema atual
- [ ] Definir se cria MOTORISTA_COMPLEMENTO ou adiciona campos no CADASTROGERAL

### **FASE 1: Banco de Dados** (Dia 1-2)

**Opção A: Criar tabela complementar** ⭐ RECOMENDADO
```sql
-- Adiciona MOTORISTA_COMPLEMENTO
-- Mantém CADASTROGERAL limpo
-- Mais organizado
```

**Opção B: Adicionar campos no CADASTROGERAL**
```sql
-- Adiciona colunas: NRCNH, CATEGORIACNH, etc
-- Menos tabelas
-- Mas deixa CADASTROGERAL "poluído"
```

**Novas tabelas:**
- MOTORISTA_COMPLEMENTO (ou adicionar campos)
- MOTORISTA_VEICULO
- VIAGEM_RASTREAMENTO
- VIAGEM_EVENTO
- VIAGEM_COMPROVANTE

### **FASE 2: Backend - Novas Rotas** (Dia 3-5)

**Reaproveitar estrutura existente:**
```javascript
// backend/controllers/motorista-app.controller.js
// Usa cadastroController existente como base!

const cadastroController = require('./cadastrogeral.controller');

const motoristaAppController = {
  // Login (aproveita CADASTROGERAL)
  login: async (req, res) => {
    // Busca em CADASTROGERAL com FGTIPOCADASTRO = 'M'
  },
  
  // Cargas disponíveis (usa VIAGEMMESTRE + CONVOCACAO)
  cargasDisponiveis: async (req, res) => {
    // Busca viagens onde motorista foi convocado
    // OU viagens abertas para aceite
  },
  
  // Minhas viagens (usa CONVOCACAO)
  minhasViagens: async (req, res) => {
    // SELECT * FROM CONVOCACAO 
    // WHERE CDCADASTRO_MOTORISTA = @ID
    // AND STATUS IN ('ACEITA', 'CONFIRMADA')
  }
};
```

### **FASE 3: Frontend PWA** (Dia 6-8)

**Estrutura:**
```
backend/public/motorista/     ← Nova pasta no public existente!
├── index.html
├── manifest.json
├── sw.js
├── css/
└── js/
```

**Aproveita:**
- CSS existente (`/css/modulos.css`)
- Estrutura de autenticação
- Mesma API base

---

## 🔄 INTEGRAÇÃO COM CONVOCAÇÃO ATUAL

### **Como Funciona Hoje:**
1. Operador cria viagem
2. Sistema envia WhatsApp com link
3. Motorista clica no link
4. Abre `/convocacao/:id` (já existe!)
5. Motorista aceita/recusa
6. Atualiza CONVOCACAO

### **Como Vai Funcionar com APP:**

```
CONVOCAÇÃO VIA WHATSAPP (continua funcionando):
    ↓
Motorista recebe link
    ↓
Motorista clica
    ↓
[NOVO] Sistema detecta se é mobile
    ↓
Se mobile: Redireciona para APP
    ↓
APP mostra viagem + botão "Aceitar no App"
    ↓
Motorista aceita
    ↓
Atualiza CONVOCACAO
    ↓
APP mostra: "✅ Viagem aceita! Veja em 'Minhas Viagens'"

OU

MOTORISTA ACESSA APP DIRETAMENTE:
    ↓
Faz login
    ↓
Vê "Novas Convocações" (CONVOCACAO com STATUS=PENDENTE)
    ↓
Vê "Cargas Disponíveis" (VIAGEMMESTRE abertas)
    ↓
Aceita direto no app
    ↓
Cria registro em CONVOCACAO
```

---

## 📊 MAPEAMENTO DE TABELAS

### **Sistema Atual → APP Motorista:**

| Sistema Atual | APP Motorista | Observação |
|---------------|---------------|------------|
| CADASTROGERAL | Login/Perfil | FGTIPOCADASTRO='M' |
| MOTORISTA_COMPLEMENTO | Dados CNH | ✅ NOVA |
| MOTORISTA_VEICULO | Veículos | ✅ NOVA |
| VIAGEMMESTRE | Cargas/Viagens | ✅ Usa existente |
| CONVOCACAO | Aceite/Recusa | ✅ Usa existente |
| VIAGEM_RASTREAMENTO | GPS | ✅ NOVA |
| VIAGEM_EVENTO | Eventos/Fotos | ✅ NOVA |
| VIAGEM_COMPROVANTE | Entrega | ✅ NOVA |

---

## 🔧 APIs - Aproveitando Estrutura

### **Reaproveitar:**
```javascript
// backend/app.js - Adicionar novas rotas

const motoristaAppRoutes = require('./routes/motorista-app.routes');
app.use('/api/motorista', motoristaAppRoutes);
```

### **Novas Rotas (integradas):**
```javascript
// backend/routes/motorista-app.routes.js

// Auth (usa CADASTROGERAL existente)
POST   /api/motorista/login
POST   /api/motorista/cadastro
GET    /api/motorista/perfil

// Viagens (usa VIAGEMMESTRE + CONVOCACAO)
GET    /api/motorista/cargas-disponiveis
GET    /api/motorista/minhas-convocacoes  ← Usa CONVOCACAO
POST   /api/motorista/aceitar/:id         ← Atualiza CONVOCACAO
GET    /api/motorista/minhas-viagens      ← Filtra CONVOCACAO por motorista

// Rastreamento (novo)
POST   /api/motorista/gps                 ← Insere em VIAGEM_RASTREAMENTO
POST   /api/motorista/evento              ← Insere em VIAGEM_EVENTO
POST   /api/motorista/comprovante         ← Insere em VIAGEM_COMPROVANTE

// Upload (aproveita estrutura)
POST   /api/motorista/upload-foto         ← Salva em /public/uploads/motoristas/
```

---

## 🎨 DASHBOARD - Ver Motoristas no Mapa

### **Nova Tela no Sistema Web:**

**Módulo: `gerenciar-viagens`**
- Adicionar aba "Rastreamento" (já tem estrutura com Leaflet!)
- Mostra motoristas no mapa
- Busca dados de VIAGEM_RASTREAMENTO
- Mostra eventos (VIAGEM_EVENTO)
- Mostra comprovantes (VIAGEM_COMPROVANTE)

---

## ✅ VANTAGENS DA INTEGRAÇÃO

1. ✅ **Aproveita backend existente** (Node.js + SQL Server)
2. ✅ **Reutiliza tabelas** (CADASTROGERAL, VIAGEMMESTRE, CONVOCACAO)
3. ✅ **Mantém sistema de convocação** (WhatsApp funcionando)
4. ✅ **Adiciona funcionalidades** (GPS, fotos, eventos)
5. ✅ **Desenvolvimento mais rápido** (menos código novo)
6. ✅ **Dados centralizados** (um único banco)
7. ✅ **Autenticação unificada** (JWT já funciona)

---

## 📅 NOVO CRONOGRAMA INTEGRADO

| Semana | O Que Fazer | Aproveita |
|--------|-------------|-----------|
| **1** | Adicionar 5 tabelas complementares | CADASTROGERAL, VIAGEMMESTRE |
| **1** | Criar rotas `/api/motorista/*` | Controllers existentes |
| **2** | Criar PWA em `/public/motorista/` | CSS/estrutura atual |
| **2** | Login integrado | JWT existente |
| **3** | Listar convocações | CONVOCACAO existente |
| **3** | Aceitar via app | Atualiza CONVOCACAO |
| **4** | GPS + Rastreamento | VIAGEM_RASTREAMENTO nova |
| **5** | Eventos + Fotos | VIAGEM_EVENTO nova |
| **6** | Dashboard mostra no mapa | Leaflet já usado |

**TOTAL: 6 semanas (mas muito mais simples!)** 🎉

---

## 🚀 POR ONDE COMEÇAR (REVISADO)

### **OPÇÃO D: Integração Completa** ⭐ RECOMENDADO

#### **DIA 1: Banco de Dados**
1. Criar `MOTORISTA_COMPLEMENTO`
2. Criar `MOTORISTA_VEICULO`
3. Criar `VIAGEM_RASTREAMENTO`
4. Criar `VIAGEM_EVENTO`
5. Criar `VIAGEM_COMPROVANTE`

#### **DIA 2-3: Backend**
1. Criar `/api/motorista/login` (usa CADASTROGERAL)
2. Criar `/api/motorista/minhas-convocacoes` (usa CONVOCACAO)
3. Criar `/api/motorista/aceitar/:id` (atualiza CONVOCACAO)
4. Criar `/api/motorista/gps` (insere VIAGEM_RASTREAMENTO)

#### **DIA 4-5: Frontend PWA**
1. Criar pasta `/public/motorista/`
2. Tela de login (chama `/api/motorista/login`)
3. Lista convocações (mostra CONVOCACAO)
4. Botão aceitar (atualiza CONVOCACAO)

#### **DIA 6-7: GPS**
1. Capturar GPS
2. Enviar para `/api/motorista/gps`
3. Salvar em VIAGEM_RASTREAMENTO

#### **DIA 8-10: Dashboard Web**
1. Adicionar aba "Rastreamento" em gerenciar-viagens
2. Mostrar motoristas no mapa
3. Consultar VIAGEM_RASTREAMENTO
4. Ver eventos e fotos

---

## 🎯 DECISÃO CRÍTICA

### **Como armazenar dados de CNH?**

**Opção A: Tabela complementar** ⭐ RECOMENDADO
```sql
CADASTROGERAL (mantém dados básicos)
    ↓
MOTORISTA_COMPLEMENTO (CNH, fotos, aprovação)
```
**Vantagens:**
- ✅ Não "polui" CADASTROGERAL
- ✅ Mais organizado
- ✅ Fácil manter

**Opção B: Adicionar colunas no CADASTROGERAL**
```sql
ALTER TABLE CADASTROGERAL ADD NRCNH VARCHAR(11);
ALTER TABLE CADASTROGERAL ADD CATEGORIACNH VARCHAR(5);
-- etc...
```
**Vantagens:**
- ✅ Menos JOINs
- ✅ Menos tabelas

---

## ✅ RESUMO

**JÁ TEMOS:**
- ✅ Backend (Node.js + Express)
- ✅ Banco (SQL Server)
- ✅ Auth (JWT)
- ✅ CADASTROGERAL (motoristas)
- ✅ VIAGEMMESTRE (viagens)
- ✅ CONVOCACAO (sistema de convocação)
- ✅ WhatsApp integrado

**PRECISAMOS ADICIONAR:**
- ✅ 5 tabelas complementares
- ✅ Rotas `/api/motorista/*`
- ✅ PWA em `/public/motorista/`
- ✅ Dashboard mostra GPS

**RESULTADO:**
- ✅ **Sistema integrado**
- ✅ **Dados centralizados**
- ✅ **Desenvolvimento mais rápido**
- ✅ **Tudo funcionando junto!** 🎉

---

**Agora faz sentido? Vamos integrar tudo! 🚀**

**👉 Me diga: Opção A (tabela complementar) ou B (adicionar colunas)?**

