// Proteção anti-loop de redirecionamento
(function() {
  // Verificar se está em loop
  const loopCount = parseInt(sessionStorage.getItem('redirectLoopCount') || '0');
  
  if (loopCount > 3) {
    console.error('❌ Loop de redirecionamento detectado! Parando.');
    sessionStorage.removeItem('redirectLoopCount');
    // Não fazer mais redirecionamentos
    return;
  }
  
  // Evitar loop de redirecionamento
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    // Só redirecionar se tiver token E user válido
    if (token && user) {
      try {
        JSON.parse(user); // Validar se user é JSON válido
        // Verificar se já não está na página de dashboard para evitar loop
        if (window.location.pathname !== '/dashboard' && window.location.pathname !== '/dashboard.html') {
          sessionStorage.setItem('redirectLoopCount', (loopCount + 1).toString());
          console.log('🔄 Redirecionando para dashboard...');
          
          // Forçar HTTP em desenvolvimento local
          const hostname = window.location.hostname;
          const isLocal = hostname === 'localhost' || 
                          hostname === '127.0.0.1' || 
                          hostname.startsWith('192.168.');
          const protocol = isLocal ? 'http:' : window.location.protocol;
          const cleanUrl = protocol + '//' + window.location.host + '/dashboard.html';
          // Usar replace para não adicionar ao histórico e evitar ?
          window.location.replace(cleanUrl);
        }
      } catch (e) {
        // User inválido, não redirecionar
        console.warn('⚠️ User inválido no localStorage, não redirecionando');
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
  } else {
    // Se chegou em outra página, resetar contador
    sessionStorage.removeItem('redirectLoopCount');
  }
})();
