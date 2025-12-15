# 🔗 Configuração do Linked Server INTEGRA_PRD

## ⚠️ Problema

As stored procedures do sistema usam a sintaxe `[INTEGRA_PRD].[dbo].[TABELA]` para acessar o banco INTEGRA_PRD. Isso requer um **Linked Server** configurado no SQL Server do DIVULGACARGA_PRD.

Quando o banco INTEGRA_PRD muda de endereço ou credenciais, o linked server precisa ser atualizado.

## 🔧 Solução

Execute o script SQL para configurar/atualizar o linked server:

**Arquivo:** `backend/scripts/configurar_linked_server_integra.sql`

## 📋 Como Executar

### Opção 1: SQL Server Management Studio (SSMS)

1. Abra o SQL Server Management Studio
2. Conecte-se ao servidor do **DIVULGACARGA_PRD**:
   - Servidor: `200.98.128.159,35987`
   - Autenticação: SQL Server
   - Usuário: `sa`
   - Senha: `!ntegr@SQL2014`
3. Abra o arquivo `configurar_linked_server_integra.sql`
4. Execute o script (F5)

### Opção 2: Via linha de comando (sqlcmd)

```bash
sqlcmd -S 200.98.128.159,35987 -U sa -P "!ntegr@SQL2014" -d DIVULGACARGA_PRD -i backend/scripts/configurar_linked_server_integra.sql
```

## ✅ Verificação

Após executar o script, teste a conexão:

```sql
USE [DIVULGACARGA_PRD];
GO

-- Teste simples
SELECT TOP 1 * FROM [INTEGRA_PRD].[dbo].[CADASTROGERAL];
GO
```

Se retornar dados, o linked server está funcionando corretamente!

## 🔍 Verificar Linked Server Existente

Para verificar se o linked server está configurado:

```sql
-- Listar todos os linked servers
SELECT * FROM sys.servers WHERE is_linked = 1;

-- Ver detalhes do INTEGRA_PRD
EXEC sp_helpserver 'INTEGRA_PRD';
```

## 🗑️ Remover Linked Server (se necessário)

Se precisar remover o linked server:

```sql
USE [DIVULGACARGA_PRD];
GO

-- Remover mapeamentos de login
EXEC sp_dropserverlogin 'INTEGRA_PRD', NULL;

-- Remover linked server
EXEC sp_dropserver 'INTEGRA_PRD', 'droplogins';
GO
```

## 📝 Dados Configurados

O script configura o linked server com:

- **Nome:** `INTEGRA_PRD`
- **Servidor:** `186.250.92.131,35987`
- **Banco:** `INTEGRA_PRD`
- **Usuário:** `sa`
- **Senha:** `SistMSQLServer2025&*`

## ⚠️ Importante

1. **Execute no banco correto:** O script deve ser executado no banco **DIVULGACARGA_PRD**
2. **Permissões:** É necessário ter permissões de sysadmin ou serveradmin
3. **Firewall:** Certifique-se de que o firewall permite conexão entre os servidores
4. **Rede:** Os servidores precisam estar acessíveis entre si na rede

## 🔄 Após Configurar

Após configurar o linked server:

1. Reinicie o servidor Node.js (se estiver rodando)
2. Teste o módulo "Gerenciar Cadastro Geral"
3. O erro de banco offline não deve mais aparecer

## 🐛 Troubleshooting

### Erro: "You cannot specify a provider or any properties for product 'SQL Server'"

**Causa:** Quando `@srvproduct = 'SQL Server'`, o SQL Server não permite especificar provider ou datasrc.

**Solução:** O script foi corrigido para usar `@srvproduct = ''` (vazio) quando especificamos provider e datasrc.

### Erro: "Cannot open server 'INTEGRA_PRD'"

- Verifique se o linked server foi criado: `SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD'`
- Verifique as credenciais no linked server
- Teste a conectividade de rede entre os servidores
- Execute: `EXEC sp_helpserver 'INTEGRA_PRD'` para ver detalhes

### Erro: "Login failed for user"

- Verifique se o usuário `sa` e senha estão corretos no INTEGRA_PRD
- Verifique se o SQL Server do INTEGRA_PRD permite autenticação SQL Server
- Verifique se o firewall permite conexão na porta 35987

### Erro: "Database 'INTEGRA_PRD' cannot be opened because it is offline"

**Causa:** O banco de dados INTEGRA_PRD está offline no servidor remoto.

**Solução:**

1. **Conecte-se diretamente ao servidor INTEGRA_PRD:**
   - Servidor: `186.250.92.131,35987`
   - Usuário: `sa`
   - Senha: `SistMSQLServer2025&*`

2. **Execute o script de verificação:**
   - Arquivo: `backend/scripts/verificar_ativar_integra_prd.sql`
   - Ou execute manualmente:

```sql
-- Verificar status
SELECT name, state_desc FROM sys.databases WHERE name = 'INTEGRA_PRD';

-- Ativar banco
ALTER DATABASE [INTEGRA_PRD] SET ONLINE;

-- Verificar novamente
SELECT name, state_desc FROM sys.databases WHERE name = 'INTEGRA_PRD';
```

**⚠️ IMPORTANTE:** Este comando deve ser executado **DIRETAMENTE** no servidor do INTEGRA_PRD, não através do linked server.

### Erro: "Timeout"

- Aumente o timeout nas opções do linked server
- Verifique a latência de rede entre os servidores
- Verifique se o servidor remoto está acessível: `telnet 186.250.92.131 35987`
