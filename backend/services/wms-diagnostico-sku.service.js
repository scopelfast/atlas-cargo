'use strict';

/**
 * WMS — diagnóstico de SKU "por que esse produto não soma como NF encerrada".
 *
 * Reproduz na API as 6 verificações do script
 * `backend/scripts/wms_diagnostico_nf_nao_soma_postgres.sql`, mas devolvendo
 * JSON estruturado para o front exibir num modal e sugerir ações.
 *
 * Casos de uso:
 *   - Relatório de Posição: aparece a marca "(só mov.)" porque a NF não
 *     somou. O usuário clica na lupa e o sistema responde se a NF está
 *     aberta, sem cdProduto, com qtdConvertida zero etc.
 *   - Trava de simulação OPL: o aviso "revisar conferência cdProduto" leva
 *     o usuário para cá com o código do SKU já pré-preenchido.
 */

const { pool } = require('../config/db');
const reservaOplDiag = require('./wms-diagnostico-reserva-opl.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normalizarCodigo(codigo) {
  /** Recebimentos podem gravar o código com pontos (`6.03.15.507.00`) ou
   *  sem (`6031550700`). Cobrimos os dois para não depender do formato. */
  const cru = String(codigo == null ? '' : codigo).trim();
  if (!cru) return { com: '', sem: '' };
  return { com: cru, sem: cru.replace(/[^\dA-Za-z]/g, '') };
}

/** Diagnóstico de cada linha da conferência — espelha exatamente a lógica
 *  do CASE no SQL do script para que UI e SQL contem a mesma história. */
function diagnosticoConferenciaLinha(stRecebimento, cdProdutoRaw, qtdConvertida, cdDono) {
  const st = String(stRecebimento || '').trim().toUpperCase();
  if (st !== 'ENCERRADA') return { code: 'ABERTA', txt: 'Recebimento ainda não foi encerrado.' };
  if (cdDono == null) return { code: 'SEM_DONO', txt: 'NF sem CD_DONO no cabeçalho.' };
  const cdProdStr = String(cdProdutoRaw == null ? '' : cdProdutoRaw).trim();
  if (!/^[0-9]+$/.test(cdProdStr)) {
    return { code: 'SEM_CD_PRODUTO', txt: 'cdProduto vazio ou não numérico — falta de-para na conferência.' };
  }
  const qc = Number(qtdConvertida);
  if (!Number.isFinite(qc) || qc <= 0) {
    return { code: 'QTD_ZERO', txt: 'qtdConvertida zero/null — fator de conversão ausente ou inválido.' };
  }
  return { code: 'OK', txt: 'OK — esta linha está somando.' };
}

/**
 * @param {string} tenantId
 * @param {number} cdDono
 * @param {string} codigo — código do produto (com ou sem máscara)
 */
async function diagnosticarSku(tenantId, cdDono, codigo) {
  const { com: codComMascara, sem: codSemMascara } = normalizarCodigo(codigo);
  if (!codComMascara) return { err: 'Informe o código do produto.', status: 400 };
  const cd = parseInt(cdDono, 10);
  if (!Number.isFinite(cd)) return { err: 'Dono inválido.', status: 400 };

  const acoes = [];
  const causas = new Set();

  try {
    /** 1) Cadastro do produto no dono (de-para).
     *  Obs.: `WMS_PRODUTO_DONO` NÃO tem `FATOR_CONVERSAO` — esse campo vive
     *  em `WMS_DEPARA_PRODUTO` (por código OL) ou diretamente em cada
     *  linha da `CONFERENCIA_JSON`. Não usar a coluna aqui sob pena de
     *  42703 e cair em "Estrutura WMS desatualizada". */
    const cad = await pool.query(
      `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."UNIDADE", p."FGACTIVE",
              o."NOME" AS "NM_DONO"
         FROM "WMS_PRODUTO_DONO" p
         LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
        WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
          AND (p."CODIGO" = $3 OR p."CODIGO" = $4)
        LIMIT 1`,
      [tenantId, cd, codComMascara, codSemMascara]
    );
    const cadastro = cad.rows[0] || null;
    if (!cadastro) {
      causas.add('SEM_CADASTRO_DONO');
      acoes.push({
        prioridade: 1,
        codigo: 'CADASTRAR_PRODUTO',
        texto:
          'O código "' + codComMascara + '" não está cadastrado no dono ' + cd + '. ' +
          'Cadastre em "Cadastros WMS → Produtos do dono" e refaça a conferência da NF.',
      });
    }

    /** 2) NF-e que mencionam este código (em LINHAS_JSON ou CONFERENCIA_JSON) */
    const nfsRaw = await pool.query(
      `SELECT e."CD_NFE" AS "CD_NFE_ENTRADA", e."CD_DONO", e."ST_RECEBIMENTO",
              e."NUMERO_NF" AS "NU_NF", e."SERIE" AS "NU_SERIE",
              COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") AS "DH_RECEBIMENTO",
              e."DH_EMISSAO", e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO",
              jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb))      AS qtd_linhas_nfe,
              jsonb_array_length(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS qtd_linhas_conf
         FROM "WMS_NFE_ENTRADA" e
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO"   = $2::integer
          AND (
                e."LINHAS_JSON"::text       ILIKE '%' || $3 || '%'
             OR e."LINHAS_JSON"::text       ILIKE '%' || $4 || '%'
             OR e."CONFERENCIA_JSON"::text  ILIKE '%' || $3 || '%'
             OR e."CONFERENCIA_JSON"::text  ILIKE '%' || $4 || '%'
          )
        ORDER BY COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") DESC NULLS LAST
        LIMIT 50`,
      [tenantId, cd, codComMascara, codSemMascara]
    );
    const nfsMencionando = nfsRaw.rows;
    if (!nfsMencionando.length) {
      causas.add('NENHUMA_NF');
      acoes.push({
        prioridade: 1,
        codigo: 'IMPORTAR_NFE',
        texto:
          'Nenhuma NF-e do dono ' + cd + ' menciona o código "' + codComMascara + '". ' +
          'Verifique se o XML foi importado no recebimento e se o código bate exatamente.',
      });
    }
    const temNfAberta = nfsMencionando.some(
      (n) => String(n.ST_RECEBIMENTO || '').trim().toUpperCase() !== 'ENCERRADA'
    );
    const nfsEncerradas = nfsMencionando.filter(
      (n) => String(n.ST_RECEBIMENTO || '').trim().toUpperCase() === 'ENCERRADA'
    );

    /** 3) Detalhe das linhas da CONFERENCIA_JSON */
    let conferencias = [];
    if (nfsMencionando.length) {
      const ids = nfsMencionando.map((n) => Number(n.CD_NFE_ENTRADA)).filter((n) => Number.isFinite(n));
      if (ids.length) {
        const conf = await pool.query(
          `WITH src AS (
             SELECT e."CD_NFE" AS "CD_NFE_ENTRADA", e."ST_RECEBIMENTO", e."CD_DONO",
                    e."NUMERO_NF" AS "NU_NF", e."SERIE" AS "NU_SERIE", elem
               FROM "WMS_NFE_ENTRADA" e
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
              WHERE e."TENANT_ID" = $1
                AND e."CD_DONO"   = $2::integer
                AND e."CD_NFE" = ANY($3::int[])
           )
           SELECT "CD_NFE_ENTRADA", "ST_RECEBIMENTO", "CD_DONO", "NU_NF", "NU_SERIE",
                  elem->>'nItem'           AS "nItem",
                  elem->>'codigoProduto'   AS "codigoProduto",
                  elem->>'cdProduto'       AS "cdProdutoRaw",
                  elem->>'lote'            AS "lote",
                  elem->>'validade'        AS "validade",
                  elem->>'qtdRecebida'     AS "qtdRecebida",
                  elem->>'fatorConversao'  AS "fatorConversao",
                  elem->>'qtdConvertida'   AS "qtdConvertida"
             FROM src
            WHERE (elem->>'codigoProduto') ILIKE $4
               OR (elem->>'codigoProduto') ILIKE $5
               OR (elem->>'cdProduto')     ILIKE $5
               OR (
                    (elem->>'cdProduto') ~ '^[0-9]+$'
                    AND $6::integer IS NOT NULL
                    AND (elem->>'cdProduto')::integer = $6::integer
                  )
            ORDER BY "CD_NFE_ENTRADA", (elem->>'nItem')::text`,
          [tenantId, cd, ids, codComMascara, codSemMascara, cadastro ? cadastro.CD_PRODUTO : null]
        );
        conferencias = conf.rows.map((r) => {
          const diag = diagnosticoConferenciaLinha(r.ST_RECEBIMENTO, r.cdProdutoRaw, r.qtdConvertida, r.CD_DONO);
          if (diag.code !== 'OK') causas.add(diag.code);
          return Object.assign({}, r, { diagnostico: diag });
        });
      }
    }

    /** 4) Resumo agregado: NF encerrada × Movimentos × Saldo */
    let resumo = null;
    if (cadastro) {
      const ent = await pool.query(
        `SELECT COALESCE(SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric), 0) AS total
           FROM "WMS_NFE_ENTRADA" e
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
          WHERE e."TENANT_ID" = $1
            AND e."CD_DONO"   = $2::integer
            AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
            AND (elem->>'cdProduto') ~ '^[0-9]+$'
            AND (elem->>'cdProduto')::integer = $3::integer`,
        [tenantId, cd, cadastro.CD_PRODUTO]
      );
      const mov = await pool.query(
        `SELECT COALESCE(SUM("QTD"), 0) AS total
           FROM "WMS_MOVIMENTO_ESTOQUE"
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = $3::integer`,
        [tenantId, cd, cadastro.CD_PRODUTO]
      );
      resumo = {
        CD_PRODUTO: cadastro.CD_PRODUTO,
        qtdEntradaNfEncerrada: Number(ent.rows[0].total) || 0,
        qtdMovimentos: Number(mov.rows[0].total) || 0,
        qtdSaldoSku: (Number(ent.rows[0].total) || 0) + (Number(mov.rows[0].total) || 0),
      };
    }

    /** 5) Detalhe dos movimentos (ledger) */
    let movimentos = [];
    if (cadastro) {
      const mv = await pool.query(
        `SELECT "CD_MOVIMENTO", "DH_REGISTRO", "TP_MOVIMENTO", "QTD",
                "REF_CD_CARGA", "REF_CD_OPL_ARQUIVO", "SG_USER", "IDEMPOTENCY_KEY"
           FROM "WMS_MOVIMENTO_ESTOQUE"
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = $3::integer
          ORDER BY "DH_REGISTRO" DESC NULLS LAST
          LIMIT 100`,
        [tenantId, cd, cadastro.CD_PRODUTO]
      );
      movimentos = mv.rows;
    }

    /** 7) BUSCA AMPLIADA — pega 3 cenários que a busca direta não cobre:
     *  - NFs em OUTROS donos com o mesmo código (NF foi pro dono errado).
     *  - NFs no dono atual com NOME parecido (XML com código de fornecedor
     *    sem de-para).
     *  - Cadastros duplicados (mesma chave de código OL, vários CD_PRODUTO no dono).
     *  Pesquisa por nome usa a primeira "palavra forte" do cadastro (>= 4
     *  chars, ignora "DE/DA/DO/COM/EM/PARA/PCT/UN/G/KG") para evitar match
     *  ruim demais. */
    const nmBase = cadastro && cadastro.NOME ? String(cadastro.NOME) : '';
    const stopWords = new Set(['DE', 'DA', 'DO', 'COM', 'EM', 'PARA', 'PCT', 'UN', 'G', 'KG', 'ML', 'L', 'CX', 'FD']);
    const palavras = nmBase
      .toUpperCase()
      .split(/[\s\-_./,()]+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w) && !/^\d+$/.test(w));
    /** Pega até 2 palavras-chave do nome (ex.: "PIPOCA DOCE" → ["PIPOCA","DOCE"]).
     *  Usadas em ILIKE conjugadas (AND) para reduzir falso-positivo. */
    const keywords = palavras.slice(0, 2);

    /** 7a) NF-e em OUTROS donos do mesmo tenant que mencionam este código. */
    const outrosDonos = await pool.query(
      `SELECT e."CD_NFE" AS "CD_NFE_ENTRADA", e."CD_DONO", o."NOME" AS "NM_DONO",
              e."ST_RECEBIMENTO", e."NUMERO_NF" AS "NU_NF", e."SERIE" AS "NU_SERIE",
              COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") AS "DH_RECEBIMENTO",
              jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb))      AS qtd_linhas_nfe,
              jsonb_array_length(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS qtd_linhas_conf
         FROM "WMS_NFE_ENTRADA" e
         LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = e."CD_DONO" AND o."TENANT_ID" = e."TENANT_ID"
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO" IS NOT NULL
          AND e."CD_DONO" <> $2::integer
          AND (
                e."LINHAS_JSON"::text       ILIKE '%' || $3 || '%'
             OR e."LINHAS_JSON"::text       ILIKE '%' || $4 || '%'
             OR e."CONFERENCIA_JSON"::text  ILIKE '%' || $3 || '%'
             OR e."CONFERENCIA_JSON"::text  ILIKE '%' || $4 || '%'
          )
        ORDER BY COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") DESC NULLS LAST
        LIMIT 50`,
      [tenantId, cd, codComMascara, codSemMascara]
    );
    const nfsOutrosDonos = outrosDonos.rows;

    /** 7b) NFs do dono atual com NOME do produto presente em LINHAS_JSON
     *  (mas SEM o código que conhecemos). Pega caso "XML usou código de
     *  fornecedor". */
    let nfsPorNome = [];
    if (keywords.length) {
      /** Constrói condição ILIKE conjugada: `ILIKE '%K1%' AND ILIKE '%K2%'`. */
      const conds = keywords.map((_, i) => `e."LINHAS_JSON"::text ILIKE $${3 + i}`);
      const params = [tenantId, cd, ...keywords.map((k) => '%' + k + '%')];
      params.push(codComMascara);
      params.push(codSemMascara);
      const sqlNome =
        `SELECT e."CD_NFE" AS "CD_NFE_ENTRADA", e."CD_DONO", e."ST_RECEBIMENTO",
                e."NUMERO_NF" AS "NU_NF", e."SERIE" AS "NU_SERIE",
                COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") AS "DH_RECEBIMENTO",
                jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb))      AS qtd_linhas_nfe,
                jsonb_array_length(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS qtd_linhas_conf
           FROM "WMS_NFE_ENTRADA" e
          WHERE e."TENANT_ID" = $1 AND e."CD_DONO" = $2::integer
            AND ${conds.join(' AND ')}
            AND NOT (
                  e."LINHAS_JSON"::text ILIKE '%' || $${params.length - 1} || '%'
               OR e."LINHAS_JSON"::text ILIKE '%' || $${params.length}     || '%'
            )
          ORDER BY COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") DESC NULLS LAST
          LIMIT 50`;
      const rNome = await pool.query(sqlNome, params);
      nfsPorNome = rNome.rows;
    }

    /** 7c) Mesmo dono + mesma chave de código OL (duplicata real, não homônimo por nome). */
    let cadastrosDuplicados = [];
    if (cadastro && cadastro.CODIGO) {
      const r = await pool.query(
        `SELECT "CD_PRODUTO", "CODIGO", "NOME", "UNIDADE", "FGACTIVE"
           FROM "WMS_PRODUTO_DONO"
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
            AND COALESCE("FGACTIVE", 'S') = 'S'
            AND "CD_PRODUTO" <> $4::integer
            AND lower(regexp_replace(trim(coalesce("CODIGO", '')), '[^0-9A-Za-z]', '', 'g'))
              = lower(regexp_replace(trim(coalesce($3::text, '')), '[^0-9A-Za-z]', '', 'g'))
            AND lower(regexp_replace(trim(coalesce($3::text, '')), '[^0-9A-Za-z]', '', 'g')) <> ''`,
        [tenantId, cd, cadastro.CODIGO, cadastro.CD_PRODUTO]
      );
      cadastrosDuplicados = r.rows;
    }

    /** 8) Reservas OPL ativas para este SKU + classificação (ATIVA/ORFA).
     *  Cobre o caso "tenho saldo mas a trava da simulação diz que falta" —
     *  geralmente reserva órfã de espelho OPL cujas cargas já saíram. */
    let reservasOpl = null;
    if (cadastro) {
      try {
        const rsv = await reservaOplDiag.listarReservasParaSku(tenantId, cd, cadastro.CD_PRODUTO);
        if (rsv && rsv.ok) {
          reservasOpl = rsv.ok;
          const totalOrfa = (rsv.ok.totais && rsv.ok.totais.totalOrfas) || 0;
          if (totalOrfa > 0) {
            causas.add('RESERVA_OPL_ORFA');
            const espelhosOrfaos = (rsv.ok.reservas || []).filter((r) => r.classificacao === 'ORFA');
            acoes.push({
              prioridade: 2,
              codigo: 'LIMPAR_RESERVA_ORFA',
              texto:
                'Existe(m) ' + espelhosOrfaos.length + ' espelho(s) OPL com reserva ATIVA cujas cargas JÁ FORAM EXPEDIDAS — total reservado órfão: ' + totalOrfa +
                '. Isso faz a trava de cobertura descontar duas vezes (saída + reserva). Use a Auditoria de Saúde → "Limpar reservas órfãs" para liberar.',
              espelhos: espelhosOrfaos.map((e) => ({
                CD_OPL_ARQUIVO: e.CD_OPL_ARQUIVO,
                QTD_RESERVADA: e.QTD_RESERVADA,
                NM_ARQUIVO: e.NM_ARQUIVO,
                DH_IMPORT: e.DH_IMPORT,
                qtdCargas: e.qtdCargas,
                qtdCargasExpedidas: e.qtdCargasExpedidas,
              })),
            });
          }
        }
      } catch (_) { /* diagnostico best-effort */ }
    }

    /** Sugere ações específicas dos novos cenários. */
    if (nfsOutrosDonos.length) {
      const lista = nfsOutrosDonos.slice(0, 3).map((n) =>
        '#' + n.CD_NFE_ENTRADA + ' (dono ' + n.CD_DONO + ' — ' + (n.NM_DONO || '?') + ', NF ' + n.NU_NF + ', ' + n.ST_RECEBIMENTO + ')'
      ).join('; ');
      acoes.unshift({
        prioridade: 1,
        codigo: 'NF_NO_DONO_ERRADO',
        texto:
          'Encontrei ' + nfsOutrosDonos.length + ' NF-e do MESMO tenant com este código em OUTROS donos: ' + lista +
          '. Provavelmente a NF foi importada no dono errado. Edite o cabeçalho da NF para apontar o dono correto ou use "Transferência entre donos" se já encerrou.',
        nfs: nfsOutrosDonos.map((n) => ({
          CD_NFE_ENTRADA: n.CD_NFE_ENTRADA, NU_NF: n.NU_NF, NU_SERIE: n.NU_SERIE,
          CD_DONO: n.CD_DONO, NM_DONO: n.NM_DONO,
          ST_RECEBIMENTO: n.ST_RECEBIMENTO, DH_RECEBIMENTO: n.DH_RECEBIMENTO,
        })),
      });
      causas.add('NF_NO_DONO_ERRADO');
    }
    if (nfsPorNome.length) {
      acoes.push({
        prioridade: 2,
        codigo: 'NF_COM_CODIGO_DIFERENTE',
        texto:
          'Encontrei ' + nfsPorNome.length + ' NF-e do dono ' + cd +
          ' que mencionam o NOME "' + nmBase + '" mas NÃO contêm o código "' + codComMascara +
          '". Provável: o XML do fornecedor usa código diferente e o de-para não está configurado. ' +
          'Abra a NF em "Recebimento WMS", veja o código que veio do XML e crie o de-para em "Cadastros WMS → Produtos do dono".',
        nfs: nfsPorNome.map((n) => ({
          CD_NFE_ENTRADA: n.CD_NFE_ENTRADA, NU_NF: n.NU_NF, NU_SERIE: n.NU_SERIE,
          ST_RECEBIMENTO: n.ST_RECEBIMENTO, DH_RECEBIMENTO: n.DH_RECEBIMENTO,
        })),
      });
      causas.add('NF_COM_CODIGO_DIFERENTE');
    }
    if (cadastrosDuplicados.length) {
      acoes.push({
        prioridade: 2,
        codigo: 'CADASTRO_DUPLICADO',
        texto:
          'Existem ' + cadastrosDuplicados.length + ' cadastro(s) com a MESMA CHAVE de código OL no dono ' + cd +
          ' (' + cadastrosDuplicados.map((p) => '#' + p.CD_PRODUTO + ' "' + p.CODIGO + '"').join(', ') +
          '). Provável import XML + OL com máscaras diferentes. Use o script wms_unificar_duplicados_produto ou unifique manualmente.',
        produtos: cadastrosDuplicados,
      });
      causas.add('CADASTRO_DUPLICADO');
    }

    /** 6) NF abertas com este código (separadas em estrutura própria para
     *  a UI sugerir "encerrar essas NFs"). */
    const abertas = nfsMencionando.filter(
      (n) => String(n.ST_RECEBIMENTO || '').trim().toUpperCase() !== 'ENCERRADA'
    );

    /** Sugestões de ação baseadas no que detectamos */
    if (temNfAberta) {
      acoes.unshift({
        prioridade: 1,
        codigo: 'ENCERRAR_RECEBIMENTO',
        texto:
          'Existem ' + abertas.length + ' NF-e com este código ainda em conferência (não encerradas). ' +
          'Encerre o recebimento em "Recebimento WMS" para somar os itens.',
        nfs: abertas.map((n) => ({
          CD_NFE_ENTRADA: n.CD_NFE_ENTRADA, NU_NF: n.NU_NF, NU_SERIE: n.NU_SERIE,
          DH_RECEBIMENTO: n.DH_RECEBIMENTO, ST_RECEBIMENTO: n.ST_RECEBIMENTO,
        })),
      });
    }
    const problemasConferencia = conferencias.filter((c) => c.diagnostico.code !== 'OK' && c.diagnostico.code !== 'ABERTA');
    if (problemasConferencia.length) {
      const codigos = Array.from(new Set(problemasConferencia.map((p) => p.diagnostico.code)));
      acoes.push({
        prioridade: 2,
        codigo: 'REABRIR_RECONFERIR',
        texto:
          'Há ' + problemasConferencia.length + ' linha(s) da conferência com problema (' +
          codigos.join(', ') + '). Reabra o recebimento em "Recebimento WMS", corrija o de-para / fator de conversão e encerre de novo.',
        linhas: problemasConferencia.map((p) => ({
          CD_NFE_ENTRADA: p.CD_NFE_ENTRADA, NU_NF: p.NU_NF, nItem: p.nItem,
          codigoProduto: p.codigoProduto, cdProdutoRaw: p.cdProdutoRaw,
          qtdRecebida: p.qtdRecebida, fatorConversao: p.fatorConversao, qtdConvertida: p.qtdConvertida,
          motivo: p.diagnostico.txt,
        })),
      });
    }
    if (!acoes.length && resumo) {
      acoes.push({
        prioridade: 3,
        codigo: 'NADA_A_FAZER',
        texto:
          'A entrada de NF encerrada é ' + resumo.qtdEntradaNfEncerrada +
          ' e os movimentos somam ' + resumo.qtdMovimentos +
          '. Saldo SKU = ' + resumo.qtdSaldoSku + '. Se o esperado não bate, revise quantidades físicas via inventário ou diferenças por lote.',
      });
    }

    return {
      ok: {
        codigoConsultado: codComMascara,
        codigoSemMascara: codSemMascara,
        cdDono: cd,
        nmDono: cadastro && cadastro.NM_DONO ? cadastro.NM_DONO : null,
        cadastro,
        resumo,
        nfsEncerradas,
        nfsAbertas: abertas,
        conferencias,
        movimentos,
        /** Busca ampliada: cobre cenários que a busca direta não pega. */
        nfsOutrosDonos,
        nfsPorNome,
        cadastrosDuplicados,
        reservasOpl,
        palavrasChaveUsadas: keywords,
        causas: Array.from(causas),
        acoes,
      },
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        err: 'Estrutura WMS desatualizada para diagnóstico. Verifique tabelas WMS_NFE_ENTRADA e WMS_MOVIMENTO_ESTOQUE.',
        status: 503,
      };
    }
    throw e;
  }
}

module.exports = { diagnosticarSku };
