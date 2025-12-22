# 🗺️ Como Alterar o Servidor de Mapas

## 📍 Localização do Arquivo de Configuração

**Arquivo:** `backend/public/js/map-config.js`

**Linha para alterar:** Linha 18 (aproximadamente)

---

## ⚙️ Como Alterar

### Opção 1: Usar Servidor Público OpenStreetMap (RECOMENDADO - Funciona sempre)

No arquivo `backend/public/js/map-config.js`, linha 18:

```javascript
tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
```

**Vantagens:**
- ✅ Funciona com HTTPS (sem erros SSL)
- ✅ Sempre disponível
- ✅ Gratuito

**Desvantagens:**
- ⚠️ Pode ser mais lento que servidor próprio
- ⚠️ Pode ter limitações de uso

---

### Opção 2: Usar Servidor Próprio (HTTP)

No arquivo `backend/public/js/map-config.js`, linha 15:

```javascript
tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
```

**Vantagens:**
- ✅ Mais rápido (servidor próprio)
- ✅ Sem limitações de uso

**Desvantagens:**
- ❌ Só funciona com HTTP (não HTTPS)
- ❌ Navegadores podem bloquear (mixed content)
- ❌ Pode ter erros `ERR_SSL_PROTOCOL_ERROR`

---

### Opção 3: Servidor Alternativo

No arquivo `backend/public/js/map-config.js`, linha 20:

```javascript
tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
```

---

## 🔧 Passos para Alterar

1. Abra o arquivo: `backend/public/js/map-config.js`
2. Localize a linha com `tileServer:`
3. Descomente a opção desejada (remova `//` no início)
4. Comente as outras opções (adicione `//` no início)
5. Salve o arquivo
6. Recarregue a página (Ctrl+Shift+R para hard refresh)

---

## 📝 Exemplo de Configuração

```javascript
window.MAP_CONFIG = {
  // OPÇÃO 1: Servidor próprio (HTTP) - Mais rápido, mas pode ter problemas
  // tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
  
  // OPÇÃO 2: Servidor público OpenStreetMap (HTTPS) - Funciona sempre
  tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  
  // OPÇÃO 3: Servidor alternativo (HTTPS)
  // tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  
  // ... resto da configuração
};
```

---

## ⚠️ Importante

- Se usar servidor próprio (HTTP), o navegador pode bloquear em páginas HTTPS
- Se usar servidor público (HTTPS), funciona sempre, mas pode ser mais lento
- Após alterar, sempre faça hard refresh (Ctrl+Shift+R) para limpar cache

---

## 🐛 Problemas Comuns

### Erro: `ERR_SSL_PROTOCOL_ERROR`
**Causa:** Navegador tentando usar HTTPS em servidor que só aceita HTTP  
**Solução:** Use servidor público (HTTPS) ou configure o servidor próprio para aceitar HTTPS

### Mapas não aparecem
**Causa:** Cache do navegador ou Service Worker  
**Solução:** 
1. Desregistre o Service Worker (DevTools > Application > Service Workers > Unregister)
2. Limpe o cache (Ctrl+Shift+Delete)
3. Faça hard refresh (Ctrl+Shift+R)

---

## 📞 Suporte

Se precisar de ajuda, verifique:
1. Console do navegador (F12) para erros
2. Network tab para ver requisições de tiles
3. Se o arquivo `map-config.js` está sendo carregado corretamente
