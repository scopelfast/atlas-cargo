# Som no APP (Android / iOS) — guia para o colega

## Resposta curta

**Não é a mesma coisa** que a torre no PC.

| Cenário | Mecanismo | Dá para usar o bip Web Audio (2 s / 5 s)? |
|---------|-----------|------------------------------------------|
| Torre / Dashboard no Chrome do PC | Web Audio no `dashboard.js` | Sim (após 1 clique) |
| App motorista **aberto na tela** (PWA / WebView) | Web Audio no `notifications-service.js` | Sim — **já alinhado** com a torre |
| App em **segundo plano** / tela bloqueada / morto | Notificação do **sistema** (Android/iOS) | **Não** — outro caminho |

## O que o app motorista é hoje

É **PWA web** (`backend/public/motorista/`), não app nativo Kotlin/Swift puro.

- **Foreground (tela aberta):** `NotificacoesService` toca som com Web Audio  
  - Chat ~**2 s** · Alerta / SOS / demais ~**5 s** (pulsos)  
  - Preferência: `localStorage.notificacoes_config.som`  
  - Precisa de **1 toque** na tela após abrir (política iOS/Android)
- **Background:** `showNotification` do Service Worker — o som é o **padrão do SO** (não o bip de 5 s)

## O que NÃO fazer

1. Copiar só o HTML da demo da torre e esperar bip de 5 s com o celular bloqueado.  
2. Confiar em `AudioContext` no Service Worker / push em background (iOS bloqueia; Android é instável).  
3. Assumir que `options.sound` na Notification API web controla arquivo custom em todos os celulares (na prática, **não**).

## O que fazer em cada camada

### A) Já funciona no PWA (foreground) — feito no SysScopel

Arquivo: `backend/public/motorista/js/notifications-service.js`

- Unlock no 1º `click` / `touchstart` / `keydown`
- Mesmas durações da torre
- Teste no console (com o app aberto e após tocar na tela):

```js
NotificacoesService.tocarSom('alerta')  // ~5 s
NotificacoesService.tocarSom('chat')    // ~2 s
NotificacoesService.tocarSom('sos')     // ~5 s sirene leve
NotificacoesService.audioLiberado()     // true se já tocou na tela
```

### B) Background Android (recomendado se for app nativo / Capacitor)

1. Firebase Cloud Messaging (FCM)  
2. Canal de notificação com importância **HIGH**  
3. Arquivo de som no projeto, ex.: `res/raw/alerta_5s.mp3`  
4. Payload / canal apontando esse som  
5. Sons diferentes por tipo (chat / alerta / SOS) se necessário  

Sem canal + arquivo no APK, o Android usa o som default do sistema.

### C) Background iOS

1. APNs (ou FCM → APNs)  
2. Arquivo de som no **bundle** do app (ex.: `alerta.caf` / `.wav`) — limite ~**30 s**  
3. Campo `sound` no payload apontando o nome do arquivo  
4. Usuário precisa ter permitido notificações; modo Não Perturbe / Foco pode silenciar  

iOS **não** toca Web Audio com o app morto.

### D) Se continuar só como PWA instalada

- Foreground: ok (Web Audio).  
- Background: depende do browser (Chrome Android melhor; Safari iOS bem limitado).  
- Para bip longo e confiável com tela bloqueada → **precisa app nativo/híbrido** (Capacitor + FCM/APNs).

## Checklist rápido para o colega

### Foreground (PWA atual)

- [ ] Abrir o app motorista no celular  
- [ ] Tocar uma vez na tela  
- [ ] Configurações → som ligado  
- [ ] `NotificacoesService.tocarSom('alerta')` no console remoto / ou gerar evento real  
- [ ] Ouvir ~5 s em pulsos  

### Background (nativo — a fazer fora deste PWA)

- [ ] Definir se o empacotamento será Capacitor / RN / nativo  
- [ ] Incluir arquivo(s) de áudio no bundle  
- [ ] Configurar canal Android + `sound` iOS  
- [ ] Testar com app em segundo plano e com tela bloqueada  
- [ ] Testar iOS e Android separados (comportamentos diferentes)

## Referência cruzada

| Material | Uso |
|----------|-----|
| `demo-som-notificacao.html` | Ouvir o bip no PC (mesmas frequências) |
| `referencia-eventos-socket.md` | Eventos da torre (PC) |
| `checklist-teste.md` | Teste da torre no navegador |
| Este arquivo | App Android/iOS |

## Mensagem pronta para o WhatsApp / e-mail

> Na torre do PC o bip de 5 s é Web Audio no navegador.  
> No app, com a tela aberta, já usamos a mesma lógica (2 s chat / 5 s alerta·SOS).  
> Com o celular bloqueado ou app em background, Web Audio não resolve — precisa som de notificação do Android/iOS (FCM/APNs + arquivo no app). É outro mecanismo.
