'use strict';

/**
 * Limpeza de dados de teste, só para o dono da plataforma.
 * A tela marca tabela por tabela. Apagar um pai puxa os filhos que travariam a exclusão.
 * A ordem é sempre filho antes do pai, só no tenant escolhido.
 * Não usa TRUNCATE CASCADE: isso seguiria a chave e levaria linha de outro tenant.
 * O contador volta a 1 só se a tabela ficar vazia; senão fica no maior id que restou.
 */

const GRUPOS = {
  torre: {
    nome: 'Operação da torre',
    detalhe: 'Marque as tabelas. O bloco marca todas. Cadastro de pessoas, veículos e usuários ficam.',
    passos: [
      passo('avisos-alerta', 'Avisos de alerta',
        `DELETE FROM "ALERT_NOTIFICATION_LOG" n USING "VIAGEMMESTRE" v WHERE n."IDVIAGEM" = v."IDVIAGEM" AND v."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "ALERT_NOTIFICATION_LOG" n JOIN "VIAGEMMESTRE" v ON n."IDVIAGEM" = v."IDVIAGEM" WHERE v."TENANT_ID" = $1`),
      passoTenant('historico-alertas', 'Histórico de alertas', 'ALERT_HISTORY'),
      passoTenant('alertas', 'Alertas', 'ALERTS', ['historico-alertas']),
      passoTenant('mensagens', 'Mensagens', 'MESSAGES'),
      passoTenant('conversas', 'Conversas', 'CONVERSAS', ['mensagens']),
      passoTenant('historico-sos', 'Histórico SOS', 'SOS_HISTORY'),
      passoTenant('sos', 'SOS', 'SOS_ALERTS', ['historico-sos']),
      passoTenant('comprovantes', 'Comprovantes de entrega', 'DELIVERY_PROOFS'),
      passoTenant('feedback', 'Feedback', 'FEEDBACK'),
      passoTenant('reabertura', 'Histórico de reabertura', 'HISTORICOREABERTURA'),
      passoTenant('webhook', 'Logs de webhook', 'LOGSWEBHOOKMETA'),
      passoTenant('whatsapp', 'Logs de WhatsApp', 'LOG_ENVIO_WHATSAPP'),
      passoTenant('chat', 'Chat da viagem', 'VIAGEMCHAT'),
      passoTenant('comprovante-viagem', 'Comprovante da viagem', 'VIAGEMCOMPROVANTE'),
      passoTenant('eventos', 'Eventos da viagem', 'VIAGEMEVENTO'),
      passoTenant('ocorrencias', 'Ocorrências da viagem', 'VIAGEMOCORRENCIA'),
      passoTenant('rastreamento', 'Rastreamento', 'VIAGEMRASTREAMENTO'),
      passoTenant('rastreamento-visao', 'Rastreamento (visão)', 'VIAGEM_RASTREAMENTO'),
      passoTenant('motorista-viagem', 'Motorista da viagem', 'VIAGEMMOTORISTA'),
      passoTenant('veiculo-viagem', 'Veículo da viagem', 'VIAGEMVEICULO'),
      passoTenant('convocacoes', 'Convocações', 'CONVOCACAO', ['feedback', 'reabertura', 'webhook', 'whatsapp', 'campanha-convocacao']),
      passoTenant('campanha-convocacao', 'Campanha — convocação', 'OPORT_CAMPANHA_CONVOCACAO'),
      passoTenant('campanha-evento', 'Campanha — evento', 'OPORT_CAMPANHA_EVENTO'),
      passoTenant('campanha-viagem', 'Campanha — viagem', 'OPORT_CAMPANHA_VIAGEM'),
      passoTenant('campanha-destino', 'Campanha — destino', 'OPORT_CAMPANHA_DEST'),
      passoTenant('campanhas', 'Campanhas', 'OPORT_CAMPANHA', ['campanha-convocacao', 'campanha-evento', 'campanha-viagem', 'campanha-destino']),
      passoTenant('viagens', 'Viagens', 'VIAGEMMESTRE', [
        'avisos-alerta', 'alertas', 'mensagens', 'conversas', 'historico-sos', 'sos', 'comprovantes',
        'feedback', 'reabertura', 'webhook', 'whatsapp', 'chat', 'comprovante-viagem', 'eventos',
        'ocorrencias', 'rastreamento', 'rastreamento-visao', 'motorista-viagem', 'veiculo-viagem',
        'convocacoes', 'campanha-viagem',
      ]),
      passoTenant('pontos-roteiro', 'Pontos do roteiro', 'ROTEIROPONTOS'),
      passoTenant('roteiro-cg', 'Roteiro por cadastro', 'ROTEIRO_CG'),
      passoTenant('roteiros', 'Roteiros', 'ROTEIRO', ['viagens', 'pontos-roteiro', 'roteiro-cg']),
    ],
  },
  wms: {
    nome: 'Operação do estoque',
    detalhe: 'Marque as tabelas. O bloco marca todas. Motivos de baixa globais ficam.',
    passos: [
      passo('itens-espelho', 'Itens do espelho',
        `DELETE FROM "WMS_OPL_ITEM" i USING "WMS_OPL_PEDIDO" p, "WMS_OPL_ARQUIVO" a WHERE i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO" AND p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_OPL_ITEM" i JOIN "WMS_OPL_PEDIDO" p ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO" JOIN "WMS_OPL_ARQUIVO" a ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO" WHERE a."TENANT_ID" = $1`),
      passo('pedidos-espelho', 'Pedidos do espelho',
        `DELETE FROM "WMS_OPL_PEDIDO" p USING "WMS_OPL_ARQUIVO" a WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_OPL_PEDIDO" p JOIN "WMS_OPL_ARQUIVO" a ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO" WHERE a."TENANT_ID" = $1`,
        ['itens-espelho']),
      passo('itens-validacao', 'Itens da validação',
        `DELETE FROM "WMS_CARGA_VALIDACAO_ITEM" i USING "WMS_CARGA_VALIDACAO" v WHERE i."CD_VALIDACAO" = v."CD_VALIDACAO" AND v."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_CARGA_VALIDACAO_ITEM" i JOIN "WMS_CARGA_VALIDACAO" v ON i."CD_VALIDACAO" = v."CD_VALIDACAO" WHERE v."TENANT_ID" = $1`),
      passo('notas-carga', 'Notas da carga',
        `DELETE FROM "WMS_CARGA_PROGRAMADA_NFE" n USING "WMS_CARGA_PROGRAMADA" c WHERE n."CD_CARGA" = c."CD_CARGA" AND c."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_CARGA_PROGRAMADA_NFE" n JOIN "WMS_CARGA_PROGRAMADA" c ON n."CD_CARGA" = c."CD_CARGA" WHERE c."TENANT_ID" = $1`),
      passo('linhas-inventario', 'Linhas do inventário',
        `DELETE FROM "WMS_INVENTARIO_LINHA" l USING "WMS_INVENTARIO" i WHERE l."CD_INVENTARIO" = i."CD_INVENTARIO" AND i."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_INVENTARIO_LINHA" l JOIN "WMS_INVENTARIO" i ON l."CD_INVENTARIO" = i."CD_INVENTARIO" WHERE i."TENANT_ID" = $1`),
      passo('linhas-baixa', 'Linhas da baixa',
        `DELETE FROM "WMS_BAIXA_ESTOQUE_LINHA" l USING "WMS_BAIXA_ESTOQUE" b WHERE l."CD_BAIXA" = b."CD_BAIXA" AND b."TENANT_ID" = $1`,
        `SELECT COUNT(*)::int AS n FROM "WMS_BAIXA_ESTOQUE_LINHA" l JOIN "WMS_BAIXA_ESTOQUE" b ON l."CD_BAIXA" = b."CD_BAIXA" WHERE b."TENANT_ID" = $1`),
      passoTenant('paradas-rota', 'Paradas da rota', 'WMS_CARGA_ROTA_PARADA'),
      passoTenant('rotas-carga', 'Rotas da carga', 'WMS_CARGA_ROTA_OPERACIONAL', ['paradas-rota']),
      passoTenant('separacao', 'Itens da separação', 'WMS_SEPARACAO_PEDIDO_ITEM'),
      passoTenant('liberacao-divergencia', 'Liberação de divergência', 'WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA'),
      passoTenant('liberacao-cobertura', 'Liberação de cobertura', 'WMS_OPL_LIBERACAO_COBERTURA'),
      passoTenant('expedicao', 'Expedição', 'WMS_EXPEDICAO_CARGA'),
      passoTenant('validacao-carga', 'Validação da carga', 'WMS_CARGA_VALIDACAO', ['itens-validacao']),
      passoTenant('reservas', 'Reservas', 'WMS_RESERVA_ESTOQUE_OPL'),
      passoTenant('transferencias', 'Transferências', 'WMS_TRANSFERENCIA_DONO'),
      passoTenant('cargas', 'Cargas', 'WMS_CARGA_PROGRAMADA', [
        'notas-carga', 'itens-validacao', 'validacao-carga', 'paradas-rota', 'rotas-carga',
        'separacao', 'liberacao-divergencia', 'liberacao-cobertura', 'expedicao',
      ]),
      passoTenant('espelhos', 'Espelhos', 'WMS_OPL_ARQUIVO', ['itens-espelho', 'pedidos-espelho']),
      passoTenant('nf-saida', 'NF de saída', 'WMS_NFE_SAIDA', ['notas-carga']),
      passoTenant('nf-entrada', 'NF de entrada', 'WMS_NFE_ENTRADA'),
      passoTenant('movimentos', 'Movimentos', 'WMS_MOVIMENTO_ESTOQUE'),
      passoTenant('saldo-lote', 'Saldo de lote', 'WMS_INVENTARIO_SALDO_LOTE'),
      passoTenant('inventarios', 'Inventários', 'WMS_INVENTARIO', ['linhas-inventario']),
      passoTenant('snapshot', 'Snapshot diário', 'WMS_ESTOQUE_SNAPSHOT_DIARIO'),
      passoTenant('baixas', 'Baixas', 'WMS_BAIXA_ESTOQUE', ['linhas-baixa']),
      passoTenant('shelf', 'Shelf apontado', 'WMS_SHELF_APONTADO'),
      passoTenant('liberacao-validade', 'Liberação de validade', 'WMS_RECEBIMENTO_LIBERACAO_VALIDADE'),
      passoTenant('envios-vencimento', 'Envios de vencimento', 'WMS_RELATORIO_VENCIMENTO_ENVIO'),
      passoTenant('produto-operacional', 'Produto operacional', 'WMS_PRODUTO_OPERACIONAL'),
      passoTenant('depara', 'De-para', 'WMS_DEPARA_PRODUTO'),
      passoTenant('produtos-dono', 'Produtos do dono', 'WMS_PRODUTO_DONO', ['produto-operacional', 'depara']),
      passoTenant('categorias', 'Categorias', 'WMS_CATEGORIA_PRODUTO'),
      passoTenant('grupos-produto', 'Grupos de produto', 'WMS_GRUPO_PRODUTO', ['categorias']),
      passoTenant('areas', 'Áreas', 'WMS_AREA'),
      passoTenant('docas', 'Docas', 'WMS_DOCA'),
      passoTenant('armazens', 'Armazéns', 'WMS_ARMAZEM', ['areas', 'docas']),
      passoTenant('donos', 'Donos do estoque', 'WMS_DONO_ESTOQUE', [
        'transferencias', 'reservas', 'movimentos', 'saldo-lote', 'inventarios', 'snapshot', 'baixas',
        'shelf', 'produtos-dono', 'armazens', 'cargas', 'espelhos', 'nf-saida', 'nf-entrada',
        'liberacao-validade', 'envios-vencimento',
      ]),
    ],
  },
};

function passo(id, nome, del, cnt, precisa) {
  return { id, nome, del, cnt, precisa: precisa || [] };
}

function passoTenant(id, nome, tabela, precisa) {
  return passo(
    id,
    nome,
    `DELETE FROM "${tabela}" WHERE "TENANT_ID" = $1`,
    `SELECT COUNT(*)::int AS n FROM "${tabela}" WHERE "TENANT_ID" = $1`,
    precisa
  );
}

function catalogo() {
  const lista = [];
  Object.keys(GRUPOS).forEach((gid) => {
    GRUPOS[gid].passos.forEach((p) => {
      lista.push({ ...p, grupo: gid, grupoNome: GRUPOS[gid].nome });
    });
  });
  return lista;
}

function listarGrupos() {
  return Object.keys(GRUPOS).map((id) => ({
    id,
    nome: GRUPOS[id].nome,
    detalhe: GRUPOS[id].detalhe,
    tabelas: GRUPOS[id].passos.map((p) => ({ id: p.id, nome: p.nome, precisa: p.precisa })),
  }));
}

function tabelasValidas(lista) {
  const conhecidas = new Set(catalogo().map((p) => p.id));
  const ids = Array.isArray(lista) ? lista.map((x) => String(x || '').trim()).filter(Boolean) : [];
  return [...new Set(ids)].filter((id) => conhecidas.has(id));
}

function expandir(ids) {
  const todos = catalogo();
  const porId = new Map(todos.map((p) => [p.id, p]));
  const pedido = new Set(tabelasValidas(ids));
  const ativo = new Set(pedido);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const id of ativo) {
      const p = porId.get(id);
      (p && p.precisa ? p.precisa : []).forEach((dep) => {
        if (porId.has(dep) && !ativo.has(dep)) {
          ativo.add(dep);
          mudou = true;
        }
      });
    }
  }
  return {
    passos: todos.filter((p) => ativo.has(p.id)),
    pedido,
  };
}

async function executarPassos(client, passos, tid, apagar, pedido) {
  const linhas = [];
  for (const p of passos) {
    const r = await client.query(apagar ? p.del : p.cnt, [tid]);
    const n = apagar ? r.rowCount : Number(r.rows[0] && (r.rows[0].n ?? r.rows[0].N)) || 0;
    if (n) linhas.push({ nome: p.nome, n, grupo: p.grupo, grupoNome: p.grupoNome, inclusa: pedido ? !pedido.has(p.id) : false });
  }
  return linhas;
}

function blocosDe(linhas) {
  const ordem = [];
  const map = new Map();
  linhas.forEach((l) => {
    if (!map.has(l.grupo)) {
      map.set(l.grupo, { id: l.grupo, nome: l.grupoNome, total: 0, linhas: [] });
      ordem.push(l.grupo);
    }
    const b = map.get(l.grupo);
    b.total += l.n;
    b.linhas.push({ nome: l.nome, n: l.n, inclusa: l.inclusa });
  });
  return ordem.map((id) => map.get(id));
}

function tabelaDoPasso(p) {
  const m = String(p.del || '').match(/DELETE FROM "([^"]+)"/i);
  return m ? m[1] : null;
}

async function ajustarSequencias(client, tabelas) {
  const sequencias = [];
  for (const tabela of tabelas) {
    const achadas = await client.query(
      `SELECT pg_get_serial_sequence(format('%I.%I', 'public', $1), a.attname) AS seq,
              a.attname AS coluna
         FROM pg_attribute a
         JOIN pg_class t ON t.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = $1
          AND a.attnum > 0 AND NOT a.attisdropped
          AND pg_get_serial_sequence(format('%I.%I', 'public', $1), a.attname) IS NOT NULL`,
      [tabela]
    );
    for (const row of achadas.rows) {
      const seq = row.seq;
      const coluna = row.coluna;
      const max = await client.query(`SELECT MAX("${coluna}") AS m FROM "${tabela}"`);
      const m = max.rows[0] && max.rows[0].m != null ? Number(max.rows[0].m) : null;
      if (!Number.isFinite(m)) {
        await client.query('SELECT setval($1::regclass, 1, false)', [seq]);
        sequencias.push({ seq, proximo: 1 });
      } else {
        await client.query('SELECT setval($1::regclass, $2, true)', [seq, m]);
        sequencias.push({ seq, proximo: m + 1 });
      }
    }
  }
  return sequencias;
}

async function previarLimpeza(pool, tenantId, ids) {
  const { passos, pedido } = expandir(ids);
  const client = await pool.connect();
  try {
    const linhas = await executarPassos(client, passos, tenantId, false, pedido);
    return { blocos: blocosDe(linhas) };
  } finally {
    client.release();
  }
}

async function executarLimpeza(pool, tenantId, ids) {
  const { passos, pedido } = expandir(ids);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const linhas = await executarPassos(client, passos, tenantId, true, pedido);
    await client.query('COMMIT');
    let sequencias = [];
    try {
      const tabelas = passos.map(tabelaDoPasso).filter(Boolean);
      sequencias = await ajustarSequencias(client, [...new Set(tabelas)]);
    } catch (e) {
      sequencias = [{ erro: 'as linhas saíram, mas algum contador não foi ajustado' }];
    }
    return { blocos: blocosDe(linhas), sequencias };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* já desfeito */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listarGrupos,
  tabelasValidas,
  previarLimpeza,
  executarLimpeza,
  ajustarSequencias,
};
