// backend/controllers/viagemmestre.controller.js
// Controller para Gerenciamento de Viagens
// Versão: 1.0
// Atlas Cargo
// Data: 2026-04-05

const sql = require('../config/mssql-compat');
const axios = require('axios');
const { poolPromise, getFirstNumericValue, createTransaction } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const convocacaoMsgTpl = require('../services/convocacao-mensagem-template.service');
const { getContexto } = require('../services/contexto.service');

// Constantes
const SITUACAO_VIAGEM = {
  'A': 'Aprovada',
  'C': 'Cancelada',
  'D': 'Preparação',
  'E': 'Final de rota',
  'F': 'Viagem finalizada',
  'M': 'Emissão documentos',
  'P': 'Programada',
  'T': 'Em trânsito'
};

function normalizarDigitosTelefoneBR(val) {
  if (val == null || val === '') return '';
  let d = String(val).replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return d;
}

function normalizarDigitosSoNumeros(val) {
  if (val == null || val === '') return '';
  return String(val).replace(/\D/g, '');
}

function isPaisBrTelefone(paisPadrao) {
  const p = String(paisPadrao == null ? 'BR' : paisPadrao)
    .trim()
    .toUpperCase();
  return p === 'BR' || p === 'BRA';
}

/** Compara telefone informado na página pública com o cadastro. BR: DDD + número; demais países: dígitos, igualdade ou sufixo (≥8 dígitos no menor). */
function telefoneMotoristaConfere(informado, cadastro, paisPadrao) {
  if (isPaisBrTelefone(paisPadrao)) {
    const a = normalizarDigitosTelefoneBR(informado);
    const b = normalizarDigitosTelefoneBR(cadastro);
    if (!a || !b || a.length < 10 || b.length < 10) return false;
    if (a === b) return true;
    return a.slice(-11) === b.slice(-11) || a.slice(-10) === b.slice(-10);
  }
  const a = normalizarDigitosSoNumeros(informado);
  const b = normalizarDigitosSoNumeros(cadastro);
  if (!a || !b || a.length < 8 || b.length < 8) return false;
  if (a === b) return true;
  if (a.length <= b.length && b.endsWith(a) && a.length >= 8) return true;
  if (b.length <= a.length && a.endsWith(b) && b.length >= 8) return true;
  return false;
}

/**
 * URL da página pública da convocação (aceitar/recusar).
 * Prioriza link já montado no payload; senão usa IDCONVOCACAO + baseUrl.
 * Evita `id ? url : ''` (ID 0 ou outros valores falsy quebravam o link).
 */
/** Valor opcional informado pelo motorista ao aceitar (BR: vírgula decimal). Retorna { ok, value } ou { ok: false, error }. */
function parseValorFretePropostaMotorista(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  let s = String(raw).trim().replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return { ok: false, error: 'Informe um valor numérico válido para o frete.' };
  if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/,/.test(s)) s = s.replace(',', '.');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return { ok: false, error: 'Valor de frete inválido.' };
  if (n < 0) return { ok: false, error: 'O frete proposto não pode ser negativo.' };
  if (n > 999999999.99) return { ok: false, error: 'Valor acima do limite permitido.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function isUrlLocalHost(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!s) return true;
  try {
    const host = new URL(s.includes('://') ? s : `http://${s}`).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch (_) {
    return /localhost|127\.0\.0\.1/.test(s);
  }
}

/**
 * Base pública para links de convocação/WhatsApp.
 * Se PUBLIC_URL (ou APP_URL) for público, manda nele — ignora localhost vindo do browser.
 */
function resolverBaseUrlPublica(baseUrlBody) {
  const fromEnv = String(process.env.PUBLIC_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/$/, '');
  const fromBody = String(baseUrlBody || '')
    .trim()
    .replace(/\/$/, '');
  if (fromEnv && !isUrlLocalHost(fromEnv)) return fromEnv;
  if (fromBody && !isUrlLocalHost(fromBody)) return fromBody;
  if (fromEnv) return fromEnv;
  if (fromBody) return fromBody;
  return 'http://localhost:3001';
}

/** Reescreve link localhost → PUBLIC_URL quando o .env tem URL pública (ngrok/domínio). */
function reescreverLinkSeLocal(link, basePublica) {
  const s = String(link || '').trim();
  if (!s || !basePublica || isUrlLocalHost(basePublica)) return s;
  if (!isUrlLocalHost(s)) return s;
  try {
    const path = s.includes('://') ? new URL(s).pathname + (new URL(s).search || '') : s;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${basePublica.replace(/\/$/, '')}${p}`;
  } catch (_) {
    const m = s.match(/\/convocacao\/[^?\s#]+/i);
    if (m) return `${basePublica.replace(/\/$/, '')}${m[0]}`;
    return s;
  }
}

function resolverLinkConvocacaoParaMensagem(convPayload, baseUrl) {
  const base = resolverBaseUrlPublica(baseUrl);
  const keysLink = ['LINKCONVOCACAO', 'linkconvocacao', 'LINK_CONVOCACAO'];
  for (const k of keysLink) {
    const x = convPayload[k];
    if (x == null || x === '') continue;
    const s = String(x).trim();
    if (!s) continue;
    if (/^https?:\/\//i.test(s)) return reescreverLinkSeLocal(s, base);
    if (s.startsWith('/') && base) return `${base}${s}`;
    return reescreverLinkSeLocal(s, base);
  }
  const idRaw =
    convPayload.IDCONVOCACAO ??
    convPayload.idConvocacao ??
    convPayload.idconvocacao ??
    convPayload.ID_CONVOCACAO;
  if (idRaw == null || idRaw === '') return '';
  const idStr = String(idRaw).trim();
  if (!idStr || idStr === 'undefined' || idStr === 'null') return '';
  if (!base) return `/convocacao/${idStr}`;
  return `${base}/convocacao/${idStr}`;
}

const {
  parseSwitchSendSignatureFromDb,
  parseSwitchCloseTicketFromDb,
  registrarResumoEtapaWhatsApp,
  enviarUmaMensagemSwitchDigital,
} = require('../services/whatsapp-switch-digital.service');
const {
  gravarDivergenciaPlacasSomente,
  notificarDivergenciaPlacasContratador,
} = require('../services/convocacao-placas-divergencia.service');
const {
  sqlCoalescePlacasEsperadasConvocacao,
  sqlCoalesceDsClasseConjuntoConvocacao,
  sqlPlacasEsperadasPorViagemMotoristaParams,
  sqlDsClasseConjuntoPorViagemMotoristaParams,
  sqlCoalescePlacasEsperadasConvocacaoComSnapshot,
  sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot,
} = require('../helpers/convocacao-placas-esperadas.sql');

/**
 * O SELECT de responderConvocacao pode cair em fallback sem PLACASESPERADAS / DSCLASSEFROTA_CONJUNTO (42703),
 * zerando o gate e ignorando o fluxo DIVERGE (aceite sem FG e sem WhatsApp). Alinha com GET público.
 */
async function enriquecerPlacasConjuntoConvRowResponder(pool, idConvocacao, tenantId, convRow) {
  const pl = String(convRow.PLACASESPERADAS ?? convRow.placasesperadas ?? '').trim();
  const cl = String(convRow.DSCLASSEFROTA_CONJUNTO ?? convRow.dsclassefrota_conjunto ?? '').trim();
  if (pl || cl) return;
  const sqlEnrich = `
    SELECT
      (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
      (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]
    FROM [dbo].[CONVOCACAO] c
    WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO AND c.[TENANT_ID] = @TENANT_ID
  `;
  try {
    const r = await pool
      .request()
      .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao, 10))
      .input('TENANT_ID', sql.NVarChar(64), String(tenantId || '').trim())
      .query(sqlEnrich);
    const row = r.recordset && r.recordset[0];
    if (!row) return;
    const p2 = row.PLACASESPERADAS ?? row.placasesperadas;
    const c2 = row.DSCLASSEFROTA_CONJUNTO ?? row.dsclassefrota_conjunto;
    if (p2 != null && String(p2).trim() !== '') convRow.PLACASESPERADAS = p2;
    if (c2 != null && String(c2).trim() !== '') convRow.DSCLASSEFROTA_CONJUNTO = c2;
  } catch (e) {
    if (e.code === '42703') return;
    throw e;
  }
}

/** Char(2) para VIAGEMVEICULO.TPEQUIPAMENTO a partir de EQUIPAMENTO.CDTIPOEquipamento. */
function formatarTpeEquipamentoParaViagem(cdTipo) {
  if (cdTipo == null || cdTipo === '') return '01';
  const n = parseInt(String(cdTipo).replace(/\D/g, ''), 10);
  if (Number.isFinite(n)) return String(n).padStart(2, '0').slice(0, 2);
  const s = String(cdTipo).trim().toUpperCase().replace(/\s/g, '');
  if (s.length >= 2) return s.slice(0, 2);
  return s.padStart(2, '0').slice(0, 2);
}

function normalizarTokenPlaca(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Inclui em VIAGEMVEICULO os equipamentos do motorista que batem com PLACASESPERADAS
 * (mesma expressão da listagem). Não remove vínculos já existentes. Falhas são engolidas pelo caller.
 */
async function vincularVeiculosViagemAoConfirmarConvocacao(transaction, {
  idConvocacao,
  idViagem,
  cdMotorista,
  tenantId,
  sgUser,
}) {
  if (cdMotorista == null || cdMotorista === '') return 0;
  const tid = tenantId != null ? String(tenantId) : '';
  const idConv = parseInt(idConvocacao, 10);
  const idV = parseFloat(idViagem);
  const cdMot = parseFloat(cdMotorista);
  if (!Number.isFinite(idConv) || !Number.isFinite(idV) || !Number.isFinite(cdMot)) return 0;

  const rowPlacas = await transaction
    .request()
    .input('IDCONVOCACAO', sql.Int, idConv)
    .input('TENANT_ID', sql.NVarChar(64), tid)
    .query(`
      SELECT (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS]
      FROM [dbo].[CONVOCACAO] c
      WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO AND c.[TENANT_ID] = @TENANT_ID
    `);

  const r0 = rowPlacas.recordset && rowPlacas.recordset[0];
  const rawPlacas = r0
    ? String(r0.PLACASESPERADAS ?? r0.placasesperadas ?? '').trim()
    : '';
  const tokens = rawPlacas
    .split(/[,;|]+/)
    .map((p) => normalizarTokenPlaca(p))
    .filter(Boolean);

  const equipPorId = new Map();

  const upsertEquipRow = (row) => {
    if (!row) return;
    const ide = row.IDEQUIPAMENTO ?? row.idequipamento;
    if (ide == null) return;
    const idNum = parseFloat(ide);
    if (!Number.isFinite(idNum)) return;
    const ref = row.REFEQUIPAMENTO ?? row.refequipamento ?? '';
    const cdTipo = row.CDTIPOEQUIPAMENTO ?? row.cdtipoequipamento;
    equipPorId.set(idNum, {
      idequipamento: idNum,
      refequipamento: String(ref || '').trim() || 'SEMPLACA',
      tpequipamento: formatarTpeEquipamentoParaViagem(cdTipo),
    });
  };

  if (tokens.length > 0) {
    for (const placaTok of tokens) {
      const rEq = await transaction
        .request()
        .input('CDMOTORISTA', sql.Decimal(15, 0), cdMot)
        .input('TENANT_ID', sql.NVarChar(64), tid)
        .input('PLACA', sql.VarChar(20), placaTok)
        .query(`
          SELECT
            e.[IDEQUIPAMENTO],
            e.[REFEQUIPAMENTO],
            e.[CDTIPOEQUIPAMENTO]
          FROM [dbo].[MOTORISTA_VEICULO] mv
          INNER JOIN [dbo].[EQUIPAMENTO] e ON e.[IDEQUIPAMENTO] = mv.[CDEQUIPAMENTO]
            AND (e.[TENANT_ID] = @TENANT_ID OR e.[TENANT_ID] = 'default')
          WHERE mv.[CDCADASTRO] = @CDMOTORISTA
            AND (mv.[TENANT_ID] = @TENANT_ID OR mv.[TENANT_ID] IS NULL)
            AND COALESCE(mv.[FGACTIVE], 'S') = 'S'
            AND COALESCE(mv.[STATUSAPROVACAO], 'P') = 'A'
            AND mv.[CDEQUIPAMENTO] IS NOT NULL
            AND (
              UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(COALESCE(mv.[PLACA], ''))), '-', ''), ' ', ''), '.', '')) = @PLACA
              OR UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(COALESCE(e.[REFEQUIPAMENTO], ''))), '-', ''), ' ', ''), '.', '')) = @PLACA
            )
          ORDER BY e.[IDEQUIPAMENTO] ASC
        `);
      const first = rEq.recordset && rEq.recordset[0];
      if (first) upsertEquipRow(first);
    }
  } else {
    const rAll = await transaction
      .request()
      .input('CDMOTORISTA', sql.Decimal(15, 0), cdMot)
      .input('TENANT_ID', sql.NVarChar(64), tid)
      .query(`
        SELECT DISTINCT
          e.[IDEQUIPAMENTO],
          e.[REFEQUIPAMENTO],
          e.[CDTIPOEQUIPAMENTO]
        FROM [dbo].[MOTORISTA_VEICULO] mv
        INNER JOIN [dbo].[EQUIPAMENTO] e ON e.[IDEQUIPAMENTO] = mv.[CDEQUIPAMENTO]
          AND (e.[TENANT_ID] = @TENANT_ID OR e.[TENANT_ID] = 'default')
        WHERE mv.[CDCADASTRO] = @CDMOTORISTA
          AND (mv.[TENANT_ID] = @TENANT_ID OR mv.[TENANT_ID] IS NULL)
          AND COALESCE(mv.[FGACTIVE], 'S') = 'S'
          AND COALESCE(mv.[STATUSAPROVACAO], 'P') = 'A'
          AND mv.[CDEQUIPAMENTO] IS NOT NULL
        ORDER BY e.[IDEQUIPAMENTO] ASC
      `);
    for (const row of rAll.recordset || []) upsertEquipRow(row);
  }

  let inseridos = 0;
  for (const eq of equipPorId.values()) {
    const chk = await transaction
      .request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idV)
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), eq.idequipamento)
      .query(`
        SELECT COUNT(*) AS [C]
        FROM [dbo].[VIAGEMVEICULO]
        WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO
      `);
    if (getFirstNumericValue(chk.recordset, 0) > 0) continue;

    await transaction
      .request()
      .input('IDVIAGEM', sql.Decimal(15, 0), idV)
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), eq.idequipamento)
      .input('REFEQUIPAMENTO', sql.VarChar(20), String(eq.refequipamento).toUpperCase().slice(0, 20))
      .input('TPEQUIPAMENTO', sql.Char(2), String(eq.tpequipamento || '01').toUpperCase().slice(0, 2))
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        INSERT INTO [dbo].[VIAGEMVEICULO] ([IDVIAGEM], [IDEQUIPAMENTO], [REFEQUIPAMENTO], [TPEQUIPAMENTO], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
        VALUES (@IDVIAGEM, @IDEQUIPAMENTO, @REFEQUIPAMENTO, @TPEQUIPAMENTO, GETDATE(), @sgUser, 'AppDVcargas')
      `);
    inseridos++;
  }

  if (inseridos > 0) {
    console.log(`[CONFIRMAR] ${inseridos} veículo(s) vinculado(s) à viagem ${idV} a partir do motorista ${cdMot} (conv. ${idConv}).`);
  }
  return inseridos;
}

// Controller methods
const viagemController = {
  // Listar viagens com filtros
  listar: async (req, res) => {
    try {
      const {
        idViagem, situacaoViagem, tipoViagem, classeFrota, contratador,
        origemEstado, origemCidade, destinoEstado, destinoCidade,
        roteiro, dataInicio, dataFim, frete, peso, cubagem, rastreado, motoristaConfirmado
      } = req.query;

      let query = `
        SELECT 
          [v].[IDVIAGEM],
          [v].[FGSITVIAGEM],
          [v].[CDSITUACAOVIAGEM],
          [s].[DSSITUACAOVIAGEM],
          [v].[CDTIPOVIAGEM],
          [t].[DSTIPOVIAGEM],
          [v].[SGUSERINCLUSAO],
          [v].[DHINCLUSAO],
          [v].[CDCONTRATADOR],
          upper(isnull(nullif(ltrim(rtrim([cg].[RZSOCIAL])), ''), ltrim(rtrim([cg].[NMFANTASIA])))) AS CONTRATADOR_NOME,
          [v].[FGACTIVE],
          [v].[CDCLASSEFROTA],
          [cf].[DSCLASSEFROTA],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[IDROTEIRO],
          [r].[DSROTEIRO],
          [v].[DISTANCIAKM],
          [v].[VLFRETE],
          COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
          [v].[PESO],
          [v].[CUBAGEM],
          [v].[OBSERV],
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[CDCIDADE] AS ORIGEM_CODIGO,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[CDCIDADE] AS DESTINO_CODIGO,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID]) AS QTD_ACIONADOS,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] IN ('ACEITA', 'ACEITA_DESCARTADA')) AS QTD_ACEITE,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] = 'RECUSADA') AS QTD_RECUSA,
          CASE 
            WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] = 'CONFIRMADA') THEN 'S'
            ELSE 'N'
          END AS TEM_CONFIRMADO,
          (SELECT COUNT(*) FROM [dbo].[DELIVERY_PROOFS] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID]) AS QTD_COMPROVANTES
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
          AND ([s].[TENANT_ID] = [v].[TENANT_ID] OR [s].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] t ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
          AND ([t].[TENANT_ID] = [v].[TENANT_ID] OR [t].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
          AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE 1=1
      `;

      const idViagemTrim = idViagem != null ? String(idViagem).trim() : '';
      const idViagemNum = idViagemTrim !== '' ? parseFloat(idViagemTrim) : NaN;
      /** ID numérico explícito: lista só por tenant + ID (não combinar situação/período — gerava grid vazio em deep links). */
      const narrowById = idViagemTrim !== '' && Number.isFinite(idViagemNum);

      const params = [];
      if (narrowById) {
        query += ` AND [v].[IDVIAGEM] = @IDVIAGEM`;
        params.push({ name: 'IDVIAGEM', value: idViagemNum });
      } else {
        if (idViagemTrim !== '' && Number.isFinite(idViagemNum)) {
          query += ` AND [v].[IDVIAGEM] = @IDVIAGEM`;
          params.push({ name: 'IDVIAGEM', value: idViagemNum });
        }
        if (situacaoViagem) {
          query += ` AND [v].[FGSITVIAGEM] = @SITUACAOVIAGEM`;
          params.push({ name: 'SITUACAOVIAGEM', value: situacaoViagem });
        }
        if (tipoViagem) {
          query += ` AND [v].[CDTIPOVIAGEM] = @TIPOVIAGEM`;
          params.push({ name: 'TIPOVIAGEM', value: parseInt(tipoViagem) });
        }
        if (classeFrota) {
          query += ` AND [v].[CDCLASSEFROTA] = @CLASSEFROTA`;
          params.push({ name: 'CLASSEFROTA', value: parseInt(classeFrota) });
        }
        if (contratador) {
          query += ` AND [v].[CDCONTRATADOR] = @CONTRATADOR`;
          params.push({ name: 'CONTRATADOR', value: parseFloat(contratador) });
        }
        if (origemEstado) {
          query += ` AND [co].[ESTADO] = @ORIGEM_ESTADO`;
          params.push({ name: 'ORIGEM_ESTADO', value: origemEstado });
        }
        if (origemCidade) {
          query += ` AND [co].[NMCIDADE] LIKE @ORIGEM_CIDADE`;
          params.push({ name: 'ORIGEM_CIDADE', value: `%${origemCidade}%` });
        }
        if (destinoEstado) {
          query += ` AND [cd].[ESTADO] = @DESTINO_ESTADO`;
          params.push({ name: 'DESTINO_ESTADO', value: destinoEstado });
        }
        if (destinoCidade) {
          query += ` AND [cd].[NMCIDADE] LIKE @DESTINO_CIDADE`;
          params.push({ name: 'DESTINO_CIDADE', value: `%${destinoCidade}%` });
        }
        if (roteiro) {
          query += ` AND [v].[IDROTEIRO] = @ROTEIRO`;
          params.push({ name: 'ROTEIRO', value: parseFloat(roteiro) });
        }
        // Período: com início e fim, incluir viagens que se sobrepõem ao intervalo (não só as “contidas”).
        // Antes: início >= X e fim <= Y excluía viagens longas (ex.: prev. fim em dez. com filtro até abril).
        if (dataInicio && dataFim) {
          query += ` AND [v].[DTPREVINICIO] <= @DATAFIM AND [v].[DTPREVFINAL] >= @DATAINICIO`;
          params.push({ name: 'DATAINICIO', value: new Date(dataInicio) });
          params.push({ name: 'DATAFIM', value: new Date(dataFim) });
        } else if (dataInicio) {
          query += ` AND [v].[DTPREVINICIO] >= @DATAINICIO`;
          params.push({ name: 'DATAINICIO', value: new Date(dataInicio) });
        } else if (dataFim) {
          query += ` AND [v].[DTPREVFINAL] <= @DATAFIM`;
          params.push({ name: 'DATAFIM', value: new Date(dataFim) });
        }
        if (frete) {
          query += ` AND [v].[VLFRETE] = @FRETE`;
          params.push({ name: 'FRETE', value: parseFloat(frete) });
        }
        if (peso) {
          query += ` AND [v].[PESO] = @PESO`;
          params.push({ name: 'PESO', value: parseFloat(peso) });
        }
        if (cubagem) {
          query += ` AND [v].[CUBAGEM] = @CUBAGEM`;
          params.push({ name: 'CUBAGEM', value: parseFloat(cubagem) });
        }
        if (rastreado) {
          query += ` AND [v].[FGRASTREADO] = @RASTREADO`;
          params.push({ name: 'RASTREADO', value: rastreado });
        }
        if (motoristaConfirmado) {
          if (motoristaConfirmado === 'S') {
            query += ` AND EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] = 'CONFIRMADA')`;
          } else if (motoristaConfirmado === 'N') {
            query += ` AND NOT EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] = 'CONFIRMADA')`;
          }
        }
      }

      params.push({ name: 'TENANT_ID', value: tenantIdForRequest(req) });
      query += ` AND [v].[TENANT_ID] = @TENANT_ID`;
      query += ` ORDER BY [v].[IDVIAGEM] DESC`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => {
        // Proteção: garantir que o valor não seja um objeto
        let valor = p.value;
        if (typeof valor === 'object' && valor !== null && !(valor instanceof Date)) {
          console.error(`[LISTAR VIAGENS] ⚠️ AVISO: Parâmetro ${p.name} é um objeto! Convertendo para string.`, valor);
          valor = JSON.stringify(valor);
        }
        request.input(p.name, valor);
      });

      const result = await request.query(query);
      const viagens = result.recordset.map(v => ({
        IDVIAGEM: v.IDVIAGEM,
        FGSITVIAGEM: v.FGSITVIAGEM,
        FGSITVIAGEM_NOME: SITUACAO_VIAGEM[v.FGSITVIAGEM] || v.FGSITVIAGEM,
        CDSITUACAOVIAGEM: v.CDSITUACAOVIAGEM,
        DSSITUACAOVIAGEM: v.DSSITUACAOVIAGEM || 'Não informado',
        CDTIPOVIAGEM: v.CDTIPOVIAGEM,
        DSTIPOVIAGEM: v.DSTIPOVIAGEM || 'Não informado',
        SGUSERINCLUSAO: v.SGUSERINCLUSAO || 'Não informado',
        DHINCLUSAO: v.DHINCLUSAO,
        CDCONTRATADOR: v.CDCONTRATADOR ?? v.cdcontratador,
        CONTRATADOR_NOME: v.CONTRATADOR_NOME ?? v.contratador_nome ?? 'Não informado',
        FGACTIVE: v.FGACTIVE === 'A' ? 'S' : 'N',
        CDCLASSEFROTA: v.CDCLASSEFROTA,
        DSCLASSEFROTA: v.DSCLASSEFROTA || 'Não informado',
        DTPREVINICIO: v.DTPREVINICIO,
        DTPREVFINAL: v.DTPREVFINAL,
        IDROTEIRO: v.IDROTEIRO,
        DSROTEIRO: v.DSROTEIRO || 'Não informado',
        DISTANCIAKM: v.DISTANCIAKM,
        VLFRETE: v.VLFRETE,
        PESO: v.PESO,
        CUBAGEM: v.CUBAGEM,
        OBSERV: v.OBSERV || 'Não informado',
        ORIGEM_ESTADO: v.ORIGEM_ESTADO || 'Não informado',
        ORIGEM_CIDADE: v.ORIGEM_CIDADE || 'Não informado',
        ORIGEM_CODIGO: v.ORIGEM_CODIGO,
        DESTINO_ESTADO: v.DESTINO_ESTADO || 'Não informado',
        DESTINO_CIDADE: v.DESTINO_CIDADE || 'Não informado',
        DESTINO_CODIGO: v.DESTINO_CODIGO,
        QTD_ACIONADOS: v.QTD_ACIONADOS ?? v.qtd_acionados ?? 0,
        QTD_ACEITE: v.QTD_ACEITE ?? v.qtd_aceite ?? 0,
        QTD_RECUSA: v.QTD_RECUSA ?? v.qtd_recusa ?? 0,
        TEM_CONFIRMADO: v.TEM_CONFIRMADO ?? v.tem_confirmado ?? 'N',
        QTD_COMPROVANTES: (v.QTD_COMPROVANTES ?? v.qtd_comprovantes ?? 0),
        TEM_COMPROVANTE: ((v.QTD_COMPROVANTES ?? v.qtd_comprovantes ?? 0) > 0) ? 'S' : 'N'
      }));

      res.json(viagens);
    } catch (err) {
      console.error('Erro ao listar viagens:', err);
      res.status(500).json({ error: 'Erro ao carregar viagens.' });
    }
  },

  // Criar nova viagem
  criar: async (req, res) => {
    try {
      const {
        FGSITVIAGEM, CDSITUACAOVIAGEM, CDTIPOVIAGEM, CDCONTRATADOR,
        CDCLASSEFROTA, DTPREVINICIO, DTPREVFINAL, IDROTEIRO, DISTANCIAKM,
        VLFRETE, PESO, CUBAGEM, OBSERV, FGRASTREADO, MOEDA
      } = req.body;

      // Validações obrigatórias
      const faltandoCriar = [];
      if (!FGSITVIAGEM) faltandoCriar.push('FGSITVIAGEM (situação)');
      if (!CDSITUACAOVIAGEM) faltandoCriar.push('CDSITUACAOVIAGEM (cód. situação)');
      if (!CDTIPOVIAGEM) faltandoCriar.push('CDTIPOVIAGEM (tipo de viagem)');
      if (faltandoCriar.length > 0) {
        return res.status(400).json({
          error: 'Campos obrigatórios não preenchidos.',
          camposRequeridos: faltandoCriar
        });
      }

      const pool = await poolPromise;

      // Usuário que grava o registro: sempre o logado (req.user do JWT ou header user-login)
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      // Gerar novo ID
      const maxResult = await pool
        .request()
        .query('SELECT COALESCE(MAX([IDVIAGEM]), 0) + 1 AS [maxId] FROM [dbo].[VIAGEMMESTRE]');
      const novoId = getFirstNumericValue(maxResult.recordset, 1);

      // Inserir viagem
      const request = pool.request();
      request.input('IDVIAGEM', sql.Decimal(15, 0), novoId);
      request.input('FGSITVIAGEM', FGSITVIAGEM);
      request.input('CDSITUACAOVIAGEM', sql.SmallInt, CDSITUACAOVIAGEM);
      request.input('CDTIPOVIAGEM', sql.Int, CDTIPOVIAGEM);
      request.input('CDCONTRATADOR', CDCONTRATADOR ? sql.Decimal(15, 0) : sql.VarChar, CDCONTRATADOR || null);
      request.input('CDCLASSEFROTA', CDCLASSEFROTA ? sql.SmallInt : sql.VarChar, CDCLASSEFROTA || null);
      request.input('DTPREVINICIO', DTPREVINICIO ? sql.SmallDateTime : sql.VarChar, DTPREVINICIO || null);
      request.input('DTPREVFINAL', DTPREVFINAL ? sql.SmallDateTime : sql.VarChar, DTPREVFINAL || null);
      request.input('IDROTEIRO', IDROTEIRO ? sql.Decimal(15, 0) : sql.VarChar, IDROTEIRO || null);
      request.input('DISTANCIAKM', DISTANCIAKM ? sql.Decimal(15, 4) : sql.VarChar, DISTANCIAKM || null);
      request.input('VLFRETE', VLFRETE ? sql.Decimal(15, 4) : sql.VarChar, VLFRETE || null);
      request.input('PESO', PESO ? sql.Decimal(15, 4) : sql.VarChar, PESO || null);
      request.input('CUBAGEM', CUBAGEM ? sql.Decimal(15, 4) : sql.VarChar, CUBAGEM || null);
      request.input('OBSERV', OBSERV?.trim() || null);
      request.input('FGRASTREADO', FGRASTREADO || 'N');
      request.input('MOEDA', (MOEDA && String(MOEDA).trim().substring(0, 3)) || 'BRL');
      request.input('SGUSERINCLUSAO', sgUser);
      request.input('DHINCLUSAO', new Date());
      request.input('TENANT_ID', tenantIdForRequest(req));

      await request.query(`
        INSERT INTO [dbo].[VIAGEMMESTRE] (
          [IDVIAGEM], [FGSITVIAGEM], [CDSITUACAOVIAGEM], [CDTIPOVIAGEM], [CDCONTRATADOR],
          [CDCLASSEFROTA], [DTPREVINICIO], [DTPREVFINAL], [IDROTEIRO], [DISTANCIAKM],
          [VLFRETE], [PESO], [CUBAGEM], [OBSERV], [FGRASTREADO], [MOEDA], [SGUSERINCLUSAO], [DHINCLUSAO],
          [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID]
        )
        VALUES (
          @IDVIAGEM, @FGSITVIAGEM, @CDSITUACAOVIAGEM, @CDTIPOVIAGEM, @CDCONTRATADOR,
          @CDCLASSEFROTA, @DTPREVINICIO, @DTPREVFINAL, @IDROTEIRO, @DISTANCIAKM,
          @VLFRETE, @PESO, @CUBAGEM, @OBSERV, @FGRASTREADO, @MOEDA, @SGUSERINCLUSAO, @DHINCLUSAO,
          'A', GETDATE(), @SGUSERINCLUSAO, 'AppDVcargas', @TENANT_ID
        )
      `);

      res.status(201).json({
        success: true,
        message: 'Viagem cadastrada com sucesso!',
        IDVIAGEM: novoId
      });
    } catch (err) {
      console.error('Erro ao inserir viagem:', err);
      res.status(500).json({ error: 'Erro ao cadastrar viagem.' });
    }
  },

  // Atualizar viagem
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        FGSITVIAGEM, CDSITUACAOVIAGEM, CDTIPOVIAGEM, CDCONTRATADOR,
        CDCLASSEFROTA, DTPREVINICIO, DTPREVFINAL, IDROTEIRO, DISTANCIAKM,
        VLFRETE, PESO, CUBAGEM, OBSERV, FGACTIVE, FGRASTREADO, MOEDA
      } = req.body;

      const faltando = [];
      if (!FGSITVIAGEM) faltando.push('FGSITVIAGEM (situação)');
      if (!CDSITUACAOVIAGEM) faltando.push('CDSITUACAOVIAGEM (cód. situação)');
      if (!CDTIPOVIAGEM) faltando.push('CDTIPOVIAGEM (tipo de viagem)');
      if (!FGACTIVE) faltando.push('FGACTIVE (ativo)');
      if (faltando.length > 0) {
        return res.status(400).json({
          error: 'Campos obrigatórios não preenchidos.',
          camposRequeridos: faltando
        });
      }

      const sgUserUpd = getSgUser(req);
      if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      const idNumerico = parseFloat(id);

      const request = pool.request();
      request.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);
      request.input('FGSITVIAGEM', FGSITVIAGEM);
      request.input('CDSITUACAOVIAGEM', sql.SmallInt, CDSITUACAOVIAGEM);
      request.input('CDTIPOVIAGEM', sql.Int, CDTIPOVIAGEM);
      request.input('CDCONTRATADOR', CDCONTRATADOR ? sql.Decimal(15, 0) : sql.VarChar, CDCONTRATADOR || null);
      request.input('CDCLASSEFROTA', CDCLASSEFROTA ? sql.SmallInt : sql.VarChar, CDCLASSEFROTA || null);
      request.input('DTPREVINICIO', DTPREVINICIO ? sql.SmallDateTime : sql.VarChar, DTPREVINICIO || null);
      request.input('DTPREVFINAL', DTPREVFINAL ? sql.SmallDateTime : sql.VarChar, DTPREVFINAL || null);
      request.input('IDROTEIRO', IDROTEIRO ? sql.Decimal(15, 0) : sql.VarChar, IDROTEIRO || null);
      request.input('DISTANCIAKM', DISTANCIAKM ? sql.Decimal(15, 4) : sql.VarChar, DISTANCIAKM || null);
      request.input('VLFRETE', VLFRETE ? sql.Decimal(15, 4) : sql.VarChar, VLFRETE || null);
      request.input('PESO', PESO ? sql.Decimal(15, 4) : sql.VarChar, PESO || null);
      request.input('CUBAGEM', CUBAGEM ? sql.Decimal(15, 4) : sql.VarChar, CUBAGEM || null);
      request.input('OBSERV', OBSERV?.trim() || null);
      request.input('FGACTIVE', FGACTIVE === 'S' ? 'A' : 'I');
      request.input('FGRASTREADO', FGRASTREADO || 'N');
      request.input('MOEDA', (MOEDA != null && MOEDA !== '') ? String(MOEDA).trim().substring(0, 3) : null);
      request.input('sgUser', sql.VarChar(50), sgUserUpd);
      request.input('TENANT_ID', tenantIdForRequest(req));

      await request.query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET 
          [FGSITVIAGEM] = @FGSITVIAGEM,
          [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM,
          [CDTIPOVIAGEM] = @CDTIPOVIAGEM,
          [CDCONTRATADOR] = @CDCONTRATADOR,
          [CDCLASSEFROTA] = @CDCLASSEFROTA,
          [DTPREVINICIO] = @DTPREVINICIO,
          [DTPREVFINAL] = @DTPREVFINAL,
          [IDROTEIRO] = @IDROTEIRO,
          [DISTANCIAKM] = @DISTANCIAKM,
          [VLFRETE] = @VLFRETE,
          [PESO] = @PESO,
          [CUBAGEM] = @CUBAGEM,
          [OBSERV] = @OBSERV,
          [FGACTIVE] = @FGACTIVE,
          [FGRASTREADO] = @FGRASTREADO,
          [MOEDA] = COALESCE(@MOEDA, [MOEDA], 'BRL'),
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @sgUser,
          [SERVERORIG] = 'AppDVcargas'
        WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      `);

      // Emitir evento WebSocket para atualização de viagem
      try {
        const websocketTorre = req.app.get('websocketTorre');
        if (websocketTorre) {
          // Buscar dados atualizados da viagem
          const viagemAtualizada = await pool
            .request()
            .input('IDVIAGEM', sql.Decimal(15, 0), idNumerico)
            .input('TENANT_ID', tenantIdForRequest(req))
            .query(`
              SELECT 
                [v].[IDVIAGEM],
                [v].[FGSITVIAGEM],
                [v].[CDSITUACAOVIAGEM],
                [s].[DSSITUACAOVIAGEM],
                [v].[CDTIPOVIAGEM],
                [t].[DSTIPOVIAGEM],
                [v].[FGACTIVE],
                [v].[CDCLASSEFROTA],
                [cf].[DSCLASSEFROTA],
                [v].[DTPREVINICIO],
                [v].[DTPREVFINAL],
                [v].[IDROTEIRO],
                [r].[DSROTEIRO],
            [v].[DISTANCIAKM],
            [v].[VLFRETE],
            COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
            [v].[PESO],
            [v].[CUBAGEM],
            [v].[OBSERV],
                [co].[ESTADO] AS ORIGEM_ESTADO,
                [co].[NMCIDADE] AS ORIGEM_CIDADE,
                [cd].[ESTADO] AS DESTINO_ESTADO,
                [cd].[NMCIDADE] AS DESTINO_CIDADE,
                CASE 
                  WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [TENANT_ID] = [v].[TENANT_ID] AND [STATUS] = 'CONFIRMADA') THEN 'S'
                  ELSE 'N'
                END AS TEM_CONFIRMADO
              FROM [dbo].[VIAGEMMESTRE] v
              LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
                AND ([s].[TENANT_ID] = [v].[TENANT_ID] OR [s].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[TIPOVIAGEM] t ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
                AND ([t].[TENANT_ID] = [v].[TENANT_ID] OR [t].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[CLASSEFROTA] cf ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
                AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
              LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
              WHERE [v].[IDVIAGEM] = @IDVIAGEM AND [v].[TENANT_ID] = @TENANT_ID
            `);

          if (viagemAtualizada.recordset && viagemAtualizada.recordset[0]) {
            const dadosViagem = viagemAtualizada.recordset[0];
            websocketTorre.emitirAtualizacaoViagem(idNumerico, dadosViagem);
          }
        }
      } catch (wsError) {
        // Não interromper resposta se WebSocket falhar
        console.warn('⚠️ Erro ao emitir evento WebSocket de atualização de viagem:', wsError.message);
      }

      res.json({ success: true, message: 'Viagem atualizada com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar viagem:', err);
      res.status(500).json({ error: 'Erro ao atualizar viagem.' });
    }
  },

  // Buscar viagem por ID
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .input('TENANT_ID', tenantIdForRequest(req))
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[FGSITVIAGEM],
            [v].[CDSITUACAOVIAGEM],
            [v].[CDTIPOVIAGEM],
            [v].[SGUSERINCLUSAO],
            [v].[DHINCLUSAO],
            [v].[CDCONTRATADOR],
            [v].[FGACTIVE],
            [v].[CDCLASSEFROTA],
            [v].[DTPREVINICIO],
            [v].[DTPREVFINAL],
            [v].[IDROTEIRO],
            [v].[DISTANCIAKM],
            [v].[VLFRETE],
            COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
            [v].[PESO],
            [v].[CUBAGEM],
            [v].[OBSERV],
            [v].[FGRASTREADO],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO],
            [r].[DSROTEIRO],
            [co].[ESTADO] AS ORIGEM_ESTADO,
            [co].[NMCIDADE] AS ORIGEM_CIDADE,
            [po].[SGPAIS] AS ORIGEM_PAIS,
            [cd].[ESTADO] AS DESTINO_ESTADO,
            [cd].[NMCIDADE] AS DESTINO_CIDADE,
            [pd].[SGPAIS] AS DESTINO_PAIS,
            [cf].[DSCLASSEFROTA],
            [tv].[DSTIPOVIAGEM],
            upper(COALESCE(NULLIF(TRIM([cg].[RZSOCIAL]), ''), TRIM([cg].[NMFANTASIA]))) AS CONTRATADOR_NOME
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[PAIS] [po] ON [co].[CDPAIS] = [po].[CDPAIS]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[PAIS] [pd] ON [cd].[CDPAIS] = [pd].[CDPAIS]
          LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
            AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[TIPOVIAGEM] [tv] ON [v].[CDTIPOVIAGEM] = [tv].[CDTIPOVIAGEM]
            AND ([tv].[TENANT_ID] = [v].[TENANT_ID] OR [tv].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
          WHERE [v].[IDVIAGEM] = @IDVIAGEM AND [v].[TENANT_ID] = @TENANT_ID
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const v = result.recordset[0];
      // PostgreSQL retorna colunas em minúsculas; aceitar ambos os formatos
      const get = (obj, ...keys) => {
        for (const k of keys) {
          if (obj[k] !== undefined && obj[k] !== null) return obj[k];
          const lower = k.toLowerCase();
          if (obj[lower] !== undefined && obj[lower] !== null) return obj[lower];
        }
        return undefined;
      };
      res.json({
        IDVIAGEM: v.IDVIAGEM ?? v.idviagem,
        FGSITVIAGEM: v.FGSITVIAGEM ?? v.fgsitviagem,
        CDSITUACAOVIAGEM: v.CDSITUACAOVIAGEM ?? v.cdsituacaoviagem,
        CDTIPOVIAGEM: v.CDTIPOVIAGEM ?? v.cdtipoviagem,
        DSTIPOVIAGEM: v.DSTIPOVIAGEM ?? v.dstipoviagem,
        SGUSERINCLUSAO: v.SGUSERINCLUSAO ?? v.sguserinclusao,
        DHINCLUSAO: v.DHINCLUSAO ?? v.dhinclusao,
        CDCONTRATADOR: v.CDCONTRATADOR ?? v.cdcontratador,
        CONTRATADOR_NOME: v.CONTRATADOR_NOME ?? v.contratador_nome,
        FGACTIVE: (v.FGACTIVE ?? v.fgactive) === 'A' ? 'S' : 'N',
        CDCLASSEFROTA: v.CDCLASSEFROTA ?? v.cdclassefrota,
        DSCLASSEFROTA: v.DSCLASSEFROTA ?? v.dsclassefrota,
        DTPREVINICIO: v.DTPREVINICIO ?? v.dtprevinicio,
        DTPREVFINAL: v.DTPREVFINAL ?? v.dtprevfinal,
        IDROTEIRO: v.IDROTEIRO ?? v.idroteiro,
        DSROTEIRO: v.DSROTEIRO ?? v.dsroteiro,
        DISTANCIAKM: v.DISTANCIAKM ?? v.distanciakm,
        VLFRETE: v.VLFRETE ?? v.vlfrete,
        MOEDA: (v.MOEDA ?? v.moeda) || 'BRL',
        PESO: v.PESO ?? v.peso,
        CUBAGEM: v.CUBAGEM ?? v.cubagem,
        OBSERV: v.OBSERV ?? v.observ,
        FGRASTREADO: (v.FGRASTREADO ?? v.fgrastreado) || 'N',
        ORIGEM_ESTADO: get(v, 'ORIGEM_ESTADO'),
        ORIGEM_CIDADE: get(v, 'ORIGEM_CIDADE'),
        ORIGEM_CODIGO: v.CDCIDADEORIGEM ?? v.cdcidadeorigem,
        ORIGEM_PAIS: get(v, 'ORIGEM_PAIS'),
        DESTINO_ESTADO: get(v, 'DESTINO_ESTADO'),
        DESTINO_CIDADE: get(v, 'DESTINO_CIDADE'),
        DESTINO_CODIGO: v.CDCIDADEDESTINO ?? v.cdcidadedestino,
        DESTINO_PAIS: get(v, 'DESTINO_PAIS')
      });
    } catch (err) {
      console.error('Erro ao buscar viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar viagem.' });
    }
  },

  // Excluir viagem (lógica)
  excluir: async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.query;
      const pool = await poolPromise;

      // Validação do ID
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      const idNumerico = parseFloat(id);
      if (isNaN(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      // Verificar status atual
      const checkRequest = pool.request();
      checkRequest.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);
      checkRequest.input('TENANT_ID', tenantIdForRequest(req));

      const checkResult = await checkRequest.query(`
        SELECT [FGACTIVE] FROM [dbo].[VIAGEMMESTRE] WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
      `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const rowChk = checkResult.recordset[0] || {};
      const statusAtual = rowChk.FGACTIVE ?? rowChk.fgactive;
      const estaAtivo = statusAtual === 'A';

      // Determinar nova situação
      let novaSituacao, mensagem;
      if (action === 'activate') {
        novaSituacao = 'A';
        mensagem = 'Viagem reativada com sucesso!';
      } else if (action === 'deactivate') {
        novaSituacao = 'I';
        mensagem = 'Viagem desativada com sucesso!';
      } else {
        novaSituacao = estaAtivo ? 'I' : 'A';
        mensagem = estaAtivo ? 'Viagem desativada com sucesso!' : 'Viagem reativada com sucesso!';
      }

      const tid = tenantIdForRequest(req);
      const sgUserStatus = getSgUser(req);
      if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      /** Inativar = FGACTIVE I + situação Cancelada (FGSITVIAGEM = C); guarda CDSIT/FG anteriores em PREV_* se as colunas existirem. */
      if (novaSituacao === 'I') {
        const rSit = await pool.query(
          `SELECT s."CDSITUACAOVIAGEM", s."FGSITVIAGEM"
             FROM "SITUACAOVIAGEM" s
            WHERE (s."TENANT_ID" = $1 OR s."TENANT_ID" = 'default')
              AND (s."FGACTIVE" IN ('A', 'S', 'T'))
              AND upper(trim(s."FGSITVIAGEM"::text)) = 'C'
            ORDER BY CASE WHEN s."TENANT_ID" = $1 THEN 0 ELSE 1 END, s."CDSITUACAOVIAGEM" ASC
            LIMIT 1`,
          [tid]
        );
        if (!rSit.rows.length) {
          return res.status(400).json({
            error:
              'Não há situação de viagem ativa com código Cancelada (FGSITVIAGEM = C). Cadastre em Gerenciar Situações de Viagem.',
          });
        }
        const rowS = rSit.rows[0] || {};
        const cdCanc = Number(rowS.CDSITUACAOVIAGEM ?? rowS.cdsituacaoviagem);
        const fgCanc = String(rowS.FGSITVIAGEM ?? rowS.fgsitviagem ?? 'C')
          .trim()
          .toUpperCase()
          .slice(0, 1);
        if (!Number.isFinite(cdCanc)) {
          return res.status(400).json({ error: 'Situação Cancelada inválida no cadastro (CDSITUACAOVIAGEM).' });
        }
        const sqlComPrev = `
          UPDATE "VIAGEMMESTRE" SET
            "PREV_CDSIT_INAT" = "CDSITUACAOVIAGEM",
            "PREV_FGSIT_INAT" = "FGSITVIAGEM",
            "FGACTIVE" = $1::char,
            "CDSITUACAOVIAGEM" = $5::integer,
            "FGSITVIAGEM" = $6::char,
            "DHMAINTENANCE" = CURRENT_TIMESTAMP,
            "SGUSER" = $4,
            "SERVERORIG" = 'AppDVcargas'
           WHERE "IDVIAGEM" = $2::numeric AND "TENANT_ID" = $3`;
        const sqlSemPrev = `
          UPDATE "VIAGEMMESTRE" SET
            "FGACTIVE" = $1::char,
            "CDSITUACAOVIAGEM" = $5::integer,
            "FGSITVIAGEM" = $6::char,
            "DHMAINTENANCE" = CURRENT_TIMESTAMP,
            "SGUSER" = $4,
            "SERVERORIG" = 'AppDVcargas'
           WHERE "IDVIAGEM" = $2::numeric AND "TENANT_ID" = $3`;
        const paramsUp = [novaSituacao, idNumerico, tid, sgUserStatus, cdCanc, fgCanc];
        let rUp;
        try {
          rUp = await pool.query(sqlComPrev, paramsUp);
        } catch (eI) {
          if (eI && eI.code === '42703') {
            rUp = await pool.query(sqlSemPrev, paramsUp);
          } else {
            throw eI;
          }
        }
        if ((rUp.rowCount ?? 0) === 0) {
          return res.status(404).json({ error: 'Viagem não encontrada.' });
        }
        mensagem = 'Viagem inativada e marcada como Cancelada.';
      } else {
        let pr = {};
        try {
          const rPrev = await pool.query(
            `SELECT "PREV_CDSIT_INAT", "PREV_FGSIT_INAT"
               FROM "VIAGEMMESTRE"
              WHERE "IDVIAGEM" = $1::numeric AND "TENANT_ID" = $2`,
            [idNumerico, tid]
          );
          pr = rPrev.rows[0] || {};
        } catch (eSel) {
          if (!(eSel && eSel.code === '42703')) throw eSel;
        }
        const cdPv = pr.PREV_CDSIT_INAT ?? pr.prev_cdsit_inat;
        const fgPv = pr.PREV_FGSIT_INAT ?? pr.prev_fgsit_inat;
        const hasPrev =
          cdPv != null &&
          fgPv != null &&
          String(fgPv).trim() !== '' &&
          Number.isFinite(Number(cdPv));
        let cdUse;
        let fgUse;
        if (hasPrev) {
          cdUse = Math.floor(Number(cdPv));
          fgUse = String(fgPv).trim().toUpperCase().slice(0, 1);
        } else {
          const rD = await pool.query(
            `SELECT s."CDSITUACAOVIAGEM", s."FGSITVIAGEM"
               FROM "SITUACAOVIAGEM" s
              WHERE (s."TENANT_ID" = $1 OR s."TENANT_ID" = 'default')
                AND (s."FGACTIVE" IN ('A', 'S', 'T'))
                AND upper(trim(s."FGSITVIAGEM"::text)) = 'D'
              ORDER BY CASE WHEN s."TENANT_ID" = $1 THEN 0 ELSE 1 END, s."CDSITUACAOVIAGEM" ASC
              LIMIT 1`,
            [tid]
          );
          if (!rD.rows.length) {
            return res.status(400).json({
              error:
                'Não há situação de viagem ativa com código Preparação (FGSITVIAGEM = D). Cadastre em Gerenciar Situações de Viagem.',
            });
          }
          const rowD = rD.rows[0] || {};
          cdUse = Number(rowD.CDSITUACAOVIAGEM ?? rowD.cdsituacaoviagem);
          fgUse = String(rowD.FGSITVIAGEM ?? rowD.fgsitviagem ?? 'D').trim().toUpperCase().slice(0, 1);
        }
        if (!Number.isFinite(cdUse)) {
          return res.status(400).json({ error: 'Situação para reativação inválida (CDSITUACAOVIAGEM).' });
        }
        const sqlReativComPrev = `
          UPDATE "VIAGEMMESTRE" SET
            "FGACTIVE" = $1::char,
            "CDSITUACAOVIAGEM" = $5::integer,
            "FGSITVIAGEM" = $6::char,
            "PREV_CDSIT_INAT" = NULL,
            "PREV_FGSIT_INAT" = NULL,
            "DHMAINTENANCE" = CURRENT_TIMESTAMP,
            "SGUSER" = $4,
            "SERVERORIG" = 'AppDVcargas'
           WHERE "IDVIAGEM" = $2::numeric AND "TENANT_ID" = $3`;
        const sqlReativSemPrevCols = `
          UPDATE "VIAGEMMESTRE" SET
            "FGACTIVE" = $1::char,
            "CDSITUACAOVIAGEM" = $5::integer,
            "FGSITVIAGEM" = $6::char,
            "DHMAINTENANCE" = CURRENT_TIMESTAMP,
            "SGUSER" = $4,
            "SERVERORIG" = 'AppDVcargas'
           WHERE "IDVIAGEM" = $2::numeric AND "TENANT_ID" = $3`;
        const paramsRe = [novaSituacao, idNumerico, tid, sgUserStatus, cdUse, fgUse];
        let rUp;
        try {
          rUp = await pool.query(sqlReativComPrev, paramsRe);
        } catch (eA) {
          if (eA && eA.code === '42703') {
            rUp = await pool.query(sqlReativSemPrevCols, paramsRe);
          } else {
            throw eA;
          }
        }
        if ((rUp.rowCount ?? 0) === 0) {
          return res.status(404).json({ error: 'Viagem não encontrada.' });
        }
        mensagem = hasPrev
          ? 'Viagem reativada; situação restaurada à anterior ao cancelamento.'
          : 'Viagem reativada; situação definida como Preparação (sem registro da situação anterior).';
      }

      res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
    } catch (err) {
      console.error('Erro ao alterar status da viagem:', err);
      res.status(500).json({ error: 'Erro ao alterar status da viagem.' });
    }
  },

  // Listar combos
  listarTiposViagem: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tenantId = tenantIdForRequest(req);
      const result = await pool.query(
        `SELECT "CDTIPOVIAGEM", "DSTIPOVIAGEM" FROM "TIPOVIAGEM"
         WHERE ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')
           AND ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
         ORDER BY "DSTIPOVIAGEM"`,
        [tenantId]
      );
      const rows = (result.rows || []).map((r) => ({
        CDTIPOVIAGEM: r.CDTIPOVIAGEM ?? r.cdtipoviagem,
        DSTIPOVIAGEM: r.DSTIPOVIAGEM ?? r.dstipoviagem
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar tipos de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar tipos de viagem.' });
    }
  },

  listarSituacoesViagem: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tenantId = tenantIdForRequest(req);
      const result = await pool.query(
        `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM" FROM "SITUACAOVIAGEM"
         WHERE ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')
           AND ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
         ORDER BY "DSSITUACAOVIAGEM"`,
        [tenantId]
      );
      const rows = (result.rows || []).map((r) => ({
        CDSITUACAOVIAGEM: r.CDSITUACAOVIAGEM ?? r.cdsituacaoviagem,
        DSSITUACAOVIAGEM: r.DSSITUACAOVIAGEM ?? r.dssituacaoviagem
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar situações de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar situações de viagem.' });
    }
  },

  listarClassesFrota: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tenantId = tenantIdForRequest(req);
      const result = await pool.query(
        `SELECT "CDCLASSEFROTA", "DSCLASSEFROTA" FROM "CLASSEFROTA"
         WHERE ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S')
           AND ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
         ORDER BY "DSCLASSEFROTA"`,
        [tenantId]
      );
      const rows = (result.rows || []).map((r) => ({
        CDCLASSEFROTA: r.CDCLASSEFROTA ?? r.cdclassefrota,
        DSCLASSEFROTA: r.DSCLASSEFROTA ?? r.dsclassefrota
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar classes de frota:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  listarContratadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const { apenasComConvocacoes } = req.query;

      const normalizarLinha = (row) => ({
        CDCADASTRO: row.CDCADASTRO ?? row.cdcadastro,
        RZSOCIAL: (row.RZSOCIAL ?? row.rzsocial ?? '').toString()
      });

      const runQueryPrincipal = async () => {
        if (apenasComConvocacoes === 'true') {
          const result = await pool.request().query(`
            SELECT DISTINCT 
              cg."CDCADASTRO", 
              upper(cg."RZSOCIAL") AS "RZSOCIAL"  
            FROM "CADASTROGERAL" cg
            INNER JOIN "VIAGEMMESTRE" v ON cg."CDCADASTRO" = v."CDCONTRATADOR"
            INNER JOIN "CONVOCACAO" c ON v."IDVIAGEM" = c."IDVIAGEM"
            WHERE (cg."FGPROGRAMADOR" = 'S' OR (cg."FGPROGRAMADOR" IS NULL AND cg."FGTIPOCADASTRO" = 'O'))
              AND cg."FGACTIVE" = 'A'
            ORDER BY upper(cg."RZSOCIAL")
          `);
          return (result.recordset || []).map(normalizarLinha);
        }
        const result = await pool.request().query(`
          SELECT "CDCADASTRO", upper("RZSOCIAL") AS "RZSOCIAL" 
          FROM "CADASTROGERAL" 
          WHERE ("FGPROGRAMADOR" = 'S' OR ("FGPROGRAMADOR" IS NULL AND "FGTIPOCADASTRO" = 'O'))
            AND "FGACTIVE" = 'A' 
          ORDER BY "RZSOCIAL"
        `);
        return (result.recordset || []).map(normalizarLinha);
      };

      const runQueryLegado = async () => {
        const result = await pool.request().query(`
          SELECT "CDCADASTRO", upper("RZSOCIAL") AS "RZSOCIAL" 
          FROM "CADASTROGERAL" 
          WHERE "FGTIPOCADASTRO" = 'O' AND "FGACTIVE" = 'A' 
          ORDER BY "RZSOCIAL"
        `);
        return (result.recordset || []).map(normalizarLinha);
      };

      let rows;
      try {
        rows = await runQueryPrincipal();
      } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('fgprogramador') || msg.includes('column') && msg.includes('does not exist')) {
          rows = await runQueryLegado();
        } else {
          throw err;
        }
      }

      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar contratadores:', err);
      res.status(500).json({ error: 'Erro ao carregar contratadores.' });
    }
  },

  listarMotivosRecusa: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDMOTIVO], [DSMOTIVO] FROM [dbo].[MOTIVORECUSA] WHERE [FGACTIVE] = \'A\' ORDER BY [DSMOTIVO]');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar motivos de recusa:', err);
      res.status(500).json({ error: 'Erro ao carregar motivos de recusa.' });
    }
  },

  listarMotivosReabertura: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDMOTIVO], [DSMOTIVO] FROM [dbo].[MOTIVOREABERTURA] WHERE [FGACTIVE] = \'A\' ORDER BY [DSMOTIVO]');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar motivos de reabertura:', err);
      res.status(500).json({ error: 'Erro ao carregar motivos de reabertura.' });
    }
  },

  listarRoteiros: async (req, res) => {
    try {
      const { origem, destino, roteiro, origemPais, origemEstado, destinoPais, destinoEstado } = req.query;
      let query = `
        SELECT [r].[IDROTEIRO], [r].[DSROTEIRO], [r].[DISTANCIAKM],
               [r].[CDCIDADEORIGEM] AS ORIGEM_CODIGO,
               [co].[ESTADO] AS ORIGEM_ESTADO, [co].[NMCIDADE] AS ORIGEM_CIDADE,
               [po].[SGPAIS] AS ORIGEM_PAIS,
               [r].[CDCIDADEDESTINO] AS DESTINO_CODIGO,
               [cd].[ESTADO] AS DESTINO_ESTADO, [cd].[NMCIDADE] AS DESTINO_CIDADE,
               [pd].[SGPAIS] AS DESTINO_PAIS
        FROM [dbo].[ROTEIRO] r
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[PAIS] [po] ON [co].[CDPAIS] = [po].[CDPAIS]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        LEFT JOIN [dbo].[PAIS] [pd] ON [cd].[CDPAIS] = [pd].[CDPAIS]
        WHERE 1=1
          AND ([r].[TENANT_ID] = @TENANT_ID OR [r].[TENANT_ID] = 'default')
      `;

      const params = [];
      params.push({ name: 'TENANT_ID', value: tenantIdForRequest(req) });
      const origemNum = origem != null && origem !== '' ? parseInt(origem, 10) : NaN;
      const destinoNum = destino != null && destino !== '' ? parseInt(destino, 10) : NaN;
      const op = (origemPais != null && String(origemPais).trim() !== '') ? String(origemPais).trim().toUpperCase() : '';
      const oe = (origemEstado != null && String(origemEstado).trim() !== '') ? String(origemEstado).trim() : '';
      const dp = (destinoPais != null && String(destinoPais).trim() !== '') ? String(destinoPais).trim().toUpperCase() : '';
      const de = (destinoEstado != null && String(destinoEstado).trim() !== '') ? String(destinoEstado).trim() : '';

      if (!isNaN(origemNum)) {
        query += ` AND [r].[CDCIDADEORIGEM] = @ORIGEM`;
        params.push({ name: 'ORIGEM', value: origemNum });
      } else if (oe) {
        query += ` AND [co].[ESTADO] = @ORIGEM_ESTADO`;
        params.push({ name: 'ORIGEM_ESTADO', value: oe });
        if (op) {
          query += ` AND [po].[SGPAIS] = @ORIGEM_PAIS`;
          params.push({ name: 'ORIGEM_PAIS', value: op });
        }
      } else if (op) {
        query += ` AND [po].[SGPAIS] = @ORIGEM_PAIS`;
        params.push({ name: 'ORIGEM_PAIS', value: op });
      }

      if (!isNaN(destinoNum)) {
        query += ` AND [r].[CDCIDADEDESTINO] = @DESTINO`;
        params.push({ name: 'DESTINO', value: destinoNum });
      } else if (de) {
        query += ` AND [cd].[ESTADO] = @DESTINO_ESTADO`;
        params.push({ name: 'DESTINO_ESTADO', value: de });
        if (dp) {
          query += ` AND [pd].[SGPAIS] = @DESTINO_PAIS`;
          params.push({ name: 'DESTINO_PAIS', value: dp });
        }
      } else if (dp) {
        query += ` AND [pd].[SGPAIS] = @DESTINO_PAIS`;
        params.push({ name: 'DESTINO_PAIS', value: dp });
      }

      if (roteiro) {
        const roteiroNum = parseInt(roteiro, 10);
        if (!isNaN(roteiroNum)) {
          query += ` AND [r].[IDROTEIRO] = @ROTEIRO`;
          params.push({ name: 'ROTEIRO', value: roteiroNum });
        }
      }

      query += ` ORDER BY [r].[IDROTEIRO]`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => {
        // Proteção: garantir que o valor não seja um objeto
        let valor = p.value;
        if (typeof valor === 'object' && valor !== null && !(valor instanceof Date)) {
          console.error(`[BUSCAR VIAGEM] ⚠️ AVISO: Parâmetro ${p.name} é um objeto! Convertendo para string.`, valor);
          valor = JSON.stringify(valor);
        }
        request.input(p.name, valor);
      });

      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar roteiros:', err);
      res.status(500).json({ error: 'Erro ao carregar roteiros.' });
    }
  },

  listarEstadosBrasil: (req, res) => {
    const ESTADOS_BRASIL = [
      { uf: "AC", nome: "Acre" },
      { uf: "AL", nome: "Alagoas" },
      { uf: "AP", nome: "Amapá" },
      { uf: "AM", nome: "Amazonas" },
      { uf: "BA", nome: "Bahia" },
      { uf: "CE", nome: "Ceará" },
      { uf: "DF", nome: "Distrito Federal" },
      { uf: "ES", nome: "Espírito Santo" },
      { uf: "GO", nome: "Goiás" },
      { uf: "MA", nome: "Maranhão" },
      { uf: "MT", nome: "Mato Grosso" },
      { uf: "MS", nome: "Mato Grosso do Sul" },
      { uf: "MG", nome: "Minas Gerais" },
      { uf: "PA", nome: "Pará" },
      { uf: "PB", nome: "Paraíba" },
      { uf: "PR", nome: "Paraná" },
      { uf: "PE", nome: "Pernambuco" },
      { uf: "PI", nome: "Piauí" },
      { uf: "RJ", nome: "Rio de Janeiro" },
      { uf: "RN", nome: "Rio Grande do Norte" },
      { uf: "RS", nome: "Rio Grande do Sul" },
      { uf: "RO", nome: "Rondônia" },
      { uf: "RR", nome: "Roraima" },
      { uf: "SC", nome: "Santa Catarina" },
      { uf: "SP", nome: "São Paulo" },
      { uf: "SE", nome: "Sergipe" },
      { uf: "TO", nome: "Tocantins" }
    ];
    res.json(ESTADOS_BRASIL);
  },

  listarCidadesPorEstado: async (req, res) => {
    try {
      const { estado } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('ESTADO', estado)
        .query('SELECT [CDCIDADE], [NMCIDADE] FROM [dbo].[CIDADE] WHERE [ESTADO] = @ESTADO AND [FGACTIVE] = \'A\' ORDER BY [NMCIDADE]');
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar cidades por estado:', err);
      res.status(500).json({ error: 'Erro ao carregar cidades.' });
    }
  },

  // Listar viagens com pendências de contratação (sem veículos atribuídos)
  listarViagensPendentes: async (req, res) => {
    try {
      const pool = await poolPromise;
      const query = `
        SELECT 
          [v].[IDVIAGEM],
          [v].[FGSITVIAGEM],
          [v].[CDSITUACAOVIAGEM],
          [s].[DSSITUACAOVIAGEM],
          [v].[CDTIPOVIAGEM],
          [t].[DSTIPOVIAGEM],
          [v].[CDCONTRATADOR],
          upper([cg].[RZSOCIAL]) AS CONTRATADOR_NOME,
          [v].[CDCLASSEFROTA],
          [cf].[DSCLASSEFROTA],
          [v].[FGRASTREADO],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[VLFRETE],
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[CDCIDADE] AS ORIGEM_CODIGO,
          [co].[CDMICROREGIAO] AS ORIGEM_MICROREGIAO,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[CDCIDADE] AS DESTINO_CODIGO,
          [cd].[CDMICROREGIAO] AS DESTINO_MICROREGIAO
        FROM [dbo].[VIAGEMMESTRE] [v]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [s] ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
          AND ([s].[TENANT_ID] = [v].[TENANT_ID] OR [s].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] [t] ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
          AND ([t].[TENANT_ID] = [v].[TENANT_ID] OR [t].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
          AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [v].[FGACTIVE] = 'A'
          AND [v].[FGSITVIAGEM] IN ('P', 'D')
          AND [v].[TENANT_ID] = @TENANT_ID
          AND NOT EXISTS (
            SELECT 1 
            FROM [dbo].[CONVOCACAO] [c] 
            WHERE [c].[IDVIAGEM] = [v].[IDVIAGEM] 
              AND [c].[TENANT_ID] = [v].[TENANT_ID]
              AND [c].[STATUS] IN ('ACEITA', 'CONFIRMADA')
          )
        ORDER BY [v].[DTPREVINICIO] DESC
      `;

      const result = await pool.request().input('TENANT_ID', tenantIdForRequest(req)).query(query);
      // Normalizar chaves para o frontend (PostgreSQL pode retornar minúsculas)
      const get = (row, ...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null) return row[k];
          const lower = k.toLowerCase();
          if (row[lower] !== undefined && row[lower] !== null) return row[lower];
        }
        return undefined;
      };
      const rows = (result.recordset || []).map(row => ({
        ...row,
        IDVIAGEM: row.IDVIAGEM ?? row.idviagem,
        ORIGEM_ESTADO: get(row, 'ORIGEM_ESTADO'),
        ORIGEM_CIDADE: get(row, 'ORIGEM_CIDADE'),
        DESTINO_ESTADO: get(row, 'DESTINO_ESTADO'),
        DESTINO_CIDADE: get(row, 'DESTINO_CIDADE'),
        DSCLASSEFROTA: row.DSCLASSEFROTA ?? row.dsclassefrota
      }));
      res.json(rows);
    } catch (err) {
      console.error('Erro ao listar viagens pendentes:', err);
      res.status(500).json({ error: 'Erro ao carregar viagens pendentes.' });
    }
  },

  // Buscar motoristas compatíveis com uma viagem
  buscarMotoristasCompatíveis: async (req, res) => {
    try {
      const { idViagem } = req.params;

      if (!idViagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório.' });
      }

      const pool = await poolPromise;

      // Primeiro, buscar os dados da viagem (incluindo contratador)
      const viagemResult = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
        .input('TENANT_ID', tenantIdForRequest(req))
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[CDCLASSEFROTA],
            [cfv].[DSCLASSEFROTA] AS [DSCLASSEFROTA_VIAGEM],
            [v].[FGRASTREADO],
            [v].[IDROTEIRO],
            [v].[CDCONTRATADOR],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO]
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CLASSEFROTA] AS [cfv] ON [cfv].[CDCLASSEFROTA] = [v].[CDCLASSEFROTA]
            AND ([cfv].[TENANT_ID] = [v].[TENANT_ID] OR [cfv].[TENANT_ID] = 'default')
          WHERE [v].[IDVIAGEM] = @IDVIAGEM AND [v].[TENANT_ID] = @TENANT_ID
        `);

      if (viagemResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const viagem = viagemResult.recordset[0];
      const getViagemCampo = (k) => (viagem[k] != null ? viagem[k] : viagem[String(k).toLowerCase()]);
      const CDCLASSEFROTA = getViagemCampo('CDCLASSEFROTA');
      const FGRASTREADO = getViagemCampo('FGRASTREADO');
      const CDCIDADEORIGEM = getViagemCampo('CDCIDADEORIGEM');
      const CDCIDADEDESTINO = getViagemCampo('CDCIDADEDESTINO');
      const IDROTEIRO = getViagemCampo('IDROTEIRO');
      const CDCONTRATADOR = getViagemCampo('CDCONTRATADOR');
      const viagemResumo = {
        IDVIAGEM: getViagemCampo('IDVIAGEM'),
        CDCLASSEFROTA,
        DSCLASSEFROTA_VIAGEM: getViagemCampo('DSCLASSEFROTA_VIAGEM'),
        FGRASTREADO,
      };

      // Regras de compatibilidade (liga/desliga) – lidas da CONFIGURACAO
      const regrasKeys = ['regra_compativel_rastreamento', 'regra_compativel_classe_frota', 'regra_compativel_local_embarque', 'regra_compativel_local_desembarque'];
      const regrasResult = await pool.query(
        `SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" = ANY($1::text[]) AND "TENANT_ID" = $2`,
        [regrasKeys, tenantIdForRequest(req)]
      );
      const regrasMap = {};
      (regrasResult.rows || []).forEach(r => { regrasMap[r.CHAVE || r.chave] = ((r.VALOR || r.valor) || 'S').toString().toUpperCase(); });
      // Mesmo critério de obterRegrasCompatibilidade: chave ausente em CONFIGURACAO = padrão 'S' (regra ligada).
      // Antes: regrasMap[k] === 'S' excluía chave ausente → UI mostrava ligado (GET) e a busca aplicava desligado (furo).
      const regra = (k) => ((regrasMap[k] || 'S').toString().toUpperCase() === 'S');
      const validarRastreamento = regra('regra_compativel_rastreamento');
      const validarClasseFrota = regra('regra_compativel_classe_frota');
      const validarLocalEmbarque = regra('regra_compativel_local_embarque');
      const validarLocalDesembarque = regra('regra_compativel_local_desembarque');

      // Buscar país (sigla), CDUF e CDMESOREGIAO das cidades de origem e destino (roteiro usa CDCIDADE; derivamos País/Estado/Mesorregião para validar com CADASTRO_LOCAL_PREFERIDO)
      const cidadesResult = await pool
        .request()
        .input('ORIGEM', CDCIDADEORIGEM || null)
        .input('DESTINO', CDCIDADEDESTINO || null)
        .query(`
          SELECT 
            [c].[CDCIDADE],
            [c].[CDMICROREGIAO],
            [c].[CDUF],
            [c].[CDMESOREGIAO],
            [c].[NMCIDADE],
            [c].[ESTADO],
            [p].[SGPAIS] AS [PAIS]
          FROM [dbo].[CIDADE] [c]
          LEFT JOIN [dbo].[PAIS] [p] ON [p].[CDPAIS] = [c].[CDPAIS]
          WHERE [c].[CDCIDADE] IN (@ORIGEM, @DESTINO)
        `);

      const microregioes = cidadesResult.recordset.map(c => ({
        cduf: c.CDUF,
        microregiao: c.CDMICROREGIAO
      })).filter(m => m.microregiao);

      const getVal = (row, key) => (row && (row[key] != null ? row[key] : row[key.toLowerCase && key.toLowerCase()]));
      const cidadeOrigem = (cidadesResult.recordset || []).find(c => getVal(c, 'CDCIDADE') == CDCIDADEORIGEM);
      const cidadeDestino = (cidadesResult.recordset || []).find(c => getVal(c, 'CDCIDADE') == CDCIDADEDESTINO);
      // Origem: país (sigla 2 letras, alinhado a CADASTRO_LOCAL_PREFERIDO.PAIS)
      const rawOrigemPais = CDCIDADEORIGEM ? (getVal(cidadeOrigem, 'PAIS') || getVal(cidadeOrigem, 'SGPAIS') || 'BR') : '';
      const origemPais = rawOrigemPais ? String(rawOrigemPais).trim().toUpperCase().substring(0, 2) : '';
      const origemCduf = cidadeOrigem != null ? (getVal(cidadeOrigem, 'CDUF') ?? null) : null;
      const origemCmesoregiao = cidadeOrigem != null ? (getVal(cidadeOrigem, 'CDMESOREGIAO') ?? null) : null;
      const destinoPaisRaw = CDCIDADEDESTINO ? (getVal(cidadeDestino, 'PAIS') || getVal(cidadeDestino, 'SGPAIS') || 'BR') : '';
      const destinoPais = destinoPaisRaw ? String(destinoPaisRaw).trim().toUpperCase().substring(0, 2) : '';
      const destinoCduf = cidadeDestino != null ? (getVal(cidadeDestino, 'CDUF') ?? null) : null;
      const destinoCmesoregiao = cidadeDestino != null ? (getVal(cidadeDestino, 'CDMESOREGIAO') ?? null) : null;

      // Uma linha por motorista. Classe de frota: só aplica EXISTS em CLASSEFROTA_CG quando a regra está ligada (CONFIG).

      let query = `
        SELECT
          [cg].[CDCADASTRO] AS CDCADASTRO_MOTORISTA,
          [cg].[RZSOCIAL] AS NOME_MOTORISTA,
          [cg].[NRCELULAR] AS CELULAR,
          [cg].[ENDEMAIL] AS EMAIL,
          [cg].[CDTRANSPORTADOR],
          [t].[RZSOCIAL] AS TRANSPORTADOR_NOME,
          [t].[NRCELULAR] AS TRANSPORTADOR_CELULAR,
          [c].[CDCIDADE],
          [c].[NMCIDADE] AS CIDADE_NOME,
          [c].[ESTADO] AS CIDADE_ESTADO,
          [c].[CDMICROREGIAO],
          [mr].[DSMICROREGIAO] AS MICROREGIAO_NOME,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] conv 
              WHERE [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] 
                AND [conv].[IDVIAGEM] = @IDVIAGEM
                AND [conv].[TENANT_ID] = @TENANT_ID
                AND (
                  [conv].[DHENVIOMETA] IS NOT NULL
                  OR [conv].[DHACESSO] IS NOT NULL
                  OR EXISTS (
                    SELECT 1 FROM [dbo].[LOG_ENVIO_WHATSAPP] lw
                    WHERE lw.[IDCONVOCACAO] = conv.[IDCONVOCACAO]
                      AND UPPER(COALESCE(lw.[STATUS_ENVIO], '')) = 'ENVIADO'
                  )
                )
            ) THEN 1 
            ELSE 0 
          END AS FOI_ACIONADO,
          (
            SELECT COUNT(*) 
            FROM [dbo].[VIAGEMMESTRE] v 
            INNER JOIN [dbo].[VIAGEMMOTORISTA] m ON [v].[IDVIAGEM] = [m].[IDVIAGEM] 
            WHERE [m].[CDMOTORISTA] = [cg].[CDCADASTRO]
              AND [v].[TENANT_ID] = @TENANT_ID
          ) AS QTVIAGENS,
          (
            SELECT COUNT(*) 
            FROM [dbo].[VIAGEMMESTRE] v2 
            INNER JOIN [dbo].[VIAGEMMOTORISTA] m2 ON [v2].[IDVIAGEM] = [m2].[IDVIAGEM] 
            WHERE [m2].[CDMOTORISTA] = [cg].[CDCADASTRO]
              AND [v2].[TENANT_ID] = @TENANT_ID
              AND (@IDROTEIRO = 0 OR [v2].[IDROTEIRO] = @IDROTEIRO)
          ) AS QTVIAGENS_NESTA_ROTA,
          (
            SELECT STRING_AGG(x.[linha], '~~LINE~~' ORDER BY x.[ord_placa])
            FROM (
              SELECT DISTINCT
                UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(COALESCE(
                  NULLIF(LTRIM(RTRIM(COALESCE(mv.[PLACA], ''))), ''),
                  LTRIM(RTRIM(COALESCE(eq.[REFEQUIPAMENTO], '')))
                ))), '-', ''), ' ', ''), '.', '')) AS [ord_placa],
                TRIM(BOTH FROM COALESCE(
                  NULLIF(LTRIM(RTRIM(COALESCE(mv.[PLACA], ''))), ''),
                  NULLIF(LTRIM(RTRIM(COALESCE(eq.[REFEQUIPAMENTO], ''))), '')
                ))
                || ' — '
                || TRIM(BOTH FROM COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(cf.[DSCLASSEFROTA], '')), ''), '(classe não informada)')) AS [linha]
              FROM [dbo].[MOTORISTA_VEICULO] AS mv
              LEFT JOIN [dbo].[EQUIPAMENTO] AS eq ON eq.[IDEQUIPAMENTO] = mv.[CDEQUIPAMENTO]
                AND (eq.[TENANT_ID] = [cg].[TENANT_ID] OR eq.[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[CLASSEFROTA] AS cf ON cf.[CDCLASSEFROTA] = COALESCE(eq.[CDCLASSEFROTA], mv.[CDCLASSEFROTA])
                AND (cf.[TENANT_ID] = [cg].[TENANT_ID] OR cf.[TENANT_ID] = 'default')
              WHERE mv.[CDCADASTRO] = [cg].[CDCADASTRO]
                AND (mv.[TENANT_ID] = [cg].[TENANT_ID] OR mv.[TENANT_ID] IS NULL)
                AND COALESCE(mv.[FGACTIVE], 'S') = 'S'
                AND COALESCE(mv.[STATUSAPROVACAO], 'P') = 'A'
            ) AS x
            WHERE TRIM(COALESCE(x.[ord_placa], '')) <> ''
          ) AS CONJUNTO_PLACAS_CLASSES_MOTORISTA
        FROM [dbo].[CADASTROGERAL] [cg]
        INNER JOIN [dbo].[CIDADE] [c] ON [cg].[CDCIDADE] = [c].[CDCIDADE]
        LEFT JOIN [dbo].[MICROREGIAO] [mr] ON [c].[CDUF] = [mr].[CDUF] AND [c].[CDMICROREGIAO] = [mr].[CDMICROREGIAO]
        LEFT JOIN [dbo].[CADASTROGERAL] [t] ON [cg].[CDTRANSPORTADOR] = [t].[CDCADASTRO] AND [t].[TENANT_ID] = [cg].[TENANT_ID]
        LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] [mc] ON [cg].[CDCADASTRO] = [mc].[CDCADASTRO]
        LEFT JOIN [dbo].[EMPRESA] [e] ON CAST([t].[CGCCPF] AS TEXT) = CAST([e].[CGCMATRIZ] AS TEXT)
        WHERE (
          [cg].[FGTIPOCADASTRO] IN ('M','A','G','T')
          OR [cg].[FGMOTORISTA] = 'S'
          OR ([cg].[FGMOTORISTA] IS NULL AND [cg].[FGTIPOCADASTRO] = 'M')
          OR COALESCE([cg].[FGAGENTE], 'N') = 'S'
          OR COALESCE([cg].[FGGRUPO], 'N') = 'S'
          OR COALESCE([cg].[FGTRANSPORTADOR], 'N') = 'S'
        )
          AND ([cg].[FGACTIVE] = 'A' OR [cg].[FGACTIVE] = 'S')
          AND [cg].[TENANT_ID] = @TENANT_ID
          ${validarClasseFrota ? `
          AND EXISTS (
            SELECT 1 FROM [dbo].[CLASSEFROTA_CG] [cfcg]
            WHERE [cfcg].[CDCADASTRO] = [cg].[CDCADASTRO]
              AND ([cfcg].[FGACTIVE] = 'S' OR [cfcg].[FGACTIVE] = 'A')
              AND [cfcg].[CDCLASSEFROTA] = @CDCLASSEFROTA
          )` : ''}
          ${validarLocalEmbarque && CDCIDADEORIGEM ? `AND (
            ( NOT EXISTS (SELECT 1 FROM [dbo].[CADASTRO_LOCAL_PREFERIDO] [lp] WHERE [lp].[CDCADASTRO] = [cg].[CDCADASTRO] AND [lp].[TIPO] = 'E') )
            OR ( EXISTS (SELECT 1 FROM [dbo].[CADASTRO_LOCAL_PREFERIDO] [lp] WHERE [lp].[CDCADASTRO] = [cg].[CDCADASTRO] AND [lp].[TIPO] = 'E'
              AND UPPER(TRIM(COALESCE([lp].[PAIS], ''))) = UPPER(TRIM(COALESCE(@ORIGEM_PAIS, '')))
              AND ([lp].[CDUF] IS NULL OR [lp].[CDUF] = @ORIGEM_CDUF)
              AND ([lp].[CDMESOREGIAO] IS NULL OR [lp].[CDMESOREGIAO] = @ORIGEM_CDMESOREGIAO)
            ) )
          )` : ''}
          ${validarLocalDesembarque && CDCIDADEDESTINO ? `AND (
            ( NOT EXISTS (SELECT 1 FROM [dbo].[CADASTRO_LOCAL_PREFERIDO] [lp] WHERE [lp].[CDCADASTRO] = [cg].[CDCADASTRO] AND [lp].[TIPO] = 'D') )
            OR ( EXISTS (SELECT 1 FROM [dbo].[CADASTRO_LOCAL_PREFERIDO] [lp] WHERE [lp].[CDCADASTRO] = [cg].[CDCADASTRO] AND [lp].[TIPO] = 'D'
              AND UPPER(TRIM(COALESCE([lp].[PAIS], ''))) = UPPER(TRIM(COALESCE(@DESTINO_PAIS, '')))
              AND ([lp].[CDUF] IS NULL OR [lp].[CDUF] = @DESTINO_CDUF)
              AND ([lp].[CDMESOREGIAO] IS NULL OR [lp].[CDMESOREGIAO] = @DESTINO_CDMESOREGIAO)
            ) )
          )` : ''}
      `;

      const request = pool.request();
      request.input('TENANT_ID', sql.NVarChar(64), tenantIdForRequest(req));
      // Adicionar IDVIAGEM para o JOIN com CONVOCACAO
      request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      
      // Adicionar IDROTEIRO para buscar motoristas experientes nesta rota (0 = não filtrar por rota)
      request.input('IDROTEIRO', sql.Int, IDROTEIRO ? parseInt(IDROTEIRO) : 0);

      // Classe de frota – só exige parâmetro quando a regra está ligada
      if (validarClasseFrota) {
        if (!CDCLASSEFROTA) return res.status(400).json({ error: 'Classe de frota não informada na viagem.' });
        request.input('CDCLASSEFROTA', sql.SmallInt, parseInt(CDCLASSEFROTA));
      }

      if (validarLocalEmbarque && CDCIDADEORIGEM) {
        request.input('ORIGEM_PAIS', sql.VarChar, origemPais || 'BR');
        request.input('ORIGEM_CDUF', sql.SmallInt, origemCduf != null ? parseInt(origemCduf, 10) : null);
        request.input('ORIGEM_CDMESOREGIAO', sql.SmallInt, origemCmesoregiao != null ? parseInt(origemCmesoregiao, 10) : null);
      }
      if (validarLocalDesembarque && CDCIDADEDESTINO) {
        request.input('DESTINO_PAIS', sql.VarChar, destinoPais || 'BR');
        request.input('DESTINO_CDUF', sql.SmallInt, destinoCduf != null ? parseInt(destinoCduf, 10) : null);
        request.input('DESTINO_CDMESOREGIAO', sql.SmallInt, destinoCmesoregiao != null ? parseInt(destinoCmesoregiao, 10) : null);
      }

      // Rastreamento: só filtra quando a regra está ligada E a viagem exige veículo rastreado (FGRASTREADO = S).
      // Cadastro com "Possui Veículo Rastreado = Não" fica de fora nesse caso — desligue a regra ou alinhe cadastro/viagem.
      if (validarRastreamento && FGRASTREADO === 'S') {
        query += ` AND COALESCE([cg].[FGRASTREADO], 'N') = 'S'`;
      }

      // Com regra de classe desligada, não exige vínculo em CLASSEFROTA_CG. Rastreamento e locais seguem CONFIG + viagem.

      // Ordenar por: Experiência na rota DESC → Experiência geral DESC → Nome
      query += ` ORDER BY QTVIAGENS_NESTA_ROTA DESC, QTVIAGENS DESC, [cg].[RZSOCIAL]`;

      // Verificações de diagnóstico
      // Verificar motoristas na micro-região (apenas se houver micro-regiões)
      if (microregioes.length > 0) {
        try {
          // Extrair apenas os valores numéricos de microregiao
          const valoresMicro = microregioes.map(m => {
            const valor = typeof m === 'object' && m !== null ? m.microregiao : m;
            return typeof valor === 'number' ? valor : parseInt(valor) || 0;
          }).filter(v => v > 0);

          if (valoresMicro.length > 0) {
            const diagMotoristasMicro = await pool.request().query(`
              SELECT COUNT(*) AS TOTAL
              FROM [dbo].[CADASTROGERAL] [cg]
              INNER JOIN [dbo].[CIDADE] [c] ON [cg].[CDCIDADE] = [c].[CDCIDADE]
              WHERE ( [cg].[FGTIPOCADASTRO] IN ('M','A','G','T') OR ( [cg].[FGMOTORISTA] = 'S' OR ([cg].[FGMOTORISTA] IS NULL AND [cg].[FGTIPOCADASTRO] = 'M') ) OR COALESCE([cg].[FGAGENTE], 'N') = 'S' OR COALESCE([cg].[FGGRUPO], 'N') = 'S' OR COALESCE([cg].[FGTRANSPORTADOR], 'N') = 'S' )
                AND ([cg].[FGACTIVE] = 'A' OR [cg].[FGACTIVE] = 'S')
                AND [c].[CDMICROREGIAO] IN (${valoresMicro.join(', ')})
            `);
          }
        } catch (diagErr) {
          // Ignorar erros de diagnóstico, não são críticos
          console.warn('Erro na query de diagnóstico (não crítico):', diagErr.message);
        }
      }

      // Logs de debug removidos

      const result = await request.query(query);
      const raw = result.recordset || [];

      // Normalizar chaves: PostgreSQL devolve em minúsculas; frontend espera MAIÚSCULAS_COM_UNDERSCORE
      const recordset = raw.map(row => {
        const get = (key) => (row[key] != null ? row[key] : row[key.toLowerCase()]);
        const cdMot = get('CDCADASTRO_MOTORISTA');
        const cdTransp = get('CDTRANSPORTADOR');
        const mesmoCadastro =
          cdTransp != null &&
          cdMot != null &&
          String(cdTransp).trim() !== '' &&
          Number(cdMot) === Number(cdTransp);
        const transpInvalido = cdTransp == null || String(cdTransp).trim() === '' || mesmoCadastro;
        return {
          CDCADASTRO_MOTORISTA: cdMot,
          NOME_MOTORISTA: get('NOME_MOTORISTA'),
          CELULAR: get('CELULAR'),
          EMAIL: get('EMAIL'),
          CDTRANSPORTADOR: transpInvalido ? null : cdTransp,
          TRANSPORTADOR_NOME: transpInvalido ? null : get('TRANSPORTADOR_NOME'),
          TRANSPORTADOR_CELULAR: transpInvalido ? null : get('TRANSPORTADOR_CELULAR'),
          CDCIDADE: get('CDCIDADE'),
          CIDADE_NOME: get('CIDADE_NOME'),
          CIDADE_ESTADO: get('CIDADE_ESTADO'),
          CDMICROREGIAO: get('CDMICROREGIAO'),
          MICROREGIAO_NOME: get('MICROREGIAO_NOME'),
          FOI_ACIONADO: get('FOI_ACIONADO'),
          QTVIAGENS: get('QTVIAGENS'),
          QTVIAGENS_NESTA_ROTA: get('QTVIAGENS_NESTA_ROTA'),
          CONJUNTO_PLACAS_CLASSES_MOTORISTA: get('CONJUNTO_PLACAS_CLASSES_MOTORISTA'),
        };
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Compatíveis] Viagem ${idViagem}: ${recordset.length} registro(s) retornado(s).`);
      }

      res.json({ motoristas: recordset, viagemResumo });
    } catch (err) {
      console.error('Erro ao buscar motoristas compatíveis:', err);
      console.error('Stack trace:', err.stack);
      if (err.message) console.error('Mensagem do erro:', err.message);
      if (err.originalError && err.originalError.message) console.error('Erro original:', err.originalError.message);
      res.status(500).json({ 
        error: 'Erro ao buscar motoristas compatíveis.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Regras de compatibilidade (liga/desliga) – GET
  obterRegrasCompatibilidade: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const keys = [
        'regra_compativel_rastreamento',
        'regra_compativel_classe_frota',
        'regra_compativel_local_embarque',
        'regra_compativel_local_desembarque'
      ];
      const result = await pool.query(
        `SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" = ANY($1::text[]) AND "TENANT_ID" = $2`,
        [keys, tid]
      );
      const rows = result.rows || [];
      const get = (k) => (rows.find(r => (r.CHAVE || r.chave) === k) || {})?.VALOR ?? (rows.find(r => (r.chave || r.CHAVE) === k) || {})?.valor;
      res.json({
        rastreamento: (get('regra_compativel_rastreamento') || 'S').toUpperCase() === 'S',
        classeFrota: (get('regra_compativel_classe_frota') || 'S').toUpperCase() === 'S',
        localEmbarque: (get('regra_compativel_local_embarque') || 'S').toUpperCase() === 'S',
        localDesembarque: (get('regra_compativel_local_desembarque') || 'S').toUpperCase() === 'S'
      });
    } catch (err) {
      console.error('Erro ao obter regras de compatibilidade:', err);
      res.status(500).json({ error: 'Erro ao carregar regras.' });
    }
  },

  // Regras de compatibilidade – PUT (grava CONFIGURACAO + auditoria)
  salvarRegrasCompatibilidade: async (req, res) => {
    try {
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const { rastreamento, classeFrota, localEmbarque, localDesembarque } = req.body || {};
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const toS = (v) => (v === true || v === 'S' || v === 's' || v === '1') ? 'S' : 'N';
      const novos = {
        regra_compativel_rastreamento: toS(rastreamento),
        regra_compativel_classe_frota: toS(classeFrota),
        regra_compativel_local_embarque: toS(localEmbarque),
        regra_compativel_local_desembarque: toS(localDesembarque)
      };
      const keys = Object.keys(novos);
      let atuais = { rows: [] };
      try {
        atuais = await pool.query(
          `SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" = ANY($1::text[]) AND "TENANT_ID" = $2`,
          [keys, tid]
        );
      } catch (e) {
        console.error('Erro ao ler CONFIGURACAO (regras compatibilidade):', e?.message || e);
        return res.status(500).json({
          error: 'Tabela CONFIGURACAO não encontrada ou sem permissão. Verifique o banco.',
          details: process.env.NODE_ENV === 'development' ? (e?.message || String(e)) : undefined
        });
      }
      const mapaAtual = {};
      (atuais.rows || []).forEach(r => { mapaAtual[r.CHAVE || r.chave] = (r.VALOR || r.valor) || 'S'; });
      for (const chave of keys) {
        const valorNovo = novos[chave];
        const valorAnt = mapaAtual[chave] || 'S';
        if (valorAnt !== valorNovo) {
          try {
            await pool.query(
              `INSERT INTO "REGRA_COMPATIVEL_AUDIT" ("SGUSER", "CHAVE", "VALOR_ANTERIOR", "VALOR_NOVO") VALUES ($1, $2, $3, $4)`,
              [sgUser, chave, valorAnt, valorNovo]
            );
          } catch (errAudit) {
            console.warn('Auditoria regras (REGRA_COMPATIVEL_AUDIT) ignorada:', errAudit?.message || errAudit);
            // Continua e grava na CONFIGURACAO mesmo se a auditoria falhar
          }
        }
        const descricao = 'Regra compatíveis: ' + chave.replace('regra_compativel_', '');
        try {
          const updateResult = await pool.query(
            `UPDATE "CONFIGURACAO" SET "VALOR" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "CHAVE" = $2 AND "TENANT_ID" = $3`,
            [valorNovo, chave, tid]
          );
          const updated = (updateResult.rowCount ?? 0) > 0;
          if (!updated) {
            await pool.query(
              `INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
               VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
               ON CONFLICT ("TENANT_ID", "CHAVE") DO UPDATE SET
                 "VALOR" = EXCLUDED."VALOR",
                 "DESCRICAO" = EXCLUDED."DESCRICAO",
                 "DHMAINTENANCE" = CURRENT_TIMESTAMP`,
              [tid, chave, valorNovo, descricao]
            );
          }
        } catch (errConfig) {
          const msg = errConfig?.message || String(errConfig);
          console.error('Erro ao gravar CONFIGURACAO (regras compatibilidade):', msg);
          return res.status(500).json({
            error: 'Erro ao salvar regras.',
            details: process.env.NODE_ENV === 'development' ? msg : undefined
          });
        }
      }
      res.json({ success: true, message: 'Regras salvas com sucesso. Alterações registradas para auditoria.' });
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('Erro ao salvar regras de compatibilidade:', err);
      res.status(500).json({
        error: 'Erro ao salvar regras. Verifique se as tabelas CONFIGURACAO e REGRA_COMPATIVEL_AUDIT existem.',
        details: process.env.NODE_ENV === 'development' ? msg : undefined
      });
    }
  },

  // Criar convocações para motoristas selecionados
  criarConvocacoes: async (req, res) => {
    try {
      const { idViagem, motoristas } = req.body;

      if (!idViagem || !motoristas || !Array.isArray(motoristas) || motoristas.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos. É necessário informar a viagem e pelo menos um motorista.' });
      }

      // Obter login do usuário logado do header
      const userLogin = req.headers['user-login'];

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para criar convocações.' });
      }

      const pool = await poolPromise;
      const tenantIdConv = tenantIdForRequest(req);
      const vTenantCheck = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
        .input('TENANT_ID', tenantIdConv)
        .query(`
          SELECT 1 FROM [dbo].[VIAGEMMESTRE]
          WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
        `);
      if (vTenantCheck.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const jaConfirmada = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
        .input('TENANT_ID', tenantIdConv)
        .query(`
          SELECT 1 FROM [dbo].[CONVOCACAO]
          WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID AND [STATUS] = 'CONFIRMADA'
        `);
      if (jaConfirmada.recordset && jaConfirmada.recordset.length > 0) {
        return res.status(409).json({
          error: 'Esta viagem já possui motorista confirmado. Não é possível criar novas convocações por aqui.'
        });
      }

      // Validar se o usuário existe e está ativo
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível criar convocações.' });
      }

      const usuarioOperador = userLogin;

      // Buscar próximo ID de convocação
      const maxResult = await pool
        .request()
        .query('SELECT COALESCE(MAX([IDCONVOCACAO]), 0) + 1 AS [maxId] FROM [dbo].[CONVOCACAO]');
      let proximoId = getFirstNumericValue(maxResult.recordset, 1);

      // Inserir convocações (verificando duplicatas)
      const convocacoes = [];
      for (const motorista of motoristas) {
        const {
          CDCADASTRO_MOTORISTA,
          NRCELULAR,
          TXTCONVOCACAO,
          LINKCONVOCACAO
        } = motorista;

        // Verificar se já existe convocação para este motorista e viagem
        const verificarDuplicata = await pool
          .request()
          .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
          .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), CDCADASTRO_MOTORISTA)
          .input('TENANT_ID', tenantIdConv)
          .query(`
            SELECT TOP 1 
              [IDCONVOCACAO],
              [NRCELULAR],
              [TXTCONVOCACAO],
              [LINKCONVOCACAO],
              [STATUS]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM
              AND [CDCADASTRO_MOTORISTA] = @CDCADASTRO_MOTORISTA
              AND [TENANT_ID] = @TENANT_ID
            ORDER BY [DHCONVOCACAO] DESC
          `);

        if (verificarDuplicata.recordset.length > 0) {
          // Já existe convocação - reutilizar a existente
          const convocacaoExistente = verificarDuplicata.recordset[0];
          convocacoes.push({
            IDCONVOCACAO: convocacaoExistente.IDCONVOCACAO,
            IDVIAGEM: idViagem,
            CDCADASTRO_MOTORISTA,
            NRCELULAR: convocacaoExistente.NRCELULAR || NRCELULAR || null,
            TXTCONVOCACAO: convocacaoExistente.TXTCONVOCACAO || TXTCONVOCACAO || null,
            LINKCONVOCACAO: convocacaoExistente.LINKCONVOCACAO || LINKCONVOCACAO || null,
            STATUS: convocacaoExistente.STATUS,
            REUTILIZADA: true
          });
          continue; // Pular criação de nova convocação
        }

        // Não existe - criar nova convocação (colunas entre colchetes para PostgreSQL)
        const request = pool.request()
          .input('IDCONVOCACAO', sql.Int, proximoId)
          .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
          .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), CDCADASTRO_MOTORISTA)
          .input('STATUS', sql.VarChar(20), 'PENDENTE')
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), usuarioOperador)
          .input('TENANT_ID', tenantIdConv);

        // Adicionar campos opcionais se fornecidos (colunas entre colchetes para db.js → "COL" no PG)
        const exprSnapPlacas = `(${sqlPlacasEsperadasPorViagemMotoristaParams()})`;
        const exprSnapClasses = `(${sqlDsClasseConjuntoPorViagemMotoristaParams()})`;
        let camposInsert = '[IDCONVOCACAO], [IDVIAGEM], [CDCADASTRO_MOTORISTA], [STATUS], [DHCONVOCACAO], [SGUSUARIO_OPERADOR], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID], [TXT_PLACAS_SNAPSHOT], [TXT_CLASSES_CONJ_SNAPSHOT]';
        let valoresInsert = `@IDCONVOCACAO, @IDVIAGEM, @CDCADASTRO_MOTORISTA, @STATUS, GETDATE(), @SGUSUARIO_OPERADOR, GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID, ${exprSnapPlacas}, ${exprSnapClasses}`;

        if (NRCELULAR !== undefined && NRCELULAR !== null) {
          camposInsert += ', [NRCELULAR]';
          valoresInsert += ', @NRCELULAR';
          request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
        }

        if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null) {
          camposInsert += ', [TXTCONVOCACAO]';
          valoresInsert += ', @TXTCONVOCACAO';
          request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
        }

        if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null) {
          camposInsert += ', [LINKCONVOCACAO]';
          valoresInsert += ', @LINKCONVOCACAO';
          request.input('LINKCONVOCACAO', sql.VarChar(500), LINKCONVOCACAO);
        }

        await request.query(`
          INSERT INTO [dbo].[CONVOCACAO] (${camposInsert})
          VALUES (${valoresInsert})
        `);

        convocacoes.push({
          IDCONVOCACAO: proximoId,
          IDVIAGEM: idViagem,
          CDCADASTRO_MOTORISTA,
          NRCELULAR: NRCELULAR || null,
          TXTCONVOCACAO: TXTCONVOCACAO || null,
          LINKCONVOCACAO: LINKCONVOCACAO || null,
          REUTILIZADA: false
        });

        proximoId++;
      }

      const novas = convocacoes.filter(c => !c.REUTILIZADA).length;
      const reutilizadas = convocacoes.filter(c => c.REUTILIZADA).length;

      let mensagem = '';
      if (novas > 0 && reutilizadas > 0) {
        mensagem = `${novas} convocação(ões) criada(s) e ${reutilizadas} reutilizada(s) (evitando duplicatas).`;
      } else if (novas > 0) {
        mensagem = `${novas} convocação(ões) criada(s) com sucesso!`;
      } else if (reutilizadas > 0) {
        mensagem = `${reutilizadas} convocação(ões) reutilizada(s) (já existiam no banco).`;
      }

      res.status(201).json({
        success: true,
        message: mensagem,
        convocacoes,
        novas,
        reutilizadas
      });

      // Log-resumo da etapa de divulgação/disparo de convocações
      await registrarResumoEtapaWhatsApp(pool, {
        idConvocacao: (convocacoes[0] && convocacoes[0].IDCONVOCACAO) || null,
        etapa: 'DIVULGACAO',
        mensagem: `Convocações preparadas para viagem #${idViagem}. Novas=${novas}, Reutilizadas=${reutilizadas}, Total=${convocacoes.length}.`,
        detalhes: JSON.stringify({
          idViagem: Number(idViagem),
          total: convocacoes.length,
          novas,
          reutilizadas,
          motoristas: convocacoes.map((c) => c.CDCADASTRO_MOTORISTA)
        }),
        status: 'info',
        sgUser: usuarioOperador
      });
    } catch (err) {
      console.error('Erro ao criar convocações:', err);
      console.error('Detalhes do erro:', {
        message: err.message,
        code: err.code,
        originalError: err.originalError?.message,
        lineNumber: err.originalError?.info?.lineNumber
      });
      res.status(500).json({
        error: 'Erro ao criar convocações.',
        details: err.message
      });
    }
  },

  /** GET — contagem de convocações pendentes com divergência de placas (badge header; ignora viagem já confirmada). */
  contadorDivergenciaPlacasConvocacoes: async (req, res) => {
    try {
      const tenantId = tenantIdForRequest(req);
      const pool = await poolPromise;
      const r = await pool
        .request()
        .input('TENANT_ID', sql.NVarChar(64), tenantId)
        .query(`
          SELECT COUNT(*) AS total
          FROM [dbo].[CONVOCACAO] c
          WHERE c.[TENANT_ID] = @TENANT_ID
            AND UPPER(TRIM(COALESCE(c.[STATUS], ''))) = 'PENDENTE'
            AND UPPER(TRIM(COALESCE(c.[FGCONFIRMACAOPLACAS], ''))) = 'D'
            AND NOT EXISTS (
              SELECT 1
              FROM [dbo].[CONVOCACAO] c2
              WHERE c2.[IDVIAGEM] = c.[IDVIAGEM]
                AND c2.[TENANT_ID] = c.[TENANT_ID]
                AND c2.[STATUS] = 'CONFIRMADA'
            )
        `);
      const row = r.recordset && r.recordset[0];
      const raw = row != null ? row.total ?? row.TOTAL : 0;
      const total = typeof raw === 'number' && Number.isFinite(raw) ? raw : parseInt(String(raw), 10) || 0;
      res.json({ success: true, data: { total } });
    } catch (err) {
      const em = String(err.message || '');
      if (err.code === '42703' && /fgconfirmacaoplacas/i.test(em)) {
        return res.json({ success: true, data: { total: 0 } });
      }
      console.error('[CONTADOR DIVERGENCIA PLACAS]', err.message);
      res.status(500).json({ success: false, error: 'Erro ao contar divergências de placas.' });
    }
  },

  // Listar convocações com filtros
  listarConvocacoes: async (req, res) => {
    try {
      const { idViagem, status, cdcadastroMotorista, divergenciaPlacas } = req.query;
      const pool = await poolPromise;
      // Uma linha por (viagem + motorista): evita lista duplicada por campanhas/disparos repetidos.
      // Prioridade: CONFIRMADA > ACEITA > PENDENTE > ACEITA_DESCARTADA > RECUSADA; desempate por data e ID.
      let query = `
        SELECT * FROM (
        SELECT DISTINCT ON ([c].[IDVIAGEM], [c].[CDCADASTRO_MOTORISTA])
          [c].[IDCONVOCACAO],
          [c].[IDVIAGEM],
          [c].[CDCADASTRO_MOTORISTA],
          [c].[STATUS],
          [c].[DHCONVOCACAO],
          [c].[DHACESSO],
          [c].[DHRESPOSTA],
          [c].[SGUSUARIO_OPERADOR],
          [c].[LATITUDE],
          [c].[LONGITUDE],
          [c].[SGUSER],
          [c].[NRCELULAR],
          [c].[DHENVIOMETA],
          [c].[DHMAINTENANCE] AS [DHMAINTENANCE_CONVOCACAO],
          (
            SELECT MAX(COALESCE([vr].[DHPOSICAO], [vr].[DHREGISTRO]))
            FROM [dbo].[VIAGEMRASTREAMENTO] [vr]
            WHERE [vr].[IDVIAGEM] = [c].[IDVIAGEM]
              AND [vr].[CDCADASTRO] = [c].[CDCADASTRO_MOTORISTA]
              AND [vr].[TENANT_ID] = [c].[TENANT_ID]
          ) AS [ULTIMA_POSICAO_VIAGEM_DH],
          [c].[CDMOTIVORECUSA],
          [mr].[DSMOTIVO] AS MOTIVO_RECUSA,
          [c].[CDMOTIVOREABERTURA],
          [mra].[DSMOTIVO] AS MOTIVO_REABERTURA,
          [v].[IDROTEIRO],
          [v].[CDCLASSEFROTA],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[FGRASTREADO],
          [v].[VLFRETE],
          COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
          [c].[VL_FRETE_PROPOSTO_MOTORISTA],
          [v].[PESO],
          [v].[CUBAGEM],
          upper([cg].[RZSOCIAL]) AS NOME_MOTORISTA,
          [cg].[NRCELULAR] AS CELULAR_MOTORISTA,
          [cf].[DSCLASSEFROTA],
          [r].[CDCIDADEORIGEM],
          [r].[CDCIDADEDESTINO],
          [r].[DSROTEIRO],
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] [c2] 
              WHERE [c2].[IDVIAGEM] = [c].[IDVIAGEM] 
                AND [c2].[TENANT_ID] = [c].[TENANT_ID]
                AND [c2].[STATUS] = 'CONFIRMADA'
                AND [c2].[IDCONVOCACAO] != [c].[IDCONVOCACAO]
            ) THEN 1 
            ELSE 0 
          END AS VIAGEM_JA_CONFIRMADA,
          [c].[FGCONFIRMACAOPLACAS],
          [c].[TXTPLACASDIVERGENCIA],
          [c].[DHCONFIRMACAOPLACAS],
          (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
          (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]
        FROM [dbo].[CONVOCACAO] [c]
        INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [c].[IDVIAGEM] = [v].[IDVIAGEM] AND [c].[TENANT_ID] = [v].[TENANT_ID]
        INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [c].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [c].[TENANT_ID]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
          AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[MOTIVORECUSA] [mr] ON [c].[CDMOTIVORECUSA] = [mr].[CDMOTIVO]
          LEFT JOIN [dbo].[MOTIVOREABERTURA] [mra] ON [c].[CDMOTIVOREABERTURA] = [mra].[CDMOTIVO]
          WHERE 1=1
            AND [c].[TENANT_ID] = @TENANT_ID
      `;

      const request = pool.request();
      request.input('TENANT_ID', tenantIdForRequest(req));

      if (idViagem) {
        query += ` AND [c].[IDVIAGEM] = @IDVIAGEM`;
        request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      }

      if (status) {
        query += ` AND [c].[STATUS] = @STATUS`;
        request.input('STATUS', sql.VarChar(20), status);
      }

      if (cdcadastroMotorista) {
        query += ` AND [c].[CDCADASTRO_MOTORISTA] = @CDCADASTRO_MOTORISTA`;
        request.input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), parseFloat(cdcadastroMotorista));
      }

      const divPlacas = divergenciaPlacas != null && String(divergenciaPlacas).trim() !== ''
        ? String(divergenciaPlacas).trim().toLowerCase()
        : '';
      if (['1', 'true', 's', 'sim', 'yes'].includes(divPlacas)) {
        query += ` AND UPPER(TRIM(COALESCE([c].[FGCONFIRMACAOPLACAS], ''))) = 'D'`;
      }

      query += ` ORDER BY
          [c].[IDVIAGEM],
          [c].[CDCADASTRO_MOTORISTA],
          CASE UPPER(LTRIM(RTRIM(COALESCE([c].[STATUS], ''))))
            WHEN 'CONFIRMADA' THEN 1
            WHEN 'ACEITA' THEN 2
            WHEN 'PENDENTE' THEN 3
            WHEN 'ACEITA_DESCARTADA' THEN 4
            WHEN 'RECUSADA' THEN 5
            ELSE 6
          END,
          [c].[DHCONVOCACAO] DESC,
          [c].[IDCONVOCACAO] DESC
        ) conv_dedup
        ORDER BY conv_dedup.[DHCONVOCACAO] DESC`;

      const result = await request.query(query);
      // Normalizar chaves para maiúsculas (PostgreSQL retorna minúsculas em aliases sem aspas)
      const recordset = (result.recordset || []).map((row) => {
        const r = { ...row };
        const map = {
          nome_motorista: 'NOME_MOTORISTA',
          celular_motorista: 'CELULAR_MOTORISTA',
          dsmotivo_recusa: 'MOTIVO_RECUSA',
          dsmotivo_reabertura: 'MOTIVO_REABERTURA',
          dsclassefrota: 'DSCLASSEFROTA',
          dsroteiro: 'DSROTEIRO',
          origem_cidade: 'ORIGEM_CIDADE',
          origem_estado: 'ORIGEM_ESTADO',
          destino_cidade: 'DESTINO_CIDADE',
          destino_estado: 'DESTINO_ESTADO',
          viagem_ja_confirmada: 'VIAGEM_JA_CONFIRMADA',
          ultima_posicao_viagem_dh: 'ULTIMA_POSICAO_VIAGEM_DH',
          dhmaintenance_convocacao: 'DHMAINTENANCE_CONVOCACAO',
          dtprevinicio: 'DTPREVINICIO',
          dtprevfinal: 'DTPREVFINAL',
          idviagem: 'IDVIAGEM',
          idroteiro: 'IDROTEIRO',
          cdcadastro_motorista: 'CDCADASTRO_MOTORISTA',
          moeda: 'MOEDA',
          vl_frete_proposto_motorista: 'VL_FRETE_PROPOSTO_MOTORISTA',
          sguser: 'SGUSER',
          placasesperadas: 'PLACASESPERADAS',
          fgconfirmacaoplacas: 'FGCONFIRMACAOPLACAS',
          txtplacasdivergencia: 'TXTPLACASDIVERGENCIA',
          dhconfirmacaoplacas: 'DHCONFIRMACAOPLACAS',
          dsclassefrota_conjunto: 'DSCLASSEFROTA_CONJUNTO',
        };
        Object.keys(map).forEach((k) => {
          if (r[k] !== undefined && r[map[k]] === undefined) r[map[k]] = r[k];
        });
        return r;
      });
      res.json(recordset);
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          error: 'Execute a migração de colunas de confirmação de placas em CONVOCACAO (script adicionar_convocacao_confirmacao_placas_postgres.sql).',
          errorKey: 'convocacao.listaConvocacoesSchemaPendente',
        });
      }
      console.error('Erro ao listar convocações:', err);
      res.status(500).json({ error: 'Erro ao listar convocações.' });
    }
  },

  // Buscar convocação por ID (para gerenciamento)
  buscarConvocacaoPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tenantIdForRequest(req))
        .query(`
          SELECT 
            [c].[IDCONVOCACAO],
            [c].[IDVIAGEM],
            [c].[CDCADASTRO_MOTORISTA],
            [c].[STATUS],
            [c].[DHCONVOCACAO],
            [c].[DHACESSO],
            [c].[DHRESPOSTA],
            [c].[LATITUDE],
            [c].[LONGITUDE],
            [c].[SGUSUARIO_OPERADOR],
            [c].[DHENVIOMETA],
            [c].[DHMAINTENANCE] AS [DHMAINTENANCE_CONVOCACAO],
            (
              SELECT MAX(COALESCE([vr].[DHPOSICAO], [vr].[DHREGISTRO]))
              FROM [dbo].[VIAGEMRASTREAMENTO] [vr]
              WHERE [vr].[IDVIAGEM] = [c].[IDVIAGEM]
                AND [vr].[CDCADASTRO] = [c].[CDCADASTRO_MOTORISTA]
            ) AS [ULTIMA_POSICAO_VIAGEM_DH],
            [v].[CDCLASSEFROTA],
            [v].[DTPREVINICIO],
            [v].[DTPREVFINAL],
            [v].[FGRASTREADO],
            [v].[OBSERV],
            [v].[VLFRETE],
            [v].[PESO],
            [v].[IDROTEIRO],
            upper([cg].[RZSOCIAL]) AS NOME_MOTORISTA,
            [cg].[NRCELULAR] AS CELULAR_MOTORISTA,
            [cf].[DSCLASSEFROTA],
            [r].[DSROTEIRO],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO],
            [co].[NMCIDADE] AS ORIGEM_CIDADE,
            [co].[ESTADO] AS ORIGEM_ESTADO,
            [cd].[NMCIDADE] AS DESTINO_CIDADE,
            [cd].[ESTADO] AS DESTINO_ESTADO,
            [c].[FGCONFIRMACAOPLACAS],
            [c].[TXTPLACASDIVERGENCIA],
            [c].[DHCONFIRMACAOPLACAS],
            (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
            (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]
          FROM [dbo].[CONVOCACAO] [c]
          INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [c].[IDVIAGEM] = [v].[IDVIAGEM] AND [c].[TENANT_ID] = [v].[TENANT_ID]
          INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [c].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [c].[TENANT_ID]
          LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
            AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          WHERE [c].[IDCONVOCACAO] = @IDCONVOCACAO AND [c].[TENANT_ID] = @TENANT_ID
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const row = { ...result.recordset[0] };
      const keyMap = {
        nome_motorista: 'NOME_MOTORISTA',
        celular_motorista: 'CELULAR_MOTORISTA',
        dsclassefrota: 'DSCLASSEFROTA',
        dsroteiro: 'DSROTEIRO',
        origem_cidade: 'ORIGEM_CIDADE',
        origem_estado: 'ORIGEM_ESTADO',
        destino_cidade: 'DESTINO_CIDADE',
        destino_estado: 'DESTINO_ESTADO',
        ultima_posicao_viagem_dh: 'ULTIMA_POSICAO_VIAGEM_DH',
        dhmaintenance_convocacao: 'DHMAINTENANCE_CONVOCACAO',
        idviagem: 'IDVIAGEM',
        idroteiro: 'IDROTEIRO',
        cdcadastro_motorista: 'CDCADASTRO_MOTORISTA',
        dtprevinicio: 'DTPREVINICIO',
        dtprevfinal: 'DTPREVFINAL',
        placasesperadas: 'PLACASESPERADAS',
        fgconfirmacaoplacas: 'FGCONFIRMACAOPLACAS',
        txtplacasdivergencia: 'TXTPLACASDIVERGENCIA',
        dhconfirmacaoplacas: 'DHCONFIRMACAOPLACAS',
        dsclassefrota_conjunto: 'DSCLASSEFROTA_CONJUNTO',
      };
      Object.keys(keyMap).forEach((k) => {
        if (row[k] !== undefined && row[keyMap[k]] === undefined) row[keyMap[k]] = row[k];
      });
      res.json(row);
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          error: 'Migração de colunas de confirmação de placas pendente em CONVOCACAO.',
          errorKey: 'convocacao.listaConvocacoesSchemaPendente',
        });
      }
      console.error('Erro ao buscar convocação:', err);
      res.status(500).json({ error: 'Erro ao buscar convocação.' });
    }
  },

  // Atualizar convocação com texto e link
  atualizarConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { NRCELULAR, TXTCONVOCACAO, LINKCONVOCACAO } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'ID da convocação não informado.' });
      }

      const pool = await poolPromise;
      const tidUpdConv = tenantIdForRequest(req);
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidUpdConv);

      let updates = [];

      if (NRCELULAR !== undefined && NRCELULAR !== null && NRCELULAR !== '') {
        updates.push('[NRCELULAR] = @NRCELULAR');
        request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
      }

      if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null && TXTCONVOCACAO !== '') {
        updates.push('[TXTCONVOCACAO] = @TXTCONVOCACAO');
        request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
      }

      if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null && LINKCONVOCACAO !== '') {
        updates.push('[LINKCONVOCACAO] = @LINKCONVOCACAO');
        request.input('LINKCONVOCACAO', sql.VarChar(500), LINKCONVOCACAO);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar foi informado.' });
      }

      updates.push('[DHMAINTENANCE] = GETDATE()');

      const query = `
        UPDATE [dbo].[CONVOCACAO]
        SET ${updates.join(', ')}
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
      `;

      const result = await request.query(query);
      const nAf = result.rowsAffected && result.rowsAffected[0] != null ? result.rowsAffected[0] : 0;
      if (!nAf) {
        return res.status(404).json({ error: 'Convocação não encontrada ou fora do tenant.' });
      }

      res.json({
        success: true,
        message: 'Convocação atualizada com sucesso!',
        rowsAffected: nAf
      });
    } catch (err) {
      console.error('[ATUALIZAR CONVOCACAO] Erro ao atualizar convocação:', err);
      res.status(500).json({
        error: 'Erro ao atualizar convocação.',
        details: err.message
      });
    }
  },

  // Atualizar campo DHENVIOMETA após envio para webhook
  atualizarEnvioMeta: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'ID da convocação não informado.' });
      }

      const pool = await poolPromise;
      const tidMeta = tenantIdForRequest(req);

      const rMeta = await pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidMeta)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET [DHENVIOMETA] = GETDATE(),
              [DHMAINTENANCE] = GETDATE()
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
        `);
      const nMeta = rMeta.rowsAffected && rMeta.rowsAffected[0] != null ? rMeta.rowsAffected[0] : 0;
      if (!nMeta) {
        return res.status(404).json({ error: 'Convocação não encontrada ou fora do tenant.' });
      }

      res.json({
        success: true,
        message: 'Campo DHENVIOMETA atualizado com sucesso!'
      });
    } catch (err) {
      console.error('[ATUALIZAR ENVIO META] Erro ao atualizar DHENVIOMETA:', err);
      res.status(500).json({
        error: 'Erro ao atualizar DHENVIOMETA.',
        details: err.message
      });
    }
  },

  // Atualizar status da convocação
  atualizarStatusConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório.' });
      }

      const sgUserConv = getSgUser(req);
      if (!sgUserConv) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      const tidSt = tenantIdForRequest(req);
      const rSt = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidSt)
        .input('STATUS', sql.VarChar(20), status)
        .input('sgUser', sql.VarChar(50), sgUserConv)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET [STATUS] = @STATUS,
              [DHRESPOSTA] = CASE WHEN @STATUS IN ('ACEITA', 'RECUSADA') THEN GETDATE() ELSE [DHRESPOSTA] END,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = @sgUser
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
        `);
      const nSt = rSt.rowsAffected && rSt.rowsAffected[0] != null ? rSt.rowsAffected[0] : 0;
      if (!nSt) {
        return res.status(404).json({ error: 'Convocação não encontrada ou fora do tenant.' });
      }

      res.json({ success: true, message: 'Status da convocação atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar status da convocação:', err);
      res.status(500).json({ error: 'Erro ao atualizar status da convocação.' });
    }
  },

  // Confirmar convocação (muda para CONFIRMADA e recusa todas as outras da mesma viagem)
  confirmarConvocacao: async (req, res) => {
    let transaction = null;
    try {
      const { id } = req.params;
      const userLogin = req.headers['user-login'] || (req.user && (req.user.login || req.user.SGUSUARIO));
      const sgUserConfirm = getSgUser(req);
      if (!sgUserConfirm) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      console.log(`[CONFIRMAR] Iniciando confirmação da convocação ${id} pelo usuário ${userLogin}`);

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para confirmar convocações.' });
      }

      const pool = await poolPromise;

      // Validar usuário existe e está ativo
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível confirmar convocações.' });
      }

      const tidConfirm = tenantIdForRequest(req);

      // Primeiro, buscar a convocação para obter o IDVIAGEM e o motorista (CDCADASTRO_MOTORISTA)
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
        .query(`
          SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS], [CDCADASTRO_MOTORISTA], [TENANT_ID],
                 [LATITUDE], [LONGITUDE], [SGUSER]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
        `);

      if (convocacaoResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = convocacaoResult.recordset[0];

      // Validar se a convocação está ACEITA (PG pode devolver casing/espacos diferentes)
      const statusConv = String(convocacao.STATUS ?? convocacao.status ?? '')
        .trim()
        .toUpperCase();
      if (statusConv !== 'ACEITA') {
        const msgExtra =
          statusConv === 'ACEITA_DESCARTADA'
            ? ' Esta convocação já foi marcada como aceita porém não selecionada.'
            : statusConv === 'CONFIRMADA'
              ? ' Esta convocação já está confirmada.'
              : '';
        return res.status(400).json({
          error: `Apenas convocações com status ACEITA podem ser confirmadas.${msgExtra}`
        });
      }

      const sgConfirm = String(convocacao.SGUSER ?? convocacao.sguser ?? '').trim().toUpperCase();
      const latConf = convocacao.LATITUDE ?? convocacao.latitude;
      const lngConf = convocacao.LONGITUDE ?? convocacao.longitude;
      const temGpsConfirm =
        latConf != null &&
        lngConf != null &&
        String(latConf).trim() !== '' &&
        String(lngConf).trim() !== '' &&
        Number.isFinite(Number(latConf)) &&
        Number.isFinite(Number(lngConf));
      if (sgConfirm === 'APP_MOTORISTA_LINK' && !temGpsConfirm) {
        return res.status(400).json({
          error:
            'Não é possível confirmar: o aceite veio do link da campanha e ainda não há GPS nesta convocação. Peça ao motorista «Atualizar localização» na página de oportunidades e recarregue a lista.',
          code: 'CONFIRMAR_SEM_GPS_LINK_CAMPANHA'
        });
      }

      // Verificar se já existe outra convocação CONFIRMADA para a mesma viagem
      const confirmadaResult = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), convocacao.IDVIAGEM)
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
        .query(`
          SELECT [IDCONVOCACAO]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDVIAGEM] = @IDVIAGEM
            AND [TENANT_ID] = @TENANT_ID
            AND [STATUS] = 'CONFIRMADA'
            AND [IDCONVOCACAO] != @IDCONVOCACAO
        `);

      if (confirmadaResult.recordset.length > 0) {
        return res.status(400).json({
          error: 'Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.'
        });
      }

      // Iniciar transação para garantir atomicidade (após todas as validações)
      transaction = await createTransaction(pool);
      await transaction.begin();
      console.log(`[CONFIRMAR] Transação iniciada para convocação ${id}`);

      try {
        let veiculosVinculadosConfirmacao = 0;
        // 1. Confirmar a convocação selecionada
        const request1 = transaction.request();
        await request1
          .input('IDCONVOCACAO_CONFIRM', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
          .input('SGUSUARIO_OPERADOR_CONFIRM', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserConfirm)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'CONFIRMADA',
                [DHRESPOSTA] = GETDATE(),
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_CONFIRM,
                [DHMAINTENANCE] = GETDATE(),
                [SGUSER] = @sgUser
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_CONFIRM AND [TENANT_ID] = @TENANT_ID
          `);

        // 2. NÃO recusar convocações PENDENTES automaticamente
        // Apenas manter como PENDENTE - não alterar status de quem não respondeu
        // Isso preserva o histórico correto: só marca como RECUSADA se o motorista realmente recusou

        // 3. Marcar outras convocações ACEITAS como DESCARTADAS (mantém histórico de aceite)
        const request3 = transaction.request();
        await request3
          .input('IDVIAGEM_DESCARTAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_EXCLUIR_DESC', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
          .input('SGUSUARIO_OPERADOR_DESC', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserConfirm)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'ACEITA_DESCARTADA',
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_DESC,
                [DHMAINTENANCE] = GETDATE(),
                [SGUSER] = @sgUser
            WHERE [IDVIAGEM] = @IDVIAGEM_DESCARTAR
              AND [TENANT_ID] = @TENANT_ID
              AND [IDCONVOCACAO] != @IDCONVOCACAO_EXCLUIR_DESC
              AND [STATUS] = 'ACEITA'
          `);

        // 4. Definir o motorista confirmado como motorista da viagem (VIAGEMMOTORISTA)
        const cdMotorista = convocacao.CDCADASTRO_MOTORISTA ?? convocacao.cdcadastro_motorista;
        if (cdMotorista != null) {
          const reqDelMot = transaction.request();
          await reqDelMot
            .input('IDVIAGEM_MOT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
            .query(`
              DELETE FROM [dbo].[VIAGEMMOTORISTA]
              WHERE [IDVIAGEM] = @IDVIAGEM_MOT
                AND EXISTS (
                  SELECT 1 FROM [dbo].[VIAGEMMESTRE] [v]
                  WHERE [v].[IDVIAGEM] = @IDVIAGEM_MOT AND [v].[TENANT_ID] = @TENANT_ID
                )
            `);
          const reqInsMot = transaction.request();
          await reqInsMot
            .input('IDVIAGEM_MOT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('CDMOTORISTA_MOT', sql.Decimal(15, 0), parseFloat(cdMotorista))
            .input('sgUser', sql.VarChar(50), sgUserConfirm)
            .query(`
              INSERT INTO [dbo].[VIAGEMMOTORISTA] ([IDVIAGEM], [CDMOTORISTA], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES (@IDVIAGEM_MOT, @CDMOTORISTA_MOT, GETDATE(), @sgUser, 'AppDVcargas')
            `);
          console.log(`[CONFIRMAR] Motorista ${cdMotorista} definido como motorista da viagem ${convocacao.IDVIAGEM}`);
        }

        // 4b. Vincular veículos do motorista à viagem (VIAGEMVEICULO), pelas mesmas placas esperadas da convocação
        if (cdMotorista != null) {
          try {
            veiculosVinculadosConfirmacao = await vincularVeiculosViagemAoConfirmarConvocacao(transaction, {
              idConvocacao: parseInt(id, 10),
              idViagem: convocacao.IDVIAGEM,
              cdMotorista,
              tenantId: tidConfirm,
              sgUser: sgUserConfirm,
            });
          } catch (eVinc) {
            console.warn('[CONFIRMAR] Vínculo automático de veículos à viagem ignorado:', eVinc.message);
          }
        }

        // 5. Atualizar situação da viagem para Programada (FGSITVIAGEM = 'P' e CDSITUACAOVIAGEM correspondente)
        const sitProgramada = await transaction.request()
          .query(`
            SELECT TOP 1 [CDSITUACAOVIAGEM] FROM [dbo].[SITUACAOVIAGEM]
            WHERE [FGSITVIAGEM] = 'P' AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
          `);
        const cdSituacaoProgramada = sitProgramada.recordset && sitProgramada.recordset[0]
          ? (sitProgramada.recordset[0].CDSITUACAOVIAGEM ?? sitProgramada.recordset[0].cdsituacaoviagem)
          : null;
        if (cdSituacaoProgramada != null) {
          const reqUpdViagem = transaction.request();
          await reqUpdViagem
            .input('IDVIAGEM_SIT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
            .input('FGSITVIAGEM_SIT', sql.VarChar(1), 'P')
            .input('CDSITUACAOVIAGEM_SIT', sql.SmallInt, cdSituacaoProgramada)
            .input('sgUser', sql.VarChar(50), sgUserConfirm)
            .query(`
              UPDATE [dbo].[VIAGEMMESTRE]
              SET [FGSITVIAGEM] = @FGSITVIAGEM_SIT,
                  [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM_SIT,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_SIT AND [TENANT_ID] = @TENANT_ID
            `);
          console.log(`[CONFIRMAR] Viagem ${convocacao.IDVIAGEM} atualizada para situação Programada`);
        } else {
          // Fallback: apenas FGSITVIAGEM se CDSITUACAOVIAGEM não existir na tabela de situações
          const reqUpdViagem = transaction.request();
          await reqUpdViagem
            .input('IDVIAGEM_SIT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
            .input('FGSITVIAGEM_SIT', sql.VarChar(1), 'P')
            .input('sgUser', sql.VarChar(50), sgUserConfirm)
            .query(`
              UPDATE [dbo].[VIAGEMMESTRE]
              SET [FGSITVIAGEM] = @FGSITVIAGEM_SIT,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_SIT AND [TENANT_ID] = @TENANT_ID
            `);
          console.log(`[CONFIRMAR] Viagem ${convocacao.IDVIAGEM} atualizada FGSITVIAGEM = P (CDSITUACAOVIAGEM não encontrado)`);
        }

        await transaction.commit();
        console.log(`[CONFIRMAR] Transação commitada com sucesso para convocação ${id}`);

        // Emitir evento WebSocket para atualização de viagem (motorista atribuído)
        try {
          const websocketTorre = req.app.get('websocketTorre');
          if (websocketTorre && convocacao.IDVIAGEM) {
            // Buscar dados atualizados da viagem com motorista confirmado
            const tidConv = convocacao.TENANT_ID != null ? String(convocacao.TENANT_ID) : String(tenantIdForRequest(req));
            const viagemAtualizada = await pool
              .request()
              .input('IDVIAGEM', sql.Decimal(15, 0), convocacao.IDVIAGEM)
              .input('TENANT_ID', sql.NVarChar(64), tidConv)
              .query(`
                SELECT 
                  v.[IDVIAGEM],
                  v.[FGSITVIAGEM],
                  v.[CDSITUACAOVIAGEM],
                  s.[DSSITUACAOVIAGEM],
                  v.[CDTIPOVIAGEM],
                  t.[DSTIPOVIAGEM],
                  v.[FGACTIVE],
                  v.[CDCLASSEFROTA],
                  cf.[DSCLASSEFROTA],
                  v.[DTPREVINICIO],
                  v.[DTPREVFINAL],
                  v.[IDROTEIRO],
                  r.[DSROTEIRO],
                  v.[DISTANCIAKM],
                  v.[VLFRETE],
                  co.[ESTADO] AS ORIGEM_ESTADO,
                  co.[NMCIDADE] AS ORIGEM_CIDADE,
                  cd.[ESTADO] AS DESTINO_ESTADO,
                  cd.[NMCIDADE] AS DESTINO_CIDADE,
                  cg.[CDCADASTRO] AS CDMOTORISTA,
                  upper(cg.[RZSOCIAL]) AS MOTORISTA_NOME,
                  cg.[NRCELULAR] AS MOTORISTA_CELULAR,
                  'S' AS TEM_CONFIRMADO
                FROM [dbo].[VIAGEMMESTRE] v
                LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON v.[CDSITUACAOVIAGEM] = s.[CDSITUACAOVIAGEM]
                  AND (s.[TENANT_ID] = v.[TENANT_ID] OR s.[TENANT_ID] = 'default')
                LEFT JOIN [dbo].[TIPOVIAGEM] t ON v.[CDTIPOVIAGEM] = t.[CDTIPOVIAGEM]
                  AND (t.[TENANT_ID] = v.[TENANT_ID] OR t.[TENANT_ID] = 'default')
                LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
                  AND (cf.[TENANT_ID] = v.[TENANT_ID] OR cf.[TENANT_ID] = 'default')
                LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
                  AND (r.[TENANT_ID] = v.[TENANT_ID] OR r.[TENANT_ID] = 'default')
                LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
                LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
                LEFT JOIN [dbo].[CONVOCACAO] c ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[STATUS] = 'CONFIRMADA' AND c.[TENANT_ID] = v.[TENANT_ID]
                LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
                WHERE v.[IDVIAGEM] = @IDVIAGEM AND v.[TENANT_ID] = @TENANT_ID
              `);

            if (viagemAtualizada.recordset && viagemAtualizada.recordset[0]) {
              const dadosViagem = viagemAtualizada.recordset[0];
              websocketTorre.emitirAtualizacaoViagem(convocacao.IDVIAGEM, dadosViagem);
              console.log(`📡 Evento WebSocket emitido: viagem ${convocacao.IDVIAGEM} atualizada (motorista confirmado)`);
            }
          }
        } catch (wsError) {
          // Não interromper resposta se WebSocket falhar
          console.warn('⚠️ Erro ao emitir evento WebSocket de confirmação:', wsError.message);
        }

        // Buscar dados do motorista confirmado para enviar WhatsApp (nome: RZSOCIAL ou NMFANTASIA)
        const tidMot = convocacao.TENANT_ID != null ? String(convocacao.TENANT_ID) : String(tenantIdForRequest(req));
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidMot)
          .query(`
            SELECT 
              upper(COALESCE(NULLIF(LTRIM(RTRIM(cg.[RZSOCIAL])), ''), LTRIM(RTRIM(cg.[NMFANTASIA])))) AS NOME_MOTORISTA,
              cg.[NRCELULAR],
              v.[IDVIAGEM],
              v.[DTPREVINICIO],
              v.[DTPREVFINAL],
              v.[CDCONTRATADOR],
              co.[NMCIDADE] AS ORIGEM_CIDADE,
              co.[ESTADO] AS ORIGEM_ESTADO,
              cd.[NMCIDADE] AS DESTINO_CIDADE,
              cd.[ESTADO] AS DESTINO_ESTADO,
              r.[DSROTEIRO],
              upper(contratador.[RZSOCIAL]) AS CONTRATADOR_NOME,
              contratador.[NRCELULAR] AS CONTRATADOR_CELULAR
            FROM [dbo].[CONVOCACAO] c
            INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
            INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[TENANT_ID] = v.[TENANT_ID]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO] AND (r.[TENANT_ID] = v.[TENANT_ID] OR r.[TENANT_ID] = 'default')
            LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
            LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
            LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.[CDCONTRATADOR] = contratador.[CDCADASTRO] AND contratador.[TENANT_ID] = v.[TENANT_ID]
            WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO_MOT AND c.[TENANT_ID] = @TENANT_ID
          `);

        // Contar quantas foram afetadas para mensagem
        const countAceitasDescartadas = await pool
          .request()
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidConfirm)
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM_COUNT
              AND [TENANT_ID] = @TENANT_ID
              AND [IDCONVOCACAO] != @IDCONVOCACAO_COUNT
              AND [STATUS] = 'ACEITA_DESCARTADA'
          `);

        let mensagem = `Convocação ${id} confirmada com sucesso!`;
        const aceitasDescartadas = countAceitasDescartadas.recordset[0]?.TOTAL || 0;

        if (aceitasDescartadas > 0) {
          mensagem += `\n\n${aceitasDescartadas} convocação(ões) ACEITA(S) marcada(s) como "Não Selecionada" (histórico preservado).`;
        }

        // Nota: Convocações PENDENTE permanecem como PENDENTE para preservar o histórico correto
        // Apenas convocações realmente RECUSADAS pelo motorista ficam como RECUSADA

        // Preparar dados para envio de WhatsApp (será feito no frontend)
        const motorista = motoristaResult.recordset[0];
        let whatsappLink = null;
        let textoMensagem = null; // Inicializar variável

        let templatesConvocacaoConfirm = {};
        try {
          templatesConvocacaoConfirm = await convocacaoMsgTpl.carregarTemplatesConvocacao(pool, tidMot);
        } catch (eTplC) {
          templatesConvocacaoConfirm = {
            [convocacaoMsgTpl.CHAVE_DISPARO]: '',
            [convocacaoMsgTpl.CHAVE_CONF_SELECIONADO]: '',
            [convocacaoMsgTpl.CHAVE_CONF_NAO_SELECIONADO]: '',
          };
        }

        let linkAppMotorista = '';
        if (motorista && motorista.NRCELULAR) {
          linkAppMotorista = (process.env.APP_URL || process.env.PUBLIC_URL || '').toString().trim();
          try {
            const tidCfg = tidMot;
            const cfgApp = await pool
              .request()
              .input('tid', sql.NVarChar(64), tidCfg)
              .input('k', sql.VarChar(50), 'link_app_motorista')
              .query(`
              SELECT [VALOR] FROM [dbo].[CONFIGURACAO] WHERE [TENANT_ID] = @tid AND [CHAVE] = @k
            `);
            const val = cfgApp.recordset && cfgApp.recordset[0] && (cfgApp.recordset[0].VALOR != null ? cfgApp.recordset[0].VALOR : cfgApp.recordset[0].valor);
            if (val && String(val).trim()) linkAppMotorista = String(val).trim();
          } catch (e) {}

          const celularFormatado = motorista.NRCELULAR.toString().replace(/\D/g, '');
          if (celularFormatado.length >= 10) {
            // Formatar datas (SQL Server retorna como string ISO)
            const formatarDataHora = (dataHora) => {
              if (!dataHora) return 'Não informado';

              try {
                // SQL Server retorna no formato: 2026-11-21T10:39:24.123Z ou 2026-11-21 10:39:24.123
                let dataStr = String(dataHora).replace('Z', '').replace('T', ' ');
                const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):?(\d{2})?/);

                if (match) {
                  const [, year, month, day, hour, minute] = match;
                  // Formatar manualmente para evitar problemas de timezone
                  return `${day}/${month}/${year} ${hour}:${minute}`;
                }

                // Fallback: extrair componentes UTC e tratar como local (sem conversão de fuso)
                const d = new Date(dataHora);
                if (isNaN(d.getTime())) return 'Data inválida';

                // Extrair componentes UTC e tratar como local (sem conversão de fuso)
                const ano = d.getUTCFullYear();
                const mes = d.getUTCMonth();
                const dia = d.getUTCDate();
                const hora = d.getUTCHours();
                const minuto = d.getUTCMinutes();

                // Formatar manualmente para pt-BR
                const diaStr = String(dia).padStart(2, '0');
                const mesStr = String(mes + 1).padStart(2, '0');
                const anoStr = ano;
                const horaStr = String(hora).padStart(2, '0');
                const minutoStr = String(minuto).padStart(2, '0');

                return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
              } catch (err) {
                return 'Data inválida';
              }
            };

            // Formatar telefone do contratador
            const formatarTelefone = (telefone) => {
              if (!telefone) return null;
              const tel = telefone.toString().replace(/\D/g, '');
              if (tel.length === 11) {
                return `(${tel.substring(0, 2)}) ${tel.substring(2, 7)}-${tel.substring(7)}`;
              } else if (tel.length === 10) {
                return `(${tel.substring(0, 2)}) ${tel.substring(2, 6)}-${tel.substring(6)}`;
              }
              return telefone.toString();
            };

            const contratadorNome = motorista.CONTRATADOR_NOME || null;
            const contratadorCelular = motorista.CONTRATADOR_CELULAR ? formatarTelefone(motorista.CONTRATADOR_CELULAR) : null;
            const contratadorCelularWhatsApp = motorista.CONTRATADOR_CELULAR ? motorista.CONTRATADOR_CELULAR.toString().replace(/\D/g, '') : null;

            // Nome: usar primeiro nome quando possível (chamar pelo nome sempre)
            const nomeMotorista = motorista.NOME_MOTORISTA ?? motorista.nome_motorista;
            const nomeCompleto = (nomeMotorista && String(nomeMotorista).trim()) ? String(nomeMotorista).trim() : 'Motorista';
            const primeiroNome = nomeCompleto.split(/\s+/)[0] || nomeCompleto;

            textoMensagem = convocacaoMsgTpl.resolverCorpoConfirmacaoSelecionado(
              templatesConvocacaoConfirm,
              primeiroNome,
              motorista.IDVIAGEM,
              linkAppMotorista
            );

            const numWa = celularFormatado.length >= 12 ? celularFormatado : '55' + celularFormatado;
            whatsappLink = `https://wa.me/${numWa}?text=${encodeURIComponent(textoMensagem)}`;
          }
        }

        // Garantir que textoMensagem está definido (fallback mínimo)
        if (!textoMensagem && motorista && motorista.NRCELULAR) {
          const nomeMot = motorista.NOME_MOTORISTA ?? motorista.nome_motorista;
          const nomeCompletoFallback = (nomeMot && String(nomeMot).trim()) ? String(nomeMot).trim() : 'Motorista';
          const primeiroNomeFallback = nomeCompletoFallback.split(/\s+/)[0] || nomeCompletoFallback;
          textoMensagem = convocacaoMsgTpl.resolverCorpoConfirmacaoSelecionado(
            templatesConvocacaoConfirm,
            primeiroNomeFallback,
            motorista.IDVIAGEM,
            linkAppMotorista
          );
        }

        // Enviar mensagens via Switch Digital (API): selecionado + não selecionados (ACEITA_DESCARTADA).
        // Se o Switch falhar, o front ainda recebe whatsappLink (wa.me) como fallback — não é "troca de canal por escolha", é reserva.
        const mensagensEnviadasViaWebhook = { selecionado: false, naoSelecionados: 0, erroSelecionado: null };
        try {
          if (motorista && motorista.NRCELULAR && textoMensagem) {
            const rSelecionado = await enviarUmaMensagemSwitchDigital(pool, req, {
              idConvocacao: parseInt(id),
              numeroCelular: motorista.NRCELULAR,
              corpoMensagem: textoMensagem,
              tenantId: tidMot
            });
            if (rSelecionado.ok) {
              mensagensEnviadasViaWebhook.selecionado = true;
              console.log(`[CONFIRMAR] Mensagem de confirmação enviada via Switch Digital para motorista selecionado (conv. ${id})`);
            } else {
              const errSel = rSelecionado.error || 'Erro desconhecido no Switch Digital';
              mensagensEnviadasViaWebhook.erroSelecionado = errSel;
              if (!errSel.includes('Token')) {
                console.warn('[CONFIRMAR] Falha ao enviar WhatsApp para selecionado (Switch Digital):', errSel);
              }
            }
          }
          // Buscar convocações ACEITA_DESCARTADA da mesma viagem para avisar que não foram escolhidos
          const descartadasResult = await pool.request()
            .input('IDVIAGEM_DESC', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('IDCONVOCACAO_CONF', sql.Int, parseInt(id))
            .query(`
              SELECT c.[IDCONVOCACAO], cg.[NRCELULAR], upper(COALESCE(NULLIF(LTRIM(RTRIM(cg.[RZSOCIAL])), ''), LTRIM(RTRIM(cg.[NMFANTASIA])))) AS NOME_MOTORISTA
              FROM [dbo].[CONVOCACAO] c
              INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO]
              WHERE c.[IDVIAGEM] = @IDVIAGEM_DESC
                AND c.[IDCONVOCACAO] != @IDCONVOCACAO_CONF
                AND c.[STATUS] = 'ACEITA_DESCARTADA'
            `);
          const descartadas = descartadasResult.recordset || [];
          for (const d of descartadas) {
            const nrCel = d.NRCELULAR ?? d.nrcelular;
            const nomeDesc = (d.NOME_MOTORISTA ?? d.nome_motorista);
            const nomeCompletoDesc = (nomeDesc && String(nomeDesc).trim()) ? String(nomeDesc).trim() : 'Motorista';
            const primeiroNomeDesc = nomeCompletoDesc.split(/\s+/)[0] || nomeCompletoDesc;
            if (nrCel && String(nrCel).replace(/\D/g, '').length >= 10) {
              const textoNaoSelecionado = convocacaoMsgTpl.resolverCorpoNaoSelecionado(
                templatesConvocacaoConfirm,
                primeiroNomeDesc,
                convocacao.IDVIAGEM
              );
              const rDesc = await enviarUmaMensagemSwitchDigital(pool, req, {
                idConvocacao: d.IDCONVOCACAO,
                numeroCelular: nrCel,
                corpoMensagem: textoNaoSelecionado,
                tenantId: tidMot
              });
              if (rDesc.ok) mensagensEnviadasViaWebhook.naoSelecionados++;
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          if (mensagensEnviadasViaWebhook.naoSelecionados > 0) {
            console.log(`[CONFIRMAR] ${mensagensEnviadasViaWebhook.naoSelecionados} mensagem(ns) "não selecionado" enviada(s) via Switch Digital`);
          }

          // Log resumo da confirmação em LOGSWEBHOOKMETA (aparece em "Atualizar Logs" junto com os envios individuais)
          try {
            const tipoResumo = !mensagensEnviadasViaWebhook.selecionado ? 'erro' : (mensagensEnviadasViaWebhook.naoSelecionados > 0 ? 'sucesso' : 'info');
            const errS = mensagensEnviadasViaWebhook.erroSelecionado;
            const msgResumo = mensagensEnviadasViaWebhook.selecionado
              ? `Selecionado: enviado. Não selecionados: ${mensagensEnviadasViaWebhook.naoSelecionados} enviado(s).`
              : (errS
                ? `Falha Switch Digital (selecionado): ${String(errS).substring(0, 280)}`
                : 'Falha ao enviar mensagem para o motorista selecionado.');
            const detalhesResumo = JSON.stringify(mensagensEnviadasViaWebhook).substring(0, 4000);
            await pool.request()
              .input('IDCONVOCACAO', sql.Int, parseInt(id))
              .input('TIPO', tipoResumo)
              .input('TITULO', 'Confirmação - Mensagens enviadas')
              .input('MENSAGEM', msgResumo)
              .input('DETALHES', detalhesResumo)
              .input('STATUS_HTTP', null)
              .input('TEMPO_RESPOSTA', null)
              .input('sgUser', sql.VarChar(50), sgUserConfirm)
              .query(`
                INSERT INTO [dbo].[LOGSWEBHOOKMETA]
                  ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
                VALUES
                  (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
              `);
          } catch (logResumoErr) {
            console.warn('[CONFIRMAR] Erro ao gravar log resumo confirmação:', logResumoErr.message);
          }
        } catch (webhookErr) {
          console.warn('[CONFIRMAR] Erro ao enviar mensagens via webhook:', webhookErr.message);
        }

        res.json({
          success: true,
          message: mensagem,
          whatsappLink: whatsappLink,
          mensagemConfirmacao: textoMensagem || null,
          motorista: motorista ? {
            nome: motorista.NOME_MOTORISTA,
            celular: motorista.NRCELULAR
          } : null,
          mensagensEnviadasViaWebhook: mensagensEnviadasViaWebhook,
          veiculosVinculadosConfirmacao,
        });
      } catch (err) {
        const idConv = req.params && req.params.id;
        console.error(`[CONFIRMAR] Erro na transação para convocação ${idConv}:`, err);
        if (transaction) {
          await transaction.rollback().catch(rollbackErr => {
            console.error(`[CONFIRMAR] Erro ao fazer rollback:`, rollbackErr);
          });
        }
        throw err;
      }
    } catch (err) {
      const idConv = req.params && req.params.id;
      if (transaction) {
        await transaction.rollback().catch(() => {
          // Ignorar erro se já foi feito rollback
        });
      }
      console.error(`[CONFIRMAR] Erro ao confirmar convocação ${idConv}:`, err);
      console.error(`[CONFIRMAR] Stack trace:`, err.stack);
      res.status(500).json({
        error: 'Erro ao confirmar convocação.',
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  },

  // Buscar convocação pública (para motorista acessar)
  buscarConvocacaoPublica: async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`[CONVOCACAO PUBLICA] Buscando convocação ID: ${id}`);

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'ID de convocação inválido.' });
      }

      const pool = await poolPromise;
      const sqlConvPubPlacasExtra = `,
            c.[FGCONFIRMACAOPLACAS],
            c.[TXTPLACASDIVERGENCIA],
            c.[DHCONFIRMACAOPLACAS],
            (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
            (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]`;
      const sqlConvPub = `
          SELECT 
            c.[IDCONVOCACAO],
            c.[IDVIAGEM],
            c.[TENANT_ID],
            c.[STATUS],
            c.[DHCONVOCACAO],
            c.[DHACESSO],
            c.[LATITUDE],
            c.[LONGITUDE],
            c.[DH_LOCALIZACAO_MOTORISTA],
            v.[CDCLASSEFROTA],
            v.[DTPREVINICIO],
            v.[DTPREVFINAL],
            v.[FGRASTREADO],
            v.[OBSERV],
            v.[VLFRETE],
            COALESCE(v.[MOEDA], 'BRL') AS [MOEDA],
            c.[VL_FRETE_PROPOSTO_MOTORISTA],
            v.[PESO],
            v.[CUBAGEM],
            upper(cg.[RZSOCIAL]) AS NOME_MOTORISTA,
            cg.[NRCELULAR],
            cf.[DSCLASSEFROTA],
            r.[CDCIDADEORIGEM],
            r.[CDCIDADEDESTINO],
            co.[NMCIDADE] AS ORIGEM_CIDADE,
            co.[ESTADO] AS ORIGEM_ESTADO,
            cd.[NMCIDADE] AS DESTINO_CIDADE,
            cd.[ESTADO] AS DESTINO_ESTADO,
            tv.[DSTIPOVIAGEM],
            v.[CDCONTRATADOR],
            upper(contratador.[RZSOCIAL]) AS CONTRATADOR_NOME,
            contratador.[NRCELULAR] AS CONTRATADOR_CELULAR,
            r.[DSROTEIRO],
            v.[IDROTEIRO],
            CASE 
              WHEN EXISTS (
                SELECT 1 
                FROM [dbo].[CONVOCACAO] c2 
                WHERE c2.[IDVIAGEM] = c.[IDVIAGEM] 
                  AND c2.[TENANT_ID] = c.[TENANT_ID]
                  AND c2.[STATUS] = 'CONFIRMADA'
                  AND c2.[IDCONVOCACAO] != c.[IDCONVOCACAO]
              ) THEN 1 
              ELSE 0 
            END AS [VIAGEM_JA_CONFIRMADA]
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[TENANT_ID] = v.[TENANT_ID]
          INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
            AND (cf.[TENANT_ID] = v.[TENANT_ID] OR cf.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO] AND (r.[TENANT_ID] = v.[TENANT_ID] OR r.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
          LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
            AND (tv.[TENANT_ID] = v.[TENANT_ID] OR tv.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.[CDCONTRATADOR] = contratador.[CDCADASTRO] 
            AND contratador.[TENANT_ID] = v.[TENANT_ID]
            AND contratador.[FGACTIVE] = 'A'
          WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO
        `;
      const sqlConvPubComPlacas = sqlConvPub.replace(
        /END AS \[VIAGEM_JA_CONFIRMADA\]\s*\n\s*FROM \[dbo\]\.\[CONVOCACAO\] c/,
        'END AS [VIAGEM_JA_CONFIRMADA]' + sqlConvPubPlacasExtra + '\n          FROM [dbo].[CONVOCACAO] c'
      );
      const stripSqlColVlFreteProp = (sqlStr) =>
        sqlStr.replace(/\s*,\s*c\.\[VL_FRETE_PROPOSTO_MOTORISTA\]\s*\n/gi, '\n');
      const sqlConvPubSemDh = sqlConvPub.replace(/\s*,\s*c\.\[DH_LOCALIZACAO_MOTORISTA\]\s*/i, '\n            ');
      const sqlConvPubSemVlProp = stripSqlColVlFreteProp(sqlConvPub);
      const sqlConvPubSemDhSemVlProp = stripSqlColVlFreteProp(sqlConvPubSemDh);
      const sqlConvPubComPlacasSemDh = sqlConvPubComPlacas.replace(/\s*,\s*c\.\[DH_LOCALIZACAO_MOTORISTA\]\s*/i, '\n            ');
      const sqlConvPubComPlacasSemVlProp = stripSqlColVlFreteProp(sqlConvPubComPlacas);
      const sqlConvPubComPlacasSemDhSemVlProp = stripSqlColVlFreteProp(sqlConvPubComPlacasSemDh);
      let usedFallbackSemDhColuna = false;
      let result;
      const reqPub = () => pool.request().input('IDCONVOCACAO', sql.Int, parseInt(id));
      const placas427 = (msg) =>
        /fgconfirmacaoplacas|txtplacasdivergencia|dhconfirmacaoplacas|placasesperadas|dsclassefrota_conjunto|viagemveiculo|motorista_veiculo|statusaprovacao|cdequipamento|equipamento/i.test(
          String(msg || '')
        );

      async function queryPubComFallbackPlacas(sqlCom, sqlSem) {
        try {
          return await reqPub().query(sqlCom);
        } catch (e) {
          if (e.code === '42703' && placas427(e.message)) {
            return await reqPub().query(sqlSem);
          }
          throw e;
        }
      }

      try {
        result = await queryPubComFallbackPlacas(sqlConvPubComPlacas, sqlConvPub);
      } catch (err) {
        const em = String(err.message || '');
        if (err.code === '42703' && /localizacao_motorista/i.test(em)) {
          usedFallbackSemDhColuna = true;
          try {
            result = await queryPubComFallbackPlacas(sqlConvPubComPlacasSemDh, sqlConvPubSemDh);
          } catch (err2) {
            const em2 = String(err2.message || '');
            if (err2.code === '42703' && /vl_frete_proposto/i.test(em2)) {
              result = await queryPubComFallbackPlacas(sqlConvPubComPlacasSemDhSemVlProp, sqlConvPubSemDhSemVlProp);
            } else throw err2;
          }
        } else if (err.code === '42703' && /vl_frete_proposto/i.test(em)) {
          try {
            result = await queryPubComFallbackPlacas(sqlConvPubComPlacasSemVlProp, sqlConvPubSemVlProp);
          } catch (err2) {
            const em2 = String(err2.message || '');
            if (err2.code === '42703' && /localizacao_motorista/i.test(em2)) {
              usedFallbackSemDhColuna = true;
              result = await queryPubComFallbackPlacas(sqlConvPubComPlacasSemDhSemVlProp, sqlConvPubSemDhSemVlProp);
            } else throw err2;
          }
        } else {
          throw err;
        }
      }

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = result.recordset[0];
      // PostgreSQL (pg) devolve nomes de colunas em minúsculas; o front/API esperam UPPER_SNAKE.
      if (convocacao.CONTRATADOR_NOME == null && convocacao.contratador_nome != null) {
        convocacao.CONTRATADOR_NOME = convocacao.contratador_nome;
      }
      if (convocacao.CONTRATADOR_CELULAR == null && convocacao.contratador_celular != null) {
        convocacao.CONTRATADOR_CELULAR = convocacao.contratador_celular;
      }
      if (convocacao.CDCONTRATADOR == null && convocacao.cdcontratador != null) {
        convocacao.CDCONTRATADOR = convocacao.cdcontratador;
      }

      // Se o JOIN não trouxe contratador (ex.: FGACTIVE != 'A' no cadastro), buscar diretamente.
      if (!convocacao.CONTRATADOR_NOME && convocacao.CDCONTRATADOR != null && convocacao.CDCONTRATADOR !== '') {
        try {
          const tidContr = convocacao.TENANT_ID != null ? String(convocacao.TENANT_ID) : (convocacao.tenant_id != null ? String(convocacao.tenant_id) : null);
          const cdContr = parseFloat(convocacao.CDCONTRATADOR);
          let contratadorResult = await pool
            .request()
            .input('CDCONTRATADOR', sql.Decimal(15, 0), cdContr)
            .input('TENANT_ID', sql.NVarChar(64), tidContr || tenantIdForRequest(req))
            .query(`
              SELECT upper([RZSOCIAL]) AS [RZSOCIAL], [NRCELULAR], [FGACTIVE]
              FROM [dbo].[CADASTROGERAL]
              WHERE [CDCADASTRO] = @CDCONTRATADOR AND [TENANT_ID] = @TENANT_ID AND [FGACTIVE] = 'A'
            `);

          if (contratadorResult.recordset.length === 0) {
            contratadorResult = await pool
              .request()
              .input('CDCONTRATADOR', sql.Decimal(15, 0), cdContr)
              .input('TENANT_ID', sql.NVarChar(64), tidContr || tenantIdForRequest(req))
              .query(`
                SELECT upper([RZSOCIAL]) AS [RZSOCIAL], [NRCELULAR], [FGACTIVE]
                FROM [dbo].[CADASTROGERAL]
                WHERE [CDCADASTRO] = @CDCONTRATADOR AND [TENANT_ID] = @TENANT_ID
              `);
          }

          if (contratadorResult.recordset.length > 0) {
            const contratador = contratadorResult.recordset[0];
            convocacao.CONTRATADOR_NOME = contratador.RZSOCIAL ?? contratador.rzsocial;
            convocacao.CONTRATADOR_CELULAR = contratador.NRCELULAR ?? contratador.nrcelular;
          } else {
            console.warn(
              '[CONVOCACAO PUBLICA] Contratador não encontrado no cadastro (CDCONTRATADOR=',
              convocacao.CDCONTRATADOR,
              ').'
            );
          }
        } catch (err) {
          console.error('[CONVOCACAO PUBLICA] Erro ao buscar contratador (fallback):', err.message);
        }
      }

      // Fallback: se origem/destino vierem vazios mas houver DSROTEIRO, tentar extrair trechos (origem -> destino)
      const temOrigemDestino = convocacao.ORIGEM_CIDADE || convocacao.DESTINO_CIDADE;
      if (!temOrigemDestino && convocacao.DSROTEIRO) {
        const ds = (convocacao.DSROTEIRO || '').trim();
        // Separadores: " -> ", " → ", " - " (espaço-hífen-espaço), " / " — evita quebrar hífen no nome da cidade
        const match = ds.match(/^(.+?)\s*(?:->|→|\s-\s|\/)\s*(.+)$/);
        if (match) {
          convocacao.ORIGEM_CIDADE = match[1].trim();
          convocacao.ORIGEM_ESTADO = '';
          convocacao.DESTINO_CIDADE = match[2].trim();
          convocacao.DESTINO_ESTADO = '';
        } else {
          convocacao.ORIGEM_CIDADE = ds;
          convocacao.ORIGEM_ESTADO = '';
          convocacao.DESTINO_CIDADE = '';
          convocacao.DESTINO_ESTADO = '';
        }
      }

      console.log(`[CONVOCACAO PUBLICA] Convocação encontrada: ID ${id}, Status: ${convocacao.STATUS}`);
      const convocacaoPublica = { ...convocacao };
      const rawTidPub =
        convocacao.TENANT_ID != null
          ? String(convocacao.TENANT_ID)
          : convocacao.tenant_id != null
            ? String(convocacao.tenant_id)
            : '';
      const tidPub =
        rawTidPub.trim() !== '' ? rawTidPub.trim() : getDefaultTenantId();
      let ctxPub = { pais: 'BR' };
      try {
        ctxPub = await getContexto(tidPub);
      } catch (_) {
        ctxPub = { pais: 'BR' };
      }
      const paisPadraoPub = ctxPub.pais || 'BR';
      delete convocacaoPublica.TENANT_ID;
      delete convocacaoPublica.tenant_id;
      convocacaoPublica.paisPadrao = paisPadraoPub;
      const nrMot =
        convocacao.NRCELULAR != null
          ? String(convocacao.NRCELULAR)
          : convocacao.nrcelular != null
            ? String(convocacao.nrcelular)
            : '';
      const digMot = isPaisBrTelefone(paisPadraoPub)
        ? normalizarDigitosTelefoneBR(nrMot)
        : normalizarDigitosSoNumeros(nrMot);
      convocacaoPublica.celularCadastroFinal4 =
        digMot.length >= 4 ? digMot.slice(-4) : null;
      convocacaoPublica.exigeConfirmacaoCelular = true;
      const dhLoc =
        convocacao.DH_LOCALIZACAO_MOTORISTA ?? convocacao.dh_localizacao_motorista;
      const latC = convocacao.LATITUDE ?? convocacao.latitude;
      const lonC = convocacao.LONGITUDE ?? convocacao.longitude;
      const temLatLon =
        latC != null && lonC != null && String(latC).trim() !== '' && String(lonC).trim() !== '';
      // Aceite libera com DH_LOCALIZACAO_MOTORISTA ou, em legado, lat/lon já gravados no acesso.
      convocacaoPublica.localizacaoMotoristaEnviada = usedFallbackSemDhColuna
        ? temLatLon
        : (dhLoc != null && String(dhLoc).trim() !== '') || temLatLon;
      delete convocacaoPublica.NRCELULAR;
      delete convocacaoPublica.nrcelular;
      res.json(convocacaoPublica);
    } catch (err) {
      console.error(`[CONVOCACAO PUBLICA] Erro ao buscar convocação ID ${req.params.id}:`, err);
      console.error('[CONVOCACAO PUBLICA] Stack trace:', err.stack);
      res.status(500).json({
        error: 'Erro ao buscar convocação.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  /**
   * Lista pontos do roteiro da viagem vinculada à convocação (página pública, sem JWT).
   * Evita expor GET /api/roteiros/:id/pontos sem autenticação (enumerável entre tenants).
   */
  listarPontosRoteiroConvocacaoPublica: async (req, res) => {
    try {
      const idConv = parseInt(req.params.id, 10);
      if (!Number.isFinite(idConv) || idConv <= 0) {
        return res.status(400).json({ error: 'ID de convocação inválido.' });
      }
      const pool = await poolPromise;
      const sub = `
        SELECT v."IDROTEIRO"
        FROM "CONVOCACAO" c
        INNER JOIN "VIAGEMMESTRE" v ON c."IDVIAGEM" = v."IDVIAGEM" AND c."TENANT_ID" = v."TENANT_ID"
        WHERE c."IDCONVOCACAO" = $1
        LIMIT 1
      `;
      const vr = await pool.query(sub, [idConv]);
      if (!vr.rows || vr.rows.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }
      const idRoteiro = vr.rows[0].IDROTEIRO ?? vr.rows[0].idroteiro;
      if (idRoteiro == null || idRoteiro === '' || (typeof idRoteiro === 'number' && !Number.isFinite(idRoteiro))) {
        return res.json([]);
      }
      const r2 = await pool.query(
        `SELECT 
          rp."IDROTEIRO", rp."SEQUENCIA", rp."ORDEM", rp."DSLOCAL", rp."DSPOSICAO",
          rp."LATITUDE", rp."LONGITUDE", rp."TPLOCAL", rp."KMENTREPONTOS",
          rp."CDPAISPASSAGEM", rp."ESTADOPASSAGEM", rp."DHMAINTENANCE", rp."SGUSER", rp."SERVERORIG"
         FROM "ROTEIROPONTOS" rp
         WHERE rp."IDROTEIRO" = $1::numeric
         ORDER BY rp."ORDEM" ASC NULLS LAST, rp."SEQUENCIA" ASC NULLS LAST`,
        [idRoteiro]
      );
      res.json(r2.rows || []);
    } catch (err) {
      console.error('[CONVOCACAO PUBLICA] roteiro-pontos:', err);
      res.status(500).json({ error: 'Erro ao carregar pontos do roteiro.' });
    }
  },

  // Registrar acesso à convocação (quando motorista abre o link)
  // DHACESSO é atualizado quando o motorista acessa o link (primeiro acesso)
  // DHRESPOSTA é atualizado apenas quando o motorista responde (aceita/recusa)
  // LATITUDE e LONGITUDE são atualizados com a localização do motorista
  registrarAcessoConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;
      const pool = await poolPromise;
      const idConv = parseInt(id, 10);
      const temCoords =
        latitude !== undefined &&
        latitude !== null &&
        String(latitude).trim() !== '' &&
        longitude !== undefined &&
        longitude !== null &&
        String(longitude).trim() !== '';

      console.log(`[REGISTRAR ACESSO] ID Convocação: ${id}, Lat: ${latitude}, Long: ${longitude}`);

      // Com GPS: grava lat/lon + DH_LOCALIZACAO_MOTORISTA (mesmo critério do aceite / atualizar-localizacao).
      // Sem isso o acesso salvava só coordenadas e o botão Aceitar permanecia bloqueado.
      let result;
      if (temCoords) {
        const latN = parseFloat(latitude);
        const lonN = parseFloat(longitude);
        const queryComDh = `
          UPDATE [dbo].[CONVOCACAO]
          SET [DHACESSO] = CASE WHEN [DHACESSO] IS NULL THEN CURRENT_TIMESTAMP ELSE [DHACESSO] END,
              [DHMAINTENANCE] = CURRENT_TIMESTAMP,
              [SGUSER] = 'MOTORISTA',
              [LATITUDE] = @LATITUDE,
              [LONGITUDE] = @LONGITUDE,
              [DH_LOCALIZACAO_MOTORISTA] = CURRENT_TIMESTAMP
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `;
        const querySemDh = `
          UPDATE [dbo].[CONVOCACAO]
          SET [DHACESSO] = CASE WHEN [DHACESSO] IS NULL THEN CURRENT_TIMESTAMP ELSE [DHACESSO] END,
              [DHMAINTENANCE] = CURRENT_TIMESTAMP,
              [SGUSER] = 'MOTORISTA',
              [LATITUDE] = @LATITUDE,
              [LONGITUDE] = @LONGITUDE
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `;
        try {
          result = await pool
            .request()
            .input('IDCONVOCACAO', sql.Int, idConv)
            .input('LATITUDE', sql.Float, latN)
            .input('LONGITUDE', sql.Float, lonN)
            .query(queryComDh);
        } catch (e) {
          if (e.code === '42703' && /localizacao_motorista/i.test(String(e.message))) {
            console.warn('[REGISTRAR ACESSO] Coluna DH_LOCALIZACAO_MOTORISTA ausente — fallback sem DH');
            result = await pool
              .request()
              .input('IDCONVOCACAO', sql.Int, idConv)
              .input('LATITUDE', sql.Float, latN)
              .input('LONGITUDE', sql.Float, lonN)
              .query(querySemDh);
          } else {
            throw e;
          }
        }
      } else {
        const query = `
          UPDATE [dbo].[CONVOCACAO]
          SET [DHACESSO] = CASE WHEN [DHACESSO] IS NULL THEN CURRENT_TIMESTAMP ELSE [DHACESSO] END,
              [DHMAINTENANCE] = CURRENT_TIMESTAMP,
              [SGUSER] = 'MOTORISTA'
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `;
        result = await pool.request().input('IDCONVOCACAO', sql.Int, idConv).query(query);
      }

      console.log(`[REGISTRAR ACESSO] Linhas afetadas: ${result.rowsAffected[0]}`);

      res.json({
        success: true,
        message: 'Acesso registrado com sucesso',
        idConvocacao: idConv,
        localizacaoRegistrada: temCoords
      });
    } catch (error) {
      console.error('[REGISTRAR ACESSO] Erro:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao registrar acesso',
        error: error.message
      });
    }
  },

  // Atualizar localização da convocação (manual)
  atualizarLocalizacaoConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;
      const pool = await poolPromise;

      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'Latitude e longitude são obrigatórios'
        });
      }

      console.log(`[ATUALIZAR LOCALIZAÇÃO] ID Convocação: ${id}, Lat: ${latitude}, Long: ${longitude}`);

      const queryComDh = `
        UPDATE [dbo].[CONVOCACAO]
        SET [LATITUDE] = @LATITUDE,
            [LONGITUDE] = @LONGITUDE,
            [DH_LOCALIZACAO_MOTORISTA] = GETDATE(),
            [DHMAINTENANCE] = GETDATE(),
            [SGUSER] = 'MOTORISTA'
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `;
      const querySemDh = `
        UPDATE [dbo].[CONVOCACAO]
        SET [LATITUDE] = @LATITUDE,
            [LONGITUDE] = @LONGITUDE,
            [DHMAINTENANCE] = GETDATE(),
            [SGUSER] = 'MOTORISTA'
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `;

      const reqUp = pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('LATITUDE', sql.Float, parseFloat(latitude))
        .input('LONGITUDE', sql.Float, parseFloat(longitude));
      let result;
      try {
        result = await reqUp.query(queryComDh);
      } catch (e) {
        if (e.code === '42703' && /localizacao_motorista/i.test(String(e.message))) {
          console.warn('[ATUALIZAR LOCALIZAÇÃO] Coluna DH_LOCALIZACAO_MOTORISTA ausente — rode o script convocacao_dh_localizacao_motorista_postgres.sql');
          result = await pool
            .request()
            .input('IDCONVOCACAO', sql.Int, parseInt(id))
            .input('LATITUDE', sql.Float, parseFloat(latitude))
            .input('LONGITUDE', sql.Float, parseFloat(longitude))
            .query(querySemDh);
        } else {
          throw e;
        }
      }

      console.log(`[ATUALIZAR LOCALIZAÇÃO] Linhas afetadas: ${result.rowsAffected[0]}`);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({
          success: false,
          message: 'Convocação não encontrada'
        });
      }

      res.json({
        success: true,
        message: 'Localização atualizada com sucesso',
        idConvocacao: parseInt(id),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      });
    } catch (error) {
      console.error('[ATUALIZAR LOCALIZAÇÃO] Erro:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao atualizar localização',
        error: error.message
      });
    }
  },

  // Reativar convocação (reverter CONFIRMADA ou ACEITA_DESCARTADA para ACEITA)
  reativarConvocacao: async (req, res) => {
    let transaction = null;
    try {
      const { id } = req.params;
      const { motivoReabertura } = req.body;
      let userLogin = req.headers['user-login'];
      const sgUserReativar = getSgUser(req);
      if (!sgUserReativar && !userLogin) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      // Se não enviou user-login mas temos no token (via middleware), preenche
      if (!userLogin && sgUserReativar) {
         userLogin = sgUserReativar;
      }

      console.log(`[REATIVAR] Iniciando reativação da convocação ${id} pelo usuário ${userLogin}`);

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para reativar convocações.' });
      }

      if (!motivoReabertura) {
        return res.status(400).json({ error: 'Motivo da reabertura é obrigatório.' });
      }

      const pool = await poolPromise;
      const tidReat = tenantIdForRequest(req);

      // Validar usuário existe e está ativo
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível reativar convocações.' });
      }

      // Buscar a convocação
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidReat)
        .query(`
          SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
        `);

      if (convocacaoResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = convocacaoResult.recordset[0];

      // Validar se a convocação pode ser reativada (deve estar CONFIRMADA)
      // As ACEITA_DESCARTADA serão atualizadas automaticamente
      if (convocacao.STATUS !== 'CONFIRMADA') {
        return res.status(400).json({
          error: `Apenas convocações com status CONFIRMADA podem ser reativadas. Status atual: ${convocacao.STATUS}`
        });
      }

      // Validar se o motivo existe
      const motivoResult = await pool
        .request()
        .input('CDMOTIVO', sql.Int, parseInt(motivoReabertura))
        .query(`
          SELECT "CDMOTIVO", "DSMOTIVO"
          FROM "MOTIVOREABERTURA"
          WHERE "CDMOTIVO" = @CDMOTIVO AND "FGACTIVE" = 'A'
        `);

      if (motivoResult.recordset.length === 0) {
        return res.status(400).json({ error: 'Motivo de reabertura inválido ou inativo.' });
      }

      // Iniciar transação
      transaction = await createTransaction(pool);
      await transaction.begin();
      console.log(`[REATIVAR] Transação iniciada para convocação ${id}`);

      try {
        // 1. Buscar dados do motorista para o histórico
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidReat)
          .query(`
            SELECT [CDCADASTRO_MOTORISTA]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_MOT AND [TENANT_ID] = @TENANT_ID
          `);

        const motorista = motoristaResult.recordset[0];

        // 2. Registrar histórico de reabertura (apenas para CONFIRMADA)
        if (convocacao.STATUS === 'CONFIRMADA' && motorista) {
          const requestHist = transaction.request();
          await requestHist
            .input('IDCONVOCACAO_HIST', sql.Int, parseInt(id))
            .input('IDVIAGEM_HIST', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('CDCADASTRO_MOTORISTA_HIST', sql.Decimal(15, 0), motorista.CDCADASTRO_MOTORISTA)
            .input('STATUS_ANTERIOR_HIST', sql.VarChar(20), convocacao.STATUS)
            .input('CDMOTIVOREABERTURA_HIST', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_HIST', sql.VarChar(50), userLogin)
            .query(`
              INSERT INTO [dbo].[HISTORICOREABERTURA] (
                [IDCONVOCACAO], [IDVIAGEM], [CDCADASTRO_MOTORISTA], [STATUS_ANTERIOR],
                [CDMOTIVOREABERTURA], [DHRABERTURA], [SGUSUARIO_OPERADOR],
                [FGACTIVE], [DHINCLUSAO], [SGUSERINCLUSAO], [SERVERORIG]
              )
              VALUES (
                @IDCONVOCACAO_HIST, @IDVIAGEM_HIST, @CDCADASTRO_MOTORISTA_HIST, @STATUS_ANTERIOR_HIST,
                @CDMOTIVOREABERTURA_HIST, CURRENT_TIMESTAMP, @SGUSUARIO_OPERADOR_HIST,
                'A', CURRENT_TIMESTAMP, @SGUSUARIO_OPERADOR_HIST, 'AppDVcargas'
              )
            `);
        }

        // 3. Reativar a convocação CONFIRMADA (mudar status para ACEITA)
        const request1 = transaction.request();
        await request1
          .input('IDCONVOCACAO_REATIVAR', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidReat)
          .input('CDMOTIVOREABERTURA', sql.Int, parseInt(motivoReabertura))
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserReativar)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'ACEITA',
                [CDMOTIVOREABERTURA] = @CDMOTIVOREABERTURA,
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR,
                [DHMAINTENANCE] = CURRENT_TIMESTAMP,
                [SGUSER] = @sgUser
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_REATIVAR AND [TENANT_ID] = @TENANT_ID
          `);

        // 4. Contar quantas convocações ACEITA_DESCARTADA serão reativadas
        const countRequest = transaction.request();
        const countResult = await countRequest
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .input('TENANT_ID', sql.NVarChar(64), tidReat)
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM_COUNT
              AND [TENANT_ID] = @TENANT_ID
              AND [IDCONVOCACAO] != @IDCONVOCACAO_COUNT
              AND [STATUS] = 'ACEITA_DESCARTADA'
          `);

        const totalReativadas = countResult.recordset[0]?.TOTAL || 0;

        // 5. Reativar automaticamente as outras convocações ACEITA_DESCARTADA da mesma viagem
        if (totalReativadas > 0) {
          const request2 = transaction.request();
          await request2
            .input('IDVIAGEM_REATIVAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('IDCONVOCACAO_EXCLUIR', sql.Int, parseInt(id))
            .input('TENANT_ID', sql.NVarChar(64), tidReat)
            .input('CDMOTIVOREABERTURA_AUTO', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_AUTO', sql.VarChar(50), userLogin)
            .input('sgUser', sql.VarChar(50), sgUserReativar)
            .query(`
              UPDATE [dbo].[CONVOCACAO]
              SET [STATUS] = 'ACEITA',
                  [CDMOTIVOREABERTURA] = @CDMOTIVOREABERTURA_AUTO,
                  [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_AUTO,
                  [DHMAINTENANCE] = CURRENT_TIMESTAMP,
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_REATIVAR
                AND [TENANT_ID] = @TENANT_ID
                AND [IDCONVOCACAO] != @IDCONVOCACAO_EXCLUIR
                AND [STATUS] = 'ACEITA_DESCARTADA'
            `);
        }

        await transaction.commit();
        console.log(`[REATIVAR] Transação commitada com sucesso para convocação ${id}`);

        const motivo = motivoResult.recordset[0];

        let mensagem = `Convocação ${id} reativada com sucesso. Motivo: ${motivo.DSMOTIVO}`;
        if (totalReativadas > 0) {
          mensagem += `\n\n${totalReativadas} convocação(ões) ACEITA (Não Selecionada) também foram reativada(s) automaticamente.`;
        }

        res.json({
          success: true,
          message: mensagem,
          statusAnterior: convocacao.STATUS,
          statusNovo: 'ACEITA',
          motivo: motivo.DSMOTIVO,
          motivoCodigo: motivo.CDMOTIVO,
          idViagem: convocacao.IDVIAGEM,
          totalReativadas: totalReativadas
        });

      } catch (err) {
        if (transaction) {
          await transaction.rollback();
          console.log(`[REATIVAR] Transação revertida para convocação ${id}`);
        }
        throw err;
      }

    } catch (err) {
      console.error('[REATIVAR] Erro ao reativar convocação:', err);
      res.status(500).json({
        error: 'Erro ao reativar convocação.',
        details: err.message
      });
    }
  },

  // Listar histórico de reabertura de uma convocação
  listarHistoricoReabertura: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const tidHistReab = tenantIdForRequest(req);
      const reqParam = pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidHistReab);

      const queryUpper = `
        SELECT 
          [h].[IDHISTORICO],
          [h].[IDCONVOCACAO],
          [h].[IDVIAGEM],
          [h].[CDCADASTRO_MOTORISTA],
          upper([cg].[RZSOCIAL]) AS [NOME_MOTORISTA],
          [h].[STATUS_ANTERIOR],
          [h].[CDMOTIVOREABERTURA],
          [mr].[DSMOTIVO] AS [MOTIVO_REABERTURA],
          [h].[DHRABERTURA],
          [h].[SGUSUARIO_OPERADOR],
          [h].[OBSERVACAO]
        FROM [dbo].[HISTORICOREABERTURA] [h]
        INNER JOIN [dbo].[CONVOCACAO] [conv] ON [h].[IDCONVOCACAO] = [conv].[IDCONVOCACAO] AND [conv].[TENANT_ID] = @TENANT_ID
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [h].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [conv].[TENANT_ID]
        LEFT JOIN [dbo].[MOTIVOREABERTURA] [mr] ON [h].[CDMOTIVOREABERTURA] = [mr].[CDMOTIVO]
        WHERE [h].[IDCONVOCACAO] = @IDCONVOCACAO
          AND [h].[FGACTIVE] = 'A'
        ORDER BY [h].[DHRABERTURA] DESC
      `;
      const queryLower = `
        SELECT 
          [h].[idhistorico],
          [h].[idconvocacao],
          [h].[idviagem],
          [h].[cdcadastro_motorista],
          upper([cg].[rzsocial]) AS [NOME_MOTORISTA],
          [h].[status_anterior],
          [h].[cdmotivoreabertura],
          [mr].[dsmotivo] AS [MOTIVO_REABERTURA],
          [h].[dhrabertura],
          [h].[sgusuario_operador],
          [h].[observacao]
        FROM [dbo].[HISTORICOREABERTURA] [h]
        INNER JOIN [dbo].[CONVOCACAO] [conv] ON [h].[idconvocacao] = [conv].[idconvocacao] AND [conv].[tenant_id] = @TENANT_ID
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [h].[cdcadastro_motorista] = [cg].[cdcadastro] AND [cg].[tenant_id] = [conv].[tenant_id]
        LEFT JOIN [dbo].[MOTIVOREABERTURA] [mr] ON [h].[cdmotivoreabertura] = [mr].[cdmotivo]
        WHERE [h].[idconvocacao] = @IDCONVOCACAO
          AND [h].[fgactive] = 'A'
        ORDER BY [h].[dhrabertura] DESC
      `;

      let result;
      try {
        result = await reqParam.query(queryUpper);
      } catch (errUpper) {
        if (errUpper.code === '42703' && /coluna.*não existe|column.*does not exist/i.test(String(errUpper.message))) {
          result = await pool
            .request()
            .input('IDCONVOCACAO', sql.Int, parseInt(id))
            .input('TENANT_ID', sql.NVarChar(64), tidHistReab)
            .query(queryLower);
        } else {
          throw errUpper;
        }
      }

      const toUpper = {
        idhistorico: 'IDHISTORICO', idconvocacao: 'IDCONVOCACAO', idviagem: 'IDVIAGEM',
        cdcadastro_motorista: 'CDCADASTRO_MOTORISTA', status_anterior: 'STATUS_ANTERIOR',
        cdmotivoreabertura: 'CDMOTIVOREABERTURA', dhrabertura: 'DHRABERTURA',
        sgusuario_operador: 'SGUSUARIO_OPERADOR', observacao: 'OBSERVACAO',
        nome_motorista: 'NOME_MOTORISTA', motivo_reabertura: 'MOTIVO_REABERTURA'
      };
      const recordset = (result.recordset || []).map((row) => {
        const r = { ...row };
        Object.keys(toUpper).forEach((k) => {
          if (r[k] !== undefined && r[toUpper[k]] === undefined) r[toUpper[k]] = r[k];
        });
        return r;
      });
      res.json(recordset);
    } catch (err) {
      console.error('Erro ao buscar histórico de reabertura:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico de reabertura.' });
    }
  },

  // Motorista responder convocação (aceitar/recusar)
  // LATITUDE e LONGITUDE são atualizados com a localização do motorista no momento da resposta
  responderConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        status,
        latitude,
        longitude,
        motivoRecusa,
        telefoneConfirmacao,
        valorFretePropostoMotorista,
        vlFretePropostoMotorista,
        confirmacaoPlacasModo,
        confirmacaoPlacasTexto,
      } = req.body;

      if (!status || !['ACEITA', 'RECUSADA'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido. Use ACEITA ou RECUSADA.' });
      }

      // Se for recusa, o motivo é obrigatório
      if (status === 'RECUSADA' && (!motivoRecusa || motivoRecusa === '')) {
        return res.status(400).json({ error: 'Motivo da recusa é obrigatório.' });
      }

      const pool = await poolPromise;
      const idInt = parseInt(id, 10);
      if (isNaN(idInt)) {
        return res.status(400).json({ error: 'ID de convocação inválido.' });
      }

      const sqlConvRespExtraPlacas = `,
            c.[FGCONFIRMACAOPLACAS],
            (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
            (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]`;
      const sqlConvResp = `
          SELECT 
            c.[IDVIAGEM], 
            c.[STATUS], 
            c.[TENANT_ID],
            c.[CDCADASTRO_MOTORISTA],
            c.[LATITUDE],
            c.[LONGITUDE],
            c.[DH_LOCALIZACAO_MOTORISTA],
            cg.[NRCELULAR] AS [NRCELULAR_MOTORISTA],
            upper(cg.[RZSOCIAL]) AS [NOME_MOTORISTA]
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
          WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO
        `;
      const sqlConvRespComPlacas = sqlConvResp.replace(
        /cg\.\[NRCELULAR\] AS \[NRCELULAR_MOTORISTA\]\s*\n\s*FROM \[dbo\]\.\[CONVOCACAO\] c/,
        `cg.[NRCELULAR] AS [NRCELULAR_MOTORISTA]${sqlConvRespExtraPlacas}
          FROM [dbo].[CONVOCACAO] c`
      );
      const sqlConvRespSemDh = sqlConvResp.replace(/\s*,\s*c\.\[DH_LOCALIZACAO_MOTORISTA\]\s*/i, '\n            ');
      const sqlConvRespComPlacasSemDh = sqlConvRespComPlacas.replace(/\s*,\s*c\.\[DH_LOCALIZACAO_MOTORISTA\]\s*/i, '\n            ');
      let usedFallbackSemDhColunaResp = false;
      let convSel;
      const reqConvSel = () => pool.request().input('IDCONVOCACAO', sql.Int, idInt);
      const placas427Sel = (msg) =>
        /fgconfirmacaoplacas|placasesperadas|dsclassefrota_conjunto|viagemveiculo|motorista_veiculo|statusaprovacao|refequipamento|equipamento/i.test(
          String(msg || '')
        );
      try {
        try {
          convSel = await reqConvSel().query(sqlConvRespComPlacas);
        } catch (e0) {
          if (e0.code === '42703' && placas427Sel(e0.message)) {
            convSel = await reqConvSel().query(sqlConvResp);
          } else throw e0;
        }
      } catch (err) {
        const em = String(err.message || '');
        if (err.code === '42703' && /localizacao_motorista/i.test(em)) {
          usedFallbackSemDhColunaResp = true;
          try {
            try {
              convSel = await reqConvSel().query(sqlConvRespComPlacasSemDh);
            } catch (e1) {
              if (e1.code === '42703' && placas427Sel(e1.message)) {
                convSel = await reqConvSel().query(sqlConvRespSemDh);
              } else throw e1;
            }
          } catch (err2) {
            throw err2;
          }
        } else {
          throw err;
        }
      }

      if (!convSel.recordset || convSel.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convRow = convSel.recordset[0];
      const statusAtual = convRow.STATUS ?? convRow.status;
      const idViagem = convRow.IDVIAGEM ?? convRow.idviagem;
      const rawTidConv = convRow.TENANT_ID ?? convRow.tenant_id;
      const tidConvResp =
        rawTidConv != null && String(rawTidConv).trim() !== '' ? String(rawTidConv).trim() : getDefaultTenantId();

      if (statusAtual !== 'PENDENTE') {
        return res.status(409).json({
          code: 'CONVOCACAO_JA_RESPONDIDA',
          error:
            'Esta convocação já foi respondida. Atualize a página para ver o status atual.',
        });
      }

      let vlFretePropGravar = null;
      if (status === 'ACEITA') {
        const rawPgEarly =
          valorFretePropostoMotorista !== undefined && valorFretePropostoMotorista !== null
            ? valorFretePropostoMotorista
            : vlFretePropostoMotorista;
        if (rawPgEarly !== undefined && rawPgEarly !== null && String(rawPgEarly).trim() !== '') {
          const pGEarly = parseValorFretePropostaMotorista(rawPgEarly);
          if (!pGEarly.ok) {
            return res.status(400).json({ code: 'VALOR_FRETE_INVALIDO', error: pGEarly.error });
          }
          vlFretePropGravar = pGEarly.value;
        }
      }

      await enriquecerPlacasConjuntoConvRowResponder(pool, idInt, tidConvResp, convRow);

      const placasEsperadasGate = String(
        convRow.PLACASESPERADAS ?? convRow.placasesperadas ?? ''
      ).trim();
      const conjuntoClasseGate = String(
        convRow.DSCLASSEFROTA_CONJUNTO ?? convRow.dsclassefrota_conjunto ?? ''
      ).trim();
      const fgPlacasRowPre = String(
        convRow.FGCONFIRMACAOPLACAS ?? convRow.fgconfirmacaoplacas ?? ''
      )
        .trim()
        .toUpperCase();
      const placasObrigatoriasAceite =
        status === 'ACEITA' &&
        (placasEsperadasGate.length > 0 || conjuntoClasseGate.length > 0) &&
        !fgPlacasRowPre;

      let fgPlacasUpdate = null;
      let txtPlacasUpdate = null;
      const modoPlacasBody = String(confirmacaoPlacasModo || '').trim().toUpperCase();
      const textoPlacasResposta =
        confirmacaoPlacasTexto != null ? String(confirmacaoPlacasTexto).trim().slice(0, 2000) : '';

      if (status === 'ACEITA') {
        if (modoPlacasBody === 'DIVERGE') {
          if (!textoPlacasResposta) {
            return res.status(400).json({
              code: 'TEXTO_DIVERGENCIA_PLACAS_OBRIGATORIO',
              error: 'Informe a descrição da divergência das placas.',
            });
          }
          let nGravDiv = 0;
          try {
            nGravDiv = await gravarDivergenciaPlacasSomente(pool, {
              idConvocacao: idInt,
              tenantId: tidConvResp,
              texto: textoPlacasResposta,
              vlFretePropostoMotorista: vlFretePropGravar,
            });
            if (nGravDiv > 0) {
              await notificarDivergenciaPlacasContratador(pool, req, {
                idConvocacao: idInt,
                tenantId: tidConvResp,
                textoDivergencia: textoPlacasResposta,
                nomeMotorista: convRow.NOME_MOTORISTA ?? convRow.nome_motorista ?? '',
              });
            }
          } catch (divErr) {
            console.error('[RESPONDER PUBLICO] divergência placas:', divErr);
            return res.status(500).json({
              error: 'Não foi possível registrar a divergência. Tente novamente.',
            });
          }
          if (!nGravDiv) {
            return res.status(409).json({
              code: 'CONVOCACAO_NAO_ATUALIZADA',
              error:
                'Não foi possível registrar a divergência. A convocação pode já ter sido respondida; atualize a página.',
            });
          }
          return res.status(422).json({
            success: false,
            code: 'ACEITE_BLOQUEADO_DIVERGENCIA_PLACAS',
            divergenciaRegistrada: true,
            FGCONFIRMACAOPLACAS: 'D',
            message:
              'Registramos que suas placas divergem do cadastro. Não é possível aceitar esta carga até a empresa alinhar os dados. Aguarde contato da transportadora ou use Recusar.',
          });
        }

        if (fgPlacasRowPre === 'D') {
          if (modoPlacasBody !== 'CONFIRMA') {
            return res.status(422).json({
              code: 'ACEITE_BLOQUEADO_DIVERGENCIA_PLACAS',
              divergenciaRegistrada: true,
              error:
                'Não é possível aceitar enquanto houver divergência de placas. Após a transportadora alinhar os dados, use «Confirmo estas placas» e aceite novamente, ou recuse.',
            });
          }
          fgPlacasUpdate = 'C';
          txtPlacasUpdate = null;
        } else if (placasObrigatoriasAceite) {
          if (modoPlacasBody !== 'CONFIRMA') {
            return res.status(422).json({
              code: 'CONFIRMACAO_PLACAS_OBRIGATORIA',
              error:
                'Confirme as placas e/ou o conjunto (classe) cadastrado nesta viagem antes de aceitar (mesmo critério do app do motorista).',
              placasEsperadas: placasEsperadasGate,
              classeConjuntoEsperada: conjuntoClasseGate,
            });
          }
          fgPlacasUpdate = 'C';
          txtPlacasUpdate = null;
        } else if (modoPlacasBody === 'CONFIRMA') {
          // Ex.: motorista confirmou no link/app mas o SELECT deste handler caiu em fallback sem
          // PLACASESPERADAS — ainda assim persiste auditoria na CONVOCACAO (FG / DH).
          fgPlacasUpdate = 'C';
          txtPlacasUpdate = null;
        }

        const dhLocMotorista =
          convRow.DH_LOCALIZACAO_MOTORISTA ?? convRow.dh_localizacao_motorista;
        const latRowDb = convRow.LATITUDE ?? convRow.latitude;
        const lonRowDb = convRow.LONGITUDE ?? convRow.longitude;
        const temLatLonDb =
          latRowDb != null &&
          lonRowDb != null &&
          String(latRowDb).trim() !== '' &&
          String(lonRowDb).trim() !== '';
        const locRegistradaOk = usedFallbackSemDhColunaResp
          ? temLatLonDb
          : (dhLocMotorista != null && String(dhLocMotorista).trim() !== '') || temLatLonDb;
        if (!locRegistradaOk) {
          return res.status(400).json({
            code: 'LOCALIZACAO_NAO_ENVIADA',
            error:
              'Antes de aceitar, use o botão «Enviar minha localização» nesta página para registrar sua posição.',
          });
        }

        const latN = latitude !== undefined && latitude !== null ? parseFloat(latitude) : NaN;
        const lonN = longitude !== undefined && longitude !== null ? parseFloat(longitude) : NaN;
        if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
          return res.status(400).json({
            code: 'LOCALIZACAO_RESPOSTA_OBRIGATORIA',
            error: 'Latitude e longitude atuais são obrigatórias para aceitar a convocação.',
          });
        }
        if (latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
          return res.status(400).json({ error: 'Coordenadas de localização inválidas.' });
        }

        const nrCad =
          convRow.NRCELULAR_MOTORISTA != null
            ? String(convRow.NRCELULAR_MOTORISTA)
            : convRow.nrcelular_motorista != null
              ? String(convRow.nrcelular_motorista)
              : '';
        let ctxResp = { pais: 'BR' };
        try {
          ctxResp = await getContexto(tidConvResp);
        } catch (_) {
          ctxResp = { pais: 'BR' };
        }
        const paisPadraoResp = ctxResp.pais || 'BR';
        const digCad = isPaisBrTelefone(paisPadraoResp)
          ? normalizarDigitosTelefoneBR(nrCad)
          : normalizarDigitosSoNumeros(nrCad);
        const minDigCad = isPaisBrTelefone(paisPadraoResp) ? 10 : 8;
        if (!digCad || digCad.length < minDigCad) {
          return res.status(400).json({
            code: 'TELEFONE_CADASTRO_INCOMPLETO',
            error:
              'Não é possível aceitar pelo link: o cadastro do motorista não possui celular válido. Entre em contato com a empresa.',
          });
        }

        const telInf = telefoneConfirmacao != null ? String(telefoneConfirmacao).trim() : '';
        if (!telInf) {
          return res.status(400).json({
            code: 'TELEFONE_CONFIRMACAO_OBRIGATORIO',
            error: 'Informe o número do celular cadastrado para confirmar sua identidade.',
          });
        }
        if (!telefoneMotoristaConfere(telInf, nrCad, paisPadraoResp)) {
          return res.status(400).json({
            code: 'TELEFONE_NAO_CONFERE',
            error: 'O celular informado não confere com o cadastro desta convocação.',
          });
        }

        const outraConfirmada = await pool
          .request()
          .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem))
          .input('IDCONVOCACAO', sql.Int, idInt)
          .input('TENANT_ID', sql.NVarChar(64), tidConvResp)
          .query(`
            SELECT 1 AS [OK]
            WHERE EXISTS (
              SELECT 1
              FROM [dbo].[CONVOCACAO]
              WHERE [IDVIAGEM] = @IDVIAGEM
                AND [TENANT_ID] = @TENANT_ID
                AND [STATUS] = 'CONFIRMADA'
                AND [IDCONVOCACAO] <> @IDCONVOCACAO
            )
          `);

        if (outraConfirmada.recordset && outraConfirmada.recordset.length > 0) {
          return res.status(409).json({
            code: 'VIAGEM_JA_FECHADA',
            error:
              'Outro motorista já foi confirmado nesta viagem e a carga foi fechada. Não é possível aceitar esta convocação.',
          });
        }
      }

      // Construir query dinamicamente para incluir geolocalização e motivo se fornecidos
      // Usar [coluna] para o db.js converter para "COLUNA" (PostgreSQL exige aspas para maiúsculas)
      let query = `
        UPDATE [dbo].[CONVOCACAO]
        SET [STATUS] = @STATUS,
            [DHRESPOSTA] = GETDATE(),
            [DHACESSO] = CASE WHEN [DHACESSO] IS NULL THEN GETDATE() ELSE [DHACESSO] END,
            [DHMAINTENANCE] = GETDATE(),
            [SGUSER] = 'MOTORISTA'
      `;

      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('TENANT_ID', sql.NVarChar(64), tidConvResp)
        .input('STATUS', sql.VarChar(20), status);

      // vlFretePropGravar já calculado no início (ACEITA), inclusive para ramo DIVERGE gravar frete.
      if (status === 'RECUSADA' && motivoRecusa) {
        query += `, [CDMOTIVORECUSA] = @CDMOTIVORECUSA`;
        request.input('CDMOTIVORECUSA', sql.Int, parseInt(motivoRecusa));
      }

      // Adicionar campos de geolocalização se fornecidos
      // Atualizar sempre que houver nova localização (pode ter mudado desde o acesso)
      if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
        query += `, [LATITUDE] = @LATITUDE, [LONGITUDE] = @LONGITUDE`;
        request.input('LATITUDE', sql.Float, parseFloat(latitude));
        request.input('LONGITUDE', sql.Float, parseFloat(longitude));
      }

      if (vlFretePropGravar !== null) {
        query += `, [VL_FRETE_PROPOSTO_MOTORISTA] = @VL_FRETE_PROPOSTO_MOTORISTA`;
        request.input('VL_FRETE_PROPOSTO_MOTORISTA', sql.Decimal(15, 2), vlFretePropGravar);
      }

      if (fgPlacasUpdate != null) {
        query += `, [FGCONFIRMACAOPLACAS] = @FGCONFIRMACAOPLACAS, [TXTPLACASDIVERGENCIA] = CASE WHEN @FGCONFIRMACAOPLACAS = 'D' THEN @TXTPLACASDIVERGENCIA ELSE NULL END, [DHCONFIRMACAOPLACAS] = GETDATE()`;
        request.input('FGCONFIRMACAOPLACAS', sql.NVarChar(1), fgPlacasUpdate);
        request.input('TXTPLACASDIVERGENCIA', sql.NVarChar(4000), txtPlacasUpdate != null ? txtPlacasUpdate : '');
      }

      query += ` WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID AND [STATUS] = 'PENDENTE'`;

      let updResult;
      try {
        updResult = await request.query(query);
      } catch (updErr) {
        const emu = String(updErr.message || '');
        if (updErr.code === '42703' && /vl_frete_proposto/i.test(emu)) {
          return res.status(503).json({
            code: 'COLUNA_FRETE_PROPOSTO_AUSENTE',
            error:
              'Servidor sem coluna VL_FRETE_PROPOSTO_MOTORISTA. Execute o script backend/scripts/adicionar_vlfrete_proposto_motorista_convocacao_postgres.sql no banco.',
          });
        }
        if (updErr.code === '42703' && /fgconfirmacaoplacas|txtplacasdivergencia|dhconfirmacaoplacas/i.test(emu)) {
          return res.status(503).json({
            code: 'COLUNA_CONFIRMACAO_PLACAS_AUSENTE',
            error:
              'Servidor sem colunas de confirmação de placas na convocação. Execute o script de migração correspondente no banco.',
          });
        }
        throw updErr;
      }
      const nAfetadas =
        updResult.rowsAffected && updResult.rowsAffected[0] != null
          ? updResult.rowsAffected[0]
          : 0;

      if (nAfetadas === 0) {
        if (status === 'ACEITA') {
          return res.status(409).json({
            code: 'VIAGEM_JA_FECHADA',
            error:
              'Não foi possível registrar o aceite. A viagem pode ter sido fechada com outro motorista — atualize a página.',
          });
        }
        return res.status(409).json({
          code: 'CONVOCACAO_NAO_ATUALIZADA',
          error:
            'Não foi possível atualizar a convocação. Ela pode já ter sido respondida; atualize a página.',
        });
      }

      // Aceite com placas confirmadas: já grava VIAGEMVEICULO (antes só na confirmação da torre).
      let veiculosVinculadosAceite = 0;
      if (status === 'ACEITA' && fgPlacasUpdate === 'C') {
        const cdMotAceite =
          convRow.CDCADASTRO_MOTORISTA != null
            ? convRow.CDCADASTRO_MOTORISTA
            : convRow.cdcadastro_motorista;
        if (cdMotAceite != null && idViagem != null) {
          try {
            veiculosVinculadosAceite = await vincularVeiculosViagemAoConfirmarConvocacao(pool, {
              idConvocacao: idInt,
              idViagem,
              cdMotorista: cdMotAceite,
              tenantId: tidConvResp,
              sgUser: 'MOTORISTA',
            });
          } catch (eVincAce) {
            console.warn(
              '[ACEITE PUBLICO] Vínculo automático de veículos à viagem ignorado:',
              eVincAce && eVincAce.message,
            );
          }
        }
      }

      res.json({
        success: true,
        message: status === 'ACEITA' ? 'Convocação aceita com sucesso!' : 'Convocação recusada.',
        ...(fgPlacasUpdate != null ? { FGCONFIRMACAOPLACAS: fgPlacasUpdate } : {}),
        ...(status === 'ACEITA' ? { veiculosVinculados: veiculosVinculadosAceite } : {}),
      });
    } catch (err) {
      console.error('Erro ao responder convocação:', err);
      res.status(500).json({ error: 'Erro ao responder convocação.' });
    }
  },

  // Obter URL pública para links de convocação
  obterUrlPublica: async (req, res) => {
    try {
      // Tentar obter da variável de ambiente primeiro
      let publicUrl = process.env.PUBLIC_URL || process.env.APP_URL;

      // Se não tiver configurado, usar o host da requisição
      if (!publicUrl) {
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:3000';
        publicUrl = `${protocol}://${host}`;

        // Se for localhost, tentar detectar IP local para desenvolvimento
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          // Em desenvolvimento, retornar localhost (não funcionará no celular)
          // Mas avisar que precisa configurar PUBLIC_URL
          return res.json({
            url: publicUrl,
            warning: 'Usando localhost. Para funcionar no celular, configure a variável de ambiente PUBLIC_URL com o IP ou domínio público do servidor.'
          });
        }
      }

      res.json({ url: publicUrl });
    } catch (err) {
      console.error('Erro ao obter URL pública:', err);
      // Fallback para localhost
      res.json({ url: 'http://localhost:3000' });
    }
  },

  // Executar query SQL personalizada (apenas SELECT para segurança)
  executarQuery: async (req, res) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query SQL é obrigatória.' });
      }

      // Remover espaços em branco e converter para maiúsculas para verificação
      const queryUpper = query.trim().toUpperCase();

      // Bloquear comandos perigosos (apenas permitir SELECT)
      const comandosBloqueados = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER',
        'CREATE', 'EXEC', 'EXECUTE', 'SP_', 'XP_', '--', '/*', '*/'
      ];

      // Verificar se a query começa com SELECT
      if (!queryUpper.startsWith('SELECT')) {
        return res.status(400).json({
          error: 'Apenas queries SELECT são permitidas por segurança.'
        });
      }

      // Verificar comandos bloqueados
      for (const cmd of comandosBloqueados) {
        if (queryUpper.includes(cmd)) {
          return res.status(400).json({
            error: `Comando não permitido: ${cmd}. Apenas queries SELECT são permitidas.`
          });
        }
      }

      const pool = await poolPromise;
      const result = await pool.request().query(query);

      // Converter resultados para formato JSON simples
      const rows = result.recordset.map(row => {
        const obj = {};
        for (const key in row) {
          obj[key] = row[key];
        }
        return obj;
      });

      res.json({
        success: true,
        rows: rows,
        rowCount: rows.length,
        columns: rows.length > 0 ? Object.keys(rows[0]) : []
      });
    } catch (err) {
      console.error('Erro ao executar query:', err);
      res.status(500).json({
        error: 'Erro ao executar query SQL.',
        message: err.message,
        details: err.originalError ? err.originalError.message : null
      });
    }
  },

  // Executar SQL de inicialização (permite procedures e comandos mais amplos)
  // Este endpoint é usado para executar o arquivo init.sql automaticamente
  executarInitSQL: async (req, res) => {
    try {
      const { sql } = req.body;

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'SQL é obrigatório.' });
      }

      // Remover espaços em branco e converter para maiúsculas para verificação
      const sqlUpper = sql.trim().toUpperCase();

      // Bloquear apenas comandos extremamente perigosos
      // Permite: SELECT, EXEC, EXECUTE, UPDATE, INSERT, DELETE (com cuidado)
      const comandosBloqueados = [
        'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE',
        'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
        'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
      ];

      // Verificar comandos bloqueados
      for (const cmd of comandosBloqueados) {
        if (sqlUpper.includes(cmd)) {
          return res.status(400).json({
            error: `Comando não permitido: ${cmd}.`
          });
        }
      }

      const pool = await poolPromise;

      // Dividir por GO se houver múltiplos comandos
      const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);

      const resultados = [];
      const totalComandos = comandos.length;

      // Extrair nomes das procedures para log de progresso
      const extrairNomeProcedure = (cmd) => {
        const match = cmd.trim().toUpperCase().match(/EXEC(?:UTE)?\s+(?:\[DBO\]\.)?\[?(\w+)\]?/);
        return match ? match[1] : null;
      };

      for (let i = 0; i < comandos.length; i++) {
        const comando = comandos[i];
        const cmdLimpo = comando.trim();
        if (!cmdLimpo) continue;

        // Extrair nome da procedure se for EXEC
        const nomeProcedure = extrairNomeProcedure(cmdLimpo);
        const progresso = `[${i + 1}/${totalComandos}]`;
        
        try {
          // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
          const request = pool.request();
          // mssql usa requestTimeout (em milissegundos)
          // Aumentar para 10 minutos (600 segundos) para scripts grandes
          request.timeout = 600000; // 600 segundos (10 minutos) para comandos grandes

          // Executar comando
          const result = await request.query(cmdLimpo);

          // Se retornou dados (SELECT), incluir no resultado
          if (result.recordset && result.recordset.length > 0) {
            const rows = result.recordset.map(row => {
              const obj = {};
              for (const key in row) {
                obj[key] = row[key];
              }
              return obj;
            });
            resultados.push({
              tipo: 'SELECT',
              rows: rows,
              rowCount: rows.length
            });
          } else {
            // Comando executado sem retorno (EXEC, UPDATE, etc)
            resultados.push({
              tipo: 'EXEC',
              message: 'Comando executado com sucesso.',
              rowsAffected: result.rowsAffected || [0]
            });
          }
        } catch (cmdErr) {
          // Se um comando falhar, continuar com os próximos mas registrar o erro
          let mensagemErro = cmdErr.message || cmdErr.originalError?.message || String(cmdErr);

          // Verificar se é erro de truncamento (pode ser ignorado se a procedure já faz truncamento)
          const isTruncamento = mensagemErro.toLowerCase().includes('truncated') ||
            mensagemErro.toLowerCase().includes('truncados') ||
            mensagemErro.toLowerCase().includes('string or binary data would be truncated');

          // Melhorar mensagem de timeout
          if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
            mensagemErro = `Timeout: Comando demorou mais de 10 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
          }

          // Se for erro de truncamento, verificar se o comando é EXEC de uma stored procedure
          // Se for, pode ser que a procedure precise ser atualizada ou o erro é esperado
          const isExecProcedure = cmdLimpo.trim().toUpperCase().startsWith('EXEC') ||
            cmdLimpo.trim().toUpperCase().startsWith('EXECUTE');

          resultados.push({
            tipo: isTruncamento && isExecProcedure ? 'AVISO' : 'ERRO', // Truncamento em procedures = aviso
            error: mensagemErro,
            mensagem: mensagemErro, // Adicionar campo mensagem para compatibilidade
            comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
            detalhes: {
              nome: cmdErr.name,
              codigo: cmdErr.code,
              numero: cmdErr.number,
              isTruncamento: isTruncamento,
              isExecProcedure: isExecProcedure
            }
          });
        }
      }

      res.json({
        success: true,
        resultados: resultados,
        totalComandos: comandos.length
      });
    } catch (err) {
      console.error('Erro ao executar init SQL:', err);
      // Garantir que a resposta seja enviada antes de encerrar
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erro ao executar SQL de inicialização.',
          message: err.message,
          details: err.originalError ? err.originalError.message : null
        });
      }
    }
  },

  // ============================================================================
  // MÉTODOS PARA GERENCIAR VEÍCULO DA VIAGEM
  // ============================================================================

  // Buscar equipamento por placa ou código (notação [coluna] para PostgreSQL preservar maiúsculas)
  buscarEquipamento: async (req, res) => {
    try {
      const { placa, codigo } = req.query;

      if (!placa && !codigo) {
        return res.status(400).json({ error: 'Informe a placa ou o código do equipamento.' });
      }

      const pool = await poolPromise;
      let query = `
        SELECT 
          e.[IDEQUIPAMENTO],
          e.[REFEQUIPAMENTO],
          e.[DSEQUIPAMENTO],
          NULL AS [CDGRUPOEQUIPAMENTO],
          NULL AS [GRUPO_NOME],
          e.[CDTIPOEQUIPAMENTO],
          t.[DSTIPOEQUIPAMENTO] AS [TIPO_NOME],
          e.[CDMARCAEQUIPAMENTO],
          m.[DSMARCAEQUIPAMENTO] AS [MARCA_NOME],
          e.[CDMODELOEQUIPAMENTO],
          mod.[DSMODELOEQUIPAMENTO] AS [MODELO_NOME],
          e.[CDCLASSEFROTA],
          c.[DSCLASSEFROTA] AS [CLASSE_NOME],
          e.[FGACTIVE],
          e.[FGTIPOATUACAO],
          e.[FGTIPOCARROCERIA],
          e.[NREIXOS],
          e.[CAPACIDCARGA],
          e.[ANOFABRICA],
          e.[ALTURA],
          e.[LARGURA],
          e.[COMPRIMENTO],
          e.[MTCUBICO],
          e.[FGRASTREADO]
        FROM [dbo].[EQUIPAMENTO] e
        LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON e.[CDTIPOEQUIPAMENTO] = t.[CDTIPOEQUIPAMENTO]
        LEFT JOIN [dbo].[MARCAEQUIPAMENTO] m ON e.[CDMARCAEQUIPAMENTO] = m.[CDMARCAEQUIPAMENTO]
        LEFT JOIN [dbo].[MODELOEQUIPAMENTO] mod ON e.[CDMODELOEQUIPAMENTO] = mod.[CDMODELOEQUIPAMENTO]
        LEFT JOIN [dbo].[CLASSEFROTA] c ON e.[CDCLASSEFROTA] = c.[CDCLASSEFROTA]
        WHERE 1=1
      `;

      const request = pool.request();
      if (placa) {
        query += ` AND UPPER(e.[REFEQUIPAMENTO]) = UPPER(@PLACA)`;
        request.input('PLACA', sql.VarChar(20), placa.toUpperCase().trim());
      }
      if (codigo) {
        query += ` AND e.[IDEQUIPAMENTO] = @CODIGO`;
        request.input('CODIGO', sql.Decimal(15, 0), parseFloat(codigo));
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Equipamento não encontrado.' });
      }

      res.json(result.recordset[0]);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      res.status(500).json({ error: 'Erro ao buscar equipamento.' });
    }
  },

  // Buscar veículos da viagem (retorna LISTA - pode ter múltiplos veículos)
  buscarVeiculoViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;

      const result = await pool.request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            [vv].[IDVIAGEM],
            [vv].[IDEQUIPAMENTO],
            [vv].[REFEQUIPAMENTO],
            [vv].[TPEQUIPAMENTO],
            [e].[DSEQUIPAMENTO],
            [e].[FGACTIVE],
            NULL AS [CDGRUPOEQUIPAMENTO],
            NULL AS [GRUPO_NOME],
            [e].[CDTIPOEQUIPAMENTO],
            [t].[DSTIPOEQUIPAMENTO] AS [TIPO_NOME],
            [e].[CDMARCAEQUIPAMENTO],
            [m].[DSMARCAEQUIPAMENTO] AS [MARCA_NOME],
            [e].[CDMODELOEQUIPAMENTO],
            [mod].[DSMODELOEQUIPAMENTO] AS [MODELO_NOME],
            [e].[CDCLASSEFROTA],
            [c].[DSCLASSEFROTA] AS [CLASSE_NOME],
            [e].[FGTIPOATUACAO],
            [e].[FGTIPOCARROCERIA],
            [e].[NREIXOS],
            [e].[CAPACIDCARGA],
            [e].[ANOFABRICA],
            [e].[ALTURA],
            [e].[LARGURA],
            [e].[COMPRIMENTO],
            [e].[MTCUBICO],
            [e].[FGRASTREADO]
          FROM [dbo].[VIAGEMVEICULO] [vv]
          INNER JOIN [dbo].[EQUIPAMENTO] [e] ON [vv].[IDEQUIPAMENTO] = [e].[IDEQUIPAMENTO]
          LEFT JOIN [dbo].[TIPOEQUIPAMENTO] [t] ON [e].[CDTIPOEQUIPAMENTO] = [t].[CDTIPOEQUIPAMENTO]
          LEFT JOIN [dbo].[MARCAEQUIPAMENTO] [m] ON [e].[CDMARCAEQUIPAMENTO] = [m].[CDMARCAEQUIPAMENTO]
          LEFT JOIN [dbo].[MODELOEQUIPAMENTO] [mod] ON [e].[CDMODELOEQUIPAMENTO] = [mod].[CDMODELOEQUIPAMENTO]
          LEFT JOIN [dbo].[CLASSEFROTA] [c] ON [e].[CDCLASSEFROTA] = [c].[CDCLASSEFROTA]
          WHERE [vv].[IDVIAGEM] = @IDVIAGEM
          ORDER BY [vv].[IDEQUIPAMENTO]
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar veículos da viagem:', err);
      res.status(500).json({ error: 'Erro ao buscar veículos da viagem.' });
    }
  },

  // Salvar veículo na viagem (permite múltiplos veículos - verifica combinação específica)
  salvarVeiculoViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const { idequipamento, refequipamento, tpequipamento } = req.body;

      if (!idequipamento || !refequipamento || !tpequipamento) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);
      await transaction.begin();

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      try {
        // Verificar se já existe esta combinação específica (IDVIAGEM + IDEQUIPAMENTO)
        const checkRequest = transaction.request();
        const checkResult = await checkRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
          .query('SELECT COUNT(*) AS [COUNT] FROM [dbo].[VIAGEMVEICULO] WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO');

        if (getFirstNumericValue(checkResult.recordset, 0) > 0) {
          // Atualizar combinação específica
          const updateRequest = transaction.request();
          await updateRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              UPDATE [dbo].[VIAGEMVEICULO]
              SET [REFEQUIPAMENTO] = @REFEQUIPAMENTO,
                  [TPEQUIPAMENTO] = @TPEQUIPAMENTO,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser,
                  [SERVERORIG] = 'AppDVcargas'
              WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO
            `);
        } else {
          // Inserir nova combinação
          const insertRequest = transaction.request();
          await insertRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              INSERT INTO [dbo].[VIAGEMVEICULO] ([IDVIAGEM], [IDEQUIPAMENTO], [REFEQUIPAMENTO], [TPEQUIPAMENTO], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES (@IDVIAGEM, @IDEQUIPAMENTO, @REFEQUIPAMENTO, @TPEQUIPAMENTO, GETDATE(), @sgUser, 'AppDVcargas')
            `);
        }

        await transaction.commit();
        res.json({ success: true, message: 'Veículo salvo com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao salvar veículo da viagem:', err);
      res.status(500).json({ error: 'Erro ao salvar veículo da viagem.' });
    }
  },

  // ============================================================================
  // MÉTODOS PARA GERENCIAR MOTORISTA DA VIAGEM
  // ============================================================================

  // Buscar cadastro geral por CPF, nome ou código
  buscarCadastroGeral: async (req, res) => {
    try {
      const { cpf, nome, codigo } = req.query;

      if (!cpf && !nome && !codigo) {
        return res.status(400).json({ error: 'Informe o CPF, nome ou código do cadastro.' });
      }

      const pool = await poolPromise;
      const tidBuscaCg = tenantIdForRequest(req);
      let query = `
        SELECT 
          cg.[CDCADASTRO] AS [CDCADASTROGERAL],
          cg.[CGCCPF] AS [CGCCPF],
          upper(cg.[RZSOCIAL]) AS [RZSOCIAL],
          cg.[NMFANTASIA] AS [NMFANTASIA],
          cg.[FGFISICAJURIDICA] AS [FGFISICAJURIDICA],
          cg.[FGTIPOCADASTRO] AS [FGTIPOCADASTRO],
          cg.[FGRASTREADO] AS [FGRASTREADO],
          cg.[FGACTIVE] AS [FGACTIVE],
          cg.[CDTRANSPORTADOR] AS [CDTRANSPORTADOR],
          upper(t.[RZSOCIAL]) AS [TRANSPORTADOR_NOME],
          cg.[CEP] AS [CEP],
          c.[ESTADO] AS [CIDADE_ESTADO],
          c.[NMCIDADE] AS [CIDADE_NOME],
          cg.[CDCIDADE] AS [CDCIDADE],
          cg.[ENDERECO] AS [ENDERECO],
          cg.[NRENDERECO] AS [NRENDERECO],
          cg.[COMPLEND] AS [COMPLEND],
          cg.[BAIRRO] AS [BAIRRO],
          cg.[NRCELULAR] AS [NRCELULAR],
          cg.[ENDEMAIL] AS [ENDEMAIL],
          cg.[LATITUDE] AS [LATITUDE],
          cg.[LONGITUDE] AS [LONGITUDE]
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[CIDADE] c ON cg.[CDCIDADE] = c.[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.[CDTRANSPORTADOR] = t.[CDCADASTRO] AND t.[TENANT_ID] = cg.[TENANT_ID]
        WHERE cg.[TENANT_ID] = @TENANT_ID
      `;

      const request = pool.request().input('TENANT_ID', sql.NVarChar(64), tidBuscaCg);
      if (cpf) {
        const cpfLimpo = cpf.replace(/[^\d]+/g, '');
        query += ` AND cg.[CGCCPF] = @CPF`;
        request.input('CPF', sql.VarChar(14), cpfLimpo);
      }
      if (nome) {
        query += ` AND (cg.[RZSOCIAL] LIKE @NOME OR cg.[NMFANTASIA] LIKE @NOME)`;
        request.input('NOME', sql.VarChar(100), `%${nome}%`);
      }
      if (codigo) {
        query += ` AND cg.[CDCADASTRO] = @CODIGO`;
        request.input('CODIGO', sql.Decimal(15, 0), parseFloat(codigo));
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao buscar cadastro geral.' });
    }
  },

  // Buscar motoristas da viagem (retorna LISTA - pode ter múltiplos motoristas)
  buscarMotoristaViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const tidMotViag = tenantIdForRequest(req);

      const result = await pool.request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .input('TENANT_ID', sql.NVarChar(64), tidMotViag)
        .query(`
          SELECT 
            [vm].[IDVIAGEM],
            [vm].[CDMOTORISTA],
            [cg].[CDCADASTRO] AS CDCADASTROGERAL,
            [cg].[CGCCPF],
            [cg].[RZSOCIAL],
            [cg].[NMFANTASIA],
            [cg].[FGFISICAJURIDICA],
            [cg].[FGTIPOCADASTRO],
            [cg].[FGRASTREADO],
            [cg].[FGACTIVE],
            [cg].[CDTRANSPORTADOR],
            upper([t].[RZSOCIAL]) AS TRANSPORTADOR_NOME,
            [cg].[CEP],
            NULL AS CIDADE_ESTADO,
            NULL AS CIDADE_NOME,
            [cg].[ENDERECO],
            [cg].[NRENDERECO],
            [cg].[COMPLEND],
            [cg].[BAIRRO],
            [cg].[NRCELULAR],
            [cg].[ENDEMAIL],
            [cg].[LATITUDE],
            [cg].[LONGITUDE]
          FROM [dbo].[VIAGEMMOTORISTA] [vm]
          INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [vm].[IDVIAGEM] = [v].[IDVIAGEM] AND [v].[TENANT_ID] = @TENANT_ID
          INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
          LEFT JOIN [dbo].[CADASTROGERAL] [t] ON [cg].[CDTRANSPORTADOR] = [t].[CDCADASTRO] AND [t].[TENANT_ID] = [cg].[TENANT_ID]
          WHERE [vm].[IDVIAGEM] = @IDVIAGEM
          ORDER BY [vm].[CDMOTORISTA]
        `);

      // Retornar lista (pode estar vazia - isso é normal)
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar motoristas da viagem:', err);
      res.status(500).json({ error: 'Erro ao buscar motoristas da viagem.' });
    }
  },

  // Salvar motorista na viagem
  salvarMotoristaViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const { cdmotorista } = req.body;

      if (!cdmotorista) {
        return res.status(400).json({ error: 'Código do motorista é obrigatório.' });
      }

      // Validar se são números válidos
      const idNum = parseFloat(id);
      const cdmotoristaNum = parseFloat(cdmotorista);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
        return res.status(400).json({ error: 'Código do motorista inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);
      await transaction.begin();

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      try {
        // Upsert: inserir ou atualizar (evita erro de chave duplicada e condição de corrida)
        const upsertRequest = transaction.request();
        await upsertRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .input('sgUser', sql.VarChar(50), sgUser)
          .query(`
            INSERT INTO [dbo].[VIAGEMMOTORISTA] ([IDVIAGEM], [CDMOTORISTA], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
            VALUES (@IDVIAGEM, @CDMOTORISTA, GETDATE(), @sgUser, 'AppDVcargas')
            ON CONFLICT ([IDVIAGEM], [CDMOTORISTA]) DO UPDATE SET
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = @sgUser,
              [SERVERORIG] = 'AppDVcargas'
          `);

        // Atualizar situação da viagem para Programada (mesma regra ao confirmar convocação)
        const sitProgramada = await transaction.request()
          .query(`
            SELECT TOP 1 [CDSITUACAOVIAGEM] FROM [dbo].[SITUACAOVIAGEM]
            WHERE [FGSITVIAGEM] = 'P' AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
          `);
        const cdSituacaoProgramada = sitProgramada.recordset && sitProgramada.recordset[0]
          ? (sitProgramada.recordset[0].CDSITUACAOVIAGEM ?? sitProgramada.recordset[0].cdsituacaoviagem)
          : null;
        if (cdSituacaoProgramada != null) {
          const reqUpdSit = transaction.request();
          await reqUpdSit
            .input('IDVIAGEM_SIT', sql.Decimal(15, 0), idNum)
            .input('FGSITVIAGEM_SIT', sql.VarChar(1), 'P')
            .input('CDSITUACAOVIAGEM_SIT', sql.SmallInt, cdSituacaoProgramada)
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              UPDATE [dbo].[VIAGEMMESTRE]
              SET [FGSITVIAGEM] = @FGSITVIAGEM_SIT,
                  [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM_SIT,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_SIT
            `);
        } else {
          const reqUpdSit = transaction.request();
          await reqUpdSit
            .input('IDVIAGEM_SIT', sql.Decimal(15, 0), idNum)
            .input('FGSITVIAGEM_SIT', sql.VarChar(1), 'P')
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              UPDATE [dbo].[VIAGEMMESTRE]
              SET [FGSITVIAGEM] = @FGSITVIAGEM_SIT,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_SIT
            `);
        }

        await transaction.commit();
        res.json({ success: true, message: 'Motorista salvo com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        console.error('Erro na transação ao salvar motorista:', err);
        console.error('Stack:', err.stack);
        throw err;
      }
    } catch (err) {
      console.error('Erro ao salvar motorista da viagem:', err);
      console.error('Detalhes:', err.message);
      console.error('Stack:', err.stack);
      res.status(500).json({
        error: 'Erro ao salvar motorista da viagem.',
        detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Remover veículo específico da viagem
  removerVeiculoViagem: async (req, res) => {
    try {
      const { id, idequipamento } = req.params;

      if (!idequipamento) {
        return res.status(400).json({ error: 'ID do equipamento é obrigatório.' });
      }

      const idNum = parseFloat(id);
      const idequipamentoNum = parseFloat(idequipamento);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(idequipamentoNum) || idequipamentoNum <= 0) {
        return res.status(400).json({ error: 'ID do equipamento inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = transaction.request();
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idequipamentoNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMVEICULO]
            WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO
          `);

        if (result.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Veículo não encontrado nesta viagem.' });
        }

        await transaction.commit();
        res.json({ success: true, message: 'Veículo removido com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao remover veículo da viagem:', err);
      res.status(500).json({ error: 'Erro ao remover veículo da viagem.' });
    }
  },

  // Remover motorista específico da viagem
  removerMotoristaViagem: async (req, res) => {
    try {
      const { id, cdmotorista } = req.params;

      if (!cdmotorista) {
        return res.status(400).json({ error: 'Código do motorista é obrigatório.' });
      }

      const idNum = parseFloat(id);
      const cdmotoristaNum = parseFloat(cdmotorista);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
        return res.status(400).json({ error: 'Código do motorista inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = transaction.request();
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMMOTORISTA]
            WHERE [IDVIAGEM] = @IDVIAGEM AND [CDMOTORISTA] = @CDMOTORISTA
          `);

        if (result.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Motorista não encontrado para esta viagem.' });
        }

        await transaction.commit();
        res.json({ success: true, message: 'Motorista removido com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao remover motorista da viagem:', err);
      res.status(500).json({ error: 'Erro ao remover motorista da viagem.' });
    }
  },

  // ========== LOGS WEBHOOK META ==========

  // Salvar log do webhook Meta
  salvarLogWebhookMeta: async (req, res) => {
    try {
      const { IDCONVOCACAO, tipo, titulo, mensagem, detalhes, status_http, tempo_resposta } = req.body;

      if (!IDCONVOCACAO || !tipo) {
        return res.status(400).json({ error: 'IDCONVOCACAO e tipo são obrigatórios.' });
      }

      // Mostrar logs no terminal do servidor para envio e resposta (apenas uma vez)
      if (tipo === 'envio' && detalhes) {
        const detalhesObj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
        // Extrair contador da mensagem se disponível
        const mensagemMatch = mensagem ? mensagem.match(/\[(\d+)\/(\d+)\]/) : null;
        const contador = mensagemMatch ? `[${mensagemMatch[1]}/${mensagemMatch[2]}]` : '';

        console.log('========================================');
        console.log(`[WEBHOOK ENVIO] 📤 ${contador} ENVIANDO CONVOCAÇÃO`.trim());
        console.log(`[WEBHOOK ENVIO] Timestamp: ${detalhesObj.timestamp || new Date().toISOString()}`);
        console.log(`[WEBHOOK ENVIO] ID Convocação: ${IDCONVOCACAO}`);
        console.log(`[WEBHOOK ENVIO] URL: ${detalhesObj.url || 'https://ia.riochat.com.br/webhook/aviso-rota-integra'}`);
        console.log(`[WEBHOOK ENVIO] Método: ${detalhesObj.metodo || 'POST'}`);
        console.log(`[WEBHOOK ENVIO] Headers:`, detalhesObj.headers || { 'Content-Type': 'application/json' });
        console.log(`[WEBHOOK ENVIO] Body completo:`, JSON.stringify(detalhesObj.body || {}, null, 2));
        console.log('========================================');
      } else if (tipo === 'resposta' && detalhes) {
        const detalhesObj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
        // Extrair contador da mensagem se disponível
        const mensagemMatch = mensagem ? mensagem.match(/\[(\d+)\/(\d+)\]/) : null;
        const contador = mensagemMatch ? `[${mensagemMatch[1]}/${mensagemMatch[2]}]` : '';

        console.log(`[WEBHOOK RESPOSTA] 📥 ${contador} RESPOSTA RECEBIDA`.trim());
        console.log(`[WEBHOOK RESPOSTA] Timestamp: ${detalhesObj.timestamp || new Date().toISOString()}`);
        console.log(`[WEBHOOK RESPOSTA] ID Convocação: ${IDCONVOCACAO}`);
        console.log(`[WEBHOOK RESPOSTA] Status: ${detalhesObj.status || status_http} ${detalhesObj.statusText || ''}`);
        console.log(`[WEBHOOK RESPOSTA] Tempo de resposta: ${detalhesObj.tempoResposta || tempo_resposta || 'N/A'}`);
        console.log(`[WEBHOOK RESPOSTA] Headers:`, JSON.stringify(detalhesObj.headers || {}, null, 2));
        if (detalhesObj.body) {
          if (typeof detalhesObj.body === 'object') {
            console.log(`[WEBHOOK RESPOSTA] Body (JSON):`, JSON.stringify(detalhesObj.body, null, 2));
          } else {
            console.log(`[WEBHOOK RESPOSTA] Body (Texto):`, detalhesObj.body);
          }
        }
        console.log('');
      }

      // Garantir que detalhes seja uma string JSON válida
      let detalhesJson = null;
      if (detalhes) {
        if (typeof detalhes === 'string') {
          try {
            JSON.parse(detalhes);
            detalhesJson = detalhes;
          } catch (e) {
            detalhesJson = JSON.stringify(detalhes);
          }
        } else {
          detalhesJson = JSON.stringify(detalhes);
        }
      }

      const sgUserLog = getSgUser(req);
      if (!sgUserLog) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO))
        .input('TIPO', sql.VarChar(20), tipo)
        .input('TITULO', sql.NVarChar(200), titulo || null)
        .input('MENSAGEM', sql.NVarChar(sql.MAX), mensagem || null)
        .input('DETALHES', sql.NVarChar(sql.MAX), detalhesJson)
        .input('STATUS_HTTP', sql.Int, status_http || null)
        .input('TEMPO_RESPOSTA', sql.Int, tempo_resposta || null)
        .input('sgUser', sql.VarChar(50), sgUserLog);

      await request.query(`
        INSERT INTO [dbo].[LOGSWEBHOOKMETA] 
          (IDCONVOCACAO, TIPO, TITULO, MENSAGEM, DETALHES, STATUS_HTTP, TEMPO_RESPOSTA, DHLOG, DHMAINTENANCE, SGUSER, SERVERORIG)
        VALUES 
          (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, GETDATE(), GETDATE(), @sgUser, 'AppDVcargas')
      `);

      res.json({ success: true, message: 'Log salvo com sucesso!' });
    } catch (err) {
      console.error('[LOGS WEBHOOK META] Erro ao salvar log:', err.message);
      res.status(500).json({ error: 'Erro ao salvar log.', details: err.message });
    }
  },

  // Listar logs do webhook Meta
  listarLogsWebhookMeta: async (req, res) => {
    try {
      const { limite = 100, idConvocacao, idViagem } = req.query;
      const lim = Math.min(500, Math.max(1, parseInt(limite, 10) || 100));
      const tenantId = tenantIdForRequest(req);

      const pool = await poolPromise;
      let query = `
        SELECT 
          [l].[IDLOG],
          [l].[IDCONVOCACAO],
          [l].[TIPO],
          [l].[TITULO],
          [l].[MENSAGEM],
          [l].[DETALHES],
          [l].[STATUS_HTTP],
          [l].[TEMPO_RESPOSTA],
          [l].[DHLOG]
        FROM [dbo].[LOGSWEBHOOKMETA] [l]
        WHERE 1=1
      `;

      const request = pool.request();

      if (idConvocacao) {
        query += ` AND [l].[IDCONVOCACAO] = @IDCONVOCACAO`;
        request.input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao, 10));
      }

      // Filtrar por ID da viagem através das convocações (escopo do tenant)
      if (idViagem) {
        query += ` AND [l].[IDCONVOCACAO] IN (
          SELECT [IDCONVOCACAO] 
          FROM [dbo].[CONVOCACAO] 
          WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID
        )`;
        request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
        request.input('TENANT_ID', sql.NVarChar(64), tenantId);
      }

      query += ` ORDER BY [l].[DHLOG] DESC LIMIT @LIMITE`;
      request.input('LIMITE', sql.Int, lim);

      const result = await request.query(query);
      let rawMeta = result.recordset || [];

      /** Inclui envios registrados só em LOG_ENVIO_WHATSAPP (ex.: fluxos antigos / campanha antes do META). */
      let rawEnvio = [];
      if (idViagem && !idConvocacao) {
        try {
          const r2 = await pool
            .request()
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem))
            .input('TENANT_ID', sql.NVarChar(64), tenantId)
            .input('LIMITE', sql.Int, lim)
            .query(`
              SELECT 
                lw.[IDCONVOCACAO],
                lw.[NRCELULAR],
                lw.[STATUS_ENVIO],
                lw.[MENSAGEM_ERRO],
                lw.[DHENVIO]
              FROM [dbo].[LOG_ENVIO_WHATSAPP] lw
              INNER JOIN [dbo].[CONVOCACAO] c ON c.[IDCONVOCACAO] = lw.[IDCONVOCACAO]
              WHERE c.[IDVIAGEM] = @IDVIAGEM AND c.[TENANT_ID] = @TENANT_ID
              ORDER BY lw.[DHENVIO] DESC
              LIMIT @LIMITE
            `);
          rawEnvio = r2.recordset || [];
        } catch (e) {
          if (e && e.code !== '42P01') {
            console.warn('[LOGS WEBHOOK META] LOG_ENVIO_WHATSAPP:', e.message);
          }
        }
      }

      const normEnvio = rawEnvio.map((lw) => {
        const ok = String(lw.STATUS_ENVIO || lw.status_envio || '').toUpperCase() === 'ENVIADO';
        const cel = lw.NRCELULAR || lw.nrcelular || '';
        return {
          IDLOG: null,
          IDCONVOCACAO: lw.IDCONVOCACAO ?? lw.idconvocacao,
          TIPO: 'envio_switch',
          TITULO: ok ? 'Switch Digital - Enviado' : 'Switch Digital - Erro',
          MENSAGEM: ok ? `Enviado para ${cel}` : String(lw.MENSAGEM_ERRO || lw.mensagem_erro || 'Erro no envio').substring(0, 500),
          DETALHES: JSON.stringify({ fonte: 'LOG_ENVIO_WHATSAPP', idConvocacao: lw.IDCONVOCACAO ?? lw.idconvocacao }),
          STATUS_HTTP: null,
          TEMPO_RESPOSTA: null,
          DHLOG: lw.DHENVIO || lw.dhenvio,
          __dedupe: 'envio'
        };
      });
      const normMeta = rawMeta.map((m) => ({ ...m, __dedupe: 'meta' }));
      let combined = [...normMeta, ...normEnvio];
      combined.sort((a, b) => {
        const ta = a.DHLOG ? new Date(a.DHLOG).getTime() : 0;
        const tb = b.DHLOG ? new Date(b.DHLOG).getTime() : 0;
        return tb - ta;
      });

      if (idViagem && !idConvocacao && normEnvio.length) {
        const out = [];
        for (const row of combined) {
          if (row.__dedupe === 'envio') {
            const t = row.DHLOG ? new Date(row.DHLOG).getTime() : 0;
            // Só omitir LOG_ENVIO_WHATSAPP se já existir meta do *mesmo* disparo Switch (título "Switch Digital …").
            // Metas "Fluxo WhatsApp – DIVERGENCIA_…", DIVULGACAO, webhooks etc. não devem esconder o envio.
            const dup = out.some(
              (x) =>
                x.__dedupe === 'meta' &&
                Number(x.IDCONVOCACAO) === Number(row.IDCONVOCACAO) &&
                Math.abs((x.DHLOG ? new Date(x.DHLOG).getTime() : 0) - t) < 5000 &&
                /^Switch Digital\b/i.test(String(x.TITULO || x.titulo || ''))
            );
            if (dup) continue;
          }
          out.push(row);
        }
        combined = out;
      }

      combined = combined.slice(0, lim);

      const logs = combined.map((log) => {
        const { __dedupe, ...rest } = log;
        let detalhesParsed = null;
        try {
          if (rest.DETALHES) {
            if (typeof rest.DETALHES === 'string') {
              detalhesParsed = JSON.parse(rest.DETALHES);
            } else {
              detalhesParsed = rest.DETALHES;
            }
          }
        } catch (e) {
          detalhesParsed = rest.DETALHES;
        }

        let tsIso = null;
        if (rest.DHLOG) {
          const d = rest.DHLOG;
          if (d instanceof Date && !isNaN(d.getTime())) tsIso = d.toISOString();
          else {
            const t = new Date(d);
            if (!isNaN(t.getTime())) tsIso = t.toISOString();
          }
        }
        return {
          ...rest,
          detalhes: detalhesParsed,
          timestamp: tsIso
        };
      });

      res.json(logs);
    } catch (err) {
      console.error('[LOGS WEBHOOK META] Erro ao listar logs:', err);
      console.error('[LOGS WEBHOOK META] Stack trace:', err.stack);
      res.status(500).json({ error: 'Erro ao listar logs.', details: err.message });
    }
  },

  // ========== WEBHOOK CALLBACK META ==========

// Pré-check de saúde da integração Switch Digital (antes de iniciar fila)
  verificarSaudeSwitchDigital: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tenantId = tenantIdForRequest(req);

      const configResult = await pool
        .request()
        .input('tenantId', sql.NVarChar(64), tenantId)
        .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId
          AND "CHAVE" IN ('switch_digital_endpoint', 'switch_digital_token')
      `);

      let endpoint = 'https://api.switchdigital.com.br/api/messages/send';
      let token = '';
      for (const r of (configResult.recordset || [])) {
        const k = r.CHAVE || r.chave;
        const v = r.VALOR || r.valor;
        if (k === 'switch_digital_endpoint' && v) endpoint = String(v);
        if (k === 'switch_digital_token' && v) token = String(v);
      }

      if (!token || !token.trim()) {
        return res.status(400).json({
          healthy: false,
          code: 'SWITCH_TOKEN_NOT_CONFIGURED',
          message: 'Token da Switch Digital não configurado. Configure em Configurações > Switch / WhatsApp.'
        });
      }

      // Heurística de saúde (só para badge / pré-check leve):
      // - Último sucesso → ativa
      // - Último ERR_WAPP_NOT_INITIALIZED só bloqueia por poucos minutos (evita ficar 30 min
      //   preso depois que o usuário já reconectou o WhatsApp na Switch).
      const logsResult = await pool
        .request()
        .input('TENANT_ID', sql.NVarChar(64), tenantId)
        .query(`
          SELECT [l].[TITULO], [l].[MENSAGEM], [l].[DETALHES], [l].[DHLOG]
          FROM [dbo].[LOGSWEBHOOKMETA] [l]
          INNER JOIN [dbo].[CONVOCACAO] [c] ON [c].[IDCONVOCACAO] = [l].[IDCONVOCACAO]
          WHERE [l].[TIPO] = 'envio_switch'
            AND [c].[TENANT_ID] = @TENANT_ID
          ORDER BY [l].[DHLOG] DESC
          LIMIT 80
        `);

      const agora = Date.now();
      const JANELA_MINUTOS = 1.5;
      const eventoDecisivo = (logsResult.recordset || []).find((row) => {
        const titulo = String(row.TITULO ?? row.titulo ?? '');
        const msg = String(row.MENSAGEM ?? row.mensagem ?? '');
        const det = String(row.DETALHES ?? row.detalhes ?? '');
        const txt = `${titulo} ${msg} ${det}`;
        const isSuccess = /Switch Digital - Enviado|Enviado para\s+\d+/i.test(txt);
        const isNotInit = /ERR_WAPP_NOT_INITIALIZED|WAPP_NOT_INITIALIZED/i.test(txt);
        if (!isSuccess && !isNotInit) return false;
        return true;
      });

      if (eventoDecisivo) {
        const titulo = String(eventoDecisivo.TITULO ?? eventoDecisivo.titulo ?? '');
        const msg = String(eventoDecisivo.MENSAGEM ?? eventoDecisivo.mensagem ?? '');
        const det = String(eventoDecisivo.DETALHES ?? eventoDecisivo.detalhes ?? '');
        const txt = `${titulo} ${msg} ${det}`;
        const isSuccess = /Switch Digital - Enviado|Enviado para\s+\d+/i.test(txt);
        const isNotInit = /ERR_WAPP_NOT_INITIALIZED|WAPP_NOT_INITIALIZED/i.test(txt);
        if (isSuccess) {
          return res.json({
            healthy: true,
            code: 'OK',
            message: 'Integração Switch Digital apta para disparo da fila.',
            endpoint
          });
        }
        if (isNotInit) {
          const dh = eventoDecisivo.DHLOG ?? eventoDecisivo.dhlog;
          const ts = dh ? new Date(dh).getTime() : NaN;
          const diffMin = Number.isFinite(ts) ? ((agora - ts) / 60000) : 999;
          if (Number.isFinite(diffMin) && diffMin <= JANELA_MINUTOS) {
            return res.status(409).json({
              healthy: false,
              code: 'ERR_WAPP_NOT_INITIALIZED',
              message:
                'Switch Digital sem sessão ativa de WhatsApp (falha recente). Conecte o WhatsApp no painel da Switch (QR) e dispare de novo em ~1–2 min.',
              endpoint,
              retryAfterSeconds: Math.max(5, Math.ceil((JANELA_MINUTOS - diffMin) * 60))
            });
          }
          // Erro antigo: libera nova tentativa (usuário pode já ter reconectado)
          return res.json({
            healthy: true,
            code: 'OK_RETRY_AFTER_WAPP_ERROR',
            message:
              'Última falha de sessão WhatsApp já passou. Pode disparar de novo — a Switch precisa estar conectada.',
            endpoint,
            lastWappErrorMinutesAgo: Math.round(diffMin)
          });
        }
      }

      // Sem evidência recente de sessão inativa: segue como saudável.

      return res.json({
        healthy: true,
        code: 'OK',
        message: 'Integração Switch Digital apta para disparo da fila.',
        endpoint
      });
    } catch (err) {
      console.error('[SWITCH DIGITAL] Erro no pré-check de saúde:', err);
      return res.status(500).json({
        healthy: false,
        code: 'SWITCH_HEALTHCHECK_ERROR',
        message: 'Falha ao verificar saúde da integração Switch Digital.',
        details: err.message
      });
    }
  },

// Função nova para integrar com Switch Digital
  enviarWebhookSwitchDigital: async (req, res) => {
    try {
      const { viagemId, convocacoes, baseUrl: baseUrlBody } = req.body;
      console.log('[SWITCH DIGITAL LOG] Endpoint chamado - viagemId=', viagemId, 'convocacoes=', convocacoes?.length, 'ts=', new Date().toISOString());

      if (!viagemId || !convocacoes || !Array.isArray(convocacoes) || convocacoes.length === 0) {
        return res.status(400).json({ error: 'ID da viagem e lista de convocações são obrigatórios.' });
      }

      // 1. Buscar configurações do Switch Digital no banco
      const pool = await poolPromise;
      const tidSwitch = tenantIdForRequest(req);

      const bloqueioConf = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(viagemId))
        .input('TENANT_ID', sql.NVarChar(64), tidSwitch)
        .query(`
          SELECT 1 FROM [dbo].[CONVOCACAO]
          WHERE [IDVIAGEM] = @IDVIAGEM AND [TENANT_ID] = @TENANT_ID AND [STATUS] = 'CONFIRMADA'
        `);
      if (bloqueioConf.recordset && bloqueioConf.recordset.length > 0) {
        return res.status(409).json({
          error: 'Esta viagem já possui motorista confirmado. Não é possível disparar WhatsApp de convocação para ela.'
        });
      }
      const configResult = await pool
        .request()
        .input('tenantId', sql.NVarChar(64), tidSwitch)
        .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId
          AND "CHAVE" IN ('switch_digital_endpoint', 'switch_digital_metodo', 'switch_digital_content_type', 'switch_digital_token', 'switch_digital_user_id', 'switch_digital_queue_id', 'switch_digital_send_signature', 'switch_digital_close_ticket', 'moeda_padrao')
      `);

      const config = {
        endpoint: 'https://api.switchdigital.com.br/api/messages/send',
        metodo: 'POST',
        contentType: 'application/json',
        token: '',
        userId: '',
        queueId: '',
        sendSignature: true,
        closeTicket: true,
        moeda: 'BRL'
      };

      if (configResult.recordset) {
        configResult.recordset.forEach(r => {
          const k = r.CHAVE || r.chave;
          const v = r.VALOR || r.valor;
          if (k === 'switch_digital_endpoint') config.endpoint = v;
          if (k === 'switch_digital_metodo') config.metodo = v;
          if (k === 'switch_digital_content_type') config.contentType = v;
          if (k === 'switch_digital_token') config.token = v;
          if (k === 'switch_digital_user_id') config.userId = v;
          if (k === 'switch_digital_queue_id') config.queueId = v;
          if (k === 'switch_digital_send_signature') config.sendSignature = parseSwitchSendSignatureFromDb(v);
          if (k === 'switch_digital_close_ticket') config.closeTicket = parseSwitchCloseTicketFromDb(v);
          if (k === 'moeda_padrao') config.moeda = v;
        });
      }

      console.log(
        '[SWITCH DIGITAL] fila disparos (CONFIGURACAO): sendSignature=%s closeTicket=%s userId=%s queueId=%s',
        config.sendSignature,
        config.closeTicket,
        (config.userId && String(config.userId).trim()) || '(omitido)',
        (config.queueId && String(config.queueId).trim()) || '(omitido)'
      );

      if (!config.token) {
        return res.status(400).json({ error: 'Token da Switch Digital não configurado. Verifique as Configurações do Sistema.' });
      }

      // URL base para o link de aceitar/recusar (PUBLIC_URL manda se for público; ignora localhost do browser)
      const baseUrl = resolverBaseUrlPublica(baseUrlBody);
      console.log('[SWITCH DIGITAL] baseUrl link convocação =', baseUrl, '| body=', baseUrlBody || '(vazio)', '| PUBLIC_URL=', process.env.PUBLIC_URL || '(vazio)');

      // 2. Buscar dados da viagem para montar a mensagem completa (formato histórico)
      let viagem = null;
      let pontosParada = [];
      try {
        const viagemResult = await pool.request()
          .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(viagemId))
          .input('TENANT_ID', sql.NVarChar(64), tidSwitch)
          .query(`
          SELECT [v].[IDVIAGEM],[v].[IDROTEIRO],[v].[DTPREVINICIO],[v].[DTPREVFINAL],[v].[VLFRETE],[v].[PESO],[v].[CUBAGEM],[v].[OBSERV],[v].[FGRASTREADO],
            [r].[DSROTEIRO],[cf].[DSCLASSEFROTA],[tv].[CDTIPOVIAGEM],[tv].[DSTIPOVIAGEM],
            [co].[NMCIDADE] AS ORIGEM_CIDADE,[co].[ESTADO] AS ORIGEM_ESTADO,[po].[SGPAIS] AS ORIGEM_PAIS,[po].[DSPAIS] AS ORIGEM_PAIS_NOME,
            [cd].[NMCIDADE] AS DESTINO_CIDADE,[cd].[ESTADO] AS DESTINO_ESTADO,[pd].[SGPAIS] AS DESTINO_PAIS,[pd].[DSPAIS] AS DESTINO_PAIS_NOME,
            upper(COALESCE(NULLIF(TRIM([cg].[RZSOCIAL]), ''), TRIM([cg].[NMFANTASIA]))) AS CONTRATADOR_NOME
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO] AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[PAIS] [po] ON [co].[CDPAIS] = [po].[CDPAIS]
          LEFT JOIN [dbo].[PAIS] [pd] ON [cd].[CDPAIS] = [pd].[CDPAIS]
          LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
            AND ([cf].[TENANT_ID] = [v].[TENANT_ID] OR [cf].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[TIPOVIAGEM] [tv] ON [v].[CDTIPOVIAGEM] = [tv].[CDTIPOVIAGEM]
            AND ([tv].[TENANT_ID] = [v].[TENANT_ID] OR [tv].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
          WHERE [v].[IDVIAGEM] = @IDVIAGEM AND [v].[TENANT_ID] = @TENANT_ID
        `);
        if (viagemResult.recordset && viagemResult.recordset[0]) {
          const row = viagemResult.recordset[0];
          const get = (obj, ...keys) => { for (const k of keys) { if (obj[k] != null) return obj[k]; const l = k.toLowerCase(); if (obj[l] != null) return obj[l]; } return undefined; };
          viagem = {
            IDVIAGEM: row.IDVIAGEM ?? row.idviagem,
            IDROTEIRO: row.IDROTEIRO ?? row.idroteiro,
            CDTIPOVIAGEM: row.CDTIPOVIAGEM ?? row.cdtipoviagem,
            DSTIPOVIAGEM: get(row, 'DSTIPOVIAGEM') || 'Não informado',
            DSCLASSEFROTA: get(row, 'DSCLASSEFROTA') || 'Não informado',
            DSROTEIRO: get(row, 'DSROTEIRO') || 'Não informado',
            ORIGEM_CIDADE: get(row, 'ORIGEM_CIDADE') || 'Não informada',
            ORIGEM_ESTADO: get(row, 'ORIGEM_ESTADO') || '',
            ORIGEM_PAIS: get(row, 'ORIGEM_PAIS') || get(row, 'ORIGEM_PAIS_NOME') || '',
            DESTINO_CIDADE: get(row, 'DESTINO_CIDADE') || 'Não informada',
            DESTINO_ESTADO: get(row, 'DESTINO_ESTADO') || '',
            DESTINO_PAIS: get(row, 'DESTINO_PAIS') || get(row, 'DESTINO_PAIS_NOME') || '',
            DTPREVINICIO: row.DTPREVINICIO ?? row.dtprevinicio,
            DTPREVFINAL: row.DTPREVFINAL ?? row.dtprevfinal,
            CONTRATADOR_NOME: get(row, 'CONTRATADOR_NOME') || 'Não informado',
            VLFRETE: row.VLFRETE ?? row.vlfrete,
            PESO: row.PESO ?? row.peso,
            CUBAGEM: row.CUBAGEM ?? row.cubagem,
            OBSERV: row.OBSERV ?? row.observ,
            FGRASTREADO: (row.FGRASTREADO ?? row.fgrastreado) === 'S' ? 'S' : 'N'
          };
        }
        // Pontos para a mensagem: apenas Origem (O), Parada (R) e Destino (D) – NÃO incluir Passagem (P)
        if (viagem && viagem.IDROTEIRO) {
          try {
            const ptsResult = await pool.request().input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(viagem.IDROTEIRO)).query(`
              SELECT [rp].[TPLOCAL],[rp].[ORDEM],[rp].[SEQUENCIA],[rp].[DSLOCAL],[rp].[ESTADOPASSAGEM],[rp].[CDPAISPASSAGEM],
                [p].[SGPAIS] AS PAIS_SIGLA,[p].[DSPAIS] AS PAIS_NOME
              FROM [dbo].[ROTEIROPONTOS] [rp]
              LEFT JOIN [dbo].[PAIS] [p] ON (
                CAST([p].[CDPAIS] AS VARCHAR(20)) = CAST([rp].[CDPAISPASSAGEM] AS VARCHAR(20))
                OR [p].[SGPAIS] = CAST([rp].[CDPAISPASSAGEM] AS VARCHAR(20))
              )
              WHERE [rp].[IDROTEIRO] = @IDROTEIRO
              ORDER BY [rp].[ORDEM] ASC, [rp].[SEQUENCIA] ASC
            `);
            const ptsRows = ptsResult.recordset || [];
            const tiposExibir = new Set(['O', 'D', 'R']); // Origem, Destino, Parada (exclui P = Passagem)
            pontosParada = ptsRows
              .filter(r => {
                const t = String(r.TPLOCAL ?? r.tplocal ?? '').trim().toUpperCase().substring(0, 1);
                return tiposExibir.has(t);
              })
              .map(r => {
                const paisSigla = (r.PAIS_SIGLA ?? r.pais_sigla ?? '').toString().trim();
                const paisNome = (r.PAIS_NOME ?? r.pais_nome ?? '').toString().trim();
                const pais = paisSigla || paisNome || String(r.CDPAISPASSAGEM ?? r.cdpaispassagem ?? '').trim();
                return {
                  pais,
                  estado: String(r.ESTADOPASSAGEM ?? r.estadopassagem ?? '').trim(),
                  cidade: String(r.DSLOCAL ?? r.dslocal ?? '').trim()
                };
              });
          } catch (ePontos) {
            // Fallback sem join e sem TPLOCAL (ex.: coluna não existir)
            try {
              const ptsSimple = await pool.request().input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(viagem.IDROTEIRO)).query(`
                SELECT [TPLOCAL],[ORDEM],[SEQUENCIA],[DSLOCAL],[ESTADOPASSAGEM],[CDPAISPASSAGEM] FROM [dbo].[ROTEIROPONTOS] WHERE [IDROTEIRO] = @IDROTEIRO ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
              `);
              const ptsRows = ptsSimple.recordset || [];
              const tiposExibir = new Set(['O', 'D', 'R']);
              pontosParada = ptsRows
                .filter(r => {
                  const t = String(r.TPLOCAL ?? r.tplocal ?? '').trim().toUpperCase().substring(0, 1);
                  return tiposExibir.has(t);
                })
                .map(r => ({
                  pais: String(r.CDPAISPASSAGEM ?? r.cdpaispassagem ?? '').trim(),
                  estado: String(r.ESTADOPASSAGEM ?? r.estadopassagem ?? '').trim(),
                  cidade: String(r.DSLOCAL ?? r.dslocal ?? '').trim()
                }));
            } catch (e2) {
              try {
                const ptsMin = await pool.request().input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(viagem.IDROTEIRO)).query(`
                  SELECT [DSLOCAL],[ESTADOPASSAGEM],[CDPAISPASSAGEM] FROM [dbo].[ROTEIROPONTOS] WHERE [IDROTEIRO] = @IDROTEIRO ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
                `);
                const ptsRows = ptsMin.recordset || [];
                pontosParada = ptsRows.map(r => ({
                  pais: String(r.CDPAISPASSAGEM ?? r.cdpaispassagem ?? '').trim(),
                  estado: String(r.ESTADOPASSAGEM ?? r.estadopassagem ?? '').trim(),
                  cidade: String(r.DSLOCAL ?? r.dslocal ?? '').trim()
                }));
              } catch (e3) {}
            }
          }
        }
      } catch (e) {
        console.warn('[SWITCH DIGITAL] Erro ao buscar viagem para mensagem:', e.message);
      }

      const formatarDataHora = (dataHora) => {
        if (!dataHora) return 'Não informado';
        try {
          const s = String(dataHora).replace('Z', '').replace('T', ' ');
          const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
          if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
          const d = new Date(dataHora);
          if (isNaN(d.getTime())) return 'Data inválida';
          const pad = (n) => String(n).padStart(2, '0');
          return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        } catch (err) { return 'Data inválida'; }
      };

      // Intervalo entre envios (mínimo 2 segundos para evitar bloqueio da API)
      const INTERVALO_ENTRE_ENVIOS_MS = 2000;
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Módulo node-fetch para requisições
      const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

      // Array para guardar resultados e montar o retorno
      const resultados = [];
      let sucessos = 0;
      let erros = 0;
      let filaInterrompidaPorWappNaoInicializado = false;

      // Log de início de envio (persistido para aparecer em "Atualizar Logs")
      const idConvRef = (convocacoes[0] && (convocacoes[0].IDCONVOCACAO != null ? convocacoes[0].IDCONVOCACAO : convocacoes[0].idConvocacao)) || null;
      if (idConvRef != null) {
        try {
          console.log('[SWITCH DIGITAL LOG] Gravando log "Iniciando Envios" no banco');
          const sgUserLog = getSgUser(req) || 'SYSTEM';
          await pool.request()
            .input('IDCONVOCACAO', sql.Int, idConvRef)
            .input('TIPO', 'info')
            .input('TITULO', 'Iniciando Envios via Backend (Switch Digital)')
            .input('MENSAGEM', `Enviando lista de ${convocacoes.length} convocações para processamento na fila.`)
            .input('DETALHES', null)
            .input('STATUS_HTTP', null)
            .input('TEMPO_RESPOSTA', null)
            .input('sgUser', sgUserLog)
            .query(`
              INSERT INTO [dbo].[LOGSWEBHOOKMETA]
                ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES
                (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
            `);
        } catch (logErr) {
          console.error('[SWITCH DIGITAL] Erro ao gravar log Iniciando Envios:', logErr.message);
        }
      }

      let templatesConvocacaoDisparo = {};
      try {
        templatesConvocacaoDisparo = await convocacaoMsgTpl.carregarTemplatesConvocacao(pool, tidSwitch);
      } catch (eTpl) {
        console.warn('[SWITCH DIGITAL] Não foi possível carregar templates de convocação:', eTpl.message);
        templatesConvocacaoDisparo = {
          [convocacaoMsgTpl.CHAVE_DISPARO]: '',
          [convocacaoMsgTpl.CHAVE_CONF_SELECIONADO]: '',
          [convocacaoMsgTpl.CHAVE_CONF_NAO_SELECIONADO]: '',
        };
      }

      // 3. Processar a fila, um a um, com intervalo de 5 segundos
      for (let i = 0; i < convocacoes.length; i++) {
        if (filaInterrompidaPorWappNaoInicializado) {
          break;
        }
        const c = convocacoes[i];
        const idConvItem = c.IDCONVOCACAO ?? c.idConvocacao ?? c.idconvocacao ?? c.ID_CONVOCACAO;
        
        // Extrair o número limpando caracteres especiais
        let numeroLimpo = (c.FONE1 || c.FONE || c.NRCELULAR || c.CELULAR || '').toString().replace(/\D/g, '');
        if (!numeroLimpo || numeroLimpo.length < 10) {
           resultados.push({ idConvocacao: idConvItem, status: 'erro', mensagem: 'Motorista sem número de WhatsApp válido' });
           erros++;
           continue;
        }

        const v = viagem || c;
        const valorFreteFmt = parseFloat(v.VLFRETE || 0).toLocaleString('pt-BR', { style: 'currency', currency: config.moeda });
        // Peso: se valor >= 1000 assume kg e converte para ton (ex.: 12345 kg -> 12,35 ton); senão assume já em ton
        const pesoNum = parseFloat(v.PESO || 0);
        const pesoEmTon = pesoNum >= 1000 ? pesoNum / 1000 : pesoNum;
        const pesoFmt = pesoEmTon.toFixed(2).replace('.', ',');
        const cubagemFmt = (parseFloat(v.CUBAGEM || 0)).toFixed(2).replace('.', ',');
        const linkConvocacao = resolverLinkConvocacaoParaMensagem(c, baseUrl);
        if (!linkConvocacao) {
          console.warn('[SWITCH DIGITAL] Link da convocação vazio — IDCONVOCACAO/LINKCONVOCACAO ausente ou inválido no item da fila.', {
            idConvocacao: idConvItem,
            keys: Object.keys(c || {}),
          });
        }

        // Mensagem padronizada: saudação + CARGA DISPONÍVEL (tipo com código, rota, país, pontos de parada) + link
        const nomeMotoristaConv = (c.NOME_MOTORISTA || 'Motorista').toString().trim();
        const tipoViagemFmt = [v.CDTIPOVIAGEM, v.DSTIPOVIAGEM].filter(Boolean).join(' - ') || (v.DSTIPOVIAGEM || 'Não informado');
        const rotaLinha = v.DSROTEIRO || `${(v.ORIGEM_CIDADE || '').trim()} -> ${(v.DESTINO_CIDADE || '').trim()}`.trim() || 'Não informado';
        const textoWhatsApp = convocacaoMsgTpl.resolverCorpoDisparo(templatesConvocacaoDisparo, {
          nomeMotoristaConv,
          viagemId,
          v,
          tipoViagemFmt,
          rotaLinha,
          pontosParada,
          formatarDataHora,
          valorFreteFmt,
          pesoFmt,
          cubagemFmt,
          linkConvocacao,
        });

        // Montar Payload Switch Digital
        const requestBody = {
          number: numeroLimpo,
          body: textoWhatsApp,
          sendSignature: config.sendSignature,
          closeTicket: config.closeTicket
        };

        if (config.userId && config.userId.trim() !== '') requestBody.userId = config.userId.trim();
        if (config.queueId && config.queueId.trim() !== '') requestBody.queueId = config.queueId.trim();

        let logStatusEnvio = 'ERRO';
        let logMensagemErro = null;
        let logDhEnvio = null;
        let logStatusHttp = null;
        let logTempoResposta = null;
        let logDetalhesJson = null;

        try {
          console.log(`[SWITCH DIGITAL] Enviando msg para ${numeroLimpo} (Convocacao ${idConvItem})...`);
          const inicio = Date.now();
          
          const switchRes = await fetch(config.endpoint, {
            method: config.metodo,
            headers: {
              'Authorization': `Bearer ${config.token}`,
              'Content-Type': config.contentType
            },
            body: JSON.stringify(requestBody)
          });

          const tempo = Date.now() - inicio;
          const responseText = await switchRes.text();
          let responseData;
          try { responseData = JSON.parse(responseText); } catch(e) { responseData = responseText; }

          const normalizarErroSwitch = (input) => {
            let txt = input != null ? String(input) : '';
            if (!txt) return txt;
            // Evitar exibir "Atendente: undefined/null" para o usuário.
            txt = txt.replace(/Atendente:\s*(undefined|null)\b/gi, 'Atendente: não informado');
            return txt;
          };

          if (switchRes.ok) {
            sucessos++;
            resultados.push({ idConvocacao: idConvItem, status: 'sucesso', tempo: tempo, api: responseData });
            logStatusEnvio = 'ENVIADO';
            logDhEnvio = new Date();
            logStatusHttp = switchRes.status;
            logTempoResposta = tempo;
            logDetalhesJson = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);
            
            // Atualizar DHENVIOMETA apenas quando envio foi sucesso (motorista acionado)
            if (idConvItem != null && idConvItem !== '') {
            try {
              const tidSw = (c.TENANT_ID != null && String(c.TENANT_ID).trim() !== '')
                ? String(c.TENANT_ID).trim()
                : (c.tenant_id != null && String(c.tenant_id).trim() !== '')
                  ? String(c.tenant_id).trim()
                  : tenantIdForRequest(req);
              await pool.request()
                .input('id', sql.Int, idConvItem)
                .input('TENANT_ID', sql.NVarChar(64), tidSw)
                .query(
                  `UPDATE [dbo].[CONVOCACAO] SET [DHENVIOMETA] = GETDATE(), [DHMAINTENANCE] = GETDATE() WHERE [IDCONVOCACAO] = @id AND [TENANT_ID] = @TENANT_ID`
                );
            } catch(e) {}
            }

          } else {
            erros++;
            if (responseData && typeof responseData === 'object') {
              if (responseData.error) responseData.error = normalizarErroSwitch(responseData.error);
              if (responseData.message) responseData.message = normalizarErroSwitch(responseData.message);
            }
            const rawError = typeof responseData === 'object'
              ? normalizarErroSwitch(responseData.message || responseData.error || JSON.stringify(responseData))
              : normalizarErroSwitch(responseData);
            const mensagemAmigavel = (() => {
              const txt = normalizarErroSwitch((typeof responseData === 'object' && responseData.error ? responseData.error : rawError) || '');
              if (/ticket em outro atendimento|em outro atendimento/i.test(txt)) {
                return `Número ${numeroLimpo}: não foi possível enviar — já existe conversa em aberto com este contato no atendimento. Feche ou transfira o atendimento no painel da Switch Digital antes de reenviar.`;
              }
              if (/conversa em aberto|conversation already open/i.test(txt)) {
                return `Número ${numeroLimpo}: conversa já em aberto com este contato. Encerre ou transfira no painel antes de reenviar.`;
              }
              if (/ERR_WAPP_NOT_INITIALIZED|WAPP_NOT_INITIALIZED/i.test(txt)) {
                return `Número ${numeroLimpo}: integração Switch Digital sem sessão ativa de WhatsApp (ERR_WAPP_NOT_INITIALIZED). Inicialize/conecte o WhatsApp no painel da Switch Digital e tente novamente.`;
              }
              return `Número ${numeroLimpo}: ${txt.substring(0, 300)}`;
            })();
            logMensagemErro = mensagemAmigavel.substring(0, 500);
            resultados.push({ idConvocacao: idConvItem, status: 'erro', httpStatus: switchRes.status, detalhe: responseData, mensagemAmigavel });
            logStatusHttp = switchRes.status;
            logTempoResposta = tempo;
            logDetalhesJson = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);

            // Quando a sessão WhatsApp não está inicializada na Switch, interromper a fila evita
            // múltiplas tentativas inúteis com o mesmo erro para os próximos motoristas.
            if (/ERR_WAPP_NOT_INITIALIZED|WAPP_NOT_INITIALIZED/i.test(rawError || '')) {
              filaInterrompidaPorWappNaoInicializado = true;
            }
          }
        } catch (errApi) {
          erros++;
          resultados.push({ idConvocacao: idConvItem, status: 'erro', mensagem: errApi.message });
          logMensagemErro = (errApi.message || '').substring(0, 500);
          logDetalhesJson = JSON.stringify({ error: errApi.message });
        }

        // Gravar em LOG_ENVIO_WHATSAPP e LOGSWEBHOOKMETA para histórico e auditoria (só se IDCONVOCACAO existir)
        const idConv = idConvItem;
        const nrCel = numeroLimpo;
        const detalhesStr = (logDetalhesJson || '').substring(0, 4000);
        if (idConv != null && idConv !== '') {
        try {
          const sgUserLog = getSgUser(req) || 'SYSTEM';

          await pool.request()
            .input('IDCONVOCACAO', sql.Int, idConv)
            .input('NRCELULAR', nrCel)
            .input('STATUS_ENVIO', logStatusEnvio)
            .input('MENSAGEM_ERRO', logMensagemErro)
            .input('DHENVIO', logDhEnvio)
            .input('DHRESPOSTA_API', logDhEnvio)
            .input('TENTATIVAS', 1)
            .input('sgUser', sgUserLog)
            .query(`
              INSERT INTO [dbo].[LOG_ENVIO_WHATSAPP]
                ([IDCONVOCACAO], [NRCELULAR], [STATUS_ENVIO], [MENSAGEM_ERRO], [DHENVIO], [DHRESPOSTA_API], [TENTATIVAS], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES
                (@IDCONVOCACAO, @NRCELULAR, @STATUS_ENVIO, @MENSAGEM_ERRO, @DHENVIO, @DHRESPOSTA_API, @TENTATIVAS, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
            `);

          await pool.request()
            .input('IDCONVOCACAO', sql.Int, idConv)
            .input('TIPO', 'envio_switch')
            .input('TITULO', `Switch Digital - ${logStatusEnvio === 'ENVIADO' ? 'Enviado' : 'Erro'}`)
            .input('MENSAGEM', logStatusEnvio === 'ENVIADO' ? `Enviado para ${nrCel}` : (logMensagemErro || `Erro no envio para ${nrCel}`))
            .input('DETALHES', detalhesStr)
            .input('STATUS_HTTP', logStatusHttp)
            .input('TEMPO_RESPOSTA', logTempoResposta)
            .input('sgUser', sgUserLog)
            .query(`
              INSERT INTO [dbo].[LOGSWEBHOOKMETA]
                ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES
                (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
            `);
        } catch (logErr) {
          console.error('[SWITCH DIGITAL] Erro ao gravar log (LOG_ENVIO_WHATSAPP/LOGSWEBHOOKMETA):', logErr.message, logErr.stack);
        }
        } else {
          console.warn('[SWITCH DIGITAL] Convocação sem IDCONVOCACAO - envio realizado mas log não gravado para esta linha. Verifique se o frontend envia IDCONVOCACAO ao disparar da aba Compatíveis.');
        }

        // Aguardar intervalo antes do próximo envio (evita bloqueio e respeita fila)
        if (i < convocacoes.length - 1) {
          await sleep(INTERVALO_ENTRE_ENVIOS_MS);
        }
      }

      // Registrar convocações restantes como não processadas quando a fila foi interrompida
      // por indisponibilidade da sessão WhatsApp na Switch Digital.
      if (filaInterrompidaPorWappNaoInicializado) {
        const idsJaProcessados = new Set(
          resultados
            .map(r => r && (r.idConvocacao != null ? String(r.idConvocacao) : null))
            .filter(Boolean)
        );
        for (const cRest of convocacoes) {
          const idRest = cRest.IDCONVOCACAO ?? cRest.idConvocacao ?? cRest.idconvocacao ?? cRest.ID_CONVOCACAO;
          const idRestStr = idRest != null ? String(idRest) : null;
          if (idRestStr && idsJaProcessados.has(idRestStr)) continue;
          erros++;
          resultados.push({
            idConvocacao: idRest,
            status: 'erro',
            httpStatus: 503,
            detalhe: { error: 'ERR_WAPP_NOT_INITIALIZED' },
            mensagemAmigavel: 'Fila interrompida: Switch Digital sem sessão ativa de WhatsApp (ERR_WAPP_NOT_INITIALIZED). Inicialize/conecte o WhatsApp no painel da Switch Digital e reenfileire os envios.'
          });
        }
      }

      // Log de fila processada (persistido para aparecer em "Atualizar Logs")
      if (idConvRef != null) {
        try {
          console.log('[SWITCH DIGITAL LOG] Gravando log "Fila Processada" no banco - sucessos=', sucessos, 'erros=', erros);
          const sgUserLog = getSgUser(req) || 'SYSTEM';
          const tipoFila = erros > 0 ? (sucessos > 0 ? 'warning' : 'erro') : 'sucesso';
          const mensagemFila = `O Servidor concluiu a fila de disparos. Sucessos: ${sucessos}, Erros: ${erros}`;
          const detalhesFila = JSON.stringify(resultados).substring(0, 4000);
          await pool.request()
            .input('IDCONVOCACAO', sql.Int, idConvRef)
            .input('TIPO', tipoFila)
            .input('TITULO', 'Fila Processada no Backend')
            .input('MENSAGEM', mensagemFila)
            .input('DETALHES', detalhesFila)
            .input('STATUS_HTTP', null)
            .input('TEMPO_RESPOSTA', null)
            .input('sgUser', sgUserLog)
            .query(`
              INSERT INTO [dbo].[LOGSWEBHOOKMETA]
                ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES
                (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
            `);
        } catch (logErr) {
          console.error('[SWITCH DIGITAL] Erro ao gravar log Fila Processada:', logErr.message);
        }
      }

      console.log('[SWITCH DIGITAL LOG] Respondendo ao cliente - total=', convocacoes.length, 'sucessos=', sucessos, 'erros=', erros);
      res.json({
        success: true,
        message: 'Fila de envios processada',
        total: convocacoes.length,
        sucessos: sucessos,
        erros: erros,
        detalhes: resultados
      });

    } catch (err) {
      console.error('Erro na função enviarWebhookSwitchDigital:', err);
      res.status(500).json({ error: 'Erro no servidor ao processar fila do Switch Digital', details: err.message });
    }
  },

  // Receber retorno do webhook Meta (callback)
  receberRetornoWebhookMeta: async (req, res) => {
    const inicioProcessamento = Date.now();

    // Log apenas os dados recebidos (formato limpo)
    const dadosRecebidos = {
      IDCONVOCACAO: req.body.IDCONVOCACAO || null,
      LATITUDE: req.body.LATITUDE || null,
      LONGITUDE: req.body.LONGITUDE || null,
      CDMOTIVORECUSA: req.body.CDMOTIVORECUSA || null
    };

    console.log('\n========================================');
    console.log('[WEBHOOK RETORNO] 📥 DADOS RECEBIDOS DA META');
    console.log(JSON.stringify(dadosRecebidos, null, 2));
    console.log('========================================\n');

    try {
      const { IDCONVOCACAO, LATITUDE, LONGITUDE, CDMOTIVORECUSA, STATUS } = req.body;

      if (!IDCONVOCACAO) {
        return res.status(400).json({ error: 'IDCONVOCACAO é obrigatório.' });
      }

      const pool = await poolPromise;
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO));

      // Verificar se a convocação existe e obter STATUS atual
      const checkResult = await request.query(`
        SELECT [IDCONVOCACAO], [STATUS], [TENANT_ID] FROM [dbo].[CONVOCACAO] WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const rowCb = checkResult.recordset[0];
      const statusAtual = rowCb.STATUS;
      const rawTidCb = rowCb.TENANT_ID ?? rowCb.tenant_id;
      const tidWebhookConv =
        rawTidCb != null && String(rawTidCb).trim() !== '' ? String(rawTidCb).trim() : getDefaultTenantId();

      // Determinar STATUS baseado nos dados recebidos
      // Se CDMOTIVORECUSA foi enviado, significa que foi RECUSADA
      // Se não tem CDMOTIVORECUSA mas tem localização, pode ser ACEITA
      // Se STATUS foi enviado explicitamente, usar esse valor
      let novoStatus = null;

      if (STATUS) {
        // Se STATUS foi enviado explicitamente, usar esse valor
        novoStatus = STATUS.toUpperCase();
      } else if (CDMOTIVORECUSA !== undefined && CDMOTIVORECUSA !== null && CDMOTIVORECUSA !== '') {
        // Se tem motivo de recusa, status é RECUSADA
        novoStatus = 'RECUSADA';
      } else if (LATITUDE !== undefined && LONGITUDE !== undefined &&
        LATITUDE !== null && LONGITUDE !== null &&
        LATITUDE !== '' && LONGITUDE !== '') {
        // Se tem localização mas não tem motivo de recusa, pode ser ACEITA
        // Mas só atualiza se ainda estiver PENDENTE
        if (statusAtual === 'PENDENTE') {
          novoStatus = 'ACEITA';
        }
      }

      // Montar query de atualização dinamicamente
      let updateFields = [];
      const updateRequest = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO))
        .input('TENANT_ID', sql.NVarChar(64), tidWebhookConv);

      // Sempre atualizar DHRESPOSTA quando houver retorno (colunas entre colchetes para PostgreSQL)
      updateFields.push('[DHRESPOSTA] = GETDATE()');

      // Atualizar STATUS se determinado
      if (novoStatus) {
        updateFields.push('[STATUS] = @STATUS');
        updateRequest.input('STATUS', sql.VarChar(20), novoStatus);
      }

      if (LATITUDE !== undefined && LATITUDE !== null && LATITUDE !== '') {
        updateFields.push('[LATITUDE] = @LATITUDE');
        updateRequest.input('LATITUDE', sql.Decimal(18, 15), parseFloat(LATITUDE));
      }

      if (LONGITUDE !== undefined && LONGITUDE !== null && LONGITUDE !== '') {
        updateFields.push('[LONGITUDE] = @LONGITUDE');
        updateRequest.input('LONGITUDE', sql.Decimal(18, 15), parseFloat(LONGITUDE));
      }

      if (CDMOTIVORECUSA !== undefined && CDMOTIVORECUSA !== null && CDMOTIVORECUSA !== '') {
        updateFields.push('[CDMOTIVORECUSA] = @CDMOTIVORECUSA');
        updateRequest.input('CDMOTIVORECUSA', sql.Int, parseInt(CDMOTIVORECUSA));
      }

      // Adicionar campos de manutenção
      updateFields.push('[DHMAINTENANCE] = GETDATE()');
      updateFields.push('[SGUSER] = \'DESKRIO\'');

      const updateQuery = `
        UPDATE [dbo].[CONVOCACAO]
        SET ${updateFields.join(', ')}
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID
      `;

      const result = await updateRequest.query(updateQuery);

      // Salvar log do callback (webhook não tem usuário logado; usa primeiro usuário do banco para FK)
      try {
        const firstUserResult = await pool.request().query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] ORDER BY [SGUSUARIO] LIMIT 1');
        const logSgUser = (firstUserResult.recordset && firstUserResult.recordset[0] && (firstUserResult.recordset[0].SGUSUARIO || firstUserResult.recordset[0].sgusuario)) || null;
        if (logSgUser) {
          const logRequest = pool.request()
            .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO))
            .input('TIPO', sql.VarChar(20), 'callback')
            .input('TITULO', sql.NVarChar(200), `Callback - Convocação ${IDCONVOCACAO}`)
            .input('MENSAGEM', sql.NVarChar(sql.MAX), `Callback recebido: ${novoStatus || 'sem alteração de status'}${CDMOTIVORECUSA ? ` | Motivo Recusa: ${CDMOTIVORECUSA}` : ''}${LATITUDE && LONGITUDE ? ' | Com localização' : ''}`)
            .input('DETALHES', sql.NVarChar(sql.MAX), JSON.stringify(dadosRecebidos))
            .input('STATUS_HTTP', sql.Int, 200)
            .input('TEMPO_RESPOSTA', sql.Int, Date.now() - inicioProcessamento)
            .input('sgUser', sql.VarChar(50), logSgUser);

          await logRequest.query(`
            INSERT INTO [dbo].[LOGSWEBHOOKMETA] 
              (IDCONVOCACAO, TIPO, TITULO, MENSAGEM, DETALHES, STATUS_HTTP, TEMPO_RESPOSTA, DHLOG, DHMAINTENANCE, SGUSER, SERVERORIG)
            VALUES 
              (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, GETDATE(), GETDATE(), @sgUser, 'AppDVcargas')
          `);
        }
      } catch (logErr) {
        console.error('[WEBHOOK RETORNO] Erro ao salvar log do callback:', logErr.message);
        // Não falhar a requisição se o log não for salvo
      }

      res.json({
        success: true,
        message: 'Dados recebidos e atualizados com sucesso!',
        camposAtualizados: {
          STATUS: novoStatus || 'não alterado',
          DHRESPOSTA: 'atualizado',
          LATITUDE: LATITUDE !== undefined ? 'atualizado' : 'não fornecido',
          LONGITUDE: LONGITUDE !== undefined ? 'atualizado' : 'não fornecido',
          CDMOTIVORECUSA: CDMOTIVORECUSA !== undefined ? 'atualizado' : 'não fornecido',
          DHMAINTENANCE: 'atualizado',
          SGUSER: 'DESKRIO'
        }
      });
    } catch (err) {
      console.error(`[WEBHOOK RETORNO] ❌ Erro ao processar retorno:`, err.message);
      res.status(500).json({ error: 'Erro ao processar retorno do webhook.', details: err.message });
    }
  },

  // Buscar histórico de viagens por roteiro (modo roteiro) ou referência regional (UF/mesorregião dos cadastros ROTEIRO → CIDADE)
  buscarHistoricoRoteiro: async (req, res) => {
    try {
      const modoRaw = (req.query.modo || 'roteiro').toString().toLowerCase().trim();
      const modo = modoRaw === 'regional' ? 'regional' : 'roteiro';
      const idRoteiro = req.query.idRoteiro != null && String(req.query.idRoteiro).trim() !== '' ? parseInt(req.query.idRoteiro, 10) : null;
      const ufOrigem = req.query.ufOrigem ? String(req.query.ufOrigem).trim().toUpperCase().substring(0, 2) : '';
      const ufDestino = req.query.ufDestino ? String(req.query.ufDestino).trim().toUpperCase().substring(0, 2) : '';

      function parseMesoKey(raw) {
        if (raw == null || String(raw).trim() === '') return null;
        const s = String(raw).trim();
        const idx = s.indexOf('_');
        if (idx < 1) return null;
        const a = parseInt(s.slice(0, idx), 10);
        const b = parseInt(s.slice(idx + 1), 10);
        if (Number.isNaN(a) || Number.isNaN(b)) return null;
        return { cduf: a, cdmeso: b };
      }

      const mesoOrigem = parseMesoKey(req.query.mesoOrigem);
      const mesoDestino = parseMesoKey(req.query.mesoDestino);

      const temFiltroRegional = !!(ufOrigem || ufDestino || mesoOrigem || mesoDestino);

      if (modo === 'roteiro') {
        if (!idRoteiro || Number.isNaN(idRoteiro)) {
          return res.status(400).json({ error: 'ID do Roteiro é obrigatório no modo roteiro.' });
        }
      } else {
        if (!temFiltroRegional) {
          return res.status(400).json({
            error: 'No modo regional, informe ao menos UF origem, UF destino ou uma mesorregião (origem e/ou destino).'
          });
        }
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);

      const joinsGeo = `
        LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
          AND ([R].[TENANT_ID] = [VM].[TENANT_ID] OR [R].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [CO] ON [R].[CDCIDADEORIGEM] = [CO].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [CD] ON [R].[CDCIDADEDESTINO] = [CD].[CDCIDADE]
      `;

      const selectGeo = `
          , [R].[DSROTEIRO] AS [DSROTEIRO_NOME]
          , [R].[IDROTEIRO] AS [IDROTEIRO_REF]
          , [CO].[ESTADO] AS [UF_ORIGEM]
          , [CD].[ESTADO] AS [UF_DESTINO]
      `;

      const viagensSelectCore = `
        SELECT 
          [VM].[IDVIAGEM],
          [TV].[DSTIPOVIAGEM],
          [SV].[DSSITUACAOVIAGEM],
          [CF].[DSCLASSEFROTA],
          [CF].[CDCLASSEFROTA],
          UPPER([CT].[RZSOCIAL]) AS CONTRATADOR,
          [CT].[NRCELULAR] AS CELCONTRATADOR,
          [VM].[DTPREVINICIO],
          [VM].[VLFRETE],
          [VM].[PESO],
          [VM].[FGRASTREADO],
          (SELECT UPPER([M].[RZSOCIAL])
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           INNER JOIN [dbo].[CADASTROGERAL] [M] ON [V].[CDMOTORISTA] = [M].[CDCADASTRO] AND [M].[TENANT_ID] = [VM].[TENANT_ID]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS MOTORISTA,
          (SELECT [M].[NRCELULAR]
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           INNER JOIN [dbo].[CADASTROGERAL] [M] ON [V].[CDMOTORISTA] = [M].[CDCADASTRO] AND [M].[TENANT_ID] = [VM].[TENANT_ID]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS CELMOTORISTA,
          (SELECT [V].[CDMOTORISTA]
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS CDMOTORISTA
          ${selectGeo}
        FROM [dbo].[VIAGEMMESTRE] [VM]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [SV] ON [VM].[CDSITUACAOVIAGEM] = [SV].[CDSITUACAOVIAGEM]
          AND ([SV].[TENANT_ID] = [VM].[TENANT_ID] OR [SV].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] [TV] ON [VM].[CDTIPOVIAGEM] = [TV].[CDTIPOVIAGEM]
          AND ([TV].[TENANT_ID] = [VM].[TENANT_ID] OR [TV].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] [CF] ON [VM].[CDCLASSEFROTA] = [CF].[CDCLASSEFROTA]
          AND ([CF].[TENANT_ID] = [VM].[TENANT_ID] OR [CF].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CADASTROGERAL] [CT] ON [VM].[CDCONTRATADOR] = [CT].[CDCADASTRO] AND [CT].[TENANT_ID] = [VM].[TENANT_ID]
        ${joinsGeo}
      `;

      let viagensQuery;
      const request = pool.request();
      request.input('TENANT_ID', sql.NVarChar(64), tid);

      if (modo === 'roteiro') {
        viagensQuery =
          viagensSelectCore +
          ` WHERE [VM].[IDROTEIRO] = @IDROTEIRO AND [VM].[TENANT_ID] = @TENANT_ID
        ORDER BY [VM].[DTPREVINICIO] DESC, [VM].[IDVIAGEM]`;
        request.input('IDROTEIRO', sql.Int, idRoteiro);
      } else {
        const parts = ['[VM].[TENANT_ID] = @TENANT_ID'];
        if (ufOrigem) {
          parts.push(
            '[CO].[CDCIDADE] IS NOT NULL AND UPPER(TRIM([CO].[ESTADO])) = @UF_ORIGEM'
          );
          request.input('UF_ORIGEM', sql.NVarChar(4), ufOrigem);
        }
        if (ufDestino) {
          parts.push(
            '[CD].[CDCIDADE] IS NOT NULL AND UPPER(TRIM([CD].[ESTADO])) = @UF_DESTINO'
          );
          request.input('UF_DESTINO', sql.NVarChar(4), ufDestino);
        }
        if (mesoOrigem) {
          parts.push(
            '[CO].[CDCIDADE] IS NOT NULL AND [CO].[CDUF] = @MESO_ORI_UF AND [CO].[CDMESOREGIAO] = @MESO_ORI_REG'
          );
          request.input('MESO_ORI_UF', sql.Int, mesoOrigem.cduf);
          request.input('MESO_ORI_REG', sql.Int, mesoOrigem.cdmeso);
        }
        if (mesoDestino) {
          parts.push(
            '[CD].[CDCIDADE] IS NOT NULL AND [CD].[CDUF] = @MESO_DST_UF AND [CD].[CDMESOREGIAO] = @MESO_DST_REG'
          );
          request.input('MESO_DST_UF', sql.Int, mesoDestino.cduf);
          request.input('MESO_DST_REG', sql.Int, mesoDestino.cdmeso);
        }
        viagensQuery =
          viagensSelectCore +
          ` WHERE ${parts.join(' AND ')}
        ORDER BY [VM].[DTPREVINICIO] DESC, [VM].[IDVIAGEM]`;
      }

      const result = await request.query(viagensQuery);

      let resumoQuery;
      const resumoRequest = pool.request();
      resumoRequest.input('TENANT_ID', sql.NVarChar(64), tid);

      const joinsGeoResumo = `
        LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
          AND ([R].[TENANT_ID] = [VM].[TENANT_ID] OR [R].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [CO] ON [R].[CDCIDADEORIGEM] = [CO].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [CD] ON [R].[CDCIDADEDESTINO] = [CD].[CDCIDADE]
      `;

      const resumoCore = `
        SELECT 
          [CF].[CDCLASSEFROTA],
          [CF].[DSCLASSEFROTA],
          COUNT(*) AS QUANTIDADE,
          MIN(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MINIMO,
          MAX(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MAXIMO,
          AVG(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MEDIO,
          SUM([VM].[PESO]) AS PESO_TOTAL
        FROM [dbo].[VIAGEMMESTRE] [VM]
        LEFT JOIN [dbo].[CLASSEFROTA] [CF] ON [VM].[CDCLASSEFROTA] = [CF].[CDCLASSEFROTA]
          AND ([CF].[TENANT_ID] = [VM].[TENANT_ID] OR [CF].[TENANT_ID] = 'default')
        ${joinsGeoResumo}
      `;

      if (modo === 'roteiro') {
        resumoQuery =
          resumoCore +
          ` WHERE [VM].[IDROTEIRO] = @IDROTEIRO AND [VM].[TENANT_ID] = @TENANT_ID
        GROUP BY [CF].[CDCLASSEFROTA], [CF].[DSCLASSEFROTA]
        ORDER BY [CF].[DSCLASSEFROTA]`;
        resumoRequest.input('IDROTEIRO', sql.Int, idRoteiro);
      } else {
        const partsR = ['[VM].[TENANT_ID] = @TENANT_ID'];
        if (ufOrigem) {
          partsR.push(
            '[CO].[CDCIDADE] IS NOT NULL AND UPPER(TRIM([CO].[ESTADO])) = @UF_ORIGEM'
          );
          resumoRequest.input('UF_ORIGEM', sql.NVarChar(4), ufOrigem);
        }
        if (ufDestino) {
          partsR.push(
            '[CD].[CDCIDADE] IS NOT NULL AND UPPER(TRIM([CD].[ESTADO])) = @UF_DESTINO'
          );
          resumoRequest.input('UF_DESTINO', sql.NVarChar(4), ufDestino);
        }
        if (mesoOrigem) {
          partsR.push(
            '[CO].[CDCIDADE] IS NOT NULL AND [CO].[CDUF] = @MESO_ORI_UF AND [CO].[CDMESOREGIAO] = @MESO_ORI_REG'
          );
          resumoRequest.input('MESO_ORI_UF', sql.Int, mesoOrigem.cduf);
          resumoRequest.input('MESO_ORI_REG', sql.Int, mesoOrigem.cdmeso);
        }
        if (mesoDestino) {
          partsR.push(
            '[CD].[CDCIDADE] IS NOT NULL AND [CD].[CDUF] = @MESO_DST_UF AND [CD].[CDMESOREGIAO] = @MESO_DST_REG'
          );
          resumoRequest.input('MESO_DST_UF', sql.Int, mesoDestino.cduf);
          resumoRequest.input('MESO_DST_REG', sql.Int, mesoDestino.cdmeso);
        }
        resumoQuery =
          resumoCore +
          ` WHERE ${partsR.join(' AND ')}
        GROUP BY [CF].[CDCLASSEFROTA], [CF].[DSCLASSEFROTA]
        ORDER BY [CF].[DSCLASSEFROTA]`;
      }

      const resumoResult = await resumoRequest.query(resumoQuery);

      // Formatar resumo (compatível com SQL Server maiúsculas e PostgreSQL minúsculas)
      const get = (row, ...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null) return row[k];
          const lower = k.toLowerCase();
          if (row[lower] !== undefined && row[lower] !== null) return row[lower];
        }
        return undefined;
      };
      const resumo = resumoResult.recordset.map(item => {
        const qtd = get(item, 'QUANTIDADE') ?? 0;
        const vMin = get(item, 'VALOR_MINIMO');
        const vMax = get(item, 'VALOR_MAXIMO');
        const vMed = get(item, 'VALOR_MEDIO');
        const pTotal = get(item, 'PESO_TOTAL');
        return {
          classefrota: get(item, 'DSCLASSEFROTA') || 'Não Informada',
          quantidade: Number(qtd),
          valorMinimo: vMin != null ? parseFloat(vMin).toFixed(2) : '0.00',
          valorMaximo: vMax != null ? parseFloat(vMax).toFixed(2) : '0.00',
          valorMedio: vMed != null ? parseFloat(vMed).toFixed(2) : '0.00',
          pesoTotal: pTotal != null ? parseFloat(pTotal).toFixed(2) : '0.00'
        };
      });

      const partesCriterio = [];
      if (modo === 'regional') {
        if (ufOrigem) partesCriterio.push(`UF origem ${ufOrigem}`);
        if (ufDestino) partesCriterio.push(`UF destino ${ufDestino}`);
        if (mesoOrigem) partesCriterio.push(`Mesorregião origem (${mesoOrigem.cduf}/${mesoOrigem.cdmeso})`);
        if (mesoDestino) partesCriterio.push(`Mesorregião destino (${mesoDestino.cduf}/${mesoDestino.cdmeso})`);
      }
      const criterioDescricao =
        modo === 'roteiro'
          ? `Roteiro ID ${idRoteiro}`
          : `Referência regional: ${partesCriterio.join(' · ') || '—'}`;

      // Formatar viagens (compatível com SQL Server maiúsculas e PostgreSQL minúsculas)
      const viagens = result.recordset.map(viagem => {
        const v = (key, def) => (viagem[key] ?? viagem[key?.toLowerCase?.()] ?? def);
        return {
          idViagem: v('IDVIAGEM', null),
          tipoViagem: v('DSTIPOVIAGEM', null),
          situacaoViagem: v('DSSITUACAOVIAGEM', null),
          classeFrota: v('DSCLASSEFROTA', null),
          contratador: v('CONTRATADOR', null),
          celContratador: v('CELCONTRATADOR', null),
          dtPrevInicio: v('DTPREVINICIO', null),
          vlFrete: v('VLFRETE', 0) != null ? parseFloat(v('VLFRETE', 0)).toFixed(2) : '0.00',
          peso: v('PESO', 0) != null ? parseFloat(v('PESO', 0)).toFixed(2) : '0.00',
          rastreado: (v('FGRASTREADO', '') === 'S' || v('FGRASTREADO', '') === 's') ? 'Sim' : 'Não',
          motorista: v('MOTORISTA', null) || 'Não Informado',
          celMotorista: v('CELMOTORISTA', null),
          cdMotorista: v('CDMOTORISTA', null),
          nomeRoteiro: v('DSROTEIRO_NOME', null),
          idRoteiro: v('IDROTEIRO_REF', null),
          ufOrigemRoteiro: v('UF_ORIGEM', null),
          ufDestinoRoteiro: v('UF_DESTINO', null)
        };
      });

      res.json({
        success: true,
        modo,
        criterioDescricao,
        totalRegistros: viagens.length,
        viagens: viagens,
        resumo: resumo
      });

    } catch (err) {
      console.error('[ERRO] Buscar histórico roteiro:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico do roteiro', details: err.message });
    }
  }
};

module.exports = viagemController;
