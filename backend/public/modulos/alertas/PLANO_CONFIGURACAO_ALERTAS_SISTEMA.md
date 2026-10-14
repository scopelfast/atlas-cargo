# Plano de implementação: Configuração de alertas em Configurações do Sistema

Objetivo: concentrar em **Configurações do Sistema** (gerenciar-configuracoes) todas as regras, tempos e opções dos alertas de viagem, permitindo que cada empresa ajuste sem alterar código.

---

## 1. Escopo

- **Onde:** Programa **Configurações do Sistema** (`backend/public/modulos/gerenciar-configuracoes/`).
- **O quê:** Novo card **"Alertas de viagem"** com abas ou seções: tempos/distâncias, tipos ativos, quando verificar, situações de viagem (onde gera). Textos de ajuda ao lado de cada campo.
- **Persistência:** Mesma tabela **CONFIGURACAO** (CHAVE/VALOR), com chaves prefixo `alert_`. Valores default = comportamento atual do código; quem não configurar mantém o atual.

---

## 2. Parâmetros a configurar (lista completa)

| Chave CONFIGURACAO | Descrição curta | Default | Unidade | Onde usa |
|--------------------|-----------------|---------|---------|----------|
| **Offline** | | | | |
| `alert_offline_minutos` | Alerta após X minutos sem posição | 90 | minutos | verificarOffline |
| **Parada prolongada** | | | | |
| `alert_parada_velocidade_max` | Velocidade máxima considerada "parado" | 5 | km/h | verificarParadaProlongada |
| `alert_parada_minutos_min` | Tempo mínimo parado para gerar alerta | 30 | minutos | verificarParadaProlongada |
| `alert_parada_janela_posicoes` | Quantidade de posições na janela (últimos X registros em 60 min) | 60 | número | verificarParadaProlongada |
| **Desvio de rota** | | | | |
| `alert_desvio_metros` | Distância mínima da rota para gerar alerta | 500 | metros | verificarDesvioRota |
| **Atraso / ETA** | | | | |
| `alert_atraso_margem_minutos` | (Opcional) Margem em minutos além do prazo para considerar atraso | 0 | minutos | verificarAtraso (se usar no futuro) |
| **Job (quando verifica)** | | | | |
| `alert_job_intervalo_minutos` | Intervalo da verificação automática | 5 | minutos | server.js – iniciarJobAlertas |
| `alert_cooldown_minutos` | Tempo mínimo para repetir o mesmo alerta (mesma viagem + tipo) após tratado/cancelado | 30 | minutos | alert-service / salvarAlerta |
| `alert_whatsapp_reenvio_minutos` | Tempo mínimo para reenviar WhatsApp do mesmo alerta para o mesmo destino | 30 | minutos | alert-notification-service |
| `alert_job_ativo` | Job de alertas ligado (S/N) | S | S/N | server.js – poder pausar o job |
| **Tipos ativos (liga/desliga)** | | | | |
| `alert_tipo_parada_ativo` | Gerar alerta de parada prolongada | S | S/N | verificarAlertas |
| `alert_tipo_atraso_ativo` | Gerar alerta de atraso | S | S/N | verificarAlertas |
| `alert_tipo_eta_prazo_ativo` | Gerar alerta ETA > prazo (preventivo) | S | S/N | verificarAlertas |
| `alert_tipo_offline_ativo` | Gerar alerta de motorista offline | S | S/N | verificarAlertas |
| `alert_tipo_desvio_ativo` | Gerar alerta de desvio de rota | S | S/N | verificarAlertas |
| **Onde gera (situações de viagem)** | | | | |
| `alert_situacoes_viagem` | Códigos de situação que disparam verificação (separados por vírgula; vazio = usar padrão ANDAMENTO,CONFIRMADA,APROVADO) | (vazio = lógica atual) | ex: 1,2,10 | Queries em alert-service (IN list) |

- **Regras claras na tela:** em cada campo, hint/tooltip explicando: "Gera quando...", "Considera viagens em...", etc.
- **Cooldown (regra operacional):**
  - `alert_cooldown_minutos`: impede recriação imediata do mesmo alerta após tratamento/cancelamento.
  - `alert_whatsapp_reenvio_minutos`: impede reenvio repetitivo da mesma notificação no WhatsApp para o mesmo destino.
  - `0` em qualquer um dos dois campos = sem cooldown (comportamento imediato).

---

## 3. Banco de dados

- **Tabela:** `CONFIGURACAO` (já existente). Sem nova tabela.
- **Script opcional:** `backend/scripts/init_config_alertas.sql` com INSERT das chaves acima e valores default (ou fazer upsert no primeiro GET da API, como em outras configs).
- **Formato de valor:** números e S/N como string (ex.: `"90"`, `"S"`). `alert_situacoes_viagem` = string com códigos separados por vírgula (ex.: `"1,2,10"`) ou vazio para comportamento atual (LIKE %ANDAMENTO% etc.).

---

## 4. API (config.routes.js)

- **GET** `/api/configuracoes/alertas`  
  - Lê todas as chaves `alert_*` da CONFIGURACAO.  
  - Retorna um único objeto (ex.: `{ alert_offline_minutos: 90, alert_parada_velocidade_max: 5, ... }`).  
  - Se uma chave não existir, retornar o valor default (mesmo objeto de defaults usado no backend).

- **PUT** `/api/configuracoes/alertas`  
  - Recebe no body o mesmo objeto (ou subconjunto).  
  - Para cada chave recebida, faz upsert em CONFIGURACAO (CHAVE, VALOR, DESCRICAO).  
  - Validação mínima: números dentro de ranges razoáveis (ex.: intervalo 1–60 min, metros 100–5000), S/N para booleanos.  
  - Resposta: `{ success: true, message: '...' }`.

---

## 5. Front-end (Configurações do Sistema)

- **Arquivo:** `backend/public/modulos/gerenciar-configuracoes/index.html`.
- **Inclusão:** Novo `<article class="config-card">` (e se necessário `card-full` para largura total), após o card da Switch Digital, com:
  - **Header:** ícone (ex.: `bx bx-error-circle` ou `bx bx-bell`) + título "Alertas de viagem".
  - **Body:**
    - Descrição do card: "Configure tempos, distâncias e tipos de alertas gerados automaticamente para viagens ativas. As regras abaixo definem quando, onde e como os alertas são gerados."
    - **Seção 1 – Tempos e distâncias:**  
      Offline (minutos), Parada (velocidade max km/h, minutos mín, janela de posições), Desvio (metros). Cada campo com label + input + `.hint` com texto do tipo "Gera quando a última posição GPS tem mais de X minutos".
    - **Seção 2 – Quando verificar:**  
      Intervalo do job (minutos), Job ativo (checkbox S/N).
    - **Seção 3 – Tipos ativos:**  
      Checkboxes: Parada prolongada, Atraso, ETA preventivo, Offline, Desvio de rota.
    - **Seção 4 – Onde gera (opcional):**  
      Campo texto ou multiselect para códigos de situação de viagem (ex.: "Códigos que disparam verificação (vazio = padrão): 1, 2, 10" com hint).
  - **Footer:** Recarregar + Salvar (mesmo padrão dos outros cards), div para mensagem de sucesso/erro.

- **Script:** `backend/public/modulos/gerenciar-configuracoes/js/script.js`:
  - Ao carregar a página: GET `/api/configuracoes/alertas` e preencher os campos.
  - Botão Recarregar: mesmo GET e preencher.
  - Botão Salvar: montar objeto com os valores dos campos, PUT `/api/configuracoes/alertas`, exibir mensagem e, em caso de sucesso, opcionalmente "Configurações salvas. O job de alertas passará a usar os novos valores na próxima execução."

- **Estilo:** Reaproveitar classes existentes (`.config-card`, `.form-group`, `.form-grid`, `.hint`, `.message`, `.btn-primary`, `.btn-secondary`). Incluir regras no `dark-mode.css` para o novo card se necessário (seguir padrão dos outros cards).

---

## 6. Back-end – alert-service.js

- **Função `getAlertConfig(pool)` (ou `getAlertConfig()` usando pool interno):**
  - Lê todas as chaves `alert_*` da CONFIGURACAO (uma query com `WHERE "CHAVE" LIKE 'alert_%'`).
  - Monta objeto com os mesmos nomes de chave e valores; para chaves ausentes, preencher com objeto de **defaults** (90, 5, 30, 60, 500, 5, S, S, S, S, S, S, situações vazias).
  - **Cache em memória:** manter um objeto `alertConfigCache` com timestamp. Se passou menos de 1–2 minutos (ou configurável), retornar cache; senão recarregar do banco e atualizar cache. Assim não há leitura em toda verificação de viagem.

- **Uso nas funções existentes:**
  - `verificarAlertas(idViagem)`: no início, obter config. Se `alert_tipo_parada_ativo === 'S'`, chamar verificarParadaProlongada; idem para atraso, eta_prazo, offline, desvio.
  - `verificarParadaProlongada`: usar `config.alert_parada_velocidade_max`, `alert_parada_minutos_min`, `alert_parada_janela_posicoes` nas queries e na condição.
  - `verificarOffline`: usar `config.alert_offline_minutos`.
  - `verificarDesvioRota`: usar `config.alert_desvio_metros`.
  - Queries que filtram por situação: se `config.alert_situacoes_viagem` não estiver vazio, usar `IN (lista de códigos)`; senão manter lógica atual (LIKE %ANDAMENTO% OR %CONFIRMADA% OR %APROVADO%).

- **Compatibilidade:** Se a tabela CONFIGURACAO não tiver nenhuma chave `alert_*`, `getAlertConfig` deve retornar só os defaults (comportamento idêntico ao atual).

---

## 7. Back-end – server.js (job de alertas)

- **Intervalo:** Em vez de `const INTERVALO_MINUTOS = 5` fixo, ao iniciar o job (e dentro do setInterval, a cada ciclo) ler a config de alertas (via função que lê CONFIGURACAO ou via alert-service.getAlertConfig). Usar `alert_job_intervalo_minutos` (default 5).  
  - **Atenção:** se o intervalo for lido do banco a cada ciclo, o `setInterval` já está definido; para mudar o intervalo em tempo real seria necessário clearInterval e novo setInterval. Para a Fase 1, pode-se ler o intervalo apenas na inicialização do servidor (iniciarJobAlertas); assim, alterar o intervalo exige reinício do servidor. Opção mais avançada: ao salvar configuração no PUT, não alterar o setInterval em tempo real; documentar "Alteração do intervalo passa a valer após reinício do servidor".

- **Job ativo:** Se `alert_job_ativo === 'N'`, a função `verificarAlertasViagensAtivas` deve retornar sem executar (não buscar viagens nem chamar verificarAlertas). Assim é possível "pausar" o job pela tela.

---

## 8. Ordem de implementação (fases)

| Fase | Tarefa | Arquivos principais |
|------|--------|---------------------|
| **1** | Definir objeto de defaults e função getAlertConfig (com cache) no alert-service; ler config em verificarAlertas e em cada verificar* (parada, offline, desvio, atraso, eta); usar parâmetros nas regras (tempos, distâncias, tipos ativos). | `alert-service.js` |
| **2** | Criar GET/PUT `/api/configuracoes/alertas` em config.routes.js; usar CONFIGURACAO com chaves alert_*; retornar defaults para chaves ausentes. | `config.routes.js` |
| **3** | Script SQL opcional para inserir chaves default em CONFIGURACAO (ou garantir que o GET preenche defaults). | `scripts/init_config_alertas.sql` (opcional) |
| **4** | Novo card "Alertas de viagem" em gerenciar-configuracoes (HTML + seções, labels, hints). | `gerenciar-configuracoes/index.html` |
| **5** | JS do card: carregar (GET), salvar (PUT), mensagens, validação básica nos campos. | `gerenciar-configuracoes/js/script.js` |
| **6** | server.js: ler alert_job_intervalo_minutos na inicialização do job; ler alert_job_ativo a cada ciclo e, se 'N', não executar verificação. | `server.js` |
| **7** | (Opcional) Situações de viagem: campo na tela + chave alert_situacoes_viagem; no alert-service, se preenchido usar IN (códigos), senão manter LIKE atual. | `alert-service.js`, index.html, script.js |
| **8** | Ajustes de dark mode para o novo card (se necessário). | `dark-mode.css` |
| **9** | Testes: salvar config, recarregar página, executar verificação manual (POST /api/alertas/verificar/:id), conferir logs e se os valores configurados são aplicados. | — |

---

## 9. Testes sugeridos

- Salvar configuração com valores alterados (ex.: offline 120 min, desvio 1000 m) e recarregar a página: valores devem persistir.
- Desativar um tipo (ex.: desvio) e rodar verificação para uma viagem que geraria desvio: não deve criar alerta desse tipo.
- Colocar job ativo = N e aguardar um ciclo: log não deve mostrar "Verificando alertas para X viagem(ns)".
- Deixar todas as chaves em default e rodar uma verificação: comportamento deve ser igual ao atual (sem config).

---

## 10. Resumo

- **Um lugar:** Configurações do Sistema → card "Alertas de viagem".
- **Regras claras:** hints em cada campo (quando gera, onde gera, como gera).
- **Tempos configuráveis:** offline, parada, intervalo do job.
- **Tipos liga/desliga:** parada, atraso, ETA preventivo, offline, desvio.
- **Persistência:** CONFIGURACAO (CHAVE/VALOR); defaults no código para compatibilidade.
- **Back-end:** getAlertConfig com cache; alert-service e server.js passam a usar a config; nenhuma quebra para quem não configurar.

Documento gerado para guiar a implementação passo a passo.
