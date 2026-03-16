# Status do padrão de UI nos módulos

Referência de **o que já foi feito** e **o que ainda falta** para alinhar todos os programas ao padrão (overlays, botões da aba Filtros, dark mode).  
Padrão detalhado: `.cursor/rules/padrao-ui-modulos.mdc`.  
Modelo de modernização futuro: `docs/REDESIGN_ATLAS_CARGO_RECOMENDACOES.md`.

---

## Já alinhados (referência / concluídos)

| Módulo | Overlay + rAF | Filtros (padrão) | Dark mode |
|--------|----------------|------------------|-----------|
| **Gerenciar Situações de Viagem** | ✅ | ✅ (referência) | ✅ |
| **Gerenciar Cidades** | ✅ (overlay + requestAnimationFrame duplo antes do fetch) | ✅ | ✅ |
| **Gerenciar Viagens** | ✅ (Filtros, InitSQL, Mapa, Rastreamento) | ✅ | ✅ (Histórico, Switch Digital, Macros) |
| **Gerenciar Filiais** | ✅ (InitSQL + rAF) | ✅ (Limpar/Filtrar/Novo + grid) | ✅ (container, header, filtros-box global) |
| **Gerenciar Usuários** | ✅ (InitSQL + rAF) | ✅ (Limpar/Filtrar/Novo + grid + Dados) | ✅ (container, form-box, filtros-box) |

---

## O que falta por módulo

### 1. Overlay: yield antes do fetch (requestAnimationFrame duplo)

Quem **tem** `calculando-overlay` mas **não tem** o `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));` antes do fetch pode não pintar o overlay antes da requisição. Ajustar no `script.js` de cada um:

- **Gerenciar Classes Frota**
- **Gerenciar Cadastro Geral** (loadingOverlay + loadingOverlayInitSQL)
- **Gerenciar Roteiros** (calculandoOverlay + loadingOverlayInitSQL + mapaLoadingOverlay)
- ~~**Gerenciar Usuários**~~ (concluído)
- **Gerenciar Equipamentos**
- **Gerenciar Marcas**
- **Gerenciar Grupos**
- **Gerenciar Empresas**
- **Gerenciar Modelos Equipamento**
- **Gerenciar Tipos Viagem**
- **Gerenciar Tipos Validade**
- **Gerenciar Tipos Equipamento**
- **Gerenciar Situações de Viagem** (InitSQL)
- **Gerenciar Mapa Viagem**
- **Gerenciar Tipos Atividade**

Ou seja: em todo lugar que chama `showLoadingOverlay()` / equivalente e em seguida faz `fetch`, inserir o yield antes do fetch e esconder no `finally`.

---

### 2. Aba Filtros: botões no padrão (e remover classe extra)

- **Gerenciar Cadastro Geral**  
  - Tem `filtros-actions filtros-actions-moderno` → remover `filtros-actions-moderno` e garantir ícones bx-x (Limpar), bx-search (Filtrar), bx-plus (Novo) como em Gerenciar Situações de Viagem.  
  - Verificar dark mode dos botões em `dark-mode.css` (especificidade para `.cadastro-geral-container` ou equivalente).

Os demais que têm `filtros-actions` (Grupos, Roteiros, Viagens, Cidades, Tipos Validade, Tipos Equipamento, Modelos Equipamento, Marcas, Classes Frota, Equipamentos, Tipos Viagem, Usuários, Empresas, Filiais, Logs Acesso, Mapa Viagem, Tipos Atividade, Alertas, SOS, Relatório Convocações) já usam a estrutura; conferir em cada um se os três botões (Limpar / Filtrar / Novo) têm as classes e ícones do padrão e se no dark mode estão cobertos por regras em `dark-mode.css`.

---

### 3. Dark mode: painéis / tabelas / barras sem fundo branco

O `dark-mode.css` já cobre containers e headers de vários módulos. Falta garantir em cada módulo:

- Nenhum painel, barra de totais ou tabela com fundo branco no dark.
- Se algum elemento ficar branco por inline ou ordem de CSS, usar regras mais específicas em `dark-mode.css` ou aplicar estilos via JS (como `aplicarDarkModeMacros()` em Gerenciar Viagens) quando `data-theme="dark"`.

Módulos com mais abas / painéis (ex.: **Gerenciar Viagens**, **Gerenciar Roteiros**, **Gerenciar Cadastro Geral**, **Alertas**, **SOS**, **Chat**, **Ranking**, **Relatório Convocações**, **Gerenciar Configurações**, **Gerenciar Logs Acesso**) devem ser revisados em dark mode para listas, cards, tabelas e barras de resumo.

---

### 4. Código a evitar

- Em todo o projeto: **não** usar `querySelectorAll('> div')`; usar `Array.from(el.children).filter(el => el.tagName === 'DIV')` ou `el.querySelectorAll(':scope > div')`.  
  Já corrigido em Gerenciar Viagens (`aplicarDarkModeMacros`).

---

## Resumo rápido

| Tipo de ajuste | Onde |
|----------------|------|
| **Overlay + rAF** | 16 módulos listados em §1 (adicionar yield antes do fetch em cada `script.js`) |
| **Filtros padrão** | Cadastro Geral: remover `filtros-actions-moderno` e ícones/classes iguais ao Situações; outros: conferir ícones/classes e dark |
| **Dark mode** | Revisar todos os que têm tabelas/cards/barras (especialmente Viagens, Roteiros, Cadastro Geral, Alertas, SOS, Chat, Ranking, Relatório, Configurações, Logs) |
| **querySelectorAll** | Evitar `'> div'` em qualquer módulo novo ou em alterações |

Quando retomar, usar este arquivo e a regra `.cursor/rules/padrao-ui-modulos.mdc` para manter o padrão e o modelo de modernização (`REDESIGN_ATLAS_CARGO_RECOMENDACOES.md`).

---

## O que passar de comando para o Cursor

- **Continuar os ajustes em geral:**  
  *“Continua os ajustes do padrão UI dos módulos”* ou *“Siga o docs/PADRAO_UI_STATUS_MODULOS e faça o próximo item”*

- **Módulo específico:**  
  *“Alinha o [nome do módulo] ao padrão (overlay, filtros, dark)”*  
  Ex.: *“Alinha o Gerenciar Cadastro Geral ao padrão”*

- **Só um tipo de ajuste:**  
  *“Adiciona o requestAnimationFrame antes do fetch nos overlays dos módulos que faltam”*  
  *“Padroniza os botões da aba Filtros no Cadastro Geral”*

A regra `.cursor/rules/padrao-ui-modulos.mdc` está com `alwaysApply: true`, então o padrão (overlays, botões, dark mode, REDESIGN) já é considerado em toda conversa; este doc é a lista do que falta.
