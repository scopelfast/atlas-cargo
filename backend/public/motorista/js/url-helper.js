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
    
    return originalFetch.call(this, urlToFetch, init);
  };
  
  console.log('✅ [URL HELPER] Inicializado. Base URL:', baseUrl);
})();

