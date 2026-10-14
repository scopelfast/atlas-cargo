'use strict';

const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const svc = require('../services/wms-inventario.service');
const {
  buildInventarioAtaHtml,
  linhasAtaParaCsv,
} = require('../services/wms-inventario-ata-html.service');
const { buildListaCiclicaHtml } = require('../services/wms-inventario-lista-ciclica-html.service');
const { enriquecerLinhasPosicaoCadastro, rotuloDonoRelatorio } = require('../services/wms-relatorio-posicao-estoque.service');
const {
  parseOrdemQuery,
  normalizarModoSeparadores,
} = require('../services/wms-relatorio-separadores-cadastro.service');
const { findByLogin } = require('../models/user.model');

function pickRelatorioListaOpts(req) {
  const q = req.query || {};
  const b = req.body || {};
  const separadores =
    q.separadores != null
      ? String(q.separadores)
      : b.separadores != null
        ? String(b.separadores)
        : '';
  const ordem = parseOrdemQuery(q.ordem != null ? q.ordem : b.ordem);
  return { separadoresGrupo: separadores, ordem };
}

function precisaCadastroWmsRelatorio(modoSep, ordem) {
  return (
    (modoSep && modoSep !== 'nao') ||
    (ordem || []).some((c) =>
      ['grupo', 'subcategoria', 'categoria', 'classe', 'conservacao', 'conservacao_faixas'].includes(c)
    )
  );
}

async function enriquecerLinhasRelatorio(tenantId, linhas, modoSep, ordem) {
  if (!precisaCadastroWmsRelatorio(modoSep, ordem)) return linhas || [];
  return enriquecerLinhasPosicaoCadastro(tenantId, linhas || []);
}

async function resolverUsuarioGeracaoAta(req, sg) {
  const login = String(sg || '').trim();
  if (!login) return { login: '', nome: '' };
  const nomeJwt = req.user && req.user.nome ? String(req.user.nome).trim() : '';
  if (nomeJwt) return { login, nome: nomeJwt };
  try {
    const u = await findByLogin(login);
    const nomeDb = u && u.NMUSUARIO ? String(u.NMUSUARIO).trim() : '';
    if (nomeDb) return { login, nome: nomeDb };
  } catch (_) {
    /* fallback só login */
  }
  return { login, nome: '' };
}

const ORIENTACAO_MD = path.join(__dirname, '../../docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md');
const MANUAL_MD = path.join(__dirname, '../../docs/WMS_INVENTARIO_MANUAL_OPERADOR.md');

/** Constrói um detalhe legível para o operador quando um erro 500 escapa
 *  para o controller. Inclui o código pg (ex.: 42703 = column missing,
 *  23514 = check violation) e a mensagem curta — sem stack trace.
 *  Crítico para diagnosticar problemas de schema/constraint sem precisar
 *  abrir o log do servidor. */
function detalheErro(e) {
  if (!e) return '';
  const code = e.code ? '[' + e.code + '] ' : '';
  const msg = String(e.message || e).split('\n')[0].slice(0, 240);
  return code + msg;
}

const PLANILHA_TEMPLATE_CSV =
  'CODIGO_PRODUTO;QTD_CONTADA;LOTE;VALIDADE;FATOR_CONVERSAO;ENDERECO;OBSERVACAO\n' +
  '6010305100;120;L202604;2026-12-31;1;RUA-A-01;\n' +
  '6320200100;48;L202605;2027-03-15;1;CAMARA-02;\n';

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.csv') || n.endsWith('.txt')) return cb(null, true);
    cb(new Error('Envie arquivo .csv ou .txt.'));
  },
});

async function obterOrientacao(req, res) {
  try {
    const text = await fs.readFile(ORIENTACAO_MD, 'utf8');
    res.type('text/markdown; charset=utf-8').send(text);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Documento de orientação não encontrado.' });
    }
    console.error('[WMS inventario] obterOrientacao:', e);
    res.status(500).json({ error: 'Erro ao carregar orientação.' });
  }
}

async function obterManualOperador(req, res) {
  try {
    const text = await fs.readFile(MANUAL_MD, 'utf8');
    res.type('text/markdown; charset=utf-8').send(text);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return res.status(404).json({ error: 'Manual do operador não encontrado.' });
    }
    console.error('[WMS inventario] obterManualOperador:', e);
    res.status(500).json({ error: 'Erro ao carregar manual.' });
  }
}

function downloadPlanilhaModelo(req, res) {
  const nome = 'wms-inventario-planilha-modelo.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send('\uFEFF' + PLANILHA_TEMPLATE_CSV);
}

async function listar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const rows = await svc.listarInventarios(tid, {
      cdDono: req.query.cd_dono ?? req.query.cdDono,
      stInventario: req.query.st ?? req.query.st_inventario,
    });
    res.json(rows);
  } catch (e) {
    console.error('[WMS inventario] listar:', e);
    res.status(500).json({ error: 'Erro ao listar inventários.' });
  }
}

async function consultarItens(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const r = await svc.consultarItensInventario(tid, {
      cdDono: req.query.cd_dono ?? req.query.cdDono,
      codigoProduto:
        req.query.codigo ?? req.query.codigo_produto ?? req.query.codigoProduto,
      descricaoProduto:
        req.query.descricao ?? req.query.descricao_produto ?? req.query.descricaoProduto,
      cdInventario: req.query.cd_inventario ?? req.query.cdInventario,
      dtDe: req.query.dt_de ?? req.query.dtDe,
      dtAte: req.query.dt_ate ?? req.query.dtAte,
      stInventario: req.query.st ?? req.query.st_inventario,
      tpInventario: req.query.tp ?? req.query.tp_inventario,
    });
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r);
  } catch (e) {
    console.error('[WMS inventario] consultarItens:', e);
    res.status(500).json({ error: 'Erro ao consultar histórico de inventário por item.' });
  }
}

async function obterDetalhe(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const det = await svc.obterInventarioDetalhe(tid, cd);
    if (!det) return res.status(404).json({ error: 'Inventário não encontrado.' });
    res.json(det);
  } catch (e) {
    console.error('[WMS inventario] obterDetalhe:', e);
    res.status(500).json({ error: 'Erro ao carregar inventário.' });
  }
}

async function criar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const r = await svc.criarInventario(tid, req.body || {}, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.status(201).json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] criar:', e);
    res.status(500).json({ error: 'Erro ao criar inventário.' });
  }
}

async function gerarSnapshot(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await svc.gerarSnapshotInventario(tid, cd, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] gerarSnapshot:', e);
    res.status(500).json({ error: 'Erro ao gerar snapshot.' });
  }
}

function normLinhaImportBody(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const codigo = String(raw.codigoProduto ?? raw.CODIGO_PRODUTO ?? '').trim();
  if (!codigo) return null;
  const qtdRaw = raw.qtdContada ?? raw.QTD_CONTADA;
  const qtd =
    qtdRaw == null || qtdRaw === ''
      ? null
      : Number(String(qtdRaw).trim().replace(',', '.'));
  return {
    codigoProduto: codigo,
    qtdContada: qtd != null && Number.isFinite(qtd) ? qtd : null,
    lote: raw.lote != null || raw.LOTE != null ? String(raw.lote ?? raw.LOTE ?? '').trim() : '',
    validade:
      raw.validade != null || raw.VALIDADE != null
        ? String(raw.validade ?? raw.VALIDADE ?? '').trim()
        : '',
    fatorConversao: raw.fatorConversao ?? raw.FATOR_CONVERSAO,
    endereco: raw.endereco ?? raw.ENDERECO,
    observacao: raw.observacao ?? raw.OBSERVACAO,
  };
}

async function importarLinhas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const bruto = req.body && (req.body.linhas ?? req.body.rows);
    if (!Array.isArray(bruto) || !bruto.length) {
      return res.status(400).json({ error: 'Envie ao menos uma linha em "linhas".' });
    }
    const rows = [];
    for (let i = 0; i < bruto.length; i++) {
      const n = normLinhaImportBody(bruto[i]);
      if (!n) return res.status(400).json({ error: `Linha ${i + 1}: CODIGO_PRODUTO é obrigatório.` });
      rows.push(n);
    }
    const r = await svc.importarLinhasInventario(tid, cd, rows, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] importarLinhas:', e);
    res.status(500).json({ error: 'Erro ao importar linha(s).' });
  }
}

function importarCsv(req, res) {
  uploadCsv.single('arquivo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload.' });
    try {
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      const cd = parseInt(req.params.cdInventario, 10);
      if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Envie o arquivo no campo "arquivo".' });
      }
      const parsed = svc.parseCsvInventario(req.file.buffer.toString('utf8'));
      if (parsed.err) return res.status(422).json({ error: parsed.err });
      const r = await svc.importarLinhasInventario(tid, cd, parsed.ok, sg);
      if (r.err) return res.status(r.status || 400).json({ error: r.err });
      res.json(r.ok);
    } catch (e) {
      console.error('[WMS inventario] importarCsv:', e);
      res.status(500).json({ error: 'Erro ao importar planilha.' });
    }
  });
}

async function encerrar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await svc.encerrarInventario(tid, cd, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] encerrar:', e);
    res.status(500).json({ error: 'Erro ao encerrar inventário.' });
  }
}

async function relatorioAta(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const det = await svc.obterInventarioDetalhe(tid, cd);
    if (!det) return res.status(404).json({ error: 'Inventário não encontrado.' });
    const formato = String(req.query.formato || 'html').trim().toLowerCase();
    const previaParam = String(req.query.previa || '').trim().toLowerCase();
    const previa =
      previaParam === '1' ||
      previaParam === 'true' ||
      previaParam === 's' ||
      (previaParam !== '0' &&
        previaParam !== 'false' &&
        previaParam !== 'n' &&
        String(det.cabecalho.ST_INVENTARIO || '').toUpperCase() !== 'ENCERRADO');
    const geradoEm = new Date().toISOString();
    const usuarioGeracao = await resolverUsuarioGeracaoAta(req, sg);
    const { separadoresGrupo, ordem } = pickRelatorioListaOpts(req);
    const modoSep = normalizarModoSeparadores(separadoresGrupo);
    const linhasEnriquecidas = await enriquecerLinhasRelatorio(tid, det.linhas, modoSep, ordem);
    const payload = {
      cabecalho: det.cabecalho,
      linhas: linhasEnriquecidas,
      resumoSku: det.resumoSku,
      geradoEm,
      previa,
      usuarioGeracao,
      separadoresGrupo,
      ordem,
    };
    if (formato === 'csv') {
      const nome = `wms-inventario-ata-${cd}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      return res.send('\uFEFF' + linhasAtaParaCsv(payload));
    }
    if (formato === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildInventarioAtaHtml(payload));
    }
    return res.status(400).json({ error: 'Use formato=html ou formato=csv.' });
  } catch (e) {
    console.error('[WMS inventario] relatorioAta:', e);
    res.status(500).json({ error: 'Erro ao gerar ata de inventário.' });
  }
}

async function cancelar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await svc.cancelarInventario(tid, cd, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] cancelar:', e);
    res.status(500).json({ error: 'Erro ao cancelar inventário.' });
  }
}

/** Reabre inventário CANCELADO (só status) ou ENCERRADO (estorna ajustes do ledger). */
async function reativar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await svc.reativarInventario(tid, cd, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] reativar:', e);
    res.status(500).json({ error: 'Erro ao reabrir inventário.' });
  }
}

function payloadListaCiclica(req) {
  const b = req.body || {};
  return {
    cdDono: parseInt(b.cdDono ?? b.CD_DONO, 10),
    criterio: String(b.criterio || '').toUpperCase(),
    limite: parseInt(b.limite, 10),
    diasJanela: parseInt(b.diasJanela, 10),
    conservacao: String(b.conservacao || '').trim(),
    /** Legado: "categoria" era palavra-chave no nome; preferir palavraChave. */
    palavraChave: String(b.palavraChave || '').trim(),
    categoria: String(b.categoria || '').trim(),
    codigoProduto: String(b.codigoProduto ?? b.codigo ?? '').trim(),
    /** Mesmos filtros textuais do relatório Saldo de estoque. */
    grupoProduto: String(b.grupoProduto || b.grupoContem || '').trim(),
    categoriaProduto: String(b.categoriaProduto || '').trim(),
    cdGrupo: parseInt(b.cdGrupo ?? b.CD_GRUPO, 10),
    cdCategoria: parseInt(b.cdCategoria ?? b.CD_CATEGORIA, 10),
    observacao: String(b.observacao || '').trim().slice(0, 500),
  };
}

/** Preview da lista — não persiste nada. Query/body opcional: formato=html, separadores, ordem. */
async function previewListaCiclica(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const payload = payloadListaCiclica(req);
    const r = await svc.gerarListaCiclica(tid, payload);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    const ok = r.ok;
    ok.linhas = await enriquecerLinhasPosicaoCadastro(tid, ok.linhas || []);
    const formato = String(req.query.formato || (req.body && req.body.formato) || '')
      .trim()
      .toLowerCase();
    if (formato === 'html') {
      const { separadoresGrupo, ordem } = pickRelatorioListaOpts(req);
      const donoLabel = await rotuloDonoRelatorio(tid, payload.cdDono);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        buildListaCiclicaHtml({
          linhas: ok.linhas,
          cabecalho: {
            criterio: ok.criterio,
            diasJanela: ok.diasJanela,
            limite: ok.limite,
            donoLabel,
          },
          geradoEm: new Date().toISOString(),
          separadoresGrupo,
          ordem,
        })
      );
    }
    res.json(ok);
  } catch (e) {
    console.error('[WMS inventario] previewListaCiclica:', e);
    res.status(500).json({ error: 'Erro ao gerar lista cíclica.' });
  }
}

/** Fase 3b: marca uma linha para recontagem. */
async function recontarLinha(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const r = await svc.marcarLinhaRecontagem(tid, cdInv, cdLin, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] recontarLinha:', e);
    res.status(500).json({ error: 'Erro ao marcar recontagem: ' + detalheErro(e) });
  }
}

/** Fase 3b: supervisor aprova divergência (ou aceita CONTADO antes do encerramento). */
async function aprovarLinha(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const r = await svc.aprovarLinhaSupervisor(tid, cdInv, cdLin, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] aprovarLinha:', e);
    res.status(500).json({ error: 'Erro ao aprovar linha: ' + detalheErro(e) });
  }
}

/** Edição inline de lote e/ou validade de uma linha. */
async function atualizarLoteValidade(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const body = req.body || {};
    /** Aceita payload parcial — só atualiza o que veio. */
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(body, 'lote')) payload.lote = body.lote;
    if (Object.prototype.hasOwnProperty.call(body, 'validade')) payload.validade = body.validade;
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'Informe lote e/ou validade.' });
    }
    const r = await svc.atualizarLoteValidadeLinha(tid, cdInv, cdLin, payload, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] atualizarLoteValidade:', e);
    res.status(500).json({ error: 'Erro ao atualizar lote/validade: ' + detalheErro(e) });
  }
}

/** Cria uma "linha-irmã" do mesmo SKU com lote/validade diferentes. Usado
 *  quando o operador descobre múltiplas validades reais em campo. */
async function dividirLinha(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const body = req.body || {};
    const r = await svc.dividirLinhaInventario(
      tid,
      cdInv,
      cdLin,
      { lote: body.lote, validade: body.validade, qtdContada: body.qtdContada },
      sg
    );
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.status(201).json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] dividirLinha:', e);
    res.status(500).json({ error: 'Erro ao dividir linha: ' + detalheErro(e) });
  }
}

/** Adiciona uma linha MANUAL ao inventário aberto. Permite ao operador
 *  inserir um SKU que não estava na lista cíclica nem no snapshot — útil
 *  quando ele encontra produto novo em campo. */
async function adicionarLinhaManual(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cdInv)) return res.status(400).json({ error: 'Inventário inválido.' });
    const body = req.body || {};
    const r = await svc.adicionarLinhaManualInventario(
      tid,
      cdInv,
      {
        codigoProduto: body.codigoProduto,
        lote: body.lote,
        validade: body.validade,
        qtdContada: body.qtdContada,
      },
      sg
    );
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.status(201).json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] adicionarLinhaManual:', e);
    res.status(500).json({ error: 'Erro ao adicionar SKU ao inventário: ' + detalheErro(e) });
  }
}

/** Sugere validade (mais curta) + lote para o modal Adicionar SKU. */
async function sugerirValidade(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cdInv)) return res.status(400).json({ error: 'Inventário inválido.' });
    const codigo = String(req.query.codigo || req.query.codigoProduto || '').trim();
    const r = await svc.sugerirValidadeInventario(tid, cdInv, codigo);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] sugerirValidade:', e);
    res.status(500).json({ error: 'Erro ao sugerir validade.' });
  }
}

/** Exclui uma linha do inventário. Útil para descartar a "linha-fantasma"
 *  que sobra depois que o operador desmembrou um SKU em várias validades
 *  reais via Dividir. Veja regras de segurança no serviço (não permite
 *  excluir em inventário ENCERRADO/CANCELADO ou linha APROVADA). */
async function excluirLinha(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const r = await svc.excluirLinhaInventario(tid, cdInv, cdLin, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] excluirLinha:', e);
    res.status(500).json({ error: 'Erro ao excluir linha: ' + detalheErro(e) });
  }
}

/** Edição inline: registra a contagem de uma linha específica e devolve o
 *  novo `ST_LINHA` calculado (CONTADO/DIVERGENTE/PENDENTE). */
async function registrarContagem(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    const cdLin = parseInt(req.params.cdLinha, 10);
    if (!Number.isFinite(cdInv) || !Number.isFinite(cdLin)) {
      return res.status(400).json({ error: 'Códigos inválidos.' });
    }
    const body = req.body || {};
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(body, 'qtdContada')) payload.qtdContada = body.qtdContada;
    if (Object.prototype.hasOwnProperty.call(body, 'lote')) payload.lote = body.lote;
    if (Object.prototype.hasOwnProperty.call(body, 'validade')) payload.validade = body.validade;
    const r = await svc.registrarContagemLinha(tid, cdInv, cdLin, payload, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] registrarContagem:', e);
    res.status(500).json({ error: 'Erro ao registrar contagem: ' + detalheErro(e) });
  }
}

/** Fase 3b: define a tolerância (%) do inventário e recalcula linhas. */
async function definirTolerancia(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdInv = parseInt(req.params.cdInventario, 10);
    if (!Number.isFinite(cdInv)) return res.status(400).json({ error: 'Código inválido.' });
    const pct = (req.body || {}).pct;
    const r = await svc.definirToleranciaInventario(tid, cdInv, pct, sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] definirTolerancia:', e);
    res.status(500).json({ error: 'Erro ao definir tolerância: ' + detalheErro(e) });
  }
}

/** Cria o inventário CICLICO + linhas geradas em uma única transação. */
async function criarCiclico(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const r = await svc.criarInventarioCiclicoComLista(tid, payloadListaCiclica(req), sg);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.status(201).json(r.ok);
  } catch (e) {
    console.error('[WMS inventario] criarCiclico:', e);
    res.status(500).json({ error: 'Erro ao criar inventário cíclico.' });
  }
}

module.exports = {
  obterOrientacao,
  obterManualOperador,
  downloadPlanilhaModelo,
  listar,
  consultarItens,
  obterDetalhe,
  criar,
  gerarSnapshot,
  importarCsv,
  importarLinhas,
  encerrar,
  cancelar,
  reativar,
  relatorioAta,
  uploadCsv,
  previewListaCiclica,
  criarCiclico,
  recontarLinha,
  aprovarLinha,
  registrarContagem,
  atualizarLoteValidade,
  dividirLinha,
  excluirLinha,
  adicionarLinhaManual,
  sugerirValidade,
  definirTolerancia,
};
