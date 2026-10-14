'use strict';

/**
 * Validação determinística de pedidos entre espelhos OPL distintos.
 * Compara: número do pedido, destino e volume (itens × qtd).
 * Não cruza NF — só o que está nos arquivos selecionados / histórico.
 */

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normPed(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function normTxt(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function chaveDestino(p) {
  return [
    normTxt(p.COD_DESTINATARIO),
    normTxt(p.RAZ_SOC_DEST),
    normTxt(p.CIDADE_ENTREGA),
    normTxt(p.UF_ENTREGA),
  ].join('|');
}

function fingerprintVolume(itens) {
  return (itens || [])
    .map((it) => `${normTxt(it.COD_PRODUTO_OL)}|${Number(it.QT_PEDIDA) || 0}`)
    .sort()
    .join(';');
}

function parseIdsArquivos(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const ids = [...new Set(list.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0))];
  return ids;
}

async function carregarPedidosDosArquivos(tenantId, idsArquivo) {
  if (!idsArquivo.length) return { arquivos: [], pedidos: [] };

  const arq = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CLI_NOME", a."DH_IMPORT", a."Q_PEDIDOS", a."Q_ITENS"
       FROM "WMS_OPL_ARQUIVO" a
      WHERE a."TENANT_ID" = $1
        AND a."CD_OPL_ARQUIVO" = ANY($2::integer[])
      ORDER BY a."DH_IMPORT", a."CD_OPL_ARQUIVO"`,
    [tenantId, idsArquivo]
  );

  const ped = await pool.query(
    `SELECT p."CD_OPL_ARQUIVO", p."CD_OPL_PEDIDO", p."NUM_PEDIDO",
            p."COD_DESTINATARIO", p."RAZ_SOC_DEST", p."CIDADE_ENTREGA", p."UF_ENTREGA",
            (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS n_itens,
            (SELECT COALESCE(SUM(i."QT_PEDIDA"),0)::numeric FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS qtd_total,
            (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i
              WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO" AND i."QT_COLETADA" IS NOT NULL) AS n_itens_pick
       FROM "WMS_OPL_PEDIDO" p
      WHERE p."CD_OPL_ARQUIVO" = ANY($1::integer[])
      ORDER BY p."CD_OPL_ARQUIVO", p."NUM_PEDIDO"`,
    [idsArquivo]
  );

  const itens = await pool.query(
    `SELECT i."CD_OPL_PEDIDO", i."COD_PRODUTO_OL", i."QT_PEDIDA", i."DESCRICAO"
       FROM "WMS_OPL_ITEM" i
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO"=i."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = ANY($1::integer[])`,
    [idsArquivo]
  );

  const itensByPed = new Map();
  for (const it of itens.rows) {
    const id = it.CD_OPL_PEDIDO;
    if (!itensByPed.has(id)) itensByPed.set(id, []);
    itensByPed.get(id).push(it);
  }

  const pedidos = ped.rows.map((p) => {
    const listaItens = itensByPed.get(p.CD_OPL_PEDIDO) || [];
    return {
      CD_OPL_ARQUIVO: p.CD_OPL_ARQUIVO,
      CD_OPL_PEDIDO: p.CD_OPL_PEDIDO,
      NUM_PEDIDO: p.NUM_PEDIDO,
      PED_NORM: normPed(p.NUM_PEDIDO),
      COD_DESTINATARIO: p.COD_DESTINATARIO,
      RAZ_SOC_DEST: p.RAZ_SOC_DEST,
      CIDADE_ENTREGA: p.CIDADE_ENTREGA,
      UF_ENTREGA: p.UF_ENTREGA,
      N_ITENS: p.n_itens,
      QTD_TOTAL: Number(p.qtd_total) || 0,
      N_ITENS_PICK: p.n_itens_pick,
      CHAVE_DESTINO: chaveDestino(p),
      FP_VOLUME: fingerprintVolume(listaItens),
      ITENS: listaItens.map((x) => ({
        COD_PRODUTO_OL: x.COD_PRODUTO_OL,
        QT_PEDIDA: Number(x.QT_PEDIDA) || 0,
        DESCRICAO: x.DESCRICAO,
      })),
    };
  });

  return { arquivos: arq.rows, pedidos };
}

function classificarOcorrencias(occs) {
  const dests = [...new Set(occs.map((o) => o.CHAVE_DESTINO))];
  const vols = [...new Set(occs.map((o) => o.FP_VOLUME))];
  const destOk = dests.length === 1;
  const volOk = vols.length === 1;
  if (destOk && volOk) return 'DUPLICIDADE_IDENTICA';
  if (!destOk && !volOk) return 'DIVERGENCIA_DESTINO_E_VOLUME';
  if (!destOk) return 'DIVERGENCIA_DESTINO';
  return 'DIVERGENCIA_VOLUME';
}

/**
 * Compara pedidos entre 2+ arquivos selecionados.
 * @param {string} tenantId
 * @param {number[]} idsArquivo
 */
async function validarPedidosEntreArquivos(tenantId, idsArquivo) {
  const ids = parseIdsArquivos(idsArquivo);
  if (ids.length < 2) {
    const err = new Error('Selecione pelo menos 2 arquivos OPL para validar.');
    err.code = 'VALID';
    throw err;
  }

  const { arquivos, pedidos } = await carregarPedidosDosArquivos(tenantId, ids);
  if (arquivos.length !== ids.length) {
    const found = new Set(arquivos.map((a) => a.CD_OPL_ARQUIVO));
    const faltando = ids.filter((id) => !found.has(id));
    const err = new Error(`Arquivo(s) não encontrado(s): ${faltando.join(', ')}`);
    err.code = 'VALID';
    throw err;
  }

  const byPed = new Map();
  for (const p of pedidos) {
    if (!p.PED_NORM) continue;
    if (!byPed.has(p.PED_NORM)) byPed.set(p.PED_NORM, []);
    byPed.get(p.PED_NORM).push(p);
  }

  const conflitos = [];
  for (const [pedNorm, occs] of byPed) {
    const arqsDistintos = new Set(occs.map((o) => o.CD_OPL_ARQUIVO));
    if (arqsDistintos.size < 2) continue;
    const situacao = classificarOcorrencias(occs);
    conflitos.push({
      PEDIDO: pedNorm,
      NUM_PEDIDO: occs[0].NUM_PEDIDO,
      SITUACAO: situacao,
      N_ARQUIVOS: arqsDistintos.size,
      DESTINO_OK: situacao === 'DUPLICIDADE_IDENTICA' || situacao === 'DIVERGENCIA_VOLUME',
      VOLUME_OK: situacao === 'DUPLICIDADE_IDENTICA' || situacao === 'DIVERGENCIA_DESTINO',
      OCORRENCIAS: occs.map((o) => ({
        CD_OPL_ARQUIVO: o.CD_OPL_ARQUIVO,
        CD_OPL_PEDIDO: o.CD_OPL_PEDIDO,
        COD_DESTINATARIO: o.COD_DESTINATARIO,
        RAZ_SOC_DEST: o.RAZ_SOC_DEST,
        CIDADE_ENTREGA: o.CIDADE_ENTREGA,
        UF_ENTREGA: o.UF_ENTREGA,
        N_ITENS: o.N_ITENS,
        QTD_TOTAL: o.QTD_TOTAL,
        N_ITENS_PICK: o.N_ITENS_PICK,
        CHAVE_DESTINO: o.CHAVE_DESTINO,
        FP_VOLUME: o.FP_VOLUME,
      })),
    });
  }

  conflitos.sort((a, b) => a.PEDIDO.localeCompare(b.PEDIDO));

  const nIdentica = conflitos.filter((c) => c.SITUACAO === 'DUPLICIDADE_IDENTICA').length;
  const nDiv = conflitos.length - nIdentica;

  let veredito = 'SEGURO';
  let vereditoLabel = 'Nenhum pedido em comum entre os arquivos selecionados.';
  if (nIdentica > 0 && nDiv > 0) {
    veredito = 'BLOQUEIO';
    vereditoLabel = `Encontrados ${nIdentica} pedido(s) idênticos e ${nDiv} com divergência. Não separe os dois espelhos sem resolver.`;
  } else if (nIdentica > 0) {
    veredito = 'BLOQUEIO';
    vereditoLabel = `Encontrados ${nIdentica} pedido(s) com o mesmo número, mesmo destino e mesmo volume em arquivos distintos. Risco de separação em dobro.`;
  } else if (nDiv > 0) {
    veredito = 'ALERTA';
    vereditoLabel = `Encontrados ${nDiv} pedido(s) com o mesmo número, porém destino e/ou volume divergentes. Conferir origem antes de separar.`;
  }

  const porArquivo = arquivos.map((a) => {
    const pedArq = pedidos.filter((p) => p.CD_OPL_ARQUIVO === a.CD_OPL_ARQUIVO && p.PED_NORM);
    const soNeste = pedArq.filter((p) => (byPed.get(p.PED_NORM) || []).every((x) => x.CD_OPL_ARQUIVO === a.CD_OPL_ARQUIVO));
    return {
      CD_OPL_ARQUIVO: a.CD_OPL_ARQUIVO,
      NM_ARQUIVO: a.NM_ARQUIVO,
      CLI_NOME: a.CLI_NOME,
      DH_IMPORT: a.DH_IMPORT,
      Q_PEDIDOS: pedArq.length,
      Q_PEDIDOS_SO_NESTE: soNeste.length,
      Q_PEDIDOS_EM_COMUM: pedArq.length - soNeste.length,
    };
  });

  return {
    modo: 'ENTRE_ARQUIVOS',
    geradoEm: new Date().toISOString(),
    veredito,
    vereditoLabel,
    resumo: {
      arquivosComparados: arquivos.length,
      pedidosAnalisados: pedidos.filter((p) => p.PED_NORM).length,
      pedidosEmComum: conflitos.length,
      duplicidadeIdentica: nIdentica,
      divergencias: nDiv,
    },
    arquivos: porArquivo,
    conflitos,
  };
}

/**
 * Valida pedidos dos arquivos selecionados contra TODO o histórico do tenant
 * (outros arquivos não selecionados).
 */
async function validarPedidosContraHistorico(tenantId, idsArquivo) {
  const ids = parseIdsArquivos(idsArquivo);
  if (ids.length < 1) {
    const err = new Error('Selecione pelo menos 1 arquivo OPL.');
    err.code = 'VALID';
    throw err;
  }

  const { arquivos, pedidos } = await carregarPedidosDosArquivos(tenantId, ids);
  if (!arquivos.length) {
    const err = new Error('Arquivo(s) não encontrado(s).');
    err.code = 'VALID';
    throw err;
  }

  const pedsNorm = [...new Set(pedidos.map((p) => p.PED_NORM).filter(Boolean))];
  if (!pedsNorm.length) {
    return {
      modo: 'CONTRA_HISTORICO',
      geradoEm: new Date().toISOString(),
      veredito: 'SEGURO',
      vereditoLabel: 'Arquivo(s) sem número de pedido para cruzar.',
      resumo: {
        arquivosSelecionados: arquivos.length,
        pedidosAnalisados: 0,
        pedidosEmComum: 0,
        duplicidadeIdentica: 0,
        divergencias: 0,
      },
      arquivos: arquivos.map((a) => ({
        CD_OPL_ARQUIVO: a.CD_OPL_ARQUIVO,
        NM_ARQUIVO: a.NM_ARQUIVO,
        CLI_NOME: a.CLI_NOME,
        DH_IMPORT: a.DH_IMPORT,
      })),
      conflitos: [],
    };
  }

  const hist = await pool.query(
    `SELECT p."CD_OPL_ARQUIVO", p."CD_OPL_PEDIDO", p."NUM_PEDIDO",
            p."COD_DESTINATARIO", p."RAZ_SOC_DEST", p."CIDADE_ENTREGA", p."UF_ENTREGA",
            a."NM_ARQUIVO", a."DH_IMPORT", a."CLI_NOME",
            (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS n_itens,
            (SELECT COALESCE(SUM(i."QT_PEDIDA"),0)::numeric FROM "WMS_OPL_ITEM" i WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO") AS qtd_total,
            (SELECT COUNT(*)::int FROM "WMS_OPL_ITEM" i
              WHERE i."CD_OPL_PEDIDO"=p."CD_OPL_PEDIDO" AND i."QT_COLETADA" IS NOT NULL) AS n_itens_pick
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=p."CD_OPL_ARQUIVO"
      WHERE a."TENANT_ID" = $1
        AND NOT (p."CD_OPL_ARQUIVO" = ANY($2::integer[]))
        AND regexp_replace(COALESCE(p."NUM_PEDIDO",''), '[^0-9]', '', 'g') = ANY($3::text[])`,
    [tenantId, ids, pedsNorm]
  );

  // carregar itens dos hits do histórico
  const histIdsPed = hist.rows.map((r) => r.CD_OPL_PEDIDO);
  let itensHist = [];
  if (histIdsPed.length) {
    const ir = await pool.query(
      `SELECT "CD_OPL_PEDIDO", "COD_PRODUTO_OL", "QT_PEDIDA", "DESCRICAO"
         FROM "WMS_OPL_ITEM" WHERE "CD_OPL_PEDIDO" = ANY($1::integer[])`,
      [histIdsPed]
    );
    itensHist = ir.rows;
  }
  const itensByPed = new Map();
  for (const it of itensHist) {
    if (!itensByPed.has(it.CD_OPL_PEDIDO)) itensByPed.set(it.CD_OPL_PEDIDO, []);
    itensByPed.get(it.CD_OPL_PEDIDO).push(it);
  }

  const byPed = new Map();
  for (const p of pedidos) {
    if (!p.PED_NORM) continue;
    if (!byPed.has(p.PED_NORM)) byPed.set(p.PED_NORM, []);
    byPed.get(p.PED_NORM).push(p);
  }
  for (const h of hist.rows) {
    const pedNorm = normPed(h.NUM_PEDIDO);
    const lista = itensByPed.get(h.CD_OPL_PEDIDO) || [];
    const occ = {
      CD_OPL_ARQUIVO: h.CD_OPL_ARQUIVO,
      CD_OPL_PEDIDO: h.CD_OPL_PEDIDO,
      NUM_PEDIDO: h.NUM_PEDIDO,
      PED_NORM: pedNorm,
      COD_DESTINATARIO: h.COD_DESTINATARIO,
      RAZ_SOC_DEST: h.RAZ_SOC_DEST,
      CIDADE_ENTREGA: h.CIDADE_ENTREGA,
      UF_ENTREGA: h.UF_ENTREGA,
      N_ITENS: h.n_itens,
      QTD_TOTAL: Number(h.qtd_total) || 0,
      N_ITENS_PICK: h.n_itens_pick,
      CHAVE_DESTINO: chaveDestino(h),
      FP_VOLUME: fingerprintVolume(lista),
      NM_ARQUIVO: h.NM_ARQUIVO,
      DH_IMPORT: h.DH_IMPORT,
      CLI_NOME: h.CLI_NOME,
      ORIGEM: 'HISTORICO',
    };
    if (!byPed.has(pedNorm)) byPed.set(pedNorm, []);
    byPed.get(pedNorm).push(occ);
  }

  const conflitos = [];
  for (const [pedNorm, occs] of byPed) {
    const temSel = occs.some((o) => ids.includes(o.CD_OPL_ARQUIVO));
    const temHist = occs.some((o) => !ids.includes(o.CD_OPL_ARQUIVO));
    if (!temSel || !temHist) continue;
    const situacao = classificarOcorrencias(occs);
    conflitos.push({
      PEDIDO: pedNorm,
      NUM_PEDIDO: occs[0].NUM_PEDIDO,
      SITUACAO: situacao,
      N_ARQUIVOS: new Set(occs.map((o) => o.CD_OPL_ARQUIVO)).size,
      DESTINO_OK: situacao === 'DUPLICIDADE_IDENTICA' || situacao === 'DIVERGENCIA_VOLUME',
      VOLUME_OK: situacao === 'DUPLICIDADE_IDENTICA' || situacao === 'DIVERGENCIA_DESTINO',
      OCORRENCIAS: occs.map((o) => ({
        CD_OPL_ARQUIVO: o.CD_OPL_ARQUIVO,
        CD_OPL_PEDIDO: o.CD_OPL_PEDIDO,
        NM_ARQUIVO: o.NM_ARQUIVO || arquivos.find((a) => a.CD_OPL_ARQUIVO === o.CD_OPL_ARQUIVO)?.NM_ARQUIVO,
        DH_IMPORT: o.DH_IMPORT || arquivos.find((a) => a.CD_OPL_ARQUIVO === o.CD_OPL_ARQUIVO)?.DH_IMPORT,
        COD_DESTINATARIO: o.COD_DESTINATARIO,
        RAZ_SOC_DEST: o.RAZ_SOC_DEST,
        CIDADE_ENTREGA: o.CIDADE_ENTREGA,
        UF_ENTREGA: o.UF_ENTREGA,
        N_ITENS: o.N_ITENS,
        QTD_TOTAL: o.QTD_TOTAL,
        N_ITENS_PICK: o.N_ITENS_PICK,
        ORIGEM: ids.includes(o.CD_OPL_ARQUIVO) ? 'SELECIONADO' : 'HISTORICO',
      })),
    });
  }
  conflitos.sort((a, b) => a.PEDIDO.localeCompare(b.PEDIDO));

  const nIdentica = conflitos.filter((c) => c.SITUACAO === 'DUPLICIDADE_IDENTICA').length;
  const nDiv = conflitos.length - nIdentica;
  let veredito = 'SEGURO';
  let vereditoLabel = 'Nenhum pedido dos arquivos selecionados aparece em outro espelho do histórico.';
  if (nIdentica > 0 || nDiv > 0) {
    veredito = nIdentica > 0 ? 'BLOQUEIO' : 'ALERTA';
    vereditoLabel =
      nIdentica > 0
        ? `${nIdentica} pedido(s) idênticos já existem em outro(s) arquivo(s) do histórico.`
        : `${nDiv} pedido(s) com mesmo número no histórico, porém com divergência de destino/volume.`;
    if (nIdentica > 0 && nDiv > 0) {
      vereditoLabel = `${nIdentica} idêntico(s) + ${nDiv} divergente(s) no histórico.`;
    }
  }

  return {
    modo: 'CONTRA_HISTORICO',
    geradoEm: new Date().toISOString(),
    veredito,
    vereditoLabel,
    resumo: {
      arquivosSelecionados: arquivos.length,
      pedidosAnalisados: pedsNorm.length,
      pedidosEmComum: conflitos.length,
      duplicidadeIdentica: nIdentica,
      divergencias: nDiv,
    },
    arquivos: arquivos.map((a) => ({
      CD_OPL_ARQUIVO: a.CD_OPL_ARQUIVO,
      NM_ARQUIVO: a.NM_ARQUIVO,
      CLI_NOME: a.CLI_NOME,
      DH_IMPORT: a.DH_IMPORT,
    })),
    conflitos,
  };
}

function linhasValidacaoParaCsv(resultado) {
  const cols = [
    'PEDIDO',
    'SITUACAO',
    'DESTINO_OK',
    'VOLUME_OK',
    'CD_OPL_ARQUIVO',
    'NM_ARQUIVO',
    'ORIGEM',
    'COD_DESTINATARIO',
    'RAZ_SOC_DEST',
    'CIDADE',
    'UF',
    'N_ITENS',
    'QTD_TOTAL',
    'N_ITENS_PICK',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(';')];
  for (const c of resultado.conflitos || []) {
    for (const o of c.OCORRENCIAS || []) {
      lines.push(
        [
          c.PEDIDO,
          c.SITUACAO,
          c.DESTINO_OK ? 'S' : 'N',
          c.VOLUME_OK ? 'S' : 'N',
          o.CD_OPL_ARQUIVO,
          o.NM_ARQUIVO || '',
          o.ORIGEM || '',
          o.COD_DESTINATARIO || '',
          o.RAZ_SOC_DEST || '',
          o.CIDADE_ENTREGA || '',
          o.UF_ENTREGA || '',
          o.N_ITENS,
          o.QTD_TOTAL,
          o.N_ITENS_PICK,
        ]
          .map(esc)
          .join(';')
      );
    }
  }
  return lines.join('\n');
}

function buildValidacaoPedidosHtml(resultado) {
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const cor =
    resultado.veredito === 'SEGURO' ? '#059669' : resultado.veredito === 'BLOQUEIO' ? '#b91c1c' : '#b45309';
  const rows = (resultado.conflitos || [])
    .map((c) => {
      const occHtml = (c.OCORRENCIAS || [])
        .map(
          (o) =>
            `<tr>
              <td>${esc(o.CD_OPL_ARQUIVO)}</td>
              <td>${esc(o.NM_ARQUIVO || '—')}</td>
              <td>${esc(o.ORIGEM || '—')}</td>
              <td>${esc(o.COD_DESTINATARIO || '')} ${esc(o.RAZ_SOC_DEST || '')}</td>
              <td>${esc(o.CIDADE_ENTREGA || '')}/${esc(o.UF_ENTREGA || '')}</td>
              <td style="text-align:right">${esc(o.N_ITENS)}</td>
              <td style="text-align:right">${esc(o.QTD_TOTAL)}</td>
              <td style="text-align:right">${esc(o.N_ITENS_PICK)}</td>
            </tr>`
        )
        .join('');
      return `<section style="margin:16px 0;padding:12px;border:1px solid #e2e8f0;border-radius:8px;">
        <h3 style="margin:0 0 8px;font-size:15px;">Pedido ${esc(c.NUM_PEDIDO || c.PEDIDO)}
          <span style="font-weight:600;color:${c.SITUACAO === 'DUPLICIDADE_IDENTICA' ? '#b91c1c' : '#b45309'}">${esc(c.SITUACAO)}</span>
        </h3>
        <p style="margin:0 0 8px;font-size:13px;color:#475569;">Destino OK: <strong>${c.DESTINO_OK ? 'SIM' : 'NÃO'}</strong> · Volume OK: <strong>${c.VOLUME_OK ? 'SIM' : 'NÃO'}</strong></p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f8fafc;">
            <th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;">Arq.</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;">Nome</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;">Origem</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;">Destino</th>
            <th style="text-align:left;padding:6px;border-bottom:1px solid #e2e8f0;">Cidade/UF</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #e2e8f0;">Itens</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #e2e8f0;">Qtd</th>
            <th style="text-align:right;padding:6px;border-bottom:1px solid #e2e8f0;">Pick</th>
          </tr></thead>
          <tbody>${occHtml}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const arqList = (resultado.arquivos || [])
    .map((a) => `<li>#${esc(a.CD_OPL_ARQUIVO)} — ${esc(a.NM_ARQUIVO)}</li>`)
    .join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Validação pedidos OPL</title>
    <style>body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#0f172a;} h1{font-size:20px;} .badge{display:inline-block;padding:6px 12px;border-radius:8px;background:${cor};color:#fff;font-weight:700;}</style>
    </head><body>
    <h1>Validação de pedidos entre espelhos OPL</h1>
    <p>Modo: <strong>${esc(resultado.modo)}</strong> · Gerado: ${esc(resultado.geradoEm)}</p>
    <p><span class="badge">${esc(resultado.veredito)}</span> ${esc(resultado.vereditoLabel)}</p>
    <p>Pedidos em comum: <strong>${esc(resultado.resumo?.pedidosEmComum)}</strong> ·
       Idênticos: <strong>${esc(resultado.resumo?.duplicidadeIdentica)}</strong> ·
       Divergentes: <strong>${esc(resultado.resumo?.divergencias)}</strong></p>
    <h2 style="font-size:16px;">Arquivos</h2>
    <ul>${arqList}</ul>
    <h2 style="font-size:16px;">Conflitos</h2>
    ${rows || '<p>Nenhum conflito.</p>'}
    <p style="margin-top:24px;font-size:12px;color:#64748b;">Critérios: mesmo nº de pedido; destino = código+razão+cidade+UF; volume = fingerprint de código OL × quantidade pedida. Sem cruzamento com NF.</p>
    </body></html>`;
}

module.exports = {
  parseIdsArquivos,
  validarPedidosEntreArquivos,
  validarPedidosContraHistorico,
  linhasValidacaoParaCsv,
  buildValidacaoPedidosHtml,
  schemaMissing,
};
