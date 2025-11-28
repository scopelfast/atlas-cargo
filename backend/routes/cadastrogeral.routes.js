// backend/routes/cadastrogeral.routes.js
// Cadastro Geral - API
// Versão: 1.1 - Otimizada com Classes de Frota
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const express = require('express');
const router = express.Router();
const cadastroController = require('../controllers/cadastrogeral.controller');

// Rotas principais
router.get('/cadastros-gerais', cadastroController.listar);
router.post('/cadastros-gerais', cadastroController.criar);

// Rotas específicas ANTES das rotas com parâmetro :id (para evitar conflito)
router.get('/cadastros-gerais/transportadores', cadastroController.listarTransportadores);
router.post('/cadastros-gerais/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
    // Permite: SELECT, EXEC, EXECUTE, UPDATE, INSERT, DELETE (com cuidado)
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

    const { poolPromise } = require('../config/db');
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
        // mssql usa requestTimeout (em milissegundos)
        request.timeout = 120000; // 120 segundos (2 minutos) para comandos grandes
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
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
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
    // Garantir que a resposta seja enviada antes de encerrar
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.',
        detalhes: err.message 
      });
    }
  }
});

// Rotas com parâmetro :id (devem vir DEPOIS das rotas específicas)
router.put('/cadastros-gerais/:id', cadastroController.atualizar);
router.delete('/cadastros-gerais/:id', cadastroController.excluir);
router.get('/cadastros-gerais/:id', cadastroController.buscarPorId);

// Rotas de classes de frota para cadastro
router.get('/cadastro-classes/:id', cadastroController.listarClassesParaCadastro);
router.put('/cadastro-classes/:id', cadastroController.atualizarClassesParaCadastro);

// Rotas de utilitários
router.get('/cep/:cep', cadastroController.buscarCEP);

// Rotas de combos
router.get('/tipos-cadastro-combo', cadastroController.listarTiposCadastro);
router.get('/tipos-pessoa-combo', cadastroController.listarTiposPessoa);

module.exports = router;