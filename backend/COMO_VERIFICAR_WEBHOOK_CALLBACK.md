# Como Verificar os Retornos do Webhook Meta

## 📍 Onde os Retornos são Recebidos

### 1. **Console do Servidor (Terminal)**

Quando o webhook callback é recebido, você verá logs no console do servidor com o prefixo `[WEBHOOK CALLBACK META]`:

```
[WEBHOOK CALLBACK META] Dados recebidos: { IDCONVOCACAO: 181, LATITUDE: -25.4284, LONGITUDE: -49.2733, STATUS: 'ACEITA' }
[WEBHOOK CALLBACK META] Executando query: UPDATE [dbo].[CONVOCACAO] SET ...
[WEBHOOK CALLBACK META] Convocação atualizada com sucesso. Linhas afetadas: 1
```

**Onde ver:** No terminal onde o servidor está rodando (`npm run dev`)

---

## 💾 Onde os Dados são Gravados

Os dados são gravados na tabela **`CONVOCACAO`** no banco de dados SQL Server.

### Campos Atualizados:

| Campo | Descrição | Quando é Atualizado |
|-------|-----------|---------------------|
| `STATUS` | Status da convocação | Sempre que STATUS for enviado ou determinado automaticamente |
| `DHRESPOSTA` | Data/hora da resposta | **SEMPRE** atualizado quando há retorno |
| `LATITUDE` | Latitude da localização | Quando LATITUDE for enviada |
| `LONGITUDE` | Longitude da localização | Quando LONGITUDE for enviada |
| `CDMOTIVORECUSA` | Código do motivo de recusa | Quando CDMOTIVORECUSA for enviado |
| `DHMAINTENANCE` | Data/hora de manutenção | **SEMPRE** atualizado |
| `SGUSER` | Usuário que fez a alteração | **SEMPRE** setado como `'DESKRIO'` |

---

## 🔍 Como Verificar no Banco de Dados

### Query para Verificar uma Convocação Específica:

```sql
SELECT 
    IDCONVOCACAO,
    IDVIAGEM,
    STATUS,
    DHRESPOSTA,
    LATITUDE,
    LONGITUDE,
    CDMOTIVORECUSA,
    DHMAINTENANCE,
    SGUSER,
    DHCONVOCACAO
FROM [dbo].[CONVOCACAO]
WHERE IDCONVOCACAO = 181  -- Substitua pelo ID da convocação
```

### Query para Ver Todas as Convocações Atualizadas pelo Webhook:

```sql
SELECT 
    IDCONVOCACAO,
    IDVIAGEM,
    STATUS,
    DHRESPOSTA,
    LATITUDE,
    LONGITUDE,
    CDMOTIVORECUSA,
    DHMAINTENANCE,
    SGUSER
FROM [dbo].[CONVOCACAO]
WHERE SGUSER = 'DESKRIO'  -- Todas as atualizações feitas pelo webhook
ORDER BY DHMAINTENANCE DESC
```

### Query para Ver Convocações com Resposta Recente:

```sql
SELECT 
    IDCONVOCACAO,
    IDVIAGEM,
    STATUS,
    DHRESPOSTA,
    LATITUDE,
    LONGITUDE,
    CDMOTIVORECUSA,
    DHMAINTENANCE,
    SGUSER
FROM [dbo].[CONVOCACAO]
WHERE DHRESPOSTA IS NOT NULL
  AND SGUSER = 'DESKRIO'
ORDER BY DHRESPOSTA DESC
```

---

## ✅ Como Saber se Funcionou

### 1. **Verificar no Console do Servidor:**
- Procure por `[WEBHOOK CALLBACK META]`
- Deve aparecer: `Convocação atualizada com sucesso. Linhas afetadas: 1`

### 2. **Verificar no Banco de Dados:**
- Execute a query acima
- Verifique se:
  - `DHRESPOSTA` foi preenchido
  - `STATUS` foi atualizado (se foi enviado)
  - `LATITUDE` e `LONGITUDE` foram preenchidos (se foram enviados)
  - `SGUSER` = `'DESKRIO'`
  - `DHMAINTENANCE` foi atualizado

### 3. **Verificar na Interface:**
- Aba "Convocações" → Verifique se o STATUS da convocação foi atualizado
- Se foi aceita, o STATUS deve mudar de `PENDENTE` para `ACEITA`
- Se foi recusada, o STATUS deve mudar para `RECUSADA`

---

## 🧪 Teste Rápido

Execute este comando para testar:

```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d "{\"IDCONVOCACAO\": 181, \"STATUS\": \"ACEITA\", \"LATITUDE\": -25.4284, \"LONGITUDE\": -49.2733}"
```

Depois verifique:
1. **Console do servidor** → Deve aparecer os logs
2. **Banco de dados** → Execute a query para verificar a convocação 181
3. **Interface** → Aba Convocações → Verifique se o STATUS mudou

---

## 📝 Resumo

- **Logs:** Console do servidor (terminal)
- **Dados gravados:** Tabela `CONVOCACAO` no banco de dados
- **Campos principais:** `STATUS`, `DHRESPOSTA`, `LATITUDE`, `LONGITUDE`, `CDMOTIVORECUSA`
- **Identificador:** `SGUSER = 'DESKRIO'` indica que foi atualizado pelo webhook

