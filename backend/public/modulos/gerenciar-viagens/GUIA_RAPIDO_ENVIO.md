# 🚀 Guia Rápido - Envio de Convocações

## 📱 Como Enviar Convocações

### Opção 1: Envio Automático (WaboxApp) ⚡

**Quando usar:**
- Você tem WaboxApp configurado
- Quer enviar várias mensagens rapidamente
- Não precisa personalizar cada mensagem

**Como fazer:**
1. Crie as convocações normalmente
2. No modal de links, clique em **"🤖 Enviar Automaticamente"**
3. Confirme o envio
4. Pronto! Mensagens enviadas automaticamente

**Vantagens:**
- ⚡ Envio instantâneo
- 🤖 Totalmente automático
- 📊 Log completo de envios
- ⏱️ Economiza tempo

---

### Opção 2: Envio Manual 👤

**Quando usar:**
- Quer revisar cada mensagem antes de enviar
- Precisa personalizar alguma mensagem
- WaboxApp não está configurado

**Como fazer:**
1. Crie as convocações normalmente
2. No modal de links, clique em **"👤 Enviar Manualmente"**
3. WhatsApp abre com mensagem pré-formatada
4. Revise e clique em "Enviar"

**Vantagens:**
- ✏️ Pode personalizar antes de enviar
- 👀 Revisa cada mensagem
- 💰 Zero custo
- 🔒 Controle total

---

## ✅ Como Confirmar Convocação

### Passo a Passo:

1. **Motorista aceita a convocação**
   - Status muda para "ACEITA"

2. **Você confirma o motorista**
   - Aba "Convocações" → Botão "✅ Confirmar"

3. **Escolha o método de envio:**
   - **🤖 Automático:** Mensagem enviada automaticamente
   - **👤 Manual:** WhatsApp abre para você enviar

4. **Pronto!**
   - Mensagem de confirmação enviada ao motorista

---

## 🎯 Qual Método Escolher?

### Use Automático se:
- ✅ WaboxApp está configurado
- ✅ Quer agilidade
- ✅ Mensagem padrão está OK
- ✅ Múltiplos envios

### Use Manual se:
- ✅ Quer revisar antes
- ✅ Precisa personalizar
- ✅ WaboxApp não está configurado
- ✅ Poucos envios

---

## ⚙️ Configurar WaboxApp

1. **Criar conta:** https://www.waboxapp.com/
2. **Conectar WhatsApp:** Escanear QR Code
3. **Copiar credenciais:** Token e UID
4. **Configurar .env:**
   ```env
   WABOXAPP_ENABLED=true
   WABOXAPP_TOKEN=seu_token
   WABOXAPP_UID=seu_uid
   ```
5. **Reiniciar servidor**

---

## 💡 Dicas

- **Primeira vez:** Use Manual para ver como ficam as mensagens
- **Envio em massa:** Use Automático para agilizar
- **Personalização:** Use Manual quando precisar ajustar
- **Monitoramento:** Verifique uso via `/api/convocacoes/status-mensagens`

---

## ❓ Problemas Comuns

### WaboxApp não aparece?
- Verifique se `WABOXAPP_ENABLED=true` no `.env`
- Verifique se Token e UID estão preenchidos
- Reinicie o servidor

### Mensagem não foi enviada?
- Verifique logs do servidor
- Verifique se não excedeu limite de mensagens
- Use método Manual como alternativa

### Link não funciona?
- Verifique se `PUBLIC_URL` está configurado
- Para desenvolvimento, use ngrok

---

## 📞 Suporte

Para mais informações, consulte:
- `DOCUMENTACAO_MENSAGENS_CONVOCACOES.md`
- `INSTRUCOES_WABOXAPP.md`
- Manual do Sistema (botão 📚 no topo)

