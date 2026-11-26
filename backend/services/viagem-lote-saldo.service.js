'use strict';

const sql = require('../config/mssql-compat');

class ErroLote extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function campo(row, nome) {
  if (!row) return undefined;
  if (row[nome] !== undefined && row[nome] !== null) return row[nome];
  const baixo = nome.toLowerCase();
  if (row[baixo] !== undefined && row[baixo] !== null) return row[baixo];
  return row[nome] !== undefined ? row[nome] : row[baixo];
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function arred3(n) {
  return Math.round(n * 1000) / 1000;
}

async function gravarAuditoria(transaction, item) {
  await transaction.request()
    .input('TENANT_ID', sql.NVarChar(64), item.tenantId)
    .input('IDVIAGEM_MAE', sql.Decimal(15, 0), item.idMae)
    .input('IDVIAGEM_FILHA', item.idFilha != null ? sql.Decimal(15, 0) : sql.VarChar, item.idFilha)
    .input('IDCONVOCACAO', sql.Int, item.idConvocacao)
    .input('EVENTO', sql.VarChar(20), item.evento)
    .input('SALDO_ANTES', sql.Decimal(15, 3), item.saldoAntes)
    .input('SALDO_DEPOIS', sql.Decimal(15, 3), item.saldoDepois)
    .input('QTD_EMBARQUES', item.qtdEmbarques != null ? sql.Int : sql.VarChar, item.qtdEmbarques)
    .input('QTD_TON', item.qtdTon != null ? sql.Decimal(15, 3) : sql.VarChar, item.qtdTon)
    .input('USUARIO', sql.VarChar(50), item.usuario || null)
    .input('DETALHES', sql.VarChar(500), item.detalhes || null)
    .query(`
      INSERT INTO [dbo].[VIAGEM_DERIVACAO_AUDITORIA] (
        [TENANT_ID], [IDVIAGEM_MAE], [IDVIAGEM_FILHA], [IDCONVOCACAO], [EVENTO],
        [SALDO_ANTES], [SALDO_DEPOIS], [QTD_EMBARQUES], [QTD_TON], [USUARIO], [DH_EVENTO], [DETALHES]
      ) VALUES (
        @TENANT_ID, @IDVIAGEM_MAE, @IDVIAGEM_FILHA, @IDCONVOCACAO, @EVENTO,
        @SALDO_ANTES, @SALDO_DEPOIS, @QTD_EMBARQUES, @QTD_TON, @USUARIO, GETDATE(), @DETALHES
      )
    `);
}

/**
 * Se a viagem da convocação é um lote, debita o saldo e cria a filha.
 * A convocação passa a apontar para a filha, ainda com status ACEITA.
 * Viagem sem TIPO_SALDO devolve aplicou:false e não mexe em nada.
 */
async function consumirECriarFilha(transaction, args) {
  const idMae = parseFloat(args.idViagem);
  const idConv = parseInt(args.idConvocacao, 10);
  const tenantId = args.tenantId;

  const maeRes = await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      SELECT
        [IDVIAGEM], [TIPO_SALDO], [SALDO_INICIAL_EMBARQUES], [SALDO_ATUAL_EMBARQUES],
        [SALDO_INICIAL_TON], [SALDO_ATUAL_TON], [STATUS_DISTRIBUICAO],
        [FGSITVIAGEM], [CDSITUACAOVIAGEM], [CDTIPOVIAGEM], [CDCONTRATADOR], [CDCLASSEFROTA],
        [DTPREVINICIO], [DTPREVFINAL], [IDROTEIRO], [DISTANCIAKM], [VLFRETE], [PESO], [CUBAGEM],
        [OBSERV], [FGRASTREADO], [MOEDA], [IDVIAGEM_MAE]
      FROM [dbo].[VIAGEMMESTRE]
      WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      FOR UPDATE
    `);
  const mae = maeRes.recordset[0];
  if (!mae) throw new ErroLote('Viagem não encontrada.', 404, 'VIAGEM_NAO_ENCONTRADA');

  const tipo = String(campo(mae, 'TIPO_SALDO') || '').trim().toUpperCase();
  if (tipo !== 'EMBARQUES' && tipo !== 'TONELADAS') return { aplicou: false };
  if (campo(mae, 'IDVIAGEM_MAE') != null) {
    throw new ErroLote('Esta viagem já é um atendimento do lote. Confirme na oferta.', 400, 'VIAGEM_JA_E_FILHA');
  }

  const convRes = await transaction.request()
    .input('IDCONVOCACAO', sql.Int, idConv)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS]
      FROM [dbo].[CONVOCACAO]
      WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
      FOR UPDATE
    `);
  const conv = convRes.recordset[0];
  const status = String(campo(conv, 'STATUS') || '').trim().toUpperCase();
  if (!conv || Number(campo(conv, 'IDVIAGEM')) !== idMae || status !== 'ACEITA') {
    throw new ErroLote('Esta convocação não está aceita nesta oferta.', 409, 'CONVOCACAO_NAO_ACEITA');
  }

  let qtdEmbarques = null;
  let qtdTon = null;
  let antes;
  let depois;
  if (tipo === 'EMBARQUES') {
    qtdEmbarques = 1;
    antes = num(campo(mae, 'SALDO_ATUAL_EMBARQUES'));
    if (antes == null || antes < 1) {
      throw new ErroLote('Saldo de cargas esgotado. Não há vaga para confirmar.', 409, 'SALDO_INSUFICIENTE');
    }
    depois = antes - 1;
  } else {
    qtdTon = arred3(num(args.toneladas));
    if (qtdTon == null || qtdTon <= 0) {
      throw new ErroLote('Informe as toneladas deste caminhão.', 400, 'LOTE_TONELADAS_OBRIGATORIAS');
    }
    antes = num(campo(mae, 'SALDO_ATUAL_TON'));
    if (antes == null || qtdTon - antes > 0.0005) {
      throw new ErroLote(
        `Saldo insuficiente. Restam ${antes == null ? 0 : antes} t e este caminhão pede ${qtdTon} t.`,
        409,
        'SALDO_INSUFICIENTE'
      );
    }
    depois = arred3(antes - qtdTon);
  }

  const maxId = await transaction.request().query(
    'SELECT COALESCE(MAX([IDVIAGEM]), 0) + 1 AS [maxId] FROM [dbo].[VIAGEMMESTRE]'
  );
  const idFilha = (maxId.recordset[0] && (maxId.recordset[0].maxId ?? maxId.recordset[0].maxid)) || null;
  const idFilhaNum = parseFloat(idFilha);
  if (!Number.isFinite(idFilhaNum) || idFilhaNum <= 0) {
    throw new ErroLote('Não foi possível numerar a viagem filha.', 500, 'ID_FILHA');
  }

  const pesoFilha = tipo === 'TONELADAS' ? qtdTon : campo(mae, 'PESO');
  const obsMae = String(campo(mae, 'OBSERV') || '').trim();
  const obs = (`${obsMae}${obsMae ? '\n' : ''}Filha da viagem ${idMae}.`).slice(0, 2048);

  await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idFilhaNum)
    .input('FGSITVIAGEM', campo(mae, 'FGSITVIAGEM') || 'D')
    .input('CDSITUACAOVIAGEM', campo(mae, 'CDSITUACAOVIAGEM') != null ? sql.SmallInt : sql.VarChar, campo(mae, 'CDSITUACAOVIAGEM'))
    .input('CDTIPOVIAGEM', sql.Int, campo(mae, 'CDTIPOVIAGEM'))
    .input('CDCONTRATADOR', campo(mae, 'CDCONTRATADOR') != null ? sql.Decimal(15, 0) : sql.VarChar, campo(mae, 'CDCONTRATADOR'))
    .input('CDCLASSEFROTA', campo(mae, 'CDCLASSEFROTA') != null ? sql.SmallInt : sql.VarChar, campo(mae, 'CDCLASSEFROTA'))
    .input('DTPREVINICIO', campo(mae, 'DTPREVINICIO') || null)
    .input('DTPREVFINAL', campo(mae, 'DTPREVFINAL') || null)
    .input('IDROTEIRO', campo(mae, 'IDROTEIRO') != null ? sql.Decimal(15, 0) : sql.VarChar, campo(mae, 'IDROTEIRO'))
    .input('DISTANCIAKM', campo(mae, 'DISTANCIAKM') != null ? sql.Decimal(15, 4) : sql.VarChar, campo(mae, 'DISTANCIAKM'))
    .input('VLFRETE', campo(mae, 'VLFRETE') != null ? sql.Decimal(15, 4) : sql.VarChar, campo(mae, 'VLFRETE'))
    .input('PESO', pesoFilha != null ? sql.Decimal(15, 4) : sql.VarChar, pesoFilha)
    .input('CUBAGEM', campo(mae, 'CUBAGEM') != null ? sql.Decimal(15, 4) : sql.VarChar, campo(mae, 'CUBAGEM'))
    .input('OBSERV', obs)
    .input('FGRASTREADO', campo(mae, 'FGRASTREADO') || 'N')
    .input('MOEDA', campo(mae, 'MOEDA') || 'BRL')
    .input('SGUSER', sql.VarChar(50), args.usuario || 'SYSTEM')
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('IDVIAGEM_MAE', sql.Decimal(15, 0), idMae)
    .input('QTD_EMB', qtdEmbarques != null ? sql.Int : sql.VarChar, qtdEmbarques)
    .input('QTD_TON', qtdTon != null ? sql.Decimal(15, 3) : sql.VarChar, qtdTon)
    .query(`
      INSERT INTO [dbo].[VIAGEMMESTRE] (
        [IDVIAGEM], [FGSITVIAGEM], [CDSITUACAOVIAGEM], [CDTIPOVIAGEM], [CDCONTRATADOR],
        [CDCLASSEFROTA], [DTPREVINICIO], [DTPREVFINAL], [IDROTEIRO], [DISTANCIAKM],
        [VLFRETE], [PESO], [CUBAGEM], [OBSERV], [FGRASTREADO], [MOEDA],
        [SGUSERINCLUSAO], [DHINCLUSAO], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID],
        [IDVIAGEM_MAE], [ORIGEM_DERIVACAO], [VALOR_CONSUMIDO_EMBARQUES], [VALOR_CONSUMIDO_TON]
      ) VALUES (
        @IDVIAGEM, @FGSITVIAGEM, @CDSITUACAOVIAGEM, @CDTIPOVIAGEM, @CDCONTRATADOR,
        @CDCLASSEFROTA, @DTPREVINICIO, @DTPREVFINAL, @IDROTEIRO, @DISTANCIAKM,
        @VLFRETE, @PESO, @CUBAGEM, @OBSERV, @FGRASTREADO, @MOEDA,
        @SGUSER, GETDATE(), 'A', GETDATE(), @SGUSER, 'AppDVcargas', @TENANT_ID,
        @IDVIAGEM_MAE, 'CONVOCACAO_APROVADA', @QTD_EMB, @QTD_TON
      )
    `);

  const updConv = await transaction.request()
    .input('IDCONVOCACAO', sql.Int, idConv)
    .input('IDFILHA', sql.Decimal(15, 0), idFilhaNum)
    .input('IDMAE', sql.Decimal(15, 0), idMae)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      UPDATE [dbo].[CONVOCACAO]
      SET [IDVIAGEM] = @IDFILHA, [DHMAINTENANCE] = GETDATE()
      WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        AND [TENANT_ID] = @TENANT_ID
        AND [STATUS] = 'ACEITA'
        AND [IDVIAGEM] = @IDMAE
    `);

  if (!updConv.rowsAffected || !updConv.rowsAffected[0]) {
    throw new ErroLote('A convocação mudou antes da confirmação. Recarregue a lista.', 409, 'CONVOCACAO_MUDOU');
  }

  const statusMae = depois <= 0.0005 ? 'ESGOTADA' : 'PARCIAL';
  const updMae = tipo === 'EMBARQUES'
    ? await transaction.request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .input('STATUS', sql.VarChar(12), statusMae)
      .input('DEPOIS', sql.Int, depois)
      .input('ANTES', sql.Int, antes)
      .query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET [SALDO_ATUAL_EMBARQUES] = @DEPOIS,
            [STATUS_DISTRIBUICAO] = @STATUS,
            [DHMAINTENANCE] = GETDATE()
        WHERE [IDVIAGEM] = @IDVIAGEM
          AND [TENANT_ID] = @TENANT_ID
          AND [TIPO_SALDO] = 'EMBARQUES'
          AND [SALDO_ATUAL_EMBARQUES] = @ANTES
      `)
    : await transaction.request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .input('STATUS', sql.VarChar(12), statusMae)
      .input('DEPOIS', sql.Decimal(15, 3), depois)
      .input('ANTES', sql.Decimal(15, 3), antes)
      .query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET [SALDO_ATUAL_TON] = @DEPOIS,
            [STATUS_DISTRIBUICAO] = @STATUS,
            [DHMAINTENANCE] = GETDATE()
        WHERE [IDVIAGEM] = @IDVIAGEM
          AND [TENANT_ID] = @TENANT_ID
          AND [TIPO_SALDO] = 'TONELADAS'
          AND [SALDO_ATUAL_TON] = @ANTES
      `);
  if (!updMae.rowsAffected || !updMae.rowsAffected[0]) {
    throw new ErroLote('O saldo mudou durante a confirmação. Tente de novo.', 409, 'SALDO_CONCORRENTE');
  }

  await gravarAuditoria(transaction, {
    tenantId,
    idMae,
    idFilha: idFilhaNum,
    idConvocacao: idConv,
    evento: 'CONFIRMOU',
    saldoAntes: antes,
    saldoDepois: depois,
    qtdEmbarques,
    qtdTon,
    usuario: args.usuario,
    detalhes: tipo === 'EMBARQUES' ? '1 carga' : `${qtdTon} t`
  });

  return {
    aplicou: true,
    idFilha: idFilhaNum,
    saldoAntes: antes,
    saldoDepois: depois,
    statusDistribuicao: statusMae,
    tipo
  };
}

async function filhaJaAndou(transaction, idFilha, tenantId, dhResposta) {
  const gps = await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idFilha)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('DH', dhResposta || null)
    .input('OFF', sql.Int, 0)
    .input('LIM', sql.Int, 1)
    .query(`
      SELECT [IDRASTREAMENTO]
      FROM [dbo].[VIAGEMRASTREAMENTO]
      WHERE [IDVIAGEM] = @IDVIAGEM
        AND [TENANT_ID] = @TENANT_ID
        AND COALESCE([DHPOSICAO], [DHREGISTRO]) > COALESCE(@DH, TIMESTAMP '1970-01-01')
      OFFSET @OFF ROWS FETCH NEXT @LIM ROWS ONLY
    `);
  if (gps.recordset && gps.recordset.length) return true;

  const prova = await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idFilha)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('OFF', sql.Int, 0)
    .input('LIM', sql.Int, 1)
    .query(`
      SELECT [IDVIAGEM]
      FROM [dbo].[DELIVERY_PROOFS]
      WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      OFFSET @OFF ROWS FETCH NEXT @LIM ROWS ONLY
    `);
  return !!(prova.recordset && prova.recordset.length);
}

/**
 * Devolve a vaga da filha para a mãe. Só a torre chama.
 * Não devolve se já houve rastreio depois da confirmação ou comprovante.
 */
async function devolverVaga(transaction, args) {
  const idConv = parseInt(args.idConvocacao, 10);
  const tenantId = args.tenantId;
  const motivo = String(args.motivo || '').trim();
  if (motivo.length < 3) {
    throw new ErroLote('Informe o motivo da desistência.', 400, 'MOTIVO_OBRIGATORIO');
  }

  const convRes = await transaction.request()
    .input('IDCONVOCACAO', sql.Int, idConv)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS], [DHRESPOSTA]
      FROM [dbo].[CONVOCACAO]
      WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
      FOR UPDATE
    `);
  const conv = convRes.recordset[0];
  if (!conv) throw new ErroLote('Convocação não encontrada.', 404, 'CONVOCACAO_NAO_ENCONTRADA');
  const status = String(campo(conv, 'STATUS') || '').trim().toUpperCase();
  if (status === 'DESISTIU') {
    throw new ErroLote('Esta desistência já foi registrada. A vaga não volta de novo.', 409, 'DESISTENCIA_JA_FEITA');
  }
  if (status !== 'CONFIRMADA') {
    throw new ErroLote('Só dá para devolver a vaga de uma confirmação. Antes disso o saldo não saiu.', 400, 'AINDA_NAO_CONFIRMADA');
  }

  const idFilha = parseFloat(campo(conv, 'IDVIAGEM'));
  const filhaRes = await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idFilha)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      SELECT [IDVIAGEM], [IDVIAGEM_MAE], [VALOR_CONSUMIDO_EMBARQUES], [VALOR_CONSUMIDO_TON], [FGSITVIAGEM]
      FROM [dbo].[VIAGEMMESTRE]
      WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      FOR UPDATE
    `);
  const filha = filhaRes.recordset[0];
  const idMae = num(campo(filha, 'IDVIAGEM_MAE'));
  if (!filha || idMae == null) {
    throw new ErroLote('Esta confirmação não veio de um lote. A desistência do lote não se aplica.', 400, 'NAO_E_FILHA');
  }

  if (await filhaJaAndou(transaction, idFilha, tenantId, campo(conv, 'DHRESPOSTA'))) {
    throw new ErroLote('A carga já andou (rastreio ou comprovante). A vaga não volta.', 409, 'CARGA_JA_ANDOU');
  }

  const maeRes = await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .query(`
      SELECT [IDVIAGEM], [TIPO_SALDO], [SALDO_INICIAL_EMBARQUES], [SALDO_ATUAL_EMBARQUES],
             [SALDO_INICIAL_TON], [SALDO_ATUAL_TON]
      FROM [dbo].[VIAGEMMESTRE]
      WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      FOR UPDATE
    `);
  const mae = maeRes.recordset[0];
  if (!mae) throw new ErroLote('Oferta do lote não encontrada.', 404, 'MAE_NAO_ENCONTRADA');
  const tipo = String(campo(mae, 'TIPO_SALDO') || '').trim().toUpperCase();

  let qtdEmbarques = null;
  let qtdTon = null;
  let antes;
  let depois;
  let inicial;
  if (tipo === 'EMBARQUES') {
    qtdEmbarques = parseInt(campo(filha, 'VALOR_CONSUMIDO_EMBARQUES'), 10);
    if (qtdEmbarques !== 1) throw new ErroLote('A filha não tem 1 carga debitada para devolver.', 409, 'CONSUMO_INVALIDO');
    antes = num(campo(mae, 'SALDO_ATUAL_EMBARQUES'));
    inicial = num(campo(mae, 'SALDO_INICIAL_EMBARQUES'));
    depois = (antes == null ? 0 : antes) + 1;
  } else if (tipo === 'TONELADAS') {
    qtdTon = arred3(num(campo(filha, 'VALOR_CONSUMIDO_TON')));
    if (qtdTon == null || qtdTon <= 0) throw new ErroLote('A filha não tem toneladas debitadas para devolver.', 409, 'CONSUMO_INVALIDO');
    antes = num(campo(mae, 'SALDO_ATUAL_TON'));
    inicial = num(campo(mae, 'SALDO_INICIAL_TON'));
    depois = arred3((antes == null ? 0 : antes) + qtdTon);
  } else {
    throw new ErroLote('A oferta não está mais marcada como lote.', 409, 'MAE_SEM_LOTE');
  }
  if (inicial != null && depois - inicial > 0.0005) {
    throw new ErroLote('A devolução passaria do saldo programado. Nada foi alterado.', 409, 'SALDO_ACIMA_DO_INICIAL');
  }

  const statusMae = inicial != null && Math.abs(depois - inicial) <= 0.0005 ? 'ABERTA' : 'PARCIAL';
  if (tipo === 'EMBARQUES') {
    await transaction.request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .input('STATUS', sql.VarChar(12), statusMae)
      .input('DEPOIS', sql.Int, depois)
      .query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET [SALDO_ATUAL_EMBARQUES] = @DEPOIS,
            [STATUS_DISTRIBUICAO] = @STATUS,
            [DHMAINTENANCE] = GETDATE()
        WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID AND [TIPO_SALDO] = 'EMBARQUES'
      `);
  } else {
    await transaction.request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idMae)
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .input('STATUS', sql.VarChar(12), statusMae)
      .input('DEPOIS', sql.Decimal(15, 3), depois)
      .query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET [SALDO_ATUAL_TON] = @DEPOIS,
            [STATUS_DISTRIBUICAO] = @STATUS,
            [DHMAINTENANCE] = GETDATE()
        WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID AND [TIPO_SALDO] = 'TONELADAS'
      `);
  }

  await transaction.request()
    .input('IDVIAGEM', sql.Decimal(15, 0), idFilha)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('SGUSER', sql.VarChar(50), args.usuario || 'SYSTEM')
    .query(`
      UPDATE [dbo].[VIAGEMMESTRE]
      SET [FGSITVIAGEM] = 'C',
          [FGACTIVE] = 'I',
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @SGUSER
      WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
    `);

  const updConv = await transaction.request()
    .input('IDCONVOCACAO', sql.Int, idConv)
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('SGUSER', sql.VarChar(50), args.usuario || 'SYSTEM')
    .query(`
      UPDATE [dbo].[CONVOCACAO]
      SET [STATUS] = 'DESISTIU',
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @SGUSER
      WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        AND [TENANT_ID] = @TENANT_ID
        AND [STATUS] = 'CONFIRMADA'
    `);
  if (!updConv.rowsAffected || !updConv.rowsAffected[0]) {
    throw new ErroLote('A confirmação mudou antes da desistência. Nada foi alterado.', 409, 'CONVOCACAO_MUDOU');
  }

  await gravarAuditoria(transaction, {
    tenantId,
    idMae,
    idFilha,
    idConvocacao: idConv,
    evento: 'DESISTIU',
    saldoAntes: antes,
    saldoDepois: depois,
    qtdEmbarques,
    qtdTon,
    usuario: args.usuario,
    detalhes: motivo.slice(0, 500)
  });

  return { idMae, idFilha, saldoAntes: antes, saldoDepois: depois, statusDistribuicao: statusMae, tipo };
}

module.exports = {
  ErroLote,
  consumirECriarFilha,
  devolverVaga
};
