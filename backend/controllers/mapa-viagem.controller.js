// backend/controllers/mapa-viagem.controller.js
const { poolPromise } = require('../config/db');
const fs = require('fs').promises;
const path = require('path');

const mapaViagemController = {
  // Listar veículos para o mapa (última posição de cada placa)
  listarVeiculos: async (req, res) => {
    try {
      const {
        idViagem, situacaoViagem, tipoViagem, classeFrota, contratador,
        origemEstado, origemCidade, destinoEstado, destinoCidade,
        roteiro, dataInicio, dataFim, rastreado, motoristaConfirmado
      } = req.query;

      const pool = await poolPromise;

      // Query otimizada: pegar apenas a última posição de cada VIAGEM
      // Usando ROW_NUMBER para pegar apenas o registro mais recente por viagem
      let query = `
        WITH UltimaPosicao AS (
          SELECT 
            RV.IDVIAGEM AS VIAGEM,
            RV.LATITUDE,
            RV.LONGITUDE,
            RV.DSPOSICAO,
            RV.DHPOSICAO,
            NM.RZSOCIAL AS NMMOTORISTA,
            E.REFEQUIPAMENTO AS PLACA,
            R.DSROTEIRO,
            co.ESTADO AS ORIGEM_ESTADO,
            co.NMCIDADE AS ORIGEM_CIDADE,
            co.CDUF AS ORIGEM_CDUF,
            cd.ESTADO AS DESTINO_ESTADO,
            cd.NMCIDADE AS DESTINO_CIDADE,
            cd.CDUF AS DESTINO_CDUF,
            ROW_NUMBER() OVER (
              PARTITION BY RV.IDVIAGEM 
              ORDER BY RV.SEQUENCIA DESC, RV.DHPOSICAO DESC
            ) AS RN
          FROM VIAGEMRASTREAMENTO RV
          INNER JOIN VIAGEMMESTRE VM ON RV.IDVIAGEM = VM.IDVIAGEM
          LEFT JOIN ROTEIRO R ON VM.IDROTEIRO = R.IDROTEIRO
          LEFT JOIN CIDADE co ON R.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN CIDADE cd ON R.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN VIAGEMMOTORISTA M ON RV.IDVIAGEM = M.IDVIAGEM
          LEFT JOIN CADASTROGERAL NM ON M.CDMOTORISTA = NM.CDCADASTRO
          LEFT JOIN VIAGEMVEICULO V ON RV.IDVIAGEM = V.IDVIAGEM
          LEFT JOIN EQUIPAMENTO E ON V.IDEQUIPAMENTO = E.IDEQUIPAMENTO
          WHERE VM.CDSITUACAOVIAGEM > 1 
            AND VM.CDSITUACAOVIAGEM < 14
            AND RV.LATITUDE IS NOT NULL 
            AND RV.LONGITUDE IS NOT NULL
      `;

      const request = pool.request();

      // Aplicar filtros
      if (idViagem) {
        query += ` AND VM.IDVIAGEM = @IDVIAGEM`;
        request.input('IDVIAGEM', parseInt(idViagem));
      }
      if (situacaoViagem) {
        query += ` AND VM.FGSITVIAGEM = @SITUACAOVIAGEM`;
        request.input('SITUACAOVIAGEM', situacaoViagem);
      }
      if (tipoViagem) {
        query += ` AND VM.CDTIPOVIAGEM = @TIPOVIAGEM`;
        request.input('TIPOVIAGEM', parseInt(tipoViagem));
      }
      if (classeFrota) {
        query += ` AND VM.CDCLASSEFROTA = @CLASSEFROTA`;
        request.input('CLASSEFROTA', parseInt(classeFrota));
      }
      if (contratador) {
        query += ` AND VM.CDCONTRATADOR = @CONTRATADOR`;
        request.input('CONTRATADOR', parseInt(contratador));
      }
      if (roteiro) {
        query += ` AND VM.IDROTEIRO = @ROTEIRO`;
        request.input('ROTEIRO', parseInt(roteiro));
      }
      if (dataInicio) {
        query += ` AND VM.DTPREVINICIO >= @DATAINICIO`;
        request.input('DATAINICIO', dataInicio);
      }
      if (dataFim) {
        query += ` AND VM.DTPREVFINAL <= @DATAFIM`;
        request.input('DATAFIM', dataFim);
      }
      if (rastreado) {
        // Filtrar apenas veículos rastreados (FGRASTREADO = 'S')
        if (rastreado === 'S') {
          query += ` AND E.FGRASTREADO = 'S'`;
        } else if (rastreado === 'N') {
          query += ` AND (E.FGRASTREADO IS NULL OR E.FGRASTREADO = 'N')`;
        }
      }
      if (motoristaConfirmado === 'S') {
        query += ` AND EXISTS (
          SELECT 1 FROM CONVOCACAO C 
          WHERE C.IDVIAGEM = VM.IDVIAGEM 
          AND C.STATUS = 'CONFIRMADA'
        )`;
      } else if (motoristaConfirmado === 'N') {
        query += ` AND NOT EXISTS (
          SELECT 1 FROM CONVOCACAO C 
          WHERE C.IDVIAGEM = VM.IDVIAGEM 
          AND C.STATUS = 'CONFIRMADA'
        )`;
      }

      // Filtros de origem/destino (via roteiro - usando JOIN já feito)
      if (origemEstado) {
        query += ` AND co.CDUF = @ORIGEMESTADO`;
        request.input('ORIGEMESTADO', parseInt(origemEstado));
      }
      if (origemCidade) {
        query += ` AND co.NMCIDADE LIKE @ORIGEMCIDADE`;
        request.input('ORIGEMCIDADE', `%${origemCidade}%`);
      }
      if (destinoEstado) {
        query += ` AND cd.CDUF = @DESTINOESTADO`;
        request.input('DESTINOESTADO', parseInt(destinoEstado));
      }
      if (destinoCidade) {
        query += ` AND cd.NMCIDADE LIKE @DESTINOCIDADE`;
        request.input('DESTINOCIDADE', `%${destinoCidade}%`);
      }

      // Finalizar query: pegar apenas RN = 1 (última posição de cada placa)
      query += `
        )
        SELECT 
          VIAGEM,
          LATITUDE,
          LONGITUDE,
          DSPOSICAO,
          DHPOSICAO,
          NMMOTORISTA,
          PLACA,
          DSROTEIRO
        FROM UltimaPosicao
        WHERE RN = 1
        ORDER BY PLACA, DHPOSICAO DESC
      `;

      const result = await request.query(query);
      
      const veiculos = result.recordset || [];
      const total = veiculos.length;
      
      console.log(`[Mapa Viagem] Query executada. Total de veículos encontrados: ${total}`);
      if (total > 0) {
        console.log(`[Mapa Viagem] Primeiros 5 IDs de viagem:`, veiculos.slice(0, 5).map(v => v.VIAGEM));
      }

      res.json({
        veiculos: veiculos,
        total: total
      });
    } catch (err) {
      console.error('Erro ao listar veículos:', err);
      res.status(500).json({ 
        error: 'Erro interno ao listar veículos.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Executar init.sql
  executarInitSQL: async (req, res) => {
    try {
      const sqlPath = path.join(__dirname, '../public/modulos/gerenciar-mapa-viagem/sql/init.sql');
      
      let sqlContent = '';
      try {
        sqlContent = await fs.readFile(sqlPath, 'utf8');
      } catch (fileErr) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql não encontrado (não é obrigatório)',
          executed: false
        });
      }

      if (!sqlContent || !sqlContent.trim()) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql vazio',
          executed: false
        });
      }

      const pool = await poolPromise;
      const result = await pool.request().query(sqlContent);

      res.json({ 
        success: true, 
        message: 'init.sql executado com sucesso',
        executed: true
      });
    } catch (err) {
      console.error('Erro ao executar init.sql:', err);
      
      const errorMessage = err.message || '';
      const isExpectedError = 
        errorMessage.includes('duplicate key') ||
        errorMessage.includes('PRIMARY KEY') ||
        errorMessage.includes('UNIQUE constraint');

      if (isExpectedError) {
        return res.json({ 
          success: true, 
          message: 'init.sql executado (alguns erros esperados foram ignorados)',
          executed: true,
          warning: errorMessage
        });
      }

      res.status(500).json({ 
        error: 'Erro ao executar init.sql',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
};

module.exports = mapaViagemController;
