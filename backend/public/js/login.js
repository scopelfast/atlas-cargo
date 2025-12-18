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
        // Salvar ID do log de acesso para registrar logout depois
        if (data.idLogAcesso) {
          localStorage.setItem('idLogAcesso', data.idLogAcesso.toString());
        }
        // Salvar timestamp do login para controle de timeout
        localStorage.setItem('loginTimestamp', Date.now().toString());
        
        // Forçar HTTP em desenvolvimento local
        const hostname = window.location.hostname;
        const isLocal = hostname === 'localhost' || 
                        hostname === '127.0.0.1' || 
                        hostname.startsWith('192.168.');
        const protocol = isLocal ? 'http:' : window.location.protocol;
        // Remover qualquer query string vazia (?) e garantir URL limpa
        let cleanUrl = protocol + '//' + window.location.host + '/dashboard.html';
        // Garantir que não tenha ? no final
        cleanUrl = cleanUrl.replace(/\?+$/, '');
        console.log('[LOGIN] Redirecionando para:', cleanUrl);
        // Usar replace para não adicionar ao histórico e evitar ?
        window.location.replace(cleanUrl);
      } else {
        showError(data.message || 'Credenciais inválidas.');
      }
    } catch (err) {
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

  // ========== FUNCIONALIDADE ALTERAR SENHA ==========
  const linkAlterarSenha = document.getElementById('linkAlterarSenha');
  const modalAlterarSenha = document.getElementById('modalAlterarSenha');
  const btnFecharModalSenha = document.getElementById('btnFecharModalSenha');
  const formAlterarSenha = document.getElementById('formAlterarSenha');
  const errorMessageSenha = document.getElementById('errorMessageSenha');

  // Abrir modal
  if (linkAlterarSenha) {
    linkAlterarSenha.addEventListener('click', (e) => {
      e.preventDefault();
      if (modalAlterarSenha) {
        modalAlterarSenha.style.display = 'block';
        document.getElementById('alterarSenhaUsuario').focus();
      }
    });
  }

  // Fechar modal
  if (btnFecharModalSenha) {
    btnFecharModalSenha.addEventListener('click', () => {
      if (modalAlterarSenha) {
        modalAlterarSenha.style.display = 'none';
        formAlterarSenha.reset();
        if (errorMessageSenha) errorMessageSenha.textContent = '';
      }
    });
  }

  // Fechar modal ao clicar fora
  if (modalAlterarSenha) {
    modalAlterarSenha.addEventListener('click', (e) => {
      if (e.target === modalAlterarSenha) {
        modalAlterarSenha.style.display = 'none';
        formAlterarSenha.reset();
        if (errorMessageSenha) errorMessageSenha.textContent = '';
      }
    });
  }

  // Toggle senhas no modal
  const toggles = ['toggleSenhaAtual', 'toggleSenhaNova', 'toggleSenhaConfirmar'];
  const inputs = ['alterarSenhaAtual', 'alterarSenhaNova', 'alterarSenhaConfirmar'];
  
  toggles.forEach((toggleId, index) => {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputs[index]);
    if (toggle && input) {
      toggle.addEventListener('click', () => {
        const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', type);
        const icon = toggle.querySelector('i');
        if (type === 'password') {
          icon.classList.remove('bx-show');
          icon.classList.add('bx-hide');
        } else {
          icon.classList.remove('bx-hide');
          icon.classList.add('bx-show');
        }
      });
    }
  });

  // Submeter formulário de alterar senha
  if (formAlterarSenha) {
    formAlterarSenha.addEventListener('submit', async (e) => {
      e.preventDefault();

      const usuario = document.getElementById('alterarSenhaUsuario')?.value.trim();
      const senhaAtual = document.getElementById('alterarSenhaAtual')?.value;
      const senhaNova = document.getElementById('alterarSenhaNova')?.value;
      const senhaConfirmar = document.getElementById('alterarSenhaConfirmar')?.value;

      // Validações
      if (!usuario || !senhaAtual || !senhaNova || !senhaConfirmar) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = 'Preencha todos os campos.';
        }
        return;
      }

      if (senhaNova !== senhaConfirmar) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = 'As senhas não coincidem.';
        }
        return;
      }

      if (senhaNova.length < 6) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = 'A nova senha deve ter no mínimo 6 caracteres.';
        }
        return;
      }

      // Limpar erro
      if (errorMessageSenha) errorMessageSenha.textContent = '';

      const btn = formAlterarSenha.querySelector('button[type="submit"]');
      const btnSpan = btn?.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : 'Alterar Senha';
      
      if (btn) btn.disabled = true;
      if (btnSpan) btnSpan.textContent = 'Alterando...';

      try {
        const response = await fetch('/api/auth/alterar-senha', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            usuario: usuario,
            senhaAtual: senhaAtual,
            senhaNova: senhaNova
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          if (errorMessageSenha) {
            errorMessageSenha.textContent = '';
            errorMessageSenha.style.background = '#d4edda';
            errorMessageSenha.style.borderLeftColor = '#28a745';
            errorMessageSenha.style.color = '#155724';
            errorMessageSenha.textContent = 'Senha alterada com sucesso!';
          }
          
          // Limpar formulário após 2 segundos e fechar modal
          setTimeout(() => {
            formAlterarSenha.reset();
            if (modalAlterarSenha) modalAlterarSenha.style.display = 'none';
            if (errorMessageSenha) {
              errorMessageSenha.textContent = '';
              errorMessageSenha.style.background = '#fee';
              errorMessageSenha.style.borderLeftColor = '#e74c3c';
              errorMessageSenha.style.color = '#e74c3c';
            }
          }, 2000);
        } else {
          if (errorMessageSenha) {
            errorMessageSenha.textContent = data.message || 'Erro ao alterar senha.';
          }
        }
      } catch (err) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = 'Não foi possível conectar ao servidor.';
        }
      } finally {
        if (btn) btn.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
      }
    });
  }
});
