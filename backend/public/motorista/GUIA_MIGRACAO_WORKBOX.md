# 🔄 Guia de Migração para Workbox (Opcional)

**Versão:** 1.0  
**Data:** 2026-01-16  
**Status:** Opcional - Sistema atual continua funcionando

---

## 📋 Quando Migrar?

Migre para Workbox se você quiser:
- ✅ Cache mais eficiente
- ✅ Sincronização automática quando conexão volta
- ✅ Melhor gerenciamento de cache
- ✅ Suporte a Background Sync

**O sistema atual funciona perfeitamente.** Esta migração é **opcional**.

---

## 🚀 Passo a Passo

### Passo 1: Fazer Backup

Antes de qualquer mudança, certifique-se de ter backup dos arquivos:
- `backend/public/motorista/sw.js` (atual)
- `backend/public/motorista/index.html` (se modificar)

### Passo 2: Atualizar Registro do Service Worker

No arquivo `backend/public/motorista/index.html`, encontre a linha 162:

```javascript
// ANTES
navigator.serviceWorker.register('/motorista/sw.js')
```

**Altere para:**

```javascript
// DEPOIS
navigator.serviceWorker.register('/motorista/sw-workbox.js')
```

### Passo 3: Adicionar Background Sync Manager

No mesmo arquivo (`index.html`), adicione o script **antes** de `auth.js`:

```html
<!-- ANTES do script auth.js (linha ~142) -->
<script src="/motorista/js/background-sync-manager.js"></script>
<script>
  // ... código existente ...
  loadScript('js/auth.js');
</script>
```

### Passo 4: Limpar Cache Antigo

1. Abra o DevTools (F12)
2. Vá para "Application" → "Service Workers"
3. Clique em "Unregister" no service worker atual
4. Vá para "Application" → "Cache Storage"
5. Delete caches antigos (opcional, mas recomendado)

### Passo 5: Testar

1. Recarregue a página
2. Abra o console (F12)
3. Deve aparecer:
   - `✅ Workbox carregado!`
   - `✅ Background Sync Manager inicializado`
   - `✅ Service Worker registrado`

### Passo 6: Verificar Funcionamento

1. **Teste de Cache:**
   - Abra uma página do app
   - Desative conexão (DevTools → Network → Offline)
   - Recarregue a página
   - Deve funcionar normalmente (servindo do cache)

2. **Teste de Background Sync:**
   - Desative conexão
   - Envie uma mensagem no chat
   - Ative conexão
   - Aguarde alguns segundos
   - A mensagem deve ser enviada automaticamente

---

## 🔙 Reverter Migração

Se quiser voltar ao sistema anterior:

1. No `index.html`, altere de volta:
   ```javascript
   navigator.serviceWorker.register('/motorista/sw.js')
   ```

2. Remova (ou comente) a linha do Background Sync Manager:
   ```html
   <!-- <script src="/motorista/js/background-sync-manager.js"></script> -->
   ```

3. Limpe o cache (Passo 4 acima)

4. Recarregue a página

---

## ✅ Checklist de Migração

- [ ] Backup dos arquivos feito
- [ ] Service Worker atualizado no `index.html`
- [ ] Background Sync Manager adicionado
- [ ] Cache antigo limpo
- [ ] Testes realizados
- [ ] Funcionamento verificado

---

**Nota:** O sistema atual (`sw.js`) continua disponível e pode ser usado a qualquer momento. A migração é completamente reversível.
