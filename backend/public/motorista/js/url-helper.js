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

  // Modal padrão "Sessão encerrada" (quando notifications.js não está carregado ou não expõe mostrarModal)
  function mostrarModalSessaoEncerrada(mensagem, onOk) {
    if (!document.body) {
      if (onOk) onOk();
      return;
    }
    var idStyle = 'url-helper-modal-sessao-style';
    if (!document.getElementById(idStyle)) {
      var style = document.createElement('style');
      style.id = idStyle;
      style.textContent = [
        '.url-helper-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity 0.25s ease;}',
        '.url-helper-modal-overlay.show{opacity:1;}',
        '.url-helper-modal-dialog{background:#fff;border-radius:20px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25);transform:scale(0.92);opacity:0;transition:transform 0.25s ease,opacity 0.25s ease;}',
        '.url-helper-modal-overlay.show .url-helper-modal-dialog{transform:scale(1);opacity:1;}',
        '.url-helper-modal-header{padding:20px 20px 12px;border-bottom:1px solid #e5e7eb;}',
        '.url-helper-modal-title{font-size:1.125rem;font-weight:700;color:#0f172a;}',
        '.url-helper-modal-body{padding:20px;}',
        '.url-helper-modal-body p{font-size:0.9375rem;color:#475569;line-height:1.5;margin:0;}',
        '.url-helper-modal-footer{padding:16px 20px;display:flex;justify-content:flex-end;border-top:1px solid #e5e7eb;}',
        '.url-helper-modal-btn{padding:12px 24px;border:none;border-radius:12px;font-size:0.9375rem;font-weight:600;cursor:pointer;background:#0ea5e9;color:#fff;}',
        '.url-helper-modal-btn:active{transform:scale(0.98);}',
        'html.tema-escuro .url-helper-modal-dialog{background:#1e293b;border:1px solid #334155;}',
        'html.tema-escuro .url-helper-modal-header{border-color:#334155;}',
        'html.tema-escuro .url-helper-modal-title{color:#f1f5f9;}',
        'html.tema-escuro .url-helper-modal-body p{color:#cbd5e1;}',
        'html.tema-escuro .url-helper-modal-footer{border-color:#334155;}',
        'html.tema-escuro .url-helper-modal-btn{background:#0d2137;color:#f1f5f9;}'
      ].join('');
      (document.head || document.documentElement).appendChild(style);
    }
    var overlay = document.createElement('div');
    overlay.className = 'url-helper-modal-overlay';
    var esc = window.escapeHtml || function(t){ return t; };
    overlay.innerHTML = '<div class="url-helper-modal-dialog">' +
      '<div class="url-helper-modal-header"><div class="url-helper-modal-title">Sessão encerrada</div></div>' +
      '<div class="url-helper-modal-body"><p>' + esc(mensagem).replace(/\n/g, '<br>') + '</p></div>' +
      '<div class="url-helper-modal-footer"><button type="button" class="url-helper-modal-btn">OK</button></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('show'); });
    overlay.querySelector('.url-helper-modal-btn').onclick = function() {
      overlay.classList.remove('show');
      setTimeout(function() {
        overlay.remove();
        if (onOk) onOk();
      }, 250);
    };
  }

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
      // Se a API retornar 401 (token expirado, inválido ou sessão encerrada em outro dispositivo), logout no app motorista
      if (response.status === 401) {
        const pathname = window.location.pathname || '';
        const isMotorista = pathname.indexOf('motorista') !== -1 || pathname.indexOf('chat-motorista-standalone') !== -1;
        const isLoginPage = pathname.endsWith('index.html') || pathname.endsWith('/motorista') || pathname.endsWith('/motorista/');
        var urlStr = typeof urlToFetch === 'string' ? urlToFetch : (urlToFetch && urlToFetch.url) ? String(urlToFetch.url) : '';
        var isApiCall = urlStr.indexOf('/api/') !== -1;
        if (isMotorista && !isLoginPage && isApiCall) {
          var base = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
          var goLogin = function() {
            localStorage.removeItem('token');
            localStorage.removeItem('motorista');
            window.location.href = base + '/motorista/index.html';
          };
          response.clone().json().then(function(data) {
            if (data && data.errorKey === 'login.sessaoEncerradaOutroDispositivo') {
              var msg = data.message || 'Sessão encerrada em outro dispositivo. Faça login novamente.';
              if (typeof window.mostrarModal === 'function') {
                window.mostrarModal('Sessão encerrada', msg, ['OK']).then(function() { goLogin(); });
              } else {
                mostrarModalSessaoEncerrada(msg, goLogin);
              }
            } else {
              goLogin();
            }
          }).catch(function() { goLogin(); });
        }
      }
      return response;
    });
  };
  
  console.log('✅ [URL HELPER] Inicializado. Base URL:', baseUrl);

  // Aplicar tema (claro/escuro/auto) em todas as páginas que carregam este script.
  // No celular: aplicar em documentElement (html) também para primeiro paint e quando body ainda não existe;
  // default 'auto' quando tema não está salvo (segue preferência do sistema).
  (function aplicarTemaGlobal() {
    function aplicar(escuro) {
      document.documentElement.classList.toggle('tema-escuro', escuro);
      if (document.body) document.body.classList.toggle('tema-escuro', escuro);
    }
    try {
      var tema = localStorage.getItem('tema');
      if (tema == null || tema === '') tema = 'auto';
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      var escuro = tema === 'escuro' || (tema === 'auto' && mq && mq.matches);
      aplicar(escuro);
      if (tema === 'auto' && mq) {
        mq.addEventListener('change', function() {
          aplicar(this.matches);
        });
      }
    } catch (e) {
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      aplicar(mq && mq.matches);
    }
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

