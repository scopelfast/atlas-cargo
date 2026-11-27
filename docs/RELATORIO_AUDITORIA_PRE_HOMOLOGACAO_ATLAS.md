# Relatório de auditoria pré-homologação — Atlas Cargo / Atlas Pay

**Data:** 26/11/2026  
**Escopo:** inspeção e plano. **Nenhuma correção de código ou banco foi executada nesta etapa.**  
**Regra:** aguardar autorização expressa antes de implementar.

Referências cruzadas: `docs/ATLAS_PAY.md`, `docs/PLANO_MODULO_FINANCEIRO.md`, `docs/RELATORIO_AUDITORIA_FINANCEIRO.md`, `docs/EVOLUCAO_ATLAS_CARGO.md`, `README.md`, `INSTALACAO_OUTRO_SERVIDOR.md`, `backups/README_RESTORE.md`, `script_db_postgres.sql`, `backend/scripts/financeiro_atlas_pay_postgres.sql`.

---

## 1. Resumo executivo

As fases 1 e 2 do Atlas Pay estão **implementadas no código** com o encaixe correto no ponto de negócio: cobrança na **confirmação** da torre (não no aceite), cancelamento em reativação e desistência de lote, baixa manual, regra padrão `N`, e tela 7.1 do estoque **sem acoplamento** encontrado.

A homologação **não está pronta** enquanto persistirem quatro lacunas estruturais:

1. **DDL inconsistente** entre `script_db_postgres.sql` (tabelas “nuas”) e `financeiro_atlas_pay_postgres.sql` (constraints dentro de `CREATE TABLE IF NOT EXISTS`, que **não atualizam** tabela já criada).
2. **Permissão única** `atlas-pay` concedida automaticamente a quem tem `gerenciar-tenants-saas`, misturando admin SaaS com operação financeira.
3. **Suite de testes incompleta** (5 SKIP) e uso do tenant `default` como laboratório destrutivo de contrato/cobrança.
4. **Dumps `atlas_cargo_prd_*.dump` versionados no Git**, com alto risco de conter dados operacionais/pessoais reais.

O fluxo transacional da confirmação + cobrança na mesma conexão (`createTransaction` + `queryPg`) está coerente com o plano. A idempotência de cobrança **aberta** por convocação está coberta por índice parcial; a proteção append-only de valor/eventos **não** está no banco.

**Veredito:** apto a **corrigir sob autorização**; **não** apto a homologar “como está” sem fechar os itens críticos/altos abaixo.

---

## 2. Problemas críticos

| ID | Problema | Evidência | Risco operacional | Impacto em banco | Solução recomendada |
| --- | --- | --- | --- | --- | --- |
| C1 | `script_db_postgres.sql` cria `FIN_*` **sem** CHECK, FK de tenant, índices únicos parciais | Linhas ~1336–1406: só colunas + PK; FKs mínimas em componente/evento | Banco novo nasce “frouxo”; app confia em regras que o DDL não garante | Alto em instalação greenfield | Espelhar no `script_db` o DDL completo do script financeiro **ou** extrair constraints para bloco `ALTER` idempotente e chamar nos dois caminhos |
| C2 | `CREATE TABLE IF NOT EXISTS` **não aplica** constraints a tabelas já existentes | `financeiro_atlas_pay_postgres.sql` declara CK/FK **dentro** do `CREATE TABLE` | Instalação que criou tabelas via `script_db` e depois rodou o script financeiro pode ter **só** os `CREATE INDEX IF NOT EXISTS`, sem CHECKs/FKs da tabela | Alto em bancos já atualizados | Migração incremental: `DO $$ … IF NOT EXISTS (pg_constraint) THEN ALTER TABLE ADD CONSTRAINT` |
| C3 | Dumps de `atlas_cargo_prd` **commitados** no Git (`20261106`, `20261125`, `20261126`) | `git ls-files backups/*.dump`; docs mandam versionar o dump | Vazamento de PII/operacional se o remoto for compartilhado; LGPD; histórico Git difícil de limpar | Não altera schema; risco de segurança/compliance | Procedimento: dump **sanitizado** para bootstrap; dumps reais fora do Git (ou LFS privado); rotacionar histórico se já houve push público — **só após autorização** |

Não se imprimiu conteúdo sensível dos dumps nesta auditoria.

---

## 3. Problemas altos

| ID | Problema | Evidência | Risco | Solução recomendada |
| --- | --- | --- | --- | --- |
| A1 | Uma permissão `atlas-pay` cobre consultar, publicar contrato e baixar | `financeiro-auth.middleware.js`; SQL libera a `admin` e a quem tem `gerenciar-tenants-saas` | Admin de tenants SaaS ganha acesso financeiro completo do **próprio** tenant JWT — e no `default`/dono, escopo amplo | Separar (plano): `atlas-pay` (consulta), `atlas-pay-contrato`, `atlas-pay-baixa`; **não** herdar de `gerenciar-tenants-saas` |
| A2 | Sem imutabilidade de `VALOR_CENTAVOS` nem append-only de eventos no banco | App não atualiza valor; DB permite `UPDATE`/`DELETE` em evento | Fraude/erro humano via SQL ou bug futuro | Trigger `BEFORE UPDATE` em valor; `REVOKE`/`trigger` bloqueando UPDATE/DELETE em `FIN_COBRANCA_EVENTO` — **após** checar que nenhum código legítimo altera evento |
| A3 | Índices únicos só para `STATUS = 'ABERTA'` | `UK_FIN_COB_CONV_ABERTA`, `UK_FIN_COB_CICLO_ATIVA` | Em teoria `PAGA` + nova `ABERTA` na mesma convocação se o cancelamento for contornado; ciclo reutilizado poderia gerar histórico ambíguo | Unique absoluto `(IDCONVOCACAO, ID_CICLO_CONFIRMACAO)` onde `MODALIDADE='CONEXAO'`; manter parcial de aberta; garantir cancelamento antes de reconfirmar (já no fluxo) |
| A4 | Testes usam tenant `default`, publicam regra `S`, geram/cancelam cobranças reais | `test_atlas_pay_fases_1_2.js` | Contamina contrato do default; viola regra de homologação “não ativar cobranças no default” | Tenant de homologação dedicado (`homolog-fin` ou similar), sem tocar regra de tenants reais; limpar só dados desse tenant |
| A5 | Cinco testes SKIP sem implementação | Final do script de teste | Homologação sem prova de concorrência, lote E2E, 7.1, 403, aceite | Implementar ou substituir por asserts estáticos/HTTP controlados (ver §10 e §14) |
| A6 | `INSTALACAO_OUTRO_SERVIDOR.md` na trilha “banco já existe” **omite** `financeiro_atlas_pay_postgres.sql` (e outros scripts listados no README/restore) | §3 ~linha 75 vs `README.md` / `backups/README_RESTORE.md` | Servidor espelho sobe sem FIN_*/menu | Alinhar lista de scripts (só doc, após aprovação) |

---

## 4. Problemas médios

| ID | Problema | Evidência | Solução recomendada |
| --- | --- | --- | --- |
| M1 | Sem FK de `FIN_COBRANCA` → `CONVOCACAO` / `VIAGEMMESTRE` | DDL financeiro | Avaliar FK composta `(IDCONVOCACAO, TENANT_ID)` se o modelo de convocação permitir; senão manter validação só na aplicação |
| M2 | Auditoria multi-tenant **completa** de todos os módulos (chat, SOS, estoque, rastreamento…) não foi exaurida nesta passagem | Escopo Atlas Pay verificado; torre usa `tenantIdForRequest` + filtros em confirmação | Amostra dirigida pós-homologação Pay; não bloquear Pay se isolamento financeiro estiver ok |
| M3 | `ID_CICLO_CONFIRMACAO` = `{id}:C:{Date.now()}` | `viagemmestre.controller.js` ~3040 | Preferir UUID/`nextval` se exigir prova forense mais forte; hoje a unicidade de aberta por convocação mitiga |
| M4 | Eventos carregados por `ID_COBRANCA` sem join de tenant | `obterCobranca` já filtra cobranca por tenant antes | Manter; opcional join defensivo |
| M5 | Documentação vs código: ATLAS_PAY ok; EVOLUCAO ok; INSTALACAO atrasada; testes prometem 15 OK / 5 SKIP sem plano de fechamento no ATLAS_PAY | Comparação textual | Atualizar docs **depois** das correções |

---

## 5. Problemas baixos

| ID | Problema | Notas |
| --- | --- | --- |
| B1 | `handleErr` em rotas financeiras pode ecoar `details: err.message` em 500 | Preferir log interno + mensagem genérica |
| B2 | Componente `POR_CARGA_ANUNCIADA` existe no contrato sem geração de cobrança | Conforme fases 1–2; documentar como “reservado” |
| B3 | Cache-bust `?v=` no JS do módulo | Cosmético |

---

## 6. Análise do banco

### 6.1 Tabelas

| Tabela | Em `script_db_postgres.sql` | Em `financeiro_atlas_pay_postgres.sql` |
| --- | --- | --- |
| `FIN_CONTRATO` | Sim, DDL incompleto | Sim, completo **se** a tabela for criada por este script |
| `FIN_CONTRATO_COMPONENTE` | Sim, incompleto | Sim |
| `FIN_COBRANCA` | Sim, incompleto | Sim |
| `FIN_COBRANCA_EVENTO` | Sim, incompleto | Sim |

`CREATE TABLE IF NOT EXISTS` no script financeiro: **sim**.  
Suficiente para **criar** tabelas ausentes; **insuficiente** para enriquecer tabelas já criadas pelo `script_db`.

### 6.2 Integridade desejada vs presente no script financeiro (quando a CREATE efetiva roda)

Presente no script (criação nova): PK, CK modalidade/status/pagador/moeda/valor≥0, CK componentes, FK contrato→`SAAS_CLIENTE_CONTRATANTE`, FK componente→contrato CASCADE, FK evento→cobrança RESTRICT, unique `(TENANT_ID, VERSAO)`, unique vigente parcial, unique aberta por convocação, unique aberta por ciclo+convocação, índices de consulta.

Ausente / frágil:

- Proteção contra `UPDATE` de `VALOR_CENTAVOS` após insert.
- Append-only de eventos (trigger/REVOKE).
- Unique absoluto por ciclo (todos os status).
- FK cobrança→viagem/convocação.
- Bloco `ALTER` idempotente para bancos que já têm as tabelas nuas.

### 6.3 Idempotência das cobranças

| Regra comercial | Situação atual |
| --- | --- |
| Uma cobrança aberta por confirmação/convocação | Coberto por `UK_FIN_COB_CONV_ABERTA` |
| Uma por viagem-filha confirmada | Indireto: cada confirmação de lote gera filha + usa a convocação daquela confirmação; índice por convocação |
| Concorrência | `FOR UPDATE` na viagem/convocação + unique parcial; falha 23505 → `COBRANCA_DUPLICADA` |
| Reconfirmação = novo ciclo | `idCiclo` novo; cancelamento prévio na reativação |
| Mesmo ciclo sem duplicar | Unique parcial só enquanto `ABERTA`; falta unique absoluto do ciclo |

**Conclusão:** idempotência de **aberta** comprovável pelo DDL do script financeiro + código; **não** comprovada para instalação que só rodou `script_db` sem índices; reforço de ciclo absoluto recomendado.

---

## 7. Análise de multi-tenant

### 7.1 Atlas Pay (evidência direta)

| Verificação | Resultado |
| --- | --- |
| Tenant da sessão | `towerAuthAndTenant` → JWT → `attachTenantContext` → `tenantIdForRequest` |
| Cliente escolhe tenant na query | Não: rotas usam só `tenantIdForRequest(req)` |
| Lista/detalhe/baixa filtrados por `TENANT_ID` | Sim (`listarCobrancas`, `obterCobranca`, `baixarCobrancaManual`) |
| Beneficiário = tenant da oferta | Insert: `BENEFICIARIO_TENANT_ID = TENANT_ID` da confirmação |
| Isolamento obter outro tenant | Teste unitário no script: `obterCobranca('tenant-inexistente-xyz', id)` → null |
| Bolsão | Nome do pagador resolve cadastro do tenant e depois `default`; valor financeiro permanece no tenant da oferta |

### 7.2 Torre (confirmação / cancelamento)

Confirmação, reativação e desistência de lote passam `tenantIdForRequest` e filtram `CONVOCACAO`/`VIAGEMMESTRE` por `TENANT_ID`. Cobrança criada/cancelada com o mesmo tenant.

### 7.3 Demais módulos (viagens, chat, SOS, estoque, etc.)

Não houve varredura linha a linha de **todos** os endpoints nesta etapa. Padrão dominante: `tenantIdForRequest`. **Risco residual** classificado como MÉDIO (M2): fora do núcleo Pay, exigir amostragem separada antes de declarar “SaaS isolado end-to-end”.

### 7.4 Tenant `default`

Comportamento especial do bolsão preservado no lookup de nome. Testes atuais **ativam temporariamente** regra `S` no default — inadequado para homologação (A4). Regra de produto: não bloquear `default` (fase 4 futura); fases 1–2 não implementam bloqueio.

---

## 8. Análise de permissões

| Peça | Situação |
| --- | --- |
| `TIPOATIVIDADE` / `DSPROGRAMA = atlas-pay` | Inserido pelo script financeiro (menu 9.7) |
| `USUARIOATIVIDADE` | Auto-liberado a `admin` e a quem já tem `gerenciar-tenants-saas` |
| Middleware | `requireAtlasPay` via `usuarioTemPrograma` |
| Rotas | Todas as `/api/financeiro/*` exigem a mesma atividade |
| Planos SaaS / `MODULO_PRODUTO` | Menu amarra a módulo `geral`; **não** há módulo SaaS cobrável separado “Atlas Pay” |

**Problema:** administração SaaS ≠ autorização financeira. Baixa e publicação de contrato não têm confirmação de papel distinto (só `confirmacao: "BAIXAR"` no body).

**Proposta (plano, sem criar agora):**

| Papel | Programa sugerido | Pode |
| --- | --- | --- |
| Operação financeira da agência | `atlas-pay` | Ver resumo/cobranças do **próprio** tenant |
| Configuração de contrato | `atlas-pay-contrato` | Publicar versão |
| Baixa | `atlas-pay-baixa` | Baixa manual |
| Plataforma (dono) | atividade distinta + tenant `default` apenas | Visão cross-tenant **só se** produto exigir — hoje **não** existe API cross-tenant |

Revogar herança automática a partir de `gerenciar-tenants-saas`.

---

## 9. Análise transacional

| Fluxo | Achado |
| --- | --- |
| Aceite motorista | Sem referência a `financeiro` em `motorista-app.controller.js` nem rotas públicas — **não gera cobrança** (evidência) |
| Confirmação torre | Dentro de `BEGIN`; `FOR UPDATE` viagem+convocação; `UPDATE` → `CONFIRMADA`; depois `criarCobrancaConexaoNaConfirmacao` via `queryPg`; erro financeiro com `statusCode` aborta → rollback | 
| VLFRETE | Lido da viagem confirmada (filha no lote após derivação) |
| Centavos / contrato / memória | Gravados no insert |
| Pagador / beneficiário | Motorista / tenant da oferta |
| Reativação | Cancela cobranças `ABERTA`/`PAGA` da convocação na mesma TX; reversão de baixa + evento |
| Desistência lote | `devolverVaga` + cancelamento financeiro na mesma TX |
| Baixa manual | TX própria com `FOR UPDATE` por id+tenant |
| Regra desligada | `gerou: false` — confirmação segue |
| Falha na cobrança | Throw → rollback da confirmação |

**Aprovado com evidência de código** para o desenho transacional das fases 1–2. **Não** aprovado o fechamento dos testes SKIP de concorrência HTTP e lote E2E.

### 9.1 Lotes

- Confirmação com lote ativo: cria filha, troca `IDVIAGEM` da cobrança para a filha, usa `VLFRETE` da filha.
- Cancelamento por `IDCONVOCACAO` — não cancela irmãs.
- Desistência de uma vaga não varre outras filhas.
- E2E automatizado: **SKIP** — falta prova runtime.

---

## 10. Análise dos testes

Script: `backend/scripts/test_atlas_pay_fases_1_2.js`.

| Situação | Contagem / nota |
| --- | --- |
| Cobertos (serviço/DDL/cálculo/contrato/baixa/isolamento obter) | ~15 OK no último relato |
| SKIP | 5 (aceite HTTP, concorrência HTTP, lote E2E, 7.1, permissão 403) |
| Ambiente | Usa `default` + ativa `S` temporariamente — **inadequado** para homologação |

Tratamento definido para os SKIP (a implementar **após** autorização):

| SKIP atual | Tratamento |
| --- | --- |
| Aceite sem confirmação | Assert estático: grep/AST ou teste que chama serviço de aceite e conta `FIN_COBRANCA` inalterada; opcional HTTP em tenant homolog |
| Duas confirmações concorrentes | Duas promises HTTP no tenant homolog na mesma viagem comum; esperar 1 sucesso + 1 falha `JA_CONFIRMADA`/`COBRANCA_DUPLICADA` |
| Lote E2E | Fixture mínima de oferta lote + 2 confirmações + 1 `desistirLote`; assert 2 cobranças e 1 cancelada |
| Estoque 7.1 | Teste de regressão: hash/smoke das rotas `estoque-cobranca` + assert ausência de import `financeiro` nos controllers WMS |
| Permissão 403 | Usuário sem `atlas-pay` → GET/POST `/api/financeiro/*` = 403 |

Novos casos obrigatórios (tenant homolog, dados fictícios): regra off; confirmação; duplicada; reconfirmação; cancel antes/depois baixa; reversão; isolamento; acesso cruzado; contrato novo não altera cobrança antiga; precisão centavos; frete inválido; falha insert + rollback.

---

## 11. Análise dos backups

| Item | Achado |
| --- | --- |
| Arquivos | `atlas_cargo_prd_20261106.dump` (~29 MB), `20261125` (~1.1 MB), `20261126` (~1.1 MB) **no Git** |
| `.gitignore` | Ignora `uploads/`, `*.backup`; **não** ignora `*.dump` |
| Uploads | Documentados como cópia à parte — correto |
| Restore | README/restore e README raiz alinhados ao dump 20261126; INSTALACAO incompleta na lista de scripts de banco existente |
| Conteúdo | Não inspecionado (evitar exposição). Nome `atlas_cargo_prd` + tamanho do dump antigo indicam **alto risco** de dados reais |
| Procedimento seguro proposto | 1) Gerar dump sanitizado (sem CPF/celular/CNH paths). 2) Remover dumps reais do tracking. 3) Se já houve push público: `git filter-repo` / suporte do host + rotacionar segredos se houver no dump. 4) Guardar dump real só em storage privado. **Não executar agora.** |

---

## 12. Lista de arquivos que precisam ser alterados

**Somente após autorização.** Ordem sugerida de toque:

### Código
- `backend/scripts/financeiro_atlas_pay_postgres.sql` (ou novo `financeiro_atlas_pay_constraints_postgres.sql`)
- `script_db_postgres.sql` (espelho completo)
- `backend/middleware/financeiro-auth.middleware.js` (se houver split de permissões)
- `backend/routes/financeiro.routes.js` (middleware por rota)
- `backend/scripts/test_atlas_pay_fases_1_2.js` (+ possivelmente novo `test_atlas_pay_http_homolog.js`)
- Opcional: triggers em SQL; **não** alterar `viagemmestre.controller.js` salvo bug comprovado

### Documentação
- `docs/ATLAS_PAY.md`
- `docs/EVOLUCAO_ATLAS_CARGO.md` (**só depois** de correção testada)
- `README.md`
- `INSTALACAO_OUTRO_SERVIDOR.md`
- `backups/README_RESTORE.md`
- `.gitignore` (política de dumps)

### Não tocar nesta etapa (mesmo após aprovação parcial)
- WMS 7.1 / `estoque-cobranca`
- Fluxo de aceite (exceto assert de regressão)
- `.env` / credenciais
- Pix / bloqueio / gateways
- Limpeza de tenants reais / restore sobre banco existente

---

## 13. Plano de correção (prioridade)

### P0 — Banco (migração incremental, não produção até aprovação)
1. Script idempotente `ALTER TABLE … ADD CONSTRAINT` / índices faltantes para as quatro `FIN_*`.
2. Alinhar `script_db_postgres.sql` ao DDL completo.
3. (Opcional P0.b) Unique absoluto por ciclo; triggers de imutabilidade — **apresentar SQL antes de rodar**.

### P1 — Permissões
1. Plano de três programas (consulta / contrato / baixa).
2. Remover herança automática de `gerenciar-tenants-saas`.
3. Migrar `USUARIOATIVIDADE` só para quem deve ter cada papel (script idempotente, sem apagar usuários).

### P2 — Testes
1. Tenant de homologação fictício.
2. Implementar os 5 SKIP + lista ampliada do §10.
3. Proibir ativar regra em `default` nos testes.

### P3 — Segurança operacional de backup
1. Política de dump sanitizado.
2. Ajuste `.gitignore` / docs.
3. Remoção segura de dumps reais — **somente com autorização explícita**.

### P4 — Documentação
1. Alinhar INSTALACAO ↔ README ↔ restore.
2. Registrar em EVOLUCAO somente o que foi corrigido e testado.

---

## 14. Testes que serão executados (após autorização)

1. Constraints presentes (`pg_constraint` / `pg_indexes`) em banco de homologação.  
2. Regra off → confirmação sem `FIN_COBRANCA`.  
3. Regra on (tenant homolog) → uma cobrança, centavos corretos, memória, versão.  
4. Duplicidade / concorrência HTTP.  
5. Reconfirmação → novo ciclo + cobrança nova; antiga cancelada.  
6. Cancel antes e depois da baixa (+ reversão).  
7. Isolamento tenant + 403 sem permissão.  
8. Lote: N filhas → N cobranças; desistência cancela só a da convocação.  
9. Aceite sem cobrança.  
10. Rollback se insert financeiro falhar.  
11. Contrato novo não altera cobranças antigas.  
12. Smoke 7.1 estoque-cobranca sem alteração de comportamento.  
13. Frete inválido com percentual → confirmação rejeitada e sem cobrança órfã.

---

## 15. Riscos que ainda permanecerão

- Isolamento multi-tenant **global** de todos os módulos não estará 100% certificado só com o fechamento do Atlas Pay.
- Sem gateway, baixa continua manual (risco operacional humano).
- Histórico Git de dumps reais, se já publicado, pode exigir limpeza de histórico além de um commit novo.
- Triggers append-only podem conflitar com ferramentas de manutenção DBA — precisam de bypass documentado.
- Fase 3–5 (uso plataforma, bloqueio, Pix) fora do escopo — dívida de produto consciente.
- `Date.now()` no ciclo não é criptograficamente único; mitigado pelos uniques de aberta.

---

## 16. Informativos / aprovados com evidência parcial

| Item | Status |
| --- | --- |
| Aceite ≠ cobrança | Aprovado (sem hook financeiro nos aceites) |
| Confirmação gera cobrança se regra S | Aprovado em código + testes de serviço |
| WMS 7.1 acoplado ao Pay | **Não encontrado**; falta teste de regressão automatizado |
| Transação confirmação↔cobrança | Aprovado em código |
| UI no padrão dos módulos | Presente (fora do núcleo desta auditoria de risco) |
| Pix/bloqueio/produção `.env` | Não introduzidos (conforme regra) |

---

## 17. Critérios de aceite da auditoria (checklist)

| Critério | Estado nesta inspeção |
| --- | --- |
| Quatro tabelas com esquema consistente em novas e existentes | **Não** — gap C1/C2 documentado |
| Constraints/índices necessários identificados | **Sim** |
| Idempotência por ciclo comprovada | **Parcial** — aberta ok; absoluto recomendado |
| Isolamento multi-tenant auditado | **Pay sim**; plataforma ampla residual |
| Permissões financeiras auditadas | **Sim** — problema A1 |
| Transações verificadas | **Sim** (código) |
| Lotes cobertos | **Código sim**; E2E SKIP |
| Cinco SKIP com tratamento definido | **Sim** (§10) |
| WMS 7.1 protegido por regressão | **Não** — só evidência negativa de acoplamento |
| Riscos de backup documentados | **Sim** |
| Docs comparadas ao código | **Sim** |

---

## 18. Próximo passo

**PARAR.** Nenhuma correção será implementada até autorização expressa do solicitante, indicando quais itens (P0–P4) podem entrar na execução e se a migração de constraints pode rodar no banco local `atlas_cargo_prd` de desenvolvimento (nunca restore por cima; nunca ativar regra em tenant real).
