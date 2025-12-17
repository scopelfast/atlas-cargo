// backend/public/modulos/relatorio-convocacoes/js/script.js
// Relatório de Convocações - Frontend
// Versão: 1.0

(function() {
  let chartStatus = null;
  let chartPorData = null;
  let dadosAtuais = null;
  let listaOrdenada = [];
  let ordemAtual = { coluna: null, direcao: 'asc' };

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
    // Aguardar um pouco para garantir que scripts externos carregaram
    await new Promise(resolve => setTimeout(resolve, 500));
    
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
      console.warn('Elemento estatisticasCards não encontrado no DOM');
      return;
    }
    
    if (!estatisticas || !estatisticas.TOTAL) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p>Nenhum dado encontrado</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="card" style="border: 2px solid #667eea; background: linear-gradient(135deg, #f8f9ff 0%, #e8ebff 100%);">
        <div class="card-title">Total de Viagens</div>
        <div class="card-value" style="color: #667eea; font-size: 2em; font-weight: 700;">${estatisticas.TOTAL_VIAGENS || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Total</div>
        <div class="card-value total">${estatisticas.TOTAL || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Pendente</div>
        <div class="card-value pendente">${estatisticas.PENDENTE || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Aceita</div>
        <div class="card-value aceita">${estatisticas.ACEITA || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Recusada</div>
        <div class="card-value recusada">${estatisticas.RECUSADA || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Confirmada</div>
        <div class="card-value confirmada">${estatisticas.CONFIRMADA || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Aceita Descartada</div>
        <div class="card-value">${estatisticas.ACEITA_DESCARTADA || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Com Acesso</div>
        <div class="card-value">${estatisticas.COM_ACESSO || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Com Resposta</div>
        <div class="card-value">${estatisticas.COM_RESPOSTA || 0}</div>
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
              position: 'bottom'
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
              position: 'bottom'
            },
            title: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true
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
      console.warn('Elemento tabelaContainer não encontrado no DOM');
      return;
    }
    
    if (!lista || lista.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>Nenhuma convocação encontrada</p></div>';
      return;
    }

    // Salvar lista original
    listaOrdenada = lista;
    
    // Aplicar ordenação se houver
    if (ordemAtual.coluna) {
      listaOrdenada = ordenarLista(lista, ordemAtual.coluna, ordemAtual.direcao);
    }

    // Função para criar header com ordenação
    const criarHeader = (nome, chave, largura = null) => {
      const isOrdenado = ordemAtual.coluna === nome;
      const seta = isOrdenado ? (ordemAtual.direcao === 'asc' ? ' ▲' : ' ▼') : ' ↕';
      const styleLargura = largura ? `width: ${largura}; min-width: ${largura};` : '';
      return `<th style="padding: 12px; text-align: left; cursor: pointer; user-select: none; ${styleLargura}" 
                onclick="ordenarTabela('${nome}')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Clique para ordenar">
        ${nome}${seta}
      </th>`;
    };

    const tabela = `
      <table>
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            ${criarHeader('ID', 'IDCONVOCACAO', '60px')}
            ${criarHeader('Viagem', 'IDVIAGEM', '100px')}
            ${criarHeader('Rota', 'ORIGEM_CIDADE', '150px')}
            ${criarHeader('Status', 'STATUS', '120px')}
            ${criarHeader('Motorista', 'NOME_MOTORISTA', '180px')}
            ${criarHeader('Convocação', 'DHCONVOCACAO', '70px')}
            ${criarHeader('Acesso', 'DHACESSO', '70px')}
            ${criarHeader('Resposta', 'DHRESPOSTA', '70px')}
            <th style="padding: 12px; text-align: left; width: 30px;" title="Indica se a viagem já possui uma convocação confirmada (independente desta convocação)"><span style="font-size: 14px;">ℹ️</span></th>
            <th style="padding: 12px; text-align: left; width: 50px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${listaOrdenada.map((item, index) => {
            const rowStyle = index % 2 === 0 ? 'background: #fafafa;' : '';
            
            // Formatar status igual ao gerenciar-viagens
            let statusClass = '';
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
            <tr style="border-bottom: 1px solid #eee; ${rowStyle}">
              <td style="padding: 12px;">${item.IDCONVOCACAO}</td>
              <td style="padding: 12px;">
                <button onclick="abrirViagem(${item.IDVIAGEM})" 
                        class="btn-link" 
                        style="background: none; border: none; color: #667eea; cursor: pointer; text-decoration: underline; font-weight: 600; padding: 0;"
                        title="Clique para ver detalhes da viagem">
                  <strong>${item.IDVIAGEM}</strong>
                </button><br>
                <small style="color: #666;">${item.DSCLASSEFROTA || '-'}</small>
              </td>
              <td style="padding: 12px;">
                ${item.ORIGEM_CIDADE || '-'}/${item.ORIGEM_ESTADO || '-'}<br>
                <small style="color: #666;">→ ${item.DESTINO_CIDADE || '-'}/${item.DESTINO_ESTADO || '-'}</small>
              </td>
              <td style="padding: 12px;">
                ${criarIndicadorGeolocalizacao(item.LATITUDE, item.LONGITUDE)}
                <span style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${statusClass}">
                  ${statusDisplay}
                </span>
              </td>
              <td style="padding: 12px;">
                ${item.NOME_MOTORISTA || 'N/A'}<br>
                <small style="color: #666; font-size: 11px;">${item.NRCELULAR && item.NRCELULAR !== 'N/A' ? '📱 ' : ''}${criarLinkWhatsApp(item.NRCELULAR)}</small>
              </td>
              <td style="padding: 12px; font-size: 12px;">${formatarData(item.DHCONVOCACAO)}</td>
              <td style="padding: 12px; font-size: 12px;">
                ${item.DHACESSO 
                  ? `<div style="display: flex; align-items: center; gap: 6px;">
                       <span style="color: #28a745; font-size: 16px;">✅</span>
                       <div>
                         <div style="color: #28a745; font-weight: 600; font-size: 12px;">Acessou</div>
                         <small style="color: #666; font-size: 10px;">${formatarData(item.DHACESSO)}</small>
                       </div>
                     </div>` 
                  : `<div style="display: flex; align-items: center; gap: 6px;">
                       <span style="color: #dc3545; font-size: 16px;">❌</span>
                       <div>
                         <div style="color: #dc3545; font-weight: 600; font-size: 12px;">Não acessou</div>
                         <small style="color: #999; font-size: 10px;">Aguardando</small>
                       </div>
                     </div>`}
              </td>
              <td style="padding: 12px; font-size: 12px;">${formatarData(item.DHRESPOSTA)}</td>
              <td style="padding: 12px; text-align: center;" title="${item.VIAGEM_CONFIRMADA === 'S' ? 'Esta viagem já possui uma convocação confirmada' : 'Esta viagem ainda não possui convocação confirmada'}">
                ${item.VIAGEM_CONFIRMADA === 'S' ? '✅' : '❌'}
              </td>
              <td style="padding: 12px;">
                ${(item.IDROTEIRO && item.LATITUDE && item.LONGITUDE && !isNaN(item.LATITUDE) && !isNaN(item.LONGITUDE)) 
                  ? `<button onclick="abrirMapaMotorista(${item.IDCONVOCACAO}, ${item.LATITUDE}, ${item.LONGITUDE}, ${item.IDROTEIRO}, ${item.IDVIAGEM})" 
                      class="btn" 
                      style="padding: 8px 10px; font-size: 1.2em; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 36px;"
                      title="Ver localização do motorista e rota até o carregamento">
                        🗺️
                    </button>`
                  : ''}
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

  // Formatar data (sem conversão de fuso horário)
  function formatarData(data) {
    if (!data) return '-';
    
    // SQL Server retorna datas no formato ISO: 2025-11-21T10:39:24.123Z
    // Quando o JavaScript cria new Date(), ele interpreta como UTC e converte para o fuso local
    // Precisamos tratar a string diretamente para evitar conversão de fuso
    
    if (typeof data === 'string') {
      // Remover o Z se existir e tratar como data local
      let dataStr = data.replace('Z', '');
      
      // Se tem T, substituir por espaço
      if (dataStr.includes('T')) {
        dataStr = dataStr.replace('T', ' ');
      }
      
      // Extrair partes da data: 2025-11-21 10:39:24.123
      const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, year, month, day, hour, minute] = match;
        // Formatar manualmente para pt-BR (sem conversão de fuso)
        const diaStr = String(day).padStart(2, '0');
        const mesStr = String(month).padStart(2, '0');
        const anoStr = year;
        const horaStr = String(hour).padStart(2, '0');
        const minutoStr = String(minute).padStart(2, '0');
        
        return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
      }
    }
    
    // Fallback: extrair componentes UTC e tratar como local (sem conversão de fuso)
    try {
      const date = new Date(data);
      if (isNaN(date.getTime())) return '-';
      
      // Extrair componentes UTC e tratar como local (sem conversão de fuso)
      const ano = date.getUTCFullYear();
      const mes = date.getUTCMonth();
      const dia = date.getUTCDate();
      const hora = date.getUTCHours();
      const minuto = date.getUTCMinutes();
      
      // Formatar manualmente para pt-BR
      const diaStr = String(dia).padStart(2, '0');
      const mesStr = String(mes + 1).padStart(2, '0');
      const anoStr = ano;
      const horaStr = String(hora).padStart(2, '0');
      const minutoStr = String(minuto).padStart(2, '0');
      
      return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
    } catch (error) {
      return '-';
    }
  }

  // Formatar valor
  function formatarValor(valor) {
    if (!valor) return '0,00';
    return parseFloat(valor).toFixed(2).replace('.', ',');
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
    
    // Se não começar com 55 (código do Brasil), adicionar para o link
    if (!numeroLimpo.startsWith('55')) {
      // Se começar com 0, remover o 0
      if (numeroLimpo.startsWith('0')) {
        numeroLimpo = numeroLimpo.substring(1);
      }
      numeroLimpo = '55' + numeroLimpo;
    }
    
    // Validar se tem pelo menos 12 dígitos (55 + DDD + número)
    if (numeroLimpo.length < 12) {
      return celular; // Retornar número original se inválido
    }
    
    const urlWhatsApp = `https://wa.me/${numeroLimpo}`;
    
    return `<a href="${urlWhatsApp}" 
                target="_blank" 
                rel="noopener noreferrer"
                style="color: #25D366; text-decoration: none; font-weight: 500; font-size: 11px;"
                title="Abrir WhatsApp">
                ${celularFormatado}
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
      document.getElementById('mapaInfoCelular').textContent = (convocacao.CELULAR_MOTORISTA || convocacao.NRCELULAR || '-') ;
      document.getElementById('mapaInfoViagem').textContent = idViagem || '-';
      document.getElementById('mapaInfoRoteiro').textContent = convocacao.DSROTEIRO || '-';

      const formatarValor = (valor) => {
        if (!valor) return 'R$ 0,00';
        return `R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}`;
      };

      const formatarPeso = (peso) => {
        if (!peso) return '-';
        return `${parseFloat(peso).toFixed(3).replace('.', ',')} ton`;
      };

      let vlFrete = convocacao.VLFRETE;
      let peso = convocacao.PESO;
      let cubagem = convocacao.CUBAGEM;

      if (!vlFrete && idViagem) {
        try {
          const viagemResponse = await fetch(`/api/viagens/${idViagem}`);
          if (viagemResponse.ok) {
            const viagem = await viagemResponse.json();
            vlFrete = viagem.VLFRETE || vlFrete;
            peso = viagem.PESO || peso;
            cubagem = viagem.CUBAGEM || cubagem;
          }
        } catch (err) {
          console.error('Erro ao buscar dados da viagem:', err);
        }
      }

      document.getElementById('mapaInfoFrete').textContent = formatarValor(vlFrete);
      document.getElementById('mapaInfoPeso').textContent = formatarPeso(peso);
      document.getElementById('mapaInfoDistancia').textContent = 'Calculando...';

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

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
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
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; color: #e74c3c;">🚛 Motorista</h3>
            <p style="margin: 5px 0;"><strong>Nome:</strong> ${convocacao.NOME_MOTORISTA || '-'}</p>
            <p style="margin: 5px 0;"><strong>Celular:</strong> ${(convocacao.CELULAR_MOTORISTA || convocacao.NRCELULAR || '-')}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> ${convocacao.STATUS || '-'}</p>
            <hr style="margin: 10px 0;">
            <h4 style="margin: 10px 0 5px 0; color: #667eea;">📦 Carga</h4>
            <p style="margin: 5px 0;"><strong>ID Viagem:</strong> ${idViagem || '-'}</p>
            <p style="margin: 5px 0;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
            <p style="margin: 5px 0;"><strong>Frete:</strong> ${formatarValor(vlFrete)}</p>
            <p style="margin: 5px 0;"><strong>Peso:</strong> ${formatarPeso(peso)}</p>
            <p style="margin: 5px 0;"><strong>Classe:</strong> ${convocacao.DSCLASSEFROTA || '-'}</p>
          </div>
        `);

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
            mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
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
          mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
        }
      } else {
        mapaMotorista.setView([latMotorista, lonMotorista], 12);
        document.getElementById('mapaInfoDistancia').textContent = 'Origem não encontrada no roteiro';
      }

      marcadorMotorista.openPopup();

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

  // Aguardar DOM e scripts carregarem antes de inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Aguardar um pouco mais para garantir que scripts externos carregaram
      setTimeout(() => {
        init();
      }, 1000);
    });
  } else {
    // DOM já carregado, aguardar scripts externos
    setTimeout(() => {
      init();
    }, 1000);
  }
})();

