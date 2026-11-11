(function () {
  var cdOplArquivoAtual = null;
  var lastDetalhe = null;
  var oplPendingExcluirId = null;
  var oplSimCheckboxBound = false;

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

  function apiUrl(path) {
    return typeof window.corrigirUrl === 'function' ? window.corrigirUrl(path) : path;
  }

  var messageEl = document.getElementById('message');
  function showMessage(text, type) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, messageEl);
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
    if (c) c.textContent = det || '';
    o.style.cssText =
      'display:flex !important; position:fixed !important; inset:0; z-index:99999; background:rgba(0,0,0,0.75); align-items:center; justify-content:center;';
  }

  function hideLoadingOverlay() {
    var o = document.getElementById('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Código OL Mana / Teknisa: 10 caracteres alfanuméricos → d.dd.dd.ddd.dd (igual romaneio).
   * Ex.: 6010305100 → 6.01.03.051.00 / 63109100AA → 6.31.09.100.AA
   * Se não tiver exatamente 10 caracteres alfanuméricos, devolve o valor original (sem máscara).
   */
  function mascaraCodigoOl(cod) {
    var original = String(cod != null ? cod : '').trim();
    if (!original) return '';
    var raw = original.replace(/[^0-9A-Za-z]/g, '');
    if (raw.length !== 10) return original;
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

  function fixMojibakeNome(s) {
    if (!s || typeof s !== 'string') return s || '';
    if (!/Ã.|Â./.test(s)) return s;
    try {
      var a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
      return new TextDecoder('utf-8').decode(a);
    } catch (e) {
      return s;
    }
  }

  function parseNumLoose(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }

  /** Quantidade para exibição: inteiros sem decimais (28 em vez de 28.000000). */
  function fmtQtd(v) {
    if (v == null || v === '') return '—';
    var n = typeof v === 'number' ? v : parseNumLoose(v);
    if (n == null) return String(v);
    if (Math.abs(n - Math.round(n)) < 1e-9) {
      return Math.round(n).toLocaleString('pt-BR');
    }
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function fmtQtdEsc(v) {
    return escapeHtml(fmtQtd(v));
  }

  function romaneioSeparadoresAtivos() {
    var sepEl = document.getElementById('romSeparadoresGrupo');
    var modo = sepEl && sepEl.value ? sepEl.value : 'auto';
    if (modo === 'faixas_cons' || modo === 'conservacao' || modo === 'cons_grupo' || modo === 'cons_grupo_cat' || modo === 'sim') return true;
    if (modo === 'nao') return false;
    var ordem = getRomaneioOrdemSelecionada();
    return ordem.some(function (c) {
      return (
        c === 'conservacao' ||
        c === 'grupo' ||
        c === 'subcategoria' ||
        c === 'categoria' ||
        c === 'classe'
      );
    });
  }

  var ROMANEIO_ORDEM_OPCOES = [
    { v: 'unidade', l: 'Unidade (cidade/UF)' },
    { v: 'destino', l: 'Destino (cliente)' },
    { v: 'conservacao', l: 'Conservação' },
    { v: 'grupo', l: 'Grupo (cadastro WMS)' },
    { v: 'subcategoria', l: 'Categoria (cadastro WMS)' },
    { v: 'categoria', l: 'Grupo/subgrupo OL (legado)' },
    { v: 'classe', l: 'Classe OL (conserv. + categoria)' },
    { v: 'nome', l: 'Nome do produto' },
    { v: 'codigo', l: 'Código OL' },
  ];

  var ROMANEIO_ORDEM_SUGESTAO = {
    nao: ['unidade', 'destino', 'conservacao', 'grupo', 'nome'],
    faixas_cons: ['unidade', 'destino', 'conservacao', 'grupo', 'nome'],
    conservacao: ['unidade', 'destino', 'conservacao', 'grupo', 'nome'],
    cons_grupo: ['unidade', 'destino', 'conservacao', 'grupo', 'nome'],
    cons_grupo_cat: ['unidade', 'destino', 'conservacao', 'grupo', 'nome'],
  };

  function montarOpcoesOrdemRomaneio(selectEl, comVazio) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    ROMANEIO_ORDEM_OPCOES.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.l;
      selectEl.appendChild(opt);
    });
    if (comVazio) {
      var vazio = document.createElement('option');
      vazio.value = '';
      vazio.textContent = '(não usar)';
      selectEl.appendChild(vazio);
    }
  }

  function aplicarSugestaoOrdemRomaneio(forcar) {
    var ord1 = document.getElementById('romOrd1');
    if (!ord1) return;
    if (!forcar && ord1.dataset.userTouched === '1') return;
    var sepEl = document.getElementById('romSeparadoresGrupo');
    var modo = sepEl && sepEl.value ? sepEl.value : 'cons_grupo_cat';
    var sug = ROMANEIO_ORDEM_SUGESTAO[modo] || ROMANEIO_ORDEM_SUGESTAO.cons_grupo_cat;
    ['romOrd1', 'romOrd2', 'romOrd3', 'romOrd4', 'romOrd5'].forEach(function (id, idx) {
      var el = document.getElementById(id);
      if (el) el.value = sug[idx] || '';
    });
  }

  function initRomaneioOrdemSelects() {
    montarOpcoesOrdemRomaneio(document.getElementById('romOrd1'), false);
    ['romOrd2', 'romOrd3', 'romOrd4', 'romOrd5'].forEach(function (id) {
      montarOpcoesOrdemRomaneio(document.getElementById(id), true);
    });
    aplicarSugestaoOrdemRomaneio(true);
  }

  function syncRomaneioColunaCadDefault() {
    var chk = document.getElementById('romExibirColunaCad');
    if (!chk || chk.dataset.userTouched === '1') return;
    chk.checked = !romaneioSeparadoresAtivos();
  }

  function getRomaneioOrdemSelecionada() {
    var camposValidos = {
      unidade: true,
      destino: true,
      conservacao: true,
      grupo: true,
      subcategoria: true,
      categoria: true,
      classe: true,
      nome: true,
      codigo: true,
    };
    var ids = ['romOrd1', 'romOrd2', 'romOrd3', 'romOrd4', 'romOrd5'];
    var ordem = [];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      var v = el && typeof el.value === 'string' ? el.value.trim().toLowerCase() : '';
      if (!v || !camposValidos[v]) return;
      if (ordem.indexOf(v) >= 0) return;
      ordem.push(v);
    });
    return ordem;
  }

  /** Cache local com todos os destinatários e seu vínculo com unidades
   *  (cidade/UF). Permite filtragem encadeada Unidade → Destinatário sem
   *  precisar refazer a varredura dos pedidos a cada change. */
  var destinatariosCache = [];

  /** Cache completo conservação/grupo/categoria + combinações do espelho
   *  para filtro encadeado Conservação → Grupo → Categoria. */
  var opcoesCadastroRomaneioCache = {
    conservacoes: [],
    grupos: [],
    categorias: [],
    combinacoes: [],
  };

  function getMultiSelectValues(selId) {
    var sel = document.getElementById(selId);
    if (!sel) return [];
    var out = [];
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) out.push(sel.options[i].value);
    return out;
  }

  function popularSelectComContador(selId, contId, valores, totalEspelho, prevSel) {
    var sel = document.getElementById(selId);
    if (!sel) return;
    var prev = prevSel;
    if (!prev) {
      prev = [];
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) prev.push(sel.options[i].value);
    }
    var setPrev = {};
    prev.forEach(function (v) { setPrev[v] = true; });
    sel.innerHTML = '';
    (valores || []).forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (setPrev[v]) opt.selected = true;
      sel.appendChild(opt);
    });
    var cont = document.getElementById(contId);
    if (cont) {
      var n = (valores || []).length;
      var tot = totalEspelho != null ? totalEspelho : n;
      cont.textContent =
        tot > n ? '(' + n + ' de ' + tot + ' no espelho)' : '(' + tot + ' no espelho)';
    }
  }

  /** Conservação selecionada → limita Grupo; Conservação+Grupo → limita Categoria. */
  function aplicarFiltroCadastroRomaneioEncadeado(opts) {
    opts = opts || {};
    var combos = opcoesCadastroRomaneioCache.combinacoes || [];
    var consSel = getMultiSelectValues('romFiltroConservacoes');
    var setCons = {};
    consSel.forEach(function (v) { setCons[v] = true; });
    var nCons = consSel.length;

    var combosAposCons = combos.filter(function (c) {
      return nCons === 0 || setCons[c.conservacao];
    });

    var gruposVis = {};
    combosAposCons.forEach(function (c) {
      if (c.grupo) gruposVis[c.grupo] = true;
    });
    var gruposLista = Object.keys(gruposVis).sort(function (a, b) {
      return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    });
    popularSelectComContador(
      'romFiltroGrupos',
      'romFiltroGrupoContador',
      gruposLista,
      (opcoesCadastroRomaneioCache.grupos || []).length,
      opts.prevGrupos
    );

    var gruposSel = getMultiSelectValues('romFiltroGrupos');
    var setGrupo = {};
    gruposSel.forEach(function (v) { setGrupo[v] = true; });
    var nGrupo = gruposSel.length;

    var catsVis = {};
    combosAposCons.forEach(function (c) {
      if (nGrupo > 0 && !setGrupo[c.grupo]) return;
      if (c.categoria) catsVis[c.categoria] = true;
    });
    var catsLista = Object.keys(catsVis).sort(function (a, b) {
      return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    });
    popularSelectComContador(
      'romFiltroCategorias',
      'romFiltroCatContador',
      catsLista,
      (opcoesCadastroRomaneioCache.categorias || []).length,
      opts.prevCategorias
    );

    atualizarResumoFiltrosImpressaoOpl();
  }

  /** Popula os selects (destinatários, unidades, conservação/grupo/categoria) do bloco
   *  "Filtros para impressão específica" a partir do detalhe da importação carregada. */
  function popularFiltrosImpressaoOpl(data) {
    var pedidos = (data && data.pedidos) || [];
    var selDest = document.getElementById('romFiltroDestinatarios');
    var selUnid = document.getElementById('romFiltroUnidades');

    var destMap = {};
    var unidMap = {};
    /** Vínculo destinatário → conjunto de unidades onde ele entrega.
     *  Um mesmo destinatário pode atender várias cidades (frota distribuída),
     *  então usamos Set para evitar duplicidade. */
    var destUnidades = {};
    pedidos.forEach(function (p) {
      var cod = String(p.COD_DESTINATARIO != null ? p.COD_DESTINATARIO : '').trim();
      var raz = String(p.RAZ_SOC_DEST != null ? p.RAZ_SOC_DEST : '').trim();
      if (cod && !destMap[cod]) destMap[cod] = raz;
      var cid = String(p.CIDADE_ENTREGA != null ? p.CIDADE_ENTREGA : '').trim();
      var uf = String(p.UF_ENTREGA != null ? p.UF_ENTREGA : '').trim();
      var k = (cid + '|' + uf).toUpperCase();
      if ((cid || uf) && !unidMap[k]) unidMap[k] = (cid + ' ' + uf).trim();
      if (cod && (cid || uf)) {
        if (!destUnidades[cod]) destUnidades[cod] = {};
        destUnidades[cod][k] = true;
      }
    });

    function manterSelecoes(sel) {
      var prev = [];
      if (sel) {
        for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) prev.push(sel.options[i].value);
      }
      return prev;
    }

    /** Monta o cache `destinatariosCache` em ordem alfabética estável. */
    destinatariosCache = Object.keys(destMap).sort().map(function (c) {
      var raz = destMap[c] || '';
      var label = raz ? c + ' — ' + (raz.length > 50 ? raz.slice(0, 50) + '…' : raz) : c;
      return { value: c, label: label, unidades: destUnidades[c] || {} };
    });

    if (selUnid) {
      var prevUnid = manterSelecoes(selUnid);
      var unids = Object.keys(unidMap).sort();
      selUnid.innerHTML = '';
      unids.forEach(function (u) {
        var opt = document.createElement('option');
        opt.value = u;
        opt.textContent = unidMap[u] || u;
        selUnid.appendChild(opt);
      });
      // Reaplica seleções antigas
      var setSelU = {};
      prevUnid.forEach(function (v) { setSelU[v] = true; });
      for (var i = 0; i < selUnid.options.length; i++) {
        if (setSelU[selUnid.options[i].value]) selUnid.options[i].selected = true;
      }
      var cont2 = document.getElementById('romFiltroUnidContador');
      if (cont2) cont2.textContent = '(' + unids.length + ' no espelho)';
    }

    /** Renderiza destinatários já considerando o filtro de unidades atual
     *  (filtro encadeado — solicitado pelo usuário). */
    if (selDest) {
      var prevDest = manterSelecoes(selDest);
      aplicarFiltroDestPorUnidade(prevDest);
    }

    var op = (data && data.opcoesFiltroRomaneio) || {};
    opcoesCadastroRomaneioCache = {
      conservacoes: op.conservacoes || [],
      grupos: op.grupos || [],
      categorias: op.categorias || [],
      combinacoes: op.combinacoes || [],
    };
    var prevCons = getMultiSelectValues('romFiltroConservacoes');
    var prevGrupos = getMultiSelectValues('romFiltroGrupos');
    var prevCats = getMultiSelectValues('romFiltroCategorias');
    popularSelectComContador(
      'romFiltroConservacoes',
      'romFiltroConsContador',
      opcoesCadastroRomaneioCache.conservacoes,
      opcoesCadastroRomaneioCache.conservacoes.length,
      prevCons
    );
    aplicarFiltroCadastroRomaneioEncadeado({ prevGrupos: prevGrupos, prevCategorias: prevCats });
  }

  /** Filtra o select de Destinatários mostrando só os que atendem alguma
   *  das unidades atualmente selecionadas. Sem unidade selecionada = todos.
   *  Preserva as seleções anteriores que continuem visíveis no filtro. */
  function aplicarFiltroDestPorUnidade(preservarSelecoes) {
    var selDest = document.getElementById('romFiltroDestinatarios');
    var selUnid = document.getElementById('romFiltroUnidades');
    if (!selDest) return;

    /** Lê as unidades selecionadas (vazio = todas). */
    var unidsSel = {};
    var nUnidsSel = 0;
    if (selUnid) {
      for (var i = 0; i < selUnid.options.length; i++) {
        if (selUnid.options[i].selected) {
          unidsSel[selUnid.options[i].value] = true;
          nUnidsSel++;
        }
      }
    }

    /** Guarda as seleções atuais (se não foram explicitamente passadas)
     *  para que destinatários ainda visíveis no novo conjunto permaneçam
     *  marcados — UX mais previsível. */
    var prevSel = preservarSelecoes;
    if (!prevSel) {
      prevSel = [];
      for (var j = 0; j < selDest.options.length; j++) {
        if (selDest.options[j].selected) prevSel.push(selDest.options[j].value);
      }
    }
    var setPrev = {};
    prevSel.forEach(function (v) { setPrev[v] = true; });

    var visiveis = destinatariosCache.filter(function (d) {
      if (nUnidsSel === 0) return true;
      // Mostra o destinatário se ele tem PELO MENOS uma unidade na seleção.
      var unids = Object.keys(d.unidades);
      for (var k = 0; k < unids.length; k++) {
        if (unidsSel[unids[k]]) return true;
      }
      return false;
    });

    selDest.innerHTML = '';
    visiveis.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.value;
      opt.textContent = d.label;
      if (setPrev[d.value]) opt.selected = true;
      selDest.appendChild(opt);
    });

    /** Contador transparente: "(X de Y no espelho)" quando há filtro;
     *  "(Y no espelho)" quando não há. */
    var cont = document.getElementById('romFiltroDestContador');
    if (cont) {
      cont.textContent =
        nUnidsSel > 0 && visiveis.length !== destinatariosCache.length
          ? '(' + visiveis.length + ' de ' + destinatariosCache.length + ' no espelho)'
          : '(' + destinatariosCache.length + ' no espelho)';
    }
    atualizarResumoFiltrosImpressaoOpl();
  }

  /** Lê os filtros de impressão da UI e devolve um objeto pronto pra montar URLSearchParams. */
  function lerFiltrosImpressaoOpl() {
    function getMulti(id) {
      var sel = document.getElementById(id);
      if (!sel) return [];
      var out = [];
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) out.push(sel.options[i].value);
      return out;
    }
    function getText(id) {
      var el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    }
    var pedidosTxt = getText('romFiltroPedidos');
    var pedidosLista = pedidosTxt
      ? pedidosTxt.split(/[,;\s]+/).map(function (s) {
          return s.trim();
        }).filter(Boolean)
      : [];
    return {
      destinatarios: getMulti('romFiltroDestinatarios'),
      unidades: getMulti('romFiltroUnidades'),
      conservacoes: getMulti('romFiltroConservacoes'),
      grupos: getMulti('romFiltroGrupos'),
      categorias: getMulti('romFiltroCategorias'),
      pedidos: pedidosLista,
      codigoOl: getText('romFiltroCodigoOl'),
    };
  }

  /** Atualiza o rodapé do bloco com o resumo do que está filtrado. */
  function atualizarResumoFiltrosImpressaoOpl() {
    var el = document.getElementById('romFiltroResumo');
    if (!el) return;
    var f = lerFiltrosImpressaoOpl();
    var partes = [];
    if (f.destinatarios.length) partes.push(f.destinatarios.length + ' destinatário(s)');
    if (f.unidades.length) partes.push(f.unidades.length + ' unidade(s)');
    if (f.conservacoes.length) partes.push(f.conservacoes.length + ' conservação(ões)');
    if (f.grupos.length) partes.push(f.grupos.length + ' grupo(s)');
    if (f.categorias.length) partes.push(f.categorias.length + ' categoria(s)');
    if (f.pedidos.length) partes.push(f.pedidos.length + ' pedido(s)');
    if (f.codigoOl) partes.push('código contém "' + f.codigoOl + '"');
    el.textContent = partes.length ? 'Filtrando por: ' + partes.join(', ') + '.' : 'Sem filtros — imprimirá tudo do espelho.';
  }

  /** Exibe valor no input só quando há divergência vs qtd pedida; igual ou vazio no BD → em branco. */
  function valorInputColetadaDisp(qPed, qColDb) {
    var qp = parseNumLoose(qPed);
    var qc = parseNumLoose(qColDb);
    if (qc == null) return '';
    if (qp != null && Math.abs(qp - qc) < 1e-5) return '';
    return String(qColDb).trim();
  }

  function parseDadosJsonItem(it) {
    var d = it && (it.DADOS_JSON != null ? it.DADOS_JSON : it.dados_json);
    if (!d) return {};
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d);
      } catch (e) {
        return {};
      }
    }
    return d && typeof d === 'object' ? d : {};
  }

  function motivoDivergItem(it) {
    var d = parseDadosJsonItem(it);
    return String(d.motivoDiverg || d.MOTIVO_DIVERG || '')
      .trim()
      .toUpperCase();
  }

  function tipoLinhaItem(it) {
    var d = parseDadosJsonItem(it);
    return String(d.tipoLinha || d.TIPO_LINHA || '')
      .trim()
      .toUpperCase();
  }

  /** Situação do picking no item (gravado em QT_COLETADA; cancelamento/substituição ≠ falta). */
  function badgePickingHtml(qPed, qColDb, motivoDiverg, tipoLinha) {
    var qp = parseNumLoose(qPed);
    var qc = parseNumLoose(qColDb);
    var motivo = String(motivoDiverg || '')
      .trim()
      .toUpperCase();
    var tipo = String(tipoLinha || '')
      .trim()
      .toUpperCase();
    var label;
    var cls;
    var title;
    if (tipo === 'SUBSTITUTO') {
      label = 'Extra';
      cls = 'opl-badge-extra';
      title =
        'Linha de substituição (produto enviado no lugar de outro). Quantidade pedida = coletada do substituto.';
    } else if (qc == null) {
      label = 'Pend.';
      cls = 'opl-badge-pend';
      title =
        'Picking ainda não gravado. Deixe «se diferente» em branco se conferiu igual ao pedido e use Salvar picking.';
    } else if (motivo === 'SUBSTITUIDO' && qc != null && Math.abs(qc) < 1e-9) {
      label = 'Subst.';
      cls = 'opl-badge-subst';
      title =
        'Item substituído por outro produto no mesmo pedido (coletada 0). A linha Extra consome o estoque do substituto.';
    } else if (qp != null && Math.abs(qp - qc) < 1e-5) {
      label = 'OK';
      cls = 'opl-badge-ok';
      title =
        'Conferido / separado conforme a quantidade pedida (sem divergência). O valor coletado foi salvo igual ao pedido.';
    } else if (motivo === 'CANCELADO_CLIENTE' && qc != null && Math.abs(qc) < 1e-9) {
      label = 'Canc.';
      cls = 'opl-badge-canc';
      title =
        'Item cancelado pelo cliente (não é falta de estoque). Quantidade coletada = 0 com motivo CANCELADO_CLIENTE.';
    } else {
      label = 'Diverg.';
      cls = 'opl-badge-div';
      title =
        'Quantidade coletada salva é diferente da pedida — divergência operacional (falta / não coletado / parcial).';
    }
    return (
      '<span class="opl-badge ' +
      cls +
      '" title="' +
      escapeHtml(title) +
      '">' +
      escapeHtml(label) +
      '</span>'
    );
  }

  /** Todos os itens com picking gravado (ex.: 16/16) → não permitir nova edição/gravação nesta tela. */
  function oplPickingConcluidoEmTodos(stImp) {
    if (!stImp || !Number.isFinite(stImp.tot) || stImp.tot <= 0) return false;
    var com = Number.isFinite(stImp.com) ? stImp.com : 0;
    return com >= stImp.tot;
  }

  function espelhoSemReservaAtiva(data) {
    if (!data) return true;
    var r = data.reservaEstoque;
    return !(r && Array.isArray(r.linhas) && r.linhas.length);
  }

  function pickingEdicaoBloqueada(data, pickFechado) {
    if (data && cicloExpedicaoEncerrado(data)) return true;
    if (!pickFechado) return false;
    return !espelhoSemReservaAtiva(data);
  }

  /** Conta itens / com picking / divergentes (mesma lógica da listagem SQL). */
  function cicloExpedicaoEncerrado(data) {
    var c = data && data.statusCiclo;
    return !!(c && c.expedicaoSaidaConfirmada);
  }

  function nomeDonoPorCd(cd) {
    var n = parseInt(cd, 10);
    if (!Number.isFinite(n)) return '';
    if (donosEstoqueCache && donosEstoqueCache.length) {
      for (var i = 0; i < donosEstoqueCache.length; i++) {
        if (parseInt(donosEstoqueCache[i].CD_DONO, 10) === n) {
          return String(donosEstoqueCache[i].NOME || donosEstoqueCache[i].NM_DONO || '').trim();
        }
      }
    }
    return '';
  }

  function htmlOplDetChips(data, stImp, pickFechado) {
    var chips = [];
    var cdDonoArq = cdDonoDoArquivo(data.arquivo);
    if (cdDonoArq != null) {
      var nmDono = nomeDonoPorCd(cdDonoArq);
      chips.push(
        '<span class="opl-det-chip opl-det-chip--info" title="Dono usado na auditoria, cobertura e reserva">' +
          '<i class="bx bx-buildings"></i> Dono espelho: ' +
          escapeHtml(nmDono ? nmDono + ' (' + String(cdDonoArq) + ')' : String(cdDonoArq)) +
          '</span>'
      );
    } else {
      chips.push(
        '<span class="opl-det-chip opl-det-chip--warn" title="Associe o dono para auditoria e estoque">' +
          '<i class="bx bx-error"></i> Espelho sem dono</span>'
      );
    }
    var tot = stImp.tot;
    var com = stImp.com;
    if (tot > 0) {
      if (pickFechado && stImp.div === 0) {
        chips.push(
          '<span class="opl-det-chip opl-det-chip--ok"><i class="bx bx-check-circle"></i> Picking ' +
            escapeHtml(String(com)) +
            '/' +
            escapeHtml(String(tot)) +
            '</span>'
        );
      } else if (com > 0) {
        chips.push(
          '<span class="opl-det-chip opl-det-chip--warn"><i class="bx bx-time-five"></i> Picking ' +
            escapeHtml(String(com)) +
            '/' +
            escapeHtml(String(tot)) +
            '</span>'
        );
      } else {
        chips.push('<span class="opl-det-chip opl-det-chip--muted"><i class="bx bx-package"></i> Picking pendente</span>');
      }
    }
    var temRes = !!(data.reservaEstoque && data.reservaEstoque.linhas && data.reservaEstoque.linhas.length);
    var ciclo = cicloExpedicaoEncerrado(data);
    if (ciclo) {
      var carga = data.statusCiclo.cdCargaExpedicao;
      chips.push(
        '<span class="opl-det-chip opl-det-chip--done"><i class="bx bx-truck"></i> Expedido' +
          (carga != null ? ' · carga #' + escapeHtml(String(carga)) : '') +
          '</span>'
      );
      chips.push(
        '<span class="opl-det-chip opl-det-chip--done"><i class="bx bx-lock-open-alt"></i> Reserva baixada na saída</span>'
      );
    } else if (temRes) {
      var nr = data.reservaEstoque.total != null ? data.reservaEstoque.total : data.reservaEstoque.linhas.length;
      chips.push(
        '<span class="opl-det-chip opl-det-chip--ok"><i class="bx bx-lock-alt"></i> ' +
          escapeHtml(String(nr)) +
          ' SKU reservado(s)</span>'
      );
    } else if (pickFechado && cdDonoDoArquivo(data.arquivo) != null) {
      chips.push('<span class="opl-det-chip opl-det-chip--warn"><i class="bx bx-error"></i> Sem reserva ativa</span>');
    }
    return chips.join('');
  }

  function htmlOplDetAlertas(data, pickFechado) {
    var out = [];
    var ciclo = cicloExpedicaoEncerrado(data);
    if (ciclo) {
      var dh = data.statusCiclo.dhSaidaExpedicao;
      var carga = data.statusCiclo.cdCargaExpedicao;
      var dhTxt = dh ? formatDh(dh) : '';
      var stPend = agregarStatsPickingDesdeDetalhe(data);
      var pickingAberto = stPend.tot > 0 && stPend.com < stPend.tot;
      out.push(
        '<div class="opl-det-banner opl-det-banner--success">' +
          '<i class="bx bx-check-double"></i>' +
          '<div><p><strong>Ciclo encerrado.</strong> A saída já foi confirmada na expedição' +
          (carga != null ? ' (carga #' + escapeHtml(String(carga)) + ')' : '') +
          (dhTxt ? ' em ' + escapeHtml(dhTxt) : '') +
          '. O estoque já foi baixado e as reservas deste espelho foram liberadas.</p>' +
          '<p style="margin-top:8px;font-size:13px;opacity:0.95"><strong>Não use</strong> «Aplicar reservas» neste espelho — isso só vale antes da expedição.</p>' +
          (pickingAberto
            ? '<p style="margin-top:8px;font-size:13px;opacity:0.95">Picking ainda <strong>pendente</strong> no espelho (' +
              escapeHtml(String(stPend.com)) +
              '/' +
              escapeHtml(String(stPend.tot)) +
              '). Use o botão <strong>Registrar picking pós-expedição</strong> (acima da lista de itens) para alinhar o status (só histórico — sem mexer estoque).</p>'
            : '<p style="margin-top:8px;font-size:13px;opacity:0.95"><strong>Picking já concluído</strong> (' +
              escapeHtml(String(stPend.com)) +
              '/' +
              escapeHtml(String(stPend.tot)) +
              '). Não há o que finalizar neste espelho — os pedidos já foram expedidos na carga' +
              (carga != null ? ' #' + escapeHtml(String(carga)) : '') +
              '.</p>') +
          '</div></div>'
      );
    }
    if (pickFechado && !ciclo) {
      if (espelhoSemReservaAtiva(data)) {
        out.push(
          '<div class="opl-det-banner opl-det-banner--warning">' +
            '<i class="bx bx-edit"></i>' +
            '<div><p><strong>Picking gravado, reserva pendente.</strong> Ainda não há reserva de estoque neste espelho — você pode <strong>ajustar quantidades</strong> ' +
            '(marque as linhas, digite <strong>0</strong> em «se diferente» se não separou, e use <strong>Salvar picking</strong>) antes de «Aplicar reservas».</p></div></div>'
        );
      } else {
        out.push(
          '<div class="opl-det-banner opl-det-banner--info">' +
            '<i class="bx bx-info-circle"></i>' +
            '<div><p><strong>Picking encerrado.</strong> Quantidades gravadas e reserva ativa; não é possível alterar nesta tela. Para corrigir coletadas, use <strong>Reabrir picking</strong> abaixo (supervisor).</p></div></div>'
        );
      }
    }
    return out.join('');
  }

  function htmlSimulacaoCobertura(sim, opts) {
    opts = opts || {};
    var cicloEncerrado = !!opts.cicloEncerrado;
    if (!sim) return '';
    if (sim.erro || sim.ok === false) {
      return (
        '<div class="opl-sim-cobertura-wrap opl-sim-cobertura-warn"><strong>Simulação de estoque:</strong> ' +
        escapeHtml(sim.erro || 'Simulação indisponível.') +
        '</div>'
      );
    }
    if (!sim.agregado) return '';
    var a = sim.agregado;
    var nF = Number(a.linhasComPossivelFalta || 0);
    var nD = Number(a.linhasSemDepara || 0);
    var incl = !!sim.incluirRecebimentosAbertos;
    var descontaRes = !!sim.descontaReservasOutrosEspelhos;
    var linhas = (sim.linhas || []).filter(function (L) {
      return L.semDepara || (L.possivelFalta != null && L.possivelFalta > 1e-9);
    });
    var wrapCls = 'opl-sim-cobertura-wrap';
    if (cicloEncerrado) wrapCls += ' opl-sim-cobertura-ciclo';
    else if (nF === 0 && nD === 0) wrapCls += ' opl-sim-cobertura-ok';
    var baseSim =
      incl
        ? 'saldo estimado (<em>NF-e encerradas</em> + conferência em <em>NF-e ainda não encerradas</em>, com <code>cdProduto</code>).'
        : 'saldo estimado só de <em>NF-e encerradas</em> (conferência com <code>cdProduto</code>).';
    var hx =
      '<div class="' +
      wrapCls +
      '"><strong>Simulação (MVP):</strong> ';
    if (cicloEncerrado) {
      hx +=
        'Referência histórica — a expedição já baixou o estoque. Demanda do espelho frente ao ' + baseSim;
    } else {
      hx += 'demanda do espelho frente ao ' + baseSim;
    }
    if (descontaRes && !cicloEncerrado) {
      hx += ' <strong>Desconta reservas</strong> de outros espelhos OPL com picking encerrado.';
    }
    if (nF === 0 && nD === 0) {
      return (
        hx +
        '<span style="color:#15803d"> Nenhum SKU agregado acima do saldo estimado; nenhum código sem de-para.</span></div>'
      );
    }
    if (nF > 0 && !cicloEncerrado) {
      hx +=
        '<br><span style="color:#b91c1c;display:inline-block;margin-top:6px">' +
        nF +
        ' SKU com demanda acima do saldo estimado — não será possível encerrar o picking ao completar todos os itens.</span> ';
    }
    else if (nF > 0 && cicloEncerrado) {
      hx += '<span>' + nF + ' SKU ainda aparecem com déficit na fórmula da simulação (normal após saída — consulte Posição de estoque).</span> ';
    }
    if (nD > 0) hx += '<span>' + nD + ' código(s) sem de-para ou produto dono.</span> ';
    hx +=
      '<details style="margin-top:6px"><summary style="cursor:pointer">Ver linhas</summary><ul style="margin:8px 0 0 18px">';
    linhas.slice(0, 80).forEach(function (L) {
      var sal;
      var ro = L.reservaOutrosEspelhos != null ? Number(L.reservaOutrosEspelhos) : 0;
      if (L.saldoEstimadoUsado != null && L.saldoEncerradas != null && incl) {
        if (ro > 1e-9) {
          sal =
            '(' +
            fmtQtdEsc(L.saldoEncerradas) +
            ' − ' +
            fmtQtdEsc(ro) +
            ' + ' +
            fmtQtdEsc(L.saldoRecebimentosAbertos != null ? L.saldoRecebimentosAbertos : 0) +
            ') = ' +
            fmtQtdEsc(L.saldoEstimadoUsado);
        } else {
          sal =
            fmtQtdEsc(L.saldoEncerradas) +
            ' + ' +
            fmtQtdEsc(L.saldoRecebimentosAbertos != null ? L.saldoRecebimentosAbertos : 0) +
            ' = ' +
            fmtQtdEsc(L.saldoEstimadoUsado);
        }
      } else if (ro > 1e-9 && L.saldoEncerradas != null && L.saldoDisponivelAposReservasOutros != null) {
        sal =
          fmtQtdEsc(L.saldoEncerradas) +
          ' − ' +
          fmtQtdEsc(ro) +
          ' = ' +
          fmtQtdEsc(L.saldoDisponivelAposReservasOutros);
      } else {
        sal = L.saldoEncerradas == null ? '—' : fmtQtdEsc(L.saldoEncerradas);
      }
      var fal = L.possivelFalta == null ? '—' : fmtQtdEsc(L.possivelFalta);
      var detSal =
        L.saldoNfeEncerrada != null
          ? ' | NF enc. ' +
            fmtQtdEsc(L.saldoNfeEncerrada) +
            (L.saldoMovimentosEstoque != null && Math.abs(Number(L.saldoMovimentosEstoque)) > 1e-9
              ? ' + mov. ' + fmtQtdEsc(L.saldoMovimentosEstoque)
              : '') +
            (L.saldoPosicaoSku != null ? ' | posição ' + fmtQtdEsc(L.saldoPosicaoSku) : '')
          : '';
      /** Botão só quando há reserva ÓRFÃ deletável (`reservaOrfasDeletaveis`).
       *  `reservaOutrosEspelhos` inclui reservas legítimas (carga pendente). */
      var btnLimpar = '';
      var roOrfa = L.reservaOrfasDeletaveis != null ? Number(L.reservaOrfasDeletaveis) : 0;
      if (ro > 1e-9 && L.cdProduto && sim.cdDono != null) {
        var codigoExibicao = L.codigoInterno || L.codProdutoOl || '';
        if (roOrfa > 1e-9) {
          btnLimpar =
            '<br><button type="button" class="btn-sim-limpar-orfas" ' +
            'data-cd-dono="' + escapeHtml(String(sim.cdDono)) + '" ' +
            'data-cd-produto="' + escapeHtml(String(L.cdProduto)) + '" ' +
            'data-codigo-ol="' + escapeHtml(String(codigoExibicao)) + '" ' +
            'data-descricao="' + escapeHtml(String(L.descricao || '').slice(0, 80)) + '" ' +
            'data-res-out="' + escapeHtml(String(ro)) + '" ' +
            'data-orfa="' + escapeHtml(String(roOrfa)) + '" ' +
            'style="margin-top:6px;padding:6px 12px;background:#dc2626;color:#fff;' +
            'border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer">' +
            '🧹 Limpar reservas órfãs (' + fmtQtdEsc(roOrfa) + ' un)' +
            '</button>';
        } else {
          btnLimpar =
            '<br><span style="display:inline-block;margin-top:6px;font-size:12px;color:#64748b">' +
            'ℹ️ ' +
            fmtQtdEsc(ro) +
            ' un reservadas em outros espelhos — nenhuma é órfã (cargas ainda pendentes). O botão de limpeza só aparece quando a Auditoria classifica reserva liberável.</span>';
        }
      }
      hx +=
        '<li style="margin-bottom:8px"><strong><code>' +
        escapeHtml(L.codProdutoOl) +
        '</code></strong>' +
        (L.codigoInterno ? ' → <code>' + escapeHtml(L.codigoInterno) + '</code>' : '') +
        (L.descricao ? ' — ' + escapeHtml(String(L.descricao).slice(0, 70)) : '') +
        '<br>pedido <strong>' +
        fmtQtdEsc(L.qtdPedidaAgregada) +
        '</strong>, trava sim. ' +
        sal +
        ', falta <strong>' +
        fal +
        '</strong>' +
        detSal +
        (L.semDepara ? ' <em>(sem mapeamento)</em>' : '') +
        (L.diagnostico
          ? '<br><span style="font-size:12px;color:#64748b">' + escapeHtml(L.diagnostico) + '</span>'
          : '') +
        btnLimpar +
        '</li>';
    });
    if (linhas.length > 80) hx += '<li>… +' + (linhas.length - 80) + ' linhas</li>';
    hx += '</ul></details>';
    if (sim.avisos && sim.avisos.length) {
      sim.avisos.slice(0, 3).forEach(function (av) {
        hx += '<p class="opl-pick-hint" style="margin:8px 0 0">' + escapeHtml(av) + '</p>';
      });
    }
    hx += '</div>';
    return hx;
  }

  function htmlReservaEstoqueOpl(res) {
    if (!res || !res.linhas || !res.linhas.length) return '';
    var n = res.total != null ? res.total : res.linhas.length;
    var parts = (res.linhas || []).slice(0, 60).map(function (L) {
      var cd = L.CD_PRODUTO != null ? L.CD_PRODUTO : L.cd_produto;
      var q = L.QTD_RESERVADA != null ? L.QTD_RESERVADA : L.qtd_reservada;
      return '<li><code>' + escapeHtml(String(cd)) + '</code> — ' + fmtQtdEsc(q) + ' reservado(s)</li>';
    });
    return (
      '<div class="opl-sim-cobertura-wrap" style="margin-top:6px"><strong>Reserva (estoque OPL):</strong> ' +
      escapeHtml(String(n)) +
      ' produto(s).<details style="margin-top:4px"><summary style="cursor:pointer">Ver quantidades</summary><ul style="margin:6px 0 0 18px">' +
      parts.join('') +
      '</ul>' +
      (res.linhas.length > 60
        ? '<p class="opl-pick-hint">… +' + escapeHtml(String(res.linhas.length - 60)) + '</p>'
        : '') +
      '</details></div>'
    );
  }

  function agregarStatsPickingDesdeDetalhe(data) {
    var tot = 0;
    var com = 0;
    var div = 0;
    (data.pedidos || []).forEach(function (p) {
      (p.itens || []).forEach(function (it) {
        tot += 1;
        var hasCol = it.QT_COLETADA != null && String(it.QT_COLETADA).trim() !== '';
        if (hasCol) {
          com += 1;
          var qp = parseNumLoose(it.QT_PEDIDA);
          var qc0 = parseNumLoose(it.QT_COLETADA);
          if (qp != null && qc0 != null && Math.abs(qp - qc0) >= 1e-5) div += 1;
        }
      });
    });
    return { tot: tot, com: com, div: div };
  }

  /** HTML da célula “Picking” na lista de importações (situação legível + fração). */
  function htmlCelulaPickingImportacaoLista(totIt, com, divC) {
    if (!Number.isFinite(totIt) || totIt <= 0) return '—';
    if (!Number.isFinite(com)) com = 0;
    if (!Number.isFinite(divC)) divC = 0;
    var frac = escapeHtml(String(com)) + '/' + escapeHtml(String(totIt));
    var delta =
      divC > 0
        ? ' <span class="opl-pick-delta" title="Itens com quantidade coletada diferente da pedida">(Δ' +
          escapeHtml(String(divC)) +
          ')</span>'
        : '';
    if (com === 0) {
      return (
        '<span class="opl-badge opl-badge-sit-pend" title="Nenhuma quantidade coletada gravada ainda">Pendente</span> · ' +
        frac
      );
    }
    if (com < totIt) {
      return (
        '<span class="opl-badge opl-badge-sit-parc" title="Ainda há itens sem picking gravado">Parcial</span> · ' +
        frac +
        delta
      );
    }
    if (divC > 0) {
      return (
        '<span class="opl-badge opl-badge-sit-div" title="Todos os itens têm picking; há divergência em pelo menos um">Concluída c/ diverg.</span> · ' +
        frac +
        delta
      );
    }
    return (
      '<span class="opl-badge opl-badge-sit-ok" title="Todos os itens conferidos sem divergência">Concluída</span> · ' + frac
    );
  }

  function oplImportacaoExclusivelPelaLista(row) {
    var com = parseInt(row.Q_ITENS_COM_PICKING, 10);
    if (!Number.isFinite(com)) com = 0;
    return com === 0;
  }

  function aplicarFiltroPicking() {
    var destInp = document.getElementById('oplFiltroDestino');
    var prodInp = document.getElementById('oplFiltroProduto');
    var geralInp = document.getElementById('oplFiltroPicking');
    var qDest = (destInp && destInp.value ? destInp.value : '').trim().toLowerCase();
    var qProd = (prodInp && prodInp.value ? prodInp.value : '').trim().toLowerCase();
    var qGeral = (geralInp && geralInp.value ? geralInp.value : '').trim().toLowerCase();
    document.querySelectorAll('#oplItensBody tr.opl-pick-row').forEach(function (tr) {
      var dest = String(tr.getAttribute('data-dest') || '').toLowerCase();
      var prod = String(tr.getAttribute('data-prod') || '').toLowerCase();
      var raw = tr.getAttribute('data-s') || '';
      try {
        raw = decodeURIComponent(raw);
      } catch (e2) {
        raw = '';
      }
      raw = (raw || '').toLowerCase();
      var okDest = !qDest || dest.indexOf(qDest) !== -1;
      var okProd = !qProd || prod.indexOf(qProd) !== -1;
      var okGeral = !qGeral || raw.indexOf(qGeral) !== -1;
      if (okDest && okProd && okGeral) tr.classList.remove('opl-pick-hidden');
      else tr.classList.add('opl-pick-hidden');
    });
    var sa = document.getElementById('oplPickSelectAllVis');
    if (sa) sa.checked = false;
  }

  function limparFiltrosPicking() {
    var destInp = document.getElementById('oplFiltroDestino');
    var prodInp = document.getElementById('oplFiltroProduto');
    var geralInp = document.getElementById('oplFiltroPicking');
    if (destInp) destInp.value = '';
    if (prodInp) prodInp.value = '';
    if (geralInp) geralInp.value = '';
    aplicarFiltroPicking();
  }

  function atualizarBadgeSitLinha(tr) {
    if (!tr) return;
    var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
    var cell = tr.querySelector('.opl-pick-sit-cell');
    if (!inp || !cell) return;
    var qped = parseNumLoose(inp.getAttribute('data-qt-pedida'));
    var v = String(inp.value || '').trim();
    var motivo = String(inp.getAttribute('data-motivo') || '')
      .trim()
      .toUpperCase();
    var qcDisp;
    if (v === '') {
      /** Em branco na UI = ainda não gravado (se original pendente) OU igual ao pedido se já havia OK.
       *  Para badge preview: se mudou vs original, trata branco como “igual pedido” ao salvar. */
      var orig = String(inp.getAttribute('data-original') || '');
      var origMotivo = String(inp.getAttribute('data-original-motivo') || '')
        .trim()
        .toUpperCase();
      if (orig === '' && !origMotivo) {
        cell.innerHTML = badgePickingHtml(qped, null, '', inp.getAttribute('data-tipo-linha') || '');
        return;
      }
      qcDisp = qped;
      motivo = '';
    } else {
      qcDisp = parseNumLoose(v);
    }
    cell.innerHTML = badgePickingHtml(qped, qcDisp, motivo, inp.getAttribute('data-tipo-linha') || '');
  }

  function contarAlteracoesPickingPendentes() {
    var n = 0;
    document.querySelectorAll('#oplItensBody input.pick-qtd[data-cd-item]').forEach(function (inp) {
      var atual = String(inp.value || '').trim();
      var orig = String(inp.getAttribute('data-original') || '').trim();
      var mot = String(inp.getAttribute('data-motivo') || '')
        .trim()
        .toUpperCase();
      var motOrig = String(inp.getAttribute('data-original-motivo') || '')
        .trim()
        .toUpperCase();
      if (atual !== orig || mot !== motOrig) n++;
    });
    return n;
  }

  function atualizarIndicadorPickingNaoSalvo() {
    var n = contarAlteracoesPickingPendentes();
    var btn = document.getElementById('btnSalvarPicking');
    var hint = document.getElementById('oplPickDirtyHint');
    if (btn) {
      btn.classList.toggle('opl-salvar-pendente', n > 0);
      var icon = '<i class="bx bx-save"></i> ';
      btn.innerHTML =
        n > 0 ? icon + 'Salvar picking (' + n + ' alt.)' : icon + 'Salvar picking';
    }
    if (hint) {
      if (n > 0) {
        hint.style.display = 'block';
        hint.innerHTML =
          '<i class="bx bx-error-circle"></i> <strong>' +
          n +
          '</strong> alteração(ões) ainda não gravada(s). Digitar no campo não salva — use <strong>Salvar picking</strong>.';
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }
  }

  function marcarLinhaCanceladoCliente(tr) {
    if (!tr) return false;
    if (tr.getAttribute('data-tipo-linha') === 'SUBSTITUTO') return false;
    if (tr.getAttribute('data-ja-substituido') === '1') return false;
    var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
    if (!inp || inp.disabled || inp.readOnly) return false;
    inp.value = '0';
    inp.setAttribute('data-motivo', 'CANCELADO_CLIENTE');
    atualizarBadgeSitLinha(tr);
    return true;
  }

  function limparMotivoLinha(tr) {
    if (!tr) return;
    var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
    if (!inp) return;
    inp.setAttribute('data-motivo', '');
  }

  var substModalState = { cdOplItem: null };

  function fecharModalSubstituirItem() {
    var modal = document.getElementById('oplSubstituirItemModal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    substModalState.cdOplItem = null;
  }

  function abrirModalSubstituirItem(opts) {
    opts = opts || {};
    var tr = opts.tr;
    var inp = tr && tr.querySelector('input.pick-qtd[data-cd-item]');
    var cd = opts.cdOplItem != null ? opts.cdOplItem : inp ? parseInt(inp.getAttribute('data-cd-item'), 10) : NaN;
    if (!Number.isFinite(cd)) {
      showMessage('Item inválido para substituição.', 'error');
      return;
    }
    var tds = tr ? tr.querySelectorAll('td') : [];
    var descTxt = tds[5] ? String(tds[5].textContent || '').replace(/\s*←.*$/, '').trim() : '';
    var codTxt = tds[6] ? String(tds[6].textContent || '').trim() : '';
    var qtPed = inp ? inp.getAttribute('data-qt-pedida') : '';
    substModalState.cdOplItem = cd;
    var origemEl = document.getElementById('oplSubstituirItemOrigem');
    if (origemEl) {
      origemEl.innerHTML =
        'Original: <strong>' +
        escapeHtml(codTxt || '—') +
        '</strong> — ' +
        escapeHtml(descTxt || '—') +
        ' (pedida: ' +
        escapeHtml(qtPed || '—') +
        '). Informe o código e a quantidade do produto que entrou no lugar.';
    }
    var cod = document.getElementById('oplSubstCodigo');
    var qtd = document.getElementById('oplSubstQtd');
    var obs = document.getElementById('oplSubstObs');
    if (cod) cod.value = '';
    if (qtd) qtd.value = '';
    if (obs) obs.value = '';
    var modal = document.getElementById('oplSubstituirItemModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }
    if (cod) setTimeout(function () { cod.focus(); }, 50);
  }

  function confirmarSubstituirItem() {
    if (!cdOplArquivoAtual || !Number.isFinite(substModalState.cdOplItem)) {
      showMessage('Contexto de substituição inválido.', 'error');
      return;
    }
    var codigo = String((document.getElementById('oplSubstCodigo') || {}).value || '').trim();
    var qtd = parseNumLoose((document.getElementById('oplSubstQtd') || {}).value);
    var obs = String((document.getElementById('oplSubstObs') || {}).value || '').trim();
    if (!codigo) {
      showMessage('Informe o código que entrou no lugar.', 'warning');
      var cEl = document.getElementById('oplSubstCodigo');
      if (cEl) cEl.focus();
      return;
    }
    if (qtd == null || qtd <= 0) {
      showMessage('Informe a quantidade coletada (maior que zero).', 'warning');
      var qEl = document.getElementById('oplSubstQtd');
      if (qEl) qEl.focus();
      return;
    }
    showLoadingOverlay('Substituindo', 'Gravando…', '');
    var url =
      typeof window.corrigirUrl === 'function'
        ? window.corrigirUrl(
            '/api/wms/separacao/opl/importacoes/' +
              encodeURIComponent(cdOplArquivoAtual) +
              '/itens/' +
              encodeURIComponent(substModalState.cdOplItem) +
              '/substituir'
          )
        : '/api/wms/separacao/opl/importacoes/' +
          encodeURIComponent(cdOplArquivoAtual) +
          '/itens/' +
          encodeURIComponent(substModalState.cdOplItem) +
          '/substituir';
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
      body: JSON.stringify({
        codigoOl: codigo,
        qtColetada: qtd,
        observacao: obs || undefined,
      }),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var err = new Error((body && body.error) || 'HTTP ' + r.status);
            err.body = body;
            throw err;
          }
          return body;
        });
      })
      .then(function (body) {
        fecharModalSubstituirItem();
        showMessage((body && body.mensagem) || 'Substituição gravada.', 'success');
        return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao substituir item.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function formatDh(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return (
      String(d.getDate()).padStart(2, '0') +
      '/' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '/' +
      d.getFullYear() +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    );
  }

  function showTab(tabId) {
    var container = document.querySelector('.wms-sep-container');
    if (!container) return;
    container.querySelectorAll('.tab-content').forEach(function (c) {
      c.classList.remove('active');
    });
    container.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.remove('active');
    });
    var content = document.getElementById('tab-' + tabId);
    var btn = container.querySelector('.tab-btn[data-tab="' + tabId + '"]');
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
  }

  var donosEstoqueCache = null;

  function cdDonoDoArquivo(arq) {
    if (!arq) return null;
    var raw = arq.CD_DONO != null ? arq.CD_DONO : arq.cd_dono;
    if (raw == null || String(raw).trim() === '') return null;
    var n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  function atualizarPainelLiberacaoCobertura(data) {
    var wrap = document.getElementById('oplLiberacaoCoberturaWrap');
    if (!wrap) return;
    var ciclo = cicloExpedicaoEncerrado(data);
    var st = agregarStatsPickingDesdeDetalhe(data);
    var pickingFechado = st.tot > 0 && st.com >= st.tot;
    var sim = data && data.simulacaoEstoque;
    var ag = (sim && sim.agregado) || {};
    var nF = Number(ag.linhasComPossivelFalta) || 0;
    var nD = Number(ag.linhasSemDepara) || 0;
    // Após expedição ou picking 100%: formulário de liberação não se aplica
    // (déficits da simulação são históricos — estoque já baixado na saída).
    var mostrarForm = !ciclo && !pickingFechado && (nF > 0 || nD > 0);
    wrap.style.display = mostrarForm ? 'block' : 'none';
    var badge = document.getElementById('oplLiberacaoPermBadge');
    if (badge) {
      badge.textContent = data && data.permissaoLiberacaoCobertura
        ? 'Seu login pode usar a liberação; informe usuário e senha do supervisor autorizador.'
        : 'Liberação: o autorizador precisa do programa wms-separacao-liberar-cobertura-picking (tipo de atividade).';
    }
    var hist = document.getElementById('oplHistoricoLiberacaoHost');
    if (hist) {
      var list = (data && data.historicoLiberacaoCobertura) || [];
      if (!list.length) {
        hist.innerHTML = '<span class="hint">Nenhuma liberação registrada neste espelho.</span>';
      } else {
        hist.innerHTML =
          '<strong>Histórico de liberações</strong><ul style="margin:6px 0 0 18px">' +
          list
            .map(function (h) {
              return (
                '<li>' +
                escapeHtml(formatDh(h.DH_LIBERACAO)) +
                ' — ' +
                escapeHtml(h.AUTORIZADO_NOME || h.AUTORIZADO_LOGIN || '') +
                ': ' +
                escapeHtml(String(h.JUSTIFICATIVA || '').slice(0, 120)) +
                '</li>'
              );
            })
            .join('') +
          '</ul>';
      }
    }
  }

  function exportarCoberturaCsv(somenteProblemas) {
    if (!cdOplArquivoAtual) return;
    var qs =
      'formato=csv' +
      (incluirRecebAbertosAtivo() ? '&incluirRecebimentosAbertos=1' : '') +
      (somenteProblemas === false ? '&somenteProblemas=0' : '');
    showLoadingOverlay('Exportando', 'Gerando CSV de cobertura…', '');
    var base =
      (typeof window.corrigirUrl === 'function'
        ? window.corrigirUrl(
            '/api/wms/separacao/opl/importacoes/' +
              encodeURIComponent(cdOplArquivoAtual) +
              '/cobertura-estoque/exportacao'
          )
        : '/api/wms/separacao/opl/importacoes/' +
          encodeURIComponent(cdOplArquivoAtual) +
          '/cobertura-estoque/exportacao') +
      '?' +
      qs;
    fetch(base, { headers: getAuthHeaders() })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            throw new Error((j && j.error) || r.statusText);
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var cd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download =
          'wms-opl-' +
          (somenteProblemas === false ? 'cobertura-completa' : 'conferencia-fisica') +
          '-' +
          cdOplArquivoAtual +
          '-' +
          cd +
          '.csv';
        a.click();
        URL.revokeObjectURL(url);
        showMessage('CSV baixado — use para conferência com o estoque físico.', 'success');
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao exportar.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function linhaProblemaCoberturaTxt(L) {
    var ol = L.codProdutoOl || L.COD_PRODUTO_OL || '?';
    var interno = L.codigoInterno ? ' → estoque ' + L.codigoInterno : '';
    var desc = L.descricao ? ' — ' + String(L.descricao).slice(0, 55) : '';
    var ped = L.qtdPedidaAgregada != null ? L.qtdPedidaAgregada : L.qtd;
    var sal =
      L.saldoDisponivelAposReservasOutros != null
        ? L.saldoDisponivelAposReservasOutros
        : L.saldoEstimadoUsado != null
          ? L.saldoEstimadoUsado
          : L.saldoEncerradas;
    var falta =
      L.possivelFalta != null && L.possivelFalta > 1e-9
        ? L.possivelFalta
        : ped != null && sal != null
          ? Math.max(0, Number(ped) - Number(sal))
          : null;
    var out =
      ol + interno + desc + ': pedido ' + fmtQtd(ped) + ', saldo disp. ' + (sal != null ? fmtQtd(sal) : '—');
    if (falta != null && falta > 1e-9) out += ', falta ' + fmtQtd(falta);
    return out;
  }

  function formatErroWmsEstoque(j) {
    if (!j) return 'Erro desconhecido.';
    var msg = j.error || j.message || 'Erro';
    var probs = j.detalhes && j.detalhes.linhasProblema;
    if (probs && probs.length) {
      var extra = probs.slice(0, 6).map(linhaProblemaCoberturaTxt).join('\n• ');
      if (extra) msg += '\n\n• ' + extra;
      if (probs.length > 6) msg += '\n… (+' + String(probs.length - 6) + ' SKU; use “Ver linhas” na simulação)';
    }
    return msg;
  }

  function vaiCompletarPickingTodosItens(qtdLinhasEnviadas) {
    if (!lastDetalhe || !Number.isFinite(qtdLinhasEnviadas)) return false;
    var st = agregarStatsPickingDesdeDetalhe(lastDetalhe);
    var pendentes = (Number(st.tot) || 0) - (Number(st.com) || 0);
    return pendentes > 0 && qtdLinhasEnviadas >= pendentes;
  }

  function simIndicaFaltaSaldo() {
    var sim = lastDetalhe && lastDetalhe.simulacaoEstoque;
    if (!sim || !sim.agregado) return false;
    return (Number(sim.agregado.linhasComPossivelFalta) || 0) > 0;
  }

  function fetchJsonOrThrow(r) {
    return r.json().then(function (j) {
      if (!r.ok) {
        var err = new Error(formatErroWmsEstoque(j));
        err.payload = j;
        err.status = r.status;
        throw err;
      }
      return j;
    });
  }

  function incluirRecebAbertosAtivo() {
    var chk = document.getElementById('oplSimIncluirRecebAbertos');
    return !!(chk && chk.checked);
  }

  function popularSelectsDono(rows) {
    ['opl_cd_dono', 'opl_cd_dono_detalhe', 'prog_cd_dono'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var v = sel.value;
      var todos = id === 'prog_cd_dono';
      sel.innerHTML = todos ? '<option value="">Todos</option>' : '<option value="">— Selecione —</option>';
      rows.forEach(function (d) {
        var o = document.createElement('option');
        o.value = String(d.CD_DONO);
        o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
        sel.appendChild(o);
      });
      if (v && Array.prototype.some.call(sel.options, function (x) { return x.value === v; })) sel.value = v;
    });
  }

  function fmtKgProg(n) {
    var x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '—';
    return x.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
  }

  function fmtNumProg(n, dec) {
    var x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pt-BR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }

  function isoAmanhaLocal() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function isoParaBr(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function sincronizarFiltrosProgDaGrade() {
    var uf = document.getElementById('filt_opl_uf');
    var arq = document.getElementById('filt_opl_nm_arquivo');
    var pUf = document.getElementById('prog_uf');
    var pArq = document.getElementById('prog_nm_arquivo');
    if (pUf && uf) pUf.value = uf.value || '';
    if (pArq && arq) pArq.value = arq.value || '';
  }

  function definirProgAmanha() {
    var iso = isoAmanhaLocal();
    var de = document.getElementById('prog_data_de');
    var ate = document.getElementById('prog_data_ate');
    if (de) de.value = iso;
    if (ate) ate.value = iso;
  }

  function htmlVeiculoSugestao(sug) {
    if (!sug) return '';
    var parts = [];
    (sug.sugestoes || []).forEach(function (s) {
      var icone = s.tipo === 'frio' ? 'snowflake' : 'package';
      var ok = s.cabe !== false;
      parts.push(
        '<strong><i class="bx bx-' + icone + '"></i> ' + escapeHtml(s.rotulo) + '</strong>: ~' +
        escapeHtml(fmtKgProg(s.pesoKg)) +
        (ok ? '' : ' <span style="color:#b91c1c">(acima de ' + fmtNumProg(s.kgMax, 0) + ' kg)</span>')
      );
    });
    var alertas = (sug.alertas || []).map(function (a) { return escapeHtml(a); }).join(' ');
    var cls = alertas ? 'opl-prog-veiculo opl-prog-veiculo-warn' : 'opl-prog-veiculo';
    return '<div class="' + cls + '"><strong>Sugestão de veículo (referência):</strong> ' +
      (parts.length ? parts.join(' · ') : 'Sem peso para estimar.') +
      (alertas ? '<div style="margin-top:8px">' + alertas + '</div>' : '') + '</div>';
  }

  function htmlKpiProg(lbl, val, extraCls, sub) {
    return '<div class="opl-prog-kpi"><div class="opl-prog-kpi-lbl">' + escapeHtml(lbl) +
      '</div><div class="opl-prog-kpi-val' + (extraCls ? ' ' + extraCls : '') + '">' + val +
      '</div>' + (sub ? '<div class="opl-prog-kpi-sub">' + sub + '</div>' : '') + '</div>';
  }

  function htmlProgBadgeCobertura(totais, pendencias, destKey) {
    if (!totais) return '';
    var semPeso = totais.linhasSemPeso || 0;
    var semCad = totais.linhasSemCadastro || 0;
    if (semPeso <= 0 && semCad <= 0) return '';
    var parts = [];
    var qtdLinhas = totais.qtdLinhas || 0;
    if (semPeso > 0) {
      parts.push(
        qtdLinhas > 0
          ? fmtNumProg(semPeso, 0) + ' de ' + fmtNumProg(qtdLinhas, 0) + ' linhas sem peso'
          : fmtNumProg(semPeso, 0) + ' linha(s) sem peso'
      );
    }
    if (semCad > 0) {
      parts.push(fmtNumProg(semCad, 0) + ' sem cadastro');
    }
    var crit = semPeso > 0 && (totais.pctCoberturaPeso == null || totais.pctCoberturaPeso < 50);
    var hasItens = pendencias && pendencias.length > 0;
    var html = '<span class="opl-prog-peso-alerta' + (crit ? ' opl-prog-peso-alerta--crit' : '') +
      '" title="Revise PESO_KG e de-para em Cadastros WMS">' +
      '<i class="bx bx-error-circle" aria-hidden="true"></i> ' + escapeHtml(parts.join(' · '));
    if (hasItens && destKey) {
      html += ' <button type="button" class="opl-prog-ver-pend" data-pend-key="' +
        escapeHtml(destKey) + '">Ver itens</button>';
    }
    html += '</span>';
    return html;
  }

  function motivoPendenciaLbl(motivo) {
    if (motivo === 'sem_cadastro') return 'Sem cadastro / de-para';
    if (motivo === 'sem_peso') return 'Sem PESO_KG';
    return motivo || '—';
  }

  function abrirCadastroPesoItem(item) {
    if (!item) return;
    var nav = {
      entity: item.motivo === 'sem_cadastro' ? 'depara' : 'produto',
      cdDono: item.CD_DONO,
      codigo: item.motivo === 'sem_peso' ? (item.CODIGO || item.COD_PRODUTO_OL) : item.COD_PRODUTO_OL,
      codigoExterno: item.COD_PRODUTO_OL,
      codigoInternoSugerido:
        item.codigoInternoSugerido || item.CODIGO || null,
      fatorSugerido: item.fatorSugerido != null ? item.fatorSugerido : null,
      descricao: item.DESCRICAO || '',
      cdProduto: item.CD_PRODUTO,
      pesoStatus: item.motivo === 'sem_peso' ? 'sem' : '',
      openNew: item.motivo === 'sem_cadastro',
      openEdit: item.motivo === 'sem_peso' && item.CD_PRODUTO != null,
    };
    try {
      sessionStorage.setItem('wmsCadNavFromProg', JSON.stringify(nav));
    } catch (_) {}
    if (typeof window.loadModuleContent === 'function') {
      window.loadModuleContent('estoque-cadastros-wms', { wmsCadNavProgramacao: nav });
    } else {
      showMessage('Abra Cadastros WMS pelo menu Gestão Estoque → Cadastros.', 'warning');
    }
  }

  function exportarPendenciasPesoCsv(rows) {
    if (!rows || !rows.length) return;
    var linhas = [
      ['Dono', 'Cód. OL', 'Cód. cadastro', 'Descrição', 'Motivo', 'Qtd pedida', 'Linhas'].join(';'),
    ];
    rows.forEach(function (r) {
      linhas.push([
        r.NM_DONO || '',
        r.COD_PRODUTO_OL || '',
        r.CODIGO || '',
        (r.DESCRICAO || '').replace(/;/g, ','),
        motivoPendenciaLbl(r.motivo),
        String(r.qtdPedida != null ? r.qtdPedida : ''),
        String(r.linhas != null ? r.linhas : ''),
      ].join(';'));
    });
    var blob = new Blob(['\ufeff' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'opl-pendencias-peso-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function htmlProgTabelaPendencias(rows, compact, destKey) {
    if (!rows || !rows.length) {
      return '<p class="hint">Nenhum item pendente.</p>';
    }
    var lim = compact ? 8 : 200;
    var slice = rows.slice(0, lim);
    var temSug = rows.some(function (r) { return r.codigoInternoSugerido; });
    var html = '<div class="wms-sep-table-wrap"><table class="wms-sep-table opl-prog-pend-table"><thead><tr>' +
      '<th>Cód. OL</th><th>Descrição</th><th>Dono</th>' +
      (temSug ? '<th>Cód. estoque (sug.)</th><th class="num">Fator</th>' : '') +
      '<th>Motivo</th><th class="num">Qtd</th><th></th>' +
      '</tr></thead><tbody>';
    slice.forEach(function (r, idx) {
      var btnData = destKey
        ? ' data-pend-dest-key="' + escapeHtml(destKey) + '" data-pend-idx="' + idx + '"'
        : ' data-pend-global-idx="' + idx + '"';
      html += '<tr data-pend-idx="' + idx + '">' +
        '<td><code>' + escapeHtml(r.COD_PRODUTO_OL || '—') + '</code></td>' +
        '<td>' + escapeHtml(r.DESCRICAO || '—') + '</td>' +
        '<td>' + escapeHtml(r.NM_DONO || '') + '</td>' +
        (temSug
          ? '<td><code>' + escapeHtml(r.codigoInternoSugerido || '—') + '</code></td>' +
            '<td class="num">' + escapeHtml(r.fatorSugerido != null ? fmtNumProg(r.fatorSugerido, 0) : '—') + '</td>'
          : '') +
        '<td><span class="opl-prog-pend-mot opl-prog-pend-mot--' + escapeHtml(r.motivo || '') + '">' +
        escapeHtml(motivoPendenciaLbl(r.motivo)) + '</span></td>' +
        '<td class="num">' + escapeHtml(fmtNumProg(r.qtdPedida, 0)) + '</td>' +
        '<td class="opl-prog-pend-acao"><button type="button" class="btn-filtro btn-filtro-limpar btn-prog-cad-peso"' +
        btnData + '><i class="bx bx-edit"></i> Ajustar</button></td></tr>';
    });
    html += '</tbody></table></div>';
    if (rows.length > lim) {
      html += '<p class="hint">Mostrando ' + lim + ' de ' + rows.length +
        ' itens — use Exportar CSV para a lista completa.</p>';
    }
    return html;
  }

  function htmlProgPendenciasPainel(rows, painelId) {
    if (!rows || !rows.length) return '';
    var semPeso = rows.filter(function (r) { return r.motivo === 'sem_peso'; }).length;
    var semCad = rows.filter(function (r) { return r.motivo === 'sem_cadastro'; }).length;
    var html = '<div class="opl-prog-pendencias-panel" id="' + escapeHtml(painelId) + '">';
    html += '<div class="opl-prog-pendencias-hd">';
    html += '<div><strong><i class="bx bx-list-check"></i> Itens para ajustar no cadastro</strong>';
    html += '<p class="hint" style="margin:4px 0 0">' + rows.length + ' SKU(s) distintos';
    if (semPeso) html += ' · ' + semPeso + ' sem PESO_KG';
    if (semCad) html += ' · ' + semCad + ' sem cadastro/de-para';
    html += '</p></div>';
    html += '<div class="opl-prog-pendencias-actions">';
    html += '<button type="button" class="btn-filtro btn-filtro-limpar btn-prog-pend-toggle" data-panel="' +
      escapeHtml(painelId) + '"><i class="bx bx-chevron-down"></i> Ver lista</button>';
    html += '<button type="button" class="btn-filtro btn-filtro-aplicar btn-prog-pend-export" data-panel="' +
      escapeHtml(painelId) + '"><i class="bx bx-download"></i> Exportar CSV</button>';
    html += '</div></div>';
    html += '<div class="opl-prog-pendencias-body" hidden>' + htmlProgTabelaPendencias(rows, false) + '</div>';
    html += '</div>';
    return html;
  }

  function renderProgramacaoAntecipada(data) {
    var box = document.getElementById('progAntecipadaResultado');
    if (!box) return;
    if (!data) {
      box.innerHTML = '';
      return;
    }
    if (data.aviso && !(data.porDataEntrega || []).length) {
      box.innerHTML = '<p class="hint" style="margin-top:12px">' + escapeHtml(data.aviso) + '</p>';
      return;
    }
    var tg = data.totaisGeral || {};
    var pendenciasGeral = data.pendenciasPeso || [];
    var pendenciasPorDestAll = {};
    var html = '<div class="opl-prog-sec-tit"><i class="bx bx-pie-chart-alt-2"></i> Totais no período</div>';
    html += '<div class="opl-prog-hero">';
    html += htmlKpiProg('Peso total', escapeHtml(fmtKgProg(tg.pesoKg)), '', 'Demanda OPL (não NF)');
    html += htmlKpiProg('Seco / ambiente', escapeHtml(fmtKgProg(tg.pesoKgSeco)), 'opl-prog-kpi-val--seco', '');
    html += htmlKpiProg('Refrig. / congelado', escapeHtml(fmtKgProg(tg.pesoKgFrio)), 'opl-prog-kpi-val--frio', '');
    html += htmlKpiProg('Unidades', escapeHtml(fmtNumProg(tg.unidades, 0)), '', 'Vol. operacional');
    html += htmlKpiProg('Paradas', escapeHtml(fmtNumProg(tg.qtdParadas != null ? tg.qtdParadas : 0, 0)), '', 'Destinos distintos');
    html += htmlKpiProg('Espelhos', escapeHtml(fmtNumProg(tg.qtdEspelhos, 0)), '', 'Arquivos OPL');
    html += '</div>';
    html += htmlVeiculoSugestao(data.sugestaoVeiculoGeral);
    if (pendenciasGeral.length) {
      html += htmlProgPendenciasPainel(pendenciasGeral, 'progPendenciasGeral');
    }
    if (tg.pctCoberturaPeso != null && tg.pctCoberturaPeso < 100) {
      var warnCls = tg.pctCoberturaPeso < 50 ? 'opl-prog-veiculo opl-prog-veiculo-warn' : 'hint';
      html += '<div class="' + warnCls + '" style="margin-top:10px">';
      html += '<strong>Cobertura de peso:</strong> <strong>' + tg.pctCoberturaPeso +
        '%</strong> das linhas têm PESO_KG no cadastro';
      if (tg.pctCoberturaCadastro != null && tg.pctCoberturaCadastro < 100) {
        html += ' · <strong>' + tg.pctCoberturaCadastro +
          '%</strong> com produto mapeado (código OL + de-para)';
      }
      if (tg.linhasSemCadastro > 0) {
        html += '<br><span>' + fmtNumProg(tg.linhasSemCadastro, 0) +
          ' linha(s) sem cadastro — peso zerado.</span>';
      }
      if (tg.linhasSemPeso > 0) {
        html += '<br><span>' + fmtNumProg(tg.linhasSemPeso, 0) +
          ' linha(s) com cadastro mas sem PESO_KG — revise Cadastros WMS.</span>';
      }
      if (tg.pctCoberturaPeso < 50) {
        html += '<br><strong>Totais de kg abaixo do real</strong> até preencher PESO_KG e de-para.';
      }
      html += '</div>';
    }
    (data.porDataEntrega || []).forEach(function (dia) {
      var t = dia.totais || {};
      html += '<div class="opl-prog-data-card">';
      html += '<div class="opl-prog-data-hd"><h4><i class="bx bx-calendar"></i> Entrega ' +
        escapeHtml(dia.dataEntrega) + '</h4>';
      html += '<span class="opl-prog-badge">' + escapeHtml(fmtKgProg(t.pesoKg)) + ' total</span></div>';
      html += '<div class="opl-prog-hero" style="margin-top:0">';
      html += htmlKpiProg('Seco', escapeHtml(fmtKgProg(t.pesoKgSeco)), 'opl-prog-kpi-val--seco', '');
      html += htmlKpiProg('Frio', escapeHtml(fmtKgProg(t.pesoKgFrio)), 'opl-prog-kpi-val--frio', '');
      html += htmlKpiProg('Pedidos', escapeHtml(fmtNumProg(t.qtdPedidos, 0)), '', '');
      html += htmlKpiProg('Paradas', escapeHtml(fmtNumProg(t.qtdParadas, 0)), '', '');
      html += '</div>';
      html += htmlVeiculoSugestao(dia.sugestaoVeiculo);
      if ((dia.porDono || []).length) {
        html += '<div class="opl-prog-sec-tit" style="margin-top:8px;font-size:13px"><i class="bx bx-buildings"></i> Por dono</div>';
        html += '<div class="wms-sep-table-wrap"><table class="wms-sep-table"><thead><tr>' +
          '<th>Dono</th><th class="num">Peso</th><th class="num">Seco</th><th class="num">Frio</th>' +
          '<th class="num">Unid.</th><th>Espelhos</th></tr></thead><tbody>';
        dia.porDono.forEach(function (d) {
          var td = d.totais || {};
          html += '<tr><td>' + escapeHtml(d.NM_DONO || '') + '</td>' +
            '<td class="num"><strong>' + escapeHtml(fmtKgProg(td.pesoKg)) + '</strong></td>' +
            '<td class="num">' + escapeHtml(fmtKgProg(td.pesoKgSeco)) + '</td>' +
            '<td class="num">' + escapeHtml(fmtKgProg(td.pesoKgFrio)) + '</td>' +
            '<td class="num">' + escapeHtml(fmtNumProg(td.unidades, 0)) + '</td>' +
            '<td>' + escapeHtml((d.espelhosIds || []).join(', ')) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      if ((dia.porRota || []).length) {
        var treeId = 'progTree_' + String(dia.dataEntrega || '').replace(/\//g, '');
        html += '<div class="opl-prog-sec-tit" style="font-size:13px"><i class="bx bx-map"></i> Por rota cadastrada</div>';
        html += '<p class="hint" style="margin:0 0 8px;font-size:12px">Clique na rota para expandir e ver os destinatários.</p>';
        html += '<div class="opl-prog-tree-actions">';
        html += '<button type="button" class="btn-filtro btn-filtro-limpar prog-tree-expand-all" data-tree="' +
          escapeHtml(treeId) + '"><i class="bx bx-expand-alt"></i> Expandir rotas</button>';
        html += '<button type="button" class="btn-filtro btn-filtro-limpar prog-tree-collapse-all" data-tree="' +
          escapeHtml(treeId) + '"><i class="bx bx-collapse-alt"></i> Recolher rotas</button>';
        html += '</div>';
        html += '<div class="wms-sep-table-wrap"><table class="wms-sep-table opl-prog-tree" id="' +
          escapeHtml(treeId) + '"><thead><tr>' +
          '<th>Rota / destinatário</th><th class="num">Ped.</th><th class="num">Peso</th><th class="num">Seco</th><th class="num">Frio</th></tr></thead><tbody>';
        dia.porRota.forEach(function (r, idx) {
          var tr = r.totais || {};
          var rotaKey = r.NR_ROTA != null ? String(r.NR_ROTA) : 'sem_' + idx;
          html += '<tr class="opl-prog-tree-parent" data-rota-key="' + escapeHtml(rotaKey) + '" tabindex="0" role="button" aria-expanded="false">' +
            '<td><i class="bx bx-chevron-right opl-prog-chevron" aria-hidden="true"></i><strong>' +
            escapeHtml(r.rotulo || '') + '</strong>' +
            htmlProgBadgeCobertura(tr, null, null) + '</td>' +
            '<td class="num">' + escapeHtml(fmtNumProg(r.qtdParadas, 0)) + '</td>' +
            '<td class="num' + ((tr.linhasSemPeso || 0) > 0 ? ' opl-prog-peso-cel-warn' : '') + '"><strong>' +
            escapeHtml(fmtKgProg(tr.pesoKg)) + '</strong></td>' +
            '<td class="num">' + escapeHtml(fmtKgProg(tr.pesoKgSeco)) + '</td>' +
            '<td class="num">' + escapeHtml(fmtKgProg(tr.pesoKgFrio)) + '</td></tr>';
          (r.destinatarios || []).forEach(function (dest, di) {
            var td = dest.totais || {};
            var nome = dest.RAZ_SOC_DEST || dest.rotulo || '—';
            var destKey = treeId + '|' + rotaKey + '|d' + di;
            var pendDest = dest.pendenciasPeso || [];
            if (pendDest.length) pendenciasPorDestAll[destKey] = pendDest;
            html += '<tr class="opl-prog-tree-child" data-parent-rota="' + escapeHtml(rotaKey) + '">' +
              '<td><span class="dest-cod">' + escapeHtml(dest.COD_DESTINATARIO || '—') + '</span>' +
              escapeHtml(nome) +
              (dest.cidadeUf ? '<span class="dest-cidade">' + escapeHtml(dest.cidadeUf) + '</span>' : '') +
              htmlProgBadgeCobertura(td, pendDest, destKey) +
              '</td>' +
              '<td class="num">' + escapeHtml(fmtNumProg(dest.qtdPedidos, 0)) + '</td>' +
              '<td class="num' + ((td.linhasSemPeso || 0) > 0 ? ' opl-prog-peso-cel-warn' : '') + '">' +
              escapeHtml(fmtKgProg(td.pesoKg)) + '</td>' +
              '<td class="num">' + escapeHtml(fmtKgProg(td.pesoKgSeco)) + '</td>' +
              '<td class="num">' + escapeHtml(fmtKgProg(td.pesoKgFrio)) + '</td></tr>';
            if (pendDest.length) {
              html += '<tr class="opl-prog-pendencias-row" data-pend-key="' + escapeHtml(destKey) +
                '" data-parent-rota="' + escapeHtml(rotaKey) + '" hidden>' +
                '<td colspan="5">' + htmlProgTabelaPendencias(pendDest, true, destKey) + '</td></tr>';
            }
          });
        });
        html += '</tbody></table></div>';
      }
      if ((dia.espelhos || []).length) {
        html += '<p class="hint" style="margin:10px 0 0">Espelhos: ' +
          dia.espelhos.map(function (e) {
            return '#' + e.CD_OPL_ARQUIVO + ' ' + escapeHtml(e.NM_ARQUIVO || '');
          }).join(' · ') + '</p>';
      }
      html += '</div>';
    });
    if (data.aviso) {
      html += '<p class="hint" style="margin-top:12px">' + escapeHtml(data.aviso) + '</p>';
    }
    html += '<p class="hint" style="margin-top:8px;font-size:12px">' +
      escapeHtml((data.legenda && data.legenda.pesoKg) || '') + '</p>';
    box.innerHTML = html;
    box._oplPendenciasGeral = pendenciasGeral;
    box._oplPendenciasPorDest = pendenciasPorDestAll;
    vincularTreeviewProgramacao(box);
    vincularPendenciasProgramacao(box);
  }

  function toggleProgRotaTree(parentRow, expand) {
    if (!parentRow) return;
    var key = parentRow.getAttribute('data-rota-key');
    var table = parentRow.closest('table');
    if (!table || !key) return;
    var abrir = expand !== undefined ? !!expand : !parentRow.classList.contains('is-open');
    parentRow.classList.toggle('is-open', abrir);
    parentRow.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    table.querySelectorAll('.opl-prog-tree-child[data-parent-rota="' + key + '"]').forEach(function (ch) {
      ch.classList.toggle('is-visible', abrir);
    });
  }

  function setProgTreeAll(table, expand) {
    if (!table) return;
    table.querySelectorAll('.opl-prog-tree-parent').forEach(function (row) {
      toggleProgRotaTree(row, expand);
    });
  }

  function vincularPendenciasProgramacao(root) {
    if (!root) return;
    var pendenciasGeral = root._oplPendenciasGeral || [];
    var pendenciasPorDest = root._oplPendenciasPorDest || {};
    root.querySelectorAll('.btn-prog-pend-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.getAttribute('data-panel'));
        if (!panel) return;
        var body = panel.querySelector('.opl-prog-pendencias-body');
        if (!body) return;
        var abrir = body.hasAttribute('hidden');
        body.toggleAttribute('hidden', !abrir);
        btn.innerHTML = abrir
          ? '<i class="bx bx-chevron-up"></i> Ocultar lista'
          : '<i class="bx bx-chevron-down"></i> Ver lista';
      });
    });
    root.querySelectorAll('.btn-prog-pend-export').forEach(function (btn) {
      btn.addEventListener('click', function () {
        exportarPendenciasPesoCsv(pendenciasGeral);
      });
    });
    root.querySelectorAll('.btn-prog-cad-peso').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var idx = parseInt(btn.getAttribute('data-pend-global-idx'), 10);
        var pendKey = btn.getAttribute('data-pend-dest-key');
        var item = null;
        if (pendKey && pendenciasPorDest[pendKey]) {
          var row = btn.closest('tr');
          var trIdx = row ? parseInt(row.getAttribute('data-pend-idx'), 10) : NaN;
          item = pendenciasPorDest[pendKey][trIdx];
        } else if (Number.isFinite(idx)) {
          item = pendenciasGeral[idx];
        }
        abrirCadastroPesoItem(item);
      });
    });
    root.querySelectorAll('.opl-prog-ver-pend').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var key = btn.getAttribute('data-pend-key');
        var det = root.querySelector('.opl-prog-pendencias-row[data-pend-key="' + key + '"]');
        if (!det) return;
        var abrir = det.hasAttribute('hidden');
        det.toggleAttribute('hidden', !abrir);
        btn.textContent = abrir ? 'Ocultar itens' : 'Ver itens';
        if (abrir) {
          var parentRota = det.getAttribute('data-parent-rota');
          var childVis = root.querySelector(
            '.opl-prog-tree-child[data-parent-rota="' + parentRota + '"] .opl-prog-ver-pend[data-pend-key="' + key + '"]'
          );
          var childRow = childVis && childVis.closest('.opl-prog-tree-child');
          if (childRow && !childRow.classList.contains('is-visible')) {
            var parentRow = root.querySelector('.opl-prog-tree-parent[data-rota-key="' + parentRota + '"]');
            toggleProgRotaTree(parentRow, true);
          }
        }
      });
    });
  }

  function vincularTreeviewProgramacao(root) {
    if (!root) return;
    root.querySelectorAll('.opl-prog-tree-parent').forEach(function (row) {
      row.addEventListener('click', function () {
        toggleProgRotaTree(row);
      });
      row.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleProgRotaTree(row);
        }
      });
    });
    root.querySelectorAll('.prog-tree-expand-all').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-tree');
        setProgTreeAll(document.getElementById(id), true);
      });
    });
    root.querySelectorAll('.prog-tree-collapse-all').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-tree');
        setProgTreeAll(document.getElementById(id), false);
      });
    });
  }

  function montarQueryProgramacaoAntecipada() {
    var de = document.getElementById('prog_data_de');
    var ate = document.getElementById('prog_data_ate');
    var dono = document.getElementById('prog_cd_dono');
    var arq = document.getElementById('prog_nm_arquivo');
    var uf = document.getElementById('prog_uf');
    var qs = new URLSearchParams();
    if (de && de.value) {
      qs.set('dataEntregaDe', isoParaBr(de.value) || de.value);
      qs.set('dataEntregaAte', isoParaBr(ate && ate.value ? ate.value : de.value) || de.value);
    }
    if (dono && dono.value) qs.set('cdDono', dono.value);
    if (arq && arq.value.trim()) qs.set('nmArquivo', arq.value.trim());
    if (uf && uf.value.trim()) qs.set('uf', uf.value.trim());
    return qs;
  }

  function setProgImprimirHabilitado(ok) {
    var btn = document.getElementById('btnProgImprimir');
    if (btn) btn.disabled = !ok;
  }

  function syncProgImprimirTipoUi() {
    var tipoEl = document.getElementById('prog_imprimir_tipo');
    var detLbl = document.getElementById('progDetalharDestinosLabel');
    var geral = tipoEl && tipoEl.value === 'geral';
    if (detLbl) detLbl.style.display = geral ? 'none' : '';
  }

  function imprimirProgramacaoAntecipada() {
    var qs = montarQueryProgramacaoAntecipada();
    qs.set('formato', 'html');
    var tipoEl = document.getElementById('prog_imprimir_tipo');
    var tipo = tipoEl && tipoEl.value ? tipoEl.value : 'resumo';
    qs.set('tipo', tipo);
    var consEl = document.getElementById('prog_conservacao');
    var cons = consEl && consEl.value ? consEl.value : 'todos';
    qs.set('conservacao', cons);
    var chkDet = document.getElementById('prog_imprimir_detalhar_destinos');
    if (tipo !== 'geral' && chkDet && chkDet.checked) qs.set('detalharDestinos', '1');
    showLoadingOverlay(
      'Relatório',
      tipo === 'geral' ? 'Gerando listagem geral de produtos…' : 'Gerando HTML para impressão…',
      ''
    );
    fetch(apiUrl('/api/wms/separacao/opl/programacao-antecipada?' + qs.toString()), {
      headers: getAuthHeaders(),
    })
      .then(function (r) {
        return r.text().then(function (txt) {
          if (r.ok) return txt;
          var msg = txt || r.statusText || 'Erro ao gerar relatório.';
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
          showMessage('Permita janela pop-up para abrir o relatório.', 'error');
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao gerar relatório.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function consultarProgramacaoAntecipada() {
    var qs = montarQueryProgramacaoAntecipada();
    showLoadingOverlay('Calculando', 'Programação antecipada (OPL)…', 'Agregando peso por data de entrega.');
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          fetch(apiUrl('/api/wms/separacao/opl/programacao-antecipada?' + qs.toString()), {
            headers: getAuthHeaders(),
          })
            .then(fetchJsonOrThrow)
            .then(function (data) {
              renderProgramacaoAntecipada(data);
              setProgImprimirHabilitado((data.porDataEntrega || []).length > 0);
              showMessage('Programação calculada para ' + (data.porDataEntrega || []).length + ' data(s) de entrega.', 'success');
              resolve(data);
            })
            .catch(function (e) {
              renderProgramacaoAntecipada(null);
              setProgImprimirHabilitado(false);
              showMessage(e.message || 'Erro ao calcular programação.', 'error');
            })
            .finally(hideLoadingOverlay);
        });
      });
    });
  }

  function abrirProgramacaoAntecipada() {
    showTab('programacao');
    sincronizarFiltrosProgDaGrade();
    if (!document.getElementById('prog_data_de').value) definirProgAmanha();
    consultarProgramacaoAntecipada();
  }

  function fillDonoSelect() {
    if (donosEstoqueCache) {
      popularSelectsDono(donosEstoqueCache);
      return;
    }
    fetch('/api/wms/donos-estoque', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        donosEstoqueCache = rows;
        popularSelectsDono(rows);
      })
      .catch(function () {});
  }

  function setOplPainelVisivel(el, visivel) {
    if (!el) return;
    el.classList.toggle('opl-det-oculto', !visivel);
    el.hidden = !visivel;
    el.setAttribute('aria-hidden', visivel ? 'false' : 'true');
    if (visivel) el.style.removeProperty('display');
    else el.style.display = 'none';
  }

  function atualizarPaineisDonoReserva(data, pickFechado) {
    var arq = data.arquivo || {};
    var cdDono = cdDonoDoArquivo(arq);
    var wrapDono = document.getElementById('oplAssociarDonoWrap');
    var wrapRes = document.getElementById('oplAplicarReservasWrap');
    var wrapReabrir = document.getElementById('oplReabrirPickingWrap');
    var ciclo = cicloExpedicaoEncerrado(data);
    setOplPainelVisivel(wrapDono, cdDono == null && !ciclo);
    if (wrapDono && cdDono == null && !ciclo) fillDonoSelect();
    var temReserva = !!(data.reservaEstoque && data.reservaEstoque.linhas && data.reservaEstoque.linhas.length);
    var mostrarReserva = !ciclo && pickFechado && cdDono != null && !temReserva;
    setOplPainelVisivel(wrapRes, mostrarReserva);
    var mostrarReabrir = !ciclo && pickFechado && temReserva;
    setOplPainelVisivel(wrapReabrir, mostrarReabrir);
    if (mostrarReabrir) {
      var badge = document.getElementById('oplReabrirPermBadge');
      if (badge) {
        badge.textContent = data && data.permissaoLiberacaoCobertura
          ? 'Seu login pode iniciar; informe usuário e senha do supervisor autorizador (programa wms-separacao-liberar-cobertura-picking).'
          : 'O autorizador precisa do programa wms-separacao-liberar-cobertura-picking (tipo de atividade).';
      }
    }
  }

  function val(id) {
    var el = document.getElementById(id);
    return el && el.value ? String(el.value).trim() : '';
  }

  function temFiltrosImportacao() {
    return !!(
      val('filt_opl_cod_dest') ||
      val('filt_opl_razao') ||
      val('filt_opl_cidade') ||
      val('filt_opl_uf') ||
      val('filt_opl_num_pedido') ||
      val('filt_opl_nm_arquivo')
    );
  }

  function fecharModalExcluirImportacao() {
    oplPendingExcluirId = null;
    var m = document.getElementById('oplExcluirImportModal');
    if (m) {
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    }
  }

  function abrirModalExcluirImportacao(idDel, nmArquivo) {
    if (!Number.isFinite(idDel) || idDel <= 0) return;
    oplPendingExcluirId = idDel;
    var p = document.getElementById('oplExcluirImportMsg');
    if (p) {
      var fn = escapeHtml(fixMojibakeNome(nmArquivo || ''));
      p.innerHTML =
        (fn ? '<strong>Arquivo:</strong> ' + fn + '<br/><br/>' : '') +
        'Excluir esta importação e todos os pedidos e itens vinculados? <strong>Esta ação não pode ser desfeita.</strong>';
    }
    var m = document.getElementById('oplExcluirImportModal');
    if (m) {
      m.style.display = 'block';
      m.setAttribute('aria-hidden', 'false');
    }
  }

  function executarExclusaoImportacao(idDel) {
    if (!Number.isFinite(idDel) || idDel <= 0) return;
    fecharModalExcluirImportacao();
    fetch('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(idDel), {
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
        showMessage('Importação excluída.', 'success');
        if (cdOplArquivoAtual === idDel) fecharDetalhe();
        return carregarLista();
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao excluir.', 'error');
      });
  }

  function buildFiltrosImportacaoQuery() {
    var q = new URLSearchParams();
    if (val('filt_opl_cod_dest')) q.set('codDest', val('filt_opl_cod_dest'));
    if (val('filt_opl_razao')) q.set('nomeDest', val('filt_opl_razao'));
    if (val('filt_opl_cidade')) q.set('cidade', val('filt_opl_cidade'));
    if (val('filt_opl_uf')) q.set('uf', val('filt_opl_uf'));
    if (val('filt_opl_num_pedido')) q.set('numPedido', val('filt_opl_num_pedido'));
    if (val('filt_opl_nm_arquivo')) q.set('nmArquivo', val('filt_opl_nm_arquivo'));
    return q.toString();
  }

  function carregarLista() {
    showLoadingOverlay('Carregando', 'Buscando importações OPL...', '');
    var qs = buildFiltrosImportacaoQuery();
    var url = '/api/wms/separacao/opl/importacoes' + (qs ? '?' + qs : '');
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (rows) {
        var host = document.getElementById('listaImportacoes');
        if (!host) return;
        if (!Array.isArray(rows) || !rows.length) {
          host.innerHTML =
            '<p class="empty" style="padding:16px;">' +
            (temFiltrosImportacao()
              ? 'Nenhuma importação encontrada para os filtros. Ajuste os critérios ou <strong>Limpar</strong>.'
              : 'Nenhuma importação ainda. Use a aba <strong>Importar TXT</strong>.') +
            '</p>';
          return;
        }
        var html =
          '<table class="wms-sep-table"><thead><tr><th title="Selecionar para validação"><input type="checkbox" id="oplChkTodosArquivos" title="Marcar/desmarcar todos" /></th><th>ID</th><th>Arquivo</th><th>Cliente (arq.)</th><th>Pedidos</th><th>Itens</th><th title="Situação do picking na importação (gravado no banco). Excluir só é permitido enquanto estiver Pendente (0 coletados).">Picking</th><th>Importação</th><th class="opl-list-actions-header">Ações</th></tr></thead><tbody>';
        rows.forEach(function (row) {
          var id = row.CD_OPL_ARQUIVO;
          var totIt = parseInt(row.Q_ITENS, 10);
          var com = parseInt(row.Q_ITENS_COM_PICKING, 10);
          var divC = parseInt(row.Q_ITENS_DIVERGENTES, 10);
          if (!Number.isFinite(totIt)) totIt = 0;
          if (!Number.isFinite(com)) com = 0;
          if (!Number.isFinite(divC)) divC = 0;
          var pickCell = htmlCelulaPickingImportacaoLista(totIt, com, divC);
          var qMont = parseInt(row.Q_CARGAS_MONTAGEM, 10);
          if (Number.isFinite(qMont) && qMont > 0) {
            pickCell +=
              ' <span class="opl-badge opl-badge-sit-parc" title="Pedidos deste espelho estão em cargas em montagem (mesmo critério do painel Estoque / WMS)">Montagem · ' +
              escapeHtml(String(qMont)) +
              ' rota(s)</span>';
          }
          var podeExcluir = oplImportacaoExclusivelPelaLista(row);
          var btnExcluir = podeExcluir
            ? '<button type="button" class="btn-filtro btn-filtro-limpar btn-sm-opl opl-btn-excluir" data-excluir="' +
              id +
              '" data-nm-arquivo="' +
              escapeHtml(row.NM_ARQUIVO || '') +
              '" title="Excluir importação (somente sem picking gravado)"><i class="bx bx-trash"></i> Excluir</button>'
            : '<span class="hint" title="Não é possível excluir: já há picking gravado nesta importação.">—</span>';
          var temReservaLista =
            row.TEM_RESERVA === true ||
            row.TEM_RESERVA === 't' ||
            row.TEM_RESERVA === 1 ||
            row.TEM_RESERVA === '1';
          var btnReabrirLista =
            totIt > 0 && com >= totIt && temReservaLista
              ? '<button type="button" class="btn-filtro btn-filtro-aplicar btn-sm-opl" data-abrir-reabrir="' +
                id +
                '" title="Abrir detalhe e reabrir picking (supervisor — remove reserva e libera edição)"><i class="bx bx-undo"></i> Reabrir</button> '
              : '';
          html +=
            '<tr><td><input type="checkbox" class="opl-chk-arquivo" value="' +
            escapeHtml(String(id)) +
            '" data-cd-opl="' +
            escapeHtml(String(id)) +
            '" /></td><td>' +
            escapeHtml(id) +
            '</td><td>' +
            escapeHtml(row.NM_ARQUIVO) +
            '</td><td>' +
            escapeHtml(row.CLI_NOME || '—') +
            '</td><td>' +
            escapeHtml(row.Q_PEDIDOS) +
            '</td><td>' +
            escapeHtml(row.Q_ITENS) +
            '</td><td>' +
            pickCell +
            '</td><td>' +
            escapeHtml(formatDh(row.DH_IMPORT)) +
            '</td><td class="opl-list-actions-cell"><div class="opl-list-actions">' +
            '<button type="button" class="btn-filtro btn-filtro-aplicar btn-sm-opl" data-abrir="' +
            id +
            '" title="Abrir detalhe e picking"><i class="bx bx-show"></i> Abrir</button> ' +
            btnReabrirLista +
            btnExcluir +
            '</div></td></tr>';
        });
        html += '</tbody></table>';
        host.innerHTML = html;
        var chkTodos = document.getElementById('oplChkTodosArquivos');
        if (chkTodos) {
          chkTodos.addEventListener('change', function () {
            host.querySelectorAll('.opl-chk-arquivo').forEach(function (c) {
              c.checked = !!chkTodos.checked;
            });
          });
        }
        host.querySelectorAll('[data-abrir]').forEach(function (b) {
          b.addEventListener('click', function () {
            abrirDetalhe(parseInt(b.getAttribute('data-abrir'), 10));
          });
        });
        host.querySelectorAll('[data-abrir-reabrir]').forEach(function (b) {
          b.addEventListener('click', function () {
            abrirDetalhe(parseInt(b.getAttribute('data-abrir-reabrir'), 10)).then(function () {
              var wrap = document.getElementById('oplReabrirPickingWrap');
              if (wrap && !wrap.hidden) {
                try {
                  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (_) {}
                var ta = document.getElementById('oplJustificativaReabrir');
                if (ta) ta.focus();
              }
            });
          });
        });
        host.querySelectorAll('[data-excluir]').forEach(function (b) {
          b.addEventListener('click', function () {
            var idDel = parseInt(b.getAttribute('data-excluir'), 10);
            var nm = b.getAttribute('data-nm-arquivo') || '';
            if (!Number.isFinite(idDel)) return;
            abrirModalExcluirImportacao(idDel, nm);
          });
        });
      })
      .catch(function (e) {
        var host = document.getElementById('listaImportacoes');
        if (host) {
          host.innerHTML =
            '<p class="empty" style="padding:16px;">' + escapeHtml(e.message || 'Erro ao listar.') + '</p>';
        }
        showMessage(e.message || 'Erro ao listar.', 'error');
      })
      .finally(function () {
        hideLoadingOverlay();
      });
  }

  function fecharDetalhe() {
    cdOplArquivoAtual = null;
    lastDetalhe = null;
    var wAb = document.getElementById('oplSimAbertosWrap');
    if (wAb) wAb.style.display = 'none';
    var wDono = document.getElementById('oplAssociarDonoWrap');
    var wRes = document.getElementById('oplAplicarReservasWrap');
    var wReab = document.getElementById('oplReabrirPickingWrap');
    setOplPainelVisivel(wDono, false);
    setOplPainelVisivel(wRes, false);
    setOplPainelVisivel(wReab, false);
    var alertas = document.getElementById('oplDetAlertas');
    if (alertas) alertas.innerHTML = '';
    var simHost = document.getElementById('oplDetSimulacaoHost');
    if (simHost) simHost.innerHTML = '';
    var chips = document.getElementById('oplDetChips');
    if (chips) chips.innerHTML = '';
    document.getElementById('tabBtnDetalhe').style.display = 'none';
    showTab('grid');
  }

  function bindOplSimIncluirAbertosOnce() {
    if (oplSimCheckboxBound) return;
    var chk = document.getElementById('oplSimIncluirRecebAbertos');
    if (!chk) return;
    oplSimCheckboxBound = true;
    chk.addEventListener('change', function () {
      if (!cdOplArquivoAtual) return;
      abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: !!chk.checked });
    });
  }

  function abrirDetalhe(cd, opts) {
    opts = opts || {};
    cdOplArquivoAtual = cd;
    var incluirAbertos = !!opts.incluirRecebimentosAbertos;
    if (opts.incluirRecebimentosAbertos === undefined) {
      var chk0 = document.getElementById('oplSimIncluirRecebAbertos');
      if (chk0) incluirAbertos = !!chk0.checked;
    }
    var qs = incluirAbertos ? '?incluirRecebimentosAbertos=1' : '';
    showLoadingOverlay('Carregando', 'Montando picking...', '');
    return fetch(apiUrl('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cd) + qs), {
      headers: getAuthHeaders(),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (data) {
        lastDetalhe = data;
        var arq = data.arquivo || {};
        var stImp = agregarStatsPickingDesdeDetalhe(data);
        var pickFechado = oplPickingConcluidoEmTodos(stImp);
        var nmArq = fixMojibakeNome(arq.NM_ARQUIVO || 'Espelho OPL');
        var tit = document.getElementById('oplDetTituloArquivo');
        if (tit) tit.textContent = nmArq;
        var chipsEl = document.getElementById('oplDetChips');
        if (chipsEl) chipsEl.innerHTML = htmlOplDetChips(data, stImp, pickFechado);
        var alertasEl = document.getElementById('oplDetAlertas');
        if (alertasEl) alertasEl.innerHTML = htmlOplDetAlertas(data, pickFechado);
        var simHost = document.getElementById('oplDetSimulacaoHost');
        if (simHost) {
          simHost.innerHTML =
            htmlSimulacaoCobertura(data.simulacaoEstoque, { cicloEncerrado: cicloExpedicaoEncerrado(data) }) +
            htmlReservaEstoqueOpl(data.reservaEstoque);
          /** Wire up dos botões "🧹 Limpar reservas órfãs deste SKU"
           *  injetados em cada linha da simulação que tem `reservaOutrosEspelhos > 0`.
           *  Confirma, chama o endpoint, recarrega o detalhe para refletir
           *  a nova trava sem reload de página. */
          var arquivoIdAtual = arq.CD_OPL_ARQUIVO;
          Array.prototype.forEach.call(
            simHost.querySelectorAll('.btn-sim-limpar-orfas'),
            function (btn) {
              btn.addEventListener('click', function () {
                var cdDono = btn.getAttribute('data-cd-dono');
                var cdProduto = btn.getAttribute('data-cd-produto');
                var codOl = btn.getAttribute('data-codigo-ol');
                var descr = btn.getAttribute('data-descricao');
                var msg =
                  'Limpar reservas ÓRFÃS de OPL para este SKU?\n\n' +
                  '• Código OL: ' + codOl + '\n' +
                  '• ' + (descr || '') + '\n' +
                  '• Dono: ' + cdDono + '\n\n' +
                  'Apaga SOMENTE reservas cujos espelhos OPL têm TODAS as cargas vinculadas já expedidas. ' +
                  'Reservas de espelhos com carga pendente NÃO são tocadas. ' +
                  'Após a limpeza, a trava da simulação será recalculada.';
                /** Usa o modal padrão do dashboard (confirmPadrao) em vez do
                 *  alert/confirm nativo do browser — alinhado com o resto
                 *  do sistema (ex.: confirmação de "Salvar picking sem
                 *  cobertura"). Fallback para window.confirm se o utils
                 *  não estiver carregado. */
                var promConf =
                  typeof window.confirmPadrao === 'function'
                    ? window.confirmPadrao(msg, {
                        title: 'Limpar reservas órfãs',
                        danger: true,
                        confirmText: 'Limpar reservas órfãs',
                        cancelText: 'Cancelar',
                      })
                    : Promise.resolve(window.confirm(msg));
                promConf.then(function (ok) {
                  if (!ok) return;
                  efetuarLimpezaOrfas(btn, cdDono, cdProduto);
                });
              });
            }
          );
          /** Função auxiliar que faz o POST e atualiza a tela após o usuário
           *  confirmar no modal. Mantida fora do callback do confirm para
           *  legibilidade — referenciada pelo handler de cada botão. */
          function efetuarLimpezaOrfas(btn, cdDono, cdProduto) {
            btn.disabled = true;
            var txtOrig = btn.textContent;
            btn.textContent = 'Limpando…';
            fetch(
              apiUrl(
                '/api/wms/reservas-opl/limpar-orfas?cdDono=' +
                  encodeURIComponent(cdDono) +
                  '&cdProduto=' +
                  encodeURIComponent(cdProduto)
              ),
              { method: 'POST', headers: getAuthHeaders() }
            )
              .then(function (r) {
                return r.json().then(function (j) {
                  return { ok: r.ok, body: j };
                });
              })
              .then(function (res) {
                if (!res.ok) {
                  showMessage((res.body && res.body.error) || 'Falha ao limpar reservas órfãs.', 'error');
                  btn.disabled = false;
                  btn.textContent = txtOrig;
                  return;
                }
                var lib = (res.body && res.body.liberadas) || 0;
                if (lib === 0) {
                  var resOutBtn = parseFloat(btn.getAttribute('data-res-out')) || 0;
                  showMessage(
                    resOutBtn > 1e-9
                      ? 'Nenhuma reserva órfã liberável neste momento. Das ' +
                          resOutBtn +
                          ' un reservadas em outros espelhos, todas ainda têm carga pendente (não são órfãs). Aguarde a expedição ou use Relatórios → Auditoria de Saúde.'
                      : 'Nenhuma reserva órfã encontrada para este SKU.',
                    'info'
                  );
                  if (typeof abrirDetalhe === 'function' && arquivoIdAtual != null) {
                    abrirDetalhe(arquivoIdAtual, {});
                  } else {
                    btn.disabled = false;
                    btn.textContent = txtOrig;
                  }
                  return;
                }
                showMessage(
                  lib + ' reserva(s) órfã(s) liberadas. Recarregando simulação…',
                  'success'
                );
                /** Recarrega o detalhe para o saldo aparecer atualizado. */
                if (typeof abrirDetalhe === 'function' && arquivoIdAtual != null) {
                  abrirDetalhe(arquivoIdAtual, {});
                }
              })
              .catch(function (e) {
                showMessage((e && e.message) || 'Erro ao limpar reservas órfãs.', 'error');
                btn.disabled = false;
                btn.textContent = txtOrig;
              });
          }
        }
        atualizarPainelLiberacaoCobertura(data);
        document.getElementById('oplDetalheMeta').innerHTML =
          '<div><dt>Cliente</dt><dd>' +
          escapeHtml(arq.CLI_NOME || '—') +
          '</dd></div>' +
          '<div><dt>Dono estoque</dt><dd>' +
          (cdDonoDoArquivo(arq) != null
            ? escapeHtml(String(cdDonoDoArquivo(arq)))
            : '<span style="color:#b45309;font-weight:600">Não definido</span>') +
          '</dd></div>' +
          '<div><dt>Data arquivo</dt><dd>' +
          escapeHtml(arq.DATA_ARQ || '—') +
          '</dd></div>' +
          '<div><dt>Importado em</dt><dd>' +
          escapeHtml(formatDh(arq.DH_IMPORT)) +
          '</dd></div>' +
          '<div><dt>Situação</dt><dd>' +
          htmlCelulaPickingImportacaoLista(stImp.tot, stImp.com, stImp.div) +
          (stImp.com > 0
            ? ' <span class="hint" style="font-size:12px;font-weight:400" title="Proteção de histórico">· não excluível</span>'
            : '') +
          '</dd></div>';
        atualizarPaineisDonoReserva(data, pickFechado);
        limparFiltrosPicking();
        var tbody = document.getElementById('oplItensBody');
        tbody.innerHTML = '';
        (data.pedidos || []).forEach(function (p) {
          (p.itens || []).forEach(function (it) {
            var codDest = String(p.COD_DESTINATARIO != null ? p.COD_DESTINATARIO : '').trim();
            var razDest = String(p.RAZ_SOC_DEST != null ? p.RAZ_SOC_DEST : '').trim();
            var destShort =
              [codDest, razDest.length > 36 ? razDest.slice(0, 36) + '…' : razDest].filter(Boolean).join(' — ') || '—';
            var destBlob = [codDest, razDest].join(' ').toLowerCase();
            var codOlMasc = mascaraCodigoOl(it.COD_PRODUTO_OL);
            var descItem = String(it.DESCRICAO || '').trim();
            var prodBlob = [descItem, it.COD_PRODUTO_OL, codOlMasc].join(' ').toLowerCase();
            var qp0 = parseNumLoose(it.QT_PEDIDA);
            var qc0 = parseNumLoose(it.QT_COLETADA);
            var motivo0 = motivoDivergItem(it);
            var tipo0 = tipoLinhaItem(it);
            var jaSubst = motivo0 === 'SUBSTITUIDO' || !!(parseDadosJsonItem(it).cdItemSubstituto);
            var sitWords =
              tipo0 === 'SUBSTITUTO'
                ? 'extra substituto substituicao'
                : qc0 == null
                  ? 'pend pendente'
                  : motivo0 === 'SUBSTITUIDO' && Math.abs(qc0) < 1e-9
                    ? 'subst substituido'
                    : motivo0 === 'CANCELADO_CLIENTE' && Math.abs(qc0) < 1e-9
                      ? 'canc cancelado cliente'
                      : qp0 != null && Math.abs(qp0 - qc0) < 1e-5
                        ? 'ok conferido separado conforme'
                        : 'diverg divergente falta';
            var blob = [
              p.SEQ_PEDIDO,
              p.NUM_PEDIDO,
              codDest,
              razDest,
              it.SEQ_ITEM,
              it.DESCRICAO,
              it.COD_PRODUTO_OL,
              codOlMasc,
              sitWords,
              it.CD_OPL_ITEM,
            ]
              .join(' ')
              .toLowerCase();
            var dataS = '';
            try {
              dataS = encodeURIComponent(blob);
            } catch (e3) {
              dataS = '';
            }
            var qp = parseNumLoose(it.QT_PEDIDA);
            var qpAttr = qp != null ? String(qp) : String(it.QT_PEDIDA != null ? it.QT_PEDIDA : '').replace(',', '.');
            var qcVal = valorInputColetadaDisp(it.QT_PEDIDA, it.QT_COLETADA);
            var tr = document.createElement('tr');
            tr.className = 'opl-pick-row';
            tr.setAttribute('data-s', dataS);
            tr.setAttribute('data-dest', destBlob);
            tr.setAttribute('data-prod', prodBlob);
            if (tipo0 === 'SUBSTITUTO') tr.setAttribute('data-tipo-linha', 'SUBSTITUTO');
            if (jaSubst) tr.setAttribute('data-ja-substituido', '1');
            var btnSubst =
              tipo0 === 'SUBSTITUTO' || jaSubst
                ? ''
                : '<button type="button" class="btn-acao-subst-item" title="Substituir por outro produto (zera esta linha e acrescenta Extra)" data-acao="substituir">' +
                  '<i class="bx bx-transfer-alt"></i></button>';
            var btnCanc =
              tipo0 === 'SUBSTITUTO' || jaSubst
                ? ''
                : '<button type="button" class="btn-acao-canc-item" title="Cancelado pelo cliente (0 + motivo). Diferente de falta de estoque." data-acao="canc-cliente">' +
                  '<i class="bx bx-trash"></i></button>';
            var descExtra =
              tipo0 === 'SUBSTITUTO' && parseDadosJsonItem(it).codigoOlOrigem
                ? ' <span class="hint" title="Substitui ' +
                  escapeHtml(String(parseDadosJsonItem(it).codigoOlOrigem)) +
                  '">← ' +
                  escapeHtml(mascaraCodigoOl(parseDadosJsonItem(it).codigoOlOrigem)) +
                  '</span>'
                : '';
            var roOrigemSubst = jaSubst ? ' readonly' : '';
            tr.innerHTML =
              '<td class="opl-pick-chk-cell" style="text-align:center"><input type="checkbox" class="opl-pick-chk" /></td>' +
              '<td>' +
              escapeHtml(p.SEQ_PEDIDO) +
              '</td><td>' +
              escapeHtml(p.NUM_PEDIDO || '') +
              '</td><td class="opl-pick-dest" title="' +
              escapeHtml(razDest) +
              '">' +
              escapeHtml(destShort) +
              '</td><td>' +
              escapeHtml(it.SEQ_ITEM) +
              '</td><td>' +
              escapeHtml(it.DESCRICAO || '') +
              descExtra +
              '</td><td>' +
              escapeHtml(codOlMasc) +
              '</td><td class="opl-pick-sit-cell">' +
              badgePickingHtml(it.QT_PEDIDA, it.QT_COLETADA, motivo0, tipo0) +
              '</td><td class="opl-pick-qt-pedida">' +
              fmtQtdEsc(it.QT_PEDIDA) +
              '</td><td><input type="number" class="pick-qtd" min="0" step="0.000001" placeholder="se diferente" title="' +
              (jaSubst
                ? 'Linha substituída — quantidade fixa em 0. Edite a linha Extra.'
                : 'Em branco = sem divergência (igual ao pedido). Preencha só se houver diferença. Digitar NÃO salva — use Salvar picking.') +
              '" data-cd-item="' +
              escapeHtml(it.CD_OPL_ITEM) +
              '" data-qt-pedida="' +
              escapeHtml(qpAttr) +
              '" data-original="' +
              escapeHtml(qcVal) +
              '" data-motivo="' +
              escapeHtml(motivo0) +
              '" data-original-motivo="' +
              escapeHtml(motivo0) +
              '" data-tipo-linha="' +
              escapeHtml(tipo0) +
              '" value="' +
              escapeHtml(qcVal) +
              '"' +
              roOrigemSubst +
              ' /></td>' +
              '<td class="opl-pick-acoes">' +
              btnCanc +
              btnSubst +
              '</td>';
            tbody.appendChild(tr);
          });
        });
        aplicarBloqueioEdicaoPickingDetalhe(pickFechado, data);
        aplicarFiltroPicking();
        atualizarIndicadorPickingNaoSalvo();
        vincularEventosPickingLinhas();
        popularFiltrosImpressaoOpl(data);
        var wAb = document.getElementById('oplSimAbertosWrap');
        if (wAb) wAb.style.display = 'block';
        var chkSim = document.getElementById('oplSimIncluirRecebAbertos');
        if (chkSim) {
          var simF = data.simulacaoEstoque;
          if (simF && typeof simF.incluirRecebimentosAbertos === 'boolean')
            chkSim.checked = !!simF.incluirRecebimentosAbertos;
          else chkSim.checked = incluirAbertos;
        }
        bindOplSimIncluirAbertosOnce();
        document.getElementById('tabBtnDetalhe').style.display = '';
        showTab('detalhe');
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao carregar detalhe.', 'error');
        showTab('grid');
      })
      .finally(function () {
        hideLoadingOverlay();
      });
  }

  function aplicarBloqueioEdicaoPickingDetalhe(bloqueado, data) {
    var ciclo = data && cicloExpedicaoEncerrado(data);
    var pickFechado = !!bloqueado;
    var b = pickingEdicaoBloqueada(data, pickFechado);
    var st = agregarStatsPickingDesdeDetalhe(data);
    var pickingAberto = st.tot > 0 && st.com < st.tot;
    var btnSalvar = document.getElementById('btnSalvarPicking');
    var btnPosExp = document.getElementById('btnRegistrarPickingPosExp');
    var btnLimpar = document.getElementById('btnOplLimparDivergenciaSel');
    var selAll = document.getElementById('oplPickSelectAllVis');
    if (btnSalvar) {
      btnSalvar.disabled = b;
      btnSalvar.setAttribute('aria-disabled', b ? 'true' : 'false');
      btnSalvar.classList.toggle('opl-det-acao-bloqueada', b && !ciclo);
      if (ciclo) {
        btnSalvar.style.display = 'none';
      } else {
        btnSalvar.style.display = '';
        btnSalvar.title = b
          ? pickFechado && espelhoSemReservaAtiva(data)
            ? ''
            : 'Todos os itens já têm picking gravado. Alteração não permitida nesta tela.'
          : '';
      }
    }
    if (btnPosExp) {
      var showPos = !!(ciclo && pickingAberto);
      btnPosExp.style.display = showPos ? '' : 'none';
      btnPosExp.disabled = !showPos;
    }
    var btnMarcarZero = document.getElementById('btnOplMarcarZeroSel');
    var btnCancCli = document.getElementById('btnOplCancelarClienteSel');
    if (btnLimpar) {
      btnLimpar.disabled = b;
      btnLimpar.title = b ? 'Indisponível: reserva ativa ou ciclo expedido.' : 'Volta «se diferente» ao padrão (igual ao pedido)';
    }
    if (btnMarcarZero) {
      btnMarcarZero.disabled = b;
      btnMarcarZero.title = b ? 'Indisponível: reserva ativa ou ciclo expedido.' : 'Registra coletada = 0 nos itens marcados (não coletado / falta)';
    }
    if (btnCancCli) {
      btnCancCli.disabled = b;
      btnCancCli.title = b
        ? 'Indisponível: reserva ativa ou ciclo expedido.'
        : 'Marca itens cancelados pelo cliente (0 + motivo Canc.)';
    }
    if (selAll) {
      selAll.disabled = b;
      selAll.checked = false;
    }
    document.querySelectorAll('#oplItensBody input.pick-qtd').forEach(function (inp) {
      var tr = inp.closest('tr.opl-pick-row');
      var fixSubst = tr && tr.getAttribute('data-ja-substituido') === '1';
      inp.disabled = b;
      inp.readOnly = b || !!fixSubst;
    });
    document.querySelectorAll('#oplItensBody input.opl-pick-chk').forEach(function (c) {
      c.disabled = b;
      c.checked = false;
    });
    document.querySelectorAll('#oplItensBody .btn-acao-canc-item').forEach(function (btn) {
      btn.disabled = b;
    });
    document.querySelectorAll('#oplItensBody .btn-acao-subst-item').forEach(function (btn) {
      btn.disabled = b;
    });
  }

  function coletarItensParaSalvarPicking() {
    var checkedChks = document.querySelectorAll('#oplItensBody tr.opl-pick-row .opl-pick-chk:checked');
    var inputs;
    if (checkedChks.length > 0) {
      inputs = [];
      checkedChks.forEach(function (chk) {
        var tr = chk.closest('tr.opl-pick-row');
        if (!tr) return;
        var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
        if (inp) inputs.push(inp);
      });
    } else {
      inputs = [];
      document.querySelectorAll('#oplItensBody tr.opl-pick-row:not(.opl-pick-hidden)').forEach(function (tr) {
        var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
        if (inp) inputs.push(inp);
      });
    }
    var itens = [];
    inputs.forEach(function (inp) {
      var id = parseInt(inp.getAttribute('data-cd-item'), 10);
      if (!Number.isFinite(id)) return;
      var tr = inp.closest('tr.opl-pick-row');
      if (tr && tr.getAttribute('data-ja-substituido') === '1') {
        itens.push({
          cdOplItem: id,
          qtColetada: 0,
          explicito: true,
          motivoDiverg: 'SUBSTITUIDO',
        });
        return;
      }
      var v = inp.value.trim();
      var qped = parseNumLoose(inp.getAttribute('data-qt-pedida'));
      var motivoUi = String(inp.getAttribute('data-motivo') || '')
        .trim()
        .toUpperCase();
      if (v === '') {
        if (qped != null) {
          itens.push({
            cdOplItem: id,
            qtColetada: qped,
            explicito: true,
            motivoDiverg: null,
          });
        }
        return;
      }
      var vnum = parseNumLoose(v);
      var qtColetada;
      if (vnum != null && qped != null && Math.abs(vnum - qped) < 1e-5) {
        qtColetada = qped;
        motivoUi = '';
      } else if (vnum != null) {
        qtColetada = vnum;
      } else {
        qtColetada = v;
      }
      var motivo =
        (motivoUi === 'CANCELADO_CLIENTE' || motivoUi === 'SUBSTITUIDO') &&
        vnum != null &&
        Math.abs(vnum) < 1e-9
          ? motivoUi
          : null;
      itens.push({
        cdOplItem: id,
        qtColetada: qtColetada,
        explicito: true,
        motivoDiverg: motivo,
      });
    });
    return { itens: itens, checkedCount: checkedChks.length };
  }

  function executarSalvarPicking(extraBody) {
    if (!cdOplArquivoAtual) return;
    var pack = coletarItensParaSalvarPicking();
    var itens = pack.itens;
    if (!itens.length) {
      showMessage(
        pack.checkedCount > 0
          ? 'Nenhum item válido nos marcados. Marque linhas com quantidade pedida ou preencha «se diferente».'
          : 'Nenhum item visível para gravar. Abra o espelho e use Salvar picking (campo em branco = conferido igual ao pedido).',
        'error'
      );
      return Promise.resolve();
    }
    var body = Object.assign(
      {
        itens: itens,
        incluirRecebimentosAbertos: incluirRecebAbertosAtivo(),
      },
      extraBody || {}
    );
    if (vaiCompletarPickingTodosItens(itens.length)) {
      body.confirmarEncerramentoEspelho = true;
    }
    showLoadingOverlay('Salvando', 'Gravando quantidades coletadas (' + String(itens.length) + ' linha(s))...', '');
    return fetch('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cdOplArquivoAtual) + '/picking', {
      method: 'PUT',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
      .then(fetchJsonOrThrow)
      .then(function (resp) {
        var msg =
          'Picking salvo (' +
          String(itens.length) +
          ' enviado(s)). Registros atualizados no banco: ' +
          String(resp.itensAtualizados || 0);
        if (extraBody && extraBody.liberarCoberturaInsuficiente) {
          msg += '. Cobertura liberada por supervisor.';
        }
        if (resp.reservaEstoque && resp.reservaEstoque.registros > 0) {
          msg += '. Reserva gravada: ' + String(resp.reservaEstoque.registros) + ' SKU(s).';
        } else if (resp.reservaEstoque && resp.reservaEstoque.aviso) {
          msg += '. ' + resp.reservaEstoque.aviso;
        } else if (resp.reservaEstoque && resp.reservaEstoque.skipped) {
          msg += ' (' + (resp.reservaEstoque.reason || 'reserva não aplicada') + ').';
        }
        showMessage(msg, 'success');
        if (resp.reservaEstoque && resp.reservaEstoque.registros > 0) {
          fecharDetalhe();
          return carregarLista();
        }
        return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao salvar.', 'error');
        if (e.status === 409 && cdOplArquivoAtual) {
          if (!(lastDetalhe && cicloExpedicaoEncerrado(lastDetalhe))) {
            var wrap = document.getElementById('oplLiberacaoCoberturaWrap');
            if (wrap) wrap.style.display = 'block';
          }
          abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
        }
      })
      .finally(hideLoadingOverlay);
  }

  function registrarPickingPosExpedicao() {
    if (!cdOplArquivoAtual) return;
    if (!lastDetalhe || !cicloExpedicaoEncerrado(lastDetalhe)) {
      showMessage('Só disponível quando a expedição já confirmou a saída deste espelho.', 'error');
      return;
    }
    var st = agregarStatsPickingDesdeDetalhe(lastDetalhe);
    if (!(st.tot > 0 && st.com < st.tot)) {
      showMessage('Picking já está concluído neste espelho.', 'success');
      return;
    }
    var msg =
      'Registrar picking pós-expedição no espelho #' +
      String(cdOplArquivoAtual) +
      '?\n\n' +
      'Isso preenche qtd coletada = qtd pedida nos ' +
      String(st.tot - st.com) +
      ' item(ns) pendentes.\n' +
      'NÃO altera estoque nem cria reserva (já baixados na expedição).\n\n' +
      'Use só para alinhar o status da lista (Concluída).';
    var prom =
      typeof window.confirmPadrao === 'function'
        ? window.confirmPadrao(msg, {
            title: 'Registrar picking pós-expedição',
            danger: false,
            confirmText: 'Registrar histórico',
            cancelText: 'Cancelar',
          })
        : Promise.resolve(window.confirm(msg));
    prom.then(function (ok) {
      if (!ok) return;
      showLoadingOverlay('Picking', 'Registrando coleta no espelho (sem estoque)...', '');
      fetch('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cdOplArquivoAtual) + '/picking', {
        method: 'PUT',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          posExpedicao: true,
          somenteHistorico: true,
          confirmarEncerramentoEspelho: true,
          itens: [],
        }),
      })
        .then(fetchJsonOrThrow)
        .then(function (j) {
          showMessage(
            (j && j.aviso) ||
              'Picking registrado no espelho (' +
                String((j && j.itensAtualizados) || 0) +
                ' item(ns)). Estoque não alterado.',
            'success'
          );
          return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
        })
        .then(function () {
          return carregarLista();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao registrar picking pós-expedição.', 'error');
        })
        .finally(hideLoadingOverlay);
    });
  }

  function salvarPicking() {
    if (!cdOplArquivoAtual) return;
    if (lastDetalhe) {
      if (cicloExpedicaoEncerrado(lastDetalhe)) {
        var stCiclo = agregarStatsPickingDesdeDetalhe(lastDetalhe);
        if (stCiclo.tot > 0 && stCiclo.com >= stCiclo.tot) {
          showMessage(
            'Este espelho já está finalizado: picking ' +
              stCiclo.com +
              '/' +
              stCiclo.tot +
              ' e saída confirmada na expedição. Nada a gravar.',
            'success'
          );
        } else {
          showMessage(
            'Ciclo já expedido. Use «Registrar picking pós-expedição» (botão acima da lista) para só alinhar o status do espelho (sem mexer estoque).',
            'error'
          );
        }
        return;
      }
      var stBloq = agregarStatsPickingDesdeDetalhe(lastDetalhe);
      if (pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(stBloq))) {
        showMessage(
          'Picking e reserva já gravados neste espelho. Não é permitido salvar alterações nesta tela.',
          'error'
        );
        return;
      }
    }
    var packPrev = coletarItensParaSalvarPicking();
    if (!packPrev.itens.length) {
      showMessage(
        'Nenhum item para gravar. Campo «se diferente» em branco conta como conferido igual ao pedido — verifique se há linhas visíveis.',
        'error'
      );
      return;
    }
    var promSalvar = Promise.resolve(true);
    if (vaiCompletarPickingTodosItens(packPrev.itens.length)) {
      var stEnc = agregarStatsPickingDesdeDetalhe(lastDetalhe);
      var msgEnc =
        'Você está gravando ' +
        String(packPrev.itens.length) +
        ' linha(s) e vai ENCERRAR o picking deste espelho (' +
        String(stEnc.com) +
        '/' +
        String(stEnc.tot) +
        ' → ' +
        String(stEnc.tot) +
        '/' +
        String(stEnc.tot) +
        '). Confirme somente após conferência física no armazém.';
      promSalvar =
        typeof window.confirmPadrao === 'function'
          ? window.confirmPadrao(msgEnc, {
              title: 'Encerrar picking do espelho',
              danger: true,
              confirmText: 'Conferi — encerrar picking',
              cancelText: 'Cancelar',
            })
          : Promise.resolve(window.confirm(msgEnc));
    }
    promSalvar.then(function (okEnc) {
      if (!okEnc) return;
      if (vaiCompletarPickingTodosItens(packPrev.itens.length) && simIndicaFaltaSaldo()) {
      var ag = lastDetalhe.simulacaoEstoque.agregado || {};
      var nFalta = Number(ag.linhasComPossivelFalta) || 0;
      var stPrev = agregarStatsPickingDesdeDetalhe(lastDetalhe);
      var inclAb = incluirRecebAbertosAtivo();
      var msgConf =
        'A simulação indica ' +
        String(nFalta) +
        ' SKU(s) sem saldo suficiente (' +
        (inclAb ? 'NF-e encerradas + abertas' : 'somente NF-e encerradas') +
        '). ' +
        'Baixe “Exportar lista conferência física” para validar no armazém. ' +
        'Ao gravar ' +
        String(packPrev.itens.length) +
        ' linha(s), você completa o picking (' +
        String(stPrev.com) +
        '/' +
        String(stPrev.tot) +
        ' → ' +
        String(stPrev.tot) +
        '/' +
        String(stPrev.tot) +
        '). O sistema vai BLOQUEAR o encerramento. ' +
        'Para evitar: encerrar recebimentos; marcar checkbox NF abertas; gravar em partes; ou usar “Salvar picking com liberação” (supervisor). ' +
        'Tentar gravar mesmo assim (sem liberação)?';
      var promConf =
        typeof window.confirmPadrao === 'function'
          ? window.confirmPadrao(msgConf, {
              title: 'Cobertura de saldo insuficiente',
              danger: true,
              confirmText: 'Gravar mesmo assim',
              cancelText: 'Cancelar',
            })
          : Promise.resolve(window.confirm(msgConf));
      promConf.then(function (ok) {
        if (!ok) return;
        executarSalvarPicking(null);
      });
        return;
      }
      executarSalvarPicking(null);
    });
  }

  function salvarPickingComLiberacao() {
    if (!cdOplArquivoAtual) return;
    if (lastDetalhe && cicloExpedicaoEncerrado(lastDetalhe)) {
      var stLib = agregarStatsPickingDesdeDetalhe(lastDetalhe);
      showMessage(
        stLib.tot > 0 && stLib.com >= stLib.tot
          ? 'Picking e expedição já concluídos neste espelho. A liberação de cobertura só vale antes da saída.'
          : 'Ciclo já expedido. Use «Registrar picking pós-expedição» (não a liberação de supervisor).',
        'error'
      );
      return;
    }
    var just = (document.getElementById('oplJustificativaLiberacao') || {}).value || '';
    just = String(just).trim();
    var login = (document.getElementById('oplAutorizadoLogin') || {}).value || '';
    login = String(login).trim();
    var senha = (document.getElementById('oplAutorizadoSenha') || {}).value || '';
    senha = String(senha).trim();
    if (just.length < 10) {
      showMessage('Informe a justificativa da liberação (mínimo 10 caracteres).', 'error');
      return;
    }
    if (!login || !senha) {
      showMessage('Informe usuário e senha do supervisor autorizador.', 'error');
      return;
    }
    executarSalvarPicking({
      liberarCoberturaInsuficiente: true,
      autorizadoLogin: login,
      autorizadoSenha: senha,
      justificativaLiberacao: just,
    });
  }

  document.getElementById('btnVoltarHub') &&
    document.getElementById('btnVoltarHub').addEventListener('click', function () {
      if (window.parent && typeof window.parent.loadModuleContent === 'function') {
        window.parent.loadModuleContent('estoque');
      }
    });

  document.querySelectorAll('.wms-sep-container .tabs .tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = b.getAttribute('data-tab');
      showTab(tab);
      if (tab === 'programacao') {
        var elDe = document.getElementById('prog_data_de');
        if (elDe && !elDe.value) definirProgAmanha();
      }
    });
  });

  var formProg = document.getElementById('formProgAntecipada');
  if (formProg) {
    formProg.addEventListener('submit', function (e) {
      e.preventDefault();
      consultarProgramacaoAntecipada();
    });
  }
  document.getElementById('btnProgSincGrade') &&
    document.getElementById('btnProgSincGrade').addEventListener('click', sincronizarFiltrosProgDaGrade);
  document.getElementById('btnProgAmanha') &&
    document.getElementById('btnProgAmanha').addEventListener('click', definirProgAmanha);
  document.getElementById('btnProgImprimir') &&
    document.getElementById('btnProgImprimir').addEventListener('click', imprimirProgramacaoAntecipada);
  document.getElementById('prog_imprimir_tipo') &&
    document.getElementById('prog_imprimir_tipo').addEventListener('change', syncProgImprimirTipoUi);
  syncProgImprimirTipoUi();
  function idsArquivosOplSelecionados() {
    var ids = [];
    document.querySelectorAll('#listaImportacoes .opl-chk-arquivo:checked').forEach(function (c) {
      var n = parseInt(c.value, 10);
      if (Number.isFinite(n) && n > 0) ids.push(n);
    });
    return ids;
  }

  var oplValidacaoAtual = null;

  function fecharModalValidarPedidos() {
    var m = document.getElementById('oplValidarPedidosModal');
    if (m) {
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    }
  }

  function situacaoValidacaoLabel(sit) {
    if (sit === 'DUPLICIDADE_IDENTICA') return 'Duplicidade idêntica (pedido + destino + volume)';
    if (sit === 'DIVERGENCIA_DESTINO') return 'Mesmo pedido — destino divergente';
    if (sit === 'DIVERGENCIA_VOLUME') return 'Mesmo pedido — volume divergente';
    if (sit === 'DIVERGENCIA_DESTINO_E_VOLUME') return 'Mesmo pedido — destino e volume divergentes';
    return sit || '—';
  }

  function renderValidacaoPedidosModal(resultado) {
    oplValidacaoAtual = resultado;
    var body = document.getElementById('oplValidarPedidosBody');
    var modal = document.getElementById('oplValidarPedidosModal');
    if (!body || !modal) return;
    var cor =
      resultado.veredito === 'SEGURO' ? '#059669' : resultado.veredito === 'BLOQUEIO' ? '#b91c1c' : '#b45309';
    var html =
      '<p style="margin:0 0 10px;"><span style="display:inline-block;padding:6px 12px;border-radius:8px;background:' +
      cor +
      ';color:#fff;font-weight:700;">' +
      escapeHtml(resultado.veredito || '') +
      '</span> ' +
      escapeHtml(resultado.vereditoLabel || '') +
      '</p>';
    html +=
      '<p class="hint" style="margin:0 0 12px;">Modo: <strong>' +
      escapeHtml(resultado.modo || '') +
      '</strong> · Em comum: <strong>' +
      escapeHtml(String((resultado.resumo && resultado.resumo.pedidosEmComum) || 0)) +
      '</strong> · Idênticos: <strong>' +
      escapeHtml(String((resultado.resumo && resultado.resumo.duplicidadeIdentica) || 0)) +
      '</strong> · Divergentes: <strong>' +
      escapeHtml(String((resultado.resumo && resultado.resumo.divergencias) || 0)) +
      '</strong></p>';
    html +=
      '<p class="hint" style="margin:0 0 12px;">Critérios objetivos: nº pedido; destino = código + razão + cidade + UF; volume = itens (código OL × qtd). Sem cruzamento com NF.</p>';

    if (resultado.arquivos && resultado.arquivos.length) {
      html += '<ul style="margin:0 0 14px;padding-left:18px;">';
      resultado.arquivos.forEach(function (a) {
        html +=
          '<li>#' +
          escapeHtml(String(a.CD_OPL_ARQUIVO)) +
          ' — ' +
          escapeHtml(a.NM_ARQUIVO || '') +
          (a.Q_PEDIDOS_EM_COMUM != null
            ? ' · em comum: ' + escapeHtml(String(a.Q_PEDIDOS_EM_COMUM))
            : '') +
          '</li>';
      });
      html += '</ul>';
    }

    var conflitos = resultado.conflitos || [];
    if (!conflitos.length) {
      html += '<p><strong>Nenhum conflito.</strong> Pode operar com segurança quanto a duplicidade de pedido entre esses espelhos.</p>';
    } else {
      conflitos.forEach(function (c) {
        html +=
          '<div style="margin:0 0 14px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;">' +
          '<div style="font-weight:700;margin-bottom:6px;">Pedido ' +
          escapeHtml(c.NUM_PEDIDO || c.PEDIDO) +
          ' — ' +
          escapeHtml(situacaoValidacaoLabel(c.SITUACAO)) +
          '</div>' +
          '<div class="hint" style="margin-bottom:8px;">Destino OK: <strong>' +
          (c.DESTINO_OK ? 'SIM' : 'NÃO') +
          '</strong> · Volume OK: <strong>' +
          (c.VOLUME_OK ? 'SIM' : 'NÃO') +
          '</strong></div>' +
          '<table class="wms-sep-table" style="font-size:12px;"><thead><tr>' +
          '<th>Arq.</th><th>Nome</th><th>Origem</th><th>Destino</th><th>Cidade/UF</th><th class="num">Itens</th><th class="num">Qtd</th><th class="num">Pick</th>' +
          '</tr></thead><tbody>';
        (c.OCORRENCIAS || []).forEach(function (o) {
          html +=
            '<tr><td>' +
            escapeHtml(String(o.CD_OPL_ARQUIVO)) +
            '</td><td>' +
            escapeHtml(o.NM_ARQUIVO || '—') +
            '</td><td>' +
            escapeHtml(o.ORIGEM || '—') +
            '</td><td>' +
            escapeHtml((o.COD_DESTINATARIO || '') + ' ' + (o.RAZ_SOC_DEST || '')) +
            '</td><td>' +
            escapeHtml((o.CIDADE_ENTREGA || '') + '/' + (o.UF_ENTREGA || '')) +
            '</td><td class="num">' +
            escapeHtml(String(o.N_ITENS)) +
            '</td><td class="num">' +
            escapeHtml(String(o.QTD_TOTAL)) +
            '</td><td class="num">' +
            escapeHtml(String(o.N_ITENS_PICK)) +
            '</td></tr>';
        });
        html += '</tbody></table></div>';
      });
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }

  function executarValidacaoPedidosOpl(modo) {
    var ids = idsArquivosOplSelecionados();
    if (modo === 'entre' && ids.length < 2) {
      showMessage('Marque pelo menos 2 arquivos para validar entre si.', 'error');
      return;
    }
    if (modo === 'historico' && ids.length < 1) {
      showMessage('Marque pelo menos 1 arquivo para validar contra o histórico.', 'error');
      return;
    }
    var qs =
      'cdOplArquivos=' +
      encodeURIComponent(ids.join(',')) +
      '&modo=' +
      encodeURIComponent(modo === 'historico' ? 'historico' : 'entre') +
      '&formato=json';
    showLoadingOverlay('Validando', 'Cruzando pedidos, destino e volume...', '');
    return fetch('/api/wms/separacao/opl/validar-pedidos?' + qs, { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (resultado) {
        renderValidacaoPedidosModal(resultado);
        if (resultado.veredito === 'SEGURO') {
          showMessage(resultado.vereditoLabel || 'Validação segura.', 'success');
        } else if (resultado.veredito === 'BLOQUEIO') {
          showMessage(resultado.vereditoLabel || 'Duplicidade encontrada.', 'error');
        } else {
          showMessage(resultado.vereditoLabel || 'Divergência encontrada.', 'error');
        }
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro na validação.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function urlValidacaoPedidosFmt(formato) {
    if (!oplValidacaoAtual) return '';
    var ids = (oplValidacaoAtual.arquivos || []).map(function (a) {
      return a.CD_OPL_ARQUIVO;
    });
    if (!ids.length) ids = idsArquivosOplSelecionados();
    var modo =
      oplValidacaoAtual.modo === 'CONTRA_HISTORICO' ? 'historico' : 'entre';
    return (
      '/api/wms/separacao/opl/validar-pedidos?cdOplArquivos=' +
      encodeURIComponent(ids.join(',')) +
      '&modo=' +
      encodeURIComponent(modo) +
      '&formato=' +
      encodeURIComponent(formato)
    );
  }

  document.getElementById('btnIrProgramacaoGrade') &&
    document.getElementById('btnIrProgramacaoGrade').addEventListener('click', abrirProgramacaoAntecipada);

  document.getElementById('btnValidarPedidosEntre') &&
    document.getElementById('btnValidarPedidosEntre').addEventListener('click', function () {
      executarValidacaoPedidosOpl('entre');
    });
  document.getElementById('btnValidarPedidosHist') &&
    document.getElementById('btnValidarPedidosHist').addEventListener('click', function () {
      executarValidacaoPedidosOpl('historico');
    });
  document.getElementById('oplValidarPedidosFechar') &&
    document.getElementById('oplValidarPedidosFechar').addEventListener('click', fecharModalValidarPedidos);
  document.getElementById('oplValidarPedidosHtml') &&
    document.getElementById('oplValidarPedidosHtml').addEventListener('click', function () {
      var u = urlValidacaoPedidosFmt('html');
      if (!u) return showMessage('Execute a validação antes.', 'error');
      showLoadingOverlay('Relatório', 'Gerando HTML...', '');
      fetch(u, { headers: getAuthHeaders() })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.error) || r.statusText); });
          return r.text();
        })
        .then(function (html) {
          var w = window.open('', '_blank');
          if (!w) {
            showMessage('Permita pop-up para abrir o relatório.', 'error');
            return;
          }
          w.document.open();
          w.document.write(html);
          w.document.close();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao abrir HTML.', 'error');
        })
        .finally(hideLoadingOverlay);
    });
  document.getElementById('oplValidarPedidosCsv') &&
    document.getElementById('oplValidarPedidosCsv').addEventListener('click', function () {
      var u = urlValidacaoPedidosFmt('csv');
      if (!u) return showMessage('Execute a validação antes.', 'error');
      showLoadingOverlay('Exportando', 'Gerando CSV...', '');
      fetch(u, { headers: getAuthHeaders() })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.error) || r.statusText); });
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'validacao-pedidos-opl.csv';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao baixar CSV.', 'error');
        })
        .finally(hideLoadingOverlay);
    });
  var modalVal = document.getElementById('oplValidarPedidosModal');
  if (modalVal) {
    modalVal.addEventListener('click', function (ev) {
      if (ev.target === modalVal) fecharModalValidarPedidos();
    });
  }

  document.getElementById('btnAtualizarLista') &&
    document.getElementById('btnAtualizarLista').addEventListener('click', function () {
      carregarLista();
    });

  var formFiltrosOpl = document.getElementById('formFiltrosOplImportacoes');
  if (formFiltrosOpl) {
    formFiltrosOpl.addEventListener('submit', function (e) {
      e.preventDefault();
      carregarLista();
    });
  }
  document.getElementById('btnLimparFiltrosOpl') &&
    document.getElementById('btnLimparFiltrosOpl').addEventListener('click', function () {
      ['filt_opl_cod_dest', 'filt_opl_razao', 'filt_opl_cidade', 'filt_opl_uf', 'filt_opl_num_pedido', 'filt_opl_nm_arquivo'].forEach(
        function (id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        }
      );
      carregarLista();
    });

  document.getElementById('btnFecharDetalhe') &&
    document.getElementById('btnFecharDetalhe').addEventListener('click', function () {
      fecharDetalhe();
      carregarLista();
    });

  document.getElementById('btnSalvarPicking') &&
    document.getElementById('btnSalvarPicking').addEventListener('click', salvarPicking);
  document.getElementById('btnRegistrarPickingPosExp') &&
    document.getElementById('btnRegistrarPickingPosExp').addEventListener('click', registrarPickingPosExpedicao);

  document.getElementById('btnAssociarDonoOpl') &&
    document.getElementById('btnAssociarDonoOpl').addEventListener('click', function () {
      if (!cdOplArquivoAtual) return;
      var sel = document.getElementById('opl_cd_dono_detalhe');
      if (!sel || !sel.value) {
        showMessage('Selecione o dono do estoque.', 'error');
        return;
      }
      showLoadingOverlay('Associando', 'Vinculando dono ao espelho...', '');
      fetch('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cdOplArquivoAtual) + '/dono', {
        method: 'PATCH',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ CD_DONO: parseInt(sel.value, 10) }),
      })
        .then(fetchJsonOrThrow)
        .then(function () {
          showMessage('Dono associado. Simulação e reservas passam a usar este dono.', 'success');
          return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao associar dono.', 'error');
        })
        .finally(hideLoadingOverlay);
    });

  document.getElementById('btnExportarCoberturaFisica') &&
    document.getElementById('btnExportarCoberturaFisica').addEventListener('click', function () {
      exportarCoberturaCsv(true);
    });
  document.getElementById('btnExportarCoberturaCompleta') &&
    document.getElementById('btnExportarCoberturaCompleta').addEventListener('click', function () {
      exportarCoberturaCsv(false);
    });
  document.getElementById('btnSalvarPickingComLiberacao') &&
    document.getElementById('btnSalvarPickingComLiberacao').addEventListener('click', salvarPickingComLiberacao);

  document.getElementById('btnAplicarReservasOpl') &&
    document.getElementById('btnAplicarReservasOpl').addEventListener('click', function () {
      if (!cdOplArquivoAtual) return;
      showLoadingOverlay('Reservando', 'Validando cobertura e gravando reservas...', '');
      var bodyRes = { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() };
      var justR = String((document.getElementById('oplJustificativaLiberacao') || {}).value || '').trim();
      var loginR = String((document.getElementById('oplAutorizadoLogin') || {}).value || '').trim();
      var senhaR = String((document.getElementById('oplAutorizadoSenha') || {}).value || '').trim();
      if (justR.length >= 10 && loginR && senhaR) {
        bodyRes.liberarCoberturaInsuficiente = true;
        bodyRes.justificativaLiberacao = justR;
        bodyRes.autorizadoLogin = loginR;
        bodyRes.autorizadoSenha = senhaR;
      }
      fetch(
        '/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cdOplArquivoAtual) + '/aplicar-reservas',
        {
          method: 'POST',
          headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
          body: JSON.stringify(bodyRes),
        }
      )
        .then(fetchJsonOrThrow)
        .then(function (resp) {
          var n =
            resp.reservaEstoque && resp.reservaEstoque.registros != null
              ? resp.reservaEstoque.registros
              : resp.reservaEstoque && resp.reservaEstoque.linhas
                ? resp.reservaEstoque.linhas.length
                : 0;
          showMessage('Reservas aplicadas' + (n ? ' (' + String(n) + ' SKU(s)).' : '.'), 'success');
          return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao aplicar reservas.', 'error');
        })
        .finally(hideLoadingOverlay);
    });

  document.getElementById('btnReabrirPickingOpl') &&
    document.getElementById('btnReabrirPickingOpl').addEventListener('click', function () {
      if (!cdOplArquivoAtual) return;
      var just = String((document.getElementById('oplJustificativaReabrir') || {}).value || '').trim();
      var login = String((document.getElementById('oplReabrirAutorizadoLogin') || {}).value || '').trim();
      var senha = String((document.getElementById('oplReabrirAutorizadoSenha') || {}).value || '');
      if (just.length < 10) {
        showMessage('Informe a justificativa (mínimo 10 caracteres).', 'error');
        return;
      }
      if (!login || !senha) {
        showMessage('Informe usuário e senha do autorizador.', 'error');
        return;
      }
      var msgReabrir =
        'Reabrir picking deste espelho?\n\n' +
        'As reservas serão removidas e a edição será liberada. ' +
        'As quantidades coletadas permanecem — corrija e use «Salvar picking» de novo.';
      var promReabrir =
        typeof window.confirmPadrao === 'function'
          ? window.confirmPadrao(msgReabrir, {
              title: 'Reabrir picking',
              danger: true,
              confirmText: 'Reabrir',
              cancelText: 'Cancelar',
            })
          : Promise.resolve(false);
      promReabrir.then(function (ok) {
        if (!ok) return;
        showLoadingOverlay('Reabrindo', 'Removendo reservas e liberando edição...', '');
        fetch(
          '/api/wms/separacao/opl/importacoes/' + encodeURIComponent(cdOplArquivoAtual) + '/reabrir-picking',
          {
            method: 'POST',
            headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              justificativaLiberacao: just,
              autorizadoLogin: login,
              autorizadoSenha: senha,
            }),
          }
        )
          .then(fetchJsonOrThrow)
          .then(function (resp) {
            var senhaEl = document.getElementById('oplReabrirAutorizadoSenha');
            if (senhaEl) senhaEl.value = '';
            showMessage(
              (resp && resp.mensagem) ||
                'Picking reaberto. Corrija e salve de novo para reaplicar as reservas.',
              'success'
            );
            return abrirDetalhe(cdOplArquivoAtual, { incluirRecebimentosAbertos: incluirRecebAbertosAtivo() });
          })
          .catch(function (e) {
            showMessage(e.message || 'Erro ao reabrir picking.', 'error');
          })
          .finally(hideLoadingOverlay);
      });
    });

  var oplFiltroPicking = document.getElementById('oplFiltroPicking');
  if (oplFiltroPicking) {
    oplFiltroPicking.addEventListener('input', aplicarFiltroPicking);
  }
  var oplFiltroDestino = document.getElementById('oplFiltroDestino');
  if (oplFiltroDestino) oplFiltroDestino.addEventListener('input', aplicarFiltroPicking);
  var oplFiltroProduto = document.getElementById('oplFiltroProduto');
  if (oplFiltroProduto) oplFiltroProduto.addEventListener('input', aplicarFiltroPicking);
  var btnOplLimparFiltrosPick = document.getElementById('btnOplLimparFiltrosPick');
  if (btnOplLimparFiltrosPick) {
    btnOplLimparFiltrosPick.addEventListener('click', limparFiltrosPicking);
  }
  var oplPickSelectAllVis = document.getElementById('oplPickSelectAllVis');
  if (oplPickSelectAllVis) {
    oplPickSelectAllVis.addEventListener('change', function () {
      var on = oplPickSelectAllVis.checked;
      document.querySelectorAll('#oplItensBody tr.opl-pick-row:not(.opl-pick-hidden) .opl-pick-chk').forEach(function (c) {
        c.checked = on;
      });
    });
  }

  function vincularEventosPickingLinhas() {
    document.querySelectorAll('#oplItensBody input.pick-qtd').forEach(function (inp) {
      if (inp.getAttribute('data-pick-bound') === '1') return;
      inp.setAttribute('data-pick-bound', '1');
      inp.addEventListener('input', function () {
        var tr = inp.closest('tr.opl-pick-row');
        var v = String(inp.value || '').trim();
        var vnum = parseNumLoose(v);
        var motivo = String(inp.getAttribute('data-motivo') || '')
          .trim()
          .toUpperCase();
        /** Se alterou a qtd e não é mais 0, cancela motivos de zeragem. */
        if (
          (motivo === 'CANCELADO_CLIENTE' || motivo === 'SUBSTITUIDO') &&
          (v === '' || vnum == null || Math.abs(vnum) >= 1e-9)
        ) {
          inp.setAttribute('data-motivo', '');
        }
        atualizarBadgeSitLinha(tr);
        atualizarIndicadorPickingNaoSalvo();
      });
    });
    document.querySelectorAll('#oplItensBody .btn-acao-canc-item').forEach(function (btn) {
      if (btn.getAttribute('data-pick-bound') === '1') return;
      btn.setAttribute('data-pick-bound', '1');
      btn.addEventListener('click', function () {
        if (lastDetalhe && pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(agregarStatsPickingDesdeDetalhe(lastDetalhe)))) {
          showMessage('Picking bloqueado para edição (reserva ativa ou ciclo expedido).', 'error');
          return;
        }
        var tr = btn.closest('tr.opl-pick-row');
        if (tr && tr.getAttribute('data-tipo-linha') === 'SUBSTITUTO') {
          showMessage('Linha Extra (substituto) não usa cancelamento de cliente.', 'warning');
          return;
        }
        if (marcarLinhaCanceladoCliente(tr)) {
          atualizarIndicadorPickingNaoSalvo();
          showMessage('Item marcado como cancelado pelo cliente. Use Salvar picking para gravar.', 'info');
        }
      });
    });
    document.querySelectorAll('#oplItensBody .btn-acao-subst-item').forEach(function (btn) {
      if (btn.getAttribute('data-pick-bound') === '1') return;
      btn.setAttribute('data-pick-bound', '1');
      btn.addEventListener('click', function () {
        if (lastDetalhe && pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(agregarStatsPickingDesdeDetalhe(lastDetalhe)))) {
          showMessage('Picking bloqueado para edição (reserva ativa ou ciclo expedido). Reabra o picking se necessário.', 'error');
          return;
        }
        var tr = btn.closest('tr.opl-pick-row');
        if (!tr) return;
        if (tr.getAttribute('data-tipo-linha') === 'SUBSTITUTO' || tr.getAttribute('data-ja-substituido') === '1') {
          showMessage('Esta linha não pode ser substituída novamente.', 'warning');
          return;
        }
        var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
        if (!inp) return;
        abrirModalSubstituirItem({
          cdOplItem: parseInt(inp.getAttribute('data-cd-item'), 10),
          codigoOl: (tr.getAttribute('data-prod') || '').trim(),
          descricao: '',
          tr: tr,
        });
      });
    });
  }

  document.getElementById('btnOplLimparDivergenciaSel') &&
    document.getElementById('btnOplLimparDivergenciaSel').addEventListener('click', function () {
      if (lastDetalhe && pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(agregarStatsPickingDesdeDetalhe(lastDetalhe)))) {
        showMessage('Picking bloqueado para edição (reserva ativa ou ciclo expedido).', 'error');
        return;
      }
      var n = 0;
      document.querySelectorAll('#oplItensBody tr.opl-pick-row .opl-pick-chk:checked').forEach(function (c) {
        var tr = c.closest ? c.closest('tr') : c.parentElement && c.parentElement.parentElement;
        if (!tr) return;
        var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
        if (inp) {
          inp.value = '';
          limparMotivoLinha(tr);
          atualizarBadgeSitLinha(tr);
          n++;
        }
      });
      atualizarIndicadorPickingNaoSalvo();
      if (!n) showMessage('Marque ao menos uma linha (checkbox) ou ajuste o filtro.', 'info');
    });

  document.getElementById('btnOplMarcarZeroSel') &&
    document.getElementById('btnOplMarcarZeroSel').addEventListener('click', function () {
      if (lastDetalhe && pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(agregarStatsPickingDesdeDetalhe(lastDetalhe)))) {
        showMessage('Picking bloqueado para edição (reserva ativa ou ciclo expedido).', 'error');
        return;
      }
      var n = 0;
      document.querySelectorAll('#oplItensBody tr.opl-pick-row .opl-pick-chk:checked').forEach(function (c) {
        var tr = c.closest ? c.closest('tr') : c.parentElement && c.parentElement.parentElement;
        if (!tr || tr.getAttribute('data-tipo-linha') === 'SUBSTITUTO') return;
        var inp = tr.querySelector('input.pick-qtd[data-cd-item]');
        if (inp) {
          inp.value = '0';
          limparMotivoLinha(tr);
          atualizarBadgeSitLinha(tr);
          n++;
        }
      });
      atualizarIndicadorPickingNaoSalvo();
      if (!n) {
        showMessage('Marque as linhas (checkbox) e clique novamente para registrar coletada = 0 (não coletado / falta).', 'info');
      }
    });

  document.getElementById('btnOplCancelarClienteSel') &&
    document.getElementById('btnOplCancelarClienteSel').addEventListener('click', function () {
      if (lastDetalhe && pickingEdicaoBloqueada(lastDetalhe, oplPickingConcluidoEmTodos(agregarStatsPickingDesdeDetalhe(lastDetalhe)))) {
        showMessage('Picking bloqueado para edição (reserva ativa ou ciclo expedido).', 'error');
        return;
      }
      var n = 0;
      document.querySelectorAll('#oplItensBody tr.opl-pick-row .opl-pick-chk:checked').forEach(function (c) {
        var tr = c.closest ? c.closest('tr') : c.parentElement && c.parentElement.parentElement;
        if (marcarLinhaCanceladoCliente(tr)) n++;
      });
      atualizarIndicadorPickingNaoSalvo();
      if (!n) {
        showMessage('Marque as linhas (checkbox) e clique em Cancelar (cliente), ou use a lixeira na linha.', 'info');
      } else {
        showMessage(n + ' item(ns) marcado(s) como cancelado pelo cliente. Use Salvar picking para gravar.', 'info');
      }
    });

  (function bindModalSubstituir() {
    var btnCancel = document.getElementById('oplSubstituirItemCancelar');
    if (btnCancel) btnCancel.addEventListener('click', fecharModalSubstituirItem);
    var btnOk = document.getElementById('oplSubstituirItemConfirmar');
    if (btnOk) btnOk.addEventListener('click', confirmarSubstituirItem);
    var modal = document.getElementById('oplSubstituirItemModal');
    if (modal) {
      modal.addEventListener('click', function (ev) {
        if (ev.target === modal) fecharModalSubstituirItem();
      });
    }
    var cod = document.getElementById('oplSubstCodigo');
    if (cod) {
      cod.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var q = document.getElementById('oplSubstQtd');
          if (q) q.focus();
        }
      });
    }
    var qtd = document.getElementById('oplSubstQtd');
    if (qtd) {
      qtd.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          confirmarSubstituirItem();
        }
      });
    }
  })();

  (function initRomFolhasGeralHint() {
    var fEl = document.getElementById('romFolhas');
    var aEl = document.getElementById('romAgruparItens');
    if (!fEl) return;
    function sync() {
      if (fEl.value === 'geral' && aEl) aEl.value = '1';
    }
    fEl.addEventListener('change', sync);
    sync();
  })();

  document.getElementById('btnRomaneioImprimir') &&
    document.getElementById('btnRomaneioImprimir').addEventListener('click', function () {
      if (!cdOplArquivoAtual) return;
      var cEl = document.getElementById('romConservacao');
      var aEl = document.getElementById('romAgruparItens');
      var fEl = document.getElementById('romFolhas');
      var c = cEl ? cEl.value : 'todos';
      var a = aEl ? aEl.value : '1';
      var f = fEl ? fEl.value : 'dest';
      if (f === 'geral') a = '1';
      var ordem = getRomaneioOrdemSelecionada();
      var sepEl = document.getElementById('romSeparadoresGrupo');
      var sep = sepEl ? sepEl.value : 'auto';
      var colChk = document.getElementById('romExibirColunaCad');
      var q = new URLSearchParams();
      q.set('conservacao', c);
      q.set('agruparItens', a);
      q.set('folhas', f);
      q.set('separadores', sep);
      if (colChk && colChk.checked) q.set('colunaCad', '1');
      else if (colChk) q.set('colunaCad', '0');
      if (ordem.length) q.set('ordem', ordem.join(','));
      var filtrosImp = lerFiltrosImpressaoOpl();
      if (filtrosImp.destinatarios.length) q.set('destinatarios', filtrosImp.destinatarios.join(','));
      if (filtrosImp.unidades.length) q.set('unidades', filtrosImp.unidades.join(','));
      if (filtrosImp.conservacoes.length) q.set('conservacoes', filtrosImp.conservacoes.join(','));
      if (filtrosImp.grupos.length) q.set('grupos', filtrosImp.grupos.join(','));
      if (filtrosImp.categorias.length) q.set('categorias', filtrosImp.categorias.join(','));
      if (filtrosImp.pedidos.length) q.set('pedidos', filtrosImp.pedidos.join(','));
      if (filtrosImp.codigoOl) q.set('codigoOl', filtrosImp.codigoOl);
      var url =
        '/api/wms/separacao/opl/importacoes/' + encodeURIComponent(String(cdOplArquivoAtual)) + '/romaneio?' + q.toString();
      showLoadingOverlay('Romaneio', 'Gerando HTML para impressão...', '');
      fetch(url, { headers: getAuthHeaders() })
        .then(function (r) {
          return r.text().then(function (txt) {
            if (r.ok) return txt;
            var msg = txt || r.statusText || 'Erro ao gerar romaneio.';
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
            showMessage('Permita janela pop-up para abrir o romaneio.', 'error');
            return;
          }
          w.document.open();
          w.document.write(html);
          w.document.close();
          w.focus();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao gerar romaneio.', 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });

  (function initRomaneioLayoutPrefs() {
    var sepEl = document.getElementById('romSeparadoresGrupo');
    var colChk = document.getElementById('romExibirColunaCad');
    var ordIds = ['romOrd1', 'romOrd2', 'romOrd3', 'romOrd4', 'romOrd5'];
    initRomaneioOrdemSelects();
    syncRomaneioColunaCadDefault();
    if (colChk) {
      colChk.addEventListener('change', function () {
        colChk.dataset.userTouched = '1';
      });
    }
    function onRomLayoutChange() {
      syncRomaneioColunaCadDefault();
    }
    function onSeparadoresChange() {
      aplicarSugestaoOrdemRomaneio(false);
      onRomLayoutChange();
    }
    if (sepEl) sepEl.addEventListener('change', onSeparadoresChange);
    ordIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          var ord1 = document.getElementById('romOrd1');
          if (ord1) ord1.dataset.userTouched = '1';
          onRomLayoutChange();
        });
      }
    });
  })();

  /** Atualiza o resumo conforme o usuário mexe nos campos do bloco "Filtros para impressão específica". */
  ['romFiltroDestinatarios', 'romFiltroUnidades', 'romFiltroPedidos', 'romFiltroCodigoOl'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, atualizarResumoFiltrosImpressaoOpl);
  });

  document.getElementById('romFiltroConservacoes') &&
    document.getElementById('romFiltroConservacoes').addEventListener('change', function () {
      aplicarFiltroCadastroRomaneioEncadeado();
    });
  document.getElementById('romFiltroGrupos') &&
    document.getElementById('romFiltroGrupos').addEventListener('change', function () {
      aplicarFiltroCadastroRomaneioEncadeado();
    });
  document.getElementById('romFiltroCategorias') &&
    document.getElementById('romFiltroCategorias').addEventListener('change', atualizarResumoFiltrosImpressaoOpl);

  /** Filtro encadeado: ao mudar a seleção de unidades, o select de
   *  destinatários é repopulado mostrando só os que entregam nessas cidades.
   *  Vazio = sem filtro (todos visíveis novamente). */
  document.getElementById('romFiltroUnidades') &&
    document.getElementById('romFiltroUnidades').addEventListener('change', function () {
      aplicarFiltroDestPorUnidade();
    });

  document.getElementById('btnRomLimparFiltros') &&
    document.getElementById('btnRomLimparFiltros').addEventListener('click', function () {
      ['romFiltroDestinatarios', 'romFiltroUnidades', 'romFiltroConservacoes', 'romFiltroGrupos', 'romFiltroCategorias'].forEach(function (id) {
        var sel = document.getElementById(id);
        if (sel) for (var i = 0; i < sel.options.length; i++) sel.options[i].selected = false;
      });
      var pedEl = document.getElementById('romFiltroPedidos');
      if (pedEl) pedEl.value = '';
      var codEl = document.getElementById('romFiltroCodigoOl');
      if (codEl) codEl.value = '';
      /** Restaura a lista completa de destinatários após limpar unidades. */
      aplicarFiltroDestPorUnidade([]);
      aplicarFiltroCadastroRomaneioEncadeado({ prevGrupos: [], prevCategorias: [] });
      atualizarResumoFiltrosImpressaoOpl();
    });

  function escAud(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function montarTabelaAuditoriaSecao(titulo, lista, truncado) {
    if (!lista || !lista.length) return '';
    var rows = lista
      .map(function (it) {
        return (
          '<tr><td>' +
          escAud(it.codigoMascara || it.codigoOl) +
          '</td><td>' +
          escAud(it.descricao) +
          '</td><td><strong>' +
          escAud(it.inferidoRomaneio || '—') +
          '</strong></td><td class="num">' +
          escAud(String(it.ocorrencias)) +
          '</td><td>' +
          escAud(it.motivo) +
          '</td><td><small>' +
          escAud(it.dica || '') +
          '</small></td></tr>'
        );
      })
      .join('');
    var suf = truncado ? '<p class="hint" style="margin:6px 0 0">Lista limitada — corrija no cadastro e rode a revisão de novo.</p>' : '';
    return (
      '<div class="opl-auditoria-sec"><h4>' +
      escAud(titulo) +
      ' (' +
      lista.length +
      ')</h4><table><thead><tr><th>Código</th><th>Descrição</th><th>Sugestão</th><th>Linhas</th><th>Problema</th><th>Orientação</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      suf +
      '</div>'
    );
  }

  function renderCorpoAuditoriaCadastro(aud) {
    if (!aud || !aud.resumo) return '<p>Nenhum dado de auditoria.</p>';
    var r = aud.resumo;
    var html = '';
    if (r.ok) {
      html += '<p><strong>Tudo certo:</strong> ' + escAud(aud.mensagem || '') + '</p>';
      return html;
    }
    if (aud.donoEspelho && (aud.donoEspelho.nmDono || aud.donoEspelho.cdDono != null)) {
      html +=
        '<p class="hint" style="margin:0 0 10px"><strong>Dono do espelho:</strong> ' +
        escAud(
          [aud.donoEspelho.nmDono, aud.donoEspelho.cdDono != null ? '(' + aud.donoEspelho.cdDono + ')' : '']
            .filter(Boolean)
            .join(' ')
        ) +
        ' — a auditoria só considera produtos deste dono.</p>';
    }
    html += montarTabelaAuditoriaSecao(
      'Cadastrado em outro dono (não vale para este espelho)',
      aud.itens && aud.itens.cadastrado_outro_dono,
      aud.truncado && aud.truncado.cadastrado_outro_dono
    );
    html += montarTabelaAuditoriaSecao(
      'Sem cadastro no dono do espelho (veja Sugestão — «fresca» = REFRIGERADO)',
      aud.itens && aud.itens.sem_cadastro,
      aud.truncado && aud.truncado.sem_cadastro
    );
    html += montarTabelaAuditoriaSecao(
      'Sem conservação (tipo vazio)',
      aud.itens && aud.itens.sem_conservacao,
      aud.truncado && aud.truncado.sem_conservacao
    );
    html += montarTabelaAuditoriaSecao(
      'Cadastro SECO, mas frio (NCM/descrição)',
      aud.itens && aud.itens.seco_suspeito_frio,
      aud.truncado && aud.truncado.seco_suspeito_frio
    );
    return html;
  }

  var oplCadAutoPreviewData = null;

  function renderPreviewCadastroAutomatico(prev) {
    if (!prev || !prev.itens) return '<p>Nenhuma prévia disponível.</p>';
    var aplicaveis = (prev.itens || []).filter(function (i) {
      return i.aplicavel && i.passos && i.passos.length;
    });
    if (!aplicaveis.length) {
      return (
        '<p class="hint"><strong>Prévia:</strong> ' +
        escAud(prev.mensagem || 'Nenhum item aplicável.') +
        '</p><p class="hint">Importe o catálogo OL (Mana) ou cadastre manualmente no WMS.</p>'
      );
    }
    var r = prev.resumo || {};
    var head =
      '<p class="hint" style="margin:0 0 10px"><strong>Prévia — conferir antes de aplicar.</strong> ' +
      'Cadastro principal = código que controla estoque. De-para = código do espelho OPL → estoque.</p>' +
      '<p class="hint" style="margin:0 0 10px">' +
      escAud(String(r.aplicaveis || aplicaveis.length)) +
      ' item(ns): ' +
      escAud(String(r.criarProduto || 0)) +
      ' produto(s), ' +
      escAud(String(r.criarDepara || 0)) +
      ' de-para, ' +
      escAud(String(r.atualizarConservacao || 0)) +
      ' conservação.</p>';
    var rows = aplicaveis
      .map(function (it) {
        var passosTxt = (it.passos || [])
          .map(function (p) {
            if (p.acao === 'CRIAR_PRODUTO') return 'Produto ' + p.codigo + ' (' + (p.tipoArmazenagem || 'SECO') + ')';
            if (p.acao === 'CRIAR_DEPARA') {
              return p.jaExiste
                ? 'De-para já existe'
                : 'De-para ' + p.codigoExterno + ' → ' + p.codigoInterno + ' ×' + p.fatorConversao;
            }
            if (p.acao === 'ATUALIZAR_CONSERVACAO') return 'Conservação → ' + p.tipoArmazenagem;
            return p.acao;
          })
          .join('; ');
        return (
          '<tr><td>' +
          escAud(it.codigoMascara || it.codigoOpl) +
          '</td><td>' +
          escAud(it.descricao || '—') +
          '</td><td><strong>' +
          escAud(it.controleEstoque || it.codigoEstoque || '—') +
          '</strong></td><td><small>' +
          escAud(passosTxt) +
          '</small></td><td>' +
          escAud(it.resumo || '') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      head +
      '<div class="opl-auditoria-sec"><h4>Cadastro principal + de-para (automático)</h4>' +
      '<table><thead><tr><th>Código OPL</th><th>Descrição</th><th>Estoque (principal)</th><th>Ações</th><th>Resumo</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  function carregarPreviewCadastroAutomatico(cd) {
    if (!cd) return Promise.resolve();
    showLoadingOverlay('Cadastro automático', 'Montando prévia para conferência...', '');
    return fetch(
      apiUrl('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(String(cd)) + '/cadastro-automatico/preview'),
      { headers: getAuthHeaders() }
    )
      .then(fetchJsonOrThrow)
      .then(function (prev) {
        oplCadAutoPreviewData = prev;
        var box = document.getElementById('oplCadAutoPreview');
        var btnApply = document.getElementById('oplAuditoriaCadAutoAplicar');
        if (box) {
          box.style.display = 'block';
          box.innerHTML = renderPreviewCadastroAutomatico(prev);
        }
        if (btnApply) {
          var n = (prev.resumo && prev.resumo.aplicaveis) || 0;
          btnApply.style.display = n > 0 ? 'inline-flex' : 'none';
        }
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro na prévia de cadastro automático.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function aplicarCadastroAutomaticoOpl(cd) {
    if (!cd) return Promise.resolve();
    if (!confirm('Aplicar cadastro principal e de-para conforme a prévia? Revise a tabela antes de confirmar.')) {
      return Promise.resolve();
    }
    showLoadingOverlay('Cadastro automático', 'Gravando cadastro e de-para...', '');
    return fetch(
      apiUrl('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(String(cd)) + '/cadastro-automatico/aplicar'),
      { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()), body: '{}' }
    )
      .then(fetchJsonOrThrow)
      .then(function (resp) {
        showMessage(resp.mensagem || 'Cadastro aplicado.', 'success');
        if (resp.auditoriaDepois) {
          mostrarModalAuditoriaCadastro(resp.auditoriaDepois);
          return carregarPreviewCadastroAutomatico(cd);
        }
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao aplicar cadastro automático.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  function mostrarModalAuditoriaCadastro(aud) {
    var modal = document.getElementById('oplAuditoriaCadModal');
    var resumo = document.getElementById('oplAuditoriaCadResumo');
    var corpo = document.getElementById('oplAuditoriaCadCorpo');
    var boxPrev = document.getElementById('oplCadAutoPreview');
    var btnPrev = document.getElementById('oplAuditoriaCadAutoPreview');
    var btnApply = document.getElementById('oplAuditoriaCadAutoAplicar');
    if (!modal || !resumo || !corpo) return;
    oplCadAutoPreviewData = null;
    if (boxPrev) {
      boxPrev.style.display = 'none';
      boxPrev.innerHTML = '';
    }
    if (btnApply) btnApply.style.display = 'none';
    var r = (aud && aud.resumo) || {};
    var partes = [];
    partes.push(r.totalCodigosUnicos + ' código(s) únicos no espelho.');
    if (r.totalComAlerta > 0) {
      var nOutro = r.cadastradoOutroDono != null ? r.cadastradoOutroDono : 0;
      partes.push(
        r.totalComAlerta +
          ' com alerta: ' +
          nOutro +
          ' em outro dono, ' +
          r.semCadastro +
          ' sem cadastro no dono do espelho, ' +
          r.semConservacao +
          ' sem tipo, ' +
          r.secoSuspeitoFrio +
          ' SECO suspeito.'
      );
    }
    resumo.textContent = (aud && aud.mensagem ? aud.mensagem + ' ' : '') + partes.join(' ');
    corpo.innerHTML = renderCorpoAuditoriaCadastro(aud);
    if (btnPrev) {
      var temPend =
        r.totalComAlerta > 0 &&
        ((r.semCadastro != null && r.semCadastro > 0) ||
          (r.cadastradoOutroDono != null && r.cadastradoOutroDono > 0) ||
          (r.semConservacao != null && r.semConservacao > 0));
      btnPrev.style.display = temPend ? 'inline-flex' : 'none';
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }

  function fecharModalAuditoriaCadastro() {
    var modal = document.getElementById('oplAuditoriaCadModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  function carregarAuditoriaCadastroOpl(cd) {
    if (!cd) {
      showMessage('Abra um espelho importado antes de revisar o cadastro.', 'info');
      return Promise.resolve();
    }
    showLoadingOverlay('Auditoria', 'Conferindo cadastro dos códigos...', '');
    return fetch(apiUrl('/api/wms/separacao/opl/importacoes/' + encodeURIComponent(String(cd)) + '/auditoria-cadastro?autoAplicar=1'), {
      headers: getAuthHeaders(),
    })
      .then(fetchJsonOrThrow)
      .then(function (resp) {
        if (resp.auditoriaCadastro) mostrarModalAuditoriaCadastro(resp.auditoriaCadastro);
        else showMessage('Auditoria sem retorno.', 'info');
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao auditar cadastro.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  document.getElementById('oplAuditoriaCadFechar') &&
    document.getElementById('oplAuditoriaCadFechar').addEventListener('click', fecharModalAuditoriaCadastro);
  document.getElementById('oplAuditoriaCadAutoPreview') &&
    document.getElementById('oplAuditoriaCadAutoPreview').addEventListener('click', function () {
      if (!cdOplArquivoAtual) {
        showMessage('Abra um espelho importado.', 'info');
        return;
      }
      carregarPreviewCadastroAutomatico(cdOplArquivoAtual);
    });
  document.getElementById('oplAuditoriaCadAutoAplicar') &&
    document.getElementById('oplAuditoriaCadAutoAplicar').addEventListener('click', function () {
      if (!cdOplArquivoAtual) return;
      aplicarCadastroAutomaticoOpl(cdOplArquivoAtual);
    });
  var modalAud = document.getElementById('oplAuditoriaCadModal');
  if (modalAud) {
    modalAud.addEventListener('click', function (ev) {
      if (ev.target === modalAud) fecharModalAuditoriaCadastro();
    });
  }
  document.getElementById('btnAuditoriaCadastroOpl') &&
    document.getElementById('btnAuditoriaCadastroOpl').addEventListener('click', function () {
      if (!cdOplArquivoAtual) {
        showMessage('Abra o detalhe de um espelho importado.', 'info');
        return;
      }
      carregarAuditoriaCadastroOpl(cdOplArquivoAtual);
    });

  document.getElementById('formImportOpl') &&
    document.getElementById('formImportOpl').addEventListener('submit', function (e) {
      e.preventDefault();
      var fileEl = document.getElementById('opl_arquivo');
      var donoEl = document.getElementById('opl_cd_dono');
      if (!fileEl || !fileEl.files || !fileEl.files[0]) {
        showMessage('Selecione o arquivo .txt.', 'error');
        return;
      }
      if (!donoEl || !donoEl.value) {
        showMessage('Selecione o dono do estoque antes de importar. Sem dono não há saldo, reserva nem trava de cobertura.', 'error');
        return;
      }
      var fd = new FormData();
      fd.append('arquivo', fileEl.files[0]);
      fd.append('CD_DONO', donoEl.value);
      showLoadingOverlay('Importando', 'Lendo e gravando OPL...', '');
      fetch('/api/wms/separacao/opl/importar', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      })
        .then(fetchJsonOrThrow)
        .then(function (resp) {
          showMessage('Importação concluída. ID ' + resp.cdOplArquivo + '.', 'success');
          if (
            resp.auditoriaCadastro &&
            resp.auditoriaCadastro.resumo &&
            resp.auditoriaCadastro.resumo.totalComAlerta > 0
          ) {
            mostrarModalAuditoriaCadastro(resp.auditoriaCadastro);
          }
          fileEl.value = '';
          carregarLista();
          showTab('grid');
        })
        .catch(function (err) {
          var msg = err.message || 'Erro na importação.';
          if (err.status === 409 && err.payload && err.payload.cdOplArquivo) {
            var p = err.payload;
            var rn = p.resumoNovo || {};
            var re = p.resumoExistente || {};
            msg =
              'Conteúdo idêntico ao espelho #' +
              p.cdOplArquivo +
              ' («' +
              String(p.nmArquivoExistente || '').trim() +
              '»). ' +
              'Seu .txt: ' +
              (rn.pedidos != null ? rn.pedidos : '?') +
              ' ped. / ' +
              (rn.itens != null ? rn.itens : '?') +
              ' itens' +
              (rn.dataArq ? ' (data interna ' + rn.dataArq + ')' : '') +
              ' · Gravado: ' +
              (re.pedidos != null ? re.pedidos : '?') +
              ' ped. / ' +
              (re.itens != null ? re.itens : '?') +
              ' itens' +
              (re.dataArq ? ' (data ' + re.dataArq + ')' : '') +
              '. O nome do arquivo não entra na comparação — só os bytes do espelho.';
          }
          showMessage(msg, 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
        });
    });

  var modalEx = document.getElementById('oplExcluirImportModal');
  if (modalEx) {
    modalEx.addEventListener('click', function (ev) {
      if (ev.target === modalEx) fecharModalExcluirImportacao();
    });
  }
  document.getElementById('oplExcluirImportCancelar') &&
    document.getElementById('oplExcluirImportCancelar').addEventListener('click', fecharModalExcluirImportacao);
  document.getElementById('oplExcluirImportConfirmar') &&
    document.getElementById('oplExcluirImportConfirmar').addEventListener('click', function () {
      var idDel = oplPendingExcluirId;
      if (!Number.isFinite(idDel) || idDel <= 0) {
        fecharModalExcluirImportacao();
        return;
      }
      executarExclusaoImportacao(idDel);
    });

  definirProgAmanha();
  fillDonoSelect();
  carregarLista();
})();
