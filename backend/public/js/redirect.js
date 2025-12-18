// Proteção anti-loop de redirecionamento
(function() {
  // Aguardar um pouco para não interferir com login em andamento
  setTimeout(function() {
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
      
      console.log('[REDIRECT] Verificando redirecionamento:', {
        pathname: window.location.pathname,
        hasToken: !!token,
        hasUser: !!user
      });
      
      // Só redirecionar se tiver token E user válido
      if (token && user) {
        try {
          JSON.parse(user); // Validar se user é JSON válido
          // Verificar se já não está na página de dashboard para evitar loop
          if (window.location.pathname !== '/dashboard' && window.location.pathname !== '/dashboard.html') {
            sessionStorage.setItem('redirectLoopCount', (loopCount + 1).toString());
            console.log('🔄 [REDIRECT] Redirecionando para dashboard...');
            
            // Forçar HTTP em desenvolvimento local
            const hostname = window.location.hostname;
            const isLocal = hostname === 'localhost' || 
                            hostname === '127.0.0.1' || 
                            hostname.startsWith('192.168.');
            const protocol = isLocal ? 'http:' : window.location.protocol;
            let cleanUrl = protocol + '//' + window.location.host + '/dashboard.html';
            // Garantir que não tenha ? no final
            cleanUrl = cleanUrl.replace(/\?+$/, '');
            // Usar replace para não adicionar ao histórico e evitar ?
            window.location.replace(cleanUrl);
          }
        } catch (e) {
          // User inválido, não redirecionar
          console.warn('⚠️ [REDIRECT] User inválido no localStorage, não redirecionando');
          localStorage.removeItem('user');
          localStorage.removeItem('token');
        }
      } else {
        console.log('[REDIRECT] Sem token/user, permanecendo na página de login');
      }
    } else {
      // Se chegou em outra página, resetar contador
      sessionStorage.removeItem('redirectLoopCount');
    }
  }, 100); // Aguardar 100ms para não interferir com login
})();
