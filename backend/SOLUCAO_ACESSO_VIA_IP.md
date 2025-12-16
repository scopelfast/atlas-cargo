# 🔧 Solução: Acesso via IP (192.168.x.x) não funciona

## 🔍 Problema Identificado

O servidor está configurado para rodar na **porta 5000**, mas você está tentando acessar na **porta 3000**.

## ✅ Soluções

### **Solução 1: Usar a Porta Correta (5000)**

Acesse usando a porta 5000:

```
http://192.168.1.173:5000/dashboard.html
```

### **Solução 2: Configurar Porta 3000 no .env**

1. Edite o arquivo `backend/.env` e adicione/atualize:

```env
PORT=3000
```

2. Reinicie o servidor:

```powershell
# Pare o servidor (Ctrl+C) e inicie novamente
cd backend
npm start
# ou
node server.js
```

### **Solução 3: Verificar Firewall**

O firewall pode estar bloqueando a porta. Execute como **Administrador**:

```powershell
# PowerShell (como Administrador)
cd backend
.\liberar-porta-firewall.ps1
```

Ou manualmente:

```powershell
# Como Administrador
New-NetFirewallRule -DisplayName "Node.js Backend - Porta 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### **Solução 4: Verificar se o Servidor está Escutando em Todas as Interfaces**

O servidor já está configurado para escutar em `0.0.0.0` (todas as interfaces), então isso está correto.

Verifique no arquivo `backend/server.js` linha 51:

```javascript
app.listen(PORT, '0.0.0.0', () => {
  // ✅ Correto - escuta em todas as interfaces
});
```

---

## 🔍 Diagnóstico

### **1. Verificar qual porta o servidor está usando:**

Quando iniciar o servidor, você verá:

```
✅ Servidor rodando na porta 5000
```

ou

```
✅ Servidor rodando na porta 3000
```

Use a porta que aparecer na mensagem!

### **2. Verificar se o servidor está acessível:**

No mesmo computador:
- ✅ `http://localhost:5000/dashboard.html` deve funcionar
- ✅ `http://127.0.0.1:5000/dashboard.html` deve funcionar

De outro dispositivo na mesma rede:
- ✅ `http://192.168.1.173:5000/dashboard.html` deve funcionar

### **3. Verificar Firewall:**

```powershell
# Verificar regras do firewall
Get-NetFirewallRule -DisplayName "*Node*" | Format-Table DisplayName, Enabled, Direction, Action
```

---

## 📋 Checklist de Solução

- [ ] Verificar qual porta o servidor está usando (mensagem ao iniciar)
- [ ] Acessar usando a porta correta: `http://192.168.1.173:PORTA/dashboard.html`
- [ ] Se quiser usar porta 3000, adicionar `PORT=3000` no `.env`
- [ ] Liberar porta no firewall (executar script como Administrador)
- [ ] Verificar se está na mesma rede Wi-Fi/Ethernet
- [ ] Reiniciar o servidor após mudanças

---

## 🚀 Solução Rápida

**Para usar porta 3000:**

1. Edite `backend/.env`:
   ```env
   PORT=3000
   ```

2. Libere o firewall (como Administrador):
   ```powershell
   cd backend
   .\liberar-porta-firewall.ps1
   ```

3. Reinicie o servidor:
   ```powershell
   cd backend
   npm start
   ```

4. Acesse:
   ```
   http://192.168.1.173:3000/dashboard.html
   ```

---

## ⚠️ Notas Importantes

1. **Porta padrão**: O servidor usa porta **5000** por padrão (definido em `server.js`)
2. **Firewall**: Sempre libere a porta no firewall para acesso via IP
3. **Rede**: Apenas dispositivos na mesma rede local podem acessar via IP
4. **CSP**: O Content Security Policy já foi atualizado para permitir IPs locais

---

## 🆘 Ainda não funciona?

1. Verifique se o servidor está rodando:
   ```powershell
   netstat -ano | findstr :3000
   # ou
   netstat -ano | findstr :5000
   ```

2. Verifique o IP correto:
   ```powershell
   ipconfig
   # Procure por "Endereço IPv4" no adaptador ativo
   ```

3. Teste de outro dispositivo na mesma rede

4. Verifique logs do servidor para erros

