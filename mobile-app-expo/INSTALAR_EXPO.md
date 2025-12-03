# 📱 GUIA EXPO - SUPER FÁCIL!

## ✅ COM EXPO É MUITO MAIS SIMPLES!

**NÃO PRECISA:**
- ❌ Android Studio
- ❌ Configurar Gradle
- ❌ Configurar SDK
- ❌ Cabo USB

**SÓ PRECISA:**
- ✅ Node.js instalado
- ✅ Celular com app **Expo Go**
- ✅ Mesma rede WiFi

---

## 🚀 PASSO A PASSO (3 MINUTOS!):

### **1️⃣ Instalar Expo Go no celular**

**Android:**
- Abrir Google Play Store
- Procurar: **"Expo Go"**
- Instalar

**iOS:**
- Abrir App Store  
- Procurar: **"Expo Go"**
- Instalar

---

### **2️⃣ Instalar dependências**

Abrir **PowerShell**:

```bash
cd C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\mobile-app-expo

npm install
```

⏱️ Aguardar ~2-3 minutos

---

### **3️⃣ Iniciar o Expo**

```bash
npx expo start
```

Vai aparecer um **QR Code** no terminal! 📱

---

### **4️⃣ Escanear QR Code**

**Android:**
1. Abrir app **Expo Go** no celular
2. Tocar em **"Scan QR Code"**
3. Apontar câmera para o QR Code no terminal
4. **Pronto!** O APP abre automaticamente! 🎉

**iOS:**
1. Abrir app **Câmera** nativo do iPhone
2. Apontar para o QR Code
3. Tocar na notificação que aparecer
4. **Pronto!** Abre no Expo Go! 🎉

---

## ⚙️ CONFIGURAR IP DA API

Antes de rodar, editar:

```
mobile-app-expo/src/services/api.js
```

Mudar:
```javascript
const API_BASE_URL = 'http://192.168.1.173:3000';
```

✅ Usar o **IP do seu PC** (não localhost!)

---

## 🎯 COMANDOS ÚTEIS:

```bash
# Iniciar Expo
npx expo start

# Limpar cache e iniciar
npx expo start -c

# Abrir no Android (se tiver emulador)
npx expo start --android

# Abrir no iOS (se tiver macOS)
npx expo start --ios
```

---

## 📦 GERAR APK PARA ANDROID:

### **Opção 1: EAS Build (Recomendado)**

```bash
# Instalar EAS CLI
npm install -g eas-cli

# Login no Expo
eas login

# Configurar projeto
eas build:configure

# Gerar APK
eas build --platform android --profile preview
```

### **Opção 2: Expo Build (Mais simples)**

```bash
npx expo build:android
```

Aguardar o build na nuvem e baixar o APK!

---

## ✅ VANTAGENS DO EXPO:

- ✅ **Instalação em segundos** (QR Code!)
- ✅ **Hot Reload** automático
- ✅ **Sem configuração** complexa
- ✅ **Funciona WiFi** (sem cabo USB)
- ✅ **Updates instantâneos** (muda código e atualiza)
- ✅ **GPS funciona** sem problemas
- ✅ **Câmera funciona** perfeitamente

---

## 🔥 TESTE AGORA:

```bash
cd mobile-app-expo
npm install
npx expo start
```

**Escanear QR Code no celular e pronto!** 🚀

---

## ⚠️ IMPORTANTE:

1. ✅ Backend deve estar rodando: `http://192.168.1.173:3000`
2. ✅ Celular e PC na **mesma rede WiFi**
3. ✅ App **Expo Go** instalado no celular
4. ✅ IP configurado em `src/services/api.js`

---

## 🆘 PROBLEMAS:

### **QR Code não funciona:**
- Verificar se estão na mesma rede WiFi
- Tentar abrir manualmente: `exp://IP_DO_PC:8081`

### **"Unable to connect":**
- Verificar IP em `api.js`
- Backend deve estar rodando

### **Erro ao instalar:**
```bash
npm cache clean --force
npm install
```

---

## 🎉 PRONTO!

**MUITO MAIS FÁCIL QUE ANDROID STUDIO!**

Apenas 3 passos:
1. `npm install`
2. `npx expo start`
3. Escanear QR Code

**E funciona! 🚀**

