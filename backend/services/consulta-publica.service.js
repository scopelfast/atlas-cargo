'use strict';

const axios = require('axios');

const UA = 'AtlasCargo/1.0';
const TIMEOUT = 8000;

function digitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function formatarCpf(d) {
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatarCnpj(d) {
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarCep(d) {
  return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}

function cpfValido(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv = (soma * 10) % 11;
  if (dv === 10) dv = 0;
  if (dv !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  dv = (soma * 10) % 11;
  if (dv === 10) dv = 0;
  return dv === Number(d[10]);
}

function cnpjValido(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base, pesoIni) => {
    let soma = 0;
    let peso = pesoIni;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const mod = soma % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(d.slice(0, 12), 5);
  const d2 = calc(d.slice(0, 12) + String(d1), 6);
  return d === d.slice(0, 12) + String(d1) + String(d2);
}

async function getJson(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT,
    headers: { Accept: 'application/json', 'User-Agent': UA },
    validateStatus: () => true,
  });
  return res;
}

function fone(raw) {
  const d = digitos(raw);
  if (d.length >= 10) return { ddd: d.slice(0, 2), numero: d.slice(2) };
  return { ddd: '', numero: d };
}

async function acharCidade(pool, uf, nome) {
  const u = String(uf || '').trim().toUpperCase();
  const n = String(nome || '').trim();
  if (!u || !n || !pool) return null;
  const r = await pool.query(
    `SELECT "CDCIDADE", "NMCIDADE", "ESTADO"
       FROM "CIDADE"
      WHERE "FGACTIVE" = 'A' AND "ESTADO" = $1
        AND translate(upper(trim("NMCIDADE")), 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')
          = translate(upper(trim($2)), 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')
      LIMIT 1`,
    [u, n]
  );
  return r.rows[0] || null;
}

async function cepBrasil(d) {
  const res = await getJson('https://brasilapi.com.br/api/cep/v1/' + d);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.data) {
    const err = new Error('BrasilAPI CEP ' + res.status);
    err.httpStatus = res.status;
    throw err;
  }
  const data = res.data;
  if (!data.city && !data.state) return null;
  return {
    cep: formatarCep(digitos(data.cep || d)),
    logradouro: data.street || '',
    complemento: '',
    bairro: data.neighborhood || '',
    localidade: data.city || '',
    uf: String(data.state || '').toUpperCase(),
    numero: '',
  };
}

async function cepVia(d) {
  const res = await getJson('https://viacep.com.br/ws/' + d + '/json/');
  if (res.status !== 200 || !res.data || res.data.erro) return null;
  const data = res.data;
  return {
    cep: formatarCep(digitos(data.cep || d)),
    logradouro: data.logradouro || '',
    complemento: data.complemento || '',
    bairro: data.bairro || '',
    localidade: data.localidade || '',
    uf: String(data.uf || '').toUpperCase(),
    numero: '',
  };
}

async function consultarCep(pool, cep) {
  const d = digitos(cep);
  if (d.length !== 8) return { status: 400, body: { error: 'CEP deve ter 8 dígitos.' } };
  let dados = null;
  try {
    dados = await cepBrasil(d);
  } catch (e) {
    dados = null;
  }
  if (!dados) {
    try { dados = await cepVia(d); } catch (e) { dados = null; }
  }
  if (!dados) return { status: 404, body: { error: 'CEP não encontrado.' } };
  const cidade = await acharCidade(pool, dados.uf, dados.localidade);
  return { status: 200, body: { ...dados, cidade } };
}

async function consultarCnpj(pool, d) {
  const res = await getJson('https://brasilapi.com.br/api/cnpj/v1/' + d);
  if (res.status === 404) return { status: 404, body: { error: 'CNPJ não encontrado.' } };
  if (res.status === 403 || res.status === 429) {
    return { status: 502, body: { error: 'A consulta de CNPJ recusou agora. Tente de novo em alguns minutos.' } };
  }
  if (res.status !== 200 || !res.data) {
    return { status: 502, body: { error: 'A consulta de CNPJ não respondeu.' } };
  }
  const data = res.data;
  if (!data.razao_social && !data.nome_fantasia) {
    return { status: 502, body: { error: 'A consulta veio sem razão social.' } };
  }
  const tel = fone(data.ddd_telefone_1);
  const cep = digitos(data.cep);
  const cidade = await acharCidade(pool, data.uf, data.municipio);
  return {
    status: 200,
    body: {
      tipo: 'J',
      documento: formatarCnpj(d),
      valido: true,
      consultaPublica: true,
      mensagem: data.descricao_situacao_cadastral
        ? 'CNPJ consultado. Situação: ' + data.descricao_situacao_cadastral + '.'
        : 'CNPJ consultado.',
      campos: {
        razaoSocial: data.razao_social || data.nome_fantasia || '',
        nomeFantasia: data.nome_fantasia || data.razao_social || '',
        email: data.email || '',
        ddi: '55',
        ddd: tel.ddd,
        telefone: tel.numero,
        celular: tel.ddd && tel.numero ? tel.ddd + tel.numero : tel.numero,
        cep: cep.length === 8 ? formatarCep(cep) : '',
        logradouro: data.logradouro || '',
        numero: data.numero || '',
        complemento: data.complemento || '',
        bairro: data.bairro || '',
        localidade: data.municipio || '',
        uf: String(data.uf || '').toUpperCase(),
        cidade,
        situacao: data.descricao_situacao_cadastral || '',
      },
    },
  };
}

async function consultarDocumento(pool, doc) {
  const d = digitos(doc);
  if (d.length === 11) {
    if (!cpfValido(d)) return { status: 422, body: { error: 'CPF inválido.' } };
    return {
      status: 200,
      body: {
        tipo: 'F',
        documento: formatarCpf(d),
        valido: true,
        consultaPublica: false,
        mensagem: 'CPF válido. O nome da pessoa física não sai em consulta pública.',
        campos: {},
      },
    };
  }
  if (d.length === 14) {
    if (!cnpjValido(d)) return { status: 422, body: { error: 'CNPJ inválido.' } };
    try {
      return await consultarCnpj(pool, d);
    } catch (e) {
      return { status: 502, body: { error: 'A consulta de CNPJ não respondeu.' } };
    }
  }
  return { status: 422, body: { error: 'Informe um CPF com 11 dígitos ou um CNPJ com 14.' } };
}

module.exports = {
  digitos,
  cpfValido,
  cnpjValido,
  consultarCep,
  consultarDocumento,
  consultarCnpj,
};
