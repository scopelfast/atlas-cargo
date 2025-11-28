# ⚡ Início Rápido: Resolver ERR_NGROK_3200

## 🎯 Problema
O erro `ERR_NGROK_3200` significa que o túnel ngrok está **offline**.

## ✅ Solução Rápida (3 passos)

### 1️⃣ Verificar se o servidor está rodando
```powershell
# Se não estiver rodando, inicie:
cd backend
npm run dev
```

### 2️⃣ Iniciar o ngrok
Abra um **novo terminal** e execute:
```powershell
ngrok http 3000
```

**Se não tiver ngrok instalado:**
- Baixe: https://ngrok.com/download
- Extraia e execute: `ngrok.exe http 3000`

### 3️⃣ Atualizar o .env
Copie a URL HTTPS que aparece no ngrok (ex: `https://abc123.ngrok-free.dev`) e atualize o arquivo `backend/.env`:

```env
PUBLIC_URL=https://abc123.ngrok-free.dev
```

Depois, **reinicie o servidor Node.js**.

---

## 🚀 Script Automatizado

### Opção 1: Script Batch (Mais Simples)
```cmd
cd backend
iniciar-ngrok.bat
```

### Opção 2: Script PowerShell Completo
```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\iniciar-ngrok-completo.ps1
```

O script irá:
- ✅ Verificar se o servidor está rodando
- ✅ Iniciar o ngrok
- ✅ Detectar a URL automaticamente
- ✅ Atualizar o `.env` automaticamente

**Nota:** Se a política de execução do PowerShell estiver restrita, use o arquivo `.bat` ou execute com `-ExecutionPolicy Bypass`.

---

## 📋 Checklist

- [ ] Servidor Node.js rodando na porta 3000
- [ ] ngrok rodando e exibindo URL HTTPS
- [ ] Arquivo `.env` atualizado com a URL do ngrok
- [ ] Servidor Node.js reiniciado após atualizar `.env`

---

## 🔗 Testar

Acesse a URL do ngrok:
```
https://sua-url-ngrok.ngrok-free.dev/convocacao/38
```

**Nota:** Na primeira vez, clique em "Visit Site" se aparecer uma página de aviso.

---

## ⚠️ Lembrete

- Mantenha **dois terminais abertos**: um para o servidor Node.js e outro para o ngrok
- A URL do ngrok muda a cada reinício (versão gratuita)
- Sempre atualize o `.env` quando reiniciar o ngrok

---

Para mais detalhes, consulte: `GUIA_NGROK.md`

