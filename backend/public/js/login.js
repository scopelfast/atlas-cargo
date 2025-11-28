// backend/public/js/login.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorMsg = document.getElementById('errorMessage');
  const btn = document.querySelector('.btn');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');

  if (!form) return;

  // Toggle password visibility
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      const icon = togglePassword.querySelector('i');
      if (type === 'password') {
        icon.classList.remove('bx-show');
        icon.classList.add('bx-hide');
      } else {
        icon.classList.remove('bx-hide');
        icon.classList.add('bx-show');
      }
    });
  }

  // Carregar ambiente salvo ou detectar automaticamente
  const ambienteSelect = document.getElementById('ambiente');
  if (ambienteSelect) {
    const ambienteSalvo = localStorage.getItem('ambiente');
    if (ambienteSalvo) {
      ambienteSelect.value = ambienteSalvo;
    } else {
      // Detectar automaticamente: se estiver em localhost, usar local; senão, produção
      const isLocalhost = window.location.hostname === 'localhost' || 
                          window.location.hostname === '127.0.0.1' ||
                          window.location.hostname.startsWith('192.168.');
      ambienteSelect.value = isLocalhost ? 'local' : 'producao';
    }
    
    // Salvar quando mudar
    ambienteSelect.addEventListener('change', () => {
      const ambienteEscolhido = ambienteSelect.value;
      localStorage.setItem('ambiente', ambienteEscolhido);
      
      // Se escolheu produção, salvar a URL atual como URL de produção
      if (ambienteEscolhido === 'producao') {
        const urlAtual = window.location.origin;
        localStorage.setItem('urlBaseProducao', urlAtual);
        console.log('[AMBIENTE] Ambiente alterado para PRODUÇÃO. URL salva:', urlAtual);
      } else {
        // Se escolheu local, limpar URL de produção
        localStorage.removeItem('urlBaseProducao');
        console.log('[AMBIENTE] Ambiente alterado para LOCAL');
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username')?.value.trim();
    const password = document.getElementById('password')?.value;
    const ambiente = document.getElementById('ambiente')?.value || 'producao';

    // Salvar ambiente escolhido
    localStorage.setItem('ambiente', ambiente);
    
    // Se escolheu produção, salvar a URL informada ou a URL atual
    if (ambiente === 'producao') {
      const urlProducaoInput = document.getElementById('urlProducao');
      let urlProducao = '';
      
      if (urlProducaoInput && urlProducaoInput.value.trim()) {
        urlProducao = urlProducaoInput.value.trim();
        // Garantir que tem http:// ou https://
        if (!urlProducao.startsWith('http://') && !urlProducao.startsWith('https://')) {
          urlProducao = 'http://' + urlProducao;
        }
      } else {
        // Se não informou, usar a URL atual
        urlProducao = window.location.origin;
      }
      
      localStorage.setItem('urlBaseProducao', urlProducao);
      console.log('[AMBIENTE] Login com ambiente PRODUÇÃO. URL salva:', urlProducao);
    } else {
      // Se escolheu local, limpar URL de produção
      localStorage.removeItem('urlBaseProducao');
      console.log('[AMBIENTE] Login com ambiente LOCAL');
    }

    // Validação básica
    if (!username || !password) {
      showError('Preencha todos os campos.');
      return;
    }

    // Prepara UI
    showError('');
    btn.disabled = true;
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan ? btnSpan.textContent : 'Entrar';
    if (btnSpan) btnSpan.textContent = 'Entrando...';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: username,
          password: password
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = 'dashboard.html';
      } else {
        showError(data.message || 'Credenciais inválidas.');
      }
    } catch (err) {
      console.error('Erro na requisição:', err);
      showError('Não foi possível conectar ao servidor.');
    } finally {
      btn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalText;
    }
  });

  function showError(message) {
    if (errorMsg) {
      errorMsg.textContent = message;
    }
  }
});