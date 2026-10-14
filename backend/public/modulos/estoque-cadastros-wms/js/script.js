// WMS Cadastros — padrão Torre (Situações de Viagem / Cidades: abas, overlay, GridEditor).
(function () {
  var entity = 'dono';
  var lastRows = [];
  var gridLoadedForEntity = false;
  var gridTab = null;
  var cadFormSubmitting = false;
  var importProdutosSubmitting = false;
  var initFeito = false;
  var aplicandoFiltros = false;
  var WMS_CAD_LAST_DONO_KEY = 'wmsCadLastCdDono';
  var sugestoesCategoriaRows = [];
  var lastCadastroResumo = null;

  function canFilterProduto() {
    var ddF = document.getElementById('filtro_cd_dono');
    var formDono = document.getElementById('form_cd_dono');
    var codF = document.getElementById('filtro_codigo');
    var nomF = document.getElementById('filtro_nome');
    var catF = document.getElementById('filtro_cd_categoria');
    var taF = document.getElementById('filtro_tipo_armazenagem');
    var psF = document.getElementById('filtro_peso_status');
    var fgF = document.getElementById('filtro_fgactive');
    var mfF = document.getElementById('filtro_mostrar_fornecedor');
    var idF = document.getElementById('filtro_cd_produto');
    var temDono = ddF && String(ddF.value || '').trim() !== '';
    var temDonoForm = formDono && String(formDono.value || '').trim() !== '';
    var codT = codF && String(codF.value || '').trim();
    var nomT = nomF && String(nomF.value || '').trim();
    var idT = idF && String(idF.value || '').trim();
    return (
      temDono ||
      temDonoForm ||
      !!codT ||
      !!nomT ||
      !!idT ||
      (catF && String(catF.value || '').trim() !== '') ||
      (taF && String(taF.value || '').trim() !== '') ||
      (psF && String(psF.value || '').trim() !== '') ||
      (fgF && String(fgF.value || '').trim() !== '') ||
      (mfF && mfF.checked)
    );
  }

  function canFilterOperacional() {
    var ddF = document.getElementById('filtro_cd_dono');
    var colF = document.getElementById('filtro_codigo_ol');
    var cesF = document.getElementById('filtro_codigo_estoque');
    var nomF = document.getElementById('filtro_nome');
    var semF = document.getElementById('filtro_sem_unidade');
    return (
      (ddF && String(ddF.value || '').trim() !== '') ||
      (colF && String(colF.value || '').trim() !== '') ||
      (cesF && String(cesF.value || '').trim() !== '') ||
      (nomF && String(nomF.value || '').trim() !== '') ||
      (semF && semF.checked)
    );
  }

  function mensagemFiltroOperacionalObrigatorio() {
    return (
      'Na aba Filtros do Catálogo OL, selecione o dono ou informe código OL / código estoque / nome, ou marque "Somente sem UM operacional", e clique em Filtrar.'
    );
  }

  function mensagemFiltroProdutoObrigatorio() {
    return (
      'Na aba Filtros, selecione o dono do estoque (ex.: Nutriville), informe código/nome, escolha categoria ou outro critério e clique em Filtrar. ' +
      'O dono escolhido na importação XML é o mesmo: ao selecionar lá, o filtro é preenchido automaticamente.'
    );
  }

  function syncDonoProdutoFiltroImport(origem) {
    var filtro = document.getElementById('filtro_cd_dono');
    var imp = document.getElementById('import_prod_cd_dono');
    if (origem === 'import' && imp && imp.value) {
      if (filtro) filtro.value = imp.value;
      try {
        sessionStorage.setItem(WMS_CAD_LAST_DONO_KEY, imp.value);
      } catch (_) {}
    } else if (origem === 'filtro' && filtro && filtro.value) {
      if (imp) imp.value = filtro.value;
      try {
        sessionStorage.setItem(WMS_CAD_LAST_DONO_KEY, filtro.value);
      } catch (_) {}
    }
  }

  function restoreLastDonoProduto() {
    var last;
    try {
      last = sessionStorage.getItem(WMS_CAD_LAST_DONO_KEY);
    } catch (_) {
      return;
    }
    if (!last) return;
    ['filtro_cd_dono', 'import_prod_cd_dono', 'form_cd_dono'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      if (Array.prototype.some.call(sel.options, function (o) {
        return o.value === last;
      })) {
        sel.value = last;
      }
    });
  }

  function bindDonoProdutoSyncListeners() {
    if (bindDonoProdutoSyncListeners.done) return;
    bindDonoProdutoSyncListeners.done = true;
    document.addEventListener('change', function (e) {
      if (!e.target) return;
      if (e.target.id === 'filtro_cd_dono') syncDonoProdutoFiltroImport('filtro');
      if (e.target.id === 'import_prod_cd_dono') syncDonoProdutoFiltroImport('import');
    });
  }

  function t(k, fallback) {
    if (typeof window.tWeb === 'function') {
      var x = window.tWeb(k);
      if (x && x !== k && !String(x).startsWith('web.')) return x;
    }
    return fallback != null ? fallback : k;
  }

  function cadMessageEl() {
    return document.querySelector('.wms-cadastros-container #wmsCadMessage');
  }

  function clearCadMessage() {
    var m = cadMessageEl();
    if (!m) return;
    m.textContent = '';
    m.className = 'message';
    m.style.display = 'none';
  }

  function showMessage(text, type, el, fieldId) {
    var target = el || cadMessageEl();
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, target, fieldId);
      return;
    }
    if (!target) return;
    target.textContent = text || '';
    target.className = 'message ' + (type || '');
    target.style.display = text ? 'block' : 'none';
  }

  function restaurarModalConfirmPadrao() {
    var yes = document.getElementById('confirmYes');
    var no = document.getElementById('confirmNo');
    if (yes) {
      yes.className = 'btn-filtro btn-filtro-aplicar';
      yes.innerHTML = "<i class='bx bx-check'></i> Confirmar";
    }
    if (no) no.innerHTML = "<i class='bx bx-x'></i> Cancelar";
  }

  /** Confirmação Sim/Não — modal do módulo (padrão Torre / Situações de Viagem). */
  function confirmarAcao(conteudo, extra) {
    extra = extra || {};
    return new Promise(function (resolve) {
      var modal = document.getElementById('confirmModal');
      var msg = document.getElementById('modalMessage');
      var yes = document.getElementById('confirmYes');
      var no = document.getElementById('confirmNo');
      if (!modal || !msg || !yes || !no) {
        var plain = String(conteudo || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (typeof window.confirmPadrao === 'function') {
          window.confirmPadrao(plain || extra.titulo || 'Continuar?', {
            title: extra.titulo || 'Confirmar ação',
            danger: !!extra.danger,
            confirmText: extra.okLabel || 'Confirmar',
            cancelText: 'Cancelar',
          }).then(function (ok) {
            resolve(!!ok);
          });
        } else {
          resolve(window.confirm(plain || extra.titulo || 'Continuar?'));
        }
        return;
      }
      if (extra.html) msg.innerHTML = conteudo || '';
      else msg.textContent = conteudo || '';
      yes.className = extra.danger ? 'btn-filtro btn-filtro-danger' : 'btn-filtro btn-filtro-aplicar';
      yes.innerHTML = "<i class='bx bx-check'></i> " + (extra.okLabel || 'Confirmar');
      no.innerHTML = "<i class='bx bx-x'></i> Cancelar";
      function fechar(res) {
        yes.onclick = null;
        no.onclick = null;
        modal.style.display = 'none';
        restaurarModalConfirmPadrao();
        resolve(res);
      }
      yes.onclick = function () {
        fechar(true);
      };
      no.onclick = function () {
        fechar(false);
      };
      modal.style.display = 'flex';
    });
  }

  function confirmarTextoModal(htmlOuTexto, titulo, okLabel) {
    var html =
      (titulo ? '<p style="margin:0 0 10px;font-weight:600;color:inherit">' + titulo + '</p>' : '') +
      (htmlOuTexto || '');
    return confirmarAcao(html, { html: true, okLabel: okLabel || 'Confirmar' });
  }

  function onlyDigits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  /** CPF/CNPJ: completa zeros à esquerda quando o CNPJ vem com menos de 14 dígitos. */
  function formatCnpj(v) {
    var d = onlyDigits(v);
    if (!d) return '';
    if (d.length <= 11) {
      d = d.padStart(11, '0').slice(-11);
      return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    }
    if (d.length > 14) d = d.slice(-14);
    else d = d.padStart(14, '0');
    return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  }

  function onlyAlphaNum(v) {
    return String(v || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
  }

  function applyProductMask(value, mask) {
    var m = String(mask || '').trim().toUpperCase();
    if (!m) return String(value || '');
    var src = onlyAlphaNum(value);
    var out = '';
    var p = 0;
    for (var i = 0; i < m.length; i++) {
      var ch = m.charAt(i);
      if (ch === '0' || ch === 'A' || ch === 'X') {
        while (p < src.length) {
          var c = src.charAt(p++);
          var ok =
            (ch === '0' && /[0-9]/.test(c)) ||
            (ch === 'A' && /[A-Z]/.test(c)) ||
            (ch === 'X' && /[0-9A-Z]/.test(c));
          if (ok) {
            out += c;
            break;
          }
        }
      } else {
        out += ch;
      }
    }
    return out;
  }

  function formatPesoKg(val) {
    if (val == null || val === '') return '';
    var n = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(n)) return '';
    return n.toFixed(3).replace('.', ',');
  }

  function getSelectedDonoMask(selectEl) {
    if (!selectEl) return '';
    var opt = selectEl.options && selectEl.options[selectEl.selectedIndex];
    return (opt && opt.getAttribute('data-mask')) || '';
  }

  function bindProdutoCodigoMask(options) {
    options = options || {};
    var skipInitialApply = !!options.skipInitialApply;
    if (entity !== 'produto') return;
    var donoSel = document.getElementById('form_cd_dono');
    var codigoInput = document.getElementById('form_codigo');
    if (!donoSel || !codigoInput) return;
    function applyNow() {
      var mask = getSelectedDonoMask(donoSel);
      if (!mask) return;
      codigoInput.value = applyProductMask(codigoInput.value, mask);
    }
    if (codigoInput._wmsMaskApplyFn) {
      try {
        codigoInput.removeEventListener('input', codigoInput._wmsMaskApplyFn);
        donoSel.removeEventListener('change', codigoInput._wmsMaskApplyFn);
      } catch (eR) {}
    }
    codigoInput._wmsMaskApplyFn = applyNow;
    codigoInput.addEventListener('input', applyNow);
    donoSel.addEventListener('change', applyNow);
    if (!skipInitialApply) applyNow();
  }

  function isValidCnpj(raw) {
    var cnpj = onlyDigits(raw);
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(cnpj)) return false;
    function calc(base, factorStart) {
      var sum = 0;
      var factor = factorStart;
      for (var i = 0; i < base.length; i++) {
        sum += parseInt(base.charAt(i), 10) * factor;
        factor = factor === 2 ? 9 : factor - 1;
      }
      var mod = sum % 11;
      return mod < 2 ? 0 : 11 - mod;
    }
    var d1 = calc(cnpj.slice(0, 12), 5);
    var d2 = calc(cnpj.slice(0, 12) + String(d1), 6);
    return cnpj === cnpj.slice(0, 12) + String(d1) + String(d2);
  }

  function bindCnpjMask() {
    var input = document.getElementById('form_cgc');
    if (!input) return;
    input.addEventListener('input', function () {
      input.value = formatCnpj(input.value);
    });
    input.addEventListener('blur', function () {
      if (!input.value) return;
      input.value = formatCnpj(input.value);
    });
  }

  function showLoadingOverlay(titulo, texto, detalhe) {
    var overlay = document.getElementById('loadingOverlay');
    var lt = document.getElementById('loadingTitle');
    var lx = document.getElementById('loadingText');
    var ld = document.getElementById('loadingDetalhe');
    if (overlay) {
      if (lt) lt.textContent = titulo || t('web.modulos.wmsCadastros.loadingTitle', 'Carregando');
      if (lx) lx.textContent = texto || t('web.modulos.wmsCadastros.loadingText', 'Aguarde...');
      if (ld) ld.textContent = detalhe || t('web.modulos.wmsCadastros.loadingDetalhe', 'Isso pode levar alguns segundos.');
      if (overlay.parentNode !== document.body) document.body.appendChild(overlay);
      overlay.style.cssText =
        'display:flex !important; position:fixed !important; top:0; left:0; right:0; bottom:0; z-index:99999; background:rgba(0,0,0,0.75); align-items:center; justify-content:center;';
    }
  }

  function hideLoadingOverlay() {
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.style.cssText = 'display:none !important;';
      var contentArea = document.getElementById('contentArea');
      var mod = contentArea && contentArea.querySelector('.wms-cadastros-container');
      if (overlay.parentNode === document.body && mod) {
        mod.insertBefore(overlay, mod.firstChild);
      } else if (overlay.parentNode === document.body) {
        overlay.remove();
      }
    }
  }

  async function showTab(tabId) {
    var targetContent = document.getElementById('tab-' + tabId);
    var targetBtn = document.querySelector('.wms-cadastros-container .tab-btn[data-tab="' + tabId + '"]');
    if (!targetContent || !targetBtn) return;
    var container = targetContent.closest('.wms-cadastros-container') || targetContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-content').forEach(function (c) {
        c.classList.remove('active');
      });
      container.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.remove('active');
      });
    }
    targetBtn.classList.add('active');
    targetContent.classList.add('active');

    if (tabId === 'grid') {
      if ((!lastRows || lastRows.length === 0) && !gridLoadedForEntity && !aplicandoFiltros) {
        if (entity === 'produto' && !canFilterProduto()) {
          hideLoadingOverlay();
          var gh = document.getElementById('wmsCadGrid');
          if (gh) {
            gh.innerHTML =
              '<p class="empty">Selecione o dono na aba Filtros (ou código/nome) e clique em Filtrar.</p>';
          }
          return;
        }
        await applyFilters('grid');
        return;
      }
      hideLoadingOverlay();
      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (e) {}
      }
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastRows || []);
        } catch (err) {
          console.error('[WMS Cadastros] grid render:', err);
        }
      }
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (typeof window.GridEditor !== 'undefined' && src.indexOf('grid-editor') >= 0) {
        resolve();
        return;
      }
      var srcCorrigido = typeof window.corrigirUrl === 'function' ? window.corrigirUrl(src) : src;
      var script = document.createElement('script');
      script.src = srcCorrigido + (srcCorrigido.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
      script.onload = function () {
        setTimeout(function () {
          resolve();
        }, 80);
      };
      script.onerror = function () {
        reject(new Error(src));
      };
      document.head.appendChild(script);
    });
  }

  function getIdField() {
    if (entity === 'dono') return 'CD_DONO';
    if (entity === 'armazem') return 'CD_ARMAZEM';
    if (entity === 'area') return 'CD_AREA';
    if (entity === 'doca') return 'CD_DOCA';
    if (entity === 'grupo') return 'CD_GRUPO';
    if (entity === 'categoria') return 'CD_CATEGORIA';
    if (entity === 'produto') return 'CD_PRODUTO';
    if (entity === 'operacional') return 'CD_OPERACIONAL';
    return 'CD_DEPARA';
  }

  function buildColumns() {
    var fgFmt = function (val) {
      return val === 'S' ? '✓ Ativo' : '✗ Inativo';
    };
    var cnpjFmt = function (val) {
      return formatCnpj(val || '');
    };
    if (entity === 'dono') {
      return [
        { field: 'CD_DONO', header: 'ID', editable: false, isId: true, width: '8%' },
        { field: 'CODIGO', header: 'Código', editable: false, width: '14%' },
        { field: 'NOME', header: 'Nome', editable: false, width: '34%' },
        { field: 'CGC', header: 'CNPJ', editable: false, width: '34%', format: cnpjFmt },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '10%',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'armazem') {
      return [
        { field: 'CD_ARMAZEM', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'NM_DONO', header: 'Dono', editable: false },
        { field: 'CODIGO', header: 'Código', editable: false },
        { field: 'NOME', header: 'Nome', editable: false },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '100px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'area') {
      return [
        { field: 'CD_AREA', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'NM_ARMAZEM', header: 'Armazém', editable: false },
        { field: 'CODIGO', header: 'Código', editable: false },
        { field: 'NOME', header: 'Nome', editable: false },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '100px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'grupo') {
      return [
        { field: 'CD_GRUPO', header: 'ID', editable: false, isId: true, width: '8%' },
        { field: 'CODIGO', header: 'Código', editable: false, width: '16%' },
        { field: 'NOME', header: 'Nome', editable: false, width: '50%' },
        { field: 'ORDEM', header: 'Ordem', editable: false, width: '16%', align: 'right' },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '10%',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'categoria') {
      return [
        { field: 'CD_CATEGORIA', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'NM_GRUPO', header: 'Grupo', editable: false },
        { field: 'CODIGO', header: 'Código', editable: false },
        { field: 'NOME', header: 'Nome', editable: false },
        { field: 'ORDEM', header: 'Ordem', editable: false, width: '88px', align: 'right' },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '100px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'produto') {
      var codigoFmt = function (val, row) {
        return applyProductMask(val || '', row && row.MASCARA_CODIGO_PRODUTO);
      };
      var pesoFmt = function (val) {
        var txt = formatPesoKg(val);
        return txt ? txt + ' kg' : '';
      };
      var conservFmt = function (val) {
        var v = String(val || '').trim().toUpperCase();
        if (v === 'SECO') return 'Ambiente (seco)';
        if (v === 'REFRIGERADO') return 'Refrigerado';
        if (v === 'CONGELADO') return 'Congelado';
        return val || '';
      };
      var categoriaFmt = function (val, row) {
        if (row && row.NM_CATEGORIA) return row.NM_CATEGORIA;
        return val || '';
      };
      return [
        { field: 'CD_PRODUTO', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'NM_DONO', header: 'Dono', editable: false, width: '140px' },
        { field: 'CODIGO', header: 'Código', editable: false, width: '170px', format: codigoFmt },
        { field: 'NOME', header: 'Nome', editable: false },
        { field: 'NM_CATEGORIA', header: 'Categoria', editable: false, width: '150px', format: categoriaFmt },
        {
          field: 'TIPO_ARMAZENAGEM',
          header: 'Conservação',
          editable: false,
          width: '120px',
          format: conservFmt,
        },
        { field: 'UNIDADE', header: 'UM', editable: false, width: '72px' },
        { field: 'PESO_KG', header: 'Peso (kg)', editable: false, width: '110px', align: 'right', format: pesoFmt },
        {
          field: 'FG_FORNECEDOR_REF',
          header: 'Forn.',
          editable: false,
          width: '70px',
          align: 'center',
          format: function (val) {
            return String(val || 'N').toUpperCase() === 'S' ? 'S' : '';
          },
        },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '100px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'depara') {
      return [
        { field: 'CD_DEPARA', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'NM_DONO', header: 'Dono', editable: false },
        { field: 'CODIGO_EXTERNO', header: 'Cód. externo', editable: false },
        { field: 'CODIGO_INTERNO', header: 'Cód. interno', editable: false },
        { field: 'FATOR_CONVERSAO', header: 'Fator', editable: false, width: '140px', align: 'right' },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '100px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    if (entity === 'operacional') {
      var unOpFmt = function (val, row) {
        var v = val != null ? String(val).trim() : '';
        if (v) return v;
        var sug = row && row.UNIDADE_SUGERIDA ? String(row.UNIDADE_SUGERIDA).trim() : '';
        if (sug) return '<span style="color:#b45309" title="Sugestão automática (ainda não gravada)">(' + sug + ')</span>';
        return '<span style="color:#dc2626;font-weight:600">—</span>';
      };
      return [
        { field: 'CD_OPERACIONAL', header: 'ID', editable: false, isId: true, width: '64px' },
        { field: 'NM_DONO', header: 'Dono', editable: false, width: '120px' },
        { field: 'CODIGO_OPERACIONAL', header: 'Cód. OL', editable: false, width: '120px' },
        { field: 'CODIGO_ESTOQUE', header: 'Cód. estoque', editable: false, width: '130px' },
        { field: 'NM_PRODUTO', header: 'Produto', editable: false },
        { field: 'UNIDADE', header: 'UM OL', editable: false, width: '72px', format: unOpFmt },
        { field: 'UNIDADE_ESTOQUE', header: 'UM est.', editable: false, width: '72px' },
        { field: 'FATOR_CONVERSAO', header: 'Fator', editable: false, width: '80px', align: 'right' },
        {
          field: 'FGACTIVE',
          header: 'Situação',
          editable: false,
          width: '96px',
          align: 'right',
          format: fgFmt,
        },
      ];
    }
    return [
      { field: 'CD_DOCA', header: 'ID', editable: false, isId: true, width: '72px' },
      { field: 'NM_ARMAZEM', header: 'Armazém', editable: false },
      { field: 'CODIGO', header: 'Código', editable: false },
      { field: 'NOME', header: 'Nome', editable: false },
      { field: 'FG_RECEBE', header: 'Rec.', editable: false, width: '64px', align: 'right' },
      { field: 'FG_EXPEDE', header: 'Exp.', editable: false, width: '64px', align: 'right' },
      {
        field: 'FGACTIVE',
        header: 'Situação',
        editable: false,
        width: '100px',
        align: 'right',
        format: fgFmt,
      },
    ];
  }

  function disposeGrid() {
    var el = document.getElementById('wmsCadGrid');
    if (el) el.innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
    gridTab = null;
  }

  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') return;
    var host = document.getElementById('wmsCadGrid');
    if (!host) return;
    host.innerHTML = '';
    gridTab = new window.GridEditor({
      container: '#wmsCadGrid',
      columns: buildColumns(),
      actionsWidth: '76px',
      apiEndpoint: '/api/wms',
      buildFetchHeaders: function () {
        return getAuthHeaders();
      },
      autoSave: false,
      onBeforeEdit: function (id) {
        var idf = getIdField();
        var row = (lastRows || []).find(function (r) {
          return String(r[idf]) === String(id);
        });
        if (row) openEdit(row);
        return Promise.resolve(false);
      },
      onDelete: function () {
        showMessage(
          t('web.modulos.wmsCadastros.msgSemExclusao', 'Use a aba Dados (Editar) para alterar situação Ativo/Inativo.'),
          'info'
        );
        return Promise.resolve();
      },
    });
  }

  function getAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = localStorage.getItem('token');
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return headers;
  }

  function renderFiltroFields() {
    var host = document.getElementById('filtroGridCampos');
    if (!host) return;
    var h = '';
    if (entity === 'dono') {
      h =
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'armazem') {
      h =
        '<div><label for="filtro_cd_dono">Dono</label><select id="filtro_cd_dono" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'area' || entity === 'doca') {
      h =
        '<div><label for="filtro_cd_armazem">Armazém</label><select id="filtro_cd_armazem" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'grupo') {
      h =
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'categoria') {
      h =
        '<div><label for="filtro_cd_grupo">Grupo</label><select id="filtro_cd_grupo" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'produto') {
      h =
        '<div><label for="filtro_cd_dono">Dono</label><select id="filtro_cd_dono" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_cd_produto">ID produto</label><input type="number" id="filtro_cd_produto" class="form-control" min="1" step="1" placeholder="Ex.: 12126" title="CD_PRODUTO — o número da coluna ID no grid e nas pendências." /></div>' +
        '<div><label for="filtro_cd_categoria">Categoria</label><select id="filtro_cd_categoria" class="form-control"><option value="">Todas</option></select></div>' +
        '<div><label for="filtro_tipo_armazenagem">Conservação do produto</label><select id="filtro_tipo_armazenagem" class="form-control" title="Mesmos valores do cadastro do produto (TIPO_ARMAZENAGEM)"><option value="">Todas</option><option value="SECO">Ambiente (seco)</option><option value="REFRIGERADO">Refrigerado</option><option value="CONGELADO">Congelado</option></select></div>' +
        '<div><label for="filtro_peso_status">Peso</label><select id="filtro_peso_status" class="form-control"><option value="">Todos</option><option value="sem">Sem peso</option><option value="com">Com peso</option></select></div>' +
        '<div><label for="filtro_codigo">Código</label><input type="text" id="filtro_codigo" class="form-control" placeholder="Com ou sem pontos (ex. 60301)" title="Busca pelo trecho do código mascarado ou só pelos dígitos/letras." /></div>' +
        '<div><label for="filtro_nome">Nome</label><input type="text" id="filtro_nome" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>' +
        '<div style="justify-content:end;"><label style="margin-bottom:0;" title="Inclui SKUs marcados como referência de fornecedor (FG_FORNECEDOR_REF=S). Sem isso o grid e o romaneio ignoram esses códigos — aparece «Sem grupo — Sem categoria» na impressão."><input type="checkbox" id="filtro_mostrar_fornecedor" /> Mostrar produtos de fornecedor <span class="hint" style="font-weight:400">(senão somem do grid/romaneio)</span></label></div>';
    } else if (entity === 'depara') {
      h =
        '<div><label for="filtro_cd_dono">Dono</label><select id="filtro_cd_dono" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_cext">Código externo</label><input type="text" id="filtro_cext" class="form-control" placeholder="NF / fornecedor (ex. 113)" title="Código da NF ou fornecedor; busca parcial." /></div>' +
        '<div><label for="filtro_cint">Código interno</label><input type="text" id="filtro_cint" class="form-control" placeholder="Com ou sem pontos (ex. 6030425600)" title="Código de estoque; aceita máscara 6.03.04.256.00 ou só dígitos 6030425600." /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
    } else if (entity === 'operacional') {
      h =
        '<div><label for="filtro_cd_dono">Dono</label><select id="filtro_cd_dono" class="form-control"><option value="">Todos</option></select></div>' +
        '<div><label for="filtro_codigo_ol">Código OL (espelho)</label><input type="text" id="filtro_codigo_ol" class="form-control" placeholder="ex. 6060395601" title="Código do espelho de separação / catálogo OL." /></div>' +
        '<div><label for="filtro_codigo_estoque">Código estoque</label><input type="text" id="filtro_codigo_estoque" class="form-control" placeholder="Com ou sem pontos" /></div>' +
        '<div><label for="filtro_nome">Nome produto</label><input type="text" id="filtro_nome" class="form-control" placeholder="Contém…" /></div>' +
        '<div><label for="filtro_fgactive">Situação</label><select id="filtro_fgactive" class="form-control"><option value="">Todas</option><option value="S">Ativo</option><option value="N">Inativo</option></select></div>' +
        '<div style="justify-content:end;"><label style="margin-bottom:0;"><input type="checkbox" id="filtro_sem_unidade" /> Somente sem UM operacional</label></div>';
    }
    host.innerHTML = h;
    if (entity === 'armazem' || entity === 'produto' || entity === 'depara' || entity === 'operacional') {
      fillDonoSelect(
        document.getElementById('filtro_cd_dono'),
        entity === 'produto' ? '— Selecione —' : 'Todos',
        function () {
          if (entity === 'produto') restoreLastDonoProduto();
        }
      );
    }
    if (entity === 'categoria') {
      fillGrupoSelect(document.getElementById('filtro_cd_grupo'), 'Todos');
      var fgCat = document.getElementById('filtro_fgactive');
      if (fgCat) fgCat.value = 'S';
    }
    if (entity === 'produto') fillCategoriaSelect(document.getElementById('filtro_cd_categoria'), 'Todas');
    if (entity === 'area' || entity === 'doca') fillArmazemSelect(document.getElementById('filtro_cd_armazem'), 'Todos');
  }

  function wrapFormCard(title, icon, inner) {
    return (
      '<div class="form-dados-card">' +
      '<div class="form-dados-card-header"><i class="bx ' +
      icon +
      '"></i> ' +
      title +
      '</div>' +
      '<div class="form-dados-card-body"><div class="filtros-grid">' +
      inner +
      '</div></div></div>'
    );
  }

  function renderFormHost() {
    var host = document.getElementById('formCamposHost');
    if (!host) return;
    var inner = '';
    if (entity === 'dono') {
      inner =
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="160" required /></div>' +
        '<div><label for="form_cgc">CNPJ (opcional)</label><input type="text" id="form_cgc" class="form-control" maxlength="18" /></div>' +
        '<div><label for="form_mascara_codigo_produto">Máscara cód. produto</label><input type="text" id="form_mascara_codigo_produto" class="form-control" maxlength="40" placeholder="ex.: 0.00.00.000.00" /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      var innerPol =
        '<div style="grid-column:1/-1" class="hint">Parâmetros usados pelo relatório diário de vencimento e, em breve, pela validação de recebimento (conferência NF-e).</div>' +
        '<div><label for="form_nu_dias_rel_vencimento">Relatório vencimento — próximos (dias)</label>' +
        '<input type="number" id="form_nu_dias_rel_vencimento" class="form-control" min="1" max="1095" step="1" value="60" title="Lista enviada ao dono: itens com validade dentro desta janela." /></div>' +
        '<div><label for="form_nu_dias_min_valid_receb">Recebimento — vida mínima (dias)</label>' +
        '<input type="number" id="form_nu_dias_min_valid_receb" class="form-control" min="1" max="1095" step="1" value="90" title="Recusar mercadoria com validade antes de hoje + N dias (liberação supervisionada será tratada na conferência)." /></div>';
      var innerCobArm =
        '<div style="grid-column:1/-1" class="hint">Percentual aplicado sobre o <strong>valor R$</strong> do estoque (pico do período) no módulo Valor de estoque / Cobrança operacional. Não usa peso.</div>' +
        '<div><label for="form_pct_cobranca_estoque">% cobrança armazenagem (valor estoque)</label>' +
        '<input type="number" id="form_pct_cobranca_estoque" class="form-control" min="0" max="100" step="0.0001" placeholder="ex.: 7" title="Ex.: 7 = 7% sobre o pico de valor no período." /></div>';
      var innerCobExp =
        '<div style="grid-column:1/-1" class="hint">Percentual sobre o <strong>valor R$</strong> das NF-e expedidas (vNF) com saída confirmada no período. Não usa peso.</div>' +
        '<div><label for="form_pct_cobranca_expedicao">% cobrança expedição (valor NF)</label>' +
        '<input type="number" id="form_pct_cobranca_expedicao" class="form-control" min="0" max="100" step="0.0001" placeholder="ex.: 1.5" title="Ex.: 1.5 = 1,5% sobre o valor das notas expedidas." /></div>';
      host.innerHTML =
        wrapFormCard('Identificação', 'bx-package', inner) +
        wrapFormCard('Políticas de validade / relatório', 'bx-calendar-check', innerPol) +
        wrapFormCard('Cobrança armazenagem (% sobre valor)', 'bx-money', innerCobArm) +
        wrapFormCard('Cobrança expedição (% sobre NF)', 'bx-export', innerCobExp);
      bindCnpjMask();
    } else if (entity === 'armazem') {
      inner =
        '<div><label for="form_cd_dono">Dono *</label><select id="form_cd_dono" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="160" required /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Armazém', 'bx-building', inner);
      fillDonoSelect(document.getElementById('form_cd_dono'), 'Selecione…');
    } else if (entity === 'area') {
      inner =
        '<div><label for="form_cd_armazem">Armazém *</label><select id="form_cd_armazem" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="160" required /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Área', 'bx-grid-alt', inner);
      fillArmazemSelect(document.getElementById('form_cd_armazem'), 'Selecione…');
    } else if (entity === 'doca') {
      inner =
        '<div><label for="form_cd_armazem">Armazém *</label><select id="form_cd_armazem" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="160" required /></div>' +
        '<div><label for="form_fg_recebe">Recebe</label><select id="form_fg_recebe" class="form-control"><option value="S">Sim</option><option value="N">Não</option></select></div>' +
        '<div><label for="form_fg_expede">Expede</label><select id="form_fg_expede" class="form-control"><option value="S">Sim</option><option value="N">Não</option></select></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Doca', 'bx-log-in', inner);
      fillArmazemSelect(document.getElementById('form_cd_armazem'), 'Selecione…');
    } else if (entity === 'grupo') {
      inner =
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="120" required /></div>' +
        '<div><label for="form_ordem">Ordem</label><input type="number" id="form_ordem" class="form-control" value="0" /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Grupo de produto', 'bx-category', inner);
    } else if (entity === 'categoria') {
      inner =
        '<div><label for="form_cd_grupo">Grupo *</label><select id="form_cd_grupo" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo">Código *</label><input type="text" id="form_codigo" class="form-control" maxlength="32" required /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="120" required /></div>' +
        '<div><label for="form_ordem">Ordem</label><input type="number" id="form_ordem" class="form-control" value="0" /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Categoria de produto', 'bx-label', inner);
      fillGrupoSelect(document.getElementById('form_cd_grupo'), 'Selecione…');
    } else if (entity === 'produto') {
      inner =
        '<div><label for="form_cd_dono">Dono *</label><select id="form_cd_dono" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_cd_categoria">Categoria</label><select id="form_cd_categoria" class="form-control"><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo">Código produto *</label><input type="text" id="form_codigo" class="form-control" maxlength="128" required placeholder="ex.: 6.03.04.016.20" /></div>' +
        '<div><label for="form_nome">Nome *</label><input type="text" id="form_nome" class="form-control" maxlength="200" required /></div>' +
        '<div><label for="form_unidade">Unidade (UM)</label><input type="text" id="form_unidade" class="form-control" maxlength="10" placeholder="ex.: UN, CX, KG" /></div>' +
        '<div><label for="form_peso_kg">Peso unitário (kg)</label><input type="text" id="form_peso_kg" class="form-control" inputmode="decimal" placeholder="ex.: 1,250" /></div>' +
        '<div><label for="form_valor_referencia">Valor referência (R$)</label><input type="text" id="form_valor_referencia" class="form-control" inputmode="decimal" placeholder="ex.: 12,50" title="Usado no Valor de estoque quando não há preço na última NF entrada" /></div>' +
        '<div><label for="form_cod_barras">Código de barras</label><input type="text" id="form_cod_barras" class="form-control" maxlength="32" /></div>' +
        '<div><label for="form_ncm">NCM</label><input type="text" id="form_ncm" class="form-control" maxlength="8" /></div>' +
        '<div><label for="form_tipo_armazenagem">Conservação do produto</label><select id="form_tipo_armazenagem" class="form-control"><option value="">Selecione…</option><option value="SECO">Ambiente (seco)</option><option value="REFRIGERADO">Refrigerado</option><option value="CONGELADO">Congelado</option></select></div>' +
        '<div><label for="form_fg_descartavel">Descartável</label><select id="form_fg_descartavel" class="form-control"><option value="N">Não</option><option value="S">Sim</option></select></div>' +
        '<div><label for="form_fg_controla_lote">Controla lote</label><select id="form_fg_controla_lote" class="form-control"><option value="N">Não</option><option value="S">Sim</option></select></div>' +
        '<div><label for="form_fg_controla_validade">Controla validade</label><select id="form_fg_controla_validade" class="form-control"><option value="N">Não</option><option value="S">Sim</option></select></div>' +
        '<div><label for="form_fg_fornecedor_ref" title="S = só referência de fornecedor (some do grid/romaneio padrão). N = produto de estoque do dono.">Ref. fornecedor</label><select id="form_fg_fornecedor_ref" class="form-control"><option value="N">Não (estoque do dono)</option><option value="S">Sim (some do grid/romaneio)</option></select></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Produto (dono do estoque)', 'bx-barcode', inner);
      fillDonoSelect(document.getElementById('form_cd_dono'), 'Selecione…');
      fillCategoriaSelect(document.getElementById('form_cd_categoria'), 'Selecione…');
      bindProdutoCodigoMask({ skipInitialApply: true });
      bindProdutoRegraValidadePorGrupo();
    } else if (entity === 'depara') {
      inner =
        '<div><label for="form_cd_dono">Dono *</label><select id="form_cd_dono" class="form-control" required><option value="">Selecione…</option></select></div>' +
        '<div><label for="form_codigo_externo">Código externo (NF/fornecedor) *</label><input type="text" id="form_codigo_externo" class="form-control" maxlength="64" required /></div>' +
        '<div><label for="form_codigo_interno">Código interno (dono / máscara) *</label><input type="text" id="form_codigo_interno" class="form-control" maxlength="128" required placeholder="ex.: 6.03.04.016.20" /></div>' +
        '<div><label for="form_fator">Fator conversão *</label><input type="text" id="form_fator" class="form-control" value="1" inputmode="decimal" required /></div>' +
        '<div><label for="form_obs">Observação</label><input type="text" id="form_obs" class="form-control" maxlength="255" /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('De-para produto', 'bx-transfer', inner);
    } else if (entity === 'operacional') {
      inner =
        '<div style="grid-column:1/-1" class="hint">Vínculo do <strong>espelho OPL</strong> (código OL) com o produto de estoque. A <strong>UM OL</strong> é a unidade impressa no romaneio de separação. Cadastro vem da importação da planilha OL; aqui você corrige UM e fator.</div>' +
        '<div><label>Código OL</label><input type="text" id="form_codigo_operacional" class="form-control" readonly /></div>' +
        '<div><label>Código estoque</label><input type="text" id="form_codigo_estoque" class="form-control" readonly /></div>' +
        '<div style="grid-column:1/-1"><label>Produto</label><input type="text" id="form_nome_produto" class="form-control" readonly /></div>' +
        '<div><label>UM estoque</label><input type="text" id="form_unidade_estoque" class="form-control" readonly /></div>' +
        '<div><label for="form_unidade_ol">UM operacional (OL) *</label><input type="text" id="form_unidade_ol" class="form-control" maxlength="10" required placeholder="ex.: CX, PC, PCT" title="Unidade usada no espelho de separação" /></div>' +
        '<div><label for="form_fator">Fator conversão *</label><input type="text" id="form_fator" class="form-control" required placeholder="ex.: 22" title="Quantas unidades de estoque em 1 UM OL" /></div>' +
        '<div><label for="form_fgactive">Situação</label><select id="form_fgactive" class="form-control"><option value="S">Ativo</option><option value="N">Inativo</option></select></div>';
      host.innerHTML = wrapFormCard('Catálogo OL — vínculo operacional', 'bx-link', inner);
    }
  }

  function fillDonoSelect(sel, emptyLabel, done) {
    if (!sel) return;
    var v = sel.value;
    fetch('/api/wms/donos-estoque', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (rows && rows.error) throw new Error(rows.error);
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = emptyLabel || '—';
        sel.appendChild(o0);
        (rows || []).forEach(function (d) {
          var o = document.createElement('option');
          o.value = String(d.CD_DONO);
          o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
          o.setAttribute('data-mask', d.MASCARA_CODIGO_PRODUTO || '');
          sel.appendChild(o);
        });
        if (v && Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) sel.value = v;
        if (typeof done === 'function') done();
      })
      .catch(function () {
        if (typeof done === 'function') done();
      });
  }

  function fillArmazemSelect(sel, emptyLabel, done) {
    if (!sel) return;
    var v = sel.value;
    fetch('/api/wms/armazens', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (rows && rows.error) throw new Error(rows.error);
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = emptyLabel || '—';
        sel.appendChild(o0);
        (rows || []).forEach(function (a) {
          var o = document.createElement('option');
          o.value = String(a.CD_ARMAZEM);
          o.textContent = (a.CODIGO || '') + ' — ' + (a.NOME || '') + ' (' + (a.NM_DONO || '') + ')';
          sel.appendChild(o);
        });
        if (v && Array.prototype.some.call(sel.options, function (x) { return x.value === v; })) sel.value = v;
        if (typeof done === 'function') done();
      })
      .catch(function () {
        if (typeof done === 'function') done();
      });
  }

  function fillGrupoSelect(sel, emptyLabel, done) {
    if (!sel) return;
    var v = sel.value;
    fetch('/api/wms/grupos-produto?fgactive=S', { headers: getAuthHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (rows && rows.error) throw new Error(rows.error);
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = emptyLabel || '—';
        sel.appendChild(o0);
        (rows || []).forEach(function (g) {
          var o = document.createElement('option');
          o.value = String(g.CD_GRUPO);
          o.textContent = (g.CODIGO || '') + ' — ' + (g.NOME || '');
          sel.appendChild(o);
        });
        if (v && Array.prototype.some.call(sel.options, function (x) { return x.value === v; })) sel.value = v;
        if (typeof done === 'function') done();
      })
      .catch(function () { if (typeof done === 'function') done(); });
  }

  function fillCategoriaSelect(sel, emptyLabel, done, cdGrupo) {
    if (!sel) return;
    var v = sel.value;
    var q = new URLSearchParams({ fgactive: 'S' });
    if (cdGrupo) q.append('cdGrupo', String(cdGrupo));
    fetch('/api/wms/categorias-produto?' + q.toString(), { headers: getAuthHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (rows && rows.error) throw new Error(rows.error);
        populateCategoriaSelectOptions(sel, rows, v, emptyLabel);
        if (typeof done === 'function') done();
      })
      .catch(function () { if (typeof done === 'function') done(); });
  }

  function populateCategoriaSelectOptions(sel, rows, selectedId, emptyLabel) {
    if (!sel) return;
    sel.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = emptyLabel || 'Selecione…';
    sel.appendChild(o0);
    (rows || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = String(c.CD_CATEGORIA);
      var grp = c.NM_GRUPO ? ' (' + c.NM_GRUPO + ')' : '';
      o.textContent = (c.CODIGO || '') + ' — ' + (c.NOME || '') + grp;
      o.setAttribute('data-cd-grupo', c.CD_GRUPO != null ? String(c.CD_GRUPO) : '');
      o.setAttribute('data-grupo-codigo', c.CD_GRUPO_CODIGO != null ? String(c.CD_GRUPO_CODIGO) : '');
      sel.appendChild(o);
    });
    var v = selectedId != null && String(selectedId).trim() !== '' ? String(selectedId) : '';
    if (v && Array.prototype.some.call(sel.options, function (x) { return x.value === v; })) sel.value = v;
  }

  /** Grupos WMS: 601–607 obrigam validade; 621/631/632/651/652 não. */
  var GRUPOS_VALIDADE_S = { '601': 1, '602': 1, '603': 1, '604': 1, '605': 1, '606': 1, '607': 1 };
  var GRUPOS_VALIDADE_N = { '621': 1, '631': 1, '632': 1, '651': 1, '652': 1 };
  var PREFIXO_SKU_PARA_GRUPO = {
    '01': '601', '02': '602', '03': '603', '04': '604', '05': '605', '06': '606', '07': '607',
    '21': '621', '31': '631', '32': '632', '51': '651', '52': '652',
  };

  function normalizarCodigoGrupoUi(raw) {
    var dig = String(raw || '').replace(/\D/g, '');
    if (dig.length >= 3) return dig.slice(0, 3);
    if (dig.length === 2 && PREFIXO_SKU_PARA_GRUPO[dig]) return PREFIXO_SKU_PARA_GRUPO[dig];
    return dig;
  }

  function grupoCodigoFromSkuUi(codigo) {
    var m = String(codigo || '').trim().match(/^6\.(\d{2})\./);
    if (!m) return '';
    return PREFIXO_SKU_PARA_GRUPO[m[1]] || '';
  }

  function fgValidadePorGrupoUi(codigoGrupo) {
    var g = normalizarCodigoGrupoUi(codigoGrupo);
    if (GRUPOS_VALIDADE_S[g]) return 'S';
    if (GRUPOS_VALIDADE_N[g]) return 'N';
    return null;
  }

  function aplicarRegraValidadeProdutoForm() {
    var valEl = document.getElementById('form_fg_controla_validade');
    if (!valEl) return;
    var catEl = document.getElementById('form_cd_categoria');
    var codEl = document.getElementById('form_codigo');
    var grupoCod = '';
    if (catEl && catEl.selectedIndex >= 0) {
      var opt = catEl.options[catEl.selectedIndex];
      if (opt) grupoCod = opt.getAttribute('data-grupo-codigo') || '';
    }
    var regra = fgValidadePorGrupoUi(grupoCod);
    if (!regra) regra = fgValidadePorGrupoUi(grupoCodigoFromSkuUi(codEl ? codEl.value : ''));
    if (regra === 'S' || regra === 'N') valEl.value = regra;
  }

  function bindProdutoRegraValidadePorGrupo() {
    var catEl = document.getElementById('form_cd_categoria');
    var codEl = document.getElementById('form_codigo');
    if (catEl && !catEl._bindValidadeGrupo) {
      catEl._bindValidadeGrupo = true;
      catEl.addEventListener('change', aplicarRegraValidadeProdutoForm);
    }
    if (codEl && !codEl._bindValidadeGrupo) {
      codEl._bindValidadeGrupo = true;
      codEl.addEventListener('blur', aplicarRegraValidadeProdutoForm);
      codEl.addEventListener('change', aplicarRegraValidadeProdutoForm);
    }
    aplicarRegraValidadeProdutoForm();
  }

  function createConservacaoSelectPendencia(tipo) {
    var sel = document.createElement('select');
    sel.className = 'form-control pend-cons';
    var t = String(tipo || '').toUpperCase();
    [
      ['', 'Selecione…'],
      ['SECO', 'Ambiente (seco)'],
      ['REFRIGERADO', 'Refrigerado'],
      ['CONGELADO', 'Congelado'],
    ].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      if (pair[0] && pair[0] === t) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function createCategoriaSelectPendencia(cdCategoria) {
    var sel = document.createElement('select');
    sel.className = 'form-control pend-cat';
    populateCategoriaSelectOptions(sel, pendenciasCategoriasCache, cdCategoria, 'Selecione…');
    return sel;
  }

  function toggleProdutoImportUI() {
    var isProduto = entity === 'produto';
    var isOperacional = entity === 'operacional';
    var b1 = document.getElementById('btnImportarProdutos');
    var b2 = document.getElementById('btnImportarProdutosGrid');
    var b3 = document.getElementById('btnSugestoesCategoriaGrid');
    var b4 = document.getElementById('btnPendenciasCadastroGrid');
    var b5 = document.getElementById('btnClassificacaoOlGrid');
    var bUm1 = document.getElementById('btnPreencherUmOperacional');
    var bUm2 = document.getElementById('btnPreencherUmOperacionalGrid');
    var bNovo1 = document.getElementById('btnNovoRegistro');
    var bNovo2 = document.getElementById('btnNovoRegistroGrid');
    var panel = document.getElementById('produtoImportPanel');
    var modalSug = document.getElementById('sugCategoriasModal');
    var modalCad = document.getElementById('wmsCadastrosModal');
    if (b1) b1.style.display = isProduto ? 'inline-flex' : 'none';
    if (b2) b2.style.display = isProduto ? 'inline-flex' : 'none';
    if (b3) b3.style.display = isProduto ? 'inline-flex' : 'none';
    if (b4) b4.style.display = isProduto ? 'inline-flex' : 'none';
    if (b5) b5.style.display = isProduto ? 'inline-flex' : 'none';
    if (bUm1) bUm1.style.display = isOperacional ? 'inline-flex' : 'none';
    if (bUm2) bUm2.style.display = isOperacional ? 'inline-flex' : 'none';
    if (bNovo1) bNovo1.style.display = isOperacional ? 'none' : 'inline-flex';
    if (bNovo2) bNovo2.style.display = isOperacional ? 'none' : 'inline-flex';
    if (panel) panel.style.display = isProduto ? 'block' : 'none';
    if (!isProduto) {
      if (modalSug) fecharModalSugestoesCategoria();
      if (modalCad) fecharModalCadastrosWms();
    }
    if (isProduto) {
      fillDonoSelect(document.getElementById('import_prod_cd_dono'), 'Selecione…', function () {
        restoreLastDonoProduto();
        syncDonoProdutoFiltroImport('filtro');
      });
    }
  }

  var sugestoesCategoriaMeta = null;
  var olClassPreviewRows = [];
  var olClassPreviewFile = null;

  function fecharModalCadastrosWms() {
    var modal = document.getElementById('wmsCadastrosModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function abrirModalCadastrosWms(tab) {
    var modal = document.getElementById('wmsCadastrosModal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    trocarTabModalCadastros(tab || 'pendencias');
  }

  function trocarTabModalCadastros(tab) {
    var t = tab === 'ol' ? 'ol' : 'pendencias';
    document.querySelectorAll('.wms-cad-modal-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-wms-cad-tab') === t);
    });
    var p1 = document.getElementById('wmsCadTabPendencias');
    var p2 = document.getElementById('wmsCadTabOl');
    var tit = document.getElementById('wmsCadModalTitulo');
    if (p1) p1.style.display = t === 'pendencias' ? 'block' : 'none';
    if (p2) p2.style.display = t === 'ol' ? 'block' : 'none';
    if (tit) tit.textContent = t === 'ol' ? 'Revisão classificação OL' : 'Pendências de cadastro';
    if (t === 'pendencias') carregarPendenciasCadastro().catch(function () {});
  }

  function badgeConservacao(tipo) {
    var t = String(tipo || '').toUpperCase() || '—';
    if (t === 'SECO' || t === 'REFRIGERADO' || t === 'CONGELADO') {
      return '<span class="cons-badge cons-' + t + '">' + t + '</span>';
    }
    return '<span class="cons-badge">' + t + '</span>';
  }

  var pendenciasCategoriasCache = null;
  var pendenciasResumoAtual = {};
  var sugestoesCategoriaPorProduto = {};

  function motivoPrecisaCategoria(motivo) {
    return String(motivo || '').indexOf('sem_categoria') >= 0;
  }

  function motivoPrecisaConservacao(motivo) {
    return String(motivo || '').indexOf('sem_conservacao') >= 0;
  }

  function escPendHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  async function ensurePendenciasCategoriasCache() {
    if (pendenciasCategoriasCache) return pendenciasCategoriasCache;
    var r = await fetch('/api/wms/categorias-produto?fgactive=S', { headers: getAuthHeaders() });
    var j = await r.json();
    if (!r.ok) throw new Error((j && j.error) || 'Erro ao carregar categorias.');
    pendenciasCategoriasCache = Array.isArray(j) ? j : [];
    return pendenciasCategoriasCache;
  }

  async function carregarSugestoesParaPendencias(rows) {
    sugestoesCategoriaPorProduto = {};
    var arr = Array.isArray(rows) ? rows : [];
    var donos = [];
    arr.forEach(function (r) {
      var d = String(r.CD_DONO);
      if (donos.indexOf(d) < 0) donos.push(d);
    });
    await Promise.all(
      donos.map(function (cdDono) {
        var q = new URLSearchParams({ cdDono: cdDono, modo: 'todos', limit: '500' });
        return fetch('/api/wms/produtos-dono/sugestoes-categoria?' + q.toString(), { headers: getAuthHeaders() })
          .then(function (resp) {
            return resp.json().then(function (j) {
              if (!resp.ok) return;
              var lista = (j && j.rows) || [];
              lista.forEach(function (s) {
                if (s.CD_PRODUTO != null) sugestoesCategoriaPorProduto[String(s.CD_PRODUTO)] = s;
              });
            });
          })
          .catch(function () {});
      })
    );
  }

  function hydratePendenciasEditorCells() {
    var body = document.getElementById('wmsPendenciasBody');
    if (!body) return;
    body.querySelectorAll('td.pend-col-cat').forEach(function (td) {
      var tr = td.closest('tr');
      var cdProd = tr && tr.getAttribute('data-cd-produto');
      var sug = cdProd && sugestoesCategoriaPorProduto[cdProd];
      var cdCat = td.getAttribute('data-cd-cat') || (sug && sug.CD_CATEGORIA_SUGERIDA != null ? String(sug.CD_CATEGORIA_SUGERIDA) : '');
      td.innerHTML = '';
      td.appendChild(createCategoriaSelectPendencia(cdCat));
    });
    body.querySelectorAll('td.pend-col-cons').forEach(function (td) {
      td.innerHTML = '';
      td.appendChild(createConservacaoSelectPendencia(td.getAttribute('data-cons') || ''));
    });
  }

  function atualizarResumoPendenciasLocal(qtdLinhas) {
    var res = document.getElementById('wmsPendenciasResumo');
    if (!res || !pendenciasResumoAtual) return;
    res.textContent =
      'Total operacional: ' +
      String(pendenciasResumoAtual.total_operacional || 0) +
      ' | Sem categoria: ' +
      String(pendenciasResumoAtual.sem_categoria || 0) +
      ' | Sem conservação: ' +
      String(pendenciasResumoAtual.sem_conservacao || 0) +
      ' | Pendente: ' +
      String(pendenciasResumoAtual.pendente || 0) +
      ' — exibindo ' +
      qtdLinhas +
      ' linha(s).';
  }

  async function salvarLinhaPendencia(tr, opts) {
    if (!tr) return false;
    var cdProduto = tr.getAttribute('data-cd-produto');
    var motivo = tr.getAttribute('data-motivo') || '';
    var body = {};
    var selCat = tr.querySelector('.pend-cat');
    var selCons = tr.querySelector('.pend-cons');
    if (motivoPrecisaCategoria(motivo)) {
      var cdCat = selCat ? selCat.value : '';
      if (!cdCat) {
        if (!opts || !opts.silencioso) showMessage('Selecione a categoria do produto ' + (tr.getAttribute('data-codigo') || '') + '.', 'warning');
        return false;
      }
      body.CD_CATEGORIA = parseInt(cdCat, 10);
    }
    if (motivoPrecisaConservacao(motivo)) {
      var cons = selCons ? selCons.value : '';
      if (!cons) {
        if (!opts || !opts.silencioso) showMessage('Selecione a conservação do produto ' + (tr.getAttribute('data-codigo') || '') + '.', 'warning');
        return false;
      }
      body.TIPO_ARMAZENAGEM = cons;
    }
    if (!Object.keys(body).length) return false;
    var btn = tr.querySelector('.btn-pend-salvar');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i>';
    }
    try {
      var r = await fetch('/api/wms/produtos-dono/' + encodeURIComponent(cdProduto) + '/cadastro-operacional', {
        method: 'PATCH',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro ao salvar.');
      var codigoSalvo = tr.getAttribute('data-codigo') || '';
      tr.remove();
      var bodyEl = document.getElementById('wmsPendenciasBody');
      var restantes = bodyEl ? bodyEl.querySelectorAll('tr[data-cd-produto]').length : 0;
      if (!restantes && bodyEl) {
        bodyEl.innerHTML =
          '<tr><td colspan="8" style="text-align:center;color:#64748b">Nenhuma pendência para o filtro atual.</td></tr>';
      }
      atualizarResumoPendenciasLocal(restantes);
      if (!opts || !opts.silencioso) showMessage('Produto ' + codigoSalvo + ' atualizado.', 'success');
      return true;
    } catch (e) {
      if (!opts || !opts.silencioso) showMessage(e.message || 'Erro ao salvar linha.', 'error');
      return false;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bx bx-save"></i> Salvar';
      }
    }
  }

  function bindPendenciasEditorEvents() {
    var body = document.getElementById('wmsPendenciasBody');
    if (!body) return;
    body.querySelectorAll('.btn-pend-salvar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        salvarLinhaPendencia(tr);
      });
    });
  }

  function renderPendenciasRows(rows, resumo) {
    var body = document.getElementById('wmsPendenciasBody');
    var res = document.getElementById('wmsPendenciasResumo');
    if (!body) return;
    var arr = Array.isArray(rows) ? rows : [];
    pendenciasResumoAtual = resumo || {};
    if (res && resumo) {
      atualizarResumoPendenciasLocal(arr.length);
    }
    if (!arr.length) {
      body.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:#64748b">Nenhuma pendência para o filtro atual.</td></tr>';
      return;
    }
    body.innerHTML = arr
      .map(function (r) {
        var motivo = String(r.MOTIVO_PENDENCIA || '');
        var colCons = motivoPrecisaConservacao(motivo)
          ? '<td class="pend-col-cons" data-cons="' + escPendHtml(r.TIPO_ARMAZENAGEM || '') + '"></td>'
          : '<td>' + badgeConservacao(r.TIPO_ARMAZENAGEM) + '</td>';
        var colCat = motivoPrecisaCategoria(motivo)
          ? '<td class="pend-col-cat" data-cd-cat="' + escPendHtml(r.CD_CATEGORIA != null ? r.CD_CATEGORIA : '') + '"></td>'
          : '<td>' +
            (r.NM_CATEGORIA
              ? escPendHtml(String(r.CODIGO_CATEGORIA || '') + ' — ' + r.NM_CATEGORIA)
              : '—') +
            '</td>';
        return (
          '<tr data-cd-produto="' +
          String(r.CD_PRODUTO) +
          '" data-motivo="' +
          escPendHtml(motivo) +
          '" data-codigo="' +
          escPendHtml(r.CODIGO || '') +
          '">' +
          '<td>' +
          String(r.CD_DONO) +
          ' ' +
          escPendHtml(r.NM_DONO || '') +
          '</td>' +
          '<td>' +
          String(r.CD_PRODUTO) +
          '</td>' +
          '<td><code>' +
          escPendHtml(r.CODIGO || '') +
          '</code></td>' +
          '<td class="sug-cat-desc">' +
          escPendHtml(r.NOME || '') +
          '</td>' +
          colCons +
          colCat +
          '<td>' +
          escPendHtml(motivo) +
          '</td>' +
          '<td><button type="button" class="btn-filtro btn-filtro-aplicar btn-pend-salvar" title="Salvar esta linha"><i class="bx bx-save"></i> Salvar</button></td>' +
          '</tr>'
        );
      })
      .join('');
    hydratePendenciasEditorCells();
    bindPendenciasEditorEvents();
  }

  async function carregarPendenciasCadastro() {
    var tipoSel = document.getElementById('pendenciasTipo');
    var dd = document.getElementById('filtro_cd_dono');
    var q = new URLSearchParams();
    q.set('tipo', (tipoSel && tipoSel.value) || 'pendente');
    q.set('limit', '500');
    if (dd && dd.value) q.set('cdDono', dd.value);
    showLoadingOverlay('Pendências', 'Consultando produtos...', 'Categoria e conservação são obrigatórias para operação.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      await ensurePendenciasCategoriasCache();
      var r = await fetch('/api/wms/produtos-dono/pendencias-cadastro?' + q.toString(), { headers: getAuthHeaders() });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro ao carregar pendências.');
      await carregarSugestoesParaPendencias((j && j.rows) || []);
      renderPendenciasRows((j && j.rows) || [], (j && j.resumo) || {});
    } catch (e) {
      showMessage(e.message || 'Erro ao carregar pendências.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function renderOlPreviewRows(rows, resumo, truncado) {
    olClassPreviewRows = Array.isArray(rows) ? rows : [];
    var body = document.getElementById('wmsOlPreviewBody');
    var res = document.getElementById('wmsOlResumo');
    if (res && resumo) {
      var c = resumo.conservacao || {};
      res.textContent =
        'Mapeáveis: ' +
        String(resumo.mapeaveis || 0) +
        ' / nv5: ' +
        String(resumo.totalNv5 || 0) +
        ' | SECO: ' +
        String(c.SECO || 0) +
        ' | REFRIG: ' +
        String(c.REFRIGERADO || 0) +
        ' | CONG: ' +
        String(c.CONGELADO || 0) +
        (truncado ? ' — lista truncada na tela; aplicar usa o arquivo completo.' : '');
    }
    if (!body) return;
    if (!olClassPreviewRows.length) {
      body.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:#64748b">Nenhuma linha mapeável na simulação.</td></tr>';
      return;
    }
    body.innerHTML = olClassPreviewRows
      .map(function (r, idx) {
        var path =
          [r.classeOl, r.grupoOl, r.familiaOl].filter(Boolean).join(' › ') || '—';
        return (
          '<tr>' +
          '<td><input type="checkbox" class="ol-class-chk" data-idx="' +
          idx +
          '" checked /></td>' +
          '<td><code>' +
          String(r.codigoEstoque) +
          '</code></td>' +
          '<td class="sug-cat-desc">' +
          String(r.nomeProduto || '') +
          '</td>' +
          '<td>' +
          badgeConservacao(r.tipoArmazenagem) +
          '</td>' +
          '<td>' +
          String(r.nomeCategoriaWms || '') +
          '</td>' +
          '<td class="sug-cat-desc">' +
          path +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  async function simularClassificacaoOl() {
    var inp = document.getElementById('olClassArquivo');
    if (!inp || !inp.files || !inp.files[0]) {
      showMessage('Selecione o arquivo exportar.xlsx.', 'warning');
      return;
    }
    olClassPreviewFile = inp.files[0];
    var fd = new FormData();
    fd.append('arquivo', olClassPreviewFile);
    showLoadingOverlay('Simular OL', 'Lendo planilha e inferindo categoria + conservação...', 'FRESC/FRESCO e FITA SATURAÇÃO → refrigerado.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var r = await fetch('/api/wms/produtos-dono/classificacao-ol/simular', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro na simulação.');
      renderOlPreviewRows((j && j.rows) || [], (j && j.resumo) || {}, !!j.truncado);
    } catch (e) {
      showMessage(e.message || 'Erro na simulação OL.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function aplicarClassificacaoOl(aplicarTodos) {
    if (!olClassPreviewFile) {
      showMessage('Simule primeiro ou selecione novamente o exportar.xlsx.', 'warning');
      return;
    }
    var codigos = [];
    if (!aplicarTodos) {
      document.querySelectorAll('#wmsOlPreviewBody .ol-class-chk:checked').forEach(function (c) {
        var idx = parseInt(c.getAttribute('data-idx'), 10);
        if (Number.isFinite(idx) && olClassPreviewRows[idx]) {
          codigos.push(olClassPreviewRows[idx].codigoEstoque);
        }
      });
      if (!codigos.length) {
        showMessage('Marque ao menos um item para aplicar.', 'warning');
        return;
      }
    }
    if (
      !window.confirm(
        aplicarTodos
          ? 'Aplicar classificação OL para TODOS os produtos mapeáveis da planilha em todos os donos?'
          : 'Aplicar classificação OL para ' + codigos.length + ' item(ns) selecionado(s)?'
      )
    ) {
      return;
    }
    var fd = new FormData();
    fd.append('arquivo', olClassPreviewFile);
    fd.append('aplicarTodos', aplicarTodos ? 'S' : 'N');
    if (!aplicarTodos) fd.append('codigosEstoque', JSON.stringify(codigos));
    showLoadingOverlay('Aplicar OL', 'Gravando grupos, categorias e conservação...', 'Pode levar alguns minutos.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var r = await fetch('/api/wms/produtos-dono/classificacao-ol/aplicar', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro ao aplicar.');
      var p = (j && j.pendencias) || {};
      showMessage(
        'Classificação aplicada. Linhas atualizadas: ' +
          String((j.classificacao && j.classificacao.linhasEstoqueAtualizadas) || 0) +
          '. Pendências restantes: ' +
          String(p.pendente || 0) +
          '.',
        'success'
      );
      await carregarPendenciasCadastro();
      applyFilters('grid').catch(function () {});
    } catch (e) {
      showMessage(e.message || 'Erro ao aplicar classificação OL.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function abrirModalSugestoesCategoria() {
    var modal = document.getElementById('sugCategoriasModal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function fecharModalSugestoesCategoria() {
    var modal = document.getElementById('sugCategoriasModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function renderSugestoesCategoriaRows(rows, meta) {
    var body = document.getElementById('sugCategoriasBody');
    var resumo = document.getElementById('sugCategoriasResumo');
    if (!body) return;
    var arr = Array.isArray(rows) ? rows : [];
    sugestoesCategoriaRows = arr;
    if (!arr.length) {
      var hint = '';
      if (meta && meta.sem_categoria != null) {
        hint =
          ' Dono: ' +
          String(meta.sem_categoria) +
          ' produto(s) sem categoria' +
          (meta.sem_categoria_sem_conservacao
            ? ' (' + String(meta.sem_categoria_sem_conservacao) + ' sem conservação no cadastro).'
            : '.');
        hint += ' Ajuste o filtro de confiança ou cadastre conservação para refinar pares.';
      }
      body.innerHTML =
        '<tr><td colspan="9" style="text-align:center;color:#64748b">Nenhuma sugestão para os filtros atuais.' +
        hint +
        '</td></tr>';
      if (resumo) resumo.textContent = '0 sugestão(ões).';
      return;
    }
    body.innerHTML = arr
      .map(function (r) {
        var cat = (r.CODIGO_CATEGORIA || '') + ' — ' + (r.NM_CATEGORIA || '') + (r.NM_GRUPO ? ' (' + r.NM_GRUPO + ')' : '');
        return (
          '<tr>' +
          '<td><input type="checkbox" class="sug-cat-chk" data-cd-produto="' + String(r.CD_PRODUTO) + '" data-cd-categoria="' + String(r.CD_CATEGORIA_SUGERIDA) + '" /></td>' +
          '<td>' + String(r.CD_PRODUTO) + '</td>' +
          '<td><code>' + String(r.CODIGO || '') + '</code></td>' +
          '<td class="sug-cat-desc">' + String(r.NOME || '') + '</td>' +
          '<td>' + String(r.TIPO_ARMAZENAGEM || '') + '</td>' +
          '<td>' + cat + '</td>' +
          '<td>' + String(r.SCORE || '') + '</td>' +
          '<td>' + String(r.QTD_EVIDENCIAS || 0) + '</td>' +
          '<td>' + String(r.CONFIANCA || '') + '</td>' +
          '</tr>'
        );
      })
      .join('');
    if (resumo) {
      var altas = arr.filter(function (x) { return String(x.CONFIANCA || '').toLowerCase() === 'alta'; }).length;
      var medias = arr.filter(function (x) { return String(x.CONFIANCA || '').toLowerCase() === 'media'; }).length;
      resumo.textContent = arr.length + ' sugestão(ões) — altas: ' + altas + ', médias: ' + medias + '.';
    }
  }

  async function carregarSugestoesCategoria() {
    var modoSel = document.getElementById('sugCategoriaModo');
    var modo = (modoSel && modoSel.value) || 'todos';
    var dd = document.getElementById('filtro_cd_dono');
    var ta = document.getElementById('filtro_tipo_armazenagem');
    if (!dd || !dd.value) {
      showMessage('Selecione o dono do estoque na aba Filtros antes de carregar sugestões.', 'warning');
      return;
    }
    var q = new URLSearchParams();
    q.set('modo', modo);
    q.set('limit', '250');
    q.set('cdDono', dd.value);
    if (ta && ta.value) q.set('tipoArmazenagem', ta.value);
    showLoadingOverlay('Sugestões de categoria', 'Buscando similares no mesmo dono...', 'Não mistura seco com refrigerado/congelado quando ambos estão definidos.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var fetchTimer = ctrl
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (_) {}
        }, 90000)
      : null;
    try {
      var fetchOpts = { headers: getAuthHeaders() };
      if (ctrl) fetchOpts.signal = ctrl.signal;
      var r = await fetch('/api/wms/produtos-dono/sugestoes-categoria?' + q.toString(), fetchOpts);
      var j = await r.json();
      if (!r.ok) {
        throw new Error(
          (j && j.error) ||
            (r.status === 504
              ? 'A busca demorou demais. Feche e tente de novo com confiança "Altas" ou reinicie o servidor após atualizar o backend.'
              : 'Erro ao carregar sugestões.')
        );
      }
      sugestoesCategoriaMeta = (j && j.meta) || null;
      renderSugestoesCategoriaRows((j && j.rows) || [], sugestoesCategoriaMeta);
    } catch (e) {
      var msg = e && e.name === 'AbortError' ? 'Tempo esgotado ao buscar sugestões. Tente confiança "Altas" ou atualize o backend e reinicie o servidor.' : e.message || 'Erro ao carregar sugestões.';
      showMessage(msg, 'error');
    } finally {
      if (fetchTimer) clearTimeout(fetchTimer);
      hideLoadingOverlay();
    }
  }

  async function executarJobCategoriaLote(dryRun) {
    var dd = document.getElementById('filtro_cd_dono');
    var cdDono = dd && dd.value ? dd.value : '';
    if (!cdDono) {
      showMessage('Selecione o dono do estoque nos Filtros antes do lote automático.', 'warning');
      return;
    }
    var titulo = dryRun ? 'Simular altas' : 'Aplicar altas em lote';
    var detalhe = dryRun
      ? 'Contando sugestões de alta confiança (sem gravar).'
      : 'Gravando categorias de alta confiança para o dono selecionado.';
    showLoadingOverlay(titulo, detalhe, 'Escopo: mesmo dono + mesma conservação (SECO/REFRIGERADO/CONGELADO).');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var r = await fetch('/api/wms/produtos-dono/sugestoes-categoria/job-run', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ cdDono: cdDono, dryRun: !!dryRun }),
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro no lote de categoria.');
      var cons = j.porConservacao;
      var msg =
        (dryRun ? 'Simulação' : 'Lote') +
        ': candidatos ' +
        String(j.candidatos || 0) +
        ', atualizados ' +
        String(j.atualizados || 0) +
        (cons ? ' — por conservação: ' + JSON.stringify(cons) : '');
      showMessage(msg, dryRun ? 'info' : 'success');
      if (!dryRun) {
        await carregarSugestoesCategoria();
        applyFilters('grid').catch(function () {});
      }
    } catch (e) {
      showMessage(e.message || 'Erro no lote de categoria.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function aplicarSugestoesCategoriaSelecionadas() {
    var checks = Array.from(document.querySelectorAll('#sugCategoriasBody .sug-cat-chk:checked'));
    if (!checks.length) {
      showMessage('Marque ao menos uma sugestão para aprovar.', 'warning');
      return;
    }
    var itens = checks.map(function (c) {
      return {
        cdProduto: parseInt(c.getAttribute('data-cd-produto'), 10),
        cdCategoria: parseInt(c.getAttribute('data-cd-categoria'), 10),
      };
    });
    showLoadingOverlay('Aplicando categorias', 'Atualizando produtos selecionados...', 'A validação protege conservação e dono.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var r = await fetch('/api/wms/produtos-dono/sugestoes-categoria/aplicar', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ itens: itens }),
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || 'Erro ao aplicar sugestões.');
      showMessage('Categorias aplicadas: ' + String((j && j.atualizados) || 0) + '.', 'success');
      await carregarSugestoesCategoria();
      applyFilters('grid').catch(function () {});
    } catch (e) {
      showMessage(e.message || 'Erro ao aplicar sugestões.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function setEntity(ent) {
    entity = ent;
    var gridHost = document.getElementById('wmsCadGrid');
    if (gridHost) gridHost.setAttribute('data-entity', ent);
    document.querySelectorAll('#entityTabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-entity') === ent);
    });
    lastRows = [];
    gridLoadedForEntity = false;
    disposeGrid();
    var countEl = document.getElementById('wmsCadGridCountText');
    if (countEl) countEl.textContent = '0 registro(s) encontrado(s)';
    renderFiltroFields();
    document.getElementById('f_id').value = '';
    renderFormHost();
    updateFormTitle();
    toggleProdutoImportUI();
    var gridTabAtiva = document.getElementById('tab-grid');
    if (gridTabAtiva && gridTabAtiva.classList.contains('active')) {
      if (
        (entity !== 'produto' || canFilterProduto()) &&
        (entity !== 'operacional' || canFilterOperacional())
      ) {
        applyFilters('grid').catch(function () {});
      }
    }
  }

  function updateFormTitle() {
    var ft = document.getElementById('formTitle');
    var id = document.getElementById('f_id') && document.getElementById('f_id').value;
    if (ft) ft.textContent = id ? t('web.modulos.wmsCadastros.editar', 'Editar') : t('web.modulos.wmsCadastros.novo', 'Novo');
  }

  function buildQuery() {
    var p = new URLSearchParams();
    var c = document.getElementById('filtro_codigo');
    var n = document.getElementById('filtro_nome');
    var f = document.getElementById('filtro_fgactive');
    if (entity !== 'depara' && entity !== 'operacional') {
      if (c && c.value) p.append('codigo', c.value.trim());
      if (n && n.value) p.append('nome', n.value.trim());
    }
    if (f && f.value) p.append('fgactive', f.value);
    if (entity === 'armazem' || entity === 'produto' || entity === 'depara' || entity === 'operacional') {
      var dd = document.getElementById('filtro_cd_dono');
      var fd = document.getElementById('form_cd_dono');
      var cdDonoQ = (dd && dd.value) || (entity === 'produto' && fd && fd.value) || '';
      if (cdDonoQ) p.append('cdDono', cdDonoQ);
    }
    if (entity === 'produto') {
      var cc = document.getElementById('filtro_cd_categoria');
      var idp = document.getElementById('filtro_cd_produto');
      var mf = document.getElementById('filtro_mostrar_fornecedor');
      var ta = document.getElementById('filtro_tipo_armazenagem');
      var ps = document.getElementById('filtro_peso_status');
      if (idp && idp.value) p.append('cdProduto', String(idp.value).trim());
      if (cc && cc.value) p.append('cdCategoria', cc.value);
      if (mf && mf.checked) p.append('mostrarFornecedor', '1');
      if (ta && ta.value) p.append('tipoArmazenagem', ta.value);
      if (ps && ps.value) p.append('pesoStatus', ps.value);
    }
    if (entity === 'categoria') {
      var cg = document.getElementById('filtro_cd_grupo');
      if (cg && cg.value) p.append('cdGrupo', cg.value);
    }
    if (entity === 'area' || entity === 'doca') {
      var aa = document.getElementById('filtro_cd_armazem');
      if (aa && aa.value) p.append('cdArmazem', aa.value);
    }
    if (entity === 'depara') {
      var cext = document.getElementById('filtro_cext');
      var cint = document.getElementById('filtro_cint');
      if (cext && cext.value) p.append('codigoExterno', cext.value.trim());
      if (cint && cint.value) p.append('codigoInterno', cint.value.trim());
    }
    if (entity === 'operacional') {
      var col = document.getElementById('filtro_codigo_ol');
      var ces = document.getElementById('filtro_codigo_estoque');
      var nomOp = document.getElementById('filtro_nome');
      var semUm = document.getElementById('filtro_sem_unidade');
      if (col && col.value) p.append('codigoOperacional', col.value.trim());
      if (ces && ces.value) p.append('codigoEstoque', ces.value.trim());
      if (nomOp && nomOp.value) p.append('nome', nomOp.value.trim());
      if (semUm && semUm.checked) p.append('semUnidade', '1');
    }
    return p.toString();
  }

  function fetchList() {
    var path =
      entity === 'dono'
        ? '/api/wms/donos-estoque'
        : entity === 'armazem'
          ? '/api/wms/armazens'
          : entity === 'area'
            ? '/api/wms/areas'
            : entity === 'doca'
              ? '/api/wms/docas'
              : entity === 'grupo'
                ? '/api/wms/grupos-produto'
                : entity === 'categoria'
                  ? '/api/wms/categorias-produto'
              : entity === 'produto'
                ? '/api/wms/produtos-dono'
                : entity === 'operacional'
                  ? '/api/wms/produtos-operacionais'
                : '/api/wms/de-para-produto';
    var q = buildQuery();
    if (entity === 'produto' && !canFilterProduto()) {
      return Promise.reject(new Error(mensagemFiltroProdutoObrigatorio()));
    }
    if (entity === 'operacional' && !canFilterOperacional()) {
      return Promise.reject(new Error(mensagemFiltroOperacionalObrigatorio()));
    }
    return fetch(path + (q ? '?' + q : ''), { headers: getAuthHeaders() }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || r.statusText || 'Erro');
        if (j && Array.isArray(j.rows)) {
          lastCadastroResumo = j.resumo || null;
          var arr = j.rows;
          if (j.truncated && j.aviso) arr._avisoTruncado = j.aviso;
          return arr;
        }
        lastCadastroResumo = null;
        return j;
      });
    });
  }

  async function applyFilters(openTab) {
    if (aplicandoFiltros) return;
    if (entity === 'produto' && !canFilterProduto()) {
      showMessage(mensagemFiltroProdutoObrigatorio(), 'warning');
      await showTab('filtros');
      return;
    }
    if (entity === 'operacional' && !canFilterOperacional()) {
      showMessage(mensagemFiltroOperacionalObrigatorio(), 'warning');
      await showTab('filtros');
      return;
    }
    aplicandoFiltros = true;
    showLoadingOverlay(
      t('web.modulos.wmsCadastros.loadingGrid', 'Carregando'),
      t('web.modulos.wmsCadastros.loadingGridText', 'Buscando registros...'),
      t('web.modulos.wmsCadastros.loadingDetalhe', 'Isso pode levar alguns segundos.')
    );
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var rows = await fetchList();
      lastRows = Array.isArray(rows) ? rows : [];
      gridLoadedForEntity = true;
      hideLoadingOverlay();
      var countEl = document.getElementById('wmsCadGridCountText');
      if (countEl) {
        var suffix = lastRows._avisoTruncado ? ' — ' + lastRows._avisoTruncado : '';
        var resumoTxt = '';
        if (entity === 'operacional' && lastCadastroResumo && lastCadastroResumo.semUnidadeTotal != null) {
          resumoTxt =
            ' — ' +
            String(lastCadastroResumo.semUnidadeTotal) +
            ' ativo(s) sem UM operacional no dono filtrado';
        }
        countEl.textContent =
          (t('web.modulos.wmsCadastros.registrosEncontrados', '{n} registro(s) encontrado(s)') || '').replace(
            '{n}',
            String(lastRows.length)
          ) +
          suffix +
          resumoTxt;
      }
      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (e1) {}
      }
      if (typeof window.GridEditor !== 'undefined') {
        disposeGrid();
        inicializarGridTab();
        await new Promise(function (r) {
          requestAnimationFrame(function () {
            try {
              gridTab.render(lastRows);
            } catch (errRender) {
              console.error('[WMS Cadastros] grid render:', errRender);
            }
            r();
          });
        });
      }
      await showTab(openTab || 'grid');
    } catch (e) {
      hideLoadingOverlay();
      showMessage(e.message || t('web.modulos.wmsCadastros.erroCarregar', 'Erro ao carregar.'), 'error');
      await showTab('filtros');
    } finally {
      aplicandoFiltros = false;
      hideLoadingOverlay();
    }
  }

  function openEdit(row) {
    document.getElementById('f_id').value =
      entity === 'dono'
        ? String(row.CD_DONO)
        : entity === 'armazem'
          ? String(row.CD_ARMAZEM)
          : entity === 'area'
            ? String(row.CD_AREA)
            : entity === 'doca'
              ? String(row.CD_DOCA)
              : entity === 'grupo'
                ? String(row.CD_GRUPO)
                : entity === 'categoria'
                  ? String(row.CD_CATEGORIA)
              : entity === 'produto'
                ? String(row.CD_PRODUTO)
                : entity === 'operacional'
                  ? String(row.CD_OPERACIONAL)
                : String(row.CD_DEPARA);
    renderFormHost();
    function finish() {
      if (entity === 'operacional') {
        document.getElementById('form_codigo_operacional').value = row.CODIGO_OPERACIONAL || '';
        document.getElementById('form_codigo_estoque').value = row.CODIGO_ESTOQUE || '';
        document.getElementById('form_nome_produto').value = row.NM_PRODUTO || '';
        document.getElementById('form_unidade_estoque').value = row.UNIDADE_ESTOQUE || '';
        var umOl = row.UNIDADE || row.UNIDADE_SUGERIDA || '';
        document.getElementById('form_unidade_ol').value = umOl;
        document.getElementById('form_fator').value =
          row.FATOR_CONVERSAO != null ? String(row.FATOR_CONVERSAO) : '1';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
        if (!row.UNIDADE && row.UNIDADE_SUGERIDA) {
          showMessage(
            'UM operacional vazia — sugestão automática: ' +
              row.UNIDADE_SUGERIDA +
              '. Confira e salve, ou use "Preencher UM faltantes" no grid.',
            'info'
          );
        }
        updateFormTitle();
        showTab('dados');
        return;
      }
      if (entity === 'depara') {
        document.getElementById('form_cd_dono').value = String(row.CD_DONO);
        document.getElementById('form_codigo_externo').value = row.CODIGO_EXTERNO || '';
        document.getElementById('form_codigo_interno').value = row.CODIGO_INTERNO || '';
        document.getElementById('form_fator').value =
          row.FATOR_CONVERSAO != null ? String(row.FATOR_CONVERSAO) : '1';
        var ob = document.getElementById('form_obs');
        if (ob) ob.value = row.OBSERVACAO || '';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
        updateFormTitle();
        showTab('dados');
        return;
      }
      document.getElementById('form_codigo').value = row.CODIGO || '';
      document.getElementById('form_nome').value = row.NOME || '';
      if (entity === 'dono') {
        var cg = document.getElementById('form_cgc');
        if (cg) cg.value = formatCnpj(row.CGC || '');
        var mk = document.getElementById('form_mascara_codigo_produto');
        if (mk) mk.value = row.MASCARA_CODIGO_PRODUTO || '';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
        var dr = document.getElementById('form_nu_dias_rel_vencimento');
        var dm = document.getElementById('form_nu_dias_min_valid_receb');
        if (dr) dr.value = row.NU_DIAS_REL_VENCIMENTO != null ? String(row.NU_DIAS_REL_VENCIMENTO) : '60';
        if (dm) dm.value = row.NU_DIAS_MIN_VALID_RECEB != null ? String(row.NU_DIAS_MIN_VALID_RECEB) : '90';
        var pc = document.getElementById('form_pct_cobranca_estoque');
        if (pc) pc.value = row.PCT_COBRANCA_ESTOQUE != null ? String(row.PCT_COBRANCA_ESTOQUE) : '';
        var pe = document.getElementById('form_pct_cobranca_expedicao');
        if (pe) pe.value = row.PCT_COBRANCA_EXPEDICAO != null ? String(row.PCT_COBRANCA_EXPEDICAO) : '';
      } else if (entity === 'armazem') {
        document.getElementById('form_cd_dono').value = String(row.CD_DONO);
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      } else if (entity === 'area') {
        document.getElementById('form_cd_armazem').value = String(row.CD_ARMAZEM);
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      } else if (entity === 'grupo') {
        document.getElementById('form_ordem').value = row.ORDEM != null ? String(row.ORDEM) : '0';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      } else if (entity === 'categoria') {
        document.getElementById('form_cd_grupo').value = String(row.CD_GRUPO);
        document.getElementById('form_ordem').value = row.ORDEM != null ? String(row.ORDEM) : '0';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      } else if (entity === 'produto') {
        document.getElementById('form_cd_dono').value = String(row.CD_DONO);
        var catEl = document.getElementById('form_cd_categoria');
        if (catEl) catEl.value = row.CD_CATEGORIA != null ? String(row.CD_CATEGORIA) : '';
        document.getElementById('form_codigo').value = applyProductMask(row.CODIGO || '', row.MASCARA_CODIGO_PRODUTO);
        bindProdutoCodigoMask({ skipInitialApply: true });
        document.getElementById('form_unidade').value = row.UNIDADE || '';
        document.getElementById('form_peso_kg').value = formatPesoKg(row.PESO_KG);
        var vrEl = document.getElementById('form_valor_referencia');
        if (vrEl) vrEl.value = row.VALOR_REFERENCIA != null && row.VALOR_REFERENCIA !== '' ? formatPesoKg(row.VALOR_REFERENCIA) : '';
        document.getElementById('form_cod_barras').value = row.CODIGO_BARRAS || '';
        document.getElementById('form_ncm').value = row.NCM || '';
        document.getElementById('form_tipo_armazenagem').value = row.TIPO_ARMAZENAGEM || '';
        document.getElementById('form_fg_descartavel').value = row.FG_DESCARTAVEL === 'S' ? 'S' : 'N';
        document.getElementById('form_fg_controla_lote').value = row.FG_CONTROLA_LOTE === 'S' ? 'S' : 'N';
        document.getElementById('form_fg_controla_validade').value = row.FG_CONTROLA_VALIDADE === 'S' ? 'S' : 'N';
        var fgForn = document.getElementById('form_fg_fornecedor_ref');
        if (fgForn) fgForn.value = row.FG_FORNECEDOR_REF === 'S' ? 'S' : 'N';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      } else {
        document.getElementById('form_cd_armazem').value = String(row.CD_ARMAZEM);
        document.getElementById('form_fg_recebe').value = row.FG_RECEBE === 'N' ? 'N' : 'S';
        document.getElementById('form_fg_expede').value = row.FG_EXPEDE === 'N' ? 'N' : 'S';
        document.getElementById('form_fgactive').value = row.FGACTIVE === 'N' ? 'N' : 'S';
      }
      updateFormTitle();
      showTab('dados');
    }
    if (entity === 'dono' || entity === 'grupo' || entity === 'operacional') {
      finish();
    } else if (entity === 'armazem' || entity === 'produto' || entity === 'depara') {
      fillDonoSelect(document.getElementById('form_cd_dono'), 'Selecione…', function () {
        document.getElementById('form_cd_dono').value = String(row.CD_DONO);
        if (entity === 'produto') {
          fillCategoriaSelect(document.getElementById('form_cd_categoria'), 'Selecione…', function () {
            finish();
            bindProdutoRegraValidadePorGrupo();
          });
        } else {
          finish();
        }
      });
    } else if (entity === 'categoria') {
      fillGrupoSelect(document.getElementById('form_cd_grupo'), 'Selecione…', function () {
        document.getElementById('form_cd_grupo').value = String(row.CD_GRUPO);
        finish();
      });
    } else {
      fillArmazemSelect(document.getElementById('form_cd_armazem'), 'Selecione…', function () {
        document.getElementById('form_cd_armazem').value = String(row.CD_ARMAZEM);
        finish();
      });
    }
  }

  function openNew() {
    if (entity === 'operacional') {
      showMessage(
        'O Catálogo OL é alimentado pela importação da planilha OL. Use Editar no grid para corrigir UM operacional e fator.',
        'info'
      );
      return;
    }
    document.getElementById('f_id').value = '';
    renderFormHost();
    updateFormTitle();
    toggleProdutoImportUI();
    if (entity === 'dono') {
      var dr0 = document.getElementById('form_nu_dias_rel_vencimento');
      var dm0 = document.getElementById('form_nu_dias_min_valid_receb');
      if (dr0) dr0.value = '60';
      if (dm0) dm0.value = '90';
    }
    if (entity === 'produto' || entity === 'depara') {
      fillDonoSelect(document.getElementById('form_cd_dono'), 'Selecione…');
      if (entity === 'produto') fillCategoriaSelect(document.getElementById('form_cd_categoria'), 'Selecione…');
    }
    if (entity === 'categoria') {
      fillGrupoSelect(document.getElementById('form_cd_grupo'), 'Selecione…');
    }
    showTab('dados');
  }

  async function abrirNovoDeparaProgramacao(nav) {
    document.getElementById('f_id').value = '';
    updateFormTitle();
    await new Promise(function (resolve) {
      fillDonoSelect(document.getElementById('form_cd_dono'), 'Selecione…', function () {
        if (nav.cdDono) {
          var fd = document.getElementById('form_cd_dono');
          if (fd) fd.value = String(nav.cdDono);
          try {
            sessionStorage.setItem(WMS_CAD_LAST_DONO_KEY, String(nav.cdDono));
          } catch (_) {}
        }
        var ext = document.getElementById('form_codigo_externo');
        if (ext && nav.codigoExterno) ext.value = String(nav.codigoExterno).trim();
        var interno = document.getElementById('form_codigo_interno');
        if (interno) {
          interno.value = String(nav.codigoInternoSugerido || '').trim();
          if (!interno.value) {
            interno.placeholder = 'Código estoque (CDPRODESTO), ex.: 6.03.15.205.40 — não use o código da caixa';
          }
        }
        var obs = document.getElementById('form_obs');
        if (obs) {
          var partes = ['Sugerido pela programação OPL'];
          if (nav.descricao) partes.push(String(nav.descricao).trim());
          if (nav.codigoExterno) partes.push('OL ' + String(nav.codigoExterno).trim());
          obs.value = partes.join(' — ');
        }
        var fator = document.getElementById('form_fator');
        if (fator) {
          var f = nav.fatorSugerido != null && nav.fatorSugerido !== '' ? String(nav.fatorSugerido) : '1';
          fator.value = f;
        }
        var fg = document.getElementById('form_fgactive');
        if (fg) fg.value = 'S';
        resolve();
      });
    });
    await showTab('dados');
    var msgDep =
      'De-para OPL: externo = código do espelho (ex. 6031520542). Interno = produto de estoque (CDPRODESTO, ex. 6.03.15.205.40 PC). Fator = embalagem (ex. 8 para CX8x540G). Código 965421 na NF é outro de-para (fornecedor).';
    if (!nav.codigoInternoSugerido) {
      msgDep += ' Se importou a planilha OL, rode o script wms_gerar_depara_opl_catalogo para o dono Mana (CD_DONO=1).';
    }
    showMessage(msgDep, 'info');
  }

  async function aplicarNavProgramacaoPeso(nav) {
    if (!nav) {
      try {
        nav = JSON.parse(sessionStorage.getItem('wmsCadNavFromProg') || 'null');
      } catch (_) {
        nav = null;
      }
    }
    if (!nav) return;
    try {
      sessionStorage.removeItem('wmsCadNavFromProg');
    } catch (_) {}
    var ent = nav.entity === 'depara' ? 'depara' : 'produto';
    setEntity(ent);
    if (nav.openNew && ent === 'depara') {
      await abrirNovoDeparaProgramacao(nav);
      return;
    }
    await showTab('filtros');
    await new Promise(function (r) {
      setTimeout(r, 120);
    });
    var preencherFiltros = function () {
      if (nav.cdDono) {
        ['filtro_cd_dono', 'form_cd_dono'].forEach(function (id) {
          var sel = document.getElementById(id);
          if (sel) sel.value = String(nav.cdDono);
        });
        try {
          sessionStorage.setItem(WMS_CAD_LAST_DONO_KEY, String(nav.cdDono));
        } catch (_) {}
      }
      if (ent === 'depara') {
        var cext = document.getElementById('filtro_cext');
        if (cext && nav.codigoExterno) cext.value = nav.codigoExterno;
      } else {
        var cod = document.getElementById('filtro_codigo');
        if (cod && nav.codigo) cod.value = nav.codigo;
        var ps = document.getElementById('filtro_peso_status');
        if (ps && nav.pesoStatus) ps.value = nav.pesoStatus;
      }
    };
    if (ent === 'produto' || ent === 'depara') {
      var donoSel = document.getElementById('filtro_cd_dono');
      if (donoSel && nav.cdDono) {
        await new Promise(function (resolve) {
          fillDonoSelect(donoSel, 'Selecione…', function () {
            preencherFiltros();
            resolve();
          });
        });
      } else {
        preencherFiltros();
      }
    } else {
      preencherFiltros();
    }
    await applyFilters(nav.openEdit ? 'dados' : 'grid');
    if (nav.openEdit && nav.cdProduto != null) {
      var row = (lastRows || []).find(function (r) {
        return String(r.CD_PRODUTO) === String(nav.cdProduto);
      });
      if (row) {
        openEdit(row);
        return;
      }
      try {
        var r1 = await fetch('/api/wms/produtos-dono/' + encodeURIComponent(nav.cdProduto), {
          headers: getAuthHeaders(),
        });
        var j1 = await r1.json();
        if (r1.ok && j1 && j1.CD_PRODUTO) openEdit(j1);
      } catch (_) {}
    }
  }

  async function preencherUnidadesOperacionais(dryRun) {
    if (entity !== 'operacional') return;
    var dd = document.getElementById('filtro_cd_dono');
    var cdDono = dd && dd.value ? parseInt(dd.value, 10) : null;
    var msgDono = cdDono ? ' para o dono selecionado' : ' em todos os donos';
    if (!dryRun) {
      var htmlConfirm =
        '<p style="margin:0 0 12px">Preencher automaticamente a <strong>UM operacional</strong> faltante' +
        msgDono +
        '?</p>' +
        '<p style="margin:0 0 6px;font-size:13px;color:#64748b">Ordem da sugestão:</p>' +
        '<ul style="margin:0 0 12px;padding-left:1.25em;text-align:left;font-size:14px;line-height:1.45;color:#475569">' +
        '<li>Padrão no nome do produto (CX, PCT…)</li>' +
        '<li>Fator &gt; 1 com estoque em PC → CX</li>' +
        '<li>Senão, UM de estoque</li>' +
        '</ul>' +
        '<p style="margin:0;font-size:13px;color:#64748b">Revise no grid os itens que continuarem sem UM.</p>';
      var ok = await confirmarAcao(htmlConfirm, { html: true, okLabel: 'Preencher' });
      if (!ok) return;
    }
    showLoadingOverlay(
      dryRun ? 'Simulando' : 'Preenchendo UM',
      dryRun ? 'Calculando sugestões…' : 'Atualizando catálogo operacional…',
      'Registros sem sugestão precisam de correção manual.'
    );
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var body = { dryRun: !!dryRun };
      if (Number.isFinite(cdDono)) body.CD_DONO = cdDono;
      var r = await fetch('/api/wms/produtos-operacionais/preencher-unidades-faltantes', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      var j = await r.json();
      if (!r.ok) throw new Error((j && j.error) || r.statusText || 'Erro');
      var txt =
        (dryRun ? 'Simulação concluída. ' : 'Preenchimento concluído. ') +
        String(j.comSugestao || 0) +
        ' com sugestão' +
        (dryRun ? '.' : ', ' + String(j.atualizados || 0) + ' gravado(s).') +
        ' ' +
        String(j.semSugestao || 0) +
        ' sem sugestão — revise manualmente no grid.';
      showMessage(txt, j.semSugestao ? 'warning' : 'success');
      if (!dryRun && (j.atualizados || 0) > 0) await applyFilters('grid');
    } catch (e) {
      showMessage(e.message || 'Erro ao preencher UM operacionais.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  window.__aplicarNavProgramacaoPeso = aplicarNavProgramacaoPeso;

  async function init() {
    if (initFeito) return;
    initFeito = true;
    bindDonoProdutoSyncListeners();
    await new Promise(function (r) {
      setTimeout(r, 150);
    });
    await showTab('filtros');
    var navPend;
    try {
      navPend = sessionStorage.getItem('wmsCadNavFromProg');
    } catch (_) {}
    if (navPend) {
      await aplicarNavProgramacaoPeso(null);
    }
  }

  document.querySelectorAll('#entityTabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      setEntity(b.getAttribute('data-entity'));
    });
  });

  document.querySelectorAll('.wms-cadastros-container .tabs .tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      showTab(b.getAttribute('data-tab'));
    });
  });

  var filtroForm = document.getElementById('filtroForm');
  if (filtroForm) {
    filtroForm.addEventListener('submit', function (e) {
      e.preventDefault();
      applyFilters('grid');
    });
  }
  document.getElementById('btnLimparFiltros') &&
    document.getElementById('btnLimparFiltros').addEventListener('click', function () {
      renderFiltroFields();
    });
  document.getElementById('btnNovoRegistro') &&
    document.getElementById('btnNovoRegistro').addEventListener('click', function () {
      openNew();
    });
  document.getElementById('btnNovoRegistroGrid') &&
    document.getElementById('btnNovoRegistroGrid').addEventListener('click', function () {
      openNew();
    });
  ['btnPreencherUmOperacional', 'btnPreencherUmOperacionalGrid'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      preencherUnidadesOperacionais(false);
    });
  });
  document.getElementById('btnVoltarGrid') &&
    document.getElementById('btnVoltarGrid').addEventListener('click', function () {
      showTab('filtros');
    });
  document.getElementById('btnCancelar') &&
    document.getElementById('btnCancelar').addEventListener('click', function () {
      if (entity === 'produto') {
        var fd = document.getElementById('form_cd_dono');
        var ff = document.getElementById('filtro_cd_dono');
        if (fd && ff && fd.value) ff.value = fd.value;
      }
      showTab('grid');
    });

  document.getElementById('btnImportarProdutos') &&
    document.getElementById('btnImportarProdutos').addEventListener('click', function () {
      syncDonoProdutoFiltroImport('filtro');
      openNew();
      syncDonoProdutoFiltroImport('filtro');
      showTab('dados');
    });
  document.getElementById('btnImportarProdutosGrid') &&
    document.getElementById('btnImportarProdutosGrid').addEventListener('click', function () {
      syncDonoProdutoFiltroImport('filtro');
      openNew();
      syncDonoProdutoFiltroImport('filtro');
      showTab('dados');
    });
  document.getElementById('btnPendenciasCadastroGrid') &&
    document.getElementById('btnPendenciasCadastroGrid').addEventListener('click', function () {
      if (entity !== 'produto') return;
      abrirModalCadastrosWms('pendencias');
    });
  document.getElementById('btnClassificacaoOlGrid') &&
    document.getElementById('btnClassificacaoOlGrid').addEventListener('click', function () {
      if (entity !== 'produto') return;
      abrirModalCadastrosWms('ol');
    });
  document.querySelectorAll('.wms-cad-modal-tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      trocarTabModalCadastros(btn.getAttribute('data-wms-cad-tab'));
    });
  });
  document.getElementById('btnWmsCadModalFechar') &&
    document.getElementById('btnWmsCadModalFechar').addEventListener('click', fecharModalCadastrosWms);
  document.getElementById('wmsCadastrosModalBackdrop') &&
    document.getElementById('wmsCadastrosModalBackdrop').addEventListener('click', fecharModalCadastrosWms);
  document.getElementById('btnPendenciasAtualizar') &&
    document.getElementById('btnPendenciasAtualizar').addEventListener('click', function () {
      pendenciasCategoriasCache = null;
      carregarPendenciasCadastro().catch(function () {});
    });
  document.getElementById('btnOlClassSimular') &&
    document.getElementById('btnOlClassSimular').addEventListener('click', function () {
      simularClassificacaoOl().catch(function () {});
    });
  document.getElementById('btnOlClassAplicar') &&
    document.getElementById('btnOlClassAplicar').addEventListener('click', function () {
      aplicarClassificacaoOl(false).catch(function () {});
    });
  document.getElementById('btnOlClassAplicarTodos') &&
    document.getElementById('btnOlClassAplicarTodos').addEventListener('click', function () {
      aplicarClassificacaoOl(true).catch(function () {});
    });
  document.getElementById('olClassMarcarTodos') &&
    document.getElementById('olClassMarcarTodos').addEventListener('change', function (e) {
      var on = !!(e && e.target && e.target.checked);
      document.querySelectorAll('#wmsOlPreviewBody .ol-class-chk').forEach(function (c) {
        c.checked = on;
      });
    });
  document.getElementById('btnSugestoesCategoriaGrid') &&
    document.getElementById('btnSugestoesCategoriaGrid').addEventListener('click', function () {
      if (entity !== 'produto') return;
      abrirModalSugestoesCategoria();
      carregarSugestoesCategoria().catch(function () {});
    });
  document.getElementById('btnSugCategoriaFechar') &&
    document.getElementById('btnSugCategoriaFechar').addEventListener('click', fecharModalSugestoesCategoria);
  document.getElementById('sugCategoriasBackdrop') &&
    document.getElementById('sugCategoriasBackdrop').addEventListener('click', fecharModalSugestoesCategoria);
  document.getElementById('btnSugCategoriaCarregar') &&
    document.getElementById('btnSugCategoriaCarregar').addEventListener('click', function () {
      carregarSugestoesCategoria().catch(function () {});
    });
  document.getElementById('btnSugCategoriaAplicar') &&
    document.getElementById('btnSugCategoriaAplicar').addEventListener('click', function () {
      aplicarSugestoesCategoriaSelecionadas().catch(function () {});
    });
  document.getElementById('btnSugCategoriaSimularAltas') &&
    document.getElementById('btnSugCategoriaSimularAltas').addEventListener('click', function () {
      executarJobCategoriaLote(true).catch(function () {});
    });
  document.getElementById('btnSugCategoriaAplicarAltas') &&
    document.getElementById('btnSugCategoriaAplicarAltas').addEventListener('click', function () {
      if (
        !window.confirm(
          'Aplicar automaticamente todas as sugestões de ALTA confiança para o dono do filtro?\n\n' +
            'Refrigerado/congelado não serão misturados com seco. Médias/baixas continuam na revisão manual.'
        )
      ) {
        return;
      }
      executarJobCategoriaLote(false).catch(function () {});
    });
  document.getElementById('sugCategoriaMarcarTodos') &&
    document.getElementById('sugCategoriaMarcarTodos').addEventListener('change', function (e) {
      var on = !!(e && e.target && e.target.checked);
      document.querySelectorAll('#sugCategoriasBody .sug-cat-chk').forEach(function (c) {
        c.checked = on;
      });
    });

  function parseApiErrorResponse(r) {
    return r.text().then(function (txt) {
      var payload = null;
      if (txt) {
        try {
          payload = JSON.parse(txt);
        } catch (_) {}
      }
      return {
        status: r.status,
        error: (payload && payload.error) || txt || r.statusText || 'Erro na requisição.',
        payload: payload || null,
      };
    });
  }

  function apiUrlWmsProduto(cdProduto) {
    var path = '/api/wms/produtos-dono/' + encodeURIComponent(cdProduto);
    return typeof window.corrigirUrl === 'function' ? window.corrigirUrl(path) : path;
  }

  function carregarProdutoPorId(idC, pendingBody) {
    return fetch(apiUrlWmsProduto(idC), { headers: getAuthHeaders() })
      .then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok) throw new Error((j && j.error) || res.statusText || 'Erro');
          return j;
        });
      })
      .then(function (row) {
        var fd = document.getElementById('filtro_cd_dono');
        if (fd && row.CD_DONO != null) fd.value = String(row.CD_DONO);
        openEdit(row);
        showTab('dados');
        // Reaplica o que o usuário acabou de tentar salvar (peso, validade, etc.)
        if (pendingBody && typeof pendingBody === 'object') {
          setTimeout(function () {
            if (pendingBody.PESO_KG != null && document.getElementById('form_peso_kg')) {
              document.getElementById('form_peso_kg').value = String(pendingBody.PESO_KG).replace('.', ',');
            }
            if (pendingBody.VALOR_REFERENCIA != null && document.getElementById('form_valor_referencia')) {
              document.getElementById('form_valor_referencia').value = String(pendingBody.VALOR_REFERENCIA).replace('.', ',');
            }
            if (pendingBody.NOME && document.getElementById('form_nome')) {
              document.getElementById('form_nome').value = pendingBody.NOME;
            }
            if (pendingBody.UNIDADE != null && document.getElementById('form_unidade')) {
              document.getElementById('form_unidade').value = pendingBody.UNIDADE;
            }
            if (pendingBody.NCM != null && document.getElementById('form_ncm')) {
              document.getElementById('form_ncm').value = pendingBody.NCM;
            }
            if (pendingBody.CODIGO_BARRAS != null && document.getElementById('form_cod_barras')) {
              document.getElementById('form_cod_barras').value = pendingBody.CODIGO_BARRAS;
            }
            if (pendingBody.TIPO_ARMAZENAGEM != null && document.getElementById('form_tipo_armazenagem')) {
              document.getElementById('form_tipo_armazenagem').value = pendingBody.TIPO_ARMAZENAGEM;
            }
            if (pendingBody.FG_DESCARTAVEL && document.getElementById('form_fg_descartavel')) {
              document.getElementById('form_fg_descartavel').value = pendingBody.FG_DESCARTAVEL;
            }
            if (pendingBody.FG_CONTROLA_LOTE && document.getElementById('form_fg_controla_lote')) {
              document.getElementById('form_fg_controla_lote').value = pendingBody.FG_CONTROLA_LOTE;
            }
            if (pendingBody.FG_CONTROLA_VALIDADE && document.getElementById('form_fg_controla_validade')) {
              document.getElementById('form_fg_controla_validade').value = pendingBody.FG_CONTROLA_VALIDADE;
            }
            if (pendingBody.FGACTIVE && document.getElementById('form_fgactive')) {
              document.getElementById('form_fgactive').value = pendingBody.FGACTIVE;
            }
            if (pendingBody.CD_CATEGORIA != null && document.getElementById('form_cd_categoria')) {
              document.getElementById('form_cd_categoria').value = String(pendingBody.CD_CATEGORIA);
            }
          }, 80);
        }
        return row;
      });
  }

  function tratarErro409SkuDuplicado(err, pendingBody) {
    if (entity !== 'produto' || !err || !err.wmsSku409 || !err.cdProdutoConflito) return;
    clearCadMessage();
    var idC = err.cdProdutoConflito;
    // Já estávamos editando / salvando este SKU: abre o # correto, reaplica os campos e salva de novo.
    if (pendingBody) {
      showMessage('Mesmo SKU já existe como #' + idC + '. Abrindo o cadastro certo e aplicando suas alterações…', 'info');
      carregarProdutoPorId(idC, pendingBody)
        .then(function () {
          showMessage(
            'Cadastro #' + idC + ' aberto com seus dados. Clique em Salvar de novo para gravar.',
            'success'
          );
        })
        .catch(function () {
          showMessage(
            'O produto #' + idC + ' não existe mais (clone removido). Feche o modal, filtre o código no grid e abra o registro com máscara (ex.: 6.03…).',
            'error'
          );
        });
      return;
    }
    var html =
      '<p>O código já está no produto <strong>#' +
      idC +
      '</strong> (não pode haver dois no mesmo dono).</p>' +
      '<p>Abra o cadastro <strong>#' +
      idC +
      '</strong> e ajuste nome, NCM, peso ou validade nele — não é outro produto novo.</p>';
    confirmarTextoModal(html, 'SKU duplicado', 'Abrir #' + idC).then(function (sim) {
      if (!sim) return;
      carregarProdutoPorId(idC, null)
        .then(function (row) {
          showMessage(
            'Produto #' + idC + ' já cadastrado para este dono. Edite aqui; no Recebimento use o código ' +
              (row.CODIGO || '') +
              '.',
            'success'
          );
        })
        .catch(function () {
          showMessage('Não foi possível carregar o produto #' + idC + '. Atualize o grid e abra o registro com a máscara.', 'error');
        });
    });
  }

  function mensagemAmigavelErroProdutos(info) {
    var status = info && info.status;
    var msg = String((info && info.error) || '').trim();
    if (status === 409 && /(Já existe (outro )?produto com este código|Duplicidade de SKU)/i.test(msg)) {
      return msg;
    }
    if (status === 400 && /Nenhum arquivo recebido/i.test(msg)) {
      return 'Nenhum XML foi recebido. Selecione um ou mais arquivos .xml e tente novamente.';
    }
    if (status === 400 && /Dono não encontrado para este tenant/i.test(msg)) {
      return 'O dono selecionado não pertence a este tenant. Reabra a tela, selecione um dono válido e tente novamente.';
    }
    if (status === 400 && /Campo de upload inesperado/i.test(msg)) {
      return 'Formato de envio inválido. Use a seleção de XML da própria tela e tente novamente.';
    }
    return msg || 'Falha ao processar a requisição.';
  }

  function enviarImportacaoProdutos() {
    if (importProdutosSubmitting) return;
    var cdDonoEl = document.getElementById('import_prod_cd_dono');
    var filesEl = document.getElementById('import_prod_arquivos');
    var cdDono = cdDonoEl ? cdDonoEl.value : '';
    var files = [];
    if (filesEl && filesEl.files && filesEl.files.length) {
      files = Array.from(filesEl.files);
    }
    if (!files.length) {
      showMessage('Selecione ao menos um arquivo XML.', 'error');
      return;
    }
    importProdutosSubmitting = true;
    var btn = document.getElementById('btnEnviarImportProd');
    var label = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Processando...";
    }
    var fd = new FormData();
    if (cdDono) fd.append('CD_DONO', cdDono);
    files.forEach(function (f) {
      fd.append('arquivos', f, f.name);
    });
    var importHeaders = getAuthHeaders();
    delete importHeaders['Content-Type'];
    delete importHeaders['content-type'];
    showLoadingOverlay('Importando', 'Lendo XML(s) e cadastrando produtos...', 'Aguarde.');
    fetch('/api/wms/produtos-dono/importar-xml', {
      method: 'POST',
      headers: importHeaders,
      body: fd,
    })
      .then(function (r) {
        if (!r.ok) {
          return parseApiErrorResponse(r).then(function (info) {
            throw new Error(mensagemAmigavelErroProdutos(info));
          });
        }
        return r.json();
      })
      .then(function (resp) {
        var s = resp && resp.resumo ? resp.resumo : {};
        var msg =
          'Importação concluída. Inseridos: ' +
          String(s.inseridos || 0) +
          ', atualizados: ' +
          String(s.atualizados || 0) +
          ', ignorados: ' +
          String(s.ignorados || 0) +
          '.';
        if (!cdDono) {
          msg +=
            ' Dono automático por CNPJ do emitente em ' +
            String(s.arquivosComDonoAutomatico || 0) +
            ' arquivo(s).';
        }
        showMessage(msg, 'success');
        if (filesEl) filesEl.value = '';
        if (cdDono) syncDonoProdutoFiltroImport('import');
        return applyFilters('grid');
      })
      .catch(function (err) {
        showMessage(err.message || 'Erro ao importar XML(s) de produto.', 'error');
      })
      .finally(function () {
        hideLoadingOverlay();
        importProdutosSubmitting = false;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = label;
        }
      });
  }

  document.getElementById('btnEnviarImportProd') &&
    document.getElementById('btnEnviarImportProd').addEventListener('click', enviarImportacaoProdutos);

  var cadForm = document.getElementById('cadForm');
  if (cadForm) {
    cadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (cadFormSubmitting) return;
      cadFormSubmitting = true;
      var btnSubmit = cadForm.querySelector('button[type="submit"]');
      var labelOriginal = btnSubmit ? btnSubmit.innerHTML : '';
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Salvando...";
      }

      var idVal = (document.getElementById('f_id') && document.getElementById('f_id').value) || '';
      var body = {};
      var method = idVal ? 'PUT' : 'POST';
      var url = '';

      try {
        if (entity === 'dono') {
          var cgcInput = document.getElementById('form_cgc');
          var cgcDigits = cgcInput ? onlyDigits(cgcInput.value) : '';
          var relEl = document.getElementById('form_nu_dias_rel_vencimento');
          var minEl = document.getElementById('form_nu_dias_min_valid_receb');
          var nRel = relEl ? parseInt(String(relEl.value).trim(), 10) : 60;
          var nMin = minEl ? parseInt(String(minEl.value).trim(), 10) : 90;
          if (!Number.isFinite(nRel) || nRel < 1 || nRel > 1095) {
            throw new Error('Relatório vencimento: informe dias entre 1 e 1095.');
          }
          if (!Number.isFinite(nMin) || nMin < 1 || nMin > 1095) {
            throw new Error('Vida mínima no recebimento: informe dias entre 1 e 1095.');
          }
          var pctEl = document.getElementById('form_pct_cobranca_estoque');
          var pctVal = pctEl && pctEl.value.trim() !== '' ? pctEl.value.trim().replace(',', '.') : null;
          var pctExpEl = document.getElementById('form_pct_cobranca_expedicao');
          var pctExpVal = pctExpEl && pctExpEl.value.trim() !== '' ? pctExpEl.value.trim().replace(',', '.') : null;
          body = {
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            CGC: cgcDigits,
            MASCARA_CODIGO_PRODUTO: document.getElementById('form_mascara_codigo_produto')
              ? document.getElementById('form_mascara_codigo_produto').value.trim()
              : '',
            FGACTIVE: document.getElementById('form_fgactive').value,
            NU_DIAS_REL_VENCIMENTO: nRel,
            NU_DIAS_MIN_VALID_RECEB: nMin,
            PCT_COBRANCA_ESTOQUE: pctVal,
            PCT_COBRANCA_EXPEDICAO: pctExpVal,
          };
          url = idVal ? '/api/wms/donos-estoque/' + encodeURIComponent(idVal) : '/api/wms/donos-estoque';
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
          if (body.CGC && !isValidCnpj(body.CGC)) throw new Error('CNPJ inválido. Verifique o número informado.');
        } else if (entity === 'armazem') {
          body = {
            CD_DONO: parseInt(document.getElementById('form_cd_dono').value, 10),
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/armazens/' + encodeURIComponent(idVal) : '/api/wms/armazens';
          if (!Number.isFinite(body.CD_DONO)) throw new Error('Selecione o dono.');
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'area') {
          body = {
            CD_ARMAZEM: parseInt(document.getElementById('form_cd_armazem').value, 10),
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/areas/' + encodeURIComponent(idVal) : '/api/wms/areas';
          if (!Number.isFinite(body.CD_ARMAZEM)) throw new Error('Selecione o armazém.');
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'doca') {
          body = {
            CD_ARMAZEM: parseInt(document.getElementById('form_cd_armazem').value, 10),
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            FG_RECEBE: document.getElementById('form_fg_recebe').value,
            FG_EXPEDE: document.getElementById('form_fg_expede').value,
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/docas/' + encodeURIComponent(idVal) : '/api/wms/docas';
          if (!Number.isFinite(body.CD_ARMAZEM)) throw new Error('Selecione o armazém.');
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'grupo') {
          body = {
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            ORDEM: parseInt(document.getElementById('form_ordem').value, 10) || 0,
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/grupos-produto/' + encodeURIComponent(idVal) : '/api/wms/grupos-produto';
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'categoria') {
          body = {
            CD_GRUPO: parseInt(document.getElementById('form_cd_grupo').value, 10),
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            ORDEM: parseInt(document.getElementById('form_ordem').value, 10) || 0,
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/categorias-produto/' + encodeURIComponent(idVal) : '/api/wms/categorias-produto';
          if (!Number.isFinite(body.CD_GRUPO)) throw new Error('Selecione o grupo.');
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'produto') {
          body = {
            CD_DONO: parseInt(document.getElementById('form_cd_dono').value, 10),
            CD_CATEGORIA: parseInt(document.getElementById('form_cd_categoria').value, 10),
            CODIGO: document.getElementById('form_codigo').value.trim(),
            NOME: document.getElementById('form_nome').value.trim(),
            UNIDADE: document.getElementById('form_unidade').value.trim(),
            PESO_KG: document.getElementById('form_peso_kg').value.trim().replace(',', '.'),
            VALOR_REFERENCIA: (document.getElementById('form_valor_referencia') || {}).value
              ? document.getElementById('form_valor_referencia').value.trim().replace(',', '.')
              : '',
            CODIGO_BARRAS: document.getElementById('form_cod_barras').value.trim(),
            NCM: document.getElementById('form_ncm').value.trim(),
            TIPO_ARMAZENAGEM: document.getElementById('form_tipo_armazenagem').value,
            FG_DESCARTAVEL: document.getElementById('form_fg_descartavel').value,
            FG_CONTROLA_LOTE: document.getElementById('form_fg_controla_lote').value,
            FG_CONTROLA_VALIDADE: document.getElementById('form_fg_controla_validade').value,
            FGACTIVE: document.getElementById('form_fgactive').value,
            ORIGEM_CADASTRO: 'MANUAL',
            FG_FORNECEDOR_REF: (document.getElementById('form_fg_fornecedor_ref') || {}).value === 'S' ? 'S' : 'N',
          };
          if (!Number.isFinite(body.CD_CATEGORIA)) body.CD_CATEGORIA = null;
          url = idVal ? '/api/wms/produtos-dono/' + encodeURIComponent(idVal) : '/api/wms/produtos-dono';
          if (!Number.isFinite(body.CD_DONO)) throw new Error('Selecione o dono.');
          if (!body.CODIGO || !body.NOME) throw new Error('Preencha código e nome.');
        } else if (entity === 'depara') {
          body = {
            CD_DONO: parseInt(document.getElementById('form_cd_dono').value, 10),
            CODIGO_EXTERNO: document.getElementById('form_codigo_externo').value.trim(),
            CODIGO_INTERNO: document.getElementById('form_codigo_interno').value.trim(),
            FATOR_CONVERSAO: document.getElementById('form_fator').value.trim().replace(',', '.'),
            OBSERVACAO: document.getElementById('form_obs') ? document.getElementById('form_obs').value.trim() : '',
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = idVal ? '/api/wms/de-para-produto/' + encodeURIComponent(idVal) : '/api/wms/de-para-produto';
          if (!Number.isFinite(body.CD_DONO)) throw new Error('Selecione o dono.');
          if (!body.CODIGO_EXTERNO || !body.CODIGO_INTERNO) throw new Error('Preencha códigos externo e interno.');
        } else if (entity === 'operacional') {
          body = {
            UNIDADE: document.getElementById('form_unidade_ol').value.trim(),
            FATOR_CONVERSAO: document.getElementById('form_fator').value.trim().replace(',', '.'),
            FGACTIVE: document.getElementById('form_fgactive').value,
          };
          url = '/api/wms/produtos-operacionais/' + encodeURIComponent(idVal);
          if (!idVal) throw new Error('Selecione um vínculo operacional no grid.');
          if (!body.UNIDADE) throw new Error('Informe a UM operacional (OL).');
        } else {
          throw new Error('Tipo de cadastro inválido.');
        }
      } catch (err) {
        showMessage(err.message || 'Validação', 'error');
        cadFormSubmitting = false;
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = labelOriginal;
        }
        return;
      }

      fetch(url, {
        method: method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
        .then(function (r) {
          if (!r.ok) {
            return parseApiErrorResponse(r).then(function (info) {
              var msg = mensagemAmigavelErroProdutos(info);
              var err = new Error(msg);
              if (
                info.status === 409 &&
                info.payload &&
                info.payload.codigoErro === 'WMS_SKU_DUPLICADO' &&
                info.payload.cdProdutoConflito != null
              ) {
                err.wmsSku409 = true;
                err.cdProdutoConflito = info.payload.cdProdutoConflito;
                err.cdProdutoSolicitado = info.payload.cdProdutoSolicitado;
              }
              throw err;
            });
          }
          return r.json();
        })
        .then(function (saved) {
          // Se a API redirecionou o update para o # canônico, alinha o f_id
          if (entity === 'produto' && saved && saved.CD_PRODUTO != null) {
            document.getElementById('f_id').value = String(saved.CD_PRODUTO);
          }
          showMessage(t('web.modulos.wmsCadastros.sucessoSalvar', 'Salvo com sucesso.'), 'success');
          document.getElementById('f_id').value = '';
          if (entity === 'produto' && body.CD_DONO) {
            var filtroDono = document.getElementById('filtro_cd_dono');
            if (filtroDono) filtroDono.value = String(body.CD_DONO);
            try {
              sessionStorage.setItem(WMS_CAD_LAST_DONO_KEY, String(body.CD_DONO));
            } catch (_) {}
          }
          return fetchList();
        })
        .then(function (rows) {
          if (rows === undefined) return;
          lastRows = rows || [];
          var countEl = document.getElementById('wmsCadGridCountText');
          if (countEl) {
            countEl.textContent = (t('web.modulos.wmsCadastros.registrosEncontrados', '{n} registro(s) encontrado(s)') || '').replace(
              '{n}',
              String(lastRows.length)
            );
          }
          if (gridTab) gridTab.render(lastRows);
          updateFormTitle();
          showTab('grid');
        })
        .catch(function (err) {
          if (err && err.wmsSku409 && entity === 'produto' && err.cdProdutoConflito) {
            var idCanon = err.cdProdutoConflito;
            // Retry automático: grava no # canônico com os mesmos campos (1x)
            return fetch(apiUrlWmsProduto(idCanon), {
              method: 'PUT',
              headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
            })
              .then(function (r2) {
                if (!r2.ok) {
                  return parseApiErrorResponse(r2).then(function (info2) {
                    throw new Error(mensagemAmigavelErroProdutos(info2));
                  });
                }
                return r2.json();
              })
              .then(function () {
                showMessage('Salvo no cadastro #' + idCanon + ' (mesmo SKU).', 'success');
                document.getElementById('f_id').value = '';
                if (body.CD_DONO) {
                  var filtroDono2 = document.getElementById('filtro_cd_dono');
                  if (filtroDono2) filtroDono2.value = String(body.CD_DONO);
                }
                return fetchList();
              })
              .then(function (rows2) {
                lastRows = rows2 || [];
                var countEl2 = document.getElementById('wmsCadGridCountText');
                if (countEl2) {
                  countEl2.textContent = (t('web.modulos.wmsCadastros.registrosEncontrados', '{n} registro(s) encontrado(s)') || '').replace(
                    '{n}',
                    String(lastRows.length)
                  );
                }
                if (gridTab) gridTab.render(lastRows);
                updateFormTitle();
                showTab('grid');
              })
              .catch(function () {
                tratarErro409SkuDuplicado(err, body);
              });
          }
          if (err && err.wmsSku409) {
            tratarErro409SkuDuplicado(err, body);
            return;
          }
          showMessage(err.message || 'Erro ao salvar.', 'error');
        })
        .finally(function () {
          setTimeout(function () {
            cadFormSubmitting = false;
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = labelOriginal;
            }
          }, 600);
        });
    });
  }

  setEntity('dono');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
