# Atlas Pay P1 — Permissões financeiras

**Data:** 26/11/2026 (aplicação e validação operacional local)  
**Status:** **Ativo no ambiente local** (`atlas_cargo_prd` como homologação operacional).  
**P0.2:** não alterado e não reaplicado.

## Arquitetura

| Camada | Uso |
| --- | --- |
| Auth torre | `towerAuthAndTenant` (JWT + tenant da sessão) |
| Menu | `DSPROGRAMA = atlas-pay` |
| Autorização fina | `FIN_PERM_*` / `FIN_PERFIL_*` / `FIN_USUARIO_*` / `FIN_PERM_AUDIT` |
| Tenant | `tenantIdForRequest` — `empresa_id` do body rejeitado/ignorado |

### Modos

1. **LEGADO_SEM_TABELA** — SQL P1 ainda não aplicado.  
2. **LEGADO_TRANSICAO** — tabelas existem, tenant **sem** atribuições em `FIN_USUARIO_*`: quem tem `atlas-pay` recebe todas as FIN_*.  
3. **STRICT** — após a **primeira** atribuição válida no tenant (bootstrap `FINANCEIRO_ADMIN`): só perfil + overrides.

## Aplicação operacional (26/11/2026)

| Item | Valor |
| --- | --- |
| Projeto efetivo | `C:\atlas-cargo` |
| Servidor / DB | `localhost:5432` / `atlas_cargo_prd` / user `postgres` / PostgreSQL 18.4 |
| SHA-256 do SQL | `E120E07FB24BDD08108F1AAA5BD700DD9C11913A0A93DA9D65F26249BD87D4B0` |
| Backup pré-apply | `backups/atlas_cargo_prd_pre_p1_permissoes_20261126_160511.dump` (~1,1 MB, `-Fc`) |
| Apply | `COMMIT` OK (tabelas, CHECK com `BOOTSTRAP_ADMIN`, catálogo 13, perfis 4, associações CONSULTA 4 / OPERADOR 6 / GESTOR 12 / ADMIN 13) |
| Bootstrap | `POST /api/financeiro/permissoes/bootstrap-admin` → `admin` @ `default` → `FINANCEIRO_ADMIN` + audit `BOOTSTRAP_ADMIN` + modo **STRICT** |
| Node | Processo em `:8083` reiniciado para carregar rotas P1 |

## Bootstrap FINANCEIRO_ADMIN

Endpoint: `POST /api/financeiro/permissoes/bootstrap-admin`  
Body: `{ "login": "<alvo>", "confirmacao": "BOOTSTRAP_ADMIN" }`

No local: alvo/ator identificados no banco = único usuário ativo do tenant `default` com `atlas-pay` (`admin`). Sem criação de usuário.

## EFEITO

Coluna/API: **`EFEITO`** (`C`\|`R`). Migração segura `EFETO`→`EFEITO` no script (não necessária nesta base — coluna já `EFEITO`).

## Rotas sensíveis

| Rota | Permissão |
| --- | --- |
| GET resumo/contratos/cobranças | consulta |
| POST `/contratos` | `FIN_CONTRATO_VERSIONAR` ou `CRIAR` |
| POST `/cobrancas/:id/baixa` | `FIN_COBRANCA_BAIXAR` |
| POST `/cobrancas/:id/cancelar` | `FIN_COBRANCA_CANCELAR` |
| Admin permissões | `FIN_GERENCIAR_PERMISSOES` (exceto bootstrap) |

## Testes executados (resultado real)

### Unitários

```powershell
cd C:\atlas-cargo\backend
node scripts/test_atlas_pay_p1_permissoes.js
```

**PASS=23 FAIL=0**

### Integrados (API + banco, pós-apply e pós-bootstrap)

Evidência: `backups/p1_integrado_resultados_20261126.txt`

| Caso | Resultado |
| --- | --- |
| Login admin / tenant default | PASS |
| STRICT após bootstrap | PASS |
| `/me/permissoes` com `FIN_GERENCIAR_PERMISSOES` | PASS |
| Catálogo 13 / perfis / usuários | PASS |
| Auditoria `BOOTSTRAP_ADMIN` | PASS |
| Conceder/revogar `FINANCEIRO_CONSULTA` | PASS |
| Override `EFEITO=R` / remoção | PASS |
| Cancelar sem `FIN_COBRANCA_CANCELAR` → `FIN_SEM_PERMISSAO` | PASS |
| Cancelar com permissão (cobranças só `CANCELADA`) → **409 STATUS** | PASS (gate ok; sem cobranca ABERTA/PAGA no tenant) |
| Isolamento sessão (`empresa_id` ignorado; sem `cscopel`) | PASS |
| Alvo outro tenant bloqueado | PASS |
| Anti-elevação gestor↛ADMIN (`canGrantProfile`) | PASS |
| Bootstrap repetido bloqueado | PASS |
| Sem token → 401/403 | PASS |
| Endpoints da aba Permissões | PASS |
| DB: outros tenants sem `FIN_USUARIO_*` | PASS |

Auditoria observada após os testes: `BOOTSTRAP_ADMIN`, `PERFIL_CONCEDER`, `PERFIL_REVOGAR`, `PERM_REVOGAR`, `NEGADO`.

## Pendências reais

1. P0.2 (constraints) permanece separado — **não** aplicado.  
2. Não há cobrança `ABERTA`/`PAGA` no `default` para exercitar cancelamento até status `CANCELADA` (só o gate 403→409).  
3. Tenant `default` tem um único usuário torre (`admin`); anti-elevação HTTP com ator só-GESTOR não foi possível sem criar usuário (validado via `canGrantProfile` + bloqueio de alvo de outro tenant).  
4. `C:\Dev\atlas-cargo` existe como atalho/pasta distinta; o canônico aplicado foi `C:\atlas-cargo`.
