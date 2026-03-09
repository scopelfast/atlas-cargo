# Pendências de i18n (idioma PT/ES) – Web e App Motorista

Resumo do que **já tem** e do que **ainda falta** para tradução (português / espanhol).

---

## App Motorista

### Já ajustados (com `i18n.js` + `applyI18n` + chaves nos locales)
- **Login** (`index.html`)
- **Dashboard** (`pages/dashboard.html`)
- **Viagens** (`pages/viagens.html`)
- **Convocações** (`pages/convocacoes.html`)
- **Cargas** (`pages/cargas.html`)
- **Configurações** (`pages/configuracoes.html`)
- **Cadastro** (`pages/cadastro.html`)
- **Recuperar senha** (`pages/recuperar-senha.html`)
- **Macros** (`pages/macros.html`)
- **SOS** (`pages/sos.html`)
- **Enviar posição** (`pages/enviar-posicao.html`)
- **Detalhes da viagem** (`pages/detalhes-viagem.html`)
- **Comprovar entrega** (`pages/comprovar-entrega.html`)
- **GPS** (`pages/gps.html`)
- **Rastreamento** (`pages/rastreamento.html`)
- **Chat** (`pages/chat.html`)
- **Ajuda GPS** (`pages/ajuda-gps.html`)
- **Chat standalone** (`pages/chat-standalone.html`)
- **Configurações de notificações** (`pages/configuracoes-notificacoes.html`)
- **Diagnóstico** (`pages/diagnostico.html`)
- **GPS visualização** (`pages/gps-visualizacao.html`)
- **Eventos** (`pages/eventos.html`)

### Faltando (sem i18n)
Nenhuma página do app motorista pendente.

**Total faltando no app:** 0 páginas.

---

## Web (painel administrativo)

### Já ajustados
- **Login web** (`public/index.html`) – i18n-web + seletor de idioma.
- **Dashboard** (`public/dashboard.html`) – i18n-web; conteúdo inicial, menu lateral, header e botões traduzidos.
- **Gerenciar Cidades** (`modulos/gerenciar-cidades/`) – Lote 1.
- **Gerenciar Tipos Validade** (`modulos/gerenciar-tipos-validade/`) – Lote 1.
- **Gerenciar Marcas** (`modulos/gerenciar-marcas/`) – Lote 1.
- **Gerenciar Tipos Equipamento** (`modulos/gerenciar-tipos-equipamento/`) – Lote 2.
- **Gerenciar Modelos Equipamento** (`modulos/gerenciar-modelos-equipamento/`) – Lote 2.
- **Gerenciar Grupos** (`modulos/gerenciar-grupos/`) – Lote 2.
- **Gerenciar Equipamentos** (`modulos/gerenciar-equipamentos/`) – Lote 3.
- **Gerenciar Classes Frota** (`modulos/gerenciar-classes-frota/`) – Lote 3.
- **Gerenciar Tipos Viagem** (`modulos/gerenciar-tipos-viagem/`) – Lote 3.
- **Gerenciar Situações Viagem** (`modulos/gerenciar-situacoes-viagem/`) – Lote 3.
- **Gerenciar Roteiros** (`modulos/gerenciar-roteiros/`) – Lote 4.
- **Gerenciar Viagens** (`modulos/gerenciar-viagens/`) – Lote 4.
- **Relatório Convocações** (`modulos/relatorio-convocacoes/`) – Lote 4.
- **Gerenciar Cadastro Geral** (`modulos/gerenciar-cadastro-geral/`) – Lote 4.
- **Gerenciar Logs Acesso** (`modulos/gerenciar-logs-acesso/`) – Lote 5.
- **Gerenciar Usuários** (`modulos/gerenciar-usuarios/`) – Lote 5.
- **Gerenciar Empresas** (`modulos/gerenciar-empresas/`) – Lote 5.
- **Gerenciar Filiais** (`modulos/gerenciar-filiais/`) – Lote 5.
- **Gerenciar Configurações** (`modulos/gerenciar-configuracoes/`) – Lote 6.
- **Alertas** (`modulos/alertas/`) – Lote 6.
- **Chat** (`modulos/chat/`) – Lote 6.
- **Ranking** (`modulos/ranking/`) – Lote 6.
- **SOS** (`modulos/sos/`) – Lote 7.
- **Gerenciar Mapa Viagem** (`modulos/gerenciar-mapa-viagem/`) – Lote 7.
- **Gerenciar Tipos Atividade** (`modulos/gerenciar-tipos-atividade/`) – Lote 7.

### Faltando (módulos carregados no iframe/área de conteúdo)
Nenhum módulo web pendente.

**Total na web:** 27 com i18n (login, dashboard + 25 módulos: cidades, tipos-validade, marcas, tipos-equipamento, modelos-equipamento, grupos, equipamentos, classes-frota, tipos-viagem, situacoes-viagem, roteiros, viagens, relatorio-convocacoes, cadastro-geral, logs-acesso, usuarios, empresas, filiais, configuracoes, alertas, chat, ranking, sos, mapa-viagem, tipos-atividade); **0 módulos** faltando.

**Para retomar em nova sessão:** i18n dos módulos web concluído (Lotes 1–7). Próximos passos possíveis: backend (errorKey, Accept-Language), formatação por locale, ou outros itens do plano.

---

## O que fazer em cada tipo de tela

### App Motorista (páginas faltantes)
1. Incluir no `<head>`: `<script src="../js/i18n.js"></script>`.
2. No script da página: definir `applyI18n()` (percorrer `[data-i18n]` e `[data-i18n-title]` com `window.t`) e chamar `window.i18nReady.then(applyI18n)`.
3. Colocar `data-i18n="chave"` (e `data-i18n-title` onde fizer sentido) nos textos fixos (títulos, botões, labels, mensagens).
4. Nos locales `motorista/locales/pt-BR.json` e `es-PY.json`: criar/ampliar as chaves usadas (ex.: `enviarPosicao.*`, `gps.*`, `detalhesViagem.*`, `comprovarEntrega.*`, etc.).
5. Textos gerados por JS: usar `window.t('chave')` ao montar o HTML (ou reaplicar `applyI18n()` depois de inserir no DOM).

### Web (módulos)
1. Carregar o mesmo i18n da web: `i18n-web.js` (já usado no dashboard), garantindo que o script seja carregado no contexto do módulo (ex.: pelo layout do dashboard ao injetar o iframe/conteúdo).
2. Nos módulos: usar `window.tWeb('chave')` para textos e, onde possível, `data-i18n` + `applyI18nWeb()` após carregar o conteúdo.
3. Criar/ampliar em `motorista/locales` (ou em locales específicos da web) as chaves por módulo (ex.: `web.modulos.gerenciarViagens.*`) e usá-las nos HTML/JS de cada módulo.

---

## Resumo numérico

| Área | Já com i18n | Faltando |
|------|-------------|----------|
| App Motorista (páginas) | 22 | 0 |
| Web – telas principais | 2 (login + dashboard) | 0 |
| Web – módulos | 25 (todos os listados acima + sos, mapa-viagem, tipos-atividade) | 0 |

Este arquivo pode ser usado como checklist para fechar as pendências de i18n.
