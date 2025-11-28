# 🚀 Guia Rápido: Iniciar ngrok para Convocações

## ❌ Problema Atual
O erro `ERR_NGROK_3200` indica que o túnel ngrok está **offline**. O endpoint `laurence-boisterous-almost.ngrok-free.dev` não está mais ativo.

## ✅ Solução: Reiniciar o ngrok

### Passo 1: Verificar se o servidor Node.js está rodando

O servidor precisa estar rodando na porta 3000 antes de iniciar o ngrok.

**Verificar:**
```powershell
netstat -ano | findstr :3000
```

Se não houver saída, inicie o servidor:
```powershell
cd backend
npm run dev
```

Ou se estiver usando node diretamente:
```powershell
cd backend
node server.js
```

### Passo 2: Iniciar o ngrok

Abra um **novo terminal** (mantenha o servidor Node.js rodando no terminal anterior) e execute:

```powershell
ngrok http 3000
```

**Se o ngrok não estiver instalado:**
1. Baixe em: https://ngrok.com/download
2. Extraia o arquivo `ngrok.exe`
3. Adicione ao PATH ou execute diretamente: `C:\caminho\para\ngrok.exe http 3000`

### Passo 3: Copiar a nova URL do ngrok

Quando o ngrok iniciar, você verá algo como:

```
Forwarding  https://abc123-def456.ngrok-free.dev -> http://localhost:3000
```

**Copie a URL HTTPS** (ex: `https://abc123-def456.ngrok-free.dev`)

### Passo 4: Atualizar o arquivo .env

Edite o arquivo `backend/.env` e atualize a linha `PUBLIC_URL`:

```env
PUBLIC_URL=https://abc123-def456.ngrok-free.dev
```

**Substitua** `abc123-def456.ngrok-free.dev` pela URL que o ngrok forneceu.

### Passo 5: Reiniciar o servidor Node.js

Após atualizar o `.env`, reinicie o servidor Node.js para carregar a nova URL:

1. Pare o servidor (Ctrl+C)
2. Inicie novamente:
   ```powershell
   npm run dev
   ```

### Passo 6: Testar

Acesse a URL do ngrok no navegador:
```
https://sua-url-ngrok.ngrok-free.dev/convocacao/38
```

**Nota:** Na primeira vez, o ngrok pode mostrar uma página de aviso. Clique em "Visit Site" para continuar.

---

## 📝 Script Automatizado (Opcional)

Para facilitar, você pode criar um script PowerShell `iniciar-ngrok.ps1`:

```powershell
# Verificar se o servidor está rodando
$porta = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if (-not $porta) {
    Write-Host "❌ Servidor não está rodando na porta 3000!"
    Write-Host "Execute primeiro: npm run dev"
    exit
}

Write-Host "✅ Servidor detectado na porta 3000"
Write-Host "🚀 Iniciando ngrok..."
ngrok http 3000
```

---

## ⚠️ Importante

1. **Mantenha o ngrok rodando:** O túnel ngrok precisa estar ativo enquanto você usa o sistema
2. **URL muda a cada reinício:** Na versão gratuita, a URL do ngrok muda a cada vez que você reinicia
3. **Atualize o .env:** Sempre atualize o `.env` com a nova URL quando reiniciar o ngrok
4. **Dois terminais:** Mantenha o servidor Node.js em um terminal e o ngrok em outro

---

## 🔧 Troubleshooting

### Erro: "ngrok: command not found"
- Instale o ngrok ou use o caminho completo: `C:\caminho\para\ngrok.exe http 3000`

### Erro: "address already in use"
- Outro processo está usando a porta 3000
- Pare outros servidores ou use outra porta

### Erro: "ERR_NGROK_3200" mesmo após iniciar
- Verifique se a URL no `.env` corresponde à URL exibida pelo ngrok
- Reinicie o servidor Node.js após atualizar o `.env`

### Página de aviso do ngrok
- Isso é normal na primeira vez
- Clique em "Visit Site" para continuar
- Para evitar, use uma conta ngrok paga ou configure um domínio personalizado

---

## 📞 Suporte

Se o problema persistir:
1. Verifique se o servidor Node.js está rodando
2. Verifique se o ngrok está rodando
3. Verifique se a URL no `.env` está correta
4. Reinicie ambos os serviços

