/**
 * Atlas Pay — D-01 (remoção motorista) + D-02 (origem desistência).
 * Tenant fixture atlas-pay-d01-test. Não altera default operacional.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { poolPromise, createTransaction } = require('../config/db');
const fin = require('../services/financeiro-cobranca.service');

const TENANT = 'atlas-pay-d01-test';
const TENANT_B = 'atlas-pay-d01-b';
const CD_MOT = 1;
const CD_MOT_B = 2;
const ID_VIAGEM = 910101;
const ID_VIAGEM_B = 910102;
const ID_CONV = 910201;
const ID_CONV_B = 910202;

let pool;
let passed = 0;
let failed = 0;
function ok(n, d) {
  passed += 1;
  console.log('OK  ', n, d || '');
}
function fail(n, d) {
  failed += 1;
  console.error('FAIL', n, d || '');
}

async function ensureTenants() {
  for (const tid of [TENANT, TENANT_B]) {
    await pool.query(
      `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID","NM_CLIENTE","CD_PLANO","FGACTIVE")
       VALUES ($1,$2,1,'S')
       ON CONFLICT ("TENANT_ID") DO NOTHING`,
      [tid, 'D01 ' + tid]
    ).catch(() => {});
  }
}

async function limparCobrancas(tid) {
  await pool.query(
    `UPDATE "FIN_COBRANCA" SET "STATUS"='CANCELADA', "DH_CANCELAMENTO"=CURRENT_TIMESTAMP,
            "SGUSER_CANCELAMENTO"='d01', "DS_CANCELAMENTO"='limpeza', "ORIGEM_CANCELAMENTO"='SISTEMA'
      WHERE "TENANT_ID"=$1 AND "STATUS" IN ('ABERTA','PAGA')`,
    [tid]
  );
}

async function publicar(tenantId, fgRegra) {
  await pool.query(
    `UPDATE "FIN_CONTRATO" SET "DH_FIM"=CURRENT_TIMESTAMP WHERE "TENANT_ID"=$1 AND "DH_FIM" IS NULL`,
    [tenantId]
  );
  const ver = await pool.query(
    `SELECT COALESCE(MAX("VERSAO"),0)+1 AS v FROM "FIN_CONTRATO" WHERE "TENANT_ID"=$1`,
    [tenantId]
  );
  const ins = await pool.query(
    `INSERT INTO "FIN_CONTRATO"
      ("TENANT_ID","VERSAO","DH_INICIO","DH_FIM","FG_REGRA_ATIVA","POLITICA_INADIMPLENCIA","FGACTIVE","SGUSERINCLUSAO")
     VALUES ($1,$2,CURRENT_TIMESTAMP,NULL,$3,'ALERTA','S','d01')
     RETURNING "ID"`,
    [tenantId, ver.rows[0].v, fgRegra]
  );
  await pool.query(
    `INSERT INTO "FIN_CONTRATO_COMPONENTE"
      ("ID_CONTRATO","GRUPO","TIPO","VALOR_CENTAVOS","FG_ATIVO","ORDEM")
     VALUES ($1,'CONEXAO','FIXO',5000,'S',0)`,
    [ins.rows[0].ID]
  );
}

async function upsertViagem(idViagem, tenantId) {
  await pool.query(
    `INSERT INTO "VIAGEMMESTRE"
      ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","TENANT_ID","DHINCLUSAO","VLFRETE","FGACTIVE","FGRASTREADO","SGUSERINCLUSAO")
     VALUES ($1,1,'A',$2,CURRENT_TIMESTAMP,1000,'A','N','admin')
     ON CONFLICT ("IDVIAGEM") DO UPDATE SET
       "TENANT_ID"=EXCLUDED."TENANT_ID",
       "VLFRETE"=EXCLUDED."VLFRETE",
       "FGACTIVE"='A'`,
    [idViagem, tenantId]
  );
}

async function upsertConv(idConv, idViagem, cdMot, status, tenantId) {
  await upsertViagem(idViagem, tenantId);
  await pool.query(
    `INSERT INTO "CONVOCACAO"
      ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","STATUS","DHCONVOCACAO","SGUSUARIO_OPERADOR","TENANT_ID","DHENVIOMETA")
     VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,'admin',$5,CURRENT_TIMESTAMP)
     ON CONFLICT ("IDCONVOCACAO") DO UPDATE SET
       "IDVIAGEM"=EXCLUDED."IDVIAGEM",
       "CDCADASTRO_MOTORISTA"=EXCLUDED."CDCADASTRO_MOTORISTA",
       "STATUS"=EXCLUDED."STATUS",
       "TENANT_ID"=EXCLUDED."TENANT_ID"`,
    [idConv, idViagem, cdMot, status, tenantId]
  );
}

async function criarCob(idConv, idViagem, cdMot, tenantId, ciclo) {
  const tx = await createTransaction(pool);
  await tx.begin();
  try {
    const r = await fin.criarCobrancaConexaoNaConfirmacao(tx, {
      tenantId,
      idConvocacao: idConv,
      idViagem,
      cdMotorista: cdMot,
      vlFrete: 1000,
      usuario: 'admin',
      idCicloConfirmacao: ciclo || 'd01-' + Date.now() + '-' + idConv,
    });
    await tx.commit();
    return r;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

async function main() {
  pool = await poolPromise;
  await ensureTenants();
  await limparCobrancas(TENANT);
  await limparCobrancas(TENANT_B);
  await publicar(TENANT, 'S');
  await publicar(TENANT_B, 'S');

  // D-02 normalização
  if (fin.normalizarOrigemCancelamento('MOTORISTA', { permitirSistema: false }) === 'MOTORISTA') {
    ok('D-02 normaliza MOTORISTA', '');
  } else fail('D-02 MOTORISTA', '');
  if (fin.normalizarOrigemCancelamento('SISTEMA', { permitirSistema: false }) === 'TORRE') {
    ok('D-02 HTTP rejeita SISTEMA→TORRE', '');
  } else fail('D-02 SISTEMA', '');
  if (fin.normalizarOrigemCancelamento('x', { permitirSistema: false }) === 'TORRE') {
    ok('D-02 estranho→TORRE', '');
  } else fail('D-02 estranho', '');

  const viagSrc = fs.readFileSync(
    path.join(__dirname, '../public/modulos/gerenciar-viagens/js/script.js'),
    'utf8'
  );
  if (/selectOrigemDesistencia/.test(viagSrc) && /origemDesistencia/.test(viagSrc)) {
    ok('D-02 UI envia origemDesistencia', '');
  } else fail('D-02 UI', '');

  const ctrlSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/viagemmestre.controller.js'),
    'utf8'
  );
  if (/cancelarCobrancasConexaoAoRemoverMotorista/.test(ctrlSrc)) {
    ok('D-01 controller chama cancel na remoção', '');
  } else fail('D-01 controller', '');

  // 1. ABERTA
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  let r1;
  try {
    r1 = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-1-' + Date.now());
  } catch (e) {
    fail('1. seed', e.message);
  }
  if (r1 && r1.gerou) {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const c = await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
        tenantId: TENANT,
        idViagem: ID_VIAGEM,
        cdMotorista: CD_MOT,
        usuario: 'admin',
        origem: 'TORRE',
      });
      await tx.commit();
      const cob = await fin.obterCobranca(TENANT, r1.cobranca.ID);
      if (c.canceladas >= 1 && cob.STATUS === 'CANCELADA') ok('1. remoção ABERTA cancela', '');
      else fail('1. remoção ABERTA', cob.STATUS + ' n=' + c.canceladas);
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('1. remoção ABERTA', e.message);
    }
  }

  // 2. PAGA + MOTORISTA
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  let r2;
  try {
    r2 = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-2-' + Date.now());
    await fin.baixarCobrancaManual(TENANT, r2.cobranca.ID, 'admin', 'd01', '127.0.0.1');
  } catch (e) {
    fail('2. seed', e.message);
  }
  if (r2 && r2.gerou) {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const c = await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
        tenantId: TENANT,
        idViagem: ID_VIAGEM,
        cdMotorista: CD_MOT,
        usuario: 'admin',
        origem: 'MOTORISTA',
        motivo: 'Motorista desistiu',
      });
      await tx.commit();
      const cob = await fin.obterCobranca(TENANT, r2.cobranca.ID);
      const tipos = (cob.eventos || []).map((e) => e.TIPO);
      if (
        c.canceladas >= 1 &&
        cob.STATUS === 'CANCELADA' &&
        tipos.includes('REVERSAO_BAIXA') &&
        cob.ORIGEM_CANCELAMENTO === 'MOTORISTA'
      ) {
        ok('2. remoção PAGA + origem MOTORISTA', tipos.join(','));
      } else fail('2. PAGA', JSON.stringify({ st: cob.STATUS, tipos, o: cob.ORIGEM_CANCELAMENTO }));
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('2. PAGA', e.message);
    }
  }

  // 3. Substituição — cancela só A
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  await upsertConv(ID_CONV_B, ID_VIAGEM_B, CD_MOT_B, 'CONFIRMADA', TENANT);
  let rA;
  let rB;
  try {
    rA = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-3a-' + Date.now());
    rB = await criarCob(ID_CONV_B, ID_VIAGEM_B, CD_MOT_B, TENANT, 'd01-3b-' + Date.now());
  } catch (e) {
    fail('3. seed', e.message);
  }
  if (rA && rB && rA.gerou && rB.gerou) {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
        tenantId: TENANT,
        idViagem: ID_VIAGEM,
        cdMotorista: CD_MOT,
        usuario: 'admin',
        origem: 'TORRE',
      });
      await tx.commit();
      const a = await fin.obterCobranca(TENANT, rA.cobranca.ID);
      const b = await fin.obterCobranca(TENANT, rB.cobranca.ID);
      if (a.STATUS === 'CANCELADA' && b.STATUS === 'ABERTA') {
        ok('3. substituição sem cancelar indevido', 'A cancelada / B aberta');
      } else fail('3. substituição', `A=${a.STATUS} B=${b.STATUS}`);
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('3. substituição', e.message);
    }
  }

  // 4. Sem CONFIRMADA
  {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const c = await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
        tenantId: TENANT,
        idViagem: ID_VIAGEM,
        cdMotorista: 999888,
        usuario: 'admin',
        origem: 'TORRE',
      });
      await tx.rollback();
      if (c.canceladas === 0) ok('4. remoção sem cobrança/CONFIRMADA → 0', '');
      else fail('4. sem cobrança', String(c.canceladas));
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('4. sem cobrança', e.message);
    }
  }

  // 5. TORRE / 6. MOTORISTA via cancel direto (reativar/desistir)
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  try {
    const r5 = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-5-' + Date.now());
    const tx = await createTransaction(pool);
    await tx.begin();
    await fin.cancelarCobrancaConexaoNaTransacao(tx, {
      tenantId: TENANT,
      idConvocacao: ID_CONV,
      usuario: 'admin',
      motivo: 'Torre',
      origem: fin.normalizarOrigemCancelamento('TORRE', { permitirSistema: false }),
    });
    await tx.commit();
    const cob = await fin.obterCobranca(TENANT, r5.cobranca.ID);
    if (cob.ORIGEM_CANCELAMENTO === 'TORRE') ok('5. desistência torre', '');
    else fail('5. torre', cob.ORIGEM_CANCELAMENTO);
  } catch (e) {
    fail('5. torre', e.message);
  }

  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  try {
    const r6 = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-6-' + Date.now());
    const tx = await createTransaction(pool);
    await tx.begin();
    await fin.cancelarCobrancaConexaoNaTransacao(tx, {
      tenantId: TENANT,
      idConvocacao: ID_CONV,
      usuario: 'admin',
      motivo: 'Mot',
      origem: fin.normalizarOrigemCancelamento('MOTORISTA', { permitirSistema: false }),
    });
    await tx.commit();
    const cob = await fin.obterCobranca(TENANT, r6.cobranca.ID);
    if (cob.ORIGEM_CANCELAMENTO === 'MOTORISTA') ok('6. desistência motorista', '');
    else fail('6. motorista', cob.ORIGEM_CANCELAMENTO);
  } catch (e) {
    fail('6. motorista', e.message);
  }

  // 7 / 8 wiring
  const iReat = ctrlSrc.indexOf('reativarConvocacao:');
  const iReatCanc = ctrlSrc.indexOf('cancelarCobrancaConexaoNaTransacao', iReat);
  const iDes = ctrlSrc.indexOf('desistirLote:');
  const iDesCanc = ctrlSrc.indexOf('cancelarCobrancaConexaoNaTransacao', iDes);
  if (iReat >= 0 && iReatCanc > iReat && iReatCanc - iReat < 20000) {
    ok('7. reativação cancela cobrança', '');
  } else fail('7. reativar', `iReat=${iReat} iCanc=${iReatCanc}`);
  if (iDes >= 0 && iDesCanc > iDes && iDesCanc - iDes < 5000) {
    ok('8. desistência de lote cancela', '');
  } else fail('8. lote', `iDes=${iDes} iCanc=${iDesCanc}`);

  // 9. Idempotência
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  try {
    await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-9-' + Date.now());
    const tx1 = await createTransaction(pool);
    await tx1.begin();
    const c1 = await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx1, {
      tenantId: TENANT,
      idViagem: ID_VIAGEM,
      cdMotorista: CD_MOT,
      usuario: 'admin',
      origem: 'TORRE',
    });
    await tx1.commit();
    const tx2 = await createTransaction(pool);
    await tx2.begin();
    const c2 = await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx2, {
      tenantId: TENANT,
      idViagem: ID_VIAGEM,
      cdMotorista: CD_MOT,
      usuario: 'admin',
      origem: 'TORRE',
    });
    await tx2.commit();
    if (c1.canceladas >= 1 && c2.canceladas === 0) ok('9. idempotência', `c1=${c1.canceladas} c2=0`);
    else fail('9. idempotência', JSON.stringify({ c1, c2 }));
  } catch (e) {
    fail('9. idempotência', e.message);
  }

  // 10. Isolamento
  await limparCobrancas(TENANT);
  await limparCobrancas(TENANT_B);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  try {
    const rA = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-10a-' + Date.now());
    const rB = await criarCob(ID_CONV + 50, ID_VIAGEM, CD_MOT, TENANT_B, 'd01-10b-' + Date.now());
    // Tenant B sem CONFIRMADA no SELECT do remover (conv no tenant A) — cob B permanece
    const tx = await createTransaction(pool);
    await tx.begin();
    await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
      tenantId: TENANT,
      idViagem: ID_VIAGEM,
      cdMotorista: CD_MOT,
      usuario: 'admin',
      origem: 'TORRE',
    });
    await tx.commit();
    const a = await fin.obterCobranca(TENANT, rA.cobranca.ID);
    const b = await fin.obterCobranca(TENANT_B, rB.cobranca.ID);
    const leak = await fin.obterCobranca(TENANT, rB.cobranca.ID);
    if (a.STATUS === 'CANCELADA' && b.STATUS === 'ABERTA' && !leak) ok('10. isolamento tenant', '');
    else fail('10. isolamento', JSON.stringify({ a: a && a.STATUS, b: b && b.STATUS, leak: !!leak }));
  } catch (e) {
    fail('10. isolamento', e.message);
  }

  // 11. Eventos
  await limparCobrancas(TENANT);
  await upsertConv(ID_CONV, ID_VIAGEM, CD_MOT, 'CONFIRMADA', TENANT);
  try {
    const r11 = await criarCob(ID_CONV, ID_VIAGEM, CD_MOT, TENANT, 'd01-11-' + Date.now());
    await fin.baixarCobrancaManual(TENANT, r11.cobranca.ID, 'admin', 'evt', '127.0.0.1');
    const tx = await createTransaction(pool);
    await tx.begin();
    await fin.cancelarCobrancasConexaoAoRemoverMotorista(tx, {
      tenantId: TENANT,
      idViagem: ID_VIAGEM,
      cdMotorista: CD_MOT,
      usuario: 'admin',
      origem: 'TORRE',
    });
    await tx.commit();
    const cob = await fin.obterCobranca(TENANT, r11.cobranca.ID);
    const tipos = (cob.eventos || []).map((e) => e.TIPO);
    if (
      tipos.includes('CRIADA') &&
      tipos.includes('BAIXA_MANUAL') &&
      tipos.includes('REVERSAO_BAIXA') &&
      tipos.includes('CANCELADA')
    ) {
      ok('11. eventos preservados', tipos.join(','));
    } else fail('11. eventos', tipos.join(','));
  } catch (e) {
    fail('11. eventos', e.message);
  }

  await limparCobrancas(TENANT);
  await limparCobrancas(TENANT_B);

  console.log('\nResultado D-01/D-02:', `${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
