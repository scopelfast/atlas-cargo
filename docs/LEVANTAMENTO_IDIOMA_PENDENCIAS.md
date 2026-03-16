# Levantamento geral – o que ainda falta para IDIOMA (i18n)

**Data:** 06/03/2026  
**Objetivo:** Listar de forma única o que já está tratado e o que ainda falta em relação a idioma (pt-BR / es-PY) no sistema.

---

## 1. Visão geral

| Área | Situação | Pendências principais |
|------|----------|------------------------|
| **App Motorista (telas)** | ✅ Estrutura i18n pronta | Checagem visual; textos em JS |
| **Web – painel (módulos)** | ✅ i18n nos módulos listados | Checagem visual; alguns textos fixos em JS |
| **Página pública (convocação)** | ✅ data-i18n + tWeb | Garantir carregamento do i18n na página |
| **Backend – APIs** | ⚠️ Parcial | errorKey só em motorista-app; demais em PT fixo |
| **Backend – mensagens WhatsApp** | ❌ Não tratado | Textos 100% em português |
| **Formatação (data/moeda)** | ✅ Contexto em vários módulos | Pontos ainda com pt-BR fixo |

---

## 2. App Motorista (`/motorista/`)

### O que está feito
- **Login** (`index.html`): data-i18n, i18n.js, seletor PT/ES, locales pt-BR e es-PY.
- **Páginas em `pages/`:** Todas as 22+ páginas têm carregamento de `i18n.js` e uso de `data-i18n` (e em muitos casos `t()` no JS).  
  Ex.: dashboard, viagens, convocações, cargas, cadastro, recuperar-senha, configurações, macros, sos, chat, gps, rastreamento, comprovar-entrega, detalhes-viagem, eventos, diagnostico, enviar-posicao, ajuda-gps, gps-visualizacao, configuracoes-notificacoes, chat-standalone.
- **Locales:** `motorista/locales/pt-BR.json` e `es-PY.json` com chaves para login, common, dashboard, cadastro, viagens, convocações, macros, etc.
- **API do app:** O controller `motorista-app.controller.js` devolve `errorKey` nas respostas de erro (ex.: `login.senhaIncorreta`, `cadastro.documentoObrigatorio`). O front pode usar `t(errorKey)` para exibir a mensagem no idioma correto.

### O que ainda pode faltar
1. **Checagem visual:** Em cada tela, abrir em pt-BR e em es-PY e conferir se não restou texto fixo em português (títulos, botões, labels, placeholders, toasts, alertas).
2. **Textos gerados em JS:** Garantir que strings montadas no JavaScript (innerHTML, alert, toast, placeholders dinâmicos) usem `window.t('chave')` e que a chave exista nos dois JSON.
3. **Mensagens de erro da API:** O front deve priorizar `errorKey` quando existir e usar `t(errorKey)`; quando não houver errorKey, exibir `error` (que hoje vem em português).

---

## 3. Web – painel administrativo

### O que está feito
- **Login web** (`public/index.html`) e **Dashboard** (`public/dashboard.html`): i18n-web.js, seletor de idioma, data-i18n.
- **Módulos:** Os módulos listados em `PENDENCIAS_I18N_WEB_E_APP.md` (cidades, tipos-validade, marcas, tipos-equipamento, modelos-equipamento, grupos, equipamentos, classes-frota, tipos-viagem, situacoes-viagem, roteiros, viagens, relatorio-convocacoes, cadastro-geral, logs-acesso, usuarios, empresas, filiais, configuracoes, alertas, chat, ranking, sos, mapa-viagem, tipos-atividade) já têm referência a i18n (data-i18n e/ou uso de contexto locale).
- **i18n-web.js:** Usa os mesmos arquivos `motorista/locales/pt-BR.json` e `es-PY.json`; expõe `tWeb('chave')` e `applyI18nWeb()`.
- **Contexto (locale/timezone):** Vários módulos carregam `/api/contexto` e usam `locale` e `timezone` para formatação de data e moeda (Gerenciar Viagens, Relatório Convocações, SOS, Alertas, Chat, Gerenciar Equipamentos, Gerenciar Cadastro Geral, Gerenciar Mapa Viagem, etc.).

### O que ainda pode faltar
1. **Checagem visual:** Em cada módulo, trocar idioma no dashboard e conferir se todos os rótulos, botões, placeholders e mensagens (incl. modais e toasts) aparecem traduzidos.
2. **Textos em JS nos módulos:** Garantir que strings montadas dinamicamente (tabelas, modais, mensagens de sucesso/erro) usem `tWeb('chave')` e que as chaves existam nos locales.
3. **Respostas de API (resto do backend):** A maioria das rotas (ex.: classefrota, situacaoviagem, usuario, etc.) devolve `error: 'Texto em português'` sem `errorKey`. Para i18n completo, seria necessário: (a) backend devolver `errorKey` e o front usar `tWeb(errorKey)`, ou (b) backend aceitar header `Accept-Language` e devolver mensagem já traduzida.

---

## 4. Página pública – Responder Convocação (`convocacao.html`)

### O que está feito
- A página tem `data-i18n` em títulos, labels, botões e mensagens (ex.: `responderConvocacao.tituloPagina`, `responderConvocacao.aceitarConvocacao`, etc.).
- No JS usa `typeof tWeb === 'function' ? tWeb('chave') : 'Texto fallback'` para mensagens dinâmicas (erro, permissão negada, Sim/Não, etc.).
- As chaves `responderConvocacao.*` existem em `motorista/locales/pt-BR.json` e `es-PY.json`.

### O que ainda pode faltar
1. **Carregamento do i18n:** A página deve carregar `i18n-web.js` (ou o script que expõe `tWeb`) **antes** de renderizar o conteúdo e chamar `applyI18nWeb()` quando o locale estiver pronto, para que os `data-i18n` sejam preenchidos no idioma correto. Verificar se isso já ocorre (ex.: script no layout ou na própria convocacao.html).
2. **Detecção de idioma:** Opcional: definir locale por parâmetro na URL (ex.: `?lang=es`) ou por preferência do navegador, para quem abre o link sem estar logado no sistema.

---

## 5. Backend – mensagens WhatsApp (convocações e confirmações)

### Situação atual
- **Nada é tratado por idioma.** Todos os textos enviados (convite de carga, confirmação “Você foi selecionado”, “não selecionado”) estão em português.
- Formatação de data e moeda usa `pt-BR` fixo.
- Arquivo: `backend/controllers/viagemmestre.controller.js` (montagem de `textoWhatsApp`, `textoMensagem`, `textoNaoSelecionado`).

### O que falta (decisão + implementação)
1. **Definir origem do idioma:**  
   - **Opção A:** Inferir pelo **País** do cadastro do motorista (CADASTROGERAL.PAIS → BR = pt-BR, PY/AR/UY = es-PY).  
   - **Opção B:** Campo **Idioma preferido** no cadastro (ex.: em CADASTROGERAL ou MOTORISTA_COMPLEMENTO), com fallback no país.
2. **Implementar:** Ao montar cada mensagem, obter o locale do motorista; ter conjuntos de textos (templates) em pt-BR e es-PY; usar esse locale na formatação de data e moeda.
3. Detalhes e trechos de código estão em `backend/public/motorista/RESUMO_IDIOMA_E_MENSAGENS.md`.

---

## 6. Backend – APIs (mensagens de erro e sucesso)

### O que está feito
- **motorista-app.controller.js:** As respostas de erro (e algumas de sucesso) incluem `errorKey` (ex.: `login.motoristaNaoEncontrado`, `cadastro.senhaObrigatoria`). O app motorista pode exibir `t(errorKey)`.

### O que falta
- **Demais rotas** (classefrota, situacaoviagem, tipoviagem, usuario, empresa, filial, etc.): respostas com `error: 'Erro ao carregar classes.'` (e similares) **sem** `errorKey`. Para i18n completo no painel web seria necessário:
  - Incluir em cada resposta um `errorKey` (ex.: `web.erroCarregarClasses`) e, no front, exibir `tWeb(errorKey)` quando existir; ou
  - Aceitar header `Accept-Language` e devolver a mensagem já traduzida conforme um dicionário no backend.
- Tratamento opcional e incremental (não bloqueia uso em produção).

---

## 7. Formatação (data, hora, moeda)

### O que está feito
- **Contexto:** `/api/contexto` retorna `locale`, `timezone`, `moeda` (e outros). Configurações permitem alterar idioma padrão, fuso e moeda.
- **Front:** Vários módulos web e o app motorista usam esse contexto para `formatarDataHoraComFuso`, `formatarMoeda`, `toLocaleString(locale, ...)`.
- **utils.js:** `formatarMoeda(valor, codigoMoeda, locale)` e `formatarDataHoraComFuso(data, locale, timezone, opts)`.

### O que ainda pode ter pt-BR fixo
- Alguns pontos em **gerenciar-viagens/js/script.js** (ex.: `toLocaleString('pt-BR')` em logs ou listas).
- **grid-editor.js:** `toLocaleDateString('pt-BR')`, `toLocaleString('pt-BR', ...)`.
- **viagemmestre.controller.js:** formatação manual para pt-BR nas mensagens e `toLocaleString('pt-BR', ...)` para moeda no envio de convocações.
- Revisão pontual: onde ainda houver `'pt-BR'` ou `'America/Sao_Paulo'` fixo, trocar para variável de contexto quando o dado for exibido ao usuário.

---

## 8. Resumo de pendências por prioridade

### Alta (impacto direto no usuário final)
1. **WhatsApp:** Definir e implementar idioma das mensagens (país ou campo idioma do motorista).
2. **App Motorista:** Checagem visual em todas as telas (pt-BR e es-PY) e correção de textos fixos que restarem.
3. **Convocação (página pública):** Garantir que i18n-web carrega e que `applyI18nWeb()` é chamado para traduzir a página.

### Média (melhora experiência no painel)
4. **Web:** Checagem visual nos módulos e substituição de textos em JS por `tWeb('chave')`.
5. **Formatação:** Substituir `pt-BR` fixo por contexto (locale/timezone) nos pontos que exibem data/moeda ao usuário.

### Baixa (incremental)
6. **Backend:** Incluir `errorKey` nas respostas de erro das demais APIs e usar no front com `tWeb(errorKey)`.
7. **Convocação:** Idioma por URL ou preferência do navegador para quem acessa sem login.

---

## 9. Arquivos de referência

| Tema | Arquivo |
|------|---------|
| Pendências i18n (listagem anterior) | `docs/PENDENCIAS_I18N_WEB_E_APP.md` |
| Plano multimoeda/multilíngua | `docs/PLANO_MULTIMOEDA_MULTILINGUA_MULTIDOCUMENTO.md` |
| Idioma no motorista e WhatsApp | `backend/public/motorista/RESUMO_IDIOMA_E_MENSAGENS.md` |
| Locales (único par para motorista e web) | `backend/public/motorista/locales/pt-BR.json`, `es-PY.json` |
| i18n app motorista | `backend/public/motorista/js/i18n.js` |
| i18n web | `backend/public/js/i18n-web.js` |
| Mensagens WhatsApp | `backend/controllers/viagemmestre.controller.js` (trechos indicados no RESUMO_IDIOMA) |

---

*Documento gerado para servir de checklist e priorização do que ainda falta ajustar em relação a idioma (pt-BR / es-PY) no sistema.*
