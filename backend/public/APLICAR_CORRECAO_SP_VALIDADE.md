# 🔧 Aplicar Correção da Stored Procedure SP_INTGRACAO_VALIDADE

## Problema
A stored procedure `SP_INTGRACAO_VALIDADE` está causando erro de chave primária duplicada:
```
Violation of PRIMARY KEY constraint 'PK_CONTROLEVALIDADE'. 
Cannot insert duplicate key in object 'dbo.CONTROLEVALIDADE'. 
The duplicate key value is (EQP, 11243, 1).
```

## Solução

### Opção 1: Via API (Recomendado)
Execute no console do navegador (F12) quando estiver logado no sistema:

```javascript
fetch('/api/cadastros-gerais/aplicar-correcao-sp-validade', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('token')
  }
})
.then(res => res.json())
.then(data => {
  console.log('✅ Resultado:', data);
  if (data.success) {
    alert('✅ Correção aplicada com sucesso!');
  } else {
    alert('❌ Erro: ' + (data.error || 'Erro desconhecido'));
  }
})
.catch(err => {
  console.error('❌ Erro:', err);
  alert('❌ Erro ao aplicar correção: ' + err.message);
});
```

### Opção 2: Via SQL Server Management Studio
Execute o script SQL diretamente no banco de dados:

1. Abra o SQL Server Management Studio
2. Conecte-se ao banco `ATLAS_CARGO_PRD`
3. Abra e execute o arquivo: `backend/scripts/corrigir_sp_integracao_validade.sql`

## O que a correção faz:
- ✅ Remove `CDTIPOVALIDADE` da condição MERGE (não faz parte da chave primária)
- ✅ Adiciona `ROW_NUMBER` para lidar com múltiplos registros com mesma PK
- ✅ Usa apenas as colunas da chave primária: `(TPCADASTRO, CDCADASTRO, SEQUENCIA)`
- ✅ Filtra apenas registros com `CDTIPOVALIDADE` válido

## Após aplicar a correção:
Recarregue a página do módulo "Gerenciar Cadastro Geral" e o erro não deve mais aparecer.
