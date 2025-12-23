# 🔍 Diagnóstico Erro 502 - Servidor QA

## ⚠️ Problema Reportado

**URL:** `https://beta.integrabrasil.com:8443/cargas/`  
**Erro:** `502 Bad Gateway`

## 📋 O que significa

O erro 502 indica que o **servidor web (Nginx/Apache)** não consegue se comunicar com o **backend Node.js**. Isso pode ser causado por:

1. ❌ Container Docker não está rodando
2. ❌ Backend Node.js não está respondendo
3. ❌ Proxy reverso mal configurado
4. ❌ Porta incorreta na configuração do proxy

---

## ✅ Verificações Necessárias no Servidor QA

### 1. Verificar se o Container Docker está rodando

```bash
# SSH no servidor QA
ssh grafico@192.168.1.220

# Verificar containers
docker ps

# Verificar logs do container
docker logs divulga_carga

# Verificar status
docker ps -a | grep divulga_carga
```

**Se o container não estiver rodando:**
```bash
cd /home/grafico/Documentos/divulgacarga/backend
docker-compose up -d
```

---

### 2. Verificar se o Backend está respondendo

```bash
# Testar localmente no servidor
curl http://localhost:8083
# ou
curl http://localhost:3000
```

**Se não responder:** O backend não está rodando ou está na porta errada.

---

### 3. Verificar configuração do Proxy Reverso

O servidor QA provavelmente usa **Nginx** ou **Apache** como proxy reverso.

#### Nginx:
```bash
# Verificar configuração
cat /etc/nginx/sites-available/beta.integrabrasil.com
# ou
cat /etc/nginx/conf.d/beta.conf

# Verificar logs de erro
tail -f /var/log/nginx/error.log

# Testar configuração
nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

**Configuração esperada (exemplo):**
```nginx
server {
    listen 8443 ssl;
    server_name beta.integrabrasil.com;

    location /cargas/ {
        proxy_pass http://localhost:8083/;  # ← Porta do Docker
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Apache:
```bash
# Verificar configuração
cat /etc/apache2/sites-available/beta.conf

# Verificar logs
tail -f /var/log/apache2/error.log

# Testar configuração
apache2ctl configtest

# Reiniciar Apache
sudo systemctl restart apache2
```

---

### 4. Verificar Portas

```bash
# Verificar portas em uso
netstat -tulpn | grep -E ':(3000|8083|8443)'

# Verificar se a porta 8083 está aberta
sudo lsof -i :8083
```

---

### 5. Reiniciar Tudo

```bash
# Parar containers
cd /home/grafico/Documentos/divulgacarga/backend
docker-compose down

# Iniciar containers
docker-compose up -d

# Verificar logs
docker logs -f divulga_carga

# Reiniciar proxy
sudo systemctl restart nginx  # ou apache2
```

---

## 🔧 Script de Diagnóstico Completo

Execute no servidor QA:

```bash
#!/bin/bash
echo "=== Status dos Containers ==="
docker ps -a | grep divulga_carga

echo ""
echo "=== Logs do Container (últimas 20 linhas) ==="
docker logs --tail 20 divulga_carga

echo ""
echo "=== Portas em uso ==="
netstat -tulpn | grep -E ':(3000|8083|8443)'

echo ""
echo "=== Teste local do backend ==="
curl -I http://localhost:8083 2>&1 | head -5

echo ""
echo "=== Status do Nginx ==="
sudo systemctl status nginx --no-pager | head -10

echo ""
echo "=== Últimos erros do Nginx ==="
sudo tail -10 /var/log/nginx/error.log
```

---

## 📞 Próximos Passos

1. **Acessar o servidor QA via SSH**
2. **Executar o script de diagnóstico acima**
3. **Verificar os logs do container**
4. **Verificar configuração do proxy reverso**
5. **Reiniciar serviços se necessário**

---

## 💡 Solução Rápida (se container estiver parado)

```bash
ssh grafico@192.168.1.220
cd /home/grafico/Documentos/divulgacarga/backend
docker-compose up -d
docker logs -f divulga_carga
```

---

**Data:** 2025-01-23  
**Ambiente:** QA (beta.integrabrasil.com:8443)

