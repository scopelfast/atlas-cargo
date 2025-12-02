# Webhook Callback - Retorno do Meta

## Descrição

Este endpoint recebe os dados de retorno do webhook Meta após o processamento da convocação. **Não é necessário um serviço rodando constantemente** - é um endpoint HTTP padrão que recebe requisições POST do Meta.

## Endpoint

```
POST /api/webhook-meta-callback
Content-Type: application/json
```

## URL Completa

- **Local:** `http://localhost:3000/api/webhook-meta-callback`
- **Produção:** `http://cargas.integrabrasil.com:8083/api/webhook-meta-callback`

## Estrutura do Payload (JSON)

O DeskRio deve enviar um objeto JSON com os seguintes campos:

```json
{
  "IDCONVOCACAO": 161,
  "LATITUDE": -25.123456789012345,
  "LONGITUDE": -49.987654321098765,
  "CDMOTIVORECUSA": 1,
  "STATUS": "RECUSADA"
}
```

## Descrição dos Campos

| Campo | Tipo | Obrigatório | Descrição | Exemplo |
|-------|------|-------------|-----------|---------|
| `IDCONVOCACAO` | Integer | **Sim** | ID único da convocação no sistema | `161` |
| `LATITUDE` | Decimal (18,15) | Não* | Latitude da localização do motorista | `-25.123456789012345` |
| `LONGITUDE` | Decimal (18,15) | Não* | Longitude da localização do motorista | `-49.987654321098765` |
| `CDMOTIVORECUSA` | Integer | Não* | Código do motivo de recusa (se aplicável) | `1` |
| `STATUS` | String | Não | Status da convocação. Se não fornecido, será determinado automaticamente: `RECUSADA` se houver `CDMOTIVORECUSA`, `ACEITA` se houver localização e status atual for `PENDENTE` | `"RECUSADA"`, `"ACEITA"`, `"CONFIRMADA"` |

\* Pelo menos um dos campos opcionais deve ser enviado para que a atualização seja processada.

## Valores Possíveis de STATUS

- `PENDENTE` - Convocação aguardando resposta
- `ACEITA` - Convocação aceita pelo motorista
- `RECUSADA` - Convocação recusada pelo motorista
- `CONFIRMADA` - Convocação confirmada
- `ACEITA_DESCARTADA` - Convocação aceita mas descartada

## Exemplo de Requisição HTTP

```http
POST /api/webhook-meta-callback HTTP/1.1
Host: cargas.integrabrasil.com:8083
Content-Type: application/json

{
  "IDCONVOCACAO": 161,
  "LATITUDE": -25.123456789012345,
  "LONGITUDE": -49.987654321098765,
  "CDMOTIVORECUSA": 1
}
```

## Resposta de Sucesso

```json
{
  "success": true,
  "message": "Dados recebidos e atualizados com sucesso!",
  "camposAtualizados": [
    "LATITUDE = @LATITUDE",
    "LONGITUDE = @LONGITUDE",
    "CDMOTIVORECUSA = @CDMOTIVORECUSA"
  ]
}
```

## Respostas de Erro

### Erro 400 - Dados Inválidos

```json
{
  "error": "IDCONVOCACAO é obrigatório."
}
```

```json
{
  "error": "Nenhum campo válido para atualizar."
}
```

### Erro 404 - Convocação Não Encontrada

```json
{
  "error": "Convocação não encontrada."
}
```

### Erro 500 - Erro Interno

```json
{
  "error": "Erro ao processar retorno do webhook.",
  "details": "Mensagem de erro detalhada"
}
```

## Comportamento

1. **Validação:** O endpoint valida se `IDCONVOCACAO` foi fornecido e se a convocação existe no banco.
2. **Atualização Dinâmica:** Apenas os campos fornecidos são atualizados na tabela `CONVOCACAO`.
3. **Campos de Manutenção:** Os campos `DHMAINTENANCE` e `SGUSER` são atualizados automaticamente.
4. **Logs:** Todas as operações são registradas no console do servidor para debug.

## Tabela Atualizada

Os dados são atualizados na tabela `[dbo].[CONVOCACAO]`:

- `STATUS` → Campo `STATUS` (Varchar 20) - Determinado automaticamente ou pelo campo enviado
- `DHRESPOSTA` → Campo `DHRESPOSTA` (DateTime) - **Sempre atualizado** para `GETDATE()` quando há retorno
- `LATITUDE` → Campo `LATITUDE` (Decimal 18,15) - Se fornecido
- `LONGITUDE` → Campo `LONGITUDE` (Decimal 18,15) - Se fornecido
- `CDMOTIVORECUSA` → Campo `CDMOTIVORECUSA` (Integer) - Se fornecido
- `DHMAINTENANCE` → Campo `DHMAINTENANCE` (DateTime) - **Sempre atualizado** para `GETDATE()`
- `SGUSER` → Campo `SGUSER` (Varchar 50) - **Sempre atualizado** para `'DESKRIO'`

## Lógica de Determinação do STATUS

O STATUS é determinado automaticamente se não for fornecido:

1. **Se `CDMOTIVORECUSA` for fornecido** → STATUS = `'RECUSADA'`
2. **Se `LATITUDE` e `LONGITUDE` forem fornecidos** (sem `CDMOTIVORECUSA`) e STATUS atual for `'PENDENTE'` → STATUS = `'ACEITA'`
3. **Se `STATUS` for fornecido explicitamente** → Usa o valor fornecido
4. **Caso contrário** → STATUS não é alterado

## Configuração no Meta

O Meta deve ser configurado para fazer uma requisição POST para este endpoint sempre que houver dados de retorno (localização, motivo de recusa, etc.).

### Exemplo de Configuração

1. **URL do Callback:** `http://cargas.integrabrasil.com:8083/api/webhook-meta-callback`
2. **Método:** `POST`
3. **Content-Type:** `application/json`
4. **Timeout:** Recomendado 30 segundos

## Observações Importantes

1. **Não é necessário serviço rodando constantemente:** O endpoint é parte do servidor Express.js que já está rodando.
2. **Segurança:** Considere adicionar autenticação (token, API key) se necessário.
3. **Idempotência:** O endpoint pode ser chamado múltiplas vezes - apenas atualiza os campos fornecidos.
4. **Validação:** Campos numéricos são validados e convertidos automaticamente.
5. **Logs:** Todos os retornos são logados no console do servidor para auditoria.

## Exemplos de Uso

### Exemplo 1: Atualizar apenas localização (STATUS será ACEITA automaticamente se estiver PENDENTE)

```json
{
  "IDCONVOCACAO": 161,
  "LATITUDE": -25.123456789012345,
  "LONGITUDE": -49.987654321098765
}
```

**Resultado:**
- STATUS: `'ACEITA'` (se status atual for `'PENDENTE'`)
- DHRESPOSTA: Atualizado
- LATITUDE: Atualizado
- LONGITUDE: Atualizado
- SGUSER: `'DESKRIO'`

### Exemplo 2: Atualizar apenas motivo de recusa (STATUS será RECUSADA automaticamente)

```json
{
  "IDCONVOCACAO": 161,
  "CDMOTIVORECUSA": 1
}
```

**Resultado:**
- STATUS: `'RECUSADA'` (determinado automaticamente)
- DHRESPOSTA: Atualizado
- CDMOTIVORECUSA: Atualizado
- SGUSER: `'DESKRIO'`

### Exemplo 3: Atualizar todos os campos com STATUS explícito

```json
{
  "IDCONVOCACAO": 161,
  "LATITUDE": -25.123456789012345,
  "LONGITUDE": -49.987654321098765,
  "CDMOTIVORECUSA": 1,
  "STATUS": "RECUSADA"
}
```

**Resultado:**
- STATUS: `'RECUSADA'` (usado o valor fornecido)
- DHRESPOSTA: Atualizado
- LATITUDE: Atualizado
- LONGITUDE: Atualizado
- CDMOTIVORECUSA: Atualizado
- SGUSER: `'DESKRIO'`

### Exemplo 4: Confirmar convocação

```json
{
  "IDCONVOCACAO": 161,
  "STATUS": "CONFIRMADA",
  "LATITUDE": -25.123456789012345,
  "LONGITUDE": -49.987654321098765
}
```

**Resultado:**
- STATUS: `'CONFIRMADA'` (usado o valor fornecido)
- DHRESPOSTA: Atualizado
- LATITUDE: Atualizado
- LONGITUDE: Atualizado
- SGUSER: `'DESKRIO'`

## Troubleshooting

### Logs do Servidor

Todos os retornos são logados no console do servidor:

```
[WEBHOOK CALLBACK META] Dados recebidos: { IDCONVOCACAO: 161, LATITUDE: -25.123..., LONGITUDE: -49.987..., CDMOTIVORECUSA: 1 }
[WEBHOOK CALLBACK META] Executando query: UPDATE [dbo].[CONVOCACAO] SET ...
[WEBHOOK CALLBACK META] Convocação atualizada com sucesso. Linhas afetadas: 1
```

### Verificar se o Endpoint Está Funcionando

Você pode testar o endpoint usando curl ou Postman:

```bash
curl -X POST http://localhost:3000/api/webhook-meta-callback \
  -H "Content-Type: application/json" \
  -d '{
    "IDCONVOCACAO": 161,
    "LATITUDE": -25.123456789012345,
    "LONGITUDE": -49.987654321098765,
    "CDMOTIVORECUSA": 1
  }'
```

