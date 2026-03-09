# 📋 Resumo de Atualizações - Janeiro 2026

## 🎯 Versão 1.4.0

### ✨ Novas Funcionalidades

#### 1. Exportação para Excel

**Módulos Implementados:**
- ✅ **Gerenciar Cadastro Geral**
- ✅ **Gerenciar Equipamentos**

**Características:**
- Exportação completa com todos os dados principais
- Inclui dados de todas as tabelas auxiliares relacionadas
- Respeita filtros aplicados pelo usuário
- Formatação automática de colunas no Excel
- Nome do arquivo inclui data: `modulo-YYYY-MM-DD.xlsx`

**Dados Exportados - Cadastro Geral:**
- Dados principais (Código, CPF/CNPJ, Razão Social, etc.)
- Dados de endereço completo
- Dados da cidade (Estado, Nome, Código)
- Dados do transportador (quando aplicável)
- Dados de manutenção

**Dados Exportados - Equipamentos:**
- Dados principais (ID, Placa, Descrição, etc.)
- Dados do grupo de equipamento
- Dados do tipo de equipamento
- Dados da marca e modelo
- Dados da classe de frota
- Dados técnicos (Eixos, Capacidade, Dimensões, etc.)

#### 2. Configuração de Múltiplos Bancos de Dados

**Implementação:**
- Suporte para dois bancos de dados simultâneos
- Pool de conexões separado para cada banco
- Sistema tolerante a falhas

**Bancos Configurados:**
- **ATLAS_CARGO_PRD**: Banco principal do sistema
- **INTEGRA_PRD**: Banco de migração (opcional)

**Documentação:**
- `CONFIGURACAO_BANCOS.md`: Instruções completas de configuração
- `CONFIGURAR_LINKED_SERVER.md`: Instruções para linked server SQL Server

#### 3. Melhorias de Interface

**Layout Padronizado:**
- Botão "Novo Registro" alinhado à direita (padrão do sistema)
- Botão "Exportar Excel" ao lado de "Voltar aos Filtros"
- Consistência visual em todos os módulos

### 🔧 Melhorias Técnicas

#### Tratamento de Erros
- Erros de banco offline não bloqueiam o sistema
- Logs mais informativos
- Sistema continua funcionando mesmo com INTEGRA_PRD offline

#### Performance
- Queries otimizadas para exportação
- Formatação eficiente de dados Excel
- Larguras de colunas configuradas automaticamente

### 📝 Arquivos Criados

**Documentação:**
- `backend/CONFIGURACAO_BANCOS.md`
- `backend/CONFIGURAR_LINKED_SERVER.md`
- `backend/public/modulos/gerenciar-cadastro-geral/QUERY_EXPORTACAO_EXCEL.sql`
- `backend/public/modulos/gerenciar-equipamentos/QUERY_EXPORTACAO_EXCEL.sql`

**Scripts:**
- `backend/scripts/configurar_linked_server_integra.sql`

### 🔄 Arquivos Modificados

**Backend:**
- `backend/config/db.js` - Suporte a múltiplos bancos
- `backend/package.json` - Adicionada dependência xlsx
- `backend/controllers/cadastrogeral.controller.js` - Método exportarExcel
- `backend/routes/cadastrogeral.routes.js` - Rota de exportação
- `backend/routes/equipamento.routes.js` - Rota de exportação

**Frontend:**
- `backend/public/modulos/gerenciar-cadastro-geral/index.html` - Botão exportar
- `backend/public/modulos/gerenciar-cadastro-geral/js/script.js` - Função exportar
- `backend/public/modulos/gerenciar-equipamentos/index.html` - Botão exportar
- `backend/public/modulos/gerenciar-equipamentos/js/script.js` - Função exportar

### 📦 Dependências Adicionadas

- `xlsx@^0.18.5` - Biblioteca para geração de arquivos Excel

### 🚀 Como Usar

#### Exportar Cadastros Gerais
1. Acesse "Gerenciar Cadastro Geral"
2. Aplique filtros (opcional)
3. Vá para aba "Grid"
4. Clique em "📥 Exportar para Excel"

#### Exportar Equipamentos
1. Acesse "Gerenciar Equipamentos"
2. Aplique filtros (opcional)
3. Vá para aba "Grid"
4. Clique em "📥 Exportar para Excel"

#### Configurar Linked Server (INTEGRA_PRD)
1. Abra SQL Server Management Studio
2. Conecte-se ao ATLAS_CARGO_PRD
3. Execute: `backend/scripts/configurar_linked_server_integra.sql`

### ⚠️ Notas Importantes

1. **Linked Server**: As stored procedures que usam `[INTEGRA_PRD].[dbo].[TABELA]` requerem linked server configurado no SQL Server
2. **Variáveis de Ambiente**: Configure as variáveis `INTEGRA_*` no `.env` se necessário
3. **Tolerância a Falhas**: O sistema continua funcionando mesmo se INTEGRA_PRD estiver offline

### 📊 Estatísticas

- **Módulos com Exportação Excel**: 2
- **Novos Endpoints**: 2
- **Novos Arquivos de Documentação**: 4
- **Dependências Adicionadas**: 1
