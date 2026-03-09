# 📋 Guia de Testes - Módulo Chat

## 🎯 Objetivo
Este guia fornece instruções passo a passo para testar o módulo Chat do sistema Atlas Cargo.

---

## 📍 Como Acessar

### ⚠️ IMPORTANTE: URL Correta
O módulo Chat deve ser acessado através do **menu do sistema administrativo**, não diretamente pela URL do motorista.

**URL Correta:**
```
http://localhost:3000/dashboard.html
```
Depois, clique no menu **"4.1.Chat"**

**URL Incorreta (NÃO usar):**
```
http://localhost:3000/motorista/pages/chat.html  ❌
```
Esta é a página do motorista, não o módulo admin.

---

## ✅ Pré-requisitos

1. **Servidor rodando:**
   ```bash
   cd backend
   npm start
   # ou
   npm run dev
   ```

2. **Banco de dados:**
   - Tabela `CONVERSAS` deve existir
   - Tabela `MESSAGES` deve existir
   - Dados de teste (opcional, mas recomendado)

3. **Autenticação:**
   - Usuário logado no sistema
   - Permissão para acessar o módulo Chat

---

## 🧪 Testes Básicos

### Teste 1: Carregar Módulo Chat

**Passos:**
1. Acesse `http://localhost:3000/dashboard.html`
2. Faça login no sistema
3. Clique no menu **"4.1.Chat"**

**Resultado Esperado:**
- ✅ Módulo carrega sem erros
- ✅ Estatísticas aparecem (Conversas, Não Lidas, Total)
- ✅ Lista de conversas aparece à esquerda
- ✅ Área de chat vazia aparece à direita com mensagem "Selecione uma conversa"

**Possíveis Problemas:**
- ❌ Erro 404: Verificar se rotas estão registradas em `app.js`
- ❌ Erro 401: Verificar autenticação
- ❌ Lista vazia: Normal se não houver conversas no banco

---

### Teste 2: Listar Conversas

**Passos:**
1. Acesse o módulo Chat
2. Aguarde o carregamento das conversas

**Resultado Esperado:**
- ✅ Lista de conversas aparece à esquerda
- ✅ Cada conversa mostra:
  - Nome do motorista ou "Viagem [ID]"
  - Preview da última mensagem
  - Hora da última mensagem
  - Badge de não lidas (se houver)
- ✅ Conversas ordenadas por última mensagem (mais recente primeiro)

**Se não houver conversas:**
- ✅ Mensagem "Nenhuma conversa encontrada" aparece
- ✅ Ícone de mensagem vazia

---

### Teste 3: Selecionar Conversa

**Passos:**
1. Clique em uma conversa da lista
2. Aguarde o carregamento das mensagens

**Resultado Esperado:**
- ✅ Conversa fica destacada (azul)
- ✅ Área de chat à direita é exibida
- ✅ Informações da conversa aparecem no topo:
  - Nome do motorista/viagem
  - ID da viagem
  - Nome do motorista
- ✅ Mensagens são carregadas e exibidas
- ✅ Scroll automático para última mensagem

**Possíveis Problemas:**
- ❌ Erro ao carregar mensagens: Verificar console do navegador
- ❌ Mensagens não aparecem: Verificar se há mensagens no banco para essa conversa

---

### Teste 4: Enviar Mensagem

**Passos:**
1. Selecione uma conversa
2. Digite uma mensagem no campo inferior
3. Pressione **Enter** ou clique em **Enviar**

**Resultado Esperado:**
- ✅ Mensagem aparece imediatamente no chat (à direita, azul)
- ✅ Campo de input é limpo
- ✅ Mensagem é salva no banco de dados
- ✅ Lista de conversas é atualizada (última mensagem)
- ✅ Conversa sobe para o topo da lista

**Possíveis Problemas:**
- ❌ Mensagem não envia: Verificar console do navegador
- ❌ Erro 400: Verificar se `idviagem` e `idConversa` estão corretos
- ❌ Mensagem não aparece: Verificar WebSocket

---

### Teste 5: WebSocket (Tempo Real)

**Passos:**
1. Abra o módulo Chat em **duas abas/janelas diferentes**
2. Na primeira aba, selecione uma conversa
3. Na segunda aba, selecione a mesma conversa
4. Envie uma mensagem na primeira aba

**Resultado Esperado:**
- ✅ Mensagem aparece instantaneamente na segunda aba
- ✅ Não precisa recarregar a página
- ✅ Contador de não lidas é atualizado automaticamente

**Verificar Console:**
- ✅ Mensagem: `✅ WebSocket Chat conectado: [socket-id]`
- ✅ Mensagem: `📨 Nova mensagem recebida: [mensagem]`

**Possíveis Problemas:**
- ❌ WebSocket não conecta: Verificar se Socket.io está servido em `/socket.io/socket.io.js`
- ❌ Mensagens não aparecem em tempo real: Verificar eventos WebSocket no servidor

---

### Teste 6: Buscar Conversas

**Passos:**
1. Digite um termo na barra de busca (ex: nome do motorista)
2. Aguarde os resultados

**Resultado Esperado:**
- ✅ Lista de conversas é filtrada
- ✅ Apenas conversas que contêm o termo aparecem
- ✅ Busca funciona em:
  - Nome do motorista
  - Última mensagem
  - ID da viagem

**Limpar busca:**
- ✅ Apague o termo da busca
- ✅ Lista completa volta a aparecer

---

### Teste 7: Marcar como Lidas

**Passos:**
1. Selecione uma conversa com mensagens não lidas
2. Aguarde alguns segundos

**Resultado Esperado:**
- ✅ Badge de não lidas desaparece
- ✅ Conversa deixa de estar destacada (vermelho)
- ✅ Contador de não lidas nas estatísticas diminui
- ✅ Badge no menu é atualizado

---

### Teste 8: Estatísticas

**Passos:**
1. Observe os cards de estatísticas no topo

**Resultado Esperado:**
- ✅ **Conversas:** Total de conversas ativas
- ✅ **Não Lidas:** Total de mensagens não lidas
- ✅ **Total Mensagens:** Total geral de mensagens

**Atualização:**
- ✅ Estatísticas são atualizadas automaticamente a cada 30 segundos
- ✅ Clique em "Atualizar" para forçar atualização

---

## 🔍 Verificações Técnicas

### Console do Navegador

Abra o **Console do Desenvolvedor** (F12) e verifique:

**Mensagens Esperadas:**
```
💬 Módulo Chat inicializando...
✅ WebSocket Chat conectado: [socket-id]
✅ Conversas carregadas: [número]
```

**Erros Comuns:**
- ❌ `Erro 404: Not Found` → Verificar rotas em `app.js`
- ❌ `Erro 401: Unauthorized` → Verificar autenticação
- ❌ `Socket.io não encontrado` → Verificar se Socket.io está servido

---

### Verificar Socket.io

**Teste Manual:**
1. Abra: `http://localhost:3000/socket.io/socket.io.js`
2. Deve retornar o código JavaScript do Socket.io (não erro 404)

**Se retornar 404:**
- Verificar se `server.js` está rodando
- Verificar se Socket.io está instalado: `npm list socket.io`

---

### Verificar Banco de Dados

**Consultar Conversas:**
```sql
SELECT TOP 10 * FROM [dbo].[CONVERSAS] ORDER BY DH_ULTIMA_MENSAGEM DESC;
```

**Consultar Mensagens:**
```sql
SELECT TOP 10 * FROM [dbo].[MESSAGES] ORDER BY CREATED_AT DESC;
```

**Se não houver dados:**
- Criar conversas de teste manualmente
- Ou usar o app do motorista para enviar mensagens

---

## 📝 Dados de Teste

### Criar Conversa Manualmente

```sql
-- Criar conversa de teste
INSERT INTO [dbo].[CONVERSAS] (
    TIPO, ID_VIAGEM, ID_MOTORISTA, ID_CRIADOR, 
    MENSAGENS_NAO_LIDAS, DH_CRIACAO
)
VALUES (
    'VIAGEM', 
    12345,  -- ID da viagem (ajustar)
    9436,   -- ID do motorista (ajustar)
    1,      -- ID do criador (ajustar)
    0, 
    SYSUTCDATETIME()
);

-- Obter ID da conversa criada
SELECT SCOPE_IDENTITY() AS ID_CONVERSA;
```

### Criar Mensagens de Teste

```sql
-- Criar mensagem de teste
INSERT INTO [dbo].[MESSAGES] (
    IDVIAGEM, ID_CONVERSA, SENDER_TYPE, SENDER_ID, 
    SENDER_NAME, CONTENT, TIPO, 
    READ_BY_SENDER, READ_BY_RECEIVER, SYNCED
)
VALUES (
    12345,           -- ID da viagem
    1,               -- ID da conversa (ajustar)
    'MOTORISTA',     -- Tipo do remetente
    9436,            -- ID do remetente (ajustar)
    'Motorista Teste', -- Nome do remetente
    'Olá, esta é uma mensagem de teste!', -- Conteúdo
    'TEXTO',
    1,  -- Remetente já leu
    0,  -- Destinatário ainda não leu
    1   -- Sincronizado
);
```

---

## 🐛 Troubleshooting

### Problema: "Erro ao carregar conversas"

**Soluções:**
1. Verificar se rotas estão registradas:
   ```javascript
   // Em backend/app.js deve ter:
   app.use('/api/chat', messageRoutes);
   ```

2. Verificar autenticação:
   - Token JWT válido no localStorage
   - Usuário tem permissão para acessar Chat

3. Verificar banco de dados:
   - Tabelas `CONVERSAS` e `MESSAGES` existem
   - Conexão com banco está funcionando

---

### Problema: "Socket.io não encontrado"

**Soluções:**
1. Verificar se Socket.io está instalado:
   ```bash
   cd backend
   npm list socket.io
   ```

2. Verificar se servidor está rodando:
   - `server.js` deve estar ativo
   - Socket.io é servido automaticamente em `/socket.io/socket.io.js`

3. Verificar CSP (Content Security Policy):
   - Não deve tentar carregar de CDN (já corrigido)
   - Socket.io deve vir do servidor local

---

### Problema: "Mensagens não aparecem em tempo real"

**Soluções:**
1. Verificar WebSocket:
   - Console deve mostrar: `✅ WebSocket Chat conectado`
   - Verificar se eventos estão sendo emitidos no servidor

2. Verificar eventos:
   - Servidor deve emitir: `nova-mensagem`
   - Cliente deve escutar: `socket.on('nova-mensagem')`

3. Verificar salas:
   - Cliente deve entrar na sala: `join-viagem` e `join-conversa`
   - Servidor deve emitir para a sala correta

---

## ✅ Checklist de Testes

- [ ] Módulo carrega sem erros
- [ ] Lista de conversas aparece
- [ ] Estatísticas são exibidas corretamente
- [ ] Selecionar conversa funciona
- [ ] Mensagens são carregadas
- [ ] Enviar mensagem funciona
- [ ] WebSocket conecta
- [ ] Mensagens aparecem em tempo real
- [ ] Busca funciona
- [ ] Marcar como lidas funciona
- [ ] Contador no menu é atualizado
- [ ] Responsivo funciona (mobile)

---

## 📞 Suporte

Se encontrar problemas:
1. Verificar console do navegador (F12)
2. Verificar logs do servidor
3. Verificar banco de dados
4. Consultar documentação técnica em `PLANO_IMPLEMENTACAO_MODULOS_ALERTAS_CHAT_SOS_RANKING.md`

---

**Última atualização:** 2026-01-18
**Versão do módulo:** 2.0
