// backend/controllers/cadastrogeral.controller.js
// Controller para Cadastro Geral
// Versão: 1.1 - Com Classes de Frota
// Atlas Cargo
// Data: 2026-04-05

const sql = require('../config/mssql-compat');
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { normalizarPlacaBrasil } = require('../utils/placa-util');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

// Constantes (legado: um tipo por cadastro; mantido para compatibilidade de exibição)
const TIPO_CADASTRO = {
  'O': 'Operador do Sistema',
  'P': 'Programador / Contratador',
  'M': 'Motorista',
  'T': 'Transportador',
  'A': 'Agente / Parceiro',
  'G': 'Grupo de Divulgação',
  'C': 'Certificadora',
  'E': 'Cliente',
  'U': 'Unidade de Negócio'
};

// Aplicável para: ordem e mapeamento coluna -> código
const APPLICABLE_OPCOES = [
  { cod: 'O', col: 'FGOPERADOR', label: 'Operador do Sistema' },
  { cod: 'P', col: 'FGPROGRAMADOR', label: 'Programador / Contratador' },
  { cod: 'M', col: 'FGMOTORISTA', label: 'Motorista' },
  { cod: 'T', col: 'FGTRANSPORTADOR', label: 'Transportador' },
  { cod: 'A', col: 'FGAGENTE', label: 'Agente / Parceiro' },
  { cod: 'G', col: 'FGGRUPO', label: 'Grupo de Divulgação' },
  { cod: 'C', col: 'FGCERTIFICADORA', label: 'Certificadora' },
  { cod: 'U', col: 'FGUNIDADENEGOCIO', label: 'Unidade de Negócio' }
];
const APPLICABLE_COL_MAP = Object.fromEntries(APPLICABLE_OPCOES.map(a => [a.cod, a.col]));

/** Classificação de transporte no Brasil (cadastro motorista/transportador). */
const TIPO_TRANSPORTE_BR_VALIDOS = new Set(['TAC', 'ETC', 'CTC', 'TAC_AGG', 'TAC_IND']);
const TIPO_TRANSPORTE_BR_LABELS = {
  TAC: 'TAC — Transportador autônomo de cargas',
  ETC: 'ETC — Empresa de transporte de cargas',
  CTC: 'CTC — Cooperativa de transporte de cargas',
  TAC_AGG: 'TAC agregado — veículo à disposição de uma ETC',
  TAC_IND: 'TAC independente — serviços eventuais, sem vínculo fixo'
};

function resolverTipoTransporteBr(body, flags) {
  const aplica = flags.FGMOTORISTA || flags.FGTRANSPORTADOR;
  if (!aplica) return { valor: null };
  const raw = body.TIPO_TRANSPORTE_BR;
  if (raw == null || String(raw).trim() === '') return { valor: null };
  const v = String(raw).trim().toUpperCase();
  if (!TIPO_TRANSPORTE_BR_VALIDOS.has(v)) return { erro: 'Tipo de transporte (Brasil) inválido.' };
  return { valor: v };
}

/**
 * Rastreado / divulgação: M ou T exigem S ou N explícito.
 * Agente ou Grupo: na tela o usuário informa; na API, ausência do campo mantém compatibilidade (N).
 */
function resolverFgrastreado(FGRASTREADO, flags) {
  const precisa =
    flags.FGMOTORISTA || flags.FGTRANSPORTADOR || flags.FGAGENTE || flags.FGGRUPO;
  if (!precisa) return { valor: 'N' };
  const raw = FGRASTREADO != null && String(FGRASTREADO).trim() !== ''
    ? String(FGRASTREADO).trim().toUpperCase() : '';
  if (raw === 'S' || raw === 'N') return { valor: raw };
  if (flags.FGMOTORISTA || flags.FGTRANSPORTADOR) {
    return {
      erro:
        'Informe se possui veículo rastreado (Sim ou Não) quando Motorista e/ou Transportador estiver marcado.'
    };
  }
  return { valor: 'N' };
}

const { getSgUser } = require('../utils/audit');
const { getContexto } = require('../services/contexto.service');
const { validarDocumento, normalizarDocumento } = require('../services/documento.service');
const {
  parseEnderecosEntregaXlsx,
  buildChaveImport,
  parseLatLon,
} = require('../services/cadastro-endereco-entrega-import.service');
const { avaliarStCompletudeEndereco } = require('../services/cadastro-endereco-entrega-provision.service');

const FISICA_JURIDICA = {
  'F': 'Física',
  'J': 'Jurídica'
};

async function cadastroGeralPertenceAoTenant(pool, cdCadastro, tenantId) {
  const r = await pool.query(
    'SELECT 1 FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2',
    [cdCadastro, tenantId]
  );
  return ((r.rows || []).length > 0);
}

function tryUnlinkPublicUpload(relativePath) {
  try {
    const p = String(relativePath || '').trim();
    if (!p || p.includes('..')) return;
    const rel = p.replace(/^\/+/, '');
    if (!rel.startsWith('uploads/')) return;
    const full = path.join(__dirname, '..', 'public', rel);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (_e) {
    /* ignorar */
  }
}

const MAP_ANEXO_MC_TORRE = {
  'cnh-frente': 'FOTOCNH',
  'cnh-verso': 'FOTOCNH_VERSO',
  'comprovante-endereco': 'FOTO_COMPROVANTE_ENDERECO',
};

const MAP_ANEXO_MV_TORRE = {
  crlv: 'FOTOCRLV',
  'foto-veiculo': 'FOTOVEICULO',
};

async function assertCadastroMotoristaTorre(req, res, idNumerico) {
  const sg = getSgUser(req);
  if (!sg) {
    res.status(401).json({ error: 'Não autorizado. Faça login.' });
    return null;
  }
  const pool = await poolPromise;
  const tid = tenantIdForRequest(req);
  const tenantDefault = getDefaultTenantId();
  const r = await pool.query(
    `SELECT cg."CDCADASTRO"
       FROM "CADASTROGERAL" cg
      WHERE cg."CDCADASTRO" = $1::numeric
        AND COALESCE(cg."FGMOTORISTA", 'N') = 'S'
        AND (
          cg."TENANT_ID" = $2
          OR cg."TENANT_ID" = $3
          OR EXISTS (
            SELECT 1 FROM "USUARIO" u
            WHERE u."CDCADASTRO" = $1::numeric
              AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $3) = $2
          )
        )
      LIMIT 1`,
    [idNumerico, tid, tenantDefault]
  );
  if (!r.rows || !r.rows.length) {
    res.status(404).json({ error: 'Cadastro não encontrado ou não é motorista neste tenant.' });
    return null;
  }
  return { pool, tid, sg };
}

async function assertMotoristaVeiculoTorre(req, res, idVeiculo) {
  const sg = getSgUser(req);
  if (!sg) {
    res.status(401).json({ error: 'Não autorizado. Faça login.' });
    return null;
  }
  const pool = await poolPromise;
  const tid = tenantIdForRequest(req);
  let r;
  try {
    r = await pool.query(
      `SELECT "IDVEICULOMOTORISTA", "FOTOCRLV", "FOTOVEICULO"
         FROM "MOTORISTA_VEICULO"
        WHERE "IDVEICULOMOTORISTA" = $1::int AND "TENANT_ID" = $2
        LIMIT 1`,
      [idVeiculo, tid]
    );
  } catch (e) {
    if (e.code === '42703') {
      r = await pool.query(
        `SELECT "IDVEICULOMOTORISTA", "FOTOCRLV"
           FROM "MOTORISTA_VEICULO"
          WHERE "IDVEICULOMOTORISTA" = $1::int AND "TENANT_ID" = $2
          LIMIT 1`,
        [idVeiculo, tid]
      );
    } else {
      throw e;
    }
  }
  if (!r.rows || !r.rows.length) {
    res.status(404).json({ error: 'Veículo do motorista não encontrado.' });
    return null;
  }
  return { pool, tid, sg, row: r.rows[0] };
}

async function resolveClientePorCnpj(pool, tenantId, cnpj14) {
  const r = await pool.query(
    `SELECT cg."CDCADASTRO", cg."RZSOCIAL"
       FROM "CADASTROGERAL" cg
      WHERE cg."TENANT_ID" = $1
        AND cg."CGCCPF" = $2
        AND cg."FGFISICAJURIDICA" = 'J'
        AND cg."FGACTIVE" = 'A'
      ORDER BY cg."CDCADASTRO"
      LIMIT 1`,
    [tenantId, cnpj14]
  );
  return r.rows[0] || null;
}

async function resolveCidadeEndereco(pool, uf, municipio) {
  const u = String(uf || '')
    .trim()
    .toUpperCase()
    .substring(0, 2);
  const m = String(municipio || '').trim();
  if (!u || !m) return null;
  let r = await pool.query(
    `SELECT "CDCIDADE", "NMCIDADE", "ESTADO" FROM "CIDADE"
      WHERE "FGACTIVE" = 'A' AND "ESTADO" = $1
        AND UPPER(TRIM("NMCIDADE")) = UPPER(TRIM($2))
      LIMIT 1`,
    [u, m]
  );
  if (r.rows[0]) return r.rows[0];
  r = await pool.query(
    `SELECT "CDCIDADE", "NMCIDADE", "ESTADO" FROM "CIDADE"
      WHERE "FGACTIVE" = 'A' AND "ESTADO" = $1
        AND UPPER("NMCIDADE") LIKE UPPER($2)
      LIMIT 1`,
    [u, `%${m}%`]
  );
  return r.rows[0] || null;
}

// Buscar CEP via ViaCEP
async function buscarCEP(cep) {
  try {
    const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar CEP:', error);
    return null;
  }
}

/** Primeiro tipo de equipamento ativo do tenant (fallback default). `db` = pool ou client pg. */
async function buscarPrimeiroTipoEquipamentoTenant(db, tid) {
  const r = await db.query(
    `SELECT "CDTIPOEQUIPAMENTO" AS c FROM "TIPOEQUIPAMENTO"
     WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
       AND ("FGACTIVE" IN ('A', 'S') OR "FGACTIVE" IS NULL)
     ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDTIPOEQUIPAMENTO" ASC
     LIMIT 1`,
    [tid]
  );
  if (!r.rows || !r.rows[0]) return null;
  const row = r.rows[0];
  const v = row.c != null ? row.c : row.cdtipoequipamento;
  return v != null ? Number(v) : null;
}

/** Primeira marca de equipamento ativa do tenant (fallback ao criar veículo pelo app). */
async function buscarPrimeiraMarcaEquipamentoTenant(db, tid) {
  const r = await db.query(
    `SELECT "CDMARCAEQUIPAMENTO" AS c FROM "MARCAEQUIPAMENTO"
     WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
       AND ("FGACTIVE" IN ('A', 'S') OR "FGACTIVE" IS NULL)
     ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDMARCAEQUIPAMENTO" ASC
     LIMIT 1`,
    [tid]
  );
  if (!r.rows || !r.rows[0]) return null;
  const row = r.rows[0];
  const v = row.c != null ? row.c : row.cdmarcaequipamento;
  return v != null ? Number(v) : null;
}

/**
 * Garante IDEQUIPAMENTO ao aprovar veículo do app: respeita body; senão vínculo já no MV;
 * senão busca por placa no tenant; senão INSERT mínimo em EQUIPAMENTO.
 * @returns {{ idequipamento: number, equipamentoCriado: boolean }}
 */
async function ensureIdequipamentoParaAprovacaoMotoristaVeiculo(client, { tid, mv, motoristaRz, motoristaFgrastreado, bodyCdeq, sg }) {
  const sgSafe = String(sg || 'TORRE').slice(0, 50);
  const rz = String(motoristaRz || '').trim().slice(0, 120);
  const placaNorm =
    (mv.PLACA_NORMALIZADA && String(mv.PLACA_NORMALIZADA).trim()) ||
    (mv.placa_normalizada && String(mv.placa_normalizada).trim()) ||
    normalizarPlacaBrasil(mv.PLACA || mv.placa || '') ||
    '';
  const placaUp = String(placaNorm).toUpperCase();
  if (!placaUp || placaUp.length < 7) {
    const err = new Error('Placa inválida no registro; não é possível gerar equipamento.');
    err.httpStatus = 400;
    throw err;
  }

  if (bodyCdeq != null && Number.isFinite(Number(bodyCdeq))) {
    const ex = await client.query(
      `SELECT "IDEQUIPAMENTO" FROM "EQUIPAMENTO" WHERE "IDEQUIPAMENTO" = $1::numeric AND "TENANT_ID" = $2`,
      [bodyCdeq, tid]
    );
    if (!ex.rows || !ex.rows.length) {
      const err = new Error('Código de equipamento não encontrado neste tenant.');
      err.httpStatus = 400;
      throw err;
    }
    const id = ex.rows[0].IDEQUIPAMENTO != null ? Number(ex.rows[0].IDEQUIPAMENTO) : Number(ex.rows[0].idequipamento);
    return { idequipamento: id, equipamentoCriado: false };
  }

  const preCdeq = mv.CDEQUIPAMENTO != null ? mv.CDEQUIPAMENTO : mv.cdequipamento;
  if (preCdeq != null && String(preCdeq).trim() !== '') {
    const n = Number(preCdeq);
    if (Number.isFinite(n)) {
      const ex = await client.query(
        `SELECT "IDEQUIPAMENTO" FROM "EQUIPAMENTO" WHERE "IDEQUIPAMENTO" = $1::numeric AND "TENANT_ID" = $2`,
        [n, tid]
      );
      if (ex.rows && ex.rows.length) {
        const id = ex.rows[0].IDEQUIPAMENTO != null ? Number(ex.rows[0].IDEQUIPAMENTO) : Number(ex.rows[0].idequipamento);
        return { idequipamento: id, equipamentoCriado: false };
      }
    }
  }

  const rPlaca = await client.query(
    `SELECT "IDEQUIPAMENTO" FROM "EQUIPAMENTO"
     WHERE "TENANT_ID" = $1
       AND UPPER(REGEXP_REPLACE(TRIM(COALESCE("REFEQUIPAMENTO", '')), '[^A-Z0-9]', '', 'g')) = $2
     ORDER BY CASE WHEN "FGACTIVE" = 'A' THEN 0 ELSE 1 END, "IDEQUIPAMENTO" DESC
     LIMIT 1`,
    [tid, placaUp]
  );
  if (rPlaca.rows && rPlaca.rows.length) {
    const id =
      rPlaca.rows[0].IDEQUIPAMENTO != null ? Number(rPlaca.rows[0].IDEQUIPAMENTO) : Number(rPlaca.rows[0].idequipamento);
    return { idequipamento: id, equipamentoCriado: false };
  }

  let cdTipo = mv.CDTIPOEquipamento ?? mv.cdtipoequipamento;
  if (cdTipo != null) {
    const nt = parseInt(String(cdTipo), 10);
    cdTipo = Number.isFinite(nt) ? nt : null;
  }
  if (cdTipo) {
    const okT = await client.query(
      `SELECT 1 FROM "TIPOEQUIPAMENTO"
       WHERE "CDTIPOEQUIPAMENTO" = $1::int AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [cdTipo, tid]
    );
    if (!okT.rows || !okT.rows.length) cdTipo = null;
  }
  if (!cdTipo) {
    cdTipo = await buscarPrimeiroTipoEquipamentoTenant(client, tid);
  }
  let cdMarca = await buscarPrimeiraMarcaEquipamentoTenant(client, tid);
  if (!cdTipo || !cdMarca) {
    const err = new Error(
      'Cadastre ao menos um Tipo e uma Marca de equipamento no tenant (Gerenciar Tipos / Marcas) para gerar o equipamento automaticamente na aprovação.'
    );
    err.httpStatus = 503;
    err.code = 'EQ_CATALOG';
    throw err;
  }

  let cdClasse = mv.CDCLASSEFROTA != null ? mv.CDCLASSEFROTA : mv.cdclassefrota;
  if (cdClasse != null) {
    const nc = parseInt(String(cdClasse), 10);
    cdClasse = Number.isFinite(nc) && nc > 0 ? nc : null;
  }
  if (cdClasse) {
    const okC = await client.query(
      `SELECT 1 FROM "CLASSEFROTA" WHERE "CDCLASSEFROTA" = $1::int AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default' OR "TENANT_ID" IS NULL)`,
      [cdClasse, tid]
    );
    if (!okC.rows || !okC.rows.length) cdClasse = null;
  }

  const fr = String(motoristaFgrastreado == null ? 'N' : motoristaFgrastreado).trim().toUpperCase();
  const fgrast = fr === 'S' ? 'S' : 'N';
  const descricao = rz ? `App motorista — ${rz} — ${placaUp}`.slice(0, 240) : `App motorista — ${placaUp}`.slice(0, 240);

  const maxR = await client.query(`SELECT COALESCE(MAX("IDEQUIPAMENTO"), 0) + 1 AS n FROM "EQUIPAMENTO"`);
  const novoId = getFirstNumericValue(maxR.rows, 1);

  try {
    await client.query(
      `INSERT INTO "EQUIPAMENTO" (
        "IDEQUIPAMENTO", "REFEQUIPAMENTO", "DSEQUIPAMENTO", "CDGRUPOEQUIPAMENTO",
        "CDTIPOEQUIPAMENTO", "CDMARCAEQUIPAMENTO", "CDMODELOEQUIPAMENTO", "CDCLASSEFROTA",
        "FGTIPOATUACAO", "FGTIPOCARROCERIA", "NREIXOS", "CAPACIDCARGA", "ANOFABRICA",
        "ALTURA", "LARGURA", "COMPRIMENTO", "MTCUBICO", "FGRASTREADO", "FGACTIVE",
        "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
      ) VALUES (
        $1::numeric, $2, $3, NULL,
        $4::int, $5::int, NULL, $6::int,
        'T', '10', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, $7, 'A',
        CURRENT_TIMESTAMP, $8, 'MotoristaVeiculoAprovacao', $9
      )`,
      [novoId, placaUp, descricao, cdTipo, cdMarca, cdClasse, fgrast, sgSafe, tid]
    );
    return { idequipamento: novoId, equipamentoCriado: true };
  } catch (insErr) {
    if (insErr && insErr.code === '23505') {
      const r2 = await client.query(
        `SELECT "IDEQUIPAMENTO" FROM "EQUIPAMENTO"
         WHERE "TENANT_ID" = $1
           AND UPPER(REGEXP_REPLACE(TRIM(COALESCE("REFEQUIPAMENTO", '')), '[^A-Z0-9]', '', 'g')) = $2
         ORDER BY "IDEQUIPAMENTO" DESC LIMIT 1`,
        [tid, placaUp]
      );
      if (r2.rows && r2.rows.length) {
        const id =
          r2.rows[0].IDEQUIPAMENTO != null ? Number(r2.rows[0].IDEQUIPAMENTO) : Number(r2.rows[0].idequipamento);
        return { idequipamento: id, equipamentoCriado: false };
      }
    }
    if (insErr && insErr.code === '42703') {
      const err = new Error('Estrutura da tabela EQUIPAMENTO incompatível; verifique colunas no banco.');
      err.httpStatus = 503;
      throw err;
    }
    throw insErr;
  }
}

// Controller methods
const cadastroController = {
  // Listar cadastros com filtros
  listar: async (req, res) => {
    try {
      const {
        codigo, cgccpf, razaoSocial, nomeFantasia, tipoPessoa,
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador,
        statusAprovacao
      } = req.query;
      
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const values = [];
      let paramIndex = 0;
      const pushVal = (v) => { values.push(v); return `$${++paramIndex}`; };

      let query = `
        SELECT 
          cg."CDCADASTRO",
          cg."CGCCPF",
          cg."RZSOCIAL",
          cg."NMFANTASIA",
          cg."FGFISICAJURIDICA",
          cg."CEP",
          cg."CDCIDADE",
          c."ESTADO" AS "CIDADE_ESTADO",
          c."NMCIDADE" AS "CIDADE_NOME",
          cg."ENDERECO",
          cg."NRENDERECO",
          cg."COMPLEND",
          cg."BAIRRO",
          cg."NRCELULAR",
          cg."ENDEMAIL",
          cg."LATITUDE",
          cg."LONGITUDE",
          cg."FGACTIVE",
          cg."FGTIPOCADASTRO",
          cg."FGOPERADOR", cg."FGPROGRAMADOR", cg."FGMOTORISTA", cg."FGTRANSPORTADOR",
          cg."FGAGENTE", cg."FGGRUPO", cg."FGCERTIFICADORA", cg."FGUNIDADENEGOCIO",
          cg."CDTRANSPORTADOR",
          cg."TIPO_TRANSPORTE_BR",
          t."RZSOCIAL" AS "TRANSPORTADOR_NOME",
          cg."PAIS",
          cg."SGUSER",
          mc."STATUSAPROVACAO"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "CADASTROGERAL" t ON cg."CDTRANSPORTADOR" = t."CDCADASTRO" AND t."TENANT_ID" = cg."TENANT_ID"
        LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
        WHERE 1=1
      `;

      query += ` AND cg."TENANT_ID" = ${pushVal(tid)}`;

      if (codigo) {
        query += ` AND cg."CDCADASTRO" = ${pushVal(parseFloat(codigo))}`;
      }
      if (cgccpf) {
        const cgccpfStr = String(cgccpf).replace(/[^\d]+/g, '');
        query += ` AND cg."CGCCPF" = ${pushVal(cgccpfStr)}`;
      }
      if (razaoSocial) {
        query += ` AND cg."RZSOCIAL" ILIKE ${pushVal(`%${razaoSocial}%`)}`;
      }
      if (nomeFantasia) {
        query += ` AND cg."NMFANTASIA" ILIKE ${pushVal(`%${nomeFantasia}%`)}`;
      }
      if (tipoPessoa) {
        query += ` AND cg."FGFISICAJURIDICA" = ${pushVal(tipoPessoa)}`;
      }
      if (cidadeEstado) {
        query += ` AND c."ESTADO" = ${pushVal(cidadeEstado)}`;
      }
      if (cidadeNome) {
        query += ` AND c."NMCIDADE" LIKE ${pushVal(`%${cidadeNome}%`)}`;
      }
      if (celular) {
        query += ` AND cg."NRCELULAR" = ${pushVal(parseFloat(celular))}`;
      }
      if (email) {
        query += ` AND cg."ENDEMAIL" LIKE ${pushVal(`%${email}%`)}`;
      }
      if (situacao) {
        query += ` AND cg."FGACTIVE" = ${pushVal(situacao === 'S' ? 'A' : 'I')}`;
      }
      if (tipoCadastro) {
        const col = APPLICABLE_COL_MAP[tipoCadastro.trim().toUpperCase()];
        if (col) query += ` AND cg."${col}" = ${pushVal('S')}`;
        else query += ` AND cg."FGTIPOCADASTRO" = ${pushVal(tipoCadastro.trim().toUpperCase())}`;
      }
      if (rastreado) {
        query += ` AND cg."FGRASTREADO" = ${pushVal(rastreado)}`;
      }
      if (transportador) {
        query += ` AND cg."CDTRANSPORTADOR" = ${pushVal(parseFloat(transportador))}`;
      }
      if (statusAprovacao) {
        const s = String(statusAprovacao).trim().toUpperCase();
        if (['P', 'A', 'R'].includes(s)) {
          query += ` AND mc."CDCADASTRO" IS NOT NULL AND mc."STATUSAPROVACAO" = ${pushVal(s)}`;
        }
      }

      query += ` ORDER BY cg."RZSOCIAL"`;

      const result = await pool.query(query, values);
      const cadastros = (result.rows || []).map(cg => {
        const aplicavel = APPLICABLE_OPCOES.filter(a => (cg[a.col] || '') === 'S').map(a => a.cod);
        const tipoCadastroNome = aplicavel.length
          ? aplicavel.map(c => TIPO_CADASTRO[c]).join(', ')
          : (TIPO_CADASTRO[cg.FGTIPOCADASTRO] || 'Não informado');
        return {
          CDCADASTRO: cg.CDCADASTRO,
          CGCCPF: cg.CGCCPF,
          RZSOCIAL: cg.RZSOCIAL,
          NMFANTASIA: cg.NMFANTASIA || 'Não informado',
          FGFISICAJURIDICA: cg.FGFISICAJURIDICA,
          FGFISICAJURIDICA_NOME: FISICA_JURIDICA[cg.FGFISICAJURIDICA] || 'Não informado',
          CEP: cg.CEP,
          CDCIDADE: cg.CDCIDADE,
          CIDADE_ESTADO: cg.CIDADE_ESTADO || 'Não informado',
          CIDADE_NOME: cg.CIDADE_NOME || 'Não informado',
          ENDERECO: cg.ENDERECO,
          NRENDERECO: cg.NRENDERECO,
          COMPLEND: cg.COMPLEND || 'Não informado',
          BAIRRO: cg.BAIRRO,
          NRCELULAR: cg.NRCELULAR,
          ENDEMAIL: cg.ENDEMAIL || 'Não informado',
          LATITUDE: cg.LATITUDE,
          LONGITUDE: cg.LONGITUDE,
          FGACTIVE: cg.FGACTIVE === 'A' ? 'S' : 'N',
          FGTIPOCADASTRO: cg.FGTIPOCADASTRO,
          FGTIPOCADASTRO_NOME: tipoCadastroNome,
          FGOPERADOR: (cg.FGOPERADOR || 'N') === 'S',
          FGPROGRAMADOR: (cg.FGPROGRAMADOR || 'N') === 'S',
          FGMOTORISTA: (cg.FGMOTORISTA || 'N') === 'S',
          FGTRANSPORTADOR: (cg.FGTRANSPORTADOR || 'N') === 'S',
          FGAGENTE: (cg.FGAGENTE || 'N') === 'S',
          FGGRUPO: (cg.FGGRUPO || 'N') === 'S',
          FGCERTIFICADORA: (cg.FGCERTIFICADORA || 'N') === 'S',
          FGUNIDADENEGOCIO: (cg.FGUNIDADENEGOCIO || 'N') === 'S',
          APLICAVEL_CODIGOS: aplicavel,
          CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null,
          TRANSPORTADOR_NOME: cg.TRANSPORTADOR_NOME || null,
          TIPO_TRANSPORTE_BR: cg.TIPO_TRANSPORTE_BR || null,
          TIPO_TRANSPORTE_BR_NOME: (cg.TIPO_TRANSPORTE_BR && TIPO_TRANSPORTE_BR_LABELS[cg.TIPO_TRANSPORTE_BR]) || null,
          PAIS: cg.PAIS || null,
          SGUSER: cg.SGUSER != null ? String(cg.SGUSER).trim() : null,
          STATUSAPROVACAO: (cg.STATUSAPROVACAO || (cg.FGMOTORISTA === 'S' ? 'P' : null))
        };
      });
      
      res.json(cadastros);
    } catch (err) {
      const msg = err.message || String(err);
      const code = err.code; // código do PostgreSQL (ex: 42P01 = tabela não existe, 28P01 = auth failed)
      console.error('[CadastroGeral] Erro ao listar:', msg);
      if (code) console.error('[CadastroGeral] Código:', code, err.detail || '');
      if (err.stack) console.error(err.stack);
      const details = process.env.NODE_ENV === 'development' ? { message: msg, code: code || undefined, detail: err.detail } : undefined;
      res.status(500).json({ error: 'Erro ao carregar cadastros.', ...(details && { details }) });
    }
  },

  /** Contagem de motoristas com aprovação pendente (ex.: cadastro pelo app). Usado no badge do dashboard. */
  contadorMotoristasPendentes: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      // LEFT JOIN: motorista marcado na torre pode ainda não ter linha em MOTORISTA_COMPLEMENTO;
      // na UI o status aparece como Pendente (P) por omissão — o badge deve contar igual.
      const r = await pool.query(
        `
        SELECT COUNT(DISTINCT cg."CDCADASTRO")::int AS "n"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
        WHERE cg."FGMOTORISTA" = 'S'
          AND cg."TENANT_ID" = $1
          AND cg."FGACTIVE" = 'A'
          AND UPPER(TRIM(COALESCE(mc."STATUSAPROVACAO", ''))) IN ('', 'P')
      `,
        [tid]
      );
      const n = (r.rows && r.rows[0] && r.rows[0].n != null) ? Number(r.rows[0].n) : 0;
      res.json({ count: n });
    } catch (err) {
      console.error('[CadastroGeral] contador motoristas pendentes:', err);
      res.status(500).json({ error: 'Erro ao contar cadastros pendentes.' });
    }
  },

  // Criar novo cadastro
  criar: async (req, res) => {
    try {
      const {
        CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
        ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL,
        LATITUDE, LONGITUDE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR,
        FGOPERADOR, FGPROGRAMADOR, FGMOTORISTA, FGTRANSPORTADOR: FGTRANSP,
        FGAGENTE, FGGRUPO, FGCERTIFICADORA, FGUNIDADENEGOCIO,
        PAIS
      } = req.body;

      const flags = {
        FGOPERADOR: FGOPERADOR === true || FGOPERADOR === 'S',
        FGPROGRAMADOR: FGPROGRAMADOR === true || FGPROGRAMADOR === 'S',
        FGMOTORISTA: FGMOTORISTA === true || FGMOTORISTA === 'S',
        FGTRANSPORTADOR: FGTRANSP === true || FGTRANSP === 'S',
        FGAGENTE: FGAGENTE === true || FGAGENTE === 'S',
        FGGRUPO: FGGRUPO === true || FGGRUPO === 'S',
        FGCERTIFICADORA: FGCERTIFICADORA === true || FGCERTIFICADORA === 'S',
        FGUNIDADENEGOCIO: FGUNIDADENEGOCIO === true || FGUNIDADENEGOCIO === 'S'
      };
      const algumAplicavel = Object.values(flags).some(v => v === true);
      if (!algumAplicavel && !FGTIPOCADASTRO) {
        return res.status(400).json({ error: 'Marque pelo menos uma opção em Aplicável para.' });
      }
      const tipoLegado = FGTIPOCADASTRO || (APPLICABLE_OPCOES.find(a => flags[a.col])?.cod ?? 'O');

      // Validações
      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.', errorKey: 'web.modulos.cadastroGeral.camposObrigatorios' });
      }

      const ctx = await getContexto(tenantIdForRequest(req));
      const tipoDoc = FGFISICAJURIDICA === 'F' ? 'F' : 'J';
      let cgccpfStr = normalizarDocumento(ctx.pais, CGCCPF.toString());
      if (ctx.pais === 'BR') {
        if (FGFISICAJURIDICA === 'F') cgccpfStr = cgccpfStr.padStart(11, '0');
        else if (FGFISICAJURIDICA === 'J') cgccpfStr = cgccpfStr.padStart(14, '0');
      }

      const validacao = validarDocumento(ctx.pais, tipoDoc, cgccpfStr);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'web.modulos.cadastroGeral.documentoInvalido' });
      }

      // Verificar duplicidade e gerar novo ID (PostgreSQL)
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const checkDup = await pool.query(
        'SELECT "CDCADASTRO" FROM "CADASTROGERAL" WHERE "CGCCPF" = $1 AND "TENANT_ID" = $2',
        [cgccpfStr, tid]
      );
      if ((checkDup.rows || []).length > 0) {
        return res.status(400).json({ error: 'Já existe um cadastro com este documento.', errorKey: 'web.modulos.cadastroGeral.documentoDuplicado' });
      }

      const maxRes = await pool.query(
        'SELECT COALESCE(MAX("CDCADASTRO"), 0)::numeric AS "maxId" FROM "CADASTROGERAL"'
      );
      const novoId = Number((maxRes.rows || [])[0]?.maxId ?? 0) + 1;

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const tipoBrRes = resolverTipoTransporteBr(req.body, flags);
      if (tipoBrRes.erro) return res.status(400).json({ error: tipoBrRes.erro });
      const rastRes = resolverFgrastreado(FGRASTREADO, flags);
      if (rastRes.erro) return res.status(400).json({ error: rastRes.erro });
      const toS = (v) => (v ? 'S' : 'N');
      await pool.query(
        `INSERT INTO "CADASTROGERAL" (
          "CDCADASTRO", "CGCCPF", "RZSOCIAL", "NMFANTASIA", "FGFISICAJURIDICA", "CEP", "CDCIDADE",
          "ENDERECO", "NRENDERECO", "COMPLEND", "BAIRRO", "NRCELULAR", "ENDEMAIL", "LATITUDE", "LONGITUDE",
          "FGACTIVE", "FGTIPOCADASTRO", "FGOPERADOR", "FGPROGRAMADOR", "FGMOTORISTA", "FGTRANSPORTADOR",
          "FGAGENTE", "FGGRUPO", "FGCERTIFICADORA", "FGUNIDADENEGOCIO",
          "FGRASTREADO", "CDTRANSPORTADOR", "PAIS", "TIPO_TRANSPORTE_BR", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'A', $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, CURRENT_TIMESTAMP, $29, 'AppDVcargas', $30)`,
        [
          novoId, cgccpfStr, RZSOCIAL.trim(), NMFANTASIA?.trim() || null, FGFISICAJURIDICA,
          CEP || null, CDCIDADE || null, (ENDERECO && String(ENDERECO).trim()) ? String(ENDERECO).trim() : null, (NRENDERECO !== undefined && NRENDERECO !== null && NRENDERECO !== '') ? NRENDERECO : null, COMPLEND?.trim() || null,
          (BAIRRO && String(BAIRRO).trim()) ? String(BAIRRO).trim() : null, NRCELULAR, ENDEMAIL?.trim() || null, LATITUDE || null, LONGITUDE || null,
          tipoLegado,
          toS(flags.FGOPERADOR), toS(flags.FGPROGRAMADOR), toS(flags.FGMOTORISTA), toS(flags.FGTRANSPORTADOR),
          toS(flags.FGAGENTE), toS(flags.FGGRUPO), toS(flags.FGCERTIFICADORA), toS(flags.FGUNIDADENEGOCIO),
          rastRes.valor, (flags.FGMOTORISTA && CDTRANSPORTADOR) ? CDTRANSPORTADOR : null,
          (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : null,
          tipoBrRes.valor,
          sgUser,
          tid
        ]
      );

      // Não inserir classes de frota ao criar: novo cadastro começa com nenhuma classe selecionada.
      // O usuário escolhe na aba "Classes Frota" após salvar.

      res.status(201).json({ 
        success: true, 
        message: 'Cadastro geral criado com sucesso!',
        CDCADASTRO: novoId
      });
    } catch (err) {
      const code = err && err.code;
      const constr = err && err.constraint;
      if (code === '23505' && (constr === 'UK_CADASTROGERAL_CGCCPF' || String(err.message || '').includes('UK_CADASTROGERAL_CGCCPF'))) {
        return res.status(400).json({
          error:
            'Este documento já existe em outro tenant ou a base ainda usa unicidade global de CPF/CNPJ. ' +
            'Para multi-tenant, execute no PostgreSQL o script backend/scripts/cadastrogeral_uk_tenant_cgccpf_postgres.sql (backup antes).',
          errorKey: 'web.modulos.cadastroGeral.documentoDuplicado'
        });
      }
      console.error('Erro ao inserir cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao cadastrar.' });
    }
  },

  // Atualizar cadastro
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
        ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL,
        LATITUDE, LONGITUDE, FGACTIVE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR,
        FGOPERADOR, FGPROGRAMADOR, FGMOTORISTA, FGTRANSPORTADOR: FGTRANSP,
        FGAGENTE, FGGRUPO, FGCERTIFICADORA, FGUNIDADENEGOCIO,
        PAIS,
        STATUSAPROVACAO, PAIS_DESTINO_PREF, SIGLA_ESTADO_DESTINO_PREF, CIDADE_DESTINO_PREF,
        PAIS_EMBARQUE_PREF, SIGLA_ESTADO_EMBARQUE_PREF, REGIAO_EMBARQUE_PREF, CIDADE_EMBARQUE_PREF
      } = req.body;

      const flags = {
        FGOPERADOR: FGOPERADOR === true || FGOPERADOR === 'S',
        FGPROGRAMADOR: FGPROGRAMADOR === true || FGPROGRAMADOR === 'S',
        FGMOTORISTA: FGMOTORISTA === true || FGMOTORISTA === 'S',
        FGTRANSPORTADOR: FGTRANSP === true || FGTRANSP === 'S',
        FGAGENTE: FGAGENTE === true || FGAGENTE === 'S',
        FGGRUPO: FGGRUPO === true || FGGRUPO === 'S',
        FGCERTIFICADORA: FGCERTIFICADORA === true || FGCERTIFICADORA === 'S',
        FGUNIDADENEGOCIO: FGUNIDADENEGOCIO === true || FGUNIDADENEGOCIO === 'S'
      };
      const algumAplicavel = Object.values(flags).some(v => v === true);
      if (!algumAplicavel && !FGTIPOCADASTRO) {
        return res.status(400).json({ error: 'Marque pelo menos uma opção em Aplicável para.' });
      }
      const tipoLegado = FGTIPOCADASTRO || (APPLICABLE_OPCOES.find(a => flags[a.col])?.cod ?? 'O');

      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.', errorKey: 'web.modulos.cadastroGeral.camposObrigatorios' });
      }

      const ctx = await getContexto(tenantIdForRequest(req));
      // País do cadastro prevalece; quando não informado, usa o padrão das Configurações.
      const paisVal = (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : (ctx.pais || 'BR');
      const tipoDoc = FGFISICAJURIDICA === 'F' ? 'F' : 'J';
      let cgccpfStr = normalizarDocumento(paisVal, CGCCPF.toString());
      if (paisVal === 'BR') {
        if (FGFISICAJURIDICA === 'F') cgccpfStr = cgccpfStr.padStart(11, '0');
        else if (FGFISICAJURIDICA === 'J') cgccpfStr = cgccpfStr.padStart(14, '0');
      }

      const validacao = validarDocumento(paisVal, tipoDoc, cgccpfStr);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'web.modulos.cadastroGeral.documentoInvalido' });
      }

      const sgUserUpd = getSgUser(req);
      if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const idNumerico = parseFloat(id);

      const cadastroAtual = await pool.query(
        'SELECT "CDTRANSPORTADOR" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2',
        [idNumerico, tid]
      );
      const rowsAtual = cadastroAtual.rows || [];
      if (rowsAtual.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      const dupOutro = await pool.query(
        'SELECT 1 FROM "CADASTROGERAL" WHERE "CGCCPF" = $1 AND "TENANT_ID" = $2 AND "CDCADASTRO" <> $3',
        [cgccpfStr, tid, idNumerico]
      );
      if ((dupOutro.rows || []).length > 0) {
        return res.status(400).json({ error: 'Já existe um cadastro com este documento.', errorKey: 'web.modulos.cadastroGeral.documentoDuplicado' });
      }
      const toS = (v) => (v ? 'S' : 'N');
      const valorTransportador = !flags.FGMOTORISTA ? null
        : (CDTRANSPORTADOR !== undefined ? (CDTRANSPORTADOR || null) : (rowsAtual[0]?.CDTRANSPORTADOR ?? null));

      const tipoBrRes = resolverTipoTransporteBr(req.body, flags);
      if (tipoBrRes.erro) return res.status(400).json({ error: tipoBrRes.erro });
      const rastRes = resolverFgrastreado(FGRASTREADO, flags);
      if (rastRes.erro) return res.status(400).json({ error: rastRes.erro });

      const updCg = await pool.query(
        `UPDATE "CADASTROGERAL" SET
          "CGCCPF" = $1, "RZSOCIAL" = $2, "NMFANTASIA" = $3, "FGFISICAJURIDICA" = $4,
          "CEP" = $5, "CDCIDADE" = $6, "ENDERECO" = $7, "NRENDERECO" = $8,
          "COMPLEND" = $9, "BAIRRO" = $10, "NRCELULAR" = $11, "ENDEMAIL" = $12,
          "LATITUDE" = $13, "LONGITUDE" = $14, "FGACTIVE" = $15, "FGTIPOCADASTRO" = $16,
          "FGOPERADOR" = $17, "FGPROGRAMADOR" = $18, "FGMOTORISTA" = $19, "FGTRANSPORTADOR" = $20,
          "FGAGENTE" = $21, "FGGRUPO" = $22, "FGCERTIFICADORA" = $23, "FGUNIDADENEGOCIO" = $24,
          "FGRASTREADO" = $25, "CDTRANSPORTADOR" = $26, "PAIS" = $27, "TIPO_TRANSPORTE_BR" = $28,
          "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $29, "SERVERORIG" = 'AppDVcargas'
        WHERE "CDCADASTRO" = $30 AND "TENANT_ID" = $31`,
        [
          cgccpfStr, RZSOCIAL.trim(), NMFANTASIA?.trim() || null, FGFISICAJURIDICA,
          CEP || null, CDCIDADE || null, (ENDERECO && String(ENDERECO).trim()) ? String(ENDERECO).trim() : null, (NRENDERECO !== undefined && NRENDERECO !== null && NRENDERECO !== '') ? NRENDERECO : null,
          COMPLEND?.trim() || null, (BAIRRO && String(BAIRRO).trim()) ? String(BAIRRO).trim() : null, NRCELULAR, ENDEMAIL?.trim() || null,
          LATITUDE || null, LONGITUDE || null, FGACTIVE === 'S' ? 'A' : 'I',
          tipoLegado,
          toS(flags.FGOPERADOR), toS(flags.FGPROGRAMADOR), toS(flags.FGMOTORISTA), toS(flags.FGTRANSPORTADOR),
          toS(flags.FGAGENTE), toS(flags.FGGRUPO), toS(flags.FGCERTIFICADORA), toS(flags.FGUNIDADENEGOCIO),
          rastRes.valor, valorTransportador,
          (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : null,
          tipoBrRes.valor,
          sgUserUpd, idNumerico, tid
        ]
      );
      if ((updCg.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      if (flags.FGMOTORISTA) {
        const statusAprov = (STATUSAPROVACAO && ['P', 'A', 'R'].includes(String(STATUSAPROVACAO).trim().toUpperCase()))
          ? String(STATUSAPROVACAO).trim().toUpperCase() : 'P';
        const paisDest = (PAIS_DESTINO_PREF && String(PAIS_DESTINO_PREF).trim()) ? String(PAIS_DESTINO_PREF).trim().substring(0, 2) : null;
        const estadoDest = (SIGLA_ESTADO_DESTINO_PREF && String(SIGLA_ESTADO_DESTINO_PREF).trim()) ? String(SIGLA_ESTADO_DESTINO_PREF).trim().substring(0, 10) : null;
        const cidadeDest = (CIDADE_DESTINO_PREF && String(CIDADE_DESTINO_PREF).trim()) ? String(CIDADE_DESTINO_PREF).trim().substring(0, 100) : null;
        const paisEmb = (PAIS_EMBARQUE_PREF && String(PAIS_EMBARQUE_PREF).trim()) ? String(PAIS_EMBARQUE_PREF).trim().substring(0, 2) : null;
        const estadoEmb = (SIGLA_ESTADO_EMBARQUE_PREF && String(SIGLA_ESTADO_EMBARQUE_PREF).trim()) ? String(SIGLA_ESTADO_EMBARQUE_PREF).trim().substring(0, 10) : null;
        const regiaoEmb = (REGIAO_EMBARQUE_PREF && String(REGIAO_EMBARQUE_PREF).trim()) ? String(REGIAO_EMBARQUE_PREF).trim().substring(0, 60) : null;
        const cidadeEmb = (CIDADE_EMBARQUE_PREF && String(CIDADE_EMBARQUE_PREF).trim()) ? String(CIDADE_EMBARQUE_PREF).trim().substring(0, 100) : null;
        const existeMc = await pool.query(
          'SELECT 1 FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1',
          [idNumerico]
        );
        if ((existeMc.rows || []).length > 0) {
          await pool.query(
            `UPDATE "MOTORISTA_COMPLEMENTO" SET "STATUSAPROVACAO" = $1, "PAIS_DESTINO_PREF" = $2, "SIGLA_ESTADO_DESTINO_PREF" = $3, "CIDADE_DESTINO_PREF" = $4,
             "PAIS_EMBARQUE_PREF" = $6, "SIGLA_ESTADO_EMBARQUE_PREF" = $7, "REGIAO_EMBARQUE_PREF" = $8, "CIDADE_EMBARQUE_PREF" = $9, "TENANT_ID" = $10
             WHERE "CDCADASTRO" = $5`,
            [statusAprov, paisDest, estadoDest, cidadeDest, idNumerico, paisEmb, estadoEmb, regiaoEmb, cidadeEmb, tid]
          );
        } else {
          await pool.query(
            `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "STATUSAPROVACAO", "PAIS_DESTINO_PREF", "SIGLA_ESTADO_DESTINO_PREF", "CIDADE_DESTINO_PREF",
             "PAIS_EMBARQUE_PREF", "SIGLA_ESTADO_EMBARQUE_PREF", "REGIAO_EMBARQUE_PREF", "CIDADE_EMBARQUE_PREF", "TENANT_ID") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [idNumerico, statusAprov, paisDest, estadoDest, cidadeDest, paisEmb, estadoEmb, regiaoEmb, cidadeEmb, tid]
          );
        }
      }

      res.json({ success: true, message: 'Cadastro atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao atualizar cadastro.' });
    }
  },

  // Buscar cadastro por ID (PostgreSQL)
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const tenantDefault = getDefaultTenantId();
      const params = [parseFloat(id), tid, tenantDefault];
      const baseSelect = `
        SELECT 
          cg."CDCADASTRO", cg."CGCCPF", cg."RZSOCIAL", cg."NMFANTASIA",
          cg."FGFISICAJURIDICA", cg."CEP", cg."CDCIDADE", cg."PAIS",
          c."ESTADO" AS "CIDADE_ESTADO", c."NMCIDADE" AS "CIDADE_NOME",
          cg."ENDERECO", cg."NRENDERECO", cg."COMPLEND", cg."BAIRRO",
          cg."NRCELULAR", cg."ENDEMAIL", cg."LATITUDE", cg."LONGITUDE",
          cg."FGACTIVE", cg."FGTIPOCADASTRO", cg."FGRASTREADO", cg."CDTRANSPORTADOR",
          cg."FGOPERADOR", cg."FGPROGRAMADOR", cg."FGMOTORISTA", cg."FGTRANSPORTADOR",
          cg."FGAGENTE", cg."FGGRUPO", cg."FGCERTIFICADORA", cg."FGUNIDADENEGOCIO",
          cg."TIPO_TRANSPORTE_BR",
          mc."STATUSAPROVACAO", mc."PAIS_DESTINO_PREF", mc."SIGLA_ESTADO_DESTINO_PREF", mc."CIDADE_DESTINO_PREF",
          mc."NRCNH", mc."CATEGORIACNH", mc."VALIDADECNH", mc."FOTOCNH"`;
      const fromWhere = `
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
        WHERE cg."CDCADASTRO" = $1
          AND (
            cg."TENANT_ID" = $2
            OR cg."TENANT_ID" = $3
            OR EXISTS (
              SELECT 1 FROM "USUARIO" u
              WHERE u."CDCADASTRO" = $1
                AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $3) = $2
            )
          )
        ORDER BY CASE WHEN cg."TENANT_ID" = $2 THEN 0 WHEN cg."TENANT_ID" = $3 THEN 1 ELSE 2 END
        LIMIT 1`;
      const mcExtrasAttempts = [
        ', mc."FOTO_COMPROVANTE_ENDERECO", mc."FOTOCNH_VERSO"',
        ', mc."FOTO_COMPROVANTE_ENDERECO"',
        ', mc."FOTOCNH_VERSO"',
        '',
      ];
      let result;
      let lastQErr;
      for (const ex of mcExtrasAttempts) {
        try {
          result = await pool.query(`${baseSelect}${ex} ${fromWhere}`, params);
          lastQErr = null;
          break;
        } catch (errQ) {
          lastQErr = errQ;
          if (errQ.code !== '42703') throw errQ;
        }
      }
      if (!result) throw lastQErr;
      const rows = result.rows || [];
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const cg = rows[0];
      res.json({
        CDCADASTRO: cg.CDCADASTRO,
        CGCCPF: cg.CGCCPF,
        RZSOCIAL: cg.RZSOCIAL,
        NMFANTASIA: cg.NMFANTASIA,
        FGFISICAJURIDICA: cg.FGFISICAJURIDICA,
        CEP: cg.CEP,
        CDCIDADE: cg.CDCIDADE,
        PAIS: cg.PAIS || null,
        CIDADE_ESTADO: cg.CIDADE_ESTADO,
        CIDADE_NOME: cg.CIDADE_NOME,
        ENDERECO: cg.ENDERECO,
        NRENDERECO: cg.NRENDERECO,
        COMPLEND: cg.COMPLEND,
        BAIRRO: cg.BAIRRO,
        NRCELULAR: cg.NRCELULAR,
        ENDEMAIL: cg.ENDEMAIL,
        LATITUDE: cg.LATITUDE,
        LONGITUDE: cg.LONGITUDE,
        FGACTIVE: cg.FGACTIVE === 'A' ? 'S' : 'N',
        FGTIPOCADASTRO: cg.FGTIPOCADASTRO,
        FGRASTREADO: cg.FGRASTREADO || 'N',
        CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null,
        FGOPERADOR: (cg.FGOPERADOR || 'N') === 'S',
        FGPROGRAMADOR: (cg.FGPROGRAMADOR || 'N') === 'S',
        FGMOTORISTA: (cg.FGMOTORISTA || 'N') === 'S',
        FGTRANSPORTADOR: (cg.FGTRANSPORTADOR || 'N') === 'S',
        FGAGENTE: (cg.FGAGENTE || 'N') === 'S',
        FGGRUPO: (cg.FGGRUPO || 'N') === 'S',
        FGCERTIFICADORA: (cg.FGCERTIFICADORA || 'N') === 'S',
        FGUNIDADENEGOCIO: (cg.FGUNIDADENEGOCIO || 'N') === 'S',
        TIPO_TRANSPORTE_BR: cg.TIPO_TRANSPORTE_BR || null,
        STATUSAPROVACAO: cg.STATUSAPROVACAO || 'P',
        PAIS_DESTINO_PREF: cg.PAIS_DESTINO_PREF || null,
        SIGLA_ESTADO_DESTINO_PREF: cg.SIGLA_ESTADO_DESTINO_PREF || null,
        CIDADE_DESTINO_PREF: cg.CIDADE_DESTINO_PREF || null,
        PAIS_EMBARQUE_PREF: cg.PAIS_EMBARQUE_PREF || null,
        SIGLA_ESTADO_EMBARQUE_PREF: cg.SIGLA_ESTADO_EMBARQUE_PREF || null,
        REGIAO_EMBARQUE_PREF: cg.REGIAO_EMBARQUE_PREF || null,
        CIDADE_EMBARQUE_PREF: cg.CIDADE_EMBARQUE_PREF || null,
        NRCNH: cg.NRCNH != null ? String(cg.NRCNH).trim() : null,
        CATEGORIACNH: cg.CATEGORIACNH != null ? String(cg.CATEGORIACNH).trim() : null,
        VALIDADECNH: cg.VALIDADECNH || null,
        FOTOCNH: cg.FOTOCNH != null ? String(cg.FOTOCNH).trim() : null,
        FOTOCNH_VERSO: cg.FOTOCNH_VERSO != null ? String(cg.FOTOCNH_VERSO).trim() : null,
        FOTO_COMPROVANTE_ENDERECO:
          cg.FOTO_COMPROVANTE_ENDERECO != null ? String(cg.FOTO_COMPROVANTE_ENDERECO).trim() : null
      });
    } catch (err) {
      console.error('Erro ao buscar cadastro:', err);
      res.status(500).json({ error: 'Erro ao carregar cadastro.' });
    }
  },

  // Excluir/Reativar cadastro (lógica) - Toggle do status
  excluir: async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.query; // 'activate' ou 'deactivate' (opcional, detecta automaticamente se não informado)
      const pool = await poolPromise;
      
      // Validação do ID
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        return res.status(400).json({ error: 'ID inválido.' });
      }
      
      const idNumerico = parseFloat(id);
      if (isNaN(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      const tid = tenantIdForRequest(req);
      const checkResult = await pool.query(
        'SELECT "FGACTIVE" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2',
        [idNumerico, tid]
      );
      const checkRows = checkResult.rows || [];
      if (checkRows.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      const statusAtual = checkRows[0].FGACTIVE;
      const estaAtivo = statusAtual === 'A';
      let novaSituacao, mensagem;
      if (action === 'activate') {
        novaSituacao = 'A';
        mensagem = 'Cadastro reativado com sucesso!';
      } else if (action === 'deactivate') {
        novaSituacao = 'I';
        mensagem = 'Cadastro desativado com sucesso!';
      } else {
        novaSituacao = estaAtivo ? 'I' : 'A';
        mensagem = estaAtivo ? 'Cadastro desativado com sucesso!' : 'Cadastro reativado com sucesso!';
      }

      const sgUserStatus = getSgUser(req);
      if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const result = await pool.query(
        `UPDATE "CADASTROGERAL" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2, "SERVERORIG" = 'AppDVcargas' WHERE "CDCADASTRO" = $3 AND "TENANT_ID" = $4`,
        [novaSituacao, sgUserStatus, idNumerico, tid]
      );

      if ((result.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      res.json({ 
        success: true, 
        message: mensagem,
        newStatus: novaSituacao === 'A' ? 'S' : 'N'
      });
    } catch (err) {
      console.error('Erro ao alterar status do cadastro:', err);
      res.status(500).json({ error: 'Erro ao alterar status do cadastro.' });
    }
  },

  // Buscar CEP
  buscarCEP: async (req, res) => {
    try {
      const { cep } = req.params;
      const dadosCEP = await buscarCEP(cep);
      
      if (!dadosCEP || dadosCEP.erro) {
        return res.status(404).json({ error: 'CEP não encontrado.' });
      }

      const pool = await poolPromise;
      const cidadeResult = await pool.query(
        `SELECT "CDCIDADE", "ESTADO", "NMCIDADE" FROM "CIDADE" WHERE "ESTADO" = $1 AND "NMCIDADE" = $2 AND "FGACTIVE" = 'A' LIMIT 1`,
        [dadosCEP.uf, dadosCEP.localidade]
      );
      const cidadeRows = cidadeResult.rows || [];
      res.json({
        ...dadosCEP,
        cidade: cidadeRows[0] || null
      });
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
      res.status(500).json({ error: 'Erro ao buscar CEP.' });
    }
  },

  // Listar combos (opções para filtro "Aplicável para" - ordem: O, P, M, T, A, G, C, U)
  listarTiposCadastro: (req, res) => {
    const tipos = APPLICABLE_OPCOES.map(a => ({ value: a.cod, label: `[${a.cod}] ${a.label}` }));
    res.json(tipos);
  },

  listarTiposPessoa: (req, res) => {
    const tipos = Object.entries(FISICA_JURIDICA).map(([value, label]) => ({ value, label }));
    res.json(tipos);
  },

  // Listar classes de frota para um cadastro específico (PostgreSQL)
  listarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const idNum = parseFloat(id);
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const todasClasses = await pool.query(
        `SELECT "CDCLASSEFROTA", "DSCLASSEFROTA" FROM "CLASSEFROTA"
         WHERE ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S')
           AND ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
         ORDER BY "DSCLASSEFROTA"`,
        [tid]
      );
      const classesAssociadas = await pool.query(
        `SELECT "CDCLASSEFROTA", "FGACTIVE" FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2`,
        [idNum, tid]
      );
      const mapaAssociadas = {};
      (classesAssociadas.rows || []).forEach(row => {
        const idClasse = row.CDCLASSEFROTA ?? row.cdclassefrota;
        const fg = row.FGACTIVE ?? row.fgactive;
        if (idClasse !== undefined && idClasse !== null) mapaAssociadas[idClasse] = fg;
      });
      const resultado = (todasClasses.rows || []).map(row => {
        const idClasse = row.CDCLASSEFROTA ?? row.cdclassefrota;
        const nome = row.DSCLASSEFROTA ?? row.dsclassefrota;
        return {
          CDCLASSEFROTA: idClasse,
          DSCLASSEFROTA: nome,
          FGACTIVE: (idClasse !== undefined && mapaAssociadas[idClasse] === 'S') ? 'S' : 'N'
        };
      });
      res.json(resultado);
    } catch (err) {
      console.error('Erro ao listar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  // Atualizar classes de frota para um cadastro (PostgreSQL)
  atualizarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const { classes } = req.body;
      if (!classes || !Array.isArray(classes)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      const pool = await poolPromise;
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const tid = tenantIdForRequest(req);
      const idNum = parseFloat(id);
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const existentes = await pool.query(
        'SELECT "CDCLASSEFROTA" FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2',
        [idNum, tid]
      );
      const existentesSet = new Set((existentes.rows || []).map(c => c.CDCLASSEFROTA));
      for (const classe of classes) {
        const { CDCLASSEFROTA, FGACTIVE } = classe;
        if (existentesSet.has(CDCLASSEFROTA)) {
          await pool.query(
            `UPDATE "CLASSEFROTA_CG" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2, "SERVERORIG" = 'AppDVcargas' WHERE "CDCADASTRO" = $3 AND "CDCLASSEFROTA" = $4 AND "TENANT_ID" = $5`,
            [FGACTIVE, sgUser, idNum, CDCLASSEFROTA, tid]
          );
        } else {
          await pool.query(
            `INSERT INTO "CLASSEFROTA_CG" ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID") VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, 'AppDVcargas', $5)`,
            [idNum, CDCLASSEFROTA, FGACTIVE, sgUser, tid]
          );
        }
      }
      res.json({ success: true, message: 'Classes de frota atualizadas com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao atualizar classes de frota.' });
    }
  },

  // Buscar transportadores (tipo T ou flag FGTRANSPORTADOR = S) para combo (PostgreSQL)
  listarTransportadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const result = await pool.query(`
        SELECT "CDCADASTRO", "RZSOCIAL"
        FROM "CADASTROGERAL"
        WHERE ("FGTIPOCADASTRO" = 'T' OR COALESCE("FGTRANSPORTADOR", 'N') = 'S')
          AND "FGACTIVE" = 'A'
          AND "TENANT_ID" = $1
        ORDER BY "RZSOCIAL"
      `, [tid]);
      const rows = result.rows || [];
      // Normalizar chaves para o frontend (PostgreSQL pode devolver minúsculas)
      const list = rows.map(r => ({
        CDCADASTRO: r.CDCADASTRO != null ? r.CDCADASTRO : r.cdcadastro,
        RZSOCIAL: (r.RZSOCIAL != null ? r.RZSOCIAL : r.rzsocial) || '-'
      }));
      res.json(list);
    } catch (err) {
      console.error('Erro ao listar transportadores:', err);
      res.status(500).json({ error: 'Erro ao carregar transportadores.' });
    }
  },

  // Exportar cadastros para Excel (PostgreSQL)
  exportarExcel: async (req, res) => {
    try {
      const {
        codigo, cgccpf, razaoSocial, nomeFantasia, tipoPessoa,
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador
      } = req.query;

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const values = [];
      let paramIndex = 0;
      const pushVal = (v) => { values.push(v); return `$${++paramIndex}`; };

      let query = `
        SELECT 
          cg."CDCADASTRO" AS "Codigo",
          cg."CGCCPF" AS "CPF_CNPJ",
          cg."RZSOCIAL" AS "Razao_Social",
          cg."NMFANTASIA" AS "Nome_Fantasia",
          CASE cg."FGFISICAJURIDICA" WHEN 'F' THEN 'Física' WHEN 'J' THEN 'Jurídica' ELSE 'Não informado' END AS "Tipo_Pessoa",
          CASE cg."FGTIPOCADASTRO" WHEN 'O' THEN 'Operador' WHEN 'M' THEN 'Motorista' WHEN 'A' THEN 'Agente' WHEN 'G' THEN 'Grupo' WHEN 'T' THEN 'Transportador' ELSE 'Não informado' END AS "Tipo_Cadastro",
          CASE cg."FGRASTREADO" WHEN 'S' THEN 'Sim' WHEN 'N' THEN 'Não' ELSE 'Não informado' END AS "Rastreado",
          CASE cg."FGACTIVE" WHEN 'A' THEN 'Ativo' WHEN 'I' THEN 'Inativo' ELSE 'Não informado' END AS "Situacao",
          cg."CEP" AS "CEP", cg."ENDERECO" AS "Endereco", cg."NRENDERECO" AS "Numero", cg."COMPLEND" AS "Complemento", cg."BAIRRO" AS "Bairro",
          c."ESTADO" AS "Estado", c."NMCIDADE" AS "Cidade", c."CDCIDADE" AS "Codigo_Cidade",
          cg."NRCELULAR" AS "Celular", cg."ENDEMAIL" AS "Email",
          cg."LATITUDE" AS "Latitude", cg."LONGITUDE" AS "Longitude",
          cg."CDTRANSPORTADOR" AS "Codigo_Transportador", t."RZSOCIAL" AS "Nome_Transportador", t."CGCCPF" AS "CPF_CNPJ_Transportador", t."NRCELULAR" AS "Celular_Transportador", t."ENDEMAIL" AS "Email_Transportador",
          cg."DHMAINTENANCE" AS "Data_Manutencao", cg."SGUSER" AS "Usuario", cg."SERVERORIG" AS "Servidor_Origem"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "CADASTROGERAL" t ON cg."CDTRANSPORTADOR" = t."CDCADASTRO" AND t."TENANT_ID" = cg."TENANT_ID"
        WHERE 1=1
      `;
      query += ` AND cg."TENANT_ID" = ${pushVal(tid)}`;
      if (codigo) query += ` AND cg."CDCADASTRO" = ${pushVal(parseFloat(codigo))}`;
      if (cgccpf) query += ` AND cg."CGCCPF" = ${pushVal(String(cgccpf).replace(/[^\d]+/g, ''))}`;
      if (razaoSocial) query += ` AND cg."RZSOCIAL" LIKE ${pushVal(`%${razaoSocial}%`)}`;
      if (nomeFantasia) query += ` AND cg."NMFANTASIA" LIKE ${pushVal(`%${nomeFantasia}%`)}`;
      if (tipoPessoa) query += ` AND cg."FGFISICAJURIDICA" = ${pushVal(tipoPessoa)}`;
      if (cidadeEstado) query += ` AND c."ESTADO" = ${pushVal(cidadeEstado)}`;
      if (cidadeNome) query += ` AND c."NMCIDADE" LIKE ${pushVal(`%${cidadeNome}%`)}`;
      if (celular) query += ` AND cg."NRCELULAR" = ${pushVal(parseFloat(celular))}`;
      if (email) query += ` AND cg."ENDEMAIL" LIKE ${pushVal(`%${email}%`)}`;
      if (situacao) query += ` AND cg."FGACTIVE" = ${pushVal(situacao === 'S' ? 'A' : 'I')}`;
      if (tipoCadastro) query += ` AND cg."FGTIPOCADASTRO" = ${pushVal(tipoCadastro.trim().toUpperCase())}`;
      if (rastreado) query += ` AND cg."FGRASTREADO" = ${pushVal(rastreado)}`;
      if (transportador) query += ` AND cg."CDTRANSPORTADOR" = ${pushVal(parseFloat(transportador))}`;
      query += ` ORDER BY cg."RZSOCIAL"`;

      const result = await pool.query(query, values);
      const dados = (result.rows || []).map(row => {
        const obj = {};
        for (const key in row) {
          obj[key] = row[key] !== null && row[key] !== undefined ? row[key] : '';
        }
        return obj;
      });

      // Criar workbook Excel
      const worksheet = XLSX.utils.json_to_sheet(dados);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Cadastros Gerais');

      // Configurar largura das colunas
      const colWidths = [
        { wch: 12 },  // Código
        { wch: 18 },  // CPF/CNPJ
        { wch: 40 },  // Razão Social
        { wch: 30 },  // Nome Fantasia
        { wch: 12 },  // Tipo Pessoa
        { wch: 20 },  // Tipo Cadastro
        { wch: 20 },  // Possui Veículo Rastreado
        { wch: 12 },  // Situação
        { wch: 10 },  // CEP
        { wch: 40 },  // Endereço
        { wch: 10 },  // Número
        { wch: 20 },  // Complemento
        { wch: 25 },  // Bairro
        { wch: 5 },   // Estado
        { wch: 30 },  // Cidade
        { wch: 12 },  // Código Cidade
        { wch: 15 },  // Celular
        { wch: 30 },  // Email
        { wch: 15 },  // Latitude
        { wch: 15 },  // Longitude
        { wch: 18 },  // Código Transportador
        { wch: 40 },  // Nome Transportador
        { wch: 18 },  // CPF/CNPJ Transportador
        { wch: 15 },  // Celular Transportador
        { wch: 30 },  // Email Transportador
        { wch: 20 },  // Data Manutenção
        { wch: 15 },  // Usuário
        { wch: 15 }   // Servidor Origem
      ];
      worksheet['!cols'] = colWidths;

      // Gerar buffer do Excel
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Configurar headers para download
      const filename = `cadastros-gerais-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      res.send(excelBuffer);
    } catch (err) {
      console.error('Erro ao exportar cadastros para Excel:', err);
      res.status(500).json({ error: 'Erro ao exportar dados para Excel.' });
    }
  },

  // Aplicar correção da stored procedure SP_INTGRACAO_VALIDADE
  aplicarCorrecaoSPValidade: async (req, res) => {
    try {
      const pool = await poolPromise;
      const scriptPath = path.join(__dirname, '../scripts/corrigir_sp_integracao_validade.sql');
      
      // Ler o arquivo SQL
      let sqlContent;
      try {
        sqlContent = fs.readFileSync(scriptPath, 'utf8');
      } catch (err) {
        console.error('Erro ao ler arquivo SQL:', err);
        return res.status(500).json({ 
          error: 'Erro ao ler arquivo de correção.',
          detalhes: err.message 
        });
      }

      // Dividir por GO se houver múltiplos comandos
      const comandos = sqlContent.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
      const resultados = [];

      for (const comando of comandos) {
        const cmdLimpo = comando.trim();
        if (!cmdLimpo) continue;

        try {
          const request = pool.request();
          request.timeout = 120000; // 2 minutos
          const result = await request.query(cmdLimpo);

          if (result.recordset && result.recordset.length > 0) {
            resultados.push({ 
              tipo: 'SELECT', 
              rows: result.recordset, 
              rowCount: result.recordset.length 
            });
          } else {
            resultados.push({ 
              tipo: 'EXEC', 
              message: 'Comando executado com sucesso.', 
              rowsAffected: result.rowsAffected || [0] 
            });
          }
        } catch (cmdErr) {
          let mensagemErro = cmdErr.message;
          if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
            mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
          }
          resultados.push({
            tipo: 'ERRO',
            error: mensagemErro,
            comando: cmdLimpo.substring(0, 200),
            detalhes: { nome: cmdErr.name, codigo: cmdErr.code, numero: cmdErr.number }
          });
        }
      }

      // Verificar se houve erros
      const erros = resultados.filter(r => r.tipo === 'ERRO');
      if (erros.length > 0) {
        return res.status(500).json({ 
          success: false, 
          error: 'Erros ao aplicar correção.',
          resultados: resultados,
          erros: erros
        });
      }

      res.json({ 
        success: true, 
        message: 'Correção aplicada com sucesso!',
        resultados: resultados, 
        totalComandos: comandos.length 
      });
    } catch (err) {
      console.error('Erro ao aplicar correção SP_INTGRACAO_VALIDADE:', err);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: 'Erro ao aplicar correção da stored procedure.',
          detalhes: err.message 
        });
      }
    }
  },

  // Listar locais preferidos do cadastro (lista registro a registro)
  listarLocaisPreferidos: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const cdCadastro = parseFloat(id);
      if (isNaN(cdCadastro)) return res.status(400).json({ error: 'Cadastro inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, cdCadastro, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const result = await pool.query(
        `SELECT lp."CDCADASTRO", lp."SEQUENCIA", lp."TIPO", lp."PAIS", lp."CDUF", lp."CDMESOREGIAO",
                e."ESTADO" AS "ESTADO_UF",
                m."DSMESOREGIAO"
         FROM "CADASTRO_LOCAL_PREFERIDO" lp
         LEFT JOIN "ESTADO" e ON e."CDUF" = lp."CDUF"
         LEFT JOIN "MESOREGIAO" m ON m."CDUF" = lp."CDUF" AND m."CDMESOREGIAO" = lp."CDMESOREGIAO"
         WHERE lp."CDCADASTRO" = $1
         ORDER BY lp."TIPO", lp."SEQUENCIA"`,
        [cdCadastro]
      );
      const rows = (result.rows || []).map(r => ({
        CDCADASTRO: r.CDCADASTRO,
        SEQUENCIA: r.SEQUENCIA,
        TIPO: r.TIPO,
        PAIS: r.PAIS,
        CDUF: r.CDUF,
        CDMESOREGIAO: r.CDMESOREGIAO,
        ESTADO_UF: r.ESTADO_UF || null,
        DSMESOREGIAO: r.DSMESOREGIAO || null
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') return res.status(200).json([]);
      console.error('Erro ao listar locais preferidos:', err);
      res.status(500).json({ error: 'Erro ao carregar locais preferidos.' });
    }
  },

  // Adicionar um local preferido (grava no banco e retorna a lista atualizada)
  adicionarLocalPreferido: async (req, res) => {
    try {
      const { id } = req.params;
      const { TIPO, PAIS, CDUF, CDMESOREGIAO } = req.body;
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const cdCadastro = parseFloat(id);
      if (isNaN(cdCadastro)) return res.status(400).json({ error: 'Cadastro inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, cdCadastro, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      if (!PAIS || !String(PAIS).trim()) return res.status(400).json({ error: 'País é obrigatório.' });
      const tipoVal = (TIPO && String(TIPO).toUpperCase().trim()) === 'D' ? 'D' : 'E';
      const paisVal = String(PAIS).trim().toUpperCase().substring(0, 2);
      const cdufVal = (CDUF !== undefined && CDUF !== null && CDUF !== '') ? parseInt(CDUF, 10) : null;
      const cdmVal = (CDMESOREGIAO !== undefined && CDMESOREGIAO !== null && CDMESOREGIAO !== '') ? parseInt(CDMESOREGIAO, 10) : null;
      if (cdufVal !== null && isNaN(cdufVal)) return res.status(400).json({ error: 'CDUF inválido.' });
      if (cdmVal !== null && isNaN(cdmVal)) return res.status(400).json({ error: 'CDMESOREGIAO inválido.' });

      // Não permitir duplicata: mesmo Tipo + País + Estado + Mesorregião para o mesmo cadastro
      const existente = await pool.query(
        `SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO"
         WHERE "CDCADASTRO" = $1 AND "TIPO" = $2 AND "PAIS" = $3
           AND (COALESCE("CDUF", -1) = COALESCE($4::int, -1))
           AND (COALESCE("CDMESOREGIAO", -1) = COALESCE($5::int, -1))
         LIMIT 1`,
        [cdCadastro, tipoVal, paisVal, cdufVal, cdmVal]
      );
      if (existente.rows && existente.rows.length > 0) {
        return res.status(400).json({ error: 'Já existe um local preferido com o mesmo Tipo, País, Estado e Mesorregião.' });
      }

      const nextSeq = await pool.query(
        `SELECT COALESCE(MAX("SEQUENCIA"), 0) + 1 AS "next" FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1`,
        [cdCadastro]
      );
      const sequencia = (nextSeq.rows && nextSeq.rows[0]) ? nextSeq.rows[0].next : 1;
      const sgUser = getSgUser(req) || 'SYSTEM';
      await pool.query(
        `INSERT INTO "CADASTRO_LOCAL_PREFERIDO" ("CDCADASTRO", "SEQUENCIA", "TIPO", "PAIS", "CDUF", "CDMESOREGIAO", "SGUSER")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cdCadastro, sequencia, tipoVal, paisVal, cdufVal, cdmVal, sgUser]
      );
      const list = await pool.query(
        `SELECT lp."CDCADASTRO", lp."SEQUENCIA", lp."TIPO", lp."PAIS", lp."CDUF", lp."CDMESOREGIAO",
                e."ESTADO" AS "ESTADO_UF", m."DSMESOREGIAO"
         FROM "CADASTRO_LOCAL_PREFERIDO" lp
         LEFT JOIN "ESTADO" e ON e."CDUF" = lp."CDUF"
         LEFT JOIN "MESOREGIAO" m ON m."CDUF" = lp."CDUF" AND m."CDMESOREGIAO" = lp."CDMESOREGIAO"
         WHERE lp."CDCADASTRO" = $1 ORDER BY lp."TIPO", lp."SEQUENCIA"`,
        [cdCadastro]
      );
      res.status(201).json({
        success: true,
        message: 'Local preferido adicionado.',
        lista: (list.rows || []).map(r => ({
          CDCADASTRO: r.CDCADASTRO,
          SEQUENCIA: r.SEQUENCIA,
          TIPO: r.TIPO,
          PAIS: r.PAIS,
          CDUF: r.CDUF,
          CDMESOREGIAO: r.CDMESOREGIAO,
          ESTADO_UF: r.ESTADO_UF || null,
          DSMESOREGIAO: r.DSMESOREGIAO || null
        }))
      });
    } catch (err) {
      if (err.code === '42P01') return res.status(400).json({ error: 'Tabela CADASTRO_LOCAL_PREFERIDO não existe. Execute o script SQL de criação.' });
      console.error('Erro ao adicionar local preferido:', err);
      res.status(500).json({ error: 'Erro ao gravar local preferido.' });
    }
  },

  // Excluir um local preferido por sequência
  excluirLocalPreferido: async (req, res) => {
    try {
      const { id, sequencia } = req.params;
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const cdCadastro = parseFloat(id);
      const seqNum = parseInt(sequencia, 10);
      if (isNaN(cdCadastro) || isNaN(seqNum)) return res.status(400).json({ error: 'Parâmetros inválidos.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, cdCadastro, tid))) {
        return res.status(404).json({ error: 'Registro não encontrado.' });
      }
      const del = await pool.query(
        `DELETE FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1 AND "SEQUENCIA" = $2`,
        [cdCadastro, seqNum]
      );
      if ((del.rowCount || 0) === 0) return res.status(404).json({ error: 'Registro não encontrado.' });
      res.json({ success: true, message: 'Local preferido removido.' });
    } catch (err) {
      console.error('Erro ao excluir local preferido:', err);
      res.status(500).json({ error: 'Erro ao remover local preferido.' });
    }
  },

  /** Lista pontos de entrega vinculados ao cadastro matriz (CD_CLIENTE = CDCADASTRO). */
  listarEnderecosEntrega: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const idNum = parseFloat(req.params.id);
      if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'Código inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const r = await pool.query(
        `SELECT e."CD_ENDERECO_ENTREGA", e."CD_CLIENTE", e."DS_PONTO_ENTREGA", e."UF_ENTREGA", e."NM_MUNICIPIO",
                e."CEP", e."LOGRADOURO", e."NUMERO", e."COMPLEMENTO", e."LATITUDE", e."LONGITUDE", e."NR_ROTA", e."CDCIDADE",
                e."ST_COMPLETUDE",
                c."NMCIDADE" AS "CIDADE_RESOLVIDA"
           FROM "CADASTRO_ENDERECO_ENTREGA" e
           LEFT JOIN "CIDADE" c ON c."CDCIDADE" = e."CDCIDADE"
          WHERE e."TENANT_ID" = $1 AND e."CD_CLIENTE" = $2::integer AND e."FGACTIVE" = 'A'
       ORDER BY e."NR_ROTA" NULLS LAST, e."DS_PONTO_ENTREGA", e."CD_ENDERECO_ENTREGA"`,
        [tid, idNum]
      );
      res.json(r.rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({
          error:
            'Tabela CADASTRO_ENDERECO_ENTREGA ausente. Execute backend/scripts/adicionar_tabela_cadastro_endereco_entrega_postgres.sql.',
        });
      }
      console.error('[CadastroGeral] listarEnderecosEntrega:', err);
      res.status(500).json({ error: 'Erro ao listar endereços de entrega.' });
    }
  },

  /** Inclui ponto de entrega (só PJ; CD_CLIENTE = CDCADASTRO do cadastro atual). */
  criarEnderecoEntrega: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      const idNum = parseFloat(req.params.id);
      if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'Código inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const pa = await pool.query(
        `SELECT "CGCCPF","FGFISICAJURIDICA" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1::integer AND "TENANT_ID" = $2`,
        [idNum, tid]
      );
      const rowP = pa.rows[0];
      if (!rowP || String(rowP.FGFISICAJURIDICA || '').toUpperCase() !== 'J') {
        return res.status(400).json({ error: 'Endereços de entrega só para cadastro Pessoa Jurídica.' });
      }
      const cnpj14 = String(rowP.CGCCPF || '')
        .replace(/\D/g, '')
        .padStart(14, '0');
      const dsPonto = String(req.body.DS_PONTO_ENTREGA ?? req.body.ds_ponto_entrega ?? '').trim().slice(0, 200);
      const uf = String(req.body.UF_ENTREGA ?? req.body.uf_entrega ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const nmMun = String(req.body.NM_MUNICIPIO ?? req.body.nm_municipio ?? '').trim().slice(0, 120);
      const cep = String(req.body.CEP ?? req.body.cep ?? '')
        .replace(/\D/g, '')
        .slice(0, 16);
      const logr = String(req.body.LOGRADOURO ?? req.body.logradouro ?? '').trim().slice(0, 200);
      let numero = String(req.body.NUMERO ?? req.body.numero ?? '').trim().slice(0, 30);
      if (numero === '.' || numero === '-' || numero === '') numero = 'S/N';
      const compl = String(req.body.COMPLEMENTO ?? req.body.complemento ?? '').trim().slice(0, 120) || null;
      const coord = String(req.body.COORDENADAS ?? req.body.coordenadas ?? '').trim();
      const geo = parseLatLon(coord);
      if (geo.erro) return res.status(400).json({ error: geo.erro });
      const nrRotaRaw = req.body.NR_ROTA ?? req.body.nr_rota;
      const nrRota =
        nrRotaRaw === '' || nrRotaRaw == null ? null : parseInt(String(nrRotaRaw).replace(/\D/g, ''), 10);
      const nrRotaVal = Number.isFinite(nrRota) ? nrRota : null;
      if (!dsPonto) return res.status(400).json({ error: 'Informe o nome do ponto de entrega.' });
      if (!logr) return res.status(400).json({ error: 'Informe o logradouro.' });
      const cidade = uf && nmMun ? await resolveCidadeEndereco(pool, uf, nmMun) : null;
      const cdCidade = cidade ? cidade.CDCIDADE : null;
      const chave = buildChaveImport(tid, cnpj14, dsPonto, logr, numero, cep);
      const dup = await pool.query(
        `SELECT "CD_ENDERECO_ENTREGA" FROM "CADASTRO_ENDERECO_ENTREGA"
          WHERE "TENANT_ID" = $1 AND "CHAVE_IMPORT" = $2 LIMIT 1`,
        [tid, chave]
      );
      if (dup.rows && dup.rows.length > 0) {
        return res.status(409).json({
          error:
            'Já existe um ponto com a mesma combinação (nome + logradouro + número + CEP). Edite o existente ou altere os dados.',
          CD_ENDERECO_ENTREGA: dup.rows[0].CD_ENDERECO_ENTREGA,
        });
      }
      const ins = await pool.query(
        `INSERT INTO "CADASTRO_ENDERECO_ENTREGA" (
          "TENANT_ID","CD_CLIENTE","CHAVE_IMPORT","DS_PONTO_ENTREGA","UF_ENTREGA","NM_MUNICIPIO","CEP",
          "LOGRADOURO","NUMERO","COMPLEMENTO","LATITUDE","LONGITUDE","NR_ROTA","CDCIDADE","FGACTIVE","SGUSER","ST_COMPLETUDE"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'A',$15,$16)
        RETURNING *`,
        [
          tid,
          idNum,
          chave,
          dsPonto,
          uf || null,
          nmMun || null,
          cep || null,
          logr,
          numero,
          compl,
          geo.lat,
          geo.lon,
          nrRotaVal,
          cdCidade,
          sg,
          avaliarStCompletudeEndereco(nrRotaVal, geo.lat, geo.lon),
        ]
      );
      res.status(201).json(ins.rows[0]);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({
          error:
            'Tabela CADASTRO_ENDERECO_ENTREGA ausente. Execute backend/scripts/adicionar_tabela_cadastro_endereco_entrega_postgres.sql.',
        });
      }
      console.error('[CadastroGeral] criarEnderecoEntrega:', err);
      res.status(500).json({ error: 'Erro ao criar endereço de entrega.' });
    }
  },

  /** Atualiza ponto de entrega existente. */
  atualizarEnderecoEntrega: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      const idNum = parseFloat(req.params.id);
      const cdEnd = parseInt(req.params.cdEndereco, 10);
      if (!Number.isFinite(idNum) || !Number.isFinite(cdEnd)) return res.status(400).json({ error: 'Código inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const pa = await pool.query(
        `SELECT "CGCCPF","FGFISICAJURIDICA" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1::integer AND "TENANT_ID" = $2`,
        [idNum, tid]
      );
      const rowP = pa.rows[0];
      if (!rowP || String(rowP.FGFISICAJURIDICA || '').toUpperCase() !== 'J') {
        return res.status(400).json({ error: 'Endereços de entrega só para cadastro Pessoa Jurídica.' });
      }
      const cnpj14 = String(rowP.CGCCPF || '')
        .replace(/\D/g, '')
        .padStart(14, '0');
      const ex = await pool.query(
        `SELECT 1 FROM "CADASTRO_ENDERECO_ENTREGA"
          WHERE "TENANT_ID" = $1 AND "CD_ENDERECO_ENTREGA" = $2::integer AND "CD_CLIENTE" = $3::integer AND "FGACTIVE" = 'A'`,
        [tid, cdEnd, idNum]
      );
      if (!ex.rowCount) return res.status(404).json({ error: 'Endereço de entrega não encontrado.' });
      const dsPonto = String(req.body.DS_PONTO_ENTREGA ?? req.body.ds_ponto_entrega ?? '').trim().slice(0, 200);
      const uf = String(req.body.UF_ENTREGA ?? req.body.uf_entrega ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const nmMun = String(req.body.NM_MUNICIPIO ?? req.body.nm_municipio ?? '').trim().slice(0, 120);
      const cep = String(req.body.CEP ?? req.body.cep ?? '')
        .replace(/\D/g, '')
        .slice(0, 16);
      const logr = String(req.body.LOGRADOURO ?? req.body.logradouro ?? '').trim().slice(0, 200);
      let numero = String(req.body.NUMERO ?? req.body.numero ?? '').trim().slice(0, 30);
      if (numero === '.' || numero === '-' || numero === '') numero = 'S/N';
      const compl = String(req.body.COMPLEMENTO ?? req.body.complemento ?? '').trim().slice(0, 120) || null;
      const coord = String(req.body.COORDENADAS ?? req.body.coordenadas ?? '').trim();
      const geo = parseLatLon(coord);
      if (geo.erro) return res.status(400).json({ error: geo.erro });
      const nrRotaRaw = req.body.NR_ROTA ?? req.body.nr_rota;
      const nrRota =
        nrRotaRaw === '' || nrRotaRaw == null ? null : parseInt(String(nrRotaRaw).replace(/\D/g, ''), 10);
      const nrRotaVal = Number.isFinite(nrRota) ? nrRota : null;
      if (!dsPonto) return res.status(400).json({ error: 'Informe o nome do ponto de entrega.' });
      if (!logr) return res.status(400).json({ error: 'Informe o logradouro.' });
      const cidade = uf && nmMun ? await resolveCidadeEndereco(pool, uf, nmMun) : null;
      const cdCidade = cidade ? cidade.CDCIDADE : null;
      const novaChave = buildChaveImport(tid, cnpj14, dsPonto, logr, numero, cep);
      const dup = await pool.query(
        `SELECT "CD_ENDERECO_ENTREGA" FROM "CADASTRO_ENDERECO_ENTREGA"
          WHERE "TENANT_ID" = $1 AND "CHAVE_IMPORT" = $2 AND "CD_ENDERECO_ENTREGA" <> $3::integer LIMIT 1`,
        [tid, novaChave, cdEnd]
      );
      if (dup.rows && dup.rows.length > 0) {
        return res.status(409).json({
          error: 'Outro registro já usa esta combinação (nome + logradouro + número + CEP). Ajuste para não duplicar a chave.',
        });
      }
      const stCompletude = avaliarStCompletudeEndereco(nrRotaVal, geo.lat, geo.lon);
      const upd = await pool.query(
        `UPDATE "CADASTRO_ENDERECO_ENTREGA" SET
          "CHAVE_IMPORT" = $4,
          "DS_PONTO_ENTREGA" = $5,
          "UF_ENTREGA" = $6,
          "NM_MUNICIPIO" = $7,
          "CEP" = $8,
          "LOGRADOURO" = $9,
          "NUMERO" = $10,
          "COMPLEMENTO" = $11,
          "LATITUDE" = $12,
          "LONGITUDE" = $13,
          "NR_ROTA" = $14,
          "CDCIDADE" = $15,
          "ST_COMPLETUDE" = $17,
          "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
          "SGUSER" = $16
        WHERE "TENANT_ID" = $1 AND "CD_ENDERECO_ENTREGA" = $2::integer AND "CD_CLIENTE" = $3::integer
        RETURNING *`,
        [tid, cdEnd, idNum, novaChave, dsPonto, uf || null, nmMun || null, cep || null, logr, numero, compl, geo.lat, geo.lon, nrRotaVal, cdCidade, sg, stCompletude]
      );
      res.json(upd.rows[0]);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({
          error:
            'Tabela CADASTRO_ENDERECO_ENTREGA ausente. Execute backend/scripts/adicionar_tabela_cadastro_endereco_entrega_postgres.sql.',
        });
      }
      console.error('[CadastroGeral] atualizarEnderecoEntrega:', err);
      res.status(500).json({ error: 'Erro ao atualizar endereço de entrega.' });
    }
  },

  /** Inativa ponto de entrega (soft delete). */
  excluirEnderecoEntrega: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      const idNum = parseFloat(req.params.id);
      const cdEnd = parseInt(req.params.cdEndereco, 10);
      if (!Number.isFinite(idNum) || !Number.isFinite(cdEnd)) return res.status(400).json({ error: 'Código inválido.' });
      if (!(await cadastroGeralPertenceAoTenant(pool, idNum, tid))) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const r = await pool.query(
        `UPDATE "CADASTRO_ENDERECO_ENTREGA"
            SET "FGACTIVE" = 'I', "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $4
          WHERE "TENANT_ID" = $1 AND "CD_ENDERECO_ENTREGA" = $2::integer AND "CD_CLIENTE" = $3::integer AND "FGACTIVE" = 'A'
        RETURNING "CD_ENDERECO_ENTREGA"`,
        [tid, cdEnd, idNum, sg]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Endereço de entrega não encontrado ou já inativo.' });
      res.json({ success: true, message: 'Endereço de entrega inativado.' });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({
          error:
            'Tabela CADASTRO_ENDERECO_ENTREGA ausente. Execute backend/scripts/adicionar_tabela_cadastro_endereco_entrega_postgres.sql.',
        });
      }
      console.error('[CadastroGeral] excluirEnderecoEntrega:', err);
      res.status(500).json({ error: 'Erro ao inativar endereço de entrega.' });
    }
  },

  /**
   * Importação em massa (Excel modelo Mana: Planilha1).
   * multipart campo `file`; query preview=1 só valida e retorna prévia.
   */
  importEnderecosEntrega: async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Envie o arquivo Excel no campo file.' });
      }
      const preview = req.query.preview === '1' || req.query.preview === 'true';
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });

      const parsed = parseEnderecosEntregaXlsx(req.file.buffer);
      if (parsed.erro) return res.status(400).json({ error: parsed.erro });

      const linhas = [];

      for (let i = 0; i < parsed.linhas.length; i++) {
        const L = parsed.linhas[i];
        const cnpj14 = L.cnpj.length === 14 ? L.cnpj : L.cnpj.padStart(14, '0');
        const cliente = await resolveClientePorCnpj(pool, tid, cnpj14);
        const cidade = await resolveCidadeEndereco(pool, L.uf, L.municipio);
        const chave = buildChaveImport(tid, cnpj14, L.dsPonto, L.logradouro, L.numero, L.cep);
        const avisos = [];
        if (!cidade) {
          avisos.push(`Cidade não encontrada na base CIDADE: ${L.uf} / ${L.municipio} (gravação sem CDCIDADE).`);
        }
        if (L.ufErro) avisos.push(L.ufErro);
        if (L.geoErro) avisos.push(L.geoErro);
        let status = 'ok';
        if (!cliente) {
          status = 'sem_cliente';
          avisos.push('Cadastro matriz (CNPJ jurídico ativo) não encontrado para este tenant.');
        } else if (L.ufErro) {
          status = 'uf_invalida';
        } else if (L.geoErro) {
          status = 'coord_invalida';
        }
        const podeGravar = Boolean(cliente) && !L.ufErro && !L.geoErro;
        const rowOut = {
          linhaPlanilha: L.linhaPlanilha,
          cnpj: cnpj14,
          cdCliente: cliente ? cliente.CDCADASTRO : null,
          razaoCliente: cliente ? cliente.RZSOCIAL : null,
          dsPonto: L.dsPonto,
          uf: L.uf,
          municipioPlanilha: L.municipio,
          cdCidade: cidade ? cidade.CDCIDADE : null,
          cidadeResolvida: cidade ? cidade.NMCIDADE : null,
          cep: L.cep,
          logradouro: L.logradouro,
          numero: L.numero,
          latitude: L.latitude,
          longitude: L.longitude,
          nrRota: L.nrRota,
          chaveImport: chave,
          status,
          podeGravar,
          avisos,
        };
        linhas.push(rowOut);
      }

      const semCliente = linhas.filter((x) => x.status === 'sem_cliente').length;
      const ufInvalida = linhas.filter((x) => x.status === 'uf_invalida').length;
      const coordInvalida = linhas.filter((x) => x.status === 'coord_invalida').length;
      const cidadeNaoResolvida = linhas.filter((x) => !x.cdCidade).length;
      const prontasGravar = linhas.filter((x) => x.podeGravar).length;

      if (preview) {
        return res.json({
          preview: true,
          resumo: {
            totalLinhas: linhas.length,
            prontasGravar,
            semCliente,
            ufInvalida,
            cidadeNaoResolvida,
            coordInvalida,
          },
          linhas,
        });
      }

      let gravadas = 0;

      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        for (let j = 0; j < linhas.length; j++) {
          const R = linhas[j];
          if (!R.podeGravar) continue;
          await dbClient.query(
            `INSERT INTO "CADASTRO_ENDERECO_ENTREGA" (
              "TENANT_ID","CD_CLIENTE","CHAVE_IMPORT","DS_PONTO_ENTREGA","UF_ENTREGA","NM_MUNICIPIO","CEP",
              "LOGRADOURO","NUMERO","COMPLEMENTO","LATITUDE","LONGITUDE","NR_ROTA","CDCIDADE","FGACTIVE","SGUSER"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'A',$15)
            ON CONFLICT ("TENANT_ID", "CHAVE_IMPORT") DO UPDATE SET
              "DS_PONTO_ENTREGA" = EXCLUDED."DS_PONTO_ENTREGA",
              "UF_ENTREGA" = EXCLUDED."UF_ENTREGA",
              "NM_MUNICIPIO" = EXCLUDED."NM_MUNICIPIO",
              "CEP" = EXCLUDED."CEP",
              "LOGRADOURO" = EXCLUDED."LOGRADOURO",
              "NUMERO" = EXCLUDED."NUMERO",
              "LATITUDE" = EXCLUDED."LATITUDE",
              "LONGITUDE" = EXCLUDED."LONGITUDE",
              "NR_ROTA" = EXCLUDED."NR_ROTA",
              "CDCIDADE" = EXCLUDED."CDCIDADE",
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SGUSER" = EXCLUDED."SGUSER"
            RETURNING "CD_ENDERECO_ENTREGA"`,
            [
              tid,
              R.cdCliente,
              R.chaveImport,
              R.dsPonto.substring(0, 200),
              R.uf || null,
              R.municipioPlanilha ? R.municipioPlanilha.substring(0, 120) : null,
              R.cep || null,
              R.logradouro ? R.logradouro.substring(0, 200) : null,
              R.numero ? String(R.numero).substring(0, 30) : null,
              null,
              R.latitude,
              R.longitude,
              R.nrRota,
              R.cdCidade,
              sg,
            ]
          );
          gravadas++;
        }
        await dbClient.query('COMMIT');
      } catch (e) {
        try {
          await dbClient.query('ROLLBACK');
        } catch (_) {}
        if (e.code === '42P01') {
          return res.status(503).json({
            error:
              'Tabela CADASTRO_ENDERECO_ENTREGA ausente. Execute backend/scripts/adicionar_tabela_cadastro_endereco_entrega_postgres.sql.',
          });
        }
        console.error('[CadastroGeral] importEnderecosEntrega:', e);
        return res.status(500).json({ error: 'Erro ao gravar importação.' });
      } finally {
        dbClient.release();
      }

      res.json({
        preview: false,
        resumo: {
          totalLinhas: linhas.length,
          gravadas,
          ignoradas: linhas.length - gravadas,
          semCliente,
          ufInvalida,
          coordInvalida,
          cidadeNaoResolvida,
        },
        linhasResumo: linhas.filter((x) => !x.podeGravar).slice(0, 80),
      });
    } catch (err) {
      console.error('[CadastroGeral] importEnderecosEntrega:', err);
      res.status(500).json({ error: 'Erro ao processar importação.' });
    }
  },

  /** Contagem de veículos de motoristas pendentes de aprovação (app). */
  contadorMotoristaVeiculosPendentes: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM "MOTORISTA_VEICULO" mv
         WHERE mv."TENANT_ID" = $1
           AND COALESCE(mv."STATUSAPROVACAO", 'P') = 'P'
           AND COALESCE(mv."FGACTIVE", 'S') = 'S'`,
        [tid]
      );
      const n = (r.rows && r.rows[0] && r.rows[0].n != null) ? Number(r.rows[0].n) : 0;
      res.json({ count: n });
    } catch (err) {
      if (err.code === '42703') {
        return res.json({ count: 0 });
      }
      console.error('[CadastroGeral] contador veículos motorista:', err);
      res.status(500).json({ error: 'Erro ao contar veículos pendentes.' });
    }
  },

  /** Lista veículos informados pelo app aguardando aprovação (torre). */
  listarMotoristaVeiculosPendentes: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const qPlain = `
        SELECT mv.*, cg."RZSOCIAL" AS "motorista_nome", cg."CGCCPF" AS "motorista_doc"
         FROM "MOTORISTA_VEICULO" mv
         INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
         WHERE mv."TENANT_ID" = $1
           AND COALESCE(mv."STATUSAPROVACAO", 'P') = 'P'
           AND COALESCE(mv."FGACTIVE", 'S') = 'S'
         ORDER BY mv."DHCADASTRO" DESC NULLS LAST, mv."IDVEICULOMOTORISTA" DESC
         LIMIT 500`;
      const qRich = `
        SELECT mv.*, cg."RZSOCIAL" AS "motorista_nome", cg."CGCCPF" AS "motorista_doc",
               cf."DSCLASSEFROTA" AS "ds_classe_frota"
         FROM "MOTORISTA_VEICULO" mv
         INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
         LEFT JOIN "CLASSEFROTA" cf ON cf."CDCLASSEFROTA" = mv."CDCLASSEFROTA"
           AND (cf."TENANT_ID" = $1 OR cf."TENANT_ID" = 'default' OR cf."TENANT_ID" IS NULL)
         WHERE mv."TENANT_ID" = $1
           AND COALESCE(mv."STATUSAPROVACAO", 'P') = 'P'
           AND COALESCE(mv."FGACTIVE", 'S') = 'S'
         ORDER BY mv."DHCADASTRO" DESC NULLS LAST, mv."IDVEICULOMOTORISTA" DESC
         LIMIT 500`;
      let r;
      try {
        r = await pool.query(qRich, [tid]);
      } catch (e) {
        if (e.code === '42703') r = await pool.query(qPlain, [tid]);
        else throw e;
      }
      res.json(r.rows || []);
    } catch (err) {
      if (err.code === '42703') {
        return res.json([]);
      }
      console.error('[CadastroGeral] listar veículos pendentes:', err);
      res.status(500).json({ error: 'Erro ao listar veículos pendentes.' });
    }
  },

  /** Lista veículos do app vinculados a um cadastro (torre): pendentes, aprovados e rejeitados ativos. */
  listarMotoristaVeiculosDoCadastro: async (req, res) => {
    try {
      const idNumerico = parseFloat(String(req.params.id || ''));
      if (!Number.isFinite(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'Identificador do cadastro inválido.' });
      }
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const tenantDefault = getDefaultTenantId();
      const params = [idNumerico, tid, tenantDefault];
      const whereCadastroAcesso = `
        WHERE cg."CDCADASTRO" = $1::numeric
          AND (
            cg."TENANT_ID" = $2
            OR cg."TENANT_ID" = $3
            OR EXISTS (
              SELECT 1 FROM "USUARIO" u
              WHERE u."CDCADASTRO" = $1::numeric
                AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $3) = $2
            )
          )`;
      const acc = await pool.query(
        `SELECT cg."CDCADASTRO" FROM "CADASTROGERAL" cg ${whereCadastroAcesso} LIMIT 1`,
        params
      );
      if (!acc.rows || acc.rows.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      const qPlain = `
        SELECT mv.*
        FROM "MOTORISTA_VEICULO" mv
        INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
        WHERE mv."CDCADASTRO" = $1::numeric
          AND COALESCE(mv."FGACTIVE", 'S') = 'S'
          AND (
            mv."TENANT_ID" = $2
            OR mv."TENANT_ID" = $3
            OR (mv."TENANT_ID" IS NULL AND (cg."TENANT_ID" = $2 OR cg."TENANT_ID" = $3))
          )
        ORDER BY mv."IDVEICULOMOTORISTA" DESC NULLS LAST
        LIMIT 200`;
      const qRich = `
        SELECT mv.*, cf."DSCLASSEFROTA" AS "ds_classe_frota"
        FROM "MOTORISTA_VEICULO" mv
        INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
        LEFT JOIN "CLASSEFROTA" cf ON cf."CDCLASSEFROTA" = mv."CDCLASSEFROTA"
          AND (cf."TENANT_ID" = $2 OR cf."TENANT_ID" = 'default' OR cf."TENANT_ID" IS NULL)
        WHERE mv."CDCADASTRO" = $1::numeric
          AND COALESCE(mv."FGACTIVE", 'S') = 'S'
          AND (
            mv."TENANT_ID" = $2
            OR mv."TENANT_ID" = $3
            OR (mv."TENANT_ID" IS NULL AND (cg."TENANT_ID" = $2 OR cg."TENANT_ID" = $3))
          )
        ORDER BY mv."IDVEICULOMOTORISTA" DESC NULLS LAST
        LIMIT 200`;
      let r;
      try {
        r = await pool.query(qRich, params);
      } catch (e) {
        if (e.code === '42703') r = await pool.query(qPlain, params);
        else throw e;
      }
      res.json(r.rows || []);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Tabela MOTORISTA_VEICULO indisponível.' });
      }
      console.error('[CadastroGeral] listar veículos do cadastro:', err);
      res.status(500).json({ error: 'Erro ao listar veículos do cadastro.' });
    }
  },

  aprovarMotoristaVeiculo: async (req, res) => {
    const pool = await poolPromise;
    let client;
    try {
      const idVeiculo = parseInt(String(req.params.idVeiculo || ''), 10);
      if (!Number.isFinite(idVeiculo) || idVeiculo <= 0) {
        return res.status(400).json({ success: false, error: 'Identificador do veículo inválido.' });
      }
      const tid = tenantIdForRequest(req);
      const body = req.body || {};
      let bodyCdeq = body.cdequipamento ?? body.CDEQUIPAMENTO;
      if (bodyCdeq === '' || bodyCdeq == null) bodyCdeq = null;
      else {
        const n = parseFloat(String(bodyCdeq));
        bodyCdeq = Number.isFinite(n) ? n : null;
      }
      const sg = (req.user && (req.user.login || req.user.nome)) ? String(req.user.login || req.user.nome).slice(0, 50) : 'TORRE';

      client = await pool.connect();
      await client.query('BEGIN');

      const sel = await client.query(
        `SELECT mv.*, cg."RZSOCIAL" AS "_cg_rz", cg."FGRASTREADO" AS "_cg_fgr"
         FROM "MOTORISTA_VEICULO" mv
         INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
         WHERE mv."IDVEICULOMOTORISTA" = $1::int
           AND mv."TENANT_ID" = $2
           AND COALESCE(mv."STATUSAPROVACAO", 'P') = 'P'
         FOR UPDATE OF mv`,
        [idVeiculo, tid]
      );
      if (!sel.rows || !sel.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Registro não encontrado ou já tratado.' });
      }
      const rowMv = sel.rows[0];
      let equipResult;
      try {
        equipResult = await ensureIdequipamentoParaAprovacaoMotoristaVeiculo(client, {
          tid,
          mv: rowMv,
          motoristaRz: rowMv._cg_rz,
          motoristaFgrastreado: rowMv._cg_fgr,
          bodyCdeq: bodyCdeq,
          sg,
        });
      } catch (e) {
        await client.query('ROLLBACK');
        if (e.httpStatus) {
          return res.status(e.httpStatus).json({ success: false, error: e.message, code: e.code });
        }
        throw e;
      }

      const finalIdeq = equipResult.idequipamento;
      await client.query(
        `UPDATE "MOTORISTA_VEICULO" SET
           "STATUSAPROVACAO" = 'A',
           "DHAPROVACAO" = CURRENT_TIMESTAMP,
           "MOTIVOREPROVACAO" = NULL,
           "CDEQUIPAMENTO" = $3::numeric,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP,
           "SGUSER" = $4
         WHERE "IDVEICULOMOTORISTA" = $1::int AND "TENANT_ID" = $2 AND COALESCE("STATUSAPROVACAO", 'P') = 'P'`,
        [idVeiculo, tid, finalIdeq, sg]
      );
      await client.query('COMMIT');
      res.json({
        success: true,
        message: equipResult.equipamentoCriado
          ? 'Veículo aprovado e equipamento cadastrado em Gerenciar Equipamentos.'
          : 'Veículo aprovado e vinculado ao equipamento.',
        cdequipamento: finalIdeq,
        equipamentoCriado: !!equipResult.equipamentoCriado,
      });
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
      }
      if (err.code === '42703') {
        return res.status(503).json({
          success: false,
          error: 'Execute o script adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql no banco.',
        });
      }
      console.error('[CadastroGeral] aprovar veículo motorista:', err);
      res.status(500).json({ success: false, error: 'Erro ao aprovar veículo.' });
    } finally {
      if (client) client.release();
    }
  },

  /**
   * Inativa o vínculo motorista–veículo (MOTORISTA_VEICULO) e remove o código do equipamento na linha.
   * O registro em EQUIPAMENTO permanece em Gerenciar Equipamentos (frota da empresa).
   */
  inativarMotoristaVeiculoVinculo: async (req, res) => {
    try {
      const idVeiculo = parseInt(String(req.params.idVeiculo || ''), 10);
      if (!Number.isFinite(idVeiculo) || idVeiculo <= 0) {
        return res.status(400).json({ success: false, error: 'Identificador do veículo inválido.' });
      }
      const tid = tenantIdForRequest(req);
      const tenantDefault = getDefaultTenantId();
      const sg = (req.user && (req.user.login || req.user.nome)) ? String(req.user.login || req.user.nome).slice(0, 50) : 'TORRE';
      const pool = await poolPromise;
      const r = await pool.query(
        `UPDATE "MOTORISTA_VEICULO" mv SET
           "FGACTIVE" = 'N',
           "CDEQUIPAMENTO" = NULL,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP,
           "SGUSER" = $4
         FROM "CADASTROGERAL" cg
         WHERE mv."CDCADASTRO" = cg."CDCADASTRO"
           AND mv."IDVEICULOMOTORISTA" = $1::int
           AND mv."TENANT_ID" = $2
           AND COALESCE(mv."FGACTIVE", 'S') = 'S'
           AND (
             cg."TENANT_ID" = $2
             OR cg."TENANT_ID" = $3
             OR EXISTS (
               SELECT 1 FROM "USUARIO" u
               WHERE u."CDCADASTRO" = cg."CDCADASTRO"
                 AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $3) = $2
             )
           )`,
        [idVeiculo, tid, tenantDefault, sg]
      );
      if (!r.rowCount) {
        return res.status(404).json({ success: false, error: 'Registro não encontrado, já inativo ou sem permissão.' });
      }
      res.json({
        success: true,
        message:
          'Placa removida da lista deste motorista e do app dele. O equipamento em Gerenciar Equipamentos permanece ativo para reutilização (ex.: outro motorista com a mesma placa).',
      });
    } catch (err) {
      console.error('[CadastroGeral] inativar vínculo veículo motorista:', err);
      res.status(500).json({ success: false, error: 'Erro ao inativar vínculo.' });
    }
  },

  /** Combo de equipamentos ativos do tenant (torre) para atrelar motorista sem passar pelo app. */
  listarEquipamentosFrotaComboTorre: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const r = await pool.query(
        `SELECT e."IDEQUIPAMENTO", e."REFEQUIPAMENTO", e."DSEQUIPAMENTO", e."CDCLASSEFROTA", e."CDTIPOEQUIPAMENTO"
         FROM "EQUIPAMENTO" e
         WHERE e."TENANT_ID" = $1
           AND (e."FGACTIVE" IN ('A', 'S') OR e."FGACTIVE" IS NULL)
         ORDER BY UPPER(TRIM(COALESCE(e."REFEQUIPAMENTO", '')))
         LIMIT 800`,
        [tid]
      );
      res.json(r.rows || []);
    } catch (err) {
      console.error('[CadastroGeral] combo equipamentos frota:', err);
      res.status(500).json({ error: 'Erro ao listar equipamentos.' });
    }
  },

  /**
   * Atrela equipamento da frota (Gerenciar Equipamentos) ao motorista sem fluxo do app.
   * Insere em MOTORISTA_VEICULO já aprovado (STATUSAPROVACAO = A) e com CDEQUIPAMENTO preenchido.
   */
  vincularEquipamentoMotoristaTorre: async (req, res) => {
    try {
      const idNumerico = parseFloat(String(req.params.id || ''));
      if (!Number.isFinite(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ success: false, error: 'Identificador do cadastro inválido.' });
      }
      const tid = tenantIdForRequest(req);
      const tenantDefault = getDefaultTenantId();
      const body = req.body || {};
      let ideq = body.idequipamento ?? body.IDEQUIPAMENTO ?? body.cdequipamento ?? body.CDEQUIPAMENTO;
      if (ideq === '' || ideq == null) {
        return res.status(400).json({ success: false, error: 'Informe o código do equipamento.' });
      }
      ideq = parseFloat(String(ideq));
      if (!Number.isFinite(ideq) || ideq <= 0) {
        return res.status(400).json({ success: false, error: 'Código do equipamento inválido.' });
      }
      const papel = String(body.papel ?? body.PAPEL_CONJUNTO ?? '').trim().slice(0, 20) || null;
      const sg = (req.user && (req.user.login || req.user.nome)) ? String(req.user.login || req.user.nome).slice(0, 50) : 'TORRE';
      const pool = await poolPromise;

      const paramsAcc = [idNumerico, tid, tenantDefault];
      const whereCadastroAcesso = `
        WHERE cg."CDCADASTRO" = $1::numeric
          AND (
            cg."TENANT_ID" = $2
            OR cg."TENANT_ID" = $3
            OR EXISTS (
              SELECT 1 FROM "USUARIO" u
              WHERE u."CDCADASTRO" = $1::numeric AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $3) = $2
            )
          )`;
      const cg = await pool.query(
        `SELECT cg."CDCADASTRO", cg."FGMOTORISTA" FROM "CADASTROGERAL" cg ${whereCadastroAcesso} LIMIT 1`,
        paramsAcc
      );
      if (!cg.rows || !cg.rows.length) {
        return res.status(404).json({ success: false, error: 'Cadastro não encontrado.' });
      }
      const fgm = cg.rows[0].FGMOTORISTA ?? cg.rows[0].fgmotorista;
      const ehMotorista = fgm === true || fgm === 'S' || String(fgm || '').toUpperCase() === 'S';
      if (!ehMotorista) {
        return res.status(400).json({ success: false, error: 'Atrelamento só é permitido para cadastro marcado como motorista.' });
      }

      const eq = await pool.query(
        `SELECT e."IDEQUIPAMENTO", e."REFEQUIPAMENTO", e."CDTIPOEQUIPAMENTO", e."CDCLASSEFROTA", e."FGACTIVE"
         FROM "EQUIPAMENTO" e
         WHERE e."IDEQUIPAMENTO" = $1::numeric AND e."TENANT_ID" = $2
           AND (e."FGACTIVE" IN ('A', 'S') OR e."FGACTIVE" IS NULL)`,
        [ideq, tid]
      );
      if (!eq.rows || !eq.rows.length) {
        return res.status(404).json({ success: false, error: 'Equipamento não encontrado ou inativo neste tenant.' });
      }
      const er = eq.rows[0];
      const refRaw = er.REFEQUIPAMENTO != null ? String(er.REFEQUIPAMENTO) : String(er.refequipamento || '');
      const placaNorm = normalizarPlacaBrasil(refRaw);
      if (!placaNorm) {
        return res.status(400).json({
          success: false,
          error: 'O equipamento não possui placa/referência válida (7 caracteres) para atrelar.',
        });
      }
      let cdTipoIns = er.cdtipoequipamento != null ? er.cdtipoequipamento : er.CDTIPOEQUIPAMENTO;
      if (cdTipoIns != null) {
        const nt = parseInt(String(cdTipoIns), 10);
        cdTipoIns = Number.isFinite(nt) ? nt : null;
      }
      if (!cdTipoIns) {
        cdTipoIns = await buscarPrimeiroTipoEquipamentoTenant(pool, tid);
      }
      if (!cdTipoIns) {
        return res.status(503).json({
          success: false,
          error: 'Cadastre ao menos um tipo de equipamento ativo no tenant antes de atrelar.',
        });
      }
      let cdClasseIns = er.CDCLASSEFROTA ?? er.cdclassefrota;
      if (cdClasseIns != null) {
        const nc = parseInt(String(cdClasseIns), 10);
        cdClasseIns = Number.isFinite(nc) && nc > 0 ? nc : null;
      }

      const dup = await pool.query(
        `SELECT 1 FROM "MOTORISTA_VEICULO" mv
         WHERE mv."CDCADASTRO" = $1::numeric AND mv."TENANT_ID" = $2
           AND mv."PLACA_NORMALIZADA" = $3 AND COALESCE(mv."FGACTIVE", 'S') = 'S'`,
        [idNumerico, tid, placaNorm]
      );
      if (dup.rows && dup.rows.length) {
        return res.status(409).json({
          success: false,
          error:
            'Este motorista já possui vínculo ativo com esta placa. Use Remover deste motorista na linha existente ou escolha outro equipamento.',
        });
      }

      const ins = await pool.query(
        `INSERT INTO "MOTORISTA_VEICULO" (
          "CDCADASTRO", "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDTIPOEQUIPAMENTO", "CDCLASSEFROTA",
          "PAPEL_CONJUNTO", "FOTOCRLV", "TENANT_ID", "STATUSAPROVACAO", "FGACTIVE",
          "SGUSER", "SERVERORIG"
        ) VALUES (
          $1::numeric, $2, $3, NULL, $4, $5,
          $6, NULL, $7, 'A', 'S',
          $8, 'TorreAtrelamento'
        ) RETURNING "IDVEICULOMOTORISTA"`,
        [idNumerico, placaNorm, placaNorm, cdTipoIns, cdClasseIns, papel, tid, sg]
      );
      const idMv = ins.rows[0].IDVEICULOMOTORISTA ?? ins.rows[0].idveiculomotorista;
      try {
        await pool.query(
          `UPDATE "MOTORISTA_VEICULO" SET "CDEQUIPAMENTO" = $2::numeric, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $3
           WHERE "IDVEICULOMOTORISTA" = $1::int`,
          [idMv, ideq, sg]
        );
      } catch (eUp) {
        if (eUp.code !== '42703') throw eUp;
      }

      res.status(201).json({
        success: true,
        message: 'Equipamento atrelado ao motorista (sem pendência de aprovação).',
        idVeiculoMotorista: idMv,
        cdequipamento: ideq,
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Já existe vínculo ativo com esta placa para este motorista ou conflito de unicidade.',
        });
      }
      if (err.code === '42703' || err.code === '23502') {
        return res.status(503).json({
          success: false,
          error: 'Execute os scripts de MOTORISTA_VEICULO no PostgreSQL (colunas de aprovação / CDEQUIPAMENTO).',
        });
      }
      console.error('[CadastroGeral] vincular equipamento motorista torre:', err);
      res.status(500).json({ success: false, error: 'Erro ao atrelar equipamento.' });
    }
  },

  rejeitarMotoristaVeiculo: async (req, res) => {
    try {
      const idVeiculo = parseInt(String(req.params.idVeiculo || ''), 10);
      if (!Number.isFinite(idVeiculo) || idVeiculo <= 0) {
        return res.status(400).json({ success: false, error: 'Identificador do veículo inválido.' });
      }
      const tid = tenantIdForRequest(req);
      const motivo = String((req.body && (req.body.motivo || req.body.MOTIVOREPROVACAO)) || '').trim().slice(0, 500) || null;
      const sg = (req.user && (req.user.login || req.user.nome)) ? String(req.user.login || req.user.nome).slice(0, 50) : 'TORRE';
      const pool = await poolPromise;
      const r = await pool.query(
        `UPDATE "MOTORISTA_VEICULO" SET
           "STATUSAPROVACAO" = 'R',
           "DHAPROVACAO" = CURRENT_TIMESTAMP,
           "MOTIVOREPROVACAO" = $3,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP,
           "SGUSER" = $4
         WHERE "IDVEICULOMOTORISTA" = $1::int AND "TENANT_ID" = $2 AND COALESCE("STATUSAPROVACAO", 'P') = 'P'`,
        [idVeiculo, tid, motivo, sg]
      );
      if (!r.rowCount) {
        return res.status(404).json({ success: false, error: 'Registro não encontrado ou já tratado.' });
      }
      res.json({ success: true, message: 'Veículo rejeitado.' });
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          success: false,
          error: 'Execute o script adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql no banco.',
        });
      }
      console.error('[CadastroGeral] rejeitar veículo motorista:', err);
      res.status(500).json({ success: false, error: 'Erro ao rejeitar veículo.' });
    }
  },

  /** Torre: remove anexo (CNH frente/verso ou comprovante) em MOTORISTA_COMPLEMENTO. */
  excluirAnexoMotoristaCadastroTorre: async (req, res) => {
    try {
      const idNumerico = parseFloat(String(req.params.id || ''));
      if (!Number.isFinite(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }
      const tipo = String(req.params.tipo || '').trim().toLowerCase();
      const col = MAP_ANEXO_MC_TORRE[tipo];
      if (!col) {
        return res.status(400).json({
          error: 'Tipo inválido. Use: cnh-frente, cnh-verso ou comprovante-endereco.',
        });
      }
      const ctx = await assertCadastroMotoristaTorre(req, res, idNumerico);
      if (!ctx) return;
      const { pool, sg } = ctx;
      const sel = await pool.query(
        `SELECT "${col}" FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1::numeric LIMIT 1`,
        [idNumerico]
      );
      if (!sel.rows || !sel.rows.length) {
        return res.status(404).json({ error: 'Não há complemento de motorista para este cadastro.' });
      }
      const key = col.toLowerCase();
      const oldPath = sel.rows[0][key] != null ? String(sel.rows[0][key]).trim() : '';
      const up = await pool.query(
        `UPDATE "MOTORISTA_COMPLEMENTO" SET "${col}" = NULL, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2
         WHERE "CDCADASTRO" = $1::numeric`,
        [idNumerico, sg]
      );
      if ((up.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Complemento não encontrado.' });
      }
      if (oldPath) tryUnlinkPublicUpload(oldPath);
      res.json({ success: true, message: 'Anexo removido.' });
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({ error: 'Coluna de anexo indisponível no banco.' });
      }
      console.error('[CadastroGeral] excluir anexo motorista:', err);
      res.status(500).json({ error: 'Erro ao remover anexo.' });
    }
  },

  /** Torre: envia novo arquivo para CNH frente/verso ou comprovante (multipart campo arquivo + body tipo). */
  uploadAnexoMotoristaCadastroTorre: async (req, res) => {
    try {
      const idNumerico = parseFloat(String(req.params.id || ''));
      if (!Number.isFinite(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }
      const tipo = String((req.body && req.body.tipo) || '').trim().toLowerCase();
      const col = MAP_ANEXO_MC_TORRE[tipo];
      if (!col) {
        return res.status(400).json({
          error: 'Tipo inválido. Use: cnh-frente, cnh-verso ou comprovante-endereco.',
        });
      }
      if (!req.file || !req.file.filename) {
        return res.status(400).json({ error: 'Envie o arquivo no campo arquivo (JPEG, PNG ou WebP, máx. 5 MB).' });
      }
      const ctx = await assertCadastroMotoristaTorre(req, res, idNumerico);
      if (!ctx) return;
      const { pool, tid, sg } = ctx;
      const pubPath = '/uploads/motoristas/' + req.file.filename;
      const sel = await pool.query(
        `SELECT "${col}" FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1::numeric LIMIT 1`,
        [idNumerico]
      );
      const key = col.toLowerCase();
      const oldPath =
        sel.rows && sel.rows[0] && sel.rows[0][key] != null ? String(sel.rows[0][key]).trim() : '';
      const up = await pool.query(
        `UPDATE "MOTORISTA_COMPLEMENTO" SET "${col}" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $3
         WHERE "CDCADASTRO" = $1::numeric`,
        [idNumerico, pubPath, sg]
      );
      if ((up.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "${col}", "TENANT_ID", "STATUSAPROVACAO", "SGUSER", "SERVERORIG")
           VALUES ($1::numeric, $2, $3, 'P', $4, 'TorreWeb')`,
          [idNumerico, pubPath, tid, sg]
        );
      }
      if (oldPath && oldPath !== pubPath) tryUnlinkPublicUpload(oldPath);
      res.json({ success: true, message: 'Anexo atualizado.', path: pubPath });
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({ error: 'Coluna de anexo indisponível no banco.' });
      }
      console.error('[CadastroGeral] upload anexo motorista:', err);
      res.status(500).json({ error: 'Erro ao enviar anexo.' });
    }
  },

  /** Torre: remove CRLV ou foto do veículo em MOTORISTA_VEICULO. */
  excluirAnexoMotoristaVeiculoTorre: async (req, res) => {
    try {
      const idVeiculo = parseInt(String(req.params.idVeiculo || ''), 10);
      if (!Number.isFinite(idVeiculo) || idVeiculo <= 0) {
        return res.status(400).json({ error: 'Identificador do veículo inválido.' });
      }
      const tipo = String(req.params.tipo || '').trim().toLowerCase();
      const col = MAP_ANEXO_MV_TORRE[tipo];
      if (!col) {
        return res.status(400).json({ error: 'Tipo inválido. Use: crlv ou foto-veiculo.' });
      }
      const ctx = await assertMotoristaVeiculoTorre(req, res, idVeiculo);
      if (!ctx) return;
      const { pool, sg, row } = ctx;
      const key = col.toLowerCase();
      const oldPath = row[key] != null ? String(row[key]).trim() : '';
      let up;
      try {
        up = await pool.query(
          `UPDATE "MOTORISTA_VEICULO" SET "${col}" = NULL, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2
           WHERE "IDVEICULOMOTORISTA" = $1::int`,
          [idVeiculo, sg]
        );
      } catch (e) {
        if (e.code === '42703' && col === 'FOTOVEICULO') {
          return res.status(503).json({ error: 'Coluna foto do veículo indisponível no banco.' });
        }
        throw e;
      }
      if ((up.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Registro não atualizado.' });
      }
      if (oldPath) tryUnlinkPublicUpload(oldPath);
      res.json({ success: true, message: 'Anexo removido.' });
    } catch (err) {
      console.error('[CadastroGeral] excluir anexo veículo motorista:', err);
      res.status(500).json({ error: 'Erro ao remover anexo.' });
    }
  },

  /** Torre: envia novo CRLV ou foto do veículo (multipart arquivo + body tipo=crlv|foto-veiculo). */
  uploadAnexoMotoristaVeiculoTorre: async (req, res) => {
    try {
      const idVeiculo = parseInt(String(req.params.idVeiculo || ''), 10);
      if (!Number.isFinite(idVeiculo) || idVeiculo <= 0) {
        return res.status(400).json({ error: 'Identificador do veículo inválido.' });
      }
      const tipo = String((req.body && req.body.tipo) || '').trim().toLowerCase();
      const col = MAP_ANEXO_MV_TORRE[tipo];
      if (!col) {
        return res.status(400).json({ error: 'Tipo inválido. Use: crlv ou foto-veiculo.' });
      }
      if (!req.file || !req.file.filename) {
        return res.status(400).json({ error: 'Envie o arquivo no campo arquivo (JPEG, PNG ou WebP, máx. 5 MB).' });
      }
      const ctx = await assertMotoristaVeiculoTorre(req, res, idVeiculo);
      if (!ctx) return;
      const { pool, sg, row } = ctx;
      const pubPath = '/uploads/veiculos/' + req.file.filename;
      const key = col.toLowerCase();
      const oldPath = row[key] != null ? String(row[key]).trim() : '';
      let up;
      try {
        up = await pool.query(
          `UPDATE "MOTORISTA_VEICULO" SET "${col}" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $3
           WHERE "IDVEICULOMOTORISTA" = $1::int`,
          [idVeiculo, pubPath, sg]
        );
      } catch (e) {
        if (e.code === '42703' && col === 'FOTOVEICULO') {
          return res.status(503).json({ error: 'Coluna foto do veículo indisponível no banco.' });
        }
        throw e;
      }
      if ((up.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'Registro não atualizado.' });
      }
      if (oldPath && oldPath !== pubPath) tryUnlinkPublicUpload(oldPath);
      res.json({ success: true, message: 'Anexo atualizado.', path: pubPath });
    } catch (err) {
      console.error('[CadastroGeral] upload anexo veículo motorista:', err);
      res.status(500).json({ error: 'Erro ao enviar anexo.' });
    }
  },
};

module.exports = cadastroController;