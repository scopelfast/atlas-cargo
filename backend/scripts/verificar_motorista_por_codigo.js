/**
 * Script para verificar motorista por código ou CPF
 * 
 * Uso:
 *   node backend/scripts/verificar_motorista_por_codigo.js <CODIGO_OU_CPF>
 * 
 * Exemplo:
 *   node backend/scripts/verificar_motorista_por_codigo.js 9436
 *   node backend/scripts/verificar_motorista_por_codigo.js 2100610066
 */

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

async function verificarMotorista(codigoOuCpf) {
  try {
    console.log('📡 Conectando ao banco de dados...');
    const pool = await poolPromise;

    // Verificar se é número (código) ou string (CPF)
    const isCodigo = /^\d+$/.test(codigoOuCpf) && codigoOuCpf.length <= 15;
    
    let result;
    
    if (isCodigo) {
      // Buscar por código
      console.log(`🔍 Buscando motorista com código: ${codigoOuCpf}...`);
      result = await pool
        .request()
        .input('codigo', sql.Decimal(15, 0), parseFloat(codigoOuCpf))
        .query(`
          SELECT 
            cg.CDCADASTRO,
            cg.RZSOCIAL,
            cg.CGCCPF,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.FGTIPOCADASTRO,
            cg.FGACTIVE,
            c.NMCIDADE,
            c.ESTADO,
            mc.STATUSAPROVACAO,
            mc.SENHA
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
          WHERE cg.CDCADASTRO = @codigo
        `);
    } else {
      // Buscar por CPF (tentar com e sem zeros à esquerda)
      const cpfLimpo = codigoOuCpf.replace(/\D/g, '');
      console.log(`🔍 Buscando motorista com CPF: ${cpfLimpo}...`);
      
      // Tentar com zeros à esquerda se necessário
      const cpfComZeros = cpfLimpo.padStart(11, '0');
      
      result = await pool
        .request()
        .input('cpf1', sql.VarChar(14), cpfLimpo)
        .input('cpf2', sql.VarChar(14), cpfComZeros)
        .query(`
          SELECT 
            cg.CDCADASTRO,
            cg.RZSOCIAL,
            cg.CGCCPF,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.FGTIPOCADASTRO,
            cg.FGACTIVE,
            c.NMCIDADE,
            c.ESTADO,
            mc.STATUSAPROVACAO,
            mc.SENHA
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
          WHERE cg.CGCCPF = @cpf1 OR cg.CGCCPF = @cpf2
        `);
    }

    if (result.recordset.length === 0) {
      console.log('');
      console.log('❌ Motorista NÃO encontrado!');
      console.log('');
      console.log('💡 Tente:');
      console.log('   1. Verificar se o código/CPF está correto');
      console.log('   2. Buscar por nome no sistema web');
      console.log('   3. Criar o motorista se não existir');
      console.log('');
      process.exit(1);
    }

    const motorista = result.recordset[0];
    
    console.log('');
    console.log('✅ Motorista encontrado!');
    console.log('');
    console.log('📋 Dados do Motorista:');
    console.log(`   Código: ${motorista.CDCADASTRO}`);
    console.log(`   Nome: ${motorista.RZSOCIAL}`);
    console.log(`   CPF: ${motorista.CGCCPF}`);
    console.log(`   Celular: ${motorista.NRCELULAR || 'Não informado'}`);
    console.log(`   Email: ${motorista.ENDEMAIL || 'Não informado'}`);
    console.log(`   Cidade: ${motorista.NMCIDADE || 'Não informado'} - ${motorista.ESTADO || ''}`);
    console.log('');
    
    // Verificar tipo
    console.log('🔍 Status do Cadastro:');
    if (motorista.FGTIPOCADASTRO === 'M') {
      console.log('   ✅ Tipo: Motorista (M)');
    } else {
      console.log(`   ⚠️  Tipo: ${motorista.FGTIPOCADASTRO || 'NULL'} (deveria ser M)`);
    }
    
    if (motorista.FGACTIVE === 'A') {
      console.log('   ✅ Status: Ativo (A)');
    } else {
      console.log(`   ⚠️  Status: ${motorista.FGACTIVE || 'NULL'} (deveria ser A)`);
    }
    
    if (motorista.STATUSAPROVACAO === 'A') {
      console.log('   ✅ Aprovação: Aprovado (A)');
    } else if (motorista.STATUSAPROVACAO === 'P') {
      console.log('   ⏳ Aprovação: Pendente (P)');
    } else if (motorista.STATUSAPROVACAO === 'R') {
      console.log('   ❌ Aprovação: Rejeitado (R)');
    } else {
      console.log('   ⚠️  Aprovação: Sem registro em MOTORISTA_COMPLEMENTO');
    }
    
    if (motorista.SENHA) {
      console.log('   ✅ Senha: Definida (bcrypt)');
    } else {
      console.log('   ⚠️  Senha: Não definida (aceita qualquer senha)');
    }
    
    console.log('');
    console.log('🚀 Como Acessar:');
    console.log('');
    console.log('   1. URL: http://localhost:3000/motorista/');
    console.log('   2. CPF: ' + motorista.CGCCPF);
    if (motorista.SENHA) {
      console.log('   3. Senha: (use a senha definida)');
      console.log('      💡 Para redefinir: node backend/scripts/definir_senha_motorista.js ' + motorista.CGCCPF + ' novaSenha');
    } else {
      console.log('   3. Senha: Qualquer senha (ex: 123456)');
      console.log('      💡 Para definir senha: node backend/scripts/definir_senha_motorista.js ' + motorista.CGCCPF + ' senha123');
    }
    console.log('');
    
    // Verificar se precisa corrigir
    const precisaCorrigir = 
      motorista.FGTIPOCADASTRO !== 'M' || 
      motorista.FGACTIVE !== 'A' || 
      !motorista.STATUSAPROVACAO;
    
    if (precisaCorrigir) {
      console.log('⚠️  ATENÇÃO: Motorista precisa ser corrigido!');
      console.log('');
      console.log('💡 Execute para corrigir:');
      console.log(`   node backend/scripts/corrigir_motorista.js ${motorista.CGCCPF}`);
      console.log('');
    } else {
      console.log('✅ Motorista está configurado corretamente!');
      console.log('   Pode fazer login normalmente.');
      console.log('');
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
}

// Verificar argumentos
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('');
  console.log('📖 Uso: node verificar_motorista_por_codigo.js <CODIGO_OU_CPF>');
  console.log('');
  console.log('Exemplo:');
  console.log('  node verificar_motorista_por_codigo.js 9436');
  console.log('  node verificar_motorista_por_codigo.js 2100610066');
  console.log('');
  process.exit(1);
}

const codigoOuCpf = args[0];
verificarMotorista(codigoOuCpf);

