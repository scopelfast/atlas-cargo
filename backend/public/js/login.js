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

  // Verificar se há login pendente após redirecionamento
  const pendingLogin = sessionStorage.getItem('pendingLogin');
  if (pendingLogin) {
    try {
      const loginData = JSON.parse(pendingLogin);
      sessionStorage.removeItem('pendingLogin');
      
      // Preencher campos automaticamente
      const usernameField = document.getElementById('username');
      const passwordField = document.getElementById('password');
      const ambienteSelect = document.getElementById('ambiente');
      const urlProducaoInput = document.getElementById('urlProducao');
      
      if (usernameField) usernameField.value = loginData.username;
      if (passwordField) passwordField.value = loginData.password;
      if (ambienteSelect) ambienteSelect.value = loginData.ambiente;
      
      // Se tem URL de produção salva, preencher
      if (loginData.urlProducao && urlProducaoInput) {
        urlProducaoInput.value = loginData.urlProducao;
        localStorage.setItem('urlBaseProducao', loginData.urlProducao);
      }
      
      // Garantir que o ambiente está correto ANTES de preencher campos
      if (loginData.ambiente === 'local') {
        localStorage.setItem('ambiente', 'local');
        localStorage.removeItem('urlBaseProducao');
        console.log('[AMBIENTE] Login pendente: ambiente LOCAL configurado');
      } else if (loginData.ambiente === 'producao') {
        localStorage.setItem('ambiente', 'producao');
        if (loginData.urlProducao) {
          localStorage.setItem('urlBaseProducao', loginData.urlProducao);
        }
        console.log('[AMBIENTE] Login pendente: ambiente PRODUÇÃO configurado');
      }
      
      // Disparar evento change no select para mostrar campo de URL se necessário
      if (ambienteSelect && loginData.ambiente === 'producao') {
        ambienteSelect.dispatchEvent(new Event('change'));
      }
      
      // Fazer login automaticamente após um pequeno delay
      // IMPORTANTE: Não verificar redirecionamento novamente, pois já estamos no ambiente correto
      setTimeout(async () => {
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: loginData.username,
              password: loginData.password
            })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            
            // Garantir que o ambiente está salvo antes de redirecionar
            if (loginData.ambiente === 'local') {
              localStorage.setItem('ambiente', 'local');
              localStorage.removeItem('urlBaseProducao');
              console.log('[AMBIENTE] Login automático: ambiente LOCAL confirmado');
            } else if (loginData.ambiente === 'producao') {
              localStorage.setItem('ambiente', 'producao');
              if (loginData.urlProducao) {
                localStorage.setItem('urlBaseProducao', loginData.urlProducao);
              }
              console.log('[AMBIENTE] Login automático: ambiente PRODUÇÃO confirmado');
            }
            
            console.log('[AMBIENTE] Login automático realizado com sucesso. Ambiente:', loginData.ambiente);
            window.location.href = 'dashboard.html';
          } else {
            showError(data.message || 'Credenciais inválidas.');
          }
        } catch (err) {
          console.error('Erro no login automático:', err);
          showError('Não foi possível conectar ao servidor.');
        }
      }, 500);
    } catch (err) {
      console.error('Erro ao processar login pendente:', err);
    }
  }

  // Carregar ambiente salvo ou detectar automaticamente
  const ambienteSelect = document.getElementById('ambiente');
  if (ambienteSelect) {
    const ambienteSalvo = localStorage.getItem('ambiente');
    if (ambienteSalvo) {
      ambienteSelect.value = ambienteSalvo;
      // Disparar evento change para mostrar campo de URL se necessário
      if (ambienteSalvo === 'producao') {
        ambienteSelect.dispatchEvent(new Event('change'));
      }
    } else {
      // Detectar automaticamente: se estiver em localhost, usar local; senão, produção
      const isLocalhost = window.location.hostname === 'localhost' || 
                          window.location.hostname === '127.0.0.1' ||
                          window.location.hostname.startsWith('192.168.');
      ambienteSelect.value = isLocalhost ? 'local' : 'producao';
      if (!isLocalhost) {
        ambienteSelect.dispatchEvent(new Event('change'));
      }
    }
    
    // Salvar quando mudar
    ambienteSelect.addEventListener('change', () => {
      const ambienteEscolhido = ambienteSelect.value;
      localStorage.setItem('ambiente', ambienteEscolhido);
      
      // Mostrar/ocultar campo de URL de produção
      const urlProducaoBox = document.getElementById('urlProducaoBox');
      if (urlProducaoBox) {
        urlProducaoBox.style.display = ambienteEscolhido === 'producao' ? 'block' : 'none';
      }
      
      // Se escolheu produção, salvar a URL atual como URL de produção (se não tiver campo)
      if (ambienteEscolhido === 'producao') {
        const urlProducaoInput = document.getElementById('urlProducao');
        if (!urlProducaoInput || !urlProducaoInput.value.trim()) {
          const urlAtual = window.location.origin;
          localStorage.setItem('urlBaseProducao', urlAtual);
          if (urlProducaoInput) {
            urlProducaoInput.value = urlAtual;
          }
          console.log('[AMBIENTE] Ambiente alterado para PRODUÇÃO. URL salva:', urlAtual);
        }
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

    // Prepara UI (fazer ANTES de qualquer redirecionamento)
    showError('');
    btn.disabled = true;
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan ? btnSpan.textContent : 'Entrar';

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
      
      // Apenas salvar a URL de produção para usar nos links
      // NÃO redirecionar automaticamente - o usuário pode estar testando localmente
      console.log('[AMBIENTE] Ambiente PRODUÇÃO configurado. URL salva para links:', urlProducao);
      console.log('[AMBIENTE] Nota: Os links gerados usarão esta URL, mas você pode continuar trabalhando na URL atual.');
    } else {
      // Se escolheu local, limpar URL de produção
      localStorage.removeItem('urlBaseProducao');
      console.log('[AMBIENTE] Login com ambiente LOCAL');
      
      // Apenas salvar ambiente local
      // NÃO redirecionar automaticamente - o usuário pode estar testando
      console.log('[AMBIENTE] Ambiente LOCAL configurado.');
      console.log('[AMBIENTE] Nota: Os links gerados usarão localhost:3000, mas você pode continuar trabalhando na URL atual.');
    }

    // Validação básica
    if (!username || !password) {
      showError('Preencha todos os campos.');
      btn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalText;
      return;
    }

    // Continuar com o login normal
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