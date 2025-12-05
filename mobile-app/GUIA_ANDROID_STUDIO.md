# 🎨 GUIA COMPLETO - ANDROID STUDIO

## Como compilar e testar usando Android Studio

---

## 📋 **PASSO 1: INSTALAR ANDROID STUDIO**

### **Baixar e Instalar:**

1. **Baixar:** https://developer.android.com/studio
2. **Executar** o instalador
3. Aceitar **todas as opções padrão**
4. Aguardar instalação completa (~10 minutos)

### **Primeira execução:**

1. Abrir **Android Studio**
2. Clicar em **"More Actions"** → **"SDK Manager"**
3. Na aba **"SDK Platforms"**, marcar:
   - ✅ Android 13.0 (API 33) - Tiramisu
   - ✅ Android 12.0 (API 31)
   
4. Na aba **"SDK Tools"**, verificar se estão marcados:
   - ✅ Android SDK Build-Tools
   - ✅ Android SDK Platform-Tools
   - ✅ Android SDK Tools
   - ✅ Android Emulator
   - ✅ Intel x86 Emulator Accelerator (HAXM)

5. Clicar em **"Apply"** e aguardar download

---

## 📋 **PASSO 2: CRIAR/CONFIGURAR EMULADOR (OPCIONAL)**

Se você **NÃO** tem um celular físico:

1. No Android Studio: **Tools** → **AVD Manager**
2. Clicar em **"Create Virtual Device"**
3. Escolher: **Pixel 6** ou **Pixel 6 Pro**
4. Clicar em **"Next"**
5. Selecionar: **Tiramisu (API 33)**
6. Se aparecer **"Download"**, clicar e aguardar
7. Clicar em **"Next"** → **"Finish"**

✅ Emulador criado!

---

## 📋 **PASSO 3: ABRIR O PROJETO NO ANDROID STUDIO**

### **Importante: Abrir a pasta ANDROID, não a raiz!**

1. Abrir **Android Studio**
2. Clicar em **"Open"**
3. Navegar até:
   ```
   C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\mobile-app\android
   ```
4. Selecionar a pasta **"android"**
5. Clicar em **"OK"**

### **Aguardar sincronização:**

O Android Studio vai:
- 🔄 Sincronizar o Gradle (~2-5 minutos)
- 📦 Baixar dependências
- ⚙️ Configurar o projeto

**Aguardar até aparecer:** ✅ "Gradle sync finished"

---

## 📋 **PASSO 4: CONFIGURAR IP DA API**

**IMPORTANTE:** Antes de compilar!

1. No Android Studio, expandir: **app** → **java** → **com.divulgacarga.motorista**
2. Mas para editar o IP, precisamos ir em:

   ```
   mobile-app/src/services/api.js
   ```

3. Abrir no Notepad ou VSCode
4. Procurar a linha:
   ```javascript
   const API_BASE_URL = 'http://192.168.1.173:3000';
   ```

5. **MUDAR** para o **SEU IP**:
   ```javascript
   const API_BASE_URL = 'http://SEU_IP_AQUI:3000';
   ```

### **Como descobrir seu IP:**

**PowerShell:**
```bash
ipconfig
```
Procurar por: **IPv4** (exemplo: 192.168.1.173)

---

## 📋 **PASSO 5: INICIAR O METRO BUNDLER**

**IMPORTANTE:** O Metro precisa estar rodando!

1. Abrir **PowerShell** ou **Terminal**
2. Navegar até a pasta:
   ```bash
   cd C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\mobile-app
   ```

3. Executar:
   ```bash
   npm install
   npm start
   ```

4. **DEIXAR ESTE TERMINAL ABERTO!** 🔴
   - Não fechar
   - Vai ficar rodando o Metro Bundler

---

## 📋 **PASSO 6: CONECTAR DISPOSITIVO**

### **OPÇÃO A: Celular Físico** ⭐ (Recomendado)

1. **Ativar Modo Desenvolvedor no celular:**
   - Ir em: **Configurações** → **Sobre o telefone**
   - Tocar **7 vezes** em "Número da versão"
   - ✅ Modo desenvolvedor ativado!

2. **Ativar Depuração USB:**
   - Voltar para **Configurações**
   - Entrar em **Opções do desenvolvedor**
   - Ativar: **"Depuração USB"**

3. **Conectar celular via USB no PC**

4. **Autorizar no celular:**
   - Vai aparecer popup
   - Marcar: **"Sempre permitir deste computador"**
   - Clicar em **"OK"**

5. **Verificar no Android Studio:**
   - No topo, deve aparecer o nome do seu celular
   - Exemplo: "Samsung Galaxy S21" ou "Pixel 6"

### **OPÇÃO B: Emulador**

1. No Android Studio, clicar na **seta verde** ao lado do emulador
2. Ou: **Tools** → **AVD Manager** → **Play** ▶️
3. Aguardar emulador iniciar (~1-2 minutos)

---

## 📋 **PASSO 7: COMPILAR E INSTALAR!** 🚀

### **No Android Studio:**

1. No topo, ao lado de **"app"**, verificar se o dispositivo está selecionado
2. Clicar no botão **"Run" (Play verde) ▶️**
   - Ou pressionar: **Shift + F10**

### **O que vai acontecer:**

```
✅ Compilando o projeto...
✅ Gerando APK...
✅ Instalando no dispositivo...
✅ Iniciando o APP...
```

### **Aguardar:**

- 🕐 Primeira vez: ~5-10 minutos
- 🕐 Próximas vezes: ~1-2 minutos

### **Acompanhar o progresso:**

No Android Studio, na parte inferior:
- Aba **"Build"** mostra a compilação
- Aba **"Logcat"** mostra os logs do APP

---

## 📋 **PASSO 8: TESTAR O APP!** 🎉

Quando terminar de instalar:
1. ✅ O APP deve **abrir automaticamente** no celular/emulador
2. ✅ Você verá a tela de **Login**

### **Fazer login:**
- CPF: (use um CPF válido cadastrado no banco)
- Senha: (senha do motorista)

### **Testar funcionalidades:**
- ✅ Navegar pelo menu
- ✅ Testar GPS
- ✅ Enviar posição
- ✅ Registrar macros
- ✅ Ver convocações, etc.

---

## 🔧 **VISUALIZAR LOGS EM TEMPO REAL**

No Android Studio, na parte inferior:

1. Clicar na aba **"Logcat"**
2. No filtro, procurar por: **"ReactNative"**
3. Acompanhar os logs do APP em tempo real

**Ver apenas erros:**
- Filtro: **Error**
- Tag: **ReactNative**

---

## 📦 **GERAR APK PARA DISTRIBUIR**

### **No Android Studio:**

1. Menu: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. Aguardar compilação
3. Quando terminar, clicar em **"locate"**
4. APK estará em:
   ```
   mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
   ```

### **Instalar APK manualmente:**

1. Copiar o arquivo `app-debug.apk` para o celular
2. Abrir o arquivo no celular
3. Permitir instalação de fontes desconhecidas
4. Instalar

---

## ⚠️ **PROBLEMAS COMUNS**

### **1. "Gradle sync failed"**

**Solução:**
1. Menu: **File** → **Invalidate Caches**
2. Marcar tudo
3. Clicar em **"Invalidate and Restart"**
4. Aguardar reiniciar

### **2. "SDK location not found"**

**Solução:**
1. Criar arquivo: `android/local.properties`
2. Adicionar:
   ```
   sdk.dir=C:\\Users\\cleverson.scopel\\AppData\\Local\\Android\\Sdk
   ```
3. Sincronizar novamente

### **3. "Unable to load script"**

**Solução:**
1. Verificar se o **Metro está rodando** (terminal aberto)
2. Se não estiver, abrir terminal e executar:
   ```bash
   cd mobile-app
   npm start
   ```
3. Reabrir o APP no celular

### **4. Celular não aparece no Android Studio**

**Solução:**
1. Verificar cabo USB (testar outro cabo)
2. Tentar outro modo USB no celular:
   - Conectar → Ver notificação USB
   - Mudar para: **"Transferência de arquivos"**
3. Verificar se autorizou depuração USB
4. Executar no terminal:
   ```bash
   adb devices
   ```
   Deve aparecer o dispositivo

### **5. Erro de compilação**

**Solução - Limpar tudo:**
1. No Android Studio: **Build** → **Clean Project**
2. Depois: **Build** → **Rebuild Project**
3. Se ainda não funcionar:
   ```bash
   cd android
   .\gradlew clean
   ```

---

## 🔄 **ATUALIZAR O APP (APÓS MUDANÇAS)**

### **Se mudou código JavaScript:**

1. **Reload rápido:**
   - Agitar o celular
   - Ou pressionar: **R** + **R** (duas vezes)
   - Menu Dev → **"Reload"**

2. **Ou no Android Studio:**
   - Clicar no botão **"Run" (Play verde)** novamente

### **Se mudou código nativo (Android):**

1. **Recompilar:**
   - Android Studio: **Build** → **Rebuild Project**
   - Clicar em **"Run"**

---

## 💡 **DICAS ÚTEIS**

### **Atalhos do Android Studio:**

- **Shift + F10**: Executar (Run)
- **Ctrl + Shift + A**: Buscar ação
- **Alt + 1**: Abrir árvore de arquivos
- **Alt + 6**: Abrir Logcat

### **Agilizar desenvolvimento:**

1. **Fast Refresh ativado:**
   - Mudanças no código atualizam automaticamente
   - Não precisa recompilar

2. **Debug via WiFi** (avançado):
   - Conectar celular via USB uma vez
   - Executar: `adb tcpip 5555`
   - Depois: `adb connect IP_DO_CELULAR:5555`
   - Desconectar cabo USB
   - Desenvolver via WiFi! 📶

---

## ✅ **CHECKLIST COMPLETO**

Antes de executar, verificar:

- [ ] ✅ Android Studio instalado
- [ ] ✅ SDK Android 33 instalado
- [ ] ✅ Projeto aberto na pasta `android`
- [ ] ✅ Gradle sync concluído
- [ ] ✅ IP configurado em `api.js`
- [ ] ✅ Backend rodando (porta 3000)
- [ ] ✅ Metro Bundler rodando (`npm start`)
- [ ] ✅ Celular conectado OU emulador iniciado
- [ ] ✅ Depuração USB ativa (celular físico)
- [ ] ✅ Celular aparece no Android Studio
- [ ] ✅ Celular e PC na mesma rede WiFi

---

## 🎯 **RESUMO RÁPIDO**

```
1. Abrir Android Studio
2. File → Open → mobile-app/android
3. Aguardar Gradle sync
4. Conectar celular via USB
5. Terminal: cd mobile-app && npm start
6. Android Studio: Clicar no Play verde ▶️
7. Aguardar instalação
8. APP abre no celular! 🎉
```

---

## 📞 **SUPORTE**

### **Ver logs do APP:**
- Android Studio → Aba **Logcat**
- Filtro: **ReactNative**

### **Ver erros de build:**
- Android Studio → Aba **Build**

### **Recompilar do zero:**
```bash
Build → Clean Project
Build → Rebuild Project
```

---

## 🎉 **PRONTO!**

Agora você pode desenvolver e testar pelo Android Studio!

**Benefícios:**
- ✅ Interface visual
- ✅ Ver logs em tempo real
- ✅ Debug mais fácil
- ✅ Autocompletar código nativo
- ✅ Emuladores integrados

**Boa sorte! 🚀**

---

**Dica Final:** Deixe sempre 2 janelas abertas:
1. **Android Studio** (para compilar)
2. **Terminal com `npm start`** (Metro Bundler)

