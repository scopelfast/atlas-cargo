# Estrutura Completa - Webhook Aviso Rota Integra

## Endpoint
```
POST https://ia.riochat.com.br/webhook/aviso-rota-integra
Content-Type: application/json
```

## Observações Importantes

1. **Disparos Individuais**: Cada requisição envia **UM ÚNICO OBJETO** (não um array)
2. **Intervalo**: Há um intervalo de 1 segundo entre cada disparo
3. **Condição**: Só dispara se o campo `DHENVIOMETA` estiver vazio/null na tabela `CONVOCACAO`

## Estrutura do Payload (Objeto Individual)

Cada requisição POST envia um objeto JSON com os seguintes campos:

```json
{
  "IDCONVOCACAO": 154,
  "NRCELULAR": "41999598887",
  "LINKCONVOCACAO": "http://localhost:3000/convocacao/154",
  "ID": 82321,
  "TIPO": "05 - Entrega",
  "CLASSE": "25 - Truck Baú",
  "ROTA": "617 - Itapevi Sp / Belo Horizonte MG",
  "CARREGAMENTO": "01/12/2026 16:00",
  "DESCARGA": "02/12/2026 08:00",
  "CONTRATADOR": "Erasmo Araujo Santana",
  "FRETE": "3392,55",
  "PESO": "3790,000",
  "CUBAGEM": "0,000",
  "DETALHES": "FROTA\r\n01 - Frete Frota (Tabela) - R$ 3392.55"
}
```

**⚠️ IMPORTANTE:** O campo `TXTCONVOCACAO` **NÃO** é enviado no webhook. Apenas os campos acima são enviados.

## Exemplo Real do Log (Caso 1)

```json
{
  "IDCONVOCACAO": 154,
  "NRCELULAR": "41999598887",
  "LINKCONVOCACAO": "http://localhost:3000/convocacao/154",
  "ID": 82321,
  "TIPO": "05 - Entrega",
  "CLASSE": "25 - Truck Baú",
  "ROTA": "617 - Itapevi Sp / Belo Horizonte MG",
  "CARREGAMENTO": "01/12/2026 16:00",
  "DESCARGA": "02/12/2026 08:00",
  "CONTRATADOR": "Erasmo Araujo Santana",
  "FRETE": "3392,55",
  "PESO": "3790,000",
  "CUBAGEM": "0,000",
  "DETALHES": "FROTA\r\n01 - Frete Frota (Tabela) - R$ 3392.55"
}
```

## Exemplo Real do Log (Caso 2)

```json
{
  "IDCONVOCACAO": 155,
  "NRCELULAR": "41999598887",
  "LINKCONVOCACAO": "http://localhost:3000/convocacao/155",
  "ID": 82321,
  "TIPO": "05 - Entrega",
  "CLASSE": "25 - Truck Baú",
  "ROTA": "617 - Itapevi Sp / Belo Horizonte MG",
  "CARREGAMENTO": "01/12/2026 16:00",
  "DESCARGA": "02/12/2026 08:00",
  "CONTRATADOR": "Erasmo Araujo Santana",
  "FRETE": "3392,55",
  "PESO": "3790,000",
  "CUBAGEM": "0,000",
  "DETALHES": "FROTA\r\n01 - Frete Frota (Tabela) - R$ 3392.55"
}
```

## Descrição dos Campos

| Campo | Tipo | Obrigatório | Descrição | Exemplo |
|-------|------|-------------|-----------|---------|
| `IDCONVOCACAO` | Integer | Sim | ID único da convocação no sistema | `154` |
| `NRCELULAR` | String | Sim* | Número do celular do motorista (apenas dígitos, sem formatação). Pode ser `null` se não houver celular válido | `"41999598887"` ou `null` |
| `LINKCONVOCACAO` | String | Sim | URL completa do link da convocação. Em ambiente local: `http://localhost:3000/convocacao/{ID}`. Em produção: `http://cargas.integrabrasil.com:8083/convocacao/{ID}` | `"http://localhost:3000/convocacao/154"` |
| `ID` | Integer | Sim | ID da viagem | `82321` |
| `TIPO` | String | Sim | Tipo de viagem formatado (código - descrição) | `"05 - Entrega"` |
| `CLASSE` | String | Sim | Classe de frota formatada (código - descrição) | `"25 - Truck Baú"` |
| `ROTA` | String | Sim | Rota formatada. Se houver roteiro: `{IDROTEIRO} - {DSROTEIRO}`. Caso contrário: `{ORIGEM_CIDADE}/{ORIGEM_ESTADO} → {DESTINO_CIDADE}/{DESTINO_ESTADO}` | `"617 - Itapevi Sp / Belo Horizonte MG"` |
| `CARREGAMENTO` | String | Sim | Data/hora de carregamento formatada (DD/MM/YYYY HH:mm) | `"01/12/2026 16:00"` |
| `DESCARGA` | String | Sim | Data/hora de descarga formatada (DD/MM/YYYY HH:mm) | `"02/12/2026 08:00"` |
| `CONTRATADOR` | String | Sim | Nome do contratador ou "Não informado" | `"Erasmo Araujo Santana"` |
| `FRETE` | String | Sim | Valor do frete formatado como numérico apenas (sem "R$"), usando vírgula como separador decimal | `"3392,55"` |
| `PESO` | String | Sim | Peso da carga formatado como numérico apenas (sem "ton"), usando vírgula como separador decimal com 3 casas | `"3790,000"` |
| `CUBAGEM` | String | Sim | Cubagem da carga formatada como numérico apenas (sem "m³"), usando vírgula como separador decimal com 3 casas | `"0,000"` |
| `DETALHES` | String | Não | Observações da viagem (campo OBSERV). Pode ser vazio | `"FROTA\r\n01 - Frete Frota (Tabela) - R$ 3392.55"` |

\* `NRCELULAR` é obrigatório quando há celular válido cadastrado. Pode ser `null` se o motorista não tiver celular válido.

**⚠️ IMPORTANTE:** O campo `TXTCONVOCACAO` **NÃO** é enviado no webhook. Apenas os campos acima são enviados.

## Exemplo de Requisição HTTP Completa

```http
POST https://ia.riochat.com.br/webhook/aviso-rota-integra HTTP/1.1
Content-Type: application/json
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36

{
  "IDCONVOCACAO": 154,
  "NRCELULAR": "41999598887",
  "LINKCONVOCACAO": "http://localhost:3000/convocacao/154",
  "ID": 82321,
  "TIPO": "05 - Entrega",
  "CLASSE": "25 - Truck Baú",
  "ROTA": "617 - Itapevi Sp / Belo Horizonte MG",
  "CARREGAMENTO": "01/12/2026 16:00",
  "DESCARGA": "02/12/2026 08:00",
  "CONTRATADOR": "Erasmo Araujo Santana",
  "FRETE": "3392,55",
  "PESO": "3790,000",
  "CUBAGEM": "0,000",
  "DETALHES": "FROTA\r\n01 - Frete Frota (Tabela) - R$ 3392.55"
}
```

## Resposta Esperada do Webhook

O webhook deve retornar um status HTTP 200 (OK) com uma resposta JSON indicando sucesso:

```json
{
  "message": "Workflow was started"
}
```

## Formatação dos Campos

### Formatação de FRETE, PESO e CUBAGEM

- **FRETE**: Valor numérico apenas, sem "R$", usando vírgula como separador decimal
  - Exemplo: `"3392,55"` (não `"R$ 3392,55"`)
- **PESO**: Valor numérico apenas, sem "ton", usando vírgula como separador decimal com 3 casas
  - Exemplo: `"3790,000"` (não `"3790,000 ton"`)
- **CUBAGEM**: Valor numérico apenas, sem "m³", usando vírgula como separador decimal com 3 casas
  - Exemplo: `"0,000"` (não `"0,000 m³"`)

### Formatação de ROTA

- Se houver roteiro cadastrado: `{IDROTEIRO} - {DSROTEIRO}`
  - Exemplo: `"617 - Itapevi Sp / Belo Horizonte MG"`
- Se não houver roteiro: `{ORIGEM_CIDADE}/{ORIGEM_ESTADO} → {DESTINO_CIDADE}/{DESTINO_ESTADO}`
  - Exemplo: `"Itapevi/SP → Belo Horizonte/MG"`

### Formatação de TIPO e CLASSE

- **TIPO**: `{CDTIPOVIAGEM} - {DSTIPOVIAGEM}`
  - Exemplo: `"05 - Entrega"`
- **CLASSE**: `{CDCLASSEFROTA} - {DSCLASSEFROTA}`
  - Exemplo: `"25 - Truck Baú"`

### Formatação de Datas

- **CARREGAMENTO** e **DESCARGA**: `DD/MM/YYYY HH:mm`
  - Exemplo: `"01/12/2026 16:00"`

## Comportamento do Sistema

1. **Verificação prévia**: Antes de enviar, o sistema verifica se `DHENVIOMETA` está vazio/null
2. **Envio individual**: Cada convocação é enviada em uma requisição separada
3. **Intervalo**: Aguarda 1 segundo entre cada envio
4. **Atualização**: Após envio bem-sucedido, o campo `DHENVIOMETA` é atualizado com a data/hora atual
5. **Prevenção de duplicatas**: Convocações com `DHENVIOMETA` preenchido não são reenviadas

## Exemplo de Sequência de Envios

```
[1/2] Enviando convocação 154 → Aguarda 1 segundo → [2/2] Enviando convocação 155
```

## Tratamento de Erros

- Se o webhook retornar erro (status diferente de 200), o campo `DHENVIOMETA` **NÃO** será atualizado
- O sistema continua processando as próximas convocações mesmo se uma falhar
- Logs detalhados são gerados para cada tentativa de envio

## Observações Técnicas

1. **Content-Type**: Sempre `application/json`
2. **Método**: Sempre `POST`
3. **Body**: Sempre um objeto JSON (não array)
4. **Encoding**: UTF-8 (suporta emojis e caracteres especiais)
5. **Timeout**: Recomenda-se configurar timeout adequado (sugestão: 30 segundos)

## Estrutura de Dados TypeScript (Referência)

```typescript
interface ConvocacaoWebhook {
  IDCONVOCACAO: number;
  NRCELULAR: string | null;
  LINKCONVOCACAO: string;
  ID: number;
  TIPO: string;
  CLASSE: string;
  ROTA: string;
  CARREGAMENTO: string;
  DESCARGA: string;
  CONTRATADOR: string;
  FRETE: string;
  PESO: string;
  CUBAGEM: string;
  DETALHES?: string;
}
```

## Estrutura de Dados JSON Schema (Referência)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["IDCONVOCACAO", "LINKCONVOCACAO", "ID", "TIPO", "CLASSE", "ROTA", "CARREGAMENTO", "DESCARGA", "CONTRATADOR", "FRETE", "PESO", "CUBAGEM"],
  "properties": {
    "IDCONVOCACAO": {
      "type": "integer",
      "description": "ID único da convocação no sistema"
    },
    "NRCELULAR": {
      "type": ["string", "null"],
      "pattern": "^[0-9]{10,15}$",
      "description": "Número do celular do motorista (apenas dígitos) ou null"
    },
    "LINKCONVOCACAO": {
      "type": "string",
      "format": "uri",
      "description": "URL completa do link da convocação"
    },
    "ID": {
      "type": "integer",
      "description": "ID da viagem"
    },
    "TIPO": {
      "type": "string",
      "description": "Tipo de viagem formatado (código - descrição)"
    },
    "CLASSE": {
      "type": "string",
      "description": "Classe de frota formatada (código - descrição)"
    },
    "ROTA": {
      "type": "string",
      "description": "Rota formatada"
    },
    "CARREGAMENTO": {
      "type": "string",
      "pattern": "^\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}$",
      "description": "Data/hora de carregamento formatada (DD/MM/YYYY HH:mm)"
    },
    "DESCARGA": {
      "type": "string",
      "pattern": "^\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}$",
      "description": "Data/hora de descarga formatada (DD/MM/YYYY HH:mm)"
    },
    "CONTRATADOR": {
      "type": "string",
      "description": "Nome do contratador"
    },
    "FRETE": {
      "type": "string",
      "pattern": "^\\d+,\\d{2}$",
      "description": "Valor do frete formatado como numérico apenas (sem R$)"
    },
    "PESO": {
      "type": "string",
      "pattern": "^\\d+,\\d{3}$",
      "description": "Peso da carga formatado como numérico apenas (sem ton)"
    },
    "CUBAGEM": {
      "type": "string",
      "pattern": "^\\d+,\\d{3}$",
      "description": "Cubagem da carga formatada como numérico apenas (sem m³)"
    },
    "DETALHES": {
      "type": "string",
      "description": "Observações da viagem (opcional)"
    }
  }
}
```

