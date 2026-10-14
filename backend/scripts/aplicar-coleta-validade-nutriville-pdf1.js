'use strict';
/**
 * Coleta validade PDF 1 — Nutriville: grava lote/validade no saldo_lote
 * SEM alterar WMS_MOVIMENTO_ESTOQUE (quantidade/ledger intactos).
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { listarValidadeFaltante } = require('../services/wms-relatorio-validade-faltante.service');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');

const TENANT = 'default';
const CD_DONO = 2; // Nutriville
const SG = 'admin';

function lastDay(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Aceita DD-MM-YY, DD/MM/YY, MM-YY, MM/YY → YYYY-MM-DD */
function parseValidade(raw) {
  const s = String(raw || '').trim().replace(/\./g, '-').replace(/\//g, '-');
  if (!s) return null;
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let mo = parseInt(m[1], 10);
    let y = parseInt(m[2], 10);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12) return null;
    const d = lastDay(y, mo);
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function normLote(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, 60) : null;
}

function normCodigoKey(c) {
  return String(c || '').replace(/\D/g, '');
}

/**
 * Coleta do PDF (Nutriville). Em branco / alecrim / canela omitidos.
 * qtdPaper = a coletar do papel (referência); splitArroz tratado à parte.
 */
const COLETA = [
  { codigo: '6.01.06.642.00', lote: '625A', validade: '15-04-27', qtdPaper: 48, obs: '' },
  { codigo: '6.03.14.531.00', lote: '26-53', validade: '10-08-26', qtdPaper: 83, obs: '' },
  { codigo: '6.03.17.008.00', lote: '1010 25', validade: '10-10-26', qtdPaper: 57, obs: '' },
  // arroz split
  {
    codigo: '6.03.04.016.20',
    split: [
      { lote: null, validade: '11-08-26', qtdFix: 1, obs: '1 UN (obs papel)' },
      { lote: '02226', validade: '06-03-27', qtdRestante: true, obs: 'restante a coletar' },
    ],
  },
  { codigo: '6.03.17.069.00', lote: '24262E36', validade: '18-09-26', qtdPaper: 15, obs: '' },
  { codigo: '6.03.07.041.00', lote: '1107251B', validade: '11-01-27', qtdPaper: 16, obs: '' },
  { codigo: '6.03.07.041.80', lote: '13112522', validade: '13-05-27', qtdPaper: 2, obs: '' },
  { codigo: '6.06.03.755.60', lote: '285', validade: '30-09-26', qtdPaper: 415, obs: '' },
  // água e sal — data mais curta (09-26 → 30/09/2026), lote L.4 da obs
  { codigo: '6.06.03.937.00', lote: 'L.4', validade: '09-26', qtdPaper: 50, obs: 'data mais curta (obs)' },
  { codigo: '6.03.01.120.60', lote: '1475', validade: '04-05-27', qtdPaper: 10, obs: '' },
  { codigo: '6.03.15.920.00', lote: '2601', validade: '26-09-26', qtdPaper: 67, obs: '' },
  { codigo: '6.03.17.250.00', lote: '12020E01', validade: '12-08-26', qtdPaper: 41, obs: '' },
  { codigo: '6.03.07.201.40', lote: '224/25', validade: '12-08-27', qtdPaper: 60, obs: '' },
  { codigo: '6.03.07.201.00', lote: '05 F 25 RI', validade: '12-27', qtdPaper: 677, obs: '' },
  { codigo: '6.03.10.201.20', lote: '12-02E01', validade: '12-08-26', qtdPaper: 13, obs: '' },
  { codigo: '6.03.10.211.20', lote: '339', validade: '05-12-26', qtdPaper: 374, obs: '' },
  { codigo: '6.03.04.255.00', lote: '0405', validade: '20-02-27', qtdPaper: 1870, obs: '' },
  { codigo: '6.03.15.132.40', lote: '209', validade: '28-01-27', qtdPaper: 10, obs: '' },
  { codigo: '6.03.08.309.60', lote: '240725', validade: '07-27', qtdPaper: 239, obs: '' },
  { codigo: '6.03.04.305.40', lote: '01', validade: '15-09-26', qtdPaper: 5, obs: '' },
  { codigo: '6.03.11.102.40', lote: '2A1053', validade: '13-11-26', qtdPaper: 24, obs: '' },
  { codigo: '6.03.12.002.00', lote: '250906', validade: '06-09-27', qtdPaper: 52, obs: '' },
  // conchinha — data mais curta 08/08/2027
  { codigo: '6.03.12.009.00', lote: '08/08/25', validade: '08-08-27', qtdPaper: 13, obs: 'data mais curta' },
  { codigo: '6.03.12.011.00', lote: null, validade: '09-07-27', qtdPaper: 175, obs: '' },
  { codigo: '6.03.12.101.00', lote: '3.3518', validade: '03-10-27', qtdPaper: 10, obs: '' },
  { codigo: '6.03.12.104.40', lote: '1260', validade: '09-27', qtdPaper: 531, obs: '' },
  { codigo: '6.03.12.016.20', lote: '250828', validade: '31-07-27', qtdPaper: 3053, obs: '' },
  { codigo: '6.03.17.529.60', lote: '11022026', validade: '08-26', qtdPaper: 34, obs: '' },
  { codigo: '6.03.07.526.00', lote: '20H25R1', validade: '02-28', qtdPaper: 1, obs: '' },
  { codigo: '6.03.17.541.20', lote: '260407', validade: '04-27', qtdPaper: 304, obs: '' },
  { codigo: '6.03.17.550.00', lote: '250920', validade: '09-27', qtdPaper: 453, obs: '' },
  { codigo: '6.03.17.559.20', lote: '250929', validade: '09-27', qtdPaper: 196, obs: '' },
  { codigo: '6.03.10.526.20', lote: '5302122812', validade: '01-10-26', qtdPaper: 34, obs: '' },
  { codigo: '6.03.14.577.20', lote: '425000222 CM', validade: '22-10-26', qtdPaper: 359, obs: '' },
  { codigo: '6.03.15.301.00', lote: null, validade: '10-27', qtdPaper: 42, obs: '' },
  { codigo: '6.03.17.755.00', lote: 'MA 369', validade: '06-27', qtdPaper: 686, obs: '' },
  { codigo: '6.03.17.759.20', lote: '369281', validade: '01-27', qtdPaper: 59, obs: '' },
  { codigo: '6.03.16.201.20', lote: '267', validade: '24-09-26', qtdPaper: 47, obs: '' },
  { codigo: '6.03.16.222.20', lote: '225', validade: '13-08-26', qtdPaper: 10, obs: '' },
  { codigo: '6.03.17.877.40', lote: '253', validade: '10-09-27', qtdPaper: 348, obs: '' },
  { codigo: '6.03.17.873.60', lote: '0410226/21', validade: '17-01-27', qtdPaper: 190, obs: '' },
  // parciais
  { codigo: '6.03.17.010.00', lote: '021', validade: '04-28', qtdPaper: 178, obs: 'parcial' },
  { codigo: '6.03.17.031.00', lote: '2503203268', validade: '19-03-28', qtdPaper: 67, obs: 'parcial' },
  { codigo: '6.03.04.014.00', lote: '02326', validade: '19-11-26', qtdPaper: 1429, obs: 'parcial' },
  { codigo: '6.03.17.045.20', lote: '336 122531', validade: '31-12-27', qtdPaper: 66, obs: 'parcial' },
  { codigo: '6.06.03.942.00', lote: '5052 C', validade: '08-26', qtdPaper: 10, obs: 'parcial' },
  { codigo: '6.03.17.116.60', lote: '104', validade: '04-27', qtdPaper: 4, obs: 'parcial' },
  { codigo: '6.03.08.161.00', lote: '029', validade: '05-27', qtdPaper: 1, obs: 'parcial' },
  { codigo: '6.03.15.919.20', lote: null, validade: '10-01-27', qtdPaper: 19, obs: 'parcial' },
  { codigo: '6.03.01.231.40', lote: '140426', validade: '14-04-27', qtdPaper: 5, obs: 'parcial' },
  { codigo: '6.03.10.202.20', lote: 'K25B RPP07 M', validade: '07-11-26', qtdPaper: 6, obs: 'parcial (obs tinha 20-11-26 — usamos a mais curta 07-11)' },
  { codigo: '6.03.10.209.20', lote: '120126', validade: '01-27', qtdPaper: 1091, obs: 'parcial' },
  { codigo: '6.03.04.253.00', lote: '0306 388 8', validade: '17-03-27', qtdPaper: 468, obs: 'parcial' },
  { codigo: '6.03.15.140.20', lote: '082', validade: '23-09-27', qtdPaper: 1, obs: 'parcial' },
  { codigo: '6.03.15.136.40', lote: '279', validade: '06-04-27', qtdPaper: 9, obs: 'parcial' },
  { codigo: '6.03.15.141.20', lote: '083', validade: '24-09-27', qtdPaper: 2, obs: 'parcial' },
  { codigo: '6.03.15.106.40', lote: '177-2', validade: '26-12-26', qtdPaper: 8, obs: 'parcial' },
  { codigo: '6.03.15.109.40', lote: '211', validade: '30-01-27', qtdPaper: 791, obs: 'parcial' },
  { codigo: '6.03.04.476.00', lote: '045', validade: '06-02-27', qtdPaper: 5, obs: 'parcial' },
  { codigo: '6.03.12.010.20', lote: '15027', validade: '05-02-27', qtdPaper: 16, obs: 'parcial' },
  // instantâneo — data mais curta 30/08/2026
  { codigo: '6.03.12.201.20', lote: '6.2', validade: '30-08-26', qtdPaper: 97, obs: 'parcial; data mais curta' },
  { codigo: '6.03.17.565.80', lote: '250704', validade: '10-26', qtdPaper: 119, obs: 'parcial' },
  { codigo: '6.03.16.212.20', lote: '076', validade: '17-03-27', qtdPaper: 29, obs: 'parcial' },
  { codigo: '6.03.16.215.20', lote: '293', validade: '20-10-26', qtdPaper: 45, obs: 'parcial' },
  { codigo: '6.03.16.218.20', lote: '296', validade: '23-10-26', qtdPaper: 70, obs: 'parcial' },
  { codigo: '6.03.16.220.20', lote: '261', validade: '18-09-26', qtdPaper: 33, obs: 'parcial' },
  { codigo: '6.03.16.224.20', lote: '296', validade: '23-10-26', qtdPaper: 67, obs: 'parcial' },
  { codigo: '6.03.16.225.20', lote: '268', validade: '25-09-26', qtdPaper: 73, obs: 'parcial' },
];

function qtdFaltanteRow(row) {
  const saldo = Number(row.qtd_saldo_sku) || 0;
  const comVal =
    (Number(row.qtd_nf_com_validade) || 0) + (Number(row.qtd_inv_com_validade) || 0);
  return Math.max(0, Number((saldo - comVal).toFixed(6)));
}

async function main() {
  const falt = await listarValidadeFaltante(TENANT, CD_DONO);
  const byCod = new Map();
  for (const r of falt.rows) {
    byCod.set(normCodigoKey(r.CODIGO_PRODUTO), r);
  }

  const client = await pool.connect();
  const conferidos = [];
  const pulados = [];

  try {
    await client.query('BEGIN');

    const inv = await client.query(
      `INSERT INTO "WMS_INVENTARIO" (
         "TENANT_ID", "CD_DONO", "TP_INVENTARIO", "ST_INVENTARIO", "DH_CORTE",
         "POLITICA_NAO_CONTADO", "OBSERVACAO", "SG_USER", "DH_ENCERRAMENTO"
       ) VALUES ($1, $2::integer, 'GERAL', 'ENCERRADO', CURRENT_TIMESTAMP, 'MANTER',
         $3, $4, CURRENT_TIMESTAMP)
       RETURNING "CD_INVENTARIO"`,
      [
        TENANT,
        CD_DONO,
        'Coleta validade PDF 1 (Nutriville) — só rastreio lote/validade; SEM ajuste de saldo/ledger.',
        SG,
      ]
    );
    const cdInv = inv.rows[0].CD_INVENTARIO;

    async function upsertSaldo({ cdProduto, codigo, nome, lote, validadeIso, qtd, obs, qtdPaper }) {
      if (!(qtd > 1e-9)) {
        pulados.push({ codigo, motivo: 'faltante atual = 0 (já coberto)', validade: validadeIso });
        return;
      }
      await client.query(
        `INSERT INTO "WMS_INVENTARIO_SALDO_LOTE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "LOTE", "VALIDADE", "QTD",
           "REF_CD_INVENTARIO", "REF_CD_LINHA", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4, $5::date, $6::numeric, $7::integer, NULL, $8)
         ON CONFLICT ("TENANT_ID", "CD_DONO", "CD_PRODUTO", COALESCE("LOTE", ''), COALESCE("VALIDADE", DATE '1970-01-01'))
         DO UPDATE SET
           "QTD" = EXCLUDED."QTD",
           "REF_CD_INVENTARIO" = EXCLUDED."REF_CD_INVENTARIO",
           "DH_REGISTRO" = CURRENT_TIMESTAMP,
           "SG_USER" = EXCLUDED."SG_USER"`,
        [TENANT, CD_DONO, cdProduto, lote, validadeIso, qtd, cdInv, SG]
      );
      conferidos.push({
        codigo,
        nome: nome || '',
        lote: lote || '',
        validade: validadeIso,
        qtdGravada: qtd,
        qtdPaper: qtdPaper != null ? qtdPaper : '',
        obs: obs || '',
        cdInventarioRef: cdInv,
      });
    }

    for (const item of COLETA) {
      const hit = await resolverProdutoEstoque(client, TENANT, CD_DONO, item.codigo, {});
      if (!hit || hit.cdProduto == null) {
        pulados.push({ codigo: item.codigo, motivo: 'produto não encontrado no dono Nutriville' });
        continue;
      }
      const cdProduto = Number(hit.cdProduto);
      const rowFalt = byCod.get(normCodigoKey(hit.codigo || item.codigo));
      const faltanteAtual = rowFalt ? qtdFaltanteRow(rowFalt) : null;
      const nome = (rowFalt && rowFalt.NM_PRODUTO) || hit.nome || '';

      if (item.split) {
        let restante = faltanteAtual != null ? faltanteAtual : item.split.reduce((s, p) => s + (p.qtdFix || 0), 0);
        for (const part of item.split) {
          const val = parseValidade(part.validade);
          if (!val) {
            pulados.push({ codigo: item.codigo, motivo: 'validade inválida no split: ' + part.validade });
            continue;
          }
          let qtd;
          if (part.qtdFix != null) {
            qtd = Math.min(part.qtdFix, restante);
            restante = Number((restante - qtd).toFixed(6));
          } else if (part.qtdRestante) {
            qtd = Math.max(0, restante);
            restante = 0;
          } else {
            qtd = 0;
          }
          await upsertSaldo({
            cdProduto,
            codigo: hit.codigo || item.codigo,
            nome,
            lote: normLote(part.lote),
            validadeIso: val,
            qtd,
            obs: part.obs || 'split',
            qtdPaper: part.qtdFix != null ? part.qtdFix : 'restante',
          });
        }
        continue;
      }

      const val = parseValidade(item.validade);
      if (!val) {
        pulados.push({ codigo: item.codigo, motivo: 'validade inválida: ' + item.validade });
        continue;
      }

      // Usa faltante atual (não mexe ledger); se relatório não listar, usa qtd do papel
      let qtd =
        faltanteAtual != null && faltanteAtual > 0
          ? faltanteAtual
          : Number(item.qtdPaper) || 0;
      // Se faltante atual > papel, ainda assim cobre só o faltante (rastreio do restante)
      // Se faltante < papel (saiu estoque), grava o faltante atual
      if (faltanteAtual != null && faltanteAtual <= 0) {
        pulados.push({
          codigo: item.codigo,
          motivo: 'já não há faltante no relatório atual',
          validade: val,
        });
        continue;
      }

      await upsertSaldo({
        cdProduto,
        codigo: hit.codigo || item.codigo,
        nome,
        lote: normLote(item.lote),
        validadeIso: val,
        qtd,
        obs: item.obs || '',
        qtdPaper: item.qtdPaper,
      });
    }

    await client.query('COMMIT');

    const outDir = path.join(__dirname, '../tmp/scan-validade');
    fs.mkdirSync(outDir, { recursive: true });
    const csvPath = path.join(outDir, 'conferencia-nutriville-coleta-validade.csv');
    const head = 'CODIGO;NOME;LOTE;VALIDADE;QTD_GRAVADA;QTD_PAPEL;OBS;CD_INVENTARIO_REF';
    const body = conferidos
      .map((r) =>
        [r.codigo, r.nome, r.lote, r.validade, r.qtdGravada, r.qtdPaper, r.obs, r.cdInventarioRef]
          .map((v) => {
            const s = String(v == null ? '' : v);
            return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(';')
      )
      .join('\n');
    fs.writeFileSync(csvPath, head + '\n' + body, 'utf8');

    const skipPath = path.join(outDir, 'conferencia-nutriville-pulados.csv');
    fs.writeFileSync(
      skipPath,
      'CODIGO;MOTIVO;VALIDADE\n' +
        pulados
          .map((p) => `${p.codigo};${p.motivo || ''};${p.validade || ''}`)
          .join('\n'),
      'utf8'
    );

    console.log(JSON.stringify({ cdInventarioRef: cdInv, gravados: conferidos.length, pulados: pulados.length, csvPath, skipPath }, null, 2));
    console.log('--- GRAVADOS ---');
    for (const r of conferidos) {
      console.log(
        `${r.codigo} | ${r.validade} | lote=${r.lote || '—'} | qtd=${r.qtdGravada} | paper=${r.qtdPaper} | ${r.obs}`
      );
    }
    console.log('--- PULADOS ---');
    for (const p of pulados) console.log(`${p.codigo} | ${p.motivo}`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
