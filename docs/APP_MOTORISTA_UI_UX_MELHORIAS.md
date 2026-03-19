# App Motorista – Plano de melhorias UI/UX (dar outra vida ao app)

Objetivo: melhorar **modo escuro**, **modo claro** e **experiência mobile** do app do motorista, com foco em contraste, legibilidade e consistência.

---

## 0. Nova identidade aplicada (v5 – Teal + Slate)

Foi aplicada uma **nova identidade visual** em todo o app do motorista:

- **Paleta:** Teal (#0d9488, #0f766e, #134e4a) + Slate para neutros; substituição do antigo azul navy (#0d2137) e cyan (#0ea5e9).
- **Tipografia:** Fonte **DM Sans** (Google Fonts) no lugar de Plus Jakarta Sans.
- **Tema claro:** Fundo #f0fdfa, cards brancos, texto escuro; header e botões com gradiente teal.
- **Tema escuro:** Variáveis completas em `html.tema-escuro` e `html[data-theme="dark"]`: fundo #0f172a, cards #1e293b, texto #f1f5f9 / #94a3b8; sem cards brancos.
- **Arquivos alterados:** `motorista/css/design-system.css` (variáveis e tema escuro), `padrao-telas.css` (navbar, cards, botões, info-grid com --app-*), `style.css` (login com nova paleta), `index.html` (fonte, theme-color, script data-theme), `pages/dashboard.html` (fonte, theme-color, header e estilos com variáveis), e demais páginas com gradiente inline (diagnostico, gps, cadastro, viagens, convocacoes, comprovar-entrega, rastreamento) passando a usar `var(--app-header-bg)`.

O app continua usando a mesma lógica de tema (localStorage `tema`: escuro / claro / auto); o script no `<head>` passa a setar também `data-theme="dark"` ou `"light"` no `<html>` para compatibilidade com o novo design system.

---

## 1. Problemas identificados (pelos prints)

### 1.1 i18n – chaves aparecendo no lugar do texto
- **Cargas:** `cargas.todosEstados` e `cargas.todosRegioes` nos dropdowns (Estado/Região).
- **Enviar Posição:** `enviarPosicao.viagemAtual` no card da viagem.
- **Detalhes da Viagem:** `detalhesViagem.titulo` no título da tela.
- **Causa provável:** Quando o app é acessado por **`/mc`**, o path dos arquivos de locale pode estar errado e o JSON não carrega → `messages` vazio → `t(key)` devolve a própria chave.
- **Correção aplicada:** Em `motorista/js/i18n.js` o `localePath` passou a usar sempre o path canônico quando a URL contém `/mc` (ex.: `origin + '/motorista/locales'`), para evitar 404 e garantir que os locales carreguem.

### 1.2 Modo escuro – contraste e legibilidade
- **Texto escuro em fundo escuro:** Em várias telas (Chat, Enviar Posição, Comprovar Entrega, Macros, Detalhes da Viagem, GPS) o texto em cinza escuro (#333, #555, #666) fica ilegível sobre cards/áreas navy (#0d2137, #1e293b).
- **Cards brancos no escuro:** Muitos cards continuam brancos no “dark mode”, gerando brilho e quebrando a sensação de tema escuro.
- **Badge “Sincronizado”:** Sobreposição com o título em algumas telas (ex.: Detalhes da Viagem).
- **Histórico / listas:** Texto em cinza médio sobre fundo cinza escuro (Chat, Histórico de macros) com contraste insuficiente.

### 1.3 Modo claro
- **Hierarquia fraca:** Botões e labels com pouco contraste; formulários “datados”.
- **Paleta:** Mistura de azul forte, cinzas e branco sem unidade clara.

### 1.4 Mobile / uso pelo motorista
- **Abas:** “Histórico” truncado (“Históri”) por falta de espaço.
- **Touch targets:** Ícones e botões pequenos para uso no celular.
- **Tipografia:** Labels e valores secundários pequenos demais para leitura rápida (ex.: em movimento).
- **Timestamps:** Exibição em ISO (ex.: `2024-03-06T20:03:33.314Z`) em vez de formato curto (ex.: “20:03” ou “18/03, 14:07”).
- **Espaçamento:** Muito espaço vazio em algumas telas; em outras, elementos apertados (header + badge).

---

## 2. Correções já feitas

- **i18n quando o app está em `/mc`:** Ajuste em `motorista/js/i18n.js` para que os locales sejam sempre carregados do path canônico (`/motorista/locales`), mesmo com base em `atlascargo.log.br/mc`. Assim, as chaves `cargas.todosEstados`, `cargas.todosRegioes`, `enviarPosicao.viagemAtual`, `detalhesViagem.titulo` passam a exibir o texto traduzido assim que o JSON carregar.

---

## 3. Plano de melhorias (dar outra vida ao app)

### 3.1 Modo escuro – regras claras

- **Variáveis por tema:** Usar `[data-theme="dark"]` (ou classe no `body`) e definir no CSS:
  - **Fundo da página:** escuro (ex.: `#0f172a`, `#1e293b`).
  - **Cards/containers:** fundo escuro (ex.: `#1e293b`, `#334155`), **nunca** branco puro.
  - **Texto principal:** claro (ex.: `#f1f5f9`, `#e2e8f0`).
  - **Texto secundário:** cinza claro (ex.: `#94a3b8`), nunca cinza escuro.
- **Onde aplicar:** `design-system.css` e/ou `style.css` / `padrao-telas.css` do motorista, garantindo que todas as telas (Cargas, Chat, Enviar Posição, Detalhes da Viagem, Macros, Comprovar Entrega, GPS, Dashboard) herdem essas variáveis.
- **Referência:** Seguir o padrão do painel web (`.cursor/rules/padrao-ui-modulos.mdc` e `dark-mode.css`): sem fundo branco em painéis no dark; usar especificidade suficiente para sobrescrever estilos locais.

### 3.2 Modo claro – consistência

- **Hierarquia:** Títulos em cor escura (ex.: `#0f172a`); labels em cinza médio; valores em destaque.
- **Botões:** Primário (ex.: azul) bem definido; secundário (contorno ou cinza) claro.
- **Cards:** Fundo branco ou cinza muito claro com borda sutil; sombra leve.

### 3.3 Ajustes pontuais por tela

| Tela | Ajuste |
|------|--------|
| **Header (navbar)** | Alinhar verticalmente “Voltar”, título e badge “Online - Sincronizado”; evitar sobreposição; em dark, fundo e texto com contraste adequado. |
| **Cargas** | Garantir que os `<select>` (Estado/Região) sejam preenchidos depois do locale carregado e que usem `_t('cargas.todosEstados')` etc.; manter labels e botão “Buscar Cargas” legíveis em ambos os temas. |
| **Chat** | Bolhas de mensagem: em dark, fundo escuro e texto claro; timestamps em formato curto (ex.: “20:03”); dropdown “Re-transcrever” e “Não transcrever” legíveis. |
| **Enviar Posição** | Card “Viagem Atual” e texto “Clique no botão…” em contraste alto no dark; não usar cinza escuro em fundo navy. |
| **Detalhes da Viagem** | Título com `detalhesViagem.titulo` traduzido; badge não sobrepor o título; abas com scroll horizontal ou texto menor/ícones para evitar “Históri”. |
| **Macros / Viagem atual** | Cards de etapa (Carga, Descarga, Histórico) com texto claro no dark; evitar cinza sobre cinza. |
| **Comprovar Entrega** | Card “Viagem” e “Foto da Entrega” com labels e valores legíveis (nunca cinza claro em branco no dark). |
| **GPS / Estatísticas** | Cards de estatísticas: em dark, fundo escuro e números/labels claros; ícones com cor que contraste. |
| **Dashboard motorista** | “Notificações Recentes” e “Atualizar” com cor legível no dark; números dos cards (0, 1) com contraste suficiente. |

### 3.4 Mobile e acessibilidade

- **Abas:** Scroll horizontal e/ou abreviar labels (ex.: “Hist.”) ou priorizar ícones para evitar truncamento.
- **Toques:** Botões e itens clicáveis com altura mínima ~44px; espaçamento entre links/botões.
- **Fonte:** Aumentar tamanho mínimo de labels e valores em cards (ex.: 14px labels, 16px valores).
- **Timestamps:** Formatar datas/horas com `toLocaleString` ou helper (ex.: “18/03, 14:07”) em Chat, Histórico, Macros.

### 3.5 Ordem sugerida de implementação

1. **Variáveis dark no design-system** (ou arquivo único do motorista): `[data-theme="dark"]` com cores de fundo e texto para página, cards, inputs e botões.
2. **Aplicar tema no motorista:** Ler `localStorage.getItem('theme')` (ou preferência do app) e setar `document.documentElement.setAttribute('data-theme', 'dark')` no carregamento, igual ao painel web.
3. **Substituir cinzas escuros** em telas críticas: onde hoje há `color: #333` / `#555` / `#666` em blocos com fundo escuro, trocar para variáveis de “texto claro” no dark.
4. **Header/navbar:** Ajustar layout (flex, espaçamento) e contraste do badge.
5. **Abas e truncamento:** Ajustar CSS (overflow, font-size ou texto curto) na tela de detalhes da viagem.
6. **Formatação de data/hora:** Criar `formatDateTime(iso)` e usar em Chat, Histórico, etc.
7. **Revisar cada tela** no celular em modo claro e escuro e anotar exceções (telas com estilo inline ou muito específico).

---

## 4. Arquivos principais a tocar

- `backend/public/motorista/js/i18n.js` – path dos locales (já ajustado).
- `backend/public/motorista/css/design-system.css` – variáveis e blocos `[data-theme="dark"]`.
- `backend/public/motorista/css/style.css` – estilos gerais e overrides para dark.
- `backend/public/motorista/css/padrao-telas.css` – padrão de telas (navbar, container, cards).
- Páginas em `motorista/pages/*.html` e scripts associados – evitar cores fixas (#333, #666) em elementos que ficam em fundo escuro; usar variáveis CSS.
- `motorista/index.html` (ou ponto de entrada) – aplicar `data-theme` conforme preferência do usuário no carregamento.

---

## 5. Resumo

- **i18n:** Ajuste do path dos locales quando o app está em `/mc` para deixar de exibir chaves (ex.: `cargas.todosEstados`, `enviarPosicao.viagemAtual`, `detalhesViagem.titulo`) e mostrar o texto traduzido.
- **Dark:** Tratar como tema de verdade: fundos escuros, texto claro, sem cards brancos nem texto cinza escuro em fundo escuro.
- **Light:** Reforçar hierarquia e contraste; paleta consistente.
- **Mobile:** Abas sem truncar, toques grandes, fontes legíveis, timestamps em formato amigável.

Seguindo esse plano, o app do motorista ganha “outra vida” em modo escuro, modo claro e no uso pelo celular, sem precisar mudar a stack (continua HTML/CSS/JS).
