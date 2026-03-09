// ====================================
// SINCRONIZAÇÃO DE RASTREAMENTO (DESCONTINUADA)
// ====================================
// O banco INTEGRA_PRD não existe mais. O sistema utiliza apenas PostgreSQL (ATLAS_CARGO_PRD).
// As posições de rastreamento ficam diretamente no banco principal.
// Esta rota permanece para compatibilidade: retorna 410 Gone com mensagem clara.
// ====================================

/**
 * Sincronização descontinuada: INTEGRA_PRD foi removido.
 */
async function sincronizarRastreamento(req, res) {
  return res.status(410).json({
    success: false,
    error: 'Sincronização com INTEGRA_PRD foi descontinuada. O sistema utiliza apenas PostgreSQL; as posições de rastreamento estão no banco principal.',
    discontinued: true,
  });
}

/**
 * Função legada para chamadas diretas (ex.: jobs). Retorna objeto indicando descontinuidade.
 */
async function sincronizarRastreamentoIntegra(idViagem) {
  return {
    success: false,
    message: 'Sincronização com INTEGRA_PRD foi descontinuada. O sistema utiliza apenas PostgreSQL.',
    registrosInseridos: 0,
    discontinued: true,
  };
}

module.exports = {
  sincronizarRastreamento,
  sincronizarRastreamentoIntegra,
};
