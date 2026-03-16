// backend/routes/config.routes.js
// Configurações do sistema (Nominatim, Router, etc.) + contexto multimoeda/multilíngua (Fase 0)
// Atlas Cargo

const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { getContexto, invalidateCache } = require('../services/contexto.service');

const CHAVE_NOMINATIM = 'nominatim_server';
const CHAVE_ROUTER = 'router_server';
const CHAVE_LOGO_RETANGULAR = 'logo_retangular';
const CHAVE_LOGO_QUADRADA = 'logo_quadrada';
const DEFAULT_LOGO_RETANGULAR = 'logoAtlasTransparente.png';
const DEFAULT_LOGO_QUADRADA = 'logoAtlasTransparenteQuadrada.png';

// GET /api/configuracoes/mapa - Retorna configurações de mapa (Nominatim e Router)
router.get('/configuracoes/mapa', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('k1', CHAVE_NOMINATIM)
      .input('k2', CHAVE_ROUTER)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "CHAVE" = @k1 OR "CHAVE" = @k2
      `);
    const rows = result.recordset || [];
    const nominatim = rows.find(r => (r.CHAVE || r.chave) === CHAVE_NOMINATIM);
    const routerRow = rows.find(r => (r.CHAVE || r.chave) === CHAVE_ROUTER);
    res.json({
      nominatimServer: (nominatim && (nominatim.VALOR || nominatim.valor)) || '',
      osrmServer: (routerRow && (routerRow.VALOR || routerRow.valor)) || ''
    });
  } catch (err) {
    console.error('Erro ao listar configurações de mapa:', err);
    // Se a tabela não existir, retornar vazio em vez de 500
    res.json({ nominatimServer: '', osrmServer: '' });
  }
});

// PUT /api/configuracoes/mapa - Atualiza configurações de mapa
router.put('/configuracoes/mapa', async (req, res) => {
  try {
    const { nominatimServer, osrmServer } = req.body || {};
    const pool = await poolPromise;

    if (nominatimServer != null) {
      await pool
        .request()
        .input('chave', CHAVE_NOMINATIM)
        .input('valor', String(nominatimServer).trim())
        .input('desc', 'Servidor/API Nominatim (geocodificação)')
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    }
    if (osrmServer != null) {
      await pool
        .request()
        .input('chave', CHAVE_ROUTER)
        .input('valor', String(osrmServer).trim())
        .input('desc', 'Servidor/API de roteamento (ORS/OSRM)')
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    }

    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configurações de mapa:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

// GET /api/configuracoes/identidade - Retorna configurações de identidade visual (logos)
router.get('/configuracoes/identidade', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('k1', CHAVE_LOGO_RETANGULAR)
      .input('k2', CHAVE_LOGO_QUADRADA)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "CHAVE" = @k1 OR "CHAVE" = @k2
      `);
    const rows = result.recordset || [];
    const retangular = rows.find(r => (r.CHAVE || r.chave) === CHAVE_LOGO_RETANGULAR);
    const quadrada = rows.find(r => (r.CHAVE || r.chave) === CHAVE_LOGO_QUADRADA);
    res.json({
      logoRetangular: (retangular && (retangular.VALOR || retangular.valor)) || DEFAULT_LOGO_RETANGULAR,
      logoQuadrada: (quadrada && (quadrada.VALOR || quadrada.valor)) || DEFAULT_LOGO_QUADRADA
    });
  } catch (err) {
    console.error('Erro ao listar configurações de identidade:', err);
    res.json({
      logoRetangular: DEFAULT_LOGO_RETANGULAR,
      logoQuadrada: DEFAULT_LOGO_QUADRADA
    });
  }
});

// GET /api/contexto - Contexto atual (país, locale, moeda, tipo documento) - Fase 0 multimoeda/multilíngua
router.get('/contexto', async (req, res) => {
  try {
    const contexto = await getContexto();
    res.json(contexto);
  } catch (err) {
    console.error('Erro ao obter contexto:', err);
    res.status(500).json({
      pais: 'BR',
      locale: 'pt-BR',
      moeda: 'BRL',
      tipoDocFisica: 'CPF',
      tipoDocJuridica: 'CNPJ',
      timezone: 'America/Sao_Paulo'
    });
  }
});

// PUT /api/configuracoes/contexto - Atualiza contexto multipaís (país, moeda, idioma, fuso, tipo doc) - Plano multimoeda
router.put('/configuracoes/contexto', async (req, res) => {
  try {
    const { pais, locale, moeda, tipoDocFisica, tipoDocJuridica, timezone } = req.body || {};
    const pool = await poolPromise;
    const upsert = async (chave, valor, desc) => {
      if (valor == null) return;
      const v = String(valor).trim();
      await pool.request()
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    };
    await upsert('pais_padrao', pais, 'País padrão da instalação');
    await upsert('idioma_padrao', locale, 'Locale padrão');
    await upsert('moeda_padrao', moeda, 'Moeda padrão');
    await upsert('tipo_doc_fisica', tipoDocFisica, 'Tipo documento pessoa física');
    await upsert('tipo_doc_juridica', tipoDocJuridica, 'Tipo documento pessoa jurídica');
    await upsert('timezone', timezone, 'Fuso horário IANA');
    invalidateCache();
    res.json({ success: true, message: 'Contexto salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar contexto:', err);
    res.status(500).json({ error: 'Erro ao salvar contexto. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

const CHAVE_LINK_APP_MOTORISTA = 'link_app_motorista';

// GET /api/configuracoes/app-motorista - Link do aplicativo do motorista (mensagem de confirmação)
router.get('/configuracoes/app-motorista', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().input('k', CHAVE_LINK_APP_MOTORISTA).query(`
      SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" = @k
    `);
    const row = result.recordset && result.recordset[0];
    const valor = row && (row.VALOR != null ? row.VALOR : row.valor);
    res.json({ linkAppMotorista: valor != null ? String(valor).trim() : '' });
  } catch (err) {
    console.error('Erro ao buscar link app motorista:', err);
    res.json({ linkAppMotorista: '' });
  }
});

// PUT /api/configuracoes/app-motorista
router.put('/configuracoes/app-motorista', async (req, res) => {
  try {
    const { linkAppMotorista } = req.body || {};
    const pool = await poolPromise;
    const v = linkAppMotorista != null ? String(linkAppMotorista).trim() : '';
    await pool.request()
      .input('chave', CHAVE_LINK_APP_MOTORISTA)
      .input('valor', v)
      .input('desc', 'URL do aplicativo do motorista (exibida na mensagem de confirmação da convocação)')
      .query(`
        INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
        VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
        ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
      `);
    res.json({ success: true, message: 'Link do app motorista salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar link app motorista:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração.' });
  }
});

// GET /api/configuracoes/switch-digital - Retorna configurações da Switch Digital
router.get('/configuracoes/switch-digital', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
      WHERE "CHAVE" IN ('switch_digital_token', 'switch_digital_user_id', 'switch_digital_queue_id', 'switch_digital_send_signature', 'switch_digital_close_ticket')
    `);
    
    const rows = result.recordset || [];
    const config = {
      switchEndpoint: 'https://api.switchdigital.com.br/api/messages/send',
      switchMetodo: 'POST',
      switchContentType: 'application/json',
      switchToken: '',
      switchUserId: '',
      switchQueueId: '',
      switchSendSignature: 'N',
      switchCloseTicket: 'S'
    };

    rows.forEach(r => {
      const chave = r.CHAVE || r.chave;
      const valor = r.VALOR || r.valor;
      if (chave === 'switch_digital_endpoint') config.switchEndpoint = valor;
      if (chave === 'switch_digital_metodo') config.switchMetodo = valor;
      if (chave === 'switch_digital_content_type') config.switchContentType = valor;
      if (chave === 'switch_digital_token') config.switchToken = valor;
      if (chave === 'switch_digital_user_id') config.switchUserId = valor;
      if (chave === 'switch_digital_queue_id') config.switchQueueId = valor;
      if (chave === 'switch_digital_send_signature') config.switchSendSignature = valor;
      if (chave === 'switch_digital_close_ticket') config.switchCloseTicket = valor;
    });

    res.json(config);
  } catch (err) {
    console.error('Erro ao buscar configuracoes da Switch Digital:', err);
    res.status(500).json({ error: 'Erro ao buscar configuracoes' });
  }
});

// PUT /api/configuracoes/switch-digital - Atualiza configurações da Switch Digital
router.put('/configuracoes/switch-digital', async (req, res) => {
  try {
    const { switchEndpoint, switchMetodo, switchContentType, switchToken, switchUserId, switchQueueId, switchSendSignature, switchCloseTicket } = req.body || {};
    const pool = await poolPromise;
    
    const upsert = async (chave, valor, desc) => {
      if (valor == null) return;
      const v = String(valor).trim();
      await pool.request()
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    };

    await upsert('switch_digital_endpoint', switchEndpoint, 'Endpoint da API Switch Digital');
    await upsert('switch_digital_metodo', switchMetodo, 'Método HTTP (POST, GET)');
    await upsert('switch_digital_content_type', switchContentType, 'Content-Type da API');
    await upsert('switch_digital_token', switchToken, 'Token Bearer para API Switch Digital');
    await upsert('switch_digital_user_id', switchUserId, 'ID de Usuário padrão para Switch Digital');
    await upsert('switch_digital_queue_id', switchQueueId, 'ID da Fila padrão para Switch Digital');
    await upsert('switch_digital_send_signature', switchSendSignature, 'Assinar mensagem Switch Digital (S/N)');
    await upsert('switch_digital_close_ticket', switchCloseTicket, 'Encerrar ticket Switch Digital (S/N)');

    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configuracoes Switch Digital:', err);
    res.status(500).json({ error: 'Erro interno ao salvar configurações' });
  }
});

// POST /api/configuracoes/switch-digital/teste - Rota para testar o envio a partir da tela de configuração
router.post('/configuracoes/switch-digital/teste', async (req, res) => {
  try {
    const { numero, config } = req.body;
    
    if (!numero || !config || !config.endpoint || !config.token) {
      return res.status(400).json({ success: false, error: 'Número, Endpoint e Token são obrigatórios para o teste.' });
    }

    // Montar o corpo (body) de acordo com o que a Switch Digital espera
    const requestBody = {
      number: numero,
      body: "Olá! Esta é uma mensagem de teste do sistema Atlas Cargo para a integração Switch Digital.",
      sendSignature: config.sendSignature,
      closeTicket: config.closeTicket
    };

    // Só adiciona userId e queueId se estiverem preenchidos e não forem vazios
    if (config.userId && config.userId.trim() !== '') {
      requestBody.userId = config.userId.trim();
    }
    if (config.queueId && config.queueId.trim() !== '') {
      requestBody.queueId = config.queueId.trim();
    }

    // Configurar o fetch nativo do NodeJS
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    console.log(`[Switch Digital Teste] Disparando para: ${config.endpoint} | Metodo: ${config.metodo}`);
    
    const response = await fetch(config.endpoint, {
      method: config.metodo || 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': config.contentType || 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText; // Caso a API retorne algo que não é JSON
    }

    if (!response.ok) {
      console.error('[Switch Digital Teste] Falha na API:', response.status, responseData);
      return res.status(response.status).json({ 
        success: false, 
        error: `A API retornou status ${response.status}`, 
        details: responseData 
      });
    }

    res.json({ success: true, apiResponse: responseData });

  } catch (err) {
    console.error('Erro na rota de teste da Switch Digital:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao tentar conectar com a API', details: err.message });
  }
});

// PUT /api/configuracoes/identidade - Atualiza configurações de identidade visual
router.put('/configuracoes/identidade', async (req, res) => {
  try {
    const { logoRetangular, logoQuadrada } = req.body || {};
    const pool = await poolPromise;
    const safeName = (v) => (v != null ? String(v).trim().replace(/[^a-zA-Z0-9._-]/g, '') : '');

    if (logoRetangular != null) {
      const val = safeName(logoRetangular) || DEFAULT_LOGO_RETANGULAR;
      await pool
        .request()
        .input('chave', CHAVE_LOGO_RETANGULAR)
        .input('valor', val)
        .input('desc', 'Logo retangular (login, sidebar)')
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    }
    if (logoQuadrada != null) {
      const val = safeName(logoQuadrada) || DEFAULT_LOGO_QUADRADA;
      await pool
        .request()
        .input('chave', CHAVE_LOGO_QUADRADA)
        .input('valor', val)
        .input('desc', 'Logo quadrada (favicon, PWA)')
        .query(`
          INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
          VALUES (@chave, @valor, @desc, CURRENT_TIMESTAMP)
          ON CONFLICT ("CHAVE") DO UPDATE SET "VALOR" = EXCLUDED."VALOR", "DHMAINTENANCE" = CURRENT_TIMESTAMP
        `);
    }

    res.json({ success: true, message: 'Identidade visual salva com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configurações de identidade:', err);
    res.status(500).json({ error: 'Erro ao salvar identidade visual. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

module.exports = router;
