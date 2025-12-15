# ⚙️ Configuração de Bancos de Dados

## 📋 Bancos Configurados

O sistema utiliza dois bancos de dados:

### 1. **DIVULGACARGA_PRD** (Banco Principal)
- **Uso:** Banco principal do sistema
- **Configuração:** Via variáveis de ambiente padrão

### 2. **INTEGRA_PRD** (Banco de Migração)
- **Uso:** Banco de origem para migração de dados
- **Configuração:** Via variáveis de ambiente específicas

---

## 🔧 Variáveis de Ambiente

### Banco Principal (DIVULGACARGA_PRD)

Adicione no arquivo `backend/.env`:

```env
# Banco Principal - DIVULGACARGA_PRD
DB_SERVER=200.98.128.159
DB_PORT=35987
DB_DATABASE=DIVULGACARGA_PRD
DB_USER=sa
DB_PASSWORD=!ntegr@SQL2014
```

### Banco de Migração (INTEGRA_PRD)

Adicione no arquivo `backend/.env`:

```env
# Banco de Migração - INTEGRA_PRD
INTEGRA_DB_SERVER=186.250.92.131
INTEGRA_DB_PORT=35987
INTEGRA_DB_DATABASE=INTEGRA_PRD
INTEGRA_DB_USER=sa
INTEGRA_DB_PASSWORD=SistMSQLServer2025&*
```

**⚠️ IMPORTANTE:** Se as variáveis `INTEGRA_*` não forem definidas, o sistema usará os valores padrão acima.

---

## 📝 Arquivo .env Completo

```env
# ============================================================================
# BANCO PRINCIPAL - DIVULGACARGA_PRD
# ============================================================================
DB_SERVER=200.98.128.159
DB_PORT=35987
DB_DATABASE=DIVULGACARGA_PRD
DB_USER=sa
DB_PASSWORD=!ntegr@SQL2014

# ============================================================================
# BANCO DE MIGRAÇÃO - INTEGRA_PRD
# ============================================================================
INTEGRA_DB_SERVER=186.250.92.131
INTEGRA_DB_PORT=35987
INTEGRA_DB_DATABASE=INTEGRA_PRD
INTEGRA_DB_USER=sa
INTEGRA_DB_PASSWORD=SistMSQLServer2025&*

# ============================================================================
# OUTRAS CONFIGURAÇÕES
# ============================================================================
JWT_SECRET=sua-chave-secreta-jwt-aqui
PUBLIC_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
```

---

## 🔌 Como Usar no Código

### Banco Principal (DIVULGACARGA_PRD)

```javascript
const { poolPromise } = require('../config/db');

// Usar normalmente
const pool = await poolPromise;
const result = await pool.request().query('SELECT * FROM CADASTROGERAL');
```

### Banco de Migração (INTEGRA_PRD)

```javascript
const { poolIntegraPromise } = require('../config/db');

// Verificar se a conexão está disponível
const poolIntegra = await poolIntegraPromise;
if (poolIntegra) {
  const result = await poolIntegra.request().query('SELECT * FROM CADASTROGERAL');
} else {
  console.warn('INTEGRA_PRD não está disponível');
}
```

---

## ⚠️ Notas Importantes

1. **Conexões Separadas:** Cada banco tem seu próprio pool de conexões
2. **Falha Tolerante:** Se o INTEGRA_PRD não estiver disponível, o sistema continua funcionando normalmente
3. **Segurança:** Nunca commite o arquivo `.env` no Git
4. **Produção:** Use variáveis de ambiente do sistema operacional ou serviço de hospedagem

---

## 🔍 Verificação

Após configurar, reinicie o servidor e verifique os logs:

```
✅ Conexão com DIVULGACARGA_PRD estabelecida
✅ Conexão com INTEGRA_PRD estabelecida
```

Se aparecer um aviso sobre INTEGRA_PRD, verifique:
- Servidor acessível
- Porta correta
- Credenciais corretas
- Firewall/redes permitindo conexão
