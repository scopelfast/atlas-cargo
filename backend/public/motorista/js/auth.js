// APP Motorista - Autenticação
// Versão: 1.0

// ==========================================
// FUNÇÕES GLOBAIS DE AUTENTICAÇÃO
// ==========================================

/**
 * Verificar se o usuário está autenticado (token presente e não expirado)
 */
function verificarAuth() {
  const token = localStorage.getItem('token');
  const motorista = localStorage.getItem('motorista');
  if (!token || !motorista) return false;
  if (typeof isTokenExpired === 'function' && isTokenExpired()) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const loginStr = payload.login != null ? String(payload.login).trim() : '';
    if (loginStr !== '' && payload.tipo !== 'motorista') return false;
  } catch (e) {
    return false;
  }
  return true;
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

/** CDCADASTRO a partir do JWT do app motorista (alinha chamadas à API ao token). */
function getMotoristaIdDoToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.tipo === 'motorista') {
      const v = payload.id ?? payload.cdcadastro;
      if (v != null && v !== '') return v;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
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
 * Verificar se token JWT está expirado (payload.exp em segundos)
 */
function isTokenExpired() {
  const token = localStorage.getItem('token');
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return payload.exp < nowSec;
  } catch (e) {
    return true;
  }
}

// ==========================================
// LOGIN FORM (IIFE)
// ==========================================

(function() {
  const loginForm = document.getElementById('loginForm');
  const cpfInput = document.getElementById('cpf');
  const senhaInput = document.getElementById('senha');
  const messageDiv = document.getElementById('message');
  const labelIdentificacao = document.getElementById('labelIdentificacao');
  let modoLogin = 'cpf';

  function textoLogin(chave, fallback) {
    return (typeof window.t === 'function' && window.t(chave) && window.t(chave) !== chave) ? window.t(chave) : fallback;
  }

  function paisLogin() {
    return window.__CONTEXTO_PAIS__ || 'BR';
  }

  let modoEscolhido = false;

  function aplicarModo(modo, limpar) {
    var br = paisLogin() === 'BR';
    if (!br && (modo === 'cpf' || modo === 'cnpj')) modo = 'documento';
    if (br && modo === 'documento') modo = 'cpf';
    var mudou = modo !== modoLogin;
    modoLogin = modo;
    document.querySelectorAll('.modo-login .btn-modo').forEach(function(btn) {
      var m = btn.getAttribute('data-modo');
      var visivel = br ? m !== 'documento' : (m === 'celular' || m === 'documento');
      btn.hidden = !visivel;
      var ativo = m === modoLogin;
      btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    var rotulos = {
      celular: ['login.labelCelular', 'Celular', 'login.phCelular', '(00) 00000-0000', 16],
      cpf: ['login.labelCpf', 'CPF', 'login.phCpf', '000.000.000-00', 14],
      cnpj: ['login.labelCnpj', 'CNPJ', 'login.phCnpj', '00.000.000/0000-00', 18],
      documento: ['login.labelDocumento', 'Documento', 'login.phDocumento', 'Número do documento', 14]
    };
    var r = rotulos[modoLogin];
    if (labelIdentificacao) labelIdentificacao.textContent = textoLogin(r[0], r[1]);
    if (cpfInput) {
      cpfInput.placeholder = textoLogin(r[2], r[3]);
      cpfInput.maxLength = r[4];
      if (limpar && mudou) cpfInput.value = '';
      cpfInput.setAttribute('autocomplete', modoLogin === 'celular' ? 'tel' : 'username');
    }
  }

  document.querySelectorAll('.modo-login .btn-modo').forEach(function(btn) {
    btn.addEventListener('click', function() {
      modoEscolhido = true;
      aplicarModo(btn.getAttribute('data-modo'), true);
      if (cpfInput) cpfInput.focus();
    });
  });

  function ajustarModosAoPais() {
    if (modoEscolhido) {
      aplicarModo(modoLogin, false);
      return;
    }
    aplicarModo(paisLogin() === 'BR' ? 'cpf' : 'documento', false);
  }
  if (window.i18nReady && typeof window.i18nReady.then === 'function') {
    window.i18nReady.then(ajustarModosAoPais);
  } else {
    ajustarModosAoPais();
  }

  // Botão mostrar/ocultar senha
  const btnToggleSenha = document.getElementById('btnToggleSenha');
  if (btnToggleSenha && senhaInput) {
    const iconEye = btnToggleSenha.querySelector('.icon-eye');
    const iconEyeOff = btnToggleSenha.querySelector('.icon-eye-off');
    btnToggleSenha.addEventListener('click', function() {
      const isPassword = senhaInput.type === 'password';
      senhaInput.type = isPassword ? 'text' : 'password';
      if (iconEye && iconEyeOff) {
        iconEye.style.display = isPassword ? 'none' : 'block';
        iconEyeOff.style.display = isPassword ? 'block' : 'none';
      }
      btnToggleSenha.setAttribute('title', isPassword ? 'Ocultar senha' : 'Mostrar senha');
      btnToggleSenha.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    });
  }

  function mascaraCelular(digitos) {
    var d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
    if (d.length > 10) return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    if (d.length > 6) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    if (d.length > 2) return d.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    return d;
  }

  function mascaraCpf(digitos) {
    var d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
    if (d.length > 9) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    if (d.length > 6) return d.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (d.length > 3) return d.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return d;
  }

  function mascaraCnpj(digitos) {
    var d = String(digitos || '').replace(/\D/g, '').slice(0, 14);
    return d.replace(/^(\d{2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2}).*/, function(_, a, b, c, e, f) {
      var s = a;
      if (b) s += '.' + b;
      if (c) s += '.' + c;
      if (e) s += '/' + e;
      if (f) s += '-' + f;
      return s;
    });
  }

  function mascaraCpfCnpj(digitos) {
    var d = String(digitos || '').replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11) {
      if (d.length > 9) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
      if (d.length > 6) return d.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
      if (d.length > 3) return d.replace(/(\d{3})(\d{1,3})/, '$1.$2');
      return d;
    }
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, function (_, a, b, c, e, f) {
      return a + '.' + b + '.' + c + '/' + e + (f ? '-' + f : '');
    });
  }

  function cpfValido(cpf) {
    var d = String(cpf || '').replace(/\D/g, '');
    if (d.length === 10) d = '0' + d;
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    var soma = 0;
    var i;
    for (i = 0; i < 9; i++) soma += parseInt(d.charAt(i), 10) * (10 - i);
    var resto = 11 - (soma % 11);
    if (resto >= 10) resto = 0;
    if (resto !== parseInt(d.charAt(9), 10)) return false;
    soma = 0;
    for (i = 0; i < 10; i++) soma += parseInt(d.charAt(i), 10) * (11 - i);
    resto = 11 - (soma % 11);
    if (resto >= 10) resto = 0;
    return resto === parseInt(d.charAt(10), 10);
  }

  function cnpjValido(cnpj) {
    var d = String(cnpj || '').replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    var tamanho = 12;
    var numeros = d.substring(0, tamanho);
    var digitos = d.substring(tamanho);
    var soma = 0;
    var pos = tamanho - 7;
    var i;
    for (i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    var resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0), 10)) return false;
    tamanho = 13;
    numeros = d.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    return resultado === parseInt(digitos.charAt(1), 10);
  }

  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      var value = e.target.value.replace(/\D/g, '');
      if (modoLogin === 'celular') {
        e.target.value = mascaraCelular(value);
        return;
      }
      if (modoLogin === 'cpf') {
        e.target.value = mascaraCpf(value);
        return;
      }
      if (modoLogin === 'cnpj') {
        e.target.value = mascaraCnpj(value);
        return;
      }
      e.target.value = value.slice(0, 14);
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
      var docOk = false;
      var msgInvalido = textoLogin('login.documentoInvalido', 'Documento inválido!');
      if (modoLogin === 'celular') {
        docOk = cpf.length === 10 || cpf.length === 11;
        msgInvalido = textoLogin('login.celularInvalido', 'Celular inválido. Use o DDD e o número.');
      } else if (modoLogin === 'cpf') {
        docOk = cpfValido(cpf);
      } else if (modoLogin === 'cnpj') {
        docOk = cnpjValido(cpf);
      } else {
        docOk = cpf && cpf.length >= 5 && cpf.length <= 14;
      }
      if (!docOk) {
        showMessage(msgInvalido, 'error');
        return;
      }

      if (!senha) {
        showMessage(window.t ? window.t('login.senhaObrigatoria') : 'Digite sua senha!', 'error');
        return;
      }

      try {
        console.log('🔐 Tentando fazer login com documento:', cpf.replace(/\d(?=\d{4})/g, '*'));
        
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
          body: JSON.stringify({ cpf, senha, tipo: modoLogin })
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
          const mensagemErro = (data.errorKey && typeof window.t === 'function')
            ? window.t(data.errorKey)
            : (data.error || data.message || 'Erro ao fazer login');
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

