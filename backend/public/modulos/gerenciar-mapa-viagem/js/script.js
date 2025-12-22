// backend/public/modulos/gerenciar-mapa-viagem/js/script.js
// Mapa de Viagem - Frontend
// Versão: 1.0
// Autor: Sistema DivulgaCarga

(function() {
  // Evitar execução múltipla do módulo (usar nome único)
  const MODULE_KEY = 'mapaViagemModuleInitialized';
  if (window[MODULE_KEY]) {
    console.log('[Mapa Viagem] Módulo já foi inicializado. Pulando execução duplicada...');
    return;
  }
  window[MODULE_KEY] = true;

  const filtroForm = document.getElementById('filtroForm');
  
  let mapa = null;
  let marcadoresVeiculos = [];
  let veiculosData = [];
  let sqlExecutado = false;
  let estadosCarregados = false;
  let tiposViagem = [];
  let classesFrota = [];
  let contratadores = [];
  let roteiros = [];

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-mapa-viagem/sql/init.sql', '/api/mapa-viagem/executar-init-sql', 'mapa-viagem');
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-mapa-viagem/sql/init.sql', '/api/mapa-viagem/executar-init-sql', 'mapa-viagem');
      return;
    }
    
    console.warn('[Mapa Viagem] executarInitSQLPadrao não disponível.');
  }

  // Carregar estados
  async function loadEstados() {
    if (estadosCarregados) return;
    
    try {
      const response = await fetch('/api/estados-brasil');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const estados = await response.json();
      
      const origemSelect = document.getElementById('filtroOrigemEstado');
      const destinoSelect = document.getElementById('filtroDestinoEstado');
      
      if (origemSelect) {
        // Limpar opções existentes (exceto "Todos")
        origemSelect.innerHTML = '<option value="">Todos</option>';
        estados.forEach(e => {
          const opt = document.createElement('option');
          // O endpoint retorna { uf, nome }, não { CDUF, SGUF }
          opt.value = e.uf || e.CDUF || '';
          opt.textContent = e.uf || e.SGUF || e.nome || '';
          origemSelect.appendChild(opt);
        });
      }
      
      if (destinoSelect) {
        // Limpar opções existentes (exceto "Todos")
        destinoSelect.innerHTML = '<option value="">Todos</option>';
        estados.forEach(e => {
          const opt = document.createElement('option');
          // O endpoint retorna { uf, nome }, não { CDUF, SGUF }
          opt.value = e.uf || e.CDUF || '';
          opt.textContent = e.uf || e.SGUF || e.nome || '';
          destinoSelect.appendChild(opt);
        });
      }
      
      estadosCarregados = true;
      console.log('[Mapa Viagem] Estados carregados:', estados.length);
    } catch (err) {
      console.error('Erro ao carregar estados:', err);
      // Não mostrar erro se for o erro esperado de HTML
      if (!err.message.includes('<!DOCTYPE')) {
        console.warn('[Mapa Viagem] Endpoint de estados pode não estar disponível');
      }
    }
  }

  // Carregar tipos de viagem
  async function loadTiposViagem() {
    try {
      const response = await fetch('/api/tipos-viagem-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const tipos = await response.json();
      tiposViagem = Array.isArray(tipos) ? tipos : [];
      
      const select = document.getElementById('filtroTipoViagem');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        tiposViagem.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.CDTIPOVIAGEM;
          opt.textContent = t.DSTIPOVIAGEM;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Tipos de viagem carregados:', tiposViagem.length);
      }
    } catch (err) {
      console.error('Erro ao carregar tipos de viagem:', err);
    }
  }

  // Carregar classes de frota
  async function loadClassesFrota() {
    try {
      const response = await fetch('/api/classes-frota-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const classes = await response.json();
      classesFrota = Array.isArray(classes) ? classes : [];
      
      const select = document.getElementById('filtroClasseFrota');
      if (select) {
        // Limpar opções existentes (exceto "Todas")
        select.innerHTML = '<option value="">Todas</option>';
        classesFrota.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCLASSEFROTA;
          opt.textContent = c.DSCLASSEFROTA;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Classes de frota carregadas:', classesFrota.length);
      }
    } catch (err) {
      console.error('Erro ao carregar classes de frota:', err);
    }
  }

  // Carregar contratadores
  async function loadContratadores() {
    try {
      const response = await fetch('/api/contratadores-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const contratadoresData = await response.json();
      contratadores = Array.isArray(contratadoresData) ? contratadoresData : [];
      
      const select = document.getElementById('filtroContratador');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        contratadores.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCADASTRO;
          opt.textContent = c.RZSOCIAL || c.NMFANTASIA || c.NOME || '';
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Contratadores carregados:', contratadores.length);
      }
    } catch (err) {
      console.error('Erro ao carregar contratadores:', err);
    }
  }

  // Carregar roteiros
  async function loadRoteiros() {
    try {
      const response = await fetch('/api/roteiros-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const roteirosData = await response.json();
      roteiros = Array.isArray(roteirosData) ? roteirosData : [];
      
      const select = document.getElementById('filtroRoteiro');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        roteiros.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.IDROTEIRO;
          opt.textContent = r.DSROTEIRO;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Roteiros carregados:', roteiros.length);
      }
    } catch (err) {
      console.error('Erro ao carregar roteiros:', err);
    }
  }

  // Event listener para roteiro
  document.getElementById('filtroRoteiro')?.addEventListener('change', function() {
    const roteiroId = this.value;
    const roteiro = roteiros.find(r => r.IDROTEIRO.toString() === roteiroId);
    const descInput = document.getElementById('filtroRoteiroDescricao');
    if (descInput) {
      descInput.value = roteiro ? roteiro.DSROTEIRO : '';
    }
  });

  // Função para carregar o Leaflet dinamicamente
  async function carregarLeaflet() {
    if (typeof L !== 'undefined') {
      return true;
    }

    return new Promise((resolve, reject) => {
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
        console.log('✅ [Mapa Viagem] Leaflet carregado');
        resolve(true);
      };
      script.onerror = () => {
        console.error('❌ [Mapa Viagem] Erro ao carregar Leaflet');
        reject(false);
      };
      document.body.appendChild(script);
    });
  }

  // Inicializar mapa
  async function inicializarMapa() {
    const container = document.getElementById('mapaVeiculos');
    if (!container) return;

    // Verificar se o mapa já foi inicializado
    if (mapa) {
      console.log('✅ [Mapa Viagem] Mapa já está inicializado');
      return;
    }

    // Aguardar Leaflet
    await carregarLeaflet();
    
    if (typeof L === 'undefined') {
      console.error('❌ [Mapa Viagem] Leaflet não está disponível');
      container.innerHTML = '<p style="padding: 40px; text-align: center; color: #95a5a6;">Erro ao carregar biblioteca de mapas. Recarregue a página.</p>';
      return;
    }

    // Verificar se o container já tem um mapa (evitar erro de inicialização dupla)
    if (container._leaflet_id) {
      console.warn('⚠️ [Mapa Viagem] Container já tem um mapa. Removendo...');
      try {
        const existingMap = L.map('mapaVeiculos');
        existingMap.remove();
      } catch (e) {
        // Ignorar erro se não conseguir remover
      }
      // Limpar o ID do Leaflet
      delete container._leaflet_id;
    }

    // Criar mapa
    try {
      mapa = L.map('mapaVeiculos', {
        center: [-23.5505, -46.6333], // São Paulo (padrão)
        zoom: 5,
        zoomControl: true
      });

      // Adicionar tile layer
      const tileUrl = window.MAP_CONFIG?.getTileServerUrl?.() || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      L.tileLayer(tileUrl, {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(mapa);

      // Ajustar tamanho do mapa quando a aba for exibida
      const observer = new MutationObserver(() => {
        if (mapa && document.getElementById('tab-mapa')?.classList.contains('active')) {
          setTimeout(() => {
            mapa.invalidateSize();
          }, 100);
        }
      });
      
      const mapaTab = document.getElementById('tab-mapa');
      if (mapaTab) {
        observer.observe(mapaTab, { attributes: true, attributeFilter: ['class'] });
      }

      console.log('✅ [Mapa Viagem] Mapa inicializado');
    } catch (err) {
      console.error('❌ [Mapa Viagem] Erro ao inicializar mapa:', err);
      mapa = null;
    }
  }

  // Limpar marcadores do mapa
  function limparMarcadores() {
    marcadoresVeiculos.forEach(marker => {
      mapa.removeLayer(marker);
    });
    marcadoresVeiculos = [];
  }

  // Formatar data/hora
  function formatarDataHora(data) {
    if (!data) return '-';
    try {
      const d = new Date(data);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return '-';
    }
  }

  // Centralizar mapa nos veículos
  function centralizarMapaNosVeiculos() {
    if (!mapa || marcadoresVeiculos.length === 0) {
      return;
    }

    // Verificar se a aba do mapa está ativa
    const tabMapa = document.getElementById('tab-mapa');
    const isMapaVisible = tabMapa && tabMapa.classList.contains('active');

    if (!isMapaVisible) {
      // Se a aba não estiver visível, aguardar e tentar novamente
      setTimeout(() => centralizarMapaNosVeiculos(), 200);
      return;
    }

    try {
      // Aguardar um pouco para garantir que o mapa está renderizado
      setTimeout(() => {
        if (!mapa || marcadoresVeiculos.length === 0) return;

        // Invalidar tamanho do mapa para garantir renderização correta
        mapa.invalidateSize();

        // Aguardar mais um pouco para o mapa ajustar
        setTimeout(() => {
          if (!mapa || marcadoresVeiculos.length === 0) return;

          const group = L.featureGroup(marcadoresVeiculos);
          const bounds = group.getBounds();
          
          // Verificar se os bounds são válidos (verificando se tem coordenadas)
          if (bounds && bounds.isValid && typeof bounds.isValid === 'function' && bounds.isValid()) {
            mapa.fitBounds(bounds.pad(0.1), {
              animate: true,
              duration: 0.5,
              maxZoom: 15
            });
            console.log('[Mapa Viagem] Mapa centralizado nos veículos');
          } else if (bounds && bounds.getNorth && bounds.getSouth) {
            // Verificar se os bounds têm valores válidos
            const north = bounds.getNorth();
            const south = bounds.getSouth();
            const east = bounds.getEast();
            const west = bounds.getWest();
            
            if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west) && 
                north !== south && east !== west) {
              mapa.fitBounds(bounds.pad(0.1), {
                animate: true,
                duration: 0.5,
                maxZoom: 15
              });
              console.log('[Mapa Viagem] Mapa centralizado nos veículos');
            } else {
              // Se houver apenas um marcador, centralizar nele
              if (marcadoresVeiculos.length === 1) {
                const marker = marcadoresVeiculos[0];
                const latLng = marker.getLatLng();
                if (latLng && !isNaN(latLng.lat) && !isNaN(latLng.lng)) {
                  mapa.setView(latLng, 13, { animate: true });
                  console.log('[Mapa Viagem] Mapa centralizado no único veículo');
                }
              }
            }
          } else {
            console.warn('[Mapa Viagem] Bounds inválidos, tentando centralizar no primeiro marcador');
            // Se houver pelo menos um marcador, centralizar nele
            if (marcadoresVeiculos.length > 0) {
              const marker = marcadoresVeiculos[0];
              const latLng = marker.getLatLng();
              if (latLng && !isNaN(latLng.lat) && !isNaN(latLng.lng)) {
                mapa.setView(latLng, marcadoresVeiculos.length === 1 ? 13 : 10, { animate: true });
                console.log('[Mapa Viagem] Mapa centralizado no primeiro veículo');
              }
            }
          }
        }, 200);
      }, 300);
    } catch (err) {
      console.error('[Mapa Viagem] Erro ao centralizar mapa:', err);
    }
  }

  // Adicionar marcador de veículo no mapa
  function adicionarMarcadorVeiculo(veiculo) {
    if (!mapa) {
      console.warn('[Mapa Viagem] Mapa não está inicializado');
      return;
    }

    // Verificar se tem coordenadas
    if (!veiculo.LATITUDE || !veiculo.LONGITUDE) {
      console.warn('[Mapa Viagem] Veículo sem coordenadas:', veiculo);
      return;
    }

    const lat = parseFloat(veiculo.LATITUDE);
    const lon = parseFloat(veiculo.LONGITUDE);

    if (isNaN(lat) || isNaN(lon)) {
      console.warn('[Mapa Viagem] Coordenadas inválidas:', veiculo.LATITUDE, veiculo.LONGITUDE);
      return;
    }

    // Criar ícone personalizado para veículo (azul)
    const veiculoIcon = L.divIcon({
      className: 'veiculo-marker',
      html: `<div style="
        background: #3498db;
        width: 30px;
        height: 30px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30]
    });

    // Criar popup com informações detalhadas
    const popupContent = `
      <div style="min-width: 250px; font-family: Arial, sans-serif;">
        <h4 style="margin: 0 0 12px 0; color: #2c3e50; font-size: 16px; border-bottom: 2px solid #3498db; padding-bottom: 8px;">
          <i class='bx bx-car' style="color: #3498db;"></i> ${veiculo.PLACA || 'N/A'}
        </h4>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600; width: 40%;">Viagem:</td>
            <td style="padding: 6px 0; color: #2c3e50;">${veiculo.VIAGEM || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600;">Motorista:</td>
            <td style="padding: 6px 0; color: #2c3e50;">${veiculo.NMMOTORISTA || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600;">Roteiro:</td>
            <td style="padding: 6px 0; color: #2c3e50;">${veiculo.DSROTEIRO || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600;">Posição:</td>
            <td style="padding: 6px 0; color: #2c3e50;">${veiculo.DSPOSICAO || '-'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600;">Data/Hora:</td>
            <td style="padding: 6px 0; color: #2c3e50;">${formatarDataHora(veiculo.DHPOSICAO)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6c757d; font-weight: 600;">Coordenadas:</td>
            <td style="padding: 6px 0; color: #2c3e50; font-size: 11px;">${lat.toFixed(6)}, ${lon.toFixed(6)}</td>
          </tr>
        </table>
      </div>
    `;

    const marker = L.marker([lat, lon], { icon: veiculoIcon })
      .addTo(mapa)
      .bindPopup(popupContent);

    marcadoresVeiculos.push(marker);
  }

  // Carregar veículos e exibir no mapa
  async function carregarVeiculos() {
    try {
      // Garantir que o mapa está inicializado antes de carregar veículos
      if (!mapa) {
        console.log('[Mapa Viagem] Mapa não inicializado. Inicializando...');
        await inicializarMapa();
        
        // Aguardar um pouco para garantir que o mapa está pronto
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!mapa) {
          throw new Error('Não foi possível inicializar o mapa');
        }
      }

      // Coletar filtros
      const filtros = {
        idViagem: document.getElementById('filtroIdViagem')?.value || '',
        tipoViagem: document.getElementById('filtroTipoViagem')?.value || '',
        situacaoViagem: document.getElementById('filtroSituacaoViagem')?.value || '',
        classeFrota: document.getElementById('filtroClasseFrota')?.value || '',
        contratador: document.getElementById('filtroContratador')?.value || '',
        origemEstado: document.getElementById('filtroOrigemEstado')?.value || '',
        origemCidade: document.getElementById('filtroOrigemCidade')?.value || '',
        destinoEstado: document.getElementById('filtroDestinoEstado')?.value || '',
        destinoCidade: document.getElementById('filtroDestinoCidade')?.value || '',
        roteiro: document.getElementById('filtroRoteiro')?.value || '',
        dataInicio: document.getElementById('filtroDataInicio')?.value || '',
        dataFim: document.getElementById('filtroDataFim')?.value || '',
        rastreado: document.getElementById('filtroRastreado')?.value || '',
        motoristaConfirmado: document.getElementById('filtroMotoristaConfirmado')?.value || ''
      };

      const params = new URLSearchParams();
      Object.keys(filtros).forEach(key => {
        if (filtros[key]) {
          params.append(key, filtros[key]);
        }
      });

      const response = await fetch(`/api/mapa-viagem/veiculos?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Erro ao carregar veículos');
      }

      const data = await response.json();
      veiculosData = data.veiculos || [];

      console.log(`[Mapa Viagem] Dados recebidos da API:`, {
        total: veiculosData.length,
        veiculos: veiculosData.slice(0, 5) // Primeiros 5 para debug
      });

      // Limpar marcadores anteriores
      limparMarcadores();

      // Adicionar novos marcadores
      let marcadoresAdicionados = 0;
      let marcadoresIgnorados = 0;
      
      veiculosData.forEach((veiculo, index) => {
        const antes = marcadoresVeiculos.length;
        adicionarMarcadorVeiculo(veiculo);
        const depois = marcadoresVeiculos.length;
        
        if (depois > antes) {
          marcadoresAdicionados++;
        } else {
          marcadoresIgnorados++;
          if (index < 10) { // Log apenas os primeiros 10 ignorados
            console.warn(`[Mapa Viagem] Marcador ${index + 1} ignorado:`, veiculo);
          }
        }
      });

      console.log(`[Mapa Viagem] Marcadores: ${marcadoresAdicionados} adicionados, ${marcadoresIgnorados} ignorados`);

      // Centralizar mapa nos veículos (será chamado após mudar para a aba do mapa)
      if (marcadoresVeiculos.length > 0) {
        centralizarMapaNosVeiculos();
      } else if (marcadoresVeiculos.length === 0) {
        console.warn('[Mapa Viagem] Nenhum marcador foi adicionado ao mapa!');
      }

      // Atualizar info
      const infoText = document.getElementById('mapaInfoText');
      if (infoText) {
        infoText.textContent = `${veiculosData.length} veículo(s) encontrado(s), ${marcadoresAdicionados} exibido(s) no mapa.`;
      }

    } catch (err) {
      console.error('Erro ao carregar veículos:', err);
      const infoText = document.getElementById('mapaInfoText');
      if (infoText) {
        infoText.textContent = 'Erro ao carregar veículos. Verifique o console para mais detalhes.';
      }
    }
  }

  // Função para trocar de aba
  function showTab(tabId) {
    // Esconder todas as abas
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Remover active de todos os botões
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Mostrar aba selecionada
    const tabContent = document.getElementById(`tab-${tabId}`);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    
    if (tabContent) {
      tabContent.classList.add('active');
    }
    
    if (tabBtn) {
      tabBtn.classList.add('active');
    }
    
    // Se mudou para a aba do mapa, ajustar o tamanho do mapa
    if (tabId === 'mapa' && mapa) {
      setTimeout(() => {
        mapa.invalidateSize();
      }, 100);
    }
  }

  // Event listeners para abas
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      showTab(tabId);
    });
  });

  // Event listeners
  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Mudar para a aba do mapa antes de carregar (para garantir que está visível)
    showTab('mapa');
    // Aguardar um pouco para a aba estar visível
    await new Promise(resolve => setTimeout(resolve, 100));
    // Carregar veículos (que vai centralizar automaticamente)
    await carregarVeiculos();
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    filtroForm.reset();
    document.getElementById('filtroRoteiroDescricao').value = '';
    veiculosData = [];
    limparMarcadores();
    const infoText = document.getElementById('mapaInfoText');
    if (infoText) {
      infoText.textContent = 'Filtros limpos. Aplique novos filtros para carregar veículos.';
    }
  });

  document.getElementById('btnAtualizarMapa')?.addEventListener('click', async () => {
    await carregarVeiculos();
  });

  document.getElementById('btnCentralizarMapa')?.addEventListener('click', () => {
    if (marcadoresVeiculos.length > 0) {
      centralizarMapaNosVeiculos();
    } else if (mapa) {
      mapa.setView([-23.5505, -46.6333], 5); // Voltar para São Paulo
    }
  });

  // Função de ajuda
  window.mostrarAjudaMapaViagem = function() {
    const modal = document.getElementById('modalAjudaMapaViagem');
    if (modal) {
      modal.style.display = 'flex';
    }
  };

  // Flag para evitar inicialização dupla
  let inicializado = false;

  // Inicialização
  async function init() {
    // Evitar inicialização dupla
    if (inicializado) {
      console.log('[Mapa Viagem] Função init() já foi executada. Pulando...');
      return;
    }
    
    inicializado = true;
    console.log('[Mapa Viagem] Inicializando módulo...');
    
    try {
      // Executar init.sql
      await executarInitSQL();
      
      // Carregar combos (ignorar erros de estados se não houver endpoint)
      await Promise.allSettled([
        loadEstados().catch(err => {
          // Erro ao carregar estados pode ser normal se o endpoint não existir
          if (!err.message.includes('<!DOCTYPE')) {
            console.warn('[Mapa Viagem] Erro ao carregar estados:', err);
          }
        }),
        loadTiposViagem(),
        loadClassesFrota(),
        loadContratadores(),
        loadRoteiros()
      ]);
      
      // Inicializar mapa
      await inicializarMapa();
      
      console.log('[Mapa Viagem] Módulo inicializado');
    } catch (err) {
      console.error('[Mapa Viagem] Erro na inicialização:', err);
      inicializado = false; // Permitir tentar novamente em caso de erro
    }
  }

  // Executar quando o DOM estiver pronto (apenas uma vez)
  const INIT_KEY = 'mapaViagemInitScheduled';
  if (!window[INIT_KEY]) {
    window[INIT_KEY] = true;
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      // Se já está carregado, executar imediatamente
      init();
    }
  }
})();
