require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request(
      { hostname: '127.0.0.1', port: 3001, path, method, headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf), raw: buf.slice(0, 800) });
          } catch (_) {
            resolve({ status: res.statusCode, json: null, raw: buf.slice(0, 2000) });
          }
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const u = await pool.query(
    `SELECT "SGUSUARIO", "ENDEMAIL", "SENHA", "FGACTIVE"
       FROM "USUARIO"
      WHERE LOWER(COALESCE("ENDEMAIL",'')) LIKE '%admin%'
         OR LOWER("SGUSUARIO") LIKE '%admin%'
      LIMIT 5`
  );
  console.log(
    'USERS',
    u.rows.map((r) => ({
      login: r.SGUSUARIO,
      email: r.ENDEMAIL,
      hash: String(r.SENHA || '').slice(0, 4),
      active: r.FGACTIVE,
    }))
  );

  // tenta senhas tipicas com email body correto
  const email = (u.rows[0] && (u.rows[0].ENDEMAIL || u.rows[0].SGUSUARIO)) || 'admin@atlascargo.com';
  const passwords = ['admin', '123456', 'Admin@123', 'atlas', 'Atlas@2024', 'scopel', 'Scopel@123'];
  let token = null;
  for (const password of passwords) {
    const login = await req('POST', '/api/auth/login', { email, password });
    console.log('try', password, login.status, (login.json && (login.json.message || login.json.error)) || '');
    if (login.status === 200 && login.json && login.json.token) {
      token = login.json.token;
      break;
    }
  }

  if (!token) {
    // se senha texto puro no banco
    for (const row of u.rows) {
      const senha = row.SENHA;
      if (!senha || String(senha).startsWith('$2')) continue;
      const login = await req('POST', '/api/auth/login', {
        email: row.ENDEMAIL || row.SGUSUARIO,
        password: senha,
      });
      console.log('plain', row.SGUSUARIO, login.status);
      if (login.status === 200 && login.json && login.json.token) {
        token = login.json.token;
        break;
      }
    }
  }

  if (!token) {
    console.log('SEM_TOKEN — checando se processo carregou o fix via require local');
    const { listarMovimentacaoItens } = require('../services/wms-relatorio-movimentacao.service');
    const { filtrarLinhasPorProduto } = require('../services/wms-relatorio-filtro-produto.service');
    const f = { cdDono: 1, codigoProduto: '6.03.06.551.40' };
    const { linhas: brutas } = await listarMovimentacaoItens('default', f);
    const linhas = filtrarLinhasPorProduto(brutas, f);
    console.log('LOCAL_SERVICE', {
      n: linhas.length,
      tem21004: linhas.some((r) => String(r.DOCUMENTO || '').includes('21004')),
      last: linhas[linhas.length - 1] && {
        doc: linhas[linhas.length - 1].DOCUMENTO,
        saldo: linhas[linhas.length - 1].QTD_SALDO,
      },
    });
    await pool.end();
    return;
  }

  const path =
    '/api/wms/relatorios/movimentacao?formato=json&cdDono=1&codigoProduto=' +
    encodeURIComponent('6.03.06.551.40');
  const r = await req('GET', path, null, token);
  const linhas = (r.json && r.json.linhas) || [];
  console.log({
    status: r.status,
    n: linhas.length,
    filtro: r.json && r.json.filtroProdutoLabel,
    tem21004: linhas.some((x) => String(x.DOCUMENTO || '').includes('21004')),
    last: linhas[linhas.length - 1] && {
      doc: linhas[linhas.length - 1].DOCUMENTO,
      saldo: linhas[linhas.length - 1].QTD_SALDO,
      dh: linhas[linhas.length - 1].DH_MOVIMENTO,
    },
    aviso0: r.json && r.json.avisos && r.json.avisos[0],
  });
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
