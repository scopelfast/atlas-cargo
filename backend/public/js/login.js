// backend/public/js/login.js
console.log('[LOGIN] Script login.js carregado');

// Helper de tradução para login (não sobrescreve window.tWeb do i18n-web.js)
function tLogin(key) {
  var fn = window.tWeb;
  if (typeof fn === 'function') {
    try {
      var v = fn(key);
      if (v != null && v !== '' && v !== key) return v;
    } catch (e) { /* fallback se i18n não pronto */ }
  }
  var fallback = {
    'web.login.preenchaCampos': 'Preencha todos os campos.',
    'web.login.entrar': 'Entrar',
    'web.login.entrando': 'Entrando...',
    'web.login.credenciaisInvalidas': 'Credenciais inválidas.',
    'web.login.erroConectarServidor': 'Não foi possível conectar ao servidor.',
    'web.login.alterarSenha': 'Alterar Senha',
    'web.login.alterando': 'Alterando...',
    'web.login.senhasNaoCoincidem': 'As senhas não coincidem.',
    'web.login.senhaMinima6': 'A nova senha deve ter no mínimo 6 caracteres.',
    'web.login.senhaAlteradaSucesso': 'Senha alterada com sucesso!',
    'web.login.erroAlterarSenha': 'Erro ao alterar senha.',
    'web.login.limiteSessaoTitulo': 'Limite de acessos simultâneos',
    'web.login.limiteSessaoAjuda':
      'Encerrar a sessão mais antiga libera uma vaga no painel (registro em Logs de Acesso).',
    'web.login.cancelar': 'Cancelar',
    'web.login.encerrarMaisAntiga': 'Encerrar a mais antiga e entrar',
    'web.login.fecharModal': 'Fechar',
    'web.login.sessaoDeslocada':
      'Esta conexão ao painel foi encerrada: a vaga de sessão licenciada foi utilizada por outro acesso (por exemplo, o mesmo utilizador noutro navegador ou equipamento, ou limite de sessões do plano). Faça login novamente.'
  };
  return fallback[key] != null ? fallback[key] : key;
}

/** Garante textos do modal (tWeb pode devolver a chave se o JSON não carregar — ex.: base path errado). */
function aplicarTextosModalLimiteSessaoComTLogin(modalRoot) {
  if (!modalRoot || !modalRoot.querySelectorAll) return;
  modalRoot.querySelectorAll('[data-i18n]').forEach(function (el) {
    var k = el.getAttribute('data-i18n');
    if (k) el.textContent = tLogin(k);
  });
  modalRoot.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    var k = el.getAttribute('data-i18n-title');
    if (k) el.setAttribute('title', tLogin(k));
  });
}

/** Modal 409 CONCURRENT_SESSION_LIMIT — retorna true se o usuário escolheu encerrar a mais antiga */
function openSessionLimitModal(apiData) {
  return new Promise(function (resolve) {
    var modal = document.getElementById('modalLimiteSessaoTorre');
    var texto = document.getElementById('modalLimiteSessaoTexto');
    var btnC = document.getElementById('btnLimiteSessaoCancelar');
    var btnE = document.getElementById('btnLimiteSessaoEncerrar');
    var btnX = document.getElementById('btnFecharModalLimiteSessao');
    if (!modal || !texto || !btnC || !btnE) {
      resolve(false);
      return;
    }
    if (typeof window.applyI18nWeb === 'function') {
      try {
        window.applyI18nWeb(modal);
      } catch (e) {}
    }
    aplicarTextosModalLimiteSessaoComTLogin(modal);
    var max = apiData.maxConcurrentSessions;
    var open = apiData.openSessions;
    var msg = apiData.message || tLogin('web.login.limiteSessaoTitulo');
    if (max != null && open != null) {
      msg = msg + ' (' + String(open) + '/' + String(max) + ' em uso).';
    }
    texto.textContent = msg;
    if (btnX) {
      btnX.setAttribute('aria-label', tLogin('web.login.fecharModal'));
    }
    modal.style.display = 'block';

    function done(result) {
      modal.style.display = 'none';
      btnC.removeEventListener('click', onCancel);
      btnE.removeEventListener('click', onKick);
      if (btnX) btnX.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onCancel() {
      done(false);
    }
    function onKick() {
      done(true);
    }
    function onBackdrop(ev) {
      if (ev.target === modal) onCancel();
    }
    function onKey(ev) {
      if (ev.key === 'Escape') onCancel();
    }
    btnC.addEventListener('click', onCancel);
    btnE.addEventListener('click', onKick);
    if (btnX) btnX.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

async function postTowerLogin(username, password, kickOldest) {
  var apiUrl = corrigirUrl('/api/auth/login');
  var response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: username,
      password: password,
      kickOldestSession: !!kickOldest
    })
  });
  var data = {};
  try {
    data = await response.json();
  } catch (parseErr) {
    data = {};
  }
  return { response: response, data: data };
}

// Função para obter o caminho base da aplicação
function obterCaminhoBase() {
  // Se já estiver definido no index.html, usar
  if (window.__BASE_URL__) {
    return window.__BASE_URL__;
  }
  
  // Caso contrário, calcular a partir do pathname atual
  const protocol = window.location.protocol;
  const host = window.location.host;
  let pathBase = window.location.pathname;
  
  // Se termina com .html, remover o arquivo
  if (pathBase.endsWith('.html')) {
    const lastSlash = pathBase.lastIndexOf('/');
    if (lastSlash > 0) {
      pathBase = pathBase.substring(0, lastSlash + 1);
    } else {
      pathBase = '/';
    }
  } else if (!pathBase.endsWith('/')) {
    pathBase = pathBase + '/';
  }
  
  return protocol + '//' + host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
}

// Função para corrigir URLs relativas para incluir o caminho base
function corrigirUrl(url) {
  if (!url) return url;
  
  // Se já é uma URL completa (http:// ou https://), retornar como está
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Obter o caminho base
  const baseUrl = obterCaminhoBase();
  
  // Se começa com /, adicionar o caminho base
  if (url.startsWith('/')) {
    // Se baseUrl termina com /cargas, a URL /api/auth/login fica https://app.integrabrasil.com:8443/cargas/api/auth/login
    const fullUrl = baseUrl + url;
    console.log('[LOGIN] corrigirUrl:', url, '→', fullUrl, '(baseUrl:', baseUrl + ')');
    return fullUrl;
  }
  
  // Caso contrário, adicionar caminho base + /
  const fullUrl = baseUrl + '/' + url;
  console.log('[LOGIN] corrigirUrl:', url, '→', fullUrl, '(baseUrl:', baseUrl + ')');
  return fullUrl;
}

// Função para inicializar quando DOM estiver pronto
function initLogin() {
  console.log('[LOGIN] Inicializando login...');
  const form = document.getElementById('loginForm');
  const errorMsg = document.getElementById('errorMessage');
  const btn = document.querySelector('.btn');
  const togglePassword = document.getElementById('togglePassword');
  const passwordInput = document.getElementById('password');

  console.log('[LOGIN] Elementos encontrados:', {
    hasForm: !!form,
    hasErrorMsg: !!errorMsg,
    hasBtn: !!btn,
    hasTogglePassword: !!togglePassword,
    hasPasswordInput: !!passwordInput
  });

  function showError(message) {
    if (!errorMsg) return;
    errorMsg.textContent = message;
    errorMsg.classList.remove('login-msg-info');
  }

  try {
    var urlAtual = new URL(window.location.href);
    if (urlAtual.searchParams.get('atlas_sessao') === 'deslocada') {
      urlAtual.searchParams.delete('atlas_sessao');
      var restante = urlAtual.searchParams.toString();
      var pathOnly = urlAtual.pathname + (restante ? '?' + restante : '') + urlAtual.hash;
      window.history.replaceState({}, '', pathOnly);
      if (errorMsg) {
        errorMsg.textContent = tLogin('web.login.sessaoDeslocada');
        errorMsg.classList.add('login-msg-info');
      }
    }
  } catch (eU) { /* ignore */ }

  if (!form) {
    console.error('[LOGIN] Formulário não encontrado! Tentando novamente...');
    // Tentar novamente após um delay se o formulário não foi encontrado
    setTimeout(initLogin, 100);
    return;
  }

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
      showError(tLogin('web.login.preenchaCampos'));
      return;
    }

    // Prepara UI
    showError('');
    btn.disabled = true;
    const btnSpan = btn.querySelector('span');
    const originalText = btnSpan ? btnSpan.textContent : tLogin('web.login.entrar');
    if (btnSpan) btnSpan.textContent = tLogin('web.login.entrando');

    try {
      const baseUrl = obterCaminhoBase();
      const apiUrl = corrigirUrl('/api/auth/login');
      console.log('[LOGIN] Base URL:', baseUrl);
      console.log('[LOGIN] API URL corrigida:', apiUrl);

      var attempt = await postTowerLogin(username, password, false);
      var response = attempt.response;
      var data = attempt.data;

      if (response.status === 409 && data.code === 'CONCURRENT_SESSION_LIMIT') {
        var querEncerrar = await openSessionLimitModal(data);
        if (!querEncerrar) {
          showError(data.message || tLogin('web.login.limiteSessaoTitulo'));
          return;
        }
        attempt = await postTowerLogin(username, password, true);
        response = attempt.response;
        data = attempt.data;
      }

      console.log('[LOGIN] Resposta recebida:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });
      console.log('[LOGIN] Resposta do servidor:', { ok: response.ok, success: data.success, hasToken: !!data.token });

      if (response.ok && data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.idLogAcesso) {
          localStorage.setItem('idLogAcesso', data.idLogAcesso.toString());
        }
        localStorage.setItem('loginTimestamp', Date.now().toString());

        console.log('[LOGIN] Dados salvos no localStorage:', {
          hasToken: !!localStorage.getItem('token'),
          hasUser: !!localStorage.getItem('user')
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        let cleanUrl = baseUrl + '/dashboard.html';
        cleanUrl = cleanUrl.replace(/\?+$/, '');
        console.log('[LOGIN] Redirecionando para:', cleanUrl);
        window.location.replace(cleanUrl);
      } else {
        var failMsg = data.message || tLogin('web.login.credenciaisInvalidas');
        console.error('[LOGIN] Login falhou:', failMsg);
        showError(failMsg);
      }
    } catch (err) {
      console.error('[LOGIN] Erro ao fazer login:', err);
      showError(tLogin('web.login.erroConectarServidor'));
    } finally {
      btn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalText;
    }
  });

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
          errorMessageSenha.textContent = tLogin('web.login.preenchaCampos');
        }
        return;
      }

      if (senhaNova !== senhaConfirmar) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = tLogin('web.login.senhasNaoCoincidem');
        }
        return;
      }

      if (senhaNova.length < 6) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = tLogin('web.login.senhaMinima6');
        }
        return;
      }

      // Limpar erro
      if (errorMessageSenha) errorMessageSenha.textContent = '';

      const btn = formAlterarSenha.querySelector('button[type="submit"]');
      const btnSpan = btn?.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : tLogin('web.login.alterarSenha');
      
      if (btn) btn.disabled = true;
      if (btnSpan) btnSpan.textContent = tLogin('web.login.alterando');

      try {
        const apiUrl = corrigirUrl('/api/auth/alterar-senha');
        const response = await fetch(apiUrl, {
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
            errorMessageSenha.textContent = tLogin('web.login.senhaAlteradaSucesso');
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
            errorMessageSenha.textContent = data.message || tLogin('web.login.erroAlterarSenha');
          }
        }
      } catch (err) {
        if (errorMessageSenha) {
          errorMessageSenha.textContent = tLogin('web.login.erroConectarServidor');
        }
      } finally {
        if (btn) btn.disabled = false;
        if (btnSpan) btnSpan.textContent = originalText;
      }
    });
  }
}

// Executar quando DOM estiver pronto (pode já estar pronto se script carregou depois)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogin);
} else {
  // DOM já está pronto, executar imediatamente
  initLogin();
}
