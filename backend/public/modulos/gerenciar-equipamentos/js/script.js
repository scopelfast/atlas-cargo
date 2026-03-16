// backend/public/modulos/gerenciar-equipamentos/js/script.js
(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
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
  let contextEquipamentos = { pais: 'BR' };

  async function loadContextoEquipamentos() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      contextEquipamentos = d;
      updateLabelPlaca();
    } catch (e) {
      console.warn('[Equipamentos] Erro ao carregar contexto:', e);
    }
  }
  function updateLabelPlaca() {
    const pais = (contextEquipamentos && contextEquipamentos.pais) || 'BR';
    const labelTexto = pais === 'BR' ? 'Placa' : (pais === 'PY' || pais === 'AR' || pais === 'UY' ? 'Matrícula' : 'Referência');
    const labelFiltro = document.getElementById('labelFiltroRef');
    const labelForm = document.getElementById('labelEquipRef');
    const placeholder = pais === 'BR' ? 'Digite a placa...' : (pais === 'PY' || pais === 'AR' || pais === 'UY' ? 'Digite la matrícula...' : 'Referência');
    if (labelFiltro) labelFiltro.textContent = labelTexto;
    if (labelForm) labelForm.textContent = labelTexto + ' *';
    const inputRef = document.getElementById('equipRef');
    if (inputRef) inputRef.placeholder = placeholder;
    const filtroRef = document.getElementById('filtroRef');
    if (filtroRef) filtroRef.placeholder = placeholder;
  }

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-equipamentos/sql/init.sql', '/api/equipamentos/executar-init-sql', 'equipamentos');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-equipamentos/sql/init.sql', '/api/equipamentos/executar-init-sql', 'equipamentos');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Equipamentos] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
  }

  // Função de inicialização
  async function init() {
    // Se já foi executado, não executar novamente
    if (initExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    initExecutado = true;
    
    // Contexto (país) para label Placa/Matrícula (Fase 4 multimoeda)
    loadContextoEquipamentos();
    
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Garantir que a aba de filtros está ativa e visível PRIMEIRO
    await showTab('filtros');
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) em background
    // NÃO bloquear a interface - executar de forma assíncrona
    executarInitSQL().catch(err => {
      console.error('[Equipamentos] Erro ao executar init.sql:', err.message || err);
    });
  }

  // Carregar estatísticas iniciais

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM já está pronto, executar imediatamente
    init();
  }

  // Função para mudar abas (escopo no container do módulo para não misturar Grid/Dados)
  async function showTab(tabId) {
    try {
      const targetContent = document.getElementById(`tab-${tabId}`);
      const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      if (targetContent && targetBtn) {
        const container = targetContent.closest('[class*="-container"]') || targetContent.parentElement;
        if (container) {
          container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        }
        targetBtn.classList.add('active');
        targetContent.classList.add('active');
      }
      
      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Se for a aba de grid, inicializar o GridEditor
      if (tabId === 'grid') {
        try {
          // Aguardar um pouco para garantir que GridEditor está disponível (caso ainda esteja carregando)
          let tentativas = 0;
          while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            tentativas++;
          }

          if (typeof window.GridEditor === 'undefined') {
            console.error('[Equipamentos] GridEditor não está disponível após aguardar');
            try { await loadScript('/js/grid-editor.js'); } catch (e) {
              console.error('[Equipamentos] Erro ao carregar GridEditor:', e);
            }
          }

          if (!gridTab && typeof window.GridEditor !== 'undefined') {
            inicializarGridTab();
          }
          
          // Sempre renderizar, mesmo se não houver dados (grid vazio)
          const equipamentosParaRenderizar = lastEquipamentos || [];
          if (gridTab) {
            gridTab.render(equipamentosParaRenderizar);
          }
          // NÃO aplicar filtros automaticamente - usuário deve aplicar manualmente
        } catch (gridErr) {
          console.warn('[Equipamentos] Erro ao processar grid:', gridErr);
          // Continuar mesmo se houver erro - não bloquear mudança de aba
        }
      }
    } catch (err) {
      console.warn('[Equipamentos] Erro ao mudar aba:', err);
      // Forçar mudança de aba mesmo em caso de erro
      try {
        const targetContent = document.getElementById(`tab-${tabId}`);
        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (targetContent && targetBtn) {
          const container = targetContent.closest('[class*="-container"]') || targetContent.parentElement;
          if (container) {
            container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          }
          targetBtn.classList.add('active');
          targetContent.classList.add('active');
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
      // GridEditor já é carregado globalmente pelo dashboard.js
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        // Usar corrigirUrl se disponível para garantir o caminho base correto
        const srcCorrigido = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl(src) : src;
        script.src = `${srcCorrigido}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
          setTimeout(() => {
            if (typeof window.GridEditor !== 'undefined') {
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
          if (typeof window.GridEditor !== 'undefined') {
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
    // GridEditor já é carregado globalmente pelo dashboard.js
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Equipamentos] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#equipamentosGrid',
      columns: [
        { field: 'IDEQUIPAMENTO', header: 'ID', editable: false, isId: true, width: '120px' },
        { field: 'REFEQUIPAMENTO', header: 'Referência', editable: true, type: 'text', width: '180px', maxlength: 40 },
        { field: 'TIPO_NOME', header: 'Tipo', editable: false, width: '200px' },
        { field: 'CLASSE_NOME', header: 'Classe', editable: false, width: '180px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px',
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
        showMessage(t('web.modulos.equipamentos.sucessoSalvar'), 'success');
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
      showMessage(t('web.modulos.equipamentos.erroCarregarOpcoes'), 'error');
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
        {id: 'filtroIdEquipamento', param: 'idequipamento'},
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
      
      // Atualizar estatísticas com os equipamentos filtrados
      
      // Renderizar lista tradicional
      // Atualizar contador
      const countEl = document.getElementById('equipamentosGridCountText');
      if (countEl) {
        const count = equipamentos.length || 0;
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(count));
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(equipamentos);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(equipamentos) && equipamentos.length > 0) {
          // Aguardar GridEditor estar disponível
          let tentativas = 0;
          while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            tentativas++;
          }

          if (typeof window.GridEditor === 'undefined') {
            console.error('[Equipamentos] GridEditor não está disponível após aguardar');
            try { await loadScript('/js/grid-editor.js'); } catch (loadErr) {
              console.error('[Equipamentos] Erro ao carregar GridEditor:', loadErr);
            }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            if (gridTab) {
              try {
                gridTab.render(equipamentos);
              } catch (e) {
                console.error('[Equipamentos] Erro ao renderizar grid:', e);
              }
            }
          }
        }
      } catch (autoErr) {
        console.error('[Equipamentos] Erro no fluxo de auto-init:', autoErr);
      }

      // Se o chamador pediu para abrir a aba grid, inicializar e renderizar lá
      if (openTab === 'grid') {
        // Aguardar GridEditor estar disponível
        let tentativas = 0;
        while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          tentativas++;
        }

        if (typeof window.GridEditor === 'undefined') {
          console.error('[Equipamentos] GridEditor não está disponível após aguardar');
          try { await loadScript('/js/grid-editor.js'); } catch (e) {
            console.error('[Equipamentos] Erro ao carregar GridEditor:', e);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          if (gridTab) {
            try { 
              gridTab.render(equipamentos); 
            } catch (err) { 
              console.error('[Equipamentos] Erro ao renderizar grid:', err); 
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro nos filtros:', err);
      showMessage(t('web.modulos.equipamentos.erroCarregarEquipamentos'), 'error');
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
          showMessage(t('web.modulos.equipamentos.erroIdIndisponivel'), 'error');
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
      
      // Atualizar estatísticas
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
        if (title) title.textContent = t('web.modulos.equipamentos.editarEquipamento');
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
        showMessage(t('web.modulos.equipamentos.equipamentoNaoEncontrado'), 'error');
      }
    } catch (err) {
      console.error('Erro ao carregar equipamento:', err);
      showMessage(t('web.modulos.equipamentos.erroCarregarDados'), 'error');
    }
  }

  async function confirmarExclusao(id) {
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage(t('web.modulos.equipamentos.erroIdIndisponivel'), 'error');
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
        confirmMsg = t('web.modulos.equipamentos.msgDesativar');
        action = 'deactivate';
        btnText = t('web.modulos.equipamentos.desativar');
      } else {
        confirmMsg = t('web.modulos.equipamentos.msgReativar');
        action = 'activate';
        btnText = t('web.modulos.equipamentos.reativar');
      }
      
      modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idValido;
      modalEl.dataset.action = action;
      
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      newConfirmYes.className = 'btn-filtro btn-filtro-danger';
      newConfirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
      newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
      newConfirmNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.equipamentos.cancelar') || 'Cancelar');
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        const idParaExcluir = modalEl.dataset.deleteId || idValido;
        const acao = modalEl.dataset.action || action;
        
        if (!idParaExcluir || idParaExcluir === 'undefined' || idParaExcluir === 'null' || idParaExcluir === '') {
          showMessage(t('web.modulos.equipamentos.erroIdIndisponivel'), 'error');
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
            showMessage(data.message || (acao === 'activate' ? t('web.modulos.equipamentos.sucessoReativar') : t('web.modulos.equipamentos.sucessoDesativar')), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.equipamentos.erroAlterarStatus'), 'error');
          }
        } catch (err) {
          console.error('[Equipamentos] Erro ao alterar status:', err);
          showMessage(t('web.modulos.equipamentos.erroConexao'), 'error');
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
      showMessage(t('web.modulos.equipamentos.erroVerificarStatus'), 'error');
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
      
      // Lógica especial para aba Validades
      if (tabId === 'validades') {
        const equipId = document.getElementById('equipamentoId')?.value || document.getElementById('equipamentoCodigo')?.value;
        if (!equipId) {
          showMessage(t('web.modulos.equipamentos.selecioneEquipamento'), 'error');
          return;
        }
        await showTab('validades');
        setTimeout(() => { inicializarAbaValidades(); }, 100);
      } else {
        await showTab(tabId);
      }
    });
  });

  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  let equipamentoFormSubmitting = false;
  equipamentoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (equipamentoFormSubmitting) return;
    equipamentoFormSubmitting = true;
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
        showMessage(t('web.modulos.equipamentos.preenchaCampos'), 'error');
      }
      equipamentoFormSubmitting = false;
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
        showMessage(data.message || t('web.modulos.equipamentos.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.equipamentos.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.equipamentos.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        equipamentoFormSubmitting = false;
        const btnSalvar = equipamentoForm.querySelector('button[type="submit"]');
        if (btnSalvar && typeof window.showLoading !== 'undefined') {
          window.showLoading(btnSalvar, false);
        }
      }, 600);
    }
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.querySelectorAll('#filtroForm select').forEach(el => el.value = '');
    const idEquipamento = document.getElementById('filtroIdEquipamento');
    if (idEquipamento) idEquipamento.value = '';
    const ref = document.getElementById('filtroRef');
    if (ref) ref.value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));

  function irParaNovoEquipamento() {
    if (equipamentoForm) equipamentoForm.reset();
    const idEquip = document.getElementById('equipamentoId');
    const equipId = document.getElementById('equipId');
    if (idEquip) idEquip.value = '';
    if (equipId) equipId.value = '';
    const title = document.getElementById('formTitle');
    if (title) title.textContent = t('web.modulos.equipamentos.novoEquipamento');
    showTab('dados');
  }

  document.getElementById('btnNovoEquipamento')?.addEventListener('click', irParaNovoEquipamento);
  document.getElementById('btnCancelarDados')?.addEventListener('click', () => showTab('grid'));
  
  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoEquipamentoGrid')?.addEventListener('click', irParaNovoEquipamento);

  // Exportar para Excel
  document.getElementById('btnExportarExcel')?.addEventListener('click', async () => {
    try {
      // Mostrar mensagem de carregamento
      if (typeof window.showMessage !== 'undefined') {
        window.showMessage('Gerando arquivo Excel...', 'info');
      }
      
      // Coletar os mesmos filtros aplicados
      const params = new URLSearchParams();
      const fields = [
        {id: 'filtroIdEquipamento', param: 'idequipamento'},
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
      
      // Fazer requisição para exportar
      const response = await fetch(`/api/equipamentos/exportar-excel?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Erro ao gerar arquivo Excel');
      }
      
      // Obter o blob do arquivo
      const blob = await response.blob();
      
      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `equipamentos-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      if (typeof window.showMessage !== 'undefined') {
        window.showMessage('Arquivo Excel gerado com sucesso!', 'success');
      }
    } catch (err) {
      console.error('Erro ao exportar para Excel:', err);
      if (typeof window.showMessage !== 'undefined') {
        window.showMessage('Erro ao exportar para Excel. Tente novamente.', 'error');
      }
    }
  });

  // =======================
  // ABA VALIDADES
  // =======================
  let validadesCarregadas = false;
  let cadastroAtualValidades = null;
  
  async function inicializarAbaValidades() {
    const btnVoltar = document.getElementById('btnVoltarDadosValidades');
    const btnNova = document.getElementById('btnNovaValidade');
    const btnCancelar = document.getElementById('btnCancelarValidade');
    const btnFechar = document.getElementById('btnFecharModalValidade');
    const formValidade = document.getElementById('formValidade');
    
    if (btnVoltar && !btnVoltar.dataset.listenerAdded) {
      btnVoltar.dataset.listenerAdded = 'true';
      btnVoltar.addEventListener('click', () => showTab('dados'));
    }
    
    if (btnNova && !btnNova.dataset.listenerAdded) {
      btnNova.dataset.listenerAdded = 'true';
      btnNova.addEventListener('click', abrirModalNovaValidade);
    }
    
    if (btnCancelar && !btnCancelar.dataset.listenerAdded) {
      btnCancelar.dataset.listenerAdded = 'true';
      btnCancelar.addEventListener('click', () => {
        document.getElementById('modalValidade').style.display = 'none';
      });
    }
    
    if (btnFechar && !btnFechar.dataset.listenerAdded) {
      btnFechar.dataset.listenerAdded = 'true';
      btnFechar.addEventListener('click', () => {
        document.getElementById('modalValidade').style.display = 'none';
      });
    }
    
    if (formValidade && !formValidade.dataset.listenerAdded) {
      formValidade.dataset.listenerAdded = 'true';
      formValidade.addEventListener('submit', salvarValidade);
    }
    
    const cdCadastro = document.getElementById('equipamentoId')?.value || document.getElementById('equipamentoCodigo')?.value;
    
    if (cdCadastro) {
      await carregarValidadesCadastro('EQP', cdCadastro);
    }
  }
  
  async function carregarValidadesCadastro(tpCadastro, cdCadastro) {
    try {
      const placa = document.getElementById('equipRef')?.value || '';
      const descricao = document.getElementById('equipNome')?.value || '';
      const nomeEquip = placa ? `${placa}${descricao ? ' - ' + descricao : ''}` : (descricao || 'Equipamento');
      document.getElementById('validadesNomeCadastro').textContent = nomeEquip;
      document.getElementById('validadesCodigoCadastro').textContent = cdCadastro;
      const elTipo = document.getElementById('validadesTipoCadastro');
      if (elTipo) elTipo.textContent = 'Equipamento';
      document.getElementById('validadesCadastroInfo').style.display = 'block';
      
      const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}`);
      const validades = await response.json();
      
      cadastroAtualValidades = { tpCadastro, cdCadastro };
      
      const countText = document.getElementById('validadesCountText');
      if (countText) {
        countText.textContent = `${validades.length} validade(s) encontrada(s)`;
        document.getElementById('validadesCount').style.display = 'block';
      }
      
      renderizarValidadesGrid(validades);
      await carregarCombosTiposValidade(tpCadastro);
      await carregarCombosCertificadoras();
      
      validadesCarregadas = true;
    } catch (err) {
      console.error('Erro ao carregar validades:', err);
      showMessage('Erro ao carregar validades', 'error');
    }
  }
  
  function renderizarValidadesGrid(validades) {
    const grid = document.getElementById('validadesGrid');
    if (!grid) return;
    
    if (!validades || validades.length === 0) {
      grid.innerHTML = '<p class="empty">Nenhuma validade cadastrada para este equipamento.</p>';
      return;
    }
    
    let html = '<div style="display: grid; gap: 12px;">';
    
    const loc = (contextEquipamentos && contextEquipamentos.locale) || 'pt-BR';
    const tz = (contextEquipamentos && contextEquipamentos.timezone) || 'America/Sao_Paulo';
    const fmtData = (d) => {
      if (!d) return '-';
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return '-';
      try {
        return new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: 'short' }).format(date);
      } catch (e) { return date.toLocaleDateString(loc); }
    };
    validades.forEach(val => {
      const dtLib = fmtData(val.DTLIBERACAO);
      const dtVal = fmtData(val.DTVALIDADE);
      const dias = val.DIAS_RESTANTES;
      const removida = !!(val.REMOVIDA || val.DTREMOVIDA);
      const dtRemovida = removida ? fmtData(val.DTREMOVIDA) : '';
      const userRemovido = val.SGUSER_REMOVIDO || '—';
      
      let corStatus = '#27ae60';
      let textoStatus = `Válida (${dias} dias)`;
      let statusTipo = 'valida';
      
      if (val.STATUS_VALIDADE === 'VENCIDA') {
        corStatus = '#e74c3c';
        textoStatus = `VENCIDA (${Math.abs(dias)} dias atrás)`;
        statusTipo = 'vencida';
      } else if (val.STATUS_VALIDADE === 'VENCENDO') {
        corStatus = '#f39c12';
        textoStatus = `Vencendo (${dias} dias)`;
        statusTipo = 'vencendo';
      }
      
      const cardBg = removida ? '#f8f9fa' : '#fff';
      const cardBorder = removida ? '#dee2e6' : '#e9ecef';
      
      html += `
        <div class="validade-card" style="background: ${cardBg}; border: 1px solid ${cardBorder}; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px; ${removida ? 'opacity: 0.92;' : ''}">
          <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
          <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div class="validade-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
                <div style="flex: 1; min-width: 200px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px;">
                    <span class="validade-status-badge" data-status="${statusTipo}" style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
                <div class="validade-card-actions" style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                  <button onclick="window.editarValidade('${val.SEQUENCIA}')" class="btn btn-primary btn-sm">
                    <i class='bx bx-show'></i> Ver Dados
                  </button>
                  ${!removida ? `
                  <button onclick="window.excluirValidade('${val.SEQUENCIA}')" class="btn btn-secondary btn-sm" style="background: #e74c3c;">
                    <i class='bx bx-trash'></i> Remover
                  </button>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
              </div>
              ${val.SGUSER_LIBERACAO ? `
              <div style="display: flex; align-items: center; gap: 6px; color: #6c757d;">
                <i class='bx bx-user-check' style="font-size: 14px;"></i>
                <span style="font-weight: 500;">Liberado por <strong>${val.SGUSER_LIBERACAO}</strong></span>
              </div>
              ` : ''}
              <div style="display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
              </div>
              ${removida && (dtRemovida || userRemovido !== '—') ? `
              <div style="display: flex; align-items: center; gap: 6px; color: #6c757d;">
                <i class='bx bx-user-x' style="font-size: 14px;"></i>
                <span style="font-weight: 500;">Removida em ${dtRemovida || '—'} por <strong>${userRemovido}</strong></span>
              </div>
              ` : ''}
              ${val.DSLIBERACAO ? `
              <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px;">
                <i class='bx bx-note' style="color: #6c757d; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Obs:</span>
                <strong style="color: #495057; margin-left: 4px;">${val.DSLIBERACAO}</strong>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    grid.innerHTML = html;
  }
  
  async function carregarCombosTiposValidade(tpCadastro) {
    try {
      const response = await fetch(`/api/validades/tipos-combo/${tpCadastro}`);
      if (!response.ok) return;
      const tipos = await response.json();
      const select = document.getElementById('validadeTipo');
      if (select && Array.isArray(tipos)) {
        select.innerHTML = '<option value="">Selecione...</option>';
        tipos.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.CDTIPOVALIDADE;
          opt.textContent = t.DSTIPOVALIDADE;
          select.appendChild(opt);
        });
      }
    } catch (err) {}
  }
  
  async function carregarCombosCertificadoras() {
    try {
      const response = await fetch('/api/validades/certificadoras-combo');
      if (!response.ok) return;
      const certs = await response.json();
    } catch (err) {}
  }
  
  function abrirModalNovaValidade() {
    const placa = document.getElementById('equipRef')?.value || '';
    const descricao = document.getElementById('equipNome')?.value || '';
    const nomeEquip = placa ? `${placa}${descricao ? ' - ' + descricao : ''}` : (descricao || 'Equipamento');
    document.getElementById('modalValidadeTitulo').innerHTML = '<i class=\'bx bx-file-blank\'></i> Nova Validade';
    document.getElementById('modalValidadeSubtitulo').textContent = `Cadastrando validade para: ${nomeEquip}`;
    document.getElementById('formValidade').reset();
    document.getElementById('validadeSequencia').value = '';
    document.getElementById('validadeCertificadora').value = '';
    document.getElementById('certCpfCnpj').value = '';
    document.getElementById('certCodigo').value = '';
    document.getElementById('certNome').value = '';
    const certResultado = document.getElementById('certResultado');
    certResultado.className = '';
    certResultado.innerHTML = '<i class=\'bx bx-info-circle\'></i><span id="certTexto">Nenhuma certificadora selecionada</span>';
    document.getElementById('modalValidade').style.display = 'flex';
  }
  
  window.editarValidade = async function(sequencia) {
    if (!cadastroAtualValidades) return;
    try {
      const { tpCadastro, cdCadastro } = cadastroAtualValidades;
      await carregarCombosTiposValidade(tpCadastro);
      await carregarCombosCertificadoras();
      await new Promise(resolve => setTimeout(resolve, 100));
      const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}`);
      const validades = await response.json();
      const val = validades.find(v => v.SEQUENCIA == sequencia);
      if (val) {
        const placa = document.getElementById('equipRef')?.value || '';
        const nomeEquip = placa || document.getElementById('equipNome')?.value || 'Equipamento';
        document.getElementById('modalValidadeTitulo').innerHTML = '<i class=\'bx bx-edit\'></i> Editar Validade';
        document.getElementById('modalValidadeSubtitulo').textContent = `${val.DSTIPOVALIDADE} • ${nomeEquip}`;
        document.getElementById('validadeSequencia').value = val.SEQUENCIA;
        document.getElementById('validadeTipo').value = val.CDTIPOVALIDADE;
        document.getElementById('validadeNrLiberacao').value = val.NRLIBERACAO;
        document.getElementById('validadeDtLiberacao').value = new Date(val.DTLIBERACAO).toISOString().split('T')[0];
        document.getElementById('validadeDtValidade').value = new Date(val.DTVALIDADE).toISOString().split('T')[0];
        document.getElementById('validadeDsLiberacao').value = val.DSLIBERACAO || '';
        
        const certResultado = document.getElementById('certResultado');
        if (val.CDCERTIFICADORA && val.CERTIFICADORA_NOME) {
          document.getElementById('validadeCertificadora').value = val.CDCERTIFICADORA;
          certResultado.className = 'certificadora-selecionada';
          certResultado.innerHTML = '<i class=\'bx bx-check-circle\'></i><span id="certTexto"><strong>✓ ' + val.CERTIFICADORA_NOME + '</strong> (Código: ' + val.CDCERTIFICADORA + ')</span>';
        } else if (val.CDCERTIFICADORA) {
          document.getElementById('validadeCertificadora').value = val.CDCERTIFICADORA;
          certResultado.className = 'certificadora-aviso';
          certResultado.innerHTML = '<i class=\'bx bx-error-circle\'></i><span id="certTexto"><strong>⚠ Certificadora código ' + val.CDCERTIFICADORA + '</strong></span>';
        } else {
          document.getElementById('validadeCertificadora').value = '';
          certResultado.className = '';
          certResultado.innerHTML = '<i class=\'bx bx-info-circle\'></i><span id="certTexto">Nenhuma certificadora selecionada</span>';
        }
        document.getElementById('modalValidade').style.display = 'flex';
      }
    } catch (err) {}
  };
  
  window.excluirValidade = function(sequencia) {
    const modalEl = document.getElementById('confirmModal');
    const modalMsg = document.getElementById('modalMessage');
    modalMsg.textContent = 'Deseja excluir esta validade?';
    modalEl.style.display = 'block';
    const btnYes = document.getElementById('confirmYes');
    const newYes = btnYes.cloneNode(true);
    btnYes.parentNode.replaceChild(newYes, btnYes);
    newYes.onclick = async () => {
      try {
        const { tpCadastro, cdCadastro } = cadastroAtualValidades;
        const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}/${sequencia}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok) {
          showMessage('Validade excluída!', 'success');
          await carregarValidadesCadastro(tpCadastro, cdCadastro);
        } else {
          showMessage(data.error || 'Erro', 'error');
        }
      } catch (err) {}
      finally { modalEl.style.display = 'none'; }
    };
  };
  
  window.buscarCertPorCpf = async function() {
    const cpf = document.getElementById('certCpfCnpj').value.replace(/\D/g, '');
    if (!cpf) return;
    await buscarCertificadora('cgccpf', cpf);
  };
  
  window.buscarCertPorCodigo = async function() {
    const codigo = document.getElementById('certCodigo').value;
    if (!codigo) return;
    await buscarCertificadora('codigo', codigo);
  };
  
  window.buscarCertPorNome = async function() {
    const nome = document.getElementById('certNome').value.trim();
    if (!nome || nome.length < 3) return;
    await buscarCertificadora('razaoSocial', nome);
  };
  
  async function buscarCertificadora(tipo, valor) {
    try {
      const params = new URLSearchParams();
      params.append(tipo, valor);
      params.append('situacao', 'S');
      params.append('tipoCadastro', 'C'); // Somente certificadoras (FGTIPOCADASTRO = C) – mesma validação do cadastro geral
      const response = await fetch(`/api/cadastros-gerais?${params.toString()}`);
      const cadastros = await response.json();
      const certResultado = document.getElementById('certResultado');
      if (cadastros && cadastros.length > 0) {
        const cert = cadastros[0];
        document.getElementById('validadeCertificadora').value = cert.CDCADASTRO;
        certResultado.className = 'certificadora-selecionada';
        certResultado.innerHTML = '<i class=\'bx bx-check-circle\'></i><span id="certTexto"><strong>✓ ' + cert.RZSOCIAL + '</strong> (Código: ' + cert.CDCADASTRO + ')</span>';
        showMessage('Certificadora encontrada!', 'success');
      } else {
        certResultado.className = 'certificadora-erro';
        certResultado.innerHTML = '<i class=\'bx bx-x-circle\'></i><span id="certTexto"><strong>✗ Nenhuma certificadora encontrada</strong></span>';
        showMessage('Certificadora não encontrada', 'error');
      }
    } catch (err) {}
  }
  
  async function salvarValidade(e) {
    e.preventDefault();
    if (!cadastroAtualValidades) return;
    try {
      const { tpCadastro, cdCadastro } = cadastroAtualValidades;
      const sequencia = document.getElementById('validadeSequencia').value;
      const dados = {
        CDTIPOVALIDADE: document.getElementById('validadeTipo').value,
        NRLIBERACAO: document.getElementById('validadeNrLiberacao').value,
        DTLIBERACAO: document.getElementById('validadeDtLiberacao').value,
        DTVALIDADE: document.getElementById('validadeDtValidade').value,
        CDCERTIFICADORA: document.getElementById('validadeCertificadora').value || null,
        DSLIBERACAO: document.getElementById('validadeDsLiberacao').value
      };
      const url = sequencia ? `/api/validades/${tpCadastro}/${cdCadastro}/${sequencia}` : `/api/validades/${tpCadastro}/${cdCadastro}`;
      const method = sequencia ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || 'Salvo!', 'success');
        document.getElementById('modalValidade').style.display = 'none';
        await carregarValidadesCadastro(tpCadastro, cdCadastro);
      } else {
        showMessage(data.error || 'Erro', 'error');
      }
    } catch (err) {
      showMessage('Erro ao salvar', 'error');
    }
  }

  // Função para mostrar ajuda
  // Função de ajuda
  window.mostrarAjudaEquipamentos = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaEquipamentos');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaEquipamentos';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Equipamentos</h3>
          <button onclick="window.fecharModalAjudaEquipamentos()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Equipamentos</strong> permite gerenciar todos os equipamentos (veículos) cadastrados no sistema, incluindo informações técnicas, validades, certificações e tipos de atuação.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar equipamentos específicos por ID, placa, tipo, classe de frota, carroceria, tipo de atuação, rastreamento e situação.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar equipamentos por diversos critérios</li>
            <li><strong>Grid:</strong> Visualizar todos os equipamentos em formato de tabela editável com ordenação e filtros</li>
            <li><strong>Dados:</strong> Criar ou editar equipamentos, definindo tipo, marca, modelo, placa, classe de frota e outras informações</li>
            <li><strong>Validades:</strong> Gerenciar validades e certificações dos equipamentos (documentos, licenças, etc.)</li>
          </ul>
          
          <h4>🚛 Tipos de Atuação</h4>
          <ul>
            <li><strong>A - Agregado:</strong> Equipamento agregado à frota</li>
            <li><strong>F - Frota Própria:</strong> Equipamento da própria empresa</li>
            <li><strong>P - Parceiro (Terceiro Fiel):</strong> Equipamento de parceiro confiável</li>
            <li><strong>T - Terceiro:</strong> Equipamento de terceiros</li>
          </ul>
          
          <h4>📋 Validades</h4>
          <ul>
            <li>Gerencie documentos e certificações dos equipamentos</li>
            <li>Cadastre validades com tipo, certificadora, datas de validade e observações</li>
            <li>Visualize e edite validades cadastradas para cada equipamento</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar um novo equipamento, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar um equipamento existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Use múltiplos filtros para encontrar equipamentos específicos</li>
            <li>Combine filtros para refinar sua busca</li>
            <li>Exporte os resultados para Excel quando necessário</li>
            <li>Gerencie as validades dos equipamentos na aba "Validades" para manter os documentos atualizados</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaEquipamentos()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaEquipamentos = function() {
    const modal = document.getElementById('modalAjudaEquipamentos');
    if (modal) {
      modal.remove();
    }
  };
  
})();