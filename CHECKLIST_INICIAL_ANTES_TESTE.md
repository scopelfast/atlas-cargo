# ✅ Checklist: Antes de Começar a Testar

**Data:** 2026-01-16  

---

## 📋 Pré-requisitos Obrigatórios

### 1. ✅ Scripts SQL Executados

Execute estes scripts no SQL Server (na ordem):

```sql
-- 1. Tabela de Mensagens (Chat)
EXEC backend/scripts/criar_tabela_messages.sql
-- OU execute manualmente o conteúdo do arquivo

-- 2. Tabelas de Alertas
EXEC backend/scripts/criar_tabela_alerts.sql
-- OU execute manualmente o conteúdo do arquivo

-- 3. Tabela de Comprovações de Entrega (POD)
EXEC backend/scripts/criar_tabela_delivery_proofs.sql
-- OU execute manualmente o conteúdo do arquivo
```

### 2. ✅ Dependências NPM

```bash
cd backend
npm install
# Verificar se socket.io está instalado
npm list socket.io
```

### 3. ✅ Servidor Rodando

```bash
cd backend
npm run dev
```

O servidor deve mostrar:
```
✅ Servidor rodando na porta 3000
✅ Conexão com ATLAS_CARGO_PRD estabelecida
✅ Conexão com INTEGRA_PRD estabelecida
🔄 Job de alertas iniciado (verificação a cada 5 minutos)
```

### 4. ✅ Acesso ao Sistema

- **Dashboard Admin:** `http://localhost:3000/dashboard.html`
- **App Motorista:** `http://localhost:3000/motorista/`

---

## 🎯 O Que Testar (Resumo)

### ✅ PRONTO PARA TESTE:

1. **💬 Chat Integrado** (COMPLETO)
   - Chat no app motorista
   - Chat no módulo admin (nova aba "Chat")
   - Mensagens em tempo real
   - Funciona offline

2. **⚠️ Sistema de Alertas** (COMPLETO)
   - Aba "Alertas" no gerenciar-viagens
   - Detecção automática (paradas, atrasos, offline)
   - Resolver alertas

3. **📦 Comprovação de Entrega** (COMPLETO)
   - Captura de foto
   - Assinatura digital
   - GPS automático
   - Funciona offline

---

## 🚀 Início Rápido

1. Execute os scripts SQL acima
2. Inicie o servidor (`npm run dev`)
3. Abra duas abas do navegador:
   - Aba 1: `http://localhost:3000/dashboard.html` (Admin)
   - Aba 2: `http://localhost:3000/motorista/` (Motorista)
4. Siga o `GUIA_TESTE_FUNCIONALIDADES.md` para testes detalhados

---

**Tudo pronto?** Vamos testar! 🎉
