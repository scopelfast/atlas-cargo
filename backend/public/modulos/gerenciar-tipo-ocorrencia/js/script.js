// backend/public/modulos/gerenciar-tipo-ocorrencia/js/script.js
// Alinhado ao padrão do módulo Gerenciar Tipos de Viagem
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const filtroForm = document.getElementById('filtroForm');
  const tipoOcorrenciaForm = document.getElementById('tipoOcorrenciaForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastTipos = null;

  async function preencherSituacoesViagemCombo() {
    var sel = document.getElementById('tipoSituacaoViagem');
    if (!sel || sel.options.length > 1) return;
    try {
      var res = await fetch('/api/situacoes-viagem-combo');
      var list = await res.json();
      if (!Array.isArray(list)) return;
      list.forEach(function(item) {
        var opt = document.createElement('option');
        opt.value = item.CDSITUACAOVIAGEM != null ? item.CDSITUACAOVIAGEM : (item.cdsituacaoviagem != null ? item.cdsituacaoviagem : '');
        opt.textContent = (item.DSSITUACAOVIAGEM || item.dssituacaoviagem || '') + (opt.value ? ' (' + opt.value + ')' : '');
        sel.appendChild(opt);
      });
    } catch (e) { console.warn('Erro ao carregar situações de viagem:', e); }
  }

  function showMessage(text, type) {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, message);
    } else if (message) {
      message.textContent = text;
      message.className = 'message ' + type + ' show';
      setTimeout(function() { message.className = 'message'; }, 5000);
    }
  }

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      var script = document.createElement('script');
      var srcCorrigido = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl(src) : src;
      script.src = (srcCorrigido || src) + '?t=' + Date.now();
      script.onload = function() {
        setTimeout(function() {
          if (typeof window.GridEditor !== 'undefined') resolve();
          else reject(new Error('GridEditor não carregou'));
        }, 100);
      };
      script.onerror = function() { reject(new Error('Erro ao carregar ' + src)); };
      document.head.appendChild(script);
    });
  }

  async function showTab(tabId) {
    var targetContent = document.getElementById('tab-' + tabId);
    var targetBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
    if (!targetContent || !targetBtn) return;
    var container = targetContent.closest('.tipo-ocorrencia-container') || targetContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
      container.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    }
    targetBtn.classList.add('active');
    targetContent.classList.add('active');

    if (tabId === 'grid') {
      if (!lastTipos) {
        await applyFilters('grid');
        return;
      }
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try { gridTab.render(lastTipos || []); } catch (e) { console.warn('[Tipo Ocorrência] render grid:', e); }
      }
    }
  }

  async function applyFilters(openTab) {
    if (openTab === undefined) openTab = 'grid';
    var params = new URLSearchParams();
    var codigo = document.getElementById('filtroCodigo');
    var descricao = document.getElementById('filtroDescricao');
    var situacao = document.getElementById('filtroSituacao');
    if (codigo && codigo.value) params.append('codigo', codigo.value);
    if (descricao && descricao.value) params.append('descricao', descricao.value);
    if (situacao && situacao.value) params.append('situacao', situacao.value);

    try {
      var response = await fetch('/api/tipos-ocorrencia?' + params.toString());
      var tipos = await response.json();

      if (!Array.isArray(tipos)) {
        lastTipos = [];
        var msg = (tipos && tipos.error) ? tipos.error : 'Resposta inválida da API.';
        showMessage(msg, 'error');
        return;
      }
      lastTipos = tipos;

      var countEl = document.getElementById('tiposOcorrenciaGridCountText');
      if (countEl) countEl.textContent = tipos.length + ' registro(s) encontrado(s)';

      if (gridTab) {
        try { gridTab.render(tipos); } catch (e) { console.warn('[Tipo Ocorrência] gridTab.render:', e); }
      }

      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try { await loadScript('/js/grid-editor.js'); } catch (e) { console.warn('[Tipo Ocorrência] loadScript grid-editor:', e); }
        }
        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          if (gridTab) {
            try { gridTab.render(tipos); } catch (e) { console.warn('[Tipo Ocorrência] render:', e); }
          }
        }
      }
      showTab(openTab);
    } catch (err) {
      console.error('[Tipo Ocorrência] applyFilters:', err);
      showMessage('Erro ao carregar tipos de ocorrência.', 'error');
    }
  }

  function inicializarGridTab() {
    var containerEl = document.getElementById('tiposOcorrenciaGrid');
    if (!containerEl) return;
    if (typeof window.GridEditor === 'undefined') return;

    gridTab = new window.GridEditor({
      container: containerEl,
      columns: [
        { field: 'CDTIPOOCORRENCIA', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOOCORRENCIA', header: 'Descrição', editable: true, type: 'text', maxlength: 100 },
        { field: 'FGSITUACAO', header: 'FGSITUACAO', editable: true, type: 'text', width: '100px' },
        { field: 'SEQ', header: 'SEQ', editable: true, type: 'number', width: '70px' },
        { field: 'CDSITUACAOVIAGEM', header: 'Sit. viagem', editable: false, width: '85px',
          format: function(v) { return v != null && v !== '' ? v : '—'; }
        },
        { field: 'FG_CONTROLE_TEMPO', header: 'Ctrl. tempo', editable: false, width: '85px',
          format: function(v) { return (v === 'S' || v === 's') ? 'Sim' : 'Não'; }
        },
        { field: 'TEMPO_MAXIMO_MINUTOS', header: 'Tempo máx. (min)', editable: false, width: '110px',
          format: function(v) { return v != null && v !== '' ? v : '—'; }
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '90px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: function(val) { return val === 'S' ? '✓ Ativo' : '✗ Inativo'; }
        }
      ],
      apiEndpoint: '/api/tipos-ocorrencia',
      onBeforeEdit: function(id) {
        loadTipoParaEdicao(id);
        return false;
      },
      onDelete: function(id) {
        if (id != null && id !== '' && id !== 'undefined') confirmarExclusao(id);
      },
      onAfterEdit: function(id) {
        showMessage('Alteração salva com sucesso!', 'success');
      }
    });
  }

  async function loadTipoParaEdicao(id) {
    try {
      if (tipoOcorrenciaForm) tipoOcorrenciaForm.reset();
      var response = await fetch('/api/tipos-ocorrencia/' + id);
      if (!response.ok) throw new Error('Não encontrado');
      var tipo = await response.json();
      document.getElementById('tipoCodigo').value = tipo.CDTIPOOCORRENCIA;
      document.getElementById('tipoDescricao').value = tipo.DSTIPOOCORRENCIA || '';
      var fgSituacao = (tipo.FGSITUACAO || tipo.fgsituacao || '').toString().trim().toUpperCase();
      document.getElementById('tipoFgSituacao').value = ['T', 'P', 'C', 'D', 'F'].indexOf(fgSituacao) >= 0 ? fgSituacao : '';
      document.getElementById('tipoSeq').value = tipo.SEQ != null ? tipo.SEQ : '';
      var situacaoViagemEl = document.getElementById('tipoSituacaoViagem');
      if (situacaoViagemEl) situacaoViagemEl.value = (tipo.CDSITUACAOVIAGEM != null ? tipo.CDSITUACAOVIAGEM : tipo.cdsituacaoviagem) != null ? String(tipo.CDSITUACAOVIAGEM != null ? tipo.CDSITUACAOVIAGEM : tipo.cdsituacaoviagem) : '';
      var controleTempo = (tipo.FG_CONTROLE_TEMPO || tipo.fg_controle_tempo || 'N').toString().toUpperCase() === 'S';
      var controleTempoEl = document.getElementById('tipoControleTempo');
      var wrapTempoEl = document.getElementById('wrapTempoMaximo');
      if (controleTempoEl) controleTempoEl.checked = controleTempo;
      if (wrapTempoEl) wrapTempoEl.style.display = controleTempo ? 'block' : 'none';
      var tempoMaxEl = document.getElementById('tipoTempoMaximo');
      if (tempoMaxEl) tempoMaxEl.value = (tipo.TEMPO_MAXIMO_MINUTOS != null ? tipo.TEMPO_MAXIMO_MINUTOS : tipo.tempo_maximo_minutos) != null ? String(tipo.TEMPO_MAXIMO_MINUTOS != null ? tipo.TEMPO_MAXIMO_MINUTOS : tipo.tempo_maximo_minutos) : '';
      document.getElementById('tipoSituacao').value = tipo.FGACTIVE || 'S';
      document.getElementById('formTitle').textContent = 'Editar Tipo de Ocorrência';
      showTab('dados');
    } catch (err) {
      console.error('Erro ao carregar tipo:', err);
      showMessage('Erro ao carregar dados.', 'error');
    }
  }

  function executarAlteracaoStatus(deleteId, acao, modalEl) {
    fetch('/api/tipos-ocorrencia/' + deleteId + '?action=' + acao, { method: 'DELETE' })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        showMessage(data.message || 'Status alterado.', 'success');
        showTab('grid');
        applyFilters('grid');
      })
      .catch(function() { showMessage('Erro ao alterar status.', 'error'); })
      .finally(function() {
        if (modalEl) {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteId;
          delete modalEl.dataset.action;
        }
      });
  }

  function confirmarExclusao(id) {
    var idStr = String(id).trim();
    if (!idStr || idStr === 'undefined' || idStr === 'null') {
      showMessage('ID inválido.', 'error');
      return;
    }
    var modalMessage = document.getElementById('modalMessage');
    var confirmYes = document.getElementById('confirmYes');
    var confirmNo = document.getElementById('confirmNo');
    var modalEl = document.getElementById('confirmModal');

    fetch('/api/tipos-ocorrencia/' + idStr)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('Não encontrado')); })
      .then(function(tipo) {
        var estaAtivo = tipo.FGACTIVE === 'S';
        var msg = estaAtivo ? 'Desativar este tipo de ocorrência?' : 'Reativar este tipo de ocorrência?';
        var action = estaAtivo ? 'deactivate' : 'activate';

        if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
          if (window.confirm(msg)) {
            executarAlteracaoStatus(idStr, action, null);
          }
          return;
        }

        modalMessage.textContent = msg;
        modalEl.dataset.deleteId = idStr;
        modalEl.dataset.action = action;

        var handlerYes = function() {
          var deleteId = modalEl.dataset.deleteId;
          var acao = modalEl.dataset.action;
          executarAlteracaoStatus(deleteId, acao, modalEl);
        };
        var handlerNo = function() {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteId;
          delete modalEl.dataset.action;
        };

        var btnText = estaAtivo ? 'Desativar' : 'Reativar';
        var newConfirmYes = confirmYes.cloneNode(true);
        var newConfirmNo = confirmNo.cloneNode(true);
        newConfirmYes.className = 'btn-filtro btn-filtro-danger';
        newConfirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
        newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
        newConfirmNo.innerHTML = '<i class=\'bx bx-x\'></i> Cancelar';
        if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
        if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
        newConfirmYes.onclick = handlerYes;
        newConfirmNo.onclick = handlerNo;
        modalEl.style.display = 'block';
      })
      .catch(function() { showMessage('Tipo de ocorrência não encontrado.', 'error'); });
  }

  if (tipoOcorrenciaForm) {
    tipoOcorrenciaForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var id = document.getElementById('tipoCodigo').value;
      var DSTIPOOCORRENCIA = document.getElementById('tipoDescricao').value;
      if (DSTIPOOCORRENCIA) DSTIPOOCORRENCIA = DSTIPOOCORRENCIA.trim();
      var FGSITUACAO = document.getElementById('tipoFgSituacao').value || null;
      var SEQ = document.getElementById('tipoSeq').value;
      var situacaoViagemEl = document.getElementById('tipoSituacaoViagem');
      var CDSITUACAOVIAGEM = (situacaoViagemEl && situacaoViagemEl.value) ? parseInt(situacaoViagemEl.value, 10) : null;
      var controleTempoEl = document.getElementById('tipoControleTempo');
      var FG_CONTROLE_TEMPO = (controleTempoEl && controleTempoEl.checked) ? 'S' : 'N';
      var tempoMaxEl = document.getElementById('tipoTempoMaximo');
      var TEMPO_MAXIMO_MINUTOS = (tempoMaxEl && tempoMaxEl.value.trim() !== '') ? parseInt(tempoMaxEl.value, 10) : null;
      var FGACTIVE = document.getElementById('tipoSituacao').value;
      if (!DSTIPOOCORRENCIA) {
        showMessage('Preencha a descrição.', 'error');
        return;
      }
      var payload = {
        DSTIPOOCORRENCIA: DSTIPOOCORRENCIA,
        FGSITUACAO: FGSITUACAO,
        SEQ: SEQ !== '' ? parseInt(SEQ, 10) : null,
        CDSITUACAOVIAGEM: CDSITUACAOVIAGEM,
        FG_CONTROLE_TEMPO: FG_CONTROLE_TEMPO,
        TEMPO_MAXIMO_MINUTOS: TEMPO_MAXIMO_MINUTOS,
        FGACTIVE: FGACTIVE
      };
      try {
        var url = id ? '/api/tipos-ocorrencia/' + id : '/api/tipos-ocorrencia';
        var method = id ? 'PUT' : 'POST';
        var response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (response.ok) {
          showMessage(data.message || 'Salvo com sucesso!', 'success');
          showTab('grid');
          applyFilters('grid');
        } else {
          showMessage(data.error || 'Erro ao salvar.', 'error');
        }
      } catch (err) {
        console.error(err);
        showMessage('Erro de conexão.', 'error');
      }
    });
  }

  if (filtroForm) {
    filtroForm.addEventListener('submit', function(e) {
      e.preventDefault();
      applyFilters('grid');
    });
  }

  tabs.forEach(function(btn) {
    btn.addEventListener('click', function() {
      showTab(btn.getAttribute('data-tab'));
    });
  });

  function irParaNovo() {
    if (tipoOcorrenciaForm) tipoOcorrenciaForm.reset();
    document.getElementById('formTitle').textContent = 'Novo Tipo de Ocorrência';
    var codigoEl = document.getElementById('tipoCodigo');
    if (codigoEl) codigoEl.value = '';
    var controleTempoEl = document.getElementById('tipoControleTempo');
    if (controleTempoEl) controleTempoEl.checked = false;
    atualizarVisibilidadeTempoMaximo();
    showTab('dados');
  }

  var btnLimpar = document.getElementById('btnLimparFiltros');
  if (btnLimpar) btnLimpar.addEventListener('click', function() {
    var fc = document.getElementById('filtroCodigo');
    var fd = document.getElementById('filtroDescricao');
    var fs = document.getElementById('filtroSituacao');
    if (fc) fc.value = '';
    if (fd) fd.value = '';
    if (fs) fs.value = '';
  });
  var btnNovo = document.getElementById('btnNovoRegistro');
  if (btnNovo) btnNovo.addEventListener('click', irParaNovo);
  var btnVoltarGrid = document.getElementById('btnVoltarGrid');
  if (btnVoltarGrid) btnVoltarGrid.addEventListener('click', function() { showTab('filtros'); });
  var btnNovoGrid = document.getElementById('btnNovoRegistroGrid');
  if (btnNovoGrid) btnNovoGrid.addEventListener('click', irParaNovo);
  var btnCancelar = document.getElementById('btnCancelar');
  if (btnCancelar) btnCancelar.addEventListener('click', function() { showTab('grid'); });

  function atualizarVisibilidadeTempoMaximo() {
    var controleTempoEl = document.getElementById('tipoControleTempo');
    var wrapTempoEl = document.getElementById('wrapTempoMaximo');
    if (wrapTempoEl && controleTempoEl) wrapTempoEl.style.display = controleTempoEl.checked ? 'block' : 'none';
  }

  function init() {
    showTab('filtros');
    preencherSituacoesViagemCombo();
    var tipoControleTempoEl = document.getElementById('tipoControleTempo');
    if (tipoControleTempoEl) tipoControleTempoEl.addEventListener('change', atualizarVisibilidadeTempoMaximo);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
