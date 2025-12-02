// APP Motorista - Autenticação
// Versão: 1.0

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
        const response = await fetch('/api/motorista/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpf, senha })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Salvar token
          localStorage.setItem('token', data.token);
          localStorage.setItem('motorista', JSON.stringify(data.motorista));
          
          showMessage('Login realizado com sucesso!', 'success');
          
          // Redirecionar para dashboard
          setTimeout(() => {
            window.location.href = 'pages/dashboard.html';
          }, 1000);
        } else {
          showMessage(data.error || 'Erro ao fazer login', 'error');
        }
      } catch (err) {
        console.error('Erro no login:', err);
        showMessage('Erro de conexão. Tente novamente.', 'error');
      }
    });
  }
})();

