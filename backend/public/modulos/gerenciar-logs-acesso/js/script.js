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
  
  // Controle de ordenação
  let ordenacaoEstatisticas = { campo: 'acessos', direcao: 'desc' };
  let ordenacaoTopModulos = { campo: 'acessos', direcao: 'desc' };

  // Função para formatar data/hora sem conversão de fuso
  // SQL Server retorna datas no formato local, então tratamos a string diretamente
  function formatarDataHora(data) {
    if (!data) return '-';
    
    // Se for string, tratar diretamente (sem conversão de fuso)
    if (typeof data === 'string') {
      // Remover o Z se existir e tratar como data local
      let dataStr = data.replace('Z', '').replace('z', '');
      
      // Se tem T, substituir por espaço
      if (dataStr.includes('T')) {
        dataStr = dataStr.replace('T', ' ');
      }
      
      // Remover milissegundos se existirem
      dataStr = dataStr.replace(/\.\d{3}/, '');
      
      // Extrair partes da data: 2026-12-22 11:24:15
      const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        // Formatar diretamente sem conversão de fuso
        return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
      }
    }
    
    // Se for objeto Date, extrair componentes UTC (assumindo que já está no fuso correto)
    if (data instanceof Date) {
      const year = data.getFullYear();
      const month = String(data.getMonth() + 1).padStart(2, '0');
      const day = String(data.getDate()).padStart(2, '0');
      const hour = String(data.getHours()).padStart(2, '0');
      const minute = String(data.getMinutes()).padStart(2, '0');
      const second = String(data.getSeconds()).padStart(2, '0');
      return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
    }
    
    // Fallback: tentar criar Date e formatar
    try {
      const d = new Date(data);
      if (isNaN(d.getTime())) return '-';
      
      // Extrair componentes da string original se possível
      const str = String(data);
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
      }
      
      const loc = contextoLogs.locale || 'pt-BR';
      const tz = contextoLogs.timezone || 'America/Sao_Paulo';
      if (typeof window.formatarDataHoraComFuso === 'function') {
        return window.formatarDataHoraComFuso(d, loc, tz, { dateStyle: 'short', timeStyle: 'medium' });
      }
      return d.toLocaleString(loc, { timeZone: tz });
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

    // Calcular totais
    const totalAcessos = acessos.length;
    const tempoTotal = acessos.reduce((sum, acc) => sum + (acc.TEMPOSESSAO || 0), 0);
    const horas = Math.floor(tempoTotal / 60);
    const minutos = tempoTotal % 60;
    const tempoFormatado = horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;

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

    // Estatísticas por operador
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
          valorA = a.ultimoAcesso ? new Date(a.ultimoAcesso).getTime() : 0;
          valorB = b.ultimoAcesso ? new Date(b.ultimoAcesso).getTime() : 0;
          return direcao === 'asc' ? valorA - valorB : valorB - valorA;
        case 'ultimaAcao':
          valorA = a.ultimaAcao ? new Date(a.ultimaAcao).getTime() : 0;
          valorB = b.ultimaAcao ? new Date(b.ultimaAcao).getTime() : 0;
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
          valorA = a.ultimoAcesso ? new Date(a.ultimoAcesso).getTime() : 0;
          valorB = b.ultimoAcesso ? new Date(b.ultimoAcesso).getTime() : 0;
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
  function atualizarEstatisticasPorOperador(acessos, acoes) {
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
      porOperador[usuario].tempoTotal += (acesso.TEMPOSESSAO || 0);
      
      // Rastrear último acesso (manter como string para evitar conversão de fuso)
      const dataLoginStr = acesso.DHLOGIN;
      if (dataLoginStr) {
        // Comparar datas para encontrar o mais recente
        const dataLogin = new Date(dataLoginStr);
        const ultimoAcessoAtual = porOperador[usuario].ultimoAcesso;
        if (!ultimoAcessoAtual || dataLogin > new Date(ultimoAcessoAtual)) {
          porOperador[usuario].ultimoAcesso = dataLoginStr; // Manter string original
        }
      }
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
        const dataAcao = new Date(dataAcaoStr);
        if (!porOperador[usuario].ultimaAcao || dataAcao > new Date(porOperador[usuario].ultimaAcao || 0)) {
          porOperador[usuario].ultimaAcao = dataAcaoStr; // Manter string original
        }
      }
    });

    // Preparar dados
    let operadores = Object.entries(porOperador)
      .map(([usuario, dados]) => ({
        usuario,
        ...dados,
        modulos: dados.modulos.size
      }));
    
    // Ordenar conforme configuração
    operadores = ordenarOperadores(operadores, ordenacaoEstatisticas.campo, ordenacaoEstatisticas.direcao);

    if (operadores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #95a5a6;">Nenhum dado encontrado</td></tr>';
      return;
    }

    operadores.forEach(op => {
      const horas = Math.floor(op.tempoTotal / 60);
      const minutos = op.tempoTotal % 60;
      const tempoFormatado = horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;

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
        const dataAcao = new Date(dataAcaoStr);
        if (!porModulo[modulo].ultimoAcesso || dataAcao > new Date(porModulo[modulo].ultimoAcesso || 0)) {
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
    document.getElementById('tempoTotalLogado').textContent = '0h';
    document.getElementById('totalModulos').textContent = '0';
    document.getElementById('totalAcoes').textContent = '0';
  });

  document.getElementById('btnVoltarResumo')?.addEventListener('click', () => {
    showTab('filtros');
  });

  // Inicializar
  init();
})();

