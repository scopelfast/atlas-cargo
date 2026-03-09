/**
 * Script para criar motorista no sistema
 * 
 * Uso:
 *   node backend/scripts/criar_motorista.js <CPF> <NOME> <CELULAR> [EMAIL] [CIDADE_ID]
 * 
 * Exemplo:
 *   node backend/scripts/criar_motorista.js 02100610066 "João Silva" 41999999999 joao@email.com 1
 */

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

async function criarMotorista(cpf, nome, celular, email = null, cidadeId = null) {
  try {
    // Limpar CPF
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    if (cpfLimpo.length !== 11) {
      console.error('❌ CPF inválido! Deve ter 11 dígitos.');
      process.exit(1);
    }

    if (!nome || nome.trim().length === 0) {
      console.error('❌ Nome é obrigatório!');
      process.exit(1);
    }

    if (!celular || celular.replace(/\D/g, '').length < 10) {
      console.error('❌ Celular inválido!');
      process.exit(1);
    }

    console.log('📡 Conectando ao banco de dados...');
    const pool = await poolPromise;

    // Verificar se já existe
    console.log(`🔍 Verificando se motorista já existe com CPF: ${cpfLimpo}...`);
    const existe = await pool
      .request()
      .input('cpf', sql.VarChar(14), cpfLimpo)
      .query(`
        SELECT CDCADASTRO, RZSOCIAL, FGTIPOCADASTRO, FGACTIVE
        FROM [dbo].[CADASTROGERAL]
        WHERE CGCCPF = @cpf
      `);

    if (existe.recordset.length > 0) {
      const cadastro = existe.recordset[0];
      console.log('');
      console.log('⚠️  Já existe um cadastro com este CPF!');
      console.log(`   ID: ${cadastro.CDCADASTRO}`);
      console.log(`   Nome: ${cadastro.RZSOCIAL}`);
      console.log(`   Tipo: ${cadastro.FGTIPOCADASTRO || 'NULL'}`);
      console.log(`   Status: ${cadastro.FGACTIVE || 'NULL'}`);
      console.log('');
      console.log('💡 Use o script corrigir_motorista.js para corrigir:');
      console.log(`   node backend/scripts/corrigir_motorista.js ${cpfLimpo}`);
      console.log('');
      process.exit(1);
    }

    // Limpar celular
    const celularLimpo = celular.replace(/\D/g, '');

    console.log('');
    console.log('📝 Dados do motorista:');
    console.log(`   CPF: ${cpfLimpo}`);
    console.log(`   Nome: ${nome}`);
    console.log(`   Celular: ${celularLimpo}`);
    console.log(`   Email: ${email || 'Não informado'}`);
    console.log(`   Cidade ID: ${cidadeId || 'Não informado'}`);
    console.log('');

    // Criar transação
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Inserir em CADASTROGERAL
      console.log('💾 Criando cadastro em CADASTROGERAL...');
      const request = new sql.Request(transaction);
      
      request.input('cpf', sql.VarChar(14), cpfLimpo);
      request.input('nome', sql.VarChar(100), nome.trim());
      request.input('celular', sql.Decimal(15, 0), celularLimpo);
      request.input('email', sql.VarChar(100), email ? email.trim() : null);
      request.input('cidade', sql.Int, cidadeId ? parseInt(cidadeId) : null);
      request.input('tipoPessoa', sql.Char(1), 'F'); // Física

      const result = await request.query(`
        INSERT INTO [dbo].[CADASTROGERAL] (
          CGCCPF,
          RZSOCIAL,
          FGFISICAJURIDICA,
          NRCELULAR,
          ENDEMAIL,
          CDCIDADE,
          FGTIPOCADASTRO,
          FGACTIVE,
          DHCADASTRO
        )
        OUTPUT INSERTED.CDCADASTRO
        VALUES (
          @cpf,
          @nome,
          @tipoPessoa,
          @celular,
          @email,
          @cidade,
          'M',  -- Motorista
          'A',  -- Ativo
          GETDATE()
        )
      `);

      const cdcadastro = result.recordset[0].CDCADASTRO;
      console.log(`✅ Cadastro criado! ID: ${cdcadastro}`);

      // Criar registro em MOTORISTA_COMPLEMENTO
      console.log('💾 Criando registro em MOTORISTA_COMPLEMENTO...');
      const request2 = new sql.Request(transaction);
      request2.input('cdcadastro', sql.Decimal(15, 0), parseFloat(cdcadastro));

      await request2.query(`
        INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
          CDCADASTRO,
          STATUSAPROVACAO,
          DHCADASTRO
        )
        VALUES (
          @cdcadastro,
          'A',  -- Aprovado
          GETDATE()
        )
      `);

      console.log('✅ Registro em MOTORISTA_COMPLEMENTO criado!');

      // Commit
      await transaction.commit();

      console.log('');
      console.log('✅ Motorista criado com sucesso!');
      console.log('');
      console.log('📋 Informações:');
      console.log(`   ID: ${cdcadastro}`);
      console.log(`   Nome: ${nome}`);
      console.log(`   CPF: ${cpfLimpo}`);
      console.log(`   Celular: ${celularLimpo}`);
      console.log('');
      console.log('🔐 Próximos passos:');
      console.log('   1. O motorista pode fazer login agora (qualquer senha se não tiver senha definida)');
      console.log('   2. Para definir senha permanente:');
      console.log(`      node backend/scripts/definir_senha_motorista.js ${cpfLimpo} senha123`);
      console.log('');

      process.exit(0);
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('❌ Erro ao criar motorista:', err.message);
    if (err.number === 2627) {
      console.error('   Erro: CPF já existe no banco!');
    }
    process.exit(1);
  }
}

// Verificar argumentos
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('');
  console.log('📖 Uso: node criar_motorista.js <CPF> <NOME> <CELULAR> [EMAIL] [CIDADE_ID]');
  console.log('');
  console.log('Exemplo:');
  console.log('  node criar_motorista.js 02100610066 "João Silva" 41999999999 joao@email.com 1');
  console.log('');
  console.log('Parâmetros obrigatórios:');
  console.log('  CPF      - CPF do motorista (com ou sem formatação)');
  console.log('  NOME     - Nome completo do motorista');
  console.log('  CELULAR  - Celular do motorista (com ou sem formatação)');
  console.log('');
  console.log('Parâmetros opcionais:');
  console.log('  EMAIL    - Email do motorista');
  console.log('  CIDADE_ID - ID da cidade (consulte tabela CIDADE)');
  console.log('');
  process.exit(1);
}

const [cpf, nome, celular, email, cidadeId] = args;
criarMotorista(cpf, nome, celular, email, cidadeId);

