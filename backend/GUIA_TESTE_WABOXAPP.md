# 🧪 Guia de Teste - WaboxApp

**Versão:** 1.2.0  
**Última atualização:** 2025-11-28

---

## ✅ Status do Teste Atual

Baseado nos logs do seu teste:

- ✅ **API WaboxApp respondeu com sucesso** (Status 200)
- ✅ **Token e UID configurados corretamente**
- ✅ **Número formatado corretamente:** `5541999598887`
- ✅ **Mensagem preparada:** 846 caracteres
- ✅ **ID da mensagem gerado:** `ce4b2502c19bf59d69ec2cf31f5e5dba`

---

## 🔍 Como Verificar se a Mensagem Foi Entregue

### 1. Verificação Imediata

**No WhatsApp do destinatário:**
- Verifique se a mensagem chegou no número `(41) 99959-8887`
- A mensagem deve aparecer como enviada pelo número conectado ao WaboxApp (`554198371769`)

### 2. Verificação no Painel WaboxApp

1. **Acesse:** https://www.waboxapp.com/
2. **Faça login** no dashboard
3. **Vá em "Desenvolvedores" ou "API"**
4. **Procure por:**
   - Status da conexão do WhatsApp (deve estar verde/conectado)
   - Histórico de mensagens enviadas
   - Logs de envio
   - Status de entrega (se disponível)

### 3. Verificação no Sistema

**Endpoint de Status:**
```bash
GET /api/convocacoes/status-mensagens
```

**Verificar logs no banco de dados:**
```sql
SELECT TOP 10 
  IDLOG,
  IDCONVOCACAO,
  NRCELULAR_DESTINO,
  TEXTO_ENVIADO,
  STATUS_ENVIO,
  RESPOSTA_API,
  DHENVIO,
  OBSERV
FROM [dbo].[LOG_ENVIO_WHATSAPP]
ORDER BY DHENVIO DESC
```

---

## ⚠️ Possíveis Problemas e Soluções

### Problema 1: API retorna sucesso mas mensagem não chega

**Causas possíveis:**
- WhatsApp não está conectado no painel WaboxApp
- Número de destino não tem WhatsApp instalado
- Número bloqueou o remetente
- Créditos insuficientes na conta

**Solução:**
1. Verifique no painel WaboxApp se o WhatsApp está conectado (status verde)
2. Teste enviar manualmente pelo painel para o mesmo número
3. Verifique se o número de destino tem WhatsApp ativo
4. Verifique créditos disponíveis

### Problema 2: Erro na API

**Se a API retornar erro:**
- Verifique os logs do servidor
- Verifique se o Token e UID estão corretos
- Verifique se o número está no formato correto (55 + DDD + número)
- Verifique se há créditos disponíveis

### Problema 3: Mensagem chega mas está truncada

**Causa:**
- Limite de caracteres do WaboxApp (geralmente 4096 caracteres)

**Solução:**
- Nossa mensagem tem 846 caracteres, está dentro do limite
- Se precisar enviar mensagens maiores, considere dividir em múltiplas mensagens

---

## 📊 Interpretação dos Logs

### Logs de Sucesso

```
[WABOXAPP] Status HTTP: 200
[WABOXAPP] Resposta completa da API: { "success": true, "custom_uid": "..." }
[WABOXAPP] ✅ API retornou sucesso!
```

**Significado:**
- ✅ A API do WaboxApp recebeu a requisição
- ✅ A requisição foi processada com sucesso
- ⚠️ **MAS** isso não garante que a mensagem foi entregue ao WhatsApp

### Logs de Aviso

```
[WABOXAPP] ⚠️ Não é possível verificar status da conexão via API.
[WABOXAPP] ⚠️ Verifique manualmente no painel do WaboxApp se o número está conectado.
```

**Significado:**
- O sistema não consegue verificar automaticamente se o WhatsApp está conectado
- Você precisa verificar manualmente no painel

---

## 🧪 Teste Passo a Passo

### Teste 1: Verificar Configuração

1. **Acesse:** `http://localhost:3000/api/convocacoes/verificar-waboxapp`
2. **Deve retornar:**
   ```json
   {
     "configurado": true,
     "message": "WaboxApp está configurado e pronto para uso."
   }
   ```

### Teste 2: Enviar Mensagem de Teste

1. **No módulo "Gerenciar Viagens"**
2. **Abra a aba "Convocações"**
3. **Selecione uma convocação**
4. **Clique em "📱 Enviar via WhatsApp"**
5. **Escolha "🚀 Enviar Automaticamente"**
6. **Aguarde o resultado**

### Teste 3: Verificar Entrega

1. **Verifique no WhatsApp do destinatário**
2. **Verifique no painel WaboxApp**
3. **Verifique os logs no banco de dados**

---

## 📝 Checklist de Verificação

Antes de testar, verifique:

- [ ] WaboxApp está configurado no `.env`
  - [ ] `WABOXAPP_ENABLED=true`
  - [ ] `WABOXAPP_TOKEN` preenchido
  - [ ] `WABOXAPP_UID` preenchido
- [ ] WhatsApp está conectado no painel WaboxApp
  - [ ] Status verde/conectado
  - [ ] QR Code escaneado recentemente
- [ ] Número de destino tem WhatsApp
  - [ ] Número válido
  - [ ] WhatsApp instalado e ativo
- [ ] Créditos disponíveis
  - [ ] Verificar no painel WaboxApp
  - [ ] Plano ativo

---

## 🔧 Troubleshooting

### Se a mensagem não chegar:

1. **Teste manual no painel WaboxApp:**
   - Acesse o painel
   - Vá em "Desenvolvedores" ou "API"
   - Envie uma mensagem de teste manualmente
   - Se funcionar manualmente, o problema pode ser na formatação do número ou no texto

2. **Verifique o número formatado:**
   - Deve estar no formato: `55 + DDD (2 dígitos) + número (8 ou 9 dígitos)`
   - Exemplo correto: `5541999598887` (13 dígitos)
   - Exemplo incorreto: `41999598887` (11 dígitos, falta o 55)

3. **Verifique o texto da mensagem:**
   - Não deve ter caracteres especiais problemáticos
   - Deve estar em UTF-8
   - Tamanho dentro do limite (geralmente 4096 caracteres)

4. **Verifique os logs do servidor:**
   - Procure por erros específicos
   - Verifique a resposta completa da API
   - Verifique se há tentativas de retry

5. **Contate o suporte do WaboxApp:**
   - Se o teste manual também não funcionar
   - Forneça o `custom_uid` da mensagem
   - Forneça os logs completos

---

## 📊 Monitoramento

### Verificar Status de Mensagens

**Endpoint:**
```
GET /api/convocacoes/status-mensagens
```

**Resposta:**
```json
{
  "tabelaExiste": true,
  "mensagensEnviadas": 1,
  "mensagensSucesso": 1,
  "mensagensErro": 0,
  "limiteGratuito": 100,
  "mensagensRestantes": 99,
  "porcentagemUsada": 1.00,
  "periodo": {
    "inicio": "2025-11-01",
    "fim": "2025-11-30",
    "mes": "novembro de 2025"
  },
  "alerta": null
}
```

### Verificar Logs no Banco

```sql
-- Últimas 10 mensagens enviadas
SELECT TOP 10 
  IDLOG,
  IDCONVOCACAO,
  NRCELULAR_DESTINO,
  STATUS_ENVIO,
  RESPOSTA_API,
  DHENVIO,
  OBSERV
FROM [dbo].[LOG_ENVIO_WHATSAPP]
ORDER BY DHENVIO DESC

-- Mensagens com erro
SELECT 
  IDLOG,
  IDCONVOCACAO,
  NRCELULAR_DESTINO,
  STATUS_ENVIO,
  RESPOSTA_API,
  OBSERV,
  DHENVIO
FROM [dbo].[LOG_ENVIO_WHATSAPP]
WHERE STATUS_ENVIO = 'ERRO'
ORDER BY DHENVIO DESC
```

---

## ✅ Próximos Passos Após o Teste

1. **Se a mensagem chegou:**
   - ✅ Sistema funcionando corretamente
   - ✅ Continue usando o envio automático
   - ✅ Monitore o uso através do endpoint de status

2. **Se a mensagem não chegou:**
   - ⚠️ Verifique o checklist acima
   - ⚠️ Teste manualmente no painel WaboxApp
   - ⚠️ Verifique os logs detalhados
   - ⚠️ Contate o suporte do WaboxApp se necessário

---

## 📞 Suporte

### Suporte WaboxApp
- **Email:** support@waboxapp.com
- **Dashboard:** https://www.waboxapp.com/
- **Documentação:** https://www.waboxapp.com/api

### Informações para o Suporte
Quando contatar o suporte, forneça:
- `custom_uid` da mensagem: `ce4b2502c19bf59d69ec2cf31f5e5dba`
- Número de destino: `5541999598887`
- Número remetente (UID): `554198371769`
- Data/hora do envio
- Logs completos do servidor

---

**Mantido por:** Equipe DivulgaCarga  
**Versão:** 1.2.0

