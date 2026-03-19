// backend/public/js/dashboard.js
// Função de inicialização que funciona mesmo com scripts carregados dinamicamente
(function() {
  // Função helper global para corrigir URLs relativas para incluir o caminho base
  const corrigirUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    
    // Obter baseUrl - sempre verificar __BASE_URL__ primeiro
    let baseUrl = window.__BASE_URL__;
    
    // Se não estiver definido, calcular a partir do pathname
    if (!baseUrl) {
      const pathname = window.location.pathname;
      let pathBase = '/';
      
      // Detectar se está em /cargas/ ou /motorista/
      if (pathname.includes('/cargas')) {
        pathBase = '/cargas/';
      } else if (pathname.includes('/motorista')) {
        pathBase = '/motorista/';
      } else if (pathname !== '/') {
        // Pegar o primeiro segmento do path
        const segments = pathname.split('/').filter(s => s);
        if (segments.length > 0) {
          pathBase = '/' + segments[0] + '/';
        }
      }
      
      baseUrl = window.location.protocol + '//' + window.location.host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
    }
    
    // Garantir que baseUrl não termine com / antes de concatenar
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const cleanUrl = url.startsWith('/') ? url : '/' + url;
    
    return cleanBaseUrl + cleanUrl;
  };
  
  // Verificar se o DOM já está pronto
  const init = () => {
    // Variáveis globais para controle de timeout
    let inactivityTimer = null;
    let lastActivityTime = Date.now();
    const TIMEOUT_MINUTES = 60; // 60 minutos de inatividade
    const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;

  // Função para verificar timeout e fazer logout automático
  const verificarTimeout = () => {
    const loginTimestamp = parseInt(localStorage.getItem('loginTimestamp') || '0');
    const now = Date.now();
    const tempoInativo = now - lastActivityTime;
    const tempoTotal = now - loginTimestamp;

    // Se passou mais de 60 minutos desde a última atividade OU mais de 8 horas desde o login
    if (tempoInativo > TIMEOUT_MS || tempoTotal > (8 * 60 * 60 * 1000)) {
      fazerLogout(true); // true = logout automático por timeout
      return;
    }

    // Agendar próxima verificação em 1 minuto
    inactivityTimer = setTimeout(verificarTimeout, 60000);
  };

  // Função para atualizar última atividade
  const atualizarAtividade = () => {
    lastActivityTime = Date.now();
    // Resetar timer de inatividade
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(verificarTimeout, 60000);
  };

  // Eventos que indicam atividade do usuário
  const eventosAtividade = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  eventosAtividade.forEach(evento => {
    document.addEventListener(evento, atualizarAtividade, { passive: true });
  });

  // Modo escuro: aplicar tema salvo e botão de alternância
  (function() {
    const KEY = 'theme';
    const root = document.documentElement;
    const btn = document.getElementById('themeToggleBtn');
    const icon = document.getElementById('themeToggleIcon');
    function getTheme() { return localStorage.getItem(KEY) || 'light'; }
    function setTheme(theme) {
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        if (icon) { icon.className = 'bx bx-sun'; }
        if (btn) btn.setAttribute('title', 'Ativar modo claro');
      } else {
        root.removeAttribute('data-theme');
        if (icon) { icon.className = 'bx bx-moon'; }
        if (btn) btn.setAttribute('title', 'Ativar modo escuro');
      }
      localStorage.setItem(KEY, theme);
    }
    setTheme(getTheme());
    if (btn) {
      btn.addEventListener('click', function() {
        setTheme(getTheme() === 'dark' ? 'light' : 'dark');
      });
    }
  })();

  // Função para fazer logout (manual ou automático)
  const fazerLogout = async (automatico = false) => {
    // Limpar timers
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }

    // Remover listeners de atividade
    eventosAtividade.forEach(evento => {
      document.removeEventListener(evento, atualizarAtividade);
    });

    // Registrar logout no backend
    const idLogAcesso = localStorage.getItem('idLogAcesso');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    if (idLogAcesso || user.login) {
      try {
        const apiUrl = corrigirUrl('/api/auth/logout');
        await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            idLogAcesso: idLogAcesso ? parseInt(idLogAcesso) : null,
            sgUsuario: user.login || null
          })
        });
      } catch (err) {
        // Silencioso - não bloquear logout se houver erro
        console.error('Erro ao registrar logout:', err);
      }
    }

    // Limpar cache e storage
    sessionStorage.clear();
    localStorage.clear();

    // Limpar cache do navegador (forçar reload)
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }

    // Redirecionar para login
    if (automatico) {
      // Usar showMessage do padrão do sistema se disponível
      if (typeof window.showMessage === 'function') {
        showMessage('Sessão expirada por inatividade. Faça login novamente.', 'error');
        // Aguardar um pouco para o usuário ver a mensagem antes de redirecionar
        setTimeout(() => {
          // Usar caminho base correto (/cargas/)
          const baseUrl = window.__BASE_URL__ || window.location.origin;
          const pathBase = baseUrl.includes('/cargas') ? '/cargas' : '';
          let cleanUrl = window.location.origin + pathBase + '/';
          // Garantir que não tenha ? no final
          cleanUrl = cleanUrl.replace(/\?+$/, '');
          // Usar replace para não adicionar ao histórico e evitar ?
          window.location.replace(cleanUrl);
        }, 2000);
        return;
      }
    }
    // Remover ? e usar replace para não adicionar ao histórico
    // Usar caminho base correto (/cargas/)
    const baseUrl = window.__BASE_URL__ || window.location.origin;
    const pathBase = baseUrl.includes('/cargas') ? '/cargas' : '';
    let cleanUrl = window.location.origin + pathBase + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
  };

  const initDashboard = async () => {
    // Aplicar traduções do painel web (header, menu, etc.) quando o locale estiver pronto
    if (window.i18nWebReady && typeof window.applyI18nWeb === 'function') {
      await window.i18nWebReady;
      window.applyI18nWeb();
    }
    // Proteção anti-loop melhorada
    const loopCount = parseInt(sessionStorage.getItem('dashboardLoopCount') || '0');
    if (loopCount > 5) {
      console.error('❌ Loop detectado! Limpando e parando...');
      sessionStorage.clear();
      localStorage.clear();
      // Parar completamente - não redirecionar mais
      document.body.innerHTML = '<div style="padding: 50px; text-align: center;"><h2>Erro de Loop Detectado</h2><p>Por favor, limpe o cache do navegador e faça login novamente.</p><button onclick="location.reload()" style="padding: 10px 20px; margin-top: 20px;">Recarregar Página</button></div>';
      return;
    }
    
    // Incrementar contador ANTES de qualquer verificação
    sessionStorage.setItem('dashboardLoopCount', (loopCount + 1).toString());
    
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    let user = null;
    
    try {
      user = userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      console.error('❌ Erro ao fazer parse do user:', e);
      sessionStorage.removeItem('dashboardLoopCount');
      window.__DASHBOARD_INITIALIZING__ = false;
      localStorage.clear();
      // Remover ? e usar replace para não adicionar ao histórico
    // Usar protocolo atual da página
    const protocol = window.location.protocol;
    let cleanUrl = protocol + '//' + window.location.host + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
      return;
    }

    if (!token || !user) {
      console.warn('⚠️ Token ou user ausente, redirecionando para login');
      sessionStorage.removeItem('dashboardLoopCount');
      window.__DASHBOARD_INITIALIZING__ = false;
      localStorage.clear();
      // Remover ? e usar replace para não adicionar ao histórico
    // Usar protocolo atual da página
    const protocol = window.location.protocol;
    let cleanUrl = protocol + '//' + window.location.host + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
      return;
    }

    // Verificar se já passou muito tempo desde o login
    const loginTimestamp = parseInt(localStorage.getItem('loginTimestamp') || '0');
    if (!loginTimestamp || (Date.now() - loginTimestamp) > (8 * 60 * 60 * 1000)) {
      console.warn('⚠️ Sessão expirada (mais de 8 horas)');
      window.__DASHBOARD_INITIALIZING__ = false;
      fazerLogout(true);
      return;
    }
    
    // Se chegou até aqui, tudo está OK - resetar contador imediatamente
    sessionStorage.removeItem('dashboardLoopCount');
    window.__DASHBOARD_INITIALIZING__ = false;

    // Inicializar controle de atividade
    lastActivityTime = Date.now();
    atualizarAtividade();

    const userNameEl = document.getElementById('userName');
    const userEmailEl = document.getElementById('userEmail');
    
    if (userNameEl) {
      userNameEl.textContent = user.nome || 'Usuário';
    }
    
    if (userEmailEl) {
      userEmailEl.textContent = user.email || '';
    }

    await loadUserMenu(user.login);

    // Aguardar um pouco para garantir que o sistema de permissões esteja carregado
    await new Promise(resolve => setTimeout(resolve, 500));

    // Carregar tela inicial automaticamente após login
    if (typeof window.showWelcomeScreen === 'function') {
      await window.showWelcomeScreen();
    } else {
      // Aguardar um pouco se a função ainda não estiver disponível
      setTimeout(async () => {
        if (typeof window.showWelcomeScreen === 'function') {
          await window.showWelcomeScreen();
        }
      }, 300);
    }

    // Vincula botão de logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      fazerLogout(false); // false = logout manual
    });

    // Seletor de idioma no dashboard (Plano multimoeda)
    (function() {
      var preferred = (typeof localStorage !== 'undefined' && localStorage.getItem('preferredLocale')) || 'pt-BR';
      if (preferred.toLowerCase() === 'es-py') preferred = 'es-PY';
      else if (preferred.toLowerCase() !== 'pt-br') preferred = 'pt-BR';
      document.querySelectorAll('.btn-idioma-dash').forEach(function(btn) {
        var loc = btn.getAttribute('data-locale');
        if (loc === preferred) btn.classList.add('active');
        btn.addEventListener('click', function() {
          try { localStorage.setItem('preferredLocale', loc); } catch (e) {}
          window.location.reload();
        });
      });
    })();

    // Vincula clique no logo para voltar ao início
    document.getElementById('logoAtlasCargo')?.addEventListener('click', () => {
      if (typeof window.showWelcomeScreen === 'function') {
        window.showWelcomeScreen();
      } else {
        // Fallback se a função ainda não estiver disponível
        setTimeout(() => {
          if (typeof window.showWelcomeScreen === 'function') {
            window.showWelcomeScreen();
          }
        }, 100);
      }
    });

    // Botões Chat e SOS no header: abrir módulo correspondente
    document.getElementById('headerBtnChat')?.addEventListener('click', () => {
      if (typeof window.loadModuleContent === 'function') window.loadModuleContent('chat');
    });
    document.getElementById('headerBtnAlertas')?.addEventListener('click', () => {
      if (typeof window.loadModuleContent === 'function') window.loadModuleContent('alertas');
    });
    document.getElementById('headerBtnSos')?.addEventListener('click', () => {
      if (typeof window.loadModuleContent === 'function') window.loadModuleContent('sos');
    });

    // Aplicar identidade visual configurada (logos)
    fetch(corrigirUrl('/api/configuracoes/identidade'))
      .then(r => r.json())
      .then(data => {
        const logoRetangular = (data.logoRetangular || 'logoAtlasTransparente.png').replace(/[^a-zA-Z0-9._-]/g, '');
        const logoQuadrada = (data.logoQuadrada || 'logoAtlasTransparenteQuadrada.png').replace(/[^a-zA-Z0-9._-]/g, '');
        const favicon = document.getElementById('faviconLink');
        if (favicon) favicon.href = corrigirUrl('/img/' + logoQuadrada);
        const logoImg = document.querySelector('#logoAtlasCargo img.logo-img');
        if (logoImg) logoImg.src = corrigirUrl('/img/' + logoRetangular);
      })
      .catch(() => {});

    // Inicializar toggle do menu
    initMenuToggle();
    
    // Inicializar AudioContext na primeira interação
    inicializarAudioContext();
    
    // Inicializar atualização automática de contadores e sons
    inicializarAtualizacaoContadores();
  };

  // AudioContext global (só criado após primeiro gesto do usuário - política do navegador)
  let globalAudioContext = null;
  let audioContextUnlocked = false;

  /**
   * Obter ou criar AudioContext (apenas se já foi desbloqueado por gesto do usuário)
   */
  const obterAudioContext = async () => {
    if (!audioContextUnlocked) return null;
    try {
      if (!globalAudioContext) {
        globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (globalAudioContext.state === 'suspended') {
        await globalAudioContext.resume();
      }
      return globalAudioContext;
    } catch (err) {
      return null;
    }
  };

  /**
   * Função para tocar som de notificação (global)
   */
  const tocarSomNotificacao = async (tipo = 'geral') => {
    try {
      // Verificar se som está habilitado
      const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
      if (!somHabilitado) {
        return;
      }

      const audioContext = await obterAudioContext();
      if (!audioContext) {
        // Se não conseguir obter o contexto, silenciosamente falhar
        return;
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Frequências diferentes por tipo
      const frequencies = {
        'sos': 1000,
        'alerta': 800,
        'chat': 600,
        'geral': 500
      };

      oscillator.frequency.value = frequencies[tipo] || 500;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      // Silenciosamente falhar - não logar erro para não poluir o console
      // O som só funcionará após interação do usuário (política do navegador)
    }
  };

  /**
   * Inicializar AudioContext na primeira interação do usuário (obrigatório para não gerar aviso no console)
   */
  const inicializarAudioContext = () => {
    const eventos = ['click', 'touchstart', 'keydown'];
    const unlock = async () => {
      audioContextUnlocked = true;
      try {
        if (!globalAudioContext) {
          globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (globalAudioContext.state === 'suspended') {
          await globalAudioContext.resume();
        }
      } catch (e) {}
      eventos.forEach(ev => document.removeEventListener(ev, unlock));
    };
    eventos.forEach(ev => document.addEventListener(ev, unlock, { once: true, passive: true }));
  };

  /**
   * Obter headers de autenticação
   */
  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  /**
   * Atualizar contador de Chat
   */
  /**
   * ID do usuário para contador de chat (badge). Se não tiver cdcadastro/id, usa hash do login
   * para que o badge funcione também para admin/usuários sem cadastro vinculado.
   */
  const getIdUsuarioParaBadgeChat = () => {
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) return null;
      const user = JSON.parse(userStr);
      const id = user.cdcadastro ?? user.id ?? user.CDCADASTRO;
      if (id != null && id !== '') {
        const num = typeof id === 'number' ? id : parseFloat(id);
        if (Number.isFinite(num)) return num;
      }
      const login = (user.login ?? user.LOGIN ?? user.SGUSUARIO ?? '').toString();
      if (!login) return null;
      let hash = 0;
      for (let i = 0; i < login.length; i++) {
        hash = ((hash << 5) - hash) + login.charCodeAt(i);
        hash = hash & 0x7FFFFFFF;
      }
      return hash || 1;
    } catch (e) {
      return null;
    }
  };

  const atualizarContadorChat = async (ultimoContador = {}) => {
    try {
      const idUsuario = getIdUsuarioParaBadgeChat();
      if (idUsuario == null) return;

      const apiUrl = corrigirUrl(`/api/chat/nao-lidas?idUsuario=${idUsuario}&userType=OPERADOR`);
      const response = await fetch(apiUrl, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const total = data.data.total || 0;
          
          // Atualizar badge no menu: data-programa="chat" ou item cujo texto contém "Chat"
          let menuItem = document.querySelector('[data-programa="chat"]');
          if (!menuItem) {
            const items = document.querySelectorAll('.menu-item');
            for (const el of items) {
              if (el.textContent && el.textContent.includes('Chat')) {
                menuItem = el;
                break;
              }
            }
          }
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (total > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = total > 99 ? '99+' : total.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          const headerBadgeChat = document.getElementById('headerBadgeChat');
          if (headerBadgeChat) {
            headerBadgeChat.textContent = total > 99 ? '99+' : total.toString();
            headerBadgeChat.style.display = total > 0 ? 'inline-flex' : 'none';
            headerBadgeChat.setAttribute('data-count', total);
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (total > (ultimoContador.chat || 0)) {
            tocarSomNotificacao('chat').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return total;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador do chat:', err);
    }
    return ultimoContador.chat || 0;
  };

  /**
   * Atualizar contador de Alertas
   */
  const atualizarContadorAlertas = async (ultimoContador = {}) => {
    try {
      const apiUrl = corrigirUrl('/api/alertas/contador');
      const response = await fetch(apiUrl, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const pendentes = parseInt(data.data.pendentes) || 0;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="alertas"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (pendentes > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = pendentes > 99 ? '99+' : pendentes.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          
          // Atualizar badge e estado vermelho no header
          const headerBadgeAlertas = document.getElementById('headerBadgeAlertas');
          const headerBtnAlertas = document.getElementById('headerBtnAlertas');
          if (headerBadgeAlertas) {
            headerBadgeAlertas.textContent = pendentes > 99 ? '99+' : pendentes.toString();
            headerBadgeAlertas.style.display = pendentes > 0 ? 'inline-flex' : 'none';
            headerBadgeAlertas.setAttribute('data-count', pendentes);
          }
          if (headerBtnAlertas) {
            if (pendentes > 0) {
              headerBtnAlertas.classList.add('has-alerts');
            } else {
              headerBtnAlertas.classList.remove('has-alerts');
            }
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (pendentes > (ultimoContador.alertas || 0)) {
            tocarSomNotificacao('alerta').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return pendentes;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador de alertas:', err);
    }
    return ultimoContador.alertas || 0;
  };

  /**
   * Atualizar contador de SOS
   */
  const atualizarContadorSOS = async (ultimoContador = {}) => {
    try {
      const apiUrl = corrigirUrl('/api/sos/contador');
      const response = await fetch(apiUrl, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const ativos = parseInt(data.data.ativos) || 0;
          const emTratamento = parseInt(data.data.emTratamento) || 0;
          const totalPendentes = ativos + emTratamento;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="sos"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (totalPendentes > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = totalPendentes > 99 ? '99+' : totalPendentes.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          const headerBadgeSos = document.getElementById('headerBadgeSos');
          if (headerBadgeSos) {
            headerBadgeSos.textContent = totalPendentes > 99 ? '99+' : totalPendentes.toString();
            headerBadgeSos.style.display = totalPendentes > 0 ? 'inline-flex' : 'none';
            headerBadgeSos.setAttribute('data-count', totalPendentes);
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (totalPendentes > (ultimoContador.sos || 0)) {
            tocarSomNotificacao('sos').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return totalPendentes;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador de SOS:', err);
    }
    return ultimoContador.sos || 0;
  };

  /**
   * Atualizar todos os contadores
   */
  const atualizarTodosContadores = async () => {
    try {
      // Obter último estado salvo
      let ultimoContador = {};
      try {
        const saved = localStorage.getItem('ultimoContador');
        if (saved) {
          ultimoContador = JSON.parse(saved);
          // Limpar se muito antigo (mais de 1 hora)
          if (ultimoContador.timestamp && (Date.now() - ultimoContador.timestamp) > 3600000) {
            ultimoContador = {};
          }
        }
      } catch (e) {
        ultimoContador = {};
      }
      
      // Atualizar todos em paralelo
      const [chat, alertas, sos] = await Promise.all([
        atualizarContadorChat(ultimoContador),
        atualizarContadorAlertas(ultimoContador),
        atualizarContadorSOS(ultimoContador)
      ]);
      
      // Salvar estado atual
      localStorage.setItem('ultimoContador', JSON.stringify({
        chat,
        alertas,
        sos,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.warn('Erro ao atualizar contadores:', err);
    }
  };

  /**
   * Inicializar atualização automática de contadores
   */
  const inicializarAtualizacaoContadores = () => {
    // Atualizar imediatamente
    atualizarTodosContadores();
    
    // Atualizar a cada 30 segundos
    setInterval(() => {
      atualizarTodosContadores();
    }, 30000);
    
    // Quando o módulo Alertas tratar um alerta, atualizar contador do header na hora
    document.addEventListener('alertas-contador-atualizado', () => {
      atualizarContadorAlertas({}).catch(() => {});
    });

    // Socket.IO: receber em tempo real mensagens (chat), alertas e SOS (som + badge) na tela web
    inicializarSocketDashboard();
  };

  /**
   * Obter path base para Socket.IO quando a aplicação está sob um subpath (ex.: /cargas)
   */
  function getSocketIoPath() {
    const base = (typeof window.__BASE_URL__ !== 'undefined' && window.__BASE_URL__) ? window.__BASE_URL__ : '';
    if (base && base.startsWith('http')) {
      const match = base.match(/^https?:\/\/[^/]+(\/.*)?$/);
      return (match && match[1]) ? match[1].replace(/\/$/, '') + '/socket.io' : '/socket.io';
    }
    if (window.location.pathname.includes('/cargas')) return '/cargas/socket.io';
    if (window.location.pathname.includes('/motorista')) return '/motorista/socket.io';
    return '/socket.io';
  }

  /**
   * Conectar ao Socket.IO: chat (nova-mensagem), torre (alertas e SOS) para som + badge no dashboard
   */
  function inicializarSocketDashboard() {
    const hasChat = !!document.querySelector('[data-programa="chat"]');
    const hasAlertas = !!document.querySelector('[data-programa="alertas"]');
    const hasSos = !!document.querySelector('[data-programa="sos"]');
    if (!hasChat && !hasAlertas && !hasSos) return;

    function conectar() {
      if (typeof io === 'undefined') return;
      const path = getSocketIoPath();
      const opts = { transports: ['websocket', 'polling'] };
      if (path !== '/socket.io') opts.path = path;
      const socket = io(window.location.origin, opts);

      socket.on('connect', () => {
        if (hasChat) {
          fetch(corrigirUrl('/api/chat/conversas?limit=200'), { headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : { data: [] })
            .then(data => {
              const conversas = Array.isArray(data.data) ? data.data : (data.data && data.data.data) ? data.data.data : [];
              const viagensJaEntradas = new Set();
              conversas.forEach(c => {
                if (c.ID_VIAGEM != null && !viagensJaEntradas.has(Number(c.ID_VIAGEM))) {
                  socket.emit('join-viagem', c.ID_VIAGEM);
                  viagensJaEntradas.add(Number(c.ID_VIAGEM));
                }
                if (c.ID != null) socket.emit('join-conversa', c.ID);
              });
            })
            .catch(() => {});
        }
        if (hasAlertas || hasSos) {
          socket.emit('torre:join-all');
        }
      });

      if (hasChat) {
        socket.on('nova-mensagem', (mensagem) => {
          const isMotorista = (mensagem.SENDER_TYPE || '').toUpperCase() === 'MOTORISTA';
          if (!isMotorista) return;
          atualizarContadorChat({}).catch(() => {});
          tocarSomNotificacao('chat').catch(() => {});
        });
      }

      if (hasAlertas) {
        socket.on('torre:novo-alerta', () => {
          atualizarContadorAlertas({}).catch(() => {});
          tocarSomNotificacao('alerta').catch(() => {});
        });
      }

      if (hasSos) {
        socket.on('torre:sos-alerta', () => {
          atualizarContadorSOS({}).catch(() => {});
          tocarSomNotificacao('sos').catch(() => {});
        });
      }
    }

    if (typeof io !== 'undefined') {
      conectar();
      return;
    }
    const script = document.createElement('script');
    script.src = corrigirUrl('/socket.io/socket.io.js');
    script.onload = () => setTimeout(conectar, 100);
    document.head.appendChild(script);
  }

  // Função para inicializar o toggle do menu
  const initMenuToggle = () => {
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    const toggleBtn = document.getElementById('toggleMenuBtn');
    const toggleIcon = toggleBtn?.querySelector('i');

    const updateToggleState = (collapsed) => {
      if (toggleIcon) toggleIcon.className = collapsed ? 'bx bx-menu' : 'bx bx-menu';
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        const titleExpanded = toggleBtn.getAttribute('data-i18n-title-expanded');
        const titleCollapsed = toggleBtn.getAttribute('data-i18n-title-collapsed');
        const t = typeof window.tWeb === 'function' ? window.tWeb : (k) => k;
        toggleBtn.title = collapsed ? (titleCollapsed ? t(titleCollapsed) : 'Expandir menu') : (titleExpanded ? t(titleExpanded) : 'Recolher menu');
      }
    };

    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      sidebar?.classList.add('collapsed');
      main?.classList.add('sidebar-collapsed');
      updateToggleState(true);
    } else {
      updateToggleState(false);
    }

    toggleBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('collapsed');
      main?.classList.toggle('sidebar-collapsed');
      const collapsed = sidebar?.classList.contains('collapsed');
      updateToggleState(collapsed);
      localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
    });
  };

  const loadUserMenu = async (userLogin) => {
    try {
      const token = localStorage.getItem('token');
      const url = corrigirUrl('/api/menu/user-menu');
      
      const response = await fetch(url, {
        headers: { 
          'user-login': userLogin,
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      const menuContainer = document.getElementById('menuContainer');
      if (!menuContainer) {
        console.error('❌ Elemento menuContainer não encontrado!');
        return;
      }

      if (response.ok && data.menu && data.menu.length > 0) {
        const _tMenu = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
        // Mapeamento de ícones por grupo (alinhado ao backend: Cadastros, Equipamentos, Logística, Gestão, System)
        const iconesPorGrupo = {
          'CADASTROS': 'bx-file-blank',
          'EQUIPAMENTOS': 'bx-package',
          'LOGÍSTICA': 'bx-trip',
          'GESTÃO': 'bx-cog',
          'SYSTEM': 'bx-user-circle',
          'VIAGENS & LOGÍSTICA': 'bx-trip',
          'GESTÃO & ADMINISTRAÇÃO': 'bx-cog',
          'OUTROS': 'bx-grid-alt'
        };

        // Ordem de exibição dos grupos no menu
        const ordemGrupos = ['CADASTROS', 'EQUIPAMENTOS', 'LOGÍSTICA', 'GESTÃO', 'SYSTEM', 'OUTROS'];

        // Agrupar itens por grupo (normalizado pelo backend)
        const gruposMap = {};
        data.menu.forEach(item => {
          const iconName = getIcon(item.id);
          const iconClass = iconName.startsWith('bxs-') ? `bxs ${iconName}` : `bx bx-${iconName}`;
          const programa = item.programa || 'default';
          const grupo = (item.grupo || 'OUTROS').toUpperCase().trim();
          if (!gruposMap[grupo]) {
            gruposMap[grupo] = {
              nome: grupo,
              icon: iconesPorGrupo[grupo] || iconesPorGrupo['OUTROS'],
              items: []
            };
          }
          gruposMap[grupo].items.push({ ...item, iconClass, programa });
        });

        const gruposOrdenados = Object.entries(gruposMap)
          .filter(([key, grupo]) => grupo.items.length > 0)
          .sort(([keyA, grupoA], [keyB, grupoB]) => {
            const indexA = ordemGrupos.indexOf(keyA);
            const indexB = ordemGrupos.indexOf(keyB);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return grupoA.nome.localeCompare(grupoB.nome);
          });
        
        menuContainer.innerHTML = gruposOrdenados
          .map(([key, grupo]) => {
            const grupoId = `grupo-${key.replace(/\s+/g, '-').toLowerCase()}`;
            const isExpanded = localStorage.getItem(`menu-grupo-${key}`) !== 'false'; // Por padrão expandido
            
            const grupoLabel = _tMenu('web.menu.grupo.' + key) || grupo.nome;
            return `
              <div class="menu-category">
                <div class="menu-category-header" data-grupo="${key}">
                  <i class='bx ${grupo.icon}'></i>
                  <span>${grupoLabel}</span>
                  <i class='bx ${isExpanded ? 'bx-chevron-down' : 'bx-chevron-right'} menu-category-toggle'></i>
                </div>
                <div class="menu-category-items" data-grupo-items="${key}" style="display: ${isExpanded ? 'block' : 'none'};">
                  ${grupo.items.map(item => {
                    // Prioridade: nome do banco (Gerenciar Tipos de Atividade) → tradução → fallback
                    const nomeBanco = (item.nome && String(item.nome).trim()) ? String(item.nome).trim() : '';
                    const itemLabel = nomeBanco || _tMenu('web.menu.item.' + (item.programa || '')) || item.nome || '';
                    return `
                    <div class="menu-item" data-id="${item.id}" data-programa="${item.programa}">
                      <i class='${item.iconClass}'></i>
                      <span>${itemLabel}</span>
                    </div>
                  `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('');

        // Event listeners para grupos (expandir/colapsar)
        const categoryHeaders = document.querySelectorAll('.menu-category-header');
        categoryHeaders.forEach(header => {
          header.addEventListener('click', (e) => {
            e.stopPropagation();
            const grupoKey = header.getAttribute('data-grupo');
            const itemsContainer = document.querySelector(`[data-grupo-items="${grupoKey}"]`);
            const toggleIcon = header.querySelector('.menu-category-toggle');
            
            if (itemsContainer) {
              const isExpanded = itemsContainer.style.display !== 'none';
              itemsContainer.style.display = isExpanded ? 'none' : 'block';
              
              // Atualizar ícone
              if (toggleIcon) {
                toggleIcon.className = isExpanded 
                  ? 'bx bx-chevron-right menu-category-toggle'
                  : 'bx bx-chevron-down menu-category-toggle';
              }
              
              // Salvar estado
              localStorage.setItem(`menu-grupo-${grupoKey}`, !isExpanded);
            }
          });
        });
        
        // Event listeners para itens do menu
        const menuItems = document.querySelectorAll('.menu-item');

        menuItems.forEach(el => {
          el.addEventListener('click', () => {
            // Buscar por data-programa (correto) ou data-program (fallback)
            const programa = el.getAttribute('data-programa') || el.getAttribute('data-program');
            console.log('🔍 Clique no menu:', {
              elemento: el,
              dataPrograma: el.getAttribute('data-programa'),
              dataProgram: el.getAttribute('data-program'),
              programa: programa,
              nome: el.querySelector('span')?.textContent
            });
            
            if (programa && programa !== 'default') {
              console.log('✅ Carregando módulo:', programa);
              loadModuleContent(programa);
            } else {
              console.warn('⚠️ Programa não encontrado ou é default:', programa);
              document.getElementById('contentArea').innerHTML = `
                <h3>${el.querySelector('span').textContent}</h3>
                <p>Este módulo ainda não foi implementado.</p>
                <p style="font-size: 12px; color: #999; margin-top: 10px;">
                  Debug: programa="${programa || 'null'}"
                </p>
              `;
            }
          });
        });

        // Mostrar botões Chat, Alertas e SOS no header apenas se o usuário tiver o item no menu
        const headerShortcuts = document.getElementById('headerShortcuts');
        const headerBtnChat = document.getElementById('headerBtnChat');
        const headerBtnAlertas = document.getElementById('headerBtnAlertas');
        const headerBtnSos = document.getElementById('headerBtnSos');
        const hasChat = !!document.querySelector('[data-programa="chat"]');
        const hasAlertas = !!document.querySelector('[data-programa="alertas"]');
        const hasSos = !!document.querySelector('[data-programa="sos"]');
        if (headerShortcuts) {
          headerShortcuts.style.display = (hasChat || hasAlertas || hasSos) ? 'flex' : 'none';
        }
        if (headerBtnChat) {
          headerBtnChat.style.display = hasChat ? 'inline-flex' : 'none';
        }
        if (headerBtnAlertas) {
          headerBtnAlertas.style.display = hasAlertas ? 'inline-flex' : 'none';
        }
        if (headerBtnSos) {
          headerBtnSos.style.display = hasSos ? 'inline-flex' : 'none';
        }
      } else {
        const semPerm = (typeof window.tWeb === 'function' ? window.tWeb('web.menu.semPermissoes') : 'Sem permissões');
        menuContainer.innerHTML = '<div class="menu-item"><span>' + semPerm + '</span></div>';
      }
    } catch (err) {
      console.error('❌ Erro ao carregar menu:', err);
      const menuContainer = document.getElementById('menuContainer');
      if (menuContainer) {
        const errMsg = (typeof window.tWeb === 'function' ? window.tWeb('web.menu.erroConexao') : 'Erro de conexão');
        menuContainer.innerHTML = '<div class="menu-item"><span>❌ ' + errMsg + '</span></div>';
      }
    }
  };

  const getIcon = (id) => {
    // Converter ID para número inteiro (CDTIPOATIVIDADE é sempre inteiro)
    const idNum = parseInt(id);
    
    // Mapeamento de ícones por CDTIPOATIVIDADE baseado na tabela TIPOATIVIDADE
    const icons = {
      1: 'id-card',           // 1.0.Cadastro Geral
      2: 'bar-chart',         // 8.1.Relatório
      3: 'user',              // 9.1.Usuário
      4: 'bxs-truck',         // 0.2.Transportes - CORRIGIDO (usando bxs-truck que existe no CSS)
      5: 'cog',               // Tipo de atividade genérico
      10: 'purchase-tag',     // 2.1.Marca
      11: 'tag',              // 2.2.Tipo (Equipamento)
      12: 'car',              // 2.3.Modelo
      13: 'collection',       // 2.4.Grupo
      14: 'package',          // 2.0.Equipamento
      20: 'map',              // 1.1.Cidade
      21: 'tag',              // 3.1.Tipo (Viagem)
      22: 'check-circle',     // 3.2.Situação
      23: 'layer',            // 3.3.Classe Frota
      24: 'directions',       // 3.4.Roteiro - CORRIGIDO (usando directions que existe no CSS)
      25: 'trip',             // 3.0.Viagem
      30: 'upload',           // 0.3.Divulgações
      31: 'building',         // 4.0.Empresas
      32: 'store',            // 4.1.Filiais
      33: 'bar-chart-alt',    // 3.5.Relatório Convocações
      40: 'bell',             // 4.0.Alertas - NOVO (bx-bell)
      41: 'message',          // 4.1.Chat - NOVO (bx-message)
      42: 'error-circle',     // 4.2.SOS - NOVO (bx-error-circle)
      43: 'trophy'             // 4.3.Ranking - NOVO (bx-trophy)
    };
    
    // Retornar o ícone correspondente ou fallback padrão
    const icon = icons[idNum] || 'grid';
    
    return icon;
  };

  const loadModuleContent = async (programa, params = {}) => {
    // REMOVER TODOS OS MODAIS DE AJUDA DO DOM ao trocar de módulo
    // Buscar todos os modais de ajuda criados dinamicamente
    const modaisAjuda = document.querySelectorAll('[id*="modalAjuda"], [id*="ModalAjuda"], [id*="Ajuda"][class*="modal"]');
    modaisAjuda.forEach(modal => {
      modal.remove(); // Remover completamente do DOM
    });
    
    // Fechar todos os modais abertos antes de carregar novo módulo
    const modaisAbertos = document.querySelectorAll('.modal-tratamento.active, .modal.active, [class*="modal"][class*="active"]');
    modaisAbertos.forEach(modal => {
      modal.classList.remove('active');
      modal.style.display = 'none';
      // Se for modal de ajuda, remover do DOM
      if (modal.id && (modal.id.includes('Ajuda') || modal.id.includes('ajuda'))) {
        modal.remove();
      }
    });
    
    // Chamar funções de fechamento globais se existirem (padrão: fecharModal*)
    Object.keys(window).forEach(key => {
      if (typeof window[key] === 'function' && key.startsWith('fecharModal')) {
        try {
          window[key]();
        } catch (e) {
          // Ignorar erros ao chamar funções de fechamento
        }
      }
    });
    
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<p>Carregando módulo...</p>';

    try {
      // Lista de módulos que PRECISAM de map-config.js (têm mapas)
      const modulosComMapa = [
        'gerenciar-viagens',
        'gerenciar-roteiros',
        'relatorio-convocacoes'
      ];
      
      // Só carregar map-config.js se o módulo realmente precisa de mapa
      if (modulosComMapa.includes(programa)) {
        // IMPORTANTE: Garantir que map-config.js está carregado ANTES de carregar o módulo
        if (!window.MAP_CONFIG || !window.getTileServerUrl) {
          console.log('📍 [DASHBOARD] Carregando map-config.js antes do módulo...');
          await new Promise((resolve, reject) => {
            // Verificar se já está carregando
            const mapConfigUrl = corrigirUrl('/js/map-config.js');
            if (document.querySelector(`script[src="${mapConfigUrl}"]`)) {
              // Aguardar até estar disponível
              const checkInterval = setInterval(() => {
                if (window.MAP_CONFIG && window.getTileServerUrl) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 50);
              setTimeout(() => {
                clearInterval(checkInterval);
                if (!window.MAP_CONFIG) {
                  console.warn('⚠️ [DASHBOARD] map-config.js não carregou a tempo');
                }
                resolve();
              }, 2000);
            } else {
              // Carregar map-config.js
              const script = document.createElement('script');
              script.src = corrigirUrl('/js/map-config.js');
              script.onload = () => {
                console.log('✅ [DASHBOARD] map-config.js carregado');
                resolve();
              };
              script.onerror = () => {
                console.error('❌ [DASHBOARD] Erro ao carregar map-config.js');
                resolve(); // Continuar mesmo se falhar
              };
              document.head.appendChild(script);
            }
          });
        } else {
          console.log('✅ [DASHBOARD] map-config.js já está disponível');
        }
      }

      // Evitar cache ao trocar de programa: URL com cache-buster + no-store
      // (sem cache-buster o HTML pode vir do cache; sem reexecutar scripts com src igual a tela fica em branco)
      const baseHtmlUrl = corrigirUrl(`/modulos/${programa}/index.html`);
      const htmlUrl = baseHtmlUrl + (baseHtmlUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const response = await fetch(htmlUrl, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
      });
      if (response.ok) {
        let html = await response.text();
        
        // CRÍTICO: Processar HTML como string ANTES de inserir no DOM
        // Isso evita que o browser tente carregar recursos com URLs incorretas
        
        // Processar links CSS - capturar href e substituir
        html = html.replace(/<link([^>]*\bhref=["'])(\/[^"']+)(["'][^>]*)>/gi, (match, before, href, after) => {
          // Verificar se é stylesheet (pode estar em qualquer ordem)
          if (match.includes('stylesheet') && href && href.startsWith('/') && !href.startsWith('http://') && !href.startsWith('https://')) {
            const hrefCorrigido = corrigirUrl(href);
            return `<link${before}${hrefCorrigido}${after}>`;
          }
          return match;
        });
        
        // Processar scripts com src absoluto (começando com /)
        html = html.replace(/<script([^>]*\bsrc=["'])(\/[^"']+)(["'][^>]*)>/gi, (match, before, src, after) => {
          if (src && src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://')) {
            const srcCorrigido = corrigirUrl(src);
            return `<script${before}${srcCorrigido}${after}>`;
          }
          return match;
        });

        // Extrair apenas o conteúdo do <body> para evitar documento aninhado (html/body dentro de div)
        // que deixa a área do módulo em branco
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/im);
        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/im);
        let htmlToInject = bodyMatch ? bodyMatch[1].trim() : html;

        // Aplicar link e style do head no document.head antes de injetar o body
        if (headMatch) {
          const tempHead = document.createElement('div');
          tempHead.innerHTML = headMatch[0];
          tempHead.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
            const href = el.getAttribute('href');
            if (el.tagName === 'LINK' && href && !href.startsWith('http')) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = corrigirUrl(href.startsWith('/') ? href : `/modulos/${programa}/${href}`);
              document.head.appendChild(link);
            } else if (el.tagName === 'STYLE') {
              const style = document.createElement('style');
              style.textContent = el.textContent;
              document.head.appendChild(style);
            }
          });
        }

        // Inserir apenas o conteúdo do body no DOM
        contentArea.innerHTML = htmlToInject;

        // Mover links CSS que eventualmente tenham ficado no contentArea para o head
        const linksInHTML = contentArea.querySelectorAll('link[rel="stylesheet"][href]');
        linksInHTML.forEach(link => {
          if (link.parentNode !== document.head) {
            document.head.appendChild(link);
          }
        });

        // Executar scripts que estão dentro do HTML inserido
        const scriptsInHTML = contentArea.querySelectorAll('script[src]');
        const scriptPromises = [];
        // Rastrear qual script está carregando (para diagnóstico de erros de parse)
        window.__dashboardLastLoadingScript = null;

        for (const oldScript of scriptsInHTML) {
          let scriptSrc = oldScript.getAttribute('src');
          
          // Converter caminhos relativos para absolutos baseados no módulo
          if (scriptSrc && !scriptSrc.startsWith('/') && !scriptSrc.startsWith('http')) {
            // Caminho relativo - converter para absoluto baseado no módulo
            scriptSrc = `/modulos/${programa}/${scriptSrc}`;
            console.log('📍 [DASHBOARD] Convertendo caminho relativo:', oldScript.getAttribute('src'), '→', scriptSrc);
          }
          
          // Garantir que o caminho use o baseUrl correto
          if (scriptSrc && scriptSrc.startsWith('/')) {
            scriptSrc = corrigirUrl(scriptSrc);
          }
          
          const newScript = document.createElement('script');
          // Cache-buster: forçar nova execução ao trocar de módulo (evita precisar F5 para cliques funcionarem).
          const sep = scriptSrc && scriptSrc.indexOf('?') >= 0 ? '&' : '?';
          if (scriptSrc) scriptSrc = scriptSrc + sep + '_=' + Date.now() + '&r=' + Math.random().toString(36).slice(2);

          const isViagensScript = scriptSrc && scriptSrc.includes('gerenciar-viagens/js/script.js');
          // Workaround: carregar script grande de gerenciar-viagens via fetch+blob para evitar
          // "Unexpected end of input" por truncamento (cache/compressão).
          if (isViagensScript && scriptSrc) {
            try {
              window.__dashboardLastLoadingScript = scriptSrc;
              const urlWithBust = scriptSrc + (scriptSrc.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
              const response = await fetch(urlWithBust);
              if (!response.ok) throw new Error('HTTP ' + response.status);
              const text = await response.text();
              if (text.length < 1000) {
                console.warn('⚠️ [DASHBOARD] script.js gerenciar-viagens parece truncado (' + text.length + ' chars). Usando src direto.');
                newScript.src = scriptSrc;
              } else {
                const blob = new Blob([text], { type: 'application/javascript' });
                newScript.src = URL.createObjectURL(blob);
              }
            } catch (e) {
              console.warn('⚠️ [DASHBOARD] Fallback src direto para gerenciar-viagens:', e.message);
              newScript.src = scriptSrc;
            }
            window.__dashboardLastLoadingScript = null;
          } else {
            Array.from(oldScript.attributes).forEach(attr => {
              if (attr.name === 'src') {
                newScript.setAttribute('src', scriptSrc);
              } else {
                newScript.setAttribute(attr.name, attr.value);
              }
            });
          }
          if (!scriptSrc && !newScript.src) newScript.textContent = oldScript.textContent || '';
          
          const scriptPromise = new Promise((resolve) => {
            const scriptUrl = scriptSrc || newScript.src || '(inline)';
            if (!isViagensScript) window.__dashboardLastLoadingScript = scriptUrl;
            newScript.onload = () => {
              if (newScript.src) window.__dashboardLastLoadedScript = newScript.src;
              window.__dashboardLastLoadingScript = null;
              if (newScript.src && newScript.src.startsWith('blob:')) URL.revokeObjectURL(newScript.src);
              console.log('✅ [DASHBOARD] Script do HTML carregado:', newScript.src || scriptUrl);
              resolve();
            };
            newScript.onerror = () => {
              window.__dashboardLastLoadingScript = null;
              console.warn('⚠️ [DASHBOARD] Erro ao carregar script do HTML:', newScript.src || scriptUrl);
              resolve();
            };
            if (!newScript.src) {
              window.__dashboardLastLoadingScript = null;
              resolve();
            }
          });
          
          scriptPromises.push(scriptPromise);
          oldScript.parentNode.replaceChild(newScript, oldScript);
        }
        
        // Aguardar todos os scripts do HTML carregarem (especialmente map-config.js)
        await Promise.all(scriptPromises);
        console.log('✅ [DASHBOARD] Todos os scripts do HTML carregados');

        // Armazenar módulo atual para uso no log-helper
        window.currentModule = programa;
        sessionStorage.setItem('currentModule', programa);
        
        // Registrar abertura do módulo
        if (window.logAberturaTela) {
          window.logAberturaTela(programa, `Abertura do módulo: ${programa}`);
        }

        // Carregar scripts compartilhados no head (evita parse error quando anexados na contentArea)
        if (!window.Permissions) {
          const permissionsScript = document.createElement('script');
          permissionsScript.src = corrigirUrl('/js/permissions.js');
          permissionsScript.onerror = () => console.warn('⚠️ [DASHBOARD] permissions.js não carregou');
          document.head.appendChild(permissionsScript);
        }
        if (!window.logAberturaTela) {
          const logHelperScript = document.createElement('script');
          logHelperScript.src = corrigirUrl('/js/log-helper.js');
          logHelperScript.onerror = () => console.warn('⚠️ [DASHBOARD] log-helper.js não carregou');
          document.head.appendChild(logHelperScript);
        }

        // Carrega o script do módulo só se ainda não foi carregado pelo HTML do módulo
        // (evita carregar 2x e "Unexpected end of input" ao reexecutar/sobrescrever)
        const moduleScriptBaseUrl = corrigirUrl(`/modulos/${programa}/js/script.js`);
        const alreadyLoadedModuleScript = contentArea.querySelector(`script[src*="${programa}/js/script.js"]`);
        if (!alreadyLoadedModuleScript) {
          const script = document.createElement('script');
          script.src = moduleScriptBaseUrl + (moduleScriptBaseUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now() + '&r=' + Math.random().toString(36).slice(2);
          script.onerror = () => { /* silencioso */ };
          script.onload = () => {
            const modulosComMapa = ['gerenciar-viagens', 'gerenciar-roteiros', 'relatorio-convocacoes'];
            if (modulosComMapa.includes(programa) && !window.MAP_CONFIG) {
              console.warn('⚠️ [DASHBOARD] MAP_CONFIG não disponível após carregar módulo', programa);
            } else if (modulosComMapa.includes(programa)) {
              console.log('✅ [DASHBOARD] MAP_CONFIG disponível após carregar módulo', programa);
            }
            setTimeout(() => {
              if (window.Permissions && window.Permissions.applyPermissionRestrictions) {
                window.Permissions.applyPermissionRestrictions();
              }
            }, 500);
          };
          contentArea.appendChild(script);
        } else {
          // Script já veio no HTML do módulo; só aplicar restrições
          setTimeout(() => {
            if (window.Permissions && window.Permissions.applyPermissionRestrictions) {
              window.Permissions.applyPermissionRestrictions();
            }
          }, 500);
        }

        // Se houver parâmetros, aplicar após carregar
        if (Object.keys(params).length > 0) {
          setTimeout(() => {
            aplicarParametrosModulo(params);
          }, 1000);
        }
      } else if (response.status === 404) {
        // Módulo não encontrado - mostrar mensagem amigável
        contentArea.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
            <i class='bx bx-error-circle' style="font-size: 64px; color: #6c757d; margin-bottom: 20px;"></i>
            <h3>Módulo não disponível</h3>
            <p>O módulo "${programa}" está em desenvolvimento.</p>
            <p style="margin-top: 20px; color: #868e96; font-size: 14px;">
              Este módulo será implementado em breve.
            </p>
          </div>
        `;
      } else {
        // Outro erro HTTP
        contentArea.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
            <i class='bx bx-error-circle' style="font-size: 64px; color: #e74c3c; margin-bottom: 20px;"></i>
            <h3>Erro ao carregar módulo</h3>
            <p>Não foi possível carregar o módulo "${programa}".</p>
            <p style="margin-top: 20px; color: #868e96; font-size: 14px;">
              Status: ${response.status} ${response.statusText}
            </p>
          </div>
        `;
      }
    } catch (err) {
      console.error('Erro ao carregar módulo:', err);
      contentArea.innerHTML = `
        <h3>Erro de carregamento</h3>
        <p>Não foi possível carregar o módulo "${programa}".</p>
      `;
    }
  };

  // Função auxiliar para aplicar parâmetros ao módulo carregado
  function aplicarParametrosModulo(params) {
    if (params.idViagem) {
      const filtroIdViagem = document.getElementById('filtroIdViagem');
      if (filtroIdViagem) {
        filtroIdViagem.value = params.idViagem;
        // Tentar submeter o formulário
        const form = document.getElementById('filtroForm');
        if (form) {
          setTimeout(() => {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.click();
            }
          }, 500);
        }
      }
    }
  }

  // Tornar loadModuleContent acessível globalmente
  window.loadModuleContent = loadModuleContent;

  // Função para restaurar a tela inicial com propaganda
  const showWelcomeScreen = async () => {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    const _t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
    if (window.i18nWebReady) await window.i18nWebReady;
    
    // Carregar estatísticas
    let stats = {
      totalViagens: 0,
      viagensPendentes: 0,
      totalEquipamentos: 0,
      totalUsuarios: 0,
      convocacoesPendentes: 0
    };
    
    try {
      // Buscar estatísticas de convocações (usa a mesma query do relatório)
      // Este endpoint retorna TOTAL_VIAGENS (COUNT DISTINCT) que é o correto
      const apiUrl = corrigirUrl('/api/relatorio-convocacoes/estatisticas');
      const responseConv = await fetch(apiUrl);
      if (responseConv.ok) {
        const dataConv = await responseConv.json();
        // Usar dados do relatório (mesma query do Relatório de Convocações)
        stats.totalViagens = dataConv.TOTAL_VIAGENS || 0;
        stats.convocacoesPendentes = dataConv.PENDENTE || 0;
        // Viagens pendentes = Total de viagens - Viagens com pelo menos uma convocação confirmada
        // Este cálculo já vem na query do endpoint
        stats.viagensPendentes = dataConv.VIAGENS_PENDENTES || 0;
      }
    } catch (e) {
      console.warn('Erro ao carregar estatísticas de convocações:', e);
    }
    
    // Carregar permissões do usuário para validar links rápidos
    let quickLinks = [];
    
    // Definir links rápidos com suas respectivas permissões e chaves i18n
    const availableQuickLinks = [
      { programa: 'gerenciar-viagens', nome: _t('web.dashboard.gerenciarViagens'), icon: 'bx-trip' },
      { programa: 'relatorio-convocacoes', nome: _t('web.dashboard.relatorioConvocacoes'), icon: 'bx-bar-chart-alt-2' },
      { programa: 'gerenciar-equipamentos', nome: _t('web.dashboard.gerenciarEquipamentos'), icon: 'bx-package' },
      { programa: 'gerenciar-mesorregiao', nome: _t('web.dashboard.gerenciarMesorregiao') || 'Mesorregiões', icon: 'bx-map' },
      { programa: 'gerenciar-estados', nome: _t('web.dashboard.gerenciarEstados') || 'Estados', icon: 'bx-map-pin' },
      { programa: 'gerenciar-logs-acesso', nome: _t('web.dashboard.logsAcesso'), icon: 'bx-history' }
    ];
    
    // Verificar permissões se o sistema estiver disponível
    if (typeof window.Permissions !== 'undefined' && window.Permissions.hasPermission) {
      for (const link of availableQuickLinks) {
        try {
          const hasPermission = await window.Permissions.hasPermission(link.programa);
          if (hasPermission) {
            quickLinks.push(link);
          }
        } catch (e) {
          console.warn(`Erro ao verificar permissão para ${link.programa}:`, e);
          quickLinks.push(link);
        }
      }
    }
    // Sempre mostrar Acesso Rápido: se nenhum link passou na permissão, usar todos
    if (quickLinks.length === 0) {
      quickLinks = availableQuickLinks;
    }
    
    var localeNum = (typeof window.tWeb === 'function' ? (document.documentElement.lang === 'es' ? 'es-PY' : 'pt-BR') : 'pt-BR');
    var localeForNumber = localeNum === 'es-PY' ? 'es-PY' : 'pt-BR';
    contentArea.innerHTML = `
      <!-- Área de Boas-vindas -->
      <div class="welcome-section">
        <h3>${_t('web.dashboard.bemVindo')}</h3>
        <p>${_t('web.dashboard.selecioneOpcao')}</p>
      </div>

      <!-- Cards de Estatísticas -->
      <div class="dashboard-stats-grid">
        <div class="dashboard-stat-card primary">
          <div class="stat-card-icon">
            <i class='bx bx-trip'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.totalViagens')}</h4>
            <p class="stat-value">${stats.totalViagens.toLocaleString(localeForNumber)}</p>
            <span class="stat-label">${_t('web.dashboard.viagensCadastradas')}</span>
          </div>
        </div>

        <div class="dashboard-stat-card ${stats.viagensPendentes > 0 ? 'warning' : 'success'}">
          <div class="stat-card-icon">
            <i class='bx bx-time-five'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.viagensPendentes')}</h4>
            <p class="stat-value">${stats.viagensPendentes.toLocaleString(localeForNumber)}</p>
            <span class="stat-label">${_t('web.dashboard.aguardandoAcao')}</span>
          </div>
        </div>

        <div class="dashboard-stat-card ${stats.convocacoesPendentes > 0 ? 'warning' : 'info'}">
          <div class="stat-card-icon">
            <i class='bx bx-bell'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.convocacoesPendentes')}</h4>
            <p class="stat-value">${stats.convocacoesPendentes.toLocaleString(localeForNumber)}</p>
            <span class="stat-label">${_t('web.dashboard.aguardandoResposta')}</span>
          </div>
        </div>

        <div class="dashboard-stat-card info">
          <div class="stat-card-icon">
            <i class='bx bx-info-circle'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.dicaDia')}</h4>
            <p class="stat-tip">${_t('web.dashboard.dicaFiltros')}</p>
            <span class="stat-label">${_t('web.dashboard.dicaUtil')}</span>
          </div>
        </div>
      </div>

      <!-- Avisos e Alertas -->
      ${stats.viagensPendentes > 0 || stats.convocacoesPendentes > 0 ? `
      <div class="dashboard-alerts">
        <div class="alert-card ${stats.convocacoesPendentes > 0 ? 'alert-warning' : ''}">
          <i class='bx bx-error-circle'></i>
          <div>
            <strong>${_t('web.dashboard.atencao')}</strong>
            ${stats.convocacoesPendentes > 0 ? `<p>${_t('web.dashboard.convocacoesPendentesMsg').replace('{n}', stats.convocacoesPendentes)}</p>` : ''}
            ${stats.viagensPendentes > 0 ? `<p>${_t('web.dashboard.viagensPendentesMsg').replace('{n}', stats.viagensPendentes)}</p>` : ''}
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Links Rápidos -->
      ${quickLinks.length > 0 ? `
      <div class="dashboard-quick-links">
        <h4><i class='bx bx-link'></i> ${_t('web.dashboard.acessoRapido')}</h4>
        <div class="quick-links-grid">
          ${quickLinks.map(link => `
            <button class="quick-link-btn" onclick="window.loadModuleContent('${link.programa}')">
              <i class='bx ${link.icon}'></i>
              <span>${link.nome}</span>
            </button>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;
    if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);
  };
  
  // Tornar showWelcomeScreen acessível globalmente
  window.showWelcomeScreen = showWelcomeScreen;

  // Proteção contra múltiplas inicializações
  let dashboardInicializado = false;
  
  // Executar imediatamente se o DOM já estiver pronto, senão esperar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!dashboardInicializado) {
        dashboardInicializado = true;
        initDashboard();
      }
    }, { once: true }); // Garantir que só executa uma vez
  } else {
    // DOM já está pronto, executar imediatamente
    if (!dashboardInicializado) {
      dashboardInicializado = true;
      initDashboard();
    }
  }
  };

  // Executar init quando o script carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();