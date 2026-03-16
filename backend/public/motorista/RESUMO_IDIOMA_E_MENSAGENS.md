# Resumo: Idioma no app motorista e nas mensagens WhatsApp

**Data:** 06/03/2026  
**Objetivo:** Fechar o dia com status de i18n no diretório `/motorista/` e orientação sobre idioma no envio de mensagens para produção.

---

## 1. App motorista (`http://localhost:3000/motorista/`) – IDIOMA (i18n)

### O que está tratado

- **`index.html` (tela de login):**  
  - Tem `data-i18n` em todos os textos visíveis (titulo, descrição, CPF, senha, botões, links, footer).  
  - Carrega `js/i18n.js` dinamicamente e aplica traduções quando `i18nReady` resolve.  
  - Seletor de idioma (Português / Español) salva em `localStorage.preferredLocale` e recarrega a página.

- **Páginas em `pages/`:**  
  As seguintes páginas têm **ao menos** `data-i18n` ou `i18n.js` (e na maioria dos casos ambos):
  - `cadastro.html`, `recuperar-senha.html`, `dashboard.html`, `convocacoes.html`, `cargas.html`, `viagens.html`
  - `configuracoes.html`, `configuracoes-notificacoes.html`, `detalhes-viagem.html`
  - `gps.html`, `gps-visualizacao.html`, `ajuda-gps.html`, `rastreamento.html`, `comprovar-entrega.html`
  - `macros.html`, `eventos.html`, `enviar-posicao.html`, `diagnostico.html`
  - `chat.html`, `chat-standalone.html`, `sos.html`

- **Locales:**  
  - `locales/pt-BR.json` e `locales/es-PY.json` existem e têm chaves para login, common, dashboard, cadastro, viagens, convocações, etc.

- **`js/i18n.js`:**  
  - Lê locale de `/api/contexto` ou `localStorage.preferredLocale`; suporta `pt-BR` e `es-PY`; expõe `t()`, `getI18nLocale()`, `setPreferredLocale()`, `getPreferredLocale()`.

### Recomendação antes de produção

- Fazer um **passo rápido em cada tela** (login + todas as páginas listadas acima): abrir em pt-BR e em es-PY e conferir se não restou texto fixo em português (títulos, botões, labels, placeholders, mensagens de erro/alerta).
- Se encontrar alguma string fixa, colocá-la em `data-i18n` (ou `t()` no JS) e adicionar a chave em `pt-BR.json` e `es-PY.json`.

**Conclusão:** A base de i18n no diretório do motorista está pronta; a recomendação é essa checagem visual rápida para garantir que tudo esteja de fato traduzido antes de subir para produção.

---

## 2. Envio de mensagens (WhatsApp) – IDIOMA

### Situação atual

No processo de envio das mensagens **não há nada tratado por idioma do motorista**:

- **Convocações (criar/enviar):**  
  Texto fixo em português: “Olá *…*, como está? Você está sendo convocado…”, “CARGA DISPONÍVEL”, “HORÁRIOS”, “CONTRATADOR”, “VALORES”, “Frete”, “ton”, “m³”, etc.  
  Datas e valor de frete são formatados com `toLocaleString('pt-BR', ...)` (moeda) e formatação manual em estilo pt-BR.

- **Confirmação (motorista selecionado):**  
  Texto fixo em português: “PARABÉNS! Você foi selecionado!”, “Sua convocação foi CONFIRMADA!”, “Aguarde o contato do nosso time…”, “Obrigado pela parceria!”.

- **Não selecionado (ACEITA_DESCARTADA):**  
  Texto fixo em português: “Olá *…*, para a viagem *…* outro motorista foi selecionado…”, “Agradecemos seu interesse…”, “Obrigado pela parceria!”.

Ou seja: **todas as mensagens enviadas hoje estão em português**, independentemente do cadastro ou do país do motorista.

---

## 3. Como decidir o idioma das mensagens

Sua dúvida: usar **idioma padrão do país** (Cadastro Geral → Identificação → País) ou **um campo de idioma** no cadastro (ex.: brasileiro no Paraguai, paraguaio no Brasil).

### Opção A – Inferir pelo **País** do cadastro

- **Onde está o país:**  
  Cadastro Geral (Gerenciar Cadastro Geral → Editar Cadastro → Identificação) usa o campo **País** da tabela `CADASTROGERAL` (coluna `PAIS`, sigla: BR, PY, AR, UY, etc.).

- **Como usar:**  
  No backend, ao montar o texto da mensagem (convocação, confirmação, não selecionado), buscar o `PAIS` do motorista (da convocação/cadastro) e escolher:
  - BR → textos e formatação em **pt-BR**
  - PY, AR, UY, etc. → textos e formatação em **es-PY** (ou es-AR se quiser diferenciar depois)

- **Prós:**  
  Não precisa alterar tela nem banco; só regra no backend.  
  Cobre bem o caso “motorista do país X recebe no idioma do país X”.

- **Contras:**  
  Brasileiro morando no Paraguai (país cadastrado PY) receberia em espanhol.  
  Paraguaio morando no Brasil (país BR) receberia em português.

### Opção B – Campo **Idioma preferido** no cadastro

- **Onde:**  
  Novo campo (ex.: “Idioma” ou “Locale”) em:
  - `CADASTROGERAL`, ou  
  - `MOTORISTA_COMPLEMENTO`  
  Valores sugeridos: `pt-BR`, `es-PY` (e no futuro `es-AR`, etc.).

- **Tela:**  
  Gerenciar Cadastro Geral → Editar Cadastro → Identificação (ou uma seção “Preferências”) com combo: Português (pt-BR), Español (es-PY), etc.

- **Como usar:**  
  Ao montar a mensagem, usar o **idioma do cadastro** do motorista. Se estiver vazio, cair no **país** (como na opção A) ou no idioma padrão da instalação (`CONFIGURACAO.idioma_padrao`).

- **Prós:**  
  Resolve exatamente “brasileiro no Paraguai” (idioma pt-BR) e “paraguaio no Brasil” (idioma es-PY).  
  Mensagens e app ficam alinhados ao que o motorista prefere.

- **Contras:**  
  Exige migração (nova coluna), ajuste na tela de cadastro e na API que retorna/grava o cadastro.

### Recomendação

- **Curto prazo (produção amanhã):**  
  Pode subir **sem** alterar o envio de mensagens: tudo continua em português. O app motorista já pode ser usado em pt-BR e es-PY; as mensagens WhatsApp ficam em pt-BR até você implementar a escolha de idioma.

- **Próximo passo (após produção):**  
  Se a maioria dos motoristas for do mesmo país/idioma, **Opção A** (inferir pelo país) é rápida e já melhora bastante.  
  Se você já tem (ou espera) muitos casos “brasileiro no Paraguai” ou “paraguaio no Brasil”, vale a pena **Opção B** (campo idioma no cadastro), usando país apenas como fallback quando o campo estiver vazio.

---

## 4. Onde está o código das mensagens (para quando for implementar)

- **Arquivo:** `backend/controllers/viagemmestre.controller.js`
- **Convocações (envio em massa):** trecho que monta `textoWhatsApp` (por volta das linhas 4190–4231): saudação, “CARGA DISPONÍVEL”, horários, valores, link. Hoje usa `toLocaleString('pt-BR', ...)` para moeda e formatação manual de data em pt-BR.
- **Confirmação (selecionado):** por volta das linhas 2269–2296: montagem de `textoMensagem`.
- **Não selecionado:** por volta das linhas 2335–2338: montagem de `textoNaoSelecionado`.

Para implementar por idioma:

1. Na hora de montar cada um desses textos, obter o **locale** do motorista:
   - **Opção A:** buscar `PAIS` do cadastro (CONVOCACAO → CDCADASTRO_MOTORISTA → CADASTROGERAL.PAIS) e mapear BR → pt-BR, PY/AR/UY → es-PY (ou es-AR).
   - **Opção B:** buscar o campo de idioma do cadastro (ou MOTORISTA_COMPLEMENTO); se vazio, fallback para país ou para `idioma_padrao` da CONFIGURACAO.
2. Ter conjuntos de strings (templates) por locale (pt-BR, es-PY) para cada mensagem.
3. Usar o locale também na formatação de data e moeda (ex.: `toLocaleString(locale, ...)`).

---

## 5. Respostas diretas

| Pergunta | Resposta |
|----------|----------|
| Tudo no diretório `/motorista/` está tratado em relação ao idioma? | A **estrutura** de i18n está: index e páginas usam `i18n.js` e `data-i18n`, e existem `pt-BR.json` e `es-PY.json`. Recomenda-se uma **verificação visual rápida** em cada tela (pt-BR e es-PY) antes de produção para garantir que não restou texto fixo. |
| O envio das mensagens tem algo tratado por idioma? | **Não.** Todas as mensagens (convocação, confirmação, não selecionado) estão em português fixo e com formatação pt-BR. |
| Usar idioma padrão do país do cadastro ou campo no cadastro? | **País:** rápido, sem mudança de tela/banco; não cobre “brasileiro no PY” / “paraguaio no BR”. **Campo idioma no cadastro:** cobre esses casos; exige nova coluna e tela. Recomendação: para amanhã pode deixar como está; depois implementar por país e, se precisar, adicionar campo de idioma com fallback em país. |

Se quiser, no próximo passo podemos: (1) listar tela a tela os trechos que ainda podem estar sem i18n, ou (2) esboçar a alteração no `viagemmestre.controller.js` para usar o país (ou o futuro campo idioma) na montagem das mensagens.
