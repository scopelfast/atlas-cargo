// backend/services/reputation-service.js
// Service para calcular reputação de motoristas
// Versão: 1.0
// Data: 2026-01-16

const { poolPromise } = require('../config/db');

const reputationService = {
  /**
   * Calcular e atualizar reputação de um motorista
   * @param {number} cdmotorista - ID do motorista
   */
  calcularReputacao: async (cdmotorista) => {
    try {
      const pool = await poolPromise;

      // Buscar todas as viagens concluídas do motorista - PostgreSQL
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
        INNER JOIN "CONVOCACAO" c ON vm."IDVIAGEM" = c."IDVIAGEM"
        LEFT JOIN "SITUACAOVIAGEM" sv ON vm."CDSITUACAOVIAGEM" = sv."CDSITUACAOVIAGEM"
        WHERE c."CDCADASTRO_MOTORISTA" = $1
          AND vm."DTPREVFINAL" IS NOT NULL
        ORDER BY vm."DTPREVFINAL" DESC`,
        [cdmotorista]
      );

      const viagens = viagensResult.rows || [];
      
      if (viagens.length === 0) {
        // Se não há viagens, manter score 0 ou criar registro inicial
        await criarRegistroReputacao(cdmotorista, 0, 0, 0, 0, 0, null, null);
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

        // Verificar se foi cancelada (pode ser baseado na situação)
        // Assumindo que situações específicas indicam cancelamento
        const situacaoCancelada = ['CANCELADA', 'CANCELADO', 'REJEITADA'].includes(
          (viagem.DSSITUACAOVIAGEM || '').toUpperCase()
        );

        if (situacaoCancelada) {
          canceledDeliveries++;
          continue;
        }

        // Calcular pontualidade
        // NOTA: Como só temos DTPREVFINAL (data prevista), consideramos todas como no prazo por enquanto
        // Futuramente, se houver DTDESCARGA real, podemos comparar
        if (viagem.DTPREVFINAL) {
          // Atualizar última entrega
          const dataEntrega = viagem.DTPREVFINAL;
          if (!lastDeliveryDate || new Date(dataEntrega) > new Date(lastDeliveryDate)) {
            lastDeliveryDate = dataEntrega;
          }
          
          // Por enquanto, considerar todas como no prazo (já que só temos data prevista)
          // Quando tivermos data real de descarga, poderemos comparar
          onTimeDeliveries++;
        } else {
          // Se não tem data, considerar como no prazo (evita penalizar)
          onTimeDeliveries++;
        }
      }

      // Calcular score (0 a 100)
      // Fórmula: (entregas no prazo / total entregas) * 100
      // Penalizar cancelamentos: -10 pontos por cancelamento (máx 5 cancelamentos = -50)
      let score = 0;
      if (totalDeliveries > 0) {
        const taxaPontualidade = (onTimeDeliveries / (totalDeliveries - canceledDeliveries)) * 100 || 0;
        const penalidadeCancelamentos = Math.min(canceledDeliveries * 10, 50); // Máximo -50 pontos
        score = Math.max(0, Math.min(100, taxaPontualidade - penalidadeCancelamentos));
      }

      // Calcular atraso médio
      const averageDelayMinutes = lateDeliveries > 0 
        ? totalDelayMinutes / lateDeliveries 
        : 0;

      // Atualizar ou criar registro de reputação
      await atualizarReputacao(
        cdmotorista,
        score,
        totalDeliveries,
        onTimeDeliveries,
        lateDeliveries,
        canceledDeliveries,
        averageDelayMinutes,
        lastDeliveryDate
      );

      return {
        score: Math.round(score * 100) / 100, // Arredondar para 2 casas decimais
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
   * Recalcular reputação de todos os motoristas
   */
  recalcularTodasReputacoes: async () => {
    try {
      const pool = await poolPromise;

      // Verificar se a tabela existe - PostgreSQL
      const checkTableResult = await pool.query(`
        SELECT COUNT(*) AS "TableCount"
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'DRIVER_REPUTATION'
      `);
      const tableExists = checkTableResult.rows[0] && parseInt(checkTableResult.rows[0].TableCount ?? checkTableResult.rows[0].TableCount, 10) > 0;

      if (!tableExists) {
        throw new Error('Tabela DRIVER_REPUTATION não existe. Execute o script: criar_tabela_driver_reputation.sql');
      }

      // Buscar todos os motoristas que têm viagens finalizadas - PostgreSQL
      const motoristasResult = await pool.query(`
        SELECT DISTINCT c."CDCADASTRO_MOTORISTA"
        FROM "CONVOCACAO" c
        INNER JOIN "VIAGEMMESTRE" vm ON c."IDVIAGEM" = vm."IDVIAGEM"
        WHERE vm."DTPREVFINAL" IS NOT NULL
          AND c."CDCADASTRO_MOTORISTA" IS NOT NULL
      `);

      const motoristas = motoristasResult.rows || [];
      console.log(`📊 Recalculando reputação de ${motoristas.length} motorista(s)...`);

      if (motoristas.length === 0) {
        return {
          total: 0,
          sucesso: 0,
          erro: 0,
          message: 'Nenhum motorista com viagens finalizadas encontrado'
        };
      }

      let sucesso = 0;
      let erro = 0;
      const errosDetalhes = [];

      for (const motorista of motoristas) {
        try {
          const cdm = motorista.CDCADASTRO_MOTORISTA ?? motorista.cdcadastro_motorista;
          await reputationService.calcularReputacao(cdm);
          sucesso++;
        } catch (err) {
          const cdm = motorista.CDCADASTRO_MOTORISTA ?? motorista.cdcadastro_motorista;
          console.error(`Erro ao recalcular motorista ${cdm}:`, err.message);
          erro++;
          errosDetalhes.push({ motorista: cdm, erro: err.message });
        }
      }

      console.log(`✅ Reputação recalculada: ${sucesso} sucesso(s), ${erro} erro(s)`);
      
      return {
        total: motoristas.length,
        sucesso,
        erro,
        errosDetalhes: errosDetalhes.length > 0 ? errosDetalhes : undefined
      };

    } catch (error) {
      console.error('Erro ao recalcular todas as reputações:', error);
      
      // Retornar erro mais descritivo
      const errorMessage = error.message || 'Erro desconhecido ao recalcular reputações';
      throw new Error(errorMessage);
    }
  }
};

/**
 * Criar registro inicial de reputação - PostgreSQL
 */
async function criarRegistroReputacao(cdmotorista, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  await pool.query(
    `INSERT INTO "DRIVER_REPUTATION" (
       "CDMOTORISTA", "SCORE", "TOTAL_DELIVERIES", "ON_TIME_DELIVERIES",
       "LATE_DELIVERIES", "CANCELED_DELIVERIES", "AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE", "LAST_UPDATED"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT ("CDMOTORISTA") DO NOTHING`,
    [cdmotorista, score, total, onTime, late, canceled, avgDelay || 0, lastDelivery || null]
  );
}

/**
 * Atualizar registro de reputação - PostgreSQL (UPSERT)
 */
async function atualizarReputacao(cdmotorista, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  await pool.query(
    `INSERT INTO "DRIVER_REPUTATION" (
       "CDMOTORISTA", "SCORE", "TOTAL_DELIVERIES", "ON_TIME_DELIVERIES",
       "LATE_DELIVERIES", "CANCELED_DELIVERIES", "AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE", "LAST_UPDATED"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT ("CDMOTORISTA") DO UPDATE SET
       "SCORE" = EXCLUDED."SCORE",
       "TOTAL_DELIVERIES" = EXCLUDED."TOTAL_DELIVERIES",
       "ON_TIME_DELIVERIES" = EXCLUDED."ON_TIME_DELIVERIES",
       "LATE_DELIVERIES" = EXCLUDED."LATE_DELIVERIES",
       "CANCELED_DELIVERIES" = EXCLUDED."CANCELED_DELIVERIES",
       "AVERAGE_DELAY_MINUTES" = EXCLUDED."AVERAGE_DELAY_MINUTES",
       "LAST_DELIVERY_DATE" = EXCLUDED."LAST_DELIVERY_DATE",
       "LAST_UPDATED" = CURRENT_TIMESTAMP`,
    [cdmotorista, score, total, onTime, late, canceled, avgDelay || 0, lastDelivery || null]
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

    // Emitir atualização para cada motorista recalculado
    if (resultados && resultados.length > 0) {
      resultados.forEach(resultado => {
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
