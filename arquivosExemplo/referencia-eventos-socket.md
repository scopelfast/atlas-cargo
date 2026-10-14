# Referência — eventos Socket e fluxo de som

## Fluxo resumido

```
Backend gera alerta / mensagem / SOS
        ↓
Socket.IO emite evento (ex.: torre:novo-alerta)
        ↓
dashboard.js escuta (inicializarSocketDashboard)
        ↓
tocarSomNotificacao('alerta' | 'chat' | 'sos')
        ↓
Web Audio API (oscilador seno ~0,2 s)
```

## Eventos principais (tela web / torre)

| Evento | Quando | Som |
|--------|--------|-----|
| `torre:novo-alerta` | Novo alerta na torre | `alerta` — ~**5 s** em pulsos (800 Hz) |
| `torre:sos-alerta` | SOS do motorista | `sos` — ~**5 s** sirene leve (1000↔750 Hz) |
| `torre:nova-mensagem` | Nova msg no chat | `chat` — ~**2 s** (600 Hz), **somente se** `SENDER_TYPE` = MOTORISTA/DRIVER |
| `torre:divergencia-placas-convocacao` | Divergência de placas | `alerta` — ~5 s |

## Salas que o front entra

- `join-chat-dashboard` — quando há menu Chat ou está no dashboard  
- `join-viagem` / `join-conversa` — conversas do usuário  
- `torre:join-all` — alertas / SOS / dashboard  

## Backup sem Socket

Polling dos contadores (`/api/alertas/contador`, chat, SOS):  
se o número **subiu** em relação ao ciclo anterior → toca o som do tipo correspondente.

## Preferência do usuário

```js
// Desligar
localStorage.setItem('notificacao_som', 'false');

// Ligar (padrão)
localStorage.setItem('notificacao_som', 'true');
// ou remova a chave
```

## Arquivos no repositório (não alterar só por causa deste material)

- `backend/public/js/dashboard.js` — som + socket do dashboard  
- `backend/public/modulos/gerenciar-viagens/js/websocket-torre.js` — eventos da torre  
- `backend/public/modulos/gerenciar-viagens/js/script.js` — `notificarSOS` (áudio WAV base64 complementar no SOS)
