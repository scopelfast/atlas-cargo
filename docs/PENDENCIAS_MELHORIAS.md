# Pendências e melhorias

**Objetivo:** Registrar melhorias e evoluções planejadas para o sistema (web, app motorista e backend), em um único lugar, junto com referências a planos maiores.

**Atualizado:** Março 2026

---

## Melhorias registradas

### 1. Cadastrar como cliente a partir do comprovante (POD)

**Contexto:** No módulo **Gerenciar Viagens** (web), ao abrir o modal de **Comprovantes de entrega (POD)** já é exibida a ficha completa de cada comprovante: recebedor, documento (CPF/RG), observações, foto, assinatura, local (mapa + coordenadas) e status de sincronização. Esses dados permitem identificar o **destino da entrega** como um possível cliente.

**Melhoria proposta:**
- Incluir no card de cada comprovante um botão **"Cadastrar como cliente"** (ou "Criar cadastro a partir deste comprovante").
- Ao acionar, abrir o fluxo de **Cadastro Geral** (ou tela equivalente) com campos pré-preenchidos:
  - Nome/Razão a partir do **nome do recebedor**;
  - **Documento** (CPF/CNPJ ou outro) já informado no comprovante;
  - Quando houver **endereço** (geocoding reverso a partir de lat/long ou campo futuro no app), pré-preencher endereço do cliente.
- Objetivo: transformar o comprovante de entrega em **lead/cliente** de forma direta, sem redigitar dados.

**Onde:** Modal de comprovantes (POD) em `backend/public/modulos/gerenciar-viagens/` (script.js + index.html).

**Impacto:** Médio – melhora captação de clientes a partir das entregas já realizadas.  
**Complexidade:** Média – integração com tela de cadastro geral e eventual geocoding reverso.

---

### 2. Multimoeda, multilíngua e múltiplos tipos de documento

**Contexto:** Evolução do sistema para suportar outros países (ex.: Paraguai, Argentina, Uruguai), com moeda local, idioma e tipo de documento (não apenas CPF/CNPJ), sem perder o cenário atual (Brasil, R$, português).

**Documento de referência:**  
**[docs/PLANO_MULTIMOEDA_MULTILINGUA_MULTIDOCUMENTO.md](PLANO_MULTIMOEDA_MULTILINGUA_MULTIDOCUMENTO.md)**

Esse plano descreve:
- Situação atual (documento, moeda, idioma, país/tenant).
- Impacto por área (documento, multimoeda, multilíngua).
- Proposta de configuração por país (CONFIG_PAIS), multimoeda, i18n e múltiplos tipos de documento.
- Anexos com referência documental e moedas (Mercosul).

**Status:** Análise e planejamento (conforme o próprio plano).  
**Uso:** Consultar o documento acima para detalhes e priorização quando for iniciada a implementação.

---

### 3. Envio de arquivo e imagem no Chat (motorista e operador)

**Contexto:** O chat hoje permite apenas **texto**, **localização** (link do mapa) e **áudio** (com transcrição opcional). Não existe opção para o motorista ou o operador enviar **imagens** (foto, comprovante, etc.) ou **arquivos** (PDF, documentos) pela conversa. O backend já aceita `tipo` como `IMAGEM` ou `ARQUIVO` no envio de mensagem, mas não há endpoint de upload nem interface para anexar arquivo/imagem.

**Melhoria proposta:**
- **Backend:** Criar endpoint de upload (ex.: `POST /api/messages/upload-file` ou `/upload-imagem` e `/upload-arquivo`), com multer, salvando em pastas em `public/uploads/` (ex.: `imagens/`, `arquivos/`), com nome único e validação de tipo/tamanho. Registrar mensagem com `TIPO` = `IMAGEM` ou `ARQUIVO` e `CONTENT` em JSON com `url` (e opcionalmente nome original do arquivo).
- **App motorista (chat standalone):** Botão de anexar (📎 ou ícone de imagem) que abre seletor de arquivo (e, se possível, câmera/galeria para foto). Enviar via FormData para o novo endpoint; exibir na lista de mensagens: imagem com `<img>` ou arquivo como link para download.
- **Chat WEB (módulo Chat – torre):** Mesmo botão de anexar na área de input; ao renderizar mensagens, tratar `TIPO === 'IMAGEM'` (exibir imagem) e `TIPO === 'ARQUIVO'` (exibir nome + link para download).

**Onde:**  
- Backend: `backend/controllers/message.controller.js`, `backend/routes/message.routes.js`, multer e pastas em `public/uploads/`.  
- Motorista: `backend/public/motorista/pages/chat-standalone.html`.  
- Chat WEB: `backend/public/modulos/chat/index.html`, `backend/public/modulos/chat/js/script.js`.

**Impacto:** Alto – permite enviar comprovantes, fotos de ocorrências e documentos direto no chat.  
**Complexidade:** Média – espelhar o fluxo já existente de upload de áudio (multer, CONTENT com url, exibição no front).

---

## Como usar este arquivo

- **Incluir nova melhoria:** adicionar uma seção numerada com título, contexto, proposta, onde (módulo/arquivos), impacto e complexidade.
- **Planos maiores:** manter como referência (link para `docs/...`) em vez de duplicar conteúdo; status e detalhes ficam no documento original.
