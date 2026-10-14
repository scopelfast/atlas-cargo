// backend/public/modulos/gerenciar-tipos-atividade/js/script.js
// Gerenciar Tipos de Atividade - Frontend
// Versão: 1.0
// Atlas Cargo

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoAtividadeForm = document.getElementById('tipoAtividadeForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');
  
  let gridTab = null;
  let lastTiposAtividade = null;
  let sqlExecutado = false;
  let initExecutado = false;
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  async function carregarCatalogoModulosLicenca() {
    const selLic = document.getElementById('tipoAtividadeModuloLicenca');
    const selProd = document.getElementById('tipoAtividadeModuloProduto');
    if (!selLic && !selProd) return;
    try {
      const response = await fetch('/api/tipos-atividade/catalogo-modulos-licenca', { headers: getAuthHeaders() });
      const data = await response.json();
      const codigos = Array.isArray(data.codigos) ? data.codigos : [];
      if (selLic) {
        selLic.innerHTML = '';
        const o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = t('web.modulos.tiposAtividade.moduloLicencaOpcaoNenhuma');
        selLic.appendChild(o0);
        codigos.forEach((c) => {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          selLic.appendChild(o);
        });
      }
      if (selProd) {
        selProd.innerHTML = '';
        const p0 = document.createElement('option');
        p0.value = '';
        p0.textContent = t('web.modulos.tiposAtividade.moduloProdutoNenhum');
        selProd.appendChild(p0);
        const produtos = Array.isArray(data.produtos) ? data.produtos : [];
        produtos.forEach((p) => {
          const cd = p.cd_modulo != null ? p.cd_modulo : p.CD_MODULO;
          if (cd == null || cd === '') return;
          const o = document.createElement('option');
          o.value = String(cd);
          const fg = p.fgactive != null ? p.fgactive : p.FGACTIVE;
          const base =
            p.nome != null ? p.nome : (p.NOME != null ? p.NOME : String(p.codigo || p.CODIGO || cd));
          o.textContent = fg === 'N' ? `${base} (inativo)` : base;
          selProd.appendChild(o);
        });
      }
    } catch (e) {
      console.warn('[Tipos Atividade] Catálogo módulos/licença:', e);
    }
  }

  function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return headers;
  }

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-atividade/sql/init.sql', '/api/tipos-atividade/executar-init-sql', 'tipos-atividade');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-atividade/sql/init.sql', '/api/tipos-atividade/executar-init-sql', 'tipos-atividade');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Tipos Atividade] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
  }

  // Função de inicialização
  async function init() {
    if (initExecutado) return;
    initExecutado = true;
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      await executarInitSQL();
    } catch (err) {
    }
    await showTab('filtros');
    await carregarCatalogoModulosLicenca();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Função para mudar abas (escopo no container do módulo para não misturar Grid/Dados)
  async function showTab(tabId) {
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

    if (tabId === 'grid' && lastTiposAtividade) {
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastTiposAtividade);
        } catch (e) {}
      }
    }
  }

  // Função para exibir mensagens
  function showMessage(text, type = 'info', messageElement = null, fieldId = null) {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, messageElement || message, fieldId);
    } else if (message) {
      message.textContent = text;
      message.className = `message ${type} show`;
      message.style.display = 'block';
      setTimeout(() => {
        message.className = 'message';
        message.style.display = 'none';
      }, 5000);
    }
  }

  // Função para carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script (declarada como função nomeada para evitar problemas de hoisting)
      function carregarNovoScript() {
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
      }
      
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
            carregarNovoScript();
          }
        }, 100);
        return;
      }
      
      // Carregar o script se não existe
      carregarNovoScript();
    });
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    try {
      const params = new URLSearchParams();
      const codigo = document.getElementById('filtroCodigo')?.value;
      const descricao = document.getElementById('filtroDescricao')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      
      if (codigo) params.append('codigo', codigo);
      if (descricao) params.append('descricao', descricao);
      if (situacao) params.append('situacao', situacao);

      const response = await fetch(`/api/tipos-atividade?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        const msg = (body && body.error) ? body.error : 'Erro ao carregar tipos de atividade.';
        showMessage(msg, 'error');
        lastTiposAtividade = [];
      } else {
        lastTiposAtividade = Array.isArray(body) ? body : [];
      }

      if (lastTiposAtividade.length > 0) {
        const r0 = lastTiposAtividade[0];
        console.log('[TiposAtividade] grid dados (1ª linha)', {
          CDTIPOATIVIDADE: r0.CDTIPOATIVIDADE ?? r0.cdtipoatividade,
          nm_modulo_produto: r0.nm_modulo_produto ?? r0.NM_MODULO_PRODUTO,
          keys: r0 && typeof r0 === 'object' ? Object.keys(r0) : [],
        });
      }

      const tiposAtividade = lastTiposAtividade;
      const countEl = document.getElementById('tiposAtividadeGridCountText');
      if (countEl) {
        const msg = t('web.modulos.tiposAtividade.registrosEncontrados');
        countEl.textContent = tiposAtividade.length + ' ' + (msg.replace(/^0\s*/, ''));
      }

      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (loadErr) {}
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(tiposAtividade);
        } catch (e) {}
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.tiposAtividade.erroAplicarFiltros'), 'error');
      lastTiposAtividade = [];
      const countEl = document.getElementById('tiposAtividadeGridCountText');
      if (countEl) countEl.textContent = t('web.modulos.tiposAtividade.registrosEncontrados');
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try { gridTab.render([]); } catch (e) {}
      }
      showTab(openTab);
    }
  }

  // Inicializar grid
  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Tipos Atividade] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#tiposAtividadeGrid',
      columns: [
        { field: 'CDTIPOATIVIDADE', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOATIVIDADE', header: 'Descrição', editable: false },
        { field: 'DSPROGRAMA', header: 'Programa', editable: false,
          format: (val) => val || '-'
        },
        {
          field: 'nm_modulo_produto',
          header: t('web.modulos.tiposAtividade.gridModulo'),
          editable: false,
          width: '160px',
          format: (val, row) => {
            const pick = (v) => {
              if (v == null) return '';
              if (typeof v === 'object') return '';
              const s = String(v).trim();
              return s !== '' ? s : '';
            };
            const txt =
              pick(val) ||
              (row && pick(row.nm_modulo_produto)) ||
              (row && pick(row.NM_MODULO_PRODUTO)) ||
              (row && pick(row.codigo_catalogo_modulo)) ||
              (row && pick(row.CODIGO_CATALOGO_MODULO)) ||
              (row && pick(row.cod_modulo_produto)) ||
              (row && pick(row.COD_MODULO_PRODUTO));
            if (txt) return txt;
            const cd = row && (row.CD_MODULO_PRODUTO ?? row.cd_modulo_produto);
            if (cd != null && cd !== '') return '#' + String(cd);
            return '—';
          },
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [{ value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' }],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/tipos-atividade',
      onBeforeEdit: async (id) => {
        await loadTipoAtividadeParaEdicao(id);
        return false; // cancelar o modo de edição inline
      },
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onAfterEdit: (id) => {
        showMessage(t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
      }
    });
  }

  // Carregar tipo de atividade para edição
  async function loadTipoAtividadeParaEdicao(codigo) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (tipoAtividadeForm) {
        tipoAtividadeForm.reset();
      }
      
      await carregarCatalogoModulosLicenca();
      const response = await fetch(`/api/tipos-atividade/${codigo}`, { headers: getAuthHeaders() });
      const tipo = await response.json();
      if (!response.ok) {
        console.error('[TiposAtividade] GET tipo falhou', response.status, tipo);
        showMessage(t('web.modulos.tiposAtividade.erroCarregarDados'), 'error');
        return;
      }
      console.log('[TiposAtividade] GET tipo para edição', codigo, {
        lic: tipo.CODIGO_MODULO_LICENCA ?? tipo.codigo_modulo_licenca,
        cdMod: tipo.CD_MODULO_PRODUTO ?? tipo.cd_modulo_produto,
        nmMod: tipo.NM_MODULO_PRODUTO ?? tipo.nm_modulo_produto,
        keys: tipo && typeof tipo === 'object' ? Object.keys(tipo) : [],
      });

      showTab('dados');
      const cdTipo = tipo.CDTIPOATIVIDADE ?? tipo.cdtipoatividade;
      document.getElementById('tipoAtividadeCodigoOriginal').value = cdTipo;
      document.getElementById('tipoAtividadeCodigo').value = cdTipo;
      document.getElementById('tipoAtividadeCodigo').readOnly = true;
      document.getElementById('tipoAtividadeDescricao').value = tipo.DSTIPOATIVIDADE || tipo.dstipoatividade || '';
      document.getElementById('tipoAtividadePrograma').value = tipo.DSPROGRAMA || tipo.dsprograma || '';
      document.getElementById('tipoAtividadeGrupo').value = tipo.FGGRUPO || tipo.fggrupo || '';
      const cdMod = tipo.CD_MODULO_PRODUTO != null ? tipo.CD_MODULO_PRODUTO : tipo.cd_modulo_produto;
      const selProd = document.getElementById('tipoAtividadeModuloProduto');
      if (selProd) {
        const vMod = cdMod != null && cdMod !== '' ? String(cdMod) : '';
        if (vMod && !Array.from(selProd.options).some((o) => o.value === vMod)) {
          const opt = document.createElement('option');
          opt.value = vMod;
          opt.textContent = (tipo.NM_MODULO_PRODUTO || tipo.nm_modulo_produto || vMod) + ' (atual)';
          selProd.appendChild(opt);
        }
        selProd.value = vMod || '';
      }
      const licRaw = tipo.CODIGO_MODULO_LICENCA ?? tipo.codigo_modulo_licenca;
      const licTrim = licRaw != null && String(licRaw).trim() !== '' ? String(licRaw).trim() : '';
      const selLic = document.getElementById('tipoAtividadeModuloLicenca');
      if (selLic && licTrim) {
        const has = Array.from(selLic.options).some((o) => o.value === licTrim);
        if (!has) {
          const opt = document.createElement('option');
          opt.value = licTrim;
          opt.textContent = licTrim + ' (extra)';
          selLic.appendChild(opt);
        }
        selLic.value = licTrim;
      } else if (selLic) selLic.value = '';
      document.getElementById('tipoAtividadeSituacao').value = tipo.FGACTIVE || tipo.fgactive || 'S';
      document.getElementById('formTitle').textContent = t('web.modulos.tiposAtividade.editarTipo');
    } catch (err) {
      showMessage(t('web.modulos.tiposAtividade.erroCarregarDados'), 'error');
    }
  }

  let tipoAtividadeFormSubmitting = false;
  async function salvarTipoAtividade(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (tipoAtividadeFormSubmitting) return;
    tipoAtividadeFormSubmitting = true;
    const btnSubmit = tipoAtividadeForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }
    const codigoOriginal = document.getElementById('tipoAtividadeCodigoOriginal').value;
    const codigo = document.getElementById('tipoAtividadeCodigo').value;
    const descricao = document.getElementById('tipoAtividadeDescricao').value.trim();
    const programa = document.getElementById('tipoAtividadePrograma').value.trim();
    const grupo = document.getElementById('tipoAtividadeGrupo').value.trim();
    const situacao = document.getElementById('tipoAtividadeSituacao').value;
    const selMod = document.getElementById('tipoAtividadeModuloLicenca');
    const codigoModuloLicenca = selMod && selMod.value ? selMod.value.trim() : '';
    const selProd = document.getElementById('tipoAtividadeModuloProduto');
    const rawCdProd = selProd && selProd.value !== '' && selProd.value != null ? parseInt(selProd.value, 10) : null;
    const cdModuloProduto = Number.isFinite(rawCdProd) ? rawCdProd : null;

    if (!codigo || !descricao) {
      showMessage(t('web.modulos.tiposAtividade.preenchaCampos'), 'error');
      tipoAtividadeFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const url = codigoOriginal ? `/api/tipos-atividade/${codigoOriginal}` : '/api/tipos-atividade';
      const method = codigoOriginal ? 'PUT' : 'POST';

      const payload = {
        CDTIPOATIVIDADE: parseInt(codigo, 10),
        DSTIPOATIVIDADE: descricao,
        DSPROGRAMA: programa || null,
        FGGRUPO: grupo || null,
        FGACTIVE: situacao,
        CODIGO_MODULO_LICENCA: codigoModuloLicenca || null,
        CD_MODULO_PRODUTO: cdModuloProduto,
      };
      console.log('[TiposAtividade] salvar', method, url, payload);

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      console.log('[TiposAtividade] salvar resposta', response.status, response.ok, result);
      if (response.ok) {
        showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
        showTab('grid');
        await applyFilters('grid');
      } else {
        showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
      }
    } catch (err) {
      showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
    } finally {
      setTimeout(() => {
        tipoAtividadeFormSubmitting = false;
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      }, 600);
    }
  }

  // Limpar formulário
  function limparFormulario() {
    document.getElementById('tipoAtividadeCodigoOriginal').value = '';
    document.getElementById('tipoAtividadeCodigo').value = '';
    document.getElementById('tipoAtividadeCodigo').readOnly = false;
    document.getElementById('tipoAtividadeDescricao').value = '';
    document.getElementById('tipoAtividadePrograma').value = '';
    document.getElementById('tipoAtividadeGrupo').value = '';
    const selL = document.getElementById('tipoAtividadeModuloLicenca');
    if (selL) selL.value = '';
    const selP = document.getElementById('tipoAtividadeModuloProduto');
    if (selP) selP.value = '';
    document.getElementById('tipoAtividadeSituacao').value = 'S';
    document.getElementById('formTitle').textContent = t('web.modulos.tiposAtividade.novoTipo');
  }

  // Confirmar exclusão
  async function confirmarExclusao(codigo) {
    const estaAtivo = lastTiposAtividade?.find(t => t.CDTIPOATIVIDADE === codigo)?.FGACTIVE === 'S';
    const msg = estaAtivo
      ? `Tem certeza que deseja desativar o tipo de atividade "${codigo}"?`
      : `Tem certeza que deseja excluir o tipo de atividade "${codigo}"?`;
    
    const modalMsgEl = document.getElementById('modalMessage');
    if (modalMsgEl) modalMsgEl.textContent = msg;
    
    if (!modal || !confirmYes || !confirmNo) {
      const ok =
        typeof window.confirmPadrao === 'function'
          ? await window.confirmPadrao(msg, {
              title: estaAtivo ? 'Desativar tipo de atividade' : 'Excluir tipo de atividade',
              danger: true,
              confirmText: estaAtivo ? 'Desativar' : 'Excluir',
              cancelText: 'Cancelar',
            })
          : window.confirm(msg);
      if (ok) {
        try {
          const response = await fetch(`/api/tipos-atividade/${codigo}`, { method: 'DELETE', headers: getAuthHeaders() });
          const result = await response.json();
          if (response.ok) {
            showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
          }
        } catch (err) {
          showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
        }
      }
      return;
    }
    const btnText = estaAtivo ? 'Desativar' : 'Excluir';
    const newYes = confirmYes.cloneNode(true);
    const newNo = confirmNo.cloneNode(true);
    newYes.className = 'btn-filtro btn-filtro-danger';
    newYes.innerHTML = '<i class="bx bx-check"></i> ' + btnText;
    newNo.className = 'btn-filtro btn-filtro-limpar';
    newNo.innerHTML = '<i class="bx bx-x"></i> ' + (t('web.modulos.tiposAtividade.cancelar') || 'Cancelar');
    if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newYes, confirmYes);
    if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newNo, confirmNo);

    modal.style.display = 'block';
    return new Promise((resolve) => {
      const handlerYes = async () => {
        modal.style.display = 'none';
        try {
          const response = await fetch(`/api/tipos-atividade/${codigo}`, { method: 'DELETE', headers: getAuthHeaders() });
          const result = await response.json();
          if (response.ok) {
            showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
          }
        } catch (err) {
          showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
        }
        resolve();
      };
      const handlerNo = () => { modal.style.display = 'none'; resolve(); };
      newYes.addEventListener('click', handlerYes, { once: true });
      newNo.addEventListener('click', handlerNo, { once: true });
    });
  }

  // Expor funções globalmente para uso no grid
  window.editarTipoAtividade = loadTipoAtividadeParaEdicao;
  window.excluirTipoAtividade = confirmarExclusao;

  // Event Listeners
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      showTab(tabId);
    });
  });

  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    filtroForm.reset();
    lastTiposAtividade = null;
    document.getElementById('tiposAtividadeGridCountText').textContent = t('web.modulos.tiposAtividade.registrosEncontrados');
    document.getElementById('tiposAtividadeGrid').innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
  });

  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistro')?.addEventListener('click', async () => {
    await carregarCatalogoModulosLicenca();
    limparFormulario();
    showTab('dados');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', async () => {
    await carregarCatalogoModulosLicenca();
    limparFormulario();
    showTab('dados');
  });

  document.getElementById('btnCancelar')?.addEventListener('click', () => {
    limparFormulario();
    showTab('filtros');
  });

  tipoAtividadeForm?.addEventListener('submit', salvarTipoAtividade);

  document.getElementById('confirmNo')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

})();

