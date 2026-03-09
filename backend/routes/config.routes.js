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
