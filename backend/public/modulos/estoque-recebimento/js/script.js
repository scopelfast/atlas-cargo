// WMS Recebimento — padrão Torre (abas, overlay, GridEditor).
(function () {
  var lastRows = [];
  var gridLoaded = false;
  var gridTab = null;
  var importSubmitting = false;
  var initFeito = false;
  var detalheDocAtual = null;
  var wmsRecLiberacaoPendente = null;
  var produtosDonoAtual = [];
  var produtosDonoTruncated = false;
  var lotesCrossdock = [];
  /** UI crossdock em lote desligada até priorizar fluxo (estoque de terceiros + recebimento). */
  var WMS_REC_CROSSDOCK_UI_ENABLED = false;

  function t(k, fb) {
    if (typeof window.tWeb === 'function') {
      var x = window.tWeb(k);
      if (x && x !== k && !String(x).startsWith('web.')) return x;
    }
    return fb != null ? fb : k;
  }

  var messageEl = document.getElementById('message');

  function showMessage(text, type, el, fieldId) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, el || messageEl, fieldId);
      return;
    }
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.className = 'message ' + (type || '');
    messageEl.style.display = text ? 'block' : 'none';
  }

  function showLoadingOverlay(titulo, texto, det) {
    var o = document.getElementById('loadingOverlay');
    if (!o) return;
    var a = document.getElementById('loadingTitle');
    var b = document.getElementById('loadingText');
    var c = document.getElementById('loadingDetalhe');
    if (a) a.textContent = titulo || 'Carregando';
    if (b) b.textContent = texto || 'Aguarde...';
    if (c) c.textContent = det || 'Isso pode levar alguns segundos.';
    if (o.parentNode !== document.body) document.body.appendChild(o);
    o.style.cssText =
      'display:flex !important; position:fixed !important; top:0; left:0; right:0; bottom:0; z-index:99999; background:rgba(0,0,0,0.75); align-items:center; justify-content:center;';
  }

  function hideLoadingOverlay() {
    var o = document.getElementById('loadingOverlay');
    if (!o) return;
    o.style.display = 'none';
    var contentArea = document.getElementById('contentArea');
    var mod = contentArea && contentArea.querySelector('.wms-rec-container');
    if (o.parentNode === document.body && mod) {
      mod.insertBefore(o, mod.firstChild);
    } else if (o.parentNode === document.body) {
      o.remove();
    }
  }

  function escaparHtmlLiberacao(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function labelTpAcaoLiberacaoValidade(tp) {
    var t = String(tp || '').toUpperCase();
    if (t === 'ENCERRAR') return 'Encerrar NF';
    if (t === 'CONFERENCIA') return 'Salvar conferência';
    return t || '—';
  }

  function resumirFalhasLiberacaoValidade(falhasRaw) {
    var arr = [];
    if (Array.isArray(falhasRaw)) arr = falhasRaw;
    else if (falhasRaw != null && typeof falhasRaw === 'string') {
      try {
        var p = JSON.parse(falhasRaw);
        arr = Array.isArray(p) ? p : [];
      } catch (_) {
        arr = [];
      }
    }
    if (!arr.length) return '';
    return arr.length + ' item(ns) com validade abaixo do mínimo';
  }

  function renderizarHistoricoLiberacoesValidade(lista) {
    var wrap = document.getElementById('wmsRecHistoricoLiberacaoWrap');
    var body = document.getElementById('wmsRecHistoricoLiberacaoBody');
    var badge = document.getElementById('wmsRecHistoricoLiberacaoBadge');
    if (!wrap || !body) return;
    var itens = Array.isArray(lista) ? lista : [];
    if (!itens.length) {
      wrap.classList.remove('visivel');
      if (badge) badge.textContent = '';
      body.innerHTML = '<div class="wms-rec-historico-empty">Sem liberação registrada para esta NF.</div>';
      return;
    }
    wrap.classList.add('visivel');
    if (badge) {
      badge.textContent =
        itens.length + (itens.length === 1 ? ' liberação registrada' : ' liberações registradas');
    }
    body.innerHTML = itens
      .map(function (h) {
        var dh = formatDateTimeLocal(h.DH_LIBERACAO || h.dh_liberacao);
        var acao = labelTpAcaoLiberacaoValidade(h.TP_ACAO || h.tp_acao);
        var operador = String(h.SG_USER_OPERADOR || h.sg_user_operador || '').trim() || '—';
        var autorLogin = String(h.AUTORIZADO_LOGIN || h.autorizado_login || '').trim();
        var autorNome = String(h.AUTORIZADO_NOME || h.autorizado_nome || '').trim();
        var autor =
          autorNome && autorLogin ? autorNome + ' (' + autorLogin + ')' : autorLogin || autorNome || '—';
        var just = String(h.JUSTIFICATIVA || h.justificativa || '').trim() || '—';
        var diasMin =
          h.NU_DIAS_MIN_POLITICA != null || h.nu_dias_min_politica != null
            ? String(h.NU_DIAS_MIN_POLITICA != null ? h.NU_DIAS_MIN_POLITICA : h.nu_dias_min_politica)
            : '—';
        var resumoFalhas = resumirFalhasLiberacaoValidade(h.FALHAS_JSON || h.falhas_json);
        return (
          '<div class="wms-rec-historico-item">' +
          '<div><b>Data:</b> ' +
          escaparHtmlLiberacao(dh) +
          ' · <b>Ação:</b> ' +
          escaparHtmlLiberacao(acao) +
          ' · <b>Mínimo dono:</b> ' +
          escaparHtmlLiberacao(diasMin) +
          ' dia(s)</div>' +
          '<div><b>Operador:</b> ' +
          escaparHtmlLiberacao(operador) +
          '</div>' +
          '<div><b>Autorizador:</b> ' +
          escaparHtmlLiberacao(autor) +
          '</div>' +
          (resumoFalhas
            ? '<div><b>Itens:</b> ' + escaparHtmlLiberacao(resumoFalhas) + '</div>'
            : '') +
          '<div><b>Justificativa:</b> ' +
          escaparHtmlLiberacao(just) +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function ocultarPainelLiberacaoValidade() {
    var wrap = document.getElementById('wmsRecLiberacaoWrap');
    if (wrap) wrap.style.display = 'none';
    wmsRecLiberacaoPendente = null;
    var intro = document.getElementById('wmsRecLiberacaoIntro');
    var tbody = document.getElementById('wmsRecLiberacaoFalhasBody');
    if (intro) intro.textContent = '';
    if (tbody) tbody.innerHTML = '';
    var j = document.getElementById('wmsRecLibJustificativa');
    var l = document.getElementById('wmsRecLibAutorLogin');
    var s = document.getElementById('wmsRecLibAutorSenha');
    if (j) j.value = '';
    if (l) l.value = '';
    if (s) s.value = '';
    var b1 = document.getElementById('wmsRecLibConfirmarSalvar');
    var b2 = document.getElementById('wmsRecLibConfirmarEncerrar');
    if (b1) b1.style.display = 'none';
    if (b2) b2.style.display = 'none';
  }

  function lerCamposLiberacaoValidadeModal() {
    var j = document.getElementById('wmsRecLibJustificativa');
    var l = document.getElementById('wmsRecLibAutorLogin');
    var s = document.getElementById('wmsRecLibAutorSenha');
    return {
      justificativa: j ? String(j.value || '').trim() : '',
      autorizadoLogin: l ? String(l.value || '').trim() : '',
      autorizadoSenha: s ? String(s.value || '') : '',
    };
  }

  function validarCamposLiberacaoValidadeModal() {
    var c = lerCamposLiberacaoValidadeModal();
    if (!c.justificativa) {
      showMessage('Preencha a justificativa da liberação.', 'error', null, 'wmsRecLibJustificativa');
      var j = document.getElementById('wmsRecLibJustificativa');
      if (j && j.focus) j.focus();
      return null;
    }
    if (!c.autorizadoLogin) {
      showMessage('Informe o usuário autorizador (login do cadastro de usuários).', 'error', null, 'wmsRecLibAutorLogin');
      var l = document.getElementById('wmsRecLibAutorLogin');
      if (l && l.focus) l.focus();
      return null;
    }
    if (!c.autorizadoSenha) {
      showMessage('Informe a senha do autorizador.', 'error', null, 'wmsRecLibAutorSenha');
      var s = document.getElementById('wmsRecLibAutorSenha');
      if (s && s.focus) s.focus();
      return null;
    }
    return c;
  }

  function montarIntroLiberacaoValidade(body) {
    var dias = body && body.diasMinPolitica != null ? String(body.diasMinPolitica) : '—';
    return (
      'O dono exige no mínimo ' +
      dias +
      ' dia(s) até o vencimento. A operação foi bloqueada. Informe justificativa e credenciais de um supervisor autorizado para continuar.'
    );
  }

  function preencherTabelaFalhasValidadeMin(body) {
    var tbody = document.getElementById('wmsRecLiberacaoFalhasBody');
    if (!tbody) return;
    var falhas = body && Array.isArray(body.falhasValidadeMin) ? body.falhasValidadeMin : [];
    if (!falhas.length) {
      tbody.innerHTML =
        '<tr><td colspan="2">Nenhum detalhe de item retornado pelo servidor.</td></tr>';
      return;
    }
    tbody.innerHTML = falhas
      .map(function (f) {
        var n = f && f.nItem != null ? String(f.nItem) : '?';
        var m = f && f.mensagem ? String(f.mensagem).trim() : '';
        return (
          '<tr><td>' +
          escaparHtmlLiberacao(n) +
          '</td><td>' +
          escaparHtmlLiberacao(m) +
          '</td></tr>'
        );
      })
      .join('');
  }

  function mostrarPainelLiberacaoValidade(acao, body) {
    var wrap = document.getElementById('wmsRecLiberacaoWrap');
    if (!wrap) return;
    wmsRecLiberacaoPendente = { acao: acao, body: body || {} };
    var intro = document.getElementById('wmsRecLiberacaoIntro');
    if (intro) intro.textContent = montarIntroLiberacaoValidade(body || {});
    preencherTabelaFalhasValidadeMin(body || {});
    var bSalvar = document.getElementById('wmsRecLibConfirmarSalvar');
    var bEnc = document.getElementById('wmsRecLibConfirmarEncerrar');
    if (bSalvar) bSalvar.style.display = acao === 'conferencia' ? 'inline-flex' : 'none';
    if (bEnc) bEnc.style.display = acao === 'encerrar' ? 'inline-flex' : 'none';
    wrap.style.display = 'block';
    try {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}
    setTimeout(function () {
      var j = document.getElementById('wmsRecLibJustificativa');
      if (j && j.focus) j.focus();
    }, 30);
  }

  function getAuthHeaders() {
    var headers = {};
    var token = localStorage.getItem('token');
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return headers;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (typeof window.GridEditor !== 'undefined' && src.indexOf('grid-editor') >= 0) {
        resolve();
        return;
      }
      var sc = document.createElement('script');
      var u = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl(src) : src) + '?t=' + Date.now();
      sc.src = u;
      sc.onload = function () {
        setTimeout(resolve, 80);
      };
      sc.onerror = function () {
        reject(new Error(src));
      };
      document.head.appendChild(sc);
    });
  }

  async function showTab(tabId) {
    var targetContent = document.getElementById('tab-' + tabId);
    var targetBtn = document.querySelector('.wms-rec-container .tab-btn[data-tab="' + tabId + '"]');
    if (!targetContent || !targetBtn) return;
    var container = targetContent.closest('.wms-rec-container') || targetContent.parentElement;
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
      if (!lastRows || lastRows.length === 0) {
        if (!gridLoaded) {
          await applyFilters('grid');
          return;
        }
      }
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
          console.error('[WMS Rec] grid:', err);
        }
      }
    }

    if (tabId === 'filtros') {
      var tbEnv = document.getElementById('wmsRecEnvioVencBody');
      if (tbEnv) {
        tbEnv.innerHTML =
          '<tr><td colspan="5" style="padding:12px 6px;color:#64748b">Carregando…</td></tr>';
      }
      carregarHistoricoEnviosVencimento({ silencioso: true });
    }
  }

  function disposeGrid() {
    var el = document.getElementById('wmsRecGrid');
    if (el) el.innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
    gridTab = null;
  }

  function formatDateTimeLocal(value) {
    if (!value) return '';
    var dt = value instanceof Date ? value : new Date(value);
    if (isNaN(dt.getTime())) return String(value || '');
    var dd = String(dt.getDate()).padStart(2, '0');
    var mm = String(dt.getMonth() + 1).padStart(2, '0');
    var yyyy = String(dt.getFullYear());
    var hh = String(dt.getHours()).padStart(2, '0');
    var mi = String(dt.getMinutes()).padStart(2, '0');
    var ss = String(dt.getSeconds()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi + ':' + ss;
  }

  /**
   * Data de calendário (emissão / recebimento na doca) — só o dia.
   * Nunca usar `new Date('YYYY-MM-DD')`: em fuso BR vira véspera (UTC midnight).
   */
  function formatDataNf(value) {
    if (!value) return '';
    var s = String(value).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    var dt = value instanceof Date ? value : new Date(value);
    if (isNaN(dt.getTime())) return s;
    var dd = String(dt.getDate()).padStart(2, '0');
    var mm = String(dt.getMonth() + 1).padStart(2, '0');
    var yyyy = String(dt.getFullYear());
    return dd + '/' + mm + '/' + yyyy;
  }

  function hojeIsoDateInput() {
    var d = new Date();
    return (
      String(d.getFullYear()) +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function docDtRecebimentoIso(doc) {
    if (!doc) return '';
    var v = doc.DT_RECEBIMENTO != null ? doc.DT_RECEBIMENTO : doc.dt_recebimento;
    if (v == null || String(v).trim() === '') return '';
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return '';
  }

  function lerDtRecebimentoTela() {
    var el = document.getElementById('wmsRecDtRecebimento');
    return el ? String(el.value || '').trim() : '';
  }

  function preencherDtRecebimentoTela(doc) {
    var el = document.getElementById('wmsRecDtRecebimento');
    if (!el) return;
    var iso = docDtRecebimentoIso(doc) || hojeIsoDateInput();
    el.value = iso;
    el.max = hojeIsoDateInput();
  }

  function formatDataValidade(value) {
    var v = String(value || '').trim();
    if (!v) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return formatDataNf(v);
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function stEmailRelatorioVencLabel(c) {
    var x = String(c || '').trim().toUpperCase();
    if (x === 'S') return 'Enviado';
    if (x === 'E') return 'Erro';
    return 'Não enviado';
  }

  function renderHistoricoEnviosVencTbody(rows, aviso) {
    var tb = document.getElementById('wmsRecEnvioVencBody');
    if (!tb) return;
    if (aviso) {
      tb.innerHTML = '<tr><td colspan="5" style="padding:12px 6px">' + escapeHtml(aviso) + '</td></tr>';
      return;
    }
    if (!rows || !rows.length) {
      tb.innerHTML =
        '<tr><td colspan="5" style="padding:12px 6px;color:#64748b">Nenhum registro ainda.</td></tr>';
      return;
    }
    tb.innerHTML = '';
    rows.forEach(function (row) {
      var dh = row.DH_ENVIO != null ? row.DH_ENVIO : row.dh_envio;
      var nu = row.NU_LINHAS != null ? row.NU_LINHAS : row.nu_linhas;
      var st = row.ST_EMAIL != null ? row.ST_EMAIL : row.st_email;
      var ds = row.DS_DETALHE != null ? row.DS_DETALHE : row.ds_detalhe;
      var nm = row.NM_ANEXO != null ? row.NM_ANEXO : row.nm_anexo;
      var mid = row.EMAIL_MESSAGE_ID != null ? row.EMAIL_MESSAGE_ID : row.email_message_id;
      var det = '';
      if (ds) det += escapeHtml(String(ds));
      if (mid) {
        if (det) det += ' ';
        det += '<span style="word-break:break-all">' + escapeHtml(String(mid)) + '</span>';
      }
      if (!det) det = '—';
      var tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color, #e2e8f0)';
      tr.innerHTML =
        '<td style="padding:8px 6px;white-space:nowrap">' +
        escapeHtml(formatDateTimeLocal(dh)) +
        '</td><td style="padding:8px 6px">' +
        escapeHtml(String(nu != null ? nu : '')) +
        '</td><td style="padding:8px 6px">' +
        escapeHtml(stEmailRelatorioVencLabel(st)) +
        '</td><td style="padding:8px 6px;word-break:break-word">' +
        escapeHtml(nm || '—') +
        '</td><td style="padding:8px 6px;font-size:13px">' +
        det +
        '</td>';
      tb.appendChild(tr);
    });
  }

  function carregarHistoricoEnviosVencimento(opts) {
    opts = opts || {};
    var silencioso = !!opts.silencioso;
    if (!silencioso) {
      showLoadingOverlay('Histórico', 'Carregando envios do relatório...', '');
    }
    var afterPaint = silencioso
      ? Promise.resolve()
      : new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        });
    afterPaint
      .then(function () {
        return fetch('/api/wms/recebimento/relatorio-vencimento-envios?limit=50', {
          headers: getAuthHeaders(),
        });
      })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (data) {
        renderHistoricoEnviosVencTbody(data.envios, data.aviso || null);
      })
      .catch(function (e) {
        renderHistoricoEnviosVencTbody([], (e && e.message) || 'Erro ao carregar.');
      })
      .finally(function () {
        if (!silencioso) hideLoadingOverlay();
      });
  }

  function parseJsonField(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        var j = JSON.parse(v || '[]');
        return Array.isArray(j) ? j : [];
      } catch (_) {
        return [];
      }
    }
    // node-pg / proxies às vezes devolvem objeto array-like
    if (v && typeof v === 'object' && typeof v.length === 'number') {
      try {
        return Array.prototype.slice.call(v);
      } catch (_) {}
    }
    return [];
  }

  /** Garante YYYY-MM-DD para <input type="date">. */
  function normalizarValidadeInput(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return (
        v.getFullYear() +
        '-' +
        String(v.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(v.getDate()).padStart(2, '0')
      );
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) {
      var y = parseInt(br[3], 10);
      if (y < 100) y += 2000;
      return y + '-' + String(br[2]).padStart(2, '0') + '-' + String(br[1]).padStart(2, '0');
    }
    return '';
  }

  function onlyDigits(v) {
    return String(v || '').replace(/\D/g, '');
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

  function digitSlotsInMask(mask) {
    return (String(mask || '').match(/[0AX]/gi) || []).length;
  }

  /** Dígitos do código: se já tem pontos, concatena segmentos (020 vira 3 dígitos, não 20). */
  function extrairDigitosCodigo(value) {
    var cod = String(value || '').trim();
    if (!cod) return '';
    if (cod.indexOf('.') >= 0) {
      return cod
        .split('.')
        .map(function (s) {
          return onlyDigits(s);
        })
        .join('');
    }
    return onlyDigits(cod);
  }

  /** Chave alfanumérica completa (preserva sufixo BN ≠ JK na mesma família 60301001). */
  function codigoProdutoMatchKey(v) {
    return String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[^0-9a-z]/g, '');
  }

  function mascaraTemSufixoAlfanumerico(mask) {
    return /[AX]/i.test(String(mask || ''));
  }

  function codigoTemSufixoLetras(cod) {
    var a = onlyAlphaNum(cod);
    return /[A-Z]/.test(a) && /[0-9]/.test(a);
  }

  function reidratarCodigoPorMascara(value, mask) {
    var m = String(mask || '').trim().toUpperCase();
    if (!m) return String(value || '').trim();
    var cod = String(value || '').trim();
    if (!cod) return '';
    var alnum = onlyAlphaNum(cod);
    if (alnum) {
      var masked = applyProductMask(alnum, m);
      if (masked) return masked;
    }
    return cod;
  }

  /** CPF/CNPJ: completa zeros à esquerda (XML/DB costumam perder o 1º dígito 0 do CNPJ). */
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

  function formatQtdEtiqueta(v) {
    var n = Number(String(v == null ? '' : v).replace(',', '.'));
    if (!Number.isFinite(n)) return '';
    var abs = Math.abs(n);
    if (abs % 1 === 0) return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: abs < 1 ? 6 : 3 });
  }

  function parseNumLinhaNfe(v) {
    if (v == null || String(v).trim() === '') return NaN;
    return Number(String(v).trim().replace(',', '.'));
  }

  /** vUnCom do XML; se ausente, vProd ÷ qCom (mesma regra de outros relatórios WMS). */
  function valorUnitarioLinhaNfe(linha) {
    if (!linha || typeof linha !== 'object') return NaN;
    var vu = parseNumLinhaNfe(linha.vUnCom != null ? linha.vUnCom : linha.vunCom);
    if (Number.isFinite(vu) && vu > 0) return vu;
    var vProd = parseNumLinhaNfe(linha.vProd);
    var qCom = parseNumLinhaNfe(linha.qCom != null ? linha.qCom : linha.qTrib);
    if (Number.isFinite(vProd) && Number.isFinite(qCom) && qCom > 0 && vProd > 0) return vProd / qCom;
    return NaN;
  }

  function formatValorUnitarioLinhaNfe(linha) {
    var vu = valorUnitarioLinhaNfe(linha);
    if (!Number.isFinite(vu) || vu <= 0) return '';
    return vu.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  function abrirModalPadrao(opts) {
    opts = opts || {};
    /** Resíduos no body de módulos anteriores deixam ids duplicados — getElementById pega o errado e o input some. */
    document.querySelectorAll('body > #confirmModal').forEach(function (el) {
      var dentro =
        document.getElementById('contentArea') && document.getElementById('contentArea').contains(el);
      if (!dentro) el.remove();
    });
    var contentArea = document.getElementById('contentArea');
    var modal =
      (contentArea && contentArea.querySelector('#confirmModal.modal--confirm')) ||
      (contentArea && contentArea.querySelector('#confirmModal')) ||
      document.getElementById('confirmModal');
    var titleEl = modal ? modal.querySelector('#confirmModalTitle') : null;
    var textEl = modal ? modal.querySelector('#modalMessage') : null;
    var inputEl = modal ? modal.querySelector('#confirmModalInput') : null;
    var okEl = modal ? modal.querySelector('#confirmYes') : null;
    var cancelEl = modal ? modal.querySelector('#confirmNo') : null;
    if (!modal || !okEl || !cancelEl || !titleEl || !textEl || !inputEl) {
      /** Modal local não encontrado: usa o modal global estilizado (utils.js) em vez do prompt/confirm nativo. */
      if (opts.tipo === 'prompt') {
        if (typeof window.promptPadrao === 'function') {
          return window.promptPadrao(opts.texto || '', {
            title: opts.titulo || 'Informe os dados',
            initial: opts.valorInicial || '',
            confirmText: opts.okLabel || 'Confirmar',
            cancelText: 'Cancelar',
          });
        }
        return Promise.resolve(window.prompt(opts.texto || '', opts.valorInicial || ''));
      }
      if (typeof window.confirmPadrao === 'function') {
        return window.confirmPadrao(opts.texto || '', {
          title: opts.titulo || 'Confirmar Ação',
          danger: !!opts.okDanger,
          confirmText: opts.okLabel || 'Confirmar',
          cancelText: 'Cancelar',
        });
      }
      return Promise.resolve(window.confirm(opts.texto || ''));
    }
    titleEl.textContent = opts.titulo || 'Confirmação';
    textEl.textContent = opts.texto || '';
    inputEl.value = opts.valorInicial || '';
    if (opts.tipo === 'prompt') {
      inputEl.classList.add('is-visible');
      titleEl.style.display = '';
    } else {
      inputEl.classList.remove('is-visible');
      titleEl.style.display = titleEl.textContent ? '' : 'none';
    }
    okEl.className = 'btn-filtro ' + (opts.okDanger ? 'btn-filtro-danger' : 'btn-filtro-aplicar');
    okEl.innerHTML = "<i class='bx bx-check'></i> " + (opts.okLabel || 'Confirmar');
    cancelEl.className = 'btn-filtro btn-filtro-limpar';
    cancelEl.innerHTML = "<i class='bx bx-x'></i> Cancelar";
    if (modal.parentNode !== document.body) document.body.appendChild(modal);
    modal.style.display = modal.classList.contains('modal--confirm') ? 'flex' : 'block';
    modal.style.zIndex = '99999';
    return new Promise(function (resolve) {
      var fechado = false;
      function encerrar(valor) {
        if (fechado) return;
        fechado = true;
        modal.style.display = 'none';
        okEl.removeEventListener('click', onOk);
        cancelEl.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onEnter);
        resolve(valor);
      }
      function onOk() {
        if (opts.tipo === 'prompt') return encerrar(String(inputEl.value || ''));
        encerrar(true);
      }
      function onCancel() {
        if (opts.tipo === 'prompt') return encerrar(null);
        encerrar(false);
      }
      function onEnter(e) {
        if (e.key === 'Enter') onOk();
      }
      okEl.addEventListener('click', onOk);
      cancelEl.addEventListener('click', onCancel);
      inputEl.addEventListener('keydown', onEnter);
      setTimeout(function () {
        (opts.tipo === 'prompt' ? inputEl : okEl).focus();
      }, 10);
    });
  }

  function confirmarPadrao(texto, titulo) {
    return abrirModalPadrao({
      tipo: 'confirm',
      texto: texto,
      titulo: titulo || 'Confirmar Ação',
      okLabel: 'Confirmar',
      okDanger: true,
    });
  }

  function solicitarTextoPadrao(texto, titulo, valorInicial) {
    return abrirModalPadrao({
      tipo: 'prompt',
      texto: texto,
      titulo: titulo || 'Informe os dados',
      valorInicial: valorInicial || '',
      okLabel: 'Confirmar',
      okDanger: false,
    });
  }

  function rotuloDonoDoc(doc) {
    if (!doc) return '—';
    var cd = doc.CD_DONO != null && String(doc.CD_DONO).trim() !== '' ? String(doc.CD_DONO) : '';
    if (!cd) return '— (sem dono)';
    var found = null;
    if (donosEstoqueCache.length) {
      found = donosEstoqueCache.find(function (d) {
        return String(d.CD_DONO) === cd;
      });
    }
    if (found) return cd + ' — ' + (found.CODIGO || '') + ' ' + (found.NOME || '');
    return cd;
  }

  var donosEstoqueCache = [];

  function sugerirDonoPorCnpjDestinatario(doc) {
    if (!doc || !doc.CNPJ_DEST || !donosEstoqueCache.length) return null;
    var dest = String(doc.CNPJ_DEST).replace(/\D/g, '');
    if (dest.length < 11) return null;
    var dest14 = dest.length > 14 ? dest.slice(-14) : dest.padStart(14, '0');
    var matches = donosEstoqueCache.filter(function (d) {
      var cgc = String(d.CGC || '').replace(/\D/g, '');
      if (!cgc) return false;
      var cgc14 = cgc.length > 14 ? cgc.slice(-14) : cgc.padStart(14, '0');
      return cgc14 === dest14;
    });
    if (matches.length === 1) return parseInt(matches[0].CD_DONO, 10);
    return null;
  }

  function atualizarPainelTrocarDono(doc) {
    var box = document.getElementById('wmsRecTrocarDonoBox');
    var sel = document.getElementById('recTrocarDonoSelect');
    var btn = document.getElementById('btnTrocarDonoReceb');
    if (!box || !doc) return;
    var encerrado = isDocEncerrado(doc);
    var temDono = doc.CD_DONO != null && String(doc.CD_DONO).trim() !== '';
    box.style.display = encerrado || !temDono ? 'none' : 'block';
    if (sel && !encerrado) {
      var atual = parseInt(doc.CD_DONO, 10);
      var sugerido = sugerirDonoPorCnpjDestinatario(doc);
      if (Number.isFinite(sugerido) && sugerido !== atual) {
        sel.value = String(sugerido);
      } else if (sel.value && parseInt(sel.value, 10) === atual) {
        sel.value = '';
      }
    }
    if (btn) btn.disabled = !!encerrado;
  }

  function executarTrocarDonoReceb(force) {
    if (!detalheDocAtual || !detalheDocAtual.CD_NFE) return Promise.resolve();
    var sel = document.getElementById('recTrocarDonoSelect');
    var novo = sel ? parseInt(sel.value, 10) : NaN;
    if (!Number.isFinite(novo)) {
      showMessage('Selecione o dono do estoque correto.', 'error');
      return Promise.resolve();
    }
    var atual = parseInt(detalheDocAtual.CD_DONO, 10);
    if (Number.isFinite(atual) && atual === novo) {
      showMessage('Selecione um dono diferente do atual.', 'error');
      return Promise.resolve();
    }
    var rotuloNovo = '';
    var found = donosEstoqueCache.find(function (d) {
      return parseInt(d.CD_DONO, 10) === novo;
    });
    if (found) rotuloNovo = (found.CODIGO || '') + ' — ' + (found.NOME || '');
    var msg =
      'Trocar o dono desta NF-e de\n' +
      rotuloDonoDoc(detalheDocAtual) +
      '\npara\n' +
      novo +
      (rotuloNovo ? ' — ' + rotuloNovo : '') +
      '?\n\nA conferência (quantidades, lotes, validades) será mantida. Os produtos serão reapontados para o cadastro do novo dono.';
    return confirmarPadrao(msg, {
      titulo: 'Corrigir dono do estoque',
      okLabel: 'Corrigir dono',
    }).then(function (ok) {
      if (!ok) return;
      showLoadingOverlay('Corrigindo', 'Alterando dono e reapontando produtos…', '');
      return fetch(
        '/api/wms/recebimento/documentos/' + encodeURIComponent(String(detalheDocAtual.CD_NFE)) + '/dono',
        {
          method: 'PUT',
          headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ CD_DONO: novo, force: !!force }),
        }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) {
              var err = new Error((j && j.error) || r.statusText);
              err.body = j;
              err.httpStatus = r.status;
              throw err;
            }
            return j;
          });
        })
        .then(function (resp) {
          var msgOk = (resp && resp.mensagem) || 'Dono alterado com sucesso.';
          if (resp && resp.naoResolvidos && resp.naoResolvidos.length) {
            msgOk +=
              ' Revise ' +
              resp.naoResolvidos.length +
              ' item(ns) com produto não encontrado no novo dono.';
          }
          if (resp && resp.avisoDest) msgOk += ' ' + resp.avisoDest;
          showMessage(msgOk, resp && resp.naoResolvidos && resp.naoResolvidos.length ? 'info' : 'success');
          return abrirDetalhe(detalheDocAtual.CD_NFE);
        })
        .catch(function (e) {
          if (e && e.httpStatus === 409 && e.body && e.body.requerConfirmacao && !force) {
            hideLoadingOverlay();
            var lista = (e.body.naoResolvidos || [])
              .slice(0, 8)
              .map(function (x) {
                return 'item ' + x.nItem + ' (' + (x.codigoProduto || x.codigoExterno || '?') + ')';
              })
              .join(', ');
            var extra = (e.body.naoResolvidos || []).length > 8 ? '…' : '';
            return confirmarPadrao(
              (e.message || e.body.error || 'Alguns itens não batem no novo dono.') +
                '\n\n' +
                lista +
                extra +
                '\n\nDeseja trocar o dono mesmo assim e ajustar os produtos manualmente na tela?',
              { titulo: 'Itens sem cadastro no novo dono', okLabel: 'Trocar mesmo assim', okDanger: true }
            ).then(function (ok2) {
              if (!ok2) return;
              return executarTrocarDonoReceb(true);
            });
          }
          showMessage((e && e.message) || 'Erro ao trocar dono.', 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });
  }

  function isDocEncerrado(doc) {
    return String(doc && doc.ST_RECEBIMENTO ? doc.ST_RECEBIMENTO : '').toUpperCase() === 'ENCERRADA';
  }

  /** Farol da situação: verde (só importada), amarelo (conferência gravada e aberta), vermelho (encerrada). */
  function getFarolRecebimento(row) {
    if (isDocEncerrado(row)) {
      return { cor: 'vermelho', label: 'Recebimento encerrado' };
    }
    var fg = String(row && row.FG_CONFERIDO != null ? row.FG_CONFERIDO : 'N')
      .toUpperCase()
      .trim();
    if (fg === 'S') {
      return { cor: 'amarelo', label: 'Conferência gravada — recebimento aberto' };
    }
    return { cor: 'verde', label: 'Só importada (sem conferência gravada)' };
  }

  /** Coluna única Status: farol + conferência gravada (✓/✗); tooltip na célula. */
  function formatStatusColunaHtml(row) {
    var f = getFarolRecebimento(row);
    var confSim =
      String(row && row.FG_CONFERIDO != null ? row.FG_CONFERIDO : 'N')
        .toUpperCase()
        .trim() === 'S';
    var tips =
      'Farol — ' +
      f.label +
      ' | Conferência gravada: ' +
      (confSim ? 'sim' : 'não') +
      '.';
    var tipEsc = escapeHtml(tips);
    var cls = 'wms-farol-dot wms-farol-' + f.cor;
    var confCls = confSim ? 'wms-conf-mini wms-conf-mini-sim' : 'wms-conf-mini wms-conf-mini-nao';
    var confTxt = confSim ? '\u2713' : '\u2717';
    return (
      '<span class="wms-rec-status-cell" title="' +
      tipEsc +
      '" aria-label="' +
      tipEsc +
      '">' +
      '<span class="' +
      cls +
      '" aria-hidden="true"></span>' +
      '<span class="' +
      confCls +
      '" aria-hidden="true">' +
      confTxt +
      '</span>' +
      '</span>'
    );
  }

  function atualizarEstadoRecebimentoUI(doc) {
    var encerrado = isDocEncerrado(doc);
    var btnSalvar = document.getElementById('btnSalvarConferencia');
    var btnEncerrar = document.getElementById('btnEncerrarRecebimento');
    var btnReabrir = document.getElementById('btnReabrirRecebimento');
    var nomeConf = document.getElementById('wmsRecConferenteNome');
    var dtRec = document.getElementById('wmsRecDtRecebimento');
    if (btnSalvar) btnSalvar.disabled = encerrado;
    if (btnEncerrar) btnEncerrar.style.display = encerrado ? 'none' : '';
    if (btnReabrir) btnReabrir.style.display = encerrado ? '' : 'none';
    if (nomeConf) nomeConf.disabled = encerrado;
    if (dtRec) dtRec.disabled = encerrado;
    atualizarPainelTrocarDono(doc);
    var banner = document.getElementById('wmsRecNfEncerradaBanner');
    if (banner) {
      if (encerrado) {
        banner.style.display = 'block';
        banner.innerHTML =
          '<div class="hint" style="color:#b91c1c;"><strong>NF encerrada:</strong> edição bloqueada até reabertura.</div>';
      } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }
    }
  }

  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') return;
    var host = document.getElementById('wmsRecGrid');
    if (!host) return;
    host.innerHTML = '';
    gridTab = new window.GridEditor({
      container: '#wmsRecGrid',
      columns: [
        { field: 'CD_NFE', header: 'ID', editable: false, isId: true, width: '72px' },
        { field: 'CHAVE_NFE', header: 'Chave', editable: false },
        { field: 'NUMERO_NF', header: 'NF', editable: false, width: '90px' },
        { field: 'SERIE', header: 'Série', editable: false, width: '70px' },
        { field: 'XNOME_EMIT', header: 'Emitente', editable: false },
        { field: 'Q_ITENS', header: 'Itens', editable: false, width: '72px', align: 'right' },
        {
          field: 'ST_RECEBIMENTO',
          header: 'Status',
          editable: false,
          width: '72px',
          format: function (_v, row) {
            return formatStatusColunaHtml(row);
          },
        },
        {
          field: 'DT_RECEBIMENTO',
          header: 'Recebimento',
          editable: false,
          width: '110px',
          format: function (v) {
            return formatDataNf(v) || '—';
          },
        },
        { field: 'DH_IMPORTACAO', header: 'Importação', editable: false, width: '170px', format: formatDateTimeLocal },
      ],
      apiEndpoint: '/api/wms/recebimento',
      buildFetchHeaders: function () {
        return getAuthHeaders();
      },
      autoSave: false,
      canDeleteRow: function (row) {
        return !isDocEncerrado(row);
      },
      onDeleteBlocked: function () {
        showMessage(
          'Não é possível excluir: o recebimento desta NF está encerrado. Use Reabrir recebimento (com motivo) se for indispensável remover a importação.',
          'error'
        );
      },
      onBeforeEdit: function (id) {
        return abrirDetalhe(id);
      },
      onDelete: function (idStr) {
        var row =
          gridTab && gridTab.data
            ? gridTab.data.find(function (r) {
                return String(r.CD_NFE != null ? r.CD_NFE : r.cd_nfe) === String(idStr);
              })
            : null;
        if (row && isDocEncerrado(row)) {
          showMessage(
            'Não é possível excluir: o recebimento desta NF está encerrado. Reabra antes se precisar remover o registro.',
            'error'
          );
          return Promise.resolve();
        }
        return confirmarPadrao(
          'Excluir definitivamente esta importação de NF-e? A conferência, vínculos em lote (se houver) e o registro serão removidos. Esta ação não pode ser desfeita.',
          'Excluir importação'
        ).then(function (ok) {
          if (!ok) return;
          showLoadingOverlay('Excluindo', 'Removendo importação da NF-e...', 'Aguarde.');
          return fetch('/api/wms/recebimento/documentos/' + encodeURIComponent(idStr), {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
            .then(function (r) {
              return r.json().then(function (j) {
                if (!r.ok) throw new Error((j && j.error) || r.statusText);
                return j;
              });
            })
            .then(function () {
              showMessage('Importação excluída com sucesso.', 'success');
              if (detalheDocAtual && String(detalheDocAtual.CD_NFE) === String(idStr)) {
                detalheDocAtual = null;
                mostrarPainelImportar();
              }
              return applyFilters('grid');
            })
            .catch(function (e) {
              showMessage((e && e.message) || 'Erro ao excluir importação.', 'error');
            })
            .finally(function () {
              hideLoadingOverlay();
            });
        });
      },
    });
  }

  function abrirDetalhe(id) {
    return fetch('/api/wms/recebimento/documentos/' + encodeURIComponent(id), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (doc) {
        ocultarPainelLiberacaoValidade();
        detalheDocAtual = doc;
        renderizarHistoricoLiberacoesValidade(doc.liberacoesValidadeMin);
        document.getElementById('painelImportar').style.display = 'none';
        document.getElementById('painelDetalhe').style.display = 'block';
        document.getElementById('tituloDados').style.display = 'none';
        var tituloDetalhe = document.getElementById('wmsRecDetalheTitulo');
        var meta = document.getElementById('wmsRecDetalheMeta');
        var chave = escapeHtml(doc.CHAVE_NFE || '');
        if (tituloDetalhe) {
          tituloDetalhe.innerHTML = '<i class="bx bx-detail"></i> Detalhe da NF-e (' + chave + ')';
        }
        var emit = escapeHtml(doc.XNOME_EMIT || '');
        var cnpjEmit = formatCnpj(doc.CNPJ_EMITENTE || '');
        var cnpjDest = formatCnpj(doc.CNPJ_DEST || '');
        var dest = escapeHtml(doc.XNOME_DEST || '');
        var numero = escapeHtml(doc.NUMERO_NF || '');
        var serie = escapeHtml(doc.SERIE || '');
        var dhEmi = formatDataNf(doc.DH_EMISSAO);
        var dtRecFmt = formatDataNf(docDtRecebimentoIso(doc) || doc.DT_RECEBIMENTO);
        var stRec = escapeHtml(doc.ST_RECEBIMENTO || 'ABERTA');
        meta.innerHTML =
          '<div class="detalhe-meta-item"><span class="detalhe-meta-label">Dono do estoque</span><span class="detalhe-meta-value">' +
          escapeHtml(rotuloDonoDoc(doc)) +
          '</span></div>' +
          '<div class="detalhe-meta-item"><span class="detalhe-meta-label">Emitente</span><span class="detalhe-meta-value">' +
          emit +
          '</span>' +
          (cnpjEmit ? '<span class="detalhe-meta-aux">' + cnpjEmit + '</span>' : '') +
          '</div>' +
          '<div class="detalhe-meta-item"><span class="detalhe-meta-label">Destinatário</span><span class="detalhe-meta-value">' +
          dest +
          '</span>' +
          (cnpjDest ? '<span class="detalhe-meta-aux">' + cnpjDest + '</span>' : '') +
          '</div>' +
          '<div class="detalhe-meta-item"><span class="detalhe-meta-label">Nº / Série</span><span class="detalhe-meta-value">' +
          numero +
          ' / ' +
          serie +
          (dhEmi ? '<span class="detalhe-meta-aux">Emissão ' + dhEmi + '</span>' : '') +
          (dtRecFmt ? '<span class="detalhe-meta-aux">Recebimento ' + dtRecFmt + '</span>' : '') +
          '<span class="detalhe-meta-aux">Status: ' + stRec + '</span>' +
          '</span></div>' +
          '';
        var ce = document.getElementById('wmsRecConferenteNome');
        if (ce) ce.value = doc.NM_CONFERENTE != null ? String(doc.NM_CONFERENTE).trim() : '';
        preencherDtRecebimentoTela(doc);
        var linhas = parseJsonField(doc.LINHAS_JSON);
        var conferencia = parseJsonField(doc.CONFERENCIA_JSON);
        var confByItem = {};
        conferencia.forEach(function (c) {
          confByItem[String(c.nItem || '')] = c;
        });
        var cdDonoDoc = doc.CD_DONO != null && String(doc.CD_DONO).trim() !== '' ? parseInt(doc.CD_DONO, 10) : null;
        return Promise.all([carregarProdutosDono(cdDonoDoc), carregarDePara(cdDonoDoc)])
          .then(function (resp) {
            var produtos = resp[0] || [];
            var depara = resp[1] || [];
            var deparaMapPre = new Map();
            (depara || []).forEach(function (d) {
              var ext = String(d.CODIGO_EXTERNO || '').trim();
              if (!ext) return;
              putDeparaNoMap(deparaMapPre, ext, {
                codigoInterno: String(d.CODIGO_INTERNO || '').trim(),
                fator: fatorFromDeparaRow(d),
              });
            });
            var nDep = 0;
            linhas.forEach(function (L) {
              if (getDeparaDoMap(deparaMapPre, L.cProd)) nDep++;
            });
            renderTabelaConferencia(linhas, confByItem, produtos, depara, cdDonoDoc);
            atualizarEstadoRecebimentoUI(doc);
            atualizarPainelTrocarDono(doc);
            var nComVal = 0;
            Object.keys(confByItem).forEach(function (k) {
              if (confByItem[k] && confByItem[k].validade) nComVal++;
            });
            if (nComVal > 0) {
              showMessage(nComVal + ' item(ns) com validade já preenchida na conferência.', 'success');
            }
            if (nDep > 0) {
              showMessage(
                nDep + ' item(ns) com de-para automático (código NF → produto dono). Campo em verde.',
                'success'
              );
            } else if ((depara || []).length) {
              showMessage(
                'De-para cadastrado, mas nenhum código desta NF bateu. Confira CODIGO_EXTERNO = ' +
                  String(linhas[0] && linhas[0].cProd ? linhas[0].cProd : 'cProd da NF') +
                  ' e o dono da NF.',
                'info'
              );
            } else {
              showMessage(
                'Sem de-para para este dono. Cadastre em Cadastros WMS → De-para ou marque Salvar de-para ao conferir.',
                'info'
              );
            }
            showTab('dados');
            return false;
          })
          .catch(function () {
            renderTabelaConferencia(linhas, confByItem, [], [], cdDonoDoc);
            atualizarEstadoRecebimentoUI(doc);
            showTab('dados');
            return false;
          });
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao carregar detalhe.', 'error');
        return false;
      });
  }

  function parseProdutosDonoApiResponse(j) {
    if (Array.isArray(j)) return { rows: j, truncated: false };
    if (j && Array.isArray(j.rows)) {
      return { rows: j.rows, truncated: !!j.truncated, aviso: j.aviso || '' };
    }
    return { rows: [], truncated: false };
  }

  function carregarProdutosDono(cdDono) {
    if (!Number.isFinite(cdDono)) return Promise.resolve([]);
    return fetch(
      '/api/wms/produtos-dono?cdDono=' +
        encodeURIComponent(cdDono) +
        '&somenteDono=1&fgactive=S&mostrarFornecedor=1',
      { headers: getAuthHeaders() }
    )
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          var parsed = parseProdutosDonoApiResponse(j);
          produtosDonoTruncated = parsed.truncated;
          return parsed.rows;
        });
      });
  }

  function buscarProdutosDonoServidor(cdDono, q, cProd, xProd) {
    if (!Number.isFinite(cdDono)) return Promise.resolve([]);
    var qs =
      '/api/wms/recebimento/produtos-sugestao?cdDono=' +
      encodeURIComponent(cdDono);
    var qt = String(q || '').trim();
    if (qt) qs += '&q=' + encodeURIComponent(qt);
    if (cProd) qs += '&cProd=' + encodeURIComponent(String(cProd));
    if (xProd) qs += '&xProd=' + encodeURIComponent(String(xProd));
    return fetch(qs, { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return parseProdutosDonoApiResponse(j).rows;
        });
      });
  }

  function mergeProdutosDonoCache(novos) {
    if (!Array.isArray(novos) || !novos.length) return;
    var base = Array.isArray(produtosDonoAtual) ? produtosDonoAtual.slice() : [];
    produtosDonoAtual = deduplicarProdutosDonoLista(base.concat(novos));
  }

  function produtosParaHitsSugestao(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (p) {
      return { p: p, score: 1, cv: codigoProdutoExibicao(p) };
    });
  }

  function mergeHitsSugestao(a, b) {
    return dedupeHitsSugestao((a || []).concat(b || [])).slice(0, 50);
  }

  function htmlBotaoSugestaoProduto(h) {
    var est = String((h.p && h.p.CODIGO_ESTOQUE) || '').trim();
    var codRaw = String((h.p && h.p.CODIGO) || '').trim();
    var estoqueHint =
      est && est !== codRaw
        ? ' <span class="wms-rec-sug-estoque" style="display:block;font-size:11px;color:#64748b;margin-top:2px;">Estoque: ' +
          escapeHtml(est) +
          '</span>'
        : '';
    return (
      '<button type="button" data-cod="' +
      escapeHtml(h.cv) +
      '" data-cod-raw="' +
      escapeHtml(codRaw) +
      '"><strong>' +
      escapeHtml(h.cv) +
      '</strong> — ' +
      escapeHtml((h.p && h.p.NOME) || '') +
      estoqueHint +
      '</button>'
    );
  }

  function parseReferenciasAnexoLote(v) {
    return Array.from(
      new Set(
        String(v || '')
          .split(/[,;\n]+/)
          .map(function (x) {
            return String(x || '').trim();
          })
          .filter(function (x) {
            return x.length > 0;
          })
      )
    );
  }

  function carregarLotesCrossdock() {
    return fetch('/api/wms/recebimento/crossdock/lotes', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return Array.isArray(j) ? j : [];
        });
      })
      .then(function (arr) {
        lotesCrossdock = arr;
        var sel = document.getElementById('crossdock_lote_select');
        if (!sel) return arr;
        var atual = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>';
        arr.forEach(function (l) {
          var o = document.createElement('option');
          o.value = String(l.CD_LOTE);
          o.textContent = String(l.CODIGO || '') + ' — ' + String(l.FASE || '') + ' (' + String(l.Q_NFES || 0) + ' NF)';
          sel.appendChild(o);
        });
        if (atual && Array.prototype.some.call(sel.options, function (x) { return x.value === atual; })) sel.value = atual;
        return arr;
      });
  }

  function carregarDePara(cdDono) {
    if (!Number.isFinite(cdDono)) return Promise.resolve([]);
    return fetch('/api/wms/de-para-produto?cdDono=' + encodeURIComponent(cdDono) + '&fgactive=S', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return Array.isArray(j) ? j : [];
        });
      })
      .catch(function () {
        return [];
      });
  }

  function parsePositiveNumber(v) {
    var n = Number(String(v == null ? '' : v).trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** Fator salvo na conferência (permite 0). Ausente = null. */
  function fatorFromSavedConference(c) {
    if (!c || c.fatorConversao === undefined || c.fatorConversao === null) return null;
    if (typeof c.fatorConversao === 'number' && !Number.isNaN(c.fatorConversao)) {
      return c.fatorConversao >= 0 ? c.fatorConversao : null;
    }
    var s = String(c.fatorConversao).trim();
    if (s === '') return null;
    var n = Number(s.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function fatorFromDeparaRow(d) {
    var n = Number(String(d.FATOR_CONVERSAO != null ? d.FATOR_CONVERSAO : '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** Mesma ideia do índice UK do Postgres: TRIM + comparação sem case; extras para código só dígitos. */
  function normDeparaKey(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  /** Mesmas chaves do backend (deparaLookupKeysFromCProd). */
  function deparaKeysFromCProd(cProd) {
    var raw = String(cProd || '').trim();
    if (!raw) return [];
    var keys = [normDeparaKey(raw)];
    if (/^\d+$/.test(raw)) {
      var collapsed = String(parseInt(raw, 10));
      keys.push(normDeparaKey(collapsed));
    }
    return keys;
  }

  function putDeparaNoMap(map, extRaw, v) {
    var ext = String(extRaw || '').trim();
    if (!ext) return;
    deparaKeysFromCProd(ext).forEach(function (k) {
      map.set(k, v);
    });
  }

  function getDeparaDoMap(map, cProd) {
    var keys = deparaKeysFromCProd(cProd);
    for (var i = 0; i < keys.length; i++) {
      if (map.has(keys[i])) return map.get(keys[i]);
    }
    return null;
  }

  function filtrarPorDono(rows, cdDono) {
    if (!Number.isFinite(cdDono) || !Array.isArray(rows)) return [];
    var n = parseInt(String(cdDono), 10);
    return rows.filter(function (r) {
      var raw = r.CD_DONO != null && r.CD_DONO !== '' ? r.CD_DONO : r.cd_dono;
      var rd = parseInt(String(raw), 10);
      return Number.isFinite(rd) && rd === n;
    });
  }

  /** Códigos internos do dono relevantes para esta conferência: itens da NF + destinos do de-para. */
  function coletarCodigosSugeridosConferencia(linhasArr, deparaMapRef) {
    var set = new Set();
    (linhasArr || []).forEach(function (L) {
      var ext = String(L.cProd || '').trim();
      if (!ext) return;
      set.add(ext);
      set.add(normDeparaKey(ext));
      if (/^\d+$/.test(ext)) set.add(String(parseInt(ext, 10)));
      var dep = getDeparaDoMap(deparaMapRef, L.cProd);
      if (dep && dep.codigoInterno) {
        var ci = String(dep.codigoInterno).trim();
        if (ci) {
          set.add(ci);
          set.add(normDeparaKey(ci));
          if (/^\d+$/.test(ci)) set.add(String(parseInt(ci, 10)));
          var maskSug = getMaskProdutoDonoAtual();
          var digCi = maskSug ? extrairDigitosCodigo(ci) : onlyDigits(ci);
          if (digCi) set.add(digCi);
        }
      }
      var digExt = getMaskProdutoDonoAtual()
        ? extrairDigitosCodigo(ext)
        : onlyDigits(ext);
      if (digExt) set.add(digExt);
    });
    return set;
  }

  function produtoDonoCasaSugestao(p, codigosSugeridos) {
    if (!codigosSugeridos || codigosSugeridos.size === 0) return false;
    var cod = String(p.CODIGO || '').trim();
    if (!cod) return false;
    if (codigosSugeridos.has(cod)) return true;
    if (codigosSugeridos.has(normDeparaKey(cod))) return true;
    if (/^\d+$/.test(cod) && codigosSugeridos.has(String(parseInt(cod, 10)))) return true;
    return false;
  }

  /** Chave canônica para não repetir o mesmo SKU (ex.: 6320700500 e 6.32.07.005.00). */
  function chaveDedupeProdutoDono(codigoRaw, mask) {
    var cod = String(codigoRaw || '').trim();
    if (!cod) return '';
    if (mascaraTemSufixoAlfanumerico(mask) || codigoTemSufixoLetras(cod)) {
      var ka = codigoProdutoMatchKey(cod);
      if (ka) return 'a:' + ka;
    }
    var dig = mask ? extrairDigitosCodigo(cod) : onlyDigits(cod);
    if (dig.length >= 6) return 'd:' + dig;
    return 'c:' + cod.toLowerCase();
  }

  function chaveDedupeProdutoDonoRow(p, mask) {
    if (!p) return '';
    var cd = p.CD_PRODUTO != null ? parseInt(p.CD_PRODUTO, 10) : NaN;
    if (Number.isFinite(cd)) return 'id:' + cd;
    var codigos = [p.CODIGO, p.CODIGO_OPERACIONAL, p.CODIGO_ESTOQUE];
    for (var i = 0; i < codigos.length; i++) {
      var k = chaveDedupeProdutoDono(codigos[i], mask);
      if (k) return k;
    }
    return '';
  }

  function preferirProdutoDonoRow(prev, next) {
    if (!prev) return next;
    var score = function (x) {
      var s = 0;
      var cod = String(x.CODIGO || '').trim();
      var est = String(x.CODIGO_ESTOQUE || '').trim();
      var op = String(x.CODIGO_OPERACIONAL || '').trim();
      if (est && (!op || cod === est)) s += 12;
      if (est) s += 6;
      if (cod && est && cod === est) s += 4;
      if (cod && est && cod !== est) s -= 6;
      if (op && cod === op) s -= 4;
      if (String(x.FG_FORNECEDOR_REF || 'N').toUpperCase() !== 'S') s += 2;
      return s;
    };
    return score(next) > score(prev) ? next : prev;
  }

  /** Um registro por produto (CD_PRODUTO ou mesmo SKU em máscara/dígitos). */
  function deduplicarProdutosDonoLista(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    var mask = '';
    for (var mi = 0; mi < rows.length; mi++) {
      mask = String(rows[mi].MASCARA_CODIGO_PRODUTO || rows[mi].mascara_codigo_produto || '').trim();
      if (mask) break;
    }
    var byKey = new Map();
    rows.forEach(function (p) {
      var key = chaveDedupeProdutoDonoRow(p, mask);
      if (!key) return;
      var prev = byKey.get(key);
      byKey.set(key, preferirProdutoDonoRow(prev, p));
    });
    return Array.from(byKey.values());
  }

  function chaveHitSugestao(h) {
    if (!h || !h.p) return '';
    var cv = String(h.cv || codigoProdutoExibicao(h.p) || '').trim();
    var dig = extrairDigitosCodigo(cv);
    if (dig.length >= 4) return 'd:' + dig;
    var cd = h.p.CD_PRODUTO != null ? parseInt(h.p.CD_PRODUTO, 10) : NaN;
    if (Number.isFinite(cd)) return 'id:' + cd;
    return 'c:' + cv.toLowerCase();
  }

  function dedupeHitsSugestao(hits) {
    var seen = new Set();
    var out = [];
    (hits || []).forEach(function (h) {
      var k = chaveHitSugestao(h);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(h);
    });
    return out;
  }

  function renderTabelaConferencia(arr, confByItem, produtos, deparaRows, cdDonoFiltro) {
    var host = document.getElementById('wmsRecDetalheLinhas');
    if (!host) return;
    if (!Array.isArray(arr) || !arr.length) {
      host.innerHTML = '<p>Nenhum item parseado.</p>';
      return;
    }
    var produtosDono = filtrarPorDono(produtos, cdDonoFiltro);
    var deparaDono = filtrarPorDono(deparaRows, cdDonoFiltro);
    var deparaMap = new Map();
    deparaDono.forEach(function (d) {
      var ext = String(d.CODIGO_EXTERNO || '').trim();
      if (!ext) return;
      putDeparaNoMap(deparaMap, ext, {
        codigoInterno: String(d.CODIGO_INTERNO || '').trim(),
        fator: fatorFromDeparaRow(d),
      });
    });
    // Lista de sugestão: catálogo do dono já filtrado no backend (sem referências de fornecedor por padrão).
    var produtosDatalist = deduplicarProdutosDonoLista(produtosDono);
    produtosDonoAtual = produtosDatalist.slice();
    var maskProdDatalist = getMaskProdutoDonoAtual();
    var options = '<option value=""></option>';
    var seenOpt = new Set();
    produtosDatalist.forEach(function (p) {
      var codigoRaw = String(p.CODIGO || '');
      var codigoView = maskProdDatalist ? reidratarCodigoPorMascara(codigoRaw, maskProdDatalist) : codigoRaw;
      var optVal = String(codigoView || codigoRaw || '').trim();
      if (!optVal) return;
      var cdProd = p.CD_PRODUTO != null ? parseInt(p.CD_PRODUTO, 10) : NaN;
      var optKey = Number.isFinite(cdProd) ? 'id:' + cdProd : 'c:' + optVal.toLowerCase();
      if (seenOpt.has(optKey)) return;
      seenOpt.add(optKey);
      options +=
        '<option value="' +
        escapeHtml(optVal) +
        '" label="' +
        escapeHtml(String(p.NOME || '').trim() || optVal) +
        '"></option>';
    });
    var dlId = 'produtosDonoList-' + String(detalheDocAtual && detalheDocAtual.CD_NFE ? detalheDocAtual.CD_NFE : 'x');
    var usarLista = Number.isFinite(cdDonoFiltro) && produtosDatalist.length > 0;
    var avisoDono =
      !Number.isFinite(cdDonoFiltro)
        ? '<p class="hint" style="margin:0 0 10px;color:#f59e0b;font-size:13px;">Esta NF não tem dono do estoque vinculado. Reimporte o XML escolhendo o dono para sugerir apenas produtos desse dono.</p>'
        : '';
    var minDiasRaw =
      detalheDocAtual &&
      (detalheDocAtual.NU_DIAS_MIN_VALID_RECEB_DONO != null
        ? detalheDocAtual.NU_DIAS_MIN_VALID_RECEB_DONO
        : detalheDocAtual.nu_dias_min_valid_receb_dono);
    var minDias = parseInt(minDiasRaw, 10);
    var avisoPoliticaValid = '';
    if (Number.isFinite(cdDonoFiltro)) {
      avisoPoliticaValid =
        Number.isFinite(minDias) && minDias >= 1
          ? '<p class="hint" style="margin:0 0 10px;color:#64748b;font-size:13px;">Produtos com <strong>controla validade</strong> no cadastro exigem data de validade ao salvar ou encerrar. Política do dono: cada validade informada deve deixar pelo menos <strong>' +
            minDias +
            '</strong> dia(s) até o vencimento (abaixo disso é preciso liberação de supervisor).</p>'
          : '<p class="hint" style="margin:0 0 10px;color:#64748b;font-size:13px;">Produtos com <strong>controla validade</strong> ou <strong>controla lote</strong> no cadastro exigem esses campos ao salvar ou encerrar a conferência.</p>';
    }
    var avisoSugestoes = produtosDonoTruncated
      ? '<p class="hint" style="margin:0 0 10px;color:#64748b;font-size:13px;">Catálogo grande: digite <strong>código ou nome</strong> em Produto dono para buscar no servidor (inclui códigos operacionais e estoque).</p>'
      : '';
    var listAttrProd = '';
    var tb =
      avisoDono +
      avisoPoliticaValid +
      avisoSugestoes +
      '<datalist id="' +
      dlId +
      '">' +
      options +
      '</datalist>' +
      '<table><thead><tr>' +
      '<th class="sortable" data-sort-key="nItem">#</th>' +
      '<th class="sortable" data-sort-key="cProd">Produto NF</th>' +
      '<th class="sortable" data-sort-key="xProd">Descrição</th>' +
      '<th class="sortable" data-sort-key="qCom">Qtd NF</th>' +
      '<th class="sortable" data-sort-key="uCom">UM</th>' +
      '<th>Produto dono</th><th title="Fator de conversão">Fator</th><th title="Quantidade recebida">Qtd rec.</th><th>Lote</th><th>Validade</th></tr></thead><tbody>';
    arr.forEach(function (L) {
      var nItem = String(L.nItem || '');
      var c = confByItem[nItem] || {};
      var dep = getDeparaDoMap(deparaMap, L.cProd);
      var codigo = String(c.codigoProduto || '').trim() || (dep ? dep.codigoInterno : '');
      var codigoViewIni = codigo;
      if (codigo && maskProdDatalist) codigoViewIni = reidratarCodigoPorMascara(codigo, maskProdDatalist);
      var deparaOk = !!(dep && dep.codigoInterno);
      var fSaved = fatorFromSavedConference(c);
      var fator = fSaved !== null ? fSaved : dep ? dep.fator : 0;
      var qtdRec = c.qtdRecebida != null ? String(c.qtdRecebida) : '';
      var vUnitTxt = formatValorUnitarioLinhaNfe(L);
      var saveDep = c.salvarDepara ? ' checked' : dep ? '' : ' checked';
      tb +=
        '<tr data-nitem="' +
        escapeHtml(nItem) +
        '" data-cprod="' +
        escapeHtml(L.cProd || '') +
        '" data-ncm="' +
        escapeHtml(L.NCM || '') +
        '" data-xprod="' +
        escapeHtml(L.xProd || '') +
        '" data-qcom="' +
        escapeHtml(L.qCom || '') +
        '" data-ucom="' +
        escapeHtml(L.uCom || '') +
        '">' +
        '<td>' +
        escapeHtml(nItem) +
        '</td>' +
        '<td>' +
        escapeHtml(L.cProd || '') +
        '</td>' +
        '<td class="col-desc-nfe" title="' +
        escapeHtml(L.xProd || '') +
        (vUnitTxt ? ' · V. unit. ' + vUnitTxt : '') +
        '"><span class="wms-rec-desc-main">' +
        escapeHtml(L.xProd || '') +
        '</span>' +
        (vUnitTxt
          ? '<span class="wms-rec-vunit-hint" title="Valor unitário comercial (vUnCom) do XML">V. unit. ' +
            escapeHtml(vUnitTxt) +
            '</span>'
          : '') +
        '</td>' +
        '<td style="text-align:right;">' +
        escapeHtml(L.qCom || '') +
        '</td>' +
        '<td>' +
        escapeHtml(L.uCom || '') +
        '</td>' +
        '<td class="col-produto-dono"><div class="wms-rec-prod-dono-row">' +
        '<input type="text" class="conf-input conf-produto' +
        (deparaOk ? ' wms-rec-depara-ok' : '') +
        '" data-field="codigoProduto" autocomplete="off" name="wmsRecCodDono_' +
        escapeHtml(nItem) +
        '"' +
        listAttrProd +
        ' value="' +
        escapeHtml(codigoViewIni) +
        '" placeholder="Código do dono" title="' +
        escapeHtml(
          deparaOk
            ? 'De-para: NF ' + String(L.cProd || '') + ' → ' + codigoViewIni
            : 'Busque por código ou nome; o de-para preenche automaticamente se existir.'
        ) +
        '" />' +
        '<label class="depara-inline" title="Marcado = ao salvar conferência, grava/atualiza o de-para (código NF → dono + fator). Se já existe cadastro, vem desmarcado.">' +
        '<input type="checkbox" data-field="salvarDepara"' +
        saveDep +
        ' /><span>De-para</span></label></div>' +
        '<div class="wms-rec-cad-wrap" style="display:none" hidden>' +
        '<button type="button" class="btn-rec-cad-prod" title="Produto não existe neste dono — cadastre aqui sem sair do recebimento">' +
        '<i class="bx bx-plus-circle"></i> Cadastrar produto</button></div></td>' +
        '<td class="col-fator"><input type="number" step="0.000001" min="0" class="conf-input" data-field="fatorConversao" value="' +
        escapeHtml(String(fator)) +
        '" /></td>' +
        '<td class="col-qtd-recebida"><input type="number" step="0.001" min="0" class="conf-input" data-field="qtdRecebida" value="' +
        escapeHtml(qtdRec) +
        '" /></td>' +
        '<td><input type="text" class="conf-input" data-field="lote" maxlength="60" value="' +
        escapeHtml(c.lote || '') +
        '" /></td>' +
        '<td><input type="date" class="conf-input" data-field="validade" value="' +
        escapeHtml(normalizarValidadeInput(c.validade)) +
        '" /></td>' +
        '</tr>';
    });
    tb += '</tbody></table>';
    host.innerHTML = tb;
    attachConferenciaSort(host);
    attachConferenciaAssist(host);
    // Reaplica conferência salva (qtd/lote/validade) — evita input date vazio após re-render
    host.querySelectorAll('tbody tr[data-nitem]').forEach(function (tr) {
      var n = String(tr.getAttribute('data-nitem') || '');
      var c = confByItem[n] || {};
      var qEl = tr.querySelector('[data-field="qtdRecebida"]');
      var lEl = tr.querySelector('[data-field="lote"]');
      var vEl = tr.querySelector('[data-field="validade"]');
      if (qEl && c.qtdRecebida != null && String(c.qtdRecebida).trim() !== '' && !String(qEl.value || '').trim()) {
        qEl.value = String(c.qtdRecebida);
      }
      if (lEl && c.lote && !String(lEl.value || '').trim()) lEl.value = String(c.lote);
      if (vEl) {
        var vd = normalizarValidadeInput(c.validade);
        if (vd) vEl.value = vd;
      }
    });
    host.querySelectorAll('tbody tr[data-nitem]').forEach(function (tr) {
      aplicarRequisitosLinhaConferencia(tr);
      atualizarEstadoCadastroLinhaConferencia(tr);
    });
    // Não re-resolver no load: a conferência salva prevalece (evita de-para/irmão trocar .80 por .60).
  }

  function codigoEstoqueCanonico(p) {
    if (!p) return '';
    var est = String(p.CODIGO_ESTOQUE || '').trim();
    var cod = String(p.CODIGO || '').trim();
    var op = String(p.CODIGO_OPERACIONAL || '').trim();
    if (est) return est;
    if (cod && (!op || cod !== op)) return cod;
    return '';
  }

  function codigoProdutoExibicao(p) {
    var raw = codigoEstoqueCanonico(p);
    if (!raw) return '';
    var mask = getMaskProdutoDonoAtual();
    if (!mask) return raw;
    if (raw.indexOf('.') >= 0) return raw;
    return reidratarCodigoPorMascara(raw, mask);
  }

  function resolverCodigoEstoqueServidor(cdDono, codigo, cProd) {
    var q =
      '/api/wms/recebimento/resolver-codigo?cdDono=' +
      encodeURIComponent(cdDono) +
      '&codigo=' +
      encodeURIComponent(String(codigo || '').trim()) +
      '&cProd=' +
      encodeURIComponent(String(cProd || '').trim());
    return fetch(q, { headers: getAuthHeaders() }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
        return body;
      });
    });
  }

  /** De-para do cProd não pode apagar um código interno diferente que o operador digitou (ex. .80 vs .60). */
  function codigoDigitadoEhOutroSku(digitado, codigoResolvido) {
    var a = codigoProdutoMatchKey(digitado) || extrairDigitosCodigo(digitado);
    var b = codigoProdutoMatchKey(codigoResolvido) || extrairDigitosCodigo(codigoResolvido);
    if (!a || !b) return false;
    return String(a) !== String(b);
  }

  /** Não sobrescrever o que o operador/conferência digitou por outro SKU (ex. .80 → .60). */
  function resolucaoDevePreservarDigitado(digitado, data) {
    if (!digitado || !data || !data.codigoEstoque) return false;
    return codigoDigitadoEhOutroSku(digitado, data.codigoEstoque);
  }

  function aplicarResolucaoCodigoNaLinha(tr, data, codigoDigitadoOpt) {
    if (!tr || !data || !data.codigoEstoque) {
      atualizarEstadoCadastroLinhaConferencia(tr);
      return;
    }
    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
    if (!prodEl) return;
    var digitado =
      codigoDigitadoOpt != null ? String(codigoDigitadoOpt).trim() : String(prodEl.value || '').trim();
    if (resolucaoDevePreservarDigitado(digitado, data)) {
      setCadastroLinhaVisivel(tr, true);
      prodEl.title =
        'Código digitado não existe no cadastro. De-para da NF aponta para ' +
        data.codigoEstoque +
        ' — use Cadastrar produto para criar o SKU digitado.';
      aplicarRequisitosLinhaConferencia(tr);
      return;
    }
    var mask = getMaskProdutoDonoAtual();
    var estView = mask ? reidratarCodigoPorMascara(data.codigoEstoque, mask) : data.codigoEstoque;
    prodEl.value = estView;
    prodEl.title =
      'Estoque: ' +
      estView +
      (data.codigoOperacional && data.codigoOperacional !== data.codigoEstoque
        ? ' · Operacional OL: ' + data.codigoOperacional
        : '') +
      (data.origem ? ' (' + data.origem + ')' : '');
    var fatorEl = tr.querySelector('[data-field="fatorConversao"]');
    if (
      fatorEl &&
      data.fatorConversao != null &&
      Number(data.fatorConversao) > 0 &&
      (!String(fatorEl.value || '').trim() || Number(fatorEl.value) === 0)
    ) {
      fatorEl.value = String(data.fatorConversao);
    }
    aplicarRequisitosLinhaConferencia(tr);
    atualizarEstadoCadastroLinhaConferencia(tr);
  }

  function inferirTipoArmazenagemPorNcm(ncmRaw) {
    var d = String(ncmRaw || '').replace(/\D/g, '').slice(0, 8);
    if (d.length < 4) return '';
    var p4 = d.slice(0, 4);
    var cong = ['0203', '0204', '0303', '0304', '2004', '2005'];
    var refri = ['0201', '0202', '0206', '0210', '0302', '0305', '0207', '0208'];
    var i;
    for (i = 0; i < cong.length; i++) {
      if (p4.indexOf(cong[i]) === 0) return 'CONGELADO';
    }
    for (i = 0; i < refri.length; i++) {
      if (p4.indexOf(refri[i]) === 0) return 'REFRIGERADO';
    }
    return '';
  }

  var cadRecLinhaTr = null;

  function setCadastroLinhaVisivel(tr, visivel) {
    if (!tr) return;
    var wrap = tr.querySelector('.wms-rec-cad-wrap');
    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
    if (wrap) {
      if (visivel) {
        wrap.classList.add('is-visible');
        wrap.style.display = 'block';
        wrap.removeAttribute('hidden');
      } else {
        wrap.classList.remove('is-visible');
        wrap.style.display = 'none';
        wrap.setAttribute('hidden', '');
      }
    }
    if (prodEl) {
      if (visivel) prodEl.classList.add('wms-rec-sem-cadastro');
      else prodEl.classList.remove('wms-rec-sem-cadastro');
    }
  }

  function atualizarEstadoCadastroLinhaConferencia(tr) {
    if (!tr) return;
    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
    var wrap = tr.querySelector('.wms-rec-cad-wrap');
    if (!prodEl || !wrap) return;
    var cod = String(prodEl.value || '').trim();
    if (!cod) {
      setCadastroLinhaVisivel(tr, false);
      return;
    }
    if (encontrarProdutoDonoPorCodigo(cod)) {
      setCadastroLinhaVisivel(tr, false);
      return;
    }
    var cdDono = getCdDonoAtual();
    if (!Number.isFinite(cdDono)) {
      setCadastroLinhaVisivel(tr, true);
      return;
    }
    // Só consulta se existe — não aplica resolução que possa trocar o código da linha.
    resolverCodigoEstoqueServidor(cdDono, cod, '')
      .then(function (data) {
        if (data && data.codigoEstoque && !codigoDigitadoEhOutroSku(cod, data.codigoEstoque)) {
          setCadastroLinhaVisivel(tr, false);
          return;
        }
        setCadastroLinhaVisivel(tr, true);
      })
      .catch(function () {
        setCadastroLinhaVisivel(tr, true);
      });
  }

  function encontrarLinhaConferenciaPorCodigo(codigo) {
    var cod = String(codigo || '').trim();
    if (!cod) return null;
    var host = document.getElementById('wmsRecDetalheLinhas');
    if (!host) return null;
    var trs = host.querySelectorAll('tbody tr[data-nitem]');
    var i;
    for (i = 0; i < trs.length; i++) {
      var inp = trs[i].querySelector('[data-field="codigoProduto"]');
      if (!inp) continue;
      if (String(inp.value || '').trim() === cod) return trs[i];
      if (encontrarProdutoDonoPorCodigo(inp.value)) continue;
      var k1 = codigoProdutoMatchKey(cod);
      var k2 = codigoProdutoMatchKey(inp.value);
      if (k1 && k2 && k1 === k2) return trs[i];
    }
    return null;
  }

  function abrirModalCadastroProdutoReceb(tr) {
    if (!tr) return;
    cadRecLinhaTr = tr;
    var modal = document.getElementById('modalCadProdRecebimento');
    if (!modal) return;
    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
    var valEl = tr.querySelector('[data-field="validade"]');
    var cod = String(prodEl && prodEl.value ? prodEl.value : '').trim();
    var mask = getMaskProdutoDonoAtual();
    var cprod = String(tr.getAttribute('data-cprod') || '').trim();
    var fromCprod = cprod && mask ? reidratarCodigoPorMascara(cprod, mask) : '';
    var digCprod = extrairDigitosCodigo(cprod);
    var digFrom = extrairDigitosCodigo(fromCprod);
    // Se o cProd da NF mascara 1:1 (ex. 6210934500 → 6.21.09.345.00), usa esse código no cadastro.
    if (fromCprod && digCprod && digFrom && digCprod === digFrom) {
      cod = fromCprod;
    } else if (cod && mask) {
      cod = reidratarCodigoPorMascara(cod, mask);
    } else if (!cod && fromCprod) {
      cod = fromCprod;
    }
    document.getElementById('cadRec_codigo').value = cod;
    document.getElementById('cadRec_nome').value = String(tr.getAttribute('data-xprod') || '').trim();
    document.getElementById('cadRec_unidade').value = String(tr.getAttribute('data-ucom') || '').trim().slice(0, 10);
    var ncm = String(tr.getAttribute('data-ncm') || '').replace(/\D/g, '').slice(0, 8);
    document.getElementById('cadRec_ncm').value = ncm;
    document.getElementById('cadRec_peso').value = '';
    var tipo = inferirTipoArmazenagemPorNcm(ncm);
    document.getElementById('cadRec_tipo').value = tipo || 'SECO';
    document.getElementById('cadRec_fg_lote').value = 'N';
    document.getElementById('cadRec_fg_val').value =
      valEl && String(valEl.value || '').trim() ? 'S' : 'S';
    var lbl = document.getElementById('cadRec_cprod_label');
    if (lbl) lbl.textContent = cprod || '—';
    var chkDep = document.getElementById('cadRec_salvar_depara');
    if (chkDep) chkDep.checked = !!cprod;
    modal.style.display = 'flex';
    var nomeInp = document.getElementById('cadRec_nome');
    if (nomeInp) nomeInp.focus();
  }

  function fecharModalCadastroProdutoReceb() {
    var modal = document.getElementById('modalCadProdRecebimento');
    if (modal) modal.style.display = 'none';
    cadRecLinhaTr = null;
  }

  function salvarCadastroProdutoRecebimentoModal() {
    var cdDono = getCdDonoAtual();
    if (!Number.isFinite(cdDono)) {
      showMessage('NF sem dono do estoque. Reimporte o XML selecionando o dono.', 'error');
      return Promise.resolve();
    }
    var codigo = String(document.getElementById('cadRec_codigo').value || '').trim();
    var nome = String(document.getElementById('cadRec_nome').value || '').trim();
    if (!codigo || !nome) {
      showMessage('Informe código e nome do produto.', 'error');
      return Promise.resolve();
    }
    var payload = {
      CD_DONO: cdDono,
      CODIGO: codigo,
      NOME: nome,
      UNIDADE: String(document.getElementById('cadRec_unidade').value || '').trim().slice(0, 10),
      NCM: String(document.getElementById('cadRec_ncm').value || '').replace(/\D/g, '').slice(0, 8),
      PESO_KG: String(document.getElementById('cadRec_peso').value || '').trim().replace(',', '.'),
      TIPO_ARMAZENAGEM: document.getElementById('cadRec_tipo').value || '',
      FG_CONTROLA_LOTE: document.getElementById('cadRec_fg_lote').value || 'N',
      FG_CONTROLA_VALIDADE: document.getElementById('cadRec_fg_val').value || 'S',
      FG_DESCARTAVEL: 'N',
      FGACTIVE: 'S',
      ORIGEM_CADASTRO: 'RECEBIMENTO_RAPIDO',
      FG_FORNECEDOR_REF: 'N',
    };
    if (!payload.PESO_KG) delete payload.PESO_KG;
    if (!payload.NCM) delete payload.NCM;
    if (!payload.TIPO_ARMAZENAGEM) delete payload.TIPO_ARMAZENAGEM;
    if (!payload.UNIDADE) delete payload.UNIDADE;

    showLoadingOverlay('Cadastro', 'Gravando produto no dono…', '');
    return fetch('/api/wms/produtos-dono', {
      method: 'POST',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.error) || r.statusText);
            err.httpStatus = r.status;
            err.body = j;
            throw err;
          }
          return j;
        });
      })
      .then(function (criado) {
        var tr = cadRecLinhaTr;
        var cprod =
          tr && tr.getAttribute('data-cprod') ? String(tr.getAttribute('data-cprod')).trim() : '';
        var gravarDep = document.getElementById('cadRec_salvar_depara');
        var prom = Promise.resolve();
        if (tr && cprod && gravarDep && gravarDep.checked) {
          prom = fetch('/api/wms/de-para-produto', {
            method: 'POST',
            headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              CD_DONO: cdDono,
              CODIGO_EXTERNO: cprod,
              CODIGO_INTERNO: criado.CODIGO || codigo,
              FATOR_CONVERSAO: 1,
              FGACTIVE: 'S',
            }),
          }).then(function (r2) {
            return r2.json().then(function (j2) {
              if (!r2.ok && r2.status !== 409) throw new Error((j2 && j2.error) || r2.statusText);
            });
          });
        }
        return prom.then(function () {
          return recarregarProdutosDonoAtual().then(function () {
            fecharModalCadastroProdutoReceb();
            if (tr) {
              var prodEl = tr.querySelector('[data-field="codigoProduto"]');
              if (prodEl) {
                var mask = getMaskProdutoDonoAtual();
                var codGrav = criado.CODIGO || codigo;
                prodEl.value = mask ? reidratarCodigoPorMascara(codGrav, mask) : codGrav;
                prodEl.classList.add('wms-rec-depara-ok');
              }
              atualizarEstadoCadastroLinhaConferencia(tr);
              aplicarRequisitosLinhaConferencia(tr);
            }
            showMessage(
              'Produto cadastrado. Pode salvar a conferência sem sair do recebimento.',
              'success'
            );
          });
        });
      })
      .catch(function (e) {
        var body = e && e.body;
        if (e && e.httpStatus === 409 && body && body.cdProdutoConflito != null) {
          var idExist = body.cdProdutoConflito;
          showMessage(
            'Este SKU já existe no produto #' +
              idExist +
              ' (' +
              (body.nomeProdutoConflito || 'cadastrado') +
              '). Usando o cadastro existente na linha.',
            'info'
          );
          return fetch('/api/wms/produtos-dono/' + encodeURIComponent(String(idExist)), {
            headers: getAuthHeaders(),
          })
            .then(function (r2) {
              return r2.json().then(function (row) {
                if (!r2.ok) throw new Error((row && row.error) || r2.statusText);
                return recarregarProdutosDonoAtual().then(function () {
                  fecharModalCadastroProdutoReceb();
                  var tr = cadRecLinhaTr;
                  if (tr && row.CODIGO) {
                    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
                    var mask = getMaskProdutoDonoAtual();
                    if (prodEl) {
                      prodEl.value = mask ? reidratarCodigoPorMascara(row.CODIGO, mask) : row.CODIGO;
                    }
                    atualizarEstadoCadastroLinhaConferencia(tr);
                    aplicarRequisitosLinhaConferencia(tr);
                  }
                });
              });
            })
            .catch(function (e2) {
              showMessage((e2 && e2.message) || 'Produto duplicado no cadastro.', 'error');
            });
          return;
        }
        showMessage((e && e.message) || 'Erro ao cadastrar produto.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function filtrarProdutosDonoBusca(query, cProdNf, xProdNf) {
    var q = String(query || '').trim().toLowerCase();
    var qd = extrairDigitosCodigo(query);
    var mask = getMaskProdutoDonoAtual();
    var cprodDig = extrairDigitosCodigo(cProdNf);
    var cprodCanon = cprodDig && mask ? reidratarCodigoPorMascara(cProdNf, mask) : '';
    var xNome = String(xProdNf || '').trim().toLowerCase();
    var arr = Array.isArray(produtosDonoAtual) ? produtosDonoAtual : [];
    var scored = [];
    arr.forEach(function (p) {
      var cod = String(p.CODIGO || '').trim();
      var cv = codigoProdutoExibicao(p);
      var nome = String(p.NOME || '').toLowerCase();
      var cd = extrairDigitosCodigo(cod);
      var score = 0;
      if (cprodCanon && cv === cprodCanon) score += 500;
      if (cprodDig && cd && cd === cprodDig) score += 450;
      else if (cprodDig && cd && cd.indexOf(cprodDig) === 0) score += 80;
      else if (cprodDig && cprodDig.indexOf(cd) === 0) score += 70;
      // Sufixo exato do cProd (…00 vs irmão …01 na mesma família 8 dígitos).
      if (cprodDig && cprodDig.length >= 10 && cd && cd.length >= 10 && cprodDig.slice(0, 8) === cd.slice(0, 8)) {
        if (cprodDig.slice(-2) === cd.slice(-2)) score += 80;
        else score -= 40;
      }
      if (xNome && nome) {
        if (nome === xNome) score += 220;
        else if (nome.indexOf(xNome) >= 0 || xNome.indexOf(nome) >= 0) score += 120;
      }
      if (q) {
        var ql = q.toLowerCase();
        var cvl = cv.toLowerCase();
        if (cvl === ql) score += 80;
        else if (cvl.indexOf(ql) === 0) score += 45;
        else if (cvl.indexOf(ql) >= 0) score += 28;
        if (nome.indexOf(ql) >= 0) score += 24;
        if (qd && cd.indexOf(qd) >= 0) score += 22;
        if (score === 0) return;
      } else if (cprodDig) {
        if (score === 0 && cd.length >= 4) score = 1;
      } else {
        score = 1;
      }
      scored.push({ p: p, score: score, cv: cv });
    });
    scored.sort(function (a, b) {
      return b.score - a.score || String(a.cv).localeCompare(String(b.cv), 'pt-BR');
    });
    var prioritarios = scored.filter(function (h) {
      return h.score >= 200;
    });
    var demais = scored.filter(function (h) {
      return h.score < 200;
    });
    var limite = 50;
    var out = dedupeHitsSugestao(prioritarios.concat(demais)).slice(0, limite);
    return out;
  }

  function attachProdutoDonoAutocomplete(host) {
    host.querySelectorAll('tbody tr[data-nitem]').forEach(function (tr) {
      var inp = tr.querySelector('[data-field="codigoProduto"]');
      if (!inp || inp.getAttribute('data-ac-wired') === '1') return;
      inp.setAttribute('data-ac-wired', '1');
      var cProdNf = tr.getAttribute('data-cprod') || '';
      var xProd = tr.getAttribute('data-xprod') || '';
      var box = document.createElement('div');
      box.className = 'wms-rec-prod-suggest';
      box.style.display = 'none';
      var cell = inp.closest('.col-produto-dono') || inp.parentNode;
      if (cell) cell.appendChild(box);

      var hideTimer = null;
      var suggestTimer = null;
      var suggestSeq = 0;
      var hideSuggest = function () {
        box.style.display = 'none';
      };
      var paintHits = function (hits) {
        if (!hits.length) {
          hideSuggest();
          box.innerHTML = '';
          return;
        }
        box.innerHTML = hits.map(htmlBotaoSugestaoProduto).join('');
        box.style.display = 'block';
      };
      var renderSuggest = function () {
        var localHits = filtrarProdutosDonoBusca(inp.value, cProdNf, xProd);
        var cdDono = getCdDonoAtual();
        var q = String(inp.value || '').trim();
        if (!Number.isFinite(cdDono)) {
          paintHits(localHits);
          return;
        }
        if (localHits.length) paintHits(localHits);
        var seq = ++suggestSeq;
        if (suggestTimer) clearTimeout(suggestTimer);
        suggestTimer = setTimeout(function () {
          buscarProdutosDonoServidor(cdDono, q, cProdNf, xProd)
            .then(function (rows) {
              if (seq !== suggestSeq) return;
              mergeProdutosDonoCache(rows);
              var srvHits = produtosParaHitsSugestao(rows);
              var merged = mergeHitsSugestao(localHits, srvHits);
              if (!merged.length && q.length < 2 && !cProdNf) {
                hideSuggest();
                return;
              }
              paintHits(merged.length ? merged : localHits);
            })
            .catch(function () {
              if (seq !== suggestSeq) return;
              paintHits(localHits);
            });
        }, 220);
      };
      box.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('button[data-cod]');
        if (!btn) return;
        e.preventDefault();
        var rawCod = btn.getAttribute('data-cod-raw') || '';
        var pSel = rawCod ? encontrarProdutoDonoPorCodigo(rawCod) : null;
        inp.value = pSel ? codigoProdutoExibicao(pSel) : btn.getAttribute('data-cod') || '';
        inp.classList.remove('wms-rec-depara-ok');
        aplicarRequisitosLinhaConferencia(tr);
        hideSuggest();
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      });
      inp.addEventListener('focus', renderSuggest);
      inp.addEventListener('input', renderSuggest);
      inp.addEventListener('blur', function () {
        hideTimer = setTimeout(hideSuggest, 180);
      });
      box.addEventListener('mousedown', function () {
        if (hideTimer) clearTimeout(hideTimer);
      });
    });
  }

  function attachConferenciaAssist(host) {
    var maskProd = getMaskProdutoDonoAtual();
    attachProdutoDonoAutocomplete(host);
    host.querySelectorAll('tbody tr[data-nitem]').forEach(function (tr) {
      var prodEl = tr.querySelector('[data-field="codigoProduto"]');
      if (prodEl) {
        prodEl.addEventListener('blur', function () {
          var rawVal = String(prodEl.value || '').trim();
          if (!rawVal) {
            aplicarRequisitosLinhaConferencia(tr);
            atualizarEstadoCadastroLinhaConferencia(tr);
            return;
          }
          var maskNow = getMaskProdutoDonoAtual() || maskProd;
          var rawCanon = maskNow ? reidratarCodigoPorMascara(rawVal, maskNow) : rawVal;
          prodEl.value = rawCanon || rawVal;

          var pHit = encontrarProdutoDonoPorCodigo(prodEl.value);
          if (pHit) {
            var viewHit = codigoProdutoExibicao(pHit);
            // Nunca trocar .80 por .60 (nem outro irmão) por match frouxo do catálogo.
            if (!codigoDigitadoEhOutroSku(prodEl.value, viewHit) && !codigoDigitadoEhOutroSku(prodEl.value, pHit.CODIGO)) {
              prodEl.value = viewHit;
              setCadastroLinhaVisivel(tr, false);
            } else {
              setCadastroLinhaVisivel(tr, true);
            }
            aplicarRequisitosLinhaConferencia(tr);
            atualizarEstadoCadastroLinhaConferencia(tr);
            return;
          }

          var cdDono = getCdDonoAtual();
          if (!Number.isFinite(cdDono)) {
            setCadastroLinhaVisivel(tr, true);
            aplicarRequisitosLinhaConferencia(tr);
            return;
          }

          // SEM cProd: o de-para da NF não pode sobrescrever o código digitado (caso .80 → .60).
          resolverCodigoEstoqueServidor(cdDono, prodEl.value, '')
            .then(function (data) {
              if (
                data &&
                data.codigoEstoque &&
                !codigoDigitadoEhOutroSku(prodEl.value, data.codigoEstoque)
              ) {
                aplicarResolucaoCodigoNaLinha(tr, data, prodEl.value);
              } else {
                setCadastroLinhaVisivel(tr, true);
                aplicarRequisitosLinhaConferencia(tr);
              }
            })
            .catch(function () {
              // Código novo: mantém o digitado e oferece "Cadastrar produto".
              setCadastroLinhaVisivel(tr, true);
              aplicarRequisitosLinhaConferencia(tr);
            });
        });
        prodEl.addEventListener('change', function () {
          aplicarRequisitosLinhaConferencia(tr);
          atualizarEstadoCadastroLinhaConferencia(tr);
        });
      }
      var fatorEl = tr.querySelector('[data-field="fatorConversao"]');
      if (!fatorEl) return;
      var recalc = function () {
        var fator = Number(String(fatorEl.value || '').replace(',', '.'));
        if (!Number.isFinite(fator) || fator < 0) {
          fatorEl.setCustomValidity('Fator inválido (use 0 ou maior).');
        } else {
          fatorEl.setCustomValidity('');
        }
      };
      fatorEl.addEventListener('input', recalc);
      var qtdEl = tr.querySelector('[data-field="qtdRecebida"]');
      if (qtdEl) {
        qtdEl.addEventListener('input', function () {
          recalc();
          aplicarRequisitosLinhaConferencia(tr);
        });
        qtdEl.addEventListener('change', function () {
          aplicarRequisitosLinhaConferencia(tr);
        });
      }
      recalc();
      aplicarRequisitosLinhaConferencia(tr);
    });
  }

  function attachConferenciaSort(host) {
    var table = host.querySelector('table');
    if (!table) return;
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;
    var state = { key: null, dir: 'asc' };
    thead.querySelectorAll('th.sortable[data-sort-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort-key');
        if (!key) return;
        if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else {
          state.key = key;
          state.dir = 'asc';
        }
        var rows = Array.from(tbody.querySelectorAll('tr[data-nitem]'));
        rows.sort(function (a, b) {
          var av = '';
          var bv = '';
          if (key === 'nItem') {
            av = Number(a.getAttribute('data-nitem') || 0);
            bv = Number(b.getAttribute('data-nitem') || 0);
          } else if (key === 'qCom') {
            av = Number(String(a.getAttribute('data-qcom') || '').replace(',', '.')) || 0;
            bv = Number(String(b.getAttribute('data-qcom') || '').replace(',', '.')) || 0;
          } else {
            av = String(a.getAttribute('data-' + key.toLowerCase()) || '').toUpperCase();
            bv = String(b.getAttribute('data-' + key.toLowerCase()) || '').toUpperCase();
          }
          if (av < bv) return state.dir === 'asc' ? -1 : 1;
          if (av > bv) return state.dir === 'asc' ? 1 : -1;
          return 0;
        });
        rows.forEach(function (r) {
          tbody.appendChild(r);
        });
        thead.querySelectorAll('th.sortable').forEach(function (h) {
          var base = h.textContent.replace(/\s*[↑↓]$/, '');
          h.textContent = base;
        });
        var base = th.textContent.replace(/\s*[↑↓]$/, '');
        th.textContent = base + (state.dir === 'asc' ? ' ↑' : ' ↓');
      });
    });
  }

  function flagsProdutoDonoPorCodigo(codigo) {
    var p = encontrarProdutoDonoPorCodigo(codigo);
    if (!p) return null;
    return {
      lote: String(p.FG_CONTROLA_LOTE || p.fg_controla_lote || '').toUpperCase() === 'S',
      validade: String(p.FG_CONTROLA_VALIDADE || p.fg_controla_validade || '').toUpperCase() === 'S',
    };
  }

  function flagsProdutoDonoFromRow(p) {
    if (!p) return null;
    return {
      lote: String(p.FG_CONTROLA_LOTE || p.fg_controla_lote || '').toUpperCase() === 'S',
      validade: String(p.FG_CONTROLA_VALIDADE || p.fg_controla_validade || '').toUpperCase() === 'S',
    };
  }

  function buscarFlagsProdutoDonoServidor(cdDono, codigo) {
    var cod = String(codigo || '').trim();
    if (!cod || !Number.isFinite(cdDono)) return Promise.resolve(null);
    var cached = flagsProdutoDonoPorCodigo(cod);
    if (cached) return Promise.resolve(cached);
    return buscarProdutosDonoServidor(cdDono, cod, '', '')
      .then(function (rows) {
        if (rows && rows.length) mergeProdutosDonoCache(rows);
        return flagsProdutoDonoPorCodigo(cod) || flagsProdutoDonoFromRow(rows && rows[0]);
      })
      .catch(function () {
        return null;
      });
  }

  function qtdRecebidaPositivaItem(it) {
    var q = Number(String(it && it.qtdRecebida != null ? it.qtdRecebida : '').replace(',', '.'));
    return Number.isFinite(q) && q > 0;
  }

  function aplicarRequisitosLinhaConferencia(tr) {
    if (!tr) return;
    var prodEl = tr.querySelector('[data-field="codigoProduto"]');
    var loteEl = tr.querySelector('[data-field="lote"]');
    var valEl = tr.querySelector('[data-field="validade"]');
    var qtdEl = tr.querySelector('[data-field="qtdRecebida"]');
    if (!prodEl) return;
    var cod = normalizarCodigoProdutoDigitado(prodEl.value);
    var qtd = Number(String((qtdEl && qtdEl.value) || '').replace(',', '.'));
    var recebeu = Number.isFinite(qtd) && qtd > 0;
    var flags = flagsProdutoDonoPorCodigo(cod);
    var aplicar = function (f) {
      if (loteEl) {
        loteEl.required = !!(f && f.lote && recebeu);
        loteEl.title =
          f && f.lote && recebeu
            ? 'Lote obrigatório para este produto (qtd recebida > 0).'
            : '';
      }
      if (valEl) {
        valEl.required = !!(f && f.validade && recebeu);
        valEl.title =
          f && f.validade && recebeu
            ? 'Validade obrigatória — produto controla validade (qtd recebida > 0).'
            : '';
      }
    };
    if (flags) {
      aplicar(flags);
      return;
    }
    if (!cod) {
      aplicar(null);
      return;
    }
    var cdDono = getCdDonoAtual();
    if (!Number.isFinite(cdDono)) {
      aplicar(null);
      return;
    }
    buscarFlagsProdutoDonoServidor(cdDono, cod).then(function (fSrv) {
      aplicar(fSrv);
      atualizarEstadoCadastroLinhaConferencia(tr);
    });
  }

  function validarConferenciaLocal(itens) {
    var erros = [];
    (itens || []).forEach(function (it) {
      var cod = String(it.codigoProduto || '').trim();
      if (!cod) return;
      if (!qtdRecebidaPositivaItem(it)) return;
      var flags = flagsProdutoDonoPorCodigo(cod);
      if (!flags) return;
      var n = it.nItem || '?';
      if (flags.validade && !String(it.validade || '').trim()) {
        erros.push('Item ' + n + ': informe a data de validade (produto controla validade).');
      }
      if (flags.lote && !String(it.lote || '').trim()) {
        erros.push('Item ' + n + ': informe o lote (produto controla lote).');
      }
    });
    return erros;
  }

  function validarConferenciaLocalAsync(itens) {
    var cdDono = getCdDonoAtual();
    var errosSync = validarConferenciaLocal(itens);
    if (!Number.isFinite(cdDono)) return Promise.resolve(errosSync);
    var pendentes = [];
    (itens || []).forEach(function (it) {
      var cod = String(it.codigoProduto || '').trim();
      if (!cod || !qtdRecebidaPositivaItem(it) || flagsProdutoDonoPorCodigo(cod)) return;
      pendentes.push({ cod: cod, nItem: it.nItem || '?' });
    });
    if (!pendentes.length) return Promise.resolve(errosSync);
    return Promise.all(
      pendentes.map(function (x) {
        return buscarFlagsProdutoDonoServidor(cdDono, x.cod).then(function (flags) {
          return { x: x, flags: flags };
        });
      })
    ).then(function (resolvidos) {
      var erros = errosSync.slice();
      resolvidos.forEach(function (r) {
        if (!r.flags) return;
        var it = (itens || []).find(function (i) {
          return String(i.nItem || '') === String(r.x.nItem || '');
        });
        if (!it || !qtdRecebidaPositivaItem(it)) return;
        if (r.flags.validade && !String(it.validade || '').trim()) {
          erros.push(
            'Item ' + r.x.nItem + ': informe a data de validade (produto controla validade).'
          );
        }
        if (r.flags.lote && !String(it.lote || '').trim()) {
          erros.push('Item ' + r.x.nItem + ': informe o lote (produto controla lote).');
        }
      });
      return erros;
    });
  }

  function coletarConferencia() {
    var host = document.getElementById('wmsRecDetalheLinhas');
    if (!host) return [];
    var confSalva = parseJsonField(detalheDocAtual && detalheDocAtual.CONFERENCIA_JSON);
    var salvaByN = {};
    confSalva.forEach(function (c) {
      salvaByN[String(c.nItem || '')] = c;
    });
    var itens = [];
    host.querySelectorAll('tbody tr[data-nitem]').forEach(function (tr) {
      var nItem = tr.getAttribute('data-nitem');
      var get = function (field) {
        var el = tr.querySelector('[data-field="' + field + '"]');
        return el ? String(el.value || '').trim() : '';
      };
      var prev = salvaByN[String(nItem || '')] || {};
      var codigoProduto = normalizarCodigoProdutoDigitado(get('codigoProduto') || prev.codigoProduto || '');
      var lote = get('lote');
      var validade = normalizarValidadeInput(get('validade'));
      var qtdRecebida = get('qtdRecebida');
      var fatStr = get('fatorConversao');
      var salvarDepara = !!(tr.querySelector('[data-field="salvarDepara"]') || {}).checked;
      // Se a tela veio sem validade/lote/qtd mas já estava gravado no JSON, reaproveita
      if (!validade && prev.validade) validade = normalizarValidadeInput(prev.validade);
      if (!lote && prev.lote) lote = String(prev.lote).trim();
      if (!qtdRecebida && prev.qtdRecebida != null && String(prev.qtdRecebida).trim() !== '') {
        qtdRecebida = String(prev.qtdRecebida).trim();
      }
      if (!codigoProduto && !lote && !validade && !qtdRecebida && !salvarDepara && fatStr === '') return;
      // Só reaproveita cdProduto se o código na tela ainda for o mesmo produto.
      // Senão o backend priorizava o ID antigo e “desfazia” a troca (ex.: .20 → .60).
      var prevCodKey = codigoProdutoMatchKey(prev.codigoProduto || '');
      var novoCodKey = codigoProdutoMatchKey(codigoProduto);
      var mesmoProduto =
        prev.cdProduto != null &&
        prevCodKey &&
        novoCodKey &&
        prevCodKey === novoCodKey;
      itens.push({
        nItem: nItem,
        codigoProduto: codigoProduto,
        fatorConversao: fatStr !== '' ? fatStr : prev.fatorConversao != null ? String(prev.fatorConversao) : '1',
        qtdRecebida: qtdRecebida,
        lote: lote,
        validade: validade,
        salvarDepara: salvarDepara,
        cdProduto: mesmoProduto ? prev.cdProduto : null,
      });
    });
    return itens;
  }

  /** Linhas da NF na ordem do XML, mescladas com os campos atuais da tabela de conferência. */
  function readConferenciaLinhasCompletasFromDom() {
    var doc = detalheDocAtual;
    if (!doc) return [];
    var host = document.getElementById('wmsRecDetalheLinhas');
    if (!host) return [];
    var linhas = parseJsonField(doc.LINHAS_JSON);
    if (!linhas.length) return [];
    var get = function (tr, field) {
      var el = tr.querySelector('[data-field="' + field + '"]');
      return el ? String(el.value || '').trim() : '';
    };
    var out = [];
    linhas.forEach(function (L) {
      var n = String(L.nItem || '');
      var tr = Array.from(host.querySelectorAll('tbody tr[data-nitem]')).find(function (r) {
        return r.getAttribute('data-nitem') === n;
      });
      if (!tr) return;
      out.push({
        nItem: n,
        cProd: L.cProd != null ? String(L.cProd) : '',
        xProd: L.xProd != null ? String(L.xProd) : '',
        qCom: L.qCom != null ? String(L.qCom) : '',
        uCom: L.uCom != null ? String(L.uCom) : '',
        codigoProduto: get(tr, 'codigoProduto'),
        fatorConversao: get(tr, 'fatorConversao'),
        qtdRecebida: get(tr, 'qtdRecebida'),
        qtdConvertida: (function () {
          var fat = Number(String(get(tr, 'fatorConversao')).replace(',', '.'));
          var qtd = Number(String(get(tr, 'qtdRecebida')).replace(',', '.'));
          var fEff = Number.isFinite(fat) && fat >= 0 ? (fat === 0 ? 1 : fat) : 1;
          if (!Number.isFinite(qtd) || qtd < 0) return '';
          return (qtd * fEff).toFixed(3);
        })(),
        lote: get(tr, 'lote'),
        validade: get(tr, 'validade'),
      });
    });
    return out;
  }

  function getCdDonoAtual() {
    if (!detalheDocAtual) return null;
    var cd = detalheDocAtual.CD_DONO;
    if (cd == null || String(cd).trim() === '') return null;
    var n = parseInt(String(cd), 10);
    return Number.isFinite(n) ? n : null;
  }

  function findLinhaBasePorCodigoProduto(codigoProduto) {
    var cod = String(codigoProduto || '').trim();
    if (!cod) return null;
    var rows = readConferenciaLinhasCompletasFromDom();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].codigoProduto || '').trim() === cod) return rows[i];
    }
    return null;
  }

  function cadastrarProdutoDonoRapido(codigoProduto, extras) {
    var cdDono = getCdDonoAtual();
    if (!Number.isFinite(cdDono)) return Promise.reject(new Error('Documento sem dono do estoque vinculado.'));
    var base = findLinhaBasePorCodigoProduto(codigoProduto) || {};
    extras = extras || {};
    var payload = {
      CD_DONO: cdDono,
      CODIGO: String(codigoProduto || '').trim(),
      NOME:
        String(extras.NOME || extras.nome || base.xProd || '').trim() ||
        'Produto ' + String(codigoProduto || '').trim(),
      UNIDADE: String(extras.UNIDADE || extras.unidade || base.uCom || '').trim().slice(0, 10),
      FGACTIVE: 'S',
      ORIGEM_CADASTRO: 'RECEBIMENTO_RAPIDO',
      FG_FORNECEDOR_REF: 'N',
      FG_CONTROLA_LOTE: extras.FG_CONTROLA_LOTE || 'N',
      FG_CONTROLA_VALIDADE: extras.FG_CONTROLA_VALIDADE || 'S',
    };
    if (extras.NCM) payload.NCM = String(extras.NCM).replace(/\D/g, '').slice(0, 8);
    if (extras.PESO_KG) payload.PESO_KG = String(extras.PESO_KG).replace(',', '.');
    if (extras.TIPO_ARMAZENAGEM) payload.TIPO_ARMAZENAGEM = extras.TIPO_ARMAZENAGEM;
    return fetch('/api/wms/produtos-dono', {
      method: 'POST',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || r.statusText);
        return j;
      });
    });
  }

  function recarregarProdutosDonoAtual() {
    var cdDono = getCdDonoAtual();
    if (!Number.isFinite(cdDono)) return Promise.resolve();
    return carregarProdutosDono(cdDono)
      .then(function (arr) {
        produtosDonoAtual = deduplicarProdutosDonoLista(Array.isArray(arr) ? arr : []);
      })
      .catch(function () {});
  }

  function getMaskProdutoDonoAtual() {
    if (detalheDocAtual) {
      var mkDoc = String(
        detalheDocAtual.MASCARA_CODIGO_PRODUTO_DONO || detalheDocAtual.mascara_codigo_produto_dono || ''
      ).trim();
      if (mkDoc) return mkDoc;
    }
    var arr = Array.isArray(produtosDonoAtual) ? produtosDonoAtual : [];
    for (var i = 0; i < arr.length; i++) {
      var mk = String(arr[i].MASCARA_CODIGO_PRODUTO || arr[i].mascara_codigo_produto || '').trim();
      if (mk) return mk;
    }
    return '';
  }

  function encontrarProdutoDonoPorCodigo(raw) {
    var cod = String(raw || '').trim();
    if (!cod) return null;
    var mask = getMaskProdutoDonoAtual();
    var alvoKey = codigoProdutoMatchKey(cod);
    var alvoUp = cod.toUpperCase();
    var alvoCanon = mask ? reidratarCodigoPorMascara(cod, mask) : cod;
    var arr = Array.isArray(produtosDonoAtual) ? produtosDonoAtual : [];
    var i;
    for (i = 0; i < arr.length; i++) {
      var keys = [
        codigoProdutoMatchKey(arr[i].CODIGO),
        codigoProdutoMatchKey(arr[i].CODIGO_ESTOQUE),
        codigoProdutoMatchKey(arr[i].CODIGO_OPERACIONAL),
        codigoProdutoMatchKey(codigoProdutoExibicao(arr[i])),
      ];
      if (alvoKey && keys.indexOf(alvoKey) >= 0) return arr[i];
      if (alvoUp && String(arr[i].CODIGO || '').trim().toUpperCase() === alvoUp) return arr[i];
      if (alvoCanon && codigoProdutoExibicao(arr[i]).toUpperCase() === String(alvoCanon).toUpperCase()) {
        return arr[i];
      }
    }
    if (codigoTemSufixoLetras(cod)) return null;
    var alvoDig = extrairDigitosCodigo(cod);
    for (i = 0; i < arr.length; i++) {
      var c = String(arr[i].CODIGO || '').trim();
      var cOp = String(arr[i].CODIGO_OPERACIONAL || '').trim();
      if (cOp && alvoDig && extrairDigitosCodigo(cOp) === alvoDig) return arr[i];
      if (c && alvoDig && extrairDigitosCodigo(c) === alvoDig) return arr[i];
      var cEst = String(arr[i].CODIGO_ESTOQUE || '').trim();
      if (cEst && alvoDig && extrairDigitosCodigo(cEst) === alvoDig) return arr[i];
    }
    return null;
  }

  function normalizarCodigoProdutoDigitado(raw) {
    var p = encontrarProdutoDonoPorCodigo(raw);
    if (p) {
      var est = codigoEstoqueCanonico(p);
      if (est) return est;
    }
    return String(raw || '').trim();
  }

  function extrairCodigoProdutoErroCadastro(errMsg) {
    var s = String(errMsg || '');
    var m =
      s.match(/Produto não encontrado para o dono:\s*([^\s]+)/i) ||
      s.match(/produto\s+"([^"]+)"\s+não encontrado no cadastro do dono/i) ||
      s.match(/Item\s+\d+:\s+produto\s+"([^"]+)"/i);
    return m && m[1] ? String(m[1]).trim() : '';
  }

  function tentarCadastrarProdutoInexistente(errMsg) {
    var codigo = extrairCodigoProdutoErroCadastro(errMsg);
    if (!codigo) return Promise.resolve(false);
    var trLinha = encontrarLinhaConferenciaPorCodigo(codigo);
    if (trLinha) {
      abrirModalCadastroProdutoReceb(trLinha);
      return Promise.resolve(false);
    }
    return confirmarPadrao(
      'Produto "' +
        codigo +
        '" não existe para este dono.\n\nCadastrar agora com a descrição da NF-e?',
      'Cadastrar produto'
    ).then(function (ok) {
      if (!ok) return false;
      return cadastrarProdutoDonoRapido(codigo)
        .then(function () {
          return recarregarProdutosDonoAtual().then(function () {
            showMessage('Produto ' + codigo + ' cadastrado. Tentando salvar novamente...', 'success');
            return true;
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Não foi possível cadastrar o produto.', 'error');
          return false;
        });
    });
  }

  function obterNomeDono(cdDono) {
    if (!Number.isFinite(cdDono)) return Promise.resolve('');
    return fetch('/api/wms/donos-estoque', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) return '';
        for (var i = 0; i < rows.length; i++) {
          if (parseInt(rows[i].CD_DONO, 10) === cdDono) {
            return (rows[i].CODIGO || '') + ' — ' + (rows[i].NOME || '');
          }
        }
        return '';
      })
      .catch(function () {
        return '';
      });
  }

  function abrirJanelaImpressao(htmlInner, title, mode) {
    var stylesLista =
      '@page{margin:10mm}body{font-family:system-ui,Segoe UI,sans-serif;font-size:10pt;color:#000;margin:0;padding-bottom:48px}h1{font-size:14pt;margin:0 0 8px}.meta{font-size:9pt;line-height:1.45;margin-bottom:10px}.hint{font-size:8pt;color:#444;margin:0 0 10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:3px 5px;font-size:8pt;vertical-align:top}th{background:#e8e8e8;text-align:left}.toolbar{position:fixed;bottom:0;left:0;right:0;padding:10px;background:#f1f5f9;border-top:1px solid #cbd5e1;text-align:center;z-index:9}@media print{.toolbar{display:none!important}body{padding-bottom:0}}';
    var stylesEtq =
      '@page{size:A4 portrait;margin:10mm}body{font-family:system-ui,Segoe UI,sans-serif;font-size:10pt;color:#000;margin:0;padding-bottom:52px}.toolbar{position:fixed;bottom:0;left:0;right:0;padding:10px;background:#f1f5f9;border-top:1px solid #cbd5e1;text-align:center;z-index:9}' +
      '@media print{.toolbar{display:none!important}body{padding-bottom:0}' +
      '.etq-sheet{page-break-after:always;page-break-inside:avoid}' +
      '.etq-sheet:last-of-type{page-break-after:auto}' +
      '}' +
      '.etq-sheet{display:flex;flex-direction:column;align-items:center;gap:6mm;width:190mm;max-width:100%;margin:0 auto 10mm;box-sizing:border-box}' +
      '.label{width:190mm;height:130mm;border:2px solid #000;padding:5mm;margin:0;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column;flex-shrink:0}' +
      '.etq-top{display:grid;grid-template-columns:1fr 66mm;gap:5mm;align-items:start}.cod{font-size:34pt;font-weight:900;font-family:ui-monospace,Consolas,monospace;line-height:1.03;text-align:center;letter-spacing:0.4px}.desc{margin-top:2mm;text-align:center;line-height:1.25}.desc .forn{font-size:13pt;font-weight:500;text-transform:uppercase}.desc .int{font-size:13pt;font-weight:800;text-transform:uppercase}.meta{font-size:11pt;line-height:1.4;text-align:right}.meta .nf{font-size:22pt;font-weight:900;line-height:1.1}.meta .dt{font-size:10pt;text-transform:uppercase;letter-spacing:0.3px}.meta .dtv{font-size:20pt;font-weight:900;line-height:1.05}.etq-mid{display:flex;align-items:flex-end;justify-content:space-between;margin-top:3mm}.vol{font-size:22pt;font-weight:900}.vol small{font-size:11pt;font-weight:600;margin-right:1mm}.validade{font-size:11pt;text-transform:uppercase}.validade .v{font-size:28pt;font-weight:900;line-height:1}.etq-bars{margin-top:auto}.bars-row{display:flex;gap:6mm;align-items:flex-end}.bar-wrap{flex:1}.bar-wrap svg.bc-svg{width:100%;height:18mm}.bar-wrap .bc-fallback{font-size:9pt;font-family:ui-monospace,Consolas,monospace;word-break:break-all}.dono-lote{display:flex;justify-content:space-between;align-items:flex-end;margin-top:2mm}.dono{font-size:11pt}.dono .nome{font-size:24pt;font-weight:900;line-height:1.05}.lote{font-size:11pt;text-transform:uppercase;text-align:right}.lote .valor{font-size:20pt;font-weight:900;line-height:1.05}';
    var styles = mode === 'etiquetas' ? stylesEtq : stylesLista;
    var w = window.open('', '_blank');
    if (!w) {
      showMessage('Permita pop-up para imprimir.', 'error');
      return;
    }
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
        escapeHtml(title) +
        '</title><style>' +
        styles +
        '</style></head><body>'
    );
    w.document.write(htmlInner);
    if (mode === 'etiquetas') {
      w.document.write(
        '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>' +
          '<script>(function(){function go(){var nodes=document.querySelectorAll("svg.bc-svg[data-bc]");var has=typeof JsBarcode==="function";nodes.forEach(function(el){var v=el.getAttribute("data-bc")||"-";if(has){try{JsBarcode(el,v,{format:"CODE128",displayValue:true,fontSize:12,height:48,margin:2,width:1.4});return;}catch(e){}}var fb=document.createElement("div");fb.className="bc-fallback";fb.textContent=v;el.replaceWith(fb);});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else setTimeout(go,50);})();<\/script>'
      );
    }
    w.document.write(
      '<div class="toolbar"><button type="button" id="wmsPrintBtn">Imprimir / PDF</button> <button type="button" id="wmsCloseBtn">Fechar</button></div></body></html>'
    );
    w.document.close();
    var pb = w.document.getElementById('wmsPrintBtn');
    var cb = w.document.getElementById('wmsCloseBtn');
    if (pb)
      pb.addEventListener('click', function () {
        w.focus();
        w.print();
      });
    if (cb) cb.addEventListener('click', function () { w.close(); });
  }

  function getConferenteNome() {
    var el = document.getElementById('wmsRecConferenteNome');
    var v = el ? String(el.value || '').trim() : '';
    if (v) return v;
    if (detalheDocAtual && detalheDocAtual.NM_CONFERENTE) return String(detalheDocAtual.NM_CONFERENTE).trim();
    return '';
  }

  function abrirImpressaoListaConferencia() {
    if (!detalheDocAtual || !detalheDocAtual.CD_NFE) {
      showMessage('Abra o detalhe de uma NF-e primeiro.', 'error');
      return;
    }
    var rows = readConferenciaLinhasCompletasFromDom();
    if (!rows.length) {
      showMessage('Nenhuma linha da NF-e para impressão.', 'error');
      return;
    }
    var doc = detalheDocAtual;
    var cdDono = doc.CD_DONO != null && String(doc.CD_DONO).trim() !== '' ? parseInt(doc.CD_DONO, 10) : null;
    obterNomeDono(cdDono).then(function (donoTxt) {
      var title = 'Lista conferência — NF ' + (doc.NUMERO_NF || '') + '/' + (doc.SERIE || '');
      var tb = '';
      rows.forEach(function (r) {
        tb +=
          '<tr><td>' +
          escapeHtml(r.nItem) +
          '</td><td>' +
          escapeHtml(r.cProd) +
          '</td><td>' +
          escapeHtml(r.xProd) +
          '</td><td style="text-align:right">' +
          escapeHtml(r.qCom) +
          '</td><td>' +
          escapeHtml(r.uCom) +
          '</td><td style="text-align:right">' +
          escapeHtml(r.qtdRecebida) +
          '</td><td>' +
          escapeHtml(r.lote) +
          '</td><td>' +
          escapeHtml(r.validade) +
          '</td></tr>';
      });
      var dhConf = doc.DH_CONFERENCIA ? formatDateTimeLocal(doc.DH_CONFERENCIA) : '(não gravada — valores como na tela)';
      var confNome = getConferenteNome();
      var cnpjDestImp = formatCnpj(doc.CNPJ_DEST || '');
      var dhEmiImp = formatDataNf(doc.DH_EMISSAO);
      var impressoEm = formatDateTimeLocal(new Date());
      var html =
        '<h1>Lista de conferência — recebimento</h1>' +
        '<p class="print-dh" style="text-align:right;margin:0 0 10px 0;font-size:11px"><strong>Data e hora da impressão:</strong> ' +
        escapeHtml(impressoEm) +
        '</p>' +
        '<div class="meta">' +
        '<strong>Emitente:</strong> ' +
        escapeHtml(doc.XNOME_EMIT || '') +
        '<br/>' +
        '<strong>Destinatário:</strong> ' +
        escapeHtml(doc.XNOME_DEST || '') +
        (cnpjDestImp ? '<br/><strong>CNPJ destinatário:</strong> ' + escapeHtml(cnpjDestImp) : '') +
        '<br/>' +
        '<strong>Chave NF-e:</strong> ' +
        escapeHtml(doc.CHAVE_NFE || '') +
        '<br/>' +
        '<strong>NF / Série:</strong> ' +
        escapeHtml(doc.NUMERO_NF || '') +
        ' / ' +
        escapeHtml(doc.SERIE || '') +
        (dhEmiImp ? ' — <strong>Emissão:</strong> ' + escapeHtml(dhEmiImp) : '') +
        '<br/>' +
        '<strong>Dono do estoque:</strong> ' +
        escapeHtml(donoTxt || (Number.isFinite(cdDono) ? 'CD ' + cdDono : '—')) +
        '<br/>' +
        '<strong>Data conferência gravada:</strong> ' +
        escapeHtml(dhConf) +
        '<br/>' +
        '<strong>Data de recebimento:</strong> ' +
        escapeHtml(formatDataNf(docDtRecebimentoIso(doc) || doc.DT_RECEBIMENTO) || '—') +
        '<br/>' +
        '<strong>Conferente (nome):</strong> ' +
        escapeHtml(confNome || '________________________________') +
        '</div>' +
        '<p class="hint" style="margin-top:8px"><strong>Assinatura do conferente:</strong> ________________________________________________</p>' +
        '<p class="hint">A tabela abaixo reflete o que está na tela no momento (inclui alterações ainda não salvas).</p>' +
        '<table><thead><tr><th>#</th><th>Prod. NF</th><th>Descrição</th><th>Qtd NF</th><th>UM</th><th>Qtd recebida</th><th>Lote</th><th>Validade</th></tr></thead><tbody>' +
        tb +
        '</tbody></table>';
      abrirJanelaImpressao(html, title, 'lista');
    });
  }

  var WMS_ETQ_MAX_POR_ITEM = 500;
  var WMS_ETQ_MAX_TOTAL = 2000;

  function parseQtdInteiraRecebida(r) {
    var qr = String(r.qtdRecebida != null ? r.qtdRecebida : '')
      .trim()
      .replace(',', '.');
    var q = Number(qr);
    if (qr === '' || !Number.isFinite(q) || q < 0) return 0;
    return Math.floor(q);
  }

  function etiquetasPorLinhaReceb(modo, r, qtdFixa, qtdPorItem) {
    if (modo === 'personalizado') {
      var map = qtdPorItem && typeof qtdPorItem === 'object' ? qtdPorItem : {};
      var key = String(r.nItem != null ? r.nItem : '');
      var q = parseInt(map[key], 10);
      if (!Number.isFinite(q) || q < 1) return 0;
      return Math.min(q, WMS_ETQ_MAX_POR_ITEM);
    }
    if (modo === 'qtd') {
      var q = parseQtdInteiraRecebida(r);
      return Math.min(q > 0 ? q : 1, WMS_ETQ_MAX_POR_ITEM);
    }
    if (modo === 'fixo') {
      var n = parseInt(qtdFixa, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      return Math.min(n, WMS_ETQ_MAX_POR_ITEM);
    }
    return 1;
  }

  function contarEtiquetasPrevistas(rows, modo, qtdFixa, qtdPorItem) {
    var total = 0;
    rows.forEach(function (r) {
      total += etiquetasPorLinhaReceb(modo, r, qtdFixa, qtdPorItem);
    });
    return total;
  }

  function renderTabelaEtqPersonalizado(rows) {
    var tb = document.getElementById('etqPersonalizadoLinhasBody');
    if (!tb) return;
    var html = '';
    (rows || []).forEach(function (r) {
      var nItem = String(r.nItem != null ? r.nItem : '');
      var sub = String(r.cProd || '').trim();
      if (r.xProd) sub += (sub ? ' — ' : '') + String(r.xProd).trim().slice(0, 48);
      html +=
        '<tr data-nitem="' +
        escapeHtml(nItem) +
        '"><td><strong>#' +
        escapeHtml(nItem) +
        '</strong>' +
        (sub ? '<div class="etq-pers-sub">' + escapeHtml(sub) + '</div>' : '') +
        '</td><td class="etq-pers-col-qtd"><input type="number" class="etq-pers-qtd" min="0" max="500" step="1" value="1" data-nitem="' +
        escapeHtml(nItem) +
        '" /></td></tr>';
    });
    tb.innerHTML = html || '<tr><td colspan="2"><em>Nenhuma linha na conferência.</em></td></tr>';
  }

  function lerQtdPorItemPersonalizado(modal) {
    var map = {};
    if (!modal) return map;
    modal.querySelectorAll('.etq-pers-qtd').forEach(function (inp) {
      var n = inp.getAttribute('data-nitem');
      if (n == null || n === '') return;
      var q = parseInt(String(inp.value || '').trim(), 10);
      map[n] = Number.isFinite(q) && q >= 0 ? Math.min(q, WMS_ETQ_MAX_POR_ITEM) : 0;
    });
    return map;
  }

  function perguntarModoEtiquetasRecebimento(rows) {
    return new Promise(function (resolve) {
      var modal = document.getElementById('modalEtqRecebimento');
      var btnOk = document.getElementById('modalEtqRecebContinuar');
      var btnNo = document.getElementById('modalEtqRecebCancelar');
      if (!modal || !btnOk || !btnNo) {
        var promQtd =
          typeof window.promptPadrao === 'function'
            ? window.promptPadrao('Etiquetas por item (1 = uma por linha; vazio = cancelar):', {
                title: 'Imprimir etiquetas',
                initial: '1',
                type: 'number',
                confirmText: 'Continuar',
              })
            : Promise.resolve(window.prompt('Etiquetas por item (1 = uma por linha; vazio = cancelar):', '1'));
        promQtd.then(function (qtd) {
          if (qtd == null || String(qtd).trim() === '') {
            resolve(null);
            return;
          }
          var n = parseInt(String(qtd).trim(), 10);
          if (!Number.isFinite(n) || n < 1) {
            resolve({ modo: 'linha', qtdFixa: 1 });
            return;
          }
          if (n === 1) resolve({ modo: 'linha', qtdFixa: 1 });
          else resolve({ modo: 'fixo', qtdFixa: Math.min(n, WMS_ETQ_MAX_POR_ITEM) });
        });
        return;
      }
      var wrapFixo = document.getElementById('etqModoFixoWrap');
      var wrapPers = document.getElementById('etqModoPersonalizadoWrap');
      var inpFixo = document.getElementById('etqQtdFixaPorLinha');
      var inpAplicarTodas = document.getElementById('etqPersAplicarTodas');
      var btnAplicarTodas = document.getElementById('etqPersBtnAplicarTodas');
      var contentEtq = modal.querySelector('.modal-content--etq');
      var radios = modal.querySelectorAll('input[name="etqModoReceb"]');
      if (radios.length) radios[0].checked = true;
      if (inpFixo) inpFixo.value = '1';
      renderTabelaEtqPersonalizado(rows);
      function syncModoEtqWrap() {
        var el = modal.querySelector('input[name="etqModoReceb"]:checked');
        var v = el ? el.value : 'linha';
        var isFixo = v === 'fixo';
        var isPers = v === 'personalizado';
        if (wrapFixo) {
          wrapFixo.classList.toggle('ativo', isFixo);
          wrapFixo.setAttribute('aria-hidden', isFixo ? 'false' : 'true');
        }
        if (wrapPers) {
          wrapPers.classList.toggle('ativo', isPers);
          wrapPers.setAttribute('aria-hidden', isPers ? 'false' : 'true');
        }
        if (contentEtq) contentEtq.classList.toggle('etq-modal-wide', isPers);
        if (inpFixo) inpFixo.disabled = !isFixo;
        modal.querySelectorAll('.etq-pers-qtd').forEach(function (inp) {
          inp.disabled = !isPers;
        });
        if (inpAplicarTodas) inpAplicarTodas.disabled = !isPers;
        if (btnAplicarTodas) btnAplicarTodas.disabled = !isPers;
      }
      function onAplicarTodasPers() {
        var n = inpAplicarTodas ? parseInt(String(inpAplicarTodas.value || '').trim(), 10) : NaN;
        if (!Number.isFinite(n) || n < 0) {
          showMessage('Informe de 0 a ' + WMS_ETQ_MAX_POR_ITEM + ' etiquetas.', 'error');
          return;
        }
        if (n > WMS_ETQ_MAX_POR_ITEM) {
          showMessage('Máximo ' + WMS_ETQ_MAX_POR_ITEM + ' por linha.', 'error');
          return;
        }
        modal.querySelectorAll('.etq-pers-qtd').forEach(function (inp) {
          inp.value = String(n);
        });
      }
      syncModoEtqWrap();
      radios.forEach(function (rd) {
        rd.addEventListener('change', syncModoEtqWrap);
      });
      if (btnAplicarTodas) btnAplicarTodas.addEventListener('click', onAplicarTodasPers);
      if (modal.parentNode !== document.body) document.body.appendChild(modal);
      modal.style.display = 'flex';
      modal.style.zIndex = '100000';
      function fechar(val) {
        modal.style.display = 'none';
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        radios.forEach(function (rd) {
          rd.removeEventListener('change', syncModoEtqWrap);
        });
        if (btnAplicarTodas) btnAplicarTodas.removeEventListener('click', onAplicarTodasPers);
        resolve(val);
      }
      function modoSel() {
        var el = modal.querySelector('input[name="etqModoReceb"]:checked');
        var v = el ? el.value : 'linha';
        if (v === 'qtd') return { modo: 'qtd', qtdFixa: 1, qtdPorItem: null };
        if (v === 'personalizado') {
          var map = lerQtdPorItemPersonalizado(modal);
          var soma = 0;
          Object.keys(map).forEach(function (k) {
            soma += map[k] || 0;
          });
          if (soma < 1) {
            showMessage('Informe pelo menos 1 etiqueta em algum item (ou use outro modo).', 'error');
            return null;
          }
          return { modo: 'personalizado', qtdFixa: 1, qtdPorItem: map };
        }
        if (v === 'fixo') {
          var n = inpFixo ? parseInt(String(inpFixo.value || '').trim(), 10) : NaN;
          if (!Number.isFinite(n) || n < 1) {
            showMessage('Informe de 1 a ' + WMS_ETQ_MAX_POR_ITEM + ' etiquetas por item.', 'error');
            return null;
          }
          if (n > WMS_ETQ_MAX_POR_ITEM) {
            showMessage('Máximo ' + WMS_ETQ_MAX_POR_ITEM + ' etiquetas por item.', 'error');
            return null;
          }
          return { modo: 'fixo', qtdFixa: n, qtdPorItem: null };
        }
        return { modo: 'linha', qtdFixa: 1, qtdPorItem: null };
      }
      function onOk() {
        var sel = modoSel();
        if (!sel) return;
        fechar(sel);
      }
      function onNo() {
        fechar(null);
      }
      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);
    });
  }

  function montarHtmlEtiquetaRecebimento(r, doc, ctx, seqInfo) {
    var chave = ctx.chave;
    var nfRef = ctx.nfRef;
    var dhChegada = ctx.dhChegada;
    var donoTxt = ctx.donoTxt;
    var cdDono = ctx.cdDono;
    var maskProdEtq = ctx.maskProdEtq;
    var byCodigo = ctx.byCodigo;
    var byCodigoUn = ctx.byCodigoUn;
    var confEtq = ctx.confEtq;
    var suf = chave.length >= 8 ? chave.slice(-8) : chave;
    var codInt = String(r.codigoProduto || '').trim();
    var titCod = codInt || 'NF ' + String(r.cProd || '');
    var titCodView = codInt && maskProdEtq ? reidratarCodigoPorMascara(codInt, maskProdEtq) : titCod;
    var descForn = String(r.xProd || '').trim();
    var descInterna = byCodigo.get(codInt) || '';
    var undEstoque = byCodigoUn.get(codInt) || '';
    var loteTxt = String(r.lote || '').trim() || 'UNICO';
    var validadeTxt = formatDataValidade(String(r.validade || '').trim()) || '—';
    var qtdNfTxt = formatQtdEtiqueta(r.qtdRecebida);
    var qtdEstoqueTxt = formatQtdEtiqueta(r.qtdConvertida);
    var umNf = String(r.uCom || '').trim().toUpperCase();
    var umEstoque = undEstoque || umNf;
    var volTxt = '—';
    if (qtdEstoqueTxt) volTxt = qtdEstoqueTxt + (umEstoque ? ' ' + umEstoque : '');
    if (qtdNfTxt) volTxt += (volTxt === '—' ? '' : ' | ') + qtdNfTxt + (umNf ? ' ' + umNf : '');
    var rodape = 'NF ' + nfRef + ' • Item ' + r.nItem;
    if (seqInfo && seqInfo.total > 1) rodape += ' • Etq. ' + seqInfo.atual + '/' + seqInfo.total;
    if (suf) rodape += ' • …' + suf;
    if (confEtq) rodape += ' • Conf.: ' + confEtq;
    return (
      '<div class="label">' +
      '<div class="etq-top">' +
      '<div>' +
      '<div class="cod">' +
      escapeHtml(titCodView) +
      '</div>' +
      '<div class="desc">' +
      '<div class="forn">' +
      escapeHtml((descForn || 'Sem descrição fornecedor').slice(0, 120)) +
      '</div>' +
      '<div class="int">' +
      escapeHtml((descInterna || descForn || 'Sem descrição interna').slice(0, 120)) +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="meta">' +
      '<div>Nota fiscal</div><div class="nf">' +
      escapeHtml(doc.NUMERO_NF || '') +
      '</div>' +
      '<div class="dt">Emissão</div><div class="dtv">' +
      escapeHtml(formatDataNf(doc.DH_EMISSAO) || '—') +
      '</div>' +
      '<div class="dt">Chegada</div><div class="dtv">' +
      escapeHtml(dhChegada || '—') +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="etq-mid">' +
      '<div class="vol"><small>Vol.</small>' +
      escapeHtml(volTxt) +
      '</div>' +
      '<div class="validade">Validade<div class="v">' +
      escapeHtml(validadeTxt) +
      '</div></div>' +
      '</div>' +
      '<div class="etq-bars">' +
      '<div class="bars-row">' +
      '<div class="bar-wrap"><svg class="bc-svg" role="img" aria-label="barcode chave" data-bc="' +
      escapeHtml(chave || nfRef || '-') +
      '"></svg></div>' +
      '<div class="bar-wrap"><svg class="bc-svg" role="img" aria-label="barcode produto" data-bc="' +
      escapeHtml(codInt || titCod || '-') +
      '"></svg></div>' +
      '</div>' +
      '<div class="dono-lote">' +
      '<div class="dono">Dono do estoque<div class="nome">' +
      escapeHtml((donoTxt || (Number.isFinite(cdDono) ? 'CD ' + cdDono : '—')).toUpperCase()) +
      '</div></div>' +
      '<div class="lote">Lote<div class="valor">' +
      escapeHtml(loteTxt) +
      '</div></div>' +
      '</div>' +
      '</div>' +
      '<div style="font-size:10pt;margin-top:1mm;text-align:left;">' +
      escapeHtml(rodape) +
      '</div>' +
      '</div>'
    );
  }

  function abrirImpressaoEtiquetas() {
    if (!detalheDocAtual || !detalheDocAtual.CD_NFE) {
      showMessage('Abra o detalhe de uma NF-e primeiro.', 'error');
      return;
    }
    var rows = readConferenciaLinhasCompletasFromDom().filter(function (r) {
      var hasCod = String(r.codigoProduto || '').trim() !== '';
      var qr = String(r.qtdRecebida || '').trim();
      var q = Number(qr.replace(',', '.'));
      var hasQtd = qr !== '' && Number.isFinite(q) && q >= 0;
      var hasLote = String(r.lote || '').trim() !== '';
      var hasVal = String(r.validade || '').trim() !== '';
      return hasCod || hasQtd || hasLote || hasVal;
    });
    if (!rows.length) {
      showMessage(
        'Informe em pelo menos um item: quantidade recebida, lote, validade ou código do dono — para gerar etiquetas.',
        'error'
      );
      return;
    }
    perguntarModoEtiquetasRecebimento(rows).then(function (escolha) {
      if (!escolha) return;
      var modo = escolha.modo || 'linha';
      var qtdFixa = escolha.qtdFixa != null ? escolha.qtdFixa : 1;
      var qtdPorItem = escolha.qtdPorItem || null;
      var totalPrev = contarEtiquetasPrevistas(rows, modo, qtdFixa, qtdPorItem);
      if (totalPrev > WMS_ETQ_MAX_TOTAL) {
        showMessage(
          'Seriam ' +
            totalPrev +
            ' etiquetas (limite ' +
            WMS_ETQ_MAX_TOTAL +
            '). Reduza a quantidade por item ou divida a impressão.',
          'error'
        );
        return;
      }
      var doc = detalheDocAtual;
      var cdDono = doc.CD_DONO != null && String(doc.CD_DONO).trim() !== '' ? parseInt(doc.CD_DONO, 10) : null;
      obterNomeDono(cdDono).then(function (donoTxt) {
        var chave = String(doc.CHAVE_NFE || '').replace(/\s/g, '');
        var nfRef = (doc.NUMERO_NF || '') + '/' + (doc.SERIE || '');
        var dhChegada = (function () {
          var iso = docDtRecebimentoIso(doc);
          if (iso) {
            var p = iso.split('-');
            if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
          }
          var tela = lerDtRecebimentoTela();
          if (tela) {
            var p2 = tela.split('-');
            if (p2.length === 3) return p2[2] + '/' + p2[1] + '/' + p2[0];
          }
          if (doc.DH_CONFERENCIA) return formatDataNf(doc.DH_CONFERENCIA);
          return '—';
        })();
        var maskProdEtq = getMaskProdutoDonoAtual();
        var byCodigo = new Map();
        (produtosDonoAtual || []).forEach(function (p) {
          var c = String(p.CODIGO || '').trim();
          if (!c) return;
          if (!byCodigo.has(c)) byCodigo.set(c, String(p.NOME || '').trim());
        });
        var byCodigoUn = new Map();
        (produtosDonoAtual || []).forEach(function (p) {
          var c = String(p.CODIGO || '').trim();
          if (!c) return;
          if (!byCodigoUn.has(c)) byCodigoUn.set(c, String(p.UNIDADE || '').trim().toUpperCase());
        });
        var ctx = {
          chave: chave,
          nfRef: nfRef,
          dhChegada: dhChegada,
          donoTxt: donoTxt,
          cdDono: cdDono,
          maskProdEtq: maskProdEtq,
          byCodigo: byCodigo,
          byCodigoUn: byCodigoUn,
          confEtq: getConferenteNome(),
        };
        var etiquetas = [];
        rows.forEach(function (r) {
          var n = etiquetasPorLinhaReceb(modo, r, qtdFixa, qtdPorItem);
          for (var ei = 1; ei <= n; ei++) {
            etiquetas.push(
              montarHtmlEtiquetaRecebimento(r, doc, ctx, n > 1 ? { atual: ei, total: n } : null)
            );
          }
        });
        var html = '';
        for (var si = 0; si < etiquetas.length; si += 2) {
          html +=
            '<div class="etq-sheet">' + etiquetas[si] + (etiquetas[si + 1] != null ? etiquetas[si + 1] : '') + '</div>';
        }
        var titulo = 'Etiquetas — NF ' + (doc.NUMERO_NF || '');
        if (etiquetas.length > rows.length) titulo += ' (' + etiquetas.length + ' etiquetas)';
        abrirJanelaImpressao(html, titulo, 'etiquetas');
      });
    });
  }

  function fillDonoSelects() {
    fetch('/api/wms/donos-estoque', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        donosEstoqueCache = rows;
        ['filtro_cd_dono', 'import_cd_dono', 'recTrocarDonoSelect'].forEach(function (id) {
          var sel = document.getElementById(id);
          if (!sel) return;
          var v = sel.value;
          var placeholder =
            id === 'filtro_cd_dono' ? 'Todos' : id === 'recTrocarDonoSelect' ? '— Selecione —' : '—';
          sel.innerHTML = '<option value="">' + placeholder + '</option>';
          rows.forEach(function (d) {
            var o = document.createElement('option');
            o.value = String(d.CD_DONO);
            o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
            sel.appendChild(o);
          });
          if (v && Array.prototype.some.call(sel.options, function (x) { return x.value === v; })) sel.value = v;
        });
      })
      .catch(function () {});
  }

  function buildQuery() {
    var p = new URLSearchParams();
    var d = document.getElementById('filtro_cd_dono');
    var ch = document.getElementById('filtro_chave');
    var n = document.getElementById('filtro_numero');
    if (d && d.value) p.append('cdDono', d.value);
    if (ch && ch.value) p.append('chave', ch.value.replace(/\D/g, ''));
    if (n && n.value) p.append('numero', n.value.trim());
    var dDe = document.getElementById('filtro_dt_receb_de');
    var dAte = document.getElementById('filtro_dt_receb_ate');
    if (dDe && dDe.value) p.append('dtRecebDe', dDe.value);
    if (dAte && dAte.value) p.append('dtRecebAte', dAte.value);
    var farol = document.getElementById('filtro_status_farol');
    if (farol && farol.value) p.append('statusFarol', farol.value);
    return p.toString();
  }

  async function exportarListaNfCsv(modoItens) {
    var itens = !!modoItens;
    showLoadingOverlay(
      'Exportando',
      itens ? 'Gerando CSV com itens das NF-e…' : 'Gerando CSV das NF-e importadas…',
      'Mesmos filtros da tela (até 10.000 NF-e).'
    );
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var q = buildQuery();
      var base =
        (typeof window.corrigirUrl === 'function'
          ? window.corrigirUrl('/api/wms/recebimento/documentos/exportacao')
          : '/api/wms/recebimento/documentos/exportacao') +
        '?formato=' +
        (itens ? 'csv-itens' : 'csv') +
        (q ? '&' + q : '');
      var res = await fetch(base, { headers: getAuthHeaders() });
      if (!res.ok) {
        var errBody = await res.json().catch(function () {
          return {};
        });
        throw new Error((errBody && errBody.error) || res.statusText || 'HTTP ' + res.status);
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var cd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = itens ? 'wms-recebimento-entrada-itens-' + cd + '.csv' : 'wms-recebimento-nf-' + cd + '.csv';
      a.click();
      URL.revokeObjectURL(url);
      showMessage('Download do CSV iniciado.', 'success');
    } catch (e) {
      showMessage(e.message || 'Erro ao exportar CSV.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function applyFilters(openTab) {
    showLoadingOverlay('Carregando', 'Buscando NF-e importadas...', 'Aguarde.');
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var q = buildQuery();
      var r = await fetch('/api/wms/recebimento/documentos?' + q, { headers: getAuthHeaders() });
      var rows = await r.json();
      if (!r.ok) throw new Error((rows && rows.error) || r.statusText);
      lastRows = Array.isArray(rows) ? rows : [];
      gridLoaded = true;
      var c = document.getElementById('wmsRecGridCountText');
      if (c) c.textContent = String(lastRows.length) + ' registro(s) encontrado(s).';
      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (e) {}
      }
      disposeGrid();
      inicializarGridTab();
      if (gridTab) gridTab.render(lastRows);
      await showTab(openTab || 'grid');
    } catch (e) {
      showMessage(e.message || 'Erro ao listar.', 'error');
      await showTab('filtros');
    } finally {
      hideLoadingOverlay();
    }
  }

  function mostrarPainelImportar() {
    ocultarPainelLiberacaoValidade();
    document.getElementById('painelImportar').style.display = 'block';
    document.getElementById('painelDetalhe').style.display = 'none';
    var t = document.getElementById('tituloDados');
    if (t) t.style.display = 'block';
    document.getElementById('import_arquivo').value = '';
  }

  function limparFiltrosRestritivosParaChave(ch44) {
    var chEl = document.getElementById('filtro_chave');
    if (chEl) chEl.value = ch44 || '';
    var d = document.getElementById('filtro_cd_dono');
    if (d) d.value = '';
    var fd = document.getElementById('filtro_dt_receb_de');
    var fa = document.getElementById('filtro_dt_receb_ate');
    if (fd) fd.value = '';
    if (fa) fa.value = '';
    var fs = document.getElementById('filtro_status_farol');
    if (fs) fs.value = '';
  }

  function tratarNfeJaImportada(body, chaveFallback) {
    var ex = body && body.existing;
    var ch = '';
    if (ex && ex.CHAVE_NFE) ch = String(ex.CHAVE_NFE).replace(/\D/g, '');
    else if (chaveFallback) ch = String(chaveFallback).replace(/\D/g, '');
    if (ch.length > 44) ch = ch.slice(-44);
    if (ch.length === 44) limparFiltrosRestritivosParaChave(ch);
    var msg = (body && body.error) || 'Esta NF-e já foi importada.';
    if (ex && ex.CD_NFE != null) {
      msg += ' Abrindo registro #' + String(ex.CD_NFE) + '…';
      showMessage(msg, 'info');
      return abrirDetalhe(ex.CD_NFE).then(function () {
        return showTab('dados');
      });
    }
    if (ch.length === 44) {
      showMessage(msg + ' Buscando pela chave…', 'info');
      return fetch('/api/wms/recebimento/documentos/por-chave/' + encodeURIComponent(ch), {
        headers: getAuthHeaders(),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (row) {
          if (row && row.CD_NFE != null) {
            return abrirDetalhe(row.CD_NFE).then(function () {
              return showTab('dados');
            });
          }
          return applyFilters('grid');
        })
        .catch(function (e) {
          showMessage((e && e.message) || msg, 'error');
        });
    }
    showMessage(msg + ' Informe a chave completa (44 dígitos) em Filtros.', 'error');
  }

  async function init() {
    if (initFeito) return;
    initFeito = true;
    await new Promise(function (r) {
      setTimeout(r, 120);
    });
    fillDonoSelects();
    if (WMS_REC_CROSSDOCK_UI_ENABLED) {
      carregarLotesCrossdock().catch(function () {});
    }
    await showTab('filtros');
  }

  document.getElementById('btnVoltarHub') &&
    document.getElementById('btnVoltarHub').addEventListener('click', function () {
      if (window.parent && typeof window.parent.loadModuleContent === 'function') {
        window.parent.loadModuleContent('estoque');
      }
    });

  document.querySelectorAll('.wms-rec-container .tabs .tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      showTab(b.getAttribute('data-tab'));
    });
  });

  document.getElementById('filtroForm').addEventListener('submit', function (e) {
    e.preventDefault();
    applyFilters('grid');
  });
  var btnExportLista = document.getElementById('btnExportarListaNf');
  if (btnExportLista) {
    btnExportLista.addEventListener('click', function () {
      exportarListaNfCsv(false);
    });
  }
  var btnExportListaGrid = document.getElementById('btnExportarListaNfGrid');
  if (btnExportListaGrid) {
    btnExportListaGrid.addEventListener('click', function () {
      exportarListaNfCsv(false);
    });
  }
  var btnExportItens = document.getElementById('btnExportarListaNfItens');
  if (btnExportItens) {
    btnExportItens.addEventListener('click', function () {
      exportarListaNfCsv(true);
    });
  }
  var btnExportItensGrid = document.getElementById('btnExportarListaNfItensGrid');
  if (btnExportItensGrid) {
    btnExportItensGrid.addEventListener('click', function () {
      exportarListaNfCsv(true);
    });
  }
  document.getElementById('btnLimparFiltros').addEventListener('click', function () {
    document.getElementById('filtro_cd_dono').value = '';
    document.getElementById('filtro_chave').value = '';
    document.getElementById('filtro_numero').value = '';
    var fd = document.getElementById('filtro_dt_receb_de');
    var fa = document.getElementById('filtro_dt_receb_ate');
    if (fd) fd.value = '';
    if (fa) fa.value = '';
    var fs = document.getElementById('filtro_status_farol');
    if (fs) fs.value = '';
  });
  var btnHistEnvVenc = document.getElementById('btnAtualizarHistoricoEnvioVenc');
  if (btnHistEnvVenc) {
    btnHistEnvVenc.addEventListener('click', function () {
      carregarHistoricoEnviosVencimento({ silencioso: false });
    });
  }
  document.getElementById('btnNovoRegistro').addEventListener('click', function () {
    mostrarPainelImportar();
    showTab('dados');
  });
  document.getElementById('btnNovoRegistroGrid').addEventListener('click', function () {
    mostrarPainelImportar();
    showTab('dados');
  });
  document.getElementById('btnVoltarGrid').addEventListener('click', function () {
    showTab('filtros');
  });
  document.getElementById('btnCancelarImport').addEventListener('click', function () {
    showTab('grid');
  });
  document.getElementById('btnFecharDetalhe').addEventListener('click', function () {
    ocultarPainelLiberacaoValidade();
    mostrarPainelImportar();
    showTab('grid');
  });
  document.getElementById('btnTrocarDonoReceb') &&
    document.getElementById('btnTrocarDonoReceb').addEventListener('click', function () {
      executarTrocarDonoReceb(false);
    });
  document.getElementById('btnImprimirListaConferencia') &&
    document.getElementById('btnImprimirListaConferencia').addEventListener('click', function () {
      abrirImpressaoListaConferencia();
    });
  document.getElementById('btnImprimirEtiquetas') &&
    document.getElementById('btnImprimirEtiquetas').addEventListener('click', function () {
      abrirImpressaoEtiquetas();
    });
  function salvarConferencia(tentouCadastroAuto, opts) {
    opts = opts || {};
    if (!detalheDocAtual || !detalheDocAtual.CD_NFE) {
      showMessage('Selecione uma NF-e para conferência.', 'error');
      return Promise.resolve();
    }
    if (isDocEncerrado(detalheDocAtual)) {
      showMessage('NF-e encerrada. Reabra para permitir alterações.', 'error');
      return Promise.resolve();
    }
    var nmConf = document.getElementById('wmsRecConferenteNome');
    var nmConfTxt = nmConf ? String(nmConf.value || '').trim() : '';
    if (!nmConfTxt) {
      showMessage('Informe o nome do conferente para salvar a conferência.', 'error', null, 'wmsRecConferenteNome');
      if (nmConf && typeof nmConf.focus === 'function') nmConf.focus();
      return Promise.resolve();
    }
    var camposLib = null;
    if (opts.comLiberacao) {
      camposLib = validarCamposLiberacaoValidadeModal();
      if (!camposLib) return Promise.resolve();
    }
    var itens = coletarConferencia();
    return validarConferenciaLocalAsync(itens).then(function (errosLocais) {
      if (errosLocais.length) {
        showMessage(errosLocais[0], 'error');
        return Promise.resolve();
      }
      return salvarConferenciaContinuar(tentouCadastroAuto, opts, itens, nmConfTxt, camposLib);
    });
  }

  function salvarConferenciaContinuar(tentouCadastroAuto, opts, itens, nmConfTxt, camposLib) {
    opts = opts || {};
    var dtRecTxt = lerDtRecebimentoTela();
    var bodyObj = {
      itens: itens,
      nmConferente: nmConfTxt.slice(0, 120),
      dtRecebimento: dtRecTxt || null,
    };
    if (opts.comLiberacao && camposLib) {
      bodyObj.ignorarPoliticaValidadeMin = true;
      bodyObj.justificativaBloqueio = camposLib.justificativa;
      bodyObj.autorizadoLogin = camposLib.autorizadoLogin;
      bodyObj.autorizadoSenha = camposLib.autorizadoSenha;
    }
    showLoadingOverlay('Salvando', 'Persistindo conferência dos itens...', 'Aguarde.');
    return fetch('/api/wms/recebimento/documentos/' + encodeURIComponent(detalheDocAtual.CD_NFE) + '/conferencia', {
      method: 'PUT',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(bodyObj),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var e = new Error((j && j.error) || r.statusText);
            e.status = r.status;
            e.body = j || {};
            throw e;
          }
          return j;
        });
      })
      .then(function (resp) {
        ocultarPainelLiberacaoValidade();
        var dep = (resp && resp.depara) || {};
        var msg = 'Conferência salva. Itens conferidos: ' + String(resp.itensConferidos || 0);
        if (Number(dep.inseridos || 0) > 0 || Number(dep.atualizados || 0) > 0) {
          msg +=
            '. De-para: ' +
            String(dep.inseridos || 0) +
            ' inserido(s), ' +
            String(dep.atualizados || 0) +
            ' atualizado(s)';
        }
        showMessage(msg, 'success');
        if (detalheDocAtual && resp.conferencia) {
          if (resp.conferencia.NM_CONFERENTE !== undefined) detalheDocAtual.NM_CONFERENTE = resp.conferencia.NM_CONFERENTE;
          if (resp.conferencia.FG_CONFERIDO !== undefined) detalheDocAtual.FG_CONFERIDO = resp.conferencia.FG_CONFERIDO;
          if (resp.conferencia.DT_RECEBIMENTO !== undefined) detalheDocAtual.DT_RECEBIMENTO = resp.conferencia.DT_RECEBIMENTO;
        }
        if (detalheDocAtual && dtRecTxt) detalheDocAtual.DT_RECEBIMENTO = dtRecTxt;
        var cdRec = detalheDocAtual && detalheDocAtual.CD_NFE;
        return applyFilters('grid').then(function () {
          if (cdRec) return abrirDetalhe(cdRec);
        });
      })
      .catch(function (err) {
        if (
          err &&
          err.status === 422 &&
          err.body &&
          err.body.errorKey === 'wms.recebimento.validadeAbaixoMinimo'
        ) {
          mostrarPainelLiberacaoValidade('conferencia', err.body);
          return null;
        }
        if (opts.comLiberacao && err && (err.status === 401 || err.status === 403)) {
          showMessage((err && err.message) || 'Autorização negada.', 'error');
          return null;
        }
        var msg = err && err.message ? err.message : 'Erro ao salvar conferência.';
        if (!tentouCadastroAuto) {
          return tentarCadastrarProdutoInexistente(msg).then(function (cadastrou) {
            if (cadastrou) return salvarConferencia(true, opts);
            showMessage(msg, 'error');
            return null;
          });
        }
        showMessage(msg, 'error');
        return null;
      })
      .finally(function () {
        hideLoadingOverlay();
      });
  }

  document.getElementById('modalCadProdRecebCancelar') &&
    document.getElementById('modalCadProdRecebCancelar').addEventListener('click', fecharModalCadastroProdutoReceb);
  document.getElementById('modalCadProdRecebSalvar') &&
    document.getElementById('modalCadProdRecebSalvar').addEventListener('click', function () {
      salvarCadastroProdutoRecebimentoModal();
    });
  var hostLinhasCad = document.getElementById('wmsRecDetalheLinhas');
  if (hostLinhasCad) {
    hostLinhasCad.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-rec-cad-prod');
      if (!btn) return;
      var tr = btn.closest('tr[data-nitem]');
      if (tr) abrirModalCadastroProdutoReceb(tr);
    });
  }

  document.getElementById('btnSalvarConferencia').addEventListener('click', function () {
    salvarConferencia(false, {});
  });
  var btnLibSalvar = document.getElementById('wmsRecLibConfirmarSalvar');
  if (btnLibSalvar) {
    btnLibSalvar.addEventListener('click', function () {
      if (!validarCamposLiberacaoValidadeModal()) return;
      salvarConferencia(false, { comLiberacao: true });
    });
  }
  if (WMS_REC_CROSSDOCK_UI_ENABLED) {
  document.getElementById('btnCriarLoteCrossdock') &&
    document.getElementById('btnCriarLoteCrossdock').addEventListener('click', function () {
      var codigoEl = document.getElementById('crossdock_codigo');
      var nomeEl = document.getElementById('crossdock_nome');
      var janelaEl = document.getElementById('crossdock_janela');
      var obsEl = document.getElementById('crossdock_obs');
      var codigo = String(codigoEl && codigoEl.value ? codigoEl.value : '').trim();
      if (!codigo) {
        showMessage('Informe o código do lote crossdock.', 'error');
        if (codigoEl) codigoEl.focus();
        return;
      }
      showLoadingOverlay('Crossdock', 'Criando lote...', 'Aguarde.');
      fetch('/api/wms/recebimento/crossdock/lotes', {
        method: 'POST',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          codigo: codigo,
          nome: nomeEl ? String(nomeEl.value || '').trim() : '',
          dhJanelaExpedicao: janelaEl && janelaEl.value ? janelaEl.value : null,
          observacao: obsEl ? String(obsEl.value || '').trim() : '',
        }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function () {
          showMessage('Lote crossdock criado com sucesso.', 'success');
          if (codigoEl) codigoEl.value = '';
          if (nomeEl) nomeEl.value = '';
          if (janelaEl) janelaEl.value = '';
          if (obsEl) obsEl.value = '';
          return carregarLotesCrossdock();
        })
        .catch(function (e) {
          showMessage((e && e.message) || 'Erro ao criar lote crossdock.', 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });
  document.getElementById('btnAtualizarLotesCrossdock') &&
    document.getElementById('btnAtualizarLotesCrossdock').addEventListener('click', function () {
      carregarLotesCrossdock()
        .then(function () {
          showMessage('Lotes crossdock atualizados.', 'info');
        })
        .catch(function (e) {
          showMessage((e && e.message) || 'Erro ao atualizar lotes.', 'error');
        });
    });
  document.getElementById('btnVincularNfesLote') &&
    document.getElementById('btnVincularNfesLote').addEventListener('click', function () {
      var loteSel = document.getElementById('crossdock_lote_select');
      var nfesEl = document.getElementById('crossdock_nfes');
      var cdLote = loteSel ? parseInt(loteSel.value, 10) : NaN;
      if (!Number.isFinite(cdLote)) {
        showMessage('Selecione o lote crossdock.', 'error');
        return;
      }
      var refs = parseReferenciasAnexoLote(nfesEl ? nfesEl.value : '');
      if (!refs.length) {
        showMessage('Informe CD_NFE ou chave da NF-e (44 dígitos) para anexar.', 'error');
        return;
      }
      showLoadingOverlay('Crossdock', 'Anexando NF-e ao lote...', 'Aguarde.');
      fetch('/api/wms/recebimento/crossdock/lotes/' + encodeURIComponent(cdLote) + '/vincular-nfes', {
        method: 'PUT',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cdNfes: refs }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (resp) {
          showMessage('NF-e anexadas no lote: ' + String(resp.vinculados || 0) + ' de ' + String(resp.solicitados || 0), 'success');
          if (nfesEl) nfesEl.value = '';
          return carregarLotesCrossdock();
        })
        .catch(function (e) {
          showMessage((e && e.message) || 'Erro ao anexar NF-e no lote.', 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });
  document.getElementById('btnMudarFaseLote') &&
    document.getElementById('btnMudarFaseLote').addEventListener('click', function () {
      var loteSel = document.getElementById('crossdock_lote_select');
      var faseSel = document.getElementById('crossdock_fase');
      var cdLote = loteSel ? parseInt(loteSel.value, 10) : NaN;
      var fase = faseSel ? String(faseSel.value || '').trim() : '';
      if (!Number.isFinite(cdLote)) {
        showMessage('Selecione o lote crossdock.', 'error');
        return;
      }
      if (!fase) {
        showMessage('Informe a fase do lote.', 'error');
        return;
      }
      showLoadingOverlay('Crossdock', 'Atualizando fase do lote...', 'Aguarde.');
      fetch('/api/wms/recebimento/crossdock/lotes/' + encodeURIComponent(cdLote) + '/fase', {
        method: 'PUT',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fase: fase }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function () {
          showMessage('Fase do lote atualizada para ' + fase + '.', 'success');
          return carregarLotesCrossdock();
        })
        .catch(function (e) {
          showMessage((e && e.message) || 'Erro ao atualizar fase do lote.', 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });
  }
  function encerrarRecebimentoDoc(opts) {
    opts = opts || {};
    if (!detalheDocAtual || !detalheDocAtual.CD_NFE) return Promise.resolve();
    var nmConfEl = document.getElementById('wmsRecConferenteNome');
    var nmConfTxt = nmConfEl ? String(nmConfEl.value || '').trim() : '';
    if (!nmConfTxt) {
      showMessage('Informe o nome do conferente antes de encerrar a NF-e.', 'error', null, 'wmsRecConferenteNome');
      if (nmConfEl && typeof nmConfEl.focus === 'function') nmConfEl.focus();
      return Promise.resolve();
    }
    var dtRecTxt = lerDtRecebimentoTela();
    if (!dtRecTxt) {
      showMessage('Informe a data de recebimento (mercadoria na doca).', 'error', null, 'wmsRecDtRecebimento');
      var dtEl = document.getElementById('wmsRecDtRecebimento');
      if (dtEl && typeof dtEl.focus === 'function') dtEl.focus();
      return Promise.resolve();
    }
    var itensEnc = coletarConferencia();
    return validarConferenciaLocalAsync(itensEnc).then(function (errosEnc) {
      if (errosEnc.length) {
        showMessage(errosEnc[0], 'error');
        return Promise.resolve();
      }
      var extra = Object.assign({}, opts.extraBody || {}, {
        itens: itensEnc,
        nmConferente: nmConfTxt.slice(0, 120),
        dtRecebimento: dtRecTxt,
      });
      showLoadingOverlay('Encerrando', 'Aplicando trava de recebimento da NF-e...', 'Aguarde.');
      return fetch(
        '/api/wms/recebimento/documentos/' + encodeURIComponent(detalheDocAtual.CD_NFE) + '/encerrar',
        {
          method: 'PUT',
          headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
          body: JSON.stringify(extra),
        }
      )
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.error) || r.statusText);
            err.status = r.status;
            err.body = j || {};
            throw err;
          }
          return j;
        });
      })
      .then(function (resp) {
        ocultarPainelLiberacaoValidade();
        detalheDocAtual.ST_RECEBIMENTO = resp && resp.documento ? resp.documento.ST_RECEBIMENTO : 'ENCERRADA';
        showMessage('NF-e encerrada com sucesso. Edição bloqueada.', 'success');
        var cdEnc = detalheDocAtual && detalheDocAtual.CD_NFE;
        return applyFilters('grid').then(function () {
          if (cdEnc) return abrirDetalhe(cdEnc);
        });
      })
      .catch(function (e) {
        if (
          e &&
          e.status === 422 &&
          e.body &&
          e.body.errorKey === 'wms.recebimento.validadeAbaixoMinimo'
        ) {
          mostrarPainelLiberacaoValidade('encerrar', e.body);
          return null;
        }
        if (opts.extraBody && opts.extraBody.ignorarPoliticaValidadeMin && e && (e.status === 401 || e.status === 403)) {
          showMessage((e && e.message) || 'Autorização negada.', 'error');
          return null;
        }
        showMessage((e && e.message) || 'Erro ao encerrar recebimento.', 'error');
        return null;
      })
      .finally(function () {
        hideLoadingOverlay();
      });
    });
  }
  document.getElementById('btnEncerrarRecebimento') &&
    document.getElementById('btnEncerrarRecebimento').addEventListener('click', function () {
      if (!detalheDocAtual || !detalheDocAtual.CD_NFE) return;
      if (isDocEncerrado(detalheDocAtual)) {
        showMessage('NF-e já está encerrada.', 'error');
        return;
      }
      var itensPre = coletarConferencia();
      /** Trava anti-"NF encerrada em branco" (caso PIPOCA DOCE):
       *  qualquer item com produto preenchido precisa ter "Qtd recebida".
       *  Operador deve digitar 0 explicitamente se não recebeu. Salvar
       *  conferência em branco continua permitido — bloqueio é só aqui. */
      var semQtd = itensPre.filter(function (i) {
        var temProd = String(i.codigoProduto || '').trim() !== '';
        var qtd = String(i.qtdRecebida || '').trim();
        return temProd && qtd === '';
      });
      if (semQtd.length) {
        var amostra = semQtd.slice(0, 5).map(function (i) {
          return 'item ' + i.nItem + ' (' + i.codigoProduto + ')';
        }).join(', ');
        var sufixo = semQtd.length > 5 ? ' e mais ' + (semQtd.length - 5) : '';
        showMessage(
          'Não é possível encerrar: ' + semQtd.length + ' item(ns) sem "Qtd recebida" — ' +
          amostra + sufixo + '. Digite a quantidade (use 0 para confirmar que NÃO recebeu o item).',
          'error'
        );
        try {
          var host = document.getElementById('wmsRecDetalheLinhas');
          if (host) {
            var primeiroNItem = semQtd[0].nItem;
            var tr = host.querySelector('tbody tr[data-nitem="' + String(primeiroNItem).replace(/"/g, '\\"') + '"]');
            var inp = tr && tr.querySelector('[data-field="qtdRecebida"]');
            if (inp && typeof inp.focus === 'function') {
              inp.focus();
              if (typeof inp.select === 'function') inp.select();
            }
          }
        } catch (_) { /* foco best-effort */ }
        return;
      }
      validarConferenciaLocalAsync(itensPre).then(function (errosPre) {
        if (errosPre.length) {
          showMessage(errosPre[0], 'error');
          return;
        }
        var nmEl = document.getElementById('wmsRecConferenteNome');
        if (!nmEl || !String(nmEl.value || '').trim()) {
          showMessage('Informe o nome do conferente antes de encerrar a NF-e.', 'error', null, 'wmsRecConferenteNome');
          if (nmEl && typeof nmEl.focus === 'function') nmEl.focus();
          return;
        }
        confirmarPadrao(
          'Encerrar esta NF-e? Após encerrar, a conferência fica bloqueada até reabertura.',
          'Encerrar recebimento'
        ).then(function (ok) {
          if (!ok) return;
          return encerrarRecebimentoDoc({});
        });
      });
    });
  var btnLibEnc = document.getElementById('wmsRecLibConfirmarEncerrar');
  if (btnLibEnc) {
    btnLibEnc.addEventListener('click', function () {
      var campos = validarCamposLiberacaoValidadeModal();
      if (!campos) return;
      encerrarRecebimentoDoc({
        extraBody: {
          ignorarPoliticaValidadeMin: true,
          justificativaBloqueio: campos.justificativa,
          autorizadoLogin: campos.autorizadoLogin,
          autorizadoSenha: campos.autorizadoSenha,
        },
      });
    });
  }
  var btnLibCanc = document.getElementById('wmsRecLibCancelar');
  if (btnLibCanc) btnLibCanc.addEventListener('click', ocultarPainelLiberacaoValidade);
  document.getElementById('btnReabrirRecebimento') &&
    document.getElementById('btnReabrirRecebimento').addEventListener('click', function () {
      if (!detalheDocAtual || !detalheDocAtual.CD_NFE) return;
      solicitarTextoPadrao('Informe o motivo da reabertura:', 'Reabrir recebimento').then(function (motivo) {
        if (motivo == null) return;
        motivo = String(motivo || '').trim();
        if (!motivo) {
          showMessage('Informe o motivo da reabertura.', 'error');
          return;
        }
        showLoadingOverlay('Reabrindo', 'Removendo trava da NF-e...', 'Aguarde.');
        fetch('/api/wms/recebimento/documentos/' + encodeURIComponent(detalheDocAtual.CD_NFE) + '/reabrir', {
          method: 'PUT',
          headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ motivo: motivo }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok) throw new Error((j && j.error) || r.statusText);
              return j;
            });
          })
          .then(function (resp) {
            detalheDocAtual.ST_RECEBIMENTO = resp && resp.documento ? resp.documento.ST_RECEBIMENTO : 'REABERTA';
            atualizarEstadoRecebimentoUI(detalheDocAtual);
            showMessage('NF-e reaberta. Edição liberada.', 'success');
            return applyFilters('grid');
          })
          .catch(function (e) {
            showMessage((e && e.message) || 'Erro ao reabrir recebimento.', 'error');
          })
          .finally(function () {
            hideLoadingOverlay();
          });
      });
    });

  document.getElementById('importForm').addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (importSubmitting) return;
    importSubmitting = true;
    var btn = e.target.querySelector('button[type="submit"]');
    var lab = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Enviando...";
    }
    var fd = new FormData();
    var file = document.getElementById('import_arquivo').files[0];
    if (!file) {
      showMessage('Selecione o arquivo XML.', 'error');
      importSubmitting = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = lab;
      }
      return;
    }
    fd.append('arquivo', file);
    var cd = document.getElementById('import_cd_dono').value;
    if (cd) fd.append('CD_DONO', cd);

    showLoadingOverlay('Importando', 'Enviando e processando XML...', 'Aguarde.');
    fetch('/api/wms/recebimento/importar-xml', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: fd,
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.error) || r.statusText);
            err.httpStatus = r.status;
            err.body = j;
            throw err;
          }
          return j;
        });
      })
      .then(function (resp) {
        var msg = 'NF-e importada com sucesso.';
        if (resp && resp.donoOrigem === 'destinatario-cnpj' && resp.donoVinculado && resp.donoVinculado.CD_DONO) {
          msg +=
            ' Dono vinculado automaticamente pelo CNPJ do destinatário (CD ' +
            String(resp.donoVinculado.CD_DONO) +
            ').';
        }
        if (resp && resp.produtosImportados) {
          var p = resp.produtosImportados;
          msg +=
            ' Produtos do dono: ' +
            String(p.inseridos || 0) +
            ' inserido(s), ' +
            String(p.atualizados || 0) +
            ' atualizado(s), ' +
            String(p.ignorados || 0) +
            ' ignorado(s).';
        } else if (resp && resp.avisoProdutos) {
          msg += ' ' + String(resp.avisoProdutos);
        }
        showMessage(msg, 'success');
        return applyFilters('grid');
      })
      .catch(function (err) {
        if (err && err.httpStatus === 409) {
          var chFb = '';
          try {
            var fn = file && file.name ? String(file.name) : '';
            var m = fn.replace(/\D/g, '');
            if (m.length >= 44) chFb = m.slice(-44);
          } catch (_) {}
          return tratarNfeJaImportada(err.body, chFb).finally(function () {
            hideLoadingOverlay();
            setTimeout(function () {
              importSubmitting = false;
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = lab;
              }
            }, 600);
          });
        }
        showMessage((err && err.message) || 'Falha na importação.', 'error');
      })
      .finally(function () {
        hideLoadingOverlay();
        setTimeout(function () {
          importSubmitting = false;
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = lab;
          }
        }, 600);
      });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
