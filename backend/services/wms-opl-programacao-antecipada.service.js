'use strict';

const { pool } = require('../config/db');
const {
  extrairDataEntregaPedidoOpl,
  digitosCodigoOl,
  expandirChavesDigitosCodigoOl,
  classificarConservacaoDetalhe,
} = require('./wms-opl-relatorio-romaneio.service');
const { carregarNrRotaPorPedidosOpl } = require('./cadastro-endereco-entrega-match.service');
const { carregarMapaProdutosDonoPorDigitos } = require('./wms-produto-mapa-codigo.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function round3(n) {
  return Number((Number(n) || 0).toFixed(3));
}

function round4(n) {
  return Number((Number(n) || 0).toFixed(4));
}

/** DD/MM/AAAA → AAAA-MM-DD (comparação). */
function dataEntregaParaIso(br) {
  const s = String(br || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseFiltroData(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return dataEntregaParaIso(s);
}

function chaveDestinatario(p) {
  const cod = (p.COD_DESTINATARIO || '').trim();
  const cnpj = (p.CNPJ_DEST || '').replace(/\D/g, '');
  if (cod) return `C:${cod}`;
  if (cnpj) return `J:${cnpj}`;
  return `R:${(p.RAZ_SOC_DEST || '').trim()}|${(p.CIDADE_ENTREGA || '').trim()}|${(p.UF_ENTREGA || '').trim()}`;
}

/** Chaves para cruzar código OL (mascarado ou só dígitos) com WMS_DEPARA_PRODUTO. */
function deparaLookupKeysFromCodigoOl(cod) {
  const raw = String(cod != null ? cod : '').trim();
  if (!raw) return [];
  const keys = new Set([raw.toLowerCase()]);
  const dig = digitosCodigoOl(raw);
  if (dig) keys.add(dig.toLowerCase());
  if (/^\d+$/.test(raw)) keys.add(String(parseInt(raw, 10)).toLowerCase());
  if (dig && /^\d+$/.test(dig)) keys.add(String(parseInt(dig, 10)).toLowerCase());
  return [...keys];
}

function buildDeparaHitMap(rows) {
  const by = new Map();
  for (const d of rows || []) {
    const ex = String(d.CODIGO_EXTERNO ?? d.codigo_externo ?? '').trim();
    if (!ex) continue;
    const k = ex.toLowerCase();
    by.set(k, d);
    const dig = digitosCodigoOl(ex);
    if (dig) by.set(dig.toLowerCase(), d);
    if (/^\d+$/.test(ex)) by.set(String(parseInt(ex, 10)).toLowerCase(), d);
  }
  return by;
}

function hitDeparaFromMap(byMap, codOl) {
  for (const k of deparaLookupKeysFromCodigoOl(codOl)) {
    if (byMap.has(k)) return byMap.get(k);
  }
  return null;
}

/**
 * Mapa código OL → cadastro WMS (PESO_KG, NCM, etc.) com de-para, igual à cobertura OPL.
 */
async function carregarMapasPesoOpl(tenantId, cdDono, codigosOlUnicos) {
  const lista = [...new Set((codigosOlUnicos || []).map((c) => String(c || '').trim()).filter(Boolean))];
  const deparaKeys = new Set();
  const digitosList = new Set();
  for (const c of lista) {
    for (const k of deparaLookupKeysFromCodigoOl(c)) deparaKeys.add(k);
    const d = digitosCodigoOl(c);
    if (d) digitosList.add(d);
  }

  let depara = new Map();
  const keyArr = [...deparaKeys];
  if (keyArr.length && Number.isFinite(cdDono)) {
    try {
      const rDep = await pool.query(
        `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO"
           FROM "WMS_DEPARA_PRODUTO"
          WHERE "TENANT_ID" = $1
            AND "CD_DONO" = $2::integer
            AND COALESCE("FGACTIVE", 'S') = 'S'
            AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
        [tenantId, cdDono, keyArr]
      );
      depara = buildDeparaHitMap(rDep.rows || []);
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }

  const internosTexto = new Set();
  for (const c of lista) {
    const hit = hitDeparaFromMap(depara, c);
    if (!hit) continue;
    const interno = String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim();
    if (!interno) continue;
    internosTexto.add(interno.toLowerCase());
    for (const k of deparaLookupKeysFromCodigoOl(interno)) deparaKeys.add(k);
    const di = digitosCodigoOl(interno);
    if (di) digitosList.add(di);
  }

  const porDigitos = await carregarMapaProdutosDonoPorDigitos(tenantId, cdDono, [...digitosList]);
  const porCodigoLower = {};
  const intArr = [...internosTexto];
  if (intArr.length && Number.isFinite(cdDono)) {
    try {
      const rPr = await pool.query(
        `SELECT DISTINCT ON (LOWER(TRIM(pr."CODIGO")))
                LOWER(TRIM(pr."CODIGO")) AS ck,
                pr."CD_PRODUTO",
                pr."CODIGO",
                pr."TIPO_ARMAZENAGEM",
                pr."NCM",
                pr."PESO_KG",
                cat."NOME" AS "NM_CATEGORIA",
                g."NOME" AS "NM_GRUPO"
           FROM "WMS_PRODUTO_DONO" pr
      LEFT JOIN "WMS_CATEGORIA_PRODUTO" cat
             ON cat."CD_CATEGORIA" = pr."CD_CATEGORIA" AND cat."TENANT_ID" = pr."TENANT_ID"
      LEFT JOIN "WMS_GRUPO_PRODUTO" g
             ON g."CD_GRUPO" = cat."CD_GRUPO" AND g."TENANT_ID" = cat."TENANT_ID"
          WHERE pr."TENANT_ID" = $1
            AND pr."CD_DONO" = $2::integer
            AND COALESCE(pr."FGACTIVE", 'S') = 'S'
            AND LOWER(TRIM(pr."CODIGO")) = ANY($3::text[])
          ORDER BY LOWER(TRIM(pr."CODIGO")), pr."CD_PRODUTO"`,
        [tenantId, cdDono, intArr]
      );
      for (const row of rPr.rows || []) {
        const ck = String(row.ck || '').trim();
        if (!ck) continue;
        porCodigoLower[ck] = {
          TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM,
          NCM: row.NCM,
          NM_CATEGORIA: row.NM_CATEGORIA,
          NM_GRUPO: row.NM_GRUPO,
          PESO_KG: row.PESO_KG != null ? Number(row.PESO_KG) : null,
          CD_PRODUTO: row.CD_PRODUTO != null ? Number(row.CD_PRODUTO) : null,
          CODIGO: row.CODIGO,
        };
        const di = digitosCodigoOl(row.CODIGO);
        if (di && !porDigitos[di]) porDigitos[di] = porCodigoLower[ck];
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  const operacional = await carregarMapaOperacionalOpl(tenantId, cdDono, lista);
  return { porDigitos, porCodigoLower, depara, operacional };
}

/** Catálogo OL importado: CDPRODUTO (espelho) → código estoque + fator (VRFATOCONV). */
async function carregarMapaOperacionalOpl(tenantId, cdDono, codigosOlUnicos) {
  const keys = new Set();
  for (const c of codigosOlUnicos || []) {
    for (const k of deparaLookupKeysFromCodigoOl(c)) keys.add(k);
  }
  const keyArr = [...keys];
  const by = new Map();
  if (!keyArr.length || !Number.isFinite(cdDono)) return by;
  try {
    const r = await pool.query(
      `SELECT o."CODIGO_OPERACIONAL", o."CODIGO_ESTOQUE", o."FATOR_CONVERSAO", o."CD_PRODUTO"
         FROM "WMS_PRODUTO_OPERACIONAL" o
        WHERE o."TENANT_ID" = $1
          AND o."CD_DONO" = $2::integer
          AND COALESCE(o."FGACTIVE", 'S') = 'S'
          AND LOWER(TRIM(o."CODIGO_OPERACIONAL")) = ANY($3::text[])`,
      [tenantId, cdDono, keyArr]
    );
    for (const row of r.rows || []) {
      const codOp = String(row.CODIGO_OPERACIONAL || '').trim();
      if (!codOp) continue;
      const payload = {
        CODIGO_ESTOQUE: String(row.CODIGO_ESTOQUE || '').trim(),
        FATOR_CONVERSAO: Number(row.FATOR_CONVERSAO) > 0 ? Number(row.FATOR_CONVERSAO) : 1,
        CD_PRODUTO: row.CD_PRODUTO != null ? Number(row.CD_PRODUTO) : null,
      };
      for (const k of deparaLookupKeysFromCodigoOl(codOp)) by.set(k, payload);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return by;
}

function hitOperacionalFromMap(byMap, codOl) {
  for (const k of deparaLookupKeysFromCodigoOl(codOl)) {
    if (byMap.has(k)) return byMap.get(k);
  }
  return null;
}

function lookupPorDigitos(porDigitos, dkey) {
  if (!porDigitos || !dkey) return null;
  const pick = (cad) => (cad && typeof cad === 'object' ? cad : null);
  let cad = pick(porDigitos[dkey]);
  if (cad) return cad;
  for (const v of expandirChavesDigitosCodigoOl(dkey)) {
    cad = pick(porDigitos[v]);
    if (cad) return cad;
  }
  return null;
}

function resolveCadProdutoOpl(codOl, mapas) {
  if (!mapas || !codOl) return null;
  const dkey = digitosCodigoOl(codOl);
  if (!dkey) return null;

  const pick = (cad) => (cad && typeof cad === 'object' ? cad : null);
  const withFator = (cad, fator) => {
    if (!cad) return null;
    const f = Number(fator);
    return {
      ...cad,
      _fatorOpl: Number.isFinite(f) && f > 0 ? f : 1,
    };
  };

  let cad = lookupPorDigitos(mapas.porDigitos, dkey);
  if (cad && cad.PESO_KG != null) return withFator(cad, 1);

  const op = hitOperacionalFromMap(mapas.operacional || new Map(), codOl);
  if (op && op.CODIGO_ESTOQUE) {
    const viaTexto = pick((mapas.porCodigoLower || {})[op.CODIGO_ESTOQUE.toLowerCase()]);
    if (viaTexto) return withFator(viaTexto, op.FATOR_CONVERSAO);
    const di = digitosCodigoOl(op.CODIGO_ESTOQUE);
    const viaDig = di ? lookupPorDigitos(mapas.porDigitos, di) : null;
    if (viaDig) return withFator(viaDig, op.FATOR_CONVERSAO);
  }

  const hit = hitDeparaFromMap(mapas.depara, codOl);
  if (hit) {
    const interno = String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim();
    const fDep = Number(hit.FATOR_CONVERSAO ?? hit.fator_conversao);
    if (interno) {
      const viaTexto = pick((mapas.porCodigoLower || {})[interno.toLowerCase()]);
      if (viaTexto && (viaTexto.PESO_KG != null || !cad)) cad = viaTexto;
      const di = digitosCodigoOl(interno);
      if (di) {
        const viaDep = lookupPorDigitos(mapas.porDigitos, di);
        if (viaDep && (viaDep.PESO_KG != null || !cad)) cad = viaDep;
      }
    }
    if (cad) return withFator(cad, fDep);
  }

  return cad ? withFator(cad, 1) : null;
}

const REFERENCIA_VEICULOS = [
  { id: 'vuc', rotulo: 'VUC / 3-4', kgMax: 3500, frio: false },
  { id: 'toco', rotulo: 'Toco (seco)', kgMax: 8000, frio: false },
  { id: 'truck', rotulo: 'Truck (seco)', kgMax: 14000, frio: false },
  { id: 'carreta', rotulo: 'Carreta (seco)', kgMax: 25000, frio: false },
  { id: 'bau_frio', rotulo: 'Baú refrigerado', kgMax: 12000, frio: true },
];

function criarPendenciaPesoMap() {
  return new Map();
}

function registrarPendenciaPeso(map, ctx) {
  const { codOl, descricao, motivo, cdDono, nmDono, cad, qtd, operacional } = ctx || {};
  if (!motivo || !codOl || qtd <= 0) return;
  const key = `${cdDono || 0}|${String(codOl).trim()}|${motivo}`;
  if (!map.has(key)) {
    map.set(key, {
      COD_PRODUTO_OL: String(codOl).trim(),
      DESCRICAO: String(descricao || '').trim(),
      motivo,
      CD_DONO: cdDono,
      NM_DONO: nmDono || '',
      CD_PRODUTO: cad?.CD_PRODUTO ?? null,
      CODIGO: cad?.CODIGO ?? null,
      codigoInternoSugerido: operacional?.CODIGO_ESTOQUE || null,
      fatorSugerido: operacional?.FATOR_CONVERSAO ?? null,
      qtdPedida: 0,
      linhas: 0,
    });
  }
  const p = map.get(key);
  p.qtdPedida += qtd;
  p.linhas += 1;
}

function serializarPendenciasPeso(map) {
  return [...(map || new Map()).values()]
    .sort((a, b) => {
      const q = (b.qtdPedida || 0) - (a.qtdPedida || 0);
      if (q !== 0) return q;
      return String(a.COD_PRODUTO_OL).localeCompare(String(b.COD_PRODUTO_OL), 'pt-BR');
    })
    .map((p) => ({
      ...p,
      qtdPedida: round4(p.qtdPedida),
    }));
}

function criarTotaisVazio() {
  return {
    pesoKg: 0,
    pesoKgSeco: 0,
    pesoKgFrio: 0,
    unidades: 0,
    qtdLinhas: 0,
    linhasComPeso: 0,
    linhasSemPeso: 0,
    linhasSemCadastro: 0,
    qtdPedidos: 0,
    qtdParadas: 0,
    qtdEspelhos: 0,
  };
}

function somarTotais(acc, add) {
  acc.pesoKg += add.pesoKg || 0;
  acc.pesoKgSeco += add.pesoKgSeco || 0;
  acc.pesoKgFrio += add.pesoKgFrio || 0;
  acc.unidades += add.unidades || 0;
  acc.qtdLinhas += add.qtdLinhas || 0;
  acc.linhasComPeso += add.linhasComPeso || 0;
  acc.linhasSemPeso += add.linhasSemPeso || 0;
  acc.linhasSemCadastro += add.linhasSemCadastro || 0;
}

function finalizarTotais(t) {
  t.pesoKg = round3(t.pesoKg);
  t.pesoKgSeco = round3(t.pesoKgSeco);
  t.pesoKgFrio = round3(t.pesoKgFrio);
  t.unidades = round4(t.unidades);
  t.pctCoberturaPeso =
    t.qtdLinhas > 0 ? Math.round((100 * t.linhasComPeso) / t.qtdLinhas) : 100;
  t.pctCoberturaCadastro =
    t.qtdLinhas > 0
      ? Math.round((100 * (t.qtdLinhas - (t.linhasSemCadastro || 0))) / t.qtdLinhas)
      : 100;
  return t;
}

function sugerirVeiculos(totais) {
  const pesoKg = Number(totais.pesoKg) || 0;
  const pesoKgSeco = Number(totais.pesoKgSeco) || 0;
  const pesoKgFrio = Number(totais.pesoKgFrio) || 0;
  const alertas = [];
  const sugestoes = [];

  if (pesoKgFrio > 0 && pesoKgSeco > 0) {
    alertas.push(
      'Carga mista (seco + frio): avalie baú refrigerado para frios e veículo seco separado, ou rota dedicada.'
    );
  }
  if (pesoKg <= 0) {
    return { sugestoes, alertas: ['Sem peso estimado — revise PESO_KG no cadastro WMS.'] };
  }

  const pickSeco = (kg) => {
    const opcoes = REFERENCIA_VEICULOS.filter((v) => !v.frio).sort((a, b) => a.kgMax - b.kgMax);
    const fit = opcoes.find((v) => kg <= v.kgMax);
    const v = fit || opcoes[opcoes.length - 1];
    return {
      tipo: 'seco',
      rotulo: v.rotulo,
      pesoKg: round3(kg),
      kgMax: v.kgMax,
      cabe: kg <= v.kgMax,
      excedenteKg: kg > v.kgMax ? round3(kg - v.kgMax) : 0,
    };
  };

  const pickFrio = (kg) => {
    const opcoes = REFERENCIA_VEICULOS.filter((v) => v.frio).sort((a, b) => a.kgMax - b.kgMax);
    const fit = opcoes.find((v) => kg <= v.kgMax);
    const v = fit || opcoes[opcoes.length - 1];
    return {
      tipo: 'frio',
      rotulo: v.rotulo,
      pesoKg: round3(kg),
      kgMax: v.kgMax,
      cabe: kg <= v.kgMax,
      excedenteKg: kg > v.kgMax ? round3(kg - v.kgMax) : 0,
    };
  };

  if (pesoKgFrio > 0) sugestoes.push(pickFrio(pesoKgFrio));
  const seco = pesoKgSeco > 0 ? pesoKgSeco : pesoKgFrio > 0 ? 0 : pesoKg;
  if (seco > 0) sugestoes.push(pickSeco(seco));

  for (const s of sugestoes) {
    if (!s.cabe) {
      alertas.push(
        `${s.tipo === 'frio' ? 'Frio' : 'Seco'}: ~${s.pesoKg} kg excede ${s.rotulo} (${s.kgMax} kg) — considere dividir ou veículo maior.`
      );
    }
  }

  return { sugestoes, alertas };
}

function pesoItemOpl(qtd, cad) {
  if (qtd <= 0) return { peso: 0, semPeso: false };
  if (!cad || cad.PESO_KG == null) return { peso: 0, semPeso: true };
  const w = Number(cad.PESO_KG);
  if (!Number.isFinite(w) || w <= 0) return { peso: 0, semPeso: true };
  const f = Number(cad._fatorOpl);
  const fator = Number.isFinite(f) && f > 0 ? f : 1;
  return { peso: qtd * w * fator, semPeso: false };
}

async function carregarDonosMap(tenantId) {
  const r = await pool.query(
    `SELECT "CD_DONO", "NOME", "CODIGO" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1`,
    [tenantId]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    m.set(Number(row.CD_DONO), {
      CD_DONO: Number(row.CD_DONO),
      NOME: row.NOME || '',
      CODIGO: row.CODIGO || '',
    });
  }
  return m;
}

/**
 * Programação antecipada de embarque a partir de espelhos OPL (antes da NF-e).
 * Peso = PESO_KG × QT_PEDIDA; conservação = mesma regra do romaneio / cargas.
 */
async function montarProgramacaoAntecipadaOpl(tenantId, query) {
  query = query || {};
  const dataDe = parseFiltroData(query.dataEntregaDe ?? query.data_de);
  const dataAte = parseFiltroData(query.dataEntregaAte ?? query.data_ate);
  const cdDonoFilt =
    query.cdDono != null && String(query.cdDono).trim() !== ''
      ? parseInt(String(query.cdDono), 10)
      : null;
  const nmArquivo = query.nmArquivo != null ? String(query.nmArquivo).trim() : '';
  const uf = query.uf != null ? String(query.uf).trim().toUpperCase().slice(0, 2) : '';
  const cdsOplRaw = query.cdsOpl ?? query.cds_opl ?? query.cdOplArquivos;
  const cdsOpl = [];
  if (cdsOplRaw != null) {
    const parts = Array.isArray(cdsOplRaw) ? cdsOplRaw : String(cdsOplRaw).split(/[,;]/);
    for (const p of parts) {
      const n = parseInt(String(p).trim(), 10);
      if (Number.isFinite(n)) cdsOpl.push(n);
    }
  }

  const params = [tenantId];
  let i = 2;
  let sqlArq = `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CD_DONO", a."CLI_NOME", a."Q_PEDIDOS", a."Q_ITENS", a."DH_IMPORT"
                  FROM "WMS_OPL_ARQUIVO" a
                 WHERE a."TENANT_ID" = $1`;
  if (Number.isFinite(cdDonoFilt)) {
    sqlArq += ` AND a."CD_DONO" = $${i}::integer`;
    params.push(cdDonoFilt);
    i += 1;
  }
  if (nmArquivo) {
    sqlArq += ` AND a."NM_ARQUIVO" ILIKE $${i}`;
    params.push(`%${nmArquivo}%`);
    i += 1;
  }
  if (cdsOpl.length) {
    sqlArq += ` AND a."CD_OPL_ARQUIVO" = ANY($${i}::int[])`;
    params.push(cdsOpl);
    i += 1;
  }
  sqlArq += ` ORDER BY a."DH_IMPORT" DESC LIMIT 80`;

  let arquivos;
  try {
    arquivos = (await pool.query(sqlArq, params)).rows || [];
  } catch (e) {
    if (schemaMissing(e)) {
      return { err: 'Estrutura WMS de separação ausente.', status: 503 };
    }
    throw e;
  }

  if (!arquivos.length) {
    return {
      filtros: { dataDe, dataAte, cdDono: cdDonoFilt, nmArquivo, uf, cdsOpl },
      referenciaVeiculos: REFERENCIA_VEICULOS,
      totaisGeral: finalizarTotais(criarTotaisVazio()),
      porDataEntrega: [],
      espelhosConsiderados: [],
      aviso: 'Nenhum espelho OPL encontrado com os filtros informados.',
    };
  }

  const idsArq = arquivos.map((a) => a.CD_OPL_ARQUIVO);
  const rLinhas = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CD_DONO", a."CLI_NOME",
            p."CD_OPL_PEDIDO", p."COD_DESTINATARIO", p."RAZ_SOC_DEST", p."CIDADE_ENTREGA",
            p."UF_ENTREGA", p."CNPJ_DEST", p."NUM_PEDIDO", p."DATA_PEDIDO", p."LINHA2_RAW", p."DADOS_JSON",
            i."COD_PRODUTO_OL", i."DESCRICAO", i."QT_PEDIDA"
       FROM "WMS_OPL_ARQUIVO" a
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE a."CD_OPL_ARQUIVO" = ANY($1::int[])
        AND a."TENANT_ID" = $2`,
    [idsArq, tenantId]
  );

  const pedidosPorArquivo = new Map();
  for (const row of rLinhas.rows || []) {
    const cdArq = row.CD_OPL_ARQUIVO;
    const cdPed = row.CD_OPL_PEDIDO;
    if (!pedidosPorArquivo.has(cdArq)) pedidosPorArquivo.set(cdArq, new Map());
    const mapPed = pedidosPorArquivo.get(cdArq);
    if (!mapPed.has(cdPed)) {
      mapPed.set(cdPed, {
        CD_OPL_PEDIDO: cdPed,
        COD_DESTINATARIO: row.COD_DESTINATARIO,
        RAZ_SOC_DEST: row.RAZ_SOC_DEST,
        CIDADE_ENTREGA: row.CIDADE_ENTREGA,
        UF_ENTREGA: row.UF_ENTREGA,
        CNPJ_DEST: row.CNPJ_DEST,
        NUM_PEDIDO: row.NUM_PEDIDO,
        DATA_PEDIDO: row.DATA_PEDIDO,
        LINHA2_RAW: row.LINHA2_RAW,
        DADOS_JSON: row.DADOS_JSON,
        itens: [],
      });
    }
    mapPed.get(cdPed).itens.push({
      COD_PRODUTO_OL: row.COD_PRODUTO_OL,
      DESCRICAO: row.DESCRICAO,
      QT_PEDIDA: row.QT_PEDIDA,
    });
  }

  const donosMap = await carregarDonosMap(tenantId);
  const mapasPesoPorDono = new Map();
  const nrRotaPorArquivo = new Map();

  const codigosOlPorDono = new Map();
  for (const arq of arquivos) {
    const cdDono = arq.CD_DONO != null ? Number(arq.CD_DONO) : null;
    if (!Number.isFinite(cdDono)) continue;
    if (!codigosOlPorDono.has(cdDono)) codigosOlPorDono.set(cdDono, new Set());
    const setCod = codigosOlPorDono.get(cdDono);
    const pedidos = [...(pedidosPorArquivo.get(arq.CD_OPL_ARQUIVO)?.values() || [])];
    for (const p of pedidos) {
      for (const it of p.itens || []) {
        const c = String(it.COD_PRODUTO_OL || '').trim();
        if (c) setCod.add(c);
      }
    }
  }
  for (const [cdDono, setCod] of codigosOlPorDono) {
    mapasPesoPorDono.set(cdDono, await carregarMapasPesoOpl(tenantId, cdDono, [...setCod]));
  }

  for (const arq of arquivos) {
    const cdArq = arq.CD_OPL_ARQUIVO;
    const pedidos = [...(pedidosPorArquivo.get(cdArq)?.values() || [])];
    try {
      nrRotaPorArquivo.set(cdArq, await carregarNrRotaPorPedidosOpl(pool, tenantId, pedidos));
    } catch (e) {
      if (!schemaMissing(e)) throw e;
      nrRotaPorArquivo.set(cdArq, new Map());
    }
  }

  const porData = new Map();
  const espelhosUsados = new Map();
  const pendenciasGeral = criarPendenciaPesoMap();
  let linhasSemData = 0;

  for (const arq of arquivos) {
    const cdArq = arq.CD_OPL_ARQUIVO;
    const cdDono = arq.CD_DONO != null ? Number(arq.CD_DONO) : null;
    const mapasPeso = cdDono != null ? mapasPesoPorDono.get(cdDono) : null;
    const nrRotaMap = nrRotaPorArquivo.get(cdArq) || new Map();
    const pedidos = [...(pedidosPorArquivo.get(cdArq)?.values() || [])];

    for (const p of pedidos) {
      if (uf && String(p.UF_ENTREGA || '').trim().toUpperCase().slice(0, 2) !== uf) continue;

      const ent = extrairDataEntregaPedidoOpl(p);
      const dataBr = ent.data || '';
      const dataIso = dataEntregaParaIso(dataBr);
      if (!dataIso) {
        linhasSemData += (p.itens || []).length;
        continue;
      }
      if (dataDe && dataIso < dataDe) continue;
      if (dataAte && dataIso > dataAte) continue;

      const chDest = chaveDestinatario(p);
      const nrRota = nrRotaMap.get(chDest);
      const pedKey = `${cdArq}|${p.CD_OPL_PEDIDO}`;

      if (!porData.has(dataBr)) {
        porData.set(dataBr, {
          dataEntrega: dataBr,
          dataIso,
          totais: criarTotaisVazio(),
          porDono: new Map(),
          porRota: new Map(),
          espelhos: new Map(),
          pedidos: new Set(),
          paradas: new Set(),
        });
      }
      const blocoData = porData.get(dataBr);
      blocoData.pedidos.add(pedKey);
      blocoData.paradas.add(`${cdDono || 0}|${chDest}`);

      if (!blocoData.espelhos.has(cdArq)) {
        blocoData.espelhos.set(cdArq, {
          CD_OPL_ARQUIVO: cdArq,
          NM_ARQUIVO: arq.NM_ARQUIVO,
          CD_DONO: cdDono,
          NM_DONO: donosMap.get(cdDono)?.NOME || arq.CLI_NOME || '',
          Q_PEDIDOS: arq.Q_PEDIDOS,
          Q_ITENS: arq.Q_ITENS,
        });
        espelhosUsados.set(cdArq, blocoData.espelhos.get(cdArq));
      }

      const dk = cdDono != null ? String(cdDono) : '_sem';
      if (!blocoData.porDono.has(dk)) {
        blocoData.porDono.set(dk, {
          CD_DONO: cdDono,
          NM_DONO: donosMap.get(cdDono)?.NOME || arq.CLI_NOME || '(sem dono)',
          totais: criarTotaisVazio(),
          espelhos: new Set(),
        });
      }
      const blocoDono = blocoData.porDono.get(dk);
      blocoDono.espelhos.add(cdArq);

      const rk = nrRota != null && Number.isFinite(Number(nrRota)) ? String(nrRota) : '_sem';
      if (!blocoData.porRota.has(rk)) {
        blocoData.porRota.set(rk, {
          NR_ROTA: nrRota != null && Number.isFinite(Number(nrRota)) ? Number(nrRota) : null,
          rotulo:
            nrRota != null && Number.isFinite(Number(nrRota))
              ? `Rota ${nrRota}`
              : 'Sem rota no cadastro',
          totais: criarTotaisVazio(),
          paradas: new Set(),
          porDestino: new Map(),
        });
      }
      const blocoRota = blocoData.porRota.get(rk);
      blocoRota.paradas.add(chDest);

      if (!blocoRota.porDestino.has(chDest)) {
        const codDest = String(p.COD_DESTINATARIO || '').trim();
        const razao = String(p.RAZ_SOC_DEST || '').trim();
        const cidade = String(p.CIDADE_ENTREGA || '').trim();
        const ufEnt = String(p.UF_ENTREGA || '').trim().toUpperCase().slice(0, 2);
        blocoRota.porDestino.set(chDest, {
          chaveDestino: chDest,
          COD_DESTINATARIO: codDest,
          RAZ_SOC_DEST: razao,
          CIDADE_ENTREGA: cidade,
          UF_ENTREGA: ufEnt,
          rotulo: [codDest, razao].filter(Boolean).join(' — ') || razao || cidade || chDest,
          cidadeUf: [cidade, ufEnt].filter(Boolean).join(' / '),
          totais: criarTotaisVazio(),
          pedidos: new Set(),
          pendenciasMap: criarPendenciaPesoMap(),
        });
      }
      const blocoDest = blocoRota.porDestino.get(chDest);
      blocoDest.pedidos.add(pedKey);

      for (const it of p.itens || []) {
        const qtd = toNumber(it.QT_PEDIDA);
        if (qtd <= 0) continue;
        const cad = resolveCadProdutoOpl(it.COD_PRODUTO_OL, mapasPeso);
        const { peso, semPeso } = pesoItemOpl(qtd, cad);
        const semCadastro = !cad;
        const det = classificarConservacaoDetalhe(it.DESCRICAO || '', cad);
        const frio = det.bucket === 'REFRIG_CONG';
        const inc = {
          pesoKg: peso,
          pesoKgSeco: frio ? 0 : peso,
          pesoKgFrio: frio ? peso : 0,
          unidades: qtd,
          qtdLinhas: 1,
          linhasComPeso: semPeso ? 0 : 1,
          linhasSemPeso: semPeso ? 1 : 0,
          linhasSemCadastro: semCadastro ? 1 : 0,
        };
        somarTotais(blocoData.totais, inc);
        somarTotais(blocoDono.totais, inc);
        somarTotais(blocoRota.totais, inc);
        somarTotais(blocoDest.totais, inc);
        const motivoPend = semCadastro ? 'sem_cadastro' : semPeso ? 'sem_peso' : null;
        if (motivoPend) {
          const nmDono = donosMap.get(cdDono)?.NOME || arq.CLI_NOME || '';
          const pendCtx = {
            codOl: it.COD_PRODUTO_OL,
            descricao: it.DESCRICAO,
            motivo: motivoPend,
            cdDono,
            nmDono,
            cad,
            qtd,
            operacional:
              motivoPend === 'sem_cadastro' && mapasPeso
                ? hitOperacionalFromMap(mapasPeso.operacional || new Map(), it.COD_PRODUTO_OL)
                : null,
          };
          registrarPendenciaPeso(pendenciasGeral, pendCtx);
          registrarPendenciaPeso(blocoDest.pendenciasMap, pendCtx);
        }
      }
    }
  }

  const totaisGeral = criarTotaisVazio();
  const porDataEntrega = [];

  for (const bloco of [...porData.values()].sort((a, b) =>
    String(a.dataIso).localeCompare(String(b.dataIso))
  )) {
    bloco.totais.qtdPedidos = bloco.pedidos.size;
    bloco.totais.qtdParadas = bloco.paradas.size;
    bloco.totais.qtdEspelhos = bloco.espelhos.size;
    finalizarTotais(bloco.totais);
    somarTotais(totaisGeral, bloco.totais);
    totaisGeral.qtdPedidos = (totaisGeral.qtdPedidos || 0) + bloco.totais.qtdPedidos;
    totaisGeral.qtdParadas = (totaisGeral.qtdParadas || 0) + bloco.totais.qtdParadas;

    const porDono = [...bloco.porDono.values()]
      .map((d) => {
        d.totais.qtdEspelhos = d.espelhos.size;
        finalizarTotais(d.totais);
        return {
          CD_DONO: d.CD_DONO,
          NM_DONO: d.NM_DONO,
          totais: d.totais,
          espelhosIds: [...d.espelhos],
        };
      })
      .sort((a, b) => String(a.NM_DONO).localeCompare(String(b.NM_DONO), 'pt-BR'));

    const porRota = [...bloco.porRota.values()]
      .map((r) => {
        r.totais.qtdParadas = r.paradas.size;
        finalizarTotais(r.totais);
        const destinatarios = [...(r.porDestino || new Map()).values()]
          .map((d) => {
            d.totais.qtdPedidos = d.pedidos.size;
            finalizarTotais(d.totais);
            return {
              chaveDestino: d.chaveDestino,
              COD_DESTINATARIO: d.COD_DESTINATARIO,
              RAZ_SOC_DEST: d.RAZ_SOC_DEST,
              CIDADE_ENTREGA: d.CIDADE_ENTREGA,
              UF_ENTREGA: d.UF_ENTREGA,
              rotulo: d.rotulo,
              cidadeUf: d.cidadeUf,
              totais: d.totais,
              qtdPedidos: d.pedidos.size,
              pendenciasPeso: serializarPendenciasPeso(d.pendenciasMap),
            };
          })
          .sort((a, b) => String(a.rotulo).localeCompare(String(b.rotulo), 'pt-BR'));
        return {
          NR_ROTA: r.NR_ROTA,
          rotulo: r.rotulo,
          totais: r.totais,
          qtdParadas: r.paradas.size,
          destinatarios,
        };
      })
      .sort((a, b) => {
        const na = a.NR_ROTA != null ? a.NR_ROTA : 99999;
        const nb = b.NR_ROTA != null ? b.NR_ROTA : 99999;
        return na - nb;
      });

    const veiculos = sugerirVeiculos(bloco.totais);

    porDataEntrega.push({
      dataEntrega: bloco.dataEntrega,
      totais: bloco.totais,
      sugestaoVeiculo: veiculos,
      porDono,
      porRota,
      espelhos: [...bloco.espelhos.values()],
    });
  }

  totaisGeral.qtdEspelhos = espelhosUsados.size;
  finalizarTotais(totaisGeral);

  let aviso = null;
  if (!porDataEntrega.length) {
    aviso =
      'Nenhuma linha com data de entrega no período. Confira o filtro de datas ou use o nome do arquivo (ex.: 10.06).';
  } else if (linhasSemData > 0) {
    aviso = `${linhasSemData} linha(s) ignoradas por falta de data de entrega no pedido OPL.`;
  }

  return {
    filtros: { dataDe, dataAte, cdDono: cdDonoFilt, nmArquivo, uf, cdsOpl },
    geradoEm: new Date().toISOString(),
    referenciaVeiculos: REFERENCIA_VEICULOS,
    totaisGeral,
    sugestaoVeiculoGeral: sugerirVeiculos(totaisGeral),
    porDataEntrega,
    espelhosConsiderados: [...espelhosUsados.values()],
    pendenciasPeso: serializarPendenciasPeso(pendenciasGeral),
    linhasSemDataEntrega: linhasSemData,
    legenda: {
      pesoKg:
        'Estimativa: PESO_KG do cadastro WMS × QT_PEDIDA (via código OL + de-para, como a cobertura OPL). Linhas sem cadastro ou sem PESO_KG entram com 0 kg.',
      unidades: 'Soma das quantidades pedidas no espelho (vol. operacional).',
      conservacao: 'Mesma regra do romaneio OPL e do resumo de cargas (NCM + cadastro + descrição).',
      veiculo: 'Referência operacional — ajuste conforme frota contratada e regras de mistura seco/frio.',
    },
    aviso,
  };
}

module.exports = {
  montarProgramacaoAntecipadaOpl,
  REFERENCIA_VEICULOS,
  sugerirVeiculos,
};
