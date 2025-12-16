/**
 * Script para definir senha de motorista
 * 
 * Uso:
 *   node backend/scripts/definir_senha_motorista.js <CPF> <SENHA>
 * 
 * Exemplo:
 *   node backend/scripts/definir_senha_motorista.js 12345678901 minhaSenha123
 */

const bcrypt = require('bcrypt');
const sql = require('mssql');
const { poolPromise } = require('../config/db');

async function definirSenhaMotorista(cpf, senha) {
  try {
    // Limpar CPF
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    if (cpfLimpo.length !== 11) {
      console.error('❌ CPF inválido!');
      process.exit(1);
    }

    if (!senha || senha.length < 6) {
      console.error('❌ Senha deve ter no mínimo 6 caracteres!');
      process.exit(1);
    }

    console.log('🔐 Gerando hash da senha...');
    const saltRounds = 10;
    const hash = await bcrypt.hash(senha, saltRounds);

    console.log('📡 Conectando ao banco de dados...');
    const pool = await poolPromise;

    // Buscar motorista
    console.log(`🔍 Buscando motorista com CPF: ${cpfLimpo}...`);
    const result = await pool
      .request()
      .input('cpf', sql.VarChar(14), cpfLimpo)
      .query(`
        SELECT 
          cg.CDCADASTRO,
          cg.RZSOCIAL,
          cg.CGCCPF,
          mc.CDCADASTRO AS TEM_COMPLEMENTO
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
        WHERE cg.CGCCPF = @cpf
          AND cg.FGTIPOCADASTRO = 'M'
          AND cg.FGACTIVE = 'A'
      `);

    if (result.recordset.length === 0) {
      console.error('❌ Motorista não encontrado ou inativo!');
      process.exit(1);
    }

    const motorista = result.recordset[0];
    console.log(`✅ Motorista encontrado: ${motorista.RZSOCIAL} (ID: ${motorista.CDCADASTRO})`);

    // Verificar se existe registro em MOTORISTA_COMPLEMENTO
    if (!motorista.TEM_COMPLEMENTO) {
      console.log('⚠️  Motorista não tem registro em MOTORISTA_COMPLEMENTO. Criando...');
      
      // Criar registro básico
      await pool
        .request()
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(motorista.CDCADASTRO))
        .input('senha', sql.VarChar(255), hash)
        .query(`
          INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (CDCADASTRO, SENHA, DHCADASTRO)
          VALUES (@cdcadastro, @senha, GETDATE())
        `);
    } else {
      // Atualizar senha existente
      console.log('🔄 Atualizando senha...');
      await pool
        .request()
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(motorista.CDCADASTRO))
        .input('senha', sql.VarChar(255), hash)
        .query(`
          UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
          SET SENHA = @senha,
              DHMAINTENANCE = GETDATE()
          WHERE CDCADASTRO = @cdcadastro
        `);
    }

    console.log('');
    console.log('✅ Senha definida com sucesso!');
    console.log('');
    console.log('📋 Informações:');
    console.log(`   Motorista: ${motorista.RZSOCIAL}`);
    console.log(`   CPF: ${motorista.CGCCPF}`);
    console.log(`   ID: ${motorista.CDCADASTRO}`);
    console.log(`   Hash: ${hash.substring(0, 20)}...`);
    console.log('');
    console.log('🔐 Agora o motorista pode fazer login com:');
    console.log(`   CPF: ${cpfLimpo}`);
    console.log(`   Senha: ${senha}`);
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error('❌ Erro ao definir senha:', err);
    process.exit(1);
  }
}

// Verificar argumentos
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('');
  console.log('📖 Uso: node definir_senha_motorista.js <CPF> <SENHA>');
  console.log('');
  console.log('Exemplo:');
  console.log('  node definir_senha_motorista.js 12345678901 minhaSenha123');
  console.log('');
  process.exit(1);
}

const [cpf, senha] = args;
definirSenhaMotorista(cpf, senha);

