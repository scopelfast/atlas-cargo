/**
 * Script para inserir posições GPS de teste
 * 
 * Uso:
 *   node backend/scripts/inserir_posicoes_teste.js <ID_VIAGEM> [CD_MOTORISTA]
 * 
 * Exemplo:
 *   node backend/scripts/inserir_posicoes_teste.js 82911 9436
 */

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

async function inserirPosicoesTeste(idViagem, cdMotorista = null) {
  try {
    console.log('📡 Conectando ao banco de dados...');
    const pool = await poolPromise;

    // Se não informou motorista, buscar da viagem
    if (!cdMotorista) {
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

      cdMotorista = motoristaResult.recordset[0].CDMOTORISTA;
      console.log(`✅ Motorista encontrado: ${cdMotorista}`);
    }

    // Verificar se a tabela existe, se não existir, criar
    const tableCheck = await pool
      .request()
      .query(`
        SELECT COUNT(*) as existe
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO'
      `);

    if (tableCheck.recordset[0].existe === 0) {
      console.log('⚠️  Tabela VIAGEM_RASTREAMENTO não existe. Criando...');
      
      try {
        // Criar tabela sem foreign keys primeiro
        await pool.request().query(`
          CREATE TABLE [dbo].[VIAGEM_RASTREAMENTO] (
            IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
            IDVIAGEM DECIMAL(15,0) NOT NULL,
            CDCADASTRO DECIMAL(15,0) NOT NULL,
            LATITUDE DECIMAL(10,8) NOT NULL,
            LONGITUDE DECIMAL(11,8) NOT NULL,
            VELOCIDADE DECIMAL(5,2),
            PRECISAO INT,
            BATERIA INT,
            DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),
            TIPO CHAR(1) DEFAULT 'A',
            FONTE VARCHAR(20) DEFAULT 'APP',
            VERSAOAPP VARCHAR(20)
          )
        `);
        
        // Adicionar foreign keys separadamente
        try {
          await pool.request().query(`
            ALTER TABLE [dbo].[VIAGEM_RASTREAMENTO]
            ADD CONSTRAINT FK_RASTREAMENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
              REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM)
          `);
        } catch (fkErr) {
          console.warn('⚠️  Não foi possível criar FK para VIAGEMMESTRE:', fkErr.message);
        }
        
        try {
          await pool.request().query(`
            ALTER TABLE [dbo].[VIAGEM_RASTREAMENTO]
            ADD CONSTRAINT FK_RASTREAMENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
              REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
          `);
        } catch (fkErr) {
          console.warn('⚠️  Não foi possível criar FK para CADASTROGERAL:', fkErr.message);
        }
        
        // Criar índices
        try {
          await pool.request().query(`
            CREATE INDEX IDX_RASTREAMENTO_VIAGEM ON [dbo].[VIAGEM_RASTREAMENTO](IDVIAGEM)
          `);
        } catch (idxErr) {
          console.warn('⚠️  Não foi possível criar índice IDX_RASTREAMENTO_VIAGEM:', idxErr.message);
        }
        
        try {
          await pool.request().query(`
            CREATE INDEX IDX_RASTREAMENTO_DATA ON [dbo].[VIAGEM_RASTREAMENTO](DHREGISTRO DESC)
          `);
        } catch (idxErr) {
          console.warn('⚠️  Não foi possível criar índice IDX_RASTREAMENTO_DATA:', idxErr.message);
        }
        
        try {
          await pool.request().query(`
            CREATE INDEX IDX_RASTREAMENTO_MOTORISTA ON [dbo].[VIAGEM_RASTREAMENTO](CDCADASTRO)
          `);
        } catch (idxErr) {
          console.warn('⚠️  Não foi possível criar índice IDX_RASTREAMENTO_MOTORISTA:', idxErr.message);
        }
        
        console.log('✅ Tabela VIAGEM_RASTREAMENTO criada com sucesso!');
      } catch (err) {
        console.error('❌ Erro ao criar tabela:', err.message);
        console.log('');
        console.log('💡 Tente executar manualmente: backend/scripts/criar_tabela_rastreamento.sql');
        process.exit(1);
      }
    }

    console.log('');
    console.log('📍 Inserindo posições de teste...');
    console.log(`   Viagem: ${idViagem}`);
    console.log(`   Motorista: ${cdMotorista}`);
    console.log('');

    // Rota real: Canoas -> Gravataí (RS) - ~26 km
    // Coordenadas reais das cidades
    const posicoes = [
      { lat: -29.917800, lng: -51.183600, vel: 0, min: -120 },   // Início (Canoas - Origem)
      { lat: -29.920000, lng: -51.170000, vel: 35, min: -115 },  // Saída de Canoas
      { lat: -29.925000, lng: -51.150000, vel: 60, min: -110 },  // BR-116 (em trânsito)
      { lat: -29.930000, lng: -51.130000, vel: 75, min: -105 },  // BR-116 (em trânsito)
      { lat: -29.935000, lng: -51.110000, vel: 80, min: -100 },  // BR-116 (em trânsito)
      { lat: -29.940000, lng: -51.090000, vel: 70, min: -95 },   // Aproximando de Gravataí
      { lat: -29.942000, lng: -51.050000, vel: 55, min: -90 },   // Entrada em Gravataí
      { lat: -29.943500, lng: -51.020000, vel: 40, min: -85 },   // Centro de Gravataí
      { lat: -29.944000, lng: -51.005000, vel: 25, min: -80 },   // Próximo ao destino
      { lat: -29.944400, lng: -50.991900, vel: 0, min: -75 }     // Fim (Gravataí - Destino)
    ];

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let inseridos = 0;
      
      for (const pos of posicoes) {
        const request = new sql.Request(transaction);
        const dataHora = new Date();
        dataHora.setMinutes(dataHora.getMinutes() + pos.min);

        request.input('idviagem', sql.Decimal(15, 0), parseFloat(idViagem));
        request.input('cdcadastro', sql.Decimal(15, 0), parseFloat(cdMotorista));
        request.input('latitude', sql.Decimal(10, 8), pos.lat);
        request.input('longitude', sql.Decimal(11, 8), pos.lng);
        request.input('velocidade', sql.Decimal(5, 2), pos.vel);
        request.input('precisao', sql.Int, 10);
        request.input('dhregistro', sql.DateTime, dataHora);
        request.input('tipo', sql.Char(1), 'A');
        request.input('fonte', sql.VarChar(20), 'TESTE');

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
        console.log(`   ✅ Posição ${inseridos}/10 inserida: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`);
      }

      await transaction.commit();

      console.log('');
      console.log('✅ Posições de teste inseridas com sucesso!');
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
    process.exit(1);
  }
}

// Verificar argumentos
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('');
  console.log('📖 Uso: node inserir_posicoes_teste.js <ID_VIAGEM> [CD_MOTORISTA]');
  console.log('');
  console.log('Exemplo:');
  console.log('  node inserir_posicoes_teste.js 82911');
  console.log('  node inserir_posicoes_teste.js 82911 9436');
  console.log('');
  console.log('Se não informar o motorista, o script buscará automaticamente na viagem.');
  console.log('');
  process.exit(1);
}

const idViagem = args[0];
const cdMotorista = args[1] || null;
inserirPosicoesTeste(idViagem, cdMotorista);

