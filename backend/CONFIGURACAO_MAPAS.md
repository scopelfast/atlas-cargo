# 🗺️ Configuração de Mapas e Roteamento

## 📍 Localização do Arquivo

**Arquivo:** `/backend/public/js/map-config.js`

Este arquivo centraliza TODAS as configurações relacionadas a mapas, roteamento e geocoding do sistema.

---

## 🔧 Como Editar as Configurações

### **1. Servidor de Tiles do Mapa**

**O que é:** Fornece as imagens (tiles) que formam o mapa visual.

**Como mudar:**
1. Abra o arquivo: `backend/public/js/map-config.js`
2. Localize a linha (~linha 12):
   ```javascript
   tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
   ```
3. Substitua pela URL do seu servidor ou por um servidor público

**Servidores disponíveis:**
- ✅ **Servidor Próprio (Integra Brasil):** `http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png`
- 🌐 **OpenStreetMap Público:** `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- 🇩🇪 **OpenStreetMap Alemanha:** `https://tile.openstreetmap.de/{z}/{x}/{y}.png`

---

### **2. Servidor de Roteamento (OSRM)**

**O que é:** Calcula rotas entre pontos (origem → destino) e fornece a distância.

**Como mudar:**
1. Abra o arquivo: `backend/public/js/map-config.js`
2. Localize a linha (~linha 22):
   ```javascript
   osrmServer: 'http://186.250.92.131:8081/ors/v2/directions/driving-car',
   ```
3. Substitua pela URL do seu servidor

**Servidores disponíveis:**
- ✅ **Servidor Próprio (Integra Brasil):** `http://186.250.92.131:8081/ors/v2/directions/driving-car`
- 🌐 **OSRM Público:** `https://router.project-osrm.org/route/v1/driving`
- 🇩🇪 **OSRM Alemanha:** `https://routing.openstreetmap.de/routed-car/route/v1/driving`

---

### **3. Servidor de Geocoding (Nominatim)**

**O que é:** Converte endereços em coordenadas (lat/lon) e vice-versa.

**Como mudar:**
1. Abra o arquivo: `backend/public/js/map-config.js`
2. Localize a linha (~linha 32):
   ```javascript
   nominatimServer: 'http://186.250.92.131:8082',
   ```
3. Substitua pela URL do seu servidor

**Servidores disponíveis:**
- ✅ **Servidor Próprio (Integra Brasil):** `http://186.250.92.131:8082`
- 🌐 **Nominatim Público:** `https://nominatim.openstreetmap.org`

---

## ⏱️ Configurações de Timeout

### **Timeout de Roteamento:**
```javascript
routeTimeout: 15000, // 15 segundos
```

**Quando aumentar:** Se rotas longas estiverem dando timeout.  
**Valores sugeridos:** 10000 a 30000 (10 a 30 segundos)

### **Timeout de Tiles:**
```javascript
tileTimeout: 10000, // 10 segundos
```

**Quando aumentar:** Se o mapa estiver demorando para carregar.  
**Valores sugeridos:** 5000 a 20000 (5 a 20 segundos)

---

## 🔄 Aplicar Mudanças

Após editar o arquivo `map-config.js`:

1. **Salve o arquivo**
2. **Limpe o cache do navegador:** `Ctrl + Shift + R`
3. **Recarregue a página**

**NÃO precisa reiniciar o servidor Node.js!**

---

## 🆘 Problemas Comuns

### **Mapa não carrega / tiles em branco**
- ✅ Verifique se o servidor de tiles está acessível
- ✅ Teste a URL diretamente no navegador
- ✅ Verifique firewall/proxy

### **Rota não calcula / linha reta**
- ✅ Verifique se o servidor OSRM está acessível
- ✅ Aumente o `routeTimeout`
- ✅ Teste com servidor alternativo

### **Erro de CORS**
- ✅ Configure CORS no servidor de mapas
- ✅ Use servidor que permite CORS

---

## 📝 Exemplo de Mudança Rápida

Para usar **APENAS servidores públicos**, edite:

```javascript
tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
osrmServer: 'https://router.project-osrm.org/route/v1/driving',
nominatimServer: 'https://nominatim.openstreetmap.org',
```

Para usar **APENAS servidores próprios** (padrão atual):

```javascript
tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
osrmServer: 'http://186.250.92.131:8081/ors/v2/directions/driving-car',
nominatimServer: 'http://186.250.92.131:8082',
```

---

## ✅ Checklist de Configuração

- [ ] Servidor de tiles configurado
- [ ] Servidor de roteamento configurado
- [ ] Servidor de geocoding configurado
- [ ] Timeouts ajustados
- [ ] Testado no navegador
- [ ] Cache limpo

---

**Qualquer dúvida, edite apenas o arquivo `backend/public/js/map-config.js`!** 🎯

