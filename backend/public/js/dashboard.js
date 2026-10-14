// backend/public/js/dashboard.js
// Função de inicialização que funciona mesmo com scripts carregados dinamicamente
(function() {
  // Função helper global para corrigir URLs relativas para incluir o caminho base
  const corrigirUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const cleanUrl = url.startsWith('/') ? url : '/' + url;
    if (cleanUrl.startsWith('/api/')) {
      const pn = window.location.pathname || '';
      if (pn.indexOf('/cargas') !== -1) {
        return window.location.origin + '/cargas' + cleanUrl;
      }
      return window.location.origin + cleanUrl;
    }
    if (cleanUrl.startsWith('/cargas/api/')) {
      return window.location.origin + cleanUrl;
    }

    let baseUrl = window.__BASE_URL__;
    if (!baseUrl) {
      const pathname = window.location.pathname || '/';
      let pathBase = '/';
      if (pathname.indexOf('/cargas') !== -1) {
        pathBase = '/cargas/';
      } else if (pathname.indexOf('/motorista') !== -1 && pathname.indexOf('/cargas') === -1) {
        pathBase = '/motorista/';
      } else if (/^\/(dashboard|login)(\/|$)/.test(pathname)) {
        pathBase = '/';
      } else if (pathname !== '/' && pathname.length > 1 && !/\.html$/i.test(pathname)) {
        const segments = pathname.split('/').filter(s => s);
        if (segments.length > 0) {
          pathBase = '/' + segments[0] + '/';
        }
      } else if (/\.html$/i.test(pathname)) {
        const ls = pathname.lastIndexOf('/');
        pathBase = ls > 0 ? pathname.substring(0, ls + 1) : '/';
      }
      baseUrl = window.location.protocol + '//' + window.location.host + (pathBase === '/' ? '' : pathBase.replace(/\/$/, ''));
    }
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    return cleanBaseUrl + cleanUrl;
  };

  /** Preferência do combo «Módulo de produto» (sidebar). Vazio = Módulo Base / todos os módulos. */
  const STORAGE_KEY_ATLAS_MODULO_CODIGO = 'atlasProductModuleCodigo';

  function atlasModuloStorageKey(login) {
    const lg = login != null ? String(login).trim().toLowerCase() : '';
    return lg ? STORAGE_KEY_ATLAS_MODULO_CODIGO + ':' + lg : STORAGE_KEY_ATLAS_MODULO_CODIGO;
  }

  function normalizeAtlasModuloCodigo(v) {
    if (v === '' || v === '__ALL__') return '';
    const lo = String(v || '').trim().toLowerCase();
    if (!lo) return '';
    if (lo === 'divulga') return 'divulga_cargas_torre';
    return lo;
  }

  /** Lê preferência salva; se nunca escolheu → '' (Módulo Base). */
  function readAtlasModuloPreference(login, codigosSet) {
    const key = atlasModuloStorageKey(login);
    let raw = null;
    try {
      raw = localStorage.getItem(key);
      if (raw == null) {
        const legacySess = sessionStorage.getItem(STORAGE_KEY_ATLAS_MODULO_CODIGO);
        const legacyGlob = localStorage.getItem(STORAGE_KEY_ATLAS_MODULO_CODIGO);
        if (legacySess != null) raw = legacySess;
        else if (legacyGlob != null && !String(login || '').trim()) raw = legacyGlob;
        if (raw != null) writeAtlasModuloPreference(login, raw);
      }
    } catch (e) {}
    if (raw == null || raw === undefined) return '';
    if (raw === '' || raw === '__ALL__') return '';
    const norm = normalizeAtlasModuloCodigo(raw);
    if (codigosSet && codigosSet.size && norm && !codigosSet.has(norm)) return '';
    return norm;
  }

  function writeAtlasModuloPreference(login, value) {
    const v = value === '' || value == null ? '' : normalizeAtlasModuloCodigo(value);
    const key = atlasModuloStorageKey(login);
    try {
      localStorage.setItem(key, v);
      sessionStorage.setItem(STORAGE_KEY_ATLAS_MODULO_CODIGO, v);
    } catch (e) {}
  }

  function preserveAtlasLocalStorageKeys() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === STORAGE_KEY_ATLAS_MODULO_CODIGO || k.indexOf(STORAGE_KEY_ATLAS_MODULO_CODIGO + ':') === 0) {
          out[k] = localStorage.getItem(k);
        } else if (k === 'preferredLocale') {
          out[k] = localStorage.getItem(k);
        }
      }
    } catch (e) {}
    return out;
  }

  function restoreAtlasLocalStorageKeys(preserved) {
    if (!preserved) return;
    try {
      Object.keys(preserved).forEach(function (k) {
        localStorage.setItem(k, preserved[k]);
      });
    } catch (e) {}
  }
  
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
    function getTheme() { return localStorage.getItem(KEY) || 'dark'; }
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
  // motivo === 'revoked': sessão encerrada no servidor (outro login / limite) — redirecionar na hora, sem espera de inatividade
  const fazerLogout = async (automatico = false, motivo = null) => {
    const isRevoked = motivo === 'revoked';
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

    // Limpar cache e storage (mantém preferência de módulo de produto e idioma por usuário)
    const preservedPrefs = preserveAtlasLocalStorageKeys();
    sessionStorage.clear();
    localStorage.clear();
    restoreAtlasLocalStorageKeys(preservedPrefs);

    // Limpar cache do navegador (forçar reload)
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }

    // Redirecionar para login
    if (automatico && !isRevoked) {
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
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    if (isRevoked) {
      cleanUrl += (cleanUrl.indexOf('?') === -1 ? '?' : '&') + 'atlas_sessao=deslocada';
    }
    window.location.replace(cleanUrl);
  };

  /** Chamado pelo interceptador global de fetch (dashboard.html) quando a API retorna SESSION_REVOKED */
  window.__atlasExecuteTowerLogout = () => {
    if (window.__atlasTowerRevokedLogoutOnce) return;
    window.__atlasTowerRevokedLogoutOnce = true;
    fazerLogout(true, 'revoked');
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

    // Título base da aba (antes de abrir módulos) — usado para restaurar ao voltar ao dashboard
    try {
      if (window.__DASHBOARD_DOC_TITLE_BASE == null || String(window.__DASHBOARD_DOC_TITLE_BASE).trim() === '') {
        window.__DASHBOARD_DOC_TITLE_BASE = (document.title && String(document.title).trim()) || 'Atlas Cargo';
      }
    } catch (eTitle) {
      window.__DASHBOARD_DOC_TITLE_BASE = 'Atlas Cargo';
    }

    // Inicializar controle de atividade
    lastActivityTime = Date.now();
    atualizarAtividade();
    let ctx = {};
    try {
      const ctxRes = await fetch(corrigirUrl('/api/contexto'), {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (ctxRes.status === 401) {
        console.warn('⚠️ Sessão revogada ou inválida (401 em /api/contexto). Redirecionando ao login.');
        window.__DASHBOARD_INITIALIZING__ = false;
        fazerLogout(true, 'revoked');
        return;
      }
      if (ctxRes.ok) {
        ctx = await ctxRes.json();
      }
      if (ctx && ctx.timezone && typeof window.syncAtlasTimezoneInstalacao === 'function') {
        window.syncAtlasTimezoneInstalacao(ctx.timezone);
      }
    } catch (e) {
      // manter funcionamento sem bloquear dashboard
    }

    const userNameEl = document.getElementById('userName');
    const userEmailEl = document.getElementById('userEmail');
    
    if (userNameEl) {
      const tidRaw = (ctx.tenantId != null && String(ctx.tenantId).trim() !== '')
        ? String(ctx.tenantId).trim()
        : (user.tenantId != null && String(user.tenantId).trim() !== '')
          ? String(user.tenantId).trim()
          : '';
      const tnome = (ctx.tenantNome != null && String(ctx.tenantNome).trim() !== '')
        ? String(ctx.tenantNome).trim()
        : '';
      const baseNome = user.nome || 'Usuário';
      const linha = tidRaw
        ? (tnome ? `${baseNome} - (${tidRaw} / ${tnome})` : `${baseNome} - (${tidRaw})`)
        : baseNome;
      userNameEl.textContent = linha;
      userNameEl.title = linha;
    }
    
    if (userEmailEl) {
      userEmailEl.textContent = user.email || '';
    }

    /** Alinha ao backend (`menu.routes`): funde `divulga` + `divulga_cargas_torre` e força o nome via i18n (combo não mostra título legado do banco). */
    function mergeModulosProdutoTorreCliente(modulos, tFn) {
      const TORRE = new Set(['divulga', 'divulga_cargas_torre']);
      if (!Array.isArray(modulos) || modulos.length === 0) return modulos;
      const rawNome = typeof tFn === 'function' ? tFn('web.menu.nomeModuloTorreLogistica') : '';
      const nomeTorre =
        rawNome && typeof rawNome === 'string' && !rawNome.startsWith('web.') ? rawNome : 'Torre Logística';
      const rest = [];
      const torre = [];
      for (const m of modulos) {
        const c = String(m.codigo != null ? m.codigo : m.CODIGO || '')
          .trim()
          .toLowerCase();
        if (TORRE.has(c)) torre.push(m);
        else rest.push({ ...m });
      }
      if (torre.length === 0) return modulos;
      const prefer =
        torre.find(
          (x) =>
            String(x.codigo != null ? x.codigo : x.CODIGO || '')
              .trim()
              .toLowerCase() === 'divulga_cargas_torre'
        ) || torre[0];
      const ordem = Math.min(
        ...torre.map((x) => {
          const o = x.ordem != null ? x.ordem : x.ORDEM;
          const n = Number(o);
          return Number.isFinite(n) ? n : 99;
        })
      );
      const cd0 = prefer.cdModulo != null ? prefer.cdModulo : prefer.CD_MODULO;
      rest.push({
        cdModulo: cd0,
        codigo: 'divulga_cargas_torre',
        nome: nomeTorre,
        ordem,
      });
      rest.sort((a, b) => {
        const oa = Number(a.ordem) || 0;
        const ob = Number(b.ordem) || 0;
        if (oa !== ob) return oa - ob;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt', { sensitivity: 'base' });
      });
      return rest;
    }

    const loadProductModulesList = async (userLogin) => {
      try {
        const token = localStorage.getItem('token');
        const url = corrigirUrl('/api/menu/modulos');
        const response = await fetch(url, {
          headers: {
            'user-login': userLogin,
            'Authorization': token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        return { modulos: data.modulos || [], legado: !!data.legado };
      } catch (e) {
        console.warn('Módulos de produto:', e.message);
        return { modulos: [], legado: true };
      }
    };

    const _tDash = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
    const { modulos: modulosRaw } = await loadProductModulesList(user.login);
    const listaModulos = mergeModulosProdutoTorreCliente(modulosRaw || [], _tDash);
    const bar = document.getElementById('productModuleBar');
    const sel = document.getElementById('productModuleSelect');
    const lblMod = document.querySelector('.product-module-label');
    let moduloParaMenu = null;

    if (lblMod) {
      lblMod.textContent = _tDash('web.menu.moduloProduto');
    }

    if (listaModulos.length > 1 && bar && sel) {
      bar.style.display = 'block';
      sel.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = '';
      optAll.textContent = _tDash('web.menu.todosModulosMenu');
      sel.appendChild(optAll);
      listaModulos.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.codigo;
        opt.textContent = m.nome || m.codigo;
        sel.appendChild(opt);
      });
      const codigos = new Set(listaModulos.map((x) => x.codigo));
      const saved = readAtlasModuloPreference(user.login, codigos);
      sel.value = saved === '' ? '' : saved;
      moduloParaMenu = saved === '' ? null : saved;
      sel.onchange = async () => {
        try {
          let v = sel.value === '' ? '' : String(sel.value).trim();
          if (v && v.toLowerCase() === 'divulga') v = 'divulga_cargas_torre';
          writeAtlasModuloPreference(user.login, v);
          if (v && sel.value !== v) sel.value = v;
        } catch (e) {}
        let vMenu = sel.value === '' ? '' : String(sel.value).trim();
        if (vMenu && vMenu.toLowerCase() === 'divulga') vMenu = 'divulga_cargas_torre';
        await loadUserMenu(user.login, vMenu === '' ? null : vMenu);
        if (typeof window.showWelcomeScreen === 'function') {
          await window.showWelcomeScreen();
        }
      };
    } else if (listaModulos.length === 1) {
      moduloParaMenu = listaModulos[0].codigo;
      const c0 = normalizeAtlasModuloCodigo(listaModulos[0].codigo);
      if (c0) writeAtlasModuloPreference(user.login, c0);
      if (bar) bar.style.display = 'none';
    }

    await loadUserMenu(user.login, moduloParaMenu);

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
    document.getElementById('headerBtnMotoristasPendentes')?.addEventListener('click', () => {
      if (typeof window.loadModuleContent === 'function') {
        window.loadModuleContent('gerenciar-cadastro-geral', { cadastroGeralMotoristasPendentes: true });
      }
    });
    document.getElementById('headerBtnDivergenciaPlacas')?.addEventListener('click', () => {
      if (typeof window.loadModuleContent === 'function') {
        window.loadModuleContent('gerenciar-viagens', { convocacoesDivergenciaPlacas: true });
      }
    });

    // Aplicar identidade visual configurada (logos)
    fetch(corrigirUrl('/api/configuracoes/identidade'), { headers: getAuthHeaders() })
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
   * Obter AudioContext já criado no unlock (não criar aqui — evita aviso fora de gesto do usuário).
   */
  const obterAudioContext = () => {
    if (!audioContextUnlocked || !globalAudioContext) return null;
    try {
      if (globalAudioContext.state === 'suspended') {
        const pr = globalAudioContext.resume();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      }
      return globalAudioContext;
    } catch (err) {
      return null;
    }
  };

  /**
   * Tocar som de notificação (global).
   * Alerta/SOS/geral: ~5 s em pulsos; chat: ~2 s (mensagens são mais frequentes).
   */
  const tocarSomNotificacao = async (tipo = 'geral') => {
    try {
      const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
      if (!somHabilitado) {
        return;
      }

      const audioContext = obterAudioContext();
      if (!audioContext) {
        return;
      }

      const frequencies = {
        sos: 1000,
        alerta: 800,
        chat: 600,
        geral: 500
      };
      const freq = frequencies[tipo] || 500;
      // Chat mais curto; alerta/SOS ~5 segundos para chamar atenção
      const duracaoSec = tipo === 'chat' ? 2 : 5;
      const periodoPulso = 0.4;
      const now = audioContext.currentTime;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;

      // Envelope em pulsos (liga/desliga) ao longo da duração — evita tom contínuo monótono
      gainNode.gain.setValueAtTime(0.0001, now);
      const nPulsos = Math.max(1, Math.floor(duracaoSec / periodoPulso));
      for (let i = 0; i < nPulsos; i++) {
        const t0 = now + i * periodoPulso;
        gainNode.gain.setValueAtTime(0.0001, t0);
        gainNode.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
        gainNode.gain.setValueAtTime(0.22, t0 + 0.16);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        // SOS: sobe/desce um pouco a frequência (efeito “sirene” leve)
        if (tipo === 'sos') {
          oscillator.frequency.setValueAtTime(i % 2 === 0 ? 1000 : 750, t0);
        }
      }

      oscillator.start(now);
      oscillator.stop(now + duracaoSec + 0.05);
    } catch (err) {
      // Silencioso — som só após gesto do usuário (política do navegador)
    }
  };

  /**
   * Inicializar AudioContext na primeira interação do usuário (obrigatório para não gerar aviso no console)
   */
  const inicializarAudioContext = () => {
    const eventos = ['click', 'touchstart', 'keydown'];
    /** Não usar async/await aqui: o Chrome exige resume() na mesma “user activation” síncrona do gesto. */
    const unlock = () => {
      eventos.forEach((ev) => document.removeEventListener(ev, unlock));
      try {
        if (!globalAudioContext) {
          globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (globalAudioContext.state === 'suspended') {
          const pr = globalAudioContext.resume();
          if (pr && typeof pr.catch === 'function') pr.catch(() => {});
        }
        audioContextUnlocked = true;
      } catch (e) {
        audioContextUnlocked = false;
      }
    };
    eventos.forEach((ev) => document.addEventListener(ev, unlock, { once: true, passive: true }));
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
      const id = user.id ?? user.cdcadastro ?? user.CDCADASTRO ?? user.userId;
      if (id != null && id !== '') {
        const num = typeof id === 'number' ? id : parseFloat(id);
        if (Number.isFinite(num)) return num;
      }
      const login = (user.login ?? user.LOGIN ?? user.SGUSUARIO ?? user.sgUsuario ?? '').toString();
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
  let ultimoAlertasPendentesCache = null;

  const atualizarContadorAlertas = async (ultimoContador = {}, opts = {}) => {
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
          
          // Som only when pending count actually rises. Passing {} used to treat
          // previous as 0, so treating/saving an alert (badge refresh) kept beeping.
          const previous =
            typeof ultimoContador.alertas === 'number'
              ? ultimoContador.alertas
              : (ultimoAlertasPendentesCache ?? 0);
          if (!opts.silencioso && pendentes > previous) {
            tocarSomNotificacao('alerta').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          ultimoAlertasPendentesCache = pendentes;

          return pendentes;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador de alertas:', err);
    }
    return ultimoContador.alertas || 0;
  };

  /**
   * Motoristas com aprovação pendente (cadastro pelo app) — badge no menu, header e estado vermelho (.has-pending).
   */
  const atualizarContadorMotoristasPendentes = async (ultimoContador = {}) => {
    try {
      const urlMot = corrigirUrl('/api/cadastros-gerais/contador-motoristas-pendentes');
      const urlVeic = corrigirUrl('/api/cadastros-gerais/contador-motorista-veiculos-pendentes');
      const headers = getAuthHeaders();
      const [resMot, resVeic] = await Promise.all([
        fetch(urlMot, { headers }),
        fetch(urlVeic, { headers }).catch(() => ({ ok: false }))
      ]);

      let nMot = 0;
      let nVeic = 0;
      if (resMot.ok) {
        const data = await resMot.json();
        nMot = parseInt(data.count ?? data.data?.count ?? 0, 10) || 0;
      }
      if (resVeic && resVeic.ok) {
        try {
          const dataV = await resVeic.json();
          nVeic = parseInt(dataV.count ?? dataV.data?.count ?? 0, 10) || 0;
        } catch (e) {
          nVeic = 0;
        }
      }
      const n = nMot + nVeic;

      const menuItem = document.querySelector('[data-programa="gerenciar-cadastro-geral"]');
      if (menuItem) {
        let badge = menuItem.querySelector('.menu-badge');
        if (n > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'menu-badge';
            menuItem.appendChild(badge);
          }
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.style.display = 'block';
          menuItem.classList.add('has-badge');
        } else {
          if (badge) badge.style.display = 'none';
          menuItem.classList.remove('has-badge');
        }
      }

      const headerBadgeMotoristas = document.getElementById('headerBadgeMotoristasPendentes');
      const headerBtnMotoristas = document.getElementById('headerBtnMotoristasPendentes');
      if (headerBadgeMotoristas) {
        headerBadgeMotoristas.textContent = n > 99 ? '99+' : String(n);
        headerBadgeMotoristas.style.display = n > 0 ? 'inline-flex' : 'none';
        headerBadgeMotoristas.setAttribute('data-count', String(n));
        headerBadgeMotoristas.setAttribute(
          'title',
          nMot > 0 || nVeic > 0
            ? `Pendências: ${nMot} motorista(s), ${nVeic} veículo(s) (app)`
            : ''
        );
      }
      if (headerBtnMotoristas) {
        if (n > 0) headerBtnMotoristas.classList.add('has-pending');
        else headerBtnMotoristas.classList.remove('has-pending');
      }

      return n;
    } catch (err) {
      console.warn('Erro ao atualizar contador de motoristas pendentes:', err);
    }
    return ultimoContador.motoristasPendentes || 0;
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

  /** Badge no header (mesmo padrão Chat/SOS): divergências ainda relevantes (viagem sem convocação confirmada). */
  const atualizarBadgeDivergenciaPlacas = async () => {
    try {
      const apiUrl = corrigirUrl('/api/viagens/contador-divergencia-placas-convocacoes');
      const response = await fetch(apiUrl, { headers: getAuthHeaders() });
      const btn = document.getElementById('headerBtnDivergenciaPlacas');
      const badge = document.getElementById('headerBadgeDivergenciaPlacas');
      if (!btn || !badge) return 0;

      let total = 0;
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          total = parseInt(data.data.total, 10) || 0;
        }
      }

      const hasViagensMenu = !!document.querySelector('[data-programa="gerenciar-viagens"]');
      if (hasViagensMenu && total > 0) {
        btn.style.display = 'inline-flex';
        btn.classList.add('has-divergencia');
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = 'inline-flex';
        badge.setAttribute('data-count', total);
        const headerShortcuts = document.getElementById('headerShortcuts');
        if (headerShortcuts) headerShortcuts.style.display = 'flex';
      } else {
        btn.style.display = 'none';
        btn.classList.remove('has-divergencia');
        badge.style.display = 'none';
        badge.setAttribute('data-count', '0');
        const headerShortcutsEl = document.getElementById('headerShortcuts');
        if (headerShortcutsEl) {
          const hasChat = !!document.querySelector('[data-programa="chat"]');
          const hasAlertas = !!document.querySelector('[data-programa="alertas"]');
          const hasCadastroGeral = !!document.querySelector('[data-programa="gerenciar-cadastro-geral"]');
          const hasSos = !!document.querySelector('[data-programa="sos"]');
          headerShortcutsEl.style.display =
            hasChat || hasAlertas || hasCadastroGeral || hasSos ? 'flex' : 'none';
        }
      }
      return total;
    } catch (err) {
      console.warn('Erro ao atualizar divergência de placas (header):', err);
    }
    return 0;
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
      const [chat, alertas, motoristasPendentes, sos] = await Promise.all([
        atualizarContadorChat(ultimoContador),
        atualizarContadorAlertas(ultimoContador),
        atualizarContadorMotoristasPendentes(ultimoContador),
        atualizarContadorSOS(ultimoContador)
      ]);
      await atualizarBadgeDivergenciaPlacas();
      
      // Salvar estado atual
      localStorage.setItem('ultimoContador', JSON.stringify({
        chat,
        alertas,
        motoristasPendentes,
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
      atualizarContadorAlertas({}, { silencioso: true }).catch(() => {});
    });

    // Quando o módulo Chat marcar mensagens como lidas, atualizar contador do dashboard
    document.addEventListener('chat-contador-atualizado', () => {
      atualizarContadorChat({}).catch(() => {});
    });

    document.addEventListener('motoristas-pendentes-contador-atualizado', () => {
      atualizarContadorMotoristasPendentes({}).catch(() => {});
    });

    document.addEventListener('divergencia-placas-contador-atualizado', () => {
      atualizarBadgeDivergenciaPlacas().catch(() => {});
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
  try {
    window.__atlasGetSocketIoPath = getSocketIoPath;
  } catch (_) {}

  /**
   * Conectar ao Socket.IO: chat (nova-mensagem), torre (alertas e SOS) para som + badge no dashboard
   * Entra na sala chat-dashboard quando tem Chat no menu OU quando está na página do dashboard (#contentArea),
   * para não depender da ordem de carregamento do menu.
   */
  function inicializarSocketDashboard() {
    const hasChat = !!document.querySelector('[data-programa="chat"]');
    const hasAlertas = !!document.querySelector('[data-programa="alertas"]');
    const hasSos = !!document.querySelector('[data-programa="sos"]');
    const isDashboard = !!document.getElementById('contentArea');
    const joinChatRoom = hasChat || isDashboard;
    if (!hasChat && !hasAlertas && !hasSos && !isDashboard) return;

    function emitDashboardSocketJoins(sock) {
      if (joinChatRoom) {
        sock.emit('join-chat-dashboard');
        if (hasChat) {
          fetch(corrigirUrl('/api/chat/conversas?limit=200'), { headers: getAuthHeaders() })
            .then(r => (r.ok ? r.json() : { data: [] }))
            .then(data => {
              const conversas = Array.isArray(data.data)
                ? data.data
                : data.data && data.data.data
                  ? data.data.data
                  : [];
              const viagensJaEntradas = new Set();
              conversas.forEach(c => {
                if (c.ID_VIAGEM != null && !viagensJaEntradas.has(Number(c.ID_VIAGEM))) {
                  sock.emit('join-viagem', c.ID_VIAGEM);
                  viagensJaEntradas.add(Number(c.ID_VIAGEM));
                }
                if (c.ID != null) sock.emit('join-conversa', c.ID);
              });
            })
            .catch(() => {});
        }
      }
      if (hasAlertas || hasSos || isDashboard || hasChat) {
        sock.emit('torre:join-all');
      }
    }

    function conectar() {
      if (typeof io === 'undefined') return;
      const path = getSocketIoPath();
      const opts = {
        transports: ['polling', 'websocket'],
        auth: { token: localStorage.getItem('token') || '' }
      };
      if (path !== '/socket.io') opts.path = path;

      let socket = window.__atlasIoShared;
      if (!socket) {
        socket = io(window.location.origin, opts);
        window.__atlasIoShared = socket;
      } else if (!socket.connected) {
        try {
          socket.connect();
        } catch (_) {}
      }

      if (!socket.__atlasDashboardSocketInited) {
        socket.__atlasDashboardSocketInited = true;
        socket.on('connect', () => {
          emitDashboardSocketJoins(socket);
        });

        if (joinChatRoom) {
          socket.on('torre:nova-mensagem', payload => {
            const mensagem = payload && payload.mensagem;
            if (!mensagem) return;
            const st = String(mensagem.SENDER_TYPE || mensagem.sender_type || '').toUpperCase();
            const isDoMotorista = st === 'MOTORISTA' || st === 'DRIVER';
            if (!isDoMotorista) return;
            tocarSomNotificacao('chat').catch(() => {});
            atualizarContadorChat({}).catch(() => {});
          });
        }

        if (hasAlertas || isDashboard) {
          socket.on('torre:novo-alerta', () => {
            tocarSomNotificacao('alerta').catch(() => {});
            atualizarContadorAlertas({}, { silencioso: true }).catch(() => {});
          });
        }

        if (hasSos || isDashboard) {
          socket.on('torre:sos-alerta', () => {
            atualizarContadorSOS({}).catch(() => {});
            tocarSomNotificacao('sos').catch(() => {});
          });
        }

        socket.on('torre:divergencia-placas-convocacao', (payload) => {
          const p = payload || {};
          const msg =
            typeof p.mensagemResumo === 'string' && p.mensagemResumo.trim()
              ? p.mensagemResumo.trim()
              : `Divergência de placas — convocação #${p.IDCONVOCACAO ?? p.idconvocacao ?? '?'}`;
          try {
            if (typeof showMessage === 'function') showMessage(msg, 'warning');
            tocarSomNotificacao('alerta').catch(() => {});
            atualizarBadgeDivergenciaPlacas().catch(() => {});
          } catch (_) {}
        });
      }

      if (socket.connected) {
        emitDashboardSocketJoins(socket);
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

  /** Flyout dos grupos quando a sidebar está recolhida (hover + toque). */
  function initCollapsedMenuFlyouts() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.dataset.flyoutBound === '1') return;
    sidebar.dataset.flyoutBound = '1';

    const fecharFlyouts = () => {
      document.querySelectorAll('.menu-category.is-flyout-open').forEach((c) => {
        c.classList.remove('is-flyout-open');
      });
    };

    document.addEventListener('click', (e) => {
      if (!sidebar.classList.contains('collapsed')) return;
      if (e.target.closest('.menu-category')) return;
      fecharFlyouts();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') fecharFlyouts();
    });

    sidebar.addEventListener('mouseleave', () => {
      if (sidebar.classList.contains('collapsed')) fecharFlyouts();
    });
  }

  // Função para inicializar o toggle do menu
  const initMenuToggle = () => {
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    const header = document.querySelector('.main > .header');
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
      if (!collapsed) {
        document.querySelectorAll('.menu-category.is-flyout-open').forEach((c) => {
          c.classList.remove('is-flyout-open');
        });
      }
    };

    const toggleSidebar = () => {
      sidebar?.classList.toggle('collapsed');
      main?.classList.toggle('sidebar-collapsed');
      const collapsed = sidebar?.classList.contains('collapsed');
      updateToggleState(collapsed);
      localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
    };

    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      sidebar?.classList.add('collapsed');
      main?.classList.add('sidebar-collapsed');
      updateToggleState(true);
    } else {
      updateToggleState(false);
    }

    toggleBtn?.addEventListener('click', toggleSidebar);

    if (header && !header.dataset.scrollBound) {
      header.dataset.scrollBound = '1';
      const onScroll = () => {
        header.classList.toggle('is-scrolled', window.scrollY > 4);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  };

  const loadUserMenu = async (userLogin, moduloCodigo) => {
    try {
      const token = localStorage.getItem('token');
      let url = corrigirUrl('/api/menu/user-menu');
      if (moduloCodigo) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'modulo=' + encodeURIComponent(moduloCodigo);
      }

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
        // Chaves canônicas do backend (tipo-atividade-grupo.js): ASCII, sem ambiguidade
        const iconesPorGrupo = {
          'CADASTROS': 'bx-file-blank',
          'EQUIPAMENTOS': 'bx-package',
          'LOGISTICA': 'bx-trip',
          'GESTAO': 'bx-cog',
          'SISTEMA': 'bx-user-circle',
          'WMS': 'bx-store',
          'OUTROS': 'bx-grid-alt',
          // legado / cache antigo
          'LOGÍSTICA': 'bx-trip',
          'GESTÃO': 'bx-cog',
          'SYSTEM': 'bx-user-circle',
          'VIAGENS & LOGÍSTICA': 'bx-trip',
          'GESTÃO & ADMINISTRAÇÃO': 'bx-cog'
        };

        const ordemGrupos = ['CADASTROS', 'EQUIPAMENTOS', 'LOGISTICA', 'WMS', 'GESTAO', 'SISTEMA', 'OUTROS'];

        function normalizarChaveGrupoMenu(raw) {
          if (raw == null || String(raw).trim() === '') return 'OUTROS';
          const s = String(raw).trim();
          const t = s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
          if (t === 'SYSTEM' || t === 'SISTEMA') return 'SISTEMA';
          if (t === 'CADASTROS' || t.includes('CADASTRO')) return 'CADASTROS';
          if (t === 'GESTAO' || t.includes('GESTAO') || t.includes('ADMINISTR')) return 'GESTAO';
          if (t === 'LOGISTICA' || t.includes('LOGIST') || t.includes('VIAGENS')) return 'LOGISTICA';
          if (t === 'EQUIPAMENTOS' || t.includes('EQUIPAMENTO')) return 'EQUIPAMENTOS';
          if (t === 'WMS') return 'WMS';
          if (['CADASTROS', 'EQUIPAMENTOS', 'LOGISTICA', 'GESTAO', 'SISTEMA', 'WMS', 'OUTROS'].includes(s)) return s;
          return t.replace(/\s+/g, '_');
        }

        // Agrupar itens por grupo (normalizado pelo backend; compatível com chaves antigas)
        const gruposMap = {};
        data.menu.forEach(item => {
          if (item && item.oculto_menu) return;
          const iconName = getIcon(item.id, item.programa);
          // Boxicons: sólidos usam "bx bxs-*"; nunca "bxs bxs-*" (não renderiza).
          const iconClass = iconName.startsWith('bxs-') ? `bx ${iconName}` : `bx bx-${iconName}`;
          const programa = item.programa || 'default';
          const grupo = normalizarChaveGrupoMenu(item.grupo || 'OUTROS');
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
                  <div class="menu-flyout-title" aria-hidden="true">${grupoLabel}</div>
                  ${grupo.items.map(item => {
                    // Se o nome no banco começa com numeração (1.0., 9.5., etc.), mostrar o texto do cadastro
                    // (evita i18n “curto” esconder o prefixo). Caso contrário: i18n → nome do banco.
                    const nomeBanco = (item.nome && String(item.nome).trim()) ? String(item.nome).trim() : '';
                    const menuKey = 'web.menu.item.' + (item.programa || '');
                    const translated = _tMenu(menuKey);
                    const comPrefixoNumerico = /^\s*\d/.test(nomeBanco);
                    let itemLabel;
                    if (comPrefixoNumerico) {
                      itemLabel = nomeBanco || (translated && translated !== menuKey ? translated : '') || item.nome || '';
                    } else {
                      itemLabel =
                        translated && translated !== menuKey ? translated : nomeBanco || item.nome || '';
                    }
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

        // Event listeners para grupos (expandir/colapsar ou flyout quando recolhido)
        const categoryHeaders = document.querySelectorAll('.menu-category-header');
        categoryHeaders.forEach(header => {
          header.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.querySelector('.sidebar');
            const grupoKey = header.getAttribute('data-grupo');
            const itemsContainer = document.querySelector(`[data-grupo-items="${grupoKey}"]`);
            const category = header.closest('.menu-category');

            if (sidebar?.classList.contains('collapsed')) {
              if (!category) return;
              const wasOpen = category.classList.contains('is-flyout-open');
              document.querySelectorAll('.menu-category.is-flyout-open').forEach((c) => {
                c.classList.remove('is-flyout-open');
              });
              if (!wasOpen) category.classList.add('is-flyout-open');
              return;
            }

            const toggleIcon = header.querySelector('.menu-category-toggle');
            if (itemsContainer) {
              const isExpanded = itemsContainer.style.display !== 'none';
              itemsContainer.style.display = isExpanded ? 'none' : 'block';
              if (toggleIcon) {
                toggleIcon.className = isExpanded
                  ? 'bx bx-chevron-right menu-category-toggle'
                  : 'bx bx-chevron-down menu-category-toggle';
              }
              localStorage.setItem(`menu-grupo-${grupoKey}`, !isExpanded);
            }
          });
        });

        initCollapsedMenuFlyouts();
        
        // Event listeners para itens do menu
        const menuItems = document.querySelectorAll('.menu-item');

        menuItems.forEach(el => {
          el.addEventListener('click', () => {
            document.querySelectorAll('.menu-category.is-flyout-open').forEach((c) => {
              c.classList.remove('is-flyout-open');
            });
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
        const headerBtnMotoristasPendentes = document.getElementById('headerBtnMotoristasPendentes');
        const headerBtnSos = document.getElementById('headerBtnSos');
        const hasChat = !!document.querySelector('[data-programa="chat"]');
        const hasAlertas = !!document.querySelector('[data-programa="alertas"]');
        const hasCadastroGeral = !!document.querySelector('[data-programa="gerenciar-cadastro-geral"]');
        const hasSos = !!document.querySelector('[data-programa="sos"]');
        if (headerShortcuts) {
          headerShortcuts.style.display = (hasChat || hasAlertas || hasCadastroGeral || hasSos) ? 'flex' : 'none';
        }
        if (headerBtnChat) {
          headerBtnChat.style.display = hasChat ? 'inline-flex' : 'none';
        }
        if (headerBtnAlertas) {
          headerBtnAlertas.style.display = hasAlertas ? 'inline-flex' : 'none';
        }
        if (headerBtnMotoristasPendentes) {
          headerBtnMotoristasPendentes.style.display = hasCadastroGeral ? 'inline-flex' : 'none';
        }
        if (headerBtnSos) {
          headerBtnSos.style.display = hasSos ? 'inline-flex' : 'none';
        }
        atualizarBadgeDivergenciaPlacas().catch(() => {});
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

  const getIcon = (id, programa) => {
    const prog = programa != null ? String(programa).trim().toLowerCase() : '';
    // WMS / novos módulos: CDTIPOATIVIDADE varia por base — ícone estável por programa.
    const iconsPorPrograma = {
      'estoque': 'package',
      'estoque-recebimento': 'download',
      'estoque-separacao': 'list-ul',
      'estoque-cargas': 'bxs-truck',
      'estoque-expedicao': 'export',
      'estoque-cadastros-wms': 'cog',
      'estoque-inventario': 'clipboard',
      'estoque-transferencias': 'transfer',
      'estoque-relatorios': 'bar-chart-alt-2',
      'estoque-valor': 'money',
      'estoque-cobranca': 'receipt'
    };
    if (prog && Object.prototype.hasOwnProperty.call(iconsPorPrograma, prog)) {
      return iconsPorPrograma[prog];
    }

    // Converter ID para número inteiro (CDTIPOATIVIDADE é sempre inteiro)
    const idNum = parseInt(id, 10);
    
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

  /** Hubs de atalhos na tela inicial por área de produto (ex.: WMS). Ver `docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md` §7. */
  const DASHBOARD_MODULE_HUB_DEFS = {
    estoque: {
      items: [
        { programa: 'estoque', icon: 'bx-package' },
        { programa: 'estoque-recebimento', icon: 'bx-download' },
        { programa: 'estoque-separacao', icon: 'bx-list-ul' },
        { programa: 'estoque-cargas', icon: 'bx-truck' },
        { programa: 'estoque-expedicao', icon: 'bx-export' },
        { programa: 'estoque-cadastros-wms', icon: 'bx-cog' },
        { programa: 'estoque-inventario', icon: 'bx-clipboard' },
        { programa: 'estoque-baixas', icon: 'bx-minus-circle' },
        { programa: 'estoque-transferencias', icon: 'bx-transfer' },
        { programa: 'estoque-relatorios', icon: 'bx-bar-chart-alt-2' },
        { programa: 'estoque-valor', icon: 'bx-money' },
        { programa: 'estoque-cobranca', icon: 'bx-receipt' },
      ],
    },
    /** MODULO_PRODUTO.CODIGO = divulga_cargas_torre (ex.: legado `divulga` — mesmo produto Torre Logística). */
    divulga_cargas_torre: {
      items: [
        { programa: 'gerenciar-viagens', icon: 'bx-trip' },
        { programa: 'gerenciar-mapa-viagem', icon: 'bx-map' },
        { programa: 'relatorio-convocacoes', icon: 'bx-bar-chart-alt-2' },
        { programa: 'chat', icon: 'bx-message' },
        { programa: 'alertas', icon: 'bx-bell' },
        { programa: 'sos', icon: 'bx-error-circle' },
        { programa: 'ranking', icon: 'bx-trophy' },
      ],
    },
  };

  async function collectDashboardHubLinks(hubId) {
    const hid = String(hubId || '').trim().toLowerCase() === 'divulga' ? 'divulga_cargas_torre' : hubId;
    const def = DASHBOARD_MODULE_HUB_DEFS[hid];
    if (!def || !Array.isArray(def.items)) return [];
    const out = [];
    for (const item of def.items) {
      let allowed = true;
      if (typeof window.Permissions !== 'undefined' && window.Permissions.hasPermission) {
        try {
          allowed = await window.Permissions.hasPermission(item.programa);
        } catch (e) {
          allowed = true;
        }
      }
      if (!allowed) continue;
      const menuKey = 'web.menu.item.' + item.programa;
      let nome = typeof window.tWeb === 'function' ? window.tWeb(menuKey) : menuKey;
      if (!nome || nome === menuKey || (typeof nome === 'string' && nome.startsWith('web.'))) {
        nome = item.programa.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      }
      out.push({ programa: item.programa, nome, icon: item.icon });
    }
    return out;
  }

  function restoreDashboardDocTitle() {
    const base = (window.__DASHBOARD_DOC_TITLE_BASE && String(window.__DASHBOARD_DOC_TITLE_BASE).trim())
      || 'Atlas Cargo';
    document.title = base;
  }

  function setDocumentTitleForCurrentModule(programa) {
    const base = (window.__DASHBOARD_DOC_TITLE_BASE && String(window.__DASHBOARD_DOC_TITLE_BASE).trim())
      || 'Atlas Cargo';
    if (!programa || typeof window.tWeb !== 'function') {
      document.title = base;
      return;
    }
    const menuKey = 'web.menu.item.' + programa;
    let part = window.tWeb(menuKey);
    if (!part || part === menuKey || (typeof part === 'string' && part.startsWith('web.'))) {
      part = programa.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    document.title = part + ' — ' + base;
  }

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
    // Overlay movido para body por outros módulos (display:flex !important) bloqueia a tela seguinte.
    document.querySelectorAll('body > #loadingOverlay.calculando-overlay, body > #wmsInvLoadingOverlay').forEach((el) => {
      el.remove();
    });
    contentArea.innerHTML = '<p>Carregando módulo...</p>';

    try {
      // Lista de módulos que PRECISAM de map-config.js (têm mapas)
      const modulosComMapa = [
        'gerenciar-viagens',
        'gerenciar-roteiros',
        'gerenciar-mapa-viagem',
        'relatorio-convocacoes'
      ];
      
      // Só carregar map-config.js se o módulo realmente precisa de mapa
      if (modulosComMapa.includes(programa)) {
        // IMPORTANTE: Garantir que map-config.js está carregado ANTES de carregar o módulo
        if (!window.MAP_CONFIG || !window.getTileServerUrl) {
          console.log('📍 [DASHBOARD] Carregando map-config.js antes do módulo...');
          await new Promise((resolve, reject) => {
            // Verificar se já está carregando
            const mapConfigUrl = corrigirUrl('/js/map-config.js?v=20260915-tiles');
            if (document.querySelector(`script[src*="map-config.js"]`)) {
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
              script.src = mapConfigUrl;
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
            if (el.tagName === 'LINK' && href) {
              // Inclui CDN (leaflet etc.) — antes só injetava href relativo e o mapa quebrava sem CSS
              const already = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => {
                const h = l.getAttribute('href') || '';
                return h === href || (href.includes('leaflet') && h.includes('leaflet'));
              });
              if (already) return;
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              if (href.startsWith('http://') || href.startsWith('https://')) {
                link.href = href;
                if (el.getAttribute('crossorigin') != null) link.crossOrigin = el.getAttribute('crossorigin') || '';
              } else {
                link.href = corrigirUrl(href.startsWith('/') ? href : `/modulos/${programa}/${href}`);
              }
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

        // Aplicar traduções (PT/ES) no conteúdo do módulo
        if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);

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
        const sharedScriptSet = window.__dashboardLoadedSharedScripts || new Set();
        window.__dashboardLoadedSharedScripts = sharedScriptSet;
        const sharedScriptBases = [
          '/js/cache-buster.js',
          '/js/utils.js',
          '/js/i18n-web.js',
          '/js/log-helper.js',
          '/js/init-overlay-helper.js',
          '/js/grid-editor.js',
          '/js/permissions.js'
        ];
        const sharedScriptReadyCheck = {
          '/js/cache-buster.js': () => typeof window.CacheBuster !== 'undefined',
          '/js/utils.js': () => typeof window.showMessage === 'function' && typeof window.confirmPadrao === 'function',
          '/js/i18n-web.js': () => typeof window.applyI18nWeb === 'function' && typeof window.tWeb === 'function',
          '/js/log-helper.js': () => typeof window.logAberturaTela === 'function',
          '/js/init-overlay-helper.js': () => typeof window.executarInitSQLPadrao === 'function' && typeof window.hideLoadingOverlayInitSQL === 'function',
          // Não usar "true": o <script> do HTML já está no DOM antes de executar; "já no DOM" !== "já executou".
          '/js/grid-editor.js': () => typeof window.GridEditor !== 'undefined',
          '/js/permissions.js': () => typeof window.Permissions !== 'undefined'
        };
        const normalizeScriptSrc = (src) => {
          if (!src) return '';
          let out = String(src);
          try {
            const u = new URL(out, window.location.origin);
            out = u.pathname || out;
          } catch (_e) {}
          return out.split('?')[0].split('#')[0];
        };
        const resolveSharedScriptBase = (src) => {
          const normalized = normalizeScriptSrc(src);
          return sharedScriptBases.find(base => normalized.endsWith(base)) || '';
        };
        const isSharedScriptLoaded = (base) => {
          if (!base) return false;
          const isReady = (sharedScriptReadyCheck[base] && sharedScriptReadyCheck[base]()) || false;
          if (!isReady) return false;
          if (sharedScriptSet.has(base)) return true;
          const alreadyInDom = Array.from(document.scripts || []).some(s => normalizeScriptSrc(s.src).endsWith(base));
          if (alreadyInDom) sharedScriptSet.add(base);
          return alreadyInDom;
        };

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
          const sharedBase = resolveSharedScriptBase(scriptSrc);
          if (sharedBase && isSharedScriptLoaded(sharedBase)) {
            console.log('ℹ️ [DASHBOARD] Script compartilhado já carregado, pulando reinjeção:', sharedBase);
            oldScript.remove();
            continue;
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
          // Script principal do módulo (js/script.js): marca para não carregar de novo abaixo.
          // Com gerenciar-viagens o src pode virar blob:… e o seletor [src*="…/script.js"] falhava → dupla execução.
          if (scriptSrc && scriptSrc.includes(`/${programa}/js/script.js`)) {
            newScript.setAttribute('data-module-main', programa);
          }
          if (!scriptSrc && !newScript.src) newScript.textContent = oldScript.textContent || '';
          
          const scriptPromise = new Promise((resolve) => {
            const scriptUrl = scriptSrc || newScript.src || '(inline)';
            if (!isViagensScript) window.__dashboardLastLoadingScript = scriptUrl;
            newScript.onload = () => {
              if (newScript.src) window.__dashboardLastLoadedScript = newScript.src;
              if (sharedBase) sharedScriptSet.add(sharedBase);
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

        // Reaplicar traduções após scripts do módulo (podem ter inserido mais DOM com data-i18n)
        if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);

        // Alinhar título da aba ao módulo (mesmo texto do menu, quando existir em locales)
        setDocumentTitleForCurrentModule(programa);

        // Armazenar módulo atual para uso no log-helper
        window.currentModule = programa;
        sessionStorage.setItem('currentModule', programa);
        
        // Registrar abertura do módulo
        if (window.logAberturaTela) {
          window.logAberturaTela(programa, `Abertura do módulo: ${programa}`);
        }

        // Carregar scripts compartilhados no head (evita parse error quando anexados na contentArea)
        if (!window.Permissions && !isSharedScriptLoaded('/js/permissions.js')) {
          const permissionsScript = document.createElement('script');
          permissionsScript.src = corrigirUrl('/js/permissions.js');
          permissionsScript.onerror = () => console.warn('⚠️ [DASHBOARD] permissions.js não carregou');
          permissionsScript.onload = () => sharedScriptSet.add('/js/permissions.js');
          document.head.appendChild(permissionsScript);
        }
        if (!window.logAberturaTela && !isSharedScriptLoaded('/js/log-helper.js')) {
          const logHelperScript = document.createElement('script');
          logHelperScript.src = corrigirUrl('/js/log-helper.js');
          logHelperScript.onerror = () => console.warn('⚠️ [DASHBOARD] log-helper.js não carregou');
          logHelperScript.onload = () => sharedScriptSet.add('/js/log-helper.js');
          document.head.appendChild(logHelperScript);
        }

        // Carrega o script do módulo só se ainda não foi carregado pelo HTML do módulo
        // (evita carregar 2x e "Unexpected end of input" ao reexecutar/sobrescrever)
        const moduleScriptBaseUrl = corrigirUrl(`/modulos/${programa}/js/script.js`);
        const alreadyLoadedModuleScript = contentArea.querySelector(`script[data-module-main="${programa}"]`)
          || contentArea.querySelector(`script[src*="${programa}/js/script.js"]`);
        if (!alreadyLoadedModuleScript) {
          const script = document.createElement('script');
          script.src = moduleScriptBaseUrl + (moduleScriptBaseUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now() + '&r=' + Math.random().toString(36).slice(2);
          script.onerror = () => { /* silencioso */ };
          script.onload = () => {
            const modulosComMapa = ['gerenciar-viagens', 'gerenciar-roteiros', 'gerenciar-mapa-viagem', 'relatorio-convocacoes'];
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
        restoreDashboardDocTitle();
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
        restoreDashboardDocTitle();
      }
    } catch (err) {
      console.error('Erro ao carregar módulo:', err);
      contentArea.innerHTML = `
        <h3>Erro de carregamento</h3>
        <p>Não foi possível carregar o módulo "${programa}".</p>
      `;
      restoreDashboardDocTitle();
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
    if (params.cadastroGeralMotoristasPendentes) {
      const tentar = (tentativa) => {
        if (typeof window.__aplicarFiltrosCadastroGeralMotoristasPendentes === 'function') {
          window.__aplicarFiltrosCadastroGeralMotoristasPendentes();
          return;
        }
        if (tentativa < 25) {
          setTimeout(() => tentar(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentar(0), 400);
    }
    if (params.cadastroGeralEnderecoEntrega) {
      const payload = params.cadastroGeralEnderecoEntrega;
      const tentarEe = (tentativa) => {
        if (typeof window.__aplicarAbrirCadastroGeralEnderecoEntrega === 'function') {
          window.__aplicarAbrirCadastroGeralEnderecoEntrega(payload);
          return;
        }
        if (tentativa < 35) {
          setTimeout(() => tentarEe(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentarEe(0), 400);
    }
    if (params.nfEnderecoPendentes) {
      const tentarNfPend = (tentativa) => {
        if (typeof window.__aplicarAbrirNfEnderecoPendentes === 'function') {
          window.__aplicarAbrirNfEnderecoPendentes();
          return;
        }
        if (tentativa < 35) {
          setTimeout(() => tentarNfPend(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentarNfPend(0), 400);
    }
    if (params.equipamentoIdFiltro != null && String(params.equipamentoIdFiltro).trim() !== '') {
      const idF = String(params.equipamentoIdFiltro).trim();
      const tentarEq = (tentativa) => {
        const filtroIdEquipamento = document.getElementById('filtroIdEquipamento');
        const form = document.getElementById('filtroForm');
        if (filtroIdEquipamento && form) {
          filtroIdEquipamento.value = idF;
          setTimeout(() => {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.click();
          }, 350);
          return;
        }
        if (tentativa < 25) {
          setTimeout(() => tentarEq(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentarEq(0), 400);
    }
    if (params.convocacoesDivergenciaPlacas) {
      const tentarDiv = (tentativa) => {
        if (typeof window.__aplicarAbrirConvocacoesDivergenciaPlacas === 'function') {
          window.__aplicarAbrirConvocacoesDivergenciaPlacas();
          return;
        }
        if (tentativa < 35) {
          setTimeout(() => tentarDiv(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentarDiv(0), 500);
    }
    if (params.wmsCadNavProgramacao) {
      const tentarWms = (tentativa) => {
        if (typeof window.__aplicarNavProgramacaoPeso === 'function') {
          window.__aplicarNavProgramacaoPeso(params.wmsCadNavProgramacao);
          return;
        }
        if (tentativa < 35) {
          setTimeout(() => tentarWms(tentativa + 1), 200);
        }
      };
      setTimeout(() => tentarWms(0), 500);
    }
  }

  // Tornar loadModuleContent acessível globalmente
  window.loadModuleContent = loadModuleContent;

  /** Código do módulo de produto selecionado (sidebar): `base` = visão transporte/viagens / todos os módulos. */
  function readSelectedProductModuleCodigoLower() {
    var login = '';
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      login = user.login || user.SGUSUARIO || user.sgUsuario || '';
    } catch (e) {}
    var saved = readAtlasModuloPreference(login, null);
    if (saved === '') return 'base';
    try {
      var sel = document.getElementById('productModuleSelect');
      if (sel && sel.value && String(sel.value).trim() !== '') {
        return normalizeAtlasModuloCodigo(sel.value);
      }
    } catch (e2) {}
    return saved || 'base';
  }

  function getAuthHeadersComLoginUsuario() {
    const h = Object.assign({}, getAuthHeaders());
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        const login = user.login || user.SGUSUARIO || user.sgUsuario;
        if (login) h['user-login'] = login;
      }
    } catch (e) {}
    return h;
  }

  /**
   * KPIs leves para a home do módulo Estoque/WMS (somente GET).
   * Estratégia: chama o endpoint agregado /api/wms/dashboard/resumo (uma única
   * requisição). Se ele não estiver disponível (instância antiga), faz fallback
   * para as chamadas individuais — mantendo o painel funcional.
   */
  async function fetchWmsDashboardResumo() {
    const h = getAuthHeadersComLoginUsuario();
    const out = {
      nfAbertas: null,
      nfEncerradas: null,
      oplEspelhos: null,
      oplPickingPendentes: null,
      oplPickingPendentesMontagem: null,
      oplPickingPendentesHistorico: null,
      cargasTotal: null,
      cargasPendentesExpedicao: null,
      // Novos campos (Fase 1 do painel ampliado).
      separacaoPendentes: null,
      shelfLifeCriticos: null,
      shelfLifeVencidos: null,
      shelfLifeCurto: null,
      shelfLifeTotal: null,
      shelfLifeHorizonteDias: 60,
      saldoNegativos: null,
      inventariosAbertos: null,
      detalhes: null,
      geradoEm: null,
      erro: false,
    };
    // 1. Tenta o endpoint agregado.
    try {
      const r = await fetch(corrigirUrl('/api/wms/dashboard/resumo'), { headers: h });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j === 'object') {
          out.nfAbertas = j.nfAbertas;
          out.nfEncerradas = j.nfEncerradas;
          out.oplEspelhos = j.oplEspelhos;
          out.oplPickingPendentes = j.oplPickingPendentesMontagem != null ? j.oplPickingPendentesMontagem : j.oplPickingPendentes;
          out.oplPickingPendentesMontagem = j.oplPickingPendentesMontagem;
          out.oplPickingPendentesHistorico = j.oplPickingPendentesHistorico != null ? j.oplPickingPendentesHistorico : j.oplPickingPendentes;
          out.cargasTotal = j.cargasTotal;
          out.cargasPendentesExpedicao = j.expedicaoPendentes;
          out.separacaoPendentes = j.separacaoPendentes;
          out.shelfLifeCriticos = j.shelfLifeCriticos;
          out.shelfLifeVencidos = j.shelfLifeVencidos;
          out.shelfLifeCurto = j.shelfLifeCurto;
          out.shelfLifeTotal = j.shelfLifeTotal;
          out.shelfLifeHorizonteDias = j.shelfLifeHorizonteDias;
          out.saldoNegativos = j.saldoNegativos;
          out.inventariosAbertos = j.inventariosAbertos;
          out.detalhes = j.detalhes && typeof j.detalhes === 'object' ? j.detalhes : null;
          out.geradoEm = j.geradoEm || null;
          return out;
        }
      }
    } catch (e) {
      // segue para fallback
    }
    // 2. Fallback — chamadas individuais (compat. com instâncias antigas).
    try {
      const [rDoc, rOpl, rCar, rExp] = await Promise.all([
        fetch(corrigirUrl('/api/wms/recebimento/documentos'), { headers: h }),
        fetch(corrigirUrl('/api/wms/separacao/opl/importacoes'), { headers: h }),
        fetch(corrigirUrl('/api/wms/cargas/programadas?page=1&pageSize=200'), { headers: h }),
        fetch(corrigirUrl('/api/wms/expedicao/cargas'), { headers: h }),
      ]);
      if (rDoc.ok) {
        const arr = await rDoc.json();
        const list = Array.isArray(arr) ? arr : [];
        out.nfAbertas = list.filter(
          (x) => String(x.ST_RECEBIMENTO || x.st_recebimento || '').toUpperCase() !== 'ENCERRADA'
        ).length;
        out.nfEncerradas = list.filter(
          (x) => String(x.ST_RECEBIMENTO || x.st_recebimento || '').toUpperCase() === 'ENCERRADA'
        ).length;
      }
      if (rOpl.ok) {
        const arrO = await rOpl.json();
        out.oplEspelhos = Array.isArray(arrO) ? arrO.length : 0;
      }
      if (rCar.ok) {
        const j = await rCar.json();
        const total = j.total != null ? Number(j.total) : Array.isArray(j.items) ? j.items.length : 0;
        out.cargasTotal = Number.isFinite(total) ? total : 0;
      }
      if (rExp.ok) {
        const arrE = await rExp.json();
        const listE = Array.isArray(arrE) ? arrE : [];
        out.cargasPendentesExpedicao = listE.filter(
          (x) => String(x.ST_EXPEDICAO || x.st_expedicao || '').toUpperCase() === 'EM_EXPEDICAO'
        ).length;
      }
    } catch (e) {
      out.erro = true;
    }
    return out;
  }

  // Função para restaurar a tela inicial com propaganda
  const showWelcomeScreen = async () => {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    const _t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
    if (window.i18nWebReady) await window.i18nWebReady;

    var localeNum = document.documentElement.lang === 'es' ? 'es-PY' : 'pt-BR';
    var localeForNumber = localeNum === 'es-PY' ? 'es-PY' : 'pt-BR';

    let moduleCodigo = readSelectedProductModuleCodigoLower();
    if (moduleCodigo === 'divulga') {
      moduleCodigo = 'divulga_cargas_torre';
      try {
        writeAtlasModuloPreference(
          (function () {
            try {
              var u = JSON.parse(localStorage.getItem('user') || '{}');
              return u.login || u.SGUSUARIO || '';
            } catch (eU) {
              return '';
            }
          })(),
          'divulga_cargas_torre'
        );
        const selFix = document.getElementById('productModuleSelect');
        if (selFix && selFix.querySelector('option[value="divulga_cargas_torre"]')) selFix.value = 'divulga_cargas_torre';
      } catch (eM) {}
    }

    const escHtml = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');

    const fmtKpi = (n) => (n == null ? '—' : Number(n).toLocaleString(localeForNumber));
    const fmtKpiDetalhe = (items) => {
      if (!items || !items.length) return '';
      const ids = items.map((x) => '#' + String(x.id != null ? x.id : x.ID != null ? x.ID : x));
      const lista = ids.slice(0, 12).join(', ') + (ids.length > 12 ? '…' : '');
      return `<span class="stat-kpi-detalhe">${escHtml(
        _t('web.dashboard.homeEstoqueKpiDetalheIds').replace('{lista}', lista)
      )}</span>`;
    };

    if (moduleCodigo === 'estoque') {
      const estoqueHubLinksMod = await collectDashboardHubLinks('estoque');
      const w = await fetchWmsDashboardResumo();
      const det = w.detalhes || {};
      const alertExp =
        w.cargasPendentesExpedicao != null && w.cargasPendentesExpedicao > 0
          ? `
      <div class="dashboard-alerts">
        <div class="alert-card alert-warning">
          <i class='bx bx-export'></i>
          <div>
            <strong>${escHtml(_t('web.dashboard.atencao'))}</strong>
            <p>${escHtml(_t('web.dashboard.homeEstoqueAlertExpedir').replace('{n}', String(w.cargasPendentesExpedicao)))}</p>
          </div>
        </div>
      </div>`
          : '';
      const quickEstoque =
        estoqueHubLinksMod.length > 0
          ? `
      <div class="dashboard-quick-links">
        <h4><i class='bx bx-store'></i> ${escHtml(_t('web.dashboard.homeEstoqueAcessoRapido'))}</h4>
        <p class="dashboard-module-hub-desc" style="margin: -6px 0 12px">${escHtml(_t('web.dashboard.hubEstoqueDesc'))}</p>
        <div class="quick-links-grid">
          ${estoqueHubLinksMod
            .map(
              (link) => `
            <button type="button" class="quick-link-btn" onclick="window.loadModuleContent('${escHtml(link.programa)}')">
              <i class='bx ${escHtml(link.icon)}'></i>
              <span>${escHtml(link.nome)}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>`
          : `<div class="dashboard-quick-links"><p class="dashboard-module-hub-desc">${escHtml(
              _t('web.dashboard.homeEstoqueSemPermissaoSubmodulos')
            )}</p></div>`;

      contentArea.innerHTML = `
      <div class="welcome-section">
        <div class="welcome-section-head">
          <h3>${escHtml(_t('web.dashboard.homeEstoqueBemVindo'))}</h3>
          <a class="welcome-manual-btn" href="/modulos/estoque/manual-operacional-wms.html" target="_blank" rel="noopener">
            <i class="bx bx-book-open"></i> ${escHtml(_t('web.dashboard.homeEstoqueManualBtn'))}
          </a>
        </div>
        <p>${escHtml(_t('web.dashboard.homeEstoqueSub'))}</p>
      </div>
      <div class="dashboard-stats-grid">
        <div class="dashboard-stat-card primary">
          <div class="stat-card-icon"><i class='bx bx-download'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardNfOperacao'))}</h4>
            <p class="stat-value">${fmtKpi(w.nfAbertas)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardNfOperacaoSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card success">
          <div class="stat-card-icon"><i class='bx bx-check-circle'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardNfEncerradas'))}</h4>
            <p class="stat-value">${fmtKpi(w.nfEncerradas)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardNfEncerradasSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card info">
          <div class="stat-card-icon"><i class='bx bx-list-ul'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardOpl'))}</h4>
            <p class="stat-value">${fmtKpi(w.oplEspelhos)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardOplSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${(w.oplPickingPendentesMontagem != null ? w.oplPickingPendentesMontagem : w.oplPickingPendentes) > 0 ? 'warning' : 'info'}" data-go-modulo="estoque-separacao" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-scan'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardOplPickPendente'))}</h4>
            <p class="stat-value">${fmtKpi(w.oplPickingPendentesMontagem != null ? w.oplPickingPendentesMontagem : w.oplPickingPendentes)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardOplPickPendenteSub'))}</span>
            ${w.oplPickingPendentesHistorico > 0
              ? `<span class="stat-label" style="display:block;margin-top:4px;font-size:0.85em;opacity:0.85">${escHtml(_t('web.dashboard.homeEstoqueCardOplPickHistoricoSub').replace('{n}', String(w.oplPickingPendentesHistorico)))}</span>`
              : ''}
            ${fmtKpiDetalhe(det.oplPickingMontagem)}
          </div>
        </div>
        <div class="dashboard-stat-card ${w.cargasTotal > 0 ? 'warning' : 'info'}" data-go-modulo="estoque-cargas" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-package'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardCargas'))}</h4>
            <p class="stat-value">${fmtKpi(w.cargasTotal)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardCargasSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${w.separacaoPendentes > 0 ? 'warning' : 'info'}" data-go-modulo="estoque-cargas" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-list-check'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardSepPendente'))}</h4>
            <p class="stat-value">${fmtKpi(w.separacaoPendentes)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardSepPendenteSub'))}</span>
            ${fmtKpiDetalhe(det.montagemCargas)}
          </div>
        </div>
        <div class="dashboard-stat-card ${w.cargasPendentesExpedicao > 0 ? 'warning' : 'info'}" data-go-modulo="estoque-expedicao" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-export'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardExpPendente'))}</h4>
            <p class="stat-value">${fmtKpi(w.cargasPendentesExpedicao)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardExpPendenteSub'))}</span>
            ${fmtKpiDetalhe(det.expedicaoSaida)}
          </div>
        </div>
        <div class="dashboard-stat-card ${(w.shelfLifeVencidos || w.shelfLifeCriticos) > 0 ? 'danger' : w.shelfLifeTotal > 0 ? 'warn' : 'info'}" data-go-modulo="estoque-relatorios" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-calendar-exclamation'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardValidade'))}</h4>
            <p class="stat-value">${fmtKpi(w.shelfLifeTotal)}</p>
            <span class="stat-label">${
              w.shelfLifeVencidos != null && w.shelfLifeCriticos != null
                ? escHtml(
                    _t('web.dashboard.homeEstoqueCardValidadeSub')
                      .replace('{vencidos}', String(w.shelfLifeVencidos))
                      .replace('{criticos}', String(w.shelfLifeCriticos))
                      .replace('{curto}', String(w.shelfLifeCurto != null ? w.shelfLifeCurto : 0))
                      .replace(
                        '{horizonte}',
                        String(w.shelfLifeHorizonteDias != null ? w.shelfLifeHorizonteDias : 60)
                      )
                  )
                : escHtml(_t('web.dashboard.homeEstoqueCardValidadeSubSimples'))
            }</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${w.saldoNegativos > 0 ? 'danger' : 'info'}" data-go-modulo="estoque-relatorios" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-trending-down'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardSaldoNeg'))}</h4>
            <p class="stat-value">${fmtKpi(w.saldoNegativos)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardSaldoNegSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${w.inventariosAbertos > 0 ? 'warning' : 'info'}" data-go-modulo="estoque-inventario" role="button" tabindex="0">
          <div class="stat-card-icon"><i class='bx bx-clipboard'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueCardInventarios'))}</h4>
            <p class="stat-value">${fmtKpi(w.inventariosAbertos)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.homeEstoqueCardInventariosSub'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card info">
          <div class="stat-card-icon"><i class='bx bx-spreadsheet'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeEstoqueDicaTitulo'))}</h4>
            <p class="stat-tip">${escHtml(_t('web.dashboard.homeEstoqueDicaTexto'))}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.dicaUtil'))}</span>
          </div>
        </div>
      </div>
      ${w.erro ? `<div class="dashboard-alerts"><div class="alert-card"><i class='bx bx-info-circle'></i><div><p>${escHtml(_t('web.dashboard.homeEstoqueKpiParcial'))}</p></div></div></div>` : ''}
      ${alertExp}
      ${quickEstoque}
    `;
      if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);
      /** Cards do painel WMS com data-go-modulo viram clicáveis e navegam ao
       *  módulo correspondente. Cursor + teclado (Enter/Space) suportados. */
      contentArea.querySelectorAll('.dashboard-stat-card[data-go-modulo]').forEach((card) => {
        const programa = card.getAttribute('data-go-modulo');
        if (!programa) return;
        card.style.cursor = 'pointer';
        const go = () => {
          if (typeof window.loadModuleContent === 'function') window.loadModuleContent(programa);
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            go();
          }
        });
      });
      restoreDashboardDocTitle();
      return;
    }

    if (moduleCodigo === 'divulga_cargas_torre') {
      let statsTorre = {
        totalViagens: 0,
        viagensPendentes: 0,
        convocacoesPendentes: 0,
        divergenciaPlacas: 0,
      };
      try {
        const apiUrlTorre = corrigirUrl('/api/relatorio-convocacoes/estatisticas');
        const responseConvTorre = await fetch(apiUrlTorre, { headers: getAuthHeaders() });
        if (responseConvTorre.ok) {
          const dataConvT = await responseConvTorre.json();
          // Cadastro (VIAGEMMESTRE), não só viagens que já têm convocação
          statsTorre.totalViagens = dataConvT.TOTAL_VIAGENS_CADASTRO ?? dataConvT.TOTAL_VIAGENS ?? 0;
          statsTorre.convocacoesPendentes = dataConvT.PENDENTE_ACIONAVEL ?? dataConvT.PENDENTE ?? 0;
          statsTorre.viagensPendentes = dataConvT.VIAGENS_PENDENTES || 0;
          statsTorre.divergenciaPlacas = Number(dataConvT.DIVERGENCIA_PLACAS ?? dataConvT.divergencia_placas ?? 0) || 0;
        }
      } catch (e) {
        console.warn('Erro ao carregar estatísticas (home Torre):', e);
      }

      const torreHubLinks = await collectDashboardHubLinks('divulga_cargas_torre');
      const quickTorre =
        torreHubLinks.length > 0
          ? `
      <div class="dashboard-quick-links">
        <h4><i class='bx bx-buildings'></i> ${escHtml(_t('web.dashboard.homeTorreAcessoRapido'))}</h4>
        <p class="dashboard-module-hub-desc" style="margin: -6px 0 12px">${escHtml(_t('web.dashboard.hubTorreDesc'))}</p>
        <div class="quick-links-grid">
          ${torreHubLinks
            .map(
              (link) => `
            <button type="button" class="quick-link-btn" onclick="window.loadModuleContent('${escHtml(link.programa)}')">
              <i class='bx ${escHtml(link.icon)}'></i>
              <span>${escHtml(link.nome)}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>`
          : `<div class="dashboard-quick-links"><p class="dashboard-module-hub-desc">${escHtml(
              _t('web.dashboard.homeTorreSemPermissaoSubmodulos')
            )}</p></div>`;

      contentArea.innerHTML = `
      <div class="welcome-section">
        <h3>${escHtml(_t('web.dashboard.homeTorreBemVindo'))}</h3>
        <p>${escHtml(_t('web.dashboard.homeTorreSub'))}</p>
      </div>
      <div class="dashboard-stats-grid">
        <div class="dashboard-stat-card primary">
          <div class="stat-card-icon"><i class='bx bx-trip'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.totalViagens'))}</h4>
            <p class="stat-value">${fmtKpi(statsTorre.totalViagens)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.viagensCadastradas'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${statsTorre.viagensPendentes > 0 ? 'warning' : 'success'}">
          <div class="stat-card-icon"><i class='bx bx-time-five'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.viagensPendentes'))}</h4>
            <p class="stat-value">${fmtKpi(statsTorre.viagensPendentes)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.aguardandoAcao'))}</span>
          </div>
        </div>
        <div class="dashboard-stat-card ${statsTorre.convocacoesPendentes > 0 ? 'warning' : 'info'}">
          <div class="stat-card-icon"><i class='bx bx-bell'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.convocacoesPendentes'))}</h4>
            <p class="stat-value">${fmtKpi(statsTorre.convocacoesPendentes)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.aguardandoResposta'))}</span>
          </div>
        </div>
        ${
          statsTorre.divergenciaPlacas > 0
            ? `<div class="dashboard-stat-card warning" style="cursor:pointer" role="button" tabindex="0" onclick="window.loadModuleContent('gerenciar-viagens',{convocacoesDivergenciaPlacas:true})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.loadModuleContent('gerenciar-viagens',{convocacoesDivergenciaPlacas:true});}">
          <div class="stat-card-icon"><i class='bx bx-error-alt'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.divergenciaPlacasMotorista'))}</h4>
            <p class="stat-value">${fmtKpi(statsTorre.divergenciaPlacas)}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.divergenciaPlacasMotoristaSub'))}</span>
          </div>
        </div>`
            : `<div class="dashboard-stat-card info">
          <div class="stat-card-icon"><i class='bx bx-radar'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeTorreDicaTitulo'))}</h4>
            <p class="stat-tip">${escHtml(_t('web.dashboard.homeTorreDicaTexto'))}</p>
            <span class="stat-label">${escHtml(_t('web.dashboard.dicaUtil'))}</span>
          </div>
        </div>`
        }
      </div>
      ${
        statsTorre.viagensPendentes > 0 || statsTorre.convocacoesPendentes > 0 || statsTorre.divergenciaPlacas > 0
          ? `
      <div class="dashboard-alerts">
        <div class="alert-card ${
          statsTorre.convocacoesPendentes > 0 || statsTorre.divergenciaPlacas > 0 ? 'alert-warning' : ''
        }">
          <i class='bx bx-error-circle'></i>
          <div>
            <strong>${escHtml(_t('web.dashboard.atencao'))}</strong>
            ${
              statsTorre.convocacoesPendentes > 0
                ? `<p>${escHtml(_t('web.dashboard.convocacoesPendentesMsg').replace('{n}', String(statsTorre.convocacoesPendentes)))}</p>`
                : ''
            }
            ${
              statsTorre.divergenciaPlacas > 0
                ? `<p>${escHtml(_t('web.dashboard.divergenciaPlacasMotoristaMsg').replace('{n}', String(statsTorre.divergenciaPlacas)))}</p>`
                : ''
            }
            ${
              statsTorre.viagensPendentes > 0
                ? `<p>${escHtml(_t('web.dashboard.viagensPendentesMsg').replace('{n}', String(statsTorre.viagensPendentes)))}</p>`
                : ''
            }
          </div>
        </div>
      </div>`
          : ''
      }
      ${quickTorre}
    `;
      if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);
      restoreDashboardDocTitle();
      return;
    }

    if (moduleCodigo !== 'base') {
      contentArea.innerHTML = `
      <div class="welcome-section">
        <h3>${escHtml(_t('web.dashboard.homeModuloOutroTitulo').replace('{codigo}', moduleCodigo))}</h3>
        <p>${escHtml(_t('web.dashboard.homeModuloOutroSub'))}</p>
      </div>
      <div class="dashboard-stats-grid">
        <div class="dashboard-stat-card info">
          <div class="stat-card-icon"><i class='bx bx-grid-alt'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeModuloOutroCardMenu'))}</h4>
            <p class="stat-tip">${escHtml(_t('web.dashboard.homeModuloOutroCardMenuTexto'))}</p>
          </div>
        </div>
        <div class="dashboard-stat-card primary">
          <div class="stat-card-icon"><i class='bx bx-home'></i></div>
          <div class="stat-card-content">
            <h4>${escHtml(_t('web.dashboard.homeModuloOutroCardBase'))}</h4>
            <p class="stat-tip">${escHtml(_t('web.dashboard.homeModuloOutroCardBaseTexto'))}</p>
          </div>
        </div>
      </div>
    `;
      if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);
      restoreDashboardDocTitle();
      return;
    }

    // Carregar estatísticas
    let stats = {
      totalViagens: 0,
      viagensPendentes: 0,
      totalEquipamentos: 0,
      totalUsuarios: 0,
      convocacoesPendentes: 0,
      divergenciaPlacas: 0,
    };
    
    try {
      // Buscar estatísticas (convocações + cadastro de viagens no mesmo endpoint)
      const apiUrl = corrigirUrl('/api/relatorio-convocacoes/estatisticas');
      const responseConv = await fetch(apiUrl, { headers: getAuthHeaders() });
      if (responseConv.ok) {
        const dataConv = await responseConv.json();
        // Total = viagens cadastradas (VIAGEMMESTRE), alinhado ao grid Gerenciar Viagens
        stats.totalViagens = dataConv.TOTAL_VIAGENS_CADASTRO ?? dataConv.TOTAL_VIAGENS ?? 0;
        // Pendente no dashboard = somente as convocações ainda acionáveis
        // (não contar pendências de viagens já confirmadas por outro motorista).
        stats.convocacoesPendentes = dataConv.PENDENTE_ACIONAVEL ?? dataConv.PENDENTE ?? 0;
        // Viagens pendentes = mesma regra de /api/viagens-pendentes (P/D ativas sem ACEITA/CONFIRMADA)
        stats.viagensPendentes = dataConv.VIAGENS_PENDENTES || 0;
        stats.divergenciaPlacas = Number(dataConv.DIVERGENCIA_PLACAS ?? dataConv.divergencia_placas ?? 0) || 0;
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

    const estoqueHubLinks = await collectDashboardHubLinks('estoque');
    const escHub = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    const estoqueHubBlock =
      estoqueHubLinks.length > 0
        ? `
      <div class="dashboard-quick-links dashboard-module-hub">
        <h4><i class='bx bx-store'></i> ${_t('web.dashboard.hubEstoqueTitulo')}</h4>
        <p class="dashboard-module-hub-desc">${escHub(_t('web.dashboard.hubEstoqueDesc'))}</p>
        <div class="quick-links-grid">
          ${estoqueHubLinks
            .map(
              (link) => `
            <button type="button" class="quick-link-btn" onclick="window.loadModuleContent('${link.programa}')">
              <i class='bx ${escHub(link.icon)}'></i>
              <span>${escHub(link.nome)}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
      `
        : '';

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

        ${
          stats.divergenciaPlacas > 0
            ? `<div class="dashboard-stat-card warning" style="cursor:pointer" role="button" tabindex="0" onclick="window.loadModuleContent('gerenciar-viagens',{convocacoesDivergenciaPlacas:true})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.loadModuleContent('gerenciar-viagens',{convocacoesDivergenciaPlacas:true});}">
          <div class="stat-card-icon">
            <i class='bx bx-error-alt'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.divergenciaPlacasMotorista')}</h4>
            <p class="stat-value">${stats.divergenciaPlacas.toLocaleString(localeForNumber)}</p>
            <span class="stat-label">${_t('web.dashboard.divergenciaPlacasMotoristaSub')}</span>
          </div>
        </div>`
            : `<div class="dashboard-stat-card info">
          <div class="stat-card-icon">
            <i class='bx bx-info-circle'></i>
          </div>
          <div class="stat-card-content">
            <h4>${_t('web.dashboard.dicaDia')}</h4>
            <p class="stat-tip">${_t('web.dashboard.dicaFiltros')}</p>
            <span class="stat-label">${_t('web.dashboard.dicaUtil')}</span>
          </div>
        </div>`
        }
      </div>

      <!-- Avisos e Alertas -->
      ${stats.viagensPendentes > 0 || stats.convocacoesPendentes > 0 || stats.divergenciaPlacas > 0 ? `
      <div class="dashboard-alerts">
        <div class="alert-card ${stats.convocacoesPendentes > 0 || stats.divergenciaPlacas > 0 ? 'alert-warning' : ''}">
          <i class='bx bx-error-circle'></i>
          <div>
            <strong>${_t('web.dashboard.atencao')}</strong>
            ${stats.convocacoesPendentes > 0 ? `<p>${_t('web.dashboard.convocacoesPendentesMsg').replace('{n}', stats.convocacoesPendentes)}</p>` : ''}
            ${stats.divergenciaPlacas > 0 ? `<p>${_t('web.dashboard.divergenciaPlacasMotoristaMsg').replace('{n}', stats.divergenciaPlacas)}</p>` : ''}
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
      ${estoqueHubBlock}
    `;
    if (typeof window.applyI18nWeb === 'function') window.applyI18nWeb(contentArea);
    restoreDashboardDocTitle();
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