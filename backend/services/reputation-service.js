// backend/services/reputation-service.js
// Service para calcular reputação de motoristas
// Versão: 1.1 — escopo multi-tenant (TENANT_ID em viagens/convocação/cadastro)

const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

function normalizeTenantId(tenantId) {
  if (tenantId != null && String(tenantId).trim() !== '') return String(tenantId).trim();
  return getDefaultTenantId();
}

async function assertMotoristaNoTenant(pool, cdmotorista, tenantId) {
  const cdm = typeof cdmotorista === 'number' ? cdmotorista : parseFloat(cdmotorista);
  if (!Number.isFinite(cdm)) {
    const err = new Error('Código de motorista inválido');
    err.code = 'INVALID_CDM';
    throw err;
  }
  const r = await pool.query(
    `SELECT 1 FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
    [cdm, tenantId]
  );
  if (!r.rows || r.rows.length === 0) {
    const err = new Error('Motorista não encontrado neste tenant');
    err.code = 'NOT_IN_TENANT';
    throw err;
  }
}

async function listarTenantsComViagensFinalizadas(pool) {
  const def = getDefaultTenantId();
  const r = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(vm."TENANT_ID"::text), ''), $1::text) AS tid
     FROM "CONVOCACAO" c
     INNER JOIN "VIAGEMMESTRE" vm ON c."IDVIAGEM" = vm."IDVIAGEM" AND c."TENANT_ID" = vm."TENANT_ID"
     WHERE vm."DTPREVFINAL" IS NOT NULL
       AND c."CDCADASTRO_MOTORISTA" IS NOT NULL`,
    [def]
  );
  return r.rows || [];
}

async function listarMotoristasParaReputacao(pool, tenantId) {
  const def = getDefaultTenantId();
  const tid = normalizeTenantId(tenantId);
  const r = await pool.query(
    `SELECT DISTINCT c."CDCADASTRO_MOTORISTA"
     FROM "CONVOCACAO" c
     INNER JOIN "VIAGEMMESTRE" vm ON c."IDVIAGEM" = vm."IDVIAGEM" AND c."TENANT_ID" = vm."TENANT_ID"
     WHERE vm."DTPREVFINAL" IS NOT NULL
       AND c."CDCADASTRO_MOTORISTA" IS NOT NULL
       AND COALESCE(NULLIF(TRIM(c."TENANT_ID"::text), ''), $1::text) = $2
       AND COALESCE(NULLIF(TRIM(vm."TENANT_ID"::text), ''), $1::text) = $2`,
    [def, tid]
  );
  return r.rows || [];
}

const reputationService = {
  /**
   * Calcular e atualizar reputação de um motorista (apenas viagens do tenant).
   * @param {number|string} cdmotorista
   * @param {string} [tenantId] — default DEFAULT_TENANT_ID
   */
  calcularReputacao: async (cdmotorista, tenantId) => {
    const tid = normalizeTenantId(tenantId);
    try {
      const pool = await poolPromise;
      await assertMotoristaNoTenant(pool, cdmotorista, tid);

      const cdm = typeof cdmotorista === 'number' ? cdmotorista : parseFloat(cdmotorista);

      const def = getDefaultTenantId();
      const viagensResult = await pool.query(
        `SELECT 
          vm."IDVIAGEM",
          vm."DTPREVINICIO",
          vm."DTPREVFINAL",
          vm."CDSITUACAOVIAGEM",
          COALESCE(sv."DSSITUACAOVIAGEM", 'Não informado') AS "DSSITUACAOVIAGEM",
          c."CDCADASTRO_MOTORISTA",
          vm."DTPREVFINAL" AS "DTDESCARGA"
        FROM "VIAGEMMESTRE" vm
        INNER JOIN "CONVOCACAO" c ON vm."IDVIAGEM" = c."IDVIAGEM" AND vm."TENANT_ID" = c."TENANT_ID"
        LEFT JOIN "SITUACAOVIAGEM" sv ON vm."CDSITUACAOVIAGEM" = sv."CDSITUACAOVIAGEM"
          AND (sv."TENANT_ID" = vm."TENANT_ID" OR sv."TENANT_ID" = 'default')
        WHERE c."CDCADASTRO_MOTORISTA" = $1
          AND vm."DTPREVFINAL" IS NOT NULL
          AND COALESCE(NULLIF(TRIM(c."TENANT_ID"::text), ''), $3::text) = $2
          AND COALESCE(NULLIF(TRIM(vm."TENANT_ID"::text), ''), $3::text) = $2
        ORDER BY vm."DTPREVFINAL" DESC`,
        [cdm, tid, def]
      );

      const viagens = viagensResult.rows || [];

      if (viagens.length === 0) {
        await criarRegistroReputacao(cdm, tid, 0, 0, 0, 0, 0, null, null);
        return { score: 0, total: 0, onTime: 0, late: 0, canceled: 0 };
      }

      let totalDeliveries = 0;
      let onTimeDeliveries = 0;
      let lateDeliveries = 0;
      let canceledDeliveries = 0;
      let totalDelayMinutes = 0;
      let lastDeliveryDate = null;

      for (const viagem of viagens) {
        totalDeliveries++;

        const situacaoCancelada = ['CANCELADA', 'CANCELADO', 'REJEITADA'].includes(
          (viagem.DSSITUACAOVIAGEM || '').toUpperCase()
        );

        if (situacaoCancelada) {
          canceledDeliveries++;
          continue;
        }

        if (viagem.DTPREVFINAL) {
          const dataEntrega = viagem.DTPREVFINAL;
          if (!lastDeliveryDate || new Date(dataEntrega) > new Date(lastDeliveryDate)) {
            lastDeliveryDate = dataEntrega;
          }
          onTimeDeliveries++;
        } else {
          onTimeDeliveries++;
        }
      }

      let score = 0;
      if (totalDeliveries > 0) {
        const denom = totalDeliveries - canceledDeliveries;
        const taxaPontualidade = denom > 0 ? (onTimeDeliveries / denom) * 100 : 0;
        const penalidadeCancelamentos = Math.min(canceledDeliveries * 10, 50);
        score = Math.max(0, Math.min(100, taxaPontualidade - penalidadeCancelamentos));
      }

      const averageDelayMinutes = lateDeliveries > 0 ? totalDelayMinutes / lateDeliveries : 0;

      await atualizarReputacao(
        cdm,
        tid,
        score,
        totalDeliveries,
        onTimeDeliveries,
        lateDeliveries,
        canceledDeliveries,
        averageDelayMinutes,
        lastDeliveryDate
      );

      return {
        score: Math.round(score * 100) / 100,
        total: totalDeliveries,
        onTime: onTimeDeliveries,
        late: lateDeliveries,
        canceled: canceledDeliveries,
        averageDelay: Math.round(averageDelayMinutes * 100) / 100
      };
    } catch (error) {
      console.error(`Erro ao calcular reputação do motorista ${cdmotorista}:`, error);
      throw error;
    }
  },

  /**
   * Recalcular reputação de motoristas.
   * @param {string} [tenantId] — se omitido, percorre todos os tenants com viagens finalizadas (job agendado).
   */
  recalcularTodasReputacoes: async (tenantIdArg) => {
    try {
      const pool = await poolPromise;

      const checkTableResult = await pool.query(`
        SELECT COUNT(*) AS "TableCount"
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'DRIVER_REPUTATION'
      `);
      const tableExists =
        checkTableResult.rows[0] &&
        parseInt(checkTableResult.rows[0].TableCount ?? checkTableResult.rows[0].tablecount, 10) > 0;

      if (!tableExists) {
        throw new Error('Tabela DRIVER_REPUTATION não existe. Execute o script: criar_tabela_driver_reputation.sql');
      }

      const tenantRows =
        tenantIdArg != null && String(tenantIdArg).trim() !== ''
          ? [{ tid: String(tenantIdArg).trim() }]
          : await listarTenantsComViagensFinalizadas(pool);

      if (tenantRows.length === 0) {
        return {
          total: 0,
          sucesso: 0,
          erro: 0,
          message: 'Nenhum tenant com viagens finalizadas encontrado'
        };
      }

      let sucesso = 0;
      let erro = 0;
      let totalMotoristas = 0;
      const errosDetalhes = [];

      for (const row of tenantRows) {
        const tid = String(row.tid ?? row.TID ?? '').trim() || getDefaultTenantId();
        const motoristas = await listarMotoristasParaReputacao(pool, tid);
        console.log(`📊 [Reputação] tenant=${tid} — ${motoristas.length} motorista(s) na fila`);

        if (motoristas.length === 0) continue;

        for (const motorista of motoristas) {
          totalMotoristas++;
          const cdm = motorista.CDCADASTRO_MOTORISTA ?? motorista.cdcadastro_motorista;
          try {
            await reputationService.calcularReputacao(cdm, tid);
            sucesso++;
          } catch (err) {
            console.error(`Erro ao recalcular motorista ${cdm} (tenant ${tid}):`, err.message);
            erro++;
            errosDetalhes.push({ motorista: cdm, tenant: tid, erro: err.message });
          }
        }
      }

      if (totalMotoristas === 0) {
        return {
          total: 0,
          sucesso: 0,
          erro: 0,
          message: 'Nenhum motorista com viagens finalizadas encontrado'
        };
      }

      console.log(`✅ Reputação recalculada: ${sucesso} sucesso(s), ${erro} erro(s) (${totalMotoristas} motorista(s))`);

      return {
        total: totalMotoristas,
        sucesso,
        erro,
        errosDetalhes: errosDetalhes.length > 0 ? errosDetalhes : undefined
      };
    } catch (error) {
      console.error('Erro ao recalcular todas as reputações:', error);
      throw new Error(error.message || 'Erro desconhecido ao recalcular reputações');
    }
  }
};

/**
 * Criar registro inicial de reputação - PostgreSQL
 */
async function criarRegistroReputacao(cdmotorista, tenantId, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  await pool.query(
    `INSERT INTO "DRIVER_REPUTATION" (
       "CDMOTORISTA", "TENANT_ID", "SCORE", "TOTAL_DELIVERIES", "ON_TIME_DELIVERIES",
       "LATE_DELIVERIES", "CANCELED_DELIVERIES", "AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE", "LAST_UPDATED"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT ("TENANT_ID", "CDMOTORISTA") DO NOTHING`,
    [
      cdmotorista,
      tenantId,
      score,
      total,
      onTime,
      late,
      canceled,
      avgDelay || 0,
      lastDelivery || null
    ]
  );
}

/**
 * Atualizar registro de reputação - PostgreSQL (UPSERT)
 */
async function atualizarReputacao(cdmotorista, tenantId, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  await pool.query(
    `INSERT INTO "DRIVER_REPUTATION" (
       "CDMOTORISTA", "TENANT_ID", "SCORE", "TOTAL_DELIVERIES", "ON_TIME_DELIVERIES",
       "LATE_DELIVERIES", "CANCELED_DELIVERIES", "AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE", "LAST_UPDATED"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT ("TENANT_ID", "CDMOTORISTA") DO UPDATE SET
       "TENANT_ID" = EXCLUDED."TENANT_ID",
       "SCORE" = EXCLUDED."SCORE",
       "TOTAL_DELIVERIES" = EXCLUDED."TOTAL_DELIVERIES",
       "ON_TIME_DELIVERIES" = EXCLUDED."ON_TIME_DELIVERIES",
       "LATE_DELIVERIES" = EXCLUDED."LATE_DELIVERIES",
       "CANCELED_DELIVERIES" = EXCLUDED."CANCELED_DELIVERIES",
       "AVERAGE_DELAY_MINUTES" = EXCLUDED."AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE" = EXCLUDED."LAST_DELIVERY_DATE",
       "LAST_UPDATED" = CURRENT_TIMESTAMP`,
    [
      cdmotorista,
      tenantId,
      score,
      total,
      onTime,
      late,
      canceled,
      avgDelay || 0,
      lastDelivery || null
    ]
  );
}

/**
 * Helper: Emitir eventos WebSocket após recalcular reputações
 * @param {object} app - App Express (opcional)
 * @param {object} resultados - Resultados do recálculo
 */
async function emitirEventosReputacao(app, resultados) {
  try {
    if (!app) return;

    const websocketTorre = app.get('websocketTorre');
    if (!websocketTorre) return;

    if (resultados && resultados.length > 0) {
      resultados.forEach((resultado) => {
        if (resultado.cdmotorista) {
          websocketTorre.emitirAtualizacaoReputacao(resultado.cdmotorista, {
            score: resultado.score,
            total: resultado.total,
            onTime: resultado.onTime,
            late: resultado.late,
            canceled: resultado.canceled
          });
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ Erro ao emitir eventos WebSocket de reputação:', err.message);
  }
}

module.exports = {
  ...reputationService,
  emitirEventosReputacao
};
