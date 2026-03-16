# Locais preferidos (embarque/carregamento e desembarque/descarga)

## Objetivo

No **Gerenciar Cadastro Geral**, ter uma aba onde o operador configure, por cadastro (em especial motorista), os **locais preferidos** de:

- **Embarque / carregamento** – onde o motorista prefere carregar
- **Desembarque / descarga** – onde o motorista prefere descarregar (já existe em parte: destino preferido no app)

Estrutura desejada: **País → Estado/Província → Região → Cidade**.

---

## No Brasil (tabelas existentes)

Você já tem o cadastro geográfico em:

| Tabela          | Uso na hierarquia |
|-----------------|--------------------|
| `public."PAIS"` | País (ex.: Brasil) |
| `public."ESTADO"` | Estado/UF (CDUF, ESTADO, NMESTADO); pertence a um PAIS (CDPAIS) |
| `public."REGIAOFISCAL"` | Região fiscal (pode ser usada como “Região”) |
| `public."CIDADE"` | Cidade (CDCIDADE, NMCIDADE, ESTADO, CDPAIS, CDUF, CDMICROREGIAO, CDMESOREGIAO, CDREGIAOFISCAL) |
| `public."REGIAOCIDADE"` | Região de atendimento por cidade (IDREGIAOATENDIMENTO, CDCIDADE, BAIRRO) |

Hierarquia possível para o Brasil:

1. **País** → `PAIS` (ex.: BR)
2. **Estado/Província** → `ESTADO` (UF)
3. **Região** → pode ser:
   - **REGIAOFISCAL** (região fiscal do estado), ou
   - **MICROREGIAO** / **MESOREGIAO** (agrupamento de cidades) – a tabela `CIDADE` tem `CDMICROREGIAO`, `CDMESOREGIAO`, `CDREGIAOFISCAL`
4. **Cidade** → `CIDADE`

Sugestão de uso na tela: **País** (combo PAIS) → **Estado** (combo ESTADO filtrado por país) → **Região** (combo REGIAOFISCAL ou MICROREGIAO por estado) → **Cidade** (combo CIDADE filtrada por estado/região). Para Brasil, tudo pode ser dropdown a partir dessas tabelas.

---

## Outros países (Paraguai, Argentina, etc.)

Não há hoje tabelas de ESTADO/CIDADE/REGIAO para outros países no mesmo formato do Brasil. Duas abordagens:

### Opção A – Campos texto (rápida)

- **País:** combo (PAIS ou lista fixa BR, PY, AR, UY, etc.).
- **Estado/Província:** texto livre (ex.: “Alto Paraná”, “Central”).
- **Região:** texto livre ou vazio.
- **Cidade:** texto livre (ex.: “Ciudad del Este”, “Asunción”).

Gravação: no cadastro do motorista (ex.: `MOTORISTA_COMPLEMENTO` ou tabela de “locais preferidos”) guardar sigla do país + texto de estado, região e cidade. A regra de compatibilidade usa esses valores (ex.: comparação por texto ou por código quando existir).

### Opção B – Cadastro geográfico por país (futura)

- Criar tabelas ou colunas “por país” (ex.: ESTADO_PY, CIDADE_PY) ou uma estrutura genérica (PAIS + CDESTADO + CDCIDADE com descrições).
- Replicar a ideia de hierarquia País → Estado → Região → Cidade para cada país que quiser tratar com a mesma precisão do Brasil.

Para já suportar Paraguai sem mudar muito o sistema, a **Opção A** é suficiente; a **Opção B** pode vir quando houver demanda e cadastros prontos dos outros países.

---

## Onde gravar

- **Desembarque preferido:** já existe em `MOTORISTA_COMPLEMENTO`: `PAIS_DESTINO_PREF`, `SIGLA_ESTADO_DESTINO_PREF`, `CIDADE_DESTINO_PREF` (e opcionalmente “região” em um novo campo, ex.: `REGIAO_DESTINO_PREF`).
- **Embarque preferido:** hoje não existe. Duas alternativas:
  1. Novas colunas em `MOTORISTA_COMPLEMENTO`: `PAIS_EMBARQUE_PREF`, `ESTADO_EMBARQUE_PREF`, `REGIAO_EMBARQUE_PREF`, `CIDADE_EMBARQUE_PREF` (ou siglas/códigos quando forem do Brasil, e texto para outros países).
  2. Nova tabela `CADASTRO_LOCAL_PREFERIDO` (CDCADASTRO, TIPO = 'E'|'D', PAIS, ESTADO, REGIAO, CIDADE, CDPAIS, CDESTADO, CDREGIAO, CDCIDADE para quando for do Brasil). Permite vários locais por cadastro.

Para começar simples: **colunas de embarque em MOTORISTA_COMPLEMENTO** (espelhando a ideia do destino preferido) e, na tela, **uma aba “Locais preferidos”** com dois blocos: **Embarque** e **Desembarque**, cada um com País, Estado, Região, Cidade (no Brasil preenchidos por combos; outros países em texto).

---

## Resumo

- **Aba no Gerenciar Cadastro Geral:** “Locais preferidos” (ou “Embarque e desembarque preferidos”) com dois conjuntos de campos: País, Estado/Província, Região, Cidade.
- **Brasil:** usar `PAIS`, `ESTADO`, `REGIAOFISCAL` (e/ou MICROREGIAO), `CIDADE` para preencher combos e gravar códigos quando fizer sentido.
- **Demais países:** por enquanto usar texto livre para Estado, Região e Cidade; País pode ser combo (PAIS ou lista fixa).
- **Persistência:** desembarque já em `MOTORISTA_COMPLEMENTO`; embarque em novas colunas na mesma tabela ou em tabela dedicada, conforme evolução.

Quando quiser implementar a aba e as colunas/APIs, podemos desenhar os campos e os endpoints passo a passo.
