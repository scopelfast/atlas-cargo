# Backlog: Envio de Áudio no Chat Motorista + Transcrição com IA

**Objetivo:** Permitir que o motorista envie mensagens de áudio no chat com a torre de controle e, opcionalmente, exibir a transcrição em texto (IA), com idioma configurável.

**Contexto do projeto:**
- **Chat motorista (app):** `http://localhost:3000/chat-motorista-standalone?viagem=1` — envia texto e localização.
- **Chat na plataforma WEB (torre de controle):** módulo carregado no painel admin, em `backend/public/modulos/chat/` (index.html + js/script.js). Os operadores visualizam e respondem às mensagens das viagens; **precisa receber e exibir as mesmas tratativas** (áudio + transcrição) que o app motorista.
- Backend: Node/Express, controller `message.controller.js`, tabelas `MESSAGES` e `CONVERSAS` (PostgreSQL).
- Mensagens usam `POST /api/messages` com `idviagem`, `content`, `senderType`, `senderId`, `senderName` e opcionalmente `tipo` (TEXTO, IMAGEM, ARQUIVO). O mesmo fluxo (listagem, WebSocket, contador de não lidas) deve considerar mensagens tipo **AUDIO**.

---

## Fase 1: Upload de áudio e envio como mensagem

### 1.1 Backend – endpoint de upload de áudio

- **Rota:** `POST /api/messages/upload-audio`
- **Comportamento:**
  - Receber `multipart/form-data` com:
    - `file`: arquivo de áudio (webm, mp3, wav ou m4a).
    - `idviagem`: number (obrigatório).
    - `senderType`, `senderId`, `senderName`: como no envio de texto.
    - `idConversa`: opcional (se não enviar, o backend obtém/cria como já faz em `enviar`).
  - Usar **multer** para salvar o arquivo em uma pasta dedicada (ex.: `backend/uploads/audio/` ou `backend/public/uploads/audio/`), com nome único (ex.: `uuid + extensão original` ou `.webm`).
  - Garantir que a pasta de upload exista (criar se não existir) e que não seja servida com listagem de diretório.
  - **Não** transcrever ainda nesta fase; apenas salvar o arquivo e registrar a mensagem.

### 1.2 Backend – registrar mensagem tipo AUDIO

- Após salvar o arquivo:
  - Inserir registro em `MESSAGES` com:
    - `TIPO` = `'AUDIO'`.
    - `CONTENT` = JSON string com a URL (path) do áudio para o cliente acessar, ex.:  
      `{"url":"/uploads/audio/abc123.webm"}`  
      (ajustar o path conforme onde os arquivos forem servidos estaticamente).
  - Reutilizar a mesma lógica de conversa (obter/criar `CONVERSAS`), atualizar `ULTIMA_MENSAGEM` e contador de não lidas, e emitir eventos WebSocket (como em `message.controller.js` `enviar`).
- Servir arquivos de áudio estaticamente: por exemplo, em Express usar `express.static` para `uploads/audio` com rota `/uploads/audio` (ou incluir em `public` e usar `/uploads/audio`).

### 1.3 Frontend – chat standalone (gravação e envio)

- **Arquivo:** `backend/public/motorista/pages/chat-standalone.html`
- Adicionar **botão de gravar áudio** na área de input (ao lado do botão de localização e do botão enviar), por exemplo ícone de microfone (🎙️ ou `bx-microphone`).
- Usar **MediaRecorder** (navegador):
  - Solicitar `navigator.mediaDevices.getUserMedia({ audio: true })`.
  - Iniciar gravação com `MediaRecorder` (formato preferencial: `audio/webm` ou o que o navegador suportar).
  - Ao parar, obter `Blob` de áudio e enviar via `FormData` para `POST /api/messages/upload-audio` com os campos: `file`, `idviagem`, `senderType`, `senderId`, `senderName` (e `idConversa` se o front já tiver).
- UX sugerida:
  - Botão “gravar”: ao clicar, começa a gravar e o botão pode mudar para “parar” ou ícone de stop.
  - Segundo clique: para gravação, envia o áudio e chama `load()` para atualizar a lista de mensagens.
  - Tratar erros de permissão de microfone e exibir mensagem amigável (ex.: “Permissão de microfone negada”).
- **Exibição no chat:** nas mensagens já carregadas, se `TIPO === 'AUDIO'` (ou `tipo === 'AUDIO'`), interpretar `CONTENT` como JSON com `url` e exibir um `<audio controls src="...">` (usar a URL retornada, ex.: `baseUrl + contentObj.url`). Opcional: mostrar um rótulo “Áudio” ou ícone de áudio ao lado do player.

### 1.4 Chat na plataforma WEB (módulo Chat – torre de controle) — obrigatório

- **Arquivos:** `backend/public/modulos/chat/js/script.js` e `backend/public/modulos/chat/index.html`.
- O **Chat da WEB** é onde o operador da torre vê as conversas por viagem; ele **precisa receber e exibir** mensagens de áudio da mesma forma que texto e localização.
- **Tratativas no módulo Chat WEB:**
  - Ao renderizar mensagens (lista e WebSocket em tempo real), se `TIPO === 'AUDIO'` (ou `msg.TIPO === 'AUDIO'`), interpretar `CONTENT` como JSON com `url` e exibir um **player de áudio** (`<audio controls src="...">`), usando a mesma estrutura de `CONTENT` do backend (ex.: `{"url":"/uploads/audio/xxx.webm"}`).
  - Garantir que a **listagem** (`GET /api/messages/viagem/:idviagem`) já retorne mensagens tipo AUDIO (o backend não filtra por tipo; só o front precisa tratar na hora de montar o HTML).
  - Garantir que o **WebSocket** (evento `nova-mensagem`) ao receber uma mensagem tipo AUDIO adicione na lista e re-renderize com o player (mesma lógica de exibição).
  - **Contador de não lidas** e **preview da última mensagem** na lista de conversas: se a última mensagem for AUDIO, exibir um texto fixo como “🎙️ Áudio” (ou chave i18n) em vez do conteúdo bruto do JSON.
- Exibição visual: manter consistência com o standalone (player + opcionalmente rótulo “Áudio”). Na Fase 2, exibir também a transcrição quando existir no JSON.

---

## Fase 2: Transcrição com IA e idioma configurável

### 2.1 Escolha do serviço de transcrição

- Escolher **uma** das opções:
  - **OpenAI Whisper** (API): simples, suporta vários idiomas; requer `OPENAI_API_KEY`.
  - **Azure Speech to Text**: robusto, suporta idiomas e locale; requer configuração Azure.
  - **Google Speech-to-Text**: similar; requer conta Google Cloud.
- Recomendação para menor esforço inicial: **Whisper** (ex.: `openai.audio.transcriptions.create` com `language` opcional).

### 2.2 Backend – serviço de transcrição

- Criar um módulo de serviço, ex.: `backend/services/transcricao.service.js` (ou `speech-to-text.service.js`).
- Função assíncrona, ex.: `transcreverAudio(caminhoArquivo, idioma)`.
  - **idioma:** string opcional (ex.: `'pt'`, `'en'`, `'es'`). Se não informado, o Whisper pode auto-detectar.
  - Ler o arquivo de áudio do disco (ou stream) e enviar para a API escolhida.
  - Retornar o texto transcrito (string).
- Tratar erros (API indisponível, arquivo inválido, limite de tamanho) e retornar mensagem adequada ou `null` em caso de falha, para não quebrar o fluxo de envio da mensagem.

### 2.3 Backend – integrar transcrição ao upload de áudio

- No endpoint `POST /api/messages/upload-audio`:
  - Aceitar parâmetro opcional **`idioma`** (query ou no form), ex.: `pt`, `en`, `es`.
  - Após salvar o arquivo e **antes** de inserir em `MESSAGES`:
    - Chamar o serviço de transcrição com o caminho do arquivo e o idioma.
    - Se houver texto retornado, incluir no JSON de `CONTENT`:  
      `{"url":"/uploads/audio/xxx.webm","transcricao":"texto transcrito aqui"}`.
  - Se a transcrição falhar, ainda assim salvar a mensagem com só `url` (sem `transcricao`), para que o áudio fique disponível.

### 2.4 Frontend – escolha de idioma para áudio

- No **chat standalone** (`chat-standalone.html`):
  - Adicionar um **select** (dropdown) para “Idioma da transcrição” (visível próximo ao botão de áudio ou em configuração do chat), com opções como: Português, Español, English (valores: `pt`, `es`, `en`).
  - Ao enviar o áudio, enviar esse valor no `FormData` (ex.: campo `idioma`) para o backend usar na transcrição.
- No **Chat da plataforma WEB** (módulo `modulos/chat`): ao exibir mensagem tipo AUDIO, se existir `transcricao` no JSON de `CONTENT`, exibir o texto abaixo ou ao lado do player (ex.: “Transcrição: …”), **com as mesmas tratativas** do standalone (player + transcrição visível para o operador).

### 2.5 Variáveis de ambiente e documentação

- **Implementado:** Transcrição via OpenAI Whisper. Variável `OPENAI_API_KEY` no `.env` (opcional). Se ausente, o áudio é enviado normalmente sem transcrição. Documentado em `backend/ATUALIZAR_ENV.md`.
- Não commitar chaves no repositório; usar apenas variáveis de ambiente.

---

## Fase 3 (opcional): Melhorias de UX e robustez

- Limite de tamanho de arquivo (ex.: 10 MB) e duração máxima (ex.: 2 min) no backend e mensagem clara no front se exceder.
- Indicador visual no chat de “gravando…” e “enviando áudio…”.
- i18n: chaves para “Enviar áudio”, “Parar gravação”, “Transcrição”, “Idioma da transcrição”, erros de permissão e de envio (usar estrutura existente do app motorista).
- Testes manuais: enviar áudio em PT, ES e EN e verificar se a transcrição e o player aparecem corretamente no standalone e no módulo chat da torre.

---

## Ordem sugerida para o Cursor IDE

1. **Fase 1.1 e 1.2** – Backend: rota de upload de áudio (multer), salvar arquivo, inserir mensagem TIPO AUDIO com CONTENT em JSON (só `url`), servir arquivos estáticos.
2. **Fase 1.3** – Frontend standalone: botão gravar, MediaRecorder, envio via FormData, exibir mensagens AUDIO com `<audio controls>`.
3. **Fase 1.4** – **Chat na plataforma WEB** (módulo chat): exibir mensagens AUDIO com player; tratar listagem, WebSocket e preview “Última mensagem” (ex.: “🎙️ Áudio”).
4. **Fase 2.1 e 2.2** – Backend: serviço de transcrição (ex.: Whisper) com parâmetro idioma.
5. **Fase 2.3** – Backend: integrar transcrição no upload (parâmetro `idioma` no request, incluir `transcricao` no JSON de CONTENT quando houver).
6. **Fase 2.4** – Frontend: select de idioma no standalone; exibição da transcrição no **standalone** e no **Chat da plataforma WEB** (módulo chat), com as mesmas tratativas em ambos.
7. **Fase 2.5 e 3** – Documentação, env, limites e i18n conforme necessário.

---

## Resumo: onde aplicar as tratativas de áudio e transcrição

| Onde | O que fazer |
|------|-------------|
| **App motorista (chat standalone)** | Gravar áudio, enviar, exibir player e transcrição nas mensagens. |
| **Chat na plataforma WEB** (`modulos/chat`) | **Receber e exibir** mensagens tipo AUDIO: player de áudio + transcrição (quando existir); tratar listagem, WebSocket e preview “Última mensagem” (ex.: “🎙️ Áudio”). |

As duas frentes (app e WEB) devem usar a mesma estrutura de `CONTENT` (JSON com `url` e opcionalmente `transcricao`) para manter consistência.

---

## Referências rápidas no código atual

- Envio de mensagem de texto: `backend/public/motorista/pages/chat-standalone.html` (função `enviarTexto`, `fetch` para `POST /api/messages`).
- Controller de mensagens: `backend/controllers/message.controller.js` (método `enviar`: validação, conversa, insert em `MESSAGES`, WebSocket).
- Listagem de mensagens por viagem: `GET /api/messages/viagem/:idviagem` no mesmo controller.
- Exibição no standalone: loop que monta `chat-msg`; localização tratada pelo texto que começa com “📍”.
- **Chat WEB (torre):** `backend/public/modulos/chat/js/script.js` e `index.html` — renderização em `message-content`, tratamento de links e localização em `conteudoRaw`; **incluir aqui o branch para TIPO AUDIO (player + transcrição)** e o preview “Última mensagem” para conversas.

Com isso, o Cursor pode implementar primeiro o upload e a exibição de áudio e, em seguida, a transcrição com IA e o idioma configurável, **aplicando as tratativas tanto no app motorista quanto no Chat da plataforma WEB**, sem quebrar o fluxo atual de texto e localização.
