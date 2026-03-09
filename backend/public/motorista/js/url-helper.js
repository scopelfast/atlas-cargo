// ============================================
// URL Helper - Correção automática de URLs para caminho base
// ============================================
// Este script deve ser incluído em todas as páginas do motorista
// para garantir que URLs relativas sejam corrigidas com o caminho base (/cargas/)
// ============================================

(function() {
  'use strict';
  
  // Se já foi inicializado, não fazer nada
  if (window.__URL_HELPER_INITIALIZED__) {
    return;
  }
  window.__URL_HELPER_INITIALIZED__ = true;
  
  // Detectar ambiente e caminho base
  const hostname = window.location.hostname;
  const protocoloAtual = window.location.protocol;
  const host = window.location.host;
  let pathBase = window.location.pathname;
  
  // Remover /motorista/ e tudo depois dele
  if (pathBase.includes('/motorista')) {
    const indexMotorista = pathBase.indexOf('/motorista');
    pathBase = pathBase.substring(0, indexMotorista);
  }
  
  if (!pathBase || pathBase === '') {
    pathBase = '/';
  }
  
  if (pathBase !== '/' && !pathBase.endsWith('/')) {
    pathBase = pathBase + '/';
  }
  
  const baseUrl = protocoloAtual + '//' + host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
  
  // Armazenar baseUrl globalmente
  window.__BASE_URL__ = baseUrl;

  // Sanitização XSS: escapar HTML ao exibir conteúdo do usuário
  window.escapeHtml = function(text) {
    if (text == null || typeof text !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };
  
  // Função global para corrigir URLs
  window.corrigirUrl = function(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    
    let baseUrl = window.__BASE_URL__;
    
    if (!baseUrl) {
      const pathname = window.location.pathname;
      let pathBase = '/';
      
      if (pathname.includes('/motorista')) {
        const indexMotorista = pathname.indexOf('/motorista');
        pathBase = pathname.substring(0, indexMotorista);
      }
      
      if (!pathBase || pathBase === '') pathBase = '/';
      if (pathBase !== '/' && !pathBase.endsWith('/')) pathBase = pathBase + '/';
      
      baseUrl = window.location.protocol + '//' + window.location.host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
      window.__BASE_URL__ = baseUrl;
    }
    
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const cleanUrl = url.startsWith('/') ? url : '/' + url;
    
    return cleanBaseUrl + cleanUrl;
  };
  
  // Interceptar todas as chamadas fetch para corrigir URLs automaticamente
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let urlToFetch = input;
    
    // Se input é uma string (URL), corrigir se necessário
    if (typeof input === 'string') {
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        urlToFetch = window.corrigirUrl(input);
        console.log(`🔧 [FETCH INTERCEPTOR] Corrigindo URL: ${input} → ${urlToFetch}`);
      }
    }
    // Se input é um Request object, criar novo com URL corrigida
    else if (input && typeof input === 'object' && input.url) {
      if (!input.url.startsWith('http://') && !input.url.startsWith('https://')) {
        const correctedUrl = window.corrigirUrl(input.url);
        console.log(`🔧 [FETCH INTERCEPTOR] Corrigindo Request URL: ${input.url} → ${correctedUrl}`);
        urlToFetch = new Request(correctedUrl, input);
      } else {
        urlToFetch = input;
      }
    }
    
    return originalFetch.call(this, urlToFetch, init).then(function(response) {
      // Se a API retornar 401 (token expirado ou inválido), fazer logout no app motorista
      if (response.status === 401) {
        const pathname = window.location.pathname || '';
        const isMotorista = pathname.indexOf('motorista') !== -1 || pathname.indexOf('chat-motorista-standalone') !== -1;
        const isLoginPage = pathname.endsWith('index.html') || pathname.endsWith('/motorista') || pathname.endsWith('/motorista/');
        var urlStr = typeof urlToFetch === 'string' ? urlToFetch : (urlToFetch && urlToFetch.url) ? String(urlToFetch.url) : '';
        var isApiCall = urlStr.indexOf('/api/') !== -1;
        if (isMotorista && !isLoginPage && isApiCall) {
          localStorage.removeItem('token');
          localStorage.removeItem('motorista');
          window.location.href = window.location.origin + '/motorista/index.html';
        }
      }
      return response;
    });
  };
  
  console.log('✅ [URL HELPER] Inicializado. Base URL:', baseUrl);

  // Aplicar tema (claro/escuro/auto) em todas as páginas que carregam este script
  (function aplicarTemaGlobal() {
    try {
      const tema = localStorage.getItem('tema') || 'claro';
      const escuro = tema === 'escuro' || (tema === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.body.classList.toggle('tema-escuro', escuro);
      if (tema === 'auto' && window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
          document.body.classList.toggle('tema-escuro', this.matches);
        });
      }
    } catch (e) { /* ignore */ }
  })();

  // Link "Ver en español" / "View in English" na navbar quando idioma salvo não é pt-BR
  (function linkIdiomaNavbar() {
    try {
      const idioma = localStorage.getItem('idioma') || 'pt-BR';
      if (idioma === 'pt-BR') return;
      const tl = idioma === 'es' ? 'es' : 'en';
      const label = tl === 'es' ? 'Ver en español' : 'View in English';
      const nav = document.querySelector('.navbar');
      if (!nav) return;
      if (nav.querySelector('.link-traduzir-pagina')) return;
      const a = document.createElement('a');
      a.href = 'https://translate.google.com/translate?hl=' + tl + '&sl=pt&tl=' + tl + '&u=' + encodeURIComponent(window.location.href);
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'link-traduzir-pagina';
      a.style.cssText = 'margin-left:auto;font-size:12px;color:rgba(255,255,255,0.95);text-decoration:none;white-space:nowrap;';
      a.textContent = label;
      nav.appendChild(a);
    } catch (e) { /* ignore */ }
  })();
})();

