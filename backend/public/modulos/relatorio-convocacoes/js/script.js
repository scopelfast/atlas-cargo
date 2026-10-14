// backend/public/modulos/relatorio-convocacoes/js/script.js
// Relatório de Convocações - Frontend
// Versão: 1.0
// i18n: helper t() e chaves web.modulos.relatorioConvocacoes

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  let chartStatus = null;
  let chartPorData = null;
  let dadosAtuais = null;
  let listaOrdenada = [];
  let ordemAtual = { coluna: null, direcao: 'asc' };
  let initExecutado = false;

  let contextoRelatorio = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoRelatorio() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoRelatorio.locale = d.locale;
      if (d && d.timezone) contextoRelatorio.timezone = d.timezone;
    } catch (e) {}
  }

  function parseBackendDateSafe(dataValue) {
    if (dataValue instanceof Date) return dataValue;
    const s = String(dataValue || '').trim();
    if (!s) return new Date(NaN);
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
    const semTzMatch = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
    if (!hasTimezone && semTzMatch) {
      return new Date(`${semTzMatch[1]}T${semTzMatch[2]}${semTzMatch[3] || ''}Z`);
    }
    return new Date(s);
  }

  function fmtDataHora(data) {
    if (data === null || data === undefined) return '-';
    const d = parseBackendDateSafe(data);
    if (Number.isNaN(d.getTime())) return '-';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(d, contextoRelatorio.locale, contextoRelatorio.timezone, { dateStyle: 'short', timeStyle: 'short' });
    }
    return d.toLocaleString(contextoRelatorio.locale || 'pt-BR', { timeZone: contextoRelatorio.timezone || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  }

  // Carregar motivos de recusa
  async function carregarMotivosRecusa() {
    try {
      const response = await fetch('/api/motivos-recusa-combo');
      if (response.ok) {
        const motivos = await response.json();
        const select = document.getElementById('filtroMotivoRecusa');
        if (select) {
          // Limpar opções existentes (exceto "Todos")
          select.innerHTML = '<option value="">Todos</option>';
          motivos.forEach(motivo => {
            const option = document.createElement('option');
            option.value = motivo.CDMOTIVO;
            option.textContent = motivo.DSMOTIVO;
            select.appendChild(option);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar motivos de recusa:', err);
    }
  }

  // Carregar contratadores (apenas os que têm convocações)
  async function carregarContratadores() {
    try {
      // Passar parâmetro para retornar apenas contratadores com convocações
      const response = await fetch('/api/contratadores-combo?apenasComConvocacoes=true');
      if (response.ok) {
        const contratadores = await response.json();
        const select = document.getElementById('filtroContratador');
        if (select) {
          // Limpar opções existentes (exceto "Todos")
          select.innerHTML = '<option value="">Todos</option>';
          contratadores.forEach(contratador => {
            const option = document.createElement('option');
            option.value = contratador.CDCADASTRO;
            option.textContent = contratador.RZSOCIAL;
            select.appendChild(option);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar contratadores:', err);
    }
  }

  // Inicialização
  async function init() {
    if (initExecutado) return;
    initExecutado = true;
    
    await loadContextoRelatorio();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verificar se Chart.js está disponível
    if (typeof Chart === 'undefined') {
      try {
        await aguardarChartJS();
      } catch (err) {
        console.warn('⚠️ Chart.js não carregou na inicialização, continuando sem gráficos:', err);
      }
    }
    
    // Definir datas padrão (últimos 30 dias)
    const hoje = new Date();
    const dataFim = hoje.toISOString().split('T')[0];
    const dataInicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const filtroDataInicio = document.getElementById('filtroDataInicio');
    const filtroDataFim = document.getElementById('filtroDataFim');
    
    if (filtroDataInicio) filtroDataInicio.value = dataInicio;
    if (filtroDataFim) filtroDataFim.value = dataFim;

    // Carregar motivos de recusa
    carregarMotivosRecusa();

    // Carregar contratadores
    carregarContratadores();

    // Carregar relatório inicial
    buscarRelatorio();
  }

  // Buscar relatório
  window.buscarRelatorio = async function() {
    try {
      // Mostrar loading
      const tabelaContainer = document.getElementById('tabelaContainer');
      const estatisticasCards = document.getElementById('estatisticasCards');
      
      if (tabelaContainer) {
        tabelaContainer.innerHTML = '<div class="loading">Carregando dados</div>';
      }
      if (estatisticasCards) {
        estatisticasCards.innerHTML = '<div class="loading">Carregando estatísticas</div>';
      }

      // Coletar filtros e garantir que valores vazios sejam removidos
      const filtroDataInicio = document.getElementById('filtroDataInicio');
      const filtroDataFim = document.getElementById('filtroDataFim');
      const filtroStatus = document.getElementById('filtroStatus');
      const filtroIdViagem = document.getElementById('filtroIdViagem');
      const filtroIdConvocacao = document.getElementById('filtroIdConvocacao');
      const filtroMotorista = document.getElementById('filtroMotorista');
      const filtroViagemConfirmada = document.getElementById('filtroViagemConfirmada');
      const filtroMotivoRecusa = document.getElementById('filtroMotivoRecusa');
      const filtroContratador = document.getElementById('filtroContratador');
      const filtroDivergenciaPlacasRel = document.getElementById('filtroDivergenciaPlacasRel');

      const filtros = {};
      
      // Adicionar apenas filtros com valor válido (não vazios, não null, não undefined)
      const getValue = (element) => {
        if (!element) return null;
        const value = element.value;
        if (value === null || value === undefined || value === '') return null;
        const trimmed = String(value).trim();
        return trimmed === '' ? null : trimmed;
      };

      const dataInicioValue = getValue(filtroDataInicio);
      const dataFimValue = getValue(filtroDataFim);
      const statusValue = getValue(filtroStatus);
      const idViagemValue = getValue(filtroIdViagem);
      const idConvocacaoValue = getValue(filtroIdConvocacao);
      const motoristaValue = getValue(filtroMotorista);
      const viagemConfirmadaValue = getValue(filtroViagemConfirmada);
      const motivoRecusaValue = getValue(filtroMotivoRecusa);
      const contratadorValue = getValue(filtroContratador);

      if (dataInicioValue) filtros.dataInicio = dataInicioValue;
      if (dataFimValue) filtros.dataFim = dataFimValue;
      if (statusValue) filtros.status = statusValue;
      if (idViagemValue && !isNaN(idViagemValue)) filtros.idViagem = idViagemValue;
      if (idConvocacaoValue && !isNaN(idConvocacaoValue)) filtros.idConvocacao = idConvocacaoValue;
      if (motoristaValue) filtros.motorista = motoristaValue;
      if (viagemConfirmadaValue && (viagemConfirmadaValue === 'true' || viagemConfirmadaValue === 'false')) {
        filtros.viagemConfirmada = viagemConfirmadaValue;
      }
      if (motivoRecusaValue && !isNaN(motivoRecusaValue)) filtros.motivoRecusa = motivoRecusaValue;
      if (contratadorValue && !isNaN(contratadorValue)) filtros.contratador = contratadorValue;
      if (filtroDivergenciaPlacasRel && filtroDivergenciaPlacasRel.checked) filtros.divergenciaPlacas = '1';

      // Construir query string apenas com filtros válidos
      const queryString = new URLSearchParams(filtros).toString();
      const url = queryString 
        ? `/api/relatorio-convocacoes/relatorio?${queryString}`
        : `/api/relatorio-convocacoes/relatorio`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data) {
        throw new Error('Nenhum dado retornado pelo servidor');
      }

      dadosAtuais = data;

      // Atualizar interface
      atualizarEstatisticas(data.estatisticas);
      await atualizarGraficos(data);
      atualizarTabela(data.lista);

      // Mensagem de sucesso
      if (typeof showMessage !== 'undefined') {
        const total = data.estatisticas?.TOTAL || 0;
        showMessage(`${total} convocação(ões) encontrada(s).`, 'success');
      }

    } catch (error) {
      console.error('Erro ao buscar relatório:', error);
      
      // Usar showMessage se disponível, senão usar alert como fallback
      const errorMsg = error.message || 'Erro ao buscar relatório. Verifique a conexão e tente novamente.';
      
      if (typeof showMessage !== 'undefined') {
        showMessage(errorMsg, 'error');
      } else {
        alert(errorMsg);
      }

      // Mostrar estado vazio
      const tabelaContainer = document.getElementById('tabelaContainer');
      const estatisticasCards = document.getElementById('estatisticasCards');
      
      if (tabelaContainer) {
        tabelaContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Erro ao carregar dados</p></div>';
      }
      if (estatisticasCards) {
        estatisticasCards.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Erro ao carregar estatísticas</p></div>';
      }
    }
  };

  // Atualizar cards de estatísticas
  function atualizarEstatisticas(estatisticas) {
    const container = document.getElementById('estatisticasCards');
    
    // Verificar se o elemento existe antes de usar
    if (!container) {
      // Silencioso - elemento será criado quando o módulo carregar completamente
      return;
    }
    
    if (!estatisticas || !estatisticas.TOTAL) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p>Nenhum dado encontrado</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="stat-card total-viagens">
        <div class="stat-label">Total de Viagens</div>
        <div class="stat-value">${estatisticas.TOTAL_VIAGENS || 0}</div>
      </div>
      <div class="stat-card total">
        <div class="stat-label">Total</div>
        <div class="stat-value">${estatisticas.TOTAL || 0}</div>
      </div>
      <div class="stat-card pendente">
        <div class="stat-label">Pendente</div>
        <div class="stat-value">${estatisticas.PENDENTE_ACIONAVEL ?? estatisticas.PENDENTE ?? 0}</div>
      </div>
      <div class="stat-card aceita">
        <div class="stat-label">Aceita</div>
        <div class="stat-value">${estatisticas.ACEITA || 0}</div>
      </div>
      <div class="stat-card recusada">
        <div class="stat-label">Recusada</div>
        <div class="stat-value">${estatisticas.RECUSADA || 0}</div>
      </div>
      <div class="stat-card confirmada">
        <div class="stat-label">Confirmada</div>
        <div class="stat-value">${estatisticas.CONFIRMADA || 0}</div>
      </div>
      <div class="stat-card aceita-descartada">
        <div class="stat-label">Aceita Descartada</div>
        <div class="stat-value">${estatisticas.ACEITA_DESCARTADA || 0}</div>
      </div>
      <div class="stat-card com-acesso">
        <div class="stat-label">Com Acesso</div>
        <div class="stat-value">${estatisticas.COM_ACESSO || 0}</div>
      </div>
      <div class="stat-card com-resposta">
        <div class="stat-label">Com Resposta</div>
        <div class="stat-value">${estatisticas.COM_RESPOSTA || 0}</div>
      </div>
      <div class="stat-card divergencia-placas">
        <div class="stat-label">Divergência placas (app)</div>
        <div class="stat-value">${estatisticas.DIVERGENCIA_PLACAS ?? estatisticas.divergencia_placas ?? 0}</div>
      </div>
    `;
  }

  // Aguardar Chart.js estar disponível
  async function aguardarChartJS() {
    // Se já está disponível, retornar imediatamente
    if (typeof Chart !== 'undefined') {
      return true;
    }

    // Verificar se o script já foi adicionado (no head ou em qualquer lugar)
    const existingScript = document.head.querySelector('script[src*="chart.js"]') || 
                          document.head.querySelector('script[src*="Chart.js"]') ||
                          document.querySelector('script[src*="chart.js"]') ||
                          document.querySelector('script[src*="Chart.js"]');
    
    if (existingScript) {
      // Verificar se o script já foi carregado (tem complete ou readyState)
      if (existingScript.complete || existingScript.readyState === 'complete') {
        // Aguardar um pouco para ver se Chart está disponível
        await new Promise(resolve => setTimeout(resolve, 500));
        if (typeof Chart !== 'undefined') {
          return true;
        }
      }
      
      // Aguardar o Chart carregar
      let tentativas = 0;
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (typeof Chart !== 'undefined') {
            clearInterval(checkInterval);
            resolve(true);
          } else if (tentativas++ > 150) { // 15 segundos
            clearInterval(checkInterval);
            console.error('❌ Timeout: Chart.js não carregou após 15 segundos');
            reject(new Error('Chart.js não carregou após aguardar'));
          }
        }, 100);
      });
    }

    // Carregar Chart.js dinamicamente (fallback)
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      script.async = false; // Carregar de forma síncrona
      script.onload = () => {
        // Aguardar um pouco mais para garantir que Chart está disponível
        setTimeout(() => {
          if (typeof Chart !== 'undefined') {
            resolve(true);
          } else {
            // Tentar mais algumas vezes
            let tentativas = 0;
            const retryInterval = setInterval(() => {
              if (typeof Chart !== 'undefined') {
                clearInterval(retryInterval);
                resolve(true);
              } else if (tentativas++ > 50) {
                clearInterval(retryInterval);
                reject(new Error('Chart.js carregado mas não disponível'));
              }
            }, 100);
          }
        }, 500);
      };
      script.onerror = (err) => {
        console.error('❌ Erro ao carregar script do Chart.js:', err);
        console.error('📋 Verifique se há bloqueio de CSP ou erro de rede');
        reject(new Error('Erro ao carregar Chart.js - verifique CSP ou conexão'));
      };
      document.head.appendChild(script);
    });
  }

  // Atualizar gráficos
  async function atualizarGraficos(data) {
    // Verificar se os canvas existem antes de continuar
    const ctxStatus = document.getElementById('graficoStatus');
    const ctxPorData = document.getElementById('graficoPorData');
    
    if (!ctxStatus || !ctxPorData) {
      console.error('❌ Canvas não encontrados. Aguardando...');
      // Aguardar um pouco e tentar novamente
      await new Promise(resolve => setTimeout(resolve, 500));
      const ctxStatusRetry = document.getElementById('graficoStatus');
      const ctxPorDataRetry = document.getElementById('graficoPorData');
      if (!ctxStatusRetry || !ctxPorDataRetry) {
        console.error('❌ Canvas ainda não encontrados após espera');
        return;
      }
    }
    
    try {
      // Aguardar Chart.js estar disponível (com timeout maior)
      if (typeof Chart === 'undefined') {
        await Promise.race([
          aguardarChartJS(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao carregar Chart.js')), 15000))
        ]);
      }
    } catch (error) {
      console.error('❌ Erro ao carregar Chart.js:', error);
      // NÃO remover os canvas - apenas mostrar mensagem de erro sem destruir o HTML
      const graficoContainer = document.querySelector('.graficos-section');
      if (graficoContainer) {
        // Adicionar mensagem de erro sem remover os canvas
        let errorDiv = graficoContainer.querySelector('.chart-error-message');
        if (!errorDiv) {
          errorDiv = document.createElement('div');
          errorDiv.className = 'chart-error-message';
          errorDiv.style.cssText = 'grid-column: 1 / -1; padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; margin-bottom: 20px;';
          errorDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 24px;">⚠️</span>
              <div>
                <strong>Erro ao carregar biblioteca de gráficos</strong>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #856404;">${error.message}</p>
                <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 10px; padding: 5px 15px; font-size: 12px;">Recarregar Página</button>
              </div>
            </div>
          `;
          graficoContainer.insertBefore(errorDiv, graficoContainer.firstChild);
        }
      }
      return;
    }

    // Gráfico de Status (Pizza) - Re-buscar canvas após carregar Chart.js (se necessário)
    let ctxStatusFinal = ctxStatus;
    if (!ctxStatusFinal) {
      ctxStatusFinal = document.getElementById('graficoStatus');
    }
    if (!ctxStatusFinal) {
      console.error('❌ Canvas graficoStatus não encontrado após carregar Chart.js');
      return;
    }
    
    // Remover mensagem de erro se existir
    const errorDiv = document.querySelector('.chart-error-message');
    if (errorDiv) {
      errorDiv.remove();
    }

    if (chartStatus) {
      chartStatus.destroy();
    }

    const estatisticas = data.estatisticas || {};
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#e2e8f0' : '#333';
    
    const dadosStatus = [
      estatisticas.PENDENTE || 0,
      estatisticas.ACEITA || 0,
      estatisticas.RECUSADA || 0,
      estatisticas.CONFIRMADA || 0,
      estatisticas.ACEITA_DESCARTADA || 0
    ];
    
    try {
      chartStatus = new Chart(ctxStatusFinal, {
        type: 'doughnut',
        data: {
          labels: ['Pendente', 'Aceita', 'Recusada', 'Confirmada', 'Aceita Descartada'],
          datasets: [{
            data: dadosStatus,
            backgroundColor: [
              '#ffc107',
              '#28a745',
              '#dc3545',
              '#17a2b8',
              '#6c757d'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          aspectRatio: 1.5,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: chartTextColor }
            },
            title: {
              display: false
            }
          }
        }
      });
    } catch (err) {
      console.error('❌ Erro ao criar gráfico de status:', err);
      // Não remover o canvas, apenas logar o erro
    }

    // Gráfico por Data (Linha) - Re-buscar canvas se necessário
    let ctxPorDataFinal = ctxPorData;
    if (!ctxPorDataFinal) {
      ctxPorDataFinal = document.getElementById('graficoPorData');
    }
    if (!ctxPorDataFinal) {
      console.error('❌ Canvas graficoPorData não encontrado');
      return;
    }

    if (chartPorData) {
      chartPorData.destroy();
    }

    const dadosPorData = data.estatisticasPorData || [];
    const labels = dadosPorData.map(d => {
      if (!d.DATA) return '-';
      
      // Tratar data sem conversão de fuso
      let date;
      if (typeof d.DATA === 'string' && d.DATA.includes('T')) {
        const partes = d.DATA.split('T');
        const dataParte = partes[0].split('-');
        const ano = parseInt(dataParte[0]);
        const mes = parseInt(dataParte[1]) - 1;
        const dia = parseInt(dataParte[2]);
        date = new Date(ano, mes, dia);
      } else {
        const tempDate = new Date(d.DATA);
        const ano = tempDate.getUTCFullYear();
        const mes = tempDate.getUTCMonth();
        const dia = tempDate.getUTCDate();
        date = new Date(ano, mes, dia);
      }
      
      const diaStr = String(date.getDate()).padStart(2, '0');
      const mesStr = String(date.getMonth() + 1).padStart(2, '0');
      const anoStr = date.getFullYear();
      return `${diaStr}/${mesStr}/${anoStr}`;
    }).reverse();
    
    const dadosPendente = dadosPorData.map(d => (d.PENDENTE_ACIONAVEL ?? d.PENDENTE ?? 0)).reverse();
    const dadosAceita = dadosPorData.map(d => d.ACEITA || 0).reverse();
    const dadosRecusada = dadosPorData.map(d => d.RECUSADA || 0).reverse();
    const dadosConfirmada = dadosPorData.map(d => d.CONFIRMADA || 0).reverse();
    
    try {
      chartPorData = new Chart(ctxPorDataFinal, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Pendente',
              data: dadosPendente,
              borderColor: '#ffc107',
              backgroundColor: 'rgba(255, 193, 7, 0.1)',
              tension: 0.4
            },
            {
              label: 'Aceita',
              data: dadosAceita,
              borderColor: '#28a745',
              backgroundColor: 'rgba(40, 167, 69, 0.1)',
              tension: 0.4
            },
            {
              label: 'Recusada',
              data: dadosRecusada,
              borderColor: '#dc3545',
              backgroundColor: 'rgba(220, 53, 69, 0.1)',
              tension: 0.4
            },
            {
              label: 'Confirmada',
              data: dadosConfirmada,
              borderColor: '#17a2b8',
              backgroundColor: 'rgba(23, 162, 184, 0.1)',
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          aspectRatio: 1.5,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: chartTextColor }
            },
            title: {
              display: false
            }
          },
          scales: {
            x: {
              ticks: { color: chartTextColor }
            },
            y: {
              beginAtZero: true,
              ticks: { color: chartTextColor }
            }
          }
        }
      });
    } catch (err) {
      console.error('❌ Erro ao criar gráfico por data:', err);
      // Não remover o canvas, apenas logar o erro
    }
  }

  // Ordenar lista
  function ordenarLista(lista, coluna, direcao) {
    const listaOrdenada = [...lista];
    
    listaOrdenada.sort((a, b) => {
      let valorA, valorB;
      
      switch(coluna) {
        case 'ID':
          valorA = a.IDCONVOCACAO;
          valorB = b.IDCONVOCACAO;
          break;
        case 'Viagem':
          valorA = a.IDVIAGEM;
          valorB = b.IDVIAGEM;
          break;
        case 'Motorista':
          valorA = (a.NOME_MOTORISTA || '').toUpperCase();
          valorB = (b.NOME_MOTORISTA || '').toUpperCase();
          break;
        case 'Status':
          valorA = a.STATUS || '';
          valorB = b.STATUS || '';
          break;
        case 'Convocação':
          valorA = parseBackendDateSafe(a.DHCONVOCACAO || 0);
          valorB = parseBackendDateSafe(b.DHCONVOCACAO || 0);
          break;
        case 'Resposta':
          valorA = parseBackendDateSafe(a.DHRESPOSTA || 0);
          valorB = parseBackendDateSafe(b.DHRESPOSTA || 0);
          break;
        case 'Acesso':
          valorA = parseBackendDateSafe(a.DHACESSO || 0);
          valorB = parseBackendDateSafe(b.DHACESSO || 0);
          break;
        case 'Rota':
          const rotaA = `${(a.ORIGEM_CIDADE || '')}/${(a.ORIGEM_ESTADO || '')} → ${(a.DESTINO_CIDADE || '')}/${(a.DESTINO_ESTADO || '')}`;
          const rotaB = `${(b.ORIGEM_CIDADE || '')}/${(b.ORIGEM_ESTADO || '')} → ${(b.DESTINO_CIDADE || '')}/${(b.DESTINO_ESTADO || '')}`;
          valorA = rotaA.toUpperCase();
          valorB = rotaB.toUpperCase();
          break;
        case 'Confirmada':
          valorA = a.VIAGEM_CONFIRMADA || 'N';
          valorB = b.VIAGEM_CONFIRMADA || 'N';
          break;
        default:
          return 0;
      }
      
      if (valorA < valorB) return direcao === 'asc' ? -1 : 1;
      if (valorA > valorB) return direcao === 'asc' ? 1 : -1;
      return 0;
    });
    
    return listaOrdenada;
  }

  // Função para abrir viagem no módulo de gerenciar viagens
  window.abrirViagem = function(idViagem) {
    try {
      // Verificar se a função loadModuleContent está disponível
      if (typeof window.loadModuleContent === 'function') {
        // Carregar módulo com parâmetro
        window.loadModuleContent('gerenciar-viagens', { idViagem: idViagem });
        
        if (typeof showMessage !== 'undefined') {
          showMessage(`Abrindo viagem ${idViagem}...`, 'success');
        }
      } else {
        // Fallback: tentar carregar manualmente
        const contentArea = document.getElementById('contentArea');
        if (contentArea) {
          fetch('/modulos/gerenciar-viagens/index.html')
            .then(response => response.text())
            .then(html => {
              contentArea.innerHTML = html;
              const script = document.createElement('script');
              script.src = '/modulos/gerenciar-viagens/js/script.js';
              contentArea.appendChild(script);
              
              // Aguardar e aplicar filtro
              setTimeout(() => aplicarFiltroViagem(idViagem), 1500);
            })
            .catch(err => {
              console.error('Erro ao carregar módulo:', err);
              if (typeof showMessage !== 'undefined') {
                showMessage('Erro ao abrir módulo de viagens', 'error');
              }
            });
        } else {
          if (typeof showMessage !== 'undefined') {
            showMessage('Não foi possível abrir o módulo de viagens', 'error');
          }
        }
      }
    } catch (error) {
      console.error('Erro ao abrir viagem:', error);
      if (typeof showMessage !== 'undefined') {
        showMessage('Erro ao abrir módulo de viagens', 'error');
      }
    }
  };

  // Função auxiliar para aplicar filtro de viagem
  function aplicarFiltroViagem(idViagem) {
    const filtroIdViagem = document.getElementById('filtroIdViagem');
    if (filtroIdViagem) {
      filtroIdViagem.value = idViagem;
      
      // Tentar submeter o formulário
      const form = document.getElementById('filtroForm');
      if (form) {
        setTimeout(() => {
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
          } else {
            // Tentar disparar evento de submit
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }, 500);
      }
    } else {
      // Tentar novamente após mais tempo
      setTimeout(() => aplicarFiltroViagem(idViagem), 500);
    }
  }

  // Atualizar tabela
  function atualizarTabela(lista) {
    const container = document.getElementById('tabelaContainer');
    
    // Verificar se o elemento existe antes de usar
    if (!container) {
      // Silencioso - elemento será criado quando o módulo carregar completamente
      return;
    }
    
    if (!lista || lista.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-list-ul" style="font-size: 48px; color: #64748b;"></i></div><p>Nenhuma convocação encontrada</p></div>';
      return;
    }

    // Salvar lista original
    listaOrdenada = lista;

    // Colunas removidas da grade (status / info): não manter ordenação órfã
    if (ordemAtual.coluna === 'Status' || ordemAtual.coluna === 'Confirmada') {
      ordemAtual = { coluna: null, direcao: 'asc' };
    }
    
    // Aplicar ordenação se houver
    if (ordemAtual.coluna) {
      listaOrdenada = ordenarLista(lista, ordemAtual.coluna, ordemAtual.direcao);
    }

    window.__relatorioConvJustificativaPlacas = Object.create(null);

    // Função para criar header com ordenação (sem inline background para respeitar dark mode)
    const criarHeader = (nome, chave) => {
      const isOrdenado = ordemAtual.coluna === nome;
      const seta = isOrdenado ? (ordemAtual.direcao === 'asc' ? ' ▲' : ' ▼') : ' ↕';
      const sortedClass = isOrdenado ? ' th-sorted' : '';
      return `<th class="th-sortable${sortedClass}" style="padding: 10px 8px; text-align: left; cursor: pointer; user-select: none; overflow: hidden; text-overflow: ellipsis;" 
                data-col="${nome}"
                onclick="ordenarTabela('${nome}')" 
                title="Clique para ordenar">
        ${nome}${seta}
      </th>`;
    };

    const tabela = `
      <table class="relatorio-table">
        <colgroup>
          <col class="rel-col-id" />
          <col class="rel-col-viagem" />
          <col class="rel-col-rota" />
          <col class="rel-col-motorista" />
          <col class="rel-col-acesso" />
          <col class="rel-col-resposta" />
          <col class="rel-col-acoes" />
        </colgroup>
        <thead>
          <tr class="thead-row">
            ${criarHeader('ID', 'IDCONVOCACAO')}
            ${criarHeader('Viagem', 'IDVIAGEM')}
            ${criarHeader('Rota', 'ORIGEM_CIDADE')}
            ${criarHeader('Motorista', 'NOME_MOTORISTA')}
            ${criarHeader('Acesso', 'DHACESSO')}
            <th class="th-sortable${ordemAtual.coluna === 'Resposta' ? ' th-sorted' : ''}" style="padding: 10px 8px; text-align: left; cursor: pointer; user-select: none; overflow: hidden; text-overflow: ellipsis;" 
                data-col="Resposta"
                onclick="ordenarTabela('Resposta')" 
                title="GPS + ícone do status + data (DHRESPOSTA). Passe o mouse para texto completo; viagem já confirmada e link campanha aparecem no tooltip.">
              Resposta${ordemAtual.coluna === 'Resposta' ? (ordemAtual.direcao === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
            </th>
            <th class="col-acoes th-sortable${ordemAtual.coluna === 'Convocação' ? ' th-sorted' : ''}" style="padding: 10px 4px; text-align: center; cursor: pointer; user-select: none;" data-col="Convocação" onclick="ordenarTabela('Convocação')" title="Botões de ação; abaixo, data da convocação (DHCONVOCACAO). Clique para ordenar por essa data.">Ações${ordemAtual.coluna === 'Convocação' ? (ordemAtual.direcao === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</th>
          </tr>
        </thead>
        <tbody>
          ${listaOrdenada.map((item, index) => {
            const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
            const fgPlacasRel = String(item.FGCONFIRMACAOPLACAS ?? item.fgconfirmacaoplacas ?? '').trim().toUpperCase();
            const txtPlDivRel = String(item.TXTPLACASDIVERGENCIA ?? item.txtplacasdivergencia ?? '').trim();
            if (fgPlacasRel === 'D') {
              const idConvRel = item.IDCONVOCACAO ?? item.idconvocacao;
              if (idConvRel != null) window.__relatorioConvJustificativaPlacas[idConvRel] = txtPlDivRel;
            }
            const viagemConf =
              item.VIAGEM_CONFIRMADA === 'S' ||
              item.VIAGEM_CONFIRMADA === 's' ||
              item.viagem_confirmada === 'S' ||
              item.viagem_confirmada === 's';
            const statusConv = item.STATUS;
            let trExtraClass = '';
            if (fgPlacasRel === 'D') trExtraClass = ' relatorio-row-divergencia-placas';
            else if (statusConv === 'PENDENTE' && viagemConf) trExtraClass = ' relatorio-row-pendente-viagem-ja-confirmada';

            let statusDisplay = item.STATUS || 'PENDENTE';
            if (statusConv === 'ACEITA_DESCARTADA') {
              statusDisplay = 'ACEITA (Não Selecionada)';
            } else if (statusConv === 'RECUSADA' && item.MOTIVO_RECUSA) {
              statusDisplay = `RECUSADA - ${item.MOTIVO_RECUSA}`;
            }

            const sgRel = String(item.SGUSER ?? item.sguser ?? '').trim().toUpperCase();
            const latR = item.LATITUDE ?? item.latitude;
            const lngR = item.LONGITUDE ?? item.longitude;

            const linhasTooltip = [String(statusDisplay || '').trim() || statusConv || '—'];
            if (sgRel === 'APP_MOTORISTA_LINK') {
              linhasTooltip.push('Última resposta: link público de campanha (oportunidades).');
            }
            if (fgPlacasRel === 'D') {
              linhasTooltip.push(
                statusConv === 'PENDENTE'
                  ? 'Divergência de placas — aceite bloqueado até alinhar na torre.'
                  : 'Divergência de placas registrada (FG = D). Verifique alinhamento com o motorista.',
              );
            }
            if (statusConv === 'PENDENTE' && viagemConf) {
              linhasTooltip.push('Viagem já confirmada com outro motorista.');
            }
            const titleRespostaCel = escAttrRel(linhasTooltip.join(' '));

            let iconStatusConv =
              '<i class="bx bx-help-circle" aria-hidden="true" style="color:#94a3b8;font-size:1.25rem;flex-shrink:0;"></i>';
            if (fgPlacasRel === 'D') {
              iconStatusConv =
                '<i class="bx bx-error" aria-hidden="true" style="color:#dc2626;font-size:1.35rem;flex-shrink:0;" title="Divergência de placas — confirmar na torre bloqueado até alinhar"></i>';
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

            const idConvJust = item.IDCONVOCACAO ?? item.idconvocacao;
            const badgeDivPlacas =
              fgPlacasRel === 'D'
                ? '<span class="relatorio-badge-divergencia-placas" style="display:inline-block;margin-top:4px;padding:2px 6px;font-size:10px;font-weight:700;border-radius:4px;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;line-height:1.2;white-space:normal;max-width:100%;" title="Divergência de placas (app/link)">Divergência placas</span>' +
                  '<button type="button" class="relatorio-btn-ver-justificativa" onclick="abrirJustificativaDivergenciaConvocacaoRelatorio(' +
                  idConvJust +
                  ')">Ver justificativa</button>'
                : '';

            const htmlCelResposta = `<div class="convocacao-cel-resposta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:100%;min-width:0;" title="${titleRespostaCel}">
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                ${criarIndicadorGeolocalizacao(latR, lngR)}
                ${iconStatusConv}
              </div>
              <div class="convocacao-cel-resposta-data" style="font-size:12px;line-height:1.35;min-width:0;flex:1 1 100%;">
                <div>${formatarData(item.DHRESPOSTA ?? item.dhresposta)}</div>
                ${badgeDivPlacas}
              </div>
            </div>`;
            
            return `
            <tr class="${rowClass}${trExtraClass}" style="border-bottom: 1px solid var(--border, #eee);">
              <td style="padding: 10px 8px; vertical-align: top;">${item.IDCONVOCACAO}</td>
              <td style="padding: 10px 8px; vertical-align: top;">
                <button onclick="abrirViagem(${item.IDVIAGEM})" 
                        class="btn-link" 
                        style="background: none; border: none; color: var(--ac-accent, #667eea); cursor: pointer; text-decoration: underline; font-weight: 600; padding: 0;"
                        title="Clique para ver detalhes da viagem">
                  <strong>${item.IDVIAGEM}</strong>
                </button><br>
                <small class="text-muted">${item.DSCLASSEFROTA || '-'}</small>
              </td>
              <td class="rel-td-rota" style="padding: 10px 8px; vertical-align: top;">
                ${item.ORIGEM_CIDADE || '-'}/${item.ORIGEM_ESTADO || '-'}<br>
                <small class="text-muted">→ ${item.DESTINO_CIDADE || '-'}/${item.DESTINO_ESTADO || '-'}</small>
              </td>
              <td class="rel-td-motorista" style="padding: 10px 8px; vertical-align: top;">
                ${item.NOME_MOTORISTA || 'N/A'}<br>
                <small class="text-muted rel-motorista-tel-line" style="font-size: 11px;" title="Contato — use o botão WhatsApp em Ações para abrir o chat">${item.NRCELULAR ? formatarCelular(item.NRCELULAR) : '—'}</small>
              </td>
              <td style="padding: 10px 8px; font-size: 12px; vertical-align: top;">
                ${item.DHACESSO 
                  ? `<div class="cell-acesso cell-ok" style="display: flex; align-items: center; gap: 6px;">
                       <i class="bx bx-check-circle" style="font-size: 1.25rem;"></i>
                       <div>
                         <div class="text-ok" style="font-weight: 600; font-size: 12px;">Acessou</div>
                         <small class="text-muted" style="font-size: 10px;">${formatarData(item.DHACESSO)}</small>
                       </div>
                     </div>` 
                  : `<div class="cell-acesso cell-pending" style="display: flex; align-items: center; gap: 6px;">
                       <i class="bx bx-x-circle" style="font-size: 1.25rem;"></i>
                       <div>
                         <div class="text-pending" style="font-weight: 600; font-size: 12px;">Não acessou</div>
                         <small class="text-muted" style="font-size: 10px;">Aguardando</small>
                       </div>
                     </div>`}
              </td>
              <td class="rel-td-resposta" style="padding: 10px 8px; font-size: 12px; vertical-align: top;">${htmlCelResposta}</td>
              <td class="col-acoes relatorio-td-acoes" style="padding: 10px 4px; vertical-align: top; text-align: center;">
                ${criarBotoesAcoes(item)}
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.innerHTML = tabela;
  }

  window.abrirJustificativaDivergenciaConvocacaoRelatorio = function (idConvocacao) {
    const id = idConvocacao == null ? '' : String(idConvocacao).trim();
    const map = window.__relatorioConvJustificativaPlacas || {};
    const texto = id && map[id] != null ? String(map[id]) : '';
    const pre = document.getElementById('modalJustificativaDivergenciaPlacasCorpoRel');
    const modal = document.getElementById('modalJustificativaDivergenciaPlacasRel');
    if (pre) {
      pre.textContent = texto.trim() ? texto : '(Sem texto de justificativa gravado.)';
    }
    if (modal) {
      modal.style.display = 'flex';
    }
  };

  window.fecharModalJustificativaDivergenciaPlacasRelatorio = function () {
    const modal = document.getElementById('modalJustificativaDivergenciaPlacasRel');
    if (modal) modal.style.display = 'none';
  };

  // Função global para ordenar tabela
  window.ordenarTabela = function(coluna) {
    if (ordemAtual.coluna === coluna) {
      // Inverter direção
      ordemAtual.direcao = ordemAtual.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      // Nova coluna, começar com asc
      ordemAtual.coluna = coluna;
      ordemAtual.direcao = 'asc';
    }
    
    // Re-renderizar tabela
    if (dadosAtuais && dadosAtuais.lista) {
      atualizarTabela(dadosAtuais.lista);
    }
  };

  function formatarData(data) {
    if (!data) return '-';
    return fmtDataHora(data);
  }

  function formatarValor(valor, codigoMoeda) {
    if (valor === null || valor === undefined) valor = 0;
    const m = (codigoMoeda && String(codigoMoeda).trim()) || 'BRL';
    const loc = contextoRelatorio.locale || 'pt-BR';
    try {
      if (typeof window.formatarMoeda === 'function') return window.formatarMoeda(parseFloat(valor) || 0, m, loc);
    } catch (e) {}
    return new Intl.NumberFormat(loc, { style: 'currency', currency: m }).format(parseFloat(valor) || 0);
  }

  // Formatar celular
  function formatarCelular(celular) {
    if (!celular) return '-';
    
    // Limpar número: remover espaços, parênteses, hífens, pontos
    let numeroLimpo = String(celular).replace(/\s+/g, '').replace(/[()\-\.]/g, '');
    
    if (numeroLimpo && numeroLimpo.length >= 10) {
      // Remover código do país (55) se existir para formatação
      let numeroParaFormatar = numeroLimpo;
      if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 12) {
        numeroParaFormatar = numeroLimpo.substring(2); // Remove o 55
      }
      
      if (numeroParaFormatar.length === 11) {
        // Formato: (49) 99946-9449
        return `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 7)}-${numeroParaFormatar.substring(7)}`;
      } else if (numeroParaFormatar.length === 10) {
        // Formato: (49) 9946-9449
        return `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 6)}-${numeroParaFormatar.substring(6)}`;
      }
    }
    
    return celular; // Retornar original se inválido
  }

  // Criar botões da coluna Ações (Link, WhatsApp, Mapa) – ícones Boxicons padronizados
  function criarBotoesAcoes(item) {
    const baseUrl = window.__BASE_URL__ || window.location.origin;
    const linkConvocacao = baseUrl.replace(/\/$/, '') + '/convocacao/' + (item.IDCONVOCACAO || item.idconvocacao);
    const btnStyle =
      'box-sizing:border-box;padding:0;width:34px;height:34px;font-size:1.05rem;color:#fff;border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity 0.2s;';
    const latA = item.LATITUDE ?? item.latitude;
    const lngA = item.LONGITUDE ?? item.longitude;
    const idR = item.IDROTEIRO ?? item.idroteiro;
    const temMapa =
      idR &&
      latA != null &&
      lngA != null &&
      !isNaN(Number(latA)) &&
      !isNaN(Number(lngA));
    const temCelular = item.NRCELULAR && item.NRCELULAR !== 'N/A' && String(item.NRCELULAR).replace(/\D/g, '').length >= 10;

    let inner = '';
    inner += `<a href="${linkConvocacao}" target="_blank" rel="noopener noreferrer" class="btn btn-acao btn-acao-link" style="${btnStyle} background:#2196F3;" title="Abrir link público da convocação"><i class="bx bx-link-alt" aria-hidden="true"></i></a>`;
    if (temCelular) {
      let num = String(item.NRCELULAR).replace(/\D/g, '');
      if (num.startsWith('0')) num = num.substring(1);
      if (num.length < 12) num = '55' + num;
      const urlWa = 'https://wa.me/' + num;
      const waTitle = escAttrRel('WhatsApp — ' + formatarCelular(item.NRCELULAR));
      inner += `<a href="${urlWa}" target="_blank" rel="noopener noreferrer" class="btn btn-acao btn-acao-whatsapp" style="${btnStyle} background:#25D366;" title="${waTitle}"><i class="bx bxl-whatsapp" aria-hidden="true"></i></a>`;
    }
    if (temMapa) {
      inner += `<button type="button" onclick="abrirMapaMotorista(${item.IDCONVOCACAO}, ${latA}, ${lngA}, ${idR}, ${item.IDVIAGEM})" class="btn btn-acao btn-acao-mapa" style="${btnStyle} background:#15803d;" title="Ver motorista no mapa (rota)"><i class="bx bx-map-alt" aria-hidden="true"></i></button>`;
    }
    const dhConvFmt = formatarData(item.DHCONVOCACAO ?? item.dhconvocacao);
    const botoesRow = inner
      ? `<div class="relatorio-acoes-row" role="group" aria-label="Ações da convocação" style="display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:center;gap:4px;">${inner}</div>`
      : '<span class="text-muted" style="font-size: 12px;">-</span>';
    return `<div class="relatorio-acoes-cell">
      ${botoesRow}
      <div class="relatorio-acoes-dhconv" title="Data/hora da convocação (DHCONVOCACAO)">${dhConvFmt}</div>
    </div>`;
  }

  function escAttrRel(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Criar indicador de geolocalização
  function criarIndicadorGeolocalizacao(latitude, longitude) {
    const temLocalizacao = latitude !== null && latitude !== undefined && 
                           longitude !== null && longitude !== undefined &&
                           !isNaN(latitude) && !isNaN(longitude);
    
    const classe = temLocalizacao ? 'has-location' : 'no-location';
    const titulo = temLocalizacao 
      ? 'Localização capturada - Motorista colaborou' 
      : 'Localização não capturada - Motorista não colaborou';
    
    return `<span class="geoloc-indicator ${classe}" title="${titulo}"></span>`;
  }

  // Limpar filtros
  window.limparFiltros = function() {
    // Limpar todos os campos de filtro
    const filtroDataInicio = document.getElementById('filtroDataInicio');
    const filtroDataFim = document.getElementById('filtroDataFim');
    const filtroStatus = document.getElementById('filtroStatus');
    const filtroIdViagem = document.getElementById('filtroIdViagem');
    const filtroIdConvocacao = document.getElementById('filtroIdConvocacao');
    const filtroMotorista = document.getElementById('filtroMotorista');
    const filtroViagemConfirmada = document.getElementById('filtroViagemConfirmada');
    const filtroMotivoRecusa = document.getElementById('filtroMotivoRecusa');
    const filtroContratador = document.getElementById('filtroContratador');
    const filtroDivergenciaPlacasRel = document.getElementById('filtroDivergenciaPlacasRel');
    
    // Limpar valores e garantir que estão vazios
    if (filtroDataInicio) {
      filtroDataInicio.value = '';
      filtroDataInicio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroDataFim) {
      filtroDataFim.value = '';
      filtroDataFim.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroStatus) {
      filtroStatus.value = '';
      filtroStatus.selectedIndex = 0; // Voltar para primeira opção
      filtroStatus.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroIdViagem) {
      filtroIdViagem.value = '';
      filtroIdViagem.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (filtroIdConvocacao) {
      filtroIdConvocacao.value = '';
      filtroIdConvocacao.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (filtroMotorista) {
      filtroMotorista.value = '';
      filtroMotorista.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (filtroViagemConfirmada) {
      filtroViagemConfirmada.value = '';
      filtroViagemConfirmada.selectedIndex = 0; // Voltar para primeira opção
      filtroViagemConfirmada.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroMotivoRecusa) {
      filtroMotivoRecusa.value = '';
      filtroMotivoRecusa.selectedIndex = 0; // Voltar para primeira opção
      filtroMotivoRecusa.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroContratador) {
      filtroContratador.value = '';
      filtroContratador.selectedIndex = 0; // Voltar para primeira opção
      filtroContratador.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (filtroDivergenciaPlacasRel) {
      filtroDivergenciaPlacasRel.checked = false;
    }
    
    // Resetar ordenação
    ordemAtual = { coluna: null, direcao: 'asc' };
    
    // Aguardar um pouco para garantir que os campos foram limpos
    setTimeout(() => {
      // Recarregar com filtros limpos
      buscarRelatorio();
    }, 100);
  };

  // Exportar relatório
  window.exportarRelatorio = function() {
    if (!dadosAtuais || !dadosAtuais.lista || dadosAtuais.lista.length === 0) {
      alert('Não há dados para exportar.');
      return;
    }

    // Criar CSV
    const headers = ['ID', 'Viagem', 'Motorista', 'Celular', 'Status', 'FG placas', 'Texto divergência', 'Convocação', 'Resposta', 'Acesso', 'Rota', 'Confirmada'];
    const rows = dadosAtuais.lista.map(item => {
      const rota = item.ORIGEM_CIDADE && item.ORIGEM_ESTADO && item.DESTINO_CIDADE && item.DESTINO_ESTADO
        ? `${item.ORIGEM_CIDADE}/${item.ORIGEM_ESTADO} → ${item.DESTINO_CIDADE}/${item.DESTINO_ESTADO}`
        : (item.DSROTEIRO || '');
      const fgP = item.FGCONFIRMACAOPLACAS ?? item.fgconfirmacaoplacas ?? '';
      const txtDiv = item.TXTPLACASDIVERGENCIA ?? item.txtplacasdivergencia ?? '';
      return [
        item.IDCONVOCACAO,
        item.IDVIAGEM,
        item.NOME_MOTORISTA || '',
        item.NRCELULAR || '',
        item.STATUS,
        fgP,
        String(txtDiv || '').replace(/"/g, '""'),
        formatarData(item.DHCONVOCACAO),
        formatarData(item.DHRESPOSTA),
        formatarData(item.DHACESSO),
        rota,
        item.VIAGEM_CONFIRMADA === 'S' ? 'Sim' : 'Não'
      ];
    });

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio-convocoes-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  function getAuthHeadersRel(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

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

  // Variáveis e helpers do mapa (alinhados ao modal em Gerenciar Viagens)
  let mapaMotorista = null;
  let mapaMotoristaLayer = null;

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

  async function carregarLeaflet() {
    if (typeof L !== 'undefined') {
      return true;
    }

    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="leaflet"]')) {
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof L !== 'undefined') {
            clearInterval(checkInterval);
            resolve(true);
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            reject(new Error('Timeout ao carregar Leaflet'));
          }
        }, 500);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = () => {
        setTimeout(() => {
          if (typeof L !== 'undefined') {
            resolve(true);
          } else {
            reject(new Error('Leaflet carregado mas L não está disponível'));
          }
        }, 100);
      };
      script.onerror = () => reject(new Error('Erro ao carregar o script do Leaflet'));
      document.head.appendChild(script);
    });
  }

  window.abrirMapaMotorista = async function(idConvocacao, latMotorista, lonMotorista, idRoteiro, idViagem) {
    try {
      const chFloat = document.getElementById('mapaMotoristaChegadaFloat');
      if (chFloat) chFloat.style.display = 'none';

      const fonteDados = (listaOrdenada && listaOrdenada.length ? listaOrdenada : (dadosAtuais?.lista || []));
      let convocacao = fonteDados.find(c => Number(c.IDCONVOCACAO) === Number(idConvocacao));

      if (!convocacao) {
        if (typeof showMessage !== 'undefined') {
          showMessage('Convocação não encontrada.', 'error');
        } else {
          alert('Convocação não encontrada.');
        }
        return;
      }

      const bannerTexto = document.getElementById('mapaBannerUltimaPosicaoTexto');
      if (bannerTexto) {
        bannerTexto.textContent = 'Carregando…';
        bannerTexto.classList.add('banner-sem-dados');
      }

      try {
        const respConv = await fetch(`/api/convocacoes/${idConvocacao}`, { headers: getAuthHeadersRel() });
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
          convocacao.ultima_posicao_viagem_dh;
        const dhMaintConv =
          convocacao.DHMAINTENANCE_CONVOCACAO ??
          convocacao.dhmaintenance_convocacao;
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
      };
      aplicarTextoUltimaPosicao();

      document.getElementById('mapaInfoMotorista').textContent = convocacao.NOME_MOTORISTA || '-';
      const celularFormatado = formatarCelular(convocacao.CELULAR_MOTORISTA || convocacao.NRCELULAR);
      document.getElementById('mapaInfoCelular').textContent = celularFormatado;
      document.getElementById('mapaInfoViagem').textContent = idViagem || '-';
      document.getElementById('mapaInfoRoteiro').textContent = convocacao.DSROTEIRO || '-';

      const formatarPeso = (peso) => {
        if (!peso) return '-';
        return `${parseFloat(peso).toFixed(3).replace('.', ',')} ton`;
      };

      let vlFrete = convocacao.VLFRETE;
      let peso = convocacao.PESO;
      let cubagem = convocacao.CUBAGEM;
      let moeda = convocacao.MOEDA || 'BRL';

      if (!vlFrete && idViagem) {
        try {
          const viagemResponse = await fetch(`/api/viagens/${idViagem}`);
          if (viagemResponse.ok) {
            const viagem = await viagemResponse.json();
            vlFrete = viagem.VLFRETE || vlFrete;
            peso = viagem.PESO || peso;
            cubagem = viagem.CUBAGEM || cubagem;
            if (viagem.MOEDA) moeda = viagem.MOEDA;
          }
        } catch (err) {
          console.error('Erro ao buscar dados da viagem:', err);
        }
      }

      const distanciaEl = document.getElementById('mapaInfoDistancia');
      if (distanciaEl) {
        distanciaEl.textContent = 'Calculando...';
        distanciaEl.style.color = '#3498db';
        distanciaEl.style.fontWeight = '600';
      }

      const modal = document.getElementById('modalMapaMotorista');
      modal.style.display = 'block';

      let origemLat = null;
      let origemLon = null;
      let origemNome = 'Origem';

      if (idRoteiro) {
        try {
          const pontosResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
          if (pontosResponse.ok) {
            const pontos = await pontosResponse.json();
            // Priorizar TPLOCAL = 'O' (Origem), depois ORDEM = 1 como fallback
            let pontoOrigem = pontos.find(p => p.TPLOCAL === 'O' && p.LATITUDE && p.LONGITUDE);
            if (!pontoOrigem) {
              pontoOrigem = pontos.find(p => p.ORDEM === 1 && p.LATITUDE && p.LONGITUDE);
            }
            if (pontoOrigem && pontoOrigem.LATITUDE && pontoOrigem.LONGITUDE) {
              origemLat = parseFloat(pontoOrigem.LATITUDE);
              origemLon = parseFloat(pontoOrigem.LONGITUDE);
              origemNome = pontoOrigem.DSLOCAL || (pontoOrigem.DSPOSICAO || 'Origem');
              console.log('[MAPA] Ponto de origem encontrado:', {
                idRoteiro,
                nome: origemNome,
                lat: origemLat,
                lon: origemLon,
                ordem: pontoOrigem.ORDEM,
                tipo: pontoOrigem.TPLOCAL
              });
            } else {
              console.warn('[MAPA] Ponto de origem não encontrado no roteiro:', idRoteiro);
            }
          }
        } catch (err) {
          console.error('Erro ao buscar pontos do roteiro:', err);
        }
      }

      await carregarLeaflet();
      
      // Verificar se o elemento do mapa existe e está visível
      const mapaDiv = document.getElementById('mapaMotorista');
      if (!mapaDiv) {
        console.error('Elemento mapaMotorista não encontrado');
        return;
      }

      // Aguardar um pouco para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 300));

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

      // Adicionar camada de tiles do servidor próprio
      // IMPORTANTE: Forçar HTTP (não HTTPS) para evitar ERR_SSL_PROTOCOL_ERROR
      const tileServer = window.getTileServerUrl
        ? window.getTileServerUrl()
        : (window.MAP_CONFIG?.tileServer || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png');
      L.tileLayer(tileServer, {
        attribution: window.MAP_CONFIG?.attribution || '© OpenStreetMap contributors',
        maxZoom: window.MAP_CONFIG?.maxZoom || 19
      }).addTo(mapaMotorista);

      mapaMotorista.whenReady(() => {
        requestAnimationFrame(() => {
          try {
            mapaMotorista.invalidateSize(true);
          } catch (e) {
            /* ignore */
          }
        });
      });

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

      const marcadorMotorista = L.marker([latMotorista, lonMotorista], { icon: iconeMotorista })
        .addTo(mapaMotorista)
        .bindPopup(`
          <div style="min-width: 220px; max-width: 300px;">
            <div style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 10px; border-radius: 6px 6px 0 0; margin: -10px -10px 10px -10px;">
              <h3 style="margin: 0; font-size: 16px; font-weight: 600;">🚛 Motorista</h3>
            </div>
            <div style="padding: 5px 0;">
              <p style="margin: 4px 0; font-size: 13px;"><strong>Nome:</strong> ${convocacao.NOME_MOTORISTA || '-'}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Celular:</strong> ${(convocacao.CELULAR_MOTORISTA || convocacao.NRCELULAR || '-')}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Status:</strong> <span style="padding: 2px 6px; border-radius: 3px; background: #fff3cd; color: #856404; font-size: 11px;">${convocacao.STATUS || '-'}</span></p>
            </div>
            <hr style="margin: 8px 0; border: none; border-top: 1px solid #e0e0e0;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 8px; border-radius: 4px; margin: 5px 0;">
              <h4 style="margin: 0; font-size: 14px; font-weight: 600;">📦 Carga</h4>
            </div>
            <div style="padding: 5px 0;">
              <p style="margin: 4px 0; font-size: 13px;"><strong>ID Viagem:</strong> ${idViagem || '-'}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Frete:</strong> <span style="color: #28a745; font-weight: 600;">${formatarValor(vlFrete, moeda)}</span></p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Peso:</strong> ${formatarPeso(peso)}</p>
              <p style="margin: 4px 0; font-size: 13px;"><strong>Classe:</strong> ${convocacao.DSCLASSEFROTA || '-'}</p>
            </div>
          </div>
        `, { maxWidth: 320 });

      let marcadorOrigem = null;
      if (origemLat && origemLon) {
        marcadorOrigem = L.marker([origemLat, origemLon], { icon: iconeOrigem })
          .addTo(mapaMotorista)
          .bindPopup(`
            <div style="min-width: 220px; max-width: 300px;">
              <div style="background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); color: white; padding: 10px; border-radius: 6px 6px 0 0; margin: -10px -10px 10px -10px;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600;">📍 Local de Carregamento</h3>
              </div>
              <div style="padding: 5px 0;">
                <p style="margin: 4px 0; font-size: 13px;"><strong>Local:</strong> ${origemNome}</p>
                <p style="margin: 4px 0; font-size: 13px;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
                <p style="margin: 4px 0; font-size: 12px; color: #666;"><em>Ponto de origem do roteiro</em></p>
              </div>
            </div>
          `, { maxWidth: 320 });

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

            console.log('[MAPA] Rota calculada:', {
              motorista: { lat: latMotorista, lon: lonMotorista },
              origem: { lat: origemLat, lon: origemLon, nome: origemNome },
              distancia: `${distanciaKm} km`,
              tempo: `${duracaoMin} min`,
              roteiro: convocacao.DSROTEIRO
            });
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
          console.error('[ROTA-OSRM] Erro ao calcular rota:', err);
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
        document.getElementById('mapaInfoDistancia').style.color = '#dc3545';
        atualizarPainelChegadaMapaMotorista(convocacao, { durationSec: null, origemOk: false });
        console.warn('[MAPA] Origem não encontrada no roteiro:', idRoteiro);
        setTimeout(() => {
          try {
            mapaMotorista.invalidateSize(true);
          } catch (e) {
            /* ignore */
          }
        }, 200);
      }

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
      if (typeof showMessage !== 'undefined') {
        showMessage('Erro ao carregar mapa. ' + err.message, 'error');
      } else {
        alert('Erro ao carregar mapa. ' + err.message);
      }
    }
  };

  window.fecharModalMapaMotorista = function() {
    const modal = document.getElementById('modalMapaMotorista');
    modal.style.display = 'none';
    const chF = document.getElementById('mapaMotoristaChegadaFloat');
    if (chF) chF.style.display = 'none';

    if (mapaMotorista) {
      mapaMotorista.remove();
      mapaMotorista = null;
      mapaMotoristaLayer = null;
    }
  };

  function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

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

  // Função auxiliar para aguardar elementos do DOM
  function aguardarElementos(ids, callback, maxTentativas = 10, intervalo = 200) {
    let tentativas = 0;
    const verificar = () => {
      tentativas++;
      const elementos = ids.map(id => document.getElementById(id));
      const todosEncontrados = elementos.every(el => el !== null);
      
      if (todosEncontrados || tentativas >= maxTentativas) {
        // Executar callback mesmo se não encontrou todos (para não bloquear)
        callback();
      } else {
        setTimeout(verificar, intervalo);
      }
    };
    verificar();
  }

  // Aguardar DOM e scripts carregarem antes de inicializar
  // Aguardar elementos críticos antes de inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      aguardarElementos(['estatisticasCards', 'tabelaContainer', 'graficoStatus', 'graficoPorData'], () => {
        init();
      });
    });
  } else {
    // DOM já carregado
    aguardarElementos(['estatisticasCards', 'tabelaContainer', 'graficoStatus', 'graficoPorData'], () => {
      init();
    });
  }
})();

