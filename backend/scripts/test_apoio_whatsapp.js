'use strict';

/**
 * Testes locais: validação, destino ausente, dedup, isolamento de tenant no body,
 * montagem de mensagem. Não dispara WhatsApp real se destino/token ausentes.
 *
 * Uso: node backend/scripts/test_apoio_whatsapp.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const assert = require('assert');
const apoio = require('../services/apoio-whatsapp.service');
const { poolPromise } = require('../config/db');

async function run() {
  const pool = await poolPromise;
  await apoio.garantirTabela(pool);

  let ok = 0;
  let fail = 0;
  const log = (name, pass, detail) => {
    if (pass) {
      ok++;
      console.log('OK ', name, detail || '');
    } else {
      fail++;
      console.log('FAIL', name, detail || '');
    }
  };

  // 1) montarCorpo
  const corpo = apoio.montarCorpo({
    tipo: 'SUPORTE',
    origem: 'PAINEL',
    tenantOrigem: 'acme',
    usuario: 'joao',
    assunto: 'Erro tela',
    descricao: 'Não carrega a lista de viagens',
    pagina: 'gerenciar-viagens',
    agora: '26/11/2026, 16:00:00',
  });
  log(
    'montarCorpo identifica tenant/usuario/assunto',
    /Empresa\/tenant: acme/.test(corpo) &&
      /Usuário: joao/.test(corpo) &&
      /Assunto: Erro tela/.test(corpo) &&
      /gerenciar-viagens/.test(corpo)
  );

  // 2) validação descrição curta
  {
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'PAINEL',
      tenantOrigem: 'tenant-teste-apoio',
      usuario: 'tester',
      assunto: 'Teste',
      descricao: 'curto',
      pagina: 'test',
    });
    log('rejeita descrição curta', !r.ok && r.code === 'DESCRICAO', r.message);
  }

  // 3) validação tipo ajuda
  {
    const r = await apoio.enviarPedido({
      tipo: 'APOIO',
      origem: 'PAINEL',
      tenantOrigem: 'tenant-teste-apoio',
      usuario: 'tester',
      tipoAjuda: 'XYZ',
      descricao: 'Preciso de ajuda com a operação agora',
      pagina: 'test',
    });
    log('rejeita tipoAjuda inválido', !r.ok && r.code === 'TIPO_AJUDA', r.message);
  }

  // 4) destino ausente (força limpando env e lendo DB)
  const prevEnv = process.env.TELEFONE_SUPORTE;
  process.env.TELEFONE_SUPORTE = '';
  const destAntes = await apoio.lerDestinoConfigurado(pool);
  if (!destAntes) {
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'PAINEL',
      tenantOrigem: 'tenant-teste-apoio',
      usuario: 'tester',
      assunto: 'Canal',
      descricao: 'Teste de destino ausente no canal Atlas',
      pagina: 'test-destino',
    });
    log('destino ausente → 503 DESTINO_AUSENTE', !r.ok && r.code === 'DESTINO_AUSENTE', r.message);

    const logs = await pool.query(
      `SELECT "RESULTADO","DETALHE" FROM "APOIO_WHATSAPP_LOG"
        WHERE "TENANT_ORIGEM" = $1 AND "PAGINA" = $2
        ORDER BY "DH" DESC LIMIT 1`,
      ['tenant-teste-apoio', 'test-destino']
    );
    const row = logs.rows[0];
    log(
      'falha destino registrada no log',
      row && row.RESULTADO === 'N' && /não configurado|nao configurado/i.test(row.DETALHE || ''),
      row && row.DETALHE
    );
  } else {
    log('destino ausente (skip — destino já configurado no ambiente)', true, apoio.mascaraDestino(destAntes));
  }
  if (prevEnv != null) process.env.TELEFONE_SUPORTE = prevEnv;
  else delete process.env.TELEFONE_SUPORTE;

  // 5) body não define tenant: serviço usa só tenantOrigem passado (sessão)
  {
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'PAINEL',
      tenantOrigem: 'tenant-a',
      usuario: 'tester',
      assunto: 'Isolamento',
      descricao: 'Mensagem de isolamento entre tenants no suporte',
      pagina: 'test-isolamento',
    });
    // Pode falhar por destino/canal — o importante é que TENANT_ORIGEM no log seja tenant-a
    const logs = await pool.query(
      `SELECT "TENANT_ORIGEM" FROM "APOIO_WHATSAPP_LOG"
        WHERE "PAGINA" = $1 AND "SGUSUARIO" = $2
        ORDER BY "DH" DESC LIMIT 1`,
      ['test-isolamento', 'tester']
    );
    log(
      'tenant de origem vem da sessão (tenant-a)',
      logs.rows[0] && logs.rows[0].TENANT_ORIGEM === 'tenant-a',
      logs.rows[0] && logs.rows[0].TENANT_ORIGEM
    );
    assert.ok(r); // só garante retorno
  }

  // 6) dedup: simula sucesso recente + mesmo fingerprint
  {
    const fp = apoio.fingerprint([
      'SUPORTE',
      'PAINEL',
      'tenant-dedup',
      'TESTER',
      'dedup assunto',
      'texto deduplicacao suporte atlas cargo'.toLowerCase().slice(0, 200),
    ]);
    await pool.query(
      `INSERT INTO "APOIO_WHATSAPP_LOG"
        ("TIPO","ORIGEM","TENANT_ORIGEM","SGUSUARIO","ASSUNTO","PAGINA","RESULTADO","DETALHE","FINGERPRINT")
       VALUES ('SUPORTE','PAINEL','tenant-dedup','tester','Dedup assunto','test-dedup','S','seed',$1)`,
      [fp]
    );
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'PAINEL',
      tenantOrigem: 'tenant-dedup',
      usuario: 'tester',
      assunto: 'Dedup assunto',
      descricao: 'texto deduplicacao suporte atlas cargo',
      pagina: 'test-dedup',
    });
    log('deduplica reenvio em 120s', r.ok && r.deduplicado === true, r.message);
  }

  // 7) normalizarDestino
  log('normalizar 11999998888 → 5511999998888', apoio.normalizarDestino('11999998888') === '5511999998888');
  log('normalizar inválido vazio', apoio.normalizarDestino('123') === '');

  console.log('\nResultado:', ok, 'ok,', fail, 'fail');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
