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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username')?.value.trim();
    const password = document.getElementById('password')?.value;

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