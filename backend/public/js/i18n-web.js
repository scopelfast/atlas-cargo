// i18n para o painel web - usa mesma preferência (preferredLocale) e locales do motorista
(function() {
  var baseUrl = window.__BASE_URL__ || '';
  if (!baseUrl) {
    var pathBase = window.location.pathname;
    if (pathBase.endsWith('.html')) {
      var lastSlash = pathBase.lastIndexOf('/');
      pathBase = lastSlash > 0 ? pathBase.substring(0, lastSlash + 1) : '/';
    } else if (!pathBase.endsWith('/')) pathBase = pathBase + '/';
    baseUrl = window.location.protocol + '//' + window.location.host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
  }
  var localePath = baseUrl.replace(/\/$/, '') + '/motorista/locales';

  var messages = {};
  var resolveReady;
  var ready = new Promise(function(r) { resolveReady = r; });
  window.i18nWebReady = ready;

  function getNested(obj, key) {
    var parts = key.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
    return cur != null ? String(cur) : null;
  }

  window.tWeb = function(key) {
    var v = getNested(messages, key);
    return v != null ? v : key;
  };

  window.applyI18nWeb = function(root) {
    var el = root ? (root.querySelectorAll ? root : document) : document;
    var scope = root && root.querySelectorAll ? root : document;
    if (typeof window.tWeb !== 'function') return;
    scope.querySelectorAll('[data-i18n]').forEach(function(node) {
      var k = node.getAttribute('data-i18n');
      if (k) node.textContent = window.tWeb(k);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function(node) {
      var k = node.getAttribute('data-i18n-placeholder');
      if (k) node.placeholder = window.tWeb(k);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function(node) {
      var k = node.getAttribute('data-i18n-title');
      if (k) { node.title = window.tWeb(k); }
    });
  };

  function getPreferred() {
    try { return (localStorage.getItem('preferredLocale') || '').trim(); } catch (e) { return ''; }
  }

  function loadLocale(loc) {
    return fetch(localePath + '/' + loc + '.json')
      .then(function(res) { return res.ok ? res.json() : {}; })
      .then(function(data) {
        messages = data || {};
        try { document.documentElement.lang = (loc === 'es-PY' ? 'es' : 'pt-BR'); } catch (e) {}
        return messages;
      })
      .catch(function() { messages = {}; return messages; });
  }

  function init() {
    var preferred = getPreferred();
    if (preferred.toLowerCase() === 'es-py' || preferred === 'es-PY') preferred = 'es-PY';
    else if (preferred.toLowerCase() === 'pt-br' || preferred === 'pt-BR') preferred = 'pt-BR';
    else preferred = 'pt-BR'; // padrão quando vazio ou inválido

    loadLocale(preferred).then(function() {
      resolveReady();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
