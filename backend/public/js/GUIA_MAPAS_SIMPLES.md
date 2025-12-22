# 🗺️ Guia Simples de Mapas

## ✅ Sistema Simplificado

Agora temos **UMA ÚNICA CLASSE** que gerencia tudo: `MapHelper`

---

## 📖 Como Usar

### 1️⃣ Inicializar um Mapa

```javascript
// Simples assim:
const mapa = window.MapHelper.initMap('meuContainer');
```

### 2️⃣ Calcular uma Rota

```javascript
// Pontos: [{lat, lon}, {lat, lon}, ...]
const pontos = [
  {lat: -16.680882, lon: -49.2532691}, // Origem
  {lat: -23.687481, lon: -49.830416}   // Destino
];

const rota = await window.MapHelper.calculateRoute(pontos);

// Resultado:
// {
//   coordinates: [[lat, lon], [lat, lon], ...], // Pontos da rota
//   distance: 1521.94,  // Distância em km
//   duration: 1320.5    // Tempo em minutos
// }
```

### 3️⃣ Desenhar Rota no Mapa

```javascript
const mapa = window.MapHelper.initMap('mapaRota');
const rota = await window.MapHelper.calculateRoute(pontos);

// Desenhar linha no mapa
L.polyline(rota.coordinates, {
  color: '#3388ff',
  weight: 5
}).addTo(mapa);

// Ajustar zoom para mostrar toda a rota
mapa.fitBounds(rota.coordinates);
```

---

## 🔧 Configuração

Tudo está em **UM LUGAR SÓ**: `backend/public/js/map-helper.js`

Edite as linhas 13-25:

```javascript
const CONFIG = {
  // Servidor de tiles (mapa visual)
  tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  
  // Servidor de roteamento
  osrmServer: 'http://186.250.92.131:8081/ors/v2/directions/driving-hgv',
  osrmServerAlt: 'https://router.project-osrm.org/route/v1/driving-hgv',
  
  // Servidor de geocoding
  nominatimServer: 'http://186.250.92.131:8082',
  nominatimServerAlt: 'https://nominatim.openstreetmap.org'
};
```

---

## ✨ Vantagens

✅ **Simples**: Uma classe, poucos métodos  
✅ **Automático**: Fallback entre servidores  
✅ **Inteligente**: HTTP/HTTPS tratado automaticamente  
✅ **Robusto**: Se falhar, usa linha reta  
✅ **Compatível**: Funciona com código antigo  

---

## 🔄 Migração do Código Antigo

### Antes (Complicado):
```javascript
// Múltiplos arquivos, múltiplas funções
const config = window.MAP_CONFIG;
const osrmUrl = normalizarOSRMUrl(config.osrmServer);
const response = await fetch(osrmUrl);
const data = await response.json();
// ... mais 50 linhas de código
```

### Agora (Simples):
```javascript
// Uma linha!
const rota = await window.MapHelper.calculateRoute(pontos);
```

---

## 📚 API Completa

### `initMap(containerId, options)`
Inicializa um mapa Leaflet.

**Parâmetros:**
- `containerId` (string): ID do elemento HTML
- `options` (object, opcional):
  - `center`: [lat, lon] - Centro do mapa
  - `zoom`: número - Zoom inicial

**Retorna:** Instância do mapa Leaflet

---

### `calculateRoute(points, options)`
Calcula rota entre pontos.

**Parâmetros:**
- `points` (array): Array de `{lat, lon}` ou `[lat, lon]`
- `options` (object, opcional):
  - `overview`: 'full' | 'simplified' | 'false'
  - `geometries`: 'geojson' | 'polyline'
  - `useStraightLine`: boolean - Usar linha reta se falhar

**Retorna:** Promise com objeto `{coordinates, distance, duration}`

---

### `reverseGeocode(lat, lon)`
Converte coordenadas em endereço.

**Parâmetros:**
- `lat` (number): Latitude
- `lon` (number): Longitude

**Retorna:** Promise com objeto de endereço

---

## 🆘 Problemas?

1. **Mapa não aparece?**
   - Verifique se o container existe: `document.getElementById('containerId')`
   - Verifique se Leaflet está carregado: `typeof L !== 'undefined'`

2. **Rota não calcula?**
   - Verifique se tem pelo menos 2 pontos
   - Verifique console para erros de servidor
   - O sistema tenta automaticamente servidor alternativo

3. **Erro de HTTPS/HTTP?**
   - O sistema trata automaticamente!
   - Servidor próprio usa HTTP, público usa HTTPS

---

## 📝 Exemplo Completo

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
  <script src="/js/map-helper.js"></script>
</head>
<body>
  <div id="mapa" style="height: 500px;"></div>
  
  <script>
    // Inicializar mapa
    const mapa = window.MapHelper.initMap('mapa');
    
    // Calcular rota
    const pontos = [
      {lat: -16.680882, lon: -49.2532691},
      {lat: -23.687481, lon: -49.830416}
    ];
    
    window.MapHelper.calculateRoute(pontos)
      .then(rota => {
        // Desenhar rota
        L.polyline(rota.coordinates, {
          color: '#3388ff',
          weight: 5
        }).addTo(mapa);
        
        // Ajustar zoom
        mapa.fitBounds(rota.coordinates);
        
        console.log(`Distância: ${rota.distance.toFixed(2)} km`);
        console.log(`Tempo: ${rota.duration.toFixed(0)} minutos`);
      })
      .catch(err => {
        console.error('Erro ao calcular rota:', err);
      });
  </script>
</body>
</html>
```

---

**Fim! Simples assim! 🎉**
