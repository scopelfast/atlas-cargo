# 📱 Guia: Simular Celular no PC para Testar Links de Convocação

## 🚀 Método 1: DevTools do Navegador (Mais Rápido e Fácil)

### Chrome / Edge (Recomendado)

1. **Abra o sistema** no navegador: `http://localhost:3000`

2. **Pressione `F12`** para abrir o DevTools

3. **Ative o modo dispositivo móvel:**
   - Clique no ícone de **dispositivo móvel** na barra de ferramentas (ou)
   - Pressione **`Ctrl + Shift + M`** (Windows/Linux) ou **`Cmd + Shift + M`** (Mac)

4. **Escolha um dispositivo:**
   - No topo, clique no dropdown e escolha:
     - **iPhone 12 Pro** (390x844)
     - **Samsung Galaxy S20** (360x800)
     - **iPad** (768x1024)
     - Ou defina uma resolução customizada

5. **Teste os links:**
   - Acesse: `http://localhost:3000/teste-mobile`
   - Esta página permite testar os links de convocação
   - Ou teste diretamente: `http://localhost:3000/convocacao/6`

### Firefox

1. Pressione **`F12`**
2. Clique no ícone de **dispositivo móvel** na barra de ferramentas
3. Escolha um dispositivo ou defina resolução customizada

### Safari (Mac)

1. Pressione **`Cmd + Option + I`**
2. Clique em **Device Mode**
3. Escolha um dispositivo

---

## 🧪 Método 2: Página de Teste Dedicada

Criei uma página especial para testar os links:

**Acesse:** `http://localhost:3000/teste-mobile`

Esta página permite:
- ✅ Verificar a URL pública configurada
- ✅ Gerar e testar links de convocação
- ✅ Gerar links do WhatsApp
- ✅ Testar tudo como se estivesse no celular

---

## 📲 Método 3: Testar no Celular Real (Recomendado para Validação Final)

### Passo a Passo:

1. **Descubra o IP do seu computador:**
   ```powershell
   # Windows PowerShell
   ipconfig
   ```
   Procure por "IPv4" (exemplo: `192.168.1.100`)

2. **Configure o `.env` na pasta `backend/`:**
   ```env
   PUBLIC_URL=http://192.168.1.100:3000
   ```
   (Substitua pelo IP do seu computador)

3. **Reinicie o servidor Node.js**

4. **Certifique-se de que:**
   - Celular e PC estão na mesma rede Wi-Fi
   - Firewall permite conexões na porta 3000

5. **No celular, acesse:**
   ```
   http://192.168.1.100:3000/convocacao/6
   ```

---

## 🎯 Método 4: Emuladores (Para Testes Avançados)

### Android Studio (Android)

1. Instale o [Android Studio](https://developer.android.com/studio)
2. Crie um AVD (Android Virtual Device)
3. Inicie o emulador
4. Abra o navegador no emulador e acesse o link

### Genymotion (Android - Mais Leve)

1. Baixe o [Genymotion](https://www.genymotion.com/)
2. Crie uma instância Android
3. Configure a rede para acessar o PC
4. Teste os links

---

## ✅ Checklist de Teste

- [ ] Abrir DevTools (F12)
- [ ] Ativar modo dispositivo móvel (Ctrl+Shift+M)
- [ ] Escolher dispositivo (iPhone/Android)
- [ ] Acessar `/teste-mobile` para verificar URL pública
- [ ] Testar link de convocação: `/convocacao/6`
- [ ] Verificar se o layout está responsivo
- [ ] Testar botões de aceitar/recusar
- [ ] Verificar se os links do WhatsApp funcionam

---

## 🔍 Dicas Importantes

1. **URL Pública:** Sempre configure `PUBLIC_URL` no `.env` para links funcionarem no celular real
2. **Responsividade:** Use o modo mobile do DevTools para verificar se o layout está correto
3. **Teste Real:** Sempre teste no celular real antes de enviar para motoristas
4. **Rede:** Certifique-se de que celular e PC estão na mesma rede Wi-Fi

---

## 🐛 Problemas Comuns

### Link não abre no celular
- ✅ Verifique se `PUBLIC_URL` está configurado corretamente
- ✅ Certifique-se de que celular e PC estão na mesma rede
- ✅ Verifique se o firewall permite conexões na porta 3000

### Layout quebrado no mobile
- ✅ Use o DevTools para verificar o viewport
- ✅ Verifique se a meta tag `<meta name="viewport">` está presente
- ✅ Teste em diferentes resoluções

### DevTools não mostra modo mobile
- ✅ Atualize o navegador para a versão mais recente
- ✅ Tente outro navegador (Chrome/Edge recomendado)

---

## 📝 Exemplo de Uso

1. Abra o sistema: `http://localhost:3000`
2. Pressione `F12`
3. Pressione `Ctrl+Shift+M`
4. Escolha "iPhone 12 Pro"
5. Acesse: `http://localhost:3000/teste-mobile`
6. Teste os links de convocação

---

**Pronto! Agora você pode testar como se estivesse usando um celular! 📱**

