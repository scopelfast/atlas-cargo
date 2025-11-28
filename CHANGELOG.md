# 📋 Changelog - DivulgaCarga

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.2.0] - 2025-11-28

### ✅ Adicionado

#### Sistema de Motivo de Recusa
- **Tabela MOTIVORECUSA**: Cadastro de motivos pré-definidos de recusa
  - Motivos padrão: Destino, Prazo de Pagamento, Valor do Frete, Peso da Carga, Disponibilidade
  - Campo `CDMOTIVORECUSA` na tabela `CONVOCACAO`
  - Foreign Key para integridade referencial
- **Modal de Motivo de Recusa**: Ao recusar convocação, motorista deve informar motivo
  - Select dropdown com motivos cadastrados
  - Validação obrigatória
  - Exibição do motivo no grid de convocações
  - Exibição do motivo no relatório de convocações
- **Filtro por Motivo de Recusa**: No relatório de convocações
  - Select dropdown com todos os motivos
  - Filtro aplicado na query SQL
  - Exibição na coluna "Motivo Recusa" da tabela

#### Sistema de Reativação de Convocações
- **Tabela MOTIVOREABERTURA**: Cadastro de motivos de reabertura
  - Motivos padrão: Motorista Desistiu da Carga, Necessidade de Mais Convocações
  - Campo `CDMOTIVOREABERTURA` na tabela `CONVOCACAO`
- **Tabela HISTORICOREABERTURA**: Registro histórico de reaberturas
  - Campos: IDCONVOCACAO, IDVIAGEM, CDCADASTRO_MOTORISTA, STATUS_ANTERIOR, CDMOTIVOREABERTURA, DHREABERTURA, etc.
  - Foreign Keys para CONVOCACAO, MOTIVOREABERTURA e CADASTROGERAL
  - Índices para performance
- **Botão Reativar**: Aparece apenas para convocações CONFIRMADA
  - Modal de confirmação com seleção de motivo
  - Reativação automática de convocações ACEITA_DESCARTADA da mesma viagem
  - Registro no histórico antes de alterar status
- **Modal de Envio Após Reativação**: Abre automaticamente após reativar
  - Filtro inteligente de motoristas:
    - ✅ Inclui: ACEITA_DESCARTADA, PENDENTE, CONFIRMADA (exceto se motivo foi "Motorista Desistiu")
    - ❌ Exclui: RECUSADA, CONFIRMADA reativada (se motivo foi "Motorista Desistiu")
  - Mensagem formatada completa (mesmo padrão do envio normal)
  - Links WhatsApp prontos para envio

#### Indicador de Motorista Acionado
- **Bolinha Verde/Vermelha**: Antes do nome do motorista na lista de compatíveis
  - 🟢 Verde: Motorista já foi convocado para esta viagem
  - 🔴 Vermelho: Motorista ainda não foi convocado
  - Legenda explicativa na interface
- **Campo FOI_ACIONADO**: Retornado na API de motoristas compatíveis
  - Query otimizada com EXISTS
  - Atualização em tempo real

#### Mensagem de Contato com Contratador
- **Ao Aceitar Convocação**: Motorista recebe orientação para contatar contratador
  - Nome do contratador
  - Telefone do contratador
  - Link direto para WhatsApp do contratador
  - Mensagem orientativa para próximos passos

#### Melhorias Visuais
- **Grid de Convocações**: Reorganização completa
  - Ordem: ID → Viagem → Rota → Status → Motorista → Convocação → Acesso → Resposta → Ações
  - Larguras otimizadas: Rota (100px), Datas (70px), Ações (110px)
  - Cabeçalhos simplificados: "Convocação", "Acesso", "Resposta" (sem "Data")
- **Relatório de Convocações**: Limpeza visual
  - Remoção do ícone 📱 antes do celular
  - Remoção da coluna Frete
  - Layout mais profissional

### 🔧 Modificado

#### Sistema de Convocações
- **responderConvocacao**: Agora aceita `motivoRecusa` e salva na tabela
- **listarConvocacoes**: JOIN com MOTIVORECUSA para retornar DSMOTIVO
- **buscarMotoristasCompatíveis**: Adicionado campo FOI_ACIONADO
- **buscarConvocacaoPublica**: Melhorado para buscar contratador (ativo ou qualquer)
- **reativarConvocacao**: Nova função completa para reativação
  - Transação SQL para garantir atomicidade
  - Registro no histórico antes de alterar status
  - Reativação automática de ACEITA_DESCARTADA
  - Retorna motivo e idViagem para frontend
- **buscarHistoricoReabertura**: Nova função para buscar histórico
- **listarMotivosRecusa**: Nova função para combo de motivos
- **listarMotivosReabertura**: Nova função para combo de motivos

#### Frontend - Gerenciar Viagens
- **renderizarConvocacoes**: 
  - Exibe motivo de recusa quando status é RECUSADA
  - Exibe histórico de reabertura com motivo
  - Botão "🔄 Reativar" apenas para CONFIRMADA
  - Indicador visual de histórico
- **renderizarMotoristasCompatíveis**: 
  - Bolinha verde/vermelha antes do nome
  - Legenda explicativa
- **reativarConvocacao**: 
  - Modal de confirmação com motivo
  - Busca todas convocações da viagem
  - Filtra motoristas para reenvio
  - Abre modal de links WhatsApp automaticamente
  - Gera mensagem formatada completa
- **Filtros**: 
  - Preenchimento padrão de "Situação Viagem" com "Preparação"
  - Botão "Limpar" corrigido para resetar todos os campos

#### Frontend - Relatório de Convocações
- **Filtro de Motivo de Recusa**: Novo filtro adicionado
- **Tabela**: Removido ícone de celular e coluna Frete
- **criarLinkWhatsApp**: Removido ícone, apenas número formatado

#### Frontend - Convocação Pública
- **Modal de Recusa**: Adicionado select de motivo
  - Validação obrigatória
  - Carregamento dinâmico de motivos
  - Estilo profissional
- **Mensagem de Aceitação**: Adicionada informação do contratador
  - Nome, telefone e link WhatsApp
  - Mensagem orientativa
- **Mensagem ACEITA_DESCARTADA**: Melhorada
  - Emoji profissional (ℹ️ ao invés de 💔)
  - Título atualizado: "Convocação Não Selecionada"

### 🐛 Corrigido

#### Bugs Críticos
- ✅ Correção da exibição de histórico de reabertura (mostrava sempre mesmo texto)
- ✅ Correção do botão "Limpar" em filtros (não resetava "Situação Viagem")
- ✅ Correção de mensagem de reativação (agora usa formato completo padronizado)
- ✅ Correção de lógica de filtro de motoristas para reenvio após reativação

#### Bugs Menores
- ✅ Remoção de logs excessivos do WaboxApp
- ✅ Correção de busca de contratador (fallback para inativos)
- ✅ Melhoria de CSS de modais (botões sempre visíveis)
- ✅ Correção de formatação de mensagens

### 📚 Documentação
- ✅ Atualizado README com novas funcionalidades
- ✅ Atualizado CHANGELOG com versão 1.2.0
- ✅ Criado .gitignore completo
- ✅ Documentação de scripts SQL atualizada

---

## [1.1.0] - 2025-11-24

### ✅ Adicionado

#### Gerenciar Viagens - Múltiplos Veículos e Motoristas
- **Suporte a múltiplos veículos por viagem**: Sistema agora permite cadastrar vários veículos para uma mesma viagem
- **Suporte a múltiplos motoristas por viagem**: Sistema agora permite cadastrar vários motoristas para uma mesma viagem
- **Lista de veículos cadastrados**: Exibição em cards com informações resumidas (Placa, Descrição, Tipo, Marca, Modelo, Ano)
- **Lista de motoristas cadastrados**: Exibição em cards com informações resumidas (Nome, Código, CPF/CNPJ, Cidade)
- **Botão "Ver Dados"**: Modal estilizado para visualização completa de dados do veículo ou motorista
  - Design moderno com header gradiente roxo
  - Tabela organizada com labels à direita e valores em negrito à esquerda
  - Altura otimizada (95vh) para evitar barras de rolagem
  - Espaçamento compacto entre linhas (6px)
  - Fechamento com ESC ou clique fora
- **Botão WhatsApp**: Integração direta com WhatsApp para contato com motoristas (na lista de motoristas)
  - Aparece apenas se motorista tiver celular válido cadastrado
  - Link formatado: `https://wa.me/55{celular}`
  - Abre em nova aba
- **Botão "Remover"**: Remoção individual de veículos ou motoristas de uma viagem
- **Contador de registros**: Exibição da quantidade de convocações listadas na aba Convocações
  - Formato: "X registro(s) encontrado(s)"
  - Atualização automática ao aplicar filtros

#### Melhorias de Interface
- **Modais de dados completos**: Design moderno e profissional para exibição de dados detalhados
  - Layout em tabela com labels alinhados à direita e valores em negrito alinhados à esquerda
  - Altura ajustada para evitar barras de rolagem desnecessárias
  - Espaçamento otimizado entre linhas
- **Cards de listagem**: Visualização clara e organizada de veículos e motoristas cadastrados
- **Mensagens informativas**: Indicadores quando não há veículos ou motoristas cadastrados

#### Backend - APIs
- **GET `/api/viagens/:id/veiculo`**: Retorna array de veículos cadastrados para a viagem
- **POST `/api/viagens/:id/veiculo`**: Salva veículo (INSERT ou UPDATE conforme existência)
- **DELETE `/api/viagens/:id/veiculo/:idequipamento`**: Remove veículo específico da viagem
- **GET `/api/viagens/:id/motorista`**: Retorna array de motoristas cadastrados para a viagem
- **POST `/api/viagens/:id/motorista`**: Salva motorista (INSERT ou UPDATE conforme existência)
- **DELETE `/api/viagens/:id/motorista/:cdmotorista`**: Remove motorista específico da viagem

### 🔧 Modificado

#### Gerenciar Viagens
- **Aba Veículo**: Reformulada para suportar múltiplos veículos
  - Lista de veículos cadastrados no topo
  - Formulário de adição abaixo
  - Busca por Placa ou Código do Equipamento
  - Select dropdown para "Tipo de Equipamento" (mostra código e descrição)
- **Aba Motorista**: Reformulada para suportar múltiplos motoristas
  - Lista de motoristas cadastrados no topo
  - Formulário de adição abaixo
  - Busca por CPF, Nome ou Código
  - Botão WhatsApp individual para cada motorista
- **Labels atualizados**:
  - "Código do Equipamento (IDEQUIPAMENTO)" → "ID do Equipamento"
  - "Tipo de Equipamento (TPEQUIPAMENTO) *" → "Tipo de Equipamento *"
  - "Placa (REFEQUIPAMENTO) *" → "Placa *"
  - "Código (CDCADASTROGERAL)" → "Código"

#### Correções de Cache/Refresh
- **Limpeza de formulários**: Implementado `form.reset()` em todos os módulos ao carregar dados para edição
- **Módulos corrigidos**:
  - Gerenciar Cadastro Geral
  - Gerenciar Equipamentos
  - Gerenciar Roteiros
  - Gerenciar Tipos de Atividade
  - Gerenciar Usuários
  - Gerenciar Classes de Frota
  - Gerenciar Empresas
  - Gerenciar Modelos de Equipamento
  - Gerenciar Grupos
  - Gerenciar Tipos de Viagem
  - Gerenciar Tipos de Equipamento
  - Gerenciar Filiais
  - Gerenciar Marcas
  - Gerenciar Cidades
  - Gerenciar Situações de Viagem
- **Gerenciar Viagens**: Limpeza explícita de formulários ao trocar de viagem

### 🐛 Corrigido

#### Bugs Críticos
- ✅ **Cache de dados**: Correção de problema onde dados de viagem anterior apareciam ao selecionar nova viagem
- ✅ **Refresh de listas**: Correção de problema onde listas não atualizavam após remoção de itens
- ✅ **Formulários persistentes**: Correção de problema onde formulários mantinham dados ao carregar novo registro

#### Bugs Menores
- ✅ Remoção de logs desnecessários do console
- ✅ Melhoria na validação de campos obrigatórios
- ✅ Correção de alinhamento em modais de dados completos

---

## [1.0.0] - 2025-11-23

### ✅ Adicionado

#### Sistema de Convocações
- Sistema completo de convocações de motoristas
- Integração com WhatsApp para envio de convites
- Página pública para motoristas responderem convocações
- Sistema de status (PENDENTE, ACEITA, RECUSADA, CONFIRMADA)
- Prevenção de duplicação de convocações (reutiliza PENDENTE existente)

#### Relatório de Convocações
- Módulo completo de relatórios de convocações
- Filtros avançados (data, status, viagem, motorista, etc)
- Gráficos de estatísticas (Chart.js)
- Exportação para CSV
- Ordenação em colunas
- Navegação para módulo de viagens com filtros pré-preenchidos

#### Gerenciar Viagens
- Sistema completo de gestão de viagens
- Aba de motoristas compatíveis com busca inteligente
- Aba de convocações com gerenciamento completo
- Sistema de filtros avançados
- Grid editor para edição rápida
- Mapa com visualização de rotas (Leaflet)
- Execução automática de init.sql ao carregar módulo

#### Melhorias de Interface
- Ordenação em tabelas (client-side)
- Modal de links WhatsApp para múltiplos envios
- Prevenção de mudanças automáticas de aba
- Melhorias visuais e UX

#### Segurança e Performance
- Proteção contra execução múltipla do init.sql
- Flags de controle para prevenir condições de corrida
- Validação de comandos SQL perigosos
- Melhor tratamento de erros

#### Documentação
- README principal completo
- Documentação completa do sistema de convocações
- Documentação do init.sql
- Guias específicos (ngrok, URL pública, WhatsApp)
- Estrutura de documentação padronizada

### 🔧 Modificado

#### Sistema de Convocações
- Melhorado tratamento de `DHACESSO` e `DHRESPOSTA`
- Corrigida lógica de atualização de convocações existentes
- Melhorado fluxo de envio via WhatsApp
- Adicionado modal para múltiplos envios (evita bloqueio do navegador)

#### Gerenciar Viagens
- Melhorado carregamento de combos e estados
- Corrigido problema de aba voltando para filtros
- Adicionada proteção para manter aba ativa durante edição
- Melhorado tratamento de filtros (limpeza correta)

#### Backend
- Melhorado controller de viagens com validações
- Adicionado endpoint para execução de init.sql
- Melhorado tratamento de erros em todas as rotas
- Otimização de queries SQL

### 🐛 Corrigido

#### Bugs Críticos
- ✅ Correção de bug em filtros (campo ID Viagem não limpava corretamente)
- ✅ Correção de inconsistência em `DHACESSO` e `DHRESPOSTA` para status PENDENTE
- ✅ Correção de problema onde aba voltava automaticamente para filtros
- ✅ Correção de execução múltipla do init.sql
- ✅ Correção de problema com links WhatsApp (bloqueio de múltiplos pop-ups)

#### Bugs Menores
- ✅ Correção de ordenação em tabelas
- ✅ Correção de exibição de dados em relatórios
- ✅ Correção de formatação de datas (sem diferença de fuso)
- ✅ Correção de validações em formulários

### 🔒 Segurança

- Adicionada validação de comandos SQL perigosos no init.sql
- Melhorado tratamento de autenticação
- Adicionadas validações em todas as rotas críticas
- Proteção contra SQL injection

### 📚 Documentação

- Criado README principal completo
- Documentação completa do sistema de convocações
- Documentação do init.sql
- Atualizada estrutura de documentação
- Criado CHANGELOG

---

## [0.9.0] - 2025-11-21

### ✅ Adicionado
- Versão inicial do sistema
- Módulos básicos de gestão
- Sistema de autenticação
- Estrutura base do projeto

---

## Tipos de Mudanças

- **✅ Adicionado**: Novas funcionalidades
- **🔧 Modificado**: Mudanças em funcionalidades existentes
- **🐛 Corrigido**: Correções de bugs
- **🔒 Segurança**: Correções de segurança
- **📚 Documentação**: Mudanças na documentação
- **⚡ Performance**: Melhorias de performance
- **♻️ Refatorado**: Refatoração de código
- **🗑️ Removido**: Funcionalidades removidas

---

**Mantido por:** Equipe DivulgaCarga  
**Última atualização:** 2025-11-28

