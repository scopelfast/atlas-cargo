# Atualizar Arquivo .env

## ⚠️ IMPORTANTE: Remoção do WaboxApp e ngrok

O sistema não utiliza mais:
- ❌ **WaboxApp** - Removido completamente
- ❌ **ngrok** - Não será mais usado

## 📝 Configuração do .env

Atualize o arquivo `backend/.env` com as seguintes configurações:

```env
PORT=3000

DB_SERVER=200.98.128.159
DB_PORT=35987
DB_DATABASE=ATLAS_CARGO_PRD
DB_USER=sa
DB_PASSWORD=!ntegr@SQL2014

JWT_SECRET=ChaveSecreta_Segura_AtlasCargo_2026!

PUBLIC_URL=http://cargas.integrabrasil.com:8083

# Opcional: transcrição de áudio no chat (Whisper). Se não definir, áudio é enviado sem transcrição.
# OPENAI_API_KEY=sk-...
```

## 🗑️ Remover do .env

Remova completamente estas seções:

```env
# REMOVER ESTA SEÇÃO COMPLETA:
# ============================================================================
# Configuracoes para Envio Automatico de WhatsApp via Waboxapp
# ============================================================================
WABOXAPP_TOKEN=...
WABOXAPP_UID=...
WABOXAPP_ENABLED=...
```

## ✅ Após atualizar

1. Reinicie o servidor: `npm run dev`
2. Verifique se não há erros no console
3. Teste o sistema normalmente

## 📌 Nota

O arquivo `.env` não está versionado no Git por questões de segurança. Você precisa atualizá-lo manualmente em cada ambiente (desenvolvimento e produção).

