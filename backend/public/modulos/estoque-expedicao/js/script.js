(function () {
  var VALIDACAO_CLIENT_CACHE_MS = 180000;
  var state = {
    cargas: [],
    selecionada: null,
    donosCarga: [],
    nfesDetalheExp: [],
    validacaoEstoque: null,
    validacaoAtual: null,
    validacaoCarregadaCd: null,
    validacaoCarregadaEm: 0,
    liberacaoEstoqueAprovada: false,
  };
  var lastRenderedCargaId = null;
  var detalheValidacaoSeq = 0;
  var painelAlertTimer = null;
  var ultimaValidacaoBloqueada = null;
  var programaLiberacaoDivergencia = 'wms-expedicao-liberar-divergencia';
  var usuarioPodeLiberarDivergencia = false;
  var usuarioPodeReabrirExpedicao = false;

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

  function abrirImpressaoHtml(url) {
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (r) {
        return r.text().then(function (txt) {
          if (r.ok) return txt;
          var msg = txt || r.statusText || 'Erro ao gerar impressão.';
          try {
            var j = JSON.parse(txt);
            if (j && j.error) msg = j.error;
          } catch (_) {}
          throw new Error(msg);
        });
      })
      .then(function (html) {
        var w = window.open('', '_blank');
        if (!w) {
          showMessage('Permita janela pop-up para imprimir.', 'error', { autoHideMs: 8000 });
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
      })
      .catch(function (err) {
        showMessage(err.message || 'Erro ao gerar impressão.', 'error', { autoHideMs: 10000 });
      });
  }

  function byId(id) { return document.getElementById(id); }

  function showLoadingOverlay(titulo, texto, det) {
    var o = byId('loadingOverlay');
    if (!o) return;
    var a = byId('loadingTitle');
    var b = byId('loadingText');
    var c = byId('loadingDetalhe');
    if (a) a.textContent = titulo || 'Carregando';
    if (b) b.textContent = texto || 'Aguarde...';
    if (c) c.textContent = det || '';
    o.style.cssText =
      'display:flex !important; position:fixed !important; inset:0; z-index:99999; background:rgba(0,0,0,0.75); align-items:center; justify-content:center;';
  }

  function hideLoadingOverlay() {
    var o = byId('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  function bindIf(id, evt, fn) {
    var el = byId(id);
    if (el) el.addEventListener(evt, fn);
  }
  function txt(v) { return v == null || v === '' ? '-' : String(v); }

  /** Máscara do dono da carga (ex. Mana: 0.00.00.000.XX → 6.01.01.428.20). */
  function getMaskDonoCargaAtual() {
    var lista = state.donosCarga || [];
    for (var i = 0; i < lista.length; i++) {
      var mk = String(
        pick(lista[i], 'MASCARA_CODIGO_PRODUTO') ||
          lista[i].mascara_codigo_produto ||
          ''
      ).trim();
      if (mk) return mk;
    }
    return '';
  }

  /** Mesma regra do backend (wms-codigo-produto-mask.js / cadastros WMS). */
  function applyProductMask(value, mask) {
    var m = String(mask || '').trim().toUpperCase();
    if (!m) return String(value == null ? '' : value).trim();
    var src = String(value || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    if (!src) return String(value == null ? '' : value).trim();
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

  /**
   * Formata código OL/estoque com a máscara do dono.
   * Antes: agrupava de 2 em 2 da direita (6010142820 → 60.10.14.28.20) — ERRADO para Mana.
   */
  function maskCodigo(v) {
    var original = String(v == null ? '' : v).trim();
    if (!original) return '-';
    var mask = getMaskDonoCargaAtual();
    if (mask) return applyProductMask(original, mask) || original;
    var raw = original.replace(/[^0-9A-Za-z]/g, '');
    if (raw.length === 10) {
      return (
        raw.charAt(0) +
        '.' +
        raw.slice(1, 3) +
        '.' +
        raw.slice(3, 5) +
        '.' +
        raw.slice(5, 8) +
        '.' +
        raw.slice(8, 10)
      );
    }
    return original;
  }

  /** node-pg devolve colunas em minúsculas; aceita camelCase ou snake_case. */
  function pick(row, name) {
    if (!row) return null;
    var low = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    if (Object.prototype.hasOwnProperty.call(row, low)) return row[low];
    return null;
  }

  function trimPickVal(v) {
    if (v == null) return '';
    return String(v).trim();
  }

  /**
   * Nome do ponto de entrega/destino (prioridade negocial, espelha wms-nfe-saida-destino-display.service.js):
   * 1) XNOME_ENTREGA — unidade / local de entrega; 2) XNOME_DEST — destinatário; 3) logradouro+nº; 4) município/UF.
   */
  function nomeEntregaUnidadeOuLocalDestinoNfe(row) {
    if (!row) return '';
    var ne = trimPickVal(pick(row, 'XNOME_ENTREGA'));
    if (ne) return ne;
    var nd = trimPickVal(pick(row, 'XNOME_DEST'));
    if (nd) return nd;
    var log = trimPickVal(pick(row, 'XLGR_DEST'));
    var nro = trimPickVal(pick(row, 'NRO_DEST'));
    var end = [log, nro].filter(Boolean).join(', ');
    if (end) return end;
    var mun = trimPickVal(pick(row, 'XMUN_DEST'));
    var uf = trimPickVal(pick(row, 'UF_DEST'));
    return [mun, uf].filter(Boolean).join(' / ');
  }

  /**
   * Destino da NF-e (Expedição / Cargas): texto principal + “ — município/UF” quando distinto.
   */
  function formatLocalEntregaNfeRow(n) {
    if (!n) return '—';
    var nome = nomeEntregaUnidadeOuLocalDestinoNfe(n);
    var city = [pick(n, 'XMUN_DEST'), pick(n, 'UF_DEST')]
      .filter(function (x) {
        return x != null && String(x).trim() !== '';
      })
      .map(function (x) {
        return String(x).trim();
      })
      .join(' / ');
    if (!nome && !city) return '—';
    if (!nome) return city;
    if (!city) return nome;
    if (nome === city) return nome;
    return nome + ' — ' + city;
  }

  function donosDistintosDasNfesExp(nfes) {
    var map = {};
    (nfes || []).forEach(function (n) {
      var cd = Number(pick(n, 'CD_DONO'));
      if (!Number.isFinite(cd)) return;
      if (!map[cd]) map[cd] = { CD_DONO: cd, NM_DONO: 'Dono #' + cd };
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return a.CD_DONO - b.CD_DONO;
      });
  }
  function preencherSelectsDonoRomExp() {
    var lista = state.donosCarga.length ? state.donosCarga : donosDistintosDasNfesExp(state.nfesDetalheExp);
    ['exRomCdDonoExp', 'rsRomCdDonoExp'].forEach(function (sid) {
      var sel = byId(sid);
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = '';
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = 'Todos os donos';
      sel.appendChild(o0);
      lista.forEach(function (d) {
        var cd = Number(pick(d, 'CD_DONO'));
        if (!Number.isFinite(cd)) return;
        var nm = pick(d, 'NM_DONO');
        var opt = document.createElement('option');
        opt.value = String(cd);
        opt.textContent = String(nm != null && String(nm).trim() ? nm : 'Dono #' + cd);
        sel.appendChild(opt);
      });
      var ok = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) {
          ok = true;
          break;
        }
      }
      sel.value = ok ? prev : '';
    });
    popularFiltrosGeoRomExp('exRom');
    popularFiltrosGeoRomExp('rsRom');
    popularFiltroCodigoRomExp('exRom');
    popularFiltroCodigoRomExp('rsRom');
  }

  var romDestinosCacheExp = [];

  function romGeoIdExp(prefix, campo) {
    return prefix + campo + 'Exp';
  }

  function normChaveDestinoTextoExp(s) {
    return String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function chaveDestinoNfRowExp(row) {
    if (!row) return '';
    var uf = String(pick(row, 'UF_DEST') || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    var mun = normChaveDestinoTextoExp(pick(row, 'XMUN_DEST'));
    var nome = normChaveDestinoTextoExp(nomeEntregaUnidadeOuLocalDestinoNfe(row));
    var cnpj = String(pick(row, 'CNPJ_ENTREGA') || pick(row, 'CNPJ_DEST') || '').replace(/\D/g, '');
    return uf + '|' + mun + '|' + cnpj + '|' + nome;
  }

  function labelDestinoRomComboExp(row) {
    var nome = nomeEntregaUnidadeOuLocalDestinoNfe(row);
    if (nome) return nome;
    return formatLocalEntregaNfeRow(row);
  }

  function chaveUnidadeNfRowExp(row) {
    var cid = normChaveDestinoTextoExp(pick(row, 'XMUN_DEST'));
    var uf = String(pick(row, 'UF_DEST') || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    if (!cid && !uf) return '';
    return cid + '|' + uf;
  }

  function montarRomDestinosCacheExp() {
    var destMap = {};
    var destUnidades = {};
    (state.nfesDetalheExp || []).forEach(function (row) {
      var ch = chaveDestinoNfRowExp(row);
      if (!ch) return;
      var uk = chaveUnidadeNfRowExp(row);
      if (!destMap[ch]) {
        destMap[ch] = labelDestinoRomComboExp(row);
        destUnidades[ch] = {};
      }
      if (uk) destUnidades[ch][uk] = true;
    });
    romDestinosCacheExp = Object.keys(destMap)
      .sort(function (a, b) {
        return String(destMap[a]).localeCompare(String(destMap[b]), 'pt-BR');
      })
      .map(function (c) {
        return { value: c, label: destMap[c], unidades: destUnidades[c] || {} };
      });
  }

  function popularFiltrosGeoRomExp(prefix) {
    var selU = byId(romGeoIdExp(prefix, 'Unidade'));
    var selD = byId(romGeoIdExp(prefix, 'Destino'));
    if (!selU || !selD) return;
    montarRomDestinosCacheExp();
    var prevU = selU.value || '';
    var prevD = selD.value || '';
    var unidMap = {};
    (state.nfesDetalheExp || []).forEach(function (row) {
      var k = chaveUnidadeNfRowExp(row);
      if (!k || unidMap[k]) return;
      var cid = String(pick(row, 'XMUN_DEST') || '').trim();
      var uf = String(pick(row, 'UF_DEST') || '').trim();
      unidMap[k] = (cid + ' ' + uf).trim() || k.replace('|', '/');
    });
    var unidKeys = Object.keys(unidMap).sort(function (a, b) {
      return String(unidMap[a]).localeCompare(String(unidMap[b]), 'pt-BR');
    });
    selU.innerHTML = '<option value="">Todas as unidades</option>';
    unidKeys.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = unidMap[k];
      selU.appendChild(opt);
    });
    var okU = false;
    for (var i = 0; i < selU.options.length; i++) {
      if (selU.options[i].value === prevU) {
        okU = true;
        break;
      }
    }
    selU.value = okU ? prevU : '';
    aplicarFiltroDestinoRomExp(prefix, prevD);
    var contU = byId(romGeoIdExp(prefix, 'UnidContador'));
    if (contU) {
      contU.textContent = unidKeys.length ? '(' + unidKeys.length + ' na carga)' : '';
    }
  }

  function aplicarFiltroDestinoRomExp(prefix, preservarDestino) {
    var selU = byId(romGeoIdExp(prefix, 'Unidade'));
    var selD = byId(romGeoIdExp(prefix, 'Destino'));
    if (!selD) return;
    var unidSel = selU && selU.value ? selU.value : '';
    var prev = preservarDestino != null ? preservarDestino : selD.value || '';
    var visiveis = romDestinosCacheExp.filter(function (d) {
      if (!unidSel) return true;
      return !!(d.unidades && d.unidades[unidSel]);
    });
    selD.innerHTML = '<option value="">Todos os destinos</option>';
    visiveis.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.value;
      opt.textContent = d.label;
      selD.appendChild(opt);
    });
    var okD = false;
    for (var j = 0; j < selD.options.length; j++) {
      if (selD.options[j].value === prev) {
        okD = true;
        break;
      }
    }
    selD.value = okD ? prev : '';
    var contD = byId(romGeoIdExp(prefix, 'DestContador'));
    if (contD) {
      contD.textContent =
        unidSel && visiveis.length !== romDestinosCacheExp.length
          ? '(' + visiveis.length + ' de ' + romDestinosCacheExp.length + ')'
          : romDestinosCacheExp.length
            ? '(' + romDestinosCacheExp.length + ' na carga)'
            : '';
    }
  }

  function legendaComboRomExp(prefix, campo, vazio) {
    var sel = byId(romGeoIdExp(prefix, campo));
    if (!sel || !sel.value) return vazio || '';
    var opt = sel.options[sel.selectedIndex];
    var t = opt ? String(opt.textContent || '').trim() : '';
    if (!t || t.length <= 42) return t;
    return t.slice(0, 40) + '…';
  }

  function appendFiltrosGeoRomQueryExp(q, prefix) {
    var selU = byId(romGeoIdExp(prefix, 'Unidade'));
    var selD = byId(romGeoIdExp(prefix, 'Destino'));
    var selC = byId(romGeoIdExp(prefix, 'Codigo'));
    if (selU && selU.value) q.set('unidades', selU.value);
    if (selD && selD.value) q.set('destinos', selD.value);
    if (selC && selC.value) q.set('codigos', selC.value);
  }

  /** Produtos da carga (código + descrição) para o combo de filtro do romaneio. */
  function popularFiltroCodigoRomExp(prefix) {
    var sel = byId(romGeoIdExp(prefix, 'Codigo'));
    if (!sel) return;
    var prev = sel.value || '';
    var map = {};
    (state.nfesDetalheExp || []).forEach(function (row) {
      var linhas = parseLinhasJsonExp(pick(row, 'LINHAS_JSON') || pick(row, 'linhas_json') || pick(row, 'linhasJson'));
      linhas.forEach(function (ln) {
        if (!ln || typeof ln !== 'object') return;
        var cod = String(
          ln.cProd || ln.CProd || ln.codigo || ln.CODIGO || ln.codigoProduto || ln.COD_PRODUTO || ''
        ).trim();
        var dig = cod.replace(/\D/g, '');
        if (!dig || map[dig]) return;
        map[dig] = {
          codigo: mascaraCodigoOlExp(cod) || cod,
          descricao: String(ln.xProd || ln.XProd || ln.descricao || ln.DESCRICAO || '').trim(),
        };
      });
    });
    var keys = Object.keys(map).sort(function (a, b) {
      return String(map[a].codigo).localeCompare(String(map[b].codigo), 'pt-BR');
    });
    sel.innerHTML = '<option value="">Todos os códigos</option>';
    keys.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      var desc = map[k].descricao;
      opt.textContent = map[k].codigo + (desc ? ' — ' + desc : '');
      sel.appendChild(opt);
    });
    var ok = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === prev) {
        ok = true;
        break;
      }
    }
    sel.value = ok ? prev : '';
    var cont = byId(romGeoIdExp(prefix, 'CodContador'));
    if (cont) cont.textContent = keys.length ? '(' + keys.length + ' na carga)' : '';
  }

  function parseLinhasJsonExp(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        var j = JSON.parse(raw);
        return Array.isArray(j) ? j : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /** `6031457720` → `6.03.14.577.20` (exibição igual ao romaneio impresso). */
  function mascaraCodigoOlExp(cod) {
    var d = String(cod || '').replace(/\D/g, '');
    if (d.length !== 10) return String(cod || '').trim();
    return d[0] + '.' + d.slice(1, 3) + '.' + d.slice(3, 5) + '.' + d.slice(5, 8) + '.' + d.slice(8);
  }

  function legendaDonoSelectExp(id) {
    var sel = byId(id);
    if (!sel || !sel.value) return 'Todos os donos';
    var opt = sel.options[sel.selectedIndex];
    return opt ? String(opt.textContent || '').trim() : 'Dono #' + sel.value;
  }

  function esconderPainelAlerta() {
    var el = byId('expPainelAlerta');
    if (painelAlertTimer) {
      clearTimeout(painelAlertTimer);
      painelAlertTimer = null;
    }
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
    el.className = 'exp-painel-alerta';
  }

  function limparDivergenciasPainel() {
    ultimaValidacaoBloqueada = null;
    var wrap = byId('expDivergenciasWrap');
    var body = byId('expDivergenciasBody');
    var hint = byId('expDivergenciasHint');
    if (body) body.innerHTML = '';
    if (hint) hint.innerHTML = '';
    if (wrap) wrap.style.display = 'none';
    var j = byId('inputJustificativaBloqueio');
    if (j) j.value = '';
    var aL = byId('inputAutorizadoLogin');
    var aS = byId('inputAutorizadoSenha');
    if (aL) aL.value = '';
    if (aS) aS.value = '';
  }

  function divergenciasPainelCarregando() {
    var wrap = byId('expDivergenciasWrap');
    var body = byId('expDivergenciasBody');
    var hint = byId('expDivergenciasHint');
    if (!wrap || !body) return;
    wrap.style.display = 'block';
    if (hint) {
      hint.innerHTML =
        '<span class="hint"><i class="bx bx-loader-alt bx-spin"></i> Validando NF × OPL…</span>';
    }
    body.innerHTML = '';
  }

  /** Sem carga selecionada: não exibir bloco de liberação nem formulário (evita confusão com “permissão”). */
  function sincronizarVisibilidadeDetalheExp() {
    var temCarga = !!(state.selecionada && pick(state.selecionada, 'CD_CARGA'));
    var temLista = (state.cargas && state.cargas.length) > 0;
    var vazio = byId('expDetalheVazio');
    var oper = byId('expDetalheOperacional');
    var hist = byId('expHistoricoWrap');
    var stTag = byId('statusDetalheExpedicao');
    if (vazio) {
      vazio.hidden = temCarga;
      var msg = byId('expDetalheVazioMsg');
      if (msg) {
        msg.textContent = temLista
          ? 'Selecione uma carga na lista à esquerda.'
          : 'Nenhuma carga para expedição com os filtros atuais. Cadastre ou libere cargas em WMS — Cargas programadas.';
      }
    }
    if (oper) oper.style.display = temCarga ? '' : 'none';
    if (hist) hist.style.display = temCarga ? '' : 'none';
    if (stTag) stTag.style.display = temCarga ? '' : 'none';
  }

  function aplicarPermissaoLiberacaoUI() {
    var btn = byId('btnLiberarComDivergencia');
    var wrapLib = byId('expLiberacaoWrap');
    var hintLib = byId('expLiberacaoHint');
    var inputJust = byId('inputJustificativaBloqueio');
    var inputAutLogin = byId('inputAutorizadoLogin');
    var inputAutSenha = byId('inputAutorizadoSenha');
    var temCarga = !!(state.selecionada && pick(state.selecionada, 'CD_CARGA'));
    var st = temCarga
      ? String(pick(state.selecionada, 'ST_EXPEDICAO') || 'PRONTA_EXPEDICAO').toUpperCase()
      : '';
    var pendencia = temPendenciaParaLiberar();
    var stOperacional = st === 'PRONTA_EXPEDICAO' || !st || st === '';
    var stEmExpedicao = st === 'EM_EXPEDICAO';
    var mostrarLib =
      temCarga && usuarioPodeLiberarDivergencia && pendencia && (stOperacional || stEmExpedicao);
    if (wrapLib) wrapLib.style.display = mostrarLib ? 'block' : 'none';
    if (btn) {
      btn.disabled = !mostrarLib;
      if (stEmExpedicao) {
        btn.innerHTML = '<i class="bx bx-shield-quarter"></i> Liberar e confirmar saída';
      } else {
        btn.innerHTML = '<i class="bx bx-shield-quarter"></i> Liberar e iniciar expedição';
      }
    }
    if (hintLib) {
      if (mostrarLib && stEmExpedicao) {
        hintLib.style.display = 'block';
        hintLib.innerHTML =
          '<strong>Confirmar saída</strong> bloqueada por divergência NF×OPL ou estoque. ' +
          'Preencha justificativa e autorização e use <strong>Liberar e confirmar saída</strong>.';
      } else if (mostrarLib && !estoqueExpedicaoOk()) {
        hintLib.style.display = 'block';
        hintLib.innerHTML =
          '<strong>Iniciar expedição</strong> fica desabilitado enquanto faltar reserva OPL. ' +
          'Preencha a justificativa abaixo e use <strong>Liberar e iniciar expedição</strong> ' +
          '(ou aplique reservas com os mesmos dados de autorização no botão do espelho OPL).';
      } else {
        hintLib.style.display = 'none';
        hintLib.innerHTML = '';
      }
    }
    if (inputJust) inputJust.disabled = !mostrarLib;
    if (inputAutLogin) inputAutLogin.disabled = !mostrarLib;
    if (inputAutSenha) inputAutSenha.disabled = !mostrarLib;
    var badge = byId('expPermissaoBadge');
    if (badge) {
      if (!temCarga) {
        badge.style.display = 'none';
      } else {
        badge.style.display = '';
        badge.className = 'exp-historico-perm ' + (usuarioPodeLiberarDivergencia ? 'ok' : 'no');
        badge.textContent = usuarioPodeLiberarDivergencia
          ? 'Perfil: pode liberar divergências'
          : 'Perfil: sem permissão para liberar';
      }
    }
    sincronizarVisibilidadeDetalheExp();
  }

  function escaparHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderizarHistoricoLiberacoes(lista) {
    var body = byId('expHistoricoBody');
    if (!body) return;
    var itens = Array.isArray(lista) ? lista : [];
    if (!itens.length) {
      body.innerHTML = '<div class="exp-historico-empty">Sem histórico para esta carga.</div>';
      return;
    }
    body.innerHTML = itens
      .map(function (h) {
        var dh = fmtData(pick(h, 'DH_LIBERACAO') || pick(h, 'dh_liberacao'));
        var operador = txt(pick(h, 'SG_USER') || pick(h, 'sg_user'));
        var autorizador =
          txt(pick(h, 'AUTORIZADO_NOME') || pick(h, 'autorizado_nome')) +
          ' (' +
          txt(pick(h, 'AUTORIZADO_LOGIN') || pick(h, 'autorizado_login')) +
          ')';
        var justificativa = txt(pick(h, 'JUSTIFICATIVA') || pick(h, 'justificativa'));
        return (
          '<div class="exp-historico-item">' +
          '<div><b>Data:</b> ' + escaparHtml(dh) + '</div>' +
          '<div><b>Operador:</b> ' + escaparHtml(operador) + '</div>' +
          '<div><b>Autorizador:</b> ' + escaparHtml(autorizador) + '</div>' +
          '<div><b>Justificativa:</b> ' + escaparHtml(justificativa) + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function carregarPermissaoLiberacao() {
    return fetch('/api/menu/user-menu', {
      headers: getAuthHeaders(),
      credentials: 'include',
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        var menu = (data && Array.isArray(data.menu)) ? data.menu : [];
        usuarioPodeLiberarDivergencia = menu.some(function (m) {
          return String(m.programa || '').trim().toLowerCase() === programaLiberacaoDivergencia;
        });
        aplicarPermissaoLiberacaoUI();
        return usuarioPodeLiberarDivergencia;
      })
      .catch(function () {
        usuarioPodeLiberarDivergencia = false;
        aplicarPermissaoLiberacaoUI();
        return false;
      });
  }

  function estoqueExpedicaoOk() {
    var v = state.validacaoEstoque;
    return !!(v && v.ok);
  }

  function podeConfirmarSaidaApesarEstoque() {
    return !!state.liberacaoEstoqueAprovada;
  }

  function inferirLiberacaoEstoqueDoHistorico(lista) {
    var itens = Array.isArray(lista) ? lista : [];
    /** Qualquer liberação de supervisor já autorizou avançar — libera Confirmar saída
     *  mesmo se o JSON antigo não trouxe liberadoComEstoquePendente. */
    if (itens.length > 0) return true;
    return false;
  }

  function temPendenciaParaLiberar() {
    if (!state.selecionada) return false;
    return !estoqueExpedicaoOk() || !!ultimaValidacaoBloqueada;
  }

  function limparEstoquePainel() {
    var wrap = byId('expEstoqueWrap');
    var body = byId('expEstoqueBody');
    var head = byId('expEstoqueHead');
    if (wrap) {
      wrap.style.display = 'none';
      wrap.classList.remove('exp-estoque-wrap--hist');
    }
    if (body) body.innerHTML = '';
    if (head) {
      head.style.color = '#b45309';
      head.innerHTML =
        '<i class="bx bx-lock-alt"></i> Estoque / reserva OPL (obrigatório para expedir)';
    }
    state.validacaoEstoque = null;
  }

  function estoquePainelCarregando() {
    var wrap = byId('expEstoqueWrap');
    var body = byId('expEstoqueBody');
    var head = byId('expEstoqueHead');
    if (!wrap || !body) return;
    wrap.style.display = 'block';
    wrap.classList.remove('exp-estoque-wrap--hist');
    if (head) {
      head.style.color = '#b45309';
      head.innerHTML =
        '<i class="bx bx-loader-alt bx-spin"></i> Validando estoque / reserva OPL…';
    }
    body.innerHTML =
      '<p class="hint" style="margin:0;color:#64748b;">Aguarde — conferindo espelhos OPL, picking e saldo.</p>';
  }

  function aplicarValidacaoDetalhe(val) {
    if (!val || !state.selecionada) return;
    state.validacaoAtual = val;
    state.validacaoCarregadaCd = Number(pick(state.selecionada, 'CD_CARGA'));
    state.validacaoCarregadaEm = Date.now();
    renderizarEstoquePainel(val.validacaoEstoque, ctxExpedicaoCarga(state.selecionada));
    if (val.validacao) renderizarDivergenciasPainel(val.validacao);
    aplicarPermissaoLiberacaoUI();
    /** Sem isso o botão «Confirmar saída» fica preso no estado do carregamento rápido
     *  (ou de outra carga) até o operador clicar em outra carga e voltar. */
    atualizarBotoesExpedicao(state.selecionada);
  }

  function invalidarCacheValidacaoCliente() {
    state.validacaoAtual = null;
    state.validacaoCarregadaCd = null;
    state.validacaoCarregadaEm = 0;
  }

  function podeReusarValidacaoCliente(cd, opts) {
    if (opts && opts.refreshValidacao) return false;
    if (!state.validacaoAtual || !state.validacaoCarregadaEm) return false;
    if (Number(state.validacaoCarregadaCd) !== Number(cd)) return false;
    return Date.now() - state.validacaoCarregadaEm < VALIDACAO_CLIENT_CACHE_MS;
  }

  function ctxExpedicaoCarga(c) {
    if (!c) return null;
    return {
      stExpedicao: String(pick(c, 'ST_EXPEDICAO') || 'PRONTA_EXPEDICAO').toUpperCase(),
      dhSaida: pick(c, 'DH_SAIDA'),
    };
  }

  function cargaJaExpedida(est, cargaCtx) {
    if (est && est.cargaExpedida === true) return true;
    var ctx = cargaCtx || (state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null);
    return !!(ctx && ctx.stExpedicao === 'EXPEDIDA');
  }

  function resumoEspelhosOpl(lista) {
    var totalRes = 0;
    var pickOk = true;
    (lista || []).forEach(function (esp) {
      totalRes += Number(esp.qtdReservas) || 0;
      var tot = Number(esp.pickingTotal) || 0;
      var com = Number(esp.pickingCom) != null ? Number(esp.pickingCom) : 0;
      if (tot > 0 && com < tot) pickOk = false;
    });
    return { q: (lista || []).length, reservas: totalRes, pickingOk: pickOk };
  }

  function htmlLinhasEspelhosOpl(lista) {
    return (lista || [])
      .map(function (esp) {
        var dono =
          esp.NM_DONO
            ? escaparHtml(esp.NM_DONO) + ' (' + escaparHtml(String(esp.CD_DONO)) + ')'
            : escaparHtml(String(esp.CD_DONO || '—'));
        return (
          '<li><strong>' +
          dono +
          '</strong> — OPL #' +
          escaparHtml(esp.CD_OPL_ARQUIVO || '—') +
          (esp.NM_ARQUIVO ? ' · ' + escaparHtml(esp.NM_ARQUIVO) : '') +
          ' · reservas ' +
          escaparHtml(String(esp.qtdReservas != null ? esp.qtdReservas : '—')) +
          ' · picking ' +
          escaparHtml(String(esp.pickingCom != null ? esp.pickingCom : '—')) +
          '/' +
          escaparHtml(String(esp.pickingTotal != null ? esp.pickingTotal : '—')) +
          '</li>'
        );
      })
      .join('');
  }

  function htmlEstoqueOkEspelhosColapsavel(lista, est) {
    var res = resumoEspelhosOpl(lista);
    var qDonos = (est.cdsDonoNf || []).length || lista.length;
    var resumoTxt =
      '<strong>Estoque OK</strong> — ' +
      escaparHtml(String(res.q)) +
      ' espelho(s) OPL' +
      (res.reservas ? ' · ' + escaparHtml(String(res.reservas)) + ' reservas' : '') +
      ' · picking ' +
      (res.pickingOk ? 'OK' : 'pendente');
    return (
      '<details class="exp-estoque-detalhes exp-estoque-ok">' +
      '<summary>' +
      resumoTxt +
      '<span class="exp-estoque-ver-detalhe">clique para ver espelhos</span>' +
      '</summary>' +
      '<p class="hint" style="margin:0 0 6px 12px;font-size:12px;">Carga com ' +
      escaparHtml(String(qDonos)) +
      ' dono(s) na mesma saída.</p>' +
      '<ul>' +
      htmlLinhasEspelhosOpl(lista) +
      '</ul></details>'
    );
  }

  function renderizarEstoquePainel(est, cargaCtx) {
    var wrap = byId('expEstoqueWrap');
    var body = byId('expEstoqueBody');
    var head = byId('expEstoqueHead');
    if (!wrap || !body) return;
    state.validacaoEstoque = est || null;
    if (!est) {
      limparEstoquePainel();
      return;
    }
    var expedida = cargaJaExpedida(est, cargaCtx);
    wrap.style.display = 'block';
    wrap.classList.toggle('exp-estoque-wrap--hist', expedida && !est.ok);
    if (head) {
      if (expedida && !est.ok) {
        head.style.color = '#475569';
        head.innerHTML =
          '<i class="bx bx-check-circle"></i> Estoque / OPL — carga expedida (histórico)';
      } else {
        head.style.color = '#b45309';
        head.innerHTML =
          '<i class="bx bx-lock-alt"></i> Estoque / reserva OPL (obrigatório para expedir)';
      }
    }
    if (est.ok) {
      if (est.modoExpedicaoBaixaEstoque) {
        body.innerHTML =
          '<div class="exp-estoque-ok"><strong>Estoque OK — Baixa de estoque</strong><br/>' +
          '<span class="hint">Carga identificada como baixa (descrição). Expedição liberada pela demanda das NF-e, ' +
          'sem OPL/picking/reserva e sem exigir saldo prévio. A baixa ocorre no ledger ao confirmar a saída.</span></div>';
        return;
      }
      if (est.modoExpedicaoSemPedido && (!est.espelhosOpl || !est.espelhosOpl.length)) {
        body.innerHTML =
          '<div class="exp-estoque-ok"><strong>Estoque OK — NF sem pedido (xPed)</strong><br/>' +
          '<span class="hint">Expedição liberada pela demanda das NF-e, sem espelho OPL. A saída baixa o estoque direto no ledger ao confirmar.</span></div>';
        return;
      }
      var lista = Array.isArray(est.espelhosOpl) && est.espelhosOpl.length ? est.espelhosOpl : est.espelhoOpl ? [est.espelhoOpl] : [];
      if (lista.length > 1 || est.multiDono) {
        body.innerHTML = htmlEstoqueOkEspelhosColapsavel(lista, est);
        return;
      }
      var esp = lista[0] || est.espelhoOpl || {};
      body.innerHTML =
        '<details class="exp-estoque-detalhes exp-estoque-ok">' +
        '<summary><strong>Estoque OK para expedir.</strong> OPL #' +
        escaparHtml(esp.CD_OPL_ARQUIVO || '—') +
        ' · reservas ' +
        escaparHtml(String(esp.qtdReservas != null ? esp.qtdReservas : '—')) +
        ' · picking ' +
        escaparHtml(String(esp.pickingCom != null ? esp.pickingCom : '—')) +
        '/' +
        escaparHtml(String(esp.pickingTotal != null ? esp.pickingTotal : '—')) +
        '<span class="exp-estoque-ver-detalhe">detalhes</span></summary>' +
        '<p style="margin:0 0 8px 12px;font-size:12px;">' +
        (esp.NM_ARQUIVO ? escaparHtml(esp.NM_ARQUIVO) : '—') +
        '</p></details>';
      return;
    }
    if (expedida) {
      var espHist = (est.espelhosOpl || []).filter(function (e) {
        return e && e.CD_OPL_ARQUIVO && !(Number(e.qtdReservas) > 0);
      });
      var listaHist = espHist.length
        ? espHist
            .map(function (e) {
              return '#' + escaparHtml(String(e.CD_OPL_ARQUIVO));
            })
            .join(', ')
        : '—';
      var ctx = cargaCtx || (state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null);
      var dhSaida = ctx && ctx.dhSaida ? fmtData(ctx.dhSaida) : '';
      body.innerHTML =
        '<div class="exp-estoque-hist">' +
        '<strong>Carga já expedida</strong>' +
        (dhSaida ? ' em <strong>' + escaparHtml(dhSaida) + '</strong>' : '') +
        ' — a baixa de estoque foi registrada pelas NF-e ao confirmar a saída.' +
        (state.liberacaoEstoqueAprovada
          ? ' Houve <strong>liberação de supervisor</strong> sem reserva OPL prévia.'
          : '') +
        '<p class="hint" style="margin:8px 0 0;">' +
        '<strong>Não aplique reserva retroativa</strong> nestes espelhos: o ciclo já encerrou. ' +
        'Use <em>Imprimir divergências</em> para conferência fiscal × OPL.</p>' +
        (espHist.length
          ? '<p class="hint" style="margin:6px 0 0;">Espelho(s) sem reserva no momento da saída: ' +
            listaHist +
            '.</p>'
          : '') +
        '</div>';
      return;
    }
    var bloqueios = est.bloqueios || [];
    var html =
      '<p><strong>Expedição bloqueada</strong> (estoque/OPL). Corrija o que a mensagem pedir ou use <em>Liberação por supervisor</em> (seção abaixo):</p><ul>';
    bloqueios.forEach(function (b) {
      var code = String((b && b.code) || '');
      html += '<li>' + escaparHtml(b.mensagem || b.code || 'Bloqueio') + '</li>';
      if (code === 'DONO_CARGA_NF_DIVERGENTE') {
        html +=
          '<li class="hint" style="list-style:none;margin:4px 0 8px 0;color:#92400e;">' +
          '→ Abra <strong>Cargas programadas</strong> → detalhe desta carga → bloco <strong>«Dono do estoque da carga»</strong> → <strong>Alinhar às NF</strong> ou Salvar dono. Depois atualize esta tela.' +
          '</li>';
      }
      if (code === 'SEM_RESERVA_OPL') {
        html +=
          '<li class="hint" style="list-style:none;margin:4px 0 8px 0;color:#1e40af;">' +
          '→ Use o botão <strong>Aplicar reservas</strong> abaixo. Se falhar por cobertura, preencha justificativa + senha de supervisor e clique de novo.' +
          '</li>';
      }
    });
    html += '</ul>';
    var espelhosSemReserva = (est.espelhosOpl || []).filter(function (e) {
      return e && e.CD_OPL_ARQUIVO && !(Number(e.qtdReservas) > 0);
    });
    if (espelhosSemReserva.length) {
      html +=
        '<p class="hint" style="margin-top:10px;">Picking concluído mas <strong>sem reserva gravada</strong> — aplique aqui ou em Separação:</p><div class="filtros-actions" style="margin-top:8px;flex-wrap:wrap;gap:8px;">';
      espelhosSemReserva.forEach(function (esp) {
        html +=
          '<button type="button" class="btn-filtro btn-filtro-aplicar exp-btn-aplicar-reserva" data-cd-opl="' +
          escaparHtml(String(esp.CD_OPL_ARQUIVO)) +
          '"><i class="bx bx-lock-open"></i> Aplicar reservas OPL #' +
          escaparHtml(String(esp.CD_OPL_ARQUIVO)) +
          '</button>';
      });
      html += '</div>';
    }
    if (state.liberacaoEstoqueAprovada) {
      html +=
        '<p class="hint" style="margin-top:10px;padding:8px 10px;border-radius:6px;background:#ecfdf5;border:1px solid #86efac;color:#166534;">' +
        '<strong>Autorização registrada</strong> — estoque/OPL ainda pendente, mas você pode <strong>Confirmar saída</strong>.' +
        '</p>';
    }
    body.innerHTML = html;
    aplicarPermissaoLiberacaoUI();
    if (state.selecionada) atualizarBotoesExpedicao(state.selecionada);
  }
  function aplicarReservasOplExp(cdOpl) {
    if (!cdOpl) return;
    if (cargaJaExpedida(state.validacaoEstoque, state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null)) {
      showMessage(
        'Carga já expedida — não aplique reserva retroativa. A baixa foi feita pelas NF-e.',
        'warning',
        { autoHideMs: 12000 }
      );
      return;
    }
    var body = { incluirRecebimentosAbertos: false };
    var justificativa = (byId('inputJustificativaBloqueio') && byId('inputJustificativaBloqueio').value || '').trim();
    var autorizadoLogin = (byId('inputAutorizadoLogin') && byId('inputAutorizadoLogin').value || '').trim();
    var autorizadoSenha = (byId('inputAutorizadoSenha') && byId('inputAutorizadoSenha').value || '').trim();
    if (justificativa.length >= 10 && autorizadoLogin && autorizadoSenha) {
      body.liberarCoberturaInsuficiente = true;
      body.justificativa = justificativa;
      body.autorizadoLogin = autorizadoLogin;
      body.autorizadoSenha = autorizadoSenha;
    }
    showLoadingOverlay('Reservas OPL', 'Validando cobertura e gravando reservas...', 'Espelho #' + cdOpl);
    fetch('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(String(cdOpl)) + '/aplicar-reservas', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error(formatErroCoberturaReservas(j) || r.statusText || 'Erro ao aplicar reservas.');
            err.code = j && j.code;
            err.detalhes = j && j.detalhes;
            throw err;
          }
          return j;
        });
      })
      .then(function (resp) {
        var n =
          resp.reservaEstoque && resp.reservaEstoque.registros != null
            ? resp.reservaEstoque.registros
            : 0;
        showMessage('Reservas aplicadas no OPL #' + cdOpl + (n ? ' (' + n + ' SKU).' : '.'), 'success');
        if (state.selecionada) {
          return carregarDetalhe(pick(state.selecionada, 'CD_CARGA'), { refreshValidacao: true });
        }
      })
      .catch(function (e) {
        var msg = (e && e.message) || 'Erro ao aplicar reservas.';
        var code = String((e && e.code) || '');
        var low = String(msg).toLowerCase();
        if (
          code === 'COBERTURA_INSUFICIENTE' ||
          low.indexOf('saldo insuficiente') >= 0 ||
          low.indexOf('cobertura') >= 0 ||
          low.indexOf('insuficiente') >= 0 ||
          low.indexOf('falta cobrir') >= 0
        ) {
          if (low.indexOf('liberação por supervisor') < 0 && low.indexOf('liberacao por supervisor') < 0) {
            msg +=
              ' Para liberar: preencha justificativa + login/senha do autorizador em «Liberação por supervisor» e clique de novo em Aplicar reservas OPL #' +
              cdOpl +
              '.';
          }
        }
        showMessage(msg, 'error', { autoHideMs: 22000 });
      })
      .finally(hideLoadingOverlay);
  }

  function fmtQtdCobertura(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return String(Number(v.toFixed(3))).replace(/\.?0+$/, '').replace('.', ',');
  }

  function linhaProblemaCoberturaTxt(L) {
    if (!L) return '';
    var ol = L.codProdutoOl || L.COD_PRODUTO_OL || '?';
    var interno = L.codigoInterno ? ' → ' + L.codigoInterno : '';
    var desc = L.descricao ? ' — ' + String(L.descricao).slice(0, 48) : '';
    if (L.semDepara) return ol + interno + desc + ': sem de-para/produto no dono';
    var ped = L.qtdPedidaAgregada != null ? L.qtdPedidaAgregada : L.qtd;
    var sal =
      L.saldoDisponivelAposReservasOutros != null
        ? L.saldoDisponivelAposReservasOutros
        : L.saldoEstimadoUsado != null
          ? L.saldoEstimadoUsado
          : L.saldoEncerradas;
    var falta = L.possivelFalta != null && L.possivelFalta > 1e-9 ? L.possivelFalta : null;
    var out =
      ol + interno + desc + ': pedido ' + fmtQtdCobertura(ped) + ', saldo disp. ' + fmtQtdCobertura(sal);
    if (falta != null) out += ', falta ' + fmtQtdCobertura(falta);
    return out;
  }

  function formatErroCoberturaReservas(j) {
    if (!j) return 'Erro desconhecido.';
    var msg = j.error || j.message || 'Erro';
    var probs = j.detalhes && j.detalhes.linhasProblema;
    if (probs && probs.length && String(msg).toLowerCase().indexOf('falta cobrir') < 0) {
      var extra = probs
        .slice(0, 6)
        .map(linhaProblemaCoberturaTxt)
        .filter(Boolean)
        .join(' | ');
      if (extra) msg += ' Falta cobrir: ' + extra;
      if (probs.length > 6) msg += ' (+' + String(probs.length - 6) + ' SKU)';
    }
    return msg;
  }

  function isConferenciaCrossPedido(d) {
    var t = String((d && d.tipo) || '').toUpperCase();
    return (
      t === 'CONF_XPED_OK' ||
      t === 'CONF_XPED_QTD' ||
      t === 'CONF_NET_CLIENTE_SKU' ||
      t === 'CONFERENCIA_PEDIDO_CRUZADO' ||
      t === 'CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF'
    );
  }

  function limparConferenciasPainel() {
    var wrap = byId('expConferenciasWrap');
    var body = byId('expConferenciasBody');
    var hint = byId('expConferenciasHint');
    if (body) body.innerHTML = '';
    if (hint) hint.innerHTML = '';
    if (wrap) wrap.style.display = 'none';
  }

  function truncarTexto(s, max) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
  }

  function badgeTipoDivergencia(tipo) {
    var t = String(tipo || '').toUpperCase();
    var cls = 'exp-div-badge--outro';
    var label = txt(tipo);
    if (t === 'PEDIDO_NAO_ENCONTRADO') {
      cls = 'exp-div-badge--pedido';
      label = 'xPed OPL';
    } else if (t === 'SEPARADO_SEM_NF') {
      cls = 'exp-div-badge--sepnf';
      label = 'Sep. s/ NF';
    } else if (t === 'FALTA_PARA_ATENDER_NF') {
      cls = 'exp-div-badge--falta';
      label = 'Falta NF';
    } else if (t === 'NAO_FATURADO_NA_NF') {
      cls = 'exp-div-badge--sobra';
      label = 'Sobra';
    } else if (t === 'NAO_SEPARADO_NA_CARGA') {
      cls = 'exp-div-badge--naosep';
      label = 'Não sep.';
    } else if (t === 'SEM_PEDIDO') {
      cls = 'exp-div-badge--xped';
      label = 'Sem xPed';
    } else if (t === 'EMBALAGEM_DIVERGENTE_NF_OPL') {
      cls = 'exp-div-badge--embalagem';
      label = 'Emb. NF×OPL';
    } else if (t === 'UNIDADE_DIVERGENTE') {
      cls = 'exp-div-badge--embalagem';
      label = 'Unid. diverg.';
    }
    var titleAttr =
      t === 'EMBALAGEM_DIVERGENTE_NF_OPL'
        ? ' title="Embalagem divergente: NF e OPL com mesma qtd na tela, mas códigos/unidades diferentes (ex.: PC × CX)"'
        : '';
    return '<span class="exp-div-badge ' + cls + '"' + titleAttr + '>' + escaparHtml(label) + '</span>';
  }

  function renderizarConferenciasPainel(validacao) {
    var wrap = byId('expConferenciasWrap');
    var body = byId('expConferenciasBody');
    var hintEl = byId('expConferenciasHint');
    if (!wrap || !body) return;
    var lista =
      (validacao && validacao.conferenciasCrossPedido) ||
      ((validacao && validacao.divergencias) || []).filter(isConferenciaCrossPedido);
    if (!Array.isArray(lista) || !lista.length) {
      limparConferenciasPainel();
      return;
    }
    if (hintEl) {
      var soNet = lista.every(function (d) {
        return String(d.tipo || '').toUpperCase() === 'CONF_NET_CLIENTE_SKU';
      });
      hintEl.textContent = soNet
        ? lista.length +
          ' item(ns) conciliados por soma cliente+SKU (NF e OPL fecham no total; xPeds podem diferir — ex. complemento de embalagem).'
        : lista.length +
          ' item(ns) da NF com xPed diferente do pedido no OPL desta carga. Confira o espelho OPL indicado no aviso (não use lotes de outra semana).';
    }
    body.innerHTML = lista
      .slice(0, 80)
      .map(function (d) {
        var sit = String(d.situacao || '').trim();
        var sitOk =
          sit.indexOf('CONFERE') >= 0 ||
          sit.indexOf('QTD OK') >= 0 ||
          sit.indexOf('NET CLIENTE') >= 0;
        var sitHtml = sit
          ? '<span class="exp-conf-sit ' + (sitOk ? 'exp-conf-sit--ok' : 'exp-conf-sit--warn') + '">' + escaparHtml(sit) + '</span>'
          : '—';
        var oplTxt = txt(d.pedidoOpl);
        if (d.cdOplArquivo) oplTxt += ' · OPL #' + txt(d.cdOplArquivo);
        var tit = d.aviso ? ' title="' + escaparHtml(d.aviso) + '"' : '';
        return (
          '<tr' + tit + '>' +
          '<td class="col-pedido">' + txt(d.pedido) + '</td>' +
          '<td class="col-pedido">' + oplTxt + '</td>' +
          '<td class="col-codigo">' + maskCodigo(d.codigo) + '</td>' +
          '<td>' + escaparHtml(truncarTexto(d.descricao, 48)) + '</td>' +
          '<td class="col-num">' + txt(d.qtdNf) + '</td>' +
          '<td class="col-num">' + txt(d.qtdPedido) + '</td>' +
          '<td>' + sitHtml + '</td>' +
          '</tr>'
        );
      })
      .join('');
    wrap.style.display = 'block';
  }

  function renderizarDivergenciasPainel(validacao) {
    renderizarConferenciasPainel(validacao);
    var wrap = byId('expDivergenciasWrap');
    var body = byId('expDivergenciasBody');
    var countEl = byId('expDivergenciasCount');
    if (!wrap || !body) return;
    var itens = ((validacao && validacao.divergencias) || []).filter(function (d) {
      return !d.bloqueioEstoque && !isConferenciaCrossPedido(d);
    });
    if (!Array.isArray(itens) || !itens.length) {
      if (validacao && Array.isArray(validacao.sanacoes) && validacao.sanacoes.length) {
        if (body) {
          body.innerHTML =
            '<tr><td colspan="8" class="hint">' +
            escaparHtml(
              validacao.sanacoes
                .map(function (s) {
                  return s.dsEvento || 'Sanção pós-OPL registrada';
                })
                .join(' · ')
            ) +
            '</td></tr>';
        }
        if (wrap) wrap.style.display = 'block';
        var hintSan = byId('expDivergenciasHint');
        if (hintSan) {
          hintSan.innerHTML =
            '<span class="exp-div-chip exp-div-chip--opl"><strong>' +
            validacao.sanacoes.length +
            '</strong> sanção(ões) pós-OPL (pedido passou a existir após a saída)</span>';
        }
        if (countEl) {
          countEl.textContent = 'sanção';
          countEl.style.display = '';
        }
        if (!temPendenciaParaLiberar()) ultimaValidacaoBloqueada = null;
        aplicarPermissaoLiberacaoUI();
        return;
      }
      if (body) body.innerHTML = '';
      if (wrap) wrap.style.display = 'none';
      var hintEl0 = byId('expDivergenciasHint');
      if (hintEl0) hintEl0.innerHTML = '';
      if (countEl) countEl.style.display = 'none';
      if (!temPendenciaParaLiberar()) ultimaValidacaoBloqueada = null;
      aplicarPermissaoLiberacaoUI();
      return;
    }
    ultimaValidacaoBloqueada = validacao;
    function temSkuEmOutroPedido(d) {
      var alts = d && d.oplAlternativas;
      if (Array.isArray(alts) && alts.length) return true;
      var av = d && d.aviso ? String(d.aviso) : '';
      return /No OPL \(outro xPed\)/i.test(av) || /outro xPed/i.test(av);
    }
    var qPedNf = itens.filter(function (d) {
      return String(d.tipo || '').toUpperCase() === 'PEDIDO_NAO_ENCONTRADO';
    }).length;
    var qProdutoAusente = itens.filter(function (d) {
      var t = String(d.tipo || '').toUpperCase();
      if (t !== 'PEDIDO_NAO_ENCONTRADO' && t !== 'NAO_SEPARADO_NA_CARGA') return false;
      var sep = Number(d.qtdPedido);
      return (!Number.isFinite(sep) || Math.abs(sep) < 1e-9) && !temSkuEmOutroPedido(d);
    }).length;
    var qComAvisoOpl = itens.filter(temSkuEmOutroPedido).length;
    var qSepNf = itens.filter(function (d) {
      return String(d.tipo || '').toUpperCase() === 'SEPARADO_SEM_NF';
    }).length;
    var chips = [];
    if (qProdutoAusente) {
      chips.push(
        '<span class="exp-div-chip exp-div-chip--pedido"><strong>' +
          qProdutoAusente +
          '</strong> produto ausente no OPL da carga</span>'
      );
    }
    if (qPedNf && qPedNf !== qProdutoAusente) {
      chips.push(
        '<span class="exp-div-chip exp-div-chip--pedido"><strong>' + qPedNf + '</strong> xPed ausente no OPL</span>'
      );
    }
    if (qComAvisoOpl) {
      chips.push(
        '<span class="exp-div-chip exp-div-chip--opl"><strong>' + qComAvisoOpl + '</strong> SKU em outro pedido</span>'
      );
    }
    if (qSepNf) {
      chips.push(
        '<span class="exp-div-chip exp-div-chip--sepnf"><strong>' + qSepNf + '</strong> separado sem NF</span>'
      );
    }
    var qOutros = itens.filter(function (d) {
      var t = String(d.tipo || '').toUpperCase();
      return t !== 'PEDIDO_NAO_ENCONTRADO' && t !== 'SEPARADO_SEM_NF';
    }).length;
    if (qOutros) {
      chips.push(
        '<span class="exp-div-chip exp-div-chip--outros"><strong>' + qOutros + '</strong> faltas / sobras / outros</span>'
      );
    }
    body.innerHTML = itens
      .slice(0, 50)
      .map(function (d) {
        var avisoRaw = d.aviso && String(d.aviso).trim() ? String(d.aviso).trim() : '';
        var avisoCell = avisoRaw
          ? '<span title="' + escaparHtml(avisoRaw) + '">' + escaparHtml(truncarTexto(avisoRaw, 72)) + '</span>'
          : '<span style="color:#94a3b8">—</span>';
        var descTit = d.descricao ? ' title="' + escaparHtml(d.descricao) + '"' : '';
        var nfLab = String(d.nfLabel || d.NF_LABEL || '').trim();
        var destLab = String(d.destino || d.DESTINO || '').trim();
        var ctxParts = [];
        if (nfLab) ctxParts.push('NF ' + nfLab);
        if (destLab) ctxParts.push(destLab);
        var ctxHtml = ctxParts.length
          ? '<span class="exp-div-ctx" title="' +
            escaparHtml(ctxParts.join(' · ')) +
            '">' +
            escaparHtml(truncarTexto(ctxParts.join(' · '), 64)) +
            '</span>'
          : '';
        return (
          '<tr>' +
          '<td class="col-tipo">' + badgeTipoDivergencia(d.tipo) + '</td>' +
          '<td class="col-pedido">' + txt(d.pedido) + '</td>' +
          '<td class="col-codigo">' + maskCodigo(d.codigo) + '</td>' +
          '<td class="col-desc"' + descTit + '>' +
          escaparHtml(truncarTexto(d.descricao, 42)) +
          ctxHtml +
          '</td>' +
          '<td class="col-obs">' + avisoCell + '</td>' +
          '<td class="col-num">' + txt(d.qtdPedido) + '</td>' +
          '<td class="col-num">' + txt(d.qtdNf) + '</td>' +
          '<td class="col-num">' + txt(d.qtdDif) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    var hintEl = byId('expDivergenciasHint');
    if (hintEl) {
      var parts = [];
      if (validacao && validacao.fonteSnapshot) {
        var mom = (validacao.snapshotSaida && validacao.snapshotSaida.momento) || 'SAIDA';
        parts.push(
          '<span class="exp-div-chip exp-div-chip--outros"><strong>Snapshot</strong> na ' +
            (mom === 'SAIDA' ? 'saída' : 'expedição') +
            ' (auditoria)</span>'
        );
      }
      if (validacao && Array.isArray(validacao.sanacoes) && validacao.sanacoes.length) {
        parts.push(
          '<span class="exp-div-chip exp-div-chip--opl"><strong>' +
            validacao.sanacoes.length +
            '</strong> sanção(ões) pós-OPL registradas</span>'
        );
      }
      if (chips.length) parts.push('<div class="exp-div-resumo">' + chips.join('') + '</div>');
      else if (parts.length) parts.push('<div class="exp-div-resumo"></div>');
      hintEl.innerHTML = parts.join(' ');
    }
    if (countEl) {
      countEl.textContent = itens.length + ' item' + (itens.length === 1 ? '' : 's');
      countEl.style.display = '';
    }
    wrap.style.display = 'block';
    aplicarPermissaoLiberacaoUI();
  }

  function removerDestaqueErroInputs() {
    ['inputConferenteExp', 'inputMotoristaExp', 'inputPlacaExp'].forEach(function (id) {
      var n = byId(id);
      if (n) n.classList.remove('input-erro-exp');
    });
  }

  /** kind: 'success' | 'error' | 'warning' */
  function showPainelAlerta(text, kind, focusInputId, highlightIds, autoHideMs) {
    var el = byId('expPainelAlerta');
    if (!el) return;
    if (painelAlertTimer) {
      clearTimeout(painelAlertTimer);
      painelAlertTimer = null;
    }
    removerDestaqueErroInputs();
    el.textContent = text || '';
    el.className = 'exp-painel-alerta ' + (kind === 'success' ? 'success' : kind === 'error' ? 'error' : 'warning');
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    (highlightIds || []).forEach(function (hid) {
      var n = byId(hid);
      if (n) n.classList.add('input-erro-exp');
    });
    if (focusInputId) {
      var inp = byId(focusInputId);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (inp && !inp.disabled) {
            inp.focus();
            try { if (inp.select) inp.select(); } catch (e) { /* ignore */ }
          }
        });
      });
    }
    if (autoHideMs == null) autoHideMs = kind === 'success' ? 6500 : 0;
    if (autoHideMs > 0) {
      painelAlertTimer = setTimeout(esconderPainelAlerta, autoHideMs);
    }
  }

  function showMessage(text, type, opts) {
    var kind = type === 'success' ? 'success' : type === 'error' ? 'error' : 'warning';
    opts = opts || {};
    showPainelAlerta(text, kind, opts.focusId, opts.errorInputs, opts.autoHideMs);
  }

  function aplicarPermissaoReabrirUI() {
    var br = byId('btnReabrirExpedicao');
    if (!br) return;
    var pode = usuarioPodeReabrirExpedicao || usuarioPodeLiberarDivergencia;
    br.style.display = pode ? '' : 'none';
  }

  function aplicarPainelReabrirUI(c, st) {
    var wrap = byId('expReabrirWrap');
    if (!wrap) return;
    var stNorm = String(st || 'PRONTA_EXPEDICAO').toUpperCase();
    var pode = usuarioPodeReabrirExpedicao || usuarioPodeLiberarDivergencia;
    var show = !!(c && stNorm === 'EXPEDIDA' && pode);
    wrap.style.display = show ? 'block' : 'none';
    wrap.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) {
      var j = byId('inputJustificativaReabrir');
      var l = byId('inputReabrirAutorizadoLogin');
      var s = byId('inputReabrirAutorizadoSenha');
      if (j) j.value = '';
      if (l) l.value = '';
      if (s) s.value = '';
    }
  }

  function atualizarBotoesExpedicao(c) {
    var bi = byId('btnIniciarExpedicao');
    var bc = byId('btnConfirmarSaidaExp');
    var bvm = byId('btnVoltarMontagemExp');
    var bre = byId('btnReabrirExpedicao');
    var im = byId('inputMotoristaExp');
    var ip = byId('inputPlacaExp');
    var ic = byId('inputConferenteExp');
    var br = byId('btnImprimirResumoExp');
    var bf = byId('btnImprimirFriosExp');
    var bd = byId('btnImprimirDivergenciasExp');
    var bdc = byId('btnExportarDivergenciasCsvExp');
    var brv = byId('btnRevalidarCargaExp');
    if (!bi || !bc) return;
    aplicarPermissaoReabrirUI();
    if (br) br.disabled = !c;
    if (bf) bf.disabled = !c;
    if (bd) bd.disabled = !c;
    if (bdc) bdc.disabled = !c;
    if (brv) brv.disabled = !c;
    if (!c) {
      aplicarPainelReabrirUI(null, '');
      bi.disabled = true;
      bc.disabled = true;
      if (bvm) {
        bvm.disabled = true;
        bvm.style.display = 'none';
      }
      if (bre) bre.disabled = true;
      if (im) im.disabled = true;
      if (ip) ip.disabled = true;
      if (ic) ic.disabled = true;
      return;
    }
    var st = String(pick(c, 'ST_EXPEDICAO') || 'PRONTA_EXPEDICAO').toUpperCase();
    aplicarPainelReabrirUI(c, st);
    var estOk = estoqueExpedicaoOk();
    var bloqueioEstoque = !estOk && st !== 'EXPEDIDA';
    var bypassEstoqueSaida = podeConfirmarSaidaApesarEstoque();
    if (st === 'EXPEDIDA') {
      bi.disabled = true;
      bc.disabled = true;
      if (bvm) {
        bvm.disabled = true;
        bvm.style.display = 'none';
      }
      var podeReabrir = usuarioPodeReabrirExpedicao || usuarioPodeLiberarDivergencia;
      if (bre) bre.disabled = !podeReabrir;
      if (im) im.disabled = true;
      if (ip) ip.disabled = true;
      if (ic) ic.disabled = true;
    } else if (st === 'EM_EXPEDICAO') {
      if (bre) bre.disabled = true;
      if (bvm) {
        bvm.style.display = '';
        bvm.disabled = false;
      }
      bi.disabled = true;
      bc.disabled = bloqueioEstoque && !bypassEstoqueSaida;
      if (im) im.disabled = false;
      if (ip) ip.disabled = false;
      if (ic) ic.disabled = false;
    } else {
      if (bre) bre.disabled = true;
      if (bvm) {
        bvm.disabled = true;
        bvm.style.display = 'none';
      }
      bi.disabled = bloqueioEstoque;
      bc.disabled = true;
      if (im) im.disabled = false;
      if (ip) ip.disabled = false;
      if (ic) ic.disabled = false;
    }
    var hintEstoque = bloqueioEstoque
      ? bypassEstoqueSaida && st === 'EM_EXPEDICAO'
        ? ' Estoque/OPL pendente — autorização já registrada: use «Confirmar saída».'
        : usuarioPodeLiberarDivergencia
          ? ' Estoque/OPL pendente — use «Liberar com justificativa» ou corrija o painel acima.'
          : ' Corrija estoque/OPL (painel acima) antes de expedir.'
      : '';
    bi.title = bloqueioEstoque ? hintEstoque : '';
    bc.title = bloqueioEstoque ? hintEstoque : '';
  }
  function fmtData(v) {
    if (!v) return '-';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('pt-BR');
  }

  function statusClass(st) {
    var s = String(st || 'PRONTA_EXPEDICAO').toLowerCase();
    if (s === 'expedida') return 'status-tag expedida';
    if (s === 'em_expedicao') return 'status-tag em_expedicao';
    return 'status-tag pronta_expedicao';
  }

  function rotuloStatusExpedicao(st) {
    var s = String(st || '').toUpperCase();
    if (s === 'PRONTA_EXPEDICAO') return 'Pronta para expedição';
    if (s === 'EM_EXPEDICAO') return 'Em expedição';
    if (s === 'EXPEDIDA') return 'Expedida';
    return st || '—';
  }

  function api(path, opts) {
    return fetch('/api' + path, Object.assign({ credentials: 'include' }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return body;
        });
      });
  }

  function renderLista() {
    var el = byId('listaCargasExpedicao');
    var cont = byId('contadorCargasExp');
    if (!el) return;
    cont.textContent = String(state.cargas.length || 0);
    if (!state.cargas.length) {
      el.innerHTML = '<div class="exp-item">Nenhuma carga para os filtros informados.</div>';
      return;
    }
    el.innerHTML = state.cargas.map(function (c) {
      var st = pick(c, 'ST_EXPEDICAO') || 'PRONTA_EXPEDICAO';
      var stLabel = rotuloStatusExpedicao(st);
      var active =
        state.selecionada && Number(pick(state.selecionada, 'CD_CARGA')) === Number(pick(c, 'CD_CARGA'))
          ? ' active'
          : '';
      return '' +
        '<div class="exp-item' + active + '" data-carga="' + c.CD_CARGA + '">' +
          '<p class="exp-item-title">#' + c.CD_CARGA + ' - ' + txt(c.NM_DESCRICAO || 'Sem descrição') + '</p>' +
          '<div class="exp-item-meta">' +
            '<span class="' + statusClass(st) + '">' + stLabel + '</span>' +
            '<span>NF-e: ' + Number(c.Q_NFES || 0) + '</span>' +
            '<span>Criada: ' + fmtData(c.DH_CRIACAO) + '</span>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function marcarCargaAtivaLista() {
    var el = byId('listaCargasExpedicao');
    if (!el) return;
    var sel = state.selecionada ? Number(pick(state.selecionada, 'CD_CARGA')) : null;
    Array.prototype.forEach.call(el.querySelectorAll('.exp-item[data-carga]'), function (item) {
      var cd = Number(item.getAttribute('data-carga'));
      item.classList.toggle('active', sel != null && cd === sel);
    });
  }

  function renderDetalhe(payload) {
    var c = payload && payload.carga ? payload.carga : null;
    var nfes = payload && Array.isArray(payload.nfes) ? payload.nfes : [];
    var newId = c ? Number(c.CD_CARGA) : null;
    var mudouCarga = newId !== lastRenderedCargaId;
    if (mudouCarga) {
      limparDivergenciasPainel();
      limparConferenciasPainel();
      /** Evita herdar validação OK/bloqueio da carga anterior no estado dos botões. */
      state.validacaoEstoque = null;
      invalidarCacheValidacaoCliente();
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'permissaoLiberacaoDivergencia')) {
      usuarioPodeLiberarDivergencia = !!payload.permissaoLiberacaoDivergencia;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'permissaoReabrirExpedicao')) {
      usuarioPodeReabrirExpedicao = !!payload.permissaoReabrirExpedicao;
    }
    state.liberacaoEstoqueAprovada =
      !!(payload && payload.expedicaoLiberadaComEstoquePendente) ||
      inferirLiberacaoEstoqueDoHistorico(payload && payload.liberacoesDivergencia);
    aplicarPermissaoReabrirUI();
    renderizarHistoricoLiberacoes(payload && payload.liberacoesDivergencia);
    state.selecionada = c;
    if (payload && payload.validacaoPendente && !payload.validacaoEstoque) {
      estoquePainelCarregando();
    } else {
      renderizarEstoquePainel(payload && payload.validacaoEstoque, c ? ctxExpedicaoCarga(c) : null);
    }
    if (c && mudouCarga) {
      removerDestaqueErroInputs();
      byId('inputMotoristaExp').value = '';
      byId('inputPlacaExp').value = '';
      byId('inputConferenteExp').value = '';
    }
    lastRenderedCargaId = newId;
    byId('tituloDetalheExpedicao').textContent = c ? ('Carga #' + c.CD_CARGA + ' - ' + txt(c.NM_DESCRICAO || 'Sem descrição')) : 'Selecione uma carga';
    var st = (c && pick(c, 'ST_EXPEDICAO')) ? pick(c, 'ST_EXPEDICAO') : 'PRONTA_EXPEDICAO';
    var stNorm = String(st || 'PRONTA_EXPEDICAO').toUpperCase();
    var stEl = byId('statusDetalheExpedicao');
    stEl.className = statusClass(st);
    stEl.textContent = rotuloStatusExpedicao(st);
    byId('detConferenteExp').textContent = txt(c && pick(c, 'NM_CONFERENTE'));
    byId('detInicioExp').textContent = fmtData(c && pick(c, 'DH_INICIO'));
    byId('detSaidaConfirmadaExp').textContent = fmtData(c && pick(c, 'DH_SAIDA'));
    byId('detMotoristaExp').textContent = txt(c && pick(c, 'NM_MOTORISTA'));
    byId('detPlacaExp').textContent = txt(c && pick(c, 'PLACA'));
    var im = byId('inputMotoristaExp');
    var ip = byId('inputPlacaExp');
    var ic = byId('inputConferenteExp');
    if (c && stNorm === 'EM_EXPEDICAO') {
      var nmConf = pick(c, 'NM_CONFERENTE');
      if (nmConf && !(ic.value || '').trim()) ic.value = String(nmConf);
      if (pick(c, 'NM_MOTORISTA') && !(im.value || '').trim()) im.value = String(pick(c, 'NM_MOTORISTA'));
      if (pick(c, 'PLACA') && !(ip.value || '').trim()) ip.value = String(pick(c, 'PLACA')).toUpperCase();
    } else if (c && stNorm === 'EXPEDIDA') {
      ic.value = pick(c, 'NM_CONFERENTE') ? String(pick(c, 'NM_CONFERENTE')) : '';
      im.value = pick(c, 'NM_MOTORISTA') ? String(pick(c, 'NM_MOTORISTA')) : '';
      ip.value = pick(c, 'PLACA') ? String(pick(c, 'PLACA')).toUpperCase() : '';
    }
    state.nfesDetalheExp = nfes;
    state.donosCarga = Array.isArray(payload.donosCarga) ? payload.donosCarga : [];
    preencherSelectsDonoRomExp();
    var tb = byId('tbodyNfesExpedicao');
    tb.innerHTML = nfes.length ? nfes.map(function (n) {
      return '<tr>' +
        '<td class="col-numero">' + txt(n.NUMERO_NF) + ' / ' + txt(n.SERIE) + '</td>' +
        '<td class="col-destino">' + txt(formatLocalEntregaNfeRow(n)) + '</td>' +
        '<td class="col-itens right">' + Number(n.Q_ITENS || 0) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="3">Sem NF-e vinculada na carga.</td></tr>';
    atualizarBotoesExpedicao(c);
    if (payload && payload.validacao) {
      renderizarDivergenciasPainel(payload.validacao);
    } else if (payload && payload.validacaoPendente) {
      divergenciasPainelCarregando();
    } else if (stNorm !== 'PRONTA_EXPEDICAO') {
      limparDivergenciasPainel();
      limparConferenciasPainel();
    }
    aplicarPermissaoLiberacaoUI();
    marcarCargaAtivaLista();
    sincronizarVisibilidadeDetalheExp();
  }

  function limparDetalhe() {
    lastRenderedCargaId = null;
    esconderPainelAlerta();
    removerDestaqueErroInputs();
    state.selecionada = null;
    state.donosCarga = [];
    state.nfesDetalheExp = [];
    state.liberacaoEstoqueAprovada = false;
    renderizarHistoricoLiberacoes([]);
    preencherSelectsDonoRomExp();
    limparDivergenciasPainel();
    limparConferenciasPainel();
    limparEstoquePainel();
    byId('tituloDetalheExpedicao').textContent = 'Selecione uma carga';
    var stEl = byId('statusDetalheExpedicao');
    stEl.className = statusClass('PRONTA_EXPEDICAO');
    stEl.textContent = rotuloStatusExpedicao('PRONTA_EXPEDICAO');
    byId('detConferenteExp').textContent = '-';
    byId('detInicioExp').textContent = '-';
    byId('detSaidaConfirmadaExp').textContent = '-';
    byId('detMotoristaExp').textContent = '-';
    byId('detPlacaExp').textContent = '-';
    byId('inputMotoristaExp').value = '';
    byId('inputPlacaExp').value = '';
    byId('inputConferenteExp').value = '';
    byId('tbodyNfesExpedicao').innerHTML = '<tr><td colspan="3">Sem carga selecionada.</td></tr>';
    atualizarBotoesExpedicao(null);
    sincronizarVisibilidadeDetalheExp();
  }

  function carregarLista(evitarReset) {
    var st = byId('filtroStatusExpedicao').value || '';
    showLoadingOverlay('Expedição', 'Carregando lista de cargas…', '');
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    })
      .then(function () {
        return api('/wms/expedicao/cargas' + (st ? ('?status=' + encodeURIComponent(st)) : ''));
      })
      .then(function (rows) {
        state.cargas = Array.isArray(rows) ? rows : [];
        if (!evitarReset) state.selecionada = null;
        if (evitarReset && state.selecionada) {
          var selId = Number(pick(state.selecionada, 'CD_CARGA'));
          var aindaExiste = state.cargas.some(function (c) {
            return Number(pick(c, 'CD_CARGA')) === selId;
          });
          if (!aindaExiste) state.selecionada = null;
        }
        renderLista();
        if (!state.cargas.length) {
          limparDetalhe();
          return Promise.resolve();
        }
        if (!state.selecionada) {
          return carregarDetalhe(state.cargas[0].CD_CARGA);
        }
        return Promise.resolve();
      })
      .catch(function (err) {
        showMessage(err.message || 'Erro ao carregar expedição.', 'error', { autoHideMs: 9000 });
      })
      .finally(function () {
        if (!state.selecionada || evitarReset) hideLoadingOverlay();
      });
  }

  function carregarDetalhe(cd, opts) {
    opts = opts || {};
    if (!cd) return Promise.resolve();
    if (podeReusarValidacaoCliente(cd, opts) && state.selecionada && Number(pick(state.selecionada, 'CD_CARGA')) === Number(cd)) {
      aplicarValidacaoDetalhe(state.validacaoAtual);
      return Promise.resolve();
    }
    var seq = ++detalheValidacaoSeq;
    var refreshQ = opts.refreshValidacao ? '?refresh=1' : '';
    if (opts.refreshValidacao) invalidarCacheValidacaoCliente();
    showLoadingOverlay('Expedição', 'Carregando carga…', 'Carga #' + cd);
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    })
      .then(function () {
        return api('/wms/expedicao/cargas/' + encodeURIComponent(cd) + '?rapido=1');
      })
      .then(function (payload) {
        if (seq !== detalheValidacaoSeq) return null;
        payload.validacaoPendente = true;
        renderDetalhe(payload);
        estoquePainelCarregando();
        divergenciasPainelCarregando();
        showLoadingOverlay('Expedição', 'Validando NF × OPL e estoque…', 'Carga #' + cd);
        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        });
      })
      .then(function () {
        if (seq !== detalheValidacaoSeq) return null;
        return api(
          '/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/validacao' + refreshQ
        );
      })
      .then(function (val) {
        if (!val || seq !== detalheValidacaoSeq) return;
        if (!state.selecionada || Number(pick(state.selecionada, 'CD_CARGA')) !== Number(cd)) return;
        aplicarValidacaoDetalhe(val);
      })
      .catch(function (err) {
        if (seq !== detalheValidacaoSeq) return;
        showMessage(err.message || 'Erro ao carregar detalhe da carga.', 'error', { autoHideMs: 9000 });
      })
      .finally(function () {
        if (seq === detalheValidacaoSeq) hideLoadingOverlay();
      });
  }

  function iniciarExpedicao() {
    esconderPainelAlerta();
    removerDestaqueErroInputs();
    if (!state.selecionada) {
      showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 7000);
      return;
    }
    var conferente = (byId('inputConferenteExp').value || '').trim();
    var motorista = (byId('inputMotoristaExp').value || '').trim();
    var placa = (byId('inputPlacaExp').value || '').trim().toUpperCase();
    if (!conferente) {
      showPainelAlerta('Informe o conferente.', 'warning', 'inputConferenteExp', ['inputConferenteExp'], 0);
      return;
    }
    if (!motorista) {
      showPainelAlerta('Informe o motorista.', 'warning', 'inputMotoristaExp', ['inputMotoristaExp'], 0);
      return;
    }
    if (!placa) {
      showPainelAlerta('Informe a placa.', 'warning', 'inputPlacaExp', ['inputPlacaExp'], 0);
      return;
    }
    var cd = pick(state.selecionada, 'CD_CARGA');
    fetch('/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/iniciar', {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({ NM_CONFERENTE: conferente, NM_MOTORISTA: motorista, PLACA: placa }),
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!r.ok) {
            var err = new Error(body.error || ('HTTP ' + r.status));
            err.status = r.status;
            err.body = body || {};
            throw err;
          }
          return body;
        });
    }).then(function () {
      limparDivergenciasPainel();
      return carregarDetalhe(cd, { refreshValidacao: true }).then(function () {
        return carregarLista(true);
      }).then(function () {
        setTimeout(function () {
          showPainelAlerta('Expedição iniciada com sucesso.', 'success', null, null, 6500);
        }, 100);
      });
    }).catch(function (err) {
      if (err && err.status === 409 && err.body && err.body.validacaoEstoque) {
        renderizarEstoquePainel(err.body.validacaoEstoque, state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null);
        atualizarBotoesExpedicao(state.selecionada);
      } else if (err && err.status === 422 && err.body && err.body.validacao) {
        renderizarDivergenciasPainel(err.body.validacao);
        if (err.body.validacao.validacaoEstoque) {
          renderizarEstoquePainel(
            err.body.validacao.validacaoEstoque,
            state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null
          );
        }
      } else {
        limparDivergenciasPainel();
      }
      showPainelAlerta(err.message || 'Erro ao iniciar expedição.', 'error', null, null, 10000);
    });
  }

  function liberarComDivergencia() {
    esconderPainelAlerta();
    if (!temPendenciaParaLiberar()) {
      showPainelAlerta(
        'Não há pendência de estoque/OPL ou divergência NF para liberação.',
        'warning',
        null,
        null,
        7000
      );
      return;
    }
    var justificativa = (byId('inputJustificativaBloqueio').value || '').trim();
    if (!justificativa || justificativa.length < 10) {
      showPainelAlerta(
        'Informe a justificativa para liberar (mínimo 10 caracteres).',
        'warning',
        'inputJustificativaBloqueio',
        ['inputJustificativaBloqueio'],
        0
      );
      return;
    }
    var conferente = (byId('inputConferenteExp').value || '').trim();
    var motorista = (byId('inputMotoristaExp').value || '').trim();
    var placa = (byId('inputPlacaExp').value || '').trim().toUpperCase();
    if (!conferente || !motorista || !placa) {
      showPainelAlerta('Preencha conferente, motorista e placa antes de liberar.', 'warning', null, null, 8000);
      return;
    }
    var autorizadoLogin = (byId('inputAutorizadoLogin').value || '').trim();
    if (!autorizadoLogin) {
      showPainelAlerta(
        'Informe o usuário autorizador.',
        'warning',
        'inputAutorizadoLogin',
        ['inputAutorizadoLogin'],
        0
      );
      return;
    }
    var autorizadoSenha = (byId('inputAutorizadoSenha').value || '').trim();
    if (!autorizadoSenha) {
      showPainelAlerta(
        'Informe a senha do usuário autorizador.',
        'warning',
        'inputAutorizadoSenha',
        ['inputAutorizadoSenha'],
        0
      );
      return;
    }
    var cd = pick(state.selecionada, 'CD_CARGA');
    var stAtual = String(pick(state.selecionada, 'ST_EXPEDICAO') || 'PRONTA_EXPEDICAO').toUpperCase();
    var endpoint =
      stAtual === 'EM_EXPEDICAO'
        ? '/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/confirmar-saida'
        : '/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/iniciar';
    var payloadLib = {
      NM_CONFERENTE: conferente,
      NM_MOTORISTA: motorista,
      PLACA: placa,
      forcarComDivergencia: true,
      justificativaBloqueio: justificativa,
      autorizadoLogin: autorizadoLogin,
      autorizadoSenha: autorizadoSenha,
    };
    fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify(payloadLib),
    })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!r.ok) {
              var err = new Error(body.error || ('HTTP ' + r.status));
              err.status = r.status;
              err.body = body || {};
              throw err;
            }
            return body;
          });
      })
      .then(function () {
        limparDivergenciasPainel();
        return carregarDetalhe(cd, { refreshValidacao: true }).then(function () {
          return carregarLista(true);
        });
      })
      .then(function () {
        showPainelAlerta(
          stAtual === 'EM_EXPEDICAO'
            ? 'Saída liberada com justificativa e confirmada com sucesso.'
            : 'Expedição liberada com justificativa e iniciada com sucesso.',
          'success',
          null,
          null,
          9000
        );
      })
      .catch(function (err) {
        if (err && err.status === 409 && err.body && err.body.validacaoEstoque) {
          renderizarEstoquePainel(err.body.validacaoEstoque, state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null);
          atualizarBotoesExpedicao(state.selecionada);
        } else if (err && err.status === 422 && err.body && err.body.validacao) {
          renderizarDivergenciasPainel(err.body.validacao);
          if (err.body.validacao.validacaoEstoque || err.body.validacaoEstoque) {
          renderizarEstoquePainel(
            err.body.validacao.validacaoEstoque || err.body.validacaoEstoque,
            state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null
          );
        }
        }
        showPainelAlerta(err.message || 'Erro ao liberar com divergência.', 'error', null, null, 12000);
      });
  }

  function executarReabrirExpedicao(cd, justificativa, autorizadoLogin, autorizadoSenha) {
    fetch('/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/reabrir', {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({
        justificativa: justificativa,
        autorizadoLogin: autorizadoLogin,
        autorizadoSenha: autorizadoSenha,
      }),
    })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!r.ok) {
              var err = new Error(body.error || 'HTTP ' + r.status);
              err.status = r.status;
              err.body = body || {};
              throw err;
            }
            return body;
          });
      })
      .then(function (body) {
        byId('inputMotoristaExp').value = '';
        byId('inputPlacaExp').value = '';
        var jR = byId('inputJustificativaReabrir');
        var lR = byId('inputReabrirAutorizadoLogin');
        var sR = byId('inputReabrirAutorizadoSenha');
        if (jR) jR.value = '';
        if (lR) lR.value = '';
        if (sR) sR.value = '';
        var msg =
          (body && body.mensagem) ||
          'Expedição reaberta. Informe motorista e placa e confirme a saída.';
        return carregarDetalhe(cd, { refreshValidacao: true }).then(function () {
          return carregarLista(true);
        }).then(function () {
          setTimeout(function () {
            showPainelAlerta(msg, 'success', 'inputMotoristaExp', null, 12000);
          }, 100);
        });
      })
      .catch(function (err) {
        showPainelAlerta(err.message || 'Erro ao reabrir expedição.', 'error', null, null, 12000);
      });
  }

  function voltarMontagemExpedicao() {
    esconderPainelAlerta();
    if (!state.selecionada) {
      showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 7000);
      return;
    }
    var st = String(pick(state.selecionada, 'ST_EXPEDICAO') || '').toUpperCase();
    if (st !== 'EM_EXPEDICAO') {
      showPainelAlerta('Só cargas «Em expedição» (saída ainda não confirmada) podem voltar à montagem.', 'warning', null, null, 8000);
      return;
    }
    var cd = pick(state.selecionada, 'CD_CARGA');
    var msgConfirm =
      'Devolver a carga #' +
      cd +
      ' para montagem?\n\n' +
      '• Libera Cargas Programadas para incluir ou remover NF-e\n' +
      '• A expedição fica «Pronta» — será preciso iniciar de novo depois\n' +
      '• Reservas OPL e picking já feitos permanecem no WMS';
    var promConfirm =
      typeof window.confirmPadrao === 'function'
        ? window.confirmPadrao(msgConfirm, {
            title: 'Voltar para montagem',
            danger: false,
            confirmText: 'Voltar p/ montagem',
            cancelText: 'Cancelar',
          })
        : Promise.resolve(window.confirm(msgConfirm));
    promConfirm.then(function (ok) {
      if (!ok) return;
      fetch('/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/voltar-montagem', {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({}),
      })
        .then(function (r) {
          return r
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
              return body;
            });
        })
        .then(function (body) {
          var msg =
            (body && body.mensagem) ||
            'Carga liberada para montagem. Abra Cargas Programadas para incluir NF-e.';
          return carregarDetalhe(cd, { refreshValidacao: true }).then(function () {
            return carregarLista(true);
          }).then(function () {
            setTimeout(function () {
              showPainelAlerta(msg, 'success', null, null, 12000);
            }, 100);
          });
        })
        .catch(function (err) {
          showPainelAlerta(err.message || 'Erro ao devolver carga à montagem.', 'error', null, null, 10000);
        });
    });
  }

  function reabrirExpedicao() {
    esconderPainelAlerta();
    if (!state.selecionada) {
      showPainelAlerta('Selecione uma carga expedida.', 'warning', null, null, 6000);
      return;
    }
    var st = String(pick(state.selecionada, 'ST_EXPEDICAO') || '').toUpperCase();
    if (st !== 'EXPEDIDA') {
      showPainelAlerta('Só cargas com status Expedida podem ser reabertas.', 'warning', null, null, 8000);
      return;
    }
    var justificativa = (byId('inputJustificativaReabrir').value || '').trim();
    if (!justificativa) {
      showPainelAlerta(
        'Informe a justificativa no painel «Reabrir expedição» (caixa amarela acima do botão).',
        'warning',
        'inputJustificativaReabrir',
        ['inputJustificativaReabrir'],
        0
      );
      return;
    }
    var autorizadoLogin = (byId('inputReabrirAutorizadoLogin').value || '').trim();
    var autorizadoSenha = (byId('inputReabrirAutorizadoSenha').value || '').trim();
    if (!autorizadoLogin || !autorizadoSenha) {
      showPainelAlerta(
        'Informe usuário e senha do autorizador no painel «Reabrir expedição».',
        'warning',
        'inputReabrirAutorizadoLogin',
        ['inputReabrirAutorizadoLogin', 'inputReabrirAutorizadoSenha'],
        0
      );
      return;
    }
    var cd = pick(state.selecionada, 'CD_CARGA');
    var msgConfirm =
      'Deseja reabrir a expedição da carga #' +
      cd +
      '?\n\n' +
      '• Volta para «Em expedição»\n' +
      '• Estorna saída de estoque no WMS\n' +
      '• Recria reservas OPL\n\n' +
      'Depois informe o NOVO motorista e placa e confirme a saída novamente.';
    var promConfirm =
      typeof window.confirmPadrao === 'function'
        ? window.confirmPadrao(msgConfirm, {
            title: 'Reabrir expedição',
            danger: true,
            confirmText: 'Reabrir expedição',
            cancelText: 'Cancelar',
          })
        : Promise.resolve(window.confirm(msgConfirm));
    promConfirm.then(function (ok) {
      if (!ok) return;
      executarReabrirExpedicao(cd, justificativa, autorizadoLogin, autorizadoSenha);
    });
  }

  function confirmarSaida() {
    esconderPainelAlerta();
    removerDestaqueErroInputs();
    if (!state.selecionada) {
      showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 7000);
      return;
    }
    var conferente = (byId('inputConferenteExp').value || '').trim();
    var motorista = (byId('inputMotoristaExp').value || '').trim();
    var placa = (byId('inputPlacaExp').value || '').trim().toUpperCase();
    var confGravado = String(pick(state.selecionada, 'NM_CONFERENTE') || '').trim();
    if (!conferente && !confGravado) {
      showPainelAlerta('Informe o conferente.', 'warning', 'inputConferenteExp', ['inputConferenteExp'], 0);
      return;
    }
    if (!motorista) {
      showPainelAlerta('Informe o motorista.', 'warning', 'inputMotoristaExp', ['inputMotoristaExp'], 0);
      return;
    }
    if (!placa) {
      showPainelAlerta('Informe a placa.', 'warning', 'inputPlacaExp', ['inputPlacaExp'], 0);
      return;
    }
    var cd = pick(state.selecionada, 'CD_CARGA');
    fetch('/api/wms/expedicao/cargas/' + encodeURIComponent(cd) + '/confirmar-saida', {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({
        NM_CONFERENTE: conferente || confGravado,
        NM_MOTORISTA: motorista,
        PLACA: placa,
      }),
    })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!r.ok) {
              var err = new Error(body.error || 'HTTP ' + r.status);
              err.status = r.status;
              err.body = body || {};
              throw err;
            }
            return body;
          });
      })
      .then(function () {
        return carregarDetalhe(cd, { refreshValidacao: true }).then(function () {
          return carregarLista(true);
        }).then(function () {
          setTimeout(function () {
            showPainelAlerta('Saída confirmada com sucesso.', 'success', null, null, 8000);
          }, 100);
        });
      })
      .catch(function (err) {
        if (err && err.status === 409 && err.body && err.body.validacaoEstoque) {
          renderizarEstoquePainel(err.body.validacaoEstoque, state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null);
          atualizarBotoesExpedicao(state.selecionada);
        } else if (err && err.status === 422 && err.body && err.body.validacao) {
          renderizarDivergenciasPainel(err.body.validacao);
          if (err.body.validacaoEstoque) {
            renderizarEstoquePainel(
              err.body.validacaoEstoque,
              state.selecionada ? ctxExpedicaoCarga(state.selecionada) : null
            );
          }
          atualizarBotoesExpedicao(state.selecionada);
          aplicarPermissaoLiberacaoUI();
        }
        showPainelAlerta(err.message || 'Erro ao confirmar saída.', 'error', null, null, 10000);
      });
  }

  function fecharModalRomResumoExp() {
    var bd = byId('rsRomBackdrop');
    if (bd) bd.style.display = 'none';
  }
  function legendaLinhasRomModalExp(aEl) {
    return aEl && aEl.value === '1' ? 'Linhas agrupadas' : 'Linhas detalhadas';
  }
  function atualizarExRomTituloDinamicoExp() {
    var el = byId('exRomTituloDinamicoExp');
    if (!el) return;
    var c = (byId('exRomConservacao') || {}).value || 'todos';
    var f = (byId('exRomFolhas') || {}).value || 'nota';
    var aEl = byId('exRomAgrupar');
    var cLab =
      c === 'refri' ? 'Só refrig./congelado' : c === 'seco' ? 'Só seco/amb.' : 'Todos os produtos';
    var flab =
      f === 'dest'
        ? 'Folhas: por destino'
        : f === 'endereco'
          ? 'Folhas: por endereço'
          : f === 'continuo'
            ? 'Folhas: contínuo'
            : 'Folhas: por NF';
    el.textContent = [
      cLab,
      flab,
      legendaLinhasRomModalExp(aEl),
      legendaDonoSelectExp('exRomCdDonoExp'),
      legendaComboRomExp('exRom', 'Unidade', 'Todas as unidades'),
      legendaComboRomExp('exRom', 'Destino', 'Todos os destinos'),
      legendaComboRomExp('exRom', 'Codigo', 'Todos os códigos'),
      'A4 vertical',
    ].join(' · ');
  }
  function atualizarRsRomAvisoContinuoTodosDonosExp() {
    var box = byId('rsRomAvisoContinuoDonosExp');
    if (!box) return;
    var f = (byId('rsRomFolhasExp') || {}).value || '';
    var d = (byId('rsRomCdDonoExp') || {}).value || '';
    var cd = d ? parseInt(d, 10) : NaN;
    var todosDonos = !Number.isFinite(cd) || cd <= 0;
    box.style.display = f === 'continuo' && todosDonos ? 'flex' : 'none';
  }
  function atualizarRsRomTituloDinamicoExp() {
    var el = byId('rsRomTituloDinamicoExp');
    if (!el) return;
    var c = (byId('rsRomConservacaoExp') || {}).value || 'todos';
    var f = (byId('rsRomFolhasExp') || {}).value || 'dono';
    var aEl = byId('rsRomAgruparExp');
    var cLab =
      c === 'refri' ? 'Só refrig./congelado' : c === 'seco' ? 'Só seco/amb.' : 'Todos os produtos';
    var fLab =
      f === 'nota'
        ? 'Por NF'
        : f === 'dest'
          ? 'Por destino'
          : f === 'endereco'
            ? 'Por endereço'
            : f === 'continuo'
              ? 'Contínuo'
              : 'Por dono';
    el.textContent = [
      cLab,
      fLab,
      legendaLinhasRomModalExp(aEl),
      legendaDonoSelectExp('rsRomCdDonoExp'),
      legendaComboRomExp('rsRom', 'Unidade', 'Todas as unidades'),
      legendaComboRomExp('rsRom', 'Destino', 'Todos os destinos'),
      legendaComboRomExp('rsRom', 'Codigo', 'Todos os códigos'),
      'A4 vertical',
    ].join(' · ');
    atualizarRsRomAvisoContinuoTodosDonosExp();
  }
  function getRomResumoOrdemExp() {
    var ordem = [];
    for (var i = 1; i <= 5; i++) {
      var el = byId('rsRomOrd' + i + 'Exp');
      if (!el) continue;
      var v = (el.value || '').trim();
      if (!v) continue;
      if (ordem.indexOf(v) >= 0) continue;
      ordem.push(v);
    }
    return ordem;
  }
  function gerarRomResumoExp() {
    if (!state.selecionada) return;
    var cd = pick(state.selecionada, 'CD_CARGA');
    var q = new URLSearchParams();
    q.set('format', 'html');
    var cEl = byId('rsRomConservacaoExp');
    var aEl = byId('rsRomAgruparExp');
    var fEl = byId('rsRomFolhasExp');
    var dEl = byId('rsRomCdDonoExp');
    q.set('conservacao', cEl && cEl.value ? cEl.value : 'todos');
    q.set('agruparItens', aEl && aEl.value === '1' ? '1' : '0');
    q.set('folhas', fEl && fEl.value ? fEl.value : 'dono');
    var cdDono = dEl && dEl.value ? parseInt(dEl.value, 10) : NaN;
    if (Number.isFinite(cdDono) && cdDono > 0) q.set('cdDono', String(cdDono));
    var ordem = getRomResumoOrdemExp();
    if (ordem.length) q.set('ordem', ordem.join(','));
    appendFiltrosGeoRomQueryExp(q, 'rsRom');
    fecharModalRomResumoExp();
    abrirImpressaoHtml('/api/wms/cargas/programadas/' + encodeURIComponent(String(cd)) + '/romaneio?' + q.toString());
  }
  function fecharModalRomFriosExp() {
    var bd = byId('exRomBackdrop');
    if (bd) bd.style.display = 'none';
  }
  function getRomFriosOrdemExp() {
    var ordem = [];
    for (var i = 1; i <= 5; i++) {
      var el = byId('exRomOrd' + i);
      if (!el) continue;
      var v = (el.value || '').trim();
      if (!v) continue;
      if (ordem.indexOf(v) >= 0) continue;
      ordem.push(v);
    }
    return ordem;
  }
  function gerarRomFriosExp() {
    if (!state.selecionada) return;
    var cd = pick(state.selecionada, 'CD_CARGA');
    var q = new URLSearchParams();
    var cEl = byId('exRomConservacao');
    var aEl = byId('exRomAgrupar');
    var fEl = byId('exRomFolhas');
    var dEl = byId('exRomCdDonoExp');
    q.set('conservacao', cEl && cEl.value ? cEl.value : 'todos');
    q.set('agruparItens', aEl && aEl.value === '1' ? '1' : '0');
    q.set('folhas', fEl && fEl.value ? fEl.value : 'nota');
    var cdDono = dEl && dEl.value ? parseInt(dEl.value, 10) : NaN;
    if (Number.isFinite(cdDono) && cdDono > 0) q.set('cdDono', String(cdDono));
    var ordem = getRomFriosOrdemExp();
    if (ordem.length) q.set('ordem', ordem.join(','));
    appendFiltrosGeoRomQueryExp(q, 'exRom');
    fecharModalRomFriosExp();
    abrirImpressaoHtml(
      '/api/wms/cargas/programadas/' + encodeURIComponent(String(cd)) + '/relatorios/frios?' + q.toString()
    );
  }
  /** Abre o relatório de divergências (NF-e × separação física) da carga selecionada,
   *  em nova aba, para impressão. Use para validar estoque físico × fiscal contábil. */
  function registrarEventosExpedicao() {
    bindIf('listaCargasExpedicao', 'click', function (ev) {
      var item = ev.target.closest('.exp-item[data-carga]');
      if (!item) return;
      esconderPainelAlerta();
      var cd = Number(item.getAttribute('data-carga'));
      if (Number.isFinite(cd) && cd > 0) carregarDetalhe(cd);
    });
    bindIf('formFiltrosExpedicao', 'submit', function (e) {
      e.preventDefault();
      carregarLista(false);
    });
    bindIf('btnLimparExpedicao', 'click', function () {
      var f = byId('filtroStatusExpedicao');
      if (f) f.value = '';
      carregarLista(false);
    });
    bindIf('btnAtualizarExpedicao', 'click', function () {
      var cdSel = state.selecionada ? pick(state.selecionada, 'CD_CARGA') : null;
      carregarLista(true).then(function () {
        if (cdSel) return carregarDetalhe(cdSel, { refreshValidacao: true });
      });
    });
    bindIf('btnIniciarExpedicao', 'click', iniciarExpedicao);
    bindIf('btnLiberarComDivergencia', 'click', liberarComDivergencia);
    bindIf('btnConfirmarSaidaExp', 'click', confirmarSaida);
    bindIf('btnVoltarMontagemExp', 'click', voltarMontagemExpedicao);
    bindIf('btnReabrirExpedicao', 'click', reabrirExpedicao);
    bindIf('btnImprimirResumoExp', 'click', function () {
      if (!state.selecionada) {
        showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 6000);
        return;
      }
      var bd = byId('rsRomBackdrop');
      if (bd) bd.style.display = 'flex';
      preencherSelectsDonoRomExp();
      atualizarRsRomTituloDinamicoExp();
    });
    bindIf('btnImprimirFriosExp', 'click', function () {
      if (!state.selecionada) {
        showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 6000);
        return;
      }
      var bd = byId('exRomBackdrop');
      if (bd) bd.style.display = 'flex';
      preencherSelectsDonoRomExp();
      atualizarExRomTituloDinamicoExp();
    });
    bindIf('btnExRomFechar', 'click', fecharModalRomFriosExp);
    bindIf('btnExRomGerar', 'click', gerarRomFriosExp);
    bindIf('exRomBackdrop', 'click', function (ev) {
      if (ev.target && ev.target.id === 'exRomBackdrop') fecharModalRomFriosExp();
    });
    bindIf('btnRsRomFecharExp', 'click', fecharModalRomResumoExp);
    bindIf('btnRsRomGerarExp', 'click', gerarRomResumoExp);
    bindIf('rsRomBackdrop', 'click', function (ev) {
      if (ev.target && ev.target.id === 'rsRomBackdrop') fecharModalRomResumoExp();
    });
    bindIf('btnVoltarEstoque', 'click', function () {
      if (window.parent && typeof window.parent.loadModuleContent === 'function') {
        window.parent.loadModuleContent('estoque');
      }
    });
    bindIf('btnImprimirDivergenciasExp', 'click', function () {
      if (!state.selecionada) {
        showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 6000);
        return;
      }
      var cd = pick(state.selecionada, 'CD_CARGA');
      abrirImpressaoHtml(
        '/api/wms/expedicao/cargas/' + encodeURIComponent(String(cd)) + '/relatorio-divergencias'
      );
    });
    bindIf('expEstoqueBody', 'click', function (ev) {
      var btn = ev.target.closest('.exp-btn-aplicar-reserva');
      if (!btn) return;
      var cdOpl = btn.getAttribute('data-cd-opl');
      if (cdOpl) aplicarReservasOplExp(cdOpl);
    });
    bindIf('btnRevalidarCargaExp', 'click', function () {
      var btnRevalCarga = byId('btnRevalidarCargaExp');
      if (!state.selecionada) {
        showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 6000);
        return;
      }
      var cd = pick(state.selecionada, 'CD_CARGA');
      var labelOrig = btnRevalCarga ? btnRevalCarga.innerHTML : '';
      if (btnRevalCarga) {
        btnRevalCarga.disabled = true;
        btnRevalCarga.innerHTML = '<i class="bx bx-loader bx-spin"></i> Revalidando...';
      }
      fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(cd)) + '/revalidar', {
        method: 'POST',
        headers: getAuthHeaders(),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText || 'Falha na revalidação.');
            return j;
          });
        })
        .then(function (validacao) {
          var c = validacao && validacao.contadores ? validacao.contadores : {};
          var totalDiv = Array.isArray(validacao && validacao.divergencias) ? validacao.divergencias.length : 0;
          var partes = [];
          if (totalDiv > 0) partes.push(totalDiv + ' divergência(s)');
          if (c.faltas) partes.push(c.faltas + ' falta(s)');
          if (c.sobras) partes.push(c.sobras + ' sobra(s)');
          if (c.semPedido) partes.push(c.semPedido + ' sem pedido');
          if (c.semNf) partes.push(c.semNf + ' separado(s) sem NF');
          var resumo = partes.length ? partes.join(' · ') : 'Sem divergências';
          showMessage('Carga revalidada: ' + resumo + '. Recarregando detalhe...', 'success', { autoHideMs: 6000 });
          if (validacao) renderizarDivergenciasPainel(validacao);
          aplicarPermissaoLiberacaoUI();
          return carregarDetalhe(cd, { refreshValidacao: true });
        })
        .catch(function (err) {
          showMessage(err.message || 'Erro ao revalidar carga.', 'error', { autoHideMs: 10000 });
        })
        .finally(function () {
          if (btnRevalCarga) {
            btnRevalCarga.innerHTML = labelOrig;
            btnRevalCarga.disabled = false;
          }
        });
    });
    bindIf('btnExportarDivergenciasCsvExp', 'click', function () {
      if (!state.selecionada) {
        showPainelAlerta('Selecione uma carga na lista à esquerda.', 'warning', null, null, 6000);
        return;
      }
      var cd = pick(state.selecionada, 'CD_CARGA');
      var url = '/api/wms/expedicao/cargas/' + encodeURIComponent(String(cd)) + '/relatorio-divergencias.csv';
      fetch(url, { headers: getAuthHeaders() })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error(t || r.statusText || 'Erro ao gerar CSV.');
            });
          }
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement('a');
          var dlUrl = URL.createObjectURL(blob);
          a.href = dlUrl;
          a.download = 'divergencias_expedicao_carga_' + cd + '_' + new Date().toISOString().slice(0, 10) + '.csv';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(dlUrl);
            a.remove();
          }, 200);
          showMessage('CSV de divergências exportado.', 'success', { autoHideMs: 4000 });
        })
        .catch(function (err) {
          showMessage(err.message || 'Erro ao exportar CSV.', 'error', { autoHideMs: 10000 });
        });
    });
    [
      'exRomConservacao',
      'exRomAgrupar',
      'exRomFolhas',
      'exRomCdDonoExp',
      'exRomUnidadeExp',
      'exRomDestinoExp',
      'exRomCodigoExp',
      'exRomOrd1',
      'exRomOrd2',
      'exRomOrd3',
      'exRomOrd4',
      'exRomOrd5',
    ].forEach(function (id) {
      var n = byId(id);
      if (n) n.addEventListener('change', atualizarExRomTituloDinamicoExp);
    });
    [
      'rsRomConservacaoExp',
      'rsRomAgruparExp',
      'rsRomFolhasExp',
      'rsRomCdDonoExp',
      'rsRomUnidadeExp',
      'rsRomDestinoExp',
      'rsRomCodigoExp',
      'rsRomOrd1Exp',
      'rsRomOrd2Exp',
      'rsRomOrd3Exp',
      'rsRomOrd4Exp',
      'rsRomOrd5Exp',
    ].forEach(function (id) {
      var n = byId(id);
      if (n) n.addEventListener('change', atualizarRsRomTituloDinamicoExp);
    });
    ['exRom', 'rsRom'].forEach(function (prefix) {
      var selU = byId(romGeoIdExp(prefix, 'Unidade'));
      if (selU) {
        selU.addEventListener('change', function () {
          aplicarFiltroDestinoRomExp(prefix);
          if (prefix === 'exRom') atualizarExRomTituloDinamicoExp();
          else atualizarRsRomTituloDinamicoExp();
        });
      }
    });
  }

  function iniciarModuloExpedicao() {
    if (!byId('listaCargasExpedicao') && !byId('formFiltrosExpedicao')) {
      setTimeout(iniciarModuloExpedicao, 0);
      return;
    }
    var root = byId('listaCargasExpedicao') || byId('formFiltrosExpedicao');
    if (root && root.getAttribute('data-exp-inited') === '1') {
      carregarLista(false);
      return;
    }
    if (root) root.setAttribute('data-exp-inited', '1');
    if (typeof registrarEventosExpedicao === 'function') registrarEventosExpedicao();
    carregarPermissaoLiberacao().finally(function () {
      carregarLista(false);
    });
  }

  iniciarModuloExpedicao();
})();
