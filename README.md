# 🚚 DivulgaCarga - Sistema de Gestão de Transportes

**Versão:** 1.2.0  
**Data:** 2025-11-28  
**Status:** ✅ Produção

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Instalação e Configuração](#instalação-e-configuração)
3. [Estrutura do Projeto](#estrutura-do-projeto)
4. [Módulos do Sistema](#módulos-do-sistema)
5. [Documentação](#documentação)
6. [Guia de Início Rápido](#guia-de-início-rápido)
7. [Configuração de Ambiente](#configuração-de-ambiente)
8. [APIs e Integrações](#apis-e-integrações)
9. [Troubleshooting](#troubleshooting)
10. [Suporte](#suporte)

---

## 🎯 Visão Geral

O **DivulgaCarga** é um sistema completo de gestão de transportes desenvolvido para otimizar o processo de contratação de motoristas, gerenciamento de viagens e controle de operações logísticas.

### Principais Funcionalidades

- ✅ **Gerenciamento de Viagens**: Criação, edição e acompanhamento de viagens
- ✅ **Múltiplos Veículos e Motoristas**: Suporte a vários veículos e motoristas por viagem
- ✅ **Sistema de Convocações**: Convite automático de motoristas via WhatsApp
- ✅ **Motivo de Recusa**: Registro do motivo quando motorista recusa convocação
- ✅ **Reativação de Convocações**: Sistema para reativar convocações confirmadas
- ✅ **Histórico de Reabertura**: Rastreamento completo de reaberturas de convocações
- ✅ **Cadastro Geral**: Gestão completa de motoristas, transportadores e contratadores
- ✅ **Roteiros**: Gerenciamento de rotas e pontos de parada
- ✅ **Relatórios**: Análise de convocações e estatísticas
- ✅ **Integração WhatsApp**: Envio automático de convites e contato direto com motoristas
- ✅ **Visualização de Dados**: Modais estilizados para visualização completa de informações

### Tecnologias Utilizadas

- **Backend**: Node.js + Express.js
- **Banco de Dados**: Microsoft SQL Server
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Autenticação**: JWT (JSON Web Tokens)
- **Bibliotecas**: Chart.js, Leaflet (mapas), GridEditor

---

## 🚀 Instalação e Configuração

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

4. **Inicie o servidor**
   ```bash
   npm run dev
   ```

5. **Acesse o sistema**
   - Abra o navegador em: `http://localhost:3000`
   - Faça login com suas credenciais

---

## 📁 Estrutura do Projeto

```
SysScopel/
├── backend/
│   ├── config/              # Configurações do banco de dados
│   ├── controllers/         # Lógica de negócio
│   ├── middleware/          # Middlewares (autenticação, etc)
│   ├── models/              # Modelos de dados
│   ├── routes/              # Rotas da API
│   ├── public/              # Arquivos estáticos (frontend)
│   │   ├── modulos/         # Módulos do sistema
│   │   ├── js/              # JavaScript global
│   │   └── css/             # Estilos globais
│   ├── scripts/             # Scripts SQL e utilitários
│   ├── server.js            # Arquivo principal do servidor
│   └── app.js               # Configuração do Express
│
└── migrate_integra_to_divulgacarga_completo.sql  # Script de migração
```

---

## 📦 Módulos do Sistema

### Módulos Principais

| Módulo | Descrição | Status |
|--------|-----------|--------|
| **Gerenciar Viagens** | Gestão completa de viagens e sistema de convocações | ✅ Completo |
| **Relatório de Convocações** | Análise e relatórios de convocações | ✅ Completo |
| **Cadastro Geral** | Gestão de motoristas, transportadores e contratadores | ✅ Completo |
| **Gerenciar Roteiros** | Criação e edição de rotas | ✅ Completo |
| **Gerenciar Cidades** | Cadastro de cidades e estados | ✅ Completo |
| **Gerenciar Classes de Frota** | Tipos de veículos | ✅ Completo |
| **Gerenciar Equipamentos** | Gestão de equipamentos | ✅ Completo |
| **Gerenciar Empresas** | Cadastro de empresas | ✅ Completo |
| **Gerenciar Filiais** | Gestão de filiais | ✅ Completo |

### Módulos de Suporte

- Gerenciar Grupos
- Gerenciar Marcas
- Gerenciar Modelos de Equipamento
- Gerenciar Tipos de Equipamento
- Gerenciar Tipos de Viagem
- Gerenciar Situações de Viagem

---

## 📚 Documentação

> 📖 **Índice Completo:** Veja [INDICE_DOCUMENTACAO.md](backend/INDICE_DOCUMENTACAO.md) para lista completa de toda documentação

### Documentação Completa

- **[Sistema de Convocações](backend/DOCUMENTACAO_SISTEMA_CONVOCACOES.md)** ✅
  - Documentação completa do sistema de convocações
  - Fluxos, regras de negócio, troubleshooting

- **[init.sql (Gerenciar Viagens)](backend/DOCUMENTACAO_INIT_SQL.md)** ✅
  - Documentação sobre execução automática de SQL
  - Segurança, exemplos, troubleshooting

### Guias Específicos

- **[Configuração de URL Pública](backend/README_URL_PUBLICA.md)** ✅
  - Como configurar URLs públicas para links de convocação
  - Configuração de ngrok e IP local

- **[Guia ngrok Rápido](backend/README_NGROK_RAPIDO.md)** ✅
  - Guia rápido para usar ngrok

- **[Guia Completo ngrok](backend/GUIA_NGROK.md)** ✅
  - Documentação completa sobre ngrok

- **[Solução Links WhatsApp](backend/SOLUCAO_LINKS_WHATSAPP.md)** ✅
  - Solução para problemas com links do WhatsApp

- **[Guia Simulação Mobile](backend/GUIA_SIMULACAO_MOBILE.md)** ✅
  - Como testar o sistema em dispositivos móveis

### Documentação Técnica

- **[Manual Técnico Completo](backend/MANUAL_TECNICO_COMPLETO.md)** ✅ NOVO
  - Arquitetura do sistema
  - Estrutura de diretórios
  - Tecnologias e configuração
  - APIs e endpoints
  - Deploy e produção
  - Troubleshooting técnico

- **[Estrutura de Documentação](backend/ESTRUTURA_DOCUMENTACAO.md)** ✅
  - Padrões e estrutura para documentação de módulos

- **[Análise do Projeto](backend/ANALISE_PROJETO.md)**
  - Análise técnica do projeto

- **[Otimizações Aplicadas](backend/RESUMO_OTIMIZACOES_APLICADAS.md)**
  - Resumo de otimizações implementadas

---

## 🎓 Guia de Início Rápido

### 1. Primeiro Acesso

1. Acesse `http://localhost:3000`
2. Faça login com suas credenciais
3. Explore o menu lateral para conhecer os módulos

### 2. Criar uma Viagem

1. Acesse **"3.0.Viagem" → "3.4.Gerenciar Viagens"**
2. Clique em **"Novo Registro"**
3. Preencha os dados da viagem
4. Salve

### 3. Enviar Convocações

1. Na aba **"Compatíveis"**, selecione uma viagem
2. Clique em **"Buscar Motoristas Compatíveis"**
3. Selecione os motoristas desejados
4. Clique em **"📢 Preparar Anúncio"**
5. Revise o anúncio e clique em **"📱 Enviar via WhatsApp"**

### 4. Visualizar Relatórios

1. Acesse **"3.5.Relatório Convocações"**
2. Aplique os filtros desejados
3. Visualize estatísticas e gráficos

---

## ⚙️ Configuração de Ambiente

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
JWT_SECRET=sua-chave-secreta-jwt

# URL Pública (para links de convocação)
PUBLIC_URL=https://seu-dominio.com.br

# Porta do Servidor
PORT=3000
```

### Configuração de URL Pública

Para que os links de convocação funcionem corretamente no WhatsApp, configure `PUBLIC_URL`:

- **Produção**: Use seu domínio público
- **Desenvolvimento**: Use ngrok ou IP local (mesma rede Wi-Fi)

Veja mais detalhes em: [README_URL_PUBLICA.md](backend/README_URL_PUBLICA.md)

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
- `POST /api/convocacoes/:id/confirmar` - Confirmar convocação
- `POST /api/convocacoes/:id/reativar` - Reativar convocação confirmada
- `GET /api/convocacoes/:id/historico-reabertura` - Buscar histórico de reabertura
- `GET /api/motivos-recusa-combo` - Listar motivos de recusa
- `GET /api/motivos-reabertura-combo` - Listar motivos de reabertura
- `POST /api/public/convocacao/:id` - Obter convocação (público)
- `POST /api/public/convocacao/:id/resposta` - Responder convocação (público)

#### Relatórios
- `GET /api/relatorio-convocacoes/relatorio` - Dados do relatório
- `GET /api/relatorio-convocacoes/estatisticas` - Estatísticas

### Integração WhatsApp

O sistema gera links únicos para cada convocação e permite envio via WhatsApp Web/App. Veja mais em: [DOCUMENTACAO_SISTEMA_CONVOCACOES.md](backend/DOCUMENTACAO_SISTEMA_CONVOCACOES.md)

---

## 🔧 Troubleshooting

### Problemas Comuns

#### Erro de Conexão com Banco de Dados

**Sintoma**: `Erro ao conectar ao SQL Server`

**Solução**:
1. Verifique se o SQL Server está rodando
2. Confirme as credenciais no `.env`
3. Verifique se a porta 1433 está aberta
4. Teste a conexão manualmente

#### Links do WhatsApp Não Funcionam

**Sintoma**: Links não abrem no celular

**Solução**:
1. Configure `PUBLIC_URL` no `.env`
2. Use URL pública (HTTPS) para links clicáveis
3. Se usar IP local, siga instruções de copiar/colar
4. Veja: [SOLUCAO_LINKS_WHATSAPP.md](backend/SOLUCAO_LINKS_WHATSAPP.md)

#### Erro ao Executar init.sql

**Sintoma**: `init.sql executado com erro`

**Solução**:
1. Verifique se o arquivo existe: `backend/public/modulos/gerenciar-viagens/sql/init.sql`
2. Verifique permissões no banco de dados
3. Revise os comandos SQL no arquivo
4. Verifique logs do servidor

#### Módulo Não Carrega

**Sintoma**: Tela em branco ao abrir módulo

**Solução**:
1. Verifique console do navegador (F12)
2. Verifique se o arquivo HTML existe
3. Verifique se o JavaScript está carregando
4. Limpe cache do navegador

---

## 📞 Suporte

### Documentação

- Consulte a documentação específica de cada módulo
- Veja a seção de Troubleshooting acima
- Revise os logs do servidor

### Contato

Para suporte técnico ou dúvidas:
- Consulte a documentação completa
- Verifique os logs do sistema
- Entre em contato com a equipe de desenvolvimento

---

## 📝 Changelog

### Versão 1.2.0 (2025-11-28)

#### ✅ Funcionalidades
- **Motivo de Recusa**: Sistema completo para registrar motivo quando motorista recusa convocação
  - Tabela `MOTIVORECUSA` com motivos pré-definidos
  - Campo `CDMOTIVORECUSA` na tabela `CONVOCACAO`
  - Modal de seleção de motivo ao recusar
  - Exibição do motivo no grid de convocações e relatórios
  - Filtro por motivo de recusa no relatório
- **Reativação de Convocações**: Sistema para reativar convocações confirmadas
  - Botão "🔄 Reativar" para convocações CONFIRMADA
  - Modal de seleção de motivo de reabertura
  - Reativação automática de convocações ACEITA_DESCARTADA da mesma viagem
  - Abertura automática de modal de envio de mensagens após reativação
  - Filtro inteligente de motoristas para reenvio (exclui recusados e desistentes)
- **Histórico de Reabertura**: Rastreamento completo de reaberturas
  - Tabela `HISTORICOREABERTURA` para registro histórico
  - Tabela `MOTIVOREABERTURA` com motivos pré-definidos
  - Exibição do histórico no grid de convocações
  - Indicador visual quando há histórico de reabertura
- **Indicador de Motorista Acionado**: Visualização clara de motoristas já convocados
  - Bolinha verde/vermelha antes do nome do motorista
  - Legenda explicativa
  - Filtro automático na busca de motoristas compatíveis
- **Mensagem de Contato com Contratador**: Orientação ao motorista ao aceitar
  - Exibição de nome e telefone do contratador
  - Link direto para WhatsApp do contratador
  - Mensagem orientativa para próximos passos

#### 🔧 Melhorias
- **Layout do Grid de Convocações**: Reorganização e otimização de colunas
  - Ordem reorganizada: ID → Viagem → Rota → Status → Motorista → Datas → Ações
  - Larguras otimizadas para melhor visualização
  - Colunas de datas mais compactas (70px)
  - Coluna de ações ajustada para 3 ícones
- **Mensagens Padronizadas**: Todas as mensagens de convocação seguem o mesmo padrão
  - Formatação completa com emojis
  - Dados completos da viagem
  - Personalização por motorista
  - Verificações de ngrok/local IP
- **Relatório de Convocações**: Melhorias visuais
  - Remoção do ícone de celular (apenas número formatado)
  - Remoção da coluna Frete
  - Layout mais limpo e profissional
- **Filtros**: Melhorias em filtros
  - Filtro de motivo de recusa no relatório
  - Preenchimento padrão de "Situação Viagem" com "Preparação"
  - Botão "Limpar" corrigido para resetar todos os campos

#### 🐛 Correções
- Correção da exibição de histórico de reabertura (mostra motivo correto)
- Correção do botão "Limpar" em filtros
- Correção de formatação de mensagens de reativação
- Correção de lógica de filtro de motoristas para reenvio

### Versão 1.1.0 (2025-11-24)

#### ✅ Funcionalidades
- **Múltiplos veículos por viagem**: Sistema permite cadastrar vários veículos para uma mesma viagem
- **Múltiplos motoristas por viagem**: Sistema permite cadastrar vários motoristas para uma mesma viagem
- **Modais de dados completos**: Visualização profissional de dados detalhados
  - Design moderno com header gradiente
  - Tabela organizada (labels à direita, valores em negrito à esquerda)
  - Altura otimizada (95vh) para evitar scroll
  - Fechamento com ESC ou clique fora
- **Botão WhatsApp**: Contato direto com motoristas via WhatsApp
  - Aparece apenas se motorista tiver celular válido
  - Abre conversa em nova aba
- **Contador de registros**: Exibe quantidade de convocações na aba Convocações
- **Listas de veículos e motoristas**: Cards organizados com informações resumidas

#### 🔧 Melhorias
- **Correção de cache/refresh**: Implementado em todos os módulos
  - Limpeza automática de formulários ao trocar de registro
  - Atualização automática de listas após operações
  - Prevenção de dados persistentes entre registros
- **Melhorias visuais**: 
  - Modais com design profissional
  - Cards organizados e informativos
  - Espaçamento otimizado
- **Labels atualizados**: Nomes mais claros e objetivos

#### 🐛 Correções
- Correção de cache de dados entre viagens
- Correção de refresh de listas após remoção
- Correção de formulários persistentes em 15 módulos
- Remoção de logs desnecessários do console
- Correção de alinhamento em modais

### Versão 1.0.0 (2025-11-23)

#### ✅ Funcionalidades
- Sistema completo de convocações
- Integração WhatsApp
- Relatório de convocações
- Gerenciamento de viagens
- Sistema de autenticação JWT
- Múltiplos módulos de gestão

#### 🔧 Melhorias
- Proteção contra execução múltipla do init.sql
- Prevenção de mudanças automáticas de aba
- Otimização de queries SQL
- Melhor tratamento de erros

#### 🐛 Correções
- Correção de bugs em filtros
- Correção de inconsistências em DHACESSO/DHRESPOSTA
- Correção de problemas com links WhatsApp
- Correção de ordenação em tabelas

---

## 📄 Licença

Este projeto é proprietário e confidencial.

---

## 👥 Equipe

**Desenvolvido por:** Equipe DivulgaCarga  
**Mantido por:** Equipe de Desenvolvimento  
**Última atualização:** 2025-11-23

---

## 🔗 Links Úteis

- [📚 Índice Completo de Documentação](backend/INDICE_DOCUMENTACAO.md)
- [Documentação Sistema de Convocações](backend/DOCUMENTACAO_SISTEMA_CONVOCACOES.md)
- [Documentação init.sql](backend/DOCUMENTACAO_INIT_SQL.md)
- [Guia de Configuração de URL Pública](backend/README_URL_PUBLICA.md)
- [Guia ngrok](backend/GUIA_NGROK.md)
- [Estrutura de Documentação](backend/ESTRUTURA_DOCUMENTACAO.md)
- [CHANGELOG](CHANGELOG.md)

---

**Versão do Documento:** 1.2.0  
**Última Revisão:** 2025-11-28  
**Documentação Completa:** ✅ Todas as funcionalidades documentadas

