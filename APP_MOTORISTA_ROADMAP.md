# 🗺️ ROADMAP: APP DO MOTORISTA - PASSO A PASSO

## 🎯 ONDE COMEÇAR?

### **FASE 0: DECISÕES** (Hoje - 30 minutos) ✅
Antes de começar, você precisa decidir:

#### **Decisões Obrigatórias:**
1. ✅ **PWA ou App Nativo?** → Recomendo: **PWA**
2. ✅ **Aprovação Manual ou Automática?** → Recomendo: **Manual**
3. ✅ **Intervalo GPS?** → Recomendo: **5 minutos**
4. ✅ **Modo Offline?** → **OBRIGATÓRIO** (já decidido!)
5. ✅ **OCR?** → **SIM** (já decidido!)

**📋 AÇÃO:** Abra `APP_MOTORISTA_DECISOES.md` e preencha suas escolhas!

---

## 📅 FASE 1: BANCO DE DADOS (Semana 1 - Dias 1-2)

### **DIA 1: Criar Tabelas** 🗄️

#### **1.1. Tabela MOTORISTA**
```sql
CREATE TABLE MOTORISTA (
  CDMOTORISTA INT IDENTITY(1,1) PRIMARY KEY,
  CDCADASTRO INT NOT NULL,
  NRCNH VARCHAR(11) NOT NULL UNIQUE,
  CATEGORIACNH VARCHAR(5) NOT NULL,
  VALIDADECNH DATE NOT NULL,
  DATAPRIMEIRAHAB DATE,
  FOTOCNH VARCHAR(500),
  FOTOMOTORISTA VARCHAR(500),
  STATUSAPROVACAO CHAR(1) DEFAULT 'P', -- P=Pendente, A=Aprovado, R=Rejeitado
  DHCADASTRO DATETIME DEFAULT GETDATE(),
  DHAPROVACAO DATETIME,
  FGACTIVE CHAR(1) DEFAULT 'S',
  DHMAINTENANCE DATETIME,
  SGUSER VARCHAR(50),
  SERVERORIG VARCHAR(50),
  
  CONSTRAINT FK_MOTORISTA_CADASTRO FOREIGN KEY (CDCADASTRO) 
    REFERENCES CADASTROGERAL(CDCADASTRO)
);
```

#### **1.2. Tabela MOTORISTA_VEICULO**
```sql
CREATE TABLE MOTORISTA_VEICULO (
  IDMOTORISTAVEÍCULO INT IDENTITY(1,1) PRIMARY KEY,
  CDMOTORISTA INT NOT NULL,
  PLACA VARCHAR(10) NOT NULL,
  RENAVAM VARCHAR(11),
  CDTIPOEQUIPAMENTO SMALLINT,
  MARCAMODELO VARCHAR(100),
  ANOFABRICACAO INT,
  ANOMODELO INT,
  CAPACIDADEKG DECIMAL(10,2),
  CAPACIDADEM3 DECIMAL(10,3),
  FOTOVEICULO VARCHAR(500),
  FOTOCRLV VARCHAR(500),
  FGPRINCIPAL CHAR(1) DEFAULT 'N',
  FGACTIVE CHAR(1) DEFAULT 'S',
  DHMAINTENANCE DATETIME DEFAULT GETDATE(),
  SGUSER VARCHAR(50),
  SERVERORIG VARCHAR(50),
  
  CONSTRAINT FK_MOTORISTA_VEICULO FOREIGN KEY (CDMOTORISTA) 
    REFERENCES MOTORISTA(CDMOTORISTA),
  CONSTRAINT FK_VEICULO_TIPO FOREIGN KEY (CDTIPOEQUIPAMENTO) 
    REFERENCES TIPOEQUIPAMENTO(CDTIPOEQUIPAMENTO)
);
```

#### **1.3. Tabela VIAGEM_RASTREAMENTO**
```sql
CREATE TABLE VIAGEM_RASTREAMENTO (
  IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  CDMOTORISTA INT NOT NULL,
  LATITUDE DECIMAL(10,8) NOT NULL,
  LONGITUDE DECIMAL(11,8) NOT NULL,
  VELOCIDADE DECIMAL(5,2),
  PRECISAO INT,
  DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),
  TIPO CHAR(1) DEFAULT 'A', -- A=Automático, M=Manual
  ENVIADO CHAR(1) DEFAULT 'S', -- S=Sim, N=Aguardando (offline)
  
  CONSTRAINT FK_RASTREAMENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM),
  CONSTRAINT FK_RASTREAMENTO_MOTORISTA FOREIGN KEY (CDMOTORISTA) 
    REFERENCES MOTORISTA(CDMOTORISTA)
);

CREATE INDEX IDX_RASTREAMENTO_VIAGEM ON VIAGEM_RASTREAMENTO(IDVIAGEM);
CREATE INDEX IDX_RASTREAMENTO_DATA ON VIAGEM_RASTREAMENTO(DHREGISTRO);
```

#### **1.4. Tabela VIAGEM_EVENTO**
```sql
CREATE TABLE VIAGEM_EVENTO (
  IDEVENTO INT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  CDMOTORISTA INT NOT NULL,
  TIPO CHAR(1) NOT NULL, -- P=Parada, A=Abastecimento, R=Refeição, M=Mecânico, I=Imprevisto
  DESCRICAO VARCHAR(500),
  LATITUDE DECIMAL(10,8),
  LONGITUDE DECIMAL(11,8),
  DHEVENTO DATETIME NOT NULL DEFAULT GETDATE(),
  FOTO VARCHAR(500),
  ENVIADO CHAR(1) DEFAULT 'S',
  DHMAINTENANCE DATETIME,
  SGUSER VARCHAR(50),
  
  CONSTRAINT FK_EVENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM),
  CONSTRAINT FK_EVENTO_MOTORISTA FOREIGN KEY (CDMOTORISTA) 
    REFERENCES MOTORISTA(CDMOTORISTA)
);
```

#### **1.5. Tabela VIAGEM_CHAT**
```sql
CREATE TABLE VIAGEM_CHAT (
  IDMENSAGEM INT IDENTITY(1,1) PRIMARY KEY,
  IDVIAGEM DECIMAL(15,0) NOT NULL,
  CDMOTORISTA INT,
  CDUSUARIO INT,
  TIPO CHAR(1) NOT NULL, -- M=Motorista, O=Operador
  MENSAGEM VARCHAR(1000) NOT NULL,
  DHENVIO DATETIME NOT NULL DEFAULT GETDATE(),
  DHLEITURA DATETIME,
  ENVIADO CHAR(1) DEFAULT 'S',
  
  CONSTRAINT FK_CHAT_VIAGEM FOREIGN KEY (IDVIAGEM) 
    REFERENCES VIAGEMMESTRE(IDVIAGEM),
  CONSTRAINT FK_CHAT_MOTORISTA FOREIGN KEY (CDMOTORISTA) 
    REFERENCES MOTORISTA(CDMOTORISTA),
  CONSTRAINT FK_CHAT_USUARIO FOREIGN KEY (CDUSUARIO) 
    REFERENCES USUARIO(CDUSUARIO)
);
```

### **DIA 2: Scripts de Criação**

**📋 AÇÃO:** 
1. Criar arquivo: `backend/scripts/criar_tabelas_app_motorista.sql`
2. Colocar todos os CREATEs acima
3. Executar no banco
4. Testar com INSERT/SELECT básico

---

## 🔧 FASE 2: BACKEND - APIs (Semana 1 - Dias 3-5)

### **DIA 3: Estrutura Base**

#### **2.1. Controller: motorista.controller.js**
```
backend/controllers/motorista.controller.js
```

**Funções:**
- `cadastrar` - Cadastrar novo motorista
- `login` - Login do motorista
- `buscarPorId` - Ver perfil
- `atualizar` - Editar perfil
- `uploadFoto` - Upload de foto
- `aprovar` - Aprovar motorista (admin)

#### **2.2. Routes: motorista.routes.js**
```
backend/routes/motorista.routes.js
```

**Rotas:**
```javascript
POST   /api/motorista/cadastro
POST   /api/motorista/login
GET    /api/motorista/perfil/:id
PUT    /api/motorista/perfil/:id
POST   /api/motorista/upload-foto
PUT    /api/motorista/aprovar/:id
```

### **DIA 4: APIs de Viagem**

#### **2.3. Controller: motorista-viagem.controller.js**
```
backend/controllers/motorista-viagem.controller.js
```

**Funções:**
- `listarCargasDisponiveis` - Cargas disponíveis
- `aceitarCarga` - Aceitar viagem
- `minhasViagens` - Viagens do motorista
- `iniciarViagem` - Iniciar viagem
- `finalizarViagem` - Finalizar viagem

#### **2.4. Routes: motorista-viagem.routes.js**
```javascript
GET    /api/motorista/cargas-disponiveis
POST   /api/motorista/aceitar-carga/:id
GET    /api/motorista/minhas-viagens/:idmotorista
POST   /api/motorista/iniciar-viagem/:id
POST   /api/motorista/finalizar-viagem/:id
```

### **DIA 5: APIs de Rastreamento**

#### **2.5. Controller: motorista-rastreamento.controller.js**

**Funções:**
- `registrarPosicao` - Salvar GPS
- `registrarEvento` - Salvar evento
- `uploadFotoEvento` - Upload de foto
- `listarRastreamento` - Ver histórico

#### **2.6. Routes:**
```javascript
POST   /api/motorista/posicao
POST   /api/motorista/evento
POST   /api/motorista/upload-foto-evento
GET    /api/motorista/rota/:idviagem
```

**📋 AÇÃO:** 
1. Criar arquivos vazios
2. Implementar auth/cadastro primeiro
3. Testar com Postman/Insomnia

---

## 📱 FASE 3: FRONTEND PWA - Estrutura (Semana 2 - Dias 6-8)

### **DIA 6: Estrutura de Pastas**

```
backend/public/app-motorista/
├── index.html              (Login)
├── dashboard.html          (Home)
├── css/
│   └── style.css
├── js/
│   ├── app.js             (Principal)
│   ├── auth.js            (Login/Cadastro)
│   ├── viagens.js         (Viagens)
│   ├── gps.js             (GPS)
│   ├── offline.js         (Offline/Sync)
│   └── ocr.js             (OCR)
├── pages/
│   ├── cadastro.html      (Cadastro)
│   ├── cargas.html        (Cargas disponíveis)
│   ├── minhas-viagens.html
│   ├── viagem-detalhes.html
│   └── perfil.html
├── manifest.json          (PWA Config)
└── sw.js                  (Service Worker)
```

### **DIA 7: PWA Básico**

#### **3.1. manifest.json**
```json
{
  "name": "DivulgaCarga Motorista",
  "short_name": "Motorista",
  "description": "App para motoristas - DivulgaCarga",
  "start_url": "/app-motorista/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#667eea",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/img/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/img/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

#### **3.2. Service Worker (sw.js)**
```javascript
const CACHE_NAME = 'motorista-v1';
const urlsToCache = [
  '/app-motorista/',
  '/app-motorista/index.html',
  '/app-motorista/css/style.css',
  '/app-motorista/js/app.js'
];

// Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Fetch
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
```

### **DIA 8: Layout Básico**

#### **3.3. index.html (Login)**
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <title>Login - Motorista</title>
  <link rel="manifest" href="manifest.json">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <img src="/img/logo7.png" alt="Logo">
      <h1>DivulgaCarga</h1>
      <p>Motorista</p>
    </div>
    
    <form id="loginForm">
      <input type="text" id="cpf" placeholder="CPF" required>
      <input type="password" id="senha" placeholder="Senha" required>
      <button type="submit">Entrar</button>
    </form>
    
    <a href="pages/cadastro.html">Cadastrar-se</a>
  </div>
  
  <script src="js/auth.js"></script>
</body>
</html>
```

**📋 AÇÃO:**
1. Criar estrutura de pastas
2. Criar arquivos básicos
3. Testar PWA instalável

---

## 🎨 FASE 4: MVP - Login e Cadastro (Semana 2-3 - Dias 9-12)

### **DIA 9-10: Tela de Login**

**Implementar:**
- ✅ Formulário de login (CPF + senha)
- ✅ Validação de CPF
- ✅ Chamar API `/api/motorista/login`
- ✅ Salvar token no localStorage
- ✅ Redirecionar para dashboard

### **DIA 11-12: Tela de Cadastro**

**Implementar:**
- ✅ Formulário de cadastro básico
- ✅ Validações (CPF, email, telefone)
- ✅ **OCR da CNH** (foto + extração)
- ✅ Preview dos dados extraídos
- ✅ Salvar cadastro
- ✅ Aguardar aprovação

**📋 AÇÃO:**
1. Integrar Tesseract.js (OCR básico)
2. Testar com CNH real
3. Validar dados extraídos

---

## 📦 FASE 5: Cargas Disponíveis (Semana 3 - Dias 13-15)

### **DIA 13-14: Lista de Cargas**

**Implementar:**
- ✅ Buscar cargas da API
- ✅ Mostrar cards de cargas
- ✅ Filtros (região, tipo, valor)
- ✅ Detalhes da carga (modal)

### **DIA 15: Aceitar Carga**

**Implementar:**
- ✅ Botão "Aceitar Carga"
- ✅ Confirmação
- ✅ Enviar para API
- ✅ Feedback visual
- ✅ Adicionar a "Minhas Viagens"

---

## 🚚 FASE 6: Rastreamento Básico (Semana 4 - Dias 16-20)

### **DIA 16-17: GPS Manual**

**Implementar:**
- ✅ Solicitar permissão de GPS
- ✅ Capturar posição atual
- ✅ Botão "Enviar Posição"
- ✅ Salvar no servidor
- ✅ Mostrar no mapa (Leaflet)

### **DIA 18-19: GPS Automático**

**Implementar:**
- ✅ Intervalo automático (5 min)
- ✅ Funcionar em background
- ✅ Indicador visual (enviando...)
- ✅ Histórico de posições

### **DIA 20: Offline + Fila**

**Implementar:**
- ✅ IndexedDB para fila
- ✅ Salvar GPS offline
- ✅ Sincronizar quando online
- ✅ Indicador de status

---

## 📸 FASE 7: Eventos e Fotos (Semana 5 - Dias 21-25)

### **DIA 21-22: Registrar Eventos**

**Implementar:**
- ✅ Tipos de evento (parada, abastecimento, etc)
- ✅ Formulário de evento
- ✅ Capturar GPS do evento
- ✅ Salvar offline/online

### **DIA 23-25: Fotos**

**Implementar:**
- ✅ Tirar foto (câmera)
- ✅ Compressão de foto
- ✅ Upload de foto
- ✅ Foto da carga (coleta/entrega)
- ✅ Armazenar offline

---

## 💬 FASE 8: Chat e Notificações (Semana 6 - Dias 26-30)

### **DIA 26-28: Chat**

**Implementar:**
- ✅ Lista de mensagens
- ✅ Enviar mensagem
- ✅ Receber mensagem (polling)
- ✅ Notificação de nova mensagem

### **DIA 29-30: Notificações Push**

**Implementar:**
- ✅ Solicitar permissão
- ✅ Configurar Firebase (ou outro)
- ✅ Enviar notificação (backend)
- ✅ Mostrar notificação

---

## 🎯 CRONOGRAMA RESUMIDO

| Semana | Fase | Entregas |
|--------|------|----------|
| **1** | Banco + Backend | Tabelas + APIs básicas |
| **2** | Frontend + Login | PWA + Login/Cadastro |
| **3** | Cargas | Listar + Aceitar cargas |
| **4** | GPS | Rastreamento + Offline |
| **5** | Eventos | Fotos + Eventos |
| **6** | Chat | Mensagens + Notificações |

**TOTAL: 6 semanas (1.5 mês) para MVP funcional!**

---

## ✅ CHECKLIST PARA COMEÇAR HOJE

### **AGORA (30 minutos):**
- [ ] Preencher `APP_MOTORISTA_DECISOES.md`
- [ ] Confirmar decisões principais

### **HOJE (2-3 horas):**
- [ ] Criar script SQL das tabelas
- [ ] Executar no banco
- [ ] Testar com INSERTs básicos
- [ ] Criar estrutura de pastas backend
- [ ] Criar arquivo `motorista.controller.js` (vazio)
- [ ] Criar arquivo `motorista.routes.js` (vazio)

### **AMANHÃ:**
- [ ] Implementar cadastro de motorista (backend)
- [ ] Implementar login de motorista (backend)
- [ ] Testar APIs com Postman

### **DIA 3:**
- [ ] Criar estrutura PWA
- [ ] Criar tela de login (frontend)
- [ ] Integrar login com backend
- [ ] Testar login funcionando

---

## 🚀 VAMOS COMEÇAR?

**Pronto para começar a implementar?**

Escolha:
1. **Opção A:** Começar pelo banco de dados (criar tabelas)
2. **Opção B:** Começar pelo backend (APIs)
3. **Opção C:** Começar pelo frontend (PWA)
4. **Opção D:** Fazer tudo junto (minha recomendação!)

**👉 Me diga qual opção você prefere e vamos começar!** 🎉

