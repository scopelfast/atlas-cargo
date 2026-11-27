# Relatório de auditoria técnica — Módulo financeiro (Fases 1 e 2)

Atualizado em 26/11/2026.

Fonte oficial de negócio: `docs/PLANO_MODULO_FINANCEIRO.md`.

**Esta etapa não altera código, banco nem migrations.** O relatório descreve o que existe, o encaixe seguro das fases 1 e 2, e o que ainda precisa de decisão antes de implementar.

---

## 1. Decisões técnicas (resumo)

| Tema | Decisão recomendada |
| --- | --- |
| Ponto único de criação da cobrança de conexão | Dentro da transação de `confirmarConvocacao`, depois do `UPDATE … STATUS = 'CONFIRMADA'` e antes do `commit` |
| Aceite do motorista | Não chama o serviço financeiro |
| Descarte (`ACEITA_DESCARTADA`) | Não gera cobrança |
| Cancelamento da cobrança | Em `reativarConvocacao` (viagem comum) e em `desistirLote` (lote → status `DESISTIU`) |
| Contrato do agenciador | Tabelas novas ligadas a `SAAS_CLIENTE_CONTRATANTE.TENANT_ID`, sem segundo cadastro de empresa |
| Regra ligada | Flag no contrato, padrão `N` (desligada) |
| Valor monetário | Inteiro em centavos (`BIGINT`); memória de cálculo em texto/JSON; não usar `float` |
| Baixa | Manual, só com atividade financeira do painel; motorista não baixa |
| Pix / Asaas / webhook | Fora desta entrega; colunas reservadas nulas |
| Tela 7.1 estoque | Intacta |
| Bloqueio | Fora das fases 1 e 2 (nenhum tenant bloqueado) |

---

## 2. Arquitetura atual encontrada

### 2.1 Torre e convocação

| Peça | Onde |
| --- | --- |
| Controller principal | `backend/controllers/viagemmestre.controller.js` |
| Rotas autenticadas da torre | `backend/routes/viagemmestre.routes.js` |
| Aceite/recusa públicos (link) | `backend/routes/viagem-public.routes.js` → `responderConvocacao` |
| Aceite/recusa no app | `backend/controllers/motorista-app.controller.js` (`aceitarConvocacao` / `recusarConvocacao`) |
| Campanhas / oportunidades | `backend/controllers/oportunidades-campanhas.controller.js` |
| Lote (filha / desistência) | `backend/services/viagem-lote-saldo.service.js` |
| Transação SQL | `createTransaction` em `backend/config/db.js` (`BEGIN` / `COMMIT` / `ROLLBACK` no client do `pg`) |
| Tenant da requisição | `attachTenantContext` + `tenantIdForRequest` (`backend/middleware/tenant.middleware.js`, `backend/utils/tenant-context.js`) |
| Auth torre | `towerAuthAndTenant` (`backend/middleware/tower-auth-chain.middleware.js`) |

Não há model/repository separado de convocação: a regra está no controller e em serviços pontuais (lote, bolsão, placas).

### 2.2 SaaS e “financeiro” existente

| Peça | Papel atual |
| --- | --- |
| `SAAS_CLIENTE_CONTRATANTE` | Cliente/tenant (agenciador). PK `TENANT_ID`. Plano, empresa opcional, limites, contato |
| `SAAS_PLANO` / `SAAS_PLANO_MODULO` / `SAAS_MODULO` | Catálogo de módulos licenciáveis (alertas, chat, etc.). **Sem preço** |
| `SAAS_TENANT_MODULO` | Override de módulo por tenant |
| `SAAS_PEDIDO_ACESSO` | Pedido público de acesso |
| Tela 7.1 `estoque-cobranca` | Estimativa de armazenagem/expedição WMS (`PCT_COBRANCA_*`). **Não é recebimento de Pix nem comissão de carga** |
| Menu | `TIPOATIVIDADE.DSPROGRAMA` + `USUARIOATIVIDADE` |

Script base SaaS: `backend/scripts/saas_estrutura_plano_cliente_modulo_postgres.sql`.

### 2.3 Testes automatizados

`backend/package.json` não tem Jest, Mocha, Vitest nem Playwright. Existem scripts manuais (`test_viagem.js`, guias em `docs/` e módulos). Os “testes obrigatórios” das fases 1–2 precisam nascer como roteiro executável (e, se desejado, scripts Node ad hoc no padrão do repositório), não como suite CI já existente.

---

## 3. Fluxo real da confirmação

### 3.1 Rota

`POST /api/…/convocacoes/:id/confirmar` → `viagemController.confirmarConvocacao`  
Definida em `backend/routes/viagemmestre.routes.js` (~156).

### 3.2 Sequência (arquivo `viagemmestre.controller.js`)

Função: `confirmarConvocacao` (~2806–3461).

1. Autentica operador (`user-login` / JWT) e exige usuário ativo em `USUARIO` (~2810–2835).
2. Resolve `tidConfirm = tenantIdForRequest(req)` (~2837).
3. Lê a convocação por `IDCONVOCACAO` **e** `TENANT_ID` (~2840–2855).
4. Exige status `ACEITA` (~2857–2871). `CONFIRMADA`, `ACEITA_DESCARTADA` e demais são rejeitados.
5. Gate de GPS para aceite vindo de link de campanha (`SGUSER = APP_MOTORISTA_LINK`) (~2873–2889).
6. Detecta lote (`TIPO_SALDO` EMBARQUES/TONELADAS) (~2891–2912).
7. **Viagem comum:** consulta se já existe outra `CONFIRMADA` na mesma viagem/tenant (~2915–2936). Essa leitura é **fora** da transação.
8. `createTransaction` + `begin` (~2938–2941).
9. Se lote: `loteSaldo.consumirECriarFilha` (pode trocar `IDVIAGEM` para a filha) (~2946–2957).
10. `UPDATE CONVOCACAO SET STATUS = 'CONFIRMADA'` (~2958–2973).
11. **Viagem comum:** outras `ACEITA` da mesma viagem → `ACEITA_DESCARTADA` (~2979–3000). No lote, aceites restantes na mãe continuam `ACEITA`.
12. Grava `VIAGEMMOTORISTA`, tenta vincular veículos, põe viagem em situação Programada (`FGSITVIAGEM = 'P'`) (~3002–3086).
13. `commit` (~3088).
14. Depois do commit: WebSocket, WhatsApp Switch, resposta HTTP (~3091+).

### 3.3 Ponto exato para criar a cobrança

**Único ponto recomendado:** dentro do `try` da transação de `confirmarConvocacao`, após o `UPDATE` que grava `CONFIRMADA` (após ~2973) e antes do `commit` (~3088).

Motivos:

- É o único caminho de torre que promove `ACEITA` → `CONFIRMADA`.
- Já filtra por tenant.
- Já distingue viagem comum (um confirmado) e lote (várias confirmações em filhas).
- Aceite (app/link) e descarte não passam por aqui.

Encapsular a criação em um serviço (`financeiro-cobranca.service.js` ou similar) chamado **só** daqui na fase 2, para não espalhar regra em `motorista-app`, `oportunidades-campanhas` ou `responderConvocacao`.

Se a regra do tenant estiver desligada ou inexistente: o serviço retorna “sem cobrança” e a confirmação segue igual à de hoje.

Se a regra estiver ligada e a gravação da cobrança falhar: lançar erro, `rollback` da transação já existente — a confirmação não fica parcial.

---

## 4. Fluxo de aceite (sem cobrança)

| Entrada | Função | Efeito |
| --- | --- | --- |
| App | `motorista-app.controller.js` aceitar (~1969–1988) | `PENDENTE`/`ACEITA` → `ACEITA`; bloqueia se já `CONFIRMADA` ou `ACEITA_DESCARTADA` |
| App | recusar (~2042–2058) | → `RECUSADA`; também não altera `CONFIRMADA` |
| Link público | `responderConvocacao` (~4327+) | Só responde se status atual é `PENDENTE` (~4429); `ACEITA` ou `RECUSADA` |

Nenhum desses caminhos deve chamar o módulo financeiro.

---

## 5. Fluxo de desistência e reativação

### 5.1 Desistência / reabertura da torre — viagem comum

`POST …/convocacoes/:id/reativar` → `reativarConvocacao` (~3998–4232).

- Só aceita status atual `CONFIRMADA` (~4057–4063).
- Recusa se a viagem for filha de lote (`IDVIAGEM_MAE` preenchido) e manda usar Desistir do lote (~4065–4078).
- Exige motivo em `MOTIVOREABERTURA`.
- Em transação: grava `HISTORICOREABERTURA`; muda a confirmada para `ACEITA`; reativa todas as `ACEITA_DESCARTADA` da viagem para `ACEITA` (~4138–4195); `commit`.

**Efeito financeiro proposto:** cancelar a cobrança ativa ligada a essa `IDCONVOCACAO` + ciclo de confirmação. Se já houver baixa manual, registrar evento de **reversão da baixa** (não apagar histórico) e então cancelar.

### 5.2 Desistência de lote

`POST …/convocacoes/:id/desistir-lote` → `desistirLote` (~3962) → `loteSaldo.devolverVaga`.

- Exige `CONFIRMADA`; usa `FOR UPDATE` (~311).
- Status final da convocação: `DESISTIU` (~429).
- Cancela a viagem filha (`FGSITVIAGEM = 'C'`, `FGACTIVE = 'I'`).

**Efeito financeiro proposto:** mesmo cancelamento/reversão da cobrança daquela confirmação.

### 5.3 “Desistência do motorista” — lacuna importante

Depois de `CONFIRMADA`, o app e o link **não deixam** o motorista recusar nem desistir:

- App: updates excluem `CONFIRMADA` / `ACEITA_DESCARTADA` (~1987, ~2057).
- Link: só responde `PENDENTE`.

Hoje, quem desfaz a confirmação é a **torre** (`reativar` ou `desistir-lote`).

**Dúvida de negócio (bloqueia implementação segura da frase “ele desiste da carga”):**

1. “Motorista desiste” = apenas recusa **antes** da confirmação (já sem cobrança)?  
2. Ou será criada uma ação nova pós-confirmação no app?  
3. Ou a torre registra a desistência dele via `reativar` / motivo específico?

Até decidir, o cancelamento financeiro pós-confirmação fica amarrado só aos fluxos da torre que já existem.

### 5.4 Cancelamento de viagem

Não há endpoint dedicado “cancelar viagem” que reverta `CONFIRMADA` no mesmo padrão de `reativar`. Inativação/`FGACTIVE` aparece em listagens e no lote (`devolverVaga`). Qualquer cancelamento de viagem que deixe a confirmação órfã precisa ser inventariado na implementação; hoje o caminho explícito de “desistir da confirmação” é reativar / desistir-lote.

---

## 6. Concorrência e integridade

### 6.1 O que já existe

| Cenário | Proteção atual |
| --- | --- |
| Segunda confirmação em viagem comum | Checagem de outra `CONFIRMADA` **antes** da transação (~2915–2935); rejeita 400 |
| Lote consumir/devolver saldo | `FOR UPDATE` nas linhas de viagem/convocação no serviço de lote |
| Aceite após confirmada | App/link recusam 409 |
| Reativação só de confirmada | Validação de status |

### 6.2 Riscos

| Risco | Avaliação | Mitigação proposta |
| --- | --- | --- |
| Duas confirmações concorrentes na mesma viagem comum | **Alto.** A checagem de `CONFIRMADA` está fora do `BEGIN`; não há `FOR UPDATE` nem unique parcial | Dentro da transação: `SELECT … FOR UPDATE` na viagem (ou nas convocações `ACEITA`/`CONFIRMADA`) + revalidar que não há outra `CONFIRMADA` + `UPDATE … WHERE STATUS = 'ACEITA'` com checagem de `rowCount` |
| Cobrança duplicada para a mesma confirmação | Médio, se o serviço for chamado duas vezes | Unique parcial: uma cobrança **ativa** por (`IDCONVOCACAO`, modalidade `CONEXAO`) ou por token de ciclo de confirmação; idempotência no serviço |
| Desistência × confirmação simultâneas | Médio | Cancelamento e criação só dentro de transação com lock da convocação |
| Baixa manual × cancelamento | Médio | Atualizar cobrança com `WHERE STATUS = …` esperado; se `rowCount = 0`, rejeitar; eventos append-only |
| Falha ao gravar cobrança | Tratado se estiver na mesma transação da confirmação | Rollback; confirmação não commitada |
| Reutilizar cobrança antiga na nova confirmação | Proibido pelo plano | Nova confirmação = novo registro; a antiga fica `CANCELADA` (ou paga/revertida) |
| Alterar valor de cobrança já gerada | Proibido | Sem `UPDATE` de valor; só eventos de status |

### 6.3 Atomicidade exigida

Com regra ligada:

```
BEGIN
  … updates atuais da confirmação …
  INSERT cobrança (status ABERTA, valor congelado)
  INSERT evento CRIADA
COMMIT
```

Com regra desligada: comportamento atual, sem insert financeiro.

---

## 7. Valores de cálculo — o que o código tem

| Campo | Tabela | Tipo | Significado operacional |
| --- | --- | --- | --- |
| `VLFRETE` | `VIAGEMMESTRE` | `numeric(15,4)` (`script_db_postgres.sql` ~919) | Frete da viagem / oferta na torre |
| `VL_FRETE_PROPOSTO_MOTORISTA` | `CONVOCACAO` | `NUMERIC(15,2)` | Proposta opcional do motorista no aceite |
| `MOEDA` | `VIAGEMMESTRE` | existente (fase multimoeda) | Moeda da viagem |
| `IDVIAGEM` | `VIAGEMMESTRE` / `CONVOCACAO` | `NUMERIC(15,0)` | Identificador da oferta/viagem |
| `DHINCLUSAO` / `DHMAINTENANCE` | `VIAGEMMESTRE` | timestamp | Datas da viagem |
| `OPORT_CAMPANHA.ID` + `CRIADO_EM` | campanha | BIGSERIAL / timestamp | Campanha de divulgação; liga viagens em `OPORT_CAMPANHA_VIAGEM` |
| `PCT_COBRANCA_*` | dono WMS | percentual JS `round2` | **Só estoque 7.1 — não reutilizar** |

### 7.1 Base do percentual (conexão) — precisa confirmação

Candidatos:

1. **`VIAGEMMESTRE.VLFRETE`** — valor anunciado/cadastrado na viagem. Mais estável na confirmação.  
2. **`CONVOCACAO.VL_FRETE_PROPOSTO_MOTORISTA`** — pode ser nulo; é proposta do motorista, não necessariamente o frete fechado.  
3. Outro campo de “valor efetivamente contratado” — **não foi encontrado** um terceiro campo dedicado na confirmação.

**Recomendação técnica provisória (não implementar até confirmar):** percentual da conexão sobre `VLFRETE` da viagem confirmada (ou da filha, no lote), congelado em centavos no instante da confirmação. Se `VLFRETE` for nulo ou ≤ 0 e o contrato exigir percentual, a confirmação com regra ligada deve falhar com erro claro (não inventar R$ 100).

### 7.2 “Carga anunciada” (fase 3 — só preparar modelo)

Ainda não gerar cobrança por publicação. O contrato pode já ter o componente. Falta definir o evento de anúncio:

- criação da viagem;
- inclusão em `OPORT_CAMPANHA_VIAGEM`;
- ou primeiro disparo/convocação.

Identificador natural da oferta: `IDVIAGEM` (+ `TENANT_ID`). Campanha é agregador, não substitui a viagem.

---

## 8. Isolamento e pagadores

### 8.1 Tenant

- Torre: `req.tenantId` do JWT via `attachTenantContext`.
- Queries de confirmação já filtram `CONVOCACAO.TENANT_ID` e `VIAGEMMESTRE.TENANT_ID`.
- APIs financeiras novas devem usar o mesmo `tenantIdForRequest` e **nunca** aceitar `tenantId` solto do body para escopo de leitura/baixa.

### 8.2 Motorista e bolsão

- `CONVOCACAO.CDCADASTRO_MOTORISTA` + `CONVOCACAO.TENANT_ID` (tenant da **operação**).
- Cadastro do bolsão pode viver no tenant `default` com vínculo em `CADASTRO_TENANT_VINCULO`; a convocação da campanha usa o `TENANT_ID` do agenciador.
- Cobrança de **conexão**:  
  - `MODALIDADE = CONEXAO`  
  - `PAGADOR_TIPO = MOTORISTA`  
  - `PAGADOR_CDCADASTRO = CDCADASTRO_MOTORISTA`  
  - `TENANT_ID` = tenant da convocação confirmada (quem opera a oferta)  
- Cobrança de **uso**:  
  - `MODALIDADE = USO_PLATAFORMA`  
  - `PAGADOR_TIPO = TENANT`  
  - `PAGADOR_TENANT_ID = TENANT_ID` do agenciador  

Dívidas não se cruzam: listagem/baixa de conexão filtra motorista; de uso filtra tenant pagador.

### 8.3 Tenant `default`

- Sem contrato ou com `FG_REGRA_ATIVA = 'N'`: confirmação idêntica à atual.
- Fases 1–2: nenhum bloqueio.
- Mesmo em fases futuras: plano proíbe bloquear o `default`.

### 8.4 Baixa manual

- Só usuário torre com atividade do programa financeiro (ex.: `DSPROGRAMA = 'financeiro'` ou equivalente).
- Rotas sob `towerAuthAndTenant`.
- Token de motorista **não** acessa endpoint de baixa.

---

## 9. Modelo de dados proposto (fases 1 e 2)

Reutilizar `SAAS_CLIENTE_CONTRATANTE` como dono do contrato. **Não** criar segundo cadastro de agenciador.

Tipos: centavos em `BIGINT`; percentuais em `NUMERIC(9,4)` na regra (não no valor cobrado); flags `CHAR(1)`; IDs `BIGSERIAL` ou `NUMERIC` alinhado ao projeto; `TENANT_ID VARCHAR(64)`.

### 9.1 Tabelas novas

**`FIN_CONTRATO`**

- `ID` PK  
- `TENANT_ID` UK lógica do contrato vigente (ou versão; ver abaixo) → FK lógica a `SAAS_CLIENTE_CONTRATANTE`  
- `FG_REGRA_ATIVA` `'S'|'N'` default `'N'`  
- `DH_INICIO`, `DH_FIM` (vigência)  
- `POLITICA_INADIMPLENCIA` `'ALERTA'|'BLOQUEIO'` default `'ALERTA'` (fase 4; gravar já)  
- `VERSAO` inteiro  
- `FGACTIVE`  
- auditoria: `DHINCLUSAO`, `SGUSERINCLUSAO`, `DHMAINTENANCE`, `SGUSER`

**`FIN_CONTRATO_COMPONENTE`**

- `ID` PK  
- `ID_CONTRATO`  
- `TIPO` `'FIXO' | 'POR_CARGA_ANUNCIADA' | 'PERCENTUAL' | 'CONEXAO_FIXO' | 'CONEXAO_PERCENTUAL'` (ou separar contrato de conexão vs uso; ver dúvida §12)  
- `VALOR_CENTAVOS` (fixos) nullable  
- `PERCENTUAL` nullable  
- `FG_ATIVO`  
- Ordem / composição para mix  

**`FIN_COBRANCA`**

- `ID` PK  
- `MODALIDADE` `'CONEXAO' | 'USO_PLATAFORMA'`  
- `TENANT_ID` (escopo operacional / dono da oferta ou do contrato)  
- `PAGADOR_TIPO` `'MOTORISTA' | 'TENANT'`  
- `PAGADOR_CDCADASTRO` nullable  
- `PAGADOR_TENANT_ID` nullable  
- `IDVIAGEM` nullable  
- `IDCONVOCACAO` nullable  
- `ID_CONFIRMACAO_CICLO` ou `DH_CONFIRMACAO` + `IDCONVOCACAO` para amarrar o ciclo (reativar gera nova cobrança; a antiga fica cancelada)  
- `ID_CONTRATO` + `VERSAO_CONTRATO`  
- `VALOR_CENTAVOS` **imutável** após insert  
- `MEMORIA_CALCULO` texto/json (componentes, base `VLFRETE`, percentual, etc.)  
- `STATUS` `'ABERTA' | 'PAGA' | 'CANCELADA'` (e, se útil, `REVERTIDA` só em evento; status final cancelada após reversão)  
- `DH_VENCIMENTO` nullable  
- `DH_BAIXA`, `SGUSER_BAIXA`, `DS_BAIXA` nullable  
- Reservado Pix (nulos): `GATEWAY_PROVIDER`, `GATEWAY_CHARGE_ID`, `PIX_TXID`, `PIX_COPIA_COLA`, `PIX_QR_URL`  
- Unique parcial sugerido (Postgres): uma `ABERTA` por (`IDCONVOCACAO`) onde modalidade = conexão  

**`FIN_COBRANCA_EVENTO`** (append-only)

- `ID`, `ID_COBRANCA`, `TIPO` (`CRIADA`, `BAIXA_MANUAL`, `REVERSAO_BAIXA`, `CANCELADA`, …)  
- `STATUS_ANTERIOR`, `STATUS_NOVO`  
- `SGUSER`, `DH_EVENTO`, `DETALHE`, `IP` opcional  

**Histórico de contrato**

Opção A: nova linha em `FIN_CONTRATO` a cada alteração (`VERSAO++`, fecha vigência da anterior).  
Opção B: `FIN_CONTRATO_HIST` espelho.  

Recomendação: **Opção A** (versão imutável referenciada pela cobrança).

### 9.2 O que não criar agora

- Tabelas Asaas / webhook inbox (podem esperar fase 5; colunas reservadas bastam).  
- Ledger contábil.  
- Alterações em `estoque-cobranca` / `PCT_COBRANCA_*`.

### 9.3 Scripts

Padrão do repo: `backend/scripts/*_postgres.sql` idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), espelho em `script_db_postgres.sql` se banco novo precisar, dump em `backups/` no mesmo envio do código (regra do workspace). **Não executar nesta auditoria.**

---

## 10. Permissões necessárias

| Capacidade | Como encaixar |
| --- | --- |
| Ver cobranças / contrato | Novo `TIPOATIVIDADE` com `DSPROGRAMA` (ex. `financeiro`) + pasta em `backend/public/modulos/` |
| Configurar contrato / ligar regra | Mesma tela, ação restrita (mesmo programa ou programa `financeiro-config`) |
| Baixa manual | Mesmo módulo; validar atividade no backend, não só esconder botão |
| Cancelar / reverter | Operador financeiro; idealmente o mesmo que baixa, ou papel separado |

Não criar RBAC paralelo. Seguir `USUARIOATIVIDADE` como o resto do painel. Licença SaaS (`requireTenantModule`) é ortogonal; fases 1–2 podem ficar só em atividade de menu, ou ganhar chave `financeiro` no catálogo depois.

---

## 11. Estratégia transacional (fase 2)

1. Reforçar lock na confirmação (viagem comum) com `FOR UPDATE` + revalidação de status.  
2. Chamar `financeiro.criarCobrancaConexao({ transaction, convocacao, viagem, operador })`.  
3. Se `FG_REGRA_ATIVA !== 'S'`: no-op.  
4. Se ligada: calcular centavos no servidor; `INSERT` cobrança + evento; falha → `rollback`.  
5. Em `reativarConvocacao` e `devolverVaga`: na **mesma** transação, cancelar cobrança aberta daquele `IDCONVOCACAO`; se `PAGA`, inserir `REVERSAO_BAIXA` e depois `CANCELADA`.  
6. WhatsApp/WebSocket continuam **após** commit (como hoje), para não acoplar canal externo à atomicidade financeira.

---

## 12. Testes a planejar (roteiro)

Sem framework CI, cada item vira caso de verificação manual/script:

1. Aceite sem confirmação → 0 cobrança.  
2. Confirmação com regra desligada → 0 cobrança; viagem confirmada ok.  
3. Confirmação com regra ligada → 1 cobrança `ABERTA`, valor = contrato.  
4. Segundo motorista `ACEITA_DESCARTADA` → 0 cobrança para ele.  
5. “Desistência do motorista” → **pendente de definição** (§5.3); se só recusa pré-confirmação, cobrir recusa sem cobrança.  
6. Reativar (torre) → cobrança cancelada (ou revertida+cancelada).  
7. Desistir lote → idem.  
8. Reativar e confirmar de novo → **nova** cobrança; antiga não reabre.  
9. Confirmar de novo a mesma já `CONFIRMADA` → 400; ainda 1 cobrança.  
10. Duas confirmações concorrentes (mesma viagem comum) → no máximo uma `CONFIRMADA` e uma cobrança.  
11. Forçar falha no insert da cobrança → rollback; status da convocação permanece `ACEITA`.  
12. Baixa manual sem permissão → 403; com permissão → `PAGA` + evento.  
13. Cancelar após baixa → evento reversão + cancelada; histórico intacto.  
14. Alterar contrato / versão → cobrança antiga com centavos originais.  
15. Listar/baixar cobrança de outro tenant → 404/403.  
16. Tenant `default` sem regra → confirmação idêntica ao build atual.

---

## 13. Arquivos que seriam alterados (quando aprovado)

| Arquivo | Motivo |
| --- | --- |
| `backend/controllers/viagemmestre.controller.js` | Chamar criação/cancelamento na transação de confirmar / reativar / desistir-lote |
| `backend/services/viagem-lote-saldo.service.js` | Cancelar cobrança em `devolverVaga` (ou hook injetado) |
| **Novo** `backend/services/financeiro-*.service.js` | Contrato, cálculo, cobrança, eventos, baixa |
| **Novo** `backend/routes/financeiro.routes.js` (+ registro em `app.js`) | API painel |
| **Novo** `backend/public/modulos/…-financeiro/` | UI fases 1–2 |
| **Novo** `backend/scripts/financeiro_*_postgres.sql` | DDL idempotente |
| `script_db_postgres.sql` | Espelho se banco novo |
| `backups/atlas_cargo_prd_YYYYMMDD.dump` + `backups/README_RESTORE.md` | Com o código |
| Script menu `TIPOATIVIDADE` | Programa do módulo |
| `docs/EVOLUCAO_ATLAS_CARGO.md` | Registrar entrega |
| **Não tocar** | `estoque-cobranca/*`, WMS `PCT_COBRANCA_*`, fluxo de aceite do motorista (exceto se nascer desistência pós-confirmação) |

Ordem de implementação alinhada ao plano:

1. DDL + serviço de contrato/cobrança + UI listagem (fase 1, regra off).  
2. Hook em `confirmarConvocacao` + testes 1–4, 8–11, 14–16.  
3. Hook em `reativar` / `desistirLote` + testes 6–7, 12–13.  
4. Só então discutir fase 3 (uso) e fase 4 (bloqueio).

---

## 14. Dúvidas de negócio que impedem implementação segura

1. **Desistência do motorista após confirmação** — não existe no código; o plano cita o caso. Definir canal e efeito.  
2. **Base do percentual da conexão** — `VLFRETE` vs proposta do motorista vs outro valor “fechado”.  
3. **Contrato único ou dois blocos** — componentes de **conexão** (motorista) e de **uso** (agenciador) no mesmo `FIN_CONTRATO` ou tabelas/seções separadas? Mix do uso (fixo + por carga + %) é claro; a conexão fixa/% precisa ficar explícita no mesmo contrato do tenant ou em regra global Atlas.  
4. **Quem recebe a conexão nesta fase sem Pix** — só controle de dívida (Atlas / tenant) na tela; destinatário financeiro real fica para fase 5. Confirmar se a cobrança de conexão é dívida **para a Atlas** ou **para o agenciador** da viagem.  
5. **Lote** — cada confirmação de filha gera uma cobrança de conexão (recomendado: sim, uma por `CONFIRMADA`). Confirmar.  
6. **Evento de “carga anunciada”** (fase 3, mas já no modelo) — o que conta como publicação.  
7. **Moeda** — cobrança só BRL na v1 ou respeitar `VIAGEMMESTRE.MOEDA`? Centavos assumem duas casas; `VLFRETE` tem 4.

---

## 15. Riscos (visão geral)

| Risco | Severidade | Nota |
| --- | --- | --- |
| Race na confirmação comum sem `FOR UPDATE` | Alta | Corrigir junto com a fase 2, mesmo sem financeiro, ou o financeiro herda duplicidade |
| Acoplar Pix cedo | Alta | Evitado pelo plano |
| Bloquear tenant por bug de regra | Alta | Fases 1–2 sem bloqueio; default `FG_REGRA_ATIVA = N` |
| Misturar 7.1 WMS com este módulo | Média | Nomes/menus distintos (`financeiro` ≠ `estoque-cobranca`) |
| Cobrar no aceite por engano | Alta | Não alterar controllers de aceite; só `confirmarConvocacao` |
| Bolsão: pagador em tenant diferente do da convocação | Média | Modelar pagador por `CDCADASTRO` + tenant da operação separado |
| Ausência de suite automatizada | Média | Roteiro obrigatório antes de ligar regra em tenant real |

---

## 16. Critério de preservação

Para qualquer tenant sem contrato ou com regra desligada:

- `POST confirmar` permanece funcionalmente equivalente ao código atual (salvo endurecimento de lock recomendado, que só rejeita duplicidade já indesejada).  
- Aceite, campanha, estoque, login e WhatsApp de convocação não dependem do módulo financeiro.  
- Nenhuma cobrança, alerta ou bloqueio é emitido.

---

## 17. Encerramento

Auditoria concluída. **Nenhuma alteração de código, SQL ou commit foi feita além deste relatório.**

Aguardar aprovação expressa para iniciar a fase 1 (DDL + contrato + listagem, regra desligada) e, em seguida, a fase 2 (hook na confirmação).
