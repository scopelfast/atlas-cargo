# 🔧 Solução para Erro 502 Bad Gateway no Servidor

## ⚠️ O Problema

O erro `502 Bad Gateway` significa que o **servidor Node.js não está respondendo** ou o **proxy reverso (Nginx/Apache) não consegue se comunicar com ele**.

**IMPORTANTE:** O código está correto! Todos os arquivos já usam caminhos locais (`/css/...`, `/js/...`). O problema é de **infraestrutura do servidor**.

---

## ✅ Verificações no Servidor

### 1. Verificar se o Node.js está rodando

#### Se usar PM2:
```bash
pm2 list
pm2 logs
pm2 status
```

#### Se usar systemd:
```bash
systemctl status node
systemctl status seu-app
```

#### Se usar serviço Windows:
- Abra o **Gerenciador de Tarefas** → Aba **Serviços**
- Procure por serviços relacionados ao Node.js
- Verifique se estão **Em execução**

---

### 2. Verificar logs do servidor

#### PM2:
```bash
pm2 logs --lines 50
```

#### systemd:
```bash
journalctl -u node -n 50
journalctl -u seu-app -n 50
```

#### Windows (se usar serviço):
- Verifique os logs do aplicativo
- Verifique o **Visualizador de Eventos do Windows**

---

### 3. Verificar se a porta está correta

O erro mostra que está tentando acessar `https://cargas.integrabrasil.com:8080`

**Verifique:**
- O Node.js está rodando na porta **8080**?
- Ou está rodando em outra porta (ex: 3000, 8083)?
- O proxy reverso está configurado para a porta correta?

#### Testar porta localmente (no servidor):
```bash
# Linux/Mac
curl http://localhost:8080
# ou
curl http://localhost:3000

# Windows PowerShell
Invoke-WebRequest http://localhost:8080
Invoke-WebRequest http://localhost:3000
```

---

### 4. Verificar configuração do Proxy Reverso (Nginx/Apache)

#### Nginx:
```bash
# Verificar configuração
cat /etc/nginx/sites-available/cargas.integrabrasil.com
# ou
cat /etc/nginx/conf.d/cargas.conf

# Verificar logs de erro
tail -f /var/log/nginx/error.log

# Testar configuração
nginx -t
```

**Configuração esperada (exemplo):**
```nginx
server {
    listen 8080;
    server_name cargas.integrabrasil.com;

    location / {
        proxy_pass http://localhost:3000;  # ← Porta do Node.js
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Apache:
```bash
# Verificar configuração
cat /etc/apache2/sites-available/cargas.conf

# Verificar logs
tail -f /var/log/apache2/error.log

# Testar configuração
apache2ctl configtest
```

---

### 5. Reiniciar os serviços

#### PM2:
```bash
pm2 restart all
# ou
pm2 restart seu-app
```

#### systemd:
```bash
systemctl restart node
systemctl restart seu-app
```

#### Nginx:
```bash
systemctl restart nginx
# ou
service nginx restart
```

#### Apache:
```bash
systemctl restart apache2
# ou
service apache2 restart
```

---

## 🔍 Diagnóstico Passo a Passo

### Passo 1: Verificar se Node.js está rodando
```bash
# No servidor, execute:
ps aux | grep node
# ou
netstat -tulpn | grep :8080
# ou (Windows)
netstat -ano | findstr :8080
```

**Se não aparecer nada:** O Node.js não está rodando → **Iniciar o servidor**

---

### Passo 2: Iniciar o servidor Node.js

#### Se usar PM2:
```bash
cd /caminho/do/projeto/backend
pm2 start server.js --name atlas_cargo
pm2 save
```

#### Se usar systemd:
```bash
systemctl start node
systemctl enable node  # Para iniciar automaticamente
```

#### Se usar npm diretamente:
```bash
cd /caminho/do/projeto/backend
npm start
# ou
node server.js
```

---

### Passo 3: Verificar se o Node.js está respondendo

**No servidor, teste localmente:**
```bash
curl http://localhost:3000
# ou a porta que você configurou
```

**Se retornar HTML:** ✅ Node.js está funcionando  
**Se retornar erro:** ❌ Verificar logs do Node.js

---

### Passo 4: Verificar configuração do proxy

**O proxy precisa apontar para a porta correta do Node.js:**

- Se Node.js roda na porta **3000** → Proxy deve fazer `proxy_pass http://localhost:3000`
- Se Node.js roda na porta **8083** → Proxy deve fazer `proxy_pass http://localhost:8083`

**Verifique o arquivo de configuração do proxy e ajuste se necessário.**

---

## 🚨 Problemas Comuns e Soluções

### Problema 1: Node.js não está rodando
**Solução:** Iniciar o servidor Node.js (veja Passo 2 acima)

---

### Problema 2: Porta errada no proxy
**Sintoma:** Node.js roda na porta 3000, mas proxy aponta para 8080

**Solução:** Ajustar configuração do proxy para apontar para a porta correta

---

### Problema 3: Firewall bloqueando
**Sintoma:** Node.js está rodando, mas não responde

**Solução:** Verificar firewall:
```bash
# Linux
sudo ufw status
sudo ufw allow 3000  # ou a porta do Node.js

# Windows
# Verificar Firewall do Windows → Regras de Entrada
```

---

### Problema 4: Node.js travado
**Sintoma:** Processo existe mas não responde

**Solução:** Reiniciar:
```bash
pm2 restart all
# ou
killall node
# Depois iniciar novamente
```

---

## ✅ Checklist Rápido

Execute estes comandos no servidor:

```bash
# 1. Verificar se Node.js está rodando
pm2 list
# ou
ps aux | grep node

# 2. Verificar logs
pm2 logs --lines 20

# 3. Testar localmente
curl http://localhost:3000

# 4. Verificar proxy
nginx -t
# ou
apache2ctl configtest

# 5. Reiniciar tudo
pm2 restart all
systemctl restart nginx  # ou apache2
```

---

## 📞 Se Nada Funcionar

1. **Verifique os logs completos:**
   ```bash
   pm2 logs --lines 100
   tail -100 /var/log/nginx/error.log
   ```

2. **Teste o Node.js diretamente (sem proxy):**
   - Acesse: `http://IP_DO_SERVIDOR:3000` (ou a porta do Node.js)
   - Se funcionar: Problema é no proxy
   - Se não funcionar: Problema é no Node.js

3. **Verifique variáveis de ambiente:**
   - Arquivo `.env` está correto?
   - `PORT` está configurada?
   - Banco de dados está acessível?

---

## 🎯 Resumo

O erro 502 **NÃO é problema do código**. O código está correto e todos os arquivos usam caminhos locais.

**O problema é:**
- ❌ Servidor Node.js parado
- ❌ Proxy mal configurado
- ❌ Porta errada
- ❌ Firewall bloqueando

**A solução é:**
- ✅ Iniciar/reiniciar o Node.js
- ✅ Verificar configuração do proxy
- ✅ Verificar portas e firewall

---

## 💡 Dica Final

Se você tem acesso SSH ao servidor, execute este comando para diagnóstico completo:

```bash
echo "=== Node.js Processos ===" && ps aux | grep node
echo "=== Portas em uso ===" && netstat -tulpn | grep -E ':(3000|8080|8083)'
echo "=== PM2 Status ===" && pm2 list
echo "=== Últimos logs ===" && pm2 logs --lines 10 --nostream
```

Isso vai mostrar exatamente o que está acontecendo!
