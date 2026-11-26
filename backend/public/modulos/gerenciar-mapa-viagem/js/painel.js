// Painel de viagens do mapa: grade configurável por usuário.
(function () {
  const MOVIMENTO = {
    rodando: { cls: 'rodando', txt: 'Rodando' },
    parado: { cls: 'parado', txt: 'Parado' },
    sem_velocidade: { cls: 'neutro', txt: 'Sem velocidade' },
    sem_telemetria: { cls: 'neutro', txt: 'Sem telemetria' },
    sem_posicao: { cls: 'neutro', txt: 'Sem posição' }
  };

  let catalogo = [];
  let layout = null;
  let rascunho = null;
  let linhas = [];
  let carregou = false;
  let paradoAte = 5;
  let dragKey = null;

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtData(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtKm(v) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  }

  function colunasVisiveis() {
    if (!layout) return [];
    return layout.order.filter((k) => layout.visible[k]);
  }

  function labelDe(key) {
    if (key === 'pendencias') return 'Pendências primeiro';
    const c = catalogo.find((x) => x.key === key);
    return c ? c.label : key;
  }

  function celula(row, key) {
    if (key === 'movimento') {
      const m = MOVIMENTO[row.movimento] || MOVIMENTO.sem_posicao;
      return '<span class="painel-pill ' + m.cls + '">' + esc(m.txt) + '</span>';
    }
    if (key === 'prazo') {
      const cls = {
        no_prazo: 'rodando',
        risco: 'parado',
        atraso: 'atraso',
        atrasada: 'alerta',
        incerta: 'neutro',
        sem: 'neutro'
      }[row.prazo] || 'neutro';
      const texto = row.prazoTexto || 'Sem estimativa';
      const title = row.prazoDetalhe ? ' title="' + esc(row.prazoDetalhe) + '"' : '';
      return '<span class="painel-pill ' + cls + '"' + title + '>' + esc(texto) + '</span>';
    }
    if (key === 'velocidade') {
      if (row.velocidade == null || !Number.isFinite(Number(row.velocidade))) return '—';
      return esc(Math.round(Number(row.velocidade))) + ' km/h';
    }
    if (key === 'dhPosicao' || key === 'dhMacro') return esc(fmtData(row[key]));
    if (key === 'kmProximo' || key === 'kmRodado' || key === 'kmFalta' || key === 'kmTotal') return esc(fmtKm(row[key]));
    if (key === 'alerta' || key === 'sos' || key === 'mensagem') {
      const n = Number(row[key]) || 0;
      if (!n) return '—';
      const cls = key === 'mensagem' ? 'rodando' : 'alerta';
      return '<span class="painel-pill ' + cls + '">' + n + '</span>';
    }
    if (key === 'proximoPonto') {
      const nome = row.proximoPonto || '';
      const tipo = row.tipoProximo || '';
      const texto = nome && tipo ? nome + ' · ' + tipo : nome;
      return texto ? esc(texto) : '—';
    }
    const txt = row[key];
    return txt ? esc(txt) : '—';
  }

  function valorOrdem(row, key) {
    if (key === 'pendencias' || key === 'alerta' || key === 'sos' || key === 'mensagem') return Number(row[key]) || 0;
    if (key === 'velocidade' || key === 'kmProximo' || key === 'kmRodado' || key === 'kmFalta' || key === 'kmTotal' || key === 'viagem') {
      const n = Number(row[key]);
      return Number.isFinite(n) ? n : -1;
    }
    if (key === 'dhPosicao' || key === 'dhMacro') {
      const t = row[key] ? new Date(row[key]).getTime() : 0;
      return isNaN(t) ? 0 : t;
    }
    if (key === 'movimento') {
      const peso = { rodando: 3, parado: 2, sem_velocidade: 1, sem_telemetria: 1, sem_posicao: 0 };
      return peso[row.movimento] || 0;
    }
    if (key === 'prazo') {
      const peso = { atrasada: 5, atraso: 4, risco: 3, incerta: 2, sem: 1, no_prazo: 0 };
      return peso[row.prazo] || 0;
    }
    return String(row[key] || '').toLocaleLowerCase('pt-BR');
  }

  function linhasOrdenadas() {
    const key = layout && layout.sort ? layout.sort.key : 'pendencias';
    const dir = layout && layout.sort && layout.sort.dir === 'asc' ? 1 : -1;
    return linhas.slice().sort((a, b) => {
      const va = valorOrdem(a, key);
      const vb = valorOrdem(b, key);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'pt-BR') * dir;
    });
  }

  function renderGrade() {
    const tabela = document.getElementById('painelViagensTabela');
    const vazio = document.getElementById('painelViagensVazio');
    const head = document.getElementById('painelViagensHead');
    const body = document.getElementById('painelViagensBody');
    const resumo = document.getElementById('painelViagensResumo');
    const badge = document.getElementById('painelViagensContagem');
    if (!tabela || !head || !body) return;
    const cols = colunasVisiveis();
    if (!carregou) {
      tabela.hidden = true;
      if (vazio) {
        vazio.hidden = false;
        vazio.textContent = 'A grade aparece aqui depois de Filtrar.';
      }
      if (badge) badge.hidden = true;
      return;
    }
    if (badge) {
      badge.hidden = false;
      badge.textContent = String(linhas.length);
    }
    if (!linhas.length || !cols.length) {
      tabela.hidden = true;
      if (vazio) {
        vazio.hidden = false;
        vazio.textContent = cols.length ? 'Nenhuma viagem neste filtro.' : 'Nenhuma coluna marcada. Abra Colunas e escolha o que ver.';
      }
    } else {
      if (vazio) vazio.hidden = true;
      tabela.hidden = false;
      const sortKey = layout.sort && layout.sort.key;
      const seta = layout.sort && layout.sort.dir === 'asc' ? '↑' : '↓';
      head.innerHTML = cols.map((k) => {
        const marca = k === sortKey ? '<span class="painel-sort">' + seta + '</span>' : '';
        return '<th data-col="' + esc(k) + '" scope="col">' + esc(labelDe(k)) + marca + '</th>';
      }).join('');
      body.innerHTML = linhasOrdenadas().map((row) => {
        const cls = row.sos > 0 ? 'painel-row-sos' : row.alerta > 0 ? 'painel-row-alerta' : row.mensagem > 0 ? 'painel-row-msg' : '';
        const tds = cols.map((k) => '<td>' + celula(row, k) + '</td>').join('');
        return '<tr class="' + cls + '" data-id="' + esc(row.id) + '">' + tds + '</tr>';
      }).join('');
    }
    if (resumo) {
      const quando = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      resumo.textContent = linhas.length + ' viagem(ns) · atualizado ' + quando
        + ' · a cada 5 min · parado até ' + paradoAte + ' km/h';
    }
  }

  async function salvarLayout(atual, silencioso) {
    layout = atual;
    renderGrade();
    try {
      const r = await fetch('/api/mapa-viagem/painel/layout', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ layout: atual })
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (data.layout) layout = data.layout;
      renderGrade();
    } catch (err) {
      if (!silencioso) console.warn('[Painel] layout não salvo', err);
    }
  }

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function preencherSort(select, atual) {
    if (!select) return;
    const opts = [{ key: 'pendencias', label: 'Pendências primeiro' }].concat(catalogo);
    select.innerHTML = opts.map((c) => {
      return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>';
    }).join('');
    select.value = atual && atual.sort ? atual.sort.key : 'pendencias';
  }

  function desenharLista() {
    const ul = document.getElementById('painelColunasLista');
    const busca = (document.getElementById('painelColunasBusca')?.value || '').trim().toLowerCase();
    if (!ul || !rascunho) return;
    ul.innerHTML = rascunho.order.map((key) => {
      const c = catalogo.find((x) => x.key === key);
      if (!c) return '';
      if (busca && (c.label + ' ' + c.grupo).toLowerCase().indexOf(busca) < 0) return '';
      const on = rascunho.visible[key] ? ' checked' : '';
      return '<li class="painel-col-item" draggable="true" data-key="' + esc(key) + '">'
        + '<input type="checkbox" data-key="' + esc(key) + '"' + on + ' aria-label="' + esc(c.label) + '">'
        + '<label>' + esc(c.label) + '</label>'
        + '<span class="painel-col-grupo">' + esc(c.grupo) + '</span>'
        + '<button type="button" class="btn btn-secondary" data-move="up" data-key="' + esc(key) + '" aria-label="Subir">↑</button>'
        + '<button type="button" class="btn btn-secondary" data-move="down" data-key="' + esc(key) + '" aria-label="Descer">↓</button>'
        + '</li>';
    }).join('');
  }

  function mover(key, dir) {
    if (!rascunho) return;
    const i = rascunho.order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rascunho.order.length) return;
    const tmp = rascunho.order[i];
    rascunho.order[i] = rascunho.order[j];
    rascunho.order[j] = tmp;
    desenharLista();
  }

  function abrirColunas() {
    rascunho = clonar(layout);
    preencherSort(document.getElementById('painelSortKey'), rascunho);
    const dir = document.getElementById('painelSortDir');
    if (dir) dir.value = rascunho.sort && rascunho.sort.dir === 'asc' ? 'asc' : 'desc';
    const busca = document.getElementById('painelColunasBusca');
    if (busca) busca.value = '';
    desenharLista();
    const overlay = document.getElementById('painelColunasOverlay');
    if (overlay) overlay.hidden = false;
  }

  function fecharColunas() {
    const overlay = document.getElementById('painelColunasOverlay');
    if (overlay) overlay.hidden = true;
    rascunho = null;
  }

  async function carregarLayout() {
    try {
      const r = await fetch('/api/mapa-viagem/painel/layout', { headers: authHeaders(), cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.catalogo) && data.catalogo.length) catalogo = data.catalogo;
      if (data.layout) layout = data.layout;
      if (data.paradoAteKmh) paradoAte = data.paradoAteKmh;
    } catch (_) { /* usa o que já está */ }
  }

  async function recarregar(opts) {
    const silent = opts && opts.silent;
    const vazio = document.getElementById('painelViagensVazio');
    if (!silent && vazio) {
      vazio.hidden = false;
      vazio.textContent = 'Montando a grade...';
      const tabela = document.getElementById('painelViagensTabela');
      if (tabela) tabela.hidden = true;
    }
    try {
      const filtros = typeof window.mapaViagemColetarFiltros === 'function'
        ? window.mapaViagemColetarFiltros()
        : {};
      const params = new URLSearchParams();
      Object.keys(filtros).forEach((k) => {
        if (filtros[k]) params.append(k, filtros[k]);
      });
      params.append('_ts', String(Date.now()));
      const r = await fetch('/api/mapa-viagem/painel?' + params.toString(), {
        headers: authHeaders(),
        cache: 'no-store'
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      linhas = data.rows || [];
      if (data.paradoAteKmh) paradoAte = data.paradoAteKmh;
      carregou = true;
      renderGrade();
      if (data.truncado && vazio) {
        /* a grade já mostra as 300 primeiras */
      }
    } catch (err) {
      console.warn('[Painel]', err);
      if (!silent && vazio) {
        vazio.hidden = false;
        vazio.textContent = 'Não foi possível montar a grade.';
      }
    }
  }

  function limpar() {
    linhas = [];
    carregou = false;
    renderGrade();
    const resumo = document.getElementById('painelViagensResumo');
    if (resumo) resumo.textContent = 'Filtre para montar a grade. Parado: última velocidade até ' + paradoAte + ' km/h. O km segue o roteiro.';
  }

  function layoutPadraoLocal() {
    return {
      version: 1,
      order: catalogo.map((c) => c.key),
      visible: Object.fromEntries(catalogo.map((c) => [c.key, [
        'viagem', 'placa', 'motorista', 'situacao', 'prazo', 'movimento', 'velocidade',
        'alerta', 'sos', 'mensagem', 'proximoPonto', 'kmProximo', 'kmRodado', 'kmFalta',
        'macro', 'dhPosicao'
      ].includes(c.key)])),
      sort: { key: 'pendencias', dir: 'desc' }
    };
  }

  function bind() {
    document.getElementById('btnPainelColunas')?.addEventListener('click', abrirColunas);
    document.getElementById('btnPainelAtualizar')?.addEventListener('click', () => { void recarregar({ silent: false }); });
    document.getElementById('painelColunasFechar')?.addEventListener('click', fecharColunas);
    document.getElementById('painelColunasOverlay')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'painelColunasOverlay') fecharColunas();
    });
    document.getElementById('painelColunasBusca')?.addEventListener('input', desenharLista);
    document.getElementById('painelColunasPadrao')?.addEventListener('click', () => {
      rascunho = layoutPadraoLocal();
      preencherSort(document.getElementById('painelSortKey'), rascunho);
      const dir = document.getElementById('painelSortDir');
      if (dir) dir.value = 'desc';
      desenharLista();
    });
    document.getElementById('painelColunasSalvar')?.addEventListener('click', () => {
      if (!rascunho) return;
      const key = document.getElementById('painelSortKey')?.value || 'pendencias';
      const dir = document.getElementById('painelSortDir')?.value === 'asc' ? 'asc' : 'desc';
      rascunho.sort = { key, dir };
      const pronto = clonar(rascunho);
      fecharColunas();
      void salvarLayout(pronto, false);
    });
    document.getElementById('painelColunasLista')?.addEventListener('change', (ev) => {
      const input = ev.target;
      if (!input || input.type !== 'checkbox' || !rascunho) return;
      rascunho.visible[input.getAttribute('data-key')] = input.checked;
    });
    document.getElementById('painelColunasLista')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-move]');
      if (!btn) return;
      mover(btn.getAttribute('data-key'), btn.getAttribute('data-move') === 'up' ? -1 : 1);
    });
    const lista = document.getElementById('painelColunasLista');
    lista?.addEventListener('dragstart', (ev) => {
      const li = ev.target.closest('.painel-col-item');
      dragKey = li ? li.getAttribute('data-key') : null;
    });
    lista?.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    lista?.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const li = ev.target.closest('.painel-col-item');
      const alvo = li ? li.getAttribute('data-key') : null;
      if (!dragKey || !alvo || dragKey === alvo || !rascunho) return;
      const order = rascunho.order.filter((k) => k !== dragKey);
      const i = order.indexOf(alvo);
      order.splice(i, 0, dragKey);
      rascunho.order = order;
      dragKey = null;
      desenharLista();
    });
    document.getElementById('painelViagensHead')?.addEventListener('click', (ev) => {
      const th = ev.target.closest('th[data-col]');
      if (!th || !layout) return;
      const key = th.getAttribute('data-col');
      const mesmo = layout.sort && layout.sort.key === key;
      const dir = mesmo && layout.sort.dir === 'desc' ? 'asc' : 'desc';
      const proximo = clonar(layout);
      proximo.sort = { key, dir };
      void salvarLayout(proximo, true);
    });
    document.getElementById('painelViagensBody')?.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      if (typeof window.mapaViagemFocarViagem === 'function') {
        window.mapaViagemFocarViagem(tr.getAttribute('data-id'));
      }
    });
  }

  window.mapaViagemPainelRecarregar = recarregar;
  window.mapaViagemPainelLimpar = limpar;

  catalogo = [
    { key: 'viagem', label: 'Viagem', grupo: 'Viagem' },
    { key: 'placa', label: 'Placa', grupo: 'Viagem' },
    { key: 'motorista', label: 'Motorista', grupo: 'Viagem' },
    { key: 'situacao', label: 'Situação', grupo: 'Viagem' },
    { key: 'prazo', label: 'Prazo', grupo: 'Operação' },
    { key: 'tipo', label: 'Tipo', grupo: 'Viagem' },
    { key: 'origem', label: 'Origem', grupo: 'Rota' },
    { key: 'destino', label: 'Destino', grupo: 'Rota' },
    { key: 'roteiro', label: 'Roteiro', grupo: 'Rota' },
    { key: 'movimento', label: 'Movimento', grupo: 'Posição' },
    { key: 'velocidade', label: 'Última velocidade', grupo: 'Posição' },
    { key: 'dhPosicao', label: 'Última posição', grupo: 'Posição' },
    { key: 'posicao', label: 'Local da posição', grupo: 'Posição' },
    { key: 'noMapa', label: 'No mapa', grupo: 'Posição' },
    { key: 'macro', label: 'Última macro', grupo: 'Operação' },
    { key: 'dhMacro', label: 'Hora da macro', grupo: 'Operação' },
    { key: 'alerta', label: 'Alerta em aberto', grupo: 'Pendências' },
    { key: 'sos', label: 'SOS em aberto', grupo: 'Pendências' },
    { key: 'mensagem', label: 'Mensagem sem leitura', grupo: 'Pendências' },
    { key: 'proximoPonto', label: 'Próximo ponto', grupo: 'Rota' },
    { key: 'tipoProximo', label: 'Tipo do próximo ponto', grupo: 'Rota' },
    { key: 'kmProximo', label: 'Km próx. ponto', grupo: 'Rota' },
    { key: 'kmRodado', label: 'Km rodado', grupo: 'Rota' },
    { key: 'kmFalta', label: 'Km faltante', grupo: 'Rota' },
    { key: 'kmTotal', label: 'Km do roteiro', grupo: 'Rota' }
  ];
  layout = layoutPadraoLocal();
  bind();
  void carregarLayout().then(renderGrade);
})();
