# 🔧 Solução: Erro 401 no Login do Motorista

## 📋 Problema

Ao tentar fazer login no app do motorista, você recebe o erro:
```
POST http://localhost:3000/api/motorista/login 401 (Unauthorized)
```

## 🔍 Diagnóstico Rápido

### Passo 1: Verificar o Motorista no Banco de Dados

Execute o script SQL de diagnóstico:

```sql
-- Abra o arquivo: backend/scripts/diagnosticar_login_motorista.sql
-- Substitua 'SEU_CPF_AQUI' pelo CPF do motorista
-- Execute no SQL Server Management Studio
```

Ou execute diretamente no banco:

```sql
DECLARE @CPF VARCHAR(14) = '12345678901'; -- ⚠️ ALTERE AQUI

SELECT 
    cg.CDCADASTRO,
    cg.CGCCPF,
    cg.RZSOCIAL,
    cg.FGTIPOCADASTRO,
    cg.FGACTIVE,
    mc.STATUSAPROVACAO,
    CASE WHEN mc.SENHA IS NULL THEN 'SEM SENHA' ELSE 'COM SENHA' END AS TEM_SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CGCCPF = @CPF OR cg.CGCCPF = REPLACE(REPLACE(REPLACE(@CPF, '.', ''), '-', ''), ' ', '');
```

### Passo 2: Verificar Condições Necessárias

O motorista precisa atender **TODAS** estas condições:

1. ✅ **Tipo de Cadastro = 'M'** (Motorista)
2. ✅ **Status Ativo = 'A'** (Ativo)
3. ✅ **Status Aprovação = 'A'** (Aprovado) ou NULL
4. ✅ **CPF correto** (com ou sem formatação)

## 🛠️ Soluções Comuns

### Problema 1: Motorista Não Encontrado

**Sintoma:** Erro 401 com mensagem "Motorista não encontrado ou inativo"

**Causas possíveis:**
- CPF digitado incorretamente
- CPF não está cadastrado no sistema
- CPF está em formato diferente no banco (com/sem zero à esquerda)

**Solução:**
1. Verifique o CPF no banco de dados
2. Tente com e sem formatação (123.456.789-01 ou 12345678901)
3. Verifique se o CPF tem zero à esquerda no banco

### Problema 2: Motorista Inativo

**Sintoma:** Erro 401 com mensagem "Motorista não encontrado ou inativo"

**Solução:**
```sql
-- Ativar motorista
UPDATE CADASTROGERAL 
SET FGACTIVE = 'A' 
WHERE CGCCPF = '12345678901'; -- ⚠️ ALTERE O CPF
```

### Problema 3: Tipo de Cadastro Incorreto

**Sintoma:** Erro 401

**Solução:**
```sql
-- Corrigir tipo de cadastro
UPDATE CADASTROGERAL 
SET FGTIPOCADASTRO = 'M' 
WHERE CGCCPF = '12345678901'; -- ⚠️ ALTERE O CPF
```

### Problema 4: Cadastro Pendente ou Rejeitado

**Sintoma:** Erro 403 com mensagem "Cadastro pendente de aprovação" ou "Cadastro rejeitado"

**Solução:**
```sql
-- Aprovar motorista
UPDATE MOTORISTA_COMPLEMENTO 
SET STATUSAPROVACAO = 'A' 
WHERE CDCADASTRO = (
    SELECT CDCADASTRO 
    FROM CADASTROGERAL 
    WHERE CGCCPF = '12345678901' -- ⚠️ ALTERE O CPF
);
```

### Problema 5: Senha Incorreta

**Sintoma:** Erro 401 com mensagem "Senha incorreta"

**Solução:**
1. Se o motorista **não tem senha definida**, qualquer senha deve funcionar
2. Se o motorista **tem senha definida**, use a senha correta
3. Para redefinir a senha, use o script: `backend/scripts/definir_senha_motorista.js`

### Problema 6: JWT_SECRET Não Configurado

**Sintoma:** Erro 500 ou erro ao gerar token

**Solução:**
1. Verifique se o arquivo `.env` existe em `backend/.env`
2. Verifique se tem a variável `JWT_SECRET` configurada
3. Reinicie o servidor após configurar

```env
JWT_SECRET=sua-chave-secreta-aqui-minimo-32-caracteres
```

## 🔍 Verificação no Console do Navegador

Após a atualização do código, o console do navegador mostrará mais informações:

1. Abra o **DevTools** (F12)
2. Vá na aba **Console**
3. Tente fazer login novamente
4. Verifique as mensagens:
   - `🔐 Tentando fazer login com CPF: ...`
   - `📡 Resposta do servidor: ...`
   - `📦 Dados recebidos: ...`

Isso ajudará a identificar exatamente onde está o problema.

## 📝 Checklist de Verificação

Antes de reportar o problema, verifique:

- [ ] Motorista existe no banco de dados
- [ ] CPF está correto (com e sem formatação)
- [ ] `FGTIPOCADASTRO = 'M'`
- [ ] `FGACTIVE = 'A'`
- [ ] `STATUSAPROVACAO = 'A'` ou NULL
- [ ] Senha está correta (se tiver senha definida)
- [ ] Servidor está rodando (`http://localhost:3000`)
- [ ] `JWT_SECRET` está configurado no `.env`
- [ ] Verificou os logs do servidor (console do Node.js)

## 🚀 Scripts Úteis

### Verificar Motorista
```bash
# Execute no SQL Server Management Studio
backend/scripts/diagnosticar_login_motorista.sql
```

### Corrigir Motorista
```bash
# Execute no Node.js (backend/)
node scripts/corrigir_motorista.js
```

### Definir Senha
```bash
# Execute no Node.js (backend/)
node scripts/definir_senha_motorista.js
```

## 📞 Ainda com Problemas?

Se após seguir todos os passos o problema persistir:

1. **Verifique os logs do servidor** (console onde o Node.js está rodando)
2. **Verifique o console do navegador** (F12 > Console)
3. **Execute o script de diagnóstico SQL** e compartilhe o resultado
4. **Verifique se o servidor está respondendo**: Acesse `http://localhost:3000/api/motorista/login` no navegador (deve retornar erro de método, não 404)

---

**Última atualização:** 2025-01-18
