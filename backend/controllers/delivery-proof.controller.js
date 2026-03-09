// backend/controllers/delivery-proof.controller.js
// Controller para Comprovantes de Entrega (POD - Proof of Delivery)
// Versão: 1.0
// Data: 2026-01-16

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

const deliveryProofController = {
  /**
   * Salvar comprovante de entrega
   * POST /api/motorista/delivery-proof
   */
  salvar: async (req, res) => {
    try {
      const {
        idviagem,
        photoData,
        photoName,
        signatureData,
        receiverName,
        receiverDocument,
        observations,
        latitude,
        longitude
      } = req.body;

      const { idmotorista } = req.user || req.body; // Via token JWT ou body (dev)

      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      if (!photoData && !signatureData) {
        return res.status(400).json({ error: 'É necessário pelo menos foto ou assinatura' });
      }

      const pool = await poolPromise;

      // Converter foto base64 para Buffer (se for string)
      let photoBuffer = null;
      if (photoData) {
        if (typeof photoData === 'string') {
          // Se for base64, remover data:image/...;base64, se existir
          const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
          photoBuffer = Buffer.from(base64Data, 'base64');
        } else {
          photoBuffer = photoData;
        }
      }

      // Inserir comprovante
      const lat = latitude != null && latitude !== '' ? parseFloat(latitude) : null;
      const lng = longitude != null && longitude !== '' ? parseFloat(longitude) : null;
      // PROOF_LOCATION em literal (evita parâmetros $11/$12 que o PostgreSQL não infere) – lat/lng já validados
      const proofLocationSql = (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng))
        ? `ST_SetSRID(ST_MakePoint(${Number(lng)}, ${Number(lat)}), 4326)::geography`
        : 'NULL';

      await pool.request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('cdmotorista', sql.Decimal(15, 0), idmotorista ? parseFloat(idmotorista) : null)
        .input('photoData', sql.VarBinary(sql.MAX), photoBuffer)
        .input('photoName', sql.NVarChar(255), photoName || null)
        .input('signatureData', sql.NVarChar(sql.MAX), signatureData || null)
        .input('receiverName', sql.NVarChar(255), receiverName || null)
        .input('receiverDocument', sql.NVarChar(50), receiverDocument || null)
        .input('observations', sql.NVarChar(500), observations || null)
        .input('latitude', sql.Decimal(10, 8), lat)
        .input('longitude', sql.Decimal(11, 8), lng)
        .query(`
          INSERT INTO [dbo].[DELIVERY_PROOFS] (
            [IDVIAGEM], [CDMOTORISTA], [PHOTO_DATA], [PHOTO_NAME], [SIGNATURE_DATA],
            [RECEIVER_NAME], [RECEIVER_DOCUMENT], [OBSERVATIONS],
            [LATITUDE], [LONGITUDE], [PROOF_LOCATION], [SYNCED], [CREATED_BY]
          )
          VALUES (
            @idviagem, @cdmotorista, @photoData, @photoName, @signatureData,
            @receiverName, @receiverDocument, @observations,
            @latitude, @longitude,
            ${proofLocationSql},
            true,
            'APP'
          );
        `);

      res.json({ 
        success: true, 
        message: 'Comprovante de entrega salvo com sucesso!' 
      });
    } catch (err) {
      console.error('Erro ao salvar comprovante de entrega:', err);
      res.status(500).json({ error: 'Erro ao salvar comprovante de entrega.' });
    }
  },

  /**
   * Buscar comprovantes de uma viagem
   * GET /api/motorista/delivery-proof/viagem/:idviagem
   */
  buscarPorViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;

      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idviagem)
        .query(`
          SELECT 
            [ID],
            [IDVIAGEM],
            [CDMOTORISTA],
            [PHOTO_NAME],
            [SIGNATURE_DATA],
            [RECEIVER_NAME],
            [RECEIVER_DOCUMENT],
            [OBSERVATIONS],
            [LATITUDE],
            [LONGITUDE],
            [RECORDED_AT],
            [SYNCED],
            [CREATED_BY]
          FROM [dbo].[DELIVERY_PROOFS]
          WHERE [IDVIAGEM] = @idviagem
          ORDER BY [RECORDED_AT] DESC
        `);

      // Converter foto binária para base64 (se necessário)
      const comprovantes = result.recordset.map(c => ({
        ...c,
        PHOTO_DATA: null // Não enviar binário no JSON (muito grande)
      }));

      res.json({
        success: true,
        comprovantes: comprovantes,
        total: comprovantes.length
      });
    } catch (err) {
      console.error('Erro ao buscar comprovantes:', err);
      res.status(500).json({ error: 'Erro ao buscar comprovantes.' });
    }
  },

  /**
   * Buscar foto do comprovante (endpoint separado para não sobrecarregar)
   * GET /api/motorista/delivery-proof/:id/photo
   */
  buscarFoto: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'ID do comprovante é obrigatório' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, id)
        .query(`
          SELECT [PHOTO_DATA], [PHOTO_NAME]
          FROM [dbo].[DELIVERY_PROOFS]
          WHERE [ID] = @id
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Comprovante não encontrado' });
      }

      const comprovante = result.recordset[0];

      if (!comprovante.PHOTO_DATA) {
        return res.status(404).json({ error: 'Foto não encontrada' });
      }

      const buffer = Buffer.isBuffer(comprovante.PHOTO_DATA)
        ? comprovante.PHOTO_DATA
        : Buffer.from(comprovante.PHOTO_DATA);
      const mimeType = 'image/jpeg';

      // Se o cliente pediu JSON (ex.: Accept: application/json), devolver base64
      const accept = (req.headers.accept || '').toLowerCase();
      if (accept.includes('application/json')) {
        const base64 = buffer.toString('base64');
        return res.json({
          success: true,
          photo: `data:${mimeType};base64,${base64}`,
          name: comprovante.PHOTO_NAME
        });
      }

      // Para <img src="..."> o navegador espera imagem binária
      res.type(mimeType).send(buffer);
    } catch (err) {
      console.error('Erro ao buscar foto:', err);
      res.status(500).json({ error: 'Erro ao buscar foto.' });
    }
  }
};

module.exports = deliveryProofController;
