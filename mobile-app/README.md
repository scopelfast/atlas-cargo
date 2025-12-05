# 📱 DivulgaCarga - App Motorista

## APP Nativo para Android e iOS

### 🚀 Como executar

#### Android:
```bash
cd mobile-app
npm install
npm run android
```

#### iOS (apenas macOS):
```bash
cd mobile-app
npm install
cd ios && pod install && cd ..
npm run ios
```

### 📦 Gerar APK para Android:

```bash
cd android
./gradlew assembleRelease
```

APK estará em: `android/app/build/outputs/apk/release/app-release.apk`

### 🍎 Gerar IPA para iOS:

Abra `ios/DivulgaCargaMotorista.xcworkspace` no Xcode e faça o build.

---

## 📁 Estrutura do Projeto

```
mobile-app/
├── src/
│   ├── screens/         # Telas do app
│   │   ├── LoginScreen.js
│   │   ├── DashboardScreen.js
│   │   └── ...
│   ├── components/      # Componentes reutilizáveis
│   ├── services/        # APIs e serviços
│   │   ├── api.js
│   │   ├── auth.js
│   │   └── offline.js
│   ├── navigation/      # Navegação
│   ├── utils/          # Funções utilitárias
│   └── styles/         # Estilos globais
├── android/            # Projeto Android nativo
├── ios/               # Projeto iOS nativo
└── index.js           # Entry point
```

## ✅ Funcionalidades

- ✅ Login com CPF e Senha
- ✅ Modo Offline 100% funcional
- ✅ GPS em background
- ✅ Cache SQLite local
- ✅ Sincronização automática
- ✅ Câmera nativa
- ✅ Notificações push

