# 🔄 Como Desabilitar Sistema de Alertas (Se Necessário)

**IMPORTANTE:** Isso é apenas uma precaução! O sistema é seguro e não quebra nada.

---

## ⚡ **Método Rápido (Desabilitar Temporariamente)**

### **1. Comentar Job Agendado**

Edite `backend/server.js`:

```javascript
app.listen(PORT, '0.0.0.0', () => {
  // ... código existente ...
  
  // COMENTAR esta linha para desabilitar:
  // iniciarJobAlertas();
});
```

**Resultado:** Job não roda, mas alertas ainda podem ser verificados manualmente.

---

### **2. Comentar Rotas**

Edite `backend/app.js`:

```javascript
// COMENTAR estas linhas:
// const alertRoutes = require('./routes/alert.routes');
// app.use('/api/alerts', alertRoutes);
```

**Resultado:** API de alertas fica inacessível, mas nada quebra.

---

## 🔙 **Rollback Completo (Remover Tudo)**

### **1. Remover Tabelas do Banco** (OPCIONAL)

```sql
-- Só execute se REALMENTE quiser remover os dados
-- CUIDADO: Isso apaga todos os alertas criados!

DROP TABLE [dbo].[ALERT_CONFIG];
DROP TABLE [dbo].[ALERTS];
```

### **2. Remover Arquivos Criados**

```bash
# Deletar arquivos criados
rm backend/services/alert-service.js
rm backend/controllers/alert.controller.js
rm backend/routes/alert.routes.js
rm backend/scripts/criar_tabela_alerts.sql
```

### **3. Reverter Alterações em Arquivos Existentes**

**`backend/app.js`** - Remover:
```javascript
const alertRoutes = require('./routes/alert.routes');  // ← REMOVER
app.use('/api/alerts', alertRoutes);  // ← REMOVER
```

**`backend/server.js`** - Remover todo bloco `iniciarJobAlertas()`

**`backend/public/modulos/gerenciar-viagens/index.html`** - Remover aba de alertas

**`backend/public/modulos/gerenciar-viagens/js/script.js`** - Remover funções de alertas

---

## ⚠️ **IMPORTANTE**

**Não precisa desabilitar!** O sistema foi criado para ser:
- ✅ Totalmente isolado
- ✅ Não interfere com nada existente
- ✅ Pode simplesmente ignorar a aba "Alertas" se não quiser usar

---

**Recomendação:** Deixe ativo e teste. Se não precisar, simplesmente não use a funcionalidade.
