// =============================================
// GPS Automático - Serviço em Background
// =============================================

function gpsAutoDbg() {
  try {
    return localStorage.getItem('motorista_debug') === '1';
  } catch (e) {
    return false;
  }
}
function gpsAutoLog() {
  if (gpsAutoDbg()) console.log.apply(console, arguments);
}

/** Navegadores só expõem geolocation em https:// ou http://localhost / 127.0.0.1 — não em http:// + IP (ex.: 192.168.x.x). */
function geoPermitidoNesteContexto() {
  try {
    if (window.location.protocol === 'https:') return true;
    var h = (window.location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1';
  } catch (e) {
    return false;
  }
}

let gpsIntervalId = null;
/** Evita dois envios em paralelo (ex.: reinício duplo de iniciarGPSAutomatico). */
let gpsAutoCapturaEmCurso = false;
/** Marca início da captura — libera após timeout se callback de geo travar. */
let gpsAutoCapturaInicioMs = 0;
const GPS_AUTO_CAPTURA_MAX_MS = 120000;
let contadorEnvios = 0;
let ultimoEnvio = null;
let proximoEnvio = null;
let ultimaViagemAtivaId = null;

/** Persiste todas as viagens em andamento (evita cache só com a última do loop). */
function persistirViagensAtivasGps(ids) {
  const uniq = [...new Set((ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
  try {
    localStorage.setItem('gps_viagens_ativas_ids', JSON.stringify(uniq));
    if (uniq.length) {
      ultimaViagemAtivaId = uniq[uniq.length - 1];
      localStorage.setItem('gps_ultima_viagem_id', String(ultimaViagemAtivaId));
    }
    localStorage.setItem('gps_ultima_viagem_ts', new Date().toISOString());
  } catch (e) {
    // ignore
  }
}

function salvarViagemAtivaCache(idViagem) {
  if (idViagem == null || idViagem === '') return;
  const n = Number(idViagem);
  if (!Number.isFinite(n)) return;
  let arr = [];
  try {
    const raw = localStorage.getItem('gps_viagens_ativas_ids');
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) arr = p.map(Number).filter(Number.isFinite);
    }
  } catch (e) {}
  if (!arr.includes(n)) arr.push(n);
  persistirViagensAtivasGps(arr);
}

/** Quando a API confirma zero viagens, evita usar IDs antigos (404 no GPS). */
function limparCacheViagensGpsLocal() {
  try {
    localStorage.removeItem('gps_viagens_ativas_ids');
    localStorage.removeItem('gps_ultima_viagem_id');
    ultimaViagemAtivaId = null;
  } catch (e) {
    /* ignore */
  }
}

function obterViagensAtivasIdsFallback() {
  try {
    const raw = localStorage.getItem('gps_viagens_ativas_ids');
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) {
        const u = [...new Set(p.map(Number).filter(Number.isFinite))];
        if (u.length) return u;
      }
    }
  } catch (e) {}
  const legacy = obterViagemAtivaCache();
  return legacy != null ? [legacy] : [];
}

function obterViagemAtivaCache() {
  if (Number.isFinite(ultimaViagemAtivaId)) return ultimaViagemAtivaId;
  try {
    const id = Number(localStorage.getItem('gps_ultima_viagem_id'));
    if (Number.isFinite(id)) {
      ultimaViagemAtivaId = id;
      return id;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function resolverIdMotoristaParaApi() {
  try {
    if (typeof getMotoristaIdDoToken === 'function') {
      const t = getMotoristaIdDoToken();
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  } catch (e) {}
  try {
    const m = typeof getMotorista === 'function' ? getMotorista() : null;
    const v = m && (m.CDCADASTRO ?? m.cdcadastro ?? m.id);
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  } catch (e2) {}
  return NaN;
}

function normalizarListaViagensApi(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.dados)) return payload.dados;
  if (payload && Array.isArray(payload.viagens)) return payload.viagens;
  return [];
}

function obterPosicaoAtual(opts) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}

/**
 * @returns {Promise<{ ids: number[], fromApi: boolean }>}
 * fromApi = true quando a API respondeu OK (lista pode ser vazia — aí não se deve usar cache stale).
 */
async function buscarViagensAndamentoMotorista(motoristaId) {
  const ids = [];
  try {
    const path = `/api/motorista/viagens-andamento/${motoristaId}`;
    const url = typeof window.corrigirUrl === 'function' ? window.corrigirUrl(path) : path;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) return { ids, fromApi: false };
    const raw = await response.json();
    const viagens = normalizarListaViagensApi(raw);
    viagens.forEach((v) => {
      const id = Number(v && (v.IDVIAGEM ?? v.idviagem ?? v.IdViagem));
      if (Number.isFinite(id) && !ids.includes(id)) ids.push(id);
    });
    return { ids, fromApi: true };
  } catch (_) {
    // ignore
  }
  return { ids, fromApi: false };
}

async function enviarGpsParaViagens(motoristaId, viagemIds, coords, tipoEnvio) {
  const ids = (Array.isArray(viagemIds) ? viagemIds : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (!ids.length) ids.push(null); // mantém comportamento sem viagem (MOTORISTARASTREAMENTO)

  const { latitude, longitude, altitude, accuracy, speed, heading } = coords;
  const velocidadeKmh = speed ? (speed * 3.6).toFixed(2) : 0;
  const status = velocidadeKmh > 5 ? 'M' : 'P';
  const payloadBase = {
    cdMotorista: motoristaId,
    latitude: Number(latitude).toFixed(8),
    longitude: Number(longitude).toFixed(8),
    altitude: altitude ? Number(altitude).toFixed(2) : null,
    precisao: Math.round(Number(accuracy) || 0),
    velocidade: velocidadeKmh,
    status: status,
    direcao: heading ? Number(heading).toFixed(2) : null,
    tipoEnvio: tipoEnvio,
    dtPosicao: new Date().toISOString(),
  };

  const gpsPath = '/api/motorista/gps';
  const gpsUrl = typeof window.corrigirUrl === 'function' ? window.corrigirUrl(gpsPath) : gpsPath;
  const tarefas = ids.map(async (idViagem) => {
    const dadosGPS = { ...payloadBase, idViagem: idViagem };
    try {
      const response = await fetch(gpsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(dadosGPS),
      });
      return { ok: response.ok, idViagem, status: response.status };
    } catch (_) {
      return { ok: false, idViagem, network: true };
    }
  });
  return Promise.all(tarefas);
}

/**
 * Chrome exige gesto do usuário para getCurrentPosition quando a permissão ainda não está "granted".
 * Se já estiver concedida, envia logo; senão, espera primeiro toque/tecla (o intervalo continua depois).
 */
async function agendarPrimeiroEnvioGpsAutomatico() {
  let granted = false;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      granted = st.state === 'granted';
      const onChange = () => {
        if (st.state === 'granted') enviarPosicaoAutomatica();
      };
      try {
        if (typeof st.addEventListener === 'function') st.addEventListener('change', onChange);
        else st.onchange = onChange;
      } catch (_) {
        st.onchange = onChange;
      }
    }
  } catch (_) {
    /* Permissions API indisponível */
  }

  if (granted) {
    enviarPosicaoAutomatica();
    return;
  }

  const primeiroGesto = () => {
    window.removeEventListener('pointerdown', primeiroGesto, true);
    window.removeEventListener('touchstart', primeiroGesto, true);
    window.removeEventListener('keydown', primeiroGesto, true);
    enviarPosicaoAutomatica();
  };
  window.addEventListener('pointerdown', primeiroGesto, { capture: true });
  window.addEventListener('touchstart', primeiroGesto, { capture: true });
  window.addEventListener('keydown', primeiroGesto, { capture: true });
  gpsAutoLog('[GPS AUTO] Primeiro envio: aguardando permissão ou gesto (toque/tecla) nesta página.');
}

// Inicializar GPS automático
function iniciarGPSAutomatico() {
  const ativo = localStorage.getItem('gps_ativo') === 'true';
  const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '900', 10);
  const motorista = getMotorista();

  gpsAutoLog('GPS Automático:', ativo ? 'ATIVO' : 'INATIVO', 'intervalo', intervalo + 's');

  // Parar se já estiver rodando
  if (gpsIntervalId) {
    clearInterval(gpsIntervalId);
    gpsIntervalId = null;
  }

  // Se não está ativo, sair
  if (!ativo || !motorista) {
    if (!ativo) {
      gpsAutoLog('GPS automático não iniciado: desativado nas configurações');
    } else if (!motorista) {
      gpsAutoLog('GPS automático não iniciado: motorista não autenticado');
    }
    // Limpar estatísticas se desativado
    contadorEnvios = 0;
    ultimoEnvio = null;
    proximoEnvio = null;
    return;
  }

  // Carregar estatísticas do localStorage
  contadorEnvios = parseInt(localStorage.getItem('gps_contador') || '0');
  const ultimoEnvioStr = localStorage.getItem('gps_ultimo_envio');
  ultimoEnvio = ultimoEnvioStr ? new Date(ultimoEnvioStr) : null;
  const proximoEnvioStr = localStorage.getItem('gps_proximo_envio');
  proximoEnvio = proximoEnvioStr ? new Date(proximoEnvioStr) : null;

  // Corrigir "próximo envio" se foi salvo com o bug antigo (intervalo tratado como minutos em vez de segundos)
  const intervaloMs = intervalo * 1000;
  const intervaloMaxRazoavel = intervaloMs * 2.5; // no máximo 2,5x o intervalo correto
  if (proximoEnvio && ultimoEnvio && !isNaN(proximoEnvio.getTime()) && !isNaN(ultimoEnvio.getTime())) {
    const diffMs = proximoEnvio.getTime() - ultimoEnvio.getTime();
    if (diffMs > intervaloMaxRazoavel) {
      proximoEnvio = new Date(ultimoEnvio.getTime() + intervaloMs);
      localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());
      gpsAutoLog('Próximo envio corrigido (intervalo)', Math.round(intervalo / 60), 'min');
    }
  }

  // Se não tem próximo envio mas tem último, calcular (intervalo está em segundos)
  if (!proximoEnvio && ultimoEnvio) {
    proximoEnvio = new Date(ultimoEnvio.getTime() + intervaloMs);
    localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());
  }

  void agendarPrimeiroEnvioGpsAutomatico();

  // Configurar intervalo (localStorage está em segundos → milissegundos)
  const intervaloMsFinal = intervalo * 1000;
  
  gpsIntervalId = setInterval(() => {
    enviarPosicaoAutomatica();
  }, intervaloMsFinal);

  gpsAutoLog('GPS automático iniciado', contadorEnvios + ' envios', proximoEnvio ? proximoEnvio.toLocaleTimeString() : '');
}

// Enviar posição automaticamente
async function enviarPosicaoAutomatica() {
  if (gpsAutoCapturaEmCurso) {
    if (gpsAutoCapturaInicioMs && Date.now() - gpsAutoCapturaInicioMs > GPS_AUTO_CAPTURA_MAX_MS) {
      console.warn('[GPS AUTO] Captura presa — liberando flag após timeout');
      gpsAutoCapturaEmCurso = false;
      gpsAutoCapturaInicioMs = 0;
    } else {
      gpsAutoLog('[GPS AUTO] Captura já em andamento — ignorando duplicata');
      return;
    }
  }
  gpsAutoCapturaEmCurso = true;
  gpsAutoCapturaInicioMs = Date.now();

  try {
    gpsAutoLog('[GPS AUTO] Iniciando captura...');

    const motorista = getMotorista();
    const motoristaIdNum = resolverIdMotoristaParaApi();
    if (!motorista || !Number.isFinite(motoristaIdNum)) {
      gpsAutoLog('[GPS AUTO] Motorista não autenticado ou ID inválido');
      gpsAutoCapturaEmCurso = false;
      gpsAutoCapturaInicioMs = 0;
      return;
    }

    // Buscar viagens em andamento (enviar para TODAS, não só a primeira)
    const { ids: idsApi, fromApi } = await buscarViagensAndamentoMotorista(motoristaIdNum);
    let viagemIds;
    if (fromApi) {
      if (idsApi.length) {
        persistirViagensAtivasGps(idsApi);
        viagemIds = idsApi;
        gpsAutoLog('[GPS AUTO] Viagens associadas #' + viagemIds.join(', #'));
      } else {
        limparCacheViagensGpsLocal();
        viagemIds = [];
        gpsAutoLog('[GPS AUTO] API: 0 viagem(ns) — cache de viagens limpo; GPS só em MOTORISTARASTREAMENTO.');
      }
    } else {
      viagemIds = obterViagensAtivasIdsFallback();
      if (viagemIds.length) {
        gpsAutoLog('[GPS AUTO] API indisponível ou erro — usando cache #' + viagemIds.join(', #'));
      }
    }

    // Obter posição GPS
    if (!navigator.geolocation) {
      gpsAutoLog('[GPS AUTO] Geolocalização não disponível');
      gpsAutoCapturaEmCurso = false;
      gpsAutoCapturaInicioMs = 0;
      return;
    }

    if (!geoPermitidoNesteContexto()) {
      console.warn(
        '[GPS AUTO] Não é possível obter GPS neste endereço (HTTP na rede local). O navegador exige HTTPS ou localhost. O envio automático não funcionará até usar um link seguro.'
      );
      gpsAutoCapturaEmCurso = false;
      gpsAutoCapturaInicioMs = 0;
      try {
        window.dispatchEvent(new CustomEvent('gps-auto-sem-geo', { detail: { motivo: 'origem_insegura' } }));
      } catch (e) {}
      return;
    }

    obterPosicaoAtual({
      enableHighAccuracy: false, // Evita timeout em celular indoor/desktop sem GPS dedicado
      timeout: 20000,
      maximumAge: 180000 // Aceitar posição de até 3 minutos
    }).then(async (position) => {
        try {
        const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;

        gpsAutoLog('[GPS AUTO] Posição capturada', latitude, longitude);

        try {
          const resultados = await enviarGpsParaViagens(
            motoristaIdNum,
            viagemIds,
            { latitude, longitude, altitude, accuracy, speed, heading },
            'A'
          );
          const algumOk = resultados.some((r) => r.ok);
          const falhos = resultados.filter((r) => !r.ok);
          if (algumOk && falhos.length) {
            console.warn(
              '[GPS AUTO] Envio parcial — falhou para viagem(ns):',
              falhos.map((f) => (f.idViagem == null ? 'sem viagem' : '#' + f.idViagem + (f.status ? ' HTTP ' + f.status : ''))),
            );
          }
          if (algumOk) {
            contadorEnvios++;
            ultimoEnvio = new Date();
            
            // Calcular próximo envio (intervalo em segundos)
            const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '900', 10);
            proximoEnvio = new Date(Date.now() + (intervalo * 1000));

            // Salvar estatísticas
            localStorage.setItem('gps_contador', contadorEnvios.toString());
            localStorage.setItem('gps_ultimo_envio', ultimoEnvio.toISOString());
            localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());

            gpsAutoLog('[GPS AUTO] Enviado OK', contadorEnvios, 'próximo', proximoEnvio.toLocaleTimeString());

            // Atualizar indicador visual se existir
            atualizarIndicadorGPS();

          } else {
            console.error('❌ [GPS AUTO] Erro ao enviar para viagens:', resultados);
          }
        } catch (error) {
          console.error('❌ [GPS AUTO] Erro de rede:', error);
          
          // Se offline, adicionar à fila
          if (typeof adicionarFila === 'function') {
            const payloadFila = {
              cdMotorista: motoristaIdNum,
              viagemIds: viagemIds,
              latitude: Number(latitude).toFixed(8),
              longitude: Number(longitude).toFixed(8),
              altitude: altitude ? Number(altitude).toFixed(2) : null,
              precisao: Math.round(Number(accuracy) || 0),
              velocidade: speed ? (speed * 3.6).toFixed(2) : 0,
              status: speed && (speed * 3.6) > 5 ? 'M' : 'P',
              direcao: heading ? Number(heading).toFixed(2) : null,
              tipoEnvio: 'A',
              dtPosicao: new Date().toISOString(),
            };
            await adicionarFila('gps', payloadFila);
            gpsAutoLog('[GPS AUTO] Adicionado à fila offline');
          }
        }
        } finally {
          gpsAutoCapturaEmCurso = false;
          gpsAutoCapturaInicioMs = 0;
        }
      }).catch(async (error) => {
        try {
        // HTTP + IP (ex.: 192.168.x.x): o navegador nem sempre preenche message; tratar antes de qualquer log “fatal”.
        if (!geoPermitidoNesteContexto()) {
          console.warn(
            '[GPS AUTO] GPS indisponível: este endereço (HTTP na rede) não é “origem segura”. O Chrome bloqueia geolocalização. Solução: acesse por HTTPS (produção) ou http://localhost no PC.'
          );
          return;
        }
        var msgRaw = (error && (error.message || (typeof error.toString === 'function' ? error.toString() : ''))) || '';
        var em = String(msgRaw).toLowerCase();
        if (em.indexOf('secure') !== -1 || em.indexOf('origin') !== -1) {
          console.warn('[GPS AUTO] Geolocalização recusada (origem não segura). Use HTTPS ou localhost.');
          return;
        }

        console.warn('⚠️ [GPS AUTO] Erro ao obter posição (tentativa 1):', msgRaw);

        // Se foi timeout, tentar novamente com configurações menos restritivas
        if (error.code === error.TIMEOUT || String(msgRaw).includes('Timeout')) {
          gpsAutoLog('[GPS AUTO] Retry geolocalização...');
          
          try {
            await new Promise((resolve) => {
              obterPosicaoAtual({
                enableHighAccuracy: false, // Menos restritivo
                timeout: 15000, // Timeout menor na segunda tentativa
                maximumAge: 300000, // Aceitar posição com até 5 minutos de idade
              }).then(async (position) => {
                  const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;
                  
                  gpsAutoLog('[GPS AUTO] Posição capturada (2)', latitude, longitude);
                  
                  try {
                    const resultados = await enviarGpsParaViagens(
                      motoristaIdNum,
                      viagemIds,
                      { latitude, longitude, altitude, accuracy, speed, heading },
                      'A'
                    );
                    if (resultados.some((r) => r.ok)) {
                      contadorEnvios++;
                      ultimoEnvio = new Date();
                      const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '900', 10);
                      proximoEnvio = new Date(Date.now() + (intervalo * 1000));
                      
                      localStorage.setItem('gps_contador', contadorEnvios.toString());
                      localStorage.setItem('gps_ultimo_envio', ultimoEnvio.toISOString());
                      localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());
                      
                      gpsAutoLog('[GPS AUTO] Enviado OK (tentativa 2)');
                      atualizarIndicadorGPS();
                      resolve();
                    } else {
                      // Se API falhar, não bloquear ciclo; próxima janela tenta de novo
                      resolve();
                    }
                  } catch (err) {
                    if (typeof adicionarFila === 'function') {
                      await adicionarFila('gps', {
                        cdMotorista: motoristaIdNum,
                        viagemIds: viagemIds,
                        latitude: Number(latitude).toFixed(8),
                        longitude: Number(longitude).toFixed(8),
                        altitude: altitude ? Number(altitude).toFixed(2) : null,
                        precisao: Math.round(Number(accuracy) || 0),
                        velocidade: speed ? (speed * 3.6).toFixed(2) : 0,
                        status: speed && (speed * 3.6) > 5 ? 'M' : 'P',
                        direcao: heading ? Number(heading).toFixed(2) : null,
                        tipoEnvio: 'A',
                        dtPosicao: new Date().toISOString(),
                      });
                      gpsAutoLog('[GPS AUTO] Adicionado à fila offline');
                    }
                    resolve();
                  }
                }).catch(async (error2) => {
                  console.error('❌ [GPS AUTO] Erro na tentativa 2:', error2.message);
                  // Fallback final: tenta posição em cache do navegador e envia mesmo assim
                  try {
                    const posCache = await obterPosicaoAtual({
                      enableHighAccuracy: false,
                      timeout: 5000,
                      maximumAge: 900000 // até 15 minutos
                    });
                    const { latitude, longitude, altitude, accuracy, speed, heading } = posCache.coords;
                    const resultados = await enviarGpsParaViagens(
                      motoristaIdNum,
                      viagemIds,
                      { latitude, longitude, altitude, accuracy, speed, heading },
                      'A'
                    );
                    if (resultados.some((r) => r.ok)) {
                      contadorEnvios++;
                      ultimoEnvio = new Date();
                      const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '900', 10);
                      proximoEnvio = new Date(Date.now() + (intervalo * 1000));
                      localStorage.setItem('gps_contador', contadorEnvios.toString());
                      localStorage.setItem('gps_ultimo_envio', ultimoEnvio.toISOString());
                      localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());
                      gpsAutoLog('[GPS AUTO] Enviado OK (fallback cache)');
                      atualizarIndicadorGPS();
                    }
                  } catch (_) {
                    // não impede próximos ciclos
                  } finally {
                    resolve();
                  }
                });
            });
          } catch (retryError) {
            console.error('❌ [GPS AUTO] Falha após tentativa de retry:', retryError.message);
          }
        } else {
          console.error('❌ [GPS AUTO] Erro não recuperável:', error.message);
        }
        } finally {
          gpsAutoCapturaEmCurso = false;
          gpsAutoCapturaInicioMs = 0;
        }
      });
  } catch (error) {
    gpsAutoCapturaEmCurso = false;
    gpsAutoCapturaInicioMs = 0;
    console.error('❌ [GPS AUTO] Erro geral:', error);
  }
}

// Atualizar indicador visual
function atualizarIndicadorGPS() {
  // Disparar evento customizado para atualizar UI
  const evento = new CustomEvent('gpsEnviado', {
    detail: {
      contador: contadorEnvios,
      ultimoEnvio: ultimoEnvio,
      proximoEnvio: proximoEnvio
    }
  });
  window.dispatchEvent(evento);
}

// Parar GPS automático
function pararGPSAutomatico() {
  if (gpsIntervalId) {
    clearInterval(gpsIntervalId);
    gpsIntervalId = null;
    gpsAutoLog('GPS automático parado');
  }
}

// Obter estatísticas
function obterEstatisticasGPS() {
  // Carregar valores do localStorage
  const contadorSalvo = parseInt(localStorage.getItem('gps_contador') || '0');
  const ultimoEnvioStr = localStorage.getItem('gps_ultimo_envio');
  const proximoEnvioStr = localStorage.getItem('gps_proximo_envio');
  
  // Converter strings para Date
  let ultimoEnvioSalvo = null;
  if (ultimoEnvioStr) {
    try {
      ultimoEnvioSalvo = new Date(ultimoEnvioStr);
      if (isNaN(ultimoEnvioSalvo.getTime())) {
        ultimoEnvioSalvo = null;
      }
    } catch (e) {
      ultimoEnvioSalvo = null;
    }
  }
  
  let proximoEnvioSalvo = null;
  if (proximoEnvioStr) {
    try {
      proximoEnvioSalvo = new Date(proximoEnvioStr);
      if (isNaN(proximoEnvioSalvo.getTime())) {
        proximoEnvioSalvo = null;
      }
    } catch (e) {
      proximoEnvioSalvo = null;
    }
  }
  
  // Usar variáveis globais se existirem e forem mais recentes, senão usar localStorage
  const contadorFinal = contadorEnvios > 0 ? contadorEnvios : contadorSalvo;
  const ultimoEnvioFinal = ultimoEnvio || ultimoEnvioSalvo;
  const proximoEnvioFinal = proximoEnvio || proximoEnvioSalvo;
  
  // Intervalo está em segundos no localStorage (ex.: 900 = 15 min)
  const intervaloSeg = parseInt(localStorage.getItem('gps_intervalo') || '900', 10);
  const intervaloEmMinutos = Math.max(1, Math.round(intervaloSeg / 60));

  // Se não tem próximo envio mas tem último, calcular
  let proximoCalculado = proximoEnvioFinal;
  if (!proximoCalculado && ultimoEnvioFinal) {
    const ultimoDate = ultimoEnvioFinal instanceof Date ? ultimoEnvioFinal : new Date(ultimoEnvioFinal);
    if (!isNaN(ultimoDate.getTime())) {
      proximoCalculado = new Date(ultimoDate.getTime() + (intervaloSeg * 1000));
    }
  } else if (proximoCalculado && ultimoEnvioFinal) {
    // Corrigir se o valor salvo veio do bug (próximo envio a ~900 min em vez de 15 min)
    const ultimoDate = ultimoEnvioFinal instanceof Date ? ultimoEnvioFinal : new Date(ultimoEnvioFinal);
    const proximoDate = proximoCalculado instanceof Date ? proximoCalculado : new Date(proximoCalculado);
    if (!isNaN(ultimoDate.getTime()) && !isNaN(proximoDate.getTime())) {
      const diffMs = proximoDate.getTime() - ultimoDate.getTime();
      if (diffMs > intervaloSeg * 1000 * 2.5) {
        proximoCalculado = new Date(ultimoDate.getTime() + (intervaloSeg * 1000));
      }
    }
  }
  
  return {
    ativo: localStorage.getItem('gps_ativo') === 'true',
    intervalo: intervaloEmMinutos,
    contador: contadorFinal,
    ultimoEnvio: ultimoEnvioFinal,
    proximoEnvio: proximoCalculado,
  };
}

function mensagemErroGeo(error) {
  if (!error) return 'Falha ao obter localização';
  if (error.code === 1) return 'Permissão de localização negada';
  if (error.code === 2) return 'Posição indisponível no momento';
  if (error.code === 3) return 'Timeout ao obter localização';
  return error.message || 'Falha ao obter localização';
}

function obterUmaPosicaoGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalização não disponível neste navegador'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  });
}

window.gpsAutoSolicitarPermissao = async function() {
  try {
    if (!geoPermitidoNesteContexto()) {
      const msg = 'Origem não segura para GPS (use HTTPS ou localhost).';
      window.dispatchEvent(new CustomEvent('gps-manual-status', {
        detail: { ok: false, action: 'ativar', message: msg }
      }));
      return { ok: false, message: msg };
    }
    await obterUmaPosicaoGps();
    const msg = 'Permissão de GPS confirmada.';
    window.dispatchEvent(new CustomEvent('gps-manual-status', {
      detail: { ok: true, action: 'ativar', message: msg }
    }));
    return { ok: true, message: msg };
  } catch (error) {
    const msg = mensagemErroGeo(error);
    window.dispatchEvent(new CustomEvent('gps-manual-status', {
      detail: { ok: false, action: 'ativar', message: msg }
    }));
    return { ok: false, message: msg };
  }
};

window.gpsAutoTestarEnvio = async function() {
  try {
    const motorista = getMotorista();
    const motoristaIdNum = resolverIdMotoristaParaApi();
    if (!motorista || !Number.isFinite(motoristaIdNum)) {
      const msg = 'Motorista não autenticado.';
      window.dispatchEvent(new CustomEvent('gps-manual-status', {
        detail: { ok: false, action: 'teste', message: msg }
      }));
      return { ok: false, message: msg };
    }
    if (!geoPermitidoNesteContexto()) {
      const msg = 'Origem não segura para GPS (use HTTPS ou localhost).';
      window.dispatchEvent(new CustomEvent('gps-manual-status', {
        detail: { ok: false, action: 'teste', message: msg }
      }));
      return { ok: false, message: msg };
    }

    const { ids: idsApi, fromApi } = await buscarViagensAndamentoMotorista(motoristaIdNum);
    let viagemIds;
    if (fromApi) {
      viagemIds = idsApi.length ? idsApi : [];
      if (!idsApi.length) limparCacheViagensGpsLocal();
    } else {
      viagemIds = obterViagensAtivasIdsFallback();
    }

    const position = await obterUmaPosicaoGps();
    const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;
    const resultados = await enviarGpsParaViagens(
      motoristaIdNum,
      viagemIds,
      { latitude, longitude, altitude, accuracy, speed, heading },
      'M'
    );
    const okCount = resultados.filter((r) => r.ok).length;
    if (!okCount) {
      const det = resultados.map((r) => (r.idViagem == null ? '∅' : '#' + r.idViagem) + (r.status ? ':' + r.status : '')).join(', ');
      const msg =
        'Falha no envio GPS (nenhuma viagem atualizada)' + (det ? '. Detalhe: ' + det : '');
      window.dispatchEvent(new CustomEvent('gps-manual-status', {
        detail: { ok: false, action: 'teste', message: msg }
      }));
      return { ok: false, message: msg };
    }

    const msg =
      okCount === resultados.length
        ? `Posição enviada com sucesso (${okCount} viagem(ns)).`
        : `GPS enviado para ${okCount} de ${resultados.length} viagem(ns). Abra o console (motorista_debug=1) ou verifique as viagens sem ponto.`;
    window.dispatchEvent(new CustomEvent('gps-manual-status', {
      detail: { ok: true, action: 'teste', message: msg }
    }));
    return { ok: true, message: msg };
  } catch (error) {
    const msg = error && error.message ? error.message : 'Falha ao testar envio GPS';
    window.dispatchEvent(new CustomEvent('gps-manual-status', {
      detail: { ok: false, action: 'teste', message: msg }
    }));
    return { ok: false, message: msg };
  }
};

// Iniciar quando a página carregar
if (typeof verificarAuth === 'function' && verificarAuth()) {
  gpsAutoLog('Inicializando GPS automático...');
  setTimeout(() => {
    iniciarGPSAutomatico();
  }, 2000);
}

gpsAutoLog('gps-auto.js carregado');

