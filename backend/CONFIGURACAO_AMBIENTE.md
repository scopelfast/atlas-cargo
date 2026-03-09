# ⚙️ Configuração de Ambiente - Atlas Cargo

**Versão:** 1.2.0  
**Última atualização:** 2026-11-28

---

## 📋 Variáveis de Ambiente

Crie um arquivo `.env` no diretório `backend/` com as seguintes variáveis:

### Banco de Dados SQL Server

```env
DB_SERVER=localhost
DB_DATABASE=atlas_cargo_prd
DB_USER=sa
DB_PASSWORD=sua-senha-aqui
DB_PORT=1433
```

### Autenticação JWT

```env
JWT_SECRET=sua-chave-secreta-jwt-aqui
```

**⚠️ IMPORTANTE:** Gere uma chave secreta forte (mínimo 32 caracteres)

**Como gerar:**
```bash
# Linux/Mac
openssl rand -base64 32

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### URL Pública

```env
PUBLIC_URL=http://localhost:3000
```

**Configurações por ambiente:**

- **Produção:**
  ```env
  PUBLIC_URL=https://seu-dominio.com.br
  ```

- **Desenvolvimento (ngrok):**
  ```env
  PUBLIC_URL=https://seu-tunnel.ngrok-free.dev
  ```

- **Desenvolvimento (IP local - mesma rede Wi-Fi):**
  ```env
  PUBLIC_URL=http://192.168.1.100:3000
  ```

### Porta do Servidor

```env
PORT=3000
```

### WaboxApp (Opcional)

```env
WABOXAPP_ENABLED=false
WABOXAPP_TOKEN=
WABOXAPP_UID=
```

Configure apenas se desejar envio automático via WaboxApp.  
Para mais informações, veja: `INSTRUCOES_WABOXAPP.md`

### Ambiente

```env
NODE_ENV=development
```

Valores: `development` | `production`

---

## 📝 Arquivo .env Completo

```env
# Banco de Dados SQL Server
DB_SERVER=localhost
DB_DATABASE=atlas_cargo_prd
DB_USER=sa
DB_PASSWORD=sua-senha-aqui
DB_PORT=1433

# Autenticação JWT
JWT_SECRET=sua-chave-secreta-jwt-aqui

# URL Pública (para links de convocação)
PUBLIC_URL=http://localhost:3000

# Porta do Servidor
PORT=3000

# WaboxApp (Opcional)
WABOXAPP_ENABLED=false
WABOXAPP_TOKEN=
WABOXAPP_UID=

# Ambiente
NODE_ENV=development
```

---

## ⚠️ Segurança

1. **NUNCA commite o arquivo `.env`** no GitHub
2. **NUNCA compartilhe** suas credenciais
3. **Use senhas fortes** para JWT_SECRET
4. **Mantenha o `.env`** no `.gitignore`

---

## 🔍 Validação

O sistema valida automaticamente as variáveis obrigatórias ao iniciar:

- `DB_SERVER`
- `DB_DATABASE`
- `DB_USER`
- `DB_PASSWORD`
- `JWT_SECRET`

Se alguma estiver faltando, o servidor não iniciará e mostrará um erro.

---

## 📚 Documentação Relacionada

- [README.md](../README.md) - Documentação principal
- [README_URL_PUBLICA.md](README_URL_PUBLICA.md) - Configuração de URL pública
- [GUIA_NGROK.md](GUIA_NGROK.md) - Guia completo do ngrok
- [INSTRUCOES_WABOXAPP.md](INSTRUCOES_WABOXAPP.md) - Instruções do WaboxApp

---

**Mantido por:** Equipe Atlas Cargo  
**Versão:** 1.2.0

