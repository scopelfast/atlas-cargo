'use strict';
/**
 * Corrige NF Leben 155006 vs AF 0001474199:
 * - cProd 4 (guaraná) estava no de-para da calça Susane
 * - achocolatado 091021 BRS → 6.03.01.001.LA ×8 (AF 6.03.01.001.LB)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const TENANT = 'default';
const CD_DONO = 1;
const SG = 'script/leben-nf155006';
const CHAVE = '35260823094090000122550020001550061747440651';

async function upsertDepara(client, externo, interno, fator, obs) {
  const ex = await client.query(
    `SELECT "CD_DEPARA", "CODIGO_INTERNO", "FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(TRIM("CODIGO_EXTERNO"))=LOWER(TRIM($3::text))
      LIMIT 1`,
    [TENANT, CD_DONO, externo]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO"=$2, "FATOR_CONVERSAO"=$3, "FGACTIVE"='S',
              "OBSERVACAO"=$4, "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$5
        WHERE "CD_DEPARA"=$1`,
      [ex.rows[0].CD_DEPARA, interno, fator, obs, SG]
    );
    console.log(
      'DE-PARA',
      externo,
      ex.rows[0].CODIGO_INTERNO,
      '×' + ex.rows[0].FATOR_CONVERSAO,
      '→',
      interno,
      '×' + fator
    );
    return;
  }
  await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2,$3,$4,$5,$6,'S',$7)`,
    [TENANT, CD_DONO, externo, interno, fator, obs, SG]
  );
  console.log('DE-PARA CRIADO', externo, '→', interno, '×' + fator);
}

async function patchLinhasConf(linhas, mapa) {
  let n = 0;
  for (const l of linhas || []) {
    const cProd = String(l.cProd || l.CPROD || '').trim();
    const hit = mapa[cProd];
    if (!hit) continue;
    l.cdProduto = hit.CD_PRODUTO;
    l.codigoProduto = hit.CODIGO;
    l.nmProduto = hit.NOME;
    l.fatorConversao = hit.fator;
    n++;
  }
  return n;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Restaurar guaraná Leben (conflito com calça Susane no cProd "4")
    await upsertDepara(
      client,
      '4',
      '6.03.16.210.20',
      10,
      'Leben refresco guaraná → estoque PCT (AF 6.03.16.210.21). NÃO usar para calça Susane (código curto colide).'
    );

    // 2) Achocolatado AF 6.03.01.001.LB = operacional CX ×8 → estoque .LA
    for (const ext of ['091021 BRS', '091021BRS', '091021']) {
      await upsertDepara(
        client,
        ext,
        '6.03.01.001.LA',
        8,
        'Leben achocolatado AF 6.03.01.001.LB → estoque 6.03.01.001.LA ×8'
      );
    }

    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "FGACTIVE"='N', "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$3
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
          AND TRIM("CODIGO") IN ('091021 BRS','091021BRS')
        RETURNING "CD_PRODUTO","CODIGO"`,
      [TENANT, CD_DONO, SG]
    ).then((r) => r.rows.forEach((x) => console.log('INATIVADO lixo', x.CODIGO)));

    // produtos alvo
    const need = {
      '4': { codigo: '6.03.16.210.20', fator: 10 },
      '091021 BRS': { codigo: '6.03.01.001.LA', fator: 8 },
    };
    const mapa = {};
    for (const [cProd, info] of Object.entries(need)) {
      const p = await client.query(
        `SELECT "CD_PRODUTO","CODIGO","NOME" FROM "WMS_PRODUTO_DONO"
          WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
            AND LOWER(regexp_replace(TRIM("CODIGO"),'[^0-9A-Za-z]','','g'))
              = LOWER(regexp_replace($3,'[^0-9A-Za-z]','','g'))
          LIMIT 1`,
        [TENANT, CD_DONO, info.codigo]
      );
      if (!p.rows[0]) throw new Error('Produto ausente: ' + info.codigo);
      mapa[cProd] = { ...p.rows[0], fator: info.fator };
    }

    const doc = await client.query(
      `SELECT "CD_NFE", "CONFERENCIA_JSON", "LINHAS_JSON"
         FROM "WMS_NFE_ENTRADA"
        WHERE "TENANT_ID"=$1 AND "CHAVE_NFE"=$2`,
      [TENANT, CHAVE]
    );
    if (doc.rows[0]) {
      let conf = doc.rows[0].CONFERENCIA_JSON;
      if (typeof conf === 'string') conf = JSON.parse(conf);
      const linhas =
        (conf && (conf.linhas || conf.itens)) ||
        (Array.isArray(conf) ? conf : null);
      if (linhas && linhas.length) {
        const n = await patchLinhasConf(linhas, mapa);
        let novo;
        if (Array.isArray(conf)) novo = linhas;
        else if (conf.linhas) novo = { ...conf, linhas };
        else if (conf.itens) novo = { ...conf, itens: linhas };
        else novo = conf;
        await client.query(
          `UPDATE "WMS_NFE_ENTRADA" SET "CONFERENCIA_JSON"=$2::jsonb WHERE "CD_NFE"=$1`,
          [doc.rows[0].CD_NFE, JSON.stringify(novo)]
        );
        console.log('CONFERENCIA NF Leben atualizada,', n, 'linha(s)');
      } else {
        console.log('Conferência ainda sem linhas gravadas — de-para basta ao recarregar');
      }
    }

    // Susane NF calça: se ainda aberta e item cProd 4 apontando guaraná, forçar calça na conferência
    const susane = await client.query(
      `SELECT "CD_NFE", "CONFERENCIA_JSON", "CHAVE_NFE"
         FROM "WMS_NFE_ENTRADA"
        WHERE "TENANT_ID"=$1
          AND "CNPJ_EMITENTE" LIKE '%32485236000151%'
          AND "ST_RECEBIMENTO"='ABERTA'`,
      [TENANT]
    );
    const calca = await client.query(
      `SELECT "CD_PRODUTO","CODIGO","NOME" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2 AND "CODIGO"='6.52.60.030.00' LIMIT 1`,
      [TENANT, CD_DONO]
    );
    for (const s of susane.rows) {
      let conf = s.CONFERENCIA_JSON;
      if (typeof conf === 'string') conf = JSON.parse(conf);
      const linhas = conf?.linhas || conf?.itens || (Array.isArray(conf) ? conf : null);
      if (!linhas || !calca.rows[0]) continue;
      let mudou = 0;
      for (const l of linhas) {
        if (String(l.cProd || '').trim() !== '4') continue;
        // só corrige se parece calça pelo xProd
        const xp = String(l.xProd || l.descricao || '').toUpperCase();
        if (!xp.includes('CALCA') && !xp.includes('ELANCA') && !xp.includes('HELANCA')) continue;
        l.cdProduto = calca.rows[0].CD_PRODUTO;
        l.codigoProduto = calca.rows[0].CODIGO;
        l.nmProduto = calca.rows[0].NOME;
        l.fatorConversao = 1;
        mudou++;
      }
      if (mudou) {
        const novo = Array.isArray(conf)
          ? linhas
          : conf.linhas
            ? { ...conf, linhas }
            : { ...conf, itens: linhas };
        await client.query(
          `UPDATE "WMS_NFE_ENTRADA" SET "CONFERENCIA_JSON"=$2::jsonb WHERE "CD_NFE"=$1`,
          [s.CD_NFE, JSON.stringify(novo)]
        );
        console.log('Susane NF', s.CHAVE_NFE, 'item calça cProd 4 forçado na conferência');
      }
    }

    await client.query('COMMIT');
    console.log('\nOK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main();
