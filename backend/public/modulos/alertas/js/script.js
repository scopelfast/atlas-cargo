// backend/public/modulos/alertas/js/script.js
// Módulo de Alertas - Frontend Completo
// Versão: 2.0
// Data: 2026-01-18
//
// Este módulo gerencia a visualização, filtragem e tratamento de alertas do sistema.
// Inclui integração com WebSocket para atualizações em tempo real.

(function() {
  'use strict';
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);

  let contextoAlertas = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoAlertas() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoAlertas.locale = d.locale;
      if (d && d.timezone) contextoAlertas.timezone = d.timezone;
    } catch (e) {}
  }

  // Estado do módulo
  let alertas = [];
  let alertasFiltrados = [];
  let filtrosAtivos = {};
  let paginaAtual = 1;
  let itensPorPagina = 20;
  let totalItens = 0;
  let socket = null;
  let estaConectado = false;

  // Elementos DOM
  const alertasList = document.getElementById('alertasList');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const modalTratamento = document.getElementById('modalTratamento');
  const modalTratamentoContent = document.getElementById('modalTratamentoContent');

  /**
   * Tocar som de notificação
   */
  function tocarSomNotificacao(tipo = 'alerta') {
    try {
      // Verificar se som está habilitado (localStorage)
      const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
      if (!somHabilitado) {
        return;
      }

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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

      oscillator.frequency.value = frequencies[tipo] || 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      console.warn('Erro ao tocar som:', err);
    }
  }

  /**
   * Inicializar módulo
   */
  async function inicializar() {
    console.log('📋 Módulo Alertas inicializando...');
    await loadContextoAlertas();
    carregarAlertas();
    
    // Inicializar WebSocket
    inicializarWebSocket();
    
    // Atualizar contador no menu
    atualizarContadorMenu();
    
    // Atualizar contador a cada 30 segundos
    setInterval(atualizarContadorMenu, 30000);
  }

  /**
   * Obter headers de autenticação
   */
  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
  }

  /**
   * Carregar alertas do servidor
   */
  async function carregarAlertas() {
    try {
      mostrarLoading(true);
      
      // Construir query string com filtros
      const params = new URLSearchParams();
      if (filtrosAtivos.status) params.append('status', filtrosAtivos.status);
      if (filtrosAtivos.tipo) params.append('tipo', filtrosAtivos.tipo);
      if (filtrosAtivos.prioridade) params.append('prioridade', filtrosAtivos.prioridade);
      if (filtrosAtivos.dataInicio) params.append('dataInicio', filtrosAtivos.dataInicio);
      if (filtrosAtivos.dataFim) params.append('dataFim', filtrosAtivos.dataFim);
      if (filtrosAtivos.idViagem) params.append('idViagem', filtrosAtivos.idViagem);
      
      params.append('limit', itensPorPagina);
      params.append('offset', (paginaAtual - 1) * itensPorPagina);

      const response = await fetch(`/api/alertas?${params.toString()}`, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        alertas = data.data || [];
        totalItens = data.total || 0;
        
        renderizarAlertas();
        atualizarEstatisticas();
        atualizarPaginacao();
      } else {
        throw new Error(data.error || 'Erro ao carregar alertas');
      }
    } catch (err) {
      console.error('Erro ao carregar alertas:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
      alertasList.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-error-circle'></i>
          <h3>${t('web.modulos.alertas.erroCarregar')}</h3>
          <p>${err.message}</p>
        </div>
      `;
    } finally {
      mostrarLoading(false);
    }
  }

  /**
   * Renderizar lista de alertas
   */
  function renderizarAlertas() {
    if (alertas.length === 0) {
      alertasList.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-bell-off'></i>
          <h3>Nenhum alerta encontrado</h3>
          <p>Não há alertas que correspondam aos filtros selecionados.</p>
        </div>
      `;
      return;
    }

    alertasList.innerHTML = alertas.map(alerta => criarCardAlerta(alerta)).join('');
    
    // Adicionar event listeners aos cards
    alertas.forEach((alerta, index) => {
      const card = alertasList.children[index];
      if (card) {
        card.addEventListener('click', () => abrirDetalhesAlerta(alerta));
      }
    });
  }

  /**
   * Criar card HTML para um alerta
   */
  function criarCardAlerta(alerta) {
    const prioridadeClass = `prioridade-${(alerta.PRIORIDADE || 'normal').toLowerCase()}`;
    const tipoClass = (alerta.TYPE || '').toLowerCase();
    const statusClass = (alerta.STATUS || 'Pendente').toLowerCase().replace(' ', '-');
    const naoLidoClass = !alerta.DH_LEITURA ? 'nao-lido' : '';
    
    const dataFormatada = formatarData(alerta.CREATED_AT);
    const horaFormatada = formatarHora(alerta.CREATED_AT);
    
    return `
      <div class="alerta-card ${prioridadeClass} ${naoLidoClass}" data-id="${alerta.ID}">
        <div class="alerta-header-card">
          <div>
            <span class="alerta-tipo-badge ${tipoClass}">${alerta.TYPE || 'N/A'}</span>
            <span class="alerta-status-badge ${statusClass}">${alerta.STATUS || 'Pendente'}</span>
          </div>
          <div style="text-align: right; font-size: 12px; color: #6c757d;">
            ${dataFormatada}<br>${horaFormatada}
          </div>
        </div>
        <div class="alerta-message">${alerta.MESSAGE || 'Sem mensagem'}</div>
        ${alerta.DETAILS ? `<div style="font-size: 14px; color: #6c757d; margin-top: 8px;">${alerta.DETAILS}</div>` : ''}
        <div class="alerta-details">
          ${alerta.IDVIAGEM ? `<div class="alerta-detail-item"><i class='bx bx-map'></i> Viagem: ${alerta.IDVIAGEM}</div>` : ''}
          ${alerta.motorista_nome ? `<div class="alerta-detail-item"><i class='bx bx-user'></i> ${alerta.motorista_nome}</div>` : ''}
          ${alerta.PRIORIDADE ? `<div class="alerta-detail-item"><i class='bx bx-error-circle'></i> ${alerta.PRIORIDADE}</div>` : ''}
        </div>
        <div class="alerta-actions">
          ${!alerta.DH_LEITURA ? `
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); marcarComoLido(${alerta.ID})">
              <i class='bx bx-check'></i> Marcar como Lido
            </button>
          ` : ''}
          ${alerta.STATUS === 'Pendente' || alerta.STATUS === 'Em Análise' ? `
            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); tratarAlerta(${alerta.ID})">
              <i class='bx bx-check-double'></i> Tratar
            </button>
          ` : ''}
          <button class="btn btn-sm btn-info" onclick="event.stopPropagation(); verHistorico(${alerta.ID})">
            <i class='bx bx-history'></i> Histórico
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Aplicar filtros
   */
  window.aplicarFiltros = function() {
    try {
      console.log('🔍 Aplicando filtros...');
      
      // Coletar valores dos filtros
      const filtroStatusEl = document.getElementById('filtroStatus');
      const filtroTipoEl = document.getElementById('filtroTipo');
      const filtroPrioridadeEl = document.getElementById('filtroPrioridade');
      const filtroDataInicioEl = document.getElementById('filtroDataInicio');
      const filtroDataFimEl = document.getElementById('filtroDataFim');
      const filtroIdViagemEl = document.getElementById('filtroIdViagem');
      
      if (!filtroStatusEl || !filtroTipoEl || !filtroPrioridadeEl) {
        console.error('❌ Elementos de filtro não encontrados:', {
          status: !!filtroStatusEl,
          tipo: !!filtroTipoEl,
          prioridade: !!filtroPrioridadeEl
        });
        mostrarMensagem(t('web.modulos.alertas.erroCarregar'), 'error');
        return;
      }
      
      const status = filtroStatusEl.value?.trim() || '';
      const tipo = filtroTipoEl.value?.trim() || '';
      const prioridade = filtroPrioridadeEl.value?.trim() || '';
      const dataInicio = filtroDataInicioEl?.value?.trim() || '';
      const dataFim = filtroDataFimEl?.value?.trim() || '';
      const idViagem = filtroIdViagemEl?.value?.trim() || '';
      
      console.log('📋 Valores dos filtros:', { status, tipo, prioridade, dataInicio, dataFim, idViagem });
      
      // Criar objeto de filtros apenas com valores não vazios
      filtrosAtivos = {};
      if (status) filtrosAtivos.status = status;
      if (tipo) filtrosAtivos.tipo = tipo;
      if (prioridade) filtrosAtivos.prioridade = prioridade;
      if (dataInicio) filtrosAtivos.dataInicio = dataInicio;
      if (dataFim) filtrosAtivos.dataFim = dataFim;
      if (idViagem) filtrosAtivos.idViagem = idViagem;
      
      console.log('✅ Filtros ativos:', filtrosAtivos);
      
      paginaAtual = 1;
      carregarAlertas();
    } catch (err) {
      console.error('❌ Erro ao aplicar filtros:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Limpar filtros
   */
  window.limparFiltros = function() {
    try {
      console.log('🧹 Limpando filtros...');
      
      // Limpar todos os campos de filtro
      const filtroStatus = document.getElementById('filtroStatus');
      const filtroTipo = document.getElementById('filtroTipo');
      const filtroPrioridade = document.getElementById('filtroPrioridade');
      const filtroDataInicio = document.getElementById('filtroDataInicio');
      const filtroDataFim = document.getElementById('filtroDataFim');
      const filtroIdViagem = document.getElementById('filtroIdViagem');
      
      if (filtroStatus) filtroStatus.value = '';
      if (filtroTipo) filtroTipo.value = '';
      if (filtroPrioridade) filtroPrioridade.value = '';
      if (filtroDataInicio) filtroDataInicio.value = '';
      if (filtroDataFim) filtroDataFim.value = '';
      if (filtroIdViagem) filtroIdViagem.value = '';
      
      // Limpar filtros ativos e recarregar
      filtrosAtivos = {};
      paginaAtual = 1;
      
      console.log('✅ Filtros limpos, recarregando alertas...');
      carregarAlertas();
    } catch (err) {
      console.error('❌ Erro ao limpar filtros:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Marcar alerta como lido
   */
  window.marcarComoLido = async function(idAlerta) {
    try {
      const idUsuario = getUserId();

      if (!idUsuario) {
        mostrarMensagem(t('web.modulos.alertas.erroConexao'), 'error');
        return;
      }

      const response = await fetch(`/api/alertas/${idAlerta}/ler`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idUsuario: idUsuario
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('Alerta marcado como lido', 'success');
        carregarAlertas();
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao marcar como lido');
      }
    } catch (err) {
      console.error('Erro ao marcar como lido:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Tratar alerta
   */
  window.tratarAlerta = async function(idAlerta) {
    try {
      // Buscar detalhes do alerta
      const response = await fetch(`/api/alertas/${idAlerta}`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      
      if (!data.success || !data.data) {
        throw new Error('Alerta não encontrado');
      }

      const alerta = data.data;
      
      // Criar formulário de tratamento
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 10px; color: #2c3e50; font-size: 18px; font-weight: 600;">Alerta #${alerta.ID}</h4>
          <p style="color: #6c757d; margin-bottom: 15px; line-height: 1.5;">${alerta.MESSAGE}</p>
        </div>
        <form id="formTratamento" onsubmit="event.preventDefault(); salvarTratamento(${idAlerta})">
          <div class="input-group">
            <label for="novoStatus">Novo Status</label>
            <select id="novoStatus" class="form-control" required>
              <option value="Em Análise" ${alerta.STATUS === 'Em Análise' ? 'selected' : ''}>Em Análise</option>
              <option value="Tratado" ${alerta.STATUS === 'Tratado' ? 'selected' : ''}>Tratado</option>
              <option value="Cancelado">Cancelado</option>
            </select>
          </div>
          <div class="input-group">
            <label for="observacoes">Observações</label>
            <textarea id="observacoes" class="form-control" rows="4" placeholder="Descreva as ações tomadas...">${alerta.OBSERVACOES || ''}</textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="fecharModalTratamento()">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar</button>
          </div>
        </form>
      `;
      
      modalTratamento.classList.add('active');
    } catch (err) {
      console.error('Erro ao abrir tratamento:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Obter ID do usuário logado
   */
  function getUserId() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      // O login retorna user.id que é o CDCADASTRO
      return user.id || user.cdcadastro || user.CDCADASTRO || user.userId;
    } catch (err) {
      console.warn('Erro ao obter ID do usuário:', err);
      return null;
    }
  }

  /**
   * Salvar tratamento
   */
  window.salvarTratamento = async function(idAlerta) {
    try {
      const novoStatus = document.getElementById('novoStatus').value;
      const observacoes = document.getElementById('observacoes').value;
      const idUsuario = getUserId();

      if (!idUsuario) {
        mostrarMensagem(t('web.modulos.alertas.erroConexao'), 'error');
        return;
      }

      const response = await fetch(`/api/alertas/${idAlerta}/tratar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status: novoStatus,
          observacoes: observacoes,
          idUsuario: idUsuario
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('Alerta tratado com sucesso', 'success');
        fecharModalTratamento();
        carregarAlertas();
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao tratar alerta');
      }
    } catch (err) {
      console.error('Erro ao salvar tratamento:', err);
      mostrarMensagem(t('web.modulos.alertas.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Fechar modal de tratamento
   */
  window.fecharModalTratamento = function() {
    modalTratamento.classList.remove('active');
  };

  /**
   * Ver histórico do alerta
   */
  window.verHistorico = async function(idAlerta) {
    try {
      const response = await fetch(`/api/alertas/${idAlerta}/historico`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Erro ao carregar histórico');
      }

      const historico = data.data || [];
      
      if (historico.length === 0) {
        mostrarMensagem('Nenhum histórico encontrado para este alerta', 'info');
        return;
      }

      // Criar modal com histórico
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 10px; color: #2c3e50; font-size: 18px; font-weight: 600;">Histórico do Alerta #${idAlerta}</h4>
        </div>
        <div class="historico-list" style="max-height: 400px; overflow-y: auto;">
          ${historico.length > 0 ? historico.map(item => `
            <div class="historico-item">
              <div class="historico-header">
                <strong>${item.ACAO}</strong>
                <span class="historico-data">${formatarDataHora(item.DH_ACAO)}</span>
              </div>
              ${item.usuario_nome ? `<div class="historico-usuario"><i class='bx bx-user'></i> ${item.usuario_nome}</div>` : ''}
              ${item.STATUS_ANTERIOR && item.STATUS_NOVO ? `
                <div class="historico-status">
                  Status: <strong>${item.STATUS_ANTERIOR}</strong> → <strong>${item.STATUS_NOVO}</strong>
                </div>
              ` : ''}
              ${item.OBSERVACOES ? `<div class="historico-obs">${item.OBSERVACOES}</div>` : ''}
            </div>
          `).join('') : '<div class="empty-state"><p>Nenhum histórico disponível</p></div>'}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="fecharModalTratamento()">Fechar</button>
        </div>
      `;
      
      modalTratamento.classList.add('active');
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      mostrarMensagem('Erro ao carregar histórico: ' + err.message, 'error');
    }
  };

  /**
   * Abrir detalhes do alerta
   */
  async function abrirDetalhesAlerta(alerta) {
    await tratarAlerta(alerta.ID);
  }

  /**
   * Atualizar estatísticas
   */
  async function atualizarEstatisticas() {
    try {
      // Buscar contadores
      const response = await fetch('/api/alertas/contador', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        // Garantir que os valores sejam números
        const pendentes = parseInt(data.data.pendentes) || 0;
        const emAnalise = parseInt(data.data.emAnalise) || 0;
        const tratados = parseInt(data.data.tratados) || 0;
        const total = parseInt(data.data.total) || 0;
        
        // Atualizar elementos
        const statPendentes = document.getElementById('statPendentes');
        const statEmAnalise = document.getElementById('statEmAnalise');
        const statTratados = document.getElementById('statTratados');
        const statTotal = document.getElementById('statTotal');
        
        if (statPendentes) statPendentes.textContent = pendentes;
        if (statEmAnalise) statEmAnalise.textContent = emAnalise;
        if (statTratados) statTratados.textContent = tratados;
        if (statTotal) statTotal.textContent = total;
        
        console.log('📊 Estatísticas atualizadas:', { pendentes, emAnalise, tratados, total });
      } else {
        console.warn('⚠️ Resposta do contador não contém dados válidos:', data);
      }
    } catch (err) {
      console.error('❌ Erro ao atualizar estatísticas:', err);
    }
  }

  /**
   * Atualizar contador no menu
   */
  async function atualizarContadorMenu() {
    try {
      const response = await fetch('/api/alertas/contador', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        return; // Silenciosamente falhar se não conseguir atualizar
      }
      
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
      }
    } catch (err) {
      console.error('Erro ao atualizar contador do menu:', err);
    }
  }

  /**
   * Atualizar paginação
   */
  function atualizarPaginacao() {
    const totalPaginas = Math.ceil(totalItens / itensPorPagina);
    const paginationContainer = document.getElementById('paginationContainer');
    
    if (totalPaginas <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }
    
    paginationContainer.style.display = 'flex';
    document.getElementById('pageInfo').textContent = `Página ${paginaAtual} de ${totalPaginas}`;
    document.getElementById('btnPrev').disabled = paginaAtual === 1;
    document.getElementById('btnNext').disabled = paginaAtual === totalPaginas;
  }

  /**
   * Paginar anterior
   */
  window.paginarAnterior = function() {
    if (paginaAtual > 1) {
      paginaAtual--;
      carregarAlertas();
    }
  };

  /**
   * Paginar próximo
   */
  window.paginarProximo = function() {
    const totalPaginas = Math.ceil(totalItens / itensPorPagina);
    if (paginaAtual < totalPaginas) {
      paginaAtual++;
      carregarAlertas();
    }
  };

  /**
   * Recarregar alertas
   */
  window.recarregarAlertas = function() {
    console.log('🔄 Recarregando alertas manualmente...');
    carregarAlertas();
    atualizarContadorMenu();
  };

  /**
   * Inicializar WebSocket
   */
  function inicializarWebSocket() {
    if (typeof io === 'undefined') {
      console.warn('Socket.io não disponível. Tentando carregar...');
      carregarSocketIO().then(() => {
        conectarWebSocket();
      }).catch(err => {
        console.error('Erro ao carregar Socket.io:', err);
      });
      return;
    }

    conectarWebSocket();
  }

  /**
   * Carregar Socket.io dinamicamente
   */
  function carregarSocketIO() {
    return new Promise((resolve, reject) => {
      if (typeof io !== 'undefined') {
        resolve();
        return;
      }

      if (document.querySelector('script[src*="socket.io"]')) {
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof io !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            reject(new Error('Timeout ao carregar Socket.io'));
          }
        }, 500);
        return;
      }

      // Socket.io é sempre servido na raiz (/socket.io/), não no caminho base
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => {
        setTimeout(() => {
          if (typeof io !== 'undefined') {
            resolve();
          } else {
            reject(new Error('Socket.io carregado mas io não está disponível'));
          }
        }, 100);
      };
      script.onerror = () => {
        reject(new Error('Erro ao carregar Socket.io'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Conectar WebSocket
   */
  function conectarWebSocket() {
    if (socket && socket.connected) {
      console.log('✅ WebSocket Alertas já conectado');
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const host = window.location.host;
      const url = `${protocol}//${host}`;

      socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      socket.on('connect', () => {
        console.log('✅ WebSocket Alertas conectado:', socket.id);
        estaConectado = true;
      });

      socket.on('disconnect', () => {
        console.log('⚠️ WebSocket Alertas desconectado');
        estaConectado = false;
      });

      // Escutar eventos de alertas
      socket.on('alerta:novo', (alerta) => {
        console.log('🔔 Novo alerta recebido:', alerta);
        mostrarMensagem(`Novo alerta: ${alerta.MESSAGE || 'Sem mensagem'}`, 'info');
        tocarSomNotificacao('alerta');
        carregarAlertas();
        atualizarContadorMenu();
      });

      socket.on('alerta:atualizado', (alerta) => {
        console.log('📝 Alerta atualizado:', alerta);
        carregarAlertas();
        atualizarContadorMenu();
      });

      socket.on('alerta:tratado', (data) => {
        console.log('✅ Alerta tratado:', data);
        carregarAlertas();
        atualizarContadorMenu();
      });

    } catch (err) {
      console.error('Erro ao conectar WebSocket:', err);
    }
  }

  /**
   * Mostrar/ocultar loading
   * Evita "piscar" em carregamentos rápidos
   */
  let loadingTimeout = null;
  let loadingAtivo = false;
  
  function mostrarLoading(mostrar) {
    if (mostrar) {
      // Se já está ativo, não fazer nada
      if (loadingAtivo) return;
      
      // Aguardar 200ms antes de mostrar (evita piscar em carregamentos rápidos)
      loadingTimeout = setTimeout(() => {
        if (loadingOverlay && !loadingOverlay.classList.contains('active')) {
          loadingOverlay.classList.add('active');
          loadingAtivo = true;
        }
      }, 200);
    } else {
      // Cancelar timeout se ainda não mostrou
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
      }
      
      // Remover overlay se estiver visível
      if (loadingOverlay && loadingOverlay.classList.contains('active')) {
        loadingOverlay.classList.remove('active');
        loadingAtivo = false;
      }
    }
  }

  /**
   * Mostrar mensagem
   */
  function mostrarMensagem(mensagem, tipo) {
    // Usar função global se disponível
    if (typeof showMessage === 'function') {
      showMessage(mensagem, tipo);
    } else {
      console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
      alert(mensagem);
    }
  }

  function formatarData(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return 'N/A';
    const loc = contextoAlertas.locale || 'pt-BR';
    const tz = contextoAlertas.timezone || 'America/Sao_Paulo';
    try {
      return new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: 'short' }).format(data);
    } catch (e) { return data.toLocaleDateString(loc); }
  }

  function formatarHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return 'N/A';
    const loc = contextoAlertas.locale || 'pt-BR';
    const tz = contextoAlertas.timezone || 'America/Sao_Paulo';
    return data.toLocaleTimeString(loc, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  }

  function formatarDataHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return 'N/A';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(data, contextoAlertas.locale, contextoAlertas.timezone, { dateStyle: 'short', timeStyle: 'short' });
    }
    return data.toLocaleString(contextoAlertas.locale || 'pt-BR', { timeZone: contextoAlertas.timezone || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  }

  /**
   * Mostrar modal de ajuda
   */
  window.mostrarAjuda = function() {
    const modalAjuda = document.getElementById('modalAjuda');
    const modalAjudaContent = document.getElementById('modalAjudaContent');
    
    if (!modalAjuda || !modalAjudaContent) {
      mostrarMensagem('Erro: Modal de ajuda não encontrado', 'error');
      return;
    }
    
    modalAjudaContent.innerHTML = `
      <div style="line-height: 1.8;">
        <h3 style="color: #2c3e50; margin-bottom: 20px; font-size: 20px;">
          <i class='bx bx-info-circle' style="color: #3498db;"></i> Como Funcionam os Alertas
        </h3>
        
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3498db;">
          <h4 style="margin: 0 0 10px 0; color: #2c3e50;">🎯 Geração Automática</h4>
          <p style="margin: 0; color: #495057;">
            Os alertas são gerados <strong>automaticamente</strong> por um job que roda no servidor a cada <strong>5 minutos</strong>.
            O sistema verifica todas as viagens ativas e detecta situações anômalas.
          </p>
        </div>
        
        <h4 style="color: #2c3e50; margin-top: 25px; margin-bottom: 15px;">📋 Tipos de Alertas e Regras</h4>
        
        <div style="margin-bottom: 20px;">
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #e74c3c;">
              <i class='bx bx-error-circle'></i> 1. PARADA PROLONGADA
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              <strong>Regra:</strong> Motorista parado há mais de <strong>30 minutos</strong> com velocidade < 5 km/h
            </p>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
              <strong>Prioridade:</strong> Alta se > 60 min | Normal se 30-60 min
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #f39c12;">
              <i class='bx bx-time'></i> 2. ATRASO NO ETA
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              <strong>Regra:</strong> ETA estimado > prazo de entrega. Usa cálculo dinâmico com OSRM.
            </p>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
              <strong>Prioridade:</strong> Urgente se > 120 min | Alta se ≤ 120 min
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #17a2b8;">
              <i class='bx bx-wifi-off'></i> 3. MOTORISTA OFFLINE
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              <strong>Regra:</strong> Sem atualização GPS há mais de <strong>90 minutos</strong>
            </p>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
              <strong>Prioridade:</strong> Alta se > 180 min | Normal se 90-180 min
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #6f42c1;">
              <i class='bx bx-map'></i> 4. DESVIO DE ROTA
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              <strong>Regra:</strong> Posição atual está mais de <strong>500 metros</strong> fora da rota planejada
            </p>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
              <strong>Prioridade:</strong> Alta se > 2000m | Normal se 500-2000m
            </p>
          </div>
        </div>
        
        <h4 style="color: #2c3e50; margin-top: 25px; margin-bottom: 15px;">🔍 Como Verificar se Está Funcionando?</h4>
        
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px 0; color: #856404;">
            <i class='bx bx-info-circle'></i> Logs do Servidor
          </h5>
          <p style="margin: 0 0 10px 0; color: #856404;">
            Os logs aparecem no <strong>console do servidor Node.js</strong> (terminal onde você iniciou o servidor).
          </p>
          <p style="margin: 0; color: #856404; font-size: 14px;">
            <strong>Procure por:</strong><br>
            🔄 Job de alertas iniciado (verificação a cada 5 minutos)<br>
            🔍 Verificando alertas para X viagem(ns) ativa(s)...<br>
            ⚠️  Y alerta(s) encontrado(s)
          </p>
        </div>
        
        <div style="background: #d1ecf1; border: 1px solid #17a2b8; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px 0; color: #0c5460;">
            <i class='bx bx-check-circle'></i> Pré-requisitos para Gerar Alertas
          </h5>
          <ul style="margin: 0; padding-left: 20px; color: #0c5460;">
            <li>Viagem com status "Em Andamento" ou "Confirmada"</li>
            <li>Dados de rastreamento GPS na tabela <code>VIAGEMRASTREAMENTO</code></li>
            <li>Roteiro com coordenadas (para alertas de desvio/atraso)</li>
            <li>Prazo de entrega definido (para alertas de atraso)</li>
          </ul>
        </div>
        
        <div style="background: #d4edda; border: 1px solid #28a745; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px 0; color: #155724;">
            <i class='bx bx-cog'></i> Teste Manual
          </h5>
          <p style="margin: 0 0 10px 0; color: #155724;">
            Você pode forçar a verificação manualmente via API:
          </p>
          <code style="display: block; background: #fff; padding: 10px; border-radius: 4px; color: #495057; font-size: 13px; margin-bottom: 10px;">
            POST /api/alertas/verificar/:idviagem
          </code>
          <p style="margin: 0; color: #155724; font-size: 14px;">
            Use o botão "Atualizar" acima ou aguarde o job automático (5 minutos).
          </p>
        </div>
        
        <div style="background: #f8f9fa; border-top: 2px solid #dee2e6; padding-top: 15px; margin-top: 25px;">
          <p style="margin: 0; color: #6c757d; font-size: 13px; text-align: center;">
            <i class='bx bx-info-circle'></i> Para mais detalhes técnicos, consulte a documentação completa no arquivo:<br>
            <code style="font-size: 12px;">COMO_FUNCIONA_GERACAO_ALERTAS.md</code>
          </p>
        </div>
      </div>
    `;
    
    modalAjuda.classList.add('active');
  };
  
  /**
   * Fechar modal de ajuda
   */
  window.fecharModalAjuda = function() {
    const modalAjuda = document.getElementById('modalAjuda');
    if (modalAjuda) {
      modalAjuda.classList.remove('active');
    }
  };
  
  // Fechar modal ao clicar fora
  const modalAjuda = document.getElementById('modalAjuda');
  if (modalAjuda) {
    modalAjuda.addEventListener('click', (e) => {
      if (e.target === modalAjuda) {
        fecharModalAjuda();
      }
    });
  }
  
  // Fechar modal de tratamento ao clicar fora
  modalTratamento.addEventListener('click', (e) => {
    if (e.target === modalTratamento) {
      fecharModalTratamento();
    }
  });

  /**
   * Toggle som de notificação
   */
  window.toggleSomNotificacaoAlertas = function() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const novoEstado = !somHabilitado;
    localStorage.setItem('notificacao_som', novoEstado.toString());
    
    const btn = document.getElementById('btnToggleSomAlertas');
    if (btn) {
      if (novoEstado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.alertas.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.alertas.som');
        btn.title = 'Som desativado (clique para ativar)';
      }
    }
    
    // Tocar som de teste se ativou
    if (novoEstado) {
      tocarSomNotificacao('alerta');
    }
  };

  /**
   * Atualizar estado do botão de som
   */
  function atualizarEstadoBotaoSom() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const btn = document.getElementById('btnToggleSomAlertas');
    if (btn) {
      if (somHabilitado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.alertas.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.alertas.som');
        btn.title = 'Som desativado (clique para ativar)';
      }
    }
  }

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      inicializar();
      atualizarEstadoBotaoSom();
    });
  } else {
    inicializar();
    atualizarEstadoBotaoSom();
  }

})();
