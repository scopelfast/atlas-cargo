# 📱 INSTRUÇÕES DE INSTALAÇÃO - APP MOTORISTA

## ✅ PARTE 1: TELA DE LOGIN - CONCLUÍDA!

A tela de login está **100% funcional** e igual ao sistema web atual:
- ✅ Input de CPF com máscara (000.000.000-00)
- ✅ Input de Senha
- ✅ Validações
- ✅ Loading durante autenticação
- ✅ Integração com API backend
- ✅ Navegação para Dashboard após login

---

## ⏸️ AGUARDANDO: MENU PRINCIPAL

**Status:** Aguardando design fornecido pelo usuário

O dashboard temporário foi criado e está funcionando. Assim que você fornecer o design do menu principal, será implementado imediatamente.

---

## 🚀 COMO TESTAR O APP

### Pré-requisitos:
- Node.js 16+ instalado
- Android Studio (para Android)
- Xcode (para iOS - apenas macOS)

### Instalação:

```bash
# 1. Entrar na pasta do projeto
cd mobile-app

# 2. Instalar dependências
npm install

# 3. (Android) Instalar dependências nativas
cd android && ./gradlew clean && cd ..

# 4. (iOS) Instalar pods
cd ios && pod install && cd ..
```

### Executar no Android:

```bash
# Conectar celular via USB (com depuração USB ativa)
# OU iniciar emulador Android

npm run android
```

### Executar no iOS (apenas macOS):

```bash
npm run ios
```

---

## 📦 GERAR APK PARA ANDROID

### APK Debug (para testes):

```bash
cd mobile-app/android
./gradlew assembleDebug
```

APK estará em: `android/app/build/outputs/apk/debug/app-debug.apk`

### APK Release (para produção):

**1. Gerar chave de assinatura:**
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

**2. Configurar em `android/app/build.gradle`:**
```gradle
signingConfigs {
    release {
        storeFile file('my-release-key.keystore')
        storePassword 'SUA_SENHA'
        keyAlias 'my-key-alias'
        keyPassword 'SUA_SENHA'
    }
}
```

**3. Gerar APK:**
```bash
cd android
./gradlew assembleRelease
```

APK estará em: `android/app/build/outputs/apk/release/app-release.apk`

---

## 🍎 GERAR IPA PARA iOS (apenas macOS)

1. Abrir `ios/DivulgaCargaMotorista.xcworkspace` no Xcode
2. Selecionar target "Generic iOS Device"
3. Product > Archive
4. Distribuir via App Store ou AdHoc

---

## ⚙️ CONFIGURAÇÕES

### Alterar URL da API:

Editar `mobile-app/src/services/api.js`:

```javascript
const API_BASE_URL = 'http://SEU_IP:3000'; // Alterar aqui
```

---

## 📝 PRÓXIMOS PASSOS

1. ⏳ **Aguardando:** Você fornecer o design do Menu Principal
2. ⏳ **Pendente:** Implementar telas de funcionalidades:
   - Convocações
   - Cargas Disponíveis
   - Rastreamento GPS
   - Eventos e Fotos
   - Chat

3. ⏳ **Pendente:** Configurar notificações push
4. ⏳ **Pendente:** Implementar sincronização em background

---

## 🆘 PROBLEMAS COMUNS

### Erro "Unable to connect to dev server"
- Verificar se o Metro Bundler está rodando (`npm start`)
- Verificar se o celular está na mesma rede WiFi

### Erro de permissões no Android
- Aceitar permissões manualmente nas configurações do app

### Build falha no Android
```bash
cd android && ./gradlew clean && cd ..
```

---

## ✅ STATUS ATUAL

- ✅ Estrutura do projeto React Native
- ✅ Tela de Login funcional
- ✅ Navegação configurada
- ✅ Serviços (API, Auth, Offline)
- ✅ Configuração Android
- ✅ Configuração iOS
- ⏳ Menu Principal (aguardando design)
- ⏳ Demais telas (aguardando orientação)

---

**Estou pronto para continuar assim que você fornecer o design do menu!** 🚀

