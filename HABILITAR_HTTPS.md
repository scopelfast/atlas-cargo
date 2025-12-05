# Como Habilitar HTTPS no Servidor Node.js

## Problema
O navegador bloqueia acesso ao GPS/Geolocalização quando a página está em HTTP.

## Solução 1: HTTPS com Certificado Auto-Assinado (Desenvolvimento)

### 1. Gerar Certificado SSL Auto-Assinado

No PowerShell (como Administrador):

```powershell
# Criar pasta para certificados
mkdir C:\ssl
cd C:\ssl

# Gerar certificado (válido por 365 dias)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Preencher informações:
# Country Name: BR
# State: PR
# Locality: Curitiba
# Organization Name: SysScopel
# Common Name: 192.168.1.173 (SEU IP)
```

### 2. Atualizar server.js

```javascript
const https = require('https');
const fs = require('fs');

// Carregar certificados SSL
const sslOptions = {
  key: fs.readFileSync('C:/ssl/key.pem'),
  cert: fs.readFileSync('C:/ssl/cert.pem')
};

// Criar servidor HTTPS
https.createServer(sslOptions, app).listen(3443, () => {
  console.log('✅ Servidor HTTPS rodando na porta 3443');
  console.log('🔒 Acesse: https://192.168.1.173:3443');
});

// Manter HTTP na porta 3000 (opcional)
app.listen(3000, () => {
  console.log('✅ Servidor HTTP rodando na porta 3000');
});
```

### 3. Acessar via HTTPS

No celular, acesse:
```
https://192.168.1.173:3443/motorista/pages/dashboard.html
```

**IMPORTANTE:** O navegador vai mostrar um aviso de "Não seguro" porque o certificado é auto-assinado. Clique em:
- Chrome: "Avançado" → "Continuar mesmo assim"
- Firefox: "Avançado" → "Aceitar o risco"

---

## Solução 2: Permitir HTTP no Chrome (Somente para Testes)

### Android Chrome:

1. Acesse no celular:
```
chrome://flags/#unsafely-treat-insecure-origin-as-secure
```

2. Adicione o IP do servidor:
```
http://192.168.1.173:3000
```

3. Ativar: **Enabled**

4. Reiniciar Chrome

### Desktop Chrome:

Iniciar Chrome com flag:
```bash
chrome.exe --unsafely-treat-insecure-origin-as-secure="http://192.168.1.173:3000"
```

---

## Solução 3: Usar ngrok (Túnel HTTPS Temporário)

### 1. Instalar ngrok

```bash
npm install -g ngrok
```

### 2. Criar túnel HTTPS

```bash
ngrok http 3000
```

### 3. Usar URL fornecida

Vai gerar algo como:
```
https://abc123.ngrok.io → http://localhost:3000
```

Acesse no celular:
```
https://abc123.ngrok.io/motorista/pages/dashboard.html
```

✅ **Vantagem:** HTTPS real, sem configuração
❌ **Desvantagem:** URL muda toda vez, grátis tem limite

---

## Solução 4: Produção (Recomendado)

### Usar um domínio real com Let's Encrypt:

1. Ter um domínio (ex: app.sysscopel.com.br)
2. Apontar para o servidor
3. Usar Certbot:

```bash
npm install -g pm2-lets-encrypt
# Configurar automaticamente
```

---

## Resumo das Opções

| Solução | Dificuldade | Segurança | Uso |
|---------|-------------|-----------|-----|
| **HTTPS Auto-Assinado** | Média | Baixa | Desenvolvimento |
| **Chrome Flag** | Fácil | Baixa | Testes apenas |
| **ngrok** | Fácil | Alta | Desenvolvimento |
| **Let's Encrypt** | Alta | Alta | Produção |

---

## Recomendação

Para **desenvolvimento/testes rápidos:**
- Use **ngrok** (mais fácil, funciona imediatamente)

Para **produção:**
- Use **domínio + Let's Encrypt** (seguro e profissional)

