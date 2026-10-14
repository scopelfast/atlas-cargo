# App motorista — Perfil, veículos, aprovação na torre e convocação

Documento de referência para evolução do cadastro do motorista (`/motorista/pages/cadastro.html`), área de **atualização** a partir do **dashboard**, cadastro de **veículo(s)** com o mesmo rigor de **pendência de aprovação** que o motorista, integração futura com **APIs oficiais** (opcional) e **confirmação de placas** na convocação.

---

## 1. Objetivos

- Permitir que o motorista **complete e atualize** dados pessoais (incl. documento habilitante / CNH e fotos).
- Permitir que o motorista informe **um ou mais veículos** (placa, papel no conjunto — ex.: cavalo / carreta —, RENAVAM quando fizer sentido, fotos de documento do veículo).
- Garantir que tudo que vier do app passe por **validação na torre** antes de virar cadastro operacional confiável (`STATUSAPROVACAO` / equivalente por **motorista** e por **veículo**).
- Reduzir erro operacional na **convocação**, pedindo **confirmação das placas** (ou do conjunto) antes de tratar como aceito / antes de disparos finais.
- Opcionalmente, **enriquecer** cadastro com consultas **oficiais** (ex.: Serpro / bases governamentais), quando houver **contrato e orçamento** — não depender disso para o MVP.

---

## 2. Princípios

| Princípio | Detalhe |
|-----------|---------|
| **Multi-tenant** | Dados e pendências **sempre** no escopo do `TENANT_ID` do transportador / cadastro que recebe o motorista. |
| **Pendência** | Igual ao motorista: envio pelo app → estado **Pendente** → torre **Aprova / Rejeita** → só então integração plena com `EQUIPAMENTO` / viagem. |
| **LGPD** | Finalidade clara, retenção de anexos, acesso restrito na torre, logs mínimos necessários. |
| **Segredos** | Credenciais de API externa **somente no backend**; app chama só APIs internas do SysScopel. |
| **Frota vs. pessoa** | Dados **complementares do veículo/equipamento** (ex.: RENAVAM operacional na frota, chassi, carroceria, eixos — equivalente a extensões tipo tabela `VEICULO` no legado) pertencem ao programa **Gerenciar Equipamentos**, não ao **Gerenciar Cadastro Geral**. O cadastro geral trata **pessoa** e **vínculo** (`MOTORISTA_VEICULO` + `CDEQUIPAMENTO`); a ficha mestre e enriquecimento técnico ficam na frota. Evoluções futuras (nova aba, campos extras) devem concentrar-se em **Gerenciar Equipamentos**. |

---

## 3. Experiência do usuário (UX)

### 3.1 Dashboard (`/motorista/pages/dashboard.html`)

- Incluir entrada explícita: **“Meu perfil e veículos”** (card ou botão na área principal ou junto às ações rápidas).
- Preferência: **não** colocar formulário longo no próprio dashboard — **navegar** para página dedicada (menos scroll, melhor em celular).

### 3.2 Página dedicada (nova ou evolução do cadastro)

- **Modo cadastro inicial** (sem sessão ou fluxo atual): mantém `cadastro.html` como porta de entrada.
- **Modo edição logado**: mesma base de campos, com `GET` para carregar dados atuais e `PUT`/`POST` para salvar alterações e novos anexos.
- Nome sugerido de rota de página: `perfil.html` ou `cadastro-completo.html` — decisão de implementação.

### 3.3 Blocos na tela

1. **Motorista** — dados já existentes + foto(s) CNH / documento habilitante + status de aprovação visível (“Em análise”, “Aprovado”, “Ajuste necessário”).
2. **Veículo(s)** — lista: placa(s), tipo/papel, RENAVAM (opcional), upload CRLV/CIV, **status por linha** (Pendente / Aprovado / Rejeitado).

---

## 4. Modelo de dados (direção)

### 4.1 Motorista (já alinhado ao código atual)

- `CADASTROGERAL` + `MOTORISTA_COMPLEMENTO` com `STATUSAPROVACAO`, `FOTOCNH`, dados de CNH, etc.
- `FGACTIVE` / fluxo de inativo até aprovação na torre conforme regra já usada no app.

### 4.2 Veículo(s) — a definir na implementação

- **Implementado:** extensão de `MOTORISTA_VEICULO` com `TENANT_ID`, `PLACA_NORMALIZADA`, `STATUSAPROVACAO`, `PAPEL_CONJUNTO`, anexo CRLV, timestamps de aprovação e `CDEQUIPAMENTO`.
- Na **aprovação na torre** (`POST .../motorista-veiculos/:id/aprovar`): o backend **resolve** o `IDEQUIPAMENTO` — se o body trouxer `cdequipamento` válido no tenant, usa-o; senão reutiliza `CDEQUIPAMENTO` já na linha; senão busca **EQUIPAMENTO** pela **placa normalizada** no tenant; senão **INSERT** em `EQUIPAMENTO` (tipo de atuação **T** terceiro, carroceria **10**, tipo/marca mínimos do catálogo ou tipo informado no app, classe quando existir, rastreado espelhado do cadastro do motorista). O vínculo “este motorista usa este veículo” continua em `MOTORISTA_VEICULO`; o cadastro mestre da frota fica em **Gerenciar Equipamentos**.
- **UI torre:** o bloco “Atrelar equipamento da frota” no Cadastro Geral inclui atalho para **Gerenciar Equipamentos** quando for preciso criar ou completar ficha de veículo antes de voltar a atrelar; não duplicar formulário de dados complementares no Cadastro Geral.
- **Gerenciar Equipamentos (torre):** aba **Ficha técnica** + tabela PostgreSQL `EQUIPAMENTO_FICHA_TECNICA` (script `backend/scripts/adicionar_equipamento_ficha_tecnica_postgres.sql`); APIs `GET/PUT /api/equipamentos/:id/ficha-tecnica` — RENAVAM (frota), chassi, nº frota, carroceria, categoria CNH, tara, capacidades (extensível). **Dimensões** do veículo (capacidade de carga, altura, largura, comprimento, m³) permanecem colunas de **`EQUIPAMENTO`** e ficam na mesma aba; ao **Salvar ficha**, o front envia `PUT /api/equipamentos/:id` (payload alinhado à aba Dados) e em seguida o `PUT` da ficha complementar. Mesmos padrões de UI do módulo (cards, `filtros-actions` com `btn-filtro-*`, overlay de carregamento).
- **Remover da lista deste motorista (troca de motorista na mesma placa):** `POST .../motorista-veiculos/:id/inativar-vinculo` — `MOTORISTA_VEICULO.FGACTIVE = N`, `CDEQUIPAMENTO` limpo **nessa linha**; **não** desativa `EQUIPAMENTO`. A placa some do cadastro torre/app **daquele** `CDCADASTRO`; outro motorista pode cadastrar a mesma placa e, na aprovação, o backend reutiliza o mesmo `IDEQUIPAMENTO` pela busca por placa. Botão na tabela “Veículos informados pelo app” (rótulo: *Remover deste motorista*).

---

## 5. APIs internas (SysScopel) — esboço

Todas com autenticação do motorista (`Bearer`) exceto cadastro inicial, se mantido público.

| Método | Rota (exemplo) | Uso |
|--------|----------------|-----|
| `GET` | `/api/motorista/perfil` | Dados atuais do motorista + status de aprovação (JWT; implementado). |
| `PUT` | `/api/motorista/perfil` | Atualização + `multipart` opcional (`documento`); implementado. |
| `GET` | `/api/motorista/veiculos` | Lista de veículos do motorista no tenant (**implementado**). |
| `POST` | `/api/motorista/veiculos` | Inclusão/atualização mesma placa + `multipart` opcional `crlv`; status **P** pendente (**implementado**). |
| `GET` | `/api/motorista/convocacoes/:idmotorista` | Lista convocações; inclui `PLACASESPERADAS` e estado de confirmação de placas (**Fase C**). |
| `POST` | `/api/motorista/confirmar-placas-convocacao/:id` | Body JSON `modo`: `CONFIRMA` ou `DIVERGE`; `texto` opcional na divergência (**Fase C**). |
| `POST` | `/api/motorista/aceitar-convocacao/:id` | Bloqueia aceite (**422**) se existir `PLACASESPERADAS` e `FGCONFIRMACAOPLACAS` ainda nulo (**Fase C**). |
| `GET` | `/api/convocacoes` (torre / sessão web) | Lista convocações do tenant com placas da viagem e estado de confirmação no app; query `divergenciaPlacas=1` = só divergências (**Fase C**). |

**Upload:** `multipart/form-data` com JSON stringificado de veículos + arquivos nomeados por índice (`crlv_0`, …) ou múltiplos campos acordados.

**Torre (operador):** `GET /api/cadastros-gerais/motorista-veiculos-pendentes`, `GET /api/cadastros-gerais/equipamentos-frota-combo`, `GET /api/cadastros-gerais/:id/motorista-veiculos`, `POST /api/cadastros-gerais/:id/motorista-veiculos/vincular-equipamento` (atrelamento **sem app**: insere `MOTORISTA_VEICULO` já **A** com `CDEQUIPAMENTO`), `POST .../motorista-veiculos/:idVeiculo/aprovar` (cria/vincula **EQUIPAMENTO** quando veio do app pendente), `POST .../rejeitar`, `POST .../inativar-vinculo`; painel pendentes na aba **Filtros** e bloco **Dados** (tabela + atrelar frota) no **Gerenciar Cadastro Geral**; contador no **dashboard**. Alerta em `ALERTS` não aplicado (tabela exige `IDVIAGEM` NOT NULL).

---

## 6. Convocação — confirmação de placas

- Ao convocar, enviar na mensagem / tela **o conjunto esperado** (texto a partir de `VIAGEMVEICULO` + cadastro de equipamento).
- Na resposta do motorista, registrar **confirmação explícita** (“confirmo placas X/Y”) ou **divergência** (“estou com outro conjunto”) + opcional envio de novas placas → nova pendência na torre se necessário.
- Objetivo: **menos contato errado** e menos viagem programada com frota incorreta.

**Implementado (Fase C):** `GET /api/motorista/convocacoes/:id` passa a devolver `PLACASESPERADAS` (agregação de `VIAGEMVEICULO.REFEQUIPAMENTO` por `IDVIAGEM`) e os campos `FGCONFIRMACAOPLACAS` (`C`/`D`), `TXTPLACASDIVERGENCIA`, `DHCONFIRMACAOPLACAS`. `POST /api/motorista/confirmar-placas-convocacao/:id` com body `{ "modo": "CONFIRMA" | "DIVERGE", "texto"?: "..." }` (convocação **PENDENTE**). `POST /api/motorista/aceitar-convocacao/:id` retorna **422** se houver placas esperadas e a confirmação ainda não foi registrada. UI: `motorista/pages/convocacoes.html`. DDL: `backend/scripts/adicionar_convocacao_confirmacao_placas_postgres.sql` (e colunas no `CREATE` em `script_db_postgres.sql` para bases novas).

**Paridade com o link público:** `GET /api/public/convocacao/:id` (`buscarConvocacaoPublica`) inclui os mesmos dados de placas quando o schema permite (fallback sem colunas extras se necessário). `POST /api/public/convocacao/:id/responder` no aceite exige `confirmacaoPlacasModo` (`CONFIRMA` | `DIVERGE`) e `confirmacaoPlacasTexto` na divergência quando há `PLACASESPERADAS` e `FGCONFIRMACAOPLACAS` ainda vazio — alinhado ao gate de `aceitarConvocacao`. UI: `backend/public/convocacao.html`.

**Torre (lista convocações):** `GET /api/convocacoes` em `viagemmestre.controller.js` inclui os mesmos campos de placas/confirmação; query opcional `divergenciaPlacas=1` filtra só `FGCONFIRMACAOPLACAS = 'D'`. Na aba **Convocações** de **Gerenciar Viagens** há checkbox «Somente divergência de placas», colunas na grade e destaque visual (borda laranja) nas linhas com divergência.

**KPI no dashboard:** `GET /api/relatorio-convocacoes/estatisticas` inclui `DIVERGENCIA_PLACAS` (contagem no tenant). O **dashboard** (módulo base e home Torre) mostra card de alerta e aviso quando o valor é maior que zero (atalho para **Gerenciar Viagens**). Sem colunas no banco, o endpoint devolve `DIVERGENCIA_PLACAS = 0` (fallback).

---

## 7. APIs externas (opcional, pós-MVP)

- **Expectativa:** consultas oficiais (ex.: **Serpro** / catálogo **gov.br Conecta**) costumam ter **contrato e custo por consulta** — não basear o MVP nisso como “grátis”.
- **MVP recomendado:** anexos + conferência humana na torre.
- **Fase seguinte:** integrar no **backend** um serviço “enriquecimento” com cache, rate limit e auditoria, após obtenção de credenciais e base legal.

---

## 8. Fases sugeridas

| Fase | Entrega |
|------|---------|
| **A** | Entrada no dashboard + página de perfil/edição; `GET`/`PUT` perfil; exibir status de aprovação. |
| **B** | CRUD veículos no app + tabela pendente + `GET`/`POST` veículos; torre lista e aprova; alerta tipo “motorista novo”. |
| **C** | Convocação com texto de placas + passo de confirmação no app (e persistência do resultado). |
| **D** | Integração com provedor oficial de consulta (se houver budget e contrato). |

### Estado da implementação (acompanhamento)

| Fase | Situação |
|------|----------|
| **A** | **Entregue (2026-05-09):** menu no dashboard “Perfil e veículos” → `perfil.html`; `GET`/`PUT` perfil (JWT); i18n `perfil.*`. |
| **B** | **Entregue (2026-05-09):** `GET`/`POST /api/motorista/veiculos`; colunas + script SQL; `perfil.html` (lista + novo veículo); torre: APIs em `cadastrogeral` + painel em **Gerenciar Cadastro Geral** + contador no `dashboard.js`. **Não nesta entrega:** criação automática de `EQUIPAMENTO` na aprovação (campo `CDEQUIPAMENTO` opcional no `POST` aprovar); alerta `ALERTS` sem viagem. |
| **C** | **Entregue (2026-05-09):** placas agregadas na listagem; confirmação/divergência persistida em `CONVOCACAO`; gate no aceite; `convocacoes.html` + i18n; script SQL de migração; **Gerenciar Viagens** (aba Convocações): colunas de placas/confirmação, filtro divergência, `GET /api/convocacoes?divergenciaPlacas=1`. **Página pública** `convocacao.html` + `responderConvocacao` / `buscarConvocacaoPublica` com o mesmo critério de placas no aceite. **Ainda:** fila offline em dois passos no app (exige online se houver placas). |
| **D** | Pendente (APIs oficiais). |

---

## 9. Checklist (Fase B — decisões aplicadas)

- [x] **Tabela:** `MOTORISTA_VEICULO` estendida (sem tabela nova): colunas `TENANT_ID`, `PLACA_NORMALIZADA`, `STATUSAPROVACAO`, `PAPEL_CONJUNTO`, `CDEQUIPAMENTO`, `MOTIVOREPROVACAO`, `DHAPROVACAO`. Script: `backend/scripts/adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql`.
- [x] **Placa:** `backend/utils/placa-util.js` — só A–Z/0–9, mín. 7 caracteres; índice único parcial ativo por `(TENANT_ID, CDCADASTRO, PLACA_NORMALIZADA)`.
- [x] **Upload CRLV:** até 5 MB; JPEG/PNG/WebP (`motorista-app.routes.js`).
- [x] **LGPD:** textos `veiculos.lgpdCrlv` / `perfil.lgpdDocumento` no app.

### Checklist (Fase C)

- [x] **Colunas `CONVOCACAO`:** `FGCONFIRMACAOPLACAS`, `TXTPLACASDIVERGENCIA`, `DHCONFIRMACAOPLACAS` — script `backend/scripts/adicionar_convocacao_confirmacao_placas_postgres.sql`.
- [x] **Listagem:** `PLACASESPERADAS` via `VIAGEMVEICULO` (`STRING_AGG` de `REFEQUIPAMENTO`).
- [x] **Aceite:** obriga confirmação prévia quando há placas esperadas e flag ainda nula.
- [x] **Torre:** `listarConvocacoes` / `buscarConvocacaoPorId` (`viagemmestre.controller.js`) + UI na aba Convocações de `gerenciar-viagens`.
- [x] **Link público:** `buscarConvocacaoPublica` + `responderConvocacao` + `convocacao.html` (confirmação de placas antes do aceite).

---

## 10. Referências no repositório

- Cadastro app + pendência motorista: `backend/controllers/motorista-app.controller.js` (ação `cadastro`, comentários “Pendente de aprovação”).
- Veículos app + lista/aprovação torre: `listarVeiculosMotorista`, `criarVeiculoMotorista`; `cadastrogeral.controller.js` (`listarMotoristaVeiculosPendentes`, `aprovarMotoristaVeiculo`, `rejeitarMotoristaVeiculo`, contadores).
- DDL PostgreSQL: `backend/scripts/adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql`.
- Placa: `backend/utils/placa-util.js`.
- Viagem ↔ veículos (placas na operação): `VIAGEMVEICULO` + `buscarVeiculoViagem` em `backend/controllers/viagemmestre.controller.js`.
- Convocação + placas: `minhasConvocacoes`, `confirmarPlacasConvocacao`, `aceitarConvocacao` em `motorista-app.controller.js`; rota `confirmar-placas-convocacao`; `motorista/pages/convocacoes.html`; link público: `buscarConvocacaoPublica`, `responderConvocacao` em `viagemmestre.controller.js`; `public/convocacao.html`; DDL `backend/scripts/adicionar_convocacao_confirmacao_placas_postgres.sql`.
- Torre — lista e detalhe: `listarConvocacoes`, `buscarConvocacaoPorId` em `viagemmestre.controller.js`; `GET /api/convocacoes` com `divergenciaPlacas=1`; grade em `public/modulos/gerenciar-viagens/js/script.js` + filtros em `index.html`.

---

*Última atualização: 2026-05-09 — Fases A–C refletidas no código; executar scripts SQL nos ambientes existentes.*
