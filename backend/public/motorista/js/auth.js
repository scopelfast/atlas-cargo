// APP Motorista - Autenticação
// Versão: 1.0

// ==========================================
// FUNÇÕES GLOBAIS DE AUTENTICAÇÃO
// ==========================================

/**
 * Verificar se o usuário está autenticado
 */
function verificarAuth() {
  const token = localStorage.getItem('token');
  const motorista = localStorage.getItem('motorista');
  return !!(token && motorista);
}

/**
 * Obter token
 */
function getToken() {
  return localStorage.getItem('token');
}

/**
 * Obter dados do motorista
 */
function getMotorista() {
  const motorista = localStorage.getItem('motorista');
  return motorista ? JSON.parse(motorista) : null;
}

/**
 * Fazer logout
 */
function doLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('motorista');
  
  // Usar caminho base correto (/cargas/)
  let pathBase = '';
  if (window.__BASE_URL__) {
    // Se __BASE_URL__ inclui /cargas, extrair o pathBase
    const baseUrl = window.__BASE_URL__;
    if (baseUrl.includes('/cargas')) {
      pathBase = '/cargas';
    }
  } else {
    // Fallback: verificar pathname atual
    const pathname = window.location.pathname;
    if (pathname.includes('/cargas')) {
      pathBase = '/cargas';
    }
  }
  
  window.location.href = pathBase + '/motorista/index.html';
}

/**
 * Verificar se token está expirado (opcional)
 */
function isTokenExpired() {
  // TODO: Implementar verificação de expiração do JWT
  return false;
}

// ==========================================
// LOGIN FORM (IIFE)
// ==========================================

(function() {
  const loginForm = document.getElementById('loginForm');
  const cpfInput = document.getElementById('cpf');
  const senhaInput = document.getElementById('senha');
  const messageDiv = document.getElementById('message');

  // Máscara de CPF
  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 11) value = value.slice(0, 11);
      
      if (value.length > 9) {
        value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      } else if (value.length > 6) {
        value = value.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
      } else if (value.length > 3) {
        value = value.replace(/(\d{3})(\d{1,3})/, '$1.$2');
      }
      
      e.target.value = value;
    });
  }

  // Função para mostrar mensagem
  function showMessage(text, type = 'info') {
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.className = `message ${type} show`;
    
    setTimeout(() => {
      messageDiv.classList.remove('show');
    }, 5000);
  }

  // Login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const cpf = cpfInput.value.replace(/\D/g, '');
      const senha = senhaInput.value;

      if (!cpf || cpf.length !== 11) {
        showMessage('CPF inválido!', 'error');
        return;
      }

      if (!senha) {
        showMessage('Digite sua senha!', 'error');
        return;
      }

      try {
        console.log('🔐 Tentando fazer login com CPF:', cpf.replace(/\d(?=\d{4})/g, "*")); // Mascarar CPF no log
        
        // Obter baseUrl para corrigir URL da API
        let baseUrl = window.__BASE_URL__;
        if (!baseUrl) {
          const protocoloAtual = window.location.protocol;
          const host = window.location.host;
          let pathBase = window.location.pathname;
          
          // Remover /motorista/index.html ou /motorista/ do final
          if (pathBase.includes('/motorista')) {
            const indexMotorista = pathBase.indexOf('/motorista');
            pathBase = pathBase.substring(0, indexMotorista);
          }
          
          if (!pathBase || pathBase === '') pathBase = '/';
          if (pathBase !== '/' && !pathBase.endsWith('/')) pathBase = pathBase + '/';
          
          baseUrl = protocoloAtual + '//' + host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
        }
        
        // Usar window.corrigirUrl se disponível, caso contrário construir manualmente
        const apiUrl = window.corrigirUrl ? window.corrigirUrl('/api/motorista/login') : (baseUrl + '/api/motorista/login');
        
        console.log('🔗 Base URL:', baseUrl);
        console.log('🔗 Chamando API:', apiUrl);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpf, senha })
        });

        console.log('📡 Resposta do servidor:', response.status, response.statusText);

        const data = await response.json();
        console.log('📦 Dados recebidos:', data);

        if (response.ok && data.success) {
          // Salvar token
          localStorage.setItem('token', data.token);
          localStorage.setItem('motorista', JSON.stringify(data.motorista));
          
          showMessage('Login realizado com sucesso!', 'success');
          
          // Redirecionar para dashboard usando caminho correto
          let redirectBaseUrl = window.__BASE_URL__;
          if (!redirectBaseUrl) {
            const protocoloAtual = window.location.protocol;
            const host = window.location.host;
            let pathBase = window.location.pathname;
            
            if (pathBase.includes('/motorista')) {
              const indexMotorista = pathBase.indexOf('/motorista');
              pathBase = pathBase.substring(0, indexMotorista);
            }
            
            if (!pathBase || pathBase === '') pathBase = '/';
            if (pathBase !== '/' && !pathBase.endsWith('/')) pathBase = pathBase + '/';
            
            redirectBaseUrl = protocoloAtual + '//' + host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
          }
          
          const dashboardUrl = window.corrigirUrl ? window.corrigirUrl('/motorista/pages/dashboard.html') : (redirectBaseUrl + '/motorista/pages/dashboard.html');
          
          setTimeout(() => {
            window.location.href = dashboardUrl;
          }, 1000);
        } else {
          // Mostrar mensagem de erro detalhada
          const mensagemErro = data.error || data.message || 'Erro ao fazer login';
          console.error('❌ Erro no login:', mensagemErro);
          showMessage(mensagemErro, 'error');
        }
      } catch (err) {
        console.error('❌ Erro de conexão:', err);
        showMessage('Erro de conexão. Verifique se o servidor está rodando e tente novamente.', 'error');
      }
    });
  }
})();

