# 📱 APP MOTORISTA - EXPO VERSION

## ✅ INSTALAÇÃO SUPER FÁCIL!

### **Método 1: Usando o script .bat** ⭐ (Mais fácil!)

1. **Clicar 2x no arquivo:**
   ```
   INICIAR.bat
   ```

2. **Aguardar** instalação

3. **Escanear QR Code** no celular (Expo Go)

4. **Pronto!** 🎉

---

### **Método 2: Command Prompt (cmd)**

```cmd
cd C:\Users\cleverson.scopel\Documents\GitHub\SysScopel\mobile-app-expo

npm install

npx expo start --tunnel
```

---

### **Método 3: Habilitar scripts no PowerShell** (Admin)

1. Abrir PowerShell **como Administrador**
2. Executar:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Depois executar normalmente:
   ```powershell
   cd mobile-app-expo
   npm install
   npx expo start
   ```

---

## 📱 **EXPO GO:**

**Baixar no celular:**
- Android: Google Play Store → "Expo Go"
- iOS: App Store → "Expo Go"

---

## ⚙️ **CONFIGURAR IP:**

Editar: `src/services/api.js`

```javascript
const API_BASE_URL = 'http://SEU_IP:3000';
```

Descobrir IP:
```cmd
ipconfig
```

---

## ✅ **CHECKLIST:**

- [ ] Backend rodando (porta 3000)
- [ ] Expo Go instalado no celular
- [ ] Mesma rede WiFi
- [ ] IP configurado em api.js

---

## 🚀 **TESTAR:**

**Forma mais fácil:**  
→ Clicar 2x em `INICIAR.bat`

**OU**

```cmd
cd mobile-app-expo
npm install
npx expo start --tunnel
```

**Escanear QR Code no Expo Go!** 📱

---

**SEM Android Studio!** ✨

