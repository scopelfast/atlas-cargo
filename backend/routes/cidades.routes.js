// backend/routes/cidades.routes.js
// Gerenciar Cidades - API
// Versão: 1.0
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const express = require('express');
const sql = require('mssql');
const axios = require('axios');
const router = express.Router();
const { poolPromise } = require('../config/db');

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

// Listar cidades com filtros
router.get('/cidades', async (req, res) => {
  try {
    const { estado, cidade, situacao, pais, areaDDD, mesoregiao, microregiao, regiaoFiscal } = req.query;
    let query = `
      SELECT 
        CDCIDADE,
        ESTADO,
        NMCIDADE,
        FGACTIVE,
        CDPAIS,
        CDUF,
        CDMUNICIPIO,
        CDAREADDD,
        CDMICROREGIAO,
        CDMESOREGIAO,
        CDREGIAOFISCAL
      FROM [dbo].[CIDADE]
      WHERE 1=1
    `;

    const params = [];
    if (pais) {
      query += ` AND CDPAIS = @PAIS`;
      params.push({ name: 'PAIS', value: parseInt(pais) });
    }
    if (estado) {
      query += ` AND ESTADO = @ESTADO`;
      params.push({ name: 'ESTADO', value: estado });
    }
    if (cidade) {
      query += ` AND NMCIDADE LIKE @CIDADE`;
      params.push({ name: 'CIDADE', value: `%${cidade}%` });
    }
    if (areaDDD) {
      query += ` AND CDAREADDD = @AREADDD`;
      params.push({ name: 'AREADDD', value: parseInt(areaDDD) });
    }
    if (mesoregiao) {
      query += ` AND CDMESOREGIAO = @MESOREGIAO`;
      params.push({ name: 'MESOREGIAO', value: parseInt(mesoregiao) });
    }
    if (microregiao) {
      query += ` AND CDMICROREGIAO = @MICROREGIAO`;
      params.push({ name: 'MICROREGIAO', value: parseInt(microregiao) });
    }
    if (regiaoFiscal) {
      query += ` AND CDREGIAOFISCAL = @REGIAOFISCAL`;
      params.push({ name: 'REGIAOFISCAL', value: parseInt(regiaoFiscal) });
    }
    if (situacao) {
      query += ` AND FGACTIVE = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY ESTADO, NMCIDADE`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const cidades = result.recordset.map(c => ({
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
    const maxResult = await pool
      .request()
      .query('SELECT ISNULL(MAX(CDCIDADE), 0) AS maxId FROM [dbo].[CIDADE]');
    const novoId = maxResult.recordset[0].maxId + 1;

    const request = pool.request();
    request.input('CDCIDADE', sql.Int, novoId);
    request.input('ESTADO', ESTADO);
    request.input('NMCIDADE', NMCIDADE.trim());
    if (CDPAIS !== null && CDPAIS !== undefined) {
      request.input('CDPAIS', sql.SmallInt, CDPAIS);
    } else {
      request.input('CDPAIS', sql.SmallInt, null);
    }
    request.input('CDUF', sql.SmallInt, CDUF);
    request.input('CDMUNICIPIO', sql.Int, CDMUNICIPIO);
    if (CDAREADDD !== null && CDAREADDD !== undefined) {
      request.input('CDAREADDD', sql.SmallInt, CDAREADDD);
    } else {
      request.input('CDAREADDD', sql.SmallInt, null);
    }
    if (CDMICROREGIAO !== null && CDMICROREGIAO !== undefined) {
      request.input('CDMICROREGIAO', sql.SmallInt, CDMICROREGIAO);
    } else {
      request.input('CDMICROREGIAO', sql.SmallInt, null);
    }
    if (CDMESOREGIAO !== null && CDMESOREGIAO !== undefined) {
      request.input('CDMESOREGIAO', sql.SmallInt, CDMESOREGIAO);
    } else {
      request.input('CDMESOREGIAO', sql.SmallInt, null);
    }
    if (CDREGIAOFISCAL !== null && CDREGIAOFISCAL !== undefined) {
      request.input('CDREGIAOFISCAL', sql.SmallInt, CDREGIAOFISCAL);
    } else {
      request.input('CDREGIAOFISCAL', sql.SmallInt, null);
    }
    await request.query(`
        INSERT INTO [dbo].[CIDADE] (
          CDCIDADE, ESTADO, NMCIDADE, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG,
          CDPAIS, CDUF, CDMUNICIPIO, CDAREADDD, CDMICROREGIAO, CDMESOREGIAO, CDREGIAOFISCAL
        )
        VALUES (
          @CDCIDADE, @ESTADO, @NMCIDADE, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas',
          @CDPAIS, @CDUF, @CDMUNICIPIO, @CDAREADDD, @CDMICROREGIAO, @CDMESOREGIAO, @CDREGIAOFISCAL
        )
      `);

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

    const request = pool.request();
    request.input('CDCIDADE', sql.Int, idNumerico);
    request.input('ESTADO', ESTADO);
    request.input('NMCIDADE', NMCIDADE.trim());
    request.input('FGACTIVE', fgactiveDB);
    if (CDPAIS !== null && CDPAIS !== undefined) {
      request.input('CDPAIS', sql.SmallInt, CDPAIS);
    } else {
      request.input('CDPAIS', sql.SmallInt, null);
    }
    request.input('CDUF', sql.SmallInt, CDUF);
    request.input('CDMUNICIPIO', sql.Int, CDMUNICIPIO);
    if (CDAREADDD !== null && CDAREADDD !== undefined) {
      request.input('CDAREADDD', sql.SmallInt, CDAREADDD);
    } else {
      request.input('CDAREADDD', sql.SmallInt, null);
    }
    if (CDMICROREGIAO !== null && CDMICROREGIAO !== undefined) {
      request.input('CDMICROREGIAO', sql.SmallInt, CDMICROREGIAO);
    } else {
      request.input('CDMICROREGIAO', sql.SmallInt, null);
    }
    if (CDMESOREGIAO !== null && CDMESOREGIAO !== undefined) {
      request.input('CDMESOREGIAO', sql.SmallInt, CDMESOREGIAO);
    } else {
      request.input('CDMESOREGIAO', sql.SmallInt, null);
    }
    if (CDREGIAOFISCAL !== null && CDREGIAOFISCAL !== undefined) {
      request.input('CDREGIAOFISCAL', sql.SmallInt, CDREGIAOFISCAL);
    } else {
      request.input('CDREGIAOFISCAL', sql.SmallInt, null);
    }
    await request.query(`
        UPDATE [dbo].[CIDADE] 
        SET 
          ESTADO = @ESTADO,
          NMCIDADE = @NMCIDADE,
          FGACTIVE = @FGACTIVE,
          CDPAIS = @CDPAIS,
          CDUF = @CDUF,
          CDMUNICIPIO = @CDMUNICIPIO,
          CDAREADDD = @CDAREADDD,
          CDMICROREGIAO = @CDMICROREGIAO,
          CDMESOREGIAO = @CDMESOREGIAO,
          CDREGIAOFISCAL = @CDREGIAOFISCAL,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCIDADE = @CDCIDADE
      `);

    res.json({ success: true, message: 'Cidade atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar cidade:', err);
    res.status(500).json({ error: 'Erro ao atualizar cidade.' });
  }
});

// Endpoint para obter rota usando OSRM (Open Source Routing Machine)
// IMPORTANTE: Esta rota deve vir ANTES de /cidades/:id para não ser capturada como parâmetro
router.get('/cidades/rota', async (req, res) => {
  try {
    const { lon1, lat1, lon2, lat2 } = req.query;
    
    if (!lon1 || !lat1 || !lon2 || !lat2) {
      return res.status(400).json({ error: 'Coordenadas de origem e destino são obrigatórias.' });
    }

    // Construir URL do OSRM
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
    
    try {
      const response = await axios.get(osrmUrl, {
        headers: {
          'User-Agent': 'DivulgaCarga/1.0 (contact: sistema@divulgacarga.com.br)'
        },
        timeout: 20000 // 20 segundos
      });
      
      res.json(response.data);
    } catch (err) {
      console.error('Erro na requisição ao OSRM:', err.message);
      return res.status(500).json({ 
        error: 'Erro ao conectar com o serviço de roteamento.',
        details: err.message
      });
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
    const { cidade, estado } = req.query;
    
    if (!cidade || !estado) {
      return res.status(400).json({ error: 'Cidade e Estado são obrigatórios.' });
    }

    // Converter UF para nome completo do estado
    const nomeEstado = getNomeEstadoPorUF(estado);
    
    // Estratégia 1: Buscar com "Cidade, Estado, Brasil"
    let query = `${cidade}, ${nomeEstado}, Brasil`;
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&countrycodes=br&addressdetails=1`;
    
    let response;
    try {
      response = await axios.get(url, {
        headers: {
          'User-Agent': 'DivulgaCarga/1.0 (contact: sistema@divulgacarga.com.br)'
        },
        timeout: 15000
      });
    } catch (err) {
      console.error('Erro na requisição ao Nominatim:', err.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao conectar com o serviço de geocodificação.' 
      });
    }
    
    // Filtrar resultados para encontrar a cidade correta
    let resultado = null;
    if (response.data && response.data.length > 0) {
      const nomeCidadeLower = cidade.toLowerCase().trim();
      const nomeEstadoLower = nomeEstado.toLowerCase().trim();
      const estadoLower = estado.toLowerCase().trim();
      
      // Tentar encontrar resultado que corresponda ao estado E cidade
      resultado = response.data.find(r => {
        const address = r.address || {};
        const state = (address.state || address.region || '').toLowerCase();
        const city = (address.city || address.town || address.municipality || address.county || address.village || '').toLowerCase();
        const displayName = (r.display_name || '').toLowerCase();
        
        // Verificar se o estado corresponde (mais flexível)
        const estadoMatch = state.includes(nomeEstadoLower) || 
                           state.includes(estadoLower) ||
                           displayName.includes(nomeEstadoLower);
        
        // Verificar se a cidade corresponde (mais flexível)
        const cidadeMatch = city.includes(nomeCidadeLower) || 
                           displayName.includes(nomeCidadeLower) ||
                           nomeCidadeLower.includes(city);
        
        return estadoMatch && cidadeMatch;
      });
      
      // Se não encontrou correspondência exata, usar o primeiro resultado que tenha o estado correto
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
    
    // Estratégia 2: Se não encontrou, tentar apenas com a cidade
    if (!resultado) {
      query = `${cidade}, Brasil`;
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&countrycodes=br&addressdetails=1`;
      
      try {
        response = await axios.get(url, {
          headers: {
            'User-Agent': 'DivulgaCarga/1.0 (contact: sistema@divulgacarga.com.br)'
          },
          timeout: 15000
        });
        
        if (response.data && response.data.length > 0) {
          // Filtrar por estado se possível
          const nomeCidadeLower = cidade.toLowerCase().trim();
          resultado = response.data.find(r => {
            const address = r.address || {};
            const state = (address.state || address.region || '').toLowerCase();
            const displayName = (r.display_name || '').toLowerCase();
            
            // Verificar se tem o estado E a cidade
            const temEstado = state.includes(nomeEstado.toLowerCase()) || 
                            state.includes(estado.toLowerCase()) ||
                            displayName.includes(nomeEstado.toLowerCase());
            const temCidade = displayName.includes(nomeCidadeLower);
            
            return temEstado && temCidade;
          });
          
          // Se não encontrou com estado, buscar apenas por cidade
          if (!resultado && response.data.length > 0) {
            resultado = response.data.find(r => {
              const displayName = (r.display_name || '').toLowerCase();
              return displayName.includes(nomeCidadeLower);
            });
          }
          
          // Se ainda não encontrou, usar o primeiro resultado
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
      // Retornar erro 200 com success: false ao invés de 404 para melhor tratamento no frontend
      res.json({ 
        success: false, 
        error: `Cidade "${cidade}" não encontrada no estado "${nomeEstado}". Verifique se o nome da cidade está correto.` 
      });
    }
  } catch (err) {
    console.error('Erro ao buscar coordenadas:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar coordenadas. Tente novamente.' 
    });
  }
});

// Buscar cidade por ID
router.get('/cidades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDCIDADE', sql.Int, parseInt(id))
      .query(`
        SELECT 
          CDCIDADE,
          ESTADO,
          NMCIDADE,
          FGACTIVE,
          CDPAIS,
          CDUF,
          CDMUNICIPIO,
          CDAREADDD,
          CDMICROREGIAO,
          CDMESOREGIAO,
          CDREGIAOFISCAL
        FROM [dbo].[CIDADE]
        WHERE CDCIDADE = @CDCIDADE
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cidade não encontrada.' });
    }
    
    const cidade = result.recordset[0];
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

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDCIDADE', sql.Int, idNumerico)
      .query(`SELECT FGACTIVE FROM [dbo].[CIDADE] WHERE CDCIDADE = @CDCIDADE`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Cidade não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
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

    const result = await pool
      .request()
      .input('CDCIDADE', sql.Int, idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[CIDADE] 
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCIDADE = @CDCIDADE
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Cidade não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da cidade:', err);
    res.status(500).json({ error: 'Erro ao alterar status da cidade.' });
  }
});

// Endpoint para listar estados do Brasil
router.get('/estados-brasil', (req, res) => {
  res.json(ESTADOS_BRASIL);
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
    const result = await pool
      .request()
      .input('CDUF', sql.SmallInt, cdufNum)
      .query(`
        SELECT 
          CDUF,
          CDMICROREGIAO,
          DSMICROREGIAO
        FROM [dbo].[MICROREGIAO]
        WHERE CDUF = @CDUF
        ORDER BY DSMICROREGIAO
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao buscar microrregiões:', err);
    res.status(500).json({ error: 'Erro ao carregar microrregiões.' });
  }
});

// Buscar mesorregiões por CDUF
router.get('/mesorregioes/:cduf', async (req, res) => {
  try {
    const { cduf } = req.params;
    const cdufNum = parseInt(cduf);
    
    if (isNaN(cdufNum)) {
      return res.status(400).json({ error: 'CDUF inválido.' });
    }
    
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDUF', sql.SmallInt, cdufNum)
      .query(`
        SELECT 
          CDUF,
          CDMESOREGIAO,
          DSMESOREGIAO
        FROM [dbo].[MESOREGIAO]
        WHERE CDUF = @CDUF
        ORDER BY DSMESOREGIAO
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao buscar mesorregiões:', err);
    res.status(500).json({ error: 'Erro ao carregar mesorregiões.' });
  }
});

// Buscar todas as regiões fiscais
router.get('/regioes-fiscais', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(`
        SELECT 
          CDREGIAOFISCAL,
          DSREGIAOFISCAL
        FROM [dbo].[REGIAOFISCAL]
        ORDER BY DSREGIAOFISCAL
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao buscar regiões fiscais:', err);
    res.status(500).json({ error: 'Erro ao carregar regiões fiscais.' });
  }
});

// Buscar CDUF a partir do ESTADO (UF)
router.get('/estado-cduf/:estado', async (req, res) => {
  try {
    const { estado } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('ESTADO', estado)
      .query(`
        SELECT TOP 1 CDUF
        FROM [dbo].[ESTADO]
        WHERE ESTADO = @ESTADO
      `);
    if (result.recordset.length > 0) {
      res.json({ CDUF: result.recordset[0].CDUF });
    } else {
      res.status(404).json({ error: 'Estado não encontrado.' });
    }
  } catch (err) {
    console.error('Erro ao buscar CDUF do estado:', err);
    res.status(500).json({ error: 'Erro ao buscar código do estado.' });
  }
});

// Buscar todos os países
router.get('/paises', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(`
        SELECT 
          CDPAIS,
          DSPAIS
        FROM [dbo].[PAIS]
        ORDER BY DSPAIS
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao buscar países:', err);
    res.status(500).json({ error: 'Erro ao carregar países.' });
  }
});

// Buscar DDD por código IBGE completo (7 dígitos: CDUF + CDMUNICIPIO)
router.get('/ddd-por-ibge/:codigoIBGE', async (req, res) => {
  try {
    const { codigoIBGE } = req.params;
    const codigoIBGENum = parseInt(codigoIBGE);
    
    if (isNaN(codigoIBGENum) || codigoIBGENum <= 0) {
      return res.status(400).json({ error: 'Código IBGE inválido.' });
    }
    
    const pool = await poolPromise;
    
    // Primeiro, tentar buscar na tabela MUNICIPIO usando o código IBGE completo
    try {
      const resultMunicipio = await pool
        .request()
        .input('CodigoIBGE', sql.Int, codigoIBGENum)
        .query(`
          SELECT TOP 1 DDD
          FROM [dbo].[MUNICIPIO]
          WHERE CodigoIBGE = @CodigoIBGE
            AND DDD IS NOT NULL
            AND DDD != ''
        `);
      
      if (resultMunicipio.recordset.length > 0 && resultMunicipio.recordset[0].DDD) {
        const ddd = parseInt(resultMunicipio.recordset[0].DDD);
        return res.json({ 
          CDAREADDD: ddd,
          origem: 'tabela_municipio'
        });
      }
    } catch (errMunicipio) {
      // Erro silencioso, tentar próxima fonte
    }
    
    // Se não encontrou na tabela MUNICIPIO, tentar buscar na tabela CIDADE
    // Extrair os últimos 5 dígitos (código do município) do código IBGE completo
    const codigoMunicipio = codigoIBGENum % 100000; // Últimos 5 dígitos
    
    const resultCidade = await pool
      .request()
      .input('CDMUNICIPIO', sql.Int, codigoMunicipio)
      .query(`
        SELECT TOP 1 CDAREADDD
        FROM [dbo].[CIDADE]
        WHERE CDMUNICIPIO = @CDMUNICIPIO
          AND CDAREADDD IS NOT NULL
          AND CDAREADDD > 0
        ORDER BY DHMAINTENANCE DESC
      `);
    
    if (resultCidade.recordset.length > 0 && resultCidade.recordset[0].CDAREADDD) {
      return res.json({ 
        CDAREADDD: resultCidade.recordset[0].CDAREADDD,
        origem: 'tabela_cidade'
      });
    }
    
    // Se não encontrou em nenhuma tabela, retornar null
    res.json({ 
      CDAREADDD: null,
      origem: 'nao_encontrado',
      mensagem: 'DDD não encontrado. Preencha manualmente.'
    });
  } catch (err) {
    console.error('Erro ao buscar DDD por código IBGE:', err);
    res.status(500).json({ error: 'Erro ao buscar DDD.' });
  }
});

module.exports = router;