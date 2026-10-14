/**
 * Corrige validades faltantes (qtd>0) e ENCERRA as 10 NF Uberlândia.
 * Uso: node scripts/wms-encerrar-uberlandia-lote.js [--dry-run]
 */
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');

const TENANT = 'default';
const CD_DONOS = 2;
const SG = 'SCRIPT_UBERLANDIA';
const NM = 'Uberlândia / planilha LISTA CONFERENCIA NUTRI';
const DT_REC = '2026-07-06';
const DIAS_MIN = 90;
const DRY = process.argv.includes('--dry-run');

const CHAVES = [
  '31260708742760005064550010000002571000008281',
  '31260708742760005064550010000002561000008276',
  '31260708742760005064550010000002551000008260',
  '31260708742760005064550010000002541000008255',
  '31260708742760005064550010000002531000008240',
  '31260708742760005064550010000002521000008234',
  '31260708742760005064550010000002511000008229',
  '31260708742760005064550010000002481000008177',
  '31260708742760005064550010000002471000008161',
  '31260708742760005064550010000002461000008156',
];

const XLSX_PATH = path.join(
  process.env.USERPROFILE || '',
  'OneDrive',
  'Área de Trabalho',
  'LISTA CONFERENCIA NUTRI - UBERLANDIA.xlsx'
);

function digitos(s) {
  return String(s || '').replace(/\D/g, '');
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

/** Aceita serial Excel ou texto DD/MM/AA(AA). Corrige 31/11 → 30/11. */
function parseValidadeFlex(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return excelSerialToIso(raw);
  const s = String(raw).trim();
  const asNum = Number(s.replace(',', '.'));
  if (Number.isFinite(asNum) && asNum >= 20000) return excelSerialToIso(asNum);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  let dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12) return null;
  const maxDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (dd > maxDay) dd = maxDay;
  if (dd < 1) return null;
  return (
    yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0')
  );
}

function diasAte(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = Date.UTC(y, m - 1, d);
  const hoje = new Date();
  const h = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.floor((alvo - h) / 86400000);
}

function carregarValidadesPlanilha() {
  const wb = XLSX.readFile(XLSX_PATH);
  const byDig = new Map();
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['RELAÇÃO'], { header: 1, defval: '' });
  for (const r of rows) {
    const cod = String(r[0] || '').trim();
    if (!cod || !cod.includes('.')) continue;
    const val = parseValidadeFlex(r[2]);
    const d = digitos(cod);
    if (d && val) {
      const prev = byDig.get(d);
      if (!prev || val < prev) byDig.set(d, val);
    }
  }
  const lista = XLSX.utils.sheet_to_json(wb.Sheets['LISTA CONFERENCIA'], { defval: '' });
  for (const row of lista) {
    const cod = String(row.CODIGO || '').trim();
    const val = parseValidadeFlex(row.VLIDADE);
    const d = digitos(cod);
    if (d && val) {
      const prev = byDig.get(d);
      if (!prev || val < prev) byDig.set(d, val);
    }
  }
  return byDig;
}

async function produtoControlaValidade(cdProduto) {
  if (!cdProduto) return false;
  const r = await pool.query(
    `SELECT "FG_CONTROLA_VALIDADE" FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"=$1 AND "CD_PRODUTO"=$2::integer`,
    [TENANT, cdProduto]
  );
  return String(r.rows[0]?.FG_CONTROLA_VALIDADE || '').toUpperCase() === 'S';
}

async function main() {
  const valByDig = carregarValidadesPlanilha();
  const docs = await pool.query(
    `SELECT "CD_NFE", "NUMERO_NF", "CHAVE_NFE", "ST_RECEBIMENTO", "CONFERENCIA_JSON", "CD_DONO"
       FROM "WMS_NFE_ENTRADA"
      WHERE "TENANT_ID"=$1 AND "CHAVE_NFE"=ANY($2::text[])
      ORDER BY "NUMERO_NF"::integer`,
    [TENANT, CHAVES]
  );
  console.log('NFs:', docs.rows.length, 'DRY=', DRY);

  for (const doc of docs.rows) {
    const st = String(doc.ST_RECEBIMENTO || '').toUpperCase();
    if (st === 'ENCERRADA') {
      console.log('Já encerrada NF', doc.NUMERO_NF);
      continue;
    }
    let conf = Array.isArray(doc.CONFERENCIA_JSON) ? doc.CONFERENCIA_JSON : [];
    if (typeof doc.CONFERENCIA_JSON === 'string') {
      try {
        conf = JSON.parse(doc.CONFERENCIA_JSON);
      } catch (_) {
        conf = [];
      }
    }

    const falhasMin = [];
    let alterou = false;
    for (const p of conf) {
      const qtd = Number(p.qtdRecebida);
      const dig = digitos(p.codigoProduto);
      if (Number.isFinite(qtd) && qtd > 0) {
        if (!String(p.validade || '').trim()) {
          const vPlan = valByDig.get(dig);
          const ctrl = await produtoControlaValidade(p.cdProduto);
          if (vPlan) {
            p.validade = vPlan;
            alterou = true;
            console.log('  +validade NF', doc.NUMERO_NF, 'item', p.nItem, p.codigoProduto, vPlan);
          } else if (ctrl) {
            console.warn('  SEM validade planilha NF', doc.NUMERO_NF, 'item', p.nItem, p.codigoProduto);
          }
        }
        const dias = diasAte(p.validade);
        if (p.validade && dias != null && dias < DIAS_MIN) {
          falhasMin.push({
            nItem: String(p.nItem),
            validade: p.validade,
            mensagem: `Item ${p.nItem}: ${dias} dia(s) < ${DIAS_MIN}`,
          });
        }
      }
    }

    if (DRY) {
      console.log(
        'DRY NF',
        doc.NUMERO_NF,
        'alterouVal=',
        alterou,
        'falhasMin=',
        falhasMin.length,
        'itensComQtd=',
        conf.filter((x) => Number(x.qtdRecebida) > 0).length
      );
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE "WMS_NFE_ENTRADA"
            SET "CONFERENCIA_JSON"=$3::jsonb,
                "FG_CONFERIDO"='S',
                "NM_CONFERENTE"=$4::text,
                "DT_RECEBIMENTO"=$5::date,
                "SG_USER_CONFERENCIA"=$6::text,
                "DH_CONFERENCIA"=COALESCE("DH_CONFERENCIA", CURRENT_TIMESTAMP)
          WHERE "CD_NFE"=$1::integer AND "TENANT_ID"=$2`,
        [doc.CD_NFE, TENANT, JSON.stringify(conf), NM, DT_REC, SG]
      );

      // Liberação de política (se tabela existir)
      if (falhasMin.length) {
        try {
          await client.query(
            `INSERT INTO "WMS_RECEBIMENTO_LIBERACAO_VALIDADE"
              ("TENANT_ID","CD_NFE","CD_DONO","TP_ACAO","NU_DIAS_MIN_POLITICA","FALHAS_JSON","JUSTIFICATIVA",
               "SG_USER_OPERADOR","AUTORIZADO_LOGIN","AUTORIZADO_NOME")
             VALUES ($1,$2::integer,$3::integer,'ENCERRAR',$4::integer,$5::jsonb,$6::text,$7::text,$7::text,$8::text)`,
            [
              TENANT,
              doc.CD_NFE,
              Number(doc.CD_DONO) || CD_DONOS,
              DIAS_MIN,
              JSON.stringify(falhasMin),
              'Encerramento lote Uberlândia — validades conforme planilha física (algumas < 90 dias / vencidas). Liberação operacional SCRIPT_UBERLANDIA.',
              SG,
              'Cleverson Scopel (script lote)',
            ]
          );
        } catch (eLib) {
          if (eLib.code !== '42P01' && eLib.code !== '42703') {
            console.warn('  liberacao skip/warn:', eLib.message);
          }
        }
      }

      const r = await client.query(
        `UPDATE "WMS_NFE_ENTRADA"
            SET "ST_RECEBIMENTO"='ENCERRADA',
                "DH_ENCERRAMENTO"=CURRENT_TIMESTAMP,
                "DH_PRIMEIRO_ENCERRAMENTO"=COALESCE("DH_PRIMEIRO_ENCERRAMENTO", CURRENT_TIMESTAMP),
                "SG_USER_ENCERRAMENTO"=$3::text
          WHERE "CD_NFE"=$1::integer AND "TENANT_ID"=$2
            AND COALESCE("ST_RECEBIMENTO",'ABERTA') <> 'ENCERRADA'
          RETURNING "CD_NFE","NUMERO_NF","ST_RECEBIMENTO"`,
        [doc.CD_NFE, TENANT, SG]
      );
      await client.query('COMMIT');
      if (r.rows.length) {
        console.log('ENCERRADA NF', doc.NUMERO_NF, 'CD_NFE', doc.CD_NFE, 'falhasMin', falhasMin.length);
      } else {
        console.log('Sem update (já encerrada?) NF', doc.NUMERO_NF);
      }
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      console.error('ERRO NF', doc.NUMERO_NF, e.message);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
