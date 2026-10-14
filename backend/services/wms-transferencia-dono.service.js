'use strict';

/**
 * Transferência de estoque entre donos (WMS).
 *
 * Casos de uso:
 *   - Dois donos no mesmo CD operam o mesmo produto em códigos próprios. Ex.:
 *     `MACARRAO CASEIRO 6.03.12.006.00` está cadastrado na Mana com saldo 701,
 *     mas o cliente "Nutriville" cresceu e agora opera o mesmo SKU lá. O
 *     supervisor transfere parte do saldo para a Nutriville.
 *   - Auditoria de divergência: contagem indicou que 50 UN estavam em "estante
 *     do dono A" mas o pallet era do dono B (rótulo trocado).
 *
 * Modelo:
 *   - Cada transferência grava UMA linha em `WMS_TRANSFERENCIA_DONO` (o
 *     "documento") + DOIS movimentos em `WMS_MOVIMENTO_ESTOQUE`:
 *       SAÍDA   na origem  (QTD negativa, TP_MOVIMENTO = 'TRANSFERENCIA_SAIDA')
 *       ENTRADA no destino (QTD positiva, TP_MOVIMENTO = 'TRANSFERENCIA_ENTRADA')
 *   - O saldo logo aparece no relatório de Posição de Estoque (que já soma
 *     `WMS_MOVIMENTO_ESTOQUE`).
 *   - Lote/Validade são INFORMATIVOS — o ledger MVP é por SKU.
 *
 * Resiliência:
 *   - Se o produto NÃO existe no dono destino, o service retorna
 *     `precisaCadastroDestino: true` com a sugestão pronta. A UI confirma
 *     com o usuário e chama de novo com `autoCadastrarDestino: true` para
 *     criar o cadastro e efetivar na mesma transação.
 *   - Saldo na origem é validado para não negativar (a não ser que
 *     `permitirNegativar: true` venha explícito — supervisor).
 */

const { pool } = require('../config/db');
const { resolverProdutoEstoque } = require('./wms-resolver-codigo-estoque.service');
const { resolveCodigoProdutoDono } = require('../utils/wms-codigo-produto-mask');
const { listarPosicaoEstoque } = require('./wms-relatorio-posicao-estoque.service');
const { sugerirValidadeProduto } = require('./wms-inventario.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const MSG_TRANSF_TABELA_AUSENTE =
  'Tabela WMS_TRANSFERENCIA_DONO ainda não criada. Peça à TI rodar no pgAdmin: ' +
  'backend/scripts/criar_wms_transferencia_dono_postgres.sql. Em seguida recarregue a página.';

function normCodigo(v) {
  return String(v == null ? '' : v).trim();
}

/** Validações comuns a `preview` e `criar`. Retorna {ok} com contexto ou
 *  {err, status} para responder direto. */
async function validarPayload(tenantId, payload) {
  const cdOrigem = parseInt(payload.cdDonoOrigem, 10);
  const cdDestino = parseInt(payload.cdDonoDestino, 10);
  if (!Number.isFinite(cdOrigem) || !Number.isFinite(cdDestino)) {
    return { err: 'Donos de origem e destino são obrigatórios.', status: 400 };
  }
  if (cdOrigem === cdDestino) {
    return { err: 'Dono de origem e destino não podem ser iguais.', status: 400 };
  }
  const codigo = normCodigo(payload.codigoProduto);
  if (!codigo) return { err: 'Informe o código do produto.', status: 400 };

  const qtd = Number(payload.qtd);
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return { err: 'Quantidade precisa ser maior que zero.', status: 400 };
  }

  const lote = payload.lote ? String(payload.lote).trim().slice(0, 60) || null : null;
  let validade = null;
  if (payload.validade) {
    const s = String(payload.validade).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { err: 'Validade inválida — use AAAA-MM-DD.', status: 400 };
    }
    validade = s;
  }
  const motivo = payload.motivo ? String(payload.motivo).trim().slice(0, 255) : null;
  const codigoDestino = normCodigo(payload.codigoProdutoDestino) || null;

  return {
    ok: { cdOrigem, cdDestino, codigo, codigoDestino, qtd, lote, validade, motivo },
  };
}

/** Confirma que os donos existem no tenant e estão ativos. */
async function assertDonosAtivos(client, tenantId, ids) {
  const r = await client.query(
    `SELECT "CD_DONO", "NOME"
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" = ANY($2::int[])
        AND COALESCE("FGACTIVE", 'S') = 'S'`,
    [tenantId, ids]
  );
  return new Map(r.rows.map((row) => [row.CD_DONO, row.NOME]));
}

/** Resolve o produto no dono origem usando o resolvedor padrão (aceita
 *  código com/sem máscara, zeros à esquerda etc.). */
async function resolverProdutoOrigem(client, tenantId, cdDono, codigo) {
  const hit = await resolverProdutoEstoque(client, tenantId, cdDono, codigo, {});
  if (!hit) return null;
  const r = await client.query(
    `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."UNIDADE", p."CODIGO_BARRAS", p."NCM",
            p."PESO_KG", p."TIPO_ARMAZENAGEM", p."CD_CATEGORIA",
            p."FG_DESCARTAVEL", p."FG_CONTROLA_LOTE", p."FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_DONO" p
      WHERE p."CD_PRODUTO" = $1::integer AND p."TENANT_ID" = $2
      LIMIT 1`,
    [hit.cdProduto, tenantId]
  );
  return r.rows[0] || null;
}

/** Procura um produto no dono destino que case com o código do origem.
 *  Tenta achar com máscara → sem máscara. Retorna `null` se não existe. */
async function resolverProdutoDestino(client, tenantId, cdDono, codigo) {
  const codMascarado = await resolveCodigoProdutoDono(client, tenantId, cdDono, codigo);
  const r = await client.query(
    `SELECT "CD_PRODUTO", "CODIGO", "NOME", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CODIGO" = $3
        AND COALESCE("FGACTIVE", 'S') = 'S'
      LIMIT 1`,
    [tenantId, cdDono, codMascarado]
  );
  if (r.rows[0]) return r.rows[0];
  return null;
}

/** Saldo SKU atual do produto na origem. Usa a mesma base do relatório
 *  Posição (recebimentos encerrados + ledger). */
async function obterSaldoSku(tenantId, cdDono, cdProduto) {
  const { linhas } = await listarPosicaoEstoque(tenantId, cdDono);
  /** O relatório tem múltiplas linhas para o mesmo SKU (uma por lote). O
   *  saldo total do SKU está repetido em `QTD_SALDO_SKU` em todas elas. */
  for (const r of linhas || []) {
    if (Number(r.CD_PRODUTO) === Number(cdProduto)) {
      const s = Number(r.QTD_SALDO_SKU);
      return Number.isFinite(s) ? s : 0;
    }
  }
  return 0;
}

/** Cadastra automaticamente o produto no dono destino, copiando os campos
 *  cadastrais do origem. Retorna o registro recém-criado. */
async function autoCadastrarProdutoDestino(client, tenantId, cdDonoDestino, prodOrigem, sgUser) {
  const r = await client.query(
    `INSERT INTO "WMS_PRODUTO_DONO" (
       "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "CODIGO_BARRAS",
       "NCM", "PESO_KG", "TIPO_ARMAZENAGEM", "CD_CATEGORIA", "ORIGEM_CADASTRO",
       "FG_FORNECEDOR_REF", "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE",
       "FGACTIVE", "SG_USER"
     ) VALUES (
       $1, $2::integer, $3, $4, $5, $6, $7, $8, $9, $10, 'TRANSFERENCIA',
       'N', $11, $12, $13, 'S', $14
     )
     RETURNING "CD_PRODUTO", "CODIGO", "NOME"`,
    [
      tenantId,
      cdDonoDestino,
      prodOrigem.CODIGO,
      prodOrigem.NOME,
      prodOrigem.UNIDADE,
      prodOrigem.CODIGO_BARRAS,
      prodOrigem.NCM,
      prodOrigem.PESO_KG,
      prodOrigem.TIPO_ARMAZENAGEM,
      prodOrigem.CD_CATEGORIA,
      prodOrigem.FG_DESCARTAVEL || 'N',
      prodOrigem.FG_CONTROLA_LOTE || 'N',
      prodOrigem.FG_CONTROLA_VALIDADE || 'N',
      sgUser,
    ]
  );
  return r.rows[0];
}

/**
 * Pré-validação: confere donos, achados de produto e saldo. Não grava nada.
 * Útil para o frontend mostrar "Vai transferir 100 de 701" antes de confirmar.
 */
async function previewTransferencia(tenantId, payload) {
  const val = await validarPayload(tenantId, payload);
  if (val.err) return val;
  const { cdOrigem, cdDestino, codigo, codigoDestino, qtd } = val.ok;

  const client = await pool.connect();
  try {
    const donos = await assertDonosAtivos(client, tenantId, [cdOrigem, cdDestino]);
    if (!donos.has(cdOrigem)) return { err: 'Dono de origem inválido ou inativo.', status: 400 };
    if (!donos.has(cdDestino)) return { err: 'Dono de destino inválido ou inativo.', status: 400 };

    const prodOrigem = await resolverProdutoOrigem(client, tenantId, cdOrigem, codigo);
    if (!prodOrigem) {
      return {
        err: 'Produto "' + codigo + '" não cadastrado no dono de origem (' + donos.get(cdOrigem) + ').',
        status: 404,
      };
    }

    const saldoOrigem = await obterSaldoSku(tenantId, cdOrigem, prodOrigem.CD_PRODUTO);
    const saldoOk = saldoOrigem >= qtd;

    const codigoBuscaDestino = codigoDestino || prodOrigem.CODIGO;
    const prodDestino = await resolverProdutoDestino(client, tenantId, cdDestino, codigoBuscaDestino);
    if (codigoDestino && !prodDestino) {
      return {
        err:
          'Produto "' +
          codigoDestino +
          '" não cadastrado no dono de destino (' +
          donos.get(cdDestino) +
          '). Cadastre em Cadastros WMS ou deixe o campo "Código no destino" vazio para copiar o código da origem.',
        status: 404,
      };
    }

    /** FEFO: validade mais curta com saldo de lote (>0); senão, menor validade da NF encerrada. */
    const sugVal = await sugerirValidadeProduto(client, tenantId, cdOrigem, prodOrigem.CD_PRODUTO);

    return {
      ok: {
        donoOrigem: { CD_DONO: cdOrigem, NOME: donos.get(cdOrigem) },
        donoDestino: { CD_DONO: cdDestino, NOME: donos.get(cdDestino) },
        produto: {
          CD_PRODUTO: prodOrigem.CD_PRODUTO,
          CODIGO: prodOrigem.CODIGO,
          NOME: prodOrigem.NOME,
          UNIDADE: prodOrigem.UNIDADE,
          TIPO_ARMAZENAGEM: prodOrigem.TIPO_ARMAZENAGEM,
        },
        codigoDestinoInformado: codigoDestino,
        saldoOrigem,
        qtdSolicitada: qtd,
        saldoOk,
        validadeSugerida: sugVal ? sugVal.validade : null,
        loteSugerido: sugVal ? sugVal.lote : null,
        fonteValidade: sugVal ? sugVal.fonte : null,
        precisaCadastroDestino: !prodDestino && !codigoDestino,
        cadastroSugerido: prodDestino || codigoDestino
          ? null
          : {
              CODIGO: prodOrigem.CODIGO,
              NOME: prodOrigem.NOME,
              UNIDADE: prodOrigem.UNIDADE,
              TIPO_ARMAZENAGEM: prodOrigem.TIPO_ARMAZENAGEM,
              FG_CONTROLA_LOTE: prodOrigem.FG_CONTROLA_LOTE,
              FG_CONTROLA_VALIDADE: prodOrigem.FG_CONTROLA_VALIDADE,
            },
        produtoDestino: prodDestino
          ? {
              CD_PRODUTO: prodDestino.CD_PRODUTO,
              CODIGO: prodDestino.CODIGO,
              NOME: prodDestino.NOME,
            }
          : null,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Cria a transferência: 2 movimentos no ledger + 1 documento em
 * WMS_TRANSFERENCIA_DONO. Transação atômica.
 *
 * Payload extra:
 *   - autoCadastrarDestino: boolean — se `true` e o destino não tem o SKU,
 *     copia o cadastro do origem antes de efetivar.
 *   - permitirNegativar: boolean — saldo origem < qtd só passa se `true`
 *     (supervisor consciente). Sem isso, retorna erro 409.
 */
async function criarTransferencia(tenantId, payload, sgUser) {
  const val = await validarPayload(tenantId, payload);
  if (val.err) return val;
  const { cdOrigem, cdDestino, codigo, codigoDestino, qtd, lote, validade, motivo } = val.ok;

  const autoCadastrar = payload.autoCadastrarDestino === true;
  const permitirNegativar = payload.permitirNegativar === true;

  const client = await pool.connect();
  try {
    const donos = await assertDonosAtivos(client, tenantId, [cdOrigem, cdDestino]);
    if (!donos.has(cdOrigem)) return { err: 'Dono de origem inválido ou inativo.', status: 400 };
    if (!donos.has(cdDestino)) return { err: 'Dono de destino inválido ou inativo.', status: 400 };

    const prodOrigem = await resolverProdutoOrigem(client, tenantId, cdOrigem, codigo);
    if (!prodOrigem) {
      return {
        err: 'Produto "' + codigo + '" não cadastrado no dono de origem (' + donos.get(cdOrigem) + ').',
        status: 404,
      };
    }

    let loteFinal = lote;
    let validadeFinal = validade;
    if (!loteFinal || !validadeFinal) {
      const sugVal = await sugerirValidadeProduto(client, tenantId, cdOrigem, prodOrigem.CD_PRODUTO);
      if (sugVal) {
        if (!validadeFinal && sugVal.validade) validadeFinal = sugVal.validade;
        if (!loteFinal && sugVal.lote) loteFinal = sugVal.lote;
      }
    }

    const saldoOrigem = await obterSaldoSku(tenantId, cdOrigem, prodOrigem.CD_PRODUTO);
    if (saldoOrigem < qtd && !permitirNegativar) {
      return {
        err:
          'Saldo insuficiente na origem: ' + saldoOrigem + ' < ' + qtd + '. ' +
          'Use "permitir negativar" se realmente quer prosseguir (sob auditoria).',
        status: 409,
        saldoOrigem,
      };
    }

    const codigoBuscaDestino = codigoDestino || prodOrigem.CODIGO;
    let prodDestino = await resolverProdutoDestino(client, tenantId, cdDestino, codigoBuscaDestino);
    if (!prodDestino) {
      if (codigoDestino) {
        return {
          err:
            'Produto "' +
            codigoDestino +
            '" não cadastrado no dono de destino (' +
            donos.get(cdDestino) +
            ').',
          status: 404,
        };
      }
      if (!autoCadastrar) {
        return {
          err: 'Produto não existe no destino (' + donos.get(cdDestino) + '). Confirme o auto-cadastro.',
          status: 409,
          precisaCadastroDestino: true,
          cadastroSugerido: {
            CODIGO: prodOrigem.CODIGO,
            NOME: prodOrigem.NOME,
            UNIDADE: prodOrigem.UNIDADE,
            TIPO_ARMAZENAGEM: prodOrigem.TIPO_ARMAZENAGEM,
          },
        };
      }
      /** Auto-cadastro acontece DENTRO da mesma transação para garantir
       *  consistência (não cria meio cadastro se o resto falhar). */
      try {
        await client.query('BEGIN');
        prodDestino = await autoCadastrarProdutoDestino(client, tenantId, cdDestino, prodOrigem, sgUser);
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
      }
    } else {
      await client.query('BEGIN');
    }

    try {
      const ts = Date.now();
      const idemBase = 'TRANSF|' + cdOrigem + '|' + cdDestino + '|' + prodOrigem.CD_PRODUTO + '|' + ts;
      const sgSlice = sgUser ? String(sgUser).slice(0, 64) : null;

      /** SAÍDA na origem (qtd negativa). */
      const movSaida = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
           ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'TRANSFERENCIA_SAIDA', $5, $6)
         RETURNING "CD_MOVIMENTO"`,
        [tenantId, cdOrigem, prodOrigem.CD_PRODUTO, -Math.abs(qtd), (idemBase + '|OUT').slice(0, 128), sgSlice]
      );

      /** ENTRADA no destino (qtd positiva). */
      const movEntrada = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
           ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'TRANSFERENCIA_ENTRADA', $5, $6)
         RETURNING "CD_MOVIMENTO"`,
        [tenantId, cdDestino, prodDestino.CD_PRODUTO, Math.abs(qtd), (idemBase + '|IN').slice(0, 128), sgSlice]
      );

      /** Documento da transferência. */
      const doc = await client.query(
        `INSERT INTO "WMS_TRANSFERENCIA_DONO" (
           "TENANT_ID", "CD_DONO_ORIGEM", "CD_DONO_DESTINO",
           "CD_PRODUTO_ORIGEM", "CD_PRODUTO_DESTINO", "CODIGO_PRODUTO",
           "NM_PRODUTO_SNAPSHOT", "LOTE", "VALIDADE", "QTD", "MOTIVO",
           "REF_CD_MOVIMENTO_SAIDA", "REF_CD_MOVIMENTO_ENTRADA", "SG_USER"
         ) VALUES ($1, $2::integer, $3::integer, $4::integer, $5::integer, $6,
                   $7, $8, $9, $10::numeric, $11, $12::bigint, $13::bigint, $14)
         RETURNING *`,
        [
          tenantId,
          cdOrigem,
          cdDestino,
          prodOrigem.CD_PRODUTO,
          prodDestino.CD_PRODUTO,
          prodOrigem.CODIGO,
          prodOrigem.NOME,
          loteFinal,
          validadeFinal,
          qtd,
          motivo,
          movSaida.rows[0].CD_MOVIMENTO,
          movEntrada.rows[0].CD_MOVIMENTO,
          sgSlice,
        ]
      );

      await client.query('COMMIT');

      return {
        ok: {
          ...doc.rows[0],
          NM_DONO_ORIGEM: donos.get(cdOrigem),
          NM_DONO_DESTINO: donos.get(cdDestino),
          saldoOrigemAntes: saldoOrigem,
          saldoOrigemDepois: saldoOrigem - qtd,
          cadastroDestinoCriado: prodDestino && !!autoCadastrar && !payload.__produtoDestinoJaExistia,
        },
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (schemaMissing(e)) return { err: MSG_TRANSF_TABELA_AUSENTE, status: 503 };
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * Obtém uma transferência específica + dados dos donos e dos movimentos
 * relacionados. Base do detalhe e do comprovante PDF.
 */
async function obterTransferencia(tenantId, cdTransferencia) {
  try {
    const r = await pool.query(
      `SELECT t.*,
              o."NOME" AS "NM_DONO_ORIGEM",
              d."NOME" AS "NM_DONO_DESTINO",
              po."NOME" AS "NM_PRODUTO_ORIGEM",
              po."UNIDADE" AS "UN_PRODUTO_ORIGEM",
              pd."NOME" AS "NM_PRODUTO_DESTINO",
              pd."UNIDADE" AS "UN_PRODUTO_DESTINO"
         FROM "WMS_TRANSFERENCIA_DONO" t
         LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = t."CD_DONO_ORIGEM" AND o."TENANT_ID" = t."TENANT_ID"
         LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = t."CD_DONO_DESTINO" AND d."TENANT_ID" = t."TENANT_ID"
         LEFT JOIN "WMS_PRODUTO_DONO" po ON po."CD_PRODUTO" = t."CD_PRODUTO_ORIGEM" AND po."TENANT_ID" = t."TENANT_ID"
         LEFT JOIN "WMS_PRODUTO_DONO" pd ON pd."CD_PRODUTO" = t."CD_PRODUTO_DESTINO" AND pd."TENANT_ID" = t."TENANT_ID"
        WHERE t."TENANT_ID" = $1 AND t."CD_TRANSFERENCIA" = $2::bigint
        LIMIT 1`,
      [tenantId, cdTransferencia]
    );
    if (!r.rows.length) return { err: 'Transferência não encontrada.', status: 404 };
    return { ok: r.rows[0] };
  } catch (e) {
    if (schemaMissing(e)) return { err: MSG_TRANSF_TABELA_AUSENTE, status: 503 };
    throw e;
  }
}

/**
 * Cancela uma transferência EFETIVADA, gerando 2 movimentos inversos no
 * ledger (estorno) e marcando o documento como CANCELADA. Transacional.
 *
 * Regras:
 *   - Documento precisa estar EFETIVADA (não dá para cancelar duas vezes).
 *   - Verifica saldo do DESTINO antes de estornar — se o destino já
 *     consumiu o estoque (saldo < qtd), retorna erro pedindo
 *     `permitirNegativar: true` (supervisor).
 *   - Idempotência: idempotency-key do estorno é prefixada com `EST|` para
 *     não conflitar com os movimentos originais.
 */
async function cancelarTransferencia(tenantId, cdTransferencia, sgUser, opts) {
  opts = opts || {};
  const motivoCancel = opts.motivoCancel ? String(opts.motivoCancel).trim().slice(0, 255) : null;
  const permitirNegativar = opts.permitirNegativar === true;

  const ref = await obterTransferencia(tenantId, cdTransferencia);
  if (ref.err) return ref;
  const doc = ref.ok;
  if (String(doc.ST_TRANSFERENCIA).toUpperCase() !== 'EFETIVADA') {
    return { err: 'Transferência não está EFETIVADA — estado atual: ' + doc.ST_TRANSFERENCIA + '.', status: 409 };
  }

  /** Saldo do dono destino — não pode negativar com o estorno sem confirmação. */
  const saldoDestinoAtual = await obterSaldoSku(
    tenantId,
    doc.CD_DONO_DESTINO,
    doc.CD_PRODUTO_DESTINO
  );
  const qtd = Number(doc.QTD);
  if (saldoDestinoAtual < qtd && !permitirNegativar) {
    return {
      err:
        'Saldo no destino é menor que a quantidade a estornar (' + saldoDestinoAtual +
        ' < ' + qtd + '). Use "permitir negativar" se realmente quer prosseguir (sob auditoria).',
      status: 409,
      saldoDestino: saldoDestinoAtual,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ts = Date.now();
    const idemBase = 'EST|TRANSF|' + cdTransferencia + '|' + ts;
    const sgSlice = sgUser ? String(sgUser).slice(0, 64) : null;

    /** ENTRADA na origem (estorno do saída original — qtd positiva). */
    await client.query(
      `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
         ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
       VALUES ($1, $2::integer, $3::integer, $4::numeric, 'TRANSFERENCIA_ESTORNO_ENTRADA', $5, $6)
       ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
      [
        tenantId,
        doc.CD_DONO_ORIGEM,
        doc.CD_PRODUTO_ORIGEM,
        Math.abs(qtd),
        (idemBase + '|IN').slice(0, 128),
        sgSlice,
      ]
    );

    /** SAÍDA no destino (estorno do entrada original — qtd negativa). */
    await client.query(
      `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
         ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
       VALUES ($1, $2::integer, $3::integer, $4::numeric, 'TRANSFERENCIA_ESTORNO_SAIDA', $5, $6)
       ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
      [
        tenantId,
        doc.CD_DONO_DESTINO,
        doc.CD_PRODUTO_DESTINO,
        -Math.abs(qtd),
        (idemBase + '|OUT').slice(0, 128),
        sgSlice,
      ]
    );

    /** Marca o documento como cancelado. */
    const motivoFinal = motivoCancel
      ? (doc.MOTIVO ? (doc.MOTIVO + ' · CANCELADO: ' + motivoCancel) : 'CANCELADO: ' + motivoCancel).slice(0, 255)
      : doc.MOTIVO;
    const upd = await client.query(
      `UPDATE "WMS_TRANSFERENCIA_DONO"
          SET "ST_TRANSFERENCIA" = 'CANCELADA',
              "DH_CANCELAMENTO" = CURRENT_TIMESTAMP,
              "SG_USER_CANCEL" = $3,
              "MOTIVO" = $4
        WHERE "TENANT_ID" = $1 AND "CD_TRANSFERENCIA" = $2::bigint
        RETURNING *`,
      [tenantId, cdTransferencia, sgSlice, motivoFinal]
    );
    await client.query('COMMIT');

    return {
      ok: {
        ...upd.rows[0],
        saldoDestinoAntesEstorno: saldoDestinoAtual,
        saldoDestinoDepoisEstorno: saldoDestinoAtual - qtd,
      },
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_TRANSF_TABELA_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Lista transferências com filtros simples (dono, período). Usado pelo
 * módulo "Transferências" (próxima fase) e pela aba histórico. Sem filtros
 * retorna as 100 últimas.
 */
async function listarTransferencias(tenantId, filtros) {
  filtros = filtros || {};
  const where = ['t."TENANT_ID" = $1'];
  const params = [tenantId];
  let i = 2;
  if (filtros.cdDono != null && filtros.cdDono !== '') {
    const cd = parseInt(filtros.cdDono, 10);
    if (Number.isFinite(cd)) {
      where.push('(t."CD_DONO_ORIGEM" = $' + i + '::integer OR t."CD_DONO_DESTINO" = $' + i + '::integer)');
      params.push(cd);
      i++;
    }
  }
  if (filtros.dataInicio) {
    where.push('t."DH_REGISTRO" >= $' + i + '::timestamptz');
    params.push(filtros.dataInicio);
    i++;
  }
  if (filtros.dataFim) {
    where.push('t."DH_REGISTRO" < ($' + i + '::date + INTERVAL \'1 day\')');
    params.push(filtros.dataFim);
    i++;
  }
  let limit = parseInt(filtros.limite, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;

  const sql =
    'SELECT t.*, o."NOME" AS "NM_DONO_ORIGEM", d."NOME" AS "NM_DONO_DESTINO" ' +
    'FROM "WMS_TRANSFERENCIA_DONO" t ' +
    'LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = t."CD_DONO_ORIGEM" AND o."TENANT_ID" = t."TENANT_ID" ' +
    'LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = t."CD_DONO_DESTINO" AND d."TENANT_ID" = t."TENANT_ID" ' +
    'WHERE ' + where.join(' AND ') + ' ' +
    'ORDER BY t."DH_REGISTRO" DESC ' +
    'LIMIT ' + limit;

  try {
    const r = await pool.query(sql, params);
    return { ok: { itens: r.rows, total: r.rows.length } };
  } catch (e) {
    if (schemaMissing(e)) return { err: MSG_TRANSF_TABELA_AUSENTE, status: 503 };
    throw e;
  }
}

module.exports = {
  previewTransferencia,
  criarTransferencia,
  obterTransferencia,
  cancelarTransferencia,
  listarTransferencias,
  MSG_TRANSF_TABELA_AUSENTE,
};
