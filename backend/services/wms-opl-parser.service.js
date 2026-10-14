'use strict';

/**
 * Campo posicional 1-based (INICIO, TAM) conforme Integração OPL / Mana.
 * Linhas curtas são tratadas como preenchidas com espaços à direita.
 */
function fld(line, inicio1, tam) {
  const start = inicio1 - 1;
  if (start >= line.length) return ''.padEnd(tam, ' ');
  const end = Math.min(line.length, start + tam);
  const s = line.slice(start, end);
  return s.length < tam ? s + ' '.repeat(tam - s.length) : s;
}

function trimVal(s) {
  return s != null ? String(s).trim() : '';
}

/** Recorte 0-based (layout Mana linha tipo 3 em docs). */
function slice0(line, start0, tam) {
  if (start0 >= line.length) return ''.padEnd(tam, ' ');
  const s = line.slice(start0, start0 + tam);
  return s.length < tam ? s + ' '.repeat(tam - s.length) : s;
}

function parseTipo1(line) {
  const ident = trimVal(fld(line, 1, 1));
  if (ident !== '1') {
    const err = new Error('Cabeçalho do arquivo (tipo 1) inválido: esperado identificador "1".');
    err.code = 'OPL_PARSE';
    throw err;
  }
  const cnpj = trimVal(fld(line, 2, 14)).replace(/\D/g, '');
  const nome = trimVal(fld(line, 16, 50));
  const dataArq = trimVal(fld(line, 66, 6));
  return {
    ident,
    cnpjCpfCli: cnpj,
    cliNome: nome,
    dataArq,
    raw: line,
  };
}

function parseTipo2(line) {
  const linePadded = line.length < 292 ? line.padEnd(292, ' ') : line;
  const ident = trimVal(fld(linePadded, 1, 1));
  if (ident !== '2') {
    const err = new Error('Linha de pedido (tipo 2) inválida.');
    err.code = 'OPL_PARSE';
    throw err;
  }
  const codDest = trimVal(fld(linePadded, 2, 10));
  const razSoc = trimVal(fld(linePadded, 12, 50));
  const ende = trimVal(fld(linePadded, 62, 50));
  const bairro = trimVal(fld(linePadded, 112, 20));
  const cep = trimVal(fld(linePadded, 132, 9));
  const cidade = trimVal(fld(linePadded, 141, 25));
  const uf = trimVal(fld(linePadded, 166, 2));
  const numPedido = trimVal(fld(linePadded, 168, 10));
  const dataPedido = trimVal(fld(linePadded, 178, 6));
  const cnpjDest = trimVal(fld(linePadded, 251, 14)).replace(/\D/g, '');
  let fone = '';
  if (linePadded.length >= 718) fone = trimVal(fld(linePadded, 669, 50));
  else if (linePadded.length >= 535) {
    const tail = trimVal(linePadded.slice(526, 535));
    if (/^\d+$/.test(tail)) fone = tail;
  }
  const dadosJson = {
    qtdeItens: trimVal(fld(linePadded, 184, 4)),
    vlrTotProdutos: trimVal(fld(linePadded, 188, 13)),
    pesoLiq: trimVal(fld(linePadded, 201, 10)),
    numNf: trimVal(fld(linePadded, 211, 10)),
    dataEntrega: trimVal(fld(linePadded, 276, 8)),
    dataNf: trimVal(fld(linePadded, 268, 8)),
    chaveNfe: linePadded.length >= 598 ? trimVal(fld(linePadded, 555, 44)) : '',
  };
  return {
    ident,
    codDestinatario: codDest,
    razSocDest: razSoc,
    endeEntrega: ende,
    bairroEntrega: bairro,
    cepEntrega: cep,
    cidadeEntrega: cidade,
    ufEntrega: uf,
    numPedido,
    dataPedido,
    cnpjDest,
    foneDest: fone,
    dadosJson,
    raw: line,
  };
}

/**
 * Tipo 3 — layout Mana SC (149 chars típico); aceita linhas mais longas truncando leitura segura.
 */
function parseTipo3(line) {
  const ident = trimVal(fld(line, 1, 1));
  if (ident !== '3') {
    const err = new Error('Linha de item (tipo 3) inválida.');
    err.code = 'OPL_PARSE';
    throw err;
  }
  const descricao = trimVal(slice0(line, 11, 50));
  const blocoNum = trimVal(slice0(line, 61, 37)).replace(/\s/g, '');
  const codProd = trimVal(slice0(line, 109, 10));
  const qtStr = trimVal(slice0(line, 129, 10));
  let qtPedida = parseInt(qtStr.replace(/^0+/, '') || '0', 10);
  if (!Number.isFinite(qtPedida)) qtPedida = 0;
  let refLink = '';
  if (blocoNum.length >= 7) refLink = blocoNum.slice(-7).replace(/^0+/, '') || blocoNum.slice(-7);
  return {
    ident,
    descricao,
    codProdutoOl: codProd,
    qtPedida,
    refPedidoLink: refLink,
    dadosJson: { blocoNumerico: blocoNum },
    raw: line,
  };
}

/**
 * Alguns editores removem o "1" inicial ao salvar (ficam só os 14 dígitos do CNPJ).
 * Layout Mana: tipo 1 (1 char) + CNPJ (14) + nome (50) + data (6) = 71 chars.
 */
function normalizarLinhaTipo1(linha) {
  let ln = linha != null ? String(linha) : '';
  if (ln.charCodeAt(0) === 0xfeff) ln = ln.slice(1);
  ln = ln.replace(/^\uFEFF/, '');
  if (trimVal(fld(ln, 1, 1)) === '1') return ln;
  const t = ln.trimStart();
  if (/^\d{14}/.test(t) && t.length >= 70) {
    return `1${t}`;
  }
  return ln;
}

/**
 * @param {string} rawText
 * @returns {{ arquivo: object, pedidos: Array<{ itens: object[] } & object> }}
 */
function parseOplText(rawText) {
  let text = rawText != null ? String(rawText) : '';
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);
  if (!lines.length) {
    const err = new Error('Arquivo vazio.');
    err.code = 'OPL_PARSE';
    throw err;
  }
  lines[0] = normalizarLinhaTipo1(lines[0]);
  const arquivo = parseTipo1(lines[0]);
  const pedidos = [];
  /** @type {{ itens: object[] } | null} */
  let current = null;
  let seqPed = 0;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    const ch = ln.charAt(0);
    if (ch === '2') {
      seqPed += 1;
      const p = parseTipo2(ln);
      p.seqPedido = seqPed;
      p.itens = [];
      pedidos.push(p);
      current = p;
    } else if (ch === '3') {
      if (!current) {
        const err = new Error(`Linha ${i + 1}: registro tipo 3 sem pedido (tipo 2) anterior.`);
        err.code = 'OPL_PARSE';
        throw err;
      }
      const it = parseTipo3(ln);
      it.seqItem = (current.itens || []).length + 1;
      current.itens.push(it);
    }
  }
  if (!pedidos.length) {
    const err = new Error('Nenhum pedido (tipo 2) encontrado após o cabeçalho.');
    err.code = 'OPL_PARSE';
    throw err;
  }
  let qItens = 0;
  pedidos.forEach((p) => {
    qItens += (p.itens || []).length;
  });
  if (qItens === 0) {
    const err = new Error('Nenhum item (tipo 3) encontrado. Verifique o arquivo.');
    err.code = 'OPL_PARSE';
    throw err;
  }
  arquivo.qPedidos = pedidos.length;
  arquivo.qItens = qItens;
  return { arquivo, pedidos };
}

module.exports = {
  fld,
  parseOplText,
};
