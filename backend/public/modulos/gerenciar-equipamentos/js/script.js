// backend/public/modulos/gerenciar-equipamentos/js/script.js
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const equipamentoForm = document.getElementById('equipamentoForm');
  const list = document.getElementById('equipamentosList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');

  let combosCarregados = false;
  let gridTab = null;
  let lastEquipamentos = null;
  let sqlExecutado = false;
  let initExecutado = false;

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

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    // Proteção: Se já foi executado, não executar novamente
    if (sqlExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    sqlExecutado = true;
    
    // Mostrar overlay de carregamento
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch('/modulos/gerenciar-equipamentos/sql/init.sql');
      
      // Atualizar mensagem do overlay
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          hideLoadingOverlayInitSQL();
          return;
        }
        hideLoadingOverlayInitSQL();
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
      
      // Atualizar mensagem: processando comandos
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      // Executar o SQL via API e AGUARDAR completamente a resposta
      let execResponse;
      try {
        execResponse = await fetch('/api/equipamentos/executar-init-sql', {
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
      
      // Verificar se todos os comandos foram executados com sucesso
      if (!result.success) {
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result.resultados && Array.isArray(result.resultados)) {
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        if (comandosComErro.length > 0) {
          // Filtrar erros "esperados" (como tabela já existe, índice já existe, etc.)
          const errosReais = comandosComErro.filter(erro => {
            const mensagem = (erro.mensagem || erro.erro || '').toLowerCase();
            // Erros esperados que não são problemas reais
            const errosEsperados = [
              'already exists',
              'já existe',
              'duplicate',
              'duplicado',
              'there is already',
              'já há'
            ];
            return !errosEsperados.some(esperado => mensagem.includes(esperado));
          });
          
          if (errosReais.length > 0) {
            // Log apenas erros reais críticos
            errosReais.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              if (typeof mensagem === 'object') {
                console.error('Erro no init.sql:', JSON.stringify(mensagem));
              } else {
                console.error('Erro no init.sql:', mensagem);
              }
            });
          }
        }
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
  }

  // Função de inicialização
  async function init() {
    // Se já foi executado, não executar novamente
    if (initExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    initExecutado = true;
    
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) se existir
    // e AGUARDAR completamente antes de prosseguir
    try {
      await executarInitSQL();
    } catch (err) {
      // Erros silenciosos - não bloquear o módulo
    }
    
    // Garantir que a aba de filtros está ativa e visível
    await showTab('filtros');
  }

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM já está pronto, executar imediatamente
    init();
  }

  // Função para mudar abas
  async function showTab(tabId) {
    try {
      // Primeiro, mudar a aba imediatamente
      tabs.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      const tabContent = document.getElementById(`tab-${tabId}`);
      
      if (tabBtn) {
        tabBtn.classList.add('active');
      }
      if (tabContent) {
        tabContent.classList.add('active');
      }
      
      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Se for a aba de grid, inicializar o GridEditor
      if (tabId === 'grid') {
        try {
          if (!gridTab) {
            if (typeof GridEditor === 'undefined') {
              await loadScript('/js/grid-editor.js');
            }
            inicializarGridTab();
          }
          // Sempre renderizar, mesmo se não houver dados (grid vazio)
          const equipamentosParaRenderizar = lastEquipamentos || [];
          if (gridTab) {
            gridTab.render(equipamentosParaRenderizar);
          } else if (equipamentosParaRenderizar.length === 0) {
            // Se não há dados e grid não está inicializado, aplicar filtros para buscar
            // Mas não bloquear a mudança de aba
            setTimeout(() => {
              applyFilters('grid').catch(err => {
                console.warn('[Equipamentos] Erro ao aplicar filtros automaticamente:', err);
              });
            }, 100);
          }
        } catch (gridErr) {
          console.warn('[Equipamentos] Erro ao processar grid:', gridErr);
          // Continuar mesmo se houver erro - não bloquear mudança de aba
        }
      }
    } catch (err) {
      console.warn('[Equipamentos] Erro ao mudar aba:', err);
      // Forçar mudança de aba mesmo em caso de erro
      try {
        tabs.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        const tabContent = document.getElementById(`tab-${tabId}`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) {
          tabContent.classList.add('active');
        }
      } catch (forceErr) {
        console.error('[Equipamentos] Erro ao forçar mudança de aba:', forceErr);
      }
    }
  }

  // Carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        script.src = `${src}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
          setTimeout(() => {
            if (typeof GridEditor !== 'undefined') {
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
          if (typeof GridEditor !== 'undefined') {
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
    if (typeof GridEditor === 'undefined') {
      console.error('[Equipamentos] GridEditor não está disponível');
      return;
    }

    gridTab = new GridEditor({
      container: '#equipamentosGrid',
      columns: [
        { field: 'IDEQUIPAMENTO', header: 'ID', editable: false, isId: true, width: '100px' },
        { field: 'REFEQUIPAMENTO', header: 'Referência', editable: true, type: 'text', width: '150px', maxlength: 40 },
        { field: 'DSEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', width: '250px', maxlength: 60 },
        { field: 'TIPO_NOME', header: 'Tipo', editable: false, width: '180px' },
        { field: 'MARCA_NOME', header: 'Marca', editable: false, width: '150px' },
        { field: 'MODELO_NOME', header: 'Modelo', editable: false, width: '150px' },
        { field: 'CLASSE_NOME', header: 'Classe', editable: false, width: '150px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '100px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/equipamentos',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição
      onBeforeEdit: async (id) => {
        await loadEquipamentoParaEdicao(id);
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
        if (lastEquipamentos) {
          const idx = lastEquipamentos.findIndex(r => String(r.IDEQUIPAMENTO) === String(id));
          if (idx !== -1) lastEquipamentos[idx] = { ...lastEquipamentos[idx], ...{} };
        }
      }
    });
  }

  async function loadCombos() {
    if (combosCarregados) return;
    
    try {
      const [grupos, tipos, marcas, classes] = await Promise.all([
        fetch('/api/grupos-combo').then(r => r.json()),
        fetch('/api/tipos-combo').then(r => r.json()),
        fetch('/api/marcas-combo').then(r => r.json()),
        fetch('/api/classes-combo').then(r => r.json())
      ]);

      const fillSelect = (id, items, valueField, labelField) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = id.startsWith('filtro') ? 'Todos' : 'Selecione';
        el.appendChild(defaultOption);
        items.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item[valueField];
          opt.textContent = item[labelField];
          el.appendChild(opt);
        });
      };

      fillSelect('filtroGrupo', grupos, 'CDGRUPOEQUIPAMENTO', 'DSGRUPOEQUIPAMENTO');
      fillSelect('filtroTipo', tipos, 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO');
      fillSelect('filtroMarca', marcas, 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO');
      fillSelect('filtroClasse', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA');
      
      fillSelect('equipGrupo', grupos, 'CDGRUPOEQUIPAMENTO', 'DSGRUPOEQUIPAMENTO');
      fillSelect('equipTipo', tipos, 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO');
      fillSelect('equipMarca', marcas, 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO');
      fillSelect('equipClasse', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA');

      combosCarregados = true;
    } catch (err) {
      console.error('Erro ao carregar combos:', err);
      showMessage('Erro ao carregar opções. Verifique a conexão.', 'error');
    }
  }

  function setupTipoModeloListeners() {
    // Modelos por Marca (no formulário de dados)
    document.getElementById('equipMarca')?.addEventListener('change', function() {
      const marcaId = this.value;
      const modeloSelect = document.getElementById('equipModelo');
      modeloSelect.innerHTML = '<option value="">Selecione uma marca primeiro</option>';
      
      if (!marcaId) return;
      
      fetch(`/api/modelos-por-marca/${marcaId}`)
        .then(res => res.json())
        .then(modelos => {
          modeloSelect.innerHTML = '<option value="">Selecione</option>';
          modelos.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.CDMODELOEQUIPAMENTO;
            opt.textContent = m.DSMODELOEQUIPAMENTO;
            modeloSelect.appendChild(opt);
          });
        })
        .catch(err => {
          console.error('Erro ao carregar modelos por marca:', err);
          modeloSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        });
    });

    // Modelos por Marca (no filtro)
    document.getElementById('filtroMarca')?.addEventListener('change', function() {
      const marcaId = this.value;
      const modeloSelect = document.getElementById('filtroModelo');
      modeloSelect.innerHTML = '<option value="">Todos</option>';
      
      if (!marcaId) return;
      
      fetch(`/api/modelos-por-marca/${marcaId}`)
        .then(res => res.json())
        .then(modelos => {
          modeloSelect.innerHTML = '<option value="">Todos</option>';
          modelos.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.CDMODELOEQUIPAMENTO;
            opt.textContent = m.DSMODELOEQUIPAMENTO;
            modeloSelect.appendChild(opt);
          });
        })
        .catch(err => {
          console.error('Erro ao carregar modelos por marca:', err);
          modeloSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        });
    });
  }

  async function applyFilters(openTab = 'grid') {
    const btnAplicar = filtroForm?.querySelector('button[type="submit"]');
    if (btnAplicar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnAplicar, true);
    }

    try {
      const params = new URLSearchParams();
      const fields = [
        {id: 'filtroRef', param: 'refequipamento'},
        {id: 'filtroGrupo', param: 'cdgrupo'},
        {id: 'filtroTipo', param: 'cdtipo'},
        {id: 'filtroMarca', param: 'cdmarca'},
        {id: 'filtroModelo', param: 'cdmodelo'},
        {id: 'filtroClasse', param: 'cdclasse'},
        {id: 'filtroAtivo', param: 'fgactive'},
        {id: 'filtroTipoAtuacao', param: 'fgtipoatuacao'},
        {id: 'filtroCarroceria', param: 'fgtipocarroceria'},
        {id: 'filtroRastreado', param: 'fgrastreado'}
      ];

      fields.forEach(({id, param}) => {
        const el = document.getElementById(id);
        if (el && el.value) params.append(param, el.value);
      });

      const response = await fetch(`/api/equipamentos?${params.toString()}`);
      const equipamentos = await response.json();
      
      // Armazenar dados em cache
      lastEquipamentos = equipamentos;
      
      // Renderizar lista tradicional
      // Atualizar contador
      const countEl = document.getElementById('equipamentosGridCountText');
      if (countEl) {
        const count = equipamentos.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Renderizar Grid se estiver disponível
      if (openTab === 'grid' && typeof GridEditor !== 'undefined') {
        if (!gridTab) {
          await loadScript('/js/grid-editor.js');
          inicializarGridTab();
        }
        if (gridTab) {
          gridTab.render(equipamentos);
        }
      } else if (openTab === 'grid' && typeof GridEditor === 'undefined') {
        // Se o GridEditor não está carregado, carregar e inicializar
        await loadScript('/js/grid-editor.js');
        inicializarGridTab();
        if (gridTab) {
          gridTab.render(equipamentos);
        }
      }
      
      showTab(openTab);
    } catch (err) {
      console.error('Erro nos filtros:', err);
      showMessage('Erro ao carregar equipamentos.', 'error');
    } finally {
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    }
  }

  // Função segura para converter ID para string
  function getIdString(id) {
    if (id == null) return '';
    const str = id.toString();
    return str.replace(/\.0+$/, '');
  }

  function renderList(equipamentos) {
    if (!equipamentos?.length) {
      list.innerHTML = '<p class="empty">Nenhum equipamento encontrado.</p>';
      return;
    }

    list.innerHTML = equipamentos.map(e => {
      const idStr = getIdString(e.IDEQUIPAMENTO);
      return `
        <div class="list-item ${e.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${idStr}">
          <div>
            <strong>${e.REFEQUIPAMENTO}</strong>
            <small>
              <strong>Descrição:</strong> ${e.DSEQUIPAMENTO || 'Não informado'}<br>
              <strong>Tipo:</strong> ${e.TIPO_NOME || 'Não informado'}<br>
              <strong>Marca:</strong> ${e.MARCA_NOME || 'Não informada'}<br>
              <strong>Modelo:</strong> ${e.MODELO_NOME || 'Não informado'}<br>
              <strong>Classe:</strong> ${e.CLASSE_NOME || 'Não informada'}<br>
              <strong>Status:</strong> ${e.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
            </small>
          </div>
          <div class="actions">
            <button class="btn edit" data-id="${idStr}">Editar</button>
            <button class="btn delete" data-id="${idStr}">Excluir</button>
          </div>
        </div>
      `;
    }).join('');

    // Eventos de edição e exclusão
    document.querySelectorAll('.btn.edit, .btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id || e.currentTarget.getAttribute('data-id') || e.currentTarget.closest('[data-id]')?.dataset?.id || e.currentTarget.closest('[data-id]')?.getAttribute('data-id');
        if (id && id !== 'null' && id !== 'undefined' && id !== '') {
          if (e.currentTarget.classList.contains('edit')) {
            loadEquipamentoParaEdicao(id);
          } else {
            confirmarExclusao(id);
          }
        } else {
          console.error('ID inválido:', id);
          showMessage('Erro: ID não disponível.', 'error');
        }
      });
    });
  }

  async function loadEquipamentoParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      // Isso evita que dados de um equipamento apareçam em outro
      const equipamentoForm = document.getElementById('equipamentoForm');
      if (equipamentoForm) {
        equipamentoForm.reset();
      }
      
      const response = await fetch(`/api/equipamentos`);
      const equipamentos = await response.json();
      // Normalizar ID para comparação (pode vir como string ou número)
      const idNormalizado = String(id).trim();
      const equip = equipamentos.find(e => {
        const equipId = getIdString(e.IDEQUIPAMENTO);
        return String(equipId) === idNormalizado || String(e.IDEQUIPAMENTO) === idNormalizado;
      });
      
      if (equip) {
        safeSet('equipamentoId', id);
        safeSet('equipId', id);
        safeSet('equipRef', equip.REFEQUIPAMENTO);
        safeSet('equipNome', equip.DSEQUIPAMENTO || '');
        safeSet('equipGrupo', equip.CDGRUPOEQUIPAMENTO || '');
        safeSet('equipTipo', equip.CDTIPOEQUIPAMENTO || '');
        safeSet('equipMarca', equip.CDMARCAEQUIPAMENTO || '');
        safeSet('equipClasse', equip.CDCLASSEFROTA || '');
        safeSet('equipTipoAtuacao', equip.FGTIPOATUACAO || '');
        safeSet('equipCarroceria', equip.FGTIPOCARROCERIA || '');
        safeSet('equipAtivo', equip.FGACTIVE || 'S');
        safeSet('equipAno', equip.ANOFABRICA || '');
        safeSet('equipEixos', equip.NREIXOS || '');
        safeSet('equipCapacidade', equip.CAPACIDCARGA || '');
        safeSet('equipAltura', equip.ALTURA || '');
        safeSet('equipLargura', equip.LARGURA || '');
        safeSet('equipComprimento', equip.COMPRIMENTO || '');
        safeSet('equipCubico', equip.MTCUBICO || '');
        // Preencher FGRASTREADO - campo simples S/N
        const rastreadoSelect = document.getElementById('equipRastreado');
        if (rastreadoSelect && equip.FGRASTREADO) {
          rastreadoSelect.value = String(equip.FGRASTREADO).trim().toUpperCase();
        } else if (rastreadoSelect) {
          rastreadoSelect.value = '';
        }
        
        const title = document.getElementById('formTitle');
        if (title) title.textContent = 'Editar Equipamento';
        showTab('dados');
        
        // Carregar modelos com base na MARCA (não no tipo)
        if (equip.CDMARCAEQUIPAMENTO) {
          const responseModelos = await fetch(`/api/modelos-por-marca/${equip.CDMARCAEQUIPAMENTO}`);
          const modelos = await responseModelos.json();
          const modeloSelect = document.getElementById('equipModelo');
          if (modeloSelect) {
            modeloSelect.innerHTML = '<option value="">Selecione</option>';
            modelos.forEach(m => {
              const opt = document.createElement('option');
              opt.value = m.CDMODELOEQUIPAMENTO;
              opt.textContent = m.DSMODELOEQUIPAMENTO;
              modeloSelect.appendChild(opt);
            });
            // Define o valor do modelo APÓS carregar as opções
            setTimeout(() => {
              modeloSelect.value = equip.CDMODELOEQUIPAMENTO || '';
            }, 100);
          }
        }
      } else {
        console.error('❌ Equipamento não encontrado com ID:', id);
        showMessage('Equipamento não encontrado para edição.', 'error');
      }
    } catch (err) {
      console.error('Erro ao carregar equipamento:', err);
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  async function confirmarExclusao(id) {
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage('Erro: ID não disponível.', 'error');
      return;
    }
    
    idValido = String(idValido).trim();
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (!modalMessage || !confirmYes || !confirmNo || !modalEl) {
      return;
    }

    try {
      // Buscar o status atual do equipamento
      const idToCheck = isNaN(idValido) ? idValido : parseFloat(idValido);
      const response = await fetch(`/api/equipamentos/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar equipamento');
      }
      
      const equipamento = await response.json();
      const estaAtivo = equipamento.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> este equipamento?<br><br><small style="color: #666;">O equipamento ficará inativo e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> este equipamento?<br><br><small style="color: #666;">O equipamento voltará a aparecer nas listagens e estará disponível para uso.</small>';
        action = 'activate';
        btnText = 'Reativar';
      }
      
      modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idValido;
      modalEl.dataset.action = action;
      
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      // Atualizar texto do botão de confirmação
      newConfirmYes.textContent = btnText;
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        const idParaExcluir = modalEl.dataset.deleteId || idValido;
        const acao = modalEl.dataset.action || action;
        
        if (!idParaExcluir || idParaExcluir === 'undefined' || idParaExcluir === 'null' || idParaExcluir === '') {
          showMessage('Erro: ID não disponível.', 'error');
          modalEl.style.display = 'none';
          return;
        }
        
        try {
          const idToDelete = isNaN(idParaExcluir) ? idParaExcluir : parseFloat(idParaExcluir);
          const response = await fetch(`/api/equipamentos/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Equipamento reativado com sucesso!' : 'Equipamento desativado com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do equipamento.', 'error');
          }
        } catch (err) {
          console.error('[Equipamentos] Erro ao alterar status:', err);
          showMessage('Erro de conexão.', 'error');
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
      console.error('[Equipamentos] Erro ao buscar status do equipamento:', err);
      showMessage('Erro ao verificar status do equipamento.', 'error');
    }
  }

  function safeSet(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function safeGet(id, required = false) {
    const el = document.getElementById(id);
    if (!el) {
      if (required) {
        console.error(`Elemento obrigatório #${id} não encontrado!`);
        return null;
      }
      return null;
    }
    return el.value?.trim() || null;
  }

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

  loadCombos();
  setupTipoModeloListeners();

  // Eventos de abas
  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
    });
  });

  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  // Salvar formulário
  equipamentoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btnSalvar = equipamentoForm.querySelector('button[type="submit"]');
    if (btnSalvar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnSalvar, true);
    }
    
    const ref = safeGet('equipRef', true);
    const tipo = safeGet('equipTipo', true);
    const marca = safeGet('equipMarca', true);
    const tipoAtuacao = safeGet('equipTipoAtuacao', true);
    const carroceria = safeGet('equipCarroceria', true);
    const ativo = safeGet('equipAtivo', true);
    
    const rastreado = safeGet('equipRastreado', true);
    
    if (!ref || !tipo || !marca || !tipoAtuacao || !carroceria || !ativo || !rastreado) {
      if (!document.querySelector('.message.show')) {
        showMessage('Preencha todos os campos obrigatórios.', 'error');
      }
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }

    try {
      const equipamentoData = {
        REFEQUIPAMENTO: ref,
        DSEQUIPAMENTO: safeGet('equipNome'),
        CDGRUPOEQUIPAMENTO: safeGet('equipGrupo') || null,
        CDTIPOEQUIPAMENTO: tipo,
        CDMARCAEQUIPAMENTO: marca,
        CDMODELOEQUIPAMENTO: safeGet('equipModelo') || null,
        CDCLASSEFROTA: safeGet('equipClasse') || null,
        FGTIPOATUACAO: tipoAtuacao,
        FGTIPOCARROCERIA: carroceria,
        NREIXOS: safeGet('equipEixos') ? parseInt(safeGet('equipEixos')) : null,
        CAPACIDCARGA: safeGet('equipCapacidade') ? parseFloat(safeGet('equipCapacidade')) : null,
        ANOFABRICA: safeGet('equipAno') ? parseInt(safeGet('equipAno')) : null,
        ALTURA: safeGet('equipAltura') ? parseFloat(safeGet('equipAltura')) : null,
        LARGURA: safeGet('equipLargura') ? parseFloat(safeGet('equipLargura')) : null,
        COMPRIMENTO: safeGet('equipComprimento') ? parseFloat(safeGet('equipComprimento')) : null,
        MTCUBICO: safeGet('equipCubico') ? parseFloat(safeGet('equipCubico')) : null,
        FGACTIVE: ativo,
        FGRASTREADO: rastreado
      };

      const id = safeGet('equipamentoId');
      let response;
      if (id) {
        response = await fetch(`/api/equipamentos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(equipamentoData)
        });
      } else {
        response = await fetch('/api/equipamentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(equipamentoData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || 'Salvo com sucesso!', 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage('Erro de conexão com o servidor.', 'error');
    } finally {
      // Sempre reabilitar o botão após o submit (sucesso ou erro)
      const btnSalvar = equipamentoForm.querySelector('button[type="submit"]');
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
    }
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.querySelectorAll('#filtroForm select').forEach(el => el.value = '');
    const ref = document.getElementById('filtroRef');
    if (ref) ref.value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoEquipamento')?.addEventListener('click', () => {
    if (equipamentoForm) equipamentoForm.reset();
    const title = document.getElementById('formTitle');
    if (title) title.textContent = 'Novo Equipamento';
    showTab('dados');
  });
  document.getElementById('btnCancelarDados')?.addEventListener('click', () => showTab('grid'));
  
  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoEquipamentoGrid')?.addEventListener('click', () => {
    if (equipamentoForm) equipamentoForm.reset();
    const title = document.getElementById('formTitle');
    if (title) title.textContent = 'Novo Equipamento';
    showTab('dados');
  });
})();