// backend/public/modulos/sos/js/script.js
// Módulo de SOS - Frontend Completo
// Versão: 2.0
// Data: 2025-01-18
//
// Este módulo gerencia a visualização, filtragem e tratamento de alertas SOS (emergências).
// Inclui integração com WebSocket para atualizações em tempo real.
// Segue o mesmo padrão visual e funcional do módulo Alertas.

(function() {
  'use strict';

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
  function inicializar() {
    console.log('🚨 Módulo SOS inicializando...');
    
    // Carregar SOS
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
  async function carregarSOS() {
    try {
      mostrarLoading(true);
      
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
      mostrarMensagem('Erro ao carregar alertas SOS: ' + err.message, 'error');
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
        mostrarMensagem('Erro: Elementos de filtro não encontrados', 'error');
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
      mostrarMensagem('Erro ao aplicar filtros: ' + err.message, 'error');
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
      mostrarMensagem('Erro ao limpar filtros: ' + err.message, 'error');
    }
  };

  /**
   * Marcar SOS como lido
   */
  window.marcarComoLido = async function(idSOS) {
    try {
      const idUsuario = getUserId();

      if (!idUsuario) {
        mostrarMensagem('Erro: ID do usuário não encontrado. Faça login novamente.', 'error');
        return;
      }

      const response = await fetch(`/api/sos/${idSOS}/ler`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idUsuario: idUsuario
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('SOS marcado como lido', 'success');
        carregarSOS();
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao marcar como lido');
      }
    } catch (err) {
      console.error('Erro ao marcar como lido:', err);
      mostrarMensagem('Erro ao marcar como lido: ' + err.message, 'error');
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
    
    // Remover caracteres não numéricos
    let apenasNumeros = numero.toString().replace(/\D/g, '');
    
    // Se não começar com 55 (código do Brasil), adicionar
    if (!apenasNumeros.startsWith('55')) {
      apenasNumeros = '55' + apenasNumeros;
    }
    
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
    
    // Remover caracteres não numéricos
    let apenasNumeros = numero.toString().replace(/\D/g, '');
    
    // Se não começar com 55 (código do Brasil), adicionar
    if (!apenasNumeros.startsWith('55')) {
      apenasNumeros = '55' + apenasNumeros;
    }
    
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

      // Garantir que o elemento tem altura
      if (!mapaDiv.style.height || mapaDiv.style.height === '0px') {
        mapaDiv.style.height = '500px';
        console.log('📏 Altura do mapa definida para 500px');
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
      const lat = parseFloat(sos.LATITUDE);
      const lon = parseFloat(sos.LONGITUDE);
      
      // Criar formulário de tratamento com layout de dois lados
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 10px; color: #2c3e50; font-size: 18px; font-weight: 600;">Alerta SOS #${sos.ID}</h4>
          <p style="color: #6c757d; margin-bottom: 15px; line-height: 1.5;">${sos.MESSAGE || 'Alerta de emergência acionado pelo motorista'}</p>
          ${sos.NOME_MOTORISTA ? `<p style="color: #495057; margin-bottom: 5px;"><strong>Motorista:</strong> ${sos.NOME_MOTORISTA}</p>` : ''}
          ${sos.CELULAR_MOTORISTA ? `
            <div style="color: #495057; margin-bottom: 5px; display: flex; align-items: center; gap: 10px;">
              <strong>Celular:</strong> 
              <span>${formatarTelefone(sos.CELULAR_MOTORISTA)}</span>
              <button 
                onclick="abrirWhatsAppSOS('${sos.CELULAR_MOTORISTA}', '${sos.NOME_MOTORISTA || 'Motorista'}')" 
                style="
                  background: #25D366; 
                  color: white; 
                  border: none; 
                  border-radius: 6px; 
                  padding: 6px 12px; 
                  cursor: pointer; 
                  display: inline-flex; 
                  align-items: center; 
                  gap: 6px; 
                  font-size: 13px; 
                  font-weight: 600;
                  transition: all 0.2s;
                "
                onmouseover="this.style.background='#20BA5A'; this.style.transform='translateY(-1px)'"
                onmouseout="this.style.background='#25D366'; this.style.transform='translateY(0)'"
                title="Abrir WhatsApp"
              >
                <i class='bx bxl-whatsapp' style="font-size: 18px;"></i> WhatsApp
              </button>
            </div>
          ` : ''}
          ${lat && lon ? `<p style="color: #495057; margin-bottom: 5px;"><strong>Localização (GPS):</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}</p>` : ''}
        </div>
        <div class="modal-tratamento-body">
          <div class="modal-tratamento-form">
            <form id="formTratamento" onsubmit="event.preventDefault(); salvarTratamento(${idSOS})">
              <div class="input-group">
                <label for="descricaoLocal">Descrição / Detalhes do Local</label>
                <textarea id="descricaoLocal" class="form-control" rows="4" readonly style="background-color: #f8f9fa; cursor: not-allowed;" placeholder="Buscando endereço..."></textarea>
                <small style="color: #6c757d; font-size: 12px; margin-top: 5px; display: block;">Endereço obtido automaticamente via geocodificação reversa</small>
              </div>
              <div class="input-group">
                <label for="novoStatus">Novo Status</label>
                <select id="novoStatus" class="form-control" required>
                  <option value="in_progress" ${sos.STATUS === 'in_progress' ? 'selected' : ''}>Em Tratamento</option>
                  <option value="resolved" ${sos.STATUS === 'resolved' ? 'selected' : ''}>Resolvido</option>
                  <option value="cancelled" ${sos.STATUS === 'cancelled' ? 'selected' : ''}>Cancelado</option>
                </select>
              </div>
              <div class="input-group">
                <label for="observacoes">Observações / Notas de Resolução</label>
                <textarea id="observacoes" class="form-control" rows="4" placeholder="Descreva as ações tomadas para resolver o SOS...">${sos.RESOLUTION_NOTES || ''}</textarea>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="fecharModalTratamento()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar</button>
              </div>
            </form>
          </div>
          <div class="modal-tratamento-mapa">
            <div id="mapaSOSTratamento"></div>
          </div>
        </div>
      `;
      
      modalTratamento.classList.add('active');
      
      // Buscar endereço e inicializar mapa se tiver coordenadas
      if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
        // Buscar endereço via Nominatim
        const endereco = await buscarEnderecoNominatim(lat, lon);
        const descricaoLocalEl = document.getElementById('descricaoLocal');
        if (descricaoLocalEl) {
          descricaoLocalEl.value = endereco;
        }
        
        // Inicializar mapa
        await inicializarMapaSOS(lat, lon);
      } else {
        const descricaoLocalEl = document.getElementById('descricaoLocal');
        if (descricaoLocalEl) {
          descricaoLocalEl.value = 'Coordenadas GPS não disponíveis';
        }
      }
    } catch (err) {
      console.error('Erro ao abrir tratamento:', err);
      mostrarMensagem('Erro ao carregar SOS: ' + err.message, 'error');
    }
  };

  /**
   * Salvar tratamento
   */
  window.salvarTratamento = async function(idSOS) {
    try {
      const novoStatus = document.getElementById('novoStatus').value;
      const observacoes = document.getElementById('observacoes').value;
      const descricaoLocal = document.getElementById('descricaoLocal').value;
      const idUsuario = getUserId();

      if (!idUsuario) {
        mostrarMensagem('Erro: ID do usuário não encontrado. Faça login novamente.', 'error');
        return;
      }

      const response = await fetch(`/api/sos/${idSOS}/tratar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status: novoStatus,
          observacoes: observacoes,
          locationDescription: descricaoLocal,
          idUsuario: idUsuario
        })
      });

      const data = await response.json();
      
      if (data.success) {
        mostrarMensagem('SOS tratado com sucesso', 'success');
        fecharModalTratamento();
        carregarSOS();
        atualizarContadorMenu();
      } else {
        throw new Error(data.error || 'Erro ao tratar SOS');
      }
    } catch (err) {
      console.error('Erro ao salvar tratamento:', err);
      mostrarMensagem('Erro ao tratar SOS: ' + err.message, 'error');
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

      // Criar modal com histórico
      modalTratamentoContent.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 10px; color: #2c3e50; font-size: 18px; font-weight: 600;">Histórico do SOS #${idSOS}</h4>
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
      
      modalTratamento.classList.add('active');
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      mostrarMensagem('Erro ao carregar histórico: ' + err.message, 'error');
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
        mostrarMensagem('Erro: Elementos do modal não encontrados', 'error');
        return;
      }

      // Atualizar coordenadas
      coordenadasEl.textContent = `Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      
      // Mostrar modal primeiro
      modalLocalizacao.classList.add('active');
      
      // Aguardar um pouco para o modal aparecer antes de inicializar o mapa
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Buscar endereço via Nominatim
      enderecoEl.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Buscando endereço...';
      
      try {
        const endereco = await buscarEnderecoNominatim(lat, lon);
        enderecoEl.innerHTML = `<strong>Endereço:</strong><br>${endereco}`;
      } catch (err) {
        console.warn('Erro ao buscar endereço:', err);
        enderecoEl.innerHTML = `<strong>Endereço:</strong><br>Não foi possível obter o endereço. Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      }
      
      // Inicializar mapa após o modal estar visível
      await inicializarMapaLocalizacao(lat, lon);
      
    } catch (err) {
      console.error('Erro ao abrir localização:', err);
      mostrarMensagem('Erro ao carregar localização: ' + err.message, 'error');
    }
  };

  /**
   * Fechar modal de localização
   */
  window.fecharModalLocalizacao = function() {
    // Limpar mapa se existir
    if (mapaLocalizacao) {
      mapaLocalizacao.remove();
      mapaLocalizacao = null;
    }
    const modalLocalizacao = document.getElementById('modalLocalizacao');
    if (modalLocalizacao) {
      modalLocalizacao.classList.remove('active');
    }
  };

  /**
   * Abrir detalhes do SOS
   */
  async function abrirDetalhesSOS(sos) {
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
        reconnectionDelay: 1000
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

  /**
   * Formatar data
   */
  function formatarData(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    return data.toLocaleDateString('pt-BR');
  }

  /**
   * Formatar hora
   */
  function formatarHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Formatar data e hora
   */
  function formatarDataHora(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    return data.toLocaleString('pt-BR');
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
          <i class='bx bx-info-circle' style="color: #e74c3c;"></i> Como Funcionam os Alertas SOS
        </h3>
        
        <div style="background: #fff5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #e74c3c;">
          <h4 style="margin: 0 0 10px 0; color: #c0392b;">🚨 O que são Alertas SOS?</h4>
          <p style="margin: 0; color: #721c24;">
            Os alertas SOS são <strong>emergências críticas</strong> acionadas pelos motoristas através do aplicativo móvel.
            São situações que requerem <strong>resposta imediata</strong> da equipe de operação.
          </p>
        </div>
        
        <h4 style="color: #2c3e50; margin-top: 25px; margin-bottom: 15px;">📋 Como Funciona?</h4>
        
        <div style="margin-bottom: 20px;">
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #e74c3c;">
              <i class='bx bx-error-circle'></i> Acionamento pelo Motorista
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              O motorista aciona o botão de <strong>emergência (SOS)</strong> no aplicativo móvel quando está em situação de risco ou precisa de ajuda urgente.
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #f39c12;">
              <i class='bx bx-map'></i> Localização GPS
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              O sistema captura automaticamente a <strong>localização GPS</strong> do motorista no momento do acionamento.
              As coordenadas são exibidas e podem ser abertas no Google Maps.
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #3498db;">
              <i class='bx bx-bell'></i> Notificação em Tempo Real
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              Quando um SOS é acionado, todos os operadores conectados recebem uma <strong>notificação imediata</strong> via WebSocket.
              O alerta aparece na lista com destaque visual.
            </p>
          </div>
          
          <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h5 style="margin: 0 0 10px 0; color: #2ecc71;">
              <i class='bx bx-check-double'></i> Resolução
            </h5>
            <p style="margin: 0 0 8px 0; color: #495057;">
              Após tomar as ações necessárias, o operador marca o SOS como <strong>Resolvido</strong>.
              O sistema calcula automaticamente o <strong>tempo de resposta</strong>.
            </p>
          </div>
        </div>
        
        <h4 style="color: #2c3e50; margin-top: 25px; margin-bottom: 15px;">📊 Status dos Alertas</h4>
        
        <div style="margin-bottom: 20px;">
          <div style="background: #fee; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
            <strong style="color: #c0392b;">Ativo</strong> - SOS acionado, aguardando resolução
          </div>
          <div style="background: #fff3cd; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
            <strong style="color: #856404;">Em Tratamento</strong> - SOS em processo de resolução (permite manter histórico)
          </div>
          <div style="background: #d4edda; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
            <strong style="color: #155724;">Resolvido</strong> - SOS tratado e resolvido
          </div>
          <div style="background: #e2e3e5; padding: 10px; border-radius: 6px;">
            <strong style="color: #383d41;">Cancelado</strong> - SOS cancelado (falso alarme, etc)
          </div>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h5 style="margin: 0 0 10px 0; color: #856404;">
            <i class='bx bx-info-circle'></i> Importante
          </h5>
          <ul style="margin: 0; padding-left: 20px; color: #856404;">
            <li>SOS são <strong>sempre críticos</strong> e requerem atenção imediata</li>
            <li>A localização GPS é essencial para localizar o motorista</li>
            <li>O tempo de resposta é calculado automaticamente</li>
            <li>Todas as ações são registradas no histórico para auditoria</li>
          </ul>
        </div>
        
        <div style="background: #f8f9fa; border-top: 2px solid #dee2e6; padding-top: 15px; margin-top: 25px;">
          <p style="margin: 0; color: #6c757d; font-size: 13px; text-align: center;">
            <i class='bx bx-info-circle'></i> Para mais detalhes técnicos, consulte a documentação do sistema.
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
  window.toggleSomNotificacaoSOS = function() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const novoEstado = !somHabilitado;
    localStorage.setItem('notificacao_som', novoEstado.toString());
    
    const btn = document.getElementById('btnToggleSomSOS');
    if (btn) {
      if (novoEstado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> Som';
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> Som';
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
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> Som';
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> Som';
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
