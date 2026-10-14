// backend/routes/cidades.routes.js
// Gerenciar Cidades - API
// Versão: 1.0
// Atlas Cargo
// Data: 2026-04-05

const express = require('express');
const sql = require('../config/mssql-compat');
const axios = require('axios');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { getForwardGeocodingUrl, getNominatimServer } = require('../config/nominatim');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { listEstados } = require('../controllers/estado-public.controller');

// Constante de Estados do Brasil
const ESTADOS_BRASIL = [
  { uf: "AC", nome: "Acre" },
  { uf: "AL", nome: "Alagoas" },
  { uf: "AP", nome: "Amapá" },
  { uf: "AM", nome: "Amazonas" },
  { uf: "BA", nome: "Bahia" },
  { uf: "CE", nome: "Ceará" },
  { uf: "DF", nome: "Distrito Federal" },
  { uf: "ES", nome: "Espírito Santo" },
  { uf: "GO", nome: "Goiás" },
  { uf: "MA", nome: "Maranhão" },
  { uf: "MT", nome: "Mato Grosso" },
  { uf: "MS", nome: "Mato Grosso do Sul" },
  { uf: "MG", nome: "Minas Gerais" },
  { uf: "PA", nome: "Pará" },
  { uf: "PB", nome: "Paraíba" },
  { uf: "PR", nome: "Paraná" },
  { uf: "PE", nome: "Pernambuco" },
  { uf: "PI", nome: "Piauí" },
  { uf: "RJ", nome: "Rio de Janeiro" },
  { uf: "RN", nome: "Rio Grande do Norte" },
  { uf: "RS", nome: "Rio Grande do Sul" },
  { uf: "RO", nome: "Rondônia" },
  { uf: "RR", nome: "Roraima" },
  { uf: "SC", nome: "Santa Catarina" },
  { uf: "SP", nome: "São Paulo" },
  { uf: "SE", nome: "Sergipe" },
  { uf: "TO", nome: "Tocantins" }
];

// Função auxiliar para converter UF em nome completo do estado
function getNomeEstadoPorUF(uf) {
  const estado = ESTADOS_BRASIL.find(e => e.uf === uf.toUpperCase());
  return estado ? estado.nome : uf;
}

// Códigos CDUF (IBGE) por UF – fallback quando a tabela ESTADO estiver vazia (usado por /estado-cduf público)
const UF_PARA_CDUF = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17
};

// --- Rotas públicas (app motorista / cadastro sem JWT da torre): apenas leitura de catálogos ---
router.get('/paises', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.query(`
      SELECT "CDPAIS", "DSPAIS",
             COALESCE(NULLIF(TRIM("SGPAIS"), ''), "CDPAIS"::TEXT) AS "SGPAIS",
             NULLIF(TRIM(COALESCE("DDI", '')), '') AS "DDI"
      FROM "PAIS"
      ORDER BY "DSPAIS"
    `);
    res.json(result.rows || []);
  } catch (err) {
    if (err.code === '42703') {
      try {
        const pool = await poolPromise;
        const result = await pool.query(`
          SELECT "CDPAIS", "DSPAIS", "CDPAIS"::TEXT AS "SGPAIS", NULL AS "DDI"
          FROM "PAIS"
          ORDER BY "DSPAIS"
        `);
        return res.json(result.rows || []);
      } catch (e) {
        console.error('Erro ao buscar países (fallback):', e);
        return res.status(500).json({ error: 'Erro ao carregar países.' });
      }
    }
    console.error('Erro ao buscar países:', err);
    res.status(500).json({ error: 'Erro ao carregar países.' });
  }
});

router.get('/estados-brasil', (req, res) => {
  res.json(ESTADOS_BRASIL);
});

// Estados por país (AR, PY, etc.) — público; deve vir antes de router.use(towerAuthAndTenant).
router.get('/estados', listEstados);

router.get('/estado-cduf/:estado', async (req, res) => {
  try {
    const { estado } = req.params;
    const uf = (estado || '').toUpperCase().trim();
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT "CDUF" FROM "ESTADO" WHERE "ESTADO" = $1 LIMIT 1`,
      [uf]
    );
    const rows = result.rows || [];
    if (rows.length > 0) {
      const cduf = rows[0].CDUF ?? rows[0].cduf;
      return res.json({ CDUF: cduf });
    }
    const cdufFallback = UF_PARA_CDUF[uf];
    if (cdufFallback !== undefined) {
      return res.json({ CDUF: cdufFallback });
    }
    res.status(404).json({ error: 'Estado não encontrado.' });
  } catch (err) {
    console.error('Erro ao buscar CDUF do estado:', err);
    res.status(500).json({ error: 'Erro ao buscar código do estado.' });
  }
});

router.get('/mesorregioes/:cduf', async (req, res) => {
  try {
    const { cduf } = req.params;
    const cdufNum = parseInt(cduf, 10);

    if (isNaN(cdufNum)) {
      return res.status(400).json({ error: 'CDUF inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT "CDUF", "CDMESOREGIAO", "DSMESOREGIAO"
       FROM "MESOREGIAO"
       WHERE "CDUF" = $1
       ORDER BY "DSMESOREGIAO"`,
      [cdufNum]
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error('Erro ao buscar mesorregiões:', err);
    res.status(500).json({ error: 'Erro ao carregar mesorregiões.' });
  }
});

router.use(towerAuthAndTenant);

// Listar cidades com filtros (PostgreSQL)
router.get('/cidades', async (req, res) => {
  try {
    const { estado, cidade, situacao, pais, areaDDD, mesoregiao, microregiao, regiaoFiscal } = req.query;
    const pool = await poolPromise;
    const values = [];
    let paramIndex = 0;
    const pushVal = (v) => { values.push(v); return `$${++paramIndex}`; };

    let query = `
      SELECT "CDCIDADE", "ESTADO", "NMCIDADE", "FGACTIVE", "CDPAIS", "CDUF", "CDMUNICIPIO",
             "CDAREADDD", "CDMICROREGIAO", "CDMESOREGIAO", "CDREGIAOFISCAL"
      FROM "CIDADE"
      WHERE 1=1
    `;
    if (pais) query += ` AND "CDPAIS" = ${pushVal(parseInt(pais))}`;
    if (estado) query += ` AND "ESTADO" = ${pushVal(estado)}`;
    if (cidade) query += ` AND "NMCIDADE" LIKE ${pushVal(`%${cidade}%`)}`;
    if (areaDDD) query += ` AND "CDAREADDD" = ${pushVal(parseInt(areaDDD))}`;
    if (mesoregiao) query += ` AND "CDMESOREGIAO" = ${pushVal(parseInt(mesoregiao))}`;
    if (microregiao) query += ` AND "CDMICROREGIAO" = ${pushVal(parseInt(microregiao))}`;
    if (regiaoFiscal) query += ` AND "CDREGIAOFISCAL" = ${pushVal(parseInt(regiaoFiscal))}`;
    if (situacao) query += ` AND "FGACTIVE" = ${pushVal(situacao === 'S' ? 'A' : 'I')}`;
    query += ` ORDER BY "ESTADO", "NMCIDADE"`;

    const result = await pool.query(query, values);
    const cidades = (result.rows || []).map(c => ({
      CDCIDADE: c.CDCIDADE,
      ESTADO: c.ESTADO,
      NMCIDADE: c.NMCIDADE,
      FGACTIVE: c.FGACTIVE === 'A' ? 'S' : 'N',
      CDPAIS: c.CDPAIS,
      CDUF: c.CDUF,
      CDMUNICIPIO: c.CDMUNICIPIO,
      CDAREADDD: c.CDAREADDD,
      CDMICROREGIAO: c.CDMICROREGIAO,
      CDMESOREGIAO: c.CDMESOREGIAO,
      CDREGIAOFISCAL: c.CDREGIAOFISCAL
    }));
    res.json(cidades);
  } catch (err) {
    console.error('Erro ao listar cidades:', err);
    res.status(500).json({ error: 'Erro ao carregar cidades.' });
  }
});

// Inserir nova cidade
router.post('/cidades', async (req, res) => {
  try {
    const { ESTADO, NMCIDADE, CDUF, CDMUNICIPIO, CDPAIS, CDAREADDD, CDMICROREGIAO, CDMESOREGIAO, CDREGIAOFISCAL } = req.body;
    if (!ESTADO || !NMCIDADE?.trim() || !CDUF || !CDMUNICIPIO) {
      return res.status(400).json({ error: 'Estado, Cidade, Código UF e Código Município são obrigatórios.' });
    }

    const pool = await poolPromise;
    const maxRes = await pool.query('SELECT COALESCE(MAX("CDCIDADE"), 0)::int AS "maxId" FROM "CIDADE"');
    const novoId = Number((maxRes.rows || [])[0]?.maxId ?? 0) + 1;

    await pool.query(
      `INSERT INTO "CIDADE" (
        "CDCIDADE", "ESTADO", "NMCIDADE", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG",
        "CDPAIS", "CDUF", "CDMUNICIPIO", "CDAREADDD", "CDMICROREGIAO", "CDMESOREGIAO", "CDREGIAOFISCAL"
      ) VALUES ($1, $2, $3, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', $4, $5, $6, $7, $8, $9, $10)`,
      [
        novoId, ESTADO, NMCIDADE.trim(),
        CDPAIS ?? null, CDUF, CDMUNICIPIO,
        CDAREADDD ?? null, CDMICROREGIAO ?? null, CDMESOREGIAO ?? null, CDREGIAOFISCAL ?? null
      ]
    );

    res.status(201).json({ success: true, message: 'Cidade cadastrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir cidade:', err);
    res.status(500).json({ error: 'Erro ao cadastrar cidade.' });
  }
});

// Atualizar cidade
router.put('/cidades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ESTADO, NMCIDADE, FGACTIVE, CDUF, CDMUNICIPIO, CDPAIS, CDAREADDD, CDMICROREGIAO, CDMESOREGIAO, CDREGIAOFISCAL } = req.body;

    if (!ESTADO || !NMCIDADE?.trim() || !['S', 'N'].includes(FGACTIVE) || !CDUF || !CDMUNICIPIO) {
      return res.status(400).json({ error: 'Dados inválidos. Estado, Cidade, Situação, Código UF e Código Município são obrigatórios.' });
    }

    const pool = await poolPromise;
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const idNumerico = parseInt(id);

    await pool.query(
      `UPDATE "CIDADE" SET
        "ESTADO" = $1, "NMCIDADE" = $2, "FGACTIVE" = $3, "CDPAIS" = $4, "CDUF" = $5, "CDMUNICIPIO" = $6,
        "CDAREADDD" = $7, "CDMICROREGIAO" = $8, "CDMESOREGIAO" = $9, "CDREGIAOFISCAL" = $10,
        "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
      WHERE "CDCIDADE" = $11`,
      [
        ESTADO, NMCIDADE.trim(), fgactiveDB, CDPAIS ?? null, CDUF, CDMUNICIPIO,
        CDAREADDD ?? null, CDMICROREGIAO ?? null, CDMESOREGIAO ?? null, CDREGIAOFISCAL ?? null, idNumerico
      ]
    );

    res.json({ success: true, message: 'Cidade atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar cidade:', err);
    res.status(500).json({ error: 'Erro ao atualizar cidade.' });
  }
});

// Distância Haversine em metros (fallback rota internacional quando OSRM retorna NoRoute)
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildAndSendFallbackRoute(res, lon1, lat1, lon2, lat2) {
  const distanceM = haversineMeters(lat1, lon1, lat2, lon2);
  res.json({
    code: 'Ok',
    routes: [{
      geometry: {
        type: 'LineString',
        coordinates: [[lon1, lat1], [lon2, lat2]]
      },
      distance: distanceM,
      duration: 0
    }]
  });
}

// Endpoint para obter rota usando OSRM (Open Source Routing Machine)
// Rotas internacionais (ex.: Paraguai → Brasil): OSRM pode retornar NoRoute; nesse caso retornamos 200 com linha reta.
// IMPORTANTE: Esta rota deve vir ANTES de /cidades/:id para não ser capturada como parâmetro
router.get('/cidades/rota', async (req, res) => {
  try {
    const { lon1, lat1, lon2, lat2 } = req.query;
    
    if (!lon1 || !lat1 || !lon2 || !lat2) {
      return res.status(400).json({ error: 'Coordenadas de origem e destino são obrigatórias.' });
    }

    const lonA = parseFloat(lon1);
    const latA = parseFloat(lat1);
    const lonB = parseFloat(lon2);
    const latB = parseFloat(lat2);

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
    
    try {
      const response = await axios.get(osrmUrl, {
        headers: {
          'User-Agent': 'AtlasCargo/2.0'
        },
        timeout: 20000
      });
      
      const data = response.data;
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        return res.json(data);
      }
      buildAndSendFallbackRoute(res, lonA, latA, lonB, latB);
    } catch (err) {
      const status = err.response && err.response.status;
      const body = err.response && err.response.data;
      if (status === 400 && body && (body.code === 'NoRoute' || (body.message && String(body.message).toLowerCase().includes('no route')))) {
        buildAndSendFallbackRoute(res, lonA, latA, lonB, latB);
        return;
      }
      console.warn('OSRM sem rota ou indisponível (ex.: rota internacional). Usando linha reta:', err.message);
      buildAndSendFallbackRoute(res, lonA, latA, lonB, latB);
    }
  } catch (err) {
    console.error('Erro ao buscar rota:', err.message);
    res.status(500).json({ error: 'Erro ao buscar rota.' });
  }
});

// Endpoint para obter coordenadas de uma cidade usando OpenStreetMap Nominatim
// IMPORTANTE: Esta rota deve vir ANTES de /cidades/:id para não ser capturada como parâmetro
router.get('/cidades/coordenadas', async (req, res) => {
  try {
    const { cidade, estado, pais } = req.query;
    
    if (!cidade || !estado) {
      return res.status(400).json({ 
        success: false,
        error: 'Cidade e Estado são obrigatórios.' 
      });
    }

    if (typeof estado !== 'string' || estado.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Estado inválido.' 
      });
    }

    const nomeEstado = getNomeEstadoPorUF(estado);
    const isBrasil = !!nomeEstado;
    
    let query;
    let url;
    let nomeEstadoParaMatch = nomeEstado || estado.trim();
    
    if (isBrasil) {
      query = `${cidade}, ${nomeEstado}, Brasil`;
      url = getForwardGeocodingUrl(query, { limit: 10, countrycodes: 'br' });
    } else {
      let paisStr = (pais != null && String(pais).trim() !== '') ? String(pais).trim() : '';
      if (paisStr && /^\d+$/.test(paisStr)) {
        try {
          const pool = await poolPromise;
          const r = await pool.query('SELECT "DSPAIS" FROM "PAIS" WHERE "CDPAIS" = $1', [parseInt(paisStr, 10)]);
          if (r.rows && r.rows[0] && r.rows[0].DSPAIS) paisStr = r.rows[0].DSPAIS;
        } catch (e) {
          // manter código numérico se falhar
        }
      }
      query = paisStr ? `${cidade}, ${estado.trim()}, ${paisStr}` : `${cidade}, ${estado.trim()}`;
      url = getForwardGeocodingUrl(query, { limit: 10 });
    }
    
    let response;
    try {
      response = await axios.get(url, {
        headers: {
          'User-Agent': 'AtlasCargo/2.0'
        },
        timeout: 15000
      });
    } catch (err) {
      console.error('Erro na requisição ao Nominatim:', err.message);
      console.error('URL tentada:', url);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao conectar com o serviço de geocodificação.',
        details: err.message
      });
    }
    
    // Filtrar resultados para encontrar a cidade correta
    let resultado = null;
    if (response.data && response.data.length > 0) {
      const nomeCidadeLower = cidade.toLowerCase().trim();
      const nomeEstadoLower = nomeEstadoParaMatch.toLowerCase().trim();
      const estadoLower = estado.toLowerCase().trim();
      
      resultado = response.data.find(r => {
        const address = r.address || {};
        const state = (address.state || address.region || '').toLowerCase();
        const city = (address.city || address.town || address.municipality || address.county || address.village || '').toLowerCase();
        const displayName = (r.display_name || '').toLowerCase();
        
        const estadoMatch = state.includes(nomeEstadoLower) || 
                           state.includes(estadoLower) ||
                           displayName.includes(nomeEstadoLower);
        
        const cidadeMatch = city.includes(nomeCidadeLower) || 
                           displayName.includes(nomeCidadeLower) ||
                           nomeCidadeLower.includes(city);
        
        return estadoMatch && cidadeMatch;
      });
      
      if (!resultado && response.data.length > 0) {
        resultado = response.data.find(r => {
          const address = r.address || {};
          const state = (address.state || address.region || '').toLowerCase();
          const displayName = (r.display_name || '').toLowerCase();
          return state.includes(nomeEstadoLower) || 
                 state.includes(estadoLower) ||
                 displayName.includes(nomeEstadoLower) ||
                 displayName.includes(estadoLower);
        });
      }
      
      // Se ainda não encontrou, usar o primeiro resultado que contenha o nome da cidade
      if (!resultado && response.data.length > 0) {
        resultado = response.data.find(r => {
          const displayName = (r.display_name || '').toLowerCase();
          return displayName.includes(nomeCidadeLower);
        });
      }
      
      // Se ainda não encontrou, usar o primeiro resultado (mais permissivo)
      if (!resultado && response.data.length > 0) {
        resultado = response.data[0];
      }
    }
    
    // Estratégia 2: Só para Brasil — se não encontrou, tentar apenas com a cidade
    if (!resultado && isBrasil) {
      query = `${cidade}, Brasil`;
      url = getForwardGeocodingUrl(query, { limit: 10, countrycodes: 'br' });
      
      try {
        response = await axios.get(url, {
          headers: {
            'User-Agent': 'AtlasCargo/2.0'
          },
          timeout: 15000
        });
        
        if (response.data && response.data.length > 0) {
          const nomeCidadeLower = cidade.toLowerCase().trim();
          resultado = response.data.find(r => {
            const address = r.address || {};
            const state = (address.state || address.region || '').toLowerCase();
            const displayName = (r.display_name || '').toLowerCase();
            const temEstado = state.includes(nomeEstadoParaMatch.toLowerCase()) || 
                            state.includes(estado.toLowerCase()) ||
                            displayName.includes(nomeEstadoParaMatch.toLowerCase());
            const temCidade = displayName.includes(nomeCidadeLower);
            return temEstado && temCidade;
          });
          
          if (!resultado && response.data.length > 0) {
            resultado = response.data.find(r => {
              const displayName = (r.display_name || '').toLowerCase();
              return displayName.includes(nomeCidadeLower);
            });
          }
          
          if (!resultado && response.data.length > 0) {
            resultado = response.data[0];
          }
        }
      } catch (err2) {
        console.error('Erro na busca genérica:', err2.message);
      }
    }
    
    if (resultado) {
      res.json({
        success: true,
        lat: parseFloat(resultado.lat),
        lon: parseFloat(resultado.lon),
        display_name: resultado.display_name
      });
    } else {
      res.json({ 
        success: false, 
        error: `Cidade "${cidade}" não encontrada no estado "${nomeEstadoParaMatch}". Verifique se o nome da cidade está correto.` 
      });
    }
  } catch (err) {
    console.error('Erro ao buscar coordenadas:', err.message);
    console.error('Stack:', err.stack);
    console.error('Request params:', { cidade: req.query.cidade, estado: req.query.estado });
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar coordenadas. Tente novamente.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Buscar cidade por ID (PostgreSQL)
router.get('/cidades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT "CDCIDADE", "ESTADO", "NMCIDADE", "FGACTIVE", "CDPAIS", "CDUF", "CDMUNICIPIO",
              "CDAREADDD", "CDMICROREGIAO", "CDMESOREGIAO", "CDREGIAOFISCAL"
       FROM "CIDADE" WHERE "CDCIDADE" = $1`,
      [parseInt(id)]
    );
    const rows = result.rows || [];
    if (rows.length === 0) return res.status(404).json({ error: 'Cidade não encontrada.' });
    const cidade = rows[0];
    res.json({
      CDCIDADE: cidade.CDCIDADE,
      ESTADO: cidade.ESTADO,
      NMCIDADE: cidade.NMCIDADE,
      FGACTIVE: cidade.FGACTIVE === 'A' ? 'S' : 'N',
      CDPAIS: cidade.CDPAIS,
      CDUF: cidade.CDUF,
      CDMUNICIPIO: cidade.CDMUNICIPIO,
      CDAREADDD: cidade.CDAREADDD,
      CDMICROREGIAO: cidade.CDMICROREGIAO,
      CDMESOREGIAO: cidade.CDMESOREGIAO,
      CDREGIAOFISCAL: cidade.CDREGIAOFISCAL
    });
  } catch (err) {
    console.error('Erro ao buscar cidade:', err);
    res.status(500).json({ error: 'Erro ao carregar cidade.' });
  }
});

// Inativar/Reativar cidade (desativação, não exclusão física)
router.delete('/cidades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    
    // Validar e converter ID para número
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;

    const checkResult = await pool.query(
      'SELECT "FGACTIVE" FROM "CIDADE" WHERE "CDCIDADE" = $1',
      [idNumerico]
    );
    const checkRows = checkResult.rows || [];
    if (checkRows.length === 0) return res.status(404).json({ error: 'Cidade não encontrada.' });

    const statusAtual = checkRows[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Cidade reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Cidade desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Cidade desativada com sucesso!' : 'Cidade reativada com sucesso!';
    }

    const result = await pool.query(
      `UPDATE "CIDADE" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas' WHERE "CDCIDADE" = $2`,
      [novaSituacao, idNumerico]
    );
    if ((result.rowCount ?? 0) === 0) return res.status(404).json({ error: 'Cidade não encontrada.' });

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da cidade:', err);
    res.status(500).json({ error: 'Erro ao alterar status da cidade.' });
  }
});

// Buscar microrregiões por CDUF
router.get('/microrregioes/:cduf', async (req, res) => {
  try {
    const { cduf } = req.params;
    const cdufNum = parseInt(cduf);
    
    if (isNaN(cdufNum)) {
      return res.status(400).json({ error: 'CDUF inválido.' });
    }
    
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT "CDUF", "CDMICROREGIAO", "DSMICROREGIAO"
       FROM "MICROREGIAO"
       WHERE "CDUF" = $1
       ORDER BY "DSMICROREGIAO"`,
      [cdufNum]
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error('Erro ao buscar microrregiões:', err);
    res.status(500).json({ error: 'Erro ao carregar microrregiões.' });
  }
});

// Buscar todas as regiões fiscais (PostgreSQL)
router.get('/regioes-fiscais', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.query(`
      SELECT "CDREGIAOFISCAL" AS "CDREGIAOFISCAL", "DSREGIAOFISCAL" AS "DSREGIAOFISCAL"
      FROM "REGIAOFISCAL"
      ORDER BY "DSREGIAOFISCAL"
    `);
    res.json(result.rows || []);
  } catch (err) {
    console.error('Erro ao buscar regiões fiscais:', err);
    res.status(500).json({ error: 'Erro ao carregar regiões fiscais.' });
  }
});

// Buscar DDD por código IBGE completo (PostgreSQL)
router.get('/ddd-por-ibge/:codigoIBGE', async (req, res) => {
  try {
    const { codigoIBGE } = req.params;
    const codigoIBGENum = parseInt(codigoIBGE);
    if (isNaN(codigoIBGENum) || codigoIBGENum <= 0) {
      return res.status(400).json({ error: 'Código IBGE inválido.' });
    }
    const pool = await poolPromise;
    try {
      const rMunicipio = await pool.query(
        `SELECT "DDD" FROM "MUNICIPIO" WHERE "CodigoIBGE" = $1 AND "DDD" IS NOT NULL AND TRIM("DDD") != '' LIMIT 1`,
        [codigoIBGENum]
      );
      const rowsM = rMunicipio.rows || [];
      if (rowsM.length > 0 && rowsM[0].DDD) {
        const ddd = parseInt(rowsM[0].DDD, 10);
        return res.json({ CDAREADDD: ddd, origem: 'tabela_municipio' });
      }
    } catch (_) {}
    const codigoMunicipio = codigoIBGENum % 100000;
    const rCidade = await pool.query(
      `SELECT "CDAREADDD" FROM "CIDADE" WHERE "CDMUNICIPIO" = $1 AND "CDAREADDD" IS NOT NULL AND "CDAREADDD" > 0 ORDER BY "DHMAINTENANCE" DESC NULLS LAST LIMIT 1`,
      [codigoMunicipio]
    );
    const rowsC = rCidade.rows || [];
    if (rowsC.length > 0 && rowsC[0].CDAREADDD) {
      return res.json({ CDAREADDD: rowsC[0].CDAREADDD, origem: 'tabela_cidade' });
    }
    res.json({ CDAREADDD: null, origem: 'nao_encontrado', mensagem: 'DDD não encontrado. Preencha manualmente.' });
  } catch (err) {
    console.error('Erro ao buscar DDD por código IBGE:', err);
    res.status(500).json({ error: 'Erro ao buscar DDD.' });
  }
});

module.exports = router;