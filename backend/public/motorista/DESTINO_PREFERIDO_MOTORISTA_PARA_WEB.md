# Destino preferido: do cadastro motorista (app) para o web

## Contexto

- **Página:** `http://localhost:3000/motorista/pages/cadastro.html`
- Hoje o motorista preenche apenas **Destino preferido**: País destino, Estado/UF (texto), Cidade (opcional). O backend grava em **MOTORISTA_COMPLEMENTO** (PostgreSQL): `PAIS_DESTINO_PREF`, `SIGLA_ESTADO_DESTINO_PREF`, `CIDADE_DESTINO_PREF`.

No **web** (Gerenciar Cadastro Geral):

1. **Card “Destino preferido”** (aba Dados) lê/grava **MOTORISTA_COMPLEMENTO**.
2. **Aba “Locais preferidos”** usa **CADASTRO_LOCAL_PREFERIDO** (TIPO 'E'=origem, 'D'=destino), com **País**, **Estado/UF**, **Mesorregião** (CDUF, CDMESOREGIAO). Mesmas regras para compatibilidade com viagens.

A **regra de compatibilidade** (convocações) usa **apenas CADASTRO_LOCAL_PREFERIDO**. MOTORISTA_COMPLEMENTO não entra nessa regra.

---

## Decisão: alinhar com Gerenciar Cadastro Geral / Locais preferidos

**Objetivo:** Seguir a **mesma linha** do programa Gerenciar Cadastro Geral / Locais preferidos na página de cadastro do motorista, com as **mesmas regras**, para facilitar e unificar.

Na **cadastro.html** do motorista passar a ter a mesma estrutura de **Locais preferidos**:

| Campo | Descrição | Alinhado ao web |
|-------|-----------|------------------|
| **Origem / Destino** | Seletor: Origem (embarque) ou Destino (desembarque) — equivalente ao **TIPO** (E/D) | Sim – mesmo conceito da aba Locais preferidos |
| **País** | País (obrigatório) | Sim – select da tabela PAIS |
| **Estado / Província / Departamento** | Conforme o país (Brasil: select ESTADO → CDUF; outros: texto ou select quando houver) | Sim – “Todos” = qualquer estado |
| **Mesorregião** | Opcional; quando Estado selecionado (ex.: Brasil), select Mesorregião; “Todos” = qualquer | Sim – CDMESOREGIAO |

- **Mesmas regras:** uma única tabela **CADASTRO_LOCAL_PREFERIDO**, mesma API (PAIS, CDUF, CDMESOREGIAO), mesma lógica de compatibilidade. O app deixa de usar apenas MOTORISTA_COMPLEMENTO para destino e passa a gravar direto em **CADASTRO_LOCAL_PREFERIDO**, igual ao web.
- **Benefícios:** um único modelo de dados, mesma tela no web (aba Locais preferidos) refletindo o que o motorista informou no app, sem sincronizar duas fontes (MOTORISTA_COMPLEMENTO + CADASTRO_LOCAL_PREFERIDO).

**Resumo:** No cadastro do motorista, trocar o bloco único “Destino preferido” (País, Estado texto, Cidade) por um bloco **Locais preferidos** com: **Origem/Destino**, **País**, **Estado/Província/Departamento (conforme país)**, **Mesorregião** — mesma linha e mesmas regras do Gerenciar Cadastro Geral / Locais preferidos.

---

## Pontos cruciais para a regra de envio das convocações

Além dos locais preferidos (origem/destino), a lista de **motoristas compatíveis** com uma viagem depende de **quatro regras** configuráveis. Duas delas exigem dados do **cadastro do motorista** que hoje **não** são coletados na página de cadastro do app:

| Regra | O que a regra faz | Onde gravar no cadastro | No app (cadastro.html) |
|-------|-------------------|-------------------------|-------------------------|
| **Validar classe de frota** | Só entram motoristas que tenham na **CLASSEFROTA_CG** a mesma **CDCLASSEFROTA** da viagem. | Tabela **CLASSEFROTA_CG** (CDCADASTRO, CDCLASSEFROTA, FGACTIVE). No web: card “Classes de frota”. | **Falta:** um **card “Classe de frota”** para o motorista escolher uma ou mais classes (ex.: Caminhão 3 eixos, 6 eixos, etc.) — mesma lista do web (CLASSEFROTA). |
| **Validar exigência de rastreamento** | Se a viagem for rastreada (`FGRASTREADO = 'S'`), só entram motoristas com **FGRASTREADO = 'S'**. | Campo **FGRASTREADO** (S/N) na tabela **CADASTROGERAL**. No web: campo “Rastreado” (Sim/Não). | **Falta:** um **card ou campo “Possui veículo rastreado?”** (Sim/Não) e gravar em CADASTROGERAL.FGRASTREADO no backend. |

Sem **classe de frota** e **rastreado** preenchidos no cadastro do motorista, ele não entra (ou entra incorretamente) na busca de compatíveis quando essas regras estão ativas. Por isso esses dois pontos são **cruciais** e devem constar na **cadastro.html** e no fluxo de criação/atualização do cadastro no backend.

**Resumo:** Incluir na página de cadastro do motorista:
- **Card Classe de frota** – seleção de uma ou mais classes (CLASSEFROTA_CG), mesma linha do Gerenciar Cadastro Geral.
- **Possui veículo rastreado** – Sim/Não (FGRASTREADO em CADASTROGERAL).

Assim o cadastro fica completo para as regras de envio das convocações.

---

## Objetivo (documento)

Documentar esse alinhamento e as opções técnicas (incluindo compatibilidade com o que já existe).

---

## Opções de tratamento (referência)

- **Opção A:** Sincronizar app → MOTORISTA_COMPLEMENTO + CADASTRO_LOCAL_PREFERIDO (duas fontes; regra usa só CADASTRO_LOCAL_PREFERIDO).
- **Opção B:** Regra de compatibilidade considerar MOTORISTA_COMPLEMENTO quando não houver CADASTRO_LOCAL_PREFERIDO (lógica duplicada).
- **Opção C (adotada):** Unificar na mesma linha do web — app com **Origem/Destino**, **País**, **Estado/Província/Departamento**, **Mesorregião**, gravando direto em **CADASTRO_LOCAL_PREFERIDO**, mesmas regras que Gerenciar Cadastro Geral / Locais preferidos.

---

## Resumo técnico (após alinhamento)

| Onde | O quê |
|------|--------|
| **App (cadastro.html)** | **Locais preferidos:** Origem/Destino, País, Estado/Província/Departamento, Mesorregião (lista → CADASTRO_LOCAL_PREFERIDO). **Classe de frota:** card com seleção de uma ou mais classes (→ CLASSEFROTA_CG). **Possui veículo rastreado:** Sim/Não (→ CADASTROGERAL.FGRASTREADO). |
| **Backend app (motorista-app.controller.js)** | CADASTROGERAL (incluir **FGRASTREADO**); MOTORISTA_COMPLEMENTO (CNH, etc.); **CADASTRO_LOCAL_PREFERIDO** (locais); **CLASSEFROTA_CG** (classes de frota escolhidas). |
| **Web – Gerenciar Cadastro Geral** | Locais preferidos em CADASTRO_LOCAL_PREFERIDO; classes em CLASSEFROTA_CG; rastreado em CADASTROGERAL.FGRASTREADO. O que o motorista informou no app aparece nas mesmas telas. |
| **Compatibilidade (viagemmestre)** | Quatro regras: **rastreamento** (FGRASTREADO), **classe de frota** (CLASSEFROTA_CG), **local embarque** (CADASTRO_LOCAL_PREFERIDO TIPO 'E'), **local desembarque** (CADASTRO_LOCAL_PREFERIDO TIPO 'D'). |

---

## Próximos passos (alinhamento com Locais preferidos + regras de convocação)

1. **cadastro.html**  
   - Substituir o bloco único “Destino preferido” (País, Estado texto, Cidade) por um bloco **Locais preferidos** com:  
     - **Origem / Destino** (select: Origem (embarque) / Destino (desembarque));  
     - **País** (select, obrigatório);  
     - **Estado / Província / Departamento** (conforme país: Brasil = select ESTADO; outros = texto ou “Todos”);  
     - **Mesorregião** (select quando aplicável, ex.: Brasil com estado selecionado; “Todos” permitido).  
   - Permitir adicionar mais de um local (lista) ou, na primeira versão, um de origem e um de destino.  
   - Enviar no submit: array de locais com TIPO, PAIS, CDUF, CDMESOREGIAO (ou endpoint "locais-preferidos" após criar o cadastro).  
   - **Card Classe de frota:** permitir escolher uma ou mais classes (lista CLASSEFROTA ativa); enviar array de CDCLASSEFROTA.  
   - **Possui veículo rastreado:** campo Sim/Não (select ou radio); enviar `fgRastreado` ou `rastreado` = 'S'/'N'. com TIPO, PAIS, CDUF, CDMESOREGIAO (ou endpoint “locais-preferidos” após criar o cadastro).

2. **Backend (motorista-app.controller.js)**  
   - **CADASTROGERAL:** incluir coluna **FGRASTREADO** no INSERT (valor do body, default 'N').  
   - **CADASTRO_LOCAL_PREFERIDO:** após criar cadastro, inserir os locais preferidos (TIPO, PAIS, CDUF, CDMESOREGIAO).  
   - **CLASSEFROTA_CG:** receber a lista de classes escolhidas e inserir/atualizar em **CLASSEFROTA_CG** (CDCADASTRO, CDCLASSEFROTA, FGACTIVE='S'), mesma lógica do cadastrogeral.controller.js (salvar classes de frota).  
   - Opcional: manter gravação em MOTORISTA_COMPLEMENTO (PAIS_DESTINO_PREF, etc.) para o primeiro destino, para compatibilidade com o card no web até migração total.

3. **Web (gerenciar-cadastro-geral)**  
   - Nenhuma mudança obrigatória na aba Locais preferidos; os dados do app já estarão em CADASTRO_LOCAL_PREFERIDO. Opcional: migrar o card “Destino preferido” para ler do primeiro TIPO=D de CADASTRO_LOCAL_PREFERIDO.

Com isso, o cadastro do motorista fica completo para as **quatro regras** de envio das convocações: **Locais preferidos** (origem/destino), **Classe de frota**, **Possui veículo rastreado** e mesma linha do Gerenciar Cadastro Geral.
