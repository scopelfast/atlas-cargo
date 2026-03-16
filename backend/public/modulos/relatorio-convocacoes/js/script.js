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

  function fmtDataHora(data) {
    if (data === null || data === undefined) return '-';
    const d = data instanceof Date ? data : new Date(data);
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
        <div class="stat-value">${estatisticas.PENDENTE || 0}</div>
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
    
    const dadosPendente = dadosPorData.map(d => d.PENDENTE || 0).reverse();
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
          valorA = new Date(a.DHCONVOCACAO || 0);
          valorB = new Date(b.DHCONVOCACAO || 0);
          break;
        case 'Resposta':
          valorA = new Date(a.DHRESPOSTA || 0);
          valorB = new Date(b.DHRESPOSTA || 0);
          break;
        case 'Acesso':
          valorA = new Date(a.DHACESSO || 0);
          valorB = new Date(b.DHACESSO || 0);
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
    
    // Aplicar ordenação se houver
    if (ordemAtual.coluna) {
      listaOrdenada = ordenarLista(lista, ordemAtual.coluna, ordemAtual.direcao);
    }

    // Função para criar header com ordenação (sem inline background para respeitar dark mode)
    const criarHeader = (nome, chave, largura = null) => {
      const isOrdenado = ordemAtual.coluna === nome;
      const seta = isOrdenado ? (ordemAtual.direcao === 'asc' ? ' ▲' : ' ▼') : ' ↕';
      const styleLargura = largura ? `width: ${largura}; min-width: ${largura};` : '';
      const sortedClass = isOrdenado ? ' th-sorted' : '';
      return `<th class="th-sortable${sortedClass}" style="padding: 12px; text-align: left; cursor: pointer; user-select: none; ${styleLargura}" 
                data-col="${nome}"
                onclick="ordenarTabela('${nome}')" 
                title="Clique para ordenar">
        ${nome}${seta}
      </th>`;
    };

    const tabela = `
      <table class="relatorio-table">
        <thead>
          <tr class="thead-row">
            ${criarHeader('ID', 'IDCONVOCACAO', '60px')}
            ${criarHeader('Viagem', 'IDVIAGEM', '100px')}
            ${criarHeader('Rota', 'ORIGEM_CIDADE', '150px')}
            ${criarHeader('Status', 'STATUS', '120px')}
            ${criarHeader('Motorista', 'NOME_MOTORISTA', '180px')}
            ${criarHeader('Convocação', 'DHCONVOCACAO', '70px')}
            ${criarHeader('Acesso', 'DHACESSO', '70px')}
            ${criarHeader('Resposta', 'DHRESPOSTA', '70px')}
            <th style="padding: 12px; text-align: left; width: 30px;" title="Indica se a viagem já possui uma convocação confirmada (independente desta convocação)"><i class="bx bx-info-circle th-info-icon"></i></th>
            <th class="col-acoes" style="padding: 12px; text-align: left;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${listaOrdenada.map((item, index) => {
            const rowClass = index % 2 === 0 ? 'row-even' : 'row-odd';
            
            // Formatar status com classe para dark mode
            let statusClass = '';
            let statusSlug = (item.STATUS || 'PENDENTE').toLowerCase().replace('_', '-');
            let statusDisplay = item.STATUS || 'PENDENTE';
            
            if (item.STATUS === 'PENDENTE') {
              statusClass = 'background: #fff3cd; color: #856404;';
            } else if (item.STATUS === 'ACEITA') {
              statusClass = 'background: #d4edda; color: #155724;';
            } else if (item.STATUS === 'ACEITA_DESCARTADA') {
              statusClass = 'background: #ffeaa7; color: #856404;';
              statusDisplay = 'ACEITA (Não Selecionada)';
            } else if (item.STATUS === 'RECUSADA') {
              statusClass = 'background: #f8d7da; color: #721c24;';
              if (item.MOTIVO_RECUSA) {
                statusDisplay = `RECUSADA - ${item.MOTIVO_RECUSA}`;
              }
            } else if (item.STATUS === 'CONFIRMADA') {
              statusClass = 'background: #cce5ff; color: #004085;';
            }
            
            return `
            <tr class="${rowClass}" style="border-bottom: 1px solid var(--border, #eee);">
              <td style="padding: 12px;">${item.IDCONVOCACAO}</td>
              <td style="padding: 12px;">
                <button onclick="abrirViagem(${item.IDVIAGEM})" 
                        class="btn-link" 
                        style="background: none; border: none; color: var(--ac-accent, #667eea); cursor: pointer; text-decoration: underline; font-weight: 600; padding: 0;"
                        title="Clique para ver detalhes da viagem">
                  <strong>${item.IDVIAGEM}</strong>
                </button><br>
                <small class="text-muted">${item.DSCLASSEFROTA || '-'}</small>
              </td>
              <td style="padding: 12px;">
                ${item.ORIGEM_CIDADE || '-'}/${item.ORIGEM_ESTADO || '-'}<br>
                <small class="text-muted">→ ${item.DESTINO_CIDADE || '-'}/${item.DESTINO_ESTADO || '-'}</small>
              </td>
              <td style="padding: 12px;">
                ${criarIndicadorGeolocalizacao(item.LATITUDE, item.LONGITUDE)}
                <span class="status-pill status-${statusSlug}" style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${statusClass}">
                  ${statusDisplay}
                </span>
              </td>
              <td style="padding: 12px;">
                ${item.NOME_MOTORISTA || 'N/A'}<br>
                <small class="text-muted" style="font-size: 11px;">${criarLinkWhatsApp(item.NRCELULAR)}</small>
              </td>
              <td style="padding: 12px; font-size: 12px;">${formatarData(item.DHCONVOCACAO)}</td>
              <td style="padding: 12px; font-size: 12px;">
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
              <td style="padding: 12px; font-size: 12px;">${formatarData(item.DHRESPOSTA)}</td>
              <td class="cell-confirmada" style="padding: 12px; text-align: center;" title="${item.VIAGEM_CONFIRMADA === 'S' ? 'Esta viagem já possui uma convocação confirmada' : 'Esta viagem ainda não possui convocação confirmada'}">
                ${item.VIAGEM_CONFIRMADA === 'S' ? '<i class="bx bx-check-circle icon-ok"></i>' : '<i class="bx bx-x-circle icon-pending"></i>'}
              </td>
              <td class="col-acoes" style="padding: 12px;">
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
    const btnStyle = 'padding: 6px 8px; font-size: 1rem; color: white; border: none; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 32px; margin-right: 2px; transition: opacity 0.2s;';
    const temMapa = item.IDROTEIRO && item.LATITUDE != null && item.LONGITUDE != null && !isNaN(item.LATITUDE) && !isNaN(item.LONGITUDE);
    const temCelular = item.NRCELULAR && item.NRCELULAR !== 'N/A' && String(item.NRCELULAR).replace(/\D/g, '').length >= 10;

    let html = '';
    // Link da convocação (abrir/copiar link público)
    html += `<a href="${linkConvocacao}" target="_blank" rel="noopener noreferrer" class="btn btn-acao btn-acao-link" style="${btnStyle} background: #2196F3;" title="Abrir link da convocação"><i class="bx bx-link-alt"></i></a>`;
    // WhatsApp
    if (temCelular) {
      let num = String(item.NRCELULAR).replace(/\D/g, '');
      if (num.startsWith('0')) num = num.substring(1);
      // Se já tem 12+ dígitos, número já inclui DDI (ex.: 595981123456); não forçar 55
      if (num.length < 12) num = '55' + num;
      const urlWa = 'https://wa.me/' + num;
      html += `<a href="${urlWa}" target="_blank" rel="noopener noreferrer" class="btn btn-acao btn-acao-whatsapp" style="${btnStyle} background: #25D366;" title="Abrir WhatsApp"><i class="bx bxl-whatsapp"></i></a>`;
    }
    // Ver no mapa
    if (temMapa) {
      html += `<button onclick="abrirMapaMotorista(${item.IDCONVOCACAO}, ${item.LATITUDE}, ${item.LONGITUDE}, ${item.IDROTEIRO}, ${item.IDVIAGEM})" class="btn btn-acao btn-acao-mapa" style="${btnStyle} background: #28a745;" title="Ver localização do motorista e rota até o carregamento"><i class="bx bx-map-alt"></i></button>`;
    }
    return html || '<span class="text-muted" style="font-size: 12px;">-</span>';
  }

  // Criar link do WhatsApp
  function criarLinkWhatsApp(celular) {
    if (!celular) return 'N/A';
    
    // Limpar número: remover espaços, parênteses, hífens, pontos
    let numeroLimpo = String(celular).replace(/\s+/g, '').replace(/[()\-\.]/g, '');
    
    // Formatar número para exibição (com parênteses e hífen)
    let celularFormatado = '';
    if (numeroLimpo && numeroLimpo.length >= 10) {
      // Remover código do país (55) se existir para formatação
      let numeroParaFormatar = numeroLimpo;
      if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 12) {
        numeroParaFormatar = numeroLimpo.substring(2); // Remove o 55
      }
      
      if (numeroParaFormatar.length === 11) {
        // Formato: (41) 99837-1769
        celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 7)}-${numeroParaFormatar.substring(7)}`;
      } else if (numeroParaFormatar.length === 10) {
        // Formato: (41) 9837-1769
        celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 6)}-${numeroParaFormatar.substring(6)}`;
      } else {
        // Formato simples se não tiver 10 ou 11 dígitos
        celularFormatado = numeroParaFormatar;
      }
    } else {
      celularFormatado = celular; // Retornar original se inválido
    }
    
    // Número pode já vir com DDI (ex.: 595, 54, 55). Só adicionar 55 se tiver 10-11 dígitos (Brasil sem DDI)
    if (numeroLimpo.startsWith('0')) numeroLimpo = numeroLimpo.substring(1);
    if (numeroLimpo.length >= 12) {
      // Já tem DDI; usar como está
    } else if (numeroLimpo.length >= 10) {
      numeroLimpo = '55' + numeroLimpo;
    }
    if (numeroLimpo.length < 12) return celular;
    const urlWhatsApp = `https://wa.me/${numeroLimpo}`;
    
    return `<a href="${urlWhatsApp}" 
                target="_blank" 
                rel="noopener noreferrer"
                class="link-whatsapp"
                style="color: #25D366; text-decoration: none; font-weight: 500; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;"
                title="Abrir WhatsApp">
                <i class="bx bxl-whatsapp" style="font-size: 1em;"></i> ${celularFormatado}
              </a>`;
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
    const headers = ['ID', 'Viagem', 'Motorista', 'Celular', 'Status', 'Convocação', 'Resposta', 'Acesso', 'Rota', 'Confirmada'];
    const rows = dadosAtuais.lista.map(item => {
      const rota = item.ORIGEM_CIDADE && item.ORIGEM_ESTADO && item.DESTINO_CIDADE && item.DESTINO_ESTADO
        ? `${item.ORIGEM_CIDADE}/${item.ORIGEM_ESTADO} → ${item.DESTINO_CIDADE}/${item.DESTINO_ESTADO}`
        : (item.DSROTEIRO || '');
      return [
        item.IDCONVOCACAO,
        item.IDVIAGEM,
        item.NOME_MOTORISTA || '',
        item.NRCELULAR || '',
        item.STATUS,
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


  // Variáveis e helpers do mapa (compartilhados com Gerenciar Viagens)
  let mapaMotorista = null;
  let mapaMotoristaLayer = null;

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
      const fonteDados = (listaOrdenada && listaOrdenada.length ? listaOrdenada : (dadosAtuais?.lista || []));
      const convocacao = fonteDados.find(c => c.IDCONVOCACAO === idConvocacao);

      if (!convocacao) {
        if (typeof showMessage !== 'undefined') {
          showMessage('Convocação não encontrada.', 'error');
        } else {
          alert('Convocação não encontrada.');
        }
        return;
      }

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

      document.getElementById('mapaInfoFrete').textContent = formatarValor(vlFrete, moeda);
      document.getElementById('mapaInfoPeso').textContent = formatarPeso(peso);
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
      const tileServer = (window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png')).replace(/^https:/, 'http:');
      L.tileLayer(tileServer, {
        attribution: window.MAP_CONFIG?.attribution || '© OpenStreetMap contributors',
        maxZoom: window.MAP_CONFIG?.maxZoom || 19
      }).addTo(mapaMotorista);

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

        try {
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${lonMotorista},${latMotorista};${origemLon},${origemLat}?overview=full&geometries=geojson`;
          const rotaResponse = await fetch(osrmUrl);
          const rotaData = await rotaResponse.json();

          if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
            const rota = rotaData.routes[0];
            const distanciaKm = (rota.distance / 1000).toFixed(2);
            const duracaoMin = Math.round(rota.duration / 60);

            document.getElementById('mapaInfoDistancia').textContent = `${distanciaKm} km (aprox. ${duracaoMin} min)`;

            if (mapaMotoristaLayer) {
              mapaMotorista.removeLayer(mapaMotoristaLayer);
            }

            mapaMotoristaLayer = L.geoJSON(rota.geometry, {
              style: {
                color: '#667eea',
                weight: 5,
                opacity: 0.7
              }
            }).addTo(mapaMotorista);

            const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem, mapaMotoristaLayer]);
            mapaMotorista.fitBounds(grupo.getBounds().pad(0.15));
            
            // Log para validação
            console.log('[MAPA] Rota calculada:', {
              motorista: { lat: latMotorista, lon: lonMotorista },
              origem: { lat: origemLat, lon: origemLon, nome: origemNome },
              distancia: `${distanciaKm} km`,
              tempo: `${duracaoMin} min`,
              roteiro: convocacao.DSROTEIRO
            });
          } else {
            const distanciaHaversine = calcularDistanciaHaversine(latMotorista, lonMotorista, origemLat, origemLon);
            document.getElementById('mapaInfoDistancia').textContent = `${distanciaHaversine.toFixed(2)} km (linha reta)`;
            const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem]);
            mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
          }
        } catch (err) {
          console.error('Erro ao calcular rota:', err);
          const distanciaHaversine = calcularDistanciaHaversine(latMotorista, lonMotorista, origemLat, origemLon);
          document.getElementById('mapaInfoDistancia').textContent = `${distanciaHaversine.toFixed(2)} km (linha reta)`;
          const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem]);
          mapaMotorista.fitBounds(grupo.getBounds().pad(0.15));
          
          // Log para validação
          console.log('[MAPA] Rota (linha reta):', {
            motorista: { lat: latMotorista, lon: lonMotorista },
            origem: { lat: origemLat, lon: origemLon, nome: origemNome },
            distancia: `${distanciaHaversine.toFixed(2)} km (linha reta)`,
            roteiro: convocacao.DSROTEIRO
          });
        }
      } else {
        mapaMotorista.setView([latMotorista, lonMotorista], 12);
        document.getElementById('mapaInfoDistancia').textContent = 'Origem não encontrada no roteiro';
        document.getElementById('mapaInfoDistancia').style.color = '#dc3545';
        console.warn('[MAPA] Origem não encontrada no roteiro:', idRoteiro);
      }

      // Não abrir popup automaticamente para não sobrepor o mapa
      // marcadorMotorista.openPopup();

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

