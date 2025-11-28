# 📝 Documentação - init.sql (Gerenciar Viagens)

**Módulo:** Gerenciar Viagens  
**Arquivo:** `backend/public/modulos/gerenciar-viagens/sql/init.sql`  
**Versão:** 1.0.0  
**Data:** 2025-11-23  
**Status:** ✅ Ativo

---

## 🎯 Objetivo

O arquivo `init.sql` permite executar comandos SQL automaticamente quando o módulo "Gerenciar Viagens" é carregado. Isso é útil para:

- Sincronização de dados
- Atualizações automáticas
- Execução de procedures
- Manutenção de dados

---

## 📋 Como Funciona

### Execução Automática

1. **Quando o módulo é carregado**, o sistema:
   - Busca o arquivo `init.sql`
   - Remove comentários e linhas vazias
   - Divide comandos por `GO` (se houver)
   - Executa cada comando sequencialmente
   - Aguarda a conclusão de todos antes de prosseguir

2. **Proteções implementadas**:
   - ✅ Executa apenas uma vez por sessão
   - ✅ Aguarda completamente antes de mudar abas
   - ✅ Verifica sucesso de cada comando
   - ✅ Bloqueia comandos perigosos (DROP, TRUNCATE, etc)

### Localização do Arquivo

```
backend/
└── public/
    └── modulos/
        └── gerenciar-viagens/
            └── sql/
                └── init.sql
```

---

## ⚙️ Configuração

### Formato do Arquivo

O arquivo pode conter:

- **Comentários**: Linhas começando com `--` são ignoradas
- **Comandos SQL**: Qualquer comando SQL válido
- **Separador GO**: Use `GO` para separar múltiplos comandos
- **Comentários de bloco**: `/* comentário */` são suportados

### Exemplo

```sql
-- Comentário: Este script sincroniza dados
-- Data: 2025-11-23

-- Atualizar viagens
UPDATE [dbo].[VIAGEMMESTRE]
SET VLFRETE = 1000.00
WHERE IDVIAGEM = 12345;

GO

-- Executar procedure
EXEC [dbo].[SP_SINCRONIZAR_VIAGENS];

GO

-- Selecionar dados
SELECT COUNT(*) AS TOTAL FROM [dbo].[VIAGEMMESTRE];
```

---

## 🔒 Segurança

### Comandos Permitidos

✅ **Permitidos:**
- `SELECT` - Consultas
- `UPDATE` - Atualizações
- `INSERT` - Inserções
- `DELETE` - Exclusões (com cuidado)
- `EXEC` / `EXECUTE` - Execução de procedures

### Comandos Bloqueados

❌ **Bloqueados:**
- `DROP DATABASE`
- `DROP TABLE`
- `TRUNCATE TABLE`
- `ALTER DATABASE`
- `CREATE DATABASE`
- `BACKUP DATABASE`
- `RESTORE DATABASE`
- `SHUTDOWN`
- `KILL`

### Validação

O sistema valida cada comando antes de executar:
- Remove espaços em branco
- Converte para maiúsculas para verificação
- Bloqueia comandos perigosos
- Retorna erro se comando bloqueado for detectado

---

## 📊 Logs e Debug

### Logs no Console

O sistema registra:
- ✅ Sucesso: `✅ init.sql executado com sucesso: X comando(s) processado(s)`
- ⚠️ Avisos: Comandos que falharam (mas não bloqueiam)
- ❌ Erros: Erros críticos (mas não bloqueiam o módulo)

### Exemplo de Log

```
✅ init.sql executado com sucesso: 16 comando(s) processado(s)
```

### Verificação de Resultados

Cada comando retorna:
- **Tipo**: SELECT, EXEC, UPDATE, etc
- **Sucesso**: true/false
- **Mensagem**: Descrição do resultado
- **Dados**: Recordset (se SELECT) ou rowsAffected (se UPDATE/INSERT/DELETE)

---

## 🔄 Fluxo de Execução

### 1. Carregamento do Módulo

```
Usuário abre "Gerenciar Viagens"
    ↓
Sistema verifica se init.sql existe
    ↓
Se existe, carrega o arquivo
    ↓
Remove comentários e linhas vazias
    ↓
Divide por GO (se houver)
    ↓
Valida cada comando
    ↓
Executa sequencialmente
    ↓
Aguarda conclusão de todos
    ↓
Aguarda 500ms adicional
    ↓
Muda para aba de filtros (se primeira carga)
```

### 2. Proteções

- **Flag `initExecutado`**: Previne execução múltipla do `init()`
- **Flag `sqlExecutado`**: Previne execução múltipla do SQL
- **Event listener `once: true`**: Garante execução única
- **Verificação de aba ativa**: Não muda aba se já houver uma ativa

---

## 💡 Casos de Uso

### 1. Sincronização de Dados

```sql
-- Sincronizar VIAGEMMESTRE com INTEGRA_PRD
UPDATE v
SET v.VLFRETE = i.VLFRETE,
    v.DTPREVINICIO = i.DTPREVINICIO
FROM [dbo].[VIAGEMMESTRE] v
INNER JOIN [INTEGRA_PRD].[dbo].[VIAGEMMESTRE] i
    ON v.IDVIAGEM = i.IDVIAGEM;
```

### 2. Execução de Procedures

```sql
-- Executar procedure de sincronização
EXEC [dbo].[SP_SINCRONIZAR_DADOS];
```

### 3. Atualizações em Lote

```sql
-- Atualizar múltiplas viagens
UPDATE [dbo].[VIAGEMMESTRE]
SET FGACTIVE = 'S'
WHERE DTPREVINICIO >= GETDATE();
```

### 4. Limpeza de Dados

```sql
-- Limpar convocações antigas (exemplo - cuidado!)
DELETE FROM [dbo].[CONVOCACAO]
WHERE DHCONVOCACAO < DATEADD(DAY, -30, GETDATE())
  AND STATUS = 'RECUSADA';
```

---

## ⚠️ Boas Práticas

### ✅ Recomendações

1. **Use comentários** para documentar o que cada comando faz
2. **Teste antes** de colocar em produção
3. **Use transações** para operações críticas (se necessário)
4. **Mantenha comandos simples** e fáceis de entender
5. **Documente mudanças** no arquivo

### ❌ Evite

1. **Não use comandos perigosos** (DROP, TRUNCATE, etc)
2. **Não faça operações muito pesadas** (pode travar o módulo)
3. **Não dependa de ordem** entre comandos (use GO se necessário)
4. **Não deixe o arquivo vazio** sem comentários explicativos

---

## 🔍 Troubleshooting

### Problema: init.sql não executa

**Possíveis causas:**
- Arquivo não existe no caminho correto
- Arquivo está vazio ou contém apenas comentários
- Erro de permissão no banco de dados

**Solução:**
1. Verifique se o arquivo existe: `backend/public/modulos/gerenciar-viagens/sql/init.sql`
2. Verifique se há comandos SQL válidos (não apenas comentários)
3. Verifique permissões do usuário do banco de dados
4. Verifique logs do servidor

### Problema: init.sql executa múltiplas vezes

**Causa:** Problema com flags de controle

**Solução:**
- ✅ Já corrigido na versão atual
- Sistema agora garante execução única
- Verifique se está usando a versão mais recente

### Problema: Comando bloqueado

**Causa:** Comando está na lista de bloqueados

**Solução:**
- Use comandos permitidos (SELECT, UPDATE, INSERT, DELETE, EXEC)
- Se precisar de comandos bloqueados, execute manualmente no banco
- Entre em contato com a equipe de desenvolvimento se necessário

### Problema: Erro ao executar comando

**Possíveis causas:**
- Erro de sintaxe SQL
- Tabela/coluna não existe
- Permissão insuficiente
- Erro de lógica no comando

**Solução:**
1. Verifique a sintaxe do comando
2. Teste o comando diretamente no SQL Server Management Studio
3. Verifique se tabelas/colunas existem
4. Verifique permissões do usuário
5. Revise a lógica do comando

---

## 📝 Exemplo Completo

```sql
-- ============================================
-- Script de Inicialização - Gerenciar Viagens
-- Data: 2025-11-23
-- Descrição: Sincroniza dados e atualiza viagens
-- ============================================

-- 1. Sincronizar valores de frete
UPDATE v
SET 
    v.VLFRETE = i.VLFRETE,
    v.DTPREVINICIO = i.DTPREVINICIO,
    v.DTPREVFINAL = i.DTPREVFINAL,
    v.OBSERV = i.OBSERV
FROM [dbo].[VIAGEMMESTRE] v
INNER JOIN [INTEGRA_PRD].[dbo].[VIAGEMMESTRE] i
    ON v.IDVIAGEM = i.IDVIAGEM
WHERE v.IDVIAGEM IS NOT NULL;

GO

-- 2. Executar procedure de sincronização
EXEC [dbo].[SP_SINCRONIZAR_VIAGENS];

GO

-- 3. Verificar resultados (opcional - para debug)
SELECT 
    COUNT(*) AS TOTAL_VIAGENS,
    SUM(CASE WHEN VLFRETE > 0 THEN 1 ELSE 0 END) AS COM_FRETE
FROM [dbo].[VIAGEMMESTRE]
WHERE FGACTIVE = 'S';
```

---

## 🔗 Links Relacionados

- [Documentação Sistema de Convocações](DOCUMENTACAO_SISTEMA_CONVOCACOES.md)
- [Estrutura de Documentação](ESTRUTURA_DOCUMENTACAO.md)
- [README Principal](../../README.md)

---

**Documentação mantida por:** Equipe DivulgaCarga  
**Última atualização:** 2025-11-23  
**Versão do documento:** 1.0.0

