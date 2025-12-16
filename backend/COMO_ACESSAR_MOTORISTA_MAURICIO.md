# 🔐 Como Acessar - Mauricio Ferreira Peixoto

## 📋 Dados do Motorista

- **Nome:** Mauricio Ferreira Peixoto
- **Código:** 9436
- **CPF:** 2100610066 (ou 02100610066 com zero à esquerda)
- **Cidade:** Alvorada - RS

---

## 🔍 Passo 1: Verificar se o Motorista Existe

Execute o script SQL para verificar:

```sql
-- Executar no SQL Server Management Studio
-- Arquivo: backend/scripts/verificar_motorista_por_codigo.sql
```

Ou execute diretamente:

```sql
USE [DIVULGACARGA_PRD]
GO

-- Buscar por código
SELECT 
    cg.CDCADASTRO AS CODIGO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.FGTIPOCADASTRO AS TIPO,
    cg.FGACTIVE AS STATUS,
    mc.STATUSAPROVACAO AS APROVACAO
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CDCADASTRO = 9436;
```

---

## 🔧 Passo 2: Corrigir/Criar Motorista (se necessário)

### Se o motorista EXISTE mas não consegue fazer login:

```bash
# Verificar e corrigir
node backend/scripts/corrigir_motorista.js 2100610066
```

### Se o motorista NÃO EXISTE:

```bash
# Criar novo motorista
node backend/scripts/criar_motorista.js 2100610066 "Mauricio Ferreira Peixoto" 51999999999
```

**Nota:** Substitua `51999999999` pelo celular real do motorista.

---

## 🚀 Passo 3: Acessar o Sistema

### **Opção A: Sistema Web (Operador)**

1. Acesse: `http://localhost:3000/` ou `http://192.168.1.173:3000/`
2. Faça login com suas credenciais de operador
3. Vá em **Gerenciar Cadastros** → Busque pelo código **9436** ou CPF **2100610066**

### **Opção B: App do Motorista**

1. Acesse: `http://localhost:3000/motorista/` ou `http://192.168.1.173:3000/motorista/`
2. Digite o **CPF**: `2100610066` (ou `02100610066` se tiver zero à esquerda)
3. Digite a **senha**:
   - Se não tiver senha definida: **qualquer senha** (ex: `123456`)
   - Se tiver senha: use a senha definida

---

## 🔐 Definir Senha para o Motorista

Se quiser definir uma senha permanente:

```bash
node backend/scripts/definir_senha_motorista.js 2100610066 senha123
```

Depois disso, o motorista precisará usar essa senha para fazer login.

---

## ⚠️ Problemas Comuns

### "Motorista não encontrado ou inativo"

**Causa:** Motorista não existe, está inativo ou não é do tipo 'M'

**Solução:**
1. Verifique se existe no banco (script SQL acima)
2. Se existir, corrija com: `node backend/scripts/corrigir_motorista.js 2100610066`
3. Se não existir, crie com: `node backend/scripts/criar_motorista.js ...`

### "Cadastro pendente de aprovação"

**Causa:** Motorista não está aprovado

**Solução SQL:**
```sql
UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
SET STATUSAPROVACAO = 'A',  -- A = Aprovado
    DHAPROVACAO = GETDATE()
WHERE CDCADASTRO = 9436;
```

### CPF com ou sem zero à esquerda?

O sistema aceita ambos os formatos:
- `2100610066` (10 dígitos)
- `02100610066` (11 dígitos com zero à esquerda)

Tente ambos no login se um não funcionar.

---

## 📋 Checklist de Verificação

- [ ] Motorista existe no banco (código 9436)
- [ ] Tipo de cadastro é 'M' (Motorista)
- [ ] Status é 'A' (Ativo)
- [ ] Tem registro em MOTORISTA_COMPLEMENTO
- [ ] Status de aprovação é 'A' (Aprovado)
- [ ] Senha definida (ou aceita qualquer senha)

---

## 🎯 Resumo Rápido

**Para acessar AGORA:**

1. URL: `http://localhost:3000/motorista/`
2. CPF: `2100610066` (ou `02100610066`)
3. Senha: `123456` (ou qualquer outra se não tiver senha definida)

**Se não funcionar:**

1. Execute: `node backend/scripts/corrigir_motorista.js 2100610066`
2. Verifique os resultados
3. Tente fazer login novamente

