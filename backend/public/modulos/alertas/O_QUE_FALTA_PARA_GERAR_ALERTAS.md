# O que falta para começar a gerar os alertas

Checklist objetivo para colocar a geração automática de alertas em funcionamento.

---

## 1. Banco de dados

| Item | O que fazer |
|------|-------------|
| **Tabela ALERTS** | Deve existir no PostgreSQL. Se não existir, executar: `backend/scripts/criar_tabela_alerts_postgres.sql` (ou o bloco ALERTS em `backend/scripts/ajustes_postgres_20260301_a_hoje.sql`). |
| **Tabela de posições GPS** | O `alert-service.js` consulta a tabela **VIAGEMRASTREAMENTO**. No seu banco o nome pode ser `VIAGEMRASTREAMENTO` ou `VIAGEM_RASTREAMENTO` – o código atual usa `VIAGEMRASTREAMENTO`. Se a sua tabela tiver outro nome (ex.: `VIAGEM_RASTREAMENTO`), é preciso ajustar as queries no `alert-service.js` ou criar uma view/alias. |
| **CONFIGURACAO** | Inserir as chaves de alertas: executar **uma vez** o script `backend/scripts/init_config_alertas.sql`. Assim as chaves `alert_*` e `alert_whatsapp_*` passam a existir (e o job usa os valores configurados na tela de Configurações). |

---

## 2. Configuração (tela Configurações → Alertas de viagem)

| Item | Verificação |
|------|-------------|
| **Job ativo** | Checkbox "Job de alertas ativo" marcado (config `alert_job_ativo` = 'S'). Se estiver desmarcado, o job não processa viagens. |
| **Tipos de alerta** | Pelo menos um tipo deve estar ativo (parada, atraso, ETA preventivo, offline, desvio, atraso para iniciar, excesso de velocidade). |
| **Intervalo** | Campo "Intervalo (min)" – padrão 5. O job roda a cada N minutos e, na primeira vez, ~30 s após o servidor subir. |

(Opcional: se for usar notificações por WhatsApp ao gerar alerta, configurar o card **Integração Switch Digital** e, no card de alertas, "Enviar WhatsApp ao gerar alerta" e quem notificar / celular da central.)

---

## 3. Viagens “ativas”

O job só considera viagens que entram nesta regra (em `server.js`):

- **VIAGEMMESTRE**: `FGACTIVE = 'A'`
- **FGSITVIAGEM** (código de situação da SITUACAOVIAGEM): configurável em **Configurações → Alertas de viagem → Onde gera**:
  - Se o campo **"Códigos FGSITVIAGEM que entram na verificação"** estiver preenchido (ex.: `P,T,A,M`), só entram viagens cuja situação tenha um desses códigos.
  - Se estiver vazio, vale o padrão: entram todas **exceto** D, E, F, C (Preparação, Final de rota, Finalizada, Cancelada).
- **DTPREVINICIO**: nulo ou nos últimos 15 dias

Se **nenhuma** viagem atender a isso, o job não gera alerta para ninguém (e no log aparece algo como "Nenhuma viagem ativa encontrada para verificação de alertas").

---

## 4. Dados para cada tipo de alerta

Os alertas dependem de **dados no banco** (e, em alguns casos, de roteiro/OSRM):

| Tipo | O que precisa |
|------|----------------|
| **Parada prolongada** | Registros em VIAGEMRASTREAMENTO para a viagem, com VELOCIDADE &lt; limiar, por tempo ≥ configurado (ex.: 30 min na janela de 60 posições). |
| **Atraso** | Viagem com DTPREVFINAL; última posição em VIAGEMRASTREAMENTO; cálculo de ETA (roteiro/OSRM) indicando chegada após o prazo. |
| **ETA preventivo** | Mesma lógica de atraso (ETA próximo ou além do prazo). |
| **Offline** | Última posição da viagem em VIAGEMRASTREAMENTO com DHREGISTRO há mais de X minutos (ex.: 90). |
| **Desvio de rota** | Última posição em VIAGEMRASTREAMENTO e rota (ex.: ROTEIROPONTOS); distância da posição à rota &gt; configurada (ex.: 500 m). |
| **Atraso para iniciar** | DTPREVINICIO preenchido; passou DTPREVINICIO + margem (ex.: 15 min); ainda não há macro "Viagem - Início" (103) nem posição recente. |
| **Excesso de velocidade** | Últimas N posições em VIAGEMRASTREAMENTO com VELOCIDADE &gt; limite (ex.: 100 km/h). |

Sem **posições em VIAGEMRASTREAMENTO** para a viagem, a maioria dos tipos não dispara; apenas **atraso para iniciar** pode disparar só com dados da viagem (DTPREVINICIO).

---

## 5. Servidor (Node/backend)

- Backend **rodando** (ex.: `node server.js` ou via PM2).
- O job de alertas é iniciado em `server.js` ao subir o servidor; a primeira verificação ocorre ~30 s depois e as seguintes a cada intervalo configurado (ex.: 5 min).

Se a tabela CONFIGURACAO não existir ou não tiver as chaves `alert_*`, o código usa os **defaults** definidos em `alert-service.js` (ALERT_CONFIG_DEFAULTS); mesmo assim, a tabela **ALERTS** e a tabela de **rastreamento** precisam existir.

---

## Resumo rápido

1. **Rodar** `init_config_alertas.sql` (chaves na CONFIGURACAO).  
2. **Criar** a tabela **ALERTS** se ainda não existir (`criar_tabela_alerts_postgres.sql`).  
3. **Conferir** o nome da tabela de rastreamento (VIAGEMRASTREAMENTO vs VIAGEM_RASTREAMENTO) e ajustar o `alert-service.js` se for diferente.  
4. Em **Configurações → Alertas**: job ativo, intervalo e pelo menos um tipo de alerta ativo.  
5. Ter **ao menos uma viagem ativa** (FGACTIVE='A', situação não 14/15/16/17, DTPREVINICIO nos últimos 15 dias ou nulo).  
6. Para a maioria dos alertas: ter **posições GPS** na tabela de rastreamento para essa viagem.

Para testar sem esperar o job: **POST** `/api/alertas/verificar/:idviagem` (trocar `idviagem` pelo ID real). Ver também: `ONDE_E_COMO_ALERTAS_SAO_GERADOS.md` e `GUIA_TESTES_ALERTAS.md`.
