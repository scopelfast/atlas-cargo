# Como Testar o Webhook Callback Meta

## 🚀 Formas de Testar

### 1. **Usando PowerShell (Windows)**

#### Testar Aceitar Convocação:
```powershell
.\simular-retorno-webhook.ps1 -IDCONVOCACAO 181 -Cenario aceitar
```

#### Testar Recusar Convocação:
```powershell
.\simular-retorno-webhook.ps1 -IDCONVOCACAO 181 -Cenario recusar
```

#### Testar Apenas Localização:
```powershell
.\simular-retorno-webhook.ps1 -IDCONVOCACAO 181 -Cenario localizacao
```

---

### 2. **Usando Bash/Linux/Mac**

#### Testar Aceitar Convocação:
```bash
chmod +x simular-retorno-webhook.sh
./simular-retorno-webhook.sh 181 aceitar
```

#### Testar Recusar Convocação:
```bash
./simular-retorno-webhook.sh 181 recusar
```

#### Testar Apenas Localização:
```bash
./simular-retorno-webhook.sh 181 localizacao
```

---

### 3. **Usando cURL Diretamente**

#### Aceitar Convocação:
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 181,
    "STATUS": "ACEITA",
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733
  }'
```

#### Recusar Convocação:
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 181,
    "STATUS": "RECUSADA",
    "CDMOTIVORECUSA": 1
  }'
```

#### Apenas Localização:
```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 181,
    "LATITUDE": -25.4284,
    "LONGITUDE": -49.2733
  }'
```

---

### 4. **Usando Postman ou Insomnia**

**Método:** `POST`  
**URL:** `http://localhost:3000/api/webhook-meta-callback`  
**Headers:**
```
Content-Type: application/json
```

**Body (JSON) - Aceitar:**
```json
{
  "IDCONVOCACAO": 181,
  "STATUS": "ACEITA",
  "LATITUDE": -25.4284,
  "LONGITUDE": -49.2733
}
```

**Body (JSON) - Recusar:**
```json
{
  "IDCONVOCACAO": 181,
  "STATUS": "RECUSADA",
  "CDMOTIVORECUSA": 1
}
```

---

## ✅ Como Verificar se Funcionou

### 1. **Console do Servidor**
Procure por logs com `[WEBHOOK CALLBACK META]`:
```
[WEBHOOK CALLBACK META] Dados recebidos: { IDCONVOCACAO: 181, ... }
[WEBHOOK CALLBACK META] Executando query: UPDATE [dbo].[CONVOCACAO] ...
[WEBHOOK CALLBACK META] Convocação atualizada com sucesso. Linhas afetadas: 1
```

### 2. **Banco de Dados**
Execute esta query:
```sql
SELECT 
    IDCONVOCACAO,
    STATUS,
    DHRESPOSTA,
    LATITUDE,
    LONGITUDE,
    CDMOTIVORECUSA,
    DHMAINTENANCE,
    SGUSER
FROM [dbo].[CONVOCACAO]
WHERE IDCONVOCACAO = 181;
```

**Verifique:**
- ✅ `DHRESPOSTA` foi preenchido
- ✅ `STATUS` foi atualizado
- ✅ `LATITUDE` e `LONGITUDE` foram preenchidos (se enviados)
- ✅ `SGUSER` = `'DESKRIO'`
- ✅ `DHMAINTENANCE` foi atualizado

### 3. **Interface Web**
- Aba "Gerenciar Viagens" → "Convocações"
- Verifique se o STATUS da convocação mudou
- Se aceita: `PENDENTE` → `ACEITA`
- Se recusada: `PENDENTE` → `RECUSADA`

---

## 📋 Resposta Esperada

### Sucesso:
```json
{
  "success": true,
  "message": "Dados recebidos e atualizados com sucesso!",
  "camposAtualizados": {
    "STATUS": "ACEITA",
    "DHRESPOSTA": "atualizado",
    "LATITUDE": "atualizado",
    "LONGITUDE": "atualizado",
    "CDMOTIVORECUSA": "não fornecido",
    "DHMAINTENANCE": "atualizado",
    "SGUSER": "DESKRIO"
  }
}
```

### Erro (Convocação não encontrada):
```json
{
  "error": "Convocação não encontrada."
}
```

### Erro (IDCONVOCACAO obrigatório):
```json
{
  "error": "IDCONVOCACAO é obrigatório."
}
```

---

## 🎯 Cenários de Teste

### Cenário 1: Motorista Aceita
- **STATUS:** `ACEITA`
- **LATITUDE/LONGITUDE:** Preenchidos
- **Resultado:** Convocação aceita, localização salva

### Cenário 2: Motorista Recusa
- **STATUS:** `RECUSADA`
- **CDMOTIVORECUSA:** Preenchido
- **Resultado:** Convocação recusada, motivo salvo

### Cenário 3: Apenas Localização
- **LATITUDE/LONGITUDE:** Preenchidos
- **STATUS:** Não enviado
- **Resultado:** Se PENDENTE, muda para ACEITA automaticamente

---

## 💡 Dicas

1. **Use IDs de convocações que existem no banco**
2. **Verifique o console do servidor em tempo real**
3. **Teste com diferentes STATUS para validar a lógica**
4. **Para produção, altere a URL nos scripts para:**
   ```
   http://cargas.integrabrasil.com:8083/api/webhook-meta-callback
   ```

