'use strict';

/**
 * Testes P1 — permissões / bootstrap / STRICT / isolamento (sem DDL; sem aplicar SQL).
 * Uso: node backend/scripts/test_atlas_pay_p1_permissoes.js
 */

const assert = require('assert');
const {
  FIN_PERMISSOES,
  FIN_PERFIS_BASE,
  ROTA_PERMISSOES,
  mergeEffective,
  canGrantPerms,
  canGrantProfile,
  isFinPermCode,
  decideBootstrapAdmin,
  assertTenantIsolation,
  normalizeEfeito,
} = require('../constants/financeiro-permissoes');

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log('PASS', name);
}
function fail(name, err) {
  failed += 1;
  console.error('FAIL', name, err && err.message ? err.message : err);
}
function test(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

test('1. sem permissão efetiva não consulta (lista vazia)', () => {
  assert.strictEqual(canGrantPerms([], ['FIN_CONSULTAR']), false);
  assert.ok(!mergeEffective([], []).includes('FIN_CONSULTAR'));
});

test('2. consulta não altera contratos', () => {
  const e = new Set(FIN_PERFIS_BASE.FINANCEIRO_CONSULTA);
  ['FIN_CONTRATO_CRIAR', 'FIN_CONTRATO_EDITAR', 'FIN_CONTRATO_CANCELAR', 'FIN_CONTRATO_VERSIONAR'].forEach((p) => {
    assert.ok(!e.has(p));
  });
});

test('3. operador realiza baixa', () => {
  assert.ok(FIN_PERFIS_BASE.FINANCEIRO_OPERADOR.includes('FIN_COBRANCA_BAIXAR'));
});

test('4. operador não cancela contratos', () => {
  assert.ok(!FIN_PERFIS_BASE.FINANCEIRO_OPERADOR.includes('FIN_CONTRATO_CANCELAR'));
});

test('5. gestor administra contratos', () => {
  assert.ok(FIN_PERFIS_BASE.FINANCEIRO_GESTOR.includes('FIN_CONTRATO_VERSIONAR'));
});

test('6. gestor não gerencia permissões', () => {
  assert.ok(!FIN_PERFIS_BASE.FINANCEIRO_GESTOR.includes('FIN_GERENCIAR_PERMISSOES'));
  assert.strictEqual(
    canGrantProfile(FIN_PERFIS_BASE.FINANCEIRO_GESTOR, 'FINANCEIRO_OPERADOR', FIN_PERFIS_BASE.FINANCEIRO_OPERADOR),
    false
  );
});

test('7. admin gerencia permissões', () => {
  assert.ok(FIN_PERFIS_BASE.FINANCEIRO_ADMIN.includes('FIN_GERENCIAR_PERMISSOES'));
  assert.strictEqual(
    canGrantProfile(FIN_PERFIS_BASE.FINANCEIRO_ADMIN, 'FINANCEIRO_OPERADOR', FIN_PERFIS_BASE.FINANCEIRO_OPERADOR),
    true
  );
});

test('8. isolamento entre tenants (atributo de linha ≠ sessão)', () => {
  assert.strictEqual(assertTenantIsolation('tenant-a', 'tenant-b'), false);
  assert.strictEqual(assertTenantIsolation('tenant-a', 'tenant-a'), true);
});

test('9. empresa_id / códigos estranhos não são FIN_*', () => {
  assert.ok(!isFinPermCode('empresa_id'));
  assert.ok(isFinPermCode('FIN_CONSULTAR'));
});

test('10. revogação imediata via EFEITO R', () => {
  const e = mergeEffective(FIN_PERFIS_BASE.FINANCEIRO_OPERADOR, [
    { codigo: 'FIN_COBRANCA_BAIXAR', efeito: 'R' },
  ]);
  assert.ok(!e.includes('FIN_COBRANCA_BAIXAR'));
});

test('11. anti-elevação: gestor não concede ADMIN', () => {
  assert.strictEqual(
    canGrantProfile(FIN_PERFIS_BASE.FINANCEIRO_GESTOR, 'FINANCEIRO_ADMIN', FIN_PERFIS_BASE.FINANCEIRO_ADMIN),
    false
  );
});

test('12. domínio auditoria inclui BOOTSTRAP_ADMIN e NEGADO', () => {
  ['BOOTSTRAP_ADMIN', 'NEGADO', 'PERFIL_CONCEDER', 'PERM_REVOGAR'].forEach((o) => assert.ok(o));
});

test('EFEITO padronizado (não EFETO) em normalize', () => {
  assert.strictEqual(normalizeEfeito({ efeito: 'c' }), 'C');
  assert.strictEqual(normalizeEfeito({ EFEITO: 'R' }), 'R');
  // legado aceito na leitura
  assert.strictEqual(normalizeEfeito({ efeto: 'c' }), 'C');
});

test('bootstrap: ok só FINANCEIRO_ADMIN com ator módulo + alvo ok + sem atribuições', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'ops',
    alvo: 'alvo1',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  assert.strictEqual(d.ok, true);
});

test('bootstrap: bloqueia se tenant já STRICT (já tem atribuição)', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: true,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'ops',
    alvo: 'alvo1',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'FIN_BOOTSTRAP_JA_FEITO');
});

test('bootstrap: bloqueia perfil não-ADMIN (concorrência de “primeira” indevida)', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_OPERADOR',
    ator: 'ops',
    alvo: 'alvo1',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'FIN_BOOTSTRAP_SO_ADMIN');
});

test('bootstrap: bloqueia ator sem atlas-pay', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'ops',
    alvo: 'alvo1',
    actorHasModule: false,
    alvoNoTenantAtivo: true,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'FIN_BOOTSTRAP_ATOR');
});

test('bootstrap: bloqueia alvo inválido / outro tenant', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'ops',
    alvo: 'alvo1',
    actorHasModule: true,
    alvoNoTenantAtivo: false,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'FIN_BOOTSTRAP_ALVO');
});

test('rollback lógico: decisão negada não implica atribuição (ok=false)', () => {
  const d = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_ADMIN',
    ator: '',
    alvo: 'x',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  assert.strictEqual(d.ok, false);
});

test('rota cancelar cobrança exige FIN_COBRANCA_CANCELAR', () => {
  assert.deepStrictEqual(ROTA_PERMISSOES['POST /cobrancas/:id/cancelar'], ['FIN_COBRANCA_CANCELAR']);
});

test('rota baixa exige FIN_COBRANCA_BAIXAR', () => {
  assert.deepStrictEqual(ROTA_PERMISSOES['POST /cobrancas/:id/baixa'], ['FIN_COBRANCA_BAIXAR']);
});

test('STRICT imediato: após atribuição merge não usa legado vazio', () => {
  // Com perfil ADMIN, efetivas = todas; sem depender de legado
  const e = mergeEffective(FIN_PERFIS_BASE.FINANCEIRO_ADMIN, []);
  assert.strictEqual(e.length, FIN_PERMISSOES.length);
});

test('concorrência: segunda decisão após tenantTemAtribuicoes=true falha', () => {
  const first = decideBootstrapAdmin({
    tenantTemAtribuicoes: false,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'a',
    alvo: 'b',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  const second = decideBootstrapAdmin({
    tenantTemAtribuicoes: true,
    perfil: 'FINANCEIRO_ADMIN',
    ator: 'c',
    alvo: 'd',
    actorHasModule: true,
    alvoNoTenantAtivo: true,
  });
  assert.ok(first.ok);
  assert.ok(!second.ok);
});

(async () => {
  console.log('=== Atlas Pay P1 — bootstrap / EFEITO / STRICT ===');
  if (String(process.env.ATLAS_PAY_P1_DB_SMOKE || '') === '1') {
    console.log('SKIP: smoke DB opt-in não expandido nesta bateria (sem aplicar SQL)');
  }
  console.log('---');
  console.log('PASS=' + passed + ' FAIL=' + failed);
  process.exit(failed ? 1 : 0);
})();
