# 📋 Checklist: Arquivos Necessários no Servidor

## ⚠️ O Problema

O erro 502 pode ocorrer porque:
1. **Servidor Node.js não está rodando** (mais provável)
2. **Arquivos estáticos não estão no servidor** (menos provável, mas possível)

Este checklist ajuda a verificar se **TODOS os arquivos necessários** estão presentes no servidor.

---

## ✅ Estrutura de Pastas Necessária

No servidor, você precisa ter a seguinte estrutura:

```
backend/
├── public/
│   ├── css/
│   │   ├── boxicons.min.css      ← CRÍTICO
│   │   ├── style.css             ← CRÍTICO
│   │   ├── dashboard.css
│   │   └── modulos.css
│   ├── js/
│   │   ├── login.js              ← CRÍTICO
│   │   ├── redirect.js            ← CRÍTICO
│   │   ├── log-helper.js         ← CRÍTICO
│   │   ├── dashboard.js
│   │   ├── cache-buster.js
│   │   └── ... (outros arquivos JS)
│   ├── index.html                 ← CRÍTICO
│   ├── dashboard.html
│   └── ... (outros arquivos HTML)
├── server.js                      ← CRÍTICO
├── app.js                         ← CRÍTICO
├── package.json                   ← CRÍTICO
└── node_modules/                  ← CRÍTICO (npm install)
```

---

## 🔍 Verificação Passo a Passo

### 1. Verificar se os arquivos CSS estão presentes

**No servidor, execute:**
```bash
cd /caminho/do/projeto/backend/public/css
ls -la
# ou (Windows)
dir
```

**Arquivos que DEVEM existir:**
- ✅ `boxicons.min.css` - **CRÍTICO** (biblioteca de ícones)
- ✅ `style.css` - **CRÍTICO** (estilos principais)
- ✅ `dashboard.css` - Estilos do dashboard
- ✅ `modulos.css` - Estilos dos módulos

**Se algum estiver faltando:**
- Copie do seu repositório local
- Ou baixe o `boxicons.min.css` de: https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css

---

### 2. Verificar se os arquivos JS estão presentes

**No servidor, execute:**
```bash
cd /caminho/do/projeto/backend/public/js
ls -la
# ou (Windows)
dir
```

**Arquivos que DEVEM existir:**
- ✅ `login.js` - **CRÍTICO** (lógica de login)
- ✅ `redirect.js` - **CRÍTICO** (redirecionamento)
- ✅ `log-helper.js` - **CRÍTICO** (utilitários de log)
- ✅ `dashboard.js` - Lógica do dashboard
- ✅ `cache-buster.js` - Cache busting
- ✅ `map-config.js` - Configuração de mapas
- ✅ Outros arquivos JS conforme necessário

**Se algum estiver faltando:**
- Copie do seu repositório local
- Ou faça `git pull` no servidor para atualizar

---

### 3. Verificar se os arquivos HTML estão presentes

**No servidor, execute:**
```bash
cd /caminho/do/projeto/backend/public
ls -la *.html
# ou (Windows)
dir *.html
```

**Arquivos que DEVEM existir:**
- ✅ `index.html` - **CRÍTICO** (página de login)
- ✅ `dashboard.html` - Dashboard principal

**Se algum estiver faltando:**
- Copie do seu repositório local

---

### 4. Verificar se o Node.js está configurado corretamente

**No servidor, execute:**
```bash
cd /caminho/do/projeto/backend
ls -la
# ou (Windows)
dir
```

**Arquivos que DEVEM existir:**
- ✅ `server.js` - **CRÍTICO** (servidor principal)
- ✅ `app.js` - **CRÍTICO** (aplicação Express)
- ✅ `package.json` - **CRÍTICO** (dependências)
- ✅ `node_modules/` - **CRÍTICO** (dependências instaladas)

**Se `node_modules/` não existir ou estiver incompleto:**
```bash
cd /caminho/do/projeto/backend
npm install
```

---

### 5. Verificar permissões dos arquivos

**No servidor (Linux), execute:**
```bash
# Verificar permissões
ls -la backend/public/css/
ls -la backend/public/js/

# Se necessário, corrigir permissões
chmod 644 backend/public/css/*.css
chmod 644 backend/public/js/*.js
chmod 644 backend/public/*.html
```

**No Windows:**
- Verifique se o usuário do serviço Node.js tem permissão de leitura nos arquivos

---

## 🚨 Comandos de Verificação Rápida

Execute este script no servidor para verificar tudo de uma vez:

```bash
#!/bin/bash
echo "=== Verificando Estrutura de Arquivos ==="
echo ""

echo "1. Arquivos CSS:"
if [ -f "backend/public/css/boxicons.min.css" ]; then
  echo "  ✅ boxicons.min.css existe"
else
  echo "  ❌ boxicons.min.css FALTANDO"
fi

if [ -f "backend/public/css/style.css" ]; then
  echo "  ✅ style.css existe"
else
  echo "  ❌ style.css FALTANDO"
fi

echo ""
echo "2. Arquivos JS:"
if [ -f "backend/public/js/login.js" ]; then
  echo "  ✅ login.js existe"
else
  echo "  ❌ login.js FALTANDO"
fi

if [ -f "backend/public/js/redirect.js" ]; then
  echo "  ✅ redirect.js existe"
else
  echo "  ❌ redirect.js FALTANDO"
fi

if [ -f "backend/public/js/log-helper.js" ]; then
  echo "  ✅ log-helper.js existe"
else
  echo "  ❌ log-helper.js FALTANDO"
fi

echo ""
echo "3. Arquivos HTML:"
if [ -f "backend/public/index.html" ]; then
  echo "  ✅ index.html existe"
else
  echo "  ❌ index.html FALTANDO"
fi

echo ""
echo "4. Arquivos do Backend:"
if [ -f "backend/server.js" ]; then
  echo "  ✅ server.js existe"
else
  echo "  ❌ server.js FALTANDO"
fi

if [ -f "backend/app.js" ]; then
  echo "  ✅ app.js existe"
else
  echo "  ❌ app.js FALTANDO"
fi

if [ -d "backend/node_modules" ]; then
  echo "  ✅ node_modules existe"
else
  echo "  ❌ node_modules FALTANDO (execute: npm install)"
fi

echo ""
echo "=== Verificação Concluída ==="
```

**Para Windows PowerShell:**
```powershell
Write-Host "=== Verificando Estrutura de Arquivos ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "1. Arquivos CSS:" -ForegroundColor Yellow
if (Test-Path "backend\public\css\boxicons.min.css") {
  Write-Host "  ✅ boxicons.min.css existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ boxicons.min.css FALTANDO" -ForegroundColor Red
}

if (Test-Path "backend\public\css\style.css") {
  Write-Host "  ✅ style.css existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ style.css FALTANDO" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Arquivos JS:" -ForegroundColor Yellow
if (Test-Path "backend\public\js\login.js") {
  Write-Host "  ✅ login.js existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ login.js FALTANDO" -ForegroundColor Red
}

if (Test-Path "backend\public\js\redirect.js") {
  Write-Host "  ✅ redirect.js existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ redirect.js FALTANDO" -ForegroundColor Red
}

if (Test-Path "backend\public\js\log-helper.js") {
  Write-Host "  ✅ log-helper.js existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ log-helper.js FALTANDO" -ForegroundColor Red
}

Write-Host ""
Write-Host "3. Arquivos HTML:" -ForegroundColor Yellow
if (Test-Path "backend\public\index.html") {
  Write-Host "  ✅ index.html existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ index.html FALTANDO" -ForegroundColor Red
}

Write-Host ""
Write-Host "4. Arquivos do Backend:" -ForegroundColor Yellow
if (Test-Path "backend\server.js") {
  Write-Host "  ✅ server.js existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ server.js FALTANDO" -ForegroundColor Red
}

if (Test-Path "backend\app.js") {
  Write-Host "  ✅ app.js existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ app.js FALTANDO" -ForegroundColor Red
}

if (Test-Path "backend\node_modules") {
  Write-Host "  ✅ node_modules existe" -ForegroundColor Green
} else {
  Write-Host "  ❌ node_modules FALTANDO (execute: npm install)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Verificação Concluída ===" -ForegroundColor Cyan
```

---

## 🔧 Como Sincronizar Arquivos com o Servidor

### Opção 1: Usando Git (Recomendado)

**No servidor:**
```bash
cd /caminho/do/projeto
git pull origin main
cd backend
npm install  # Se houver novas dependências
```

### Opção 2: Usando SCP (Linux/Mac)

**Da sua máquina local:**
```bash
# Copiar arquivos CSS
scp -r backend/public/css/* usuario@servidor:/caminho/do/projeto/backend/public/css/

# Copiar arquivos JS
scp -r backend/public/js/* usuario@servidor:/caminho/do/projeto/backend/public/js/

# Copiar arquivos HTML
scp backend/public/*.html usuario@servidor:/caminho/do/projeto/backend/public/
```

### Opção 3: Usando FTP/SFTP

- Conecte ao servidor via FTP/SFTP
- Navegue até `backend/public/`
- Faça upload dos arquivos faltantes

---

## 📝 Resumo: O que Pode Estar Faltando

### Arquivos Críticos que DEVEM estar no servidor:

1. **CSS:**
   - `backend/public/css/boxicons.min.css`
   - `backend/public/css/style.css`

2. **JavaScript:**
   - `backend/public/js/login.js`
   - `backend/public/js/redirect.js`
   - `backend/public/js/log-helper.js`

3. **HTML:**
   - `backend/public/index.html`

4. **Backend:**
   - `backend/server.js`
   - `backend/app.js`
   - `backend/node_modules/` (dependências instaladas)

---

## ✅ Próximos Passos

1. **Execute o script de verificação** acima no servidor
2. **Identifique os arquivos faltantes**
3. **Copie os arquivos faltantes** do seu repositório local
4. **Reinicie o servidor Node.js:**
   ```bash
   pm2 restart all
   # ou
   systemctl restart node
   ```
5. **Teste novamente** acessando `https://cargas.integrabrasil.com:8080`

---

## 💡 Dica Importante

**Se você usa Git no servidor**, a forma mais fácil de garantir que todos os arquivos estão atualizados é:

```bash
cd /caminho/do/projeto
git pull origin main
cd backend
npm install  # Instalar/atualizar dependências
pm2 restart all  # Reiniciar servidor
```

Isso garante que **TODOS os arquivos** estejam sincronizados com o repositório!
