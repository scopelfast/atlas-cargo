# 📋 Resumo Completo do Projeto - DivulgaCarga

**Versão:** 1.3.0  
**Data:** 2025-12-01  
**Status:** ✅ Produção

---

## 🎯 Visão Geral

O **DivulgaCarga** é um sistema completo de gestão de transportes desenvolvido para otimizar o processo de contratação de motoristas, gerenciamento de viagens e controle de operações logísticas. O sistema possui integração completa com webhook Meta (DeskRio) para envio automático de convocações.

---

## 🚀 Principais Funcionalidades

### 1. Gerenciamento de Viagens
- Criação, edição e acompanhamento de viagens
- Suporte a múltiplos veículos e motoristas por viagem
- Sistema de filtros avançados
- Grid editor para edição rápida
- Visualização de rotas em mapa (Leaflet)

### 2. Sistema de Convocações
- Convite de motoristas via WhatsApp (envio manual)
- **Integração Meta (DeskRio)**: Envio automático via webhook
- Sistema de status (PENDENTE, ACEITA, RECUSADA, CONFIRMADA, ACEITA_DESCARTADA)
- Motivo de recusa registrado
- Reativação de convocações confirmadas
- Histórico completo de reaberturas

### 3. Integração Meta (DeskRio) - NOVO
- **Envio para Webhook**: Envio individual de convocações para `https://ia.riochat.com.br/webhook/aviso-rota-integra`
  - Intervalo de 1 segundo entre cada envio
  - Verificação de `DHENVIOMETA` para evitar duplicatas
  - Payload completo com 11 campos: ID, TIPO, CLASSE, ROTA, CARREGAMENTO, DESCARGA, CONTRATADOR, FRETE, PESO, CUBAGEM, DETALHES
  - Formatação numérica para FRETE, PESO e CUBAGEM (sem unidades)
- **Aba Integração Meta**: Visualização de logs em tempo real
  - Contadores: Total de envios, Sucessos, Erros
  - Logs persistidos no banco de dados
  - Exportação e limpeza de logs
- **Callback do Meta**: Endpoint para receber retornos do DeskRio
  - Atualização automática de STATUS, DHRESPOSTA, LATITUDE, LONGITUDE, CDMOTIVORECUSA
  - Lógica inteligente de determinação de STATUS
  - Campo SGUSER atualizado para 'DESKRIO'

### 4. Relatórios
- Análise completa de convocações
- Filtros avançados (data, status, viagem, motorista, motivo de recusa)
- Gráficos de estatísticas (Chart.js)
- Exportação para CSV
- Layout padronizado com "Gerenciar Convocações"

### 5. Cadastro Geral
- Gestão completa de motoristas, transportadores e contratadores
- Busca avançada por CPF, CNPJ, nome ou código
- Integração com WhatsApp para contato direto

### 6. Outros Módulos
- Gerenciar Roteiros
- Gerenciar Cidades e Estados
- Gerenciar Classes de Frota
- Gerenciar Equipamentos
- Gerenciar Empresas e Filiais
- E mais 10 módulos de suporte

---

## 🏗️ Arquitetura Técnica

### Backend
- **Framework**: Node.js + Express.js
- **Banco de Dados**: Microsoft SQL Server
- **Autenticação**: JWT (JSON Web Tokens)
- **Segurança**: Helmet, CORS, Compression

### Frontend
- **Tecnologia**: HTML5, CSS3, JavaScript (Vanilla)
- **Bibliotecas**:
  - Chart.js (gráficos)
  - Leaflet (mapas)
  - GridEditor (edição de tabelas)
  - Boxicons (ícones)

### Estrutura do Projeto
```
SysScopel/
├── backend/
│   ├── config/              # Configurações do banco de dados
│   ├── controllers/         # Lógica de negócio
│   ├── middleware/          # Middlewares (autenticação)
│   ├── models/              # Modelos de dados
│   ├── routes/              # Rotas da API
│   ├── public/              # Arquivos estáticos (frontend)
│   │   ├── modulos/         # Módulos do sistema
│   │   ├── js/              # JavaScript global
│   │   └── css/             # Estilos globais
│   ├── scripts/             # Scripts SQL e utilitários
│   ├── server.js            # Arquivo principal do servidor
│   └── app.js               # Configuração do Express
└── Documentação/            # Arquivos de documentação
```

---

## 🔌 APIs e Integrações

### Endpoints Principais

#### Autenticação
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/verify` - Verificar token

#### Viagens
- `GET /api/viagens` - Listar viagens
- `GET /api/viagens/:id` - Obter viagem
- `POST /api/viagens` - Criar viagem
- `PUT /api/viagens/:id` - Atualizar viagem
- `DELETE /api/viagens/:id` - Excluir/desativar viagem

#### Convocações
- `GET /api/convocacoes` - Listar convocações
- `POST /api/convocacoes` - Criar convocações
- `PUT /api/convocacoes/:id` - Atualizar convocação
- `PUT /api/convocacoes/:id/atualizar-envio-meta` - Atualizar data de envio para Meta
- `POST /api/convocacoes/:id/confirmar` - Confirmar convocação
- `POST /api/convocacoes/:id/reativar` - Reativar convocação confirmada
- `GET /api/convocacoes/:id/historico-reabertura` - Buscar histórico de reabertura
- `GET /api/motivos-recusa-combo` - Listar motivos de recusa
- `GET /api/motivos-reabertura-combo` - Listar motivos de reabertura
- `POST /api/public/convocacao/:id` - Obter convocação (público)
- `POST /api/public/convocacao/:id/resposta` - Responder convocação (público)

#### Integração Meta (Webhook)
- `POST /api/webhook-meta-callback` - Receber callback do Meta/DeskRio
- `POST /api/logs-webhook-meta` - Salvar log de integração Meta
- `GET /api/logs-webhook-meta` - Listar logs de integração Meta

#### Relatórios
- `GET /api/relatorio-convocacoes/relatorio` - Dados do relatório
- `GET /api/relatorio-convocacoes/estatisticas` - Estatísticas

---

## 📊 Estrutura do Banco de Dados

### Tabelas Principais

#### CONVOCACAO
- `IDCONVOCACAO` (PK)
- `IDVIAGEM` (FK)
- `CDCADASTRO_MOTORISTA` (FK)
- `STATUS` (PENDENTE, ACEITA, RECUSADA, CONFIRMADA, ACEITA_DESCARTADA)
- `NRCELULAR` - Número do celular formatado
- `TXTCONVOCACAO` - Texto completo da mensagem
- `LINKCONVOCACAO` - Link completo da convocação
- `DHCONVOCACAO` - Data/hora da convocação
- `DHRESPOSTA` - Data/hora da resposta
- `DHACESSO` - Data/hora do acesso ao link
- `DHENVIOMETA` - Data/hora do envio para Meta
- `LATITUDE` - Latitude do motorista (do callback)
- `LONGITUDE` - Longitude do motorista (do callback)
- `CDMOTIVORECUSA` (FK) - Motivo de recusa
- `CDMOTIVOREABERTURA` (FK) - Motivo de reabertura

#### LOGSWEBHOOKMETA (NOVO)
- `IDLOG` (PK)
- `IDCONVOCACAO` (FK)
- `TIPO` (envio, resposta, sucesso, erro, erro_conexao)
- `TITULO` - Título do log
- `MENSAGEM` - Mensagem do log
- `DETALHES` - Detalhes em JSON
- `STATUS_HTTP` - Status HTTP da resposta
- `TEMPO_RESPOSTA` - Tempo de resposta em ms
- `DHLOG` - Data/hora do log
- `DHMAINTENANCE` - Data/hora de manutenção
- `SGUSER` - Usuário do sistema
- `SERVERORIG` - Servidor de origem

#### HISTORICOREABERTURA
- `IDHISTORICO` (PK)
- `IDCONVOCACAO` (FK)
- `IDVIAGEM`
- `CDCADASTRO_MOTORISTA` (FK)
- `STATUS_ANTERIOR` - Status antes da reabertura
- `CDMOTIVOREABERTURA` (FK)
- `DHREABERTURA` - Data/hora da reabertura

#### MOTIVORECUSA
- `CDMOTIVORECUSA` (PK)
- `DSMOTIVO` - Descrição do motivo

#### MOTIVOREABERTURA
- `CDMOTIVOREABERTURA` (PK)
- `DSMOTIVO` - Descrição do motivo

---

## 🔄 Fluxo de Integração Meta

### 1. Disparo de Convocações

1. Usuário seleciona motoristas compatíveis na aba "Compatíveis"
2. Clica em "Disparar Convocações"
3. Sistema cria registros na tabela `CONVOCACAO` (status PENDENTE)
4. Sistema gera `NRCELULAR`, `TXTCONVOCACAO` e `LINKCONVOCACAO` para cada convocação
5. Sistema atualiza convocações via `PUT /api/convocacoes/:id`
6. Sistema verifica se `DHENVIOMETA` está vazio/null
7. Para cada convocação com `DHENVIOMETA` vazio:
   - Envia POST para `https://ia.riochat.com.br/webhook/aviso-rota-integra`
   - Payload: IDCONVOCACAO, NRCELULAR, LINKCONVOCACAO + 11 campos (ID, TIPO, CLASSE, ROTA, CARREGAMENTO, DESCARGA, CONTRATADOR, FRETE, PESO, CUBAGEM, DETALHES)
   - Aguarda 1 segundo antes do próximo envio
   - Salva log de envio no banco
8. Após resposta bem-sucedida:
   - Atualiza `DHENVIOMETA` com data/hora atual
   - Salva log de resposta e sucesso no banco
9. Em caso de erro:
   - Salva log de erro no banco
   - Continua processando próximas convocações

### 2. Callback do Meta

1. DeskRio processa a convocação enviada
2. Quando houver dados de retorno, DeskRio faz POST para:
   - Local: `http://localhost:3000/api/webhook-meta-callback`
   - Produção: `http://cargas.integrabrasil.com:8083/api/webhook-meta-callback`
3. Endpoint recebe JSON:
   ```json
   {
     "IDCONVOCACAO": 161,
     "LATITUDE": -25.123456789012345,
     "LONGITUDE": -49.987654321098765,
     "CDMOTIVORECUSA": 1,
     "STATUS": "RECUSADA"
   }
   ```
4. Sistema atualiza tabela `CONVOCACAO`:
   - `STATUS`: Determinado logicamente ou pelo campo enviado
   - `DHRESPOSTA`: Sempre atualizado para `GETDATE()`
   - `LATITUDE`: Se fornecido
   - `LONGITUDE`: Se fornecido
   - `CDMOTIVORECUSA`: Se fornecido
   - `DHMAINTENANCE`: Sempre atualizado para `GETDATE()`
   - `SGUSER`: Sempre atualizado para `'DESKRIO'`

### 3. Lógica de STATUS no Callback

- Se `CDMOTIVORECUSA` fornecido → STATUS = `'RECUSADA'`
- Se `LATITUDE` e `LONGITUDE` fornecidos (sem `CDMOTIVORECUSA`) e STATUS atual = `'PENDENTE'` → STATUS = `'ACEITA'`
- Se `STATUS` fornecido explicitamente → Usa o valor fornecido
- Caso contrário → STATUS não é alterado

---

## 📚 Documentação Completa

### Documentação Principal
- **[README.md](README.md)** - Documentação principal do projeto
- **[CHANGELOG.md](CHANGELOG.md)** - Histórico de mudanças
- **[RESUMO_COMPLETO_PROJETO.md](RESUMO_COMPLETO_PROJETO.md)** - Este arquivo

### Documentação de Integração Meta
- **[ESTRUTURA_WEBHOOK_AVISO_ROTA_COMPLETA.md](ESTRUTURA_WEBHOOK_AVISO_ROTA_COMPLETA.md)** - Estrutura completa do payload de envio
- **[WEBHOOK_CALLBACK_META.md](WEBHOOK_CALLBACK_META.md)** - Documentação do endpoint de callback

### Documentação Técnica
- **[backend/DOCUMENTACAO_SISTEMA_CONVOCACOES.md](backend/DOCUMENTACAO_SISTEMA_CONVOCACOES.md)** - Sistema de convocações completo
- **[backend/MANUAL_TECNICO_COMPLETO.md](backend/MANUAL_TECNICO_COMPLETO.md)** - Manual técnico completo
- **[backend/INDICE_DOCUMENTACAO.md](backend/INDICE_DOCUMENTACAO.md)** - Índice completo de documentação

### Scripts SQL
- **[backend/scripts/criar_tabela_logs_webhook_meta.sql](backend/scripts/criar_tabela_logs_webhook_meta.sql)** - Script para criar tabela de logs

---

## 🛠️ Instalação e Configuração

### Pré-requisitos
- Node.js (versão 14 ou superior)
- Microsoft SQL Server
- npm ou yarn

### Passo a Passo

1. **Clone o repositório**
   ```bash
   git clone [url-do-repositorio]
   cd SysScopel
   ```

2. **Instale as dependências**
   ```bash
   cd backend
   npm install
   ```

3. **Configure o arquivo `.env`**
   ```env
   DB_SERVER=seu-servidor-sql
   DB_DATABASE=nome-do-banco
   DB_USER=usuario
   DB_PASSWORD=senha
   DB_PORT=1433
   JWT_SECRET=sua-chave-secreta-jwt
   PUBLIC_URL=https://seu-dominio.com.br
   PORT=3000
   ```

4. **Execute o script SQL para criar a tabela de logs**
   ```sql
   -- Execute o script: backend/scripts/criar_tabela_logs_webhook_meta.sql
   ```

5. **Inicie o servidor**
   ```bash
   npm run dev
   ```

6. **Acesse o sistema**
   - Abra o navegador em: `http://localhost:3000`
   - Faça login com suas credenciais

---

## 📈 Versões e Changelog

### Versão 1.3.0 (2025-12-01) - ATUAL
- ✅ Integração Meta (DeskRio) completa
- ✅ Aba Integração Meta com logs em tempo real
- ✅ Sistema de logs persistidos
- ✅ Callback do Meta para receber retornos
- ✅ Padronização de layout entre módulos

### Versão 1.2.0 (2025-11-28)
- ✅ Sistema de motivo de recusa
- ✅ Reativação de convocações
- ✅ Histórico de reabertura
- ✅ Indicador de motorista acionado

### Versão 1.1.0 (2025-11-24)
- ✅ Múltiplos veículos e motoristas por viagem
- ✅ Modais de dados completos
- ✅ Correções de cache/refresh

### Versão 1.0.0 (2025-11-23)
- ✅ Sistema completo de convocações
- ✅ Integração WhatsApp
- ✅ Relatório de convocações
- ✅ Gerenciamento de viagens

---

## 🔐 Segurança

- Autenticação JWT
- Proteção contra SQL Injection
- Validação de comandos SQL perigosos
- Headers de segurança (Helmet)
- CORS configurado
- Validações em todas as rotas críticas

---

## 📞 Suporte

### Documentação
- Consulte a documentação específica de cada módulo
- Veja a seção de Troubleshooting no README
- Revise os logs do servidor

### Contato
Para suporte técnico ou dúvidas:
- Consulte a documentação completa
- Verifique os logs do sistema
- Entre em contato com a equipe de desenvolvimento

---

## 📝 Licença

Este projeto é proprietário e confidencial.

---

## 👥 Equipe

**Desenvolvido por:** Equipe DivulgaCarga  
**Mantido por:** Equipe de Desenvolvimento  
**Última atualização:** 2025-12-01

---

**Versão do Documento:** 1.3.0  
**Última Revisão:** 2025-12-01  
**Status:** ✅ Completo e Atualizado

