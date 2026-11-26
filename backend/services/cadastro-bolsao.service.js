const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { chaveCelular } = require('./motorista-planilha.service');

let tabelaPronta = false;

function chavesDoCelular(raw) {
  const chave = chaveCelular(raw);
  if (!chave) return [];
  const set = new Set([chave]);
  if (chave.startsWith('55') && chave.length > 11) set.add(chave.slice(2));
  return [...set];
}

async function garantirTabela(pool) {
  if (tabelaPronta) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "CADASTRO_TENANT_VINCULO" (
      "TENANT_ID" varchar(64) NOT NULL,
      "CDCADASTRO" numeric(15,0) NOT NULL,
      "FGACTIVE" char(1) NOT NULL DEFAULT 'A',
      "STATUSAPROVACAO" char(1) NOT NULL DEFAULT 'P',
      "DHVINCULO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "SGUSER" varchar(50) NULL,
      PRIMARY KEY ("TENANT_ID", "CDCADASTRO")
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IX_CADASTRO_TENANT_VINCULO_CAD"
      ON "CADASTRO_TENANT_VINCULO" ("CDCADASTRO")
  `);
  tabelaPronta = true;
}

async function resolverEmpresaPublica(pool, raw) {
  const pedido = String(raw || '').trim();
  const def = getDefaultTenantId();
  if (!pedido || pedido.toLowerCase() === def.toLowerCase()) {
    return { ok: true, tenantId: def, nome: 'Atlas Cargo', bolsao: true };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pedido)) {
    return { ok: false, status: 400, error: 'Empresa inválida no link.' };
  }
  const r = await pool.query(
    `SELECT "TENANT_ID", "NM_CLIENTE", "FGACTIVE"
       FROM "SAAS_CLIENTE_CONTRATANTE"
      WHERE LOWER("TENANT_ID") = LOWER($1)
      LIMIT 1`,
    [pedido]
  );
  const row = (r.rows || [])[0];
  if (!row) return { ok: false, status: 404, error: 'Empresa não encontrada.' };
  const fg = String(row.FGACTIVE || '').trim().toUpperCase();
  if (fg !== 'S' && fg !== 'A') return { ok: false, status: 400, error: 'Empresa inativa.' };
  return {
    ok: true,
    tenantId: row.TENANT_ID,
    nome: row.NM_CLIENTE || row.TENANT_ID,
    bolsao: false,
  };
}

async function celularOcupado(pool, raw, excetoId) {
  const chaves = chavesDoCelular(raw);
  if (!chaves.length) return { ocupado: false, chave: null };
  const r = await pool.query(
    `SELECT "CDCADASTRO"
       FROM "CADASTROGERAL"
      WHERE regexp_replace("NRCELULAR"::text, '\\D', '', 'g') = ANY($1::text[])
        AND ($2::numeric IS NULL OR "CDCADASTRO" <> $2::numeric)
      LIMIT 1`,
    [chaves, excetoId == null ? null : excetoId]
  );
  return { ocupado: (r.rows || []).length > 0, chave: chaves[0], id: r.rows?.[0]?.CDCADASTRO || null };
}

async function ehBolsaoParaTenant(pool, cdCadastro, tenantId) {
  const def = getDefaultTenantId();
  if (String(tenantId) === String(def)) return false;
  const r = await pool.query(
    `SELECT 1 FROM "CADASTROGERAL"
      WHERE "CDCADASTRO" = $1::numeric
        AND "TENANT_ID" = $2
        AND COALESCE("FGMOTORISTA", 'N') = 'S'`,
    [cdCadastro, def]
  );
  return (r.rows || []).length > 0;
}

async function buscarBolsao(pool, cdCadastro) {
  const def = getDefaultTenantId();
  const r = await pool.query(
    `SELECT cg."CDCADASTRO", cg."CGCCPF", cg."RZSOCIAL", cg."NMFANTASIA", cg."FGFISICAJURIDICA",
            cg."CEP", cg."CDCIDADE", cg."ENDERECO", cg."NRENDERECO", cg."COMPLEND", cg."BAIRRO",
            cg."ENDEMAIL", cg."FGRASTREADO", cg."PAIS", cg."LATITUDE", cg."LONGITUDE",
            cg."NRCELULAR"::text AS cel
       FROM "CADASTROGERAL" cg
      WHERE cg."CDCADASTRO" = $1::numeric
        AND cg."TENANT_ID" = $2
        AND COALESCE(cg."FGMOTORISTA", 'N') = 'S'`,
    [cdCadastro, def]
  );
  return (r.rows || [])[0] || null;
}

async function vincular(pool, { tenantId, cdCadastro, sgUser }) {
  await garantirTabela(pool);
  const def = getDefaultTenantId();
  if (String(tenantId) === String(def)) {
    const err = new Error('Esta ficha já é da sua empresa.');
    err.status = 400;
    throw err;
  }
  const origem = await buscarBolsao(pool, cdCadastro);
  if (!origem) {
    const err = new Error('Este cadastro não está no bolsão do Atlas.');
    err.status = 404;
    throw err;
  }
  const ins = await pool.query(
    `INSERT INTO "CADASTRO_TENANT_VINCULO"
       ("TENANT_ID", "CDCADASTRO", "FGACTIVE", "STATUSAPROVACAO", "SGUSER")
     VALUES ($1, $2::numeric, 'A', 'P', $3)
     ON CONFLICT ("TENANT_ID", "CDCADASTRO") DO NOTHING
     RETURNING "CDCADASTRO"`,
    [tenantId, cdCadastro, sgUser || null]
  );
  return { jaExistia: (ins.rows || []).length === 0, nome: origem.RZSOCIAL };
}

async function criarCopia(pool, { tenantId, cdCadastro, celular, sgUser }) {
  await garantirTabela(pool);
  const def = getDefaultTenantId();
  if (String(tenantId) === String(def)) {
    const err = new Error('Esta ficha já é da sua empresa.');
    err.status = 400;
    throw err;
  }
  const origem = await buscarBolsao(pool, cdCadastro);
  if (!origem) {
    const err = new Error('Este cadastro não está no bolsão do Atlas.');
    err.status = 404;
    throw err;
  }
  const chaveNova = chaveCelular(celular);
  if (!chaveNova) {
    const err = new Error('Informe um celular válido, com DDD.');
    err.status = 400;
    throw err;
  }
  const chaveOrigem = chaveCelular(origem.cel);
  const mesmas = new Set(chavesDoCelular(origem.cel));
  if (chaveOrigem && mesmas.has(chaveNova)) {
    const err = new Error('O cadastro próprio precisa de outro celular. O celular do bolsão continua no login do motorista. Para usar o mesmo número, escolha Usar na minha empresa.');
    err.status = 409;
    throw err;
  }
  const ocupado = await celularOcupado(pool, chaveNova);
  if (ocupado.ocupado) {
    const err = new Error('Este celular já está em outro cadastro.');
    err.status = 409;
    throw err;
  }
  const dupDoc = await pool.query(
    `SELECT 1 FROM "CADASTROGERAL" WHERE "CGCCPF" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
    [origem.CGCCPF, tenantId]
  );
  if ((dupDoc.rows || []).length) {
    const err = new Error('Sua empresa já tem um cadastro com este documento.');
    err.status = 409;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(81420026)');
    const maxRes = await client.query('SELECT COALESCE(MAX("CDCADASTRO")::numeric, 0) AS m FROM "CADASTROGERAL"');
    const novoId = Number(maxRes.rows[0].m || 0) + 1;
    const nome = String(origem.RZSOCIAL || '').slice(0, 60);
    const fantasia = String(origem.NMFANTASIA || origem.RZSOCIAL || '').slice(0, 30);
    const tipoPessoa = String(origem.FGFISICAJURIDICA || 'F').trim().toUpperCase() === 'J' ? 'J' : 'F';
    await client.query(
      `INSERT INTO "CADASTROGERAL" (
         "CDCADASTRO", "CGCCPF", "RZSOCIAL", "NMFANTASIA", "FGFISICAJURIDICA",
         "CEP", "CDCIDADE", "ENDERECO", "NRENDERECO", "COMPLEND", "BAIRRO",
         "NRCELULAR", "ENDEMAIL", "LATITUDE", "LONGITUDE",
         "FGACTIVE", "FGTIPOCADASTRO", "FGMOTORISTA",
         "FGOPERADOR", "FGPROGRAMADOR", "FGTRANSPORTADOR", "FGAGENTE", "FGGRUPO", "FGCERTIFICADORA", "FGUNIDADENEGOCIO",
         "FGRASTREADO", "PAIS", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
       ) VALUES (
         $1::numeric, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12::numeric, $13, $14, $15,
         'A', 'M', 'S',
         'N', 'N', 'N', 'N', 'N', 'N', 'N',
         $16, $17, CURRENT_TIMESTAMP, $18, 'CopiaBolsao', $19
       )`,
      [
        novoId,
        origem.CGCCPF,
        nome,
        fantasia,
        tipoPessoa,
        origem.CEP,
        origem.CDCIDADE,
        origem.ENDERECO || '',
        origem.NRENDERECO == null ? 0 : origem.NRENDERECO,
        origem.COMPLEND,
        origem.BAIRRO || '',
        chaveNova,
        origem.ENDEMAIL,
        origem.LATITUDE,
        origem.LONGITUDE,
        origem.FGRASTREADO || 'N',
        origem.PAIS,
        sgUser || 'TORRE',
        tenantId,
      ]
    );
    await client.query(
      `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "STATUSAPROVACAO")
       VALUES ($1::numeric, 'P')`,
      [novoId]
    );
    try {
      await client.query('SAVEPOINT extras');
      await client.query(
        `INSERT INTO "CLASSEFROTA_CG"
           ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
         SELECT $1::numeric, "CDCLASSEFROTA", "FGACTIVE", CURRENT_TIMESTAMP, $2, 'CopiaBolsao', $3
           FROM "CLASSEFROTA_CG"
          WHERE "CDCADASTRO" = $4::numeric
            AND "TENANT_ID" = $5
            AND ("FGACTIVE" = 'S' OR "FGACTIVE" = 'A')`,
        [novoId, sgUser || 'TORRE', tenantId, cdCadastro, def]
      );
      await client.query(
        `INSERT INTO "MOTORISTA_VEICULO" (
           "CDCADASTRO", "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDTIPOEQUIPAMENTO", "CDCLASSEFROTA",
           "PAPEL_CONJUNTO", "TENANT_ID", "STATUSAPROVACAO", "FGACTIVE", "SGUSER", "SERVERORIG"
         )
         SELECT $1::numeric, "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDTIPOEQUIPAMENTO", "CDCLASSEFROTA",
                "PAPEL_CONJUNTO", $2, 'P', 'S', $3, 'CopiaBolsao'
           FROM "MOTORISTA_VEICULO"
          WHERE "CDCADASTRO" = $4::numeric
            AND COALESCE("FGACTIVE", 'S') = 'S'`,
        [novoId, tenantId, sgUser || 'TORRE', cdCadastro]
      );
      await client.query('RELEASE SAVEPOINT extras');
    } catch (_extras) {
      try { await client.query('ROLLBACK TO SAVEPOINT extras'); } catch (_e) {}
    }
    await client.query('COMMIT');
    return { id: novoId, nome };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    if (e.code === '23505') {
      const err = new Error('Não foi possível criar o cadastro próprio: documento ou placa já existe nesta empresa.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  garantirTabela,
  resolverEmpresaPublica,
  celularOcupado,
  ehBolsaoParaTenant,
  vincular,
  criarCopia,
};
