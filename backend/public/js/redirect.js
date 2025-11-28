// Evitar loop de redirecionamento
if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
  const token = localStorage.getItem('token');
  if (token) {
    // Verificar se já não está na página de dashboard para evitar loop
    if (window.location.pathname !== '/dashboard' && window.location.pathname !== '/dashboard.html') {
      window.location.href = '/dashboard.html';
    }
  }
}
