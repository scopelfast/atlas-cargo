// version.js - Sistema de Cache Busting
// Atualizar este número/data sempre que fizer uma nova publicação
window.APP_VERSION = '20250102-1500'; // Formato: YYYYMMDD-HHMM

// Função para adicionar versão aos recursos
window.addVersion = function(url) {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${window.APP_VERSION}`;
};

// Aplicar versão automaticamente aos scripts e CSS já carregados
(function() {
  console.log(`[Sistema] Versão: ${window.APP_VERSION}`);
  
  // Forçar recarga dos CSS se necessário
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.includes('v=') && !href.startsWith('http')) {
      link.href = window.addVersion(href);
    }
  });
})();

