# 🔍 Explicação da Lógica de Validação de Macros

**Data:** 2025-01-18  
**Urgente:** SIM

---

## 📋 Como Funciona Atualmente

### **1. Carregamento do Histórico**
- Quando uma viagem é selecionada, o sistema busca o histórico de macros já registradas
- Endpoint: `GET /api/motorista/historico-macros/:idViagem`
- Retorna as macros ordenadas por data (mais recente primeiro)
- Cada macro tem: `CDTIPOOCORRENCIA`, `FGSITUACAO`, `SEQ`

### **2. Validação de Sequência (Frontend)**
A função `validarSequencia(macro)` em `macros.html` (linha 435) funciona assim:

#### **Cenário 1: Sem Histórico**
- Se `historico.length === 0`
- ✅ **Permite apenas:** "Viagem - Início" (código 103)
- 🔒 **Bloqueia todas as outras**

#### **Cenário 2: Com Histórico**
- Pega a última macro registrada: `const ultima = historico[0]`
- Compara com a macro atual usando:
  - `FGSITUACAO` (T=Viagem, C=Carga, D=Descarga, P=Parada)
  - `SEQ` (1=Chegada, 2=Início, 3=Fim)

#### **Regras de Sequenciamento:**

**SEQ 1 (Chegada):**
- ✅ Permite se última macro NÃO for da mesma situação
- ✅ Permite se última macro for SEQ 3 (Fim) da mesma situação
- 🔒 Bloqueia se última macro for SEQ 1 ou SEQ 2 da mesma situação

**SEQ 2 (Início):**
- ✅ Permite se última macro for SEQ 1 (Chegada) da mesma situação
- 🔒 Bloqueia caso contrário

**SEQ 3 (Fim):**
- ✅ Permite se última macro for SEQ 2 (Início) da mesma situação
- 🔒 Bloqueia caso contrário

**Paradas (FGSITUACAO = 'P'):**
- ✅ Sempre permitidas (não seguem sequência)

---

## ❌ PROBLEMAS IDENTIFICADOS

### **1. Inconsistência no Histórico**
**Problema:** O histórico pode estar mostrando macros em ordem errada ou incompleta.

**Exemplo do erro:**
- "Carga - Início" (SEQ 2) está 🔒 bloqueado
- Mas "Carga - Fim" (SEQ 3) está ✅ marcado como completo

**Causa provável:**
- O histórico não está retornando todas as macros
- Ou a ordem está errada
- Ou há macros registradas diretamente no banco sem passar pela validação

### **2. Validação Apenas no Frontend**
**Problema:** A validação está sendo feita apenas no frontend, baseada no histórico.

**Risco:**
- Se o histórico estiver desatualizado, a validação falha
- Se houver macros registradas diretamente no banco, a validação não detecta
- Race condition: dois usuários podem registrar ao mesmo tempo

### **3. Erro SEQUENCIA NULL**
**Problema:** Ainda está dando erro `Cannot insert the value NULL into column 'SEQUENCIA'`

**Causa:**
- O código foi corrigido, mas o servidor pode não ter sido reiniciado
- Ou há algum caso onde o cálculo de sequência falha

---

## 🔧 SOLUÇÕES PROPOSTAS

### **1. Melhorar Validação no Backend**
- Usar a stored procedure `sp_ValidarSequenciaOcorrencia` ANTES de registrar
- Validar no backend, não apenas no frontend

### **2. Corrigir Cálculo de SEQUENCIA**
- Garantir que SEMPRE calcule a sequência antes de inserir
- Adicionar fallback se o cálculo falhar

### **3. Melhorar Histórico**
- Garantir que o histórico retorne TODAS as macros da viagem
- Ordenar corretamente por data
- Incluir informações de SEQ e FGSITUACAO

### **4. Adicionar Validação Dupla**
- Frontend: validação rápida para UX
- Backend: validação definitiva antes de salvar

---

## 🚨 AÇÃO URGENTE NECESSÁRIA

1. **Reiniciar o servidor Node.js** para aplicar correções de SEQUENCIA
2. **Verificar o histórico** da viagem #83184 no banco de dados
3. **Corrigir a lógica de validação** para usar backend também
4. **Testar sequência completa** de uma viagem do zero

---

**Última atualização:** 2025-01-18
