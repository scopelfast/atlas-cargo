/**
 * Script para inserir posições GPS reais da viagem 82930
 * 
 * Uso:
 *   node backend/scripts/inserir_posicoes_viagem_82930.js
 */

const sql = require('mssql');
const { poolPromise } = require('../config/db');

// Dados fornecidos pelo usuário
const dadosRastreamento = [
  { seq: 39, lat: -25.5929, lng: -49.31189, data: '2025-12-15 10:23:31.420' },
  { seq: 38, lat: -25.5929, lng: -49.31189, data: '2025-12-15 11:10:00.000' },
  { seq: 37, lat: -25.59293, lng: -49.31182, data: '2025-12-14 19:33:31.940' },
  { seq: 36, lat: -25.59306, lng: -49.31189, data: '2025-12-14 18:40:00.000' },
  { seq: 35, lat: -25.59295, lng: -49.31177, data: '2025-12-14 18:23:28.273' },
  { seq: 34, lat: -25.59295, lng: -49.31177, data: '2025-12-14 17:50:00.000' },
  { seq: 33, lat: -25.59307, lng: -49.31179, data: '2025-12-14 17:33:28.210' },
  { seq: 32, lat: -25.59307, lng: -49.31179, data: '2025-12-14 16:40:00.000' },
  { seq: 31, lat: -25.59307, lng: -49.31179, data: '2025-12-14 17:00:00.000' },
  { seq: 30, lat: -25.59297, lng: -49.31186, data: '2025-12-14 15:50:00.000' },
  { seq: 29, lat: -25.59297, lng: -49.31186, data: '2025-12-14 16:10:00.000' },
  { seq: 28, lat: -25.59291, lng: -49.3117, data: '2025-12-14 15:20:00.000' },
  { seq: 27, lat: -25.59298, lng: -49.31178, data: '2025-12-14 15:03:27.820' },
  { seq: 26, lat: -25.59298, lng: -49.31178, data: '2025-12-14 14:50:00.000' },
  { seq: 25, lat: -25.59313, lng: -49.31184, data: '2025-12-14 14:33:27.930' },
  { seq: 24, lat: -25.59303, lng: -49.31184, data: '2025-12-14 14:00:00.000' },
  { seq: 23, lat: -25.59303, lng: -49.31184, data: '2025-12-14 13:43:27.537' },
  { seq: 22, lat: -25.59303, lng: -49.31184, data: '2025-12-14 13:10:00.000' },
  { seq: 21, lat: -25.59303, lng: -49.31184, data: '2025-12-14 12:40:00.000' },
  { seq: 20, lat: -25.59303, lng: -49.31184, data: '2025-12-14 12:00:00.000' },
  { seq: 19, lat: -25.59303, lng: -49.31184, data: '2025-12-14 12:20:00.000' },
  { seq: 18, lat: -25.59303, lng: -49.31184, data: '2025-12-14 11:13:29.980' },
  { seq: 17, lat: -25.59303, lng: -49.31184, data: '2025-12-14 11:00:00.000' },
  { seq: 16, lat: -25.59303, lng: -49.31184, data: '2025-12-14 11:30:00.000' },
  { seq: 15, lat: -25.59303, lng: -49.31184, data: '2025-12-14 10:30:00.000' },
  { seq: 14, lat: -25.59303, lng: -49.31184, data: '2025-12-14 10:40:00.000' },
  { seq: 13, lat: -25.59303, lng: -49.31184, data: '2025-12-14 10:07:21.820' },
  { seq: 12, lat: -25.59303, lng: -49.31184, data: '2025-12-14 10:10:00.000' },
  { seq: 11, lat: -25.59303, lng: -49.31184, data: '2025-12-14 09:40:00.000' },
  { seq: 10, lat: -25.59303, lng: -49.31184, data: '2025-12-14 09:20:00.000' },
  { seq: 9, lat: -25.59303, lng: -49.31184, data: '2025-12-14 08:50:00.000' },
  { seq: 8, lat: -25.59303, lng: -49.31184, data: '2025-12-14 09:00:00.000' },
  { seq: 7, lat: -25.59303, lng: -49.31184, data: '2025-12-14 08:30:00.000' },
  { seq: 6, lat: -25.59303, lng: -49.31184, data: '2025-12-14 08:10:00.000' },
  { seq: 5, lat: -25.59303, lng: -49.31184, data: '2025-12-14 07:40:00.000' },
  { seq: 4, lat: -25.59303, lng: -49.31184, data: '2025-12-14 07:33:27.277' },
  { seq: 3, lat: -25.59303, lng: -49.31184, data: '2025-12-14 07:23:27.250' },
  { seq: 2, lat: -25.59303, lng: -49.31184, data: '2025-12-14 07:13:27.427' },
  { seq: 1, lat: -25.59303, lng: -49.31184, data: '2025-12-14 07:50:00.000' }
];

async function inserirPosicoesViagem82930() {
  try {
    console.log('📡 Conectando ao banco de dados...');
    const pool = await poolPromise;

    const idViagem = 82930;

    // Buscar motorista da viagem
    console.log(`🔍 Buscando motorista da viagem ${idViagem}...`);
    const motoristaResult = await pool
      .request()
      .input('idviagem', sql.Decimal(15, 0), parseFloat(idViagem))
      .query(`
        SELECT TOP 1 CDMOTORISTA
        FROM [dbo].[VIAGEMMOTORISTA]
        WHERE IDVIAGEM = @idviagem
      `);

    if (motoristaResult.recordset.length === 0) {
      console.error('❌ Nenhum motorista encontrado para esta viagem!');
      console.log('');
      console.log('💡 Adicione um motorista na aba "Motorista" primeiro.');
      process.exit(1);
    }

    const cdMotorista = motoristaResult.recordset[0].CDMOTORISTA;
    console.log(`✅ Motorista encontrado: ${cdMotorista}`);

    // Verificar se a tabela existe
    const tableCheck = await pool
      .request()
      .query(`
        SELECT COUNT(*) as existe
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO'
      `);

    if (tableCheck.recordset[0].existe === 0) {
      console.error('❌ Tabela VIAGEM_RASTREAMENTO não existe!');
      console.log('');
      console.log('💡 Execute primeiro: backend/scripts/criar_tabela_rastreamento.sql');
      process.exit(1);
    }

    console.log('');
    console.log('📍 Inserindo posições de rastreamento...');
    console.log(`   Viagem: ${idViagem}`);
    console.log(`   Motorista: ${cdMotorista}`);
    console.log(`   Total de posições: ${dadosRastreamento.length}`);
    console.log('');

    // Ordenar por data (mais antiga primeiro)
    const posicoesOrdenadas = [...dadosRastreamento].sort((a, b) => {
      return new Date(a.data) - new Date(b.data);
    });

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let inseridos = 0;
      let duplicados = 0;
      
      for (const pos of posicoesOrdenadas) {
        const request = new sql.Request(transaction);
        const dataHora = new Date(pos.data);

        // Verificar se já existe (evitar duplicatas)
        const checkResult = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .input('latitude', sql.Decimal(10, 8), pos.lat)
          .input('longitude', sql.Decimal(11, 8), pos.lng)
          .input('dhregistro', sql.DateTime, dataHora)
          .query(`
            SELECT COUNT(*) as existe
            FROM [dbo].[VIAGEM_RASTREAMENTO]
            WHERE IDVIAGEM = @idviagem
              AND ABS(LATITUDE - @latitude) < 0.0001
              AND ABS(LONGITUDE - @longitude) < 0.0001
              AND ABS(DATEDIFF(SECOND, DHREGISTRO, @dhregistro)) < 60
          `);

        if (checkResult.recordset[0].existe > 0) {
          duplicados++;
          console.log(`   ⚠️  Posição ${pos.seq} já existe (duplicada), pulando...`);
          continue;
        }

        request.input('idviagem', sql.Decimal(15, 0), parseFloat(idViagem));
        request.input('cdcadastro', sql.Decimal(15, 0), parseFloat(cdMotorista));
        request.input('latitude', sql.Decimal(10, 8), pos.lat);
        request.input('longitude', sql.Decimal(11, 8), pos.lng);
        request.input('velocidade', sql.Decimal(5, 2), null);
        request.input('precisao', sql.Int, 10);
        request.input('dhregistro', sql.DateTime, dataHora);
        request.input('tipo', sql.Char(1), 'A');
        request.input('fonte', sql.VarChar(20), 'RASTER');

        await request.query(`
          INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
            IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, 
            VELOCIDADE, PRECISAO, DHREGISTRO, TIPO, FONTE
          )
          VALUES (
            @idviagem, @cdcadastro, @latitude, @longitude,
            @velocidade, @precisao, @dhregistro, @tipo, @fonte
          )
        `);

        inseridos++;
        console.log(`   ✅ Posição ${pos.seq}/${dadosRastreamento.length} inserida: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (${dataHora.toLocaleString('pt-BR')})`);
      }

      await transaction.commit();

      console.log('');
      console.log('✅ Posições inseridas com sucesso!');
      console.log(`   Total inseridas: ${inseridos}`);
      if (duplicados > 0) {
        console.log(`   Duplicadas ignoradas: ${duplicados}`);
      }
      console.log('');
      console.log('📋 Próximos passos:');
      console.log('   1. Acesse a aba "📍 Rastreamento" no sistema');
      console.log(`   2. Selecione a viagem ${idViagem}`);
      console.log('   3. Visualize o traçado da rota no mapa');
      console.log('');

      process.exit(0);
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('❌ Erro ao inserir posições:', err.message);
    if (err.number === 547) {
      console.error('   Erro: Violação de chave estrangeira. Verifique se a viagem e motorista existem.');
    }
    console.error('   Detalhes:', err);
    process.exit(1);
  }
}

// Executar
inserirPosicoesViagem82930();

