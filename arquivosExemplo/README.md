# Som de notificação — Atlas Cargo (material para colega)

Pasta de **exemplos / referência**. Não faz parte do runtime do sistema; use só para passar ao colega.

## O que o sistema faz

Quando chega **novo alerta**, **mensagem de chat do motorista** ou **SOS**, a torre/dashboard emite um **bip** no navegador.

| Tipo | Tom (Hz) | Duração | Evento Socket.IO (ex.) |
|------|----------|---------|-------------------------|
| Chat | 600 | ~**2 s** (pulsos) | `torre:nova-mensagem` (só se remetente = motorista) |
| Alerta | 800 | ~**5 s** (pulsos) | `torre:novo-alerta` |
| SOS | 1000↔750 | ~**5 s** (sirene leve) | `torre:sos-alerta` |

Também há backup por **polling**: se o badge (contador) **aumentar**, toca o mesmo som.

## Onde está no projeto real (só leitura)

- `backend/public/js/dashboard.js`
  - `tocarSomNotificacao(tipo)`
  - `inicializarAudioContext()`
  - `inicializarSocketDashboard()` (listeners Socket.IO)
- Torre (UI): `backend/public/modulos/gerenciar-viagens/js/websocket-torre.js`
- Preferência on/off: `localStorage.setItem('notificacao_som', 'true'|'false')`

## Regra do navegador (obrigatório explicar)

Chrome/Edge **não tocam áudio** até o usuário **clicar/teclar** na página uma vez.  
Por isso o sistema “desbloqueia” o `AudioContext` no primeiro gesto.

Sem clique → sem som (falha silenciosa).

## Como testar no sistema de verdade

1. Login na Torre / Dashboard  
2. Clique em qualquer lugar da tela  
3. Confirme que o som não está desligado (`notificacao_som` ≠ `false`)  
4. Gere um alerta / mensagem do motorista / SOS  

## Arquivos nesta pasta

| Arquivo | Uso |
|---------|-----|
| `demo-som-notificacao.html` | Abra no navegador: botões Chat / Alerta / SOS (mesma lógica de frequência) |
| `referencia-eventos-socket.md` | Lista dos eventos e fluxo resumido |
| `checklist-teste.md` | Checklist curto para validar com o colega |
| `guia-mobile-android-ios.md` | **App Android/iOS:** o que vale no PWA vs background nativo |

## App mobile (Android / iOS)

**Não é igual à torre do PC.** Com o app aberto, o PWA motorista já toca o mesmo bip (2 s / 5 s). Com tela bloqueada, precisa som de notificação do SO — ver `guia-mobile-android-ios.md`.

## Abrir a demo

Dê duplo clique em `demo-som-notificacao.html` ou arraste para o Chrome.  
**Primeiro clique em “Liberar áudio”**, depois teste os botões.
