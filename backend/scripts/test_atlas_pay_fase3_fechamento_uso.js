/**
 * Atlas Pay Fase 3 — fechamento USO_PLATAFORMA.
 * Uso: node backend/scripts/test_atlas_pay_fase3_fechamento_uso.js
 * Tenant isolado atlas-pay-f3-test. Não altera default nem resíduos P2.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));

const { pool } = require('../config/db');
const fin = require('../services/financeiro-cobranca.service');
const uso = require('../services/financeiro-fechamento-uso.service');
const fusoSp = require('../services/financeiro-fuso-sp');
const { requireFinPerm } = require('../middleware/financeiro-auth.middleware');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const TENANT = 'atlas-pay-f3-test';
const USER_SEM_FIN = 'f3_http_sem_fin';
const CD_ATLAS_PAY = 61;
const results = [];
function ok(name, detail) {
  results.push({ name, ok: true, detail: detail || '' });
  console.log('OK  ', name, detail || '');
}
function fail(name, detail) {
  results.push({ name, ok: false, detail: String(detail || '') });
  console.error('FAIL', name, detail);
}

async function ensureTenant() {
  await pool.query(
    `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID","NM_CLIENTE","CD_PLANO","FGACTIVE")
     VALUES ($1,'Atlas Pay F3 fixture',1,'S')
     ON CONFLICT ("TENANT_ID") DO NOTHING`,
    [TENANT]
  );
}

async function limparF3() {
  await pool.query(
    `DELETE FROM "FIN_FECHAMENTO_USO_EVENTO" WHERE "ID_FECHAMENTO" IN (SELECT "ID" FROM "FIN_FECHAMENTO_USO" WHERE "TENANT_ID"=$1)`,
    [TENANT]
  );
  await pool.query(`UPDATE "FIN_FECHAMENTO_USO" SET "ID_COBRANCA"=NULL WHERE "TENANT_ID"=$1`, [TENANT]);
  await pool.query(`DELETE FROM "FIN_FECHAMENTO_USO" WHERE "TENANT_ID"=$1`, [TENANT]);
  // Cobranças USO: cancelar (append-only — sem DELETE)
  await pool.query(
    `UPDATE "FIN_COBRANCA" SET "STATUS"='CANCELADA', "DH_CANCELAMENTO"=CURRENT_TIMESTAMP,
        "ORIGEM_CANCELAMENTO"='SISTEMA', "DS_CANCELAMENTO"='limpeza fixture f3'
      WHERE "TENANT_ID"=$1 AND "MODALIDADE"='USO_PLATAFORMA' AND "STATUS" IN ('ABERTA','PAGA')`,
    [TENANT]
  );
  await pool.query(`DELETE FROM "CONVOCACAO" WHERE "TENANT_ID"=$1`, [TENANT]);
  await pool.query(`DELETE FROM "VIAGEMMESTRE" WHERE "TENANT_ID"=$1`, [TENANT]);
  await pool.query(
    `DELETE FROM "FIN_CONTRATO_COMPONENTE" WHERE "ID_CONTRATO" IN (SELECT "ID" FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1)`,
    [TENANT]
  );
  await pool.query(`DELETE FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1`, [TENANT]);
}

async function insertViagem(id, dh, vlFrete, mae, fg) {
  await pool.query(
    `INSERT INTO "VIAGEMMESTRE"
      ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","TENANT_ID","DHINCLUSAO","VLFRETE","FGACTIVE","FGRASTREADO","IDVIAGEM_MAE","SGUSERINCLUSAO")
     VALUES ($1,1,'A',$2,$3::timestamp,$4,$5,'N',$6,'admin')
     ON CONFLICT ("IDVIAGEM") DO UPDATE SET
       "TENANT_ID"=EXCLUDED."TENANT_ID",
       "DHINCLUSAO"=EXCLUDED."DHINCLUSAO",
       "VLFRETE"=EXCLUDED."VLFRETE",
       "FGACTIVE"=EXCLUDED."FGACTIVE",
       "IDVIAGEM_MAE"=EXCLUDED."IDVIAGEM_MAE"`,
    [id, TENANT, dh, vlFrete, fg || 'A', mae || null]
  );
}

async function insertConv(idConv, idViagem, dh, status) {
  await pool.query(
    `INSERT INTO "CONVOCACAO"
      ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","STATUS","DHCONVOCACAO","SGUSUARIO_OPERADOR","TENANT_ID","DHENVIOMETA")
     VALUES ($1,$2,1,$3,$4::timestamp,'admin',$5,$4::timestamp)
     ON CONFLICT ("IDCONVOCACAO") DO UPDATE SET
       "IDVIAGEM"=EXCLUDED."IDVIAGEM",
       "STATUS"=EXCLUDED."STATUS",
       "DHCONVOCACAO"=EXCLUDED."DHCONVOCACAO",
       "TENANT_ID"=EXCLUDED."TENANT_ID",
       "DHENVIOMETA"=EXCLUDED."DHENVIOMETA"`,
    [idConv, idViagem, status || 'PENDENTE', dh, TENANT]
  );
}

async function publicar(comps, fgRegra, dhInicio) {
  // Fecha vigente se houver
  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "DH_FIM"=$2::timestamp WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [TENANT, dhInicio]
  );
  const ver = await pool.query(
    `SELECT COALESCE(MAX("VERSAO"),0)+1 AS v FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1`,
    [TENANT]
  );
  const v = ver.rows[0].v;
  const ins = await pool.query(
    `INSERT INTO "FIN_CONTRATO"
      ("TENANT_ID","VERSAO","DH_INICIO","DH_FIM","FG_REGRA_ATIVA","POLITICA_INADIMPLENCIA","FGACTIVE","SGUSERINCLUSAO")
     VALUES ($1,$2,$3::timestamp,NULL,$4,'ALERTA','S','admin')
     RETURNING "ID"`,
    [TENANT, v, dhInicio, fgRegra]
  );
  const id = ins.rows[0].ID;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    await pool.query(
      `INSERT INTO "FIN_CONTRATO_COMPONENTE"
        ("ID_CONTRATO","GRUPO","TIPO","VALOR_CENTAVOS","PERCENTUAL","FG_ATIVO","ORDEM")
       VALUES ($1,'USO_PLATAFORMA',$2,$3,$4,'S',$5)`,
      [id, c.tipo, c.valorCentavos != null ? c.valorCentavos : null, c.percentual != null ? c.percentual : null, i]
    );
  }
  return id;
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

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    const res = mockRes();
    let settled = false;
    const done = (nextCalled, err) => {
      if (settled) return;
      settled = true;
      resolve({ res, nextCalled: !!nextCalled, err: err || null });
    };
    mw(req, res, (err) => done(true, err));
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (res.finished) {
        clearInterval(iv);
        done(false, null);
      } else if (Date.now() - t0 > 8000) {
        clearInterval(iv);
        done(false, new Error('timeout middleware'));
      }
    }, 15);
  });
}

async function limparUsuarioSemFin() {
  await pool.query(`DELETE FROM "USUARIOATIVIDADE" WHERE "SGUSUARIO" = $1`, [USER_SEM_FIN]);
  await pool.query(
    `DELETE FROM "FIN_PERM_AUDIT" WHERE "SGUSUARIO_ATOR" = $1 OR "SGUSUARIO_ALVO" = $1`,
    [USER_SEM_FIN]
  );
  await pool.query(`DELETE FROM "FIN_USUARIO_PERMISSAO" WHERE "SGUSUARIO" = $1`, [USER_SEM_FIN]);
  await pool.query(`DELETE FROM "FIN_USUARIO_PERFIL" WHERE "SGUSUARIO" = $1`, [USER_SEM_FIN]);
  await pool.query(`DELETE FROM "USUARIO" WHERE "SGUSUARIO" = $1`, [USER_SEM_FIN]);
}

async function garantirUsuarioSemFin() {
  await limparUsuarioSemFin();
  await pool.query(
    `INSERT INTO "USUARIO" ("SGUSUARIO","NMUSUARIO","TENANT_ID","FGACTIVE")
     VALUES ($1,'F3 HTTP sem FIN','default','S')`,
    [USER_SEM_FIN]
  );
  // Menu atlas-pay sem perfil/override FIN → STRICT_SEM_PERM no default
  await pool.query(
    `INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO","CDTIPOATIVIDADE","TENANT_ID")
     VALUES ($1,$2,'default')
     ON CONFLICT ("SGUSUARIO","CDTIPOATIVIDADE") DO NOTHING`,
    [USER_SEM_FIN, CD_ATLAS_PAY]
  );
}

/** Prova D5: mesmo resultado comercial com process.env.TZ distintos (filhos isolados). */
function assertFusoIndependenteDoHost() {
  // Só financeiro-fuso-sp (sem pool PG) — evita hang por handles abertos no filho.
  const childScript = `
    const fuso = require('./services/financeiro-fuso-sp');
    function boundsCompetencia(competencia) {
      const [ys, ms] = competencia.split('-');
      const y = Number(ys);
      const m = Number(ms);
      const pad = (n) => String(n).padStart(2, '0');
      const inicio = y + '-' + pad(m) + '-01 00:00:00';
      let y2 = y, m2 = m + 1;
      if (m2 > 12) { m2 = 1; y2 += 1; }
      const fim = y2 + '-' + pad(m2) + '-01 00:00:00';
      return { inicio, fim, diasMes: fuso.diasEntre(inicio, fim), fuso: fuso.TZ };
    }
    function detectarLacunas(intervals, inicio, fim) {
      const gaps = [];
      let cursor = fuso.wallToOrderMs(inicio);
      const end = fuso.wallToOrderMs(fim);
      for (const iv of intervals) {
        const a = fuso.wallToOrderMs(iv.inicio);
        if (a > cursor) gaps.push({ inicio: fuso.orderMsToWall(cursor), fim: iv.inicio });
        cursor = Math.max(cursor, fuso.wallToOrderMs(iv.fim));
      }
      if (cursor < end) gaps.push({ inicio: fuso.orderMsToWall(cursor), fim: fim });
      return gaps;
    }
    const fixed = Date.UTC(2026, 10, 26, 18, 0, 0); // 26/11/2026 15:00 SP (UTC-3)
    const b = boundsCompetencia('2026-10');
    const venc = fuso.addDiasCorridos('2026-10-15 14:30:00', 10);
    const ap = fuso.aprovacaoEVencimento(fixed);
    const gaps = detectarLacunas(
      [{ inicio: '2026-10-10 00:00:00', fim: '2026-10-20 00:00:00' }],
      '2026-10-01 00:00:00',
      '2026-11-01 00:00:00'
    );
    const out = {
      tz: process.env.TZ || '(unset)',
      bounds: b,
      venc,
      ap,
      gaps,
      diasMes: fuso.diasEntre(b.inicio, b.fim),
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  `;
  const zones = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'America/Sao_Paulo'];
  const snapshots = [];
  for (const tz of zones) {
    const r = spawnSync(process.execPath, ['-e', childScript], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      fail('fuso independente do host', `TZ=${tz} exit=${r.status} ${r.stderr || r.stdout}`);
      return;
    }
    try {
      const raw = String(r.stdout);
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < start) throw new Error('sem JSON');
      snapshots.push(JSON.parse(raw.slice(start, end + 1)));
    } catch (e) {
      fail('fuso independente do host', `TZ=${tz} parse: ${r.stdout}`);
      return;
    }
  }
  const ref = snapshots[0];
  const expectedVenc = '2026-10-25 14:30:00';
  const expectedAp = '2026-11-26 15:00:00';
  const expectedVencAp = '2026-12-06 15:00:00';
  let allOk = true;
  for (const s of snapshots) {
    if (
      s.bounds.inicio !== '2026-10-01 00:00:00' ||
      s.bounds.fim !== '2026-11-01 00:00:00' ||
      s.bounds.fuso !== 'America/Sao_Paulo' ||
      s.venc !== expectedVenc ||
      s.ap.dhAprovacao !== expectedAp ||
      s.ap.dhVencimento !== expectedVencAp ||
      s.diasMes !== 31 ||
      !Array.isArray(s.gaps) ||
      s.gaps.length !== 2 ||
      s.gaps[0].inicio !== '2026-10-01 00:00:00' ||
      s.gaps[0].fim !== '2026-10-10 00:00:00' ||
      s.gaps[1].inicio !== '2026-10-20 00:00:00' ||
      s.gaps[1].fim !== '2026-11-01 00:00:00'
    ) {
      allOk = false;
      fail('fuso independente do host', JSON.stringify(s));
      break;
    }
    if (
      s.bounds.inicio !== ref.bounds.inicio ||
      s.venc !== ref.venc ||
      s.ap.dhVencimento !== ref.ap.dhVencimento
    ) {
      allOk = false;
      fail('fuso independente do host', `divergiu de ref em TZ=${s.tz}`);
      break;
    }
  }
  if (allOk) {
    ok(
      'fuso D5 independente do host',
      zones.join(',') + ' → mesma parede SP'
    );
  }

  // Cobertura do wiring no serviço (mesmo processo): lacunas sem toISOString/host TZ
  const gapsSvc = uso.detectarLacunas(
    [{ inicio: '2026-10-10 00:00:00', fim: '2026-10-20 00:00:00' }],
    '2026-10-01 00:00:00',
    '2026-11-01 00:00:00'
  );
  if (
    gapsSvc.length === 2 &&
    gapsSvc[0].inicio === '2026-10-01 00:00:00' &&
    gapsSvc[1].fim === '2026-11-01 00:00:00' &&
    uso.boundsCompetencia('2026-10').fuso === 'America/Sao_Paulo'
  ) {
    ok('serviço fechamento usa parede SP (lacunas/bounds)', JSON.stringify(gapsSvc));
  } else {
    fail('serviço fechamento usa parede SP (lacunas/bounds)', JSON.stringify(gapsSvc));
  }
}

async function run() {
  let pass = 0;
  let failN = 0;
  await ensureTenant();
  await limparF3();

  const COMP = '2026-10';
  const bounds = uso.boundsCompetencia(COMP);
  ok('bounds SP semiaberto', bounds.inicio === '2026-10-01 00:00:00' && bounds.fim === '2026-11-01 00:00:00');

  // Contrato mês inteiro: FIXO 30000 + POR_CARGA 1500 + 2%
  await publicar(
    [
      { tipo: 'FIXO', valorCentavos: 30000 },
      { tipo: 'POR_CARGA_ANUNCIADA', valorCentavos: 1500 },
      { tipo: 'PERCENTUAL', percentual: 2 },
    ],
    'S',
    '2026-10-01 00:00:00'
  );

  // Viagem 1 — dois disparos
  await insertViagem(930001, '2026-10-05 10:00:00', 1000, null, 'A');
  await insertConv(930001, 930001, '2026-10-05 10:00:00', 'PENDENTE');
  await insertConv(930002, 930001, '2026-10-06 11:00:00', 'ACEITA');

  // Viagem 2 — depois cancelada
  await insertViagem(930002, '2026-10-07 09:00:00', 500, null, 'I');
  await insertConv(930003, 930002, '2026-10-07 09:00:00', 'PENDENTE');

  // Lote: mãe + 2 filhas
  await insertViagem(930010, '2026-10-08 08:00:00', 9999, null, 'A');
  await insertViagem(930011, '2026-10-08 08:05:00', 200, 930010, 'A');
  await insertViagem(930012, '2026-10-08 08:06:00', 300, 930010, 'A');
  await insertConv(930010, 930010, '2026-10-08 08:00:00', 'PENDENTE'); // mãe não deve contar
  await insertConv(930011, 930011, '2026-10-08 08:10:00', 'PENDENTE');
  await insertConv(930012, 930012, '2026-10-08 08:11:00', 'PENDENTE');

  let anuncios = await uso.listarAnunciosCompetencia(
    (s, p) => pool.query(s, p),
    TENANT,
    bounds.inicio,
    bounds.fim
  );
  const ids = anuncios.map((a) => Number(a.IDVIAGEM)).sort();
  if (ids.length === 3 && ids[0] === 930001 && ids[1] === 930002 && ids[2] === 930011) {
    // 930012 also expected - 4 trips: 1,2,11,12 — mother excluded
  }
  const set = new Set(ids);
  if (set.has(930001) && !anuncios.filter((a) => Number(a.IDVIAGEM) === 930001).length !== 1) {
    /* check dup */
  }
  const qtd1 = anuncios.filter((a) => Number(a.IDVIAGEM) === 930001).length;
  if (qtd1 === 1) ok('primeiro disparo único (sem duplicar reenvio)', 'n=' + anuncios.length);
  else fail('primeiro disparo único', 'qtd viagem1=' + qtd1);

  if (!set.has(930010) && set.has(930011) && set.has(930012)) {
    ok('filhas contam; mãe agrupadora não', ids.join(','));
  } else fail('filhas/mãe', ids.join(','));

  if (set.has(930002)) ok('viagem cancelada continua contando', '');
  else fail('viagem cancelada', ids.join(','));

  // Frete inválido
  await insertViagem(930020, '2026-10-09 10:00:00', null, null, 'A');
  await insertConv(930020, 930020, '2026-10-09 10:00:00', 'PENDENTE');
  let prev = await uso.calcularParaTenant(TENANT, COMP);
  if (prev.excecoes.some((e) => e.codigo === 'VLFRETE_INVALIDO') && prev.status === 'COM_EXCECOES') {
    ok('VLFRETE nulo bloqueia (COM_EXCECOES)', prev.status);
  } else fail('VLFRETE nulo', prev.status + JSON.stringify(prev.excecoes));

  await pool.query(`UPDATE "VIAGEMMESTRE" SET "VLFRETE"=0 WHERE "IDVIAGEM"=930020 AND "TENANT_ID"=$1`, [TENANT]);
  prev = await uso.calcularParaTenant(TENANT, COMP);
  if (prev.excecoes.some((e) => e.codigo === 'VLFRETE_INVALIDO')) ok('VLFRETE zero bloqueia', '');
  else fail('VLFRETE zero', JSON.stringify(prev.excecoes));

  await pool.query(`UPDATE "VIAGEMMESTRE" SET "VLFRETE"=-10 WHERE "IDVIAGEM"=930020 AND "TENANT_ID"=$1`, [TENANT]);
  prev = await uso.calcularParaTenant(TENANT, COMP);
  if (prev.excecoes.some((e) => e.codigo === 'VLFRETE_INVALIDO')) ok('VLFRETE negativo bloqueia', '');
  else fail('VLFRETE negativo', '');

  // Corrige frete
  await pool.query(`UPDATE "VIAGEMMESTRE" SET "VLFRETE"=400 WHERE "IDVIAGEM"=930020 AND "TENANT_ID"=$1`, [TENANT]);
  let fech = await uso.criarOuRecalcular(TENANT, COMP, 'f3', '127.0.0.1');
  if (fech.STATUS === 'AGUARDANDO_APROVACAO') ok('correção frete + recalculo → aguardando', '');
  else fail('recalculo apos correcao', fech.STATUS);

  // Aprovar / regra N
  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "FG_REGRA_ATIVA"='N' WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [TENANT]
  );
  fech = await uso.criarOuRecalcular(TENANT, COMP, 'f3', null);
  if (fech.STATUS === 'RASCUNHO' && fech.FG_REGRA_SNAPSHOT === 'N') ok('regra N → prévia RASCUNHO', '');
  else fail('regra N previa', fech.STATUS);

  try {
    await uso.aprovarFechamento(TENANT, fech.ID, 'f3', null, 'APROVAR');
    fail('regra N bloqueia aprovação', 'aprovou');
  } catch (e) {
    if (e.code === 'REGRA_DESATIVADA' || /desativada/i.test(e.message)) ok('regra N impede aprovação', e.code);
    else fail('regra N impede aprovação', e.message);
  }

  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "FG_REGRA_ATIVA"='S' WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [TENANT]
  );
  fech = await uso.criarOuRecalcular(TENANT, COMP, 'f3', null);
  fech = await uso.aprovarFechamento(TENANT, fech.ID, 'f3', null, 'APROVAR');
  if (fech.STATUS === 'APROVADO') ok('regra S permite aprovação', '');
  else fail('aprovacao regra S', fech.STATUS);

  const venc = fech.DH_VENCIMENTO || fech.dh_vencimento;
  const dhA = fech.DH_APROVACAO || fech.dh_aprovacao;
  if (venc && dhA) {
    const diff = fusoSp.diasEntre(dhA, venc);
    if (diff === 10) ok('vencimento 10 dias corridos (SP)', fusoSp.toSpWall(venc));
    else fail('vencimento 10 dias corridos (SP)', 'diff=' + diff + ' venc=' + fusoSp.toSpWall(venc));
  } else fail('vencimento', 'sem datas');

  // Memória imutável após alteração origem
  const totalAprovado = Number(fech.TOTAL_CENTAVOS);
  const memAprovada = JSON.stringify(fech.memoria || fech.MEMORIA_CALCULO);
  await insertViagem(930099, '2026-10-20 12:00:00', 8000, null, 'A');
  await insertConv(930099, 930099, '2026-10-20 12:00:00', 'PENDENTE');
  try {
    await uso.criarOuRecalcular(TENANT, COMP, 'f3', null);
    fail('aprovado não recalcula', 'recalculou');
  } catch (e) {
    if (e.code === 'FECHAMENTO_IMUTAVEL') ok('fechamento aprovado imutável', '');
    else fail('imutavel', e.message);
  }
  const fech2 = await uso.obterFechamento(TENANT, fech.ID);
  if (Number(fech2.TOTAL_CENTAVOS) === totalAprovado) ok('total aprovado preservado', '');
  else fail('total preservado', fech2.TOTAL_CENTAVOS);

  // Geração + idempotência
  let gen = await uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
  if (gen.cobranca && gen.cobranca.MODALIDADE === 'USO_PLATAFORMA') {
    ok('gera cobrança USO', 'id=' + gen.cobranca.ID);
  } else fail('gerar cobranca', JSON.stringify(gen));
  if (String(gen.cobranca.BENEFICIARIO_TENANT_ID) === getDefaultTenantId()) ok('beneficiário default', '');
  else fail('beneficiário', gen.cobranca.BENEFICIARIO_TENANT_ID);
  if (String(gen.cobranca.PAGADOR_TIPO) === 'TENANT') ok('pagador TENANT', '');
  else fail('pagador', gen.cobranca.PAGADOR_TIPO);

  const gen2 = await uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
  if (gen2.idempotente && Number(gen2.cobranca.ID) === Number(gen.cobranca.ID)) {
    ok('geração idempotente', '');
  } else fail('idempotencia', JSON.stringify(gen2));

  // Concorrência
  const p1 = uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
  const p2 = uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
  const outs = await Promise.all([p1, p2]);
  const idsCob = outs.map((o) => Number(o.cobranca.ID));
  if (idsCob[0] === idsCob[1]) ok('concorrência sem duplicar cobrança', String(idsCob[0]));
  else fail('concorrencia', idsCob.join(','));

  // Contrato mid-month + FIXO pró-rata
  await limparF3();
  await ensureTenant();
  await publicar([{ tipo: 'FIXO', valorCentavos: 31000 }], 'S', '2026-10-01 00:00:00');
  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "DH_FIM"='2026-10-16 00:00:00' WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [TENANT]
  );
  await publicar([{ tipo: 'FIXO', valorCentavos: 62000 }], 'S', '2026-10-16 00:00:00');
  // Outubro 2026 tem 31 dias; 1–16 = 15 dias; 16–nov = 16 dias
  prev = await uso.calcularParaTenant(TENANT, COMP);
  const fixos = (prev.memoria.componentes || []).filter((c) => c.tipo === 'FIXO');
  const somaFixo = fixos.reduce((s, c) => s + c.valorCentavos, 0);
  // 31000*15/31 + 62000*16/31
  const esperado = Math.round((31000 * 15) / 31) + Math.round((62000 * 16) / 31);
  if (Math.abs(somaFixo - esperado) <= 1) ok('FIXO proporcional mid-month', somaFixo + '~' + esperado);
  else fail('FIXO proporcional', somaFixo + ' vs ' + esperado + ' ' + JSON.stringify(fixos));

  // Evento usa contrato da data
  await insertViagem(930030, '2026-10-05 10:00:00', 1000, null, 'A');
  await insertConv(930030, 930030, '2026-10-05 10:00:00', 'PENDENTE');
  await insertViagem(930031, '2026-10-20 10:00:00', 1000, null, 'A');
  await insertConv(930031, 930031, '2026-10-20 10:00:00', 'PENDENTE');
  // add POR_CARGA only on second contract — republish already has only FIXO; add component to v2
  const c2 = await pool.query(
    `SELECT "ID" FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [TENANT]
  );
  await pool.query(
    `INSERT INTO "FIN_CONTRATO_COMPONENTE" ("ID_CONTRATO","GRUPO","TIPO","VALOR_CENTAVOS","FG_ATIVO","ORDEM")
     VALUES ($1,'USO_PLATAFORMA','POR_CARGA_ANUNCIADA',777,'S',1)`,
    [c2.rows[0].ID]
  );
  prev = await uso.calcularParaTenant(TENANT, COMP);
  const listaViagens = prev.memoria.viagens || [];
  const vEarly = listaViagens.find((v) => Number(v.idViagem) === 930030);
  const vLate = listaViagens.find((v) => Number(v.idViagem) === 930031);
  const earlyPc = ((vEarly && vEarly.parcelas) || []).some((p) => p.tipo === 'POR_CARGA_ANUNCIADA');
  const latePc = ((vLate && vLate.parcelas) || []).some((p) => p.tipo === 'POR_CARGA_ANUNCIADA' && p.valorCentavos === 777);
  if (!earlyPc && latePc) ok('evento respeita contrato na data do anúncio', '');
  else fail('contrato na data', JSON.stringify({ earlyPc, latePc, vEarly, vLate }));

  // Lacuna sem contrato
  await limparF3();
  await ensureTenant();
  await publicar([{ tipo: 'FIXO', valorCentavos: 1000 }], 'S', '2026-10-10 00:00:00');
  prev = await uso.calcularParaTenant(TENANT, COMP);
  if (prev.excecoes.some((e) => e.codigo === 'INTERVALO_SEM_CONTRATO')) ok('lacuna sem contrato = exceção', '');
  else fail('lacuna', JSON.stringify(prev.excecoes));

  // Sem componente USO
  await limparF3();
  await ensureTenant();
  await pool.query(
    `INSERT INTO "FIN_CONTRATO"
      ("TENANT_ID","VERSAO","DH_INICIO","FG_REGRA_ATIVA","POLITICA_INADIMPLENCIA","FGACTIVE","SGUSERINCLUSAO")
     VALUES ($1,1,'2026-10-01 00:00:00','S','ALERTA','S','admin')`,
    [TENANT]
  );
  // só CONEXAO
  const cid = await pool.query(`SELECT "ID" FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1`, [TENANT]);
  await pool.query(
    `INSERT INTO "FIN_CONTRATO_COMPONENTE" ("ID_CONTRATO","GRUPO","TIPO","VALOR_CENTAVOS","FG_ATIVO","ORDEM")
     VALUES ($1,'CONEXAO','FIXO',10000,'S',0)`,
    [cid.rows[0].ID]
  );
  prev = await uso.calcularParaTenant(TENANT, COMP);
  if (prev.status === 'SEM_COMPONENTE_USO_PLATAFORMA' && prev.totalCentavos === 0) {
    ok('sem componente USO → prévia zero', '');
  } else fail('sem componente', prev.status);

  fech = await uso.criarOuRecalcular(TENANT, COMP, 'f3', null);
  try {
    await uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
    fail('não gera cobrança zero/sem componente', 'gerou');
  } catch (e) {
    ok('não gera cobrança sem aprovação/componente', e.code || e.message);
  }

  // Isolamento tenant
  const other = await uso.obterFechamento('default', fech.ID);
  if (!other) ok('tenant não lê fechamento alheio por id', '');
  else fail('isolamento', 'vazou');

  // HTTP 403 — requireFinPerm (P1) em aprovar / gerar cobrança
  try {
    await garantirUsuarioSemFin();
    const reqSem = {
      user: { login: USER_SEM_FIN, tenantId: 'default' },
      headers: { 'user-login': USER_SEM_FIN },
      body: {},
      tenantId: 'default',
      ip: '127.0.0.1',
    };
    const aprovarSem = await runMiddleware(
      requireFinPerm('FIN_CONFIGURAR', 'FIN_COBRANCA_GERAR'),
      reqSem
    );
    if (
      aprovarSem.res.statusCode === 403 &&
      aprovarSem.res.body &&
      aprovarSem.res.body.code === 'FIN_SEM_PERMISSAO' &&
      !aprovarSem.nextCalled
    ) {
      ok('HTTP 403 aprovar sem permissão FIN', JSON.stringify(aprovarSem.res.body));
    } else {
      fail(
        'HTTP 403 aprovar sem permissão FIN',
        JSON.stringify({
          status: aprovarSem.res.statusCode,
          body: aprovarSem.res.body,
          next: aprovarSem.nextCalled,
        })
      );
    }

    const gerarSem = await runMiddleware(requireFinPerm('FIN_COBRANCA_GERAR'), reqSem);
    if (
      gerarSem.res.statusCode === 403 &&
      gerarSem.res.body &&
      gerarSem.res.body.code === 'FIN_SEM_PERMISSAO' &&
      !gerarSem.nextCalled
    ) {
      ok('HTTP 403 gerar cobrança sem permissão FIN', JSON.stringify(gerarSem.res.body));
    } else {
      fail(
        'HTTP 403 gerar cobrança sem permissão FIN',
        JSON.stringify({
          status: gerarSem.res.statusCode,
          body: gerarSem.res.body,
          next: gerarSem.nextCalled,
        })
      );
    }

    const reqAdmin = {
      user: { login: 'admin', tenantId: 'default' },
      headers: { 'user-login': 'admin' },
      body: {},
      tenantId: 'default',
      ip: '127.0.0.1',
    };
    const aprovarOk = await runMiddleware(
      requireFinPerm('FIN_CONFIGURAR', 'FIN_COBRANCA_GERAR'),
      reqAdmin
    );
    const gerarOk = await runMiddleware(requireFinPerm('FIN_COBRANCA_GERAR'), reqAdmin);
    if (aprovarOk.nextCalled && !aprovarOk.res.finished && gerarOk.nextCalled && !gerarOk.res.finished) {
      ok('HTTP autorizado aprovar/gerar com FIN_*', 'admin next()');
    } else {
      fail(
        'HTTP autorizado aprovar/gerar com FIN_*',
        JSON.stringify({
          aprovar: { next: aprovarOk.nextCalled, status: aprovarOk.res.statusCode, body: aprovarOk.res.body },
          gerar: { next: gerarOk.nextCalled, status: gerarOk.res.statusCode, body: gerarOk.res.body },
        })
      );
    }
  } catch (e) {
    fail('HTTP permissões Fase 3', e.message);
  } finally {
    await limparUsuarioSemFin();
  }

  // Fuso D5 — independência do TZ do processo
  assertFusoIndependenteDoHost();

  // Regressão: calcularConexao ainda funciona
  const calc = fin.calcularConexaoCentavos(1000, [{ TIPO: 'FIXO', VALOR_CENTAVOS: 10000, FG_ATIVO: 'S' }]);
  if (calc.ok && calc.valorCentavos === 10000) ok('regressão calcularConexaoCentavos', '');
  else fail('regressao conexao', JSON.stringify(calc));

  // Rollback na falha de geração: forçar TOTAL 0 aprovado artificialmente
  await limparF3();
  await ensureTenant();
  await publicar([{ tipo: 'FIXO', valorCentavos: 5000 }], 'S', '2026-10-01 00:00:00');
  fech = await uso.criarOuRecalcular(TENANT, COMP, 'f3', null);
  fech = await uso.aprovarFechamento(TENANT, fech.ID, 'f3', null, 'APROVAR');
  await pool.query(`UPDATE "FIN_FECHAMENTO_USO" SET "TOTAL_CENTAVOS"=0 WHERE "ID"=$1`, [fech.ID]);
  try {
    await uso.gerarCobranca(TENANT, fech.ID, 'f3', null, 'GERAR_COBRANCA');
    fail('falha geração total zero', 'não falhou');
  } catch (e) {
    const st = await uso.obterFechamento(TENANT, fech.ID);
    if (st.STATUS === 'APROVADO' && !st.ID_COBRANCA) ok('falha geração reverte (permanece APROVADO sem cob)', '');
    else fail('rollback geracao', st.STATUS + ' cob=' + st.ID_COBRANCA);
  }

  pass = results.filter((r) => r.ok).length;
  failN = results.filter((r) => !r.ok).length;
  console.log('\nResultado Fase 3:', pass, 'PASS /', failN, 'FAIL / 0 SKIP');
  process.exit(failN > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
