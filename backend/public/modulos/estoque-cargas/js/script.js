(function () {
  var cdCargaDetalhe = null;
  var nfDisponiveisCache = [];
  var ultimaListaCargas = [];
  var cargaFiltroState = {
    page: 1,
    pageSize: 50,
    stCarga: '',
    stExpedicao: '',
    dhCriacaoDe: '',
    dhCriacaoAte: '',
    dhExpedicaoDe: '',
    dhExpedicaoAte: '',
    busca: '',
    numeroNf: '',
    serie: '',
    idViagem: '',
  };
  var cargaEditState = { id: null };
  var cargaDeleteState = { id: null };
  var nfRemoveState = { idNfe: null };
  var nfExcluirState = { idNfe: null, label: '' };
  var nfDetalheCdAtual = null;
  var donosCargaDetalhe = [];
  var nfesDetalheCache = [];
  /** Cache da lista de donos (selects). */
  var cacheDonosEstoque = [];
  /** CD_DONO do cabeçalho da carga aberta no detalhe (null = misto / pelas NF). */
  var cargaDetalheCdDono = null;
  /** true quando ST_EXPEDICAO é EM_EXPEDICAO ou EXPEDIDA — programação da carga não editável (API + UI). */
  var cargaDetalheProgramacaoBloqueada = false;
  /** Valor bruto de ST_EXPEDICAO no detalhe (para mensagem assertiva no banner). */
  var cargaDetalheStExpedicaoRaw = '';
  var cargaDetalheFiltroDestino = '';
  var cargaDetalheModoListaNf = 'grupo';
  var cargaTransferDestinoState = { chave: '', label: '', qtdNf: 0 };
  /** Acordeão «Por destino» no resumo logístico (chave → expandido). */
  var cargaResumoDestinosExpandidos = {};
  /** Grupos «Por endereço de entrega» na lista de NF (chave → expandido). */
  var cargaNfGruposExpandidos = {};

  function normalizeImportInputMode() {
    var inp = document.getElementById('impSaidaArquivo');
    if (!inp) return;
    // Garante modo "multi-arquivo" mesmo com HTML antigo em cache.
    inp.removeAttribute('webkitdirectory');
    inp.removeAttribute('directory');
    inp.multiple = true;
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

  var messageEl = document.getElementById('message');
  function showMessage(text, type, _el, fieldId) {
    if (typeof window.showMessage === 'function' && window.showMessage !== showMessage) {
      window.showMessage(text, type, messageEl || _el, fieldId);
      return;
    }
    if (type === 'error' && typeof window.tocarSomOperadorFeedback === 'function') {
      window.tocarSomOperadorFeedback('error');
    }
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.className = 'message ' + (type || '');
    messageEl.style.display = text ? 'block' : 'none';
  }

  function showLoading(t, a, b) {
    var o = document.getElementById('loadingOverlay');
    if (!o) return;
    var x = document.getElementById('loadingTitle');
    var y = document.getElementById('loadingText');
    var z = document.getElementById('loadingDetalhe');
    if (x) x.textContent = t || 'Carregando';
    if (y) y.textContent = a || 'Aguarde…';
    if (z) z.textContent = b || '';
    o.style.display = 'flex';
  }
  function hideLoading() {
    var o = document.getElementById('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  /** Abre HTML imprimível (romaneio / frios) em nova janela; API com Bearer. */
  function abrirImpressaoHtml(url) {
    showLoading('Impressão', 'Gerando documento…', '');
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    })
      .then(function () {
        return fetch(url, { headers: getAuthHeaders() });
      })
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
          showMessage('Permita janela pop-up para imprimir.', 'error');
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao gerar impressão.', 'error');
      })
      .finally(hideLoading);
  }

  function copiarTextoParaClipboard(texto, msgOk) {
    var t = String(texto || '').trim();
    if (!t) {
      showMessage('Nada para copiar.', 'error');
      return Promise.resolve(false);
    }
    msgOk = msgOk || 'Copiado para a área de transferência.';
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) showMessage(msgOk, 'success');
        else showMessage('Não foi possível copiar. Selecione o texto manualmente.', 'error');
        return ok;
      } catch (e) {
        document.body.removeChild(ta);
        showMessage('Não foi possível copiar.', 'error');
        return false;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () {
        showMessage(msgOk, 'success');
        return true;
      }).catch(function () {
        return fallback();
      });
    }
    return Promise.resolve(fallback());
  }

  /** Célula com atalho para copiar a chave completa (44 dígitos). */
  function htmlCelulaChaveNfe(ch, modo) {
    var chFull = normalizeChaveNfe(ch);
    if (!chFull) return '—';
    var chShort = chFull.length > 20 ? chFull.slice(0, 8) + '…' + chFull.slice(-6) : chFull;
    var label = modo === 'modal' ? chFull : chShort;
    return (
      '<span class="wms-chave-nfe-cell">' +
      '<span class="wms-chave-nfe-text" title="' +
      escapeHtml(chFull) +
      '">' +
      escapeHtml(label) +
      '</span>' +
      '<button type="button" class="btn-copiar-chave-nfe btn-filtro btn-filtro-limpar" data-chave="' +
      escapeHtml(chFull) +
      '" title="Copiar chave completa (44 dígitos)"><i class="bx bx-copy"></i></button>' +
      '</span>'
    );
  }

  function bindCopiarChaveButtons(root) {
    (root || document).querySelectorAll('.btn-copiar-chave-nfe').forEach(function (btn) {
      if (btn.getAttribute('data-bound-copiar-chave') === '1') return;
      btn.setAttribute('data-bound-copiar-chave', '1');
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        copiarTextoParaClipboard(btn.getAttribute('data-chave') || '', 'Chave da NF-e copiada (44 dígitos).');
      });
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** node-pg pode devolver chaves em minúsculas; aceita o nome da coluna em maiúsculas. */
  function pickRow(row, name) {
    if (!row) return null;
    var low = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    if (Object.prototype.hasOwnProperty.call(row, low)) return row[low];
    return null;
  }

  function trimRowVal(v) {
    if (v == null) return '';
    return String(v).trim();
  }

  /** Cidade e UF do endereço de entrega (XML &lt;entrega&gt; → XMUN_DEST / UF_DEST na importação). */
  function cidadeUfEntregaNfe(row) {
    if (!row) return { uf: '', cidade: '' };
    return {
      uf: trimRowVal(pickRow(row, 'UF_DEST')),
      cidade: trimRowVal(pickRow(row, 'XMUN_DEST')),
    };
  }

  /** Nome da unidade de entrega (XNOME_ENTREGA); não confundir com município. */
  function nomeUnidadeEntregaNfe(row) {
    if (!row) return '—';
    var ne = trimRowVal(pickRow(row, 'XNOME_ENTREGA'));
    if (ne) return ne;
    return trimRowVal(pickRow(row, 'XNOME_DEST')) || '—';
  }

  /** Rótulo combo NF disponível: UF — Cidade — Unidade — NF/Série */
  function labelNfeDisponivelCombo(row) {
    var loc = cidadeUfEntregaNfe(row);
    var un = nomeUnidadeEntregaNfe(row);
    var nf =
      (trimRowVal(pickRow(row, 'NUMERO_NF')) || '?') + '/' + (trimRowVal(pickRow(row, 'SERIE')) || '?');
    return [loc.uf || '—', loc.cidade || '—', un, nf].join(' — ');
  }

  function compareNfDisponivelOrdenacao(a, b) {
    var la = cidadeUfEntregaNfe(a);
    var lb = cidadeUfEntregaNfe(b);
    var ufA = (la.uf || '').toUpperCase();
    var ufB = (lb.uf || '').toUpperCase();
    if (ufA !== ufB) return ufA.localeCompare(ufB, 'pt');
    var cidA = (la.cidade || '').toUpperCase();
    var cidB = (lb.cidade || '').toUpperCase();
    if (cidA !== cidB) return cidA.localeCompare(cidB, 'pt');
    var unA = nomeUnidadeEntregaNfe(a).toUpperCase();
    var unB = nomeUnidadeEntregaNfe(b).toUpperCase();
    if (unA !== unB) return unA.localeCompare(unB, 'pt');
    var na = parseInt(String(pickRow(a, 'NUMERO_NF') || '').replace(/\D/g, ''), 10) || 0;
    var nb = parseInt(String(pickRow(b, 'NUMERO_NF') || '').replace(/\D/g, ''), 10) || 0;
    if (na !== nb) return na - nb;
    return String(pickRow(a, 'SERIE') || '').localeCompare(String(pickRow(b, 'SERIE') || ''), 'pt');
  }

  /**
   * Mesma prioridade que backend/services/wms-nfe-saida-destino-display.service.js
   * (entrega → destinatário → logradouro → município/UF).
   */
  function nomeEntregaUnidadeOuLocalDestinoNfe(row) {
    if (!row) return '';
    var ne = trimRowVal(pickRow(row, 'XNOME_ENTREGA'));
    if (ne) return ne;
    var nd = trimRowVal(pickRow(row, 'XNOME_DEST'));
    if (nd) return nd;
    var log = trimRowVal(pickRow(row, 'XLGR_DEST'));
    var nro = trimRowVal(pickRow(row, 'NRO_DEST'));
    var end = [log, nro].filter(Boolean).join(', ');
    if (end) return end;
    var mun = trimRowVal(pickRow(row, 'XMUN_DEST'));
    var uf = trimRowVal(pickRow(row, 'UF_DEST'));
    return [mun, uf].filter(Boolean).join(' / ');
  }

  function linkCompletarEnderecoEntrega(row) {
    if (!row) return null;
    var cdCad = row.EE_CD_CLIENTE != null ? row.EE_CD_CLIENTE : null;
    var cdEnd = row.CD_ENDERECO_ENTREGA != null ? row.CD_ENDERECO_ENTREGA : null;
    if (!cdCad) return null;
    return { cdCadastro: cdCad, cdEndereco: cdEnd, aba: 'enderecos-entrega' };
  }

  function abrirCadastroEnderecoEntrega(link, meta) {
    if (!link || link.cdCadastro == null) return;
    var fila = lerFilaPendenciasEndereco();
    if (meta && meta.indice != null && fila && Array.isArray(fila.itens)) {
      salvarFilaPendenciasEndereco(fila.itens, fila.resumoImport, { indiceAtual: meta.indice, ativo: true });
    } else if (fila && fila.itens && fila.itens.length) {
      salvarFilaPendenciasEndereco(fila.itens, fila.resumoImport, { ativo: true });
    }
    fecharModalPendenciasEnderecoImportacao();
    if (typeof window.loadModuleContent === 'function') {
      window.loadModuleContent('gerenciar-cadastro-geral', {
        cadastroGeralEnderecoEntrega: {
          cdCadastro: link.cdCadastro,
          cdEndereco: link.cdEndereco,
          fromNfPendentes: true,
          nf: meta && meta.nf != null ? String(meta.nf) : '',
          serie: meta && meta.serie != null ? String(meta.serie) : '',
        },
      });
    }
  }

  function badgeCadastroEnderecoNf(row) {
    if (!enderecoEntregaPrecisaCompletar(row)) return '';
    return (
      '<span class="nf-badge-cad nf-badge-cad-rascunho" title="Ponto em rascunho — falta rota e/ou coordenadas">Cad. pendente</span>'
    );
  }

  function htmlLinkCompletarCadastroNf(link, rotulo) {
    if (!link || link.cdCadastro == null) return '';
    var lbl = rotulo || 'Completar cadastro';
    return (
      ' <button type="button" class="btn-link-nf btn-nf-completar-cad" data-cd-cadastro="' +
      escapeHtml(String(link.cdCadastro)) +
      '" data-cd-endereco="' +
      escapeHtml(link.cdEndereco != null ? String(link.cdEndereco) : '') +
      '">' +
      escapeHtml(lbl) +
      '</button>'
    );
  }

  function enderecoEntregaPrecisaCompletar(row) {
    if (!row) return false;
    var st = String(row.EE_ST_COMPLETUDE || '').toUpperCase();
    if (st === 'RASCUNHO') return true;
    if (row.CD_ENDERECO_ENTREGA != null && row.EE_NR_ROTA == null && row.EE_NR_ROTA !== 0) return true;
    return false;
  }

  function rotuloPendenciasEndereco(pendencias) {
    var map = { NR_ROTA: 'Rota', COORDENADAS: 'Coordenadas' };
    var arr = Array.isArray(pendencias) ? pendencias : [];
    if (!arr.length) return 'Rota e coordenadas';
    return arr
      .map(function (p) {
        return map[p] || String(p);
      })
      .join(', ');
  }

  function rotuloStatusEnderecoEntrega(ee) {
    if (!ee) return '';
    if (ee.status === 'RASCUNHO_CRIADO') return 'Rascunho criado';
    if (ee.status === 'RASCUNHO_EXISTENTE') return 'Rascunho existente';
    if (ee.status === 'AMBIGUO') return 'Endereço ambíguo';
    if (ee.status === 'SEM_CLIENTE_MATRIZ') return 'Sem matriz no cadastro';
    if (ee.status === 'ERRO') return 'Erro';
    if (ee.pendencias && ee.pendencias.length) return 'Incompleto';
    return 'Atenção';
  }

  var nfEePendentesUltimaImportacao = [];
  var NF_EE_PEND_STORAGE = 'wmsNfEePendentes';

  function lerFilaPendenciasEndereco() {
    try {
      var raw = sessionStorage.getItem(NF_EE_PEND_STORAGE);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function salvarFilaPendenciasEndereco(itens, resumoImport, extra) {
    var prev = lerFilaPendenciasEndereco() || {};
    var payload = {
      itens: Array.isArray(itens) ? itens : prev.itens || [],
      resumoImport: resumoImport !== undefined ? resumoImport : prev.resumoImport || null,
      indiceAtual: extra && extra.indiceAtual != null ? extra.indiceAtual : prev.indiceAtual || 0,
      ativo: extra && extra.ativo != null ? extra.ativo : prev.ativo !== false,
      atualizadoEm: Date.now(),
    };
    try {
      sessionStorage.setItem(NF_EE_PEND_STORAGE, JSON.stringify(payload));
    } catch (e) {}
    atualizarBtnPendenciasEndereco();
    return payload;
  }

  function limparFilaPendenciasEndereco() {
    try {
      sessionStorage.removeItem(NF_EE_PEND_STORAGE);
    } catch (e) {}
    atualizarBtnPendenciasEndereco();
  }

  function coletarPendenciasEnderecoDasLinhasNf(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(enderecoEntregaPrecisaCompletar).map(function (row) {
      var link = linkCompletarEnderecoEntrega(row);
      var pend = [];
      if (row.EE_NR_ROTA == null && row.EE_NR_ROTA !== 0) pend.push('NR_ROTA');
      pend.push('COORDENADAS');
      return {
        nf: row.NUMERO_NF != null ? String(row.NUMERO_NF) : '—',
        serie: row.SERIE != null ? String(row.SERIE) : '',
        status: row.EE_ST_COMPLETUDE || 'RASCUNHO',
        rotulo: 'Rascunho existente',
        pendenciasTxt: rotuloPendenciasEndereco(pend),
        link: link,
        destino: nomeEntregaUnidadeOuLocalDestinoNfe(row),
      };
    });
  }

  function atualizarBtnPendenciasEndereco() {
    var btn = document.getElementById('btnAbrirNfEePendentes');
    if (!btn) return;
    var n = 0;
    if (window.__ultimaListaNfSaida && Array.isArray(window.__ultimaListaNfSaida)) {
      n = coletarPendenciasEnderecoDasLinhasNf(window.__ultimaListaNfSaida).length;
    }
    if (n > 0) {
      btn.style.display = 'inline-flex';
      btn.innerHTML = '<i class="bx bx-map-pin"></i> Cadastros pendentes (' + n + ')';
    } else {
      btn.style.display = 'none';
    }
  }

  function abrirPainelPendenciasEnderecoAtual() {
    showLoading('Pendências', 'Buscando NF com cadastro incompleto…', '');
    return fetch('/api/wms/cargas/nfes-saida' + buildNfQueryString(), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (rows) {
        window.__ultimaListaNfSaida = Array.isArray(rows) ? rows : [];
        atualizarBtnPendenciasEndereco();
        var itens = coletarPendenciasEnderecoDasLinhasNf(window.__ultimaListaNfSaida);
        if (!itens.length) {
          limparFilaPendenciasEndereco();
          showMessage('Nenhuma NF com cadastro de entrega pendente.', 'success');
          return;
        }
        var fila = lerFilaPendenciasEndereco();
        salvarFilaPendenciasEndereco(itens, fila && fila.resumoImport);
        abrirModalPendenciasEnderecoImportacao(itens, fila && fila.resumoImport);
        var chk = document.getElementById('filtroNfCadPendente');
        if (chk) chk.checked = true;
        renderListaNf(window.__ultimaListaNfSaida);
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao buscar pendências.', 'error');
      })
      .finally(hideLoading);
  }

  window.__aplicarAbrirNfEnderecoPendentes = function () {
    abrirPainelPendenciasEnderecoAtual();
  };

  function coletarItensPendenciaEndereco(resp) {
    var lista = [];
    if (resp && resp.totalArquivos != null && Array.isArray(resp.sucessos)) lista = resp.sucessos;
    else if (resp && resp.enderecoEntrega) lista = [resp];
    var itens = [];
    lista.forEach(function (item) {
      var ee = item.enderecoEntrega;
      if (!ee) return;
      var precisa =
        ee.status === 'RASCUNHO_CRIADO' ||
        ee.status === 'RASCUNHO_EXISTENTE' ||
        ee.status === 'AMBIGUO' ||
        ee.status === 'SEM_CLIENTE_MATRIZ' ||
        ee.status === 'ERRO' ||
        (ee.pendencias && ee.pendencias.length);
      if (!precisa) return;
      var nf = item.NUMERO_NF != null ? String(item.NUMERO_NF) : item.arquivo || '—';
      var serie = item.SERIE != null ? String(item.SERIE) : '';
      itens.push({
        nf: nf,
        serie: serie,
        status: ee.status,
        rotulo: rotuloStatusEnderecoEntrega(ee),
        pendenciasTxt: rotuloPendenciasEndereco(ee.pendencias),
        detalhe: ee.mensagem || '',
        link: ee.linkCompletar || null,
        destino: ee.dsPontoEntrega || '',
      });
    });
    return itens;
  }

  function fecharModalPendenciasEnderecoImportacao() {
    var modal = document.getElementById('nfEnderecoPendenteModal');
    if (modal) modal.style.display = 'none';
  }

  function renderTabelaPendenciasEnderecoImportacao(itens) {
    var host = document.getElementById('nfEePendenteLista');
    if (!host) return;
    if (!itens.length) {
      host.innerHTML = '<p class="empty" style="padding:12px;">Nenhuma pendência.</p>';
      return;
    }
    var html =
      '<table class="wms-sep-table"><thead><tr><th>NF</th><th>Situação</th><th>Falta</th><th style="width:140px">Ação</th></tr></thead><tbody>';
    itens.forEach(function (it, idx) {
      var nfLbl = it.serie ? it.nf + ' / ' + it.serie : it.nf;
      var link = it.link;
      var btn =
        link && link.cdCadastro != null
          ? '<button type="button" class="btn-filtro btn-filtro-aplicar btn-nf-ee-completar-item" data-idx="' +
            idx +
            '" style="padding:8px 12px;font-size:13px;"><i class="bx bx-edit"></i> Completar</button>'
          : '<span style="color:#94a3b8;font-size:12px;">Cadastro manual</span>';
      html +=
        '<tr><td><strong>' +
        escapeHtml(nfLbl) +
        '</strong></td><td>' +
        escapeHtml(it.rotulo) +
        '</td><td>' +
        escapeHtml(it.pendenciasTxt) +
        '</td><td>' +
        btn +
        '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
    host.querySelectorAll('.btn-nf-ee-completar-item').forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = parseInt(b.getAttribute('data-idx'), 10);
        var row = nfEePendentesUltimaImportacao[idx];
        if (row && row.link) {
          abrirCadastroEnderecoEntrega(row.link, { indice: idx, nf: row.nf, serie: row.serie });
        }
      });
    });
  }

  function abrirModalPendenciasEnderecoImportacao(itens, resumoImport) {
    nfEePendentesUltimaImportacao = itens || [];
    var modal = document.getElementById('nfEnderecoPendenteModal');
    var resumoEl = document.getElementById('nfEePendenteResumo');
    var btnPrimeiro = document.getElementById('btnNfEeCompletarPrimeiro');
    if (!modal) return;
    var n = nfEePendentesUltimaImportacao.length;
    var imp =
      resumoImport && resumoImport.importados != null
        ? 'Importação: ' + resumoImport.importados + ' de ' + resumoImport.totalArquivos + ' XML(s).'
        : '';
    if (resumoEl) {
      resumoEl.innerHTML =
        escapeHtml(imp) +
        (imp ? ' ' : '') +
        '<strong>' +
        n +
        '</strong> nota(s) com ponto incompleto. Clique <strong>Completar</strong>, preencha rota e coordenadas, salve e use <strong>Próximo da fila</strong> no Cadastro Geral — ou volte aqui em <strong>Cadastros pendentes</strong> (sem reimportar).';
    }
    if (btnPrimeiro) {
      var temLink = nfEePendentesUltimaImportacao.some(function (x) {
        return x.link && x.link.cdCadastro != null;
      });
      btnPrimeiro.style.display = temLink ? 'inline-flex' : 'none';
    }
    renderTabelaPendenciasEnderecoImportacao(nfEePendentesUltimaImportacao);
    salvarFilaPendenciasEndereco(nfEePendentesUltimaImportacao, resumoImport);
    modal.style.display = 'flex';
  }

  function processarAvisosEnderecoImportacao(resp) {
    return coletarItensPendenciaEndereco(resp).map(function (it) {
      return 'NF ' + it.nf + ': cadastro de entrega incompleto.';
    });
  }

  /** Unidades de negócio (CADASTROGERAL) para embarque estável na rota WMS. */
  function carregarUnidadesEmbarqueWms() {
    var sel = document.getElementById('wmsRotaUnidadeEmbarque');
    if (!sel) return Promise.resolve();
    return fetch('/api/wms/cargas/programadas/unidades-embarque', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (j) {
        var un = (j && j.unidades) || [];
        var prev = sel.value;
        sel.innerHTML =
          '<option value="">' + escapeHtml('— Informar coordenadas manualmente —') + '</option>';
        un.forEach(function (u) {
          var id = String(u.CDCADASTRO != null ? u.CDCADASTRO : u.cdcadastro != null ? u.cdcadastro : '');
          if (!id) return;
          var lat = u.LATITUDE != null ? u.LATITUDE : u.latitude;
          var lon = u.LONGITUDE != null ? u.LONGITUDE : u.longitude;
          var nm =
            (u.NMFANTASIA && String(u.NMFANTASIA).trim()) ||
            (u.RZSOCIAL && String(u.RZSOCIAL).trim()) ||
            'UN #' + id;
          var opt = document.createElement('option');
          opt.value = id;
          opt.textContent = nm;
          if (lat != null) opt.setAttribute('data-lat', String(lat));
          if (lon != null) opt.setAttribute('data-lon', String(lon));
          opt.setAttribute('data-label', nm);
          sel.appendChild(opt);
        });
        if (prev) {
          sel.value = prev;
          if (sel.value !== prev) sel.value = '';
        }
      })
      .catch(function () {});
  }

  /** Mesma regra do backend: lat, lon com vírgula; faixas válidas. */
  function parseOrigemCoordManual(str) {
    var t = String(str || '').trim();
    if (!t) return { erro: 'Informe latitude e longitude ou selecione uma unidade de negócio.' };
    var parts = t.split(',').map(function (x) {
      return x.trim();
    }).filter(Boolean);
    if (parts.length < 2) return { erro: 'Use o formato: latitude, longitude (separadas por vírgula).' };
    var lat = Number(parts[0]);
    var lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return { erro: 'Latitude e longitude precisam ser números válidos.' };
    if (lat < -90 || lat > 90) return { erro: 'Latitude deve ficar entre -90 e 90.' };
    if (lon < -180 || lon > 180) return { erro: 'Longitude deve ficar entre -180 e 180.' };
    return { erro: null };
  }

  /** ID da viagem na última lista carregada (coluna WMS), se a carga já tiver viagem não cancelada no servidor. */
  function idViagemListaCargaAtual(cd) {
    if (!cd) return null;
    for (var i = 0; i < ultimaListaCargas.length; i++) {
      if (Number(ultimaListaCargas[i].CD_CARGA) !== Number(cd)) continue;
      var iv =
        ultimaListaCargas[i].WMS_IDVIAGEM_ROTA != null && String(ultimaListaCargas[i].WMS_IDVIAGEM_ROTA).trim() !== ''
          ? ultimaListaCargas[i].WMS_IDVIAGEM_ROTA
          : ultimaListaCargas[i].wms_idviagem_rota;
      if (iv != null && String(iv).trim() !== '' && Number(iv) > 0) return String(iv);
      return null;
    }
    return null;
  }

  function donosDistintosDasNfes(nfs) {
    var map = {};
    (nfs || []).forEach(function (n) {
      var cd = n.CD_DONO != null ? n.CD_DONO : n.cd_dono;
      cd = Number(cd);
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
  function preencherSelectsDonoRomCargas() {
    var lista = donosCargaDetalhe.length ? donosCargaDetalhe : donosDistintosDasNfes(nfesDetalheCache);
    ['crRomCdDono', 'rsRomCdDono'].forEach(function (sid) {
      var sel = document.getElementById(sid);
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = '<option value="">Todos os donos</option>';
      lista.forEach(function (d) {
        var cd = d.CD_DONO != null ? d.CD_DONO : d.cd_dono;
        cd = Number(cd);
        if (!Number.isFinite(cd)) return;
        var nm = d.NM_DONO != null ? d.NM_DONO : d.nm_dono;
        nm = nm != null && String(nm).trim() ? String(nm) : 'Dono #' + cd;
        sel.innerHTML +=
          '<option value="' + escapeHtml(cd) + '">' + escapeHtml(nm) + '</option>';
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
    popularFiltrosGeoRomCargas('crRom');
    popularFiltrosGeoRomCargas('rsRom');
    popularFiltroCodigoRomCargas('crRom');
    popularFiltroCodigoRomCargas('rsRom');
  }

  /** Cache destinos do romaneio: { value, label, unidades }. */
  var romDestinosCacheCargas = [];

  function chaveUnidadeNfRow(row) {
    var cid = normChaveDestinoTextoJs(row.XMUN_DEST);
    var uf = String(row.UF_DEST || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    if (!cid && !uf) return '';
    return cid + '|' + uf;
  }

  /** Rótulo do combo destino (nome da entrega, sem repetir cidade/UF). */
  function labelDestinoRomCombo(row) {
    var nome = nomeEntregaUnidadeOuLocalDestinoNfe(row);
    if (nome) return nome;
    return buildDestinoLinha(row);
  }

  function montarRomDestinosCacheCargas() {
    var destMap = {};
    var destUnidades = {};
    (nfesDetalheCache || []).forEach(function (row) {
      var ch = chaveDestinoNfRow(row);
      if (!ch) return;
      var uk = chaveUnidadeNfRow(row);
      if (!destMap[ch]) {
        destMap[ch] = labelDestinoRomCombo(row);
        destUnidades[ch] = {};
      }
      if (uk) destUnidades[ch][uk] = true;
    });
    romDestinosCacheCargas = Object.keys(destMap)
      .sort(function (a, b) {
        return String(destMap[a]).localeCompare(String(destMap[b]), 'pt-BR');
      })
      .map(function (c) {
        return { value: c, label: destMap[c], unidades: destUnidades[c] || {} };
      });
  }

  function popularFiltrosGeoRomCargas(prefix) {
    var selU = document.getElementById(prefix + 'Unidade');
    var selD = document.getElementById(prefix + 'Destino');
    if (!selU || !selD) return;
    montarRomDestinosCacheCargas();
    var prevU = selU.value || '';
    var prevD = selD.value || '';
    var unidMap = {};
    (nfesDetalheCache || []).forEach(function (row) {
      var k = chaveUnidadeNfRow(row);
      if (!k || unidMap[k]) return;
      var cid = String(row.XMUN_DEST || '').trim();
      var uf = String(row.UF_DEST || '').trim();
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
    aplicarFiltroDestinoRomCargas(prefix, prevD);
    var contU = document.getElementById(prefix + 'UnidContador');
    if (contU) {
      contU.textContent = unidKeys.length ? '(' + unidKeys.length + ' na carga)' : '';
    }
  }

  function aplicarFiltroDestinoRomCargas(prefix, preservarDestino) {
    var selU = document.getElementById(prefix + 'Unidade');
    var selD = document.getElementById(prefix + 'Destino');
    if (!selD) return;
    var unidSel = selU && selU.value ? selU.value : '';
    var prev = preservarDestino != null ? preservarDestino : selD.value || '';
    var visiveis = romDestinosCacheCargas.filter(function (d) {
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
    var contD = document.getElementById(prefix + 'DestContador');
    if (contD) {
      contD.textContent =
        unidSel && visiveis.length !== romDestinosCacheCargas.length
          ? '(' + visiveis.length + ' de ' + romDestinosCacheCargas.length + ')'
          : romDestinosCacheCargas.length
            ? '(' + romDestinosCacheCargas.length + ' na carga)'
            : '';
    }
  }

  function legendaComboRom(id, vazio) {
    var sel = document.getElementById(id);
    if (!sel || !sel.value) return vazio || '';
    var opt = sel.options[sel.selectedIndex];
    var t = opt ? String(opt.textContent || '').trim() : '';
    if (!t || t.length <= 42) return t;
    return t.slice(0, 40) + '…';
  }

  function appendFiltrosGeoRomQuery(q, prefix) {
    var selU = document.getElementById(prefix + 'Unidade');
    var selD = document.getElementById(prefix + 'Destino');
    var selC = document.getElementById(prefix + 'Codigo');
    if (selU && selU.value) q.set('unidades', selU.value);
    if (selD && selD.value) q.set('destinos', selD.value);
    if (selC && selC.value) q.set('codigos', selC.value);
  }

  function parseLinhasJsonCargas(raw) {
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
  function mascaraCodigoOlCargas(cod) {
    var d = String(cod || '').replace(/\D/g, '');
    if (d.length !== 10) return String(cod || '').trim();
    return d[0] + '.' + d.slice(1, 3) + '.' + d.slice(3, 5) + '.' + d.slice(5, 8) + '.' + d.slice(8);
  }

  /** Produtos da carga (código + descrição) para o combo de filtro do romaneio. */
  function popularFiltroCodigoRomCargas(prefix) {
    var sel = document.getElementById(prefix + 'Codigo');
    if (!sel) return;
    var prev = sel.value || '';
    var map = {};
    (nfesDetalheCache || []).forEach(function (row) {
      parseLinhasJsonCargas(row && row.LINHAS_JSON).forEach(function (ln) {
        var cod = String((ln && (ln.cProd || ln.codigo)) || '').trim();
        var dig = cod.replace(/\D/g, '');
        if (!dig || map[dig]) return;
        map[dig] = {
          codigo: mascaraCodigoOlCargas(cod) || cod,
          descricao: String((ln && (ln.xProd || ln.descricao)) || '').trim(),
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
    var cont = document.getElementById(prefix + 'CodContador');
    if (cont) cont.textContent = keys.length ? '(' + keys.length + ' na carga)' : '';
  }

  function legendaDonoRomSelect(id) {
    var sel = document.getElementById(id);
    if (!sel || !sel.value) return 'Todos os donos';
    var opt = sel.options[sel.selectedIndex];
    return opt ? String(opt.textContent || '').trim() : 'Dono #' + sel.value;
  }

  /**
   * Destino da NF-e (lista, detalhe, modal): nome de entrega/unidade → destinatário → endereço → município/UF,
   * com sufixo “ — cidade/UF” quando distinto do texto principal.
   */
  function formatLocalEntregaNfeRow(row) {
    if (!row) return '—';
    var nome = nomeEntregaUnidadeOuLocalDestinoNfe(row);
    var loc = cidadeUfEntregaNfe(row);
    var city = [loc.cidade, loc.uf]
      .filter(function (x) {
        return x != null && String(x).trim() !== '';
      })
      .join(' / ');
    if (!nome && !city) return '—';
    if (!nome) return city;
    if (!city) return nome;
    if (nome === city) return nome;
    return nome + ' — ' + city;
  }

  function formatDh(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('pt-BR');
  }

  function formatDoc(doc) {
    var d = String(doc || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return doc || '—';
  }

  function formatCep(cep) {
    var c = String(cep || '').replace(/\D/g, '');
    if (c.length !== 8) return cep || '';
    return c.replace(/(\d{5})(\d{3})/, '$1-$2');
  }

  function formatCodigoProduto(v) {
    var raw = String(v || '').trim();
    if (!raw) return '—';
    if (raw.indexOf('.') >= 0 || raw.indexOf('-') >= 0) return raw;
    var d = raw.replace(/\D/g, '');
    if (d.length < 6) return raw;
    return d.replace(/(..?)/g, '$1.').replace(/\.$/, '');
  }

  function formatQuantidade(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return v != null ? String(v) : '—';
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  /** Lista de NF na carga: mesmo texto que "Local de entrega" no detalhe (nome + município/UF). */
  function buildDestinoLinha(row) {
    return formatLocalEntregaNfeRow(row);
  }

  function normChaveDestinoTextoJs(s) {
    return String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /** Chave de agrupamento (igual ao resumo logístico / API transferir-destino / filtro romaneio). */
  function chaveDestinoNfRow(row) {
    if (!row) return '';
    var uf = String(row.UF_DEST || '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    var mun = normChaveDestinoTextoJs(row.XMUN_DEST);
    var nome = normChaveDestinoTextoJs(nomeEntregaUnidadeOuLocalDestinoNfe(row));
    var cnpj = String(row.CNPJ_ENTREGA || row.CNPJ_DEST || '').replace(/\D/g, '');
    return uf + '|' + mun + '|' + cnpj + '|' + nome;
  }

  function labelDestinoPorChave(chave) {
    if (!chave) return 'Todos os destinos';
    var nfs = nfesDetalheCache || [];
    for (var i = 0; i < nfs.length; i++) {
      if (chaveDestinoNfRow(nfs[i]) === chave) return buildDestinoLinha(nfs[i]);
    }
    return chave;
  }

  function preencherSelectFiltroDestino() {
    var sel = document.getElementById('filtroDetalheDestino');
    if (!sel) return;
    var prev = cargaDetalheFiltroDestino || sel.value || '';
    var map = new Map();
    (nfesDetalheCache || []).forEach(function (row) {
      var ch = chaveDestinoNfRow(row);
      if (!ch || map.has(ch)) return;
      map.set(ch, buildDestinoLinha(row));
    });
    var keys = Array.from(map.keys()).sort(function (a, b) {
      return String(map.get(a)).localeCompare(String(map.get(b)), 'pt-BR');
    });
    sel.innerHTML = '<option value="">Todos os destinos</option>';
    keys.forEach(function (ch) {
      var lab = map.get(ch);
      sel.innerHTML +=
        '<option value="' + escapeHtml(ch) + '">' + escapeHtml(lab) + '</option>';
    });
    var ok = false;
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === prev) {
        ok = true;
        break;
      }
    }
    sel.value = ok ? prev : '';
    cargaDetalheFiltroDestino = sel.value || '';
    atualizarUiFiltroDestinoNf();
  }

  function atualizarUiFiltroDestinoNf() {
    var btnTr = document.getElementById('btnTransferirDestinoNf');
    var resumo = document.getElementById('cargaNfFiltroResumo');
    var ch = cargaDetalheFiltroDestino;
    var nfs = nfesDetalheCache || [];
    var filtradas = ch
      ? nfs.filter(function (r) {
          return chaveDestinoNfRow(r) === ch;
        })
      : nfs;
    if (btnTr) {
      var showTr =
        !!ch && filtradas.length > 0 && !cargaDetalheProgramacaoBloqueada;
      btnTr.style.display = showTr ? '' : 'none';
    }
    if (resumo) {
      if (!ch || !nfs.length) {
        resumo.style.display = 'none';
        resumo.textContent = '';
      } else {
        resumo.style.display = 'block';
        resumo.textContent =
          'Filtro ativo: ' +
          labelDestinoPorChave(ch) +
          ' — ' +
          filtradas.length +
          ' NF-e de ' +
          nfs.length +
          ' na carga.';
      }
    }
  }

  function nfesDetalhePorChaveDestino(chave) {
    return (nfesDetalheCache || [])
      .filter(function (r) {
        return chaveDestinoNfRow(r) === chave;
      })
      .sort(function (a, b) {
        return Number(a.ORDEM) - Number(b.ORDEM);
      });
  }

  function destinoResumoEstaExpandido(chave) {
    return !!cargaResumoDestinosExpandidos[chave];
  }

  function grupoNfEstaExpandido(gk) {
    return !!cargaNfGruposExpandidos[gk];
  }

  function htmlPanelNfesDestinoResumo(chave) {
    var rows = nfesDetalhePorChaveDestino(chave);
    if (!rows.length) {
      return '<p class="hint" style="margin:8px 0 0;">Lista de NF carregada abaixo após abrir o detalhe.</p>';
    }
    return (
      '<ul class="wms-dest-acc-nf-list">' +
      rows
        .map(function (row) {
          return (
            '<li><span class="wms-dest-acc-nf-num">' +
            escapeHtml((row.NUMERO_NF || '—') + ' / ' + (row.SERIE || '—')) +
            '</span> <span class="hint">ord. ' +
            escapeHtml(row.ORDEM) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function bindAcordeaoResumoDestinos(host) {
    if (!host) return;
    host.querySelectorAll('.wms-dest-acc-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        if (ev.target.closest('.btn-dest-resumo-filtrar')) return;
        var ch = btn.getAttribute('data-chave') || '';
        var exp = !destinoResumoEstaExpandido(ch);
        if (exp) cargaResumoDestinosExpandidos[ch] = true;
        else delete cargaResumoDestinosExpandidos[ch];
        var item = btn.closest('.wms-dest-acc-item');
        var panel = item && item.querySelector('.wms-dest-acc-panel');
        var icon = btn.querySelector('.wms-dest-acc-chevron');
        btn.setAttribute('aria-expanded', exp ? 'true' : 'false');
        if (panel) panel.hidden = !exp;
        if (icon) {
          icon.classList.remove('bx-chevron-right', 'bx-chevron-down');
          icon.classList.add(exp ? 'bx-chevron-down' : 'bx-chevron-right');
        }
      });
    });
    host.querySelectorAll('.btn-dest-resumo-filtrar').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        aplicarFiltroDestinoPorChave(b.getAttribute('data-chave') || '');
        var box = document.getElementById('cargaNfProgramacaoBox');
        if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function setTodosResumoDestinosExpandidos(expandido, chaves) {
    cargaResumoDestinosExpandidos = {};
    if (expandido && chaves && chaves.length) {
      chaves.forEach(function (ch) {
        if (ch) cargaResumoDestinosExpandidos[ch] = true;
      });
    }
    var host = document.getElementById('cargaResumoLogisticoDestinos');
    if (!host) return;
    host.querySelectorAll('.wms-dest-acc-item').forEach(function (item) {
      var ch = item.getAttribute('data-chave') || '';
      var exp = !!cargaResumoDestinosExpandidos[ch];
      var btn = item.querySelector('.wms-dest-acc-toggle');
      var panel = item.querySelector('.wms-dest-acc-panel');
      var icon = btn && btn.querySelector('.wms-dest-acc-chevron');
      if (btn) btn.setAttribute('aria-expanded', exp ? 'true' : 'false');
      if (panel) panel.hidden = !exp;
      if (icon) {
        icon.classList.remove('bx-chevron-right', 'bx-chevron-down');
        icon.classList.add(exp ? 'bx-chevron-down' : 'bx-chevron-right');
      }
    });
  }

  function toggleGrupoNfDetalhe(gk) {
    if (cargaNfGruposExpandidos[gk]) delete cargaNfGruposExpandidos[gk];
    else cargaNfGruposExpandidos[gk] = true;
    var host = document.getElementById('listaCargaNfes');
    if (!host) return;
    var exp = grupoNfEstaExpandido(gk);
    host.querySelectorAll('tr.wms-nf-grupo-linha[data-grupo="' + gk + '"]').forEach(function (tr) {
      tr.style.display = exp ? '' : 'none';
    });
    host.querySelectorAll('tr.wms-nf-grupo-header[data-grupo="' + gk + '"]').forEach(function (tr) {
      tr.classList.toggle('is-expanded', exp);
      var icon = tr.querySelector('.wms-grupo-chevron');
      if (icon) {
        icon.classList.remove('bx-chevron-right', 'bx-chevron-down');
        icon.classList.add(exp ? 'bx-chevron-down' : 'bx-chevron-right');
      }
    });
  }

  function renderListaCargaNfes() {
    var host = document.getElementById('listaCargaNfes');
    if (!host) return;
    var nfs = (nfesDetalheCache || []).slice();
    var chFiltro = cargaDetalheFiltroDestino;
    if (chFiltro) {
      nfs = nfs.filter(function (r) {
        return chaveDestinoNfRow(r) === chFiltro;
      });
    }
    if (!nfs.length) {
      host.innerHTML = chFiltro
        ? '<p class="empty" style="padding:16px;">Nenhuma NF para este destino.</p>'
        : '<p class="empty" style="padding:16px;">Nenhuma NF vinculada. Adicione abaixo.</p>';
      atualizarUiFiltroDestinoNf();
      return;
    }
    var modo = cargaDetalheModoListaNf === 'grupo' ? 'grupo' : 'plana';
    var html = '';
    if (modo === 'plana') {
      html =
        '<table class="wms-sep-table"><thead><tr><th>Ordem</th><th>Nº / Série</th><th>Destino</th><th></th></tr></thead><tbody>';
      nfs.forEach(function (row) {
        html += linhaNfTabelaCarga(row);
      });
      html += '</tbody></table>';
    } else {
      var grupos = new Map();
      nfs.forEach(function (row) {
        var gk = chaveDestinoNfRow(row);
        if (!grupos.has(gk)) grupos.set(gk, { label: buildDestinoLinha(row), rows: [] });
        grupos.get(gk).rows.push(row);
      });
      var gkeys = Array.from(grupos.keys()).sort(function (a, b) {
        return String(grupos.get(a).label).localeCompare(String(grupos.get(b).label), 'pt-BR');
      });
      html =
        '<table class="wms-sep-table"><thead><tr><th>Ordem</th><th>Nº / Série</th><th>Destino</th><th></th></tr></thead><tbody>';
      gkeys.forEach(function (gk) {
        var g = grupos.get(gk);
        var gExp = grupoNfEstaExpandido(gk);
        html +=
          '<tr class="wms-nf-grupo-header' +
          (gExp ? ' is-expanded' : '') +
          '" data-grupo="' +
          escapeHtml(gk) +
          '" role="button" tabindex="0" title="Clique para expandir ou recolher as NF deste ponto">' +
          '<td colspan="4">' +
          '<i class="bx ' +
          (gExp ? 'bx-chevron-down' : 'bx-chevron-right') +
          ' wms-grupo-chevron" aria-hidden="true"></i> ' +
          '<strong>' +
          escapeHtml(g.label) +
          '</strong> <span class="hint">(' +
          escapeHtml(g.rows.length) +
          ' NF)</span>' +
          (cargaDetalheProgramacaoBloqueada
            ? ''
            : ' <button type="button" class="btn-filtro btn-filtro-limpar btn-filtrar-grupo-dest" data-chave="' +
              escapeHtml(gk) +
              '" style="margin-left:8px;padding:2px 8px;font-size:12px;"><i class="bx bx-filter-alt"></i> Filtrar</button>') +
          '</td></tr>';
        g.rows
          .sort(function (a, b) {
            return Number(a.ORDEM) - Number(b.ORDEM);
          })
          .forEach(function (row) {
            html += linhaNfTabelaCarga(
              row,
              ' class="wms-nf-grupo-linha" data-grupo="' +
                escapeHtml(gk) +
                '"' +
                (gExp ? '' : ' style="display:none"')
            );
          });
      });
      html += '</tbody></table>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.btn-rem-nfe').forEach(function (b) {
      b.addEventListener('click', function () {
        var idNfe = parseInt(b.getAttribute('data-nfe'), 10);
        if (!Number.isFinite(idNfe)) return;
        abrirModalRemoverNf(idNfe);
      });
    });
    host.querySelectorAll('.btn-filtrar-grupo-dest').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        aplicarFiltroDestinoPorChave(b.getAttribute('data-chave') || '');
      });
    });
    host.querySelectorAll('tr.wms-nf-grupo-header').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('button')) return;
        toggleGrupoNfDetalhe(tr.getAttribute('data-grupo') || '');
      });
      tr.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (ev.target.closest('button')) return;
        toggleGrupoNfDetalhe(tr.getAttribute('data-grupo') || '');
      });
    });
    atualizarUiFiltroDestinoNf();
  }

  function celulasNfTabelaCarga(row) {
    return (
      '<td>' +
      escapeHtml(row.ORDEM) +
      '</td><td>' +
      escapeHtml((row.NUMERO_NF || '—') + ' / ' + (row.SERIE || '—')) +
      '</td><td>' +
      escapeHtml(formatLocalEntregaNfeRow(row)) +
      '</td><td>' +
      (cargaDetalheProgramacaoBloqueada
        ? '<span class="hint" title="Não removível com expedição em andamento ou expedida.">—</span>'
        : '<button type="button" class="btn-filtro btn-filtro-limpar btn-rem-nfe" data-nfe="' +
          escapeHtml(row.CD_NFE_SAIDA) +
          '"><i class="bx bx-unlink"></i> Remover</button>') +
      '</td>'
    );
  }

  function linhaNfTabelaCarga(row, trExtraAttrs) {
    return '<tr' + (trExtraAttrs || '') + '>' + celulasNfTabelaCarga(row) + '</tr>';
  }

  function aplicarFiltroDestinoPorChave(chave) {
    cargaDetalheFiltroDestino = chave || '';
    var sel = document.getElementById('filtroDetalheDestino');
    if (sel) sel.value = cargaDetalheFiltroDestino;
    renderListaCargaNfes();
  }

  function fecharModalTransferirDestino() {
    var m = document.getElementById('cargaTransferDestModal');
    if (m) m.style.display = 'none';
  }

  function preencherSelectCargasTransferDestino(rowsForcadas) {
    var sel = document.getElementById('cargaTransferDestSelect');
    if (!sel) return;
    var cur = cdCargaDetalhe;
    var fonte = Array.isArray(rowsForcadas) ? rowsForcadas : ultimaListaCargas;
    var lista = (fonte || []).filter(function (c) {
      var id = Number(c.CD_CARGA);
      if (!Number.isFinite(id) || id === cur) return false;
      var st = String(c.ST_CARGA_PROGRAMADA || c.ST_CARGA || '').toUpperCase();
      if (st && st !== 'RASCUNHO') return false;
      var ex = String(c.ST_EXPEDICAO || '').toUpperCase();
      if (ex === 'EM_EXPEDICAO' || ex === 'EXPEDIDA') return false;
      return true;
    });
    sel.innerHTML = '<option value="">— Selecione —</option>';
    lista.forEach(function (c) {
      var id = c.CD_CARGA;
      var desc = c.NM_DESCRICAO || '(sem descrição)';
      sel.innerHTML +=
        '<option value="' +
        escapeHtml(id) +
        '">#' +
        escapeHtml(id) +
        ' — ' +
        escapeHtml(desc) +
        '</option>';
    });
  }

  /** Busca lista fresca de cargas elegíveis para receber NFs (RASCUNHO, sem expedição em curso). */
  function buscarCargasParaTransferDestino() {
    var p = new URLSearchParams();
    p.set('stCarga', 'RASCUNHO');
    p.set('page', '1');
    p.set('pageSize', '500');
    return fetch('/api/wms/cargas/programadas?' + p.toString(), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (j) {
        var rows = j && Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [];
        return rows;
      });
  }

  function abrirModalTransferirDestino() {
    if (!cdCargaDetalhe || !cargaDetalheFiltroDestino) {
      showMessage('Selecione um destino no filtro antes de transferir.', 'warning');
      return;
    }
    if (cargaDetalheProgramacaoBloqueada) {
      showMessage('Programação bloqueada: expedição em andamento ou expedida.', 'warning');
      return;
    }
    var nfs = (nfesDetalheCache || []).filter(function (r) {
      return chaveDestinoNfRow(r) === cargaDetalheFiltroDestino;
    });
    if (!nfs.length) {
      showMessage('Nenhuma NF para este destino.', 'warning');
      return;
    }
    cargaTransferDestinoState = {
      chave: cargaDetalheFiltroDestino,
      label: labelDestinoPorChave(cargaDetalheFiltroDestino),
      qtdNf: nfs.length,
    };
    var resumo = document.getElementById('cargaTransferDestResumo');
    if (resumo) {
      resumo.innerHTML =
        'Saindo da carga <strong>#' +
        escapeHtml(cdCargaDetalhe) +
        '</strong><br />' +
        escapeHtml(cargaTransferDestinoState.label) +
        '<br /><strong>' +
        escapeHtml(cargaTransferDestinoState.qtdNf) +
        ' NF-e</strong> serão movidas.';
    }
    var manual = document.getElementById('cargaTransferDestIdManual');
    if (manual) manual.value = '';
    var sel = document.getElementById('cargaTransferDestSelect');
    if (sel) {
      sel.innerHTML = '<option value="">Carregando cargas…</option>';
      sel.disabled = true;
    }
    var m = document.getElementById('cargaTransferDestModal');
    if (m) m.style.display = 'flex';
    /** Refresca lista de cargas em rascunho a cada abertura (cache da tela pode estar
     *  defasado se o usuário criou cargas em outra aba ou há instantes). */
    buscarCargasParaTransferDestino()
      .then(function (rows) {
        preencherSelectCargasTransferDestino(rows);
      })
      .catch(function () {
        preencherSelectCargasTransferDestino();
      })
      .finally(function () {
        if (sel) sel.disabled = false;
      });
  }

  function confirmarTransferirDestino() {
    if (!cdCargaDetalhe || !cargaTransferDestinoState.chave) return;
    var sel = document.getElementById('cargaTransferDestSelect');
    var manual = document.getElementById('cargaTransferDestIdManual');
    var cdDest = sel && sel.value ? parseInt(sel.value, 10) : NaN;
    if (!Number.isFinite(cdDest) || cdDest <= 0) {
      cdDest = manual && manual.value ? parseInt(manual.value, 10) : NaN;
    }
    if (!Number.isFinite(cdDest) || cdDest <= 0) {
      showMessage('Informe a carga destino.', 'warning');
      return;
    }
    if (cdDest === cdCargaDetalhe) {
      showMessage('Escolha outra carga.', 'warning');
      return;
    }
    var msgConfirm =
      'Transferir ' +
      cargaTransferDestinoState.qtdNf +
      ' NF-e para a carga #' +
      cdDest +
      '? — ' +
      cargaTransferDestinoState.label;
    var promConfirm =
      typeof window.confirmPadrao === 'function'
        ? window.confirmPadrao(msgConfirm, {
            title: 'Transferir destino',
            confirmText: 'Transferir',
            cancelText: 'Cancelar',
          })
        : Promise.resolve(window.confirm(msgConfirm));
    promConfirm.then(function (ok) {
      if (!ok) return;
      showLoading('Transferindo', 'Movendo NF-e…', '');
      fetch(
        '/api/wms/cargas/programadas/' +
          encodeURIComponent(String(cdCargaDetalhe)) +
          '/transferir-destino',
        {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
          body: JSON.stringify({
            cdCargaDestino: cdDest,
            chaveDestino: cargaTransferDestinoState.chave,
          }),
        }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (j) {
          fecharModalTransferirDestino();
          showMessage(
            (j.qtdNfesMovidas || 0) + ' NF-e transferida(s) para a carga #' + cdDest + '.',
            'success'
          );
          cargaDetalheFiltroDestino = '';
          return abrirDetalheCarga(cdCargaDetalhe);
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao transferir.', 'error');
        })
        .finally(hideLoading);
    });
  }

  function buildEnderecoEntrega(row) {
    var log = [row.XLGR_DEST || '', row.NRO_DEST || ''].filter(Boolean).join(', ');
    var bairro = row.XBAIRRO_DEST ? ' - ' + row.XBAIRRO_DEST : '';
    var cpl = row.XCPL_DEST ? ' (' + row.XCPL_DEST + ')' : '';
    var munUf = [row.XMUN_DEST || '', row.UF_DEST || ''].filter(Boolean).join(' / ');
    var cep = row.CEP_DEST ? ' CEP ' + formatCep(row.CEP_DEST) : '';
    return [log + bairro + cpl, munUf + cep].filter(Boolean).join(' | ');
  }

  function formatLocal(mun, uf) {
    return [mun || '', uf || ''].filter(Boolean).join('/') || '—';
  }

  function statusDotHtml(emCarga) {
    var on = false;
    if (emCarga === true || emCarga === 1) on = true;
    else {
      var s = String(emCarga == null ? '' : emCarga).trim().toLowerCase();
      on = s === 't' || s === 'true' || s === '1' || s === 's' || s === 'sim';
    }
    return '<span class="status-dot ' + (on ? 'sim' : 'nao') + '" title="' + (on ? 'Em carga' : 'Fora da carga') + '"></span>';
  }

  /** NR_ROTA do cadastro de endereço de entrega (lista NF-e importadas). */
  function fmtRotaNfLista(row) {
    if (!row) return '—';
    if (row.EE_NR_ROTA == null || row.EE_NR_ROTA === '') return '—';
    return String(row.EE_NR_ROTA);
  }

  function fmtNfNumeroSerie(row) {
    return (row.NUMERO_NF || '—') + ' / ' + (row.SERIE || '—');
  }

  function showTab(id) {
    document.querySelectorAll('.wms-carga-container .tab-content').forEach(function (el) {
      el.classList.toggle('active', el.id === 'tab-' + id);
    });
    document.querySelectorAll('.wms-carga-container .tabs .tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === id);
    });
    if (id === 'nf') carregarNfSaida();
  }

  function fillDonoSelects(rows) {
    cacheDonosEstoque = Array.isArray(rows) ? rows : [];
    var imp = document.getElementById('impSaidaCdDono');
    var nova = document.getElementById('novaCargaDono');
    var filtroNf = document.getElementById('filtroNfCdDono');
    var detalhe = document.getElementById('detalheCargaDono');
    var editDono = document.getElementById('cargaEditDono');
    var optVazioRota = '<option value="">— Rota mista / definir pelas NF —</option>';
    function appendOpts(sel, keepValue, emptyHtml) {
      if (!sel) return;
      var v = keepValue != null ? keepValue : sel.value;
      sel.innerHTML = emptyHtml;
      cacheDonosEstoque.forEach(function (r) {
        sel.innerHTML +=
          '<option value="' +
          escapeHtml(r.CD_DONO) +
          '">' +
          escapeHtml(r.NOME || r.CODIGO || r.CD_DONO) +
          '</option>';
      });
      if (v != null && v !== '') sel.value = String(v);
    }
    if (imp) {
      var vImp = imp.value;
      imp.innerHTML = '<option value="">Selecione… (ou inferir pelo emitente)</option>';
      cacheDonosEstoque.forEach(function (r) {
        imp.innerHTML +=
          '<option value="' +
          escapeHtml(r.CD_DONO) +
          '">' +
          escapeHtml(r.NOME || r.CODIGO || r.CD_DONO) +
          '</option>';
      });
      if (vImp) imp.value = vImp;
    }
    appendOpts(nova, null, optVazioRota);
    appendOpts(detalhe, cargaDetalheCdDono != null ? String(cargaDetalheCdDono) : '', optVazioRota);
    appendOpts(editDono, null, optVazioRota);
    if (filtroNf) {
      var vF = filtroNf.value;
      filtroNf.innerHTML = '<option value="">Todos</option>';
      cacheDonosEstoque.forEach(function (r) {
        filtroNf.innerHTML +=
          '<option value="' +
          escapeHtml(r.CD_DONO) +
          '">' +
          escapeHtml(
            (r.CD_DONO != null ? String(r.CD_DONO) + ' — ' : '') + (r.NOME || r.CODIGO || '')
          ) +
          '</option>';
      });
      if (vF) filtroNf.value = vF;
    }
  }

  function carregarDonos() {
    return fetch('/api/wms/donos-estoque?fgactive=S', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(fillDonoSelects)
      .catch(function () {});
  }

  function renderListaNf(rows) {
    var host = document.getElementById('listaNfSaida');
    if (!host) return;
    window.__ultimaListaNfSaida = Array.isArray(rows) ? rows : [];
    atualizarBtnPendenciasEndereco();
    var filtradas = filtrarNfCadastroPendenteClient(rows);
    var chkPend = document.getElementById('filtroNfCadPendente');
    if (!Array.isArray(filtradas) || !filtradas.length) {
      var vazio =
        chkPend && chkPend.checked && Array.isArray(rows) && rows.length
          ? 'Nenhuma NF com cadastro de entrega pendente nos filtros atuais.'
          : 'Nenhuma NF de saída importada.';
      host.innerHTML = '<p class="empty" style="padding:16px;">' + escapeHtml(vazio) + '</p>';
      return;
    }
    rows = filtradas;
    var html =
      '<table class="wms-sep-table"><colgroup><col style="width:11%"><col style="width:9%"><col style="width:6%"><col style="width:10%"><col style="width:28%"><col style="width:10%"><col style="width:10%"><col style="width:4%"><col style="width:12%"></colgroup><thead><tr><th>Chave</th><th>Nº / Série</th><th>Rota</th><th>Carga(s)</th><th>Destino</th><th>Emissão</th><th>Saída</th><th>Itens</th><th>Importação</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var ch = String(row.CHAVE_NFE || '');
      var cargasTxt = row.CARGAS_TXT ? String(row.CARGAS_TXT) : row.EM_CARGA ? 'Sim' : '—';
      var rotaTxt = fmtRotaNfLista(row);
      html +=
        '<tr><td class="col-chave">' +
        htmlCelulaChaveNfe(ch, 'lista') +
        '</td><td><span class="nota-with-dot">' +
        statusDotHtml(row.EM_CARGA) +
        '<button type="button" class="btn-link-nf btn-abrir-nf" data-id="' +
        escapeHtml(row.CD_NFE_SAIDA) +
        '">' +
        escapeHtml(fmtNfNumeroSerie(row)) +
        '</button>' +
        (!row.EM_CARGA
          ? '<button type="button" class="btn-nf-excluir btn-excluir-nf-lista" data-id="' +
            escapeHtml(row.CD_NFE_SAIDA) +
            '" data-label="' +
            escapeHtml(fmtNfNumeroSerie(row)) +
            '" title="Excluir importação"><i class="bx bx-trash"></i></button>'
          : '') +
        '</span></td><td class="col-rota" title="' +
        escapeHtml(rotaTxt === '—' ? 'Rota do cadastro de entrega' : 'Rota ' + rotaTxt) +
        '">' +
        escapeHtml(rotaTxt) +
        '</td><td class="col-cargas" title="' +
        escapeHtml(cargasTxt) +
        '">' +
        escapeHtml(cargasTxt.length > 48 ? cargasTxt.slice(0, 45) + '…' : cargasTxt) +
        '</td><td class="col-destino">' +
        escapeHtml(buildDestinoLinha(row)) +
        badgeCadastroEnderecoNf(row) +
        (function () {
          var lk = linkCompletarEnderecoEntrega(row);
          return enderecoEntregaPrecisaCompletar(row) && lk ? htmlLinkCompletarCadastroNf(lk, 'Completar') : '';
        })() +
        '</td><td class="col-emissao">' +
        escapeHtml(formatDh(row.DH_EMISSAO)) +
        '</td><td class="col-saida">' +
        escapeHtml(row.DH_SAIDA ? formatDh(row.DH_SAIDA) : '—') +
        '</td><td>' +
        escapeHtml(row.Q_ITENS) +
        '</td><td>' +
        escapeHtml(formatDh(row.DH_IMPORTACAO)) +
        '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
    bindCopiarChaveButtons(host);
    host.querySelectorAll('.btn-abrir-nf').forEach(function (b) {
      b.addEventListener('click', function () {
        abrirDetalheNf(parseInt(b.getAttribute('data-id'), 10));
      });
    });
    host.querySelectorAll('.btn-excluir-nf-lista').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        abrirModalExcluirNf(
          parseInt(b.getAttribute('data-id'), 10),
          b.getAttribute('data-label') || ''
        );
      });
    });
    host.querySelectorAll('.btn-nf-completar-cad').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        abrirCadastroEnderecoEntrega({
          cdCadastro: b.getAttribute('data-cd-cadastro'),
          cdEndereco: b.getAttribute('data-cd-endereco') || null,
        });
      });
    });
  }

  function buildNfQueryString() {
    var p = new URLSearchParams();
    var cdDono = (document.getElementById('filtroNfCdDono') || {}).value || '';
    var emCarga = (document.getElementById('filtroNfEmCarga') || {}).value || '';
    var de = (document.getElementById('filtroNfEmissaoDe') || {}).value || '';
    var ate = (document.getElementById('filtroNfEmissaoAte') || {}).value || '';
    var num = (document.getElementById('filtroNfNumero') || {}).value || '';
    var ser = (document.getElementById('filtroNfSerie') || {}).value || '';
    var ped = (document.getElementById('filtroNfPedido') || {}).value || '';
    var cod = (document.getElementById('filtroNfCodigoProd') || {}).value || '';
    var desc = (document.getElementById('filtroNfDescProd') || {}).value || '';
    var saiDe = (document.getElementById('filtroNfSaidaDe') || {}).value || '';
    var saiAte = (document.getElementById('filtroNfSaidaAte') || {}).value || '';
    if (cdDono) p.set('cdDono', cdDono);
    if (emCarga) p.set('emCarga', emCarga);
    if (de) p.set('dhEmissaoDe', de);
    if (ate) p.set('dhEmissaoAte', ate);
    if (num && String(num).trim()) p.set('numeroNf', String(num).trim());
    if (ser && String(ser).trim()) p.set('serie', String(ser).trim());
    if (ped && String(ped).trim()) p.set('pedido', String(ped).trim());
    if (cod && String(cod).trim()) p.set('codigoProduto', String(cod).trim());
    if (desc && String(desc).trim()) p.set('descricaoProduto', String(desc).trim());
    if (saiDe) p.set('dhSaidaDe', saiDe);
    if (saiAte) p.set('dhSaidaAte', saiAte);
    var s = p.toString();
    return s ? '?' + s : '';
  }

  function filtrarNfCadastroPendenteClient(rows) {
    var chk = document.getElementById('filtroNfCadPendente');
    if (!chk || !chk.checked || !Array.isArray(rows)) return rows;
    return rows.filter(enderecoEntregaPrecisaCompletar);
  }

  function carregarNfSaida() {
    showLoading('Carregando', 'Buscando NF-e de saída…', '');
    return fetch('/api/wms/cargas/nfes-saida' + buildNfQueryString(), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(renderListaNf)
      .catch(function (e) {
        showMessage(e.message || 'Erro ao listar NF-e.', 'error');
        var host = document.getElementById('listaNfSaida');
        if (host) host.innerHTML = '<p class="empty" style="padding:16px;">' + escapeHtml(e.message || 'Erro') + '</p>';
      })
      .finally(hideLoading);
  }

  function abrirDetalheNf(cdNfe) {
    if (!Number.isFinite(cdNfe)) return;
    var modal = document.getElementById('nfDetalheModal');
    var host = document.getElementById('nfDetalheConteudo');
    var btnExcluir = document.getElementById('btnExcluirNfDetalhe');
    var btnCopiarChave = document.getElementById('btnCopiarChaveNfDetalhe');
    if (!modal || !host) return;
    nfDetalheCdAtual = cdNfe;
    if (btnExcluir) btnExcluir.style.display = 'none';
    if (btnCopiarChave) {
      btnCopiarChave.style.display = 'none';
      btnCopiarChave.removeAttribute('data-chave');
    }
    modal.style.display = 'flex';
    host.innerHTML = '<p class="empty">Carregando…</p>';
    fetch('/api/wms/cargas/nfes-saida/' + encodeURIComponent(String(cdNfe)), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (row) {
        var linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
        var endCompleto = buildEnderecoEntrega(row);
        var chNfe = normalizeChaveNfe(row.CHAVE_NFE);
        var html =
          '<div class="nf-header-fixed"><div class="nf-head-compact">' +
          '<div class="nf-col">' +
          '<h4>Dados da nota</h4>' +
          '<div class="nf-line"><strong>Número:</strong> ' + escapeHtml(fmtNfNumeroSerie(row)) + '</div>' +
          (chNfe
            ? '<div class="nf-line nf-line-chave"><strong>Chave NF-e:</strong> ' +
              htmlCelulaChaveNfe(chNfe, 'modal') +
              '</div>'
            : '') +
          '<div class="nf-line"><strong>Emissão:</strong> ' + escapeHtml(formatDh(row.DH_EMISSAO)) + '</div>' +
          '<div class="nf-line"><strong>Saída (XML):</strong> ' +
          escapeHtml(row.DH_SAIDA ? formatDh(row.DH_SAIDA) : '—') +
          '</div>' +
          '<div class="nf-line"><strong>Importação:</strong> ' + escapeHtml(formatDh(row.DH_IMPORTACAO)) + '</div>' +
          '</div>' +
          '<div class="nf-col">' +
          '<h4>Emitente</h4>' +
          '<div class="nf-line">' + escapeHtml(row.XNOME_EMIT || '—') + '</div>' +
          '<div class="nf-line"><strong>CNPJ:</strong> ' + escapeHtml(formatDoc(row.CNPJ_EMITENTE)) + '</div>' +
          '<div class="nf-line"><strong>Local:</strong> ' + escapeHtml(formatLocal(row.XMUN_EMIT, row.UF_EMIT)) + '</div>' +
          '</div>' +
          '<div class="nf-col">' +
          '<h4>Destino</h4>' +
          '<div class="nf-line">' + escapeHtml(formatLocalEntregaNfeRow(row)) + '</div>' +
          '<div class="nf-line"><strong>CNPJ entrega / dest.:</strong> ' +
          escapeHtml(formatDoc(row.CNPJ_ENTREGA || row.CNPJ_DEST)) +
          '</div>' +
          (endCompleto && endCompleto !== '—'
            ? '<div class="nf-line"><strong>Endereço (logradouro):</strong> ' + escapeHtml(endCompleto) + '</div>'
            : '') +
          '</div>' +
          '</div></div>';
        if (!linhas.length) {
          html += '<p class="empty">Sem itens disponíveis para esta NF.</p>';
        } else {
          html += '<div class="nf-itens-scroll"><table class="wms-sep-table"><thead><tr><th>Código</th><th>Descrição</th><th>Unid.</th><th>Qtd.</th></tr></thead><tbody>';
          linhas.forEach(function (it) {
            html += '<tr><td>' + escapeHtml(formatCodigoProduto(it.codigo || it.cProd || '—')) + '</td><td>' + escapeHtml(it.descricao || it.xProd || '—') + '</td><td>' + escapeHtml(it.unidade || it.uCom || '—') + '</td><td class="td-right">' + escapeHtml(formatQuantidade(it.quantidade || it.qCom || it.qTrib || '—')) + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        host.innerHTML = html;
        bindCopiarChaveButtons(host);
        if (btnCopiarChave && chNfe) {
          btnCopiarChave.style.display = '';
          btnCopiarChave.setAttribute('data-chave', chNfe);
        }
        if (btnExcluir) {
          if (row.EM_CARGA) {
            btnExcluir.style.display = 'none';
          } else {
            btnExcluir.style.display = '';
            btnExcluir.setAttribute('data-label', fmtNfNumeroSerie(row));
          }
        }
      })
      .catch(function (e) {
        host.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro ao carregar espelho da NF-e.') + '</p>';
      });
  }

  /** Mesclagem só com carga em montagem e sem expedição ativa/expedida. */
  function isCargaRascunho(row) {
    if (!row) return false;
    var stEx = String(row.ST_EXPEDICAO || '').toUpperCase();
    if (stEx === 'EM_EXPEDICAO' || stEx === 'EXPEDIDA') return false;
    var mont = String(
      row.ST_CARGA_PROGRAMADA != null && row.ST_CARGA_PROGRAMADA !== ''
        ? row.ST_CARGA_PROGRAMADA
        : row.ST_CARGA || ''
    ).toUpperCase();
    if (mont !== 'RASCUNHO') return false;
    return true;
  }

  function isExpedicaoBloqueiaProgramacaoSt(st) {
    var s = String(st || '').toUpperCase();
    return s === 'EM_EXPEDICAO' || s === 'EXPEDIDA';
  }

  function stExpedicaoParaRow(row) {
    if (!row) return '';
    var v = row.ST_EXPEDICAO != null && row.ST_EXPEDICAO !== '' ? String(row.ST_EXPEDICAO) : '';
    return v || 'PRONTA_EXPEDICAO';
  }

  /** Alinhado ao backend excluirCarga. Usa ST_EXPEDICAO antes de ST_CARGA (lista pode espelhar situação na coluna ST_CARGA). */
  function motivoCargaNaoExclusivel(row) {
    if (!row) return 'Carga inválida.';
    var stExRaw = row.ST_EXPEDICAO != null && row.ST_EXPEDICAO !== '' ? String(row.ST_EXPEDICAO).toUpperCase() : '';
    if (stExRaw === 'EM_EXPEDICAO' || stExRaw === 'EXPEDIDA') {
      return 'Não é possível excluir com expedição em andamento ou carga já expedida.';
    }
    var qn = row.Q_NFES != null ? Number(row.Q_NFES) : row.q_nfes != null ? Number(row.q_nfes) : 0;
    if (Number.isFinite(qn) && qn > 0) return 'Remova todas as NF-e da carga antes de excluir.';
    var mont = String(
      row.ST_CARGA_PROGRAMADA != null && row.ST_CARGA_PROGRAMADA !== ''
        ? row.ST_CARGA_PROGRAMADA
        : row.ST_CARGA || ''
    ).toUpperCase();
    if (mont !== 'RASCUNHO') return 'Somente carga em rascunho (montagem) pode ser excluída.';
    return '';
  }

  function isCargaExclusivelLista(row) {
    return motivoCargaNaoExclusivel(row) === '';
  }

  function voltarMontagemCargaDetalhe() {
    if (!cdCargaDetalhe) return;
    var st = String(cargaDetalheStExpedicaoRaw || '').toUpperCase();
    if (st !== 'EM_EXPEDICAO') {
      showMessage('Só cargas «Em expedição» (saída ainda não confirmada) podem voltar à montagem.', 'warning');
      return;
    }
    var cd = cdCargaDetalhe;
    var msgConfirm =
      'Devolver a carga #' +
      cd +
      ' para montagem?\n\n' +
      '• Você poderá incluir ou remover NF-e nesta tela\n' +
      '• Depois volte à Expedição e inicie novamente';
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
      showLoading('Aguarde', 'Liberando montagem da carga…', '');
      fetch('/api/wms/expedicao/cargas/' + encodeURIComponent(String(cd)) + '/voltar-montagem', {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({}),
      })
        .then(function (r) {
          return r.json().then(function (body) {
            if (!r.ok) throw new Error((body && body.error) || r.statusText);
            return body;
          });
        })
        .then(function (body) {
          var msg = (body && body.mensagem) || 'Carga liberada para montagem.';
          return abrirDetalheCarga(cd).then(function () {
            showMessage(msg, 'success');
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao devolver carga à montagem.', 'error');
        })
        .finally(hideLoading);
    });
  }

  function atualizarUiBloqueioProgramacaoDetalhe() {
    var ban = document.getElementById('cargaProgramacaoBloqueioBanner');
    if (ban) {
      if (cargaDetalheProgramacaoBloqueada) {
        ban.style.display = 'block';
        var st = String(cargaDetalheStExpedicaoRaw || '').toUpperCase();
        var tit =
          st === 'EXPEDIDA'
            ? 'Carga expedida — programação encerrada.'
            : st === 'EM_EXPEDICAO'
              ? 'Expedição em andamento — programação travada.'
              : 'Programação bloqueada.';
        var sub =
          st === 'EM_EXPEDICAO'
            ? 'Para incluir ou remover NF-e, devolva a carga à montagem (botão abaixo ou na tela Expedição). Impressões continuam disponíveis.'
            : st === 'EXPEDIDA'
              ? 'Use «Reabrir expedição» na tela Expedição se precisar alterar a carga. Impressões continuam disponíveis.'
              : 'Use apenas os botões de impressão (resumo ¹ e ²). Não é possível alterar NF-e, montar paradas, rota, origem nem gerar viagem nesta tela.';
        var btnVoltar =
          st === 'EM_EXPEDICAO'
            ? '<p style="margin:10px 0 0"><button type="button" class="btn-filtro btn-filtro-limpar" id="btnVoltarMontagemCargaDet"><i class="bx bx-edit-alt"></i> Voltar p/ montagem (add NF)</button></p>'
            : '';
        ban.innerHTML =
          '<strong>' + escapeHtml(tit) + '</strong><br /><span class="hint" style="display:block;margin-top:6px;line-height:1.4">' +
          escapeHtml(sub) +
          '</span>' +
          btnVoltar;
        var btnVm = document.getElementById('btnVoltarMontagemCargaDet');
        if (btnVm) btnVm.addEventListener('click', voltarMontagemCargaDetalhe);
      } else {
        ban.style.display = 'none';
        ban.textContent = '';
        ban.innerHTML = '';
      }
    }
    function dis(elId, d) {
      var el = document.getElementById(elId);
      if (!el) return;
      el.disabled = !!d;
      if (d) el.setAttribute('title', 'Bloqueado após início da expedição.');
      else el.removeAttribute('title');
    }
    dis('btnAdicionarNfCarga', cargaDetalheProgramacaoBloqueada);
    dis('btnBiparNfCarga', cargaDetalheProgramacaoBloqueada);
    dis('selNfDisponivel', cargaDetalheProgramacaoBloqueada);
    dis('inputChaveNfCarga', cargaDetalheProgramacaoBloqueada);
    dis('btnWmsPlanejarParadas', cargaDetalheProgramacaoBloqueada);
    dis('btnWmsCalcularRota', cargaDetalheProgramacaoBloqueada);
    dis('btnWmsGerarViagemRascunho', cargaDetalheProgramacaoBloqueada);
    dis('wmsRotaUnidadeEmbarque', cargaDetalheProgramacaoBloqueada);
    dis('wmsRotaOrigemCoord', cargaDetalheProgramacaoBloqueada);
    dis('wmsRotaOrigemLabel', cargaDetalheProgramacaoBloqueada);
    dis('wmsRotaRetornaOrigem', cargaDetalheProgramacaoBloqueada);
    dis('detalheCargaDono', cargaDetalheProgramacaoBloqueada);
    dis('btnSalvarDonoCargaDetalhe', cargaDetalheProgramacaoBloqueada);
    dis('btnAlinharDonoCargaNf', cargaDetalheProgramacaoBloqueada);
    document.querySelectorAll('.btn-rem-nfe').forEach(function (b) {
      b.disabled = cargaDetalheProgramacaoBloqueada;
      if (cargaDetalheProgramacaoBloqueada) b.setAttribute('title', 'Bloqueado após início da expedição.');
      else b.removeAttribute('title');
    });
  }

  function rotuloExpedicaoLista(st) {
    var s = String(st || '').toUpperCase();
    if (s === 'PRONTA_EXPEDICAO') return 'Pronta para expedição';
    if (s === 'EM_EXPEDICAO') return 'Em expedição';
    if (s === 'EXPEDIDA') return 'Expedida';
    if (!s) return '—';
    return String(st);
  }

  function rotuloSituacaoCarga(st) {
    var s = String(st || '').toUpperCase();
    if (s === 'RASCUNHO') return 'Rascunho';
    if (s === 'EM_EXPEDICAO') return 'Em expedição';
    if (s === 'EXPEDIDA') return 'Expedida';
    if (!s) return '—';
    return String(st);
  }

  var ultimoPlanoDistribuirNf = null;

  function montarQueryDistribuirNfRota() {
    lerFormularioFiltroCargasParaEstado();
    var p = new URLSearchParams();
    if (cargaFiltroState.stExpedicao) p.set('stExpedicao', cargaFiltroState.stExpedicao);
    if (cargaFiltroState.dhCriacaoDe) p.set('dhCriacaoDe', cargaFiltroState.dhCriacaoDe);
    if (cargaFiltroState.dhCriacaoAte) p.set('dhCriacaoAte', cargaFiltroState.dhCriacaoAte);
    if (cargaFiltroState.busca) p.set('busca', cargaFiltroState.busca);
    if (cargaFiltroState.numeroNf) p.set('numeroNf', cargaFiltroState.numeroNf);
    if (cargaFiltroState.serie) p.set('serie', cargaFiltroState.serie);
    p.set('stCarga', 'RASCUNHO');
    return p;
  }

  function fecharModalDistribuirNf() {
    var modal = document.getElementById('cargaDistribuirNfModal');
    if (modal) modal.style.display = 'none';
    ultimoPlanoDistribuirNf = null;
    var btn = document.getElementById('btnConfirmarDistribuirNfModal');
    if (btn) btn.disabled = true;
  }

  function renderPreviewDistribuirNf(plano) {
    var resumo = document.getElementById('cargaDistribuirNfResumo');
    var det = document.getElementById('cargaDistribuirNfDetalhe');
    var btnOk = document.getElementById('btnConfirmarDistribuirNfModal');
    if (!resumo || !det) return;
    var t = plano.totais || {};
    var htmlRes =
      '<strong>Prévia:</strong> ' +
      String(t.nfDistribuir || 0) +
      ' NF-e → ' +
      String(t.cargasComNf || 0) +
      ' carga(s) · ' +
      String(t.nfDisponiveis || 0) +
      ' disponíveis no total';
    if (t.nfSemRota > 0) htmlRes += ' · <span style="color:#b45309">' + t.nfSemRota + ' sem rota no cadastro</span>';
    if (t.nfSemCarga > 0) htmlRes += ' · <span style="color:#b91c1c">' + t.nfSemCarga + ' sem carga destino</span>';
    if (t.nfSemDataCompativel > 0) {
      htmlRes +=
        ' · <span style="color:#b45309">' +
        t.nfSemDataCompativel +
        ' ignorada(s) — data saída ≠ programação</span>';
    }
    if (t.rotasDuplicadas > 0) htmlRes += ' · <span style="color:#b91c1c">' + t.rotasDuplicadas + ' rota(s) duplicada(s)</span>';
    if (plano.datasProgramacaoCargas && plano.datasProgramacaoCargas.length) {
      htmlRes +=
        '<br><span style="color:#475569">Datas na descrição das cargas: ' +
        escapeHtml(plano.datasProgramacaoCargas.join(', ')) +
        '</span>';
    }
    if (plano.aviso) htmlRes += '<br><span style="color:#92400e">' + escapeHtml(plano.aviso) + '</span>';
    resumo.innerHTML = htmlRes;

    var html = '';
    (plano.porCarga || []).forEach(function (bloco) {
      html +=
        '<div style="margin:12px 0 6px;font-weight:700">Carga #' +
        escapeHtml(String(bloco.CD_CARGA)) +
        ' — ' +
        escapeHtml(bloco.NM_DESCRICAO || '') +
        ' <span style="font-weight:600;color:#64748b">(Rota ' +
        escapeHtml(String(bloco.NR_ROTA)) +
        (bloco.DATA_PROGRAMACAO ? ' · prog. ' + escapeHtml(bloco.DATA_PROGRAMACAO) : '') +
        ' · +' +
        (bloco.nfes || []).length +
        ' NF · já tinha ' +
        String(bloco.Q_NFES_ATUAL || 0) +
        ')</span></div>';
      html += '<table class="wms-sep-table"><thead><tr><th>NF</th><th>Destino</th><th>Município</th><th>UF</th></tr></thead><tbody>';
      (bloco.nfes || []).forEach(function (nf) {
        html +=
          '<tr><td>' +
          escapeHtml(nf.ident || '') +
          '</td><td>' +
          escapeHtml(nf.destino || '') +
          '</td><td>' +
          escapeHtml(nf.municipio || '') +
          '</td><td>' +
          escapeHtml(nf.uf || '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
    });
    if ((plano.semCarga || []).length) {
      html += '<div style="margin:14px 0 6px;font-weight:700;color:#b91c1c">Sem carga destino (' + plano.semCarga.length + ')</div>';
      html += '<table class="wms-sep-table"><thead><tr><th>NF</th><th>Rota</th><th>Destino</th><th>Motivo</th></tr></thead><tbody>';
      plano.semCarga.forEach(function (nf) {
        html +=
          '<tr><td>' +
          escapeHtml(nf.ident || '') +
          '</td><td>' +
          escapeHtml(nf.NR_ROTA != null ? String(nf.NR_ROTA) : '—') +
          '</td><td>' +
          escapeHtml(nf.destino || '') +
          '</td><td>' +
          escapeHtml(nf.motivo || '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if ((plano.semDataCompativel || []).length) {
      html +=
        '<div style="margin:14px 0 6px;font-weight:700;color:#b45309">Data incompatível (' +
        plano.semDataCompativel.length +
        ')</div>';
      html +=
        '<table class="wms-sep-table"><thead><tr><th>NF</th><th>Rota</th><th>Destino</th><th>Motivo</th></tr></thead><tbody>';
      plano.semDataCompativel.forEach(function (nf) {
        html +=
          '<tr><td>' +
          escapeHtml(nf.ident || '') +
          '</td><td>' +
          escapeHtml(nf.NR_ROTA != null ? String(nf.NR_ROTA) : '—') +
          '</td><td>' +
          escapeHtml(nf.destino || '') +
          '</td><td>' +
          escapeHtml(nf.motivo || '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if ((plano.semRota || []).length) {
      html += '<div style="margin:14px 0 6px;font-weight:700;color:#b45309">Sem rota no cadastro (' + plano.semRota.length + ')</div>';
      html += '<table class="wms-sep-table"><thead><tr><th>NF</th><th>Destino</th><th>Município</th></tr></thead><tbody>';
      plano.semRota.slice(0, 50).forEach(function (nf) {
        html +=
          '<tr><td>' +
          escapeHtml(nf.ident || '') +
          '</td><td>' +
          escapeHtml(nf.destino || '') +
          '</td><td>' +
          escapeHtml(nf.municipio || '') +
          ' / ' +
          escapeHtml(nf.uf || '') +
          '</td></tr>';
      });
      if (plano.semRota.length > 50) {
        html += '<tr><td colspan="3"><em>… e mais ' + (plano.semRota.length - 50) + ' nota(s)</em></td></tr>';
      }
      html += '</tbody></table>';
    }
    if ((plano.rotasDuplicadas || []).length) {
      html += '<div style="margin:14px 0 6px;font-weight:700;color:#b91c1c">Rotas com mais de uma carga</div><ul style="margin:0;padding-left:20px">';
      plano.rotasDuplicadas.forEach(function (rd) {
        html +=
          '<li>Rota ' +
          escapeHtml(String(rd.NR_ROTA)) +
          ': ' +
          (rd.cargas || [])
            .map(function (c) {
              return '#' + c.CD_CARGA + ' ' + escapeHtml(c.NM_DESCRICAO || '');
            })
            .join(' · ') +
          '</li>';
      });
      html += '</ul>';
    }
    if (!html) html = '<p class="empty" style="padding:16px">Nenhuma NF pôde ser distribuída com os filtros atuais.</p>';
    det.innerHTML = html;
    if (btnOk) btnOk.disabled = !plano.podeAplicar;
  }

  function abrirModalDistribuirNfRota() {
    var modal = document.getElementById('cargaDistribuirNfModal');
    var det = document.getElementById('cargaDistribuirNfDetalhe');
    if (!modal || !det) return;
    modal.style.display = 'flex';
    det.innerHTML = '<p class="empty" style="padding: 16px;">Carregando prévia…</p>';
    var resumo = document.getElementById('cargaDistribuirNfResumo');
    if (resumo) resumo.textContent = '';
    var btnOk = document.getElementById('btnConfirmarDistribuirNfModal');
    if (btnOk) btnOk.disabled = true;
    showLoading('Distribuição', 'Calculando prévia…', '');
    var qs = montarQueryDistribuirNfRota();
    fetch('/api/wms/cargas/programadas/distribuir-nf-rota/preview?' + qs.toString(), {
      headers: getAuthHeaders(),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (plano) {
        ultimoPlanoDistribuirNf = plano;
        renderPreviewDistribuirNf(plano);
      })
      .catch(function (e) {
        fecharModalDistribuirNf();
        showMessage(e.message || 'Erro ao carregar prévia.', 'error');
      })
      .finally(hideLoading);
  }

  function fecharModalMesclarCarga() {
    var modal = document.getElementById('cargaMergeModal');
    if (modal) modal.style.display = 'none';
  }

  function atualizarResumoMesclar() {
    var selO = document.getElementById('cargaMergeOrigem');
    var selD = document.getElementById('cargaMergeDestino');
    var p = document.getElementById('cargaMergeResumo');
    if (!selO || !selD || !p) return;
    var ido = parseInt(selO.value, 10);
    var idd = parseInt(selD.value, 10);
    if (!Number.isFinite(ido) || !Number.isFinite(idd)) {
      p.textContent = '';
      return;
    }
    if (ido === idd) {
      p.textContent = 'Escolha cargas diferentes.';
      return;
    }
    var org = null;
    var dst = null;
    for (var i = 0; i < ultimaListaCargas.length; i++) {
      var r = ultimaListaCargas[i];
      if (Number(r.CD_CARGA) === ido) org = r;
      if (Number(r.CD_CARGA) === idd) dst = r;
    }
    var qo = org ? Number(org.Q_NFES || 0) : 0;
    var qd = dst ? Number(dst.Q_NFES || 0) : 0;
    p.textContent =
      'Serão movidas ' +
      qo +
      ' NF-e da carga #' +
      ido +
      ' para a carga #' +
      idd +
      ' (que já tem ' +
      qd +
      ' NF-e). Total após mesclagem: ' +
      (qo + qd) +
      '.';
    if (qo <= 0) p.textContent += ' A origem precisa ter ao menos uma NF-e.';
  }

  function abrirModalMesclarCarga() {
    var rasc = ultimaListaCargas.filter(isCargaRascunho);
    if (rasc.length < 2) {
      showMessage('São necessárias ao menos duas cargas em rascunho, sem expedição em andamento ou já expedida.', 'warning');
      return;
    }
    var comNf = rasc.filter(function (r) {
      return Number(r.Q_NFES || 0) > 0;
    });
    if (!comNf.length) {
      showMessage('Nenhuma carga em RASCUNHO possui NF-e para mover.', 'warning');
      return;
    }
    var selO = document.getElementById('cargaMergeOrigem');
    var selD = document.getElementById('cargaMergeDestino');
    var modal = document.getElementById('cargaMergeModal');
    if (!selO || !selD || !modal) return;
    function optLabel(row) {
      return (
        '#' +
        row.CD_CARGA +
        ' — ' +
        String(row.NM_DESCRICAO || 'Sem descrição').trim() +
        ' (' +
        Number(row.Q_NFES || 0) +
        ' NF)'
      );
    }
    selO.innerHTML = comNf
      .map(function (r) {
        return '<option value="' + escapeHtml(r.CD_CARGA) + '">' + escapeHtml(optLabel(r)) + '</option>';
      })
      .join('');
    selD.innerHTML = rasc
      .map(function (r) {
        return '<option value="' + escapeHtml(r.CD_CARGA) + '">' + escapeHtml(optLabel(r)) + '</option>';
      })
      .join('');
    var defO = comNf[0].CD_CARGA;
    selO.value = String(defO);
    var defD = null;
    for (var j = 0; j < rasc.length; j++) {
      if (Number(rasc[j].CD_CARGA) !== Number(defO)) {
        defD = rasc[j].CD_CARGA;
        break;
      }
    }
    selD.value = String(defD != null ? defD : defO);
    if (selO.value === selD.value) {
      for (var k = 0; k < rasc.length; k++) {
        if (String(rasc[k].CD_CARGA) !== selO.value) {
          selD.value = String(rasc[k].CD_CARGA);
          break;
        }
      }
    }
    var radios = document.querySelectorAll('#cargaMergeModal input[name="cargaMergeDesc"]');
    if (radios[0]) radios[0].checked = true;
    atualizarResumoMesclar();
    modal.style.display = 'flex';
  }

  function baixarArquivoAutenticado(url, nomeFallback) {
    showLoading('Exportando', 'Gerando CSV…', '');
    fetch(url, { headers: getAuthHeaders() })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (txt) {
            var msg = txt || r.statusText;
            try {
              var j = JSON.parse(txt);
              if (j && j.error) msg = j.error;
            } catch (_) {}
            throw new Error(msg);
          });
        }
        var disp = r.headers.get('Content-Disposition') || '';
        var m = /filename="([^"]+)"/i.exec(disp);
        var nome = m && m[1] ? m[1] : nomeFallback || 'export.csv';
        return r.blob().then(function (blob) {
          return { blob: blob, nome: nome };
        });
      })
      .then(function (o) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(o.blob);
        a.download = o.nome;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 400);
        showMessage('Arquivo baixado: ' + o.nome, 'success');
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao exportar.', 'error');
      })
      .finally(hideLoading);
  }

  function montarQueryExportNfCargas() {
    lerFormularioFiltroCargasParaEstado();
    var p = new URLSearchParams();
    if (cargaFiltroState.stCarga) p.set('stCarga', cargaFiltroState.stCarga);
    if (cargaFiltroState.stExpedicao) p.set('stExpedicao', cargaFiltroState.stExpedicao);
    if (cargaFiltroState.dhCriacaoDe) p.set('dhCriacaoDe', cargaFiltroState.dhCriacaoDe);
    if (cargaFiltroState.dhCriacaoAte) p.set('dhCriacaoAte', cargaFiltroState.dhCriacaoAte);
    if (cargaFiltroState.dhExpedicaoDe) p.set('dhExpedicaoDe', cargaFiltroState.dhExpedicaoDe);
    if (cargaFiltroState.dhExpedicaoAte) p.set('dhExpedicaoAte', cargaFiltroState.dhExpedicaoAte);
    if (cargaFiltroState.busca) p.set('busca', cargaFiltroState.busca);
    if (cargaFiltroState.numeroNf) p.set('numeroNf', cargaFiltroState.numeroNf);
    if (cargaFiltroState.serie) p.set('serie', cargaFiltroState.serie);
    if (cargaFiltroState.idViagem) p.set('idViagem', cargaFiltroState.idViagem);
    return '/api/wms/cargas/programadas/export-nf.csv?' + p.toString();
  }

  function montarQueryCargas() {
    var p = new URLSearchParams();
    if (cargaFiltroState.stCarga) p.set('stCarga', cargaFiltroState.stCarga);
    if (cargaFiltroState.stExpedicao) p.set('stExpedicao', cargaFiltroState.stExpedicao);
    if (cargaFiltroState.dhCriacaoDe) p.set('dhCriacaoDe', cargaFiltroState.dhCriacaoDe);
    if (cargaFiltroState.dhCriacaoAte) p.set('dhCriacaoAte', cargaFiltroState.dhCriacaoAte);
    if (cargaFiltroState.dhExpedicaoDe) p.set('dhExpedicaoDe', cargaFiltroState.dhExpedicaoDe);
    if (cargaFiltroState.dhExpedicaoAte) p.set('dhExpedicaoAte', cargaFiltroState.dhExpedicaoAte);
    if (cargaFiltroState.busca) p.set('busca', cargaFiltroState.busca);
    if (cargaFiltroState.numeroNf) p.set('numeroNf', cargaFiltroState.numeroNf);
    if (cargaFiltroState.serie) p.set('serie', cargaFiltroState.serie);
    if (cargaFiltroState.idViagem) p.set('idViagem', cargaFiltroState.idViagem);
    p.set('page', String(cargaFiltroState.page));
    p.set('pageSize', String(cargaFiltroState.pageSize));
    return '/api/wms/cargas/programadas?' + p.toString();
  }

  function montarQueryResumoProgramacaoCargas(stExpedicaoOverride) {
    var p = new URLSearchParams();
    if (cargaFiltroState.stCarga) p.set('stCarga', cargaFiltroState.stCarga);
    var stExp =
      stExpedicaoOverride != null && String(stExpedicaoOverride).trim() !== ''
        ? String(stExpedicaoOverride).trim()
        : cargaFiltroState.stExpedicao;
    if (stExp) p.set('stExpedicao', stExp);
    if (cargaFiltroState.dhCriacaoDe) p.set('dhCriacaoDe', cargaFiltroState.dhCriacaoDe);
    if (cargaFiltroState.dhCriacaoAte) p.set('dhCriacaoAte', cargaFiltroState.dhCriacaoAte);
    if (cargaFiltroState.dhExpedicaoDe) p.set('dhExpedicaoDe', cargaFiltroState.dhExpedicaoDe);
    if (cargaFiltroState.dhExpedicaoAte) p.set('dhExpedicaoAte', cargaFiltroState.dhExpedicaoAte);
    if (cargaFiltroState.busca) p.set('busca', cargaFiltroState.busca);
    if (cargaFiltroState.numeroNf) p.set('numeroNf', cargaFiltroState.numeroNf);
    if (cargaFiltroState.serie) p.set('serie', cargaFiltroState.serie);
    if (cargaFiltroState.idViagem) p.set('idViagem', cargaFiltroState.idViagem);
    p.set('format', 'html');
    return '/api/wms/cargas/programadas/resumo-programacao?' + p.toString();
  }

  function abrirResumoProgramacaoCargas(stExpedicaoOverride) {
    lerFormularioFiltroCargasParaEstado();
    abrirImpressaoHtml(montarQueryResumoProgramacaoCargas(stExpedicaoOverride));
  }

  function focarBipNfCargaDetalhe() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var input = document.getElementById('inputChaveNfCarga');
        if (input && !input.disabled) {
          input.focus();
          try {
            input.select();
          } catch (_) {}
        }
      });
    });
  }

  function rotuloDonosCargaDetalheHtml() {
    var lista = donosCargaDetalhe.length ? donosCargaDetalhe : donosDistintosDasNfes(nfesDetalheCache);
    if (!lista.length) {
      return '<div><strong>Donos (NF):</strong> <span class="hint">Nenhuma NF na carga — bipe as notas abaixo</span></div>';
    }
    var partes = lista.map(function (d) {
      var cd = d.CD_DONO != null ? d.CD_DONO : d.cd_dono;
      var nm = d.NM_DONO != null ? d.NM_DONO : d.nm_dono;
      return escapeHtml(nm || 'Dono #' + cd);
    });
    return (
      '<div><strong>Donos (NF):</strong> ' +
      partes.join(' · ') +
      ' <span class="hint">(somente leitura — vem das notas)</span></div>'
    );
  }

  function cdsDonoNfDetalheUnicos() {
    var lista = donosCargaDetalhe.length ? donosCargaDetalhe : donosDistintosDasNfes(nfesDetalheCache);
    var set = {};
    var out = [];
    lista.forEach(function (d) {
      var cd = d.CD_DONO != null ? d.CD_DONO : d.cd_dono;
      var n = parseInt(cd, 10);
      if (!Number.isFinite(n) || set[n]) return;
      set[n] = true;
      out.push(n);
    });
    return out;
  }

  function atualizarAvisoDonoCargaDetalhe() {
    var aviso = document.getElementById('detalheCargaDonoAviso');
    if (!aviso) return;
    var cdsNf = cdsDonoNfDetalheUnicos();
    var sel = document.getElementById('detalheCargaDono');
    var rawSel = sel && sel.value ? parseInt(sel.value, 10) : null;
    if (!Number.isFinite(rawSel)) rawSel = null;
    if (rawSel != null && cdsNf.length === 1 && rawSel !== cdsNf[0]) {
      aviso.style.display = '';
      aviso.style.background = '#fef3c7';
      aviso.style.border = '1px solid #f59e0b';
      aviso.style.color = '#92400e';
      aviso.innerHTML =
        '<strong>Atenção:</strong> o dono da carga difere do dono das NF. A expedição será bloqueada até alinhar. Clique em <strong>Alinhar às NF</strong> ou escolha o dono correto e <strong>Salvar dono</strong>.';
      return;
    }
    if (rawSel != null && cdsNf.length > 1) {
      aviso.style.display = '';
      aviso.style.background = '#eff6ff';
      aviso.style.border = '1px solid #93c5fd';
      aviso.style.color = '#1e40af';
      aviso.innerHTML =
        'Há vários donos nas NF. Prefira deixar o dono da carga em branco (rota mista) ou confirme se a expedição multi-dono está correta.';
      return;
    }
    aviso.style.display = 'none';
    aviso.innerHTML = '';
  }

  function preencherSelectDonoDetalhe(cdDono) {
    cargaDetalheCdDono =
      cdDono != null && cdDono !== '' && Number.isFinite(Number(cdDono)) ? Number(cdDono) : null;
    var sel = document.getElementById('detalheCargaDono');
    if (sel) {
      if (!sel.options.length || sel.options.length === 1) {
        fillDonoSelects(cacheDonosEstoque);
      }
      sel.value = cargaDetalheCdDono != null ? String(cargaDetalheCdDono) : '';
    }
    atualizarAvisoDonoCargaDetalhe();
  }

  function salvarDonoCargaProgramada(cdCarga, cdDonoOuNull, opts) {
    opts = opts || {};
    var body = { CD_DONO: cdDonoOuNull };
    if (opts.nmDescricao) body.NM_DESCRICAO = opts.nmDescricao;
    showLoading('Salvando', 'Atualizando dono da carga…', '');
    return fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(cdCarga)), {
      method: 'PUT',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .finally(hideLoading);
  }

  function lerFormularioFiltroCargasParaEstado() {
    var st = document.getElementById('filtroCargaSt');
    var ex = document.getElementById('filtroCargaStExp');
    var de = document.getElementById('filtroCargaDhDe');
    var ate = document.getElementById('filtroCargaDhAte');
    var expDe = document.getElementById('filtroCargaDhExpDe');
    var expAte = document.getElementById('filtroCargaDhExpAte');
    var bu = document.getElementById('filtroCargaBusca');
    var nf = document.getElementById('filtroCargaNumeroNf');
    var ser = document.getElementById('filtroCargaSerie');
    var vi = document.getElementById('filtroCargaIdViagem');
    var ps = document.getElementById('filtroCargaPageSize');
    cargaFiltroState.stCarga = st && st.value ? st.value : '';
    cargaFiltroState.stExpedicao = ex && ex.value ? ex.value : '';
    cargaFiltroState.dhCriacaoDe = de && de.value ? de.value : '';
    cargaFiltroState.dhCriacaoAte = ate && ate.value ? ate.value : '';
    cargaFiltroState.dhExpedicaoDe = expDe && expDe.value ? expDe.value : '';
    cargaFiltroState.dhExpedicaoAte = expAte && expAte.value ? expAte.value : '';
    cargaFiltroState.busca = bu && bu.value ? String(bu.value).trim() : '';
    cargaFiltroState.numeroNf = nf && nf.value ? String(nf.value).trim() : '';
    cargaFiltroState.serie = ser && ser.value ? String(ser.value).trim() : '';
    cargaFiltroState.idViagem = vi && vi.value ? String(vi.value).trim() : '';
    var nps = ps && ps.value ? parseInt(ps.value, 10) : 50;
    cargaFiltroState.pageSize = Number.isFinite(nps) ? nps : 50;
  }

  function aplicarFormularioFiltroCargasNoDom() {
    function set(id, v) {
      var el = document.getElementById(id);
      if (el) el.value = v != null ? v : '';
    }
    set('filtroCargaSt', cargaFiltroState.stCarga);
    set('filtroCargaStExp', cargaFiltroState.stExpedicao);
    set('filtroCargaDhDe', cargaFiltroState.dhCriacaoDe);
    set('filtroCargaDhAte', cargaFiltroState.dhCriacaoAte);
    set('filtroCargaDhExpDe', cargaFiltroState.dhExpedicaoDe);
    set('filtroCargaDhExpAte', cargaFiltroState.dhExpedicaoAte);
    set('filtroCargaBusca', cargaFiltroState.busca);
    set('filtroCargaNumeroNf', cargaFiltroState.numeroNf);
    set('filtroCargaSerie', cargaFiltroState.serie);
    set('filtroCargaIdViagem', cargaFiltroState.idViagem);
    var ps = document.getElementById('filtroCargaPageSize');
    if (ps) ps.value = String(cargaFiltroState.pageSize);
  }

  function limparFiltrosCargas() {
    cargaFiltroState.page = 1;
    cargaFiltroState.pageSize = 50;
    cargaFiltroState.stCarga = '';
    cargaFiltroState.stExpedicao = '';
    cargaFiltroState.dhCriacaoDe = '';
    cargaFiltroState.dhCriacaoAte = '';
    cargaFiltroState.dhExpedicaoDe = '';
    cargaFiltroState.dhExpedicaoAte = '';
    cargaFiltroState.busca = '';
    cargaFiltroState.numeroNf = '';
    cargaFiltroState.serie = '';
    cargaFiltroState.idViagem = '';
    aplicarFormularioFiltroCargasNoDom();
    carregarCargas();
  }

  function cargaIrPagina(delta) {
    var total = cargaListMeta.total || 0;
    var ps = cargaFiltroState.pageSize || 50;
    var tp = Math.max(1, Math.ceil(total / ps));
    cargaFiltroState.page += delta;
    if (cargaFiltroState.page < 1) cargaFiltroState.page = 1;
    if (cargaFiltroState.page > tp) cargaFiltroState.page = tp;
    carregarCargas();
  }

  var cargaListMeta = { total: 0, page: 1, pageSize: 50 };

  function renderListaCargas(payload) {
    var host = document.getElementById('listaCargas');
    var pagHost = document.getElementById('cargaListPaginacao');
    if (!host) return;
    var rows =
      payload && Array.isArray(payload.items) ? payload.items : Array.isArray(payload) ? payload : [];
    var total = payload && payload.total != null ? Number(payload.total) : rows.length;
    var page = payload && payload.page != null ? Number(payload.page) : 1;
    var pageSize = payload && payload.pageSize != null ? Number(payload.pageSize) : cargaFiltroState.pageSize || 50;
    cargaListMeta = { total: total, page: page, pageSize: pageSize };
    ultimaListaCargas = rows;
    if (!rows.length) {
      host.innerHTML =
        '<p class="empty" style="padding:16px;">' +
        (total === 0 ? 'Nenhuma carga para os filtros atuais.' : 'Nenhum registro nesta página.') +
        '</p>';
    } else {
      function fmtPesoLista(v) {
        var n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return '—';
        return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
      }
      var html =
        '<table class="wms-sep-table"><thead><tr>' +
        '<th>ID</th><th>Descrição</th><th>Montagem</th><th>Expedição</th><th class="num">NF-e</th>' +
        '<th class="num" title="Peso seco / ambiente (kg)">Seco</th>' +
        '<th class="num" title="Peso refrigerado / congelado (kg)">Frio</th>' +
        '<th class="num" title="Peso total estimado (kg)">Peso</th>' +
        '<th>Viagem</th><th>Criada</th><th>Início exp.</th><th></th></tr></thead><tbody>';
      rows.forEach(function (row) {
        var id = row.CD_CARGA;
        var desc = String(row.NM_DESCRICAO || '').trim();
        var stExRaw = row.ST_EXPEDICAO != null && row.ST_EXPEDICAO !== '' ? String(row.ST_EXPEDICAO) : '';
        var stMont =
          row.ST_CARGA_PROGRAMADA != null && row.ST_CARGA_PROGRAMADA !== ''
            ? row.ST_CARGA_PROGRAMADA
            : row.ST_CARGA;
        var stEx = rotuloExpedicaoLista(stExRaw || 'PRONTA_EXPEDICAO');
        var progBloqLista = isExpedicaoBloqueiaProgramacaoSt(stExRaw || 'PRONTA_EXPEDICAO');
        var idV =
          row.WMS_IDVIAGEM_ROTA != null && String(row.WMS_IDVIAGEM_ROTA).trim() !== ''
            ? String(row.WMS_IDVIAGEM_ROTA)
            : row.wms_idviagem_rota != null && String(row.wms_idviagem_rota).trim() !== ''
              ? String(row.wms_idviagem_rota)
              : '';
        var cellViagem =
          idV && Number(idV) > 0
            ? '#' + escapeHtml(idV)
            : '<span class="hint" title="Última rota operacional calculada sem viagem gerada ainda">—</span>';
        var acoes =
          '<div class="carga-acoes">' +
          '<button type="button" class="btn-carga-acao btn-abrir-carga" data-id="' +
          escapeHtml(id) +
          '" title="Abrir carga"><i class="bx bx-show"></i></button>' +
          (progBloqLista
            ? '<span class="hint" title="Descrição não editável com expedição em andamento ou expedida." style="width:30px;text-align:center;">—</span>'
            : '<button type="button" class="btn-carga-acao btn-editar-carga" data-id="' +
              escapeHtml(id) +
              '" data-desc="' +
              escapeHtml(desc) +
              '" title="Editar descrição"><i class="bx bx-pencil"></i></button>') +
          (isCargaExclusivelLista(row)
            ? '<button type="button" class="btn-carga-acao btn-excluir-carga" data-id="' +
              escapeHtml(id) +
              '" title="Excluir carga"><i class="bx bx-trash"></i></button>'
            : '<span class="hint" title="' +
              escapeHtml(motivoCargaNaoExclusivel(row)) +
              '" style="width:30px;text-align:center;">—</span>') +
          '</div>';
        html +=
          '<tr><td>' +
          escapeHtml(id) +
          '</td><td>' +
          escapeHtml(desc || '—') +
          '</td><td>' +
          escapeHtml(rotuloSituacaoCarga(stMont)) +
          '</td><td>' +
          escapeHtml(stEx) +
          '</td><td class="num">' +
          escapeHtml(row.Q_NFES != null ? row.Q_NFES : '0') +
          '</td><td class="num peso-seco" title="Seco (kg)">' +
          escapeHtml(fmtPesoLista(row.PESO_KG_SECO)) +
          '</td><td class="num peso-frio" title="Frio (kg)">' +
          escapeHtml(fmtPesoLista(row.PESO_KG_FRIO)) +
          '</td><td class="num" title="Peso total (kg)">' +
          escapeHtml(fmtPesoLista(row.PESO_KG)) +
          '</td><td>' +
          cellViagem +
          '</td><td>' +
          escapeHtml(formatDh(row.DH_CRIACAO)) +
          '</td><td>' +
          escapeHtml(row.DH_INICIO_EXPEDICAO ? formatDh(row.DH_INICIO_EXPEDICAO) : '—') +
          '</td><td>' +
          acoes +
          '</td></tr>';
      });
      html += '</tbody></table>';
      host.innerHTML = html;
      host.querySelectorAll('.btn-abrir-carga').forEach(function (b) {
        b.addEventListener('click', function () {
          abrirDetalheCarga(parseInt(b.getAttribute('data-id'), 10));
        });
      });
      host.querySelectorAll('.btn-editar-carga').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-id'), 10);
          var atual = String(b.getAttribute('data-desc') || '').trim();
          if (!Number.isFinite(id)) return;
          abrirModalEditarCarga(id, atual);
        });
      });
      host.querySelectorAll('.btn-excluir-carga').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-id'), 10);
          if (!Number.isFinite(id)) return;
          abrirModalExcluirCarga(id);
        });
      });
    }
    if (pagHost) {
      if (total <= 0) {
        pagHost.innerHTML = '';
      } else {
        var totalPages = Math.max(1, Math.ceil(total / pageSize));
        var ini = (page - 1) * pageSize + 1;
        var fim = Math.min(page * pageSize, total);
        var prevDis = page <= 1 ? ' disabled' : '';
        var nextDis = page >= totalPages ? ' disabled' : '';
        pagHost.innerHTML =
          '<span class="carga-pag-info">' +
          escapeHtml(ini + '–' + fim + ' de ' + total + ' (pág. ' + page + '/' + totalPages + ')') +
          '</span><span style="display:flex;gap:8px;">' +
          '<button type="button" class="btn-filtro btn-filtro-limpar"' +
          prevDis +
          ' id="btnCargaPagPrev"><i class="bx bx-chevron-left"></i> Anterior</button>' +
          '<button type="button" class="btn-filtro btn-filtro-limpar"' +
          nextDis +
          ' id="btnCargaPagNext">Próxima <i class="bx bx-chevron-right"></i></button></span>';
        var bp = document.getElementById('btnCargaPagPrev');
        var bn = document.getElementById('btnCargaPagNext');
        if (bp && !bp.disabled) bp.addEventListener('click', function () { cargaIrPagina(-1); });
        if (bn && !bn.disabled) bn.addEventListener('click', function () { cargaIrPagina(1); });
      }
    }
  }

  function abrirModalEditarCarga(id, descricaoAtual) {
    var row = null;
    for (var ir = 0; ir < ultimaListaCargas.length; ir++) {
      if (Number(ultimaListaCargas[ir].CD_CARGA) === id) {
        row = ultimaListaCargas[ir];
        break;
      }
    }
    if (isExpedicaoBloqueiaProgramacaoSt(stExpedicaoParaRow(row))) {
      showMessage('Não é possível editar: expedição em andamento ou carga já expedida.', 'warning');
      return;
    }
    var modal = document.getElementById('cargaEditModal');
    var input = document.getElementById('cargaEditDescricao');
    var selDono = document.getElementById('cargaEditDono');
    if (!modal || !input) return;
    cargaEditState.id = id;
    input.value = descricaoAtual || '';
    if (selDono) {
      fillDonoSelects(cacheDonosEstoque);
      var cdD =
        row && row.CD_DONO != null && Number.isFinite(Number(row.CD_DONO))
          ? String(row.CD_DONO)
          : '';
      selDono.value = cdD;
    }
    modal.style.display = 'flex';
    setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  function fecharModalEditarCarga() {
    var modal = document.getElementById('cargaEditModal');
    if (modal) modal.style.display = 'none';
    cargaEditState.id = null;
  }

  function abrirModalExcluirCarga(id) {
    var rowE = null;
    for (var ie = 0; ie < ultimaListaCargas.length; ie++) {
      if (Number(ultimaListaCargas[ie].CD_CARGA) === id) {
        rowE = ultimaListaCargas[ie];
        break;
      }
    }
    if (!isCargaExclusivelLista(rowE)) {
      showMessage(motivoCargaNaoExclusivel(rowE) || 'Esta carga não pode ser excluída.', 'warning');
      return;
    }
    var modal = document.getElementById('cargaDeleteModal');
    var label = document.getElementById('cargaDeleteLabel');
    if (!modal) return;
    cargaDeleteState.id = id;
    if (label) label.textContent = '#' + id;
    modal.style.display = 'flex';
  }

  function fecharModalExcluirCarga() {
    var modal = document.getElementById('cargaDeleteModal');
    if (modal) modal.style.display = 'none';
    cargaDeleteState.id = null;
  }

  function abrirModalRemoverNf(idNfe) {
    if (cargaDetalheProgramacaoBloqueada) {
      showMessage('Não é possível remover NF: expedição em andamento ou carga já expedida.', 'warning');
      return;
    }
    var modal = document.getElementById('nfRemoveModal');
    if (!modal) return;
    nfRemoveState.idNfe = idNfe;
    modal.style.display = 'flex';
  }

  function fecharModalRemoverNf() {
    var modal = document.getElementById('nfRemoveModal');
    if (modal) modal.style.display = 'none';
    nfRemoveState.idNfe = null;
  }

  function abrirModalExcluirNf(idNfe, label) {
    if (!Number.isFinite(idNfe)) return;
    var modal = document.getElementById('nfExcluirModal');
    var lbl = document.getElementById('nfExcluirLabel');
    if (!modal) return;
    nfExcluirState.idNfe = idNfe;
    nfExcluirState.label = label || String(idNfe);
    if (lbl) lbl.textContent = nfExcluirState.label;
    modal.style.display = 'flex';
  }

  function fecharModalExcluirNf() {
    var modal = document.getElementById('nfExcluirModal');
    if (modal) modal.style.display = 'none';
    nfExcluirState.idNfe = null;
    nfExcluirState.label = '';
  }

  function executarExcluirNfImportada(idNfe, onSuccess) {
    if (!Number.isFinite(idNfe)) return Promise.resolve();
    showLoading('Excluindo', 'Removendo importação da NF-e…', '');
    return fetch('/api/wms/cargas/nfes-saida/' + encodeURIComponent(String(idNfe)), {
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
        showMessage('Importação da NF-e excluída.', 'success');
        nfDetalheCdAtual = null;
        var detModal = document.getElementById('nfDetalheModal');
        if (detModal) detModal.style.display = 'none';
        if (typeof onSuccess === 'function') return onSuccess();
        return carregarNfSaida().then(function () {
          return carregarDisponiveisParaSelect();
        });
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao excluir importação.', 'error');
      })
      .finally(hideLoading);
  }

  function carregarCargas(opts) {
    var silent = opts && opts.silent;
    if (!silent) showLoading('Carregando', 'Buscando cargas…', '');
    return fetch(montarQueryCargas(), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (j) {
        if (j && j.page != null) cargaFiltroState.page = Number(j.page) || 1;
        if (j && j.pageSize != null) cargaFiltroState.pageSize = Number(j.pageSize) || 50;
        renderListaCargas(j);
      })
      .catch(function (e) {
        showMessage(e.message || 'Erro ao listar cargas.', 'error');
      })
      .finally(function () {
        if (!silent) hideLoading();
      });
  }

  function preencherSelectDisponiveis(rows) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    list.sort(compareNfDisponivelOrdenacao);
    nfDisponiveisCache = list;
    var sel = document.getElementById('selNfDisponivel');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione uma NF…</option>';
    nfDisponiveisCache.forEach(function (n) {
      var label = labelNfeDisponivelCombo(n);
      sel.innerHTML +=
        '<option value="' + escapeHtml(String(n.CD_NFE_SAIDA)) + '">' + escapeHtml(label) + '</option>';
    });
  }

  function normalizeChaveNfe(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function encontrarDisponivelPorChave(chave) {
    var chaveNorm = normalizeChaveNfe(chave);
    if (!chaveNorm) return null;
    for (var i = 0; i < nfDisponiveisCache.length; i++) {
      var it = nfDisponiveisCache[i];
      if (normalizeChaveNfe(it && it.CHAVE_NFE) === chaveNorm) return it;
    }
    return null;
  }

  function adicionarNfNaCarga(cdNfeSaida) {
    if (!cdCargaDetalhe || !Number.isFinite(cdNfeSaida)) return Promise.reject(new Error('NF inválida para vincular.'));
    if (cargaDetalheProgramacaoBloqueada) {
      return Promise.reject(new Error('Expedição em andamento ou carga expedida: não é possível vincular NF.'));
    }
    showLoading('Vinculando', 'Adicionando NF à carga…', '');
    return fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(cdCargaDetalhe)) + '/nfes', {
      method: 'POST',
      headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cdNfeSaida: cdNfeSaida }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function () {
        showMessage('NF adicionada à carga.', 'success');
        return abrirDetalheCarga(cdCargaDetalhe).then(function () {
          return carregarNfSaida();
        }).then(function () {
          focarBipNfCargaDetalhe();
        });
      })
      .finally(hideLoading);
  }

  function carregarDisponiveisParaSelect() {
    return fetch('/api/wms/cargas/nfes-saida/disponiveis', { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(preencherSelectDisponiveis)
      .catch(function () {
        preencherSelectDisponiveis([]);
      });
  }

  function fmtKmDeMetros(m) {
    var n = Number(m);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return (n / 1000).toFixed(1) + ' km';
  }

  function fmtMinDeSegundos(s) {
    var n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return Math.round(n / 60) + ' min';
  }

  /** Atualiza bloco de prévia após “Montar paradas” (não salva rota). */
  function renderPreviaParadasRotaOperacional(j) {
    var el = document.getElementById('wmsRotaOperacionalPreviaParadas');
    if (!el) return;
    var ps = (j && j.paradas) || [];
    if (!ps.length) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    var lines = [];
    lines.push(
      'Prévia (último clique em Montar): ' +
        String(j.qParadas != null ? j.qParadas : ps.length) +
        ' parada(s), ' +
        String(j.qNfes != null ? j.qNfes : '?') +
        ' NF-e.'
    );
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var st = String(p.MATCH_STATUS || 'PENDENTE').toUpperCase();
      var ok = st === 'OK';
      var cnpj = p.CNPJ_ENTREGA != null ? String(p.CNPJ_ENTREGA) : '—';
      var end =
        String(p.LOGRADOURO || '—') +
        ', ' +
        String(p.NUMERO || '—') +
        ' · ' +
        String(p.NM_MUNICIPIO || '—') +
        '/' +
        String(p.UF || '—') +
        ' · CEP ' +
        String(p.CEP || '—');
      var latlon =
        p.LATITUDE != null && p.LONGITUDE != null
          ? ' · coord ' + String(p.LATITUDE) + ', ' + String(p.LONGITUDE)
          : ' · sem coordenadas resolvidas';
      var hint = '';
      var via = p.MATCH_VIA != null ? String(p.MATCH_VIA) : '';
      if (st === 'AMBIGUO') {
        hint = ' → mais de um endereço no cadastro bate; deixe só um ativo ou diferencie o cadastro.';
      } else if (!ok) {
        if (via === 'SEM_COORDENADAS') {
          hint = ' → ponto encontrado no cadastro, mas sem latitude/longitude; edite o ponto e salve coordenadas.';
        } else if (via === 'NAO_ENCONTRADO') {
          hint =
            ' → nenhum ponto do cadastro bate com esta NF (nome/CEP/número/CNPJ da entrega). Coordenadas no cadastro não bastam: o vínculo é por match. Confira DS_PONTO_ENTREGA = nome na NF; filial na NF exige pontos no PJ matriz (dono da carga).';
        } else {
          hint =
            ' → cadastre ponto de entrega (PJ) com mesmo CNPJ; nome do ponto = DS_PONTO_ENTREGA; preencha latitude/longitude.';
        }
        if (via) hint += ' [' + via + ']';
      } else if (via) {
        hint = ' → match: ' + via;
      }
      lines.push(
        '#' +
          String(p.ORDEM != null ? p.ORDEM : i + 1) +
          ' [' +
          st +
          '] CNPJ ' +
          cnpj +
          ' · ' +
          String(p.NM_ENTREGA || '') +
          '\n   ' +
          end +
          latlon +
          hint
      );
    }
    el.textContent = lines.join('\n');
    el.style.display = 'block';
  }

  function limparPreviaParadasRotaOperacional() {
    var el = document.getElementById('wmsRotaOperacionalPreviaParadas');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function formatPesoKgResumo(kg) {
    var n = Number(kg);
    if (!Number.isFinite(n)) return '—';
    return (
      n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + ' kg'
    );
  }

  function renderResumoLogisticoCarga(data) {
    var box = document.getElementById('cargaResumoLogisticoBox');
    var totEl = document.getElementById('cargaResumoLogisticoTotais');
    var avisoEl = document.getElementById('cargaResumoLogisticoAviso');
    var destWrap = document.getElementById('cargaResumoLogisticoDestinosWrap');
    var destHost = document.getElementById('cargaResumoLogisticoDestinos');
    if (!box || !totEl) return;
    if (!data || !data.totais) {
      box.style.display = 'none';
      return;
    }
    var t = data.totais;
    var cards = [
      { lbl: 'NF-e', val: String(t.qtdNfes != null ? t.qtdNfes : 0) },
      { lbl: 'Paradas (destinos)', val: String(t.qtdParadas != null ? t.qtdParadas : 0) },
      { lbl: 'Unidades (NF)', val: String(t.qtdUnidades != null ? t.qtdUnidades : 0) },
      { lbl: 'Peso estimado', val: formatPesoKgResumo(t.pesoKg) },
      { lbl: 'Seco (kg)', val: formatPesoKgResumo(t.pesoKgSeco) },
      { lbl: 'Refrig./cong. (kg)', val: formatPesoKgResumo(t.pesoKgFrio) },
      {
        lbl: 'Cobertura peso cadastro',
        val: String(t.pctCoberturaPeso != null ? t.pctCoberturaPeso : 0) + '%',
      },
    ];
    totEl.innerHTML = cards
      .map(function (c) {
        return (
          '<div class="wms-resumo-log-card"><span class="lbl">' +
          escapeHtml(c.lbl) +
          '</span><strong>' +
          escapeHtml(c.val) +
          '</strong></div>'
        );
      })
      .join('');
    if (avisoEl) {
      if (t.itensSemPeso > 0) {
        avisoEl.style.display = 'block';
        avisoEl.textContent =
          'Atenção: ' +
          String(t.itensSemPeso) +
          ' linha(s) sem PESO_KG no cadastro WMS — o peso total pode estar subestimado. Complete em Cadastros WMS → Produto.';
      } else if (data.aviso) {
        avisoEl.style.display = 'block';
        avisoEl.textContent = data.aviso;
      } else {
        avisoEl.style.display = 'none';
        avisoEl.textContent = '';
      }
    }
        var destinos = data.porDestino || [];
    if (destWrap && destHost) {
      if (destinos.length) {
        destWrap.style.display = 'block';
        var chavesDest = destinos.map(function (d) {
          return d.chaveDestino || '';
        });
        destHost.innerHTML = destinos
          .map(function (d) {
            var mun = [d.municipio, d.uf].filter(Boolean).join(' / ');
            var ch = d.chaveDestino || '';
            var exp = destinoResumoEstaExpandido(ch);
            return (
              '<div class="wms-dest-acc-item" data-chave="' +
              escapeHtml(ch) +
              '">' +
              '<div class="wms-dest-acc-head">' +
              '<button type="button" class="wms-dest-acc-toggle" data-chave="' +
              escapeHtml(ch) +
              '" aria-expanded="' +
              (exp ? 'true' : 'false') +
              '">' +
              '<i class="bx ' +
              (exp ? 'bx-chevron-down' : 'bx-chevron-right') +
              ' wms-dest-acc-chevron" aria-hidden="true"></i>' +
              '<span class="wms-dest-acc-main">' +
              '<span class="wms-dest-acc-mun">' +
              escapeHtml(mun || '—') +
              '</span>' +
              '<span class="wms-dest-acc-ent">' +
              escapeHtml(d.nmEntrega || '—') +
              '</span>' +
              '</span>' +
              '<span class="wms-dest-acc-stats">' +
              '<span><strong>' +
              escapeHtml(d.qtdNfes) +
              '</strong> NF</span>' +
              '<span><strong>' +
              escapeHtml(d.qtdUnidades) +
              '</strong> un.</span>' +
              '<span>' +
              escapeHtml(formatPesoKgResumo(d.pesoKg)) +
              '</span>' +
              '<span class="hint">seco ' +
              escapeHtml(formatPesoKgResumo(d.pesoKgSeco)) +
              '</span>' +
              '<span class="hint">frio ' +
              escapeHtml(formatPesoKgResumo(d.pesoKgFrio)) +
              '</span>' +
              '</span>' +
              '</button>' +
              (ch
                ? '<button type="button" class="btn-filtro btn-filtro-limpar btn-dest-resumo-filtrar" data-chave="' +
                  escapeHtml(ch) +
                  '" title="Ver NF deste ponto na lista abaixo"><i class="bx bx-filter-alt"></i> Ver NF</button>'
                : '') +
              '</div>' +
              '<div class="wms-dest-acc-panel"' +
              (exp ? '' : ' hidden') +
              '>' +
              htmlPanelNfesDestinoResumo(ch) +
              '</div></div>'
            );
          })
          .join('');
        bindAcordeaoResumoDestinos(destHost);
        destHost.setAttribute('data-chaves-dest', chavesDest.join('\n'));
      } else {
        destWrap.style.display = 'none';
        destHost.innerHTML = '';
      }
    }
    box.style.display = 'block';
  }

  function carregarResumoLogisticoCarga(cd) {
    var box = document.getElementById('cargaResumoLogisticoBox');
    if (!box) return Promise.resolve();
    return fetch(
      '/api/wms/cargas/programadas/' + encodeURIComponent(String(cd)) + '/resumo-logistico',
      { headers: getAuthHeaders() }
    )
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (j) {
        renderResumoLogisticoCarga(j);
      })
      .catch(function () {
        if (box) box.style.display = 'none';
      });
  }

  function atualizarResumoRotaOperacional() {
    var out = document.getElementById('wmsRotaOperacionalResumo');
    if (!out || !cdCargaDetalhe) return;
    out.textContent = 'Carregando resumo da rota…';
    fetch(
      '/api/wms/cargas/programadas/' + encodeURIComponent(String(cdCargaDetalhe)) + '/rota-operacional',
      { headers: getAuthHeaders() }
    )
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (j) {
        var ro = j.rota;
        if (!ro) {
          out.textContent = 'Nenhuma rota operacional salva ainda para esta carga.';
          return;
        }
        out.textContent =
          'Última versão: #' +
          String(ro.VERSAO || ro.versao || '') +
          ' · Distância: ' +
          fmtKmDeMetros(ro.DISTANCIA_M) +
          ' · Tempo: ' +
          fmtMinDeSegundos(ro.DURACAO_S) +
          ' · Retorno ao embarque: ' +
          String(ro.RETORNA_ORIGEM || '') +
          '\nOrigem: ' +
          String(ro.ORIGEM_LABEL || '—') +
          (ro.CD_CADASTRO_EMBARQUE != null || ro.cd_cadastro_embarque != null
            ? ' · UN cadastro #' + String(ro.CD_CADASTRO_EMBARQUE != null ? ro.CD_CADASTRO_EMBARQUE : ro.cd_cadastro_embarque)
            : '') +
          ' · Coord: ' +
          String(ro.ORIGEM_LAT != null ? ro.ORIGEM_LAT : '') +
          ', ' +
          String(ro.ORIGEM_LON != null ? ro.ORIGEM_LON : '') +
          '\nParadas salvas: ' +
          String((j.paradas || []).length) +
          (ro.IDVIAGEM != null && String(ro.IDVIAGEM).trim() !== ''
            ? '\nViagem vinculada: #' + String(ro.IDVIAGEM) + ' (Gerenciar Viagens)'
            : ro.IDVIAGEM_HISTORICO_CANCELADA != null
              ? '\nViagem anterior nº ' +
                String(ro.IDVIAGEM_HISTORICO_CANCELADA) +
                ' (cancelada) — pode gerar nova viagem.'
              : '');
      })
      .catch(function (e) {
        out.textContent = 'Rota operacional: ' + (e.message || 'indisponível') + '.';
      });
  }

  function abrirDetalheCarga(cd) {
    cdCargaDetalhe = cd;
    cargaResumoDestinosExpandidos = {};
    cargaNfGruposExpandidos = {};
    limparPreviaParadasRotaOperacional();
    showLoading('Carregando', 'Montando detalhe da carga…', '');
    return fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(cd)), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || r.statusText);
          return j;
        });
      })
      .then(function (data) {
        var c = data.carga || {};
        var stExC = c.ST_EXPEDICAO != null && c.ST_EXPEDICAO !== '' ? String(c.ST_EXPEDICAO) : '';
        cargaDetalheStExpedicaoRaw = stExC;
        cargaDetalheProgramacaoBloqueada = isExpedicaoBloqueiaProgramacaoSt(stExC);
        var stMontDet =
          c.ST_CARGA_PROGRAMADA != null && c.ST_CARGA_PROGRAMADA !== '' ? c.ST_CARGA_PROGRAMADA : c.ST_CARGA;
        var nfs = data.nfes || [];
        nfesDetalheCache = nfs;
        donosCargaDetalhe = Array.isArray(data.donosCarga) ? data.donosCarga : [];
        document.getElementById('cargaDetalheMeta').innerHTML =
          '<div><strong>ID:</strong> ' +
          escapeHtml(c.CD_CARGA) +
          '</div>' +
          '<div><strong>Descrição:</strong> ' +
          escapeHtml(c.NM_DESCRICAO || '—') +
          '</div>' +
          rotuloDonosCargaDetalheHtml() +
          '<div><strong>Montagem:</strong> ' +
          escapeHtml(rotuloSituacaoCarga(stMontDet)) +
          '</div>' +
          '<div><strong>Expedição:</strong> ' +
          escapeHtml(rotuloExpedicaoLista(c.ST_EXPEDICAO != null && c.ST_EXPEDICAO !== '' ? String(c.ST_EXPEDICAO) : 'PRONTA_EXPEDICAO')) +
          '</div>' +
          '<div><strong>Criada:</strong> ' +
          escapeHtml(formatDh(c.DH_CRIACAO)) +
          '</div>';
        preencherSelectDonoDetalhe(c.CD_DONO);
        preencherSelectsDonoRomCargas();
        var modoSel = document.getElementById('modoListaNfDetalhe');
        if (modoSel) cargaDetalheModoListaNf = modoSel.value === 'plana' ? 'plana' : 'grupo';
        cargaDetalheFiltroDestino = '';
        var filtroSel = document.getElementById('filtroDetalheDestino');
        if (filtroSel) filtroSel.value = '';
        preencherSelectFiltroDestino();
        renderListaCargaNfes();
        document.getElementById('tabBtnDetalheCarga').style.display = '';
        showTab('detalhe');
        atualizarResumoRotaOperacional();
        return Promise.all([
          carregarUnidadesEmbarqueWms(),
          carregarDisponiveisParaSelect(),
          carregarResumoLogisticoCarga(cd),
        ]).then(function () {
          atualizarUiBloqueioProgramacaoDetalhe();
          if (!cargaDetalheProgramacaoBloqueada) focarBipNfCargaDetalhe();
        });
      })
      .catch(function (e) {
        cargaDetalheProgramacaoBloqueada = false;
        cargaDetalheStExpedicaoRaw = '';
        cargaDetalheCdDono = null;
        showMessage(e.message || 'Erro ao abrir carga.', 'error');
      })
      .finally(hideLoading);
  }

  document.getElementById('btnVoltarEstoque') &&
    document.getElementById('btnVoltarEstoque').addEventListener('click', function () {
      if (window.parent && typeof window.parent.loadModuleContent === 'function') {
        window.parent.loadModuleContent('estoque');
      }
    });

  document.querySelectorAll('.wms-carga-container .tabs .tab-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tab');
      if (t === 'detalhe' && !cdCargaDetalhe) return;
      showTab(t);
    });
  });

  function fecharDetalheCargaVoltarLista() {
    cdCargaDetalhe = null;
    cargaDetalheProgramacaoBloqueada = false;
    cargaDetalheStExpedicaoRaw = '';
    cargaDetalheCdDono = null;
    cargaDetalheFiltroDestino = '';
    atualizarUiBloqueioProgramacaoDetalhe();
    document.getElementById('tabBtnDetalheCarga').style.display = 'none';
    showTab('cargas');
    carregarCargas();
  }
  ['btnFecharDetalheCarga', 'btnFecharDetalheCargaIncluir'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharDetalheCargaVoltarLista);
  });

  document.getElementById('filtroDetalheDestino') &&
    document.getElementById('filtroDetalheDestino').addEventListener('change', function () {
      cargaDetalheFiltroDestino = this.value || '';
      renderListaCargaNfes();
    });
  document.getElementById('modoListaNfDetalhe') &&
    document.getElementById('modoListaNfDetalhe').addEventListener('change', function () {
      cargaDetalheModoListaNf = this.value === 'plana' ? 'plana' : 'grupo';
      renderListaCargaNfes();
    });
  document.getElementById('btnLimparFiltroDestinoNf') &&
    document.getElementById('btnLimparFiltroDestinoNf').addEventListener('click', function () {
      aplicarFiltroDestinoPorChave('');
    });
  document.getElementById('btnDestResumoExpandAll') &&
    document.getElementById('btnDestResumoExpandAll').addEventListener('click', function () {
      var host = document.getElementById('cargaResumoLogisticoDestinos');
      var raw = host && host.getAttribute('data-chaves-dest');
      var chaves = raw ? raw.split('\n').filter(Boolean) : [];
      setTodosResumoDestinosExpandidos(true, chaves);
    });
  document.getElementById('btnDestResumoCollapseAll') &&
    document.getElementById('btnDestResumoCollapseAll').addEventListener('click', function () {
      setTodosResumoDestinosExpandidos(false, []);
    });
  document.getElementById('btnTransferirDestinoNf') &&
    document.getElementById('btnTransferirDestinoNf').addEventListener('click', abrirModalTransferirDestino);
  document.getElementById('btnCancelarCargaTransferDest') &&
    document.getElementById('btnCancelarCargaTransferDest').addEventListener('click', fecharModalTransferirDestino);
  document.getElementById('btnConfirmarCargaTransferDest') &&
    document.getElementById('btnConfirmarCargaTransferDest').addEventListener('click', confirmarTransferirDestino);
  document.getElementById('cargaTransferDestModal') &&
    document.getElementById('cargaTransferDestModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'cargaTransferDestModal') fecharModalTransferirDestino();
    });

  function fecharModalRomaneioResumo() {
    var bd = document.getElementById('rsRomBackdrop');
    if (bd) bd.style.display = 'none';
  }
  function legendaLinhasRomModal(aEl) {
    return aEl && aEl.value === '1' ? 'Linhas agrupadas' : 'Linhas detalhadas';
  }
  function atualizarCrRomTituloDinamico() {
    var el = document.getElementById('crRomTituloDinamico');
    if (!el) return;
    var c = (document.getElementById('crRomConservacao') || {}).value || 'todos';
    var fEl = document.getElementById('crRomFolhas');
    var aEl = document.getElementById('crRomAgrupar');
    var f = (fEl && fEl.value) || 'nota';
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
    var uLab = legendaComboRom('crRomUnidade', 'Todas as unidades');
    var dLab = legendaComboRom('crRomDestino', 'Todos os destinos');
    el.textContent = [
      cLab,
      flab,
      legendaLinhasRomModal(aEl),
      legendaDonoRomSelect('crRomCdDono'),
      uLab,
      dLab,
      legendaComboRom('crRomCodigo', 'Todos os códigos'),
      'A4 vertical',
    ].join(' · ');
  }
  function atualizarRsRomAvisoContinuoTodosDonos() {
    var box = document.getElementById('rsRomAvisoContinuoDonos');
    if (!box) return;
    var f = (document.getElementById('rsRomFolhas') || {}).value || '';
    var d = (document.getElementById('rsRomCdDono') || {}).value || '';
    var cd = d ? parseInt(d, 10) : NaN;
    var todosDonos = !Number.isFinite(cd) || cd <= 0;
    box.style.display = f === 'continuo' && todosDonos ? 'flex' : 'none';
  }
  function atualizarRsRomTituloDinamico() {
    var el = document.getElementById('rsRomTituloDinamico');
    if (!el) return;
    var c = (document.getElementById('rsRomConservacao') || {}).value || 'todos';
    var f = (document.getElementById('rsRomFolhas') || {}).value || 'dono';
    var aEl = document.getElementById('rsRomAgrupar');
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
    var uLab = legendaComboRom('rsRomUnidade', 'Todas as unidades');
    var dLab = legendaComboRom('rsRomDestino', 'Todos os destinos');
    el.textContent = [
      cLab,
      fLab,
      legendaLinhasRomModal(aEl),
      legendaDonoRomSelect('rsRomCdDono'),
      uLab,
      dLab,
      legendaComboRom('rsRomCodigo', 'Todos os códigos'),
      'A4 vertical',
    ].join(' · ');
    atualizarRsRomAvisoContinuoTodosDonos();
  }
  function abrirModalRomaneioResumo() {
    if (!cdCargaDetalhe || !Number.isFinite(cdCargaDetalhe)) {
      showMessage('Abra o detalhe de uma carga antes de imprimir.', 'warning');
      return;
    }
    var bd = document.getElementById('rsRomBackdrop');
    if (bd) bd.style.display = 'flex';
    preencherSelectsDonoRomCargas();
    atualizarRsRomTituloDinamico();
  }
  function getRomaneioResumoOrdem() {
    var ordem = [];
    for (var i = 1; i <= 5; i++) {
      var el = document.getElementById('rsRomOrd' + i);
      if (!el) continue;
      var v = (el.value || '').trim();
      if (!v) continue;
      if (ordem.indexOf(v) >= 0) continue;
      ordem.push(v);
    }
    return ordem;
  }
  function gerarRomaneioResumoComOpcoes() {
    if (!cdCargaDetalhe || !Number.isFinite(cdCargaDetalhe)) return;
    var cEl = document.getElementById('rsRomConservacao');
    var aEl = document.getElementById('rsRomAgrupar');
    var fEl = document.getElementById('rsRomFolhas');
    var dEl = document.getElementById('rsRomCdDono');
    var ordem = getRomaneioResumoOrdem();
    var q = new URLSearchParams();
    q.set('format', 'html');
    q.set('conservacao', cEl && cEl.value ? cEl.value : 'todos');
    q.set('agruparItens', aEl && aEl.value === '1' ? '1' : '0');
    q.set('folhas', fEl && fEl.value ? fEl.value : 'dono');
    var cdDono = dEl && dEl.value ? parseInt(dEl.value, 10) : NaN;
    if (Number.isFinite(cdDono) && cdDono > 0) q.set('cdDono', String(cdDono));
    if (ordem.length) q.set('ordem', ordem.join(','));
    appendFiltrosGeoRomQuery(q, 'rsRom');
    fecharModalRomaneioResumo();
    abrirImpressaoHtml(
      '/api/wms/cargas/programadas/' + encodeURIComponent(String(cdCargaDetalhe)) + '/romaneio?' + q.toString()
    );
  }
  document.getElementById('btnImprimirResumoCarga') &&
    document.getElementById('btnImprimirResumoCarga').addEventListener('click', abrirModalRomaneioResumo);
  document.getElementById('btnRsRomFechar') &&
    document.getElementById('btnRsRomFechar').addEventListener('click', fecharModalRomaneioResumo);
  document.getElementById('btnRsRomGerar') &&
    document.getElementById('btnRsRomGerar').addEventListener('click', gerarRomaneioResumoComOpcoes);
  document.getElementById('rsRomBackdrop') &&
    document.getElementById('rsRomBackdrop').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'rsRomBackdrop') fecharModalRomaneioResumo();
    });
  function getRomaneioFriosOrdem() {
    var ordem = [];
    for (var i = 1; i <= 5; i++) {
      var el = document.getElementById('crRomOrd' + i);
      if (!el) continue;
      var v = (el.value || '').trim();
      if (!v) continue;
      if (ordem.indexOf(v) >= 0) continue;
      ordem.push(v);
    }
    return ordem;
  }

  function fecharModalRomaneioFrios() {
    var bd = document.getElementById('crRomBackdrop');
    if (bd) bd.style.display = 'none';
  }

  function abrirModalRomaneioFrios() {
    if (!cdCargaDetalhe || !Number.isFinite(cdCargaDetalhe)) {
      showMessage('Abra o detalhe de uma carga antes de imprimir.', 'warning');
      return;
    }
    var bd = document.getElementById('crRomBackdrop');
    if (bd) bd.style.display = 'flex';
    preencherSelectsDonoRomCargas();
    atualizarCrRomTituloDinamico();
  }

  function gerarRomaneioFriosComOpcoes() {
    if (!cdCargaDetalhe || !Number.isFinite(cdCargaDetalhe)) return;
    var cEl = document.getElementById('crRomConservacao');
    var aEl = document.getElementById('crRomAgrupar');
    var fEl = document.getElementById('crRomFolhas');
    var dEl = document.getElementById('crRomCdDono');
    var ordem = getRomaneioFriosOrdem();
    var q = new URLSearchParams();
    q.set('conservacao', cEl && cEl.value ? cEl.value : 'todos');
    q.set('agruparItens', aEl && aEl.value === '1' ? '1' : '0');
    q.set('folhas', fEl && fEl.value ? fEl.value : 'nota');
    var cdDono = dEl && dEl.value ? parseInt(dEl.value, 10) : NaN;
    if (Number.isFinite(cdDono) && cdDono > 0) q.set('cdDono', String(cdDono));
    if (ordem.length) q.set('ordem', ordem.join(','));
    appendFiltrosGeoRomQuery(q, 'crRom');
    fecharModalRomaneioFrios();
    abrirImpressaoHtml(
      '/api/wms/cargas/programadas/' +
        encodeURIComponent(String(cdCargaDetalhe)) +
        '/relatorios/frios?' +
        q.toString()
    );
  }

  document.getElementById('btnImprimirFriosCarga') &&
    document.getElementById('btnImprimirFriosCarga').addEventListener('click', abrirModalRomaneioFrios);
  document.getElementById('btnCrRomFechar') &&
    document.getElementById('btnCrRomFechar').addEventListener('click', fecharModalRomaneioFrios);
  document.getElementById('btnCrRomGerar') &&
    document.getElementById('btnCrRomGerar').addEventListener('click', gerarRomaneioFriosComOpcoes);
  document.getElementById('crRomBackdrop') &&
    document.getElementById('crRomBackdrop').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'crRomBackdrop') fecharModalRomaneioFrios();
    });

  [
    'crRomConservacao',
    'crRomAgrupar',
    'crRomFolhas',
    'crRomCdDono',
    'crRomUnidade',
    'crRomDestino',
    'crRomCodigo',
    'crRomOrd1',
    'crRomOrd2',
    'crRomOrd3',
    'crRomOrd4',
    'crRomOrd5',
  ].forEach(
    function (id) {
      var n = document.getElementById(id);
      if (n) n.addEventListener('change', atualizarCrRomTituloDinamico);
    }
  );
  [
    'rsRomConservacao',
    'rsRomAgrupar',
    'rsRomFolhas',
    'rsRomCdDono',
    'rsRomUnidade',
    'rsRomDestino',
    'rsRomCodigo',
    'rsRomOrd1',
    'rsRomOrd2',
    'rsRomOrd3',
    'rsRomOrd4',
    'rsRomOrd5',
  ].forEach(function (id) {
    var n = document.getElementById(id);
    if (n) n.addEventListener('change', atualizarRsRomTituloDinamico);
  });
  ['crRom', 'rsRom'].forEach(function (prefix) {
    var selU = document.getElementById(prefix + 'Unidade');
    if (selU) {
      selU.addEventListener('change', function () {
        aplicarFiltroDestinoRomCargas(prefix);
        if (prefix === 'crRom') atualizarCrRomTituloDinamico();
        else atualizarRsRomTituloDinamico();
      });
    }
  });

  document.getElementById('btnImportarNfSaida') &&
    document.getElementById('btnImportarNfSaida').addEventListener('click', function () {
      var inp = document.getElementById('impSaidaArquivo');
      var dono = document.getElementById('impSaidaCdDono');
      if (!inp || !inp.files || !inp.files.length) {
        showMessage('Selecione ao menos um XML.', 'error');
        return;
      }
      var fd = new FormData();
      Array.from(inp.files).forEach(function (f) {
        fd.append('arquivos', f);
      });
      if (dono && dono.value) fd.append('cd_dono', dono.value);
      showLoading('Importando', 'Enviando XML(s)…', String(inp.files.length) + ' arquivo(s) selecionado(s)');
      fetch('/api/wms/cargas/nfes-saida/importar-xml', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (resp) {
          var itensPend = coletarItensPendenciaEndereco(resp);
          if (resp && resp.totalArquivos != null) {
            var msg = 'Importação concluída: ' + resp.importados + ' de ' + resp.totalArquivos + ' XML(s).';
            if (resp.comErro) msg += ' Com erro: ' + resp.comErro + '.';
            if (resp.comErro && Array.isArray(resp.erros) && resp.erros[0] && resp.erros[0].error) {
              msg += ' Exemplo: ' + resp.erros[0].arquivo + ' - ' + resp.erros[0].error;
            }
            if (itensPend.length) {
              msg +=
                ' ' +
                itensPend.length +
                ' nota(s) com cadastro de entrega a completar — use o painel que abrirá em seguida.';
            }
            showMessage(msg, resp.comErro ? 'warning' : itensPend.length ? 'warning' : 'success');
            if (itensPend.length) {
              setTimeout(function () {
                abrirModalPendenciasEnderecoImportacao(itensPend, {
                  importados: resp.importados,
                  totalArquivos: resp.totalArquivos,
                });
              }, 350);
            }
          } else {
            var msgUm = 'NF de saída importada.';
            if (itensPend.length) {
              msgUm += ' Cadastro de entrega incompleto — complete rota e coordenadas.';
            }
            showMessage(msgUm, itensPend.length ? 'warning' : 'success');
            if (itensPend.length) {
              setTimeout(function () {
                abrirModalPendenciasEnderecoImportacao(itensPend, null);
              }, 350);
            }
          }
          inp.value = '';
          return carregarNfSaida();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro na importação.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('btnAtualizarListaNf') &&
    document.getElementById('btnAtualizarListaNf').addEventListener('click', function () {
      carregarNfSaida();
    });
  document.getElementById('btnFiltrarNf') &&
    document.getElementById('btnFiltrarNf').addEventListener('click', function () {
      carregarNfSaida();
    });
  document.getElementById('btnLimparFiltroNf') &&
    document.getElementById('btnLimparFiltroNf').addEventListener('click', function () {
      var dono = document.getElementById('filtroNfCdDono');
      var a = document.getElementById('filtroNfEmCarga');
      var b = document.getElementById('filtroNfEmissaoDe');
      var c = document.getElementById('filtroNfEmissaoAte');
      var d = document.getElementById('filtroNfNumero');
      var e = document.getElementById('filtroNfSerie');
      var f = document.getElementById('filtroNfPedido');
      var g = document.getElementById('filtroNfCodigoProd');
      var h = document.getElementById('filtroNfDescProd');
      var i = document.getElementById('filtroNfSaidaDe');
      var j = document.getElementById('filtroNfSaidaAte');
      if (dono) dono.value = '';
      if (a) a.value = '';
      if (b) b.value = '';
      if (c) c.value = '';
      if (d) d.value = '';
      if (e) e.value = '';
      if (f) f.value = '';
      if (g) g.value = '';
      if (h) h.value = '';
      if (i) i.value = '';
      if (j) j.value = '';
      var pend = document.getElementById('filtroNfCadPendente');
      if (pend) pend.checked = false;
      carregarNfSaida();
    });
  document.getElementById('filtroNfCadPendente') &&
    document.getElementById('filtroNfCadPendente').addEventListener('change', function () {
      carregarNfSaida();
    });
  ['btnFecharNfEePendenteModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharModalPendenciasEnderecoImportacao);
  });
  document.getElementById('nfEnderecoPendenteModal') &&
    document.getElementById('nfEnderecoPendenteModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'nfEnderecoPendenteModal') fecharModalPendenciasEnderecoImportacao();
    });
  document.getElementById('btnNfEeCompletarPrimeiro') &&
    document.getElementById('btnNfEeCompletarPrimeiro').addEventListener('click', function () {
      var primeiroIdx = -1;
      var primeiro = null;
      nfEePendentesUltimaImportacao.forEach(function (x, i) {
        if (primeiroIdx < 0 && x.link && x.link.cdCadastro != null) {
          primeiroIdx = i;
          primeiro = x;
        }
      });
      if (primeiro && primeiro.link) {
        abrirCadastroEnderecoEntrega(primeiro.link, { indice: primeiroIdx, nf: primeiro.nf, serie: primeiro.serie });
      }
    });
  document.getElementById('btnAbrirNfEePendentes') &&
    document.getElementById('btnAbrirNfEePendentes').addEventListener('click', function () {
      abrirPainelPendenciasEnderecoAtual();
    });
  document.getElementById('btnNfEeFiltrarListaPendentes') &&
    document.getElementById('btnNfEeFiltrarListaPendentes').addEventListener('click', function () {
      var chk = document.getElementById('filtroNfCadPendente');
      if (chk) chk.checked = true;
      fecharModalPendenciasEnderecoImportacao();
      carregarNfSaida();
    });
  document.getElementById('btnFecharNfDetalhe') &&
    document.getElementById('btnFecharNfDetalhe').addEventListener('click', function () {
      var modal = document.getElementById('nfDetalheModal');
      if (modal) modal.style.display = 'none';
    });
  document.getElementById('btnCopiarChaveNfDetalhe') &&
    document.getElementById('btnCopiarChaveNfDetalhe').addEventListener('click', function () {
      var ch = this.getAttribute('data-chave') || '';
      copiarTextoParaClipboard(ch, 'Chave da NF-e copiada (44 dígitos).');
    });
  document.getElementById('nfDetalheModal') &&
    document.getElementById('nfDetalheModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'nfDetalheModal') ev.currentTarget.style.display = 'none';
    });

  document.getElementById('btnCriarCarga') &&
    document.getElementById('btnCriarCarga').addEventListener('click', function () {
      var desc = document.getElementById('novaCargaDesc');
      var dono = document.getElementById('novaCargaDono');
      var descVal = desc && desc.value ? String(desc.value).trim() : '';
      if (!descVal) {
        showMessage('Descrição da carga é obrigatória.', 'error');
        return;
      }
      var body = { NM_DESCRICAO: descVal };
      if (dono && dono.value) {
        var cdDono = parseInt(dono.value, 10);
        if (!Number.isFinite(cdDono)) {
          showMessage('Dono do estoque inválido.', 'error');
          return;
        }
        body.CD_DONO = cdDono;
      }
      showLoading('Salvando', 'Criando carga…', '');
      fetch('/api/wms/cargas/programadas', {
        method: 'POST',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (row) {
          showMessage(
            'Carga criada. Bipe as NF-e no detalhe — o dono vem de cada nota (emitente na importação).',
            'success'
          );
          if (desc) desc.value = '';
          if (dono) dono.value = '';
          cargaFiltroState.page = 1;
          return carregarCargas().then(function () {
            if (row && row.CD_CARGA) abrirDetalheCarga(row.CD_CARGA);
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao criar carga.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('formFiltroCargas') &&
    document.getElementById('formFiltroCargas').addEventListener('submit', function (e) {
      e.preventDefault();
      lerFormularioFiltroCargasParaEstado();
      cargaFiltroState.page = 1;
      carregarCargas();
    });
  document.getElementById('btnFiltroCargasLimpar') &&
    document.getElementById('btnFiltroCargasLimpar').addEventListener('click', function () {
      limparFiltrosCargas();
    });
  document.getElementById('btnAtualizarCargas') &&
    document.getElementById('btnAtualizarCargas').addEventListener('click', function () {
      lerFormularioFiltroCargasParaEstado();
      carregarCargas();
    });

  document.getElementById('btnAdicionarNfCarga') &&
    document.getElementById('btnAdicionarNfCarga').addEventListener('click', function () {
      if (!cdCargaDetalhe) return;
      var sel = document.getElementById('selNfDisponivel');
      var v = sel && sel.value ? parseInt(sel.value, 10) : NaN;
      if (!Number.isFinite(v)) {
        showMessage('Selecione uma NF disponível.', 'error');
        return;
      }
      adicionarNfNaCarga(v)
        .catch(function (e) {
          showMessage(e.message || 'Erro ao vincular.', 'error');
        });
    });

  document.getElementById('btnBiparNfCarga') &&
    document.getElementById('btnBiparNfCarga').addEventListener('click', function () {
      if (!cdCargaDetalhe) return;
      var input = document.getElementById('inputChaveNfCarga');
      var chave = normalizeChaveNfe(input && input.value);
      if (!chave || chave.length < 44) {
        showMessage('Bipe/digite a chave completa da NF-e (44 dígitos).', 'error', null, 'inputChaveNfCarga');
        return;
      }
      var nf = encontrarDisponivelPorChave(chave);
      if (!nf || !Number.isFinite(parseInt(nf.CD_NFE_SAIDA, 10))) {
        showMessage(
          'Chave não encontrada entre as NF-e disponíveis para esta carga.',
          'error',
          null,
          'inputChaveNfCarga'
        );
        return;
      }
      var sel = document.getElementById('selNfDisponivel');
      if (sel) sel.value = String(nf.CD_NFE_SAIDA);
      adicionarNfNaCarga(parseInt(nf.CD_NFE_SAIDA, 10))
        .then(function () {
          if (input) input.value = '';
          return carregarNfSaida();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao vincular pela chave.', 'error');
        });
    });

  document.getElementById('inputChaveNfCarga') &&
    document.getElementById('inputChaveNfCarga').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var b = document.getElementById('btnBiparNfCarga');
        if (b) b.click();
      }
    });

  document.getElementById('btnSalvarCargaEditModal') &&
    document.getElementById('btnSalvarCargaEditModal').addEventListener('click', function () {
      var id = cargaEditState.id;
      var input = document.getElementById('cargaEditDescricao');
      var selDono = document.getElementById('cargaEditDono');
      var novo = String((input && input.value) || '').trim();
      if (!Number.isFinite(id)) return;
      if (!novo) {
        showMessage('Descrição da carga é obrigatória.', 'error');
        if (input) input.focus();
        return;
      }
      var cdDonoBody = null;
      if (selDono && selDono.value) {
        var nD = parseInt(selDono.value, 10);
        if (!Number.isFinite(nD)) {
          showMessage('Dono do estoque inválido.', 'error');
          return;
        }
        cdDonoBody = nD;
      }
      fecharModalEditarCarga();
      showLoading('Salvando', 'Atualizando carga…', '');
      fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(id)), {
        method: 'PUT',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ NM_DESCRICAO: novo, CD_DONO: cdDonoBody }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function () {
          showMessage('Carga atualizada.', 'success');
          return carregarCargas().then(function () {
            if (cdCargaDetalhe === id) return abrirDetalheCarga(id);
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao atualizar carga.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('btnSalvarDonoCargaDetalhe') &&
    document.getElementById('btnSalvarDonoCargaDetalhe').addEventListener('click', function () {
      if (!Number.isFinite(cdCargaDetalhe)) return;
      if (cargaDetalheProgramacaoBloqueada) {
        showMessage('Programação bloqueada: não é possível alterar o dono agora.', 'warning');
        return;
      }
      var sel = document.getElementById('detalheCargaDono');
      var cdDono = null;
      if (sel && sel.value) {
        var n = parseInt(sel.value, 10);
        if (!Number.isFinite(n)) {
          showMessage('Dono inválido.', 'error');
          return;
        }
        cdDono = n;
      }
      salvarDonoCargaProgramada(cdCargaDetalhe, cdDono)
        .then(function () {
          showMessage(
            cdDono == null
              ? 'Dono da carga limpo (rota mista / pelas NF). Atualize a expedição se estiver aberta.'
              : 'Dono da carga salvo. Atualize a expedição se estiver aberta.',
            'success'
          );
          return abrirDetalheCarga(cdCargaDetalhe);
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao salvar dono.', 'error');
        });
    });

  document.getElementById('btnAlinharDonoCargaNf') &&
    document.getElementById('btnAlinharDonoCargaNf').addEventListener('click', function () {
      if (!Number.isFinite(cdCargaDetalhe)) return;
      if (cargaDetalheProgramacaoBloqueada) {
        showMessage('Programação bloqueada: não é possível alterar o dono agora.', 'warning');
        return;
      }
      var cds = cdsDonoNfDetalheUnicos();
      if (!cds.length) {
        showMessage('Não há NF na carga para alinhar o dono. Bipe as notas primeiro.', 'warning');
        return;
      }
      if (cds.length > 1) {
        showMessage(
          'Há vários donos nas NF. Use «— Rota mista / definir pelas NF —» e Salvar dono, ou separe as cargas.',
          'warning'
        );
        return;
      }
      salvarDonoCargaProgramada(cdCargaDetalhe, cds[0])
        .then(function () {
          showMessage(
            'Dono da carga alinhado às NF. Volte à Expedição e atualize a validação.',
            'success'
          );
          return abrirDetalheCarga(cdCargaDetalhe);
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao alinhar dono.', 'error');
        });
    });

  document.getElementById('detalheCargaDono') &&
    document.getElementById('detalheCargaDono').addEventListener('change', function () {
      atualizarAvisoDonoCargaDetalhe();
    });

  document.getElementById('btnConfirmarCargaDeleteModal') &&
    document.getElementById('btnConfirmarCargaDeleteModal').addEventListener('click', function () {
      var id = cargaDeleteState.id;
      if (!Number.isFinite(id)) return;
      fecharModalExcluirCarga();
      showLoading('Excluindo', 'Removendo carga…', '');
      fetch('/api/wms/cargas/programadas/' + encodeURIComponent(String(id)), {
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
          showMessage('Carga excluída.', 'success');
          return carregarCargas();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao excluir carga.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('btnConfirmarNfRemoveModal') &&
    document.getElementById('btnConfirmarNfRemoveModal').addEventListener('click', function () {
      var idNfe = nfRemoveState.idNfe;
      if (!Number.isFinite(idNfe) || !Number.isFinite(cdCargaDetalhe)) return;
      fecharModalRemoverNf();
      showLoading('Removendo', 'Aguarde…', '');
      fetch(
        '/api/wms/cargas/programadas/' +
          encodeURIComponent(String(cdCargaDetalhe)) +
          '/nfes/' +
          encodeURIComponent(String(idNfe)),
        { method: 'DELETE', headers: getAuthHeaders() }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function () {
          showMessage('NF removida da carga.', 'success');
          return abrirDetalheCarga(cdCargaDetalhe).then(function () {
            return carregarNfSaida();
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro.', 'error');
        })
        .finally(hideLoading);
    });

  ['btnFecharCargaEditModal', 'btnCancelarCargaEditModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharModalEditarCarga);
  });
  ['btnFecharCargaDeleteModal', 'btnCancelarCargaDeleteModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharModalExcluirCarga);
  });
  document.getElementById('cargaEditModal') &&
    document.getElementById('cargaEditModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'cargaEditModal') fecharModalEditarCarga();
    });
  document.getElementById('cargaDeleteModal') &&
    document.getElementById('cargaDeleteModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'cargaDeleteModal') fecharModalExcluirCarga();
    });
  ['btnFecharNfRemoveModal', 'btnCancelarNfRemoveModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharModalRemoverNf);
  });
  document.getElementById('nfRemoveModal') &&
    document.getElementById('nfRemoveModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'nfRemoveModal') fecharModalRemoverNf();
    });

  document.getElementById('btnExcluirNfDetalhe') &&
    document.getElementById('btnExcluirNfDetalhe').addEventListener('click', function () {
      if (!Number.isFinite(nfDetalheCdAtual)) return;
      var lbl = this.getAttribute('data-label') || String(nfDetalheCdAtual);
      abrirModalExcluirNf(nfDetalheCdAtual, lbl);
    });
  document.getElementById('btnConfirmarNfExcluirModal') &&
    document.getElementById('btnConfirmarNfExcluirModal').addEventListener('click', function () {
      var idNfe = nfExcluirState.idNfe;
      if (!Number.isFinite(idNfe)) return;
      fecharModalExcluirNf();
      executarExcluirNfImportada(idNfe);
    });
  ['btnFecharNfExcluirModal', 'btnCancelarNfExcluirModal'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fecharModalExcluirNf);
  });
  document.getElementById('nfExcluirModal') &&
    document.getElementById('nfExcluirModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'nfExcluirModal') fecharModalExcluirNf();
    });

  document.getElementById('btnResumoProgramacaoCargas') &&
    document.getElementById('btnResumoProgramacaoCargas').addEventListener('click', function () {
      abrirResumoProgramacaoCargas();
    });
  document.getElementById('btnExportarNfCargas') &&
    document.getElementById('btnExportarNfCargas').addEventListener('click', function () {
      baixarArquivoAutenticado(montarQueryExportNfCargas(), 'wms-cargas-nf.csv');
    });
  document.getElementById('btnExportarNfImportadas') &&
    document.getElementById('btnExportarNfImportadas').addEventListener('click', function () {
      baixarArquivoAutenticado(
        '/api/wms/cargas/nfes-saida/export.csv' + buildNfQueryString(),
        'wms-nf-importadas.csv'
      );
    });
  document.getElementById('btnResumoEmbarcadas') &&
    document.getElementById('btnResumoEmbarcadas').addEventListener('click', function () {
      abrirResumoProgramacaoCargas('EXPEDIDA');
    });
  document.getElementById('btnMesclarCargas') &&
    document.getElementById('btnMesclarCargas').addEventListener('click', function () {
      abrirModalMesclarCarga();
    });
  document.getElementById('btnDistribuirNfRota') &&
    document.getElementById('btnDistribuirNfRota').addEventListener('click', abrirModalDistribuirNfRota);
  document.getElementById('btnConfirmarDistribuirNfModal') &&
    document.getElementById('btnConfirmarDistribuirNfModal').addEventListener('click', function () {
      if (!ultimoPlanoDistribuirNf || !ultimoPlanoDistribuirNf.podeAplicar) {
        showMessage('Nada a distribuir ou conflitos pendentes.', 'warning');
        return;
      }
      var qs = montarQueryDistribuirNfRota();
      fecharModalDistribuirNf();
      showLoading('Distribuindo', 'Vinculando NF-e às cargas…', '');
      fetch('/api/wms/cargas/programadas/distribuir-nf-rota?' + qs.toString(), {
        method: 'POST',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: '{}',
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (resp) {
          var n = resp && resp.vinculadas != null ? resp.vinculadas : 0;
          showMessage(n + ' NF-e vinculada(s) às cargas por rota cadastrada.', n > 0 ? 'success' : 'warning');
          cargaFiltroState.page = 1;
          return carregarCargas();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao distribuir NF-e.', 'error');
        })
        .finally(hideLoading);
    });
  document.getElementById('btnCancelarDistribuirNfModal') &&
    document.getElementById('btnCancelarDistribuirNfModal').addEventListener('click', fecharModalDistribuirNf);
  document.getElementById('cargaDistribuirNfModal') &&
    document.getElementById('cargaDistribuirNfModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'cargaDistribuirNfModal') fecharModalDistribuirNf();
    });
  ['cargaMergeOrigem', 'cargaMergeDestino'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', atualizarResumoMesclar);
  });
  document.querySelectorAll('#cargaMergeModal input[name="cargaMergeDesc"]').forEach(function (r) {
    r.addEventListener('change', atualizarResumoMesclar);
  });
  document.getElementById('btnConfirmarCargaMergeModal') &&
    document.getElementById('btnConfirmarCargaMergeModal').addEventListener('click', function () {
      var selO = document.getElementById('cargaMergeOrigem');
      var selD = document.getElementById('cargaMergeDestino');
      if (!selO || !selD) return;
      var ido = parseInt(selO.value, 10);
      var idd = parseInt(selD.value, 10);
      if (!Number.isFinite(ido) || !Number.isFinite(idd)) {
        showMessage('Selecione origem e destino.', 'error');
        return;
      }
      if (ido === idd) {
        showMessage('Origem e destino devem ser cargas diferentes.', 'error');
        return;
      }
      var org = null;
      for (var i = 0; i < ultimaListaCargas.length; i++) {
        if (Number(ultimaListaCargas[i].CD_CARGA) === ido) {
          org = ultimaListaCargas[i];
          break;
        }
      }
      if (!org || Number(org.Q_NFES || 0) <= 0) {
        showMessage('A carga de origem precisa ter ao menos uma NF-e.', 'error');
        return;
      }
      var modoEl = document.querySelector('#cargaMergeModal input[name="cargaMergeDesc"]:checked');
      var modoDescricao = modoEl ? modoEl.value : 'manter_destino';
      fecharModalMesclarCarga();
      showLoading('Mesclando', 'Unindo cargas…', '');
      fetch('/api/wms/cargas/programadas/mesclar', {
        method: 'POST',
        headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          CD_CARGA_ORIGEM: ido,
          CD_CARGA_DESTINO: idd,
          modoDescricao: modoDescricao,
        }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (resp) {
          var n = resp && resp.NF_MOVidas != null ? resp.NF_MOVidas : '?';
          showMessage('Cargas mescladas: ' + n + ' NF-e movidas para a carga #' + idd + '.', 'success');
          cargaFiltroState.page = 1;
          var det = cdCargaDetalhe;
          return carregarCargas().then(function () {
            if (det === ido || det === idd) {
              return abrirDetalheCarga(idd);
            }
          });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao mesclar cargas.', 'error');
        })
        .finally(hideLoading);
    });
  document.getElementById('btnCancelarCargaMergeModal') &&
    document.getElementById('btnCancelarCargaMergeModal').addEventListener('click', fecharModalMesclarCarga);
  document.getElementById('cargaMergeModal') &&
    document.getElementById('cargaMergeModal').addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'cargaMergeModal') fecharModalMesclarCarga();
    });

  document.getElementById('btnWmsPlanejarParadas') &&
    document.getElementById('btnWmsPlanejarParadas').addEventListener('click', function () {
      if (!cdCargaDetalhe) {
        showMessage('Abra o detalhe de uma carga antes.', 'warning');
        return;
      }
      if (cargaDetalheProgramacaoBloqueada) {
        showMessage('Montar paradas não está disponível com expedição em andamento ou carga expedida.', 'warning');
        return;
      }
      showLoading('Planejando', 'Montando paradas a partir das NF-e…', '');
      fetch(
        '/api/wms/cargas/programadas/' +
          encodeURIComponent(String(cdCargaDetalhe)) +
          '/rota-operacional/planejar-paradas',
        { method: 'POST', headers: getAuthHeaders() }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (j) {
          var ps = j.paradas || [];
          var pend = ps.filter(function (p) {
            return String(p.MATCH_STATUS || '').toUpperCase() !== 'OK';
          });
          renderPreviaParadasRotaOperacional(j);
          showMessage(
            'Paradas: ' +
              String(j.qParadas || ps.length) +
              ' (NF-e: ' +
              String(j.qNfes || '') +
              '). Pendentes de match/coord: ' +
              String(pend.length) +
              '.' +
              (pend.length ? ' Veja o quadro de prévia logo abaixo dos botões.' : ''),
            pend.length ? 'warning' : 'success'
          );
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao planejar paradas.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('wmsRotaUnidadeEmbarque') &&
    document.getElementById('wmsRotaUnidadeEmbarque').addEventListener('change', function () {
      var sel = document.getElementById('wmsRotaUnidadeEmbarque');
      var coordEl = document.getElementById('wmsRotaOrigemCoord');
      var labelEl = document.getElementById('wmsRotaOrigemLabel');
      if (!sel || !coordEl) return;
      var opt = sel.options[sel.selectedIndex];
      if (!sel.value || !opt) {
        coordEl.readOnly = false;
        return;
      }
      var la = opt.getAttribute('data-lat');
      var lo = opt.getAttribute('data-lon');
      if (la && lo) coordEl.value = String(la).trim() + ', ' + String(lo).trim();
      else coordEl.value = '';
      if (labelEl && opt.getAttribute('data-label')) labelEl.value = opt.getAttribute('data-label');
      coordEl.readOnly = true;
    });
  document.getElementById('wmsRotaOrigemCoord') &&
    document.getElementById('wmsRotaOrigemCoord').addEventListener('input', function () {
      var sel = document.getElementById('wmsRotaUnidadeEmbarque');
      if (sel) sel.value = '';
      this.readOnly = false;
    });

  document.getElementById('btnWmsCalcularRota') &&
    document.getElementById('btnWmsCalcularRota').addEventListener('click', function () {
      if (!cdCargaDetalhe) {
        showMessage('Abra o detalhe de uma carga antes.', 'warning');
        return;
      }
      var coordEl = document.getElementById('wmsRotaOrigemCoord');
      var labelEl = document.getElementById('wmsRotaOrigemLabel');
      var retEl = document.getElementById('wmsRotaRetornaOrigem');
      var selUn = document.getElementById('wmsRotaUnidadeEmbarque');
      var coord = coordEl ? String(coordEl.value || '').trim() : '';
      var cdEmb = selUn && selUn.value ? parseInt(selUn.value, 10) : NaN;
      var body = {
        originLabel: labelEl ? String(labelEl.value || '').trim() : '',
        returnToStart: retEl ? String(retEl.value || 'S') : 'S',
      };
      if (Number.isFinite(cdEmb) && cdEmb > 0) {
        body.cdCadastroEmbarque = cdEmb;
      } else {
        if (!coord) {
          showMessage('Informe latitude e longitude ou selecione uma unidade de negócio no campo acima.', 'error');
          return;
        }
        var chkCoord = parseOrigemCoordManual(coord);
        if (chkCoord.erro) {
          showMessage(chkCoord.erro, 'error');
          return;
        }
        body.originCoordenadas = coord;
      }
      showLoading('Roteando', 'Calculando rota (OSRM)…', '');
      fetch(
        '/api/wms/cargas/programadas/' +
          encodeURIComponent(String(cdCargaDetalhe)) +
          '/rota-operacional/calcular',
        {
          method: 'POST',
          headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (j) {
          var modo = j.otimizacao === 'TSP_OSRM' ? 'TSP' : 'cluster município';
          showMessage(
            'Rota salva (v' +
              String((j.rota && (j.rota.VERSAO || j.rota.versao)) || '') +
              '). Distância: ' +
              fmtKmDeMetros(j.distanciaM) +
              ' · Tempo: ' +
              fmtMinDeSegundos(j.duracaoS) +
              ' · Ordem: ' +
              modo +
              '.',
            'success'
          );
          atualizarResumoRotaOperacional();
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao calcular rota.', 'error');
        })
        .finally(hideLoading);
    });

  document.getElementById('btnWmsGerarViagemRascunho') &&
    document.getElementById('btnWmsGerarViagemRascunho').addEventListener('click', function () {
      if (!cdCargaDetalhe) {
        showMessage('Abra o detalhe de uma carga antes.', 'warning');
        return;
      }
      var idLista = idViagemListaCargaAtual(cdCargaDetalhe);
      if (idLista) {
        showMessage(
          'Esta carga já possui viagem nº ' +
            idLista +
            '. Cancele-a em Gerenciar Viagens (situação Cancelada) antes de gerar outra.',
          'error'
        );
        return;
      }
      showLoading('Viagem', 'Gerando viagem rascunho…', '');
      fetch(
        '/api/wms/cargas/programadas/' +
          encodeURIComponent(String(cdCargaDetalhe)) +
          '/viagem-rascunho',
        { method: 'POST', headers: Object.assign(getAuthHeaders(), { 'Content-Type': 'application/json' }), body: '{}' }
      )
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || r.statusText);
            return j;
          });
        })
        .then(function (j) {
          var idv = j && j.IDVIAGEM != null ? String(j.IDVIAGEM) : '';
          var msg = j && j.message ? String(j.message) : 'Viagem criada.';
          if (idv) msg += ' ID #' + idv + '.';
          showMessage(msg, 'success');
          var loadMod =
            window.parent && typeof window.parent.loadModuleContent === 'function'
              ? window.parent.loadModuleContent.bind(window.parent)
              : typeof window.loadModuleContent === 'function'
                ? window.loadModuleContent
                : null;
          if (idv && loadMod) {
            try {
              loadMod('gerenciar-viagens', { idViagem: idv });
            } catch (e2) {
              console.warn('[WMS] loadModuleContent gerenciar-viagens:', e2);
            }
          }
          atualizarResumoRotaOperacional();
          return carregarCargas({ silent: true });
        })
        .catch(function (e) {
          showMessage(e.message || 'Erro ao gerar viagem.', 'error');
        })
        .finally(hideLoading);
    });

  normalizeImportInputMode();
  carregarDonos().then(function () {
    return carregarNfSaida();
  });
  carregarCargas();
})();
