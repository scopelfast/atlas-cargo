import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(__dirname, '..');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '_table_rows.json'), 'utf8'));

const table = [
  '| Módulo | Tela | URL | Situação funcional | Situação visual | Captura |',
  '|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.mod} | ${r.tela} | \`${r.url}\` | ${r.func} | ${r.vis} | ${r.shot} |`
  ),
].join('\n');

const byMod = {};
const byMat = {};
for (const r of rows) {
  byMod[r.mod] = (byMod[r.mod] || 0) + 1;
  byMat[r.func] = (byMat[r.func] || 0) + 1;
}

const completo = `# Inventário Completo de Telas — Atlas Cargo

**Data:** 27/11/2026  
**Projeto:** \`C:\\\\atlas-cargo\`  
**Ambiente:** \`http://localhost:8083/\` · banco \`atlas_cargo_prd\` (HML operacional)  
**Escopo:** somente levantamento, documentação e capturas reais. Nenhuma funcionalidade, banco, permissão ou deploy foi alterado nesta etapa.

## Resumo quantitativo

| Métrica | Valor |
|---|---|
| Telas inventariadas (linhas da tabela) | **${rows.length}** |
| Capturas PNG reais | **180** (0 falhas) em \`docs/inventario_telas/screenshots/\` |
| HTML em \`backend/public\` | 78 arquivos |
| Módulos torre com \`index.html\` | 46 |
| Páginas app motorista | 24 + login |

### Por maturidade funcional

| Situação | Qtd |
|---|---|
${Object.entries(byMat)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

### Por módulo (agrupamento da tabela)

| Módulo | Qtd |
|---|---|
${Object.entries(byMod)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

## Critérios de classificação

| Situação | Critério |
|---|---|
| **PRONTA** | HTML + JS com chamadas \`/api/*\` e UI operacional utilizável |
| **PARCIAL** | Existe, mas é hub/stub/redirect/API parcial ou depende de sessão específica |
| **INCOMPLETA** | Placeholder visual sem funcionamento (ex.: Ranking) |
| **NÃO IMPLEMENTADA** | Sem pasta/tela; só prevista em docs/conceito ou permissão sem UI própria |

## Tabela geral

${table}

## Fichas técnicas (por família)

Onde não houve confirmação no código: **NÃO IDENTIFICADO**.

### 0. Público / autenticação

#### Login Torre
1. Módulo: Público  
2. Tela: Login Atlas Cargo  
3. URL: \`/index.html\`  
4. Arquivo: \`backend/public/index.html\` + \`js/login.js\`  
5. API: \`POST /api/auth/login\`; \`GET /api/configuracoes/identidade\`  
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
| Recuperar senha torre | \`/recuperar-senha.html\` | PRONTA |
| Cadastrar-se (pedido empresa) | \`/cadastro-empresa.html\` | PRONTA |
| Convocação pública | \`/convocacao.html\` | PRONTA |
| Dashboard shell | \`/dashboard.html\` | PRONTA |
| BI Cenário Base / Volume PR-SC | stubs que redirecionam API WMS | PARCIAL |
| Teste mobile | \`/teste-mobile.html\` | PARCIAL (QA) |

### 1. Cadastros
Padrão: abas Filtros / Grid / Dados; Limpar / Filtrar / Novo; overlay; dark mode.

| Tela | DSPROGRAMA | APIs | Situação |
|---|---|---|---|
| Cadastro Geral | gerenciar-cadastro-geral | \`/api/cadastros-gerais*\`, motorista, classes, validades | PRONTA |
| Estados | gerenciar-estados | \`/api/estados\`, \`/api/paises\` | PRONTA |
| Mesorregião | gerenciar-mesorregiao | \`/api/mesorregioes\` | PRONTA |
| Cidades | gerenciar-cidades | \`/api/cidades*\` | PRONTA |
| Tipos de Validade | gerenciar-tipos-validade | \`/api/tipos-validade\` | PRONTA |

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
APIs \`/api/financeiro/*\` + FIN_*. **PRONTA** no HML local (Fases 1–4). Pix: **NÃO IMPLEMENTADA**.

### 8. App Motorista
Login/cadastro/recuperar/dashboard/convocações/cargas/viagens/macros/perfil/config/oportunidades/chat-standalone: majoritariamente **PRONTA**.  
Família GPS, SOS, comprovar entrega, eventos, diagnóstico, notificações: **PARCIAL** (UI capturada; sessão motorista não usada nesta rodada — dados/fluxos profundos NÃO IDENTIFICADOS por completo).

### 9. Não implementadas
Manutenção/oficina; pneus; combustível; Pix (Fase 5).

## Capturas
- Pasta: \`docs/inventario_telas/screenshots/\`
- Manifesto: \`docs/inventario_telas/screenshots/_manifest.json\`
- Script: \`docs/inventario_telas/_capture_screenshots.mjs\`

## Relacionados
- \`docs/MAPA_NAVEGACAO_ATLAS_CARGO.md\`
- \`docs/INVENTARIO_FUNCIONAL_ATLAS_CARGO.md\`
- \`docs/INVENTARIO_PENDENCIAS_VISUAIS_ATLAS_CARGO.md\`
- \`docs/REDESIGN_ATLAS_CARGO_RECOMENDACOES.md\`
`;

const mapa = `# Mapa de Navegação — Atlas Cargo

**Data:** 27/11/2026 · Base: \`http://localhost:8083/\`

## Entradas

\`\`\`mermaid
flowchart TD
  LoginTorre["/index.html Login Torre"] --> Dash["/dashboard.html Shell"]
  LoginTorre --> RecSenha["/recuperar-senha.html"]
  LoginTorre --> CadEmp["/cadastro-empresa.html Cadastrar-se"]
  LoginTorre --> MotLogin["/motorista/ Login Motorista"]
  MotLogin --> MotDash["/motorista/pages/dashboard.html"]
  MotLogin --> MotCad["/motorista/pages/cadastro.html"]
  ConvPub["/convocacao.html Link público"] -.-> MotLogin
  Dash --> Menu["Menu TIPOATIVIDADE / DSPROGRAMA"]
  Menu --> Mods["modulos/*/index.html"]
\`\`\`

## Hierarquia do menu (produto)

O dashboard filtra por módulo de produto (\`geral\`, Torre \`divulga*\`, Estoque \`estoque\`) e monta grupos \`FGGRUPO\`.

### Cadastros
1.0 Cadastro Geral → 1.1 Estados → 1.2 Mesorregião → 1.3 Cidade → 1.4 Tipo Validade

### Equipamentos
2.0 Veículos → 2.1 Marca → 2.2 Tipo → 2.3 Modelo → 2.4 Grupo → 2.5 Classe Frota

### Logística
3.0 Viagem → 3.1 Tipo Viagem → 3.2 Situação → 3.3 Roteiro → 3.4 Tipo Ocorrência → 3.5 Campanha

### Gestão
4.0 Convocações (relatório) → 4.1 Alertas → 4.2 Chat → 4.3 SOS → 4.4 Ranking → 4.5 Mapa → 4.6 Logs

### WMS
5.0 Painel → 5.1 Cadastros → 5.2 Recebimento → 5.3 Separação → 5.4 Cargas → 5.5 Expedição → 5.8 Baixas → 5.9 Relatórios → 6.0 Inventário → 6.1 Transferências → 6.2 Valor → 7.1 Cobrança  
Permissões sem tela: 5.6 Liberar Expedição, 5.7 Liberar Validade, Lib. picking OPL

### Sistema
9.0 Usuário → 9.1 Tipo Atividade → 9.2 Empresas → 9.3 Filiais → 9.4 Configurações → 9.5 Tenants SaaS → 9.6 Disparo WhatsApp → **9.7 Atlas Pay**

## Telas fora do menu (links internos)

| Tela | Como chega |
|---|---|
| \`/convocacao.html\` | Link WhatsApp / Switch / e-mail |
| \`/cadastro-empresa.html\` | Login “Cadastrar-se” |
| \`/recuperar-senha.html\` | Login “Esqueci minha senha” |
| \`/motorista/pages/oportunidades-publicas.html\` | Campanha / link público |
| \`/bi-*.html\` | Atalhos BI / API WMS |
| \`/teste-mobile.html\` | QA interno |
| Modais de Viagens (anúncio, comprovantes, mapa motorista, divergência placas) | Botões internos do módulo |
| Pedidos de acesso | Aba em Tenants SaaS (badge no dashboard) |

## Fluxos principais

### Torre — viagem e convocação
\`\`\`mermaid
flowchart LR
  V[Gerenciar Viagens] --> C[Criar/enviar convocações]
  C --> A[Motorista aceita]
  A --> F[Torre confirma]
  F --> Cob[Cobrança CONEXAO Atlas Pay se regra S]
  F --> Mac[Macros / mapa / chat]
\`\`\`

### WMS
Recebimento → Separação OPL → Cargas → Expedição → Relatórios / Inventário / Cobrança 7.1

### Atlas Pay
Contrato vigente → Cobranças ABERTA → Baixa/Cancelar → Fechamento de uso mensal → Gates em operações novas (Fase 4)

### Motorista
Login → Dashboard → Convocações/Cargas → Aceite → Viagem → Macros/GPS/Chat/SOS/POD

## Relação dashboard ↔ módulo
1. Usuário autentica → token em \`localStorage\`.  
2. \`GET /api/menu/user-menu\` retorna itens permitidos.  
3. Clique no item chama \`loadModuleContent(DSPROGRAMA)\` carregando \`/modulos/{programa}/index.html\`.  
4. Badges (chat, alertas, SOS, motoristas pendentes, pedidos SaaS) abrem o módulo correspondente.
`;

const funcional = `# Inventário Funcional — Atlas Cargo

**Data:** 27/11/2026  
Descreve o comportamento real observado no código e nas capturas. Não inventa regras.

## Autenticação e shell

| Ação | API / efeito |
|---|---|
| Entrar (torre) | \`POST /api/auth/login\` → token + redirect \`dashboard.html\` |
| Alterar senha (modal login) | Fluxo de alteração autenticada no login (campos do modal) |
| Esqueci senha | \`/recuperar-senha.html\` → \`/api/auth/recuperar-senha\` + redefinir |
| Limite de sessão | Modal impede novo login até liberar vaga; registra em Logs de Acesso |
| Menu | \`GET /api/menu/user-menu\` filtrado por \`USUARIOATIVIDADE\` + módulo produto + licença |
| Tema | \`data-theme\` no documento; dark mode CSS global + por módulo |

## Cadastros e frota

CRUD padrão: Filtrar (GET lista) → Novo/editar (POST/PUT) → Excluir/inativar com confirmação.  
Cadastro Geral: aprovar motorista (\`/api/motorista/aprovar-admin\`), definir senha admin, vincular classes/veículos, import planilha.  
Equipamentos: ficha técnica (RENAVAM, chassi, capacidade tanque) — **não** gera OS de manutenção.

## Viagens e convocações

| Ação | O que acontece |
|---|---|
| Filtrar viagens | \`GET /api/viagens\` / pendentes |
| Salvar viagem | Persistência viagem + pontos/roteiro |
| Criar convocações | \`aplicarGate\` TENANT (Atlas Pay) → cria registros convocação / envio Switch |
| Confirmar convocação | Gate TENANT → TX confirmação + cobrança CONEXAO (se \`FG_REGRA_ATIVA=S\`) |
| Reativar / desistir lote | Cancela cobrança ABERTA ligada ao ciclo |
| Macros / prova entrega | APIs motorista + delivery-proof |

Motorista: \`aceitarConvocacao\` / \`aceitarCarga\` / interesse público → gate MOTORISTA.

## Campanhas
Disparar/pausar/retomar/reprocessar → \`/api/oportunidades-campanhas/:id/*\` com gate tenant no disparo.

## Gestão tempo real
- Alertas: listar/tratar/ler/histórico + contador no dashboard  
- Chat: conversas/mensagens/áudio/transcrição  
- SOS: listar/tratar/geocodificar  
- Mapa viagem: resumo + veículos em mapa  
- Ranking: **sem API** (incompleto)

## WMS

| Tela | Função-chave |
|---|---|
| Cadastros | Donos, armazéns, áreas, docas, produtos, de-para, import XML |
| Recebimento | Import NF-e XML, farol, validade mínima (perm. liberar) |
| Separação | Import OPL, programação, validação pedidos, reservas |
| Cargas | Programar/mesclar/distribuir NF × rota / vínculo viagem |
| Expedição | Conferência; bloqueio por divergência (perm. liberar) |
| Baixas | Preview + baixa + estorno |
| Inventário | Cíclico/manual/planilha |
| Transferências | Entre donos |
| Valor / Cobrança 7.1 | Dashboards e CSV — **distintos** do Atlas Pay |

## Sistema / SaaS / WhatsApp
- Usuários: atividades (=menus), empresas, filiais, tenant  
- Tipos Atividade: edita \`DSPROGRAMA\`/\`FGGRUPO\` (dono)  
- Configurações: Switch Digital, mensagens, contexto multipaís, mapa OSRM/Nominatim, OpenAI, app motorista  
- Tenants: planos, catálogo módulos, pedidos acesso, limpeza teste  
- Disparo WhatsApp: preview + enviar lista

## Atlas Pay (funcional)

| Aba | Capacidade |
|---|---|
| Visão geral | KPIs + warning inadimplência |
| Contratos | Versionar componentes; política ALERTA/BLOQUEIO; \`FG_REGRA_ATIVA\` |
| Fechamento de uso | Prévia → calcular → aprovar → gerar cobrança USO |
| Cobranças | Listar / baixa / cancelar (FIN_*) |
| Permissões | Perfis, overrides EFEITO, bootstrap admin, audit |

Gates Fase 4 (somente operações novas): aceitar convocação/carga/interesse; criar convocações; disparar campanha; confirmar. Fail-open com aviso. Sem status VENCIDA no banco.

## Dependências entre telas

- Viagens depende de Roteiros, Classes, Tipos/Situações, Cadastro Geral (contratador/motorista).  
- Campanhas depende de elegíveis (motoristas/viagens) + Switch.  
- WMS Expedição depende de Cargas + Separação.  
- Atlas Pay cobrança CONEXAO depende da confirmação em Viagens.  
- Cobrança WMS 7.1 **não** acopla Atlas Pay.

## Permissões
- Torre: \`TIPOATIVIDADE\` via \`USUARIOATIVIDADE\` (\`DSPROGRAMA\`).  
- Atlas Pay: atividade \`atlas-pay\` + catálogo FIN_* (STRICT após bootstrap).  
- WMS liberações: atividades específicas sem HTML próprio.
`;

const pendencias = `# Inventário de Pendências Visuais — Atlas Cargo

**Data:** 27/11/2026  
Somente documentação. Nenhum problema abaixo foi corrigido nesta etapa.

## Separação visual × funcional

| Item | Tipo | Situação | Evidência |
|---|---|---|---|
| Ranking | Funcional + visual | INCOMPLETA | Placeholder “módulo em construção”; captura \`04-gestao/ranking.png\` |
| Painel Estoque | Funcional parcial | PARCIAL | Hub de cards sem API própria; \`05-wms/painel-estoque.png\` |
| BI stubs | Funcional parcial | PARCIAL | Redirects \`bi-*.html\` |
| Manutenção / pneus / combustível | Funcional | NÃO IMPLEMENTADA | Sem pastas/telas |
| Pix Atlas Pay | Funcional | NÃO IMPLEMENTADA | Fase 5 não iniciada |
| App motorista (várias páginas) sem sessão | Funcional observação | PARCIAL | Capturas mostram UI/redirect; fluxos logados NÃO totalmente exercitados |
| Chat torre dark mode dedicado | Visual | Pendência possível | Depende do shell; CSS dark próprio do módulo não evidenciado como nos demais |
| Inconsistência de padrões de abas/botões entre módulos antigos e novos | Visual | Pendência de padronização | Redesign previsto em \`REDESIGN_ATLAS_CARGO_RECOMENDACOES.md\` |
| Overlay/filtros | Visual | Em evolução | Padrão oficial: Situações de Viagem (botões) e Cidades (overlay) — nem todos os módulos estão 100% alinhados |
| Mobile torre (módulos internos) | Visual | Gap | Captura mobile feita no login; módulos torre capturados em 1440×900 — responsividade completa NÃO IDENTIFICADA tela a tela |
| Tema escuro login | Visual | Captura clara + tentativa dark | Verificar se \`login-torre-escuro.png\` existe; se ausente, dark do login não foi persistido nesta rodada |

## Problemas visuais observados (não corrigidos)

1. Densidade alta em módulos grandes (Viagens, Cadastro Geral, Relatórios WMS) — muitas abas e painéis no primeiro viewport.  
2. Ranking quebra a expectativa do menu 4.4 (entrada existe, produto não).  
3. Hub Estoque parece “menu dentro do menu”, diferente do padrão Filtros/Grid/Dados.  
4. App motorista: páginas GPS/ajuda/diagnóstico com hierarquia visual menos uniforme que dashboard/convocações.  
5. Documentação/manual WMS HTML interno (\`estoque/manual-operacional-wms.html\`) é conteúdo, não tela de operação — não confundir com módulo.

## Problemas funcionais observados (não corrigidos)

1. Ranking sem backend.  
2. Três atividades WMS de liberação sem tela dedicada (OK como permissão, mas o menu pode confundir).  
3. Capacidade de tanque em Equipamentos não implica gestão de combustível.  
4. Macro “Abastecimento” ≠ módulo de combustível.  
5. Sessão motorista não foi usada nas capturas autenticadas do app — validação profunda de SOS/POD/GPS logado fica como **NÃO IDENTIFICADO** nesta rodada.

## Fora de escopo desta etapa
- Não redesenhar, não padronizar CSS, não implementar Ranking/Pix/manutenção.  
- Produção externa permanece não autorizada para mudanças Atlas Pay.
`;

fs.writeFileSync(path.join(docs, 'INVENTARIO_COMPLETO_TELAS_ATLAS_CARGO.md'), completo, 'utf8');
fs.writeFileSync(path.join(docs, 'MAPA_NAVEGACAO_ATLAS_CARGO.md'), mapa, 'utf8');
fs.writeFileSync(path.join(docs, 'INVENTARIO_FUNCIONAL_ATLAS_CARGO.md'), funcional, 'utf8');
fs.writeFileSync(path.join(docs, 'INVENTARIO_PENDENCIAS_VISUAIS_ATLAS_CARGO.md'), pendencias, 'utf8');

console.log('docs written');
console.log({ total: rows.length, byMat, byMod });
