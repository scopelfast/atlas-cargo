'use strict';
/**
 * Auditoria: pedidos OPL em mais de um arquivo (duplicidade entre espelhos).
 * NÃO cruza NF — só pedidos/picking (furo físico por separação em dobro).
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const TENANT = 'default';

(async () => {
  const univ = await pool.query(
    `SELECT COUNT(DISTINCT a."CD_OPL_ARQUIVO")::int AS arquivos,
            COUNT(DISTINCT p."CD_OPL_PEDIDO")::int AS pedidos,
            COUNT(i."CD_OPL_ITEM")::int AS itens,
            MIN(a."DH_IMPORT") AS primeira_import,
            MAX(a."DH_IMPORT") AS ultima_import
       FROM "WMS_OPL_ARQUIVO" a
       LEFT JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO"=a."CD_OPL_ARQUIVO"
       LEFT JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO"
      WHERE a."TENANT_ID"=$1`,
    [TENANT]
  );

  const detalhe = await pool.query(
    `
WITH base AS (
  SELECT
    a."TENANT_ID",
    a."CD_OPL_ARQUIVO",
    a."NM_ARQUIVO",
    a."CLI_NOME",
    a."DH_IMPORT",
    a."CD_DONO",
    d."NOME" AS "NM_DONO",
    p."CD_OPL_PEDIDO",
    p."NUM_PEDIDO",
    regexp_replace(COALESCE(p."NUM_PEDIDO",''), '[^0-9]', '', 'g') AS ped_norm,
    p."COD_DESTINATARIO",
    p."RAZ_SOC_DEST",
    (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS n_itens,
    (SELECT COALESCE(SUM(i."QT_PEDIDA"),0)::numeric FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS qtd_pedida,
    (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i
      WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO" AND i."QT_COLETADA" IS NOT NULL) AS n_itens_com_pick,
    (SELECT COALESCE(SUM(COALESCE(i."QT_COLETADA",0)),0)::numeric FROM "WMS_OPL_ITEM" i
      WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS qtd_coletada
  FROM "WMS_OPL_PEDIDO" p
  JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=p."CD_OPL_ARQUIVO"
  LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO"=a."CD_DONO" AND d."TENANT_ID"=a."TENANT_ID"
  WHERE a."TENANT_ID"=$1
    AND regexp_replace(COALESCE(p."NUM_PEDIDO",''), '[^0-9]', '', 'g') <> ''
),
dup AS (
  SELECT ped_norm
    FROM base
   GROUP BY ped_norm
  HAVING COUNT(DISTINCT "CD_OPL_ARQUIVO") > 1
)
SELECT b.*
  FROM base b
  JOIN dup d ON d.ped_norm = b.ped_norm
 ORDER BY b.ped_norm, b."DH_IMPORT", b."CD_OPL_ARQUIVO"
`,
    [TENANT]
  );

  const byPed = new Map();
  for (const r of detalhe.rows) {
    if (!byPed.has(r.ped_norm)) byPed.set(r.ped_norm, []);
    byPed.get(r.ped_norm).push(r);
  }

  const rowsOut = [];
  let nIdentico = 0;
  let nDivergente = 0;
  let nCriticoPickDuplo = 0;
  let nAltoPickEmUm = 0;
  let nMedioSemPick = 0;
  let qtdPedidaExtraRisco = 0; // soma qtd do 2º+ arquivo quando identico (volume em risco se separar de novo)
  let qtdColetadaDupla = 0; // quando 2+ ocorrências com pick: soma das coletas "extras"

  for (const [ped, occ] of byPed) {
    const qtds = [...new Set(occ.map((x) => String(Number(x.qtd_pedida))))];
    const itens = [...new Set(occ.map((x) => String(x.n_itens)))];
    const identico = qtds.length === 1 && itens.length === 1;
    if (identico) nIdentico++;
    else nDivergente++;

    const comPick = occ.filter((x) => Number(x.n_itens_com_pick) > 0 || Number(x.qtd_coletada) > 0);
    const nArqComPick = new Set(comPick.map((x) => x.CD_OPL_ARQUIVO)).size;

    let risco = 'MEDIO_SEM_PICK';
    if (nArqComPick >= 2) {
      risco = 'CRITICO_PICK_EM_2_ARQUIVOS';
      nCriticoPickDuplo++;
      // coleta extra = total coletado - max de uma ocorrência (aprox. excesso físico)
      const coletas = occ.map((x) => Number(x.qtd_coletada) || 0);
      const maxUma = Math.max(...coletas, 0);
      const soma = coletas.reduce((s, v) => s + v, 0);
      qtdColetadaDupla += Math.max(0, soma - maxUma);
    } else if (nArqComPick === 1) {
      risco = 'ALTO_PICK_EM_1_COPIA';
      nAltoPickEmUm++;
    } else {
      nMedioSemPick++;
    }

    if (identico && occ.length >= 2) {
      // volume que seria separado a mais se ambas forem picks: qtd de cada cópia além da 1ª
      const q = Number(occ[0].qtd_pedida) || 0;
      qtdPedidaExtraRisco += q * (occ.length - 1);
    }

    const arqs = occ
      .map(
        (x) =>
          `#${x.CD_OPL_ARQUIVO}|${x.NM_ARQUIVO}|import=${x.DH_IMPORT}|itens=${x.n_itens}|pedida=${Number(x.qtd_pedida)}|pickItens=${x.n_itens_com_pick}|coletada=${Number(x.qtd_coletada)}`
      )
      .join(' || ');

    rowsOut.push({
      PEDIDO: ped,
      NUM_PEDIDO: occ[0].NUM_PEDIDO,
      DESTINO: occ[0].RAZ_SOC_DEST || '',
      COD_DEST: occ[0].COD_DESTINATARIO || '',
      N_ARQUIVOS: new Set(occ.map((x) => x.CD_OPL_ARQUIVO)).size,
      N_OCORRENCIAS: occ.length,
      CONTEUDO: identico ? 'IDENTICO' : 'DIVERGENTE',
      RISCO_FISICO: risco,
      N_ARQ_COM_PICK: nArqComPick,
      QTD_PEDIDA_REF: Number(occ[0].qtd_pedida),
      N_ITENS_REF: occ[0].n_itens,
      CLIENTES_ARQ: [...new Set(occ.map((x) => x.CLI_NOME || '').filter(Boolean))].join(' | '),
      DONOS: [...new Set(occ.map((x) => x.NM_DONO || String(x.CD_DONO || '')).filter(Boolean))].join(' | '),
      DETALHE_ARQUIVOS: arqs,
    });
  }

  // duplicidade DENTRO do mesmo arquivo
  const intra = await pool.query(
    `
SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO",
       regexp_replace(COALESCE(p."NUM_PEDIDO",''), '[^0-9]', '', 'g') AS ped_norm,
       COUNT(*)::int AS n_vezes
  FROM "WMS_OPL_PEDIDO" p
  JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=p."CD_OPL_ARQUIVO"
 WHERE a."TENANT_ID"=$1
   AND regexp_replace(COALESCE(p."NUM_PEDIDO",''), '[^0-9]', '', 'g') <> ''
 GROUP BY 1,2,3
HAVING COUNT(*) > 1
 ORDER BY n_vezes DESC, ped_norm
 LIMIT 50
`,
    [TENANT]
  );

  // pares de arquivos com mais overlap
  const pares = new Map();
  for (const [, occ] of byPed) {
    const ids = [...new Set(occ.map((x) => x.CD_OPL_ARQUIVO))].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`;
        if (!pares.has(k)) pares.set(k, { a: ids[i], b: ids[j], n: 0, criticos: 0 });
        const p = pares.get(k);
        p.n++;
        const oA = occ.filter((x) => x.CD_OPL_ARQUIVO === ids[i]);
        const oB = occ.filter((x) => x.CD_OPL_ARQUIVO === ids[j]);
        const pickA = oA.some((x) => Number(x.n_itens_com_pick) > 0 || Number(x.qtd_coletada) > 0);
        const pickB = oB.some((x) => Number(x.n_itens_com_pick) > 0 || Number(x.qtd_coletada) > 0);
        if (pickA && pickB) p.criticos++;
      }
    }
  }
  const paresArr = [...pares.values()].sort((x, y) => y.n - x.n || y.criticos - x.criticos);
  const nomeArq = await pool.query(
    `SELECT "CD_OPL_ARQUIVO", "NM_ARQUIVO", "CLI_NOME", "DH_IMPORT"
       FROM "WMS_OPL_ARQUIVO" WHERE "TENANT_ID"=$1 AND "CD_OPL_ARQUIVO"=ANY($2::int[])`,
    [TENANT, [...new Set(paresArr.slice(0, 30).flatMap((p) => [p.a, p.b]))]]
  );
  const nm = Object.fromEntries(nomeArq.rows.map((r) => [r.CD_OPL_ARQUIVO, r]));

  rowsOut.sort((a, b) => {
    const ord = {
      CRITICO_PICK_EM_2_ARQUIVOS: 0,
      ALTO_PICK_EM_1_COPIA: 1,
      MEDIO_SEM_PICK: 2,
    };
    return (ord[a.RISCO_FISICO] ?? 9) - (ord[b.RISCO_FISICO] ?? 9) || a.PEDIDO.localeCompare(b.PEDIDO);
  });

  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const cols = Object.keys(rowsOut[0] || {
    PEDIDO: '',
    NUM_PEDIDO: '',
    DESTINO: '',
    COD_DEST: '',
    N_ARQUIVOS: '',
    N_OCORRENCIAS: '',
    CONTEUDO: '',
    RISCO_FISICO: '',
    N_ARQ_COM_PICK: '',
    QTD_PEDIDA_REF: '',
    N_ITENS_REF: '',
    CLIENTES_ARQ: '',
    DONOS: '',
    DETALHE_ARQUIVOS: '',
  });
  const csvBody = [cols.join(';')]
    .concat(rowsOut.map((r) => cols.map((c) => esc(r[c])).join(';')))
    .join('\n');

  const outDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outCsv = path.join(outDir, 'auditoria-pedidos-opl-duplicados.csv');
  fs.writeFileSync(outCsv, csvBody, 'utf8');

  const paresCsv = path.join(outDir, 'auditoria-pares-arquivos-opl-duplicados.csv');
  const paresLines = ['CD_ARQ_A;NM_A;DH_A;CD_ARQ_B;NM_B;DH_B;PEDIDOS_COMPARTILHADOS;DESTES_COM_PICK_NOS_2'];
  for (const p of paresArr) {
    const A = nm[p.a] || {};
    const B = nm[p.b] || {};
    paresLines.push(
      [
        p.a,
        esc(A.NM_ARQUIVO),
        A.DH_IMPORT || '',
        p.b,
        esc(B.NM_ARQUIVO),
        B.DH_IMPORT || '',
        p.n,
        p.criticos,
      ].join(';')
    );
  }
  fs.writeFileSync(paresCsv, paresLines.join('\n'), 'utf8');

  const resumo = {
    universo: univ.rows[0],
    pedidosDuplicadosEntreArquivos: byPed.size,
    conteudoIdentico: nIdentico,
    conteudoDivergente: nDivergente,
    risco: {
      CRITICO_pick_em_2_ou_mais_arquivos: nCriticoPickDuplo,
      ALTO_pick_em_apenas_1_copia: nAltoPickEmUm,
      MEDIO_ainda_sem_picking: nMedioSemPick,
    },
    volume: {
      qtdPedidaQueSeriaExtraSeSepararTodasCopias: qtdPedidaExtraRisco,
      qtdColetadaAMaisQuandoPickEm2Arquivos_aprox: qtdColetadaDupla,
    },
    duplicidadeDentroDoMesmoArquivo: intra.rows.length,
    amostraIntraArquivo: intra.rows.slice(0, 10),
    topParesArquivos: paresArr.slice(0, 12).map((p) => ({
      pedidosCompartilhados: p.n,
      criticosPickNos2: p.criticos,
      a: `#${p.a} ${nm[p.a]?.NM_ARQUIVO || ''}`,
      b: `#${p.b} ${nm[p.b]?.NM_ARQUIVO || ''}`,
    })),
    csvPedidos: outCsv,
    csvPares: paresCsv,
  };

  console.log(JSON.stringify(resumo, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
