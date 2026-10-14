# WMS — Onde estão relatórios e dashboard (sem caça ao tesouro)

Este guia responde **onde clicar** no Atlas Cargo web. Se “não aparece nada”, quase sempre é **permissão de menu** (usuário sem nenhum dos programas do hub Estoque) ou você **não voltou à tela inicial** do dashboard.

---

## 1. Dashboard (hub Estoque / WMS)

**Onde:** tela **inicial** do painel após login — a mesma que mostra boas-vindas e cards.

**Módulo Estoque no seletor “Módulo de produto”:** a área central vira o **painel WMS** (KPIs + acesso rápido + dica do CSV de vencimento), implementado em `backend/public/js/dashboard.js` (`showWelcomeScreen` + `fetchWmsDashboardResumo`). Ao mudar o seletor, a home **atualiza** (não fica presa na visão “Módulo Base”).

**Módulo Torre (`divulga_cargas_torre` no catálogo; legado `divulga` é fundido no combo — nome exibido “Torre Logística”):** a área central vira uma **home de operação** (mesmos KPIs de viagens/convocações do módulo Base + atalhos para viagem, mapa, relatório, chat, alertas, SOS, ranking), em `dashboard.js` (`showWelcomeScreen` + hub `divulga_cargas_torre` em `DASHBOARD_MODULE_HUB_DEFS`).

**Módulo Base (ou “todos”):** mantém os cards de **viagens / convocações** e o bloco opcional abaixo:

**O que aparece (Base + hub):** um bloco **“Área Estoque / WMS”** (título i18n `web.dashboard.hubEstoqueTitulo`) com botões que abrem os módulos:

| Botão (atalho) | Programa de permissão |
|----------------|------------------------|
| Estoque (hub) | `estoque` |
| Recebimento | `estoque-recebimento` |
| Separação | `estoque-separacao` |
| Cargas / embarque | `estoque-cargas` |
| Expedição | `estoque-expedicao` |
| Cadastros WMS | `estoque-cadastros-wms` |

**Implementação:** `backend/public/js/dashboard.js` — constante `DASHBOARD_MODULE_HUB_DEFS`, função `collectDashboardHubLinks`, bloco `estoqueHubBlock` dentro de `showWelcomeScreen`.

**Se o bloco inteiro some:** o usuário **não tem permissão** a **nenhum** dos programas acima. Ajuste em **Gerenciar Usuários** / perfil / vínculo com **Tipo de atividade** que inclua ao menos um desses programas (o mesmo cadastro que coloca o item no menu lateral).

**Como voltar à tela inicial:** use o fluxo do dashboard que leva à home (ex.: item “Dashboard” / logo / navegação que chama `showWelcomeScreen` — depende do tema AdminLTE do projeto).

---

## 2. Relatórios WMS já entregues no MVP

### 2.1 Relatório de **vencimento** (operacional / cliente)

**UI (principal):** módulo **Estoque → Recebimento** (`/modulos/estoque-recebimento/`), aba **Filtros**.

- Botão **“Relatório vencimento (CSV)”** — gera download `wms-relatorio-vencimento-recebimento.csv` (UTF-8 BOM).  
- Bloco **“Relatório vencimento — envios automáticos (job)”** — tabela de histórico (`Atualizar`).

**Arquivos:** `backend/public/modulos/estoque-recebimento/index.html` (por volta das linhas com `btnRelatorioVencimentoCsv`, `wmsRecBoxHistoricoEnvioVenc`) e `backend/public/modulos/estoque-recebimento/js/script.js` (fetch para `relatorio-vencimento` e `relatorio-vencimento-envios`).

**API (para integração ou Postman):**

- `GET /api/wms/recebimento/relatorio-vencimento` — JSON  
- `GET /api/wms/recebimento/relatorio-vencimento?formato=csv` — CSV  
- `GET /api/wms/recebimento/relatorio-vencimento-envios?limit=50` — histórico de envios do job  

**Parâmetros úteis:** filtro por dono na UI usa o dono selecionado no formulário de filtros (ver código do botão CSV).

### 2.2 Romaneios / relatórios HTML (carga e separação)

- Carga: rotas em `backend/routes/wms-carga.routes.js` — por exemplo `GET .../cargas/programadas/:cdCarga/romaneio`, `.../relatorios/frios`.  
- OPL: `GET .../separacao/opl/importacoes/:cdOplArquivo/romaneio` em `wms-separacao.routes.js`.

São **relatórios de operação** (HTML), não o mesmo pacote “executivo” de BI.

---

## 3. O que **ainda não** é um “centro de relatórios” nem “dashboard inteligente”

- **Curva ABC, valor de estoque, KPIs compostos, gráficos dinâmicos:** não estão neste MVP; estão descritos como Fase 2+ em `docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md` e na matriz §5 de `docs/WMS_PLANO_TESTES_E2E_QA.md`.

- O dashboard atual do Estoque é um **hub de atalhos** + textos i18n, não um painel analítico completo.

---

## 4. Checklist rápido “eu não vejo nada”

1. Usuário tem permissão a **`estoque-recebimento`**? → entra no módulo e abre **Filtros**.  
2. Usuário tem ao menos um dos **`estoque*`** listados na §1? → volta à **home** do dashboard e procura o bloco Estoque/WMS.  
3. Job de e-mail: SMTP e `WMS_VENCIMENTO_JOB_*` no `.env` (ver `backend/.env.example`).

---

*Última atualização: guia criado para alinhar expectativa “cadê?” com caminhos reais no código e na UI.*
