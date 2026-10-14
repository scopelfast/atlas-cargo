'use strict';

const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const {
  listarPosicaoEstoque,
  linhasParaCsv: linhasPosicaoParaCsv,
  montarRotuloFiltroDono,
  applyProductMask,
  enriquecerLinhasPosicaoCadastro,
  filtrarLinhasPosicaoOcultarZerados,
} = require('../services/wms-relatorio-posicao-estoque.service');
const { buildPosicaoEstoqueHtml } = require('../services/wms-relatorio-posicao-estoque-html.service');
const {
  buildEtiquetasSaldoHtml,
  estimarTotalEtiquetas,
  ETQ_MAX_TOTAL,
} = require('../services/wms-etiquetas-saldo-html.service');
const {
  listarMovimentacaoItens,
  montarRotuloFiltroSentido,
  montarRotuloFiltroOrdem,
  linhasParaCsv: linhasMovParaCsv,
  montarRotuloFiltroPeriodo,
} = require('../services/wms-relatorio-movimentacao.service');
const { buildMovimentacaoHtml } = require('../services/wms-relatorio-movimentacao-html.service');
const {
  listarDemonstrativoMovimentacao,
  linhasParaCsv: linhasDemonstrativoParaCsv,
} = require('../services/wms-relatorio-demonstrativo-movimentacao.service');
const { buildDemonstrativoMovimentacaoHtml } = require('../services/wms-relatorio-demonstrativo-movimentacao-html.service');
const {
  listarRelatorioVencimentoPorRecebimentoEncerrado,
  linhasParaCsv: linhasVencimentoParaCsv,
} = require('../services/wms-relatorio-vencimento.service');
const { buildShelfLifeHtml, buildShelfLifeSaldoHtml, buildShelfLifeCobrancaHtml, buildValidadeFaltanteHtml } = require('../services/wms-relatorio-shelf-life-html.service');
const {
  listarConversaoEmbalagem,
  linhasParaCsv: linhasConversaoParaCsv,
} = require('../services/wms-relatorio-conversao-embalagem.service');
const { buildConversaoEmbalagemHtml } = require('../services/wms-relatorio-conversao-embalagem-html.service');
const {
  listarShelfLifeSaldoPorValidade,
  listarShelfLifeCobranca,
  linhasSaldoParaCsv,
  anexarSaldoEstimadoFefoNasLinhasPosicao,
  parseHorizonteDiasOverride,
  parseDataReferenciaIso,
} = require('../services/wms-relatorio-shelf-life-saldo.service');
const {
  listarValidadeFaltante,
  linhasValidadeFaltanteParaCsv,
} = require('../services/wms-relatorio-validade-faltante.service');
const {
  listarSeparacaoOplItens,
  resumirPorCodigo,
  resumirPorEspelho,
  linhasParaCsv: linhasSeparacaoParaCsv,
  linhasResumoParaCsv,
  montarRotuloFiltroSituacao,
  montarRotuloFiltroEspelho,
  montarRotuloFiltroPedidoDestino,
  montarRotuloTipoPeriodo,
} = require('../services/wms-relatorio-separacao-opl.service');
const { buildSeparacaoOplHtml } = require('../services/wms-relatorio-separacao-opl-html.service');
const {
  listarComparativoNfOpl,
  linhasParaCsv: linhasComparativoNfOplParaCsv,
  linhasSinteticoParaCsv: linhasComparativoSinteticoParaCsv,
  labelFiltroTipoDivergencia,
} = require('../services/wms-relatorio-nf-opl-comparativo.service');
const { buildComparativoNfOplHtml } = require('../services/wms-relatorio-nf-opl-comparativo-html.service');
const {
  listarHistoricoEnvioRelatorioVencimento,
} = require('../services/wms-relatorio-vencimento-envio-log.service');
const {
  parseApontadoModo,
  carregarChavesApontadasAtivas,
  filtrarLinhasPorApontado,
  avisoFiltroApontado,
  marcarLinhasApontadas,
  desapontarPorIds,
  desapontarPorChaves,
  listarApontados,
} = require('../services/wms-shelf-apontado.service');
const {
  listarMotivosBaixa,
  previewBaixaEstoque,
  confirmarBaixaEstoque,
  listarHistoricoBaixas,
  listarLinhasBaixa,
} = require('../services/wms-baixa-estoque.service');
const { pool } = require('../config/db');
const {
  filtrarLinhasPorProduto,
  filtrarLinhasPorGrupoCategoria,
  montarRotuloFiltroProduto,
  normalizarFiltrosProdutoQuery,
} = require('../services/wms-relatorio-filtro-produto.service');
const { parseOrdemQuery, rotuloOrdemCampos, ordenarLinhasSaldo } = require('../services/wms-relatorio-separadores-cadastro.service');
const {
  montarDemandaDia,
  listarRotasDemandaDia,
  demandaDiaParaCsv,
} = require('../services/wms-relatorio-demanda-dia.service');
const { buildDemandaDiaHtml } = require('../services/wms-relatorio-demanda-dia-html.service');

function pickFiltros(req) {
  const prod = normalizarFiltrosProdutoQuery(req.query);
  return {
    cdDono: req.query.cdDono != null && String(req.query.cdDono).trim() !== '' ? req.query.cdDono : null,
    dtDe: req.query.dtDe ?? req.query.dt_de ?? null,
    dtAte: req.query.dtAte ?? req.query.dt_ate ?? null,
    codigoProduto: prod.codigoProduto,
    descricaoProduto: prod.descricaoProduto,
    conservacao: prod.conservacao,
    grupoProduto: prod.grupoProduto,
    categoriaProduto: prod.categoriaProduto,
    cdGrupo: prod.cdGrupo,
    cdCategoria: prod.cdCategoria,
    /** Filtro de sentido do movimento (somente relevante para o relatório de
     *  Movimentação). Valores aceitos: 'entrada' | 'saida' | '' (todos). */
    sentido: req.query.sentido != null ? String(req.query.sentido) : '',
    /** Ordenação do relatório de movimentação: data | numero_nf | documento | carga | tipo */
    ordem: req.query.ordem != null ? String(req.query.ordem) : '',
    separadoresGrupo:
      req.query.separadores != null
        ? String(req.query.separadores)
        : req.query.separadoresGrupo != null
          ? String(req.query.separadoresGrupo)
          : '',
    /** Posição: por padrão oculta SKUs com saldo 0. */
    ocultarZerados: (() => {
      const inc = req.query.incluirZerados ?? req.query.incluir_zerados;
      if (inc != null && String(inc).trim() !== '') {
        const s = String(inc).trim().toLowerCase();
        if (s === '1' || s === 'true' || s === 's' || s === 'sim') return false;
        if (s === '0' || s === 'false' || s === 'n' || s === 'nao' || s === 'não') return true;
      }
      const raw = req.query.ocultarZerados ?? req.query.ocultar_zerados;
      if (raw == null || String(raw).trim() === '') return true;
      const s = String(raw).trim().toLowerCase();
      if (s === '0' || s === 'false' || s === 'n' || s === 'nao' || s === 'não') return false;
      return true;
    })(),
  };
}

function pickFiltrosSeparacaoOpl(req) {
  const base = pickFiltros(req);
  return {
    ...base,
    situacaoPicking: String(req.query.situacaoPicking ?? req.query.situacao_picking ?? '').trim(),
    espelho: String(req.query.espelho ?? req.query.nmEspelho ?? '').trim(),
    cdOplArquivo: req.query.cdOplArquivo ?? req.query.cdOpl ?? null,
    numPedido: String(req.query.numPedido ?? req.query.pedido ?? '').trim(),
    destino: String(req.query.destino ?? '').trim(),
    tipoPeriodo: String(req.query.tipoPeriodo ?? req.query.periodoPor ?? 'importacao').trim(),
  };
}

function respondRelatorio(req, res, opts) {
  const formato = String(req.query.formato || '').trim().toLowerCase();
  const linhas = opts.linhas || [];
  const { avisos, filtroDonoLabel, filtroProdutoLabel, geradoEm, csvName, buildHtml } = opts;
  const payloadBase = {
    linhas,
    grupos: opts.grupos,
    totalLinhas: opts.totalLinhas,
    avisos,
    geradoEm,
    filtroDonoLabel,
    filtroProdutoLabel,
    filtroPeriodoLabel: opts.filtroPeriodoLabel,
    filtroSentidoLabel: opts.filtroSentidoLabel,
    filtroOrdemLabel: opts.filtroOrdemLabel,
    totaisDono: opts.totaisDono,
  };

  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvName}"`);
    let csvBody = opts.grupos ? opts.linhasCsv() : opts.linhasCsv(linhas);
    if (opts.filtroPeriodoLabel) {
      csvBody = `Período;${opts.filtroPeriodoLabel}\n${csvBody}`;
    }
    if (opts.filtroSentidoLabel) {
      csvBody = `Tipo de movimento;${opts.filtroSentidoLabel}\n${csvBody}`;
    }
    if (opts.filtroOrdemLabel) {
      csvBody = `Ordenação;${opts.filtroOrdemLabel}\n${csvBody}`;
    }
    if (opts.filtroSituacaoLabel) {
      csvBody = `Situação picking;${opts.filtroSituacaoLabel}\n${csvBody}`;
    }
    return res.send(`\uFEFF${csvBody}`);
  }
  if (formato === 'html') {
    const html = buildHtml(payloadBase);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  const json = {
    avisos,
    geradoEm,
    filtro: pickFiltros(req),
    filtroDonoLabel,
  };
  if (opts.grupos) {
    json.grupos = opts.grupos;
    json.total = opts.totalLinhas != null ? opts.totalLinhas : 0;
  } else {
    json.linhas = linhas;
    json.total = linhas.length;
  }
  if (opts.totaisDono) json.totaisDono = opts.totaisDono;
  if (opts.filtroPeriodoLabel) json.filtroPeriodoLabel = opts.filtroPeriodoLabel;
  return res.json(json);
}

async function listarPosicaoEstoqueRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    const { linhas: linhasBrutas, avisos, filtroDonoLabel: filtroDonoSrv } = await listarPosicaoEstoque(
      tid,
      f.cdDono
    );
    const linhas = filtrarLinhasPorProduto(linhasBrutas, f);
    const modoSep = String(f.separadoresGrupo || '').trim().toLowerCase();
    const ordem = parseOrdemQuery(f.ordem);
    const temFiltroGrupoCat =
      String(f.grupoProduto || '').trim() !== '' ||
      String(f.categoriaProduto || '').trim() !== '' ||
      (Number(f.cdGrupo) > 0) ||
      (Number(f.cdCategoria) > 0);
    const precisaCadastro =
      temFiltroGrupoCat ||
      (modoSep && modoSep !== 'nao') ||
      ordem.some((c) =>
        ['grupo', 'subcategoria', 'categoria', 'classe', 'conservacao', 'conservacao_faixas'].includes(c)
      );
    const comCadastroBruto = precisaCadastro
      ? await enriquecerLinhasPosicaoCadastro(tid, linhas)
      : linhas;
    const comCadastro = temFiltroGrupoCat
      ? filtrarLinhasPorGrupoCategoria(comCadastroBruto, f)
      : comCadastroBruto;
    const comFefo = anexarSaldoEstimadoFefoNasLinhasPosicao(comCadastro);
    const ocultarZerados = f.ocultarZerados !== false;
    const statsZero = filtrarLinhasPosicaoOcultarZerados(comFefo);
    const linhasFinais = ocultarZerados ? statsZero.linhas : comFefo;
    const skusOcultosZerados = ocultarZerados ? statsZero.skusOcultosZerados : 0;
    const skusVisiveis = ocultarZerados ? statsZero.skusDepois : statsZero.skusAntes;
    const filtroDonoLabel = filtroDonoSrv || montarRotuloFiltroDono(f.cdDono, linhasBrutas);
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    const filtroOrdemLabel = rotuloOrdemCampos(ordem);
    const geradoEm = new Date().toISOString();

    const formato = String(req.query.formato || '').trim().toLowerCase();
    if (formato === 'etiquetas' || formato === 'etiqueta') {
      const etqModo = String(req.query.etqModo || req.query.modoEtq || 'linha').trim().toLowerCase();
      const etqQtd = parseInt(req.query.etqQtd || req.query.qtdFixa || '1', 10);
      /* Mesma ordem do Imprimir (Conservação → Grupo → Categoria…) — sem zerados */
      const linhasOrd =
        modoSep !== 'nao' || (ordem && ordem.length)
          ? ordenarLinhasSaldo(linhasFinais, ordem || [], modoSep)
          : linhasFinais;
      const totalPrev = estimarTotalEtiquetas(linhasOrd, etqModo, etqQtd, true);
      if (totalPrev > ETQ_MAX_TOTAL) {
        return res.status(400).json({
          error:
            `Seriam ${totalPrev} etiquetas (limite ${ETQ_MAX_TOTAL}). Refine o filtro ou use 1 por linha.`,
        });
      }
      const html = await buildEtiquetasSaldoHtml({
        linhas: linhasOrd,
        geradoEm,
        filtroDonoLabel,
        filtroProdutoLabel,
        modo: etqModo,
        qtdFixa: etqQtd,
        tenantId: tid,
        deduplicar: true,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    return respondRelatorio(req, res, {
      linhas: linhasFinais,
      avisos,
      filtroDonoLabel,
      filtroProdutoLabel,
      filtroOrdemLabel,
      geradoEm,
      separadoresGrupo: f.separadoresGrupo,
      ordem,
      csvName: 'wms-saldo-estoque.csv',
      linhasCsv: linhasPosicaoParaCsv,
      buildHtml: (payload) =>
        buildPosicaoEstoqueHtml({
          ...payload,
          separadoresGrupo: f.separadoresGrupo,
          ordem,
          ocultarZerados,
          skusOcultosZerados,
          skusVisiveis,
        }),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarPosicaoEstoqueRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de saldo de estoque.' });
  }
}

async function listarMovimentacaoRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    const { linhas: linhasBrutas, avisos } = await listarMovimentacaoItens(tid, f);
    let linhas = filtrarLinhasPorProduto(linhasBrutas, f);
    const temFiltroGrupoCat =
      String(f.grupoProduto || '').trim() !== '' ||
      String(f.categoriaProduto || '').trim() !== '' ||
      (Number(f.cdGrupo) > 0) ||
      (Number(f.cdCategoria) > 0);
    if (temFiltroGrupoCat) {
      linhas = filtrarLinhasPorGrupoCategoria(
        await enriquecerLinhasPosicaoCadastro(tid, linhas),
        f
      );
    }
    const filtroDonoLabel = montarRotuloFiltroDono(f.cdDono, linhasBrutas);
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    const filtroPeriodoLabel = montarRotuloFiltroPeriodo(f);
    const filtroSentidoLabel = montarRotuloFiltroSentido(f);
    const filtroOrdemLabel = montarRotuloFiltroOrdem(f);
    const geradoEm = new Date().toISOString();
    return respondRelatorio(req, res, {
      linhas,
      avisos,
      filtroDonoLabel,
      filtroProdutoLabel,
      filtroPeriodoLabel,
      filtroSentidoLabel,
      filtroOrdemLabel,
      geradoEm,
      csvName: 'wms-movimentacao-itens.csv',
      linhasCsv: linhasMovParaCsv,
      buildHtml: buildMovimentacaoHtml,
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarMovimentacaoRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de movimentação.' });
  }
}

function mapLinhasShelfLife(rows) {
  return (rows || []).map((row) => {
    const mask = String(row.MASCARA_CODIGO_PRODUTO || '').trim();
    const codInterno = String(row.CODIGO_INTERNO || row.CODIGO_PRODUTO || '').trim();
    const codigoExib =
      mask && codInterno ? applyProductMask(codInterno, mask) : codInterno || String(row.CODIGO_PRODUTO || '');
    return {
      ...row,
      CODIGO_PRODUTO: codigoExib,
    };
  });
}

async function listarDemonstrativoMovimentacaoRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    const { grupos, totalLinhas, avisos } = await listarDemonstrativoMovimentacao(tid, f);
    const filtroDonoLabel = montarRotuloFiltroDono(
      f.cdDono,
      (grupos || []).map((g) => ({ CD_DONO: g.CD_DONO, NM_DONO: g.NM_DONO }))
    );
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    const filtroPeriodoLabel = montarRotuloFiltroPeriodo(f);
    const geradoEm = new Date().toISOString();
    return respondRelatorio(req, res, {
      grupos,
      totalLinhas,
      avisos,
      filtroDonoLabel,
      filtroProdutoLabel,
      filtroPeriodoLabel,
      geradoEm,
      csvName: 'wms-demonstrativo-movimentacao.csv',
      linhasCsv: () => linhasDemonstrativoParaCsv(grupos),
      buildHtml: (payload) =>
        buildDemonstrativoMovimentacaoHtml({
          grupos: payload.grupos,
          totalLinhas: payload.totalLinhas,
          avisos: payload.avisos,
          geradoEm: payload.geradoEm,
          filtroDonoLabel: payload.filtroDonoLabel,
          filtroProdutoLabel: payload.filtroProdutoLabel,
          filtroPeriodoLabel: payload.filtroPeriodoLabel,
        }),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarDemonstrativoMovimentacaoRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar demonstrativo de movimentação.' });
  }
}

async function listarShelfLifeRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    const modo = String(req.query.modo || 'entrada').trim().toLowerCase();
    const geradoEm = new Date().toISOString();
    const horizonteDias = parseHorizonteDiasOverride(
      req.query.horizonteDias ?? req.query.horizonte_dias ?? req.query.diasHorizonte
    );
    const dataReferencia = parseDataReferenciaIso(
      req.query.dataReferencia ??
        req.query.data_referencia ??
        req.query.dataBase ??
        req.query.data_base ??
        req.query.aPartirDe
    );
    const apontadoModo = parseApontadoModo(
      req.query.apontado ?? req.query.apontamento ?? req.query.apontadoModo
    );

    if (modo === 'saldo') {
      const { rows, avisos, filtroDonoLabel: filtroDonoSrv } = await listarShelfLifeSaldoPorValidade(
        tid,
        f.cdDono,
        { horizonteDias, dataReferencia, apontadoModo }
      );
      const linhas = filtrarLinhasPorProduto(rows, f);
      const avisosSaldo = [
        ...(avisos || []),
      ];
      const filtroDonoLabel = filtroDonoSrv || montarRotuloFiltroDono(f.cdDono, rows);
      const filtroProdutoLabel = montarRotuloFiltroProduto(f);
      return respondRelatorio(req, res, {
        linhas,
        avisos: avisosSaldo,
        filtroDonoLabel,
        filtroProdutoLabel,
        geradoEm,
        csvName: 'wms-shelf-life-saldo.csv',
        linhasCsv: linhasSaldoParaCsv,
        buildHtml: buildShelfLifeSaldoHtml,
      });
    }

    if (modo === 'cobranca' || modo === 'vencidos-cobranca') {
      const somenteVencidos =
        String(req.query.somenteVencidos || req.query.somente_vencidos || '') === '1' ||
        String(req.query.somenteVencidos || '').toLowerCase() === 'true';
      const { rows, avisos, filtroDonoLabel: filtroDonoSrv } = await listarShelfLifeCobranca(tid, f.cdDono, {
        somenteVencidos,
        apontadoModo,
        dataReferencia,
      });
      const linhas = filtrarLinhasPorProduto(rows, f);
      const avisosCob = [
        ...(avisos || []),
        somenteVencidos
          ? 'Filtro ativo: somente linhas com validade já vencida (dias < 0).'
          : null,
      ].filter(Boolean);
      const filtroDonoLabel = filtroDonoSrv || montarRotuloFiltroDono(f.cdDono, rows);
      const filtroProdutoLabel = montarRotuloFiltroProduto(f);
      return respondRelatorio(req, res, {
        linhas,
        avisos: avisosCob,
        filtroDonoLabel,
        filtroProdutoLabel,
        geradoEm,
        csvName: 'wms-shelf-life-cobranca.csv',
        linhasCsv: linhasSaldoParaCsv,
        buildHtml: buildShelfLifeCobrancaHtml,
      });
    }

    if (modo === 'validade-audit' || modo === 'validade-faltante') {
      const { rows } = await listarValidadeFaltante(tid, f.cdDono);
      const linhas = filtrarLinhasPorProduto(rows, f);
      const avisos = [
        'Produtos com controle de validade (FG_CONTROLA_VALIDADE=S), saldo > 0 e sem rastreio adequado.',
        'Só movimento — sem NF: estoque legado/migração (nunca passou por recebimento com conferência).',
        'Validade parcial: parte do saldo já tem validade; a coluna "A coletar" mostra o restante.',
        'Após a coleta, lance lote/validade no inventário ou no próximo recebimento.',
      ];
      const filtroDonoLabel = montarRotuloFiltroDono(f.cdDono, linhas);
      const filtroProdutoLabel = montarRotuloFiltroProduto(f);
      return respondRelatorio(req, res, {
        linhas,
        avisos,
        filtroDonoLabel,
        filtroProdutoLabel,
        geradoEm,
        csvName: 'wms-validade-faltante.csv',
        linhasCsv: linhasValidadeFaltanteParaCsv,
        buildHtml: buildValidadeFaltanteHtml,
      });
    }

    const { rows, avisos: avisosVenc } = await listarRelatorioVencimentoPorRecebimentoEncerrado(
      tid,
      f.cdDono,
      { horizonteDias, dataReferencia }
    );
    const linhasMapeadas = mapLinhasShelfLife(rows);
    let linhas = filtrarLinhasPorProduto(linhasMapeadas, f);
    try {
      const chaves = await carregarChavesApontadasAtivas(tid, f.cdDono);
      linhas = filtrarLinhasPorApontado(linhas, chaves, apontadoModo);
    } catch (eAp) {
      if (!(eAp && (eAp.code === '42P01' || eAp.code === '42703'))) throw eAp;
    }
    const avisos = [
      ...(avisosVenc || []),
      avisoFiltroApontado(apontadoModo),
      'Modo entrada: quantidade conferida na NF encerrada (não desconta saídas).',
      'Faixas: Vencido (< 0 dias), Crítico (≤ 30 dias), Curto (dentro do horizonte escolhido).',
    ].filter(Boolean);
    const filtroDonoLabel = montarRotuloFiltroDono(f.cdDono, linhasMapeadas);
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    return respondRelatorio(req, res, {
      linhas,
      avisos,
      filtroDonoLabel,
      filtroProdutoLabel,
      geradoEm,
      csvName: 'wms-shelf-life-entrada.csv',
      linhasCsv: linhasVencimentoParaCsv,
      buildHtml: buildShelfLifeHtml,
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarShelfLifeRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de shelf-life.' });
  }
}

function rotuloFiltroOrigemConversao(origem) {
  const o = String(origem || 'todos').trim().toLowerCase();
  if (o === 'operacional') return 'Somente catálogo OL';
  if (o === 'depara') return 'Somente de-para NF';
  return 'Catálogo OL + de-para NF';
}

async function listarConversaoEmbalagemRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    const origem = String(req.query.origem || 'todos').trim().toLowerCase();
    const { linhas: linhasBrutas, avisos } = await listarConversaoEmbalagem(tid, f.cdDono, { origem });
    const linhas = filtrarLinhasPorProduto(linhasBrutas, f);
    const filtroDonoLabel = montarRotuloFiltroDono(f.cdDono, linhasBrutas);
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    const filtroOrigemLabel = rotuloFiltroOrigemConversao(origem);
    const geradoEm = new Date().toISOString();
    return respondRelatorio(req, res, {
      linhas,
      avisos: [
        ...(avisos || []),
        'Revise periodicamente fatores incorretos — impactam validação de expedição e saldo.',
      ],
      filtroDonoLabel,
      filtroProdutoLabel,
      filtroOrigemLabel,
      geradoEm,
      csvName: 'wms-conversao-embalagem.csv',
      linhasCsv: linhasConversaoParaCsv,
      buildHtml: (payload) =>
        buildConversaoEmbalagemHtml({
          ...payload,
          filtroOrigemLabel,
        }),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarConversaoEmbalagemRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de conversão de embalagem.' });
  }
}

async function coletarLinhasShelfParaApontar(tid, f, opts = {}) {
  const modo = String(opts.modo || 'saldo').trim().toLowerCase();
  const horizonteDias = parseHorizonteDiasOverride(opts.horizonteDias);
  const dataReferencia = parseDataReferenciaIso(opts.dataReferencia);
  const apontadoModo = parseApontadoModo(opts.apontadoModo);
  const somenteVencidos = opts.somenteVencidos === true;

  if (modo === 'cobranca' || modo === 'vencidos-cobranca') {
    const { rows } = await listarShelfLifeCobranca(tid, f.cdDono, {
      somenteVencidos,
      apontadoModo,
      dataReferencia,
    });
    return filtrarLinhasPorProduto(rows, f);
  }
  if (modo === 'entrada') {
    const { rows } = await listarRelatorioVencimentoPorRecebimentoEncerrado(tid, f.cdDono, {
      horizonteDias,
      dataReferencia,
    });
    let linhas = filtrarLinhasPorProduto(mapLinhasShelfLife(rows), f);
    const chaves = await carregarChavesApontadasAtivas(tid, f.cdDono);
    return filtrarLinhasPorApontado(linhas, chaves, apontadoModo);
  }
  const { rows } = await listarShelfLifeSaldoPorValidade(tid, f.cdDono, {
    horizonteDias,
    dataReferencia,
    apontadoModo,
  });
  return filtrarLinhasPorProduto(rows, f);
}

function pickApontadoOptsFromReq(req) {
  const src = { ...(req.query || {}), ...((req.body && typeof req.body === 'object' && req.body) || {}) };
  const somenteRaw = src.somenteVencidos ?? src.somente_vencidos;
  return {
    modo: String(src.modo || 'saldo').trim().toLowerCase(),
    horizonteDias: src.horizonteDias ?? src.horizonte_dias ?? src.diasHorizonte,
    dataReferencia:
      src.dataReferencia ?? src.data_referencia ?? src.dataBase ?? src.data_base ?? src.aPartirDe,
    apontadoModo: parseApontadoModo(src.apontado ?? src.apontamento ?? src.apontadoModo),
    somenteVencidos:
      String(somenteRaw || '') === '1' || String(somenteRaw || '').toLowerCase() === 'true',
  };
}

async function listarShelfLifeApontados(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    let lim = parseInt(req.query.limit, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 200;
    if (lim > 500) lim = 500;
    const out = await listarApontados(tid, { cdDono: f.cdDono, limit: lim });
    return res.json({ apontados: out.rows, aviso: out.aviso || null, ok: out.ok !== false });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarShelfLifeApontados:', e);
    return res.status(500).json({ error: 'Erro ao listar apontados.' });
  }
}

async function marcarShelfLifeApontados(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const linhasBody = Array.isArray(body.linhas) ? body.linhas : [];
    let linhas = linhasBody;
    if (body.marcarFiltroAtual === true || !linhasBody.length) {
      const f = pickFiltros(req);
      const opts = pickApontadoOptsFromReq(req);
      linhas = await coletarLinhasShelfParaApontar(tid, f, opts);
    }
    const stats = await marcarLinhasApontadas(tid, sg, linhas, 'MANUAL');
    return res.json({ ok: true, ...stats, totalLinhasConsulta: linhas.length });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] marcarShelfLifeApontados:', e);
    return res.status(500).json({ error: 'Erro ao marcar apontados.' });
  }
}

async function desmarcarShelfLifeApontados(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ids = Array.isArray(body.ids) ? body.ids : body.cdApontado != null ? [body.cdApontado] : [];
    const linhas = Array.isArray(body.linhas) ? body.linhas : [];
    let out = { desmarcadas: 0 };
    if (ids.length) out = await desapontarPorIds(tid, sg, ids);
    else if (linhas.length) out = await desapontarPorChaves(tid, sg, linhas);
    return res.json({ ok: true, ...out });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] desmarcarShelfLifeApontados:', e);
    return res.status(500).json({ error: 'Erro ao desmarcar apontados.' });
  }
}

async function coletarLinhasShelfParaBaixa(req) {
  const tid = tenantIdForRequest(req);
  const f = pickFiltros(req);
  const opts = pickApontadoOptsFromReq(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (Array.isArray(body.linhas) && body.linhas.length) {
    return { linhas: body.linhas, cdDono: f.cdDono };
  }
  if (body.usarFiltroAtual === true || body.marcarFiltroAtual === true || !body.linhas) {
    const linhas = await coletarLinhasShelfParaApontar(tid, f, opts);
    return { linhas, cdDono: f.cdDono };
  }
  return { linhas: [], cdDono: f.cdDono };
}

async function listarMotivosBaixaEstoque(req, res) {
  try {
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const motivos = await listarMotivosBaixa();
    return res.json({ motivos });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarMotivosBaixaEstoque:', e);
    return res.status(500).json({ error: 'Erro ao listar motivos de baixa.' });
  }
}

async function previewBaixaShelfLife(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const cdMotivo =
      body.cdMotivoBaixa != null
        ? body.cdMotivoBaixa
        : body.cdMotivo != null
          ? body.cdMotivo
          : body.codigoMotivo;
    const { linhas, cdDono } = await coletarLinhasShelfParaBaixa(req);
    const out = await previewBaixaEstoque(tid, cdMotivo, linhas, { cdDonoUnico: cdDono });
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] previewBaixaShelfLife:', e);
    return res.status(500).json({ error: 'Erro ao montar prévia da baixa.' });
  }
}

async function confirmarBaixaShelfLife(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const cdMotivo =
      body.cdMotivoBaixa != null
        ? body.cdMotivoBaixa
        : body.cdMotivo != null
          ? body.cdMotivo
          : body.codigoMotivo;
    const { linhas, cdDono } = await coletarLinhasShelfParaBaixa(req);
    const out = await confirmarBaixaEstoque(tid, sg, {
      cdMotivoBaixa: cdMotivo,
      linhas,
      cdDono,
      observacao: body.observacao,
      marcarApontados: body.marcarApontados === true,
      origem: body.origem || 'SHELF_LIFE',
    });
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] confirmarBaixaShelfLife:', e);
    return res.status(500).json({ error: 'Erro ao confirmar baixa de estoque.' });
  }
}

async function listarHistoricoBaixasShelfLife(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltros(req);
    let lim = parseInt(req.query.limit, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 100;
    const out = await listarHistoricoBaixas(tid, { cdDono: f.cdDono, limit: lim });
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarHistoricoBaixasShelfLife:', e);
    return res.status(500).json({ error: 'Erro ao listar histórico de baixas.' });
  }
}

async function listarDetalheBaixaShelfLife(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await listarLinhasBaixa(tid, req.params.cdBaixa);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarDetalheBaixaShelfLife:', e);
    return res.status(500).json({ error: 'Erro ao buscar detalhe da baixa.' });
  }
}

async function listarHistoricoEnvioShelfLife(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    let lim = parseInt(req.query.limit, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 50;
    if (lim > 200) lim = 200;
    const out = await listarHistoricoEnvioRelatorioVencimento(pool, tid, lim);
    return res.json({ envios: out.rows, aviso: out.aviso || null });
  } catch (e) {
    console.error('[WMS relatorios] listarHistoricoEnvioShelfLife:', e);
    return res.status(500).json({ error: 'Erro ao listar histórico de envios.' });
  }
}

async function listarSeparacaoOplRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltrosSeparacaoOpl(req);
    const modo = String(req.query.modo || '').trim().toLowerCase();
    const { linhas: linhasBrutas, avisos } = await listarSeparacaoOplItens(tid, f);
    const linhas = filtrarLinhasPorProduto(linhasBrutas, f);
    const filtroDonoLabel = montarRotuloFiltroDono(f.cdDono, linhasBrutas);
    const filtroProdutoLabel = montarRotuloFiltroProduto(f);
    const filtroPeriodoLabel = montarRotuloFiltroPeriodo(f);
    const filtroSituacaoLabel = montarRotuloFiltroSituacao(f);
    const filtroEspelhoLabel = montarRotuloFiltroEspelho(f);
    const filtroPedidoDestinoLabel = montarRotuloFiltroPedidoDestino(f);
    const filtroTipoPeriodoLabel = montarRotuloTipoPeriodo(f);
    const resumoPorCodigo = resumirPorCodigo(linhas);
    const resumoPorEspelho = resumirPorEspelho(linhas);
    const geradoEm = new Date().toISOString();
    const formato = String(req.query.formato || '').trim().toLowerCase();
    if (formato === 'csv' && modo === 'resumo') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="wms-separacao-opl-resumo.csv"');
      let csvBody = linhasResumoParaCsv(resumoPorCodigo);
      if (filtroPeriodoLabel) csvBody = `Período;${filtroPeriodoLabel}\n${csvBody}`;
      return res.send(`\uFEFF${csvBody}`);
    }
    return respondRelatorio(req, res, {
      linhas,
      avisos,
      filtroDonoLabel,
      filtroProdutoLabel,
      filtroPeriodoLabel,
      filtroSituacaoLabel,
      filtroEspelhoLabel,
      filtroPedidoDestinoLabel,
      filtroTipoPeriodoLabel,
      resumoPorCodigo,
      resumoPorEspelho,
      geradoEm,
      csvName: 'wms-separacao-opl.csv',
      linhasCsv: linhasSeparacaoParaCsv,
      buildHtml: (payload) =>
        buildSeparacaoOplHtml({
          ...payload,
          filtroSituacaoLabel,
          filtroEspelhoLabel,
          filtroPedidoDestinoLabel,
          filtroTipoPeriodoLabel,
          resumoPorCodigo,
          resumoPorEspelho,
        }),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS relatorios] listarSeparacaoOplRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de separação OPL.' });
  }
}

function pickComparativoNfOplFiltros(req) {
  const cdCargaRaw = req.query.cdCarga ?? req.query.cd_carga;
  const cdCarga = cdCargaRaw != null && cdCargaRaw !== '' ? parseInt(cdCargaRaw, 10) : null;
  const cdDonoRaw = req.query.cdDono ?? req.query.cd_dono;
  const cdDono = cdDonoRaw != null && cdDonoRaw !== '' ? parseInt(cdDonoRaw, 10) : null;
  const prod = normalizarFiltrosProdutoQuery(req.query);
  return {
    tenantId: tenantIdForRequest(req),
    cdCarga: Number.isFinite(cdCarga) ? cdCarga : null,
    dataIni: String(req.query.dataIni || req.query.data_ini || '').trim() || null,
    dataFim: String(req.query.dataFim || req.query.data_fim || '').trim() || null,
    status: String(req.query.status || '').trim().toUpperCase() || null,
    cdDono: Number.isFinite(cdDono) ? cdDono : null,
    nmDono: String(req.query.nmDono || req.query.nm_dono || '').trim() || null,
    exibirCargas: String(req.query.exibirCargas || req.query.exibir_cargas || 'com_divergencia').trim(),
    codigoProduto: prod.codigoProduto,
    descricaoProduto: prod.descricaoProduto,
    modo: String(req.query.modo || 'analitico').trim().toLowerCase(),
    tipoDivergencia: String(
      req.query.tipoDivergencia || req.query.tipo_divergencia || 'tudo'
    ).trim(),
  };
}

async function listarComparativoNfOplRelatorio(req, res) {
  const opts = pickComparativoNfOplFiltros(req);
  const modo =
    opts.modo === 'sintetico' ? 'sintetico' : 'analitico';
  try {
    const { linhas, linhasSintetico, filtroTipo, cargasOk, avisos, resumo, geradoEm } =
      await listarComparativoNfOpl(opts);
    const filtroDonoLabel = opts.nmDono
      ? opts.nmDono
      : opts.cdDono != null
        ? montarRotuloFiltroDono(opts.cdDono, linhas)
        : 'Todos os donos';
    const filtroPeriodoLabel = montarRotuloFiltroPeriodo(opts.dataIni, opts.dataFim);
    const filtroProdutoLabel = montarRotuloFiltroProduto(opts);
    const filtroTipoLabel = labelFiltroTipoDivergencia(filtroTipo);
    const csvName =
      modo === 'sintetico'
        ? 'wms-comparativo-nf-opl-sintetico.csv'
        : 'wms-comparativo-nf-opl-analitico.csv';
    return respondRelatorio(req, res, {
      linhas: modo === 'sintetico' ? linhasSintetico : linhas,
      avisos,
      resumo,
      cargasOk,
      geradoEm,
      filtroDonoLabel,
      filtroPeriodoLabel,
      filtroProdutoLabel,
      csvName,
      linhasCsv:
        modo === 'sintetico'
          ? linhasComparativoSinteticoParaCsv
          : linhasComparativoNfOplParaCsv,
      buildHtml: (payload) =>
        buildComparativoNfOplHtml({
          ...payload,
          linhas,
          linhasSintetico,
          modo,
          filtroTipo,
          filtroTipoLabel,
          cargasOk,
          resumo,
        }),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    if (e && e.code === 'FILTRO') return res.status(400).json({ error: e.message });
    console.error('[WMS relatorios] listarComparativoNfOplRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar comparativo NF × separação.' });
  }
}

async function listarRotasDemandaDiaRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const rotas = await listarRotasDemandaDia(tid);
    return res.json({ rotas });
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return res.json({ rotas: [] });
    console.error('[WMS relatorios] listarRotasDemandaDiaRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao listar rotas.' });
  }
}

async function listarDemandaDiaRelatorio(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const data = await montarDemandaDia(tid, req.query);
    const geradoEm = new Date().toISOString();
    const formato = String(req.query.formato || '').trim().toLowerCase();
    if (formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="wms-demanda-dia.csv"');
      return res.send('\uFEFF' + demandaDiaParaCsv(data));
    }
    if (formato === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildDemandaDiaHtml({ ...data, geradoEm }));
    }
    return res.json({ ...data, geradoEm });
  } catch (e) {
    if (e && e.code === 'FILTRO') return res.status(400).json({ error: e.message });
    if (e && (e.code === '42P01' || e.code === '42703')) {
      return res.status(503).json({ error: 'Estrutura de cargas ou de pedidos OPL indisponível neste banco.' });
    }
    console.error('[WMS relatorios] listarDemandaDiaRelatorio:', e);
    return res.status(500).json({ error: 'Erro ao gerar a demanda do dia.' });
  }
}

module.exports = {
  listarPosicaoEstoqueRelatorio,
  listarMovimentacaoRelatorio,
  listarDemonstrativoMovimentacaoRelatorio,
  listarSeparacaoOplRelatorio,
  listarComparativoNfOplRelatorio,
  listarShelfLifeRelatorio,
  listarConversaoEmbalagemRelatorio,
  listarHistoricoEnvioShelfLife,
  listarShelfLifeApontados,
  marcarShelfLifeApontados,
  desmarcarShelfLifeApontados,
  listarMotivosBaixaEstoque,
  previewBaixaShelfLife,
  confirmarBaixaShelfLife,
  listarHistoricoBaixasShelfLife,
  listarDetalheBaixaShelfLife,
  listarDemandaDiaRelatorio,
  listarRotasDemandaDiaRelatorio,
};
