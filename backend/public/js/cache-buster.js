// ============================================
// Cache Buster Helper
// ============================================
// Adiciona parâmetro de versão aos arquivos JS/CSS para evitar cache
// Versão baseada em timestamp do build ou data de deploy
// ============================================

(function() {
  'use strict';

  // Versão do sistema (pode ser alterada a cada deploy)
  // Formato: YYYYMMDDHHMM (ano, mês, dia, hora, minuto)
  // Exemplo: 202512091200 = 09/12/2025 12:00
  // IMPORTANTE: Atualizar este valor a cada deploy para forçar atualização do cache
  // Use o script: node backend/scripts/atualizar-versao-cache.js
  const APP_VERSION = '202512091200'; // Atualizar a cada deploy
  
  // Versão alternativa: usar timestamp atual (descomente se preferir)
  // const APP_VERSION = Date.now().toString();
  
  // Função para adicionar cache busting a um URL
  window.addCacheBuster = function(url) {
    if (!url) return url;
    
    // Se já tem parâmetros, adicionar com &
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'v=' + APP_VERSION;
  };

  // Função para processar todos os scripts e links CSS na página
  window.processCacheBusting = function() {
    // Processar scripts
    document.querySelectorAll('script[src]').forEach(script => {
      const src = script.getAttribute('src');
      // Ignorar scripts externos (CDN) e que já têm cache buster
      if (src && !src.startsWith('http') && !src.includes('?v=') && !src.includes('&v=')) {
        script.src = window.addCacheBuster(src);
      }
    });

    // Processar links CSS
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
      const href = link.getAttribute('href');
      // Ignorar links externos (CDN) e que já têm cache buster
      if (href && !href.startsWith('http') && !href.includes('?v=') && !href.includes('&v=')) {
        link.href = window.addCacheBuster(href);
      }
    });
  };

  // Executar quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.processCacheBusting);
  } else {
    // DOM já está pronto
    window.processCacheBusting();
  }

  // Também processar scripts dinâmicos adicionados depois
  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function(child) {
    const result = originalAppendChild.call(this, child);
    if (child.tagName === 'SCRIPT' && child.src && !child.src.startsWith('http') && !child.src.includes('?v=')) {
      child.src = window.addCacheBuster(child.src);
    }
    if (child.tagName === 'LINK' && child.rel === 'stylesheet' && child.href && !child.href.startsWith('http') && !child.href.includes('?v=')) {
      child.href = window.addCacheBuster(child.href);
    }
    return result;
  };

})();

