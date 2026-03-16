# Onde e como os alertas são gerados

## Resposta direta

**Não existe nenhum programa na tela (frontend) que “gera” ou “captura” os alertas.**

A geração e a captura são feitas **só no servidor (backend)**:

1. **Job automático** – roda no Node.js a cada 5 minutos.
2. **Serviço de regras** – lê dados do banco (viagens, rastreamento, roteiro) e, quando a regra é atendida, **grava** um registro na tabela **ALERTS**.

O programa **Alertas do Sistema** (menu) apenas **lista** o que já está na tabela **ALERTS**. Ele não gera nada.

---

## Onde está o código que gera os alertas

| O quê | Arquivo | Função / trecho |
|-------|---------|------------------|
| Job que dispara a verificação | `backend/server.js` | `iniciarJobAlertas()` e `verificarAlertasViagensAtivas()` |
| Regras (parada, atraso, offline, desvio) | `backend/services/alert-service.js` | `verificarAlertas()`, `verificarParadaProlongada()`, `verificarAtraso()`, `verificarOffline()`, `verificarDesvioRota()`, `salvarAlerta()` |
| API para forçar verificação em uma viagem | `backend/controllers/alert.controller.js` | `verificar()` (POST /api/alertas/verificar/:idviagem) |

---

## Como o job escolhe as viagens

Em `server.js`, a função `verificarAlertasViagensAtivas()` busca viagens assim:

```sql
SELECT DISTINCT v."IDVIAGEM"
FROM "VIAGEMMESTRE" v
INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
WHERE v."FGACTIVE" = 'A'
  AND v."CDSITUACAOVIAGEM" NOT IN (14, 15, 16, 17)
  AND (
    v."DTPREVINICIO" IS NULL
    OR v."DTPREVINICIO" >= (CURRENT_TIMESTAMP - INTERVAL '15 days')
  )
```

Ou seja: só viagens **ativas** (`FGACTIVE = 'A'`), com situação diferente de 14/15/16/17, e com previsão de início nos últimos 15 dias (ou sem previsão).  
Se não houver **nenhuma** viagem nesse SELECT, o job não gera alerta para ninguém.

---

## De onde cada tipo de alerta “captura” os dados

### 1. Parada prolongada (> 30 min parado)

- **Onde:** `alert-service.js` → `verificarParadaProlongada(idViagem, pool)`.
- **O que lê:** tabela **VIAGEMRASTREAMENTO**.
  - Últimas posições da viagem nas **últimas 60 minutos**.
  - Considera “parado” quando **VELOCIDADE &lt; 5**.
  - Regra: pelo menos **2 registros** com velocidade &lt; 5 e **tempo entre o primeiro e o último ≥ 30 minutos**.
- **Se não aparecer:** não há registros em **VIAGEMRASTREAMENTO** para essa viagem nas últimas 60 min, ou não há sequência de 30 min com velocidade &lt; 5.

### 2. Atraso na entrega (ETA &gt; prazo)

- **Onde:** `alert-service.js` → `verificarAtraso(idViagem, pool)`.
- **O que lê:**
  - **VIAGEMMESTRE:** viagem em situação “Em Andamento” ou “Confirmada”, com **DTPREVFINAL** (prazo de entrega) preenchido.
  - **VIAGEMRASTREAMENTO:** última posição (LATITUDE, LONGITUDE, DHREGISTRO, VELOCIDADE).
  - **ROTEIROPONTOS:** coordenadas de destino do roteiro (para calcular ETA).
  - Opcional: **OSRM** (API externa) para calcular tempo até o destino.
- **Regra:** compara “chegada estimada” com **DTPREVFINAL**. Se a chegada for depois do prazo (ou já passou do prazo), gera alerta de atraso.
- **Se não aparecer:** viagem sem **DTPREVFINAL**, ou sem última posição em **VIAGEMRASTREAMENTO**, ou ETA ainda dentro do prazo.

### 3. Motorista offline (&gt; 90 min sem atualização)

- **Onde:** `alert-service.js` → `verificarOffline(idViagem, pool)`.
- **O que lê:** **VIAGEMRASTREAMENTO** – última posição (DHREGISTRO) da viagem.
- **Regra:** se a **última atualização** (DHREGISTRO) for há mais de **90 minutos**, gera alerta de offline.
- **Se não aparecer:** há posição recente (menos de 90 min) ou não há nenhum registro para a viagem (aí depende da lógica exata no código).

### 4. Desvio de rota (&gt; 500 m da rota)

- **Onde:** `alert-service.js` → `verificarDesvioRota(idViagem, pool)`.
- **O que lê:** última posição em **VIAGEMRASTREAMENTO** e pontos da rota em **ROTEIROPONTOS** (ou geometria da rota).
- **Regra:** distância da posição atual até a rota planejada &gt; **500 m** → gera alerta de desvio.
- **Se não aparecer:** posição ainda dentro do buffer de 500 m ou sem rota/geometria.

---

## Onde os alertas ficam gravados

- **Tabela:** **ALERTS** (no PostgreSQL; script: `backend/scripts/criar_tabela_alerts_postgres.sql`).
- O job e a API de verificação usam `alertService.salvarAlerta()` para fazer **INSERT** nessa tabela.
- O programa **Alertas do Sistema** faz **SELECT** nessa mesma tabela (via `GET /api/alertas`) para montar a lista.

---

## Como testar na prática

### Passo 1 – Garantir que a tabela existe

- Executar no PostgreSQL: `backend/scripts/criar_tabela_alerts_postgres.sql`.

### Passo 2 – Ter ao menos uma viagem “ativa” para o job

- No banco: **VIAGEMMESTRE** com `FGACTIVE = 'A'`, `CDSITUACAOVIAGEM` não em (14, 15, 16, 17), e `DTPREVINICIO` nulo ou nos últimos 15 dias.
- Anote o **IDVIAGEM** (ex.: 1).

### Passo 3 – Dados para cada tipo de alerta

- **Parada:** na **VIAGEMRASTREAMENTO**, inserir 2 ou mais registros para esse **IDVIAGEM** com:
  - **VELOCIDADE** &lt; 5,
  - **DHREGISTRO** com diferença ≥ 30 minutos entre o primeiro e o último,
  - todos dentro das últimas 60 minutos (em relação ao momento em que o job rodar).
- **Atraso:** mesma viagem com **DTPREVFINAL** no passado (ou muito em cima do horário) e, se o código usar OSRM, última posição em **VIAGEMRASTREAMENTO**.
- **Offline:** última linha em **VIAGEMRASTREAMENTO** para essa viagem com **DHREGISTRO** há mais de 90 minutos.
- **Desvio:** última posição em **VIAGEMRASTREAMENTO** e rota em **ROTEIROPONTOS** de forma que a distância da posição à rota seja &gt; 500 m.

### Passo 4 – Disparar a verificação

- **Opção A – Esperar o job:** aguardar até 5 minutos (e até 30 s após subir o servidor na primeira vez).
- **Opção B – Forçar para uma viagem:**  
  `POST http://localhost:3000/api/alertas/verificar/ID_VIAGEM`  
  (troque `ID_VIAGEM` pelo ID real, ex.: 1). Requer autenticação (cookie/session ou token, conforme o seu app).

### Passo 5 – Ver o resultado

- Abrir o programa **Alertas do Sistema** (menu) e clicar em **Atualizar**.  
Os alertas gerados (e gravados na **ALERTS**) aparecem na lista.

---

## Resumo

| Pergunta | Resposta |
|----------|----------|
| Em que programa gera? | Em nenhum programa de tela. Gera no **servidor**: job em `server.js` + regras em `alert-service.js`. |
| Onde são capturados? | Lendo **VIAGEMMESTRE**, **VIAGEMRASTREAMENTO**, **ROTEIROPONTOS**, **SITUACAOVIAGEM** e, em alguns casos, API OSRM. |
| Onde ficam salvos? | Na tabela **ALERTS** (PostgreSQL). |
| Onde eu vejo e testo? | No programa **Alertas do Sistema** (lista) e, para forçar uma viagem, em **POST /api/alertas/verificar/:idviagem**. |

Para teste rápido sem depender de rastreamento real, use o botão **“Criar alerta de teste”** no programa Alertas (ele insere um registro direto na **ALERTS**); para testar as regras de parada/atraso/offline/desvio, use os passos acima com dados no banco e a API de verificação.
