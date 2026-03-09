# 🔄 Guia de Migração Gradual para Dexie.js

**Versão:** 1.0  
**Data:** 2026-01-16  
**Status:** Opcional - Sistema atual (IndexedDB nativo) funciona perfeitamente

---

## 📋 Quando Migrar para Dexie?

Migre para Dexie.js se você quiser:
- ✅ API mais simples e intuitiva
- ✅ Melhor tratamento de erros
- ✅ Suporte a transações mais robustas
- ✅ Melhor performance em operações complexas

**O sistema atual (IndexedDB nativo) funciona perfeitamente.** Esta migração é **opcional**.

---

## 🚀 Migração Gradual

### Opção 1: Migração Completa (Recomendado para novos projetos)

1. **Substituir offline.js por offline-dexie.js**

   Em todas as páginas que usam `offline.js`, substitua:
   ```html
   <!-- ANTES -->
   <script src="../js/offline.js"></script>
   
   <!-- DEPOIS -->
   <script type="module" src="../js/offline-dexie.js"></script>
   ```

2. **Páginas que precisam ser atualizadas:**
   - `pages/dashboard.html`
   - `pages/viagens.html`
   - `pages/chat.html`
   - `pages/gps.html`
   - `pages/enviar-posicao.html`
   - `pages/macros.html`
   - `pages/comprovar-entrega.html`
   - `pages/convocacoes.html`
   - `pages/eventos.html`
   - `pages/cargas.html`
   - `pages/rastreamento.html`
   - `pages/sos.html`

3. **Atualizar Service Worker**

   No `sw-workbox.js`, atualize a referência:
   ```javascript
   // ANTES
   { url: '/motorista/js/offline.js', revision: '3' },
   
   // DEPOIS
   { url: '/motorista/js/offline-dexie.js', revision: '4' },
   ```

### Opção 2: Migração Gradual (Página por Página)

1. **Testar em uma página específica primeiro**

   Escolha uma página menos crítica (ex: `diagnostico.html`) e substitua:
   ```html
   <script type="module" src="../js/offline-dexie.js"></script>
   ```

2. **Testar funcionalidades:**
   - Cache de dados
   - Fila de GPS
   - Fila de eventos
   - Fila de mensagens
   - Sincronização

3. **Se funcionar bem, migrar outras páginas gradualmente**

### Opção 3: Usar Ambos (Híbrido)

Manter `offline.js` para páginas críticas e usar `offline-dexie.js` em páginas novas ou menos críticas.

---

## ✅ Checklist de Migração

- [ ] Backup dos arquivos feito
- [ ] Testado em ambiente de desenvolvimento
- [ ] Todas as páginas atualizadas (se migração completa)
- [ ] Service Worker atualizado
- [ ] Funcionalidades testadas:
  - [ ] Cache de dados
  - [ ] Fila de GPS
  - [ ] Fila de eventos
  - [ ] Fila de mensagens
  - [ ] Fila de comprovantes
  - [ ] Fila SOS
  - [ ] Sincronização automática
- [ ] Testado offline
- [ ] Testado online
- [ ] Performance verificada

---

## 🔙 Reverter Migração

Se quiser voltar ao sistema anterior:

1. Substitua de volta `offline-dexie.js` por `offline.js` em todas as páginas
2. Atualize o Service Worker de volta
3. Limpe o cache do navegador
4. Recarregue as páginas

---

## 📊 Comparação

| Recurso | IndexedDB Nativo | Dexie.js |
|---------|------------------|----------|
| API | Mais verbosa | Mais simples |
| Performance | Boa | Boa |
| Tratamento de Erros | Manual | Automático |
| Transações | Complexas | Simples |
| Compatibilidade | Nativa | Biblioteca externa |
| Tamanho | 0 KB | ~50 KB (CDN) |

---

**Nota:** O sistema atual (`offline.js`) continua disponível e pode ser usado a qualquer momento. A migração é completamente reversível.
