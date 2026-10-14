// backend/public/modulos/gerenciar-logs-acesso/js/script.js
// Logs de Acesso - Frontend
// Versão: 1.0
// Atlas Cargo
// i18n: helper t() e chaves web.modulos.logsAcesso

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let lastLogsAcesso = null;
  let lastLogsAcoes = null;
  let sqlExecutado = false;
  let initExecutado = false;
  let contextoLogs = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoLogs() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoLogs.locale = d.locale;
      if (d && d.timezone) contextoLogs.timezone = d.timezone;
    } catch (e) {}
  }

  function parseBackendDateSafe(dataValue) {
    if (dataValue instanceof Date) return dataValue;
    const s = String(dataValue || '').trim();
    if (!s) return new Date(NaN);
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      return new Date(s);
    }
    const semTzMatch = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
    if (semTzMatch) {
      const iso = `${semTzMatch[1]}T${semTzMatch[2]}${semTzMatch[3] || ''}`;
      const tz = contextoLogs.timezone || 'America/Sao_Paulo';
      if (tz === 'America/Sao_Paulo' || tz === 'America/Fortaleza' || tz === 'America/Belem' || tz === 'America/Recife') {
        return new Date(`${iso}-03:00`);
      }
      if (tz === 'America/Manaus') {
        return new Date(`${iso}-04:00`);
      }
      return new Date(iso);
    }
    return new Date(s);
  }

  /**
   * Teto por sessão (= TTL da torre). Sessões sem Sair (ou “fechadas” só no
   * próximo login dias depois) gravavam TEMPOSESSAO de 90h+ e inflavam o total.
   */
  var MAX_SESSAO_MIN = 8 * 60;

  /** Intervalo [startMs, endMs] da sessão; null se login inválido. Sempre ≤ MAX_SESSAO_MIN. */
  function intervaloSessaoAcesso(acesso, agoraMs) {
    var dhLogin = acesso.DHLOGIN ?? acesso.dhlogin;
    if (!dhLogin) return null;
    var t0 = (dhLogin instanceof Date ? dhLogin : parseBackendDateSafe(dhLogin)).getTime();
    if (Number.isNaN(t0)) return null;

    var agora = agoraMs != null ? agoraMs : Date.now();
    var dhLogout = acesso.DHLOGOUT ?? acesso.dhlogout;
    var semLogout = dhLogout == null || String(dhLogout).trim() === '';
    var t1;
    var maxMs = MAX_SESSAO_MIN * 60000;

    if (semLogout) {
      t1 = Math.min(agora, t0 + maxMs);
    } else {
      var d1 = (dhLogout instanceof Date ? dhLogout : parseBackendDateSafe(dhLogout)).getTime();
      if (Number.isNaN(d1)) {
        var temp = Number(acesso.TEMPOSESSAO ?? acesso.temposessao ?? 0) || 0;
        t1 = t0 + Math.max(0, Math.min(temp, MAX_SESSAO_MIN)) * 60000;
      } else {
        t1 = d1;
      }
    }
    if (t1 < t0) t1 = t0;
    if (t1 - t0 > maxMs) t1 = t0 + maxMs;
    return { start: t0, end: t1 };
  }

  /** Minutos de uma sessão (já limitada ao TTL). */
  function minutosSessaoAcesso(acesso) {
    var iv = intervaloSessaoAcesso(acesso);
    if (!iv) return 0;
    return (iv.end - iv.start) / 60000;
  }

  /** Une intervalos sobrepostos (mesmo usuário em várias abas / logins sem logout). */
  function mesclarIntervalos(intervalos) {
    if (!intervalos || !intervalos.length) return [];
    var sorted = intervalos.slice().sort(function (a, b) {
      return a.start - b.start;
    });
    var out = [{ start: sorted[0].start, end: sorted[0].end }];
    for (var i = 1; i < sorted.length; i++) {
      var cur = sorted[i];
      var last = out[out.length - 1];
      if (cur.start <= last.end) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        out.push({ start: cur.start, end: cur.end });
      }
    }
    return out;
  }

  function minutosDeIntervalos(intervalos) {
    return mesclarIntervalos(intervalos).reduce(function (sum, iv) {
      return sum + (iv.end - iv.start) / 60000;
    }, 0);
  }

  /** Tempo logado por operador com fusão de sessões sobrepostas. */
  function minutosLogadosPorOperador(acessos) {
    var porUser = {};
    (acessos || []).forEach(function (acesso) {
      var u = String(acesso.SGUSUARIO || acesso.sgusuario || '')
        .trim()
        .toUpperCase();
      if (!u) return;
      var iv = intervaloSessaoAcesso(acesso);
      if (!iv) return;
      if (!porUser[u]) porUser[u] = [];
      porUser[u].push(iv);
    });
    var out = {};
    Object.keys(porUser).forEach(function (u) {
      out[u] = minutosDeIntervalos(porUser[u]);
    });
    return out;
  }

  function minutosTotaisLogados(acessos) {
    var por = minutosLogadosPorOperador(acessos);
    return Object.keys(por).reduce(function (sum, u) {
      return sum + (por[u] || 0);
    }, 0);
  }

  /** Exibe duração a partir de minutos decimais (evita 9.573766666min no card e na tabela). */
  function formatarDuracaoMinutos(totalMinutos) {
    const t = Math.max(0, Number(totalMinutos) || 0);
    const totalSeg = Math.round(t * 60);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    if (h > 0) {
      const parts = [`${h}h`];
      if (m > 0) parts.push(`${m}min`);
      if (s > 0) parts.push(`${s}s`);
      return parts.join(' ');
    }
    if (m > 0) {
      return s > 0 ? `${m}min ${s}s` : `${m}min`;
    }
    return s > 0 ? `${s}s` : '0min';
  }

  /** Quando não há linhas em USUARIOLOGACESSO (legado), estima janela de uso por DHACAO das ações (por operador). */
  function estimativaMinutosPorUsuario(acoes) {
    const byUser = {};
    (acoes || []).forEach(a => {
      const u = (a.SGUSUARIO || a.sgusuario || '').toUpperCase();
      if (!u) return;
      const d = a.DHACAO ?? a.dhacao ?? a.DHAÇÃO;
      if (!d) return;
      const t = parseBackendDateSafe(d).getTime();
      if (Number.isNaN(t)) return;
      if (!byUser[u]) byUser[u] = [];
      byUser[u].push(t);
    });
    const out = {};
    Object.keys(byUser).forEach(u => {
      const arr = byUser[u];
      if (!arr.length) {
        out[u] = 0;
        return;
      }
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      out[u] = Math.max(0, (max - min) / 60000);
    });
    return out;
  }

  // Controle de ordenação
  let ordenacaoEstatisticas = { campo: 'acessos', direcao: 'desc' };
  let ordenacaoTopModulos = { campo: 'acessos', direcao: 'desc' };

  /**
   * Exibe instante gravado no banco (geralmente UTC no JSON) no fuso da instalação.
   * Evita o bug de remover "Z" e mostrar horário UTC como se fosse local.
   */
  function formatarDataHora(data) {
    if (data == null || data === '') return '-';
    const loc = contextoLogs.locale || 'pt-BR';
    const tz = contextoLogs.timezone || 'America/Sao_Paulo';
    const d = data instanceof Date ? data : parseBackendDateSafe(data);
    if (Number.isNaN(d.getTime())) return '-';
    try {
      if (typeof window.formatarDataHoraComFuso === 'function') {
        const out = window.formatarDataHoraComFuso(d, loc, tz, { dateStyle: 'short', timeStyle: 'medium' });
        return out || '-';
      }
      return new Intl.DateTimeFormat(loc, {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(d);
    } catch (e) {
      return '-';
    }
  }

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-logs-acesso/sql/init.sql', '/api/logs-acesso/executar-init-sql', 'logs-acesso');
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-logs-acesso/sql/init.sql', '/api/logs-acesso/executar-init-sql', 'logs-acesso');
      return;
    }
    
    console.warn('[Logs Acesso] executarInitSQLPadrao não disponível.');
  }

  // Carregar operadores no combo
  async function carregarOperadores() {
    try {
      const response = await fetch('/api/logs-acesso/operadores');
      const dados = await response.json();
      const select = document.getElementById('filtroOperador');
      
      if (select && dados.operadores) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        
        // Adicionar operadores
        dados.operadores.forEach(operador => {
          const option = document.createElement('option');
          option.value = operador;
          option.textContent = operador; // Já vem em UPPER do backend
          select.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Erro ao carregar operadores:', err);
    }
  }

  // Função de inicialização
  async function init() {
    if (initExecutado) return;
    initExecutado = true;
    await loadContextoLogs();
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      await executarInitSQL();
    } catch (err) {
      console.error('Erro ao executar init.sql:', err);
    }
    await carregarOperadores();
    await showTab('filtros');
  }

  // Mostrar aba (escopo no container do módulo)
  function showTab(tabId) {
    const tabContent = document.getElementById(`tab-${tabId}`);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!tabContent || !tabBtn) return;
    const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-btn').forEach(tab => {
        if (tab.getAttribute('data-tab') === tabId) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
      container.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'resumo') {
    try {
      const dataInicio = document.getElementById('filtroDataInicio').value;
      const dataFim = document.getElementById('filtroDataFim').value;
      const operadorSelect = document.getElementById('filtroOperador');
      const operador = operadorSelect ? operadorSelect.value.trim() : '';

      const params = new URLSearchParams();
      if (dataInicio) params.append('dataInicio', dataInicio);
      if (dataFim) params.append('dataFim', dataFim);
      if (operador) params.append('operador', operador);

      // Buscar logs de acesso
      const responseAcesso = await fetch(`/api/logs-acesso?${params.toString()}`);
      const dadosAcesso = await responseAcesso.json();
      lastLogsAcesso = dadosAcesso.logs || [];

      // Buscar logs de ações - usar endpoint específico se disponível, senão usar o genérico
      let responseAcoes;
      try {
        responseAcoes = await fetch(`/api/logs-acesso/acoes?${params.toString()}`);
      } catch (e) {
        // Fallback para endpoint genérico
        const paramsAcoes = new URLSearchParams();
        if (dataInicio) paramsAcoes.append('dataInicio', dataInicio);
        if (dataFim) paramsAcoes.append('dataFim', dataFim);
        if (operador) paramsAcoes.append('sgUsuario', operador);
        responseAcoes = await fetch(`/api/log/listar?${paramsAcoes.toString()}`);
      }
      const dadosAcoes = await responseAcoes.json();
      lastLogsAcoes = dadosAcoes.logs || [];

      // Atualizar visualização
      if (openTab === 'resumo') {
        atualizarResumo();
        await showTab('resumo');
      } else {
        await showTab(openTab);
      }
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      alert('Erro ao aplicar filtros. Verifique o console para mais detalhes.');
    }
  }

  // Atualizar resumo
  function atualizarResumo() {
    const acessos = lastLogsAcesso || [];
    const acoes = lastLogsAcoes || [];

    // Calcular totais (sessões abertas limitadas + sobreposições fundidas por operador)
    const totalAcessos = acessos.length;
    const tempoTotal = minutosTotaisLogados(acessos);
    const tempoFormatado = formatarDuracaoMinutos(tempoTotal);

    // Módulos únicos
    const modulosUnicos = new Set(acoes.filter(a => a.MODULO).map(a => a.MODULO));
    const totalModulos = modulosUnicos.size;

    // Total de ações
    const totalAcoes = acoes.length;

    const locNum = contextoLogs.locale || 'pt-BR';
    document.getElementById('totalAcessos').textContent = totalAcessos.toLocaleString(locNum);
    document.getElementById('tempoTotalLogado').textContent = tempoFormatado;
    document.getElementById('totalModulos').textContent = totalModulos.toLocaleString(locNum);
    document.getElementById('totalAcoes').textContent = totalAcoes.toLocaleString(locNum);

    atualizarEstatisticasPorOperador(acessos, acoes);

    // Top módulos
    atualizarTopModulos(acoes);
  }

  // Função para ordenar operadores
  function ordenarOperadores(operadores, campo, direcao) {
    return operadores.sort((a, b) => {
      let valorA, valorB;
      
      switch(campo) {
        case 'usuario':
          valorA = a.usuario || '';
          valorB = b.usuario || '';
          return direcao === 'asc' 
            ? valorA.localeCompare(valorB, 'pt-BR')
            : valorB.localeCompare(valorA, 'pt-BR');
        case 'acessos':
          valorA = a.acessos || 0;
          valorB = b.acessos || 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'tempoTotal':
          valorA = a.tempoTotal || 0;
          valorB = b.tempoTotal || 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'modulos':
          valorA = a.modulos || 0;
          valorB = b.modulos || 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'acoes':
          valorA = a.acoes || 0;
          valorB = b.acoes || 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'ultimoAcesso':
          valorA = a.ultimoAcesso ? parseBackendDateSafe(a.ultimoAcesso).getTime() : 0;
          valorB = b.ultimoAcesso ? parseBackendDateSafe(b.ultimoAcesso).getTime() : 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'ultimaAcao':
          valorA = a.ultimaAcao ? parseBackendDateSafe(a.ultimaAcao).getTime() : 0;
          valorB = b.ultimaAcao ? parseBackendDateSafe(b.ultimaAcao).getTime() : 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        default:
          return 0;
      }
    });
  }

  // Função para ordenar módulos
  function ordenarModulos(modulos, campo, direcao) {
    return modulos.sort((a, b) => {
      let valorA, valorB;
      
      switch(campo) {
        case 'modulo':
          valorA = a.modulo || '';
          valorB = b.modulo || '';
          return direcao === 'asc' 
            ? valorA.localeCompare(valorB, 'pt-BR')
            : valorB.localeCompare(valorA, 'pt-BR');
        case 'acessos':
          valorA = a.acessos || 0;
          valorB = b.acessos || 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'ultimoAcesso':
          valorA = a.ultimoAcesso ? parseBackendDateSafe(a.ultimoAcesso).getTime() : 0;
          valorB = b.ultimoAcesso ? parseBackendDateSafe(b.ultimoAcesso).getTime() : 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        default:
          return 0;
      }
    });
  }

  // Função para atualizar ícones de ordenação
  function atualizarIconesOrdenacao(tabelaId, campoAtual, direcaoAtual) {
    const thead = document.querySelector(`#${tabelaId} thead`);
    if (!thead) return;
    
    thead.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      const campo = th.getAttribute('data-sort');
      if (campo === campoAtual) {
        th.classList.add(direcaoAtual === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // Atualizar estatísticas por operador
  function atualizarEstatisticasPorOperador(acessos, acoes, estPorUserArg) {
    const estPorUser = estPorUserArg || estimativaMinutosPorUsuario(acoes);
    const tempoPorUser = minutosLogadosPorOperador(acessos);
    const tbody = document.getElementById('tabelaEstatisticasBody');
    tbody.innerHTML = '';

    // Agrupar por operador (normalizar para UPPER)
    const porOperador = {};
    
    acessos.forEach(acesso => {
      const usuario = (acesso.SGUSUARIO || '').toUpperCase();
      if (!usuario) return;
      if (!porOperador[usuario]) {
        porOperador[usuario] = {
          acessos: 0,
          tempoTotal: 0,
          modulos: new Set(),
          acoes: 0,
          ultimoAcesso: null,
          ultimaAcao: null
        };
      }
      porOperador[usuario].acessos++;
      
      // Rastrear último acesso (manter como string para evitar conversão de fuso)
      const dataLoginStr = acesso.DHLOGIN;
      if (dataLoginStr) {
        // Comparar datas para encontrar o mais recente
        const dataLogin = parseBackendDateSafe(dataLoginStr);
        const ultimoAcessoAtual = porOperador[usuario].ultimoAcesso;
        if (!ultimoAcessoAtual || dataLogin > parseBackendDateSafe(ultimoAcessoAtual)) {
          porOperador[usuario].ultimoAcesso = dataLoginStr; // Manter string original
        }
      }
    });

    Object.keys(tempoPorUser).forEach(function (usuario) {
      if (!porOperador[usuario]) {
        porOperador[usuario] = {
          acessos: 0,
          tempoTotal: 0,
          modulos: new Set(),
          acoes: 0,
          ultimoAcesso: null,
          ultimaAcao: null
        };
      }
      porOperador[usuario].tempoTotal = tempoPorUser[usuario] || 0;
    });

    acoes.forEach(acao => {
      const usuario = (acao.SGUSUARIO || '').toUpperCase();
      if (!usuario) return;
      if (!porOperador[usuario]) {
        porOperador[usuario] = {
          acessos: 0,
          tempoTotal: 0,
          modulos: new Set(),
          acoes: 0,
          ultimoAcesso: null,
          ultimaAcao: null
        };
      }
      porOperador[usuario].acoes++;
      if (acao.MODULO) {
        porOperador[usuario].modulos.add(acao.MODULO);
      }
      
      // Rastrear última ação (manter como string para evitar conversão de fuso)
      const dataAcaoStr = acao.DHACAO;
      if (dataAcaoStr) {
        // Comparar strings diretamente ou criar Date apenas para comparação
        const dataAcao = parseBackendDateSafe(dataAcaoStr);
        if (!porOperador[usuario].ultimaAcao || dataAcao > parseBackendDateSafe(porOperador[usuario].ultimaAcao || 0)) {
          porOperador[usuario].ultimaAcao = dataAcaoStr; // Manter string original
        }
      }
    });

    // Preparar dados (tempo 0 nas sessões → usar estimativa por ações, se houver)
    let operadores = Object.entries(porOperador)
      .map(([usuario, dados]) => {
        let tempo = dados.tempoTotal;
        if ((tempo || 0) < 1e-9 && (estPorUser[usuario] || 0) > 0) {
          tempo = estPorUser[usuario];
        }
        return {
          usuario,
          ...dados,
          tempoTotal: tempo,
          modulos: dados.modulos.size
        };
      });
    
    // Ordenar conforme configuração
    operadores = ordenarOperadores(operadores, ordenacaoEstatisticas.campo, ordenacaoEstatisticas.direcao);

    if (operadores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #95a5a6;">Nenhum dado encontrado</td></tr>';
      return;
    }

    operadores.forEach(op => {
      const tempoFormatado = formatarDuracaoMinutos(op.tempoTotal);

      const tr = document.createElement('tr');
      const locN = contextoLogs.locale || 'pt-BR';
      tr.innerHTML = `
        <td><strong>${op.usuario}</strong></td>
        <td>${op.acessos.toLocaleString(locN)}</td>
        <td>${tempoFormatado}</td>
        <td>${op.modulos.toLocaleString(locN)}</td>
        <td>${op.acoes.toLocaleString(locN)}</td>
        <td>${op.ultimoAcesso ? formatarDataHora(op.ultimoAcesso) : '-'}</td>
        <td>${op.ultimaAcao ? formatarDataHora(op.ultimaAcao) : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
    
    // Atualizar ícones de ordenação
    atualizarIconesOrdenacao('tabelaEstatisticas', ordenacaoEstatisticas.campo, ordenacaoEstatisticas.direcao);
  }

  // Atualizar top módulos
  function atualizarTopModulos(acoes) {
    const tbody = document.getElementById('tabelaTopModulosBody');
    tbody.innerHTML = '';

    // Agrupar por módulo
    const porModulo = {};
    
    acoes.forEach(acao => {
      if (!acao.MODULO) return;
      const modulo = acao.MODULO;
      if (!porModulo[modulo]) {
        porModulo[modulo] = {
          acessos: 0,
          ultimoAcesso: null
        };
      }
      porModulo[modulo].acessos++;
      const dataAcaoStr = acao.DHACAO;
      if (dataAcaoStr) {
        const dataAcao = parseBackendDateSafe(dataAcaoStr);
        if (!porModulo[modulo].ultimoAcesso || dataAcao > parseBackendDateSafe(porModulo[modulo].ultimoAcesso || 0)) {
          porModulo[modulo].ultimoAcesso = dataAcaoStr; // Manter string original
        }
      }
    });

    // Preparar dados
    let modulos = Object.entries(porModulo)
      .map(([modulo, dados]) => ({
        modulo,
        ...dados
      }));
    
    // Ordenar conforme configuração
    modulos = ordenarModulos(modulos, ordenacaoTopModulos.campo, ordenacaoTopModulos.direcao);
    modulos = modulos.slice(0, 10); // Top 10

    if (modulos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px; color: #95a5a6;">Nenhum módulo encontrado</td></tr>';
      return;
    }

    const locN = contextoLogs.locale || 'pt-BR';
    modulos.forEach(mod => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${mod.modulo}</strong></td>
        <td>${mod.acessos.toLocaleString(locN)}</td>
        <td>${mod.ultimoAcesso ? formatarDataHora(mod.ultimoAcesso) : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
    
    // Atualizar ícones de ordenação
    atualizarIconesOrdenacao('tabelaTopModulos', ordenacaoTopModulos.campo, ordenacaoTopModulos.direcao);
  }

  // Event listeners
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      showTab(tabId);
    });
  });

  // Event listeners para ordenação - Estatísticas por Operador
  document.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    
    const tabelaId = th.closest('table')?.id;
    if (!tabelaId) return;
    
    const campo = th.getAttribute('data-sort');
    if (!campo) return;
    
    if (tabelaId === 'tabelaEstatisticas') {
      // Alternar direção se for o mesmo campo
      if (ordenacaoEstatisticas.campo === campo) {
        ordenacaoEstatisticas.direcao = ordenacaoEstatisticas.direcao === 'asc' ? 'desc' : 'asc';
      } else {
        ordenacaoEstatisticas.campo = campo;
        ordenacaoEstatisticas.direcao = 'asc';
      }
      
      // Reordenar e atualizar
      if (lastLogsAcesso && lastLogsAcoes) {
        atualizarEstatisticasPorOperador(lastLogsAcesso, lastLogsAcoes);
      }
    } else if (tabelaId === 'tabelaTopModulos') {
      // Alternar direção se for o mesmo campo
      if (ordenacaoTopModulos.campo === campo) {
        ordenacaoTopModulos.direcao = ordenacaoTopModulos.direcao === 'asc' ? 'desc' : 'asc';
      } else {
        ordenacaoTopModulos.campo = campo;
        ordenacaoTopModulos.direcao = 'asc';
      }
      
      // Reordenar e atualizar
      if (lastLogsAcoes) {
        atualizarTopModulos(lastLogsAcoes);
      }
    }
  });

  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await applyFilters('resumo');
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    filtroForm.reset();
    lastLogsAcesso = null;
    lastLogsAcoes = null;
    document.getElementById('tabelaEstatisticasBody').innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #95a5a6;">Aplicar filtros para ver as estatísticas</td></tr>';
    document.getElementById('tabelaTopModulosBody').innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 40px; color: #95a5a6;">Aplicar filtros para ver os módulos mais acessados</td></tr>';
    document.getElementById('totalAcessos').textContent = '0';
    document.getElementById('tempoTotalLogado').textContent = '0min';
    document.getElementById('totalModulos').textContent = '0';
    document.getElementById('totalAcoes').textContent = '0';
  });

  document.getElementById('btnVoltarResumo')?.addEventListener('click', () => {
    showTab('filtros');
  });

  // Inicializar
  init();
})();

