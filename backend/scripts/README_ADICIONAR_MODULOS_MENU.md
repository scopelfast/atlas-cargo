# 📋 Script: Adicionar Módulos ao Menu

**Arquivo:** `adicionar_modulos_alertas_chat_sos_ranking_menu.sql`  
**Data:** 2025-01-18  
**Versão:** 1.0

---

## 🎯 Objetivo

Adicionar os 4 novos módulos (Alertas, Chat, SOS, Ranking) ao menu do sistema, criando os registros necessários nas tabelas `TIPOATIVIDADE` e `USUARIOATIVIDADE`.

---

## 📊 O que o script faz

### 1. Cria registros na tabela TIPOATIVIDADE

Adiciona 4 novos itens de menu:

| Código | Nome | Programa | Caminho |
|--------|------|---------|---------|
| 40 | 4.0.Alertas | `alertas` | `/modulos/alertas/index.html` |
| 41 | 4.1.Chat | `chat` | `/modulos/chat/index.html` |
| 42 | 4.2.SOS | `sos` | `/modulos/sos/index.html` |
| 43 | 4.3.Ranking | `ranking` | `/modulos/ranking/index.html` |

### 2. Concede permissão ao usuário Admin

Adiciona registros na tabela `USUARIOATIVIDADE` para que o usuário `Admin` tenha acesso aos 4 módulos.

### 3. Verificação final

Exibe uma consulta mostrando os módulos adicionados para confirmação.

---

## 🚀 Como Executar

### Opção 1: SQL Server Management Studio (SSMS)

1. Abra o SQL Server Management Studio
2. Conecte-se ao servidor do banco de dados
3. Selecione o banco `DIVULGACARGA_PRD`
4. Abra o arquivo `adicionar_modulos_alertas_chat_sos_ranking_menu.sql`
5. Execute o script (F5 ou botão Execute)

### Opção 2: Linha de Comando (sqlcmd)

```bash
sqlcmd -S servidor -d DIVULGACARGA_PRD -i backend/scripts/adicionar_modulos_alertas_chat_sos_ranking_menu.sql
```

---

## ✅ Verificação Pós-Execução

### Verificar se os módulos foram adicionados:

```sql
SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome',
    DSPROGRAMA AS 'Programa',
    FGACTIVE AS 'Ativo'
FROM [dbo].[TIPOATIVIDADE]
WHERE CDTIPOATIVIDADE IN (40, 41, 42, 43)
ORDER BY CDTIPOATIVIDADE;
```

**Resultado esperado:**
```
ID  | Nome          | Programa | Ativo
----|---------------|----------|-------
40  | 4.0.Alertas   | alertas  | S
41  | 4.1.Chat      | chat     | S
42  | 4.2.SOS       | sos      | S
43  | 4.3.Ranking   | ranking  | S
```

### Verificar permissões do Admin:

```sql
SELECT 
    UA.SGUSUARIO AS 'Usuário',
    T.CDTIPOATIVIDADE AS 'ID',
    T.DSTIPOATIVIDADE AS 'Módulo'
FROM [dbo].[USUARIOATIVIDADE] UA
INNER JOIN [dbo].[TIPOATIVIDADE] T ON UA.CDTIPOATIVIDADE = T.CDTIPOATIVIDADE
WHERE UA.SGUSUARIO = 'Admin'
  AND T.CDTIPOATIVIDADE IN (40, 41, 42, 43)
ORDER BY T.CDTIPOATIVIDADE;
```

---

## 🔐 Conceder Permissão a Outros Usuários

### Para um usuário específico:

```sql
-- Alertas
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
VALUES ('NOME_USUARIO', 40, GETDATE(), 'SYSTEM', 'AppDVcargas');

-- Chat
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
VALUES ('NOME_USUARIO', 41, GETDATE(), 'SYSTEM', 'AppDVcargas');

-- SOS
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
VALUES ('NOME_USUARIO', 42, GETDATE(), 'SYSTEM', 'AppDVcargas');

-- Ranking
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
VALUES ('NOME_USUARIO', 43, GETDATE(), 'SYSTEM', 'AppDVcargas');
```

### Para TODOS os usuários ativos:

Descomente a seção 7 do script SQL (`adicionar_modulos_alertas_chat_sos_ranking_menu.sql`) e execute novamente.

---

## ⚠️ Importante

1. **Idempotente:** O script pode ser executado múltiplas vezes sem problemas
2. **Seguro:** Não remove dados existentes, apenas adiciona/atualiza
3. **Verificação:** O script verifica se os registros já existem antes de criar
4. **Permissões:** Por padrão, apenas o usuário `Admin` recebe permissão

---

## 🎨 Ícones no Menu

Os ícones foram configurados no arquivo `backend/public/js/dashboard.js`:

- **Alertas (40):** `bell` (bx-bell) - 🔔
- **Chat (41):** `message` (bx-message) - 💬
- **SOS (42):** `error-circle` (bx-error-circle) - ⚠️
- **Ranking (43):** `trophy` (bx-trophy) - 🏆

---

## 📝 Próximos Passos

Após executar o script:

1. ✅ Verificar se os módulos aparecem no menu do usuário Admin
2. ✅ Conceder permissões a outros usuários conforme necessário
3. ⏳ Criar os arquivos HTML/JS/CSS dos módulos frontend
4. ⏳ Testar a navegação para os módulos

---

## 🔗 Arquivos Relacionados

- `backend/routes/menu.routes.js` - Rota que carrega o menu
- `backend/public/js/dashboard.js` - Lógica do menu e ícones
- `backend/controllers/tipoatividade.controller.js` - Gerenciamento de atividades

---

**Criado em:** 2025-01-18  
**Autor:** Sistema DivulgaCarga
