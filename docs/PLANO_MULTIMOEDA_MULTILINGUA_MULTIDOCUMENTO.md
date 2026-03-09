# Plano: Multimoeda, Multilíngua e Múltiplos Tipos de Documento

**Objetivo:** Permitir que o sistema rode em outros países (ex.: Paraguai, Argentina, Uruguai), com moeda local, idioma local e tipo de documento adequado (não apenas CPF/CNPJ), **sem perder o que já existe hoje** (Brasil, R$, português, CPF/CNPJ). O desenho deve permitir atender **todos os países do Mercosul** (e extensão a associados, se necessário).

**Data:** Março 2026  
**Status:** **Fases 0 a 4 concluídas.** Fase 3 (i18n): app motorista e 25 módulos web com i18n. **Fase 4:** Configurações com Contexto/Multipaís; Gerenciar Cadastro Geral com documento dinâmico; **Gerenciar Equipamentos** com label Placa/Matrícula por país; **utils.js** expõe `formatarMoeda` e `formatarDataHoraComFuso`; **Gerenciar Viagens** carrega contexto e usa `fmtDataHora` (locale + timezone) em logs; seletor de idioma no dashboard. **Formatação por contexto (locale/timezone):** concluída em Gerenciar Viagens, Relatório Convocações, convocacao.html, **Chat**, **Alertas**, **SOS**, **Gerenciar Equipamentos** (validades), **Gerenciar Cadastro Geral** (validades), **Gerenciar Logs Acesso**, **Gerenciar Mapa Viagem**. **Opcional (incremental):** backend errorKey em mais endpoints; formatação em páginas restantes do app motorista (viagens, dashboard, cargas, detalhes-viagem, etc.).

### Onde ver cada coisa (resumo para o usuário)

| O que | Onde está hoje |
|-------|-----------------|
| **Moeda** | Gerenciar Viagens (campo Moeda); Configurações (Moeda padrão); `window.formatarMoeda` em utils.js. |
| **Linguagem** | Login web e Dashboard (PT/ES); Configurações (Idioma padrão); App motorista (contexto). |
| **Fuso horário** | Configurações (Fuso); backend retorna `timezone`; `formatarDataHoraComFuso` em utils.js; Gerenciar Viagens usa `fmtDataHora` com contexto. |
| **Tipo de documento** | App motorista e Configurações; Gerenciar Cadastro Geral (label/máscara/validação por país). |
| **Placa/Matrícula** | Gerenciar Equipamentos: label e placeholder por país (BR = Placa, PY/AR/UY = Matrícula). |
| **Configuração** | Gerenciar Configurações: Contexto/Multipaís, Identidade visual, Mapa e Roteamento (padrão de layout). |

### Correção aplicada (formulário de filtro)

Em vários módulos (Gerenciar Empresas, Gerenciar Filiais, etc.), ao clicar em "Aplicar" no filtro pela primeira vez a página voltava à tela principal; na segunda vez o filtro era aplicado. **Causa:** o `<form id="filtroForm">` usava botão `type="submit"` e o script que chama `e.preventDefault()` podia rodar depois do primeiro clique, permitindo o submit nativo do navegador. **Solução:** em todos os 19 módulos com filtro, foi adicionado **`onsubmit="return false;"`** no `<form id="filtroForm">` no HTML, de modo que o formulário nunca faça submit nativo. Regra em `.cursor/rules/form-submit-anti-duplicacao.mdc` para futuros módulos.

### Backlog / itens opcionais (incrementar quando for o momento)

- **Relatório de Validades Fase 2:** dashboard de alertas, relatório vencidas/vencendo, exportação.
- **Botão "Cadastrar como cliente" no POD** (modal POD em Gerenciar Viagens).

Podem ser feitos depois, quando for o momento; não bloqueiam o plano multimoeda/multilíngua.

---

## 1. Situação atual (o que temos hoje)

### 1.1 Documento de identificação (CPF/CNPJ)

| Onde | O que existe | Impacto |
|------|--------------|---------|
| **Banco de dados** | Tabela `CADASTROGERAL`: campo `CGCCPF` (varchar 14), único. Usado para pessoa física (CPF 11 dígitos) e jurídica (CNPJ 14). | Núcleo: um único campo guarda “documento”. |
| **Backend – login motorista** | `motorista-app.controller.js`: login por CPF + senha; busca `WHERE CGCCPF = @cpf1 OR CGCCPF = @cpf2` (com/sem zero à esquerda). | Todo login hoje é por CPF. |
| **Backend – cadastro** | `cadastrogeral.controller.js`: `validarCPF()` e `validarCNPJ()`; mensagens "CPF inválido", "CNPJ inválido", "Já existe cadastro com este CPF/CNPJ". | Validação e mensagens fixas em PT-BR. |
| **Backend – outros** | `empresa.routes.js`, `filial.routes.js`: `validarCNPJ()`. Scripts SQL/JS (criar motorista, definir senha, diagnóstico) usam CPF. | Vários pontos acoplados a CPF/CNPJ. |
| **Front-end – app motorista** | Login: label "CPF", placeholder "000.000.000-00". Cadastro, recuperar senha, dashboard: "CPF", "CPF/CNPJ". | Textos e máscara fixos. |
| **Front-end – admin** | Gerenciar cadastro geral, empresas, filiais, usuários, viagens: campos e validações CPF/CNPJ, `formatarCPFCNPJ()`. | Muitas telas com documento brasileiro. |

**Resumo:** O documento está em um único campo (`CGCCPF`), com validação e máscara brasileiras espalhadas no backend e no front.

### 1.2 Moeda

| Onde | O que existe | Impacto |
|------|--------------|---------|
| **Banco** | Valores monetários em colunas numéricas (ex.: `VLFRETE`, valores em viagens/convocações) **sem** coluna de moeda. | Assume-se uma moeda por instalação. |
| **Front-end** | Ex.: `cargas.html`, `convocacoes.html`: `formatarMoeda` com `Intl.NumberFormat('pt-BR', { currency: 'BRL' })`. Outros módulos: formatação R$ ou pt-BR. | Moeda e locale fixos. |

**Resumo:** Não há conceito de “moeda do tenant” ou “moeda da viagem”; tudo é tratado como real.

### 1.3 Idioma

| Onde | O que existe | Impacto |
|------|--------------|---------|
| **Front-end** | Textos em português direto no HTML/JS (labels, botões, mensagens, placeholders). | Sem camada de i18n. |
| **Backend** | Mensagens de erro e sucesso em português (ex.: "Motorista não encontrado", "CPF inválido"). | APIs devolvem texto fixo em PT. |
| **Formatação** | Uso de `toLocaleDateString('pt-BR')`, `toLocaleString('pt-BR')`, `Intl.NumberFormat('pt-BR', ...)` em vários arquivos. | Datas e números sempre em padrão BR. |

**Resumo:** Não há tabela de traduções nem chaves de i18n; tudo é texto fixo em português.

### 1.4 País / tenant

- Tabela **PAIS** existe (`CDPAIS`, `DSPAIS`, `SGPAIS`).
- **CIDADE** tem `CDPAIS`.
- **Não existe** hoje: “país padrão da instalação”, “tenant”, ou “locale/moeda por país” configurável.

### 1.5 Fuso horário

| Onde | O que existe | Impacto |
|------|--------------|---------|
| **Banco** | Datas/horas em colunas datetime (viagem, convocação, rastreamento, logs). SQL Server: `SYSUTCDATETIME()`; PostgreSQL: depende do timezone da sessão. | Não há convenção explícita "sempre UTC" nem timezone por entidade. |
| **Backend** | Vários pontos tratam data "sem conversão de fuso" ou usam `toLocaleString('pt-BR')`. | Comportamento misto; parte assume "fuso Brasil". |
| **Front-end** | `toLocaleString('pt-BR')` ou extração manual. Sem preferência de fuso por usuário/filial. | Datas exibidas no fuso do navegador ou como "local BR". |

**Resumo:** Não há **fuso horário por país** nem por usuário/filial. Para multipaís, datas devem ser exibidas no fuso correto. Recomendação: **UTC no banco**; conversão para exibição conforme timezone do contexto (país/filial ou dispositivo).

---

## 2. Impacto por área

### 2.1 Documento (CPF/CNPJ → multi-tipo)

- **Banco:** Manter `CGCCPF` para compatibilidade. Incluir **novos** campos ou tabela de configuração por país:
  - Ex.: `CDPAIS` (ou “tenant”) + `TIPO_DOCUMENTO` (ex.: `CPF`, `CNPJ`, `RUC`, `CI`, `DNI`) + regras de tamanho/máscara/validação.
- **Backend:**
  - Abstrair validação: por tipo de documento (ou por país) chamar `validarCPF`, `validarCNPJ` ou validador genérico (ex.: RUC Paraguai).
  - Login motorista: aceitar “documento” (não só CPF); buscar por documento normalizado conforme regras do país.
  - Cadastro geral, empresa, filial: mesmo conceito (tipo de documento configurável por contexto).
- **Front-end:**
  - Label e placeholder do login/cadastro vindos de configuração ou i18n (ex.: "CPF", "RUC", "CI").
  - Máscara e validação conforme tipo de documento do país/tenant.
- **Scripts e integrações:** Scripts que hoje recebem “CPF” devem passar a aceitar “documento” e, quando for Brasil, manter comportamento atual.

**Risco:** Alto se mudarmos o significado de `CGCCPF` sem compatibilidade. **Mitigação:** manter `CGCCPF` como valor do documento (string); o “tipo” e a validação vêm de configuração por país/tenant.

### 2.2 Multimoeda

- **Banco:**
  - Opção A: Coluna `CDMOEDA` ou `CODIGO_MOEDA` (ex.: BRL, PYG) em tabelas que têm valor (ex.: viagem, convocação, carga).
  - Opção B: Moeda padrão por “tenant/país” e coluna só onde for multi-moeda (ex.: oferta em outra moeda).
- **Backend:** Onde houver valor monetário, considerar moeda (do tenant ou da entidade) e retornar código da moeda para o front.
- **Front-end:** `formatarMoeda(valor, codigoMoeda)` usando `Intl.NumberFormat(locale, { currency: codigoMoeda })`. Locale e moeda padrão vindo de configuração/i18n.

**Risco:** Médio. Impacto maior em relatórios e listagens que somam valores (garantir mesma moeda ou conversão explícita).

### 2.3 Multilíngua

- **Backend:**
  - Preferência: APIs retornarem **chaves** de mensagem (ex.: `error.driver_not_found`) e o front montar o texto; ou aceitar header `Accept-Language` e devolver mensagem já traduzida a partir de um dicionário por idioma.
- **Front-end:**
  - Introduzir camada i18n: arquivos de tradução (ex.: `pt-BR.json`, `es-PY.json`) e função `t('chave')` em todas as telas (motorista e admin).
  - Substituir textos fixos por chaves gradualmente (por módulo/tela).
- **Formatação:** Datas e números usando locale do usuário (ex.: `es-PY`, `pt-BR`) em vez de `pt-BR` fixo.

**Risco:** Alto em esforço (muitas telas e mensagens), baixo em quebrar lógica se for feito por etapas (um módulo por vez).

### 2.4 Fuso horário

- **Banco:** Definir convenção: **armazenar sempre em UTC** (ou que o servidor use timezone UTC para gravação/leitura). Não é obrigatório alterar colunas existentes; o importante é que, ao enviar dados ao front ou a integrações, o valor seja inequívoco (ex.: ISO 8601 com "Z" para UTC).
- **Config por país:** Em **CONFIG_PAIS** (ou CONFIGURACAO), incluir **timezone** por país (ex.: `America/Sao_Paulo`, `America/Asuncion`, `America/Argentina/Buenos_Aires`, `America/Montevideo`). Assim, ao exibir datas para um contexto (filial, operador, motorista), o sistema converte UTC → timezone daquele contexto.
- **Front-end:** Usar o **locale + timezone** do usuário (ou da filial/país selecionado): `Intl.DateTimeFormat(locale, { timeZone: timezoneId, dateStyle, timeStyle })` ou `toLocaleString(locale, { timeZone: timezoneId })`. O timezone pode vir do contexto (GET /api/contexto) junto com pais e locale.
- **App motorista:** Preferência de fuso pode ser do **país do cadastro do motorista** (ou do dispositivo); o backend já pode retornar o timezone no contexto quando houver país definido.

**Risco:** Médio. Quem hoje assume "data já está em horário de Brasília" pode precisar de ajuste para interpretar como UTC e depois converter. Fazer em etapa dedicada (ex.: após i18n estável) para não misturar com mudanças de idioma/moeda.

### 2.5 Documentos e identificação de veículos (Brasil vs Mercosul/outros)

No **Brasil** o cadastro de veículos usa regras específicas que em outros países (inclusive Mercosul) podem ser diferentes:

| Aspecto | Brasil (hoje) | Outros países (ex.: Mercosul) |
|--------|----------------|--------------------------------|
| **Placa** | Formato antigo `AAA-9999` ou Mercosul `AAA9A99`; máscara e validação fixas. | Paraguai, Argentina etc. podem ter formato e tamanho diferentes. |
| **Documento do veículo** | **RENAVAM** (11 dígitos) — nome e regra brasileiros. | Outros países têm equivalente com outro nome e formato (ex.: documento único do veículo, registro nacional, etc.). |

**Onde isso aparece no sistema:**

- **Gerenciar Equipamentos:** campo de identificação do equipamento (hoje usado como “placa” em `REFEQUIPAMENTO`); sem conceito de “documento do veículo” na tabela `EQUIPAMENTO`.
- **App motorista – cadastro de veículo:** tabela `MOTORISTA_VEICULO` com `PLACA` (varchar 10) e `RENAVAM` (varchar 11); labels e validação fixos para Brasil.
- **Gerenciador de viagens:** busca de equipamento por placa; sem regra por país.

**Onde a máscara está hoje:** Em **Gerenciar Tipos de Equipamento**, na tabela `TIPOEQUIPAMENTO`, existe o campo **`MASCARAIDENTIF`** (Máscara de Identificação), opcional, até 50 caracteres. Ele é editável por tipo (ex.: Caminhão, Carreta), mas **não é usado** na tela de Gerenciar Equipamentos ao validar ou formatar o campo Referência/placa — ou seja, hoje a máscara é apenas metadado do tipo, sem efeito na validação.

**Resumo:** Para multipaís é necessário tratar **máscara de placa** e **tipo/nome do documento do veículo** por país (ex.: CONFIG_PAIS ou tabela de regras), e aplicar em Equipamentos e no cadastro de veículo do motorista.

---

## 3. Proposta refinada (decisão) — idioma no login, moeda na viagem, país em empresa/filial/cadastro

Abaixo está a **proposta consolidada** com as decisões de desenho, alinhada ao que já existe no sistema.

### 3.1 Idioma: escolha no login (web + app motorista)

- No momento do **login** (tanto no painel web quanto no módulo do motorista), a pessoa **escolhe o idioma** (ex.: Português, Español).
- Esse idioma define o **locale da sessão** e faz o sistema exibir toda a interface na língua escolhida (i18n), não “tradução do browser” — ou seja, a aplicação carrega o arquivo de tradução correspondente (pt-BR, es-PY, etc.) e usa nas telas.
- **Vantagem:** Simples para o usuário, funciona para multi-idioma sem depender de configuração global; cada um usa o idioma que preferir.

### 3.2 Moeda: combo no cadastro da viagem (reaproveitar o que já existe)

- No **gerenciador de viagens** já existe (ou existirá) **combo para escolher a moeda** no momento do cadastro da viagem.
- **Manter esse desenho:** a moeda fica vinculada à **viagem** (ou à carga/oferta, conforme o módulo). Não é necessário “moeda global” obrigatória; onde hoje há valor monetário na viagem, a combo define a moeda daquele registro.
- **Complemento:** Na configuração da **empresa** e da **filial** (com país), podemos definir **moeda padrão** para sugerir na abertura da viagem (ex.: empresa no Paraguai → default PYG). A escolha final continua na tela da viagem.

### 3.3 País em Empresa e Filial — origem das regras (moeda, idioma, documento)

- Na **configuração/manutenção do cadastro da empresa** e das **filiais**, incluir o campo **País** (relacionado à tabela `PAIS`).
- A partir do **país** da empresa/filial, o sistema passa a poder:
  - **Moeda:** definir moeda padrão (ex.: BR → BRL, PY → PYG) para sugerir em viagens e formatação.
  - **Idioma:** definir idioma padrão sugerido (ex.: pt-BR, es-PY) para o contexto daquela empresa/filial (pode ser usado como default no login quando houver vínculo usuário→empresa/filial).
  - **Tipo de documento:** definir as regras de documento pelo país (Brasil: CPF/CNPJ; Paraguai: RUC/CI, etc.) para validar cadastros vinculados a essa empresa/filial.
- **Vantagem:** Uma única fonte de verdade (país) na empresa e na filial; moeda, idioma e documento ficam consistentes e validados por país, sem “tenant global” rígido.

### 3.4 Empresa e Filial — padrões na viagem e autonomia do operador

- **Padrões em Empresa e Filial:** As tabelas de **empresa** e **filial** guardam os **valores padrão** (moeda padrão, país, idioma sugerido) usados como **default** ao abrir uma nova viagem no **gerenciamento de viagens**. Ex.: filial no Paraguai → ao criar viagem, o sistema sugere moeda PYG e país PY; filial no Brasil → sugere BRL e BR.
- **Carregar como padrão na viagem:** Na **abertura/cadastro da viagem**, o sistema **pré-preenche** moeda (e outros campos derivados de empresa/filial) com esses padrões. O operador trabalha com valores coerentes ao contexto da filial.
- **Autonomia do operador:** Se for necessário **alterar** (ex.: moeda no ato da contratação), o **operador tem autonomia** para alterar na tela da viagem (ex.: combo de moeda). A escolha final fica na viagem; empresa/filial são **sugestão**, não trava.
- **Controle e rastreabilidade:** O valor **efetivo** (moeda, etc.) é gravado na **própria viagem** (coluna `MOEDA` na tabela da viagem). Fica registrado o que foi contratado; com auditoria (SGUSER, DHMAINTENANCE ou log), é rastreável quem alterou e quando. Operação segura, controlada e profissional.

### 3.5 Cadastro geral (pessoas) — país da pessoa (do documento)

- No **cadastro e gerenciamento de pessoas (Cadastro Geral)**, o **país** deve ser da **própria pessoa** (país do documento/titular), não obrigatoriamente o país da empresa/filial. Assim, mesmo operando no Paraguai, ao cadastrar um **motorista brasileiro** contratado de outro país, você informa **País = Brasil** para aquele cadastro → o sistema valida **CPF/CNPJ**. Ao cadastrar um paraguaio, **País = Paraguai** → valida **RUC/CI**.
- **Onde controlar:** Em **Gerenciar Cadastro Geral**, cada pessoa tem campo **País** (CDPAIS). A validação do documento (CGCCPF) usa sempre o **país daquele cadastro**. Sugestão de default ao criar: país da filial/empresa em que está cadastrando (para não mudar fluxo quando todos são do mesmo país); mas o campo fica editável para refletir o país real do documento.
- **Compatibilidade:** Registros sem país continuam tratados como Brasil (CPF/CNPJ) até preenchimento ou migração.

### 3.6 Equipamentos e veículos — país do veículo (não só da filial)

- Mesmo operando no **Paraguai**, você pode **contratar veículo de outro país** (ex.: Brasil). A validação da **placa** e do **documento do veículo** (RENAVAM ou equivalente) deve seguir o **país daquele veículo**, não o país da filial.
- **Onde controlar:** Em **Gerenciar Equipamentos**, cada equipamento tem campo **País (do veículo)** (ex.: CDPAIS na tabela EQUIPAMENTO). Ao cadastrar um caminhão brasileiro na filial paraguaia, você informa **País = Brasil** → o sistema aplica máscara de placa brasileira e valida RENAVAM. Veículo paraguaio → **País = Paraguai** → máscara e documento do veículo conforme Paraguai. Default ao criar: país da filial (para não mudar o fluxo quando todos os veículos são locais); campo editável para refletir o país real do veículo.
- No **app motorista** (cadastro de veículo em MOTORISTA_VEICULO), o mesmo: campo **País do veículo** (ou inferido do país do cadastro do motorista); validação de placa e documento do veículo conforme esse país.
- **Resumo:** Documento da **pessoa** → controlado em **Gerenciar Cadastro Geral** (País do cadastro). Documento/placa do **veículo** → controlado em **Gerenciar Equipamentos** e no cadastro de veículo do motorista (País do veículo). Assim você opera em um país e contrata pessoas e veículos de qualquer país, com validação correta em cada um.

### 3.7 Avaliação da proposta

| Aspecto | Avaliação |
|--------|------------|
| **Idioma no login** | Faz total sentido. Escolha explícita do usuário; implementação = salvar preferência (session/localStorage) e carregar o bundle i18n correspondente. Não depende de “forçar tradução do browser” — a aplicação já exibe no idioma escolhido. |
| **Moeda na viagem (combo)** | Muito bom. Reaproveita o que você já tem no gerenciador de viagem; evita duplicar conceito. Só garantir que a coluna de moeda exista onde o valor da viagem é gravado e que o front use essa moeda na formatação. |
| **País em empresa e filial** | Excelente. Centraliza regras por país (moeda, idioma, documento) onde faz sentido de negócio. Permite operar Brasil e Paraguai (ou outros) na mesma instalação, com empresas/filiais em países diferentes. |
| **País/cadastro geral** | Alinhado. Pessoa com país definido (ou herdado) tem documento validado pelo tipo daquele país. Cadastro geral sem país continua válido (default BR). |

**Conclusão:** A proposta faz sentido, reduz complexidade (idioma no login; moeda onde já existe; país como eixo em empresa, filial e pessoas) e mantém compatibilidade com o que já existe. Recomenda-se adoptar este desenho e refletir nas fases de implementação abaixo.

### 3.8 Escopo de cadastros impactados (validação)

Lista das áreas onde **precisamos nos preocupar** com país, tipo de documento (pessoa/empresa) e, quando aplicável, **documento/máscara de veículo**:

| Área | Documento pessoa/empresa | Documento/placa veículo | Observação |
|------|---------------------------|--------------------------|-------------|
| **Gerenciar Cadastro Geral** | Sim (CPF/CNPJ → multi-tipo por país) | Não | Cadastro de pessoas; país define tipo e validação do documento. |
| **Gerenciar Equipamentos** | Não | Sim (placa + doc. veículo) | Cada equipamento tem **País (do veículo)**; máscara e doc. veículo conforme esse país (permite contratar veículo de outro país). |
| **Gerenciar Usuários** | Indireto (via Cadastro Geral) | Não | Usuário vinculado a um cadastro (pessoa); documento é o do cadastro; labels/busca "CPF/CNPJ" devem seguir regra do país. |
| **Gerenciar Empresas** | Sim (CNPJ → RUC etc. por país) | Não | País na empresa; documento jurídico validado por país. |
| **Gerenciar Filiais** | Sim (idem) | Não | País na filial; documento por país. |
| **App motorista – cadastro** (`/motorista/pages/cadastro.html`) | Sim (documento da pessoa) | Sim (se cadastrar veículo: placa + RENAVAM ou equivalente) | Cadastro do motorista (pessoa) e, onde houver, cadastro de veículo (MOTORISTA_VEICULO): placa e documento do veículo por país. |

**Validação:** A lista que você indicou está **correta e suficiente** para os cadastros que **gerenciam** dados sensíveis a país/documento/veículo. Outros módulos (convocações, viagens, SOS, mapa, etc.) **consomem** esses dados (ex.: exibem documento formatado, buscam por placa) e devem usar a mesma configuração de país e os mesmos formatadores/validadores; não precisam de "cadastro" próprio, apenas respeitar o contexto (empresa/filial/cadastro) para máscara e validação.

**Resumo:** Cadastro Geral, Equipamentos, Usuários, Empresas, Filiais e o cadastro do motorista (`cadastro.html`) cobrem o escopo de **onde** aplicar regras por país. Incluir em Equipamentos e no cadastro de veículo do motorista as regras de **placa** e **documento do veículo** por país (RENAVAM no Brasil; equivalente em outros).

---

## 4. Arquitetura técnica (detalhes)

### 4.1 País como eixo (empresa, filial, cadastro)

- **EMPRESA:** Adicionar coluna `CDPAIS` (FK para `PAIS`). Opcional: `IDIOMA_PADRAO`, `MOEDA_PADRAO` ou derivar de tabela de parâmetros por país.
- **FILIAL:** Adicionar coluna `CDPAIS` (ou herdar da empresa; se filial puder ser em outro país, manter `CDPAIS` na filial).
- **CADASTROGERAL:** Adicionar coluna `CDPAIS` (opcional, nullable). Se NULL, tratar como Brasil para validação de documento (compatibilidade). País = **da pessoa/documento**, para permitir contratar motorista de outro país.
- **EQUIPAMENTO:** Adicionar coluna `CDPAIS` (opcional, nullable). País = **do veículo** (origem da placa/documento). Se NULL, tratar como Brasil. Permite operar em PY e cadastrar veículo BR com placa e RENAVAM validados por Brasil.
- **MOTORISTA_VEICULO:** Adicionar coluna `CDPAIS` (opcional, nullable). País do veículo cadastrado pelo motorista; validação de placa e documento conforme esse país.
- Tabela **PAIS** já existe. Criar tabela **CONFIG_PAIS** (ou entradas em **CONFIGURACAO**) com: `CDPAIS`, `SGPAIS`, `MOEDA_PADRAO`, `IDIOMA_PADRAO`, **`TIMEZONE`** (ex.: America/Sao_Paulo, America/Asuncion), `TIPO_DOC_FISICA`, `TIPO_DOC_JURIDICA`, máscaras e nome do validador, para centralizar regras.

### 4.2 Exemplo de configuração por país (regras)

| Chave / País | Idioma | Moeda | Fuso horário | Tipo documento (pessoa) | Máscara doc | Validador | Placa veículo | Doc. veículo |
|--------------|--------|-------|----------------|--------------------------|-------------|-----------|----------------|--------------|
| BR | pt-BR | BRL | America/Sao_Paulo | CPF / CNPJ | 000.000.000-00 / 00.000.000/0000-00 | validarCPF / validarCNPJ | AAA-9999 ou AAA9A99 | RENAVAM (11 díg.) |
| PY | es-PY | PYG | America/Asuncion | RUC / CI | 80000000-0 / 0000000 | validarRUC (a implementar) | (definir formato PY) | (nome/regra local) |
| AR | es-AR | ARS | America/Argentina/Buenos_Aires | DNI / CUIT-CUIL | (definir máscaras AR) | validarDNI / validarCUIT (a implementar) | (definir formato AR) | (doc. veículo AR) |
| UY | es-UY | UYU | America/Montevideo | CI / RUT | (definir máscaras UY) | validarCI / validarRUT (a implementar) | (definir formato UY) | (doc. veículo UY) |

- **Brasil:** Comportamento atual preservado (CPF/CNPJ, BRL, pt-BR; placa e RENAVAM como hoje).
- **Paraguai, Argentina, Uruguai (e outros Mercosul):** Mesmo mecanismo: incluir linha em CONFIG_PAIS com moeda, idioma, tipo de documento (pessoa/empresa), máscara de placa e documento do veículo; implementar validadores e arquivo de locale quando for ativar o país. **Para atender todos os países do Mercosul**, basta cadastrar cada país em CONFIG_PAIS e implementar os validadores e regras locais (documento, placa, doc. veículo) conforme a necessidade de negócio.

### 4.3 Documento

- **Banco:** Manter `CGCCPF`; armazenar o documento **normalizado** (só números ou padrão único). Tipo do documento não precisa estar em toda linha se for único por país; pode vir da config do país.
- **Regras por país:** Nova tabela ou JSON em config (ex.: `TIPOS_DOCUMENTO`): código do país, tipo (F/J ou “RUC”, “CI”), tamanho min/max, máscara, nome do validador.
- **Validadores:** Manter `validarCPF` e `validarCNPJ`; adicionar `validarRUC`, `validarCI`, etc., e um dispatcher que escolhe o validador pelo tipo/país.
- **Login:** Campo “Documento” (label e máscara conforme país); backend continua buscando por valor em `CGCCPF`, mas a normalização e a validação usam as regras do país configurado.

### 4.4 Documentos e identificação de veículos (placa + documento do veículo)

- **Onde controlar a máscara de placa:** O formato da placa é definido **por país** (ex.: Brasil AAA-9999/AAA9A99, Paraguai outro padrão), não por tipo de veículo (caminhão vs carreta). Por isso a **fonte de verdade** para máscara e validação da placa deve ser **por país** (CONFIG_PAIS), **não** em Gerenciar Tipos de Equipamento.
- **Tipo de Equipamento hoje:** Existe `MASCARAIDENTIF` em `TIPOEQUIPAMENTO` (Gerenciar Tipos de Equipamento); é opcional e **não é usada** na validação do campo Referência/placa. Recomendação: **manter** o campo como está (opcional, informativo ou hint por tipo, se no futuro quiserem exibir “formato esperado” ao escolher o tipo). A **validação e a máscara aplicadas** na tela de Equipamentos e no app motorista devem vir de **CONFIG_PAIS** (país da filial/empresa ou do cadastro), não de `MASCARAIDENTIF`.
- **Banco:** Manter `PLACA` e `RENAVAM` em `MOTORISTA_VEICULO`; `REFEQUIPAMENTO` em `EQUIPAMENTO`. O significado (máscara, tamanho, nome do documento) vem da configuração **por país**.
- **Config por país (CONFIG_PAIS):** Incluir: **máscara de placa** (ex.: AAA-9999, AAA9A99); **tipo/nome do documento do veículo** (ex.: "RENAVAM" no Brasil); **tamanho e validador** do documento do veículo.
- **País do veículo (não da filial):** A máscara e o documento do veículo são validados pelo **país daquele veículo** (CDPAIS em EQUIPAMENTO ou MOTORISTA_VEICULO). Assim, em Gerenciar Equipamentos e no app motorista, ao cadastrar um veículo brasileiro numa filial paraguaia, informa-se País = Brasil e aplicam-se placa + RENAVAM. Default ao criar: país da filial (ou do cadastro); campo editável.
- **Onde aplicar:** (1) **Gerenciar Equipamentos** — campo País (do veículo) por equipamento; referência/placa e doc. veículo com máscara e validação conforme esse país; (2) **App motorista – cadastro de veículo** — País do veículo (ou inferido); label "RENAVAM" ou equivalente e máscara de placa conforme esse país.
- **Compatibilidade:** Brasil mantém "Placa" e "RENAVAM" e regras atuais; outros países usam mesmo campo físico com máscara e validador configurados. Opcional: em instalações só-Brasil, o valor de `MASCARAIDENTIF` do tipo pode ser usado como hint visual se não houver CONFIG_PAIS preenchido.

### 4.5 Multimoeda

- **Viagem:** Combo de moeda no cadastro da viagem (reaproveitar o existente); coluna `MOEDA` na tabela da viagem. **Default na abertura:** moeda (e demais padrões) vêm da empresa/filial selecionada; **valor efetivo** gravado na viagem — operador pode alterar no ato da contratação; rastreabilidade via dados da viagem e auditoria (SGUSER/DHMAINTENANCE).
- **Front-end:** `formatarMoeda(valor, codigoMoeda)` usando a moeda da viagem (ou entidade); locale do usuário (idioma escolhido no login) para formato de número/data.

- **Moeda padrão por país (legado):** Config “moeda” por país (BRL, PYG, etc.).
- **Onde guardar:** Em tabelas que têm valor (ex.: viagem, convocação): coluna opcional `MOEDA` (default do país). Se não existir coluna, assumir moeda do país na leitura.
- **Front-end:** Sempre formatar com a moeda da entidade (ou padrão); número e datas com locale do usuário.

#### 4.5.1 Quantidade de decimais (moeda e valores numéricos)

- **Moeda — decimais por moeda:** Cada moeda tem convenção própria de casas decimais na exibição (e muitas vezes na circulação). Exemplos: **BRL, USD, EUR** → 2 decimais (centavos); **PYG, JPY, KRW** → 0 decimais (unidade mínima é a própria moeda); **BHD, KWD** → 3 decimais. O padrão ISO 4217 define a “unidade fracionária” por moeda; usar isso na formatação evita confusão (ex.: mostrar “1.234” em PYG em vez de “1.234,00”).
- **Onde configurar:** Em **CONFIG_PAIS** ou em uma tabela **MOEDA** (código, nome, `QTD_DECIMAIS`): guardar a quantidade de decimais por moeda. Na formatação: `formatarMoeda(valor, codigoMoeda)` deve usar `minimumFractionDigits` e `maximumFractionDigits` conforme essa configuração (ex.: PYG → 0; BRL → 2).
- **Armazenamento no banco:** Manter valores monetários em tipo numérico (ex.: `NUMERIC(18,4)` ou 2 decimais fixos), nunca em float, para evitar erros de arredondamento. Arredondar para a quantidade de decimais da moeda apenas na **exibição** (e, se necessário, em relatórios/exportação).
- **Outros valores numéricos (peso, distância, cubagem):** Já tratados no sistema com padrão pt-BR (vírgula decimal, casas definidas por contexto — ex.: distância 2 decimais, peso até 2). No plano multilíngua/multimoeda, manter: **separador decimal e de milhares** vêm do **locale** do usuário; a **quantidade de decimais** pode ser fixa por tipo de grandeza (ex.: peso sempre 0 ou 2) ou configurável por tenant, para consistência entre telas e relatórios.

**Resumo:** Definir “quantidade de decimais” por **moeda** (config/MOEDA) para valores monetários; para peso/distância/cubagem, usar locale para formato e quantidade de decimais padronizada por tipo de dado. Isso deixa o plano multimoeda consistente e evita confusão para o motorista e para o operador.

### 4.6 Fuso horário

- **Convenção de armazenamento:** Gravar datas/horas no banco em **UTC** (ou com timezone explícito). Em SQL Server: `SYSUTCDATETIME()` ou equivalente; em PostgreSQL: `timestamp with time zone` (armazena em UTC). APIs que devolvem datas devem enviar em ISO 8601 com "Z" (UTC) ou com offset, para o front converter sem ambiguidade.
- **CONFIG_PAIS:** Incluir coluna ou chave **TIMEZONE** (IANA, ex.: `America/Sao_Paulo`, `America/Asuncion`). O contexto da aplicação (GET /api/contexto) pode retornar `timezone` derivado do país da filial/empresa ou do usuário.
- **Front-end – exibição:** Ao formatar data/hora, usar `Intl.DateTimeFormat(locale, { timeZone: timezoneId, dateStyle, timeStyle })` ou `toLocaleString(locale, { timeZone: timezoneId })`, onde `timezoneId` vem do contexto (ou do dispositivo no app motorista). Assim, "Data da viagem", "Última atualização", "Próximo envio GPS" aparecem no fuso correto.
- **App motorista:** Timezone pode ser o do **país do cadastro** (contexto) ou o do **dispositivo** (`Intl.DateTimeFormat().resolvedOptions().timeZone`); definir regra de negócio (ex.: prioridade país do cadastro, fallback dispositivo).
- **Compatibilidade:** Onde hoje se usa "extrair componentes UTC e exibir como local" ou `toLocaleString('pt-BR')`, migrar gradualmente para: (1) garantir que o valor no backend seja UTC; (2) passar a usar locale + timezone do contexto na formatação.

### 4.7 Multilíngua (i18n)

- **Login:** Escolha do idioma na tela de login (web + motorista); gravar em sessão/localStorage e carregar o bundle `locales/{locale}.json`.
- **Estrutura:** `locales/pt-BR.json`, `locales/es-PY.json`, etc. Função `t('chave')` em todo texto; formatação (data, número) com **locale e timezone** do usuário/contexto.
- **Backend:** Mensagens de erro por chave ou por `Accept-Language`; front exibe com `t()`.

---

## 4. Plano de implementação em fases (sem quebrar o atual)

### Fase 0 – Preparação (sem mudar comportamento) ✅ Implementada

1. **Configuração de país/tenant**
   - Entradas em `CONFIGURACAO`: chaves `pais_padrao`, `idioma_padrao`, `moeda_padrao`, `tipo_doc_fisica`, `tipo_doc_juridica`. Script opcional: `backend/scripts/init_config_contexto.sql`.
   - Backend: `services/contexto.service.js` com `getContexto()` (cache 1 min); rota `GET /api/contexto` retorna contexto atual. Default: BR, pt-BR, BRL, CPF, CNPJ.

2. **i18n – estrutura**
   - `backend/public/motorista/locales/pt-BR.json` com chaves para login e footer; `motorista/js/i18n.js` carrega locale (via `/api/contexto`) e expõe `t('chave')` e `i18nReady`.
   - Tela piloto: login motorista (`motorista/index.html`) com `data-i18n` / `data-i18n-placeholder` / `data-i18n-title`; script aplica traduções quando `i18nReady` resolve.

3. **Documento – camada de abstração**
   - `backend/services/documento.service.js`: `getTipoDocumento(pais)`, `validarDocumento(pais, tipo, valor)`, `formatarDocumento(pais, tipo, valor)`, `normalizarDocumento(pais, valor)`.
   - Para BR usa `validarCPF`/`validarCNPJ` e máscaras CPF/CNPJ; para PY/AR/UY aceita valor não vazio (validadores específicos na Fase 1).

### Fase 1 – Documento multi-tipo (Paraguai sem tirar Brasil) – Implementada

1. **Regras Paraguai**
   - `documento.service.js`: `validarRUC` (8–9 dígitos), `validarCI` (5–9 dígitos); formatação RUC; `validarDocumento(pais, tipo, valor)` para PY.

2. **Backend**
   - Login motorista: `getContexto()` + `validarDocumento(ctx.pais, 'F', documento)`; `normalizarDocumento`; busca por `CGCCPF` (BR: com/sem zero à esquerda). Mensagens do service.

3. **Front-end motorista**
   - locales/es-PY.json (espanhol). Label/placeholder por i18n. auth.js: validação por país (BR 10–11 dígitos, outros 5–14); máscara CPF só BR; chaves documentoInvalido e senhaObrigatoria. Para BR, continua “CPF”.

### Fase 2 – Multimoeda – Implementada

1. **Banco**
   - Script `backend/scripts/add_moeda_fase2.sql`: coluna `MOEDA` (VARCHAR 3, default 'BRL') em `VIAGEMMESTRE`. Executar uma vez no PostgreSQL.

2. **Backend**
   - Viagem: listagem e por-id já retornam `COALESCE(MOEDA, 'BRL')`. Criar e atualizar passam a aceitar e gravar `MOEDA` (body).
   - Relatório convocações: SELECT inclui `COALESCE(v.MOEDA, 'BRL') AS MOEDA`.

3. **Front-end**
   - `utils.js`: `formatarMoeda(valor, codigoMoeda, locale)` já existia. Gerenciar Viagens: campo "Moeda" no formulário (BRL, PYG, ARS, UYU, USD); payload envia e carrega MOEDA; helper `fmtMoeda(valor, codigo)` para exibição. Convocação (convocacao.html): frete formatado com `data.MOEDA`. Motorista (cargas/convocacoes) já usavam `formatarMoeda(..., c.MOEDA)`.

### Fase 3 – Multilíngua (app motorista concluído; web e backend em andamento)

1. **Traduções**
   - **Concluído (app motorista):** `pt-BR.json` e `es-PY.json` com chaves para todas as 22 páginas: login, common, dashboard, viagens, convocacoes, cargas, configuracoes, cadastro, recuperarSenha, detalhesViagem, comprovarEntrega, enviarPosicao, gps, rastreamento, chat, ajudaGps, configNotificacoes, diagnostico, gpsVisualizacao, eventos, sos, macros; chaves de erro de login e mensagens dinâmicas.
   - **Pendente:** chaves para os 25 módulos web (`web.modulos.*`) quando forem implementados.

2. **Front-end**
   - **App motorista – concluído:** As 22 páginas têm `i18n.js`, `applyI18n` + `i18nReady.then(applyI18n)`, `data-i18n` (e `data-i18n-placeholder`/`data-i18n-title` onde aplicável); textos gerados em JS usam `window.t()`. Lista em `docs/PENDENCIAS_I18N_WEB_E_APP.md` (0 páginas pendentes).
   - **Web:** Login e dashboard com i18n-web. **Pendente:** 25 módulos (gerenciar-viagens, relatorio-convocacoes, cadastro geral, equipamentos, usuários, etc.) — usar `tWeb('chave')` e aplicar em lotes de 3–5.

3. **Backend**
   - Login motorista: respostas de erro incluem `errorKey`; front usa `t(data.errorKey)` quando existir.
   - **Concluído:** errorKey estendido a recuperar-senha, redefinir-senha, alterar-senha, cadastro (placeholder), perfil e erros gerais de login (503, 500). Chaves em `recuperarSenhaErrors`, `redefinirSenhaErrors`, `alterarSenhaErrors`, `cadastroErrors`, `commonErrors` e `login` (pt-BR e es-PY). Front (recuperar-senha.html, configuracoes.html) usa `t(data.errorKey)` quando presente.
   - **Pendente:** estender a outros endpoints (convocações, cargas, viagens, etc.) se desejado. Opcional: `Accept-Language` e mensagens já traduzidas no body.

### Fase 4 – Admin e relatórios ✅ Implementada

1. **Módulos admin:** **Gerenciar Cadastro Geral** usa `documento.service` e contexto (label/máscara/validação por país). **Gerenciar Equipamentos** carrega contexto e exibe label Placa (BR) ou Matrícula (PY/AR/UY) e placeholder conforme país.
2. **Formatação:** `utils.js` expõe `formatarMoeda` e `formatarDataHoraComFuso`; **Gerenciar Viagens** carrega contexto e usa `fmtDataHora` (locale + timezone) em logs de integração. Outros módulos podem usar `window.formatarDataHoraComFuso` com contexto.
3. **Relatórios e listagens:** Moeda já formatada por viagem/contexto onde aplicado; extensão a mais relatórios é opcional.
4. **Multi-tenant (opcional):** Se no futuro cada empresa/filial tiver país próprio, estender a config de país para esse nível.

---

## 5. Checklist de impacto (resumo)

| Área | O que não mudar | O que adicionar |
|------|------------------|------------------|
| **BD** | Manter `CGCCPF`, `PLACA`, `RENAVAM`, `REFEQUIPAMENTO`; não remover colunas | Config país (incl. placa e doc. veículo); opcionalmente `MOEDA` onde há valor |
| **Login** | Continua por “documento” + senha; para BR = CPF | Tipo/máscara/validação por país; label i18n |
| **Cadastro (pessoa)** | Mesmo fluxo e tabelas | Validação e máscara por tipo/país; i18n |
| **Cadastro (veículo/equip.)** | Mesmo fluxo; campos placa e doc. veículo | Máscara de placa e tipo/nome do doc. veículo por país; aplicar em Equipamentos e app motorista |
| **Moeda** | Valores numéricos atuais | Coluna moeda onde fizer sentido; formatação por moeda |
| **Textos** | Nada removido | Chaves i18n e arquivos de idioma; locale em formatação |
| **Fuso horário** | Datas/horas atuais (interpretação atual mantida onde não houver mudança) | CONFIG_PAIS com TIMEZONE; armazenar em UTC; exibir com `Intl.DateTimeFormat(locale, { timeZone })` |
| **Scripts** | Scripts que usam CPF continuam funcionando para BR | Novos scripts ou parâmetro “país” para documento |

---

## 6. Estimativa de esforço e prazo

Estimativas em **dias úteis (du)** para 1 desenvolvedor full-stack. Inclui implementação, testes básicos e ajustes; não inclui homologação longa nem documentação de usuário.

| Fase | Atividade | Du (min–max) | Observação |
|------|-----------|--------------|------------|
| **Fase 0** | Config país/tenant (tabela + API + middleware contexto) | 1,5–2 | |
| | Estrutura i18n (locales, loader, tela piloto login) | 2–3 | |
| | `documento.service.js` (abstração CPF/CNPJ, getTipo/validar/formatar) | 2–2,5 | |
| | **Subtotal Fase 0** | **5,5–7,5 du** | ~1,5–2 semanas |
| **Fase 1** | Pesquisa regras RUC/CI Paraguai + validadores | 1,5–2,5 | Depende de documentação disponível |
| | Backend: login + cadastro geral usando documento.service | 3–4 | |
| | Front motorista: login e cadastro dinâmicos (label/máscara por país) | 2–2,5 | |
| | **Subtotal Fase 1** | **6,5–9 du** | ~1,5–2 semanas |
| **Fase 2** | Banco: coluna MOEDA onde necessário (script + deploy) | 1–1,5 | |
| | Backend: retornar moeda nas entidades; config moeda padrão | 2–2,5 | |
| | Front: formatarMoeda(valor, moeda) em cargas, convocações, etc. | 2–2,5 | |
| | **Subtotal Fase 2** | **5–6,5 du** | ~1–1,5 semana |
| **Fase 3** | Completar pt-BR.json (app motorista ~25 telas + mensagens API) | 3–5 | Tradução = mesmo texto, só chaves |
| | Criar es-PY.json (mesmas chaves, espanhol) | 2–3 | Pode precisar revisão nativa |
| | Front: trocar textos fixos por t('chave') em todo app motorista | 5–8 | Maior volume de mudança |
| | Backend: Accept-Language e mensagens por idioma (login/cadastro) | 1–1,5 | |
| | **Subtotal Fase 3** | **11–17,5 du** | ~2,5–3,5 semanas |
| **Fase 4** | Admin: documento.service + i18n em cadastro, empresas, filiais, usuários, viagens | 8–12 | Muitos módulos e telas |
| | Relatórios e listagens: moeda/locale na formatação | 2–3 | |
| | Fuso horário: CONFIG_PAIS com TIMEZONE; contexto retornar timezone; front formatar datas com locale + timeZone | 2–3 | Após i18n estável |
| | **Subtotal Fase 4** | **10–15 du** | ~2–3 semanas |
| **Contingência** | Testes de regressão, ajustes, imprevistos (≈20%) | 8–10 du | |
| **TOTAL** | | **46–65 du** | **~9–13 semanas (1 dev)** |

### Resumo em tempo

| Cenário | Prazo (1 dev) | Prazo (2 devs)* |
|---------|----------------|------------------|
| Mínimo (escopo enxuto, sem atrasos) | ~9 semanas | ~5–6 semanas |
| Realista (com testes e pequenos ajustes) | ~11–12 semanas | ~6–7 semanas |
| Conservador (incl. revisão i18n e homologação) | ~13 semanas | ~7–8 semanas |

\* Com 2 devs: Fase 3 e Fase 4 podem ser paralelizadas em parte (um foca motorista, outro admin); ganho real depende de dependências.

### Ordem sugerida se quiser entregar por valor

1. **Entrega 1 (Paraguai login/cadastro):** Fase 0 + Fase 1 → **~3–4 semanas** → já permite documento paraguaio e login por RUC/CI.
2. **Entrega 2 (Moeda):** Fase 2 → **~1–1,5 semana** → valores em PYG (ou outra moeda) formatados.
3. **Entrega 3 (Idioma app motorista):** Fase 3 → **~2,5–3,5 semanas** → app motorista em espanhol (e pt-BR mantido).
4. **Entrega 4 (Admin alinhado):** Fase 4 → **~2–3 semanas** → painel admin com documento/moeda/idioma consistentes.

**Total sequencial (entregas incrementais):** na prática o mesmo **~9–13 semanas** com 1 dev, mas com marcos utilizáveis a cada 1–4 semanas.

---

## 7. Riscos e cuidados

1. **Compatibilidade:** Qualquer mudança em login ou cadastro deve ser testada com usuários atuais (Brasil, CPF/CNPJ). Manter branch/feature flag por país se necessário.
2. **Dados existentes:** Todo `CGCCPF` já gravado permanece válido; apenas a **interpretação** (é CPF ou CNPJ) e a **validação** em novos cadastros passam a depender do país.
3. **Paraguai (RUC/CI):** Pesquisar regras oficiais de formato e dígitos verificadores do RUC e da cédula paraguaia para implementar validadores corretos.
4. **Outros Mercosul (AR, UY, BO):** Ao ativar Argentina, Uruguai ou Bolívia, pesquisar regras oficiais de documento (DNI/CUIT, CI/RUT, etc.) e de placa/documento do veículo antes de implementar validadores e CONFIG_PAIS.
5. **Performance:** i18n no front (um objeto por idioma) é leve; evitar carregar todos os idiomas no admin de uma vez se crescer muito.

---

## 8. Próximos passos recomendados

1. Validar este plano com o time (produto/backend/frontend).
2. Definir onde fica a config de país (tabela `CONFIGURACAO`, nova tabela `CONFIG_PAIS`, ou arquivo por ambiente).
3. Implementar **Fase 0** (config contexto, i18n piloto, `documento.service`) em branch separada; testes de regressão no fluxo atual (BR).
4. Documentar regras oficiais do documento no Paraguai (RUC/CI) e implementar validadores (Fase 1).
5. Seguir com Fases 2 e 3 conforme prioridade de negócio (moeda primeiro ou idioma primeiro).
6. **Para cada novo país do Mercosul (AR, UY, BO, etc.):** Incluir entrada em CONFIG_PAIS (moeda, idioma, tipo doc. pessoa/empresa, placa, doc. veículo); implementar validadores e arquivo de locale; testar fluxos de cadastro e viagem.

### 8.1 Resumo do que foi feito (i18n)

**Concluído:**

- **App Motorista – 22 páginas com i18n (PT-BR / ES-PY):**  
  Login, Dashboard, Viagens, Convocações, Cargas, Configurações, Cadastro, Recuperar senha, Macros, SOS, **Detalhes da viagem**, **Comprovar entrega**, **Enviar posição**, **GPS**, **Rastreamento**, **Chat**, **Ajuda GPS**, **Chat standalone**, **Configurações de notificações**, **Diagnóstico**, **GPS visualização**, **Eventos**.  
  Em cada página: `i18n.js`, `applyI18n` + `i18nReady.then(applyI18n)`, `data-i18n` (e onde aplicável `data-i18n-placeholder`, `data-i18n-title`) nos textos fixos; textos gerados em JS usando `window.t()`; chaves em `motorista/locales/pt-BR.json` e `es-PY.json` (blocos: login, common, dashboard, viagens, convocacoes, cargas, configuracoes, cadastro, recuperarSenha, detalhesViagem, comprovarEntrega, enviarPosicao, gps, rastreamento, chat, ajudaGps, configNotificacoes, diagnostico, gpsVisualizacao, eventos, sos, macros, web).

- **Web – telas principais:** Login e Dashboard com i18n-web (menu lateral, header, conteúdo inicial, seletor de idioma).

- **Web – Lote 1 (módulos):** Gerenciar Cidades, Gerenciar Tipos Validade e Gerenciar Marcas com i18n completo.
- **Web – Lote 2 (módulos):** Gerenciar Tipos Equipamento, Gerenciar Modelos Equipamento e Gerenciar Grupos com i18n completo.
- **Web – Lote 3 (módulos):** Gerenciar Equipamentos, Gerenciar Classes Frota, Gerenciar Tipos Viagem e Gerenciar Situações Viagem com i18n completo: `data-i18n` no HTML, helper `t`/`tWeb` no JS, chaves em `web.modulos.equipamentos`, `web.modulos.classesFrota`, `web.modulos.tiposViagem` e `web.modulos.situacoesViagem` em pt-BR e es-PY.
- **Web – Lote 4 (módulos):** Gerenciar Roteiros, Gerenciar Viagens, Relatório Convocações e Gerenciar Cadastro Geral com i18n: `data-i18n` no HTML, helper `t` no JS, chaves em `web.modulos.roteiros`, `web.modulos.viagens`, `web.modulos.relatorioConvocacoes` e `web.modulos.cadastroGeral` em pt-BR e es-PY.
- **Web – Lote 5 (módulos):** Gerenciar Logs Acesso, Gerenciar Usuários, Gerenciar Empresas e Gerenciar Filiais com i18n: `data-i18n` no HTML, helper `t` no JS, chaves em `web.modulos.logsAcesso`, `web.modulos.usuarios`, `web.modulos.empresas` e `web.modulos.filiais` em pt-BR e es-PY.
- **Web – Lote 6 (módulos):** Gerenciar Configurações, Alertas, Chat e Ranking com i18n: `data-i18n` no HTML, helper `t` no JS, chaves em `web.modulos.configuracoes`, `web.modulos.alertas`, `web.modulos.chat` e `web.modulos.ranking` em pt-BR e es-PY.
- **Web – Lote 7 (módulos):** SOS, Gerenciar Mapa Viagem e Gerenciar Tipos de Atividade com i18n: `data-i18n` no HTML, helper `t` no JS, chaves em `web.modulos.sos`, `web.modulos.mapaViagem` e `web.modulos.tiposAtividade` em pt-BR e es-PY.

- **Checklist:** `docs/PENDENCIAS_I18N_WEB_E_APP.md` atualizado (app motorista: 22 ajustadas, 0 faltando; web módulos: 25 com i18n, 0 faltando).

### 8.2 O que ainda falta (i18n e complementos)

1. **Web – módulos**  
   **Concluído.** Todos os 25 módulos web têm i18n (Lotes 1 a 7: cidades, tipos-validade, marcas, tipos-equipamento, modelos-equipamento, grupos, equipamentos, classes-frota, tipos-viagem, situacoes-viagem, roteiros, viagens, relatorio-convocacoes, cadastro-geral, logs-acesso, usuarios, empresas, filiais, configuracoes, alertas, chat, ranking, sos, mapa-viagem, tipos-atividade).

2. **Backend (complementar)**  
   Login motorista já retorna **errorKey** em respostas de erro. Estender para outros endpoints (cadastro, recuperar senha, APIs do motorista) onde houver mensagens de erro/sucesso fixas em português. Opcional: header **Accept-Language** e mensagens já traduzidas no body.

3. **Formatação (datas e números)**  
   **Concluído** nos módulos: Gerenciar Viagens, Relatório Convocações, convocacao.html, Chat, Alertas, SOS, Gerenciar Equipamentos, Gerenciar Cadastro Geral, Gerenciar Logs Acesso, Gerenciar Mapa Viagem (todos carregam `/api/contexto` e usam locale/timezone em datas e números). **Opcional:** estender ao restante do app motorista (viagens.html, dashboard, cargas, convocacoes, detalhes-viagem, gps-visualizacao, macros, diagnostico) e a grid-editor/utils quando desejado.

4. **Fuso horário (Fase 4)**  
   **Concluído:** Configurações retornam timezone (fusos pré-cadastrados); contexto retorna `timezone`; front usa `formatarDataHoraComFuso` e `Intl.DateTimeFormat(locale, { timeZone })` nos módulos acima.

### 8.3 Estratégia adotada (referência)

- **App motorista:** Fechado em 3 lotes (detalhes-viagem/comprovar-entrega/enviar-posicao → gps/rastreamento/chat → ajuda-gps, chat-standalone, configuracoes-notificacoes, diagnostico, gps-visualizacao, eventos). Padrão: `i18n.js`, `applyI18n`, `data-i18n`, `window.t()` no JS, chaves em pt-BR e es-PY.
- **Próximo foco:** Módulos web em lotes de 3–5; depois backend errorKey e formatação por locale.
- **Checklist de acompanhamento:** `docs/PENDENCIAS_I18N_WEB_E_APP.md`.

### 8.4 Próximo passo imediato (retomar em nova sessão)

- **Objetivo:** Implementar i18n nos **módulos web** em lotes de 3–5.
- **Onde:** `backend/public/modulos/<nome>/index.html` e `js/script.js`; locales em `backend/public/motorista/locales/pt-BR.json` e `es-PY.json` (chaves `web.modulos.<nomeModulo>.*`).
- **Como:** O dashboard já injeta o HTML do módulo em `contentArea` e chama `applyI18nWeb(contentArea)` após carregar. Basta:
  1. Nos HTML dos módulos: colocar `data-i18n="web.modulos.<modulo>.chave"` (e `data-i18n-placeholder`, `data-i18n-title` onde couber) nos textos fixos.
  2. Nos JS dos módulos: usar `window.tWeb('web.modulos.<modulo>.chave')` para mensagens e textos gerados em JS.
  3. Nos locales: criar o bloco `web.modulos.<modulo>` em pt-BR e es-PY com as chaves usadas.
- **Ordem sugerida dos lotes:**  
  - **Lote 1:** gerenciar-cidades, gerenciar-tipos-validade, gerenciar-marcas. ✓  
  - **Lote 2:** gerenciar-tipos-equipamento, gerenciar-modelos-equipamento, gerenciar-grupos. ✓  
  - **Lote 3:** gerenciar-equipamentos, gerenciar-classes-frota, gerenciar-tipos-viagem, gerenciar-situacoes-viagem. ✓  
  - **Lote 4:** gerenciar-roteiros, gerenciar-viagens, relatorio-convocacoes, gerenciar-cadastro-geral. ✓  
  - **Lote 5:** gerenciar-logs-acesso, gerenciar-usuarios, gerenciar-empresas, gerenciar-filiais. ✓  
  - **Lote 6:** gerenciar-configuracoes, alertas, chat, ranking. ✓  
  - **Lote 7:** sos, gerenciar-mapa-viagem, gerenciar-tipos-atividade. ✓  
- **i18n módulos web:** concluído. **Formatação por locale/timezone:** concluída nos 10 módulos/telas listados em 8.2. Próximos passos (opcional): backend errorKey em mais endpoints; formatação nas páginas restantes do app motorista; ou outros itens (ex.: backlog chat áudio/transcrição).

---

## 9. Escopo Mercosul — a ferramenta atende todos os países do Mercosul?

**Sim.** Com este plano, a **arquitetura** está preparada para atender **todos os países do Mercosul** (Brasil, Argentina, Paraguai, Uruguai e, se necessário, Bolívia e associados). O que define o suporte a um país é:

1. **CONFIG_PAIS** (ou equivalente) com: moeda, idioma, tipo de documento (pessoa e empresa), máscara de placa, tipo/nome e validador do documento do veículo.
2. **Validadores** no backend para o documento daquele país (já previstos de forma genérica no `documento.service` e no dispatcher por país).
3. **Arquivo de locale** (ex.: `es-AR.json`, `es-UY.json`) quando for oferecer o idioma na interface.
4. **Tabela PAIS** já existente: garantir que os países do Mercosul estejam cadastrados (CDPAIS para BR, AR, PY, UY, BO, etc.).

Não ficou de fora nenhum eixo necessário: **documento (pessoa/empresa)** por país, **moeda** por viagem/entidade com default de empresa/filial, **idioma** por escolha no login, **país em empresa, filial, cadastro e equipamento**, **placa e documento do veículo** por país, **padrões carregados na viagem** e **autonomia do operador**. O que pode ficar para uma **segunda leva** (após BR e PY em produção) é apenas a **pesquisa e implementação das regras específicas** de cada outro país (AR: DNI/CUIT e formato placa/doc. veículo; UY: CI/RUT; etc.) e o arquivo de tradução do espanhol para o locale daquele país, se desejado. A estrutura (CONFIG_PAIS, CDPAIS nas entidades, validadores por país, i18n) já cobre o Mercosul.

**Fora do escopo deste plano (podem ser tratados depois, se necessário):** Conversão cambial automática entre moedas; emissão de documentos fiscais por país (NF-e, factura electrónica, etc.); formatos de endereço/postal por país; regras tributárias ou alfandegárias por país; **modais marítimo e ferroviário** (documentos específicos: BL, manifesto, CTFI, registro de embarcação/vagões); **documentos operacionais de viagem** (Seguro Carta Verde, autorização ATIT, CRT). Nada disso impede operar em todos os países do Mercosul para cadastro, viagens, moeda e documento no **modal rodoviário** — apenas não estão incluídos neste plano.

---

## Anexo A – Referência documental e moedas (Mercosul)

Tabelas de referência para preencher CONFIG_PAIS e labels nas telas. Fonte: pesquisa documental Mercosul (pessoas, veículos, moedas).

### Documentos de pessoas

| País | Pessoa física | Pessoa jurídica |
|------|----------------|------------------|
| Brasil | CPF (Cadastro de Pessoas Físicas) | CNPJ (Cadastro Nacional da Pessoa Jurídica) |
| Argentina | DNI (Documento Nacional de Identidad) | CUIT (Clave Única de Identificación Tributaria) |
| Paraguai | Cédula de Identidad (CI) | RUC (Registro Único de Contribuyentes) |
| Uruguai | Cédula de Identidad (CI) | RUT (Registro Único Tributario) |

### Documentos de veículos (registro principal)

| País | Documento principal | Observação |
|------|----------------------|------------|
| Brasil | RENAVAM + CRLV | Registro Nacional de Veículos Automotores; CRLV = Certificado de Registro e Licenciamento de Veículo |
| Argentina | Cédula de Identificación del Automotor | Emitida pelo Registro Nacional de la Propiedad Automotor |
| Paraguai | Certificado de Registro de Vehículo | Emitido pela Dirección de Registro de Automotores |
| Uruguai | Padrón de Vehículo | Emitido pela Intendencia correspondente |

Para circulação internacional rodoviária no Mercosul, é exigido o **Seguro Carta Verde** (responsabilidade civil); pode ser tratado como requisito operacional em extensão futura.

### Moedas em circulação

| País | Moeda oficial | Outras moedas em uso |
|------|----------------|----------------------|
| Brasil | Real (BRL) | USD em contratos internacionais |
| Argentina | Peso Argentino (ARS) | USD amplamente usado em contratos e comércio |
| Paraguai | Guarani (PYG) | USD muito utilizado em comércio, contratos e importações |
| Uruguai | Peso Uruguaio (UYU) | USD em transações imobiliárias e contratos; EUR em menor escala |

Na configuração por país e no combo de moeda da viagem, considerar permitir **mais de uma moeda** onde for relevante (ex.: PY com PYG e USD; UY com UYU, USD e eventualmente EUR), mantendo a autonomia do operador para escolher no ato da contratação.

---

**Conclusão:** É viável ter multimoeda, multilíngua e múltiplos tipos de documento **sem perder o que já existe**. A chave é: (1) manter o campo único de documento (`CGCCPF`) e apenas variar validação e máscara por país; (2) introduzir configuração de país (CONFIG_PAIS) e usar em todo lugar que hoje assume Brasil; (3) adicionar i18n e formatação por locale/moeda de forma incremental. **Com isso, a ferramenta consegue atender todos os países do Mercosul;** a ordem de ativação (BR → PY → AR → UY, etc.) é de prioridade de negócio, não limitação do desenho.
