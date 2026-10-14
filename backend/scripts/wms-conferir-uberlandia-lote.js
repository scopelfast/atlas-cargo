/**
 * Conferência em lote — NF Uberlândia (10 NF só importadas) × planilha RELAÇÃO.
 * Só Salvar conferência (não encerrar).
 *
 * Uso: node scripts/wms-conferir-uberlandia-lote.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');

const TENANT = 'default';
const CD_DONO = 2;
const DT_RECEBIMENTO = '2026-07-06';
const NM_CONFERENTE = 'Uberlândia / planilha LISTA CONFERENCIA NUTRI';
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
  // Excel epoch 1899-12-30 (serial 1 = 1899-12-31); JS Date UTC
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diasAte(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = Date.UTC(y, m - 1, d);
  const hoje = new Date();
  const h = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.floor((alvo - h) / 86400000);
}

function carregarRelacao() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['RELAÇÃO'], { header: 1, defval: '' });
  /** @type {Map<string, { codigo: string, nome: string, validade: string|null, total: number, notas: number }>} */
  const byDig = new Map();
  const byCod = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cod = String(r[0] || '').trim();
    if (!cod || cod === 'CODIGO' || cod === 'Soma de QTD' || !cod.includes('.')) continue;
    const nome = String(r[1] || '').trim();
    const validade = excelSerialToIso(r[2]);
    const total = Number(r[3]) || 0;
    const notas = Number(r[4]) || 0;
    const rec = { codigo: cod, nome, validade, total, notas };
    byCod.set(cod.toLowerCase(), rec);
    const d = digitos(cod);
    if (d) {
      // se repetir código por dígitos, soma Total e pega validade mais curta
      const prev = byDig.get(d);
      if (!prev) byDig.set(d, { ...rec, total, notas });
      else {
        prev.total += total;
        prev.notas += notas;
        if (validade && (!prev.validade || validade < prev.validade)) prev.validade = validade;
      }
    }
  }

  // LISTA CONFERENCIA: se houver várias validades por código, reforça a mais curta
  const lista = XLSX.utils.sheet_to_json(wb.Sheets['LISTA CONFERENCIA'], { defval: '' });
  for (const row of lista) {
    const cod = String(row.CODIGO || '').trim();
    if (!cod) continue;
    const qtd = Number(row.QTD) || 0;
    const val = excelSerialToIso(row.VLIDADE);
    if (!val) continue;
    const d = digitos(cod);
    const hit = byDig.get(d) || byCod.get(cod.toLowerCase());
    if (hit) {
      if (!hit.validade || val < hit.validade) hit.validade = val;
    } else if (qtd > 0) {
      const rec = { codigo: cod, nome: String(row.NOME || ''), validade: val, total: qtd, notas: 0 };
      byCod.set(cod.toLowerCase(), rec);
      if (d) byDig.set(d, rec);
    }
  }

  return { byDig, byCod };
}

function qtdLinhaNf(ln) {
  const q = Number(String(ln.qCom ?? ln.quantidade ?? '').replace(',', '.'));
  return Number.isFinite(q) && q > 0 ? q : 0;
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('Planilha não encontrada:', XLSX_PATH);
    process.exit(1);
  }
  const { byDig, byCod } = carregarRelacao();
  console.log('RELAÇÃO produtos:', byDig.size, 'DRY=', DRY);

  // saldo disponível por código (dígitos) = Total da planilha
  const saldoPlanilha = new Map();
  for (const [d, rec] of byDig.entries()) {
    saldoPlanilha.set(d, Number(rec.total) || 0);
  }

  const rDocs = await pool.query(
    `SELECT "CD_NFE", "CHAVE_NFE", "NUMERO_NF", "CD_DONO", "ST_RECEBIMENTO",
            "LINHAS_JSON", "CONFERENCIA_JSON", "DT_RECEBIMENTO"
       FROM "WMS_NFE_ENTRADA"
      WHERE "TENANT_ID" = $1
        AND "CHAVE_NFE" = ANY($2::text[])
      ORDER BY "NUMERO_NF"::integer NULLS LAST, "CD_NFE"`,
    [TENANT, CHAVES]
  );
  console.log('NFs encontradas:', rDocs.rows.length);
  if (rDocs.rows.length !== 10) {
    console.warn('Esperado 10 NF; chaves faltando:', CHAVES.filter((c) => !rDocs.rows.some((r) => r.CHAVE_NFE === c)));
  }

  const avisos = [];
  const curtas = [];
  const semPlanilha = [];
  const resultados = [];

  // Ordenar NF por número crescente (mais antigas primeiro)
  const docs = [...rDocs.rows].sort((a, b) => Number(a.NUMERO_NF) - Number(b.NUMERO_NF));

  for (const doc of docs) {
    const linhas = Array.isArray(doc.LINHAS_JSON) ? doc.LINHAS_JSON : [];
    const confAntiga = Array.isArray(doc.CONFERENCIA_JSON) ? doc.CONFERENCIA_JSON : [];
    const confByN = new Map(confAntiga.map((c) => [String(c.nItem), c]));
    const payload = [];

    for (const ln of linhas) {
      const nItem = String(ln.nItem ?? '').trim();
      if (!nItem) continue;
      const cProd = String(ln.cProd ?? '').trim();
      const qNf = qtdLinhaNf(ln);
      const digCprod = digitos(cProd);

      // código dono: conferência anterior → de-para via resolver → cProd
      let codigoTentativa =
        (confByN.get(nItem) && confByN.get(nItem).codigoProduto) ||
        cProd;

      const hitEstoque = await resolverProdutoEstoque(pool, TENANT, CD_DONO, codigoTentativa, {
        codigoExterno: cProd,
      });
      const codigoProduto = hitEstoque ? hitEstoque.codigoEstoque : String(codigoTentativa).trim();
      const cdProduto = hitEstoque ? hitEstoque.cdProduto : null;
      const digProd = digitos(codigoProduto) || digCprod;

      const plan = byDig.get(digProd) || byCod.get(String(codigoProduto).toLowerCase());
      let qtdRecebida = 0;
      let validade = null;

      if (plan) {
        const saldo = saldoPlanilha.get(digProd) ?? 0;
        qtdRecebida = Math.min(qNf, Math.max(0, saldo));
        // arredonda para evitar float lixo
        qtdRecebida = Number(qtdRecebida.toFixed(6));
        saldoPlanilha.set(digProd, Number((saldo - qtdRecebida).toFixed(6)));
        validade = plan.validade || null;
      } else {
        semPlanilha.push({
          nf: doc.NUMERO_NF,
          nItem,
          cProd,
          codigoProduto,
          qNf,
          xProd: ln.xProd,
        });
        // sem planilha: não recebe (qtd 0) — não inventa
        qtdRecebida = 0;
      }

      if (qtdRecebida > qNf + 1e-9) {
        avisos.push(`NF ${doc.NUMERO_NF} item ${nItem}: qtd ${qtdRecebida} > NF ${qNf}`);
        qtdRecebida = qNf;
      }

      const fator = 1;
      const dias = validade ? diasAte(validade) : null;
      if (validade && dias != null && dias < DIAS_MIN && qtdRecebida > 0) {
        curtas.push({
          nf: doc.NUMERO_NF,
          nItem,
          codigoProduto,
          validade,
          dias,
          qtdRecebida,
        });
      }

      payload.push({
        nItem,
        cdProduto,
        codigoExterno: cProd || null,
        codigoProduto,
        fatorConversao: fator,
        qtdConvertida: Number((qtdRecebida * fator).toFixed(6)),
        lote: null,
        validade: qtdRecebida > 0 ? validade : null,
        qtdRecebida,
        observacao: null,
      });
    }

    const conferidos = payload.filter((p) => (Number(p.qtdRecebida) || 0) > 0).length;
    const somaRec = payload.reduce((s, p) => s + (Number(p.qtdRecebida) || 0), 0);
    const somaNf = payload.reduce((s, p) => {
      const ln = linhas.find((x) => String(x.nItem) === String(p.nItem));
      return s + qtdLinhaNf(ln || {});
    }, 0);

    resultados.push({
      cdNfe: doc.CD_NFE,
      numero: doc.NUMERO_NF,
      chave: doc.CHAVE_NFE,
      st: doc.ST_RECEBIMENTO,
      cdDonoAtual: doc.CD_DONO,
      itens: payload.length,
      conferidos,
      somaRec,
      somaNf,
      payload,
    });
  }

  // sobras na planilha (Total não alocado nestas NF)
  const sobras = [];
  for (const [d, saldo] of saldoPlanilha.entries()) {
    if (saldo > 1e-9) {
      const rec = byDig.get(d);
      sobras.push({ codigo: rec?.codigo || d, sobra: saldo, totalPlanilha: rec?.total });
    }
  }

  console.log('\n=== RESUMO POR NF ===');
  for (const r of resultados) {
    console.log(
      `NF ${r.numero} CD_NFE=${r.cdNfe} donoAtual=${r.cdDonoAtual} itens=${r.itens} comQtd=${r.conferidos} rec=${r.somaRec} nf=${r.somaNf}`
    );
  }
  console.log('\nItens NF sem linha na planilha:', semPlanilha.length);
  semPlanilha.slice(0, 30).forEach((x) => console.log(' ', JSON.stringify(x)));
  console.log('\nValidades < 90 dias (ainda serão gravadas; Encerrar exigirá liberação):', curtas.length);
  curtas.slice(0, 40).forEach((x) => console.log(' ', JSON.stringify(x)));
  console.log('\nSobra planilha não alocada nestas 10 NF:', sobras.length);
  sobras.slice(0, 20).forEach((x) => console.log(' ', JSON.stringify(x)));

  if (DRY) {
    console.log('\n[DRY-RUN] nada gravado.');
    await pool.end();
    return;
  }

  for (const r of resultados) {
    // corrige dono se necessário + grava conferência
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (Number(r.cdDonoAtual) !== CD_DONO) {
        await client.query(
          `UPDATE "WMS_NFE_ENTRADA" SET "CD_DONO" = $2::integer WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $3`,
          [r.cdNfe, CD_DONO, TENANT]
        );
      }
      const st = String(r.st || '').toUpperCase();
      if (st === 'ENCERRADA') {
        console.warn('Pulando NF encerrada', r.numero);
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `UPDATE "WMS_NFE_ENTRADA"
            SET "CONFERENCIA_JSON" = $3::jsonb,
                "FG_CONFERIDO" = 'S',
                "DH_CONFERENCIA" = CURRENT_TIMESTAMP,
                "SG_USER_CONFERENCIA" = $4::text,
                "NM_CONFERENTE" = $5::text,
                "DT_RECEBIMENTO" = $6::date
          WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
        [r.cdNfe, TENANT, JSON.stringify(r.payload), 'SCRIPT_UBERLANDIA', NM_CONFERENTE, DT_RECEBIMENTO]
      );
      await client.query('COMMIT');
      console.log('OK gravado NF', r.numero, 'CD_NFE', r.cdNfe);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      console.error('ERRO NF', r.numero, e.message);
    } finally {
      client.release();
    }
  }

  const outPath = path.join(__dirname, '_tmp-uberlandia-conferencia-resultado.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ geradoEm: new Date().toISOString(), resultados, semPlanilha, curtas, sobras }, null, 2)
  );
  console.log('Relatório:', outPath);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
