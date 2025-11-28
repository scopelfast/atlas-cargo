# 📘 Manual Técnico Completo - DivulgaCarga

**Sistema:** DivulgaCarga  
**Versão:** 1.1.0  
**Data:** 2025-11-24  
**Status:** ✅ Produção

---

## 📋 Índice

1. [Arquitetura do Sistema](#arquitetura-do-sistema)
2. [Estrutura de Diretórios](#estrutura-de-diretórios)
3. [Tecnologias Utilizadas](#tecnologias-utilizadas)
4. [Configuração do Ambiente](#configuração-do-ambiente)
5. [Banco de Dados](#banco-de-dados)
6. [APIs e Endpoints](#apis-e-endpoints)
7. [Autenticação e Segurança](#autenticação-e-segurança)
8. [Frontend](#frontend)
9. [Integrações](#integrações)
10. [Deploy e Produção](#deploy-e-produção)
11. [Troubleshooting Técnico](#troubleshooting-técnico)

---

## 🏗️ Arquitetura do Sistema

### Visão Geral

O DivulgaCarga é uma aplicação web full-stack com arquitetura cliente-servidor:

```
┌─────────────────┐
│   Frontend      │  HTML5, CSS3, JavaScript (Vanilla)
│   (Cliente)     │  GridEditor, Chart.js, Leaflet
└────────┬────────┘
         │ HTTP/REST
         │
┌────────▼────────┐
│   Backend       │  Node.js + Express.js
│   (Servidor)    │  JWT, bcrypt, mssql
└────────┬────────┘
         │
┌────────▼────────┐
│   SQL Server    │  Microsoft SQL Server
│   (Banco)       │  Tabelas relacionais
└─────────────────┘
```

### Camadas

1. **Camada de Apresentação (Frontend)**
   - Interface HTML/CSS/JavaScript
   - Comunicação via fetch API
   - Gerenciamento de estado local

2. **Camada de Aplicação (Backend)**
   - Controllers (lógica de negócio)
   - Routes (roteamento)
   - Middleware (autenticação, validação)

3. **Camada de Dados (Database)**
   - SQL Server
   - Stored Procedures
   - Views e Triggers

---

## 📁 Estrutura de Diretórios

```
SysScopel/
├── backend/
│   ├── config/
│   │   └── db.js                    # Configuração do banco de dados
│   ├── controllers/                 # Lógica de negócio
│   │   ├── auth.controller.js
│   │   ├── cadastrogeral.controller.js
│   │   ├── relatorio-convocacoes.controller.js
│   │   ├── usuario.controller.js
│   │   └── viagemmestre.controller.js
│   ├── middleware/
│   │   └── auth.middleware.js       # Autenticação JWT
│   ├── models/
│   │   └── user.model.js            # Modelos de dados
│   ├── routes/                      # Rotas da API
│   │   ├── auth.routes.js
│   │   ├── cadastrogeral.routes.js
│   │   ├── equipamento.routes.js
│   │   ├── menu.routes.js
│   │   ├── relatorio-convocacoes.routes.js
│   │   ├── usuario.routes.js
│   │   └── viagemmestre.routes.js
│   ├── public/                      # Frontend (arquivos estáticos)
│   │   ├── css/                     # Estilos globais
│   │   ├── js/                      # JavaScript global
│   │   ├── modulos/                 # Módulos do sistema
│   │   │   ├── gerenciar-viagens/
│   │   │   │   ├── index.html
│   │   │   │   ├── js/
│   │   │   │   │   └── script.js
│   │   │   │   └── sql/
│   │   │   │       └── init.sql
│   │   │   └── [outros módulos...]
│   │   ├── dashboard.html
│   │   ├── index.html
│   │   └── convocacao.html          # Página pública
│   ├── scripts/                     # Scripts SQL
│   ├── utils/                       # Utilitários
│   ├── app.js                       # Configuração Express
│   ├── server.js                    # Entry point
│   └── package.json                 # Dependências
├── README.md                        # Documentação principal
├── CHANGELOG.md                     # Histórico de mudanças
└── migrate_integra_to_divulgacarga_completo.sql
```

---

## 🛠️ Tecnologias Utilizadas

### Backend

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **Node.js** | 14+ | Runtime JavaScript |
| **Express.js** | 4.21.1 | Framework web |
| **mssql** | 10.0.1 | Driver SQL Server |
| **jsonwebtoken** | 9.0.2 | Autenticação JWT |
| **bcrypt** | 5.1.1 | Hash de senhas |
| **dotenv** | 16.4.5 | Variáveis de ambiente |
| **cors** | 2.8.5 | CORS |
| **helmet** | 8.0.0 | Segurança HTTP |
| **compression** | 1.8.1 | Compressão de respostas |

### Frontend

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **HTML5** | - | Estrutura |
| **CSS3** | - | Estilos |
| **JavaScript (ES6+)** | - | Lógica cliente |
| **GridEditor** | - | Tabelas editáveis |
| **Chart.js** | - | Gráficos |
| **Leaflet** | - | Mapas |

### Banco de Dados

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **Microsoft SQL Server** | - | Banco de dados relacional |

---

## ⚙️ Configuração do Ambiente

### Variáveis de Ambiente

Arquivo: `backend/.env`

```env
# Banco de Dados
DB_SERVER=localhost
DB_DATABASE=DivulgaCarga
DB_USER=sa
DB_PASSWORD=sua-senha
DB_PORT=1433

# Autenticação
JWT_SECRET=sua-chave-secreta-jwt-minimo-32-caracteres

# URL Pública (para links de convocação)
PUBLIC_URL=https://seu-dominio.com.br
# ou para desenvolvimento:
# PUBLIC_URL=http://localhost:3000

# Porta do Servidor
PORT=3000

# Ambiente
NODE_ENV=development
# ou
# NODE_ENV=production
```

### Instalação

```bash
# 1. Instalar dependências
cd backend
npm install

# 2. Configurar .env
cp .env.example .env
# Editar .env com suas configurações

# 3. Iniciar servidor
npm run dev
```

---

## 🗄️ Banco de Dados

### Tabelas Principais

#### VIAGEMMESTRE
Armazena informações das viagens.

**Campos principais:**
- `IDVIAGEM` (PK): Identificador único
- `CDTIPOVIAGEM`: Tipo da viagem
- `CDSITUACAOVIAGEM`: Situação atual
- `CDCLASSEFROTA`: Classe de veículo necessário
- `CDCONTRATADOR`: Cliente contratador
- `CDROTEIRO`: Roteiro associado
- `DTINICIO`, `DTFIM`: Datas de início e fim
- `VLRFRETE`: Valor do frete
- `PESO`: Peso em toneladas
- `CUBAGEM`: Cubagem em m³
- `DISTANCIA`: Distância em km
- `CDORIGEM_ESTADO`, `CDORIGEM_CIDADE`: Origem
- `CDDESTINO_ESTADO`, `CDDESTINO_CIDADE`: Destino
- `FGEXIGERASTREADO`: Exige veículo rastreado (S/N)
- `FGSITUACAO`: Situação (A/I)

#### VIAGEMVEICULO
Relaciona veículos com viagens (N:N).

**Campos principais:**
- `IDVIAGEM` (FK): ID da viagem
- `IDEQUIPAMENTO` (FK): ID do equipamento
- `REFEQUIPAMENTO`: Placa do veículo
- `TPEQUIPAMENTO`: Tipo de equipamento

#### VIAGEMMOTORISTA
Relaciona motoristas com viagens (N:N).

**Campos principais:**
- `IDVIAGEM` (FK): ID da viagem
- `CDMOTORISTA` (FK): Código do motorista

#### CONVOCACAO
Armazena convocações enviadas aos motoristas.

**Campos principais:**
- `IDCONVOCACAO` (PK): Identificador único
- `IDVIAGEM` (FK): ID da viagem
- `CDMOTORISTA` (FK): Código do motorista
- `STATUS`: Status (PENDENTE, ACEITA, RECUSADA, CONFIRMADA)
- `LINK`: Link único da convocação
- `TEXTO`: Texto da mensagem enviada
- `NRCELULAR`: Número do celular
- `DHACESSO`: Data/hora de acesso ao link
- `DHRESPOSTA`: Data/hora de resposta

### Relacionamentos

```
VIAGEMMESTRE (1) ──< (N) VIAGEMVEICULO
VIAGEMMESTRE (1) ──< (N) VIAGEMMOTORISTA
VIAGEMMESTRE (1) ──< (N) CONVOCACAO
CADASTROGERAL (1) ──< (N) VIAGEMMOTORISTA
EQUIPAMENTO (1) ──< (N) VIAGEMVEICULO
```

---

## 🔌 APIs e Endpoints

### Autenticação

#### POST `/api/auth/login`
Login do usuário.

**Request:**
```json
{
  "email": "usuario@email.com",
  "password": "senha123"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "login": "usuario",
    "email": "usuario@email.com"
  }
}
```

### Viagens

#### GET `/api/viagens`
Lista viagens com filtros.

**Query Parameters:**
- `idViagem`: ID específico
- `tipoViagem`: Tipo
- `situacaoViagem`: Situação
- `classeFrota`: Classe de frota
- `contratador`: Contratador
- `origemEstado`, `origemCidade`: Origem
- `destinoEstado`, `destinoCidade`: Destino
- `dataInicio`, `dataFim`: Período
- `exigeRastreado`: S/N/Todos
- `motoristaConfirmado`: S/N/Todos

#### GET `/api/viagens/:id`
Obtém uma viagem específica.

#### POST `/api/viagens`
Cria uma nova viagem.

#### PUT `/api/viagens/:id`
Atualiza uma viagem.

#### DELETE `/api/viagens/:id`
Exclui/desativa uma viagem.

### Veículos da Viagem

#### GET `/api/viagens/:id/veiculo`
Retorna array de veículos cadastrados para a viagem.

**Response (200):**
```json
[
  {
    "IDVIAGEM": 82077,
    "IDEQUIPAMENTO": 24,
    "REFEQUIPAMENTO": "AXE9596",
    "TPEQUIPAMENTO": "04",
    "DSEQUIPAMENTO": "AXE9596",
    "TIPO_NOME": "3/4s",
    "MARCA_NOME": "FORD",
    "MODELO_NOME": "F 816 S CARGO",
    "ANOFABRICA": 2013
  }
]
```

#### POST `/api/viagens/:id/veiculo`
Salva veículo (INSERT ou UPDATE conforme existência).

**Request:**
```json
{
  "idequipamento": 24,
  "refequipamento": "AXE9596",
  "tpequipamento": "04"
}
```

#### DELETE `/api/viagens/:id/veiculo/:idequipamento`
Remove veículo específico da viagem.

### Motoristas da Viagem

#### GET `/api/viagens/:id/motorista`
Retorna array de motoristas cadastrados para a viagem.

**Response (200):**
```json
[
  {
    "IDVIAGEM": 82077,
    "CDMOTORISTA": 9630,
    "CDCADASTROGERAL": 9630,
    "RZSOCIAL": "Roberto Antunes Vieira",
    "CGCCPF": "34872760972",
    "NRCELULAR": "41999655633",
    "CIDADE_NOME": "Fazenda Rio Grande",
    "CIDADE_ESTADO": "PR"
  }
]
```

#### POST `/api/viagens/:id/motorista`
Salva motorista (INSERT ou UPDATE conforme existência).

**Request:**
```json
{
  "cdmotorista": 9630
}
```

#### DELETE `/api/viagens/:id/motorista/:cdmotorista`
Remove motorista específico da viagem.

### Convocações

#### GET `/api/convocacoes`
Lista convocações com filtros.

#### POST `/api/convocacoes`
Cria convocações.

#### POST `/api/public/convocacao/:id`
Obtém convocação (público, sem autenticação).

#### POST `/api/public/convocacao/:id/resposta`
Responde convocação (público, sem autenticação).

---

## 🔒 Autenticação e Segurança

### JWT (JSON Web Tokens)

O sistema usa JWT para autenticação.

**Fluxo:**
1. Usuário faz login
2. Backend valida credenciais
3. Backend gera token JWT
4. Frontend armazena token (localStorage)
5. Frontend envia token em requisições (header `Authorization`)
6. Backend valida token em cada requisição

### Hash de Senhas

Senhas são hasheadas com `bcrypt` (salt rounds: 10).

**Compatibilidade:**
- Suporta senhas hasheadas (bcrypt)
- Suporta senhas em texto puro (legado, para migração)

### Middleware de Autenticação

#### `getUsuarioLogado`
- Tenta decodificar token
- Não bloqueia se token inválido (autenticação opcional)
- Adiciona `req.user` se token válido

#### `requireAuth` (não usado atualmente)
- Bloqueia requisição se token inválido
- Retorna 401 se não autenticado

### Segurança HTTP

- **Helmet**: Headers de segurança
- **CORS**: Controle de origem
- **Compression**: Compressão de respostas
- **Validação SQL**: Bloqueio de comandos perigosos no init.sql

---

## 🎨 Frontend

### Estrutura

O frontend é uma Single Page Application (SPA) com múltiplos módulos.

**Carregamento:**
1. `index.html` → Login
2. `dashboard.html` → Dashboard principal
3. Módulos carregados dinamicamente via `fetch`

### Gerenciamento de Estado

- **LocalStorage**: Token JWT, preferências do usuário
- **Variáveis globais**: Estado do módulo atual
- **DOM**: Estado visual da interface

### Módulos

Cada módulo possui:
- `index.html`: Estrutura HTML
- `js/script.js`: Lógica JavaScript
- `sql/init.sql` (opcional): SQL executado ao carregar

### Bibliotecas Externas

- **GridEditor**: Tabelas editáveis inline
- **Chart.js**: Gráficos de estatísticas
- **Leaflet**: Mapas interativos

---

## 🔗 Integrações

### WhatsApp

**Integração via Links:**
- Link direto: `https://wa.me/55{celular}`
- Abre WhatsApp Web/App
- Não requer API oficial

**Uso:**
- Botão WhatsApp na lista de motoristas
- Envio de convocações via WhatsApp

### ngrok

**Uso:**
- Expor servidor local para internet
- Testes em dispositivos móveis
- Links públicos para convocações

**Script:**
- `iniciar-ngrok.bat`: Inicia ngrok automaticamente
- Atualiza `PUBLIC_URL` no `.env`

---

## 🚀 Deploy e Produção

### Checklist de Deploy

- [ ] Configurar variáveis de ambiente
- [ ] Configurar `PUBLIC_URL` (domínio público)
- [ ] Configurar banco de dados (produção)
- [ ] Configurar `JWT_SECRET` (mínimo 32 caracteres)
- [ ] Testar conexão com banco
- [ ] Testar autenticação
- [ ] Testar links de convocação
- [ ] Configurar HTTPS (recomendado)
- [ ] Configurar firewall
- [ ] Backup do banco de dados

### Variáveis de Ambiente (Produção)

```env
NODE_ENV=production
DB_SERVER=servidor-producao
DB_DATABASE=DivulgaCarga
DB_USER=usuario-producao
DB_PASSWORD=senha-forte
JWT_SECRET=chave-secreta-forte-minimo-32-caracteres
PUBLIC_URL=https://divulgacarga.com.br
PORT=3000
```

### Process Manager

Recomendado usar PM2 ou similar:

```bash
npm install -g pm2
pm2 start backend/server.js --name divulgacarga
pm2 save
pm2 startup
```

---

## 🔍 Troubleshooting Técnico

### Erro: "Cannot find module 'bcrypt'"

**Causa:** Dependências não instaladas.

**Solução:**
```bash
cd backend
npm install
```

### Erro: "Connection refused" (SQL Server)

**Causa:** SQL Server não está rodando ou credenciais incorretas.

**Solução:**
1. Verificar se SQL Server está rodando
2. Verificar credenciais no `.env`
3. Verificar porta (padrão: 1433)
4. Verificar firewall

### Erro: "JWT_SECRET muito curto"

**Causa:** `JWT_SECRET` deve ter no mínimo 32 caracteres.

**Solução:**
```env
JWT_SECRET=chave-secreta-com-pelo-menos-32-caracteres-123456
```

### Erro: "RequestError: The parameter name X has already been declared"

**Causa:** Reutilização de objeto `sql.Request` em transação.

**Solução:** Criar novo `sql.Request` para cada operação dentro de uma transação.

### Performance: Queries Lentas

**Solução:**
1. Adicionar índices nas colunas de busca
2. Otimizar queries com JOINs
3. Usar stored procedures para operações complexas
4. Implementar cache quando apropriado

---

## 📚 Documentação Relacionada

- [README Principal](../README.md)
- [Documentação do Módulo Gerenciar Viagens](DOCUMENTACAO_MODULO_GERENCIAR_VIAGENS.md)
- [Sistema de Convocações](DOCUMENTACAO_SISTEMA_CONVOCACOES.md)
- [init.sql](DOCUMENTACAO_INIT_SQL.md)
- [Índice de Documentação](INDICE_DOCUMENTACAO.md)

---

**Mantido por:** Equipe DivulgaCarga  
**Última atualização:** 2025-11-24  
**Versão:** 1.1.0

