'use strict';

/**
 * Atlas Pay — contrato, cobrança de conexão e baixa manual (fases 1 e 2).
 * Sem Pix, bloqueio ou fechamento de uso da plataforma.
 */

const { pool } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const fusoSp = require('./financeiro-fuso-sp');

class ErroFinanceiro extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Normaliza body.dhInicio → parede SP `YYYY-MM-DD HH:MM:SS` (data só → 00:00:00). */
function parseDhInicioBody(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const onlyDate = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const wall = fusoSp.toSpWall(onlyDate ? s + ' 00:00:00' : s);
  if (!wall) {
    throw new ErroFinanceiro(
      'Início da vigência inválido. Use AAAA-MM-DD (fuso America/Sao_Paulo).',
      400,
      'DH_INICIO_INVALIDO'
    );
  }
  return wall;
}

function loginDe(req) {
  if (!req) return null;
  const u = req.user || {};
  const h = req.headers || {};
  const raw =
    h['user-login'] ||
    u.login ||
    u.SGUSUARIO ||
    u.sgusuario ||
    u.email ||
    null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function ipDe(req) {
  if (!req) return null;
  const xf = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (xf) return String(xf).split(',')[0].trim().slice(0, 64);
  return (req.ip && String(req.ip).slice(0, 64)) || null;
}

/** Converte reais (number|string) em centavos BIGINT, arredondamento comercial 2 casas. */
function reaisParaCentavos(valor) {
  if (valor == null || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const sinal = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const cent = Math.round(abs * 100 + Number.EPSILON);
  return sinal * cent;
}

function centavosParaReais(centavos) {
  const c = Number(centavos);
  if (!Number.isFinite(c)) return 0;
  return Math.round(c) / 100;
}

/**
 * Calcula centavos a partir da base VLFRETE e componentes CONEXAO ativos.
 * Arredonda cada parcela comercialmente e soma.
 */
function calcularConexaoCentavos(vlFrete, componentes) {
  const comps = Array.isArray(componentes) ? componentes.filter((c) => String(c.FG_ATIVO || c.fg_ativo || 'S').toUpperCase() === 'S') : [];
  if (!comps.length) {
    return { ok: false, code: 'SEM_COMPONENTE_CONEXAO', error: 'Contrato ativo sem componente de conexão habilitado.' };
  }

  const precisaPercentual = comps.some((c) => String(c.TIPO || c.tipo).toUpperCase() === 'PERCENTUAL');
  const base = vlFrete == null || vlFrete === '' ? null : Number(vlFrete);
  if (precisaPercentual) {
    if (base == null || !Number.isFinite(base) || base <= 0) {
      return {
        ok: false,
        code: 'VLFRETE_INVALIDO',
        error:
          'Contrato de conexão usa percentual e o frete da viagem (VLFRETE) está nulo ou menor/igual a zero. Informe o frete antes de confirmar.',
      };
    }
  }

  let total = 0;
  const memoria = [];
  for (const c of comps) {
    const tipo = String(c.TIPO || c.tipo || '').toUpperCase();
    if (tipo === 'FIXO') {
      const v = Number(c.VALOR_CENTAVOS ?? c.valor_centavos);
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, code: 'COMPONENTE_FIXO_INVALIDO', error: 'Componente fixo de conexão com valor inválido.' };
      }
      total += Math.round(v);
      memoria.push({ tipo: 'FIXO', valorCentavos: Math.round(v) });
    } else if (tipo === 'PERCENTUAL') {
      const pct = Number(c.PERCENTUAL ?? c.percentual);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return { ok: false, code: 'COMPONENTE_PERCENTUAL_INVALIDO', error: 'Percentual de conexão inválido.' };
      }
      // base * pct / 100, arredondamento comercial em 2 casas → centavos
      const parcelaReais = Math.round(base * (pct / 100) * 100 + Number.EPSILON) / 100;
      const parcelaCent = Math.round(parcelaReais * 100 + Number.EPSILON);
      total += parcelaCent;
      memoria.push({
        tipo: 'PERCENTUAL',
        percentual: pct,
        baseVlFrete: base,
        valorCentavos: parcelaCent,
      });
    }
  }

  if (total < 0) {
    return { ok: false, code: 'VALOR_NEGATIVO', error: 'Valor da cobrança inválido.' };
  }

  return {
    ok: true,
    valorCentavos: total,
    memoriaCalculo: {
      moeda: 'BRL',
      baseCampo: 'VIAGEMMESTRE.VLFRETE',
      baseValor: base,
      componentes: memoria,
      totalCentavos: total,
    },
  };
}

async function buscarContratoVigente(q, tenantId) {
  const r = await q(
    `SELECT c.*
       FROM "FIN_CONTRATO" c
      WHERE c."TENANT_ID" = $1
        AND c."DH_FIM" IS NULL
        AND c."FGACTIVE" IN ('S', 'A')
      ORDER BY c."VERSAO" DESC
      LIMIT 1`,
    [tenantId]
  );
  return (r.rows && r.rows[0]) || null;
}

async function listarComponentes(q, idContrato, grupo) {
  const params = [idContrato];
  let sql = `SELECT * FROM "FIN_CONTRATO_COMPONENTE" WHERE "ID_CONTRATO" = $1`;
  if (grupo) {
    params.push(grupo);
    sql += ` AND "GRUPO" = $2`;
  }
  sql += ` ORDER BY "GRUPO", "ORDEM", "ID"`;
  const r = await q(sql, params);
  return r.rows || [];
}

async function listarContratos(tenantId) {
  const r = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM "FIN_CONTRATO_COMPONENTE" x WHERE x."ID_CONTRATO" = c."ID") AS "QTD_COMPONENTES",
            (SELECT COUNT(*)::int FROM "FIN_CONTRATO_COMPONENTE" x
              WHERE x."ID_CONTRATO" = c."ID" AND x."GRUPO" = 'CONEXAO') AS "QTD_CONEXAO",
            (SELECT COUNT(*)::int FROM "FIN_CONTRATO_COMPONENTE" x
              WHERE x."ID_CONTRATO" = c."ID" AND x."GRUPO" = 'USO_PLATAFORMA') AS "QTD_USO",
            (SELECT COALESCE(string_agg(
                      CASE
                        WHEN x."TIPO" = 'FIXO' THEN 'Fixo R$ ' || trim(to_char(COALESCE(x."VALOR_CENTAVOS",0) / 100.0, 'FM999999990.00'))
                        WHEN x."TIPO" = 'PERCENTUAL' THEN
                          /* FM999990.#### arredonda 99.99 → 100; usa 9999 + limpa zeros */
                          NULLIF(rtrim(rtrim(to_char(round(COALESCE(x."PERCENTUAL",0)::numeric, 4), 'FM999999990.9999'), '0'), '.'), '')
                          || '% do frete'
                        WHEN x."TIPO" = 'POR_CARGA_ANUNCIADA' THEN 'R$ ' || trim(to_char(COALESCE(x."VALOR_CENTAVOS",0) / 100.0, 'FM999999990.00')) || '/anúncio'
                        ELSE x."TIPO"
                      END, ' + ' ORDER BY x."ORDEM", x."ID"), '')
               FROM "FIN_CONTRATO_COMPONENTE" x
              WHERE x."ID_CONTRATO" = c."ID" AND x."GRUPO" = 'CONEXAO') AS "RESUMO_CONEXAO",
            (SELECT COALESCE(string_agg(
                      CASE
                        WHEN x."TIPO" = 'FIXO' THEN 'Fixo R$ ' || trim(to_char(COALESCE(x."VALOR_CENTAVOS",0) / 100.0, 'FM999999990.00'))
                        WHEN x."TIPO" = 'PERCENTUAL' THEN
                          NULLIF(rtrim(rtrim(to_char(round(COALESCE(x."PERCENTUAL",0)::numeric, 4), 'FM999999990.9999'), '0'), '.'), '')
                          || '% do frete'
                        WHEN x."TIPO" = 'POR_CARGA_ANUNCIADA' THEN 'R$ ' || trim(to_char(COALESCE(x."VALOR_CENTAVOS",0) / 100.0, 'FM999999990.00')) || '/anúncio'
                        ELSE x."TIPO"
                      END, ' + ' ORDER BY x."ORDEM", x."ID"), '')
               FROM "FIN_CONTRATO_COMPONENTE" x
              WHERE x."ID_CONTRATO" = c."ID" AND x."GRUPO" = 'USO_PLATAFORMA') AS "RESUMO_USO"
       FROM "FIN_CONTRATO" c
      WHERE c."TENANT_ID" = $1
      ORDER BY c."VERSAO" DESC`,
    [tenantId]
  );
  return r.rows || [];
}

/** Assinatura estável: só publica se algo mudou vs. vigente. */
function fingerprintContrato(fgRegraAtiva, politica, comps) {
  const fg = String(fgRegraAtiva || 'N').toUpperCase() === 'S' ? 'S' : 'N';
  const pol = String(politica || 'ALERTA').toUpperCase() === 'BLOQUEIO' ? 'BLOQUEIO' : 'ALERTA';
  const norm = (Array.isArray(comps) ? comps : [])
    .map((c) => {
      const grupo = String(c.grupo || c.GRUPO || '').toUpperCase();
      const tipo = String(c.tipo || c.TIPO || '').toUpperCase();
      const fgAtivo = String(c.fgAtivo != null ? c.fgAtivo : c.FG_ATIVO != null ? c.FG_ATIVO : 'S')
        .toUpperCase()
        .startsWith('N')
        ? 'N'
        : 'S';
      let valor = null;
      let pct = null;
      if (tipo === 'FIXO' || tipo === 'POR_CARGA_ANUNCIADA') {
        const v = c.valorCentavos != null ? Number(c.valorCentavos) : Number(c.VALOR_CENTAVOS);
        valor = Number.isFinite(v) ? Math.round(v) : null;
      }
      if (tipo === 'PERCENTUAL') {
        const p = c.percentual != null ? Number(c.percentual) : Number(c.PERCENTUAL);
        pct = Number.isFinite(p) ? Number(p) : null;
      }
      return { grupo, tipo, fgAtivo, valor, pct };
    })
    .filter((c) => c.grupo && c.tipo)
    .sort((a, b) => {
      const ka = a.grupo + '|' + a.tipo;
      const kb = b.grupo + '|' + b.tipo;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  return JSON.stringify({ fg, pol, comps: norm });
}

async function obterContrato(tenantId, id) {
  const r = await pool.query(
    `SELECT * FROM "FIN_CONTRATO" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
    [id, tenantId]
  );
  const row = (r.rows && r.rows[0]) || null;
  if (!row) return null;
  row.componentes = await listarComponentes((sql, p) => pool.query(sql, p), row.ID);
  return row;
}

function grupoComp(c) {
  return String((c && (c.grupo || c.GRUPO)) || '').toUpperCase();
}

/**
 * Publica nova versão do contrato (fecha a vigente e abre outra).
 * body: { fgRegraAtiva, politicaInadimplencia, componentes: [{grupo,tipo,valorCentavos,percentual,fgAtivo,ordem}] }
 *
 * Segurança SaaS:
 * - Uso da plataforma (B), FG_REGRA_ATIVA e política de inadimplência só a Atlas (sessão default) altera.
 * - Tenant/agenciador pode republicar só a Conexão (A); o restante copia a vigente.
 * - 1ª publicação do contrato exige sessão Atlas.
 */
async function publicarContrato(tenantId, body, usuario, opts) {
  const options = opts || {};
  const permitirInicioRetroativo = !!options.permitirInicioRetroativo;
  const podeEditarUsoPlataforma = !!options.podeEditarUsoPlataforma;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vigente = await buscarContratoVigente((s, p) => client.query(s, p), tenantId);

    if (!podeEditarUsoPlataforma && !vigente) {
      throw new ErroFinanceiro(
        'Somente a Atlas (instalação padrão) publica o primeiro contrato e define o Uso da plataforma. Peça à Atlas para cadastrar a tabela comercial deste tenant.',
        403,
        'FIN_USO_SO_ATLAS'
      );
    }

    let fgRegra;
    let politica;
    if (podeEditarUsoPlataforma) {
      fgRegra =
        body.fgRegraAtiva != null
          ? String(body.fgRegraAtiva).toUpperCase() === 'S'
            ? 'S'
            : 'N'
          : vigente
            ? String(vigente.FG_REGRA_ATIVA || 'N').toUpperCase() === 'S'
              ? 'S'
              : 'N'
            : 'N';
      const polRaw = String(body.politicaInadimplencia || (vigente && vigente.POLITICA_INADIMPLENCIA) || 'ALERTA')
        .trim()
        .toUpperCase();
      politica = polRaw === 'BLOQUEIO' ? 'BLOQUEIO' : 'ALERTA';
    } else {
      // Agenciador não desliga a regra SaaS nem muda política de inadimplência.
      fgRegra = String(vigente.FG_REGRA_ATIVA || 'N').toUpperCase() === 'S' ? 'S' : 'N';
      politica =
        String(vigente.POLITICA_INADIMPLENCIA || 'ALERTA').trim().toUpperCase() === 'BLOQUEIO'
          ? 'BLOQUEIO'
          : 'ALERTA';
    }

    const compsIn = Array.isArray(body.componentes) ? body.componentes : null;
    let comps;
    if (compsIn) {
      comps = compsIn;
    } else if (vigente) {
      comps = await listarComponentes((s, p) => client.query(s, p), vigente.ID);
    } else {
      comps = [];
    }

    if (!podeEditarUsoPlataforma) {
      const compsVigUso = await listarComponentes((s, p) => client.query(s, p), vigente.ID, 'USO_PLATAFORMA');
      const conexaoBody = (comps || []).filter((c) => grupoComp(c) === 'CONEXAO');
      const usoTentado = (comps || []).filter((c) => grupoComp(c) === 'USO_PLATAFORMA');
      if (usoTentado.length) {
        const fpBodyUso = fingerprintContrato('S', 'ALERTA', usoTentado);
        const fpVigUso = fingerprintContrato('S', 'ALERTA', compsVigUso);
        if (fpBodyUso !== fpVigUso) {
          throw new ErroFinanceiro(
            'Uso da plataforma (cobrança SaaS Atlas) só pode ser alterado pela Atlas. Você pode publicar apenas mudanças na Conexão (A).',
            403,
            'FIN_USO_SO_ATLAS'
          );
        }
      }
      comps = conexaoBody.concat(compsVigUso);
    }

    const tiposPorGrupo = { CONEXAO: Object.create(null), USO_PLATAFORMA: Object.create(null) };
    for (const c of comps) {
      const grupo = String(c.grupo || c.GRUPO || '').toUpperCase();
      const tipo = String(c.tipo || c.TIPO || '').toUpperCase();
      if (!['CONEXAO', 'USO_PLATAFORMA'].includes(grupo)) {
        throw new ErroFinanceiro('Grupo de componente inválido.', 400, 'COMP_GRUPO');
      }
      if (!['FIXO', 'PERCENTUAL', 'POR_CARGA_ANUNCIADA'].includes(tipo)) {
        throw new ErroFinanceiro('Tipo de componente inválido.', 400, 'COMP_TIPO');
      }
      if (grupo === 'CONEXAO' && tipo === 'POR_CARGA_ANUNCIADA') {
        throw new ErroFinanceiro('Conexão não usa componente por carga anunciada.', 400, 'COMP_CONEXAO');
      }
      if (tiposPorGrupo[grupo][tipo]) {
        const rotulo = grupo === 'CONEXAO' ? 'Conexão' : 'Uso da plataforma';
        throw new ErroFinanceiro(
          `${rotulo}: tipo "${tipo}" repetido. No máximo 1 linha por tipo (tipos diferentes somam).`,
          400,
          'COMP_TIPO_DUPLICADO'
        );
      }
      tiposPorGrupo[grupo][tipo] = true;
      if (tipo === 'FIXO' || tipo === 'POR_CARGA_ANUNCIADA') {
        const v = c.valorCentavos != null ? Number(c.valorCentavos) : Number(c.VALOR_CENTAVOS);
        if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
          throw new ErroFinanceiro('Valor fixo deve ser inteiro em centavos ≥ 0.', 400, 'COMP_VALOR');
        }
      }
      if (tipo === 'PERCENTUAL') {
        const p = c.percentual != null ? Number(c.percentual) : Number(c.PERCENTUAL);
        if (!Number.isFinite(p) || p < 0 || p > 100) {
          throw new ErroFinanceiro('Percentual deve estar entre 0 e 100.', 400, 'COMP_PCT');
        }
      }
    }

    if (fgRegra === 'S' && !comps.length) {
      throw new ErroFinanceiro(
        'Com a regra ligada, informe ao menos um componente em Conexão ou Uso da plataforma.',
        400,
        'COMP_OBRIGATORIO'
      );
    }

    let dhInicioWall = null;
    if (body.dhInicio != null && String(body.dhInicio).trim() !== '') {
      if (!permitirInicioRetroativo) {
        throw new ErroFinanceiro(
          'Somente a Atlas (tenant padrão) pode definir início de vigência retroativo.',
          403,
          'DH_INICIO_NEGADO'
        );
      }
      dhInicioWall = parseDhInicioBody(body.dhInicio);
      const agoraWall = fusoSp.nowSpWall();
      if (fusoSp.wallToOrderMs(dhInicioWall) > fusoSp.wallToOrderMs(agoraWall)) {
        throw new ErroFinanceiro(
          'Início da vigência não pode ser no futuro.',
          400,
          'DH_INICIO_FUTURO'
        );
      }
    }

    if (vigente) {
      const compsVig = await listarComponentes((s, p) => client.query(s, p), vigente.ID);
      const fpNovo = fingerprintContrato(fgRegra, politica, comps);
      const fpVig = fingerprintContrato(
        vigente.FG_REGRA_ATIVA,
        vigente.POLITICA_INADIMPLENCIA,
        compsVig
      );
      if (fpNovo === fpVig) {
        // Mesma configuração: só permite antecipar DH_INICIO da vigente (cobrir lacuna do mês).
        if (dhInicioWall) {
          const inicioAtual = fusoSp.toSpWall(vigente.DH_INICIO || vigente.dh_inicio);
          const msNovo = fusoSp.wallToOrderMs(dhInicioWall);
          const msAtual = fusoSp.wallToOrderMs(inicioAtual);
          if (msAtual != null && msNovo != null && msNovo < msAtual) {
            // Corta versões anteriores que invadem o novo início (senão o FIXO do mês dobra).
            await client.query(
              `UPDATE "FIN_CONTRATO"
                  SET "DH_FIM" = $2::timestamp,
                      "DHMAINTENANCE" = CURRENT_TIMESTAMP,
                      "SGUSER" = $3
                WHERE "TENANT_ID" = $1
                  AND "ID" <> $4
                  AND "DH_INICIO" <= $2::timestamp
                  AND ("DH_FIM" IS NULL OR "DH_FIM" > $2::timestamp)`,
              [tenantId, dhInicioWall, usuario || null, vigente.ID]
            );
            await client.query(
              `UPDATE "FIN_CONTRATO"
                  SET "DH_INICIO" = $2::timestamp,
                      "DHMAINTENANCE" = CURRENT_TIMESTAMP,
                      "SGUSER" = $3
                WHERE "ID" = $1 AND "DH_FIM" IS NULL`,
              [vigente.ID, dhInicioWall, usuario || null]
            );
            await client.query('COMMIT');
            const ajustado = await obterContrato(tenantId, vigente.ID);
            if (ajustado) ajustado.ajusteInicioVigencia = true;
            return ajustado;
          }
          if (msAtual != null && msNovo != null && msNovo === msAtual) {
            throw new ErroFinanceiro(
              'Nada mudou em relação à versão vigente (regra, inadimplência, componentes e início iguais).',
              400,
              'CONTRATO_SEM_ALTERACAO'
            );
          }
          throw new ErroFinanceiro(
            'Com a mesma configuração, só é permitido antecipar o início da vigência (ex.: 1º dia do mês). Para adiar o início, publique uma versão nova com mudança de preço/regra.',
            400,
            'DH_INICIO_SO_ANTECIPA'
          );
        }
        throw new ErroFinanceiro(
          'Nada mudou em relação à versão vigente (regra, inadimplência e componentes iguais). Altere algo antes de publicar — ou informe um início de vigência anterior para cobrir lacuna.',
          400,
          'CONTRATO_SEM_ALTERACAO'
        );
      }
      await client.query(
        `UPDATE "FIN_CONTRATO"
            SET "DH_FIM" = CURRENT_TIMESTAMP,
                "DHMAINTENANCE" = CURRENT_TIMESTAMP,
                "SGUSER" = $2
          WHERE "ID" = $1 AND "DH_FIM" IS NULL`,
        [vigente.ID, usuario || null]
      );
    }

    const novaVersao = vigente ? Number(vigente.VERSAO || 1) + 1 : 1;
    // Nova versão / 1ª: início informado (Atlas) ou agora. Não backdatar versão nova sobre a anterior
    // (evita overlap de FIXO); lacuna do mês se resolve antecipando a vigente (bloco acima).
    let dhInicioInsert = null;
    if (dhInicioWall && !vigente) {
      dhInicioInsert = dhInicioWall;
    }
    const ins = await client.query(
      `INSERT INTO "FIN_CONTRATO"
        ("TENANT_ID", "VERSAO", "DH_INICIO", "DH_FIM", "FG_REGRA_ATIVA", "POLITICA_INADIMPLENCIA",
         "FGACTIVE", "SGUSERINCLUSAO", "SGUSER", "DHMAINTENANCE")
       VALUES ($1, $2, COALESCE($6::timestamp, CURRENT_TIMESTAMP), NULL, $3, $4, 'S', $5, $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [tenantId, novaVersao, fgRegra, politica, usuario || null, dhInicioInsert]
    );
    const novo = ins.rows[0];

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const grupo = String(c.grupo || c.GRUPO).toUpperCase();
      const tipo = String(c.tipo || c.TIPO).toUpperCase();
      const fg = String(c.fgAtivo != null ? c.fgAtivo : c.FG_ATIVO != null ? c.FG_ATIVO : 'S')
        .toUpperCase()
        .startsWith('N')
        ? 'N'
        : 'S';
      let valorCentavos = null;
      let percentual = null;
      if (tipo === 'FIXO' || tipo === 'POR_CARGA_ANUNCIADA') {
        valorCentavos = Math.round(Number(c.valorCentavos != null ? c.valorCentavos : c.VALOR_CENTAVOS));
      }
      if (tipo === 'PERCENTUAL') {
        percentual = Number(c.percentual != null ? c.percentual : c.PERCENTUAL);
      }
      const ordem = c.ordem != null ? Number(c.ordem) : c.ORDEM != null ? Number(c.ORDEM) : i;
      await client.query(
        `INSERT INTO "FIN_CONTRATO_COMPONENTE"
          ("ID_CONTRATO", "GRUPO", "TIPO", "VALOR_CENTAVOS", "PERCENTUAL", "FG_ATIVO", "ORDEM", "SGUSERINCLUSAO")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [novo.ID, grupo, tipo, valorCentavos, percentual, fg, ordem, usuario || null]
      );
    }

    await client.query('COMMIT');
    return obterContrato(tenantId, novo.ID);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Cria cobrança de conexão dentro da transação da confirmação.
 * transaction deve expor queryPg(sql, params).
 */
async function criarCobrancaConexaoNaConfirmacao(transaction, args) {
  const q = (sql, params) => transaction.queryPg(sql, params);
  const tenantId = String(args.tenantId || '').trim();
  const idConvocacao = parseInt(args.idConvocacao, 10);
  const idViagem = args.idViagem;
  const cdMotorista = args.cdMotorista;
  const vlFrete = args.vlFrete;
  const usuario = args.usuario || null;
  const idCiclo = String(args.idCicloConfirmacao || `${idConvocacao}:${Date.now()}`).slice(0, 64);

  if (!tenantId || !Number.isFinite(idConvocacao)) {
    throw new ErroFinanceiro('Dados insuficientes para cobrança.', 400, 'DADOS');
  }

  const contrato = await buscarContratoVigente(q, tenantId);
  if (!contrato || String(contrato.FG_REGRA_ATIVA || 'N').toUpperCase() !== 'S') {
    return { gerou: false, motivo: 'REGRA_DESLIGADA' };
  }

  const comps = await listarComponentes(q, contrato.ID, 'CONEXAO');
  const ativos = comps.filter((c) => String(c.FG_ATIVO || 'S').toUpperCase() === 'S');
  if (!ativos.length) {
    return { gerou: false, motivo: 'SEM_COMPONENTE_CONEXAO' };
  }

  const calc = calcularConexaoCentavos(vlFrete, ativos);
  if (!calc.ok) {
    throw new ErroFinanceiro(calc.error, 400, calc.code);
  }

  if (cdMotorista == null || cdMotorista === '') {
    throw new ErroFinanceiro('Convocação sem motorista para gerar cobrança de conexão.', 400, 'SEM_MOTORISTA');
  }

  const memoria = JSON.stringify(calc.memoriaCalculo);

  let ins;
  try {
    ins = await q(
      `INSERT INTO "FIN_COBRANCA"
        ("MODALIDADE", "TENANT_ID", "PAGADOR_TIPO", "PAGADOR_CDCADASTRO", "BENEFICIARIO_TENANT_ID",
         "IDVIAGEM", "IDCONVOCACAO", "ID_CICLO_CONFIRMACAO", "ID_CONTRATO", "VERSAO_CONTRATO",
         "VALOR_CENTAVOS", "MOEDA", "MEMORIA_CALCULO", "STATUS", "SGUSER_CRIACAO")
       VALUES
        ('CONEXAO', $1, 'MOTORISTA', $2, $1,
         $3, $4, $5, $6, $7,
         $8, 'BRL', $9, 'ABERTA', $10)
       RETURNING *`,
      [
        tenantId,
        cdMotorista,
        idViagem,
        idConvocacao,
        idCiclo,
        contrato.ID,
        contrato.VERSAO,
        calc.valorCentavos,
        memoria,
        usuario,
      ]
    );
  } catch (e) {
    if (e && (e.code === '23505' || /unique|duplicad/i.test(String(e.message || '')))) {
      throw new ErroFinanceiro(
        'Já existe cobrança aberta para esta convocação/ciclo.',
        409,
        'COBRANCA_DUPLICADA'
      );
    }
    throw e;
  }

  const cob = ins.rows[0];
  await q(
    `INSERT INTO "FIN_COBRANCA_EVENTO"
      ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE")
     VALUES ($1, 'CRIADA', NULL, 'ABERTA', $2, $3)`,
    [cob.ID, usuario, `Ciclo ${idCiclo}`]
  );

  return { gerou: true, cobranca: cob, idCicloConfirmacao: idCiclo };
}

/**
 * Normaliza origem de desistência/cancelamento operacional.
 * Valores aceitos: TORRE | MOTORISTA | SISTEMA. Qualquer outro → TORRE.
 * SISTEMA é reservado a processos internos (não deve vir do browser).
 */
function normalizarOrigemCancelamento(origem, { permitirSistema = true } = {}) {
  const o = String(origem || '').trim().toUpperCase();
  if (o === 'MOTORISTA') return 'MOTORISTA';
  if (permitirSistema && o === 'SISTEMA') return 'SISTEMA';
  return 'TORRE';
}

/**
 * Cancela cobranças CONEXAO ABERTA/PAGA ligadas a convocações CONFIRMADAS
 * do motorista na viagem (tenant). Usado ao remover o motorista da viagem:
 * a remoção do vínculo operacional equivale a desfazer a conexão cobrada,
 * sem alterar o STATUS da convocação (reativar continua sendo o fluxo de reabertura).
 *
 * Não cancela se não houver CONFIRMADA desse motorista/viagem (ex.: vínculo manual).
 * Substituição: cancela só a cobrança do motorista removido; o novo só gera cobrança
 * se/quando for confirmado via convocação.
 */
async function cancelarCobrancasConexaoAoRemoverMotorista(transaction, args) {
  const q = (sql, params) => transaction.queryPg(sql, params);
  const tenantId = String(args.tenantId || '').trim();
  const idViagem = args.idViagem;
  const cdMotorista = Number(args.cdMotorista);
  const usuario = args.usuario || null;
  const motivo = String(args.motivo || 'Remoção do motorista da viagem').trim().slice(0, 400);
  const origem = normalizarOrigemCancelamento(args.origem, { permitirSistema: true });

  if (!tenantId || idViagem == null || !Number.isFinite(cdMotorista)) {
    return { canceladas: 0, convocacoes: [] };
  }

  const convs = await q(
    `SELECT c."IDCONVOCACAO"
       FROM "CONVOCACAO" c
      WHERE c."TENANT_ID" = $1
        AND c."IDVIAGEM" = $2
        AND c."CDCADASTRO_MOTORISTA" = $3
        AND UPPER(TRIM(COALESCE(c."STATUS", ''))) = 'CONFIRMADA'
      FOR UPDATE`,
    [tenantId, idViagem, cdMotorista]
  );

  let total = 0;
  const ids = [];
  for (const row of convs.rows || []) {
    const idConv = parseInt(row.IDCONVOCACAO != null ? row.IDCONVOCACAO : row.idconvocacao, 10);
    if (!Number.isFinite(idConv)) continue;
    ids.push(idConv);
    const r = await cancelarCobrancaConexaoNaTransacao(transaction, {
      tenantId,
      idConvocacao: idConv,
      usuario,
      motivo,
      origem,
    });
    total += (r && r.canceladas) || 0;
  }
  return { canceladas: total, convocacoes: ids };
}

/**
 * Cancela cobrança(s) ABERTA/PAGA do ciclo da convocação.
 * origem: TORRE | MOTORISTA | SISTEMA
 */
async function cancelarCobrancaConexaoNaTransacao(transaction, args) {
  const q = (sql, params) => transaction.queryPg(sql, params);
  const tenantId = String(args.tenantId || '').trim();
  const idConvocacao = parseInt(args.idConvocacao, 10);
  const usuario = args.usuario || null;
  const motivo = String(args.motivo || '').trim().slice(0, 400);
  const origemOk = normalizarOrigemCancelamento(args.origem, { permitirSistema: true });

  if (!tenantId || !Number.isFinite(idConvocacao)) {
    return { canceladas: 0 };
  }

  const list = await q(
    `SELECT * FROM "FIN_COBRANCA"
      WHERE "TENANT_ID" = $1
        AND "IDCONVOCACAO" = $2
        AND "MODALIDADE" = 'CONEXAO'
        AND "STATUS" IN ('ABERTA', 'PAGA')
      FOR UPDATE`,
    [tenantId, idConvocacao]
  );

  let n = 0;
  for (const cob of list.rows || []) {
    const st = String(cob.STATUS || '').toUpperCase();
    if (st === 'PAGA') {
      await q(
        `INSERT INTO "FIN_COBRANCA_EVENTO"
          ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE")
         VALUES ($1, 'REVERSAO_BAIXA', 'PAGA', 'PAGA', $2, $3)`,
        [cob.ID, usuario, motivo || 'Reversão por cancelamento do ciclo']
      );
      await q(
        `UPDATE "FIN_COBRANCA"
            SET "DH_BAIXA" = NULL,
                "SGUSER_BAIXA" = NULL,
                "DS_BAIXA" = NULL
          WHERE "ID" = $1`,
        [cob.ID]
      );
    }

    await q(
      `UPDATE "FIN_COBRANCA"
          SET "STATUS" = 'CANCELADA',
              "DH_CANCELAMENTO" = CURRENT_TIMESTAMP,
              "SGUSER_CANCELAMENTO" = $2,
              "DS_CANCELAMENTO" = $3,
              "ORIGEM_CANCELAMENTO" = $4
        WHERE "ID" = $1 AND "STATUS" IN ('ABERTA', 'PAGA')`,
      [cob.ID, usuario, motivo || null, origemOk]
    );

    await q(
      `INSERT INTO "FIN_COBRANCA_EVENTO"
        ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE")
       VALUES ($1, 'CANCELADA', $2, 'CANCELADA', $3, $4)`,
      [cob.ID, st, usuario, motivo || `Cancelamento origem ${origemOk}`]
    );
    n += 1;
  }
  return { canceladas: n };
}

async function listarCobrancas(tenantId, filtros = {}) {
  const params = [tenantId];
  let i = 2;
  let where = `WHERE c."TENANT_ID" = $1`;
  if (filtros.status) {
    where += ` AND c."STATUS" = $${i++}`;
    params.push(String(filtros.status).toUpperCase());
  }
  if (filtros.modalidade) {
    where += ` AND c."MODALIDADE" = $${i++}`;
    params.push(String(filtros.modalidade).toUpperCase());
  }
  if (filtros.idConvocacao) {
    where += ` AND c."IDCONVOCACAO" = $${i++}`;
    params.push(parseInt(filtros.idConvocacao, 10));
  }
  if (filtros.q) {
    where += ` AND (
      CAST(c."ID" AS text) ILIKE $${i}
      OR CAST(c."IDVIAGEM" AS text) ILIKE $${i}
      OR CAST(c."IDCONVOCACAO" AS text) ILIKE $${i}
      OR CAST(c."PAGADOR_CDCADASTRO" AS text) ILIKE $${i}
    )`;
    params.push(`%${String(filtros.q).trim()}%`);
    i += 1;
  }
  const lim = Math.min(parseInt(filtros.limit || 100, 10) || 100, 500);
  const r = await pool.query(
    `SELECT c.*,
            (
              SELECT upper(COALESCE(NULLIF(TRIM(cg."RZSOCIAL"), ''), TRIM(cg."NMFANTASIA")))
                FROM "CADASTROGERAL" cg
               WHERE cg."CDCADASTRO" = c."PAGADOR_CDCADASTRO"
               ORDER BY CASE WHEN cg."TENANT_ID" = c."TENANT_ID" THEN 0
                             WHEN cg."TENANT_ID" = 'default' THEN 1
                             ELSE 2 END
               LIMIT 1
            ) AS PAGADOR_NOME
       FROM "FIN_COBRANCA" c
      ${where}
      ORDER BY c."DH_CRIACAO" DESC
      LIMIT ${lim}`,
    params
  );
  return r.rows || [];
}

async function obterCobranca(tenantId, id) {
  const r = await pool.query(
    `SELECT c.*,
            (
              SELECT upper(COALESCE(NULLIF(TRIM(cg."RZSOCIAL"), ''), TRIM(cg."NMFANTASIA")))
                FROM "CADASTROGERAL" cg
               WHERE cg."CDCADASTRO" = c."PAGADOR_CDCADASTRO"
               ORDER BY CASE WHEN cg."TENANT_ID" = c."TENANT_ID" THEN 0
                             WHEN cg."TENANT_ID" = 'default' THEN 1
                             ELSE 2 END
               LIMIT 1
            ) AS PAGADOR_NOME
       FROM "FIN_COBRANCA" c
      WHERE c."ID" = $1 AND c."TENANT_ID" = $2`,
    [id, tenantId]
  );
  const cob = (r.rows && r.rows[0]) || null;
  if (!cob) return null;
  const ev = await pool.query(
    `SELECT * FROM "FIN_COBRANCA_EVENTO" WHERE "ID_COBRANCA" = $1 ORDER BY "DH_EVENTO", "ID"`,
    [id]
  );
  cob.eventos = ev.rows || [];
  return cob;
}

/**
 * Quem pode baixar/cancelar = quem RECEBE (beneficiário), nunca o devedor sozinho.
 * - CONEXAO (motorista → agenciador): só o agenciador (tenant da cobrança).
 *   Atlas (default) no seletor de outro tenant NÃO baixa frete de motorista.
 * - USO_PLATAFORMA (agenciador → Atlas): só a Atlas (default).
 *   O agenciador vê a dívida, mas não dá baixa no que deve.
 */
function assertPodeBaixarOuCancelar(cob, sessionTenantId) {
  const sess = String(sessionTenantId || '').trim();
  const def = String(getDefaultTenantId()).trim();
  const cobTenant = String(cob.TENANT_ID || '').trim();
  const mod = String(cob.MODALIDADE || '').toUpperCase();
  if (!sess) {
    throw new ErroFinanceiro('Sessão sem tenant.', 403, 'FIN_SESSAO_TENANT');
  }
  if (mod === 'CONEXAO') {
    if (sess !== cobTenant) {
      throw new ErroFinanceiro(
        'Conexão (motorista → agenciador) só pode ser baixada/cancelada no login do próprio agenciador. A Atlas não quita o que o motorista deve ao agenciador.',
        403,
        'FIN_CONEXAO_SO_AGENCIADOR'
      );
    }
    return;
  }
  if (mod === 'USO_PLATAFORMA') {
    if (sess === def) return;
    throw new ErroFinanceiro(
      'Uso da plataforma (agenciador → Atlas): só a Atlas (instalação padrão) pode baixar ou cancelar. Você consulta a dívida; a quitação é da Atlas.',
      403,
      'FIN_USO_SO_ATLAS_BAIXA'
    );
  }
}

async function baixarCobrancaManual(tenantId, id, usuario, motivo, ip, opts) {
  const sessionTenantId = opts && opts.sessionTenantId != null ? opts.sessionTenantId : tenantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM "FIN_COBRANCA" WHERE "ID" = $1 AND "TENANT_ID" = $2 FOR UPDATE`,
      [id, tenantId]
    );
    const cob = (r.rows && r.rows[0]) || null;
    if (!cob) throw new ErroFinanceiro('Cobrança não encontrada.', 404, 'NAO_ENCONTRADA');
    assertPodeBaixarOuCancelar(cob, sessionTenantId);
    if (String(cob.STATUS).toUpperCase() !== 'ABERTA') {
      throw new ErroFinanceiro('Só é possível baixar cobrança em aberto.', 409, 'STATUS');
    }
    const det = String(motivo || '').trim().slice(0, 400);
    if (det.length < 3) throw new ErroFinanceiro('Informe o motivo da baixa (mín. 3 caracteres).', 400, 'MOTIVO');

    await client.query(
      `UPDATE "FIN_COBRANCA"
          SET "STATUS" = 'PAGA',
              "DH_BAIXA" = CURRENT_TIMESTAMP,
              "SGUSER_BAIXA" = $2,
              "DS_BAIXA" = $3
        WHERE "ID" = $1 AND "STATUS" = 'ABERTA'`,
      [id, usuario, det]
    );
    await client.query(
      `INSERT INTO "FIN_COBRANCA_EVENTO"
        ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE", "IP")
       VALUES ($1, 'BAIXA_MANUAL', 'ABERTA', 'PAGA', $2, $3, $4)`,
      [id, usuario, det, ip || null]
    );
    await client.query('COMMIT');
    return obterCobranca(tenantId, id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Cancelamento manual de uma cobrança do tenant (API Atlas Pay). */
async function cancelarCobrancaManual(tenantId, id, usuario, motivo, origem, ip, opts) {
  const sessionTenantId = opts && opts.sessionTenantId != null ? opts.sessionTenantId : tenantId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM "FIN_COBRANCA" WHERE "ID" = $1 AND "TENANT_ID" = $2 FOR UPDATE`,
      [id, tenantId]
    );
    const cob = (r.rows && r.rows[0]) || null;
    if (!cob) throw new ErroFinanceiro('Cobrança não encontrada.', 404, 'NAO_ENCONTRADA');
    assertPodeBaixarOuCancelar(cob, sessionTenantId);
    const st = String(cob.STATUS || '').toUpperCase();
    if (st !== 'ABERTA' && st !== 'PAGA') {
      throw new ErroFinanceiro('Só é possível cancelar cobrança aberta ou paga.', 409, 'STATUS');
    }
    const det = String(motivo || '').trim().slice(0, 400);
    if (det.length < 3) throw new ErroFinanceiro('Informe o motivo do cancelamento (mín. 3 caracteres).', 400, 'MOTIVO');
    const origemOk = ['TORRE', 'MOTORISTA', 'SISTEMA'].includes(String(origem || '').toUpperCase())
      ? String(origem).toUpperCase()
      : 'TORRE';

    if (st === 'PAGA') {
      await client.query(
        `INSERT INTO "FIN_COBRANCA_EVENTO"
          ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE", "IP")
         VALUES ($1, 'REVERSAO_BAIXA', 'PAGA', 'PAGA', $2, $3, $4)`,
        [id, usuario, det, ip || null]
      );
      await client.query(
        `UPDATE "FIN_COBRANCA"
            SET "DH_BAIXA" = NULL, "SGUSER_BAIXA" = NULL, "DS_BAIXA" = NULL
          WHERE "ID" = $1`,
        [id]
      );
    }

    await client.query(
      `UPDATE "FIN_COBRANCA"
          SET "STATUS" = 'CANCELADA',
              "DH_CANCELAMENTO" = CURRENT_TIMESTAMP,
              "SGUSER_CANCELAMENTO" = $2,
              "DS_CANCELAMENTO" = $3,
              "ORIGEM_CANCELAMENTO" = $4
        WHERE "ID" = $1 AND "STATUS" IN ('ABERTA', 'PAGA')`,
      [id, usuario, det, origemOk]
    );
    await client.query(
      `INSERT INTO "FIN_COBRANCA_EVENTO"
        ("ID_COBRANCA", "TIPO", "STATUS_ANTERIOR", "STATUS_NOVO", "SGUSER", "DETALHE", "IP")
       VALUES ($1, 'CANCELADA', $2, 'CANCELADA', $3, $4, $5)`,
      [id, st, usuario, det, ip || null]
    );
    await client.query('COMMIT');
    return obterCobranca(tenantId, id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function resumoTenant(tenantId) {
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS pagas,
        COUNT(*) FILTER (WHERE "STATUS" = 'CANCELADA')::int AS canceladas,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos,
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA' AND "MODALIDADE" = 'CONEXAO')::int AS abertas_conexao,
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA' AND "MODALIDADE" = 'USO_PLATAFORMA')::int AS abertas_uso,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA' AND "MODALIDADE" = 'CONEXAO'), 0)::bigint AS centavos_abertos_conexao,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA' AND "MODALIDADE" = 'USO_PLATAFORMA'), 0)::bigint AS centavos_abertos_uso
       FROM "FIN_COBRANCA"
      WHERE "TENANT_ID" = $1`,
    [tenantId]
  );
  const contrato = await buscarContratoVigente((s, p) => pool.query(s, p), tenantId);
  return {
    resumo: r.rows[0] || {},
    contratoVigente: contrato
      ? {
          id: contrato.ID,
          versao: contrato.VERSAO,
          fgRegraAtiva: contrato.FG_REGRA_ATIVA,
          politicaInadimplencia: contrato.POLITICA_INADIMPLENCIA,
        }
      : null,
    consolidado: false,
  };
}

/** Painel Atlas: uso (agenciadores → Atlas) + conexão (motorista → agenciadores). */
async function resumoConsolidado() {
  const def = getDefaultTenantId();
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS pagas,
        COUNT(*) FILTER (WHERE "STATUS" = 'CANCELADA')::int AS canceladas,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
       FROM "FIN_COBRANCA"
      WHERE "MODALIDADE" = 'USO_PLATAFORMA'
        AND (
          "BENEFICIARIO_TENANT_ID" IS NULL
          OR TRIM("BENEFICIARIO_TENANT_ID") = $1
        )
        AND COALESCE(NULLIF(TRIM("PAGADOR_TENANT_ID"), ''), TRIM("TENANT_ID")) <> $1`,
    [def]
  );
  const rCx = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS pagas,
        COUNT(*) FILTER (WHERE "STATUS" = 'CANCELADA')::int AS canceladas,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
       FROM "FIN_COBRANCA"
      WHERE "MODALIDADE" = 'CONEXAO'`
  );
  let quemDeve = [];
  let quemRecebeConexao = [];
  try {
    const d = await pool.query(
      `SELECT
          COALESCE(NULLIF(TRIM(c."PAGADOR_TENANT_ID"), ''), TRIM(c."TENANT_ID")) AS tenant_id,
          MAX(NULLIF(TRIM(s."NM_CLIENTE"), '')) AS nm_cliente,
          COUNT(*) FILTER (WHERE c."STATUS" = 'ABERTA')::int AS abertas,
          COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
          COUNT(*) FILTER (WHERE c."STATUS" = 'PAGA')::int AS pagas,
          COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
         FROM "FIN_COBRANCA" c
         LEFT JOIN "SAAS_CLIENTE_CONTRATANTE" s
           ON TRIM(s."TENANT_ID") = COALESCE(NULLIF(TRIM(c."PAGADOR_TENANT_ID"), ''), TRIM(c."TENANT_ID"))
        WHERE c."MODALIDADE" = 'USO_PLATAFORMA'
          AND (
            c."BENEFICIARIO_TENANT_ID" IS NULL
            OR TRIM(c."BENEFICIARIO_TENANT_ID") = $1
          )
          AND COALESCE(NULLIF(TRIM(c."PAGADOR_TENANT_ID"), ''), TRIM(c."TENANT_ID")) <> $1
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE c."STATUS" = 'ABERTA') > 0
            OR COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'ABERTA'), 0) > 0
        ORDER BY centavos_abertos DESC, tenant_id`,
      [def]
    );
    quemDeve = d.rows || [];
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }
  try {
    const cx = await pool.query(
      `SELECT
          TRIM(COALESCE(NULLIF(c."BENEFICIARIO_TENANT_ID", ''), c."TENANT_ID")) AS tenant_id,
          MAX(NULLIF(TRIM(s."NM_CLIENTE"), '')) AS nm_cliente,
          COUNT(*) FILTER (WHERE c."STATUS" = 'ABERTA')::int AS abertas,
          COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
          COUNT(*) FILTER (WHERE c."STATUS" = 'PAGA')::int AS pagas,
          COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
         FROM "FIN_COBRANCA" c
         LEFT JOIN "SAAS_CLIENTE_CONTRATANTE" s
           ON TRIM(s."TENANT_ID") = TRIM(COALESCE(NULLIF(c."BENEFICIARIO_TENANT_ID", ''), c."TENANT_ID"))
        WHERE c."MODALIDADE" = 'CONEXAO'
        GROUP BY 1
        HAVING COUNT(*) FILTER (WHERE c."STATUS" = 'ABERTA') > 0
            OR COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'ABERTA'), 0) > 0
        ORDER BY centavos_abertos DESC, tenant_id`
    );
    quemRecebeConexao = cx.rows || [];
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }
  return {
    resumo: r.rows[0] || {},
    resumoConexao: rCx.rows[0] || {},
    contratoVigente: null,
    consolidado: true,
    quemDeve,
    quemRecebeConexao,
  };
}

async function vlFreteDaViagem(q, tenantId, idViagem) {
  const r = await q(
    `SELECT "VLFRETE" FROM "VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
    [idViagem, tenantId]
  );
  const row = (r.rows && r.rows[0]) || null;
  return row ? row.VLFRETE : null;
}

/**
 * Top motoristas por conexão (quem mais pagou ao agenciador beneficiário).
 * @param {{ tenantId?: string|null, limit?: number }} opts
 *        tenantId null/vazio = todos os beneficiários (painel Atlas)
 */
async function topMotoristasConexao(opts) {
  const lim = Math.min(Math.max(parseInt((opts && opts.limit) || 10, 10) || 10, 1), 50);
  const tenantFiltro = opts && opts.tenantId ? String(opts.tenantId).trim() : '';
  const params = [];
  let whereBenef = '';
  if (tenantFiltro) {
    params.push(tenantFiltro);
    whereBenef = ` AND TRIM(COALESCE(NULLIF(c."BENEFICIARIO_TENANT_ID", ''), c."TENANT_ID")) = $1 `;
  }
  params.push(lim);
  const limPh = `$${params.length}`;
  const r = await pool.query(
    `SELECT
        c."PAGADOR_CDCADASTRO" AS cd_cadastro,
        MAX(
          (
            SELECT upper(COALESCE(NULLIF(TRIM(cg."RZSOCIAL"), ''), TRIM(cg."NMFANTASIA")))
              FROM "CADASTROGERAL" cg
             WHERE cg."CDCADASTRO" = c."PAGADOR_CDCADASTRO"
             ORDER BY CASE WHEN cg."TENANT_ID" = c."TENANT_ID" THEN 0
                           WHEN cg."TENANT_ID" = 'default' THEN 1
                           ELSE 2 END
             LIMIT 1
          )
        ) AS nome,
        COUNT(*) FILTER (WHERE c."STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE c."STATUS" = 'PAGA')::int AS pagas,
        COUNT(*)::int AS qtd,
        COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos,
        COALESCE(SUM(c."VALOR_CENTAVOS") FILTER (WHERE c."STATUS" IN ('ABERTA','PAGA')), 0)::bigint AS centavos_total
       FROM "FIN_COBRANCA" c
      WHERE c."MODALIDADE" = 'CONEXAO'
        AND c."PAGADOR_TIPO" = 'MOTORISTA'
        AND c."PAGADOR_CDCADASTRO" IS NOT NULL
        ${whereBenef}
      GROUP BY c."PAGADOR_CDCADASTRO"
      ORDER BY centavos_total DESC, centavos_pagos DESC, cd_cadastro
      LIMIT ${limPh}`,
    params
  );
  return r.rows || [];
}

/** Ranking de agenciadores: conexão recebida + uso pago à Atlas. */
async function rankingAgenciadores() {
  const def = getDefaultTenantId();
  const r = await pool.query(
    `WITH base AS (
       SELECT
         TRIM(COALESCE(NULLIF(c."BENEFICIARIO_TENANT_ID", ''), c."TENANT_ID")) AS tenant_cx,
         COALESCE(NULLIF(TRIM(c."PAGADOR_TENANT_ID"), ''), TRIM(c."TENANT_ID")) AS tenant_uso,
         c."MODALIDADE",
         c."STATUS",
         c."VALOR_CENTAVOS"
       FROM "FIN_COBRANCA" c
     ),
     cx AS (
       SELECT tenant_cx AS tenant_id,
              COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS cx_abertas,
              COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS cx_abertos,
              COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS cx_pagas,
              COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS cx_pagos
         FROM base
        WHERE "MODALIDADE" = 'CONEXAO'
        GROUP BY 1
     ),
     uso AS (
       SELECT tenant_uso AS tenant_id,
              COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS uso_abertas,
              COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS uso_abertos,
              COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS uso_pagas,
              COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS uso_pagos
         FROM base
        WHERE "MODALIDADE" = 'USO_PLATAFORMA'
          AND tenant_uso <> $1
        GROUP BY 1
     ),
     keys AS (
       SELECT tenant_id FROM cx
       UNION
       SELECT tenant_id FROM uso
     )
     SELECT k.tenant_id,
            NULLIF(TRIM(s."NM_CLIENTE"), '') AS nm_cliente,
            COALESCE(cx.cx_abertas, 0) AS cx_abertas,
            COALESCE(cx.cx_abertos, 0) AS cx_abertos,
            COALESCE(cx.cx_pagas, 0) AS cx_pagas,
            COALESCE(cx.cx_pagos, 0) AS cx_pagos,
            COALESCE(u.uso_abertas, 0) AS uso_abertas,
            COALESCE(u.uso_abertos, 0) AS uso_abertos,
            COALESCE(u.uso_pagas, 0) AS uso_pagas,
            COALESCE(u.uso_pagos, 0) AS uso_pagos
       FROM keys k
       LEFT JOIN cx ON cx.tenant_id = k.tenant_id
       LEFT JOIN uso u ON u.tenant_id = k.tenant_id
       LEFT JOIN "SAAS_CLIENTE_CONTRATANTE" s ON TRIM(s."TENANT_ID") = k.tenant_id
      ORDER BY (COALESCE(cx.cx_pagos, 0) + COALESCE(u.uso_pagos, 0)) DESC, k.tenant_id`,
    [def]
  );
  return r.rows || [];
}

/** Dash Atlas: consolidado + ranking + top motoristas (filtro opcional de tenant). */
async function dashAtlas(opts) {
  const def = getDefaultTenantId();
  const tenantFiltro = opts && opts.tenantId ? String(opts.tenantId).trim() : '';
  const todos = !tenantFiltro || tenantFiltro === '__all__';
  const consolidado = await resumoConsolidado();
  const ranking = await rankingAgenciadores();
  const topMot = await topMotoristasConexao({
    tenantId: todos ? null : tenantFiltro,
    limit: (opts && opts.limit) || 10,
  });

  let foco = null;
  if (!todos) {
    const row = ranking.find((x) => String(x.tenant_id) === tenantFiltro) || null;
    const cxAtlas =
      tenantFiltro === def
        ? {
            cx_pagos: Number((consolidado.resumoConexao && consolidado.resumoConexao.centavos_pagos) || 0),
            // detalhe por tenant já está no ranking
          }
        : null;
    foco = {
      tenantId: tenantFiltro,
      ranking: row || {
        tenant_id: tenantFiltro,
        nm_cliente: null,
        cx_abertas: 0,
        cx_abertos: 0,
        cx_pagas: 0,
        cx_pagos: 0,
        uso_abertas: 0,
        uso_abertos: 0,
        uso_pagas: 0,
        uso_pagos: 0,
      },
      cxAtlasHint: cxAtlas,
    };
  }

  const cxDefault = ranking.find((x) => String(x.tenant_id) === def) || null;
  const cxClientesPagos = ranking
    .filter((x) => String(x.tenant_id) !== def)
    .reduce((a, x) => a + Number(x.cx_pagos || 0), 0);
  const cxClientesAbertos = ranking
    .filter((x) => String(x.tenant_id) !== def)
    .reduce((a, x) => a + Number(x.cx_abertos || 0), 0);

  return {
    consolidado: true,
    defaultTenantId: def,
    resumoUso: consolidado.resumo || {},
    resumoConexao: consolidado.resumoConexao || {},
    conexaoAtlas: {
      centavos_pagos: Number((cxDefault && cxDefault.cx_pagos) || 0),
      centavos_abertos: Number((cxDefault && cxDefault.cx_abertos) || 0),
      abertas: Number((cxDefault && cxDefault.cx_abertas) || 0),
      pagas: Number((cxDefault && cxDefault.cx_pagas) || 0),
    },
    conexaoClientes: {
      centavos_pagos: cxClientesPagos,
      centavos_abertos: cxClientesAbertos,
    },
    ranking,
    topMotoristas: topMot,
    foco,
    tenantFiltro: todos ? null : tenantFiltro,
  };
}

/** Dash do agenciador (tenant ou default operando oferta). */
async function dashMeuFaturamento(tenantId) {
  const tid = String(tenantId || '').trim();
  const def = getDefaultTenantId();
  const base = await resumoTenant(tid);
  const rExtra = await pool.query(
    `SELECT
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA' AND "MODALIDADE" = 'CONEXAO'), 0)::bigint AS cx_pagos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA' AND "MODALIDADE" = 'USO_PLATAFORMA'), 0)::bigint AS uso_pagos,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA' AND "MODALIDADE" = 'CONEXAO')::int AS cx_pagas_qtd,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA' AND "MODALIDADE" = 'USO_PLATAFORMA')::int AS uso_pagas_qtd
       FROM "FIN_COBRANCA"
      WHERE "TENANT_ID" = $1
         OR TRIM(COALESCE("BENEFICIARIO_TENANT_ID", '')) = $1
         OR TRIM(COALESCE("PAGADOR_TENANT_ID", '')) = $1`,
    [tid]
  );
  // Conexão recebida = beneficiário sou eu
  const cx = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS pagas,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
       FROM "FIN_COBRANCA"
      WHERE "MODALIDADE" = 'CONEXAO'
        AND TRIM(COALESCE(NULLIF("BENEFICIARIO_TENANT_ID", ''), "TENANT_ID")) = $1`,
    [tid]
  );
  // Uso que eu pago à Atlas
  const uso = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE "STATUS" = 'ABERTA')::int AS abertas,
        COUNT(*) FILTER (WHERE "STATUS" = 'PAGA')::int AS pagas,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'ABERTA'), 0)::bigint AS centavos_abertos,
        COALESCE(SUM("VALOR_CENTAVOS") FILTER (WHERE "STATUS" = 'PAGA'), 0)::bigint AS centavos_pagos
       FROM "FIN_COBRANCA"
      WHERE "MODALIDADE" = 'USO_PLATAFORMA'
        AND COALESCE(NULLIF(TRIM("PAGADOR_TENANT_ID"), ''), TRIM("TENANT_ID")) = $1`,
    [tid]
  );
  const topMot = await topMotoristasConexao({ tenantId: tid, limit: 10 });
  return {
    tenantId: tid,
    ehDefault: tid === def,
    contratoVigente: base.contratoVigente,
    conexao: cx.rows[0] || {},
    uso: uso.rows[0] || {},
    topMotoristas: topMot,
    extra: rExtra.rows[0] || {},
  };
}

module.exports = {
  ErroFinanceiro,
  loginDe,
  ipDe,
  reaisParaCentavos,
  centavosParaReais,
  calcularConexaoCentavos,
  buscarContratoVigente,
  listarComponentes,
  listarContratos,
  obterContrato,
  publicarContrato,
  criarCobrancaConexaoNaConfirmacao,
  cancelarCobrancaConexaoNaTransacao,
  cancelarCobrancasConexaoAoRemoverMotorista,
  normalizarOrigemCancelamento,
  listarCobrancas,
  obterCobranca,
  baixarCobrancaManual,
  cancelarCobrancaManual,
  resumoTenant,
  resumoConsolidado,
  topMotoristasConexao,
  rankingAgenciadores,
  dashAtlas,
  dashMeuFaturamento,
  vlFreteDaViagem,
  getDefaultTenantId,
};
