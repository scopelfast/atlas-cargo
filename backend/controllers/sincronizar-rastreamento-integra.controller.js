// ====================================
// SINCRONIZAÇÃO DE RASTREAMENTO DO INTEGRA_PRD
// ====================================
// Arquivo isolado para sincronização de dados de rastreamento
// do banco INTEGRA_PRD para DIVULGACARGA_PRD
// 
// IMPORTANTE: Este arquivo pode ser removido/desabilitado se não houver
// necessidade de integração com o banco INTEGRA_PRD
// ====================================

const sql = require('mssql');
const { poolPromise, poolIntegraPromise } = require('../config/db');

/**
 * Sincroniza posições de rastreamento do INTEGRA_PRD para DIVULGACARGA_PRD
 * @param {number} idViagem - ID da viagem a ser sincronizada
 * @returns {Promise<{success: boolean, message: string, registrosInseridos?: number}>}
 */
async function sincronizarRastreamentoIntegra(idViagem) {
  if (!idViagem) {
    throw new Error('ID da viagem é obrigatório');
  }

  try {
    // Verificar se o pool do INTEGRA_PRD está disponível
    const poolIntegra = await poolIntegraPromise;
    if (!poolIntegra) {
      throw new Error('Conexão com INTEGRA_PRD não disponível');
    }

    const pool = await poolPromise;

    // Executar o comando de sincronização
    const query = `
      INSERT INTO DIVULGACARGA_PRD.DBO.VIAGEMRASTREAMENTO (
        IDVIAGEM,
        CDCADASTRO,
        SEQUENCIA,
        DSPOSICAO,
        LATITUDE,
        LONGITUDE,
        FGORIGEM,
        FGSTATUS,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG,
        DHPOSICAO
      )
      SELECT 
        S.IDVIAGEM,
        1 AS CDCADASTRO,
        S.SEQUENCIA,
        S.DSPOSICAO,
        S.LATITUDE,
        S.LONGITUDE,
        S.FGORIGEM,
        S.FGSTATUS,
        S.DHMAINTENANCE,
        S.SGUSER,
        S.SERVERORIG,
        S.DHPOSICAO
      FROM INTEGRA_PRD.DBO.VIAGEMRASTREAMENTO S
      WHERE S.IDVIAGEM = @IDVIAGEM
        AND NOT EXISTS (
            SELECT 1
            FROM DIVULGACARGA_PRD.DBO.VIAGEMRASTREAMENTO D
            WHERE D.IDVIAGEM = S.IDVIAGEM
              AND D.SEQUENCIA = S.SEQUENCIA
        );
    `;

    const request = pool.request();
    request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));

    const result = await request.query(query);

    const registrosInseridos = result.rowsAffected[0] || 0;

    return {
      success: true,
      message: `Sincronização concluída. ${registrosInseridos} registro(s) inserido(s).`,
      registrosInseridos
    };
  } catch (error) {
    console.error('❌ Erro ao sincronizar rastreamento do INTEGRA_PRD:', error);
    throw error;
  }
}

/**
 * Controller para a rota de sincronização
 */
async function sincronizarRastreamento(req, res) {
  try {
    const { idViagem } = req.params;

    if (!idViagem) {
      return res.status(400).json({
        success: false,
        error: 'ID da viagem é obrigatório'
      });
    }

    const resultado = await sincronizarRastreamentoIntegra(idViagem);

    res.json(resultado);
  } catch (error) {
    console.error('Erro na sincronização:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao sincronizar rastreamento do INTEGRA_PRD'
    });
  }
}

module.exports = {
  sincronizarRastreamento,
  sincronizarRastreamentoIntegra
};

