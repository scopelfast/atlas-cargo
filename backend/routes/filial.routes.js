// backend/routes/filial.routes.js
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

// Função para validar CNPJ
function validarCNPJ(cnpj) {
  cnpj = cnpj.toString().replace(/[^\d]+/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  
  let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(0))) return false;
  
  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  
  resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(1))) return false;
  
  return true;
}

// Listar filiais com filtros
router.get('/filiais', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { cdempresa, cdfilial, nomefantasia, siglafilial, cgc, cdcadastro, fgparceiro, situacao } = req.query;

    let query = `
      SELECT 
        [CDEMPRESA],
        [CDFILIAL],
        [NMFANTASIA],
        [SGFILIAL],
        [CGC],
        [CDCADASTRO],
        [FGPARCEIRO],
        [FGACTIVE],
        [DHMAINTENANCE],
        [SGUSER],
        [SERVERORIG]
      FROM [dbo].[FILIAL]
      WHERE 1=1 AND [TENANT_ID] = @TENANT_ID
    `;

    const params = [{ name: 'TENANT_ID', value: tid }];

    if (cdempresa) {
      query += ` AND [CDEMPRESA] = @CDEMPRESA`;
      params.push({ name: 'CDEMPRESA', value: parseInt(cdempresa) });
    }
    if (cdfilial) {
      query += ` AND [CDFILIAL] = @CDFILIAL`;
      params.push({ name: 'CDFILIAL', value: parseInt(cdfilial) });
    }
    if (nomefantasia) {
      query += ` AND [NMFANTASIA] LIKE @NOMEFANTASIA`;
      params.push({ name: 'NOMEFANTASIA', value: `%${nomefantasia}%` });
    }
    if (siglafilial) {
      query += ` AND [SGFILIAL] LIKE @SIGLAFILIAL`;
      params.push({ name: 'SIGLAFILIAL', value: `%${siglafilial}%` });
    }
    if (cgc) {
      query += ` AND [CGC] = @CGC`;
      // CGC deve ser tratado como DECIMAL(15,0) mantendo zeros à esquerda
      const cgcValue = typeof cgc === 'string' ? cgc.replace(/[^\d]+/g, '') : cgc.toString();
      params.push({ name: 'CGC', value: cgcValue, type: sql.Decimal(15, 0) });
    }
    if (cdcadastro) {
      query += ` AND [CDCADASTRO] = @CDCADASTRO`;
      params.push({ name: 'CDCADASTRO', value: cdcadastro });
    }
    if (fgparceiro) {
      query += ` AND [FGPARCEIRO] = @FGPARCEIRO`;
      params.push({ name: 'FGPARCEIRO', value: fgparceiro });
    }
    if (situacao) {
      query += ` AND [FGACTIVE] = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY [CDEMPRESA], [CDFILIAL]`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => {
      if (p.type) {
        request.input(p.name, p.type, p.value);
      } else {
        request.input(p.name, p.value);
      }
    });

    const result = await request.query(query);
    const filiais = result.recordset.map(f => ({
      CDEMPRESA: f.CDEMPRESA,
      CDFILIAL: f.CDFILIAL,
      NMFANTASIA: f.NMFANTASIA,
      SGFILIAL: f.SGFILIAL,
      CGC: f.CGC,
      CDCADASTRO: f.CDCADASTRO,
      FGPARCEIRO: f.FGPARCEIRO || 'N',
      FGACTIVE: f.FGACTIVE === 'A' ? 'S' : 'N',
      DHMAINTENANCE: f.DHMAINTENANCE,
      SGUSER: f.SGUSER,
      SERVERORIG: f.SERVERORIG
    }));

    res.json(filiais);
  } catch (err) {
    console.error('Erro ao listar filiais:', err);
    res.status(500).json({ error: 'Erro ao carregar filiais.' });
  }
});

// Buscar filial por ID (chave composta)
router.get('/filiais/:cdempresa/:cdfilial', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { cdempresa, cdfilial } = req.params;
    const cdempresaNum = parseInt(cdempresa);
    const cdfilialNum = parseInt(cdfilial);

    if (isNaN(cdempresaNum) || isNaN(cdfilialNum)) {
      return res.status(400).json({ error: 'IDs da filial inválidos.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('CDFILIAL', sql.SmallInt, cdfilialNum)
      .input('TENANT_ID', tid)
      .query(`
        SELECT 
          [CDEMPRESA],
          [CDFILIAL],
          [NMFANTASIA],
          [SGFILIAL],
          [CGC],
          [CDCADASTRO],
          [FGPARCEIRO],
          [FGACTIVE],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[FILIAL]
        WHERE [CDEMPRESA] = @CDEMPRESA AND [CDFILIAL] = @CDFILIAL AND [TENANT_ID] = @TENANT_ID
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Filial não encontrada.' });
    }

    const filial = result.recordset[0];
    res.json({
      CDEMPRESA: filial.CDEMPRESA,
      CDFILIAL: filial.CDFILIAL,
      NMFANTASIA: filial.NMFANTASIA,
      SGFILIAL: filial.SGFILIAL,
      CGC: filial.CGC,
      CDCADASTRO: filial.CDCADASTRO,
      FGPARCEIRO: filial.FGPARCEIRO || 'N',
      FGACTIVE: filial.FGACTIVE === 'A' ? 'S' : 'N',
      DHMAINTENANCE: filial.DHMAINTENANCE,
      SGUSER: filial.SGUSER,
      SERVERORIG: filial.SERVERORIG
    });
  } catch (err) {
    console.error('Erro ao buscar filial:', err);
    res.status(500).json({ error: 'Erro ao carregar filial.' });
  }
});

// Inserir nova filial
router.post('/filiais', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { CDEMPRESA, NMFANTASIA, SGFILIAL, CGC, CDCADASTRO, FGPARCEIRO, FGACTIVE } = req.body;

    if (!CDEMPRESA || !NMFANTASIA?.trim() || !SGFILIAL?.trim() || !CGC || !CDCADASTRO) {
      return res.status(400).json({ error: 'Empresa, Nome Fantasia, Sigla, CGC e Cadastro são obrigatórios.' });
    }

    // Validar CNPJ
    const cnpjStr = CGC.toString().replace(/[^\d]+/g, '');
    if (!validarCNPJ(cnpjStr)) {
      return res.status(400).json({ error: 'CNPJ inválido.' });
    }

    const pool = await poolPromise;

    // Verificar se a empresa existe no mesmo tenant
    const checkEmpresa = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, CDEMPRESA)
      .input('TENANT_ID', tid)
      .query('SELECT [CDEMPRESA] FROM [dbo].[EMPRESA] WHERE [CDEMPRESA] = @CDEMPRESA AND [TENANT_ID] = @TENANT_ID');

    if (checkEmpresa.recordset.length === 0) {
      return res.status(400).json({ error: 'Empresa não encontrada.' });
    }

    // Verificar duplicidade de CGC (mesmo tenant)
    const checkDuplicate = await pool
      .request()
      .input('CGC', sql.Decimal(15, 0), CGC)
      .input('TENANT_ID', tid)
      .query('SELECT [CDEMPRESA], [CDFILIAL] FROM [dbo].[FILIAL] WHERE [CGC] = @CGC AND [TENANT_ID] = @TENANT_ID');

    if (checkDuplicate.recordset.length > 0) {
      return res.status(400).json({ error: 'Já existe uma filial com este CNPJ.' });
    }

    // Gerar novo CDFILIAL (auto-incremento por empresa e tenant)
    const maxResult = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, CDEMPRESA)
      .input('TENANT_ID', tid)
      .query(
        'SELECT COALESCE(MAX([CDFILIAL]), 0) + 1 AS [maxId] FROM [dbo].[FILIAL] WHERE [CDEMPRESA] = @CDEMPRESA AND [TENANT_ID] = @TENANT_ID'
      );
    const novoCDFILIAL = getFirstNumericValue(maxResult.recordset, 1);

    const fgparceiroDB = (FGPARCEIRO === 'S' || FGPARCEIRO === 'A') ? 'S' : 'N';
    const fgactiveDB = (FGACTIVE === 'S' || FGACTIVE === 'A') ? 'A' : 'I';

    await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, CDEMPRESA)
      .input('CDFILIAL', sql.SmallInt, novoCDFILIAL)
      .input('NMFANTASIA', NMFANTASIA.trim())
      .input('SGFILIAL', SGFILIAL.trim())
      .input('CGC', sql.Decimal(15, 0), CGC)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO)
      .input('FGPARCEIRO', fgparceiroDB)
      .input('FGACTIVE', fgactiveDB)
      .input('TENANT_ID', tid)
      .query(`
        INSERT INTO [dbo].[FILIAL] (
          [CDEMPRESA], [CDFILIAL], [NMFANTASIA], [SGFILIAL], [CGC], [CDCADASTRO],
          [FGPARCEIRO], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID]
        )
        VALUES (
          @CDEMPRESA, @CDFILIAL, @NMFANTASIA, @SGFILIAL, @CGC, @CDCADASTRO,
          @FGPARCEIRO, @FGACTIVE, GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID
        )
      `);

    res.status(201).json({ 
      success: true, 
      message: 'Filial cadastrada com sucesso!', 
      cdempresa: CDEMPRESA,
      cdfilial: novoCDFILIAL
    });
  } catch (err) {
    console.error('Erro ao inserir filial:', err);
    res.status(500).json({ error: 'Erro ao cadastrar filial.' });
  }
});

// Atualizar filial
router.put('/filiais/:cdempresa/:cdfilial', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { cdempresa, cdfilial } = req.params;
    const { NMFANTASIA, SGFILIAL, CGC, CDCADASTRO, FGPARCEIRO, FGACTIVE } = req.body;

    const cdempresaNum = parseInt(cdempresa);
    const cdfilialNum = parseInt(cdfilial);

    if (isNaN(cdempresaNum) || isNaN(cdfilialNum)) {
      return res.status(400).json({ error: 'IDs da filial inválidos.' });
    }

    if (!NMFANTASIA?.trim() || !SGFILIAL?.trim() || !CGC || !CDCADASTRO || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // Validar CNPJ
    const cnpjStr = CGC.toString().replace(/[^\d]+/g, '');
    if (!validarCNPJ(cnpjStr)) {
      return res.status(400).json({ error: 'CNPJ inválido.' });
    }

    const pool = await poolPromise;

    // Verificar duplicidade de CGC (excluindo o próprio registro, mesmo tenant)
    const checkDuplicate = await pool
      .request()
      .input('CGC', sql.Decimal(15, 0), CGC)
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('CDFILIAL', sql.SmallInt, cdfilialNum)
      .input('TENANT_ID', tid)
      .query(
        'SELECT [CDEMPRESA], [CDFILIAL] FROM [dbo].[FILIAL] WHERE [CGC] = @CGC AND [TENANT_ID] = @TENANT_ID AND ([CDEMPRESA] != @CDEMPRESA OR [CDFILIAL] != @CDFILIAL)'
      );

    if (checkDuplicate.recordset.length > 0) {
      return res.status(400).json({ error: 'Já existe outra filial com este CNPJ.' });
    }

    const fgparceiroDB = (FGPARCEIRO === 'S' || FGPARCEIRO === 'A') ? 'S' : 'N';
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('CDFILIAL', sql.SmallInt, cdfilialNum)
      .input('NMFANTASIA', NMFANTASIA.trim())
      .input('SGFILIAL', SGFILIAL.trim())
      .input('CGC', sql.Decimal(15, 0), CGC)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO)
      .input('FGPARCEIRO', fgparceiroDB)
      .input('FGACTIVE', fgactiveDB)
      .input('TENANT_ID', tid)
      .query(`
        UPDATE [dbo].[FILIAL]
        SET 
          [NMFANTASIA] = @NMFANTASIA,
          [SGFILIAL] = @SGFILIAL,
          [CGC] = @CGC,
          [CDCADASTRO] = @CDCADASTRO,
          [FGPARCEIRO] = @FGPARCEIRO,
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDEMPRESA] = @CDEMPRESA AND [CDFILIAL] = @CDFILIAL AND [TENANT_ID] = @TENANT_ID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Filial não encontrada.' });
    }

    res.json({ success: true, message: 'Filial atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar filial:', err);
    res.status(500).json({ error: 'Erro ao atualizar filial.' });
  }
});

// Desativar/Reativar filial (soft delete)
router.delete('/filiais/:cdempresa/:cdfilial', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { cdempresa, cdfilial } = req.params;
    const { action } = req.query;
    const cdempresaNum = parseInt(cdempresa);
    const cdfilialNum = parseInt(cdfilial);

    if (isNaN(cdempresaNum) || isNaN(cdfilialNum)) {
      return res.status(400).json({ error: 'IDs da filial inválidos.' });
    }

    const pool = await poolPromise;
    
    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('CDFILIAL', sql.SmallInt, cdfilialNum)
      .input('TENANT_ID', tid)
      .query(
        `SELECT [FGACTIVE] FROM [dbo].[FILIAL] WHERE [CDEMPRESA] = @CDEMPRESA AND [CDFILIAL] = @CDFILIAL AND [TENANT_ID] = @TENANT_ID`
      );

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Filial não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Filial reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Filial desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Filial desativada com sucesso!' : 'Filial reativada com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('CDFILIAL', sql.SmallInt, cdfilialNum)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .input('TENANT_ID', tid)
      .query(`
        UPDATE [dbo].[FILIAL]
        SET 
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDEMPRESA] = @CDEMPRESA AND [CDFILIAL] = @CDFILIAL AND [TENANT_ID] = @TENANT_ID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Filial não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da filial:', err);
    res.status(500).json({ error: 'Erro ao alterar status da filial.' });
  }
});

// Rota para buscar filiais por empresa (para combos)
router.get('/filiais-por-empresa/:cdempresa', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { cdempresa } = req.params;
    const cdempresaNum = parseInt(cdempresa);

    if (isNaN(cdempresaNum)) {
      return res.status(400).json({ error: 'ID da empresa inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, cdempresaNum)
      .input('TENANT_ID', tid)
      .query(`
        SELECT 
          [CDEMPRESA],
          [CDFILIAL],
          [NMFANTASIA],
          [SGFILIAL]
        FROM [dbo].[FILIAL]
        WHERE [CDEMPRESA] = @CDEMPRESA AND [FGACTIVE] = 'A' AND [TENANT_ID] = @TENANT_ID
        ORDER BY [CDFILIAL]
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao buscar filiais por empresa:', err);
    res.status(500).json({ error: 'Erro ao carregar filiais.' });
  }
});

// Executar init.sql
router.post('/filiais/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    // Verificar comandos bloqueados
    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ 
          error: `Comando não permitido: ${cmd}.` 
        });
      }
    }

    const pool = await poolPromise;
    
    // Dividir por GO se houver múltiplos comandos
    const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    
    const resultados = [];
    
    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;
      
      try {
        // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
        const request = pool.request();
        request.timeout = 120000; // 120 segundos (2 minutos)
        const result = await request.query(cmdLimpo);
        
        // Se retornou dados (SELECT), incluir no resultado
        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({
            tipo: 'SELECT',
            rows: rows,
            rowCount: rows.length
          });
        } else {
          // Comando executado sem retorno (EXEC, UPDATE, etc)
          resultados.push({
            tipo: 'EXEC',
            message: 'Comando executado com sucesso.',
            rowsAffected: result.rowsAffected || [0]
          });
        }
      } catch (cmdErr) {
        // Se um comando falhar, continuar com os próximos mas registrar o erro
        let mensagemErro = cmdErr.message;
        
        // Melhorar mensagem de timeout
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200),
          detalhes: {
            nome: cmdErr.name,
            codigo: cmdErr.code,
            numero: cmdErr.number
          }
        });
      }
    }

    res.json({
      success: true,
      resultados: resultados,
      totalComandos: comandos.length
    });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.' 
      });
    }
  }
});

module.exports = router;

