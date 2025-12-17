// backend/controllers/cadastrogeral.controller.js
// Controller para Cadastro Geral
// Versão: 1.1 - Com Classes de Frota
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const sql = require('mssql');
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { poolPromise } = require('../config/db');

// Constantes
const TIPO_CADASTRO = {
  'O': 'Operador do Sistema',
  'M': 'Motorista', 
  'A': 'Agente',
  'G': 'Grupo de Divulgação',
  'T': 'Transportador'
};

const FISICA_JURIDICA = {
  'F': 'Física',
  'J': 'Jurídica'
};

// Validar CPF
function validarCPF(cpf) {
  cpf = cpf.replace(/[^\d]+/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let resto = 11 - (soma % 11);
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;
  
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }
  resto = 11 - (soma % 11);
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) return false;
  
  return true;
}

// Validar CNPJ
function validarCNPJ(cnpj) {
  cnpj = cnpj.replace(/[^\d]+/g, '');
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

// Buscar CEP via ViaCEP
async function buscarCEP(cep) {
  try {
    const response = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar CEP:', error);
    return null;
  }
}

// Controller methods
const cadastroController = {
  // Listar cadastros com filtros
  listar: async (req, res) => {
    try {
      const {
        codigo, cgccpf, razaoSocial, nomeFantasia, tipoPessoa,
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador
      } = req.query;
      
      let query = `
        SELECT 
          cg.CDCADASTRO,
          cg.CGCCPF,
          cg.RZSOCIAL,
          cg.NMFANTASIA,
          cg.FGFISICAJURIDICA,
          cg.CEP,
          cg.CDCIDADE,
          c.ESTADO AS CIDADE_ESTADO,
          c.NMCIDADE AS CIDADE_NOME,
          cg.ENDERECO,
          cg.NRENDERECO,
          cg.COMPLEND,
          cg.BAIRRO,
          cg.NRCELULAR,
          cg.ENDEMAIL,
          cg.LATITUDE,
          cg.LONGITUDE,
          cg.FGACTIVE,
          cg.FGTIPOCADASTRO,
          cg.CDTRANSPORTADOR,
          t.RZSOCIAL AS TRANSPORTADOR_NOME
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
        WHERE 1=1
      `;

      const params = [];
      if (codigo) {
        query += ` AND cg.CDCADASTRO = @CODIGO`;
        params.push({ name: 'CODIGO', value: parseFloat(codigo) });
      }
      if (cgccpf) {
        // Usar string para preservar zeros à esquerda
        const cgccpfStr = String(cgccpf).replace(/[^\d]+/g, '');
        query += ` AND cg.CGCCPF = @CGCCPF`;
        params.push({ name: 'CGCCPF', type: sql.VarChar(14), value: cgccpfStr });
      }
      if (razaoSocial) {
        query += ` AND cg.RZSOCIAL LIKE @RAZAOSOCIAL`;
        params.push({ name: 'RAZAOSOCIAL', value: `%${razaoSocial}%` });
      }
      if (nomeFantasia) {
        query += ` AND cg.NMFANTASIA LIKE @NMFANTASIA`;
        params.push({ name: 'NMFANTASIA', value: `%${nomeFantasia}%` });
      }
      if (tipoPessoa) {
        query += ` AND cg.FGFISICAJURIDICA = @TIPOPESSOA`;
        params.push({ name: 'TIPOPESSOA', value: tipoPessoa });
      }
      if (cidadeEstado) {
        query += ` AND c.ESTADO = @CIDADE_ESTADO`;
        params.push({ name: 'CIDADE_ESTADO', value: cidadeEstado });
      }
      if (cidadeNome) {
        query += ` AND c.NMCIDADE LIKE @CIDADE_NOME`;
        params.push({ name: 'CIDADE_NOME', value: `%${cidadeNome}%` });
      }
      if (celular) {
        query += ` AND cg.NRCELULAR = @CELULAR`;
        params.push({ name: 'CELULAR', value: parseFloat(celular) });
      }
      if (email) {
        query += ` AND cg.ENDEMAIL LIKE @EMAIL`;
        params.push({ name: 'EMAIL', value: `%${email}%` });
      }
      if (situacao) {
        query += ` AND cg.FGACTIVE = @SITUACAO`;
        params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
      }
      if (tipoCadastro) {
        query += ` AND cg.FGTIPOCADASTRO = @TIPOCADASTRO`;
        params.push({ name: 'TIPOCADASTRO', value: tipoCadastro.trim().toUpperCase() });
      }
      if (rastreado) {
        query += ` AND cg.FGRASTREADO = @RASTREADO`;
        params.push({ name: 'RASTREADO', value: rastreado });
      }
      if (transportador) {
        query += ` AND cg.CDTRANSPORTADOR = @TRANSPORTADOR`;
        params.push({ name: 'TRANSPORTADOR', value: parseFloat(transportador) });
      }

      query += ` ORDER BY cg.RZSOCIAL`;

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
      const cadastros = result.recordset.map(cg => ({
        CDCADASTRO: cg.CDCADASTRO,
        CGCCPF: cg.CGCCPF,
        RZSOCIAL: cg.RZSOCIAL,
        NMFANTASIA: cg.NMFANTASIA || 'Não informado',
        FGFISICAJURIDICA: cg.FGFISICAJURIDICA,
        FGFISICAJURIDICA_NOME: FISICA_JURIDICA[cg.FGFISICAJURIDICA] || 'Não informado',
        CEP: cg.CEP,
        CDCIDADE: cg.CDCIDADE,
        CIDADE_ESTADO: cg.CIDADE_ESTADO || 'Não informado',
        CIDADE_NOME: cg.CIDADE_NOME || 'Não informado',
        ENDERECO: cg.ENDERECO,
        NRENDERECO: cg.NRENDERECO,
        COMPLEND: cg.COMPLEND || 'Não informado',
        BAIRRO: cg.BAIRRO,
        NRCELULAR: cg.NRCELULAR,
        ENDEMAIL: cg.ENDEMAIL || 'Não informado',
        LATITUDE: cg.LATITUDE,
        LONGITUDE: cg.LONGITUDE,
        FGACTIVE: cg.FGACTIVE === 'A' ? 'S' : 'N',
        FGTIPOCADASTRO: cg.FGTIPOCADASTRO,
        FGTIPOCADASTRO_NOME: TIPO_CADASTRO[cg.FGTIPOCADASTRO] || 'Não informado',
        CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null,
        TRANSPORTADOR_NOME: cg.TRANSPORTADOR_NOME || null
      }));
      
      res.json(cadastros);
    } catch (err) {
      console.error('Erro ao listar cadastros gerais:', err);
      res.status(500).json({ error: 'Erro ao carregar cadastros.' });
    }
  },

  // Criar novo cadastro
  criar: async (req, res) => {
    try {
      const {
        CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
        ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL,
        LATITUDE, LONGITUDE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR
      } = req.body;

      // Validações
      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !FGTIPOCADASTRO || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

      // Validar CPF/CNPJ
      let cgccpfStr = CGCCPF.toString().replace(/[^\d]+/g, ''); // remove pontuação

      if (FGFISICAJURIDICA === 'F') {
        cgccpfStr = cgccpfStr.padStart(11, '0'); // garante 11 dígitos
        if (!validarCPF(cgccpfStr)) {
          return res.status(400).json({ error: 'CPF inválido.' });
        }
      }

      if (FGFISICAJURIDICA === 'J') {
        cgccpfStr = cgccpfStr.padStart(14, '0'); // garante 14 dígitos
        if (!validarCNPJ(cgccpfStr)) {
          return res.status(400).json({ error: 'CNPJ inválido.' });
        }
      }

      // Verificar duplicidade (usar o valor com padStart)
      const pool = await poolPromise;
      const checkDuplicate = await pool
        .request()
        .input('CGCCPF', sql.VarChar(14), cgccpfStr)
        .query('SELECT CDCADASTRO FROM [dbo].[CADASTROGERAL] WHERE CGCCPF = @CGCCPF');
      
      if (checkDuplicate.recordset.length > 0) {
        return res.status(400).json({ error: 'Já existe um cadastro com este CPF/CNPJ.' });
      }

      // Gerar novo ID
      const maxResult = await pool
        .request()
        .query('SELECT ISNULL(MAX(CDCADASTRO), 0) AS maxId FROM [dbo].[CADASTROGERAL]');
      const novoId = maxResult.recordset[0].maxId + 1;

      // Inserir cadastro
      await pool
        .request()
        .input('CDCADASTRO', sql.Decimal(15, 0), novoId)
        .input('CGCCPF', sql.VarChar(14), cgccpfStr) // Usar o valor com padStart
        .input('RZSOCIAL', RZSOCIAL.trim())
        .input('NMFANTASIA', NMFANTASIA?.trim() || null)
        .input('FGFISICAJURIDICA', FGFISICAJURIDICA)
        .input('CEP', sql.Decimal(10, 0), CEP || null)
        .input('CDCIDADE', sql.Int, CDCIDADE || null)
        .input('LATITUDE', sql.Float, LATITUDE || null)
        .input('LONGITUDE', sql.Float, LONGITUDE || null)
        .input('ENDERECO', ENDERECO.trim())
        .input('NRENDERECO', sql.Int, NRENDERECO)
        .input('COMPLEND', COMPLEND?.trim() || null)
        .input('BAIRRO', BAIRRO.trim())
        .input('NRCELULAR', sql.Decimal(15, 0), NRCELULAR)
        .input('ENDEMAIL', ENDEMAIL?.trim() || null)
        .input('FGTIPOCADASTRO', FGTIPOCADASTRO)
        .input('FGRASTREADO', FGRASTREADO || 'N')
        .input('CDTRANSPORTADOR', sql.Decimal(15, 0), (FGTIPOCADASTRO === 'M' && CDTRANSPORTADOR) ? CDTRANSPORTADOR : null)
        .query(`
          INSERT INTO [dbo].[CADASTROGERAL] (
            CDCADASTRO, CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
            ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL, LATITUDE, LONGITUDE,
            FGACTIVE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR, DHMAINTENANCE, SGUSER, SERVERORIG
          )
          VALUES (
            @CDCADASTRO, @CGCCPF, @RZSOCIAL, @NMFANTASIA, @FGFISICAJURIDICA, @CEP, @CDCIDADE,
            @ENDERECO, @NRENDERECO, @COMPLEND, @BAIRRO, @NRCELULAR, @ENDEMAIL, @LATITUDE, @LONGITUDE,
            'A', @FGTIPOCADASTRO, @FGRASTREADO, @CDTRANSPORTADOR, GETDATE(), 'SYSTEM', 'AppDVcargas'
          )
        `);

      // Inserir relacionamento com todas as classes de frota
      const classesResult = await pool
        .request()
        .query('SELECT CDCLASSEFROTA FROM [dbo].[CLASSEFROTA] WHERE FGACTIVE = \'A\'');
      
      for (const classe of classesResult.recordset) {
        await pool
          .request()
          .input('CDCADASTRO', sql.Decimal(15, 0), novoId)
          .input('CDCLASSEFROTA', sql.SmallInt, classe.CDCLASSEFROTA)
          .query(`
            INSERT INTO [dbo].[CLASSEFROTA_CG] (
              CDCADASTRO, CDCLASSEFROTA, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
            )
            VALUES (@CDCADASTRO, @CDCLASSEFROTA, 'S', GETDATE(), 'SYSTEM', 'AppDVcargas')
          `);
      }

      res.status(201).json({ 
        success: true, 
        message: 'Cadastro geral criado com sucesso!',
        CDCADASTRO: novoId
      });
    } catch (err) {
      console.error('Erro ao inserir cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao cadastrar.' });
    }
  },

  // Atualizar cadastro
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
        ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL,
        LATITUDE, LONGITUDE, FGACTIVE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR
      } = req.body;

      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !FGTIPOCADASTRO || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

      // Validar CPF/CNPJ
      let cgccpfStr = CGCCPF.toString().replace(/[^\d]+/g, '');

      if (FGFISICAJURIDICA === 'F') {
        cgccpfStr = cgccpfStr.padStart(11, '0');
        if (!validarCPF(cgccpfStr)) {
          return res.status(400).json({ error: 'CPF inválido.' });
        }
      }

      if (FGFISICAJURIDICA === 'J') {
        cgccpfStr = cgccpfStr.padStart(14, '0');
        if (!validarCNPJ(cgccpfStr)) {
          return res.status(400).json({ error: 'CNPJ inválido.' });
        }
      }

      const pool = await poolPromise;
      const idNumerico = parseFloat(id);

      // Buscar valor atual do CDTRANSPORTADOR para preservar se não vier no body
      const cadastroAtual = await pool
        .request()
        .input('CDCADASTRO', sql.Decimal(15, 0), idNumerico)
        .query(`
          SELECT CDTRANSPORTADOR
          FROM [dbo].[CADASTROGERAL]
          WHERE CDCADASTRO = @CDCADASTRO
        `);

      const request = pool.request();
      request.input('CDCADASTRO', sql.Decimal(15, 0), idNumerico);
      request.input('CGCCPF', sql.VarChar(14), cgccpfStr);
      request.input('RZSOCIAL', RZSOCIAL.trim());
      request.input('NMFANTASIA', NMFANTASIA?.trim() || null);
      request.input('FGFISICAJURIDICA', FGFISICAJURIDICA);
      request.input('CEP', sql.Decimal(10, 0), CEP || null);
      request.input('CDCIDADE', sql.Int, CDCIDADE || null);
      request.input('LATITUDE', sql.Float, LATITUDE || null);
      request.input('LONGITUDE', sql.Float, LONGITUDE || null);
      request.input('ENDERECO', ENDERECO.trim());
      request.input('NRENDERECO', sql.Int, NRENDERECO);
      request.input('COMPLEND', COMPLEND?.trim() || null);
      request.input('BAIRRO', BAIRRO.trim());
      request.input('NRCELULAR', sql.Decimal(15, 0), NRCELULAR);
      request.input('ENDEMAIL', ENDEMAIL?.trim() || null);
      request.input('FGACTIVE', FGACTIVE === 'S' ? 'A' : 'I');
      request.input('FGTIPOCADASTRO', FGTIPOCADASTRO);
      request.input('FGRASTREADO', FGRASTREADO || 'N');
      
      // Tratar CDTRANSPORTADOR: preservar valor atual se não vier no body
      if (FGTIPOCADASTRO !== 'M') {
        // Se não é motorista, sempre null
        request.input('CDTRANSPORTADOR', sql.Decimal(15, 0), null);
      } else {
        // Se é motorista
        if (CDTRANSPORTADOR !== undefined) {
          // Se veio no body (pode ser null para limpar ou um valor)
          request.input('CDTRANSPORTADOR', sql.Decimal(15, 0), CDTRANSPORTADOR || null);
        } else {
          // Se NÃO veio no body, preservar o valor atual do banco
          const valorAtual = cadastroAtual.recordset.length > 0 
            ? cadastroAtual.recordset[0].CDTRANSPORTADOR 
            : null;
          request.input('CDTRANSPORTADOR', sql.Decimal(15, 0), valorAtual);
        }
      }

      await request.query(`
        UPDATE [dbo].[CADASTROGERAL]
        SET 
          CGCCPF = @CGCCPF,
          RZSOCIAL = @RZSOCIAL,
          NMFANTASIA = @NMFANTASIA,
          FGFISICAJURIDICA = @FGFISICAJURIDICA,
          CEP = @CEP,
          CDCIDADE = @CDCIDADE,
          ENDERECO = @ENDERECO,
          NRENDERECO = @NRENDERECO,
          COMPLEND = @COMPLEND,
          BAIRRO = @BAIRRO,
          NRCELULAR = @NRCELULAR,
          ENDEMAIL = @ENDEMAIL,
          LATITUDE = @LATITUDE,
          LONGITUDE = @LONGITUDE,
          FGACTIVE = @FGACTIVE,
          FGTIPOCADASTRO = @FGTIPOCADASTRO,
          FGRASTREADO = @FGRASTREADO,
          CDTRANSPORTADOR = @CDTRANSPORTADOR,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCADASTRO = @CDCADASTRO
      `);

      res.json({ success: true, message: 'Cadastro atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao atualizar cadastro.' });
    }
  },

  // Buscar cadastro por ID
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            cg.CDCADASTRO,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NMFANTASIA,
            cg.FGFISICAJURIDICA,
            cg.CEP,
            cg.CDCIDADE,
            c.ESTADO AS CIDADE_ESTADO,
            c.NMCIDADE AS CIDADE_NOME,
            cg.ENDERECO,
            cg.NRENDERECO,
            cg.COMPLEND,
            cg.BAIRRO,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.LATITUDE,
            cg.LONGITUDE,
            cg.FGACTIVE,
            cg.FGTIPOCADASTRO,
            cg.FGRASTREADO,
            cg.CDTRANSPORTADOR
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
          WHERE cg.CDCADASTRO = @CDCADASTRO
        `);
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      
      const cg = result.recordset[0];
      res.json({
        CDCADASTRO: cg.CDCADASTRO,
        CGCCPF: cg.CGCCPF,
        RZSOCIAL: cg.RZSOCIAL,
        NMFANTASIA: cg.NMFANTASIA,
        FGFISICAJURIDICA: cg.FGFISICAJURIDICA,
        CEP: cg.CEP,
        CDCIDADE: cg.CDCIDADE,
        CIDADE_ESTADO: cg.CIDADE_ESTADO,
        CIDADE_NOME: cg.CIDADE_NOME,
        ENDERECO: cg.ENDERECO,
        NRENDERECO: cg.NRENDERECO,
        COMPLEND: cg.COMPLEND,
        BAIRRO: cg.BAIRRO,
        NRCELULAR: cg.NRCELULAR,
        ENDEMAIL: cg.ENDEMAIL,
        LATITUDE: cg.LATITUDE,
        LONGITUDE: cg.LONGITUDE,
        FGACTIVE: cg.FGACTIVE === 'A' ? 'S' : 'N',
        FGTIPOCADASTRO: cg.FGTIPOCADASTRO,
        FGRASTREADO: cg.FGRASTREADO || 'N',
        CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null
      });
    } catch (err) {
      console.error('Erro ao buscar cadastro:', err);
      res.status(500).json({ error: 'Erro ao carregar cadastro.' });
    }
  },

  // Excluir/Reativar cadastro (lógica) - Toggle do status
  excluir: async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.query; // 'activate' ou 'deactivate' (opcional, detecta automaticamente se não informado)
      const pool = await poolPromise;
      
      // Validação do ID
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        return res.status(400).json({ error: 'ID inválido.' });
      }
      
      const idNumerico = parseFloat(id);
      if (isNaN(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      // Primeiro, buscar o status atual do cadastro
      const checkRequest = pool.request();
      checkRequest.input('CDCADASTRO', sql.Decimal(15, 0), idNumerico);
      
      const checkResult = await checkRequest.query(`
        SELECT FGACTIVE FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @CDCADASTRO
      `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      const statusAtual = checkResult.recordset[0].FGACTIVE;
      const estaAtivo = statusAtual === 'A';
      
      // Determinar ação: se action não foi informado, fazer toggle automático
      let novaSituacao, mensagem;
      if (action === 'activate') {
        novaSituacao = 'A';
        mensagem = 'Cadastro reativado com sucesso!';
      } else if (action === 'deactivate') {
        novaSituacao = 'I';
        mensagem = 'Cadastro desativado com sucesso!';
      } else {
        // Toggle automático: se está ativo, desativa; se está inativo, reativa
        novaSituacao = estaAtivo ? 'I' : 'A';
        mensagem = estaAtivo ? 'Cadastro desativado com sucesso!' : 'Cadastro reativado com sucesso!';
      }

      const request = pool.request();
      request.input('CDCADASTRO', sql.Decimal(15, 0), idNumerico);
      request.input('FGACTIVE', sql.Char(1), novaSituacao);
      
      const result = await request.query(`
        UPDATE [dbo].[CADASTROGERAL]
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCADASTRO = @CDCADASTRO
      `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      res.json({ 
        success: true, 
        message: mensagem,
        newStatus: novaSituacao === 'A' ? 'S' : 'N'
      });
    } catch (err) {
      console.error('Erro ao alterar status do cadastro:', err);
      res.status(500).json({ error: 'Erro ao alterar status do cadastro.' });
    }
  },

  // Buscar CEP
  buscarCEP: async (req, res) => {
    try {
      const { cep } = req.params;
      const dadosCEP = await buscarCEP(cep);
      
      if (!dadosCEP || dadosCEP.erro) {
        return res.status(404).json({ error: 'CEP não encontrado.' });
      }

      // Buscar cidade no banco
      const pool = await poolPromise;
      const cidadeResult = await pool
        .request()
        .input('ESTADO', dadosCEP.uf)
        .input('NMCIDADE', dadosCEP.localidade)
        .query(`
          SELECT CDCIDADE, ESTADO, NMCIDADE 
          FROM [dbo].[CIDADE] 
          WHERE ESTADO = @ESTADO AND NMCIDADE = @NMCIDADE AND FGACTIVE = 'A'
        `);

      res.json({
        ...dadosCEP,
        cidade: cidadeResult.recordset[0] || null
      });
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
      res.status(500).json({ error: 'Erro ao buscar CEP.' });
    }
  },

  // Listar combos
  listarTiposCadastro: (req, res) => {
    const tipos = Object.entries(TIPO_CADASTRO).map(([value, label]) => ({ value, label }));
    res.json(tipos);
  },

  listarTiposPessoa: (req, res) => {
    const tipos = Object.entries(FISICA_JURIDICA).map(([value, label]) => ({ value, label }));
    res.json(tipos);
  },

  // Listar classes de frota para um cadastro específico
  listarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      
      // Primeiro, obtém todas as classes de frota ativas
      const todasClasses = await pool
        .request()
        .query('SELECT CDCLASSEFROTA, DSCLASSEFROTA FROM [dbo].[CLASSEFROTA] WHERE FGACTIVE = \'A\' ORDER BY DSCLASSEFROTA');
      
      // Depois, obtém as classes já associadas a este cadastro
      const classesAssociadas = await pool
        .request()
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT CDCLASSEFROTA, FGACTIVE 
          FROM [dbo].[CLASSEFROTA_CG] 
          WHERE CDCADASTRO = @CDCADASTRO
        `);
      
      // Cria um mapa das classes associadas
      const mapaAssociadas = {};
      classesAssociadas.recordset.forEach(classe => {
        mapaAssociadas[classe.CDCLASSEFROTA] = classe.FGACTIVE;
      });
      
      // Combina todas as classes com o status atual
      const resultado = todasClasses.recordset.map(classe => ({
        CDCLASSEFROTA: classe.CDCLASSEFROTA,
        DSCLASSEFROTA: classe.DSCLASSEFROTA,
        FGACTIVE: mapaAssociadas[classe.CDCLASSEFROTA] || 'N'
      }));
      
      res.json(resultado);
    } catch (err) {
      console.error('Erro ao listar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  // Atualizar classes de frota para um cadastro
  atualizarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const { classes } = req.body;
      
      if (!classes || !Array.isArray(classes)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      
      const pool = await poolPromise;
      const transaction = await pool.transaction();
      
      try {
        await transaction.begin();
        
        // Primeiro, obtém as classes já associadas
        const classesExistentes = await transaction
          .request()
          .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(id))
          .query(`
            SELECT CDCLASSEFROTA 
            FROM [dbo].[CLASSEFROTA_CG] 
            WHERE CDCADASTRO = @CDCADASTRO
          `);
        
        const existentesSet = new Set(
          classesExistentes.recordset.map(c => c.CDCLASSEFROTA)
        );
        
        // Processa cada classe recebida
        for (const classe of classes) {
          const { CDCLASSEFROTA, FGACTIVE } = classe;
          
          if (existentesSet.has(CDCLASSEFROTA)) {
            // Atualiza classe existente
            await transaction
              .request()
              .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(id))
              .input('CDCLASSEFROTA', sql.SmallInt, CDCLASSEFROTA)
              .input('FGACTIVE', FGACTIVE)
              .query(`
                UPDATE [dbo].[CLASSEFROTA_CG] 
                SET FGACTIVE = @FGACTIVE, DHMAINTENANCE = GETDATE(), SGUSER = 'SYSTEM', SERVERORIG = 'AppDVcargas'
                WHERE CDCADASTRO = @CDCADASTRO AND CDCLASSEFROTA = @CDCLASSEFROTA
              `);
          } else {
            // Insere nova classe
            await transaction
              .request()
              .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(id))
              .input('CDCLASSEFROTA', sql.SmallInt, CDCLASSEFROTA)
              .input('FGACTIVE', FGACTIVE)
              .query(`
                INSERT INTO [dbo].[CLASSEFROTA_CG] (CDCADASTRO, CDCLASSEFROTA, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG)
                VALUES (@CDCADASTRO, @CDCLASSEFROTA, @FGACTIVE, GETDATE(), 'SYSTEM', 'AppDVcargas')
              `);
          }
        }
        
        await transaction.commit();
        res.json({ success: true, message: 'Classes de frota atualizadas com sucesso!' });
        
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao atualizar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao atualizar classes de frota.' });
    }
  },

  // Buscar transportadores (tipo T) para combo
  listarTransportadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query(`
          SELECT 
            CDCADASTRO,
            RZSOCIAL
          FROM [dbo].[CADASTROGERAL]
          WHERE FGTIPOCADASTRO = 'T'
            AND FGACTIVE = 'A'
          ORDER BY RZSOCIAL
        `);
      
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao listar transportadores:', err);
      res.status(500).json({ error: 'Erro ao carregar transportadores.' });
    }
  },

  // Exportar cadastros para Excel com todos os dados e tabelas auxiliares
  exportarExcel: async (req, res) => {
    try {
      const {
        codigo, cgccpf, razaoSocial, nomeFantasia, tipoPessoa,
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador
      } = req.query;

      // Query SQL completa com todas as tabelas auxiliares
      let query = `
        SELECT 
          -- Dados principais do cadastro
          cg.CDCADASTRO AS 'Código',
          cg.CGCCPF AS 'CPF/CNPJ',
          cg.RZSOCIAL AS 'Razão Social',
          cg.NMFANTASIA AS 'Nome Fantasia',
          CASE cg.FGFISICAJURIDICA 
            WHEN 'F' THEN 'Física'
            WHEN 'J' THEN 'Jurídica'
            ELSE 'Não informado'
          END AS 'Tipo Pessoa',
          CASE cg.FGTIPOCADASTRO
            WHEN 'O' THEN 'Operador do Sistema'
            WHEN 'M' THEN 'Motorista'
            WHEN 'A' THEN 'Agente'
            WHEN 'G' THEN 'Grupo de Divulgação'
            WHEN 'T' THEN 'Transportador'
            WHEN 'U' THEN 'Unidade de Negócio'
            ELSE 'Não informado'
          END AS 'Tipo Cadastro',
          CASE cg.FGRASTREADO
            WHEN 'S' THEN 'Sim'
            WHEN 'N' THEN 'Não'
            ELSE 'Não informado'
          END AS 'Possui Veículo Rastreado',
          CASE cg.FGACTIVE
            WHEN 'A' THEN 'Ativo'
            WHEN 'I' THEN 'Inativo'
            ELSE 'Não informado'
          END AS 'Situação',
          
          -- Dados de endereço
          cg.CEP AS 'CEP',
          cg.ENDERECO AS 'Endereço',
          cg.NRENDERECO AS 'Número',
          cg.COMPLEND AS 'Complemento',
          cg.BAIRRO AS 'Bairro',
          
          -- Dados da cidade (tabela auxiliar CIDADE)
          c.ESTADO AS 'Estado',
          c.NMCIDADE AS 'Cidade',
          c.CDCIDADE AS 'Código Cidade',
          
          -- Dados de contato
          cg.NRCELULAR AS 'Celular',
          cg.ENDEMAIL AS 'Email',
          
          -- Dados de localização
          cg.LATITUDE AS 'Latitude',
          cg.LONGITUDE AS 'Longitude',
          
          -- Dados do transportador (tabela auxiliar CADASTROGERAL - Transportador)
          cg.CDTRANSPORTADOR AS 'Código Transportador',
          t.RZSOCIAL AS 'Nome Transportador',
          t.CGCCPF AS 'CPF/CNPJ Transportador',
          t.NRCELULAR AS 'Celular Transportador',
          t.ENDEMAIL AS 'Email Transportador',
          
          -- Dados de manutenção
          cg.DHMAINTENANCE AS 'Data Manutenção',
          cg.SGUSER AS 'Usuário',
          cg.SERVERORIG AS 'Servidor Origem'
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
        WHERE 1=1
      `;

      const params = [];
      if (codigo) {
        query += ` AND cg.CDCADASTRO = @CODIGO`;
        params.push({ name: 'CODIGO', value: parseFloat(codigo) });
      }
      if (cgccpf) {
        const cgccpfStr = String(cgccpf).replace(/[^\d]+/g, '');
        query += ` AND cg.CGCCPF = @CGCCPF`;
        params.push({ name: 'CGCCPF', type: sql.VarChar(14), value: cgccpfStr });
      }
      if (razaoSocial) {
        query += ` AND cg.RZSOCIAL LIKE @RAZAOSOCIAL`;
        params.push({ name: 'RAZAOSOCIAL', value: `%${razaoSocial}%` });
      }
      if (nomeFantasia) {
        query += ` AND cg.NMFANTASIA LIKE @NMFANTASIA`;
        params.push({ name: 'NMFANTASIA', value: `%${nomeFantasia}%` });
      }
      if (tipoPessoa) {
        query += ` AND cg.FGFISICAJURIDICA = @TIPOPESSOA`;
        params.push({ name: 'TIPOPESSOA', value: tipoPessoa });
      }
      if (cidadeEstado) {
        query += ` AND c.ESTADO = @CIDADE_ESTADO`;
        params.push({ name: 'CIDADE_ESTADO', value: cidadeEstado });
      }
      if (cidadeNome) {
        query += ` AND c.NMCIDADE LIKE @CIDADE_NOME`;
        params.push({ name: 'CIDADE_NOME', value: `%${cidadeNome}%` });
      }
      if (celular) {
        query += ` AND cg.NRCELULAR = @CELULAR`;
        params.push({ name: 'CELULAR', value: parseFloat(celular) });
      }
      if (email) {
        query += ` AND cg.ENDEMAIL LIKE @EMAIL`;
        params.push({ name: 'EMAIL', value: `%${email}%` });
      }
      if (situacao) {
        query += ` AND cg.FGACTIVE = @SITUACAO`;
        params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
      }
      if (tipoCadastro) {
        query += ` AND cg.FGTIPOCADASTRO = @TIPOCADASTRO`;
        params.push({ name: 'TIPOCADASTRO', value: tipoCadastro.trim().toUpperCase() });
      }
      if (rastreado) {
        query += ` AND cg.FGRASTREADO = @RASTREADO`;
        params.push({ name: 'RASTREADO', value: rastreado });
      }
      if (transportador) {
        query += ` AND cg.CDTRANSPORTADOR = @TRANSPORTADOR`;
        params.push({ name: 'TRANSPORTADOR', value: parseFloat(transportador) });
      }

      query += ` ORDER BY cg.RZSOCIAL`;

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
      
      // Converter para array de objetos simples
      const dados = result.recordset.map(row => {
        const obj = {};
        for (const key in row) {
          obj[key] = row[key] !== null && row[key] !== undefined ? row[key] : '';
        }
        return obj;
      });

      // Criar workbook Excel
      const worksheet = XLSX.utils.json_to_sheet(dados);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Cadastros Gerais');

      // Configurar largura das colunas
      const colWidths = [
        { wch: 12 },  // Código
        { wch: 18 },  // CPF/CNPJ
        { wch: 40 },  // Razão Social
        { wch: 30 },  // Nome Fantasia
        { wch: 12 },  // Tipo Pessoa
        { wch: 20 },  // Tipo Cadastro
        { wch: 20 },  // Possui Veículo Rastreado
        { wch: 12 },  // Situação
        { wch: 10 },  // CEP
        { wch: 40 },  // Endereço
        { wch: 10 },  // Número
        { wch: 20 },  // Complemento
        { wch: 25 },  // Bairro
        { wch: 5 },   // Estado
        { wch: 30 },  // Cidade
        { wch: 12 },  // Código Cidade
        { wch: 15 },  // Celular
        { wch: 30 },  // Email
        { wch: 15 },  // Latitude
        { wch: 15 },  // Longitude
        { wch: 18 },  // Código Transportador
        { wch: 40 },  // Nome Transportador
        { wch: 18 },  // CPF/CNPJ Transportador
        { wch: 15 },  // Celular Transportador
        { wch: 30 },  // Email Transportador
        { wch: 20 },  // Data Manutenção
        { wch: 15 },  // Usuário
        { wch: 15 }   // Servidor Origem
      ];
      worksheet['!cols'] = colWidths;

      // Gerar buffer do Excel
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Configurar headers para download
      const filename = `cadastros-gerais-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      res.send(excelBuffer);
    } catch (err) {
      console.error('Erro ao exportar cadastros para Excel:', err);
      res.status(500).json({ error: 'Erro ao exportar dados para Excel.' });
    }
  },

  // Aplicar correção da stored procedure SP_INTGRACAO_VALIDADE
  aplicarCorrecaoSPValidade: async (req, res) => {
    try {
      const pool = await poolPromise;
      const scriptPath = path.join(__dirname, '../scripts/corrigir_sp_integracao_validade.sql');
      
      // Ler o arquivo SQL
      let sqlContent;
      try {
        sqlContent = fs.readFileSync(scriptPath, 'utf8');
      } catch (err) {
        console.error('Erro ao ler arquivo SQL:', err);
        return res.status(500).json({ 
          error: 'Erro ao ler arquivo de correção.',
          detalhes: err.message 
        });
      }

      // Dividir por GO se houver múltiplos comandos
      const comandos = sqlContent.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
      const resultados = [];

      for (const comando of comandos) {
        const cmdLimpo = comando.trim();
        if (!cmdLimpo) continue;

        try {
          const request = pool.request();
          request.timeout = 120000; // 2 minutos
          const result = await request.query(cmdLimpo);

          if (result.recordset && result.recordset.length > 0) {
            resultados.push({ 
              tipo: 'SELECT', 
              rows: result.recordset, 
              rowCount: result.recordset.length 
            });
          } else {
            resultados.push({ 
              tipo: 'EXEC', 
              message: 'Comando executado com sucesso.', 
              rowsAffected: result.rowsAffected || [0] 
            });
          }
        } catch (cmdErr) {
          let mensagemErro = cmdErr.message;
          if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
            mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
          }
          resultados.push({
            tipo: 'ERRO',
            error: mensagemErro,
            comando: cmdLimpo.substring(0, 200),
            detalhes: { nome: cmdErr.name, codigo: cmdErr.code, numero: cmdErr.number }
          });
        }
      }

      // Verificar se houve erros
      const erros = resultados.filter(r => r.tipo === 'ERRO');
      if (erros.length > 0) {
        return res.status(500).json({ 
          success: false, 
          error: 'Erros ao aplicar correção.',
          resultados: resultados,
          erros: erros
        });
      }

      res.json({ 
        success: true, 
        message: 'Correção aplicada com sucesso!',
        resultados: resultados, 
        totalComandos: comandos.length 
      });
    } catch (err) {
      console.error('Erro ao aplicar correção SP_INTGRACAO_VALIDADE:', err);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: 'Erro ao aplicar correção da stored procedure.',
          detalhes: err.message 
        });
      }
    }
  }
};

module.exports = cadastroController;