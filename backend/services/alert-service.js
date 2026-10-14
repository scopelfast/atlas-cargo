// backend/services/alert-service.js
// Service para detectar e gerar alertas automáticos em viagens
// Versão: 2.0 - Com ETA dinâmico e detecção de desvios
// Data: 2026-01-16

const axios = require('axios');
const { poolPromise } = require('../config/db');
const sql = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const {
  resolveViagemRastreamentoPg,
  rowRastreamentoCanon,
  exprDhPosicaoGps,
} = require('./viagem-rastreamento-pg.service');

/** Tenant da viagem (coluna TENANT_ID em VIAGEMMESTRE) ou default. */
async function tenantIdForViagemDb(pool, idViagem) {
  const id = typeof idViagem === 'number' ? idViagem : parseFloat(idViagem);
  if (!Number.isFinite(id)) return getDefaultTenantId();
  try {
    const r = await pool.query(
      'SELECT "TENANT_ID" FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 LIMIT 1',
      [id]
    );
    const row = r.rows && r.rows[0];
    const t = row && (row.TENANT_ID ?? row.tenant_id);
    if (t != null && String(t).trim() !== '') return String(t).trim();
  } catch (_) {
    /* tabela/coluna ausente */
  }
  return getDefaultTenantId();
}

/**
 * Contexto da última macro para decidir se a parada é justificável.
 * - justificável: última macro é de parada/carga/descarga/retido/abastecimento,
 *   sem reinício posterior, e ainda dentro do limite configurado da macro/fallback.
 */
async function obterContextoMacroParada(pool, idViagem, minFallback) {
  try {
    const tid = await tenantIdForViagemDb(pool, idViagem);
    const macroRes = await pool.query(
      `SELECT 
         vo."CDTIPOOCORRENCIA",
         vo."DTOCORRENCIA",
         vo."DTCADASTRO",
         vo."DHMAINTENANCE",
         to2."FGSITUACAO",
         to2."DSTIPOOCORRENCIA",
         to2."FG_CONTROLE_TEMPO",
         to2."TEMPO_MAXIMO_MINUTOS"
       FROM public."VIAGEMOCORRENCIA" vo
       LEFT JOIN public."TIPOOCORRENCIA" to2
         ON to2."CDTIPOOCORRENCIA" = vo."CDTIPOOCORRENCIA"
        AND (to2."TENANT_ID" = $2 OR to2."TENANT_ID" = 'default')
       WHERE vo."IDVIAGEM" = $1
       ORDER BY COALESCE(vo."DTOCORRENCIA", vo."DTCADASTRO", vo."DHMAINTENANCE") DESC
       LIMIT 1`,
      [idViagem, tid]
    );
    const macro = macroRes.rows && macroRes.rows[0];
    if (!macro) {
      return { temMacroJustificadora: false, macroDentroLimite: false, paradaIndevida: true, motivo: 'sem_macro' };
    }

    const nomeMacro = String(macro.DSTIPOOCORRENCIA ?? macro.dstipoocorrencia ?? '').trim();
    const situacaoNorm = String(macro.FGSITUACAO ?? macro.fgsituacao ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const ehMacroParada =
      situacaoNorm === 'P' ||
      /PARADA|RETIDO|CARGA|DESCARGA|ABASTEC/i.test(nomeMacro);
    if (!ehMacroParada) {
      return {
        temMacroJustificadora: false,
        macroDentroLimite: false,
        paradaIndevida: true,
        motivo: 'ultima_macro_nao_justificadora',
        macroNome: nomeMacro || null,
      };
    }

    const dtMacroRaw =
      macro.DTOCORRENCIA ?? macro.dtocorrencia ??
      macro.DTCADASTRO ?? macro.dtcadastro ??
      macro.DHMAINTENANCE ?? macro.dhmaintenance;
    const dtMacro = dtMacroRaw ? new Date(dtMacroRaw) : null;
    if (!dtMacro || Number.isNaN(dtMacro.getTime())) {
      return {
        temMacroJustificadora: false,
        macroDentroLimite: false,
        paradaIndevida: true,
        motivo: 'macro_sem_data_valida',
        macroNome: nomeMacro || null,
      };
    }

    const reinicioRes = await pool.query(
      `SELECT 1
       FROM public."VIAGEMOCORRENCIA" vo
       INNER JOIN public."TIPOOCORRENCIA" to2 ON to2."CDTIPOOCORRENCIA" = vo."CDTIPOOCORRENCIA"
         AND (to2."TENANT_ID" = $3 OR to2."TENANT_ID" = 'default')
       WHERE vo."IDVIAGEM" = $1
         AND COALESCE(vo."DTOCORRENCIA", vo."DTCADASTRO", vo."DHMAINTENANCE") > $2
         AND (
           (TRIM(UPPER(COALESCE(to2."FGSITUACAO", ''))) = 'T' AND COALESCE(to2."SEQ", 0) >= 2)
           OR UPPER(COALESCE(to2."DSTIPOOCORRENCIA", '')) LIKE '%REIN%CIO%'
         )
       LIMIT 1`,
      [idViagem, dtMacro.toISOString(), tid]
    );
    if (reinicioRes.rows && reinicioRes.rows.length > 0) {
      return {
        temMacroJustificadora: false,
        macroDentroLimite: false,
        paradaIndevida: true,
        motivo: 'macro_encerrada_por_reinicio',
        macroNome: nomeMacro || null,
      };
    }

    const fgControleTempo = String(macro.FG_CONTROLE_TEMPO ?? macro.fg_controle_tempo ?? 'N').trim().toUpperCase();
    const tempoMaxTipo = Number(macro.TEMPO_MAXIMO_MINUTOS ?? macro.tempo_maximo_minutos);
    const limiteMinutos = (fgControleTempo === 'S' && Number.isFinite(tempoMaxTipo) && tempoMaxTipo > 0)
      ? tempoMaxTipo
      : minFallback;
    const minutosEmMacro = (Date.now() - dtMacro.getTime()) / 60000;
    const macroDentroLimite = Number.isFinite(minutosEmMacro) && minutosEmMacro <= limiteMinutos;

    return {
      temMacroJustificadora: true,
      macroDentroLimite,
      paradaIndevida: !macroDentroLimite,
      motivo: macroDentroLimite ? 'macro_justificadora_ativa' : 'macro_justificadora_estourada',
      macroNome: nomeMacro || null,
      minutosEmMacro: Number.isFinite(minutosEmMacro) ? minutosEmMacro : null,
      limiteMinutos,
    };
  } catch (_) {
    return { temMacroJustificadora: false, macroDentroLimite: false, paradaIndevida: true, motivo: 'erro_ao_ler_macro' };
  }
}

// Defaults das configurações de alerta (CONFIGURACAO alert_*). Usado quando chave não existe e na API GET.
const ALERT_CONFIG_DEFAULTS = {
  alert_offline_minutos: 90,
  alert_parada_velocidade_max: 5,
  alert_parada_minutos_min: 30,
  alert_parada_janela_posicoes: 60,
  alert_parada_raio_metros: 200,
  alert_desvio_metros: 500,
  alert_desvio_suprimir_quando_parado_ativo: 'S',
  alert_atraso_margem_minutos: 0,
  alert_atraso_inicio_margem_minutos: 15,
  alert_excesso_velocidade_kmh: 100,
  alert_excesso_velocidade_janela: 5,
  alert_job_intervalo_minutos: 5,
  alert_cooldown_minutos: 30,
  alert_heartbeat_ativo: 'N',
  alert_heartbeat_intervalo_minutos: 15,
  alert_heartbeat_tipos: 'PARADA',
  alert_whatsapp_reenvio_minutos: 30,
  alert_job_ativo: 'S',
  alert_tipo_parada_ativo: 'S',
  alert_tipo_atraso_ativo: 'S',
  alert_tipo_eta_prazo_ativo: 'S',
  alert_tipo_offline_ativo: 'S',
  alert_tipo_desvio_ativo: 'S',
  alert_tipo_atraso_inicio_ativo: 'S',
  alert_tipo_excesso_velocidade_ativo: 'S',
  alert_tipo_parada_sem_reinicio_ativo: 'S',
  alert_parada_sem_reinicio_metros: 300,
  alert_situacoes_viagem: '',
  alert_fgsitviagem: ''
};

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos
/** @type {Map<string, { data: object, ts: number }>} */
const alertConfigCacheMap = new Map();

function cacheTenantKey(tenantId) {
  if (tenantId != null && String(tenantId).trim() !== '') return String(tenantId).trim();
  return getDefaultTenantId();
}

/** @param {any} maybeCtx contexto retornado por resolveViagemRastreamentoPg */
async function rastreamentoCtx(pool, maybeCtx) {
  if (maybeCtx && maybeCtx.fromSql && maybeCtx.cols) return maybeCtx;
  return resolveViagemRastreamentoPg(pool);
}

let warnedRastreamentoColunasMinimas = false;
function warnRastreamentoColunasMinimasOnce(msg) {
  if (warnedRastreamentoColunasMinimas) return;
  warnedRastreamentoColunasMinimas = true;
  console.warn(`⚠️ [Alertas] ${msg}`);
}

/** PostgreSQL 42703: coluna ausente (instalação sem VELOCIDADE em rastreamento). */
function isPgMissingVelocidadeColumn(err) {
  return err && err.code === '42703' && /VELOCIDADE/i.test(String(err.message || ''));
}

let warnedMissingVelocidadeColumn = false;
function warnMissingVelocidadeColumnOnce() {
  if (warnedMissingVelocidadeColumn) return;
  warnedMissingVelocidadeColumn = true;
  console.warn(
    '⚠️ [Alertas] Tabela de rastreamento sem coluna VELOCIDADE: excesso de velocidade e parada por GPS (vel.) desativados; parada por raio/macros segue. Execute: backend/scripts/adicionar_velocidade_viagemrastreamento_postgres.sql'
  );
}

/** Última posição; se VELOCIDADE não existir no PG, reconsulta sem a coluna (ETA usa velocidade default no JS). */
async function buscarUltimaPosicaoRastreamento(pool, rctx, idViagem) {
  const { fromSql, cols } = rctx;
  if (!cols.idv || !cols.lat || !cols.lon) {
    warnRastreamentoColunasMinimasOnce(
      'Rastreamento sem colunas mínimas (viagem / lat / lon). Alertas de atraso/ETA/desvio não usam GPS até o cadastro da tabela estar alinhado ao app.'
    );
    return null;
  }
  const dtExpr = exprDhPosicaoGps(cols);
  if (!dtExpr) {
    warnRastreamentoColunasMinimasOnce('Rastreamento sem coluna de data (DHREGISTRO/DHPOSICAO).');
    return null;
  }
  const baseSel = `
    SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE", (${dtExpr}) AS "DHREGISTRO"
    FROM ${fromSql}
    WHERE ${cols.idv} = @idviagem
    ORDER BY (${dtExpr}) DESC
    LIMIT 1`;
  const withVel = cols.vel
    ? `
    SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE", (${dtExpr}) AS "DHREGISTRO", ${cols.vel} AS "VELOCIDADE"
    FROM ${fromSql}
    WHERE ${cols.idv} = @idviagem
    ORDER BY (${dtExpr}) DESC
    LIMIT 1`
    : null;
  try {
    const sqlText = withVel || baseSel;
    const ultimaPosResult = await pool
      .request()
      .input('idviagem', sql.Decimal(15, 0), idViagem)
      .query(sqlText);
    const row = ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null;
    return rowRastreamentoCanon(row);
  } catch (err) {
    if (!withVel || !isPgMissingVelocidadeColumn(err)) throw err;
    const ultimaPosResult = await pool
      .request()
      .input('idviagem', sql.Decimal(15, 0), idViagem)
      .query(baseSel);
    const row = ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null;
    const r = rowRastreamentoCanon(row);
    if (r) r.VELOCIDADE = null;
    return r;
  }
}

const alertService = {
  /**
   * Obter configuração de alertas (CONFIGURACAO alert_*). Cache em memória por 2 min.
   * @param {object} pool - Pool do banco
   * @param {boolean} forceReload - Ignorar cache e recarregar do banco
   * @returns {Promise<object>} Objeto com chaves alert_* (valores string ou number conforme default)
   */
  getAlertConfig: async (pool, forceReload = false, tenantIdArg) => {
    const tkey = cacheTenantKey(tenantIdArg);
    const now = Date.now();
    const slot = alertConfigCacheMap.get(tkey);
    if (!forceReload && slot && slot.data != null && (now - slot.ts) < CACHE_TTL_MS) {
      return { ...slot.data };
    }
    const config = { ...ALERT_CONFIG_DEFAULTS };
    try {
      const result = await pool
        .request()
        .input('prefix', 'alert_%')
        .input('tenantId', sql.NVarChar(64), tkey)
        .query('SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" LIKE @prefix AND "TENANT_ID" = @tenantId');
      const rows = result.recordset || result.rows || [];
      for (const r of rows) {
        const chave = (r.CHAVE != null ? r.CHAVE : r.chave);
        let valor = (r.VALOR != null ? r.VALOR : r.valor);
        if (chave && typeof chave === 'string' && chave.startsWith('alert_')) {
          if (ALERT_CONFIG_DEFAULTS[chave] !== undefined) {
            if (typeof ALERT_CONFIG_DEFAULTS[chave] === 'number') {
              const n = parseFloat(valor);
              config[chave] = isNaN(n) ? ALERT_CONFIG_DEFAULTS[chave] : n;
            } else {
              config[chave] = valor != null ? String(valor).trim() : ALERT_CONFIG_DEFAULTS[chave];
            }
          } else {
            config[chave] = valor != null ? String(valor).trim() : '';
          }
        }
      }
      alertConfigCacheMap.set(tkey, { data: config, ts: now });
      return { ...config };
    } catch (err) {
      if (err.code === '42P01') {
        alertConfigCacheMap.set(tkey, { data: config, ts: now });
        return { ...config };
      }
      console.warn('[Alertas] getAlertConfig erro, usando defaults:', err.message);
      return { ...config };
    }
  },

  ALERT_CONFIG_DEFAULTS,

  /** Limpa cache de CONFIGURACAO alert_* (ex.: após salvar na tela de configurações). */
  clearAlertConfigCache: (tenantIdArg) => {
    if (tenantIdArg != null && String(tenantIdArg).trim() !== '') {
      alertConfigCacheMap.delete(cacheTenantKey(tenantIdArg));
    } else {
      alertConfigCacheMap.clear();
    }
  },

  /**
   * Verificar alertas para uma viagem específica
   * @param {number} idViagem - ID da viagem
   * @returns {Promise<Array>} Lista de alertas encontrados
   */
  verificarAlertas: async (idViagem) => {
    const pool = await poolPromise;
    const alertas = [];
    const tenantIdCtx = await tenantIdForViagemDb(pool, idViagem);
    const config = await alertService.getAlertConfig(pool, false, tenantIdCtx);

    try {
      console.log(`🔍 [Alertas] Verificando viagem ${idViagem}...`);
      const rctxGps = await rastreamentoCtx(pool, null);
      console.log(`   📍 [Alertas] Rastreamento: ${rctxGps.fromSql} (found=${rctxGps.found})`);
      try {
        const cdb = rctxGps.cols;
        const dtDbg = exprDhPosicaoGps(cdb) || cdb.dh;
        if (cdb.idv && dtDbg) {
          const dbg = await pool.query(
            `SELECT COUNT(*)::int AS n, MAX((${dtDbg})) AS ult FROM ${rctxGps.fromSql} WHERE ${cdb.idv} = $1`,
            [idViagem]
          );
          const d = dbg.rows && dbg.rows[0];
          console.log(
            `   📊 [Alertas] Posições GPS nesta viagem: count=${d && d.n != null ? d.n : d && d.N != null ? d.N : '?'} último=${(d && (d.ult ?? d.ULT)) != null ? d.ult ?? d.ULT : '—'}`
          );
        }
      } catch (eDbg) {
        console.warn(`   ⚠️ [Alertas] Não foi possível contar posições em ${rctxGps.fromSql}:`, eDbg.message);
      }
      // Buscar motorista da viagem (para incluir nos alertas) - PostgreSQL
      let cdmotorista = null;
      try {
        const motoristaResult = await pool.query(
          `SELECT "CDCADASTRO_MOTORISTA" FROM "CONVOCACAO"
           WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 AND "STATUS" IN ('ACEITA', 'CONFIRMADA')
           ORDER BY "DHRESPOSTA" DESC LIMIT 1`,
          [idViagem, tenantIdCtx]
        );
        if (motoristaResult.rows && motoristaResult.rows.length > 0) {
          cdmotorista = motoristaResult.rows[0].CDCADASTRO_MOTORISTA ?? motoristaResult.rows[0].cdcadastro_motorista;
        }
      } catch (err) {
        if (err.code !== '42P01') console.warn('Erro ao buscar motorista da viagem:', err.message);
      }

      if (config.alert_tipo_parada_ativo === 'S') {
        const paradaAlerta = await alertService.verificarParadaProlongada(idViagem, pool, config, rctxGps);
        if (paradaAlerta) {
          paradaAlerta.cdmotorista = cdmotorista;
          alertas.push(paradaAlerta);
          console.log(`   ✅ Parada prolongada detectada`);
        }
      }

      if (config.alert_tipo_atraso_ativo === 'S') {
        const atrasoAlerta = await alertService.verificarAtraso(idViagem, pool, config, rctxGps);
        if (atrasoAlerta) {
          atrasoAlerta.cdmotorista = cdmotorista;
          alertas.push(atrasoAlerta);
          console.log(`   ✅ Atraso detectado`);
        }
      }

      if (config.alert_tipo_eta_prazo_ativo === 'S') {
        const etaAlerta = await alertService.verificarETAPrazo(idViagem, pool, config, rctxGps);
        if (etaAlerta) {
          etaAlerta.cdmotorista = cdmotorista;
          alertas.push(etaAlerta);
          console.log(`   ✅ ETA preventivo detectado`);
        }
      }

      if (config.alert_tipo_offline_ativo === 'S') {
        const offlineAlerta = await alertService.verificarOffline(idViagem, pool, config, rctxGps);
        if (offlineAlerta) {
          offlineAlerta.cdmotorista = cdmotorista;
          alertas.push(offlineAlerta);
          console.log(`   ✅ Motorista offline detectado`);
        }
      }

      if (config.alert_tipo_desvio_ativo === 'S') {
        const desvioAlerta = await alertService.verificarDesvioRota(idViagem, pool, config, rctxGps);
        if (desvioAlerta) {
          desvioAlerta.cdmotorista = cdmotorista;
          alertas.push(desvioAlerta);
          console.log(`   ✅ Desvio de rota detectado`);
        }
      }

      if (config.alert_tipo_atraso_inicio_ativo === 'S') {
        const atrasoInicioAlerta = await alertService.verificarAtrasoIniciar(idViagem, pool, config, rctxGps);
        if (atrasoInicioAlerta) {
          atrasoInicioAlerta.cdmotorista = cdmotorista;
          alertas.push(atrasoInicioAlerta);
          console.log(`   ✅ Atraso para iniciar viagem detectado`);
        }
      }

      if (config.alert_tipo_excesso_velocidade_ativo === 'S') {
        const excessoVelAlerta = await alertService.verificarExcessoVelocidade(idViagem, pool, config, rctxGps);
        if (excessoVelAlerta) {
          excessoVelAlerta.cdmotorista = cdmotorista;
          alertas.push(excessoVelAlerta);
          console.log(`   ✅ Excesso de velocidade detectado`);
        }
      }

      if (config.alert_tipo_parada_sem_reinicio_ativo === 'S') {
        const paradaSemReinicio = await alertService.verificarParadaSemReinicio(idViagem, pool, config, rctxGps);
        if (paradaSemReinicio) {
          paradaSemReinicio.cdmotorista = cdmotorista;
          alertas.push(paradaSemReinicio);
          console.log(`   ✅ Parada sem reinício detectada`);
        }
      }

      // Salvar alertas novos no banco
      let alertasSalvos = 0;
      for (const alerta of alertas) {
        alerta.tenantId = tenantIdCtx;
        const salvo = await alertService.salvarAlerta(alerta, pool);
        if (salvo) {
          alerta.__novo = true;
          alertasSalvos++;
          console.log(`   ✅ Alerta ${alerta.type.toUpperCase()} salvo com sucesso`);
          // Ações ao gerar alerta: notificação WhatsApp (Switch) – configurável
          const alertNotificationService = require('./alert-notification-service');
          alertNotificationService.notificarAlertaCriado(pool, alerta).catch(err => {
            console.warn('[Alertas] Notificação pós-alerta:', err.message);
          });
        } else {
          alerta.__novo = false;
          console.log(`   ℹ️  Alerta ${alerta.type.toUpperCase()} não salvo (já existe ou erro)`);
          // Heartbeat: reenviar lembrete periódico enquanto o alerta permanece aberto
          // sem criar novo registro na lista de alertas.
          if (alertService.heartbeatHabilitadoParaTipo(config, alerta.type) && alerta.__existingAlertId) {
            const alertNotificationService = require('./alert-notification-service');
            alertNotificationService.notificarHeartbeatAlerta(pool, alerta, config).catch(err => {
              console.warn('[Alertas] Heartbeat de notificação:', err.message);
            });
          }
        }
      }

      if (alertas.length > 0) {
        console.log(`📋 [Viagem ${idViagem}] ${alertasSalvos} de ${alertas.length} alerta(s) salvo(s) no banco`);
      } else {
        console.log(`   ℹ️  Nenhum alerta detectado para viagem ${idViagem}`);
      }

      return alertas.filter(a => a && a.__novo === true);
    } catch (err) {
      console.error('Erro ao verificar alertas:', err);
      return [];
    }
  },

  /**
   * Verificar se motorista está parado há muito tempo
   * @param {object} config - Opcional; se omitido usa ALERT_CONFIG_DEFAULTS (alert_parada_velocidade_max, alert_parada_minutos_min, alert_parada_janela_posicoes)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento (ex.: VIAGEMRASTREAMENTO ou viagem_rastreamento)
   */
  verificarParadaProlongada: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const { fromSql, cols } = rctx;
      const dtExpr = exprDhPosicaoGps(cols) || cols.dh;
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const velMax = Number(cfg.alert_parada_velocidade_max) || 5;
      const minMin = Number(cfg.alert_parada_minutos_min) || 30;
      const janela = Math.max(2, Math.min(120, Number(cfg.alert_parada_janela_posicoes) || 60));
      const raioMetros = Math.max(20, Math.min(1000, Number(cfg.alert_parada_raio_metros) || 200));
      let macroCtxParada = null;
      const getMacroCtxParada = async () => {
        if (macroCtxParada) return macroCtxParada;
        macroCtxParada = await obterContextoMacroParada(pool, idViagem, minMin);
        return macroCtxParada;
      };
      try {
        if (!cols.vel) {
          warnMissingVelocidadeColumnOnce();
        } else if (cols.idv && dtExpr) {
        const result = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .input('velmax', velMax)
          .query(`
          SELECT 
            COUNT(*)::int as total,
            AVG(COALESCE(${cols.vel}, 0))::float as "velocidadeMedia",
            MIN((${dtExpr})) as "primeiraParada",
            MAX((${dtExpr})) as "ultimaParada",
            EXTRACT(EPOCH FROM (MAX((${dtExpr})) - MIN((${dtExpr}))))/60::float as "minutosParado"
          FROM ${fromSql}
          WHERE ${cols.idv} = @idviagem
            AND (${dtExpr}) >= (CURRENT_TIMESTAMP - INTERVAL '24 hours')
            AND COALESCE(${cols.vel}, 0) < @velmax
        `);

        if (result.recordset.length > 0) {
          const data = result.recordset[0];
          const minPar = data.minutosParado != null ? Number(data.minutosParado) : null;
          const tot = data.total != null ? Number(data.total) : 0;
          console.log(
            `   🔎 [Alertas] parada prolongada viagem ${idViagem}: pontosLentos=${tot} minParado=${minPar != null && !isNaN(minPar) ? minPar.toFixed(1) : '—'} (mín. ${minMin} min, vel<${velMax})`
          );
          if (data.minutosParado >= minMin && data.total >= janela) {
            // Verificar se já existe alerta ativo deste tipo
            const existeAlerta = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'PARADA')
              .query(`
              SELECT [ID] FROM [dbo].[ALERTS]
              WHERE [IDVIAGEM] = @idviagem
                AND [TYPE] = @type
                AND COALESCE([RESOLVED], false) = false
                AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
            LIMIT 1
            `);

            if (existeAlerta.recordset.length === 0) {
              const macroCtx = await getMacroCtxParada();
              const minutosParadoInt = Math.round(Number(data.minutosParado) || 0);
              const velocidadeMediaNum = Number(data.velocidadeMedia);
              const velocidadeMedia = Number.isFinite(velocidadeMediaNum)
                ? Math.round(velocidadeMediaNum * 10) / 10
                : null;
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `Motorista parado há ${minutosParadoInt} minutos`,
                severity: minutosParadoInt > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: minutosParadoInt,
                  velocidadeMedia,
                  origemDeteccao: 'gps',
                  paradaIndevida: !!macroCtx.paradaIndevida,
                  motivoParadaIndevida: macroCtx.motivo || null,
                  macroJustificadora: macroCtx.macroNome || null
                })
              };
            } else {
              console.log(`   ℹ️ [Alertas] parada(gps) suprimido: já existe alerta ativo para viagem ${idViagem}`);
              const alertaExistente = existeAlerta.recordset[0];
              const macroCtx = await getMacroCtxParada();
              const minutosParadoInt = Math.round(Number(data.minutosParado) || 0);
              const velocidadeMediaNum = Number(data.velocidadeMedia);
              const velocidadeMedia = Number.isFinite(velocidadeMediaNum)
                ? Math.round(velocidadeMediaNum * 10) / 10
                : null;
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `Motorista parado há ${minutosParadoInt} minutos`,
                severity: minutosParadoInt > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: minutosParadoInt,
                  velocidadeMedia,
                  origemDeteccao: 'gps',
                  paradaIndevida: !!macroCtx.paradaIndevida,
                  motivoParadaIndevida: macroCtx.motivo || null,
                  macroJustificadora: macroCtx.macroNome || null
                }),
                __existingAlertId: alertaExistente.ID ?? alertaExistente.id
              };
            }
          } else {
            console.log(
              `   ℹ️ [Alertas] parada(gps) ainda não elegível: precisa >=${minMin} min e >=${janela} pontos lentos (agora: minutos=${minPar != null && !isNaN(minPar) ? minPar.toFixed(1) : '—'}, pontos=${tot})`
            );
          }
        }
        }
      } catch (errVel) {
        if (isPgMissingVelocidadeColumn(errVel)) {
          warnMissingVelocidadeColumnOnce();
        } else {
          throw errVel;
        }
      }

      // Fallback por raio de GPS:
      // quando a telemetria de velocidade vem nula/inconsistente, usamos concentração espacial.
      if (cols.idv && cols.lat && cols.lon && dtExpr) {
      try {
        const raioRes = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT
              COUNT(*)::int AS "totalPontos",
              MIN(sub.dh_ord) AS "primeiroPonto",
              MAX(sub.dh_ord) AS "ultimoPonto",
              EXTRACT(EPOCH FROM (MAX(sub.dh_ord) - MIN(sub.dh_ord)))/60::float AS "minutosJanela",
              (
                111320.0 * SQRT(
                  POWER((MAX(sub.lat_num) - MIN(sub.lat_num)), 2) +
                  POWER((MAX(sub.lon_num) - MIN(sub.lon_num)) * COS(RADIANS(AVG(sub.lat_num))), 2)
                )
              )::float AS "deslocamentoAproxMetros"
            FROM (
              SELECT
                (${dtExpr}) AS dh_ord,
                CAST(${cols.lat} AS DOUBLE PRECISION) AS lat_num,
                CAST(${cols.lon} AS DOUBLE PRECISION) AS lon_num
              FROM ${fromSql}
              WHERE ${cols.idv} = @idviagem
                AND (${dtExpr}) >= (CURRENT_TIMESTAMP - INTERVAL '24 hours')
                AND ${cols.lat} IS NOT NULL
                AND ${cols.lon} IS NOT NULL
            ) sub
          `);

        if (raioRes.recordset.length > 0) {
          const rg = raioRes.recordset[0];
          const pontos = Number(rg.totalPontos || 0);
          const minJanela = Number(rg.minutosJanela || 0);
          const desloc = Number(rg.deslocamentoAproxMetros || 0);
          console.log(
            `   🔎 [Alertas] parada raio viagem ${idViagem}: pontos=${pontos} minutos=${Number.isFinite(minJanela) ? minJanela.toFixed(1) : '—'} desloc≈${Number.isFinite(desloc) ? desloc.toFixed(1) : '—'}m (raio<=${raioMetros}m)`
          );

          if (pontos >= janela && minJanela >= minMin && Number.isFinite(desloc) && desloc <= raioMetros) {
            const existeAlertaRaio = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'PARADA')
              .query(`
                SELECT [ID] FROM [dbo].[ALERTS]
                WHERE [IDVIAGEM] = @idviagem
                  AND [TYPE] = @type
                  AND COALESCE([RESOLVED], false) = false
                  AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                LIMIT 1
              `);

            if (existeAlertaRaio.recordset.length === 0) {
              const macroCtx = await getMacroCtxParada();
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `Motorista parado há ${Math.round(minJanela)} minutos`,
                severity: minJanela > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: Math.round(minJanela),
                  deslocamentoAproxMetros: Math.round(desloc),
                  raioMetros,
                  origemDeteccao: 'gps_raio',
                  paradaIndevida: !!macroCtx.paradaIndevida,
                  motivoParadaIndevida: macroCtx.motivo || null,
                  macroJustificadora: macroCtx.macroNome || null
                })
              };
            } else {
              const alertaExistente = existeAlertaRaio.recordset[0];
              const macroCtx = await getMacroCtxParada();
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `Motorista parado há ${Math.round(minJanela)} minutos`,
                severity: minJanela > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: Math.round(minJanela),
                  deslocamentoAproxMetros: Math.round(desloc),
                  raioMetros,
                  origemDeteccao: 'gps_raio',
                  paradaIndevida: !!macroCtx.paradaIndevida,
                  motivoParadaIndevida: macroCtx.motivo || null,
                  macroJustificadora: macroCtx.macroNome || null
                }),
                __existingAlertId: alertaExistente.ID ?? alertaExistente.id
              };
            }
          }
        }
      } catch (errRaio) {
        if (errRaio.code !== '42P01' && errRaio.code !== '42703') {
          console.warn(`   ⚠️ [Alertas] Falha no fallback por raio (viagem ${idViagem}):`, errRaio.message);
        }
      }
      }

      // Fallback por "parada contínua no ponto atual":
      // percorre os últimos pontos (do mais recente para trás) e mede há quanto tempo
      // o veículo permanece dentro do raio a partir da posição atual.
      if (cols.idv && cols.lat && cols.lon && dtExpr) {
        try {
          const continuoRes = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .input('limite', sql.Int, 300)
            .query(`
              SELECT
                (${dtExpr}) AS "DH",
                CAST(${cols.lat} AS DOUBLE PRECISION) AS "LAT",
                CAST(${cols.lon} AS DOUBLE PRECISION) AS "LON"
              FROM ${fromSql}
              WHERE ${cols.idv} = @idviagem
                AND (${dtExpr}) >= (CURRENT_TIMESTAMP - INTERVAL '24 hours')
                AND ${cols.lat} IS NOT NULL
                AND ${cols.lon} IS NOT NULL
              ORDER BY (${dtExpr}) DESC
              LIMIT @limite
            `);

          const rows = (continuoRes.recordset || []).filter(r => r && r.DH && Number.isFinite(Number(r.LAT)) && Number.isFinite(Number(r.LON)));
          if (rows.length >= 2) {
            const atual = rows[0];
            const latAtual = Number(atual.LAT);
            const lonAtual = Number(atual.LON);
            let bloco = [atual];
            for (let i = 1; i < rows.length; i++) {
              const p = rows[i];
              const d = alertService.calcularDistanciaHaversine(
                latAtual,
                lonAtual,
                Number(p.LAT),
                Number(p.LON)
              );
              if (!Number.isFinite(d) || d > raioMetros) break;
              bloco.push(p);
            }

            if (bloco.length >= 2) {
              const dtMaisRecente = new Date(bloco[0].DH);
              const dtMaisAntigaNoRaio = new Date(bloco[bloco.length - 1].DH);
              const minParadoContinuo = (dtMaisRecente.getTime() - dtMaisAntigaNoRaio.getTime()) / 60000;
              console.log(
                `   🔎 [Alertas] parada contínua viagem ${idViagem}: bloco=${bloco.length} minutos=${Number.isFinite(minParadoContinuo) ? minParadoContinuo.toFixed(1) : '—'} (raio<=${raioMetros}m, min>=${minMin})`
              );

              if (Number.isFinite(minParadoContinuo) && minParadoContinuo >= minMin) {
                const existeAlertaCont = await pool.request()
                  .input('idviagem', sql.Decimal(15, 0), idViagem)
                  .input('type', sql.NVarChar(20), 'PARADA')
                  .query(`
                    SELECT [ID] FROM [dbo].[ALERTS]
                    WHERE [IDVIAGEM] = @idviagem
                      AND [TYPE] = @type
                      AND COALESCE([RESOLVED], false) = false
                      AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                    LIMIT 1
                  `);

                if (existeAlertaCont.recordset.length === 0) {
                  const macroCtx = await getMacroCtxParada();
                  return {
                    idviagem: idViagem,
                    type: 'parada',
                    message: `Motorista parado há ${Math.round(minParadoContinuo)} minutos`,
                    severity: minParadoContinuo > 60 ? 'high' : 'medium',
                    details: JSON.stringify({
                      minutosParado: Math.round(minParadoContinuo),
                      pontosNoBloco: bloco.length,
                      raioMetros,
                      origemDeteccao: 'gps_continuo',
                      paradaIndevida: !!macroCtx.paradaIndevida,
                      motivoParadaIndevida: macroCtx.motivo || null,
                      macroJustificadora: macroCtx.macroNome || null
                    })
                  };
                } else {
                  const alertaExistente = existeAlertaCont.recordset[0];
                  const macroCtx = await getMacroCtxParada();
                  return {
                    idviagem: idViagem,
                    type: 'parada',
                    message: `Motorista parado há ${Math.round(minParadoContinuo)} minutos`,
                    severity: minParadoContinuo > 60 ? 'high' : 'medium',
                    details: JSON.stringify({
                      minutosParado: Math.round(minParadoContinuo),
                      pontosNoBloco: bloco.length,
                      raioMetros,
                      origemDeteccao: 'gps_continuo',
                      paradaIndevida: !!macroCtx.paradaIndevida,
                      motivoParadaIndevida: macroCtx.motivo || null,
                      macroJustificadora: macroCtx.macroNome || null
                    }),
                    __existingAlertId: alertaExistente.ID ?? alertaExistente.id
                  };
                }
              }
            }
          }
        } catch (errCont) {
          if (errCont.code !== '42P01' && errCont.code !== '42703') {
            console.warn(`   ⚠️ [Alertas] Falha no fallback contínuo de parada (viagem ${idViagem}):`, errCont.message);
          }
        }
      }

      // Fallback complementar por macros:
      // Se a última macro da viagem estiver em situação de PARADA (FGSITUACAO='P')
      // e já passou o tempo mínimo, gerar alerta mesmo quando o GPS não retrata bem o cenário.
      // Isso cobre casos como "Parada - Abastecimento" aberta sem "Viagem - Reinício".
      try {
        const tidMacroParada = await tenantIdForViagemDb(pool, idViagem);
        const macroRes = await pool.query(
          `SELECT 
             vo."CDTIPOOCORRENCIA",
             vo."DTOCORRENCIA",
             vo."DTCADASTRO",
             vo."DHMAINTENANCE",
             to2."FGSITUACAO",
             to2."DSTIPOOCORRENCIA",
             to2."FG_CONTROLE_TEMPO",
             to2."TEMPO_MAXIMO_MINUTOS"
           FROM public."VIAGEMOCORRENCIA" vo
           LEFT JOIN public."TIPOOCORRENCIA" to2
             ON to2."CDTIPOOCORRENCIA" = vo."CDTIPOOCORRENCIA"
            AND (to2."TENANT_ID" = $2 OR to2."TENANT_ID" = 'default')
           WHERE vo."IDVIAGEM" = $1
           ORDER BY COALESCE(vo."DTOCORRENCIA", vo."DTCADASTRO", vo."DHMAINTENANCE") DESC
           LIMIT 1`,
          [idViagem, tidMacroParada]
        );
        const macro = macroRes.rows && macroRes.rows[0];
        if (macro) {
          const situacao = String(macro.FGSITUACAO ?? macro.fgsituacao ?? '').trim().toUpperCase();
          const situacaoNorm = situacao.replace(/\s+/g, '');
          const nomeMacro = String(macro.DSTIPOOCORRENCIA ?? macro.dstipoocorrencia ?? 'macro');
          const fgControleTempo = String(macro.FG_CONTROLE_TEMPO ?? macro.fg_controle_tempo ?? 'N').trim().toUpperCase();
          const tempoMaxTipo = Number(macro.TEMPO_MAXIMO_MINUTOS ?? macro.tempo_maximo_minutos);
          const minParadaMacro = (fgControleTempo === 'S' && Number.isFinite(tempoMaxTipo) && tempoMaxTipo > 0)
            ? tempoMaxTipo
            : minMin;
          const dtMacro = macro.DTOCORRENCIA ?? macro.dtocorrencia ?? macro.DTCADASTRO ?? macro.dtcadastro ?? macro.DHMAINTENANCE ?? macro.dhmaintenance;
          const dtMacroObj = dtMacro ? new Date(dtMacro) : null;
          const minEmParada = dtMacroObj ? ((Date.now() - dtMacroObj.getTime()) / 60000) : null;

          const ehMacroParada = situacaoNorm === 'P' || /PARADA|RETIDO/i.test(nomeMacro);
          console.log(
            `   🔎 [Alertas] parada macro viagem ${idViagem}: situacao=${JSON.stringify(situacaoNorm || '-')} macro="${nomeMacro}" minutos=${minEmParada != null && Number.isFinite(minEmParada) ? minEmParada.toFixed(1) : '—'} (mín. ${minParadaMacro} | tipo-controle=${fgControleTempo} | elegivel=${ehMacroParada ? 'SIM' : 'NAO'})`
          );

          if (ehMacroParada && minEmParada != null && minEmParada >= minParadaMacro) {
            const existeAlertaMacro = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'PARADA')
              .query(`
                SELECT [ID] FROM [dbo].[ALERTS]
                WHERE [IDVIAGEM] = @idviagem
                  AND [TYPE] = @type
                  AND COALESCE([RESOLVED], false) = false
                  AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                LIMIT 1
              `);

            if (existeAlertaMacro.recordset.length === 0) {
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `${nomeMacro}: parada aberta há ${Math.round(minEmParada)} minutos`,
                severity: minEmParada > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: Math.round(minEmParada),
                  macro: nomeMacro,
                  cdTipoOcorrencia: macro.CDTIPOOCORRENCIA ?? macro.cdtipoocorrencia,
                  limiteMinutos: minParadaMacro,
                  controleTempoTipoOcorrencia: fgControleTempo,
                  origemDeteccao: 'macro'
                })
              };
            } else {
              console.log(`   ℹ️ [Alertas] parada(macro) suprimido: já existe alerta ativo para viagem ${idViagem}`);
              const alertaExistente = existeAlertaMacro.recordset[0];
              return {
                idviagem: idViagem,
                type: 'parada',
                message: `${nomeMacro}: parada aberta há ${Math.round(minEmParada)} minutos`,
                severity: minEmParada > 60 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosParado: Math.round(minEmParada),
                  macro: nomeMacro,
                  cdTipoOcorrencia: macro.CDTIPOOCORRENCIA ?? macro.cdtipoocorrencia,
                  limiteMinutos: minParadaMacro,
                  controleTempoTipoOcorrencia: fgControleTempo,
                  origemDeteccao: 'macro'
                }),
                __existingAlertId: alertaExistente.ID ?? alertaExistente.id
              };
            }
          } else if (!ehMacroParada) {
            console.log(`   ℹ️ [Alertas] parada(macro) ignorado: última macro não é de parada/retido`);
          }
        } else {
          console.log(`   🔎 [Alertas] parada macro viagem ${idViagem}: sem macros registradas`);
        }
      } catch (errMacro) {
        if (errMacro.code !== '42P01' && errMacro.code !== '42703') {
          console.warn(`   ⚠️ [Alertas] Falha ao avaliar macro de parada viagem ${idViagem}:`, errMacro.message);
        }
      }

      return null;
    } catch (err) {
      if (err.code === '42P01') {
        console.warn('⚠️ [Alertas] verificarParadaProlongada: relação não existe (ignorando):', err.message);
        return null;
      }
      console.error('Erro ao verificar parada prolongada:', err);
      return null;
    }
  },

  heartbeatHabilitadoParaTipo: (config, type) => {
    if (!config) return false;
    if (String(config.alert_heartbeat_ativo || 'N').trim().toUpperCase() !== 'S') return false;
    const tipo = String(type || '').trim().toUpperCase();
    if (!tipo) return false;
    const tipos = String(config.alert_heartbeat_tipos || '')
      .split(',')
      .map(s => String(s || '').trim().toUpperCase())
      .filter(Boolean);
    return tipos.includes(tipo);
  },

  /**
   * Calcular ETA dinâmico usando OSRM
   * @param {number} lat1 - Latitude origem
   * @param {number} lon1 - Longitude origem
   * @param {number} lat2 - Latitude destino
   * @param {number} lon2 - Longitude destino
   * @returns {Promise<{duration: number, distance: number}>} Duração em segundos e distância em metros
   */
  calcularETADinamico: async (lat1, lon1, lat2, lon2) => {
    try {
      // Usar servidor OSRM público (pode ser configurado)
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${lon1},${lat1};${lon2},${lat2}?overview=false`;
      
      const response = await axios.get(osrmUrl, {
        headers: {
          'User-Agent': 'AtlasCargo/2.0'
        },
        timeout: 10000 // 10 segundos
      });

      if (response.data && response.data.routes && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        return {
          duration: route.duration, // em segundos
          distance: route.distance // em metros
        };
      }

      return null;
    } catch (err) {
      console.warn('Erro ao calcular ETA dinâmico:', err.message);
      return null;
    }
  },

  /**
   * Verificar se viagem está atrasada (com ETA dinâmico)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarAtraso: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const margemCfg = Number(cfg.alert_atraso_margem_minutos);
      const margemMin = Number.isFinite(margemCfg) && margemCfg >= 0 ? margemCfg : 0;
      // Buscar dados da viagem
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[DTPREVFINAL] AS DHENTREGA,
            [v].[CDSITUACAOVIAGEM],
            [v].[IDROTEIRO],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO]
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
            AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          WHERE [v].[IDVIAGEM] = @idviagem
            AND [v].[DTPREVFINAL] IS NOT NULL
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        const definirSeveridadeEtaPrazo = (min) => {
          const m = Math.abs(Number(min) || 0);
          if (m >= 120) return 'high';
          if (m >= 30) return 'medium';
          return 'low';
        };
        const montarMensagemEtaPrazo = (min) => {
          const m = Math.abs(Number(min) || 0);
          return `Risco de atraso na chegada: ETA ${m} min após o prazo`;
        };
        
        const ultimaPos = await buscarUltimaPosicaoRastreamento(pool, rctx, idViagem);

        // Buscar coordenadas de origem e destino de ROTEIROPONTOS
        let origemLat = null, origemLon = null, destinoLat = null, destinoLon = null;
        if (viagem.IDROTEIRO) {
          const pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT [LATITUDE], [LONGITUDE], [TPLOCAL]
              FROM [dbo].[ROTEIROPONTOS]
              WHERE [IDROTEIRO] = @idroteiro
                AND [LATITUDE] IS NOT NULL
                AND [LONGITUDE] IS NOT NULL
              ORDER BY 
                CASE [TPLOCAL]
                  WHEN 'O' THEN 1
                  WHEN 'D' THEN 2
                  ELSE 3
                END,
                [ORDEM], [SEQUENCIA]
            `);
          
          if (pontosResult.recordset.length > 0) {
            const pontoOrigem = pontosResult.recordset.find(p => p.TPLOCAL === 'O') || pontosResult.recordset[0];
            const pontoDestino = pontosResult.recordset.find(p => p.TPLOCAL === 'D') || pontosResult.recordset[pontosResult.recordset.length - 1];
            
            origemLat = pontoOrigem ? pontoOrigem.LATITUDE : null;
            origemLon = pontoOrigem ? pontoOrigem.LONGITUDE : null;
            destinoLat = pontoDestino ? pontoDestino.LATITUDE : null;
            destinoLon = pontoDestino ? pontoDestino.LONGITUDE : null;
          }
        }
        
        const dhEntrega = viagem.DHENTREGA ?? viagem.dhentrega ?? viagem.DTPREVFINAL ?? viagem.dtprevfinal;
        if (dhEntrega) {
          const agora = new Date();
          const prazo = new Date(dhEntrega);
          const prazoComMargem = new Date(prazo.getTime() + (margemMin * 60000));
          const definirSeveridadeAtraso = (min) => {
            const m = Math.abs(Number(min) || 0);
            if (m >= 120) return 'high';
            if (m >= 30) return 'medium';
            return 'low';
          };
          const montarMensagemAtrasoPrevisto = (min) => {
            const m = Math.abs(Number(min) || 0);
            return `Atraso previsto na chegada: ${m} min além do prazo`;
          };
          const montarMensagemAtrasoConfirmado = (minAtrasoRelogio, extras = {}) => {
            const m = Math.abs(Number(minAtrasoRelogio) || 0);
            const eta = Number(extras.etaMinutos);
            const km = Number(extras.distanciaRestanteKm);
            const sufixoEta = Number.isFinite(eta) && eta > 0
              ? ` ETA restante ~${Math.round(eta)} min`
              : '';
            const sufixoKm = Number.isFinite(km) && km > 0
              ? `, distância restante ~${km.toFixed(1)} km`
              : '';
            return `Chegada em atraso: prazo de entrega vencido há ${m} minutos.${sufixoEta}${sufixoKm}`;
          };
          const temGpsValido = !!(ultimaPos && ultimaPos.LATITUDE && ultimaPos.LONGITUDE);
          const ultimaPosDate = temGpsValido ? new Date(ultimaPos.DHREGISTRO) : null;
          const gpsRecente = !!(ultimaPosDate && (agora - ultimaPosDate) < 3600000);
          
          // Se última posição foi há menos de 1 hora (não é offline), usar ETA dinâmico/simples
          if (temGpsValido && gpsRecente) {
            // Calcular ETA dinâmico se tiver coordenadas de destino
            let etaMinutos = null;
            let usandoETADinamico = false;
            let distanciaRestanteKm = null;

            if (destinoLat && destinoLon) {
              const eta = await alertService.calcularETADinamico(
                ultimaPos.LATITUDE,
                ultimaPos.LONGITUDE,
                destinoLat,
                destinoLon
              );

              if (eta && eta.duration) {
                etaMinutos = Math.ceil(eta.duration / 60); // Converter segundos para minutos
                usandoETADinamico = true;
                if (eta.distance != null) {
                  const km = Number(eta.distance) / 1000;
                  distanciaRestanteKm = Number.isFinite(km) ? km : null;
                }
              }
            }

            // Se não conseguiu calcular ETA dinâmico, usar cálculo simples baseado em distância
            if (!etaMinutos && destinoLat && destinoLon) {
              // Calcular distância em linha reta (Haversine)
              const distancia = alertService.calcularDistanciaHaversine(
                ultimaPos.LATITUDE,
                ultimaPos.LONGITUDE,
                destinoLat,
                destinoLon
              );
              distanciaRestanteKm = Number.isFinite(distancia) ? (distancia / 1000) : null;

              const velUlt = ultimaPos.VELOCIDADE != null ? Number(ultimaPos.VELOCIDADE) : NaN;
              const velocidadeMediaKmh = Number.isFinite(velUlt) && velUlt > 0 ? velUlt : 60;
              etaMinutos = Math.ceil((distancia / 1000) / (velocidadeMediaKmh / 60));
            }

            // Verificar se está atrasado
            const chegadaEstimada = new Date(agora.getTime() + (etaMinutos ? etaMinutos * 60000 : 0));
            const estaAtrasado = chegadaEstimada > prazoComMargem || agora > prazoComMargem;
            console.log(
              `   🔎 [Alertas] atraso viagem ${idViagem}: margem=${margemMin} ETAmin=${etaMinutos != null ? etaMinutos : '—'} prazo=${prazo.toISOString()} prazo+mg=${prazoComMargem.toISOString()}`
            );

            if (estaAtrasado) {
              const minutosAtraso = etaMinutos 
                ? Math.floor((chegadaEstimada - prazoComMargem) / 60000)
                : Math.floor((agora - prazoComMargem) / 60000);

              // Verificar se já existe alerta ativo
              const existeAlerta = await pool.request()
                .input('idviagem', sql.Decimal(15, 0), idViagem)
                .input('type', sql.NVarChar(20), 'ATRASO')
                .query(`
                  SELECT [ID] FROM [dbo].[ALERTS]
                  WHERE [IDVIAGEM] = @idviagem
                    AND [TYPE] = @type
                    AND COALESCE([RESOLVED], false) = false
                    AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                LIMIT 1
                `);

              if (existeAlerta.recordset.length === 0) {
                const atrasadoPorRelogio = agora > prazoComMargem;
                const minutosAtrasoRelogio = Math.max(0, Math.floor((agora - prazoComMargem) / 60000));
                return {
                  idviagem: idViagem,
                  type: 'atraso',
                  message: atrasadoPorRelogio
                    ? montarMensagemAtrasoConfirmado(minutosAtrasoRelogio, { etaMinutos, distanciaRestanteKm })
                    : montarMensagemAtrasoPrevisto(minutosAtraso),
                  severity: definirSeveridadeAtraso(minutosAtraso),
                  details: JSON.stringify({
                    minutosAtraso: minutosAtraso,
                    margemMinutos: margemMin,
                    prazoEntrega: dhEntrega,
                    etaMinutos: etaMinutos,
                    usandoETADinamico: usandoETADinamico,
                    distanciaRestanteKm: distanciaRestanteKm,
                    origemDeteccao: atrasadoPorRelogio ? 'prazo_estourado_com_eta' : 'gps_eta'
                  })
                };
              }
            }
          } else {
            // Refino: mesmo sem GPS recente, se já estourou prazo+margem deve alertar atraso de chegada.
            console.log(
              `   🔎 [Alertas] atraso viagem ${idViagem}: sem GPS recente (última=${ultimaPosDate ? ultimaPosDate.toISOString() : '—'}), avaliando por prazo estourado`
            );
          }

          if (agora > prazoComMargem) {
            const minutosAtraso = Math.floor((agora - prazoComMargem) / 60000);
            const existeAlertaRelogio = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'ATRASO')
              .query(`
                SELECT [ID] FROM [dbo].[ALERTS]
                WHERE [IDVIAGEM] = @idviagem
                  AND [TYPE] = @type
                  AND COALESCE([RESOLVED], false) = false
                  AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                LIMIT 1
              `);

            if (existeAlertaRelogio.recordset.length === 0) {
              return {
                idviagem: idViagem,
                type: 'atraso',
                message: montarMensagemAtrasoConfirmado(minutosAtraso),
                severity: definirSeveridadeAtraso(minutosAtraso),
                details: JSON.stringify({
                  minutosAtraso,
                  margemMinutos: margemMin,
                  prazoEntrega: dhEntrega,
                  origemDeteccao: gpsRecente ? 'gps_eta' : 'prazo_estourado_sem_gps_recente',
                  ultimaPosicao: ultimaPosDate ? ultimaPosDate.toISOString() : null
                })
              };
            }
          }
        }
      }

      return null;
    } catch (err) {
      if (err.code === '42P01') return null;
      console.error('Erro ao verificar atraso:', err);
      return null;
    }
  },

  /**
   * Verificar se ETA estimado > prazo de entrega (alerta preventivo)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarETAPrazo: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const margemCfg = Number(cfg.alert_atraso_margem_minutos);
      const margemMin = Number.isFinite(margemCfg) && margemCfg >= 0 ? margemCfg : 0;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[DTPREVFINAL] AS DHENTREGA,
            [v].[IDROTEIRO],
            [r].[CDCIDADEDESTINO]
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
            AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          WHERE [v].[IDVIAGEM] = @idviagem
            AND [v].[DTPREVFINAL] IS NOT NULL
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        
        const ultimaPos = await buscarUltimaPosicaoRastreamento(pool, rctx, idViagem);

        // Buscar coordenadas de destino de ROTEIROPONTOS
        let destinoLat = null, destinoLon = null;
        if (viagem.IDROTEIRO) {
          // Primeiro tentar buscar ponto com TPLOCAL = 'D'
          let pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT [LATITUDE], [LONGITUDE], [TPLOCAL]
              FROM [dbo].[ROTEIROPONTOS]
              WHERE [IDROTEIRO] = @idroteiro
                AND [TPLOCAL] = 'D'
                AND [LATITUDE] IS NOT NULL
                AND [LONGITUDE] IS NOT NULL
              ORDER BY [ORDEM] DESC, [SEQUENCIA] DESC
            LIMIT 1
            `);
          
          // Se não encontrou destino marcado, pegar o último ponto por ORDEM
          if (pontosResult.recordset.length === 0) {
            pontosResult = await pool.request()
              .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
              .query(`
                SELECT [LATITUDE], [LONGITUDE], [TPLOCAL]
                FROM [dbo].[ROTEIROPONTOS]
                WHERE [IDROTEIRO] = @idroteiro
                  AND [LATITUDE] IS NOT NULL
                  AND [LONGITUDE] IS NOT NULL
                ORDER BY [ORDEM] DESC, [SEQUENCIA] DESC
              LIMIT 1
              `);
          }
          
          if (pontosResult.recordset.length > 0) {
            destinoLat = pontosResult.recordset[0].LATITUDE;
            destinoLon = pontosResult.recordset[0].LONGITUDE;
          }
        }
        
        if (ultimaPos && viagem.DHENTREGA && ultimaPos.LATITUDE && ultimaPos.LONGITUDE && 
            destinoLat && destinoLon) {
          const agora = new Date();
          const prazo = new Date(viagem.DHENTREGA);
          const ultimaPosDate = new Date(ultimaPos.DHREGISTRO);
          
          // Só verificar se última posição foi há menos de 1 hora
          if ((agora - ultimaPosDate) < 3600000) {
            // Calcular ETA dinâmico
            const eta = await alertService.calcularETADinamico(
              ultimaPos.LATITUDE,
              ultimaPos.LONGITUDE,
              destinoLat,
              destinoLon
            );

            if (eta && eta.duration) {
              const etaMinutos = Math.ceil(eta.duration / 60);
              const chegadaEstimada = new Date(agora.getTime() + (etaMinutos * 60000));
              
              const prazoComMargem = new Date(prazo.getTime() + (margemMin * 60000));
              // Se ETA > prazo(+margem) e ainda não passou do prazo(+margem), manter como preventivo
              if (chegadaEstimada > prazoComMargem && agora < prazoComMargem) {
                const minutosAlemPrazo = Math.floor((chegadaEstimada - prazoComMargem) / 60000);

                // Verificar se já existe alerta ativo
                const existeAlerta = await pool.request()
                  .input('idviagem', sql.Decimal(15, 0), idViagem)
                  .input('type', sql.NVarChar(20), 'ETA_PRAZO')
                  .query(`
SELECT [ID] FROM [dbo].[ALERTS]
                    WHERE [IDVIAGEM] = @idviagem
                      AND [TYPE] = @type
                      AND COALESCE([RESOLVED], false) = false
                      AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                  LIMIT 1
                  `);

                  if (existeAlerta.recordset.length === 0) {
                    return {
                      idviagem: idViagem,
                      type: 'eta_prazo',
                    message: montarMensagemEtaPrazo(minutosAlemPrazo),
                    severity: definirSeveridadeEtaPrazo(minutosAlemPrazo),
                    details: JSON.stringify({
                      etaMinutos: etaMinutos,
                      minutosAlemPrazo: minutosAlemPrazo,
                      margemMinutos: margemMin,
                      prazoEntrega: viagem.DHENTREGA,
                      chegadaEstimada: chegadaEstimada.toISOString(),
                      origemDeteccao: 'eta_preventivo'
                    })
                  };
                }
              }
            }
          }
        }
      }

      return null;
    } catch (err) {
      if (err.code === '42P01') return null;
      console.error('Erro ao verificar ETA vs prazo:', err);
      return null;
    }
  },

  /**
   * Calcular distância usando fórmula de Haversine (linha reta)
   */
  calcularDistanciaHaversine: (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distância em metros
  },

  /**
   * Verificar se motorista está offline há muito tempo
   * @param {object} config - Opcional; usa config.alert_offline_minutos (default 90)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarOffline: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const { fromSql, cols } = rctx;
      const dtExpr = exprDhPosicaoGps(cols) || cols.dh;
      if (!cols.idv || !dtExpr) return null;
      const minutosCfg = config != null && config.alert_offline_minutos != null
        ? Number(config.alert_offline_minutos)
        : NaN;
      const minutosMin = Number.isFinite(minutosCfg) && minutosCfg >= 0 ? minutosCfg : 90;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            (${dtExpr}) AS "DHREGISTRO",
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - (${dtExpr})))/60::float as "minutosOffline"
          FROM ${fromSql}
          WHERE ${cols.idv} = @idviagem
          ORDER BY (${dtExpr}) DESC
          LIMIT 1
        `);

      if (result.recordset.length > 0) {
        const data = rowRastreamentoCanon(result.recordset[0]);
        const minOff = data.minutosOffline != null ? Number(data.minutosOffline) : null;
        console.log(
          `   🔎 [Alertas] offline viagem ${idViagem}: minutosSemPosicao=${minOff != null && Number.isFinite(minOff) ? minOff.toFixed(1) : '—'} (limite config=${minutosMin})`
        );
        if (data.minutosOffline >= minutosMin) {
          const minutosOfflineInt = Math.round(Number(data.minutosOffline) || 0);
          const viagemAtiva = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .query(`
              SELECT [v].[CDSITUACAOVIAGEM]
              FROM [dbo].[VIAGEMMESTRE] [v]
              WHERE [v].[IDVIAGEM] = @idviagem
                AND [v].[FGACTIVE] = 'A'
            `);

          if (viagemAtiva.recordset.length > 0) {
            const sitRow = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .query(`
                SELECT
                  UPPER(TRIM(COALESCE([s].[FGSITVIAGEM], [v].[FGSITVIAGEM], ''))) AS [FG],
                  [v].[DTPREVINICIO] AS [DTPREVINICIO]
                FROM [dbo].[VIAGEMMESTRE] [v]
                LEFT JOIN [dbo].[SITUACAOVIAGEM] [s] ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
                WHERE [v].[IDVIAGEM] = @idviagem
                LIMIT 1
              `);
            const sit0 = sitRow.recordset && sitRow.recordset[0];
            const fgSit = String((sit0 && (sit0.FG || sit0.fg)) || '').toUpperCase();
            if (['C', 'F', 'E', 'D'].includes(fgSit)) {
              console.log(`   ℹ️ [Alertas] offline não elegível: situação ${fgSit || '—'} (viagem ${idViagem})`);
            } else {
            const dtPrev = sit0 && (sit0.DTPREVINICIO || sit0.dtprevinicio);
            const dhGps = data.DHREGISTRO ? new Date(data.DHREGISTRO) : null;
            if (dtPrev && dhGps && !isNaN(dhGps.getTime()) && dhGps.getTime() < new Date(dtPrev).getTime() - 6 * 3600000) {
              console.log(
                `   ℹ️ [Alertas] offline ignorado: GPS ${dhGps.toISOString()} anterior ao início previsto ${new Date(dtPrev).toISOString()} (viagem ${idViagem})`
              );
            } else {
            // Verificar se já existe alerta ativo
            const existeAlerta = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'OFFLINE')
              .query(`
                SELECT [ID] FROM [dbo].[ALERTS]
                WHERE [IDVIAGEM] = @idviagem
                  AND [TYPE] = @type
                  AND COALESCE([RESOLVED], false) = false
                  AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
              LIMIT 1
              `);

            if (existeAlerta.recordset.length === 0) {
              return {
                idviagem: idViagem,
                type: 'offline',
                message: `Motorista offline há ${minutosOfflineInt} minutos`,
                severity: minutosOfflineInt > 180 ? 'high' : 'medium',
                details: JSON.stringify({
                  minutosOffline: minutosOfflineInt,
                  ultimaPosicao: data.DHREGISTRO
                })
              };
            }
            console.log(`   ℹ️ [Alertas] offline suprimido: já existe alerta ativo para viagem ${idViagem}`);
            }
            }
          } else {
            console.log(`   ℹ️ [Alertas] offline não elegível: viagem não está ativa`);
          }
        }
      } else {
        // Nenhuma posição registrada na viagem: considerar offline se viagem ativa e início > 90 min
        const viagemSemPosicao = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT [v].[IDVIAGEM], [v].[DTPREVINICIO],
              EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - [v].[DTPREVINICIO]))/60::float as "minutosOffline"
            FROM [dbo].[VIAGEMMESTRE] [v]
            WHERE [v].[IDVIAGEM] = @idviagem
              AND [v].[DTPREVINICIO] IS NOT NULL
              AND [v].[DTPREVINICIO] < CURRENT_TIMESTAMP
              AND [v].[FGACTIVE] = 'A'
          `);
        if (viagemSemPosicao.recordset.length > 0) {
          const data = viagemSemPosicao.recordset[0];
          const minutosOffline = data.minutosOffline || 0;
          console.log(
            `   🔎 [Alertas] offline sem-posicao viagem ${idViagem}: minutosDesdePrevInicio=${Number(minutosOffline).toFixed(1)} (limite config=${minutosMin})`
          );
          if (minutosOffline >= minutosMin) {
            const existeAlerta = await pool.request()
              .input('idviagem', sql.Decimal(15, 0), idViagem)
              .input('type', sql.NVarChar(20), 'OFFLINE')
              .query(`
                SELECT [ID] FROM [dbo].[ALERTS]
                WHERE [IDVIAGEM] = @idviagem AND [TYPE] = @type
                  AND COALESCE([RESOLVED], false) = false
                  AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
                LIMIT 1
              `);
            if (existeAlerta.recordset.length === 0) {
              const minArred = Math.round(minutosOffline);
              return {
                idviagem: idViagem,
                type: 'offline',
                message: `Sem ponto GPS na viagem no banco; início previsto há ${minArred} min (viagem ${idViagem})`,
                severity: minutosOffline > 180 ? 'high' : 'medium',
                details: JSON.stringify({
                  semPosicao: true,
                  minutosDesdeDtPrevInicio: minutosOffline,
                  minutosOffline: Math.round(Number(minutosOffline) || 0),
                  dtPrevInicio: data.DTPREVINICIO,
                  observacao:
                    'A checagem não encontrou nenhuma linha em VIAGEMRASTREAMENTO para esta viagem. minutosOffline/minutosDesdeDtPrevInicio = tempo desde DTPREVINICIO (não “minutos desde o último GPS”). Se o app envia posição, confira inserts na mesma tabela que o job usa e reinicie o Node após corrigir o cache de rastreamento.',
                }),
              };
            } else {
              console.log(`   ℹ️ [Alertas] offline(sem posição) suprimido: já existe alerta ativo para viagem ${idViagem}`);
            }
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Erro ao verificar offline:', err);
      return null;
    }
  },

  /**
   * Verificar desvio de rota (buffer configurável em metros)
   * @param {object} config - Opcional; usa config.alert_desvio_metros (default 500)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarDesvioRota: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const { fromSql, cols } = rctx;
      const dtExpr = exprDhPosicaoGps(cols) || cols.dh;
      if (!cols.idv || !cols.lat || !cols.lon || !dtExpr) return null;
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const desvioMetros = cfg.alert_desvio_metros != null ? Number(cfg.alert_desvio_metros) : 500;
      const suprimirQuandoParado = String(cfg.alert_desvio_suprimir_quando_parado_ativo || 'S').trim().toUpperCase() === 'S';
      const minParada = Math.max(1, Number(cfg.alert_parada_minutos_min) || 30);
      const janelaParada = Math.max(2, Math.min(120, Number(cfg.alert_parada_janela_posicoes) || 60));
      const raioParada = Math.max(20, Math.min(1000, Number(cfg.alert_parada_raio_metros) || 200));
      // Buscar roteiro
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[IDROTEIRO],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO]
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
            AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          WHERE [v].[IDVIAGEM] = @idviagem
        `);

      if (result.recordset.length > 0) {
        const viagem = result.recordset[0];
        
        const ultimaPosResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idViagem)
          .query(`
            SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE", (${dtExpr}) AS "DHREGISTRO"
            FROM ${fromSql}
            WHERE ${cols.idv} = @idviagem
            ORDER BY (${dtExpr}) DESC
            LIMIT 1
          `);

        const ultimaPos = rowRastreamentoCanon(
          ultimaPosResult.recordset.length > 0 ? ultimaPosResult.recordset[0] : null
        );
        
        if (!ultimaPos || !ultimaPos.LATITUDE || !ultimaPos.LONGITUDE) {
          return null; // Sem posição GPS
        }
        
        // Buscar coordenadas de origem e destino de ROTEIROPONTOS
        let origemLat = null, origemLon = null, destinoLat = null, destinoLon = null;

        // Buscar pontos de rota se houver roteiro
        let pontosRota = [];
        if (viagem.IDROTEIRO) {
          const pontosResult = await pool.request()
            .input('idroteiro', sql.Decimal(15, 0), viagem.IDROTEIRO)
            .query(`
              SELECT [LATITUDE], [LONGITUDE], [SEQUENCIA], [TPLOCAL]
              FROM [dbo].[ROTEIROPONTOS]
              WHERE [IDROTEIRO] = @idroteiro
                AND [LATITUDE] IS NOT NULL
                AND [LONGITUDE] IS NOT NULL
              ORDER BY [ORDEM], [SEQUENCIA]
            `);
          pontosRota = pontosResult.recordset;
          
          // Extrair origem e destino dos pontos
          if (pontosRota.length > 0) {
            const pontoOrigem = pontosRota.find(p => p.TPLOCAL === 'O') || pontosRota[0];
            const pontoDestino = pontosRota.find(p => p.TPLOCAL === 'D') || pontosRota[pontosRota.length - 1];
            
            origemLat = pontoOrigem ? pontoOrigem.LATITUDE : null;
            origemLon = pontoOrigem ? pontoOrigem.LONGITUDE : null;
            destinoLat = pontoDestino ? pontoDestino.LATITUDE : null;
            destinoLon = pontoDestino ? pontoDestino.LONGITUDE : null;
          }
        }

        let distanciaMinima = Infinity;

        if (pontosRota.length > 0) {
          // Tem pontos de rota - verificar distância mínima até qualquer ponto
          for (const ponto of pontosRota) {
            const distancia = alertService.calcularDistanciaHaversine(
              ultimaPos.LATITUDE,
              ultimaPos.LONGITUDE,
              ponto.LATITUDE,
              ponto.LONGITUDE
            );
            
            if (distancia < distanciaMinima) {
              distanciaMinima = distancia;
            }
          }
        } else if (origemLat && origemLon && destinoLat && destinoLon) {
          // Sem pontos de rota, usar origem e destino
          const distancia = alertService.distanciaParaLinha(
            ultimaPos.LATITUDE,
            ultimaPos.LONGITUDE,
            origemLat,
            origemLon,
            destinoLat,
            destinoLon
          );
          distanciaMinima = distancia;
        } else {
          // Fallback: roteiro sem ROTEIROPONTOS — segmento 1ª posição até penúltima; distância da posição atual a esse segmento
          const primeiraResult = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .query(`
              SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE"
              FROM ${fromSql}
              WHERE ${cols.idv} = @idviagem AND ${cols.lat} IS NOT NULL AND ${cols.lon} IS NOT NULL
              ORDER BY (${dtExpr}) ASC
              LIMIT 1
            `);
          const penultimaResult = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .query(`
              SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE"
              FROM ${fromSql}
              WHERE ${cols.idv} = @idviagem AND ${cols.lat} IS NOT NULL AND ${cols.lon} IS NOT NULL
              ORDER BY (${dtExpr}) DESC
              OFFSET 1
              LIMIT 1
            `);
          const primeira = rowRastreamentoCanon(primeiraResult.recordset[0]);
          const penultima = rowRastreamentoCanon(penultimaResult.recordset[0]);
          if (primeira && penultima) {
            const dist = alertService.distanciaParaLinha(
              ultimaPos.LATITUDE,
              ultimaPos.LONGITUDE,
              primeira.LATITUDE,
              primeira.LONGITUDE,
              penultima.LATITUDE,
              penultima.LONGITUDE
            );
            if (dist < distanciaMinima) distanciaMinima = dist;
          }
        }

        let infoParado = null;
        if (distanciaMinima > desvioMetros && distanciaMinima !== Infinity) {
          if (suprimirQuandoParado) {
            try {
              const paradoRes = await pool.request()
                .input('idviagem', sql.Decimal(15, 0), idViagem)
                .input('limite', janelaParada)
                .query(`
                  SELECT
                    COUNT(*)::int AS "totalPontos",
                    EXTRACT(EPOCH FROM (MAX(sub.dh_ord) - MIN(sub.dh_ord)))/60::float AS "minutosJanela",
                    (
                      111320.0 * SQRT(
                        POWER((MAX(sub.lat_num) - MIN(sub.lat_num)), 2) +
                        POWER((MAX(sub.lon_num) - MIN(sub.lon_num)) * COS(RADIANS(AVG(sub.lat_num))), 2)
                      )
                    )::float AS "deslocamentoAproxMetros"
                  FROM (
                    SELECT
                      (${dtExpr}) AS dh_ord,
                      CAST(${cols.lat} AS DOUBLE PRECISION) AS lat_num,
                      CAST(${cols.lon} AS DOUBLE PRECISION) AS lon_num
                    FROM ${fromSql}
                    WHERE ${cols.idv} = @idviagem
                      AND (${dtExpr}) >= (CURRENT_TIMESTAMP - INTERVAL '60 minutes')
                      AND ${cols.lat} IS NOT NULL
                      AND ${cols.lon} IS NOT NULL
                    ORDER BY (${dtExpr}) DESC
                    LIMIT @limite
                  ) sub
                `);
              const p = (paradoRes.recordset && paradoRes.recordset[0]) || {};
              const pontos = Number(p.totalPontos || 0);
              const minutos = Number(p.minutosJanela || 0);
              const desloc = Number(p.deslocamentoAproxMetros || 0);
              const paradoNoRaio = pontos >= 2 && minutos >= minParada && Number.isFinite(desloc) && desloc <= raioParada;
              infoParado = { paradoNoRaio, pontos, minutos, desloc };
              if (paradoNoRaio) {
                const macroCtx = await obterContextoMacroParada(pool, idViagem, minParada);
                if (macroCtx.temMacroJustificadora && macroCtx.macroDentroLimite) {
                  console.log(
                    `   ℹ️ [Alertas] desvio suprimido: parado com macro justificadora ativa (macro=${macroCtx.macroNome || '-'}, pontos=${pontos}, minutos=${minutos.toFixed(1)}, desloc≈${desloc.toFixed(1)}m)`
                  );
                  return null;
                }
                console.log(
                  `   ⚠️ [Alertas] desvio mantido: parado sem justificativa válida (motivo=${macroCtx.motivo || 'desconhecido'}, macro=${macroCtx.macroNome || '-'})`
                );
              }
            } catch (eParado) {
              if (eParado.code !== '42P01' && eParado.code !== '42703') {
                console.warn(`   ⚠️ [Alertas] Falha ao avaliar supressão de desvio por parada (viagem ${idViagem}):`, eParado.message);
              }
            }
          }
          // Verificar se já existe alerta ativo
          const existeAlerta = await pool.request()
            .input('idviagem', sql.Decimal(15, 0), idViagem)
            .input('type', sql.NVarChar(20), 'DESVIO')
            .query(`
              SELECT [ID] FROM [dbo].[ALERTS]
              WHERE [IDVIAGEM] = @idviagem
                AND [TYPE] = @type
                AND COALESCE([RESOLVED], false) = false
                AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
            LIMIT 1
            `);

          if (existeAlerta.recordset.length === 0) {
            return {
              idviagem: idViagem,
              type: 'desvio',
              message: `Desvio de rota detectado: ${Math.round(distanciaMinima)}m fora do trajeto planejado`,
              severity: distanciaMinima > 2000 ? 'high' : 'medium',
              details: JSON.stringify({
                distanciaMetros: Math.round(distanciaMinima),
                posicaoAtual: {
                  lat: ultimaPos.LATITUDE,
                  lon: ultimaPos.LONGITUDE
                },
                paradoNoRaio: !!(infoParado && infoParado.paradoNoRaio),
                paradaIndevida: !!(infoParado && infoParado.paradoNoRaio),
                origemDeteccao: 'desvio_rota'
              })
            };
          }
        }
      }

      return null;
    } catch (err) {
      if (err.code === '42P01') return null;
      console.error('Erro ao verificar desvio de rota:', err);
      return null;
    }
  },

  /**
   * Verificar atraso para iniciar a viagem: DTPREVINICIO já passou e ainda não há posição GPS nem macro "Viagem - Início" (103)
   * @param {object} config - alert_atraso_inicio_margem_minutos (minutos após DTPREVINICIO para considerar atraso)
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarAtrasoIniciar: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      await rastreamentoCtx(pool, tableRastreamento);
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const margemMin = Number(cfg.alert_atraso_inicio_margem_minutos) || 15;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('margem', margemMin)
        .query(`
          SELECT [v].[IDVIAGEM], [v].[DTPREVINICIO],
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - [v].[DTPREVINICIO]))/60::float as "minutosAtraso"
          FROM [dbo].[VIAGEMMESTRE] [v]
          WHERE [v].[IDVIAGEM] = @idviagem
            AND [v].[DTPREVINICIO] IS NOT NULL
            AND [v].[DTPREVINICIO] < (CURRENT_TIMESTAMP - (@margem * INTERVAL '1 minute'))
            AND [v].[FGACTIVE] = 'A'
        `);
      if (result.recordset.length === 0) return null;

      const viagem = result.recordset[0];
      const minutosAtraso = (viagem.minutosAtraso || 0) - margemMin;
      const tidAtrasoIni = await tenantIdForViagemDb(pool, idViagem);

      // Regra de negócio: atraso para iniciar considera "registro de início de viagem" (macro).
      // Compatível com códigos antigos/novos e com cadastro por FGSITUACAO/SEQ.
      const macroInicio = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('dtprev', viagem.DTPREVINICIO)
        .input('tid', sql.NVarChar(64), tidAtrasoIni)
        .query(`
          SELECT 1
          FROM [dbo].[VIAGEMOCORRENCIA] [vo]
          INNER JOIN [dbo].[TIPOOCORRENCIA] [to2]
            ON [to2].[CDTIPOOCORRENCIA] = [vo].[CDTIPOOCORRENCIA]
            AND ([to2].[TENANT_ID] = @tid OR [to2].[TENANT_ID] = 'default')
          WHERE [vo].[IDVIAGEM] = @idviagem
            AND COALESCE([vo].[DTOCORRENCIA], [vo].[DTCADASTRO], [vo].[DHMAINTENANCE]) >= @dtprev
            AND (
              [vo].[CDTIPOOCORRENCIA] IN (1, 103)
              OR translate(lower(trim(coalesce([to2].[DSTIPOOCORRENCIA], ''))), 'íìî', 'iii') = 'viagem - inicio'
            )
          LIMIT 1
        `);
      const temRegistroInicio = macroInicio.recordset && macroInicio.recordset.length > 0;
      console.log(
        `   🔎 [Alertas] atraso_inicio viagem ${idViagem}: minutosAtraso=${Number(minutosAtraso).toFixed(1)} (margem=${margemMin}) registroInicio=${temRegistroInicio ? 'SIM' : 'NAO'}`
      );
      if (temRegistroInicio) return null;

      const existeAlerta = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('type', sql.NVarChar(20), 'ATRASO_INICIO')
        .query(`
          SELECT [ID] FROM [dbo].[ALERTS]
          WHERE [IDVIAGEM] = @idviagem AND [TYPE] = @type
            AND COALESCE([RESOLVED], false) = false
            AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
          LIMIT 1
        `);
      if (existeAlerta.recordset.length > 0) return null;

      return {
        idviagem: idViagem,
        type: 'atraso_inicio',
        message: `Atraso para iniciar viagem: previsão de início já passou há ${Math.round(minutosAtraso)} minutos`,
        severity: minutosAtraso > 60 ? 'high' : 'medium',
        details: JSON.stringify({
          minutosAtraso: Math.round(minutosAtraso),
          dtPrevInicio: viagem.DTPREVINICIO
        })
      };
    } catch (err) {
      if (err.code === '42P01') return null;
      console.error('Erro ao verificar atraso para iniciar:', err);
      return null;
    }
  },

  /**
   * Verificar excesso de velocidade: últimas N posições com velocidade acima do limite configurável
   * @param {object} config - alert_excesso_velocidade_kmh, alert_excesso_velocidade_janela
   * @param {string} tableRastreamento - Nome da tabela de rastreamento
   */
  verificarExcessoVelocidade: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const { fromSql, cols } = rctx;
      const dtExpr = exprDhPosicaoGps(cols) || cols.dh;
      if (!cols.vel || !cols.idv || !dtExpr) {
        warnMissingVelocidadeColumnOnce();
        return null;
      }
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const limiteKmh = Number(cfg.alert_excesso_velocidade_kmh) || 100;
      const janela = Math.max(2, Math.min(30, Number(cfg.alert_excesso_velocidade_janela) || 5));
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('limite', limiteKmh)
        .input('janela', janela)
        .query(`
          SELECT MAX(sub.vel_kmh)::float as "velocidadeMax", AVG(sub.vel_kmh)::float as "velocidadeMedia"
          FROM (
            SELECT ${cols.vel} AS vel_kmh
            FROM ${fromSql}
            WHERE ${cols.idv} = @idviagem
              AND (${dtExpr}) >= (CURRENT_TIMESTAMP - INTERVAL '30 minutes')
              AND ${cols.vel} IS NOT NULL AND ${cols.vel} > 0
            ORDER BY (${dtExpr}) DESC
            LIMIT @janela
          ) sub
          WHERE sub.vel_kmh > @limite
        `);
      if (!result.recordset.length) return null;
      const data = result.recordset[0];
      const velMax = Number(data.velocidadeMax ?? data.velocidadeMax);
      if (isNaN(velMax) || velMax < limiteKmh) return null;
      if (velMax < limiteKmh) return null;

      const existeAlerta = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('type', sql.NVarChar(20), 'EXCESSO_VELOCIDADE')
        .query(`
          SELECT [ID] FROM [dbo].[ALERTS]
          WHERE [IDVIAGEM] = @idviagem AND [TYPE] = @type
            AND COALESCE([RESOLVED], false) = false
            AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
          LIMIT 1
        `);
      if (existeAlerta.recordset.length > 0) return null;

      return {
        idviagem: idViagem,
        type: 'excesso_velocidade',
        message: `Excesso de velocidade detectado: até ${Math.round(velMax)} km/h (limite ${limiteKmh} km/h)`,
        severity: velMax > limiteKmh * 1.2 ? 'high' : 'medium',
        details: JSON.stringify({
          velocidadeMaxKmh: Math.round(velMax),
          velocidadeMediaKmh: data.velocidadeMedia ? Math.round(data.velocidadeMedia) : null,
          limiteKmh
        })
      };
    } catch (err) {
      if (err.code === '42P01') return null;
      if (isPgMissingVelocidadeColumn(err)) {
        warnMissingVelocidadeColumnOnce();
        return null;
      }
      console.error('Erro ao verificar excesso de velocidade:', err);
      return null;
    }
  },

  /**
   * Verificar deslocamento após macro de parada sem macro de reinício
   * Regra: última macro de parada (FGSITUACAO='P') + não existe reinício após ela + deslocamento >= limite (m)
   */
  verificarParadaSemReinicio: async (idViagem, pool, config = null, tableRastreamento = null) => {
    try {
      const rctx = await rastreamentoCtx(pool, tableRastreamento);
      const { fromSql, cols } = rctx;
      const dtExpr = exprDhPosicaoGps(cols) || cols.dh;
      if (!cols.idv || !cols.lat || !cols.lon || !dtExpr) return null;
      const cfg = config || ALERT_CONFIG_DEFAULTS;
      const limiteMetrosCfg = Number(cfg.alert_parada_sem_reinicio_metros);
      const limiteMetros = Number.isFinite(limiteMetrosCfg) && limiteMetrosCfg > 0 ? limiteMetrosCfg : 300;
      const tidParadaSr = await tenantIdForViagemDb(pool, idViagem);

      const macroParadaRes = await pool.query(
        `SELECT
           vo."CDTIPOOCORRENCIA",
           vo."DTOCORRENCIA",
           vo."DTCADASTRO",
           vo."DHMAINTENANCE",
           to2."FGSITUACAO",
           to2."DSTIPOOCORRENCIA",
           to2."FG_CONTROLE_TEMPO"
         FROM public."VIAGEMOCORRENCIA" vo
         INNER JOIN public."TIPOOCORRENCIA" to2 ON to2."CDTIPOOCORRENCIA" = vo."CDTIPOOCORRENCIA"
           AND (to2."TENANT_ID" = $2 OR to2."TENANT_ID" = 'default')
         WHERE vo."IDVIAGEM" = $1
           AND (TRIM(UPPER(COALESCE(to2."FGSITUACAO", ''))) = 'P'
                OR UPPER(COALESCE(to2."DSTIPOOCORRENCIA", '')) LIKE '%PARADA%'
                OR UPPER(COALESCE(to2."DSTIPOOCORRENCIA", '')) LIKE '%RETIDO%')
           AND TRIM(UPPER(COALESCE(to2."FG_CONTROLE_TEMPO", 'N'))) = 'S'
         ORDER BY COALESCE(vo."DTOCORRENCIA", vo."DTCADASTRO", vo."DHMAINTENANCE") DESC
         LIMIT 1`,
        [idViagem, tidParadaSr]
      );
      const macroParada = macroParadaRes.rows && macroParadaRes.rows[0];
      if (!macroParada) return null;

      const dtParada = macroParada.DTOCORRENCIA ?? macroParada.dtocorrencia ?? macroParada.DTCADASTRO ?? macroParada.dtcadastro ?? macroParada.DHMAINTENANCE ?? macroParada.dhmaintenance;
      const dtParadaObj = dtParada ? new Date(dtParada) : null;
      if (!dtParadaObj || Number.isNaN(dtParadaObj.getTime())) return null;

      const macroReinicioRes = await pool.query(
        `SELECT 1
         FROM public."VIAGEMOCORRENCIA" vo
         INNER JOIN public."TIPOOCORRENCIA" to2 ON to2."CDTIPOOCORRENCIA" = vo."CDTIPOOCORRENCIA"
           AND (to2."TENANT_ID" = $3 OR to2."TENANT_ID" = 'default')
         WHERE vo."IDVIAGEM" = $1
           AND COALESCE(vo."DTOCORRENCIA", vo."DTCADASTRO", vo."DHMAINTENANCE") > $2
           AND (
             TRIM(UPPER(COALESCE(to2."FGSITUACAO", ''))) = 'T'
             AND COALESCE(to2."SEQ", 0) >= 2
             OR UPPER(COALESCE(to2."DSTIPOOCORRENCIA", '')) LIKE '%REIN%CIO%'
           )
         LIMIT 1`,
        [idViagem, dtParadaObj.toISOString(), tidParadaSr]
      );
      if (macroReinicioRes.rows && macroReinicioRes.rows.length > 0) return null;

      const gpsRefRes = await pool.query(
        `SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE", (${dtExpr}) AS "DHREGISTRO"
         FROM ${fromSql}
         WHERE ${cols.idv} = $1
           AND ${cols.lat} IS NOT NULL
           AND ${cols.lon} IS NOT NULL
           AND (${dtExpr}) >= $2
         ORDER BY (${dtExpr}) ASC
         LIMIT 1`,
        [idViagem, dtParadaObj.toISOString()]
      );
      const gpsUltimoRes = await pool.query(
        `SELECT ${cols.lat} AS "LATITUDE", ${cols.lon} AS "LONGITUDE", (${dtExpr}) AS "DHREGISTRO"
         FROM ${fromSql}
         WHERE ${cols.idv} = $1
           AND ${cols.lat} IS NOT NULL
           AND ${cols.lon} IS NOT NULL
         ORDER BY (${dtExpr}) DESC
         LIMIT 1`,
        [idViagem]
      );
      const gpsRef = gpsRefRes.rows && gpsRefRes.rows[0];
      const gpsUlt = gpsUltimoRes.rows && gpsUltimoRes.rows[0];
      if (!gpsRef || !gpsUlt) return null;

      const distancia = alertService.calcularDistanciaHaversine(
        Number(gpsRef.LATITUDE ?? gpsRef.latitude),
        Number(gpsRef.LONGITUDE ?? gpsRef.longitude),
        Number(gpsUlt.LATITUDE ?? gpsUlt.latitude),
        Number(gpsUlt.LONGITUDE ?? gpsUlt.longitude)
      );
      console.log(
        `   🔎 [Alertas] parada_sem_reinicio viagem ${idViagem}: deslocamento=${Math.round(distancia)}m (limite=${Math.round(limiteMetros)}m)`
      );
      if (!Number.isFinite(distancia) || distancia < limiteMetros) return null;

      const existeAlerta = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('type', sql.NVarChar(30), 'PARADA_SEM_REINICIO')
        .query(`
          SELECT [ID] FROM [dbo].[ALERTS]
          WHERE [IDVIAGEM] = @idviagem AND [TYPE] = @type
            AND COALESCE([RESOLVED], false) = false
            AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
          LIMIT 1
        `);
      if (existeAlerta.recordset.length > 0) return null;

      return {
        idviagem: idViagem,
        type: 'parada_sem_reinicio',
        message: `Movimento indevido: veículo se deslocou após macro de parada com controle de tempo sem registrar 'Viagem - Reinício'.`,
        severity: distancia > (limiteMetros * 2) ? 'high' : 'medium',
        details: JSON.stringify({
          deslocamentoMetros: Math.round(distancia),
          limiteMetros: Math.round(limiteMetros),
          macroParada: macroParada.DSTIPOOCORRENCIA ?? macroParada.dstipoocorrencia ?? null,
          dtParada: dtParadaObj.toISOString(),
          gpsReferenciaDh: gpsRef.DHREGISTRO ?? gpsRef.dhregistro,
          gpsUltimoDh: gpsUlt.DHREGISTRO ?? gpsUlt.dhregistro
        })
      };
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') return null;
      console.error('Erro ao verificar parada sem reinício:', err);
      return null;
    }
  },

  /**
   * Calcular distância de um ponto até uma linha (segmento)
   * Usa fórmula de distância ponto-reta
   */
  distanciaParaLinha: (latP, lonP, lat1, lon1, lat2, lon2) => {
    // Converter para radianos
    const R = 6371000; // Raio da Terra em metros
    
    const dLat1 = (lat1 - latP) * Math.PI / 180;
    const dLon1 = (lon1 - lonP) * Math.PI / 180;
    const dLat2 = (lat2 - latP) * Math.PI / 180;
    const dLon2 = (lon2 - lonP) * Math.PI / 180;
    
    // Distância do ponto até origem e destino
    const dist1 = R * Math.sqrt(dLat1 * dLat1 + dLon1 * dLon1 * Math.cos(latP * Math.PI / 180) * Math.cos(latP * Math.PI / 180));
    const dist2 = R * Math.sqrt(dLat2 * dLat2 + dLon2 * dLon2 * Math.cos(latP * Math.PI / 180) * Math.cos(latP * Math.PI / 180));
    
    // Distância entre origem e destino
    const dLatSeg = (lat2 - lat1) * Math.PI / 180;
    const dLonSeg = (lon2 - lon1) * Math.PI / 180;
    const distSeg = R * Math.sqrt(dLatSeg * dLatSeg + dLonSeg * dLonSeg * Math.cos(lat1 * Math.PI / 180) * Math.cos(lat1 * Math.PI / 180));
    
    // Se o segmento é muito curto, usar distância até o ponto mais próximo
    if (distSeg < 100) {
      return Math.min(dist1, dist2);
    }
    
    // Calcular distância perpendicular usando fórmula simplificada
    // Para precisão maior, seria necessário cálculo mais complexo
    // Por enquanto, usar distância até o ponto mais próximo do segmento
    return Math.min(dist1, dist2);
  },

  /**
   * Salvar alerta no banco
   */
  salvarAlerta: async (alerta, pool) => {
    try {
      const tid =
        alerta.tenantId != null && String(alerta.tenantId).trim() !== ''
          ? String(alerta.tenantId).trim()
          : await tenantIdForViagemDb(pool, alerta.idviagem);

      const config = await alertService.getAlertConfig(pool, false, tid);
      const cooldownCfg = Number(config.alert_cooldown_minutos);
      const cooldownMinutos = Number.isFinite(cooldownCfg) && cooldownCfg >= 0 ? cooldownCfg : 30;
      const typeNorm = String(alerta.type || '').trim().toUpperCase();

      // Verificar se já existe alerta ativo do mesmo tipo
      const existeResult = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), alerta.idviagem)
        .input('type', sql.NVarChar(50), typeNorm)
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          SELECT [ID]
          FROM [dbo].[ALERTS]
          WHERE [IDVIAGEM] = @idviagem
            AND [TYPE] = @type
            AND [TENANT_ID] = @tenantId
            AND ([RESOLVED] = false OR [RESOLVED] IS NULL)
            AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
          LIMIT 1
        `);

      if (existeResult.recordset.length > 0) {
        console.log(`ℹ️  Alerta ${alerta.type} já existe ativo para viagem ${alerta.idviagem}, não duplicando`);
        return false; // Já existe, não duplicar
      }

      if (cooldownMinutos > 0) {
        const cooldownResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), alerta.idviagem)
          .input('type', sql.NVarChar(50), typeNorm)
          .input('cooldown', sql.Int, Math.floor(cooldownMinutos))
          .input('tenantId', sql.NVarChar(64), tid)
          .query(`
            SELECT [ID], [STATUS], [RESOLVED_AT], [CREATED_AT]
            FROM [dbo].[ALERTS]
            WHERE [IDVIAGEM] = @idviagem
              AND [TYPE] = @type
              AND [TENANT_ID] = @tenantId
              AND COALESCE([RESOLVED], false) = true
              AND COALESCE([RESOLVED_AT], [CREATED_AT]) >= (CURRENT_TIMESTAMP - (@cooldown * INTERVAL '1 minute'))
            ORDER BY COALESCE([RESOLVED_AT], [CREATED_AT]) DESC
            LIMIT 1
          `);
        if ((cooldownResult.recordset || []).length > 0) {
          console.log(`ℹ️  Alerta ${typeNorm} em cooldown (${cooldownMinutos} min) para viagem ${alerta.idviagem}, não gerando agora`);
          return false;
        }
      }

      // Determinar prioridade baseado na severity
      let prioridade = 'Normal';
      if (alerta.severity === 'high') {
        prioridade = 'Urgente';
      } else if (alerta.severity === 'medium') {
        prioridade = 'Alta';
      }

      await pool.request()
        .input('idviagem', sql.Decimal(15, 0), alerta.idviagem)
        .input('cdmotorista', sql.Decimal(15, 0), alerta.cdmotorista || null)
        .input('type', sql.NVarChar(50), typeNorm)
        .input('message', sql.NVarChar(255), alerta.message)
        .input('severity', sql.NVarChar(10), alerta.severity)
        .input('prioridade', sql.NVarChar(20), prioridade)
        .input('details', sql.NVarChar(sql.MAX), alerta.details || null)
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          INSERT INTO [dbo].[ALERTS] (
            [IDVIAGEM], [CDMOTORISTA], [TYPE], [MESSAGE], [SEVERITY], [PRIORIDADE], [DETAILS], [STATUS], [TENANT_ID]
          )
          VALUES (
            @idviagem, @cdmotorista, @type, @message, @severity, @prioridade, @details, 'Pendente', @tenantId
          )
        `);

      return true;
    } catch (err) {
      console.error('❌ Erro ao salvar alerta:', err.message);
      console.error('   Detalhes:', {
        idviagem: alerta.idviagem,
        type: alerta.type,
        message: alerta.message
      });
      return false;
    }
  },

  /**
   * Buscar alertas ativos de uma viagem
   */
  buscarAlertasAtivos: async (idViagem) => {
    try {
      const pool = await poolPromise;
      const tid = await tenantIdForViagemDb(pool, idViagem);
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idViagem)
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          SELECT 
            [ID],
            [IDVIAGEM],
            [TYPE],
            [MESSAGE],
            [SEVERITY],
            [DETAILS],
            [CREATED_AT],
            [RESOLVED]
          FROM [dbo].[ALERTS]
          WHERE [IDVIAGEM] = @idviagem
            AND [TENANT_ID] = @tenantId
            AND COALESCE([RESOLVED], false) = false
            AND ([STATUS] IS NULL OR [STATUS] = 'Pendente' OR [STATUS] = 'Em Análise')
          ORDER BY 
            CASE [SEVERITY]
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
            END,
            [CREATED_AT] DESC
        `);

      return result.recordset;
    } catch (err) {
      console.error('Erro ao buscar alertas:', err);
      return [];
    }
  },

  /**
   * Buscar alerta por ID
   */
  buscarAlertaPorId: async (idAlerta, tenantId) => {
    try {
      const pool = await poolPromise;
      const tid =
        tenantId != null && String(tenantId).trim() !== ''
          ? String(tenantId).trim()
          : getDefaultTenantId();
      const result = await pool.request()
        .input('id', sql.Int, idAlerta)
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          SELECT [ID],
            [IDVIAGEM],
            [CDMOTORISTA],
            [TYPE],
            [MESSAGE],
            [SEVERITY],
            [DETAILS],
            [CREATED_AT],
            [RESOLVED],
            [RESOLVED_AT],
            [RESOLVED_BY]
          FROM [dbo].[ALERTS]
          WHERE [ID] = @id AND [TENANT_ID] = @tenantId
        `);

      return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (err) {
      console.error('Erro ao buscar alerta:', err);
      return null;
    }
  },

  /**
   * Marcar alerta como resolvido
   */
  resolverAlerta: async (idAlerta, idUsuario, tenantId) => {
    try {
      const pool = await poolPromise;
      const tid =
        tenantId != null && String(tenantId).trim() !== ''
          ? String(tenantId).trim()
          : getDefaultTenantId();
      const out = await pool.request()
        .input('id', sql.Int, idAlerta)
        .input('idusuario', sql.Int, idUsuario || null)
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          UPDATE [dbo].[ALERTS]
          SET 
            [RESOLVED] = true,
            [RESOLVED_AT] = CURRENT_TIMESTAMP,
            [RESOLVED_BY] = @idusuario
          WHERE [ID] = @id AND [TENANT_ID] = @tenantId
        `);

      return (out.rowsAffected && out.rowsAffected[0] > 0) || false;
    } catch (err) {
      console.error('Erro ao resolver alerta:', err);
      return false;
    }
  }
};

alertService.tenantIdForViagemDb = tenantIdForViagemDb;
module.exports = alertService;
