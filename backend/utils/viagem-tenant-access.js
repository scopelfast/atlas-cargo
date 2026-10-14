// Garante viagem no tenant; JWT motorista exige vínculo em VIAGEMMOTORISTA (anti-IDOR).

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const { tenantIdForRequest } = require('./tenant-context');

function getMotoristaCadastroId(req) {
  const id = req.user && (req.user.cdcadastro ?? req.user.id);
  if (id == null || id === '') return NaN;
  const n = parseFloat(id);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @returns {Promise<boolean>}
 */
async function assertViagemTenantAccess(req, res, idViagemRaw) {
  const idViagem = parseFloat(idViagemRaw);
  if (!Number.isFinite(idViagem)) {
    res.status(400).json({ error: 'ID da viagem inválido.' });
    return false;
  }
  const tid = tenantIdForRequest(req);
  const pool = await poolPromise;
  const ex = await pool
    .request()
    .input('idViagem', sql.Decimal(15, 0), idViagem)
    .input('tenantId', sql.NVarChar(64), tid)
    .query(`
      SELECT 1 AS ok FROM [dbo].[VIAGEMMESTRE]
      WHERE [IDVIAGEM] = @idViagem AND [TENANT_ID] = @tenantId
    `);
  if (!ex.recordset?.length) {
    res.status(404).json({ error: 'Viagem não encontrada.', errorKey: 'commonErrors.naoEncontrado' });
    return false;
  }
  if (req.user && req.user.tipo === 'motorista') {
    const self = getMotoristaCadastroId(req);
    if (!Number.isFinite(self)) {
      res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      return false;
    }
    const vm = await pool
      .request()
      .input('idViagem', sql.Decimal(15, 0), idViagem)
      .input('cdMotorista', sql.Decimal(15, 0), self)
      .input('tenantId', sql.NVarChar(64), tid)
      .query(`
        SELECT 1 AS ok
        FROM [dbo].[VIAGEMMOTORISTA] VM
        INNER JOIN [dbo].[VIAGEMMESTRE] V ON V.[IDVIAGEM] = VM.[IDVIAGEM] AND V.[TENANT_ID] = @tenantId
        WHERE VM.[IDVIAGEM] = @idViagem AND VM.[CDMOTORISTA] = @cdMotorista
      `);
    if (!vm.recordset?.length) {
      res.status(403).json({ error: 'Acesso negado.', errorKey: 'commonErrors.acessoNegado' });
      return false;
    }
  }
  return true;
}

module.exports = { assertViagemTenantAccess, getMotoristaCadastroId };
