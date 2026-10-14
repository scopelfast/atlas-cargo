(function () {
  var chartInst = null;
  var ultimasLinhasPosicao = [];
  var ultimaAuditoriaUm = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function getAuthHeaders() {
    var h = {};
    var t = localStorage.getItem('token');
    if (t) h.Authorization = 'Bearer ' + t;
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) h['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return h;
  }

  function corrigirUrl(path) {
    if (typeof window.corrigirUrl === 'function') return window.corrigirUrl(path);
    return path;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoeda(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + '%';
  }

  function fmtQtd(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }

  function fmtDataBr(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function fmtDataChart(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return String(iso);
    return p[2] + '/' + p[1];
  }

  function statCard(tipo, icon, titulo, valor, sub, extraCls, extraAttr) {
    return (
      '<div class="dashboard-stat-card ' +
      (tipo || 'info') +
      (extraCls ? ' ' + extraCls : '') +
      '"' +
      (extraAttr || '') +
      '>' +
      '<div class="stat-card-icon"><i class="bx ' +
      icon +
      '"></i></div>' +
      '<div class="stat-card-content">' +
      '<h4>' +
      esc(titulo) +
      '</h4>' +
      '<p class="stat-value">' +
      esc(valor) +
      '</p>' +
      '<span class="stat-label">' +
      esc(sub) +
      '</span></div></div>'
    );
  }

  function showMessage(text, type) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, byId('message'));
      return;
    }
    var el = byId('message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (type || '');
    el.style.display = text ? 'block' : 'none';
  }

  function showLoadingOverlay(titulo, texto, det) {
    var o = byId('loadingOverlay');
    if (!o) return;
    var a = byId('loadingTitle');
    var b = byId('loadingText');
    var c = byId('loadingDetalhe');
    if (a) a.textContent = titulo || 'Carregando';
    if (b) b.textContent = texto || 'Aguarde…';
    if (c) c.textContent = det || '';
    o.style.display = 'flex';
  }

  function hideLoadingOverlay() {
    var o = byId('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  async function yieldPaint() {
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
  }

  function hojeIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function labelFonte(f) {
    var t = String(f || '').toUpperCase();
    if (t === 'NF_ENTRADA') return 'NF (entrada)';
    if (t === 'VALOR_REFERENCIA') return 'Cadastro';
    if (t === 'SEM_PRECO') return 'Sem preço';
    if (t === 'SEM_CADASTRO') return 'Sem cadastro';
    return f || '—';
  }

  function confirmar(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var modal = document.getElementById('confirmModal');
      var msg = document.getElementById('modalMessage');
      var title = document.getElementById('confirmModalTitle');
      var yes = document.getElementById('confirmYes');
      var no = document.getElementById('confirmNo');
      if (!modal || !msg || !yes || !no) {
        if (typeof window.confirmPadrao === 'function') {
          window
            .confirmPadrao(opts.message || opts.text || '', {
              title: opts.title || 'Confirmar ação',
              confirmText: opts.okLabel || 'Confirmar',
              cancelText: 'Cancelar',
              danger: opts.danger !== false,
            })
            .then(function (ok) {
              resolve(!!ok);
            });
        } else {
          resolve(
            window.confirm(
              String(opts.message || opts.text || opts.title || 'Continuar?').replace(/<[^>]+>/g, ' ')
            )
          );
        }
        return;
      }
      if (title) {
        title.innerHTML =
          '<i class="bx bx-error-circle" aria-hidden="true"></i> ' + esc(opts.title || 'Confirmar ação');
      }
      msg.className = 'modal-message-body' + (opts.html ? '' : ' confirm-preline');
      if (opts.html) msg.innerHTML = opts.html;
      else msg.textContent = opts.message || opts.text || '';
      yes.className = opts.danger === false ? 'btn-filtro btn-filtro-aplicar' : 'btn-filtro btn-filtro-novo';
      yes.innerHTML = "<i class='bx bx-check'></i> " + esc(opts.okLabel || 'Confirmar');
      no.innerHTML = "<i class='bx bx-x'></i> Cancelar";
      function fechar(res) {
        yes.onclick = null;
        no.onclick = null;
        modal.onclick = null;
        modal.style.display = 'none';
        resolve(res);
      }
      yes.onclick = function () {
        fechar(true);
      };
      no.onclick = function () {
        fechar(false);
      };
      modal.onclick = function (ev) {
        if (ev.target === modal) fechar(false);
      };
      modal.style.display = 'flex';
    });
  }

  function htmlConfirmValores(resumo, pergunta) {
    var r = resumo || {};
    return (
      '<div class="confirm-val-body">' +
      '<p class="confirm-nota">Fórmula corrigida: <strong>vProd ÷ qtdConvertida</strong> (mesma UM do ledger).</p>' +
      '<p>Total corrigido (auditoria): <strong class="val-destaque">' +
      esc(fmtMoeda(r.valorTotalNovo)) +
      '</strong></p>' +
      '<p>Antigo vUnCom <span class="val-muted">(só comparação — não será gravado)</span>: ' +
      '<span class="val-muted">' +
      esc(fmtMoeda(r.valorTotalAntigo)) +
      '</span> <span class="val-pct">(' +
      (r.pctVariacao > 0 ? '+' : '') +
      esc(String(r.pctVariacao)) +
      '%)</span></p>' +
      '<p class="confirm-pergunta">' +
      esc(pergunta || 'Confirma gravação?') +
      '</p></div>'
    );
  }

  function confirmarAntesSnapshot(titulo) {
    if (!ultimaAuditoriaUm || !ultimaAuditoriaUm.resumo) {
      return confirmar({
        title: 'Auditar antes de gravar',
        message:
          'Antes de gravar snapshots, use «Auditar UM» e confira se o total corrigido faz sentido (~R$ 2,5 mi esperado).\n\n' +
          titulo +
          ' mesmo assim?',
        okLabel: 'Continuar',
        danger: false,
      });
    }
    return confirmar({
      title: titulo,
      html: htmlConfirmValores(ultimaAuditoriaUm.resumo, 'Confirma gravação?'),
      okLabel: 'Gravar snapshot',
    });
  }

  function renderAuditoria(data) {
    var sec = byId('secAuditoriaUm');
    var res = byId('auditoriaResumo');
    var tb = byId('tblAuditoriaUm');
    if (!sec || !tb || !data || !data.resumo) return;
    sec.style.display = 'block';
    if (res) {
      res.textContent =
        'Total antigo (vUnCom): ' +
        fmtMoeda(data.resumo.valorTotalAntigo) +
        ' → corrigido (vProd÷qtdConvertida): ' +
        fmtMoeda(data.resumo.valorTotalNovo) +
        ' (' +
        (data.resumo.pctVariacao > 0 ? '+' : '') +
        data.resumo.pctVariacao +
        '%). ' +
        data.resumo.qtdSkusComparados +
        ' SKU(s) com diferença.';
    }
    var rows = data.topInfladores || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="9">Nenhum SKU superestimado na comparação (ou diferenças &lt; R$ 0,01).</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .slice(0, 25)
      .map(function (r) {
        return (
          '<tr><td>' +
          esc(r.NM_DONO) +
          '</td><td>' +
          esc(r.CODIGO_PRODUTO) +
          '</td><td>' +
          esc(r.NM_PRODUTO) +
          '</td><td class="num">' +
          esc(fmtQtd(r.QTD_SALDO)) +
          '</td><td class="num">' +
          esc(r.VLR_UNIT_ANTIGO != null ? fmtMoeda(r.VLR_UNIT_ANTIGO) : '—') +
          '</td><td class="num">' +
          esc(r.VLR_UNIT_NOVO != null ? fmtMoeda(r.VLR_UNIT_NOVO) : '—') +
          '</td><td class="num">' +
          esc(fmtMoeda(r.VALOR_ANTIGO)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.VALOR_NOVO)) +
          '</td><td class="num">' +
          esc(r.PCT_VARIACAO != null ? r.PCT_VARIACAO + '%' : '—') +
          '</td></tr>'
        );
      })
      .join('');
  }

  async function auditarUm() {
    showLoadingOverlay('Auditoria UM', 'Comparando vUnCom vs vProd÷qtdConvertida…', '');
    await yieldPaint();
    try {
      var q = [];
      var cd = (byId('filtroCdDono').value || '').trim();
      if (cd) q.push('cdDono=' + encodeURIComponent(cd));
      var url = corrigirUrl('/api/wms/dashboard/valor-estoque/auditoria-um' + (q.length ? '?' + q.join('&') : ''));
      var r = await fetch(url, { headers: getAuthHeaders() });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);
      ultimaAuditoriaUm = data;
      renderAuditoria(data);
      showMessage(
        'Total corrigido: ' +
          fmtMoeda(data.resumo.valorTotalNovo) +
          ' (antes ' +
          fmtMoeda(data.resumo.valorTotalAntigo) +
          '). Veja tabela abaixo e Filtrar para posição atualizada.',
        'success'
      );
      await carregarDashboard();
    } catch (e) {
      showMessage(e.message || 'Erro na auditoria.', 'error');
      hideLoadingOverlay();
    }
  }

  function carregarDonos() {
    return fetch(corrigirUrl('/api/wms/donos-estoque?fgactive=S'), { headers: getAuthHeaders() })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || 'Erro ao listar donos');
          return j;
        });
      })
      .then(function (rows) {
        var sel = byId('filtroCdDono');
        if (!sel) return;
        var v = sel.value;
        sel.innerHTML = '<option value="">Todos</option>';
        (rows || []).forEach(function (d) {
          var o = document.createElement('option');
          o.value = String(d.CD_DONO);
          o.textContent = (d.CODIGO ? d.CODIGO + ' — ' : '') + (d.NOME || 'Dono #' + d.CD_DONO);
          sel.appendChild(o);
        });
        if (v) sel.value = v;
      });
  }

  function montarQuery() {
    var q = [];
    var cd = (byId('filtroCdDono').value || '').trim();
    var dt = (byId('filtroDataRef').value || '').trim();
    if (cd) q.push('cdDono=' + encodeURIComponent(cd));
    if (dt) q.push('dataRef=' + encodeURIComponent(dt));
    return q.length ? '?' + q.join('&') : '';
  }

  function renderAvisos(lista) {
    var box = byId('avisosBox');
    var body = byId('avisosBody');
    var countEl = byId('avisosCount');
    if (!box || !body) return;
    var itens = Array.isArray(lista) ? lista.filter(Boolean) : [];
    if (!itens.length) {
      box.style.display = 'none';
      box.classList.remove('is-open');
      body.innerHTML = '';
      return;
    }
    if (countEl) countEl.textContent = '(' + itens.length + ')';
    body.innerHTML = '<ul>' + itens.map(function (a) {
      return '<li>' + esc(a) + '</li>';
    }).join('') + '</ul>';
    box.style.display = 'block';
  }

  function renderKpis(data) {
    var el = byId('kpisValor');
    if (!el || !data) return;
    var p = data.picos || {};
    var qtdSemPreco = (data.resumoHoje && data.resumoHoje.qtdSkusSemPreco) || 0;
    el.innerHTML =
      statCard('primary', 'bx-dollar-circle', 'Valor estoque hoje', fmtMoeda(data.valorHoje), 'Tempo real (ledger × preço)') +
      statCard(
        'success',
        'bx-receipt',
        'Cobrança est. hoje',
        fmtMoeda(data.cobrancaHojeEstimada),
        data.pctCobranca != null ? fmtPct(data.pctCobranca) + ' sobre valor hoje' : '% por dono no cadastro'
      ) +
      statCard(
        'info',
        'bx-trending-up',
        'Pico mensal (valor)',
        fmtMoeda(p.picoMensal && p.picoMensal.valor),
        p.picoMensal && p.picoMensal.dtPico ? 'Em ' + fmtDataBr(p.picoMensal.dtPico) : 'Snapshots do mês'
      ) +
      statCard('primary', 'bx-wallet', 'Cobrança est. pico mês', fmtMoeda(data.cobrancaPicoMensalEstimada), 'Σ (pico dono × % dono)') +
      statCard(
        'info',
        'bx-calendar-week',
        'Pico semanal',
        fmtMoeda(p.picoSemanal && p.picoSemanal.valor),
        p.picoSemanal && p.picoSemanal.dtPico ? fmtDataBr(p.picoSemanal.dtPico) : 'Semana corrente'
      ) +
      statCard(
        'info',
        'bx-calendar',
        'Pico quinzenal',
        fmtMoeda(p.picoQuinzenal && p.picoQuinzenal.valor),
        p.picoQuinzenal ? 'Q' + p.picoQuinzenal.quinzena : 'Quinzena corrente'
      ) +
      statCard(
        qtdSemPreco > 0 ? 'warning' : 'info',
        'bx-error-circle',
        'SKUs sem preço',
        String(qtdSemPreco),
        'Clique para filtrar — cadastre Valor referência (R$)',
        'clicavel',
        ' data-kpi="sem-preco" title="Filtrar só SKUs sem preço"'
      ) +
      statCard(
        'info',
        'bx-camera',
        'Dias com snapshot',
        String(p.diasComSnapshot != null ? p.diasComSnapshot : 0),
        'No mês de referência'
      );
    var kpiSem = el.querySelector('[data-kpi="sem-preco"]');
    if (kpiSem) {
      kpiSem.addEventListener('click', function () {
        var chk = byId('filtroSomenteSemPreco');
        if (chk) {
          chk.checked = true;
          renderPosicao(ultimasLinhasPosicao);
          var sec = byId('tblPosicaoValor');
          if (sec && sec.closest('.wms-val-section')) {
            sec.closest('.wms-val-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    }
  }

  function renderChart(serie) {
    var canvas = byId('chartValorDiario');
    if (!canvas || typeof Chart === 'undefined') return;
    var pts = Array.isArray(serie) ? serie.slice().sort(function (a, b) {
      return String(a.dt || '').localeCompare(String(b.dt || ''));
    }) : [];
    var labels = pts.map(function (x) {
      return fmtDataChart(x.dt);
    });
    var valores = pts.map(function (x) {
      return Number(x.valor) || 0;
    });
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var corLinha = dark ? '#38bdf8' : '#0ea5e9';
    var corGrid = dark ? '#334155' : '#e2e8f0';
    var corTexto = dark ? '#94a3b8' : '#64748b';
    if (chartInst) {
      chartInst.destroy();
      chartInst = null;
    }
    chartInst = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Valor estoque (R$)',
            data: valores,
            borderColor: corLinha,
            backgroundColor: dark ? 'rgba(56,189,248,0.12)' : 'rgba(14,165,233,0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: pts.length > 40 ? 0 : 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: corTexto } },
          tooltip: {
            callbacks: {
              title: function (items) {
                var i = items[0] && items[0].dataIndex;
                return pts[i] ? fmtDataBr(pts[i].dt) : '';
              },
              label: function (ctx) {
                return fmtMoeda(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: {
            type: 'category',
            ticks: { color: corTexto, maxRotation: 0, autoSkip: true, maxTicksLimit: pts.length > 25 ? 10 : 15 },
            grid: { color: corGrid },
          },
          y: {
            ticks: {
              color: corTexto,
              callback: function (v) {
                return fmtMoeda(v);
              },
            },
            grid: { color: corGrid },
          },
        },
      },
    });
  }

  function renderTabelaPico(lista) {
    var tb = byId('tblPicoDono');
    if (!tb) return;
    var rows = Array.isArray(lista) ? lista : [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="5">Sem snapshots no mês — use «Gerar snapshot hoje».</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map(function (r) {
        return (
          '<tr><td>' +
          esc(r.NM_DONO || r.CD_DONO) +
          '</td><td class="num">' +
          esc(fmtPct(r.PCT_COBRANCA_ESTOQUE)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.picoValor)) +
          '</td><td>' +
          esc(fmtDataBr(r.dtPico)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.cobrancaEstimada)) +
          '</td></tr>'
        );
      })
      .join('');
  }

  function renderPosicao(linhas) {
    var tb = byId('tblPosicaoValor');
    if (!tb) return;
    ultimasLinhasPosicao = linhas || [];
    var somenteSem = byId('filtroSomenteSemPreco') && byId('filtroSomenteSemPreco').checked;
    var rows = ultimasLinhasPosicao.filter(function (r) {
      if (somenteSem) return String(r.FONTE_PRECO) === 'SEM_PRECO';
      return Number(r.VALOR_ESTOQUE) > 0 || String(r.FONTE_PRECO) === 'SEM_PRECO' || String(r.FONTE_PRECO) === 'SEM_CADASTRO';
    });
    if (!rows.length) {
      tb.innerHTML =
        '<tr><td colspan="7">' +
        (somenteSem ? 'Nenhum SKU sem preço para o filtro atual.' : 'Nenhum SKU com saldo valorizado.') +
        '</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .slice(0, 500)
      .map(function (r) {
        var fonte = labelFonte(r.FONTE_PRECO);
        if (r.FONTE_PRECO === 'SEM_PRECO') fonte = '<span class="badge-sem-preco">Sem preço</span>';
        return (
          '<tr><td>' +
          esc(r.NM_DONO) +
          '</td><td>' +
          esc(r.CODIGO_PRODUTO) +
          '</td><td>' +
          esc(r.NM_PRODUTO) +
          '</td><td class="num">' +
          esc(fmtQtd(r.QTD_SALDO)) +
          '</td><td class="num">' +
          esc(r.VLR_UNITARIO != null ? fmtMoeda(r.VLR_UNITARIO) : '—') +
          '</td><td>' +
          fonte +
          '</td><td class="num">' +
          esc(fmtMoeda(r.VALOR_ESTOQUE)) +
          '</td></tr>'
        );
      })
      .join('');
    if (rows.length > 500) {
      tb.innerHTML += '<tr><td colspan="7">… mais ' + (rows.length - 500) + ' linha(s). Exporte CSV para lista completa.</td></tr>';
    }
  }

  async function carregarDashboard() {
    showLoadingOverlay('Valor de estoque', 'Calculando posição e picos…', '');
    await yieldPaint();
    try {
      var url = corrigirUrl('/api/wms/dashboard/valor-estoque' + montarQuery());
      var r = await fetch(url, { headers: getAuthHeaders() });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);

      renderAvisos(data.avisos);
      renderKpis(data);
      renderChart((data.picos && data.picos.serieDiaria) || []);
      renderTabelaPico(data.picoMensalPorDono);

      var qPos = [];
      var cd = (byId('filtroCdDono').value || '').trim();
      if (cd) qPos.push('cdDono=' + encodeURIComponent(cd));
      var posUrl = corrigirUrl('/api/wms/dashboard/valor-estoque/posicao' + (qPos.length ? '?' + qPos.join('&') : ''));
      var rp = await fetch(posUrl, { headers: getAuthHeaders() });
      var pos = await rp.json().catch(function () {
        return {};
      });
      if (rp.ok) renderPosicao(pos.linhas);
      else renderPosicao([]);
    } catch (e) {
      showMessage(e.message || 'Erro ao carregar dashboard.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  async function gerarSnapshot() {
    if (!(await confirmarAntesSnapshot('Gerar snapshot de hoje'))) return;
    showLoadingOverlay('Snapshot', 'Gravando valor de hoje…', '');
    await yieldPaint();
    try {
      var cd = (byId('filtroCdDono').value || '').trim();
      var body = {};
      if (cd) body.cdDono = parseInt(cd, 10);
      var r = await fetch(corrigirUrl('/api/wms/dashboard/valor-estoque/snapshot'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify(body),
      });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);
      showMessage('Snapshot gravado: ' + (data.gravados ? data.gravados.length : 0) + ' dono(s).', 'success');
      await carregarDashboard();
    } catch (e) {
      showMessage(e.message || 'Erro ao gravar snapshot.', 'error');
      hideLoadingOverlay();
    }
  }

  async function gerarBackfillMes() {
    var dtRef = (byId('filtroDataRef').value || '').trim() || hojeIso();
    var ok = false;
    if (!ultimaAuditoriaUm || !ultimaAuditoriaUm.resumo) {
      ok = await confirmar({
        title: 'Auditar antes do backfill',
        message:
          'IMPORTANTE: rode «Auditar UM» antes do backfill para validar o total corrigido.\n\nContinuar backfill do mês ' +
          fmtDataBr(dtRef) +
          '?',
        okLabel: 'Continuar',
        danger: false,
      });
    } else {
      ok = await confirmar({
        title: 'Backfill snapshots — mês ' + fmtDataBr(dtRef),
        html: htmlConfirmValores(ultimaAuditoriaUm.resumo, 'Confirma gravação dos snapshots?'),
        okLabel: 'Gravar snapshots',
      });
    }
    if (!ok) return;
    showLoadingOverlay('Snapshots do mês', 'Recalculando dia a dia…', 'Referência ' + fmtDataBr(dtRef));
    await yieldPaint();
    try {
      var cd = (byId('filtroCdDono').value || '').trim();
      var body = { dataRef: dtRef };
      if (cd) body.cdDono = parseInt(cd, 10);
      var r = await fetch(corrigirUrl('/api/wms/dashboard/valor-estoque/snapshot/backfill'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify(body),
      });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);
      showMessage(
        'Backfill concluído: ' +
          (data.snapshotsGravados || 0) +
          ' snapshot(s) (' +
          fmtDataBr(data.dtIni) +
          ' a ' +
          fmtDataBr(data.dtFim) +
          ').',
        'success'
      );
      await carregarDashboard();
    } catch (e) {
      showMessage(e.message || 'Erro no backfill.', 'error');
      hideLoadingOverlay();
    }
  }

  function baixarCsvUrl(url, nomeArquivo) {
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error(t || r.statusText);
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        var u = URL.createObjectURL(blob);
        a.href = u;
        a.download = nomeArquivo || 'posicao_valorizada_' + hojeIso() + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(u);
          a.remove();
        }, 200);
        showMessage('CSV exportado.', 'success');
      });
  }

  function exportarCsv() {
    var q = [];
    var cd = (byId('filtroCdDono').value || '').trim();
    if (cd) q.push('cdDono=' + encodeURIComponent(cd));
    var url = corrigirUrl('/api/wms/dashboard/valor-estoque/posicao.csv' + (q.length ? '?' + q.join('&') : ''));
    baixarCsvUrl(url, 'posicao_valorizada_' + hojeIso() + '.csv').catch(function (e) {
      showMessage(e.message || 'Erro ao exportar.', 'error');
    });
  }

  function exportarSemPrecoCsv() {
    var q = ['semPreco=S'];
    var cd = (byId('filtroCdDono').value || '').trim();
    if (cd) q.push('cdDono=' + encodeURIComponent(cd));
    var url = corrigirUrl('/api/wms/dashboard/valor-estoque/posicao.csv?' + q.join('&'));
    baixarCsvUrl(url, 'skus_sem_preco_' + hojeIso() + '.csv').catch(function (e) {
      showMessage(e.message || 'Erro ao exportar.', 'error');
    });
  }

  async function importarValoresArquivo(file) {
    if (!file) return;
    showLoadingOverlay('Importando valores', 'Atualizando valor referência nos produtos…', file.name);
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var fd = new FormData();
      fd.append('arquivo', file);
      var r = await fetch(corrigirUrl('/api/wms/dashboard/valor-estoque/importar-valor-referencia'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error(data.error || r.statusText || 'Falha na importação');
      showMessage(
        'Importação concluída: ' +
          (data.atualizados || 0) +
          ' produto(s) atualizado(s)' +
          (data.semProduto ? '; ' + data.semProduto + ' linha(s) sem match.' : '.'),
        'success'
      );
      await carregarDashboard();
    } catch (e) {
      showMessage(e.message || 'Erro ao importar.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  byId('formFiltrosValor').addEventListener('submit', function (ev) {
    ev.preventDefault();
    carregarDashboard();
  });

  byId('btnLimpar').addEventListener('click', function () {
    byId('filtroCdDono').value = '';
    byId('filtroDataRef').value = hojeIso();
    var chk = byId('filtroSomenteSemPreco');
    if (chk) chk.checked = false;
    carregarDashboard();
  });

  var chkSem = byId('filtroSomenteSemPreco');
  if (chkSem) {
    chkSem.addEventListener('change', function () {
      renderPosicao(ultimasLinhasPosicao);
    });
  }

  byId('btnAuditarUm').addEventListener('click', auditarUm);
  byId('btnSnapshot').addEventListener('click', gerarSnapshot);
  byId('btnBackfillMes').addEventListener('click', gerarBackfillMes);
  byId('btnExportCsv').addEventListener('click', exportarCsv);
  byId('btnExportSemPreco').addEventListener('click', exportarSemPrecoCsv);
  byId('btnImportValor').addEventListener('click', function () {
    byId('inputImportValor').click();
  });
  byId('inputImportValor').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (f) importarValoresArquivo(f);
  });
  byId('btnVoltar').addEventListener('click', function () {
    if (window.parent && typeof window.parent.loadModuleContent === 'function') {
      window.parent.loadModuleContent('estoque');
    }
  });

  var btnToggleAvisos = byId('btnToggleAvisos');
  if (btnToggleAvisos) {
    btnToggleAvisos.addEventListener('click', function () {
      var box = byId('avisosBox');
      if (box) box.classList.toggle('is-open');
    });
  }

  byId('filtroDataRef').value = hojeIso();
  carregarDonos()
    .catch(function () {})
    .finally(function () {
      carregarDashboard();
    });
})();
