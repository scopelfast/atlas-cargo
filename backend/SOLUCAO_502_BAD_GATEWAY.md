# 🔧 Solução: Erro 502 Bad Gateway (nginx)

## ⚠️ Problema
```
502 Bad Gateway
nginx/1.24.0 (Ubuntu)
```

O nginx está funcionando, mas **não consegue se comunicar com o backend Node.js**.

---

## 🔍 Diagnóstico

### 1. Verificar se o Node.js está rodando

**No servidor, execute:**
```bash
# Verificar se o processo Node.js está rodando
ps aux | grep node
# ou
pm2 list
# ou (Windows)
tasklist | findstr node
```

**Se não estiver rodando:**
```bash
cd /caminho/do/projeto/backend
npm start
# ou
pm2 start server.js
# ou (Windows)
node server.js
```

### 2. Verificar a porta do Node.js

O Node.js deve estar rodando na porta **3000** (padrão) ou **8083** (conforme docker-compose.yml).

**Verificar:**
```bash
# Linux
netstat -tulpn | grep :3000
# ou
netstat -tulpn | grep :8083

# Windows
netstat -ano | findstr :3000
# ou
netstat -ano | findstr :8083
```

### 3. Verificar configuração do nginx

O nginx deve estar configurado para fazer proxy para o Node.js.

**Arquivo de configuração do nginx (geralmente em `/etc/nginx/sites-available/default` ou `/etc/nginx/conf.d/default.conf`):**

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cargas.integrabrasil.com;

    # Redirecionar HTTP para HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name cargas.integrabrasil.com;

    # Certificados SSL
    ssl_certificate /etc/letsencrypt/live/cargas.integrabrasil.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cargas.integrabrasil.com/privkey.pem;

    # Configurações SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Proxy para Node.js
    location / {
        proxy_pass http://localhost:3000;  # ← VERIFICAR ESTA PORTA!
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**⚠️ IMPORTANTE:** Verifique se `proxy_pass` aponta para a porta correta:
- Se Node.js está na porta **3000**: `proxy_pass http://localhost:3000;`
- Se Node.js está na porta **8083**: `proxy_pass http://localhost:8083;`

### 4. Verificar logs do nginx

```bash
# Ver logs de erro do nginx
sudo tail -f /var/log/nginx/error.log

# Ver logs de acesso
sudo tail -f /var/log/nginx/access.log
```

### 5. Verificar logs do Node.js

**Se estiver usando PM2:**
```bash
pm2 logs
```

**Se estiver rodando diretamente:**
```bash
# Verificar se há erros no console
```

---

## ✅ Soluções

### Solução 1: Iniciar o Node.js

```bash
cd /caminho/do/projeto/backend

# Verificar se há .env configurado
cat .env

# Iniciar o servidor
npm start
# ou
pm2 start server.js --name atlas-cargo
# ou (Windows)
node server.js
```

### Solução 2: Corrigir porta no nginx

**Se o Node.js está na porta 8083, mas o nginx está configurado para 3000:**

1. Editar configuração do nginx:
```bash
sudo nano /etc/nginx/sites-available/default
```

2. Alterar:
```nginx
proxy_pass http://localhost:8083;  # ← Porta correta
```

3. Testar configuração:
```bash
sudo nginx -t
```

4. Recarregar nginx:
```bash
sudo systemctl reload nginx
```

### Solução 3: Verificar firewall

```bash
# Verificar se a porta está aberta
sudo ufw status
# ou
sudo iptables -L -n

# Se necessário, abrir porta
sudo ufw allow 3000/tcp
# ou
sudo ufw allow 8083/tcp
```

### Solução 4: Verificar se o Node.js está escutando no localhost

**No `server.js`, verificar:**
```javascript
httpServer.listen(PORT, '0.0.0.0', () => {  // ← Deve ser '0.0.0.0' para aceitar conexões externas
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
```

**Se estiver `localhost` ou `127.0.0.1`, o nginx não conseguirá conectar!**

---

## 🚀 Checklist Rápido

1. [ ] Node.js está rodando? (`ps aux | grep node`)
2. [ ] Node.js está na porta correta? (`netstat -tulpn | grep :3000`)
3. [ ] nginx está configurado para a porta correta? (`proxy_pass http://localhost:3000`)
4. [ ] Firewall permite conexão? (`ufw status`)
5. [ ] Node.js está escutando em `0.0.0.0`? (não `127.0.0.1`)
6. [ ] Logs do nginx mostram erro? (`tail -f /var/log/nginx/error.log`)

---

## 📝 Comandos Úteis

```bash
# Reiniciar nginx
sudo systemctl restart nginx

# Ver status do nginx
sudo systemctl status nginx

# Testar configuração do nginx
sudo nginx -t

# Ver processos Node.js
pm2 list
# ou
ps aux | grep node

# Matar processo Node.js (se necessário)
pm2 stop all
# ou
killall node
```

---

## ⚠️ Se nada funcionar

1. **Verificar se o Node.js está realmente rodando:**
   ```bash
   curl http://localhost:3000
   # ou
   curl http://localhost:8083
   ```

2. **Se funcionar localmente mas não via nginx:**
   - Verificar configuração do nginx
   - Verificar se há algum proxy intermediário
   - Verificar logs do nginx

3. **Verificar variáveis de ambiente:**
   ```bash
   cat backend/.env
   # Verificar se NODE_ENV=production está configurado
   ```

---

## ✅ Após corrigir

1. Testar acesso: `https://cargas.integrabrasil.com:8080/dashboard.html`
2. Verificar logs: `pm2 logs` ou `tail -f /var/log/nginx/error.log`
3. Se funcionar, está resolvido! ✅
