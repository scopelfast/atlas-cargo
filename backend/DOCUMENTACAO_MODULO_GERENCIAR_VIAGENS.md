# 📚 Manual do Sistema - Gerenciar Viagens

**Módulo:** Gerenciar Viagens  
**Versão:** 1.1.0  
**Data:** 2025-11-24  
**Status:** ✅ Produção

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Estrutura do Módulo](#estrutura-do-módulo)
3. [Abas e Funcionalidades](#abas-e-funcionalidades)
   - [3.1. Aba Filtros](#31-aba-filtros)
   - [3.2. Aba Grid](#32-aba-grid)
   - [3.3. Aba Dados](#33-aba-dados)
   - [3.4. Aba Mapa](#34-aba-mapa)
   - [3.5. Aba Compatíveis](#35-aba-compatíveis)
   - [3.6. Aba Convocações](#36-aba-convocações)
   - [3.7. Aba Veículo](#37-aba-veículo)
   - [3.8. Aba Motorista](#38-aba-motorista)
4. [Fluxos de Trabalho](#fluxos-de-trabalho)
5. [Campos e Validações](#campos-e-validações)
6. [Regras de Negócio](#regras-de-negócio)
7. [init.sql - Execução Automática](#initsql---execução-automática)
8. [Integrações](#integrações)
9. [Troubleshooting](#troubleshooting)
10. [Glossário](#glossário)

---

## 🎯 Visão Geral

O módulo **Gerenciar Viagens** é o coração do sistema DivulgaCarga, permitindo:

- ✅ Criar, editar e gerenciar viagens
- ✅ Buscar motoristas compatíveis
- ✅ Enviar convocações via WhatsApp
- ✅ Visualizar viagens em grid e mapa
- ✅ Gerenciar convocações e confirmações
- ✅ Aplicar filtros avançados
- ✅ Executar SQL automático ao carregar

### Objetivo Principal

Centralizar todas as operações relacionadas a viagens, desde a criação até a atribuição final ao motorista, proporcionando uma interface completa e intuitiva.

---

## 📑 Estrutura do Módulo

O módulo é organizado em **8 abas principais**:

1. **Filtros** - Busca e filtragem de viagens
2. **Grid** - Visualização em tabela editável
3. **Dados** - Formulário de criação/edição
4. **Mapa** - Visualização geográfica
5. **Compatíveis** - Busca de motoristas compatíveis
6. **Convocações** - Gerenciamento de convocações
7. **Veículo** - Gerenciamento de veículos da viagem (múltiplos)
8. **Motorista** - Gerenciamento de motoristas da viagem (múltiplos)

---

## 🗂️ Abas e Funcionalidades

### 3.1. Aba Filtros

**Localização:** Primeira aba (ativa por padrão)

#### Funcionalidades

- **Busca Avançada**: Múltiplos filtros combinados
- **Aplicar Filtros**: Busca e muda para aba Grid
- **Limpar Filtros**: Remove todos os filtros aplicados

#### Campos Disponíveis

| Campo | Tipo | Descrição |
|-------|------|-----------|
| **ID Viagem** | Número | Busca por ID específico |
| **Tipo Viagem** | Select | Filtra por tipo (Coleta, Entrega, etc) |
| **Situação Viagem** | Select | Filtra por situação (Programada, Preparação, etc) |
| **Classe Frota** | Select | Filtra por classe de veículo |
| **Contratador** | Select | Filtra por contratador |
| **Origem - UF** | Select | Estado de origem |
| **Origem - Cidade** | Texto | Cidade de origem (busca parcial) |
| **Destino - UF** | Select | Estado de destino |
| **Destino - Cidade** | Texto | Cidade de destino (busca parcial) |
| **Roteiro** | Select | Filtra por roteiro específico |
| **Data Início** | Date | Data inicial do período |
| **Data Fim** | Date | Data final do período |
| **Exige Veículo Rastreado** | Select | Sim/Não/Todos |
| **Motorista Confirmado** | Select | Sim/Não/Todos |

#### Como Usar

1. **Preencher filtros desejados**
2. **Clicar em "Aplicar Filtro"**
   - Sistema busca viagens
   - Muda automaticamente para aba Grid
   - Exibe resultados
3. **Para limpar**: Clicar em "Limpar"

#### Observações Importantes

- ⚠️ **Campo "ID Viagem"**: Se preenchido, previne que a aba volte automaticamente para Filtros durante edição
- ✅ **Combinação de filtros**: Todos os filtros preenchidos são aplicados em conjunto (AND)
- ✅ **Campos vazios**: São ignorados na busca

---

### 3.2. Aba Grid

**Localização:** Segunda aba

#### Funcionalidades

- **Visualização em Tabela**: Todas as viagens em formato grid
- **Edição Inline**: Editar diretamente na tabela
- **Ordenação**: Clicar no cabeçalho para ordenar
- **Ações Rápidas**: Editar, Excluir/Desativar
- **Contadores**: Quantidade de convocações, aceites, recusas

#### Colunas Exibidas

| Coluna | Descrição | Editável |
|--------|-----------|----------|
| **ID** | Identificador da viagem | ❌ Não |
| **Situação Viagem** | Status atual | ✅ Sim |
| **Tipo Viagem** | Tipo (Coleta, Entrega, etc) | ❌ Não |
| **Roteiro** | Descrição do roteiro | ❌ Não |
| **Contratador** | Nome do contratador | ❌ Não |
| **Classe Frota** | Classe de veículo | ❌ Não |
| **Data Início** | Data/hora prevista de início | ✅ Sim |
| **Data Fim** | Data/hora prevista de fim | ✅ Sim |
| **📢** | Quantidade de convocações enviadas | ❌ Não |
| **✅** | Quantidade de aceites | ❌ Não |
| **❌** | Quantidade de recusas | ❌ Não |
| **✓** | Tem motorista confirmado (S/N) | ❌ Não |

#### Ações Disponíveis

- **Editar**: Clica na linha ou botão "Editar" → Abre aba Dados
- **Excluir/Desativar**: Botão "Excluir" → Modal de confirmação
  - Se ativa: Desativa
  - Se inativa: Reativa

#### Como Usar

1. **Aplicar filtros** na aba Filtros
2. **Visualizar resultados** na aba Grid
3. **Clicar em uma linha** para editar
4. **Editar inline** campos permitidos
5. **Salvar** automaticamente ao sair do campo

---

### 3.3. Aba Dados

**Localização:** Terceira aba

#### Funcionalidades

- **Criar Nova Viagem**: Formulário completo
- **Editar Viagem Existente**: Carrega dados e permite edição
- **Validações**: Campos obrigatórios e formatos
- **Cálculo Automático**: Distância ao selecionar roteiro

#### Campos do Formulário

##### Informações Básicas

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **ID Viagem** | Número | ✅ Sim | Identificador único |
| **Tipo Viagem** | Select | ✅ Sim | Tipo da viagem |
| **Situação Viagem** | Select | ✅ Sim | Situação atual |
| **Situação** | Select | ✅ Sim | Status (Ativa/Inativa) |
| **Classe Frota** | Select | ✅ Sim | Classe de veículo necessário |
| **Contratador** | Select | ✅ Sim | Cliente contratador |
| **Roteiro** | Select | ⚠️ Condicional | Roteiro (carrega ao selecionar origem/destino) |

##### Datas e Horários

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **Data Início** | DateTime | ✅ Sim | Data/hora prevista de início |
| **Data Fim** | DateTime | ✅ Sim | Data/hora prevista de fim |
| **Data Inclusão** | DateTime | ❌ Não | Data de criação (automático) |

##### Valores e Dimensões

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **Frete** | Decimal | ⚠️ Recomendado | Valor do frete (R$) |
| **Peso** | Decimal | ❌ Não | Peso em toneladas |
| **Cubagem** | Decimal | ❌ Não | Cubagem em m³ |
| **Distância** | Número | ❌ Não | Distância em km (calculado automaticamente) |

##### Localização

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **Origem - Estado** | Select | ✅ Sim | Estado de origem |
| **Origem - Cidade** | Select | ✅ Sim | Cidade de origem |
| **Destino - Estado** | Select | ✅ Sim | Estado de destino |
| **Destino - Cidade** | Select | ✅ Sim | Cidade de destino |

##### Configurações

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **Exige Veículo Rastreado** | Select | ✅ Sim | S/N |
| **Observações** | Textarea | ❌ Não | Observações adicionais |

#### Fluxo de Criação

1. **Clicar em "Novo Registro"**
2. **Preencher campos obrigatórios**
3. **Selecionar Origem e Destino**
   - Sistema carrega cidades automaticamente
   - Sistema carrega roteiros disponíveis
4. **Selecionar Roteiro** (opcional)
   - Sistema preenche distância automaticamente
5. **Preencher valores e observações**
6. **Clicar em "Salvar"**

#### Fluxo de Edição

1. **Selecionar viagem** (Grid ou Filtros)
2. **Clicar em "Editar"** ou na linha
3. **Sistema carrega dados** automaticamente
4. **Aba Dados é ativada**
5. **Editar campos desejados**
6. **Clicar em "Salvar"**

#### Validações

- ✅ **ID Viagem**: Obrigatório, deve ser único
- ✅ **Tipo Viagem**: Obrigatório
- ✅ **Situação Viagem**: Obrigatório
- ✅ **Origem e Destino**: Obrigatórios, devem ser diferentes
- ✅ **Datas**: Data fim deve ser posterior à data início
- ✅ **Classe Frota**: Obrigatório
- ✅ **Contratador**: Obrigatório

---

### 3.4. Aba Mapa

**Localização:** Quarta aba

#### Funcionalidades

- **Visualização Geográfica**: Mapa interativo (Leaflet)
- **Marcadores**: Origem e Destino
- **Linha de Rota**: Conecta origem e destino
- **Zoom Automático**: Ajusta para mostrar toda a rota

#### Como Usar

1. **Selecionar ou criar uma viagem** com origem e destino
2. **Abrir aba Mapa**
3. **Sistema carrega mapa automaticamente**
   - Marca origem (verde)
   - Marca destino (vermelho)
   - Desenha linha de rota
   - Ajusta zoom

#### Observações

- ⚠️ **Requer origem e destino**: Sem esses dados, mapa não carrega
- ✅ **Atualização automática**: Ao editar viagem, mapa atualiza
- ✅ **Responsivo**: Funciona em diferentes tamanhos de tela

---

### 3.5. Aba Compatíveis

**Localização:** Quinta aba

#### Funcionalidades

- **Buscar Viagens Pendentes**: Lista viagens que precisam de motorista
- **Buscar Motoristas Compatíveis**: Encontra motoristas que atendem critérios
- **Preparar Anúncio**: Monta mensagem para WhatsApp
- **Enviar Convocações**: Cria convocações e envia via WhatsApp
- **Disparar Convocações**: Apenas cria registros (sem enviar)

#### Fluxo Completo

##### 1. Carregar Viagens Pendentes

1. **Abrir aba Compatíveis**
2. **Clicar em "Carregar Viagens Pendentes"**
3. **Sistema busca viagens**:
   - Status "Programada" (P) ou "Preparação" (D)
   - Sem convocação ACEITA ou CONFIRMADA
4. **Dropdown é preenchido** com viagens disponíveis

##### 2. Selecionar Viagem

1. **Selecionar viagem** no dropdown
2. **Clicar em "Buscar Motoristas Compatíveis"**
3. **Sistema aplica critérios**:
   - Classe de frota compatível
   - Veículo rastreado (se exigido)
   - Localização (micro-região)
4. **Grid é preenchido** com motoristas compatíveis

##### 3. Selecionar Motoristas

1. **Marcar checkboxes** dos motoristas desejados
2. **Ou usar "Selecionar Todos"**
3. **Visualizar informações**:
   - Nome, ID, Cidade, Micro-região
   - Classe de frota, Transportador
   - Botão WhatsApp (contato direto)

##### 4. Preparar e Enviar

**Opção A: Caminho Completo (Recomendado)**

1. **Clicar em "📢 Preparar Anúncio"**
2. **Visualizar preview** do anúncio no modal
3. **Clicar em "📱 Enviar via WhatsApp"**
4. **Sistema faz tudo automaticamente**:
   - Cria convocações
   - Gera links únicos
   - Salva texto e telefone
   - Abre WhatsApp para cada motorista

**Opção B: Disparo Simples (Apenas Registro)**

1. **Clicar em "Disparar Convocações"**
2. **Sistema cria apenas registros** no banco
3. ⚠️ **Não gera links, não salva texto, não abre WhatsApp**

#### Critérios de Compatibilidade

1. **Classe de Frota**: Motorista deve ter a mesma classe da viagem
2. **Veículo Rastreado**: Se viagem exige, motorista deve ter
3. **Localização**: Motorista da mesma micro-região da origem OU destino

#### Ordenação

- Por Transportador (ascendente)
- Por Classe de Frota (ascendente)

#### Ações Disponíveis

- **📢 Preparar Anúncio**: Abre modal com preview
- **Disparar Convocações**: Cria registros apenas
- **WhatsApp Individual**: Contato direto com motorista
- **Selecionar Todos**: Marca todos os motoristas
- **Limpar Seleção**: Desmarca todos

---

### 3.6. Aba Convocações

**Localização:** Sexta aba

#### Funcionalidades

- **Listar Convocações**: Todas as convocações do sistema
- **Filtrar por Viagem**: Filtra convocações de uma viagem específica
- **Filtrar por Status**: Filtra por status (Pendente, Aceita, etc)
- **Confirmar Convocação**: Confirma atribuição de viagem
- **Ver Link**: Visualiza link único da convocação

#### Filtros Disponíveis

| Campo | Tipo | Descrição |
|-------|------|-----------|
| **Viagem** | Select | Filtra por viagem específica |
| **Status** | Select | Filtra por status (Todos, Pendente, Aceita, etc) |

#### Colunas Exibidas

| Coluna | Descrição |
|--------|-----------|
| **ID** | ID da convocação |
| **Viagem** | ID da viagem (clicável - abre viagem) |
| **Classe Frota** | Classe de veículo |
| **Motorista** | Nome e telefone do motorista |
| **Rota** | Origem → Destino |
| **Status** | Status atual (badge colorido) |
| **Data Convocação** | Quando foi criada |
| **Data Acesso** | Quando motorista acessou o link |
| **Data Resposta** | Quando motorista respondeu |
| **Ações** | Ver Link, Confirmar |

#### Status e Cores

| Status | Cor | Descrição |
|--------|-----|-----------|
| **PENDENTE** | Amarelo | Aguardando resposta |
| **ACEITA** | Verde | Motorista aceitou |
| **CONFIRMADA** | Azul | Operador confirmou |
| **RECUSADA** | Vermelho | Motorista recusou ou foi recusada automaticamente |

#### Ações Disponíveis

- **🔗 Ver Link**: Abre link único da convocação
- **✅ Confirmar**: Confirma atribuição (apenas se ACEITA)
  - ⚠️ **Importante**: Ao confirmar, outras convocações da mesma viagem são automaticamente recusadas

#### Fluxo de Confirmação

1. **Motorista aceita** via link (status muda para ACEITA)
2. **Operador visualiza** na aba Convocações
3. **Clicar em "✅ Confirmar"**
4. **Modal de confirmação** é exibido
5. **Ao confirmar**:
   - Convocação selecionada → CONFIRMADA
   - Outras convocações da mesma viagem → RECUSADAS
   - Lista é recarregada automaticamente

---

### 3.7. Aba Veículo

**Localização:** Sétima aba

#### Funcionalidades

- **Gerenciar múltiplos veículos**: Permite cadastrar vários veículos para uma mesma viagem
- **Lista de veículos cadastrados**: Exibe todos os veículos já associados à viagem
- **Busca de equipamentos**: Busca por placa ou código do equipamento
- **Visualização de dados completos**: Modal estilizado com todos os dados do veículo
- **Remoção individual**: Remove veículos específicos da viagem

#### Estrutura da Aba

A aba é dividida em duas seções principais:

1. **Lista de Veículos Cadastrados** (topo)
   - Cards com informações resumidas
   - Botões de ação (Ver Dados, Remover)
   - Mensagem quando não há veículos cadastrados

2. **Formulário de Adição** (abaixo)
   - Campos para buscar e adicionar novo veículo

#### Lista de Veículos

Cada veículo é exibido em um card contendo:

- **Título**: Placa - Descrição do Equipamento
- **Subtítulo**: ID, Tipo, Marca, Modelo, Ano
- **Ações**:
  - 👁️ **Ver Dados**: Abre modal com dados completos
  - 🗑️ **Remover**: Remove o veículo da viagem

#### Formulário de Adição

##### Campos Disponíveis

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **Placa** | Texto | ✅ Sim | Placa do veículo (máx. 20 caracteres) |
| **ID do Equipamento** | Número | ❌ Não | Código do equipamento no sistema |
| **Tipo de Equipamento** | Select | ✅ Sim | Tipo (ex: 03 - Cavalo Trucado) |

##### Botões de Busca

- **🔍 Buscar por Placa**: Busca equipamento pela placa
- **🔍 Buscar por Código**: Busca equipamento pelo ID

##### Fluxo de Adição

1. **Buscar equipamento** por placa ou código
2. **Sistema preenche automaticamente** os dados do equipamento
3. **Selecionar Tipo de Equipamento** no dropdown
4. **Clicar em "Salvar Veículo"**
5. **Sistema adiciona** à lista de veículos cadastrados

#### Modal "Ver Dados"

Ao clicar em "👁️ Ver Dados", abre um modal estilizado exibindo:

- **Cabeçalho**: Placa - Descrição
- **Tabela de dados completos**:
  - ID do Equipamento
  - Referência (Placa)
  - Descrição
  - Situação
  - Tipo de Equipamento
  - Classe de Frota
  - Grupo
  - Tipo de Carroceria
  - Tipo de Atuação
  - Marca
  - Modelo
  - Ano de Fabricação
  - Eixos
  - Capacidade de Carga
  - Dimensões (Altura, Largura, Comprimento)
  - M³ Cúbico
  - Veículo Rastreado

#### Observações Importantes

- ✅ **Múltiplos veículos**: Uma viagem pode ter vários veículos cadastrados
- ✅ **Atualização automática**: Lista é recarregada após adicionar ou remover
- ✅ **Validação**: Sistema verifica se equipamento existe antes de adicionar
- ✅ **Limpeza de cache**: Formulário é limpo ao trocar de viagem

---

### 3.8. Aba Motorista

**Localização:** Oitava aba

#### Funcionalidades

- **Gerenciar múltiplos motoristas**: Permite cadastrar vários motoristas para uma mesma viagem
- **Lista de motoristas cadastrados**: Exibe todos os motoristas já associados à viagem
- **Busca de motoristas**: Busca por CPF, nome ou código
- **Visualização de dados completos**: Modal estilizado com todos os dados do motorista
- **Integração WhatsApp**: Botão para contato direto via WhatsApp
- **Remoção individual**: Remove motoristas específicos da viagem

#### Estrutura da Aba

A aba é dividida em duas seções principais:

1. **Lista de Motoristas Cadastrados** (topo)
   - Cards com informações resumidas
   - Botões de ação (WhatsApp, Ver Dados, Remover)
   - Mensagem quando não há motoristas cadastrados

2. **Formulário de Adição** (abaixo)
   - Campos para buscar e adicionar novo motorista

#### Lista de Motoristas

Cada motorista é exibido em um card contendo:

- **Título**: Razão Social ou Nome Fantasia
- **Subtítulo**: Código, CPF/CNPJ, Cidade - Estado
- **Ações**:
  - 📱 **WhatsApp**: Abre conversa no WhatsApp (se tiver celular cadastrado)
  - 👁️ **Ver Dados**: Abre modal com dados completos
  - 🗑️ **Remover**: Remove o motorista da viagem

#### Formulário de Adição

##### Campos Disponíveis

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| **CPF** | Texto | ❌ Não | CPF do motorista (formato: 000.000.000-00) |
| **Nome** | Texto | ❌ Não | Nome ou razão social |
| **Código** | Número | ❌ Não | Código do cadastro geral |

##### Botões de Busca

- **🔍 Buscar por CPF**: Busca motorista pelo CPF
- **🔍 Buscar por Nome**: Busca motorista pelo nome
- **🔍 Buscar por Código**: Busca motorista pelo código

##### Fluxo de Adição

1. **Buscar motorista** por CPF, nome ou código
2. **Sistema preenche automaticamente** os dados do motorista
3. **Clicar em "Salvar Motorista"**
4. **Sistema adiciona** à lista de motoristas cadastrados

#### Modal "Ver Dados"

Ao clicar em "👁️ Ver Dados", abre um modal estilizado exibindo:

- **Cabeçalho**: Nome/Razão Social
- **Tabela de dados completos**:
  - Código
  - CPF/CNPJ
  - Tipo Pessoa
  - Tipo Cadastro
  - Transportador
  - Situação
  - Possui Veículo Rastreado
  - CEP
  - Endereço
  - Número
  - Bairro
  - Complemento
  - Cidade
  - Estado
  - Email
  - Celular

#### Integração WhatsApp

- **Botão WhatsApp**: Aparece apenas se o motorista tiver celular cadastrado
- **Formato do link**: `https://wa.me/55{celular}` (sem formatação)
- **Abre em nova aba**: Não interfere na navegação do sistema

#### Observações Importantes

- ✅ **Múltiplos motoristas**: Uma viagem pode ter vários motoristas cadastrados
- ✅ **Atualização automática**: Lista é recarregada após adicionar ou remover
- ✅ **Validação**: Sistema verifica se motorista existe antes de adicionar
- ✅ **Limpeza de cache**: Formulário é limpo ao trocar de viagem
- ✅ **WhatsApp condicional**: Botão aparece apenas se houver celular válido

---

## 🔄 Fluxos de Trabalho

### Fluxo 1: Criar Nova Viagem

```
1. Abrir módulo "Gerenciar Viagens"
   ↓
2. Clicar em "Novo Registro" (aba Dados)
   ↓
3. Preencher campos obrigatórios
   ↓
4. Selecionar Origem (Estado → Cidade)
   ↓
5. Selecionar Destino (Estado → Cidade)
   ↓
6. Sistema carrega roteiros disponíveis
   ↓
7. Selecionar Roteiro (opcional)
   ↓
8. Preencher valores (Frete, Peso, Cubagem)
   ↓
9. Preencher observações
   ↓
10. Clicar em "Salvar"
   ↓
11. Viagem criada com sucesso
```

### Fluxo 2: Buscar e Enviar Convocações

```
1. Abrir aba "Compatíveis"
   ↓
2. Clicar em "Carregar Viagens Pendentes"
   ↓
3. Selecionar viagem no dropdown
   ↓
4. Clicar em "Buscar Motoristas Compatíveis"
   ↓
5. Selecionar motoristas desejados
   ↓
6. Clicar em "📢 Preparar Anúncio"
   ↓
7. Visualizar preview do anúncio
   ↓
8. Clicar em "📱 Enviar via WhatsApp"
   ↓
9. Sistema cria convocações e abre WhatsApp
   ↓
10. Motoristas recebem mensagens com links
```

### Fluxo 3: Confirmar Atribuição

```
1. Motorista acessa link e aceita convocação
   ↓
2. Status muda para ACEITA
   ↓
3. Operador abre aba "Convocações"
   ↓
4. Filtra por viagem ou status ACEITA
   ↓
5. Localiza convocação aceita
   ↓
6. Clicar em "✅ Confirmar"
   ↓
7. Confirmar no modal
   ↓
8. Status muda para CONFIRMADA
   ↓
9. Outras convocações são recusadas automaticamente
```

### Fluxo 4: Adicionar Veículos à Viagem

```
1. Selecionar ou criar uma viagem
   ↓
2. Abrir aba "Veículo"
   ↓
3. Buscar equipamento por Placa ou Código
   ↓
4. Sistema preenche dados automaticamente
   ↓
5. Selecionar Tipo de Equipamento
   ↓
6. Clicar em "Salvar Veículo"
   ↓
7. Veículo é adicionado à lista
   ↓
8. Repetir para adicionar mais veículos (se necessário)
```

### Fluxo 5: Adicionar Motoristas à Viagem

```
1. Selecionar ou criar uma viagem
   ↓
2. Abrir aba "Motorista"
   ↓
3. Buscar motorista por CPF, Nome ou Código
   ↓
4. Sistema preenche dados automaticamente
   ↓
5. Clicar em "Salvar Motorista"
   ↓
6. Motorista é adicionado à lista
   ↓
7. Repetir para adicionar mais motoristas (se necessário)
```

### Fluxo 6: Visualizar Dados Completos

```
1. Abrir aba "Veículo" ou "Motorista"
   ↓
2. Localizar item na lista
   ↓
3. Clicar em "👁️ Ver Dados"
   ↓
4. Modal abre com dados completos
   ↓
5. Visualizar informações detalhadas
   ↓
6. Fechar modal (botão X ou ESC)
```

---

## 📝 Campos e Validações

### Campos Obrigatórios

- ✅ ID Viagem
- ✅ Tipo Viagem
- ✅ Situação Viagem
- ✅ Situação (Ativa/Inativa)
- ✅ Classe Frota
- ✅ Contratador
- ✅ Origem (Estado e Cidade)
- ✅ Destino (Estado e Cidade)
- ✅ Data Início
- ✅ Data Fim
- ✅ Exige Veículo Rastreado

### Validações Especiais

#### ID Viagem
- Deve ser único
- Apenas números
- Não pode ser vazio

#### Datas
- Data Fim deve ser posterior à Data Início
- Formato: `YYYY-MM-DDTHH:mm`
- Sistema trata como data local (sem conversão de fuso)

#### Origem e Destino
- Devem ser diferentes
- Cidade deve pertencer ao estado selecionado
- Sistema valida antes de salvar

#### Valores Numéricos
- **Frete**: Decimal com 2 casas (R$)
- **Peso**: Decimal com 3 casas (toneladas)
- **Cubagem**: Decimal com 3 casas (m³)
- **Distância**: Número inteiro (km)

---

## 🔒 Regras de Negócio

### Regra 1: Unicidade de ID
- Cada viagem deve ter ID único
- Sistema valida antes de salvar
- Não permite duplicação

### Regra 2: Viagem Pendente
- Viagem está pendente quando:
  - Status é "Programada" (P) ou "Preparação" (D)
  - Não possui convocação ACEITA ou CONFIRMADA

### Regra 3: Uma Viagem = Um Motorista
- Apenas UMA convocação pode estar CONFIRMADA por viagem
- Ao confirmar uma, outras são automaticamente recusadas
- Processo é irreversível

### Regra 4: Compatibilidade de Motoristas
- Motorista deve atender TODOS os critérios:
  1. Classe de frota compatível
  2. Veículo rastreado (se exigido)
  3. Localização (micro-região)

### Regra 5: Prevenção de Duplicação
- Sistema verifica convocações PENDENTE existentes
- Reutiliza convocação existente ao invés de criar nova
- Atualiza dados (texto, telefone, link) se necessário

### Regra 6: Múltiplos Veículos e Motoristas
- Uma viagem pode ter **vários veículos** cadastrados
- Uma viagem pode ter **vários motoristas** cadastrados
- Sistema verifica existência antes de inserir (evita duplicação)
- Cada veículo/motorista pode ser removido individualmente

### Regra 7: Limpeza de Cache
- Formulários são limpos automaticamente ao trocar de viagem
- Listas são atualizadas após operações de adição/remoção
- Sistema previne exibição de dados de viagem anterior

---

## ⚙️ init.sql - Execução Automática

### O que é

O arquivo `init.sql` permite executar comandos SQL automaticamente quando o módulo é carregado.

### Localização

```
backend/public/modulos/gerenciar-viagens/sql/init.sql
```

### Como Funciona

1. **Ao abrir o módulo**, sistema busca o arquivo
2. **Remove comentários** e linhas vazias
3. **Divide por GO** (se houver múltiplos comandos)
4. **Valida comandos** (bloqueia perigosos)
5. **Executa sequencialmente**
6. **Aguarda conclusão** antes de prosseguir

### Segurança

- ✅ **Permitidos**: SELECT, UPDATE, INSERT, DELETE, EXEC
- ❌ **Bloqueados**: DROP, TRUNCATE, ALTER DATABASE, etc

### Documentação Completa

Veja: [DOCUMENTACAO_INIT_SQL.md](DOCUMENTACAO_INIT_SQL.md)

---

## 🔌 Integrações

### Sistema de Convocações

- **Integração completa** com sistema de convocações
- Criação automática de convocações
- Geração de links únicos
- Envio via WhatsApp

**Documentação:** [DOCUMENTACAO_SISTEMA_CONVOCACOES.md](DOCUMENTACAO_SISTEMA_CONVOCACOES.md)

### Relatório de Convocações

- **Navegação direta** do relatório para viagem
- Filtros pré-preenchidos ao abrir viagem
- Integração bidirecional

### Outros Módulos

- **Cadastro Geral**: Busca de motoristas e contratadores
- **Roteiros**: Carregamento de rotas disponíveis
- **Cidades**: Busca de cidades por estado
- **Classes de Frota**: Validação de compatibilidade

---

## 🔍 Troubleshooting

### Problema: Aba volta automaticamente para Filtros

**Causa:** Problema com execução do init.sql ou mudanças automáticas

**Solução:**
- ✅ **Já corrigido** na versão atual
- Sistema agora previne mudanças automáticas
- Campo "ID Viagem" no filtro é preenchido automaticamente ao editar

### Problema: init.sql executa múltiplas vezes

**Causa:** Múltiplas chamadas ao init()

**Solução:**
- ✅ **Já corrigido** na versão atual
- Flags de controle previnem execução múltipla
- Sistema garante execução única por sessão

### Problema: Combos não carregam

**Causa:** Erro de conexão ou dados não disponíveis

**Solução:**
1. Verificar conexão com banco de dados
2. Verificar se dados existem nas tabelas
3. Recarregar a página
4. Verificar console do navegador (F12)

### Problema: Mapa não carrega

**Causa:** Origem ou destino não preenchidos

**Solução:**
1. Verificar se viagem tem origem e destino
2. Selecionar origem e destino no formulário
3. Salvar viagem
4. Abrir aba Mapa novamente

### Problema: Motoristas compatíveis não aparecem

**Causa:** Critérios de compatibilidade não atendidos

**Solução:**
1. Verificar classe de frota da viagem
2. Verificar se exige rastreador
3. Verificar localização dos motoristas
4. Verificar se motoristas estão ativos

### Problema: Não consigo confirmar convocação

**Causa:** Convocação não está ACEITA ou já existe outra CONFIRMADA

**Solução:**
1. Verificar status da convocação (deve ser ACEITA)
2. Verificar se outra convocação já foi confirmada para a mesma viagem
3. Aguardar motorista aceitar antes de confirmar

---

## 📖 Glossário

| Termo | Definição |
|-------|-----------|
| **Viagem Pendente** | Viagem que precisa de motorista, sem convocação aceita/confirmada |
| **Motorista Compatível** | Motorista que atende todos os critérios (classe, rastreador, localização) |
| **Convocação** | Registro de convite enviado a um motorista |
| **Micro-região** | Agrupamento geográfico de cidades |
| **Classe de Frota** | Tipo de veículo necessário para a viagem |
| **init.sql** | Arquivo SQL executado automaticamente ao carregar módulo |
| **Grid Editor** | Componente de tabela editável inline |
| **Inline Editing** | Edição direta na tabela, sem abrir formulário |

---

## 📝 Notas Importantes

### Para Operadores

1. ⚠️ **SEMPRE** use "Preparar Anúncio" → "Enviar via WhatsApp" para envio normal
2. ⚠️ **NÃO** é possível desfazer uma confirmação
3. ⚠️ Ao confirmar, outras convocações são automaticamente recusadas
4. ✅ Use filtros para encontrar viagens específicas
5. ✅ Verifique dados antes de confirmar convocação

### Para Desenvolvedores

1. ✅ Sistema previne execução múltipla do init.sql
2. ✅ Sistema previne mudanças automáticas de aba
3. ✅ Todas as operações críticas usam validações
4. ✅ Logs detalhados para debugging
5. ✅ Tratamento de erros em todas as funções

### Melhorias Recentes

#### 2025-11-24
- ✅ **Suporte a múltiplos veículos por viagem**: Sistema permite cadastrar vários veículos
- ✅ **Suporte a múltiplos motoristas por viagem**: Sistema permite cadastrar vários motoristas
- ✅ **Modais estilizados**: Design profissional para visualização de dados completos
  - Header com gradiente roxo (#667eea → #764ba2)
  - Tabela organizada (labels à direita, valores em negrito à esquerda)
  - Altura otimizada (95vh) para evitar scroll
  - Espaçamento compacto (6px entre linhas)
  - Fechamento com ESC ou clique fora
- ✅ **Botão WhatsApp**: Integração direta na lista de motoristas
  - Aparece apenas se motorista tiver celular válido
  - Link: `https://wa.me/55{celular}`
  - Abre em nova aba
- ✅ **Contador de registros**: Exibe quantidade na aba Convocações
- ✅ **Correção de cache/refresh**: Implementado em todos os módulos
  - Limpeza automática de formulários
  - Atualização automática de listas
  - Prevenção de dados persistentes
- ✅ **Labels atualizados**: Nomes mais claros e objetivos

#### 2025-11-23
- ✅ Proteção contra execução múltipla do init.sql
- ✅ Prevenção de mudanças automáticas de aba
- ✅ Campo "ID Viagem" preenchido automaticamente ao editar
- ✅ Ordenação em tabelas (Motoristas Compatíveis e Convocações)
- ✅ Modal de links WhatsApp para múltiplos envios
- ✅ Prevenção de duplicação de convocações

---

## 🔗 Links Relacionados

- [Sistema de Convocações - Documentação Completa](DOCUMENTACAO_SISTEMA_CONVOCACOES.md)
- [init.sql - Documentação](DOCUMENTACAO_INIT_SQL.md)
- [Índice de Documentação](INDICE_DOCUMENTACAO.md)
- [README Principal](../../README.md)

---

**Documentação mantida por:** Equipe DivulgaCarga  
**Última atualização:** 2025-11-24  
**Versão do documento:** 1.1.0

