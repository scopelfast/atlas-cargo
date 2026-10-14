'use strict';
/**
 * Usa a MESMA função do romaneio (carregarNrRotaPorPedidosOpl) — sem dúvida no critério.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { carregarNrRotaPorPedidosOpl, chaveDestinatarioOpl } = require('../services/cadastro-endereco-entrega-match.service');

const TENANT = 'default';

(async () => {
  const ped = await pool.query(
    `
SELECT DISTINCT ON (
  regexp_replace(TRIM(COALESCE(p."COD_DESTINATARIO",'')), '[^0-9]', '', 'g'),
  UPPER(TRIM(COALESCE(p."RAZ_SOC_DEST",'')))
)
  p."COD_DESTINATARIO",
  p."RAZ_SOC_DEST",
  p."CNPJ_DEST",
  p."ENDE_ENTREGA",
  p."BAIRRO_ENTREGA",
  p."CEP_ENTREGA",
  p."CIDADE_ENTREGA",
  p."UF_ENTREGA",
  p."NUM_PEDIDO",
  a."CD_OPL_ARQUIVO",
  a."NM_ARQUIVO",
  a."DH_IMPORT",
  a."CLI_NOME"
FROM "WMS_OPL_PEDIDO" p
JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=p."CD_OPL_ARQUIVO"
WHERE a."TENANT_ID"=$1
  AND (
    UPPER(COALESCE(a."CLI_NOME",'')) LIKE '%MANA%'
    OR UPPER(COALESCE(a."NM_ARQUIVO",'')) LIKE '%MANA%'
  )
  AND TRIM(COALESCE(p."COD_DESTINATARIO",'')) <> ''
ORDER BY
  regexp_replace(TRIM(COALESCE(p."COD_DESTINATARIO",'')), '[^0-9]', '', 'g'),
  UPPER(TRIM(COALESCE(p."RAZ_SOC_DEST",''))),
  a."DH_IMPORT" DESC
`,
    [TENANT]
  );

  const mapa = await carregarNrRotaPorPedidosOpl(pool, TENANT, ped.rows);

  // Agregar por código
  const byCod = new Map();
  for (const p of ped.rows) {
    const cod = String(p.COD_DESTINATARIO || '').trim();
    const k = chaveDestinatarioOpl(p);
    const nr = mapa.has(k) ? mapa.get(k) : null;
    if (!byCod.has(cod)) {
      byCod.set(cod, {
        COD: cod,
        RAZAO: p.RAZ_SOC_DEST,
        CIDADE: p.CIDADE_ENTREGA,
        UF: p.UF_ENTREGA,
        ENDE: p.ENDE_ENTREGA,
        CEP: p.CEP_ENTREGA,
        CNPJ: p.CNPJ_DEST,
        NR_ROTA: nr,
        STATUS: nr != null && Number.isFinite(Number(nr)) ? 'COM_ROTA' : 'SEM_ROTA',
        EXEMPLO_ARQUIVO: p.NM_ARQUIVO,
        ULTIMA_IMPORT: p.DH_IMPORT,
      });
    } else {
      const cur = byCod.get(cod);
      // se alguma ocorrência tem rota, preferir COM_ROTA
      if (cur.STATUS === 'SEM_ROTA' && nr != null && Number.isFinite(Number(nr))) {
        cur.STATUS = 'COM_ROTA';
        cur.NR_ROTA = nr;
      }
    }
  }

  // Contagem de pedidos por código no histórico Mana
  const cnt = await pool.query(
    `
SELECT TRIM(p."COD_DESTINATARIO") AS cod,
       COUNT(DISTINCT p."CD_OPL_PEDIDO")::int AS n_pedidos,
       COUNT(DISTINCT p."CD_OPL_ARQUIVO")::int AS n_arquivos,
       MAX(a."DH_IMPORT") AS ultima_import
  FROM "WMS_OPL_PEDIDO" p
  JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=p."CD_OPL_ARQUIVO"
 WHERE a."TENANT_ID"=$1
   AND (UPPER(COALESCE(a."CLI_NOME",'')) LIKE '%MANA%' OR UPPER(a."NM_ARQUIVO") LIKE '%MANA%')
   AND TRIM(COALESCE(p."COD_DESTINATARIO",'')) <> ''
 GROUP BY 1
`,
    [TENANT]
  );
  const cntMap = Object.fromEntries(cnt.rows.map((r) => [r.cod, r]));

  const todos = [...byCod.values()].map((r) => {
    const c = cntMap[r.COD] || {};
    return {
      ...r,
      N_PEDIDOS: c.n_pedidos || 0,
      N_ARQUIVOS: c.n_arquivos || 0,
      ULTIMA_IMPORT: c.ultima_import || r.ULTIMA_IMPORT,
    };
  });

  const sem = todos.filter((r) => r.STATUS === 'SEM_ROTA').sort((a, b) => a.COD.localeCompare(b.COD));
  const com = todos.filter((r) => r.STATUS === 'COM_ROTA');

  // Arquivo Lote 06 Emergente / similares recentes
  const arqRec = await pool.query(
    `
SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT",
       TRIM(p."COD_DESTINATARIO") AS cod,
       p."RAZ_SOC_DEST", p."CIDADE_ENTREGA", p."UF_ENTREGA", p."NUM_PEDIDO"
  FROM "WMS_OPL_ARQUIVO" a
  JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO"=a."CD_OPL_ARQUIVO"
 WHERE a."TENANT_ID"=$1
   AND (
     UPPER(a."NM_ARQUIVO") LIKE '%LOTE 06%EMERG%'
     OR UPPER(a."NM_ARQUIVO") LIKE '%EMERGENTE%'
     OR UPPER(a."NM_ARQUIVO") LIKE '%EMERGENT%'
   )
 ORDER BY a."DH_IMPORT" DESC, p."COD_DESTINATARIO"
 LIMIT 80
`,
    [TENANT]
  );
  const semNoArq = [];
  for (const row of arqRec.rows) {
    const st = byCod.get(row.cod);
    if (!st || st.STATUS === 'SEM_ROTA') {
      semNoArq.push({
        arquivo: row.NM_ARQUIVO,
        id: row.CD_OPL_ARQUIVO,
        cod: row.cod,
        razao: row.RAZ_SOC_DEST,
        pedido: row.NUM_PEDIDO,
        cidade: row.CIDADE_ENTREGA,
        uf: row.UF_ENTREGA,
      });
    }
  }

  // Cadastro 1163
  const e1163 = await pool.query(
    `SELECT e."CD_ENDERECO_ENTREGA", e."DS_PONTO_ENTREGA", e."NR_ROTA", e."FGACTIVE",
            e."LOGRADOURO", e."NUMERO", e."CEP", e."UF_ENTREGA", e."NM_MUNICIPIO"
       FROM "CADASTRO_ENDERECO_ENTREGA" e
      WHERE e."TENANT_ID"=$1
        AND (e."DS_PONTO_ENTREGA" ILIKE '%1163%' OR e."DS_PONTO_ENTREGA" ILIKE '%EMERGENT%')
      ORDER BY e."FGACTIVE" DESC NULLS LAST, e."CD_ENDERECO_ENTREGA"`,
    [TENANT]
  );

  const outDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csvPath = path.join(outDir, 'destinatarios-mana-sem-rota-romaneio.csv');
  const csv = ['COD;RAZAO;CIDADE;UF;CEP;ENDE;STATUS;NR_ROTA;N_PEDIDOS;N_ARQUIVOS;ULTIMA_IMPORT;EXEMPLO_ARQUIVO']
    .concat(
      sem.map((r) =>
        [r.COD, r.RAZAO, r.CIDADE, r.UF, r.CEP, r.ENDE, r.STATUS, r.NR_ROTA, r.N_PEDIDOS, r.N_ARQUIVOS, r.ULTIMA_IMPORT, r.EXEMPLO_ARQUIVO]
          .map(esc)
          .join(';')
      )
    )
    .join('\n');
  fs.writeFileSync(csvPath, csv, 'utf8');

  console.log(
    JSON.stringify(
      {
        totalDestinatariosMana: todos.length,
        comRota: com.length,
        semRota: sem.length,
        listaSemRota: sem.map((r) => ({
          cod: r.COD,
          razao: r.RAZAO,
          cidade: r.CIDADE,
          uf: r.UF,
          pedidos: r.N_PEDIDOS,
          arquivos: r.N_ARQUIVOS,
          ultima: r.ULTIMA_IMPORT,
        })),
        arquivosEmergenteSemRota: semNoArq,
        cadastro1163OuEmergent: e1163.rows,
        csv: csvPath,
      },
      null,
      2
    )
  );

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
