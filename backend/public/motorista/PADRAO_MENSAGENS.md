# 📋 Padrão de Mensagens - APP do Motorista

**Versão:** 1.0  
**Data:** 2025-01-18

---

## 🎯 Regras Gerais

### **Modais (`mostrarModal`)**
- **Título:** Sem emojis, texto claro e direto
- **Mensagem:** Texto objetivo, sem emojis excessivos
- **Botões:** Padrão `['Cancelar', 'Ação']` (primeiro botão sempre "Cancelar")

### **Toasts (`mostrarToast`)**
- **Mensagem:** Texto claro, pode ter 1 emoji no início (opcional)
- **Tipo:** `'success'`, `'error'`, `'warning'`, `'info'`

---

## 📝 Exemplos de Padrão

### ✅ **CORRETO:**

```javascript
// Modal
mostrarModal(
  'Alerta de Emergência',
  'Você está prestes a enviar um alerta de EMERGÊNCIA.\n\nEste alerta será enviado imediatamente à torre de controle.\n\nDeseja continuar?',
  ['Cancelar', 'Continuar']
);

// Toast
mostrarToast('Posição enviada com sucesso!', 'success');
mostrarToast('Erro ao enviar posição', 'error');
mostrarToast('Nenhuma viagem selecionada', 'warning');
```

### ❌ **INCORRETO:**

```javascript
// ❌ Título com emoji
mostrarModal('🚨 Alerta de Emergência', ...);

// ❌ Mensagem com emojis excessivos
mostrarModal('Título', '⚠️ ATENÇÃO: Você está prestes...', ...);

// ❌ Usando alert() nativo
alert('⚠️ Erro!');

// ❌ Usando confirm() nativo
if (confirm('Deseja continuar?')) { ... }
```

---

## 🔧 Padrão de Botões

### **Confirmação:**
```javascript
['Cancelar', 'Confirmar']
['Cancelar', 'Continuar']
['Cancelar', 'Sim']
```

### **Ações:**
```javascript
['Cancelar', 'Salvar']
['Cancelar', 'Excluir']
['Cancelar', 'Enviar']
```

### **Destrutivas (perigo):**
```javascript
['Cancelar', 'Sim, Excluir']
['Cancelar', 'Sim, Limpar Tudo']
```

---

## 📋 Checklist de Padronização

- [ ] ❌ Não usar `alert()` nativo
- [ ] ❌ Não usar `confirm()` nativo
- [ ] ✅ Usar `mostrarModal()` para confirmações
- [ ] ✅ Usar `mostrarToast()` para notificações
- [ ] ✅ Títulos sem emojis
- [ ] ✅ Mensagens claras e objetivas
- [ ] ✅ Primeiro botão sempre "Cancelar"
- [ ] ✅ Tipo correto no toast (success/error/warning/info)

---

**Última atualização:** 2025-01-18
