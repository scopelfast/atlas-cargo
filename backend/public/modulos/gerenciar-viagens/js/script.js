// backend/public/modulos/gerenciar-viagens/js/script.js
// Gerenciar Viagens - Frontend
// Versão: 1.2
// Atlas Cargo
// Data: 2026-04-05
// Última atualização: 2026-01-XX (Correção definitiva overlayMostrado)
// i18n: helper t() e chaves web.modulos.viagens
// Tudo dentro do IIFE para evitar "Identifier 't' has already been declared" ao recarregar o módulo.

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);

  // Flag global para controlar se o overlay está visível
  if (typeof window.overlayMostrado === 'undefined') {
    window.overlayMostrado = false;
  }
  function getOverlayMostrado() {
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    return window.overlayMostrado;
  }

  // Debug: ative no console com window.__DEBUG_VIAGENS__ = true para ver logs deste módulo
  if (typeof window.__DEBUG_VIAGENS__ === 'undefined') window.__DEBUG_VIAGENS__ = false;
  const _log = (...a) => { if (window.__DEBUG_VIAGENS__) console.log(...a); };
  const _info = (...a) => { if (window.__DEBUG_VIAGENS__) console.info(...a); };

  /** Headers de autenticação para APIs (token + user-login para auditoria). */
  function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return headers;
  }

  function buildApiUrl(path) {
    const pathname = (window.location && window.location.pathname) || '';
    let prefix = '';
    if (pathname.indexOf('/cargas') !== -1) prefix = '/cargas';
    else if (pathname.indexOf('/motorista') !== -1) prefix = '/motorista';
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${prefix}${clean}`;
  }

  /** /api/viagens + sufixo (/path ou ?query), respeitando prefixo /cargas quando aplicável. */
  function urlApiViagens(pathOrQuery = '') {
    const base = buildApiUrl('/api/viagens');
    if (!pathOrQuery) return base;
    const s = String(pathOrQuery);
    if (s.startsWith('?') || s.startsWith('/')) return base + s;
    return `${base}/${s}`;
  }

  /**
   * fetch para rotas sob /api/viagens com Authorization + user-login (auditoria no backend).
   * @param {string} pathSuffix '' | '/id' | '?a=1' | '/regras-compatibilidade'
   * @param {RequestInit} [init]
   */
  function fetchApiViagens(pathSuffix = '', init = {}) {
    const url = urlApiViagens(pathSuffix);
    const { headers: initHeaders, ...rest } = init;
    const headers = getAuthHeaders({
      Accept: 'application/json',
      ...(initHeaders && typeof initHeaders === 'object' ? initHeaders : {})
    });
    return fetch(url, { ...rest, headers });
  }

  /**
   * Se response não for ok, consome o corpo (JSON ou texto) e devolve Error com httpStatus.
   * Se ok, devolve null (chame em seguida response.json() / .text()).
   */
  async function rejeicaoSeRespostaNaoOk(response, fallbackMsg = 'Operação não concluída.') {
    if (response.ok) return null;
    let payload = {};
    try {
      const ct = (response.headers.get('content-type') || '');
      if (ct.includes('application/json')) {
        payload = await response.json();
      } else {
        const t = await response.text();
        if (t) payload = { error: t };
      }
    } catch (e) {
      /* ignore */
    }
    const text = (payload && (payload.error || payload.message || payload.details)) || fallbackMsg;
    const err = new Error(String(text));
    err.httpStatus = response.status;
    err.payload = payload;
    return err;
  }

  /** Tipo de toast para showMessage quando o erro veio da API (409 = conflito / regra de negócio). */
  function tipoMensagemErroHttp(err) {
    return err && err.httpStatus === 409 ? 'warning' : 'error';
  }

  function fetchApiAbsPath(apiPath, init = {}) {
    const clean = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const url = buildApiUrl(clean);
    const { headers: initHeaders, ...rest } = init;
    const headers = getAuthHeaders({
      Accept: 'application/json',
      ...(initHeaders && typeof initHeaders === 'object' ? initHeaders : {})
    });
    return fetch(url, { ...rest, headers });
  }

  /** Converte resposta do gateway (OSRM ou GeoJSON ORS) para formato OSRM esperado pela UI. */
  function normalizarJsonRotaGateway(raw) {
    if (!raw) return null;
    if (raw.code === 'Ok' && raw.routes && raw.routes[0] && raw.routes[0].geometry && raw.routes[0].geometry.coordinates) {
      return raw;
    }
    if (typeof window.normalizarRespostaGatewayOsrm === 'function') {
      return window.normalizarRespostaGatewayOsrm(raw);
    }
    return null;
  }

  async function fetchRotaOsrmViaBackend(coordsStr, timeoutMs = 35000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${buildApiUrl('/api/mapa/rota-osrm')}?coords=${encodeURIComponent(coordsStr)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: getAuthHeaders({ Accept: 'application/json' })
      });
      if (!response.ok) throw new Error(`proxy HTTP ${response.status}`);
      const raw = await response.json();
      const norm = normalizarJsonRotaGateway(raw);
      return norm != null ? norm : raw;
    } finally {
      clearTimeout(tid);
    }
  }

  /** Base OSRM pública para fallback quando router do banco é ORS (GET direto ao ORS não existe no browser). */
  function baseOsrmPublicaFallback() {
    return 'https://router.project-osrm.org/route/v1/driving';
  }

  function servidorParaFetchDiretoOsrm(servidorConfig) {
    const s = String(servidorConfig || '').trim();
    if (s.includes('/ors/')) return baseOsrmPublicaFallback();
    return s || baseOsrmPublicaFallback();
  }

  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const viagemForm = document.getElementById('viagemForm');
  const list = document.getElementById('viagensList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let estadosCarregados = false;
  let preenchendoFromRoteiro = false;
  let cidadesOrigem = [];
  let cidadesDestino = [];
  let roteirosCache = [];
  let mapa = null;
  let marcadorOrigem = null;
  let marcadorDestino = null;
  let linhaRota = null;
  let gridTab = null;
  let lastViagens = null;
  
  // Debug: confirmar que overlayMostrado está carregando (agora no escopo global)

  // ====================================
  // CONFIGURAÇÕES DE MAPA E ROTEAMENTO
  // ====================================
  // IMPORTANTE: Usar APENAS o MAP_CONFIG global de /js/map-config.js
  // NÃO criar configuração local - todos os módulos devem usar o mesmo arquivo!
  
  // Verificar se MAP_CONFIG foi carregado
  if (!window.MAP_CONFIG) {
    console.warn('⚠️ [VIAGENS] MAP_CONFIG não encontrado! Certifique-se de que /js/map-config.js está carregado ANTES deste script.');
  } else {
    _log('✅ [VIAGENS] MAP_CONFIG carregado:', {
      tileServer: window.MAP_CONFIG.tileServer?.substring(0, 50) + '...',
      osrmServer: window.MAP_CONFIG.osrmServer,
      nominatimServer: window.MAP_CONFIG.nominatimServer
    });
  }
  
  // Usar referência ao MAP_CONFIG global (vem de map-config.js)
  const MAP_CONFIG = window.MAP_CONFIG || {};

  // Contexto (locale/timezone) para formatação de datas (Fase 4)
  let contextoViagens = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoViagens() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoViagens.locale = d.locale;
      if (d && d.timezone) contextoViagens.timezone = d.timezone;
      if (d && d.timezone && typeof window.syncAtlasTimezoneInstalacao === 'function') {
        window.syncAtlasTimezoneInstalacao(d.timezone);
      }
    } catch (e) {}
  }
  function fmtDataHora(data) {
    if (data === null || data === undefined) return '-';
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return '-';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(d, contextoViagens.locale, contextoViagens.timezone, { dateStyle: 'short', timeStyle: 'short' });
    }
    return d.toLocaleString(contextoViagens.locale || 'pt-BR', { timeZone: contextoViagens.timezone || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtData(data) {
    if (data === null || data === undefined) return '-';
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return '-';
    try {
      return new Intl.DateTimeFormat(contextoViagens.locale || 'pt-BR', {
        timeZone: contextoViagens.timezone || 'America/Sao_Paulo',
        dateStyle: 'short'
      }).format(d);
    } catch (e) {
      return d.toLocaleDateString(contextoViagens.locale || 'pt-BR');
    }
  }

  // Formatação de moeda (Fase 2): usa contexto (locale) para formato numérico
  function fmtMoeda(valor, codigoMoeda) {
    const m = (codigoMoeda && String(codigoMoeda).trim()) || 'BRL';
    const loc = contextoViagens.locale || 'pt-BR';
    try {
      if (typeof window.formatarMoeda === 'function') return window.formatarMoeda(valor, m, loc);
    } catch (e) {}
    return new Intl.NumberFormat(loc, { style: 'currency', currency: m }).format(valor != null && valor !== '' ? parseFloat(valor) : 0);
  }

  // Função para carregar o Leaflet dinamicamente
  async function carregarLeaflet() {
    // CSS primeiro: se L já veio no HTML do módulo e o CSS do head não foi injetado no dashboard,
    // os tiles ficam espalhados (clássico “mapa doido”).
    if (!document.querySelector('link[href*="leaflet"][rel="stylesheet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    if (typeof L !== 'undefined') {
      return true;
    }

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="leaflet"]');
      if (existing) {
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof L !== 'undefined') {
            clearInterval(checkInterval);
            resolve(true);
          } else if (tentativas++ > 30) {
            clearInterval(checkInterval);
            try { existing.remove(); } catch (e) { /* ignore */ }
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.crossOrigin = '';
            script.onload = () => (typeof L !== 'undefined' ? resolve(true) : reject(new Error('Leaflet sem global L')));
            script.onerror = () => reject(new Error('Falha ao baixar leaflet.js (unpkg)'));
            document.head.appendChild(script);
          }
        }, 200);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin = '';
      script.onload = () => {
        setTimeout(() => {
          if (typeof L !== 'undefined') resolve(true);
          else reject(new Error('Leaflet carregado mas L não está disponível'));
        }, 50);
      };
      script.onerror = () => reject(new Error('Falha ao baixar leaflet.js (unpkg)'));
      document.head.appendChild(script);
    });
  }

  // Função para aguardar o Leaflet estar disponível
  async function aguardarLeaflet() {
    try {
      await carregarLeaflet();
      return true;
    } catch (err) {
      console.error('Erro ao carregar Leaflet:', err);
      return false;
    }
  }

  // Flag para controlar se o init já foi executado
  let initExecutado = false;
  // Flag para controlar se o SQL já foi executado (proteção adicional)
  let sqlExecutado = false;
  // Flag para controlar se o módulo acabou de ser carregado (primeira vez)
  let primeiraCarga = true;

  // Função de inicialização
  async function init() {
    // Se já foi executado, não executar novamente
    // IMPORTANTE: Verificar e marcar IMEDIATAMENTE para evitar execuções simultâneas
    if (initExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    // Isso previne condições de corrida onde múltiplas chamadas acontecem antes da primeira terminar
    initExecutado = true;
    
    // Contexto (locale/timezone) para formatação de datas (Fase 4)
    loadContextoViagens();
    
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) se existir
    // e AGUARDAR completamente antes de prosseguir
    try {
      await executarInitSQL();
      
      // O delay adicional já está dentro da função executarInitSQL()
      // Não precisamos de delay extra aqui, pois a função já aguarda tudo
    } catch (err) {
      // Erros silenciosos - não bloquear o módulo
    }
    
    // IMPORTANTE: Só mudar para a aba de filtros se for a primeira carga do módulo
    // E não estiver bloqueando mudanças (durante operações)
    // E APENAS após garantir que todo o SQL foi executado
    if (primeiraCarga && !bloqueandoMudancaAba) {
      const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
      // Só mudar se não houver aba ativa ou se já estiver em filtros
      if (!abaAtiva || abaAtiva === 'filtros') {
        // O showTab vai verificar se precisa carregar os combos e carregar automaticamente
        await showTab('filtros');
        // Preencher valores padrão dos filtros
        preencherFiltrosPadrao();
      }
      primeiraCarga = false; // Marcar que não é mais a primeira carga
    }

    // Aplicar dark mode na aba Macros (forçar fundo escuro; CSS às vezes não vence inline/ordem)
    aplicarDarkModeMacros();
  }

  /** Força estilos de dark mode na aba Macros (barra ID Viagem/Total + lista/tabela) quando tema for dark */
  function aplicarDarkModeMacros() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.getAttribute('data-theme') === 'dark';
    const statsBox = document.getElementById('macrosStatsBox');
    const listaBox = document.getElementById('macrosLista');
    if (isDark) {
      if (statsBox) {
        statsBox.style.setProperty('background', '#0f172a', 'important');
        statsBox.style.setProperty('border-color', '#334155', 'important');
        statsBox.style.setProperty('color', '#e2e8f0', 'important');
        statsBox.querySelectorAll('strong, span').forEach(el => {
          el.style.setProperty('color', '#e2e8f0', 'important');
        });
        const succ = statsBox.querySelector('.text-success'); if (succ) succ.style.setProperty('color', '#4ade80', 'important');
        const dang = statsBox.querySelector('.text-danger'); if (dang) dang.style.setProperty('color', '#f87171', 'important');
      }
      if (listaBox) {
        listaBox.style.setProperty('background', '#1e293b', 'important');
        listaBox.style.setProperty('border-color', '#334155', 'important');
        listaBox.querySelectorAll('.macros-table').forEach(tbl => {
          tbl.style.setProperty('background', '#1e293b', 'important');
          tbl.querySelectorAll('thead tr, thead th').forEach(el => { el.style.setProperty('background', '#0f172a', 'important'); el.style.setProperty('color', '#f1f5f9', 'important'); });
          tbl.querySelectorAll('tbody tr').forEach(tr => { tr.style.setProperty('background', '#1e293b', 'important'); });
          tbl.querySelectorAll('tbody td').forEach(td => { td.style.setProperty('background', '#1e293b', 'important'); td.style.setProperty('color', '#e2e8f0', 'important'); });
        });
        Array.from(listaBox.children).filter(el => el.tagName === 'DIV').forEach(div => { div.style.setProperty('color', '#94a3b8', 'important'); });
      }
    } else {
      if (statsBox) {
        statsBox.style.removeProperty('background'); statsBox.style.removeProperty('border-color'); statsBox.style.removeProperty('color');
        statsBox.querySelectorAll('strong, span').forEach(el => { el.style.removeProperty('color'); });
        const succ = statsBox.querySelector('.text-success'); if (succ) succ.style.removeProperty('color');
        const dang = statsBox.querySelector('.text-danger'); if (dang) dang.style.removeProperty('color');
      }
      if (listaBox) {
        listaBox.style.removeProperty('background'); listaBox.style.removeProperty('border-color');
        listaBox.querySelectorAll('.macros-table thead tr, .macros-table thead th, .macros-table tbody tr, .macros-table tbody td').forEach(el => { el.style.removeProperty('background'); el.style.removeProperty('color'); });
        Array.from(listaBox.children).filter(el => el.tagName === 'DIV').forEach(div => { div.style.removeProperty('color'); });
      }
    }
  }

  // Função para preencher valores padrão dos filtros
  function preencherFiltrosPadrao() {
    // Motorista Confirmado = Todos (vazio para mostrar todos)
    const filtroMotoristaConfirmado = document.getElementById('filtroMotoristaConfirmado');
    if (filtroMotoristaConfirmado) {
      filtroMotoristaConfirmado.value = '';
    }

    // Situação Viagem = todas (evita ocultar viagens vindas de deep links, ex.: Relatório de Convocações)
    const filtroSituacaoViagem = document.getElementById('filtroSituacaoViagem');
    if (filtroSituacaoViagem) {
      filtroSituacaoViagem.value = '';
    }

    // Data Início = hoje - 30 dias
    const filtroDataInicio = document.getElementById('filtroDataInicio');
    if (filtroDataInicio) {
      const hoje = new Date();
      const dataInicio = new Date(hoje);
      dataInicio.setDate(dataInicio.getDate() - 30);
      // Formatar como YYYY-MM-DD para input type="date"
      const dataInicioFormatada = (typeof window.dataApiParaInputDate === 'function')
        ? window.dataApiParaInputDate(dataInicio, contextoViagens.timezone)
        : dataInicio.toISOString().split('T')[0];
      filtroDataInicio.value = dataInicioFormatada;
    }

    // Data Fim = hoje + 7 dias (getdate() + 7)
    const filtroDataFim = document.getElementById('filtroDataFim');
    if (filtroDataFim) {
      const hoje = new Date();
      const dataFim = new Date(hoje);
      dataFim.setDate(dataFim.getDate() + 7);
      // Formatar como YYYY-MM-DD para input type="date"
      const dataFimFormatada = (typeof window.dataApiParaInputDate === 'function')
        ? window.dataApiParaInputDate(dataFim, contextoViagens.timezone)
        : dataFim.toISOString().split('T')[0];
      filtroDataFim.value = dataFimFormatada;
    }
  }

  // Funções para controlar overlay de carregamento do init.sql
  function showLoadingOverlayInitSQL(titulo = 'Processando Inicialização', texto = 'Executando scripts de inicialização...', detalhe = 'Isso pode levar alguns segundos.') {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    const loadingTitle = document.getElementById('loadingTitleInitSQL');
    const loadingText = document.getElementById('loadingTextInitSQL');
    const loadingDetail = document.getElementById('loadingDetailInitSQL');
    
    if (overlay && loadingTitle && loadingText && loadingDetail) {
      loadingTitle.textContent = titulo;
      loadingText.textContent = texto;
      loadingDetail.textContent = detalhe;
      overlay.style.display = 'flex';
    }
  }

  function hideLoadingOverlayInitSQL() {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Funções para controlar overlay de carregamento dos filtros
  function showLoadingOverlayFiltros(titulo = 'Aplicando Filtros', texto = 'Por favor, aguarde enquanto aplicamos os filtros...') {
    const overlay = document.getElementById('loadingOverlayFiltros');
    const loadingTitle = document.getElementById('loadingTitleFiltros');
    const loadingText = document.getElementById('loadingTextFiltros');
    if (overlay) {
      if (loadingTitle) {
        loadingTitle.textContent = titulo;
      }
      if (loadingText) {
        loadingText.textContent = texto;
      }
      overlay.style.display = 'flex';
    }
  }
  
  function hideLoadingOverlayFiltros() {
    const overlay = document.getElementById('loadingOverlayFiltros');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    // Proteção: Se já foi executado nesta execução do script, não executar novamente
    // (mas permite executar novamente se o módulo for recarregado)
    if (sqlExecutado) {
      _log('ℹ️ init.sql já foi executado nesta inicialização. Pulando execução.');
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    sqlExecutado = true;
    
    // Mostrar overlay de carregamento (padrão Gerenciar Cidades)
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch('/modulos/gerenciar-viagens/sql/init.sql');
      
      // Atualizar mensagem do overlay
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          return;
        }
        throw new Error(`Erro ao carregar init.sql: ${response.status}`);
      }
      
      const sqlContent = await response.text();
      
      // Remover comentários de bloco /* */ (incluindo multilinhas) usando regex
      let sqlSemComentarios = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
      
      // Remover apenas comentários, mas MANTER 'GO' pois o backend precisa dele para dividir comandos
      const sqlLimpo = sqlSemComentarios
        .split('\n')
        .filter(linha => {
          const linhaTrim = linha.trim();
          // Manter linhas que não são apenas comentários vazios
          // IMPORTANTE: Manter 'GO' pois o backend precisa dele para dividir comandos
          return linhaTrim.length > 0 && 
                 !linhaTrim.startsWith('--');
        })
        .join('\n')
        .trim();
      
      // Se não há SQL para executar, retornar
      if (!sqlLimpo || sqlLimpo.length === 0) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      // Extrair lista de stored procedures que serão executadas para mostrar progresso
      const procedures = [];
      const linhas = sqlLimpo.split('\n');
      linhas.forEach(linha => {
        const linhaUpper = linha.toUpperCase().trim();
        // Procurar por EXEC ou EXECUTE seguido de nome de procedure
        const match = linhaUpper.match(/EXEC(?:UTE)?\s+(?:\[DBO\]\.)?\[?(\w+)\]?/);
        if (match && match[1]) {
          const procName = match[1];
          // Remover prefixo SP_ se existir para melhor legibilidade
          const nomeLimpo = procName.replace(/^SP_/, '');
          if (!procedures.includes(nomeLimpo)) {
            procedures.push(nomeLimpo);
          }
        }
      });
      
      // Contar comandos GO para saber quantos comandos serão executados
      const comandosGO = sqlLimpo.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
      const totalComandos = comandosGO.length;
      
      // Atualizar mensagem: mostrar quantas procedures serão executadas
      if (procedures.length > 0) {
        showLoadingOverlayInitSQL(
          'Processando Inicialização', 
          `Executando ${totalComandos} comando(s) SQL...`, 
          `Procedures: ${procedures.slice(0, 5).join(', ')}${procedures.length > 5 ? ` (+${procedures.length - 5} mais)` : ''}`
        );
        
        // Iniciar simulação de progresso (atualizar a cada 2 segundos)
        let comandoAtual = 0;
        const intervaloProgresso = setInterval(() => {
          comandoAtual++;
          if (comandoAtual <= totalComandos) {
            const procedureAtual = procedures[comandoAtual - 1] || 'Comando SQL';
            showLoadingOverlayInitSQL(
              'Processando Inicialização', 
              `Executando comando ${comandoAtual} de ${totalComandos}...`, 
              `Em execução: ${procedureAtual}`
            );
          }
        }, 2000); // Atualizar a cada 2 segundos
        
        // Armazenar intervalo para limpar depois
        window.intervaloInitSQL = intervaloProgresso;
      } else {
        showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      }
      
      // Executar o SQL via API e AGUARDAR completamente a resposta
      let execResponse;
      try {
        execResponse = await fetchApiViagens('/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          // Aumentar timeout para scripts grandes (MERGE pode demorar)
          signal: AbortSignal.timeout(120000) // 120 segundos (2 minutos)
        });
      } catch (fetchError) {
        if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        if (fetchError.message.includes('ERR_CONNECTION_RESET') || fetchError.message.includes('Failed to fetch')) {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        hideLoadingOverlayInitSQL();
        throw fetchError;
      }
      
      // Verificar se a resposta foi bem-sucedida
      if (!execResponse.ok) {
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Atualizar mensagem: processando resultados
      showLoadingOverlayInitSQL('Processando Inicialização', 'Processando resultados...', 'Quase terminando.');
      
      // Aguardar completamente a resposta JSON
      let result;
      try {
        result = await execResponse.json();
      } catch (jsonError) {
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se result foi definido corretamente
      if (!result || typeof result !== 'object') {
        hideLoadingOverlayInitSQL();
        console.warn('[Init SQL] Resultado não definido ou inválido');
        return; // Não bloquear o módulo
      }
      
      // Verificar se todos os comandos foram executados com sucesso
      if (result.success === false || (result.success === undefined && result.error)) {
        hideLoadingOverlayInitSQL();
        console.warn('[Init SQL] Execução não foi bem-sucedida:', result.error || 'Erro desconhecido');
        return; // Não bloquear o módulo
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result && result.resultados && Array.isArray(result.resultados)) {
        // Incluir também resultados do tipo 'AVISO' (truncamentos em procedures)
        const comandosComProblema = result.resultados.filter(r => r.tipo === 'ERRO' || r.tipo === 'AVISO');
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        const comandosComAviso = result.resultados.filter(r => r.tipo === 'AVISO');
        
        // Tratar avisos primeiro (truncamentos em procedures)
        if (comandosComAviso.length > 0) {
          comandosComAviso.forEach(erro => {
            const comando = erro.comando || erro.sql || 'Comando desconhecido';
            // Extrair nome da stored procedure se possível
            const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                    comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                    comando.match(/\[?(\w+)\]?/i);
            const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
            // Log como aviso, não como erro
            console.warn(`[Init SQL] Aviso: Dados truncados na procedure ${procedureName} (isso pode ser normal em sincronizações)`);
          });
        }
        
        if (comandosComErro.length > 0) {
          // Separar erros de truncamento dos demais erros
          const errosTruncamento = [];
          const outrosErros = [];
          
          comandosComErro.forEach(erro => {
            // Capturar mensagem de todas as formas possíveis
            const mensagemRaw = erro.mensagem || erro.erro || erro.message || erro.error || '';
            const mensagem = String(mensagemRaw).toLowerCase();
            
            // Verificar se é erro de truncamento (verificar tanto a mensagem quanto o texto original)
            const isTruncamento = mensagem.includes('truncated') || 
                                  mensagem.includes('truncados') || 
                                  mensagem.includes('would be truncated') ||
                                  mensagem.includes('dados seriam truncados') ||
                                  mensagem.includes('string or binary data would be truncated') ||
                                  String(mensagemRaw).includes('truncated') ||
                                  String(mensagemRaw).includes('truncados');
            
            if (isTruncamento) {
              errosTruncamento.push(erro);
            } else {
              // Verificar se é outro erro esperado
              const errosEsperados = [
                'already exists',
                'já existe',
                'duplicate',
                'duplicado',
                'there is already',
                'já há'
              ];
              const isErroEsperado = errosEsperados.some(esperado => mensagem.includes(esperado));
              if (!isErroEsperado) {
                outrosErros.push(erro);
              }
            }
          });
          
          // Log de erros de truncamento como aviso (não como erro)
          if (errosTruncamento.length > 0) {
            errosTruncamento.forEach(erro => {
              const comando = erro.comando || erro.sql || 'Comando desconhecido';
              // Extrair nome da stored procedure se possível
              const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                      comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                      comando.match(/\[?(\w+)\]?/i);
              const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
              // Log como aviso, não como erro
              console.warn(`[Init SQL] Aviso: Dados truncados na procedure ${procedureName} (isso pode ser normal em sincronizações)`);
            });
          }
          
          // Log apenas erros reais críticos
          if (outrosErros.length > 0) {
            outrosErros.forEach(erro => {
              try {
                // Capturar mensagem de forma segura
                let mensagem = 'Erro desconhecido';
                if (erro) {
                  if (typeof erro === 'string') {
                    mensagem = erro;
                  } else if (erro.error) {
                    mensagem = String(erro.error);
                  } else if (erro.mensagem) {
                    mensagem = String(erro.mensagem);
                  } else if (erro.erro) {
                    mensagem = String(erro.erro);
                  } else if (erro.message) {
                    mensagem = String(erro.message);
                  } else if (typeof erro === 'object') {
                    mensagem = JSON.stringify(erro);
                  }
                }
                
                const comando = (erro && (erro.comando || erro.sql)) ? String(erro.comando || erro.sql) : 'Comando desconhecido';
                // Extrair nome da stored procedure se possível
                const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                        comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                        comando.match(/\[?(\w+)\]?/i);
                const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
                
                // Incluir detalhes adicionais se disponíveis
                let detalhesAdicionais = '';
                if (erro && erro.detalhes) {
                  const detalhes = erro.detalhes;
                  if (detalhes.numero) {
                    detalhesAdicionais = ` (Erro SQL ${detalhes.numero})`;
                  }
                }
                
                // Verificar se mensagem está definida antes de usar
                const mensagemFinal = mensagem && mensagem !== 'Erro desconhecido' ? (mensagem + detalhesAdicionais) : ('Erro desconhecido' + detalhesAdicionais);
                
                // Verificar se é erro relacionado ao banco INTEGRA_PRD offline ou erro interno do backend
                const mensagemLower = mensagemFinal.toLowerCase();
                const isErroIntegraOffline = mensagemLower.includes('cannot be opened') || 
                                             mensagemLower.includes('is offline') || 
                                             mensagemLower.includes('está offline') ||
                                             mensagemLower.includes('database') && mensagemLower.includes('offline') ||
                                             mensagemLower.includes('banco') && mensagemLower.includes('offline');
                const isErroInternoBackend = mensagemFinal.includes('result is not defined') || 
                                            mensagemFinal.includes('Cannot read property') ||
                                            mensagemFinal.includes('undefined');
                
                if (isErroIntegraOffline || isErroInternoBackend) {
                  // Se for erro relacionado ao INTEGRA_PRD offline ou erro interno do backend
                  if (isErroIntegraOffline) {
                    console.warn(`[Init SQL] Aviso: Procedure ${procedureName} não pode ser executada porque o banco INTEGRA_PRD está offline. Execute o script verificar_ativar_integra_prd.sql para ativar o banco.`);
                  } else {
                    console.warn(`[Init SQL] Aviso: Procedure ${procedureName} retornou erro interno (pode ser normal se o banco INTEGRA_PRD estiver offline)`);
                  }
                } else {
                  // Erro real que precisa ser logado
                  // Erros esperados (não críticos) - apenas logar, não quebrar o módulo
                  const errosEsperados = [
                    'Arithmetic overflow',
                    'Violation of PRIMARY KEY',
                    'Duplicate key',
                    'UNIQUE KEY constraint'
                  ];
                  
                  const isErroEsperado = errosEsperados.some(erro => mensagemFinal.includes(erro));
                  
                  if (isErroEsperado) {
                    // Erros esperados são apenas warnings, não erros críticos
                    console.warn(`⚠️ [init.sql] Erro esperado na procedure ${procedureName}:`, mensagemFinal);
                  } else {
                    // Apenas logar como erro se não for esperado
                    console.error(`Erro no init.sql [Procedure: ${procedureName}]:`, mensagemFinal);
                  }
                }
              } catch (err) {
                // Se houver erro ao processar o erro, logar de forma simples
                console.error('Erro ao processar erro do init.sql:', err);
              }
            });
          }
        }
      }
      
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQL) {
        clearInterval(window.intervaloInitSQL);
        delete window.intervaloInitSQL;
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      // Isso é importante para operações que podem ter efeitos colaterais assíncronos
      // Aumentado para 500ms para garantir que operações complexas sejam concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQL) {
        clearInterval(window.intervaloInitSQL);
        delete window.intervaloInitSQL;
      }
      
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
  }

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  // IMPORTANTE: Garantir que execute apenas uma vez, mesmo se o módulo for carregado múltiplas vezes
  if (!initExecutado) {
    if (document.readyState === 'loading') {
      // Se o DOM ainda está carregando, aguardar o evento
      document.addEventListener('DOMContentLoaded', () => {
        if (!initExecutado) {
          init();
        }
      }, { once: true }); // once: true garante que o listener seja removido após executar
    } else {
      // DOM já está pronto, executar imediatamente
      init();
    }
  }

  // Função para mudar abas
  async function showTab(tabId) {
    try {
      // PROTEÇÃO: Se estiver bloqueando mudanças de aba (durante operações como aplicar filtros),
      // não permitir mudar para "filtros" automaticamente
      if (bloqueandoMudancaAba && tabId === 'filtros') {
        return; // Não mudar a aba durante operações
      }
      
      // PROTEÇÃO: Se estiver tentando mudar para "filtros" mas há uma viagem sendo editada,
      // não permitir a mudança (a menos que seja explicitamente solicitado)
      if (tabId === 'filtros') {
        const viagemIdEmEdicao = document.getElementById('viagemId')?.value;
        const filtroIdViagem = document.getElementById('filtroIdViagem')?.value;
        const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
        
        // Se há uma viagem sendo editada E o campo filtroIdViagem está vazio,
        // E a aba atual é "dados", não permitir mudar para filtros
        if (viagemIdEmEdicao && viagemIdEmEdicao.trim() !== '' && 
            (!filtroIdViagem || filtroIdViagem.trim() === '') &&
            abaAtiva === 'dados') {
          return; // Não mudar a aba
        }
      }
      
      // Primeiro, mudar a aba imediatamente (escopo no container do módulo)
      const tabContent = document.getElementById(`tab-${tabId}`);
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      if (tabContent && tabBtn) {
        // Usar sempre .viagens-container para garantir que TODOS os tab-content são ocultados
        // (evita que aba Integração Switch apareça nas outras quando o container vinha diferente)
        const container = document.querySelector('.viagens-container') || tabContent.closest('[class*="-container"]') || tabContent.parentElement;
        if (container) {
          container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
          container.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            content.style.setProperty('display', 'none', 'important');
          });
        }
        tabBtn.classList.add('active');
        tabContent.classList.add('active');
        tabContent.style.setProperty('display', 'block', 'important');
        // Garantir que Integração Switch e Macros fiquem ocultas quando não forem a aba ativa
        const tabSwitch = document.getElementById('tab-integracao-switch');
        if (tabSwitch && tabId !== 'integracao-switch') tabSwitch.style.setProperty('display', 'none', 'important');
        const tabMacros = document.getElementById('tab-macros');
        if (tabMacros && tabId !== 'macros') tabMacros.style.setProperty('display', 'none', 'important');
      }
      
      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Se for a aba de grid, inicializar o GridEditor
      if (tabId === 'grid') {
        try {
          if (!gridTab) {
            // GridEditor já está carregado no HTML, não precisa carregar novamente
            if (typeof window.GridEditor !== 'undefined') {
              inicializarGridTab();
            } else {
              console.warn('GridEditor não está disponível. Recarregue a página.');
            }
          }
          // Sempre renderizar, mesmo se não houver dados (grid vazio)
          const viagensParaRenderizar = lastViagens || [];
          if (gridTab) {
            gridTab.render(viagensParaRenderizar);
          } else if (viagensParaRenderizar.length === 0) {
            // Se não há dados e grid não está inicializado, aplicar filtros para buscar
            // Mas não bloquear a mudança de aba
            setTimeout(() => {
              applyFilters('grid').catch(() => {
                // Erro silencioso ao aplicar filtros automaticamente
              });
            }, 100);
          }
        } catch (gridErr) {
          // Erro silencioso ao processar grid - não bloquear mudança de aba
        }
      }

      // Se for a aba Compatíveis, inicializar event listeners e carregar viagem em edição se houver
      if (tabId === 'compatíveis') {
        setTimeout(async () => {
          tentarInicializarListeners();
          
          // Verificar se há uma viagem em edição
          const viagemIdEmEdicao = document.getElementById('viagemId')?.value;
          if (viagemIdEmEdicao) {
            await carregarEselecionarViagem(viagemIdEmEdicao);
          }
        }, 100);
      }

      // Se for a aba Convocações, inicializar (respeitar viagem da aba Dados primeiro)
      if (tabId === 'convocações') {
        setTimeout(async () => {
          inicializarAbaConvocacoes();
          const viagemIdEmEdicao = document.getElementById('viagemId')?.value?.trim();
          const idParaConvocacoes = viagemIdEmEdicao || viagemSelecionada || document.getElementById('filtroConvocacaoViagem')?.value?.trim();
          if (idParaConvocacoes) {
            await carregarEselecionarViagemConvocacoes(idParaConvocacoes);
          }
        }, 100);
      }

      // Se for a aba Rastreamento, inicializar
      if (tabId === 'rastreamento') {
        setTimeout(() => {
          inicializarAbaRastreamento();
          
          // Se houver viagem selecionada, carregar posições
          const idViagem = document.getElementById('filtroIdViagem')?.value || 
                          document.getElementById('viagemId')?.value || 
                          null;
          if (idViagem) {
            // Ativar acompanhamento WebSocket para esta viagem
            if (typeof window.WebSocketTorre !== 'undefined') {
              window.WebSocketTorre.acompanharViagem(idViagem);
            }
            carregarPosicoesRastreamento(idViagem);
          }
        }, 100);
      }

      // Abas Alertas, Chat, SOS e Ranking foram removidas - movidas para módulos separados

      // Se for a aba Switch Digital, verificar se há viagem selecionada antes de carregar logs
      if (tabId === 'integracao-switch') {
        setTimeout(() => {
          if (typeof window.verificarSaudeSwitchBadge === 'function') {
            window.verificarSaudeSwitchBadge();
          }
          // Verificar se há viagem selecionada
          const idViagem = document.getElementById('filtroIdViagem')?.value || 
                          document.getElementById('viagemId')?.value || 
                          null;
          
          if (!idViagem || idViagem.trim() === '') {
            // Não há viagem selecionada - mostrar mensagem
            const container = document.getElementById('logsIntegracaoSwitch');
            if (container) {
              container.innerHTML = `
                <div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                  <div style="font-size: 48px; margin-bottom: 15px;"><i class="bx bx-error-circle" style="color: #856404;"></i></div>
                  <h3 style="color: #856404; margin-bottom: 10px;">Nenhuma viagem selecionada</h3>
                  <p style="color: #856404; margin: 0;">
                    Selecione uma viagem na aba <strong>Dados</strong> ou <strong>Grid</strong> para visualizar os logs de envio.
                  </p>
                </div>
              `;
            }
            // Limpar contadores
            const totalEnviosEl = document.getElementById('totalEnviosSwitch');
            const totalSucessosEl = document.getElementById('totalSucessosSwitch');
            const totalErrosEl = document.getElementById('totalErrosSwitch');
            const ultimaAtualizacaoEl = document.getElementById('ultimaAtualizacaoSwitch');
            if (totalEnviosEl) totalEnviosEl.textContent = '0';
            if (totalSucessosEl) totalSucessosEl.textContent = '0';
            if (totalErrosEl) totalErrosEl.textContent = '0';
            if (ultimaAtualizacaoEl) ultimaAtualizacaoEl.textContent = '-';
            return;
          }
          
          // Há viagem selecionada - carregar logs
          const tabContent = document.getElementById('tab-integracao-switch');
          if (tabContent && tabContent.classList.contains('active')) {
            if (typeof window.carregarLogsSwitch === 'function') {
              window.carregarLogsSwitch();
            }
          } else {
            setTimeout(() => {
              if (typeof window.carregarLogsSwitch === 'function') {
                window.carregarLogsSwitch();
              }
            }, 300);
          }
        }, 200);
      }

      // Se for a aba Histórico, inicializar
      if (tabId === 'historico') {
        setTimeout(async () => {
          inicializarAbaHistorico();
          
          // Se houver um roteiro selecionado, carregar automaticamente
          const selectRoteiro = document.getElementById('viagemRoteiro');
          const modoHist = document.querySelector('input[name="historicoModo"]:checked')?.value;
          if (modoHist !== 'regional' && selectRoteiro && selectRoteiro.value && selectRoteiro.value !== '') {
            await carregarHistoricoRoteiro();
          }
        }, 100);
      }

      // Se for a aba Macros, inicializar e forçar dark mode na barra/tabela
      if (tabId === 'macros') {
        setTimeout(() => {
          if (typeof aplicarDarkModeMacros === 'function') aplicarDarkModeMacros();
          carregarMacrosViagem();
        }, 100);
      }
    } catch (err) {
      // Erro silencioso ao mudar aba - forçar mudança mesmo em caso de erro
      try {
        const tabContent = document.getElementById(`tab-${tabId}`);
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (tabContent && tabBtn) {
          const container = document.querySelector('.viagens-container') || tabContent.closest('[class*="-container"]') || tabContent.parentElement;
          if (container) {
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            container.querySelectorAll('.tab-content').forEach(content => {
              content.classList.remove('active');
              content.style.setProperty('display', 'none', 'important');
            });
          }
          tabBtn.classList.add('active');
          tabContent.classList.add('active');
          tabContent.style.setProperty('display', 'block', 'important');
          const tabSwitch = document.getElementById('tab-integracao-switch');
          if (tabSwitch && tabId !== 'integracao-switch') tabSwitch.style.setProperty('display', 'none', 'important');
          const tabMacros = document.getElementById('tab-macros');
          if (tabMacros && tabId !== 'macros') tabMacros.style.setProperty('display', 'none', 'important');
        }
      } catch (forceErr) {
        console.error('[Viagens] Erro ao forçar mudança de aba:', forceErr);
      }
    }
    
    // Se for a aba de filtros, garantir que os combos estão carregados
    if (tabId === 'filtros') {
      // Aguardar para garantir que a aba está visível (display: block)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Usar requestAnimationFrame para garantir que o navegador renderizou a aba
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      const filtroTipo = document.getElementById('filtroTipoViagem');
      const filtroClasse = document.getElementById('filtroClasseFrota');
      const filtroContratador = document.getElementById('filtroContratador');
      const filtroOrigem = document.getElementById('filtroOrigemEstado');
      const filtroDestino = document.getElementById('filtroDestinoEstado');
      
      // Verificar se os campos estão vazios (apenas com a opção padrão)
      const precisaRecarregar = 
        (!filtroTipo || filtroTipo.options.length <= 1) ||
        (!filtroClasse || filtroClasse.options.length <= 1) ||
        (!filtroContratador || filtroContratador.options.length <= 1) ||
        (!filtroOrigem || filtroOrigem.options.length <= 1) ||
        (!filtroDestino || filtroDestino.options.length <= 1);
      
      if (precisaRecarregar) {
        await loadCombos();
        await loadEstados();
        
        // Aguardar múltiplos frames para garantir renderização completa
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar novamente se os campos ainda estão preenchidos
        const filtroTipoCheck = document.getElementById('filtroTipoViagem');
        const filtroClasseCheck = document.getElementById('filtroClasseFrota');
        const filtroContratadorCheck = document.getElementById('filtroContratador');
        const filtroOrigemCheck = document.getElementById('filtroOrigemEstado');
        const filtroDestinoCheck = document.getElementById('filtroDestinoEstado');
        
        const aindaPrecisaRecarregar = 
          (!filtroTipoCheck || filtroTipoCheck.options.length <= 1) ||
          (!filtroClasseCheck || filtroClasseCheck.options.length <= 1) ||
          (!filtroContratadorCheck || filtroContratadorCheck.options.length <= 1) ||
          (!filtroOrigemCheck || filtroOrigemCheck.options.length <= 1) ||
          (!filtroDestinoCheck || filtroDestinoCheck.options.length <= 1);
        
        if (aindaPrecisaRecarregar) {
          await loadCombos();
          await loadEstados();
          await loadRoteirosParaFiltro();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Forçar reflow múltiplas vezes para garantir renderização
        const elementos = [filtroTipo, filtroClasse, filtroContratador, filtroOrigem, filtroDestino].filter(Boolean);
        elementos.forEach(el => {
          void el.offsetHeight;
          void el.offsetWidth;
        });
        
        // Disparar evento de mudança para forçar atualização do select
        elementos.forEach(el => {
          if (el.tagName === 'SELECT') {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        
        // Verificação final após mais um delay
        // IMPORTANTE: Verificar se a aba ainda é 'filtros' antes de executar
        setTimeout(() => {
          // Verificar se ainda estamos na aba de filtros antes de executar
          const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
          if (abaAtiva !== 'filtros' || bloqueandoMudancaAba) {
            return; // Não executar se a aba mudou ou se está bloqueando mudanças
          }
          
          const elementosFinais = [
            document.getElementById('filtroTipoViagem'),
            document.getElementById('filtroClasseFrota'),
            document.getElementById('filtroContratador'),
            document.getElementById('filtroOrigemEstado'),
            document.getElementById('filtroDestinoEstado')
          ].filter(Boolean);
          
          elementosFinais.forEach(el => {
            if (el.options.length <= 1) {
              // Recarregar apenas este campo específico seria complexo, então vamos recarregar tudo
              loadCombos().then(() => loadEstados());
            }
          });
        }, 500);
      }
    }
  }

  // Carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        // Usar corrigirUrl se disponível para garantir o caminho base correto
        const srcCorrigido = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl(src) : src;
        script.src = `${srcCorrigido}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
          setTimeout(() => {
            if (typeof window.GridEditor !== 'undefined') {
              resolve();
            } else {
              reject(new Error('GridEditor não foi carregado'));
            }
          }, 100);
        };
        script.onerror = () => reject(new Error(`Erro ao carregar script: ${src}`));
        document.head.appendChild(script);
      };
      
      // Verificar se o script já está sendo carregado ou já existe
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        // Se o script existe, aguardar ele carregar
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof window.GridEditor !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            // Se não carregou após 2 segundos, remover e recarregar
            existingScript.remove();
            // Continuar com o carregamento abaixo
            carregarNovoScript();
          }
        }, 100);
        return;
      }
      
      carregarNovoScript();
    });
  }

  // Inicializar GridEditor
  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Viagens] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#viagensGrid',
      columns: [
        { field: 'IDVIAGEM', header: 'ID', editable: false, isId: true, width: '70px' },
        { field: 'FGSITVIAGEM_NOME', header: 'Situação', editable: true, type: 'select', width: '110px',
          options: [
            { value: 'Aprovada', label: 'Aprovada' },
            { value: 'Cancelada', label: 'Cancelada' },
            { value: 'Preparação', label: 'Preparação' },
            { value: 'Final de rota', label: 'Final de rota' },
            { value: 'Viagem finalizada', label: 'Viagem finalizada' },
            { value: 'Emissão documentos', label: 'Emissão documentos' },
            { value: 'Programada', label: 'Programada' },
            { value: 'Em trânsito', label: 'Em trânsito' }
          ]
        },
        { field: 'DSTIPOVIAGEM', header: 'Tipo', editable: false, width: '100px' },
        { field: 'DSROTEIRO', header: 'Roteiro', editable: false, width: '160px' },
        { field: 'CONTRATADOR_NOME', header: 'Contratador', editable: false, width: '130px' },
        { field: 'DSCLASSEFROTA', header: 'Classe Frota', editable: false, width: '100px' },
        { 
          field: 'DTPREVINICIO', 
          header: 'Data Início', 
          editable: true, 
          type: 'datetime-local', 
          width: '130px',
          format: (val) => {
            if (!val) return '';
            return fmtDataHora(val);
          }
        },
        { 
          field: 'DTPREVFINAL', 
          header: 'Data Fim', 
          editable: true, 
          type: 'datetime-local', 
          width: '130px',
          format: (val) => {
            if (!val) return '';
            return fmtDataHora(val);
          }
        },
        { 
          field: 'QTD_COMPROVANTES', 
          header: 'POD', 
          editable: false, 
          width: '56px',
          title: 'Comprovante(s) de entrega (POD)',
          format: (val) => {
            const qtd = Number(val) || 0;
            return qtd > 0 
              ? `<span style="color: #0d6efd; font-weight: 600;" title="Comprovante(s) de entrega">${qtd}</span>` 
              : '<span style="color: #999;">0</span>';
          }
        }
      ],
      apiEndpoint: buildApiUrl('/api/viagens'),
      buildFetchHeaders: () => getAuthHeaders(),
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição
      onBeforeEdit: async (id) => {
        await loadViagemParaEdicao(id);
        return false; // cancelar o modo de edição inline
      },
      // Garantir que a exclusão use o mesmo fluxo/modal da lista
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onAfterEdit: (id) => {
        showMessage('Alteração salva com sucesso!', 'success');
        // atualizar cache local mantendo sincronia
        if (lastViagens) {
          const idx = lastViagens.findIndex(r => String(r.IDVIAGEM) === String(id));
          if (idx !== -1) lastViagens[idx] = { ...lastViagens[idx], ...{} };
        }
      }
    });
    // Clique na coluna POD para abrir modal de comprovantes
    const gridEl = document.getElementById('viagensGrid');
    if (gridEl) {
      gridEl.addEventListener('click', (e) => {
        const cell = e.target.closest('td[data-field="QTD_COMPROVANTES"]');
        if (!cell) return;
        const row = cell.closest('tr[data-grid-id]');
        if (!row) return;
        const idviagem = row.getAttribute('data-grid-id');
        const cellVal = (cell.querySelector('.cell-value') || cell).textContent.trim();
        if (cellVal === '0' || !cellVal) return;
        abrirModalComprovantes(idviagem);
      });
    }
  }

  // Carregar combos principais
  async function loadCombos() {
    try {
      // Buscar elementos sem ativar a aba de filtros
      // Os elementos existem no DOM mesmo que não estejam visíveis
      let filtroTipoEl = document.getElementById('filtroTipoViagem');
      let filtroClasseEl = document.getElementById('filtroClasseFrota');
      let filtroContratadorEl = document.getElementById('filtroContratador');
      
      // Se não encontrou, tentar buscar dentro do container de filtros OU dados
      if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
        const filtroContainer = document.getElementById('tab-filtros');
        const dadosContainer = document.getElementById('tab-dados');
        
        if (filtroContainer) {
          if (!filtroTipoEl) filtroTipoEl = filtroContainer.querySelector('#filtroTipoViagem');
          if (!filtroClasseEl) filtroClasseEl = filtroContainer.querySelector('#filtroClasseFrota');
          if (!filtroContratadorEl) filtroContratadorEl = filtroContainer.querySelector('#filtroContratador');
        }
        
        // Também tentar buscar na aba de dados (para formulário de edição)
        if (dadosContainer) {
          if (!filtroTipoEl) filtroTipoEl = dadosContainer.querySelector('#filtroTipoViagem');
          if (!filtroClasseEl) filtroClasseEl = dadosContainer.querySelector('#filtroClasseFrota');
          if (!filtroContratadorEl) filtroContratadorEl = dadosContainer.querySelector('#filtroContratador');
        }
      }
      
      if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Tentar novamente
        filtroTipoEl = document.getElementById('filtroTipoViagem');
        filtroClasseEl = document.getElementById('filtroClasseFrota');
        filtroContratadorEl = document.getElementById('filtroContratador');
        
        if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
          return;
        }
      }
      
      // Buscar dados
      const tiposResponse = await fetch('/api/tipos-viagem-combo', { headers: getAuthHeaders() });
      const situacoesResponse = await fetch('/api/situacoes-viagem-combo', { headers: getAuthHeaders() });
      const classesResponse = await fetch('/api/classes-frota-combo', { headers: getAuthHeaders() });
      let contratadoresResponse = await fetch('/api/contratadores-combo');
      let contratadores = contratadoresResponse.ok ? await contratadoresResponse.json() : [];
      if (!Array.isArray(contratadores) || contratadores.length === 0) {
        // Fallback: buscar programadores/contratadores via Cadastro Geral (tipo P = Programador)
        try {
          const cadastrosRes = await fetch('/api/cadastros-gerais?tipoCadastro=P');
          if (cadastrosRes.ok) {
            const lista = await cadastrosRes.json();
            contratadores = Array.isArray(lista) ? lista.map(c => ({ CDCADASTRO: c.CDCADASTRO, RZSOCIAL: (c.RZSOCIAL || '').toString() })) : [];
          }
        } catch (e) {
          console.warn('[Viagens] Fallback contratadores via cadastros-gerais falhou:', e);
        }
      }
      
      if (!tiposResponse.ok || !situacoesResponse.ok || !classesResponse.ok) {
        throw new Error('Erro ao buscar dados da API');
      }
      
      const tipos = await tiposResponse.json();
      const situacoes = await situacoesResponse.json();
      const classes = await classesResponse.json();

      const fillSelect = (id, items, valueField, labelField, defaultText = 'Selecione') => {
        let el = document.getElementById(id);
        
        // Se não encontrou, tentar buscar dentro do container
        if (!el) {
          const container = document.getElementById('tab-filtros') || document.getElementById('tab-dados');
          if (container) {
            el = container.querySelector(`#${id}`);
          }
        }
        
        if (!el) {
          return false;
        }
        
        // Limpar e preencher
        el.innerHTML = `<option value="">${defaultText}</option>`;
        
        if (items && Array.isArray(items) && items.length > 0) {
          items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = String(item[valueField] || '');
            opt.textContent = String(item[labelField] || '');
            el.appendChild(opt);
          });
          
          // Forçar reflow imediatamente após preencher
          void el.offsetHeight;
          
          // Verificar se as opções foram realmente adicionadas
          const optionsCount = el.options.length;
          if (optionsCount <= 1) {
            // Tentar novamente após um pequeno delay
            setTimeout(() => {
              if (el.options.length <= 1) {
                el.innerHTML = `<option value="">${defaultText}</option>`;
                items.forEach(item => {
                  const opt = document.createElement('option');
                  opt.value = String(item[valueField] || '');
                  opt.textContent = String(item[labelField] || '');
                  el.appendChild(opt);
                });
                void el.offsetHeight;
              }
            }, 100);
          }
          
          return true;
        } else {
          return false;
        }
      };

      // Preencher campos de filtro (usam "Todos" ou "Todas")
      fillSelect('filtroTipoViagem', tipos, 'CDTIPOVIAGEM', 'DSTIPOVIAGEM', 'Todos');
      fillSelect('filtroClasseFrota', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA', 'Todas');
      fillSelect('filtroContratador', contratadores, 'CDCADASTRO', 'RZSOCIAL', 'Todos');
      
      // Verificar se os campos foram realmente preenchidos (reutilizar variáveis já declaradas)
      filtroTipoEl = document.getElementById('filtroTipoViagem');
      filtroClasseEl = document.getElementById('filtroClasseFrota');
      filtroContratadorEl = document.getElementById('filtroContratador');
      
      // Preencher campos do formulário de dados (usam "Selecione")
      fillSelect('viagemTipoViagem', tipos, 'CDTIPOVIAGEM', 'DSTIPOVIAGEM', 'Selecione');
      fillSelect('viagemSituacao', situacoes, 'CDSITUACAOVIAGEM', 'DSSITUACAOVIAGEM', 'Selecione');
      fillSelect('viagemClasseFrota', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA', 'Selecione');
      fillSelect('viagemContratador', contratadores, 'CDCADASTRO', 'RZSOCIAL', 'Selecione');
      
      // Forçar reflow para garantir renderização
      if (filtroTipoEl) void filtroTipoEl.offsetHeight;
      if (filtroClasseEl) void filtroClasseEl.offsetHeight;
      if (filtroContratadorEl) void filtroContratadorEl.offsetHeight;
    } catch (err) {
      showMessage('Erro ao carregar opções. Verifique a conexão.', 'error');
    }
  }

  // Carregar países nos selects Origem/Destino (aba dados)
  async function loadPaisesViagens() {
    const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/paises') : '/api/paises');
    const r = await fetch(url);
    const paises = await r.json();
    if (!Array.isArray(paises)) return;
    const opts = paises.map(p => ({ value: (p.SGPAIS != null && p.SGPAIS !== '') ? String(p.SGPAIS).trim() : String(p.CDPAIS || ''), label: p.DSPAIS || p.SGPAIS || '' }));
    function fill(selectId) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '<option value="">Selecione</option>';
      opts.forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; sel.appendChild(opt); });
      if (opts.some(o => o.value === 'BR')) sel.value = 'BR';
    }
    fill('viagemOrigemPais');
    fill('viagemDestinoPais');
  }

  // Carregar estados por país em um select (formato API: ESTADO = UF, NMESTADO = nome; ou estados-brasil: uf, nome)
  async function loadEstadosPorPais(paisVal, estadoSelectId, defaultText) {
    const el = document.getElementById(estadoSelectId);
    if (!el) return;
    el.innerHTML = `<option value="">${defaultText || 'Selecione'}</option>`;
    if (!paisVal || String(paisVal).trim() === '') return;
    try {
      if (String(paisVal).toUpperCase() === 'BR') {
        const response = await fetch('/api/estados-brasil');
        if (!response.ok) return;
        const estados = await response.json();
        if (Array.isArray(estados)) estados.forEach(e => {
          const opt = document.createElement('option');
          opt.value = String(e.uf || '');
          opt.textContent = `${e.uf || ''} - ${e.nome || ''}`;
          el.appendChild(opt);
        });
      } else {
        const base = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados');
        const response = await fetch(base + '?pais=' + encodeURIComponent(paisVal));
        if (!response.ok) return;
        const estados = await response.json();
        if (Array.isArray(estados)) estados.forEach(e => {
          const opt = document.createElement('option');
          opt.value = String(e.ESTADO || e.estado || '');
          opt.textContent = `${e.ESTADO || e.estado || ''} - ${e.NMESTADO || e.nmestado || ''}`;
          el.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('[Viagens] Erro ao carregar estados por país:', err);
    }
  }

  // Carregar estados do Brasil (filtros) e por país (aba dados - Origem/Destino)
  async function loadEstados() {
    try {
      let filtroOrigemEl = document.getElementById('filtroOrigemEstado');
      let filtroDestinoEl = document.getElementById('filtroDestinoEstado');
      if (!filtroOrigemEl || !filtroDestinoEl) {
        const filtroContainer = document.getElementById('tab-filtros');
        if (filtroContainer) {
          filtroOrigemEl = filtroContainer.querySelector('#filtroOrigemEstado');
          filtroDestinoEl = filtroContainer.querySelector('#filtroDestinoEstado');
        }
      }
      if (!filtroOrigemEl || !filtroDestinoEl) {
        await new Promise(resolve => setTimeout(resolve, 500));
        filtroOrigemEl = document.getElementById('filtroOrigemEstado');
        filtroDestinoEl = document.getElementById('filtroDestinoEstado');
        if (!filtroOrigemEl || !filtroDestinoEl) return;
      }

      await loadPaisesViagens();

      const response = await fetch('/api/estados-brasil');
      if (!response.ok) throw new Error('Erro ao buscar estados da API');
      const estados = await response.json();
      const fillEstados = (id, defaultText) => {
        let el = document.getElementById(id);
        if (!el) {
          const container = document.getElementById('tab-filtros') || document.getElementById('tab-dados');
          if (container) el = container.querySelector(`#${id}`);
        }
        if (!el) return false;
        el.innerHTML = `<option value="">${defaultText}</option>`;
        if (estados && Array.isArray(estados) && estados.length > 0) {
          estados.forEach(e => {
            const opt = document.createElement('option');
            opt.value = String(e.uf || '');
            opt.textContent = `${e.uf} - ${e.nome}`;
            el.appendChild(opt);
          });
          return true;
        }
        return false;
      };

      fillEstados('filtroOrigemEstado', 'Todos');
      fillEstados('filtroDestinoEstado', 'Todos');

      const origemPais = document.getElementById('viagemOrigemPais')?.value || 'BR';
      const destinoPais = document.getElementById('viagemDestinoPais')?.value || 'BR';
      await loadEstadosPorPais(origemPais, 'viagemOrigemEstado', 'Selecione');
      await loadEstadosPorPais(destinoPais, 'viagemDestinoEstado', 'Selecione');

      if (filtroOrigemEl) void filtroOrigemEl.offsetHeight;
      if (filtroDestinoEl) void filtroDestinoEl.offsetHeight;
      estadosCarregados = true;
      // Combo Roteiro: preencher conforme país/estado/cidade atuais (ex.: BR/BR já selecionados = só roteiros domésticos)
      await atualizarComboRoteiro();
    } catch (err) {
      showMessage('Erro ao carregar estados. Verifique a conexão.', 'error');
    }
  }

  // Atualizar combo Roteiro: filtro progressivo (país → estado → cidade); quanto mais preenchido, mais exato
  function atualizarComboRoteiro() {
    const origemPais = document.getElementById('viagemOrigemPais')?.value?.trim() || '';
    const origemEstado = document.getElementById('viagemOrigemEstado')?.value?.trim() || '';
    const origemCidade = document.getElementById('viagemOrigemCidade')?.value?.trim() || document.getElementById('viagemOrigemCodigo')?.value?.trim() || '';
    const destinoPais = document.getElementById('viagemDestinoPais')?.value?.trim() || '';
    const destinoEstado = document.getElementById('viagemDestinoEstado')?.value?.trim() || '';
    const destinoCidade = document.getElementById('viagemDestinoCidade')?.value?.trim() || document.getElementById('viagemDestinoCodigo')?.value?.trim() || '';
    return loadRoteirosPorRota({ origemPais, origemEstado, origemCidade, destinoPais, destinoEstado, destinoCidade });
  }

  // Carregar cidades por estado
  async function loadCidadesPorEstado(estado, tipo) {
    if (!estado) return;

    try {
      _log(`[CIDADES] Carregando cidades do estado ${estado} para ${tipo}`);
      const response = await fetch(`/api/cidades-por-estado/${estado}`);
      const cidades = await response.json();

      _log(`[CIDADES] ${cidades.length} cidades carregadas para ${tipo} do estado ${estado}`);

      if (tipo === 'origem') {
        cidadesOrigem = cidades;
        const cidadeSelect = document.getElementById('viagemOrigemCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
          _log(`[CIDADES] Select de origem atualizado com ${cidades.length} opções`);
        }
      } else {
        cidadesDestino = cidades;
        const cidadeSelect = document.getElementById('viagemDestinoCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
          _log(`[CIDADES] Select de destino atualizado com ${cidades.length} opções`);
        }
      }
    } catch (err) {
      console.error(`[CIDADES] Erro ao carregar cidades do estado ${estado} para ${tipo}:`, err);
      showMessage('Erro ao carregar cidades. Verifique a conexão.', 'error');
    }
  }

  // Carregar roteiros com filtro progressivo: país → estado → cidade (o que estiver preenchido)
  async function loadRoteirosPorRota(origemDestinoOrObj, destinoOrRoteiroId, roteiroIdEsperado = null) {
    try {
      let origemPais = '', origemEstado = '', origemCidade = '', destinoPais = '', destinoEstado = '', destinoCidade = '';
      if (origemDestinoOrObj && typeof origemDestinoOrObj === 'object' && !Array.isArray(origemDestinoOrObj)) {
        origemPais = String(origemDestinoOrObj.origemPais || '').trim();
        origemEstado = String(origemDestinoOrObj.origemEstado || '').trim();
        origemCidade = String(origemDestinoOrObj.origemCidade || '').trim();
        destinoPais = String(origemDestinoOrObj.destinoPais || '').trim();
        destinoEstado = String(origemDestinoOrObj.destinoEstado || '').trim();
        destinoCidade = String(origemDestinoOrObj.destinoCidade || '').trim();
      } else {
        origemCidade = (origemDestinoOrObj != null && String(origemDestinoOrObj).trim() !== '') ? String(origemDestinoOrObj).trim() : '';
        destinoCidade = (destinoOrRoteiroId != null && String(destinoOrRoteiroId).trim() !== '') ? String(destinoOrRoteiroId).trim() : '';
        if (typeof roteiroIdEsperado !== 'undefined' && roteiroIdEsperado != null) roteiroIdEsperado = roteiroIdEsperado;
      }
      const params = new URLSearchParams();
      if (origemCidade) params.append('origem', origemCidade);
      else { if (origemEstado) params.append('origemEstado', origemEstado); if (origemPais) params.append('origemPais', origemPais); }
      if (destinoCidade) params.append('destino', destinoCidade);
      else { if (destinoEstado) params.append('destinoEstado', destinoEstado); if (destinoPais) params.append('destinoPais', destinoPais); }
      const url = '/api/roteiros-combo' + (params.toString() ? '?' + params.toString() : '');

      _log('[ROTEIROS] Filtro progressivo:', { origemPais: origemPais || '-', origemEstado: origemEstado || '-', origemCidade: origemCidade || '-', destinoPais: destinoPais || '-', destinoEstado: destinoEstado || '-', destinoCidade: destinoCidade || '-', url });
      const response = await fetch(url, { headers: getAuthHeaders() });
      const roteiros = await response.json();
      _log('[ROTEIROS] Roteiros recebidos:', roteiros.length, 'roteiros');
      roteirosCache = roteiros;

      const roteiroSelect = document.getElementById('viagemRoteiro');
      roteiroSelect.innerHTML = '<option value="">Selecione</option>';
      
      // Verificar se o roteiro esperado está na lista
      let roteiroEncontrado = false;
      if (roteiroIdEsperado) {
        roteiroEncontrado = roteiros.some(r => String(r.IDROTEIRO) === String(roteiroIdEsperado));
        if (!roteiroEncontrado) {
          console.warn('[ROTEIROS] ⚠️ Roteiro esperado não encontrado na lista filtrada:', roteiroIdEsperado);
          // Buscar roteiro específico pela API
          try {
            const roteiroResponse = await fetch(`/api/roteiros/${roteiroIdEsperado}`, { headers: getAuthHeaders() });
            if (roteiroResponse.ok) {
              const roteiroEspecifico = await roteiroResponse.json();
              _log('[ROTEIROS] ✅ Roteiro específico encontrado:', roteiroEspecifico);
              roteiros.push(roteiroEspecifico);
              roteirosCache.push(roteiroEspecifico);
            }
          } catch (err) {
            console.error('[ROTEIROS] Erro ao buscar roteiro específico:', err);
          }
        }
      }
      
      roteiros.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.IDROTEIRO;
        opt.textContent = `${r.IDROTEIRO} - ${r.DSROTEIRO}`;
        opt.dataset.distancia = r.DISTANCIAKM;
        opt.dataset.origem = r.ORIGEM_CODIGO;
        opt.dataset.destino = r.DESTINO_CODIGO;
        roteiroSelect.appendChild(opt);
      });
      
      _log('[ROTEIROS] Select preenchido com', roteiros.length, 'opções');
    } catch (err) {
      console.error('Erro ao carregar roteiros:', err);
      showMessage('Erro ao carregar roteiros. Verifique a conexão.', 'error');
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    // Mostrar overlay de carregamento (padrão Gerenciar Cidades)
    showLoadingOverlayFiltros('Aplicando Filtros', 'Por favor, aguarde enquanto aplicamos os filtros...');
    // Dar tempo ao navegador pintar o overlay antes do fetch
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    
    // Obter referência do container uma única vez
    const gridContainer = document.getElementById('viagensGrid');
    
    // Mostrar skeleton loader no grid se existir
    if (gridContainer && typeof window.showSkeleton === 'function') {
      window.showSkeleton(gridContainer, 6, 'grid');
    }
    
    const btnAplicar = filtroForm?.querySelector('button[type="submit"]');
    if (btnAplicar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnAplicar, true);
    }

    // Timeout de segurança: esconder loading após 30 segundos mesmo se der erro
    const timeoutSeguranca = setTimeout(() => {
      console.warn('⚠️ Timeout de segurança: escondendo loading após 30 segundos');
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    }, 30000);

    try {
      // Marcar que estamos aplicando filtros para evitar mudanças automáticas de aba
      bloqueandoMudancaAba = true;
      
      const params = new URLSearchParams();
      const idViagemRaw = document.getElementById('filtroIdViagem')?.value;
      const idViagem = idViagemRaw != null ? String(idViagemRaw).trim() : '';
      /** Com ID explícito, não misturar situação/datas de período (AND no servidor zerava o resultado). */
      const filtroSomentePorId = idViagem !== '';
      const situacaoViagem = document.getElementById('filtroSituacaoViagem')?.value;
      const tipoViagem = document.getElementById('filtroTipoViagem')?.value;
      const origemEstado = document.getElementById('filtroOrigemEstado')?.value;
      const origemCidade = document.getElementById('filtroOrigemCidade')?.value;
      const destinoEstado = document.getElementById('filtroDestinoEstado')?.value;
      const destinoCidade = document.getElementById('filtroDestinoCidade')?.value;
      const roteiro = document.getElementById('filtroRoteiro')?.value;
      const classeFrota = document.getElementById('filtroClasseFrota')?.value;
      const contratador = document.getElementById('filtroContratador')?.value;
      const dataInicio = document.getElementById('filtroDataInicio')?.value;
      const dataFim = document.getElementById('filtroDataFim')?.value;
      const rastreado = document.getElementById('filtroRastreado')?.value;
      const motoristaConfirmado = document.getElementById('filtroMotoristaConfirmado')?.value;
      
      if (idViagem) params.append('idViagem', idViagem);
      if (!filtroSomentePorId && situacaoViagem) params.append('situacaoViagem', situacaoViagem);
      if (tipoViagem) params.append('tipoViagem', tipoViagem);
      if (origemEstado) params.append('origemEstado', origemEstado);
      if (origemCidade) params.append('origemCidade', origemCidade);
      if (destinoEstado) params.append('destinoEstado', destinoEstado);
      if (destinoCidade) params.append('destinoCidade', destinoCidade);
      if (roteiro) params.append('roteiro', roteiro);
      if (classeFrota) params.append('classeFrota', classeFrota);
      if (contratador) params.append('contratador', contratador);
      if (!filtroSomentePorId && dataInicio) params.append('dataInicio', dataInicio);
      if (!filtroSomentePorId && dataFim) params.append('dataFim', dataFim);
      if (rastreado) params.append('rastreado', rastreado);
      if (motoristaConfirmado) params.append('motoristaConfirmado', motoristaConfirmado);
      
      const response = await fetchApiViagens('?' + params.toString());
      const viagens = await response.json();
      
      // Armazenar dados em cache
      lastViagens = viagens;
      
      // Atualizar contador
      const countEl = document.getElementById('viagensGridCountText');
      if (countEl) {
        const count = viagens.length || 0;
        countEl.textContent = count + ' ' + (t('web.modulos.viagens.registrosEncontrados').replace(/^0\s*/, ''));
      }
      
      // Renderizar grid se já estiver inicializado
      try {
        if (gridTab) {
          gridTab.render(viagens);
        } else if (openTab === 'grid' && typeof window.GridEditor === 'undefined') {
          // GridEditor deveria estar carregado no HTML
          console.warn('GridEditor não está disponível. Recarregue a página.');
          if (gridTab) {
            gridTab.render(viagens);
          }
        }
      } catch (renderErr) {
        console.error('Erro ao renderizar grid:', renderErr);
        // Continuar mesmo se falhar renderizar
      }
      
      // Esconder skeleton loader após renderizar (usando a referência já obtida)
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
      
      // Mudar para a aba solicitada (com timeout de segurança)
      try {
        const tabPromise = showTab(openTab);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao mudar aba')), 10000)
        );
        await Promise.race([tabPromise, timeoutPromise]);
      } catch (tabErr) {
        console.error('Erro ao mudar aba:', tabErr);
        // Continuar mesmo se falhar mudar aba
      }
      
      // Esconder loading após renderizar (garantir sempre)
      clearTimeout(timeoutSeguranca);
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
      
      // Proteção adicional: garantir que a aba permaneça ativa por pelo menos 1 segundo
      setTimeout(() => {
        const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
        if (abaAtiva !== openTab) {
          const tabContent = document.getElementById(`tab-${openTab}`);
          const tabBtn = document.querySelector(`.tab-btn[data-tab="${openTab}"]`);
          if (tabContent && tabBtn) {
            const container = document.querySelector('.viagens-container') || tabContent.closest('[class*="-container"]') || tabContent.parentElement;
            if (container) {
              container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
              container.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.style.setProperty('display', 'none', 'important');
              });
            }
            tabBtn.classList.add('active');
            tabContent.classList.add('active');
            tabContent.style.setProperty('display', 'block', 'important');
            const tabSwitch = document.getElementById('tab-integracao-switch');
            if (tabSwitch && openTab !== 'integracao-switch') tabSwitch.style.setProperty('display', 'none', 'important');
            const tabMacros = document.getElementById('tab-macros');
            if (tabMacros && openTab !== 'macros') tabMacros.style.setProperty('display', 'none', 'important');
          }
        }
        bloqueandoMudancaAba = false;
      }, 1000);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      clearTimeout(timeoutSeguranca);
      showMessage('Erro ao carregar viagens: ' + (err.message || 'Erro desconhecido'), 'error');
      bloqueandoMudancaAba = false;
      
      // Esconder loading imediatamente em caso de erro
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    } finally {
      // Esconder overlay de filtros (garantir sempre, com múltiplas tentativas)
      clearTimeout(timeoutSeguranca);
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    }
  }

  // Renderizar lista
  function renderList(viagens) {
    if (!viagens || viagens.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma viagem encontrada.</p>';
      return;
    }

    list.innerHTML = viagens.map(v => {
      // Garantir que o ID seja válido e convertido para string
      const viagemId = v.IDVIAGEM != null ? String(v.IDVIAGEM) : '';
      
      if (!viagemId) {
        return '';
      }
      
      return `
      <div class="list-item ${v.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${viagemId}">
        <div>
          <strong>${v.IDVIAGEM} - ${v.FGSITVIAGEM_NOME}</strong>
          <small>
            <strong>Tipo:</strong> ${v.DSTIPOVIAGEM || 'Não informado'}<br>
            <strong>Situação:</strong> ${v.DSSITUACAOVIAGEM || 'Não informado'}<br>
            <strong>Origem:</strong> ${v.ORIGEM_ESTADO} - ${v.ORIGEM_CIDADE}<br>
            <strong>Destino:</strong> ${v.DESTINO_ESTADO} - ${v.DESTINO_CIDADE}<br>
            <strong>Roteiro:</strong> ${v.DSROTEIRO || 'Não informado'}<br>
            <strong>Contratador:</strong> ${v.CONTRATADOR_NOME || 'Não informado'}<br>
            <strong>Status:</strong> ${v.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${viagemId}">Editar</button>
          <button class="btn delete" data-id="${viagemId}">Excluir</button>
        </div>
      </div>
    `;
    }).filter(item => item !== '').join('');
  }

  // Carregar viagem para edição
  async function loadViagemParaEdicao(id) {
    try {
      _log('[CARREGAR VIAGEM] Iniciando carregamento da viagem ID:', id);
      
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      // Isso evita que dados de uma viagem apareçam em outra
      const viagemForm = document.getElementById('viagemForm');
      if (viagemForm) {
        viagemForm.reset();
        // Limpar campos específicos que podem não ser limpos pelo reset
        document.getElementById('viagemId').value = '';
        document.getElementById('viagemOrigemCidade').value = '';
        document.getElementById('viagemDestinoCidade').value = '';
        document.getElementById('viagemOrigemEstado').value = '';
        document.getElementById('viagemDestinoEstado').value = '';
        document.getElementById('viagemRoteiro').value = '';
        document.getElementById('viagemOrigemCodigo').value = '';
        document.getElementById('viagemDestinoCodigo').value = '';
      }
      
      // Forçar mudança para aba de dados ANTES de qualquer coisa
      await showTab('dados');
      
      // Aguardar para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const response = await fetchApiViagens(`/${id}`);
      const viagem = await response.json();
      
      if (viagem) {
        // Carregar combos e estados PRIMEIRO, antes de preencher
        // IMPORTANTE: Não mudar a aba durante o carregamento
        if (!estadosCarregados) {
          await loadEstados();
        }
        await loadCombos();
        
        // Garantir que a aba de dados continua ativa após carregar combos
        // Forçar novamente com escopo no container do módulo
        const tabContentDados = document.getElementById('tab-dados');
        const tabBtnDados = document.querySelector('.tab-btn[data-tab="dados"]');
        if (tabContentDados && tabBtnDados) {
          const container = document.querySelector('.viagens-container') || tabContentDados.closest('[class*="-container"]') || tabContentDados.parentElement;
          if (container) {
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            container.querySelectorAll('.tab-content').forEach(content => {
              content.classList.remove('active');
              content.style.setProperty('display', 'none', 'important');
            });
          }
          tabBtnDados.classList.add('active');
          tabContentDados.classList.add('active');
          tabContentDados.style.setProperty('display', 'block', 'important');
          const tabSwitch = document.getElementById('tab-integracao-switch');
          if (tabSwitch) tabSwitch.style.setProperty('display', 'none', 'important');
          const tabMacros = document.getElementById('tab-macros');
          if (tabMacros) tabMacros.style.setProperty('display', 'none', 'important');
        }
        
        // Aguardar um pouco para garantir que os selects foram renderizados
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Preencher campos básicos (não dependem de combos)
        document.getElementById('viagemId').value = viagem.IDVIAGEM || '';
        document.getElementById('viagemIdViagem').value = viagem.IDVIAGEM || '';
        document.getElementById('viagemUsuario').value = viagem.SGUSERINCLUSAO || '';
        document.getElementById('viagemDataInclusao').value = formatarDataParaInput(viagem.DHINCLUSAO);
        document.getElementById('viagemDataInicio').value = formatarDataParaInput(viagem.DTPREVINICIO);
        document.getElementById('viagemDataFim').value = formatarDataParaInput(viagem.DTPREVFINAL);
        document.getElementById('viagemDistancia').value = viagem.DISTANCIAKM || '';
        // Formatar Frete com 2 casas decimais
        const freteValue = viagem.VLFRETE ? parseFloat(viagem.VLFRETE).toFixed(2) : '';
        document.getElementById('viagemFrete').value = freteValue;
        const moedaViagem = (viagem.MOEDA && String(viagem.MOEDA).trim()) || 'BRL';
        const selMoeda = document.getElementById('viagemMoeda');
        if (selMoeda) {
          selMoeda.value = moedaViagem;
          if (!selMoeda.querySelector('option[value="' + moedaViagem + '"]')) selMoeda.value = 'BRL';
        }
        // Formatar Peso com 3 casas decimais
        const pesoValue = viagem.PESO ? parseFloat(viagem.PESO).toFixed(3) : '';
        document.getElementById('viagemPeso').value = pesoValue;
        // Formatar Cubagem com 3 casas decimais
        const cubagemValue = viagem.CUBAGEM ? parseFloat(viagem.CUBAGEM).toFixed(3) : '';
        document.getElementById('viagemCubagem').value = cubagemValue;
        document.getElementById('viagemObserv').value = viagem.OBSERV || '';
        
        // Preencher campos de select com retry
        const preencherSelect = async (id, valor, maxTentativas = 10) => {
          if (!valor && valor !== 0) return;
          
          const valorStr = String(valor);
          for (let i = 0; i < maxTentativas; i++) {
            const select = document.getElementById(id);
            if (select && select.options.length > 1) {
              // Verificar se a opção existe
              const opcaoExiste = Array.from(select.options).some(opt => 
                String(opt.value).trim() === valorStr.trim() || 
                String(opt.value).trim() === String(valor).trim()
              );
              
              if (opcaoExiste) {
                select.value = valorStr;
                break;
              }
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        };
        
        // Preencher selects com valores convertidos para string
        await preencherSelect('viagemSituacaoViagem', viagem.FGSITVIAGEM);
        await preencherSelect('viagemSituacao', String(viagem.CDSITUACAOVIAGEM));
        await preencherSelect('viagemTipoViagem', String(viagem.CDTIPOVIAGEM));
        await preencherSelect('viagemContratador', viagem.CDCONTRATADOR ? String(viagem.CDCONTRATADOR) : '');
        await preencherSelect('viagemClasseFrota', viagem.CDCLASSEFROTA ? String(viagem.CDCLASSEFROTA) : '');
        await preencherSelect('viagemSituacaoAtiva', viagem.FGACTIVE);
        
        // Preencher FGRASTREADO - campo simples S/N, não precisa de retry complexo
        const rastreadoSelect = document.getElementById('viagemRastreado');
        if (rastreadoSelect && viagem.FGRASTREADO) {
          rastreadoSelect.value = String(viagem.FGRASTREADO).trim().toUpperCase();
        } else if (rastreadoSelect) {
          rastreadoSelect.value = '';
        }
        
        // Preencher país origem/destino (se a API retornar; senão mantém BR do loadEstados)
        const origemPaisVal = (viagem.ORIGEM_PAIS != null && String(viagem.ORIGEM_PAIS).trim() !== '') ? String(viagem.ORIGEM_PAIS).trim() : 'BR';
        const destinoPaisVal = (viagem.DESTINO_PAIS != null && String(viagem.DESTINO_PAIS).trim() !== '') ? String(viagem.DESTINO_PAIS).trim() : 'BR';
        const selOrigemPais = document.getElementById('viagemOrigemPais');
        const selDestinoPais = document.getElementById('viagemDestinoPais');
        if (selOrigemPais && selOrigemPais.querySelector('option[value="' + origemPaisVal + '"]')) selOrigemPais.value = origemPaisVal;
        if (selDestinoPais && selDestinoPais.querySelector('option[value="' + destinoPaisVal + '"]')) selDestinoPais.value = destinoPaisVal;
        if (origemPaisVal !== 'BR') await loadEstadosPorPais(origemPaisVal, 'viagemOrigemEstado', 'Selecione');
        if (destinoPaisVal !== 'BR') await loadEstadosPorPais(destinoPaisVal, 'viagemDestinoEstado', 'Selecione');

        // Preencher origem e destino
        _log('[CARREGAR VIAGEM] Dados da viagem recebidos:', {
          ORIGEM_ESTADO: viagem.ORIGEM_ESTADO,
          ORIGEM_CODIGO: viagem.ORIGEM_CODIGO,
          DESTINO_ESTADO: viagem.DESTINO_ESTADO,
          DESTINO_CODIGO: viagem.DESTINO_CODIGO,
          IDROTEIRO: viagem.IDROTEIRO
        });
        
        if (viagem.ORIGEM_ESTADO) {
          const estadoOrigem = viagem.ORIGEM_ESTADO.trim();
          await preencherSelect('viagemOrigemEstado', estadoOrigem);
          const selOrigemEst = document.getElementById('viagemOrigemEstado');
          if (selOrigemEst && selOrigemEst.value !== estadoOrigem && !selOrigemEst.querySelector('option[value="' + estadoOrigem + '"]')) {
            const opt = document.createElement('option');
            opt.value = estadoOrigem;
            opt.textContent = estadoOrigem + (viagem.ORIGEM_CIDADE ? ' - ' + viagem.ORIGEM_CIDADE : ' - Origem');
            selOrigemEst.appendChild(opt);
            selOrigemEst.value = estadoOrigem;
          }
          await loadCidadesPorEstado(estadoOrigem, 'origem');
          
          // Aguardar cidades carregarem e preencher
          if (viagem.ORIGEM_CODIGO) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await preencherSelect('viagemOrigemCidade', String(viagem.ORIGEM_CODIGO));
            document.getElementById('viagemOrigemCodigo').value = String(viagem.ORIGEM_CODIGO);
            _log('[CARREGAR VIAGEM] Origem preenchida:', {
              estado: estadoOrigem,
              codigo: viagem.ORIGEM_CODIGO,
              cidadeSelectValue: document.getElementById('viagemOrigemCidade')?.value
            });
          }
        }
        
        if (viagem.DESTINO_ESTADO) {
          const estadoDestino = viagem.DESTINO_ESTADO.trim();
          await preencherSelect('viagemDestinoEstado', estadoDestino);
          const selDestinoEst = document.getElementById('viagemDestinoEstado');
          if (selDestinoEst && selDestinoEst.value !== estadoDestino && !selDestinoEst.querySelector('option[value="' + estadoDestino + '"]')) {
            const opt = document.createElement('option');
            opt.value = estadoDestino;
            opt.textContent = estadoDestino + (viagem.DESTINO_CIDADE ? ' - ' + viagem.DESTINO_CIDADE : ' - Destino');
            selDestinoEst.appendChild(opt);
            selDestinoEst.value = estadoDestino;
          }
          await loadCidadesPorEstado(estadoDestino, 'destino');
          
          // Aguardar cidades carregarem e preencher
          if (viagem.DESTINO_CODIGO) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await preencherSelect('viagemDestinoCidade', String(viagem.DESTINO_CODIGO));
            document.getElementById('viagemDestinoCodigo').value = String(viagem.DESTINO_CODIGO);
            _log('[CARREGAR VIAGEM] Destino preenchido:', {
              estado: estadoDestino,
              codigo: viagem.DESTINO_CODIGO,
              cidadeSelectValue: document.getElementById('viagemDestinoCidade')?.value
            });
          }
        }
        
        // Carregar roteiros e preencher
        if (viagem.ORIGEM_CODIGO && viagem.DESTINO_CODIGO) {
          _log('[CARREGAR VIAGEM] Carregando roteiros para origem:', viagem.ORIGEM_CODIGO, 'destino:', viagem.DESTINO_CODIGO, 'roteiro esperado:', viagem.IDROTEIRO);
          await loadRoteirosPorRota(String(viagem.ORIGEM_CODIGO), String(viagem.DESTINO_CODIGO), viagem.IDROTEIRO ? String(viagem.IDROTEIRO) : null);
          await new Promise(resolve => setTimeout(resolve, 300)); // Aumentar tempo de espera
          
          if (viagem.IDROTEIRO) {
            _log('[CARREGAR VIAGEM] Tentando preencher roteiro ID:', viagem.IDROTEIRO);
            const roteiroSelect = document.getElementById('viagemRoteiro');
            
            // Verificar se o select tem opções
            if (roteiroSelect && roteiroSelect.options.length > 1) {
              const roteiroIdStr = String(viagem.IDROTEIRO);
              const opcaoExiste = Array.from(roteiroSelect.options).some(opt => 
                String(opt.value).trim() === roteiroIdStr.trim()
              );
              
              if (opcaoExiste) {
                roteiroSelect.value = roteiroIdStr;
                _log('[CARREGAR VIAGEM] ✅ Roteiro preenchido com sucesso:', roteiroIdStr);
                // Carregar resumo da rota
                await carregarResumoRota(roteiroIdStr);
              } else {
                console.warn('[CARREGAR VIAGEM] ⚠️ Roteiro ID não encontrado no select:', roteiroIdStr);
                _log('[CARREGAR VIAGEM] Opções disponíveis:', Array.from(roteiroSelect.options).map(opt => opt.value));
                // Tentar novamente após mais um tempo
                await new Promise(resolve => setTimeout(resolve, 200));
                await preencherSelect('viagemRoteiro', roteiroIdStr, 15); // Mais tentativas
                if (roteiroSelect.value === roteiroIdStr) {
                  _log('[CARREGAR VIAGEM] ✅ Roteiro preenchido após retry');
                  await carregarResumoRota(roteiroIdStr);
                } else {
                  console.error('[CARREGAR VIAGEM] ❌ Falha ao preencher roteiro após retry');
                }
              }
            } else {
              console.warn('[CARREGAR VIAGEM] ⚠️ Select de roteiro ainda não tem opções. Aguardando...');
              // Aguardar mais e tentar novamente
              await new Promise(resolve => setTimeout(resolve, 500));
              await preencherSelect('viagemRoteiro', String(viagem.IDROTEIRO), 20); // Ainda mais tentativas
              if (document.getElementById('viagemRoteiro')?.value === String(viagem.IDROTEIRO)) {
                _log('[CARREGAR VIAGEM] ✅ Roteiro preenchido após espera adicional');
                await carregarResumoRota(String(viagem.IDROTEIRO));
              }
            }
          } else {
            _log('[CARREGAR VIAGEM] Viagem não tem IDROTEIRO definido');
          }
        } else {
          console.warn('[CARREGAR VIAGEM] ⚠️ Não foi possível carregar roteiros: origem ou destino faltando');
        }
        
        document.getElementById('formTitle').textContent = t('web.modulos.viagens.editarViagem');
        
        // IMPORTANTE: Preencher o campo "ID Viagem" no filtro para evitar que a aba volte para "Filtros"
        // Isso garante que quando o usuário estiver editando uma viagem, a aba permaneça em "Dados"
        const filtroIdViagem = document.getElementById('filtroIdViagem');
        if (filtroIdViagem && viagem.IDVIAGEM) {
          filtroIdViagem.value = String(viagem.IDVIAGEM);
        }
        
        // SEMPRE limpar o mapa quando uma nova viagem for carregada
        // Isso garante que não haja dados residuais de viagens anteriores
        if (mapa) {
          limparMapa();
        }
        
        // Atualizar mapa se a aba mapa estiver ativa
        const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
        if (tabMapa && tabMapa.classList.contains('active')) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await atualizarMapa();
        }
        
        // Atualizar macros se a aba macros estiver ativa
        const tabMacros = document.querySelector('.tab-btn[data-tab="macros"]');
        if (tabMacros && tabMacros.classList.contains('active')) {
          await new Promise(resolve => setTimeout(resolve, 300));
          carregarMacrosViagem();
        }
        
        // PROTEÇÃO FINAL: Garantir que a aba de dados permanece ativa (escopo no container)
        setTimeout(() => {
          const tabBtnDados = document.querySelector('.tab-btn[data-tab="dados"]');
          const tabContentDados = document.getElementById('tab-dados');
          if (tabBtnDados && tabContentDados && !tabBtnDados.classList.contains('active')) {
            const container = document.querySelector('.viagens-container') || tabContentDados.closest('[class*="-container"]') || tabContentDados.parentElement;
            if (container) {
              container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
              container.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.style.setProperty('display', 'none', 'important');
              });
            }
            tabBtnDados.classList.add('active');
            tabContentDados.classList.add('active');
            tabContentDados.style.setProperty('display', 'block', 'important');
            const tabSwitch = document.getElementById('tab-integracao-switch');
            if (tabSwitch) tabSwitch.style.setProperty('display', 'none', 'important');
            const tabMacros = document.getElementById('tab-macros');
            if (tabMacros) tabMacros.style.setProperty('display', 'none', 'important');
          }
        }, 500);
      }
    } catch (err) {
      console.error('Erro ao carregar viagem:', err);
      showMessage(t('web.modulos.viagens.erroCarregarDados'), 'error');
    }
  }

  // Formatar data para input datetime-local.
  // JSON costuma trazer instante em ISO UTC (...Z): converter para hora local do navegador (evita +3h em Brasília).
  // String SQL sem fuso ("2026-03-30 17:00:00"): usar dígitos como relógio de negócio, sem deslocar.
  function formatarDataParaInput(data) {
    if (typeof window.dataApiParaDatetimeLocal === 'function') {
      return window.dataApiParaDatetimeLocal(data, contextoViagens.timezone);
    }
    if (!data) return '';
    const str = String(data).trim().replace(/\.\d+/, '');
    const m = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
    return '';
  }

  // Modal de comprovantes de entrega (POD)
  function fecharModalComprovantes() {
    const modal = document.getElementById('modalComprovantes');
    if (modal) {
      modal.querySelectorAll('.pod-map-container').forEach(el => {
        if (el._podMap && typeof el._podMap.remove === 'function') {
          el._podMap.remove();
          el._podMap = null;
        }
      });
      if (window.__podModalBlobUrls && window.__podModalBlobUrls.length) {
        window.__podModalBlobUrls.forEach((u) => {
          try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ }
        });
        window.__podModalBlobUrls = [];
      }
      modal.style.display = 'none';
    }
  }
  window.fecharModalComprovantes = fecharModalComprovantes;

  async function abrirModalComprovantes(idviagem) {
    const modal = document.getElementById('modalComprovantes');
    const tituloId = document.getElementById('modalComprovantesIdViagem');
    const carregando = document.getElementById('modalComprovantesCarregando');
    const lista = document.getElementById('modalComprovantesLista');
    if (!modal || !tituloId || !carregando || !lista) return;
    tituloId.textContent = idviagem;
    carregando.style.display = 'block';
    carregando.textContent = 'Carregando comprovantes...';
    lista.style.display = 'none';
    lista.innerHTML = '';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    if (!window.__podModalBlobUrls) window.__podModalBlobUrls = [];
    window.__podModalBlobUrls.forEach((u) => {
      try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ }
    });
    window.__podModalBlobUrls = [];

    try {
      const res = await fetchApiAbsPath(`/api/motorista/delivery-proof/viagem/${encodeURIComponent(idviagem)}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Erro ao carregar comprovantes');
      const data = await res.json();
      const comprovantes = data.comprovantes || [];
      carregando.style.display = 'none';
      if (comprovantes.length === 0) {
        carregando.style.display = 'block';
        carregando.textContent = 'Nenhum comprovante registrado para esta viagem.';
        return;
      }
      lista.style.display = 'grid';
      const baseUrl = window.location.origin + (window.BASE_PATH || '');
      const comprovantesComMapa = [];
      comprovantes.forEach((c, idx) => {
        const id = c.ID ?? c.id;
        const recordedAt = c.RECORDED_AT ?? c.recorded_at;
        const receiverName = (c.RECEIVER_NAME ?? c.receiver_name ?? '-') || '-';
        const receiverDoc = (c.RECEIVER_DOCUMENT ?? c.receiver_document ?? '') || '';
        const obs = (c.OBSERVATIONS ?? c.observations ?? '') || '';
        const signatureData = c.SIGNATURE_DATA ?? c.signature_data ?? '';
        const photoName = (c.PHOTO_NAME ?? c.photo_name ?? '') || '';
        const synced = c.SYNCED ?? c.synced;
        const lat = c.LATITUDE ?? c.latitude;
        const lng = c.LONGITUDE ?? c.longitude;
        const hasLatLng = lat != null && lng != null && Number(lat) !== 0 && Number(lng) !== 0;
        const dataStr = recordedAt ? fmtDataHora(recordedAt) : '-';
        const photoUrl = id ? `${baseUrl}/api/motorista/delivery-proof/${id}/photo` : '';
        const mapId = `pod-map-${id ?? idx}-${Date.now()}`;
        const linkMapa = hasLatLng ? `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}` : '';
        const linkOsm = hasLatLng ? `https://www.openstreetmap.org/?mlat=${Number(lat)}&mlon=${Number(lng)}&zoom=17` : '';
        const coordsStr = hasLatLng ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : '';
        const syncedLabel = synced === true || synced === 1 || synced === '1' || String(synced).toLowerCase() === 'true' ? 'Sincronizado' : 'Pendente';
        const syncedClass = synced === true || synced === 1 || synced === '1' ? 'sim' : 'nao';
        let assinaturaHtml = '';
        if (signatureData && (signatureData.startsWith('data:') || signatureData.startsWith('http'))) {
          assinaturaHtml = `<div class="pod-card-section"><h4>Assinatura do recebedor</h4><img class="pod-assinatura" src="${signatureData.replace(/"/g, '&quot;')}" alt="Assinatura" /></div>`;
        }
        const card = document.createElement('div');
        card.className = 'pod-card';
        card.dataset.podId = String(id ?? idx);
        card.dataset.lat = hasLatLng ? String(lat) : '';
        card.dataset.lng = hasLatLng ? String(lng) : '';
        card.dataset.mapId = mapId;
        card.innerHTML = `
          <div class="pod-card-header">Comprovante ${idx + 1} — ${dataStr}</div>
          <div class="pod-card-body">
            <div class="pod-card-section">
              <h4>Recebedor</h4>
              <div class="pod-value">${receiverName}</div>
              ${receiverDoc ? `<div class="pod-meta">CPF/RG: ${receiverDoc}</div>` : ''}
            </div>
            ${obs ? `<div class="pod-card-section"><h4>Observações</h4><div class="pod-value">${obs}</div></div>` : ''}
            ${photoName ? `<div class="pod-card-section"><h4>Arquivo da foto</h4><div class="pod-value pod-filename">${photoName}</div></div>` : ''}
            <div class="pod-card-section">
              <h4>Foto do comprovante</h4>
              ${photoUrl ? `<img class="pod-foto pod-foto-auth" src="" alt="Carregando foto…" data-photo-api="${String(photoUrl).replace(/"/g, '&quot;')}" />` : '<div class="pod-placeholder">Sem foto</div>'}
            </div>
            ${assinaturaHtml}
            <div class="pod-card-section">
              <h4>Local do registro</h4>
              ${hasLatLng ? `<div id="${mapId}" class="pod-map-container"></div><div class="pod-coords">${coordsStr}</div><a href="${linkMapa}" target="_blank" rel="noopener" class="pod-map-link">&#128506; Abrir no Google Maps</a><br/><a href="${linkOsm}" target="_blank" rel="noopener" class="pod-map-link">&#128506; Ver no OpenStreetMap</a>` : '<div class="pod-value pod-muted">Local não registrado</div>'}
            </div>
            <div class="pod-card-section">
              <span class="pod-synced ${syncedClass}">${syncedLabel}</span>
            </div>
          </div>
        `;
        lista.appendChild(card);
        if (hasLatLng && mapId) comprovantesComMapa.push({ mapId, lat: Number(lat), lng: Number(lng) });
      });
      // Fotos exigem Authorization; <img src> não envia Bearer — carregar via fetch + blob
      (async () => {
        const imgs = lista.querySelectorAll('img.pod-foto-auth[data-photo-api]');
        for (const img of imgs) {
          const url = img.getAttribute('data-photo-api');
          if (!url) continue;
          try {
            const r = await fetch(url, { headers: getAuthHeaders() });
            if (r.ok) {
              const blob = await r.blob();
              const obj = URL.createObjectURL(blob);
              window.__podModalBlobUrls.push(obj);
              img.src = obj;
              img.alt = 'Comprovante';
              img.removeAttribute('data-photo-api');
            } else {
              img.alt = 'Não foi possível carregar a foto';
              img.style.minHeight = '80px';
              img.classList.add('pod-foto-erro');
            }
          } catch (e) {
            img.alt = 'Erro ao carregar foto';
            img.style.minHeight = '80px';
            img.classList.add('pod-foto-erro');
          }
        }
      })();
      // Inicializar mapas Leaflet nos cards (local onde o motorista registrou)
      if (comprovantesComMapa.length > 0 && typeof carregarLeaflet === 'function') {
        (async () => {
          try {
            await carregarLeaflet();
            if (typeof window.L !== 'undefined' && window.L.map) {
              const tileUrl = (window.MAP_CONFIG && window.MAP_CONFIG.tileServer) ? window.MAP_CONFIG.tileServer : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
              comprovantesComMapa.forEach(({ mapId, lat, lng }) => {
                const el = document.getElementById(mapId);
                if (!el || el._podMap) return;
                try {
                  const map = window.L.map(mapId).setView([lat, lng], 16);
                  window.L.tileLayer(tileUrl, { attribution: '&copy; OpenStreetMap' }).addTo(map);
                  window.L.marker([lat, lng]).addTo(map).bindPopup('Local do comprovante');
                  el._podMap = map;
                } catch (e) { console.warn('POD mapa', mapId, e); }
              });
            }
          } catch (e) { console.warn('Leaflet para POD:', e); }
        })();
      }
    } catch (err) {
      carregando.style.display = 'block';
      carregando.textContent = 'Erro ao carregar comprovantes: ' + (err.message || 'Erro desconhecido');
      if (typeof showMessage === 'function') showMessage('Erro ao carregar comprovantes.', 'error');
    }
  }

  // Confirmar exclusão (desativar/reativar) — modal padrão ou fallback com confirm()
  async function confirmarExclusao(id) {
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage(t('web.modulos.viagens.erroIdIndisponivel'), 'error');
      return;
    }
    idValido = String(idValido).trim();

    try {
      const idToCheck = isNaN(idValido) ? idValido : parseFloat(idValido);
      const response = await fetchApiViagens(`/${idToCheck}`);
      if (!response.ok) throw new Error('Erro ao buscar viagem');
      const viagem = await response.json();
      const estaAtivo = viagem.FGACTIVE === 'S';
      const confirmMsg = estaAtivo ? 'Tem certeza que deseja desativar esta viagem?' : 'Tem certeza que deseja reativar esta viagem?';
      const action = estaAtivo ? 'deactivate' : 'activate';
      const btnText = estaAtivo ? 'Desativar' : 'Reativar';

      // Re-buscar elementos após o await (podem ter sido removidos do DOM pelo dashboard)
      const modalMessage = document.getElementById('modalMessage');
      const confirmYes = document.getElementById('confirmYes');
      const confirmNo = document.getElementById('confirmNo');
      const modalEl = document.getElementById('confirmModal');
      const modalOk = modalMessage && confirmYes && confirmNo && modalEl &&
        document.body.contains(confirmYes) && confirmYes.parentNode;

      if (!modalOk) {
        const ok =
          typeof window.confirmPadrao === 'function'
            ? await window.confirmPadrao(confirmMsg, {
                title: estaAtivo ? 'Desativar viagem' : 'Reativar viagem',
                danger: estaAtivo,
                confirmText: btnText,
                cancelText: 'Cancelar',
              })
            : window.confirm(confirmMsg);
        if (!ok) return;
        const res = await fetchApiViagens(`/${idToCheck}?action=${action}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          showMessage(data.message || (action === 'activate' ? 'Viagem reativada com sucesso!' : 'Viagem desativada com sucesso!'), 'success');
          showTab('grid');
          applyFilters('grid');
        } else {
          showMessage(data.error || 'Erro ao alterar status da viagem.', 'error');
        }
        return;
      }

      modalMessage.textContent = confirmMsg;
      modalEl.dataset.deleteId = idValido;
      modalEl.dataset.action = action;

      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      newConfirmYes.className = 'btn-filtro btn-filtro-danger';
      newConfirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
      newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
      newConfirmNo.innerHTML = '<i class=\'bx bx-x\'></i> Cancelar';

      if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);

      newConfirmYes.onclick = async () => {
        const idParaExcluir = modalEl.dataset.deleteId || idValido;
        const acao = modalEl.dataset.action || action;
        if (!idParaExcluir || idParaExcluir === 'undefined' || idParaExcluir === 'null' || idParaExcluir === '') {
          showMessage(t('web.modulos.viagens.erroIdIndisponivel'), 'error');
          modalEl.style.display = 'none';
          return;
        }
        try {
          const idToDelete = isNaN(idParaExcluir) ? idParaExcluir : parseFloat(idParaExcluir);
          const res = await fetchApiViagens(`/${idToDelete}?action=${acao}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Viagem reativada com sucesso!' : 'Viagem desativada com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da viagem.', 'error');
          }
        } catch (err) {
          console.error('[Viagens] Erro ao alterar status:', err);
          showMessage(t('web.modulos.viagens.erroConexao'), 'error');
        } finally {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteId;
          delete modalEl.dataset.action;
        }
      };
      newConfirmNo.onclick = () => {
        modalEl.style.display = 'none';
        delete modalEl.dataset.deleteId;
        delete modalEl.dataset.action;
      };
      modalEl.style.display = 'block';
    } catch (err) {
      console.error('[Viagens] Erro ao buscar status da viagem:', err);
      showMessage(t('web.modulos.viagens.erroConexao') || 'Não foi possível verificar a viagem. Tente novamente.', 'error');
    }
  }

  // Salvar formulário
  // Função de validação de formulário
  function validarFormularioViagem() {
    const erros = [];
    
    // Validar campos obrigatórios
    const situacaoViagem = document.getElementById('viagemSituacaoViagem')?.value;
    if (!situacaoViagem) {
      erros.push('Situação Viagem é obrigatória');
      // Destacar campo
      const campo = document.getElementById('viagemSituacaoViagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const situacao = document.getElementById('viagemSituacao')?.value;
    if (!situacao) {
      erros.push('Situação é obrigatória');
      const campo = document.getElementById('viagemSituacao');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const tipoViagem = document.getElementById('viagemTipoViagem')?.value;
    if (!tipoViagem) {
      erros.push('Tipo de Viagem é obrigatório');
      const campo = document.getElementById('viagemTipoViagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const situacaoAtiva = document.getElementById('viagemSituacaoAtiva')?.value;
    if (!situacaoAtiva) {
      erros.push('Situação Ativa é obrigatória');
      const campo = document.getElementById('viagemSituacaoAtiva');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    // Validar datas (data fim deve ser maior que data início)
    const dataInicio = document.getElementById('viagemDataInicio')?.value;
    const dataFim = document.getElementById('viagemDataFim')?.value;
    if (dataInicio && dataFim) {
      const inicio = new Date(dataInicio);
      const fim = new Date(dataFim);
      if (fim < inicio) {
        erros.push('Data de término deve ser maior que data de início');
        const campoInicio = document.getElementById('viagemDataInicio');
        const campoFim = document.getElementById('viagemDataFim');
        if (campoInicio) {
          campoInicio.style.borderColor = '#dc3545';
          setTimeout(() => { campoInicio.style.borderColor = ''; }, 3000);
        }
        if (campoFim) {
          campoFim.style.borderColor = '#dc3545';
          setTimeout(() => { campoFim.style.borderColor = ''; }, 3000);
        }
      }
    }
    
    // Validar valores numéricos
    const distancia = document.getElementById('viagemDistancia')?.value;
    if (distancia && (isNaN(parseFloat(distancia)) || parseFloat(distancia) < 0)) {
      erros.push('Distância deve ser um número positivo');
      const campo = document.getElementById('viagemDistancia');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const frete = document.getElementById('viagemFrete')?.value;
    if (frete && (isNaN(parseFloat(frete)) || parseFloat(frete) < 0)) {
      erros.push('Valor do frete deve ser um número positivo');
      const campo = document.getElementById('viagemFrete');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const peso = document.getElementById('viagemPeso')?.value;
    if (peso && (isNaN(parseFloat(peso)) || parseFloat(peso) < 0)) {
      erros.push('Peso deve ser um número positivo');
      const campo = document.getElementById('viagemPeso');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const cubagem = document.getElementById('viagemCubagem')?.value;
    if (cubagem && (isNaN(parseFloat(cubagem)) || parseFloat(cubagem) < 0)) {
      erros.push('Cubagem deve ser um número positivo');
      const campo = document.getElementById('viagemCubagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    return erros;
  }

  let viagemFormSubmitting = false;
  viagemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (viagemFormSubmitting) return;
    viagemFormSubmitting = true;

    const btnSalvar = viagemForm.querySelector('button[type="submit"]');
    if (btnSalvar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnSalvar, true);
    }

    // Validar formulário antes de enviar
    const erros = validarFormularioViagem();
    if (erros.length > 0) {
      showMessage('❌ Erros encontrados:\n\n' + erros.join('\n'), 'error');
      const primeiroErro = document.querySelector('input[style*="border-color: rgb(220, 53, 69)"], select[style*="border-color: rgb(220, 53, 69)"]');
      if (primeiroErro) {
        primeiroErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
        primeiroErro.focus();
      }
      viagemFormSubmitting = false;
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }

    const situacaoViagem = document.getElementById('viagemSituacaoViagem')?.value;
    const situacao = document.getElementById('viagemSituacao')?.value;
    const tipoViagem = document.getElementById('viagemTipoViagem')?.value;
    let dataInicio = document.getElementById('viagemDataInicio')?.value;
    let dataFim = document.getElementById('viagemDataFim')?.value;
    
    // Converter datetime-local para formato SQL Server (YYYY-MM-DD HH:mm:ss)
    // datetime-local retorna "YYYY-MM-DDTHH:mm", precisamos converter para "YYYY-MM-DD HH:mm:ss"
    if (dataInicio) {
      dataInicio = dataInicio.replace('T', ' ') + ':00';
    }
    if (dataFim) {
      dataFim = dataFim.replace('T', ' ') + ':00';
    }
    
    const rastreado = document.getElementById('viagemRastreado')?.value;
    
    // Validação já foi feita pela função validarFormularioViagem() acima
    // Apenas verificar se rastreado foi preenchido (campo obrigatório)
    if (!rastreado) {
      showMessage('Campo "Exige Veículo Rastreado?" é obrigatório.', 'error');
      const campo = document.getElementById('viagemRastreado');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        campo.focus();
      }
      viagemFormSubmitting = false;
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }

    try {
      const viagemData = {
        FGSITVIAGEM: situacaoViagem,
        CDSITUACAOVIAGEM: parseInt(situacao),
        CDTIPOVIAGEM: parseInt(tipoViagem),
        CDCONTRATADOR: document.getElementById('viagemContratador')?.value || null,
        CDCLASSEFROTA: document.getElementById('viagemClasseFrota')?.value || null,
        DTPREVINICIO: dataInicio,
        DTPREVFINAL: dataFim,
        IDROTEIRO: document.getElementById('viagemRoteiro')?.value || null,
        DISTANCIAKM: document.getElementById('viagemDistancia')?.value || null,
        VLFRETE: document.getElementById('viagemFrete')?.value ? parseFloat(document.getElementById('viagemFrete').value) : null,
        MOEDA: document.getElementById('viagemMoeda')?.value || 'BRL',
        PESO: document.getElementById('viagemPeso')?.value ? parseFloat(document.getElementById('viagemPeso').value) : null,
        CUBAGEM: document.getElementById('viagemCubagem')?.value ? parseFloat(document.getElementById('viagemCubagem').value) : null,
        OBSERV: document.getElementById('viagemObserv')?.value.trim() || null,
        FGRASTREADO: rastreado
      };

      const jsonHeaders = { 'Content-Type': 'application/json' };

      let response;
      const id = document.getElementById('viagemId')?.value;
      if (id) {
        viagemData.FGACTIVE = document.getElementById('viagemSituacaoAtiva')?.value;
        response = await fetchApiViagens(`/${id}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(viagemData)
        });
      } else {
        response = await fetchApiViagens('', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(viagemData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        const mensagemSucesso = data.message || 'Viagem salva com sucesso!';
        showMessage(`✅ ${mensagemSucesso}`, 'success');
        
        // Emitir evento WebSocket se for atualização
        if (id && typeof window.WebSocketTorre !== 'undefined') {
          try {
            const websocketTorre = window.WebSocketTorre;
            // Buscar dados atualizados da viagem para emitir evento
            const viagemAtualizada = await fetchApiViagens(`/${id}`).then(r => r.json());
            if (viagemAtualizada && viagemAtualizada.IDVIAGEM) {
              // O evento será emitido automaticamente pelo controller no backend
              // Mas podemos forçar uma atualização na UI local se necessário
              if (typeof window.atualizarDadosViagem === 'function') {
                window.atualizarDadosViagem(id, viagemAtualizada);
              }
            }
          } catch (wsErr) {
            console.warn('Erro ao atualizar via WebSocket:', wsErr);
            // Não bloquear sucesso da operação
          }
        }
        
        // Aguardar um pouco antes de mudar de aba para garantir que mensagem seja vista
        await new Promise(resolve => setTimeout(resolve, 500));
        showTab('grid');
        await applyFilters('grid');
      } else {
        // Mensagem de erro mais detalhada
        let erroMsg = data.error || 'Erro ao salvar viagem.';
        if (data.details) {
          erroMsg += `\n\nDetalhes: ${data.details}`;
        }
        showMessage(`❌ ${erroMsg}`, 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage('Erro de conexão com o servidor.', 'error');
    } finally {
      setTimeout(() => {
        viagemFormSubmitting = false;
        const btn = viagemForm.querySelector('button[type="submit"]');
        if (btn && typeof window.showLoading !== 'undefined') {
          window.showLoading(btn, false);
        }
      }, 600);
    }
  });

  // Submit do form de filtros (padrão Gerenciar Situações de Viagem)
  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await applyFilters('grid');
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
    }
    return false;
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    // Limpar campos que não têm valor padrão
    document.getElementById('filtroIdViagem').value = '';
    document.getElementById('filtroTipoViagem').value = '';
    document.getElementById('filtroClasseFrota').value = '';
    document.getElementById('filtroContratador').value = '';
    document.getElementById('filtroOrigemEstado').value = '';
    document.getElementById('filtroOrigemCidade').value = '';
    document.getElementById('filtroDestinoEstado').value = '';
    document.getElementById('filtroDestinoCidade').value = '';
    document.getElementById('filtroRoteiro').value = '';
    document.getElementById('filtroRoteiroDescricao').value = '';
    document.getElementById('filtroRastreado').value = '';
    
    // Restaurar valores padrão
    preencherFiltrosPadrao();
    
    // Limpar Situação Viagem para "Todos" (vazio) quando o botão Limpar for clicado
    const filtroSituacaoViagem = document.getElementById('filtroSituacaoViagem');
    if (filtroSituacaoViagem) {
      filtroSituacaoViagem.value = '';
    }
  });

  // Eventos de abas (usar botões do container do módulo para não misturar com outros)
  const viagensContainer = document.querySelector('.viagens-container');
  const tabBtns = viagensContainer ? viagensContainer.querySelectorAll('.tab-btn') : document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
      
      // Se a aba mapa foi ativada, carregar o mapa
      if (tabId === 'mapa') {
        const leafletDisponivel = await aguardarLeaflet();
        if (!leafletDisponivel) {
          showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
          return;
        }
        
        // Inicializar mapa se ainda não foi inicializado
        if (!mapa) {
          const inicializado = await inicializarMapa();
          if (!inicializado) {
            console.error('Falha ao inicializar mapa');
            return;
          }
        }
        
        // SEMPRE limpar o mapa antes de atualizar quando a aba for ativada
        // Isso garante que mostre apenas os dados do registro selecionado
        if (mapa) {
          limparMapa();
          
          // Invalidar tamanho múltiplas vezes para garantir renderização correta
          // Aguardar um pouco para o container estar totalmente visível
          setTimeout(() => {
            try {
              if (mapa) {
                mapa.invalidateSize();
                // Forçar recálculo do tamanho
                if (mapa._onResize) {
                  mapa._onResize();
                }
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho após limpar:', e);
            }
          }, 100);
          
          // Invalidar novamente após mais um delay
          setTimeout(() => {
            try {
              if (mapa) {
                mapa.invalidateSize();
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho (segunda tentativa):', e);
            }
          }, 300);
          
          // Atualizar mapa após garantir que o tamanho está correto
          setTimeout(() => {
            atualizarMapa();
          }, 400);
        } else {
          await atualizarMapa();
        }
      }
    });
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    await showTab('filtros');
  });
  document.getElementById('btnNovoRegistro')?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    viagemForm?.reset();
    document.getElementById('viagemId').value = '';
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    document.getElementById('viagemUsuario').value = user.login || 'SYSTEM';
    document.getElementById('viagemDataInclusao').value = (typeof window.agoraParaDatetimeLocal === 'function')
      ? window.agoraParaDatetimeLocal(contextoViagens.timezone)
      : new Date().toISOString().slice(0, 16);
    document.getElementById('formTitle').textContent = t('web.modulos.viagens.novaViagem');
    const selOrigemPais = document.getElementById('viagemOrigemPais');
    const selDestinoPais = document.getElementById('viagemDestinoPais');
    if (selOrigemPais && selOrigemPais.querySelector('option[value="BR"]')) selOrigemPais.value = 'BR';
    if (selDestinoPais && selDestinoPais.querySelector('option[value="BR"]')) selDestinoPais.value = 'BR';
    showTab('dados');
  });
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    await showTab('filtros');
  });
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    viagemForm?.reset();
    document.getElementById('viagemId').value = '';
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    document.getElementById('viagemUsuario').value = user.login || 'SYSTEM';
    document.getElementById('viagemDataInclusao').value = (typeof window.agoraParaDatetimeLocal === 'function')
      ? window.agoraParaDatetimeLocal(contextoViagens.timezone)
      : new Date().toISOString().slice(0, 16);
    document.getElementById('formTitle').textContent = t('web.modulos.viagens.novaViagem');
    const selOrigemPais = document.getElementById('viagemOrigemPais');
    const selDestinoPais = document.getElementById('viagemDestinoPais');
    if (selOrigemPais && selOrigemPais.querySelector('option[value="BR"]')) selOrigemPais.value = 'BR';
    if (selDestinoPais && selDestinoPais.querySelector('option[value="BR"]')) selDestinoPais.value = 'BR';
    showTab('dados');
  });

  // País origem/destino: ao mudar, recarregar estados e limpar cidade/código; atualizar combo Roteiro
  // (não executar quando estiver preenchendo a partir do roteiro ou quando o change foi disparado por código)
  document.getElementById('viagemOrigemPais')?.addEventListener('change', async function(e) {
    if (preenchendoFromRoteiro || window._settingPaisFromRoteiro || (e && e.isTrusted === false)) return;
    const pais = this.value;
    await loadEstadosPorPais(pais, 'viagemOrigemEstado', 'Selecione');
    document.getElementById('viagemOrigemEstado').value = '';
    document.getElementById('viagemOrigemCidade').value = '';
    document.getElementById('viagemOrigemCodigo').value = '';
    atualizarComboRoteiro();
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) atualizarMapa();
  });
  document.getElementById('viagemDestinoPais')?.addEventListener('change', async function(e) {
    if (preenchendoFromRoteiro || window._settingPaisFromRoteiro || (e && e.isTrusted === false)) return;
    const pais = this.value;
    await loadEstadosPorPais(pais, 'viagemDestinoEstado', 'Selecione');
    document.getElementById('viagemDestinoEstado').value = '';
    document.getElementById('viagemDestinoCidade').value = '';
    document.getElementById('viagemDestinoCodigo').value = '';
    atualizarComboRoteiro();
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) atualizarMapa();
  });

  // Eventos de estado para carregar cidades e roteiros
  document.getElementById('viagemOrigemEstado')?.addEventListener('change', function() {
    if (preenchendoFromRoteiro) return;
    const estado = this.value;
    loadCidadesPorEstado(estado, 'origem');
    document.getElementById('viagemOrigemCidade').value = '';
    document.getElementById('viagemOrigemCodigo').value = '';
    atualizarComboRoteiro();
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemOrigemCidade')?.addEventListener('change', function() {
    if (preenchendoFromRoteiro) return;
    const cidadeId = this.value;
    document.getElementById('viagemOrigemCodigo').value = cidadeId || '';
    atualizarComboRoteiro();
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemDestinoEstado')?.addEventListener('change', function() {
    if (preenchendoFromRoteiro) return;
    const estado = this.value;
    loadCidadesPorEstado(estado, 'destino');
    document.getElementById('viagemDestinoCidade').value = '';
    document.getElementById('viagemDestinoCodigo').value = '';
    atualizarComboRoteiro();
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) atualizarMapa();
  });

  document.getElementById('viagemDestinoCidade')?.addEventListener('change', function() {
    if (preenchendoFromRoteiro) return;
    const cidadeId = this.value;
    document.getElementById('viagemDestinoCodigo').value = cidadeId || '';
    atualizarComboRoteiro();
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) atualizarMapa();
  });

  document.getElementById('viagemRoteiro')?.addEventListener('change', async function() {
    const roteiroId = this.value;
    const roteiro = roteirosCache.find(r => String(r.IDROTEIRO) === String(roteiroId));
    if (!roteiro) return;
    preenchendoFromRoteiro = true;
    window._settingPaisFromRoteiro = true;
    try {
      function v(obj, key) {
        if (!obj) return '';
        const u = key.toUpperCase();
        const found = Object.keys(obj).find(k => String(k).toUpperCase() === u);
        if (found && obj[found] != null && obj[found] !== '') return String(obj[found]).trim();
        if (obj[key] != null && obj[key] !== '') return String(obj[key]).trim();
        return '';
      }
      document.getElementById('viagemDistancia').value = v(roteiro, 'DISTANCIAKM') || '';
      const origemPaisRaw = v(roteiro, 'ORIGEM_PAIS');
      const destinoPaisRaw = v(roteiro, 'DESTINO_PAIS');
      const origemPais = origemPaisRaw !== '' ? origemPaisRaw.toUpperCase() : 'BR';
      const destinoPais = destinoPaisRaw !== '' ? destinoPaisRaw.toUpperCase() : 'BR';
      const origemEstadoR = v(roteiro, 'ORIGEM_ESTADO');
      const destinoEstadoR = v(roteiro, 'DESTINO_ESTADO');
      const origemCidadeR = v(roteiro, 'ORIGEM_CIDADE');
      const destinoCidadeR = v(roteiro, 'DESTINO_CIDADE');
      const codOrigem = v(roteiro, 'ORIGEM_CODIGO') || (roteiro.CDCIDADEORIGEM != null ? String(roteiro.CDCIDADEORIGEM) : '');
      const codDestino = v(roteiro, 'DESTINO_CODIGO') || (roteiro.CDCIDADEDESTINO != null ? String(roteiro.CDCIDADEDESTINO) : '');

      const selOrigemPais = document.getElementById('viagemOrigemPais');
      const selDestinoPais = document.getElementById('viagemDestinoPais');
      const selOrigemEstado = document.getElementById('viagemOrigemEstado');
      const selDestinoEstado = document.getElementById('viagemDestinoEstado');
      const selOrigemCidade = document.getElementById('viagemOrigemCidade');
      const selDestinoCidade = document.getElementById('viagemDestinoCidade');
      const optionExists = (sel, val) => sel && val !== '' && Array.from(sel.options).some(o => String(o.value) === String(val));

      await loadEstadosPorPais(origemPais, 'viagemOrigemEstado', 'Selecione');
      await loadEstadosPorPais(destinoPais, 'viagemDestinoEstado', 'Selecione');
      await new Promise(resolve => setTimeout(resolve, 80));

      if (origemEstadoR && selOrigemEstado) {
        if (!optionExists(selOrigemEstado, origemEstadoR)) {
          const opt = document.createElement('option');
          opt.value = origemEstadoR;
          opt.textContent = origemEstadoR + (origemCidadeR ? ' - ' + origemCidadeR : '');
          selOrigemEstado.appendChild(opt);
        }
        selOrigemEstado.value = origemEstadoR;
      } else if (origemCidadeR && selOrigemEstado) {
        if (!optionExists(selOrigemEstado, origemCidadeR)) {
          const opt = document.createElement('option');
          opt.value = origemCidadeR;
          opt.textContent = origemCidadeR;
          selOrigemEstado.appendChild(opt);
        }
        selOrigemEstado.value = origemCidadeR;
      }
      if (destinoEstadoR && selDestinoEstado) {
        if (!optionExists(selDestinoEstado, destinoEstadoR)) {
          const opt = document.createElement('option');
          opt.value = destinoEstadoR;
          opt.textContent = destinoEstadoR + (destinoCidadeR ? ' - ' + destinoCidadeR : '');
          selDestinoEstado.appendChild(opt);
        }
        selDestinoEstado.value = destinoEstadoR;
      } else if (destinoCidadeR && selDestinoEstado) {
        if (!optionExists(selDestinoEstado, destinoCidadeR)) {
          const opt = document.createElement('option');
          opt.value = destinoCidadeR;
          opt.textContent = destinoCidadeR;
          selDestinoEstado.appendChild(opt);
        }
        selDestinoEstado.value = destinoCidadeR;
      }

      if (origemEstadoR) {
        await loadCidadesPorEstado(origemEstadoR, 'origem');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (selOrigemCidade) {
        if (codOrigem && !optionExists(selOrigemCidade, codOrigem)) {
          if (!origemEstadoR) selOrigemCidade.innerHTML = '<option value="">Selecione</option>';
          const o = document.createElement('option');
          o.value = codOrigem;
          o.textContent = origemCidadeR || 'Origem';
          selOrigemCidade.appendChild(o);
        }
        selOrigemCidade.value = codOrigem || '';
      }
      document.getElementById('viagemOrigemCodigo').value = codOrigem || '';

      if (destinoEstadoR) {
        await loadCidadesPorEstado(destinoEstadoR, 'destino');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (selDestinoCidade) {
        if (codDestino && !optionExists(selDestinoCidade, codDestino)) {
          if (!destinoEstadoR) selDestinoCidade.innerHTML = '<option value="">Selecione</option>';
          const o = document.createElement('option');
          o.value = codDestino;
          o.textContent = destinoCidadeR || 'Destino';
          selDestinoCidade.appendChild(o);
        }
        selDestinoCidade.value = codDestino || '';
      }
      document.getElementById('viagemDestinoCodigo').value = codDestino || '';

      function setPaisSelect(sel, sigla) {
        if (!sel) return;
        const s = String(sigla).toUpperCase();
        const opts = Array.from(sel.options);
        const found = opts.find(o => o.value && String(o.value).toUpperCase() === s);
        if (found) { sel.value = found.value; return; }
        const byLabel = opts.find(o => o.textContent && String(o.textContent).toUpperCase().indexOf(s) >= 0);
        if (byLabel) { sel.value = byLabel.value; return; }
        const opt = document.createElement('option');
        opt.value = sigla;
        opt.textContent = s === 'PY' ? 'Paraguai' : s === 'AR' ? 'Argentina' : s === 'UY' ? 'Uruguai' : sigla;
        sel.appendChild(opt);
        sel.value = sigla;
      }
      setPaisSelect(selOrigemPais, origemPais);
      setPaisSelect(selDestinoPais, destinoPais);

      const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
      if (tabMapa && tabMapa.classList.contains('active')) {
        await new Promise(resolve => setTimeout(resolve, 200));
        await atualizarMapa();
      }
      if (roteiroId) await carregarResumoRota(roteiroId);
    } finally {
      await new Promise(r => setTimeout(r, 0));
      window._settingPaisFromRoteiro = false;
      preenchendoFromRoteiro = false;
    }
  });

  // Event listener para o botão calcular distância
  document.getElementById('btnCalcularDistancia')?.addEventListener('click', calcularDistancia);

  // Eventos de filtros para roteiros
  document.getElementById('filtroOrigemEstado')?.addEventListener('change', function() {
    const estado = this.value;
    if (estado) {
      // Atualizar cidades de origem no filtro
      fetch(`/api/cidades-por-estado/${estado}`)
        .then(r => r.json())
        .then(cidades => {
          const cidadeInput = document.getElementById('filtroOrigemCidade');
          // Mantém como input de texto para busca parcial
        });
    }
  });

  document.getElementById('filtroDestinoEstado')?.addEventListener('change', function() {
    const estado = this.value;
    if (estado) {
      // Atualizar cidades de destino no filtro
      fetch(`/api/cidades-por-estado/${estado}`)
        .then(r => r.json())
        .then(cidades => {
          const cidadeInput = document.getElementById('filtroDestinoCidade');
          // Mantém como input de texto para busca parcial
        });
    }
  });

  // Função para carregar e exibir resumo da rota
  async function carregarResumoRota(roteiroId) {
    try {
      if (!roteiroId || roteiroId === '') {
        // Ocultar container se não houver roteiro
        const container = document.getElementById('resumoRotaContainer');
        if (container) {
          container.style.display = 'none';
        }
        return;
      }
      
      const response = await fetch(`/api/roteiros/${roteiroId}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar roteiro');
      }
      
      const roteiro = await response.json();
      const resumoRota = document.getElementById('resumoRota');
      const container = document.getElementById('resumoRotaContainer');
      
      if (roteiro.RESUMOROTA && roteiro.RESUMOROTA.trim() !== '') {
        // Exibir resumo formatado
        if (resumoRota) {
          resumoRota.textContent = roteiro.RESUMOROTA;
        }
        if (container) {
          container.style.display = 'block';
        }
        
        // Configurar botões de copiar e compartilhar
        configurarBotoesResumo(roteiro.RESUMOROTA);
      } else {
        // Ocultar se não houver resumo
        if (container) {
          container.style.display = 'none';
        }
      }
    } catch (err) {
    console.warn('Erro ao carregar resumo da rota:', err);
    const container = document.getElementById('resumoRotaContainer');
    if (container) {
      container.style.display = 'none';
    }
  }

  // Função para configurar botão de copiar resumo
  function configurarBotoesResumo(textoResumo) {
    const btnCopiar = document.getElementById('btnCopiarResumo');
    
    if (btnCopiar) {
      btnCopiar.onclick = async () => {
        try {
          // Copiar para área de transferência
          await navigator.clipboard.writeText(textoResumo);
          
          // Feedback visual
          const textoOriginal = btnCopiar.innerHTML;
          btnCopiar.innerHTML = '✅ Copiado!';
          btnCopiar.style.background = '#2ecc71';
          btnCopiar.style.borderColor = '#2ecc71';
          
          // Mostrar mensagem de sucesso
          showMessage('Resumo da rota copiado para a área de transferência!', 'success');
          
          // Restaurar botão após 2 segundos
          setTimeout(() => {
            btnCopiar.innerHTML = textoOriginal;
            btnCopiar.style.background = '';
            btnCopiar.style.borderColor = '';
          }, 2000);
        } catch (err) {
          console.error('Erro ao copiar:', err);
          // Fallback para navegadores antigos
          const textArea = document.createElement('textarea');
          textArea.value = textoResumo;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            showMessage('Resumo da rota copiado!', 'success');
          } catch (e) {
            showMessage('Erro ao copiar. Tente selecionar o texto manualmente.', 'error');
          }
          document.body.removeChild(textArea);
        }
      };
    }
  }
}

  // Carregar todos os roteiros para o filtro
  async function loadRoteirosParaFiltro() {
    try {
      const response = await fetch('/api/roteiros-combo', { headers: getAuthHeaders() });
      if (response.ok) {
        const roteiros = await response.json();
        const filtroRoteiroSelect = document.getElementById('filtroRoteiro');
        if (filtroRoteiroSelect) {
          filtroRoteiroSelect.innerHTML = '<option value="">Todos</option>';
          roteiros.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.IDROTEIRO;
            opt.textContent = `${r.IDROTEIRO} - ${r.DSROTEIRO}`;
            filtroRoteiroSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar roteiros para filtro:', err);
    }
  }

  // Evento para atualizar descrição do roteiro no filtro
  document.getElementById('filtroRoteiro')?.addEventListener('change', function() {
    const roteiroId = this.value;
    if (roteiroId) {
      fetch(`/api/roteiros-combo?roteiro=${roteiroId}`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(roteiros => {
          if (roteiros.length > 0) {
            document.getElementById('filtroRoteiroDescricao').value = roteiros[0].DSROTEIRO;
          } else {
            document.getElementById('filtroRoteiroDescricao').value = '';
          }
        });
    } else {
      document.getElementById('filtroRoteiroDescricao').value = '';
    }
  });

  // Usar showMessage do utils.js se disponível, senão usar função local
  // Nota: utils.js é carregado globalmente no dashboard.html
  const showMessage = (text, type, messageElement = null, fieldId = null) => {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, messageElement || message, fieldId);
    } else if (message) {
      message.textContent = text;
      message.className = `message ${type} show`;
      setTimeout(() => message.className = 'message', 5000);
    }
  };

  // Função para obter coordenadas de uma cidade usando API do backend
  async function obterCoordenadasCidade(nomeCidade, estado) {
    try {
      if (!nomeCidade || !estado) {
        console.warn('[Coordenadas] Cidade ou estado não fornecidos:', { nomeCidade, estado });
        return null;
      }
      
      const params = new URLSearchParams({
        cidade: nomeCidade.trim(),
        estado: estado.trim()
      });
      
      const url = `/api/cidades/coordenadas?${params.toString()}`;
      _log('[Coordenadas] Buscando coordenadas para:', nomeCidade, estado);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: `Erro HTTP ${response.status}: ${response.statusText}` };
        }
        console.error(`[Coordenadas] Erro ${response.status} ao buscar coordenadas de ${nomeCidade}/${estado}:`, errorData);
        return null;
      }
      
      const data = await response.json();
      
      if (data.success && data.lat && data.lon) {
        _log(`[Coordenadas] ✅ Coordenadas encontradas para ${nomeCidade}/${estado}:`, data.lat, data.lon);
        return {
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lon)
        };
      }
      
      if (data.success === false) {
        console.warn(`[Coordenadas] ⚠️ API retornou success: false para ${nomeCidade}/${estado}:`, data.error);
      } else {
        console.warn(`[Coordenadas] ⚠️ Resposta inválida para ${nomeCidade}/${estado}:`, data);
      }
      
      return null;
    } catch (err) {
      console.error(`[Coordenadas] ❌ Erro ao obter coordenadas de ${nomeCidade}/${estado}:`, err);
      return null;
    }
  }

  // Função para calcular distância usando fórmula de Haversine (em km)
  function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distancia = R * c;
    
    return Math.round(distancia * 100) / 100; // Arredondar para 2 casas decimais
  }

  // Função para calcular distância usando OSRM (rota real)
  async function calcularDistanciaOSRM(coords) {
    try {
      const coordsStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
      const config = window.MAP_CONFIG || {};
      const osrmUrl = construirUrlRota(
        servidorParaFetchDiretoOsrm(config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv'),
        coordsStr,
        'full',
        'geojson'
      );
      let data = null;
      try {
        data = await fetchRotaOsrmViaBackend(coordsStr, Math.min((config.routeTimeout || 15000) + 10000, 45000));
      } catch (proxyErr) {
        data = null;
      }
      if (!data || !data.code || data.code !== 'Ok') {
        try {
          const response = await fetchForcandoHTTP(osrmUrl, { signal: AbortSignal.timeout(config.routeTimeout || 15000) });
          const raw = await response.json();
          data = normalizarJsonRotaGateway(raw) || raw;
        } catch (e) {
          data = data || null;
        }
      }
      
      if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
        return parseFloat((data.routes[0].distance / 1000).toFixed(2));
      }
      return null;
    } catch (err) {
      // Erro ao calcular distância com OSRM
      return null;
    }
  }

  // Função para calcular distância entre origem e destino
  async function calcularDistancia() {
    const origemCidadeId = document.getElementById('viagemOrigemCidade')?.value;
    const destinoCidadeId = document.getElementById('viagemDestinoCidade')?.value;
    const origemEstado = document.getElementById('viagemOrigemEstado')?.value;
    const destinoEstado = document.getElementById('viagemDestinoEstado')?.value;
    const roteiroId = document.getElementById('viagemRoteiro')?.value;
    const btnCalcular = document.getElementById('btnCalcularDistancia');
    const campoDistancia = document.getElementById('viagemDistancia');

    // Validações
    if (!origemCidadeId || !destinoCidadeId) {
      showMessage('Selecione a cidade de origem e destino antes de calcular.', 'error');
      return;
    }

    if (!origemEstado || !destinoEstado) {
      showMessage('Selecione os estados de origem e destino antes de calcular.', 'error');
      return;
    }

    if (origemCidadeId === destinoCidadeId) {
      /** Ida e volta: calcula pelos pontos do roteiro, se houver. */
      if (roteiroId) {
        // fall through to the points-based calculation below
      } else {
        showMessage(
          'Origem e destino na mesma cidade (ida e volta): selecione o roteiro com pontos cadastrados para calcular a distância.',
          'warning'
        );
        return;
      }
    }

    // Mostrar loading
    if (btnCalcular && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnCalcular, true);
    }
    btnCalcular.disabled = true;

    try {
      let distancia = null;

      // Se houver roteiro selecionado, calcular usando os pontos do roteiro
      if (roteiroId) {
        showMessage('Calculando distância usando pontos do roteiro...', 'success');
        
        try {
          // Buscar pontos do roteiro
          const pontosResponse = await fetch(`/api/roteiros/${roteiroId}/pontos`);
          if (pontosResponse.ok) {
            const pontos = await pontosResponse.json();
            
            // Filtrar pontos com coordenadas e ordenar por ORDEM
            const pontosComCoordenadas = pontos
              .filter(p => p.LATITUDE && p.LONGITUDE)
              .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
            
            if (pontosComCoordenadas.length >= 2) {
              // Criar lista de coordenadas para OSRM
              const coords = pontosComCoordenadas.map(p => ({
                lat: parseFloat(p.LATITUDE),
                lon: parseFloat(p.LONGITUDE)
              }));
              
              // Calcular distância usando OSRM com todos os pontos
              distancia = await calcularDistanciaOSRM(coords);
              
              if (distancia) {
                if (campoDistancia) {
                  campoDistancia.value = distancia;
                  showMessage(`Distância calculada pelo roteiro: ${distancia} km`, 'success');
                }
              } else {
                // Fallback: usar Haversine se OSRM falhar
                const primeira = pontosComCoordenadas[0];
                const ultima = pontosComCoordenadas[pontosComCoordenadas.length - 1];
                distancia = calcularDistanciaHaversine(
                  primeira.LATITUDE,
                  primeira.LONGITUDE,
                  ultima.LATITUDE,
                  ultima.LONGITUDE
                );
                if (campoDistancia) {
                  campoDistancia.value = distancia;
                  showMessage(`Distância calculada (aproximada): ${distancia} km`, 'success');
                }
              }
            } else {
              showMessage('O roteiro selecionado não possui pontos suficientes com coordenadas.', 'error');
            }
          } else {
            showMessage('Erro ao buscar pontos do roteiro. Calculando entre origem e destino...', 'error');
            // Continuar para calcular entre origem e destino
          }
        } catch (err) {
          console.error('Erro ao buscar pontos do roteiro:', err);
          showMessage('Erro ao buscar pontos do roteiro. Calculando entre origem e destino...', 'error');
          // Continuar para calcular entre origem e destino
        }
      }

      // Se não calculou pelo roteiro, calcular entre origem e destino usando OSRM
      if (!distancia) {
        showMessage('Calculando distância pela rota real...', 'success');
        
        // Buscar informações das cidades
        const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
        const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

        if (!origemCidade || !destinoCidade) {
          showMessage('Erro ao obter informações das cidades selecionadas.', 'error');
          return;
        }

        // Obter coordenadas
        const [coordsOrigem, coordsDestino] = await Promise.all([
          obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
          obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
        ]);

        if (!coordsOrigem) {
          showMessage(`Não foi possível encontrar as coordenadas da cidade de origem: ${origemCidade.NMCIDADE}, ${origemEstado}. Verifique se o nome da cidade está correto.`, 'error');
          return;
        }

        if (!coordsDestino) {
          showMessage(`Não foi possível encontrar as coordenadas da cidade de destino: ${destinoCidade.NMCIDADE}, ${destinoEstado}. Verifique se o nome da cidade está correto.`, 'error');
          return;
        }

        // Calcular distância usando OSRM (rota real)
        distancia = await calcularDistanciaOSRM([coordsOrigem, coordsDestino]);
        
        if (distancia) {
          if (campoDistancia) {
            campoDistancia.value = distancia;
            showMessage(`Distância calculada pela rota real: ${distancia} km`, 'success');
          }
        } else {
          // Fallback: usar Haversine se OSRM falhar
          distancia = calcularDistanciaHaversine(
            coordsOrigem.lat,
            coordsOrigem.lon,
            coordsDestino.lat,
            coordsDestino.lon
          );
          if (campoDistancia) {
            campoDistancia.value = distancia;
            showMessage(`Distância calculada (aproximada): ${distancia} km`, 'success');
          }
        }
      }

      // Atualizar mapa se a aba mapa estiver ativa
      const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
      if (tabMapa && tabMapa.classList.contains('active')) {
        await atualizarMapa();
      }

    } catch (err) {
      console.error('Erro ao calcular distância:', err);
      showMessage('Erro ao calcular distância. Tente novamente.', 'error');
    } finally {
      // Remover loading
      if (btnCalcular && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnCalcular, false);
      }
      btnCalcular.disabled = false;
    }
  }

  // Função para inicializar o mapa
  // Flag para controlar inicialização do mapa
  let mapaInicializando = false;
  let mapaInitTentativas = 0;

  function destruirMapaNoContainer(mapaDiv) {
    if (mapa) {
      try {
        mapa.off();
        mapa.remove();
      } catch (e) {
        /* ignore */
      }
      mapa = null;
    }
    if (!mapaDiv) return;
    try {
      mapaDiv.innerHTML = '';
    } catch (e) {
      /* ignore */
    }
    try {
      delete mapaDiv._leaflet_id;
    } catch (e) {
      mapaDiv._leaflet_id = undefined;
    }
    // Remove classes leaflet-* deixadas por init anterior
    if (mapaDiv.className && typeof mapaDiv.className === 'string') {
      mapaDiv.className = mapaDiv.className
        .split(/\s+/)
        .filter((c) => c && !c.startsWith('leaflet-'))
        .join(' ');
    }
  }

  async function inicializarMapa() {
    // Sempre garante CSS do Leaflet (mesmo se L já estiver no window)
    const leafletDisponivel = await aguardarLeaflet();
    if (!leafletDisponivel || typeof L === 'undefined') {
      showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
      return false;
    }

    const mapaDiv = document.getElementById('mapaRota');
    if (!mapaDiv) {
      console.warn('Elemento mapaRota não encontrado no DOM');
      return false;
    }
    
    // Se já está inicializado e funcionando, não fazer nada
    if (mapa) {
      try {
        const container = mapa.getContainer();
        if (mapa._loaded && container && container.parentNode === mapaDiv) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            /* ignore */
          }
          return true;
        }
      } catch (e) {
        /* recriar abaixo */
      }
      destruirMapaNoContainer(mapaDiv);
    } else if (mapaDiv._leaflet_id) {
      console.warn('⚠️ [VIAGENS] Container com _leaflet_id órfão — limpando');
      destruirMapaNoContainer(mapaDiv);
    }
    
    // Proteção contra race condition
    if (mapaInicializando) {
      let tentativas = 0;
      while (mapaInicializando && tentativas < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }
      if (mapa) return true;
    }

    mapaInicializando = true;

    try {
      const tabMapa = document.getElementById('tab-mapa');
      if (tabMapa && tabMapa.style.display === 'none') {
        tabMapa.style.display = 'block';
      }
      await new Promise(resolve => setTimeout(resolve, 50));

      // Limpeza final antes de criar (sem recursão)
      destruirMapaNoContainer(mapaDiv);
      await new Promise(resolve => requestAnimationFrame(resolve));

      mapa = L.map(mapaDiv, {
        preferCanvas: false,
        zoomControl: true
      }).setView([-14.2350, -51.9253], 4);

      _log('🗺️ [VIAGENS] Inicializando mapa...');
      
      const tileConfig = window.getTileLayerConfig ? window.getTileLayerConfig() : {
        url: window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png'),
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      
      const tileOptions = {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        updateWhenIdle: false,
        updateWhenZooming: true
      };
      
      if (tileConfig.url && tileConfig.url.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileConfig.url, tileOptions).addTo(mapa);
      _log('✅ [VIAGENS] TileLayer adicionado ao mapa');
      
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa:', e);
          }
        }
      }, 100);
      
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa (segunda tentativa):', e);
          }
        }
      }, 300);
      
      mapaInitTentativas = 0;
      mapaInicializando = false;
      return true;
    } catch (err) {
      console.error('Erro ao inicializar mapa:', err);
      destruirMapaNoContainer(mapaDiv);
      mapaInicializando = false;

      // Uma única retentativa (sem recursão infinita)
      const msg = (err && err.message) ? String(err.message) : '';
      if (mapaInitTentativas < 1 && (msg.includes('already initialized') || msg.includes('Maximum call stack'))) {
        mapaInitTentativas += 1;
        await new Promise(resolve => setTimeout(resolve, 150));
        return await inicializarMapa();
      }

      mapaInitTentativas = 0;
      showMessage(
        'Erro ao inicializar o mapa' + (msg ? ': ' + msg : '. Tente recarregar o módulo.'),
        'error'
      );
      return false;
    }
  }

  // Função para limpar completamente o mapa (marcadores e rotas)
  // Variável global para armazenar marcadores dos pontos do roteiro
  let marcadoresPontosRoteiro = [];
  
  function limparMapa() {
    if (!mapa || typeof L === 'undefined') return;
    
    _log('🗺️ [LIMPAR MAPA] Iniciando limpeza completa do mapa...');
    
    // Remover todos os marcadores dos pontos do roteiro
    if (marcadoresPontosRoteiro && marcadoresPontosRoteiro.length > 0) {
      _log(`🗺️ [LIMPAR MAPA] Removendo ${marcadoresPontosRoteiro.length} marcadores dos pontos do roteiro...`);
      marcadoresPontosRoteiro.forEach((marcador, index) => {
        try {
          if (marcador && mapa.hasLayer(marcador)) {
            mapa.removeLayer(marcador);
          }
        } catch (e) {
          console.warn(`🗺️ [LIMPAR MAPA] Erro ao remover marcador ${index}:`, e);
        }
      });
      marcadoresPontosRoteiro = []; // Limpar array
    }
    
    // Remover todos os marcadores e rotas
    if (marcadorOrigem) {
      try {
        if (mapa.hasLayer(marcadorOrigem)) {
          mapa.removeLayer(marcadorOrigem);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorOrigem = null;
    }
    if (marcadorDestino) {
      try {
        if (mapa.hasLayer(marcadorDestino)) {
          mapa.removeLayer(marcadorDestino);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorDestino = null;
    }
    if (linhaRota) {
      try {
        if (mapa.hasLayer(linhaRota)) {
          mapa.removeLayer(linhaRota);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      linhaRota = null;
    }
    
    // Remover TODAS as camadas que não sejam os tiles base (garantia extra)
    try {
      const layersToRemove = [];
      mapa.eachLayer((layer) => {
        // Não remover tile layers (base do mapa)
        if (!(layer instanceof L.TileLayer)) {
          layersToRemove.push(layer);
        }
      });
      
      layersToRemove.forEach((layer) => {
        try {
          mapa.removeLayer(layer);
        } catch (e) {
          // Ignorar erro
        }
      });
      
      if (layersToRemove.length > 0) {
        _log(`🗺️ [LIMPAR MAPA] Removidas ${layersToRemove.length} camadas adicionais`);
      }
    } catch (e) {
      console.warn('🗺️ [LIMPAR MAPA] Erro ao limpar camadas:', e);
    }
    
    // Resetar view para o Brasil
    try {
      mapa.setView([-14.2350, -51.9253], 4);
    } catch (e) {
      // Ignorar erro se o mapa não estiver inicializado
    }
    
    _log('✅ [LIMPAR MAPA] Limpeza completa finalizada');
  }

  // Funções para controlar overlay de carregamento do mapa
  function showMapaLoading(titulo = 'Carregando Mapa', texto = 'Preparando visualização da rota...') {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
    const overlay = document.getElementById('mapaLoadingOverlay');
    const titleEl = document.getElementById('mapaLoadingTitle');
    const textEl = document.getElementById('mapaLoadingText');
    if (overlay) {
      if (titleEl) titleEl.textContent = titulo;
      if (textEl) textEl.textContent = texto;
      overlay.style.display = 'flex';
      window.overlayMostrado = true;
    }
  }

  function hideMapaLoading() {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
    const overlay = document.getElementById('mapaLoadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      window.overlayMostrado = false;
    }
  }

  // Função para atualizar o mapa com origem e destino
  async function atualizarMapa() {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
    // Verificar se Leaflet está disponível
    if (typeof L === 'undefined') {
      console.error('Leaflet não está carregado.');
      showMessage('Aguarde o carregamento da biblioteca de mapas...', 'error');
      return;
    }

    // SEMPRE limpar o mapa antes de atualizar com novos dados
    limparMapa();

    const origemCidadeId = document.getElementById('viagemOrigemCidade')?.value;
    const destinoCidadeId = document.getElementById('viagemDestinoCidade')?.value;
    const origemEstado = document.getElementById('viagemOrigemEstado')?.value;
    const destinoEstado = document.getElementById('viagemDestinoEstado')?.value;
    const roteiroId = document.getElementById('viagemRoteiro')?.value;
    const viagemId = document.getElementById('viagemId')?.value;

    // Log para debug - verificar quais valores estão sendo usados
    _log('[MAPA] Valores do formulário:', {
      viagemId: viagemId,
      origemCidadeId: origemCidadeId,
      destinoCidadeId: destinoCidadeId,
      origemEstado: origemEstado,
      destinoEstado: destinoEstado,
      roteiroId: roteiroId
    });

    // Validar: com roteiro basta o ID (pontos vêm da API); sem roteiro precisa origem e destino (cidade)
    const temRoteiro = roteiroId && String(roteiroId).trim() !== '';
    const temOrigemDestino = origemCidadeId && destinoCidadeId;
    if (!temRoteiro && !temOrigemDestino) {
      console.warn('[MAPA] ⚠️ Dados incompletos para exibir rota. Selecione um roteiro ou origem e destino (cidade).', {
        origemCidadeId: !origemCidadeId,
        destinoCidadeId: !destinoCidadeId,
        roteiroId: !roteiroId
      });
      if (mapa) limparMapa();
      return;
    }

    // Mostrar overlay de carregamento (padrão Gerenciar Cidades)
    showMapaLoading('Carregando Mapa', 'Preparando visualização...');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Inicializar mapa se ainda não foi inicializado
    if (!mapa) {
      const inicializado = await inicializarMapa();
      if (!inicializado) {
        hideMapaLoading();
        console.error('Mapa não foi inicializado após tentativa');
        return;
      }
    }
    
    // Invalidar tamanho antes de atualizar usando requestAnimationFrame (sem delay)
    if (mapa) {
      requestAnimationFrame(() => {
        try {
          mapa.invalidateSize();
        } catch (e) {
          console.warn('Erro ao invalidar tamanho do mapa:', e);
        }
      });
    }

    try {
      // Se houver roteiro selecionado, buscar e exibir os pontos do roteiro
      if (roteiroId) {
        showMapaLoading('Carregando Pontos', 'Buscando pontos do roteiro...');
        try {
          const pontosResponse = await fetch(`/api/roteiros/${roteiroId}/pontos`);
          if (pontosResponse.ok) {
            const pontos = await pontosResponse.json();
            
            // Filtrar pontos com coordenadas e ordenar por ORDEM
            const pontosComCoordenadas = pontos
              .filter(p => p.LATITUDE && p.LONGITUDE)
              .sort((a, b) => {
                // Converter ORDEM para número para ordenação correta
                const ordemA = parseFloat(a.ORDEM) || 0;
                const ordemB = parseFloat(b.ORDEM) || 0;
                return ordemA - ordemB;
              });
            
            // Log removido para reduzir verbosidade
            
            if (pontosComCoordenadas.length >= 2) {
              // IMPORTANTE: Limpar marcadores anteriores antes de criar novos
              if (marcadoresPontosRoteiro && marcadoresPontosRoteiro.length > 0) {
                _log('🗺️ [ROTEIROS] Limpando marcadores anteriores dos pontos do roteiro...');
                marcadoresPontosRoteiro.forEach(m => {
                  try {
                    if (m && mapa.hasLayer(m)) {
                      mapa.removeLayer(m);
                    }
                  } catch (e) {
                    // Ignorar
                  }
                });
                marcadoresPontosRoteiro = [];
              }

              const marcadores = [];
              let latlngs = [];

              if (window.AtlasRoteiroMapMarkers && typeof window.AtlasRoteiroMapMarkers.addPontosMarkers === 'function') {
                const res = window.AtlasRoteiroMapMarkers.addPontosMarkers(mapa, pontosComCoordenadas);
                (res.markers || []).forEach((m) => {
                  marcadores.push(m);
                  marcadoresPontosRoteiro.push(m);
                });
                latlngs = res.latlngs || [];
              } else {
                console.warn('[MAPA VIAGENS] AtlasRoteiroMapMarkers indisponível');
                pontosComCoordenadas.forEach((p) => {
                  if (p.LATITUDE && p.LONGITUDE) latlngs.push([Number(p.LATITUDE), Number(p.LONGITUDE)]);
                });
              }
              
              // Atualizar mensagem do overlay
              showMapaLoading('Traçando Rota', 'Calculando rota real entre os pontos...');
              
              // Desenhar rota usando OSRM com todos os pontos
              let data = null;
              let osrmSucesso = false;
              let routeLatLngs = [];
              
              try {
                const config = window.MAP_CONFIG || {};
                /** true se algum trecho usou linha reta (proxy/OSRM falharam) — estilo/aviso no mapa */
                let rotaAlgumTrechoLinhaReta = false;

                // Função helper para normalizar URL do OSRM (garantir HTTP para servidor próprio)
                function normalizarOSRMUrl(servidor) {
                  if (!servidor) return 'https://router.project-osrm.org/route/v1/driving-hgv';
                  // Se for servidor próprio, garantir que use HTTP (não HTTPS)
                  const servidoresProprios = ['186.250.92.131'];
                  const isServidorProprio = servidoresProprios.some(s => servidor.includes(s));
                  
                  if (isServidorProprio) {
                    let normalized = servidor.replace(/^https:/, 'http:');
                    normalized = normalized.replace(/https:\/\//, 'http://');
                    
                    // Verificar se ainda está em HTTPS
                    if (normalized.startsWith('https:')) {
                      normalized = 'http:' + normalized.substring(6);
                    }
                    
                    if (normalized !== servidor) {
                      _log('🔄 [OSRM] Normalizando URL:', servidor, '→', normalized);
                    }
                    return normalized;
                  }
                  return servidor;
                }
                
                // Se houver muitos pontos (mais de 5), calcular rota em segmentos para evitar timeout
                if (latlngs.length > 5) {
                  _log('[MAPA] Muitos pontos detectados (' + latlngs.length + '), calculando rota em segmentos...');
                  
                  // Função auxiliar para tentar obter rota de um segmento com retry
                  async function obterRotaSegmento(segmento, servidor, tentativa = 1) {
                    const coordsStr = segmento.map(c => `${c[1]},${c[0]}`).join(';');
                    
                    // IMPORTANTE: Normalizar servidor ANTES de construir URL
                    let servidorNormalizado = servidor;
                    const servidoresProprios = ['186.250.92.131'];
                    const isServidorProprio = servidoresProprios.some(s => servidor && servidor.includes(s));
                    
                    if (isServidorProprio) {
                      servidorNormalizado = servidor.replace(/^https:/, 'http:');
                      servidorNormalizado = servidorNormalizado.replace(/https:\/\//, 'http://');
                      if (servidorNormalizado !== servidor) {
                        _log('🔄 [OSRM] Normalizando URL:', servidor, '→', servidorNormalizado);
                      }
                    }
                    
                    // IMPORTANTE: Usar construirUrlRota que já normaliza corretamente
                    const osrmUrl = construirUrlRota(servidorParaFetchDiretoOsrm(servidorNormalizado), coordsStr, 'full', 'geojson');
                    
                    // Verificar e corrigir URL antes de fazer fetch
                    let urlFinal = osrmUrl;
                    // Reutilizar servidoresProprios já declarado acima
                    const isServidorProprioUrl = servidoresProprios.some(s => osrmUrl.includes(s));
                    
                    if (isServidorProprioUrl && osrmUrl.startsWith('https:')) {
                      urlFinal = osrmUrl.replace(/^https:/, 'http:');
                      console.warn('⚠️ [OSRM] URL corrigida de HTTPS para HTTP:', osrmUrl.substring(0, 80), '→', urlFinal.substring(0, 80));
                    }
                    
                    // Verificar novamente após correção
                    if (isServidorProprioUrl && urlFinal.startsWith('https:')) {
                      console.error('❌ [OSRM] ERRO CRÍTICO: URL ainda está em HTTPS após correção!', urlFinal);
                      urlFinal = 'http:' + urlFinal.substring(6); // Forçar HTTP
                    }
                    
                    try {
                      try {
                        const segmentData = await fetchRotaOsrmViaBackend(coordsStr, 110000);
                        if (segmentData && segmentData.code === 'Ok' && segmentData.routes && segmentData.routes[0] && segmentData.routes[0].geometry) {
                          const segmentGeometry = segmentData.routes[0].geometry.coordinates;
                          return segmentGeometry.map(c => [c[1], c[0]]);
                        }
                      } catch (proxyErr) {
                        _log('[MAPA] Proxy rota (segmento) falhou, tentando direto:', proxyErr && proxyErr.message);
                      }
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 90000);
                      
                      _log('🌐 [OSRM] Fazendo fetch para:', urlFinal.substring(0, 100) + '...');
                      const response = await fetchForcandoHTTP(urlFinal, { signal: controller.signal });
                      clearTimeout(timeoutId);
                      
                      if (response.ok) {
                        const rawSeg = await response.json();
                        const segmentData = normalizarJsonRotaGateway(rawSeg) || rawSeg;
                        if (segmentData.code === 'Ok' && segmentData.routes && segmentData.routes[0] && segmentData.routes[0].geometry) {
                          const segmentGeometry = segmentData.routes[0].geometry.coordinates;
                          return segmentGeometry.map(c => [c[1], c[0]]); // Converter [lon, lat] para [lat, lon]
                        }
                      }
                      throw new Error(`Resposta inválida: ${response.status}`);
                    } catch (err) {
                      if (tentativa < 2 && err.name !== 'AbortError') {
                        // Tentar novamente após 1 segundo
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return obterRotaSegmento(segmento, servidor, tentativa + 1);
                      }
                      throw err;
                    }
                  }
                  
                  // Calcular rota segmento por segmento
                  for (let i = 0; i < latlngs.length - 1; i++) {
                    const segmento = [latlngs[i], latlngs[i + 1]];
                    let segmentRoute = null;
                    
                    // Verificar se estamos em ambiente de desenvolvimento (localhost)
                    // Em desenvolvimento, usar diretamente o servidor público para evitar erros de HSTS
                    const isLocalhost = window.location.hostname === 'localhost' || 
                                       window.location.hostname === '127.0.0.1' ||
                                       window.location.hostname.startsWith('192.168.');
                    
                    // Tentar primeiro com servidor principal (apenas se não for localhost)
                    if (!isLocalhost) {
                      try {
                        const osrmServerOriginal = config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv';
                        const osrmServerPrincipal = normalizarOSRMUrl(osrmServerOriginal);
                        _log(`🔄 [OSRM] Segmento ${i + 1}: usando servidor`, osrmServerPrincipal);
                        segmentRoute = await obterRotaSegmento(segmento, osrmServerPrincipal);
                        _log(`[MAPA] Segmento ${i + 1}/${latlngs.length - 1} calculado com sucesso`);
                      } catch (err) {
                        // Se falhar, tentar com servidor alternativo
                        console.warn(`[MAPA] Segmento ${i + 1} falhou no servidor principal, tentando alternativo...`);
                        try {
                          // Usar servidor público que está permitido no CSP
                          const osrmServerAlt = 'https://router.project-osrm.org/route/v1/driving-hgv';
                          segmentRoute = await obterRotaSegmento(segmento, osrmServerAlt);
                          _log(`[MAPA] Segmento ${i + 1}/${latlngs.length - 1} calculado com servidor alternativo`);
                        } catch (err2) {
                          console.warn(`[MAPA] Segmento ${i + 1} falhou em ambos servidores, usando linha reta`);
                          segmentRoute = segmento;
                          rotaAlgumTrechoLinhaReta = true;
                        }
                      }
                    } else {
                      // Em localhost, usar diretamente o servidor público
                      try {
                        const osrmServerAlt = 'https://router.project-osrm.org/route/v1/driving-hgv';
                        _log(`🔄 [OSRM] Segmento ${i + 1}: usando servidor público (localhost)`, osrmServerAlt);
                        segmentRoute = await obterRotaSegmento(segmento, osrmServerAlt);
                        _log(`[MAPA] Segmento ${i + 1}/${latlngs.length - 1} calculado com sucesso`);
                      } catch (err) {
                        console.warn(`[MAPA] Segmento ${i + 1} falhou, usando linha reta`);
                        segmentRoute = segmento;
                        rotaAlgumTrechoLinhaReta = true;
                      }
                    }
                    
                    // Adicionar segmento à rota total (evitar duplicar o último ponto)
                    if (i === 0) {
                      routeLatLngs.push(...segmentRoute);
                    } else {
                      // Se o segmento anterior tinha mais de 2 pontos, é uma rota real
                      // Se não, é linha reta e precisamos adicionar o ponto final
                      if (segmentRoute.length > 2) {
                        routeLatLngs.push(...segmentRoute.slice(1)); // Pular primeiro ponto
                      } else {
                        routeLatLngs.push(segmentRoute[segmentRoute.length - 1]); // Adicionar último ponto
                      }
                    }
                    
                    // Pequeno delay entre segmentos (proxy já serializa no servidor)
                    if (i < latlngs.length - 2) {
                      await new Promise(resolve => setTimeout(resolve, 150));
                    }
                  }
                  
                  // Verificar se conseguiu calcular pelo menos alguns segmentos
                  // Se tem mais pontos que os originais, conseguiu calcular rotas reais
                  osrmSucesso = routeLatLngs.length > latlngs.length;
                  
                  // Se não conseguiu calcular nenhuma rota real, mas tem pontos, ainda é melhor que nada
                  if (!osrmSucesso && routeLatLngs.length > 0) {
                    console.warn('[MAPA] ⚠️ Alguns segmentos falharam, mas a rota será desenhada com os segmentos disponíveis');
                    osrmSucesso = true; // Permitir desenhar mesmo com alguns segmentos em linha reta
                  }
                } else {
                  // Poucos pontos na lista: com 3+ waypoints uma única chamada ao proxy costuma 502 (~35s×mirrors).
                  const coordsStr = latlngs.map(c => `${c[1]},${c[0]}`).join(';');
                  const routeMs = config.routeTimeout || 30000;
                  const osrmUrl = construirUrlRota(
                    servidorParaFetchDiretoOsrm(config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv'),
                    coordsStr,
                    'full',
                    'geojson'
                  );

                  if (latlngs.length > 2) {
                    _log(`[MAPA] ${latlngs.length} pontos: rota por trechos (proxy → OSRM direto → LR só no trecho).`);
                    let mergedLl = [];
                    let totalDistM = 0;
                    const osrmPublicDriving = 'https://router.project-osrm.org/route/v1/driving';
                    for (let si = 0; si < latlngs.length - 1; si++) {
                      const segStr = `${latlngs[si][1]},${latlngs[si][0]};${latlngs[si + 1][1]},${latlngs[si + 1][0]}`;
                      let segData = null;
                      try {
                        segData = await fetchRotaOsrmViaBackend(segStr, 55000);
                      } catch (e) {
                        _log('[MAPA] Trecho proxy ' + (si + 1) + ':', e && e.message);
                      }
                      if (!segData || segData.code !== 'Ok' || !segData.routes || !segData.routes[0]) {
                        try {
                          const segOsrmUrl = construirUrlRota(
                            servidorParaFetchDiretoOsrm(config.osrmServer || osrmPublicDriving),
                            segStr,
                            'full',
                            'geojson'
                          );
                          const controller = new AbortController();
                          const timeoutId = setTimeout(() => controller.abort(), 28000);
                          const response = await fetchForcandoHTTP(segOsrmUrl, { signal: controller.signal });
                          clearTimeout(timeoutId);
                          if (response.ok) {
                            const rawSeg = await response.json();
                            segData = normalizarJsonRotaGateway(rawSeg) || rawSeg;
                          }
                        } catch (directErr) {
                          _log('[MAPA] Trecho ' + (si + 1) + ' OSRM direto:', directErr && directErr.message);
                        }
                      }
                      let geom;
                      if (segData && segData.code === 'Ok' && segData.routes && segData.routes[0] && segData.routes[0].geometry) {
                        geom = segData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                        totalDistM += segData.routes[0].distance || 0;
                      } else {
                        rotaAlgumTrechoLinhaReta = true;
                        console.warn('[MAPA] Trecho ' + (si + 1) + '/' + (latlngs.length - 1) + ': sem geometria OSRM — linha reta entre estes waypoints');
                        geom = [latlngs[si], latlngs[si + 1]];
                      }
                      if (mergedLl.length === 0) mergedLl.push(...geom);
                      else mergedLl.push(...geom.slice(1));
                      if (si < latlngs.length - 2) {
                        await new Promise(resolve => setTimeout(resolve, 120));
                      }
                    }
                    routeLatLngs = mergedLl;
                    data = {
                      code: 'Ok',
                      routes: [{ distance: totalDistM, geometry: { coordinates: mergedLl.map((ll) => [ll[1], ll[0]]) } }]
                    };
                    osrmSucesso = true;
                  } else {
                    try {
                      data = await fetchRotaOsrmViaBackend(coordsStr, 55000);
                    } catch (proxyErr) {
                      data = null;
                    }
                    if (!data || data.code !== 'Ok') {
                      try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), Math.max(routeMs, 90000));
                        _log('🌐 [OSRM] Fazendo fetch para:', osrmUrl.substring(0, 100) + '...');
                        const response = await fetchForcandoHTTP(osrmUrl, { signal: controller.signal });
                        clearTimeout(timeoutId);
                        if (response.ok) {
                          data = await response.json();
                        }
                      } catch (e) {
                        _log('[MAPA] OSRM direto (2 pts):', e && e.message);
                        data = null;
                      }
                    }
                    if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
                      const geometry = data.routes[0].geometry.coordinates;
                      routeLatLngs = geometry.map(c => [c[1], c[0]]);
                      osrmSucesso = true;
                    } else {
                      rotaAlgumTrechoLinhaReta = true;
                      routeLatLngs = latlngs.slice();
                      osrmSucesso = true;
                      data = {
                        code: 'Ok',
                        routes: [{
                          distance: 0,
                          geometry: { coordinates: latlngs.map(ll => [ll[1], ll[0]]) }
                        }]
                      };
                      console.warn('[MAPA] Dois pontos: OSRM indisponível — exibindo linha reta (confira login/proxy ou tente de novo).');
                    }
                  }
                }
                
                // Desenhar rota se conseguiu calcular
                if (osrmSucesso && routeLatLngs.length > 0) {
                  // Remover linha anterior se existir
                  if (linhaRota) {
                    mapa.removeLayer(linhaRota);
                  }
                  
                  linhaRota = L.polyline(routeLatLngs, {
                    color: '#3498db',
                    weight: 4,
                    opacity: 0.7
                  }).addTo(mapa);
                  
                  if (data && data.routes && data.routes[0]) {
                    const distM = data.routes[0].distance || 0;
                    const distanciaTotal = distM > 0 ? (distM / 1000).toFixed(2) + ' km' : '—';
                    const avisoTrecho = rotaAlgumTrechoLinhaReta
                      ? '<br><small style="color:#e74c3c">Parte da linha está em linha reta: o roteador (OSRM) falhou em um ou mais trechos — verifique login, rede ou tente de novo.</small>'
                      : '';
                    linhaRota.bindPopup(`<strong>Distância pela rota (OSRM):</strong> ${distanciaTotal}${avisoTrecho}`);
                  }
                  
                  // Log removido
                } else {
                  throw new Error('Não foi possível calcular a rota');
                }
              } catch (err) {
                if (err.name === 'AbortError') {
                  console.warn('[MAPA] ⏱️ Timeout ao obter rota do OSRM');
                } else {
                  console.error('[MAPA] ❌ Erro ao obter rota do OSRM:', err);
                  console.error('[MAPA] Detalhes do erro:', {
                    name: err.name,
                    message: err.message
                  });
                }
                // Fallback: linha reta entre pontos
                if (linhaRota) {
                  mapa.removeLayer(linhaRota);
                }
                linhaRota = L.polyline(latlngs, {
                  color: '#e74c3c',
                  weight: 4,
                  opacity: 0.7,
                  dashArray: '10, 10'
                }).addTo(mapa);
                linhaRota.bindPopup('<strong>Atenção:</strong> Rota em linha reta (erro ao calcular rota real)');
              }
              
              // Processar informações detalhadas da rota (rodovias, cidades, etc.)
              let informacoesRota = await processarInformacoesRotaOSRM(data, pontosComCoordenadas, latlngs);
              
              // Calcular distância total
              let distanciaTotal = null;
              if (data && data.routes && data.routes[0]) {
                // Se OSRM funcionou, usar distância do OSRM
                distanciaTotal = (data.routes[0].distance / 1000).toFixed(2) + ' km';
              } else {
                // Se OSRM falhou, calcular somando as distâncias entre pontos do roteiro
                let distanciaAcumulada = 0;
                pontosComCoordenadas.forEach((ponto, index) => {
                  if (index > 0 && ponto.KMENTREPONTOS) {
                    distanciaAcumulada += parseFloat(ponto.KMENTREPONTOS) || 0;
                  }
                });
                // Se não tiver KMENTREPONTOS, calcular distância Haversine entre pontos consecutivos
                if (distanciaAcumulada === 0 && pontosComCoordenadas.length > 1) {
                  for (let i = 1; i < pontosComCoordenadas.length; i++) {
                    const dist = calcularDistanciaHaversine(
                      pontosComCoordenadas[i-1].LATITUDE,
                      pontosComCoordenadas[i-1].LONGITUDE,
                      pontosComCoordenadas[i].LATITUDE,
                      pontosComCoordenadas[i].LONGITUDE
                    );
                    distanciaAcumulada += dist;
                  }
                }
                distanciaTotal = distanciaAcumulada > 0 ? distanciaAcumulada.toFixed(2) + ' km' : null;
              }
              
              // Distância total calculada
              
              // Atualizar mensagem do overlay
              showMapaLoading('Ajustando Visualização', 'Ajustando zoom para mostrar toda a rota...');
              
              // Ajustar zoom para mostrar todos os pontos
              if (marcadores.length > 0) {
                const grupo = new L.featureGroup(marcadores);
                const bounds = grupo.getBounds();
                if (bounds.pad) {
                  mapa.fitBounds(bounds.pad(0.1));
                } else {
                  const sw = bounds.getSouthWest();
                  const ne = bounds.getNorthEast();
                  const latDiff = (ne.lat - sw.lat) * 0.1;
                  const lngDiff = (ne.lng - sw.lng) * 0.1;
                  const newBounds = L.latLngBounds(
                    [sw.lat - latDiff, sw.lng - lngDiff],
                    [ne.lat + latDiff, ne.lng + lngDiff]
                  );
                  mapa.fitBounds(newBounds);
                }
              }
              
              // Invalidar tamanho múltiplas vezes para garantir renderização correta
              setTimeout(() => {
                if (mapa) {
                  try {
                    mapa.invalidateSize();
                    if (mapa._onResize) {
                      mapa._onResize();
                    }
                  } catch (e) {
                    console.warn('Erro ao invalidar tamanho após ajustar bounds (roteiro):', e);
                  }
                }
              }, 100);
              
              setTimeout(() => {
                if (mapa) {
                  try {
                    mapa.invalidateSize();
                  } catch (e) {
                    // Ignorar erro
                  }
                }
              }, 300);
              
              // Marcadores criados
              
              // Preparar dados para exibição usando informações processadas
              // Buscar informações das cidades das variáveis globais
              const origemCidadeObj = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
              const destinoCidadeObj = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);
              
              _log('[MAPA] Buscando informações das cidades:', {
                origemCidadeId: origemCidadeId,
                destinoCidadeId: destinoCidadeId,
                origemCidadeObj: origemCidadeObj ? `${origemCidadeObj.NMCIDADE}/${origemEstado}` : 'NÃO ENCONTRADA',
                destinoCidadeObj: destinoCidadeObj ? `${destinoCidadeObj.NMCIDADE}/${destinoEstado}` : 'NÃO ENCONTRADA',
                totalCidadesOrigem: cidadesOrigem.length,
                totalCidadesDestino: cidadesDestino.length
              });
              
              // Extrair cidade real da origem (priorizar NMCIDADE, depois DSLOCAL)
              const cidadeOrigem = origemCidadeObj?.NMCIDADE || pontosComCoordenadas[0]?.DSLOCAL?.split(',')[0]?.trim() || pontosComCoordenadas[0]?.DSLOCAL || 'N/A';
              // Extrair cidade real do destino (priorizar NMCIDADE, depois DSLOCAL)
              const cidadeDestino = destinoCidadeObj?.NMCIDADE || pontosComCoordenadas[pontosComCoordenadas.length - 1]?.DSLOCAL?.split(',')[0]?.trim() || pontosComCoordenadas[pontosComCoordenadas.length - 1]?.DSLOCAL || 'N/A';
              
              _log('[MAPA] Cidades extraídas para exibição:', {
                cidadeOrigem: cidadeOrigem,
                cidadeDestino: cidadeDestino
              });
              
              const dadosRota = {
                origem: {
                  cidade: cidadeOrigem,
                  estado: origemEstado || ''
                },
                destino: {
                  cidade: cidadeDestino,
                  estado: destinoEstado || ''
                },
                distancia: distanciaTotal,
                tempoEstimado: data && data.routes && data.routes[0] && data.routes[0].duration 
                  ? Math.round(data.routes[0].duration / 60) + ' minutos' 
                  : null,
                pontosIntercalados: informacoesRota.pontosIntercalados || [],
                rodovias: informacoesRota.rodovias || [],
                cidadesPassagem: informacoesRota.cidadesPassagem || [],
                instrucoes: informacoesRota.instrucoes || [],
                detalhes: [
                  `Rota com ${pontosComCoordenadas.length} ponto(s) de referência`,
                  data && data.routes && data.routes[0] 
                    ? 'Distância total calculada pela rota real (OSRM)' 
                    : 'Distância total calculada pelos pontos do roteiro',
                  data && data.routes && data.routes[0] ? `Tempo estimado de viagem: ${Math.round(data.routes[0].duration / 60)} minutos` : null
                ].filter(d => d !== null)
              };
              
              
              // Esconder overlay após um pequeno delay
              requestAnimationFrame(() => {
                setTimeout(() => {
                  hideMapaLoading();
                }, 300);
              });
              
              return; // Sair da função após exibir pontos do roteiro
            }
          }
        } catch (err) {
          // Erro ao buscar pontos do roteiro, usando origem e destino
          // Continuar para exibir origem e destino
        }
      }
      
      // Se não houver roteiro ou se não conseguiu buscar pontos, usar origem e destino diretos
      // Atualizar mensagem do overlay
      showMapaLoading('Buscando Coordenadas', 'Obtendo localização das cidades...');
      
      // Buscar informações das cidades
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

      if (!origemCidade || !destinoCidade) {
        hideMapaLoading();
        showMessage('Erro ao obter informações das cidades para o mapa.', 'error');
        return;
      }

      // Log para debug - verificar quais cidades estão sendo buscadas
      _log('[MAPA] Buscando coordenadas para:', {
        origem: `${origemCidade.NMCIDADE}, ${origemEstado}`,
        destino: `${destinoCidade.NMCIDADE}, ${destinoEstado}`
      });

      // Obter coordenadas
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
      ]);

      if (!coordsOrigem || !coordsDestino) {
        console.error('[MAPA] ❌ Erro ao obter coordenadas:', {
          origem: coordsOrigem ? 'OK' : 'FALHOU',
          destino: coordsDestino ? 'OK' : 'FALHOU'
        });
        hideMapaLoading();
        showMessage('Não foi possível obter as coordenadas para exibir o mapa.', 'error');
        return;
      }
      
      _log('[MAPA] ✅ Coordenadas obtidas:', {
        origem: coordsOrigem,
        destino: coordsDestino
      });
      
      // Atualizar mensagem do overlay
      showMapaLoading('Montando Rota', 'Criando marcadores e traçando rota...');

      // Criar marcador de origem (verde)
      marcadorOrigem = L.marker([coordsOrigem.lat, coordsOrigem.lon], {
        icon: L.divIcon({
          className: 'custom-marker origem',
          html: '<div style="background: #2ecc71; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">O</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapa)
        .bindPopup(`<strong>Origem:</strong><br>${origemCidade.NMCIDADE}, ${origemEstado}`);

      // Criar marcador de destino (vermelho)
      marcadorDestino = L.marker([coordsDestino.lat, coordsDestino.lon], {
        icon: L.divIcon({
          className: 'custom-marker destino',
          html: '<div style="background: #e74c3c; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">D</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapa)
        .bindPopup(`<strong>Destino:</strong><br>${destinoCidade.NMCIDADE}, ${destinoEstado}`);

      // Atualizar mensagem do overlay
      showMapaLoading('Calculando Rota', 'Obtendo rota real entre origem e destino...');
      
      // Obter rota real usando OSRM (Open Source Routing Machine) com informações detalhadas
      let rotaData = null;
      let informacoesRota = { rodovias: [], cidadesPassagem: [], instrucoes: [], pontosIntercalados: [] };
      try {
        const config = window.MAP_CONFIG || {};
        // Chamada direta ao OSRM (sem steps e annotations para ser mais rápido)
        // Formato OSRM: "lon,lat;lon,lat" (longitude primeiro!)
        const coordsStr = `${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}`;
        const osrmUrl = construirUrlRota(
          servidorParaFetchDiretoOsrm(config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv'),
          coordsStr,
          'full',
          'geojson'
        );
        
        _log('[MAPA] Tentando obter rota do OSRM (origem/destino):', osrmUrl.substring(0, 150) + '...');
        
        // Verificar se URL está correto antes de fazer fetch
        if (osrmUrl.includes('186.250.92.131') && osrmUrl.startsWith('https:')) {
          console.error('❌ [OSRM] ERRO CRÍTICO: URL ainda está em HTTPS!', osrmUrl);
        }
        
        const timeoutRotaMs = 90000;
        try {
          rotaData = await fetchRotaOsrmViaBackend(coordsStr, 110000);
        } catch (proxyErr) {
          rotaData = null;
        }
        if (!rotaData || !rotaData.code || rotaData.code !== 'Ok') {
          // Usar AbortController para timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutRotaMs);
          const rotaResponse = await fetchForcandoHTTP(osrmUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!rotaResponse.ok) {
            throw new Error(`OSRM retornou status ${rotaResponse.status}: ${rotaResponse.statusText}`);
          }
          const rawRota = await rotaResponse.json();
          rotaData = normalizarJsonRotaGateway(rawRota) || rawRota;
        }
        
        // Log removido
        
        // Processar informações detalhadas da rota
        informacoesRota = await processarInformacoesRotaOSRM(rotaData, null, null);
        
        let distanciaRota = null;
        let tempoEstimado = null;
        let rotaDataFinal = null;
        
        if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
          // Remover linha anterior se existir
          if (linhaRota) {
            mapa.removeLayer(linhaRota);
          }
          
          // Usar a rota real obtida do OSRM
          const coordenadasRota = rotaData.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]); // OSRM retorna [lon, lat], Leaflet precisa [lat, lon]
          
          linhaRota = L.polyline(coordenadasRota, {
            color: '#3498db',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
          }).addTo(mapa);
          
          // Calcular distância real da rota
          distanciaRota = (rotaData.routes[0].distance / 1000).toFixed(2); // Converter metros para km
          tempoEstimado = rotaData.routes[0].duration ? Math.round(rotaData.routes[0].duration / 60) + ' minutos' : null;
          rotaDataFinal = rotaData;
          linhaRota.bindPopup(`<strong>Distância da Rota:</strong> ${distanciaRota} km`);
          
          _log('[MAPA] ✅ Rota OSRM desenhada com sucesso (origem/destino)!');
        } else {
          console.warn('[MAPA] ⚠️ OSRM retornou código:', rotaData.code, 'Mensagem:', rotaData.message);
          // Remover linha anterior se existir
          if (linhaRota) {
            mapa.removeLayer(linhaRota);
          }
          // Fallback: usar linha reta se não conseguir obter a rota
          linhaRota = L.polyline(
            [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
            {
              color: '#e74c3c',
              weight: 4,
              opacity: 0.7,
              dashArray: '10, 10'
            }
          ).addTo(mapa);
          
          const distancia = calcularDistanciaHaversine(
            coordsOrigem.lat,
            coordsOrigem.lon,
            coordsDestino.lat,
            coordsDestino.lon
          );
          distanciaRota = distancia.toFixed(2);
          linhaRota.bindPopup(`<strong>Atenção: Distância (linha reta):</strong> ${distanciaRota} km`);
        }
        
        // Preparar dados para exibição usando informações processadas
        const pontosIntercalados = [
          {
            tipo: 'ponto',
            subtipo: 'O',
            ordem: 10,
            local: origemCidade.NMCIDADE || 'N/A',
            posicao: `${origemCidade.NMCIDADE}, ${origemEstado}`,
            distanciaAnterior: null,
            distanciaAcumulada: 0,
            coordenadas: `${coordsOrigem.lat.toFixed(6)}, ${coordsOrigem.lon.toFixed(6)}`
          }
        ];
        
        // Adicionar rodovias se houver
        if (informacoesRota.rodovias && informacoesRota.rodovias.length > 0) {
          informacoesRota.rodovias.forEach((rodovia, idx) => {
            pontosIntercalados.push({
              tipo: 'rodovia',
              nome: rodovia,
              ordem: 15 + idx
            });
          });
        }
        
        pontosIntercalados.push({
          tipo: 'ponto',
          subtipo: 'D',
          ordem: 20,
          local: destinoCidade.NMCIDADE || 'N/A',
          posicao: `${destinoCidade.NMCIDADE}, ${destinoEstado}`,
          distanciaAnterior: distanciaRota ? distanciaRota + ' km' : null,
          distanciaAcumulada: distanciaRota ? parseFloat(distanciaRota) : 0,
          coordenadas: `${coordsDestino.lat.toFixed(6)}, ${coordsDestino.lon.toFixed(6)}`
        });
        
        const dadosRota = {
          origem: {
            cidade: origemCidade.NMCIDADE || 'N/A',
            estado: origemEstado || ''
          },
          destino: {
            cidade: destinoCidade.NMCIDADE || 'N/A',
            estado: destinoEstado || ''
          },
          distancia: distanciaRota ? distanciaRota + ' km' : null,
          tempoEstimado: tempoEstimado,
          pontosIntercalados: pontosIntercalados,
          rodovias: informacoesRota.rodovias || [],
          cidadesPassagem: informacoesRota.cidadesPassagem || [],
          instrucoes: informacoesRota.instrucoes || [],
          pedagios: informacoesRota.pedagios || [],
          detalhes: [
            'Rota direta entre origem e destino',
            distanciaRota ? `Distância total: ${distanciaRota} km` : null,
            tempoEstimado ? `Tempo estimado: ${tempoEstimado}` : null,
            'Consulte o mapa para visualizar o trajeto completo'
          ].filter(d => d !== null)
        };
        
        // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('[MAPA] ⏱️ Timeout ao obter rota do OSRM (origem/destino)');
        } else {
          console.error('[MAPA] ❌ Erro ao obter rota do OSRM:', err);
          console.error('[MAPA] Detalhes do erro:', {
            name: err.name,
            message: err.message,
            stack: err.stack
          });
        }
        // Remover linha anterior se existir
        if (linhaRota) {
          mapa.removeLayer(linhaRota);
        }
        // Fallback: usar linha reta em caso de erro
        linhaRota = L.polyline(
          [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
          {
            color: '#e74c3c',
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 10'
          }
        ).addTo(mapa);
        
        const distancia = calcularDistanciaHaversine(
          coordsOrigem.lat,
          coordsOrigem.lon,
          coordsDestino.lat,
          coordsDestino.lon
        );
        const distanciaRota = distancia.toFixed(2);
        linhaRota.bindPopup(`<strong>Atenção: Distância (linha reta):</strong> ${distanciaRota} km`);
        
        // Preparar dados para exibição (fallback)
        const pontosIntercaladosFallback = [
          {
            tipo: 'ponto',
            subtipo: 'O',
            ordem: 10,
            local: origemCidade.NMCIDADE || 'N/A',
            posicao: `${origemCidade.NMCIDADE}, ${origemEstado}`,
            distanciaAnterior: null,
            distanciaAcumulada: 0,
            coordenadas: `${coordsOrigem.lat.toFixed(6)}, ${coordsOrigem.lon.toFixed(6)}`
          },
          {
            tipo: 'ponto',
            subtipo: 'D',
            ordem: 20,
            local: destinoCidade.NMCIDADE || 'N/A',
            posicao: `${destinoCidade.NMCIDADE}, ${destinoEstado}`,
            distanciaAnterior: distanciaRota + ' km',
            distanciaAcumulada: parseFloat(distanciaRota),
            coordenadas: `${coordsDestino.lat.toFixed(6)}, ${coordsDestino.lon.toFixed(6)}`
          }
        ];
        
        const dadosRota = {
          origem: {
            cidade: origemCidade.NMCIDADE || 'N/A',
            estado: origemEstado || ''
          },
          destino: {
            cidade: destinoCidade.NMCIDADE || 'N/A',
            estado: destinoEstado || ''
          },
          distancia: distanciaRota + ' km',
          tempoEstimado: null,
          pontosIntercalados: pontosIntercaladosFallback,
          rodovias: [],
          cidadesPassagem: [],
          instrucoes: [],
          pedagios: [],
          detalhes: [
            'Rota calculada em linha reta (não foi possível obter rota real)',
            `Distância: ${distanciaRota} km`,
            'Consulte o mapa para visualizar o trajeto'
          ]
        };
        
        // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
      }

      // Atualizar mensagem do overlay
      showMapaLoading('Ajustando Visualização', 'Ajustando zoom para mostrar toda a rota...');
      
      // Ajustar o zoom para mostrar ambas as cidades (sem delay)
      const grupo = new L.featureGroup([marcadorOrigem, marcadorDestino]);
      const bounds = grupo.getBounds();
      // Adicionar padding manualmente se pad() não estiver disponível
      if (bounds.pad) {
        mapa.fitBounds(bounds.pad(0.2));
      } else {
        // Fallback: expandir bounds manualmente
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const latDiff = (ne.lat - sw.lat) * 0.2;
        const lngDiff = (ne.lng - sw.lng) * 0.2;
        const newBounds = L.latLngBounds(
          [sw.lat - latDiff, sw.lng - lngDiff],
          [ne.lat + latDiff, ne.lng + lngDiff]
        );
        mapa.fitBounds(newBounds);
      }
      
      // Invalidar tamanho do mapa múltiplas vezes para garantir renderização correta
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
            if (mapa._onResize) {
              mapa._onResize();
            }
          } catch (e) {
            console.warn('Erro ao invalidar tamanho após ajustar bounds:', e);
          }
        }
      }, 100);
      
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            // Ignorar erro
          }
        }
      }, 300);
      
      // Esconder overlay após um pequeno delay
      requestAnimationFrame(() => {
        setTimeout(() => {
          hideMapaLoading();
          
          // Carregar resumo da rota se houver roteiro selecionado
          const roteiroIdFinal = document.getElementById('viagemRoteiro')?.value;
          if (roteiroIdFinal) {
            carregarResumoRota(roteiroIdFinal);
          } else {
            // Ocultar resumo se não houver roteiro
            const container = document.getElementById('resumoRotaContainer');
            if (container) {
              container.style.display = 'none';
            }
          }
        }, 300);
      });

    } catch (err) {
      hideMapaLoading();
      console.error('Erro ao atualizar mapa:', err);
      showMessage('Erro ao atualizar o mapa. Tente novamente.', 'error');
      
      // Tentar carregar resumo mesmo em caso de erro (pode ter roteiro válido)
      const roteiroIdFinal = document.getElementById('viagemRoteiro')?.value;
      if (roteiroIdFinal) {
        carregarResumoRota(roteiroIdFinal);
      }
    }
  }

  // Função para fazer geocodificação reversa e obter cidade de uma coordenada
  async function obterCidadePorCoordenada(lat, lon) {
    try {
      // Usar Nominatim para reverse geocoding
      const nominatimServer = window.MAP_CONFIG?.nominatimServer || 'https://nominatim.openstreetmap.org';
      const url = `${nominatimServer}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AtlasCargo/2.0'
        }
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data && data.address) {
        const address = data.address;
        const cidade = address.city || address.town || address.village || address.municipality || '';
        const estado = address.state || '';
        const estadoUF = address.state_code || '';
        
        return {
          cidade: cidade,
          estado: estado,
          estadoUF: estadoUF,
          displayName: data.display_name || ''
        };
      }
      return null;
    } catch (err) {
      console.warn('Erro ao fazer reverse geocoding:', err);
      return null;
    }
  }

  // Função para processar informações detalhadas da rota do OSRM
  async function processarInformacoesRotaOSRM(osrmData, pontosRoteiro, coordenadasPontos) {
    const informacoes = {
      rodovias: [],
      cidadesPassagem: [],
      instrucoes: [],
      pontosIntercalados: [],
      pedagios: []
    };
    
    // Se não houver dados do OSRM, ainda processar os pontos do roteiro
    const temOSRM = osrmData && osrmData.routes && osrmData.routes[0] && osrmData.routes[0].legs;
    
    if (!temOSRM) {
      // Processar apenas os pontos do roteiro sem dados do OSRM
      if (pontosRoteiro && pontosRoteiro.length > 0) {
        pontosRoteiro.forEach((ponto, index) => {
          let tipoLocal = '';
          if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
            tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
          }
          const isPrimeiro = index === 0;
          const isUltimo = index === pontosRoteiro.length - 1;
          if (isPrimeiro) tipoLocal = 'O';
          else if (isUltimo) tipoLocal = 'D';
          else if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal) tipoLocal = 'P';
          
          // Calcular distância acumulada
          let distanciaAcumulada = 0;
          for (let i = 1; i <= index; i++) {
            if (pontosRoteiro[i].KMENTREPONTOS) {
              distanciaAcumulada += parseFloat(pontosRoteiro[i].KMENTREPONTOS) || 0;
            }
          }
          
          informacoes.pontosIntercalados.push({
            tipo: 'ponto',
            subtipo: tipoLocal,
            ordem: (index + 1) * 10,
            local: ponto.DSLOCAL || 'N/A',
            posicao: ponto.DSPOSICAO || null,
            distanciaAnterior: ponto.KMENTREPONTOS ? parseFloat(ponto.KMENTREPONTOS).toFixed(2) + ' km' : null,
            distanciaAcumulada: parseFloat(distanciaAcumulada.toFixed(2)),
            coordenadas: `${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}`,
            lat: parseFloat(ponto.LATITUDE),
            lon: parseFloat(ponto.LONGITUDE)
          });
        });
      }
      return informacoes;
    }
    
    const route = osrmData.routes[0];
    const legs = route.legs || [];
    const rodoviasUnicas = new Set();
    const instrucoesDetalhadas = [];
    
    // Processar cada leg (trecho entre dois pontos)
    legs.forEach((leg, legIndex) => {
      const steps = leg.steps || [];
      
      steps.forEach((step, stepIndex) => {
        // Extrair nome da estrada/rodovia
        const nomeEstrada = step.name || step.ref || step.road || '';
        if (nomeEstrada && nomeEstrada.trim() !== '') {
          // Verificar se é uma rodovia (BR-xxx, rodovia, etc.)
          const isRodovia = /^(BR|Rod\.|Rodovia|Estrada|Av\.|Avenida)/i.test(nomeEstrada) || 
                           /BR-\d+/i.test(nomeEstrada);
          if (isRodovia) {
            rodoviasUnicas.add(nomeEstrada);
          }
        }
        
        // Extrair instrução de navegação (rotograma)
        if (step.maneuver) {
          const distancia = step.distance ? (step.distance / 1000).toFixed(2) + ' km' : '';
          let instrucao = step.maneuver.instruction || '';
          
          // Se não tiver instrução, criar uma baseada no tipo de manobra
          if (!instrucao && step.maneuver.type) {
            const tiposManobra = {
              'turn': 'Vire',
              'new name': 'Continue',
              'depart': 'Saia',
              'arrive': 'Chegou',
              'merge': 'Entre',
              'ramp': 'Entre na rampa',
              'fork': 'Mantenha-se',
              'end of road': 'Fim da estrada',
              'continue': 'Continue',
              'roundabout': 'Entre na rotatória',
              'roundabout turn': 'Vire na rotatória',
              'notification': 'Atenção',
              'exit roundabout': 'Saia da rotatória',
              'exit rotary': 'Saia da rotatória'
            };
            
            const tipo = tiposManobra[step.maneuver.type] || step.maneuver.type;
            const modo = step.maneuver.modifier || '';
            
            if (modo) {
              const modos = {
                'left': 'à esquerda',
                'right': 'à direita',
                'slight left': 'ligeiramente à esquerda',
                'slight right': 'ligeiramente à direita',
                'sharp left': 'fortemente à esquerda',
                'sharp right': 'fortemente à direita',
                'straight': 'em frente',
                'uturn': 'faça retorno'
              };
              instrucao = `${tipo} ${modos[modo] || modo}`;
            } else {
              instrucao = tipo;
            }
            
            // Adicionar informação da estrada se disponível
            if (nomeEstrada) {
              instrucao += ` em direção à ${nomeEstrada}`;
            }
          }
          
          if (instrucao) {
            instrucoesDetalhadas.push({
              instrucao: instrucao,
              estrada: nomeEstrada || '',
              distancia: distancia,
              tipo: step.maneuver.type || '',
              modo: step.maneuver.modifier || '',
              legIndex: legIndex,
              stepIndex: stepIndex,
              coordenadas: step.maneuver.location ? [step.maneuver.location[1], step.maneuver.location[0]] : null
            });
          }
        }
      });
    });
    
    informacoes.rodovias = Array.from(rodoviasUnicas);
    informacoes.instrucoes = instrucoesDetalhadas;
    
    // OTIMIZADO: Usar APENAS pontos do roteiro - sem geocodificação reversa para melhor performance
    const cidadesEncontradas = new Map(); // Usar Map para evitar duplicatas
    
    // Adicionar cidades dos pontos do roteiro (já temos essas informações - muito mais rápido!)
    if (pontosRoteiro && pontosRoteiro.length > 0) {
      pontosRoteiro.forEach((ponto, index) => {
        // Tentar extrair cidade e estado do DSLOCAL ou DSPOSICAO
        let local = ponto.DSLOCAL || '';
        let posicao = ponto.DSPOSICAO || '';
        
        // Se DSLOCAL contém "Origem" ou "Destino" genérico, usar DSPOSICAO
        if ((local.toLowerCase().includes('origem') || local.toLowerCase().includes('destino')) && posicao) {
          local = posicao;
        }
        
        if (local) {
          // Tentar extrair cidade e estado do local (formato comum: "Cidade, Estado" ou "Cidade/UF")
          const localTrim = local.trim();
          let cidade = localTrim;
          let estado = '';
          let estadoUF = '';
          
          // Tentar extrair estado se estiver no formato "Cidade, Estado" ou "Cidade/UF"
          const matchComma = localTrim.match(/^(.+?),\s*(.+)$/);
          const matchSlash = localTrim.match(/^(.+?)\/([A-Z]{2})$/);
          
          if (matchSlash) {
            cidade = matchSlash[1].trim();
            estadoUF = matchSlash[2].trim();
          } else if (matchComma) {
            cidade = matchComma[1].trim();
            const estadoCompleto = matchComma[2].trim();
            // Tentar extrair UF se estiver no formato "Estado (UF)" ou apenas "UF"
            const matchUF = estadoCompleto.match(/\b([A-Z]{2})\b/);
            if (matchUF) {
              estadoUF = matchUF[1];
            } else {
              estado = estadoCompleto;
            }
          } else {
            // Tentar extrair UF do final do texto
            const matchUF = localTrim.match(/\b([A-Z]{2})\b/);
            if (matchUF) {
              estadoUF = matchUF[1];
              cidade = localTrim.replace(/\b([A-Z]{2})\b/, '').trim();
            }
          }
          
          // Limpar cidade (remover palavras genéricas e descrições)
          cidade = cidade
            .replace(/^(Origem|Destino|Passagem|Rodovia|Integra|Filial|Matriz)[\s,/-]*/i, '')
            .replace(/[\s,/-]+(Integra|Filial|Matriz).*$/i, '')
            .replace(/[\s,/-]+(PR|SC|RS|SP|RJ|MG|ES|BA|GO|MT|MS|DF).*$/i, '')
            .trim();
          
          // Se ainda não tem cidade válida ou contém palavras genéricas, pular
          if (!cidade || 
              cidade.toLowerCase() === 'origem' || 
              cidade.toLowerCase() === 'destino' || 
              cidade.toLowerCase() === 'passagem' ||
              cidade.toLowerCase().includes('rodovia') ||
              cidade.toLowerCase().includes('integra') ||
              cidade.toLowerCase().includes('filial') ||
              cidade.toLowerCase().includes('matriz')) {
            return;
          }
          
          // Calcular distância acumulada
          let distanciaAcumulada = 0;
          for (let i = 1; i <= index; i++) {
            if (pontosRoteiro[i].KMENTREPONTOS) {
              distanciaAcumulada += parseFloat(pontosRoteiro[i].KMENTREPONTOS) || 0;
            }
          }
          
          const chave = `${cidade}-${estadoUF || estado}`;
          if (!cidadesEncontradas.has(chave)) {
            cidadesEncontradas.set(chave, {
              cidade: cidade,
              estado: estado,
              estadoUF: estadoUF,
              lat: parseFloat(ponto.LATITUDE),
              lon: parseFloat(ponto.LONGITUDE),
              kmAproximado: distanciaAcumulada,
              rodovias: [] // Será preenchido depois com rodovias próximas
            });
          }
        }
      });
    }
    
    // REMOVIDO: Geocodificação reversa - muito lenta! Usar apenas pontos do roteiro
    
    // Processar cada leg para associar rodovias às cidades dos pontos do roteiro (MUITO MAIS RÁPIDO!)
    const rodoviasPorIntervalo = []; // Array de {lat, lon, rodovia, distancia, legIndex}
    
    if (temOSRM) {
      legs.forEach((leg, legIndex) => {
        const steps = leg.steps || [];
        let distanciaAcumulada = 0;
        
        steps.forEach((step, stepIndex) => {
          const nomeEstrada = step.name || step.ref || step.road || '';
          const isRodovia = nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada));
          
          if (isRodovia) {
            // Usar coordenada do step para associar à cidade mais próxima
            let lat = null, lon = null;
            if (step.maneuver && step.maneuver.location) {
              [lon, lat] = step.maneuver.location;
            } else if (step.geometry && step.geometry.coordinates && step.geometry.coordinates.length > 0) {
              [lon, lat] = step.geometry.coordinates[0];
            }
            
            if (lat && lon) {
              rodoviasPorIntervalo.push({ 
                lat, 
                lon, 
                rodovia: nomeEstrada, 
                distancia: distanciaAcumulada,
                legIndex: legIndex
              });
            }
          }
          
          distanciaAcumulada += (step.distance || 0) / 1000;
        });
      });
    }
    
    // Associar rodovias às cidades dos pontos do roteiro (rápido - sem API externa!)
    if (pontosRoteiro && pontosRoteiro.length > 0 && rodoviasPorIntervalo.length > 0) {
      cidadesEncontradas.forEach((cidadeObj, chave) => {
        // Procurar rodovia mais próxima desta cidade (dentro de 10km)
        let menorDistancia = Infinity;
        let rodoviasMaisProximas = [];
        
        for (const rodoviaInfo of rodoviasPorIntervalo) {
          const distLat = Math.abs(rodoviaInfo.lat - cidadeObj.lat);
          const distLon = Math.abs(rodoviaInfo.lon - cidadeObj.lon);
          const distancia = Math.sqrt(distLat * distLat + distLon * distLon);
          
          // Aumentar raio para 0.1 graus (~10km) para pegar mais rodovias
          if (distancia < 0.1 && distancia < menorDistancia) {
            menorDistancia = distancia;
            rodoviasMaisProximas = [rodoviaInfo.rodovia];
          } else if (distancia < 0.1 && distancia === menorDistancia) {
            if (!rodoviasMaisProximas.includes(rodoviaInfo.rodovia)) {
              rodoviasMaisProximas.push(rodoviaInfo.rodovia);
            }
          }
        }
        
        if (rodoviasMaisProximas.length > 0) {
          cidadeObj.rodovias = Array.from(new Set(rodoviasMaisProximas)); // Remover duplicatas
        }
      });
    }
    
    informacoes.cidadesPassagem = Array.from(cidadesEncontradas.values())
      .sort((a, b) => a.kmAproximado - b.kmAproximado); // Ordenar por distância
    
    // Intercalar pontos do roteiro com rodovias e informações da rota
    const pontosIntercalados = [];
    
    if (pontosRoteiro && pontosRoteiro.length > 0) {
      // Calcular distâncias acumuladas usando OSRM legs se disponível
      let distanciaAcumuladaOSRM = 0;
      const distanciasAcumuladas = [0]; // Primeiro ponto sempre tem distância 0
      
      if (legs && legs.length > 0) {
        // Calcular distâncias acumuladas usando os legs do OSRM
        legs.forEach((leg, legIndex) => {
          if (leg.distance) {
            distanciaAcumuladaOSRM += leg.distance / 1000; // Converter de metros para km
            distanciasAcumuladas.push(distanciaAcumuladaOSRM);
          } else {
            // Se não tiver distância no leg, usar KMENTREPONTOS se disponível
            const pontoIndex = legIndex + 1;
            if (pontoIndex < pontosRoteiro.length && pontosRoteiro[pontoIndex].KMENTREPONTOS) {
              distanciaAcumuladaOSRM += parseFloat(pontosRoteiro[pontoIndex].KMENTREPONTOS) || 0;
              distanciasAcumuladas.push(distanciaAcumuladaOSRM);
            } else {
              distanciasAcumuladas.push(distanciaAcumuladaOSRM);
            }
          }
        });
      } else {
        // Fallback: usar KMENTREPONTOS do banco de dados
        let distanciaAcumulada = 0;
        for (let i = 1; i < pontosRoteiro.length; i++) {
          const distanciaEntrePontos = pontosRoteiro[i].KMENTREPONTOS ? parseFloat(pontosRoteiro[i].KMENTREPONTOS) : 0;
          distanciaAcumulada += distanciaEntrePontos;
          distanciasAcumuladas.push(distanciaAcumulada);
        }
      }
      
      pontosRoteiro.forEach((ponto, index) => {
        let tipoLocal = '';
        if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
          tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
        }
        const isPrimeiro = index === 0;
        const isUltimo = index === pontosRoteiro.length - 1;
        if (isPrimeiro) tipoLocal = 'O';
        else if (isUltimo) tipoLocal = 'D';
        else if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal) tipoLocal = 'P';
        
        // Extrair cidade real do DSLOCAL ou DSPOSICAO
        let localNome = ponto.DSLOCAL || 'N/A';
        let localPosicao = ponto.DSPOSICAO || '';
        
        // Se DSLOCAL contém "Origem" ou "Destino" genérico, tentar extrair de DSPOSICAO
        if ((localNome.toLowerCase().includes('origem') || localNome.toLowerCase().includes('destino')) && localPosicao) {
          // Tentar extrair cidade de DSPOSICAO (formato comum: "Cidade, Estado" ou "Cidade/UF")
          const matchComma = localPosicao.match(/^(.+?),\s*(.+)$/);
          const matchSlash = localPosicao.match(/^(.+?)\/([A-Z]{2})$/);
          
          if (matchSlash) {
            localNome = matchSlash[1].trim();
          } else if (matchComma) {
            localNome = matchComma[1].trim();
          } else {
            // Tentar extrair cidade do início de DSPOSICAO
            const partes = localPosicao.split(/[,\/]/);
            if (partes.length > 0 && partes[0].trim()) {
              localNome = partes[0].trim();
            }
          }
        } else if (localNome) {
          // Tentar limpar DSLOCAL (remover "Origem", "Destino", "Passagem" genéricos)
          localNome = localNome.replace(/^(Origem|Destino|Passagem)[\s,/-]*/i, '').trim() || localNome;
          
          // Se ainda contém "Origem" ou "Destino", tentar usar DSPOSICAO
          if ((localNome.toLowerCase().includes('origem') || localNome.toLowerCase().includes('destino')) && localPosicao) {
            const matchComma = localPosicao.match(/^(.+?),\s*(.+)$/);
            const matchSlash = localPosicao.match(/^(.+?)\/([A-Z]{2})$/);
            
            if (matchSlash) {
              localNome = matchSlash[1].trim();
            } else if (matchComma) {
              localNome = matchComma[1].trim();
            }
          }
        }
        
        // Usar distância acumulada calculada
        const distanciaAcumulada = distanciasAcumuladas[index] || 0;
        
        // Adicionar ponto do roteiro
        pontosIntercalados.push({
          tipo: 'ponto',
          subtipo: tipoLocal,
          ordem: (index + 1) * 10, // Multiplicar por 10 para ter espaço para intercalar
          local: localNome,
          posicao: localPosicao,
          distanciaAnterior: ponto.KMENTREPONTOS ? parseFloat(ponto.KMENTREPONTOS).toFixed(2) + ' km' : null,
          distanciaAcumulada: parseFloat(distanciaAcumulada.toFixed(2)),
          coordenadas: `${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}`,
          lat: parseFloat(ponto.LATITUDE),
          lon: parseFloat(ponto.LONGITUDE)
        });
        
        // Se não for o último ponto, adicionar rodovias e informações do trecho
        if (!isUltimo && legs[index]) {
          const leg = legs[index];
          const steps = leg.steps || [];
          const rodoviasTrecho = new Set();
          
          // Coletar rodovias deste trecho
          steps.forEach(step => {
            const nomeEstrada = step.name || step.ref || step.road || '';
            if (nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada))) {
              rodoviasTrecho.add(nomeEstrada);
            }
          });
          
          // Adicionar rodovias do trecho após o ponto
          let ordemRodovia = (index + 1) * 10 + 1;
          rodoviasTrecho.forEach(rodovia => {
            pontosIntercalados.push({
              tipo: 'rodovia',
              nome: rodovia,
              ordem: ordemRodovia++,
              legIndex: index
            });
          });
        } else if (!isUltimo && legs.length > index) {
          // Tentar usar o leg correspondente se disponível
          const leg = legs[index];
          if (leg && leg.steps) {
            const steps = leg.steps || [];
            const rodoviasTrecho = new Set();
            
            steps.forEach(step => {
              const nomeEstrada = step.name || step.ref || step.road || '';
              if (nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada))) {
                rodoviasTrecho.add(nomeEstrada);
              }
            });
            
            let ordemRodovia = (index + 1) * 10 + 1;
            rodoviasTrecho.forEach(rodovia => {
              pontosIntercalados.push({
                tipo: 'rodovia',
                nome: rodovia,
                ordem: ordemRodovia++,
                legIndex: index
              });
            });
          }
        }
      });
    }
    
    // Intercalar cidades de passagem na lista de pontos intercalados
    if (informacoes.cidadesPassagem && informacoes.cidadesPassagem.length > 0 && pontosIntercalados.length > 0) {
      informacoes.cidadesPassagem.forEach((cidade, idx) => {
        // Calcular ordem aproximada baseada na distância
        // Encontrar o ponto mais próximo para intercalar
        let ordemAproximada = 0;
        let menorDistancia = Infinity;
        let pontoMaisProximo = null;
        
        pontosIntercalados.forEach(ponto => {
          if (ponto.tipo === 'ponto' && ponto.lat && ponto.lon) {
            // Calcular distância aproximada usando fórmula de Haversine simplificada
            const latDiff = Math.abs(ponto.lat - cidade.lat);
            const lonDiff = Math.abs(ponto.lon - cidade.lon);
            const distancia = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
            
            if (distancia < menorDistancia) {
              menorDistancia = distancia;
              ordemAproximada = ponto.ordem + 0.25; // Inserir antes do ponto mais próximo
              pontoMaisProximo = ponto;
            }
          }
        });
        
        // Se não encontrou ponto próximo, usar ordem baseada na distância km
        if (ordemAproximada === 0 && cidade.kmAproximado) {
          // Estimar ordem baseada na distância (assumindo que pontos estão espaçados)
          // Calcular distância total a partir dos pontos intercalados ou usar route se disponível
          let totalDistancia = 0;
          if (route && route.distance) {
            totalDistancia = route.distance / 1000; // em km
          } else if (pontosIntercalados.length > 0) {
            // Usar a maior distância acumulada dos pontos
            const ultimoPonto = pontosIntercalados[pontosIntercalados.length - 1];
            totalDistancia = ultimoPonto.distanciaAcumulada || cidade.kmAproximado;
          }
          
          if (totalDistancia > 0) {
            const proporcao = cidade.kmAproximado / totalDistancia;
            ordemAproximada = proporcao * (pontosIntercalados.length * 10) + 0.2;
          } else {
            ordemAproximada = (idx + 1) * 5;
          }
        }
        
        pontosIntercalados.push({
          tipo: 'cidade',
          nome: cidade.cidade,
          estado: cidade.estado || cidade.estadoUF || '',
          ordem: ordemAproximada || (idx + 1) * 5,
          kmAproximado: cidade.kmAproximado,
          rodovias: cidade.rodovias || []
        });
      });
    }
    
    // Ordenar por ordem
    pontosIntercalados.sort((a, b) => a.ordem - b.ordem);
    
    informacoes.pontosIntercalados = pontosIntercalados;
    
    return informacoes;
  }

  // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida

  // Função copiarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
  
  // REMOVIDO: Código antigo desnecessário foi removido completamente
  
  // Variáveis globais para a aba Compatíveis

  // Eventos de edição e exclusão - delegação de eventos (adicionado uma vez)
  // Usar delegação de eventos para funcionar com elementos dinâmicos
  if (list) {
    list.addEventListener('click', (e) => {
      // Verificar se o clique foi em um botão de editar ou excluir
      const btn = e.target.closest('.btn.edit, .btn.delete');
      if (!btn) return;
      
      // Verificar se o botão está dentro de um list-item (não é do modal)
      const listItem = btn.closest('.list-item');
      if (!listItem) {
        return; // Ignorar se não estiver dentro de um item da lista
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      // Tentar pegar o ID de múltiplas formas
      let id = btn.getAttribute('data-id');
      if (!id || id === 'null' || id === 'undefined' || id === '') {
        id = listItem.getAttribute('data-id');
      }
      
      // Validar o ID
      if (!id || id === 'null' || id === 'undefined' || id === '' || id === 'NaN') {
        console.error('ID inválido ao clicar no botão:', {
          btnDataId: btn.getAttribute('data-id'),
          btnDatasetId: btn.dataset?.id,
          listItemDataId: listItem.getAttribute('data-id'),
          listItemDatasetId: listItem.dataset?.id,
          btnHTML: btn.outerHTML.substring(0, 100),
          listItemHTML: listItem.outerHTML.substring(0, 200)
        });
        showMessage('Erro: ID não disponível para esta ação.', 'error');
        return;
      }
      
      if (btn.classList.contains('edit')) {
        loadViagemParaEdicao(id);
      } else if (btn.classList.contains('delete')) {
        confirmarExclusao(id);
      }
    });
  }

  // ========== FUNCIONALIDADES DE MOTORISTAS COMPATÍVEIS ==========
  
  let viagensPendentes = [];
  let motoristasCompatíveis = [];
  let viagemResumoCompativeis = null;
  let viagemSelecionada = null;

  function aplicarResumoClasseViagemCompativeis() {
    const box = document.getElementById('resumoClasseExigidaCompativeis');
    const txt = document.getElementById('resumoClasseExigidaCompativeisTexto');
    if (!box || !txt) return;
    const v = viagemResumoCompativeis;
    if (!v) {
      box.style.display = 'none';
      txt.textContent = '';
      const extra = document.getElementById('resumoClasseExigidaCompativeisExtra');
      if (extra) {
        extra.style.display = 'none';
        extra.textContent = '';
      }
      return;
    }
    const ds = v.DSCLASSEFROTA_VIAGEM != null ? v.DSCLASSEFROTA_VIAGEM : v.dsclassefrota_viagem;
    const cd = v.CDCLASSEFROTA != null ? v.CDCLASSEFROTA : v.cdclassefrota;
    const fr = v.FGRASTREADO != null ? v.FGRASTREADO : v.fgrastreado;
    const dsStr = ds != null && String(ds).trim() !== '' ? String(ds).trim() : '';
    let texto = '';
    if (dsStr) {
      texto = cd != null && String(cd).trim() !== '' ? `${dsStr} · cód. ${String(cd).trim()}` : dsStr;
    } else if (cd != null && String(cd).trim() !== '') {
      texto = `Classe código ${String(cd).trim()}`;
    } else {
      texto = 'Classe não informada na viagem';
    }
    txt.textContent = texto;
    const extra = document.getElementById('resumoClasseExigidaCompativeisExtra');
    if (extra) {
      if (String(fr || '').trim().toUpperCase() === 'S') {
        extra.textContent = 'Esta viagem exige veículo rastreado.';
        extra.style.display = 'block';
      } else {
        extra.style.display = 'none';
        extra.textContent = '';
      }
    }
    box.style.display = 'block';
  }

  function limparResumoClasseViagemCompativeis() {
    viagemResumoCompativeis = null;
    aplicarResumoClasseViagemCompativeis();
  }

  // Carregar viagens pendentes
  async function carregarRegrasCompatibilidade() {
    try {
      const response = await fetchApiViagens('/regras-compatibilidade');
      if (!response.ok) return;
      const data = await response.json();
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
      set('regraCompativelRastreamento', data.rastreamento);
      set('regraCompativelClasseFrota', data.classeFrota);
      set('regraCompativelLocalEmbarque', data.localEmbarque);
      set('regraCompativelLocalDesembarque', data.localDesembarque);
    } catch (e) { /* ignorar */ }
  }

  async function carregarViagensPendentes() {
    const select = document.getElementById('selectViagemPendente');
    if (!select) return;
    try {
      showMessage('Carregando viagens pendentes...', 'info');
      const response = await fetchApiAbsPath('/api/viagens-pendentes');
      if (!response.ok) {
        const errText = await response.text();
        console.warn('[Viagens pendentes] Resposta não OK:', response.status, errText.slice(0, 200));
        throw new Error('Erro ao carregar viagens pendentes');
      }
      
      const data = await response.json();
      viagensPendentes = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
      if (!Array.isArray(viagensPendentes)) viagensPendentes = [];
      if (data && !Array.isArray(data) && data.error) {
        console.warn('[Viagens pendentes] API retornou erro:', data.error);
      }
      
      const tinhaOpcoesAntes = select.options.length > 1;
      
      if (viagensPendentes.length === 0) {
        // API retornou lista vazia: não limpa a combo para não perder a viagem que estava
        if (tinhaOpcoesAntes) {
          showMessage('Nenhuma viagem pendente no momento. Lista anterior mantida.', 'info');
        } else {
          showMessage('Nenhuma viagem pendente encontrada.', 'info');
        }
      } else {
        // Só limpa e preenche quando há dados novos
        select.innerHTML = '<option value="">Selecione uma viagem para ver motoristas compatíveis</option>';
        viagensPendentes.sort((a, b) => {
          const idA = parseFloat(a.IDVIAGEM) || 0;
          const idB = parseFloat(b.IDVIAGEM) || 0;
          return idB - idA;
        });
        viagensPendentes.forEach(v => {
          const option = document.createElement('option');
          option.value = v.IDVIAGEM;
          const origCidade = (v.ORIGEM_CIDADE != null ? v.ORIGEM_CIDADE : v.origem_cidade) || 'N/A';
          const origEstado = (v.ORIGEM_ESTADO != null ? v.ORIGEM_ESTADO : v.origem_estado) || 'N/A';
          const destCidade = (v.DESTINO_CIDADE != null ? v.DESTINO_CIDADE : v.destino_cidade) || 'N/A';
          const destEstado = (v.DESTINO_ESTADO != null ? v.DESTINO_ESTADO : v.destino_estado) || 'N/A';
          const classe = (v.DSCLASSEFROTA != null ? v.DSCLASSEFROTA : v.dsclassefrota) || 'Sem classe';
          option.textContent = `ID ${v.IDVIAGEM} - ${origCidade}/${origEstado} → ${destCidade}/${destEstado} - ${classe}`;
          select.appendChild(option);
        });
        showMessage(`${viagensPendentes.length} viagem(ns) pendente(s) carregada(s).`, 'success');
      }
    } catch (err) {
      console.error('Erro ao carregar viagens pendentes:', err);
      showMessage('Erro ao carregar viagens pendentes. Verifique se está logado.', 'error');
      // Não limpa a combo em caso de erro: mantém a seleção anterior para o usuário não perder a viagem que estava
    }
  }

  // Carregar viagens pendentes e selecionar uma viagem específica
  async function carregarEselecionarViagem(idViagem) {
    // Ativar acompanhamento WebSocket para esta viagem
    if (typeof window.WebSocketTorre !== 'undefined' && idViagem) {
      window.WebSocketTorre.acompanharViagem(idViagem);
    }
    try {
      // Primeiro, carregar as viagens pendentes
      await carregarViagensPendentes();
      
      // Aguardar um pouco para garantir que o select foi preenchido
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Selecionar a viagem
      const select = document.getElementById('selectViagemPendente');
      const btnBuscar = document.getElementById('btnBuscarMotoristas');
      
      if (select && idViagem) {
        const idViagemStr = String(idViagem);
        
        // Verificar se a viagem está na lista de pendentes
        const viagemEncontrada = viagensPendentes.find(v => String(v.IDVIAGEM) === idViagemStr);
        
        // Se não estiver na lista, adicionar como opção
        if (!viagemEncontrada) {
          // Buscar dados da viagem para adicionar à lista
          try {
            const response = await fetchApiViagens(`/${idViagem}`);
            if (response.ok) {
              const viagem = await response.json();
              const option = document.createElement('option');
              option.value = idViagemStr;
              const oC = (viagem.ORIGEM_CIDADE != null ? viagem.ORIGEM_CIDADE : viagem.origem_cidade) || 'N/A';
              const oE = (viagem.ORIGEM_ESTADO != null ? viagem.ORIGEM_ESTADO : viagem.origem_estado) || 'N/A';
              const dC = (viagem.DESTINO_CIDADE != null ? viagem.DESTINO_CIDADE : viagem.destino_cidade) || 'N/A';
              const dE = (viagem.DESTINO_ESTADO != null ? viagem.DESTINO_ESTADO : viagem.destino_estado) || 'N/A';
              option.textContent = `ID ${idViagemStr} - ${oC}/${oE} → ${dC}/${dE} - ${viagem.DSCLASSEFROTA || viagem.dsclassefrota || 'Sem classe'}`;
              option.selected = true;
              // Inserir após a primeira opção (depois do "Selecione...")
              if (select.options.length > 0) {
                select.insertBefore(option, select.options[1]);
              } else {
                select.appendChild(option);
              }
            }
          } catch (err) {
            // Erro ao buscar dados da viagem
            // Adicionar mesmo sem os dados completos
            const option = document.createElement('option');
            option.value = idViagemStr;
            option.textContent = `ID ${idViagemStr} - (Viagem em edição)`;
            option.selected = true;
            if (select.options.length > 0) {
              select.insertBefore(option, select.options[1]);
            } else {
              select.appendChild(option);
            }
          }
        } else {
          // Se estiver na lista, apenas selecionar
          select.value = idViagemStr;
        }
        
        // Habilitar o botão de buscar
        if (btnBuscar) {
          btnBuscar.disabled = false;
        }
        
        // Disparar evento change para garantir que tudo seja atualizado
        select.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Buscar automaticamente os motoristas compatíveis
        await buscarMotoristasCompatíveis(idViagem);
      }
    } catch (err) {
      console.error('Erro ao carregar e selecionar viagem:', err);
      showMessage('Erro ao carregar viagem para busca de motoristas.', 'error');
    }
  }

  // Buscar motoristas compatíveis
  async function buscarMotoristasCompatíveis(idViagemParam = null) {
    // Obter referência do container uma única vez
    const gridContainer = document.getElementById('motoristasCompatíveisGrid');
    
    // Mostrar skeleton loader durante busca
    if (gridContainer && typeof window.showSkeleton === 'function') {
      window.showSkeleton(gridContainer, 5, 'list');
    }
    
    let idViagem = idViagemParam;
    
    // Se não foi passado como parâmetro, pegar do select
    if (!idViagem) {
      const select = document.getElementById('selectViagemPendente');
      idViagem = select ? select.value : null;
    }
    
    if (!idViagem) {
      // Esconder skeleton se houver erro
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
      limparResumoClasseViagemCompativeis();
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    try {
      showMessage('Buscando motoristas compatíveis...', 'info');
      const response = await fetchApiViagens(`/${idViagem}/motoristas-compativel`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erro ao buscar motoristas compatíveis');
      }
      
      const payload = await response.json();
      if (Array.isArray(payload)) {
        motoristasCompatíveis = payload;
        viagemResumoCompativeis = null;
      } else {
        motoristasCompatíveis = Array.isArray(payload.motoristas) ? payload.motoristas : [];
        viagemResumoCompativeis = payload.viagemResumo || payload.viagemresumo || null;
      }
      viagemSelecionada = idViagem;
      aplicarResumoClasseViagemCompativeis();
      
      // Esconder skeleton antes de renderizar
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
      
      renderizarMotoristasCompatíveis();
      
      if (motoristasCompatíveis.length === 0) {
        showMessage('Nenhum motorista compatível encontrado para esta viagem.', 'info');
      } else {
        showMessage(`${motoristasCompatíveis.length} motorista(s) compatível(is) encontrado(s).`, 'success');
      }
    } catch (err) {
      console.error('Erro ao buscar motoristas compatíveis:', err);
      showMessage(err.message || 'Erro ao buscar motoristas compatíveis.', 'error');
      viagemResumoCompativeis = null;
      aplicarResumoClasseViagemCompativeis();
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
    }
  }

  // Flag para evitar mudança automática de aba durante carregamento
  let bloqueandoMudancaAba = false;

  // Variável para controlar ordenação
  let ordenacaoMotoristas = {
    campo: null,
    direcao: 'asc' // 'asc' ou 'desc'
  };

  // Função para ordenar motoristas compatíveis (tornada global para onclick)
  window.ordenarMotoristasCompatíveis = function(campo) {
    if (ordenacaoMotoristas.campo === campo) {
      // Se já está ordenando por este campo, inverte a direção
      ordenacaoMotoristas.direcao = ordenacaoMotoristas.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      // Novo campo, ordena ascendente
      ordenacaoMotoristas.campo = campo;
      ordenacaoMotoristas.direcao = 'asc';
    }

    motoristasCompatíveis.sort((a, b) => {
      let valorA, valorB;

      switch (campo) {
        case 'motorista':
          valorA = (a.NOME_MOTORISTA || '').toLowerCase();
          valorB = (b.NOME_MOTORISTA || '').toLowerCase();
          break;
        case 'cidade':
          valorA = ((a.CIDADE_NOME || '') + ' ' + (a.CIDADE_ESTADO || '')).toLowerCase();
          valorB = ((b.CIDADE_NOME || '') + ' ' + (b.CIDADE_ESTADO || '')).toLowerCase();
          break;
        case 'transportador':
          valorA = (a.TRANSPORTADOR_NOME || '').toLowerCase();
          valorB = (b.TRANSPORTADOR_NOME || '').toLowerCase();
          break;
        case 'viagens':
          valorA = parseInt(a.QTVIAGENS) || 0;
          valorB = parseInt(b.QTVIAGENS) || 0;
          break;
        case 'rota':
          valorA = parseInt(a.QTVIAGENS_NESTA_ROTA) || 0;
          valorB = parseInt(b.QTVIAGENS_NESTA_ROTA) || 0;
          break;
        case 'conjunto':
          valorA = String(
            a.CONJUNTO_PLACAS_CLASSES_MOTORISTA != null
              ? a.CONJUNTO_PLACAS_CLASSES_MOTORISTA
              : a.conjunto_placas_classes_motorista || ''
          ).toLowerCase();
          valorB = String(
            b.CONJUNTO_PLACAS_CLASSES_MOTORISTA != null
              ? b.CONJUNTO_PLACAS_CLASSES_MOTORISTA
              : b.conjunto_placas_classes_motorista || ''
          ).toLowerCase();
          break;
        default:
          return 0;
      }

      if (valorA < valorB) return ordenacaoMotoristas.direcao === 'asc' ? -1 : 1;
      if (valorA > valorB) return ordenacaoMotoristas.direcao === 'asc' ? 1 : -1;
      return 0;
    });

    renderizarMotoristasCompatíveis();
  }

  // Renderizar grid de motoristas compatíveis
  function renderizarMotoristasCompatíveis() {
    const container = document.getElementById('motoristasCompatíveisGrid');
    const acoesLote = document.getElementById('acoesLote');
    const countContainer = document.getElementById('motoristasCompatíveisCount');
    const countText = document.getElementById('motoristasCompatíveisCountText');
    
    // Atualizar contador
    if (countContainer && countText) {
      const count = motoristasCompatíveis.length || 0;
      countText.textContent = `${count} motorista(s) compatível(is) encontrado(s)`;
      countContainer.style.display = count > 0 ? 'block' : 'none';
    }
    
    if (motoristasCompatíveis.length === 0) {
      container.innerHTML = '<p class="empty">Nenhum motorista compatível encontrado.</p>';
      acoesLote.style.display = 'none';
      return;
    }

    // Função para obter ícone de ordenação
    const getSortIcon = (campo) => {
      if (ordenacaoMotoristas.campo !== campo) {
        return '<span style="color: #ccc; font-size: 0.8em;">⇅</span>';
      }
      return ordenacaoMotoristas.direcao === 'asc' 
        ? '<span style="color: #667eea; font-size: 0.8em;">↑</span>'
        : '<span style="color: #667eea; font-size: 0.8em;">↓</span>';
    };

    // Criar tabela
    let html = `
      <div id="legendaMotoristasCompatíveis" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">
        <div style="font-weight: 600; color: #495057; margin-right: 10px;">Legenda:</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #28a745; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
          <span><strong>Acionado:</strong> Motorista que já foi convocado para esta viagem</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #dc3545; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
          <span><strong>Não Acionado:</strong> Motorista que ainda não foi convocado</span>
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <th style="padding: 12px; text-align: left; width: 40px;">
              <input type="checkbox" id="checkAll" style="cursor: pointer;">
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('motorista')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Motorista ${getSortIcon('motorista')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('cidade')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Cidade ${getSortIcon('cidade')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('transportador')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Transportador ${getSortIcon('transportador')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none; min-width: 200px;" 
                onclick="ordenarMotoristasCompatíveis('conjunto')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Veículos aprovados no cadastro do motorista (placa e classe). Confira antes de convocar.">
              Placas / classes ${getSortIcon('conjunto')}
            </th>
            <th style="padding: 12px; text-align: center; cursor: pointer; user-select: none; width: 80px;" 
                onclick="ordenarMotoristasCompatíveis('viagens')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Quantidade total de viagens que o motorista já fez">
              🚛 Total ${getSortIcon('viagens')}
            </th>
            <th style="padding: 12px; text-align: center; cursor: pointer; user-select: none; width: 80px;" 
                onclick="ordenarMotoristasCompatíveis('rota')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Quantas vezes o motorista já fez ESTA ROTA específica">
              ⭐ Rota ${getSortIcon('rota')}
            </th>
          </tr>
        </thead>
        <tbody>
    `;

    const escHtmlMotoristaCompat = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const htmlConjuntoPlacasClassesMotorista = (motorista) => {
      const raw = String(
        motorista.CONJUNTO_PLACAS_CLASSES_MOTORISTA != null
          ? motorista.CONJUNTO_PLACAS_CLASSES_MOTORISTA
          : motorista.conjunto_placas_classes_motorista || ''
      ).trim();
      if (!raw) {
        return '<span style="color:#999;font-size:13px;">Sem veículo aprovado no cadastro</span>';
      }
      const partes = raw.split('~~LINE~~').map((p) => p.trim()).filter(Boolean);
      return partes.map((linha, idx) => (
        (idx > 0 ? '<hr class="motorista-compat-placa-sep" style="border:0;border-top:1px solid #dee2e6;margin:10px 0;background:transparent;" />' : '')
        + `<div class="motorista-compat-placa-linha">${escHtmlMotoristaCompat(linha)}</div>`
      )).join('');
    };

    motoristasCompatíveis.forEach((motorista, index) => {
      const isChecked = motorista.selecionado || false;
      
      // Formatar celular do motorista para WhatsApp (remover caracteres não numéricos)
      const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppMotorista = celularFormatado.length >= 10; // Celular válido tem pelo menos 10 dígitos
      const numWaMotorista = celularFormatado.length >= 12 ? celularFormatado : '55' + celularFormatado;
      const linkWhatsAppMotorista = temWhatsAppMotorista ? `https://wa.me/${numWaMotorista}` : '#';
      
      // Formatar celular do motorista para exibição (com parênteses e hífen)
      let celularExibicao = '';
      if (celularFormatado && celularFormatado.length >= 10) {
        if (celularFormatado.length === 11) {
          // Formato: (41) 99837-1769
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 7)}-${celularFormatado.substring(7)}`;
        } else if (celularFormatado.length === 10) {
          // Formato: (41) 9837-1769
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 6)}-${celularFormatado.substring(6)}`;
        } else {
          // Formato simples se não tiver 10 ou 11 dígitos
          celularExibicao = celularFormatado;
        }
      }
      
      // Formatar celular do transportador para WhatsApp
      const celularTransportadorFormatado = motorista.TRANSPORTADOR_CELULAR ? motorista.TRANSPORTADOR_CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppTransportador = celularTransportadorFormatado.length >= 10;
      const numWaTransportador = celularTransportadorFormatado.length >= 12 ? celularTransportadorFormatado : '55' + celularTransportadorFormatado;
      const linkWhatsAppTransportador = temWhatsAppTransportador ? `https://wa.me/${numWaTransportador}` : '#';
      
      // Formatar celular do transportador para exibição
      let celularTransportadorExibicao = '';
      if (celularTransportadorFormatado && celularTransportadorFormatado.length >= 10) {
        if (celularTransportadorFormatado.length === 11) {
          celularTransportadorExibicao = `(${celularTransportadorFormatado.substring(0, 2)}) ${celularTransportadorFormatado.substring(2, 7)}-${celularTransportadorFormatado.substring(7)}`;
        } else if (celularTransportadorFormatado.length === 10) {
          celularTransportadorExibicao = `(${celularTransportadorFormatado.substring(0, 2)}) ${celularTransportadorFormatado.substring(2, 6)}-${celularTransportadorFormatado.substring(6)}`;
        } else {
          celularTransportadorExibicao = celularTransportadorFormatado;
        }
      }
      
      // Formatar celular do contratador para WhatsApp
      const celularContratadorFormatado = motorista.CONTRATADOR_CELULAR ? motorista.CONTRATADOR_CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppContratador = celularContratadorFormatado.length >= 10;
      const numWaContratador = celularContratadorFormatado.length >= 12 ? celularContratadorFormatado : '55' + celularContratadorFormatado;
      const linkWhatsAppContratador = temWhatsAppContratador ? `https://wa.me/${numWaContratador}` : '#';
      
      // Formatar celular do contratador para exibição
      let celularContratadorExibicao = '';
      if (celularContratadorFormatado && celularContratadorFormatado.length >= 10) {
        if (celularContratadorFormatado.length === 11) {
          celularContratadorExibicao = `(${celularContratadorFormatado.substring(0, 2)}) ${celularContratadorFormatado.substring(2, 7)}-${celularContratadorFormatado.substring(7)}`;
        } else if (celularContratadorFormatado.length === 10) {
          celularContratadorExibicao = `(${celularContratadorFormatado.substring(0, 2)}) ${celularContratadorFormatado.substring(2, 6)}-${celularContratadorFormatado.substring(6)}`;
        } else {
          celularContratadorExibicao = celularContratadorFormatado;
        }
      }
      
      const foiAcionado =
        Number(motorista.FOI_ACIONADO) === 1 ||
        motorista.FOI_ACIONADO === true ||
        String(motorista.FOI_ACIONADO || '').trim() === '1';
      html += `
        <tr style="border-bottom: 1px solid #eee; ${index % 2 === 0 ? 'background: #fafafa;' : ''}">
          <td style="padding: 12px;">
            <input type="checkbox" 
                   class="check-motorista" 
                   data-index="${index}"
                   ${isChecked ? 'checked' : ''}
                   style="cursor: pointer;">
          </td>
          <td style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${foiAcionado
                ? '<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #28a745; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); flex-shrink: 0;" title="Motorista acionado (já foi convocado / WhatsApp ou acesso registrado)"></span>'
                : '<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #dc3545; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); flex-shrink: 0;" title="Motorista não acionado (ainda não foi convocado)"></span>'}
              <div>
                <strong>${(motorista.NOME_MOTORISTA != null ? motorista.NOME_MOTORISTA : motorista.nome_motorista) || '-'}</strong><br>
                <small style="color: #666;">Código: ${(motorista.CDCADASTRO_MOTORISTA != null ? motorista.CDCADASTRO_MOTORISTA : motorista.cdcadastro_motorista) ?? '-'}${celularExibicao ? '  |  ' : ''}</small>
                ${celularExibicao ? `
                  <small style="color: #666;">
                    ${temWhatsAppMotorista ? `<a href="${linkWhatsAppMotorista}" target="_blank" style="color: #25D366; text-decoration: none;" title="Abrir WhatsApp"><i class="bx bx-logo-whatsapp" style="font-size: 1em; vertical-align: middle;"></i> ${celularExibicao}</a>` : celularExibicao}
                  </small>
                ` : ''}
              </div>
            </div>
          </td>
          <td style="padding: 12px;">
            ${(motorista.CIDADE_NOME != null ? motorista.CIDADE_NOME : motorista.cidade_nome) || '-'}, ${(motorista.CIDADE_ESTADO != null ? motorista.CIDADE_ESTADO : motorista.cidade_estado) || '-'}<br>
            <small style="color: #666;">Micro-região: ${(motorista.MICROREGIAO_NOME != null ? motorista.MICROREGIAO_NOME : motorista.microrregiao_nome) || (motorista.CDMICROREGIAO != null ? motorista.CDMICROREGIAO : motorista.cdmicroregiao) || 'Não informada'}</small>
          </td>
          <td style="padding: 12px;">
            ${(motorista.TRANSPORTADOR_NOME != null ? motorista.TRANSPORTADOR_NOME : motorista.transportador_nome) || '-'}<br>
            <small style="color: #666;">
              ${motorista.CDTRANSPORTADOR ? 'Código: ' + motorista.CDTRANSPORTADOR : ''}
              ${celularTransportadorExibicao ? `
                ${motorista.CDTRANSPORTADOR ? ' | ' : ''}
                ${temWhatsAppTransportador ? `<a href="${linkWhatsAppTransportador}" target="_blank" style="color: #25D366; text-decoration: none;" title="Abrir WhatsApp do transportador"><i class="bx bx-logo-whatsapp" style="font-size: 1em; vertical-align: middle;"></i> ${celularTransportadorExibicao}</a>` : `<i class="bx bx-logo-whatsapp" style="font-size: 1em; vertical-align: middle;"></i> ${celularTransportadorExibicao}`}
              ` : ''}
            </small>
          </td>
          <td style="padding: 12px; vertical-align: top; font-size: 14px;">
            ${htmlConjuntoPlacasClassesMotorista(motorista)}
          </td>
          <td style="padding: 12px; text-align: center;">
            <span style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 6px 12px; border-radius: 20px; font-weight: 600; font-size: 14px;">
              ${(motorista.QTVIAGENS != null ? motorista.QTVIAGENS : motorista.qtviagens) ?? 0}
            </span>
          </td>
          <td style="padding: 12px; text-align: center;">
            ${((motorista.QTVIAGENS_NESTA_ROTA != null ? motorista.QTVIAGENS_NESTA_ROTA : motorista.qtviagens_nesta_rota) || 0) > 0 
              ? `<span style="display: inline-block; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: white; padding: 6px 12px; border-radius: 20px; font-weight: 600; font-size: 14px; box-shadow: 0 2px 8px rgba(255,215,0,0.4);" title="Motorista experiente nesta rota!">
                  ⭐ ${(motorista.QTVIAGENS_NESTA_ROTA != null ? motorista.QTVIAGENS_NESTA_ROTA : motorista.qtviagens_nesta_rota)}
                </span>` 
              : `<span style="color: #999; font-size: 18px;" title="Nunca fez esta rota">-</span>`
            }
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    acoesLote.style.display = 'block';
    atualizarContadorSelecionados();

    // Event listeners
    document.getElementById('checkAll').addEventListener('change', function(e) {
      const checkboxes = document.querySelectorAll('.check-motorista');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const index = parseInt(cb.getAttribute('data-index'));
        motoristasCompatíveis[index].selecionado = e.target.checked;
      });
      atualizarContadorSelecionados();
    });

    document.querySelectorAll('.check-motorista').forEach(cb => {
      cb.addEventListener('change', function() {
        const index = parseInt(this.getAttribute('data-index'));
        motoristasCompatíveis[index].selecionado = this.checked;
        atualizarContadorSelecionados();
      });
    });
  }

  // Atualizar contador de selecionados
  function atualizarContadorSelecionados() {
    const selecionados = motoristasCompatíveis.filter(m => m.selecionado).length;
    const contador = document.getElementById('contadorSelecionados');
    contador.textContent = `${selecionados} motorista(s) selecionado(s)`;
  }

  // Selecionar todos
  function selecionarTodos() {
    motoristasCompatíveis.forEach(m => m.selecionado = true);
    renderizarMotoristasCompatíveis();
  }

  // Desselecionar todos
  function desselecionarTodos() {
    motoristasCompatíveis.forEach(m => m.selecionado = false);
    renderizarMotoristasCompatíveis();
  }

  // Preparar anúncio da carga
  async function prepararAnuncioCarga() {
    if (!viagemSelecionada) {
      showMessage('Nenhuma viagem selecionada.', 'error');
      return;
    }

    try {
      showMessage('Carregando dados da viagem...', 'info');
      
      // Buscar dados completos da viagem
      const response = await fetchApiViagens(`/${viagemSelecionada}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar dados da viagem');
      }
      
      const viagemAtual = await response.json();
      
      if (!viagemAtual) {
        showMessage('Dados da viagem não encontrados.', 'error');
        return;
      }

    // Formatar datas (usa contexto locale/timezone)
    const formatarDataHora = (dataHora) => {
      if (!dataHora) return 'Não informado';
      const s = fmtDataHora(dataHora);
      return s === '-' ? 'Data inválida' : s;
    };

      // Montar o anúncio com formatação atrativa (sem emojis para evitar ? no WhatsApp)
      let anuncio = `*CARGA DISPONÍVEL*\n\n`;
      
      anuncio += `*ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
      anuncio += `*Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
      anuncio += `*Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
      anuncio += `*Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} -> ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
      
      anuncio += `*HORÁRIOS*\n`;
      anuncio += `*Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
      anuncio += `*Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
      
      // Só mostrar requisitos se exigir rastreado
      if (viagemAtual.FGRASTREADO === 'S') {
        anuncio += `*REQUISITOS*\n`;
        anuncio += `*Exige Veículo Rastreado:* SIM\n\n`;
      }
      
      anuncio += `*CONTRATADOR*\n`;
      anuncio += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
      
      anuncio += `*VALORES*\n`;
      anuncio += `*Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
      anuncio += `*Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
      anuncio += `*Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\n`;
      
      if (viagemAtual.OBSERV) {
        anuncio += `\n*DETALHES DA VIAGEM*\n`;
        anuncio += `${viagemAtual.OBSERV}\n`;
      }
      
      // Adicionar nota sobre o link (será substituído pelo link real ao enviar)
      anuncio += `\n\n*Acesse para responder:*\n`;
      anuncio += `(Link único será adicionado automaticamente para cada motorista)`;
      
      anuncio = anuncio.trim();

      // Exibir no modal
      const modal = document.getElementById('modalAnuncio');
      const preview = document.getElementById('anuncioCargaPreview');
      preview.textContent = anuncio;
      modal.style.display = 'block';
      
      showMessage('Anúncio preparado com sucesso!', 'success');
    } catch (err) {
      console.error('Erro ao preparar anúncio:', err);
      showMessage('Erro ao preparar anúncio da carga.', 'error');
    }
  }

  // Copiar anúncio para área de transferência
  async function copiarAnuncio() {
    const preview = document.getElementById('anuncioCargaPreview');
    const texto = preview.textContent;
    
    try {
      await navigator.clipboard.writeText(texto);
      showMessage('Anúncio copiado para a área de transferência!', 'success');
    } catch (err) {
      // Fallback para navegadores mais antigos
      const textArea = document.createElement('textarea');
      textArea.value = texto;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showMessage('Anúncio copiado para a área de transferência!', 'success');
      } catch (err2) {
        showMessage('Erro ao copiar. Selecione o texto manualmente.', 'error');
      }
      document.body.removeChild(textArea);
    }
  }

  // Função para obter URL pública (para funcionar no celular / ngrok)
  async function obterUrlPublica() {
    // PRIORIDADE 1: backend (.env PUBLIC_URL) — mesmo se a torre estiver aberta em localhost
    try {
      const urlRes = await fetch('/api/public-url', { headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {} });
      if (urlRes.ok) {
        const urlData = await urlRes.json();
        if (urlData && urlData.url && String(urlData.url).trim()) {
          const u = String(urlData.url).trim().replace(/\/$/, '');
          const host = (() => {
            try { return new URL(u).hostname; } catch (_) { return ''; }
          })();
          const isLocal =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host.startsWith('192.168.') ||
            host.startsWith('10.');
          if (!isLocal) return u;
          // Se API devolveu localhost, ainda pode ser útil se o browser estiver no ngrok
        }
      }
    } catch (e) {
      console.warn('[URL] /api/public-url falhou:', e && e.message ? e.message : e);
    }

    // PRIORIDADE 2: utilitário de ambiente
    if (typeof window !== 'undefined' && typeof window.obterUrlBase === 'function') {
      try {
        const urlBase = await window.obterUrlBase();
        if (urlBase) return String(urlBase).replace(/\/$/, '');
      } catch (err) {
        console.warn('[URL] Erro ao obter URL base do utilitário, usando fallback:', err);
      }
    }
    
    // PRIORIDADE 3: origem atual (ngrok / produção) ou localhost
    return String(window.location.origin || 'http://localhost:3001').replace(/\/$/, '');
  }

  // Enviar anúncio via WhatsApp para motoristas selecionados
  async function enviarAnuncioWhatsApp() {
    let selecionados = [];
    if (typeof motoristasCompatíveis !== 'undefined' && motoristasCompatíveis.length > 0) {
       selecionados = motoristasCompatíveis.filter(m => m.selecionado);
    }
    
    // Se não encontrou no array de compatíveis, tenta pegar pelos checkboxes na tela principal
    if (selecionados.length === 0) {
       const checkboxes = document.querySelectorAll('.motorista-checkbox:checked, .check-motorista:checked');
       checkboxes.forEach(cb => {
         const id = cb.value || cb.getAttribute('data-id');
         if (id && window.convocacoes) {
            const conv = window.convocacoes.find(c => String(c.IDCONVOCACAO) === String(id) || String(c.CDMOTORISTA) === String(id) || String(c.CDCADASTRO_MOTORISTA) === String(id));
            if (conv) {
               selecionados.push(conv);
            } else {
               // Fallback: usar id como tudo
               selecionados.push({ id, IDCONVOCACAO: id, CDCADASTRO_MOTORISTA: id, CDMOTORISTA: id });
            }
         } else if (id) {
            selecionados.push({ id, IDCONVOCACAO: id, CDCADASTRO_MOTORISTA: id, CDMOTORISTA: id });
         }
       });
    }
    
    if (selecionados.length === 0) {
      showMessage('Selecione pelo menos um motorista para enviar o anúncio.', 'error');
      return;
    }

    const tabConvocacoes = document.getElementById('tab-convocações') || document.querySelector('[data-tab="convocações"]')?.closest('.tab-content');
    const filtroConv = document.getElementById('filtroConvocacaoViagem')?.value?.trim();
    const isAbaConvocacoes = tabConvocacoes && tabConvocacoes.classList.contains('active');
    const idViagemLocal = (isAbaConvocacoes && filtroConv) ? filtroConv : (viagemSelecionada || (window.viagemAtual && window.viagemAtual.IDVIAGEM) || filtroConv || null);

    if (!idViagemLocal) {
      showMessage('Nenhuma viagem selecionada.', 'error');
      return;
    }

    // Identificar a aba atual para definir o fluxo
    const tabCompativeis = document.getElementById('tab-compatíveis');
    const isAbaCompativeis = tabCompativeis && tabCompativeis.classList.contains('active');

    // Se as convocações já existirem (tiverem IDCONVOCACAO e já estiverem na aba Convocações) e não for aba de compatíveis, 
    // não precisamos criar de novo, apenas chamamos o disparo Switch Digital.
    // IMPORTANTE: precisamos garantir que seja array com IDCONVOCACAO preenchido e não apenas o ID do motorista
    const convsJaExistem = !isAbaCompativeis && selecionados[0] && 
                           (selecionados[0].IDCONVOCACAO || (selecionados[0].id && !selecionados[0].CDCADASTRO_MOTORISTA && String(selecionados[0].id).length < 10)); // Heuristica se é ID de conv ou CPF/CNPJ

    if (convsJaExistem) {
       const ids = selecionados.map(m => m.IDCONVOCACAO || m.CDCADASTRO_MOTORISTA || m.CDMOTORISTA || m.id);
       dispararWhatsAppSwitchDigital(idViagemLocal, ids);
       return;
    }

    try {
      showMessage('Preparando convocações e links...', 'info');
      
      // Obter URL base pública (para funcionar no celular)
      const urlBase = await obterUrlPublica();
      
      // Preparar anúncio com links individuais
      const preview = document.getElementById('anuncioCargaPreview');
      if (!preview) {
        throw new Error('Preview do anúncio não encontrado. Certifique-se de preparar o anúncio primeiro.');
      }
      
      let textoBase = preview.textContent;
      
      // Remover a nota sobre link do preview (se existir)
      textoBase = textoBase.replace(/\n\n\*Acesse para responder:\*\n\(Link único será adicionado automaticamente para cada motorista\)/g, '').trim();
      
      // Preparar lista de motoristas para criar convocações
      // O backend já verifica duplicatas automaticamente
      const motoristasParaEnvio = selecionados.map(m => ({
        CDCADASTRO_MOTORISTA: m.CDCADASTRO_MOTORISTA || m.id
      }));

      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';
      const token = localStorage.getItem('token') || '';
      
      // Criar convocações (o backend verifica duplicatas e reutiliza se existir)
      const response = await fetch('/api/convocacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          idViagem: idViagemLocal,
          motoristas: motoristasParaEnvio
        })
      });

      const errCriar = await rejeicaoSeRespostaNaoOk(response, 'Erro ao criar convocações');
      if (errCriar) throw errCriar;

      const result = await response.json();
      const todasConvocacoes = result.convocacoes || [];
      
      // Log de acionamento e convocações criadas
      if (window.logAcionamento) {
        window.logAcionamento(viagemSelecionada, selecionados.length, {
          motoristasSelecionados: selecionados.map(m => ({
            id: m.CDCADASTRO_MOTORISTA,
            nome: m.NOME_MOTORISTA
          }))
        });
      }
      
      // Log de cada convocação criada
      todasConvocacoes.forEach(conv => {
        if (window.logConvocacao) {
          const tipo = conv.REUTILIZADA ? 'Reutilização' : 'Criação';
          window.logConvocacao(viagemSelecionada, conv.IDCONVOCACAO, conv.CDCADASTRO_MOTORISTA, tipo, {
            reutilizada: conv.REUTILIZADA || false
          });
        }
      });
      
      // Criar um mapa de motorista -> ID convocação e dados completos
      const mapaConvocacoes = {};
      todasConvocacoes.forEach(conv => {
        const motorista = selecionados.find(m => m.CDCADASTRO_MOTORISTA === conv.CDCADASTRO_MOTORISTA);
        if (motorista) {
          mapaConvocacoes[motorista.CDCADASTRO_MOTORISTA] = {
            IDCONVOCACAO: conv.IDCONVOCACAO,
            LINKCONVOCACAO: conv.LINKCONVOCACAO,
            TXTCONVOCACAO: conv.TXTCONVOCACAO,
            NRCELULAR: conv.NRCELULAR,
            EXISTENTE: conv.REUTILIZADA === true // Se foi reutilizada, significa que já existia
          };
        }
      });
      
      // Agora atualizar as convocações com texto e link
      const atualizacoesPromises = [];
      
      // Preparar links do WhatsApp para cada motorista
      const linksWhatsApp = [];
      let semCelular = 0;
      let semConvocacao = 0;
      const motoristasSemCelular = []; // Lista de nomes dos motoristas sem celular
      const motoristasSemConvocacao = []; // Lista de nomes dos motoristas sem convocação
      
      selecionados.forEach((motorista) => {
        const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
        const dadosConvocacao = mapaConvocacoes[motorista.CDCADASTRO_MOTORISTA];
        const nomeMotorista = motorista.NOME_MOTORISTA || `ID: ${motorista.CDCADASTRO_MOTORISTA}`;
        
        if (!celularFormatado || celularFormatado.length < 10) {
          // Motorista sem celular válido - ignorar
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          return;
        }
        
        if (!dadosConvocacao || !dadosConvocacao.IDCONVOCACAO) {
          // Convocação não criada para este motorista - ignorar
          semConvocacao++;
          motoristasSemConvocacao.push(nomeMotorista);
          return;
        }
        
        if (!dadosConvocacao || !dadosConvocacao.IDCONVOCACAO) {
          // Convocação não criada para este motorista - ignorar
          semConvocacao++;
          return;
        }
        
        const idConvocacao = dadosConvocacao.IDCONVOCACAO;
        const convocacaoExiste = dadosConvocacao.EXISTENTE;
        
        // Sempre gerar novo texto e link (para refletir mudanças como aumento de frete)
        // Mesmo que a convocação já exista, atualizamos com os dados mais recentes
        const linkConvocacao = `${urlBase}/convocacao/${idConvocacao}`;
        
        // Personalizar mensagem para cada motorista
        const nomeMotoristaConvocacao = motorista.NOME_MOTORISTA || 'Motorista';
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        
        let textoComLink;
        if (isLocalIP) {
          // Para IPs locais, formatar o link de forma destacada para facilitar cópia
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n*Importante:*\n- Links locais não são clicáveis no WhatsApp\n- Copie o link acima (toque e segure)\n- Cole no navegador do celular\n- Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }
        
        // Sempre atualizar convocação no banco com texto e link atualizados
        // Isso garante que mudanças (como aumento de frete) sejam refletidas
        atualizacoesPromises.push(
          fetch(`/api/convocacoes/${idConvocacao}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              NRCELULAR: celularFormatado,
              TXTCONVOCACAO: textoComLink,
              LINKCONVOCACAO: linkConvocacao
            })
          }).catch(err => {
            console.error(`Erro ao atualizar convocação ${idConvocacao}:`, err);
          })
        );
        
        const textoAnuncio = encodeURIComponent(textoComLink);
        const numWa = celularFormatado.length >= 12 ? celularFormatado : '55' + celularFormatado;
        const linkWhatsApp = `https://wa.me/${numWa}?text=${textoAnuncio}`;
        
        // Armazenar link para exibir no modal
        linksWhatsApp.push({
          motorista: motorista.NOME_MOTORISTA || `ID: ${motorista.CDCADASTRO_MOTORISTA}`,
          celular: celularFormatado,
          link: linkWhatsApp,
          idConvocacao: idConvocacao,
          existente: convocacaoExiste
        });
      });
      
      // Aguardar todas as atualizações
      await Promise.all(atualizacoesPromises);
      
      // Log de envio WhatsApp manual
      if (window.logWhatsAppManual && linksWhatsApp.length > 0) {
        window.logWhatsAppManual(viagemSelecionada, linksWhatsApp.length, {
          motoristasComLink: linksWhatsApp.map(l => ({
            nome: l.motorista,
            celular: l.celular,
            idConvocacao: l.idConvocacao
          })),
          semCelular: semCelular,
          semConvocacao: semConvocacao
        });
      }
      
      // Fechar modal de anúncio
      const modal = document.getElementById('modalAnuncio');
      if (modal) {
        modal.style.display = 'none';
      }
      
      // Mostrar modal com links do WhatsApp
      if (linksWhatsApp.length > 0) {
        mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular, motoristasSemConvocacao);
      } else {
        let mensagem = 'Nenhum WhatsApp disponível. ';
        if (semCelular > 0) {
          mensagem += `${semCelular} motorista(s) sem celular válido: ${motoristasSemCelular.join(', ')}. `;
        }
        if (semConvocacao > 0) {
          mensagem += `${semConvocacao} motorista(s) sem convocação criada: ${motoristasSemConvocacao.join(', ')}.`;
        }
        showMessage(mensagem, 'error');
      }
      
      // Limpar seleções
      motoristasCompatíveis.forEach(m => m.selecionado = false);
      renderizarMotoristasCompatíveis();
      
      showMessage(`Convocações criadas com sucesso! ${linksWhatsApp.length} link(s) do WhatsApp disponível(is).`, 'success');
      
    } catch (err) {
      console.error('Erro ao enviar anúncio:', err);
      showMessage('Erro ao criar convocações: ' + err.message, tipoMensagemErroHttp(err));
    }
  }


  // Função para mostrar modal com links do WhatsApp
  // ============================================================================
  // FIM DAS FUNÇÕES DE ENVIO AUTOMÁTICO
  // ============================================================================

  // Função para mostrar modal com links do WhatsApp
  function mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular = [], motoristasSemConvocacao = []) {
    // Criar ou obter modal
    let modal = document.getElementById('modalLinksWhatsApp');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalLinksWhatsApp';
      modal.className = 'modal';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }
    
    // Montar conteúdo do modal
    let html = `
      <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #25D366; padding-bottom: 15px;">
          <h3 style="margin: 0; color: #25D366; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-logo-whatsapp" style="font-size: 28px;"></i>
            <span>Links do WhatsApp (${linksWhatsApp.length})</span>
          </h3>
          <button type="button" id="btnFecharLinksWhatsApp" class="btn cancel" style="padding: 5px 15px;"><i class="bx bx-x" style="font-size: 1.25rem;"></i></button>
        </div>
        
        <div style="margin-bottom: 15px; padding: 15px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border: 2px solid #25D366; border-radius: 8px; position: relative;">
          <button type="button" id="btnAjudaEnvio" 
                  style="position: absolute; top: 10px; right: 10px; background: #25D366; color: white; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.3s;"
                  onmouseover="this.style.transform='scale(1.1)'; this.style.background='#128C7E';"
                  onmouseout="this.style.transform='scale(1)'; this.style.background='#25D366';"
                  title="Ver guia rápido de envio">
            ?
          </button>
          <p style="margin: 0; color: #2e7d32; font-weight: 600; padding-right: 40px;">
            <i class="bx bx-check-circle" style="vertical-align: middle;"></i> Convocações criadas com sucesso! Escolha como deseja enviar:
          </p>
          <p style="margin: 8px 0 0 0; color: #388e3c; font-size: 13px; padding-right: 40px;">
            <i class="bx bx-bulb" style="vertical-align: middle;"></i> <strong>Dica:</strong> Clique no <strong>?</strong> acima para ver o guia rápido
          </p>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
    `;
    
    linksWhatsApp.forEach((item, index) => {
      html += `
        <div style="display: flex; align-items: center; gap: 15px; padding: 15px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; transition: all 0.3s;" 
             onmouseover="this.style.background='#e8f5e9'; this.style.borderColor='#25D366';" 
             onmouseout="this.style.background='#f5f5f5'; this.style.borderColor='#ddd';">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #2c3e50; margin-bottom: 5px;">${item.motorista}</div>
            <div style="font-size: 13px; color: #666;"><i class="bx bx-logo-whatsapp" style="font-size: 1em; vertical-align: middle;"></i> ${item.celular}</div>
            <div style="font-size: 12px; color: #999; margin-top: 3px;">ID Convocação: ${item.idConvocacao}</div>
          </div>
          <a href="${item.link}" target="_blank" 
             style="padding: 10px 20px; background: #25D366; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; white-space: nowrap; transition: all 0.3s;"
             onmouseover="this.style.background='#128C7E'; this.style.transform='scale(1.05)';"
             onmouseout="this.style.background='#25D366'; this.style.transform='scale(1)';">
            <i class="bx bx-logo-whatsapp"></i> Abrir WhatsApp
          </a>
        </div>
      `;
    });
    
    html += `
        </div>
    `;
    
    if (semCelular > 0 || semConvocacao > 0) {
      html += `
        <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; font-size: 13px; color: #856404;">
          <strong><i class="bx bx-error-circle" style="vertical-align: middle;"></i> Atenção:</strong>
          ${semCelular > 0 ? `
            <div style="margin-top: 5px;">
              <strong>${semCelular} motorista(s) sem celular válido:</strong>
              <ul style="margin: 5px 0 0 20px; padding: 0;">
                ${motoristasSemCelular.map(nome => `<li>${nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${semConvocacao > 0 ? `
            <div style="margin-top: 5px;">
              <strong>${semConvocacao} motorista(s) sem convocação criada:</strong>
              <ul style="margin: 5px 0 0 20px; padding: 0;">
                ${motoristasSemConvocacao.map(nome => `<li>${nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    html += `
      </div>
    `;
    
    modal.innerHTML = html;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Event listeners
    const btnFechar = document.getElementById('btnFecharLinksWhatsApp');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }
    
    // Botão de ajuda/guia rápido
    const btnAjudaEnvio = document.getElementById('btnAjudaEnvio');
    if (btnAjudaEnvio) {
      btnAjudaEnvio.onclick = () => {
        mostrarGuiaRapidoEnvio();
      };
    }
    
    // Fechar ao clicar fora
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    

  }

  // Mostrar guia rápido de envio
  function mostrarGuiaRapidoEnvio() {
    const guiaHTML = `
      <div style="max-width: 800px; max-height: 90vh; overflow-y: auto; padding: 30px; background: white; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 3px solid #25D366; padding-bottom: 15px;">
          <h2 style="margin: 0; color: #25D366; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-rocket" style="font-size: 32px;"></i>
            <span>Guia Rápido - Envio de Convocações</span>
          </h2>
          <button type="button" id="btnFecharGuia" 
                  style="background: #dc3545; color: white; border: none; border-radius: 50%; width: 35px; height: 35px; cursor: pointer; font-weight: 700; font-size: 18px; display: flex; align-items: center; justify-content: center;"
                  onmouseover="this.style.background='#c82333';"
                  onmouseout="this.style.background='#dc3545';">
            <i class="bx bx-x" style="font-size: 1.25rem;"></i>
          </button>
        </div>
        
        <div style="margin-bottom: 25px;">
          <h3 style="color: #2c3e50; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-user" style="font-size: 24px;"></i>
            <span>Envio Manual</span>
          </h3>
          <div style="padding: 20px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-left: 4px solid #2196F3; border-radius: 8px; margin-bottom: 15px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #1565c0;">Quando usar:</p>
            <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
              <li>Quer revisar cada mensagem antes de enviar</li>
              <li>Precisa personalizar alguma mensagem</li>
              <li>Controle total sobre o envio</li>
            </ul>
          </div>
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Como fazer:</p>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li>Crie as convocações normalmente</li>
              <li>No modal de links, clique em <strong>"<i class="bx bx-user" style="font-size:1em;"></i> Enviar Manualmente"</strong></li>
              <li>WhatsApp abre com mensagem pré-formatada</li>
              <li>Revise e clique em "Enviar"</li>
            </ol>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
            <p style="margin: 0; color: #856404; font-size: 13px;">
              <strong><i class="bx bx-edit-alt" style="vertical-align: middle;"></i> Vantagens:</strong> Pode personalizar • Revisa cada mensagem • Zero custo • Controle total
            </p>
          </div>
        </div>
        
        <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); border-radius: 12px; border: 2px solid #9c27b0;">
          <h3 style="color: #7b1fa2; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-check-circle" style="font-size: 24px;"></i>
            <span>Confirmar Convocação</span>
          </h3>
          <div style="padding: 15px; background: white; border-radius: 8px; margin-bottom: 15px;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Passo a passo:</p>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li><strong>Motorista aceita:</strong> Status muda para "ACEITA"</li>
              <li><strong>Você confirma:</strong> Aba "Convocações" → Botão "<i class=\"bx bx-check-circle\"></i> Confirmar"</li>
              <li><strong>Escolha o método:</strong> Automático ou Manual</li>
              <li><strong>Pronto!</strong> Mensagem de confirmação enviada</li>
            </ol>
          </div>
        </div>
        
        <div style="margin-top: 25px; padding: 15px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid #4caf50;">
          <p style="margin: 0; color: #2e7d32; font-weight: 600; display: flex; align-items: center; gap: 8px;">
            <i class="bx bx-bulb" style="font-size: 20px;"></i>
            <span>Dica:</span>
          </p>
          <p style="margin: 8px 0 0 0; color: #388e3c; font-size: 14px;">
            Primeira vez? Use Manual para ver como ficam as mensagens. Envio em massa? Use Automático para agilizar!
          </p>
        </div>
      </div>
    `;
    
    // Criar modal de guia
    let modalGuia = document.getElementById('modalGuiaRapidoEnvio');
    if (!modalGuia) {
      modalGuia = document.createElement('div');
      modalGuia.id = 'modalGuiaRapidoEnvio';
      modalGuia.className = 'modal';
      modalGuia.style.display = 'none';
      modalGuia.style.alignItems = 'center';
      modalGuia.style.justifyContent = 'center';
      modalGuia.style.zIndex = '10000';
      document.body.appendChild(modalGuia);
    }
    
    modalGuia.innerHTML = guiaHTML;
    modalGuia.style.display = 'flex';
    
    // Fechar modal
    const btnFecharGuia = document.getElementById('btnFecharGuia');
    if (btnFecharGuia) {
      btnFecharGuia.onclick = () => {
        modalGuia.style.display = 'none';
      };
    }
    
    // Fechar ao clicar fora
    modalGuia.onclick = (e) => {
      if (e.target === modalGuia) {
        modalGuia.style.display = 'none';
      }
    };
  }

  // Função para mostrar modal de confirmação
  function showConfirmModal(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const modalMessage = document.getElementById('modalMessage');
      const confirmYes = document.getElementById('confirmYes');
      const confirmNo = document.getElementById('confirmNo');
      
      if (!modal || !modalMessage || !confirmYes || !confirmNo) {
        // Fallback para confirm nativo se modal não existir
        resolve(confirm(message.replace(/<[^>]*>/g, '')));
        return;
      }

      // Atualizar título e mensagem
      const modalTitle = modal.querySelector('h3');
      if (modalTitle) {
        // Se o título contém HTML (ícones Boxicons) ou WhatsApp, usar innerHTML
        const isHtmlTitle = /<i class="bx /i.test(title) || title.includes('bx-logo-whatsapp') || title.includes('bx-stats') || title.includes('WhatsApp');
        if (isHtmlTitle) {
          modalTitle.innerHTML = title;
          modalTitle.style.color = title.includes('WhatsApp') ? '#25D366' : '';
          modalTitle.style.fontSize = title.includes('WhatsApp') ? '22px' : '';
          modalTitle.style.fontWeight = title.includes('WhatsApp') ? '600' : '';
        } else {
          modalTitle.textContent = title;
          modalTitle.style.color = '';
          modalTitle.style.fontSize = '';
          modalTitle.style.fontWeight = '';
        }
      }
      modalMessage.innerHTML = message;

      // Ajustar estilo dos botões se for modal de WhatsApp
      if (title.includes('WhatsApp') || title.includes('bx-logo-whatsapp')) {
        const btnYes = modal.querySelector('#confirmYes');
        if (btnYes) {
          btnYes.style.background = '#25D366';
          btnYes.style.color = 'white';
          btnYes.style.border = 'none';
          btnYes.style.padding = '10px 30px';
          btnYes.textContent = 'Continuar';
        }
      } else {
        const btnYes = modal.querySelector('#confirmYes');
        if (btnYes) {
          btnYes.style.background = '';
          btnYes.style.color = '';
          btnYes.style.border = '';
          btnYes.style.padding = '';
          btnYes.textContent = 'Sim';
        }
      }

      // Mostrar modal
      modal.style.display = 'block';

      // Remover listeners anteriores
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);

      // Adicionar novos listeners
      newConfirmYes.onclick = () => {
        modal.style.display = 'none';
        resolve(true);
      };

      newConfirmNo.onclick = () => {
        modal.style.display = 'none';
        resolve(false);
      };

      // Fechar ao clicar fora
      const originalOnclick = modal.onclick;
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          resolve(false);
        }
      };
    });
  }

  async function validarSaudeSwitchDigitalAntesDoDisparo(idViagem, totalItens) {
    let response;
    let payload = null;
    try {
      response = await fetchApiViagens('/webhook/switch-digital/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viagemId: idViagem || null,
          total: totalItens || 0
        })
      });
      try {
        payload = await response.json();
      } catch (e) {
        payload = null;
      }
    } catch (err) {
      throw new Error(`Falha ao verificar saúde da integração Switch Digital: ${err.message}`);
    }

    if (!response.ok || !payload || payload.healthy !== true) {
      const msg = (payload && (payload.message || payload.error))
        || 'Switch Digital indisponível para envio neste momento.';
      throw new Error(msg);
    }
    return payload;
  }

  // Disparar convocações
  async function dispararConvocacoes() {
    const selecionados = motoristasCompatíveis.filter(m => m.selecionado);
    
    if (selecionados.length === 0) {
      showMessage('Selecione pelo menos um motorista para disparar as convocações.', 'error');
      return;
    }

    // Na aba Compatíveis: priorizar o valor atual do dropdown "Selecione uma Viagem" para evitar
    // criar convocações para a viagem errada quando o usuário trocou a viagem mas não clicou em "Buscar"
    const selectComp = document.getElementById('selectViagemPendente');
    const idViagemDoDropdown = selectComp && selectComp.value && String(selectComp.value).trim() ? String(selectComp.value).trim() : null;
    const idViagemLocal = idViagemDoDropdown || viagemSelecionada;

    if (!idViagemLocal) {
      showMessage('Nenhuma viagem selecionada. Selecione uma viagem na lista e, se necessário, clique em "Buscar Motoristas Compatíveis".', 'error');
      return;
    }
    viagemSelecionada = idViagemLocal;

    // Usar modal de confirmação estilizado
    const confirmar = await showConfirmModal(
      'Confirmar Disparo de Convocações',
      `Deseja realmente disparar <strong>${selecionados.length}</strong> convocação(ões) para esta viagem?<br><br><small style="color: #b8c5d6;">As convocações serão criadas e os campos de celular, texto e link serão preenchidos automaticamente.</small>`
    );
    if (!confirmar) return;

    try {
      showMessage('Disparando convocações...', 'info');
      
      // Buscar dados da viagem para gerar texto e link
      const idParaBuscar = typeof idViagemLocal !== 'undefined' ? idViagemLocal : (typeof viagemSelecionada !== 'undefined' ? viagemSelecionada : null);
      if (!idParaBuscar) {
        throw new Error('ID da viagem não definido.');
      }
      const responseViagem = await fetchApiViagens(`/${idParaBuscar}`);
      if (!responseViagem.ok) {
        throw new Error('Erro ao buscar dados da viagem');
      }
      const viagemAtual = await responseViagem.json();
      
      if (!viagemAtual || !viagemAtual.IDVIAGEM) {
        throw new Error('Dados da viagem não encontrados');
      }
      
      // Função para formatar data/hora
      const formatarDataHora = (dataHora) => {
        if (!dataHora) return 'Não informado';
        
        if (typeof dataHora === 'string') {
          let dataStr = dataHora.replace('Z', '');
          if (dataStr.includes('T')) {
            dataStr = dataStr.replace('T', ' ');
          }
          
          const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
          if (match) {
            const [, year, month, day, hour, minute] = match;
            const diaStr = String(day).padStart(2, '0');
            const mesStr = String(month).padStart(2, '0');
            const anoStr = year;
            const horaStr = String(hour).padStart(2, '0');
            const minutoStr = String(minute).padStart(2, '0');
            
            return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
          }
        }
        
        try {
          const date = new Date(dataHora);
          if (isNaN(date.getTime())) return 'Data inválida';
          
          const ano = date.getUTCFullYear();
          const mes = date.getUTCMonth();
          const dia = date.getUTCDate();
          const hora = date.getUTCHours();
          const minuto = date.getUTCMinutes();
          
          const diaStr = String(dia).padStart(2, '0');
          const mesStr = String(mes + 1).padStart(2, '0');
          const anoStr = ano;
          const horaStr = String(hora).padStart(2, '0');
          const minutoStr = String(minuto).padStart(2, '0');
          
          return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
        } catch (err) {
          return 'Data inválida';
        }
      };
      
      // Gerar texto base formatado (sem emojis para evitar ? no WhatsApp)
      let textoBase = `*CARGA DISPONÍVEL*\n\n`;
      textoBase += `*ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
      textoBase += `*Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
      textoBase += `*Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
      textoBase += `*Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} -> ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
      textoBase += `*HORÁRIOS*\n`;
      textoBase += `*Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
      textoBase += `*Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
      
      if (viagemAtual.FGRASTREADO === 'S') {
        textoBase += `*REQUISITOS*\n`;
        textoBase += `*Exige Veículo Rastreado:* SIM\n\n`;
      }
      
      textoBase += `*CONTRATADOR*\n`;
      textoBase += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
      textoBase += `*VALORES*\n`;
      textoBase += `*Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
      textoBase += `*Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
      textoBase += `*Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\n`;
      
      if (viagemAtual.OBSERV) {
        textoBase += `\n*DETALHES DA VIAGEM*\n`;
        textoBase += `${viagemAtual.OBSERV}\n`;
      }
      
      // Obter URL base pública
      const urlBase = await obterUrlPublica();
      
      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';
      
          // Primeiro, criar as convocações para obter os IDs reais
      // Depois atualizaremos com os dados completos
      const motoristasParaCriacao = selecionados.map(m => ({
        CDCADASTRO_MOTORISTA: m.CDCADASTRO_MOTORISTA
      }));
      
      const response = await fetch('/api/convocacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        },
        body: JSON.stringify({
          idViagem: idParaBuscar,
          motoristas: motoristasParaCriacao
        })
      });

      const errCriarConv = await rejeicaoSeRespostaNaoOk(response, 'Erro ao criar convocações');
      if (errCriarConv) throw errCriarConv;

      const result = await response.json();
      const todasConvocacoes = result.convocacoes || [];
      
      // Log de acionamento e convocações criadas (disparo automático)
      if (window.logAcionamento) {
        window.logAcionamento(idParaBuscar, selecionados.length, {
          tipo: 'Disparo Automático',
          motoristasSelecionados: selecionados.map(m => ({
            id: m.CDCADASTRO_MOTORISTA,
            nome: m.NOME_MOTORISTA
          }))
        });
      }
      
      // Log de cada convocação criada
      todasConvocacoes.forEach(conv => {
        if (window.logConvocacao) {
          const tipo = conv.REUTILIZADA ? 'Reutilização' : 'Criação';
          window.logConvocacao(idParaBuscar, conv.IDCONVOCACAO, conv.CDCADASTRO_MOTORISTA, tipo, {
            reutilizada: conv.REUTILIZADA || false,
            tipoDisparo: 'automático'
          });
        }
      });
      
      // Agora atualizar todas as convocações com os dados completos (celular, texto e link)
      // Armazenar dados gerados para reutilizar no webhook
      const dadosGeradosMap = new Map();
      const atualizacoesPromises = [];
      let atualizacoesSucesso = 0;
      let atualizacoesErro = 0;
      
      for (const motorista of selecionados) {
        const convocacao = todasConvocacoes.find(c => c.CDCADASTRO_MOTORISTA === motorista.CDCADASTRO_MOTORISTA);
        if (!convocacao || !convocacao.IDCONVOCACAO) {
          console.warn(`Convocação não encontrada para motorista ${motorista.CDCADASTRO_MOTORISTA}`);
          continue;
        }
        
        const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
        const idConvocacao = convocacao.IDCONVOCACAO;
        const linkConvocacao = `${urlBase}/convocacao/${idConvocacao}`;
        
        // Personalizar mensagem para cada motorista
        const nomeMotoristaConvocacao = motorista.NOME_MOTORISTA || 'Motorista';
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        
        let textoComLink;
        if (isLocalIP) {
          // Para IPs locais, formatar o link de forma destacada para facilitar cópia
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n*Importante:*\n- Links locais não são clicáveis no WhatsApp\n- Copie o link acima (toque e segure)\n- Cole no navegador do celular\n- Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }
        
        // Formatar rota (exatamente como no textoBase linha 3999)
        const rotaFormatada = viagemAtual.DSROTEIRO 
          ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` 
          : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} → ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`;
        
        // Formatar tipo (exatamente como no textoBase linha 3997)
        const tipoFormatado = viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado';
        
        // Formatar classe (exatamente como no textoBase linha 3998)
        const classeFormatada = viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado';
        
        // Armazenar dados gerados para uso no webhook (incluindo os 11 campos solicitados)
        // Usando exatamente os mesmos dados e formatação que são usados na mensagem (textoBase)
        dadosGeradosMap.set(idConvocacao, {
          IDCONVOCACAO: idConvocacao,
          CDCADASTRO_MOTORISTA: motorista.CDCADASTRO_MOTORISTA,
          NOME_MOTORISTA: nomeMotoristaConvocacao,
          NRCELULAR: celularFormatado && celularFormatado.length >= 10 ? celularFormatado : null,
          TXTCONVOCACAO: textoComLink,
          LINKCONVOCACAO: linkConvocacao,
          // Campos adicionais (11 campos) - usando os mesmos dados que montam a mensagem
          ID: viagemAtual.IDVIAGEM || null,
          TIPO: tipoFormatado,
          CLASSE: classeFormatada,
          ROTA: rotaFormatada,
          CARREGAMENTO: formatarDataHora(viagemAtual.DTPREVINICIO),
          DESCARGA: formatarDataHora(viagemAtual.DTPREVFINAL),
          CONTRATADOR: viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado',
          FRETE: viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00',
          PESO: viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000',
          CUBAGEM: viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000',
          DETALHES: viagemAtual.OBSERV || ''
        });
        
        // Preparar dados para atualização
        // SEMPRE enviar TXTCONVOCACAO e LINKCONVOCACAO
        const dadosAtualizacao = {
          TXTCONVOCACAO: textoComLink,
          LINKCONVOCACAO: linkConvocacao
        };
        
        // Adicionar NRCELULAR apenas se houver celular válido
        // Se não houver, não enviar o campo (o controller só atualiza se o campo for fornecido)
        if (celularFormatado && celularFormatado.length >= 10) {
          dadosAtualizacao.NRCELULAR = celularFormatado;
        }
        
        // Validar que temos pelo menos texto e link
        if (!dadosAtualizacao.TXTCONVOCACAO || !dadosAtualizacao.LINKCONVOCACAO) {
          console.error(`[DISPARAR] Dados incompletos para convocação ${idConvocacao}:`, dadosAtualizacao);
          atualizacoesErro++;
          continue;
        }
        
        _log(`[DISPARAR] Atualizando convocação ${idConvocacao} com dados:`, {
          NRCELULAR: dadosAtualizacao.NRCELULAR || 'não informado',
          TXTCONVOCACAO: dadosAtualizacao.TXTCONVOCACAO ? `${dadosAtualizacao.TXTCONVOCACAO.substring(0, 50)}...` : 'vazio',
          LINKCONVOCACAO: dadosAtualizacao.LINKCONVOCACAO || 'vazio'
        });
        
        // Atualizar convocação no banco com todos os dados
        atualizacoesPromises.push(
          fetch(`/api/convocacoes/${idConvocacao}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(dadosAtualizacao)
          }).then(async (response) => {
            const responseData = await response.json();
            if (!response.ok) {
              console.error(`[DISPARAR] Erro ao atualizar convocação ${idConvocacao}:`, responseData);
              atualizacoesErro++;
              return { success: false, id: idConvocacao, error: responseData };
            }
            _log(`[DISPARAR] Convocação ${idConvocacao} atualizada com sucesso. Linhas afetadas:`, responseData.rowsAffected);
            atualizacoesSucesso++;
            return { success: true, id: idConvocacao, response: responseData };
          }).catch(err => {
            console.error(`[DISPARAR] Erro ao atualizar convocação ${idConvocacao}:`, err);
            atualizacoesErro++;
            return { success: false, id: idConvocacao, error: err.message };
          })
        );
      }
      
      // Aguardar todas as atualizações (não falhar se algumas derem erro)
      const resultados = await Promise.allSettled(atualizacoesPromises);
      
      // Verificar resultados
      const sucessos = resultados.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
      const erros = resultados.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && !r.value.success)).length;
      
      _log(`[DISPARAR] Resultado das atualizações: ${sucessos} sucesso(s), ${erros} erro(s) de ${atualizacoesPromises.length} total`);
      
      // Preparar dados para envio ao webhook (reutilizar dados já gerados)
      // Primeiro, buscar convocações do banco para verificar DHENVIOMETA
      const convocacoesParaEnviar = [];
      
      for (const resultado of resultados) {
        if (resultado.status === 'fulfilled' && resultado.value && resultado.value.success) {
          const idConvocacao = resultado.value.id;
          const dadosGerados = dadosGeradosMap.get(idConvocacao);
          
          if (dadosGerados) {
            // Buscar convocação do banco para verificar DHENVIOMETA (PG pode devolver dhenviometa)
            try {
              const responseConvocacao = await fetch(`/api/convocacoes/${idConvocacao}`);
              if (responseConvocacao.ok) {
                const convocacaoCompleta = await responseConvocacao.json();
                const dhMeta = convocacaoCompleta.DHENVIOMETA ?? convocacaoCompleta.dhenviometa;
                const jaEnviado = dhMeta != null && String(dhMeta).trim() !== '';
                if (!jaEnviado) {
                  convocacoesParaEnviar.push(dadosGerados);
                } else {
                  _log(`[SWITCH DIGITAL] Convocação ${idConvocacao} já tem DHENVIOMETA — pulando fila em massa (fallback tentará envio se necessário).`);
                }
              } else {
                // Sem confirmação no servidor: não bloquear o disparo
                _log(`[SWITCH DIGITAL] Não foi possível ler convocação ${idConvocacao} (${responseConvocacao.status}); incluindo na fila mesmo assim.`);
                convocacoesParaEnviar.push(dadosGerados);
              }
            } catch (err) {
              _log(`[SWITCH DIGITAL] Erro ao verificar DHENVIOMETA da convocação ${idConvocacao}:`, err.message || err);
              convocacoesParaEnviar.push(dadosGerados);
            }
          }
        }
      }
      
      // Garantir que só enviamos convocações dos motoristas realmente selecionados (evita envio duplicado)
      const idsSelecionados = new Set((selecionados || []).map(m => String(m.CDCADASTRO_MOTORISTA)));
      const convocacoesFiltradas = convocacoesParaEnviar.filter(d => d.CDCADASTRO_MOTORISTA != null && idsSelecionados.has(String(d.CDCADASTRO_MOTORISTA)));
      if (convocacoesFiltradas.length !== convocacoesParaEnviar.length) {
        _log('[SWITCH DIGITAL] Ajuste: enviando apenas', convocacoesFiltradas.length, 'convocação(ões) dos selecionados.');
      }
      convocacoesParaEnviar.length = 0;
      convocacoesParaEnviar.push(...convocacoesFiltradas);
      
      // Enviar dados para o webhook (Backend vai cuidar do Switch Digital)
      let envioJaFeitoViaEmMassa = false;
      if (convocacoesParaEnviar.length > 0) {
        try {
          await validarSaudeSwitchDigitalAntesDoDisparo(idViagemLocal, convocacoesParaEnviar.length);

          // Log detalhado de envio (F12)
          _log('========================================');
          _log(`[SWITCH DIGITAL] 📤 Solicitando envio de ${convocacoesParaEnviar.length} convocações ao Backend`);
          _log('========================================');
          
          // Feedback imediato na tela (ao atualizar logs, a deduplicação no merge evita duplicar com o que vem da API)
          if (typeof window.adicionarLogSwitch === 'function') {
            window.adicionarLogSwitch({
              tipo: 'info',
              titulo: `Iniciando Envios via Backend`,
              mensagem: `Enviando lista de ${convocacoesParaEnviar.length} motorista(s) para o processador de fila do servidor.`,
              detalhes: `Aguarde, as mensagens serão enviadas com intervalo de 2 segundos cada...`,
              idViagem: idViagemLocal
            });
          }

          // Formatar as convocacoes para envio com nomes corretos esperados pelo backend
          const convocacoesFormatadas = convocacoesParaEnviar.map(conv => {
            return {
              ...conv,
              IDCONVOCACAO: conv.IDCONVOCACAO || conv.idconvocacao,
              FONE: conv.NRCELULAR || conv.CELULAR || conv.FONE1 || '',
              NOME_MOTORISTA: conv.NOME_MOTORISTA || conv.nome_motorista || 'Motorista',
              ORIGEM_CIDADE: viagemAtual.ORIGEM_CIDADE || '',
              ORIGEM_ESTADO: viagemAtual.ORIGEM_ESTADO || '',
              DESTINO_CIDADE: viagemAtual.DESTINO_CIDADE || '',
              DESTINO_ESTADO: viagemAtual.DESTINO_ESTADO || '',
              VLFRETE: viagemAtual.VLFRETE || 0,
              PESO: viagemAtual.PESO || 0
            };
          });

          console.log('[SWITCH DIGITAL] Payload preparado (massa):', convocacoesFormatadas);

          // Obter URL pública para o link de aceitar/recusar no corpo da mensagem
          let baseUrl = window.location.origin;
          try {
            const urlRes = await fetch('/api/public-url');
            if (urlRes.ok) {
              const urlData = await urlRes.json();
              if (urlData && urlData.url) baseUrl = urlData.url;
            }
          } catch (e) { /* usa origin */ }

          // Enviar requisição para nossa nova rota no backend
          console.log('[SWITCH DIGITAL LOG] Fluxo EM MASSA - chamando fetch /api/viagens/webhook/switch-digital');
          const response = await fetchApiViagens('/webhook/switch-digital', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              viagemId: typeof idViagemLocal !== 'undefined' ? idViagemLocal : (typeof viagemSelecionada !== 'undefined' ? viagemSelecionada : null),
              convocacoes: convocacoesFormatadas,
              baseUrl: baseUrl
            })
          });
          
          console.log('[SWITCH DIGITAL] Resposta recebida (massa):', response.status);
          const errMassa = await rejeicaoSeRespostaNaoOk(response, `Erro ao enviar fila Switch Digital (${response.status})`);
          if (errMassa) throw errMassa;
          const resultData = await response.json();
          
          _log(`[SWITCH DIGITAL] ✅ Backend recebeu a fila com sucesso:`, resultData);
          
          const motoristasFormatados = resultData.detalhes || [];
          if (typeof window.adicionarLogSwitch === 'function') {
            window.adicionarLogSwitch({
              tipo: resultData.erros > 0 ? (resultData.sucessos > 0 ? 'warning' : 'erro') : 'sucesso',
              titulo: `Fila Processada no Backend`,
              mensagem: `O Servidor concluiu a fila de disparos. Sucessos: ${resultData.sucessos}, Erros: ${resultData.erros}`,
              detalhes: motoristasFormatados,
              idViagem: idViagemLocal
            });
          }

          if (resultData.erros > 0) {
             showMessage(`Atenção: A fila foi processada, mas houve erro no envio de ${resultData.erros} de ${resultData.total} mensagens. Verifique a aba de Integração Switch.`, 'warning');
          } else {
             showMessage(`${resultData.sucessos} mensagem(ns) de WhatsApp enfileirada(s) e enviada(s) com sucesso via Switch Digital!`, 'success');
          }
          
          envioJaFeitoViaEmMassa = true; // Evitar chamar dispararWhatsAppSwitchDigital de novo (duplicava envio e mensagens)
          
          // Limpar seleção
          if (typeof motoristasCompatíveis !== 'undefined') {
             motoristasCompatíveis.forEach(m => m.selecionado = false);
             if (typeof atualizarContadorSelecionados === 'function') atualizarContadorSelecionados();
          }
          const checkboxes = document.querySelectorAll('.check-motorista:checked, .motorista-checkbox:checked');
          checkboxes.forEach(cb => cb.checked = false);
          
        } catch (webhookErr) {
          console.error(`[SWITCH DIGITAL ENVIO] ❌ Erro ao processar fila:`, webhookErr);
          
          // Adicionar log de erro na tela
          if (typeof window.adicionarLogSwitch === 'function') {
            window.adicionarLogSwitch({
              tipo: 'erro',
              titulo: `❌ Erro no Processamento`,
              mensagem: `Falha ao tentar solicitar o envio das mensagens de WhatsApp pelo backend: ${webhookErr.message}`,
              detalhes: webhookErr.stack,
              idViagem: idViagemLocal
            });
          }
          showMessage(`Erro ao disparar WhatsApp: ${webhookErr.message}`, tipoMensagemErroHttp(webhookErr));
        }
      }
      
      if (erros > 0) {
        showMessage(`${result.message || 'Convocações criadas'} | ${sucessos} atualizada(s) com sucesso, ${erros} com erro(s). Verifique o console para detalhes.`, erros === atualizacoesPromises.length ? 'error' : 'warning');
      } else {
        showMessage(`${result.message || 'Convocações disparadas com sucesso!'} | Todos os campos foram atualizados.`, 'success');
        
        // Log de envio WhatsApp automático
        if (window.logWhatsAppAutomatico && sucessos > 0) {
          window.logWhatsAppAutomatico(idParaBuscar, sucessos, {
            totalAtualizacoes: atualizacoesPromises.length,
            sucessos: sucessos,
            erros: erros,
            convocoesEnviadasWebhook: convocacoesParaEnviar.length
          });
        }
      }
      
      // Limpar seleções
      if (typeof motoristasCompatíveis !== 'undefined') {
         motoristasCompatíveis.forEach(m => m.selecionado = false);
      }
      if (typeof atualizarContadorSelecionados === 'function') atualizarContadorSelecionados();
      renderizarMotoristasCompatíveis();
      
      // Só chamar dispararWhatsAppSwitchDigital se NÃO já enviamos via fluxo "em massa" acima
      // (senão duplicava: uma requisição no bloco convocacoesParaEnviar.length > 0 e outra aqui)
      if (!envioJaFeitoViaEmMassa) {
        const getIdConv = (c) => c.IDCONVOCACAO ?? c.idConvocacao ?? c.idconvocacao;
        const idsConvocacoes = todasConvocacoes.map(getIdConv).filter(id => id != null && id !== '');
        if (!window.convocacoes) window.convocacoes = [];
        todasConvocacoes.forEach(nc => {
           const idConv = getIdConv(nc);
           const exists = window.convocacoes.find(ec => (ec.IDCONVOCACAO ?? ec.idconvocacao) == idConv);
           if (!exists) {
              const motOrig = selecionados.find(s => s.CDCADASTRO_MOTORISTA === nc.CDCADASTRO_MOTORISTA);
              window.convocacoes.push({
                 ...nc,
                 IDCONVOCACAO: idConv,
                 IDVIAGEM: nc.IDVIAGEM ?? idViagemLocal,
                 NOME_MOTORISTA: nc.NOME_MOTORISTA || (motOrig ? motOrig.NOME || motOrig.NOME_MOTORISTA : 'Motorista'),
                 NRCELULAR: nc.NRCELULAR || (motOrig ? motOrig.CELULAR || motOrig.FONE1 || motOrig.NRCELULAR : ''),
                 CELULAR: nc.CELULAR || (motOrig ? motOrig.CELULAR || motOrig.FONE1 || motOrig.NRCELULAR : ''),
                 FONE: nc.FONE || nc.FONE1 || nc.CELULAR || nc.NRCELULAR || (motOrig ? motOrig.CELULAR || motOrig.FONE1 || motOrig.NRCELULAR : '')
              });
           }
        });
        _log('[SWITCH DIGITAL] Chamando API do Switch Digital com IDs da criacao:', idsConvocacoes);
        try {
          await dispararWhatsAppSwitchDigital(idViagemLocal, idsConvocacoes);
        } catch (e) {
          console.error('[SWITCH DIGITAL] dispararWhatsAppSwitchDigital (fallback):', e);
        }
        const filtroConvEl = document.getElementById('filtroConvocacaoViagem');
        if (filtroConvEl) filtroConvEl.value = idViagemLocal;
        if (typeof window.carregarConvocacoes === 'function') window.carregarConvocacoes();
      }
      
    } catch (err) {
      console.error('Erro ao disparar convocações:', err);
      showMessage(err.message || 'Erro ao disparar convocações.', tipoMensagemErroHttp(err));
    }
  }

  // ========== FUNCIONALIDADES DA SWITCH DIGITAL ==========
  
  // Função para abrir o modal de disparo WhatsApp
  window.abrirModalDisparoWhatsApp = function() {
    let motoristasSelecionados = [];
    if (typeof motoristasCompatíveis !== 'undefined' && motoristasCompatíveis.length > 0) {
       motoristasSelecionados = motoristasCompatíveis.filter(m => m.selecionado);
    }
    
    // Se não encontrou no array de compatíveis, tenta pegar pelos checkboxes na tela principal
    if (motoristasSelecionados.length === 0) {
       const checkboxes = document.querySelectorAll('.motorista-checkbox:checked, .check-motorista:checked');
       checkboxes.forEach(cb => {
         // Tenta pegar o ID do checkbox ou do atributo data-id ou do atributo id (que no input gerado é check-${index})
         let id = cb.value || cb.getAttribute('data-id');
         
         // No caso de "Compatíveis", o value/data-id pode não estar definido, mas o checkbox tem data-index.
         if (!id && cb.hasAttribute('data-index') && typeof motoristasCompatíveis !== 'undefined') {
            const index = cb.getAttribute('data-index');
            if (motoristasCompatíveis[index]) {
               motoristasSelecionados.push(motoristasCompatíveis[index]);
               return; // já processado
            }
         }
         
         // Buscar no array global de convocações se existir
         if (id && window.convocacoes) {
            const conv = window.convocacoes.find(c => String(c.IDCONVOCACAO) === String(id) || String(c.CDMOTORISTA) === String(id) || String(c.CDCADASTRO_MOTORISTA) === String(id));
            if (conv) {
               motoristasSelecionados.push(conv);
            } else {
               // Adicionando um objeto mínimo que será depois completado pela API
               motoristasSelecionados.push({ id, IDCONVOCACAO: id, CDCADASTRO_MOTORISTA: id });
            }
         } else if (id) {
            // Aba Convocações: se for número pequeno, provavelmente é o IDCONVOCACAO.
            motoristasSelecionados.push({ id, IDCONVOCACAO: id, CDCADASTRO_MOTORISTA: id });
         }
       });
    }

    if (motoristasSelecionados.length === 0) {
      showMessage('Selecione pelo menos um motorista para enviar mensagens.', 'warning');
      return;
    }
    
    // Identificar a viagem atual: se estiver na aba Convocações, usar o filtro da aba; senão viagem em edição/compatíveis
    const tabConv = document.getElementById('tab-convocações') || document.querySelector('.tab-content[data-tab-id="convocações"]');
    const filtroConvVal = document.getElementById('filtroConvocacaoViagem')?.value?.trim();
    const abaConvAtiva = tabConv && tabConv.classList.contains('active');
    const idViagemLocal = (abaConvAtiva && filtroConvVal) ? filtroConvVal : (document.getElementById('viagemId')?.value?.trim() || window.viagemAtual?.IDVIAGEM || window.viagemSelecionada || filtroConvVal || null);
    if (!idViagemLocal) {
      showMessage('Selecione uma viagem primeiro.', 'warning');
      return;
    }
    
    // Adicionar log na aba (sem precisar abrir o modal ainda)
    if (typeof window.adicionarLogSwitch === 'function') {
      window.adicionarLogSwitch({
        tipo: 'info',
        titulo: 'Preparando Disparo',
        mensagem: `Preparando para enviar WhatsApp para ${motoristasSelecionados.length} motorista(s) selecionado(s).`,
        idViagem: idViagemLocal
      });
    }
    
    // Identificar o contexto: Se os motoristas vêm da aba "Compatíveis", eles não têm uma Convocação criada no BD (geralmente não tem IDCONVOCACAO ou tem mas está mesclado do join).
    // O mais seguro na aba de Compatíveis é rodar enviarAnuncioWhatsApp que cria/atualiza a convocação antes.
    const tabCompativeis = document.getElementById('tab-compatíveis');
    const isAbaCompativeis = tabCompativeis && tabCompativeis.classList.contains('active');
    
    // Se isAbaCompativeis, usar o fluxo de disparo automático (Switch Digital) direto.
    // Evita cair no modal de links manuais quando vários motoristas são selecionados.
    if (isAbaCompativeis) {
       // Quando vem dos compatíveis, `enviarAnuncioWhatsApp` pega de `motoristasCompatíveis.filter(m => m.selecionado)` 
       // Entao precisamos garantir que a flag .selecionado está true.
       motoristasSelecionados.forEach(m => {
          if (m && typeof m === 'object') m.selecionado = true;
       });
       dispararConvocacoes();
    } else {
       // Aba Convocações: as convocações já existem
       // Para não dar erro de map se algum for undefined:
       const ids = motoristasSelecionados.filter(m => m).map(m => m.IDCONVOCACAO || m.CDCADASTRO_MOTORISTA || m.id);
       
       if (ids.length === 0) {
          showMessage("Não foi possível identificar os IDs das convocações selecionadas.", "error");
          return;
       }
       
       dispararWhatsAppSwitchDigital(idViagemLocal, ids);
    }
  };

  async function dispararWhatsAppSwitchDigital(idViagem, convocacoesIds) {
    const btnDisparar = document.getElementById('btnDispararConvocacoes');
    const textOriginal = btnDisparar ? btnDisparar.innerHTML : '';
    try {
      console.log('[SWITCH DIGITAL LOG] dispararWhatsAppSwitchDigital chamado - idViagem=', idViagem, 'convocacoesIds=', convocacoesIds?.length, 'ts=', new Date().toISOString());
      // Mostrar feedback na tela
      if (btnDisparar) {
        btnDisparar.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Processando Fila...`;
        btnDisparar.disabled = true;
      }

      // Normalizar IDs para comparação (número e string)
      const idsNorm = new Set();
      (convocacoesIds || []).forEach(id => {
        if (id != null && id !== '') {
          idsNorm.add(Number(id));
          idsNorm.add(String(id));
        }
      });

      const convMatch = (c) => {
        const idConv = c.IDCONVOCACAO ?? c.idConvocacao;
        const idMot = c.CDMOTORISTA ?? c.cdmotorista;
        const idCad = c.CDCADASTRO_MOTORISTA ?? c.cdcadastro_motorista;
        return (idConv != null && (idsNorm.has(Number(idConv)) || idsNorm.has(String(idConv)))) ||
               (idMot != null && (idsNorm.has(Number(idMot)) || idsNorm.has(String(idMot)))) ||
               (idCad != null && (idsNorm.has(Number(idCad)) || idsNorm.has(String(idCad))));
      };

      // Buscar os dados completos das convocações selecionadas a partir do array global
      const baseBusca = window.convocacoes && window.convocacoes.length > 0 ? window.convocacoes : (typeof motoristasCompatíveis !== 'undefined' ? motoristasCompatíveis : []);
      let convsCompletas = baseBusca.filter(convMatch);

      // Se a base de busca (frontend) não tiver todos os dados, recarregar da API
      if (convsCompletas.length === 0 && idViagem) {
         _log('[SWITCH DIGITAL] Buscando convocações direto da API, base frontend não tinha os dados correspondentes aos IDs', convocacoesIds);
         try {
            const resp = await fetch(`/api/convocacoes?idViagem=${idViagem}`);
            if (resp.ok) {
               const apiconvs = await resp.json();
               convsCompletas = apiconvs.filter(convMatch);
            }
         } catch (e) {
            console.error("Falha ao buscar convocações da api", e);
         }
      }

      if (convsCompletas.length === 0) {
        if (btnDisparar) {
           btnDisparar.innerHTML = textOriginal;
           btnDisparar.disabled = false;
        }
        throw new Error("Não foi possível encontrar os detalhes das convocações selecionadas na tela ou na API.");
      }

      // Adicionar log na tela informando que iniciou o processo no backend
      if (typeof window.adicionarLogSwitch === 'function') {
         console.log('[SWITCH DIGITAL LOG] Front adicionando "Iniciando Envios" em _listaLogsSwitch');
         window.adicionarLogSwitch({
           tipo: 'info',
           titulo: `Iniciando Envios via Backend (Switch Digital)`,
           mensagem: `Enviando lista de ${convsCompletas.length} convocações para processamento na fila.`,
           detalhes: convsCompletas,
           idViagem: idViagem
         });
      }

      // Formatar as convocacoes para envio com nomes corretos esperados pelo backend (IDCONVOCACAO obrigatório para logs)
      const getIdConv = (c) => c.IDCONVOCACAO ?? c.idConvocacao ?? c.idconvocacao;
      const viagemAtual = window.viagemAtual || {};
      const convocacoesFormatadas = convsCompletas.map(conv => {
         const idConv = getIdConv(conv);
         return {
           ...conv,
           IDCONVOCACAO: idConv,
           FONE: conv.FONE || conv.NRCELULAR || conv.CELULAR || conv.FONE1 || '',
           NOME_MOTORISTA: conv.NOME_MOTORISTA || conv.nome_motorista || 'Motorista',
           ORIGEM_CIDADE: viagemAtual.ORIGEM_CIDADE || conv.ORIGEM_CIDADE || '',
           ORIGEM_ESTADO: viagemAtual.ORIGEM_ESTADO || conv.ORIGEM_ESTADO || '',
           DESTINO_CIDADE: viagemAtual.DESTINO_CIDADE || conv.DESTINO_CIDADE || '',
           DESTINO_ESTADO: viagemAtual.DESTINO_ESTADO || conv.DESTINO_ESTADO || '',
           VLFRETE: viagemAtual.VLFRETE || conv.VLFRETE || 0,
           PESO: viagemAtual.PESO || conv.PESO || 0
         };
      });

      console.log('[SWITCH DIGITAL] Payload preparado:', convocacoesFormatadas);

      // Obter URL pública para o link de aceitar/recusar no corpo da mensagem
      let baseUrl = window.location.origin;
      try {
        const urlRes = await fetch('/api/public-url');
        if (urlRes.ok) {
          const urlData = await urlRes.json();
          if (urlData && urlData.url) baseUrl = urlData.url;
        }
      } catch (e) { /* usa origin */ }

      // 1. Chamar o backend
      await validarSaudeSwitchDigitalAntesDoDisparo(idViagem, convocacoesFormatadas.length);

      console.log('[SWITCH DIGITAL] Disparando requisição para:', urlApiViagens('/webhook/switch-digital'));
      const response = await fetchApiViagens('/webhook/switch-digital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viagemId: idViagem,
          convocacoes: convocacoesFormatadas,
          baseUrl: baseUrl
        })
      });

      console.log('[SWITCH DIGITAL] Resposta recebida:', response.status);
      const errSwitch = await rejeicaoSeRespostaNaoOk(response, `Erro ao enviar fila Switch Digital (${response.status})`);
      if (errSwitch) throw errSwitch;
      const resultData = await response.json();
      
      const motoristasFormatados = resultData.detalhes || [];
      
      // Adicionar log final
      if (typeof window.adicionarLogSwitch === 'function') {
         console.log('[SWITCH DIGITAL LOG] Front adicionando "Fila Processada" em _listaLogsSwitch');
         window.adicionarLogSwitch({
           tipo: resultData.erros > 0 ? (resultData.sucessos > 0 ? 'warning' : 'erro') : 'sucesso',
           titulo: `Fila Processada no Backend`,
           mensagem: `O Servidor concluiu a fila de disparos. Sucessos: ${resultData.sucessos}, Erros: ${resultData.erros}`,
           detalhes: motoristasFormatados,
           idViagem: idViagem
         });
      }

      if (resultData.erros > 0) {
        showMessage(`Atenção: Houve erro no envio de ${resultData.erros} de ${resultData.total} mensagens. Verifique a aba de Integração Switch.`, 'warning');
      } else {
        showMessage(`${resultData.sucessos} mensagem(ns) de WhatsApp enviada(s) com sucesso via Switch Digital!`, 'success');
      }

      // Limpar checkboxes
      const checkboxes = document.querySelectorAll('.check-motorista:checked, .motorista-checkbox:checked');
      checkboxes.forEach(cb => cb.checked = false);
      if(document.getElementById('checkAll')) document.getElementById('checkAll').checked = false;
      if(document.getElementById('selectAllMotoristas')) document.getElementById('selectAllMotoristas').checked = false;
      
      // Limpar seleção no array global se for motorista compatível
      if (typeof motoristasCompatíveis !== 'undefined') {
         motoristasCompatíveis.forEach(m => m.selecionado = false);
         if (typeof atualizarContadorSelecionados === 'function') atualizarContadorSelecionados();
      }

      // Voltar botao
      if (btnDisparar) {
        btnDisparar.innerHTML = textOriginal;
        btnDisparar.disabled = false;
      }
      
      // Recarregar os dados para atualizar a tela
      if (typeof window.carregarConvocacoes === 'function') window.carregarConvocacoes();

    } catch (err) {
      console.error('Erro ao disparar WhatsApp Switch:', err);
      
      if (typeof window.adicionarLogSwitch === 'function') {
        window.adicionarLogSwitch({
          tipo: 'erro',
          titulo: `Erro no Disparo`,
          mensagem: err.message,
          detalhes: err.stack,
          idViagem: idViagem
        });
      }
      showMessage(`Erro ao disparar WhatsApp: ${err.message}`, tipoMensagemErroHttp(err));
      
      const btnDisparar = document.getElementById('btnDispararConvocacoes');
      if (btnDisparar) {
        btnDisparar.innerHTML = textOriginal;
        btnDisparar.disabled = false;
      }
    }
  }

  // ============================================
  // Logs da Integração Switch (visor + API)
  if (typeof window._listaLogsSwitch === 'undefined') window._listaLogsSwitch = [];

  function atualizarVisorLogsSwitch(entries) {
    const container = document.getElementById('logsIntegracaoSwitch');
    const totalEl = document.getElementById('totalEnviosSwitch');
    const sucessosEl = document.getElementById('totalSucessosSwitch');
    const errosEl = document.getElementById('totalErrosSwitch');
    const ultimaEl = document.getElementById('ultimaAtualizacaoSwitch');
    let list = entries != null ? entries : (window._listaLogsSwitch || []);
    const idViagemAtual = document.getElementById('viagemId')?.value || document.getElementById('filtroConvocacaoViagem')?.value || document.getElementById('filtroIdViagem')?.value || '';
    if (idViagemAtual && list === window._listaLogsSwitch) {
      list = list.filter(e => e.idViagem == null || e.idViagem === '' || String(e.idViagem) === String(idViagemAtual));
    }
    let sucessos = 0, erros = 0;
    // 1) Resumo "Fila Processada" (Sucessos: X, Erros: Y) quando existir
    const reFila = /Sucessos:\s*(\d+).*?Erros:\s*(\d+)/i;
    list.forEach(e => {
      const msg = (e.mensagem || '') + (e.titulo || '');
      const m = reFila.exec(msg);
      if (m) {
        sucessos += parseInt(m[1], 10) || 0;
        erros += parseInt(m[2], 10) || 0;
      }
    });
    // 2) Se não houve linha de fila (ex.: só logs gravados no banco), contar cada envio_switch individual
    if (sucessos === 0 && erros === 0) {
      list.forEach(e => {
        const tit = (e.titulo || '');
        if (/Switch Digital\s*-\s*Enviado/i.test(tit)) sucessos += 1;
        else if (/Switch Digital\s*-\s*Erro/i.test(tit)) erros += 1;
      });
    }
    const totalEnvios = sucessos + erros;
    if (totalEl) totalEl.textContent = totalEnvios;
    if (sucessosEl) sucessosEl.textContent = sucessos;
    if (errosEl) errosEl.textContent = erros;
    if (ultimaEl) ultimaEl.textContent = list.length ? new Date().toLocaleString('pt-BR') : '-';
    if (!container) return;
    if (list.length === 0) {
      container.innerHTML = '<div style="color: #6c757d; text-align: center; padding: 40px; line-height: 1.6;">' +
        '<strong>Nenhum log disponível.</strong><br><br>' +
        '• Clique em <strong>Atualizar Logs</strong> para carregar do servidor.<br>' +
        '• Inclui envios da <strong>fila Switch</strong> na aba Convocações, da <strong>campanha de oportunidades</strong> e registros antigos em <strong>LOG_ENVIO_WHATSAPP</strong> (unificados na mesma lista).<br>' +
        '• Se ainda não vê nada, confira convocações para a viagem e a integração Switch em Configurações do Sistema.</div>';
      return;
    }
    const cabecalhoViagem = idViagemAtual ? `<div style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.25); border-radius: 4px; font-size: 12px; color: #94a3b8;"><strong>Exibindo logs da Viagem ${idViagemAtual}</strong> (viagem selecionada na aba Dados / Grid / Convocações)</div>` : '';
    const escapeHtmlLog = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const normalizeDetailText = (v) => String(v == null ? '' : v)
      .replace(/Atendente:\s*(undefined|null)\b/gi, 'Atendente: não informado');
    const formatarDetalheExpandivel = (detalhes, tipo) => {
      if (!detalhes) return '';
      const detalheRaw = typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes);
      const detalheNorm = normalizeDetailText(detalheRaw || '').substring(0, 2500);
      const detalheEsc = escapeHtmlLog(detalheNorm);
      const knownTicket = /ticket em outro atendimento|conversa em aberto|atendimento em aberto/i.test(detalheNorm);
      const resumo = knownTicket
        ? 'Detalhes técnicos (ticket já aberto no atendimento)'
        : (tipo === 'erro' ? 'Detalhes técnicos do erro' : 'Detalhes técnicos');
      return `<details style="margin-top: 6px;">
        <summary style="cursor: pointer; font-size: 11px; color: #93c5fd;">${resumo}</summary>
        <pre style="margin: 6px 0 0 0; font-size: 11px; white-space: pre-wrap; word-break: break-all; overflow-wrap: break-word; max-width: 100%; overflow-x: auto;">${detalheEsc}</pre>
      </details>`;
    };
    const html = cabecalhoViagem + list.map(e => {
      const cor = e.tipo === 'erro' ? '#dc3545' : e.tipo === 'warning' ? '#ffc107' : e.tipo === 'sucesso' ? '#28a745' : '#17a2b8';
      const detalhesHtml = formatarDetalheExpandivel(e.detalhes, e.tipo);
      const idV = e.idViagem != null && e.idViagem !== '' ? String(e.idViagem) : null;
      const badgeViagem = idV ? `<span style="font-size: 10px; color: #94a3b8; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; margin-left: 8px;" title="Viagem a que este log pertence">Viagem ${idV}</span>` : '';
      return `<div style="margin-bottom: 12px; padding: 10px; border-left: 4px solid ${cor}; background: rgba(0,0,0,0.2); border-radius: 4px; max-width: 100%; overflow-wrap: break-word; word-break: break-word; box-sizing: border-box;">
        <strong style="color: ${cor}">${e.titulo || e.tipo || 'Log'}</strong>${badgeViagem}
        <div style="margin-top: 4px; overflow-wrap: break-word; word-break: break-word;">${escapeHtmlLog(normalizeDetailText(e.mensagem || ''))}</div>
        ${detalhesHtml}
        <div style="margin-top: 4px; font-size: 11px; color: #888;">${e.dhlog ? new Date(e.dhlog).toLocaleString('pt-BR') : (e.ts ? new Date(e.ts).toLocaleString('pt-BR') : '')}</div>
      </div>`;
    }).join('');
    container.innerHTML = html;
  }

  window.adicionarLogSwitch = function(entry) {
    if (!entry) return;
    const idViagem = entry.idViagem != null ? entry.idViagem : (document.getElementById('viagemId')?.value || document.getElementById('filtroConvocacaoViagem')?.value || document.getElementById('filtroIdViagem')?.value || '');
    window._listaLogsSwitch = window._listaLogsSwitch || [];
    window._listaLogsSwitch.unshift({ ...entry, idViagem: idViagem || entry.idViagem, ts: Date.now() });
    atualizarVisorLogsSwitch();
  };

  function atualizarBadgeSaudeSwitch(status, texto) {
    const badge = document.getElementById('switchSaudeBadge');
    if (!badge) return;
    badge.classList.remove('switch-saude-badge--ok', 'switch-saude-badge--down', 'switch-saude-badge--loading');
    if (status === 'ok') badge.classList.add('switch-saude-badge--ok');
    else if (status === 'down') badge.classList.add('switch-saude-badge--down');
    else badge.classList.add('switch-saude-badge--loading');
    badge.textContent = texto || 'Sessão Switch: verificando...';
  }

  window.verificarSaudeSwitchBadge = async function() {
    const tabIntegracaoSwitch = document.getElementById('tab-integracao-switch');
    if (!tabIntegracaoSwitch || !tabIntegracaoSwitch.classList.contains('active')) return;

    const idViagem = document.getElementById('filtroIdViagem')?.value
      || document.getElementById('viagemId')?.value
      || document.getElementById('filtroConvocacaoViagem')?.value
      || '';
    atualizarBadgeSaudeSwitch('loading', 'Sessão Switch: verificando...');
    try {
      const response = await fetchApiViagens('/webhook/switch-digital/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viagemId: idViagem || null })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload && payload.healthy === true) {
        atualizarBadgeSaudeSwitch('ok', 'Sessão Switch: ativa');
      } else {
        atualizarBadgeSaudeSwitch('down', 'Sessão Switch: inativa');
      }
    } catch (err) {
      atualizarBadgeSaudeSwitch('down', 'Sessão Switch: inativa');
    }
  };

  window.limparVisorLogsSwitch = function() {
    window._listaLogsSwitch = [];
    atualizarVisorLogsSwitch();
  };

  window.carregarLogsSwitch = async function() {
    const idViagem = document.getElementById('filtroIdViagem')?.value || document.getElementById('viagemId')?.value || document.getElementById('filtroConvocacaoViagem')?.value || '';
    const container = document.getElementById('logsIntegracaoSwitch');
    if (!container) return;
    if (!idViagem || String(idViagem).trim() === '') {
      container.innerHTML = '<div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border-radius: 8px;"><strong>Nenhuma viagem selecionada.</strong><br>Selecione uma viagem na aba Dados ou Grid e clique em Atualizar Logs.</div>';
      const totalEl = document.getElementById('totalEnviosSwitch');
      const sucessosEl = document.getElementById('totalSucessosSwitch');
      const errosEl = document.getElementById('totalErrosSwitch');
      const ultimaEl = document.getElementById('ultimaAtualizacaoSwitch');
      if (totalEl) totalEl.textContent = '0';
      if (sucessosEl) sucessosEl.textContent = '0';
      if (errosEl) errosEl.textContent = '0';
      if (ultimaEl) ultimaEl.textContent = '-';
      if (typeof window.verificarSaudeSwitchBadge === 'function') window.verificarSaudeSwitchBadge();
      return;
    }
    try {
      const res = await fetch('/api/logs-webhook-meta?idViagem=' + encodeURIComponent(idViagem.trim()) + '&limite=250');
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        container.innerHTML = '<div style="color: #721c24; text-align: center; padding: 40px; background: #f8d7da; border-radius: 8px;">' +
          '<strong>Erro ao carregar logs.</strong><br>' + (errBody.details || errBody.error || 'Verifique o console do servidor (F12) e se a tabela LOGSWEBHOOKMETA existe no banco.') + '</div>';
        return;
      }
      const logs = await res.json();
      const list = Array.isArray(logs) ? logs : [];
      const idViagemReq = String(idViagem).trim();
      const entries = list.map(l => {
        const tipoRaw = l.tipo || l.TIPO || 'info';
        const tituloRaw = l.titulo || l.TITULO || tipoRaw || 'Log';
        const mensagemRaw = l.mensagem || l.MENSAGEM || '';
        const dhlogRaw = l.dhlog || l.DHLOG || l.timestamp;
        return {
          tipo: (tipoRaw === 'envio_switch' && mensagemRaw.indexOf('Enviado') >= 0) ? 'sucesso' : (tipoRaw === 'envio_switch' && mensagemRaw.indexOf('Erro') >= 0) ? 'erro' : (tipoRaw === 'erro' ? 'erro' : tipoRaw === 'sucesso' ? 'sucesso' : tipoRaw === 'warning' ? 'warning' : 'info'),
          titulo: tituloRaw,
          mensagem: mensagemRaw,
          detalhes: l.detalhes != null ? l.detalhes : l.DETALHES,
          dhlog: dhlogRaw,
          ts: dhlogRaw ? new Date(dhlogRaw).getTime() : null,
          idViagem: l.idViagem != null ? l.idViagem : (l.IDVIAGEM != null ? l.IDVIAGEM : idViagemReq)
        };
      });
      const merged = [...entries];
      const fingerprint = (e) => {
        const t = (e.dhlog ? new Date(e.dhlog).getTime() : e.ts || 0) / 60000 | 0;
        return (e.titulo || '') + '|' + (e.mensagem || '').substring(0, 80) + '|' + t;
      };
      const apiFingerprints = new Set(merged.map(fingerprint));
      const idViagemStr = String(idViagem).trim();
      const memFiltrados = (window._listaLogsSwitch || []).filter(e => e.ts && (!e.idViagem || String(e.idViagem) === idViagemStr));
      const memCount = (window._listaLogsSwitch || []).filter(e => e.ts).length;
      memFiltrados.forEach(e => {
        const entry = { ...e, dhlog: e.dhlog || new Date(e.ts).toISOString() };
        if (!apiFingerprints.has(fingerprint(entry))) merged.push(entry);
      });
      merged.sort((a, b) => (b.dhlog ? new Date(b.dhlog).getTime() : b.ts || 0) - (a.dhlog ? new Date(a.dhlog).getTime() : a.ts || 0));
      console.log('[SWITCH DIGITAL LOG] carregarLogsSwitch - API entries=', entries.length, 'memória=', memCount, 'merged total=', merged.length);
      atualizarVisorLogsSwitch(merged.slice(0, 250));
      if (typeof window.verificarSaudeSwitchBadge === 'function') window.verificarSaudeSwitchBadge();
    } catch (err) {
      console.error('Erro ao carregar logs Switch:', err);
      atualizarVisorLogsSwitch(window._listaLogsSwitch || []);
      if (typeof window.verificarSaudeSwitchBadge === 'function') window.verificarSaudeSwitchBadge();
    }
  };

  // Botões da aba Switch Digital (delegação: funciona com HTML injetado pelo dashboard)
  document.addEventListener('click', function(e) {
    const target = e.target && (e.target.id === 'btnAtualizarLogsSwitch' ? e.target : e.target.closest('#btnAtualizarLogsSwitch'));
    if (target) {
      e.preventDefault();
      if (typeof window.carregarLogsSwitch === 'function') window.carregarLogsSwitch();
      if (typeof window.verificarSaudeSwitchBadge === 'function') window.verificarSaudeSwitchBadge();
      return;
    }
    const targetLimpar = e.target && (e.target.id === 'btnLimparLogsSwitch' ? e.target : e.target.closest('#btnLimparLogsSwitch'));
    if (targetLimpar) {
      e.preventDefault();
      if (typeof window.limparVisorLogsSwitch === 'function') window.limparVisorLogsSwitch();
    }
  });

  // Recarregar logs quando viagem for selecionada (delegação em change/input)
  document.addEventListener('change', function(e) {
    const id = e.target && (e.target.id === 'filtroIdViagem' || e.target.id === 'viagemId' || e.target.id === 'filtroConvocacaoViagem');
    if (id) {
      const tabIntegracaoSwitch = document.getElementById('tab-integracao-switch');
      if (tabIntegracaoSwitch && tabIntegracaoSwitch.classList.contains('active')) {
        if (typeof window.carregarLogsSwitch === 'function') window.carregarLogsSwitch();
      }
    }
  });
  document.addEventListener('input', function(e) {
    const id = e.target && (e.target.id === 'filtroIdViagem' || e.target.id === 'viagemId' || e.target.id === 'filtroConvocacaoViagem');
    if (id) {
      const tabIntegracaoSwitch = document.getElementById('tab-integracao-switch');
      if (tabIntegracaoSwitch && tabIntegracaoSwitch.classList.contains('active')) {
        if (typeof window.carregarLogsSwitch === 'function') window.carregarLogsSwitch();
      }
    }
  });

  (function _initSwitchLogsOnce() {
    // Verificar se a aba Switch Digital já está ativa ao exibir o módulo (executa quando o script roda)
    setTimeout(() => {
      const tabIntegracaoSwitch = document.getElementById('tab-integracao-switch');
      if (tabIntegracaoSwitch && tabIntegracaoSwitch.classList.contains('active')) {
        if (typeof window.carregarLogsSwitch === 'function') window.carregarLogsSwitch();
        if (typeof window.verificarSaudeSwitchBadge === 'function') window.verificarSaudeSwitchBadge();
      }
    }, 500);
    
    // Legado: listeners diretos (podem não existir se DOM foi injetado depois)
    const filtroIdViagem = document.getElementById('filtroIdViagem');
    const viagemId = document.getElementById('viagemId');
    
    const recarregarLogsSeAbaAtiva = () => {
      const tabIntegracaoSwitch = document.getElementById('tab-integracao-switch');
      if (tabIntegracaoSwitch && tabIntegracaoSwitch.classList.contains('active')) {
        if (typeof window.carregarLogsSwitch === 'function') window.carregarLogsSwitch();
      }
    };
    
    if (filtroIdViagem) {
      filtroIdViagem.addEventListener('change', recarregarLogsSeAbaAtiva);
      filtroIdViagem.addEventListener('input', recarregarLogsSeAbaAtiva);
    }
    
    if (viagemId) {
      viagemId.addEventListener('change', recarregarLogsSeAbaAtiva);
      viagemId.addEventListener('input', recarregarLogsSeAbaAtiva);
    }
  })();
  
  // Expor função globalmente para teste no console
  // O usuário pode executar: window.carregarLogsMeta() no console para testar

  // ========== FUNCIONALIDADES DE CONVOCAÇÕES ==========
  
  let convocacoes = [];
  
  // Variável para controlar ordenação de convocações
  let ordenacaoConvocacoes = {
    campo: null,
    direcao: 'asc' // 'asc' ou 'desc'
  };

  // Função para ordenar convocações (tornada global para onclick)
  window.ordenarConvocacoes = function(campo) {
    if (ordenacaoConvocacoes.campo === campo) {
      // Se já está ordenando por este campo, inverte a direção
      ordenacaoConvocacoes.direcao = ordenacaoConvocacoes.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      // Novo campo, ordena ascendente
      ordenacaoConvocacoes.campo = campo;
      ordenacaoConvocacoes.direcao = 'asc';
    }

    convocacoes.sort((a, b) => {
      let valorA, valorB;

      switch (campo) {
        case 'id':
          valorA = parseInt(a.IDCONVOCACAO) || 0;
          valorB = parseInt(b.IDCONVOCACAO) || 0;
          break;
        case 'motorista':
          valorA = (a.NOME_MOTORISTA || '').toLowerCase();
          valorB = (b.NOME_MOTORISTA || '').toLowerCase();
          break;
        case 'freteProposto':
          valorA = Number(a.VL_FRETE_PROPOSTO_MOTORISTA ?? a.vl_frete_proposto_motorista);
          valorB = Number(b.VL_FRETE_PROPOSTO_MOTORISTA ?? b.vl_frete_proposto_motorista);
          if (!Number.isFinite(valorA)) valorA = -1;
          if (!Number.isFinite(valorB)) valorB = -1;
          break;
        case 'rota':
          valorA = ((a.ORIGEM_CIDADE || '') + ' ' + (a.DESTINO_CIDADE || '')).toLowerCase();
          valorB = ((b.ORIGEM_CIDADE || '') + ' ' + (b.DESTINO_CIDADE || '')).toLowerCase();
          break;
        case 'status':
          valorA = (a.STATUS || '').toLowerCase();
          valorB = (b.STATUS || '').toLowerCase();
          break;
        case 'dataConvocacao':
          valorA = a.DHCONVOCACAO ? new Date(a.DHCONVOCACAO).getTime() : 0;
          valorB = b.DHCONVOCACAO ? new Date(b.DHCONVOCACAO).getTime() : 0;
          break;
        case 'dataResposta':
          valorA = a.DHRESPOSTA ? new Date(a.DHRESPOSTA).getTime() : 0;
          valorB = b.DHRESPOSTA ? new Date(b.DHRESPOSTA).getTime() : 0;
          break;
        case 'placasConf':
          valorA = String(
            (a.FGCONFIRMACAOPLACAS ?? a.fgconfirmacaoplacas ?? '') +
              (a.TXTPLACASDIVERGENCIA ?? a.txtplacasdivergencia ?? '') +
              (a.PLACASESPERADAS ?? a.placasesperadas ?? '')
          ).toLowerCase();
          valorB = String(
            (b.FGCONFIRMACAOPLACAS ?? b.fgconfirmacaoplacas ?? '') +
              (b.TXTPLACASDIVERGENCIA ?? b.txtplacasdivergencia ?? '') +
              (b.PLACASESPERADAS ?? b.placasesperadas ?? '')
          ).toLowerCase();
          break;
        default:
          return 0;
      }

      if (valorA < valorB) return ordenacaoConvocacoes.direcao === 'asc' ? -1 : 1;
      if (valorA > valorB) return ordenacaoConvocacoes.direcao === 'asc' ? 1 : -1;
      return 0;
    });

    renderizarConvocacoes();
  };

  // Inicializar aba de Convocações
  function inicializarAbaConvocacoes() {
    const btnVoltar = document.getElementById('btnVoltarConvocacoes');
    const btnCarregar = document.getElementById('btnCarregarConvocacoes');
    const filtroViagem = document.getElementById('filtroConvocacaoViagem');
    const filtroStatus = document.getElementById('filtroConvocacaoStatus');
    const btnDisparar = document.getElementById('btnDispararConvocacoes');

    if (btnVoltar) {
      btnVoltar.onclick = () => showTab('filtros');
    }

    if (btnCarregar) {
      btnCarregar.onclick = carregarConvocacoes;
    }

    if (btnDisparar) {
       btnDisparar.onclick = window.abrirModalDisparoWhatsApp;
    }

    const filtroDivPlacasEl = document.getElementById('filtroConvocacaoDivergenciaPlacas');
    if (filtroDivPlacasEl) {
      filtroDivPlacasEl.onchange = carregarConvocacoes;
    }

    if (filtroViagem) {
      filtroViagem.onkeypress = (e) => {
        if (e.key === 'Enter') carregarConvocacoes();
      };
    }

    if (filtroStatus) {
      filtroStatus.onchange = carregarConvocacoes;
    }
  }
  
  // Função para mostrar o guia completo de envio
  function mostrarGuiaCompletoEnvio() {
    const modal = document.getElementById('modalGuiaCompletoEnvio');
    const conteudo = document.getElementById('conteudoGuiaCompleto');
    
    if (!modal || !conteudo) return;
    
    conteudo.innerHTML = `
      <div style="max-width: 900px; margin: 0 auto;">
        <!-- Introdução -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 24px; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-book-open" style="font-size: 32px;"></i>
            <span>Guia Completo: Envio de Convocações</span>
          </h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            Este guia explica como enviar convocações aos motoristas via <strong>WhatsApp Web</strong>. 
            O sistema utiliza o método manual para garantir controle total sobre cada mensagem.
          </p>
        </div>

        <!-- Método de Envio -->
        <div style="background: #fff; border: 3px solid #667eea; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
            <div style="font-size: 48px;">👤</div>
            <div>
              <h3 style="margin: 0; color: #667eea; font-size: 22px;">Envio via WhatsApp Web</h3>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Controle total sobre cada mensagem</p>
            </div>
          </div>
          
          <div style="background: #f0f9f4; border-left: 4px solid #25D366; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2e7d32; font-weight: 600;"><i class="bx bx-check-circle" style="vertical-align: middle;"></i> <strong>Vantagens:</strong></p>
            <ul style="margin: 10px 0 0 20px; color: #333; line-height: 1.8;">
              <li>Você <strong>revisa cada mensagem</strong> antes de enviar</li>
              <li>Pode personalizar a mensagem antes de enviar</li>
              <li>Não requer configuração adicional (funciona sempre)</li>
              <li>Ideal para <strong>pequenos volumes</strong> ou quando precisa de controle</li>
              <li>Permite interação direta com o motorista</li>
            </ul>
          </div>
          
          <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #1565C0; font-weight: 600;"><i class="bx bx-list-ul" style="vertical-align: middle;"></i> <strong>Envio Manual:</strong></p>
            <p style="margin: 0; color: #666; line-height: 1.6;">
              Para envio manual, clique no botão <strong>"<i class="bx bx-logo-whatsapp" style="font-size: 1em;"></i> Abrir WhatsApp"</strong> de cada motorista na lista para abrir e enviar cada mensagem individualmente.
            </p>
          </div>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #856404; font-weight: 600;"><i class="bx bx-bulb" style="vertical-align: middle;"></i> <strong>Dica:</strong></p>
            <p style="margin: 0; color: #333; line-height: 1.6;">
              O método manual oferece <strong>controle total</strong> sobre cada mensagem, permitindo revisar e personalizar antes de enviar.
            </p>
          </div>
        </div>


        <!-- Conclusão -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 22px;"><i class="bx bx-check-double" style="vertical-align: middle;"></i> Pronto para começar!</h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            Agora você conhece como enviar convocações via WhatsApp Web. 
            Comece a enviar convocações de forma eficiente! <i class="bx bx-rocket" style="vertical-align: middle;"></i>
          </p>
        </div>
      </div>
    `;
    
    modal.style.display = 'flex';
    
    // Fechar ao clicar fora
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // Mostrar links WhatsApp das convocações carregadas
  async function mostrarLinksWhatsAppDasConvocacoes() {
    if (!convocacoes || convocacoes.length === 0) {
      showMessage('Nenhuma convocação carregada. Carregue as convocações primeiro.', 'warning');
      return;
    }

    try {
      showMessage('Preparando links com mensagens formatadas...', 'info');
      
      const urlBase = await obterUrlPublica();
      const linksWhatsApp = [];
      let semCelular = 0;
      let semConvocacao = 0;
      const motoristasSemCelular = []; // Lista de nomes dos motoristas sem celular

      // Agrupar convocações por viagem para buscar dados uma vez por viagem
      const viagensMap = new Map();
      
      for (const conv of convocacoes) {
        const nomeMotorista = conv.NOME_MOTORISTA || 'Motorista';
        
        if (!conv.CELULAR_MOTORISTA) {
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          continue;
        }

        // Limpar número (apenas dígitos). Internacional: 12+ dígitos = já tem DDI (595, 54, 55); 10-11 = adicionar 55.
        let numeroLimpo = String(conv.CELULAR_MOTORISTA).replace(/\D/g, '');
        if (numeroLimpo.startsWith('0')) numeroLimpo = numeroLimpo.substring(1);
        if (numeroLimpo.length < 12 && numeroLimpo.length >= 10) numeroLimpo = '55' + numeroLimpo;

        if (numeroLimpo.length < 12) {
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          continue;
        }

        // Buscar dados completos da viagem se ainda não tiver
        let viagemData = viagensMap.get(conv.IDVIAGEM);
        if (!viagemData) {
          try {
            const responseViagem = await fetchApiViagens(`/${conv.IDVIAGEM}`);
            if (responseViagem.ok) {
              viagemData = await responseViagem.json();
              viagensMap.set(conv.IDVIAGEM, viagemData);
            }
          } catch (err) {
            console.error(`Erro ao buscar dados da viagem ${conv.IDVIAGEM}:`, err);
          }
        }

        // Gerar mensagem formatada completa (mesma lógica do enviarAnuncioWhatsApp)
        // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
        const linkConvocacao = conv.LINKCONVOCACAO && conv.LINKCONVOCACAO.trim() !== '' 
          ? conv.LINKCONVOCACAO 
          : `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
        const nomeMotoristaConvocacao = conv.NOME_MOTORISTA || 'Motorista';
        
        // Função para formatar data/hora (mesma lógica do prepararAnuncioCarga)
        const formatarDataHora = (dataHora) => {
          if (!dataHora) return 'Não informado';
          if (typeof dataHora === 'string') {
            let dataStr = dataHora.replace('Z', '');
            if (dataStr.includes('T')) {
              dataStr = dataStr.replace('T', ' ');
            }
            const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
              const [, year, month, day, hour, minute] = match;
              return `${day}/${month}/${year} ${hour}:${minute}`;
            }
          }
          try {
            const date = new Date(dataHora);
            if (isNaN(date.getTime())) return 'Data inválida';
            const dia = String(date.getUTCDate()).padStart(2, '0');
            const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
            const ano = date.getUTCFullYear();
            const hora = String(date.getUTCHours()).padStart(2, '0');
            const minuto = String(date.getUTCMinutes()).padStart(2, '0');
            return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
          } catch (err) {
            return 'Data inválida';
          }
        };

        // Gerar texto base do anúncio (mesmo formato do prepararAnuncioCarga)
        let textoBase = '';
        if (viagemData) {
          textoBase = `*CARGA DISPONÍVEL*\n\n`;
          textoBase += `*ID:* ${viagemData.IDVIAGEM || 'N/A'}\n`;
          textoBase += `*Tipo:* ${viagemData.DSTIPOVIAGEM || viagemData.CDTIPOVIAGEM || 'Não informado'}\n`;
          textoBase += `*Classe:* ${viagemData.DSCLASSEFROTA || viagemData.CDCLASSEFROTA || 'Não informado'}\n`;
          textoBase += `*Rota:* ${viagemData.DSROTEIRO ? `${viagemData.IDROTEIRO || ''} - ${viagemData.DSROTEIRO}` : (viagemData.IDROTEIRO ? `${viagemData.IDROTEIRO} - ` : '') + `${viagemData.ORIGEM_CIDADE || 'N/A'}/${viagemData.ORIGEM_ESTADO || 'N/A'} -> ${viagemData.DESTINO_CIDADE || 'N/A'}/${viagemData.DESTINO_ESTADO || 'N/A'}`}\n\n`;
          textoBase += `*HORÁRIOS*\n`;
          textoBase += `*Carregamento:* ${formatarDataHora(viagemData.DTPREVINICIO)}\n`;
          textoBase += `*Descarga:* ${formatarDataHora(viagemData.DTPREVFINAL)}\n\n`;
          if (viagemData.FGRASTREADO === 'S') {
            textoBase += `*REQUISITOS*\n`;
            textoBase += `*Exige Veículo Rastreado:* SIM\n\n`;
          }
          textoBase += `*CONTRATADOR*\n`;
          textoBase += `${viagemData.CONTRATADOR_NOME || viagemData.CDCONTRATADOR || 'Não informado'}\n\n`;
          textoBase += `*VALORES*\n`;
          textoBase += `*Frete:* R$ ${viagemData.VLFRETE ? parseFloat(viagemData.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
          textoBase += `*Peso:* ${viagemData.PESO ? parseFloat(viagemData.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
          textoBase += `*Cubagem:* ${viagemData.CUBAGEM ? parseFloat(viagemData.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\n`;
          if (viagemData.OBSERV) {
            textoBase += `\n*DETALHES DA VIAGEM*\n`;
            textoBase += `${viagemData.OBSERV}\n`;
          }
        } else {
          // Fallback se não conseguir buscar dados da viagem
          textoBase = `*CARGA DISPONÍVEL*\n\n`;
          textoBase += `*ID:* ${conv.IDVIAGEM || 'N/A'}\n`;
          textoBase += `*Classe:* ${conv.DSCLASSEFROTA || 'N/A'}\n`;
          textoBase += `*Rota:* ${conv.ORIGEM_CIDADE || 'N/A'}/${conv.ORIGEM_ESTADO || 'N/A'} -> ${conv.DESTINO_CIDADE || 'N/A'}/${conv.DESTINO_ESTADO || 'N/A'}\n\n`;
        }

        // Personalizar mensagem para cada motorista
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar tipo de URL e adicionar instruções apropriadas
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        let textoComLink;
        
        if (isLocalIP) {
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n*Importante:*\n- Links locais não são clicáveis no WhatsApp\n- Copie o link acima (toque e segure)\n- Cole no navegador do celular\n- Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }

        const linkWhatsApp = `https://wa.me/${numeroLimpo}?text=${encodeURIComponent(textoComLink)}`;

        const linkItem = {
          idConvocacao: conv.IDCONVOCACAO,
          motorista: conv.NOME_MOTORISTA || 'Motorista',
          celular: conv.CELULAR_MOTORISTA,
          link: linkWhatsApp
        };
        
        if (!linkItem.idConvocacao) {
          console.warn('Convocação sem IDCONVOCACAO:', conv);
        }
        
        linksWhatsApp.push(linkItem);
      }

      // Log de links WhatsApp manual (geração de links)
      if (window.logWhatsAppManual && linksWhatsApp.length > 0) {
        const viagensUnicas = [...new Set(convocacoes.map(c => c.IDVIAGEM))];
        viagensUnicas.forEach(idViagem => {
          const linksDaViagem = linksWhatsApp.filter(l => {
            const conv = convocacoes.find(c => c.IDCONVOCACAO === l.idConvocacao);
            return conv && conv.IDVIAGEM === idViagem;
          });
          if (linksDaViagem.length > 0) {
            window.logWhatsAppManual(idViagem, linksDaViagem.length, {
              tipo: 'Geração de Links',
              motoristasComLink: linksDaViagem.map(l => ({
                nome: l.motorista,
                celular: l.celular,
                idConvocacao: l.idConvocacao
              })),
              semCelular: semCelular,
              semConvocacao: semConvocacao
            });
          }
        });
      }

      if (linksWhatsApp.length > 0) {
        mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular, []);
      } else {
        let mensagem = 'Nenhum WhatsApp disponível. ';
        if (semCelular > 0) {
          mensagem += `${semCelular} convocação(ões) sem celular válido: ${motoristasSemCelular.join(', ')}.`;
        }
        showMessage(mensagem, 'warning');
      }
    } catch (err) {
      console.error('Erro ao preparar links WhatsApp:', err);
      showMessage('Erro ao preparar links: ' + err.message, 'error');
    }
  }

  // Carregar e selecionar viagem na aba de Convocações (similar à aba Compatíveis)
  async function carregarEselecionarViagemConvocacoes(idViagem) {
    try {
      if (!idViagem) {
        return;
      }

      const filtroViagem = document.getElementById('filtroConvocacaoViagem');
      
      if (filtroViagem) {
        // Preencher o campo de filtro com o ID da viagem
        filtroViagem.value = String(idViagem);
        
        // Disparar evento para garantir que o valor foi atualizado
        filtroViagem.dispatchEvent(new Event('input', { bubbles: true }));
        filtroViagem.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Aguardar um pouco para garantir que o campo foi atualizado
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Carregar convocações automaticamente
        await carregarConvocacoes();
      }
    } catch (err) {
      console.error('Erro ao carregar viagem para convocações:', err);
      showMessage('Erro ao carregar convocações da viagem.', 'error');
    }
  }

  // Carregar convocações
  async function carregarConvocacoes() {
    try {
      showMessage('Carregando convocações...', 'info');
      
      const filtroViagem = document.getElementById('filtroConvocacaoViagem')?.value?.trim();
      const filtroStatus = document.getElementById('filtroConvocacaoStatus')?.value?.trim();
      const filtroDivPlacas = document.getElementById('filtroConvocacaoDivergenciaPlacas');
      
      let url = '/api/convocacoes';
      const params = [];
      if (filtroViagem) params.push(`idViagem=${encodeURIComponent(filtroViagem)}`);
      if (filtroStatus) params.push(`status=${encodeURIComponent(filtroStatus)}`);
      if (filtroDivPlacas && filtroDivPlacas.checked) params.push('divergenciaPlacas=1');
      
      if (params.length > 0) {
        url += '?' + params.join('&');
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 503 && errorData.error) {
          throw new Error(errorData.error);
        }
        throw new Error(errorData.error || 'Erro ao carregar convocações');
      }
      
      convocacoes = await response.json();
      window.convocacoes = convocacoes;

      await renderizarConvocacoes();
      
      const soDivPlacas = !!(filtroDivPlacas && filtroDivPlacas.checked);
      if (convocacoes.length === 0) {
        let mensagem = 'Nenhuma convocação encontrada.';
        if (filtroViagem) {
          mensagem += ` (Filtro: Viagem ${filtroViagem}${filtroStatus ? `, Status: ${filtroStatus}` : ''})`;
        } else if (filtroStatus) {
          mensagem += ` (Filtro: Status ${filtroStatus})`;
        }
        if (soDivPlacas) {
          mensagem += ' Com «Somente divergência de placas»: nenhum registro FG=D no período/filtros atuais.';
        }
        showMessage(mensagem, 'warning');
      } else {
        let okMsg = `${convocacoes.length} convocação(ões) encontrada(s).`;
        if (soDivPlacas) okMsg += ' Filtro ativo: divergência de placas (aceite bloqueado até alinhar).';
        showMessage(okMsg, 'success');
      }
    } catch (err) {
      console.error('Erro ao carregar convocações:', err);
      showMessage('Erro ao carregar convocações: ' + err.message, 'error');
    }
  }

  window.carregarConvocacoes = carregarConvocacoes;

  /** Abre aba Convocações, marca filtro de divergência e recarrega (usado pelo dashboard / deep link). */
  window.__aplicarAbrirConvocacoesDivergenciaPlacas = function __aplicarAbrirConvocacoesDivergenciaPlacas() {
    try {
      const vc = document.querySelector('.viagens-container');
      const tabBtn = vc && vc.querySelector('.tab-btn[data-tab="convocações"]');
      if (tabBtn) tabBtn.click();
    } catch (e) {
      console.warn('[convocações] abrir aba divergência:', e);
    }
    setTimeout(() => {
      try {
        const cb = document.getElementById('filtroConvocacaoDivergenciaPlacas');
        if (cb) cb.checked = true;
        const fs = document.getElementById('filtroConvocacaoStatus');
        if (fs && String(fs.value || '').trim() === '') fs.value = 'PENDENTE';
        const btn = document.getElementById('btnCarregarConvocacoes');
        if (btn) btn.click();
      } catch (e2) {
        console.warn('[convocações] aplicar filtro divergência:', e2);
      }
    }, 700);
  };

  // Renderizar grid de convocações
  async function renderizarConvocacoes() {
    const container = document.getElementById('convocacoesGrid');
    
    // Atualizar contador de registros
    const countEl = document.getElementById('convocacoesGridCountText');
    if (countEl) {
      const count = convocacoes.length || 0;
      const filtroDivCount = document.getElementById('filtroConvocacaoDivergenciaPlacas');
      const sufDiv =
        filtroDivCount && filtroDivCount.checked
          ? ' · ' +
            (t('web.modulos.viagens.convocacoesContadorSufixoDivergencia') !==
            'web.modulos.viagens.convocacoesContadorSufixoDivergencia'
              ? t('web.modulos.viagens.convocacoesContadorSufixoDivergencia')
              : 'Somente divergência de placas')
          : '';
      countEl.textContent = count + ' ' + (t('web.modulos.viagens.registrosEncontrados').replace(/^0\s*/, '')) + sufDiv;
    }
    
    if (convocacoes.length === 0) {
      container.innerHTML = '<p class="empty">Nenhuma convocação encontrada.</p>';
      return;
    }

    if (ordenacaoConvocacoes.campo === 'dataAcesso' || ordenacaoConvocacoes.campo === 'viagem') {
      ordenacaoConvocacoes = { campo: null, direcao: 'asc' };
    }

    const escHtml = (s) => {
      if (s == null || s === '') return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    const escAttr = (s) => {
      if (s == null || s === '') return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/\s+/g, ' ')
        .trim();
    };

    window.__convGridJustificativaPlacas = Object.create(null);

    const primeiraConv = convocacoes[0];
    const classeBanner = String(primeiraConv?.DSCLASSEFROTA ?? primeiraConv?.dsclassefrota ?? '').trim();
    const idViagemBanner = primeiraConv?.IDVIAGEM ?? primeiraConv?.idviagem ?? '';
    const classeUnica = convocacoes.every(
      (c) => String(c.DSCLASSEFROTA ?? c.dsclassefrota ?? '').trim() === classeBanner
    );

    // Obter URL base pública (para funcionar no celular)
    const urlBase = await obterUrlPublica();
    
    // Função para obter ícone de ordenação
    const getSortIcon = (campo) => {
      if (ordenacaoConvocacoes.campo !== campo) {
        return '<span style="color: #ccc; font-size: 0.8em;">⇅</span>';
      }
      return ordenacaoConvocacoes.direcao === 'asc' 
        ? '<span style="color: #667eea; font-size: 0.8em;">↑</span>'
        : '<span style="color: #667eea; font-size: 0.8em;">↓</span>';
    };
    
    let html = `
      <details id="legendaGrid" class="convocacoes-legenda-details" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
        <summary style="cursor:pointer;padding:10px 14px;font-weight:600;color:#334155;list-style:none;">
          <span style="display:inline-flex;align-items:center;gap:8px;"><i class="bx bx-help-circle" aria-hidden="true"></i> Ajuda — ícones e filtros <span style="font-weight:400;color:#64748b;font-size:13px;">(clique para ver)</span></span>
        </summary>
        <div class="convocacoes-legenda-conteudo" style="padding:0 14px 14px;font-size:13px;color:#475569;line-height:1.55;border-top:1px solid #e2e8f0;">
          <p style="margin:12px 0 6px;"><strong>Legenda</strong></p>
          <ul style="margin:0 0 12px 18px;padding:0;list-style:disc;">
            <li style="margin-bottom:6px;"><i class="bx bx-map-alt" style="color:#28a745;vertical-align:middle;" aria-hidden="true"></i> <strong>Ver motorista no mapa</strong> — posição na rota; o botão só aparece quando a convocação tem latitude e longitude.</li>
            <li style="margin-bottom:6px;"><strong>Status da convocação</strong> — na coluna <em>Resposta</em>: bolinha de GPS (localização registrada ou não) + ícone do status. A data é <code>DHRESPOSTA</code>. Passe o mouse na célula para ver o texto completo (recusa, campanha, divergência, etc.).</li>
            <li style="margin-bottom:6px;"><strong>Viagem confirmada (outro motorista)</strong> — linha com borda/indigo à esquerda quando a viagem já foi fechada com outro motorista e esta convocação segue pendente.</li>
            <li style="margin-bottom:6px;"><strong>Divergência de placas</strong> — linha com <strong>tarja vermelha</strong> (<code>FGCONFIRMACAOPLACAS = D</code>); o botão verde de <strong>confirmar programação</strong> na torre fica desativado até o motorista voltar a confirmar placas no app/link (após alinhar viagem/cadastro). Use «Ver justificativa» para ler o texto do motorista. Filtro «Somente divergência de placas». Na coluna <em>Placa(s)</em>, bolinha vermelha = divergência; verde = confirmou placas.</li>
            <li style="margin-bottom:6px;"><strong>Viagem não confirmada</strong> — convocação ainda não está em <code>CONFIRMADA</code>; a decisão final de fechar a carga na torre é o botão confirmar (quando o motorista já tiver aceito).</li>
            <li style="margin-bottom:6px;"><i class="bx bx-logo-whatsapp" style="color:#25D366;vertical-align:middle;" aria-hidden="true"></i> <strong>WhatsApp</strong> — apenas na coluna <em>Ações</em> (botão verde). O número não aparece na coluna Motorista.</li>
            <li style="margin-bottom:6px;"><i class="bx bx-link-alt" style="color:#2196F3;vertical-align:middle;" aria-hidden="true"></i> <strong>Link público</strong> — abre a página <code>/convocacao</code> desta linha.</li>
            <li style="margin-bottom:6px;"><strong>ID da viagem</strong> — aparece no cartão acima da tabela (classe de frota / viagem), não repetido em cada linha.</li>
            <li style="margin-bottom:6px;"><strong>Convocação e acesso</strong> — abaixo dos botões, duas linhas compactas (<code>Convocação:</code> data · <code>Acesso:</code> data ou «Sem registro»). Clique no cabeçalho <em>Ações</em> para ordenar por data de convocação.</li>
            <li style="margin-bottom:6px;"><i class="bx bx-check-circle" style="color:#28a745;vertical-align:middle;" aria-hidden="true"></i> <strong>Confirmar / reativar</strong> — confirmar só com status ACEITA; reativar aparece quando já está CONFIRMADA.</li>
          </ul>
          <p style="margin:0 0 10px;"><strong>Campanha / link de oportunidades:</strong> status ACEITA ou RECUSADA podem refletir resposta pelo link público da campanha (onde também pode ser gravada a localização). O botão de mapa só aparece com latitude/longitude na convocação. <strong>CONFIRMADA</strong> é sempre decisão da torre.</p>
          <p style="margin:0;"><strong>Link campanha (auditoria):</strong> origem quando <code>SGUSER = APP_MOTORISTA_LINK</code> (resposta pelo link público da campanha). Na Gerenciar Viagens, <strong>confirmar exige GPS</strong> nesses casos — peça ao motorista enviar localização na página de oportunidades antes de confirmar.</p>
        </div>
      </details>
      <div class="convocacoes-context-banner" role="region" aria-label="Contexto da viagem">
        <div class="convocacoes-context-banner-inner">
          <span class="convocacoes-context-pill">
            <i class="bx bx-category-alt" aria-hidden="true"></i>
            <span class="convocacoes-context-label">Classe de frota</span>
            <strong class="convocacoes-context-value">${escHtml(classeBanner || '—')}</strong>
          </span>
          ${idViagemBanner !== '' && idViagemBanner != null ? `<span class="convocacoes-context-sub">Viagem · ${escHtml(String(idViagemBanner))}</span>` : ''}
          ${!classeUnica ? `<span class="convocacoes-context-warn" title="Esta lista mistura mais de uma classe — verifique o filtro da viagem.">Classes misturadas na lista</span>` : ''}
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <th style="padding: 12px; text-align: left; width: 60px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('id')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              ID ${getSortIcon('id')}
            </th>
            <th style="padding: 12px; text-align: left; min-width: 148px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('rota')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Rota ${getSortIcon('rota')}
            </th>
            <th style="padding: 12px; text-align: left; min-width: 192px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('motorista')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Motorista ${getSortIcon('motorista')}
            </th>
            <th style="padding: 12px; text-align: left; min-width: 172px; max-width: 300px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('placasConf')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Placas esperadas (viagem ou cadastro motorista). Bolinha: verde = confirmou placas no app/link (C); vermelha = divergência (D).">
              Placa(s) ${getSortIcon('placasConf')}
            </th>
            <th style="padding: 12px; text-align: left; width: 106px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('freteProposto')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Valor informado pelo motorista ao aceitar pelo link público (opcional)">
              Frete ${getSortIcon('freteProposto')}
            </th>
            <th style="padding: 12px; text-align: left; min-width: 96px; max-width: 136px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('dataResposta')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Ícone = status · bolinha = GPS na convocação · data = DHRESPOSTA. Passe o mouse na célula para o texto completo.">
              Resposta ${getSortIcon('dataResposta')}
            </th>
            <th class="convocacoes-th-acoes" style="padding: 10px 4px; text-align: center; width: 1%; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('dataConvocacao')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Botões de ação; abaixo, DHCONVOCACAO e DHACESSO (abertura do link). Clique para ordenar por data de convocação.">
              Ações ${getSortIcon('dataConvocacao')}
            </th>
          </tr>
        </thead>
        <tbody>
    `;

    // Funções auxiliares (definidas uma vez, fora do loop)
    const criarIndicadorGeolocalizacao = (latitude, longitude) => {
      const temLocalizacao = latitude !== null && latitude !== undefined && 
                             longitude !== null && longitude !== undefined &&
                             !isNaN(latitude) && !isNaN(longitude);
      
      const classe = temLocalizacao ? 'has-location' : 'no-location';
      const titulo = temLocalizacao 
        ? 'Localização capturada - Motorista colaborou' 
        : 'Localização não capturada - Motorista não colaborou';
      
      return `<span class="geoloc-indicator ${classe}" title="${titulo}"></span>`;
    };

    const criarLinkWhatsApp = (celular) => {
      if (!celular) return '-';
      let numeroLimpo = String(celular).replace(/\D/g, '');
      if (numeroLimpo.startsWith('0')) numeroLimpo = numeroLimpo.substring(1);
      // Internacional: 12+ dígitos = já tem DDI (595, 54, 55); 10-11 = adicionar 55
      if (numeroLimpo.length < 12 && numeroLimpo.length >= 10) numeroLimpo = '55' + numeroLimpo;
      if (numeroLimpo.length < 12) return celular;
      const urlWhatsApp = `https://wa.me/${numeroLimpo}`;
      // Formatar número para exibição (com parênteses e hífen)
      let celularFormatado = '';
      if (numeroLimpo && numeroLimpo.length >= 12) {
        // Se Brasil (55), remover DDI para formatação (XX) XXXXX-XXXX; senão exibir com DDI
        let numeroParaFormatar = numeroLimpo.startsWith('55') ? numeroLimpo.substring(2) : numeroLimpo;
        if (numeroParaFormatar.length === 11) {
          // Formato: (41) 99837-1769
          celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 7)}-${numeroParaFormatar.substring(7)}`;
        } else if (numeroParaFormatar.length === 10) {
          // Formato: (41) 9837-1769
          celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 6)}-${numeroParaFormatar.substring(6)}`;
        } else {
          celularFormatado = numeroParaFormatar;
        }
      } else {
        celularFormatado = celular;
      }
      
      return `<a href="${urlWhatsApp}" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style="color: #25D366; text-decoration: none; font-weight: 500; font-size: 11px;"
                  title="Abrir WhatsApp">
                  ${celularFormatado}
                </a>`;
    };

    const formatarData = (data) => {
      if (!data) return '-';
      return fmtDataHora(data);
    };

    // Buscar histórico de reabertura para todas as convocações (em paralelo)
    const historicosPromises = convocacoes.map(async (conv) => {
      const idC = conv.IDCONVOCACAO ?? conv.idconvocacao;
      try {
        const response = await fetch(`/api/convocacoes/${idC}/historico-reabertura`);
        if (response.ok) {
          const historico = await response.json();
          // Tratamento para não quebrar no JSON
          return { idConvocacao: idC, historico: Array.isArray(historico) && historico.length > 0 ? historico : null };
        }
        return { idConvocacao: idC, historico: null };
      } catch (err) {
        console.error(`Erro ao buscar histórico para convocação ${idC}:`, err);
        return { idConvocacao: idC, historico: null };
      }
    });
    
    const historicosResult = await Promise.all(historicosPromises);
    const historicosMap = {};
    historicosResult.forEach(h => {
      historicosMap[h.idConvocacao] = h.historico;
    });
    
    convocacoes.forEach((conv, index) => {
      // Suporte a chaves em minúsculas (PostgreSQL)
      const idConv = conv.IDCONVOCACAO ?? conv.idconvocacao;
      const historico = historicosMap[idConv];
      const temHistoricoReabertura = historico && historico.length > 0;
      // Pegar o motivo mais recente (primeiro do array, pois está ordenado DESC)
      const motivoReabertura = temHistoricoReabertura && historico[0] ? (historico[0].MOTIVO_REABERTURA ?? historico[0].motivo_reabertura) : null;
      
      // Suporte a chaves em minúsculas (PostgreSQL) para exibição
      const nomeMotorista = conv.NOME_MOTORISTA ?? conv.nome_motorista;
      const origemCidade = conv.ORIGEM_CIDADE ?? conv.origem_cidade;
      const origemEstado = conv.ORIGEM_ESTADO ?? conv.origem_estado;
      const destinoCidade = conv.DESTINO_CIDADE ?? conv.destino_cidade;
      const destinoEstado = conv.DESTINO_ESTADO ?? conv.destino_estado;
      const dsRoteiro = conv.DSROTEIRO ?? conv.dsroteiro;
      const idViagem = conv.IDVIAGEM ?? conv.idviagem;
      const idRoteiro = conv.IDROTEIRO ?? conv.idroteiro;
      const lat = conv.LATITUDE ?? conv.latitude;
      const lng = conv.LONGITUDE ?? conv.longitude;
      const sgUserNorm = String(conv.SGUSER ?? conv.sguser ?? '').trim().toUpperCase();

      const placasEsp = String(conv.PLACASESPERADAS ?? conv.placasesperadas ?? '').trim();
      const dsClasseConjunto = String(conv.DSCLASSEFROTA_CONJUNTO ?? conv.dsclassefrota_conjunto ?? '').trim();
      const fgPlacas = String(conv.FGCONFIRMACAOPLACAS ?? conv.fgconfirmacaoplacas ?? '').trim().toUpperCase();
      const txtPlDiv = String(conv.TXTPLACASDIVERGENCIA ?? conv.txtplacasdivergencia ?? '').trim();
      if (fgPlacas === 'D') {
        window.__convGridJustificativaPlacas[idConv] = txtPlDiv;
      }
      const dhPlConf = conv.DHCONFIRMACAOPLACAS ?? conv.dhconfirmacaoplacas;
      
      let statusDisplay = (conv.STATUS ?? conv.status) || 'PENDENTE';
      const statusConv = conv.STATUS ?? conv.status;
      if (statusConv === 'ACEITA_DESCARTADA') {
        statusDisplay = 'ACEITA (Não Selecionada)';
      } else if (statusConv === 'RECUSADA') {
        const motivoRecusa = conv.MOTIVO_RECUSA ?? conv.motivo_recusa;
        if (motivoRecusa) {
          statusDisplay = `RECUSADA - ${motivoRecusa}`;
        } else if (conv.CDMOTIVORECUSA ?? conv.cdmotivorecusa) {
          statusDisplay = `RECUSADA (Motivo: ${conv.CDMOTIVORECUSA ?? conv.cdmotivorecusa})`;
        }
      }
      
      // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
      const linkConvocacao = (conv.LINKCONVOCACAO ?? conv.linkconvocacao) && String(conv.LINKCONVOCACAO ?? conv.linkconvocacao).trim() !== ''
        ? (conv.LINKCONVOCACAO ?? conv.linkconvocacao)
        : `${urlBase}/convocacao/${idConv}`;
      
      // Verificar se tem localização para mostrar botão "Ver no Mapa"
      const temLocalizacao = lat !== null && lat !== undefined && lng !== null && lng !== undefined &&
                            !isNaN(lat) && !isNaN(lng);
      const bloquearConfirmSemGeo =
        statusConv === 'ACEITA' && !temLocalizacao && sgUserNorm === 'APP_MOTORISTA_LINK';

      // Destacar visualmente se for PENDENTE mas viagem já foi confirmada
      const viagemJaConfirmada = conv.VIAGEM_JA_CONFIRMADA ?? conv.viagem_ja_confirmada;
      const isPendenteMasConfirmada = statusConv === 'PENDENTE' && (viagemJaConfirmada === 1 || viagemJaConfirmada === true);
      let rowStyle = index % 2 === 0 ? 'background: #fafafa;' : '';
      if (fgPlacas === 'D') {
        rowStyle = isPendenteMasConfirmada
          ? 'border-left: 5px solid #b91c1c; box-shadow: inset 5px 0 0 0 #dc2626; background: #fef2f2 !important;'
          : 'border-left: 5px solid #dc2626; background: #fef2f2 !important;';
      } else if (isPendenteMasConfirmada) {
        rowStyle = 'border-left: 4px solid #667eea; background: #f0f4ff !important;';
      }
      
      // Formatar celular do motorista para WhatsApp e exibição
      const celularMotorista = conv.CELULAR_MOTORISTA ?? conv.celular_motorista;
      const celularFormatado = celularMotorista ? String(celularMotorista).replace(/\D/g, '') : '';
      const temWhatsAppMotorista = celularFormatado.length >= 10;
      const numWaMotorista = celularFormatado.length >= 12 ? celularFormatado : '55' + celularFormatado;
      const linkWhatsAppMotorista = temWhatsAppMotorista ? `https://wa.me/${numWaMotorista}` : '#';

      let celularExibicao = '';
      if (celularFormatado && celularFormatado.length >= 10) {
        if (celularFormatado.length === 11) {
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 7)}-${celularFormatado.substring(7)}`;
        } else if (celularFormatado.length === 10) {
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 6)}-${celularFormatado.substring(6)}`;
        } else {
          celularExibicao = celularFormatado;
        }
      }
      const titleWaAcoes =
        temWhatsAppMotorista && celularExibicao ? escAttr('WhatsApp — ' + celularExibicao) : '';

      // Botões em linha: link → WhatsApp → mapa → confirmar / reativar (até 4 ícones)
      const btnIconStyle =
        'box-sizing:border-box;padding:0;width:34px;height:34px;font-size:1.05rem;color:#fff;text-decoration:none;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;border:none;cursor:pointer;flex-shrink:0;';
      let botoesInner = `
        <a href="${linkConvocacao}" target="_blank" rel="noopener noreferrer" class="btn" style="${btnIconStyle} background:#2196F3;" title="Abrir link público da convocação">
          <i class="bx bx-link-alt" aria-hidden="true"></i>
        </a>`;
      if (temWhatsAppMotorista) {
        botoesInner += `
        <a href="${linkWhatsAppMotorista}" target="_blank" rel="noopener noreferrer" class="btn" style="${btnIconStyle} background:#25D366;" title="${titleWaAcoes}">
          <i class="bx bxl-whatsapp" aria-hidden="true"></i>
        </a>`;
      }
      if (temLocalizacao && idRoteiro) {
        botoesInner += `
        <button type="button" onclick="abrirMapaMotorista(${idConv}, ${lat}, ${lng}, ${idRoteiro}, ${idViagem})" class="btn" style="${btnIconStyle} background:#15803d;" title="Ver motorista no mapa (rota)">
          <i class="bx bx-map-alt" aria-hidden="true"></i>
        </button>`;
      }
      if (statusConv === 'ACEITA') {
        const bloquearConfirmDivergenciaPlacas = fgPlacas === 'D';
        const titleConfirm = bloquearConfirmDivergenciaPlacas
          ? 'Não é possível confirmar: divergência de placas registrada. Alinhe com o motorista e ajuste o cadastro antes de confirmar.'
          : bloquearConfirmSemGeo
            ? 'Sem GPS na convocação (resposta veio do link da campanha). Peça ao motorista enviar localização na página de oportunidades antes de confirmar.'
            : 'Confirmar convocação (aprovar este motorista)';
        const escTitle = titleConfirm.replace(/"/g, '&quot;');
        botoesInner += bloquearConfirmSemGeo || bloquearConfirmDivergenciaPlacas
          ? `
        <button type="button" disabled class="btn" style="${btnIconStyle} background:#adb5bd;cursor:not-allowed;opacity:0.85;" title="${escTitle}">
          <i class="bx bx-check-circle" aria-hidden="true"></i>
        </button>`
          : `
        <button type="button" onclick="confirmarConvocacao(${idConv})" class="btn" style="${btnIconStyle} background:#28a745;" title="${escTitle}">
          <i class="bx bx-check-circle" aria-hidden="true"></i>
        </button>`;
      } else if (statusConv === 'PENDENTE') {
        botoesInner += `
        <button type="button" disabled class="btn" style="${btnIconStyle} background:#adb5bd;cursor:not-allowed;opacity:0.9;" title="Confirmar — disponível quando o motorista aceitar (status ACEITA)">
          <i class="bx bx-check-circle" aria-hidden="true"></i>
        </button>`;
      }
      if (statusConv === 'CONFIRMADA') {
        botoesInner += `
        <button type="button" onclick="reativarConvocacao(${idConv})" class="btn" style="${btnIconStyle} background:#ff9800;" title="Reativar convocação">
          <i class="bx bx-refresh" aria-hidden="true"></i>
        </button>`;
      }
      const dhConvFmt = formatarData(conv.DHCONVOCACAO ?? conv.dhconvocacao);
      const dhAcessoRaw = conv.DHACESSO ?? conv.dhacesso;
      const dhAcessoFmt = dhAcessoRaw ? formatarData(dhAcessoRaw) : '';
      const htmlMetaGrid =
        '<div class="convocacoes-acoes-meta-stack" role="group" aria-label="Convocação e acesso ao link">' +
        '<div class="convocacoes-acoes-meta-grid">' +
        `<span class="convocacoes-meta-lbl">Convocação</span><span class="convocacoes-meta-sep">:</span><span class="convocacoes-meta-val" title="DHCONVOCACAO">${dhConvFmt}</span>` +
        (dhAcessoRaw
          ? `<span class="convocacoes-meta-lbl convocacoes-meta-lbl--acc"><i class="bx bx-check-circle" aria-hidden="true"></i> Acesso</span><span class="convocacoes-meta-sep">:</span><span class="convocacoes-meta-val convocacoes-meta-val--acc" title="DHACESSO — primeiro acesso ao link">${dhAcessoFmt}</span>`
          : `<span class="convocacoes-meta-lbl convocacoes-meta-lbl--acc convocacoes-meta-lbl--acc-pend"><i class="bx bx-circle" aria-hidden="true"></i> Acesso</span><span class="convocacoes-meta-sep">:</span><span class="convocacoes-meta-val convocacoes-meta-val--pend" title="Sem DHACESSO">Sem registro</span>`) +
        '</div></div>';
      const botoesAcoes =
        '<div class="convocacoes-acoes-cell">' +
        '<div class="convocacoes-acoes-row" role="group" aria-label="Ações da convocação" style="display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:center;gap:2px;">' +
        botoesInner +
        '</div>' +
        htmlMetaGrid +
        '</div>';
      
      const cdCadastroMotorista = conv.CDCADASTRO_MOTORISTA ?? conv.cdcadastro_motorista;

      const titlePlacaCel =
        fgPlacas === 'C'
          ? 'Confirmou placas no app ou link (FGCONFIRMACAOPLACAS = C).'
          : fgPlacas === 'D'
            ? 'Divergência de placas no app ou link (FGCONFIRMACAOPLACAS = D).' +
              (txtPlDiv ? ' Detalhe: ' + String(txtPlDiv).replace(/\s+/g, ' ').trim() : '')
            : 'Sem registro de confirmação de placas (app/link) nesta convocação.';
      let bolinhaPlaca = '';
      if (fgPlacas === 'C') {
        bolinhaPlaca =
          '<span class="convocacao-placa-status-dot convocacao-placa-status-dot--ok" title="Confirmou placas (app/link)" aria-hidden="true"></span>';
      } else if (fgPlacas === 'D') {
        bolinhaPlaca =
          '<span class="convocacao-placa-status-dot convocacao-placa-status-dot--div" title="Divergência de placas (app/link)" aria-hidden="true"></span>';
      }
      const partesPlaca = placasEsp
        ? placasEsp.split(',').map((x) => String(x).trim()).filter(Boolean)
        : [];
      const partesClasse = dsClasseConjunto
        ? dsClasseConjunto.split(/\s*\|\s*/).map((x) => String(x).trim()).filter(Boolean)
        : [];
      let htmlPlacasCorpo = '';
      if (partesPlaca.length === 0) {
        htmlPlacasCorpo = '<span style="color:#999">—</span>';
      } else if (partesPlaca.length === 1) {
        const p0 = partesPlaca[0];
        const lin =
          partesClasse.length > 0 ? `${p0} — ${partesClasse.join(' | ')}` : p0;
        htmlPlacasCorpo = `<div class="convocacao-placa-stack"><div class="convocacao-placa-linha">${escHtml(lin)}</div></div>`;
      } else {
        const segs = [];
        for (let pi = 0; pi < partesPlaca.length; pi++) {
          const cls =
            partesClasse[pi] != null && String(partesClasse[pi]).trim() !== ''
              ? String(partesClasse[pi]).trim()
              : partesClasse.length === 1
                ? String(partesClasse[0]).trim()
                : '';
          segs.push(cls ? `${partesPlaca[pi]} — ${cls}` : partesPlaca[pi]);
        }
        const blocos = [];
        for (let si = 0; si < segs.length; si++) {
          const ult = si === segs.length - 1;
          const texto = ult ? segs[si] : `${segs[si]} ·`;
          blocos.push(`<div class="convocacao-placa-linha">${escHtml(texto)}</div>`);
          if (!ult) {
            blocos.push('<div class="convocacao-placa-sep" aria-hidden="true"></div>');
          }
        }
        htmlPlacasCorpo = `<div class="convocacao-placa-stack">${blocos.join('')}</div>`;
      }
      const htmlCelPlacas = `<div class="convocacao-placa-cel" title="${escAttr(titlePlacaCel)}"><div style="display:flex;align-items:flex-start;gap:8px;"><span style="flex-shrink:0;padding-top:3px;">${bolinhaPlaca}</span>${htmlPlacasCorpo}</div>${txtPlDiv && fgPlacas === 'D' ? `<div class="convocacao-placa-cel-divergencia" style="margin-top:6px;font-size:10px;color:#9a3412;line-height:1.35;word-break:break-word;">${escHtml(txtPlDiv)}</div>` : ''}${dhPlConf && (fgPlacas === 'C' || fgPlacas === 'D') ? `<div style="margin-top:4px;color:#666;font-size:10px;">${formatarData(dhPlConf)}</div>` : ''}</div>`;

      const moedaConv = conv.MOEDA ?? conv.moeda ?? 'BRL';
      const vlFretePropRaw = conv.VL_FRETE_PROPOSTO_MOTORISTA ?? conv.vl_frete_proposto_motorista;
      let txtFretePropostoMotorista = '—';
      if (vlFretePropRaw != null && vlFretePropRaw !== '' && Number.isFinite(Number(vlFretePropRaw))) {
        try {
          txtFretePropostoMotorista = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: String(moedaConv || 'BRL').substring(0, 3) }).format(Number(vlFretePropRaw));
        } catch (eCur) {
          txtFretePropostoMotorista = String(vlFretePropRaw);
        }
      }

      const linhasTooltipResposta = [String(statusDisplay || '').trim() || statusConv || '—'];
      if (sgUserNorm === 'APP_MOTORISTA_LINK') {
        linhasTooltipResposta.push('Última resposta: link público de campanha (oportunidades).');
      }
      if (fgPlacas === 'D') {
        linhasTooltipResposta.push(
          statusConv === 'PENDENTE'
            ? 'Divergência de placas — aceite bloqueado até alinhar na torre.'
            : 'Divergência de placas registrada (FG = D). Verifique alinhamento com o motorista.',
        );
      }
      if (isPendenteMasConfirmada) {
        linhasTooltipResposta.push('Viagem já confirmada com outro motorista.');
      }
      if (temHistoricoReabertura && motivoReabertura) {
        linhasTooltipResposta.push('Reabertura: ' + String(motivoReabertura).replace(/\s+/g, ' ').trim());
      }
      const titleRespostaCel = escAttr(linhasTooltipResposta.join(' '));

      let iconStatusConv = '<i class="bx bx-help-circle" aria-hidden="true" style="color:#94a3b8;font-size:1.25rem;flex-shrink:0;"></i>';
      if (fgPlacas === 'D') {
        iconStatusConv =
          '<i class="bx bx-error" aria-hidden="true" style="color:#dc2626;font-size:1.35rem;flex-shrink:0;" title="Divergência de placas — confirmar programação bloqueado até alinhar"></i>';
      } else if (statusConv === 'ACEITA') {
        iconStatusConv =
          '<i class="bx bx-check-circle" aria-hidden="true" style="color:#28a745;font-size:1.3rem;flex-shrink:0;" title="ACEITA"></i>';
      } else if (statusConv === 'PENDENTE') {
        iconStatusConv =
          '<i class="bx bx-time-five" aria-hidden="true" style="color:#b7791f;font-size:1.3rem;flex-shrink:0;" title="PENDENTE"></i>';
      } else if (statusConv === 'RECUSADA') {
        iconStatusConv =
          '<i class="bx bx-x-circle" aria-hidden="true" style="color:#c0392b;font-size:1.3rem;flex-shrink:0;" title="RECUSADA"></i>';
      } else if (statusConv === 'CONFIRMADA') {
        iconStatusConv =
          '<i class="bx bx-badge-check" aria-hidden="true" style="color:#1a5276;font-size:1.3rem;flex-shrink:0;" title="CONFIRMADA"></i>';
      } else if (statusConv === 'ACEITA_DESCARTADA') {
        iconStatusConv =
          '<i class="bx bx-user-x" aria-hidden="true" style="color:#a67c00;font-size:1.25rem;flex-shrink:0;" title="ACEITA (não selecionada)"></i>';
      }

      const badgeDivPlacasGrid =
        fgPlacas === 'D'
          ? '<div style="margin-top:4px;"><span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:700;border-radius:4px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;line-height:1.2;">Divergência placas</span></div><button type="button" class="convocacoes-btn-ver-justificativa" onclick="abrirJustificativaDivergenciaConvocacaoTorre(' +
            idConv +
            ')">Ver justificativa</button>'
          : '';
      const htmlCelResposta = `<div class="convocacao-cel-resposta" style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;max-width:200px;" title="${titleRespostaCel}">
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            ${criarIndicadorGeolocalizacao(lat, lng)}
            ${iconStatusConv}
          </div>
          <div class="convocacao-cel-resposta-data" style="font-size:12px;line-height:1.35;">
            <div>${formatarData(conv.DHRESPOSTA ?? conv.dhresposta)}</div>
            ${badgeDivPlacasGrid}
          </div>
        </div>`;

      html += `
        <tr class="${fgPlacas === 'D' ? 'convocacao-tr-divergencia-placas' : ''}" style="border-bottom: 1px solid #eee; ${rowStyle}">
          <td style="padding: 12px;">${idConv}</td>
          <td style="padding: 12px;">
            ${origemCidade || '-'}/${origemEstado || '-'}<br>
            <small style="color: #666;">→ ${destinoCidade || '-'}/${destinoEstado || '-'}</small>
          </td>
          <td style="padding: 12px;">
            ${nomeMotorista || '-'}<br>
            <small style="color: #666;">
              ${cdCadastroMotorista ? `Código: ${cdCadastroMotorista}` : ''}
            </small>
          </td>
          <td style="padding: 12px; font-size: 12px; max-width: 240px; vertical-align: top;">${htmlCelPlacas}</td>
          <td style="padding: 12px; font-size: 12px; white-space: nowrap;" title="Proposta ao aceitar (/convocacao)">${txtFretePropostoMotorista}</td>
          <td style="padding: 12px; font-size: 12px; vertical-align: top;">${htmlCelResposta}</td>
          <td class="convocacoes-td-acoes" style="padding: 10px 4px; vertical-align: top; text-align: center;">
            ${botoesAcoes}
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
  }

  window.abrirJustificativaDivergenciaConvocacaoTorre = function (idConvocacao) {
    const id = idConvocacao == null ? '' : String(idConvocacao).trim();
    const map = window.__convGridJustificativaPlacas || {};
    const texto = id && map[id] != null ? String(map[id]) : '';
    const pre = document.getElementById('modalJustificativaDivergenciaPlacasCorpo');
    const modal = document.getElementById('modalJustificativaDivergenciaPlacas');
    if (pre) {
      pre.textContent = texto.trim() ? texto : '(Sem texto de justificativa gravado.)';
    }
    if (modal) {
      modal.style.display = 'flex';
    }
  };

  window.fecharModalJustificativaDivergenciaPlacasTorre = function () {
    const modal = document.getElementById('modalJustificativaDivergenciaPlacas');
    if (modal) modal.style.display = 'none';
  };

  // Confirmar convocação (muda para CONFIRMADA e recusa outras da mesma viagem)
  window.confirmarConvocacao = async function(idConvocacao) {
    if (!idConvocacao) {
      showMessage('ID da convocação não informado.', 'error');
      return;
    }

    const idConvNum = Number(idConvocacao);
    const statusConvNorm = (s) => String(s == null ? '' : s).trim().toUpperCase();

    // Buscar dados da convocação para mostrar no modal (ID pode vir string do DOM)
    const convocacao = convocacoes.find(c => Number(c.IDCONVOCACAO) === idConvNum);
    if (!convocacao) {
      showMessage('Convocação não encontrada. Atualize a lista (Carregar Convocações).', 'error');
      return;
    }

    const st = statusConvNorm(convocacao.STATUS);
    if (st !== 'ACEITA') {
      const extra =
        st === 'ACEITA_DESCARTADA'
          ? ' Esta linha já está como aceita (não selecionada).'
          : st === 'CONFIRMADA'
            ? ' Esta convocação já está confirmada.'
            : '';
      showMessage('Apenas convocações com status ACEITA podem ser confirmadas.' + extra, 'error');
      return;
    }

    const fgPlacasConf = String(
      convocacao.FGCONFIRMACAOPLACAS ?? convocacao.fgconfirmacaoplacas ?? ''
    )
      .trim()
      .toUpperCase();
    if (fgPlacasConf === 'D') {
      showMessage(
        'Não é possível confirmar: há divergência de placas registrada (FG = D). Alinhe com o motorista, ajuste o cadastro e use «Ver justificativa» na linha se precisar do texto informado.',
        'error'
      );
      return;
    }

    const sgConfFront = String(convocacao.SGUSER ?? convocacao.sguser ?? '').trim().toUpperCase();
    const latCf = convocacao.LATITUDE ?? convocacao.latitude;
    const lngCf = convocacao.LONGITUDE ?? convocacao.longitude;
    const temLocCf =
      latCf != null &&
      lngCf != null &&
      String(latCf).trim() !== '' &&
      String(lngCf).trim() !== '' &&
      !isNaN(Number(latCf)) &&
      !isNaN(Number(lngCf));
    if (sgConfFront === 'APP_MOTORISTA_LINK' && !temLocCf) {
      showMessage(
        'Não é possível confirmar: o aceite veio do link da campanha e ainda não há GPS nesta convocação. Peça ao motorista tocar em «Atualizar localização» na página de oportunidades e, em seguida, use «Carregar Convocações» aqui.',
        'error'
      );
      return;
    }

    // Verificar se já existe outra convocação confirmada para a mesma viagem
    const jaConfirmada = convocacoes.find(c =>
      Number(c.IDVIAGEM) === Number(convocacao.IDVIAGEM) &&
      Number(c.IDCONVOCACAO) !== idConvNum &&
      statusConvNorm(c.STATUS) === 'CONFIRMADA'
    );

    if (jaConfirmada) {
      showMessage('Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.', 'error');
      return;
    }

    // Contar outras convocações ACEITAS
    const outrasAceitas = convocacoes.filter(c =>
      Number(c.IDVIAGEM) === Number(convocacao.IDVIAGEM) &&
      Number(c.IDCONVOCACAO) !== idConvNum &&
      statusConvNorm(c.STATUS) === 'ACEITA'
    ).length;
    
    // Mostrar modal de confirmação personalizado
    let mensagemAtencao = '';
    if (outrasAceitas > 0) {
      mensagemAtencao = `
        <div class="convocacao-modal-alerta" role="region" aria-label="Aviso sobre outras convocações">
          <p class="convocacao-modal-alerta__titulo">
            <i class="bx bx-error-circle" aria-hidden="true"></i> ATENÇÃO:
          </p>
          <p class="convocacao-modal-alerta__texto">
            <strong>${outrasAceitas}</strong> convocação(ões) ACEITA(S) será(ão) marcada(s) como "ACEITA (Não Selecionada)" - mantendo o histórico de que o motorista aceitou.
          </p>
          <p class="convocacao-modal-alerta__nota">
            <i class="bx bx-info-circle" aria-hidden="true"></i> Convocações PENDENTE permanecerão como PENDENTE. Apenas convocações realmente RECUSADAS pelo motorista ficam como RECUSADA.
          </p>
        </div>
      `;
    }
    
    const mensagemCompleta = `
      <div class="convocacao-modal-body">
        <p class="convocacao-modal-meta"><strong>Viagem:</strong> <span class="convocacao-modal-meta-valor">${convocacao.IDVIAGEM}</span></p>
        <p class="convocacao-modal-meta"><strong>Motorista:</strong> <span class="convocacao-modal-meta-valor">${convocacao.NOME_MOTORISTA || 'N/A'}</span></p>
        ${mensagemAtencao}
      </div>
    `;
    
    // Buscar e mostrar validades do motorista antes de confirmar
    const cdMotorista = convocacao.CDCADASTRO_MOTORISTA;
    if (cdMotorista) {
      try {
        await mostrarValidadesMotorista(cdMotorista, convocacao.NOME_MOTORISTA || 'Motorista');
      } catch (err) {
        console.error('Erro ao carregar validades do motorista:', err);
        // Continuar mesmo se houver erro ao carregar validades
      }
    }
    
    const confirmado = await showConfirmModal(
      '<i class="bx bx-check-circle"></i> Confirmar Convocação',
      mensagemCompleta
    );

    if (!confirmado) {
      return;
    }
    
    // Método de envio: sempre manual
    const metodoEnvio = 'manual';

    try {
      showMessage('Confirmando convocação...', 'info');

      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';

      const response = await fetch(`/api/convocacoes/${idConvNum}/confirmar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        }
      });

      if (!response.ok) {
        let errorMessage = 'Erro ao confirmar convocação';
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
          if (error.details) {
            errorMessage += `: ${error.details}`;
          }
        } catch (e) {
          // Se não conseguir parsear JSON, usar status text
          errorMessage = `Erro ${response.status}: ${response.statusText || 'Erro ao confirmar convocação'}`;
        }
        throw new Error(errorMessage);
      }

      let result;
      try {
        result = await response.json();
      } catch (e) {
        console.error('Erro ao parsear resposta:', e);
        throw new Error('Erro ao processar resposta do servidor');
      }
      
      // Sucesso da confirmação + canal da mensagem: Switch Digital primeiro; wa.me só se a API do Switch falhar.
      const webhook = result.mensagensEnviadasViaWebhook || {};
      let msgSucesso = result.message || 'Convocação confirmada com sucesso!';
      let tipoToast = 'success';
      if (webhook.selecionado) {
        msgSucesso += ' Mensagem enviada por WhatsApp (Switch Digital) ao motorista selecionado.';
        if (webhook.naoSelecionados > 0) {
          msgSucesso += ` ${webhook.naoSelecionados} aviso(s) enviado(s) aos que aceitaram e não foram escolhidos.`;
        }
      } else if (result.whatsappLink) {
        tipoToast = 'warning';
        msgSucesso += ' O envio automático pelo Switch Digital não foi concluído.';
        if (webhook.erroSelecionado) {
          msgSucesso += ` Detalhe: ${webhook.erroSelecionado}`;
        }
        msgSucesso += ' Abrindo o WhatsApp com o texto pré-preenchido (envio manual de reserva). Corrija o ticket/fila no Switch ou feche o atendimento em aberto para esse número.';
      }
      const nVeicVinc = Number(result.veiculosVinculadosConfirmacao);
      if (Number.isFinite(nVeicVinc) && nVeicVinc > 0) {
        msgSucesso += ` ${nVeicVinc} veículo(s) vinculado(s) à viagem (aba Gerenciar Veículo).`;
      }
      showMessage(msgSucesso, tipoToast);

      // Se o Switch não enviou para o selecionado, abrir link wa.me como fallback
      if (result.whatsappLink && !webhook.selecionado) {
        setTimeout(() => {
          const opened = window.open(result.whatsappLink, '_blank');
          if (!opened) {
            console.warn('Falha ao abrir WhatsApp. Pode estar bloqueado pelo navegador.');
            showMessage('Convocação confirmada! Use o link da convocação para enviar a mensagem manualmente.', 'info');
          }
        }, 500);
      }

      // Log de confirmação
      if (window.logConfirmacao && result) {
        window.logConfirmacao(
          convocacao.IDVIAGEM,
          idConvocacao,
          convocacao.CDCADASTRO_MOTORISTA,
          {
            nomeMotorista: convocacao.NOME_MOTORISTA,
            outrasAceitas: outrasAceitas,
            whatsappLink: result.whatsappLink ? 'Sim' : 'Não'
          }
        );
      }

      // Recarregar a lista de convocações
      await carregarConvocacoes();
    } catch (err) {
      console.error('Erro ao confirmar convocação:', err);
      showMessage('Erro ao confirmar convocação: ' + err.message, 'error');
    }
  };

  /**
   * Modal de validades: resolve só após fechar (X, Fechar, fundo ou Esc).
   * O #confirmModal (modulos.css) usa z-index 9999, acima do .modal-tratamento padrão (1000).
   */
  async function aguardarModalValidadesFechado(config) {
    const modal = document.getElementById('modalValidadesMotorista');
    const conteudo = document.getElementById('modalValidadesMotoristaConteudo');
    const subtitulo = document.getElementById('modalValidadesMotoristaSubtitulo');
    const titulo = document.querySelector('#modalValidadesMotorista h3');
    const { tituloHtml, subtituloText, setTimeoutTituloCheck, carregar } = config;

    if (!modal || !conteudo) {
      console.error('Modal de validades não encontrado');
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const isClosed = () => settled;

      const finalize = () => {
        if (settled) return;
        settled = true;
        modal.style.display = 'none';
        modal.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onEscape);
        resolve();
      };

      const onBackdropClick = (e) => {
        if (e.target === modal) finalize();
      };
      const onEscape = (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') finalize();
      };

      modal.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onEscape);

      const btnX = document.getElementById('btnFecharModalValidadesMotorista');
      const btnRodape = document.getElementById('btnFecharModalValidadesRodape');
      if (btnX) {
        btnX.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          finalize();
        };
      }
      if (btnRodape) {
        btnRodape.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          finalize();
        };
      }

      if (titulo) titulo.innerHTML = tituloHtml;
      if (subtitulo) subtitulo.textContent = subtituloText;

      modal.style.display = 'flex';

      if (typeof setTimeoutTituloCheck === 'function') {
        setTimeout(setTimeoutTituloCheck, 10);
      }

      conteudo.innerHTML = '<div style="text-align: center; padding: 40px; color: #6c757d;">Carregando validades...</div>';

      (async () => {
        await carregar(conteudo, isClosed);
      })();
    });
  }

  // Mostrar validades do motorista
  window.mostrarValidadesMotorista = async function(cdMotorista, nomeMotorista) {
    await aguardarModalValidadesFechado({
      tituloHtml: '<i class=\'bx bx-user\'></i> Validades do Motorista',
      subtituloText: `${nomeMotorista} • Código: ${cdMotorista}`,
      setTimeoutTituloCheck: () => {
        const tituloModal = document.querySelector('#modalValidadesMotorista h3');
        if (tituloModal && tituloModal.textContent.includes('Motorista')) {
          tituloModal.innerHTML = '<i class=\'bx bx-user\'></i> Validades do Motorista';
        }
      },
      carregar: async (conteudo, isClosed) => {
        try {
          const response = await fetch(`/api/validades/MOT/${cdMotorista}`);
          if (!response.ok) {
            throw new Error(`Erro ao buscar validades: ${response.status}`);
          }
          const validades = await response.json();
          if (isClosed()) return;
          if (!validades || validades.length === 0) {
            conteudo.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #6c757d;">
            <p style="font-size: 16px; margin-bottom: 10px;"><i class="bx bx-list-ul" style="vertical-align: middle;"></i> Nenhuma validade cadastrada para este motorista.</p>
            <p style="font-size: 13px; color: #95a5a6;">Este motorista não possui validades cadastradas no sistema.</p>
          </div>
        `;
            return;
          }
          let html = '<div style="display: grid; gap: 12px;">';
          validades.forEach((val) => {
            const dtLib = fmtData(val.DTLIBERACAO);
            const dtVal = fmtData(val.DTVALIDADE);
            const dias = val.DIAS_RESTANTES;
            let corStatus = '#27ae60';
            let textoStatus = `<i class="bx bx-check" style="font-size:1em; vertical-align: middle;"></i> Válida (${dias} dias)`;
            if (val.STATUS_VALIDADE === 'VENCIDA') {
              corStatus = '#e74c3c';
              textoStatus = `<i class="bx bx-x-circle" style="font-size:1em; vertical-align: middle;"></i> VENCIDA (${Math.abs(dias)} dias atrás)`;
            } else if (val.STATUS_VALIDADE === 'VENCENDO') {
              corStatus = '#f39c12';
              textoStatus = `<i class="bx bx-error-circle" style="font-size:1em; vertical-align: middle;"></i> Vencendo (${dias} dias)`;
            }
            html += `
          <div class="validade-card" style="background: #fff; border: 1px solid #e9ecef; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px;">
            <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
            <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="margin-bottom: 12px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <span style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
              </div>
              <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                  <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                  <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
                </div>
                ${val.DSLIBERACAO ? `
                <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px;">
                  <i class='bx bx-note' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Obs:</span>
                  <strong style="color: #495057; margin-left: 4px;">${val.DSLIBERACAO}</strong>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
        `;
          });
          html += '</div>';
          if (!isClosed()) conteudo.innerHTML = html;
        } catch (err) {
          console.error('Erro ao carregar validades:', err);
          if (!isClosed()) {
            conteudo.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <p style="font-size: 16px; margin-bottom: 10px;"><i class="bx bx-x-circle" style="vertical-align: middle;"></i> Erro ao carregar validades</p>
          <p style="font-size: 13px; color: #95a5a6;">${err.message || 'Não foi possível carregar as validades do motorista.'}</p>
        </div>
      `;
          }
        }
      }
    });
  };

  // Mostrar validades do veículo
  window.mostrarValidadesVeiculo = async function(idequipamento, nomeVeiculo) {
    await aguardarModalValidadesFechado({
      tituloHtml: '<i class=\'bx bx-truck\'></i> Validades do Veículo',
      subtituloText: `${nomeVeiculo} • Código: ${idequipamento}`,
      setTimeoutTituloCheck: () => {
        const tituloModal = document.querySelector('#modalValidadesMotorista h3');
        if (tituloModal && tituloModal.textContent.includes('Veículo')) {
          tituloModal.innerHTML = '<i class=\'bx bx-truck\'></i> Validades do Veículo';
        }
      },
      carregar: async (conteudo, isClosed) => {
        try {
          const response = await fetch(`/api/validades/EQP/${idequipamento}`);
          if (!response.ok) {
            throw new Error(`Erro ao buscar validades: ${response.status}`);
          }
          const validades = await response.json();
          if (isClosed()) return;
          if (!validades || validades.length === 0) {
            conteudo.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #6c757d;">
            <p style="font-size: 16px; margin-bottom: 10px;"><i class="bx bx-list-ul" style="vertical-align: middle;"></i> Nenhuma validade cadastrada para este veículo.</p>
            <p style="font-size: 13px; color: #95a5a6;">Este veículo não possui validades cadastradas no sistema.</p>
          </div>
        `;
            return;
          }
          let html = '<div style="display: grid; gap: 12px;">';
          validades.forEach((val) => {
            const dtLib = fmtData(val.DTLIBERACAO);
            const dtVal = fmtData(val.DTVALIDADE);
            const dias = val.DIAS_RESTANTES;
            let corStatus = '#27ae60';
            let textoStatus = `<i class="bx bx-check" style="font-size:1em; vertical-align: middle;"></i> Válida (${dias} dias)`;
            if (val.STATUS_VALIDADE === 'VENCIDA') {
              corStatus = '#e74c3c';
              textoStatus = `<i class="bx bx-x-circle" style="font-size:1em; vertical-align: middle;"></i> VENCIDA (${Math.abs(dias)} dias atrás)`;
            } else if (val.STATUS_VALIDADE === 'VENCENDO') {
              corStatus = '#f39c12';
              textoStatus = `<i class="bx bx-error-circle" style="font-size:1em; vertical-align: middle;"></i> Vencendo (${dias} dias)`;
            }
            html += `
          <div class="validade-card" style="background: #fff; border: 1px solid #e9ecef; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px;">
            <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
            <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="margin-bottom: 12px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <span style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
              </div>
              <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                  <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                  <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
                </div>
                ${val.DSLIBERACAO ? `
                <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px;">
                  <i class='bx bx-note' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Obs:</span>
                  <strong style="color: #495057; margin-left: 4px;">${val.DSLIBERACAO}</strong>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
        `;
          });
          html += '</div>';
          if (!isClosed()) conteudo.innerHTML = html;
        } catch (err) {
          console.error('Erro ao carregar validades:', err);
          if (!isClosed()) {
            conteudo.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <p style="font-size: 16px; margin-bottom: 10px;"><i class="bx bx-x-circle" style="vertical-align: middle;"></i> Erro ao carregar validades</p>
          <p style="font-size: 13px; color: #95a5a6;">${err.message || 'Não foi possível carregar as validades do veículo.'}</p>
        </div>
      `;
          }
        }
      }
    });
  };

  // Reativar convocação (reverter CONFIRMADA ou ACEITA_DESCARTADA para ACEITA)
  window.reativarConvocacao = async function(idConvocacao) {
    if (!idConvocacao) {
      showMessage(t('web.modulos.viagens.mensagens.id_convocacao_nao_informado') || 'ID da convocação não informado.', 'error');
      return;
    }

    // Buscar dados da convocação
    const convocacao = convocacoes.find(c => c.IDCONVOCACAO === idConvocacao);
    if (!convocacao) {
      showMessage(t('web.modulos.viagens.mensagens.convocacao_nao_encontrada') || 'Convocação não encontrada.', 'error');
      return;
    }

    if (convocacao.STATUS !== 'CONFIRMADA') {
      showMessage(t('web.modulos.viagens.mensagens.apenas_confirmada_reativar') || `Apenas convocações com status CONFIRMADA podem ser reativadas. Status atual: ${convocacao.STATUS}`, 'error');
      return;
    }

    // Validação: Não permitir reativar se já houver motorista ou veículo atrelado à viagem
    try {
      const idViagem = convocacao.IDVIAGEM;
      const resVeiculo = await fetchApiViagens(`/${idViagem}/veiculo`);
      const resMotorista = await fetchApiViagens(`/${idViagem}/motorista`);
      
      let temVeiculo = false;
      let temMotorista = false;
      
      if (resVeiculo.ok) {
        const veiculos = await resVeiculo.json();
        temVeiculo = Array.isArray(veiculos) && veiculos.length > 0;
      }
      
      if (resMotorista.ok) {
        const motoristas = await resMotorista.json();
        temMotorista = Array.isArray(motoristas) && motoristas.length > 0;
      }
      
      if (temVeiculo || temMotorista) {
        const msgPartes = [];
        if (temMotorista) msgPartes.push(t('web.modulos.viagens.motorista') || 'um Motorista');
        if (temVeiculo) msgPartes.push(t('web.modulos.viagens.veiculo') || 'um Veículo');
        
        const partesTexto = msgPartes.join(' e ');
        showMessage(t('web.modulos.viagens.mensagens.erro_reativar_vinculos') || `Não é possível reativar a convocação, pois esta viagem já possui ${partesTexto} atrelado(s). Remova-os primeiro.`, 'error');
        return;
      }
    } catch (err) {
      console.error('Erro ao verificar vínculos da viagem:', err);
    }

    try {
      // Carregar motivos de reabertura
      const responseMotivos = await fetch('/api/motivos-reabertura-combo');
      if (!responseMotivos.ok) {
        throw new Error('Erro ao carregar motivos de reabertura');
      }
      const motivos = await responseMotivos.json();

      if (motivos.length === 0) {
        showMessage('Nenhum motivo de reabertura cadastrado. Contate o administrador.', 'error');
        return;
      }

      // Criar opções do select
      let opcoesMotivos = '<option value="">Selecione o motivo da reabertura...</option>';
      motivos.forEach(motivo => {
        opcoesMotivos += `<option value="${motivo.CDMOTIVO}">${motivo.DSMOTIVO}</option>`;
      });

      const mensagemModal = `
        <div class="convocacao-modal-body">
          <p class="convocacao-modal-meta"><strong>Viagem:</strong> <span class="convocacao-modal-meta-valor">${convocacao.IDVIAGEM}</span></p>
          <p class="convocacao-modal-meta"><strong>Motorista:</strong> <span class="convocacao-modal-meta-valor">${convocacao.NOME_MOTORISTA || 'N/A'}</span></p>
          <p class="convocacao-modal-meta"><strong>Status Atual:</strong> <span class="convocacao-modal-meta-valor">CONFIRMADA</span></p>
          <div class="convocacao-modal-alerta" style="margin-top: 20px;" role="region" aria-label="Aviso sobre reativação">
            <p class="convocacao-modal-alerta__titulo">
              <i class="bx bx-error-circle" aria-hidden="true"></i> ATENÇÃO:
            </p>
            <p class="convocacao-modal-alerta__texto" style="margin-bottom: 0;">
              Esta convocação será reativada e o status voltará para <strong>ACEITA</strong>.<br>
              <strong>As outras convocações ACEITA (Não Selecionada) da mesma viagem também serão reativadas automaticamente.</strong>
            </p>
          </div>
          <div style="margin-top: 20px;">
            <label for="selectMotivoReabertura" class="convocacao-modal-reativar-label" style="display: block; margin-bottom: 10px; font-weight: 600;">
              <i class="bx bx-list-ul" style="font-size: 1em; vertical-align: middle;"></i> Selecione o motivo da reabertura: *
            </label>
            <select id="selectMotivoReabertura" class="convocacao-modal-select" style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; background: #fff; color: #222; appearance: none; -webkit-appearance: none; -moz-appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23667eea%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-6.5%200-12.1%203.2-15.2%208.1-3.1%204.9-3.1%2010.8%200%2015.8l128%20128c3.2%203.2%207.1%204.7%2011.1%204.7s7.9-1.6%2011.1-4.7l128-128c3.1-5%203.1-10.9%200-15.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 12px center; background-size: 12px; cursor: pointer; transition: border-color 0.3s, box-shadow 0.3s;">
              ${opcoesMotivos}
            </select>
            <p id="erroMotivoReabertura" class="convocacao-modal-erro" style="font-size: 14px; margin-top: 5px; display: none;">
              Por favor, selecione um motivo.
            </p>
          </div>
        </div>
      `;

      const confirmado = await showConfirmModal(
        '<i class="bx bx-refresh"></i> Reativar Convocação',
        mensagemModal
      );

      if (!confirmado) {
        return;
      }

      // Validar motivo selecionado
      const selectMotivo = document.getElementById('selectMotivoReabertura');
      const erroMotivo = document.getElementById('erroMotivoReabertura');
      
      if (!selectMotivo || !selectMotivo.value || selectMotivo.value === '') {
        if (erroMotivo) erroMotivo.style.display = 'block';
        if (selectMotivo) selectMotivo.focus();
        return;
      }

      const motivoReabertura = selectMotivo.value;

      // Obter usuário logado
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';

      showMessage('Reativando convocação...', 'info');

      const response = await fetch(`/api/convocacoes/${idConvocacao}/reativar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin || '',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ motivoReabertura })
      });

      if (!response.ok) {
        let errorMessage = 'Erro ao reativar convocação';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // Se não for JSON, usamos a mensagem padrão
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Log de reativação
      if (window.logReativacao && result) {
        window.logReativacao(
          result.idViagem || convocacao.IDVIAGEM,
          idConvocacao,
          convocacao.CDCADASTRO_MOTORISTA,
          motivoReabertura,
          {
            nomeMotorista: convocacao.NOME_MOTORISTA,
            motivoDescricao: result.motivo || motivoReabertura,
            outrasConvocacoesReativadas: result.outrasReativadas || 0
          }
        );
      }
      
      // Verificar se o motivo foi "Motorista Desistiu da Carga"
      const motivoDesistiu = result.motivo === 'Motorista Desistiu da Carga';
      
      // Buscar todas as convocações da mesma viagem para filtrar quais devem receber mensagem
      const responseConvocacoes = await fetch(`/api/convocacoes?idViagem=${result.idViagem}`);
      if (!responseConvocacoes.ok) {
        throw new Error('Erro ao buscar convocações da viagem');
      }
      const todasConvocacoes = await responseConvocacoes.json();
      
      // Filtrar convocações que devem receber mensagem novamente
      const convocacoesParaEnviar = todasConvocacoes.filter(conv => {
        // Excluir RECUSADAS
        if (conv.STATUS === 'RECUSADA') {
          return false;
        }
        
        // Se o motivo da reativação atual foi "Motorista Desistiu da Carga", 
        // excluir a convocação que foi reativada (agora está ACEITA)
        if (motivoDesistiu && conv.IDCONVOCACAO === idConvocacao && conv.STATUS === 'ACEITA') {
          return false;
        }
        
        // Incluir ACEITA_DESCARTADA (aceitaram mas não foram selecionados)
        if (conv.STATUS === 'ACEITA_DESCARTADA' || conv.STATUS === 'ACEITA') {
          return true;
        }
        
        // Incluir PENDENTE (nem viram ainda)
        if (conv.STATUS === 'PENDENTE') {
          return true;
        }
        
        // Para CONFIRMADA: verificar o motivo de reabertura individual
        if (conv.STATUS === 'CONFIRMADA') {
          // Se tem motivo de reabertura e é "Motorista Desistiu da Carga", excluir
          if (conv.MOTIVO_REABERTURA === 'Motorista Desistiu da Carga') {
            return false;
          }
          // Se não tem motivo ou o motivo é outro, incluir
          return true;
        }
        
        return false;
      });
      
      // Se houver convocações para enviar, abrir modal de links
      if (convocacoesParaEnviar.length > 0) {
        // Buscar dados completos da viagem para gerar mensagem formatada
        const responseViagem = await fetchApiViagens(`/${result.idViagem}`);
        if (!responseViagem.ok) {
          throw new Error('Erro ao buscar dados da viagem');
        }
        const viagemAtual = await responseViagem.json();
        
        if (!viagemAtual) {
          throw new Error('Dados da viagem não encontrados');
        }
        
        // Função para formatar data/hora (mesma lógica do prepararAnuncioCarga)
        const formatarDataHora = (dataHora) => {
          if (!dataHora) return 'Não informado';
          
          if (typeof dataHora === 'string') {
            let dataStr = dataHora.replace('Z', '');
            if (dataStr.includes('T')) {
              dataStr = dataStr.replace('T', ' ');
            }
            
            const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
              const [, year, month, day, hour, minute] = match;
              const diaStr = String(day).padStart(2, '0');
              const mesStr = String(month).padStart(2, '0');
              const anoStr = year;
              const horaStr = String(hour).padStart(2, '0');
              const minutoStr = String(minute).padStart(2, '0');
              
              return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
            }
          }
          
          try {
            const date = new Date(dataHora);
            if (isNaN(date.getTime())) return 'Data inválida';
            
            const ano = date.getUTCFullYear();
            const mes = date.getUTCMonth();
            const dia = date.getUTCDate();
            const hora = date.getUTCHours();
            const minuto = date.getUTCMinutes();
            
            const diaStr = String(dia).padStart(2, '0');
            const mesStr = String(mes + 1).padStart(2, '0');
            const anoStr = ano;
            const horaStr = String(hora).padStart(2, '0');
            const minutoStr = String(minuto).padStart(2, '0');
            
            return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
          } catch (err) {
            return 'Data inválida';
          }
        };
        
        // Gerar texto base formatado (mesma estrutura do prepararAnuncioCarga, sem emojis)
        let textoBase = `*CARGA DISPONÍVEL*\n\n`;
        textoBase += `*ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
        textoBase += `*Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
        textoBase += `*Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
        textoBase += `*Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} -> ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
        textoBase += `*HORÁRIOS*\n`;
        textoBase += `*Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
        textoBase += `*Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
        
        if (viagemAtual.FGRASTREADO === 'S') {
          textoBase += `*REQUISITOS*\n`;
          textoBase += `*Exige Veículo Rastreado:* SIM\n\n`;
        }
        
        textoBase += `*CONTRATADOR*\n`;
        textoBase += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
        textoBase += `*VALORES*\n`;
        textoBase += `*Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
        textoBase += `*Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
        textoBase += `*Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\n`;
        
        if (viagemAtual.OBSERV) {
          textoBase += `\n*DETALHES DA VIAGEM*\n`;
          textoBase += `${viagemAtual.OBSERV}\n`;
        }
        
        // Obter URL base pública
        const urlBase = await obterUrlPublica();
        const linksWhatsApp = [];
        let semCelular = 0;
        const motoristasSemCelular = [];
        
        for (const conv of convocacoesParaEnviar) {
          const nomeMotorista = conv.NOME_MOTORISTA || 'Motorista';
          
          if (!conv.CELULAR_MOTORISTA) {
            semCelular++;
            motoristasSemCelular.push(nomeMotorista);
            continue;
          }
          
          // Limpar número (apenas dígitos). Internacional: 12+ = já tem DDI; 10-11 = adicionar 55
          let numeroLimpo = String(conv.CELULAR_MOTORISTA).replace(/\D/g, '');
          if (numeroLimpo.startsWith('0')) numeroLimpo = numeroLimpo.substring(1);
          if (numeroLimpo.length < 12 && numeroLimpo.length >= 10) numeroLimpo = '55' + numeroLimpo;
          if (numeroLimpo.length < 12) {
            semCelular++;
            motoristasSemCelular.push(nomeMotorista);
            continue;
          }
          
          // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
          const linkConvocacao = conv.LINKCONVOCACAO && conv.LINKCONVOCACAO.trim() !== '' 
            ? conv.LINKCONVOCACAO 
            : `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
          
          // Personalizar mensagem para cada motorista (mesma lógica do enviarAnuncioWhatsApp)
          const nomeMotoristaConvocacao = conv.NOME_MOTORISTA || 'Motorista';
          const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
          
          // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
          const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
          
          let textoComLink;
          if (isLocalIP) {
            textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n*Importante:*\n- Links locais não são clicáveis no WhatsApp\n- Copie o link acima (toque e segure)\n- Cole no navegador do celular\n- Certifique-se de estar na mesma rede Wi-Fi`;
          } else {
            // Verificar se é ngrok (tem página de aviso)
            const isNgrok = urlBase.includes('ngrok-free.dev') || urlBase.includes('ngrok.io');
            
            if (isNgrok) {
              textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n*Toque no link acima para responder*\n\n*Aviso:* Na primeira vez, você verá uma página de segurança. Clique em "Visit Site" para continuar.`;
            } else {
              textoComLink = `${mensagemPersonalizada}\n\n*Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
            }
          }
          
          const linkWhatsApp = `https://wa.me/${numeroLimpo}?text=${encodeURIComponent(textoComLink)}`;
          
          linksWhatsApp.push({
            idConvocacao: conv.IDCONVOCACAO,
            motorista: conv.NOME_MOTORISTA || 'Motorista',
            celular: conv.CELULAR_MOTORISTA,
            link: linkWhatsApp,
            status: conv.STATUS
          });
        }
        
        if (linksWhatsApp.length > 0) {
          // Mostrar mensagem de sucesso
          showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
          
          // Aguardar um pouco antes de abrir o modal
          setTimeout(() => {
            mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, 0, motoristasSemCelular, []);
          }, 500);
        } else {
          showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
          if (semCelular > 0) {
            showMessage(`${semCelular} motorista(s) sem celular válido não receberão mensagem.`, 'warning');
          }
        }
      } else {
        showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
      }

      // Recarregar a lista de convocações
      await carregarConvocacoes();
    } catch (err) {
      console.error('Erro ao reativar convocação:', err);
      showMessage('Erro ao reativar convocação: ' + err.message, 'error');
    }
  };

  // Inicializar event listeners para a aba Compatíveis
  let listenersCompatíveisInicializados = false;
  
  function inicializarEventListenersCompatíveis() {
    // Evitar inicializar múltiplas vezes
    if (listenersCompatíveisInicializados) {
      return;
    }
    
    const btnCarregarPendentes = document.getElementById('btnCarregarViagensPendentes');
    const btnBuscarMotoristas = document.getElementById('btnBuscarMotoristas');
    const btnVoltarCompatíveis = document.getElementById('btnVoltarCompatíveis');
    const selectViagem = document.getElementById('selectViagemPendente');
    const btnDispararConvocacoes = document.getElementById('btnDispararConvocacoes');

    // Carregar regras de compatibilidade ao abrir a aba
    carregarRegrasCompatibilidade();

    if (btnCarregarPendentes) {
      btnCarregarPendentes.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        carregarViagensPendentes();
      };
    }

    const btnSalvarRegras = document.getElementById('btnSalvarRegrasCompatibilidade');
    if (btnSalvarRegras) {
      btnSalvarRegras.onclick = async function() {
        const msgEl = document.getElementById('msgRegrasCompatibilidade');
        if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
        try {
          const r = await fetchApiViagens('/regras-compatibilidade', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rastreamento: document.getElementById('regraCompativelRastreamento')?.checked ?? true,
              classeFrota: document.getElementById('regraCompativelClasseFrota')?.checked ?? true,
              localEmbarque: document.getElementById('regraCompativelLocalEmbarque')?.checked ?? true,
              localDesembarque: document.getElementById('regraCompativelLocalDesembarque')?.checked ?? true
            })
          });
          let data;
          const responseText = await r.text();
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch (_) {
            console.error('[Regras compatibilidade] Resposta não é JSON. Status:', r.status, 'Body:', responseText.slice(0, 200));
            if (msgEl) { msgEl.textContent = 'Erro ao salvar regras. Resposta inválida do servidor.'; msgEl.className = 'message error'; msgEl.style.display = 'inline'; }
            return;
          }
          if (r.ok && data.success) {
            if (msgEl) { msgEl.textContent = data.message || 'Regras salvas.'; msgEl.className = 'message success'; msgEl.style.display = 'inline'; }
            // Reprocessar lista: se já tiver viagem selecionada, buscar motoristas compatíveis de novo
            const selectViagem = document.getElementById('selectViagemPendente');
            const idViagem = selectViagem ? selectViagem.value : null;
            if (idViagem) {
              buscarMotoristasCompatíveis(idViagem);
            }
          } else {
            let errMsg = data.error || data.details || 'Erro ao salvar.';
            if (data.camposRequeridos && Array.isArray(data.camposRequeridos) && data.camposRequeridos.length > 0) {
              errMsg += ' Campos: ' + data.camposRequeridos.join(', ');
            }
            if (r.status === 400 && (data.error || '').indexOf('Campos obrigatórios') !== -1) {
              errMsg += ' (Dica: se você estava só salvando as regras da aba Compatíveis, reinicie o servidor do backend e tente de novo.)';
            }
            console.warn('[Regras compatibilidade] Erro:', r.status, data);
            if (msgEl) { msgEl.textContent = errMsg; msgEl.className = 'message error'; msgEl.style.display = 'inline'; }
          }
        } catch (e) {
          console.error('[Regras compatibilidade] Exceção ao salvar:', e);
          if (msgEl) { msgEl.textContent = (e && e.message) ? `Erro ao salvar regras: ${e.message}` : 'Erro ao salvar regras.'; msgEl.className = 'message error'; msgEl.style.display = 'inline'; }
        }
      };
    }

    if (btnBuscarMotoristas) {
      btnBuscarMotoristas.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        buscarMotoristasCompatíveis();
      };
    }

    if (selectViagem) {
      selectViagem.onchange = function() {
        limparResumoClasseViagemCompativeis();
        if (this.value && String(this.value).trim()) {
          viagemSelecionada = String(this.value).trim();
        }
        const btnBuscar = document.getElementById('btnBuscarMotoristas');
        if (btnBuscar) {
          btnBuscar.disabled = !this.value;
        }
      };
    }

    if (btnVoltarCompatíveis) {
      btnVoltarCompatíveis.onclick = function() {
        showTab('filtros');
      };
    }

    if (btnDispararConvocacoes) {
      btnDispararConvocacoes.onclick = dispararConvocacoes;
    }

    async function reenviarConvocacoesFalhas() {
      if (!viagemSelecionada) {
        showMessage('Nenhuma viagem selecionada. Selecione uma viagem e busque motoristas compatíveis.', 'error');
        return;
      }
      try {
        const resp = await fetch('/api/convocacoes?idViagem=' + encodeURIComponent(viagemSelecionada));
        if (!resp.ok) throw new Error('Erro ao buscar convocações');
        const todas = await resp.json();
        const get = (c, ...keys) => { for (const k of keys) { if (c[k] != null && c[k] !== '') return c[k]; const l = k.toLowerCase(); if (c[l] != null && c[l] !== '') return c[l]; } return null; };
        const pendentes = todas.filter(c => {
          const dhenvio = get(c, 'DHENVIOMETA', 'dhenviometa');
          const nr = (get(c, 'NRCELULAR', 'nrcelular') || get(c, 'CELULAR_MOTORISTA', 'celular_motorista') || '').toString().replace(/\D/g, '');
          return !dhenvio && nr.length >= 10;
        });
        if (pendentes.length === 0) {
          showMessage('Nenhuma convocação pendente de envio para esta viagem. Todas já foram enviadas ou não há número de WhatsApp válido.', 'info');
          return;
        }
        const confirmar = await showConfirmModal(
          'Reenviar apenas não enviados',
          `Deseja reenviar <strong>${pendentes.length}</strong> convocação(ões) que ainda não foram enviadas por WhatsApp?<br><br><small style="color: #b8c5d6;">Serão enviadas apenas as que falharam ou nunca foram disparadas (intervalo de 2 s entre cada).</small>`
        );
        if (!confirmar) return;
        showMessage('Reenviando convocações não enviadas...', 'info');
        let baseUrl = window.location.origin;
        try {
          const urlRes = await fetch('/api/public-url');
          if (urlRes.ok) { const d = await urlRes.json(); if (d && d.url) baseUrl = d.url; }
        } catch (e) {}
        const convocacoesFormatadas = pendentes.map(c => {
          const nr = (get(c, 'NRCELULAR', 'nrcelular') || get(c, 'CELULAR_MOTORISTA', 'celular_motorista') || '').toString().replace(/\D/g, '');
          return {
            IDCONVOCACAO: get(c, 'IDCONVOCACAO', 'idconvocacao'),
            NRCELULAR: nr,
            FONE: nr,
            NOME_MOTORISTA: get(c, 'NOME_MOTORISTA', 'nome_motorista') || 'Motorista',
            CDCADASTRO_MOTORISTA: get(c, 'CDCADASTRO_MOTORISTA', 'cdcadastro_motorista')
          };
        });
        if (typeof window.adicionarLogSwitch === 'function') {
          window.adicionarLogSwitch({
            tipo: 'info',
            titulo: 'Reenviar apenas não enviados',
            mensagem: 'Enviando ' + convocacoesFormatadas.length + ' convocação(ões) pendentes para o backend (intervalo 2 s).',
            detalhes: convocacoesFormatadas,
            idViagem: viagemSelecionada
          });
        }
        const response = await fetchApiViagens('/webhook/switch-digital', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viagemId: viagemSelecionada, convocacoes: convocacoesFormatadas, baseUrl: baseUrl })
        });
        const errReenv = await rejeicaoSeRespostaNaoOk(response, 'Erro ao reenviar mensagens');
        if (errReenv) throw errReenv;
        const resultData = await response.json();
        if (typeof window.adicionarLogSwitch === 'function') {
          window.adicionarLogSwitch({
            tipo: resultData.erros > 0 ? (resultData.sucessos > 0 ? 'warning' : 'erro') : 'sucesso',
            titulo: 'Fila Processada no Backend',
            mensagem: 'O Servidor concluiu a fila de disparos. Sucessos: ' + resultData.sucessos + ', Erros: ' + resultData.erros,
            detalhes: resultData.detalhes || [],
            idViagem: viagemSelecionada
          });
        }
        if (resultData.erros > 0) {
          showMessage('Atenção: ' + resultData.erros + ' de ' + resultData.total + ' mensagens falharam. Verifique a aba Switch Digital.', 'warning');
        } else {
          showMessage(resultData.sucessos + ' mensagem(ns) reenviada(s) com sucesso.', 'success');
        }
        if (typeof motoristasCompatíveis !== 'undefined' && motoristasCompatíveis.length > 0 && typeof carregarMotoristasCompatíveis === 'function') {
          carregarMotoristasCompatíveis(viagemSelecionada);
        }
      } catch (err) {
        console.error('[Reenviar falhas]', err);
        showMessage('Erro ao reenviar: ' + (err.message || err), tipoMensagemErroHttp(err));
      }
    }

    const btnReenviarFalhas = document.getElementById('btnReenviarFalhas');
    if (btnReenviarFalhas) {
      btnReenviarFalhas.onclick = reenviarConvocacoesFalhas;
    }

    // Botões do modal de anúncio
    const btnFecharAnuncio = document.getElementById('btnFecharAnuncio');
    const btnCopiarAnuncio = document.getElementById('btnCopiarAnuncio');
    const btnEnviarWhatsApp = document.getElementById('btnEnviarWhatsApp');
    const modalAnuncio = document.getElementById('modalAnuncio');

    if (btnFecharAnuncio) {
      btnFecharAnuncio.onclick = function() {
        modalAnuncio.style.display = 'none';
      };
    }

    if (btnCopiarAnuncio) {
      btnCopiarAnuncio.onclick = copiarAnuncio;
    }

    if (btnEnviarWhatsApp) {
      btnEnviarWhatsApp.onclick = window.abrirModalDisparoWhatsApp;
    }

    // Fechar modal ao clicar fora dele
    if (modalAnuncio) {
      modalAnuncio.onclick = function(e) {
        if (e.target === modalAnuncio) {
          modalAnuncio.style.display = 'none';
        }
      };
    }

    listenersCompatíveisInicializados = true;
  }

  // Inicializar listeners quando o DOM estiver pronto
  function tentarInicializarListeners() {
    const btnCarregarPendentes = document.getElementById('btnCarregarViagensPendentes');
    if (btnCarregarPendentes) {
      inicializarEventListenersCompatíveis();
    } else {
      // Tentar novamente após um delay
      setTimeout(tentarInicializarListeners, 200);
    }
  }

  // Inicializar imediatamente se possível
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      tentarInicializarListeners();
      inicializarModalAjuda();
    });
  } else {
    // DOM já está pronto
    tentarInicializarListeners();
    inicializarModalAjuda();
  }

  // Modal de Ajuda/Manual
  function inicializarModalAjuda() {
    const btnAjuda = document.getElementById('btnAjudaConvocacoes');
    const modalAjuda = document.getElementById('modalAjuda');
    const btnFecharAjuda = document.getElementById('btnFecharAjuda');
    const conteudoAjuda = document.getElementById('conteudoAjuda');

    if (!btnAjuda || !modalAjuda || !conteudoAjuda) return;

    // Preencher conteúdo do manual
    conteudoAjuda.innerHTML = gerarConteudoManual();

    // Abrir modal
    btnAjuda.addEventListener('click', () => {
      modalAjuda.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });

    // Fechar modal
    if (btnFecharAjuda) {
      btnFecharAjuda.addEventListener('click', () => {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      });
    }

    // Fechar ao clicar fora
    modalAjuda.addEventListener('click', (e) => {
      if (e.target === modalAjuda) {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      }
    });

    // Fechar com ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (modalAjuda.style.display === 'flex' || modalAjuda.style.display === '')) {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  }

  function gerarConteudoManual() {
    return `
      <div style="max-width: 1000px; margin: 0 auto;">
        <!-- Visão Geral -->
        <section style="margin-bottom: 40px; padding: 25px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h2 style="margin: 0 0 15px 0; font-size: 28px; display: flex; align-items: center; gap: 10px;">
            <span>🎯</span>
            <span>Visão Geral</span>
          </h2>
          <p style="margin: 0; font-size: 16px; line-height: 1.8; opacity: 0.95;">
            O <strong>Sistema de Convocações</strong> é o coração da ferramenta Atlas Cargo, responsável por identificar motoristas compatíveis, enviar convites via WhatsApp, gerenciar respostas e confirmar atribuição de viagens.
          </p>
        </section>

        <!-- Fluxo Completo -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #28a745;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #28a745; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-refresh" style="font-size: 1.25rem;"></i>
            <span>Fluxo Completo do Processo</span>
          </h2>
          
          <div style="display: grid; gap: 20px;">
            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-list-check" style="vertical-align: middle;"></i> Identificação de Viagens Pendentes</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Botão "Carregar Viagens Pendentes"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Sistema busca viagens com status "Programada" ou "Preparação"</li>
                <li>Filtra apenas viagens que <strong>NÃO</strong> possuem convocação ACEITA ou CONFIRMADA</li>
                <li>Lista ordenada por ID (mais recentes primeiro)</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-search-alt" style="vertical-align: middle;"></i> Busca de Motoristas Compatíveis</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Selecionar viagem → Botão "Buscar Motoristas Compatíveis"</p>
              <p style="margin: 0 0 8px 0;"><strong>Quem pode ser listado:</strong> Motorista, Agente/Parceiro, Grupo de Divulgação e Transportador (respeitando as regras abaixo).</p>
              <p style="margin: 0 0 10px 0;"><strong>Regras para aparecer na lista (TODAS obrigatórias):</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li><strong>Classe de Frota:</strong> O cadastro deve ter a mesma classe de frota da viagem (marcada no Cadastro Geral, ativa).</li>
                <li><strong>Veículo Rastreado:</strong> Se a viagem <strong>exige</strong> veículo rastreado, o cadastro deve ter "Possui Veículo Rastreado" = Sim. Se a viagem não exige, não há impedimento.</li>
                <li><strong>Localização:</strong> Não é obrigatória. A lista mostra todos que atendem tipo + classe + rastreado, de qualquer cidade.</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-megaphone" style="vertical-align: middle;"></i> Preparação do Anúncio</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Selecionar motoristas → Botão "<i class="bx bx-megaphone" style="font-size:1em;"></i> Preparar Anúncio"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Sistema monta texto formatado do anúncio com todos os detalhes da viagem</li>
                <li>Exibe preview no modal</li>
                <li>Permite copiar texto ou enviar via WhatsApp</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-send" style="vertical-align: middle;"></i> Disparo de Convocações</h3>
              <p style="margin: 0 0 10px 0;"><strong>Dois caminhos disponíveis:</strong></p>
              <div style="margin: 10px 0; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                <p style="margin: 0 0 8px 0;"><strong><i class="bx bx-logo-whatsapp" style="vertical-align: middle;"></i> "Enviar via WhatsApp" (Recomendado):</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Cria convocações no banco de dados</li>
                  <li>Gera links únicos para cada motorista</li>
                  <li>Abre WhatsApp com mensagem formatada</li>
                  <li>Grava telefone, texto e link no banco</li>
                </ul>
              </div>
              <div style="margin: 10px 0; padding: 15px; background: #d1ecf1; border-radius: 8px; border-left: 4px solid #0c5460;">
                <p style="margin: 0 0 8px 0;"><strong><i class="bx bx-send" style="vertical-align: middle;"></i> "Disparar Convocações" (Apenas registro):</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Cria convocações no banco de dados</li>
                  <li>NÃO envia WhatsApp automaticamente</li>
                  <li>Útil para registro prévio</li>
                </ul>
              </div>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-show" style="vertical-align: middle;"></i> Acompanhamento de Respostas</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Convocações"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que você pode fazer:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Visualizar todas as convocações enviadas</li>
                <li>Ver status: PENDENTE, ACEITA, RECUSADA, CONFIRMADA</li>
                <li>Rastrear acesso ao link (Data Acesso)</li>
                <li>Confirmar motorista selecionado</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;"><i class="bx bx-user-check" style="vertical-align: middle;"></i> Confirmação do Motorista</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Convocações" → Botão "Confirmar" (apenas para status ACEITA)</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Motorista selecionado fica com status CONFIRMADA</li>
                <li>Outros motoristas ACEITAS ficam como ACEITA_DESCARTADA (histórico preservado)</li>
                <li>Motoristas PENDENTE permanecem PENDENTE (não são marcados como recusados)</li>
                <li>WhatsApp de confirmação é enviado automaticamente ao motorista selecionado</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- Status das Convocações -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #17a2b8;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #17a2b8; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-stats" style="font-size: 1.25rem;"></i>
            <span>Status das Convocações</span>
          </h2>
          
          <div style="display: grid; gap: 15px;">
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #ffc107;">
              <strong style="color: #856404;"><i class="bx bx-time-five" style="vertical-align: middle;"></i> PENDENTE:</strong> Convocação criada, aguardando motorista acessar o link e responder.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #28a745;">
              <strong style="color: #155724;"><i class="bx bx-check-circle" style="vertical-align: middle;"></i> ACEITA:</strong> Motorista acessou o link e aceitou a convocação.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #dc3545;">
              <strong style="color: #721c24;"><i class="bx bx-x-circle" style="vertical-align: middle;"></i> RECUSADA:</strong> Motorista acessou o link e recusou a convocação.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #007bff;">
              <strong style="color: #004085;"><i class="bx bx-check" style="vertical-align: middle;"></i> CONFIRMADA:</strong> Operador confirmou o motorista para a viagem (status final).
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #6c757d;">
              <strong style="color: #383d41;"><i class="bx bx-user-x" style="vertical-align: middle;"></i> ACEITA_DESCARTADA:</strong> Motorista aceitou, mas outro foi selecionado (histórico preservado).
            </div>
          </div>
        </section>

        <!-- Regras de Negócio -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #dc3545;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #dc3545; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-list-ul" style="font-size: 1.25rem;"></i>
            <span>Regras de Negócio Importantes</span>
          </h2>
          
          <div style="display: grid; gap: 15px;">
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>1. Uma viagem = Um motorista confirmado</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Apenas um motorista pode ser confirmado por viagem. Ao confirmar um, outros ACEITAS ficam como ACEITA_DESCARTADA.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>2. Histórico preservado</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Motoristas que aceitaram mas não foram selecionados mantêm o histórico de aceite (ACEITA_DESCARTADA).</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>3. PENDENTE não vira RECUSADA automaticamente</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Motoristas que não acessaram ou não responderam permanecem PENDENTE, mesmo após confirmação de outro motorista.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>4. Compatibilidade obrigatória</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Podem ser listados: Motorista, Agente/Parceiro, Grupo de Divulgação e Transportador. Todos devem atender: mesma classe de frota da viagem; se a viagem exige rastreado, o cadastro deve ter "Possui Veículo Rastreado" = Sim; e localização (micro-região/cidade da rota ou já ter feito esta rota).</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>5. Link único por motorista</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Cada motorista recebe um link único para responder. O acesso é rastreado automaticamente.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>6. Confirmação manual</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Apenas convocações com status ACEITA podem ser confirmadas. O botão "Confirmar" só aparece para essas.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>7. WhatsApp automático na confirmação</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Ao confirmar um motorista, o sistema envia automaticamente uma mensagem de parabéns via WhatsApp com contato do contratador.</p>
            </div>
          </div>
        </section>

        <!-- Dicas -->
        <section style="margin-bottom: 40px; padding: 25px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(245, 87, 108, 0.3);">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-bulb" style="font-size: 1.25rem;"></i>
            <span>Dicas de Uso</span>
          </h2>
          <ul style="margin: 0; padding-left: 20px; line-height: 2;">
            <li>Use "Preparar Anúncio" para visualizar e personalizar a mensagem antes de enviar</li>
            <li>O contador de registros no Grid mostra quantas viagens foram encontradas</li>
            <li>Filtre por "Motorista Confirmado" para ver viagens com ou sem motorista atribuído</li>
            <li>A coluna "Data Acesso" mostra quando o motorista acessou o link (<i class="bx bx-check-circle" style="font-size:1em;"></i> se acessou, <i class="bx bx-x-circle" style="font-size:1em;"></i> se não)</li>
            <li>Links locais (IP) não são clicáveis no WhatsApp - o motorista precisa copiar e colar</li>
            <li>Configure PUBLIC_URL no .env para usar links públicos clicáveis</li>
          </ul>
        </section>

        <!-- Suporte -->
        <section style="padding: 25px; background: #e7f3ff; border-radius: 12px; border: 2px solid #2196F3;">
          <h2 style="margin: 0 0 15px 0; font-size: 24px; color: #2196F3; display: flex; align-items: center; gap: 10px;">
            <i class="bx bx-phone-call" style="font-size: 1.25rem;"></i>
            <span>Precisa de Ajuda?</span>
          </h2>
          <p style="margin: 0; color: #666; line-height: 1.8;">
            Consulte a documentação completa em: <code style="background: white; padding: 2px 8px; border-radius: 4px;">DOCUMENTACAO_SISTEMA_CONVOCACOES.md</code>
          </p>
        </section>
      </div>
    `;
  }

  // Variável global para o mapa do motorista
  let mapaMotorista = null;
  let mapaMotoristaLayer = null;

  /** Desenha rota por estradas (GeoJSON). Só desenha linha reta se opts.permitirLinhaReta === true (não usado no modal motorista). */
  function mapaMotoristaColocarCamadaRota(map, geometry, latM, lonM, latO, lonO, opts) {
    opts = opts || {};
    const permitirLinhaReta = opts.permitirLinhaReta === true;
    if (mapaMotoristaLayer) {
      try {
        map.removeLayer(mapaMotoristaLayer);
      } catch (e) {
        /* ignore */
      }
      mapaMotoristaLayer = null;
    }
    const okGeom =
      geometry &&
      geometry.type === 'LineString' &&
      geometry.coordinates &&
      geometry.coordinates.length >= 2;
    if (okGeom) {
      mapaMotoristaLayer = L.geoJSON(
        { type: 'Feature', properties: {}, geometry },
        { style: { color: '#667eea', weight: 5, opacity: 0.92, lineJoin: 'round' } }
      ).addTo(map);
    } else if (permitirLinhaReta) {
      mapaMotoristaLayer = L.polyline(
        [
          [latM, lonM],
          [latO, lonO],
        ],
        {
          color: '#667eea',
          weight: 5,
          opacity: 0.9,
          dashArray: '10 7',
          lineJoin: 'round',
        }
      ).addTo(map);
    }
    return mapaMotoristaLayer;
  }

  /** Leaflet em modal: redesenha tiles e ajusta zoom incluindo a polyline. */
  function mapaMotoristaInvalidarEAjustar(map, marcM, marcO) {
    if (!map) return;
    const refit = () => {
      try {
        map.invalidateSize(true);
      } catch (e) {
        /* ignore */
      }
      const parts = [marcM, marcO];
      if (mapaMotoristaLayer) parts.push(mapaMotoristaLayer);
      const fg = L.featureGroup(parts.filter(Boolean));
      try {
        const b = fg.getBounds();
        if (b && b.isValid()) {
          map.fitBounds(b.pad(0.1), {
            maxZoom: 15,
            padding: [28, 28],
            animate: false,
          });
        }
      } catch (e) {
        /* ignore */
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(refit));
    setTimeout(refit, 120);
    setTimeout(refit, 450);
    setTimeout(refit, 900);
    setTimeout(refit, 1600);
  }

  /** Painel flutuante (base esquerda): compara ETA da rota com DTPREVINICIO da viagem. */
  function atualizarPainelChegadaMapaMotorista(convocacao, { durationSec, origemOk }) {
    const floatRoot = document.getElementById('mapaMotoristaChegadaFloat');
    const timeEl = document.getElementById('mapaMotoristaChegadaAtualizado');
    const resumoEl = document.getElementById('mapaMotoristaChegadaResumo');
    const statusEl = document.getElementById('mapaMotoristaChegadaStatus');
    if (!floatRoot || !resumoEl) return;
    floatRoot.style.display = 'block';
    const agoraRelogio = new Date();
    if (timeEl) {
      timeEl.textContent = `Dados atualizados às ${String(agoraRelogio.getHours()).padStart(2, '0')}:${String(agoraRelogio.getMinutes()).padStart(2, '0')}:${String(agoraRelogio.getSeconds()).padStart(2, '0')}`;
    }
    floatRoot.classList.remove(
      'modal-mapa-motorista-chegada--ok',
      'modal-mapa-motorista-chegada--atraso',
      'modal-mapa-motorista-chegada--incerto',
      'modal-mapa-motorista-chegada--neutro'
    );

    const aplicarStatusVisual = (titulo, situacao) => {
      if (statusEl) {
        statusEl.textContent = titulo || '';
        statusEl.style.display = titulo ? 'block' : 'none';
      }
      if (situacao === 'ok') floatRoot.classList.add('modal-mapa-motorista-chegada--ok');
      else if (situacao === 'atraso') floatRoot.classList.add('modal-mapa-motorista-chegada--atraso');
      else if (situacao === 'incerto') floatRoot.classList.add('modal-mapa-motorista-chegada--incerto');
      else floatRoot.classList.add('modal-mapa-motorista-chegada--neutro');
    };

    const staleLimMin = 90;
    const ultimaDh =
      convocacao.ULTIMA_POSICAO_VIAGEM_DH ??
      convocacao.ultima_posicao_viagem_dh ??
      convocacao.DHMAINTENANCE_CONVOCACAO ??
      convocacao.dhmaintenance_convocacao;
    let posicaoDesatualizada = true;
    if (ultimaDh) {
      const t = new Date(ultimaDh).getTime();
      if (!Number.isNaN(t)) posicaoDesatualizada = (Date.now() - t) / 60000 > staleLimMin;
    }

    const dtPrev = convocacao.DTPREVINICIO ?? convocacao.dtprevinicio;
    const agoraMs = Date.now();
    let resumo = '';

    if (!origemOk) {
      resumo = 'Sem origem do roteiro no mapa. Não é possível estimar se o motorista chega a tempo para o carregamento.';
      aplicarStatusVisual('Não é possível estimar', 'neutro');
    } else if (!dtPrev) {
      resumo = 'Sem data/hora de início da viagem (carregamento) cadastrada. Cadastre a previsão na viagem para comparar com o tempo de rota.';
      aplicarStatusVisual('Sem previsão de carregamento na viagem', 'neutro');
    } else if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
      resumo = 'Tempo de percurso até a origem indisponível. Use a distância exibida acima como referência.';
      aplicarStatusVisual('Tempo de rota indisponível', 'neutro');
    } else {
      const chegada = new Date(agoraMs + durationSec * 1000);
      const limite = new Date(dtPrev);
      const chegadaStr = fmtDataHora(chegada);
      const limiteStr = fmtDataHora(limite);
      const agoraStr = fmtDataHora(new Date(agoraMs));
      let prefix = '';
      if (posicaoDesatualizada) {
        prefix = `Posição pode estar desatualizada (último sinal há mais de ${staleLimMin} min ou sem data). `;
      }
      if (Number.isNaN(limite.getTime())) {
        resumo = prefix + 'Previsão de carregamento em formato não reconhecido.';
        aplicarStatusVisual('Data de carregamento inválida', 'neutro');
      } else if (limite.getTime() < agoraMs) {
        resumo =
          prefix +
          `A data/hora de carregamento prevista (${limiteStr}) já foi ultrapassada (referência: agora ${agoraStr}). ` +
          `Com a posição atual, chegada estimada na origem: ${chegadaStr}. Indicativo: atraso em relação ao agendamento.`;
        aplicarStatusVisual('Atraso: previsão de carregamento já ultrapassada', 'atraso');
      } else if (chegada.getTime() <= limite.getTime()) {
        if (posicaoDesatualizada) {
          resumo =
            prefix +
            `Chegada estimada ${chegadaStr} · Carregamento previsto ${limiteStr} · A rota sugere tempo para chegar antes do limite, mas o sinal de posição está antigo: trate como estimativa incerta.`;
          aplicarStatusVisual('Prazo provável (estimativa incerta)', 'incerto');
        } else {
          resumo =
            prefix + `Chegada estimada ${chegadaStr} · Carregamento previsto ${limiteStr} · Indicativo: dentro do prazo para chegar a tempo do carregamento.`;
          aplicarStatusVisual('No prazo (estimativa)', 'ok');
        }
      } else {
        resumo =
          prefix + `Chegada estimada ${chegadaStr} · Carregamento previsto ${limiteStr} · Indicativo: atraso provável para o carregamento.`;
        aplicarStatusVisual('Atraso provável', 'atraso');
      }
    }
    resumoEl.textContent = resumo;
  }

  // Função para abrir modal com mapa do motorista
  window.abrirMapaMotorista = async function(idConvocacao, latMotorista, lonMotorista, idRoteiro, idViagem) {
    try {
      const chFloat = document.getElementById('mapaMotoristaChegadaFloat');
      if (chFloat) chFloat.style.display = 'none';

      let convocacao = convocacoes.find(c => c.IDCONVOCACAO === idConvocacao);
      if (!convocacao) {
        showMessage('Convocação não encontrada.', 'error');
        return;
      }

      const bannerTexto = document.getElementById('mapaBannerUltimaPosicaoTexto');
      if (bannerTexto) {
        bannerTexto.textContent = 'Carregando…';
        bannerTexto.classList.add('banner-sem-dados');
      }

      try {
        const respConv = await fetch(`/api/convocacoes/${idConvocacao}`, { headers: getAuthHeaders() });
        if (respConv.ok) {
          const fresh = await respConv.json();
          convocacao = { ...convocacao, ...fresh };
        }
      } catch (e) {
        console.warn('Não foi possível atualizar dados da convocação para o mapa:', e);
      }

      const aplicarTextoUltimaPosicao = () => {
        const ultimaViagemDh =
          convocacao.ULTIMA_POSICAO_VIAGEM_DH ??
          convocacao.ultima_posicao_viagem_dh ??
          convocacao.Ultima_Posicao_Viagem_Dh;
        const dhMaintConv =
          convocacao.DHMAINTENANCE_CONVOCACAO ??
          convocacao.dhmaintenance_convocacao ??
          convocacao.Dhmaintenance_Convocacao;
        let texto = '—';
        let temDados = false;
        if (ultimaViagemDh) {
          texto = fmtDataHora(ultimaViagemDh) + ' (rastreamento na viagem)';
          temDados = true;
        } else if (dhMaintConv) {
          texto = fmtDataHora(dhMaintConv) + ' (última atualização no link da convocação)';
          temDados = true;
        } else {
          texto = 'Sem registro de data/hora — ainda não há rastreamento na viagem nem atualização de posição pelo link.';
        }
        if (bannerTexto) {
          bannerTexto.textContent = texto;
          if (temDados) bannerTexto.classList.remove('banner-sem-dados');
          else bannerTexto.classList.add('banner-sem-dados');
        }
        if (ultimaViagemDh) return fmtDataHora(ultimaViagemDh);
        if (dhMaintConv) return fmtDataHora(dhMaintConv) + ' (link)';
        return '—';
      };
      const textoResumoUltimaPosicao = aplicarTextoUltimaPosicao();

      // Preencher informações no modal
      document.getElementById('mapaInfoMotorista').textContent = convocacao.NOME_MOTORISTA || '-';
      document.getElementById('mapaInfoCelular').textContent = convocacao.CELULAR_MOTORISTA || '-';
      document.getElementById('mapaInfoViagem').textContent = idViagem || '-';
      document.getElementById('mapaInfoRoteiro').textContent = convocacao.DSROTEIRO || '-';
      
      const formatarPeso = (peso) => {
        if (!peso) return '-';
        return `${parseFloat(peso).toFixed(3).replace('.', ',')} ton`;
      };
      
      // Buscar dados da viagem se não estiverem na convocação
      let vlFrete = convocacao.VLFRETE;
      let peso = convocacao.PESO;
      let cubagem = convocacao.CUBAGEM;
      let moedaFrete = convocacao.MOEDA || 'BRL';
      
      // Se não tiver na convocação, buscar da viagem
      if (!vlFrete && idViagem) {
        try {
          const viagemResponse = await fetchApiViagens(`/${idViagem}`);
          if (viagemResponse.ok) {
            const viagem = await viagemResponse.json();
            vlFrete = viagem.VLFRETE || vlFrete;
            peso = viagem.PESO || peso;
            cubagem = viagem.CUBAGEM || cubagem;
            if (viagem.MOEDA) moedaFrete = viagem.MOEDA;
          }
        } catch (err) {
          console.error('Erro ao buscar dados da viagem:', err);
        }
      }

      document.getElementById('mapaInfoDistancia').textContent = 'Calculando...';

      // Abrir modal
      const modal = document.getElementById('modalMapaMotorista');
      modal.style.display = 'block';

      // Buscar pontos do roteiro para pegar a origem
      let origemLat = null;
      let origemLon = null;
      let origemNome = 'Origem';

      try {
        const pontosResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
        if (pontosResponse.ok) {
          const pontos = await pontosResponse.json();
          // Buscar ponto de origem (ORDEM = 1 ou TPLOCAL = 'O')
          const pontoOrigem = pontos.find(p => p.ORDEM === 1 || p.TPLOCAL === 'O');
          if (pontoOrigem && pontoOrigem.LATITUDE && pontoOrigem.LONGITUDE) {
            origemLat = parseFloat(pontoOrigem.LATITUDE);
            origemLon = parseFloat(pontoOrigem.LONGITUDE);
            origemNome = pontoOrigem.DSLOCAL || 'Origem';
          }
        }
      } catch (err) {
        console.error('Erro ao buscar pontos do roteiro:', err);
      }

      // Carregar Leaflet
      await carregarLeaflet();

      // Aguardar um pouco para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verificar se o elemento do mapa existe e está visível
      const mapaDiv = document.getElementById('mapaMotorista');
      if (!mapaDiv) {
        console.error('Elemento mapaMotorista não encontrado');
        return;
      }

      // Limpar mapa anterior se existir
      if (mapaMotorista) {
        try {
          mapaMotorista.remove();
        } catch (e) {
          console.warn('Erro ao remover mapa anterior:', e);
        }
        mapaMotorista = null;
        mapaMotoristaLayer = null;
      }

      // Limpar conteúdo do elemento
      mapaDiv.innerHTML = '';

      // Aguardar um pouco para garantir que o elemento está pronto
      await new Promise(resolve => setTimeout(resolve, 100));

      // Criar mapa
      mapaMotorista = L.map('mapaMotorista').setView([latMotorista, lonMotorista], 8);
      
      // Aguardar o mapa inicializar
      await new Promise(resolve => setTimeout(resolve, 200));

      // Adicionar tile layer  
      const tileConfig = window.getTileLayerConfig ? window.getTileLayerConfig() : {
        url: window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      
      const tileOptions = {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileConfig.url.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileConfig.url, tileOptions).addTo(mapaMotorista);

      mapaMotorista.whenReady(() => {
        requestAnimationFrame(() => {
          try {
            mapaMotorista.invalidateSize(true);
          } catch (e) {
            /* ignore */
          }
        });
      });

      // Criar ícones personalizados
      const iconeMotorista = L.divIcon({
        className: 'custom-marker-motorista',
        html: '<div style="background: #e74c3c; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">🚛</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const iconeOrigem = L.divIcon({
        className: 'custom-marker-origem',
        html: '<div style="background: #2ecc71; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      // Adicionar marcador do motorista
      const marcadorMotorista = L.marker([latMotorista, lonMotorista], { icon: iconeMotorista })
        .addTo(mapaMotorista)
        .bindPopup(`
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; color: #e74c3c;">🚛 Motorista</h3>
            <p style="margin: 5px 0;"><strong>Nome:</strong> ${convocacao.NOME_MOTORISTA || '-'}</p>
            <p style="margin: 5px 0;"><strong>Celular:</strong> ${convocacao.CELULAR_MOTORISTA || '-'}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> ${convocacao.STATUS || '-'}</p>
            <p style="margin: 5px 0;"><strong>Referência de posição:</strong> ${textoResumoUltimaPosicao}</p>
            <hr style="margin: 10px 0;">
            <h4 style="margin: 10px 0 5px 0; color: #667eea;">📦 Carga</h4>
            <p style="margin: 5px 0;"><strong>ID Viagem:</strong> ${idViagem || '-'}</p>
            <p style="margin: 5px 0;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
            <p style="margin: 5px 0;"><strong>Frete:</strong> ${typeof window.fmtMoeda === 'function' ? window.fmtMoeda(vlFrete) : vlFrete}</p>
            <p style="margin: 5px 0;"><strong>Peso:</strong> ${typeof window.fmtPeso === 'function' ? window.fmtPeso(peso) : peso}</p>
            <p style="margin: 5px 0;"><strong>Classe:</strong> ${convocacao.DSCLASSEFROTA || '-'}</p>
          </div>
        `);

      // Adicionar marcador da origem se tiver coordenadas
      let marcadorOrigem = null;
      if (origemLat && origemLon) {
        marcadorOrigem = L.marker([origemLat, origemLon], { icon: iconeOrigem })
          .addTo(mapaMotorista)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 10px 0; color: #2ecc71;">📍 Local de Carregamento</h3>
              <p style="margin: 5px 0;"><strong>Local:</strong> ${origemNome}</p>
              <p style="margin: 5px 0;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
            </div>
          `);

        // Rota por estradas: vários servidores (map-config.js); sem linha reta no mapa se falhar
        const haversineKm = calcularDistanciaHaversine(latMotorista, lonMotorista, origemLat, origemLon);
        const distEl = document.getElementById('mapaInfoDistancia');
        if (distEl) {
          distEl.textContent = `${haversineKm.toFixed(2)} km (calculando rota por estradas…)`;
        }

        try {
          const resultado =
            typeof window.buscarRotaMotoristaParaOrigem === 'function'
              ? await window.buscarRotaMotoristaParaOrigem(lonMotorista, latMotorista, origemLon, origemLat)
              : { ok: false };

          if (resultado.ok && resultado.route) {
            const route = resultado.route;
            const distanciaKm = (route.distance / 1000).toFixed(2);
            const duracaoMin = Math.round(route.duration / 60);
            if (distEl) distEl.textContent = `${distanciaKm} km (aprox. ${duracaoMin} min)`;

            mapaMotoristaColocarCamadaRota(mapaMotorista, route.geometry, latMotorista, lonMotorista, origemLat, origemLon, {
              permitirLinhaReta: false,
            });
            mapaMotoristaInvalidarEAjustar(mapaMotorista, marcadorMotorista, marcadorOrigem);
            atualizarPainelChegadaMapaMotorista(convocacao, { durationSec: route.duration, origemOk: true });
          } else {
            if (distEl) {
              distEl.textContent = `${haversineKm.toFixed(2)} km (rota por estradas indisponível — verifique o servidor em Configurações » Mapa)`;
            }
            mapaMotoristaColocarCamadaRota(mapaMotorista, null, latMotorista, lonMotorista, origemLat, origemLon, {
              permitirLinhaReta: true,
            });
            mapaMotoristaInvalidarEAjustar(mapaMotorista, marcadorMotorista, marcadorOrigem);
            const durEst = (haversineKm / 50) * 3600;
            atualizarPainelChegadaMapaMotorista(convocacao, { durationSec: durEst, origemOk: true });
          }
        } catch (err) {
          console.error('[ROTA-OSRM] Modal motorista — erro ao calcular rota:', err);
          if (distEl) {
            distEl.textContent = `${haversineKm.toFixed(2)} km (erro ao obter rota — verifique rede/servidor)`;
          }
          mapaMotoristaColocarCamadaRota(mapaMotorista, null, latMotorista, lonMotorista, origemLat, origemLon, {
            permitirLinhaReta: true,
          });
          mapaMotoristaInvalidarEAjustar(mapaMotorista, marcadorMotorista, marcadorOrigem);
          const durEst = (haversineKm / 50) * 3600;
          atualizarPainelChegadaMapaMotorista(convocacao, { durationSec: durEst, origemOk: true });
        }
      } else {
        mapaMotorista.setView([latMotorista, lonMotorista], 12);
        document.getElementById('mapaInfoDistancia').textContent = 'Origem não encontrada no roteiro';
        atualizarPainelChegadaMapaMotorista(convocacao, { durationSec: null, origemOk: false });
        setTimeout(() => {
          try {
            mapaMotorista.invalidateSize(true);
          } catch (e) {
            /* ignore */
          }
        }, 200);
      }

      marcadorMotorista.openPopup();
      if (mapaMotorista) {
        setTimeout(() => {
          try {
            mapaMotorista.invalidateSize(true);
          } catch (e) {
            /* ignore */
          }
        }, 300);
      }

    } catch (err) {
      console.error('Erro ao abrir mapa do motorista:', err);
      showMessage('Erro ao carregar mapa. ' + err.message, 'error');
    }
  };

  // Função para fechar modal do mapa
  window.fecharModalMapaMotorista = function() {
    const modal = document.getElementById('modalMapaMotorista');
    modal.style.display = 'none';
    const chFloat = document.getElementById('mapaMotoristaChegadaFloat');
    if (chFloat) chFloat.style.display = 'none';
    
    // Limpar mapa
    if (mapaMotorista) {
      mapaMotorista.remove();
      mapaMotorista = null;
      mapaMotoristaLayer = null;
    }
  };

  // Função auxiliar para calcular distância Haversine
  function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Fechar modal ao clicar fora
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modalMapaMotorista');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          fecharModalMapaMotorista();
        }
      });
    }
  });

  // ============================================================================
  // FUNÇÕES PARA ABA VEÍCULO
  // ============================================================================

  // Carregar tipos de equipamento no select
  async function carregarTiposEquipamento() {
    const select = document.getElementById('veiculoTpEquipamento');
    if (!select) return;

    // Se já foi carregado, não carregar novamente
    if (select.options.length > 1) return;

    try {
      // Tentar primeiro a rota /api/equipamentos/tipos-combo, depois /api/tipos-combo
      let response = await fetch('/api/equipamentos/tipos-combo');
      if (!response.ok) {
        // Fallback para rota alternativa
        response = await fetch('/api/tipos-combo');
      }
      
      if (response.ok) {
        const tipos = await response.json();
        if (!tipos || !Array.isArray(tipos)) {
          console.error('Resposta inválida ao carregar tipos de equipamento:', tipos);
          return;
        }
        
        // Limpar opções exceto a primeira (Selecione...)
        select.innerHTML = '<option value="">Selecione...</option>';
        
        // Adicionar tipos no formato: "Código - Descrição"
        tipos.forEach(tipo => {
          const option = document.createElement('option');
          option.value = tipo.CDTIPOEQUIPAMENTO || tipo.codigo || tipo.value;
          option.textContent = `${String(tipo.CDTIPOEQUIPAMENTO || tipo.codigo || tipo.value).padStart(2, '0')} - ${tipo.DSTIPOEQUIPAMENTO || tipo.descricao || tipo.label}`;
          select.appendChild(option);
        });
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('Erro ao carregar tipos de equipamento:', response.status, error);
      }
    } catch (err) {
      console.error('Erro ao carregar tipos de equipamento:', err);
    }
  }

  // Buscar equipamento por placa
  // Função auxiliar: Debounce para evitar múltiplas chamadas
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Versão com loading state
  const buscarEquipamentoPorPlacaComLoading = async () => {
    const btn = document.getElementById('btnBuscarVeiculoPorPlaca');
    const loadingText = 'Buscando...';
    const originalText = btn?.textContent || 'Buscar';
    
    if (btn) {
      btn.disabled = true;
      btn.textContent = loadingText;
    }
    
    try {
      await buscarEquipamentoPorPlaca();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  };

  async function buscarEquipamentoPorPlaca() {
    const placa = document.getElementById('veiculoRefEquipamento')?.value.trim();
    if (!placa) {
      showMessage('Informe a placa do equipamento.', 'error');
      return;
    }

    // Garantir que o ID da viagem está definido se disponível
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
    if (idViagem) {
      document.getElementById('veiculoIdViagem').value = idViagem;
    }

    try {
      const response = await fetchApiViagens(`/equipamentos/buscar?placa=${encodeURIComponent(placa)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar equipamento.' }));
        showMessage(error.error || 'Equipamento não encontrado.', 'error');
        return;
      }

      const equipamento = await response.json();
      const idEq = equipamento && (equipamento.IDEQUIPAMENTO ?? equipamento.idequipamento);
      if (!equipamento || !idEq) {
        showMessage('Equipamento não encontrado ou dados inválidos.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
      if (idViagem) {
        document.getElementById('veiculoIdViagem').value = idViagem;
      }

      preencherDadosEquipamento(equipamento);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      showMessage('Erro ao buscar equipamento: ' + err.message, 'error');
    }
  }

  // Buscar equipamento por código
  async function buscarEquipamentoPorCodigo() {
    const codigo = document.getElementById('veiculoIdEquipamento')?.value.trim();
    if (!codigo) {
      // Não mostrar erro se o campo estiver vazio - pode ser que o usuário ainda não preencheu
      return;
    }

    // Validar se é um número válido
    const codigoNum = parseFloat(codigo);
    if (isNaN(codigoNum) || codigoNum <= 0) {
      showMessage('Código do equipamento inválido.', 'error');
      return;
    }

    try {
      const response = await fetchApiViagens(`/equipamentos/buscar?codigo=${encodeURIComponent(codigoNum)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar equipamento.' }));
        if (response.status === 404) {
          showMessage('Equipamento não encontrado.', 'error');
        } else {
          showMessage(error.error || 'Erro ao buscar equipamento.', 'error');
        }
        return;
      }

      const equipamento = await response.json();
      const idEq = equipamento && (equipamento.IDEQUIPAMENTO ?? equipamento.idequipamento);
      if (!equipamento || !idEq) {
        showMessage('Equipamento não encontrado ou dados inválidos.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
      if (idViagem) {
        document.getElementById('veiculoIdViagem').value = idViagem;
      }

      preencherDadosEquipamento(equipamento);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      showMessage('Erro ao buscar equipamento.', 'error');
    }
  }

  // Mapear tipos de carroceria
  const TIPO_CARROCERIA = {
    '01': '01 - Baú',
    '02': '02 - Frigorífico',
    '03': '03 - Tanque',
    '04': '04 - Basculante (caçamba)',
    '05': '05 - Prancha',
    '06': '06 - Cegonha',
    '07': '07 - Silo/Basculante',
    '08': '08 - Transporte de toras',
    '09': '09 - Contêiner/carroc. aberta',
    '10': '10 - Não Aplicável',
    '11': '11 - Sider'
  };

  // Mapear tipos de atuação
  const TIPO_ATUACAO = {
    'A': 'A - Agregado',
    'F': 'F - Frota Própria',
    'P': 'P - Parceiro (Terceiro Fiel)',
    'T': 'T - Terceiro'
  };

  // Formatar número decimal
  function formatarDecimal(valor, casasDecimais = 2) {
    if (valor === null || valor === undefined || valor === '') return '';
    const num = parseFloat(valor);
    if (isNaN(num)) return '';
    return num.toFixed(casasDecimais).replace('.', ',');
  }

  // Helper: obter valor de objeto sem depender de maiúsculas/minúsculas (ex.: resposta PostgreSQL)
  function getVal(obj, key) {
    if (!obj || typeof obj !== 'object') return '';
    const v = obj[key];
    if (v !== undefined && v !== null) return v;
    const lowerKey = key.toLowerCase();
    const found = Object.keys(obj).find(k => k.toLowerCase() === lowerKey);
    return found !== undefined ? obj[found] : '';
  }

  // Preencher dados do equipamento (aceita chaves em maiúsculas ou minúsculas)
  function preencherDadosEquipamento(equipamento) {
    const g = (key) => getVal(equipamento, key);
    // Campos de busca
    document.getElementById('veiculoIdEquipamento').value = g('IDEQUIPAMENTO') || '';
    document.getElementById('veiculoRefEquipamento').value = g('REFEQUIPAMENTO') || '';
    
    // Dados completos - Linha 1
    document.getElementById('veiculoIdEquipamentoDisplay').value = g('IDEQUIPAMENTO') || '';
    document.getElementById('veiculoRefEquipamentoDisplay').value = g('REFEQUIPAMENTO') || '';
    document.getElementById('veiculoDescricao').value = g('DSEQUIPAMENTO') || '';
    const fgActive = g('FGACTIVE');
    document.getElementById('veiculoSituacao').value = (fgActive === 'A' || fgActive === 'S') ? 'Ativo' : 'Inativo';
    
    // Linha 2
    document.getElementById('veiculoClasseFrota').value = g('CLASSE_NOME') || 'Não informado';
    document.getElementById('veiculoTipo').value = g('TIPO_NOME') || 'Não informado';
    document.getElementById('veiculoTipoCarroceria').value = TIPO_CARROCERIA[g('FGTIPOCARROCERIA')] || g('FGTIPOCARROCERIA') || 'Não informado';
    document.getElementById('veiculoTipoAtuacao').value = TIPO_ATUACAO[g('FGTIPOATUACAO')] || g('FGTIPOATUACAO') || 'Não informado';
    
    // Linha 3
    document.getElementById('veiculoGrupo').value = g('GRUPO_NOME') || 'Não informado';
    document.getElementById('veiculoMarca').value = g('MARCA_NOME') || 'Não informado';
    document.getElementById('veiculoModelo').value = g('MODELO_NOME') || 'Não informado';
    document.getElementById('veiculoAnoFabricacao').value = g('ANOFABRICA') || 'Não informado';
    
    // Linha 4
    document.getElementById('veiculoCapacidade').value = g('CAPACIDCARGA') ? formatarDecimal(g('CAPACIDCARGA'), 2) : 'Não informado';
    document.getElementById('veiculoAltura').value = g('ALTURA') ? formatarDecimal(g('ALTURA'), 2) : 'Não informado';
    document.getElementById('veiculoLargura').value = g('LARGURA') ? formatarDecimal(g('LARGURA'), 2) : 'Não informado';
    document.getElementById('veiculoComprimento').value = g('COMPRIMENTO') ? formatarDecimal(g('COMPRIMENTO'), 2) : 'Não informado';
    
    // Linha 5
    document.getElementById('veiculoCubico').value = g('MTCUBICO') ? formatarDecimal(g('MTCUBICO'), 2) : 'Não informado';
    document.getElementById('veiculoEixos').value = g('NREIXOS') || 'Não informado';
    document.getElementById('veiculoRastreado').value = g('FGRASTREADO') === 'S' ? 'Sim' : g('FGRASTREADO') === 'N' ? 'Não' : 'Não informado';
    
    if (g('CDTIPOEQUIPAMENTO')) {
      document.getElementById('veiculoTpEquipamento').value = g('CDTIPOEQUIPAMENTO');
    } else if (!document.getElementById('veiculoTpEquipamento').value && g('TPEQUIPAMENTO')) {
      document.getElementById('veiculoTpEquipamento').value = g('TPEQUIPAMENTO');
    }

    document.getElementById('veiculoDadosCompletos').style.display = 'block';
    document.getElementById('veiculoSemDados').style.display = 'none';
    showMessage('Equipamento encontrado!', 'success');
  }

  // Salvar veículo na viagem
  async function salvarVeiculo(e) {
    e.preventDefault();
    const idViagem = document.getElementById('veiculoIdViagem')?.value;
    const idequipamento = document.getElementById('veiculoIdEquipamento')?.value;
    const refequipamento = document.getElementById('veiculoRefEquipamento')?.value.trim();
    const tpequipamento = document.getElementById('veiculoTpEquipamento')?.value.trim();

    if (!idViagem) {
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    if (!idequipamento || !refequipamento || !tpequipamento) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    // Converter código numérico do tipo de equipamento para formato de 2 caracteres
    // O backend espera TPEQUIPAMENTO como Char(2), então formatamos o código
    const tpequipamentoFormatado = String(tpequipamento).padStart(2, '0').substring(0, 2).toUpperCase();

    try {
      const response = await fetchApiViagens(`/${idViagem}/veiculo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idequipamento: parseFloat(idequipamento),
          refequipamento: refequipamento.toUpperCase(),
          tpequipamento: tpequipamentoFormatado
        })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Veículo salvo com sucesso!', 'success');
        // Limpar formulário após salvar (guardar idViagem antes, pois limparFormularioVeiculo zera o campo)
        const idViagemParaRefresh = idViagem;
        limparFormularioVeiculo();
        // Recarregar lista de veículos (carregarVeiculoViagem restaura o id no campo)
        if (idViagemParaRefresh) {
          await carregarVeiculoViagem(idViagemParaRefresh);
        }
      } else {
        if (response.status === 401) {
          showMessage('Sessão expirada ou não autorizado. Faça login novamente.', 'error');
        } else {
          showMessage(result.error || 'Erro ao salvar veículo.', 'error');
        }
      }
    } catch (err) {
      console.error('Erro ao salvar veículo:', err);
      showMessage('Erro ao salvar veículo.', 'error');
    }
  }

  // Limpar formulário de veículo completamente
  function limparFormularioVeiculo() {
    // Limpar campos de busca
    document.getElementById('veiculoIdEquipamento').value = '';
    document.getElementById('veiculoRefEquipamento').value = '';
    document.getElementById('veiculoTpEquipamento').value = '';
    
    // Limpar campos de exibição
    const camposDisplay = [
      'veiculoIdEquipamentoDisplay',
      'veiculoRefEquipamentoDisplay',
      'veiculoDescricao',
      'veiculoSituacao',
      'veiculoClasseFrota',
      'veiculoTipo',
      'veiculoTipoCarroceria',
      'veiculoTipoAtuacao',
      'veiculoGrupo',
      'veiculoMarca',
      'veiculoModelo',
      'veiculoAnoFabricacao',
      'veiculoCapacidade',
      'veiculoAltura',
      'veiculoLargura',
      'veiculoComprimento',
      'veiculoCubico',
      'veiculoEixos',
      'veiculoRastreado'
    ];
    
    camposDisplay.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    
    // Ocultar seções
    document.getElementById('veiculoDadosCompletos').style.display = 'none';
    document.getElementById('veiculoSemDados').style.display = 'none';
    document.getElementById('veiculoIdViagem').value = '';
  }

  // Carregar lista de veículos da viagem
  async function carregarVeiculoViagem(idViagem) {
    if (!idViagem) {
      limparFormularioVeiculo();
      limparListaVeiculos();
      return;
    }

    limparFormularioVeiculo();
    document.getElementById('veiculoIdViagem').value = idViagem;

    try {
      const response = await fetchApiViagens(`/${idViagem}/veiculo`).catch(() => null);
      if (!response) {
        limparListaVeiculos();
        return;
      }
      
      if (response.ok) {
        const veiculos = await response.json();
        // Agora retorna uma LISTA (array)
        if (Array.isArray(veiculos) && veiculos.length > 0) {
          exibirListaVeiculos(veiculos);
        } else {
          limparListaVeiculos();
        }
      } else if (response.status === 404) {
        // Nenhum veículo cadastrado - normal
        limparListaVeiculos();
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro ao carregar veículos.' }));
        console.error('Erro ao carregar veículos:', error);
        limparListaVeiculos();
      }
    } catch (err) {
      if (err.message && !err.message.includes('404')) {
        console.error('Erro ao carregar veículos:', err);
      }
      limparListaVeiculos();
    }
  }

  // Exibir lista de veículos
  function exibirListaVeiculos(veiculos) {
    const listaContainer = document.getElementById('veiculoLista');
    const listaVazia = document.getElementById('veiculoListaVazia');
    
    if (!listaContainer || !listaVazia) return;

    listaVazia.style.display = 'none';
    listaContainer.innerHTML = '';

    veiculos.forEach(veiculo => {
      const card = document.createElement('div');
      card.style.cssText = 'padding: 15px; background: white; border: 1px solid #ddd; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
      
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      info.innerHTML = `
        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
          ${veiculo.REFEQUIPAMENTO || 'N/A'} - ${veiculo.DSEQUIPAMENTO || 'Sem descrição'}
        </div>
        <div style="font-size: 0.9em; color: #666;">
          ID: ${veiculo.IDEQUIPAMENTO} | Tipo: ${veiculo.TIPO_NOME || veiculo.TPEQUIPAMENTO || 'N/A'} | 
          ${veiculo.MARCA_NOME || ''} ${veiculo.MODELO_NOME || ''} ${veiculo.ANOFABRICA ? `(${veiculo.ANOFABRICA})` : ''}
        </div>
      `;
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 10px; margin-left: 15px;';
      
      const btnVerDados = document.createElement('button');
      btnVerDados.type = 'button';
      btnVerDados.className = 'btn btn-primary btn-sm';
      btnVerDados.style.cssText = 'white-space: nowrap;';
      btnVerDados.innerHTML = '<i class=\'bx bx-show\'></i> Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosVeiculo(veiculo);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn btn-info btn-sm';
      btnValidades.style.cssText = 'white-space: nowrap;';
      btnValidades.innerHTML = '<i class=\'bx bx-file-blank\'></i> Validades';
      btnValidades.onclick = () => mostrarValidadesVeiculo(veiculo.IDEQUIPAMENTO, veiculo.REFEQUIPAMENTO || veiculo.DSEQUIPAMENTO || 'Veículo');
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn btn-secondary btn-sm';
      btnRemover.style.cssText = 'white-space: nowrap; background: #e74c3c;';
      btnRemover.innerHTML = '<i class=\'bx bx-trash\'></i> Remover';
      btnRemover.onclick = () => removerVeiculoViagem(veiculo.IDVIAGEM, veiculo.IDEQUIPAMENTO);
      
      btnContainer.appendChild(btnVerDados);
      btnContainer.appendChild(btnValidades);
      btnContainer.appendChild(btnRemover);
      
      card.appendChild(info);
      card.appendChild(btnContainer);
      listaContainer.appendChild(card);
    });
  }

  // Limpar lista de veículos
  function limparListaVeiculos() {
    const listaContainer = document.getElementById('veiculoLista');
    const listaVazia = document.getElementById('veiculoListaVazia');
    
    if (listaContainer) listaContainer.innerHTML = '';
    if (listaVazia) listaVazia.style.display = 'block';
  }

  // Remover veículo da viagem
  async function removerVeiculoViagem(idViagem, idequipamento) {
    const confirmado = await showConfirmModal(
      '<i class="bx bx-trash"></i> Remover Veículo',
      'Tem certeza que deseja remover este veículo da viagem?'
    );
    if (!confirmado) return;

    try {
      const response = await fetchApiViagens(`/${idViagem}/veiculo/${idequipamento}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Veículo removido com sucesso!', 'success');
        // Recarregar lista
        await carregarVeiculoViagem(idViagem);
      } else {
        showMessage(result.error || 'Erro ao remover veículo.', 'error');
      }
    } catch (err) {
      console.error('Erro ao remover veículo:', err);
      showMessage('Erro ao remover veículo.', 'error');
    }
  }

  /** Força dark mode nos modais Dados Completos (veículo/motorista) — CSS do módulo às vezes não vence. */
  function aplicarDarkModeModalDadosCompletos(modal) {
    if (!modal) return;
    const isDark =
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.body.getAttribute('data-theme') === 'dark';
    if (!isDark) return;
    const content = modal.querySelector('.modal-content-tratamento');
    const body = modal.querySelector('.modal-body-tratamento');
    const footer = modal.querySelector('.modal-footer-tratamento');
    const header = modal.querySelector('.modal-header-tratamento');
    if (content) {
      content.style.setProperty('background', '#1e293b', 'important');
      content.style.setProperty('color', '#e2e8f0', 'important');
    }
    if (body) {
      body.style.setProperty('background', '#1e293b', 'important');
      body.style.setProperty('color', '#e2e8f0', 'important');
    }
    if (footer) {
      footer.style.setProperty('background', '#1e293b', 'important');
      footer.style.setProperty('border-top-color', '#334155', 'important');
    }
    if (header) {
      header.style.setProperty('border-bottom-color', '#334155', 'important');
      header.querySelectorAll('h3').forEach((h) => h.style.setProperty('color', '#f1f5f9', 'important'));
    }
    modal.querySelectorAll('.modal-dados-completos-nome').forEach((el) => {
      el.style.setProperty('color', '#f1f5f9', 'important');
      el.style.setProperty('border-bottom-color', '#334155', 'important');
    });
    modal.querySelectorAll('.modal-dados-completos-table tbody tr').forEach((tr) => {
      tr.style.setProperty('background', '#0f172a', 'important');
      tr.style.setProperty('border-bottom-color', '#334155', 'important');
    });
    modal.querySelectorAll('.modal-dados-completos-table td:first-child').forEach((td) => {
      td.style.setProperty('color', '#94a3b8', 'important');
      td.style.setProperty('background', 'transparent', 'important');
    });
    modal.querySelectorAll('.modal-dados-completos-table td:last-child').forEach((td) => {
      td.style.setProperty('color', '#e2e8f0', 'important');
      td.style.setProperty('background', 'transparent', 'important');
    });
  }

  // Mostrar dados completos do veículo em modal
  function mostrarDadosCompletosVeiculo(veiculo) {
    const modal = document.getElementById('modalDadosVeiculo');
    const conteudo = document.getElementById('modalVeiculoConteudo');
    const titulo = document.querySelector('#modalDadosVeiculo h3');
    
    if (!modal || !conteudo) return;
    
    // Formatar dados
    const formatarValor = (valor, sufixo = '') => {
      if (valor === null || valor === undefined || valor === '') return 'Não informado';
      return `${valor}${sufixo}`;
    };

    const formatarSimNao = (valor) => {
      if (valor === 'S' || valor === 's' || valor === true) return 'Sim';
      if (valor === 'N' || valor === 'n' || valor === false) return 'Não';
      return formatarValor(valor);
    };

    const formatarTipoAtuacao = (valor) => {
      const tipos = {
        'F': 'F - Frota Própria',
        'T': 'T - Terceirizado',
        'A': 'A - Agregado'
      };
      return tipos[valor] || formatarValor(valor);
    };

    // Nome em destaque (Referência - Descrição)
    const nomeVeiculo = `${veiculo.REFEQUIPAMENTO || 'N/A'} - ${veiculo.DSEQUIPAMENTO || 'Sem descrição'}`;

    conteudo.innerHTML = `
      <p class="modal-dados-completos-nome">${nomeVeiculo}</p>

      <table class="modal-dados-completos-table">
        <tbody>
          <tr>
            <td>ID do Equipamento</td>
            <td>${formatarValor(veiculo.IDEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Referência</td>
            <td>${formatarValor(veiculo.REFEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Descrição</td>
            <td>${formatarValor(veiculo.DSEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Situação</td>
            <td>${formatarValor(veiculo.FGACTIVE)}</td>
          </tr>
          <tr>
            <td>Tipo de Equipamento</td>
            <td>${formatarValor(veiculo.TIPO_NOME || veiculo.TPEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Classe de Frota</td>
            <td>${formatarValor(veiculo.CLASSE_NOME)}</td>
          </tr>
          <tr>
            <td>Grupo</td>
            <td>${formatarValor(veiculo.GRUPO_NOME)}</td>
          </tr>
          <tr>
            <td>Tipo de Carroceria</td>
            <td>${formatarValor(veiculo.FGTIPOCARROCERIA)}</td>
          </tr>
          <tr>
            <td>Tipo de Atuação</td>
            <td>${formatarTipoAtuacao(veiculo.FGTIPOATUACAO)}</td>
          </tr>
          <tr>
            <td>Marca</td>
            <td>${formatarValor(veiculo.MARCA_NOME)}</td>
          </tr>
          <tr>
            <td>Modelo</td>
            <td>${formatarValor(veiculo.MODELO_NOME)}</td>
          </tr>
          <tr>
            <td>Ano de Fabricação</td>
            <td>${formatarValor(veiculo.ANOFABRICA)}</td>
          </tr>
          <tr>
            <td>Eixos</td>
            <td>${formatarValor(veiculo.NREIXOS)}</td>
          </tr>
          <tr>
            <td>Capacidade de Carga</td>
            <td>${formatarValor(veiculo.CAPACIDCARGA, ' ton')}</td>
          </tr>
          <tr>
            <td>Altura</td>
            <td>${formatarValor(veiculo.ALTURA, ' m')}</td>
          </tr>
          <tr>
            <td>Largura</td>
            <td>${formatarValor(veiculo.LARGURA, ' m')}</td>
          </tr>
          <tr>
            <td>Comprimento</td>
            <td>${formatarValor(veiculo.COMPRIMENTO, ' m')}</td>
          </tr>
          <tr>
            <td>M³ Cúbico</td>
            <td>${formatarValor(veiculo.MTCUBICO)}</td>
          </tr>
          <tr>
            <td>Veículo Rastreado</td>
            <td>${formatarSimNao(veiculo.FGRASTREADO)}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Mostrar modal
    modal.style.display = 'flex';
    aplicarDarkModeModalDadosCompletos(modal);
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalDadosVeiculo h3');
      if (tituloModal) {
        tituloModal.innerHTML = '<i class=\'bx bx-truck\'></i> Dados Completos do Veículo';
      }
      aplicarDarkModeModalDadosCompletos(modal);
    }, 10);
    
    // Event listener para fechar
    const btnFechar = document.getElementById('btnFecharModalVeiculo');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }

    // Fechar ao clicar fora do modal
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    
    // Fechar com ESC
    const fecharComESC = (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', fecharComESC);
      }
    };
    document.addEventListener('keydown', fecharComESC);
  }

  // ============================================================================
  // FUNÇÕES PARA ABA MOTORISTA
  // ============================================================================

  // Buscar cadastro geral por CPF
  async function buscarMotoristaPorCpf() {
    const cpf = document.getElementById('motoristaCpf')?.value.replace(/[^\d]+/g, '');
    if (!cpf || cpf.length !== 11) {
      showMessage('Informe um CPF válido.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const response = await fetchApiViagens(`/cadastros-gerais/buscar?cpf=${encodeURIComponent(cpf)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
      if (!cadastro) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      preencherDadosMotorista(cadastro);
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
    }
  }

  // Buscar cadastro geral por nome
  async function buscarMotoristaPorNome() {
    const nome = document.getElementById('motoristaNome')?.value.trim();
    if (!nome || nome.length < 3) {
      showMessage('Informe pelo menos 3 caracteres do nome.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const response = await fetchApiViagens(`/cadastros-gerais/buscar?nome=${encodeURIComponent(nome)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      if (Array.isArray(cadastros) && cadastros.length > 1) {
        // Se houver múltiplos resultados, mostrar o primeiro
        showMessage(`Encontrados ${cadastros.length} cadastros. Exibindo o primeiro.`, 'info');
        // Garantir que o ID da viagem está definido antes de preencher
        const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
        if (idViagem) {
          document.getElementById('motoristaIdViagem').value = idViagem;
        }
        preencherDadosMotorista(cadastros[0]);
      } else {
        const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
        if (!cadastro) {
          showMessage('Cadastro não encontrado.', 'error');
          return;
        }
        // Garantir que o ID da viagem está definido antes de preencher
        const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
        if (idViagem) {
          document.getElementById('motoristaIdViagem').value = idViagem;
        }
        preencherDadosMotorista(cadastro);
      }
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
    }
  }

  // Buscar cadastro geral por código
  async function buscarMotoristaPorCodigo() {
    const codigoInput = document.getElementById('motoristaCodigo');
    if (!codigoInput) {
      showMessage('Campo de código não encontrado.', 'error');
      return;
    }
    
    // Pegar valor e converter para número (pode vir como string do input number)
    let codigo = codigoInput.value;
    if (codigo) {
      codigo = codigo.toString().trim();
    }
    
    if (!codigo) {
      showMessage('Informe o código do cadastro.', 'error');
      return;
    }

    // Validar se é um número válido
    const codigoNum = parseFloat(codigo);
    if (isNaN(codigoNum) || codigoNum <= 0) {
      showMessage('Código inválido. Informe um número válido.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const response = await fetchApiViagens(`/cadastros-gerais/buscar?codigo=${encodeURIComponent(codigoNum)}`);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
      if (!cadastro) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagemFinal = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
      if (idViagemFinal) {
        document.getElementById('motoristaIdViagem').value = idViagemFinal;
      }

      preencherDadosMotorista(cadastro);
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
    }
  }

  // Formatar CPF/CNPJ
  function formatarCPFCNPJ(cpfCnpj) {
    if (!cpfCnpj) return '';
    const value = String(cpfCnpj).replace(/\D/g, '');
    if (value.length === 0) return '';
    
    // CPF: 000.000.000-00 (11 dígitos)
    if (value.length <= 11) {
      if (value.length <= 3) return value;
      if (value.length <= 6) return value.replace(/(\d{3})(\d+)/, '$1.$2');
      if (value.length <= 9) return value.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
      return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } 
    // CNPJ: 00.000.000/0000-00 (14 dígitos)
    else {
      if (value.length <= 2) return value;
      if (value.length <= 5) return value.replace(/(\d{2})(\d+)/, '$1.$2');
      if (value.length <= 8) return value.replace(/(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
      if (value.length <= 12) return value.replace(/(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3/$4');
      return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
  }

  // Formatar celular
  function formatarCelular(celular) {
    if (!celular) return '';
    const value = String(celular).replace(/\D/g, '');
    if (value.length === 11) {
      return value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
    }
    return value;
  }

  // Formatar CEP
  function formatarCEP(cep) {
    if (!cep) return '';
    const value = String(cep).replace(/\D/g, '');
    if (value.length === 8) {
      return value.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
    return value;
  }

  // Mapear tipos
  const TIPO_PESSOA = {
    'F': 'Física',
    'J': 'Jurídica'
  };

  const TIPO_CADASTRO = {
    'O': 'Operador do Sistema',
    'M': 'Motorista',
    'A': 'Agente',
    'G': 'Grupo de Divulgação',
    'T': 'Transportador',
    'U': 'Unidade de Negócio'
  };

  // Helper: obter valor do cadastro sem depender de maiúsculas/minúsculas (PostgreSQL pode retornar minúsculas)
  function getCadastroVal(cadastro, key) {
    if (!cadastro || typeof cadastro !== 'object') return '';
    const v = cadastro[key];
    if (v !== undefined && v !== null) return v;
    const lowerKey = key.toLowerCase();
    const found = Object.keys(cadastro).find(k => k.toLowerCase() === lowerKey);
    return found !== undefined ? cadastro[found] : '';
  }

  // Preencher dados do motorista
  function preencherDadosMotorista(cadastro) {
    if (!cadastro) {
      console.error('Cadastro vazio ou inválido:', cadastro);
      showMessage('Erro: Dados do cadastro inválidos.', 'error');
      return;
    }

    // Usar CDCADASTROGERAL ou CDCADASTRO (compatibilidade + case-insensitive)
    const codigo = String(getCadastroVal(cadastro, 'CDCADASTROGERAL') || getCadastroVal(cadastro, 'CDCADASTRO') || '').trim();
    
    // Campos de busca
    const codigoEl = document.getElementById('motoristaCodigo');
    const cpfEl = document.getElementById('motoristaCpf');
    const nomeEl = document.getElementById('motoristaNome');
    
    if (codigoEl) codigoEl.value = codigo;
    if (cpfEl) cpfEl.value = formatarCPFCNPJ(getCadastroVal(cadastro, 'CGCCPF') || '');
    if (nomeEl) nomeEl.value = getCadastroVal(cadastro, 'RZSOCIAL') || getCadastroVal(cadastro, 'NMFANTASIA') || '';

    // Dados completos - proteger todos os acessos
    const codigoDisplayEl = document.getElementById('motoristaCodigoDisplay');
    if (codigoDisplayEl) codigoDisplayEl.value = codigo;
    
    const cpfCnpjEl = document.getElementById('motoristaCpfCnpj');
    if (cpfCnpjEl) cpfCnpjEl.value = formatarCPFCNPJ(getCadastroVal(cadastro, 'CGCCPF') || '');
    
    const razaoSocialEl = document.getElementById('motoristaRazaoSocial');
    if (razaoSocialEl) razaoSocialEl.value = getCadastroVal(cadastro, 'RZSOCIAL') || getCadastroVal(cadastro, 'NMFANTASIA') || '';
    
    // Transportador: Código - Nome
    const cdTransportador = getCadastroVal(cadastro, 'CDTRANSPORTADOR');
    const transportadorNome = getCadastroVal(cadastro, 'TRANSPORTADOR_NOME');
    const transportadorTexto = cdTransportador
      ? `${cdTransportador} - ${transportadorNome || 'Não informado'}`
      : 'Não informado';
    const transportadorEl = document.getElementById('motoristaTransportador');
    if (transportadorEl) transportadorEl.value = transportadorTexto;
    
    // Tipo Pessoa
    const fgFisicaJuridica = getCadastroVal(cadastro, 'FGFISICAJURIDICA');
    const tipoPessoa = TIPO_PESSOA[fgFisicaJuridica] || fgFisicaJuridica || 'Não informado';
    const tipoPessoaEl = document.getElementById('motoristaTipoPessoa');
    if (tipoPessoaEl) tipoPessoaEl.value = tipoPessoa;
    
    // Tipo Cadastro
    const fgTipoCadastro = getCadastroVal(cadastro, 'FGTIPOCADASTRO');
    const tipoCadastro = TIPO_CADASTRO[fgTipoCadastro] || fgTipoCadastro || 'Não informado';
    const tipoCadastroEl = document.getElementById('motoristaTipoCadastro');
    if (tipoCadastroEl) tipoCadastroEl.value = tipoCadastro;
    
    // Possui Veículo Rastreado
    const fgRastreado = getCadastroVal(cadastro, 'FGRASTREADO');
    const rastreado = fgRastreado === 'S' ? 'Sim' : fgRastreado === 'N' ? 'Não' : 'Não informado';
    const rastreadoEl = document.getElementById('motoristaRastreado');
    if (rastreadoEl) rastreadoEl.value = rastreado;
    
    // Situação
    const fgActive = getCadastroVal(cadastro, 'FGACTIVE');
    const situacao = fgActive === 'A' || fgActive === 'S' ? 'Ativo' : 'Inativo';
    const situacaoEl = document.getElementById('motoristaSituacao');
    if (situacaoEl) situacaoEl.value = situacao;
    
    // CEP
    const cepEl = document.getElementById('motoristaCEP');
    if (cepEl) cepEl.value = formatarCEP(getCadastroVal(cadastro, 'CEP') || '');
    
    // Endereço
    const enderecoEl = document.getElementById('motoristaEndereco');
    if (enderecoEl) enderecoEl.value = getCadastroVal(cadastro, 'ENDERECO') || '';
    const numeroEl = document.getElementById('motoristaNumero');
    if (numeroEl) numeroEl.value = getCadastroVal(cadastro, 'NRENDERECO') || '';
    const bairroEl = document.getElementById('motoristaBairro');
    if (bairroEl) bairroEl.value = getCadastroVal(cadastro, 'BAIRRO') || '';
    const complementoEl = document.getElementById('motoristaComplemento');
    if (complementoEl) complementoEl.value = getCadastroVal(cadastro, 'COMPLEND') || '';
    
    // Cidade / UF / Código Cidade
    const estado = getCadastroVal(cadastro, 'CIDADE_ESTADO') || '';
    const cidade = getCadastroVal(cadastro, 'CIDADE_NOME') || '';
    const codigoCidade = getCadastroVal(cadastro, 'CDCIDADE') || '';
    const ufEl = document.getElementById('motoristaUf');
    if (ufEl) ufEl.value = estado || 'Não informado';
    const cidadeEl = document.getElementById('motoristaCidade');
    if (cidadeEl) cidadeEl.value = cidade || 'Não informado';
    const codigoCidadeEl = document.getElementById('motoristaCodigoCidade');
    if (codigoCidadeEl) codigoCidadeEl.value = codigoCidade;
    
    // Latitude e Longitude
    const latVal = getCadastroVal(cadastro, 'LATITUDE');
    const lonVal = getCadastroVal(cadastro, 'LONGITUDE');
    const latEl = document.getElementById('motoristaLatitude');
    if (latEl) latEl.value = (latVal !== '' && latVal != null) ? Number(latVal).toFixed(6).replace('.', ',') : '';
    const lonEl = document.getElementById('motoristaLongitude');
    if (lonEl) lonEl.value = (lonVal !== '' && lonVal != null) ? Number(lonVal).toFixed(6).replace('.', ',') : '';
    
    // Email e Celular
    const emailEl = document.getElementById('motoristaEmail');
    if (emailEl) emailEl.value = getCadastroVal(cadastro, 'ENDEMAIL') || '';
    const celularEl = document.getElementById('motoristaCelular');
    if (celularEl) celularEl.value = formatarCelular(getCadastroVal(cadastro, 'NRCELULAR') || '');

    // Exibir dados completos
    const dadosCompletosEl = document.getElementById('motoristaDadosCompletos');
    const semDadosEl = document.getElementById('motoristaSemDados');
    
    if (dadosCompletosEl) {
      dadosCompletosEl.style.display = 'block';
    } else {
      console.error('Elemento motoristaDadosCompletos não encontrado!');
    }
    
    if (semDadosEl) {
      semDadosEl.style.display = 'none';
    }
    
    showMessage('Motorista encontrado!', 'success');
  }

  // Salvar motorista na viagem
  async function salvarMotorista(e) {
    e.preventDefault();
    const idViagem = document.getElementById('motoristaIdViagem')?.value;
    // Código pode estar no campo de busca ou no campo de exibição (após buscar por CPF/nome)
    let cdmotorista = document.getElementById('motoristaCodigo')?.value?.trim();
    if (!cdmotorista) cdmotorista = document.getElementById('motoristaCodigoDisplay')?.value?.trim();

    if (!idViagem) {
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    if (!cdmotorista) {
      showMessage('Informe o código do motorista. Busque o motorista por CPF, nome ou código antes de salvar.', 'error');
      return;
    }

    // Validar se são números válidos
    const idViagemNum = parseFloat(idViagem);
    const cdmotoristaNum = parseFloat(cdmotorista);
    
    if (isNaN(idViagemNum) || idViagemNum <= 0) {
      showMessage('ID da viagem inválido.', 'error');
      return;
    }
    
    if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
      showMessage('Código do motorista inválido.', 'error');
      return;
    }

    try {
      const response = await fetchApiViagens(`/${idViagemNum}/motorista`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cdmotorista: cdmotoristaNum
        })
      });

      const result = await response.json();

      if (response.ok) {
        showMessage(result.message || 'Motorista salvo com sucesso!', 'success');
        // Limpar formulário após salvar
        limparFormularioMotorista();
        // Recarregar lista de motoristas
        if (idViagemNum) {
          await carregarMotoristaViagem(idViagemNum);
        }
        // Atualizar situação da viagem no formulário "Editar Viagem" (backend alterou para Programada)
        const viagemIdForm = document.getElementById('viagemId')?.value || document.getElementById('viagemIdViagem')?.value;
        if (viagemIdForm && String(viagemIdForm).trim() === String(idViagemNum).trim()) {
          try {
            const resViagem = await fetchApiViagens(`/${idViagemNum}`);
            if (resViagem.ok) {
              const viagemAtualizada = await resViagem.json();
              const selSitViagem = document.getElementById('viagemSituacaoViagem');
              const selSit = document.getElementById('viagemSituacao');
              if (viagemAtualizada.FGSITVIAGEM && selSitViagem) {
                selSitViagem.value = String(viagemAtualizada.FGSITVIAGEM).trim();
                if (!selSitViagem.querySelector('option[value="' + selSitViagem.value + '"]')) {
                  const opt = document.createElement('option');
                  opt.value = selSitViagem.value;
                  opt.textContent = viagemAtualizada.DSSITUACAOVIAGEM || viagemAtualizada.FGSITVIAGEM || 'Programada';
                  selSitViagem.appendChild(opt);
                }
              }
              if (viagemAtualizada.CDSITUACAOVIAGEM != null && selSit) {
                selSit.value = String(viagemAtualizada.CDSITUACAOVIAGEM);
                if (!selSit.querySelector('option[value="' + selSit.value + '"]')) {
                  const opt = document.createElement('option');
                  opt.value = selSit.value;
                  opt.textContent = viagemAtualizada.DSSITUACAOVIAGEM || selSit.value;
                  selSit.appendChild(opt);
                }
              }
            }
          } catch (e) {
            console.warn('Erro ao atualizar situação no formulário:', e);
          }
        }
      } else {
        if (response.status === 401) {
          showMessage('Sessão expirada ou não autorizado. Faça login novamente.', 'error');
        } else {
          console.error('Erro ao salvar motorista:', result);
          showMessage(result.error || 'Erro ao salvar motorista.', 'error');
        }
      }
    } catch (err) {
      console.error('Erro ao salvar motorista:', err);
      showMessage('Erro ao salvar motorista: ' + err.message, 'error');
    }
  }

  // Limpar formulário de motorista completamente
  function limparFormularioMotorista() {
    // Limpar campos de busca
    document.getElementById('motoristaCodigo').value = '';
    document.getElementById('motoristaCpf').value = '';
    document.getElementById('motoristaNome').value = '';
    
    // Limpar campos de exibição
    const camposDisplay = [
      'motoristaCodigoDisplay',
      'motoristaCpfCnpj',
      'motoristaRazaoSocial',
      'motoristaTransportador',
      'motoristaTipoPessoa',
      'motoristaTipoCadastro',
      'motoristaRastreado',
      'motoristaSituacao',
      'motoristaCEP',
      'motoristaEndereco',
      'motoristaNumero',
      'motoristaBairro',
      'motoristaComplemento',
      'motoristaUf',
      'motoristaCidade',
      'motoristaCodigoCidade',
      'motoristaLatitude',
      'motoristaLongitude',
      'motoristaEmail',
      'motoristaCelular'
    ];
    
    camposDisplay.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    
    // Ocultar seções
    document.getElementById('motoristaDadosCompletos').style.display = 'none';
    document.getElementById('motoristaSemDados').style.display = 'none';
    document.getElementById('motoristaIdViagem').value = '';
  }

  // Carregar motorista da viagem
  // Carregar lista de motoristas da viagem
  async function carregarMotoristaViagem(idViagem) {
    if (!idViagem) {
      limparFormularioMotorista();
      limparListaMotoristas();
      return;
    }

    limparFormularioMotorista();
    document.getElementById('motoristaIdViagem').value = idViagem;

    try {
      const response = await fetchApiViagens(`/${idViagem}/motorista`).catch(() => null);
      if (!response) {
        limparListaMotoristas();
        return;
      }
      
      if (response.ok) {
        const motoristas = await response.json();
        // Agora retorna uma LISTA (array)
        if (Array.isArray(motoristas) && motoristas.length > 0) {
          exibirListaMotoristas(motoristas);
        } else {
          limparListaMotoristas();
        }
      } else if (response.status === 404) {
        // Nenhum motorista cadastrado - normal
        limparListaMotoristas();
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro ao carregar motoristas.' }));
        console.error('Erro ao carregar motoristas:', error);
        limparListaMotoristas();
      }
    } catch (err) {
      if (err.message && !err.message.includes('404')) {
        console.error('Erro ao carregar motoristas:', err);
      }
      limparListaMotoristas();
    }
  }

  // Exibir lista de motoristas
  function exibirListaMotoristas(motoristas) {
    const listaContainer = document.getElementById('motoristaLista');
    const listaVazia = document.getElementById('motoristaListaVazia');
    
    if (!listaContainer || !listaVazia) return;

    listaVazia.style.display = 'none';
    listaContainer.innerHTML = '';

    motoristas.forEach(motorista => {
      const card = document.createElement('div');
      card.style.cssText = 'padding: 15px; background: white; border: 1px solid #ddd; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
      
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      
      // Formatar CPF/CNPJ
      const cpfCnpj = motorista.CGCCPF || '';
      const cpfFormatado = cpfCnpj.length === 11 
        ? cpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cpfCnpj.length === 14
        ? cpfCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : cpfCnpj;
      
      info.innerHTML = `
        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
          ${motorista.RZSOCIAL || motorista.NMFANTASIA || 'N/A'}
        </div>
        <div style="font-size: 0.9em; color: #666;">
          Código: ${motorista.CDMOTORISTA || motorista.CDCADASTROGERAL || 'N/A'} | 
          CPF/CNPJ: ${cpfFormatado || 'N/A'} | 
          ${motorista.CIDADE_NOME ? `${motorista.CIDADE_NOME} - ${motorista.CIDADE_ESTADO || ''}` : ''}
        </div>
      `;
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 10px; margin-left: 15px;';
      
      // Botão WhatsApp (se tiver celular válido)
      const celular = motorista.NRCELULAR || '';
      const celularFormatado = celular.toString().replace(/\D/g, '');
      const temWhatsApp = celularFormatado.length >= 10;
      
      if (temWhatsApp) {
        const numWa = celularFormatado.length >= 12 ? celularFormatado : '55' + celularFormatado;
        const linkWhatsApp = `https://wa.me/${numWa}`;
        const btnWhatsApp = document.createElement('a');
        btnWhatsApp.href = linkWhatsApp;
        btnWhatsApp.target = '_blank';
        btnWhatsApp.className = 'btn btn-sm';
        btnWhatsApp.style.cssText = 'background: #25D366; color: white; white-space: nowrap; text-decoration: none;';
        btnWhatsApp.innerHTML = '<i class=\'bx bxl-whatsapp\'></i> WhatsApp';
        btnWhatsApp.title = `Abrir WhatsApp de ${celular}`;
        btnContainer.appendChild(btnWhatsApp);
      }
      
      const btnVerDados = document.createElement('button');
      btnVerDados.type = 'button';
      btnVerDados.className = 'btn btn-primary btn-sm';
      btnVerDados.style.cssText = 'white-space: nowrap;';
      btnVerDados.innerHTML = '<i class=\'bx bx-show\'></i> Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosMotorista(motorista);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn btn-info btn-sm';
      btnValidades.style.cssText = 'white-space: nowrap;';
      btnValidades.innerHTML = '<i class=\'bx bx-file-blank\'></i> Validades';
      const cdMotorista = motorista.CDMOTORISTA || motorista.CDCADASTROGERAL;
      const nomeMotorista = motorista.RZSOCIAL || motorista.NMFANTASIA || 'Motorista';
      btnValidades.onclick = () => mostrarValidadesMotorista(cdMotorista, nomeMotorista);
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn btn-secondary btn-sm';
      btnRemover.style.cssText = 'white-space: nowrap; background: #e74c3c;';
      btnRemover.innerHTML = '<i class=\'bx bx-trash\'></i> Remover';
      btnRemover.onclick = () => removerMotoristaViagem(motorista.IDVIAGEM, cdMotorista);
      
      btnContainer.appendChild(btnVerDados);
      btnContainer.appendChild(btnValidades);
      btnContainer.appendChild(btnRemover);
      
      card.appendChild(info);
      card.appendChild(btnContainer);
      listaContainer.appendChild(card);
    });
  }

  // Limpar lista de motoristas
  function limparListaMotoristas() {
    const listaContainer = document.getElementById('motoristaLista');
    const listaVazia = document.getElementById('motoristaListaVazia');
    
    if (listaContainer) listaContainer.innerHTML = '';
    if (listaVazia) listaVazia.style.display = 'block';
  }

  // Remover motorista da viagem
  async function removerMotoristaViagem(idViagem, cdmotorista) {
    const confirmado = await showConfirmModal(
      '<i class="bx bx-trash"></i> Remover Motorista',
      'Tem certeza que deseja remover este motorista da viagem?'
    );
    if (!confirmado) return;

    try {
      const response = await fetchApiViagens(`/${idViagem}/motorista/${cdmotorista}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Motorista removido com sucesso!', 'success');
        // Recarregar lista
        await carregarMotoristaViagem(idViagem);
      } else {
        showMessage(result.error || 'Erro ao remover motorista.', 'error');
      }
    } catch (err) {
      console.error('Erro ao remover motorista:', err);
      showMessage('Erro ao remover motorista.', 'error');
    }
  }

  // Mostrar dados completos do motorista em modal
  function mostrarDadosCompletosMotorista(motorista) {
    const modal = document.getElementById('modalDadosMotorista');
    const conteudo = document.getElementById('modalMotoristaConteudo');
    
    if (!modal || !conteudo) return;

    // Formatar dados
    const formatarValor = (valor, sufixo = '') => {
      if (valor === null || valor === undefined || valor === '') return 'Não informado';
      return `${valor}${sufixo}`;
    };

    const formatarSimNao = (valor) => {
      if (valor === 'S' || valor === 's' || valor === true) return 'Sim';
      if (valor === 'N' || valor === 'n' || valor === false) return 'Não';
      return formatarValor(valor);
    };

    const formatarTipoPessoa = (valor) => {
      if (valor === 'F' || valor === 'f') return 'Física';
      if (valor === 'J' || valor === 'j') return 'Jurídica';
      return formatarValor(valor);
    };

    // Formatar CPF/CNPJ
    const cpfCnpj = motorista.CGCCPF || '';
    const cpfFormatado = cpfCnpj.length === 11 
      ? cpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : cpfCnpj.length === 14
      ? cpfCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
      : cpfCnpj;

    // CEP sem formatação (como na imagem)
    const cep = motorista.CEP || '';
    const cepSemFormatacao = cep || 'Não informado';

    // Telefone sem formatação (como na imagem)
    const telefone = motorista.NRCELULAR || '';
    const telefoneSemFormatacao = telefone || 'Não informado';

    // Nome em maiúsculas (como na imagem)
    const nomeMotorista = (motorista.RZSOCIAL || motorista.NMFANTASIA || 'N/A').toUpperCase();

    conteudo.innerHTML = `
      <p class="modal-dados-completos-nome">${nomeMotorista}</p>

      <table class="modal-dados-completos-table">
        <tbody>
          <tr>
            <td>Código</td>
            <td>${formatarValor(motorista.CDMOTORISTA || motorista.CDCADASTROGERAL)}</td>
          </tr>
          <tr>
            <td>CPF/CNPJ</td>
            <td>${cpfFormatado || 'Não informado'}</td>
          </tr>
          <tr>
            <td>Tipo Pessoa</td>
            <td>${formatarTipoPessoa(motorista.FGFISICAJURIDICA)}</td>
          </tr>
          <tr>
            <td>Tipo Cadastro</td>
            <td>${formatarValor(motorista.FGTIPOCADASTRO)}</td>
          </tr>
          <tr>
            <td>Transportador</td>
            <td>${formatarValor(motorista.TRANSPORTADOR_NOME)}</td>
          </tr>
          <tr>
            <td>Situação</td>
            <td>${formatarValor(motorista.FGACTIVE)}</td>
          </tr>
          <tr>
            <td>Possui Veículo Rastreado</td>
            <td>${formatarSimNao(motorista.FGRASTREADO)}</td>
          </tr>
          <tr>
            <td>CEP</td>
            <td>${cepSemFormatacao}</td>
          </tr>
          <tr>
            <td>Endereço</td>
            <td>${formatarValor(motorista.ENDERECO)}</td>
          </tr>
          <tr>
            <td>Número</td>
            <td>${formatarValor(motorista.NRENDERECO)}</td>
          </tr>
          <tr>
            <td>Bairro</td>
            <td>${formatarValor(motorista.BAIRRO)}</td>
          </tr>
          <tr>
            <td>Complemento</td>
            <td>${formatarValor(motorista.COMPLEND)}</td>
          </tr>
          <tr>
            <td>Cidade</td>
            <td>${formatarValor(motorista.CIDADE_NOME)}</td>
          </tr>
          <tr>
            <td>Estado</td>
            <td>${formatarValor(motorista.CIDADE_ESTADO)}</td>
          </tr>
          <tr>
            <td>Email</td>
            <td>${formatarValor(motorista.ENDEMAIL)}</td>
          </tr>
          <tr>
            <td>Celular</td>
            <td>${telefoneSemFormatacao}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Mostrar modal
    modal.style.display = 'flex';
    aplicarDarkModeModalDadosCompletos(modal);
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalDadosMotorista h3');
      if (tituloModal) {
        tituloModal.innerHTML = '<i class=\'bx bx-user\'></i> Dados Completos do Motorista';
      }
      aplicarDarkModeModalDadosCompletos(modal);
    }, 10);
    
    // Event listener para fechar
    const btnFechar = document.getElementById('btnFecharModalMotorista');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }

    // Fechar ao clicar fora do modal
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    
    // Fechar com ESC
    const fecharComESC = (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', fecharComESC);
      }
    };
    document.addEventListener('keydown', fecharComESC);
  }

  // Função para registrar event listeners
  function registrarEventListeners() {
    // Botões de busca de veículo
    const btnBuscarVeiculoPorPlaca = document.getElementById('btnBuscarVeiculoPorPlaca');
    const btnBuscarVeiculoPorCodigo = document.getElementById('btnBuscarVeiculoPorCodigo');
    
    if (btnBuscarVeiculoPorPlaca) {
      // Remover listener anterior se existir
      btnBuscarVeiculoPorPlaca.replaceWith(btnBuscarVeiculoPorPlaca.cloneNode(true));
      document.getElementById('btnBuscarVeiculoPorPlaca').addEventListener('click', buscarEquipamentoPorPlacaComLoading);
      
      // Adicionar busca ao pressionar Enter no campo placa
      const inputPlaca = document.getElementById('veiculoRefEquipamento');
      if (inputPlaca) {
        inputPlaca.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarEquipamentoPorPlacaComLoading();
          }
        });
      }
    }
    
    if (btnBuscarVeiculoPorCodigo) {
      btnBuscarVeiculoPorCodigo.replaceWith(btnBuscarVeiculoPorCodigo.cloneNode(true));
      document.getElementById('btnBuscarVeiculoPorCodigo').addEventListener('click', buscarEquipamentoPorCodigo);
      
      // Adicionar debounce para busca por código (permite busca ao digitar Enter)
      const inputCodigo = document.getElementById('veiculoIdEquipamento');
      if (inputCodigo) {
        // Buscar ao pressionar Enter
        inputCodigo.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarEquipamentoPorCodigo();
          }
        });
        // Buscar com debounce ao digitar (após 1.5s de inatividade)
        const buscaComDebounce = debounce(() => {
          const codigo = inputCodigo.value.trim();
          if (codigo && !isNaN(codigo) && parseFloat(codigo) > 0) {
            buscarEquipamentoPorCodigo();
          }
        }, 1500);
        inputCodigo.addEventListener('input', buscaComDebounce);
      }
    }
    
    // Botões de busca de motorista
    const btnBuscarMotoristaPorCpf = document.getElementById('btnBuscarMotoristaPorCpf');
    const btnBuscarMotoristaPorNome = document.getElementById('btnBuscarMotoristaPorNome');
    const btnBuscarMotoristaPorCodigo = document.getElementById('btnBuscarMotoristaPorCodigo');
    
    if (btnBuscarMotoristaPorCpf) {
      btnBuscarMotoristaPorCpf.replaceWith(btnBuscarMotoristaPorCpf.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorCpf').addEventListener('click', buscarMotoristaPorCpf);
      
      // Adicionar busca ao pressionar Enter no campo CPF
      const inputCpf = document.getElementById('motoristaCpf');
      if (inputCpf) {
        inputCpf.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarMotoristaPorCpf();
          }
        });
      }
    }

    if (btnBuscarMotoristaPorNome) {
      btnBuscarMotoristaPorNome.replaceWith(btnBuscarMotoristaPorNome.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorNome').addEventListener('click', buscarMotoristaPorNome);
      
      // Adicionar busca com debounce ao digitar no campo Nome
      const inputNome = document.getElementById('motoristaNome');
      if (inputNome) {
        // Buscar ao pressionar Enter
        inputNome.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarMotoristaPorNome();
          }
        });
        // Buscar com debounce ao digitar (após 1s de inatividade e mínimo 3 caracteres)
        const buscaComDebounce = debounce(() => {
          const nome = inputNome.value.trim();
          if (nome.length >= 3) {
            buscarMotoristaPorNome();
          }
        }, 1000);
        inputNome.addEventListener('input', buscaComDebounce);
      }
    }
    
    if (btnBuscarMotoristaPorCodigo) {
      btnBuscarMotoristaPorCodigo.replaceWith(btnBuscarMotoristaPorCodigo.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorCodigo').addEventListener('click', buscarMotoristaPorCodigo);
    }
    
    // Outros listeners
    document.getElementById('veiculoForm')?.addEventListener('submit', salvarVeiculo);
    document.getElementById('btnLimparVeiculo')?.addEventListener('click', limparFormularioVeiculo);
    document.getElementById('btnVoltarVeiculo')?.addEventListener('click', () => showTab('filtros'));
    document.getElementById('motoristaForm')?.addEventListener('submit', salvarMotorista);
    document.getElementById('btnLimparMotorista')?.addEventListener('click', limparFormularioMotorista);
    document.getElementById('btnVoltarMotorista')?.addEventListener('click', () => showTab('filtros'));
    
    // Botão fechar guia completo
    const btnFecharGuiaCompleto = document.getElementById('btnFecharGuiaCompleto');
    if (btnFecharGuiaCompleto) {
      btnFecharGuiaCompleto.addEventListener('click', () => {
        document.getElementById('modalGuiaCompletoEnvio').style.display = 'none';
      });
    }
  }

  // Registrar listeners quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registrarEventListeners);
  } else {
    // DOM já está pronto
    registrarEventListeners();
  }
  
  // Também tentar registrar após um pequeno delay (caso os elementos sejam carregados dinamicamente)
  setTimeout(registrarEventListeners, 500);
  
  // Registrar novamente quando a aba for aberta (caso os elementos sejam carregados dinamicamente)
  // Isso já é feito no showTab interceptado abaixo, então não precisa duplicar

  // Interceptar showTab para carregar dados quando necessário
  const originalShowTab = showTab;
  showTab = async function(tabId) {
    await originalShowTab(tabId);
    
    // Registrar listeners novamente quando a aba for aberta (caso os elementos sejam carregados dinamicamente)
    if (tabId === 'veiculo' || tabId === 'motorista') {
      setTimeout(registrarEventListeners, 100);
    }
    
    if (tabId === 'veiculo') {
      // Carregar tipos de equipamento quando abrir a aba
      await carregarTiposEquipamento();
      
      const idViagem = document.getElementById('viagemId')?.value;
      if (idViagem) {
        await carregarVeiculoViagem(idViagem);
      }
    } else if (tabId === 'motorista') {
      const idViagem = document.getElementById('viagemId')?.value;
      if (idViagem) {
        await carregarMotoristaViagem(idViagem);
      }
    }
  };

  // Expor funções globalmente para uso em onclick
  window.buscarEquipamentoPorPlaca = buscarEquipamentoPorPlaca;
  window.buscarEquipamentoPorCodigo = buscarEquipamentoPorCodigo;
  window.buscarMotoristaPorCpf = buscarMotoristaPorCpf;
  window.buscarMotoristaPorNome = buscarMotoristaPorNome;
  window.buscarMotoristaPorCodigo = buscarMotoristaPorCodigo;

  // =======================
  // ABA HISTÓRICO
  // =======================
  
  let historicoCarregado = false;
  let historicoViagens = [];
  let historicoListaEstadosBr = [];

  function historicoEsc(txt) {
    return String(txt == null ? '' : txt)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function togglePainelHistoricoRegional() {
    const modo = document.querySelector('input[name="historicoModo"]:checked')?.value;
    const painel = document.getElementById('historicoRegionalPainel');
    if (!painel) return;
    painel.style.display = modo === 'regional' ? 'block' : 'none';
  }

  async function popularHistoricoCombosUf() {
    const so = document.getElementById('histUfOrigem');
    const sd = document.getElementById('histUfDestino');
    if (!so || !sd || so.dataset.populated === '1') return;
    try {
      const base =
        typeof window.corrigirUrl === 'function' ? window.corrigirUrl.bind(window) : function (u) {
          return u;
        };
      const r = await fetch(base('/api/estados?pais=BR&situacao=S'), { headers: getAuthHeaders({ Accept: 'application/json' }) });
      if (!r.ok) return;
      const rows = await r.json();
      historicoListaEstadosBr = Array.isArray(rows) ? rows : [];
      const opts =
        '<option value="">(qualquer)</option>' +
        historicoListaEstadosBr
          .map(function (e) {
            const uf = String(e.ESTADO != null ? e.ESTADO : e.estado || '').trim();
            const cduf = e.CDUF != null ? e.CDUF : e.cduf;
            if (!uf) return '';
            return '<option value="' + historicoEsc(uf) + '" data-cduf="' + String(cduf != null ? cduf : '') + '">' + historicoEsc(uf) + '</option>';
          })
          .join('');
      so.innerHTML = opts;
      sd.innerHTML = opts;
      so.dataset.populated = '1';
    } catch (_e) {}
  }

  async function popularHistoricoMesorregioes(selectEl, ufSigla) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">(qualquer)</option>';
    if (!ufSigla || !historicoListaEstadosBr.length) return;
    const row = historicoListaEstadosBr.find(function (e) {
      const u = String(e.ESTADO != null ? e.ESTADO : e.estado || '').trim().toUpperCase();
      return u === String(ufSigla).trim().toUpperCase();
    });
    const cduf = row ? (row.CDUF != null ? row.CDUF : row.cduf) : null;
    if (cduf == null || cduf === '') return;
    try {
      const base =
        typeof window.corrigirUrl === 'function' ? window.corrigirUrl.bind(window) : function (u) {
          return u;
        };
      const r = await fetch(base('/api/mesorregioes?cduf=' + encodeURIComponent(String(cduf)) + '&situacao=S'), {
        headers: getAuthHeaders({ Accept: 'application/json' })
      });
      if (!r.ok) return;
      const mesos = await r.json();
      if (!Array.isArray(mesos)) return;
      mesos.forEach(function (m) {
        const cdu = m.CDUF != null ? m.CDUF : m.cduf;
        const cdm = m.CDMESOREGIAO != null ? m.CDMESOREGIAO : m.cdmesoregiao;
        const ds = m.DSMESOREGIAO != null ? m.DSMESOREGIAO : m.dsmesoregiao || '';
        if (cdu == null || cdm == null) return;
        const val = String(cdu) + '_' + String(cdm);
        const op = document.createElement('option');
        op.value = val;
        op.textContent = ds || val;
        selectEl.appendChild(op);
      });
    } catch (_e2) {}
  }

  // Inicializar aba Histórico
  function inicializarAbaHistorico() {
    const btnVoltarHistorico = document.getElementById('btnVoltarHistorico');
    const btnCarregarHistorico = document.getElementById('btnCarregarHistorico');
    
    if (btnVoltarHistorico && !btnVoltarHistorico.dataset.listenerAdded) {
      btnVoltarHistorico.dataset.listenerAdded = 'true';
      btnVoltarHistorico.addEventListener('click', () => {
        showTab('filtros');
      });
    }
    
    if (btnCarregarHistorico && !btnCarregarHistorico.dataset.listenerAdded) {
      btnCarregarHistorico.dataset.listenerAdded = 'true';
      btnCarregarHistorico.addEventListener('click', carregarHistoricoRoteiro);
    }

    document.querySelectorAll('input[name="historicoModo"]').forEach(function (rad) {
      if (!rad.dataset.historicoModoBound) {
        rad.dataset.historicoModoBound = '1';
        rad.addEventListener('change', function () {
          togglePainelHistoricoRegional();
          if (rad.value === 'regional') {
            popularHistoricoCombosUf();
          }
        });
      }
    });

    const btnPref = document.getElementById('btnHistoricoPreencherDoRoteiro');
    if (btnPref && !btnPref.dataset.bound) {
      btnPref.dataset.bound = '1';
      btnPref.addEventListener('click', async function () {
        const sel = document.getElementById('viagemRoteiro');
        const id = sel && sel.value ? String(sel.value).trim() : '';
        if (!id) {
          showMessage('Selecione um roteiro na aba Dados para preencher as UF.', 'info');
          return;
        }
        try {
          const base =
            typeof window.corrigirUrl === 'function' ? window.corrigirUrl.bind(window) : function (u) {
              return u;
            };
          const r = await fetch(base('/api/roteiros/' + encodeURIComponent(id)), { headers: getAuthHeaders() });
          if (!r.ok) throw new Error('Roteiro não encontrado');
          const ro = await r.json();
          const ufo = ro.ORIGEM_ESTADO || ro.origem_estado || '';
          const ufd = ro.DESTINO_ESTADO || ro.destino_estado || '';
          await popularHistoricoCombosUf();
          const so = document.getElementById('histUfOrigem');
          const sd = document.getElementById('histUfDestino');
          if (so && ufo) so.value = String(ufo).trim().substring(0, 2).toUpperCase();
          if (sd && ufd) sd.value = String(ufd).trim().substring(0, 2).toUpperCase();
          await popularHistoricoMesorregioes(document.getElementById('histMesoOrigem'), so && so.value);
          await popularHistoricoMesorregioes(document.getElementById('histMesoDestino'), sd && sd.value);
          showMessage('UF preenchidas conforme o roteiro selecionado.', 'success');
        } catch (e) {
          showMessage(e.message || 'Não foi possível ler o roteiro.', 'error');
        }
      });
    }

    const so = document.getElementById('histUfOrigem');
    const sd = document.getElementById('histUfDestino');
    if (so && !so.dataset.mesoBound) {
      so.dataset.mesoBound = '1';
      so.addEventListener('change', function () {
        popularHistoricoMesorregioes(document.getElementById('histMesoOrigem'), so.value);
      });
    }
    if (sd && !sd.dataset.mesoBound) {
      sd.dataset.mesoBound = '1';
      sd.addEventListener('change', function () {
        popularHistoricoMesorregioes(document.getElementById('histMesoDestino'), sd.value);
      });
    }

    togglePainelHistoricoRegional();
  }
  
  // Carregar histórico do roteiro (ou referência regional)
  async function carregarHistoricoRoteiro() {
    try {
      const modoEl = document.querySelector('input[name="historicoModo"]:checked');
      const modo = modoEl && modoEl.value === 'regional' ? 'regional' : 'roteiro';

      const selectRoteiro = document.getElementById('viagemRoteiro');
      const idRoteiro = selectRoteiro?.value;
      const nomeRoteiroCombo = selectRoteiro?.selectedOptions[0]?.text || 'Roteiro';

      const ufo = (document.getElementById('histUfOrigem') && document.getElementById('histUfOrigem').value) || '';
      const ufd = (document.getElementById('histUfDestino') && document.getElementById('histUfDestino').value) || '';
      const mo = (document.getElementById('histMesoOrigem') && document.getElementById('histMesoOrigem').value) || '';
      const md = (document.getElementById('histMesoDestino') && document.getElementById('histMesoDestino').value) || '';

      if (modo === 'roteiro') {
        if (!idRoteiro || idRoteiro === '') {
          showMessage('Por favor, selecione um roteiro na aba Dados primeiro.', 'error');
          return;
        }
      } else {
        const temReg = !!(ufo || ufd || mo || md);
        if (!temReg) {
          showMessage('No modo regional, informe ao menos UF origem, UF destino ou uma mesorregião.', 'error');
          return;
        }
      }

      showMessage('Carregando histórico...', 'info');

      let qs = 'modo=' + encodeURIComponent(modo);
      if (modo === 'roteiro') {
        qs += '&idRoteiro=' + encodeURIComponent(String(idRoteiro));
      } else {
        if (ufo) qs += '&ufOrigem=' + encodeURIComponent(ufo);
        if (ufd) qs += '&ufDestino=' + encodeURIComponent(ufd);
        if (mo) qs += '&mesoOrigem=' + encodeURIComponent(mo);
        if (md) qs += '&mesoDestino=' + encodeURIComponent(md);
      }

      const response = await fetchApiViagens('/historico-roteiro?' + qs);

      if (!response.ok) {
        let msg = 'Erro ao carregar histórico';
        try {
          const errBody = await response.json();
          msg = errBody.error || msg;
        } catch (_x) {}
        throw new Error(msg);
      }
      
      const data = await response.json();
      
      if (data.success) {
        historicoViagens = data.viagens || [];
        historicoCarregado = true;
        
        const h2Hist = document.querySelector('#tab-historico h2.form-panel-titulo');
        if (h2Hist) {
          if (modo === 'roteiro') {
            h2Hist.innerHTML =
              `<i class='bx bx-history' aria-hidden="true"></i> <span>Histórico de Viagens do Roteiro</span> <span style="color: #667eea;">${historicoEsc(nomeRoteiroCombo)}</span>`;
          } else {
            h2Hist.innerHTML =
              `<i class='bx bx-history' aria-hidden="true"></i> <span>Histórico — referência regional</span> <span style="color: #64748b; font-weight: 500;">${historicoEsc(data.criterioDescricao || '')}</span>`;
          }
        }
        
        const countDiv = document.getElementById('historicoCount');
        const countText = document.getElementById('historicoCountText');
        if (countDiv && countText) {
          const crit = data.criterioDescricao ? ` · ${data.criterioDescricao}` : '';
          const baseTxt =
            modo === 'roteiro'
              ? `${data.totalRegistros || 0} viagem(ns) encontrada(s) no roteiro ${nomeRoteiroCombo}`
              : `${data.totalRegistros || 0} viagem(ns) encontrada(s)${crit}`;
          countText.textContent = baseTxt;
          countDiv.style.display = 'block';
        }
        
        renderizarResumoHistorico(data.resumo || []);
        renderizarHistoricoViagens(historicoViagens);
        
        const legenda = document.getElementById('historicoLegenda');
        if (legenda) {
          legenda.style.display = historicoViagens.length > 0 ? 'block' : 'none';
        }
        
        showMessage(`${data.totalRegistros || 0} viagem(ns) carregada(s) com sucesso!`, 'success');
      } else {
        throw new Error(data.error || 'Erro ao carregar histórico');
      }
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      showMessage('Erro ao carregar histórico: ' + err.message, 'error');
    }
  }
  
  // Renderizar resumo por classe de frota
  function renderizarResumoHistorico(resumo) {
    const resumoDiv = document.getElementById('historicoResumo');
    const resumoContent = document.getElementById('historicoResumoContent');
    
    if (!resumoDiv || !resumoContent) return;
    
    if (!resumo || resumo.length === 0) {
      resumoDiv.style.display = 'none';
      return;
    }
    
    resumoDiv.style.display = 'block';
    
    let html = '';
    resumo.forEach(item => {
      const qtd = item.quantidade ?? 0;
      const vMin = item.valorMinimo ?? '0.00';
      const vMax = item.valorMaximo ?? '0.00';
      const vMed = item.valorMedio ?? '0.00';
      const pTotal = item.pesoTotal ?? '0.00';
      const classe = item.classefrota ?? 'Não Informada';
      html += `
        <div class="historico-resumo-card" style="background: white; padding: 15px 20px; border-radius: 8px; border: 1px solid #e9ecef; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong style="color: #2c3e50; font-size: 16px;">${classe}</strong>
            <span class="historico-badge-viagens" style="background: #667eea; color: white; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600;">
              ${qtd} viagem(ns)
            </span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px;">
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Mínimo</div>
              <div style="font-size: 15px; font-weight: 600; color: #27ae60;">R$ ${vMin}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Máximo</div>
              <div style="font-size: 15px; font-weight: 600; color: #e74c3c;">R$ ${vMax}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Médio</div>
              <div style="font-size: 15px; font-weight: 600; color: #3498db;">R$ ${vMed}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Peso Total</div>
              <div style="font-size: 15px; font-weight: 600; color: #9b59b6;">${pTotal} kg</div>
            </div>
          </div>
        </div>
      `;
    });
    
    resumoContent.innerHTML = html;
  }
  
  // Renderizar viagens do histórico
  function renderizarHistoricoViagens(viagens) {
    const grid = document.getElementById('historicoViagensGrid');
    if (!grid) return;
    
    if (!viagens || viagens.length === 0) {
      grid.innerHTML = '<p class="empty">Nenhuma viagem encontrada para os critérios selecionados.</p>';
      return;
    }
    
    let html = '<div style="display: grid; gap: 12px;">';
    
    viagens.forEach(viagem => {
      const rastreado = viagem.rastreado === 'Sim';
      const iconRastreado = rastreado 
        ? '<span style="color: #27ae60; font-size: 16px;" title="Rastreado">●</span>' 
        : '<span style="color: #e74c3c; font-size: 16px;" title="Não Rastreado">●</span>';
      
      const dtInicio = viagem.dtPrevInicio ? fmtDataHora(viagem.dtPrevInicio) : 'Não informado';
      const celContratadorWa = viagem.celContratador ? (() => { const n = String(viagem.celContratador).replace(/\D/g, ''); return n.length >= 12 ? n : '55' + n; })() : '';
      const celMotoristaWa = viagem.celMotorista ? (() => { const n = String(viagem.celMotorista).replace(/\D/g, ''); return n.length >= 12 ? n : '55' + n; })() : '';
      
      html += `
        <div class="historico-viagem-card" style="background: #ffffff; border: 1px solid #dee2e6; border-left: 4px solid #667eea; border-radius: 6px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: all 0.2s ease;" 
             onmouseover="this.style.boxShadow='0 3px 8px rgba(0,0,0,0.12)'; this.style.borderLeftColor='#764ba2'; this.style.transform='translateX(2px)';" 
             onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.08)'; this.style.borderLeftColor='#667eea'; this.style.transform='translateX(0)';">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 15px;">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap;">
              <h3 class="historico-viagem-titulo" style="margin: 0; color: #2c3e50; font-size: 16px; font-weight: 700; white-space: nowrap;">
                ${iconRastreado} #${viagem.idViagem}
              </h3>
              <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                ${viagem.situacaoViagem || 'N/A'}
              </span>
              <span style="color: #6c757d; font-size: 12px;">
                ${viagem.tipoViagem || 'N/A'} • ${viagem.classeFrota || 'N/A'}
              </span>
              ${viagem.nomeRoteiro || viagem.ufOrigemRoteiro || viagem.ufDestinoRoteiro ? `
              <div style="width: 100%; font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.35;">
                ${viagem.nomeRoteiro ? '<strong>' + historicoEsc(viagem.nomeRoteiro) + '</strong> · ' : ''}${historicoEsc(viagem.ufOrigemRoteiro || '—')} → ${historicoEsc(viagem.ufDestinoRoteiro || '—')}
              </div>` : ''}
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: 700; color: #27ae60; white-space: nowrap;">R$ ${viagem.vlFrete}</div>
              <div style="font-size: 11px; color: #6c757d; white-space: nowrap;">Peso: ${viagem.peso} kg</div>
            </div>
          </div>
          
          <div style="border-top: 1px solid #e9ecef; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">📅 Data Prevista</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${dtInicio}</div>
            </div>
            
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">🏢 Contratador</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${viagem.contratador || 'Não informado'}</div>
              ${viagem.celContratador ? `
                <a href="https://wa.me/${celContratadorWa}" 
                   target="_blank" 
                   style="font-size: 13px; color: #25D366; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; font-weight: 600;"
                   onmouseover="this.style.color='#20BA59'; this.style.textDecoration='underline';" 
                   onmouseout="this.style.color='#25D366'; this.style.textDecoration='none';"
                   title="Clique para abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  ${viagem.celContratador}
                </a>
              ` : ''}
            </div>
            
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">👤 Motorista</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${viagem.motorista}</div>
              ${viagem.celMotorista ? `
                <a href="https://wa.me/${celMotoristaWa}" 
                   target="_blank" 
                   style="font-size: 13px; color: #25D366; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; font-weight: 600;"
                   onmouseover="this.style.color='#20BA59'; this.style.textDecoration='underline';" 
                   onmouseout="this.style.color='#25D366'; this.style.textDecoration='none';"
                   title="Clique para abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  ${viagem.celMotorista}
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    grid.innerHTML = html;
  }

  // ==========================================
  // ABA RASTREAMENTO GPS
  // ==========================================
  
  let mapaRastreamento = null;
  let mapaRastreamentoInicializando = false; // Flag para evitar múltiplas inicializações simultâneas
  let marcadoresRastreamento = [];
  let linhaRastreamento = null; // LayerGroup: trajeto já percorrido (GPS)
  let marcadorOrigemRastreamento = null;
  let marcadorDestinoRastreamento = null;
  let linhaRotaPlanejada = null; // LayerGroup: rota cadastrada (planejada)
  let linhaRotaRestante = null; // LayerGroup: o que ainda falta percorrer
  let marcadoresParadaRoteiroRastreamento = [];

  // Função auxiliar para construir URL de roteamento (OSRM Route GET). ORS não aceita este formato no browser — sempre trocar base.
  function construirUrlRota(servidor, coordsStr, overview = 'simplified', geometries = 'geojson') {
    let servidorNormalizado = servidor;
    if (typeof servidorParaFetchDiretoOsrm === 'function') {
      servidorNormalizado = servidorParaFetchDiretoOsrm(servidor);
    } else if (servidor && String(servidor).includes('/ors/')) {
      servidorNormalizado = 'https://router.project-osrm.org/route/v1/driving';
    }
    // IMPORTANTE: Normalizar URL - garantir HTTP para servidor próprio
    const servidoresProprios = ['186.250.92.131'];
    const isServidorProprio = servidor && servidoresProprios.some(s => servidor.includes(s));
    
    if (isServidorProprio) {
      servidorNormalizado = servidor.replace(/^https:/, 'http:');
      servidorNormalizado = servidorNormalizado.replace(/https:\/\//, 'http://');
      
      if (servidorNormalizado !== servidor) {
        _log('🔄 [ROTA] Normalizando URL do servidor próprio:', servidor, '→', servidorNormalizado);
      }
      
      // Verificar se ainda está em HTTPS após normalização
      if (servidorNormalizado.startsWith('https:')) {
        console.error('❌ [ROTA] ERRO: Servidor ainda está em HTTPS após normalização!', servidorNormalizado);
        servidorNormalizado = 'http:' + servidorNormalizado.substring(6); // Remove 'https:' e adiciona 'http:'
      }
    }
    
    // Detectar se é ORS (OpenRouteService) ou OSRM
    let urlFinal;
    if (servidorNormalizado.includes('/ors/')) {
      // Formato ORS: /ors/v2/directions/{profile}/{coords}?overview={overview}&geometries={geometries}
      urlFinal = `${servidorNormalizado}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    } else {
      // Formato OSRM padrão: /route/v1/{profile}/{coords}?overview={overview}&geometries={geometries}
      urlFinal = `${servidorNormalizado}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    }
    
    // CRÍTICO: Garantir que URL final está em HTTP para servidores próprios
    if (isServidorProprio && urlFinal.startsWith('https://')) {
      urlFinal = 'http://' + urlFinal.substring(8);
      console.warn('⚠️ [ROTA] URL final ainda estava em HTTPS, corrigindo:', urlFinal.substring(0, 80));
    }
    
    // Log final para debug
    if (isServidorProprio && urlFinal.startsWith('https:')) {
      console.error('❌ [ROTA] ERRO: URL ainda está em HTTPS!', urlFinal);
      // Tentar corrigir uma última vez
      urlFinal = urlFinal.replace(/^https:/, 'http:');
    }
    
    return urlFinal;
  }
  
  // Função auxiliar para fazer fetch forçando HTTP (evita conversão automática do navegador)
  async function fetchForcandoHTTP(url, options = {}) {
    // Se for servidor próprio, garantir que seja HTTP
    let fetchUrl = url;
    const servidoresProprios = ['186.250.92.131'];
    const isServidorProprio = servidoresProprios.some(servidor => url.includes(servidor));
    
    // CRÍTICO: Para servidores próprios, SEMPRE usar XMLHttpRequest
    // porque navegadores modernos convertem fetch() automaticamente para HTTPS
    // XMLHttpRequest não tem esse problema e respeita o protocolo especificado
    if (isServidorProprio) {
      // Forçar HTTP de múltiplas formas ANTES de qualquer coisa
      let httpUrl = url;
      
      // Método 1: Replace simples
      httpUrl = httpUrl.replace(/^https:/, 'http:');
      httpUrl = httpUrl.replace(/https:\/\//, 'http://');
      
      // Método 2: Se ainda estiver em HTTPS, usar substring
      if (httpUrl.startsWith('https://')) {
        httpUrl = 'http://' + httpUrl.substring(8); // Remove 'https://' e adiciona 'http://'
      }
      
      // Método 3: Usar URL object para garantir
      try {
        const urlObj = new URL(httpUrl);
        if (urlObj.protocol === 'https:') {
          urlObj.protocol = 'http:';
          httpUrl = urlObj.toString();
        }
      } catch (e) {
        // Se falhar, usar httpUrl já corrigido
      }
      
      // Garantir que está em HTTP (última verificação)
      if (httpUrl.startsWith('https://')) {
        httpUrl = 'http://' + httpUrl.substring(8);
      }
      
      if (httpUrl !== url) {
        console.warn('⚠️ [FETCH] URL convertida de HTTPS para HTTP:', url.substring(0, 80), '→', httpUrl.substring(0, 80));
      }
      
      _log('🔄 [FETCH] Usando XMLHttpRequest diretamente para servidor próprio:', httpUrl.substring(0, 80));
      
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        // CRÍTICO: Garantir que a URL está SEMPRE em HTTP antes de abrir
        // NUNCA passar HTTPS para xhr.open()
        let urlFinal = httpUrl;
        if (urlFinal.startsWith('https://')) {
          urlFinal = 'http://' + urlFinal.substring(8);
          console.error('❌ [FETCH] ERRO CRÍTICO: URL ainda estava em HTTPS antes de xhr.open()! Corrigindo...');
        }
        
        // Verificar novamente antes de abrir
        if (urlFinal.includes('https://')) {
          urlFinal = urlFinal.replace(/https:\/\//g, 'http://');
        }
        
        try {
          xhr.open(options.method || 'GET', urlFinal, true);
        } catch (e) {
          console.error('❌ [FETCH] Erro ao abrir XMLHttpRequest:', e, 'URL:', urlFinal.substring(0, 80));
          reject(new Error('Erro ao abrir requisição: ' + e.message));
          return;
        }
        
        xhr.responseType = 'json';
        
        // Adicionar headers se necessário
        if (options.headers) {
          Object.keys(options.headers).forEach(key => {
            try {
              xhr.setRequestHeader(key, options.headers[key]);
            } catch (e) {
              console.warn('⚠️ [FETCH] Erro ao adicionar header:', key, e);
            }
          });
        }
        
        // Timeout
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            xhr.abort();
            reject(new Error('Aborted'));
          });
        }
        
        // Timeout padrão de 30 segundos
        xhr.timeout = 30000;
        
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Criar um objeto Response-like
            const response = {
              ok: true,
              status: xhr.status,
              statusText: xhr.statusText,
              json: async () => {
                try {
                  return typeof xhr.response === 'string' ? JSON.parse(xhr.response) : xhr.response;
                } catch (e) {
                  return JSON.parse(xhr.responseText);
                }
              },
              text: async () => xhr.responseText,
              headers: new Headers(),
              url: urlFinal
            };
            resolve(response);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        
        xhr.onerror = function() {
          console.error('❌ [FETCH] XMLHttpRequest erro. URL tentada:', urlFinal.substring(0, 80));
          reject(new Error('Network error'));
        };
        
        xhr.ontimeout = function() {
          reject(new Error('Timeout'));
        };
        
        try {
          xhr.send(options.body || null);
        } catch (e) {
          console.error('❌ [FETCH] Erro ao enviar XMLHttpRequest:', e);
          reject(new Error('Erro ao enviar requisição: ' + e.message));
        }
      });
    }
    
    // Para servidores não-próprios, usar fetch normal
    // Mas garantir que não está em HTTPS se não deveria estar
    let finalUrl = fetchUrl;
    if (finalUrl.startsWith('https://') && !finalUrl.includes('router.project-osrm.org') && !finalUrl.includes('routing.openstreetmap.de')) {
      finalUrl = finalUrl.replace(/^https:/, 'http:');
    }
    
    const request = new Request(finalUrl, {
      method: options.method || 'GET',
      mode: 'cors',
      cache: options.cache || 'no-cache',
      credentials: options.credentials || 'omit',
      signal: options.signal,
      headers: options.headers || {}
    });
    
    return fetch(request);
  }
  
  // Função auxiliar para parsear resposta (suporta OSRM e ORS) - escopo global
  function parsearRespostaRota(data) {
    let d = data;
    if (typeof window.normalizarRespostaGatewayOsrm === 'function') {
      const n = window.normalizarRespostaGatewayOsrm(data);
      if (n) d = n;
    }
    // ORS GeoJSON bruto (FeatureCollection) → normalizar acima; OSRM: { code, routes }
    if (d.routes && d.routes[0] && d.routes[0].geometry) {
      return d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Converter [lon, lat] para [lat, lon]
    }
    if (d.code === 'Ok' && d.routes && d.routes[0] && d.routes[0].geometry) {
      return d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
    return null;
  }

  // Botão atualizar: recarrega posições do banco principal (PostgreSQL). Não há mais sincronização com INTEGRA_PRD.
  function inicializarAbaRastreamento() {
    // Botão voltar
    const btnVoltar = document.getElementById('btnVoltarRastreamento');
    if (btnVoltar) {
      btnVoltar.addEventListener('click', () => {
        mudarAba('filtros');
      });
    }

    // Botão atualizar — apenas recarrega posições do banco (Atlas Cargo / PostgreSQL)
    const btnAtualizar = document.getElementById('btnAtualizarRastreamento');
    if (btnAtualizar) {
      btnAtualizar.addEventListener('click', async () => {
        const idViagem = document.getElementById('filtroIdViagem')?.value || 
                        document.getElementById('viagemId')?.value || 
                        null;
        if (idViagem) {
          try {
            showRastreamentoLoading('Carregando Posições GPS', 'Buscando posições no banco...');
            await carregarPosicoesRastreamento(idViagem);
          } catch (err) {
            console.error('Erro ao atualizar rastreamento:', err);
            mostrarMensagemRastreamento('Erro ao atualizar posições. Tente novamente.', 'error');
          } finally {
            hideRastreamentoLoading();
          }
        } else {
          mostrarMensagemRastreamento('Nenhuma viagem selecionada.', 'warning');
        }
      });
    }
  }

  // ==========================================
  // ALERTAS, CHAT, SOS E RANKING REMOVIDOS
  // ==========================================
  // Estas funcionalidades foram movidas para módulos separados:
  // - Alertas: backend/public/modulos/alertas/
  // - Chat: backend/public/modulos/chat/
  // - SOS: backend/public/modulos/sos/
  // - Ranking: backend/public/modulos/ranking/
  
  // Funções globais do WebSocket mantidas para compatibilidade, mas com verificações de segurança

  // Funções para overlay de loading
  function showRastreamentoLoading(titulo = 'Carregando Posições GPS', texto = 'Aguarde enquanto buscamos as posições...') {
    const overlay = document.getElementById('rastreamentoLoadingOverlay');
    const tituloEl = document.getElementById('rastreamentoLoadingTitulo');
    const textoEl = document.getElementById('rastreamentoLoadingTexto');
    
    if (overlay) {
      if (tituloEl) tituloEl.textContent = titulo;
      if (textoEl) textoEl.textContent = texto;
      overlay.style.display = 'flex';
    }
  }

  function hideRastreamentoLoading() {
    const overlay = document.getElementById('rastreamentoLoadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Carregar posições GPS da viagem
  async function carregarPosicoesRastreamento(idViagem) {
    if (!idViagem) {
      mostrarMensagemRastreamento('Nenhuma viagem selecionada.', 'warning');
      return;
    }

    const container = document.getElementById('rastreamentoContainer');
    const semViagem = document.getElementById('rastreamentoSemViagem');
    const infoViagem = document.getElementById('rastreamentoInfoViagem');
    const listaPosicoes = document.getElementById('listaPosicoes');

    try {
      // Mostrar overlay de loading (padrão Gerenciar Cidades)
      showRastreamentoLoading('Carregando Posições GPS', 'Buscando posições GPS da viagem...');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      
      // Mostrar loading na lista também
      if (listaPosicoes) {
        listaPosicoes.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Carregando posições...</p>';
      }

      // Buscar motorista da viagem (mesmo que não tenha posições GPS)
      let motorista = null;
      try {
        const motoristaResponse = await fetchApiAbsPath(`/api/motorista/motorista-viagem/${encodeURIComponent(idViagem)}`, {
          headers: getAuthHeaders()
        });
        if (motoristaResponse.ok) {
          motorista = await motoristaResponse.json();
        }
      } catch (err) {
        console.warn('Erro ao buscar motorista:', err);
      }

      // Buscar dados da viagem (origem e destino)
      let dadosViagem = null;
      try {
        const viagemResponse = await fetchApiViagens(`/${idViagem}`);
        if (viagemResponse.ok) {
          dadosViagem = await viagemResponse.json();
          _log(`🔍 [RASTREAMENTO] Dados da viagem recebidos:`, {
            ORIGEM_CIDADE: dadosViagem.ORIGEM_CIDADE,
            ORIGEM_ESTADO: dadosViagem.ORIGEM_ESTADO,
            DESTINO_CIDADE: dadosViagem.DESTINO_CIDADE,
            DESTINO_ESTADO: dadosViagem.DESTINO_ESTADO
          });
        } else {
          console.warn(`⚠️ [RASTREAMENTO] Erro ao buscar dados da viagem: ${viagemResponse.status}`);
        }
      } catch (err) {
        console.warn('Erro ao buscar dados da viagem:', err);
      }

      // Buscar posições (fetchApiAbsPath: /cargas/api/... quando o dashboard está sob /cargas/)
      const response = await fetchApiAbsPath(`/api/motorista/posicoes/${encodeURIComponent(idViagem)}`, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        let det = '';
        try {
          const errBody = await response.clone().json();
          det = errBody.error || errBody.message || '';
        } catch (_) { /* ignore */ }
        throw new Error(`Erro ao buscar posições: ${response.status}${det ? ' — ' + det : ''}`);
      }

      const posicoesData = await response.json();
      
      _log(`📊 [RASTREAMENTO] Resposta da API recebida:`, {
        tipo: Array.isArray(posicoesData) ? 'array' : 'objeto',
        tamanho: Array.isArray(posicoesData) ? posicoesData.length : (posicoesData.posicoes?.length || 0)
      });
      
      // A resposta pode ser um array direto (compatibilidade) ou um objeto com posicoes e ultimaPosicaoGeral
      let posicoes, ultimaPosicaoGeral;
      if (Array.isArray(posicoesData)) {
        // Formato antigo (array direto) - compatibilidade
        posicoes = posicoesData;
        ultimaPosicaoGeral = null;
        _log(`📊 [RASTREAMENTO] Formato antigo (array): ${posicoes.length} posições`);
      } else {
        // Formato novo (objeto com posicoes e ultimaPosicaoGeral)
        posicoes = posicoesData.posicoes || [];
        ultimaPosicaoGeral = posicoesData.ultimaPosicaoGeral || null;
        _log(`📊 [RASTREAMENTO] Formato novo (objeto): ${posicoes.length} posições`);
      }

      function normalizarPosicaoGps(p) {
        if (!p || typeof p !== 'object') return p;
        return {
          ...p,
          LATITUDE: p.LATITUDE != null ? p.LATITUDE : p.latitude,
          LONGITUDE: p.LONGITUDE != null ? p.LONGITUDE : p.longitude,
          DHREGISTRO: p.DHREGISTRO != null ? p.DHREGISTRO : p.dhiregistro,
          DHPOSICAO: p.DHPOSICAO != null ? p.DHPOSICAO : p.dhposicao,
          VELOCIDADE: p.VELOCIDADE != null ? p.VELOCIDADE : p.velocidade,
        };
      }
      posicoes = (posicoes || []).map(normalizarPosicaoGps);
      
      if (posicoes.length > 0) {
        _log(`✅ [RASTREAMENTO] ${posicoes.length} posições GPS carregadas para viagem ${idViagem}`);
        _log(`📍 [RASTREAMENTO] Primeira posição:`, posicoes[0]);
        _log(`📍 [RASTREAMENTO] Última posição:`, posicoes[posicoes.length - 1]);
      } else {
        _log(`[RASTREAMENTO] Nenhuma posição GPS na API para viagem ${idViagem} (normal se o app ainda não enviou GPS).`);
      }
      
      if (ultimaPosicaoGeral) {
        _log(`📅 [RASTREAMENTO] Última atualização geral:`, ultimaPosicaoGeral.DHREGISTRO);
      }

      // Esconder mensagem "sem viagem" e mostrar container
      if (semViagem) semViagem.style.display = 'none';
      if (container) container.style.display = 'block';
      if (infoViagem) infoViagem.style.display = 'block';

      // Atualizar informações da viagem
      document.getElementById('rastreamentoIdViagem').textContent = idViagem;
      
      // Atualizar motorista (usar das posições ou buscar separadamente)
      const nomeMotorista = (posicoes && posicoes.length > 0 && posicoes[0].NOME_MOTORISTA) 
        ? posicoes[0].NOME_MOTORISTA 
        : (motorista ? motorista.NOME_MOTORISTA : 'Não informado');
      document.getElementById('rastreamentoMotorista').textContent = nomeMotorista;

      // Placa(s) vinculadas à viagem (aba Veículo / VIAGEMVEICULO)
      const elPlaca = document.getElementById('rastreamentoPlaca');
      if (elPlaca) {
        let txtPlaca = '—';
        try {
          const vr = await fetchApiViagens(`/${idViagem}/veiculo`);
          if (vr.ok) {
            const veics = await vr.json();
            const arr = Array.isArray(veics) ? veics : (veics ? [veics] : []);
            const placas = arr
              .map((v) => String(v.REFEQUIPAMENTO || v.refequipamento || v.PLACA || v.placa || '').trim())
              .filter(Boolean);
            if (placas.length) txtPlaca = placas.join(', ');
          }
        } catch (_) { /* ignore */ }
        elPlaca.textContent = txtPlaca;
      }

      // Atualizar informações
      if (posicoes && posicoes.length > 0) {
        document.getElementById('rastreamentoTotalPosicoes').textContent = posicoes.length;
        
        // Usar última posição geral (sem filtro) se disponível, senão usar última do array filtrado
        let ultimaDataParaExibir = null;
        if (ultimaPosicaoGeral && ultimaPosicaoGeral.DHREGISTRO) {
          // Tratar data do SQL Server
          // A data vem como string no formato local (sem timezone)
          // Precisamos interpretar como horário local do Brasil, não UTC
          const dataStr = ultimaPosicaoGeral.DHREGISTRO;
          if (typeof dataStr === 'string') {
            // Se a string não tem timezone (não termina com Z ou +/-), 
            // interpretar como horário local do Brasil
            // Formato esperado: "2026-12-15T17:56:00" ou "2026-12-15T17:56:00.000"
            // Vamos criar um Date interpretando como horário local
            const partes = dataStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (partes) {
              // Criar Date usando componentes (ano, mês-1, dia, hora, minuto, segundo)
              // Isso cria a data no horário local do navegador
              ultimaDataParaExibir = new Date(
                parseInt(partes[1]), // ano
                parseInt(partes[2]) - 1, // mês (0-11)
                parseInt(partes[3]), // dia
                parseInt(partes[4]), // hora
                parseInt(partes[5]), // minuto
                parseInt(partes[6])  // segundo
              );
            } else {
              ultimaDataParaExibir = new Date(dataStr);
            }
          } else {
            ultimaDataParaExibir = new Date(dataStr);
          }
        } else {
          const ultima = posicoes[posicoes.length - 1];
          if (ultima && ultima.DHREGISTRO) {
            ultimaDataParaExibir = new Date(ultima.DHREGISTRO);
          }
        }
        
        if (ultimaDataParaExibir && !isNaN(ultimaDataParaExibir.getTime())) {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = fmtDataHora(ultimaDataParaExibir);
        } else {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = '-';
        }

        // Exibir no mapa (com origem e destino se disponível)
        await exibirMapaRastreamento(posicoes, dadosViagem);

        // Exibir na lista (sempre mostrar todas as posições na lista, não apenas as amostradas)
        exibirListaPosicoes(posicoes);
        
        // Esconder overlay após exibir tudo
        hideRastreamentoLoading();
      } else {
        // Nenhuma posição encontrada, mas mostrar informações da viagem
        document.getElementById('rastreamentoTotalPosicoes').textContent = '0';
        
        // Mesmo sem posições filtradas, pode haver uma última posição geral
        let ultimaDataParaExibir = null;
        if (ultimaPosicaoGeral && ultimaPosicaoGeral.DHREGISTRO) {
          // Tratar data do SQL Server - interpretar como horário local
          const dataStr = ultimaPosicaoGeral.DHREGISTRO;
          if (typeof dataStr === 'string') {
            const partes = dataStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (partes) {
              ultimaDataParaExibir = new Date(
                parseInt(partes[1]), // ano
                parseInt(partes[2]) - 1, // mês (0-11)
                parseInt(partes[3]), // dia
                parseInt(partes[4]), // hora
                parseInt(partes[5]), // minuto
                parseInt(partes[6])  // segundo
              );
            } else {
              ultimaDataParaExibir = new Date(dataStr);
            }
          } else {
            ultimaDataParaExibir = new Date(dataStr);
          }
        }
        
        if (ultimaDataParaExibir && !isNaN(ultimaDataParaExibir.getTime())) {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = fmtDataHora(ultimaDataParaExibir);
        } else {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = '-';
        }
        
        if (listaPosicoes) {
          listaPosicoes.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Nenhuma posição GPS registrada para esta viagem.</p>';
        }
        
        // Exibir no mapa apenas origem e destino (sem posições GPS)
        if (dadosViagem) {
          await exibirMapaRastreamento([], dadosViagem);
        } else {
          // Limpar mapa se existir
          if (mapaRastreamento) {
            mapaRastreamento.remove();
            mapaRastreamento = null;
          }
        }
        
        // Esconder overlay
        hideRastreamentoLoading();
      }
    } catch (err) {
      console.error('Erro ao carregar posições:', err);
      mostrarMensagemRastreamento('Erro ao carregar posições GPS. Tente novamente.', 'error');
      if (listaPosicoes) {
        listaPosicoes.innerHTML = '<p style="text-align: center; color: #e74c3c; padding: 20px;">Erro ao carregar posições.</p>';
      }
      // Esconder overlay em caso de erro
      hideRastreamentoLoading();
    }
  }

  // Exibir posições no mapa
  async function exibirMapaRastreamento(posicoes, dadosViagem = null) {
    // Evitar múltiplas inicializações simultâneas
    if (mapaRastreamentoInicializando) {
      console.warn('⚠️ [RASTREAMENTO] Mapa já está sendo inicializado. Aguardando...');
      // Aguardar até que a inicialização anterior termine
      let tentativas = 0;
      while (mapaRastreamentoInicializando && tentativas < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }
      if (mapaRastreamentoInicializando) {
        console.error('❌ [RASTREAMENTO] Timeout aguardando inicialização anterior. Cancelando.');
        return;
      }
    }
    
    mapaRastreamentoInicializando = true;
    
    try {
      _log(`🗺️ [MAPA RASTREAMENTO] Exibindo mapa com ${posicoes?.length || 0} posições e dados da viagem:`, dadosViagem ? 'SIM' : 'NÃO');
      
      // Se não há posições e não há dados da viagem, não exibir mapa
      if ((!posicoes || posicoes.length === 0) && !dadosViagem) {
        console.warn(`⚠️ [MAPA RASTREAMENTO] Não há posições nem dados da viagem. Não exibindo mapa.`);
        return;
      }

    // Obter configuração do mapa
    // Usar APENAS MAP_CONFIG global de /js/map-config.js
    // Se não estiver disponível, usar fallback mínimo (não criar config completo)
    const config = window.MAP_CONFIG || {
      tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      osrmServer: 'https://router.project-osrm.org/route/v1/driving-hgv',
      nominatimServer: window.MAP_CONFIG?.nominatimServer || 'https://nominatim.openstreetmap.org',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    };
    
    if (!window.MAP_CONFIG) {
      console.warn('⚠️ [RASTREAMENTO] MAP_CONFIG não encontrado! Usando fallback mínimo.');
    }

    // Carregar Leaflet se necessário
    await carregarLeaflet();

    // CRÍTICO: Garantir que a aba está visível antes de buscar o elemento
    const tabRastreamento = document.getElementById('tab-rastreamento');
    if (!tabRastreamento) {
      console.error('❌ [RASTREAMENTO] Aba tab-rastreamento não encontrada no DOM!');
      mapaRastreamentoInicializando = false;
      return;
    }
    
    // Verificar se a aba está visível (display não é 'none' e não está oculta)
    const isTabVisible = tabRastreamento.style.display !== 'none' && 
                         tabRastreamento.offsetParent !== null &&
                         window.getComputedStyle(tabRastreamento).display !== 'none';
    
    if (!isTabVisible) {
      console.warn('⚠️ [RASTREAMENTO] Aba não está visível. Tentando mostrar...');
      tabRastreamento.style.display = 'block';
      // Aguardar o DOM atualizar
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Agora buscar o elemento
    let mapaDiv = document.getElementById('mapaRastreamento');
    if (!mapaDiv) {
      console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento não encontrado após mostrar aba!');
      // Tentar mais uma vez após um delay maior
      await new Promise(resolve => setTimeout(resolve, 500));
      mapaDiv = document.getElementById('mapaRastreamento');
      if (!mapaDiv) {
        console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento ainda não encontrado após múltiplas tentativas!');
        mapaRastreamentoInicializando = false;
        return;
      }
    }

    // Limpar mapa anterior - com proteção robusta
    if (mapaRastreamento) {
      try {
        // Remover layers antes de remover o mapa
        if (linhaRastreamento) {
          try {
            mapaRastreamento.removeLayer(linhaRastreamento);
          } catch (e) {
            // Ignorar erro se layer já foi removido
          }
          linhaRastreamento = null;
        }
        if (marcadorOrigemRastreamento) {
          try {
            mapaRastreamento.removeLayer(marcadorOrigemRastreamento);
          } catch (e) {
            // Ignorar
          }
          marcadorOrigemRastreamento = null;
        }
        if (marcadorDestinoRastreamento) {
          try {
            mapaRastreamento.removeLayer(marcadorDestinoRastreamento);
          } catch (e) {
            // Ignorar
          }
          marcadorDestinoRastreamento = null;
        }
        if (linhaRotaPlanejada) {
          try {
            mapaRastreamento.removeLayer(linhaRotaPlanejada);
          } catch (e) {
            // Ignorar
          }
          linhaRotaPlanejada = null;
        }
        if (linhaRotaRestante) {
          try {
            mapaRastreamento.removeLayer(linhaRotaRestante);
          } catch (e) {
            // Ignorar
          }
          linhaRotaRestante = null;
        }
        (marcadoresParadaRoteiroRastreamento || []).forEach((m) => {
          try {
            mapaRastreamento.removeLayer(m);
          } catch (e) { /* ignore */ }
        });
        marcadoresParadaRoteiroRastreamento = [];
        marcadoresRastreamento.forEach(m => {
          try {
            mapaRastreamento.removeLayer(m);
          } catch (e) {
            // Ignorar
          }
        });
        
        // Remover o mapa
        try {
          mapaRastreamento.remove();
        } catch (e) {
          // Se der erro ao remover, forçar limpeza do container
          console.warn('⚠️ [RASTREAMENTO] Erro ao remover mapa. Forçando limpeza do container...');
          const mapaDiv = document.getElementById('mapaRastreamento');
          if (mapaDiv) {
            mapaDiv.innerHTML = '';
            if (mapaDiv._leaflet_id) {
              delete mapaDiv._leaflet_id;
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ [RASTREAMENTO] Erro ao limpar mapa anterior:', e);
        // Forçar limpeza do container em caso de erro
        const mapaDiv = document.getElementById('mapaRastreamento');
        if (mapaDiv) {
          mapaDiv.innerHTML = '';
          if (mapaDiv._leaflet_id) {
            delete mapaDiv._leaflet_id;
          }
        }
      }
      mapaRastreamento = null;
    }
    marcadoresRastreamento = [];
    marcadoresParadaRoteiroRastreamento = [];

    // Só limpar de novo se o DOM ainda estiver vinculado a um mapa Leaflet.
    // NÃO usar L.DomUtil.get(mapaDiv): para um elemento ele devolve o próprio nó (sempre truthy) e gerava falso "já tem mapa".
    if (mapaDiv && mapaDiv._leaflet_id) {
      _log('[RASTREAMENTO] Container ainda com _leaflet_id após remove(); limpando DOM...');
      try {
        if (mapaRastreamento && typeof mapaRastreamento.remove === 'function') {
          try {
            mapaRastreamento.remove();
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
      mapaRastreamento = null;
      mapaDiv.innerHTML = '';
      delete mapaDiv._leaflet_id;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (mapaDiv) {
      
      // Verificar novamente se o elemento ainda existe (usar mapaDiv já verificado)
      if (!mapaDiv) {
        console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento não encontrado no DOM após limpeza!');
        mapaRastreamentoInicializando = false;
        return;
      }
      
      // Garantir que a aba ainda está visível
      if (tabRastreamento && (tabRastreamento.style.display === 'none' || window.getComputedStyle(tabRastreamento).display === 'none')) {
        tabRastreamento.style.display = 'block';
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Criar mapa - com proteção adicional contra reutilização
    try {
      // Verificar se o elemento existe e está visível (usar mapaDiv já verificado)
      if (!mapaDiv) {
        console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento não encontrado no DOM!');
        throw new Error('Map container not found');
      }
      
      // Verificar se a aba está visível (já verificado acima, mas garantir novamente)
      if (!tabRastreamento || tabRastreamento.style.display === 'none' || window.getComputedStyle(tabRastreamento).display === 'none') {
        console.warn('⚠️ [RASTREAMENTO] Aba de rastreamento não está visível. Mostrando...');
        if (tabRastreamento) {
          tabRastreamento.style.display = 'block';
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Verificar novamente se o container está limpo antes de criar
      if (mapaDiv._leaflet_id) {
        _log('[RASTREAMENTO] _leaflet_id residual antes de L.map(); limpando container.');
        mapaDiv.innerHTML = '';
        delete mapaDiv._leaflet_id;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Garantir que o elemento tem dimensões antes de criar o mapa
      if (mapaDiv.offsetWidth === 0 || mapaDiv.offsetHeight === 0) {
        console.warn('⚠️ [RASTREAMENTO] Container não tem dimensões. Aguardando renderização...');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      mapaRastreamento = L.map('mapaRastreamento', {
        zoomControl: true
      });
    } catch (err) {
      if (err.message && (err.message.includes('already initialized') || err.message.includes('being reused'))) {
        console.warn('⚠️ [RASTREAMENTO] Erro ao inicializar mapa. Limpando e tentando novamente...');
        const mapaDiv = document.getElementById('mapaRastreamento');
        if (mapaDiv) {
          // Limpar completamente
          mapaDiv.innerHTML = '';
          if (mapaDiv._leaflet_id) {
            delete mapaDiv._leaflet_id;
          }
          
          // Limpar referências do Leaflet
          if (typeof L !== 'undefined' && L.DomUtil) {
            try {
              L.DomUtil.empty(mapaDiv);
            } catch (e) {
              // Ignorar
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 150));
          
          // Verificar novamente se está limpo
          if (mapaDiv._leaflet_id) {
            console.warn('⚠️ [RASTREAMENTO] Container ainda não está limpo. Tentando novamente...');
            mapaDiv.innerHTML = '';
            delete mapaDiv._leaflet_id;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Tentar criar o mapa novamente
          try {
            mapaRastreamento = L.map('mapaRastreamento', {
              zoomControl: true
            });
          } catch (retryErr) {
            console.error('❌ [RASTREAMENTO] Erro ao criar mapa após limpeza:', retryErr);
            throw retryErr;
          }
        }
      } else {
        throw err;
      }
    }

    // Adicionar tiles (MapHelper evita recursão getTileUrl ↔ getTileServerUrl)
    let tileUrl = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
    try {
      if (window.MapHelper && typeof window.MapHelper.getTileUrl === 'function') {
        tileUrl = window.MapHelper.getTileUrl();
      } else if (typeof window.getTileServerUrl === 'function') {
        tileUrl = window.getTileServerUrl();
      } else if (config.tileServer) {
        tileUrl = config.tileServer;
      }
    } catch (_) {
      tileUrl = config.tileServer || tileUrl;
    }
    const tileOptions = {
      attribution:
        config.attribution ||
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: config.maxZoom || 19
    };
    if (tileUrl && tileUrl.includes('{s}')) {
      tileOptions.subdomains = tileUrl.includes('cartocdn') ? ['a', 'b', 'c', 'd'] : ['a', 'b', 'c'];
    }
    L.tileLayer(tileUrl, tileOptions).addTo(mapaRastreamento);
    setTimeout(() => {
      try {
        if (mapaRastreamento) mapaRastreamento.invalidateSize();
      } catch (_) { /* ignore */ }
    }, 80);

    // Ordenar posições por data/hora (garantir ordem cronológica)
    const posicoesOrdenadas = [...posicoes].sort((a, b) => {
      const dataA = new Date(a.DHREGISTRO || a.DHPOSICAO || 0);
      const dataB = new Date(b.DHREGISTRO || b.DHPOSICAO || 0);
      return dataA - dataB; // ASC: mais antiga primeiro
    });

    _log(`📍 [MAPA RASTREAMENTO] ${posicoesOrdenadas.length} posições ordenadas para desenhar no mapa`);

    // Preparar coordenadas das posições GPS (já ordenadas)
    let coordenadas = posicoesOrdenadas
      .filter((p) => {
        const la = parseFloat(String(p.LATITUDE != null ? p.LATITUDE : p.latitude || '').replace(',', '.'));
        const lo = parseFloat(String(p.LONGITUDE != null ? p.LONGITUDE : p.longitude || '').replace(',', '.'));
        return Number.isFinite(la) && Number.isFinite(lo);
      })
      .map((p) => {
        const la = parseFloat(String(p.LATITUDE != null ? p.LATITUDE : p.latitude).replace(',', '.'));
        const lo = parseFloat(String(p.LONGITUDE != null ? p.LONGITUDE : p.longitude).replace(',', '.'));
        return [la, lo];
      });

    /** Distância em km (Haversine) — [lat, lon] */
    function haversineKmRastreamento(a, b) {
      const R = 6371;
      const dLat = (b[0] - a[0]) * Math.PI / 180;
      const dLon = (b[1] - a[1]) * Math.PI / 180;
      const la = (a[0] * Math.PI) / 180;
      const lb = (b[0] * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /**
     * Remove pontos após “salto” impossível em sequência temporal (ex.: vários pings na América do Norte
     * no meio de trajeto no Sul do Brasil). O OSRM público responde 400 se a polyline mistura continentes.
     */
    function filtrarCoordenadasGpsRastreamento(coords) {
      if (!coords || coords.length < 2) return coords || [];
      const maxSaltoKm = 400;
      const out = [coords[0]];
      for (let i = 1; i < coords.length; i++) {
        const prev = out[out.length - 1];
        const cur = coords[i];
        const d = haversineKmRastreamento(prev, cur);
        if (d > maxSaltoKm) {
          _log(`[RASTREAMENTO] Ignorando ponto após salto de ~${Math.round(d)} km (GPS espúrio ou troca de ordem lat/lon).`);
          continue;
        }
        out.push(cur);
      }
      return out.length >= 2 ? out : coords;
    }

    if (coordenadas.length >= 2) {
      const antes = coordenadas.length;
      coordenadas = filtrarCoordenadasGpsRastreamento(coordenadas);
      if (coordenadas.length < antes) {
        _log(`[RASTREAMENTO] Filtro anti-spike: ${antes} → ${coordenadas.length} pontos`);
      }
    }
    
    _log(`📍 [MAPA RASTREAMENTO] ${coordenadas.length} coordenadas válidas preparadas para rota`);

    /** Proxy backend OSRM — rota planejada (cinza), restante (laranja) e já percorrido (verde nas vias). */
    /** timeoutMs: o proxy no servidor pode tentar vários mirrors (até ~35s cada); 40s no cliente aborta antes da resposta. */
    async function rotaGeometriaViaBackendProxy(coordsStr, timeoutMs) {
      try {
        const d = await fetchRotaOsrmViaBackend(coordsStr, timeoutMs != null ? timeoutMs : 110000);
        const g = parsearRespostaRota(d);
        if (g && g.length > 0) return g;
      } catch (e) {
        _log('[RASTREAMENTO] Proxy rota:', e && e.message);
      }
      return null;
    }
    
    if (coordenadas.length === 0 && posicoesOrdenadas.length > 0) {
      console.error(`❌ [MAPA RASTREAMENTO] ERRO: ${posicoesOrdenadas.length} posições mas nenhuma coordenada válida!`);
      console.error(`❌ [MAPA RASTREAMENTO] Primeira posição:`, posicoesOrdenadas[0]);
    }
    
    // LIMITAR PONTOS PARA MELHORAR PERFORMANCE
    // Se houver muitos pontos, fazer amostragem inteligente mantendo início, fim e pontos estratégicos
    const MAX_PONTOS_MAPA = 80; // Limite máximo de pontos para desenhar no mapa (reduzido para melhor performance)
    const totalOriginal = coordenadas.length; // Guardar total original para log
    if (coordenadas.length > MAX_PONTOS_MAPA) {
      _log(`⚠️ [MAPA RASTREAMENTO] Muitos pontos (${totalOriginal}). Aplicando amostragem inteligente para ${MAX_PONTOS_MAPA} pontos...`);
      
      const coordenadasAmostradas = [];
      const total = coordenadas.length;
      
      // Sempre incluir primeiro ponto
      coordenadasAmostradas.push(coordenadas[0]);
      
      // Calcular intervalo para amostragem uniforme
      // Usar deciles (10 partes) para distribuição mais uniforme
      const numPontosIntermediarios = MAX_PONTOS_MAPA - 2; // -2 porque já incluímos primeiro e último
      const intervalo = Math.max(1, Math.floor((total - 2) / numPontosIntermediarios));
      
      // Incluir pontos intermediários em intervalos regulares
      for (let i = intervalo; i < total - 1; i += intervalo) {
        if (coordenadasAmostradas.length < MAX_PONTOS_MAPA - 1) {
          coordenadasAmostradas.push(coordenadas[i]);
        }
      }
      
      // Sempre incluir último ponto
      if (coordenadasAmostradas[coordenadasAmostradas.length - 1] !== coordenadas[total - 1]) {
        coordenadasAmostradas.push(coordenadas[total - 1]);
      }
      
      coordenadas = coordenadasAmostradas;
      const reducaoPercentual = ((1 - coordenadas.length/totalOriginal) * 100).toFixed(1);
      _log(`✅ [MAPA RASTREAMENTO] Amostragem aplicada: ${coordenadas.length} pontos selecionados de ${totalOriginal} totais (redução de ${reducaoPercentual}%)`);
      
      // Atualizar overlay com informação de amostragem
      showRastreamentoLoading('Ajustando mapa', `Amostragem: ${coordenadas.length} de ${totalOriginal} pontos GPS.`);
    }

    /** Ordem por ORDEM/SEQUENCIA; só pontos com lat/lon válidos. */
    function ordenarPontosRoteiroRastreamento(pontos) {
      if (!Array.isArray(pontos)) return [];
      return pontos
        .filter(p => {
          const lat = parseFloat(p.LATITUDE != null ? p.LATITUDE : p.latitude);
          const lon = parseFloat(p.LONGITUDE != null ? p.LONGITUDE : p.longitude);
          return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
        })
        .sort((a, b) => {
          const oa = (a.ORDEM != null ? a.ORDEM : a.ordem) || 0;
          const ob = (b.ORDEM != null ? b.ORDEM : b.ordem) || 0;
          if (oa !== ob) return oa - ob;
          const sa = (a.SEQUENCIA != null ? a.SEQUENCIA : a.sequencia) || 0;
          const sb = (b.SEQUENCIA != null ? b.SEQUENCIA : b.sequencia) || 0;
          return sa - sb;
        })
        .map(p => ({
          lat: parseFloat(p.LATITUDE != null ? p.LATITUDE : p.latitude),
          lon: parseFloat(p.LONGITUDE != null ? p.LONGITUDE : p.longitude)
        }));
    }

    async function geometriaRotaCadastroRoteiro(pontos) {
      if (!pontos || pontos.length < 2) return null;
      const coordsStr = pontos.map(p => `${p.lon},${p.lat}`).join(';');
      let geo = await rotaGeometriaViaBackendProxy(coordsStr, 110000);
      if (geo && geo.length > 1) return geo;
      const merged = [];
      for (let i = 0; i < pontos.length - 1; i++) {
        const seg = `${pontos[i].lon},${pontos[i].lat};${pontos[i + 1].lon},${pontos[i + 1].lat}`;
        let leg = await rotaGeometriaViaBackendProxy(seg, 110000);
        if (!leg || leg.length < 2) {
          leg = [[pontos[i].lat, pontos[i].lon], [pontos[i + 1].lat, pontos[i + 1].lon]];
        }
        if (merged.length === 0) merged.push(...leg);
        else merged.push(...leg.slice(1));
      }
      return merged.length > 1 ? merged : null;
    }

    let pontosRoteiroOrdenados = [];
    if (dadosViagem && dadosViagem.IDROTEIRO) {
      try {
        const pr = await fetch(`/api/roteiros/${dadosViagem.IDROTEIRO}/pontos`, { headers: getAuthHeaders() });
        if (pr.ok) {
          const raw = await pr.json();
          pontosRoteiroOrdenados = ordenarPontosRoteiroRastreamento(raw);
          _log(`[RASTREAMENTO] Roteiro ${dadosViagem.IDROTEIRO}: ${pontosRoteiroOrdenados.length} paradas com coordenadas`);
        }
      } catch (e) {
        _log('[RASTREAMENTO] Pontos do roteiro:', e && e.message);
      }
    }

    /** Contorno escuro + linha viva (lê melhor sobre o mapa). */
    function addPolylineDuplaRastreamento(latlngs, estilo) {
      const g = L.layerGroup();
      const base = {
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
        dashArray: estilo.dashArray || null
      };
      L.polyline(latlngs, {
        ...base,
        color: estilo.outline || '#0f172a',
        weight: (estilo.weight || 5) + 4,
        opacity: 0.88
      }).addTo(g);
      L.polyline(latlngs, {
        ...base,
        color: estilo.color,
        weight: estilo.weight || 5,
        opacity: estilo.opacity != null ? estilo.opacity : 1
      }).addTo(g);
      g.addTo(mapaRastreamento);
      return g;
    }

    /** Paradas do roteiro ainda à frente da última posição GPS. */
    function waypointsRestantesAposGps(pontosRoteiro, ultimaLat, ultimaLon) {
      if (!pontosRoteiro || pontosRoteiro.length < 1) return [];
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < pontosRoteiro.length; i++) {
        const d = haversineKmRastreamento(
          [ultimaLat, ultimaLon],
          [pontosRoteiro[i].lat, pontosRoteiro[i].lon]
        );
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      // < 2 km do ponto → considera visitado e parte do próximo
      const start = bestD < 2 ? bestIdx + 1 : bestIdx;
      return pontosRoteiro.slice(Math.min(start, pontosRoteiro.length));
    }

    // 1) Rota cadastrada (planejada) — primeiro, por baixo
    // 2) O que ainda falta — laranja
    // 3) Já percorrido (GPS) — verde por cima
    let coordsOrigem = null;
    let coordsDestino = null;
    let todasCoordenadas = [...coordenadas];

    const podeRoteiroMapa = pontosRoteiroOrdenados && pontosRoteiroOrdenados.length >= 2;
    const podeGeocodeCidades = dadosViagem && dadosViagem.ORIGEM_CIDADE && dadosViagem.DESTINO_CIDADE;

    if (dadosViagem && (podeRoteiroMapa || podeGeocodeCidades)) {
      try {
        if (podeRoteiroMapa) {
          coordsOrigem = { lat: pontosRoteiroOrdenados[0].lat, lon: pontosRoteiroOrdenados[0].lon };
          const ultP = pontosRoteiroOrdenados[pontosRoteiroOrdenados.length - 1];
          coordsDestino = { lat: ultP.lat, lon: ultP.lon };
          todasCoordenadas.push([coordsOrigem.lat, coordsOrigem.lon]);
          todasCoordenadas.push([coordsDestino.lat, coordsDestino.lon]);

          let routeCoords = await geometriaRotaCadastroRoteiro(pontosRoteiroOrdenados);
          if (!routeCoords || routeCoords.length < 2) {
            routeCoords = pontosRoteiroOrdenados.map((p) => [p.lat, p.lon]);
          }
          if (routeCoords && routeCoords.length > 1) {
            linhaRotaPlanejada = addPolylineDuplaRastreamento(routeCoords, {
              color: '#64748b',
              outline: '#1e293b',
              weight: 3,
              opacity: 0.55,
              dashArray: '10, 8'
            });
            _log(`✅ [MAPA RASTREAMENTO] Rota cadastrada (${routeCoords.length} pts)`);
          }

          // Marcadores numerados das paradas do roteiro (sequência)
          if (window.AtlasRoteiroMapMarkers && typeof window.AtlasRoteiroMapMarkers.addPontosMarkers === 'function') {
            const ptsAtlas = pontosRoteiroOrdenados.map((p, i) => ({
              LATITUDE: p.lat,
              LONGITUDE: p.lon,
              DSLOCAL: `Parada ${i + 1}`,
              DSPOSICAO: '',
              TPLOCAL: i === 0 ? 'O' : i === pontosRoteiroOrdenados.length - 1 ? 'D' : 'P',
              ORDEM: i + 1
            }));
            const resM = window.AtlasRoteiroMapMarkers.addPontosMarkers(mapaRastreamento, ptsAtlas);
            marcadoresParadaRoteiroRastreamento = resM.markers || [];
          } else {
            pontosRoteiroOrdenados.forEach((p, i) => {
              const isO = i === 0;
              const isD = i === pontosRoteiroOrdenados.length - 1;
              const cor = isO ? '#2ecc71' : isD ? '#e74c3c' : '#3498db';
              const m = L.marker([p.lat, p.lon], {
                icon: L.divIcon({
                  className: 'custom-marker marcador-rastreamento-seq',
                  html: `<div style="background:${cor};width:28px;height:28px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:800 12px/1 system-ui;color:#fff;">${i + 1}</div>`,
                  iconSize: [28, 28],
                  iconAnchor: [14, 14]
                }),
                zIndexOffset: 300 + i
              }).addTo(mapaRastreamento);
              marcadoresParadaRoteiroRastreamento.push(m);
            });
          }
        } else {
          const origemEstado = (dadosViagem.ORIGEM_ESTADO || '').trim();
          const destinoEstado = (dadosViagem.DESTINO_ESTADO || '').trim();
          const origemCidade = (dadosViagem.ORIGEM_CIDADE || '').trim();
          const destinoCidade = (dadosViagem.DESTINO_CIDADE || '').trim();

          const [coordsOrigemTemp, coordsDestinoTemp] = await Promise.all([
            obterCoordenadasCidade(origemCidade, origemEstado),
            obterCoordenadasCidade(destinoCidade, destinoEstado)
          ]);

          if (coordsOrigemTemp && coordsDestinoTemp) {
            coordsOrigem = coordsOrigemTemp;
            coordsDestino = coordsDestinoTemp;
            todasCoordenadas.push([coordsOrigem.lat, coordsOrigem.lon]);
            todasCoordenadas.push([coordsDestino.lat, coordsDestino.lon]);

            const coordsStr = `${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}`;
            let routeCoords = await rotaGeometriaViaBackendProxy(coordsStr, 110000);
            if (!routeCoords || routeCoords.length < 2) {
              routeCoords = [
                [coordsOrigem.lat, coordsOrigem.lon],
                [coordsDestino.lat, coordsDestino.lon]
              ];
            }
            linhaRotaPlanejada = addPolylineDuplaRastreamento(routeCoords, {
              color: '#64748b',
              outline: '#1e293b',
              weight: 3,
              opacity: 0.55,
              dashArray: '10, 8'
            });
          }
        }
      } catch (err) {
        console.error('❌ [MAPA RASTREAMENTO] Erro ao obter coordenadas:', err);
      }
    } else if (dadosViagem) {
      console.warn(`⚠️ [MAPA RASTREAMENTO] Sem roteiro com paradas GPS nem cidade origem/destino para traçado planejado`);
    }

    // O que ainda falta: última posição GPS → paradas restantes do roteiro → destino
    if (coordenadas.length > 0 && coordsDestino) {
      const ultimaLat = coordenadas[coordenadas.length - 1][0];
      const ultimaLon = coordenadas[coordenadas.length - 1][1];
      try {
        const restantes = waypointsRestantesAposGps(pontosRoteiroOrdenados, ultimaLat, ultimaLon);
        const ptsRestantes = [{ lat: ultimaLat, lon: ultimaLon }];
        restantes.forEach((p) => {
          const last = ptsRestantes[ptsRestantes.length - 1];
          if (haversineKmRastreamento([last.lat, last.lon], [p.lat, p.lon]) > 0.05) {
            ptsRestantes.push({ lat: p.lat, lon: p.lon });
          }
        });
        const destLast = ptsRestantes[ptsRestantes.length - 1];
        if (
          haversineKmRastreamento(
            [destLast.lat, destLast.lon],
            [coordsDestino.lat, coordsDestino.lon]
          ) > 0.08
        ) {
          ptsRestantes.push({ lat: coordsDestino.lat, lon: coordsDestino.lon });
        }

        if (ptsRestantes.length >= 2) {
          let geoRest = await geometriaRotaCadastroRoteiro(ptsRestantes);
          if (!geoRest || geoRest.length < 2) {
            geoRest = ptsRestantes.map((p) => [p.lat, p.lon]);
          }
          geoRest[0] = [ultimaLat, ultimaLon];
          linhaRotaRestante = addPolylineDuplaRastreamento(geoRest, {
            color: '#ea580c',
            outline: '#7c2d12',
            weight: 5,
            opacity: 1,
            dashArray: '12, 8'
          });
          linhaRotaRestante.eachLayer((ly) => {
            if (ly.bindPopup) {
              ly.bindPopup(
                `<div style="min-width:200px;font:600 13px/1.4 system-ui"><strong style="color:#ea580c">Ainda falta percorrer</strong><br>Da posição atual até o destino${restantes.length ? ` · ${restantes.length} parada(s) à frente` : ''}</div>`
              );
            }
          });
          _log(`✅ [MAPA RASTREAMENTO] Rota restante (${geoRest.length} pts, ${restantes.length} paradas à frente)`);
        }
      } catch (osrmErr) {
        console.warn('Erro ao calcular rota restante:', osrmErr);
        linhaRotaRestante = addPolylineDuplaRastreamento(
          [[ultimaLat, ultimaLon], [coordsDestino.lat, coordsDestino.lon]],
          { color: '#ea580c', outline: '#7c2d12', weight: 5, opacity: 0.95, dashArray: '12, 8' }
        );
      }
    }

    // Já percorrido (GPS) — verde vivo por cima
    // Liga os pings GPS pelas estradas (OSRM), não em linha reta no mapa.
    // Com poucos pings (ex.: só início + atual) a reta “corta” a cidade; o snap segue as vias.
    if (coordenadas.length > 1) {
      if (linhaRastreamento) {
        try { mapaRastreamento.removeLayer(linhaRastreamento); } catch (e) { /* ignore */ }
      }

      /** Amostra waypoints GPS para o OSRM (limite de URL / waypoints), mantendo 1º e último. */
      function amostrarWaypointsGpsParaOsrm(coords, maxPts) {
        const max = Math.max(2, maxPts || 40);
        if (!coords || coords.length <= max) {
          return (coords || []).map((c) => ({ lat: c[0], lon: c[1] }));
        }
        const out = [{ lat: coords[0][0], lon: coords[0][1] }];
        const mid = max - 2;
        for (let i = 1; i <= mid; i++) {
          const idx = Math.round((i * (coords.length - 1)) / (mid + 1));
          out.push({ lat: coords[idx][0], lon: coords[idx][1] });
        }
        const last = coords[coords.length - 1];
        const prev = out[out.length - 1];
        if (prev.lat !== last[0] || prev.lon !== last[1]) {
          out.push({ lat: last[0], lon: last[1] });
        }
        return out;
      }

      let geoPercorrido = null;
      try {
        const ptsOsrm = amostrarWaypointsGpsParaOsrm(coordenadas, 40);
        if (ptsOsrm.length >= 2) {
          geoPercorrido = await geometriaRotaCadastroRoteiro(ptsOsrm);
        }
      } catch (eOsrmGps) {
        _log('[RASTREAMENTO] OSRM trajeto percorrido:', eOsrmGps && eOsrmGps.message);
      }
      if (!geoPercorrido || geoPercorrido.length < 2) {
        // Fallback: polyline dos pontos GPS (pode parecer “reta” se só houver 2 pings)
        geoPercorrido = coordenadas;
        _log(`⚠️ [MAPA RASTREAMENTO] Percorrido sem OSRM — polyline bruta (${coordenadas.length} pts GPS)`);
      } else {
        _log(`✅ [MAPA RASTREAMENTO] Percorrido via estradas (${geoPercorrido.length} pts geom, ${coordenadas.length} GPS)`);
      }

      linhaRastreamento = addPolylineDuplaRastreamento(geoPercorrido, {
        color: '#059669',
        outline: '#064e3b',
        weight: 6,
        opacity: 1
      });
      linhaRastreamento.eachLayer((ly) => {
        if (ly.bindPopup) {
          ly.bindPopup(
            `<div style="min-width:200px;font:600 13px/1.4 system-ui"><strong style="color:#059669">Já percorrido</strong><br>Trajeto GPS nas vias · ${coordenadas.length} posição(ões)</div>`
          );
        }
      });
    }

    // Marcadores origem / destino (fallback se Atlas não desenhou)
    if (coordsOrigem && coordsDestino && dadosViagem && marcadoresParadaRoteiroRastreamento.length === 0) {
      marcadorOrigemRastreamento = L.marker([coordsOrigem.lat, coordsOrigem.lon], {
        icon: L.divIcon({
          className: 'custom-marker origem-rastreamento',
          html: '<div style="background:#2ecc71;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:800;border:3px solid #0f172a;box-shadow:0 2px 8px rgba(0,0,0,.4);font-size:14px;">O</div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        }),
        zIndexOffset: 700
      }).addTo(mapaRastreamento)
        .bindPopup(`<strong>Origem</strong><br>${dadosViagem.ORIGEM_CIDADE || ''}, ${dadosViagem.ORIGEM_ESTADO || ''}`);

      marcadorDestinoRastreamento = L.marker([coordsDestino.lat, coordsDestino.lon], {
        icon: L.divIcon({
          className: 'custom-marker destino-rastreamento',
          html: '<div style="background:#e74c3c;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:800;border:3px solid #0f172a;box-shadow:0 2px 8px rgba(0,0,0,.4);font-size:14px;">D</div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        }),
        zIndexOffset: 700
      }).addTo(mapaRastreamento)
        .bindPopup(`<strong>Destino</strong><br>${dadosViagem.DESTINO_CIDADE || ''}, ${dadosViagem.DESTINO_ESTADO || ''}`);
    }

    // Marcadores GPS: sequência (primeira / intermediárias amostradas / atual)
    const totalGps = posicoesOrdenadas.length;
    const maxMarcadoresGps = 24;
    const stepGps = totalGps > maxMarcadoresGps ? Math.ceil(totalGps / maxMarcadoresGps) : 1;
    posicoesOrdenadas.forEach((pos, index) => {
      const isPrimeira = index === 0;
      const isUltima = index === totalGps - 1;
      if (!isPrimeira && !isUltima && index % stepGps !== 0) return;

      const lat = parseFloat(pos.LATITUDE);
      const lng = parseFloat(pos.LONGITUDE);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const data = new Date(pos.DHREGISTRO || pos.DHPOSICAO);
      const velocidade = pos.VELOCIDADE ? `${parseFloat(pos.VELOCIDADE).toFixed(0)} km/h` : '—';

      let htmlIcon;
      let size = 26;
      let z = 400 + index;
      if (isUltima) {
        size = 40;
        z = 900;
        htmlIcon = `<div title="Posição atual" style="background:#dc2626;width:${size}px;height:${size}px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 12px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">🚚</div>`;
      } else if (isPrimeira) {
        size = 30;
        z = 650;
        htmlIcon = `<div title="Primeiro GPS" style="background:#059669;width:${size}px;height:${size}px;border-radius:50%;border:3px solid #0f172a;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font:800 12px/1 system-ui;">1</div>`;
      } else {
        htmlIcon = `<div title="GPS #${index + 1}" style="background:#2563eb;width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font:700 11px/1 system-ui;">${index + 1}</div>`;
      }

      const marcador = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'marcador-rastreamento marcador-rastreamento-seq',
          html: htmlIcon,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        }),
        zIndexOffset: z
      }).addTo(mapaRastreamento);

      marcador.bindPopup(`
        <div style="min-width:210px;font:400 13px/1.45 system-ui">
          <strong>${isPrimeira ? 'Início do rastreamento' : isUltima ? 'Posição atual' : `Ponto GPS #${index + 1}`}</strong><br>
          <span style="color:#64748b">${fmtDataHora(data)}</span><br>
          Velocidade: ${velocidade}<br>
          <small style="font-family:ui-monospace,monospace">${lat.toFixed(6)}, ${lng.toFixed(6)}</small>
        </div>
      `);

      marcadoresRastreamento.push(marcador);
    });

    // Ajustar zoom para mostrar toda a rota (GPS + origem/destino)
    if (todasCoordenadas.length > 0) {
      try {
        const b = L.latLngBounds(todasCoordenadas);
        if (b.isValid()) {
          mapaRastreamento.fitBounds(b.pad(0.12), { maxZoom: 15, animate: true });
        }
      } catch (_) { /* ignore */ }

      setTimeout(() => {
        if (mapaRastreamento) {
          mapaRastreamento.invalidateSize();
        }
      }, 120);
    }
    
    // Esconder overlay após finalizar mapa (com pequeno delay para garantir que tudo foi renderizado)
    setTimeout(() => {
      hideRastreamentoLoading();
    }, 300);
    } catch (err) {
      console.error('❌ [RASTREAMENTO] Erro ao exibir mapa:', err);
      // Esconder overlay em caso de erro
      hideRastreamentoLoading();
    } finally {
      // Sempre resetar a flag, mesmo em caso de erro
      mapaRastreamentoInicializando = false;
    }
  }

  // Exibir lista de posições
  function exibirListaPosicoes(posicoes) {
    const lista = document.getElementById('listaPosicoes');
    if (!lista) return;

    if (!posicoes || posicoes.length === 0) {
      lista.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Nenhuma posição encontrada.</p>';
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
    
    // Ordenar do mais recente para o mais antigo
    const posicoesOrdenadas = [...posicoes].reverse();

    posicoesOrdenadas.forEach((pos, index) => {
      const data = new Date(pos.DHREGISTRO);
      const velocidade = pos.VELOCIDADE ? parseFloat(pos.VELOCIDADE).toFixed(0) : '0';
      const isUltima = index === 0;
      const isPrimeira = index === posicoesOrdenadas.length - 1;

      let corBorda = '#dee2e6';
      let corFundo = '#ffffff';
      if (isUltima) {
        corBorda = '#e74c3c';
        corFundo = '#fff5f5';
      } else if (isPrimeira) {
        corBorda = '#27ae60';
        corFundo = '#f0fff4';
      }

      html += `
        <div style="background: ${corFundo}; border: 1px solid ${corBorda}; border-left: 4px solid ${corBorda}; border-radius: 6px; padding: 12px; cursor: pointer; transition: all 0.2s;"
             onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'; this.style.transform='translateX(2px)';"
             onmouseout="this.style.boxShadow='none'; this.style.transform='translateX(0)';"
             onclick="if(window.mapaRastreamento){ window.mapaRastreamento.setView([${parseFloat(pos.LATITUDE)}, ${parseFloat(pos.LONGITUDE)}], 15); }">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">
                ${isUltima ? '🏁 Última' : isPrimeira ? '📍 Primeira' : `📍 #${posicoes.length - index}`}
              </div>
              <div style="font-size: 12px; color: #6c757d;">
                ${fmtDataHora(pos.DHREGISTRO)}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 600; color: #667eea; font-size: 14px;">${velocidade} km/h</div>
            </div>
          </div>
          <div style="font-size: 11px; color: #95a5a6; margin-top: 4px;">
            ${parseFloat(pos.LATITUDE).toFixed(6)}, ${parseFloat(pos.LONGITUDE).toFixed(6)}
            ${pos.PRECISAO ? ` • ${pos.PRECISAO}m` : ''}
          </div>
        </div>
      `;
    });

    html += '</div>';
    lista.innerHTML = html;

    // Expor variáveis globalmente para uso no onclick
    window.mapaRastreamento = mapaRastreamento;
    window.marcadoresRastreamento = marcadoresRastreamento;
  }

  // Mostrar mensagem na aba de rastreamento
  function mostrarMensagemRastreamento(mensagem, tipo = 'info') {
    if (message) {
      message.textContent = mensagem;
      message.className = `message ${tipo}`;
      message.style.display = 'block';
      setTimeout(() => {
        message.style.display = 'none';
      }, 5000);
    }
  }

  // ==========================================
  // FUNÇÕES GLOBAIS PARA WEBSOCKET TORRE
  // Mapear eventos WebSocket para atualizações de UI
  // ==========================================

  /**
   * Atualizar posição GPS no mapa quando evento WebSocket chega
   * @param {number} idviagem - ID da viagem
   * @param {object} posicao - Dados da posição GPS
   */
  window.atualizarPosicaoGPS = async function(idviagem, posicao) {
    try {
      // Se estivermos na aba de rastreamento e a viagem for a mesma
      const abaAtiva = document.querySelector('.tab-content.active');
      if (abaAtiva && abaAtiva.id === 'rastreamento') {
        const viagemSelecionada = abaAtiva.getAttribute('data-idviagem') || 
                                 document.getElementById('rastreamentoIdViagem')?.textContent;
        
        if (viagemSelecionada && parseInt(viagemSelecionada) === parseInt(idviagem)) {
          // Recarregar posições para atualizar o mapa
          await carregarPosicoesRastreamento(idviagem);
          _log('📍 Posição GPS atualizada via WebSocket');
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar posição GPS:', err);
    }
  };

  /**
   * Atualizar dados da viagem quando evento WebSocket chega
   * @param {number} idviagem - ID da viagem
   * @param {object} viagem - Dados atualizados da viagem
   */
  window.atualizarDadosViagem = async function(idviagem, viagem) {
    try {
      // Se estivermos vendo esta viagem, recarregar detalhes
      const viagemSelecionada = lastViagens?.find(v => v.IDVIAGEM == idviagem);
      
      if (viagemSelecionada) {
        // Atualizar dados no objeto lastViagens
        Object.assign(viagemSelecionada, viagem);
        
        // Se estivermos na aba de detalhes ou na aba Dados (Editar Viagem) desta viagem, atualizar
      const abaAtiva = document.querySelector('.tab-content.active');
      const idViagemAtual = (abaAtiva && abaAtiva.getAttribute('data-idviagem')) || document.getElementById('viagemId')?.value || document.getElementById('viagemIdViagem')?.value;
      if (idViagemAtual && parseInt(idViagemAtual) === parseInt(idviagem)) {
        if (abaAtiva && abaAtiva.id === 'tab-dados') {
          // Aba Editar Viagem: atualizar situação e CDSITUACAOVIAGEM para refletir Programada etc.
          const selSitViagem = document.getElementById('viagemSituacaoViagem');
          const selSit = document.getElementById('viagemSituacao');
          if (viagem.FGSITVIAGEM && selSitViagem) {
            selSitViagem.value = String(viagem.FGSITVIAGEM).trim();
            if (!selSitViagem.querySelector('option[value="' + selSitViagem.value + '"]')) {
              const opt = document.createElement('option');
              opt.value = selSitViagem.value;
              opt.textContent = viagem.DSSITUACAOVIAGEM || viagem.FGSITVIAGEM || 'Programada';
              selSitViagem.appendChild(opt);
            }
          }
          if (viagem.CDSITUACAOVIAGEM != null && selSit) {
            selSit.value = String(viagem.CDSITUACAOVIAGEM);
            if (!selSit.querySelector('option[value="' + selSit.value + '"]')) {
              const opt = document.createElement('option');
              opt.value = selSit.value;
              opt.textContent = viagem.DSSITUACAOVIAGEM || selSit.value;
              selSit.appendChild(opt);
            }
          }
          _log('🔄 Situação da viagem atualizada no formulário (WebSocket)');
        } else if (abaAtiva && abaAtiva.id === 'detalhes') {
          // Recarregar detalhes da viagem
          if (typeof carregarDetalhesViagem === 'function') {
            await carregarDetalhesViagem(idviagem);
          } else {
            try {
              const response = await fetchApiViagens(`/${idviagem}`);
              if (response.ok) {
                const dados = await response.json();
                if (dados.IDVIAGEM) {
                  Object.keys(dados).forEach(key => {
                    const field = document.getElementById(key);
                    if (field) field.value = dados[key] || '';
                  });
                }
              }
            } catch (err) {
              console.warn('Erro ao recarregar detalhes:', err);
            }
          }
          _log('🔄 Dados da viagem atualizados via WebSocket');
        }
      }
        
        // Se estivermos no grid, atualizar o card da viagem
        if (gridTab && typeof window.GridEditor !== 'undefined') {
          atualizarCardViagemNoGrid(idviagem, viagem);
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar dados da viagem:', err);
    }
  };

  /**
   * Atualizar card da viagem no grid
   */
  function atualizarCardViagemNoGrid(idviagem, novosDados) {
    if (!gridTab || typeof window.GridEditor === 'undefined') return;
    
    try {
      // Usar o método updateRow da instância do grid (método público do GridEditor)
      if (gridTab.updateRow && typeof gridTab.updateRow === 'function') {
        // Atualizar dados no grid usando o método da instância
        gridTab.updateRow(idviagem, novosDados);
        
        // Adicionar indicador visual de atualização recente
        const rowElement = gridTab.container?.querySelector(`[data-grid-id="${idviagem}"]`);
        if (rowElement) {
          rowElement.style.backgroundColor = '#e8f5e9';
          setTimeout(() => {
            rowElement.style.backgroundColor = '';
          }, 2000);
        }
      } else {
        // Fallback: encontrar linha manualmente e atualizar células
        const rowElement = gridTab.container?.querySelector(`[data-grid-id="${idviagem}"]`);
        if (rowElement) {
          // Atualizar células relevantes manualmente
          Object.keys(novosDados).forEach(key => {
            const cell = rowElement.querySelector(`[data-field="${key}"]`);
            if (cell) {
              // Atualizar conteúdo da célula usando formatação do grid
              const col = gridTab.columns?.find(c => c.field === key);
              if (col && gridTab.formatCellValue) {
                const formattedValue = gridTab.formatCellValue(novosDados[key], col);
                const cellValue = cell.querySelector('.cell-value');
                if (cellValue) {
                  cellValue.textContent = formattedValue;
                } else {
                  cell.textContent = formattedValue;
                }
              } else {
                const cellValue = cell.querySelector('.cell-value');
                if (cellValue) {
                  cellValue.textContent = String(novosDados[key] || '');
                } else {
                  cell.textContent = String(novosDados[key] || '');
                }
              }
            }
          });
          
          // Adicionar indicador visual
          rowElement.style.backgroundColor = '#e8f5e9';
          setTimeout(() => {
            rowElement.style.backgroundColor = '';
          }, 2000);
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar card no grid:', err);
    }
  }

  /**
   * Adicionar novo alerta quando evento WebSocket chega
   * @param {object} alerta - Dados do alerta
   */
  window.adicionarAlerta = async function(alerta) {
    try {
      // Aba de alertas foi removida - apenas mostrar notificação
      if (alerta.SEVERITY === 'high') {
        showMessage(`⚠️ Novo alerta crítico: ${alerta.MESSAGE || 'Alerta importante'}`, 'warning');
      }
      _log('⚠️ Novo alerta recebido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar alerta:', err);
    }
  };

  /**
   * Remover alerta resolvido quando evento WebSocket chega
   * @param {number} idAlerta - ID do alerta resolvido
   */
  window.removerAlerta = async function(idAlerta) {
    try {
      // Aba de alertas foi removida - apenas log
      _log('✅ Alerta resolvido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar remoção de alerta:', err);
    }
  };

  /**
   * Notificar SOS quando evento WebSocket chega
   * @param {object} sos - Dados do alerta SOS
   */
  window.notificarSOS = function(sos) {
    try {
      // Mostrar notificação urgente
      showMessage(`🆘 ALERTA SOS: ${sos.NOME_MOTORISTA || 'Motorista'} - Viagem ${sos.CDVIAGEM || ''}`, 'error');
      
      // Tocar som de alerta (se permitido)
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBzSL0fPTgjMGHm7A7+OZURA');
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Ignorar erro se autoplay não for permitido
        });
      } catch (e) {
        // Ignorar erro de áudio
      }
      
      _log('🆘 Alerta SOS recebido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao notificar SOS:', err);
    }
  };

  /**
   * Atualizar reputação do motorista quando evento WebSocket chega
   * @param {number} cdmotorista - ID do motorista
   * @param {object} reputacao - Dados da reputação
   */
  window.atualizarReputacaoMotorista = async function(cdmotorista, reputacao) {
    try {
      // Aba de ranking foi removida - apenas log
      _log('⭐ Reputação atualizada via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar atualização de reputação:', err);
    }
  };

  /**
   * Atualizar grid de viagens quando evento WebSocket chega
   * @param {array} viagens - Lista atualizada de viagens
   */
  window.atualizarGridViagens = function(viagens) {
    try {
      // Se estivermos no grid, atualizar dados
      const abaAtiva = document.querySelector('.tab-content.active');
      if (abaAtiva && abaAtiva.id === 'grid') {
        // Atualizar lastViagens
        lastViagens = viagens;
        
        // Atualizar grid se estiver visível
        if (gridTab && typeof window.GridEditor !== 'undefined') {
          // Recarregar grid (pode ser custoso, então apenas se necessário)
          _log('📋 Grid de viagens atualizado via WebSocket');
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar grid:', err);
    }
  };

  /**
   * Acompanhar viagem automaticamente quando abrir detalhes/mapa
   * Chamar esta função quando uma viagem for selecionada
   */
  window.ativarAcompanhamentoViagem = function(idviagem) {
    if (typeof window.WebSocketTorre !== 'undefined' && idviagem) {
      window.WebSocketTorre.acompanharViagem(idviagem);
    }
  };

  /**
   * Parar de acompanhar viagem
   * Chamar esta função quando sair da viagem
   */
  window.desativarAcompanhamentoViagem = function(idviagem) {
    if (typeof window.WebSocketTorre !== 'undefined' && idviagem) {
      window.WebSocketTorre.pararAcompanharViagem(idviagem);
    }
  };

  // Funções globais de atualização UI (WebSocket Torre) carregadas

  // Função para mostrar ajuda
  // Função de ajuda
  window.mostrarAjudaViagens = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaViagens');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaViagens';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Viagens</h3>
          <button onclick="window.fecharModalAjudaViagens()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Viagens</strong> permite gerenciar todas as viagens do sistema, incluindo criação, edição, convocações, rastreamento e integração com plataformas externas.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar viagens específicas por ID, tipo, situação, classe de frota, contratador, origem, destino, datas e status.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar viagens por diversos critérios</li>
            <li><strong>Grid:</strong> Visualizar todas as viagens em formato de tabela editável com ordenação e filtros</li>
            <li><strong>Dados:</strong> Criar ou editar viagens, definindo origem, destino, roteiro, distância, valores e configurações</li>
            <li><strong>Histórico:</strong> Consultar o histórico completo de viagens com filtros avançados</li>
            <li><strong>Mapa:</strong> Visualizar a rota da viagem no mapa com pontos de origem e destino</li>
            <li><strong>Compatíveis:</strong> Encontrar motoristas compatíveis para a viagem selecionada</li>
            <li><strong>Convocações:</strong> Criar e gerenciar convocações para motoristas, com envio via WhatsApp</li>
            <li><strong>Veículo:</strong> Associar veículos às viagens com busca por placa ou código</li>
            <li><strong>Motorista:</strong> Associar motoristas às viagens com busca por CPF, nome ou código</li>
            <li><strong>Rastreamento:</strong> Acompanhar a localização em tempo real do veículo/motorista</li>
            <li><strong>Integração Switch Digital:</strong> Histórico de envios de convocações por WhatsApp</li>
          </ul>
          
          <h4>🚛 Convocações</h4>
          <ul>
            <li>Selecione uma viagem e encontre motoristas compatíveis</li>
            <li>Crie convocações e envie automaticamente via WhatsApp</li>
            <li>Acompanhe o status das convocações (Pendente, Aceita, Confirmada, etc.)</li>
            <li>Confirme convocações aceitas e reative quando necessário</li>
          </ul>
          
          <h4>📏 Cálculo de Distância</h4>
          <ul>
            <li>O sistema calcula automaticamente a distância usando pontos do roteiro ou rota real (OSRM)</li>
            <li>É possível recalcular manualmente clicando no botão "Calcular Distância"</li>
            <li>A distância pode ser calculada pela rota real ou aproximada (linha reta)</li>
          </ul>
          
          <h4>🗺️ Visualização no Mapa</h4>
          <ul>
            <li>Visualize a rota completa da viagem no mapa</li>
            <li>Veja pontos de origem e destino marcados</li>
            <li>Calcule distâncias e visualize o percurso</li>
          </ul>
          
          <h4>⚡ Rastreamento em Tempo Real</h4>
          <ul>
            <li>O sistema utiliza WebSocket para atualizações em tempo real</li>
            <li>Acompanhe a localização do veículo/motorista durante a viagem</li>
            <li>Receba alertas e notificações automáticas</li>
          </ul>
          
          <h4><i class="bx bx-bulb" style="vertical-align: middle;"></i> Dicas</h4>
          <ul>
            <li>Para criar uma nova viagem, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar uma viagem existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Após criar uma viagem, use a aba "Compatíveis" para encontrar motoristas adequados</li>
            <li>Use a aba "Convocações" para enviar convites aos motoristas via WhatsApp</li>
            <li>A aba "Rastreamento" permite acompanhar a viagem em tempo real</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaViagens()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaViagens = function() {
    const modal = document.getElementById('modalAjudaViagens');
    if (modal) {
      modal.remove();
    }
  };

  // ==========================================
  // ABA MACROS - Carregar e exibir macros da viagem
  // ==========================================
  async function carregarMacrosViagem() {
    const container = document.getElementById('macrosLista');
    const idViagemEl = document.getElementById('macrosIdViagem');
    const totalMacrosEl = document.getElementById('totalMacrosViagem');
    
    if (!container) return;

    // Buscar ID da viagem (várias fontes: filtro, formulário Dados, variável global)
    const idViagemRaw = document.getElementById('filtroIdViagem')?.value || 
                        document.getElementById('viagemId')?.value || 
                        document.getElementById('viagemIdViagem')?.value ||
                        (typeof viagemSelecionada !== 'undefined' && viagemSelecionada != null ? String(viagemSelecionada) : null);
    const idViagem = (idViagemRaw && String(idViagemRaw).trim() !== '') ? String(idViagemRaw).trim() : null;

    if (!idViagem || idViagem.trim() === '') {
      container.innerHTML = `
        <div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
          <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
          <h3 style="color: #856404; margin-bottom: 10px;">Nenhuma viagem selecionada</h3>
          <p style="color: #856404; margin: 0;">
            Selecione uma viagem na aba <strong>Dados</strong> ou <strong>Grid</strong> para visualizar as macros.
          </p>
        </div>
      `;
      if (idViagemEl) idViagemEl.textContent = '-';
      if (totalMacrosEl) totalMacrosEl.textContent = '0';
      return;
    }

    // Atualizar ID da viagem
    if (idViagemEl) idViagemEl.textContent = idViagem;

    // Mostrar loading
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #6c757d;">
        <div style="font-size: 48px; margin-bottom: 15px;">⏳</div>
        <p>Carregando macros da viagem...</p>
      </div>
    `;

    try {
      const response = await fetchApiAbsPath(`/api/motorista/historico-macros/${encodeURIComponent(idViagem)}`, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const macros = await response.json();

      // Atualizar total
      if (totalMacrosEl) totalMacrosEl.textContent = macros.length || 0;

      if (!macros || macros.length === 0) {
        container.innerHTML = `
          <div style="color: #6c757d; text-align: center; padding: 40px;">
            <div style="font-size: 48px; margin-bottom: 15px;">📝</div>
            <p>Nenhuma macro registrada para esta viagem.</p>
          </div>
        `;
        return;
      }

      // Formatar e exibir macros
      const html = `
        <table class="macros-table" style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #495057;">Código</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #495057;">Descrição</th>
              <th style="padding: 12px; text-align: left; font-weight: 600; color: #495057;">Data/Hora</th>
              <th style="padding: 12px; text-align: center; font-weight: 600; color: #495057;">Foto</th>
              <th style="padding: 12px; text-align: center; font-weight: 600; color: #495057;">Localização</th>
              <th style="padding: 12px; text-align: center; font-weight: 600; color: #495057;">ID Sequencial</th>
            </tr>
          </thead>
          <tbody>
            ${macros.map(macro => {
              const dataHora = macro.DTOCORRENCIA ? fmtDataHora(macro.DTOCORRENCIA) : '-';
              const temFoto = macro.TEM_FOTO === 'S' || macro.DSFOTOBASE64 || macro.DSCAMINHOFOTO;
              const temGPS = macro.LATITUDE && macro.LONGITUDE;
              const idSequencial = macro.IDVIAGEM_OCORRENCIA || '-';
              
              return `
                <tr style="border-bottom: 1px solid #dee2e6; transition: background 0.2s;">
                  <td style="padding: 12px; color: #495057;">${macro.CDTIPOOCORRENCIA || '-'}</td>
                  <td style="padding: 12px; color: #495057; font-weight: 500;">${macro.DSTIPOOCORRENCIA || '-'}</td>
                  <td style="padding: 12px; color: #495057;">${dataHora}</td>
                  <td style="padding: 12px; text-align: center;">
                    ${temFoto ? `
                      <button class="btn btn-info btn-sm btn-ver-foto-macro" 
                              style="padding: 6px 12px; font-size: 12px; cursor: pointer;"
                              data-id="${idSequencial}"
                              data-foto-base64="${(macro.DSFOTOBASE64 || '').substring(0, 100)}"
                              data-caminho-foto="${macro.DSCAMINHOFOTO || ''}">
                        <i class='bx bx-image'></i> Ver Foto
                      </button>
                    ` : '<span style="color: #6c757d;">-</span>'}
                  </td>
                  <td style="padding: 12px; text-align: center;">
                    ${temGPS ? `
                      <button onclick="window.mostrarMapaMacro(${macro.LATITUDE}, ${macro.LONGITUDE}, ${JSON.stringify(macro.DSTIPOOCORRENCIA || 'Macro').replace(/\"/g, '&quot;')})" 
                              class="btn btn-primary btn-sm" 
                              style="padding: 6px 12px; font-size: 12px; cursor: pointer;">
                        <i class='bx bx-map'></i> Ver no Mapa
                      </button>
                    ` : '<span style="color: #6c757d;">-</span>'}
                  </td>
                  <td style="padding: 12px; text-align: center; color: #495057; font-weight: 500;">${idSequencial}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      container.innerHTML = html;

      // Forçar dark mode na lista/tabela de macros (evitar fundo branco)
      if (typeof aplicarDarkModeMacros === 'function') aplicarDarkModeMacros();

      // Adicionar event listeners para botões de foto
      container.querySelectorAll('.btn-ver-foto-macro').forEach(btn => {
        btn.addEventListener('click', () => {
          const idSequencial = btn.getAttribute('data-id');
          const caminhoFoto = btn.getAttribute('data-caminho-foto');
          
          // Buscar macro completa para obter foto base64
          const macro = macros.find(m => m.IDVIAGEM_OCORRENCIA == idSequencial);
          const fotoBase64 = macro ? (macro.DSFOTOBASE64 || null) : null;
          
          mostrarFotoMacro(idSequencial, fotoBase64, caminhoFoto);
        });
      });

    } catch (error) {
      console.error('Erro ao carregar macros:', error);
      container.innerHTML = `
        <div style="color: #dc3545; text-align: center; padding: 40px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px;">
          <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
          <h3 style="color: #721c24; margin-bottom: 10px;">Erro ao carregar macros</h3>
          <p style="color: #721c24; margin: 0;">${error.message || 'Erro desconhecido'}</p>
        </div>
      `;
      if (totalMacrosEl) totalMacrosEl.textContent = '0';
    }
  }

  // Função para mostrar foto da macro
  window.mostrarFotoMacro = function(idSequencial, fotoBase64, caminhoFoto) {
    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('modalFotoMacro');
    if (modalAnterior) {
      modalAnterior.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.id = 'modalFotoMacro';
    
    let imagemSrc = '';
    if (fotoBase64 && fotoBase64.trim() !== '' && fotoBase64 !== 'null') {
      // Se já começa com data:image, usar direto, senão adicionar prefixo
      if (fotoBase64.startsWith('data:image')) {
        imagemSrc = fotoBase64;
      } else {
        imagemSrc = `data:image/jpeg;base64,${fotoBase64}`;
      }
    } else if (caminhoFoto && caminhoFoto.trim() !== '' && caminhoFoto !== 'null') {
      imagemSrc = caminhoFoto;
    } else {
      alert('Foto não disponível para esta macro.');
      return;
    }

    modal.innerHTML = `
      <div class="modal-content-tratamento" style="max-width: 800px;">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-image'></i> Foto da Macro - ID: ${idSequencial}</h3>
          <button type="button" class="btn-close-modal" onclick="document.getElementById('modalFotoMacro').remove()">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento" style="text-align: center; padding: 20px;">
          <img src="${imagemSrc}" alt="Foto da Macro" style="max-width: 100%; max-height: 70vh; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" onerror="this.onerror=null; this.src=''; alert('Erro ao carregar imagem.');">
        </div>
        <div class="modal-footer-tratamento">
          <button type="button" onclick="document.getElementById('modalFotoMacro').remove()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  };

  // Função para mostrar mapa com localização da macro
  window.mostrarMapaMacro = function(latitude, longitude, descricao) {
    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('modalMapaMacro');
    if (modalAnterior) {
      // Remover mapa Leaflet se existir
      const mapaDivAnterior = document.getElementById('mapaMacro');
      if (mapaDivAnterior && mapaDivAnterior._leaflet_id && typeof L !== 'undefined') {
        try {
          const mapaAnterior = L.DomUtil.get(mapaDivAnterior);
          if (mapaAnterior) {
            mapaAnterior.remove();
          }
        } catch (e) {
          console.warn('Erro ao remover mapa anterior:', e);
        }
      }
      modalAnterior.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.id = 'modalMapaMacro';
    
    const descricaoEscapada = (descricao || 'Macro').replace(/'/g, "\\'");
    
    modal.innerHTML = `
      <div class="modal-content-tratamento" style="max-width: 900px; max-height: 90vh;">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-map'></i> Localização da Macro: ${descricaoEscapada}</h3>
          <button type="button" class="btn-close-modal" onclick="document.getElementById('modalMapaMacro').remove()">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento" style="padding: 20px;">
          <div id="mapaMacro" style="width: 100%; height: 500px; border-radius: 8px; border: 1px solid #dee2e6;"></div>
          <div class="modal-macro-coords">
            <strong>Coordenadas:</strong> ${latitude}, ${longitude}
          </div>
        </div>
        <div class="modal-footer-tratamento">
          <button type="button" onclick="document.getElementById('modalMapaMacro').remove()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Leaflet é carregado sob demanda (não assume L global ao abrir o módulo no dashboard).
    void (async () => {
      const okLeaflet = await aguardarLeaflet();
      await new Promise((r) => setTimeout(r, 50));
      if (!document.getElementById('modalMapaMacro')) return;
      const mapaDiv = document.getElementById('mapaMacro');
      if (!mapaDiv) {
        console.error('Elemento #mapaMacro não encontrado após abrir o modal');
        if (typeof showMessage === 'function') showMessage('Erro ao montar o mapa. Tente fechar e abrir de novo.', 'error');
        return;
      }
      if (!okLeaflet || typeof L === 'undefined') {
        console.error('Leaflet não está disponível após tentativa de carregamento');
        if (typeof showMessage === 'function') showMessage('Leaflet não está disponível (rede bloqueada?). Recarregue a página ou libere unpkg.com.', 'error');
        else alert('Erro: Leaflet não carregou. Verifique rede/firewall.');
        return;
      }
      if (mapaDiv._leaflet_id) {
        mapaDiv.innerHTML = '';
        delete mapaDiv._leaflet_id;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 150));
      try {
        const mapa = L.map('mapaMacro').setView([parseFloat(latitude), parseFloat(longitude)], 15);

        let tileUrl = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
        let tileAttribution = '&copy; OpenStreetMap contributors';
        let maxZ = 19;
        if (typeof window.getTileLayerConfig === 'function') {
          const tc = window.getTileLayerConfig();
          if (tc && tc.url) {
            tileUrl = tc.url;
            if (tc.attribution) tileAttribution = tc.attribution;
            if (tc.maxZoom) maxZ = tc.maxZoom;
          }
        } else if (typeof window.getTileServerUrl === 'function') {
          tileUrl = window.getTileServerUrl();
          if (window.MAP_CONFIG && window.MAP_CONFIG.attribution) tileAttribution = window.MAP_CONFIG.attribution;
          if (window.MAP_CONFIG && window.MAP_CONFIG.maxZoom) maxZ = window.MAP_CONFIG.maxZoom;
        } else if (window.MAP_CONFIG && window.MAP_CONFIG.tileServer) {
          tileUrl = window.MAP_CONFIG.tileServer;
          if (window.MAP_CONFIG.attribution) tileAttribution = window.MAP_CONFIG.attribution;
          if (window.MAP_CONFIG.maxZoom) maxZ = window.MAP_CONFIG.maxZoom;
        }
        const tileOpts = { maxZoom: maxZ, attribution: tileAttribution };
        if (tileUrl.includes('{s}')) tileOpts.subdomains = ['a', 'b', 'c'];
        L.tileLayer(tileUrl, tileOpts).addTo(mapa);

        L.marker([parseFloat(latitude), parseFloat(longitude)])
          .addTo(mapa)
          .bindPopup(`<strong>${descricaoEscapada}</strong><br>Coordenadas: ${latitude}, ${longitude}`)
          .openPopup();
      } catch (err) {
        console.error('Erro ao inicializar mapa:', err);
        if (typeof showMessage === 'function') showMessage('Erro ao carregar mapa. Verifique se o Leaflet está carregado.', 'error');
        else alert('Erro ao carregar mapa. Verifique se o Leaflet está carregado.');
      }
    })();
  };

  // Botão Atualizar da aba Macros (delegação: funciona mesmo com HTML injetado depois pelo dashboard)
  document.addEventListener('click', function(e) {
    const btn = e.target && (e.target.id === 'btnAtualizarMacros' || e.target.closest('#btnAtualizarMacros'));
    if (btn) {
      e.preventDefault();
      carregarMacrosViagem();
    }
  });

})();
