# Checklist - Tabelas SOS e Reputação

## ✅ Tabelas Necessárias

### 1. SOS_ALERTS
**Script:** `backend/scripts/criar_tabela_sos_alerts.sql`

**Como executar:**
```sql
-- Execute no SQL Server Management Studio ou via linha de comando
-- Arquivo: backend/scripts/criar_tabela_sos_alerts.sql
```

**Verificar se existe:**
```sql
-- Execute o script de verificação
-- Arquivo: backend/scripts/verificar_tabelas_sos_reputacao.sql
```

**Se não existir:**
- Execute `criar_tabela_sos_alerts.sql`
- Verifique se há erros de foreign key
- Certifique-se de que a tabela `CADASTROGERAL` e `VIAGEMMESTRE` existem

---

### 2. DRIVER_REPUTATION
**Script:** `backend/scripts/criar_tabela_driver_reputation.sql`

**Como executar:**
```sql
-- Execute no SQL Server Management Studio ou via linha de comando
-- Arquivo: backend/scripts/criar_tabela_driver_reputation.sql
```

**Verificar se existe:**
```sql
-- Execute o script de verificação
-- Arquivo: backend/scripts/verificar_tabelas_sos_reputacao.sql
```

**Se não existir:**
- Execute `criar_tabela_driver_reputation.sql`
- Verifique se há erros de foreign key
- Certifique-se de que a tabela `CADASTROGERAL` existe

---

## 🔍 Erros Comuns

### Erro 500 ao carregar SOS
**Possíveis causas:**
1. Tabela `SOS_ALERTS` não existe
2. Foreign keys quebradas
3. Colunas faltando na tabela

**Solução:**
1. Execute `verificar_tabelas_sos_reputacao.sql` para diagnosticar
2. Execute `criar_tabela_sos_alerts.sql` se a tabela não existir
3. Verifique os logs do servidor para erro SQL específico

### Erro 500 ao recalcular reputações
**Possíveis causas:**
1. Tabela `DRIVER_REPUTATION` não existe
2. Tabela `CONVOCACAO` ou `VIAGEMMESTRE` com estrutura diferente
3. Coluna `RZSOCIAL` não existe em `CADASTROGERAL` (deveria ser `RZSOCIAL`, não `RZSOCAL`)

**Solução:**
1. Execute `verificar_tabelas_sos_reputacao.sql` para diagnosticar
2. Execute `criar_tabela_driver_reputation.sql` se a tabela não existir
3. Verifique os logs do servidor para erro SQL específico

---

## 📝 Scripts Disponíveis

1. **criar_tabela_sos_alerts.sql** - Cria tabela de alertas SOS
2. **criar_tabela_driver_reputation.sql** - Cria tabela de reputação
3. **verificar_tabelas_sos_reputacao.sql** - Verifica se as tabelas existem e mostra estatísticas

---

## ✅ Próximos Passos

1. Execute `verificar_tabelas_sos_reputacao.sql` para diagnosticar
2. Execute os scripts de criação se necessário
3. Reinicie o servidor Node.js
4. Teste novamente as funcionalidades
