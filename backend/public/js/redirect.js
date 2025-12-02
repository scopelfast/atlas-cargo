// Proteção anti-loop de redirecionamento
(function() {
  // Verificar se está em loop
  const loopCount = parseInt(sessionStorage.getItem('redirectLoopCount') || '0');
  
  if (loopCount > 3) {
    console.error('❌ Loop de redirecionamento detectado! Parando.');
    sessionStorage.removeItem('redirectLoopCount');
    return;
  }
  
  // Evitar loop de redirecionamento
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    const token = localStorage.getItem('token');
    if (token) {
      // Verificar se já não está na página de dashboard para evitar loop
      if (window.location.pathname !== '/dashboard' && window.location.pathname !== '/dashboard.html') {
        sessionStorage.setItem('redirectLoopCount', (loopCount + 1).toString());
        window.location.href = '/dashboard.html';
      }
    }
  } else {
    // Se chegou em outra página, resetar contador
    sessionStorage.removeItem('redirectLoopCount');
  }
})();
