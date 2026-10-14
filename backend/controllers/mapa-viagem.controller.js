// backend/controllers/mapa-viagem.controller.js
const { poolPromise } = require('../config/db');
const fs = require('fs').promises;
const path = require('path');
const { tenantIdForRequest } = require('../utils/tenant-context');

// Nome da tabela de rastreamento: preferir VIAGEMRASTREAMENTO (onde estão os dados);
// VIAGEM_RASTREAMENTO costuma estar vazia.
async function detectarTabelaRastreamento(pool) {
  // Regra de ouro: se a tabela canônica existir com dados, usar ela.
  try {
    const canon = await pool.query(`
      SELECT COUNT(*)::bigint AS c
      FROM "public"."VIAGEMRASTREAMENTO"
    `);
    const cCanon = Number((canon.rows && canon.rows[0] && (canon.rows[0].c || canon.rows[0].C)) || 0);
    if (cCanon > 0) return { schema: 'public', tablename: 'VIAGEMRASTREAMENTO' };
  } catch (_) {
    // ignore e segue detecção dinâmica
  }

  const candidatas = [];
  for (const name of ['viagemrastreamento', 'viagem_rastreamento']) {
    try {
      const r = await pool.query(
        `
          SELECT schemaname, tablename
          FROM pg_tables
          WHERE schemaname IN ('dbo', 'public')
            AND LOWER(tablename) = $1
        `,
        [name]
      );
      for (const row of (r.rows || [])) {
        const t = (row.tablename || row.TABLENAME || '').trim();
        const schema = (row.schemaname || row.SCHEMANAME || 'public').trim();
        if (t) candidatas.push({ schema, tablename: t });
      }
    } catch (_) {
      // ignore
    }
  }
  if (candidatas.length === 0) return { schema: 'public', tablename: 'VIAGEMRASTREAMENTO' };

  // Eliminar duplicados schema+tabela
  const uniq = [];
  const seen = new Set();
  for (const c of candidatas) {
    const key = `${String(c.schema).toLowerCase()}::${String(c.tablename).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }

  async function getCols(schema, tablename) {
    try {
      const r = await pool.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
        `,
        [schema, tablename]
      );
      return (r.rows || [])
        .map((x) => String(x.column_name || x.COLUMN_NAME || '').trim())
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function pickCol(cols, ...cands) {
    for (const c of cands) {
      const found = cols.find((x) => x.toLowerCase() === String(c).toLowerCase());
      if (found) return found;
    }
    return null;
  }

  // Escolher a tabela com melhor "sinal de GPS": mais linhas com id+lat+lon.
  // Desempate por total de linhas e schema public.
  let best = null;
  for (const { schema, tablename } of uniq) {
    try {
      const cnt = await pool.query(`SELECT COUNT(*)::bigint AS c FROM "${schema}"."${tablename}"`);
      const c = Number((cnt.rows && cnt.rows[0] && (cnt.rows[0].c || cnt.rows[0].C)) || 0);
      const cols = await getCols(schema, tablename);
      const idv = pickCol(cols, 'IDVIAGEM', 'idviagem', 'ID_VIAGEM', 'id_viagem', 'VIAGEM_ID', 'viagem_id');
      const lat = pickCol(cols, 'LATITUDE', 'latitude', 'lat', 'vl_latitude', 'coord_lat');
      const lon = pickCol(cols, 'LONGITUDE', 'longitude', 'lon', 'lng', 'vl_longitude', 'coord_lon');
      let gps = 0;
      if (idv && lat && lon) {
        const g = await pool.query(
          `SELECT COUNT(*)::bigint AS g
             FROM "${schema}"."${tablename}"
            WHERE "${idv}" IS NOT NULL
              AND "${lat}" IS NOT NULL
              AND "${lon}" IS NOT NULL`
        );
        gps = Number((g.rows && g.rows[0] && (g.rows[0].g || g.rows[0].G)) || 0);
      }
      if (!best) {
        best = { schema, tablename, c, gps };
        continue;
      }
      if (gps > best.gps) {
        best = { schema, tablename, c, gps };
        continue;
      }
      if (gps === best.gps && c > best.c) {
        best = { schema, tablename, c, gps };
        continue;
      }
      if (gps === best.gps && c === best.c && schema === 'public' && best.schema !== 'public') {
        best = { schema, tablename, c, gps };
      }
    } catch (_) {
      // ignore
    }
  }

  if (best && best.tablename) return { schema: best.schema, tablename: best.tablename };
  return { schema: uniq[0].schema, tablename: uniq[0].tablename };
}

async function detectarColunaIdViagemRastreamento(pool, tabelaRastreamento, schemaPreferido) {
  try {
    const schema = schemaPreferido || 'public';
    const tablename = tabelaRastreamento;

    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [schema, tablename]
    );
    const list = (cols.rows || [])
      .map((r) => String(r.column_name || r.COLUMN_NAME || '').trim())
      .filter(Boolean);
    const pick = (...cands) => {
      for (const c of cands) {
        const found = list.find((x) => x.toLowerCase() === String(c).toLowerCase());
        if (found) return found;
      }
      return null;
    };
    return pick('IDVIAGEM', 'idviagem', 'ID_VIAGEM', 'id_viagem', 'VIAGEM_ID', 'viagem_id') || 'IDVIAGEM';
  } catch (_) {
    return 'IDVIAGEM';
  }
}

/** Nomes reais das colunas de coordenadas na tabela de rastreamento (PG costuma ter só minúsculas). */
async function detectarColunasLatLonRastreamento(pool, tabelaRastreamento, schemaPreferido) {
  try {
    const schema = schemaPreferido || 'public';
    const tablename = tabelaRastreamento;
    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [schema, tablename]
    );
    const list = (cols.rows || [])
      .map((r) => String(r.column_name || r.COLUMN_NAME || '').trim())
      .filter(Boolean);
    const pick = (...cands) => {
      for (const c of cands) {
        const found = list.find((x) => x.toLowerCase() === String(c).toLowerCase());
        if (found) return found;
      }
      return null;
    };
    return {
      lat: pick('LATITUDE', 'latitude', 'lat', 'vl_latitude', 'coord_lat') || 'LATITUDE',
      lon: pick('LONGITUDE', 'longitude', 'lon', 'lng', 'vl_longitude', 'coord_lon') || 'LONGITUDE',
    };
  } catch (_) {
    return { lat: 'LATITUDE', lon: 'LONGITUDE' };
  }
}

async function detectarColunasMetaRastreamento(pool, tabelaRastreamento, schemaPreferido) {
  try {
    const schema = schemaPreferido || 'public';
    const tablename = tabelaRastreamento;
    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [schema, tablename]
    );
    const list = (cols.rows || [])
      .map((r) => String(r.column_name || r.COLUMN_NAME || '').trim())
      .filter(Boolean);
    const pick = (...cands) => {
      for (const c of cands) {
        const found = list.find((x) => x.toLowerCase() === String(c).toLowerCase());
        if (found) return found;
      }
      return null;
    };
    return {
      dhRegistro: pick('DHREGISTRO', 'dhregistro', 'DH_REGISTRO', 'dt_registro', 'created_at'),
      dhPosicao: pick('DHPOSICAO', 'dhposicao', 'DH_POSICAO', 'dt_posicao'),
      sequencia: pick('SEQUENCIA', 'sequencia', 'seq'),
      dsPosicao: pick('DSPOSICAO', 'dsposicao', 'DS_POSICAO', 'posicao', 'localizacao'),
    };
  } catch (_) {
    return { dhRegistro: null, dhPosicao: null, sequencia: null, dsPosicao: null };
  }
}

/**
 * Filtros compartilhados entre listagem no mapa e resumo.
 * @param {'tracking'|'master'} modo tracking = junção com [E] equipamento; master = apenas VIAGEMMESTRE + EXISTS para rastreado
 */
function montarFiltrosMapaViagem(request, q, modo, tenantId) {
  let sql = '';
  const tidMapa = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : 'default';
  sql += ` AND (COALESCE([VM].[TENANT_ID], 'default') = @TENANT_ID_MAPA OR COALESCE([VM].[TENANT_ID], 'default') = 'default')`;
  request.input('TENANT_ID_MAPA', tidMapa);
  const {
    idViagem, situacaoViagem, tipoViagem, classeFrota, contratador,
    origemPais, destinoPais,
    origemEstado, origemCidade, destinoEstado, destinoCidade,
    roteiro, dataInicio, dataFim, rastreado, motoristaConfirmado
  } = q || {};

  if (idViagem) {
    sql += ` AND [VM].[IDVIAGEM] = @IDVIAGEM`;
    request.input('IDVIAGEM', parseInt(idViagem, 10));
  }
  if (situacaoViagem) {
    sql += ` AND [SV].[FGSITVIAGEM] = @SITUACAOVIAGEM`;
    request.input('SITUACAOVIAGEM', situacaoViagem);
  } else {
    // Torre operacional: não mistura cancelada/finalizada (GPS antigo vira “meses sem posição”).
    sql += ` AND COALESCE([SV].[FGSITVIAGEM], [VM].[FGSITVIAGEM], '') NOT IN ('F', 'C')`;
  }
  if (tipoViagem) {
    sql += ` AND [VM].[CDTIPOVIAGEM] = @TIPOVIAGEM`;
    request.input('TIPOVIAGEM', parseInt(tipoViagem, 10));
  }
  if (classeFrota) {
    sql += ` AND [VM].[CDCLASSEFROTA] = @CLASSEFROTA`;
    request.input('CLASSEFROTA', parseInt(classeFrota, 10));
  }
  if (contratador) {
    sql += ` AND [VM].[CDCONTRATADOR] = @CONTRATADOR`;
    request.input('CONTRATADOR', parseInt(contratador, 10));
  }
  if (roteiro) {
    sql += ` AND [VM].[IDROTEIRO] = @ROTEIRO`;
    request.input('ROTEIRO', parseInt(roteiro, 10));
  }
  if (dataInicio && dataFim) {
    sql += ` AND [VM].[DTPREVINICIO] <= @DATAFIM AND [VM].[DTPREVFINAL] >= @DATAINICIO`;
    request.input('DATAINICIO', dataInicio);
    request.input('DATAFIM', dataFim);
  } else if (dataInicio) {
    sql += ` AND [VM].[DTPREVINICIO] >= @DATAINICIO`;
    request.input('DATAINICIO', dataInicio);
  } else if (dataFim) {
    sql += ` AND [VM].[DTPREVFINAL] <= @DATAFIM`;
    request.input('DATAFIM', dataFim);
  }
  if (rastreado) {
    if (modo === 'tracking') {
      if (rastreado === 'S') {
        sql += ` AND [E].[FGRASTREADO] = 'S'`;
      } else if (rastreado === 'N') {
        sql += ` AND ([E].[FGRASTREADO] IS NULL OR [E].[FGRASTREADO] = 'N')`;
      }
    } else {
      if (rastreado === 'S') {
        sql += ` AND EXISTS (
          SELECT 1 FROM [dbo].[VIAGEMVEICULO] [Vx]
          INNER JOIN [dbo].[EQUIPAMENTO] [Ex] ON [Vx].[IDEQUIPAMENTO] = [Ex].[IDEQUIPAMENTO]
          WHERE [Vx].[IDVIAGEM] = [VM].[IDVIAGEM] AND [Ex].[FGRASTREADO] = 'S'
        )`;
      } else if (rastreado === 'N') {
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM [dbo].[VIAGEMVEICULO] [Vx]
          INNER JOIN [dbo].[EQUIPAMENTO] [Ex] ON [Vx].[IDEQUIPAMENTO] = [Ex].[IDEQUIPAMENTO]
          WHERE [Vx].[IDVIAGEM] = [VM].[IDVIAGEM] AND [Ex].[FGRASTREADO] = 'S'
        )`;
      }
    }
  }
  if (motoristaConfirmado === 'S') {
    sql += ` AND EXISTS (
      SELECT 1 FROM [dbo].[CONVOCACAO] [C]
      WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM]
      AND [C].[TENANT_ID] = [VM].[TENANT_ID]
      AND [C].[STATUS] = 'CONFIRMADA'
    )`;
  } else if (motoristaConfirmado === 'N') {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM [dbo].[CONVOCACAO] [C]
      WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM]
      AND [C].[TENANT_ID] = [VM].[TENANT_ID]
      AND [C].[STATUS] = 'CONFIRMADA'
    )`;
  }
  if (origemPais) {
    const op = parseInt(origemPais, 10);
    if (Number.isFinite(op)) {
      sql += ` AND [co].[CDPAIS] = @ORIGEMPAIS`;
      request.input('ORIGEMPAIS', op);
    }
  }
  if (destinoPais) {
    const dp = parseInt(destinoPais, 10);
    if (Number.isFinite(dp)) {
      sql += ` AND [cd].[CDPAIS] = @DESTINOPAIS`;
      request.input('DESTINOPAIS', dp);
    }
  }
  if (origemEstado) {
    sql += ` AND [co].[CDUF] = @ORIGEMESTADO`;
    request.input('ORIGEMESTADO', parseInt(origemEstado, 10));
  }
  if (origemCidade) {
    sql += ` AND [co].[NMCIDADE] LIKE @ORIGEMCIDADE`;
    request.input('ORIGEMCIDADE', `%${origemCidade}%`);
  }
  if (destinoEstado) {
    sql += ` AND [cd].[CDUF] = @DESTINOESTADO`;
    request.input('DESTINOESTADO', parseInt(destinoEstado, 10));
  }
  if (destinoCidade) {
    sql += ` AND [cd].[NMCIDADE] LIKE @DESTINOCIDADE`;
    request.input('DESTINOCIDADE', `%${destinoCidade}%`);
  }
  return sql;
}

function rowNum(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null && r[k] !== '') return Number(r[k]);
  }
  return 0;
}

const mapaViagemController = {
  // Listar veículos para o mapa (última posição de cada placa)
  listarVeiculos: async (req, res) => {
    try {
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache'
      });
      const pool = await poolPromise;
      const rastreamentoInfo = await detectarTabelaRastreamento(pool);
      const rastreamentoSchema = rastreamentoInfo.schema || 'public';
      const rastreamentoTable = rastreamentoInfo.tablename || 'VIAGEMRASTREAMENTO';
      const idColRv = await detectarColunaIdViagemRastreamento(pool, rastreamentoTable, rastreamentoSchema);
      const { lat: rvLat, lon: rvLon } = await detectarColunasLatLonRastreamento(pool, rastreamentoTable, rastreamentoSchema);
      const {
        dhRegistro: rvDhRegistro,
        dhPosicao: rvDhPosicao,
        sequencia: rvSequencia,
        dsPosicao: rvDsPosicao
      } = await detectarColunasMetaRastreamento(pool, rastreamentoTable, rastreamentoSchema);
      const tidMapa = tenantIdForRequest(req);
      const rvDhExpr = rvDhPosicao && rvDhRegistro
        ? `COALESCE([RV].[${rvDhPosicao}], [RV].[${rvDhRegistro}])`
        : rvDhPosicao
          ? `[RV].[${rvDhPosicao}]`
          : rvDhRegistro
            ? `[RV].[${rvDhRegistro}]`
            : 'NULL';
      const rvSeqExpr = rvSequencia ? `COALESCE([RV].[${rvSequencia}], 0)` : '0';
      const rvDsPosExpr = rvDsPosicao ? `COALESCE([RV].[${rvDsPosicao}], '')` : `''`;

      // Incluir viagens planejadas (1) até encerradas (14): >= 1 e < 15 para mostrar mais veículos
      const queryBase = `
        WITH [UltimaPosicao] AS (
          SELECT 
            [RV].[${idColRv}] AS [VIAGEM],
            [RV].[${rvLat}] AS [LATITUDE],
            [RV].[${rvLon}] AS [LONGITUDE],
            ${rvDsPosExpr} AS [DSPOSICAO],
            ${rvDhExpr} AS [DHPOSICAO],
            [NM].[RZSOCIAL] AS [NMMOTORISTA],
            [E].[REFEQUIPAMENTO] AS [PLACA],
            [VM].[IDROTEIRO] AS [IDROTEIRO],
            [R].[DSROTEIRO],
            [SV].[FGSITVIAGEM] AS [FGSITVIAGEM],
            [VM].[CDTIPOVIAGEM] AS [CDTIPOVIAGEM],
            COALESCE([T].[DSTIPOVIAGEM], '') AS [DSTIPOVIAGEM],
            [co].[ESTADO] AS [ORIGEM_ESTADO],
            [co].[NMCIDADE] AS [ORIGEM_CIDADE],
            [co].[CDUF] AS [ORIGEM_CDUF],
            [cd].[ESTADO] AS [DESTINO_ESTADO],
            [cd].[NMCIDADE] AS [DESTINO_CIDADE],
            [cd].[CDUF] AS [DESTINO_CDUF],
            ROW_NUMBER() OVER (
              PARTITION BY [RV].[${idColRv}]
              ORDER BY ${rvDhExpr} DESC NULLS LAST, ${rvSeqExpr} DESC
            ) AS [RN]
          FROM [${rastreamentoSchema}].[${rastreamentoTable}] [RV]
          INNER JOIN [dbo].[VIAGEMMESTRE] [VM] ON [RV].[${idColRv}] = [VM].[IDVIAGEM]
          LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
            AND ([R].[TENANT_ID] = @TENANT_ID_MAPA OR [R].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [R].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [R].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[TIPOVIAGEM] [T] ON [VM].[CDTIPOVIAGEM] = [T].[CDTIPOVIAGEM]
            AND ([T].[TENANT_ID] = [VM].[TENANT_ID] OR [T].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[SITUACAOVIAGEM] [SV] ON [VM].[CDSITUACAOVIAGEM] = [SV].[CDSITUACAOVIAGEM]
          LEFT JOIN [dbo].[VIAGEMMOTORISTA] [M] ON [RV].[${idColRv}] = [M].[IDVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] [NM] ON [M].[CDMOTORISTA] = [NM].[CDCADASTRO] AND [NM].[TENANT_ID] = [VM].[TENANT_ID]
          LEFT JOIN [dbo].[VIAGEMVEICULO] [V] ON [RV].[${idColRv}] = [V].[IDVIAGEM]
          LEFT JOIN [dbo].[EQUIPAMENTO] [E] ON [V].[IDEQUIPAMENTO] = [E].[IDEQUIPAMENTO]
          WHERE COALESCE([SV].[FGSITVIAGEM], [VM].[FGSITVIAGEM], '') <> 'F'
            AND [RV].[${rvLat}] IS NOT NULL
            AND [RV].[${rvLon}] IS NOT NULL
      `;
      let query = queryBase;

      const request = pool.request();
      query += montarFiltrosMapaViagem(request, req.query, 'tracking', tidMapa);

      query += `
        )
        SELECT 
          [VIAGEM],
          [LATITUDE],
          [LONGITUDE],
          [DSPOSICAO],
          [DHPOSICAO],
          [NMMOTORISTA],
          [PLACA],
          [IDROTEIRO],
          [DSROTEIRO],
          [FGSITVIAGEM],
          [CDTIPOVIAGEM],
          [DSTIPOVIAGEM]
        FROM [UltimaPosicao]
        WHERE [RN] = 1
        ORDER BY [PLACA], [DHPOSICAO] DESC
      `;

      let result;
      try {
        result = await request.query(query);
      } catch (err) {
        const colMissing = (err.code === '42703' || (err.message && err.message.includes('column')));
        if (colMissing && rastreamentoTable) {
          console.log('[Mapa Viagem] Query com DHPOSICAO/SEQUENCIA falhou, tentando apenas DHREGISTRO.');
          const req2 = pool.request();
          const fallbackFilters = montarFiltrosMapaViagem(req2, req.query, 'tracking', tidMapa);
          const fallbackFull = `
            WITH [UltimaPosicao] AS (
              SELECT 
                [RV].[${idColRv}] AS [VIAGEM],
                [RV].[${rvLat}] AS [LATITUDE],
                [RV].[${rvLon}] AS [LONGITUDE],
                ${rvDsPosExpr} AS [DSPOSICAO],
                ${rvDhExpr} AS [DHPOSICAO],
                [NM].[RZSOCIAL] AS [NMMOTORISTA],
                [E].[REFEQUIPAMENTO] AS [PLACA],
                [VM].[IDROTEIRO] AS [IDROTEIRO],
                [R].[DSROTEIRO],
                [SV].[FGSITVIAGEM] AS [FGSITVIAGEM],
                [VM].[CDTIPOVIAGEM] AS [CDTIPOVIAGEM],
                COALESCE([T].[DSTIPOVIAGEM], '') AS [DSTIPOVIAGEM],
                ROW_NUMBER() OVER (PARTITION BY [RV].[${idColRv}] ORDER BY ${rvDhExpr} DESC) AS [RN]
              FROM [${rastreamentoSchema}].[${rastreamentoTable}] [RV]
              INNER JOIN [dbo].[VIAGEMMESTRE] [VM] ON [RV].[${idColRv}] = [VM].[IDVIAGEM]
              LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
                AND ([R].[TENANT_ID] = @TENANT_ID_MAPA OR [R].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[CIDADE] [co] ON [R].[CDCIDADEORIGEM] = [co].[CDCIDADE]
              LEFT JOIN [dbo].[CIDADE] [cd] ON [R].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
              LEFT JOIN [dbo].[TIPOVIAGEM] [T] ON [VM].[CDTIPOVIAGEM] = [T].[CDTIPOVIAGEM]
                AND ([T].[TENANT_ID] = [VM].[TENANT_ID] OR [T].[TENANT_ID] = 'default')
              LEFT JOIN [dbo].[SITUACAOVIAGEM] [SV] ON [VM].[CDSITUACAOVIAGEM] = [SV].[CDSITUACAOVIAGEM]
              LEFT JOIN [dbo].[VIAGEMMOTORISTA] [M] ON [RV].[${idColRv}] = [M].[IDVIAGEM]
              LEFT JOIN [dbo].[CADASTROGERAL] [NM] ON [M].[CDMOTORISTA] = [NM].[CDCADASTRO] AND [NM].[TENANT_ID] = [VM].[TENANT_ID]
              LEFT JOIN [dbo].[VIAGEMVEICULO] [V] ON [RV].[${idColRv}] = [V].[IDVIAGEM]
              LEFT JOIN [dbo].[EQUIPAMENTO] [E] ON [V].[IDEQUIPAMENTO] = [E].[IDEQUIPAMENTO]
              WHERE COALESCE([SV].[FGSITVIAGEM], [VM].[FGSITVIAGEM], '') <> 'F'
                AND [RV].[${rvLat}] IS NOT NULL AND [RV].[${rvLon}] IS NOT NULL
                ${fallbackFilters}
            )
            SELECT [VIAGEM], [LATITUDE], [LONGITUDE], [DSPOSICAO], [DHPOSICAO], [NMMOTORISTA], [PLACA], [IDROTEIRO], [DSROTEIRO],
              [FGSITVIAGEM], [CDTIPOVIAGEM], [DSTIPOVIAGEM]
            FROM [UltimaPosicao] WHERE [RN] = 1
            ORDER BY [PLACA], [DHPOSICAO] DESC
          `;
          result = await req2.query(fallbackFull);
        } else {
          throw err;
        }
      }

      const veiculos = result.recordset || [];
      const total = veiculos.length;

      console.log(`[Mapa Viagem] Query executada. Total de veículos encontrados: ${total}`);
      if (total > 0) {
        console.log(`[Mapa Viagem] Primeiros 5 IDs de viagem:`, veiculos.slice(0, 5).map(v => v.VIAGEM));
      }

      res.json({
        veiculos: veiculos,
        total: total
      });
    } catch (err) {
      console.error('Erro ao listar veículos:', err);
      res.status(500).json({
        error: 'Erro interno ao listar veículos.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  /** Resumo numérico e quebras (situação / tipo) para os mesmos filtros do mapa */
  resumoMapa: async (req, res) => {
    try {
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache'
      });
      const pool = await poolPromise;
      const rastreamentoInfo = await detectarTabelaRastreamento(pool);
      const rastreamentoSchema = rastreamentoInfo.schema || 'public';
      const rastreamentoTable = rastreamentoInfo.tablename || 'VIAGEMRASTREAMENTO';
      const idColRv = await detectarColunaIdViagemRastreamento(pool, rastreamentoTable, rastreamentoSchema);
      const { lat: rvLat, lon: rvLon } = await detectarColunasLatLonRastreamento(pool, rastreamentoTable, rastreamentoSchema);
      const tidMapa = tenantIdForRequest(req);

      function buildCteSql(request) {
        const filtros = montarFiltrosMapaViagem(request, req.query, 'master', tidMapa);
        return `
          WITH [VMBase] AS (
            SELECT DISTINCT [VM].[IDVIAGEM], [SV].[FGSITVIAGEM], [VM].[CDTIPOVIAGEM]
            FROM [dbo].[VIAGEMMESTRE] [VM]
            LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
              AND ([R].[TENANT_ID] = @TENANT_ID_MAPA OR [R].[TENANT_ID] = 'default')
            LEFT JOIN [dbo].[SITUACAOVIAGEM] [SV] ON [VM].[CDSITUACAOVIAGEM] = [SV].[CDSITUACAOVIAGEM]
            LEFT JOIN [dbo].[CIDADE] [co] ON [R].[CDCIDADEORIGEM] = [co].[CDCIDADE]
            LEFT JOIN [dbo].[CIDADE] [cd] ON [R].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
            WHERE COALESCE([SV].[FGSITVIAGEM], [VM].[FGSITVIAGEM], '') <> 'F'
            ${filtros}
          ),
          [TemGps] AS (
            SELECT DISTINCT [RV].[${idColRv}] AS [IDVIAGEM]
            FROM [${rastreamentoSchema}].[${rastreamentoTable}] [RV]
            INNER JOIN [VMBase] [B] ON [RV].[${idColRv}] = [B].[IDVIAGEM]
            WHERE [RV].[${rvLat}] IS NOT NULL AND [RV].[${rvLon}] IS NOT NULL
          )
        `;
      }

      const req1 = pool.request();
      const cte1 = buildCteSql(req1);
      const sqlAgregados = `${cte1}
        SELECT
          (SELECT COUNT(*) FROM [VMBase]) AS [TotalViagens],
          (SELECT COUNT(*) FROM [TemGps]) AS [ComGps],
          (SELECT COUNT(*) FROM [VMBase] [B] WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[VIAGEMVEICULO] [V] WHERE [V].[IDVIAGEM] = [B].[IDVIAGEM]
          )) AS [SemVeiculo],
          (SELECT COUNT(*) FROM [VMBase] [B] WHERE EXISTS (
            SELECT 1 FROM [dbo].[VIAGEMVEICULO] [V] WHERE [V].[IDVIAGEM] = [B].[IDVIAGEM]
          ) AND NOT EXISTS (
            SELECT 1 FROM [${rastreamentoSchema}].[${rastreamentoTable}] [RV] WHERE [RV].[${idColRv}] = [B].[IDVIAGEM]
              AND [RV].[${rvLat}] IS NOT NULL AND [RV].[${rvLon}] IS NOT NULL
          )) AS [ComVeiculoSemPosicao]
      `;
      const r1 = await req1.query(sqlAgregados);
      const agg = (r1.recordset && r1.recordset[0]) || {};

      const req2 = pool.request();
      const r2 = await req2.query(`${buildCteSql(req2)}
        SELECT [B].[FGSITVIAGEM] AS [Fgsit], COUNT(*) AS [Qtd]
        FROM [VMBase] [B]
        INNER JOIN [TemGps] [G] ON [B].[IDVIAGEM] = [G].[IDVIAGEM]
        GROUP BY [B].[FGSITVIAGEM]
        ORDER BY COUNT(*) DESC
      `);

      const req3 = pool.request();
      const r3 = await req3.query(`${buildCteSql(req3)}
        SELECT [B].[CDTIPOVIAGEM] AS [Cdtipo], COALESCE(MAX([TT].[DSTIPOVIAGEM]), '') AS [Dstipo], COUNT(*) AS [Qtd]
        FROM [VMBase] [B]
        INNER JOIN [TemGps] [G] ON [B].[IDVIAGEM] = [G].[IDVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] [TT] ON [B].[CDTIPOVIAGEM] = [TT].[CDTIPOVIAGEM]
          AND ([TT].[TENANT_ID] = @TENANT_ID_MAPA OR [TT].[TENANT_ID] = 'default')
        GROUP BY [B].[CDTIPOVIAGEM]
        ORDER BY COUNT(*) DESC
      `);

      const req4 = pool.request();
      const r4 = await req4.query(`${buildCteSql(req4)}
        SELECT [B].[IDVIAGEM] AS [IdViagem]
        FROM [VMBase] [B]
        WHERE NOT EXISTS (
          SELECT 1 FROM [dbo].[VIAGEMVEICULO] [V] WHERE [V].[IDVIAGEM] = [B].[IDVIAGEM]
        )
        ORDER BY [B].[IDVIAGEM] DESC
        LIMIT 40
      `);

      const req5 = pool.request();
      const r5 = await req5.query(`${buildCteSql(req5)}
        SELECT [B].[IDVIAGEM] AS [IdViagem]
        FROM [VMBase] [B]
        WHERE EXISTS (
          SELECT 1 FROM [dbo].[VIAGEMVEICULO] [V] WHERE [V].[IDVIAGEM] = [B].[IDVIAGEM]
        ) AND NOT EXISTS (
          SELECT 1 FROM [${rastreamentoSchema}].[${rastreamentoTable}] [RV] WHERE [RV].[${idColRv}] = [B].[IDVIAGEM]
            AND [RV].[${rvLat}] IS NOT NULL AND [RV].[${rvLon}] IS NOT NULL
        )
        ORDER BY [B].[IDVIAGEM] DESC
        LIMIT 40
      `);

      const pick = (row, a, b) => (row[a] != null ? row[a] : row[b]);
      const porSituacao = (r2.recordset || []).map((row) => ({
        fgsit: pick(row, 'fgsit', 'Fgsit') != null ? String(pick(row, 'fgsit', 'Fgsit')).trim() : '',
        qtd: rowNum(row, 'Qtd', 'qtd')
      }));
      const porTipo = (r3.recordset || []).map((row) => ({
        cdTipo: rowNum(row, 'Cdtipo', 'cdtipo'),
        dsTipo: pick(row, 'Dstipo', 'dstipo') || '',
        qtd: rowNum(row, 'Qtd', 'qtd')
      }));
      const amostraSemVeiculo = (r4.recordset || []).map((row) => ({
        idViagem: rowNum(row, 'IdViagem', 'idviagem')
      }));
      const amostraSemPosicao = (r5.recordset || []).map((row) => ({
        idViagem: rowNum(row, 'IdViagem', 'idviagem')
      }));

      res.json({
        totalViagens: rowNum(agg, 'TotalViagens', 'totalviagens'),
        comGps: rowNum(agg, 'ComGps', 'comgps'),
        semVeiculo: rowNum(agg, 'SemVeiculo', 'semveiculo'),
        comVeiculoSemPosicao: rowNum(agg, 'ComVeiculoSemPosicao', 'comveiculosemposicao'),
        porSituacaoNoMapa: porSituacao,
        porTipoNoMapa: porTipo,
        amostraSemVeiculo,
        amostraSemPosicao
      });
    } catch (err) {
      console.error('Erro ao montar resumo do mapa:', err);
      res.status(500).json({
        error: 'Erro interno ao montar resumo do mapa.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Executar init.sql
  executarInitSQL: async (req, res) => {
    try {
      const sqlPath = path.join(__dirname, '../public/modulos/gerenciar-mapa-viagem/sql/init.sql');
      
      let sqlContent = '';
      try {
        sqlContent = await fs.readFile(sqlPath, 'utf8');
      } catch (fileErr) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql não encontrado (não é obrigatório)',
          executed: false
        });
      }

      if (!sqlContent || !sqlContent.trim()) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql vazio',
          executed: false
        });
      }

      const pool = await poolPromise;
      const result = await pool.request().query(sqlContent);

      res.json({ 
        success: true, 
        message: 'init.sql executado com sucesso',
        executed: true
      });
    } catch (err) {
      console.error('Erro ao executar init.sql:', err);
      
      const errorMessage = err.message || '';
      const isExpectedError = 
        errorMessage.includes('duplicate key') ||
        errorMessage.includes('PRIMARY KEY') ||
        errorMessage.includes('UNIQUE constraint');

      if (isExpectedError) {
        return res.json({ 
          success: true, 
          message: 'init.sql executado (alguns erros esperados foram ignorados)',
          executed: true,
          warning: errorMessage
        });
      }

      res.status(500).json({ 
        error: 'Erro ao executar init.sql',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
};

module.exports = mapaViagemController;
