# Inventário Completo de Telas — Atlas Cargo

**Data:** 27/11/2026  
**Projeto:** `C:\\atlas-cargo`  
**Ambiente:** `http://localhost:8083/` · banco `atlas_cargo_prd` (HML operacional)  
**Escopo:** somente levantamento, documentação e capturas reais. Nenhuma funcionalidade, banco, permissão ou deploy foi alterado nesta etapa.

## Resumo quantitativo

| Métrica | Valor |
|---|---|
| Telas inventariadas (linhas da tabela) | **85** |
| Capturas PNG reais | **181** em `docs/inventario_telas/screenshots/` (inclui login claro/escuro/mobile) |
| HTML em `backend/public` | 78 arquivos |
| Módulos torre com `index.html` | 46 |
| Páginas app motorista | 24 + login |

### Por maturidade funcional

| Situação | Qtd |
|---|---|
| PRONTA | 62 |
| PARCIAL | 18 |
| INCOMPLETA | 1 |
| NÃO IMPLEMENTADA | 4 |

### Por módulo (agrupamento da tabela)

| Módulo | Qtd |
|---|---|
| Público | 9 |
| Cadastros | 5 |
| Equipamentos | 6 |
| Logística | 6 |
| Gestão | 7 |
| WMS | 12 |
| Sistema | 7 |
| Atlas Pay | 1 |
| WMS (permissão) | 3 |
| Frota (futuro) | 3 |
| Atlas Pay (futuro) | 1 |
| App Motorista | 25 |

## Critérios de classificação

| Situação | Critério |
|---|---|
| **PRONTA** | HTML + JS com chamadas `/api/*` e UI operacional utilizável |
| **PARCIAL** | Existe, mas é hub/stub/redirect/API parcial ou depende de sessão específica |
| **INCOMPLETA** | Placeholder visual sem funcionamento (ex.: Ranking) |
| **NÃO IMPLEMENTADA** | Sem pasta/tela; só prevista em docs/conceito ou permissão sem UI própria |

## Tabela geral

| Módulo | Tela | URL | Situação funcional | Situação visual | Captura |
|---|---|---|---|---|---|
| Público | Login Torre | `/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/login-torre-claro.png |
| Público | Login Torre (mobile) | `/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/login-torre-mobile.png |
| Público | Recuperar senha torre | `/recuperar-senha.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/recuperar-senha-torre.png |
| Público | Cadastrar-se (empresa) | `/cadastro-empresa.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/cadastro-empresa.png |
| Público | Convocação pública | `/convocacao.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/convocacao-publica.png |
| Público | Dashboard shell | `/dashboard.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/00-publico/dashboard-shell.png |
| Público | BI Cenário Base | `/bi-cenario-base.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/00-publico/bi-cenario-base.png |
| Público | Teste mobile | `/teste-mobile.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/00-publico/teste-mobile.png |
| Público | BI Volume PR-SC | `/bi-volume-pr-sc.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/00-publico/bi-cenario-base.png |
| Cadastros | Cadastro Geral | `/modulos/gerenciar-cadastro-geral/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/01-cadastros/cadastro-geral.png |
| Cadastros | Estados | `/modulos/gerenciar-estados/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/01-cadastros/estados.png |
| Cadastros | Mesorregião | `/modulos/gerenciar-mesorregiao/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/01-cadastros/mesorregiao.png |
| Cadastros | Cidades | `/modulos/gerenciar-cidades/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/01-cadastros/cidades.png |
| Cadastros | Tipos de Validade | `/modulos/gerenciar-tipos-validade/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/01-cadastros/tipos-validade.png |
| Equipamentos | Veículos/Equipamentos | `/modulos/gerenciar-equipamentos/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/equipamentos.png |
| Equipamentos | Marcas | `/modulos/gerenciar-marcas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/marcas.png |
| Equipamentos | Tipos de Equipamento | `/modulos/gerenciar-tipos-equipamento/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/tipos-equipamento.png |
| Equipamentos | Modelos | `/modulos/gerenciar-modelos-equipamento/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/modelos.png |
| Equipamentos | Grupos | `/modulos/gerenciar-grupos/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/grupos.png |
| Equipamentos | Classes de Frota | `/modulos/gerenciar-classes-frota/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/02-equipamentos/classes-frota.png |
| Logística | Viagens | `/modulos/gerenciar-viagens/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/viagens.png |
| Logística | Tipos de Viagem | `/modulos/gerenciar-tipos-viagem/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/tipos-viagem.png |
| Logística | Situações de Viagem | `/modulos/gerenciar-situacoes-viagem/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/situacoes-viagem.png |
| Logística | Roteiros | `/modulos/gerenciar-roteiros/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/roteiros.png |
| Logística | Tipo Ocorrência (Macros) | `/modulos/gerenciar-tipo-ocorrencia/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/tipo-ocorrencia.png |
| Logística | Campanhas de Oportunidades | `/modulos/campanhas-oportunidades/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/03-logistica/campanhas-oportunidades.png |
| Gestão | Relatório Convocações | `/modulos/relatorio-convocacoes/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/relatorio-convocacoes.png |
| Gestão | Alertas | `/modulos/alertas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/alertas.png |
| Gestão | Chat | `/modulos/chat/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/chat.png |
| Gestão | SOS | `/modulos/sos/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/sos.png |
| Gestão | Ranking | `/modulos/ranking/index.html` | INCOMPLETA | INCOMPLETA | docs/inventario_telas/screenshots/04-gestao/ranking.png |
| Gestão | Mapa de Viagem | `/modulos/gerenciar-mapa-viagem/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/mapa-viagem.png |
| Gestão | Logs de Acesso | `/modulos/gerenciar-logs-acesso/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/04-gestao/logs-acesso.png |
| WMS | Painel Estoque | `/modulos/estoque/index.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/05-wms/painel-estoque.png |
| WMS | Cadastros WMS | `/modulos/estoque-cadastros-wms/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/cadastros-wms.png |
| WMS | Recebimento | `/modulos/estoque-recebimento/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/recebimento.png |
| WMS | Separação | `/modulos/estoque-separacao/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/separacao.png |
| WMS | Cargas | `/modulos/estoque-cargas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/cargas.png |
| WMS | Expedição | `/modulos/estoque-expedicao/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/expedicao.png |
| WMS | Baixas / Perdas | `/modulos/estoque-baixas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/baixas.png |
| WMS | Relatórios | `/modulos/estoque-relatorios/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/relatorios.png |
| WMS | Inventário | `/modulos/estoque-inventario/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/inventario.png |
| WMS | Transferências | `/modulos/estoque-transferencias/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/transferencias.png |
| WMS | Valor Estoque | `/modulos/estoque-valor/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/valor-estoque.png |
| WMS | Cobrança WMS 7.1 | `/modulos/estoque-cobranca/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/05-wms/cobranca-wms.png |
| Sistema | Usuários | `/modulos/gerenciar-usuarios/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/usuarios.png |
| Sistema | Tipos de Atividade | `/modulos/gerenciar-tipos-atividade/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/tipos-atividade.png |
| Sistema | Empresas | `/modulos/gerenciar-empresas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/empresas.png |
| Sistema | Filiais | `/modulos/gerenciar-filiais/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/filiais.png |
| Sistema | Configurações | `/modulos/gerenciar-configuracoes/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/configuracoes.png |
| Sistema | Tenants e módulos | `/modulos/gerenciar-tenants-saas/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/tenants-saas.png |
| Sistema | Disparo WhatsApp | `/modulos/gerenciar-disparo-whatsapp/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/06-sistema/disparo-whatsapp.png |
| Atlas Pay | Atlas Pay | `/modulos/atlas-pay/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/07-atlas-pay/atlas-pay.png |
| WMS (permissão) | Liberar Expedição divergência | `(sem HTML; embutido em Expedição)` | PARCIAL | N/A | (sem captura) |
| WMS (permissão) | Liberar Validade mínima | `(sem HTML; embutido em Recebimento)` | PARCIAL | N/A | (sem captura) |
| WMS (permissão) | Lib. picking OPL s/ cobertura | `(sem HTML; embutido em Separação)` | PARCIAL | N/A | (sem captura) |
| Frota (futuro) | Manutenção / Oficina | `—` | NÃO IMPLEMENTADA | NÃO IMPLEMENTADA | (sem captura) |
| Frota (futuro) | Gestão de Pneus | `—` | NÃO IMPLEMENTADA | NÃO IMPLEMENTADA | (sem captura) |
| Frota (futuro) | Controle de Combustível | `—` | NÃO IMPLEMENTADA | NÃO IMPLEMENTADA | (sem captura) |
| Atlas Pay (futuro) | Pix / Gateway | `—` | NÃO IMPLEMENTADA | NÃO IMPLEMENTADA | (sem captura) |
| App Motorista | Login Motorista | `/motorista/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/login-motorista.png |
| App Motorista | Login Motorista mobile | `/motorista/index.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/login-motorista-mobile.png |
| App Motorista | Cadastro Motorista | `/motorista/pages/cadastro.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/cadastro-motorista.png |
| App Motorista | Recuperar senha | `/motorista/pages/recuperar-senha.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/recuperar-senha.png |
| App Motorista | Dashboard | `/motorista/pages/dashboard.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/dashboard.png |
| App Motorista | Convocações | `/motorista/pages/convocacoes.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/convocacoes.png |
| App Motorista | Cargas | `/motorista/pages/cargas.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/cargas.png |
| App Motorista | Viagens | `/motorista/pages/viagens.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/viagens.png |
| App Motorista | Detalhes viagem | `/motorista/pages/detalhes-viagem.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/detalhes-viagem.png |
| App Motorista | Macros | `/motorista/pages/macros.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/macros.png |
| App Motorista | GPS | `/motorista/pages/gps.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/gps.png |
| App Motorista | Rastreamento | `/motorista/pages/rastreamento.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/rastreamento.png |
| App Motorista | Enviar posição | `/motorista/pages/enviar-posicao.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/enviar-posicao.png |
| App Motorista | GPS visualização | `/motorista/pages/gps-visualizacao.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/gps-visualizacao.png |
| App Motorista | Ajuda GPS | `/motorista/pages/ajuda-gps.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/ajuda-gps.png |
| App Motorista | Chat | `/motorista/pages/chat.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/chat.png |
| App Motorista | Chat standalone | `/motorista/pages/chat-standalone.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/chat-standalone.png |
| App Motorista | SOS | `/motorista/pages/sos.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/sos.png |
| App Motorista | Comprovar entrega | `/motorista/pages/comprovar-entrega.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/comprovar-entrega.png |
| App Motorista | Perfil | `/motorista/pages/perfil.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/perfil.png |
| App Motorista | Configurações | `/motorista/pages/configuracoes.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/configuracoes.png |
| App Motorista | Config. notificações | `/motorista/pages/configuracoes-notificacoes.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/configuracoes-notificacoes.png |
| App Motorista | Oportunidades públicas | `/motorista/pages/oportunidades-publicas.html` | PRONTA | PRONTA | docs/inventario_telas/screenshots/08-motorista/oportunidades-publicas.png |
| App Motorista | Eventos | `/motorista/pages/eventos.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/eventos.png |
| App Motorista | Diagnóstico | `/motorista/pages/diagnostico.html` | PARCIAL | PARCIAL | docs/inventario_telas/screenshots/08-motorista/diagnostico.png |

## Fichas técnicas (por família)

Onde não houve confirmação no código: **NÃO IDENTIFICADO**.

### 0. Público / autenticação

#### Login Torre
1. Módulo: Público  
2. Tela: Login Atlas Cargo  
3. URL: `/index.html`  
4. Arquivo: `backend/public/index.html` + `js/login.js`  
5. API: `POST /api/auth/login`; `GET /api/configuracoes/identidade`  
6. Permissão: nenhuma (pré-auth)  
7. Objetivo: autenticar operador da torre e abrir o dashboard  
8. Ações: Entrar; Alterar Senha; Esqueci minha senha; Sou motorista; Cadastrar-se; tema claro/escuro; PT/ES  
9. Campos: usuário, senha; modal alterar senha  
10. Modais: Alterar Senha; Limite de acessos simultâneos  
11. Regras: rate-limit; limite de sessões simultâneas  
12. Validações: campos obrigatórios  
13. Integrações: dashboard; app motorista; cadastro empresa; recuperação  
14. Estados: formulário, erro de credencial, modal limite de sessão  
15. Desktop/mobile: capturas em 00-publico  
16. Situação: **PRONTA**

#### Outras públicas
| Tela | URL | Situação |
|---|---|---|
| Recuperar senha torre | `/recuperar-senha.html` | PRONTA |
| Cadastrar-se (pedido empresa) | `/cadastro-empresa.html` | PRONTA |
| Convocação pública | `/convocacao.html` | PRONTA |
| Dashboard shell | `/dashboard.html` | PRONTA |
| BI Cenário Base / Volume PR-SC | stubs que redirecionam API WMS | PARCIAL |
| Teste mobile | `/teste-mobile.html` | PARCIAL (QA) |

### 1. Cadastros
Padrão: abas Filtros / Grid / Dados; Limpar / Filtrar / Novo; overlay; dark mode.

| Tela | DSPROGRAMA | APIs | Situação |
|---|---|---|---|
| Cadastro Geral | gerenciar-cadastro-geral | `/api/cadastros-gerais*`, motorista, classes, validades | PRONTA |
| Estados | gerenciar-estados | `/api/estados`, `/api/paises` | PRONTA |
| Mesorregião | gerenciar-mesorregiao | `/api/mesorregioes` | PRONTA |
| Cidades | gerenciar-cidades | `/api/cidades*` | PRONTA |
| Tipos de Validade | gerenciar-tipos-validade | `/api/tipos-validade` | PRONTA |

Cadastro Geral inclui Classes Frota, Validades, Locais, Veículos, Documentos, Endereços, Anexos, aprovação de motorista, import/export.

### 2. Equipamentos (frota cadastral)
Veículos, Marcas, Tipos, Modelos, Grupos, Classes Frota — todos **PRONTOS**.  
Isto **não** inclui manutenção, pneus ou combustível operacional (NÃO IMPLEMENTADOS).

### 3. Logística / Torre
| Tela | DSPROGRAMA | Situação |
|---|---|---|
| Viagens | gerenciar-viagens | PRONTA (maior módulo; convocações, confirmação, mapa, macros, Switch) |
| Tipos / Situações / Roteiros / Tipo Ocorrência / Campanhas | respectivos | PRONTA |

Fluxo: viagem → convocar → aceite motorista → confirmar (Atlas Pay se regra S) → macros/rastreio. Gates Fase 4 em criar convocações e confirmar.

### 4. Gestão
Relatório Convocações, Alertas, Chat, SOS, Mapa, Logs: **PRONTA**.  
Ranking: **INCOMPLETA** (placeholder sem API).

### 5. WMS
Painel hub: **PARCIAL**. Demais telas WMS listadas na tabela: **PRONTA**.  
Permissões sem HTML próprio: Liberar Expedição / Validade / picking OPL (embutidas).

### 6. Sistema
Usuários, Tipos Atividade, Empresas, Filiais, Configurações, Tenants SaaS, Disparo WhatsApp: **PRONTA**.

### 7. Atlas Pay
Abas: Visão geral, Contratos, Fechamento de uso, Cobranças, Permissões.  
APIs `/api/financeiro/*` + FIN_*. **PRONTA** no HML local (Fases 1–4). Pix: **NÃO IMPLEMENTADA**.

### 8. App Motorista
Login/cadastro/recuperar/dashboard/convocações/cargas/viagens/macros/perfil/config/oportunidades/chat-standalone: majoritariamente **PRONTA**.  
Família GPS, SOS, comprovar entrega, eventos, diagnóstico, notificações: **PARCIAL** (UI capturada; sessão motorista não usada nesta rodada — dados/fluxos profundos NÃO IDENTIFICADOS por completo).

### 9. Não implementadas
Manutenção/oficina; pneus; combustível; Pix (Fase 5).

## Capturas
- Pasta: `docs/inventario_telas/screenshots/`
- Manifesto: `docs/inventario_telas/screenshots/_manifest.json`
- Script: `docs/inventario_telas/_capture_screenshots.mjs`

## Relacionados
- `docs/MAPA_NAVEGACAO_ATLAS_CARGO.md`
- `docs/INVENTARIO_FUNCIONAL_ATLAS_CARGO.md`
- `docs/INVENTARIO_PENDENCIAS_VISUAIS_ATLAS_CARGO.md`
- `docs/REDESIGN_ATLAS_CARGO_RECOMENDACOES.md`
