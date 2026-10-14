(function () {
  var inventarioAtual = null;
  var inventarioStatusAtual = '';
  var inventarioResumoAtual = [];
  var inventarioCdDonoAtual = null;
  var ultimosErrosImport = [];
  var cadastroErroIndice = null;
  var donosCache = [];
  var listaCarregando = false;
  var detalheLinhasCache = [];
  var detalheRenderCtx = null;
  var detalheFiltrosLinhasOk = false;
  var consultaItensCache = [];
  var consultaCarregando = false;

  function authHeaders(extra) {
    var h = extra || {};
    var t = localStorage.getItem('token');
    if (t) h.Authorization = 'Bearer ' + t;
    var u = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (u) h['X-User-Login'] = u;
    return h;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = authHeaders(opts.headers || {});
    opts.credentials = 'same-origin';
    var url = path;
    if (typeof window.corrigirUrl === 'function' && String(path).indexOf('http') !== 0) {
      url = window.corrigirUrl(path);
    }
    return fetch(url, opts);
  }

  function showMessage(text, type) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, document.getElementById('message'));
      return;
    }
    var el = document.getElementById('message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (type || '');
    el.style.display = text ? 'block' : 'none';
  }

  function getInvOverlayEl() {
    var root = document.querySelector('.wms-inv-container');
    if (root) {
      var scoped = root.querySelector('#wmsInvLoadingOverlay');
      if (scoped) return scoped;
    }
    return document.getElementById('wmsInvLoadingOverlay');
  }

  /** Remove overlay de outros módulos deixado em document.body (ex.: Cadastros com display:flex !important). */
  function limparOverlaysOrfaosBody() {
    document.querySelectorAll('body > #loadingOverlay.calculando-overlay').forEach(function (el) {
      el.remove();
    });
  }

  function showLoadingOverlay(titulo, texto, det) {
    limparOverlaysOrfaosBody();
    var o = getInvOverlayEl();
    if (!o) return;
    var lt = document.getElementById('wmsInvLoadingTitle');
    var lx = document.getElementById('wmsInvLoadingText');
    var ld = document.getElementById('wmsInvLoadingDetalhe');
    if (lt) lt.textContent = titulo || 'Carregando';
    if (lx) lx.textContent = texto || 'Aguarde...';
    if (ld) ld.textContent = det || '';
    if (o.parentNode !== document.body) document.body.appendChild(o);
    o.style.cssText =
      'display:flex !important; position:fixed !important; top:0; left:0; right:0; bottom:0; z-index:99999; background:rgba(0,0,0,0.75); align-items:center; justify-content:center;';
  }

  function hideLoadingOverlay() {
    limparOverlaysOrfaosBody();
    var o = getInvOverlayEl();
    if (!o) return;
    o.style.cssText = 'display:none !important;';
    var root = document.querySelector('.wms-inv-container');
    if (o.parentNode === document.body && root) {
      root.insertBefore(o, root.firstChild);
    }
  }

  async function yieldPaint() {
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
  }

  function confirmar(msg, extra) {
    extra = extra || {};
    return new Promise(function (resolve) {
      var modal = document.getElementById('confirmModal');
      var yes = document.getElementById('confirmYes');
      var no = document.getElementById('confirmNo');
      if (!modal || !yes || !no) {
        if (typeof window.confirmPadrao === 'function') {
          window.confirmPadrao(msg, {
            title: extra.titulo || 'Confirmar Ação',
            danger: !!extra.danger,
            confirmText: extra.okLabel || 'Confirmar',
            cancelText: 'Cancelar',
          }).then(function (ok) { resolve(!!ok); });
        } else {
          resolve(window.confirm(msg));
        }
        return;
      }
      document.getElementById('modalMessage').textContent = msg;
      yes.className = extra.danger ? 'btn-filtro btn-filtro-danger' : 'btn-filtro btn-filtro-aplicar';
      yes.innerHTML = "<i class='bx bx-check'></i> " + (extra.okLabel || 'Confirmar');
      yes.onclick = function () {
        modal.style.display = 'none';
        resolve(true);
      };
      no.onclick = function () {
        modal.style.display = 'none';
        resolve(false);
      };
      modal.style.display = 'flex';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** HTML dos botões da coluna Ações (Dividir / Recontar / Aprovar / Excluir). */
  function montarHtmlAcoesLinha(l, canEditarLinhas) {
    if (!canEditarLinhas) return '';
    var stLinha = String(l.ST_LINHA || 'PENDENTE').toUpperCase();
    var acoes = '';
    acoes +=
      '<button type="button" class="btn-acao-linha btn-acao-dividir" data-cd-linha="' +
      esc(l.CD_LINHA) +
      '" title="Dividir este SKU em outra linha com lote/validade diferentes (mesmo produto)"><i class="bx bx-git-branch"></i></button> ';
    if (['CONTADO', 'DIVERGENTE', 'APROVADO'].indexOf(stLinha) >= 0) {
      acoes +=
        '<button type="button" class="btn-acao-linha btn-acao-recontar" data-cd-linha="' +
        esc(l.CD_LINHA) +
        '" title="Apaga a contagem e marca para recontar"><i class="bx bx-refresh"></i></button> ';
    }
    if (stLinha === 'DIVERGENTE') {
      acoes +=
        '<button type="button" class="btn-acao-linha btn-acao-aprovar" data-cd-linha="' +
        esc(l.CD_LINHA) +
        '" title="Supervisor aprova esta divergência"><i class="bx bx-check-shield"></i></button> ';
    }
    acoes +=
      '<button type="button" class="btn-acao-linha btn-acao-excluir" data-cd-linha="' +
      esc(l.CD_LINHA) +
      '" data-codigo="' +
      esc(l.CODIGO_PRODUTO || '') +
      '" data-qtd-contada="' +
      esc(l.QTD_CONTADA != null ? l.QTD_CONTADA : '') +
      '" title="Excluir esta linha do inventário (não afeta saldo do estoque)"><i class="bx bx-trash"></i></button>';
    return acoes;
  }

  /** Exibição: máscara do dono (Cadastros → Dono do estoque), sem alterar dado gravado na linha. */
  function applyProductMask(value, mask) {
    var m = String(mask || '')
      .trim()
      .toUpperCase();
    if (!m) return String(value || '').trim();
    var src = String(value || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    if (!src) return String(value || '').trim();
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

  function codigoExibicao(codigo, mascaraDono) {
    var c = String(codigo || '').trim();
    if (!c) return '';
    var mk = String(mascaraDono || '').trim();
    return mk ? applyProductMask(c, mk) : c;
  }

  /** Código mascarado + descrição do cadastro (ex.: 6.21.05.829.20 - TAMPA …). */
  function rotuloProdutoLinha(codigo, nome, mascaraDono) {
    var cod = codigoExibicao(codigo, mascaraDono);
    var nom = nome != null ? String(nome).trim() : '';
    if (cod && nom) return cod + ' - ' + nom;
    if (cod) return cod;
    if (nom) return nom;
    return '—';
  }

  function fmtDh(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('pt-BR');
    } catch (_) {
      return String(v);
    }
  }

  /** Formata quantidade para exibição: inteiros sem decimais, decimais
   *  com até 3 casas (apropriado para gramas/litros). Vazio = "—". */
  function fmtQtd(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    // Inteiros exibem sem parte decimal (1709 em vez de 1709.000000)
    if (Math.abs(n - Math.round(n)) < 1e-9) {
      return Math.round(n).toLocaleString('pt-BR');
    }
    // Não-inteiros: até 3 casas, removendo zeros à direita
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  /** Valor para input type=date (YYYY-MM-DD) — evita "Thu Aug 20" vindo do banco. */
  function fmtValidadeInput(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      var d = String(v.getUTCDate()).padStart(2, '0');
      var m = String(v.getUTCMonth() + 1).padStart(2, '0');
      return v.getUTCFullYear() + '-' + m + '-' + d;
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    var parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      return (
        parsed.getUTCFullYear() +
        '-' +
        String(parsed.getUTCMonth() + 1).padStart(2, '0') +
        '-' +
        String(parsed.getUTCDate()).padStart(2, '0')
      );
    }
    return s.slice(0, 10);
  }

  function ativarTab(name) {
    document.querySelectorAll('.wms-inv-container .tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.wms-inv-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    var panel = document.getElementById('tab-' + name);
    if (panel) panel.classList.add('active');
  }

  document.querySelectorAll('.wms-inv-container .tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ativarTab(btn.getAttribute('data-tab'));
      if (btn.getAttribute('data-tab') === 'orientacao' && !document.getElementById('orientacaoDoc').innerHTML) {
        carregarMarkdown('/api/wms/inventario/orientacao', 'orientacaoLoading', 'orientacaoDoc');
      }
      if (btn.getAttribute('data-tab') === 'manual' && !document.getElementById('manualDoc').innerHTML) {
        carregarMarkdown('/api/wms/inventario/manual-operador', 'manualLoading', 'manualDoc');
      }
    });
  });

  async function carregarMarkdown(url, loadId, docId) {
    var loading = document.getElementById(loadId);
    var doc = document.getElementById(docId);
    if (!doc) return;
    if (loading) loading.style.display = 'block';
    doc.style.display = 'none';
    try {
      var res = await api(url, { headers: { Accept: 'text/markdown' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var md = await res.text();
      doc.innerHTML =
        typeof marked !== 'undefined' && marked.parse ? marked.parse(md, { gfm: true }) : '<pre>' + esc(md) + '</pre>';
      if (loading) loading.style.display = 'none';
      doc.style.display = 'block';
    } catch (e) {
      if (loading) loading.textContent = 'Erro ao carregar: ' + (e.message || e);
    }
  }

  function preencherSelectDonos(sel, incluirTodos) {
    if (!sel) return;
    var html = incluirTodos
      ? '<option value="">Todos</option>'
      : '<option value="">— Selecione —</option>';
    donosCache.forEach(function (d) {
      html +=
        '<option value="' +
        esc(d.CD_DONO) +
        '">' +
        esc(d.CD_DONO + ' — ' + (d.NOME || d.CODIGO || '')) +
        '</option>';
    });
    sel.innerHTML = html;
  }

  async function carregarDonos() {
    var res = await api('/api/wms/donos-estoque');
    if (!res.ok) throw new Error('Não foi possível carregar donos.');
    donosCache = await res.json();
    preencherSelectDonos(document.getElementById('novoCdDono'), false);
    preencherSelectDonos(document.getElementById('filtroDono'), true);
    preencherSelectDonos(document.getElementById('consultaDono'), true);
    preencherSelectDonos(document.getElementById('cicloDono'), false);
  }

  async function carregarConsultaItens() {
    if (consultaCarregando) return;
    var cod = String(document.getElementById('consultaCodigo').value || '').trim();
    var desc = String(document.getElementById('consultaDescricao').value || '').trim();
    var cdInv = String(document.getElementById('consultaCdInv').value || '').trim();
    if (cod.replace(/[^0-9A-Za-z]/g, '').length < 2 && desc.length < 2 && !cdInv) {
      showMessage('Informe código (mín. 2 caracteres), descrição ou nº do inventário.', 'error');
      return;
    }
    consultaCarregando = true;
    var q = new URLSearchParams();
    var dono = document.getElementById('consultaDono').value;
    var st = document.getElementById('consultaSt').value;
    var tp = document.getElementById('consultaTp').value;
    var dtDe = document.getElementById('consultaDtDe').value;
    var dtAte = document.getElementById('consultaDtAte').value;
    if (dono) q.set('cd_dono', dono);
    if (cod) q.set('codigo', cod);
    if (desc) q.set('descricao', desc);
    if (cdInv) q.set('cd_inventario', cdInv);
    if (st) q.set('st', st);
    if (tp) q.set('tp', tp);
    if (dtDe) q.set('dt_de', dtDe);
    if (dtAte) q.set('dt_ate', dtAte);
    showLoadingOverlay('Consultando', 'Buscando histórico de inventário…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/consulta-itens?' + q.toString());
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      consultaItensCache = body.linhas || [];
      renderConsultaItens(body);
      var btnCsv = document.getElementById('btnExportConsultaCsv');
      if (btnCsv) btnCsv.disabled = !consultaItensCache.length;
    } catch (e) {
      showMessage(e.message || 'Erro na consulta.', 'error');
    } finally {
      consultaCarregando = false;
      hideLoadingOverlay();
    }
  }

  function fmtDataCurta(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('pt-BR');
    } catch (_) {
      return String(v);
    }
  }

  function renderConsultaItens(payload) {
    var tb = document.getElementById('tblConsultaItensBody');
    var resumo = document.getElementById('consultaResumo');
    if (!tb) return;
    var rows = payload.linhas || [];
    if (resumo) {
      var txt = rows.length
        ? rows.length + ' linha(s) encontrada(s)'
        : 'Nenhuma linha encontrada com estes filtros.';
      if (payload.truncado) {
        txt += ' — exibindo as primeiras ' + (payload.limit || 500) + '; refine código, período ou dono.';
      }
      resumo.textContent = txt;
    }
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="14">Nenhum registro.</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map(function (r) {
        var mascara = r.MASCARA_CODIGO_PRODUTO || '';
        var codEx = codigoExibicao(r.CODIGO_PRODUTO, mascara);
        var stInv = String(r.ST_INVENTARIO || '');
        var stLin = String(r.ST_LINHA || 'PENDENTE');
        var ajuste = r.QTD_AJUSTE_LINHA;
        return (
          '<tr>' +
          '<td>' +
          esc(r.CD_INVENTARIO) +
          '</td>' +
          '<td>' +
          esc(r.NM_DONO || r.CD_DONO) +
          '</td>' +
          '<td>' +
          esc(r.TP_INVENTARIO) +
          '</td>' +
          '<td><span class="st-badge st-' +
          esc(stInv) +
          '">' +
          esc(stInv) +
          '</span></td>' +
          '<td>' +
          esc(fmtDataCurta(r.DH_ENCERRAMENTO || r.DH_ABERTURA)) +
          '</td>' +
          '<td>' +
          esc(codEx) +
          '</td>' +
          '<td>' +
          esc(r.NM_PRODUTO || '—') +
          '</td>' +
          '<td>' +
          esc(r.LOTE || '—') +
          '</td>' +
          '<td>' +
          esc(r.VALIDADE || '—') +
          '</td>' +
          '<td class="num">' +
          esc(fmtQtd(r.QTD_SISTEMA_SNAPSHOT)) +
          '</td>' +
          '<td class="num">' +
          esc(fmtQtd(r.QTD_CONTADA_CONV)) +
          '</td>' +
          '<td class="num">' +
          esc(ajuste != null ? fmtQtd(ajuste) : '—') +
          '</td>' +
          '<td><span class="ciclo-badge ciclo-badge-' +
          esc(stLin) +
          '">' +
          esc(stLin) +
          '</span></td>' +
          '<td><button type="button" class="btn-filtro btn-filtro-aplicar btn-consulta-ver" data-cd="' +
          esc(r.CD_INVENTARIO) +
          '" title="Abrir documento completo"><i class="bx bx-show"></i></button></td>' +
          '</tr>'
        );
      })
      .join('');
    tb.querySelectorAll('.btn-consulta-ver').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cd = parseInt(btn.getAttribute('data-cd'), 10);
        if (!Number.isFinite(cd)) return;
        ativarTab('operacao');
        abrirDetalhe(cd);
      });
    });
  }

  function exportarConsultaCsv() {
    if (!consultaItensCache.length) return;
    var cols = [
      'CD_INVENTARIO',
      'NM_DONO',
      'TP_INVENTARIO',
      'ST_INVENTARIO',
      'DH_ENCERRAMENTO',
      'CODIGO_PRODUTO',
      'NM_PRODUTO',
      'LOTE',
      'VALIDADE',
      'QTD_SISTEMA_SNAPSHOT',
      'QTD_CONTADA_CONV',
      'QTD_AJUSTE_LINHA',
      'ST_LINHA',
    ];
    function escCsv(v) {
      var s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var head = cols.join(';');
    var body = consultaItensCache
      .map(function (r) {
        return cols
          .map(function (c) {
            if (c === 'DH_ENCERRAMENTO') {
              return escCsv(r.DH_ENCERRAMENTO || r.DH_ABERTURA || '');
            }
            return escCsv(r[c]);
          })
          .join(';');
      })
      .join('\n');
    var blob = new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wms-inventario-consulta-itens.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function carregarLista() {
    if (listaCarregando) return;
    listaCarregando = true;
    var cd = document.getElementById('filtroDono').value;
    var q = cd ? '?cd_dono=' + encodeURIComponent(cd) : '';
    showLoadingOverlay('Carregando', 'Buscando inventários…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario' + q);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var rows = await res.json();
      hideLoadingOverlay();
      var tb = document.getElementById('tblInventariosBody');
      if (!tb) return;
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="7">Nenhum inventário.</td></tr>';
        return;
      }
      tb.innerHTML = rows
        .map(function (r) {
          var st = String(r.ST_INVENTARIO || '');
          return (
            '<tr>' +
            '<td>' +
            esc(r.CD_INVENTARIO) +
            '</td>' +
            '<td>' +
            esc(r.NM_DONO || r.CD_DONO) +
            '</td>' +
            '<td>' +
            esc(r.TP_INVENTARIO) +
            '</td>' +
            '<td><span class="st-badge st-' +
            esc(st) +
            '">' +
            esc(st) +
            '</span></td>' +
            '<td>' +
            esc(fmtDh(r.DH_CORTE)) +
            '</td>' +
            '<td>' +
            esc(r.Q_LINHAS) +
            '</td>' +
            '<td><button type="button" class="btn-filtro btn-filtro-aplicar btn-ver" data-cd="' +
            esc(r.CD_INVENTARIO) +
            '"><i class="bx bx-show"></i> Ver</button></td>' +
            '</tr>'
          );
        })
        .join('');
      tb.querySelectorAll('.btn-ver').forEach(function (btn) {
        btn.addEventListener('click', function () {
          abrirDetalhe(parseInt(btn.getAttribute('data-cd'), 10));
        });
      });
    } catch (e) {
      hideLoadingOverlay();
      showMessage(e.message || 'Erro ao listar inventários.', 'error');
    } finally {
      listaCarregando = false;
      hideLoadingOverlay();
    }
  }

  function mostrarLista() {
    document.getElementById('viewLista').hidden = false;
    document.getElementById('viewDetalhe').hidden = true;
    inventarioAtual = null;
    inventarioCdDonoAtual = null;
    ultimosErrosImport = [];
    esconderPainelErros();
  }

  function esconderPainelErros() {
    var p = document.getElementById('painelErrosImport');
    if (p) p.hidden = true;
  }

  function renderPainelErros(erros) {
    var p = document.getElementById('painelErrosImport');
    var tb = document.getElementById('tblErrosImportBody');
    if (!p || !tb) return;
    ultimosErrosImport = Array.isArray(erros) ? erros : [];
    if (!ultimosErrosImport.length) {
      p.hidden = true;
      tb.innerHTML = '';
      return;
    }
    p.hidden = false;
    tb.innerHTML = ultimosErrosImport
      .map(function (e, idx) {
        var row = e.row || {};
        var qtd = row.qtdContada != null ? row.qtdContada : '—';
        var acoes = '';
        if (e.podeCadastrar) {
          acoes =
            '<button type="button" class="btn-filtro btn-filtro-novo btn-cad-erro" data-idx="' +
            idx +
            '" style="padding:8px 12px;font-size:13px;"><i class="bx bx-plus"></i> Cadastrar</button> ' +
            '<button type="button" class="btn-filtro btn-filtro-aplicar btn-reimp-erro" data-idx="' +
            idx +
            '" style="padding:8px 12px;font-size:13px;"><i class="bx bx-revision"></i> Reimportar</button>';
        } else if (e.row) {
          acoes =
            '<button type="button" class="btn-filtro btn-filtro-aplicar btn-reimp-erro" data-idx="' +
            idx +
            '" style="padding:8px 12px;font-size:13px;"><i class="bx bx-revision"></i> Reimportar</button>';
        }
        return (
          '<tr><td>' +
          esc(e.linha) +
          '</td><td>' +
          esc(e.codigo) +
          '</td><td>' +
          esc(qtd) +
          '</td><td>' +
          esc(row.lote || '—') +
          '</td><td>' +
          esc(row.validade || '—') +
          '</td><td>' +
          esc(e.erro) +
          '</td><td style="white-space:nowrap;">' +
          acoes +
          '</td></tr>'
        );
      })
      .join('');
    tb.querySelectorAll('.btn-cad-erro').forEach(function (btn) {
      btn.addEventListener('click', function () {
        abrirModalCadastro(parseInt(btn.getAttribute('data-idx'), 10));
      });
    });
    tb.querySelectorAll('.btn-reimp-erro').forEach(function (btn) {
      btn.addEventListener('click', function () {
        reimportarLinhaIndice(parseInt(btn.getAttribute('data-idx'), 10));
      });
    });
  }

  async function processarResultadoImport(body) {
    var erros = (body && body.erros) || [];
    renderPainelErros(erros);
    var msg = 'Importadas: ' + ((body && body.importadas) || 0);
    if (erros.length) {
      msg += '. Não importadas: ' + erros.length + ' — veja o painel abaixo.';
    }
    showMessage(msg, erros.length ? 'warning' : 'success');
    await abrirDetalhe(inventarioAtual);
  }

  async function importarLinhasApi(linhas) {
    var res = await api('/api/wms/inventario/' + inventarioAtual + '/importar-linhas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linhas: linhas }),
    });
    var body = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
    return body;
  }

  async function reimportarLinhaIndice(idx) {
    var item = ultimosErrosImport[idx];
    if (!item || !item.row || !inventarioAtual) return;
    showLoadingOverlay('Importando', 'Reimportando linha…', esc(item.codigo));
    await yieldPaint();
    try {
      var body = await importarLinhasApi([item.row]);
      await processarResultadoImport(body);
    } catch (e) {
      showMessage(e.message || 'Erro ao reimportar linha.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function abrirModalCadastro(idx) {
    var item = ultimosErrosImport[idx];
    if (!item || !item.podeCadastrar) return;
    cadastroErroIndice = idx;
    var row = item.row || {};
    var modal = document.getElementById('modalCadProdInv');
    document.getElementById('cadCodigo').value = String(item.codigo || row.codigoProduto || '').trim();
    document.getElementById('cadNome').value = '';
    document.getElementById('cadUnidade').value = '';
    document.getElementById('cadFgLote').checked = !!(row.lote && String(row.lote).trim());
    document.getElementById('cadFgVal').checked = !!(row.validade && String(row.validade).trim());
    if (modal) {
      modal.hidden = false;
      modal.classList.add('aberto');
      if (modal.parentNode !== document.body) document.body.appendChild(modal);
    }
    setTimeout(function () {
      document.getElementById('cadNome').focus();
    }, 80);
  }

  function fecharModalCadastro() {
    var modal = document.getElementById('modalCadProdInv');
    cadastroErroIndice = null;
    if (modal) {
      modal.classList.remove('aberto');
      modal.hidden = true;
    }
  }

  async function salvarCadastroEReimportar() {
    if (cadastroErroIndice == null || !Number.isFinite(inventarioCdDonoAtual)) return;
    var item = ultimosErrosImport[cadastroErroIndice];
    if (!item || !item.row) return;
    var nome = String(document.getElementById('cadNome').value || '').trim();
    if (!nome) {
      showMessage('Informe o nome do produto.', 'error');
      return;
    }
    var payload = {
      CD_DONO: inventarioCdDonoAtual,
      CODIGO: document.getElementById('cadCodigo').value,
      NOME: nome,
      UNIDADE: String(document.getElementById('cadUnidade').value || '').trim() || null,
      FG_CONTROLA_LOTE: document.getElementById('cadFgLote').checked ? 'S' : 'N',
      FG_CONTROLA_VALIDADE: document.getElementById('cadFgVal').checked ? 'S' : 'N',
      FGACTIVE: 'S',
    };
    showLoadingOverlay('Cadastrando', 'Salvando produto…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/produtos-dono', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var bodyCad = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(bodyCad.error || 'HTTP ' + res.status);
      fecharModalCadastro();
      var bodyImp = await importarLinhasApi([item.row]);
      await processarResultadoImport(bodyImp);
    } catch (e) {
      showMessage(e.message || 'Erro ao cadastrar produto.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  /** Recalcula contadores (PENDENTE/CONTADO/DIVERGENTE/RECONTAR/APROVADO)
   *  varrendo os badges da tabela de linhas. Usado após cada edição inline
   *  para evitar recarregar o detalhe inteiro (perda de foco/digitação). */
  function atualizarContadoresLocalmente() {
    var contadores = { PENDENTE: 0, CONTADO: 0, DIVERGENTE: 0, RECONTAR: 0, APROVADO: 0 };
    var fonte = detalheLinhasCache && detalheLinhasCache.length ? detalheLinhasCache : null;
    if (fonte) {
      fonte.forEach(function (l) {
        var st = statusLinhaFiltro(l);
        if (contadores[st] != null) contadores[st]++;
      });
    } else {
      document.querySelectorAll('#tblLinhasBody .td-status-linha .ciclo-badge').forEach(function (b) {
        var txt = (b.textContent || '').trim().toUpperCase().split(/\s+/)[0];
        if (contadores[txt] != null) contadores[txt]++;
      });
    }
    var painel = document.getElementById('cicloContadores');
    if (!painel) return;
    var nomes = { PENDENTE: 'pendentes', CONTADO: 'contados', DIVERGENTE: 'divergentes', RECONTAR: 'recontar', APROVADO: 'aprovados' };
    Object.keys(contadores).forEach(function (k) {
      var el = painel.querySelector('[data-ct="' + k + '"]');
      if (el) el.textContent = contadores[k] + ' ' + nomes[k];
    });
  }

  function statusLinhaFiltro(l) {
    return String(l.ST_LINHA || 'PENDENTE').toUpperCase();
  }

  function linhaPassaFiltroTabela(l) {
    var selSt = document.getElementById('filtroStLinha');
    var stF = selSt ? String(selSt.value || '').trim().toUpperCase() : '';
    if (stF) {
      var st = statusLinhaFiltro(l);
      if (stF === '__ACAO__') {
        if (st !== 'PENDENTE' && st !== 'DIVERGENTE' && st !== 'RECONTAR') return false;
      } else if (st !== stF) return false;
    }
    var inpCod = document.getElementById('filtroCodigoLinha');
    var q = inpCod ? String(inpCod.value || '').trim().replace(/[^0-9A-Za-z]/g, '') : '';
    if (q) {
      var cod = String(l.CODIGO_PRODUTO || '').replace(/[^0-9A-Za-z]/g, '');
      if (cod.toUpperCase().indexOf(q.toUpperCase()) < 0) return false;
    }
    return true;
  }

  function valorOrdemItemDetalhe(r, campo) {
    if (campo === 'saldo') {
      var n =
        r.QTD_SISTEMA_SNAPSHOT != null && r.QTD_SISTEMA_SNAPSHOT !== ''
          ? Number(r.QTD_SISTEMA_SNAPSHOT)
          : r.QTD_SALDO_SKU_ATUAL != null && r.QTD_SALDO_SKU_ATUAL !== ''
            ? Number(r.QTD_SALDO_SKU_ATUAL)
            : Number(r.QTD_SISTEMA_SKU);
      return Number.isFinite(n) ? n : 0;
    }
    return valorOrdemLinhaCiclo(r, campo);
  }

  function ordenarItensDetalhe(itens, ordem) {
    var ord =
      ordem && ordem.length
        ? ordem.slice()
        : ['conservacao', 'grupo', 'subcategoria', 'codigo', 'lote', 'validade'];
    return (itens || []).slice().sort(function (a, b) {
      for (var i = 0; i < ord.length; i++) {
        var campo = ord[i];
        if (campo === 'saldo') {
          var na = valorOrdemItemDetalhe(a, campo);
          var nb = valorOrdemItemDetalhe(b, campo);
          if (na !== nb) return na - nb;
        } else {
          var c = String(valorOrdemItemDetalhe(a, campo) || '').localeCompare(
            String(valorOrdemItemDetalhe(b, campo) || ''),
            'pt-BR',
            { sensitivity: 'base' }
          );
          if (c !== 0) return c;
        }
      }
      return String(a.CODIGO_PRODUTO || '').localeCompare(String(b.CODIGO_PRODUTO || ''), 'pt-BR');
    });
  }

  function lerLayoutDetalheTela() {
    var modoSep = lerSeparadoresRelatorio('invAtaSeparadores');
    return {
      modoSep: modoSep,
      camposQuebra: camposQuebraSeparadores(modoSep),
      ordem: lerOrdemRelatorio('invAtaOrd'),
    };
  }

  function rotuloSeparadorDetalhe(r, campos) {
    var partes = [];
    (campos || []).forEach(function (c) {
      if (c === 'conservacao') partes.push(rotuloConservacaoJs(r, false));
      else if (c === 'conservacao_faixas') partes.push(rotuloConservacaoJs(r, true));
      else if (c === 'grupo') partes.push(rotuloGrupoWmsJs(r && r._cadWms));
      else if (c === 'subcategoria') partes.push(rotuloSubcategoriaWmsJs(r && r._cadWms));
    });
    return partes.filter(Boolean).join(' — ') || '—';
  }

  function chaveSeparadorDetalhe(r, campos) {
    return (campos || []).map(function (c) { return valorOrdemItemDetalhe(r, c); }).join('\u0001');
  }

  function htmlFaixaSeparadorDetalhe(rotulo, colspan) {
    return (
      '<tr class="inv-grp-sep"><td colspan="' +
      colspan +
      '"><span class="inv-grp-bullet">▌</span>' +
      esc(rotulo) +
      '</td></tr>'
    );
  }

  var ROTULOS_ORDEM_INV = {
    conservacao: 'Conservação',
    grupo: 'Grupo',
    subcategoria: 'Categoria',
    codigo: 'Código',
    nome: 'Descrição',
    lote: 'Lote',
    validade: 'Validade',
    saldo: 'Saldo sist.',
  };

  var ROTULOS_SEP_INV = {
    nao: 'Sem separadores',
    faixas_cons: 'Faixas SECO/REFRIG./CONG.',
    conservacao: 'Conservação',
    cons_grupo: 'Conservação + Grupo',
    cons_grupo_cat: 'Conservação + Grupo + Categoria',
  };

  function textoResumoLayoutInventario() {
    var layout = lerLayoutDetalheTela();
    var ordTxt = (layout.ordem || [])
      .map(function (c) {
        return ROTULOS_ORDEM_INV[c] || c;
      })
      .join(' → ');
    if (!ordTxt) ordTxt = 'padrão';
    var sepTxt = ROTULOS_SEP_INV[layout.modoSep] || layout.modoSep || 'Sem separadores';
    return 'Ordenação: ' + ordTxt + ' · Separadores: ' + sepTxt;
  }

  function atualizarResumoLayoutLinhas() {
    var txt = textoResumoLayoutInventario();
    var compacto = document.getElementById('invLayoutResumoCompacto');
    if (compacto) compacto.textContent = txt;
    var ref = document.getElementById('invLayoutResumoLinhas');
    if (ref) {
      ref.innerHTML =
        '<strong>Exibição:</strong> ' +
        esc(txt) +
        ' · <button type="button" class="inv-layout-link" id="btnIrLayoutInv">Alterar layout</button>';
      var btn = document.getElementById('btnIrLayoutInv');
      if (btn) {
        btn.onclick = function () {
          var box = document.getElementById('invAtaLayoutBox');
          if (box) {
            box.open = true;
            if (typeof box.scrollIntoView === 'function') {
              box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            var sep = document.getElementById('invAtaSeparadores');
            if (sep && typeof sep.focus === 'function') sep.focus();
          }
        };
      }
    }
  }

  var layoutDetalheTelaOk = false;

  function vincularLayoutDetalheTela() {
    if (layoutDetalheTelaOk) return;
    layoutDetalheTelaOk = true;
    ['invAtaSeparadores', 'invAtaOrd1', 'invAtaOrd2', 'invAtaOrd3'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        atualizarResumoLayoutLinhas();
        renderTabelaResumoDetalhe();
        renderTabelaLinhasFiltrada();
      });
    });
  }

  function renderTabelaResumoDetalhe(mascaraDono) {
    var tr = document.getElementById('tblResumoBody');
    var resumoLegenda = document.getElementById('invResumoLegenda');
    if (!tr) return;
    var resumo = inventarioResumoAtual || [];
    if (!resumo.length) {
      tr.innerHTML = '<tr><td colspan="5">Nenhum SKU com quantidade contada ainda.</td></tr>';
      if (resumoLegenda) resumoLegenda.textContent = '';
      return;
    }
    var layout = lerLayoutDetalheTela();
    var itens = ordenarItensDetalhe(resumo, layout.ordem);
    var nAjuste = resumo.filter(function (r) {
      return Math.abs(Number(r.QTD_AJUSTE_SKU) || 0) >= 1e-9;
    }).length;
    var nOk = resumo.length - nAjuste;
    var html = '';
    var chaveAnterior = null;
    itens.forEach(function (r) {
      if (layout.camposQuebra.length) {
        var chaveAtual = chaveSeparadorDetalhe(r, layout.camposQuebra);
        if (chaveAtual !== chaveAnterior) {
          html += htmlFaixaSeparadorDetalhe(rotuloSeparadorDetalhe(r, layout.camposQuebra), 5);
          chaveAnterior = chaveAtual;
        }
      }
      var aj = Number(r.QTD_AJUSTE_SKU);
      var cls = Math.abs(aj) < 1e-9 ? 'ajuste-ok' : aj > 0 ? 'ajuste-pos' : 'ajuste-neg';
      var ajTxt = Math.abs(aj) < 1e-9 ? '0 · OK' : fmtQtd(r.QTD_AJUSTE_SKU);
      var contadoHtml = esc(fmtQtd(r.QTD_CONTADA_SKU));
      if (Number(r.Q_LINHAS_CONTADAS) > 1) {
        contadoHtml +=
          ' <small style="color:#64748b;font-weight:normal" title="Soma de ' +
          esc(String(r.Q_LINHAS_CONTADAS)) +
          ' linhas (validades/lotes)">(' +
          esc(String(r.Q_LINHAS_CONTADAS)) +
          ' linhas)</small>';
      }
      var sistemaHtml = esc(fmtQtd(r.QTD_SISTEMA_SKU));
      if (r.DIVERGENCIA_SNAPSHOT) {
        sistemaHtml +=
          ' <small style="color:#c2410c;font-weight:600" title="Snapshot gravado na linha do inventário">' +
          '⚠ snap ' +
          esc(fmtQtd(r.QTD_SNAPSHOT_REF)) +
          '</small>';
      }
      html +=
        '<tr><td>' +
        esc(codigoExibicao(r.CODIGO_PRODUTO, mascaraDono)) +
        '</td><td>' +
        esc(r.NM_PRODUTO) +
        '</td><td>' +
        sistemaHtml +
        '</td><td>' +
        contadoHtml +
        '</td><td class="' +
        cls +
        '">' +
        esc(ajTxt) +
        '</td></tr>';
    });
    tr.innerHTML = html;
    if (resumoLegenda) {
      resumoLegenda.textContent =
        resumo.length +
        ' produto(s) contado(s) · ' +
        nAjuste +
        ' com ajuste no encerramento · ' +
        nOk +
        ' conferido(s) sem movimento.';
    }
  }

  function atualizarResumoFiltroLinhas(mostrando, total) {
    var el = document.getElementById('filtroLinhasResumo');
    if (!el) return;
    if (!total) {
      el.textContent = '';
      return;
    }
    if (mostrando === total) {
      el.textContent = 'Exibindo todas as ' + total + ' linha(s).';
    } else {
      el.textContent = 'Exibindo ' + mostrando + ' de ' + total + ' linha(s). Clique nos contadores acima para filtrar por status.';
    }
  }

  function destacarBadgeFiltroStatus() {
    var painel = document.getElementById('cicloContadores');
    var sel = document.getElementById('filtroStLinha');
    if (!painel || !sel) return;
    var v = String(sel.value || '');
    painel.querySelectorAll('.ciclo-badge[data-ct]').forEach(function (badge) {
      var ct = badge.getAttribute('data-ct');
      var ativo = v === ct || (v === '__ACAO__' && (ct === 'PENDENTE' || ct === 'DIVERGENTE' || ct === 'RECONTAR'));
      badge.classList.toggle('ciclo-badge-filtro-ativo', !!ativo);
    });
  }

  function vincularFiltrosLinhasTabela() {
    if (detalheFiltrosLinhasOk) return;
    detalheFiltrosLinhasOk = true;
    var sel = document.getElementById('filtroStLinha');
    var inpCod = document.getElementById('filtroCodigoLinha');
    var btnLimpar = document.getElementById('btnLimparFiltroLinhas');
    if (sel) {
      sel.addEventListener('change', function () {
        destacarBadgeFiltroStatus();
        renderTabelaLinhasFiltrada();
      });
    }
    if (inpCod) {
      var tCod;
      inpCod.addEventListener('input', function () {
        clearTimeout(tCod);
        tCod = setTimeout(renderTabelaLinhasFiltrada, 280);
      });
    }
    if (btnLimpar) {
      btnLimpar.addEventListener('click', function () {
        if (sel) sel.value = '';
        if (inpCod) inpCod.value = '';
        destacarBadgeFiltroStatus();
        renderTabelaLinhasFiltrada();
      });
    }
  }

  function vincularBadgesContadorFiltro() {
    var painel = document.getElementById('cicloContadores');
    if (!painel) return;
    painel.querySelectorAll('.ciclo-badge[data-ct]').forEach(function (badge) {
      badge.title = 'Clique para filtrar a tabela por este status';
      badge.onclick = function () {
        var ct = badge.getAttribute('data-ct');
        var sel = document.getElementById('filtroStLinha');
        if (!sel) return;
        if (sel.value === ct) {
          sel.value = '';
        } else {
          sel.value = ct;
        }
        destacarBadgeFiltroStatus();
        renderTabelaLinhasFiltrada();
        var wrap = document.querySelector('.wms-inv-filtro-linhas');
        if (wrap && typeof wrap.scrollIntoView === 'function') {
          wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      };
    });
  }

  /** Vincula handlers dos botões de ação dentro de `scopeRoot` (tbody ou TR). */
  function vincularBotoesAcoes(scopeRoot, cabInv) {
    if (!scopeRoot || !cabInv) return;
    scopeRoot.querySelectorAll('.btn-acao-dividir').forEach(function (btn) {
      btn.onclick = function () {
        var cdLinha = parseInt(btn.getAttribute('data-cd-linha'), 10);
        if (!Number.isFinite(cdLinha)) return;
        var tr = btn.closest('tr');
        var loteBase = '';
        var validBase = '';
        if (tr) {
          var inpLote = tr.querySelector('.inv-lote-input');
          var inpVal = tr.querySelector('.inv-validade-input');
          if (inpLote) loteBase = inpLote.value || '';
          if (inpVal) validBase = inpVal.value || '';
        }
        abrirModalDividir(cabInv.CD_INVENTARIO, cdLinha, loteBase, validBase);
      };
    });
    scopeRoot.querySelectorAll('.btn-acao-excluir').forEach(function (btn) {
      btn.onclick = async function () {
        var cdLinha = parseInt(btn.getAttribute('data-cd-linha'), 10);
        if (!Number.isFinite(cdLinha)) return;
        var codigo = btn.getAttribute('data-codigo') || '';
        var qtdContadaRaw = btn.getAttribute('data-qtd-contada') || '';
        var temContagem = qtdContadaRaw !== '' && qtdContadaRaw !== 'null';
        var msg = temContagem
          ? 'Excluir esta linha do inventário?\n\n' +
            '• SKU ' +
            codigo +
            '\n' +
            '• Contagem registrada: ' +
            qtdContadaRaw +
            '\n\n' +
            'Você vai DESCARTAR essa quantidade contada. ' +
            'O saldo de estoque NÃO é afetado (apenas a linha some do inventário).'
          : 'Excluir esta linha (vazia) do inventário?\n\n' +
            '• SKU ' +
            codigo +
            '\n' +
            'Não há contagem registrada — a linha apenas some da lista. ' +
            'O saldo de estoque NÃO é afetado.';
        var ok = window.confirmPadrao
          ? await window.confirmPadrao(msg, {
              danger: temContagem,
              confirmText: 'Excluir linha',
              cancelText: 'Cancelar',
            })
          : window.confirm(msg);
        if (!ok) return;
        btn.disabled = true;
        try {
          var res = await api('/api/wms/inventario/' + cabInv.CD_INVENTARIO + '/linhas/' + cdLinha, {
            method: 'DELETE',
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          var tr = btn.closest('tr');
          if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
          atualizarContadoresLocalmente();
          showMessage('Linha excluída.', 'success');
          await recarregarDetalheInPlace();
        } catch (e) {
          showMessage((e && e.message) || 'Erro ao excluir linha.', 'error');
        } finally {
          btn.disabled = false;
        }
      };
    });
    scopeRoot.querySelectorAll('.btn-acao-recontar').forEach(function (btn) {
      btn.onclick = async function () {
        var cdLinha = parseInt(btn.getAttribute('data-cd-linha'), 10);
        if (!Number.isFinite(cdLinha)) return;
        var ok = window.confirmPadrao
          ? await window.confirmPadrao('Marcar esta linha para nova contagem? A quantidade atual será apagada.', {
              confirmText: 'Marcar recontagem',
              cancelText: 'Cancelar',
            })
          : window.confirm('Marcar esta linha para nova contagem?');
        if (!ok) return;
        btn.disabled = true;
        btn.classList.add('btn-acao-loading');
        try {
          var res = await api('/api/wms/inventario/' + cabInv.CD_INVENTARIO + '/linhas/' + cdLinha + '/recontar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          showMessage('Linha marcada para recontagem.', 'success');
          await recarregarDetalheInPlace();
        } catch (e) {
          showMessage(e.message || 'Erro ao marcar recontagem.', 'error');
        } finally {
          btn.disabled = false;
          btn.classList.remove('btn-acao-loading');
        }
      };
    });
    scopeRoot.querySelectorAll('.btn-acao-aprovar').forEach(function (btn) {
      btn.onclick = async function () {
        var cdLinha = parseInt(btn.getAttribute('data-cd-linha'), 10);
        if (!Number.isFinite(cdLinha)) return;
        var ok = window.confirmPadrao
          ? await window.confirmPadrao(
              'Aprovar esta divergência? Você (supervisor) está aceitando a contagem informada. O ajuste será gerado normalmente no encerramento.',
              { confirmText: 'Aprovar', cancelText: 'Cancelar' }
            )
          : window.confirm('Aprovar esta divergência?');
        if (!ok) return;
        btn.disabled = true;
        btn.classList.add('btn-acao-loading');
        try {
          var res = await api('/api/wms/inventario/' + cabInv.CD_INVENTARIO + '/linhas/' + cdLinha + '/aprovar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          showMessage('Divergência aprovada.', 'success');
          await recarregarDetalheInPlace();
        } catch (e) {
          showMessage(e.message || 'Erro ao aprovar.', 'error');
        } finally {
          btn.disabled = false;
          btn.classList.remove('btn-acao-loading');
        }
      };
    });
  }

  function renderTabelaLinhasFiltrada() {
    if (!detalheRenderCtx) return;
    var ctx = detalheRenderCtx;
    var cab = ctx.cab;
    var canEditarLinhas = ctx.canEditarLinhas;
    var mascaraDono = ctx.mascaraDono;
    var contLinhasPorSku = ctx.contLinhasPorSku;
    var todas = detalheLinhasCache || [];
    var layout = lerLayoutDetalheTela();
    var linhas = ordenarItensDetalhe(
      todas.filter(linhaPassaFiltroTabela),
      layout.ordem
    );
    var tl = document.getElementById('tblLinhasBody');
    if (!tl) return;

    atualizarResumoFiltroLinhas(linhas.length, todas.length);
    destacarBadgeFiltroStatus();

    /** Saldo do sistema por código = ledger (igual ao resumo) ou max snapshot do grupo.
     *  Evita "Sist. linha = 0" na 1ª validade quando o saldo está na 2ª linha. */
    var saldoSistPorSku = {};
    todas.forEach(function (x) {
      var c = x.CODIGO_PRODUTO != null ? String(x.CODIGO_PRODUTO) : '';
      if (!c) return;
      if (!saldoSistPorSku[c]) saldoSistPorSku[c] = { led: null, maxSnap: 0 };
      if (x.QTD_SALDO_SKU_ATUAL != null && x.QTD_SALDO_SKU_ATUAL !== '') {
        var ledN = Number(x.QTD_SALDO_SKU_ATUAL);
        if (Number.isFinite(ledN)) saldoSistPorSku[c].led = ledN;
      }
      var snapN = Number(x.QTD_SISTEMA_SNAPSHOT);
      if (Number.isFinite(snapN)) {
        saldoSistPorSku[c].maxSnap = Math.max(saldoSistPorSku[c].maxSnap, snapN);
      }
    });
    (inventarioResumoAtual || []).forEach(function (r) {
      var c = r.CODIGO_PRODUTO != null ? String(r.CODIGO_PRODUTO) : '';
      if (!c) return;
      if (!saldoSistPorSku[c]) saldoSistPorSku[c] = { led: null, maxSnap: 0 };
      if (saldoSistPorSku[c].led == null && r.QTD_SISTEMA_SKU != null) {
        var sis = Number(r.QTD_SISTEMA_SKU);
        if (Number.isFinite(sis)) saldoSistPorSku[c].led = sis;
      }
    });
    function sistLinhaSku(cod) {
      var info = saldoSistPorSku[cod];
      if (!info) return 0;
      if (info.led != null) return info.led;
      return info.maxSnap || 0;
    }

    var primeiraLinhaSku = {};
    if (!linhas.length) {
      tl.innerHTML =
        '<tr><td colspan="8">Nenhuma linha com este filtro. <a href="#" id="linkLimparFiltroLinhasInline">Limpar filtro</a></td></tr>';
      var link = document.getElementById('linkLimparFiltroLinhasInline');
      if (link) {
        link.onclick = function (ev) {
          ev.preventDefault();
          var btn = document.getElementById('btnLimparFiltroLinhas');
          if (btn) btn.click();
        };
      }
      return;
    }

    var htmlLinhas = '';
    var chaveSepAnterior = null;
    linhas.forEach(function (l) {
      if (layout.camposQuebra.length) {
        var chaveSep = chaveSeparadorDetalhe(l, layout.camposQuebra);
        if (chaveSep !== chaveSepAnterior) {
          htmlLinhas += htmlFaixaSeparadorDetalhe(rotuloSeparadorDetalhe(l, layout.camposQuebra), 8);
          chaveSepAnterior = chaveSep;
        }
      }
      var codSku = l.CODIGO_PRODUTO != null ? String(l.CODIGO_PRODUTO) : '';
      var primeiraDoSku = !primeiraLinhaSku[codSku];
      if (codSku) primeiraLinhaSku[codSku] = true;
      var ehMultiLinha = codSku && contLinhasPorSku[codSku] > 1;
      var celulaSistema = primeiraDoSku
        ? esc(fmtQtd(sistLinhaSku(codSku)))
        : '<span class="sku-linha-extra" title="Saldo do sistema é por SKU (mostrado na primeira linha deste código). Conte separadamente — o ajuste do encerramento soma todas as contagens deste produto.">↑ mesmo SKU</span>';
      var stLinha = statusLinhaFiltro(l);
      var podeEditarQtd = canEditarLinhas && stLinha !== 'APROVADO';
      var valorAtual = '';
      if (l.QTD_CONTADA != null && l.QTD_CONTADA !== '') {
        var nQtd = Number(l.QTD_CONTADA);
        valorAtual = Number.isFinite(nQtd) ? String(nQtd) : String(l.QTD_CONTADA);
      }
      var celulaContada = podeEditarQtd
        ? '<input type="number" step="0.001" min="0" inputmode="decimal" ' +
          'class="inv-qtd-input" ' +
          'data-cd-linha="' + esc(l.CD_LINHA) + '" ' +
          'data-original="' + esc(valorAtual) + '" ' +
          'value="' + esc(valorAtual) + '" ' +
          'placeholder="—" ' +
          'title="Digite a quantidade contada e pressione Enter (ou clique fora) para salvar" />'
        : '<span class="inv-qtd-readonly" title="Linha bloqueada — use Recontar para destravar">' +
          esc(fmtQtd(l.QTD_CONTADA)) + '</span>';
      var acoes = montarHtmlAcoesLinha(l, canEditarLinhas);
      var loteVal = l.LOTE != null ? String(l.LOTE) : '';
      var validVal = fmtValidadeInput(l.VALIDADE);
      var celulaLote = podeEditarQtd
        ? '<input type="text" maxlength="60" class="inv-lote-input" ' +
          'data-cd-linha="' + esc(l.CD_LINHA) + '" ' +
          'data-original="' + esc(loteVal) + '" ' +
          'value="' + esc(loteVal) + '" placeholder="—" ' +
          'title="Lote (até 60 caracteres). Enter para salvar." />'
        : '<span class="inv-qtd-readonly">' + esc(loteVal || '—') + '</span>';
      var celulaValidade = podeEditarQtd
        ? '<input type="date" class="inv-validade-input" ' +
          'data-cd-linha="' + esc(l.CD_LINHA) + '" ' +
          'data-original="' + esc(validVal) + '" ' +
          'value="' + esc(validVal) + '" ' +
          'title="Validade do lote (AAAA-MM-DD). Enter para salvar." />'
        : '<span class="inv-qtd-readonly">' + esc(validVal || '—') + '</span>';
      var classeTr =
        'data-row-cd-linha="' +
        esc(l.CD_LINHA) +
        '" data-codigo-produto="' +
        esc(l.CODIGO_PRODUTO || '') +
        '" data-st-linha="' +
        esc(stLinha) +
        '"' +
        (ehMultiLinha ? ' class="sku-multi' + (primeiraDoSku ? ' sku-multi-primeira' : '') + '"' : '');
      var rotuloProd = rotuloProdutoLinha(l.CODIGO_PRODUTO, l.NM_PRODUTO, mascaraDono);
      htmlLinhas +=
        '<tr ' + classeTr + '><td class="td-produto" title="' +
        esc(rotuloProd) +
        '">' +
        esc(rotuloProd) +
        '</td><td class="td-lote">' +
        celulaLote +
        '</td><td class="td-validade">' +
        celulaValidade +
        '</td><td class="td-sistema">' +
        celulaSistema +
        '</td><td class="td-contada">' +
        celulaContada +
        '</td><td class="td-status-linha"><span class="ciclo-badge ciclo-badge-' +
        esc(stLinha) +
        '">' +
        esc(stLinha) +
        (Number(l.NU_RECONTAGENS) > 0 ? ' ×' + esc(l.NU_RECONTAGENS) : '') +
        '</span></td><td>' +
        esc(l.ORIGEM) +
        '</td><td>' +
        acoes +
        '</td></tr>';
    });
    tl.innerHTML = htmlLinhas;

    function bindCampoInvTabela(selector, transform, opts) {
      opts = opts || {};
      document.querySelectorAll('#tblLinhasBody ' + selector).forEach(function (inp) {
        function salvar() {
          var tr = inp.closest('tr');
          if (!tr) return;
          salvarLinhaInlineDetalhe(tr);
        }
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            inp.blur();
            if (opts.focusNextQtd && selector === '.inv-qtd-input') {
              var inputs = Array.prototype.slice.call(
                document.querySelectorAll('#tblLinhasBody .inv-qtd-input')
              );
              var idx = inputs.indexOf(inp);
              if (idx >= 0 && idx + 1 < inputs.length) inputs[idx + 1].focus();
            }
          } else if (ev.key === 'Escape') {
            inp.value = inp.getAttribute('data-original') || '';
            inp.blur();
          }
        });
        inp.addEventListener('blur', salvar);
      });
    }

    bindCampoInvTabela('.inv-qtd-input', function (v) { return v.trim(); }, { focusNextQtd: true });
    bindCampoInvTabela('.inv-lote-input', function (v) { return v.trim(); });
    bindCampoInvTabela('.inv-validade-input', function (v) { return v.trim(); });
    vincularBotoesAcoes(tl, cab);
  }

  function lerCampoInvDetalhe(inp, transform) {
    if (!inp) return { mudou: false, atual: '', orig: '' };
    var orig = inp.getAttribute('data-original') || '';
    var atual = inp.value == null ? '' : String(inp.value);
    if (transform) atual = transform(atual);
    return { mudou: atual !== orig, atual: atual, orig: orig };
  }

  function salvarLinhaInlineDetalhe(tr) {
    if (!detalheRenderCtx || !tr || tr.getAttribute('data-salvando') === '1') return Promise.resolve();
    var cab = detalheRenderCtx.cab;
    var canEditarLinhas = detalheRenderCtx.canEditarLinhas;
    var cdLinha = parseInt(tr.getAttribute('data-row-cd-linha'), 10);
    if (!Number.isFinite(cdLinha)) return Promise.resolve();

    var qtdInp = tr.querySelector('.inv-qtd-input');
    var loteInp = tr.querySelector('.inv-lote-input');
    var valInp = tr.querySelector('.inv-validade-input');
    var qtd = lerCampoInvDetalhe(qtdInp, function (v) { return v.trim(); });
    var lote = lerCampoInvDetalhe(loteInp, function (v) { return v.trim(); });
    var val = lerCampoInvDetalhe(valInp, function (v) { return v.trim(); });

    if (!qtd.mudou && !lote.mudou && !val.mudou) return Promise.resolve();

    var body = {};
    var usaContagem = false;
    if (qtd.mudou) {
      body.qtdContada = qtd.atual === '' ? null : Number(qtd.atual);
      if (qtd.atual !== '' && !Number.isFinite(body.qtdContada)) {
        showMessage('Quantidade contada inválida.', 'error');
        return Promise.resolve();
      }
      usaContagem = true;
    } else if (qtd.atual !== '' && (lote.mudou || val.mudou)) {
      body.qtdContada = Number(qtd.atual);
      if (!Number.isFinite(body.qtdContada)) {
        showMessage('Informe a quantidade contada antes da validade.', 'error');
        return Promise.resolve();
      }
      usaContagem = true;
    }
    if (lote.mudou) body.lote = lote.atual === '' ? null : lote.atual;
    if (val.mudou) body.validade = val.atual === '' ? null : val.atual;

    if (!usaContagem && !Object.prototype.hasOwnProperty.call(body, 'lote') && !Object.prototype.hasOwnProperty.call(body, 'validade')) {
      return Promise.resolve();
    }

    var inputs = [qtdInp, loteInp, valInp].filter(Boolean);
    inputs.forEach(function (el) {
      el.disabled = true;
      el.classList.add('inv-qtd-salvando');
    });
    tr.setAttribute('data-salvando', '1');

    var url = usaContagem
      ? '/api/wms/inventario/' + cab.CD_INVENTARIO + '/linhas/' + cdLinha + '/contagem'
      : '/api/wms/inventario/' + cab.CD_INVENTARIO + '/linhas/' + cdLinha;

    return api(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok) throw new Error(payload.error || 'HTTP ' + res.status);
          return payload;
        });
      })
      .then(function (payload) {
        if (qtdInp && (qtd.mudou || usaContagem)) qtdInp.setAttribute('data-original', qtd.atual);
        if (loteInp && lote.mudou) loteInp.setAttribute('data-original', lote.atual);
        if (valInp && val.mudou) valInp.setAttribute('data-original', val.atual);

        /** Contagem altera status do SKU inteiro (várias validades) e o resumo
         *  de ajustes — recarrega o detalhe para não ficar desatualizado. */
        if (usaContagem) {
          return recarregarDetalheInPlace({ cdLinhaFoco: cdLinha }).then(function () {
            inputs.forEach(function (el) {
              el.classList.remove('inv-qtd-salvando');
            });
          });
        }

        if (payload && payload.stLinha) {
          var stNovo = String(payload.stLinha).toUpperCase();
          tr.setAttribute('data-st-linha', stNovo);
          var idx = detalheLinhasCache.findIndex(function (x) {
            return parseInt(x.CD_LINHA, 10) === cdLinha;
          });
          if (idx >= 0) detalheLinhasCache[idx].ST_LINHA = stNovo;
          var stCell = tr.querySelector('.td-status-linha');
          if (stCell) {
            stCell.innerHTML =
              '<span class="ciclo-badge ciclo-badge-' + esc(stNovo) + '">' + esc(stNovo) + '</span>';
          }
          var acoesTd = tr.querySelector('td:last-child');
          if (acoesTd) {
            acoesTd.innerHTML = montarHtmlAcoesLinha(
              {
                CD_LINHA: cdLinha,
                ST_LINHA: stNovo,
                CODIGO_PRODUTO: tr.getAttribute('data-codigo-produto') || '',
                QTD_CONTADA: body.qtdContada,
              },
              canEditarLinhas
            );
            vincularBotoesAcoes(tr, cab);
          }
          atualizarContadoresLocalmente();
        }

        inputs.forEach(function (el) {
          el.classList.remove('inv-qtd-salvando');
          el.classList.add('inv-qtd-ok');
          setTimeout(function () { el.classList.remove('inv-qtd-ok'); }, 900);
        });
      })
      .catch(function (e) {
        if (qtd.mudou && qtdInp) qtdInp.value = qtd.orig;
        if (lote.mudou && loteInp) loteInp.value = lote.orig;
        if (val.mudou && valInp) valInp.value = val.orig;
        inputs.forEach(function (el) {
          el.classList.remove('inv-qtd-salvando');
          el.classList.add('inv-qtd-erro');
          setTimeout(function () { el.classList.remove('inv-qtd-erro'); }, 1500);
        });
        showMessage((e && e.message) || 'Erro ao salvar linha.', 'error');
      })
      .finally(function () {
        tr.removeAttribute('data-salvando');
        inputs.forEach(function (el) {
          el.disabled = false;
        });
      });
  }

  function mostrarDetalhe() {
    document.getElementById('viewLista').hidden = true;
    document.getElementById('viewDetalhe').hidden = false;
    /** Garante que o usuário veja o topo do detalhe (inclusive o banner de
     *  próximos passos, quando aplicável). Sem isso, em telas longas o
     *  usuário fica olhando para uma posição arbitrária e acha que "nada
     *  aconteceu" após criar o documento. */
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      var det = document.getElementById('viewDetalhe');
      if (det && typeof det.scrollIntoView === 'function') {
        det.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (_) { /* ignora navegadores sem smooth scroll */ }
  }

  /** Guarda o CD_INVENTARIO recém-criado pelo fluxo cíclico para destacar o
   *  banner de "próximos passos" assim que o detalhe abrir. Limpa logo após
   *  o primeiro render para não poluir aberturas futuras. */
  var cicloRecemCriado = null;

  /** Normaliza status do inventário para comparações consistentes. */
  function normalizarStatusInventario(st) {
    return String(st || '')
      .toUpperCase()
      .trim();
  }

  /** Mostra/oculta botões do detalhe conforme ENCERRADO / CANCELADO / aberto. */
  function aplicarBotoesDetalhePorStatus(st) {
    var stNorm = normalizarStatusInventario(st);
    var encerrado = stNorm === 'ENCERRADO' || stNorm === 'CANCELADO';
    var cancelado = stNorm === 'CANCELADO';
    var idsEdicao = ['btnSnapshot', 'btnImportarCsv', 'btnAddLinhaManual', 'btnEncerrar', 'btnCancelarInv'];
    idsEdicao.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = encerrado;
      el.disabled = encerrado;
    });
    var btnPrevia = document.getElementById('btnAtaPrevia');
    if (btnPrevia) {
      btnPrevia.hidden = stNorm === 'ENCERRADO';
      btnPrevia.disabled = stNorm === 'ENCERRADO';
    }
    var btnReativar = document.getElementById('btnReativarInv');
    if (btnReativar) {
      var podeReabrir = cancelado || stNorm === 'ENCERRADO';
      btnReativar.hidden = !podeReabrir;
      btnReativar.disabled = !podeReabrir;
      btnReativar.innerHTML = cancelado
        ? '<i class="bx bx-revision"></i> Reativar'
        : '<i class="bx bx-revision"></i> Reabrir';
    }
    var banner = document.getElementById('invDocReadonlyBanner');
    if (banner) {
      if (stNorm === 'ENCERRADO') {
        banner.hidden = false;
        banner.innerHTML =
          '<i class="bx bx-lock-alt"></i>' +
          '<div><strong>Inventário encerrado.</strong> Ajustes de saldo já foram aplicados. ' +
          'Use <b>Ata / PDF</b> ou <b>Ata CSV</b> para consulta — ou <b>Reabrir</b> para estornar os ajustes e voltar à contagem.</div>';
      } else if (cancelado) {
        banner.hidden = false;
        banner.innerHTML =
          '<i class="bx bx-x-circle"></i>' +
          '<div><strong>Inventário cancelado.</strong> Use <b>Reativar</b> para voltar à contagem, se necessário.</div>';
      } else {
        banner.hidden = true;
        banner.innerHTML = '';
      }
    }
  }

  function renderDetalhe(data) {
    var cab = data.cabecalho || {};
    inventarioAtual = cab.CD_INVENTARIO;
    inventarioCdDonoAtual =
      cab.CD_DONO != null && Number.isFinite(parseInt(cab.CD_DONO, 10)) ? parseInt(cab.CD_DONO, 10) : null;
    var st = normalizarStatusInventario(cab.ST_INVENTARIO);
    inventarioStatusAtual = st;
    var encerrado = st === 'ENCERRADO' || st === 'CANCELADO';
    aplicarBotoesDetalhePorStatus(st);

    var btnAtaOficial = document.getElementById('btnAtaImprimir');
    var btnAtaPrevia = document.getElementById('btnAtaPrevia');
    var btnAtaCsv = document.getElementById('btnAtaCsv');
    if (btnAtaOficial) {
      btnAtaOficial.disabled = false;
      btnAtaOficial.hidden = false;
      btnAtaOficial.title =
        st === 'ENCERRADO'
          ? 'Ata oficial para assinaturas (inventário encerrado)'
          : 'Abre a ata; após encerrar, use novamente para versão sem marca de prévia';
    }
    if (btnAtaPrevia) btnAtaPrevia.title = 'Conferência antes do encerramento';
    if (btnAtaCsv) {
      btnAtaCsv.disabled = false;
      btnAtaCsv.hidden = false;
    }

    /** Cabeçalho do detalhe. Em CICLICO, adiciona contadores por status, critério
     *  e o campo de tolerância editável (Fase 3b). */
    var isCiclico = String(cab.TP_INVENTARIO || '').toUpperCase() === 'CICLICO';
    var cont = data.contadoresStatus || {};
    var totLinhas =
      (cont.PENDENTE || 0) +
      (cont.CONTADO || 0) +
      (cont.DIVERGENTE || 0) +
      (cont.RECONTAR || 0) +
      (cont.APROVADO || 0);
    var tol = data.tolerancia != null ? Number(data.tolerancia) : 0;
    var tolPlaceholder =
      cab.PCT_TOLERANCIA == null ? 'dono: ' + (tol || 0) + '%' : '';
    var metaHtml =
      '<strong>#' +
      esc(cab.CD_INVENTARIO) +
      '</strong> · Dono ' +
      esc(cab.NM_DONO) +
      ' · Tipo <code>' +
      esc(cab.TP_INVENTARIO) +
      '</code> · Status <code>' +
      esc(st) +
      '</code> · Corte ' +
      esc(fmtDh(cab.DH_CORTE)) +
      ' · Política não contados: <code>' +
      esc(cab.POLITICA_NAO_CONTADO) +
      '</code>';
    if (isCiclico && cab.CRITERIO_CICLICO) {
      metaHtml += ' · Critério <code>' + esc(cab.CRITERIO_CICLICO) + '</code>';
    }
    if (totLinhas > 0) {
      metaHtml +=
        '<div id="cicloContadores" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">' +
        '<span class="ciclo-badge ciclo-badge-PENDENTE" data-ct="PENDENTE">' + (cont.PENDENTE || 0) + ' pendentes</span>' +
        '<span class="ciclo-badge ciclo-badge-CONTADO" data-ct="CONTADO">' + (cont.CONTADO || 0) + ' contados</span>' +
        '<span class="ciclo-badge ciclo-badge-DIVERGENTE" data-ct="DIVERGENTE">' + (cont.DIVERGENTE || 0) + ' divergentes</span>' +
        '<span class="ciclo-badge ciclo-badge-RECONTAR" data-ct="RECONTAR">' + (cont.RECONTAR || 0) + ' recontar</span>' +
        '<span class="ciclo-badge ciclo-badge-APROVADO" data-ct="APROVADO">' + (cont.APROVADO || 0) + ' aprovados</span>' +
        '</div>';
    }
    var inputId = 'inputTolerancia_' + cab.CD_INVENTARIO;
    metaHtml +=
      '<div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
      '<label for="' + inputId + '" style="font-weight:600; font-size:13px;">Tolerância (%):</label>' +
      '<input type="number" id="' + inputId + '" min="0" max="100" step="0.1" ' +
      'style="width:90px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" ' +
      'value="' + (cab.PCT_TOLERANCIA != null ? esc(cab.PCT_TOLERANCIA) : '') + '" ' +
      'placeholder="' + esc(tolPlaceholder) + '" ' +
      (encerrado ? 'disabled readonly ' : '') +
      ' />' +
      '<button type="button" id="btnSalvarTolerancia" class="btn-filtro btn-filtro-aplicar" style="padding:6px 14px; font-size:13px;"' +
      (encerrado ? ' hidden disabled' : '') +
      '>' +
      '<i class="bx bx-check"></i> Aplicar</button>' +
      '<span class="hint" style="margin:0; font-size:12px;">Atual: ' +
      esc(Number(tol).toFixed(2)) + '%' +
      (cab.PCT_TOLERANCIA == null ? ' (default do dono)' : ' (override deste inventário)') +
      '</span>' +
      '</div>';
    /** Banner "próximos passos" quando o usuário acabou de criar o ciclo.
     *  Indica explicitamente onde imprimir a ata para coleta e como importar
     *  as contagens depois — resolve confusão de "criei, mas onde foi parar?". */
    if (cicloRecemCriado === cab.CD_INVENTARIO) {
      metaHtml =
        '<div class="ciclo-proximos-passos">' +
        '<div class="ciclo-pp-titulo">' +
        '<i class="bx bx-check-circle"></i> Inventário cíclico #' +
        esc(cab.CD_INVENTARIO) +
        ' criado · ' + totLinhas + ' linha(s) pré-populadas' +
        '</div>' +
        '<div class="ciclo-pp-passos">' +
        '<span><strong>1.</strong> Use <b>Ata prévia</b> ou <b>Ata CSV</b> abaixo para imprimir a planilha de coleta</span>' +
        '<span><strong>2.</strong> Conte fisicamente os SKUs listados e preencha quantidades</span>' +
        '<span><strong>3.</strong> Importe pelo botão <b>Importar CSV</b> ou edite linha a linha</span>' +
        '<span><strong>4.</strong> Use <b>Encerrar</b> para gerar os ajustes de saldo</span>' +
        '</div>' +
        '</div>' +
        metaHtml;
      cicloRecemCriado = null; // só uma vez
    }
    document.getElementById('detMeta').innerHTML = metaHtml;

    /** Atualiza o label do breadcrumb (topo do detalhe) com tipo + número do
     *  inventário — assim o usuário sabe exatamente onde está e o caminho
     *  fica auto-explicativo: "Voltar para a lista › Inventário CICLICO #5". */
    var brdLabel = document.getElementById('brdInventarioLabel');
    if (brdLabel) {
      brdLabel.textContent =
        'Inventário ' + (cab.TP_INVENTARIO || '') + ' #' + cab.CD_INVENTARIO;
    }

    /** Aplicar tolerância (Fase 3b). */
    var btnTol = document.getElementById('btnSalvarTolerancia');
    if (btnTol) {
      btnTol.onclick = async function () {
        var input = document.getElementById(inputId);
        var pct = input.value === '' ? null : Number(input.value);
        showLoadingOverlay('Salvando', 'Atualizando tolerância…', '');
        await yieldPaint();
        try {
          var res = await api('/api/wms/inventario/' + cab.CD_INVENTARIO + '/tolerancia', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pct: pct }),
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          showMessage(
            'Tolerância atualizada (' +
              (body.tolerancia != null ? body.tolerancia + '%' : 'default do dono') +
              '). ' +
              body.recalculadas +
              ' linha(s) reclassificada(s).',
            'success'
          );
          abrirDetalhe(cab.CD_INVENTARIO);
        } catch (e) {
          showMessage(e.message || 'Erro ao atualizar tolerância.', 'error');
        } finally {
          hideLoadingOverlay();
        }
      };
    }

    var mascaraDono = cab.MASCARA_CODIGO_PRODUTO || '';
    var resumo = data.resumoSku || [];
    inventarioResumoAtual = resumo;
    var divSnap = document.getElementById('invResumoDivergenciaAlert');
    var divsSnap = resumo.filter(function (r) {
      return r.DIVERGENCIA_SNAPSHOT;
    });
    if (divSnap) {
      if (divsSnap.length) {
        divSnap.style.display = 'block';
        divSnap.innerHTML =
          '<i class="bx bx-error-circle"></i> <strong>' +
          esc(String(divsSnap.length)) +
          ' produto(s)</strong> com snapshot da linha diferente do saldo no ledger. ' +
          'O encerramento usa o <strong>ledger</strong> (coluna Sistema) — confira antes de fechar.';
      } else {
        divSnap.style.display = 'none';
        divSnap.innerHTML = '';
      }
    }
    var resumoLegenda = document.getElementById('invResumoLegenda');
    if (!resumo.length) {
      var trEmpty = document.getElementById('tblResumoBody');
      if (trEmpty) trEmpty.innerHTML = '<tr><td colspan="5">Nenhum SKU com quantidade contada ainda.</td></tr>';
      if (resumoLegenda) resumoLegenda.textContent = '';
    } else {
      renderTabelaResumoDetalhe(mascaraDono);
    }

    vincularLayoutDetalheTela();
    atualizarResumoLayoutLinhas();

    var linhas = data.linhas || [];
    var tl = document.getElementById('tblLinhasBody');
    /** Inventário em estado finalizado não deve permitir ações em linhas. */
    var canEditarLinhas = !(st === 'ENCERRADO' || st === 'CANCELADO');

    /** Conta quantas linhas cada SKU tem. SKUs com múltiplas linhas
     *  (mesmo produto, lotes/validades diferentes) ganham destaque visual
     *  para o operador entender que o ajuste é consolidado no nível do SKU. */
    var contLinhasPorSku = {};
    linhas.forEach(function (l) {
      var c = l.CODIGO_PRODUTO != null ? String(l.CODIGO_PRODUTO) : '';
      if (c) contLinhasPorSku[c] = (contLinhasPorSku[c] || 0) + 1;
    });
    var skusMultiLinha = Object.keys(contLinhasPorSku).filter(function (c) { return contLinhasPorSku[c] > 1; });
    /** Banner explicativo: aparece só quando há ao menos um SKU com múltiplas
     *  linhas (mesmo produto em mais de um lote/validade). Resolve a dúvida
     *  "por que aparece 3252 em duas linhas — está duplicando o saldo?". */
    var aviso = document.getElementById('avisoSkuMultiLinha');
    if (aviso) {
      if (skusMultiLinha.length > 0) {
        aviso.innerHTML =
          '<i class="bx bx-info-circle"></i> ' +
          '<strong>' + skusMultiLinha.length + ' produto(s) com mais de uma validade neste inventário.</strong> ' +
          'O <em>saldo do sistema</em> é informado por SKU (uma vez por produto na coluna "Sist. linha" — ' +
          'linhas adicionais do mesmo código mostram "↑ mesmo SKU"). Você conta cada validade separadamente; ' +
          'no encerramento, o <strong>ajuste é consolidado</strong> pela soma das contagens vs. saldo total do produto.';
        aviso.style.display = 'flex';
      } else {
        aviso.style.display = 'none';
      }
    }
    detalheLinhasCache = linhas.slice();
    detalheRenderCtx = {
      cab: cab,
      canEditarLinhas: canEditarLinhas,
      mascaraDono: mascaraDono,
      contLinhasPorSku: contLinhasPorSku,
    };
    vincularFiltrosLinhasTabela();
    vincularBadgesContadorFiltro();
    renderTabelaLinhasFiltrada();
  }

  async function abrirDetalhe(cd) {
    showLoadingOverlay('Carregando', 'Detalhe do inventário…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/' + cd);
      if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || 'HTTP ' + res.status);
      var data = await res.json();
      renderDetalhe(data);
      mostrarDetalhe();
    } catch (e) {
      showMessage(e.message || 'Erro ao abrir inventário.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  /** Recarrega os dados do detalhe SEM voltar o scroll para o topo. Usado
   *  quando o operador executou uma ação no meio da lista (aprovar, recontar,
   *  excluir, dividir, etc.) e precisa apenas ver a linha refletindo o novo
   *  status, sem perder a posição. Diferente de `abrirDetalhe`, este não chama
   *  `mostrarDetalhe()` (que rola para o topo) nem mostra overlay grande.
   *  @param {{ cdLinhaFoco?: number }} [opts] — após render, rola até a linha
   *  (ex.: nova linha criada pelo "Dividir") e foca o primeiro campo editável. */
  async function recarregarDetalheInPlace(opts) {
    opts = opts || {};
    if (!inventarioAtual) return;
    /** Preserva a coordenada Y absoluta da janela. Restauramos depois do
     *  render porque a re-renderização do tbody pode brevemente reduzir a
     *  altura da página e fazer o browser cortar a posição salva. */
    var scrollY = window.scrollY || window.pageYOffset || 0;
    var cdLinhaFoco = opts.cdLinhaFoco != null ? parseInt(opts.cdLinhaFoco, 10) : NaN;
    try {
      var res = await api('/api/wms/inventario/' + inventarioAtual);
      if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || 'HTTP ' + res.status);
      var data = await res.json();
      renderDetalhe(data);
    } catch (e) {
      showMessage(e.message || 'Erro ao atualizar inventário.', 'error');
      return;
    }
    /** Restaura scroll ou leva à linha nova (dividir / adicionar). Double-rAF
     *  espera o reflow da tabela antes de `scrollIntoView` / `scrollTo`. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (Number.isFinite(cdLinhaFoco)) {
          var tr = document.querySelector('tr[data-row-cd-linha="' + cdLinhaFoco + '"]');
          if (tr) {
            tr.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            var inp = tr.querySelector('.inv-validade-input, .inv-lote-input, .inv-qtd-input');
            if (inp && !inp.disabled) {
              try {
                inp.focus({ preventScroll: true });
              } catch (_) {
                inp.focus();
              }
            }
            return;
          }
        }
        window.scrollTo(0, scrollY);
      });
    });
  }

  document.getElementById('btnNovoInv').addEventListener('click', async function () {
    var cdDono = document.getElementById('novoCdDono').value;
    if (!cdDono) {
      showMessage('Selecione o dono do estoque.', 'error');
      return;
    }
    showLoadingOverlay('Criando', 'Abrindo inventário…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cdDono: parseInt(cdDono, 10),
          tpInventario: document.getElementById('novoTp').value,
          politicaNaoContado: document.getElementById('novoPol').value,
          observacao: document.getElementById('novoObs').value,
        }),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      showMessage('Inventário #' + body.CD_INVENTARIO + ' criado.', 'success');
      await carregarLista();
      abrirDetalhe(body.CD_INVENTARIO);
    } catch (e) {
      showMessage(e.message || 'Erro ao criar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  });

  function limparFormNovo() {
    var sel = document.getElementById('novoCdDono');
    if (sel) sel.value = '';
    document.getElementById('novoTp').value = 'GERAL';
    document.getElementById('novoPol').value = 'MANTER';
    document.getElementById('novoObs').value = '';
  }

  document.getElementById('btnLimparNovo').addEventListener('click', limparFormNovo);

  document.getElementById('btnLimparFiltros').addEventListener('click', function () {
    document.getElementById('filtroDono').value = '';
    carregarLista().catch(function (e) {
      showMessage(e.message, 'error');
    });
  });

  document.getElementById('filtroListaForm').addEventListener('submit', function (e) {
    e.preventDefault();
    carregarLista().catch(function (err) {
      showMessage(err.message, 'error');
    });
  });

  document.getElementById('btnImportarCsv').addEventListener('click', function () {
    if (!inventarioAtual) return;
    var inp = document.getElementById('inputCsv');
    if (inp && !inp.disabled) inp.click();
  });

  /** -----------------------------------------------------------------
   *  Adicionar SKU manualmente ao inventário
   *  ----------------------------------------------------------------- */

  /** Debounce simples para a busca enquanto o usuário digita. Evita pingar a
   *  API a cada tecla. */
  var addBuscaTimer = null;
  var addBuscaUltima = '';
  var addProdutosCache = []; /* última resposta — usada na validação ao salvar */

  function setAddStatus(msg, tipo) {
    var el = document.getElementById('addCodigoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color =
      tipo === 'ok' ? 'var(--cor-sucesso, #15803d)' :
      tipo === 'erro' ? 'var(--cor-erro, #b91c1c)' :
      '';
  }

  /** Busca produtos do dono atual com base no texto digitado. Aceita código
   *  (com ou sem máscara) ou parte do nome. Limita 25 resultados para o
   *  datalist (suficiente para escolher; mais que isso vira ruído). */
  async function buscarProdutosDono(termo) {
    if (!inventarioCdDonoAtual) return [];
    var t = String(termo || '').trim();
    if (!t || t.length < 2) return [];
    var url =
      '/api/wms/produtos-dono?cdDono=' + encodeURIComponent(inventarioCdDonoAtual) +
      '&somenteDono=1&fgactive=S&page=1&pageSize=25';
    /** Heurística: se o termo tem dígito, busca por código (mais preciso). Se
     *  só texto, busca por nome. Em dúvida (mistura), tenta os dois. */
    var temDigito = /\d/.test(t);
    var temLetra = /[a-zA-Z]/.test(t);
    if (temDigito) url += '&codigo=' + encodeURIComponent(t);
    if (temLetra) url += '&nome=' + encodeURIComponent(t);
    try {
      var r = await api(url);
      if (!r.ok) return [];
      var data = await r.json();
      return data.itens || data.rows || data || [];
    } catch (_) {
      return [];
    }
  }

  function atualizarDatalist(produtos) {
    var dl = document.getElementById('addCodigoSugestoes');
    if (!dl) return;
    dl.innerHTML = '';
    (produtos || []).slice(0, 25).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.CODIGO || '';
      opt.label = (p.NOME || '') + (p.UNIDADE ? ' (' + p.UNIDADE + ')' : '');
      dl.appendChild(opt);
    });
  }

  document.getElementById('btnAddLinhaManual').addEventListener('click', function () {
    if (!inventarioAtual) return;
    if (inventarioStatusAtual === 'ENCERRADO' || inventarioStatusAtual === 'CANCELADO') {
      showMessage('Inventário em ' + inventarioStatusAtual + ' não permite adicionar linhas.', 'error');
      return;
    }
    document.getElementById('addCodigo').value = '';
    document.getElementById('addLote').value = '';
    document.getElementById('addValidade').value = '';
    document.getElementById('addQtd').value = '';
    setAddStatus('');
    atualizarDatalist([]);
    addProdutosCache = [];
    var m = document.getElementById('modalAddLinha');
    m.hidden = false;
    m.classList.add('aberto');
    setTimeout(function () { document.getElementById('addCodigo').focus(); }, 50);
  });

  function fecharModalAddLinha() {
    var m = document.getElementById('modalAddLinha');
    m.classList.remove('aberto');
    m.hidden = true;
  }
  document.getElementById('btnAddLinhaCancelar').addEventListener('click', fecharModalAddLinha);
  var btnAddLinhaFechar = document.getElementById('btnAddLinhaFechar');
  if (btnAddLinhaFechar) btnAddLinhaFechar.addEventListener('click', fecharModalAddLinha);

  function normCodigoCmp(s) {
    return String(s || '').replace(/\D/g, '');
  }

  async function preencherSugestaoValidadeDoCodigo(codigo) {
    if (!inventarioAtual || !codigo) return;
    var valEl = document.getElementById('addValidade');
    var loteEl = document.getElementById('addLote');
    if (!valEl) return;
    if (String(valEl.value || '').trim()) return;
    try {
      var r = await api(
        '/api/wms/inventario/' +
          inventarioAtual +
          '/sugerir-validade?codigo=' +
          encodeURIComponent(codigo)
      );
      if (!r.ok) return;
      var data = await r.json().catch(function () {
        return {};
      });
      if (data.validade && !String(valEl.value || '').trim()) {
        valEl.value = data.validade;
      }
      if (data.lote && loteEl && !String(loteEl.value || '').trim()) {
        loteEl.value = data.lote;
      }
      if (data.validade) {
        var fonte =
          data.fonte === 'saldo_lote'
            ? 'saldo por lote'
            : data.fonte === 'nf'
              ? 'última NF / mais curta'
              : data.fonte || '';
        setAddStatus(
          '✓ ' +
            (data.codigo || codigo) +
            (data.nome ? ' — ' + data.nome : '') +
            ' · validade sugerida ' +
            data.validade.split('-').reverse().join('/') +
            (fonte ? ' (' + fonte + ')' : ''),
          'ok'
        );
      }
    } catch (_) {
      /* silencioso — operador pode preencher à mão */
    }
  }

  function produtoExatoDaLista(lista, termo) {
    var t = String(termo || '').trim();
    if (!t || !lista || !lista.length) return null;
    if (lista.length === 1) return lista[0];
    var tn = normCodigoCmp(t);
    var exact = lista.filter(function (p) {
      return String(p.CODIGO || '').trim() === t || normCodigoCmp(p.CODIGO) === tn;
    });
    return exact.length === 1 ? exact[0] : null;
  }

  document.getElementById('addCodigo').addEventListener('input', function () {
    var v = this.value;
    if (addBuscaTimer) clearTimeout(addBuscaTimer);
    if (v === addBuscaUltima) return;
    addBuscaUltima = v;
    setAddStatus(v && v.length >= 2 ? 'Procurando…' : '');
    addBuscaTimer = setTimeout(async function () {
      var lista = await buscarProdutosDono(v);
      addProdutosCache = lista;
      atualizarDatalist(lista);
      if (!v) {
        setAddStatus('');
      } else if (!lista.length) {
        setAddStatus('Nenhum produto encontrado para este código/nome no dono atual.', 'erro');
      } else {
        var p = produtoExatoDaLista(lista, v);
        if (p) {
          setAddStatus('✓ ' + (p.CODIGO || '') + ' — ' + (p.NOME || ''), 'ok');
          await preencherSugestaoValidadeDoCodigo(p.CODIGO || v);
        } else {
          setAddStatus(lista.length + ' produtos encontrados — selecione um da lista ou refine.', 'ok');
        }
      }
    }, 250);
  });

  document.getElementById('addCodigo').addEventListener('change', function () {
    var v = String(this.value || '').trim();
    if (!v) return;
    var p = produtoExatoDaLista(addProdutosCache, v);
    if (p) preencherSugestaoValidadeDoCodigo(p.CODIGO || v);
  });

  /** -----------------------------------------------------------------
   *  Transferência entre donos (modal compartilhado)
   *  ----------------------------------------------------------------- */

  var transfBuscaTimer = null;
  var transfPreviewCache = null;

  function transfSetStatus(msg, tipo) {
    var el = document.getElementById('transfCodigoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color =
      tipo === 'ok' ? 'var(--cor-sucesso, #15803d)' :
      tipo === 'erro' ? 'var(--cor-erro, #b91c1c)' : '';
  }

  function transfAplicarSugestaoValidade(c) {
    if (!c) return;
    var elLote = document.getElementById('transfLote');
    var elVal = document.getElementById('transfValidade');
    if (!elLote || !elVal) return;
    if (c.validadeSugerida && !String(elVal.value || '').trim()) {
      elVal.value = String(c.validadeSugerida).slice(0, 10);
    }
    if (c.loteSugerido && !String(elLote.value || '').trim()) {
      elLote.value = String(c.loteSugerido);
    }
  }

  function transfRenderResumo(preview) {
    var box = document.getElementById('transfResumo');
    if (!preview) { box.hidden = true; box.innerHTML = ''; return; }
    var c = preview;
    var clsSaldo = c.saldoOk ? 'transf-preview-ok' : 'transf-preview-erro';
    var saldoIcone = c.saldoOk ? '✓' : '✗';
    var html = '';
    html += '<div class="transf-preview-titulo">Pré-validação</div>';
    html += '<div class="transf-preview-linha"><strong>Produto origem:</strong> ' + esc(c.produto.CODIGO) + ' — ' + esc(c.produto.NOME) + '</div>';
    if (c.produtoDestino) {
      html += '<div class="transf-preview-linha"><strong>Produto destino:</strong> ' + esc(c.produtoDestino.CODIGO) + ' — ' + esc(c.produtoDestino.NOME) + '</div>';
    }
    html += '<div class="transf-preview-linha"><strong>De:</strong> ' + esc(c.donoOrigem.CD_DONO + ' — ' + c.donoOrigem.NOME) +
            ' · <strong>Para:</strong> ' + esc(c.donoDestino.CD_DONO + ' — ' + c.donoDestino.NOME) + '</div>';
    html += '<div class="' + clsSaldo + '">' + saldoIcone +
            ' Saldo origem: ' + fmtQtd(c.saldoOrigem) +
            ' · Solicitado: ' + fmtQtd(c.qtdSolicitada);
    if (c.saldoOk) {
      html += ' · Saldo após: ' + fmtQtd(c.saldoOrigem - c.qtdSolicitada);
    } else {
      html += ' · INSUFICIENTE';
    }
    html += '</div>';
    if (c.validadeSugerida || c.loteSugerido) {
      var fonte =
        c.fonteValidade === 'saldo_lote' ? 'saldo de lote (FEFO)' :
        c.fonteValidade === 'nf' ? 'NF de entrada' : 'cadastro';
      html += '<div class="transf-preview-info">✓ Validade sugerida: <strong>' +
              esc(c.validadeSugerida || '—') + '</strong>' +
              (c.loteSugerido ? ' · Lote: <strong>' + esc(c.loteSugerido) + '</strong>' : '') +
              ' <span style="opacity:.8">(' + esc(fonte) + ')</span></div>';
    } else {
      html += '<div class="transf-preview-aviso">⚠ Sem validade/lote com saldo na origem para sugerir (FEFO).</div>';
    }
    if (c.precisaCadastroDestino) {
      html += '<div class="transf-preview-aviso">';
      html += '<strong>⚠ O destino não tem este SKU cadastrado.</strong><br/>';
      html += 'Ao confirmar, o sistema vai criar automaticamente o cadastro em ' +
              esc(c.donoDestino.NOME) + ' copiando: ' +
              '<em>' + esc(c.cadastroSugerido.CODIGO) + ' — ' + esc(c.cadastroSugerido.NOME) + '</em>.';
      html += '</div>';
    } else if (c.produtoDestino) {
      html += '<div class="transf-preview-info">✓ Destino: ' + esc(c.produtoDestino.CODIGO) +
              ' — ' + esc(c.produtoDestino.NOME) + ' (CD_PRODUTO ' + esc(c.produtoDestino.CD_PRODUTO) + ').</div>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  async function transfBuscarProdutosOrigem(termo) {
    var sel = document.getElementById('transfDonoOrigem');
    var cdOrigem = sel ? parseInt(sel.value, 10) : NaN;
    if (!Number.isFinite(cdOrigem)) return [];
    var t = String(termo || '').trim();
    if (!t || t.length < 2) return [];
    var url = '/api/wms/produtos-dono?cdDono=' + cdOrigem +
              '&somenteDono=1&fgactive=S&page=1&pageSize=25';
    var temDigito = /\d/.test(t);
    var temLetra = /[a-zA-Z]/.test(t);
    if (temDigito) url += '&codigo=' + encodeURIComponent(t);
    if (temLetra) url += '&nome=' + encodeURIComponent(t);
    try {
      var r = await api(url);
      if (!r.ok) return [];
      var data = await r.json();
      return data.itens || data.rows || data || [];
    } catch (_) { return []; }
  }

  function transfSetStatusDestino(msg, tipo) {
    var el = document.getElementById('transfCodigoDestinoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color =
      tipo === 'ok' ? 'var(--cor-sucesso, #15803d)' :
      tipo === 'erro' ? 'var(--cor-erro, #b91c1c)' : '';
  }

  async function transfBuscarProdutosDestino(termo) {
    var cdDestino = parseInt(document.getElementById('transfDonoDestino').value, 10);
    if (!Number.isFinite(cdDestino)) return [];
    var t = String(termo || '').trim();
    if (!t || t.length < 2) return [];
    var url = '/api/wms/produtos-dono?cdDono=' + cdDestino +
              '&somenteDono=1&fgactive=S&page=1&pageSize=25';
    if (/\d/.test(t)) url += '&codigo=' + encodeURIComponent(t);
    if (/[a-zA-Z]/.test(t)) url += '&nome=' + encodeURIComponent(t);
    try {
      var r = await api(url);
      if (!r.ok) return [];
      var data = await r.json();
      return data.itens || data.rows || data || [];
    } catch (_) { return []; }
  }

  function transfAtualizarDatalistDestino(produtos) {
    var dl = document.getElementById('transfCodigoDestinoSugestoes');
    if (!dl) return;
    dl.innerHTML = '';
    (produtos || []).slice(0, 25).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.CODIGO || '';
      opt.label = (p.NOME || '') + (p.UNIDADE ? ' (' + p.UNIDADE + ')' : '');
      dl.appendChild(opt);
    });
  }

  function transfAtualizarDatalist(produtos) {
    var dl = document.getElementById('transfCodigoSugestoes');
    if (!dl) return;
    dl.innerHTML = '';
    (produtos || []).slice(0, 25).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.CODIGO || '';
      opt.label = (p.NOME || '') + (p.UNIDADE ? ' (' + p.UNIDADE + ')' : '');
      dl.appendChild(opt);
    });
  }

  function transfResetForm() {
    /** Preenche os selects de dono usando o cache global de donos. */
    var selO = document.getElementById('transfDonoOrigem');
    var selD = document.getElementById('transfDonoDestino');
    selO.innerHTML = '<option value="">— Selecione —</option>';
    selD.innerHTML = '<option value="">— Selecione —</option>';
    (donosCache || []).forEach(function (d) {
      var label = esc(d.CD_DONO + ' — ' + (d.NOME || d.CODIGO || ''));
      selO.insertAdjacentHTML('beforeend', '<option value="' + esc(d.CD_DONO) + '">' + label + '</option>');
      selD.insertAdjacentHTML('beforeend', '<option value="' + esc(d.CD_DONO) + '">' + label + '</option>');
    });
    document.getElementById('transfCodigo').value = '';
    document.getElementById('transfCodigoDestino').value = '';
    document.getElementById('transfLote').value = '';
    document.getElementById('transfValidade').value = '';
    document.getElementById('transfQtd').value = '';
    document.getElementById('transfMotivo').value = '';
    transfSetStatus('');
    transfSetStatusDestino('');
    transfAtualizarDatalist([]);
    transfAtualizarDatalistDestino([]);
    transfRenderResumo(null);
    transfPreviewCache = null;
    document.getElementById('btnTransfConfirmar').disabled = true;
  }

  document.getElementById('btnAbrirTransferencia').addEventListener('click', function () {
    transfResetForm();
    var m = document.getElementById('modalTransferencia');
    m.hidden = false;
    m.classList.add('aberto');
    setTimeout(function () { document.getElementById('transfDonoOrigem').focus(); }, 50);
  });

  document.getElementById('btnTransfCancelar').addEventListener('click', function () {
    var m = document.getElementById('modalTransferencia');
    m.classList.remove('aberto');
    m.hidden = true;
  });

  /** Quando troca o dono de origem, limpa o código (porque o autocompletar
   *  depende do dono). */
  document.getElementById('transfDonoOrigem').addEventListener('change', function () {
    document.getElementById('transfCodigo').value = '';
    transfAtualizarDatalist([]);
    transfSetStatus('');
    transfPreviewCache = null;
    transfRenderResumo(null);
    document.getElementById('btnTransfConfirmar').disabled = true;
  });

  document.getElementById('transfDonoDestino').addEventListener('change', function () {
    document.getElementById('transfCodigoDestino').value = '';
    transfAtualizarDatalistDestino([]);
    transfSetStatusDestino('');
    transfPreviewCache = null;
    transfRenderResumo(null);
    document.getElementById('btnTransfConfirmar').disabled = true;
  });

  document.getElementById('transfCodigoDestino').addEventListener('input', function () {
    var v = this.value;
    if (transfBuscaTimer) clearTimeout(transfBuscaTimer);
    transfPreviewCache = null;
    transfRenderResumo(null);
    document.getElementById('btnTransfConfirmar').disabled = true;
    transfSetStatusDestino(v && v.length >= 2 ? 'Procurando…' : '');
    transfBuscaTimer = setTimeout(async function () {
      var lista = await transfBuscarProdutosDestino(v);
      transfAtualizarDatalistDestino(lista);
      if (!v) transfSetStatusDestino('');
      else if (!lista.length) transfSetStatusDestino('Nenhum produto encontrado no destino.', 'erro');
      else if (lista.length === 1) transfSetStatusDestino('✓ ' + (lista[0].CODIGO || '') + ' — ' + (lista[0].NOME || ''), 'ok');
      else transfSetStatusDestino(lista.length + ' produtos encontrados no destino.', 'ok');
    }, 250);
  });

  document.getElementById('transfCodigo').addEventListener('input', function () {
    var v = this.value;
    if (transfBuscaTimer) clearTimeout(transfBuscaTimer);
    transfPreviewCache = null;
    transfRenderResumo(null);
    document.getElementById('btnTransfConfirmar').disabled = true;
    transfSetStatus(v && v.length >= 2 ? 'Procurando…' : '');
    transfBuscaTimer = setTimeout(async function () {
      var lista = await transfBuscarProdutosOrigem(v);
      transfAtualizarDatalist(lista);
      if (!v) {
        transfSetStatus('');
      } else if (!lista.length) {
        transfSetStatus('Nenhum produto encontrado no dono de origem.', 'erro');
      } else if (lista.length === 1) {
        transfSetStatus('✓ ' + (lista[0].CODIGO || '') + ' — ' + (lista[0].NOME || ''), 'ok');
      } else {
        transfSetStatus(lista.length + ' produtos encontrados.', 'ok');
      }
    }, 250);
  });

  /** Coleta o payload sem validar nada — service do backend faz as checagens. */
  function transfColetarPayload() {
    return {
      cdDonoOrigem: parseInt(document.getElementById('transfDonoOrigem').value, 10),
      cdDonoDestino: parseInt(document.getElementById('transfDonoDestino').value, 10),
      codigoProduto: String(document.getElementById('transfCodigo').value || '').trim(),
      codigoProdutoDestino: String(document.getElementById('transfCodigoDestino').value || '').trim() || null,
      lote: String(document.getElementById('transfLote').value || '').trim() || null,
      validade: String(document.getElementById('transfValidade').value || '').trim() || null,
      qtd: Number(document.getElementById('transfQtd').value),
      motivo: String(document.getElementById('transfMotivo').value || '').trim() || null,
    };
  }

  document.getElementById('btnTransfPreview').addEventListener('click', async function () {
    var btn = this;
    var btnConfirm = document.getElementById('btnTransfConfirmar');
    btnConfirm.disabled = true;
    btn.disabled = true;
    btn.classList.add('btn-acao-loading');
    try {
      var r = await api('/api/wms/transferencias/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transfColetarPayload()),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.err || data.error || ('HTTP ' + r.status));
      transfPreviewCache = data;
      transfAplicarSugestaoValidade(data);
      transfRenderResumo(data);
      btnConfirm.disabled = !data.saldoOk; /* só destrava se há saldo */
    } catch (e) {
      transfRenderResumo(null);
      showMessage(e.message || 'Erro na pré-validação.', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-acao-loading');
    }
  });

  document.getElementById('btnTransfConfirmar').addEventListener('click', async function () {
    if (!transfPreviewCache) {
      showMessage('Clique em Pré-validar antes de confirmar.', 'error');
      return;
    }
    var preview = transfPreviewCache;
    /** Se precisa cadastrar no destino, pergunta explicitamente. */
    if (preview.precisaCadastroDestino) {
      var ok = window.confirm(
        'O destino "' + preview.donoDestino.NOME + '" NÃO TEM este SKU cadastrado.\n\n' +
        'Posso CRIAR o cadastro automaticamente, copiando:\n' +
        '  Código: ' + preview.cadastroSugerido.CODIGO + '\n' +
        '  Nome:   ' + preview.cadastroSugerido.NOME + '\n' +
        '  Unid.:  ' + (preview.cadastroSugerido.UNIDADE || '—') + '\n\n' +
        'Confirmar e efetivar a transferência?'
      );
      if (!ok) return;
    }
    var btn = this;
    btn.disabled = true;
    btn.classList.add('btn-acao-loading');
    try {
      var payload = transfColetarPayload();
      payload.autoCadastrarDestino = !!preview.precisaCadastroDestino;
      var r = await api('/api/wms/transferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.err || data.error || ('HTTP ' + r.status));
      var mTransf = document.getElementById('modalTransferencia');
      mTransf.classList.remove('aberto');
      mTransf.hidden = true;
      showMessage(
        'Transferência #' + data.CD_TRANSFERENCIA + ' efetivada · ' +
        fmtQtd(data.QTD) + ' de ' + data.NM_DONO_ORIGEM + ' → ' + data.NM_DONO_DESTINO +
        ' · Saldo origem: ' + fmtQtd(data.saldoOrigemDepois),
        'success'
      );
    } catch (e) {
      showMessage(e.message || 'Erro ao confirmar transferência.', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-acao-loading');
    }
  });

  document.getElementById('btnAddLinhaSalvar').addEventListener('click', async function () {
    if (!inventarioAtual) return;
    var codigo = String(document.getElementById('addCodigo').value || '').trim();
    if (!codigo) {
      showMessage('Informe o código do produto.', 'error');
      document.getElementById('addCodigo').focus();
      return;
    }
    var lote = String(document.getElementById('addLote').value || '').trim();
    var validade = String(document.getElementById('addValidade').value || '').trim();
    var qtdStr = String(document.getElementById('addQtd').value || '').trim();
    var qtd = qtdStr === '' ? null : Number(qtdStr);
    if (qtdStr !== '' && (!Number.isFinite(qtd) || qtd < 0)) {
      showMessage('Quantidade contada deve ser número ≥ 0.', 'error');
      return;
    }
    var btn = this;
    btn.disabled = true;
    btn.classList.add('btn-acao-loading');
    try {
      var r = await api('/api/wms/inventario/' + inventarioAtual + '/linhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigoProduto: codigo,
          lote: lote || null,
          validade: validade || null,
          qtdContada: qtd,
        }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        throw new Error(data.error || ('HTTP ' + r.status));
      }
      fecharModalAddLinha();
      await recarregarDetalheInPlace({ cdLinhaFoco: data.CD_LINHA });
      showMessage('SKU ' + (data.CODIGO_PRODUTO || codigo) + ' adicionado à contagem.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao adicionar SKU.', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-acao-loading');
    }
  });

  function voltarParaLista() {
    mostrarLista();
    carregarLista();
  }
  document.getElementById('btnVoltarLista').addEventListener('click', voltarParaLista);
  /** Botão grande no topo do detalhe (breadcrumb). Mesma função do "Voltar"
   *  do rodapé de ações, mas em destaque para o operador encontrar fácil. */
  var btnVoltarTopo = document.getElementById('btnVoltarListaTopo');
  if (btnVoltarTopo) btnVoltarTopo.addEventListener('click', voltarParaLista);
  /** Atalho Alt+Seta-esquerda: convenção de navegação web ("voltar"). Só
   *  ativa enquanto o detalhe está visível e o foco não está em um input
   *  (para não atrapalhar quem está digitando). */
  document.addEventListener('keydown', function (ev) {
    if (!ev.altKey || ev.key !== 'ArrowLeft') return;
    var detalheVisivel = !document.getElementById('viewDetalhe').hasAttribute('hidden');
    if (!detalheVisivel) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    ev.preventDefault();
    voltarParaLista();
  });

  document.getElementById('btnSnapshot').addEventListener('click', async function () {
    if (!inventarioAtual) return;
    if (!(await confirmar('Gerar snapshot do saldo atual?\nAs linhas anteriores serão substituídas.'))) return;
    showLoadingOverlay('Snapshot', 'Lendo posição de estoque…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/' + inventarioAtual + '/snapshot', { method: 'POST' });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      showMessage('Snapshot: ' + (body.linhasSnapshot || 0) + ' linha(s).', 'success');
      await abrirDetalhe(inventarioAtual);
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      hideLoadingOverlay();
    }
  });

  document.getElementById('inputCsv').addEventListener('change', async function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file || !inventarioAtual) return;
    var fd = new FormData();
    fd.append('arquivo', file);
    showLoadingOverlay('Importando', 'Processando planilha…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/' + inventarioAtual + '/importar-csv', {
        method: 'POST',
        body: fd,
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      await processarResultadoImport(body);
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      hideLoadingOverlay();
    }
  });

  document.getElementById('btnEncerrar').addEventListener('click', async function () {
    if (!inventarioAtual) return;
    if (inventarioStatusAtual === 'ENCERRADO' || inventarioStatusAtual === 'CANCELADO') {
      showMessage('Este inventário já está encerrado ou cancelado.', 'info');
      return;
    }
    if (
      !(await confirmar(
        (function () {
          var msg =
            'Encerrar inventário e aplicar ajustes de saldo?\n' +
            'Referência = saldo atual do ledger (coluna Sistema).\n' +
            'Esta ação não pode ser desfeita na tela.';
          var divs = (inventarioResumoAtual || []).filter(function (r) {
            return r.DIVERGENCIA_SNAPSHOT;
          });
          if (divs.length) {
            msg +=
              '\n\nAtenção: ' +
              divs.length +
              ' produto(s) com snapshot diferente do ledger. O ajuste usa o ledger, não o snapshot da linha.';
          }
          return msg;
        })(),
        { danger: false, okLabel: 'Encerrar' }
      ))
    )
      return;
    showLoadingOverlay('Encerrando', 'Gravando movimentos…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/' + inventarioAtual + '/encerrar', { method: 'POST' });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      showMessage('Encerrado. Movimentos registrados: ' + (body.movimentos || 0) + '.', 'success');
      await abrirDetalhe(inventarioAtual);
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      hideLoadingOverlay();
    }
  });

  function urlAtaRelatorio(queryString) {
    var q = queryString ? String(queryString).replace(/^\?/, '').replace(/^&/, '') : '';
    return (
      '/api/wms/inventario/' +
      encodeURIComponent(String(inventarioAtual)) +
      '/relatorio' +
      (q ? '?' + q : '')
    );
  }

  async function abrirAtaHtml(previa) {
    if (!inventarioAtual) return;
    var qs = 'formato=html' + queryRelatorioListaExtra('invAtaSeparadores', 'invAtaOrd');
    if (previa === true) qs += '&previa=1';
    else if (previa === false) qs += '&previa=0';
    showLoadingOverlay('Relatório', 'Gerando ata de inventário…', '');
    await yieldPaint();
    try {
      var res = await api(urlAtaRelatorio(qs), { headers: { Accept: 'text/html' } });
      if (!res.ok) {
        var errBody = await res.json().catch(function () {
          return {};
        });
        throw new Error(errBody.error || 'HTTP ' + res.status);
      }
      var html = await res.text();
      var w = window.open('', '_blank');
      if (!w) {
        showMessage('Permita pop-up para abrir a ata.', 'error');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      showMessage(
        previa === true || (previa !== false && inventarioStatusAtual !== 'ENCERRADO')
          ? 'Ata prévia aberta para impressão.'
          : 'Ata aberta para impressão e assinaturas.',
        'success'
      );
    } catch (e) {
      showMessage(e.message || 'Erro ao gerar ata.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function baixarAtaCsv(previa) {
    if (!inventarioAtual) return;
    var qs = 'formato=csv';
    if (previa === true) qs += '&previa=1';
    showLoadingOverlay('Exportando', 'Gerando CSV da ata…', '');
    await yieldPaint();
    try {
      var res = await api(urlAtaRelatorio(qs));
      if (!res.ok) {
        var errBody = await res.json().catch(function () {
          return {};
        });
        throw new Error(errBody.error || 'HTTP ' + res.status);
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'wms-inventario-ata-' + inventarioAtual + '.csv';
      a.click();
      URL.revokeObjectURL(url);
      showMessage('CSV da ata baixado.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao exportar CSV.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  document.getElementById('btnAtaPrevia').addEventListener('click', function () {
    abrirAtaHtml(true);
  });

  document.getElementById('btnAtaImprimir').addEventListener('click', function () {
    abrirAtaHtml(inventarioStatusAtual === 'ENCERRADO' ? false : null);
  });

  document.getElementById('btnAtaCsv').addEventListener('click', function () {
    baixarAtaCsv(inventarioStatusAtual !== 'ENCERRADO');
  });

  document.getElementById('btnCancelarInv').addEventListener('click', async function () {
    if (!inventarioAtual) return;
    if (!(await confirmar('Cancelar este inventário?', { danger: true, okLabel: 'Cancelar doc.' }))) return;
    try {
      var res = await api('/api/wms/inventario/' + inventarioAtual + '/cancelar', { method: 'POST' });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      showMessage('Inventário cancelado.', 'success');
      await abrirDetalhe(inventarioAtual);
    } catch (e) {
      showMessage(e.message, 'error');
    }
  });

  /** Reabrir: CANCELADO → EM_CONTAGEM; ENCERRADO → estorna ajustes e reabre. */
  var btnReativarEl = document.getElementById('btnReativarInv');
  if (btnReativarEl) {
    btnReativarEl.addEventListener('click', async function () {
      if (!inventarioAtual) return;
      var stAtual = inventarioStatusAtual || '';
      var msg =
        stAtual === 'ENCERRADO'
          ? 'Reabrir o inventário ENCERRADO #' +
            inventarioAtual +
            '?\n\nIsso vai ESTORNAR os ajustes de saldo aplicados no encerramento e voltar o documento para EM_CONTAGEM.\n\nConfirme só se o encerramento estiver errado.'
          : 'Reativar este inventário cancelado? O status voltará para EM_CONTAGEM e você poderá continuar a contagem.';
      if (!(await confirmar(msg, { okLabel: stAtual === 'ENCERRADO' ? 'Reabrir e estornar' : 'Reativar' }))) {
        return;
      }
      showLoadingOverlay('Reabrindo', 'Estornando ajustes e reabrindo inventário…', '');
      await yieldPaint();
      try {
        var res = await api('/api/wms/inventario/' + inventarioAtual + '/reativar', { method: 'POST' });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
        var extra =
          body.modo === 'ENCERRADO'
            ? ' · ' + (body.estornos || 0) + ' estorno(s) no ledger'
            : '';
        showMessage('Inventário #' + body.CD_INVENTARIO + ' reaberto' + extra + '.', 'success');
        await carregarLista();
        await abrirDetalhe(inventarioAtual);
      } catch (e) {
        showMessage((e && e.message) || 'Erro ao reabrir.', 'error');
      } finally {
        hideLoadingOverlay();
      }
    });
  }

  document.getElementById('btnRecarregarOrientacao').addEventListener('click', function () {
    document.getElementById('orientacaoDoc').innerHTML = '';
    carregarMarkdown('/api/wms/inventario/orientacao', 'orientacaoLoading', 'orientacaoDoc');
  });

  document.getElementById('btnFecharPainelErros').addEventListener('click', esconderPainelErros);

  document.getElementById('btnReimportarCsvPainel').addEventListener('click', function () {
    document.getElementById('btnImportarCsv').click();
  });

  document.getElementById('btnCancelarCadProd').addEventListener('click', fecharModalCadastro);

  document.getElementById('btnSalvarCadProd').addEventListener('click', function () {
    salvarCadastroEReimportar();
  });

  document.getElementById('btnDownloadPlanilha').addEventListener('click', async function () {
    try {
      var res = await api('/api/wms/inventario/planilha-modelo.csv');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'wms-inventario-planilha-modelo.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showMessage('Erro ao baixar modelo: ' + e.message, 'error');
    }
  });

  /* ====================== Inventário cíclico (gerador de lista) ====================== */

  var cicloCriterioSelecionado = null;
  var cicloPreviewCache = null;

  function lerOrdemRelatorio(prefix) {
    var out = [];
    [1, 2, 3].forEach(function (n) {
      var el = document.getElementById(prefix + n);
      var v = el && String(el.value || '').trim();
      if (v) out.push(v);
    });
    return out;
  }

  function lerSeparadoresRelatorio(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || 'nao').trim() : 'nao';
  }

  function queryRelatorioListaExtra(prefixSeparadores, prefixOrdem) {
    var q = [];
    var sep = lerSeparadoresRelatorio(prefixSeparadores);
    if (sep && sep !== 'nao') q.push('separadores=' + encodeURIComponent(sep));
    var ord = lerOrdemRelatorio(prefixOrdem);
    if (ord.length) q.push('ordem=' + encodeURIComponent(ord.join(',')));
    return q.length ? '&' + q.join('&') : '';
  }

  function rotuloGrupoWmsJs(cad) {
    return (cad && cad.NM_GRUPO && String(cad.NM_GRUPO).trim()) || 'Sem grupo';
  }

  function rotuloSubcategoriaWmsJs(cad) {
    if (!cad) return 'Sem categoria';
    var full = cad.NM_CATEGORIA ? String(cad.NM_CATEGORIA).trim() : '';
    var sep = full.indexOf(' › ');
    if (sep >= 0) return full.slice(0, sep).trim() || full;
    return full || 'Sem categoria';
  }

  function rotuloConservacaoJs(r, abrev) {
    if (r && r._bucket === 'REFRIG_CONG') {
      if (r._frioTipo === 'CONGELADO') return abrev ? 'CONG.' : 'CONGELADO';
      if (r._frioTipo === 'RESFRIADO') return abrev ? 'REFRIG.' : 'REFRIGERADO';
    }
    var t = String((r && r.TIPO_ARMAZENAGEM) || '').toUpperCase();
    if (t.indexOf('CONGEL') >= 0) return abrev ? 'CONG.' : 'CONGELADO';
    if (t.indexOf('REFRIG') >= 0) return abrev ? 'REFRIG.' : 'REFRIGERADO';
    return 'SECO';
  }

  function camposQuebraSeparadores(modo) {
    if (!modo || modo === 'nao') return [];
    if (modo === 'faixas_cons') return ['conservacao_faixas'];
    if (modo === 'conservacao') return ['conservacao'];
    if (modo === 'cons_grupo') return ['conservacao', 'grupo'];
    if (modo === 'cons_grupo_cat') return ['conservacao', 'grupo', 'subcategoria'];
    return [];
  }

  function valorOrdemLinhaCiclo(r, campo) {
    if (campo === 'conservacao' || campo === 'conservacao_faixas') {
      return rotuloConservacaoJs(r, campo === 'conservacao_faixas');
    }
    if (campo === 'grupo') return rotuloGrupoWmsJs(r && r._cadWms);
    if (campo === 'subcategoria') return rotuloSubcategoriaWmsJs(r && r._cadWms);
    if (campo === 'codigo') return String((r && r.CODIGO_PRODUTO) || '');
    if (campo === 'nome') return String((r && r.NM_PRODUTO) || '');
    if (campo === 'lote') return String((r && r.LOTE) || '');
    if (campo === 'validade') return String((r && r.VALIDADE) || '');
    if (campo === 'saldo') return Number((r && r.QTD_SISTEMA) || 0);
    return '';
  }

  function cmpOrdemCiclo(a, b, campo) {
    if (campo === 'saldo') {
      var na = Number(valorOrdemLinhaCiclo(a, campo)) || 0;
      var nb = Number(valorOrdemLinhaCiclo(b, campo)) || 0;
      return na - nb;
    }
    return String(valorOrdemLinhaCiclo(a, campo) || '').localeCompare(
      String(valorOrdemLinhaCiclo(b, campo) || ''),
      'pt-BR',
      { sensitivity: 'base' }
    );
  }

  function ordenarLinhasCicloPreview(linhas, ordem) {
    var ord =
      ordem && ordem.length
        ? ordem.slice()
        : ['conservacao', 'grupo', 'subcategoria', 'codigo', 'lote', 'validade'];
    return (linhas || []).slice().sort(function (a, b) {
      for (var i = 0; i < ord.length; i++) {
        var c = cmpOrdemCiclo(a, b, ord[i]);
        if (c !== 0) return c;
      }
      return String(a.CODIGO_PRODUTO || '').localeCompare(String(b.CODIGO_PRODUTO || ''), 'pt-BR');
    });
  }

  function rotuloSeparadorCiclo(r, campos) {
    var partes = [];
    (campos || []).forEach(function (c) {
      if (c === 'conservacao') partes.push(rotuloConservacaoJs(r, false));
      else if (c === 'conservacao_faixas') partes.push(rotuloConservacaoJs(r, true));
      else if (c === 'grupo') partes.push(rotuloGrupoWmsJs(r && r._cadWms));
      else if (c === 'subcategoria') partes.push(rotuloSubcategoriaWmsJs(r && r._cadWms));
    });
    return partes.filter(Boolean).join(' — ') || '—';
  }

  function chaveSeparadorCiclo(r, campos) {
    return (campos || []).map(function (c) { return valorOrdemLinhaCiclo(r, c); }).join('\u0001');
  }

  function abrirModalCiclico() {
    var modal = document.getElementById('modalCiclico');
    if (!modal) return;
    /** Reaproveita o dono escolhido no formulário "Novo inventário" se houver. */
    var donoForm = document.getElementById('novoCdDono');
    var donoCiclo = document.getElementById('cicloDono');
    if (donoForm && donoCiclo && donoForm.value && !donoCiclo.value) {
      donoCiclo.value = donoForm.value;
    }
    iniciarFiltrosCadastroCiclico();
    resetCicloUI();
    modal.hidden = false;
    modal.classList.add('aberto');
  }

  function fecharModalCiclico() {
    var modal = document.getElementById('modalCiclico');
    if (!modal) return;
    modal.classList.remove('aberto');
    modal.hidden = true;
  }

  /** Modal "Dividir lote/validade" — abre pré-preenchido com os dados da
   *  linha base. O operador altera lote e/ou validade (pelo menos um) e
   *  opcionalmente informa a quantidade contada na nova linha. */
  function abrirModalDividir(cdInventario, cdLinha, loteBase, validBase) {
    var modal = document.getElementById('modalDividir');
    if (!modal) return;
    document.getElementById('divInfo').textContent =
      'Linha de origem: #' + cdLinha +
      (loteBase ? ' · lote "' + loteBase + '"' : ' · sem lote') +
      (validBase ? ' · validade ' + validBase : ' · sem validade');
    modal.setAttribute('data-cd-inventario', String(cdInventario));
    modal.setAttribute('data-cd-linha', String(cdLinha));
    document.getElementById('divLote').value = loteBase || '';
    document.getElementById('divValidade').value = validBase || '';
    document.getElementById('divQtd').value = '';
    modal.hidden = false;
    modal.classList.add('aberto');
    setTimeout(function () {
      var primeiro = document.getElementById('divLote');
      if (primeiro) primeiro.focus();
    }, 80);
  }
  function fecharModalDividir() {
    var modal = document.getElementById('modalDividir');
    if (!modal) return;
    modal.classList.remove('aberto');
    modal.hidden = true;
  }
  async function submeterDividir() {
    var modal = document.getElementById('modalDividir');
    if (!modal) return;
    var cdInv = parseInt(modal.getAttribute('data-cd-inventario'), 10);
    var cdLin = parseInt(modal.getAttribute('data-cd-linha'), 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) return;
    var lote = (document.getElementById('divLote').value || '').trim();
    var validade = (document.getElementById('divValidade').value || '').trim();
    var qtdRaw = (document.getElementById('divQtd').value || '').trim();
    var qtdContada = qtdRaw === '' ? null : Number(qtdRaw);
    if (qtdRaw !== '' && (!Number.isFinite(qtdContada) || qtdContada < 0)) {
      showMessage('Quantidade contada inválida.', 'error');
      return;
    }
    try {
      var res = await api('/api/wms/inventario/' + cdInv + '/linhas/' + cdLin + '/dividir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lote: lote, validade: validade, qtdContada: qtdContada }),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      fecharModalDividir();
      await recarregarDetalheInPlace({ cdLinhaFoco: body.CD_LINHA });
      showMessage(
        'Nova linha #' + body.CD_LINHA + ' criada (' + body.ST_LINHA + ').',
        'success'
      );
    } catch (e) {
      showMessage((e && e.message) || 'Erro ao dividir linha.', 'error');
    }
  }

  function resetCicloUI() {
    cicloCriterioSelecionado = null;
    cicloPreviewCache = null;
    document
      .querySelectorAll('#cicloCriteriosGrid .criterio-card')
      .forEach(function (el) {
        el.classList.remove('selecionado');
      });
    var status = document.getElementById('cicloStatus');
    if (status) {
      status.style.display = 'none';
      status.textContent = '';
      status.classList.remove('preview-status-ok');
      status.classList.remove('preview-status-vazio');
    }
    var wrap = document.getElementById('cicloPreviewWrap');
    if (wrap) wrap.style.display = 'none';
    var body = document.getElementById('cicloPreviewBody');
    if (body) body.innerHTML = '';
    var btnCriar = document.getElementById('btnCicloCriar');
    if (btnCriar) btnCriar.disabled = true;
    var btnImp = document.getElementById('btnCicloImprimir');
    if (btnImp) btnImp.disabled = true;
  }

  function lerPayloadCiclico() {
    var cdGrupoRaw = (document.getElementById('cicloCdGrupo') || {}).value;
    var cdCatRaw = (document.getElementById('cicloCdCategoria') || {}).value;
    return {
      cdDono: parseInt(document.getElementById('cicloDono').value, 10),
      criterio: cicloCriterioSelecionado,
      limite: parseInt(document.getElementById('cicloLimite').value, 10),
      diasJanela: parseInt(document.getElementById('cicloJanela').value, 10),
      conservacao: document.getElementById('cicloConservacao').value.trim(),
      codigoProduto: document.getElementById('cicloCodigo').value.trim(),
      palavraChave: (document.getElementById('cicloPalavraChave') || { value: '' }).value.trim(),
      cdGrupo: cdGrupoRaw ? parseInt(cdGrupoRaw, 10) : null,
      cdCategoria: cdCatRaw ? parseInt(cdCatRaw, 10) : null,
      observacao: document.getElementById('cicloObs').value.trim(),
    };
  }

  function fillCicloGrupoSelect(done) {
    var sel = document.getElementById('cicloCdGrupo');
    if (!sel) {
      if (typeof done === 'function') done();
      return;
    }
    var keep = sel.value;
    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="">Carregando grupos…</option>';
    }
    api('/api/wms/grupos-produto?fgactive=S')
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error((body && body.error) || 'HTTP ' + r.status);
          return body;
        });
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) {
          if (rows && Array.isArray(rows.data)) rows = rows.data;
          else if (rows && Array.isArray(rows.rows)) rows = rows.rows;
          else throw new Error('Resposta inválida de grupos.');
        }
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todos';
        sel.appendChild(o0);
        rows.forEach(function (g) {
          var o = document.createElement('option');
          o.value = String(g.CD_GRUPO);
          o.textContent = (g.CODIGO ? g.CODIGO + ' — ' : '') + (g.NOME || '');
          sel.appendChild(o);
        });
        if (keep && Array.prototype.some.call(sel.options, function (x) { return x.value === keep; })) {
          sel.value = keep;
        }
        if (typeof done === 'function') done();
      })
      .catch(function (err) {
        sel.innerHTML = '<option value="">Todos (falha ao carregar)</option>';
        console.warn('[WMS inventário] grupos:', err);
        showMessage('Não foi possível carregar o combo de Grupo: ' + (err.message || err), 'error');
        if (typeof done === 'function') done();
      });
  }

  function fillCicloCategoriaSelect(done) {
    var sel = document.getElementById('cicloCdCategoria');
    if (!sel) {
      if (typeof done === 'function') done();
      return;
    }
    var keep = sel.value;
    var cdGrupo = (document.getElementById('cicloCdGrupo') || {}).value || '';
    var q = new URLSearchParams({ fgactive: 'S' });
    if (cdGrupo) q.append('cdGrupo', String(cdGrupo));
    api('/api/wms/categorias-produto?' + q.toString())
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error((body && body.error) || 'HTTP ' + r.status);
          return body;
        });
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) {
          if (rows && Array.isArray(rows.data)) rows = rows.data;
          else if (rows && Array.isArray(rows.rows)) rows = rows.rows;
          else throw new Error('Resposta inválida de categorias.');
        }
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todas';
        sel.appendChild(o0);
        rows.forEach(function (c) {
          var o = document.createElement('option');
          o.value = String(c.CD_CATEGORIA);
          var grp = c.NM_GRUPO ? ' (' + c.NM_GRUPO + ')' : '';
          o.textContent = (c.CODIGO || '') + ' — ' + (c.NOME || '') + grp;
          sel.appendChild(o);
        });
        if (keep && Array.prototype.some.call(sel.options, function (x) { return x.value === keep; })) {
          sel.value = keep;
        } else {
          sel.value = '';
        }
        if (typeof done === 'function') done();
      })
      .catch(function (err) {
        sel.innerHTML = '<option value="">Todas (falha ao carregar)</option>';
        console.warn('[WMS inventário] categorias:', err);
        if (typeof done === 'function') done();
      });
  }

  function iniciarFiltrosCadastroCiclico() {
    fillCicloGrupoSelect(function () {
      fillCicloCategoriaSelect();
    });
    var selG = document.getElementById('cicloCdGrupo');
    if (selG && !selG._cicloBound) {
      selG._cicloBound = true;
      selG.addEventListener('change', function () {
        fillCicloCategoriaSelect();
      });
    }
  }

  function fmtDataHoraCurta(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 10);
      return (
        d.toLocaleDateString('pt-BR') +
        ' ' +
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      );
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  }

  function fmtValidadeBr(v) {
    if (!v) return '';
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }

  function renderPreviewCiclico(payload) {
    var body = document.getElementById('cicloPreviewBody');
    if (!body) return;
    cicloPreviewCache = payload;
    if (!payload.linhas || !payload.linhas.length) {
      body.innerHTML =
        '<tr><td colspan="10" style="text-align:center; padding:18px; color:#64748b;">Nenhum SKU atende ao critério.</td></tr>';
      return;
    }
    var ordem = lerOrdemRelatorio('cicloOrd');
    var modoSep = lerSeparadoresRelatorio('cicloSeparadores');
    var camposQuebra = camposQuebraSeparadores(modoSep);
    var linhas = ordenarLinhasCicloPreview(payload.linhas, ordem);
    var html = '';
    var chaveAnterior = null;
    var idx = 0;
    linhas.forEach(function (r) {
      if (camposQuebra.length) {
        var chaveAtual = chaveSeparadorCiclo(r, camposQuebra);
        if (chaveAtual !== chaveAnterior) {
          html +=
            '<tr class="ciclo-grp-sep"><td colspan="10"><span style="color:#1d4ed8;margin-right:4px">▌</span>' +
            esc(rotuloSeparadorCiclo(r, camposQuebra)) +
            '</td></tr>';
          chaveAnterior = chaveAtual;
        }
      }
      idx += 1;
      var diasVenc = r.DIAS_ATE_VENCER;
      var clsVenc =
        diasVenc != null && diasVenc <= 30 ? 'badge-venc-prox' : 'badge-venc-ok';
      html +=
        '<tr>' +
        '<td>' + idx + '</td>' +
        '<td>' + esc(r.CODIGO_PRODUTO) + '</td>' +
        '<td>' + esc(r.NM_PRODUTO || '') + '</td>' +
        '<td>' + esc(r.LOTE || '') + '</td>' +
        '<td>' + esc(fmtValidadeBr(r.VALIDADE)) + '</td>' +
        '<td>' + (Number(r.QTD_SISTEMA) || 0).toLocaleString('pt-BR') + '</td>' +
        '<td class="' + clsVenc + '">' +
        (diasVenc != null ? diasVenc + 'd' : '—') +
        '</td>' +
        '<td>' +
        (r.QTD_MOVIMENTOS_JANELA != null
          ? Number(r.QTD_MOVIMENTOS_JANELA).toLocaleString('pt-BR')
          : '—') +
        '</td>' +
        '<td>' + esc(fmtDataHoraCurta(r.DH_ULTIMA_CONTAGEM)) + '</td>' +
        '<td>' + esc(r.TIPO_ARMAZENAGEM || '') + '</td>' +
        '</tr>';
    });
    body.innerHTML = html;
  }

  async function previewCiclico() {
    var payload = lerPayloadCiclico();
    if (!Number.isFinite(payload.cdDono)) {
      showMessage('Selecione o dono do estoque.', 'error');
      return;
    }
    if (!payload.criterio) {
      showMessage('Escolha um critério.', 'error');
      return;
    }
    var status = document.getElementById('cicloStatus');
    var wrap = document.getElementById('cicloPreviewWrap');
    var btnCriar = document.getElementById('btnCicloCriar');
    showLoadingOverlay('Gerando lista', 'Calculando candidatos…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/lista-ciclica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      renderPreviewCiclico(body);
      var temLinhas = !!(body.linhas && body.linhas.length);
      if (wrap) wrap.style.display = temLinhas ? 'block' : 'none';
      if (status) {
        status.style.display = 'block';
        status.classList.remove('preview-status-vazio');
        if (temLinhas) status.classList.add('preview-status-ok');
        else status.classList.add('preview-status-vazio');
        var filtros = [];
        if (body.filtros) {
          if (body.filtros.conservacao) filtros.push('conserv: ' + body.filtros.conservacao);
          if (body.filtros.palavraChaveProduto)
            filtros.push('produto: ' + body.filtros.palavraChaveProduto);
          if (body.filtros.codigoProduto)
            filtros.push('código: ' + body.filtros.codigoProduto);
        }
        var iconHtml = temLinhas
          ? '<i class="bx bx-check-circle" style="font-size:1.2rem;vertical-align:middle;margin-right:6px;"></i>'
          : '<i class="bx bx-info-circle" style="font-size:1.2rem;vertical-align:middle;margin-right:6px;"></i>';
        status.innerHTML =
          iconHtml +
          '<strong>' + (temLinhas ? body.retornados + ' SKU(s) selecionado(s)' : 'Nenhum SKU atende ao critério') + '</strong>' +
          ' &nbsp;·&nbsp; Critério: <strong>' + body.criterio + '</strong>' +
          ' &nbsp;·&nbsp; Janela: ' + body.diasJanela + 'd' +
          ' &nbsp;·&nbsp; Limite: ' + body.limite +
          ' &nbsp;·&nbsp; Candidatos avaliados: ' + body.total +
          (filtros.length ? '<br>Filtros: ' + filtros.join(' · ') : '') +
          (body.aviso ? '<br><span style="font-size:12px">' + esc(body.aviso) + '</span>' : '');
      }
      if (btnCriar) btnCriar.disabled = !temLinhas;
      var btnImp = document.getElementById('btnCicloImprimir');
      if (btnImp) btnImp.disabled = !temLinhas;
      /** Auto-scroll do .modal-body para o banner de status. Mostrar o status
       *  primeiro deixa o cabeçalho da preview visível logo abaixo (e não a
       *  partir da linha 2, como acontecia ao rolar direto pro `wrap`). */
      setTimeout(function () {
        var body = document.querySelector('#modalCiclico .modal-body');
        if (!body || !status) return;
        if (typeof body.scrollTo === 'function') {
          var topo = status.offsetTop - body.offsetTop - 4;
          body.scrollTo({ top: Math.max(0, topo), behavior: 'smooth' });
        } else if (typeof status.scrollIntoView === 'function') {
          status.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
    } catch (e) {
      showMessage(e.message || 'Erro ao gerar lista.', 'error');
      if (wrap) wrap.style.display = 'none';
      if (btnCriar) btnCriar.disabled = true;
    } finally {
      hideLoadingOverlay();
    }
  }

  async function imprimirListaCiclico() {
    if (!cicloPreviewCache || !cicloPreviewCache.linhas || !cicloPreviewCache.linhas.length) {
      showMessage('Gere a pré-visualização antes de imprimir.', 'error');
      return;
    }
    var payload = lerPayloadCiclico();
    payload.formato = 'html';
    payload.separadores = lerSeparadoresRelatorio('cicloSeparadores');
    payload.ordem = lerOrdemRelatorio('cicloOrd');
    showLoadingOverlay('Impressão', 'Gerando lista para impressão…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/lista-ciclica?formato=html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || 'HTTP ' + res.status);
      }
      var html = await res.text();
      var w = window.open('', '_blank');
      if (!w) {
        showMessage('Permita pop-up para imprimir a lista.', 'error');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      showMessage('Lista aberta para impressão.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao imprimir lista.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function criarCicloComLista() {
    var payload = lerPayloadCiclico();
    if (!Number.isFinite(payload.cdDono) || !payload.criterio) return;
    var confirma = window.confirmPadrao
      ? await window.confirmPadrao(
          'Criar inventário cíclico com a lista exibida? Apenas os SKUs listados serão ajustados no encerramento.',
          { confirmText: 'Criar', cancelText: 'Cancelar' }
        )
      : window.confirm('Criar inventário cíclico com a lista exibida?');
    if (!confirma) return;
    showLoadingOverlay('Criando', 'Persistindo inventário cíclico…', '');
    await yieldPaint();
    try {
      var res = await api('/api/wms/inventario/ciclico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      showMessage(
        'Inventário cíclico #' + body.CD_INVENTARIO +
          ' criado com ' + body.linhasGeradas + ' linhas (' + body.criterio + ').',
        'success'
      );
      cicloRecemCriado = body.CD_INVENTARIO; // sinaliza banner "próximos passos"
      fecharModalCiclico();
      await carregarLista();
      abrirDetalhe(body.CD_INVENTARIO);
    } catch (e) {
      showMessage(e.message || 'Erro ao criar inventário cíclico.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  document
    .getElementById('btnAbrirCiclico')
    .addEventListener('click', abrirModalCiclico);
  document
    .getElementById('btnCicloCancelar')
    .addEventListener('click', fecharModalCiclico);
  document
    .getElementById('btnCicloPreview')
    .addEventListener('click', previewCiclico);
  var btnCicloImprimir = document.getElementById('btnCicloImprimir');
  if (btnCicloImprimir) btnCicloImprimir.addEventListener('click', imprimirListaCiclico);
  ['cicloSeparadores', 'cicloOrd1', 'cicloOrd2', 'cicloOrd3'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (cicloPreviewCache) renderPreviewCiclico(cicloPreviewCache);
    });
  });
  document
    .getElementById('btnCicloCriar')
    .addEventListener('click', criarCicloComLista);

  /** Modal "Dividir lote/validade" — botões Salvar / Cancelar. */
  var btnDivSalvar = document.getElementById('btnDivSalvar');
  var btnDivCancelar = document.getElementById('btnDivCancelar');
  if (btnDivSalvar) btnDivSalvar.addEventListener('click', submeterDividir);
  if (btnDivCancelar) btnDivCancelar.addEventListener('click', fecharModalDividir);
  document
    .querySelectorAll('#cicloCriteriosGrid .criterio-card')
    .forEach(function (card) {
      card.addEventListener('click', function () {
        document
          .querySelectorAll('#cicloCriteriosGrid .criterio-card')
          .forEach(function (el) {
            el.classList.remove('selecionado');
          });
        card.classList.add('selecionado');
        cicloCriterioSelecionado = card.getAttribute('data-criterio');
        var btnCriar = document.getElementById('btnCicloCriar');
        if (btnCriar) btnCriar.disabled = true; // exige novo preview
      });
    });

  /** Bloqueia o fluxo "Novo inventário" quando o usuário escolhe CICLICO sem
   *  passar pelo gerador — direciona ao modal correto. */
  var novoTpSel = document.getElementById('novoTp');
  if (novoTpSel) {
    novoTpSel.addEventListener('change', function () {
      if (novoTpSel.value === 'CICLICO') {
        showMessage(
          'Para inventário cíclico use o botão "Gerar lista de ciclo".',
          'info'
        );
        novoTpSel.value = 'GERAL';
        abrirModalCiclico();
      }
    });
  }

  var consultaForm = document.getElementById('consultaItensForm');
  if (consultaForm) {
    consultaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      carregarConsultaItens();
    });
  }
  var btnLimparConsulta = document.getElementById('btnLimparConsulta');
  if (btnLimparConsulta) {
    btnLimparConsulta.addEventListener('click', function () {
      document.getElementById('consultaDono').value = '';
      document.getElementById('consultaCodigo').value = '';
      document.getElementById('consultaDescricao').value = '';
      document.getElementById('consultaCdInv').value = '';
      document.getElementById('consultaSt').value = 'ENCERRADO';
      document.getElementById('consultaTp').value = '';
      document.getElementById('consultaDtDe').value = '';
      document.getElementById('consultaDtAte').value = '';
      consultaItensCache = [];
      var btnCsv = document.getElementById('btnExportConsultaCsv');
      if (btnCsv) btnCsv.disabled = true;
      var resumo = document.getElementById('consultaResumo');
      if (resumo) resumo.textContent = '';
      var tb = document.getElementById('tblConsultaItensBody');
      if (tb) {
        tb.innerHTML = '<tr><td colspan="14" class="hint">Use os filtros acima e clique em Filtrar.</td></tr>';
      }
    });
  }
  var btnExportConsultaCsv = document.getElementById('btnExportConsultaCsv');
  if (btnExportConsultaCsv) {
    btnExportConsultaCsv.addEventListener('click', exportarConsultaCsv);
  }

  carregarDonos()
    .then(function () {
      return carregarLista();
    })
    .catch(function (e) {
      showMessage(e.message || 'Falha ao iniciar módulo.', 'error');
    });
})();
