// backend/public/modulos/sos/js/script.js
// Módulo de SOS - Frontend Completo
// Versão: 2.0
// Data: 2026-01-18
//
// Este módulo gerencia a visualização, filtragem e tratamento de alertas SOS (emergências).
// Inclui integração com WebSocket para atualizações em tempo real.
// Segue o mesmo padrão visual e funcional do módulo Alertas.

(function() {
  'use strict';
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);

  let contextoSos = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoSos() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoSos.locale = d.locale;
      if (d && d.timezone) contextoSos.timezone = d.timezone;
    } catch (e) {}
  }

  // Estado do módulo
  let sosList = [];
  let filtrosAtivos = {};
  let paginaAtual = 1;
  let itensPorPagina = 20;
  let totalItens = 0;
  let socket = null;
  let estaConectado = false;

  // Elementos DOM
  const sosListEl = document.getElementById('sosList');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const modalTratamento = document.getElementById('modalTratamento');
  const modalTratamentoContent = document.getElementById('modalTratamentoContent');

  /**
   * Tocar som de notificação
   */
  function tocarSomNotificacao(tipo = 'sos') {
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

      oscillator.frequency.value = frequencies[tipo] || 1000;
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
    console.log('🚨 Módulo SOS inicializando...');
    await loadContextoSos();
    carregarSOS();
    
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
   * Obter ID do usuário logado
   */
  function getUserId() {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return user.id || user.cdcadastro || user.CDCADASTRO || user.userId;
    } catch (err) {
      console.warn('Erro ao obter ID do usuário:', err);
      return null;
    }
  }

  /**
   * Carregar SOS do servidor
   */
  async function carregarSOS(semOverlay) {
    try {
      if (!semOverlay) mostrarLoading(true);

      // Construir query string com filtros
      const params = new URLSearchParams();
      if (filtrosAtivos.status) params.append('status', filtrosAtivos.status);
      if (filtrosAtivos.dataInicio) params.append('dataInicio', filtrosAtivos.dataInicio);
      if (filtrosAtivos.dataFim) params.append('dataFim', filtrosAtivos.dataFim);
      if (filtrosAtivos.idViagem) params.append('idViagem', filtrosAtivos.idViagem);
      if (filtrosAtivos.idMotorista) params.append('idMotorista', filtrosAtivos.idMotorista);
      
      params.append('limit', itensPorPagina);
      params.append('offset', (paginaAtual - 1) * itensPorPagina);

      const response = await fetch(`/api/sos?${params.toString()}`, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        sosList = data.data || [];
        totalItens = data.total || 0;
        
        renderizarSOS();
        atualizarEstatisticas();
        atualizarPaginacao();
      } else {
        throw new Error(data.error || 'Erro ao carregar SOS');
      }
    } catch (err) {
      console.error('Erro ao carregar SOS:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
      sosListEl.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-error-circle'></i>
          <h3>Erro ao carregar alertas SOS</h3>
          <p>${err.message}</p>
        </div>
      `;
    } finally {
      mostrarLoading(false);
    }
  }

  /**
   * Renderizar lista de SOS
   */
  function renderizarSOS() {
    if (sosList.length === 0) {
      sosListEl.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-error-circle'></i>
          <h3>Nenhum alerta SOS encontrado</h3>
          <p>Não há alertas SOS que correspondam aos filtros selecionados.</p>
        </div>
      `;
      return;
    }

    sosListEl.innerHTML = sosList.map(sos => criarCardSOS(sos)).join('');
    
    // Adicionar event listeners aos cards
    sosList.forEach((sos, index) => {
      const card = sosListEl.children[index];
      if (card) {
        card.addEventListener('click', () => abrirDetalhesSOS(sos));
      }
    });
  }

  /**
   * Criar card HTML para um SOS
   */
  function criarCardSOS(sos) {
    const statusClass = (sos.STATUS || 'active').toLowerCase().replace('_', '-');
    const naoLidoClass = !sos.DH_LEITURA ? 'nao-lido' : '';
    const resolvidoClass = sos.STATUS === 'resolved' ? 'resolvido' : '';
    
    const dataFormatada = formatarData(sos.CREATED_AT);
    const horaFormatada = formatarHora(sos.CREATED_AT);
    
    // Traduzir status
    let statusTexto = sos.STATUS || 'Ativo';
    if (statusTexto === 'active') statusTexto = 'Ativo';
    if (statusTexto === 'in_progress') statusTexto = 'Em Tratamento';
    if (statusTexto === 'resolved') statusTexto = 'Resolvido';
    if (statusTexto === 'cancelled') statusTexto = 'Cancelado';
    
    return `
      <div class="sos-card ${resolvidoClass} ${naoLidoClass}" data-id="${sos.ID}">
        <div class="sos-header-card">
          <div>
            <span class="sos-status-badge ${statusClass}">${statusTexto}</span>
          </div>
          <div style="text-align: right; font-size: 12px; color: #6c757d;">
            ${dataFormatada}<br>${horaFormatada}
          </div>
        </div>
        <div class="sos-message">
          ${sos.MESSAGE || 'Alerta de emergência acionado pelo motorista'}
        </div>
        <div class="sos-details">
          ${sos.NOME_MOTORISTA ? `<div class="sos-detail-item"><i class='bx bx-user'></i> ${sos.NOME_MOTORISTA}</div>` : ''}
          ${sos.CELULAR_MOTORISTA ? `
            <div class="sos-detail-item" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <i class='bx bx-phone'></i>
              <span>${formatarTelefone(sos.CELULAR_MOTORISTA)}</span>
              <button 
                onclick="event.stopPropagation(); abrirWhatsAppSOS('${sos.CELULAR_MOTORISTA}', '${sos.NOME_MOTORISTA || 'Motorista'}')" 
                style="
                  background: #25D366; 
                  color: white; 
                  border: none; 
                  border-radius: 4px; 
                  padding: 4px 8px; 
                  cursor: pointer; 
                  display: inline-flex; 
                  align-items: center; 
                  gap: 4px; 
                  font-size: 11px; 
                  font-weight: 600;
                  transition: all 0.2s;
                  margin-left: 5px;
                "
                onmouseover="this.style.background='#20BA5A'"
                onmouseout="this.style.background='#25D366'"
                title="Abrir WhatsApp"
              >
                <i class='bx bxl-whatsapp' style="font-size: 14px;"></i>
              </button>
            </div>
          ` : ''}
          ${sos.IDVIAGEM ? `<div class="sos-detail-item"><i class='bx bx-map'></i> Viagem: ${sos.IDVIAGEM}</div>` : ''}
          ${sos.LATITUDE && sos.LONGITUDE ? `<div class="sos-detail-item"><i class='bx bx-navigation'></i> Lat: ${parseFloat(sos.LATITUDE).toFixed(6)}, Lng: ${parseFloat(sos.LONGITUDE).toFixed(6)}</div>` : ''}
          ${sos.LOCATION_DESCRIPTION ? `<div class="sos-detail-item" style="width: 100%; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e9ecef;"><i class='bx bx-map-pin'></i> <strong>Local:</strong> ${sos.LOCATION_DESCRIPTION}</div>` : ''}
          ${sos.TEMPO_RESPOSTA ? `<div class="sos-detail-item"><i class='bx bx-time-five'></i> Tempo de resposta: ${formatarTempoResposta(sos.TEMPO_RESPOSTA)}</div>` : ''}
        </div>
        <div class="sos-actions">
          ${!sos.DH_LEITURA ? `
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); marcarComoLido(${sos.ID})">
              <i class='bx bx-check'></i> Marcar como Lido
            </button>
          ` : ''}
          ${sos.STATUS === 'active' || sos.STATUS === 'in_progress' ? `
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); tratarSOS(${sos.ID})">
              <i class='bx bx-check-double'></i> ${sos.STATUS === 'in_progress' ? 'Atualizar' : 'Tratar'}
            </button>
          ` : ''}
          <button class="btn btn-sm btn-info" onclick="event.stopPropagation(); verHistorico(${sos.ID})">
            <i class='bx bx-history'></i> Histórico
          </button>
          ${sos.LATITUDE && sos.LONGITUDE ? `
            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); verLocalizacao(${sos.ID}, ${sos.LATITUDE}, ${sos.LONGITUDE})">
              <i class='bx bx-map'></i> Ver Localização
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Formatar tempo de resposta (em minutos)
   */
  function formatarTempoResposta(minutos) {
    if (!minutos) return 'N/A';
    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    if (horas > 0) {
      return `${horas}h ${mins}min`;
    }
    return `${mins}min`;
  }

  /**
   * Aplicar filtros
   */
  window.aplicarFiltros = function() {
    try {
      console.log('🔍 Aplicando filtros SOS...');
      
      // Coletar valores dos filtros
      const filtroStatusEl = document.getElementById('filtroStatus');
      const filtroDataInicioEl = document.getElementById('filtroDataInicio');
      const filtroDataFimEl = document.getElementById('filtroDataFim');
      const filtroIdViagemEl = document.getElementById('filtroIdViagem');
      const filtroIdMotoristaEl = document.getElementById('filtroIdMotorista');
      
      if (!filtroStatusEl) {
        console.error('❌ Elementos de filtro não encontrados');
        mostrarMensagem(t('web.modulos.sos.erroCarregar'), 'error');
        return;
      }
      
      const status = filtroStatusEl.value?.trim() || '';
      const dataInicio = filtroDataInicioEl?.value?.trim() || '';
      const dataFim = filtroDataFimEl?.value?.trim() || '';
      const idViagem = filtroIdViagemEl?.value?.trim() || '';
      const idMotorista = filtroIdMotoristaEl?.value?.trim() || '';
      
      console.log('📋 Valores dos filtros:', { status, dataInicio, dataFim, idViagem, idMotorista });
      
      // Criar objeto de filtros apenas com valores não vazios
      filtrosAtivos = {};
      if (status) filtrosAtivos.status = status;
      if (dataInicio) filtrosAtivos.dataInicio = dataInicio;
      if (dataFim) filtrosAtivos.dataFim = dataFim;
      if (idViagem) filtrosAtivos.idViagem = idViagem;
      if (idMotorista) filtrosAtivos.idMotorista = idMotorista;
      
      console.log('✅ Filtros ativos:', filtrosAtivos);
      
      paginaAtual = 1;
      carregarSOS();
    } catch (err) {
      console.error('❌ Erro ao aplicar filtros:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Limpar filtros
   */
  window.limparFiltros = function() {
    try {
      console.log('🧹 Limpando filtros SOS...');
      
      // Limpar todos os campos de filtro
      const filtroStatus = document.getElementById('filtroStatus');
      const filtroDataInicio = document.getElementById('filtroDataInicio');
      const filtroDataFim = document.getElementById('filtroDataFim');
      const filtroIdViagem = document.getElementById('filtroIdViagem');
      const filtroIdMotorista = document.getElementById('filtroIdMotorista');
      
      if (filtroStatus) filtroStatus.value = '';
      if (filtroDataInicio) filtroDataInicio.value = '';
      if (filtroDataFim) filtroDataFim.value = '';
      if (filtroIdViagem) filtroIdViagem.value = '';
      if (filtroIdMotorista) filtroIdMotorista.value = '';
      
      // Limpar filtros ativos e recarregar
      filtrosAtivos = {};
      paginaAtual = 1;
      
      console.log('✅ Filtros limpos, recarregando SOS...');
      carregarSOS();
    } catch (err) {
      console.error('❌ Erro ao limpar filtros:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Marcar SOS como lido
   */
  window.marcarComoLido = async function(idSOS) {
    try {
      const idUsuario = getUserId();
      const response = await fetch(`/api/sos/${idSOS}/ler`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idUsuario: idUsuario || undefined
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('SOS marcado como lido', 'success');
        carregarSOS(true);
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao marcar como lido');
      }
    } catch (err) {
      console.error('Erro ao marcar como lido:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    } finally {
      if (typeof mostrarLoading === 'function') mostrarLoading(false);
    }
  };

  /**
   * Formatar número de telefone brasileiro
   * @param {string} numero - Número de telefone (ex: 41999409022)
   * @returns {string} Número formatado (ex: (41) 99940-9022)
   */
  function formatarTelefone(numero) {
    if (!numero) return '';
    
    // Remover caracteres não numéricos
    const apenasNumeros = numero.toString().replace(/\D/g, '');
    
    // Formatar baseado no tamanho
    if (apenasNumeros.length === 11) {
      // Celular: (XX) XXXXX-XXXX
      return `(${apenasNumeros.substring(0, 2)}) ${apenasNumeros.substring(2, 7)}-${apenasNumeros.substring(7)}`;
    } else if (apenasNumeros.length === 10) {
      // Fixo: (XX) XXXX-XXXX
      return `(${apenasNumeros.substring(0, 2)}) ${apenasNumeros.substring(2, 6)}-${apenasNumeros.substring(6)}`;
    }
    
    // Se não tiver 10 ou 11 dígitos, retornar como está
    return numero;
  }

  /**
   * Obter número para WhatsApp (apenas números, com código do país)
   * @param {string} numero - Número de telefone
   * @returns {string} Número formatado para WhatsApp (ex: 5541999409022)
   */
  function obterNumeroWhatsApp(numero) {
    if (!numero) return '';
    let apenasNumeros = numero.toString().replace(/\D/g, '');
    if (apenasNumeros.startsWith('0')) apenasNumeros = apenasNumeros.substring(1);
    if (apenasNumeros.length >= 12) return apenasNumeros; // Já tem DDI (55, 595, 54, etc.)
    if (apenasNumeros.length >= 10) return '55' + apenasNumeros; // Brasil sem DDI
    return apenasNumeros;
  }

  /**
   * Abrir WhatsApp
   * @param {string} numero - Número de telefone
   * @param {string} mensagem - Mensagem opcional
   */
  function abrirWhatsApp(numero, mensagem = '') {
    const numeroWhatsApp = obterNumeroWhatsApp(numero);
    const mensagemEncoded = encodeURIComponent(mensagem);
    const url = `https://wa.me/${numeroWhatsApp}${mensagem ? '?text=' + mensagemEncoded : ''}`;
    window.open(url, '_blank');
  }

  /**
   * Abrir WhatsApp (função global para uso no onclick)
   */
  window.abrirWhatsAppSOS = function(numero, nomeMotorista) {
    const mensagem = `Olá ${nomeMotorista || 'Motorista'}, estou entrando em contato sobre o alerta SOS.`;
    abrirWhatsApp(numero, mensagem);
  };

  /**
   * Carregar biblioteca Leaflet dinamicamente
   */
  async function carregarLeaflet() {
    return new Promise((resolve, reject) => {
      if (window.L && window.L.map) {
        resolve();
        return;
      }

      // Verificar se já existe um script do Leaflet
      const existingScript = document.querySelector('script[src*="leaflet"]');
      if (existingScript) {
        const checkInterval = setInterval(() => {
          if (window.L && window.L.map) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Timeout ao carregar Leaflet'));
        }, 10000);
        return;
      }

      // Carregar CSS do Leaflet
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);

      // Carregar JavaScript do Leaflet
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = () => {
        const checkInterval = setInterval(() => {
          if (window.L && window.L.map) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Leaflet carregado mas L não está disponível'));
        }, 5000);
      };
      script.onerror = () => reject(new Error('Erro ao carregar o script do Leaflet'));
      document.head.appendChild(script);
    });
  }

  /**
   * Buscar endereço via Nominatim
   */
  async function buscarEnderecoNominatim(lat, lon) {
    try {
      const response = await fetch(`/api/sos/geocodificar/${lat}/${lon}`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      
      if (data.success && data.data) {
        return data.data.display_name || `Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      }
      return `Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    } catch (err) {
      console.warn('Erro ao buscar endereço:', err);
      return `Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
  }

  /**
   * Formatar número de telefone brasileiro
   * @param {string} numero - Número de telefone (ex: 41999409022)
   * @returns {string} Número formatado (ex: (41) 99940-9022)
   */
  function formatarTelefone(numero) {
    if (!numero) return '';
    
    // Remover caracteres não numéricos
    const apenasNumeros = numero.toString().replace(/\D/g, '');
    
    // Formatar baseado no tamanho
    if (apenasNumeros.length === 11) {
      // Celular: (XX) XXXXX-XXXX
      return `(${apenasNumeros.substring(0, 2)}) ${apenasNumeros.substring(2, 7)}-${apenasNumeros.substring(7)}`;
    } else if (apenasNumeros.length === 10) {
      // Fixo: (XX) XXXX-XXXX
      return `(${apenasNumeros.substring(0, 2)}) ${apenasNumeros.substring(2, 6)}-${apenasNumeros.substring(6)}`;
    }
    
    // Se não tiver 10 ou 11 dígitos, retornar como está
    return numero;
  }

  /**
   * Obter número para WhatsApp (apenas números, com código do país)
   * @param {string} numero - Número de telefone
   * @returns {string} Número formatado para WhatsApp (ex: 5541999409022)
   */
  function obterNumeroWhatsApp(numero) {
    if (!numero) return '';
    let apenasNumeros = numero.toString().replace(/\D/g, '');
    if (apenasNumeros.startsWith('0')) apenasNumeros = apenasNumeros.substring(1);
    if (apenasNumeros.length >= 12) return apenasNumeros; // Já tem DDI (55, 595, 54, etc.)
    if (apenasNumeros.length >= 10) return '55' + apenasNumeros; // Brasil sem DDI
    return apenasNumeros;
  }

  /**
   * Abrir WhatsApp
   * @param {string} numero - Número de telefone
   * @param {string} mensagem - Mensagem opcional
   */
  function abrirWhatsApp(numero, mensagem = '') {
    const numeroWhatsApp = obterNumeroWhatsApp(numero);
    const mensagemEncoded = encodeURIComponent(mensagem);
    const url = `https://wa.me/${numeroWhatsApp}${mensagem ? '?text=' + mensagemEncoded : ''}`;
    window.open(url, '_blank');
  }

  /**
   * Inicializar mapa Leaflet
   */
  let mapaSOSTratamento = null;
  async function inicializarMapaSOS(lat, lon) {
    try {
      console.log('🗺️ Iniciando mapa SOS...', { lat, lon });
      
      await carregarLeaflet();
      
      // Limpar mapa anterior se existir
      if (mapaSOSTratamento) {
        mapaSOSTratamento.remove();
        mapaSOSTratamento = null;
      }

      // Aguardar mais tempo para garantir que o modal está visível e o elemento existe
      await new Promise(resolve => setTimeout(resolve, 500));

      const mapaDiv = document.getElementById('mapaSOSTratamento');
      if (!mapaDiv) {
        console.error('❌ Elemento do mapa não encontrado!');
        return;
      }

      // Garantir que o elemento tem altura (igual ao CSS do modal compacto)
      if (!mapaDiv.style.height || mapaDiv.style.height === '0px') {
        mapaDiv.style.height = '280px';
        console.log('📏 Altura do mapa definida para 280px');
      }

      // Verificar se o elemento está visível
      const isVisible = mapaDiv.offsetWidth > 0 && mapaDiv.offsetHeight > 0;
      if (!isVisible) {
        console.warn('⚠️ Elemento do mapa não está visível ainda, aguardando...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('🗺️ Criando mapa Leaflet...');
      
      // Criar mapa
      mapaSOSTratamento = L.map('mapaSOSTratamento', {
        preferCanvas: false
      }).setView([lat, lon], 15);

      // Adicionar camada de tiles
      // Usar getTileServerUrl() que já trata HTTP/HTTPS corretamente
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      console.log('🗺️ Adicionando tiles:', tileServer);
      console.log('🗺️ MAP_CONFIG disponível:', !!window.MAP_CONFIG);
      
      try {
        // Configuração do tileLayer com subdomínios se necessário
        const tileOptions = {
          attribution: window.MAP_CONFIG?.attribution || '© OpenStreetMap contributors',
          maxZoom: window.MAP_CONFIG?.maxZoom || 19,
          timeout: 10000,
          crossOrigin: true
        };
        
        // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
        if (tileServer.includes('{s}')) {
          tileOptions.subdomains = ['a', 'b', 'c'];
        }
        
        const tileLayer = L.tileLayer(tileServer, tileOptions);
        
        tileLayer.addTo(mapaSOSTratamento);
        console.log('✅ TileLayer adicionado ao mapa');
        
        // Verificar se os tiles estão carregando
        tileLayer.on('tileerror', (error, tile) => {
          console.error('❌ Erro ao carregar tile:', error, tile);
          console.error('❌ URL do tile:', tile?.src);
        });
        
        tileLayer.on('tileload', (event) => {
          console.log('✅ Tile carregado:', event.tile.src);
        });
        
        tileLayer.on('load', () => {
          console.log('✅ Todas as tiles carregadas');
        });
      } catch (err) {
        console.error('❌ Erro ao criar tileLayer:', err);
        throw err;
      }

      // Adicionar marcador
      const marcador = L.marker([lat, lon], {
        icon: L.icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        })
      }).addTo(mapaSOSTratamento);

      // Adicionar popup com coordenadas
      marcador.bindPopup(`
        <strong>Localização do SOS</strong><br>
        Lat: ${lat.toFixed(6)}<br>
        Lon: ${lon.toFixed(6)}
      `).openPopup();

      // Forçar atualização do mapa após um delay
      setTimeout(() => {
        if (mapaSOSTratamento) {
          mapaSOSTratamento.invalidateSize();
          console.log('✅ Tamanho do mapa atualizado');
        }
      }, 300);
      
      console.log('✅ Mapa SOS inicializado com sucesso');
    } catch (err) {
      console.error('❌ Erro ao inicializar mapa:', err);
      console.error('❌ Stack:', err.stack);
    }
  }

  /**
   * Tratar SOS
   */
  window.tratarSOS = async function(idSOS) {
    try {
      // Buscar detalhes do SOS
      const response = await fetch(`/api/sos/${idSOS}`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      
      if (!data.success || !data.data) {
        throw new Error('SOS não encontrado');
      }

      const sos = data.data;

      if (sos.STATUS === 'resolved' || sos.STATUS === 'cancelled') {
        mostrarMensagem('Este SOS já foi resolvido ou cancelado. Não é possível editar.', 'info');
        return;
      }

      // Modal igual ao Tratar Alerta (Alertas do Sistema): só título, mensagem, status, observações e botões
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 class="modal-tratamento-title">Alerta SOS #${sos.ID}</h4>
          <p class="modal-tratamento-desc">${sos.MESSAGE || 'Alerta de emergência acionado pelo motorista'}</p>
        </div>
        <form id="formTratamento" onsubmit="event.preventDefault(); salvarTratamento(${idSOS})">
          <div class="input-group">
            <label for="novoStatus">Novo Status</label>
            <select id="novoStatus" class="form-control" required>
              <option value="in_progress" ${sos.STATUS === 'in_progress' ? 'selected' : ''}>Em Tratamento</option>
              <option value="resolved" ${sos.STATUS === 'resolved' ? 'selected' : ''}>Resolvido</option>
              <option value="cancelled" ${sos.STATUS === 'cancelled' ? 'selected' : ''}>Cancelado</option>
            </select>
          </div>
          <div class="input-group">
            <label for="observacoes">Observações</label>
            <textarea id="observacoes" class="form-control" rows="4" placeholder="Descreva as ações tomadas...">${sos.RESOLUTION_NOTES || ''}</textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="fecharModalTratamento()">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar</button>
          </div>
        </form>
      `;

      modalTratamento.querySelector('.modal-content-tratamento').classList.remove('modal-historico');
      modalTratamento.classList.add('active');
    } catch (err) {
      console.error('Erro ao abrir tratamento:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Salvar tratamento
   */
  window.salvarTratamento = async function(idSOS) {
    try {
      const novoStatus = document.getElementById('novoStatus').value;
      const observacoes = document.getElementById('observacoes').value;
      const idUsuario = getUserId();

      const response = await fetch(`/api/sos/${idSOS}/tratar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status: novoStatus,
          observacoes: observacoes,
          idUsuario: idUsuario || undefined
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('SOS tratado com sucesso', 'success');
        fecharModalTratamento();
        carregarSOS(true);
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao tratar SOS');
      }
    } catch (err) {
      console.error('Erro ao salvar tratamento:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    } finally {
      if (typeof mostrarLoading === 'function') mostrarLoading(false);
    }
  };

  /**
   * Abrir WhatsApp (função global para uso no onclick)
   */
  window.abrirWhatsAppSOS = function(numero, nomeMotorista) {
    const mensagem = `Olá ${nomeMotorista || 'Motorista'}, estou entrando em contato sobre o alerta SOS.`;
    abrirWhatsApp(numero, mensagem);
  };

  /**
   * Fechar modal de tratamento
   */
  window.fecharModalTratamento = function() {
    // Limpar mapa se existir
    if (mapaSOSTratamento) {
      mapaSOSTratamento.remove();
      mapaSOSTratamento = null;
    }
    modalTratamento.querySelector('.modal-content-tratamento').classList.remove('modal-historico');
    modalTratamento.classList.remove('active');
  };

  /**
   * Ver histórico do SOS
   */
  window.verHistorico = async function(idSOS) {
    try {
      const response = await fetch(`/api/sos/${idSOS}/historico`, {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Erro ao carregar histórico');
      }

      const historico = data.data || [];
      
      if (historico.length === 0) {
        mostrarMensagem('Nenhum histórico encontrado para este SOS', 'info');
        return;
      }

      // Criar modal com histórico (igual ao Alertas do Sistema)
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 class="modal-tratamento-title">Histórico do SOS #${idSOS}</h4>
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
                  Status: <strong>${traduzirStatus(item.STATUS_ANTERIOR)}</strong> → <strong>${traduzirStatus(item.STATUS_NOVO)}</strong>
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
      
      modalTratamento.querySelector('.modal-content-tratamento').classList.add('modal-historico');
      modalTratamento.classList.add('active');
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Ver localização no mapa
   */
  /**
   * Inicializar mapa de localização
   */
  let mapaLocalizacao = null;
  async function inicializarMapaLocalizacao(lat, lon) {
    try {
      console.log('🗺️ Iniciando mapa de localização...', { lat, lon });
      
      // Verificar se Leaflet está disponível
      if (!window.L) {
        console.log('📦 Carregando Leaflet...');
        await carregarLeaflet();
      }
      
      if (!window.L || !window.L.map) {
        console.error('❌ Leaflet não está disponível após carregamento!');
        return;
      }
      
      console.log('✅ Leaflet carregado:', window.L);
      
      // Limpar mapa anterior se existir
      if (mapaLocalizacao) {
        try {
          mapaLocalizacao.remove();
        } catch (e) {
          console.warn('Aviso ao remover mapa anterior:', e);
        }
        mapaLocalizacao = null;
      }

      // Aguardar mais tempo para garantir que o modal está visível e o elemento existe
      await new Promise(resolve => setTimeout(resolve, 500));

      const mapaDiv = document.getElementById('mapaLocalizacao');
      if (!mapaDiv) {
        console.error('❌ Elemento do mapa de localização não encontrado!');
        return;
      }
      
      // Garantir que o elemento está visível
      mapaDiv.style.display = 'block';
      mapaDiv.style.visibility = 'visible';

      // Garantir que o elemento tem altura
      if (!mapaDiv.style.height || mapaDiv.style.height === '0px') {
        mapaDiv.style.height = '500px';
        console.log('📏 Altura do mapa de localização definida para 500px');
      }

      // Verificar se o elemento está visível
      const isVisible = mapaDiv.offsetWidth > 0 && mapaDiv.offsetHeight > 0;
      if (!isVisible) {
        console.warn('⚠️ Elemento do mapa de localização não está visível ainda, aguardando...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('🗺️ Criando mapa Leaflet de localização...');
      
      // Criar mapa
      mapaLocalizacao = L.map('mapaLocalizacao', {
        preferCanvas: false
      }).setView([lat, lon], 15);

      // Adicionar camada de tiles
      // Usar getTileServerUrl() que já trata HTTP/HTTPS corretamente
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      console.log('🗺️ Adicionando tiles:', tileServer);
      console.log('🗺️ MAP_CONFIG disponível:', !!window.MAP_CONFIG);
      
      try {
        // Configuração do tileLayer com subdomínios se necessário
        const tileOptions = {
          attribution: window.MAP_CONFIG?.attribution || '© OpenStreetMap contributors',
          maxZoom: window.MAP_CONFIG?.maxZoom || 19,
          timeout: 10000,
          crossOrigin: true
        };
        
        // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
        if (tileServer.includes('{s}')) {
          tileOptions.subdomains = ['a', 'b', 'c'];
        }
        
        const tileLayer = L.tileLayer(tileServer, tileOptions);
        
        tileLayer.addTo(mapaLocalizacao);
        console.log('✅ TileLayer adicionado ao mapa de localização');
        
        // Verificar se os tiles estão carregando
        tileLayer.on('tileerror', (error, tile) => {
          console.error('❌ Erro ao carregar tile:', error, tile);
          console.error('❌ URL do tile:', tile?.src);
        });
        
        tileLayer.on('tileload', (event) => {
          console.log('✅ Tile carregado:', event.tile.src);
        });
        
        tileLayer.on('load', () => {
          console.log('✅ Todas as tiles carregadas');
        });
      } catch (err) {
        console.error('❌ Erro ao criar tileLayer:', err);
        throw err;
      }

      // Adicionar marcador
      const marcador = L.marker([lat, lon], {
        icon: L.icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        })
      }).addTo(mapaLocalizacao);

      // Adicionar popup com coordenadas
      marcador.bindPopup(`
        <strong>Localização do SOS</strong><br>
        Lat: ${lat.toFixed(6)}<br>
        Lon: ${lon.toFixed(6)}
      `).openPopup();

      // Forçar atualização do mapa após um delay
      setTimeout(() => {
        if (mapaLocalizacao) {
          mapaLocalizacao.invalidateSize();
          console.log('✅ Tamanho do mapa de localização atualizado');
        }
      }, 300);
      
      console.log('✅ Mapa de localização inicializado com sucesso');
    } catch (err) {
      console.error('❌ Erro ao inicializar mapa de localização:', err);
      console.error('❌ Stack:', err.stack);
    }
  }

  /**
   * Ver localização do SOS em um modal com mapa
   */
  window.verLocalizacao = async function(idSOS, latitude, longitude) {
    try {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      
      if (isNaN(lat) || isNaN(lon)) {
        mostrarMensagem('Coordenadas GPS inválidas', 'error');
        return;
      }

      // Abrir modal
      const modalLocalizacao = document.getElementById('modalLocalizacao');
      const enderecoEl = document.getElementById('enderecoLocalizacao');
      const coordenadasEl = document.getElementById('coordenadasLocalizacao');
      
      if (!modalLocalizacao || !enderecoEl || !coordenadasEl) {
        mostrarMensagem(t('web.modulos.sos.erroCarregar'), 'error');
        return;
      }

      coordenadasEl.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      modalLocalizacao.style.display = 'block';
      await new Promise(resolve => setTimeout(resolve, 300));
      enderecoEl.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Buscando endereço...';
      try {
        const endereco = await buscarEnderecoNominatim(lat, lon);
        enderecoEl.textContent = endereco;
      } catch (err) {
        console.warn('Erro ao buscar endereço:', err);
        enderecoEl.textContent = 'Não foi possível obter o endereço.';
      }
      
      // Inicializar mapa após o modal estar visível
      await inicializarMapaLocalizacao(lat, lon);
      
    } catch (err) {
      console.error('Erro ao abrir localização:', err);
      mostrarMensagem(t('web.modulos.sos.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Fechar modal de localização
   */
  window.fecharModalLocalizacao = function() {
    if (mapaLocalizacao) {
      mapaLocalizacao.remove();
      mapaLocalizacao = null;
    }
    const modalLocalizacao = document.getElementById('modalLocalizacao');
    if (modalLocalizacao) modalLocalizacao.style.display = 'none';
  };

  const modalLocalizacaoEl = document.getElementById('modalLocalizacao');
  if (modalLocalizacaoEl) {
    modalLocalizacaoEl.addEventListener('click', (e) => {
      if (e.target === modalLocalizacaoEl) fecharModalLocalizacao();
    });
  }

  /**
   * Abrir detalhes do SOS
   */
  async function abrirDetalhesSOS(sos) {
    if (sos.STATUS === 'resolved' || sos.STATUS === 'cancelled') {
      await verHistorico(sos.ID);
      return;
    }
    await tratarSOS(sos.ID);
  }

  /**
   * Atualizar estatísticas
   */
  async function atualizarEstatisticas() {
    try {
      // Buscar contadores
      const response = await fetch('/api/sos/contador', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        // Garantir que os valores sejam números
        const ativos = parseInt(data.data.ativos) || 0;
        const emTratamento = parseInt(data.data.emTratamento) || 0;
        const resolvidos = parseInt(data.data.resolvidos) || 0;
        const total = parseInt(data.data.total) || 0;
        
        // Atualizar elementos
        const statAtivos = document.getElementById('statAtivos');
        const statEmTratamento = document.getElementById('statEmTratamento');
        const statResolvidos = document.getElementById('statResolvidos');
        const statTotal = document.getElementById('statTotal');
        
        if (statAtivos) statAtivos.textContent = ativos;
        if (statEmTratamento) statEmTratamento.textContent = emTratamento;
        if (statResolvidos) statResolvidos.textContent = resolvidos;
        if (statTotal) statTotal.textContent = total;
        
        console.log('📊 Estatísticas SOS atualizadas:', { ativos, emTratamento, resolvidos, total });
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
      const response = await fetch('/api/sos/contador', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        return; // Silenciosamente falhar se não conseguir atualizar
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        const ativos = parseInt(data.data.ativos) || 0;
        const emTratamento = parseInt(data.data.emTratamento) || 0;
        // Badge mostra ativos + em tratamento (total de SOS que precisam atenção)
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
        // Header do dashboard (mesmo critério que dashboard.js atualizarContadorSOS)
        const headerBadgeSos = document.getElementById('headerBadgeSos');
        if (headerBadgeSos) {
          headerBadgeSos.textContent = totalPendentes > 99 ? '99+' : totalPendentes.toString();
          headerBadgeSos.style.display = totalPendentes > 0 ? 'inline-flex' : 'none';
          headerBadgeSos.setAttribute('data-count', totalPendentes);
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
      carregarSOS();
    }
  };

  /**
   * Paginar próximo
   */
  window.paginarProximo = function() {
    const totalPaginas = Math.ceil(totalItens / itensPorPagina);
    if (paginaAtual < totalPaginas) {
      paginaAtual++;
      carregarSOS();
    }
  };

  /**
   * Recarregar SOS
   */
  window.recarregarSOS = function() {
    console.log('🔄 Recarregando SOS manualmente...');
    carregarSOS();
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
      console.log('✅ WebSocket SOS já conectado');
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
        reconnectionDelay: 1000,
        auth: { token: localStorage.getItem('token') || '' }
      });

      socket.on('connect', () => {
        console.log('✅ WebSocket SOS conectado:', socket.id);
        estaConectado = true;
      });

      socket.on('disconnect', () => {
        console.log('⚠️ WebSocket SOS desconectado');
        estaConectado = false;
      });

      // Escutar eventos de SOS
      socket.on('sos:novo', (sos) => {
        console.log('🚨 Novo SOS recebido:', sos);
        mostrarMensagem(`🚨 NOVO ALERTA SOS: ${sos.MESSAGE || 'Emergência acionada'}`, 'error');
        tocarSomNotificacao('sos');
        carregarSOS();
        atualizarContadorMenu();
      });

      socket.on('sos:atualizado', (sos) => {
        console.log('📝 SOS atualizado:', sos);
        carregarSOS();
        atualizarContadorMenu();
      });

      socket.on('sos:resolvido', (data) => {
        console.log('✅ SOS resolvido:', data);
        carregarSOS();
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
    const loc = contextoSos.locale || 'pt-BR';
    const tz = contextoSos.timezone || 'America/Sao_Paulo';
    try {
      return new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: 'short' }).format(data);
    } catch (e) { return data.toLocaleDateString(loc); }
  }

  function formatarHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return 'N/A';
    const loc = contextoSos.locale || 'pt-BR';
    const tz = contextoSos.timezone || 'America/Sao_Paulo';
    return data.toLocaleTimeString(loc, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  }

  function formatarDataHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return 'N/A';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(data, contextoSos.locale, contextoSos.timezone, { dateStyle: 'short', timeStyle: 'short' });
    }
    return data.toLocaleString(contextoSos.locale || 'pt-BR', { timeZone: contextoSos.timezone || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  }

  /**
   * Traduzir status para português
   */
  function traduzirStatus(status) {
    if (!status) return 'N/A';
    const statusMap = {
      'active': 'Ativo',
      'in_progress': 'Em Tratamento',
      'resolved': 'Resolvido',
      'cancelled': 'Cancelado'
    };
    return statusMap[status.toLowerCase()] || status;
  }

  // Modal de tratamento NÃO fecha ao clicar fora (evita fechar por acidente; só fecha em Cancelar/Salvar/X)

  /**
   * Toggle som de notificação
   */
  window.toggleSomNotificacaoSOS = function() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const novoEstado = !somHabilitado;
    localStorage.setItem('notificacao_som', novoEstado.toString());
    
    const btn = document.getElementById('btnToggleSomSOS');
    if (btn) {
      if (novoEstado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.sos.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.sos.som');
        btn.title = 'Som desativado (clique para ativar)';
      }
    }
    
    // Tocar som de teste se ativou
    if (novoEstado) {
      tocarSomNotificacao('sos');
    }
  };

  /**
   * Atualizar estado do botão de som
   */
  function atualizarEstadoBotaoSom() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const btn = document.getElementById('btnToggleSomSOS');
    if (btn) {
      if (somHabilitado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.sos.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.sos.som');
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
