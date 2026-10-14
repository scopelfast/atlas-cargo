(function () {
  var chartArm = null;
  var chartExp = null;
  var chartCombo = null;
  var chartCobDono = null;
  var ultimoDash = null;

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

  function fmtMoedaCurta(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
    if (Math.abs(n) >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return fmtMoeda(n);
  }

  function fmtPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + '%';
  }

  function fmtDataBr(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /** Rótulo curto para eixo X (ordem preservada — category). */
  function fmtDataChart(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return String(iso);
    return p[2] + '/' + p[1];
  }

  function ordenarSeriePorDt(serie) {
    return (serie || []).slice().sort(function (a, b) {
      return String(a.dt || '').localeCompare(String(b.dt || ''));
    });
  }

  function chartScaleX(th, pointCount) {
    return {
      type: 'category',
      ticks: {
        color: th.text,
        maxRotation: 0,
        minRotation: 0,
        autoSkip: true,
        maxTicksLimit: pointCount > 25 ? 10 : pointCount > 15 ? 12 : 15,
      },
      grid: { color: th.grid },
    };
  }

  function fmtDataHora(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace('T', ' ');
    return d.toLocaleString('pt-BR');
  }

  function hojeIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function inicioMesIso(iso) {
    var s = iso || hojeIso();
    return s.slice(0, 8) + '01';
  }

  function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function chartTheme() {
    var dark = isDarkTheme();
    return {
      grid: dark ? '#334155' : '#e2e8f0',
      text: dark ? '#94a3b8' : '#64748b',
      tooltipBg: dark ? '#1e293b' : '#fff',
      tooltipTitle: dark ? '#e2e8f0' : '#0f172a',
      tooltipBody: dark ? '#cbd5e1' : '#475569',
    };
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
    if (byId('loadingTitle')) byId('loadingTitle').textContent = titulo || 'Carregando';
    if (byId('loadingText')) byId('loadingText').textContent = texto || 'Aguarde…';
    if (byId('loadingDetalhe')) byId('loadingDetalhe').textContent = det || '';
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

  function montarQuery() {
    var q = [];
    var cd = (byId('filtroCdDono').value || '').trim();
    var di = (byId('filtroDataIni').value || '').trim();
    var df = (byId('filtroDataFim').value || '').trim();
    if (cd) q.push('cdDono=' + encodeURIComponent(cd));
    if (di) q.push('dataIni=' + encodeURIComponent(di));
    if (df) q.push('dataFim=' + encodeURIComponent(df));
    return q.length ? '?' + q.join('&') : '';
  }

  function goModulo(programa) {
    if (window.parent && typeof window.parent.loadModuleContent === 'function') {
      window.parent.loadModuleContent(programa);
    }
  }

  async function carregarDonos() {
    try {
      var r = await fetch(corrigirUrl('/api/wms/donos-estoque?fgactive=S'), { headers: getAuthHeaders() });
      var rows = await r.json().catch(function () {
        return [];
      });
      if (!r.ok || !Array.isArray(rows)) return;
      var sel = byId('filtroCdDono');
      if (!sel) return;
      var v = sel.value;
      sel.innerHTML = '<option value="">Todos</option>';
      rows.forEach(function (d) {
        var o = document.createElement('option');
        o.value = String(d.CD_DONO);
        o.textContent = (d.NOME || '') + ' (' + (d.CODIGO || d.CD_DONO) + ')';
        sel.appendChild(o);
      });
      if (v) sel.value = v;
    } catch (e) {}
  }

  function renderAvisos(lista) {
    var box = byId('avisosBox');
    var body = byId('avisosBody');
    var countEl = byId('avisosCount');
    if (!box || !body) return;
    var av = Array.isArray(lista) ? lista.filter(Boolean) : [];
    if (!av.length) {
      box.style.display = 'none';
      box.classList.remove('is-open');
      return;
    }
    if (countEl) countEl.textContent = '(' + av.length + ')';
    body.innerHTML = '<ul>' + av.map(function (a) {
      return '<li>' + esc(a) + '</li>';
    }).join('') + '</ul>';
    box.style.display = 'block';
  }

  function renderKpis(res, dash) {
    var el = byId('kpisResumo');
    if (!el || !res) return;
    var p = (dash && dash.periodo) || {};
    var cobArm = Number(res.armazenagemCobrancaEstimada) || 0;
    var cobExp = Number(res.expedicaoCobrancaEstimada) || 0;
    var total = Number(res.cobrancaTotalEstimada) || 0;
    var valorNf = Number(res.expedicaoValorNf) || 0;
    var pctArmShare = total > 0 ? Math.round((cobArm / total) * 100) : 0;
    var pctExpShare = total > 0 ? Math.round((cobExp / total) * 100) : 0;
    var faltaPctExp = valorNf > 0 && cobExp < 0.01;

    var shareHtml =
      total > 0
        ? '<div class="wms-cob-share">' +
          '<div class="wms-cob-share__arm" style="width:' +
          pctArmShare +
          '%"></div>' +
          '<div class="wms-cob-share__exp" style="width:' +
          pctExpShare +
          '%"></div></div>' +
          '<div class="wms-cob-share-legend"><span class="leg-arm">Armazenagem ' +
          pctArmShare +
          '%</span><span class="leg-exp">Expedição ' +
          pctExpShare +
          '%</span></div>'
        : '';

    var badgeExp = faltaPctExp
      ? '<span class="wms-cob-badge"><i class="bx bx-error-circle"></i> Cadastre % expedição no dono</span>'
      : '';

    var picoDt = res.armazenagemPicoDt ? ' · pico em ' + fmtDataBr(res.armazenagemPicoDt) : '';

    el.innerHTML =
      '<div class="dashboard-stat-card success">' +
      '<div class="stat-card-icon"><i class="bx bx-wallet"></i></div>' +
      '<div class="stat-card-content">' +
      '<h4>Total cobrança estimada</h4>' +
      '<p class="stat-value">' +
      esc(fmtMoeda(total)) +
      '</p>' +
      '<span class="stat-label">' +
      esc(fmtDataBr(p.dataIni) + ' a ' + fmtDataBr(p.dataFim)) +
      '</span>' +
      shareHtml +
      '</div></div>' +
      '<div class="dashboard-stat-card info">' +
      '<div class="stat-card-icon"><i class="bx bx-package"></i></div>' +
      '<div class="stat-card-content">' +
      '<h4>Armazenagem</h4>' +
      '<p class="stat-value">' +
      esc(fmtMoeda(cobArm)) +
      '</p>' +
      '<div class="stat-label-row"><span>Pico consolidado</span><strong>' +
      esc(fmtMoeda(res.armazenagemPicoValor)) +
      '</strong></div>' +
      '<span class="stat-label">' +
      esc((res.armazenagemDiasSnapshot || 0) + ' dia(s) com snapshot' + picoDt) +
      '</span></div></div>' +
      '<div class="dashboard-stat-card purple">' +
      '<div class="stat-card-icon"><i class="bx bx-export"></i></div>' +
      '<div class="stat-card-content">' +
      '<h4>Expedição</h4>' +
      '<p class="stat-value">' +
      esc(fmtMoeda(cobExp)) +
      '</p>' +
      '<div class="stat-label-row"><span>Valor NF expedidas</span><strong>' +
      esc(fmtMoeda(valorNf)) +
      '</strong></div>' +
      '<span class="stat-label">' +
      esc((res.expedicaoQtdCargas || 0) + ' carga(s) · ' + (res.expedicaoQtdNf || 0) + ' NF-e') +
      '</span>' +
      badgeExp +
      '</div></div>';
  }

  function mapDonosConsolidado(dash) {
    var arm = (dash.armazenagem && dash.armazenagem.resumoPorDono) || [];
    var exp = (dash.expedicao && dash.expedicao.resumoPorDono) || [];
    var map = new Map();
    arm.forEach(function (r) {
      map.set(r.CD_DONO, {
        CD_DONO: r.CD_DONO,
        NM_DONO: r.NM_DONO,
        pctArm: r.PCT_COBRANCA_ESTOQUE,
        pico: r.picoValor,
        cobArm: r.cobrancaEstimada,
        pctExp: null,
        valorNf: 0,
        cobExp: 0,
      });
    });
    exp.forEach(function (r) {
      var cur = map.get(r.CD_DONO) || {
        CD_DONO: r.CD_DONO,
        NM_DONO: r.NM_DONO,
        pctArm: null,
        pico: 0,
        cobArm: 0,
      };
      cur.pctExp = r.PCT_COBRANCA_EXPEDICAO;
      cur.valorNf = r.valorNfTotal;
      cur.cobExp = r.cobrancaEstimada;
      map.set(r.CD_DONO, cur);
    });
    return Array.from(map.values()).sort(function (a, b) {
      return (b.cobArm + b.cobExp) - (a.cobArm + a.cobExp) || a.CD_DONO - b.CD_DONO;
    });
  }

  function mergeSeriesDiarias(dash) {
    var arm = ((dash.armazenagem && dash.armazenagem.serieDiaria) || []).slice();
    var exp = ((dash.expedicao && dash.expedicao.serieDiaria) || []).slice();
    var mapArm = new Map();
    var mapExp = new Map();
    arm.forEach(function (r) {
      mapArm.set(r.dt, Number(r.valorTotal) || 0);
    });
    exp.forEach(function (r) {
      mapExp.set(r.dt, Number(r.valorNfTotal) || 0);
    });
    var dias = new Set([].concat(Array.from(mapArm.keys()), Array.from(mapExp.keys())));
    return Array.from(dias)
      .sort()
      .map(function (dt) {
        return { dt: dt, arm: mapArm.get(dt) || 0, exp: mapExp.get(dt) || 0 };
      });
  }

  function renderChartComboPeriodo(dash) {
    var canvas = byId('chartComboPeriodo');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartCombo) chartCombo.destroy();
    var serie = mergeSeriesDiarias(dash);
    var th = chartTheme();
    var labels = serie.map(function (s) {
      return fmtDataChart(s.dt);
    });
    chartCombo = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'NF expedidas (R$)',
            data: serie.map(function (s) {
              return s.exp;
            }),
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139,92,246,0.18)',
            fill: true,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Snapshot estoque (R$)',
            data: serie.map(function (s) {
              return s.arm;
            }),
            borderColor: '#0ea5e9',
            backgroundColor: 'rgba(14,165,233,0.08)',
            fill: false,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderDash: [4, 3],
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: th.text, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            backgroundColor: th.tooltipBg,
            titleColor: th.tooltipTitle,
            bodyColor: th.tooltipBody,
            borderColor: th.grid,
            borderWidth: 1,
            callbacks: {
              title: function (items) {
                var i = items[0] && items[0].dataIndex;
                return serie[i] ? fmtDataBr(serie[i].dt) : '';
              },
              label: function (ctx) {
                return ctx.dataset.label + ': ' + fmtMoeda(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: chartScaleX(th, serie.length),
          y: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#8b5cf6', callback: function (v) {
              return fmtMoedaCurta(v);
            } },
            grid: { color: th.grid },
          },
          y1: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#0ea5e9', callback: function (v) {
              return fmtMoedaCurta(v);
            } },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  function renderChartCobrancaDono(dash) {
    var canvas = byId('chartCobrancaDono');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartCobDono) chartCobDono.destroy();
    var rows = mapDonosConsolidado(dash);
    if (!rows.length) {
      chartCobDono = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: ['—'], datasets: [{ data: [0] }] },
        options: { responsive: true, maintainAspectRatio: false },
      });
      return;
    }
    var th = chartTheme();
    var labels = rows.map(function (r) {
      var n = String(r.NM_DONO || '');
      return n.length > 22 ? n.slice(0, 20) + '…' : n;
    });
    chartCobDono = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Armazenagem',
            data: rows.map(function (r) {
              return Number(r.cobArm) || 0;
            }),
            backgroundColor: 'rgba(14,165,233,0.85)',
            borderRadius: 4,
            barThickness: 18,
          },
          {
            label: 'Expedição',
            data: rows.map(function (r) {
              return Number(r.cobExp) || 0;
            }),
            backgroundColor: 'rgba(139,92,246,0.85)',
            borderRadius: 4,
            barThickness: 18,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: th.text, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            backgroundColor: th.tooltipBg,
            titleColor: th.tooltipTitle,
            bodyColor: th.tooltipBody,
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + fmtMoeda(ctx.parsed.x);
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: th.text, callback: function (v) {
              return fmtMoedaCurta(v);
            } },
            grid: { color: th.grid },
          },
          y: { stacked: true, ticks: { color: th.text }, grid: { display: false } },
        },
      },
    });
  }

  function renderResumoDono(dash) {
    var tb = byId('tblResumoDono');
    if (!tb) return;
    var rows = mapDonosConsolidado(dash);
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="8">Sem dados no período.</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map(function (r) {
        var total = (Number(r.cobArm) || 0) + (Number(r.cobExp) || 0);
        return (
          '<tr><td>' +
          esc(r.NM_DONO) +
          '</td><td class="num">' +
          esc(fmtPct(r.pctArm)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.pico)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.cobArm)) +
          '</td><td class="num">' +
          esc(fmtPct(r.pctExp)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.valorNf)) +
          '</td><td class="num">' +
          esc(fmtMoeda(r.cobExp)) +
          '</td><td class="num"><strong>' +
          esc(fmtMoeda(total)) +
          '</strong></td></tr>'
        );
      })
      .join('');
  }

  function renderChartExpedicao(exp) {
    var canvas = byId('chartExpedicao');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartExp) chartExp.destroy();
    var th = chartTheme();
    var pts = ordenarSeriePorDt((exp && exp.serieDiaria) || []);
    var labels = pts.map(function (s) {
      return fmtDataChart(s.dt);
    });
    chartExp = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Valor NF expedidas (R$)',
            data: pts.map(function (s) {
              return Number(s.valorNfTotal) || 0;
            }),
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139,92,246,0.15)',
            fill: true,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
            yAxisID: 'y',
          },
          {
            label: 'Cobrança est. (R$)',
            data: pts.map(function (s) {
              return Number(s.cobrancaEstimada) || 0;
            }),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.08)',
            fill: false,
            tension: 0.32,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
            borderDash: [5, 4],
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: th.text, usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            backgroundColor: th.tooltipBg,
            titleColor: th.tooltipTitle,
            bodyColor: th.tooltipBody,
            borderColor: th.grid,
            borderWidth: 1,
            callbacks: {
              title: function (items) {
                var i = items[0] && items[0].dataIndex;
                return pts[i] ? fmtDataBr(pts[i].dt) : '';
              },
              label: function (ctx) {
                return ctx.dataset.label + ': ' + fmtMoeda(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: chartScaleX(th, pts.length),
          y: {
            type: 'linear',
            position: 'left',
            ticks: {
              color: '#8b5cf6',
              callback: function (v) {
                return fmtMoedaCurta(v);
              },
            },
            grid: { color: th.grid },
          },
          y1: {
            type: 'linear',
            position: 'right',
            ticks: {
              color: '#10b981',
              callback: function (v) {
                return fmtMoedaCurta(v);
              },
            },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  function renderChartSerie(canvasId, chartRef, serie, field, label, color, setter) {
    var canvas = byId(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (chartRef) chartRef.destroy();
    var th = chartTheme();
    var pts = ordenarSeriePorDt(serie);
    var labels = pts.map(function (s) {
      return fmtDataChart(s.dt);
    });
    var data = pts.map(function (s) {
      return Number(s[field]) || 0;
    });
    var c = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: label,
            data: data,
            borderColor: color,
            backgroundColor: color.length === 7 && color.charAt(0) === '#' ? color + '22' : color,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: th.text } },
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
          x: chartScaleX(th, pts.length),
          y: {
            ticks: {
              color: th.text,
              callback: function (v) {
                return fmtMoedaCurta(v);
              },
            },
            grid: { color: th.grid },
          },
        },
      },
    });
    setter(c);
  }

  function renderArmazenagem(dash) {
    var arm = dash.armazenagem || {};
    var tb = byId('tblArmazenagemDono');
    if (tb) {
      var rows = arm.resumoPorDono || [];
      tb.innerHTML = rows.length
        ? rows
            .map(function (r) {
              return (
                '<tr><td>' +
                esc(r.NM_DONO) +
                '</td><td class="num">' +
                esc(fmtPct(r.PCT_COBRANCA_ESTOQUE)) +
                '</td><td class="num">' +
                esc(fmtMoeda(r.picoValor)) +
                '</td><td>' +
                esc(fmtDataBr(r.dtPico)) +
                '</td><td class="num">' +
                esc(fmtMoeda(r.cobrancaEstimada)) +
                '</td><td class="num">' +
                esc(String(r.qtdSkusSemPrecoPico != null ? r.qtdSkusSemPrecoPico : '—')) +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="6">Sem snapshots no período — gere no módulo Valor de estoque.</td></tr>';
    }
    renderChartSerie('chartArmazenagem', chartArm, arm.serieDiaria || [], 'valorTotal', 'Valor snapshot (R$)', '#0ea5e9', function (c) {
      chartArm = c;
    });
  }

  function renderExpedicao(dash) {
    var exp = dash.expedicao || {};
    var tbD = byId('tblExpedicaoDono');
    if (tbD) {
      var rows = exp.resumoPorDono || [];
      tbD.innerHTML = rows.length
        ? rows
            .map(function (r) {
              return (
                '<tr><td>' +
                esc(r.NM_DONO) +
                '</td><td class="num">' +
                esc(fmtPct(r.PCT_COBRANCA_EXPEDICAO)) +
                '</td><td class="num">' +
                esc(fmtMoeda(r.valorNfTotal)) +
                '</td><td class="num">' +
                esc(fmtMoeda(r.cobrancaEstimada)) +
                '</td><td class="num">' +
                esc(String(r.qtdCargas)) +
                '</td><td class="num">' +
                esc(String(r.qtdNf)) +
                '</td><td class="num">' +
                esc(String(r.qtdNfSemValor || 0)) +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7">Nenhuma expedição confirmada no período.</td></tr>';
    }
    var tbC = byId('tblExpedicaoCarga');
    if (tbC) {
      var cargas = exp.resumoPorCarga || [];
      tbC.innerHTML = cargas.length
        ? cargas
            .map(function (r) {
              return (
                '<tr><td>#' +
                esc(r.CD_CARGA) +
                '</td><td>' +
                esc(r.NM_DESCRICAO || '—') +
                '</td><td>' +
                esc(fmtDataHora(r.DH_SAIDA)) +
                '</td><td>' +
                esc(r.NM_MOTORISTA || '—') +
                '</td><td>' +
                esc(r.PLACA || '—') +
                '</td><td class="num">' +
                esc(fmtMoeda(r.valorNfTotal)) +
                '</td><td class="num">' +
                esc(String(r.qtdNf)) +
                (r.qtdNfSemValor ? ' <span class="badge-sem-preco">(' + r.qtdNfSemValor + ' s/ valor)</span>' : '') +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7">—</td></tr>';
    }
    var tbN = byId('tblExpedicaoNf');
    if (tbN) {
      var nfs = exp.linhasNf || [];
      tbN.innerHTML = nfs.length
        ? nfs
            .map(function (r) {
              var dest = [r.XNOME_DEST, r.XMUN_DEST, r.UF_DEST].filter(Boolean).join(' — ');
              return (
                '<tr><td>#' +
                esc(r.CD_CARGA) +
                '</td><td>' +
                esc(fmtDataHora(r.DH_SAIDA_REF || r.DH_SAIDA)) +
                (r.FONTE_DATA === 'CONFIRMACAO_EXPEDICAO'
                  ? ' <span class="badge-sem-preco" title="Sem dSaiEnt/dhSaiEnt no XML">conf. exp.</span>'
                  : '') +
                '</td><td>' +
                esc(r.NM_DONO) +
                '</td><td>' +
                esc(r.NUMERO_NF) +
                ' / ' +
                esc(r.SERIE) +
                '</td><td class="num">' +
                (r.VALOR_NF != null ? esc(fmtMoeda(r.VALOR_NF)) : '<span class="badge-sem-preco">sem valor</span>') +
                '</td><td>' +
                esc(r.FONTE_VALOR || '—') +
                '</td><td>' +
                esc(dest || '—') +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7">—</td></tr>';
    }
    renderChartExpedicao(exp);
  }

  function renderDashboard(data) {
    ultimoDash = data;
    renderAvisos(data.avisos);
    renderKpis(data.resumo || {}, data);
    renderChartComboPeriodo(data);
    renderChartCobrancaDono(data);
    renderResumoDono(data);
    renderArmazenagem(data);
    renderExpedicao(data);
  }

  async function carregarDashboard() {
    showLoadingOverlay('Cobrança operacional', 'Apurando período…', '');
    await yieldPaint();
    try {
      var url = corrigirUrl('/api/wms/dashboard/cobranca-operacional' + montarQuery());
      var r = await fetch(url, { headers: getAuthHeaders() });
      var data = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error((data && data.error) || 'HTTP ' + r.status);
      renderDashboard(data);
    } catch (e) {
      showMessage(e.message || 'Erro ao carregar cobrança.', 'error');
    } finally {
      hideLoadingOverlay();
    }
  }

  function exportarCsv(path) {
    window.open(corrigirUrl(path + montarQuery()), '_blank');
  }

  function ativarTab(tab) {
    document.querySelectorAll('.wms-cob-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.wms-cob-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
  }

  function limparFiltros() {
    var h = hojeIso();
    byId('filtroCdDono').value = '';
    byId('filtroDataIni').value = inicioMesIso(h);
    byId('filtroDataFim').value = h;
  }

  byId('formFiltrosCobranca').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var di = byId('filtroDataIni').value;
    var df = byId('filtroDataFim').value;
    if (!di || !df) {
      showMessage('Informe data início e data fim.', 'error');
      return;
    }
    if (di > df) {
      showMessage('Data início não pode ser maior que data fim.', 'error');
      return;
    }
    carregarDashboard();
  });

  byId('btnLimpar').addEventListener('click', function () {
    limparFiltros();
    carregarDashboard();
  });

  byId('btnExportResumo').addEventListener('click', function () {
    exportarCsv('/api/wms/dashboard/cobranca-operacional/resumo.csv');
  });

  byId('btnExportExp').addEventListener('click', function () {
    exportarCsv('/api/wms/dashboard/cobranca-operacional/expedicao.csv');
  });

  byId('btnValorEstoque').addEventListener('click', function () {
    goModulo('estoque-valor');
  });

  byId('btnVoltar').addEventListener('click', function () {
    goModulo('estoque');
  });

  byId('btnToggleAvisos').addEventListener('click', function () {
    var box = byId('avisosBox');
    if (box) box.classList.toggle('is-open');
  });

  document.querySelectorAll('.wms-cob-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ativarTab(btn.getAttribute('data-tab'));
    });
  });

  (async function init() {
    var h = hojeIso();
    byId('filtroDataIni').value = inicioMesIso(h);
    byId('filtroDataFim').value = h;
    await carregarDonos();
    await carregarDashboard();
  })();
})();
