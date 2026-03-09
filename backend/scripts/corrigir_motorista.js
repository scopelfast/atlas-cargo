/**
 * Script para verificar e corrigir motorista
 * 
 * Uso:
 *   node backend/scripts/corrigir_motorista.js <CPF>
 * 
 * Exemplo:
 *   node backend/scripts/corrigir_motorista.js 02100610066
 */

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

async function verificarECorrigirMotorista(cpf) {
  try {
    // Limpar CPF
    let cpfLimpo = cpf.replace(/\D/g, '');
    
    // Se tiver 10 dígitos, adicionar zero à esquerda
    if (cpfLimpo.length === 10) {
      cpfLimpo = '0' + cpfLimpo;
    }
    
    if (cpfLimpo.length !== 11) {
      console.error('❌ CPF inválido! Deve ter 10 ou 11 dígitos.');
      process.exit(1);
    }

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
          cg.FGTIPOCADASTRO,
          cg.FGACTIVE,
          cg.NRCELULAR,
          cg.ENDEMAIL,
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] mc 
              WHERE mc.CDCADASTRO = cg.CDCADASTRO
            ) THEN 1 
            ELSE 0 
          END AS TEM_COMPLEMENTO
        FROM [dbo].[CADASTROGERAL] cg
        WHERE cg.CGCCPF = @cpf
      `);

    if (result.recordset.length === 0) {
      console.log('');
      console.log('❌ Motorista NÃO encontrado com CPF:', cpfLimpo);
      console.log('');
      console.log('📋 Para criar o motorista:');
      console.log('   1. Use o sistema web de cadastro');
      console.log('   2. Ou execute o script SQL: backend/scripts/verificar_criar_motorista.sql');
      console.log('');
      process.exit(1);
    }

    const cadastro = result.recordset[0];
    console.log('');
    console.log('✅ Motorista encontrado!');
    console.log(`   ID: ${cadastro.CDCADASTRO}`);
    console.log(`   Nome: ${cadastro.RZSOCIAL}`);
    console.log(`   CPF: ${cadastro.CGCCPF}`);
    console.log('');

    let precisaCorrigir = false;
    const correcoes = [];

    // Verificar tipo
    if (cadastro.FGTIPOCADASTRO !== 'M') {
      console.log(`⚠️  Tipo atual: ${cadastro.FGTIPOCADASTRO || 'NULL'}`);
      console.log('   ❌ Deveria ser: M (Motorista)');
      precisaCorrigir = true;
      correcoes.push('FGTIPOCADASTRO = \'M\'');
    } else {
      console.log('✅ Tipo: M (Motorista)');
    }

    // Verificar status
    if (cadastro.FGACTIVE !== 'A') {
      console.log(`⚠️  Status atual: ${cadastro.FGACTIVE || 'NULL'}`);
      console.log('   ❌ Deveria ser: A (Ativo)');
      precisaCorrigir = true;
      correcoes.push('FGACTIVE = \'A\'');
    } else {
      console.log('✅ Status: A (Ativo)');
    }

    // Verificar complemento
    if (!cadastro.TEM_COMPLEMENTO) {
      console.log('⚠️  Não tem registro em MOTORISTA_COMPLEMENTO');
      precisaCorrigir = true;
    } else {
      console.log('✅ Tem registro em MOTORISTA_COMPLEMENTO');
    }

    console.log('');

    if (!precisaCorrigir) {
      console.log('✅ Motorista está correto! Pode fazer login.');
      console.log('');
      console.log('💡 Se ainda não conseguir fazer login:');
      console.log('   1. Verifique se tem senha definida');
      console.log('   2. Defina uma senha usando:');
      console.log(`      node backend/scripts/definir_senha_motorista.js ${cpfLimpo} senha123`);
      console.log('');
      process.exit(0);
    }

    // Perguntar se quer corrigir
    console.log('🔧 Correções necessárias:');
    correcoes.forEach(c => console.log(`   - ${c}`));
    if (!cadastro.TEM_COMPLEMENTO) {
      console.log('   - Criar registro em MOTORISTA_COMPLEMENTO');
    }
    console.log('');

    // Corrigir automaticamente
    console.log('🔧 Aplicando correções...');

    // Atualizar CADASTROGERAL
    if (cadastro.FGTIPOCADASTRO !== 'M' || cadastro.FGACTIVE !== 'A') {
      await pool
        .request()
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(cadastro.CDCADASTRO))
        .query(`
          UPDATE [dbo].[CADASTROGERAL]
          SET FGTIPOCADASTRO = 'M',
              FGACTIVE = 'A',
              DHMAINTENANCE = GETDATE()
          WHERE CDCADASTRO = @cdcadastro
        `);
      console.log('✅ CADASTROGERAL atualizado!');
    }

    // Criar MOTORISTA_COMPLEMENTO se não existir
    if (!cadastro.TEM_COMPLEMENTO) {
      await pool
        .request()
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(cadastro.CDCADASTRO))
        .query(`
          INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
            CDCADASTRO,
            STATUSAPROVACAO,
            DHCADASTRO
          )
          VALUES (
            @cdcadastro,
            'A',
            GETDATE()
          )
        `);
      console.log('✅ MOTORISTA_COMPLEMENTO criado!');
    }

    console.log('');
    console.log('✅ Correções aplicadas com sucesso!');
    console.log('');
    console.log('📋 Próximos passos:');
    console.log('   1. O motorista já pode fazer login (qualquer senha se não tiver senha definida)');
    console.log('   2. Para definir senha permanente:');
    console.log(`      node backend/scripts/definir_senha_motorista.js ${cpfLimpo} senha123`);
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err);
    process.exit(1);
  }
}

// Verificar argumentos
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('');
  console.log('📖 Uso: node corrigir_motorista.js <CPF>');
  console.log('');
  console.log('Exemplo:');
  console.log('  node corrigir_motorista.js 02100610066');
  console.log('');
  process.exit(1);
}

const cpf = args[0];
verificarECorrigirMotorista(cpf);

