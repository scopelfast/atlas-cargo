# Plano: Cadastro de Motorista na Rua com OCR

**Objetivo:** Permitir que o cliente envie o link do app ao motorista por WhatsApp; o motorista acessa, informa o celular e completa o cadastro de forma rápida usando leitura de documento (CNH Brasil / Licença Paraguai) via OCR, com possibilidade de editar e enviar a foto do documento.

**Referência:** Pesquisa ChatGPT (plugin OCR JS) – Tesseract.js, jscanify, parsers CNH/Licencia PY, validação CPF/CI, envio FormData com foto, checagem de qualidade.

---

## 1. Situação atual

- **Front:** `cadastro.html` – formulário com Nome, CPF, Celular, E-mail, CNH, Categoria CNH, Senha, Confirmar Senha, Termos. **Todos os campos e o botão estão desabilitados** e a mensagem informa que o cadastro está temporariamente desabilitado.
- **Backend:** `POST /api/motorista-app/cadastro` existe mas retorna apenas *"Cadastro em desenvolvimento. Use o sistema web por enquanto."*
- **Banco:** Motoristas vêm de **CADASTROGERAL** (CGCCPF, RZSOCIAL, NRCELULAR, ENDEMAIL, FGMOTORISTA, FGTIPOCADASTRO, etc.) + **MOTORISTA_COMPLEMENTO** (NRCNH, CATEGORIACNH, VALIDADECNH, etc.). Login usa CGCCPF como documento.
- **Documento:** `documento.service.js` já tem `validarDocumento(pais, tipo, valor)` para BR (CPF/CNPJ) e PY (CI/RUC). CI Paraguai hoje validada por formato (5–9 dígitos); opcional depois: algoritmo com dígito verificador (módulo 11) como na pesquisa.

---

## 2. Fluxo desejado (cadastro na rua)

1. Motorista acessa o app (link enviado por WhatsApp).
2. **Passo 1 – Celular:** Informa **código do país (DDI)** + **número do celular** (obrigatório). Validação e armazenamento em formato internacional (ex.: E.164) para futura integração com switch.
3. **Passo 2 – Documento:** Tira **foto do documento** (CNH Brasil ou Licença Paraguai). Opcional: detecção de borda do documento (jscanify) antes do OCR.
4. **Passo 3 – Qualidade:** Sistema verifica se a foto é utilizável (resolução mínima, opcional: blur, confiança do OCR). Se ruim, pede nova foto.
5. **Passo 4 – OCR:** OCR no navegador (Tesseract.js) com idiomas `por+spa`. Identificação do tipo pelo texto:
   - "REPUBLICA FEDERATIVA DO BRASIL" → CNH BR → parser CNH.
   - "REPUBLICA DEL PARAGUAY" → Licença PY → parser Licença Paraguai.
6. **Passo 5 – Formulário:** Campos do cadastro são **pré-preenchidos** com o resultado do parser (nome, documento, data nascimento, categoria, validade, etc.). **Todos editáveis** pelo motorista.
7. **Passo 6 – Completar:** Motorista preenche/confere o que faltar: **país**, **estado**, **cidade de destino** (opcional), **tipo de carroceria/classe** (preferência de embarque), senha, termos. Conforme combinado com o cliente.
8. **Passo 7 – Envio:** Submit envia **dados do formulário + foto original do documento** (FormData). Backend valida documento conforme país/tipo, grava em CADASTROGERAL + MOTORISTA_COMPLEMENTO e armazena a foto (ex.: `/uploads/motoristas/<id>_documento.jpg`).

---

## 3. Dados a armazenar (alinhado ao que você descreveu + pesquisa)

| Dado | Onde (sugestão) | Observação |
|------|------------------|------------|
| Celular (DDI + número) | CADASTROGERAL.NRCELULAR (ou campo dedicado E.164) | Formato internacional; crítico para switch/WhatsApp |
| País do documento | CADASTROGERAL ou campo PAIS_DOCUMENTO | BR, PY, etc. |
| Tipo documento | Implícito (CPF vs CI) ou campo TIPO_DOCUMENTO | Para validação e exibição |
| Número documento | CADASTROGERAL.CGCCPF (reutilizado) ou NUMERO_DOCUMENTO | Normalizado (só dígitos); validação por país |
| Nome | CADASTROGERAL.RZSOCIAL | |
| Data nascimento | MOTORISTA_COMPLEMENTO ou CADASTROGERAL | Se existir coluna |
| CNH / Nº licença | MOTORISTA_COMPLEMENTO.NRCNH | |
| Categoria | MOTORISTA_COMPLEMENTO.CATEGORIACNH | |
| Validade documento/CNH | MOTORISTA_COMPLEMENTO.VALIDADECNH | |
| País / Estado / Cidade destino | Cadastro ou tabela de preferência | Para divulgação de cargas; cidade opcional |
| Classe (carroceria / preferência embarque) | CLASSEFROTA_CG (já existe) | Para “buscar disponíveis” |
| Foto do documento | Arquivo em disco + path no banco | Ex.: MOTORISTA_COMPLEMENTO.FOTO_DOCUMENTO ou CADASTROGERAL |
| Senha | Já existe (hash) | Definir/alterar no cadastro |
| Status aprovação | Já existe (pendente/aprovado/rejeitado) | Novo cadastro = pendente |

- **Validação de documento:** BR → CPF (já em `documento.service`). PY → CI (já validada por formato; opcional: DV módulo 11). Outros países: formato mínimo ou tabela configurável depois.

---

## 4. Stack técnica (conforme pesquisa)

- **OCR:** Tesseract.js (browser), idiomas `por+spa`.
- **Scanner de documento (opcional):** jscanify para detectar borda e corrigir perspectiva antes do OCR.
- **Parsers:** Funções JS para extrair do texto OCR:
  - CNH BR: CPF (regex), datas (regex), nome (linha/contexto), categoria (A/B/AB/C/D/E), validade, etc.
  - Licença PY: NOMBRE, APELLIDO, CI, data nascimento, nacionalidade, etc.
- **Identificação do documento:** Por trecho de texto (REPUBLICA FEDERATIVA DO BRASIL vs REPUBLICA DEL PARAGUAY).
- **Qualidade da foto:** Resolução mínima (ex.: 800x600); opcional: confiança do Tesseract (`result.data.confidence` &lt; 60 → pedir nova foto).
- **Envio:** FormData com campos do formulário + `documento` (File da foto). Backend: multipart, salvar arquivo e path no banco.

---

## 5. Fases sugeridas (ordem de implementação)

### Fase 1 – Backend e modelo de dados
- Definir/ajustar colunas necessárias (celular E.164, país documento, tipo documento, foto documento, país/estado/cidade destino, etc.) em CADASTROGERAL / MOTORISTA_COMPLEMENTO (ou script de migração).
- Implementar `POST /api/motorista-app/cadastro` de verdade:
  - Receber FormData (campos + arquivo foto).
  - Validar documento com `validarDocumento(pais, tipo, numero)`.
  - Inserir CADASTROGERAL (FGMOTORISTA/S, FGTIPOCADASTRO M, status aprovação pendente) + MOTORISTA_COMPLEMENTO.
  - Salvar foto em `/uploads/motoristas/` e gravar path no banco.
  - Retornar sucesso/erro e mensagem amigável (ex.: “Cadastro enviado. Aguarde aprovação.”).

### Fase 2 – Tela de cadastro (sem OCR)
- Reativar e reformular `cadastro.html`:
  - Passo 1: DDI + celular (máscara/validação por país).
  - Passo 2: Formulário completo (nome, documento, país documento, data nasc., CNH, categoria, validade, país/estado/cidade destino, classe/preferência, senha, termos).
  - Campos documento/nome/CNH/categoria/validade preenchíveis manualmente; país documento para escolher tipo (CPF vs CI) e validar.
- Submit para `POST /api/motorista-app/cadastro` (sem foto primeiro, ou com foto opcional).
- Garantir que os dados gravados batam com o que a divulgação de cargas e o login precisam.

### Fase 3 – OCR no navegador
- Incluir Tesseract.js (npm ou CDN) na página de cadastro.
- Botão “Tirar foto do documento” / “Usar câmera” (input file `accept="image/*" capture="environment"`).
- Após seleção da imagem:
  - (Opcional) Validar tamanho/resolução; opcional jscanify para recortar documento.
  - Chamar Tesseract.recognize(imagem, "por+spa"); obter texto.
  - identificarDocumento(texto) → CNH_BR ou LICENCIA_PY.
  - parseCNH(texto) ou parseLicenciaPY(texto) → objeto com nome, cpf/ci, dataNascimento, categoria, validade, etc.
  - Preencher os campos do formulário (todos editáveis).
- Guardar o File da imagem para enviar no FormData no submit.

### Fase 4 – Qualidade e UX
- Validação de imagem: tamanho mínimo; se Tesseract retornar confidence baixa, avisar “Foto ilegível, tente novamente”.
- Envio da foto no cadastro: campo `documento` no FormData; backend já preparado na Fase 1.
- Ajustes de copy e mensagens (cadastro enviado, aguardar aprovação, documento inválido, etc.).

### Fase 5 (opcional) – Melhorias
- jscanify: detectar borda do documento na câmera e recortar antes do OCR.
- Validação CI Paraguai com dígito verificador (módulo 11) em `documento.service`.
- Suporte a mais países (AR, UY, etc.): parser e validação por país.
- Leitura de PDF417/QR Code da CNH (ex.: zxing-js) para maior precisão quando disponível.

---

## 6. Integração com “divulgação de cargas” e switch

- **Divulgação:** Os campos país/estado/cidade destino e classe (preferência de embarque) devem estar disponíveis no cadastro e na consulta de “disponíveis” por viagem (regra flexível por viagem, como você comentou).
- **Switch (WhatsApp/SMS):** Celular sempre em formato internacional (E.164) no banco; na integração com o switch, enviar já normalizado. Definir com o fornecedor do switch o formato esperado.

---

## 7. Resumo do plano

| # | Fase | Entregável |
|---|------|------------|
| 1 | Backend e dados | Colunas necessárias; POST cadastro com FormData + foto; validação documento; gravar CADASTROGERAL + MOTORISTA_COMPLEMENTO + arquivo foto |
| 2 | Tela sem OCR | cadastro.html reativada: DDI+celular → formulário completo → submit (com ou sem foto) |
| 3 | OCR | Tesseract.js; captura imagem → OCR → identificar BR/PY → parser → preencher formulário; enviar foto no submit |
| 4 | Qualidade e UX | Checagem de qualidade da foto; mensagens claras; envio da foto obrigatório/opcional conforme regra |
| 5 | Opcional | jscanify; CI PY com DV; mais países; PDF417/QR CNH |

Quando você mandar, podemos começar pela **Fase 1** (backend e modelo de dados) e em seguida a **Fase 2** (tela de cadastro sem OCR), para só depois integrar o OCR na **Fase 3**.
