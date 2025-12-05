# 📱 GUIA COMPLETO - ANDROID

## Como compilar e testar o APP no Android

---

## 📋 **PRÉ-REQUISITOS:**

### 1. **Node.js** (versão 16 ou superior)
```bash
# Verificar se está instalado:
node --version
npm --version
```

### 2. **Java Development Kit (JDK 11)**
- Baixar: https://www.oracle.com/java/technologies/javase/jdk11-archive-downloads.html
- Ou usar OpenJDK: https://adoptium.net/

```bash
# Verificar:
java -version
```

### 3. **Android Studio**
- Baixar: https://developer.android.com/studio
- Instalar com as opções padrão
- Aceitar todas as licenças durante a instalação

### 4. **Configurar Variáveis de Ambiente**

**Windows:**
```powershell
# Adicionar ao PATH (Sistema):
ANDROID_HOME = C:\Users\SEU_USUARIO\AppData\Local\Android\Sdk

# Adicionar também:
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
```

**Verificar:**
```bash
adb version
```

---

## 🚀 **PASSO A PASSO - PRIMEIRA VEZ:**

### **1. Instalar Dependências**

```bash
# Navegar até a pasta do projeto
cd C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\mobile-app

# Instalar dependências Node
npm install

# Limpar cache (se necessário)
npm start -- --reset-cache
```

### **2. Instalar Dependências Android**

```bash
cd android

# Windows PowerShell:
.\gradlew clean

# Ou Command Prompt:
gradlew clean

cd ..
```

---

## 📱 **OPÇÃO 1: TESTAR NO EMULADOR**

### **Criar Emulador (Android Studio):**

1. Abrir **Android Studio**
2. Menu: **Tools** → **AVD Manager**
3. Clicar em **Create Virtual Device**
4. Escolher: **Pixel 6** (recomendado)
5. Selecionar: **Android 13** (API 33) ou superior
6. Clicar em **Finish**

### **Iniciar Emulador:**

```bash
# Listar emuladores disponíveis:
emulator -list-avds

# Iniciar emulador:
emulator -avd Pixel_6_API_33
```

### **Executar o APP:**

```bash
# Terminal 1 - Metro Bundler:
npm start

# Terminal 2 - Instalar no emulador:
npm run android
```

---

## 📱 **OPÇÃO 2: TESTAR NO CELULAR FÍSICO** ⭐ (RECOMENDADO)

### **Preparar o Celular:**

1. **Ativar Modo Desenvolvedor:**
   - Ir em **Configurações** → **Sobre o telefone**
   - Tocar 7 vezes em **Número da versão**
   - Voltar e entrar em **Opções do desenvolvedor**

2. **Ativar Depuração USB:**
   - Em **Opções do desenvolvedor**
   - Ativar **Depuração USB**

3. **Conectar via USB:**
   - Conectar celular no PC
   - Permitir depuração quando aparecer popup no celular

### **Verificar Conexão:**

```bash
# Listar dispositivos conectados:
adb devices

# Deve aparecer:
# List of devices attached
# ABC123456789    device
```

### **Executar o APP:**

```bash
# Terminal 1 - Metro Bundler:
npm start

# Terminal 2 - Instalar no celular:
npm run android
```

---

## 🔧 **CONFIGURAÇÃO IMPORTANTE:**

### **Alterar URL da API:**

Editar: `mobile-app/src/services/api.js`

```javascript
// MUDAR AQUI:
const API_BASE_URL = 'http://192.168.1.173:3000'; // SEU IP LOCAL

// Para descobrir seu IP:
// Windows: ipconfig
// Procurar por: IPv4
```

⚠️ **IMPORTANTE:** 
- Use o **IP da sua máquina** (não localhost)
- Certifique-se que o celular está na **mesma rede WiFi**
- Libere a **porta 3000** no firewall

---

## 📦 **GERAR APK PARA DISTRIBUIÇÃO:**

### **APK Debug (para testes):**

```bash
cd mobile-app/android

# PowerShell:
.\gradlew assembleDebug

# Command Prompt:
gradlew assembleDebug
```

**APK estará em:**
```
mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
```

### **APK Release (para produção):**

**1. Gerar Chave de Assinatura:**

```bash
cd mobile-app/android/app

keytool -genkeypair -v -storetype PKCS12 -keystore divulgacarga-release.keystore -alias divulgacarga -keyalg RSA -keysize 2048 -validity 10000

# Responder as perguntas:
# Senha: (criar uma senha forte)
# Nome: DivulgaCarga
# etc...
```

**2. Configurar Gradle:**

Editar: `mobile-app/android/app/build.gradle`

```gradle
android {
    ...
    signingConfigs {
        release {
            storeFile file('divulgacarga-release.keystore')
            storePassword 'SUA_SENHA_AQUI'
            keyAlias 'divulgacarga'
            keyPassword 'SUA_SENHA_AQUI'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

**3. Gerar APK Release:**

```bash
cd mobile-app/android

.\gradlew assembleRelease
```

**APK estará em:**
```
mobile-app/android/app/build/outputs/apk/release/app-release.apk
```

---

## 🔥 **COMANDOS ÚTEIS:**

### **Limpar e Recompilar:**
```bash
cd mobile-app/android
.\gradlew clean
cd ..
npm start -- --reset-cache
npm run android
```

### **Ver Logs em Tempo Real:**
```bash
adb logcat | findstr "ReactNative"
```

### **Desinstalar APP do Celular:**
```bash
adb uninstall com.divulgacarga.motorista
```

### **Instalar APK Manualmente:**
```bash
adb install app-debug.apk
```

### **Abrir Menu de Dev no APP:**
- Agitar o celular
- Ou: `adb shell input keyevent 82`

---

## ⚠️ **PROBLEMAS COMUNS:**

### **1. "SDK location not found"**
```bash
# Criar arquivo: android/local.properties
sdk.dir=C:\\Users\\SEU_USUARIO\\AppData\\Local\\Android\\Sdk
```

### **2. "Unable to load script"**
```bash
# Verificar se Metro está rodando:
npm start

# Garantir que está na mesma rede
# Reabrir o APP
```

### **3. "Connection refused"**
```bash
# Verificar IP da API em src/services/api.js
# Usar IP da máquina, não localhost
# Exemplo: http://192.168.1.173:3000
```

### **4. "Build failed"**
```bash
# Limpar tudo:
cd android
.\gradlew clean
cd ..
rm -rf node_modules
npm install
npm run android
```

### **5. Permissões GPS não funcionam**
- Verificar se está em **HTTPS** (produção)
- Ou permitir manualmente nas configurações do celular

---

## 📝 **CHECKLIST ANTES DE TESTAR:**

- [ ] Node.js instalado
- [ ] JDK 11 instalado
- [ ] Android Studio instalado
- [ ] Variáveis de ambiente configuradas
- [ ] `npm install` executado
- [ ] Backend rodando na porta 3000
- [ ] IP correto configurado em `api.js`
- [ ] Celular conectado via USB (ou emulador rodando)
- [ ] Depuração USB ativada no celular
- [ ] `adb devices` mostra dispositivo
- [ ] Celular e PC na mesma rede WiFi

---

## 🎯 **COMANDOS RÁPIDOS (RESUMO):**

### **Primeira Vez:**
```bash
cd mobile-app
npm install
cd android && .\gradlew clean && cd ..
npm run android
```

### **Próximas Vezes:**
```bash
cd mobile-app
npm run android
```

### **Gerar APK de Teste:**
```bash
cd mobile-app/android
.\gradlew assembleDebug
```

---

## 📞 **SUPORTE:**

Se algo não funcionar:
1. Ler os logs: `adb logcat`
2. Verificar IP da API
3. Limpar cache: `npm start -- --reset-cache`
4. Recompilar: `.\gradlew clean && npm run android`

---

## ✅ **PRONTO!**

Agora você pode testar o APP no Android! 🎉

Qualquer problema, verifique os logs e o checklist acima.

---

**Boa sorte! 🚀**

