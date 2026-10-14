# WMS — Inventário: orientação de processo

**Status:** documento de referência operacional — **Fase 1 implementada** (documento, snapshot, CSV, encerramento com `INVENTARIO_AJUSTE` por SKU).  
**Relaciona com:** `docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md`, `docs/RF_WMS_ATLAS_v1.md` (M12 Inventário).  
**Tela no Atlas:** menu **WMS — Inventário** (`estoque-inventario`).

---

## 1. Objetivo

Garantir que **contagem física** do armazém se reflita no saldo do Atlas com **trilha auditável**, sem depender de NF-e fictícia e sem apagar histórico de recebimentos e expedições já registrados.

---

## 2. Como o saldo funciona hoje (MVP)

| Camada | Fonte |
|--------|--------|
| Entradas | NF-e de entrada **encerradas** — quantidades em `CONFERENCIA_JSON` (produto, lote, validade, qtd convertida) |
| Saídas / ajustes | `WMS_MOVIMENTO_ESTOQUE` (ex.: `EXPEDICAO_SAIDA` na confirmação da expedição) |
| Saldo por produto (SKU) | Soma entradas encerradas + soma movimentos |
| Detalhe lote/validade | Vem das linhas de recebimento; movimento ainda é **por produto** no MVP |
| Reservas | `WMS_RESERVA_ESTOQUE_OPL` reduz **disponível** na separação (não altera o físico) |

**Regra de ouro:** inventário futuro grava apenas **diferença** (ajuste), não substitui NF-e nem reimporta XML com mesma chave.

---

## 3. Tipos de inventário

| Tipo | Quando | O que faz |
|------|--------|-----------|
| **A — Carga inicial** | Primeira implantação WMS | Contagem vira saldo (sistema ≈ zero ou parcial) |
| **B — Inventário geral** | Periódico (trimestral, anual, etc.) | Compara físico × snapshot do sistema e ajusta divergências |
| **C — Inventário cíclico** | Rotina contínua por amostra/critério | Ajustes parciais sem parar o armazém inteiro — gera lista por critério (ABC, vencimento, etc.) |

Os três tipos coexistem. O cíclico **não substitui** o geral: ele aumenta a frequência de conferência em SKUs estratégicos e cobre a maior parte do armazém durante o ano, mas o geral continua sendo o "fechamento contábil" do estoque.

---

## 4. Princípios obrigatórios

1. **Não usar NF-e inventada** para corrigir estoque — risco fiscal e conflito de chave na importação.
2. **Não alterar** `CONFERENCIA_JSON` de NF já encerrada sem processo formal.
3. **Snapshot de corte:** definir data/hora em que o “saldo sistema” é congelado para a contagem.
4. **Ajuste = contado − sistema** — só linhas com diferença geram movimento.
5. **Supervisor** para divergências acima do limite ou validade abaixo da política do dono (mesmo espírito do recebimento).
6. **Idempotência** ao encerrar — mesma chave de movimento não duplica ajuste.

---

## 5. Fluxo operacional (inventário geral)

```text
[Preparação] → [Abrir inventário + snapshot] → [Contagem física] → [Planilha]
      → [Importar / conferir no Atlas] → [Aprovar] → [Encerrar] → [Movimentos INVENTARIO_AJUSTE]
      → [Conferir relatório Posição de estoque]
```

### 5.1 Preparação (1–2 dias antes)

- Produtos contados cadastrados em **Cadastros WMS → Produtos do dono** (código interno do dono).
- Um **dono do estoque** (`CD_DONO`) por planilha — nunca misturar donos.
- Alinhar com operação: recebimento/expedição durante a contagem (pausar ou registrar que movimentos após o corte entram no próximo ciclo).
- Verificar **reservas OPL** (relatório de posição mostra saldo e reserva).

### 5.2 Abertura (no Atlas — quando implementado)

- Documento **Inventário**: tenant, dono, tipo `GERAL` ou `INICIAL`, status `EM_CONTAGEM`, responsável, **data/hora de corte**.
- Exportar **snapshot** (equivalente ao relatório **Posição de estoque** na data de corte).

**Enquanto o módulo não encerra inventário:** use **WMS → Relatórios → Saldo / posição → CSV** como snapshot manual e guarde o arquivo com data no nome.

### 5.3 Contagem física (campo)

- Contar por endereço/pallet conforme procedimento interno.
- Registrar na planilha canônica (seção 6).

### 5.4 Importação e divergências (futuro)

- Validar: produto existe; lote/validade obrigatórios; datas; duplicidade código+lote+validade.
- Calcular: `QTD_AJUSTE = QTD_CONTADA − QTD_SISTEMA_SNAPSHOT`.
- Itens só no sistema (não contados): decidir política antes do dia D — **zerar** ou **não alterar** (ver seção 8).

### 5.5 Encerramento

- Supervisor aprova quando necessário.
- Gravar `WMS_MOVIMENTO_ESTOQUE` com `TP_MOVIMENTO = INVENTARIO_AJUSTE` (implementação pendente).
- Status do documento: `ENCERRADO` (irreversível; estorno só com documento futuro).

### 5.6 Pós-inventário

- **WMS → Relatórios → Posição de estoque** — amostragem.
- Arquivar: planilha enviada, snapshot CSV, log do encerramento.

---

## 6. Planilha canônica (modelo de contagem)

**Formato:** CSV UTF-8, separador **`;`**, uma linha por combinação **produto + lote + validade** (quando aplicável).

| Coluna | Obrigatório | Descrição |
|--------|-------------|-----------|
| `CODIGO_PRODUTO` | Sim | Código **interno do dono** (`WMS_PRODUTO_DONO.CODIGO`) |
| `QTD_CONTADA` | Sim | Quantidade física na UM canônica do produto |
| `LOTE` | Se `FG_CONTROLA_LOTE = S` | Texto, até 60 caracteres |
| `VALIDADE` | Se `FG_CONTROLA_VALIDADE = S` | `AAAA-MM-DD` ou `DD/MM/AAAA` |
| `FATOR_CONVERSAO` | Não | Default `1` (ex.: caixa → unidade) |
| `ENDERECO` | Não | Apoio à contagem; não entra no saldo no MVP |
| `OBSERVACAO` | Não | Texto livre |

**Não importar** colunas calculadas pelo sistema (`QTD_SISTEMA`, `QTD_AJUSTE`) — o Atlas preenche na conferência.

### Exemplo (cabeçalho + 2 linhas)

```csv
CODIGO_PRODUTO;QTD_CONTADA;LOTE;VALIDADE;FATOR_CONVERSAO;ENDERECO;OBSERVACAO
6010305100;120;L202604;2026-12-31;1;RUA-A-01;
6320200100;48;L202605;2027-03-15;1;CAMARA-02;
```

Template para download: na tela **WMS — Inventário** → aba **Planilha modelo**.

---

## 6.1 Inventário cíclico (C) — rotina por amostra/critério

Inventário cíclico é a **prática recomendada de WMS modernos**: em vez de parar o armazém uma vez por ano para um inventário gigante, conta-se diariamente/semanalmente uma pequena lista de SKUs selecionados por critério. A operação **continua normal** durante a contagem.

### Princípios

1. **Não congela o armazém inteiro** — apenas os SKUs listados são bloqueados rapidamente, contados e liberados.
2. **Política `MANTER` obrigatória** — saldo dos SKUs fora da lista não é alterado no encerramento.
3. **Snapshot por SKU no momento da geração da lista** (não snapshot único do armazém todo).
4. **Tolerância** — aceita pequena variação (% configurável) entre snapshot e contagem, porque movimentos podem ter ocorrido entre os dois momentos.
5. **Cobertura** é o KPI principal: "% de SKUs do dono contados nos últimos 90 dias".
6. **Recontagem** quando divergência > limite definido pelo dono.

### Critérios suportados

| Critério | Para que serve | Quando usar |
|----------|----------------|-------------|
| **ABC (giro)** | Pega top N SKUs por |movimento| na janela. Aplica princípio de Pareto: A (top 20%) contado mais; C (cauda longa) menos | Rotina semanal/quinzenal |
| **Vencimento próximo** | SKUs com validade até X dias — FEFO crítico, alta exposição a perda | Diário/semanal (refrigerados, congelados, perecíveis) |
| **Não contados há mais tempo** | SKUs sem registro de contagem (ou contagem antiga) — fila justa para garantir cobertura | Diário (gera fila contínua) |
| **Mais movimentados** | Top N por volume absoluto na janela (entradas + saídas) | Quando o foco é volume, sem precisar de classificação A/B/C |
| **Aleatório (amostragem)** | Seleção estatística — útil para detectar viés/erros sistemáticos | Auditoria, controle de qualidade |
| **Por conservação** | Filtra todos os SKUs do tipo informado (REFRIG, CONGEL, SECO…) | Rotina mensal por categoria física |

Combinável com:
- **Filtro de conservação** — substring no `TIPO_ARMAZENAGEM`.
- **Palavra-chave no produto** — substring no `NM_PRODUTO`.

### Fluxo no Atlas

```text
[Tela WMS → Inventário]
    → Botão "Gerar lista de ciclo"
    → Modal: escolhe dono, critério, limite, janela, filtros
    → Botão "Pré-visualizar lista" → tabela com os candidatos
    → Botão "Criar inventário com esta lista"
        → Cria WMS_INVENTARIO tipo CICLICO já com linhas
        → Status EM_CONTAGEM, política MANTER, política gravada
    → Operador imprime/exporta a lista → conta → preenche CSV
    → Importa CSV (mesmo fluxo do geral) → encerra
    → INVENTARIO_AJUSTE só nos SKUs listados; resto preservado
```

### Boas práticas operacionais

- **Diário (sugestão)**: 1 lista de 20–50 SKUs por critério "Não contados há mais tempo" + 1 lista de vencimento próximo (refrigerados/congelados).
- **Semanal**: 1 lista ABC top 50 por dono (acompanha SKUs de maior giro).
- **Mensal**: 1 lista aleatória de 30 SKUs (amostragem auditoria).
- Definir **meta de cobertura** (ex.: 100% dos SKUs A no mês, 50% dos B, 25% dos C).
- Registrar divergência > tolerância em **ata interna** (atualmente: campo `OBSERVACAO`).
- Para perecíveis, executar **vencimento próximo** todo turno da manhã.

### Tabela / API

- `WMS_INVENTARIO.TP_INVENTARIO = 'CICLICO'` (ver `adicionar_tipo_ciclico_inventario_postgres.sql`).
- `WMS_INVENTARIO.CRITERIO_CICLICO` registra o critério escolhido.
- `WMS_INVENTARIO.PCT_TOLERANCIA` — override da tolerância % por inventário (NULL = usa default do dono).
- `WMS_DONO_ESTOQUE.NU_PCT_TOLERANCIA_CICLICO` — default da tolerância por dono.
- `WMS_INVENTARIO_LINHA.ORIGEM = 'CICLICO_GERADO'` distingue linhas pré-populadas pelo gerador das importadas via CSV.
- `WMS_INVENTARIO_LINHA.ST_LINHA` — status calculado: `PENDENTE`, `CONTADO`, `DIVERGENTE`, `RECONTAR`, `APROVADO`.
- `WMS_INVENTARIO_LINHA.NU_RECONTAGENS` — contador de quantas vezes a linha foi recontada.
- `WMS_INVENTARIO_LINHA.SG_APROVADOR` + `DH_APROVACAO` — auditoria de aprovação supervisor (Fase 3b).
- Endpoints:
  - `POST /api/wms/inventario/lista-ciclica` → preview (não persiste).
  - `POST /api/wms/inventario/ciclico` → cria inventário CICLICO + linhas (transação atômica).
  - `PATCH /api/wms/inventario/:cdInventario/tolerancia` → atualiza tolerância e recalcula status.
  - `POST /api/wms/inventario/:cdInventario/linhas/:cdLinha/recontar` → marca linha para recontagem.
  - `POST /api/wms/inventario/:cdInventario/linhas/:cdLinha/aprovar` → supervisor aprova divergência.

### Fase 3b — Status por SKU + recontagem + tolerância

**Como funciona o cálculo de status de cada linha:**

```text
contada_convertida = QTD_CONTADA × FATOR_CONVERSAO
diff = |contada_convertida − QTD_SISTEMA_SNAPSHOT|
base = max(|QTD_SISTEMA_SNAPSHOT|, 1)
pct  = (diff / base) × 100

Se QTD_CONTADA é NULL                        → PENDENTE
Se diff < ε ou pct ≤ tolerância              → CONTADO
Senão                                        → DIVERGENTE
```

A tolerância vem em ordem de precedência:
1. `PCT_TOLERANCIA` do próprio inventário (se definido).
2. `NU_PCT_TOLERANCIA_CICLICO` do dono.
3. Zero (qualquer divergência ≠ 0 vira `DIVERGENTE`).

**Decisões manuais que prevalecem sobre o cálculo automático:**
- `RECONTAR`: operador apagou a contagem e exigiu nova passagem.
- `APROVADO`: supervisor aceitou a divergência explicitamente (auditável: `SG_APROVADOR`, `DH_APROVACAO`).

**Bloqueio do encerramento (apenas CICLICO):**
- Inventário não pode ser encerrado se houver linhas em `PENDENTE`, `DIVERGENTE` ou `RECONTAR`.
- Mensagem do bloqueio lista a contagem de cada status pendente.
- Para destravar: importar nova contagem, marcar `RECONTAR` (resolver depois) ou aprovar via supervisor.

**Fluxo recomendado de operação:**
```text
1. Operador conta os SKUs do ciclo.
2. Importa o CSV → sistema calcula ST_LINHA por linha.
3. Painel mostra: X CONTADOS / Y DIVERGENTES / Z PENDENTES.
4. Para cada DIVERGENTE:
   - Se for erro de digitação ou contagem mal feita → "Recontar" → recontou → reimportar CSV.
   - Se for divergência real (pequena, justificada) → supervisor "Aprova".
5. Quando não houver mais nada PENDENTE/DIVERGENTE/RECONTAR → "Encerrar".
```

### Roadmap futuro do cíclico

| Fase | Entrega |
|------|---------|
| **3a** | Geração da lista por 6 critérios + criação automática do inventário |
| **3b (atual)** | Status por SKU + tolerância configurável + recontagem + aprovação supervisor + bloqueio do encerramento |
| **3c** | Calendário de ciclos (A semanal / B quinzenal / C mensal) + KPI cobertura/acuracidade |
| **3d** | Mobile (scanner + contagem cega) |

---

## 7. Carga inicial vs inventário geral

| | Carga inicial (A) | Inventário geral (B) |
|--|-------------------|----------------------|
| Snapshot | Zero ou parcial | Completo no corte |
| Planilha | Mesmas colunas | Mesmas colunas |
| Ajuste | Quase tudo é entrada (contado − 0) | Só **diferenças** |
| NF-e | Pode coexistir: NF reais + inventário para o sem nota | Correção via inventário, não NF fictícia |

---

## 8. Decisões de negócio (preencher antes do 1º inventário)

| # | Decisão | Opções / nota |
|---|---------|----------------|
| 1 | Instante de corte | Hora fixa **ou** “ao exportar snapshot” |
| 2 | Item não contado | Zerar **/ manter **/ lista de recontagem |
| 3 | Limite sem supervisor | % ou quantidade absoluta |
| 4 | Operação paralela | Parar recebimento/expedição **/ rodar em paralelo |
| 5 | Unidade de medida | Sempre UM canônica; fator na planilha |
| 6 | Carga inicial pendente | O que entra por NF-e real vs inventário |

Registrar as respostas na ata interna e revisar antes de cada inventário.

---

## 9. O que não fazer

- Reimportar XML de NF-e com a **mesma chave** para “resetar”.
- Conferir só no Excel sem documento de inventário no Atlas (saldo não muda).
- Ignorar reservas OPL e depois tratar como “falta” na separação.
- Misturar dois donos do estoque na mesma planilha.

---

## 10. Caminhos complementares

| Situação | Caminho |
|----------|---------|
| Entrada com NF-e real | **WMS → Recebimento** → XML → conferir → encerrar |
| Cadastro de produtos | **Cadastros WMS** ou import XML NF **saída** |
| Ver saldo | **WMS → Relatórios → Posição de estoque** |
| Inventário / ajuste | **WMS → Inventário** (aba Operação) |
| Manual para operadores | Mesmo módulo → aba **Manual operador** (`docs/WMS_INVENTARIO_MANUAL_OPERADOR.md`) |

---

## 11. Roadmap técnico (produto)

| Fase | Entrega |
|------|---------|
| **0** | Documento + menu + template CSV |
| **1** | `WMS_INVENTARIO` + snapshot + import CSV + encerrar → `WMS_MOVIMENTO_ESTOQUE` (`INVENTARIO_AJUSTE`) por SKU |
| **2** | Ajuste e saldo por lote/validade |
| **3a** | Inventário cíclico — geração da lista por 6 critérios + criação automática do inventário CICLICO |
| **3b** | Status por SKU + tolerância configurável + recontagem + aprovação supervisor + bloqueio do encerramento |
| **3b.1** | Edição inline (Contada / Lote / Validade) + **Dividir linha** (múltiplas validades por SKU) + **Reativar inventário** cancelado + auto-heal de `ST_LINHA` no detalhe e no encerramento |
| **3b.2** | **Adicionar SKU manualmente** ao inventário aberto (fora do snapshot/CSV) + **Transferência entre donos** completa (módulo dedicado, comprovante PDF, cancelamento com estorno automático no ledger) |
| **3b.3** | **Diagnóstico de SKU** ("por que esse produto não soma como NF encerrada"): script SQL + endpoint REST + modal embutido nos HTMLs imprimíveis de **Posição** e **Movimentação** (lupa por linha com 5 categorias de ações sugeridas) |
| **3b.4** | **Auditoria de Saúde do Estoque** — varredura batch do tenant: NF-e encerradas com itens zerados / sem cdProduto (agrupado por NF), SKUs `(só mov.)`, saldo SKU negativo, NF-e abertas há > N dias, cadastros duplicados. Aba dedicada em `estoque-relatorios` + HTML imprimível com lupa de diagnóstico em cada linha. |
| **3b.5** | **Trava anti-"NF encerrada em branco"** — bloqueia o `encerrarRecebimento` quando qualquer item da `CONFERENCIA_JSON` tem produto resolvido mas `qtdRecebida == null`. Aceita `0` explícito (operador confirmou "não recebi"). Defesa em profundidade: validação no front (botão **Encerrar NF**) + no backend (controller). Salvar continua permitido em branco. |
| **3b.6** | **Reservas OPL órfãs** — diagnóstico + saneamento. Serviço classifica reservas em `ATIVA` (espelho ainda tem carga pendente) ou `ORFA` (todas expedidas). Endpoints `GET/POST /api/wms/reservas-opl/[orfas|limpar-orfas]`. Bloco F na Auditoria de Saúde com botão de limpeza segura. Bloco "Reservas OPL" no modal de diagnóstico de SKU (lupa) dos relatórios Posição, Movimentação e Auditoria. |
| **3b.7 (atual)** | **`DH_PRIMEIRO_ENCERRAMENTO`** — coluna nova em `WMS_NFE_ENTRADA` que **não é sobrescrita em reaberturas**. `encerrarRecebimento` usa `COALESCE("DH_PRIMEIRO_ENCERRAMENTO", CURRENT_TIMESTAMP)`. Relatório de Movimentação usa `DH_PRIMEIRO_ENCERRAMENTO` como data oficial da entrada (fallback `DH_ENCERRAMENTO`). Script `adicionar_dh_primeiro_encerramento_nfe_postgres.sql` faz `ALTER TABLE ADD COLUMN IF NOT EXISTS` + backfill. Resiliente a schema antigo via cache de `information_schema.columns`. Também: **corrigidos nomes de colunas** (`CD_NFE`, `NUMERO_NF`, `SERIE` no lugar de `CD_NFE_ENTRADA`/`NU_NF`/`NU_SERIE`) nos services 3b.3/3b.4/3b.6 que estavam quebrando o diagnóstico. Script `wms_diagnostico_nf_nao_soma_postgres.sql` reescrito com `WITH params AS (...)` no lugar de `\set` (psql-only) para rodar em pgAdmin/DBeaver. |
| **3c** | Calendário de ciclos (A/B/C) + KPI cobertura/acuracidade |
| **3d** | Mobile contagem (scanner + cega) |

**DDL:** `backend/scripts/criar_wms_inventario_postgres.sql` + `backend/scripts/adicionar_tipo_ciclico_inventario_postgres.sql` (Fase 3a) + `backend/scripts/adicionar_status_recontagem_inventario_postgres.sql` (Fase 3b) + `backend/scripts/criar_wms_transferencia_dono_postgres.sql` (Fase 3b.2)  
**API (Fase 3b.1):**
- `PATCH /api/wms/inventario/:cdInventario/linhas/:cdLinha/contagem` — registra/atualiza `QTD_CONTADA` de uma linha (edição inline da coluna *Contada*). Recalcula `ST_LINHA` no servidor.
- `PATCH /api/wms/inventario/:cdInventario/linhas/:cdLinha` — atualiza `LOTE` e/ou `VALIDADE` da linha. Valida formato `YYYY-MM-DD` e rejeita se já existir outra linha com mesma chave (`CODIGO_PRODUTO + LOTE + VALIDADE`) no mesmo inventário.
- `POST /api/wms/inventario/:cdInventario/linhas/:cdLinha/dividir` — cria uma **linha-irmã** do mesmo SKU com `LOTE`/`VALIDADE`/`QTD_CONTADA` informados; novas linhas têm `QTD_SISTEMA_SNAPSHOT=0`, `ORIGEM='MANUAL'` e referência da linha-mãe na `OBSERVACAO` (rastreabilidade sem alterar o schema).
- `DELETE /api/wms/inventario/:cdInventario/linhas/:cdLinha` — exclui uma linha do inventário. Útil para descartar "linhas-fantasma" do snapshot que sobraram após o `Dividir`. Regras: inventário não pode estar `ENCERRADO`/`CANCELADO` (use `reativar` se necessário) e a linha não pode estar `APROVADO` (use `recontar` para destravar antes). Auditoria via `SG_USER` no cabeçalho. Não afeta saldo — o inventário ainda está em janela operacional.
- `POST /api/wms/inventario/:cdInventario/reativar` — só admite quando `ST_INVENTARIO='CANCELADO'`; retorna o inventário para `EM_CONTAGEM` preservando linhas/contagens. Auditado por `SG_USUARIO_ALTERACAO` + `DH_ATUALIZACAO`.
- `obterInventarioDetalhe` aplica **auto-heal de `ST_LINHA`**: se uma linha vier `PENDENTE` com `QTD_CONTADA` preenchida (legado), o status é recalculado em memória para o cliente e um `UPDATE` assíncrono corrige o banco sem bloquear a resposta. `encerrarInventario` chama `recalcularStatusLinhasInventario` **antes** de gerar movimentos para garantir consistência final.

**API (Fase 3b.2 — adicionar SKU manual + transferência entre donos):**

- `POST /api/wms/inventario/:cdInventario/linhas` — insere uma **linha nova** no inventário aberto (origem `MANUAL`). Resolve produto no dono via `WMS_PRODUTO_DONO`, bloqueia duplicidade (mesmo SKU+lote+validade), calcula `ST_LINHA` quando há `QTD_CONTADA` no payload. Útil quando o operador encontra um SKU em campo que não estava no snapshot/CSV. Resiliente a Fase 3b parcial (`hasColumn(ST_LINHA)`).
- `POST /api/wms/transferencias/preview` — valida origem/destino, resolve produto, calcula saldo origem e indica se o destino precisa de auto-cadastro (`precisaCadastroDestino: true` + `cadastroSugerido`). Não grava nada.
- `POST /api/wms/transferencias` — transação atômica: opcional `autoCadastrarDestino` copia cadastro origem em `WMS_PRODUTO_DONO` do destino → grava 2 movimentos no ledger (`TRANSFERENCIA_SAIDA` negativo + `TRANSFERENCIA_ENTRADA` positivo) → grava documento em `WMS_TRANSFERENCIA_DONO` com refs aos `CD_MOVIMENTO`. Bloqueia saldo insuficiente a não ser que `permitirNegativar: true`.
- `GET /api/wms/transferencias` — lista paginada (filtros: `cdDono`, `dataInicio`, `dataFim`, `limite`).
- `GET /api/wms/transferencias/:cdTransferencia` — detalhe com JOIN nos donos e produtos (origem + destino).
- `POST /api/wms/transferencias/:cdTransferencia/cancelar` — gera 2 movimentos inversos com idempotência prefixada `EST|TRANSF|` (não conflita com originais) + marca documento `ST_TRANSFERENCIA='CANCELADA'` com `DH_CANCELAMENTO` + `SG_USER_CANCEL`. Bloqueia saldo destino insuficiente a não ser que `permitirNegativar: true`.
- `GET /api/wms/transferencias/:cdTransferencia/comprovante.html` — HTML A4 imprimível com 4 espaços de assinatura. Documentos cancelados saem com marca d'água diagonal "CANCELADA".

**Tabela nova:** `WMS_TRANSFERENCIA_DONO` (BIGSERIAL CD_TRANSFERENCIA, CD_DONO_ORIGEM/DESTINO, CD_PRODUTO_ORIGEM/DESTINO, CODIGO_PRODUTO, NM_PRODUTO_SNAPSHOT, LOTE, VALIDADE, QTD, MOTIVO, ST_TRANSFERENCIA ∈ {EFETIVADA, CANCELADA}, REF_CD_MOVIMENTO_SAIDA, REF_CD_MOVIMENTO_ENTRADA, DH_REGISTRO, DH_CANCELAMENTO, SG_USER, SG_USER_CANCEL). CHECK constraints: origem ≠ destino + status enum.

**Frontend novo:** módulo `backend/public/modulos/estoque-transferencias/` (lista, filtros, comprovante via Blob para preservar header de auth, modal Nova transferência reutilizado, modal Cancelar com checkbox de permitir negativar). Atalho extra continua em **Inventário** (botão "Transferência entre donos" no topo da lista) — mesmo modal/endpoint, sem duplicar lógica.

**API (Fase 3b.3 — diagnóstico de SKU "NF não soma"):**

- `GET /api/wms/diagnostico-sku?cdDono=N&codigo=X` — devolve JSON estruturado com 6 partes: `cadastro` (de-para do produto no dono ou `null`), `resumo` (`qtdEntradaNfEncerrada` + `qtdMovimentos` + `qtdSaldoSku`), `nfsAbertas` / `nfsEncerradas` (lista de NF-e do dono que mencionam o código), `conferencias` (linhas do `CONFERENCIA_JSON` com a coluna `diagnostico.code` ∈ {`OK`, `ABERTA`, `SEM_DONO`, `SEM_CD_PRODUTO`, `QTD_ZERO`}), `movimentos` (últimas 100 do ledger) e `acoes` (sugestões com `codigo` ∈ {`ENCERRAR_RECEBIMENTO`, `REABRIR_RECONFERIR`, `CADASTRAR_PRODUTO`, `IMPORTAR_NFE`, `NADA_A_FAZER`}).
- Mesma lógica do script SQL `backend/scripts/wms_diagnostico_nf_nao_soma_postgres.sql` (que continua disponível para uso direto no pgAdmin).
- Os HTMLs imprimíveis dos relatórios **Posição de estoque** e **Movimentação de itens** ganharam botão de lupa (🔍) ao lado do código do produto. O modal de diagnóstico é embutido no próprio HTML do relatório (popup mesmo origin) e usa as credenciais já guardadas no `localStorage`. A lupa não imprime (`@media print { .btn-diag, .diag-overlay { display: none !important; } }`).

**API (Fase 3b.4 — auditoria de saúde do estoque):**

- `GET /api/wms/auditoria-saude?cdDono=N&dias=7` — varre o tenant (ou um dono) e devolve JSON com 5 listas:
  - `skusSoMovimento` — `Saldo SKU > 0` apenas pelo ledger; agregado de `WMS_NFE_ENTRADA` ENCERRADA `CONFERENCIA_JSON` × `WMS_MOVIMENTO_ESTOQUE`. LIMIT 500.
  - `skusSaldoNegativo` — Saldo SKU < 0 (mesma agregação, filtro inverso).
  - `nfsAbertasAntigas` — `ST_RECEBIMENTO <> 'ENCERRADA'` e `DH_RECEBIMENTO < now - dias`. Default 7.
  - `itensConferenciaInvalidos` — linhas de `CONFERENCIA_JSON` em NF-e ENCERRADAS onde `cdProduto` não é numérico OU `qtdConvertida ≤ 0`. Cada linha vem com `diagnostico ∈ {SEM_CD_PRODUTO, QTD_ZERO}`. O HTML imprimível agrupa **por NF** mostrando "NF encerrada em branco" (caso PIPOCA DOCE — operador encerrou sem digitar Qtd recebida).
  - `cadastrosDuplicados` — `WMS_PRODUTO_DONO` com mesmo `UPPER(NOME)` e `CD_PRODUTO` diferentes no mesmo dono.
- `GET /api/wms/auditoria-saude.html?cdDono=N&dias=7` — renderiza relatório imprimível A4 com 5 cartões de resumo + 5 blocos detalhados. Cada SKU listado tem botão de lupa que chama o diagnóstico embutido (mesma estrutura dos relatórios de Posição e Movimentação).
- Frontend: aba **Auditoria de Saúde** em `estoque-relatorios` (ícone `bx-shield-quarter`). Dono é OPCIONAL (vazio = tenant inteiro). Filtro próprio "NF aberta há mais de N dias".

**Trava no encerramento (Fase 3b.5):**

- `backend/controllers/wms-recebimento.controller.js → identificarItensSemQtdRecebida(payload)` — utilitário puro que devolve a lista de pendências (`[{ nItem, codigoProduto, motivo }]`) para todo item da `CONFERENCIA_JSON` que tem `codigoProduto`/`cdProduto` mas `qtdRecebida` nulo/string vazia/NaN.
- `encerrarRecebimento` (`POST /api/wms/recebimento/documentos/:cdNfe/encerrar`) chama `identificarItensSemQtdRecebida` logo após montar `payloadEnc` e antes da validação de cadastro. Se retornar lista não-vazia, devolve `400` com `error` legível (até 5 itens listados) + `itensSemQtdRecebida` no body (front pode usar para destacar linhas).
- Front (`estoque-recebimento/js/script.js`, handler do `#btnEncerrarRecebimento`) replica a mesma validação local antes de chamar a API — mostra `showMessage('error', ...)` e dá `focus()` no input `qtdRecebida` do primeiro item pendente.
- A função `itemTemDadosConferencia` original **não foi alterada** (continua valendo para `salvar`); a nova regra é apenas no encerramento. Isso preserva o fluxo "salvo parcial" durante a conferência.

**Reservas OPL órfãs (Fase 3b.6):**

- `backend/services/wms-diagnostico-reserva-opl.service.js` — classificador puro: para cada `CD_OPL_ARQUIVO` que tem reserva em `WMS_RESERVA_ESTOQUE_OPL`, busca as cargas vinculadas (via `WMS_OPL_PEDIDO → WMS_NFE_SAIDA.LINHAS_JSON.xPed → WMS_CARGA_PROGRAMADA_NFE → WMS_CARGA_PROGRAMADA`) e classifica em:
  - `ATIVA` — pelo menos uma carga ainda não expedida.
  - `ORFA` — todas as cargas vinculadas já estão `ST_EXPEDICAO='EXPEDIDA'` ou `ST_CARGA='EXPEDIDA'`.
  - `SEM_CARGAS` — espelho sem cargas vinculadas (raro; tratado como legítimo).
  Usa o **mesmo matching** de `listarCargasNaoExpedidasMesmoEspelhoOpl` para que runtime e auditoria concordem.
- API:
  - `GET /api/wms/reservas-opl?cdDono=&cdProduto=` → reservas de um SKU + totais (`totalAtivas`, `totalOrfas`).
  - `GET /api/wms/reservas-opl/orfas?cdDono=` → todas as órfãs do tenant ou dono.
  - `POST /api/wms/reservas-opl/limpar-orfas?cdDono=` → DELETE em batch (`CD_RESERVA = ANY($2::bigint[])`) dentro de uma transação. Só apaga as identificadas como órfãs no momento da chamada — reservas legítimas ficam.
- Auditoria de Saúde 3b.4 estendida: 6º cartão "Reservas OPL órfãs" + bloco F com botão `🧹 Limpar reservas órfãs` no cabeçalho (chama `POST /limpar-orfas` mantendo o filtro de dono da query string atual).
- Diagnóstico de SKU 3b.3 estendido: nova seção `reservasOpl` no payload, renderizada nos 3 HTMLs imprimíveis (Posição, Movimentação, Auditoria) com classificação por linha.

**Limpeza homologação:** `backend/scripts/wms_limpar_movimento_operacional_postgres.sql` (inclui inventário e movimentos).

---

## 12. Referências rápidas no sistema

- Conferência de entrada (campos alinhados à planilha): `codigoProduto`, `qtdRecebida`, `lote`, `validade`, `fatorConversao` — módulo **Recebimento**.
- Export saldo (snapshot manual): **Relatórios WMS** → CSV colunas `CODIGO_PRODUTO`, `LOTE`, `VALIDADE`, `QTD_SALDO_SKU`, etc.
- Política validade mínima no recebimento: **Cadastros WMS → Dono do estoque** (`NU_DIAS_MIN_VALID_RECEB`).

---

## 13. Operação no detalhe do inventário (resumo prático)

**Edição inline:** com `ST_INVENTARIO` em `EM_CONTAGEM` ou `REVISAO`, o operador pode editar direto na tabela **Linhas**:

| Coluna | Comportamento | Endpoint |
|--------|---------------|----------|
| **Contada** | `<input type="number" step="0.001">`. Salva em `Enter` ou `blur`. `Esc` cancela. Atualiza `ST_LINHA` localmente (contadores do banner) e no servidor. | `PATCH /linhas/:cdLinha/contagem` |
| **Lote** | Texto livre. Validação anti-duplicidade no servidor. | `PATCH /linhas/:cdLinha` |
| **Validade** | `<input type="date">` com `color-scheme: light dark` (ícone do calendário fica visível em ambos os temas). | `PATCH /linhas/:cdLinha` |

**Dividir linha (múltiplas validades no mesmo SKU):** ícone de bifurcação na coluna *Ações* abre o modal `#modalDividir`. Caso de uso típico: inventário inicial subido com validade fictícia (`31/12/2026`) que precisa ser desmembrado em datas reais.

**Reativar inventário cancelado:** botão `#btnReativarInv` aparece apenas quando `ST_INVENTARIO='CANCELADO'`. Retorna o inventário para `EM_CONTAGEM` sem perder histórico.

**Coluna "Sist. linha":** mostra `QTD_SISTEMA_SNAPSHOT` apenas na **primeira linha** de cada SKU. Linhas subsequentes do mesmo código exibem `↑ mesmo SKU` (evita o erro de interpretação "o saldo está duplicado"). Quantidades formatadas pela função `fmtQtd()` no front: inteiros aparecem sem decimais (`1709`), frações até 3 casas (`1.234,567`).

---

*Última atualização: Fase 3b.6 — **Reservas OPL órfãs**: classifica reservas em `ATIVA`/`ORFA` reusando o matching de `listarCargasNaoExpedidasMesmoEspelhoOpl`. Auditoria de Saúde ganhou cartão e bloco F com botão `🧹 Limpar reservas órfãs`. Diagnóstico de SKU mostra reservas pendentes por espelho. Resolve o caso "tenho saldo mas a trava diz que falta" (caso DETERGENTE ALKIM). Mantém 3b.1 a 3b.5.*
