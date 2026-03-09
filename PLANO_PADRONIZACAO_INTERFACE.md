# 🎨 Plano de Padronização de Interface

## 📋 Objetivo

Padronizar todas as telas do sistema seguindo o padrão visual e funcional da tela de **Alertas**, que serve como referência de excelência.

---

## ✅ Padrão de Referência: Módulo Alertas

### Elementos Visuais
- ✅ Cards brancos com sombras suaves
- ✅ Bordas coloridas à esquerda (indicadores visuais)
- ✅ Badges coloridos para status/tipos
- ✅ Ícones Boxicons consistentes
- ✅ Tipografia clara e hierárquica
- ✅ Espaçamento harmonioso
- ✅ Botões com estados hover/active

### Funcionalidades
- ✅ Cards de estatísticas no topo
- ✅ Seção de filtros completa e funcional
- ✅ Lista de itens em cards
- ✅ Paginação
- ✅ Modais para ações
- ✅ Loading states
- ✅ Mensagens de feedback
- ✅ Botão de ajuda/documentação

### Estrutura HTML
- ✅ Sem tags `<html>`, `<head>`, `<body>` (fragmento)
- ✅ CSS modular e organizado
- ✅ JavaScript bem documentado
- ✅ Funções globais para ações

---

## 📊 Módulos a Padronizar

### 1. ✅ Alertas (REFERÊNCIA)
- Status: **Concluído** - Serve como padrão
- Arquivo: `backend/public/modulos/alertas/index.html`

### 2. 🔄 SOS (EM ANDAMENTO)
- Status: **Implementando agora**
- Arquivo: `backend/public/modulos/sos/index.html`

### 3. ⏳ Chat
- Status: **Pendente**
- Arquivo: `backend/public/modulos/chat/index.html`

### 4. ⏳ Ranking
- Status: **Pendente**
- Arquivo: `backend/public/modulos/ranking/index.html`

### 5. ⏳ Gerenciar Viagens
- Status: **Pendente** - Revisar e padronizar
- Arquivo: `backend/public/modulos/gerenciar-viagens/index.html`

### 6. ⏳ Outros Módulos
- Status: **Pendente** - Avaliar necessidade

---

## 🎯 Checklist de Padronização

Para cada módulo, aplicar:

### Estrutura
- [ ] Header com título e botões de ação
- [ ] Cards de estatísticas (se aplicável)
- [ ] Seção de filtros (se aplicável)
- [ ] Lista de itens em cards
- [ ] Paginação (se aplicável)
- [ ] Modais para ações

### Visual
- [ ] Cards brancos com `box-shadow: 0 2px 8px rgba(0,0,0,0.1)`
- [ ] Bordas coloridas à esquerda (`border-left: 4px solid`)
- [ ] Badges com cores consistentes
- [ ] Botões com classes padrão (`.btn`, `.btn-primary`, `.btn-secondary`)
- [ ] Ícones Boxicons
- [ ] Espaçamento: `padding: 20px`, `gap: 15px`

### Funcionalidades
- [ ] Filtros funcionais
- [ ] Loading states
- [ ] Mensagens de feedback
- [ ] Validações
- [ ] Tratamento de erros
- [ ] WebSocket (se aplicável)

### Código
- [ ] CSS organizado e comentado
- [ ] JavaScript documentado (JSDoc)
- [ ] Funções globais para ações
- [ ] Autenticação em todas as requisições
- [ ] Tratamento de erros consistente

---

## 📝 Próximos Passos

1. ✅ **SOS** - Implementar agora (seguindo padrão Alertas)
2. ⏳ **Chat** - Implementar após SOS
3. ⏳ **Ranking** - Implementar após Chat
4. ⏳ **Revisar outros módulos** - Avaliar necessidade de padronização

---

## 🎨 Guia de Cores Padrão

### Status
- **Pendente:** `#e74c3c` (vermelho)
- **Em Análise:** `#f39c12` (laranja)
- **Tratado/Resolvido:** `#2ecc71` (verde)
- **Cancelado:** `#95a5a6` (cinza)

### Prioridades
- **Urgente:** `#e74c3c` (vermelho)
- **Alta:** `#f39c12` (laranja)
- **Normal:** `#3498db` (azul)
- **Baixa:** `#95a5a6` (cinza)

### Botões
- **Primary:** `#3498db` (azul)
- **Secondary:** `#95a5a6` (cinza)
- **Success:** `#2ecc71` (verde)
- **Danger:** `#e74c3c` (vermelho)
- **Info:** `#17a2b8` (azul claro)

---

## 📚 Documentação

Cada módulo padronizado deve ter:
- ✅ Documentação técnica (como funciona)
- ✅ Guia de testes
- ✅ Instruções de uso (botão Ajuda)

---

**Última atualização:** 2026-01-18
**Status:** Em andamento - SOS sendo implementado
