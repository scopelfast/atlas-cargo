// backend/public/modulos/gerenciar-mapa-viagem/js/script.js
// Mapa de Viagem - Frontend
// Versão: 1.0
// Atlas Cargo

(function() {
  // Não usar flag global em window: ao voltar pelo menu do dashboard o HTML é novo, mas window persiste;
  // um guard global impedia registrar listeners e rodar init() de novo (mapa/filtros “mortos”).

  try {
    if (window.__mapaViagemMaxRefreshTimer != null) {
      clearInterval(window.__mapaViagemMaxRefreshTimer);
      window.__mapaViagemMaxRefreshTimer = null;
    }
    if (window.__mapaViagemNormalPollTimer != null) {
      clearInterval(window.__mapaViagemNormalPollTimer);
      window.__mapaViagemNormalPollTimer = null;
    }
  } catch (e) { /* ignore */ }

  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const tx = (k, fallback) => {
    const v = t(k);
    return v && v !== k ? v : fallback;
  };
  const filtroForm = document.getElementById('filtroForm');

  function getAuthHeadersMapa(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) { /* ignore */ }
    return headers;
  }
  
  let mapa = null;
  let marcadoresVeiculos = [];
  let contagemCoordMarcador = new Map();
  /** Camadas do traçado do roteiro (polilinha + paradas) ao clicar em um veículo */
  let grupoTrajetoRoteiro = null;
  /** Marcador cuja rota está exibida (para alternar ao clicar de novo ou limpar ao clicar no mapa). */
  let marcadorRotaAtivo = null;
  /** Incrementado ao iniciar novo traçado ou ao cancelar (mapa / toggle); evita rota “fantasma” após await. */
  let tokenDesenhoRota = 0;

  function invalidarDesenhosRotaPendentes() {
    tokenDesenhoRota++;
  }
  let veiculosData = [];
  let sqlExecutado = false;
  let paisesLista = [];
  let mapaFiltrosPaisInicializado = false;
  let tiposViagem = [];
  let classesFrota = [];
  let contratadores = [];
  let roteiros = [];
  let contextoMapa = { locale: 'pt-BR', timezone: 'America/Sao_Paulo', paisSigla: 'BR' };
  /** Incrementado a cada carga; respostas de requisições “antigas” não alteram o mapa (sem abortar fetch: evita sumir veículo ao filtrar). */
  let carregarVeiculosGen = 0;
  let carregarVeiculosLegendaDebounceT = null;
  /** Atualização automática só em tela cheia (ms). */
  const MAPA_MAX_AUTO_REFRESH_MS = 60000;
  /** Atualização automática na aba Mapa (modo normal), quando já houve carga com filtros */
  const MAPA_NORMAL_AUTO_REFRESH_MS = 30000;
  let mapaViagemPollPermitido = false;

  /** Cor do pin por FGSITVIAGEM (situação operacional) */
  const COR_FGSIT_MAPA = {
    T: '#2980b9',
    P: '#9b59b6',
    D: '#f39c12',
    E: '#16a085',
    M: '#8e44ad',
    F: '#7f8c8d',
    A: '#27ae60',
    C: '#e74c3c',
    default: '#3498db'
  };
  const ROTULO_FGSIT_MAPA = {
    A: 'Aprovada',
    C: 'Cancelada',
    D: 'Preparação',
    E: 'Final de rota',
    F: 'Viagem finalizada',
    M: 'Emissão documentos',
    P: 'Programada',
    T: 'Em trânsito'
  };

  function corPinPorFgsit(veiculo) {
    const raw = veiculo && (veiculo.FGSITVIAGEM != null ? veiculo.FGSITVIAGEM : veiculo.fgsitviagem);
    const k = raw != null ? String(raw).trim().toUpperCase() : '';
    return COR_FGSIT_MAPA[k] || COR_FGSIT_MAPA.default;
  }

  function rotuloFgsit(cod) {
    const k = cod != null ? String(cod).trim().toUpperCase() : '';
    return ROTULO_FGSIT_MAPA[k] || (k ? `Código ${k}` : '—');
  }

  /** Preenchido por /api/configuracoes/mapa → alertOfflineMinutos (mesmo “Offline (min)” dos Alertas). */
  let mapaPosicaoStaleMinutosCache = null;

  async function carregarConfigMapaETempoPosicao() {
    try {
      const headers = {};
      const token = localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const r = await fetch('/api/configuracoes/mapa', { headers });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const m = parseInt(d.alertOfflineMinutos, 10);
      if (Number.isFinite(m) && m >= 1 && m <= 1440) {
        mapaPosicaoStaleMinutosCache = m;
      } else {
        mapaPosicaoStaleMinutosCache = 90;
      }
      if (window.MAP_CONFIG) window.MAP_CONFIG.posicaoStaleMinutos = mapaPosicaoStaleMinutosCache;
    } catch (e) {
      const fallback =
        (window.MAP_CONFIG && typeof window.MAP_CONFIG.posicaoStaleMinutos === 'number' && window.MAP_CONFIG.posicaoStaleMinutos > 0)
          ? window.MAP_CONFIG.posicaoStaleMinutos
          : 90;
      mapaPosicaoStaleMinutosCache = mapaPosicaoStaleMinutosCache != null ? mapaPosicaoStaleMinutosCache : fallback;
      if (window.MAP_CONFIG) window.MAP_CONFIG.posicaoStaleMinutos = mapaPosicaoStaleMinutosCache;
    }
    atualizarLegendaMinutosStaleNoHtml();
  }

  function minutosPosicaoStaleLimite() {
    if (mapaPosicaoStaleMinutosCache != null && mapaPosicaoStaleMinutosCache > 0) {
      return mapaPosicaoStaleMinutosCache;
    }
    const mc = window.MAP_CONFIG && window.MAP_CONFIG.posicaoStaleMinutos;
    if (typeof mc === 'number' && mc > 0) return mc;
    return 90;
  }

  /** Viagem encerrada na torre: GPS é histórico, não “offline operacional”. */
  function situacaoEncerradaMapa(veiculo) {
    const k = String(
      (veiculo && (veiculo.FGSITVIAGEM != null ? veiculo.FGSITVIAGEM : veiculo.fgsitviagem)) || ''
    )
      .trim()
      .toUpperCase();
    return k === 'C' || k === 'F';
  }

  /** Sem data válida ou último sinal além do prazo (minutos) em Configurações → Alertas → Offline. */
  function posicaoRastreamentoDesatualizada(veiculo) {
    if (situacaoEncerradaMapa(veiculo)) return false;
    const dh = veiculo.DHPOSICAO != null ? veiculo.DHPOSICAO : veiculo.dhposicao;
    if (dh == null || String(dh).trim() === '') return true;
    const d = new Date(dh);
    if (isNaN(d.getTime())) return true;
    const mins = (Date.now() - d.getTime()) / 60000;
    return mins > minutosPosicaoStaleLimite();
  }

  function textoAntiguidadePosicaoPopup(veiculo) {
    const lim = minutosPosicaoStaleLimite();
    const dh = veiculo.DHPOSICAO != null ? veiculo.DHPOSICAO : veiculo.dhposicao;
    const encerrada = situacaoEncerradaMapa(veiculo);
    if (dh == null || String(dh).trim() === '') {
      return encerrada
        ? 'Viagem encerrada — sem posição GPS registrada.'
        : `Sem data do último sinal (prazo ${lim} min).`;
    }
    const d = new Date(dh);
    if (isNaN(d.getTime())) return 'Data do último sinal inválida.';
    const mins = (Date.now() - d.getTime()) / 60000;
    const idade = formatarDuracaoRelativaMinutos(mins);
    if (encerrada) {
      return `Posição histórica (viagem encerrada). Último GPS há ${idade}.`;
    }
    if (mins <= lim) {
      return `Último sinal há ${idade}.`;
    }
    return `Último sinal há ${idade} (prazo ${lim} min).`;
  }

  function escHtmlMapa(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Ex.: 187304 min → "130 dias" / "3 h 12 min". */
  function formatarDuracaoRelativaMinutos(mins) {
    const m = Math.max(0, Math.floor(Number(mins) || 0));
    if (m < 1) return 'menos de 1 min';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 48) return rm ? `${h} h ${rm} min` : `${h} h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    if (d < 90) return rh ? `${d} d ${rh} h` : `${d} ${d === 1 ? 'dia' : 'dias'}`;
    const mes = Math.floor(d / 30);
    return mes <= 1 ? 'cerca de 1 mês' : `cerca de ${mes} meses`;
  }

  function linhaPopupMapa(label, valor) {
    const v = valor == null || String(valor).trim() === '' ? '—' : String(valor);
    return (
      `<div class="mapa-viagem-popup-row">` +
      `<span class="mapa-viagem-popup-label">${escHtmlMapa(label)}</span>` +
      `<span class="mapa-viagem-popup-value">${escHtmlMapa(v)}</span>` +
      `</div>`
    );
  }

  function garantirCssPopupMapaViagem() {
    if (document.getElementById('mapa-viagem-popup-styles')) return;
    const s = document.createElement('style');
    s.id = 'mapa-viagem-popup-styles';
    s.textContent = `
      #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper {
        padding: 0;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 32px rgba(15, 23, 42, 0.32);
      }
      #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content {
        margin: 0 !important;
        min-width: 260px;
        max-width: 320px;
      }
      #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip {
        background: #fff;
      }
      .mapa-viagem-popup-alerta {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        padding: 10px 12px;
        margin: 0 0 10px 0;
        border-radius: 8px;
        background: #fff7ed;
        color: #9a3412;
        font: 600 12px/1.4 system-ui, Segoe UI, sans-serif;
        border: 1px solid #fed7aa;
      }
      .mapa-viagem-popup-alerta--ok {
        background: #f0fdf4;
        color: #166534;
        border-color: #bbf7d0;
      }
      .mapa-viagem-popup-alerta--hist {
        background: #f1f5f9;
        color: #334155;
        border-color: #cbd5e1;
      }
      .mapa-viagem-popup-row {
        display: grid;
        grid-template-columns: 92px 1fr;
        gap: 8px;
        padding: 7px 0;
        border-bottom: 1px solid #e2e8f0;
        font: 400 13px/1.4 system-ui, Segoe UI, sans-serif;
      }
      .mapa-viagem-popup-row:last-child { border-bottom: 0; padding-bottom: 0; }
      .mapa-viagem-popup-label {
        color: #64748b;
        font-weight: 600;
        font-size: 12px;
      }
      .mapa-viagem-popup-value {
        color: #0f172a;
        word-break: break-word;
      }
      .mapa-viagem-popup-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        font: 700 11px/1.4 system-ui, Segoe UI, sans-serif;
        color: #fff;
      }
      [data-theme="dark"] #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper,
      [data-theme="dark"] #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip {
        background: #1e293b;
      }
      [data-theme="dark"] .mapa-viagem-popup-row { border-bottom-color: #334155; }
      [data-theme="dark"] .mapa-viagem-popup-label { color: #94a3b8; }
      [data-theme="dark"] .mapa-viagem-popup-value { color: #e2e8f0; }
      [data-theme="dark"] .mapa-viagem-popup-alerta {
        background: #431407;
        color: #fdba74;
        border-color: #9a3412;
      }
      [data-theme="dark"] .mapa-viagem-popup-alerta--ok {
        background: #14532d;
        color: #86efac;
        border-color: #166534;
      }
    `;
    document.head.appendChild(s);
  }

  function montarPopupVeiculoMapa(veiculo, lat, lon, corPin, posicaoStale) {
    garantirCssPopupMapaViagem();
    const placa = veiculo.PLACA != null ? String(veiculo.PLACA).trim() : '';
    const idViagem = veiculo.VIAGEM != null ? veiculo.VIAGEM : veiculo.viagem;
    const dsTipo = veiculo.DSTIPOVIAGEM != null ? veiculo.DSTIPOVIAGEM : veiculo.dstipoviagem;
    const fgRaw = veiculo.FGSITVIAGEM != null ? veiculo.FGSITVIAGEM : veiculo.fgsitviagem;
    const sitLabel = rotuloFgsit(fgRaw);
    const motorista = veiculo.NMMOTORISTA != null ? veiculo.NMMOTORISTA : veiculo.nmmotorista;
    const roteiro = veiculo.DSROTEIRO != null ? veiculo.DSROTEIRO : veiculo.dsroteiro;
    const posicao = veiculo.DSPOSICAO != null ? veiculo.DSPOSICAO : veiculo.dsposicao;
    const titulo = placa
      ? placa.toUpperCase()
      : idViagem != null && String(idViagem).trim() !== ''
        ? `Viagem #${idViagem}`
        : 'Posição no mapa';
    const sub = placa && idViagem != null
      ? `Viagem #${idViagem}`
      : (dsTipo ? String(dsTipo) : sitLabel);
    const txtAntiguidade = textoAntiguidadePosicaoPopup(veiculo);
    const encerrada = situacaoEncerradaMapa(veiculo);
    const alertaCls = encerrada
      ? 'mapa-viagem-popup-alerta mapa-viagem-popup-alerta--hist'
      : posicaoStale
        ? 'mapa-viagem-popup-alerta'
        : 'mapa-viagem-popup-alerta mapa-viagem-popup-alerta--ok';
    const alertaIcon = encerrada ? 'ℹ' : posicaoStale ? '⚠' : '✓';
    const sitHtml =
      `<span class="mapa-viagem-popup-badge" style="background:${escHtmlMapa(corPin)};">${escHtmlMapa(sitLabel)}</span>`;

    const body =
      `<div class="${alertaCls}"><span aria-hidden="true">${alertaIcon}</span><span>${escHtmlMapa(txtAntiguidade)}</span></div>` +
      `<div class="mapa-viagem-popup-row"><span class="mapa-viagem-popup-label">Situação</span><span class="mapa-viagem-popup-value">${sitHtml}</span></div>` +
      (dsTipo ? linhaPopupMapa('Tipo', dsTipo) : '') +
      (idViagem != null ? linhaPopupMapa('Viagem', `#${idViagem}`) : '') +
      linhaPopupMapa('Motorista', motorista) +
      linhaPopupMapa('Roteiro', roteiro) +
      linhaPopupMapa('Posição', posicao) +
      linhaPopupMapa('Data/Hora', formatarDataHora(veiculo.DHPOSICAO != null ? veiculo.DHPOSICAO : veiculo.dhposicao)) +
      linhaPopupMapa('Coordenadas', `${lat.toFixed(6)}, ${lon.toFixed(6)}`);

    return (
      `<div class="atlas-map-popup mapa-viagem-popup">` +
      `<div class="atlas-map-popup-head" style="background:${escHtmlMapa(corPin)};">` +
      `<span class="atlas-map-popup-title">${escHtmlMapa(titulo)}` +
      (sub ? `<br><small style="font-weight:600;opacity:.9;font-size:12px;">${escHtmlMapa(sub)}</small>` : '') +
      `</span>` +
      `<button type="button" class="atlas-map-popup-close" aria-label="Fechar" title="Fechar">` +
      `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">` +
      `<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
      `</svg></button></div>` +
      `<div class="atlas-map-popup-body">${body}</div></div>`
    );
  }

  function atualizarLegendaMinutosStaleNoHtml() {
    const lim = minutosPosicaoStaleLimite();
    const row = document.querySelector('.mapa-legenda-posicao-compact');
    if (row) {
      row.title = `Atualizada: último sinal até ${lim} min (Configurações → Alertas → Offline). Desatualizada: sem data ou acima desse prazo.`;
    }
  }

  function atualizarLegendaContagemPosicaoNoMapa() {
    const el = document.getElementById('mapaLegendaContagemPosicao');
    if (!el) return;
    if (!marcadoresVeiculos.length) {
      el.textContent = '';
      return;
    }
    let ok = 0;
    let st = 0;
    marcadoresVeiculos.forEach((m) => {
      if (m._mapaPosicaoStale) st += 1;
      else ok += 1;
    });
    el.textContent = `Neste mapa: ${ok} com posição atualizada · ${st} com posição desatualizada.`;
  }

  function coletarFiltrosMapaObjeto() {
    return {
      idViagem: document.getElementById('filtroIdViagem')?.value || '',
      tipoViagem: document.getElementById('filtroTipoViagem')?.value || '',
      situacaoViagem: document.getElementById('filtroSituacaoViagem')?.value || '',
      classeFrota: document.getElementById('filtroClasseFrota')?.value || '',
      contratador: document.getElementById('filtroContratador')?.value || '',
      origemPais: document.getElementById('filtroOrigemPais')?.value || '',
      destinoPais: document.getElementById('filtroDestinoPais')?.value || '',
      origemEstado: document.getElementById('filtroOrigemEstado')?.value || '',
      origemCidade: document.getElementById('filtroOrigemCidade')?.value || '',
      destinoEstado: document.getElementById('filtroDestinoEstado')?.value || '',
      destinoCidade: document.getElementById('filtroDestinoCidade')?.value || '',
      roteiro: document.getElementById('filtroRoteiro')?.value || '',
      dataInicio: document.getElementById('filtroDataInicio')?.value || '',
      dataFim: document.getElementById('filtroDataFim')?.value || '',
      rastreado: document.getElementById('filtroRastreado')?.value || '',
      motoristaConfirmado: document.getElementById('filtroMotoristaConfirmado')?.value || ''
    };
  }

  function filtrosMapaParaParams(filtros) {
    const params = new URLSearchParams();
    Object.keys(filtros).forEach((key) => {
      if (filtros[key]) params.append(key, filtros[key]);
    });
    return params;
  }

  function alternarPainelResumoMapa(mostrar) {
    const ph = document.getElementById('mapaResumoPlaceholder');
    const cards = document.getElementById('mapaResumoCards');
    const am = document.getElementById('mapaAmostrasViagem');
    const leg = document.getElementById('mapaLegendaWrap');
    const legPos = document.getElementById('mapaLegendaPosicaoFloat');
    const mapaInfo = document.getElementById('mapaInfo');
    if (ph) ph.style.display = mostrar ? 'none' : 'block';
    if (cards) cards.style.display = mostrar ? 'grid' : 'none';
    if (am) am.style.display = mostrar ? 'grid' : 'none';
    if (leg) leg.style.display = mostrar ? 'block' : 'none';
    if (legPos) legPos.style.display = mostrar ? 'block' : 'none';
    if (mapaInfo) mapaInfo.style.display = mostrar ? 'none' : 'flex';
    if (!mostrar) {
      const selo = document.getElementById('mapaLegendaDadosAtualizados');
      if (selo) {
        selo.textContent = '';
        selo.removeAttribute('datetime');
        selo.classList.remove('mapa-legenda-dados-atualizados--loading');
      }
    }
  }

  /** Barra inferior: só avisos (roteiro, erro); oculta quando o painel de resumo/legenda está ativo */
  function mostrarAvisoMapaInfo(msg) {
    const wrap = document.getElementById('mapaInfo');
    const infoText = document.getElementById('mapaInfoText');
    if (!wrap || !infoText) return;
    wrap.style.display = 'flex';
    infoText.textContent = msg;
  }

  function atualizarSeloDadosAtualizadosNaLegenda(opts = {}) {
    const el = document.getElementById('mapaLegendaDadosAtualizados');
    if (!el) return;
    if (opts.loading) {
      el.textContent = tx('web.modulos.mapaViagem.atualizandoPosicoes', 'Atualizando…');
      el.removeAttribute('datetime');
      el.classList.add('mapa-legenda-dados-atualizados--loading');
      return;
    }
    el.classList.remove('mapa-legenda-dados-atualizados--loading');
    const now = opts.date instanceof Date ? opts.date : new Date();
    el.setAttribute('datetime', now.toISOString());
    const agora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `${tx('web.modulos.mapaViagem.dadosAtualizadosAs', 'Dados atualizados às')} ${agora}`;
  }

  function renderizarResumoMapa(data) {
    const cards = document.getElementById('mapaResumoCards');
    const amostras = document.getElementById('mapaAmostrasViagem');
    const legSit = document.getElementById('mapaLegendaSituacao');
    const legTipo = document.getElementById('mapaLegendaTipo');
    if (!cards || !data) {
      alternarPainelResumoMapa(false);
      return;
    }

    alternarPainelResumoMapa(true);

    const tv = Number(data.totalViagens) || 0;
    const cg = Number(data.comGps) || 0;
    const sv = Number(data.semVeiculo) || 0;
    const sp = Number(data.comVeiculoSemPosicao) || 0;

    cards.innerHTML = `
      <div class="dashboard-stat-card primary">
        <div class="stat-card-icon"><i class="bx bx-trip" aria-hidden="true"></i></div>
        <div class="stat-card-content">
          <h4>${tx('web.modulos.mapaViagem.resumoTotalViagens', 'Viagens no recorte (filtros)')}</h4>
          <p class="stat-value">${tv}</p>
          <span class="stat-label">${tx('web.modulos.mapaViagem.resumoCardSubRecorte', 'Total no recorte filtrado')}</span>
        </div>
      </div>
      <div class="dashboard-stat-card info">
        <div class="stat-card-icon"><i class="bx bx-map-alt" aria-hidden="true"></i></div>
        <div class="stat-card-content">
          <h4>${tx('web.modulos.mapaViagem.resumoNoMapa', 'Com posição no mapa')}</h4>
          <p class="stat-value">${cg}</p>
          <span class="stat-label">${tx('web.modulos.mapaViagem.resumoCardSubComGps', 'Com GPS exibido no mapa')}</span>
        </div>
      </div>
      <div class="dashboard-stat-card warning">
        <div class="stat-card-icon"><i class="bx bx-unlink" aria-hidden="true"></i></div>
        <div class="stat-card-content">
          <h4>${tx('web.modulos.mapaViagem.resumoSemVeiculo', 'Sem veículo vinculado')}</h4>
          <p class="stat-value">${sv}</p>
          <span class="stat-label">${tx('web.modulos.mapaViagem.resumoCardSubSemVeiculo', 'Viagens sem veículo associado')}</span>
        </div>
      </div>
      <div class="dashboard-stat-card warning">
        <div class="stat-card-icon"><i class="bx bx-wifi-off" aria-hidden="true"></i></div>
        <div class="stat-card-content">
          <h4>${tx('web.modulos.mapaViagem.resumoSemPosicao', 'Com veículo, sem GPS no mapa')}</h4>
          <p class="stat-value">${sp}</p>
          <span class="stat-label">${tx('web.modulos.mapaViagem.resumoCardSubSemGps', 'Sem coordenadas no mapa')}</span>
        </div>
      </div>
    `;

    if (amostras) {
      const idsSv = data.amostraSemVeiculo || [];
      const idsSp = data.amostraSemPosicao || [];
      const linhasSv = idsSv.length
        ? `<ul>${idsSv.map((x) => `<li><a href="#" class="mapa-link-viagem" data-id-viagem="${x.idViagem}">#${x.idViagem}</a></li>`).join('')}</ul>`
        : `<p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">${tx('web.modulos.mapaViagem.resumoNenhumaAmostra', 'Nenhuma na amostra.')}</p>`;
      const linhasSp = idsSp.length
        ? `<ul>${idsSp.map((x) => `<li><a href="#" class="mapa-link-viagem" data-id-viagem="${x.idViagem}">#${x.idViagem}</a></li>`).join('')}</ul>`
        : `<p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">${tx('web.modulos.mapaViagem.resumoNenhumaAmostra', 'Nenhuma na amostra.')}</p>`;
      amostras.innerHTML = `
        <div class="mapa-amostras-cols">
        <details>
          <summary>${tx('web.modulos.mapaViagem.resumoTituloSemVeiculo', 'IDs — sem veículo')} (${sv})</summary>
          ${linhasSv}
        </details>
        <details>
          <summary>${tx('web.modulos.mapaViagem.resumoTituloSemPosicao', 'IDs — com veículo, sem posição')} (${sp})</summary>
          ${linhasSp}
        </details>
        </div>
      `;
    }

    const selSit = document.getElementById('filtroSituacaoViagem');
    const selTipo = document.getElementById('filtroTipoViagem');
    const ativoSit = (selSit && selSit.value) || '';
    const ativoTipo = (selTipo && selTipo.value) || '';

    if (legSit) {
      const porSit = data.porSituacaoNoMapa || [];
      legSit.innerHTML = porSit
        .map((row) => {
          const fg = (row.fgsit || '').trim();
          const cor = COR_FGSIT_MAPA[fg.toUpperCase()] || COR_FGSIT_MAPA.default;
          const nome = rotuloFgsit(fg);
          const ativo = ativoSit === fg ? ' mapa-legenda-chip--ativo' : '';
          return `<button type="button" class="mapa-legenda-chip${ativo}" data-fgsit="${fg}" title="${nome}">
            <span class="mapa-legenda-dot" style="background:${cor}"></span>
            <span>${nome}</span>
            <span style="opacity:0.85">(${row.qtd})</span>
          </button>`;
        })
        .join('');
    }

    if (legTipo) {
      const porTipo = data.porTipoNoMapa || [];
      legTipo.innerHTML = porTipo
        .map((row) => {
          const cd = row.cdTipo != null ? String(row.cdTipo) : '';
          const nome = (row.dsTipo && String(row.dsTipo).trim()) || `Tipo ${cd}`;
          const ativo = ativoTipo === cd ? ' mapa-legenda-chip--ativo' : '';
          return `<button type="button" class="mapa-legenda-chip${ativo}" data-cdtipo="${cd}" title="${nome}">
            <span>${nome}</span>
            <span style="opacity:0.85">(${row.qtd})</span>
          </button>`;
        })
        .join('');
    }

  }

  function esconderResumoMapa() {
    renderizarResumoMapa(null);
  }

  async function loadContextoMapa() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoMapa.locale = d.locale;
      if (d && d.timezone) contextoMapa.timezone = d.timezone;
      if (d && d.pais) contextoMapa.paisSigla = String(d.pais).trim().toUpperCase() || 'BR';
      else contextoMapa.paisSigla = 'BR';
    } catch (e) {
      contextoMapa.paisSigla = 'BR';
    }
  }

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-mapa-viagem/sql/init.sql', '/api/mapa-viagem/executar-init-sql', 'mapa-viagem');
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-mapa-viagem/sql/init.sql', '/api/mapa-viagem/executar-init-sql', 'mapa-viagem');
      return;
    }
    
    console.warn('[Mapa Viagem] executarInitSQLPadrao não disponível.');
  }

  /** IBGE CDUF por sigla — alinha filtro ao backend (parseInt CDUF), quando país = BR ou “Todos”. */
  const UF_PARA_CDUF_BR = {
    AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
    MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
    RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17
  };

  async function fillEstadosSelect(selectId, cdpaisVal) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${tx('web.modulos.mapaViagem.todosEstados', 'Todos')}</option>`;
    const cdp = cdpaisVal != null && String(cdpaisVal).trim() !== '' ? String(cdpaisVal).trim() : '';

    if (!cdp) {
      try {
        const response = await fetch('/api/estados-brasil', { headers: getAuthHeadersMapa() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const estados = await response.json();
        (Array.isArray(estados) ? estados : []).forEach((e) => {
          const uf = (e.uf || e.ESTADO || e.estado || '').toString().trim().toUpperCase();
          if (!uf) return;
          const cd = UF_PARA_CDUF_BR[uf];
          if (!cd) return;
          const opt = document.createElement('option');
          opt.value = String(cd);
          opt.textContent = `${uf} — ${e.nome || e.NMESTADO || e.nmestado || uf}`;
          sel.appendChild(opt);
        });
      } catch (err) {
        console.warn('[Mapa Viagem] Estados BR (fallback):', err.message);
      }
      return;
    }

    try {
      const response = await fetch(`/api/estados?cdpais=${encodeURIComponent(cdp)}&situacao=A`, {
        headers: getAuthHeadersMapa()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const estados = await response.json();
      (Array.isArray(estados) ? estados : []).forEach((e) => {
        const cduf = e.CDUF != null ? e.CDUF : e.cduf;
        const sig = (e.ESTADO != null ? e.ESTADO : e.estado || '').toString().trim();
        const nm = (e.NMESTADO != null ? e.NMESTADO : e.nmestado || sig || '').toString().trim();
        if (cduf == null || cduf === '') return;
        const opt = document.createElement('option');
        opt.value = String(cduf);
        opt.textContent = `${sig} — ${nm || sig}`;
        sel.appendChild(opt);
      });
    } catch (err) {
      console.warn('[Mapa Viagem] Estados por país:', err.message);
    }
  }

  function registrarListenersFiltroPais() {
    const oP = document.getElementById('filtroOrigemPais');
    const dP = document.getElementById('filtroDestinoPais');
    if (oP && !oP._mapaPaisBound) {
      oP._mapaPaisBound = true;
      oP.addEventListener('change', () => {
        const es = document.getElementById('filtroOrigemEstado');
        if (es) es.value = '';
        void fillEstadosSelect('filtroOrigemEstado', oP.value || '');
      });
    }
    if (dP && !dP._mapaPaisBound) {
      dP._mapaPaisBound = true;
      dP.addEventListener('change', () => {
        const es = document.getElementById('filtroDestinoEstado');
        if (es) es.value = '';
        void fillEstadosSelect('filtroDestinoEstado', dP.value || '');
      });
    }
  }

  async function loadPaisesCombos() {
    const selO = document.getElementById('filtroOrigemPais');
    const selD = document.getElementById('filtroDestinoPais');
    if (!selO || !selD) return;
    const optTodos = `<option value="">${tx('web.modulos.mapaViagem.todosPaises', 'Todos os países')}</option>`;
    selO.innerHTML = optTodos;
    selD.innerHTML = optTodos;
    paisesLista = [];
    try {
      const r = await fetch('/api/paises', { headers: getAuthHeadersMapa() });
      if (!r.ok) throw new Error(String(r.status));
      paisesLista = await r.json();
      if (!Array.isArray(paisesLista)) paisesLista = [];
      paisesLista
        .slice()
        .sort((a, b) =>
          String(a.DSPAIS ?? a.dspais ?? '').localeCompare(String(b.DSPAIS ?? b.dspais ?? ''), 'pt', { sensitivity: 'base' })
        )
        .forEach((p) => {
          const cdp = p.CDPAIS != null ? p.CDPAIS : p.cdpais;
          const dsp = p.DSPAIS != null ? p.DSPAIS : p.dspais;
          const sg = (p.SGPAIS != null ? p.SGPAIS : p.sgpais) || String(cdp);
          [selO, selD].forEach((s) => {
            const opt = document.createElement('option');
            opt.value = String(cdp);
            opt.textContent = `${dsp} (${sg})`;
            s.appendChild(opt);
          });
        });
    } catch (e) {
      console.warn('[Mapa Viagem] Países indisponíveis:', e.message);
    }

    if (!mapaFiltrosPaisInicializado) {
      mapaFiltrosPaisInicializado = true;
      const sig = (contextoMapa.paisSigla || 'BR').toUpperCase();
      const found = paisesLista.find(
        (p) => String(p.SGPAIS ?? p.sgpais ?? '').trim().toUpperCase() === sig
      );
      const cdp = found != null ? String(found.CDPAIS ?? found.cdpais ?? '') : '';
      if (cdp) {
        selO.value = cdp;
        selD.value = cdp;
      }
    }

    registrarListenersFiltroPais();
    await Promise.all([
      fillEstadosSelect('filtroOrigemEstado', selO.value || ''),
      fillEstadosSelect('filtroDestinoEstado', selD.value || '')
    ]);
    console.log('[Mapa Viagem] Países/UF filtros prontos (países:', paisesLista.length, ')');
  }

  // Carregar tipos de viagem
  async function loadTiposViagem() {
    try {
      const response = await fetch('/api/tipos-viagem-combo', { headers: getAuthHeadersMapa() });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const tipos = await response.json();
      tiposViagem = Array.isArray(tipos) ? tipos : [];
      
      const select = document.getElementById('filtroTipoViagem');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        tiposViagem.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.CDTIPOVIAGEM;
          opt.textContent = t.DSTIPOVIAGEM;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Tipos de viagem carregados:', tiposViagem.length);
      }
    } catch (err) {
      console.error('Erro ao carregar tipos de viagem:', err);
    }
  }

  // Carregar classes de frota
  async function loadClassesFrota() {
    try {
      const response = await fetch('/api/classes-frota-combo', { headers: getAuthHeadersMapa() });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const classes = await response.json();
      classesFrota = Array.isArray(classes) ? classes : [];
      
      const select = document.getElementById('filtroClasseFrota');
      if (select) {
        // Limpar opções existentes (exceto "Todas")
        select.innerHTML = '<option value="">Todas</option>';
        classesFrota.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCLASSEFROTA;
          opt.textContent = c.DSCLASSEFROTA;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Classes de frota carregadas:', classesFrota.length);
      }
    } catch (err) {
      console.error('Erro ao carregar classes de frota:', err);
    }
  }

  // Carregar contratadores
  async function loadContratadores() {
    try {
      const response = await fetch('/api/contratadores-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const contratadoresData = await response.json();
      contratadores = Array.isArray(contratadoresData) ? contratadoresData : [];
      
      const select = document.getElementById('filtroContratador');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        contratadores.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCADASTRO;
          opt.textContent = c.RZSOCIAL || c.NMFANTASIA || c.NOME || '';
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Contratadores carregados:', contratadores.length);
      }
    } catch (err) {
      console.error('Erro ao carregar contratadores:', err);
    }
  }

  // Carregar roteiros
  async function loadRoteiros() {
    try {
      const response = await fetch('/api/roteiros-combo');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const roteirosData = await response.json();
      roteiros = Array.isArray(roteirosData) ? roteirosData : [];
      
      const select = document.getElementById('filtroRoteiro');
      if (select) {
        // Limpar opções existentes (exceto "Todos")
        select.innerHTML = '<option value="">Todos</option>';
        roteiros.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.IDROTEIRO;
          opt.textContent = r.DSROTEIRO;
          select.appendChild(opt);
        });
        console.log('[Mapa Viagem] Roteiros carregados:', roteiros.length);
      }
    } catch (err) {
      console.error('Erro ao carregar roteiros:', err);
    }
  }

  // Event listener para roteiro
  document.getElementById('filtroRoteiro')?.addEventListener('change', function() {
    const roteiroId = this.value;
    const roteiro = roteiros.find(r => r.IDROTEIRO.toString() === roteiroId);
    const descInput = document.getElementById('filtroRoteiroDescricao');
    if (descInput) {
      descInput.value = roteiro ? roteiro.DSROTEIRO : '';
    }
  });

  // Função para carregar o Leaflet dinamicamente
  async function carregarLeaflet() {
    if (typeof L !== 'undefined') {
      return true;
    }

    return new Promise((resolve, reject) => {
      // Carregar CSS do Leaflet
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);

      // Carregar JavaScript do Leaflet
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = () => {
        console.log('✅ [Mapa Viagem] Leaflet carregado');
        resolve(true);
      };
      script.onerror = () => {
        console.error('❌ [Mapa Viagem] Erro ao carregar Leaflet');
        reject(false);
      };
      document.body.appendChild(script);
    });
  }

  // Inicializar mapa
  async function inicializarMapa() {
    const container = document.getElementById('mapaVeiculos');
    if (!container) return;

    // Verificar se o mapa já foi inicializado
    if (mapa) {
      console.log('✅ [Mapa Viagem] Mapa já está inicializado');
      return;
    }

    // Aguardar Leaflet
    await carregarLeaflet();
    
    if (typeof L === 'undefined') {
      console.error('❌ [Mapa Viagem] Leaflet não está disponível');
      container.innerHTML = '<p style="padding: 40px; text-align: center; color: #95a5a6;">' + t('web.modulos.mapaViagem.erroCarregar') + '</p>';
      return;
    }

    // Verificar se o container já tem um mapa (evitar erro de inicialização dupla)
    if (container._leaflet_id) {
      console.warn('⚠️ [Mapa Viagem] Container já tem um mapa. Removendo...');
      try {
        const existingMap = L.map('mapaVeiculos');
        existingMap.remove();
      } catch (e) {
        // Ignorar erro se não conseguir remover
      }
      // Limpar o ID do Leaflet
      delete container._leaflet_id;
    }

    // Criar mapa
    try {
      mapa = L.map('mapaVeiculos', {
        center: [-23.5505, -46.6333], // São Paulo (padrão)
        zoom: 5,
        zoomControl: true
      });

      // Tiles: usar getTileServerUrl() global (map-config.js), não MAP_CONFIG.getTileServerUrl (não existe).
      // Fallback OSM direto (tile.openstreetmap.org) bloqueia em muitos ambientes por política de Referer.
      const tileUrl = (typeof window.getTileServerUrl === 'function' && window.getTileServerUrl())
        || window.MAP_CONFIG?.tileServer
        || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
      const attribution = window.MAP_CONFIG?.attribution
        || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
      L.tileLayer(tileUrl, {
        attribution,
        maxZoom: window.MAP_CONFIG?.maxZoom || 19
      }).addTo(mapa);

      mapa.on('click', () => {
        invalidarDesenhosRotaPendentes();
        limparTrajetoRoteiro();
        marcadorRotaAtivo = null;
        centralizarMapaNosVeiculos();
      });

      // Ajustar tamanho do mapa quando a aba for exibida
      const observer = new MutationObserver(() => {
        if (mapa && document.getElementById('tab-mapa')?.classList.contains('active')) {
          setTimeout(() => {
            mapa.invalidateSize();
          }, 100);
        }
      });
      
      const mapaTab = document.getElementById('tab-mapa');
      if (mapaTab) {
        observer.observe(mapaTab, { attributes: true, attributeFilter: ['class'] });
      }

      console.log('✅ [Mapa Viagem] Mapa inicializado');
    } catch (err) {
      console.error('❌ [Mapa Viagem] Erro ao inicializar mapa:', err);
      mapa = null;
    }
  }

  function limparTrajetoRoteiro() {
    if (grupoTrajetoRoteiro && mapa) {
      try {
        mapa.removeLayer(grupoTrajetoRoteiro);
      } catch (e) { /* ignore */ }
      grupoTrajetoRoteiro = null;
    }
    sincronizarEstiloMarcadoresVeiculos();
  }

  /** Triângulo de alerta (posição desatualizada); anel usa cor da situação quando houver. */
  function criarIconeTrianguloAlertaPosicao(corSituacao) {
    const ring = corSituacao && String(corSituacao).trim() ? corSituacao : '#c2410c';
    const w = 32;
    const h = 34;
    const html = `<svg width="${w}" height="${h}" viewBox="0 0 32 34" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible" aria-hidden="true">
      <path d="M16 3 L29 27 Q16 31 16 31 Q16 31 3 27 Z" fill="#f59e0b" stroke="${ring}" stroke-width="2.5"/>
      <text x="16" y="22" text-anchor="middle" fill="#fff" font-size="15" font-weight="800" font-family="system-ui,sans-serif">!</text>
    </svg>`;
    return L.divIcon({
      className: 'veiculo-marker veiculo-marker--alerta-posicao',
      html,
      iconSize: [w, h],
      iconAnchor: [w / 2, h],
      popupAnchor: [0, -h + 4]
    });
  }

  /**
   * Ícone em formato de “pin” de veículo ou triângulo de alerta se posição desatualizada.
   * @param {'normal'|'ativo'|'esmaecido'} variante
   * @param {string} [corBase] cor do pin normal (FGSIT)
   * @param {{ posicaoStale?: boolean }} [opts]
   */
  function criarIconeVeiculoMapa(variante, corBase, opts) {
    const o = opts || {};
    if (o.posicaoStale && variante === 'normal') {
      return criarIconeTrianguloAlertaPosicao(corBase);
    }
    const estilos = {
      normal: {
        bg: '#3498db',
        border: '3px solid #fff',
        opacity: 1,
        transform: 'rotate(-45deg) scale(1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        w: 30
      },
      ativo: {
        bg: '#e67e22',
        border: '3px solid #fff',
        opacity: 1,
        transform: 'rotate(-45deg) scale(1.15)',
        boxShadow: '0 3px 14px rgba(230,126,34,0.55)',
        w: 34
      },
      esmaecido: {
        bg: '#94a3b8',
        border: '2px solid rgba(255,255,255,0.9)',
        opacity: 0.5,
        transform: 'rotate(-45deg) scale(0.9)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        w: 26
      }
    };
    let s = { ...(estilos[variante] || estilos.normal) };
    if (variante === 'normal' && corBase) {
      s.bg = corBase;
    }
    const w = s.w;
    return L.divIcon({
      className: `veiculo-marker veiculo-marker--${variante}`,
      html: `<div style="
        background: ${s.bg};
        width: ${w}px;
        height: ${w}px;
        border-radius: 50% 50% 50% 0;
        transform: ${s.transform};
        border: ${s.border};
        box-shadow: ${s.boxShadow};
        opacity: ${s.opacity};
      "></div>`,
      iconSize: [w, w],
      iconAnchor: [w / 2, w],
      popupAnchor: [0, -w]
    });
  }

  function sincronizarEstiloMarcadoresVeiculos() {
    if (!mapa || !marcadoresVeiculos.length) return;
    const rotaVisivel = !!grupoTrajetoRoteiro;
    const ativo = marcadorRotaAtivo;
    marcadoresVeiculos.forEach((m) => {
      let variante = 'normal';
      if (rotaVisivel && ativo) {
        if (m === ativo) variante = 'ativo';
        else variante = 'esmaecido';
      }
      const corPin = m._mapaCorPin || COR_FGSIT_MAPA.default;
      const stale = !!m._mapaPosicaoStale;
      const usarAlerta = stale && variante === 'normal';
      m.setIcon(criarIconeVeiculoMapa(variante, corPin, { posicaoStale: usarAlerta }));
      if (variante === 'ativo') m.setZIndexOffset(800);
      else if (variante === 'esmaecido') m.setZIndexOffset(100);
      else if (m._mapaPosicaoStale) m.setZIndexOffset(520);
      else m.setZIndexOffset(400);
    });
  }

  /** Pontos do roteiro com coordenadas, na ordem do cadastro (ORDEM / SEQUENCIA). */
  function ordenarPontosRoteiro(pontos) {
    if (!Array.isArray(pontos)) return [];
    return pontos
      .filter(p => {
        const lat = parseFloat(p.LATITUDE != null ? p.LATITUDE : p.latitude);
        const lon = parseFloat(p.LONGITUDE != null ? p.LONGITUDE : p.longitude);
        return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
      })
      .sort((a, b) => {
        const oa = (a.ORDEM != null ? a.ORDEM : a.ordem) || 0;
        const ob = (b.ORDEM != null ? b.ORDEM : b.ordem) || 0;
        if (oa !== ob) return oa - ob;
        const sa = (a.SEQUENCIA != null ? a.SEQUENCIA : a.sequencia) || 0;
        const sb = (b.SEQUENCIA != null ? b.SEQUENCIA : b.sequencia) || 0;
        return sa - sb;
      })
      .map((p, idx) => {
        const lat = parseFloat(p.LATITUDE != null ? p.LATITUDE : p.latitude);
        const lon = parseFloat(p.LONGITUDE != null ? p.LONGITUDE : p.longitude);
        const nome = (p.DSLOCAL != null ? p.DSLOCAL : p.dslocal) || '';
        const ordem = (p.ORDEM != null ? p.ORDEM : p.ordem) != null
          ? (p.ORDEM != null ? p.ORDEM : p.ordem)
          : idx + 1;
        return {
          lat,
          lon,
          nome,
          LATITUDE: lat,
          LONGITUDE: lon,
          DSLOCAL: nome,
          DSPOSICAO: (p.DSPOSICAO != null ? p.DSPOSICAO : p.dsposicao) || '',
          TPLOCAL: (p.TPLOCAL != null ? p.TPLOCAL : p.tplocal) || '',
          ORDEM: ordem,
          KMENTREPONTOS: p.KMENTREPONTOS != null ? p.KMENTREPONTOS : p.kmentrepontos
        };
      });
  }

  function adicionarPolylineRotaViva(grupo, latlngs, opts) {
    const dashed = !!(opts && opts.dashArray);
    const base = {
      lineJoin: 'round',
      lineCap: 'round',
      interactive: false
    };
    // Contorno escuro + linha viva (azul) para destacar no mapa de fundo.
    L.polyline(latlngs, {
      ...base,
      color: '#0f172a',
      weight: dashed ? 8 : 10,
      opacity: 0.88,
      dashArray: dashed ? '10 8' : null
    }).addTo(grupo);
    L.polyline(latlngs, {
      ...base,
      color: '#2563eb',
      weight: dashed ? 4 : 5,
      opacity: 1,
      dashArray: dashed ? '10 8' : null
    }).addTo(grupo);
  }

  async function buscarCabecalhoRoteiro(idRoteiro) {
    try {
      const r = await fetch(`/api/roteiros/${encodeURIComponent(idRoteiro)}`, {
        headers: getAuthHeadersMapa()
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  /** Coordenadas aproximadas da cidade (Nominatim via backend). `cdPais` opcional para rotas fora do BR. */
  async function obterCoordenadasCidadeMapa(nomeCidade, estado, cdPais) {
    if (!nomeCidade || !String(nomeCidade).trim() || estado == null || !String(estado).trim()) return null;
    try {
      const params = new URLSearchParams({
        cidade: String(nomeCidade).trim(),
        estado: String(estado).trim()
      });
      if (cdPais != null && cdPais !== '') params.append('pais', String(cdPais));
      const r = await fetch(`/api/cidades/coordenadas?${params.toString()}`);
      if (!r.ok) return null;
      const data = await r.json();
      if (data.success && data.lat != null && data.lon != null) {
        return { lat: parseFloat(data.lat), lon: parseFloat(data.lon) };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /** [lat, lng][] a partir do JSON OSRM ou GeoJSON ORS (via normalizarRespostaGatewayOsrm). */
  function extrairLatLngsRespostaRota(data) {
    let d = data;
    if (typeof window.normalizarRespostaGatewayOsrm === 'function') {
      const n = window.normalizarRespostaGatewayOsrm(data);
      if (n) d = n;
    }
    if (!d || !d.routes || !d.routes[0] || !d.routes[0].geometry) return null;
    const coords = d.routes[0].geometry.coordinates;
    if (!coords || !Array.isArray(coords) || coords.length < 2) return null;
    return coords.map(c => [c[1], c[0]]);
  }

  async function fetchGeometriaRotaUrl(url) {
    const timeout = Math.max((window.MAP_CONFIG && window.MAP_CONFIG.routeTimeout) || 20000, 55000);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code && data.code !== 'Ok') return null;
      return extrairLatLngsRespostaRota(data);
    } catch (e) {
      clearTimeout(tid);
      return null;
    }
  }

  /**
   * Uma requisição de rota. ORS só via gateway (POST /geojson no servidor); OSRM pode espelhar direto.
   */
  async function buscarGeometriaRotaUmTrecho(coords) {
    if (!coords || coords.length < 2) return null;
    const config = window.MAP_CONFIG || {};
    const server = (config.osrmServer || '').trim();
    const coordsStr = coords.map(c => `${Number(c.lon)},${Number(c.lat)}`).join(';');
    const qs = 'overview=full&geometries=geojson';
    const routeTimeoutProxy = 110000;

    if (typeof window.fetchOsrmRouteJsonViaBackend === 'function') {
      try {
        const data = await window.fetchOsrmRouteJsonViaBackend(coordsStr, routeTimeoutProxy);
        const ll = extrairLatLngsRespostaRota(data);
        if (ll && ll.length > 1) return ll;
      } catch (e) {
        /* mirrors diretos abaixo */
      }
    }

    if (server.includes('/ors/v2')) {
      return null;
    }
    const bases = [];
    if (server) {
      let base = server.replace(/\/$/, '');
      if (base.includes('186.250.92.131') && window.location.protocol === 'http:') {
        base = base.replace(/^https:/i, 'http:');
      }
      bases.push(base);
      if (base.includes('driving-hgv')) bases.push(base.replace(/driving-hgv/g, 'driving'));
    }
    if (bases.length === 0) {
      bases.push('https://router.project-osrm.org/route/v1/driving');
    }
    for (let b = 0; b < bases.length; b++) {
      const url = `${bases[b]}/${coordsStr}?${qs}`;
      const geom = await fetchGeometriaRotaUrl(url);
      if (geom && geom.length > 1) return geom;
    }
    return null;
  }

  /** Rota completa: 1ª tentativa todos os waypoints; se falhar, concatena trecho a trecho; trecho que falhar vira linha reta entre os dois pontos. */
  async function buscarGeometriaRotaSequenciaPontos(coords) {
    if (!coords || coords.length < 2) return null;
    let full = await buscarGeometriaRotaUmTrecho(coords);
    if (full && full.length > 1) return full;

    if (coords.length === 2) return null;

    const merged = [];
    for (let i = 0; i < coords.length - 1; i++) {
      let leg = await buscarGeometriaRotaUmTrecho([coords[i], coords[i + 1]]);
      if (!leg || leg.length < 2) {
        const a = [coords[i].lat, coords[i].lon];
        const b = [coords[i + 1].lat, coords[i + 1].lon];
        leg = [a, b];
      }
      if (merged.length === 0) merged.push(...leg);
      else merged.push(...leg.slice(1));
    }
    return merged.length > 1 ? merged : null;
  }

  async function desenharRoteiroNoMapa(idRoteiro, markerLatLng) {
    if (!mapa || !idRoteiro) return;
    const meuToken = ++tokenDesenhoRota;
    limparTrajetoRoteiro();

    const obsoleto = () => meuToken !== tokenDesenhoRota;

    let res;
    try {
      res = await fetch(`/api/roteiros/${encodeURIComponent(idRoteiro)}/pontos`, {
        headers: getAuthHeadersMapa()
      });
    } catch (e) {
      console.warn('[Mapa Viagem] Erro ao buscar pontos do roteiro:', e);
      return;
    }
    if (obsoleto()) return;
    if (!res.ok) {
      console.warn('[Mapa Viagem] API pontos do roteiro:', res.status);
      return;
    }
    const pontosRaw = await res.json();
    if (obsoleto()) return;
    let pontos = ordenarPontosRoteiro(pontosRaw);
    let msgExtra = '';

    if (pontos.length < 2) {
      const cab = await buscarCabecalhoRoteiro(idRoteiro);
      if (obsoleto()) return;
      if (cab) {
        const oc = cab.ORIGEM_CIDADE || cab.origem_cidade || '';
        const oe = cab.ORIGEM_ESTADO || cab.origem_estado || '';
        const op = cab.ORIGEM_CDPAIS != null ? cab.ORIGEM_CDPAIS : cab.origem_cdpais;
        const dc = cab.DESTINO_CIDADE || cab.destino_cidade || '';
        const de = cab.DESTINO_ESTADO || cab.destino_estado || '';
        const dp = cab.DESTINO_CDPAIS != null ? cab.DESTINO_CDPAIS : cab.destino_cdpais;
        const [co, cd] = await Promise.all([
          obterCoordenadasCidadeMapa(oc, oe, op),
          obterCoordenadasCidadeMapa(dc, de, dp)
        ]);
        if (obsoleto()) return;
        if (co && cd) {
          pontos = [
            {
              lat: co.lat,
              lon: co.lon,
              nome: oc || 'Origem',
              LATITUDE: co.lat,
              LONGITUDE: co.lon,
              DSLOCAL: oc || 'Origem',
              DSPOSICAO: '',
              TPLOCAL: 'O',
              ORDEM: 1
            },
            {
              lat: cd.lat,
              lon: cd.lon,
              nome: dc || 'Destino',
              LATITUDE: cd.lat,
              LONGITUDE: cd.lon,
              DSLOCAL: dc || 'Destino',
              DSPOSICAO: '',
              TPLOCAL: 'D',
              ORDEM: 2
            }
          ];
          msgExtra =
            ' Traçado pela origem/destino do cadastro do roteiro (menos de 2 paradas com GPS em ROTEIROPONTOS).';
          console.log('[Mapa Viagem] Fallback origem/destino do roteiro para traçado:', idRoteiro);
        }
      }
    }

    if (pontos.length < 2) {
      console.warn('[Mapa Viagem] Sem traçado: pontos GPS insuficientes e geocoding origem/destino falhou.');
      mostrarAvisoMapaInfo(
        'Não foi possível desenhar o roteiro: cadastre coordenadas nas paradas do roteiro ou verifique cidade/estado/país de origem e destino.'
      );
      return;
    }

    if (obsoleto()) return;

    const meuGrupo = L.layerGroup().addTo(mapa);

    const coordsOsrm = pontos.map(p => ({ lat: p.lat, lon: p.lon }));
    let latlngs = await buscarGeometriaRotaSequenciaPontos(coordsOsrm);
    if (obsoleto()) {
      try {
        mapa.removeLayer(meuGrupo);
      } catch (e) { /* ignore */ }
      sincronizarEstiloMarcadoresVeiculos();
      return;
    }
    if (latlngs && latlngs.length > 1) {
      adicionarPolylineRotaViva(meuGrupo, latlngs);
    } else {
      console.warn('[Mapa Viagem] Roteamento (OSRM) indisponível para este roteiro; exibindo linha direta entre paradas.');
      const direto = pontos.map(p => [p.lat, p.lon]);
      adicionarPolylineRotaViva(meuGrupo, direto, { dashArray: '10 8' });
      const infoFalha = document.getElementById('mapaInfoText');
      if (infoFalha) {
        const cur = infoFalha.textContent || '';
        if (!cur.includes('Servidor de rotas')) {
          mostrarAvisoMapaInfo(
            cur +
              ' Não foi possível calcular a rota nas estradas (servidor OSRM/ORS). Verifique Configurações do mapa ou tente mais tarde.'
          );
        }
      }
    }

    if (
      window.AtlasRoteiroMapMarkers &&
      typeof window.AtlasRoteiroMapMarkers.addPontosMarkers === 'function'
    ) {
      window.AtlasRoteiroMapMarkers.addPontosMarkers(meuGrupo, pontos);
    } else {
      pontos.forEach((p, i) => {
        const isExtremo = i === 0 || i === pontos.length - 1;
        const cor = i === 0 ? '#2ecc71' : i === pontos.length - 1 ? '#e74c3c' : '#3498db';
        const tam = isExtremo ? 34 : 30;
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({
            className: 'custom-marker roteiro-marker-seq',
            html:
              `<div style="background:${cor};width:${tam}px;height:${tam}px;border-radius:50%;` +
              `border:3px solid ${isExtremo ? '#0f172a' : '#fff'};box-shadow:0 2px 10px rgba(0,0,0,.45);` +
              `display:flex;align-items:center;justify-content:center;font-size:${i + 1 >= 10 ? 12 : 14}px;` +
              `font-weight:800;color:#fff;font-family:system-ui,Segoe UI,sans-serif;line-height:1;">${i + 1}</div>`,
            iconSize: [tam, tam],
            iconAnchor: [tam / 2, tam / 2]
          }),
          zIndexOffset: isExtremo ? 600 : 400 + i
        })
          .bindTooltip(`#${i + 1} · ${p.nome || 'Parada ' + (i + 1)}`, { sticky: true })
          .addTo(meuGrupo);
      });
    }

    if (obsoleto()) {
      try {
        mapa.removeLayer(meuGrupo);
      } catch (e) { /* ignore */ }
      sincronizarEstiloMarcadoresVeiculos();
      return;
    }
    grupoTrajetoRoteiro = meuGrupo;
    sincronizarEstiloMarcadoresVeiculos();

    const infoText = document.getElementById('mapaInfoText');
    if (infoText && msgExtra) {
      const prev = infoText.textContent || '';
      if (!prev.includes('Traçado pela origem/destino')) mostrarAvisoMapaInfo(prev + msgExtra);
    }

    try {
      const b = grupoTrajetoRoteiro.getBounds();
      if (b && b.isValid && b.isValid()) {
        const alvo = markerLatLng ? b.extend(markerLatLng) : b;
        mapa.fitBounds(alvo.pad(0.12), { maxZoom: 15, animate: true });
        setTimeout(() => {
          try {
            mapa.invalidateSize();
            const b2 = grupoTrajetoRoteiro.getBounds();
            if (b2 && b2.isValid && b2.isValid()) {
              const alvo2 = markerLatLng ? b2.extend(markerLatLng) : b2;
              mapa.fitBounds(alvo2.pad(0.12), { maxZoom: 15, animate: false });
            }
          } catch (e2) { /* ignore */ }
        }, 150);
      }
    } catch (e) { /* ignore */ }
  }

  // Limpar marcadores do mapa
  function limparMarcadores() {
    invalidarDesenhosRotaPendentes();
    limparTrajetoRoteiro();
    marcadorRotaAtivo = null;
    marcadoresVeiculos.forEach(marker => {
      mapa.removeLayer(marker);
    });
    marcadoresVeiculos = [];
    contagemCoordMarcador = new Map();
    atualizarLegendaContagemPosicaoNoMapa();
  }

  function calcularPosicaoSeparada(lat, lon) {
    const key = `${lat.toFixed(6)}|${lon.toFixed(6)}`;
    const idx = contagemCoordMarcador.get(key) || 0;
    contagemCoordMarcador.set(key, idx + 1);
    if (idx === 0) return { latAdj: lat, lonAdj: lon, deslocado: false };
    // Raio pequeno para separar pinos sobrepostos (~2-8 metros)
    const raio = 0.00003 * (1 + Math.floor(idx / 8));
    const ang = (idx % 8) * (Math.PI / 4);
    return {
      latAdj: lat + (Math.sin(ang) * raio),
      lonAdj: lon + (Math.cos(ang) * raio),
      deslocado: true
    };
  }

  function formatarDataHora(data) {
    if (!data) return '-';
    try {
      const d = new Date(data);
      if (isNaN(d.getTime())) return '-';
      const loc = contextoMapa.locale || 'pt-BR';
      const tz = contextoMapa.timezone || 'America/Sao_Paulo';
      if (typeof window.formatarDataHoraComFuso === 'function') {
        return window.formatarDataHoraComFuso(d, loc, tz, { dateStyle: 'short', timeStyle: 'medium' });
      }
      return d.toLocaleString(loc, { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '-';
    }
  }

  // Centralizar mapa nos veículos
  function centralizarMapaNosVeiculos() {
    if (!mapa || marcadoresVeiculos.length === 0) {
      return;
    }

    // Verificar se a aba do mapa está ativa
    const tabMapa = document.getElementById('tab-mapa');
    const isMapaVisible = tabMapa && tabMapa.classList.contains('active');

    if (!isMapaVisible) {
      // Se a aba não estiver visível, aguardar e tentar novamente
      setTimeout(() => centralizarMapaNosVeiculos(), 200);
      return;
    }

    try {
      // Aguardar um pouco para garantir que o mapa está renderizado
      setTimeout(() => {
        if (!mapa || marcadoresVeiculos.length === 0) return;

        // Invalidar tamanho do mapa para garantir renderização correta
        mapa.invalidateSize();

        // Aguardar mais um pouco para o mapa ajustar
        setTimeout(() => {
          if (!mapa || marcadoresVeiculos.length === 0) return;

          const layersParaBounds = [...marcadoresVeiculos];
          if (grupoTrajetoRoteiro) {
            try {
              const br = grupoTrajetoRoteiro.getBounds();
              if (br && br.isValid && br.isValid()) layersParaBounds.push(grupoTrajetoRoteiro);
            } catch (e) { /* ignore */ }
          }
          const group = L.featureGroup(layersParaBounds);
          const bounds = group.getBounds();
          
          // Verificar se os bounds são válidos (verificando se tem coordenadas)
          if (bounds && bounds.isValid && typeof bounds.isValid === 'function' && bounds.isValid()) {
            mapa.fitBounds(bounds.pad(0.1), {
              animate: true,
              duration: 0.5,
              maxZoom: 15
            });
            console.log('[Mapa Viagem] Mapa centralizado nos veículos');
          } else if (bounds && bounds.getNorth && bounds.getSouth) {
            // Verificar se os bounds têm valores válidos
            const north = bounds.getNorth();
            const south = bounds.getSouth();
            const east = bounds.getEast();
            const west = bounds.getWest();
            
            if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west) && 
                north !== south && east !== west) {
              mapa.fitBounds(bounds.pad(0.1), {
                animate: true,
                duration: 0.5,
                maxZoom: 15
              });
              console.log('[Mapa Viagem] Mapa centralizado nos veículos');
            } else {
              // Se houver apenas um marcador, centralizar nele
              if (marcadoresVeiculos.length === 1) {
                const marker = marcadoresVeiculos[0];
                const latLng = marker.getLatLng();
                if (latLng && !isNaN(latLng.lat) && !isNaN(latLng.lng)) {
                  mapa.setView(latLng, 13, { animate: true });
                  console.log('[Mapa Viagem] Mapa centralizado no único veículo');
                }
              }
            }
          } else {
            console.warn('[Mapa Viagem] Bounds inválidos, tentando centralizar no primeiro marcador');
            // Se houver pelo menos um marcador, centralizar nele
            if (marcadoresVeiculos.length > 0) {
              const marker = marcadoresVeiculos[0];
              const latLng = marker.getLatLng();
              if (latLng && !isNaN(latLng.lat) && !isNaN(latLng.lng)) {
                mapa.setView(latLng, marcadoresVeiculos.length === 1 ? 13 : 10, { animate: true });
                console.log('[Mapa Viagem] Mapa centralizado no primeiro veículo');
              }
            }
          }
        }, 200);
      }, 300);
    } catch (err) {
      console.error('[Mapa Viagem] Erro ao centralizar mapa:', err);
    }
  }

  // Adicionar marcador de veículo no mapa
  function adicionarMarcadorVeiculo(veiculo) {
    if (!mapa) {
      console.warn('[Mapa Viagem] Mapa não está inicializado');
      return;
    }

    // Verificar se tem coordenadas
    if (!veiculo.LATITUDE || !veiculo.LONGITUDE) {
      console.warn('[Mapa Viagem] Veículo sem coordenadas:', veiculo);
      return;
    }

    const lat = parseFloat(veiculo.LATITUDE);
    const lon = parseFloat(veiculo.LONGITUDE);

    if (isNaN(lat) || isNaN(lon)) {
      console.warn('[Mapa Viagem] Coordenadas inválidas:', veiculo.LATITUDE, veiculo.LONGITUDE);
      return;
    }

    const corPin = corPinPorFgsit(veiculo);
    const posicaoStale = posicaoRastreamentoDesatualizada(veiculo);
    const veiculoIcon = criarIconeVeiculoMapa('normal', corPin, { posicaoStale });

    if (window.AtlasRoteiroMapMarkers && typeof window.AtlasRoteiroMapMarkers.ensureStyles === 'function') {
      window.AtlasRoteiroMapMarkers.ensureStyles();
    }
    const popupContent = montarPopupVeiculoMapa(veiculo, lat, lon, corPin, posicaoStale);

    const idRoteiroRaw = veiculo.IDROTEIRO != null ? veiculo.IDROTEIRO : veiculo.idroteiro;
    const idRoteiro = idRoteiroRaw != null && idRoteiroRaw !== '' ? Number(idRoteiroRaw) : null;

    const { latAdj, lonAdj, deslocado } = calcularPosicaoSeparada(lat, lon);
    const marker = L.marker([latAdj, lonAdj], { icon: veiculoIcon })
      .addTo(mapa)
      .bindPopup(popupContent, {
        className: 'atlas-map-popup-wrap',
        maxWidth: 340,
        minWidth: 260,
        closeButton: false
      });
    marker.on('popupopen', function (e) {
      const root = e.popup && e.popup.getElement && e.popup.getElement();
      const btn = root && root.querySelector('.atlas-map-popup-close');
      if (!btn) return;
      btn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        marker.closePopup();
      };
    });
    marker._mapaCorPin = corPin;
    marker._mapaPosicaoStale = posicaoStale;

    const placaTxt = (veiculo.PLACA && String(veiculo.PLACA).trim())
      ? String(veiculo.PLACA).trim().toUpperCase()
      : (veiculo.VIAGEM != null ? `Viagem #${veiculo.VIAGEM}` : '—');
    const prefixoPlaca = posicaoStale ? '⚠ ' : '';
    const viagemTxt = (veiculo.PLACA && veiculo.VIAGEM != null) ? ` #${veiculo.VIAGEM}` : '';
    marker.bindTooltip(prefixoPlaca + placaTxt + viagemTxt, {
      permanent: true,
      direction: 'top',
      className: posicaoStale
        ? 'mapa-viagem-placa-legenda mapa-viagem-placa-legenda--stale'
        : 'mapa-viagem-placa-legenda',
      offset: [0, posicaoStale ? -40 : -36]
    });
    if (deslocado) marker.setZIndexOffset((posicaoStale ? 520 : 400) + 50);

    marker.setZIndexOffset(posicaoStale ? 520 : 400);

    marker.on('click', (ev) => {
      if (ev && ev.originalEvent && L.DomEvent && typeof L.DomEvent.stopPropagation === 'function') {
        L.DomEvent.stopPropagation(ev.originalEvent);
      }
      const mesmaSelecao = marcadorRotaAtivo === marker;
      const rotaNoMapa = !!grupoTrajetoRoteiro;
      if (mesmaSelecao && rotaNoMapa) {
        invalidarDesenhosRotaPendentes();
        limparTrajetoRoteiro();
        marcadorRotaAtivo = null;
        centralizarMapaNosVeiculos();
        return;
      }
      marcadorRotaAtivo = marker;
      if (idRoteiro != null && !Number.isNaN(idRoteiro)) {
        desenharRoteiroNoMapa(idRoteiro, L.latLng(lat, lon));
      } else {
        invalidarDesenhosRotaPendentes();
        limparTrajetoRoteiro();
        marcadorRotaAtivo = null;
        mostrarAvisoMapaInfo(
          'Sem roteiro vinculado a esta viagem (ou cadastro de pontos incompleto). Traçado disponível quando houver ID do roteiro e pontos com coordenadas.'
        );
      }
    });

    marcadoresVeiculos.push(marker);
  }

  function agendarCarregarVeiculosAposLegendaOuAmostra() {
    clearTimeout(carregarVeiculosLegendaDebounceT);
    carregarVeiculosLegendaDebounceT = setTimeout(() => {
      carregarVeiculosLegendaDebounceT = null;
      void carregarVeiculos({ silent: true });
    }, 60);
  }

  function setMapaVeiculosLoading(ativo) {
    const on = !!ativo;
    const c = document.querySelector('.mapa-viagem-container');
    if (c) c.classList.toggle('mapa-viagem--carregando', on);
    ['mapaNormalFabAtualizar', 'mapaMaxFabAtualizar'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = on;
      el.setAttribute('aria-busy', on ? 'true' : 'false');
    });
  }

  // Carregar veículos e exibir no mapa
  async function carregarVeiculos(opts = {}) {
    const manterVisao = !!opts.manterVisao;
    const silent = !!opts.silent;
    const myGen = ++carregarVeiculosGen;

    try {
      if (!silent) {
        setMapaVeiculosLoading(true);
        atualizarSeloDadosAtualizadosNaLegenda({ loading: true });
      }

      // Garantir que o mapa está inicializado antes de carregar veículos
      if (!mapa) {
        console.log('[Mapa Viagem] Mapa não inicializado. Inicializando...');
        await inicializarMapa();
        
        // Aguardar um pouco para garantir que o mapa esteja pronto
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (myGen !== carregarVeiculosGen) return;
        if (!mapa) {
          throw new Error('Não foi possível inicializar o mapa');
        }
      }

      if (myGen !== carregarVeiculosGen) return;

      const filtros = coletarFiltrosMapaObjeto();
      const params = filtrosMapaParaParams(filtros);
      params.append('_ts', String(Date.now()));
      const qs = params.toString();

      const fetchOpts = { cache: 'no-store' };
      const [response, resResumo] = await Promise.all([
        fetch(`/api/mapa-viagem/veiculos?${qs}`, fetchOpts),
        fetch(`/api/mapa-viagem/resumo?${qs}`, fetchOpts)
      ]);

      if (myGen !== carregarVeiculosGen) return;

      if (!response.ok) {
        throw new Error('Erro ao carregar veículos');
      }

      let resumoJson = null;
      if (resResumo.ok) {
        try {
          resumoJson = await resResumo.json();
        } catch (e) {
          console.warn('[Mapa Viagem] Resumo: JSON inválido', e);
        }
      } else {
        console.warn('[Mapa Viagem] Resumo HTTP', resResumo.status);
      }
      if (myGen !== carregarVeiculosGen) return;
      renderizarResumoMapa(resumoJson);

      const data = await response.json();
      if (myGen !== carregarVeiculosGen) return;
      veiculosData = data.veiculos || [];

      console.log(`[Mapa Viagem] Dados recebidos da API:`, {
        total: veiculosData.length,
        veiculos: veiculosData.slice(0, 5) // Primeiros 5 para debug
      });

      // Limpar marcadores anteriores
      limparMarcadores();

      // Adicionar novos marcadores
      let marcadoresAdicionados = 0;
      let marcadoresIgnorados = 0;
      
      veiculosData.forEach((veiculo, index) => {
        const antes = marcadoresVeiculos.length;
        adicionarMarcadorVeiculo(veiculo);
        const depois = marcadoresVeiculos.length;
        
        if (depois > antes) {
          marcadoresAdicionados++;
        } else {
          marcadoresIgnorados++;
          if (index < 10) { // Log apenas os primeiros 10 ignorados
            console.warn(`[Mapa Viagem] Marcador ${index + 1} ignorado:`, veiculo);
          }
        }
      });

      console.log(`[Mapa Viagem] Marcadores: ${marcadoresAdicionados} adicionados, ${marcadoresIgnorados} ignorados`);

      atualizarLegendaMinutosStaleNoHtml();
      atualizarLegendaContagemPosicaoNoMapa();

      // Centralizar mapa nos veículos (poll / tela cheia mantém zoom e centro)
      if (marcadoresVeiculos.length > 0) {
        if (!manterVisao) {
          centralizarMapaNosVeiculos();
        }
      } else if (marcadoresVeiculos.length === 0) {
        console.warn('[Mapa Viagem] Nenhum marcador foi adicionado ao mapa!');
      }

      atualizarSeloDadosAtualizadosNaLegenda();

      mapaViagemPollPermitido = true;
      if (!manterVisao) {
        tentarIniciarAutoRefreshMapaNormal();
      }

    } catch (err) {
      if (myGen !== carregarVeiculosGen) return;
      console.error('Erro ao carregar veículos:', err);
      esconderResumoMapa();
      mostrarAvisoMapaInfo(t('web.modulos.mapaViagem.erroCarregar'));
    } finally {
      if (myGen === carregarVeiculosGen && !silent) {
        setMapaVeiculosLoading(false);
      }
    }
  }

  function invalidarTamanhoMapaLeaflet() {
    if (!mapa) return;
    requestAnimationFrame(() => {
      mapa.invalidateSize();
      requestAnimationFrame(() => mapa.invalidateSize());
    });
    setTimeout(() => { try { mapa.invalidateSize(); } catch (e) { /* ignore */ } }, 200);
    setTimeout(() => { try { mapa.invalidateSize(); } catch (e) { /* ignore */ } }, 600);
  }

  function pararAutoRefreshMapaNormal() {
    try {
      if (window.__mapaViagemNormalPollTimer != null) {
        clearInterval(window.__mapaViagemNormalPollTimer);
        window.__mapaViagemNormalPollTimer = null;
      }
    } catch (e) { /* ignore */ }
  }

  function tentarIniciarAutoRefreshMapaNormal() {
    pararAutoRefreshMapaNormal();
    const emMax = !!document.querySelector('.mapa-viagem-container.mapa--maximo');
    if (emMax) return;
    if (!mapaViagemPollPermitido) return;
    const tabMapa = document.getElementById('tab-mapa');
    if (!tabMapa || !tabMapa.classList.contains('active')) return;
    window.__mapaViagemNormalPollTimer = setInterval(() => {
      const maxAtivo = !!document.querySelector('.mapa-viagem-container.mapa--maximo');
      if (maxAtivo || !mapaViagemPollPermitido) {
        pararAutoRefreshMapaNormal();
        return;
      }
      const tM = document.getElementById('tab-mapa');
      if (!tM || !tM.classList.contains('active')) {
        pararAutoRefreshMapaNormal();
        return;
      }
      void carregarVeiculos({ manterVisao: true, silent: true });
    }, MAPA_NORMAL_AUTO_REFRESH_MS);
  }

  function pararAutoRefreshMapaMax() {
    try {
      if (window.__mapaViagemMaxRefreshTimer != null) {
        clearInterval(window.__mapaViagemMaxRefreshTimer);
        window.__mapaViagemMaxRefreshTimer = null;
      }
    } catch (e) { /* ignore */ }
  }

  function iniciarAutoRefreshMapaMax() {
    pararAutoRefreshMapaMax();
    window.__mapaViagemMaxRefreshTimer = setInterval(() => {
      const emMax = !!document.querySelector('.mapa-viagem-container.mapa--maximo');
      if (!emMax) {
        pararAutoRefreshMapaMax();
        return;
      }
      void carregarVeiculos({ manterVisao: true, silent: true });
    }, MAPA_MAX_AUTO_REFRESH_MS);
  }

  function sincronizarUiBotaoMapaMax(estadoMax) {
    const fabMax = document.getElementById('mapaNormalFabMax');
    const iconFab = fabMax?.querySelector('.mapa-normal-fab-max-icone');
    const labelFab = fabMax?.querySelector('.mapa-normal-fab-max-label');
    if (estadoMax) {
      if (iconFab) iconFab.className = 'bx bx-exit-fullscreen mapa-normal-fab-max-icone';
      if (labelFab) {
        labelFab.textContent = tx('web.modulos.mapaViagem.sairTelaCheia', 'Sair da tela cheia');
      }
      if (fabMax) {
        fabMax.setAttribute(
          'title',
          tx('web.modulos.mapaViagem.mapaMaxSairSoloTitle', 'Sair da tela cheia (tecla Esc)')
        );
      }
    } else {
      if (iconFab) iconFab.className = 'bx bx-fullscreen mapa-normal-fab-max-icone';
      if (labelFab) {
        labelFab.textContent = tx('web.modulos.mapaViagem.maximizarMapa', 'Maximizar mapa');
      }
      if (fabMax) {
        fabMax.setAttribute(
          'title',
          tx(
            'web.modulos.mapaViagem.maximizarMapaTitle',
            'Só o mapa em tela cheia; ✕ ou Esc para sair.'
          )
        );
      }
    }
  }

  function setModoMapaMaximizado(ativo) {
    const c = document.querySelector('.mapa-viagem-container');
    if (!c) return;
    const on = !!ativo;
    c.classList.toggle('mapa--maximo', on);
    document.body.classList.toggle('mapa-viagem-mapa-max-ativo', on);
    document.body.style.overflow = on ? 'hidden' : '';
    const tb = document.getElementById('mapaMaxToolbar');
    if (tb) tb.setAttribute('aria-hidden', 'true');
    const fab = document.getElementById('mapaMaxFabStack');
    if (fab) fab.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      pararAutoRefreshMapaNormal();
      c.setAttribute('role', 'dialog');
      c.setAttribute('aria-modal', 'true');
      c.setAttribute(
        'aria-label',
        tx(
          'web.modulos.mapaViagem.mapaMaxModalTitulo',
          'Mapa em tela cheia — botões no canto superior direito ou tecla Esc para sair'
        )
      );
      iniciarAutoRefreshMapaMax();
      requestAnimationFrame(() => {
        document.getElementById('mapaMaxFabCentralizar')?.focus();
      });
    } else {
      pararAutoRefreshMapaMax();
      c.removeAttribute('role');
      c.removeAttribute('aria-modal');
      c.removeAttribute('aria-label');
      requestAnimationFrame(() => {
        document.getElementById('mapaNormalFabMax')?.focus();
        tentarIniciarAutoRefreshMapaNormal();
      });
    }
    sincronizarUiBotaoMapaMax(on);
    invalidarTamanhoMapaLeaflet();
  }

  function toggleModoMapaMaximizado() {
    const c = document.querySelector('.mapa-viagem-container');
    if (!c) return;
    setModoMapaMaximizado(!c.classList.contains('mapa--maximo'));
  }

  // Função para trocar de aba (escopo no container do módulo para não misturar abas)
  function showTab(tabId) {
    if (tabId !== 'mapa') {
      setModoMapaMaximizado(false);
      pararAutoRefreshMapaNormal();
    }
    const tabContent = document.getElementById(`tab-${tabId}`);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!tabContent || !tabBtn) return;
    const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
      container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    }
    tabContent.classList.add('active');
    tabBtn.classList.add('active');
    
    // Se mudou para a aba do mapa, ajustar o tamanho do mapa e retomar atualização automática
    if (tabId === 'mapa' && mapa) {
      setTimeout(() => invalidarTamanhoMapaLeaflet(), 80);
      tentarIniciarAutoRefreshMapaNormal();
    }
  }

  // Event listeners para abas
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      showTab(tabId);
    });
  });

  // Event listeners
  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Mudar para a aba do mapa antes de carregar (para garantir que está visível)
    showTab('mapa');
    // Aguardar um pouco para a aba estar visível
    await new Promise(resolve => setTimeout(resolve, 100));
    // Carregar veículos (que vai centralizar automaticamente)
    await carregarVeiculos();
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    mapaViagemPollPermitido = false;
    pararAutoRefreshMapaNormal();
    filtroForm.reset();
    document.getElementById('filtroRoteiroDescricao').value = '';
    void Promise.all([
      fillEstadosSelect('filtroOrigemEstado', ''),
      fillEstadosSelect('filtroDestinoEstado', '')
    ]);
    veiculosData = [];
    limparMarcadores();
    esconderResumoMapa();
    const infoText = document.getElementById('mapaInfoText');
    if (infoText) {
      infoText.textContent = t('web.modulos.mapaViagem.mapaInfoFiltrosLimpos');
    }
  });

  document.getElementById('mapaLegendaWrap')?.addEventListener('click', (e) => {
    const bFg = e.target.closest('[data-fgsit]');
    const bTp = e.target.closest('[data-cdtipo]');
    const selSit = document.getElementById('filtroSituacaoViagem');
    const selTipo = document.getElementById('filtroTipoViagem');
    if (bFg && selSit) {
      e.preventDefault();
      const v = (bFg.getAttribute('data-fgsit') || '').trim();
      selSit.value = selSit.value === v ? '' : v;
      showTab('mapa');
      agendarCarregarVeiculosAposLegendaOuAmostra();
      return;
    }
    if (bTp && selTipo) {
      e.preventDefault();
      const v = (bTp.getAttribute('data-cdtipo') || '').trim();
      selTipo.value = selTipo.value === v ? '' : v;
      showTab('mapa');
      agendarCarregarVeiculosAposLegendaOuAmostra();
    }
  });

  document.getElementById('mapaAmostrasViagem')?.addEventListener('click', (e) => {
    const a = e.target.closest('a.mapa-link-viagem[data-id-viagem]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const idRaw = a.getAttribute('data-id-viagem');
    const idStr = idRaw != null ? String(idRaw).trim() : '';
    const inp = document.getElementById('filtroIdViagem');
    if (!inp || !idStr) return;
    const cur = String(inp.value || '').trim();
    if (cur === idStr) {
      inp.value = '';
    } else {
      inp.value = idStr;
      const selSit = document.getElementById('filtroSituacaoViagem');
      const selTipo = document.getElementById('filtroTipoViagem');
      if (selSit) selSit.value = '';
      if (selTipo) selTipo.value = '';
    }
    showTab('mapa');
    agendarCarregarVeiculosAposLegendaOuAmostra();
  }, true);

  function centralizarOuBrasil() {
    if (marcadoresVeiculos.length > 0) {
      centralizarMapaNosVeiculos();
    } else if (mapa) {
      mapa.setView([-23.5505, -46.6333], 5);
    }
  }

  document.getElementById('mapaNormalFabAtualizar')?.addEventListener('click', () => {
    void carregarVeiculos({ manterVisao: true, silent: false });
  });

  document.getElementById('mapaNormalFabCentralizar')?.addEventListener('click', () => {
    centralizarOuBrasil();
  });

  document.getElementById('mapaNormalFabMax')?.addEventListener('click', () => {
    toggleModoMapaMaximizado();
  });

  document.getElementById('mapaMaxFabCentralizar')?.addEventListener('click', () => {
    centralizarOuBrasil();
  });

  document.getElementById('mapaMaxFabAtualizar')?.addEventListener('click', () => {
    void carregarVeiculos({ manterVisao: true, silent: false });
  });

  document.getElementById('mapaMaxSairSoloBtn')?.addEventListener('click', () => {
    setModoMapaMaximizado(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const c = document.querySelector('.mapa-viagem-container.mapa--maximo');
    if (c) {
      e.preventDefault();
      setModoMapaMaximizado(false);
    }
  });

  // Flag para evitar inicialização dupla
  let inicializado = false;

  // Inicialização
  async function init() {
    // Evitar inicialização dupla
    if (inicializado) {
      console.log('[Mapa Viagem] Função init() já foi executada. Pulando...');
      return;
    }
    
    inicializado = true;
    console.log('[Mapa Viagem] Inicializando módulo...');
    await loadContextoMapa();
    await carregarConfigMapaETempoPosicao();
    
    try {
      // Executar init.sql
      await executarInitSQL();
      
      // Carregar combos (ignorar erros de estados se não houver endpoint)
      await Promise.allSettled([
        loadPaisesCombos().catch((err) => {
          if (!String(err.message || '').includes('<!DOCTYPE')) {
            console.warn('[Mapa Viagem] Erro ao carregar países/estados:', err);
          }
        }),
        loadTiposViagem(),
        loadClassesFrota(),
        loadContratadores(),
        loadRoteiros()
      ]);
      
      // Inicializar mapa
      await inicializarMapa();
      
      console.log('[Mapa Viagem] Módulo inicializado');
    } catch (err) {
      console.error('[Mapa Viagem] Erro na inicialização:', err);
      inicializado = false; // Permitir tentar novamente em caso de erro
    }
  }

  // Cada carregamento do módulo no dashboard = novo HTML; sempre agendar init nesta execução do script.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
  } else {
    void init();
  }
})();
