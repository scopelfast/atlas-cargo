(function () {
  'use strict';

  var donosCache = [];
  var motivosCache = [];
  var listaAtual = [];
  var docLinhas = [];
  var previewAtual = null;
  var detalheAtual = null;
  var produtoResolvidoCache = null;

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

  function api(path, opts) {
    opts = opts || {};
    var headers = getAuthHeaders(opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    var url = typeof window.corrigirUrl === 'function' ? window.corrigirUrl(path) : path;
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  function showMessage(text, tipo) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, tipo || 'success', document.getElementById('message'));
      return;
    }
    var el = document.getElementById('message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (tipo || '');
    el.style.display = text ? 'block' : 'none';
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtQtd(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n - Math.round(n)) < 1e-6) return Math.round(n).toLocaleString('pt-BR');
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function fmtDh(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('pt-BR');
    } catch (_) {
      return String(v);
    }
  }

  function fmtData(v) {
    if (v == null || v === '') return '—';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      var dd = String(v.getDate()).padStart(2, '0');
      var mm = String(v.getMonth() + 1).padStart(2, '0');
      return dd + '/' + mm + '/' + v.getFullYear();
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return s;
    var d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return (
        String(d.getDate()).padStart(2, '0') +
        '/' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '/' +
        d.getFullYear()
      );
    }
    return s;
  }

  function showLoadingOverlay(titulo, desc, detalhe) {
    document.getElementById('loadingTitulo').textContent = titulo || 'Carregando…';
    document.getElementById('loadingDesc').textContent = desc || '';
    document.getElementById('loadingDetalhe').textContent = detalhe || '';
    document.getElementById('loadingOverlay').style.display = 'flex';
  }

  function hideLoadingOverlay() {
    document.getElementById('loadingOverlay').style.display = 'none';
  }

  function yieldRender() {
    return new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
  }

  function labelMotivo(m) {
    var desc = String(m.DESCRICAO || m.descricao || '').trim();
    var cod = String(m.CODIGO || m.codigo || '').trim();
    var ol = String(m.CODIGO_OL || m.codigoOl || '').trim();
    if (ol && /\(OL\)/i.test(desc)) {
      desc = desc.replace(/\s*\(OL\)\s*/i, ' ').replace(/\s+/g, ' ').trim();
    }
    var label = cod && desc ? cod + ' — ' + desc : cod || desc;
    if (ol && label.indexOf('OL ' + ol) < 0 && label.indexOf('(OL ' + ol + ')') < 0) {
      label += ' (OL ' + ol + ')';
    }
    return label || '—';
  }

  function shelfBodyFromUi() {
    var modoUi = document.getElementById('docShelfModo').value || 'cobranca-vencidos';
    var body = {
      apontado: document.getElementById('docShelfApontado').value || 'nao',
    };
    var dr = document.getElementById('docShelfData').value;
    if (dr) body.dataReferencia = dr;
    var hor = document.getElementById('docShelfHorizonte').value;
    if (hor) body.horizonteDias = hor;
    if (modoUi === 'cobranca-vencidos') {
      body.modo = 'cobranca';
      body.somenteVencidos = true;
    } else if (modoUi === 'cobranca') {
      body.modo = 'cobranca';
    } else {
      body.modo = 'saldo';
    }
    return body;
  }

  async function carregarDonos() {
    var r = await api('/api/wms/donos-estoque');
    if (!r.ok) throw new Error('Falha ao carregar donos.');
    donosCache = await r.json();
    ['filtroDono', 'docDono'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var html = id === 'filtroDono' ? '<option value="">Todos</option>' : '<option value="">— Selecione —</option>';
      donosCache.forEach(function (d) {
        html +=
          '<option value="' +
          esc(d.CD_DONO) +
          '">' +
          esc(d.CD_DONO + ' — ' + (d.NOME || d.CODIGO || '')) +
          '</option>';
      });
      sel.innerHTML = html;
    });
  }

  async function carregarMotivos() {
    var r = await api('/api/wms/baixas/motivos');
    if (!r.ok) throw new Error('Falha ao carregar motivos.');
    var j = await r.json();
    motivosCache = j.motivos || [];
    var sel = document.getElementById('docMotivo');
    if (!sel) return;
    sel.innerHTML = motivosCache
      .map(function (m) {
        return (
          '<option value="' +
          esc(m.CD_MOTIVO_BAIXA) +
          '" data-codigo="' +
          esc(m.CODIGO) +
          '">' +
          esc(labelMotivo(m)) +
          '</option>'
        );
      })
      .join('');
    var def = sel.querySelector('option[data-codigo="21"]') || sel.querySelector('option[data-codigo="VENCIDO"]');
    if (def) sel.value = def.value;
  }

  function abrirModalNovaBaixa() {
    document.getElementById('modalNovaBaixa').hidden = false;
  }

  function fecharModalNovaBaixa() {
    document.getElementById('modalNovaBaixa').hidden = true;
  }

  function renderDocLinhas() {
    var body = document.getElementById('docLinhasBody');
    if (!docLinhas.length) {
      body.innerHTML = '<tr><td colspan="6">Adicione linhas manualmente ou importe do shelf-life.</td></tr>';
      return;
    }
    body.innerHTML = docLinhas
      .map(function (l, idx) {
        return (
          '<tr><td>' +
          esc(l.CODIGO_PRODUTO || l.codigoProduto || '') +
          '</td><td>' +
          esc(l.NM_PRODUTO || l.nmProduto || '—') +
          '</td><td>' +
          esc(l.LOTE || l.lote || '—') +
          '</td><td>' +
          esc(fmtData(l.VALIDADE || l.validade)) +
          '</td><td class="num">' +
          esc(fmtQtd(l.QTD_BAIXA != null ? l.QTD_BAIXA : l.QTD_SALDO_ESTIMADO)) +
          '</td><td><button type="button" class="btn-acao btn-rm-linha" data-idx="' +
          idx +
          '" title="Remover linha"><i class="bx bx-trash"></i></button></td></tr>'
        );
      })
      .join('');
  }

  function linhasParaPayload() {
    return docLinhas.map(function (l) {
      return {
        CD_DONO: l.CD_DONO,
        CD_PRODUTO: l.CD_PRODUTO,
        CODIGO_PRODUTO: l.CODIGO_PRODUTO,
        NM_PRODUTO: l.NM_PRODUTO,
        LOTE: l.LOTE,
        VALIDADE: l.VALIDADE,
        QTD_BAIXA: l.QTD_BAIXA,
        QTD_SALDO_ESTIMADO: l.QTD_SALDO_ESTIMADO,
        QTD_SALDO_SKU: l.QTD_SALDO_SKU,
        DIAS_ATE_VENCIMENTO: l.DIAS_ATE_VENCIMENTO,
      };
    });
  }

  async function carregarLista() {
    var qs = [];
    var cdDono = document.getElementById('filtroDono').value;
    var di = document.getElementById('filtroDataInicio').value;
    var df = document.getElementById('filtroDataFim').value;
    var st = document.getElementById('filtroStatus').value;
    var lim = document.getElementById('filtroLimite').value;
    if (cdDono) qs.push('cdDono=' + encodeURIComponent(cdDono));
    if (di) qs.push('dataInicio=' + encodeURIComponent(di));
    if (df) qs.push('dataFim=' + encodeURIComponent(df));
    if (st) qs.push('stBaixa=' + encodeURIComponent(st));
    if (lim) qs.push('limit=' + encodeURIComponent(lim));

    showLoadingOverlay('Listando baixas…', 'Buscando documentos.', qs.join(' · ') || 'Sem filtros');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas' + (qs.length ? '?' + qs.join('&') : ''));
      var j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      listaAtual = j.rows || [];
      renderLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao listar.', 'error');
      listaAtual = [];
      renderLista();
    } finally {
      hideLoadingOverlay();
    }
  }

  function renderLista() {
    var wrap = document.getElementById('listaWrapper');
    document.getElementById('listaMeta').textContent = listaAtual.length + ' documento(s)';
    if (!listaAtual.length) {
      wrap.innerHTML = '<div class="vazio-msg"><i class="bx bx-folder-open"></i>Nenhuma baixa encontrada.</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="wms-baixa-tabela"><thead><tr>' +
      '<th>Data</th><th>Documento</th><th>Dono</th><th>Motivo</th><th class="num">Linhas</th><th class="num">Qtd</th><th>Usuário</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' +
      listaAtual
        .map(function (b) {
          var st = String(b.ST_BAIXA || '').toUpperCase();
          var badge =
            st === 'ESTORNADO'
              ? '<span class="badge badge-est">ESTORNADO</span>'
              : '<span class="badge badge-ok">CONFIRMADO</span>';
          var mot = (b.COD_MOTIVO ? b.COD_MOTIVO + ' — ' : '') + (b.DS_MOTIVO || '');
          return (
            '<tr><td>' +
            esc(fmtDh(b.DH_BAIXA)) +
            '</td><td>' +
            esc(b.NR_DOCUMENTO) +
            '</td><td>' +
            esc((b.NM_DONO || '') + ' (' + b.CD_DONO + ')') +
            '</td><td>' +
            esc(mot) +
            '</td><td class="num">' +
            esc(b.Q_LINHAS) +
            '</td><td class="num">' +
            esc(fmtQtd(b.QTD_TOTAL)) +
            '</td><td>' +
            esc(b.SG_USER || '') +
            '</td><td>' +
            badge +
            '</td><td><button type="button" class="btn-acao btn-ver-baixa" data-id="' +
            esc(b.CD_BAIXA) +
            '" title="Ver documento"><i class="bx bx-show"></i> Ver</button></td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
  }

  function novaBaixa() {
    docLinhas = [];
    previewAtual = null;
    produtoResolvidoCache = null;
    document.getElementById('docObs').value = '';
    document.getElementById('docMarcarApontados').checked = false;
    document.getElementById('addCodigo').value = '';
    document.getElementById('addLote').value = '';
    document.getElementById('addValidade').value = '';
    document.getElementById('addQtd').value = '';
    setAddProdutoHint('');
    renderDocLinhas();
    abrirModalNovaBaixa();
  }

  async function importarShelf() {
    var cdDono = document.getElementById('docDono').value;
    if (!cdDono) {
      showMessage('Selecione o dono antes de importar.', 'error');
      return;
    }
    showLoadingOverlay('Importando shelf-life…', 'Montando linhas do documento.', '');
    await yieldRender();
    try {
      var body = Object.assign({ cdDono: parseInt(cdDono, 10) }, shelfBodyFromUi());
      var r = await api('/api/wms/baixas/importar-shelf', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha na importação.');
      var novas = j.linhas || [];
      if (!novas.length) {
        showMessage('Nenhuma linha retornada com os filtros atuais.', 'error');
        return;
      }
      docLinhas = novas;
      renderDocLinhas();
      showMessage('Importadas ' + novas.length + ' linha(s). Use Prévia antes de confirmar.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao importar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function setAddProdutoHint(texto, tipo) {
    var el = document.getElementById('addProdutoHint');
    if (!el) return;
    el.textContent = texto || 'Digite o código e aguarde a descrição, ou clique em +.';
    el.style.color = tipo === 'error' ? '#b91c1c' : tipo === 'ok' ? '#047857' : '';
  }

  async function resolverProdutoBaixa(cdDono, codigo) {
    var r = await api(
      '/api/wms/baixas/resolver-produto?cdDono=' +
        encodeURIComponent(cdDono) +
        '&codigo=' +
        encodeURIComponent(codigo)
    );
    var j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      var err = new Error(j.error || 'Produto não encontrado.');
      err.status = r.status;
      throw err;
    }
    return j;
  }

  async function onCodigoBlurOuEnter() {
    var cdDono = document.getElementById('docDono').value;
    var cod = document.getElementById('addCodigo').value.trim();
    produtoResolvidoCache = null;
    if (!cod) {
      setAddProdutoHint('');
      return;
    }
    if (!cdDono) {
      setAddProdutoHint('Selecione o dono do estoque antes.', 'error');
      return;
    }
    setAddProdutoHint('Buscando produto…');
    try {
      var hit = await resolverProdutoBaixa(cdDono, cod);
      produtoResolvidoCache = hit;
      var extras = [];
      if (hit.fgControlaLote === 'S') extras.push('controla lote');
      if (hit.fgControlaValidade === 'S') extras.push('controla validade');
      setAddProdutoHint(
        (hit.nmProduto || 'Produto ' + (hit.codigoProduto || cod)) +
          (extras.length ? ' · ' + extras.join(', ') : ''),
        'ok'
      );
    } catch (e) {
      setAddProdutoHint(e.message || 'Produto não encontrado.', 'error');
    }
  }

  async function addLinhaManual() {
    var cdDono = document.getElementById('docDono').value;
    if (!cdDono) {
      showMessage('Selecione o dono.', 'error');
      return;
    }
    var cod = document.getElementById('addCodigo').value.trim();
    var lote = document.getElementById('addLote').value.trim();
    var validade = document.getElementById('addValidade').value || '';
    var qtd = parseFloat(document.getElementById('addQtd').value);
    if (!cod) {
      showMessage('Informe o código do produto.', 'error');
      return;
    }
    if (!Number.isFinite(qtd) || qtd <= 0) {
      showMessage('Informe uma quantidade válida (> 0).', 'error');
      return;
    }

    var btn = document.getElementById('btnAddLinha');
    if (btn) btn.disabled = true;
    try {
      var hit = produtoResolvidoCache;
      if (!hit || String(hit.codigoInformado || '').trim() !== cod) {
        hit = await resolverProdutoBaixa(cdDono, cod);
        produtoResolvidoCache = hit;
      }
      if (!hit || hit.cdProduto == null) {
        showMessage('Produto não encontrado para este dono.', 'error');
        setAddProdutoHint('Produto não encontrado.', 'error');
        return;
      }

      var ctrlLote = hit.fgControlaLote === 'S';
      var ctrlVal = hit.fgControlaValidade === 'S';
      // Lote/validade só pelo cadastro do produto (FG_CONTROLA_*).
      // Motivo EXIGE_LOTE_VALIDADE não força em descartável/embalagem sem controle.
      if (ctrlVal && !validade) {
        showMessage('Este produto controla validade. Informe a data.', 'error');
        document.getElementById('addValidade').focus();
        return;
      }
      if (ctrlLote && !lote) {
        showMessage('Este produto controla lote. Informe o lote.', 'error');
        document.getElementById('addLote').focus();
        return;
      }

      docLinhas.push({
        CD_DONO: parseInt(cdDono, 10),
        CD_PRODUTO: hit.cdProduto,
        CODIGO_PRODUTO: hit.codigoProduto || cod,
        NM_PRODUTO: hit.nmProduto || null,
        LOTE: lote,
        VALIDADE: validade || null,
        QTD_BAIXA: qtd,
        QTD_SALDO_ESTIMADO: qtd,
      });
      document.getElementById('addCodigo').value = '';
      document.getElementById('addLote').value = '';
      document.getElementById('addValidade').value = '';
      document.getElementById('addQtd').value = '';
      produtoResolvidoCache = null;
      setAddProdutoHint('');
      renderDocLinhas();
      showMessage('Linha adicionada: ' + (hit.nmProduto || hit.codigoProduto || cod), 'success');
    } catch (e) {
      showMessage(e.message || 'Não foi possível validar o produto.', 'error');
      setAddProdutoHint(e.message || 'Produto não encontrado.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function previewDocumento() {
    var cdDono = document.getElementById('docDono').value;
    var cdMotivo = document.getElementById('docMotivo').value;
    if (!cdDono || !cdMotivo) {
      showMessage('Dono e motivo são obrigatórios.', 'error');
      return;
    }
    if (!docLinhas.length) {
      showMessage('Adicione ou importe linhas.', 'error');
      return;
    }
    showLoadingOverlay('Montando prévia…', 'Validando saldos e elegibilidade.', '');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas/preview', {
        method: 'POST',
        body: JSON.stringify({
          cdMotivoBaixa: parseInt(cdMotivo, 10),
          cdDono: parseInt(cdDono, 10),
          linhas: linhasParaPayload(),
        }),
      });
      var j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.erro || j.error || 'Prévia inválida.');
      previewAtual = j;
      abrirModalPreview(j);
    } catch (e) {
      showMessage(e.message || 'Erro na prévia.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function abrirModalPreview(preview) {
    var mot = preview.motivo || {};
    document.getElementById('modalPreviewResumo').textContent =
      (mot.codigo ? mot.codigo + ' — ' : '') +
      (mot.descricao || '') +
      ' · Elegíveis: ' +
      (preview.linhasElegiveis || 0) +
      ' · Bloqueadas: ' +
      (preview.linhasBloqueadas || 0);
    var av = document.getElementById('modalPreviewAvisos');
    if (preview.avisos && preview.avisos.length) {
      av.style.display = 'block';
      av.innerHTML = preview.avisos.map(esc).join('<br/>');
    } else {
      av.style.display = 'none';
    }
    var body = document.getElementById('modalPreviewBody');
    body.innerHTML = (preview.linhas || [])
      .map(function (l, idx) {
        var bloq = l.bloqueada;
        var qtdCell = bloq
          ? esc(fmtQtd(l.qtdBaixa))
          : '<input type="number" class="inp-prev-qtd form-control" data-idx="' +
            idx +
            '" min="0" step="0.001" value="' +
            esc(String(l.qtdBaixa)) +
            '" style="width:88px;padding:4px;" />';
        return (
          '<tr' +
          (bloq ? ' style="opacity:0.5"' : '') +
          '><td>' +
          esc(l.codigoProduto || '') +
          '</td><td>' +
          esc(l.lote || '—') +
          '</td><td>' +
          esc(fmtData(l.validade)) +
          '</td><td class="num">' +
          esc(fmtQtd(l.qtdSaldoEst)) +
          '</td><td class="num">' +
          qtdCell +
          '</td><td>' +
          esc(bloq ? 'Já baixada' : 'OK') +
          '</td></tr>'
        );
      })
      .join('');
    document.getElementById('modalPreviewBaixa').hidden = false;
  }

  function fecharModalPreview() {
    document.getElementById('modalPreviewBaixa').hidden = true;
    previewAtual = null;
  }

  async function confirmarDocumento() {
    if (!previewAtual) return;
    var linhas = [];
    (previewAtual.linhas || []).forEach(function (l, idx) {
      if (l.bloqueada) return;
      var inp = document.querySelector('#modalPreviewBody input.inp-prev-qtd[data-idx="' + idx + '"]');
      var qtd = inp ? parseFloat(inp.value) : l.qtdBaixa;
      if (!Number.isFinite(qtd) || qtd <= 0) return;
      linhas.push({
        CD_DONO: l.cdDono,
        CD_PRODUTO: l.cdProduto,
        LOTE: l.lote,
        VALIDADE: l.validade,
        QTD_BAIXA: qtd,
        CODIGO_PRODUTO: l.codigoProduto,
        NM_PRODUTO: l.nmProduto,
        QTD_SALDO_SKU: l.qtdSaldoSku,
        QTD_SALDO_ESTIMADO: l.qtdSaldoEst,
        DIAS_ATE_VENCIMENTO: l.diasAteVencimento,
      });
    });
    if (!linhas.length) {
      showMessage('Nenhuma linha elegível.', 'error');
      return;
    }
    showLoadingOverlay('Confirmando baixa…', 'Gravando documento e movimentos.', '');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas', {
        method: 'POST',
        body: JSON.stringify({
          cdMotivoBaixa: parseInt(document.getElementById('docMotivo').value, 10),
          cdDono: parseInt(document.getElementById('docDono').value, 10),
          linhas: linhas,
          observacao: document.getElementById('docObs').value.trim() || undefined,
          marcarApontados: document.getElementById('docMarcarApontados').checked,
          origem: 'MANUAL',
        }),
      });
      var j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.erro || j.error || 'Falha ao confirmar.');
      fecharModalPreview();
      fecharModalNovaBaixa();
      docLinhas = [];
      showMessage('Baixa confirmada · Doc. ' + (j.nrDocumento || ''), 'success');
      carregarLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao confirmar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function verDetalhe(cd) {
    showLoadingOverlay('Carregando documento…', 'Buscando linhas da baixa.', '');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas/' + cd);
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.erro || 'Não encontrado.');
      detalheAtual = j;
      var h = j.cabecalho || {};
      document.getElementById('detNrDoc').textContent = h.NR_DOCUMENTO || '';
      document.getElementById('detResumo').textContent =
        fmtDh(h.DH_BAIXA) +
        ' · ' +
        (h.NM_DONO || '') +
        ' · ' +
        (h.DS_MOTIVO || '') +
        ' · ' +
        (h.SG_USER || '') +
        (h.OBSERVACAO ? ' · ' + h.OBSERVACAO : '');
      document.getElementById('detLinhasBody').innerHTML = (j.linhas || [])
        .map(function (l) {
          return (
            '<tr><td>' +
            esc(l.CODIGO_PRODUTO) +
            '</td><td>' +
            esc(l.NM_PRODUTO || '') +
            '</td><td>' +
            esc(l.LOTE || '—') +
            '</td><td>' +
            esc(fmtData(l.VALIDADE)) +
            '</td><td class="num">' +
            esc(fmtQtd(l.QTD_BAIXA)) +
            '</td></tr>'
          );
        })
        .join('');
      var btnEst = document.getElementById('modalDetEstornar');
      btnEst.style.display = String(h.ST_BAIXA).toUpperCase() === 'CONFIRMADO' ? '' : 'none';
      document.getElementById('modalDetalheBaixa').hidden = false;
    } catch (e) {
      showMessage(e.message || 'Erro.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function imprimirDocumentoBaixa() {
    if (!detalheAtual || !detalheAtual.cabecalho) {
      showMessage('Abra um documento antes de imprimir.', 'error');
      return;
    }
    var cd = detalheAtual.cabecalho.CD_BAIXA;
    showLoadingOverlay('Montando impressão…', 'Gerando documento A4 para assinatura.', '');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas/' + cd + '/imprimir');
      if (!r.ok) {
        var errBody = await r.json().catch(function () {
          return {};
        });
        throw new Error(errBody.error || errBody.erro || 'HTTP ' + r.status);
      }
      var html = await r.text();
      var w = window.open('', '_blank');
      if (!w) {
        showMessage('Permita pop-up para abrir o documento de impressão.', 'error');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      showMessage('Documento aberto — use Imprimir na aba.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao gerar impressão.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function abrirModalEstorno() {
    document.getElementById('estornoMotivo').value = '';
    document.getElementById('modalEstornarBaixa').hidden = false;
  }

  function fecharModalEstorno() {
    document.getElementById('modalEstornarBaixa').hidden = true;
  }

  async function confirmarEstorno() {
    if (!detalheAtual || !detalheAtual.cabecalho) return;
    var cd = detalheAtual.cabecalho.CD_BAIXA;
    var motivo = document.getElementById('estornoMotivo').value.trim();
    showLoadingOverlay('Estornando…', 'Gerando movimento reverso no ledger.', '');
    await yieldRender();
    try {
      var r = await api('/api/wms/baixas/' + cd + '/estornar', {
        method: 'POST',
        body: JSON.stringify({ observacao: motivo || undefined }),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.erro || 'Falha no estorno.');
      fecharModalEstorno();
      document.getElementById('modalDetalheBaixa').hidden = true;
      detalheAtual = null;
      showMessage('Documento estornado.', 'success');
      carregarLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao estornar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function aplicarImportSession() {
    try {
      var raw = sessionStorage.getItem('wmsBaixaShelfImport');
      if (!raw) return;
      sessionStorage.removeItem('wmsBaixaShelfImport');
      var p = JSON.parse(raw);
      novaBaixa();
      if (p.cdDono) document.getElementById('docDono').value = String(p.cdDono);
      if (p.modo === 'cobranca' && p.somenteVencidos) {
        document.getElementById('docShelfModo').value = 'cobranca-vencidos';
      } else if (p.modo === 'cobranca') {
        document.getElementById('docShelfModo').value = 'cobranca';
      } else {
        document.getElementById('docShelfModo').value = 'saldo';
      }
      if (p.dataReferencia) document.getElementById('docShelfData').value = p.dataReferencia;
      if (p.horizonteDias) document.getElementById('docShelfHorizonte').value = p.horizonteDias;
      if (p.apontado) document.getElementById('docShelfApontado').value = p.apontado;
      if (p.cdMotivoBaixa) document.getElementById('docMotivo').value = String(p.cdMotivoBaixa);
      if (p.marcarApontados) document.getElementById('docMarcarApontados').checked = true;
      var shelfBox = document.getElementById('boxShelfImport');
      if (shelfBox) shelfBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (p.autoImport) importarShelf();
    } catch (e) {
      console.warn('[baixas] import session:', e);
    }
  }

  function bindEvents() {
    document.getElementById('btnNovaBaixa').addEventListener('click', novaBaixa);
    document.getElementById('btnFecharNovaBaixa').addEventListener('click', fecharModalNovaBaixa);
    document.getElementById('formFiltros').addEventListener('submit', function (e) {
      e.preventDefault();
      carregarLista();
    });
    document.getElementById('btnFiltrarLista').addEventListener('click', carregarLista);
    document.getElementById('btnLimparFiltros').addEventListener('click', function () {
      document.getElementById('filtroDono').value = '';
      document.getElementById('filtroDataInicio').value = '';
      document.getElementById('filtroDataFim').value = '';
      document.getElementById('filtroStatus').value = '';
      document.getElementById('filtroLimite').value = '100';
      carregarLista();
    });
    document.getElementById('btnImportarShelf').addEventListener('click', importarShelf);
    document.getElementById('btnAddLinha').addEventListener('click', addLinhaManual);
    document.getElementById('addCodigo').addEventListener('blur', onCodigoBlurOuEnter);
    document.getElementById('addCodigo').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCodigoBlurOuEnter();
      }
    });
    document.getElementById('btnPreviewDoc').addEventListener('click', previewDocumento);
    document.getElementById('modalPreviewCancelar').addEventListener('click', fecharModalPreview);
    document.getElementById('modalPreviewConfirmar').addEventListener('click', confirmarDocumento);
    document.getElementById('modalDetFechar').addEventListener('click', function () {
      document.getElementById('modalDetalheBaixa').hidden = true;
      detalheAtual = null;
    });
    document.getElementById('modalDetImprimir').addEventListener('click', imprimirDocumentoBaixa);
    document.getElementById('modalDetEstornar').addEventListener('click', abrirModalEstorno);
    document.getElementById('modalEstCancelar').addEventListener('click', fecharModalEstorno);
    document.getElementById('modalEstConfirmar').addEventListener('click', confirmarEstorno);

    document.getElementById('listaWrapper').addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-ver-baixa');
      if (btn) verDetalhe(btn.getAttribute('data-id'));
    });
    document.getElementById('docLinhasBody').addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-rm-linha');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx)) {
        docLinhas.splice(idx, 1);
        renderDocLinhas();
      }
    });
  }

  async function init() {
    bindEvents();
    showLoadingOverlay('Iniciando…', 'Carregando donos e motivos.', '');
    await yieldRender();
    try {
      await carregarDonos();
      await carregarMotivos();
      await carregarLista();
      aplicarImportSession();
    } catch (e) {
      showMessage(e.message || 'Erro ao iniciar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
