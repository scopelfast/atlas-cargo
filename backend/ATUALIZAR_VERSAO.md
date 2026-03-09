# 🔄 Como Atualizar a Versão do Sistema (Cache Busting)

## 📋 Quando Atualizar a Versão?

Atualize a versão **SEMPRE** que fizer alterações em:
- ✅ Arquivos JavaScript (`.js`)
- ✅ Arquivos CSS (`.css`)
- ✅ Arquivos HTML dos módulos
- ✅ Qualquer recurso estático que os usuários precisam ver atualizado

## 🎯 Como Atualizar a Versão

### Passo 1: Editar o arquivo `version.js`

Abra o arquivo: `backend/public/js/version.js`

```javascript
// Antes:
window.APP_VERSION = '20260102-1500'; // Versão antiga

// Depois:
window.APP_VERSION = '20260102-1600'; // Nova versão
```

### Passo 2: Formato da Versão

Use o formato: `YYYYMMDD-HHMM` (Data + Hora)

Exemplos:
- `20260102-1500` = 02 de Janeiro de 2026 às 15:00
- `20260102-1630` = 02 de Janeiro de 2026 às 16:30
- `20260115-0900` = 15 de Janeiro de 2026 às 09:00

**Ou use um número sequencial simples:**
- `v1.0.0`
- `v1.0.1`
- `v1.1.0`
- `v2.0.0`

### Passo 3: Salvar e Publicar

1. Salve o arquivo `version.js`
2. Faça commit das alterações
3. Publique no servidor
4. **Pronto!** Os usuários verão a versão atualizada automaticamente

## 🚀 Exemplo Completo

```javascript
// backend/public/js/version.js

// Atualizar este número/data sempre que fizer uma nova publicação
window.APP_VERSION = '20260102-1600'; // ← ATUALIZAR AQUI!

// Resto do código não precisa mexer...
```

## ✅ Verificar se Funcionou

1. Abra o navegador
2. Pressione `F12` para abrir o Console
3. Procure a mensagem: `[Sistema] Versão: 20260102-1600`
4. Se aparecer a nova versão, está funcionando! ✅

## 📝 Dica Extra

Adicione a versão no commit do Git:

```bash
git commit -m "Atualização v20260102-1600 - Corrigido cache"
git push
```

Assim você sabe exatamente qual versão está em cada commit.

## 🔧 Solução de Problemas

### Usuário ainda vê versão antiga?

Peça para ele fazer:
1. `Ctrl + F5` (ou `Cmd + Shift + R` no Mac)
2. Ou limpar o cache do navegador
3. Ou abrir uma aba anônima

### Não quer ver a mensagem no console?

No arquivo `version.js`, comente a linha:

```javascript
// console.log(`[Sistema] Versão: ${window.APP_VERSION}`);
```

---

**🎉 Pronto! Agora você tem controle total sobre o cache do sistema!**

