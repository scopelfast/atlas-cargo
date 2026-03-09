# 🗺️ Sistema de Mapas - Documentação

## 📁 Arquivos

### `map-helper.js` ⭐ **NOVO - USE ESTE!**
Sistema simplificado com uma única classe `MapHelper` que gerencia tudo.

**Como usar:**
```javascript
const mapa = window.MapHelper.initMap('containerId');
const rota = await window.MapHelper.calculateRoute(pontos);
```

**Vantagens:**
- ✅ Simples e direto
- ✅ Fallback automático
- ✅ HTTP/HTTPS tratado automaticamente
- ✅ Uma única classe

---

### `map-config.js` ⚠️ **LEGACY**
Arquivo antigo mantido apenas para compatibilidade.

**Status:** Deprecado - use `map-helper.js` para novas funcionalidades

---

## 🚀 Migração Rápida

### Antes:
```javascript
const config = window.MAP_CONFIG;
const osrmUrl = normalizarOSRMUrl(config.osrmServer);
// ... código complexo
```

### Agora:
```javascript
const rota = await window.MapHelper.calculateRoute(pontos);
```

---

## 📖 Documentação Completa

Veja: `GUIA_MAPAS_SIMPLES.md`

---

## 🔧 Configuração

Edite: `map-helper.js` (linhas 13-25)

---

**Última atualização:** 2026-01-13
