// backend/public/motorista/js/i18n.js
// i18n Fase 0: carrega locale (pt-BR por padrão) e expõe t('chave')
// Atlas Cargo - Plano Multimoeda/Multilíngua

(function() {
  const origin = window.location.origin;
  const pathname = window.location.pathname || '';
  const baseUrl = window.__BASE_URL__ || (origin + (pathname.includes('/motorista') ? pathname.substring(0, pathname.indexOf('/motorista')) : pathname.includes('/mc') ? pathname.substring(0, pathname.indexOf('/mc')) : ''));
  // Sempre carregar locales do path canônico (evita 404 quando app está em /mc)
  const localePath = (pathname.includes('/mc') ? origin : (baseUrl.replace(/\/$/, ''))) + '/motorista/locales';

  let messages = {};
  let locale = 'pt-BR';
  let resolveReady;
  const ready = new Promise(function(r) { resolveReady = r; });
  window.i18nReady = ready;

  function getNested(obj, key) {
    const parts = key.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
    return cur != null ? String(cur) : null;
  }

  window.t = function(key) {
    const v = getNested(messages, key);
    return v != null ? v : key;
  };

  window.getI18nLocale = function() { return locale; };
  window.getI18nMessages = function() { return messages; };

  function loadLocale(loc) {
    return fetch(localePath + '/' + loc + '.json')
      .then(function(res) { return res.ok ? res.json() : {}; })
      .then(function(data) {
        messages = data || {};
        locale = loc;
        try { document.documentElement.lang = (loc === 'es-PY' ? 'es' : 'pt-BR'); } catch (e) {}
        return messages;
      })
      .catch(function() {
        messages = {};
        return messages;
      });
  }

  // Preferência do usuário (escolha no login); senão usa contexto do servidor
  window.setPreferredLocale = function(loc) {
    try { localStorage.setItem('preferredLocale', loc || ''); } catch (e) {}
    window.location.reload();
  };
  window.getPreferredLocale = function() {
    try { return localStorage.getItem('preferredLocale') || ''; } catch (e) { return ''; }
  };

  function init() {
    var raw = window.getPreferredLocale();
    var preferred = (typeof raw === 'string' && raw.trim()) ? raw.trim() : '';
    // Normalizar para os locales suportados (prioridade à escolha do usuário)
    if (preferred.toLowerCase() === 'es-py' || preferred === 'es-PY') {
      preferred = 'es-PY';
    } else if (preferred.toLowerCase() === 'pt-br' || preferred === 'pt-BR') {
      preferred = 'pt-BR';
    }
    if (preferred === 'pt-BR' || preferred === 'es-PY') {
      if (preferred === 'es-PY') window.__CONTEXTO_PAIS__ = 'PY';
      else window.__CONTEXTO_PAIS__ = 'BR';
      loadLocale(preferred).then(function() { resolveReady(); });
      return;
    }
    fetch(baseUrl.replace(/\/$/, '') + '/api/contexto')
      .then(function(res) { return res.ok ? res.json() : {}; })
      .then(function(ctx) {
        if (ctx && ctx.pais) window.__CONTEXTO_PAIS__ = ctx.pais;
        var loc = (ctx && ctx.locale) ? ctx.locale : 'pt-BR';
        return loadLocale(loc);
      })
      .catch(function() { return loadLocale('pt-BR'); })
      .then(function() {
        resolveReady();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
