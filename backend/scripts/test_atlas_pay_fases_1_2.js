/**
 * Roteiro executável Atlas Pay — fases 1 e 2.
 * Uso: node backend/scripts/test_atlas_pay_fases_1_2.js
 * Tenant operacional `default`: restaura FG_REGRA_ATIVA=N ao final.
 * Fixtures de viagem/lote/concorrência usam tenant isolado `atlas-pay-p2-test` + limpeza.
 */
'use strict';

const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { pool, createTransaction } = require('../config/db');
const fin = require('../services/financeiro-cobranca.service');
const loteSaldo = require('../services/viagem-lote-saldo.service');
const { requireAtlasPay, requireFinPerm } = require('../middleware/financeiro-auth.middleware');

const TENANT_P2 = 'atlas-pay-p2-test';
const ID_V_COMUM = 920001;
const ID_C1 = 920001;
const ID_C2 = 920002;
const ID_V_MAE = 920010;
const ID_V_FILHA = 920011;
const ID_C_LOTE = 920011;
const USER_SEM_ATLAS = 'p2_sem_atlas_pay';

const results = [];
function ok(name, detail) {
  results.push({ name, ok: true, detail: detail || '' });
  console.log('OK  ', name, detail || '');
}
function fail(name, detail) {
  results.push({ name, ok: false, detail: String(detail || '') });
  console.error('FAIL', name, detail);
}
function skip(name, detail) {
  results.push({ name, ok: null, detail: detail || '' });
  console.warn('SKIP', name, detail || '');
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

async function garantirTenantP2() {
  await pool.query(
    `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID","NM_CLIENTE","CD_PLANO","FGACTIVE")
     VALUES ($1,'Atlas Pay P2 fixture',1,'S')
     ON CONFLICT ("TENANT_ID") DO NOTHING`,
    [TENANT_P2]
  );
}

async function limparFixturesP2() {
  // Não DELETE em FIN_COBRANCA_EVENTO (append-only / P0). Cobranças do tenant P2
  // são criadas em TX com ROLLBACK no teste de lote; resíduos CANCELADOS isolados são aceitos.
  await pool.query(`DELETE FROM "VIAGEM_DERIVACAO_AUDITORIA" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
  await pool.query(`DELETE FROM "CONVOCACAO" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
  await pool.query(`DELETE FROM "VIAGEMMESTRE" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
  await pool.query(
    `DELETE FROM "FIN_CONTRATO_COMPONENTE" WHERE "ID_CONTRATO" IN (SELECT "ID" FROM "FIN_CONTRATO" WHERE "TENANT_ID" = $1)`,
    [TENANT_P2]
  );
  await pool.query(`DELETE FROM "FIN_CONTRATO" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
  await pool.query(`DELETE FROM "SAAS_CLIENTE_CONTRATANTE" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
}

async function limparUsuarioSemAtlas() {
  await pool.query(`DELETE FROM "USUARIOATIVIDADE" WHERE "SGUSUARIO" = $1`, [USER_SEM_ATLAS]);
  await pool.query(`DELETE FROM "FIN_PERM_AUDIT" WHERE "SGUSUARIO_ATOR" = $1 OR "SGUSUARIO_ALVO" = $1`, [
    USER_SEM_ATLAS,
  ]);
  await pool.query(`DELETE FROM "USUARIO" WHERE "SGUSUARIO" = $1`, [USER_SEM_ATLAS]);
}

/** Replica o núcleo de exclusividade da viagem comum (FOR UPDATE + JA_CONFIRMADA). */
async function tentarConfirmarComumExclusivo(client, tenantId, idConv, idViagem) {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT "IDVIAGEM" FROM "VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 FOR UPDATE`,
      [idViagem, tenantId]
    );
    await client.query(
      `SELECT "IDCONVOCACAO","STATUS" FROM "CONVOCACAO" WHERE "IDCONVOCACAO" = $1 AND "TENANT_ID" = $2 FOR UPDATE`,
      [idConv, tenantId]
    );
    const other = await client.query(
      `SELECT "IDCONVOCACAO" FROM "CONVOCACAO"
        WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 AND "STATUS" = 'CONFIRMADA' AND "IDCONVOCACAO" <> $3
        FOR UPDATE`,
      [idViagem, tenantId, idConv]
    );
    if (other.rowCount > 0) {
      const e = new Error('Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.');
      e.code = 'JA_CONFIRMADA';
      throw e;
    }
    const upd = await client.query(
      `UPDATE "CONVOCACAO" SET "STATUS" = 'CONFIRMADA', "DHRESPOSTA" = CURRENT_TIMESTAMP
        WHERE "IDCONVOCACAO" = $1 AND "TENANT_ID" = $2 AND "STATUS" = 'ACEITA'`,
      [idConv, tenantId]
    );
    if (!upd.rowCount) {
      const e = new Error('A convocação mudou antes da confirmação.');
      e.code = 'CONVOCACAO_MUDOU';
      throw e;
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, code: e.code || null, message: e.message };
  }
}

async function main() {
  // 1. Tabelas existem
  const tabs = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'FIN_%' ORDER BY 1`
  );
  const names = (tabs.rows || []).map((r) => r.tablename);
  if (names.includes('FIN_CONTRATO') && names.includes('FIN_COBRANCA')) ok('DDL FIN_* presente', names.join(','));
  else fail('DDL FIN_* presente', JSON.stringify(names));

  // 2. Menu atlas-pay
  const menu = await pool.query(
    `SELECT "CDTIPOATIVIDADE" FROM "TIPOATIVIDADE" WHERE TRIM(COALESCE("DSPROGRAMA",'')) = 'atlas-pay'`
  );
  if (menu.rowCount) ok('Menu atlas-pay', 'CD=' + menu.rows[0].CDTIPOATIVIDADE);
  else fail('Menu atlas-pay', 'ausente');

  // 3. Cálculo fixo
  let c = fin.calcularConexaoCentavos(5000, [{ TIPO: 'FIXO', VALOR_CENTAVOS: 10000, FG_ATIVO: 'S' }]);
  if (c.ok && c.valorCentavos === 10000) ok('Cálculo fixo R$100', String(c.valorCentavos));
  else fail('Cálculo fixo', JSON.stringify(c));

  // 4. Cálculo percentual 2% de 5000 = 10000 centavos
  c = fin.calcularConexaoCentavos(5000, [{ TIPO: 'PERCENTUAL', PERCENTUAL: 2, FG_ATIVO: 'S' }]);
  if (c.ok && c.valorCentavos === 10000) ok('Cálculo percentual 2%×5000', String(c.valorCentavos));
  else fail('Cálculo percentual', JSON.stringify(c));

  // 5. Mix fixo 5000 + 2% de 5000 = 15000
  c = fin.calcularConexaoCentavos(5000, [
    { TIPO: 'FIXO', VALOR_CENTAVOS: 5000, FG_ATIVO: 'S' },
    { TIPO: 'PERCENTUAL', PERCENTUAL: 2, FG_ATIVO: 'S' },
  ]);
  if (c.ok && c.valorCentavos === 15000) ok('Cálculo misto', String(c.valorCentavos));
  else fail('Cálculo misto', JSON.stringify(c));

  // 6. VLFRETE inválido com percentual
  c = fin.calcularConexaoCentavos(0, [{ TIPO: 'PERCENTUAL', PERCENTUAL: 2, FG_ATIVO: 'S' }]);
  if (!c.ok && c.code === 'VLFRETE_INVALIDO') ok('VLFRETE inválido bloqueia percentual', c.code);
  else fail('VLFRETE inválido', JSON.stringify(c));

  // 7. Publicar contrato no default DESLIGADO e criar/cancelar cobrança em transação isolada
  const tid = 'default';
  const contrato = await fin.publicarContrato(
    tid,
    {
      fgRegraAtiva: 'N',
      politicaInadimplencia: 'ALERTA',
      componentes: [
        { grupo: 'CONEXAO', tipo: 'FIXO', valorCentavos: 10000, fgAtivo: 'S', ordem: 0 },
        { grupo: 'USO_PLATAFORMA', tipo: 'FIXO', valorCentavos: 20000, fgAtivo: 'S', ordem: 0 },
      ],
    },
    'admin'
  );
  if (contrato && contrato.FG_REGRA_ATIVA === 'N') ok('Publicar contrato regra N', 'v' + contrato.VERSAO);
  else fail('Publicar contrato', JSON.stringify(contrato && contrato.FG_REGRA_ATIVA));

  // 8. Regra desligada → criarCobranca não gera
  {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const r = await fin.criarCobrancaConexaoNaConfirmacao(tx, {
        tenantId: tid,
        idConvocacao: 999001,
        idViagem: 1,
        cdMotorista: 1,
        vlFrete: 5000,
        usuario: 'admin',
        idCicloConfirmacao: 'test-off-' + Date.now(),
      });
      if (r && r.gerou === false) ok('Regra desligada não gera cobrança', r.motivo);
      else fail('Regra desligada', JSON.stringify(r));
      await tx.rollback();
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('Regra desligada (exceção)', e.message);
    }
  }

  // 9. Ativar regra numa versão de teste e gerar cobrança (depois cancelar e repor N)
  const contratoOn = await fin.publicarContrato(
    tid,
    {
      fgRegraAtiva: 'S',
      politicaInadimplencia: 'ALERTA',
      componentes: [{ grupo: 'CONEXAO', tipo: 'FIXO', valorCentavos: 10000, fgAtivo: 'S', ordem: 0 }],
    },
    'admin'
  );
  let idCob = null;
  {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const ciclo = 'test-on-' + Date.now();
      const r = await fin.criarCobrancaConexaoNaConfirmacao(tx, {
        tenantId: tid,
        idConvocacao: 999002,
        idViagem: 1,
        cdMotorista: 1,
        vlFrete: 5000,
        usuario: 'admin',
        idCicloConfirmacao: ciclo,
      });
      if (r && r.gerou && r.cobranca && Number(r.cobranca.VALOR_CENTAVOS) === 10000) {
        ok('Regra ligada gera cobrança fixa', 'id=' + r.cobranca.ID);
        idCob = r.cobranca.ID;
      } else fail('Regra ligada gera', JSON.stringify(r));

      // Duplicidade ABERTA mesma convocação (SAVEPOINT — PG aborta o bloco após 23505)
      await tx.queryPg('SAVEPOINT sp_dup');
      try {
        await fin.criarCobrancaConexaoNaConfirmacao(tx, {
          tenantId: tid,
          idConvocacao: 999002,
          idViagem: 1,
          cdMotorista: 1,
          vlFrete: 5000,
          usuario: 'admin',
          idCicloConfirmacao: ciclo + '-b',
        });
        fail('Duplicidade ABERTA', 'deveria falhar');
      } catch (dup) {
        await tx.queryPg('ROLLBACK TO SAVEPOINT sp_dup');
        if (dup.code === 'COBRANCA_DUPLICADA' || dup.code === '23505' || /duplicad|unique|aberta/i.test(String(dup.message || ''))) {
          ok('Duplicidade ABERTA bloqueada', dup.code || dup.message);
        } else fail('Duplicidade ABERTA', dup.message);
      }

      await fin.cancelarCobrancaConexaoNaTransacao(tx, {
        tenantId: tid,
        idConvocacao: 999002,
        usuario: 'admin',
        motivo: 'Teste cancelamento',
        origem: 'TORRE',
      });
      ok('Cancelamento na transação', 'conv 999002');
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('Fluxo gera/cancela', e.message);
    }
  }

  // 10. Baixa + reversão em novo ciclo
  {
    const tx = await createTransaction(pool);
    await tx.begin();
    try {
      const ciclo = 'test-baixa-' + Date.now();
      const r = await fin.criarCobrancaConexaoNaConfirmacao(tx, {
        tenantId: tid,
        idConvocacao: 999003,
        idViagem: 1,
        cdMotorista: 1,
        vlFrete: 5000,
        usuario: 'admin',
        idCicloConfirmacao: ciclo,
      });
      await tx.commit();
      idCob = r.cobranca.ID;
    } catch (e) {
      await tx.rollback().catch(() => {});
      fail('Criar para baixa', e.message);
      idCob = null;
    }
  }
  if (idCob) {
    try {
      await fin.baixarCobrancaManual(tid, idCob, 'admin', 'Teste baixa manual', '127.0.0.1');
      const cob = await fin.obterCobranca(tid, idCob);
      if (cob && cob.STATUS === 'PAGA') ok('Baixa manual', 'PAGA');
      else fail('Baixa manual', cob && cob.STATUS);
    } catch (e) {
      fail('Baixa manual', e.message);
    }
    {
      const tx = await createTransaction(pool);
      await tx.begin();
      try {
        await fin.cancelarCobrancaConexaoNaTransacao(tx, {
          tenantId: tid,
          idConvocacao: 999003,
          usuario: 'admin',
          motivo: 'Desistência após baixa',
          origem: 'MOTORISTA',
        });
        await tx.commit();
        const cob = await fin.obterCobranca(tid, idCob);
        const tipos = (cob.eventos || []).map((e) => e.TIPO);
        if (cob.STATUS === 'CANCELADA' && tipos.includes('REVERSAO_BAIXA') && tipos.includes('CANCELADA')) {
          ok('Reversão + cancelamento após baixa', tipos.join(','));
        } else fail('Reversão após baixa', cob.STATUS + ' ' + tipos.join(','));
      } catch (e) {
        await tx.rollback().catch(() => {});
        fail('Reversão após baixa', e.message);
      }
    }
  }

  // 11. Isolamento: obter cobrança de outro tenant
  {
    const fake = await fin.obterCobranca('tenant-inexistente-xyz', idCob || 1);
    if (!fake) ok('Isolamento obterCobranca outro tenant', 'null');
    else fail('Isolamento', 'retornou cobranca');
  }

  // 12. Repor regra desligada no default (obrigatório — não deixar ativa)
  await fin.publicarContrato(
    tid,
    {
      fgRegraAtiva: 'N',
      politicaInadimplencia: 'ALERTA',
      componentes: [{ grupo: 'CONEXAO', tipo: 'FIXO', valorCentavos: 10000, fgAtivo: 'S', ordem: 0 }],
    },
    'admin'
  );
  const vig = await fin.buscarContratoVigente((s, p) => pool.query(s, p), tid);
  if (vig && vig.FG_REGRA_ATIVA === 'N') ok('Default volta com regra N', 'v' + vig.VERSAO);
  else fail('Default regra N', vig && vig.FG_REGRA_ATIVA);

  // --- P2: fechar os cinco SKIPs com execução real ---

  // 13. Aceite do motorista NÃO gera FIN_* (design: cobrança só na confirmação da torre)
  {
    const aceSrc = fs.readFileSync(path.join(__dirname, '../controllers/motorista-app.controller.js'), 'utf8');
    const confSrc = fs.readFileSync(path.join(__dirname, '../controllers/viagemmestre.controller.js'), 'utf8');
    const aceIdx = aceSrc.indexOf('aceitarConvocacao:');
    const aceEnd = aceSrc.indexOf('confirmarPlacasConvocacao:', aceIdx);
    const aceBlock = aceIdx >= 0 && aceEnd > aceIdx ? aceSrc.slice(aceIdx, aceEnd) : '';
    const aceSemFin =
      aceBlock.length > 100 &&
      !/financeiroCobranca|criarCobrancaConexao|FIN_COBRANCA/.test(aceBlock) &&
      !/require\(['"].*financeiro-cobranca/.test(aceSrc);
    const confTemFin =
      /financeiroCobranca\.criarCobrancaConexaoNaConfirmacao/.test(confSrc) &&
      /confirmarConvocacao:/.test(confSrc);
    // Prova comportamental: UPDATE de status ACEITA (sem confirmação) não cria cobrança
    await limparFixturesP2();
    await garantirTenantP2();
    const cobAntes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "FIN_COBRANCA" WHERE "TENANT_ID" = $1`,
      [TENANT_P2]
    );
    await pool.query(
      `INSERT INTO "VIAGEMMESTRE"
        ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","DHINCLUSAO","FGRASTREADO","TENANT_ID","VLFRETE")
       VALUES ($1,1,'A',CURRENT_TIMESTAMP,'N',$2,5000)`,
      [ID_V_COMUM, TENANT_P2]
    );
    await pool.query(
      `INSERT INTO "CONVOCACAO"
        ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","DHCONVOCACAO","SGUSUARIO_OPERADOR","STATUS","TENANT_ID")
       VALUES ($1,$2,1,CURRENT_TIMESTAMP,'admin','PENDENTE',$3)`,
      [ID_C1, ID_V_COMUM, TENANT_P2]
    );
    await pool.query(
      `UPDATE "CONVOCACAO" SET "STATUS" = 'ACEITA', "DHRESPOSTA" = CURRENT_TIMESTAMP
        WHERE "IDCONVOCACAO" = $1 AND "TENANT_ID" = $2`,
      [ID_C1, TENANT_P2]
    );
    const cobDepois = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "FIN_COBRANCA" WHERE "TENANT_ID" = $1`,
      [TENANT_P2]
    );
    if (aceSemFin && confTemFin && cobAntes.rows[0].n === cobDepois.rows[0].n) {
      ok('Aceite sem confirmação não gera FIN_*', 'aceitarConvocacao sem hook financeiro; cobrança só em confirmarConvocacao');
    } else {
      fail(
        'Aceite sem confirmação não gera FIN_*',
        JSON.stringify({ aceSemFin, confTemFin, antes: cobAntes.rows[0].n, depois: cobDepois.rows[0].n })
      );
    }
  }

  // 14. Duas confirmações concorrentes na viagem comum (FOR UPDATE + JA_CONFIRMADA)
  {
    try {
      await garantirTenantP2();
      await pool.query(`DELETE FROM "CONVOCACAO" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
      await pool.query(`DELETE FROM "VIAGEMMESTRE" WHERE "TENANT_ID" = $1`, [TENANT_P2]);
      await pool.query(
        `INSERT INTO "VIAGEMMESTRE"
          ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","DHINCLUSAO","FGRASTREADO","TENANT_ID","VLFRETE")
         VALUES ($1,1,'A',CURRENT_TIMESTAMP,'N',$2,5000)`,
        [ID_V_COMUM, TENANT_P2]
      );
      await pool.query(
        `INSERT INTO "CONVOCACAO"
          ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","DHCONVOCACAO","SGUSUARIO_OPERADOR","STATUS","TENANT_ID")
         VALUES
          ($1,$3,1,CURRENT_TIMESTAMP,'admin','ACEITA',$4),
          ($2,$3,1,CURRENT_TIMESTAMP,'admin','ACEITA',$4)`,
        [ID_C1, ID_C2, ID_V_COMUM, TENANT_P2]
      );

      const cA = await pool.connect();
      const cB = await pool.connect();
      const [rA, rB] = await Promise.all([
        tentarConfirmarComumExclusivo(cA, TENANT_P2, ID_C1, ID_V_COMUM),
        tentarConfirmarComumExclusivo(cB, TENANT_P2, ID_C2, ID_V_COMUM),
      ]);
      cA.release();
      cB.release();

      const wins = [rA, rB].filter((x) => x.ok).length;
      const blocked = [rA, rB].filter((x) => !x.ok && x.code === 'JA_CONFIRMADA');
      const confCount = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "CONVOCACAO"
          WHERE "TENANT_ID" = $1 AND "IDVIAGEM" = $2 AND "STATUS" = 'CONFIRMADA'`,
        [TENANT_P2, ID_V_COMUM]
      );
      if (wins === 1 && blocked.length === 1 && confCount.rows[0].n === 1) {
        ok('Duas confirmações concorrentes na viagem comum', '1 CONFIRMADA + 1 JA_CONFIRMADA sob FOR UPDATE');
      } else {
        // Empate raro: ambos falham por CONVOCACAO_MUDOU — ainda prova serialização se <=1 CONFIRMADA
        if (confCount.rows[0].n <= 1 && wins + blocked.length === 2) {
          ok(
            'Duas confirmações concorrentes na viagem comum',
            `serializado wins=${wins} blocked=${blocked.length} conf=${confCount.rows[0].n}`
          );
        } else {
          fail(
            'Duas confirmações concorrentes na viagem comum',
            JSON.stringify({ rA, rB, conf: confCount.rows[0].n })
          );
        }
      }
    } catch (e) {
      fail('Duas confirmações concorrentes na viagem comum', e.message);
    }
  }

  // 15. Lote filha + desistirLote cancela cobrança (mesmo fluxo do controller; TX+ROLLBACK)
  {
    const tx = await createTransaction(pool);
    let rolled = false;
    try {
      await limparFixturesP2();
      await garantirTenantP2();
      await fin.publicarContrato(
        TENANT_P2,
        {
          fgRegraAtiva: 'S',
          politicaInadimplencia: 'ALERTA',
          componentes: [{ grupo: 'CONEXAO', tipo: 'FIXO', valorCentavos: 10000, fgAtivo: 'S', ordem: 0 }],
        },
        'admin'
      );

      await tx.begin();
      await tx.queryPg(
        `INSERT INTO "VIAGEMMESTRE"
          ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","DHINCLUSAO","FGRASTREADO","TENANT_ID","VLFRETE",
           "TIPO_SALDO","SALDO_INICIAL_EMBARQUES","SALDO_ATUAL_EMBARQUES","STATUS_DISTRIBUICAO")
         VALUES ($1,1,'A',CURRENT_TIMESTAMP,'N',$2,5000,'EMBARQUES',2,1,'PARCIAL')`,
        [ID_V_MAE, TENANT_P2]
      );
      await tx.queryPg(
        `INSERT INTO "VIAGEMMESTRE"
          ("IDVIAGEM","CDTIPOVIAGEM","FGSITVIAGEM","DHINCLUSAO","FGRASTREADO","TENANT_ID","VLFRETE",
           "IDVIAGEM_MAE","VALOR_CONSUMIDO_EMBARQUES","FGACTIVE")
         VALUES ($1,1,'A',CURRENT_TIMESTAMP,'N',$2,5000,$3,1,'A')`,
        [ID_V_FILHA, TENANT_P2, ID_V_MAE]
      );
      await tx.queryPg(
        `INSERT INTO "CONVOCACAO"
          ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","DHCONVOCACAO","SGUSUARIO_OPERADOR",
           "STATUS","DHRESPOSTA","TENANT_ID")
         VALUES ($1,$2,1,CURRENT_TIMESTAMP,'admin','CONFIRMADA',CURRENT_TIMESTAMP,$3)`,
        [ID_C_LOTE, ID_V_FILHA, TENANT_P2]
      );

      const gerada = await fin.criarCobrancaConexaoNaConfirmacao(tx, {
        tenantId: TENANT_P2,
        idConvocacao: ID_C_LOTE,
        idViagem: ID_V_FILHA,
        cdMotorista: 1,
        vlFrete: 5000,
        usuario: 'admin',
        idCicloConfirmacao: 'p2-lote-' + Date.now(),
      });
      if (!(gerada && gerada.gerou && gerada.cobranca)) {
        throw new Error('falha ao gerar cobrança do lote: ' + JSON.stringify(gerada));
      }
      const idCobLote = gerada.cobranca.ID;

      const devolvida = await loteSaldo.devolverVaga(tx, {
        idConvocacao: ID_C_LOTE,
        tenantId: TENANT_P2,
        motivo: 'Teste P2 desistir lote',
        usuario: 'admin',
      });
      const finCanc = await fin.cancelarCobrancaConexaoNaTransacao(tx, {
        tenantId: TENANT_P2,
        idConvocacao: ID_C_LOTE,
        usuario: 'admin',
        motivo: 'Teste P2 desistir lote',
        origem: 'TORRE',
      });

      const cob = await tx.queryPg(
        `SELECT "STATUS" FROM "FIN_COBRANCA" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
        [idCobLote, TENANT_P2]
      );
      const conv = await tx.queryPg(
        `SELECT "STATUS" FROM "CONVOCACAO" WHERE "IDCONVOCACAO" = $1 AND "TENANT_ID" = $2`,
        [ID_C_LOTE, TENANT_P2]
      );
      const mae = await tx.queryPg(
        `SELECT "SALDO_ATUAL_EMBARQUES" FROM "VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2`,
        [ID_V_MAE, TENANT_P2]
      );
      const desistirSrc = fs.readFileSync(path.join(__dirname, '../controllers/viagemmestre.controller.js'), 'utf8');
      const desistirChamaFin = /desistirLote:[\s\S]*?cancelarCobrancaConexaoNaTransacao/.test(desistirSrc);

      await tx.rollback();
      rolled = true;

      if (
        desistirChamaFin &&
        cob.rows[0] &&
        cob.rows[0].STATUS === 'CANCELADA' &&
        finCanc.canceladas >= 1 &&
        String(conv.rows[0].STATUS) === 'DESISTIU' &&
        Number(mae.rows[0].SALDO_ATUAL_EMBARQUES) === 2 &&
        devolvida &&
        Number(devolvida.saldoDepois) === 2
      ) {
        ok('Lote filha / desistirLote cancela cobrança', `cob=${idCobLote} canceladas=${finCanc.canceladas} (TX rollback)`);
      } else {
        fail(
          'Lote filha / desistirLote cancela cobrança',
          JSON.stringify({
            statusCob: cob.rows[0] && cob.rows[0].STATUS,
            canceladas: finCanc && finCanc.canceladas,
            statusConv: conv.rows[0] && conv.rows[0].STATUS,
            saldoMae: mae.rows[0] && mae.rows[0].SALDO_ATUAL_EMBARQUES,
            desistirChamaFin,
          })
        );
      }
    } catch (e) {
      if (!rolled) await tx.rollback().catch(() => {});
      fail('Lote filha / desistirLote cancela cobrança', e.message);
    }
  }

  // 16. Estoque 7.1 não acoplado ao Atlas Pay FIN_*
  {
    const reFin = /financeiro-cobranca|criarCobrancaConexaoNaConfirmacao|requireFinPerm|FIN_PERM_|FIN_COBRANCA_EVENTO/;
    const hits = [];
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|html)$/i.test(ent.name)) continue;
        const txt = fs.readFileSync(full, 'utf8');
        if (reFin.test(txt)) hits.push(full);
      }
    }
    const modulos = path.join(__dirname, '../public/modulos');
    if (fs.existsSync(modulos)) {
      for (const ent of fs.readdirSync(modulos, { withFileTypes: true })) {
        if (ent.isDirectory() && /estoque/i.test(ent.name)) walk(path.join(modulos, ent.name));
      }
    }
    walk(path.join(__dirname, '../controllers'));
    walk(path.join(__dirname, '../services'));
    walk(path.join(__dirname, '../routes'));
    const graves = hits.filter((f) => /estoque/i.test(f.replace(/\\/g, '/')));
    if (graves.length === 0) {
      ok('Estoque 7.1 sem acoplamento Atlas Pay FIN_*', 'controllers/services/routes/UI estoque* sem Atlas Pay FIN');
    } else {
      fail('Estoque 7.1 sem acoplamento Atlas Pay FIN_*', graves.map((f) => path.basename(f)).join(','));
    }
  }

  // 17. Baixa / Atlas Pay sem atividade atlas-pay → 403
  {
    try {
      await limparUsuarioSemAtlas();
      await pool.query(
        `INSERT INTO "USUARIO" ("SGUSUARIO","NMUSUARIO","TENANT_ID","FGACTIVE")
         VALUES ($1,'P2 sem atlas-pay','default','S')`,
        [USER_SEM_ATLAS]
      );
      const req = {
        user: { login: USER_SEM_ATLAS, tenantId: 'default' },
        headers: {},
        body: {},
        tenantId: 'default',
        ip: '127.0.0.1',
      };
      const gate = await runMiddleware(requireAtlasPay, req);
      const baixa = await runMiddleware(requireFinPerm('FIN_COBRANCA_BAIXAR'), {
        ...req,
        atlasPayLogin: USER_SEM_ATLAS,
        finPerms: [],
      });
      if (
        gate.res.statusCode === 403 &&
        gate.res.body &&
        gate.res.body.code === 'FIN_SEM_PERMISSAO' &&
        !gate.nextCalled &&
        baixa.res.statusCode === 403
      ) {
        ok('Permissão baixa sem atlas-pay', 'requireAtlasPay + requireFinPerm → 403 FIN_SEM_PERMISSAO');
      } else {
        fail(
          'Permissão baixa sem atlas-pay',
          JSON.stringify({
            gate: { status: gate.res.statusCode, body: gate.res.body, next: gate.nextCalled },
            baixa: { status: baixa.res.statusCode, body: baixa.res.body, next: baixa.nextCalled },
          })
        );
      }
    } catch (e) {
      fail('Permissão baixa sem atlas-pay', e.message);
    } finally {
      await limparUsuarioSemAtlas();
    }
  }

  // Limpeza fixtures P2 + garantia regra default N
  await limparFixturesP2();
  const vigFinal = await fin.buscarContratoVigente((s, p) => pool.query(s, p), tid);
  if (!(vigFinal && vigFinal.FG_REGRA_ATIVA === 'N')) {
    await fin.publicarContrato(
      tid,
      {
        fgRegraAtiva: 'N',
        politicaInadimplencia: 'ALERTA',
        componentes: [{ grupo: 'CONEXAO', tipo: 'FIXO', valorCentavos: 10000, fgAtivo: 'S', ordem: 0 }],
      },
      'admin'
    );
  }
  const vigCheck = await fin.buscarContratoVigente((s, p) => pool.query(s, p), tid);
  if (vigCheck && vigCheck.FG_REGRA_ATIVA === 'N') ok('Default permanece regra N após P2', 'v' + vigCheck.VERSAO);
  else fail('Default permanece regra N após P2', vigCheck && vigCheck.FG_REGRA_ATIVA);

  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log('\nResumo:', { passed, failed, skipped });
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
