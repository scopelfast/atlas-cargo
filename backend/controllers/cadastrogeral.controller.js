// backend/controllers/cadastrogeral.controller.js
// Controller para Cadastro Geral
// Versão: 1.1 - Com Classes de Frota
// Atlas Cargo
// Data: 2026-04-05

const sql = require('../config/mssql-compat');
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { poolPromise } = require('../config/db');

// Constantes (legado: um tipo por cadastro; mantido para compatibilidade de exibição)
const TIPO_CADASTRO = {
  'O': 'Operador do Sistema',
  'P': 'Programador / Contratador',
  'M': 'Motorista',
  'T': 'Transportador',
  'A': 'Agente / Parceiro',
  'G': 'Grupo de Divulgação',
  'C': 'Certificadora',
  'U': 'Unidade de Negócio'
};

// Aplicável para: ordem e mapeamento coluna -> código
const APPLICABLE_OPCOES = [
  { cod: 'O', col: 'FGOPERADOR', label: 'Operador do Sistema' },
  { cod: 'P', col: 'FGPROGRAMADOR', label: 'Programador / Contratador' },
  { cod: 'M', col: 'FGMOTORISTA', label: 'Motorista' },
  { cod: 'T', col: 'FGTRANSPORTADOR', label: 'Transportador' },
  { cod: 'A', col: 'FGAGENTE', label: 'Agente / Parceiro' },
  { cod: 'G', col: 'FGGRUPO', label: 'Grupo de Divulgação' },
  { cod: 'C', col: 'FGCERTIFICADORA', label: 'Certificadora' },
  { cod: 'U', col: 'FGUNIDADENEGOCIO', label: 'Unidade de Negócio' }
];
const APPLICABLE_COL_MAP = Object.fromEntries(APPLICABLE_OPCOES.map(a => [a.cod, a.col]));

const { getSgUser } = require('../utils/audit');
const { getContexto } = require('../services/contexto.service');
const { validarDocumento, normalizarDocumento } = require('../services/documento.service');

const FISICA_JURIDICA = {
  'F': 'Física',
  'J': 'Jurídica'
};

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
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador,
        statusAprovacao
      } = req.query;
      
      const pool = await poolPromise;
      const values = [];
      let paramIndex = 0;
      const pushVal = (v) => { values.push(v); return `$${++paramIndex}`; };

      let query = `
        SELECT 
          cg."CDCADASTRO",
          cg."CGCCPF",
          cg."RZSOCIAL",
          cg."NMFANTASIA",
          cg."FGFISICAJURIDICA",
          cg."CEP",
          cg."CDCIDADE",
          c."ESTADO" AS "CIDADE_ESTADO",
          c."NMCIDADE" AS "CIDADE_NOME",
          cg."ENDERECO",
          cg."NRENDERECO",
          cg."COMPLEND",
          cg."BAIRRO",
          cg."NRCELULAR",
          cg."ENDEMAIL",
          cg."LATITUDE",
          cg."LONGITUDE",
          cg."FGACTIVE",
          cg."FGTIPOCADASTRO",
          cg."FGOPERADOR", cg."FGPROGRAMADOR", cg."FGMOTORISTA", cg."FGTRANSPORTADOR",
          cg."FGAGENTE", cg."FGGRUPO", cg."FGCERTIFICADORA", cg."FGUNIDADENEGOCIO",
          cg."CDTRANSPORTADOR",
          t."RZSOCIAL" AS "TRANSPORTADOR_NOME",
          cg."PAIS",
          mc."STATUSAPROVACAO"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "CADASTROGERAL" t ON cg."CDTRANSPORTADOR" = t."CDCADASTRO"
        LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
        WHERE 1=1
      `;

      if (codigo) {
        query += ` AND cg."CDCADASTRO" = ${pushVal(parseFloat(codigo))}`;
      }
      if (cgccpf) {
        const cgccpfStr = String(cgccpf).replace(/[^\d]+/g, '');
        query += ` AND cg."CGCCPF" = ${pushVal(cgccpfStr)}`;
      }
      if (razaoSocial) {
        query += ` AND cg."RZSOCIAL" ILIKE ${pushVal(`%${razaoSocial}%`)}`;
      }
      if (nomeFantasia) {
        query += ` AND cg."NMFANTASIA" ILIKE ${pushVal(`%${nomeFantasia}%`)}`;
      }
      if (tipoPessoa) {
        query += ` AND cg."FGFISICAJURIDICA" = ${pushVal(tipoPessoa)}`;
      }
      if (cidadeEstado) {
        query += ` AND c."ESTADO" = ${pushVal(cidadeEstado)}`;
      }
      if (cidadeNome) {
        query += ` AND c."NMCIDADE" LIKE ${pushVal(`%${cidadeNome}%`)}`;
      }
      if (celular) {
        query += ` AND cg."NRCELULAR" = ${pushVal(parseFloat(celular))}`;
      }
      if (email) {
        query += ` AND cg."ENDEMAIL" LIKE ${pushVal(`%${email}%`)}`;
      }
      if (situacao) {
        query += ` AND cg."FGACTIVE" = ${pushVal(situacao === 'S' ? 'A' : 'I')}`;
      }
      if (tipoCadastro) {
        const col = APPLICABLE_COL_MAP[tipoCadastro.trim().toUpperCase()];
        if (col) query += ` AND cg."${col}" = ${pushVal('S')}`;
        else query += ` AND cg."FGTIPOCADASTRO" = ${pushVal(tipoCadastro.trim().toUpperCase())}`;
      }
      if (rastreado) {
        query += ` AND cg."FGRASTREADO" = ${pushVal(rastreado)}`;
      }
      if (transportador) {
        query += ` AND cg."CDTRANSPORTADOR" = ${pushVal(parseFloat(transportador))}`;
      }
      if (statusAprovacao) {
        const s = String(statusAprovacao).trim().toUpperCase();
        if (['P', 'A', 'R'].includes(s)) {
          query += ` AND mc."CDCADASTRO" IS NOT NULL AND mc."STATUSAPROVACAO" = ${pushVal(s)}`;
        }
      }

      query += ` ORDER BY cg."RZSOCIAL"`;

      const result = await pool.query(query, values);
      const cadastros = (result.rows || []).map(cg => {
        const aplicavel = APPLICABLE_OPCOES.filter(a => (cg[a.col] || '') === 'S').map(a => a.cod);
        const tipoCadastroNome = aplicavel.length
          ? aplicavel.map(c => TIPO_CADASTRO[c]).join(', ')
          : (TIPO_CADASTRO[cg.FGTIPOCADASTRO] || 'Não informado');
        return {
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
          FGTIPOCADASTRO_NOME: tipoCadastroNome,
          FGOPERADOR: (cg.FGOPERADOR || 'N') === 'S',
          FGPROGRAMADOR: (cg.FGPROGRAMADOR || 'N') === 'S',
          FGMOTORISTA: (cg.FGMOTORISTA || 'N') === 'S',
          FGTRANSPORTADOR: (cg.FGTRANSPORTADOR || 'N') === 'S',
          FGAGENTE: (cg.FGAGENTE || 'N') === 'S',
          FGGRUPO: (cg.FGGRUPO || 'N') === 'S',
          FGCERTIFICADORA: (cg.FGCERTIFICADORA || 'N') === 'S',
          FGUNIDADENEGOCIO: (cg.FGUNIDADENEGOCIO || 'N') === 'S',
          APLICAVEL_CODIGOS: aplicavel,
          CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null,
          TRANSPORTADOR_NOME: cg.TRANSPORTADOR_NOME || null,
          PAIS: cg.PAIS || null,
          STATUSAPROVACAO: (cg.STATUSAPROVACAO || (cg.FGMOTORISTA === 'S' ? 'P' : null))
        };
      });
      
      res.json(cadastros);
    } catch (err) {
      const msg = err.message || String(err);
      const code = err.code; // código do PostgreSQL (ex: 42P01 = tabela não existe, 28P01 = auth failed)
      console.error('[CadastroGeral] Erro ao listar:', msg);
      if (code) console.error('[CadastroGeral] Código:', code, err.detail || '');
      if (err.stack) console.error(err.stack);
      const details = process.env.NODE_ENV === 'development' ? { message: msg, code: code || undefined, detail: err.detail } : undefined;
      res.status(500).json({ error: 'Erro ao carregar cadastros.', ...(details && { details }) });
    }
  },

  // Criar novo cadastro
  criar: async (req, res) => {
    try {
      const {
        CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
        ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL,
        LATITUDE, LONGITUDE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR,
        FGOPERADOR, FGPROGRAMADOR, FGMOTORISTA, FGTRANSPORTADOR: FGTRANSP,
        FGAGENTE, FGGRUPO, FGCERTIFICADORA, FGUNIDADENEGOCIO,
        PAIS
      } = req.body;

      const flags = {
        FGOPERADOR: FGOPERADOR === true || FGOPERADOR === 'S',
        FGPROGRAMADOR: FGPROGRAMADOR === true || FGPROGRAMADOR === 'S',
        FGMOTORISTA: FGMOTORISTA === true || FGMOTORISTA === 'S',
        FGTRANSPORTADOR: FGTRANSP === true || FGTRANSP === 'S',
        FGAGENTE: FGAGENTE === true || FGAGENTE === 'S',
        FGGRUPO: FGGRUPO === true || FGGRUPO === 'S',
        FGCERTIFICADORA: FGCERTIFICADORA === true || FGCERTIFICADORA === 'S',
        FGUNIDADENEGOCIO: FGUNIDADENEGOCIO === true || FGUNIDADENEGOCIO === 'S'
      };
      const algumAplicavel = Object.values(flags).some(v => v === true);
      if (!algumAplicavel && !FGTIPOCADASTRO) {
        return res.status(400).json({ error: 'Marque pelo menos uma opção em Aplicável para.' });
      }
      const tipoLegado = FGTIPOCADASTRO || (APPLICABLE_OPCOES.find(a => flags[a.col])?.cod ?? 'O');

      // Validações
      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.', errorKey: 'web.modulos.cadastroGeral.camposObrigatorios' });
      }

      const ctx = await getContexto();
      const tipoDoc = FGFISICAJURIDICA === 'F' ? 'F' : 'J';
      let cgccpfStr = normalizarDocumento(ctx.pais, CGCCPF.toString());
      if (ctx.pais === 'BR') {
        if (FGFISICAJURIDICA === 'F') cgccpfStr = cgccpfStr.padStart(11, '0');
        else if (FGFISICAJURIDICA === 'J') cgccpfStr = cgccpfStr.padStart(14, '0');
      }

      const validacao = validarDocumento(ctx.pais, tipoDoc, cgccpfStr);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'web.modulos.cadastroGeral.documentoInvalido' });
      }

      // Verificar duplicidade e gerar novo ID (PostgreSQL)
      const pool = await poolPromise;
      const checkDup = await pool.query(
        'SELECT "CDCADASTRO" FROM "CADASTROGERAL" WHERE "CGCCPF" = $1',
        [cgccpfStr]
      );
      if ((checkDup.rows || []).length > 0) {
        return res.status(400).json({ error: 'Já existe um cadastro com este documento.', errorKey: 'web.modulos.cadastroGeral.documentoDuplicado' });
      }

      const maxRes = await pool.query(
        'SELECT COALESCE(MAX("CDCADASTRO"), 0)::numeric AS "maxId" FROM "CADASTROGERAL"'
      );
      const novoId = Number((maxRes.rows || [])[0]?.maxId ?? 0) + 1;

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const toS = (v) => (v ? 'S' : 'N');
      await pool.query(
        `INSERT INTO "CADASTROGERAL" (
          "CDCADASTRO", "CGCCPF", "RZSOCIAL", "NMFANTASIA", "FGFISICAJURIDICA", "CEP", "CDCIDADE",
          "ENDERECO", "NRENDERECO", "COMPLEND", "BAIRRO", "NRCELULAR", "ENDEMAIL", "LATITUDE", "LONGITUDE",
          "FGACTIVE", "FGTIPOCADASTRO", "FGOPERADOR", "FGPROGRAMADOR", "FGMOTORISTA", "FGTRANSPORTADOR",
          "FGAGENTE", "FGGRUPO", "FGCERTIFICADORA", "FGUNIDADENEGOCIO",
          "FGRASTREADO", "CDTRANSPORTADOR", "PAIS", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'A', $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, CURRENT_TIMESTAMP, $28, 'AppDVcargas')`,
        [
          novoId, cgccpfStr, RZSOCIAL.trim(), NMFANTASIA?.trim() || null, FGFISICAJURIDICA,
          CEP || null, CDCIDADE || null, (ENDERECO && String(ENDERECO).trim()) ? String(ENDERECO).trim() : null, (NRENDERECO !== undefined && NRENDERECO !== null && NRENDERECO !== '') ? NRENDERECO : null, COMPLEND?.trim() || null,
          (BAIRRO && String(BAIRRO).trim()) ? String(BAIRRO).trim() : null, NRCELULAR, ENDEMAIL?.trim() || null, LATITUDE || null, LONGITUDE || null,
          tipoLegado,
          toS(flags.FGOPERADOR), toS(flags.FGPROGRAMADOR), toS(flags.FGMOTORISTA), toS(flags.FGTRANSPORTADOR),
          toS(flags.FGAGENTE), toS(flags.FGGRUPO), toS(flags.FGCERTIFICADORA), toS(flags.FGUNIDADENEGOCIO),
          FGRASTREADO || 'N', (flags.FGMOTORISTA && CDTRANSPORTADOR) ? CDTRANSPORTADOR : null,
          (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : null,
          sgUser
        ]
      );

      // Não inserir classes de frota ao criar: novo cadastro começa com nenhuma classe selecionada.
      // O usuário escolhe na aba "Classes Frota" após salvar.

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
        LATITUDE, LONGITUDE, FGACTIVE, FGTIPOCADASTRO, FGRASTREADO, CDTRANSPORTADOR,
        FGOPERADOR, FGPROGRAMADOR, FGMOTORISTA, FGTRANSPORTADOR: FGTRANSP,
        FGAGENTE, FGGRUPO, FGCERTIFICADORA, FGUNIDADENEGOCIO,
        PAIS,
        STATUSAPROVACAO, PAIS_DESTINO_PREF, SIGLA_ESTADO_DESTINO_PREF, CIDADE_DESTINO_PREF,
        PAIS_EMBARQUE_PREF, SIGLA_ESTADO_EMBARQUE_PREF, REGIAO_EMBARQUE_PREF, CIDADE_EMBARQUE_PREF
      } = req.body;

      const flags = {
        FGOPERADOR: FGOPERADOR === true || FGOPERADOR === 'S',
        FGPROGRAMADOR: FGPROGRAMADOR === true || FGPROGRAMADOR === 'S',
        FGMOTORISTA: FGMOTORISTA === true || FGMOTORISTA === 'S',
        FGTRANSPORTADOR: FGTRANSP === true || FGTRANSP === 'S',
        FGAGENTE: FGAGENTE === true || FGAGENTE === 'S',
        FGGRUPO: FGGRUPO === true || FGGRUPO === 'S',
        FGCERTIFICADORA: FGCERTIFICADORA === true || FGCERTIFICADORA === 'S',
        FGUNIDADENEGOCIO: FGUNIDADENEGOCIO === true || FGUNIDADENEGOCIO === 'S'
      };
      const algumAplicavel = Object.values(flags).some(v => v === true);
      if (!algumAplicavel && !FGTIPOCADASTRO) {
        return res.status(400).json({ error: 'Marque pelo menos uma opção em Aplicável para.' });
      }
      const tipoLegado = FGTIPOCADASTRO || (APPLICABLE_OPCOES.find(a => flags[a.col])?.cod ?? 'O');

      if (!CGCCPF || !RZSOCIAL || !FGFISICAJURIDICA || !NRCELULAR) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.', errorKey: 'web.modulos.cadastroGeral.camposObrigatorios' });
      }

      const ctx = await getContexto();
      // País do cadastro prevalece; quando não informado, usa o padrão das Configurações.
      const paisVal = (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : (ctx.pais || 'BR');
      const tipoDoc = FGFISICAJURIDICA === 'F' ? 'F' : 'J';
      let cgccpfStr = normalizarDocumento(paisVal, CGCCPF.toString());
      if (paisVal === 'BR') {
        if (FGFISICAJURIDICA === 'F') cgccpfStr = cgccpfStr.padStart(11, '0');
        else if (FGFISICAJURIDICA === 'J') cgccpfStr = cgccpfStr.padStart(14, '0');
      }

      const validacao = validarDocumento(paisVal, tipoDoc, cgccpfStr);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'web.modulos.cadastroGeral.documentoInvalido' });
      }

      const sgUserUpd = getSgUser(req);
      if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const pool = await poolPromise;
      const idNumerico = parseFloat(id);

      const cadastroAtual = await pool.query(
        'SELECT "CDTRANSPORTADOR" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1',
        [idNumerico]
      );
      const rowsAtual = cadastroAtual.rows || [];
      const toS = (v) => (v ? 'S' : 'N');
      const valorTransportador = !flags.FGMOTORISTA ? null
        : (CDTRANSPORTADOR !== undefined ? (CDTRANSPORTADOR || null) : (rowsAtual[0]?.CDTRANSPORTADOR ?? null));

      await pool.query(
        `UPDATE "CADASTROGERAL" SET
          "CGCCPF" = $1, "RZSOCIAL" = $2, "NMFANTASIA" = $3, "FGFISICAJURIDICA" = $4,
          "CEP" = $5, "CDCIDADE" = $6, "ENDERECO" = $7, "NRENDERECO" = $8,
          "COMPLEND" = $9, "BAIRRO" = $10, "NRCELULAR" = $11, "ENDEMAIL" = $12,
          "LATITUDE" = $13, "LONGITUDE" = $14, "FGACTIVE" = $15, "FGTIPOCADASTRO" = $16,
          "FGOPERADOR" = $17, "FGPROGRAMADOR" = $18, "FGMOTORISTA" = $19, "FGTRANSPORTADOR" = $20,
          "FGAGENTE" = $21, "FGGRUPO" = $22, "FGCERTIFICADORA" = $23, "FGUNIDADENEGOCIO" = $24,
          "FGRASTREADO" = $25, "CDTRANSPORTADOR" = $26, "PAIS" = $27,
          "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $28, "SERVERORIG" = 'AppDVcargas'
        WHERE "CDCADASTRO" = $29`,
        [
          cgccpfStr, RZSOCIAL.trim(), NMFANTASIA?.trim() || null, FGFISICAJURIDICA,
          CEP || null, CDCIDADE || null, (ENDERECO && String(ENDERECO).trim()) ? String(ENDERECO).trim() : null, (NRENDERECO !== undefined && NRENDERECO !== null && NRENDERECO !== '') ? NRENDERECO : null,
          COMPLEND?.trim() || null, (BAIRRO && String(BAIRRO).trim()) ? String(BAIRRO).trim() : null, NRCELULAR, ENDEMAIL?.trim() || null,
          LATITUDE || null, LONGITUDE || null, FGACTIVE === 'S' ? 'A' : 'I',
          tipoLegado,
          toS(flags.FGOPERADOR), toS(flags.FGPROGRAMADOR), toS(flags.FGMOTORISTA), toS(flags.FGTRANSPORTADOR),
          toS(flags.FGAGENTE), toS(flags.FGGRUPO), toS(flags.FGCERTIFICADORA), toS(flags.FGUNIDADENEGOCIO),
          FGRASTREADO || 'N', valorTransportador,
          (PAIS && String(PAIS).trim()) ? String(PAIS).trim().toUpperCase() : null,
          sgUserUpd, idNumerico
        ]
      );

      if (flags.FGMOTORISTA) {
        const statusAprov = (STATUSAPROVACAO && ['P', 'A', 'R'].includes(String(STATUSAPROVACAO).trim().toUpperCase()))
          ? String(STATUSAPROVACAO).trim().toUpperCase() : 'P';
        const paisDest = (PAIS_DESTINO_PREF && String(PAIS_DESTINO_PREF).trim()) ? String(PAIS_DESTINO_PREF).trim().substring(0, 2) : null;
        const estadoDest = (SIGLA_ESTADO_DESTINO_PREF && String(SIGLA_ESTADO_DESTINO_PREF).trim()) ? String(SIGLA_ESTADO_DESTINO_PREF).trim().substring(0, 10) : null;
        const cidadeDest = (CIDADE_DESTINO_PREF && String(CIDADE_DESTINO_PREF).trim()) ? String(CIDADE_DESTINO_PREF).trim().substring(0, 100) : null;
        const paisEmb = (PAIS_EMBARQUE_PREF && String(PAIS_EMBARQUE_PREF).trim()) ? String(PAIS_EMBARQUE_PREF).trim().substring(0, 2) : null;
        const estadoEmb = (SIGLA_ESTADO_EMBARQUE_PREF && String(SIGLA_ESTADO_EMBARQUE_PREF).trim()) ? String(SIGLA_ESTADO_EMBARQUE_PREF).trim().substring(0, 10) : null;
        const regiaoEmb = (REGIAO_EMBARQUE_PREF && String(REGIAO_EMBARQUE_PREF).trim()) ? String(REGIAO_EMBARQUE_PREF).trim().substring(0, 60) : null;
        const cidadeEmb = (CIDADE_EMBARQUE_PREF && String(CIDADE_EMBARQUE_PREF).trim()) ? String(CIDADE_EMBARQUE_PREF).trim().substring(0, 100) : null;
        const existeMc = await pool.query('SELECT 1 FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1', [idNumerico]);
        if ((existeMc.rows || []).length > 0) {
          await pool.query(
            `UPDATE "MOTORISTA_COMPLEMENTO" SET "STATUSAPROVACAO" = $1, "PAIS_DESTINO_PREF" = $2, "SIGLA_ESTADO_DESTINO_PREF" = $3, "CIDADE_DESTINO_PREF" = $4,
             "PAIS_EMBARQUE_PREF" = $6, "SIGLA_ESTADO_EMBARQUE_PREF" = $7, "REGIAO_EMBARQUE_PREF" = $8, "CIDADE_EMBARQUE_PREF" = $9
             WHERE "CDCADASTRO" = $5`,
            [statusAprov, paisDest, estadoDest, cidadeDest, idNumerico, paisEmb, estadoEmb, regiaoEmb, cidadeEmb]
          );
        } else {
          await pool.query(
            `INSERT INTO "MOTORISTA_COMPLEMENTO" ("CDCADASTRO", "STATUSAPROVACAO", "PAIS_DESTINO_PREF", "SIGLA_ESTADO_DESTINO_PREF", "CIDADE_DESTINO_PREF",
             "PAIS_EMBARQUE_PREF", "SIGLA_ESTADO_EMBARQUE_PREF", "REGIAO_EMBARQUE_PREF", "CIDADE_EMBARQUE_PREF") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [idNumerico, statusAprov, paisDest, estadoDest, cidadeDest, paisEmb, estadoEmb, regiaoEmb, cidadeEmb]
          );
        }
      }

      res.json({ success: true, message: 'Cadastro atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao atualizar cadastro.' });
    }
  },

  // Buscar cadastro por ID (PostgreSQL)
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool.query(
        `SELECT 
          cg."CDCADASTRO", cg."CGCCPF", cg."RZSOCIAL", cg."NMFANTASIA",
          cg."FGFISICAJURIDICA", cg."CEP", cg."CDCIDADE", cg."PAIS",
          c."ESTADO" AS "CIDADE_ESTADO", c."NMCIDADE" AS "CIDADE_NOME",
          cg."ENDERECO", cg."NRENDERECO", cg."COMPLEND", cg."BAIRRO",
          cg."NRCELULAR", cg."ENDEMAIL", cg."LATITUDE", cg."LONGITUDE",
          cg."FGACTIVE", cg."FGTIPOCADASTRO", cg."FGRASTREADO", cg."CDTRANSPORTADOR",
          cg."FGOPERADOR", cg."FGPROGRAMADOR", cg."FGMOTORISTA", cg."FGTRANSPORTADOR",
          cg."FGAGENTE", cg."FGGRUPO", cg."FGCERTIFICADORA", cg."FGUNIDADENEGOCIO",
          mc."STATUSAPROVACAO", mc."PAIS_DESTINO_PREF", mc."SIGLA_ESTADO_DESTINO_PREF", mc."CIDADE_DESTINO_PREF"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
        WHERE cg."CDCADASTRO" = $1`,
        [parseFloat(id)]
      );
      const rows = result.rows || [];
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }
      const cg = rows[0];
      res.json({
        CDCADASTRO: cg.CDCADASTRO,
        CGCCPF: cg.CGCCPF,
        RZSOCIAL: cg.RZSOCIAL,
        NMFANTASIA: cg.NMFANTASIA,
        FGFISICAJURIDICA: cg.FGFISICAJURIDICA,
        CEP: cg.CEP,
        CDCIDADE: cg.CDCIDADE,
        PAIS: cg.PAIS || null,
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
        CDTRANSPORTADOR: cg.CDTRANSPORTADOR || null,
        FGOPERADOR: (cg.FGOPERADOR || 'N') === 'S',
        FGPROGRAMADOR: (cg.FGPROGRAMADOR || 'N') === 'S',
        FGMOTORISTA: (cg.FGMOTORISTA || 'N') === 'S',
        FGTRANSPORTADOR: (cg.FGTRANSPORTADOR || 'N') === 'S',
        FGAGENTE: (cg.FGAGENTE || 'N') === 'S',
        FGGRUPO: (cg.FGGRUPO || 'N') === 'S',
        FGCERTIFICADORA: (cg.FGCERTIFICADORA || 'N') === 'S',
        FGUNIDADENEGOCIO: (cg.FGUNIDADENEGOCIO || 'N') === 'S',
        STATUSAPROVACAO: cg.STATUSAPROVACAO || 'P',
        PAIS_DESTINO_PREF: cg.PAIS_DESTINO_PREF || null,
        SIGLA_ESTADO_DESTINO_PREF: cg.SIGLA_ESTADO_DESTINO_PREF || null,
        CIDADE_DESTINO_PREF: cg.CIDADE_DESTINO_PREF || null,
        PAIS_EMBARQUE_PREF: cg.PAIS_EMBARQUE_PREF || null,
        SIGLA_ESTADO_EMBARQUE_PREF: cg.SIGLA_ESTADO_EMBARQUE_PREF || null,
        REGIAO_EMBARQUE_PREF: cg.REGIAO_EMBARQUE_PREF || null,
        CIDADE_EMBARQUE_PREF: cg.CIDADE_EMBARQUE_PREF || null
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

      const checkResult = await pool.query(
        'SELECT "FGACTIVE" FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1',
        [idNumerico]
      );
      const checkRows = checkResult.rows || [];
      if (checkRows.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      const statusAtual = checkRows[0].FGACTIVE;
      const estaAtivo = statusAtual === 'A';
      let novaSituacao, mensagem;
      if (action === 'activate') {
        novaSituacao = 'A';
        mensagem = 'Cadastro reativado com sucesso!';
      } else if (action === 'deactivate') {
        novaSituacao = 'I';
        mensagem = 'Cadastro desativado com sucesso!';
      } else {
        novaSituacao = estaAtivo ? 'I' : 'A';
        mensagem = estaAtivo ? 'Cadastro desativado com sucesso!' : 'Cadastro reativado com sucesso!';
      }

      const sgUserStatus = getSgUser(req);
      if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const result = await pool.query(
        `UPDATE "CADASTROGERAL" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2, "SERVERORIG" = 'AppDVcargas' WHERE "CDCADASTRO" = $3`,
        [novaSituacao, sgUserStatus, idNumerico]
      );

      if ((result.rowCount ?? 0) === 0) {
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

      const pool = await poolPromise;
      const cidadeResult = await pool.query(
        `SELECT "CDCIDADE", "ESTADO", "NMCIDADE" FROM "CIDADE" WHERE "ESTADO" = $1 AND "NMCIDADE" = $2 AND "FGACTIVE" = 'A' LIMIT 1`,
        [dadosCEP.uf, dadosCEP.localidade]
      );
      const cidadeRows = cidadeResult.rows || [];
      res.json({
        ...dadosCEP,
        cidade: cidadeRows[0] || null
      });
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
      res.status(500).json({ error: 'Erro ao buscar CEP.' });
    }
  },

  // Listar combos (opções para filtro "Aplicável para" - ordem: O, P, M, T, A, G, C, U)
  listarTiposCadastro: (req, res) => {
    const tipos = APPLICABLE_OPCOES.map(a => ({ value: a.cod, label: `[${a.cod}] ${a.label}` }));
    res.json(tipos);
  },

  listarTiposPessoa: (req, res) => {
    const tipos = Object.entries(FISICA_JURIDICA).map(([value, label]) => ({ value, label }));
    res.json(tipos);
  },

  // Listar classes de frota para um cadastro específico (PostgreSQL)
  listarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const todasClasses = await pool.query(
        `SELECT "CDCLASSEFROTA", "DSCLASSEFROTA" FROM "CLASSEFROTA" WHERE "FGACTIVE" = 'A' ORDER BY "DSCLASSEFROTA"`
      );
      const classesAssociadas = await pool.query(
        `SELECT "CDCLASSEFROTA", "FGACTIVE" FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1`,
        [parseFloat(id)]
      );
      const mapaAssociadas = {};
      (classesAssociadas.rows || []).forEach(row => {
        const idClasse = row.CDCLASSEFROTA ?? row.cdclassefrota;
        const fg = row.FGACTIVE ?? row.fgactive;
        if (idClasse !== undefined && idClasse !== null) mapaAssociadas[idClasse] = fg;
      });
      const resultado = (todasClasses.rows || []).map(row => {
        const idClasse = row.CDCLASSEFROTA ?? row.cdclassefrota;
        const nome = row.DSCLASSEFROTA ?? row.dsclassefrota;
        return {
          CDCLASSEFROTA: idClasse,
          DSCLASSEFROTA: nome,
          FGACTIVE: (idClasse !== undefined && mapaAssociadas[idClasse] === 'S') ? 'S' : 'N'
        };
      });
      res.json(resultado);
    } catch (err) {
      console.error('Erro ao listar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  // Atualizar classes de frota para um cadastro (PostgreSQL)
  atualizarClassesParaCadastro: async (req, res) => {
    try {
      const { id } = req.params;
      const { classes } = req.body;
      if (!classes || !Array.isArray(classes)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
      }
      const pool = await poolPromise;
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      const idNum = parseFloat(id);
      const existentes = await pool.query(
        'SELECT "CDCLASSEFROTA" FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1',
        [idNum]
      );
      const existentesSet = new Set((existentes.rows || []).map(c => c.CDCLASSEFROTA));
      for (const classe of classes) {
        const { CDCLASSEFROTA, FGACTIVE } = classe;
        if (existentesSet.has(CDCLASSEFROTA)) {
          await pool.query(
            `UPDATE "CLASSEFROTA_CG" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2, "SERVERORIG" = 'AppDVcargas' WHERE "CDCADASTRO" = $3 AND "CDCLASSEFROTA" = $4`,
            [FGACTIVE, sgUser, idNum, CDCLASSEFROTA]
          );
        } else {
          await pool.query(
            `INSERT INTO "CLASSEFROTA_CG" ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG") VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, 'AppDVcargas')`,
            [idNum, CDCLASSEFROTA, FGACTIVE, sgUser]
          );
        }
      }
      res.json({ success: true, message: 'Classes de frota atualizadas com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar classes para cadastro:', err);
      res.status(500).json({ error: 'Erro ao atualizar classes de frota.' });
    }
  },

  // Buscar transportadores (tipo T ou flag FGTRANSPORTADOR = S) para combo (PostgreSQL)
  listarTransportadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.query(`
        SELECT "CDCADASTRO", "RZSOCIAL"
        FROM "CADASTROGERAL"
        WHERE ("FGTIPOCADASTRO" = 'T' OR COALESCE("FGTRANSPORTADOR", 'N') = 'S')
          AND "FGACTIVE" = 'A'
        ORDER BY "RZSOCIAL"
      `);
      const rows = result.rows || [];
      // Normalizar chaves para o frontend (PostgreSQL pode devolver minúsculas)
      const list = rows.map(r => ({
        CDCADASTRO: r.CDCADASTRO != null ? r.CDCADASTRO : r.cdcadastro,
        RZSOCIAL: (r.RZSOCIAL != null ? r.RZSOCIAL : r.rzsocial) || '-'
      }));
      res.json(list);
    } catch (err) {
      console.error('Erro ao listar transportadores:', err);
      res.status(500).json({ error: 'Erro ao carregar transportadores.' });
    }
  },

  // Exportar cadastros para Excel (PostgreSQL)
  exportarExcel: async (req, res) => {
    try {
      const {
        codigo, cgccpf, razaoSocial, nomeFantasia, tipoPessoa,
        cidadeEstado, cidadeNome, celular, email, situacao, tipoCadastro, rastreado, transportador
      } = req.query;

      const pool = await poolPromise;
      const values = [];
      let paramIndex = 0;
      const pushVal = (v) => { values.push(v); return `$${++paramIndex}`; };

      let query = `
        SELECT 
          cg."CDCADASTRO" AS "Codigo",
          cg."CGCCPF" AS "CPF_CNPJ",
          cg."RZSOCIAL" AS "Razao_Social",
          cg."NMFANTASIA" AS "Nome_Fantasia",
          CASE cg."FGFISICAJURIDICA" WHEN 'F' THEN 'Física' WHEN 'J' THEN 'Jurídica' ELSE 'Não informado' END AS "Tipo_Pessoa",
          CASE cg."FGTIPOCADASTRO" WHEN 'O' THEN 'Operador' WHEN 'M' THEN 'Motorista' WHEN 'A' THEN 'Agente' WHEN 'G' THEN 'Grupo' WHEN 'T' THEN 'Transportador' ELSE 'Não informado' END AS "Tipo_Cadastro",
          CASE cg."FGRASTREADO" WHEN 'S' THEN 'Sim' WHEN 'N' THEN 'Não' ELSE 'Não informado' END AS "Rastreado",
          CASE cg."FGACTIVE" WHEN 'A' THEN 'Ativo' WHEN 'I' THEN 'Inativo' ELSE 'Não informado' END AS "Situacao",
          cg."CEP" AS "CEP", cg."ENDERECO" AS "Endereco", cg."NRENDERECO" AS "Numero", cg."COMPLEND" AS "Complemento", cg."BAIRRO" AS "Bairro",
          c."ESTADO" AS "Estado", c."NMCIDADE" AS "Cidade", c."CDCIDADE" AS "Codigo_Cidade",
          cg."NRCELULAR" AS "Celular", cg."ENDEMAIL" AS "Email",
          cg."LATITUDE" AS "Latitude", cg."LONGITUDE" AS "Longitude",
          cg."CDTRANSPORTADOR" AS "Codigo_Transportador", t."RZSOCIAL" AS "Nome_Transportador", t."CGCCPF" AS "CPF_CNPJ_Transportador", t."NRCELULAR" AS "Celular_Transportador", t."ENDEMAIL" AS "Email_Transportador",
          cg."DHMAINTENANCE" AS "Data_Manutencao", cg."SGUSER" AS "Usuario", cg."SERVERORIG" AS "Servidor_Origem"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
        LEFT JOIN "CADASTROGERAL" t ON cg."CDTRANSPORTADOR" = t."CDCADASTRO"
        WHERE 1=1
      `;
      if (codigo) query += ` AND cg."CDCADASTRO" = ${pushVal(parseFloat(codigo))}`;
      if (cgccpf) query += ` AND cg."CGCCPF" = ${pushVal(String(cgccpf).replace(/[^\d]+/g, ''))}`;
      if (razaoSocial) query += ` AND cg."RZSOCIAL" LIKE ${pushVal(`%${razaoSocial}%`)}`;
      if (nomeFantasia) query += ` AND cg."NMFANTASIA" LIKE ${pushVal(`%${nomeFantasia}%`)}`;
      if (tipoPessoa) query += ` AND cg."FGFISICAJURIDICA" = ${pushVal(tipoPessoa)}`;
      if (cidadeEstado) query += ` AND c."ESTADO" = ${pushVal(cidadeEstado)}`;
      if (cidadeNome) query += ` AND c."NMCIDADE" LIKE ${pushVal(`%${cidadeNome}%`)}`;
      if (celular) query += ` AND cg."NRCELULAR" = ${pushVal(parseFloat(celular))}`;
      if (email) query += ` AND cg."ENDEMAIL" LIKE ${pushVal(`%${email}%`)}`;
      if (situacao) query += ` AND cg."FGACTIVE" = ${pushVal(situacao === 'S' ? 'A' : 'I')}`;
      if (tipoCadastro) query += ` AND cg."FGTIPOCADASTRO" = ${pushVal(tipoCadastro.trim().toUpperCase())}`;
      if (rastreado) query += ` AND cg."FGRASTREADO" = ${pushVal(rastreado)}`;
      if (transportador) query += ` AND cg."CDTRANSPORTADOR" = ${pushVal(parseFloat(transportador))}`;
      query += ` ORDER BY cg."RZSOCIAL"`;

      const result = await pool.query(query, values);
      const dados = (result.rows || []).map(row => {
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
  },

  // Listar locais preferidos do cadastro (lista registro a registro)
  listarLocaisPreferidos: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const cdCadastro = parseFloat(id);
      if (isNaN(cdCadastro)) return res.status(400).json({ error: 'Cadastro inválido.' });
      const result = await pool.query(
        `SELECT lp."CDCADASTRO", lp."SEQUENCIA", lp."TIPO", lp."PAIS", lp."CDUF", lp."CDMESOREGIAO",
                e."ESTADO" AS "ESTADO_UF",
                m."DSMESOREGIAO"
         FROM "CADASTRO_LOCAL_PREFERIDO" lp
         LEFT JOIN "ESTADO" e ON e."CDUF" = lp."CDUF"
         LEFT JOIN "MESOREGIAO" m ON m."CDUF" = lp."CDUF" AND m."CDMESOREGIAO" = lp."CDMESOREGIAO"
         WHERE lp."CDCADASTRO" = $1
         ORDER BY lp."TIPO", lp."SEQUENCIA"`,
        [cdCadastro]
      );
      const rows = (result.rows || []).map(r => ({
        CDCADASTRO: r.CDCADASTRO,
        SEQUENCIA: r.SEQUENCIA,
        TIPO: r.TIPO,
        PAIS: r.PAIS,
        CDUF: r.CDUF,
        CDMESOREGIAO: r.CDMESOREGIAO,
        ESTADO_UF: r.ESTADO_UF || null,
        DSMESOREGIAO: r.DSMESOREGIAO || null
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') return res.status(200).json([]);
      console.error('Erro ao listar locais preferidos:', err);
      res.status(500).json({ error: 'Erro ao carregar locais preferidos.' });
    }
  },

  // Adicionar um local preferido (grava no banco e retorna a lista atualizada)
  adicionarLocalPreferido: async (req, res) => {
    try {
      const { id } = req.params;
      const { TIPO, PAIS, CDUF, CDMESOREGIAO } = req.body;
      const pool = await poolPromise;
      const cdCadastro = parseFloat(id);
      if (isNaN(cdCadastro)) return res.status(400).json({ error: 'Cadastro inválido.' });
      if (!PAIS || !String(PAIS).trim()) return res.status(400).json({ error: 'País é obrigatório.' });
      const tipoVal = (TIPO && String(TIPO).toUpperCase().trim()) === 'D' ? 'D' : 'E';
      const paisVal = String(PAIS).trim().toUpperCase().substring(0, 2);
      const cdufVal = (CDUF !== undefined && CDUF !== null && CDUF !== '') ? parseInt(CDUF, 10) : null;
      const cdmVal = (CDMESOREGIAO !== undefined && CDMESOREGIAO !== null && CDMESOREGIAO !== '') ? parseInt(CDMESOREGIAO, 10) : null;
      if (cdufVal !== null && isNaN(cdufVal)) return res.status(400).json({ error: 'CDUF inválido.' });
      if (cdmVal !== null && isNaN(cdmVal)) return res.status(400).json({ error: 'CDMESOREGIAO inválido.' });

      // Não permitir duplicata: mesmo Tipo + País + Estado + Mesorregião para o mesmo cadastro
      const existente = await pool.query(
        `SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO"
         WHERE "CDCADASTRO" = $1 AND "TIPO" = $2 AND "PAIS" = $3
           AND (COALESCE("CDUF", -1) = COALESCE($4::int, -1))
           AND (COALESCE("CDMESOREGIAO", -1) = COALESCE($5::int, -1))
         LIMIT 1`,
        [cdCadastro, tipoVal, paisVal, cdufVal, cdmVal]
      );
      if (existente.rows && existente.rows.length > 0) {
        return res.status(400).json({ error: 'Já existe um local preferido com o mesmo Tipo, País, Estado e Mesorregião.' });
      }

      const nextSeq = await pool.query(
        `SELECT COALESCE(MAX("SEQUENCIA"), 0) + 1 AS "next" FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1`,
        [cdCadastro]
      );
      const sequencia = (nextSeq.rows && nextSeq.rows[0]) ? nextSeq.rows[0].next : 1;
      const sgUser = getSgUser(req) || 'SYSTEM';
      await pool.query(
        `INSERT INTO "CADASTRO_LOCAL_PREFERIDO" ("CDCADASTRO", "SEQUENCIA", "TIPO", "PAIS", "CDUF", "CDMESOREGIAO", "SGUSER")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cdCadastro, sequencia, tipoVal, paisVal, cdufVal, cdmVal, sgUser]
      );
      const list = await pool.query(
        `SELECT lp."CDCADASTRO", lp."SEQUENCIA", lp."TIPO", lp."PAIS", lp."CDUF", lp."CDMESOREGIAO",
                e."ESTADO" AS "ESTADO_UF", m."DSMESOREGIAO"
         FROM "CADASTRO_LOCAL_PREFERIDO" lp
         LEFT JOIN "ESTADO" e ON e."CDUF" = lp."CDUF"
         LEFT JOIN "MESOREGIAO" m ON m."CDUF" = lp."CDUF" AND m."CDMESOREGIAO" = lp."CDMESOREGIAO"
         WHERE lp."CDCADASTRO" = $1 ORDER BY lp."TIPO", lp."SEQUENCIA"`,
        [cdCadastro]
      );
      res.status(201).json({
        success: true,
        message: 'Local preferido adicionado.',
        lista: (list.rows || []).map(r => ({
          CDCADASTRO: r.CDCADASTRO,
          SEQUENCIA: r.SEQUENCIA,
          TIPO: r.TIPO,
          PAIS: r.PAIS,
          CDUF: r.CDUF,
          CDMESOREGIAO: r.CDMESOREGIAO,
          ESTADO_UF: r.ESTADO_UF || null,
          DSMESOREGIAO: r.DSMESOREGIAO || null
        }))
      });
    } catch (err) {
      if (err.code === '42P01') return res.status(400).json({ error: 'Tabela CADASTRO_LOCAL_PREFERIDO não existe. Execute o script SQL de criação.' });
      console.error('Erro ao adicionar local preferido:', err);
      res.status(500).json({ error: 'Erro ao gravar local preferido.' });
    }
  },

  // Excluir um local preferido por sequência
  excluirLocalPreferido: async (req, res) => {
    try {
      const { id, sequencia } = req.params;
      const pool = await poolPromise;
      const cdCadastro = parseFloat(id);
      const seqNum = parseInt(sequencia, 10);
      if (isNaN(cdCadastro) || isNaN(seqNum)) return res.status(400).json({ error: 'Parâmetros inválidos.' });
      const del = await pool.query(
        `DELETE FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1 AND "SEQUENCIA" = $2`,
        [cdCadastro, seqNum]
      );
      if ((del.rowCount || 0) === 0) return res.status(404).json({ error: 'Registro não encontrado.' });
      res.json({ success: true, message: 'Local preferido removido.' });
    } catch (err) {
      console.error('Erro ao excluir local preferido:', err);
      res.status(500).json({ error: 'Erro ao remover local preferido.' });
    }
  }
};

module.exports = cadastroController;