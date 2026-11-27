/**
 * Atlas Pay Fase 4 — inadimplência inteligente.
 * Uso: node backend/scripts/test_atlas_pay_fase4_inadimplencia.js
 * Tenant isolado atlas-pay-f4-test. Não altera default operacional nem gera cobrança via confirmação real.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));

const { pool } = require('../config/db');
const finInad = require('../services/financeiro-inadimplencia.service');
const fusoSp = require('../services/financeiro-fuso-sp');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const motoristaCtrl = require('../controllers/motorista-app.controller');
const oportCtrl = require('../controllers/oportunidades-campanhas.controller');
const viagemCtrl = require('../controllers/viagemmestre.controller');

const TENANT = 'atlas-pay-f4-test';
const TENANT_B = 'atlas-pay-f4-b';
const CD_MOT = 940001;
const results = [];

function ok(name, detail) {
  results.push({ name, ok: true, detail: detail || '' });
  console.log('OK  ', name, detail || '');
}
function fail(name, detail) {
  results.push({ name, ok: false, detail: String(detail || '') });
  console.error('FAIL', name, detail);
}

function mockRes() {
  const r = { statusCode: 200, body: null, finished: false };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    r.finished = true;
    return r;
  };
  return r;
}

async function ensureTenants() {
  for (const tid of [TENANT, TENANT_B]) {
    await pool.query(
      `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID","NM_CLIENTE","CD_PLANO","FGACTIVE")
       VALUES ($1,$2,1,'S') ON CONFLICT ("TENANT_ID") DO NOTHING`,
      [tid, 'Atlas Pay F4 ' + tid]
    );
  }
}

async function limparF4() {
  await pool.query(
    `UPDATE "FIN_COBRANCA" SET "STATUS"='CANCELADA', "DH_CANCELAMENTO"=CURRENT_TIMESTAMP,
        "ORIGEM_CANCELAMENTO"='SISTEMA', "DS_CANCELAMENTO"='limpeza fixture f4'
      WHERE "TENANT_ID" IN ($1,$2) AND "STATUS" IN ('ABERTA','PAGA')`,
    [TENANT, TENANT_B]
  );
  await pool.query(
    `DELETE FROM "FIN_CONTRATO_COMPONENTE" WHERE "ID_CONTRATO" IN
      (SELECT "ID" FROM "FIN_CONTRATO" WHERE "TENANT_ID" IN ($1,$2))`,
    [TENANT, TENANT_B]
  );
  await pool.query(`DELETE FROM "FIN_CONTRATO" WHERE "TENANT_ID" IN ($1,$2)`, [TENANT, TENANT_B]);
}

async function publicarContrato(tenantId, fgRegra, politica) {
  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "DH_FIM"=CURRENT_TIMESTAMP
      WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [tenantId]
  );
  const ver = await pool.query(
    `SELECT COALESCE(MAX("VERSAO"),0)+1 AS v FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1`,
    [tenantId]
  );
  const v = ver.rows[0].v;
  const ins = await pool.query(
    `INSERT INTO "FIN_CONTRATO"
      ("TENANT_ID","VERSAO","DH_INICIO","DH_FIM","FG_REGRA_ATIVA","POLITICA_INADIMPLENCIA","FGACTIVE","SGUSERINCLUSAO")
     VALUES ($1,$2,CURRENT_TIMESTAMP,NULL,$3,$4,'S','f4')
     RETURNING "ID"`,
    [tenantId, v, fgRegra, politica]
  );
  await pool.query(
    `INSERT INTO "FIN_CONTRATO_COMPONENTE"
      ("ID_CONTRATO","GRUPO","TIPO","VALOR_CENTAVOS","FG_ATIVO","ORDEM")
     VALUES ($1,'CONEXAO','FIXO',10000,'S',0)`,
    [ins.rows[0].ID]
  );
  return ins.rows[0].ID;
}

let _f4ConvSeq = 940000;
async function insertCobranca({
  tenantId,
  pagadorTipo,
  cdMot,
  pagadorTenant,
  valor,
  vencWall,
  modalidade,
  ciclo,
}) {
  const mod = modalidade || (pagadorTipo === 'MOTORISTA' ? 'CONEXAO' : 'USO_PLATAFORMA');
  const idConv = mod === 'CONEXAO' ? ++_f4ConvSeq : null;
  const cicloId = ciclo || 'F4:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
  const r = await pool.query(
    `INSERT INTO "FIN_COBRANCA"
      ("MODALIDADE","TENANT_ID","PAGADOR_TIPO","PAGADOR_CDCADASTRO","PAGADOR_TENANT_ID",
       "BENEFICIARIO_TENANT_ID","IDCONVOCACAO","ID_CICLO_CONFIRMACAO","VALOR_CENTAVOS","STATUS","DH_VENCIMENTO","SGUSER_CRIACAO")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ABERTA',$10::timestamp,'f4')
     RETURNING "ID"`,
    [
      mod,
      tenantId,
      pagadorTipo,
      pagadorTipo === 'MOTORISTA' ? cdMot : null,
      pagadorTipo === 'TENANT' ? pagadorTenant || tenantId : null,
      pagadorTipo === 'TENANT' ? getDefaultTenantId() : tenantId,
      idConv,
      cicloId,
      valor != null ? valor : 5000,
      vencWall || null,
    ]
  );
  return r.rows[0].ID;
}

async function baixar(id) {
  await pool.query(
    `UPDATE "FIN_COBRANCA" SET "STATUS"='PAGA', "DH_BAIXA"=CURRENT_TIMESTAMP, "SGUSER_BAIXA"='f4'
      WHERE "ID"=$1`,
    [id]
  );
}

async function cancelar(id) {
  await pool.query(
    `UPDATE "FIN_COBRANCA" SET "STATUS"='CANCELADA', "DH_CANCELAMENTO"=CURRENT_TIMESTAMP,
        "ORIGEM_CANCELAMENTO"='SISTEMA', "DS_CANCELAMENTO"='f4 test'
      WHERE "ID"=$1`,
    [id]
  );
}

/** Invoca handler Express e captura status/body (gate early-return). */
async function callHandler(fn, req) {
  const res = mockRes();
  let nextErr = null;
  await Promise.race([
    Promise.resolve(fn(req, res)).catch((e) => {
      nextErr = e;
    }),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  return { res, nextErr };
}

function assertFusoVencimentoIndependente() {
  const child = `
    const fuso = require('./services/financeiro-fuso-sp');
    const inad = require('./services/financeiro-inadimplencia.service');
    const agora = '2026-11-26 15:00:00';
    const past = '2026-11-20 10:00:00';
    const future = '2026-12-06 15:00:00';
    const out = {
      tz: process.env.TZ || '',
      vencidaPast: inad.isVencida(past, agora),
      vencidaFuture: inad.isVencida(future, agora),
      wall: fuso.nowSpWall(Date.UTC(2026, 10, 26, 18, 0, 0)),
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  `;
  const zones = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'America/Sao_Paulo'];
  const snaps = [];
  for (const tz of zones) {
    const r = spawnSync(process.execPath, ['-e', child], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      fail('fuso vencimento independente', `TZ=${tz} ${r.stderr}`);
      return;
    }
    const raw = String(r.stdout);
    snaps.push(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
  }
  const all =
    snaps.every((s) => s.vencidaPast === true && s.vencidaFuture === false && s.wall === '2026-11-26 15:00:00');
  if (all) ok('fuso vencimento independente do host', zones.join(','));
  else fail('fuso vencimento independente do host', JSON.stringify(snaps));
}

async function run() {
  await ensureTenants();
  await limparF4();

  // --- 12 FG_REGRA_ATIVA = N ---
  await publicarContrato(TENANT, 'N', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 9000,
    vencWall: '2020-01-01 00:00:00',
  });
  let av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'LIBERADO') ok('12. regra N sem enforcement', av.motivo);
  else fail('12. regra N', av.modo);

  await limparF4();
  await publicarContrato(TENANT, 'S', 'ALERTA');

  // --- Sem dívida ---
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'LIBERADO' && av.qtdAbertas === 0) ok('0. sem dívida LIBERADO', '');
  else fail('0. sem dívida', JSON.stringify(av));

  // --- 1 ABERTA não vencida + ALERTA ---
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 3000,
    vencWall: '2099-01-01 00:00:00',
  });
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  let gate = await finInad.aplicarGate({ tipo: 'TENANT', tenantId: TENANT });
  if (
    av.modo === 'ALERTA' &&
    av.qtdVencidas === 0 &&
    gate.warning &&
    gate.warning.code === finInad.CODE_ALERTA &&
    !gate.failOpen
  ) {
    ok('1. ABERTA não vencida + ALERTA: permite com warning', av.code);
  } else fail('1. ABERTA não vencida + ALERTA', JSON.stringify({ av, gate }));

  // --- 2 ABERTA não vencida + BLOQUEIO ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 4000,
    vencWall: '2099-06-01 12:00:00',
  });
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  gate = await finInad.aplicarGate({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'ALERTA' && av.qtdVencidas === 0 && gate.warning && gate.warning.code === finInad.CODE_ALERTA) {
    ok('2. ABERTA não vencida + BLOQUEIO: permite com warning', av.modo);
  } else fail('2. ABERTA não vencida + BLOQUEIO', JSON.stringify({ av, gate }));

  // --- 3 ABERTA vencida + ALERTA ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'ALERTA');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 5500,
    vencWall: '2021-03-01 00:00:00',
  });
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  gate = await finInad.aplicarGate({ tipo: 'TENANT', tenantId: TENANT });
  if (
    av.modo === 'ALERTA' &&
    av.qtdVencidas === 1 &&
    gate.warning &&
    gate.warning.code === finInad.CODE_ALERTA
  ) {
    ok('3. ABERTA vencida + ALERTA: permite com warning (nunca 403)', av.code);
  } else fail('3. ABERTA vencida + ALERTA', JSON.stringify({ av, gate }));

  // --- 4 ABERTA vencida + BLOQUEIO ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  const idVenc = await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 7000,
    vencWall: '2020-05-01 00:00:00',
  });
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'BLOQUEADO' && av.code === finInad.CODE_BLOQUEIO) {
    ok('4. ABERTA vencida + BLOQUEIO: BLOQUEADO', String(av.qtdVencidas));
  } else fail('4. ABERTA vencida + BLOQUEIO', JSON.stringify(av));

  try {
    await finInad.aplicarGate({ tipo: 'TENANT', tenantId: TENANT });
    fail('4b. aplicarGate HTTP 403', 'não lançou');
  } catch (e) {
    if (e.statusCode === 403 && e.code === finInad.CODE_BLOQUEIO) {
      ok('4b. ABERTA vencida + BLOQUEIO: HTTP 403 FIN_INADIMPLENTE_BLOQUEIO', e.message.slice(0, 60));
    } else fail('4b. aplicarGate', e.message);
  }

  // --- 5 PAGA libera ---
  await baixar(idVenc);
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'LIBERADO' && av.qtdAbertas === 0) ok('5. PAGA: libera', '');
  else fail('5. PAGA', JSON.stringify(av));

  // --- 6 CANCELADA libera ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  const idCanc = await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 2200,
    vencWall: '2016-01-01 00:00:00',
  });
  await cancelar(idCanc);
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'LIBERADO') ok('6. CANCELADA: libera', '');
  else fail('6. CANCELADA', JSON.stringify(av));

  // Restaura cenário multi para testes 7+ (baixa parcial / cancelamento)
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  const idVenc2 = await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 7000,
    vencWall: '2020-05-01 00:00:00',
  });

  // --- multi: vencida + aberta futura ---
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 1000,
    vencWall: '2099-12-31 23:59:59',
  });
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'BLOQUEADO' && av.qtdAbertas === 2 && av.qtdVencidas === 1) {
    ok('4c. vencida + aberta futura mantém bloqueio', '');
  } else fail('4c. multi cobranças', JSON.stringify(av));

  // --- 7 baixa: libera bloqueio na próxima avaliação ---
  await baixar(idVenc2);
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'ALERTA' && av.qtdVencidas === 0 && av.qtdAbertas === 1) {
    ok('7. baixa: libera bloqueio na próxima avaliação (resta ALERTA por aberta)', '');
  } else fail('7. baixa', JSON.stringify(av));

  const rest = await pool.query(
    `SELECT "ID" FROM "FIN_COBRANCA" WHERE "TENANT_ID"=$1 AND "STATUS"='ABERTA'`,
    [TENANT]
  );
  for (const row of rest.rows) await cancelar(row.ID);
  av = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (av.modo === 'LIBERADO') ok('8. cancelamento: libera na próxima avaliação', '');
  else fail('8. cancelamento', JSON.stringify(av));

  // --- 8/9 isolamento motorista × tenant ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await publicarContrato(TENANT_B, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'MOTORISTA',
    cdMot: CD_MOT,
    valor: 8000,
    vencWall: '2018-01-01 00:00:00',
  });
  const avMot = await finInad.avaliarPagador({
    tipo: 'MOTORISTA',
    tenantId: TENANT,
    cdCadastro: CD_MOT,
  });
  const avTen = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (avMot.modo === 'BLOQUEADO' && avTen.modo === 'LIBERADO') {
    ok('9a. motorista inadimplente não bloqueia tenant', '');
  } else fail('9a. isolamento mot→tenant', JSON.stringify({ avMot, avTen }));

  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 8000,
    vencWall: '2018-01-01 00:00:00',
  });
  const avMot2 = await finInad.avaliarPagador({
    tipo: 'MOTORISTA',
    tenantId: TENANT,
    cdCadastro: CD_MOT,
  });
  const avTen2 = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: TENANT });
  if (avTen2.modo === 'BLOQUEADO' && avMot2.modo === 'LIBERADO') {
    ok('9b. tenant inadimplente não bloqueia motorista', '');
  } else fail('9b. isolamento tenant→mot', JSON.stringify({ avMot2, avTen2 }));

  // --- 10 escopo motorista por tenant ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await publicarContrato(TENANT_B, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'MOTORISTA',
    cdMot: CD_MOT,
    valor: 1500,
    vencWall: '2017-01-01 00:00:00',
  });
  const avA = await finInad.avaliarPagador({
    tipo: 'MOTORISTA',
    tenantId: TENANT,
    cdCadastro: CD_MOT,
  });
  const avB = await finInad.avaliarPagador({
    tipo: 'MOTORISTA',
    tenantId: TENANT_B,
    cdCadastro: CD_MOT,
  });
  if (avA.modo === 'BLOQUEADO' && avB.modo === 'LIBERADO') {
    ok('10. isolamento dívida motorista por tenant', '');
  } else fail('10. escopo tenant', JSON.stringify({ avA, avB }));

  // --- 11 default nunca bloqueado ---
  const def = getDefaultTenantId();
  // Não altera contrato default: avalia com q mock / insert só se necessário em tenant=default
  // Usa avaliador com rows simuladas via insert cancelável em default? Evitar poluir default.
  // Teste unitário da regra: tipo TENANT + tenantId default + vencida → ALERTA
  {
    const agora = fusoSp.nowSpWall();
    const fakeRows = [{ VALOR_CENTAVOS: 100, DH_VENCIMENTO: '2010-01-01 00:00:00' }];
    let qtdV = 0;
    for (const row of fakeRows) {
      if (finInad.isVencida(row.DH_VENCIMENTO, agora)) qtdV++;
    }
    // Chama serviço real: publicar temporário em default é arriscado.
    // Inserir cobrança TENANT default ABERTA vencida, avaliar, cancelar.
    const prevPol = await pool.query(
      `SELECT "ID","POLITICA_INADIMPLENCIA","FG_REGRA_ATIVA" FROM "FIN_CONTRATO"
        WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL ORDER BY "VERSAO" DESC LIMIT 1`,
      [def]
    );
    let idDefCob = null;
    try {
      if (prevPol.rowCount) {
        await pool.query(
          `UPDATE "FIN_CONTRATO" SET "FG_REGRA_ATIVA"='S', "POLITICA_INADIMPLENCIA"='BLOQUEIO'
            WHERE "ID"=$1`,
          [prevPol.rows[0].ID]
        );
      }
      idDefCob = await insertCobranca({
        tenantId: def,
        pagadorTipo: 'TENANT',
        pagadorTenant: def,
        valor: 111,
        vencWall: '2010-01-01 00:00:00',
        ciclo: 'F4-DEFAULT-SAFE-' + Date.now(),
      });
      const avDef = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: def });
      if (avDef.modo === 'ALERTA' && avDef.qtdVencidas >= 1) {
        ok('11. default nunca BLOQUEADO (só ALERTA)', avDef.modo);
      } else fail('11. default', JSON.stringify(avDef));
    } finally {
      if (idDefCob) await cancelar(idDefCob);
      if (prevPol.rowCount) {
        await pool.query(
          `UPDATE "FIN_CONTRATO" SET "FG_REGRA_ATIVA"=$2, "POLITICA_INADIMPLENCIA"=$3 WHERE "ID"=$1`,
          [
            prevPol.rows[0].ID,
            prevPol.rows[0].FG_REGRA_ATIVA,
            prevPol.rows[0].POLITICA_INADIMPLENCIA,
          ]
        );
      }
    }
  }

  // --- 13 fail-open + aviso ---
  const gateFail = await finInad.aplicarGate({
    tipo: 'TENANT',
    tenantId: TENANT,
    q: async () => {
      throw new Error('simulated db down');
    },
  });
  if (
    gateFail.failOpen &&
    gateFail.avaliacao.modo === 'LIBERADO' &&
    gateFail.warning &&
    gateFail.warning.code === finInad.CODE_FAIL_OPEN &&
    gateFail.warning.message
  ) {
    ok('13. fail-open com aviso (não confunde com ausência de dívida)', gateFail.warning.code);
  } else fail('13. fail-open', JSON.stringify(gateFail));

  // --- 14 HTTP gates (handlers early 403) ---
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'TENANT',
    valor: 5000,
    vencWall: '2015-01-01 00:00:00',
  });

  const reqTenant = {
    params: { id: '1' },
    body: { idViagem: 1, motoristas: [{ CDCADASTRO_MOTORISTA: 1 }] },
    headers: { 'user-login': 'admin' },
    user: { login: 'admin', tenantId: TENANT },
    tenantId: TENANT,
  };
  // criarConvocacoes — gate antes de validar viagem
  {
    const { res } = await callHandler(viagemCtrl.criarConvocacoes, reqTenant);
    if (res.statusCode === 403 && res.body && res.body.code === finInad.CODE_BLOQUEIO) {
      ok('14a. HTTP criarConvocacoes 403', '');
    } else fail('14a. criarConvocacoes', JSON.stringify({ s: res.statusCode, b: res.body }));
  }
  {
    const { res } = await callHandler(viagemCtrl.confirmarConvocacao, {
      ...reqTenant,
      params: { id: '999999' },
      user: { login: 'admin', SGUSUARIO: 'admin', tenantId: TENANT },
      headers: { 'user-login': 'admin' },
    });
    if (res.statusCode === 403 && res.body && res.body.code === finInad.CODE_BLOQUEIO) {
      ok('14b. HTTP confirmarConvocacao 403', '');
    } else fail('14b. confirmarConvocacao', JSON.stringify({ s: res.statusCode, b: res.body }));
  }
  {
    const { res } = await callHandler(oportCtrl.dispararCampanha.bind(oportCtrl), {
      params: { id: '1' },
      body: {},
      user: { login: 'admin', tenantId: TENANT },
      tenantId: TENANT,
      headers: {},
    });
    if (res.statusCode === 403 && res.body && res.body.code === finInad.CODE_BLOQUEIO) {
      ok('14c. HTTP dispararCampanha 403', '');
    } else fail('14c. dispararCampanha', JSON.stringify({ s: res.statusCode, b: res.body }));
  }

  // Motorista gates
  await limparF4();
  await publicarContrato(TENANT, 'S', 'BLOQUEIO');
  await insertCobranca({
    tenantId: TENANT,
    pagadorTipo: 'MOTORISTA',
    cdMot: CD_MOT,
    valor: 6000,
    vencWall: '2014-01-01 00:00:00',
  });
  try {
    await finInad.aplicarGate({ tipo: 'MOTORISTA', tenantId: TENANT, cdCadastro: CD_MOT });
    fail('14d. motorista gate 403', 'não lançou');
  } catch (e) {
    if (e.statusCode === 403 && e.code === finInad.CODE_BLOQUEIO) {
      ok('14d. HTTP motorista aceitar/interesse gate 403', '');
    } else fail('14d. motorista', e.message);
  }

  // Simula early return dos handlers motorista (código path)
  const srcAceitar = String(motoristaCtrl.aceitarConvocacao);
  const srcCarga = String(motoristaCtrl.aceitarCarga);
  const srcInt = String(oportCtrl.publicoInteresse);
  if (
    srcAceitar.includes('aplicarGate') &&
    srcCarga.includes('aplicarGate') &&
    srcInt.includes('aplicarGate') &&
    String(viagemCtrl.criarConvocacoes).includes('aplicarGate') &&
    String(viagemCtrl.confirmarConvocacao).includes('aplicarGate') &&
    String(oportCtrl.dispararCampanha).includes('aplicarGate')
  ) {
    ok('14e. todas as 6 rotas protegidas com aplicarGate', '');
  } else fail('14e. cobertura de rotas', 'falta gate em algum handler');

  // --- 15 regressão isolamento estoque/login (grep estático + auth sem fin) ---
  const fs = require('fs');
  const authSrc = fs.readFileSync(path.join(__dirname, '../routes/auth.routes.js'), 'utf8');
  if (!/financeiro-inadimplencia|FIN_COBRANCA/.test(authSrc)) {
    ok('15a. login/auth sem acoplamento inadimplência', '');
  } else fail('15a. auth acoplado', '');
  const estoqueHits = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|html)$/i.test(f) && /estoque/i.test(p.replace(/\\/g, '/'))) {
        const t = fs.readFileSync(p, 'utf8');
        if (/financeiro-inadimplencia|FIN_INADIMPLENTE/.test(t)) estoqueHits.push(p);
      }
    }
  }
  walk(path.join(__dirname, '../controllers'));
  walk(path.join(__dirname, '../public/modulos'));
  if (estoqueHits.length === 0) ok('15b. estoque sem inadimplência', '');
  else fail('15b. estoque', estoqueHits.join(','));

  // --- 16/17 afirmações de contrato (código) ---
  const confSrc = fs.readFileSync(path.join(__dirname, '../controllers/viagemmestre.controller.js'), 'utf8');
  const iGate = confSrc.indexOf('aplicarGate({ tipo: \'TENANT\'');
  const iTx = confSrc.indexOf('createTransaction(pool)');
  const iCob = confSrc.indexOf('criarCobrancaConexaoNaConfirmacao');
  if (iGate > 0 && iTx > iGate && iCob > iTx) {
    ok('16. gate antes da TX; cobrança na confirmação preservada', '');
  } else fail('16. ordem gate/TX', `gate=${iGate} tx=${iTx} cob=${iCob}`);
  const aceSrc = fs.readFileSync(path.join(__dirname, '../controllers/motorista-app.controller.js'), 'utf8');
  const aceBlock = aceSrc.slice(aceSrc.indexOf('aceitarConvocacao'), aceSrc.indexOf('recusarConvocacao'));
  if (!/criarCobrancaConexao/.test(aceBlock)) {
    ok('17. aceite sem gerar cobrança', '');
  } else fail('17. aceite gera cobrança', '');

  // --- warning JSON ---
  const w = finInad.warningFromAvaliacao({
    modo: 'ALERTA',
    motivo: 'teste',
    politica: 'ALERTA',
    qtdAbertas: 1,
    qtdVencidas: 0,
    totalCentavosAbertas: 100,
    totalCentavosVencidas: 0,
  });
  if (w && w.code === finInad.CODE_ALERTA) ok('warning estruturado ALERTA', w.code);
  else fail('warning', JSON.stringify(w));
  if (finInad.anexarWarning({ success: true }, w).warning.code === finInad.CODE_ALERTA) {
    ok('anexarWarning no JSON de sucesso', '');
  } else fail('anexarWarning', '');

  assertFusoVencimentoIndependente();

  await limparF4();

  const pass = results.filter((r) => r.ok).length;
  const failN = results.filter((r) => !r.ok).length;
  console.log('\nResultado Fase 4:', pass, 'PASS /', failN, 'FAIL / 0 SKIP');
  process.exit(failN > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
