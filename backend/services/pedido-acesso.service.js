'use strict';

const bcrypt = require('bcrypt');
const { validarCNPJ, validarRUC } = require('./documento.service');
const { enviarUmaMensagemSwitchDigital, horaMinutoAgora } = require('./whatsapp-switch-digital.service');

const DDL = [
`
CREATE TABLE IF NOT EXISTS "SAAS_PEDIDO_ACESSO" (
  "ID" bigserial PRIMARY KEY,
  "NM_EMPRESA" varchar(200) NOT NULL,
  "DOCUMENTO" varchar(20) NOT NULL,
  "NM_CONTATO" varchar(120) NOT NULL,
  "EMAIL" varchar(200) NOT NULL,
  "TELEFONE" varchar(30) NULL,
  "SGUSUARIO" varchar(50) NOT NULL,
  "SENHA_HASH" varchar(100) NOT NULL,
  "SITUACAO" varchar(20) NOT NULL DEFAULT 'PENDENTE',
  "TENANT_ID" varchar(64) NULL,
  "DS_MOTIVO" varchar(300) NULL,
  "DH_PEDIDO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "DH_DECISAO" timestamp NULL,
  "SGUSER_DECISAO" varchar(50) NULL
)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "SGPAIS" varchar(8)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "DDI" varchar(5)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "IDIOMA" varchar(10)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "WHATSAPP_STATUS" varchar(30)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "WHATSAPP_DETALHE" varchar(300)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "WHATSAPP_RESP_STATUS" varchar(30)`,
`ALTER TABLE "SAAS_PEDIDO_ACESSO" ADD COLUMN IF NOT EXISTS "WHATSAPP_RESP_DETALHE" varchar(300)`,
`CREATE UNIQUE INDEX IF NOT EXISTS "UX_PEDIDO_LOGIN_ABERTO"
  ON "SAAS_PEDIDO_ACESSO" (lower("SGUSUARIO"))
  WHERE "SITUACAO" IN ('PENDENTE', 'LIBERADO')`,
`CREATE UNIQUE INDEX IF NOT EXISTS "UX_PEDIDO_EMAIL_ABERTO"
  ON "SAAS_PEDIDO_ACESSO" (lower("EMAIL"))
  WHERE "SITUACAO" IN ('PENDENTE', 'LIBERADO')`,
`CREATE UNIQUE INDEX IF NOT EXISTS "UX_PEDIDO_DOC_ABERTO"
  ON "SAAS_PEDIDO_ACESSO" ("DOCUMENTO")
  WHERE "SITUACAO" IN ('PENDENTE', 'LIBERADO')`,
];

let schemaPronto = false;

async function ensureClientePerfil(pool) {
  const alters = [
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "DOCUMENTO" varchar(20)',
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "SGPAIS" varchar(8)',
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "DDI" varchar(5)',
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "TELEFONE" varchar(30)',
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "NM_CONTATO" varchar(120)',
    'ALTER TABLE "SAAS_CLIENTE_CONTRATANTE" ADD COLUMN IF NOT EXISTS "EMAIL" varchar(200)',
  ];
  for (const sql of alters) await pool.query(sql);
}

async function ensurePedidoAcessoSchema(pool) {
  if (schemaPronto) return;
  for (const sql of DDL) await pool.query(sql);
  schemaPronto = true;
}

function soDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

const RUIDO_TENANT = new Set([
  'sa', 'ltda', 'me', 'epp', 'eireli', 'ss', 'cia', 'companhia',
  'tecnologia', 'logistica', 'transportes', 'transporte', 'servicos',
  'comercio', 'comercial', 'industria', 'industrial',
  'e', 'de', 'da', 'do', 'das', 'dos',
]);

function tokensTenant(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sugerirTenantId(nome) {
  const tokens = tokensTenant(nome);
  const uteis = tokens.filter((t) => !RUIDO_TENANT.has(t) && t.length > 1);
  const base = (uteis.length ? uteis : tokens).join('-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '');
  return base || 'empresa';
}

function normalizarTenantId(raw) {
  const id = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(id)) {
    return { error: 'Informe um identificador curto: começa com letra, 3 a 32 caracteres, só letras minúsculas, números e hífen.' };
  }
  if (id === 'default') {
    return { error: 'O identificador default é da instalação padrão. Escolha outro.' };
  }
  return { id };
}

function falha(code, error) {
  return { error, code };
}

function validarCUIT(valor) {
  const n = soDigitos(valor);
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(n.charAt(i), 10) * pesos[i];
  const resto = soma % 11;
  let dv = 11 - resto;
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === parseInt(n.charAt(10), 10);
}

function validarRUT(valor) {
  const n = soDigitos(valor);
  if (n.length !== 12) return false;
  const pesos = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 11; i++) soma += parseInt(n.charAt(i), 10) * pesos[i];
  const resto = soma % 11;
  const dv = resto === 0 ? 0 : 11 - resto;
  if (dv === 10) return false;
  return dv === parseInt(n.charAt(11), 10);
}

function documentoDoPais(pais, documento) {
  if (pais === 'BR') {
    return validarCNPJ(documento)
      ? null
      : 'CNPJ inválido. Confira os 14 dígitos.';
  }
  if (pais === 'PY') {
    return validarRUC(documento)
      ? null
      : 'RUC inválido. Use 8 ou 9 dígitos.';
  }
  if (pais === 'AR') {
    return validarCUIT(documento)
      ? null
      : 'CUIT inválido. Confira os 11 dígitos.';
  }
  if (pais === 'UY') {
    return validarRUT(documento)
      ? null
      : 'RUT inválido. Confira os 12 dígitos.';
  }
  if (documento.length < 5 || documento.length > 20) {
    return 'Informe o documento da empresa, só com os números.';
  }
  return null;
}

function celularDoDdi(ddi, nacional) {
  const v = soDigitos(nacional);
  if (ddi === '55') return v.length === 11 && /^[1-9]\d9\d{8}$/.test(v);
  if (ddi === '54') return v.length >= 10 && v.length <= 12 && v.charAt(0) === '9';
  if (ddi === '595') return v.length >= 8 && v.length <= 9 && v.charAt(0) === '9';
  if (ddi === '598') return v.length === 8 && v.charAt(0) === '9';
  return v.length >= 8 && v.length <= 15;
}

function validarPedido(body) {
  const nome = String(body.empresa || '').trim();
  const pais = String(body.pais || 'BR').trim().toUpperCase();
  const documento = soDigitos(body.documento);
  const contato = String(body.contato || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const ddi = soDigitos(body.ddi);
  const ddd = soDigitos(body.ddd);
  const numero = soDigitos(body.telefone);
  const idioma = String(body.idioma || '') === 'es-PY' ? 'es-PY' : 'pt-BR';
  const login = String(body.login || '').trim();
  const senha = String(body.senha || '');
  const telefone = ddi === '55' ? ddd + numero : numero;
  if (nome.length < 2 || nome.length > 200) return falha('empresa', 'Informe o nome da empresa.');
  if (!/^[A-Z]{2,8}$/.test(pais)) return falha('pais', 'Escolha o país do documento.');
  const docErro = documentoDoPais(pais, documento);
  if (docErro) return falha('documento', docErro);
  if (contato.length < 2 || contato.length > 120) return falha('contato', 'Informe quem será o contato.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return falha('email', 'Informe um e-mail válido.');
  if (!/^\d{1,4}$/.test(ddi)) return falha('telefone', 'Escolha o DDI do celular.');
  if (ddi === '55' && !/^[1-9]\d$/.test(ddd)) return falha('ddd', 'Informe o DDD com 2 dígitos.');
  if (!celularDoDdi(ddi, telefone)) return falha('telefone', 'Celular inválido para este DDI.');
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(login)) {
    return falha('login', 'O usuário de acesso usa letras, números, ponto, _ ou -, de 3 a 50 caracteres.');
  }
  if (senha.length < 6 || senha.length > 72) return falha('senha', 'A senha precisa ter de 6 a 72 caracteres.');
  return { nome, documento, contato, email, telefone, ddi, pais, idioma, login, senha };
}

function textoAviso(idioma, evento, { empresa, login, motivo }) {
  const es = idioma === 'es-PY';
  const url = process.env.PUBLIC_URL || 'http://localhost:8083';
  const nome = String(empresa || '').trim();
  const user = String(login || '').trim();
  if (evento === 'recebido') {
    return es
      ? `Atlas Cargo: recibimos el pedido de acceso de ${nome}. Espere la liberación. El usuario elegido es ${user}.`
      : `Atlas Cargo: recebemos o pedido de acesso de ${nome}. Aguarde a liberação. O usuário escolhido é ${user}.`;
  }
  if (evento === 'liberado') {
    return es
      ? `Atlas Cargo: el acceso de ${nome} fue liberado. Entre en ${url} con el usuario ${user}.`
      : `Atlas Cargo: o acesso de ${nome} foi liberado. Entre em ${url} com o usuário ${user}.`;
  }
  const extra = motivo ? ` Motivo: ${String(motivo).trim()}` : '';
  return es
    ? `Atlas Cargo: el pedido de acceso de ${nome} no fue liberado.${extra}`
    : `Atlas Cargo: o pedido de acesso de ${nome} não foi liberado.${extra}`;
}

async function registrarAviso(pool, id, status, detalhe) {
  try {
    await pool.query(
      `UPDATE "SAAS_PEDIDO_ACESSO"
       SET "WHATSAPP_STATUS" = $2, "WHATSAPP_DETALHE" = $3
       WHERE "ID" = $1`,
      [id, status, String(detalhe || '').slice(0, 300)]
    );
  } catch (e) {
    console.warn('[pedido-acesso] aviso não gravado:', e.message);
  }
}

async function registrarAvisoResponsavel(pool, id, status, detalhe) {
  try {
    await pool.query(
      `UPDATE "SAAS_PEDIDO_ACESSO"
       SET "WHATSAPP_RESP_STATUS" = $2, "WHATSAPP_RESP_DETALHE" = $3
       WHERE "ID" = $1`,
      [id, status, String(detalhe || '').slice(0, 300)]
    );
  } catch (e) {
    console.warn('[pedido-acesso] aviso do responsável não gravado:', e.message);
  }
}

function numeroComDdi(ddi, telefone) {
  const d = soDigitos(ddi);
  const f = soDigitos(telefone);
  if (!f) return '';
  if (d && f.startsWith(d) && f.length >= d.length + 8) return f;
  if (d) return d + f;
  if (f.length === 10 || f.length === 11) return `55${f}`;
  return f;
}

function mascaraFinal(numero) {
  const d = soDigitos(numero);
  if (d.length < 4) return '';
  return `••••${d.slice(-4)}`;
}

async function avisarPedido(pool, row, evento, motivo) {
  const id = row.ID ?? row.id;
  const ddi = soDigitos(row.DDI || row.ddi);
  const fone = soDigitos(row.TELEFONE || row.telefone);
  let numero = ddi + fone;
  if (!ddi && (fone.length === 10 || fone.length === 11)) numero = `55${fone}`;
  const idioma = row.IDIOMA || row.idioma || 'pt-BR';
  if (!numero) {
    await registrarAviso(pool, id, 'SEM_NUMERO', 'Pedido sem celular.');
    return { status: 'SEM_NUMERO' };
  }
  const corpo = textoAviso(idioma, evento, {
    empresa: row.NM_EMPRESA || row.nm_empresa,
    login: row.SGUSUARIO || row.sgusuario,
    motivo,
  });
  try {
    const r = await enviarUmaMensagemSwitchDigital(pool, null, {
      idConvocacao: null,
      numeroCelular: numero,
      corpoMensagem: corpo,
      tenantId: process.env.DEFAULT_TENANT_ID || 'default',
      jaTemDdi: true,
      protocolo: id != null && String(id).trim() !== '' ? `PA-${id}` : `PA · ${horaMinutoAgora()}`,
    });
    if (r.ok) {
      await registrarAviso(pool, id, 'ENVIADO', evento);
      return { status: 'ENVIADO' };
    }
    const detalhe = r.error || 'Não enviado';
    const status = /configurado/i.test(detalhe) ? 'SEM_CANAL' : 'ERRO';
    await registrarAviso(pool, id, status, detalhe);
    return { status, detalhe };
  } catch (e) {
    await registrarAviso(pool, id, 'ERRO', e.message);
    return { status: 'ERRO', detalhe: e.message };
  }
}

async function criarPedido(pool, body) {
  await ensurePedidoAcessoSchema(pool);
  const v = validarPedido(body);
  if (v.error) return { status: 400, error: v.error, code: v.code };

  const jaUsuario = await pool.query(
    `SELECT 1 FROM "USUARIO"
     WHERE "SGUSUARIO" = $1 OR lower("ENDEMAIL") = $2
     LIMIT 1`,
    [v.login, v.email]
  );
  if (jaUsuario.rows.length) {
    return { status: 409, error: 'Este usuário ou e-mail já tem acesso. Use o login ou escolha outro.' };
  }

  const hash = await bcrypt.hash(v.senha, 10);
  try {
    const ins = await pool.query(
      `INSERT INTO "SAAS_PEDIDO_ACESSO"
        ("NM_EMPRESA", "DOCUMENTO", "NM_CONTATO", "EMAIL", "TELEFONE", "SGUSUARIO", "SENHA_HASH", "SITUACAO", "SGPAIS", "DDI", "IDIOMA")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDENTE', $8, $9, $10)
       RETURNING "ID"`,
      [v.nome, v.documento, v.contato, v.email, v.telefone, v.login, hash, v.pais, v.ddi, v.idioma]
    );
    const id = ins.rows[0].ID ?? ins.rows[0].id;
    const aviso = await avisarPedido(pool, {
      ID: id,
      DDI: v.ddi,
      TELEFONE: v.telefone,
      IDIOMA: v.idioma,
      NM_EMPRESA: v.nome,
      SGUSUARIO: v.login,
    }, 'recebido');
    await avisarOperacao(pool, v, id);
    return { status: 201, id, whatsapp: aviso.status };
  } catch (err) {
    if (err.code === '23505') {
      return { status: 409, error: 'Já existe um pedido com esta empresa, e-mail ou usuário. Aguarde a liberação.' };
    }
    throw err;
  }
}

async function celularDoResponsavel(pool, tid) {
  await ensureClientePerfil(pool);
  const cliente = await pool.query(
    `SELECT "DDI", "TELEFONE"
       FROM "SAAS_CLIENTE_CONTRATANTE"
      WHERE "TENANT_ID" = $1
      LIMIT 1`,
    [tid]
  );
  const row = cliente.rows[0];
  const doCadastro = numeroComDdi(row && (row.DDI || row.ddi), row && (row.TELEFONE || row.telefone));
  if (doCadastro) return doCadastro;
  const cfg = await pool.query(
    `SELECT "VALOR" FROM "CONFIGURACAO"
      WHERE "TENANT_ID" = $1 AND "CHAVE" = 'alert_whatsapp_celular_central'
      LIMIT 1`,
    [tid]
  );
  return numeroComDdi('', cfg.rows[0] && (cfg.rows[0].VALOR || cfg.rows[0].valor));
}

async function avisarOperacao(pool, pedido, idPedido) {
  const tid = process.env.DEFAULT_TENANT_ID || 'default';
  try {
    const numero = await celularDoResponsavel(pool, tid);
    const final = mascaraFinal(numero);
    if (!numero) {
      await registrarAvisoResponsavel(pool, idPedido, 'SEM_NUMERO', 'O cadastro do tenant padrão não tem celular.');
      return;
    }
    const fone = pedido.ddi ? `+${pedido.ddi} ${pedido.telefone}` : pedido.telefone;
    const corpo = `Atlas Cargo: ${pedido.nome} pediu acesso ao painel. Contato ${pedido.contato}, celular ${fone}. Libere em Tenants e módulos, Pedidos de acesso.`;
    const refPedido = idPedido != null && String(idPedido).trim() !== '' ? `PA-${idPedido}-C` : `PA-C · ${horaMinutoAgora()}`;
    const r = await enviarUmaMensagemSwitchDigital(pool, null, {
      idConvocacao: null,
      numeroCelular: numero,
      corpoMensagem: corpo,
      tenantId: tid,
      jaTemDdi: numero.length >= 12,
      protocolo: refPedido,
    });
    if (r.ok) {
      await registrarAvisoResponsavel(pool, idPedido, 'ENVIADO', `WhatsApp enviado para ${final}.`);
      return;
    }
    const detalhe = r.error || 'Não enviado';
    const status = /configurado/i.test(detalhe) ? 'SEM_CANAL' : 'ERRO';
    await registrarAvisoResponsavel(pool, idPedido, status, `${detalhe} Destino ${final}.`);
  } catch (e) {
    await registrarAvisoResponsavel(pool, idPedido, 'ERRO', e.message);
  }
}

async function contarPendentes(pool) {
  await ensurePedidoAcessoSchema(pool);
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "SAAS_PEDIDO_ACESSO" WHERE "SITUACAO" = 'PENDENTE'`
  );
  return Number(r.rows[0] && (r.rows[0].n ?? r.rows[0].N)) || 0;
}

async function listarPedidos(pool) {
  await ensurePedidoAcessoSchema(pool);
  const r = await pool.query(
    `SELECT "ID", "NM_EMPRESA", "DOCUMENTO", "NM_CONTATO", "EMAIL", "TELEFONE",
            "SGPAIS", "DDI", "IDIOMA", "WHATSAPP_STATUS", "WHATSAPP_DETALHE",
            "WHATSAPP_RESP_STATUS", "WHATSAPP_RESP_DETALHE",
            "SGUSUARIO", "SITUACAO", "TENANT_ID", "DS_MOTIVO", "DH_PEDIDO", "DH_DECISAO"
     FROM "SAAS_PEDIDO_ACESSO"
     ORDER BY CASE WHEN "SITUACAO" = 'PENDENTE' THEN 0 ELSE 1 END, "DH_PEDIDO" DESC`
  );
  return r.rows || [];
}

async function liberarPedido(pool, id, operador, tenantInformado) {
  const norm = normalizarTenantId(tenantInformado);
  if (norm.error) return { status: 400, error: norm.error };
  await ensurePedidoAcessoSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ped = await client.query(
      `SELECT * FROM "SAAS_PEDIDO_ACESSO" WHERE "ID" = $1 FOR UPDATE`,
      [id]
    );
    const row = ped.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { status: 404, error: 'Pedido não encontrado.' };
    }
    const situacao = row.SITUACAO || row.situacao;
    if (situacao !== 'PENDENTE') {
      await client.query('ROLLBACK');
      return { status: 409, error: 'Este pedido já foi decidido.' };
    }
    const plano = await client.query(
      `SELECT "CD_PLANO" FROM "SAAS_PLANO" WHERE "FGACTIVE" = 'S' ORDER BY "CD_PLANO" LIMIT 1`
    );
    if (!plano.rows.length) {
      await client.query('ROLLBACK');
      return { status: 409, error: 'Não há plano ativo. Crie um plano antes de liberar.' };
    }
    const nome = row.NM_EMPRESA || row.nm_empresa;
    const login = row.SGUSUARIO || row.sgusuario;
    const email = row.EMAIL || row.email;
    const contato = row.NM_CONTATO || row.nm_contato;
    const hash = row.SENHA_HASH || row.senha_hash;
    const ocupado = await client.query(
      'SELECT 1 FROM "SAAS_CLIENTE_CONTRATANTE" WHERE "TENANT_ID" = $1',
      [norm.id]
    );
    if (ocupado.rows.length) {
      await client.query('ROLLBACK');
      return { status: 409, error: 'Este identificador já está em uso. Escolha outro, curto e único.' };
    }
    const tenantId = norm.id;
    const cdPlano = plano.rows[0].CD_PLANO ?? plano.rows[0].cd_plano;
    await ensureClientePerfil(client);
    await client.query(
      `INSERT INTO "SAAS_CLIENTE_CONTRATANTE"
        ("TENANT_ID", "NM_CLIENTE", "CD_PLANO", "FGACTIVE", "DOCUMENTO", "SGPAIS", "DDI", "TELEFONE", "NM_CONTATO", "EMAIL")
       VALUES ($1, $2, $3, 'S', $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        nome,
        cdPlano,
        row.DOCUMENTO || row.documento || null,
        row.SGPAIS || row.sgpais || null,
        row.DDI || row.ddi || null,
        row.TELEFONE || row.telefone || null,
        contato || null,
        email || null,
      ]
    );
    await client.query(
      `INSERT INTO "USUARIO"
        ("SGUSUARIO", "NMUSUARIO", "ENDEMAIL", "SENHA", "FGACTIVE", "TENANT_ID", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
       VALUES ($1, $2, $3, $4, 'S', $5, CURRENT_TIMESTAMP, $6, 'AppDVcargas')`,
      [login, String(contato).slice(0, 40), email, hash, tenantId, operador || 'sistema']
    );
    const copiou = await client.query(
      `INSERT INTO "USUARIOATIVIDADE"
        ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
       SELECT $1::varchar, ua."CDTIPOATIVIDADE", CURRENT_TIMESTAMP, $2::varchar, 'AppDVcargas', $3::varchar
       FROM "USUARIOATIVIDADE" ua
       INNER JOIN "TIPOATIVIDADE" t ON t."CDTIPOATIVIDADE" = ua."CDTIPOATIVIDADE"
       WHERE ua."SGUSUARIO" = $2::varchar
         AND TRIM(COALESCE(t."DSPROGRAMA", '')) NOT IN ('gerenciar-tenants-saas', 'gerenciar-tipos-atividade')`,
      [login, operador, tenantId]
    );
    await client.query(
      `UPDATE "SAAS_PEDIDO_ACESSO"
       SET "SITUACAO" = 'LIBERADO', "TENANT_ID" = $2, "DH_DECISAO" = CURRENT_TIMESTAMP, "SGUSER_DECISAO" = $3
       WHERE "ID" = $1`,
      [id, tenantId, operador || null]
    );
    await client.query('COMMIT');
    const aviso = await avisarPedido(pool, row, 'liberado');
    return {
      status: 200,
      tenantId,
      login,
      atividades: copiou.rowCount || 0,
      whatsapp: aviso.status,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* já desfeito */ }
    if (err.code === '23505') {
      return { status: 409, error: 'O usuário ou o tenant já existe. Não foi possível liberar.' };
    }
    throw err;
  } finally {
    client.release();
  }
}

async function recusarPedido(pool, id, operador, motivo) {
  await ensurePedidoAcessoSchema(pool);
  const texto = String(motivo || '').trim().slice(0, 300);
  const r = await pool.query(
    `UPDATE "SAAS_PEDIDO_ACESSO"
     SET "SITUACAO" = 'RECUSADO', "DS_MOTIVO" = $2, "DH_DECISAO" = CURRENT_TIMESTAMP, "SGUSER_DECISAO" = $3
     WHERE "ID" = $1 AND "SITUACAO" = 'PENDENTE'
     RETURNING "ID", "NM_EMPRESA", "SGUSUARIO", "DDI", "TELEFONE", "IDIOMA"`,
    [id, texto || null, operador || null]
  );
  if (!r.rows.length) return { status: 409, error: 'Pedido não está aguardando liberação.' };
  const aviso = await avisarPedido(pool, r.rows[0], 'recusado', texto);
  return { status: 200, whatsapp: aviso.status };
}

module.exports = {
  ensurePedidoAcessoSchema,
  criarPedido,
  avisarOperacao,
  ensureClientePerfil,
  sugerirTenantId,
  contarPendentes,
  listarPedidos,
  liberarPedido,
  recusarPedido,
};
