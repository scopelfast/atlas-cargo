# 🔐 Como Acessar um Motorista - Guia Completo

## 📋 Situação Atual

O módulo de motorista está **implementado e funcionando**, mas a validação de senha está em **modo desenvolvimento**.

### ⚠️ Status da Autenticação

- **Atualmente**: O sistema aceita **qualquer senha** se o motorista não tiver senha definida
- **Motoristas com senha**: A validação funciona normalmente com bcrypt
- **Motoristas sem senha**: Aceita qualquer senha (modo desenvolvimento)

---

## 🚀 Como Acessar um Motorista AGORA (Modo Desenvolvimento)

### Opção 1: Se o motorista NÃO tem senha definida

1. **Acesse a tela de login do motorista:**
   - URL: `http://seu-servidor/motorista/` ou `http://seu-servidor/motorista/index.html`

2. **Digite:**
   - **CPF**: O CPF do motorista (com ou sem formatação)
   - **Senha**: Qualquer senha (ex: `123456`, `senha`, `teste`)

3. **O sistema vai aceitar!** ✅

### Opção 2: Se o motorista JÁ tem senha definida

1. Use o CPF do motorista
2. Use a senha que foi definida para ele

---

## 🔧 Como Definir Senha para um Motorista

### Passo 1: Adicionar Campo SENHA no Banco (se ainda não foi feito)

Execute o script SQL:

```sql
-- Executar no SQL Server Management Studio
-- Arquivo: backend/scripts/adicionar_campo_senha_motorista.sql
```

Ou execute diretamente:

```sql
USE [ATLAS_CARGO_PRD]
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.MOTORISTA_COMPLEMENTO') 
    AND name = 'SENHA'
)
BEGIN
    ALTER TABLE [dbo].[MOTORISTA_COMPLEMENTO]
    ADD SENHA VARCHAR(255) NULL;
    
    PRINT '✅ Coluna SENHA adicionada!';
END
GO
```

### Passo 2: Definir Senha para um Motorista

Use o script Node.js criado:

```bash
# No diretório raiz do projeto
node backend/scripts/definir_senha_motorista.js <CPF> <SENHA>
```

**Exemplo:**

```bash
# Definir senha "minhaSenha123" para o motorista com CPF 12345678901
node backend/scripts/definir_senha_motorista.js 12345678901 minhaSenha123
```

O script vai:
- ✅ Gerar o hash bcrypt da senha
- ✅ Buscar o motorista pelo CPF
- ✅ Criar/atualizar o registro em MOTORISTA_COMPLEMENTO
- ✅ Salvar a senha hasheada

---

## 📊 Verificar Motoristas e Senhas

### Consulta SQL para ver status das senhas:

```sql
SELECT 
    cg.CDCADASTRO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.NRCELULAR AS CELULAR,
    mc.SENHA,
    CASE 
        WHEN mc.SENHA IS NULL THEN '❌ Sem senha (aceita qualquer senha)'
        WHEN mc.SENHA LIKE '$2%' THEN '✅ Senha hasheada (bcrypt)'
        ELSE '⚠️ Senha em texto puro (migrar!)'
    END AS STATUS_SENHA,
    mc.STATUSAPROVACAO,
    CASE mc.STATUSAPROVACAO
        WHEN 'A' THEN '✅ Aprovado'
        WHEN 'P' THEN '⏳ Pendente'
        WHEN 'R' THEN '❌ Rejeitado'
        ELSE '❓ Desconhecido'
    END AS STATUS_APROVACAO
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.FGTIPOCADASTRO = 'M'  -- Apenas motoristas
  AND cg.FGACTIVE = 'A'         -- Apenas ativos
ORDER BY cg.RZSOCIAL;
```

---

## 🔍 Encontrar um Motorista Específico

### Por CPF:

```sql
SELECT 
    cg.CDCADASTRO,
    cg.RZSOCIAL,
    cg.CGCCPF,
    cg.NRCELULAR,
    cg.ENDEMAIL,
    mc.STATUSAPROVACAO,
    mc.SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CGCCPF = '12345678901'  -- Substitua pelo CPF
  AND cg.FGTIPOCADASTRO = 'M';
```

### Por Nome:

```sql
SELECT 
    cg.CDCADASTRO,
    cg.RZSOCIAL,
    cg.CGCCPF,
    cg.NRCELULAR
FROM [dbo].[CADASTROGERAL] cg
WHERE cg.RZSOCIAL LIKE '%NOME_DO_MOTORISTA%'  -- Substitua pelo nome
  AND cg.FGTIPOCADASTRO = 'M'
  AND cg.FGACTIVE = 'A';
```

---

## 🎯 Resumo Rápido

### Para acessar AGORA (sem definir senha):

1. Vá para: `http://seu-servidor/motorista/`
2. Digite o **CPF** do motorista
3. Digite **qualquer senha** (ex: `123456`)
4. ✅ Login funcionará!

### Para definir senha permanente:

```bash
# 1. Adicionar campo SENHA (se necessário)
# Execute: backend/scripts/adicionar_campo_senha_motorista.sql

# 2. Definir senha para o motorista
node backend/scripts/definir_senha_motorista.js <CPF> <SENHA>
```

---

## 📝 Notas Importantes

1. **Segurança**: O modo "aceitar qualquer senha" é apenas para desenvolvimento. Em produção, todos os motoristas devem ter senha definida.

2. **Aprovação**: O motorista precisa estar com `STATUSAPROVACAO = 'A'` para fazer login.

3. **Ativo**: O motorista precisa estar com `FGACTIVE = 'A'` na tabela CADASTROGERAL.

4. **Hash**: As senhas são armazenadas com hash bcrypt (nunca em texto puro).

---

## 🆘 Problemas Comuns

### "Motorista não encontrado ou inativo"

**Causa:** O motorista não existe no banco de dados ou está inativo.

**Solução 1: Verificar e Corrigir (se já existe)**
```bash
node backend/scripts/corrigir_motorista.js 02100610066
```

**Solução 2: Criar Novo Motorista**
```bash
node backend/scripts/criar_motorista.js 02100610066 "Nome do Motorista" 41999999999 email@exemplo.com
```

**Solução 3: Verificar Manualmente (SQL)**
```sql
-- Verificar se existe
SELECT * FROM [dbo].[CADASTROGERAL] 
WHERE CGCCPF = '02100610066';

-- Se existir mas não for motorista, corrigir:
UPDATE [dbo].[CADASTROGERAL]
SET FGTIPOCADASTRO = 'M', FGACTIVE = 'A'
WHERE CGCCPF = '02100610066';
```

### "Cadastro pendente de aprovação"
- O motorista precisa ser aprovado primeiro
- Atualize `STATUSAPROVACAO = 'A'` na tabela MOTORISTA_COMPLEMENTO

### "Senha incorreta"
- O motorista já tem senha definida
- Use o script para redefinir a senha se necessário

---

## 🆕 Criar Novo Motorista

Se o motorista não existe no banco, use o script de criação:

```bash
node backend/scripts/criar_motorista.js <CPF> <NOME> <CELULAR> [EMAIL] [CIDADE_ID]
```

**Exemplo:**
```bash
# Criar motorista com dados básicos
node backend/scripts/criar_motorista.js 02100610066 "João Silva" 41999999999

# Criar motorista com email e cidade
node backend/scripts/criar_motorista.js 02100610066 "João Silva" 41999999999 joao@email.com 1
```

O script vai:
- ✅ Criar registro em CADASTROGERAL (tipo M, ativo)
- ✅ Criar registro em MOTORISTA_COMPLEMENTO (aprovado)
- ✅ Permitir login imediato (qualquer senha se não tiver senha definida)

---

## 📞 Suporte

Se precisar de ajuda, verifique:
- `backend/controllers/motorista-app.controller.js` (função `login`)
- `backend/scripts/adicionar_campo_senha_motorista.sql`
- `backend/scripts/definir_senha_motorista.js`
- `backend/scripts/corrigir_motorista.js` (verificar/corrigir motorista existente)
- `backend/scripts/criar_motorista.js` (criar novo motorista)

