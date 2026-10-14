'use strict';

const { pool } = require('../config/db');
const { buildChaveImport, normalizeNumeroEntregaMatch } = require('./cadastro-endereco-entrega-import.service');
const {
  buscarEnderecoEntregaParaParada,
  cnpj14Pad,
  normNomePontoMatch,
  resolveCdClienteDonoPorCdDono,
} = require('./cadastro-endereco-entrega-match.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');

const SQL_CGCCPF_14 = `right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14)`;

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function cepDigitos8(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d ? d.slice(0, 8) : '';
}

function normalizeNumeroNf(nro) {
  let s = String(nro == null ? '' : nro).trim();
  if (!s || s === '.' || s === '-') s = 'S/N';
  return s.slice(0, 30);
}

/** Nome do ponto a partir do XML / linha WMS_NFE_SAIDA (complemento e e-mail quando úteis). */
function montarNomePontoEntregaDaNf(nf) {
  let nome = String(nf.xnome_entrega || nf.XNOME_ENTREGA || nf.xnome_dest || nf.XNOME_DEST || '').trim();
  if (!nome) nome = nomeEntregaUnidadeOuLocalDestino(nf) || 'PONTO DE ENTREGA';
  const compl = String(nf.xcpl_dest || nf.XCPL_DEST || '').trim();
  if (compl) {
    const nomeUp = nome.toUpperCase();
    const complUp = compl.toUpperCase();
    if (!nomeUp.includes(complUp) && complUp.length >= 3) {
      nome = `${nome} — ${compl}`.trim();
    }
  }
  const email = String(nf.email_entrega || nf.EMAIL_ENTREGA || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const local = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase();
    const normNome = normNomePontoMatch(nome);
    if (local.length >= 4 && !normNome.includes(local)) {
      nome = `${nome} (${local})`.trim();
    }
  }
  return nome.slice(0, 200);
}

function nfComoObjetoMatch(nf) {
  return {
    CNPJ_ENTREGA: nf.cnpj_entrega || nf.CNPJ_ENTREGA,
    CNPJ_DEST: nf.cnpj_dest || nf.CNPJ_DEST,
    XNOME_ENTREGA: nf.xnome_entrega || nf.XNOME_ENTREGA,
    XNOME_DEST: nf.xnome_dest || nf.XNOME_DEST,
    XLGR_DEST: nf.xlgr_dest || nf.XLGR_DEST,
    NRO_DEST: nf.nro_dest != null ? nf.nro_dest : nf.NRO_DEST,
    XCPL_DEST: nf.xcpl_dest || nf.XCPL_DEST,
    XMUN_DEST: nf.xmun_dest || nf.XMUN_DEST,
    UF_DEST: nf.uf_dest || nf.UF_DEST,
    CEP_DEST: nf.cep_dest || nf.CEP_DEST,
    EMAIL_ENTREGA: nf.email_entrega || nf.EMAIL_ENTREGA,
  };
}

function pendenciasEndereco(row) {
  const out = [];
  if (row.NR_ROTA == null || !Number.isFinite(Number(row.NR_ROTA))) out.push('NR_ROTA');
  const lat = row.LATITUDE != null ? Number(row.LATITUDE) : null;
  const lon = row.LONGITUDE != null ? Number(row.LONGITUDE) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) out.push('COORDENADAS');
  return out;
}

function buildLinkCompletar(cdCliente, cdEndereco) {
  return {
    modulo: 'gerenciar-cadastro-geral',
    cdCadastro: cdCliente,
    cdEndereco,
    aba: 'enderecos-entrega',
  };
}

async function resolveClientePorCnpj(pool, tenantId, cnpj14) {
  const r = await pool.query(
    `SELECT cg."CDCADASTRO", cg."RZSOCIAL"
       FROM "CADASTROGERAL" cg
      WHERE (cg."TENANT_ID" = $1 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
        AND (${SQL_CGCCPF_14}) = $2
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
    .slice(0, 2);
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

async function carregarEnderecoPorId(pool, tenantId, cdEndereco) {
  const r = await pool.query(
    `SELECT e."CD_ENDERECO_ENTREGA", e."CD_CLIENTE", e."ST_COMPLETUDE", e."NR_ROTA", e."LATITUDE", e."LONGITUDE"
       FROM "CADASTRO_ENDERECO_ENTREGA" e
      WHERE e."TENANT_ID" = $1 AND e."CD_ENDERECO_ENTREGA" = $2::integer AND e."FGACTIVE" = 'A'
      LIMIT 1`,
    [tenantId, cdEndereco]
  );
  return r.rows[0] || null;
}

/**
 * Após importar NF-e de saída: vincula ponto existente ou cria rascunho no Cadastro Geral.
 * Pontos Mana/OPL ficam sob o CNPJ do dono (não sob o CNPJ do destinatário da NF).
 * Por isso tenta match com cdClienteDono antes de exigir matriz do CNPJ de entrega.
 * @param {import('pg').Pool} pgPool
 * @param {string} tenantId
 * @param {object} nf Dados parseados do XML (campos xlgr_dest, cnpj_entrega, …) + opcional CD_DONO
 * @param {string} sgUser
 * @returns {Promise<object>}
 */
async function provisionarEnderecoEntregaDaNf(pgPool, tenantId, nf, sgUser) {
  const n = nfComoObjetoMatch(nf);
  const cnpj = cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST);
  const logr = String(n.XLGR_DEST || '').trim();
  const uf = String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2);
  const cep8 = cepDigitos8(n.CEP_DEST);
  const numero = normalizeNumeroNf(n.NRO_DEST);
  const complemento = String(n.XCPL_DEST || '').trim() || null;
  const nmMun = String(n.XMUN_DEST || '').trim();
  const dsPonto = montarNomePontoEntregaDaNf(nf);
  const nmEntrega = nomeEntregaUnidadeOuLocalDestino(n) || dsPonto;

  if (cnpj.length !== 14 || !logr || !uf) {
    return {
      status: 'DADOS_INSUFICIENTES',
      mensagem: 'NF sem CNPJ, logradouro ou UF de entrega suficientes para cadastro automático.',
      cdEndereco: null,
      cdCliente: null,
      linkCompletar: null,
      pendencias: [],
    };
  }

  const cdDonoRaw = nf.CD_DONO != null ? nf.CD_DONO : nf.cd_dono;
  const cdDono = cdDonoRaw != null && cdDonoRaw !== '' ? parseInt(String(cdDonoRaw), 10) : null;
  let cdClienteDono = null;
  let cnpjDonoMatriz = null;
  if (cdDono != null && Number.isFinite(cdDono)) {
    const donoCli = await resolveCdClienteDonoPorCdDono(pgPool, tenantId, cdDono);
    cdClienteDono = donoCli.cdCliente;
    cnpjDonoMatriz = donoCli.cnpj14;
  }

  const hit = await buscarEnderecoEntregaParaParada(pgPool, tenantId, {
    cnpjEntrega: cnpj,
    nmEntrega,
    uf,
    municipio: nmMun,
    cep: cep8,
    logradouro: logr,
    numero,
    complemento: complemento || '',
    cdClienteDono,
    cnpjDonoMatriz,
  });

  if (hit.matchStatus === 'AMBIGUO') {
    const cdCliAmb =
      (await carregarEnderecoPorId(pgPool, tenantId, hit.cdEndereco))?.CD_CLIENTE ||
      cdClienteDono ||
      null;
    return {
      status: 'AMBIGUO',
      mensagem:
        'Há mais de um ponto de entrega no cadastro para este endereço. Revise duplicatas em Gerenciar Cadastro Geral → Endereços de entrega.',
      cdEndereco: null,
      cdCliente: cdCliAmb,
      linkCompletar: cdCliAmb != null ? buildLinkCompletar(cdCliAmb, null) : null,
      pendencias: [],
    };
  }

  if (hit.cdEndereco) {
    const row = await carregarEnderecoPorId(pgPool, tenantId, hit.cdEndereco);
    const cdClienteHit = row ? Number(row.CD_CLIENTE) : cdClienteDono;
    const pend = row ? pendenciasEndereco(row) : [];
    const st = row && row.ST_COMPLETUDE === 'RASCUNHO' ? 'RASCUNHO_EXISTENTE' : 'EXISTENTE';
    return {
      status: st,
      mensagem:
        pend.length > 0
          ? 'Ponto encontrado no cadastro, mas ainda incompleto (rota e/ou coordenadas).'
          : 'Ponto de entrega já cadastrado.',
      cdEndereco: hit.cdEndereco,
      cdCliente: cdClienteHit,
      linkCompletar: cdClienteHit != null ? buildLinkCompletar(cdClienteHit, hit.cdEndereco) : null,
      pendencias: pend,
      matchVia: hit.matchVia || null,
    };
  }

  const cliente = await resolveClientePorCnpj(pgPool, tenantId, cnpj);
  if (!cliente) {
    return {
      status: 'SEM_CLIENTE_MATRIZ',
      mensagem:
        'CNPJ de entrega não encontrado em Cadastro Geral e nenhum ponto do dono bateu com o endereço da NF. Cadastre o ponto em Endereços de entrega do dono (ou a matriz do destinatário).',
      cdEndereco: null,
      cdCliente: cdClienteDono,
      linkCompletar: cdClienteDono != null ? buildLinkCompletar(cdClienteDono, null) : null,
      pendencias: [],
    };
  }

  const cdCliente = Number(cliente.CDCADASTRO);

  const chave = buildChaveImport(tenantId, cnpj, dsPonto, logr, numero, cep8);
  const dup = await pgPool.query(
    `SELECT "CD_ENDERECO_ENTREGA", "ST_COMPLETUDE", "NR_ROTA", "LATITUDE", "LONGITUDE"
       FROM "CADASTRO_ENDERECO_ENTREGA"
      WHERE "TENANT_ID" = $1 AND "CHAVE_IMPORT" = $2 AND "FGACTIVE" = 'A'
      LIMIT 1`,
    [tenantId, chave]
  );
  if (dup.rows[0]) {
    const row = dup.rows[0];
    const pend = pendenciasEndereco(row);
    return {
      status: row.ST_COMPLETUDE === 'RASCUNHO' ? 'RASCUNHO_EXISTENTE' : 'EXISTENTE',
      mensagem: pend.length ? 'Ponto em rascunho — complete rota e coordenadas.' : 'Ponto já cadastrado.',
      cdEndereco: row.CD_ENDERECO_ENTREGA,
      cdCliente,
      linkCompletar: buildLinkCompletar(cdCliente, row.CD_ENDERECO_ENTREGA),
      pendencias: pend,
    };
  }

  const cidade = uf && nmMun ? await resolveCidadeEndereco(pgPool, uf, nmMun) : null;
  const cdCidade = cidade ? cidade.CDCIDADE : null;

  try {
    const ins = await pgPool.query(
      `INSERT INTO "CADASTRO_ENDERECO_ENTREGA" (
        "TENANT_ID","CD_CLIENTE","CHAVE_IMPORT","DS_PONTO_ENTREGA","UF_ENTREGA","NM_MUNICIPIO","CEP",
        "LOGRADOURO","NUMERO","COMPLEMENTO","LATITUDE","LONGITUDE","NR_ROTA","CDCIDADE","FGACTIVE","SGUSER","ST_COMPLETUDE"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,NULL,$11,'A',$12,'RASCUNHO')
      RETURNING "CD_ENDERECO_ENTREGA", "ST_COMPLETUDE"`,
      [
        tenantId,
        cdCliente,
        chave,
        dsPonto,
        uf || null,
        nmMun || null,
        cep8 || null,
        logr,
        normalizeNumeroEntregaMatch(numero) === 'SN' ? numero : numero,
        complemento,
        cdCidade,
        sgUser || 'import-nfe',
      ]
    );
    const cdEnd = ins.rows[0].CD_ENDERECO_ENTREGA;
    return {
      status: 'RASCUNHO_CRIADO',
      mensagem:
        'Ponto de entrega criado em rascunho a partir do XML. Complete a rota e as coordenadas no Cadastro Geral.',
      cdEndereco: cdEnd,
      cdCliente,
      linkCompletar: buildLinkCompletar(cdCliente, cdEnd),
      pendencias: ['NR_ROTA', 'COORDENADAS'],
      dsPontoEntrega: dsPonto,
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        status: 'SCHEMA_AUSENTE',
        mensagem: 'Execute os scripts de endereço de entrega e ST_COMPLETUDE no PostgreSQL.',
        cdEndereco: null,
        cdCliente,
        linkCompletar: null,
        pendencias: [],
      };
    }
    if (e.code === '23505') {
      const again = await pgPool.query(
        `SELECT "CD_ENDERECO_ENTREGA" FROM "CADASTRO_ENDERECO_ENTREGA"
          WHERE "TENANT_ID" = $1 AND "CHAVE_IMPORT" = $2 LIMIT 1`,
        [tenantId, chave]
      );
      if (again.rows[0]) {
        return {
          status: 'EXISTENTE',
          cdEndereco: again.rows[0].CD_ENDERECO_ENTREGA,
          cdCliente,
          linkCompletar: buildLinkCompletar(cdCliente, again.rows[0].CD_ENDERECO_ENTREGA),
          pendencias: ['NR_ROTA', 'COORDENADAS'],
          mensagem: 'Ponto já existia (chave de importação).',
        };
      }
    }
    throw e;
  }
}

async function vincularEnderecoEntregaNf(pgPool, tenantId, cdNfeSaida, cdEndereco) {
  if (cdEndereco == null || !Number.isFinite(Number(cdEndereco))) return;
  try {
    await pgPool.query(
      `UPDATE "WMS_NFE_SAIDA"
          SET "CD_ENDERECO_ENTREGA" = $3::integer
        WHERE "TENANT_ID" = $1 AND "CD_NFE_SAIDA" = $2::integer`,
      [tenantId, cdNfeSaida, cdEndereco]
    );
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
}

function avaliarStCompletudeEndereco(nrRota, lat, lon) {
  const temRota = nrRota != null && Number.isFinite(Number(nrRota));
  const temGeo = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
  return temRota && temGeo ? 'COMPLETO' : 'RASCUNHO';
}

module.exports = {
  provisionarEnderecoEntregaDaNf,
  vincularEnderecoEntregaNf,
  montarNomePontoEntregaDaNf,
  avaliarStCompletudeEndereco,
  buildLinkCompletar,
  pendenciasEndereco,
};
