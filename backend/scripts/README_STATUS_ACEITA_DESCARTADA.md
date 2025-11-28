# Verificação do Campo STATUS na Tabela CONVOCACAO

## Objetivo

Verificar se o campo `STATUS` na tabela `CONVOCACAO` pode aceitar o novo valor `ACEITA_DESCARTADA` (18 caracteres) sem necessidade de alteração na estrutura da tabela.

## Como Verificar

Execute o script `verificar_status_convocacao.sql` no SQL Server Management Studio:

```sql
-- Execute: backend/scripts/verificar_status_convocacao.sql
```

## Resultados Esperados

### 1. Estrutura da Coluna
- **DATA_TYPE**: `varchar` ou `nvarchar`
- **CHARACTER_MAXIMUM_LENGTH**: Deve ser >= 20 (recomendado) ou pelo menos 18
- **IS_NULLABLE**: `NO` (não permite NULL)

### 2. Constraints CHECK
- Se **NÃO houver** constraints CHECK: ✅ **OK** - Pode usar qualquer valor
- Se **houver** constraints CHECK: ⚠️ **ATENÇÃO** - Pode precisar remover ou atualizar a constraint

### 3. Valores Atuais
Deve mostrar os status existentes:
- `PENDENTE`
- `ACEITA`
- `RECUSADA`
- `CONFIRMADA`

## Se Precisar Ajustar

### Cenário 1: Campo muito pequeno (< 18 caracteres)
```sql
ALTER TABLE [dbo].[CONVOCACAO]
ALTER COLUMN STATUS VARCHAR(20);
```

### Cenário 2: Há constraint CHECK que limita valores
```sql
-- Verificar qual constraint existe
SELECT CONSTRAINT_NAME, CHECK_CLAUSE
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
WHERE CONSTRAINT_NAME LIKE '%STATUS%';

-- Se necessário, remover a constraint
ALTER TABLE [dbo].[CONVOCACAO]
DROP CONSTRAINT [NOME_DA_CONSTRAINT];
```

## Conclusão

**Provavelmente NÃO será necessário alterar a tabela**, pois:
- O campo `STATUS` é `VARCHAR(20)` (suficiente para 18 caracteres)
- Não há constraints CHECK encontradas no código
- O sistema já aceita valores dinâmicos de status

Mas **é recomendado executar o script de verificação** para confirmar no seu ambiente específico.

