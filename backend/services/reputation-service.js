// backend/services/reputation-service.js
// Service para calcular reputação de motoristas
// Versão: 1.0
// Data: 2025-01-16

const sql = require('mssql');
const { poolPromise } = require('../config/db');

const reputationService = {
  /**
   * Calcular e atualizar reputação de um motorista
   * @param {number} cdmotorista - ID do motorista
   */
  calcularReputacao: async (cdmotorista) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();
      request.input('cdmotorista', sql.Decimal(15, 0), cdmotorista);

      // Buscar todas as viagens concluídas do motorista
      // NOTA: DTPREVFINAL é a data prevista de finalização/descarga
      // Considerar viagens com DTPREVFINAL preenchido como concluídas
      const viagensQuery = await request.query(`
        SELECT 
          vm.IDVIAGEM,
          vm.DTPREVINICIO,
          vm.DTPREVFINAL,
          vm.CDSITUACAOVIAGEM,
          ISNULL(sv.DSSITUACAOVIAGEM, 'Não informado') AS DSSITUACAOVIAGEM,
          c.CDCADASTRO_MOTORISTA,
          vm.DTPREVFINAL AS DTDESCARGA -- Alias para compatibilidade com código abaixo
        FROM VIAGEMMESTRE vm
        INNER JOIN CONVOCACAO c ON vm.IDVIAGEM = c.IDVIAGEM
        LEFT JOIN SITUACAOVIAGEM sv ON vm.CDSITUACAOVIAGEM = sv.CDSITUACAOVIAGEM
        WHERE c.CDCADASTRO_MOTORISTA = @cdmotorista
          AND vm.DTPREVFINAL IS NOT NULL -- Com data de descarga (entregue)
        ORDER BY vm.DTPREVFINAL DESC
      `);

      const viagens = viagensQuery.recordset;
      
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
      const request = pool.request();

      // Verificar se a tabela existe
      const checkTableResult = await request.query(`
        SELECT COUNT(*) AS TableCount
        FROM sys.objects
        WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]') 
          AND type in (N'U')
      `);
      
      const tableExists = checkTableResult.recordset[0] && checkTableResult.recordset[0].TableCount > 0;

      if (!tableExists) {
        throw new Error('Tabela DRIVER_REPUTATION não existe. Execute o script: criar_tabela_driver_reputation.sql');
      }

      // Buscar todos os motoristas que têm viagens finalizadas
      // NOTA: DTPREVFINAL é a data prevista de finalização/descarga
      // Usar apenas DTPREVFINAL para identificar viagens concluídas
      const motoristasQuery = await request.query(`
        SELECT DISTINCT c.CDCADASTRO_MOTORISTA
        FROM CONVOCACAO c
        INNER JOIN VIAGEMMESTRE vm ON c.IDVIAGEM = vm.IDVIAGEM
        WHERE vm.DTPREVFINAL IS NOT NULL
          AND c.CDCADASTRO_MOTORISTA IS NOT NULL
      `);

      const motoristas = motoristasQuery.recordset;
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
          await reputationService.calcularReputacao(motorista.CDCADASTRO_MOTORISTA);
          sucesso++;
        } catch (err) {
          console.error(`Erro ao recalcular motorista ${motorista.CDCADASTRO_MOTORISTA}:`, err.message);
          erro++;
          errosDetalhes.push({
            motorista: motorista.CDCADASTRO_MOTORISTA,
            erro: err.message
          });
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
 * Criar registro inicial de reputação
 */
async function criarRegistroReputacao(cdmotorista, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  const request = pool.request();
  
  request.input('cdmotorista', sql.Decimal(15, 0), cdmotorista);
  request.input('score', sql.Float, score);
  request.input('total', sql.Int, total);
  request.input('onTime', sql.Int, onTime);
  request.input('late', sql.Int, late);
  request.input('canceled', sql.Int, canceled);
  request.input('avgDelay', sql.Float, avgDelay || 0);
  request.input('lastDelivery', sql.DateTime2, lastDelivery || null);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM DRIVER_REPUTATION WHERE CDMOTORISTA = @cdmotorista)
    BEGIN
      INSERT INTO DRIVER_REPUTATION (
        CDMOTORISTA, SCORE, TOTAL_DELIVERIES, ON_TIME_DELIVERIES,
        LATE_DELIVERIES, CANCELED_DELIVERIES, AVERAGE_DELAY_MINUTES,
        LAST_DELIVERY_DATE, LAST_UPDATED
      )
      VALUES (
        @cdmotorista, @score, @total, @onTime, @late, @canceled,
        @avgDelay, @lastDelivery, SYSUTCDATETIME()
      )
    END
  `);
}

/**
 * Atualizar registro de reputação
 */
async function atualizarReputacao(cdmotorista, score, total, onTime, late, canceled, avgDelay, lastDelivery) {
  const pool = await poolPromise;
  const request = pool.request();
  
  request.input('cdmotorista', sql.Decimal(15, 0), cdmotorista);
  request.input('score', sql.Float, score);
  request.input('total', sql.Int, total);
  request.input('onTime', sql.Int, onTime);
  request.input('late', sql.Int, late);
  request.input('canceled', sql.Int, canceled);
  request.input('avgDelay', sql.Float, avgDelay || 0);
  request.input('lastDelivery', sql.DateTime2, lastDelivery || null);

  await request.query(`
    MERGE DRIVER_REPUTATION AS target
    USING (SELECT @cdmotorista AS CDMOTORISTA) AS source
    ON target.CDMOTORISTA = source.CDMOTORISTA
    WHEN MATCHED THEN
      UPDATE SET
        SCORE = @score,
        TOTAL_DELIVERIES = @total,
        ON_TIME_DELIVERIES = @onTime,
        LATE_DELIVERIES = @late,
        CANCELED_DELIVERIES = @canceled,
        AVERAGE_DELAY_MINUTES = @avgDelay,
        LAST_DELIVERY_DATE = @lastDelivery,
        LAST_UPDATED = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (
        CDMOTORISTA, SCORE, TOTAL_DELIVERIES, ON_TIME_DELIVERIES,
        LATE_DELIVERIES, CANCELED_DELIVERIES, AVERAGE_DELAY_MINUTES,
        LAST_DELIVERY_DATE, LAST_UPDATED
      )
      VALUES (
        @cdmotorista, @score, @total, @onTime, @late, @canceled,
        @avgDelay, @lastDelivery, SYSUTCDATETIME()
      );
  `);
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
