# Stored Procedures: Sincronização de Viagens

## 📋 Descrição

Este conjunto de stored procedures foi criado para otimizar a sincronização de dados do módulo "Gerenciar Viagens", executando toda a lógica diretamente no SQL Server, evitando timeouts e melhorando significativamente a performance.

### Procedures Disponíveis:

1. **`sp_sincronizar_viagens_completo`**: Procedure principal que executa toda a sincronização
2. **`sp_integracao_transportador`**: Procedure dedicada para sincronização de transportadores (Tipo T)

## 🚀 Instalação

### Passo 1: Executar os Scripts de Criação

Execute os seguintes arquivos no **SQL Server Management Studio (SSMS)** ou em qualquer cliente SQL conectado ao banco `ATLAS_CARGO_PRD`:

1. `backend/scripts/sp_sincronizar_viagens_completo.sql` - **OBRIGATÓRIO**
2. `backend/scripts/sp_integracao_transportador.sql` - **RECOMENDADO** (melhora performance de transportadores)

**IMPORTANTE:** Execute cada script **apenas uma vez**. As procedures serão criadas e ficarão disponíveis permanentemente no banco de dados.

### Passo 2: Verificar a Instalação

Após executar os scripts, verifique se as procedures foram criadas:

```sql
-- Verificar procedure principal
SELECT * FROM sys.objects 
WHERE object_id = OBJECT_ID(N'[dbo].[sp_sincronizar_viagens_completo]') 
AND type in (N'P', N'PC');

-- Verificar procedure de transportadores
SELECT * FROM sys.objects 
WHERE object_id = OBJECT_ID(N'[dbo].[sp_integracao_transportador]') 
AND type in (N'P', N'PC');
```

Se retornarem registros, as procedures foram criadas com sucesso! ✅

## 📝 Como Funciona

1. O arquivo `init.sql` do módulo "Gerenciar Viagens" executa: `EXEC [dbo].[sp_sincronizar_viagens_completo];`
2. A procedure principal (`sp_sincronizar_viagens_completo`) executa toda a sincronização:
   - Se `sp_integracao_transportador` existir, usa ela para sincronizar transportadores (melhor performance)
   - Caso contrário, usa a lógica inline (fallback)
3. Tudo é executado em uma única transação, garantindo:
   - **Performance otimizada** (execução direta no SQL Server)
   - **Sem timeouts** (não há overhead de comunicação Node.js ↔ SQL Server)
   - **Transação atômica** (tudo ou nada)
   - **Tratamento de erros** robusto

## ⚡ Benefícios

- ✅ **Performance**: Execução instantânea (como quando você roda direto no SQL)
- ✅ **Sem Timeouts**: Não há limite de 5-10 minutos de comunicação
- ✅ **Confiabilidade**: Transação única garante consistência dos dados
- ✅ **Manutenibilidade**: Toda a lógica centralizada em um único lugar

## 🔄 Atualização

Se precisar atualizar as procedures:

1. Execute o(s) script(s) novamente (`sp_sincronizar_viagens_completo.sql` e/ou `sp_integracao_transportador.sql`)
2. Os scripts automaticamente removem as procedures antigas e criam novas
3. Não é necessário reiniciar o servidor Node.js

## ❓ Troubleshooting

### Erro: "Could not find stored procedure"

**Solução:** Execute o script `sp_sincronizar_viagens_completo.sql` no SQL Server Management Studio.

### Erro: "Invalid object name"

**Solução:** Verifique se está conectado ao banco correto (`ATLAS_CARGO_PRD`).

### A procedure ainda está lenta

**Solução:** Verifique os índices das tabelas envolvidas. A procedure pode se beneficiar de índices nas colunas de JOIN.

