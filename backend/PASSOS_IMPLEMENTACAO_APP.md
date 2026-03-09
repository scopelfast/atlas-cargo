# ✅ PASSOS DE IMPLEMENTAÇÃO - APP MOTORISTA (SEGURO)

## 🛡️ PRINCÍPIO DE SEGURANÇA

> **"Só ADICIONAMOS, NUNCA modificamos o que já funciona!"**

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### **✅ PASSO 1: Criar Tabelas no Banco** (30 minutos)

#### **1.1. Executar Script SQL:**
- [ ] Abrir SQL Server Management Studio (SSMS)
- [ ] Abrir arquivo: `backend/scripts/criar_tabelas_app_motorista.sql`
- [ ] Conferir que está no banco: `ATLAS_CARGO_PRD`
- [ ] Executar script (F5)
- [ ] Verificar mensagens de sucesso ✅

#### **1.2. Validar Criação:**
```sql
-- Verificar se tabelas foram criadas
SELECT name FROM sys.tables 
WHERE name IN (
    'MOTORISTA_COMPLEMENTO',
    'MOTORISTA_VEICULO',
    'VIAGEM_RASTREAMENTO',
    'VIAGEM_EVENTO',
    'VIAGEM_COMPROVANTE',
    'VIAGEM_CHAT'
)
ORDER BY name;

-- Deve retornar 6 tabelas ✅
```

#### **1.3. Testar INSERT Básico:**
```sql
-- Pegar um motorista existente
SELECT TOP 1 CDCADASTRO, RZSOCIAL 
FROM CADASTROGERAL 
WHERE FGTIPOCADASTRO = 'M';

-- Inserir teste (use o CDCADASTRO retornado acima)
INSERT INTO MOTORISTA_COMPLEMENTO (CDCADASTRO, NRCNH, CATEGORIACNH, VALIDADECNH)
VALUES (35174, '12345678901', 'AB', '2030-12-31');

-- Verificar
SELECT * FROM MOTORISTA_COMPLEMENTO;

-- Deletar teste
DELETE FROM MOTORISTA_COMPLEMENTO WHERE NRCNH = '12345678901';
```

**✅ Se tudo funcionou, vá para o próximo passo!**

---

### **✅ PASSO 2: Criar Pastas de Upload** (5 minutos)

```bash
cd backend/public
mkdir uploads
cd uploads
mkdir motoristas
mkdir veiculos
mkdir eventos
mkdir comprovantes
```

**Estrutura:**
```
backend/public/uploads/
├── motoristas/     (fotos CNH e selfies)
├── veiculos/       (fotos veículos e CRLV)
├── eventos/        (fotos de eventos)
└── comprovantes/   (fotos de comprovantes)
```

---

### **✅ PASSO 3: Criar Controller** (1 hora)

**Arquivo:** `backend/controllers/motorista-app.controller.js`

**Estrutura inicial (vazia, segura):**
```javascript
// backend/controllers/motorista-app.controller.js
const sql = require('mssql');
const { poolPromise } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const motoristaAppController = {
  // Login do motorista
  login: async (req, res) => {
    try {
      res.json({ message: 'Login em desenvolvimento' });
    } catch (err) {
      res.status(500).json({ error: 'Erro no login' });
    }
  },
  
  // Cadastro (placeholder)
  cadastro: async (req, res) => {
    res.json({ message: 'Cadastro em desenvolvimento' });
  }
};

module.exports = motoristaAppController;
```

**✅ Não mexe em NADA do sistema atual!**

---

### **✅ PASSO 4: Criar Routes** (30 minutos)

**Arquivo:** `backend/routes/motorista-app.routes.js`

```javascript
// backend/routes/motorista-app.routes.js
const express = require('express');
const router = express.Router();
const motoristaAppController = require('../controllers/motorista-app.controller');

// Rotas públicas (sem autenticação)
router.post('/login', motoristaAppController.login);
router.post('/cadastro', motoristaAppController.cadastro);

// Rotas protegidas (com autenticação) - adicionar depois
// router.get('/perfil/:id', authMiddleware, motoristaAppController.perfil);

module.exports = router;
```

---

### **✅ PASSO 5: Registrar no app.js** (5 minutos)

**Arquivo:** `backend/app.js`

**ADICIONAR apenas uma linha (não modificar nada!):**

```javascript
// ... imports existentes ...
const tipoAtividadeRoutes = require('./routes/tipoatividade.routes');
const motoristaAppRoutes = require('./routes/motorista-app.routes'); // ← NOVA LINHA

// ... resto do código ...

app.use('/api', tipoAtividadeRoutes);
app.use('/api/motorista', motoristaAppRoutes); // ← NOVA LINHA

// ... resto do código continua igual ...
```

**✅ Apenas ADICIONA, não modifica nada!**

---

### **✅ PASSO 6: Testar Backend** (15 minutos)

#### **6.1. Reiniciar servidor:**
```bash
cd backend
npm restart
# ou
pm2 restart all
```

#### **6.2. Testar rota com Postman/Insomnia:**
```
POST http://localhost:3000/api/motorista/login
Body: { "cpf": "12345678900", "senha": "teste" }

Resposta esperada:
{ "message": "Login em desenvolvimento" }
```

**✅ Se funcionou, backend está OK sem quebrar nada!**

---

### **✅ PASSO 7: Criar Estrutura PWA** (30 minutos)

**Criar pastas:**
```bash
cd backend/public
mkdir motorista
cd motorista
mkdir css
mkdir js
mkdir pages
```

**Estrutura:**
```
backend/public/motorista/
├── index.html
├── manifest.json
├── sw.js
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   └── auth.js
└── pages/
    └── (vazio por enquanto)
```

---

### **✅ PASSO 8: Criar index.html Básico** (30 minutos)

**Arquivo:** `backend/public/motorista/index.html`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atlas Cargo - Motorista</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div class="container">
    <h1>🚚 Atlas Cargo</h1>
    <h2>App do Motorista</h2>
    
    <form id="loginForm">
      <input type="text" id="cpf" placeholder="CPF" required>
      <input type="password" id="senha" placeholder="Senha" required>
      <button type="submit">Entrar</button>
    </form>
    
    <p id="message"></p>
  </div>
  
  <script src="js/auth.js"></script>
</body>
</html>
```

**✅ Simples, isolado, não afeta sistema atual!**

---

### **✅ PASSO 9: Testar Acesso** (5 minutos)

**Acessar:**
```
http://localhost:3000/motorista/
```

**Verificar:**
- [ ] Página carrega?
- [ ] Formulário aparece?
- [ ] Console sem erros?

**✅ Se funcionou, PWA está acessível!**

---

### **✅ PASSO 10: Commit Seguro** (5 minutos)

```bash
git add backend/scripts/criar_tabelas_app_motorista.sql
git add backend/controllers/motorista-app.controller.js
git add backend/routes/motorista-app.routes.js
git add backend/app.js
git add backend/public/motorista/

git commit -m "APP Motorista - Fase 1: Estrutura base (sem quebrar sistema atual)"
git push origin main
```

---

## ⚠️ AVISOS DE SEGURANÇA

### **✅ O Que GARANTE Não Quebrar:**

1. ✅ **Novas tabelas** - Não mexe nas existentes
2. ✅ **Novos controllers** - Não altera os atuais
3. ✅ **Novas rotas** - Apenas adiciona em app.js
4. ✅ **Nova pasta** - `/motorista/` separada
5. ✅ **Testes incrementais** - Cada passo validado

### **❌ O Que NÃO Fazer:**

1. ❌ **NÃO alterar** controllers existentes
2. ❌ **NÃO modificar** rotas existentes
3. ❌ **NÃO mexer** em CADASTROGERAL, VIAGEMMESTRE
4. ❌ **NÃO deletar** nada
5. ❌ **NÃO renomear** arquivos existentes

---

## 🎯 RESULTADO DO DIA 1

**Ao final de hoje, você terá:**
- ✅ 6 novas tabelas no banco (vazias)
- ✅ Controller básico (placeholder)
- ✅ Routes básicas (funcionando)
- ✅ PWA acessível (login simples)
- ✅ **SISTEMA ATUAL funcionando 100%!** ✅

---

## 📝 PRÓXIMOS PASSOS (Amanhã)

1. Implementar login de motorista (backend)
2. Integrar com CADASTROGERAL
3. Testar login no PWA
4. Listar convocações do motorista

---

**🚀 PRONTO PARA COMEÇAR?**

**Quer que eu:**
- **A)** Execute o script SQL agora (criar tabelas)?
- **B)** Crie os arquivos do backend agora?
- **C)** Faça tudo passo a passo junto?

**👉 Me diga e vamos começar com SEGURANÇA! 🛡️✨**
