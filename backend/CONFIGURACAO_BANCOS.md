# ⚙️ Configuração de Bancos de Dados

## 📋 Bancos Configurados

O sistema utiliza dois bancos de dados:

### 1. **ATLAS_CARGO_PRD** (Banco Principal)
- **Uso:** Banco principal do sistema
- **Configuração:** Via variáveis de ambiente padrão

### 2. **INTEGRA_PRD** (Banco de Migração)
- **Uso:** Banco de origem para migração de dados
- **Configuração:** Via variáveis de ambiente específicas

**⚠️ IMPORTANTE:** Ambos os bancos estão no mesmo servidor SQL Server (`186.250.92.131,35987`).

---

## 🔧 Variáveis de Ambiente

### Banco Principal (ATLAS_CARGO_PRD)

Adicione no arquivo `backend/.env`:

```env
# Banco Principal - ATLAS_CARGO_PRD
DB_SERVER=186.250.92.131
DB_PORT=35987
DB_DATABASE=ATLAS_CARGO_PRD
DB_USER=sa
DB_PASSWORD=SistMSQLServer2026&*
```

### Banco de Migração (INTEGRA_PRD)

Adicione no arquivo `backend/.env`:

```env
# Banco de Migração - INTEGRA_PRD
# NOTA: Mesmo servidor do ATLAS_CARGO_PRD
INTEGRA_DB_SERVER=186.250.92.131
INTEGRA_DB_PORT=35987
INTEGRA_DB_DATABASE=INTEGRA_PRD
INTEGRA_DB_USER=sa
INTEGRA_DB_PASSWORD=SistMSQLServer2026&*
```

**⚠️ IMPORTANTE:** 
- Ambos os bancos estão no mesmo servidor (`186.250.92.131,35987`)
- Se as variáveis `INTEGRA_*` não forem definidas, o sistema usará os valores padrão acima
- Se `INTEGRA_DB_SERVER`, `INTEGRA_DB_PORT`, `INTEGRA_DB_USER` ou `INTEGRA_DB_PASSWORD` não forem definidas, o sistema usará os valores do banco principal (DB_*)

---

## 📝 Arquivo .env Completo

```env
# ============================================================================
# BANCO PRINCIPAL - ATLAS_CARGO_PRD
# ============================================================================
DB_SERVER=186.250.92.131
DB_PORT=35987
DB_DATABASE=ATLAS_CARGO_PRD
DB_USER=sa
DB_PASSWORD=SistMSQLServer2026&*

# ============================================================================
# BANCO DE MIGRAÇÃO - INTEGRA_PRD
# NOTA: Mesmo servidor do ATLAS_CARGO_PRD
# ============================================================================
INTEGRA_DB_SERVER=186.250.92.131
INTEGRA_DB_PORT=35987
INTEGRA_DB_DATABASE=INTEGRA_PRD
INTEGRA_DB_USER=sa
INTEGRA_DB_PASSWORD=SistMSQLServer2026&*

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

### Banco Principal (ATLAS_CARGO_PRD)

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
✅ Conexão com ATLAS_CARGO_PRD estabelecida
✅ Conexão com INTEGRA_PRD estabelecida
```

Se aparecer um aviso sobre INTEGRA_PRD, verifique:
- Servidor acessível
- Porta correta
- Credenciais corretas
- Firewall/redes permitindo conexão
