# ⚡ Passo a Passo Rápido - Teste do Módulo Alertas

**Versão:** 1.0  
**Data:** 2025-01-18

---

## 🚀 Início Rápido (5 minutos)

### Passo 1: Preparar Dados de Teste

1. Abra o **SQL Server Management Studio**
2. Conecte ao banco `DIVULGACARGA_PRD`
3. Execute o script: `backend/scripts/criar_alertas_teste.sql`
4. Verifique se apareceu a mensagem: `✅ Script concluído!`

### Passo 2: Acessar o Módulo

1. Abra o navegador e acesse o sistema
2. Faça login (usuário Admin)
3. No menu lateral, clique em **"4.0.Alertas"**
4. O módulo deve carregar mostrando os alertas

### Passo 3: Testar Funcionalidades Básicas

#### ✅ Teste 1: Visualizar Alertas
- [ ] Lista de alertas aparece
- [ ] Cards têm cores diferentes (por prioridade)
- [ ] Estatísticas no topo mostram números

#### ✅ Teste 2: Filtrar
- [ ] Selecione "Status: Pendente" → Clique "Filtrar"
- [ ] Lista atualiza mostrando apenas pendentes
- [ ] Clique "Limpar" → Lista volta ao normal

#### ✅ Teste 3: Marcar como Lido
- [ ] Clique "Marcar como Lido" em um alerta
- [ ] Alerta perde o destaque amarelo
- [ ] Botão desaparece

#### ✅ Teste 4: Tratar Alerta
- [ ] Clique "Tratar" em um alerta pendente
- [ ] Modal abre
- [ ] Selecione status "Tratado"
- [ ] Digite observações: "Teste de tratamento"
- [ ] Clique "Salvar"
- [ ] Alerta atualiza na lista

#### ✅ Teste 5: Ver Histórico
- [ ] Clique "Histórico" em um alerta
- [ ] Modal mostra histórico de ações
- [ ] Datas e usuários aparecem

#### ✅ Teste 6: Badge no Menu
- [ ] Observe o item "4.0.Alertas" no menu
- [ ] Deve haver um badge vermelho com número
- [ ] Trate alguns alertas
- [ ] Badge atualiza automaticamente

---

## 🎯 O Que Esperar

### ✅ Funcionando Corretamente

- Lista de alertas carrega em 1-2 segundos
- Filtros funcionam instantaneamente
- Badge no menu aparece/desaparece automaticamente
- WebSocket conecta (verifique no Console: `✅ WebSocket Alertas conectado`)
- Estatísticas correspondem aos alertas reais

### ⚠️ Problemas Comuns

| Problema | Solução |
|----------|---------|
| Nenhum alerta aparece | Execute `criar_alertas_teste.sql` |
| Badge não aparece | Verifique se há alertas pendentes no banco |
| Erro ao tratar | Recarregue a página e tente novamente |
| WebSocket não conecta | Verifique se servidor está rodando |

---

## 📋 Checklist Completo

- [ ] Script SQL executado com sucesso
- [ ] Módulo carrega sem erros
- [ ] Lista de alertas exibida
- [ ] Filtros funcionam
- [ ] Marcar como lido funciona
- [ ] Tratar alerta funciona
- [ ] Histórico exibe corretamente
- [ ] Badge no menu aparece
- [ ] Estatísticas corretas
- [ ] WebSocket conecta (Console F12)

---

## 🔍 Verificação Rápida no Banco

Execute no SQL Server:

```sql
-- Ver quantos alertas existem
SELECT 
    STATUS,
    COUNT(*) as Total
FROM [dbo].[ALERTS]
GROUP BY STATUS;

-- Ver alertas pendentes
SELECT TOP 5 * 
FROM [dbo].[ALERTS]
WHERE STATUS = 'Pendente'
ORDER BY CREATED_AT DESC;
```

---

## 📞 Próximos Passos

Após validar os testes básicos:

1. ✅ Leia o **GUIA_TESTES_ALERTAS.md** para testes completos
2. ✅ Consulte **DOCUMENTACAO_MODULO_ALERTAS.md** para detalhes técnicos
3. ✅ Teste com dados reais (viagens ativas)

---

**Tempo estimado:** 5-10 minutos  
**Dificuldade:** Fácil
