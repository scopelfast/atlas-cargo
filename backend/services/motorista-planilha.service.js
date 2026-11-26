const XLSX = require('xlsx');
const { poolPromise } = require('../config/db');
const { normalizarPlacaBrasil } = require('../utils/placa-util');

const COLS_PESSOA = [
  'Nome',
  'Celular',
  'E-mail',
  'País do documento',
  'CPF / CI',
  'Número da CNH',
  'Categoria da CNH',
  'Validade da CNH',
  'Rastreado',
  'Classes de frota',
  'Origem preferida',
  'Destino preferido',
];
const COLS_VEICULO = ['Celular', 'Placa', 'Classe da placa', 'RENAVAM', 'Papel'];
const EXEMPLO_NOME = 'joao da silva';
const EXEMPLO_CEL = '5541999998888';

function semAcento(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function chaveCelular(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return null;
  return d;
}

function chavesEquivalentes(chave) {
  if (!chave) return [];
  const set = new Set([chave]);
  if (chave.startsWith('55') && chave.length > 11) set.add(chave.slice(2));
  return [...set];
}

function texto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function dataPlanilha(v) {
  if (v == null || texto(v) === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    if (!isNaN(utc.getTime())) return utc.toISOString().slice(0, 10);
  }
  const s = texto(v);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function pegar(obj, aliases) {
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(obj, a) && texto(obj[a]) !== '') return obj[a];
  }
  return '';
}

function linhasDaAba(sheet) {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!rows.length) return [];
  const headers = rows[0].map((h) => semAcento(h));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const vals = rows[i] || [];
    if (vals.every((v) => texto(v) === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = vals[idx];
    });
    out.push({ linha: i + 1, obj });
  }
  return out;
}

function acharAba(wb, nomes) {
  const alvo = new Set(nomes.map(semAcento));
  const nome = (wb.SheetNames || []).find((n) => alvo.has(semAcento(n)));
  return nome ? wb.Sheets[nome] : null;
}

function gerarModelo() {
  const pessoa = [COLS_PESSOA, [
    'João da Silva', '41999998888', 'joao@email.com', 'BR', '', '', '', '', 'N', 'truck', 'PR', 'PR',
  ]];
  const veic = [COLS_VEICULO, ['41999998888', 'ABC1D23', 'truck', '', 'CAVALO']];
  const leia = [
    ['Como usar'],
    ['Apague a linha de exemplo antes de subir.'],
    ['Nome e celular criam o motorista. Celular com DDD. O mesmo número atualiza o cadastro.'],
    ['Célula vazia não apaga o que já está gravado.'],
    ['Foto, CRLV, comprovante e senha não entram na planilha.'],
    ['Quem entra só com nome e celular já pode receber oportunidade. O login do app fica pendente até a torre liberar.'],
    ['Aba Veículos é opcional: celular, placa, classe daquela placa, RENAVAM e papel (CAVALO ou CARRETA).'],
  ];
  const wb = XLSX.utils.book_new();
  const wsP = XLSX.utils.aoa_to_sheet(pessoa);
  wsP['!cols'] = COLS_PESSOA.map((c) => ({ wch: Math.max(18, c.length + 2) }));
  const wsV = XLSX.utils.aoa_to_sheet(veic);
  wsV['!cols'] = COLS_VEICULO.map((c) => ({ wch: Math.max(16, c.length + 2) }));
  const wsL = XLSX.utils.aoa_to_sheet(leia);
  wsL['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsP, 'Motoristas');
  XLSX.utils.book_append_sheet(wb, wsV, 'Veículos');
  XLSX.utils.book_append_sheet(wb, wsL, 'Leia-me');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function carregarApoio(pool, tenantId) {
  const classes = await pool.query(
    `SELECT "CDCLASSEFROTA" AS id, "DSCLASSEFROTA" AS nome FROM "CLASSEFROTA"`
  );
  const classePorNome = new Map();
  for (const r of classes.rows || []) {
    classePorNome.set(semAcento(r.nome), Number(r.id));
  }
  let estados = [];
  try {
    const est = await pool.query(
      `SELECT e."CDUF" AS cduf, TRIM(e."ESTADO") AS uf, e."NMESTADO" AS nome,
              TRIM(COALESCE(p."SGPAIS", '')) AS sg
       FROM "ESTADO" e
       LEFT JOIN "PAIS" p ON p."CDPAIS" = e."CDPAIS"`
    );
    estados = est.rows || [];
  } catch (_) {
    estados = [];
  }
  let mesos = [];
  try {
    const ms = await pool.query(
      `SELECT "CDUF" AS cduf, "CDMESOREGIAO" AS cdm, "DSMESOREGIAO" AS nome FROM "MESOREGIAO"`
    );
    mesos = ms.rows || [];
  } catch (_) {
    mesos = [];
  }
  const pessoas = await pool.query(
    `SELECT "CDCADASTRO" AS id, TRIM(COALESCE("NRCELULAR"::text, '')) AS cel,
            TRIM(COALESCE("FGACTIVE", '')) AS fg
     FROM "CADASTROGERAL"
     WHERE "TENANT_ID" = $1 AND "NRCELULAR" IS NOT NULL`,
    [tenantId]
  );
  const porCelular = new Map();
  for (const r of pessoas.rows || []) {
    const ch = chaveCelular(r.cel);
    if (!ch) continue;
    const info = { id: Number(r.id), fg: String(r.fg || '').trim() };
    for (const k of chavesEquivalentes(ch)) porCelular.set(k, info);
  }
  return { classePorNome, estados, mesos, porCelular };
}

function resolverClasse(mapa, textoClasse) {
  const t = semAcento(textoClasse);
  if (!t) return null;
  if (mapa.has(t)) return mapa.get(t);
  for (const [nome, id] of mapa) {
    if (nome.includes(t) || t.includes(nome)) return id;
  }
  return null;
}

function resolverLocal(apoio, bruto) {
  const t = semAcento(bruto);
  if (!t) return null;
  if (t.length === 2) {
    const pais = ['br', 'py', 'ar', 'uy', 'bo'].includes(t) ? t.toUpperCase() : null;
    const uf = (apoio.estados || []).find((e) => semAcento(e.uf) === t);
    if (uf) {
      const sg = texto(uf.sg).slice(0, 2).toUpperCase() || pais || 'BR';
      return { pais: sg, cduf: Number(uf.cduf), cdm: null };
    }
    if (pais) return { pais, cduf: null, cdm: null };
  }
  const ufNome = (apoio.estados || []).find((e) => semAcento(e.nome) === t || semAcento(e.uf) === t);
  if (ufNome) {
    const sg = texto(ufNome.sg).slice(0, 2).toUpperCase() || 'BR';
    return { pais: sg, cduf: Number(ufNome.cduf), cdm: null };
  }
  const meso = (apoio.mesos || []).find((m) => semAcento(m.nome) === t);
  if (meso) {
    const uf = (apoio.estados || []).find((e) => Number(e.cduf) === Number(meso.cduf));
    const sg = uf ? (texto(uf.sg).slice(0, 2).toUpperCase() || 'BR') : 'BR';
    return { pais: sg, cduf: Number(meso.cduf), cdm: Number(meso.cdm) };
  }
  return null;
}

function docDaPlanilha(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length > 11 && d.length <= 14) return { doc: d.padStart(14, '0'), tipo: 'J' };
  if (d.length >= 11) return { doc: d.slice(0, 11), tipo: 'F' };
  return { erro: 'Documento curto demais. A pessoa entra sem CPF/CI.' };
}

function rastreadoDaPlanilha(raw) {
  const t = semAcento(raw);
  if (!t) return null;
  if (t === 's' || t === 'sim') return 'S';
  if (t === 'n' || t === 'nao') return 'N';
  return undefined;
}

async function proximoId(client) {
  await client.query('SELECT pg_advisory_xact_lock(81420026)');
  const r = await client.query('SELECT COALESCE(MAX("CDCADASTRO"), 0)::numeric AS m FROM "CADASTROGERAL"');
  return Number(r.rows[0].m) + 1;
}

async function criarPessoa(client, row) {
  const id = await proximoId(client);
  if (row.cnh) {
    const ocupada = await client.query(
      `SELECT 1 FROM "MOTORISTA_COMPLEMENTO" WHERE "NRCNH" = $1`,
      [row.cnh]
    );
    if (ocupada.rows.length) {
      const err = new Error('CNH já cadastrada em outro motorista. A linha não foi gravada.');
      err.codigo = 'CNH';
      throw err;
    }
  }
  await client.query(
    `INSERT INTO "CADASTROGERAL" (
      "CDCADASTRO", "CGCCPF", "RZSOCIAL", "NMFANTASIA", "FGFISICAJURIDICA",
      "ENDERECO", "NRENDERECO", "BAIRRO", "NRCELULAR", "ENDEMAIL",
      "FGACTIVE", "FGTIPOCADASTRO", "FGMOTORISTA",
      "FGOPERADOR", "FGPROGRAMADOR", "FGTRANSPORTADOR", "FGAGENTE", "FGGRUPO", "FGCERTIFICADORA", "FGUNIDADENEGOCIO",
      "FGRASTREADO", "PAIS", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
    ) VALUES (
      $1, $2, $3, $4, $5,
      '', 0, '', $6::numeric, $7,
      'A', 'M', 'S',
      'N', 'N', 'N', 'N', 'N', 'N', 'N',
      $8, $9, CURRENT_TIMESTAMP, $10, 'Planilha', $11
    )`,
    [
      id,
      row.doc,
      row.nome.slice(0, 60),
      row.nome.slice(0, 30),
      row.tipoPessoa,
      row.celular,
      row.email,
      row.rastreado,
      row.pais,
      row.usuario,
      row.tenantId,
    ]
  );
  await client.query(
    `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "NRCNH", "CATEGORIACNH", "VALIDADECNH", "STATUSAPROVACAO", "SGUSER", "SERVERORIG")
     VALUES ($1, $2, $3, $4::date, 'P', $5, 'Planilha')`,
    [id, row.cnh || null, row.categoria || null, row.validade, row.usuario]
  );
  return id;
}

async function atualizarPessoa(client, id, row) {
  const sets = [];
  const vals = [];
  function add(col, val) {
    vals.push(val);
    sets.push(`"${col}" = $${vals.length}`);
  }
  if (row.nome) add('RZSOCIAL', row.nome.slice(0, 60));
  if (row.email) add('ENDEMAIL', row.email.slice(0, 200));
  if (row.pais) add('PAIS', row.pais);
  if (row.rastreado) add('FGRASTREADO', row.rastreado);
  if (row.doc && !row.doc.startsWith('T')) {
    add('CGCCPF', row.doc);
    add('FGFISICAJURIDICA', row.tipoPessoa);
  }
  add('FGMOTORISTA', 'S');
  vals.push(id);
  vals.push(row.tenantId);
  await client.query(
    `UPDATE "CADASTROGERAL" SET ${sets.join(', ')}, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $${vals.length + 1}
     WHERE "CDCADASTRO" = $${vals.length - 1} AND "TENANT_ID" = $${vals.length}`,
    [...vals, row.usuario]
  );
  if (row.cnh || row.categoria || row.validade) {
    if (row.cnh) {
      const ocupada = await client.query(
        `SELECT 1 FROM "MOTORISTA_COMPLEMENTO" WHERE "NRCNH" = $1 AND "CDCADASTRO" <> $2`,
        [row.cnh, id]
      );
      if (ocupada.rows.length) {
        const err = new Error('CNH já cadastrada em outro motorista. Os demais campos desta linha não foram gravados.');
        err.codigo = 'CNH';
        throw err;
      }
    }
    const ex = await client.query('SELECT 1 FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1', [id]);
    if (ex.rows.length) {
      await client.query(
        `UPDATE "MOTORISTA_COMPLEMENTO" SET
           "NRCNH" = COALESCE($2, "NRCNH"),
           "CATEGORIACNH" = COALESCE($3, "CATEGORIACNH"),
           "VALIDADECNH" = COALESCE($4::date, "VALIDADECNH"),
           "DHMAINTENANCE" = CURRENT_TIMESTAMP,
           "SGUSER" = $5
         WHERE "CDCADASTRO" = $1`,
        [id, row.cnh || null, row.categoria || null, row.validade, row.usuario]
      );
    } else {
      await client.query(
        `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "NRCNH", "CATEGORIACNH", "VALIDADECNH", "STATUSAPROVACAO", "SGUSER", "SERVERORIG")
         VALUES ($1, $2, $3, $4::date, 'P', $5, 'Planilha')`,
        [id, row.cnh || null, row.categoria || null, row.validade, row.usuario]
      );
    }
  }
}

async function gravarClasses(client, id, ids, usuario, tenantId) {
  for (const cd of ids) {
    try {
      await client.query(
        `INSERT INTO "CLASSEFROTA_CG" ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
         VALUES ($1, $2, 'S', CURRENT_TIMESTAMP, $3, 'Planilha', $4)
         ON CONFLICT DO NOTHING`,
        [id, cd, usuario, tenantId]
      );
    } catch (e) {
      if (e.code !== '42703' && e.code !== '42P10') throw e;
      await client.query(
        `INSERT INTO "CLASSEFROTA_CG" ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
         SELECT $1, $2, 'S', CURRENT_TIMESTAMP, $3, 'Planilha'
         WHERE NOT EXISTS (
           SELECT 1 FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1 AND "CDCLASSEFROTA" = $2
         )`,
        [id, cd, usuario]
      );
    }
  }
}

async function gravarLocal(client, id, tipo, local, usuario) {
  if (!local) return;
  const ja = await client.query(
    `SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO"
     WHERE "CDCADASTRO" = $1 AND "TIPO" = $2 AND "PAIS" = $3
       AND "CDUF" IS NOT DISTINCT FROM $4 AND "CDMESOREGIAO" IS NOT DISTINCT FROM $5`,
    [id, tipo, local.pais, local.cduf, local.cdm]
  );
  if (ja.rows.length) return;
  const seq = await client.query(
    `SELECT COALESCE(MAX("SEQUENCIA"), 0) + 1 AS n FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1`,
    [id]
  );
  await client.query(
    `INSERT INTO "CADASTRO_LOCAL_PREFERIDO" ("CDCADASTRO", "SEQUENCIA", "TIPO", "PAIS", "CDUF", "CDMESOREGIAO", "SGUSER")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, Number(seq.rows[0].n), tipo, local.pais, local.cduf, local.cdm, usuario]
  );
}

async function gravarVeiculo(client, pessoaId, v, usuario, tenantId) {
  const placa = normalizarPlacaBrasil(v.placa);
  if (!placa) return { erro: 'Placa inválida.' };
  let ex;
  try {
    ex = await client.query(
      `SELECT "IDVEICULOMOTORISTA" AS id FROM "MOTORISTA_VEICULO"
       WHERE "CDCADASTRO" = $1 AND (
         UPPER(REPLACE(COALESCE("PLACA", ''), '-', '')) = $2
         OR UPPER(REPLACE(COALESCE("PLACA_NORMALIZADA", ''), '-', '')) = $2
       )`,
      [pessoaId, placa]
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    ex = await client.query(
      `SELECT "IDVEICULOMOTORISTA" AS id FROM "MOTORISTA_VEICULO"
       WHERE "CDCADASTRO" = $1 AND UPPER(REPLACE(COALESCE("PLACA", ''), '-', '')) = $2`,
      [pessoaId, placa]
    );
  }
  if (ex.rows.length) {
    await client.query(
      `UPDATE "MOTORISTA_VEICULO" SET
         "RENAVAM" = COALESCE($2, "RENAVAM"),
         "CDCLASSEFROTA" = COALESCE($3, "CDCLASSEFROTA"),
         "PAPEL_CONJUNTO" = COALESCE($4, "PAPEL_CONJUNTO"),
         "DHMAINTENANCE" = CURRENT_TIMESTAMP,
         "SGUSER" = $5
       WHERE "IDVEICULOMOTORISTA" = $1`,
      [ex.rows[0].id, v.renavam, v.classeId, v.papel, usuario]
    );
    return { atualizado: true };
  }
  try {
    await client.query(
      `INSERT INTO "MOTORISTA_VEICULO" (
        "CDCADASTRO", "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDCLASSEFROTA",
        "PAPEL_CONJUNTO", "TENANT_ID", "STATUSAPROVACAO", "FGACTIVE", "SGUSER", "SERVERORIG"
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, 'P', 'S', $7, 'Planilha')`,
      [pessoaId, placa, v.renavam, v.classeId, v.papel, tenantId, usuario]
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    await client.query(
      `INSERT INTO "MOTORISTA_VEICULO" ("CDCADASTRO", "PLACA", "RENAVAM", "FGACTIVE", "SGUSER", "SERVERORIG")
       VALUES ($1, $2, $3, 'S', $4, 'Planilha')`,
      [pessoaId, placa, v.renavam, usuario]
    );
  }
  return { criado: true };
}

async function importar(buffer, { tenantId, usuario }) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  let abaPessoa = acharAba(wb, ['motoristas', 'motorista']);
  if (!abaPessoa) abaPessoa = wb.Sheets[wb.SheetNames[0]];
  const abaVeic = acharAba(wb, ['veiculos', 'veiculo']);
  const pessoas = linhasDaAba(abaPessoa);
  const veiculos = linhasDaAba(abaVeic);
  const pool = await poolPromise;
  const apoio = await carregarApoio(pool, tenantId);
  const erros = [];
  const avisosLista = [];
  let criados = 0;
  let atualizados = 0;
  let veiculosGravados = 0;
  let ignorados = 0;

  for (const item of pessoas) {
    const o = item.obj;
    const nome = texto(pegar(o, ['nome', 'nome completo']));
    const celRaw = pegar(o, ['celular', 'telefone', 'whatsapp', 'fone']);
    const celular = chaveCelular(celRaw);
    if (semAcento(nome) === EXEMPLO_NOME && celular === EXEMPLO_CEL) {
      ignorados += 1;
      continue;
    }
    if (!nome || !celular) {
      erros.push({
        aba: 'Motoristas',
        linha: item.linha,
        motivo: !nome ? 'Nome obrigatório.' : 'Celular inválido. Use DDD e o número.',
      });
      continue;
    }
    const avisos = [];
    const email = texto(pegar(o, ['e-mail', 'email'])).slice(0, 200);
    const paisTxt = texto(pegar(o, ['pais do documento', 'pais'])).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    const pais = paisTxt ? paisTxt.slice(0, 2) : null;
    const docInfo = docDaPlanilha(pegar(o, ['cpf / ci', 'cpf', 'ci', 'documento']));
    let doc = null;
    let tipoPessoa = 'F';
    if (docInfo && docInfo.erro) avisos.push(docInfo.erro);
    if (docInfo && docInfo.doc) {
      doc = docInfo.doc;
      tipoPessoa = docInfo.tipo;
    }
    const cnhRaw = texto(pegar(o, ['numero da cnh', 'cnh', 'n cnh'])).replace(/\D/g, '').slice(0, 11);
    const catRaw = texto(pegar(o, ['categoria da cnh', 'categoria'])).toUpperCase();
    const categorias = ['B', 'AB', 'C', 'D', 'E'];
    const categoria = categorias.includes(catRaw) ? catRaw : null;
    if (catRaw && !categoria) avisos.push('Categoria de CNH não reconhecida.');
    const validade = dataPlanilha(pegar(o, ['validade da cnh', 'validade']));
    if (texto(pegar(o, ['validade da cnh', 'validade'])) && !validade) avisos.push('Validade da CNH em formato inválido.');
    const rast = rastreadoDaPlanilha(pegar(o, ['rastreado']));
    if (rast === undefined) avisos.push('Rastreado deve ser S ou N.');
    const classesTxt = texto(pegar(o, ['classes de frota', 'classe de frota']));
    const classesIds = [];
    if (classesTxt) {
      for (const parte of classesTxt.split(/[,;]/)) {
        const idc = resolverClasse(apoio.classePorNome, parte);
        if (idc) classesIds.push(idc);
        else if (texto(parte)) avisos.push(`Classe não encontrada: ${texto(parte)}.`);
      }
    }
    const origemTxt = texto(pegar(o, ['origem preferida', 'origem']));
    const destinoTxt = texto(pegar(o, ['destino preferido', 'destino']));
    const origem = origemTxt ? resolverLocal(apoio, origemTxt) : null;
    const destino = destinoTxt ? resolverLocal(apoio, destinoTxt) : null;
    if (origemTxt && !origem) avisos.push(`Origem não reconhecida: ${origemTxt}.`);
    if (destinoTxt && !destino) avisos.push(`Destino não reconhecido: ${destinoTxt}.`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let info = null;
      for (const k of chavesEquivalentes(celular)) {
        if (apoio.porCelular.has(k)) {
          info = apoio.porCelular.get(k);
          break;
        }
      }
      const id = info ? info.id : null;
      const docFinal = doc || ('T' + celular.slice(-13));
      if (doc) {
        const dup = await client.query(
          `SELECT "CDCADASTRO" AS id FROM "CADASTROGERAL" WHERE "CGCCPF" = $1 AND "TENANT_ID" = $2`,
          [doc, tenantId]
        );
        const outro = (dup.rows || []).find((r) => Number(r.id) !== Number(id));
        if (outro) {
          avisos.push('CPF/CI já usado em outro cadastro. O documento não foi gravado.');
          doc = null;
        }
      }
      const payload = {
        nome,
        celular,
        email: email || null,
        pais,
        doc: doc || (id ? null : docFinal),
        tipoPessoa,
        cnh: cnhRaw || null,
        categoria,
        validade,
        rastreado: rast === 'S' || rast === 'N' ? rast : (id ? null : 'N'),
        usuario,
        tenantId,
      };
      let idGravado = id;
      if (!id) {
        idGravado = await criarPessoa(client, { ...payload, doc: doc || docFinal, rastreado: payload.rastreado || 'N' });
        criados += 1;
        for (const k of chavesEquivalentes(celular)) apoio.porCelular.set(k, { id: idGravado, fg: 'A' });
      } else {
        if (info.fg && info.fg !== 'A' && info.fg !== 'S') {
          avisos.push('Cadastro existe e está inativo. Os dados foram atualizados e ele continua fora das campanhas.');
        }
        await atualizarPessoa(client, id, payload);
        atualizados += 1;
      }
      if (classesIds.length) await gravarClasses(client, idGravado, classesIds, usuario, tenantId);
      if (origem) await gravarLocal(client, idGravado, 'E', origem, usuario);
      if (destino) await gravarLocal(client, idGravado, 'D', destino, usuario);
      await client.query('COMMIT');
      if (avisos.length) {
        avisosLista.push({ aba: 'Motoristas', linha: item.linha, motivo: avisos.join(' ') });
      }
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      erros.push({ aba: 'Motoristas', linha: item.linha, motivo: e.codigo === 'CNH' || e.code !== '23505' ? (e.message || 'Erro ao gravar.') : 'Documento, CNH ou placa já existe.' });
    } finally {
      client.release();
    }
  }

  for (const item of veiculos) {
    const o = item.obj;
    const celular = chaveCelular(pegar(o, ['celular', 'telefone', 'whatsapp', 'fone']));
    const placaTxt = texto(pegar(o, ['placa']));
    if (celular === EXEMPLO_CEL && semAcento(placaTxt) === 'abc1d23') {
      ignorados += 1;
      continue;
    }
    if (!celular || !normalizarPlacaBrasil(placaTxt)) {
      erros.push({
        aba: 'Veículos',
        linha: item.linha,
        motivo: !celular ? 'Celular inválido na aba Veículos.' : 'Placa inválida.',
      });
      continue;
    }
    let pessoaId = null;
    for (const k of chavesEquivalentes(celular)) {
      const info = apoio.porCelular.get(k);
      if (info) pessoaId = info.id;
    }
    if (!pessoaId) {
      erros.push({ aba: 'Veículos', linha: item.linha, motivo: 'Celular sem motorista na planilha nem no cadastro.' });
      continue;
    }
    const classeTxt = texto(pegar(o, ['classe da placa', 'classe']));
    const classeId = classeTxt ? resolverClasse(apoio.classePorNome, classeTxt) : null;
    const avisos = [];
    if (classeTxt && !classeId) avisos.push(`Classe da placa não encontrada: ${classeTxt}.`);
    const renavam = texto(pegar(o, ['renavam'])).replace(/\D/g, '').slice(0, 11) || null;
    let papel = texto(pegar(o, ['papel'])).toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 20);
    if (!papel) papel = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await gravarVeiculo(client, pessoaId, { placa: placaTxt, renavam, classeId, papel }, usuario, tenantId);
      await client.query('COMMIT');
      veiculosGravados += 1;
      if (avisos.length) avisosLista.push({ aba: 'Veículos', linha: item.linha, motivo: avisos.join(' ') });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      const msg = e.code === '23505'
        ? 'Placa já cadastrada.'
        : (e.message || 'Erro ao gravar veículo.');
      erros.push({ aba: 'Veículos', linha: item.linha, motivo: msg });
    } finally {
      client.release();
    }
  }

  return { success: true, criados, atualizados, veiculos: veiculosGravados, ignorados, avisos: avisosLista, erros };
}

module.exports = { gerarModelo, importar, chaveCelular };
