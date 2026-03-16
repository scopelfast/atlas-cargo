# Plano: Aba "Locais preferidos" (origens e destinos) no Gerenciar Cadastro Geral

## Objetivo

Quando o cadastro for de um **Tipo de Cadastro compatível com o processo de envio** (convocações/divulgação de cargas), exibir uma **nova aba** para configurar **origens preferidas (embarque)** e **destinos preferidos (desembarque)**. Hoje o “Destino preferido” já existe como card na aba Dados (só para motorista); a ideia é centralizar e ampliar em uma aba dedicada, com origem + destino.

---

## 1. Quando mostrar a aba

- **Tipos compatíveis com envio:** cadastros que podem participar do fluxo de convocações/divulgação.
  - **Sugestão inicial:** apenas **Motorista (M)**.
  - **Opcional depois:** Agente (A), Grupo (G), se forem usados no mesmo fluxo.
- **Regra:** a aba **“Locais preferidos”** aparece na barra de abas **somente** quando o cadastro em edição tem pelo menos um dos tipos compatíveis marcado (ex.: checkbox “Motorista” marcado).
- **Comportamento:** ao abrir um cadastro que não é motorista (nem outro tipo compatível), a aba não é exibida; ao marcar Motorista (e salvar ou ao trocar para a aba), a aba passa a aparecer.

---

## 2. Conteúdo da aba

Dois blocos na mesma aba:

| Bloco | Descrição | Persistência atual / necessária |
|-------|-----------|----------------------------------|
| **Origem preferida (embarque)** | Onde o cadastro prefere carregar / origem da carga | Novas colunas ou tabela (ver abaixo) |
| **Destino preferido (desembarque)** | Onde prefere descarregar (já existe no sistema) | Já em `MOTORISTA_COMPLEMENTO`: `PAIS_DESTINO_PREF`, `SIGLA_ESTADO_DESTINO_PREF`, `CIDADE_DESTINO_PREF` |

Cada bloco: **País** → **Estado/Província** → **Região** (opcional) → **Cidade**.

- **Brasil:** combos a partir das tabelas existentes (`PAIS`, `ESTADO`, `CIDADE`; opcionalmente região/microregião).
- **Outros países (PY, AR, UY, etc.):** por enquanto **texto livre** para Estado, Região e Cidade (conforme já descrito em `LOCAIS_PREFERIDOS_EMBARQUE_DESEMBARQUE.md`).

---

## 3. Onde gravar (persistência)

- **Destino preferido:** já existe em `MOTORISTA_COMPLEMENTO`; apenas garantir que a nova aba leia/grave os mesmos campos (e, se quiser, retire ou mantenha o card “Destino preferido” na aba Dados para não duplicar informação).
- **Origem preferida (embarque):** duas opções:
  - **Opção A (recomendada para começar):** novas colunas em `MOTORISTA_COMPLEMENTO`, espelhando o destino, por exemplo:
    - `PAIS_EMBARQUE_PREF`, `SIGLA_ESTADO_EMBARQUE_PREF`, `CIDADE_EMBARQUE_PREF` (e opcionalmente `REGIAO_EMBARQUE_PREF`).
  - **Opção B (futuro):** tabela `CADASTRO_LOCAL_PREFERIDO` (CDCADASTRO, TIPO = 'E'|'D', país, estado, região, cidade, códigos quando for Brasil) para permitir **vários** locais por cadastro.

Recomendação: implementar primeiro a **Opção A** (colunas de embarque em `MOTORISTA_COMPLEMENTO`) e, na tela, uma aba com **um** embarque e **um** desembarque por cadastro.

---

## 4. Estrutura da tela (HTML/JS)

- **Nova aba:** botão na barra de abas, por exemplo:
  - `<button class="tab-btn" data-tab="locais-preferidos" style="display: none;"><i class='bx bx-map'></i> Locais preferidos</button>`
  - O `style="display: none"` é controlado pelo JS: quando o tipo de cadastro for compatível com envio, mostrar o botão (e o painel).
- **Novo painel:** `<div class="tab-content" id="tab-locais-preferidos">` com:
  - Bloco **Origem preferida:** País, Estado, Região (opcional), Cidade (Brasil = combos; outros = texto).
  - Bloco **Destino preferido:** mesmos campos, reutilizando a lógica/API já usada no card atual (ou migrando o card para dentro desta aba).
- **Visibilidade da aba:** ao carregar o cadastro na aba Dados (ou ao alterar os checkboxes de Tipo de Cadastro), o script verifica se há tipo compatível (ex.: M); se sim, exibe o botão da aba e o painel; se não, oculta.
- **Salvar:** ao salvar o cadastro (ou ao clicar em “Salvar” na própria aba Locais preferidos, conforme definirmos), enviar origem e destino para o backend (campos em `MOTORISTA_COMPLEMENTO` ou endpoint específico).

---

## 5. Backend (APIs / banco)

- **Leitura:** ao buscar cadastro (ex.: GET por código), incluir na resposta os campos de destino preferido (já existentes) e, após criar as colunas, os de **origem preferida** (embarque). Se o endpoint for genérico de “cadastro”, incluir esses campos quando houver `MOTORISTA_COMPLEMENTO` para o cadastro.
- **Gravação:** ao salvar cadastro (PUT/POST), aceitar e persistir os novos campos de embarque em `MOTORISTA_COMPLEMENTO`; destino já é persistido.
- **Script SQL:** criar script (PostgreSQL) para adicionar as colunas de embarque em `MOTORISTA_COMPLEMENTO` (e, se necessário, comentários), espelhando a ideia do `adicionar_destino_preferido_motorista_postgres.sql`.

---

## 6. Ordem sugerida de implementação

1. **Definir lista de tipos compatíveis com envio** (ex.: `['M']`) em um único lugar no front (const ou config).
2. **Backend:** script SQL para adicionar colunas de **origem preferida** em `MOTORISTA_COMPLEMENTO`; ajustar GET/PUT do cadastro (ou do motorista/complemento) para ler e gravar esses campos.
3. **Front (HTML):** adicionar o botão da aba “Locais preferidos” (oculto por padrão) e o painel `tab-locais-preferidos` com os dois blocos (Origem e Destino), reutilizando estilos dos cards atuais.
4. **Front (JS):**  
   - Ao carregar/alterar tipo de cadastro, mostrar/ocultar a aba conforme os tipos compatíveis.  
   - Ao abrir a aba, preencher origem e destino a partir dos dados já carregados (ou request específico).  
   - Ao salvar, enviar origem e destino no payload do cadastro (ou endpoint “locais-preferidos” se preferir separado).
5. **Combos Brasil:** reutilizar APIs existentes de PAIS, ESTADO, CIDADE (e região, se houver) para preencher os selects quando País = Brasil; para outros países, inputs de texto.
6. **(Opcional)** Esconder o card “Destino preferido” da aba Dados quando a aba “Locais preferidos” existir, para evitar duplicidade; ou manter os dois sincronizados (mesma fonte de dados).

---

## 7. Resumo

| Item | Decisão |
|------|--------|
| Quando mostrar a aba | Apenas quando Tipo de Cadastro incluir tipo compatível com envio (ex.: Motorista M). |
| Conteúdo da aba | Dois blocos: Origem preferida (embarque) + Destino preferido (desembarque). |
| Campos por bloco | País, Estado/Província, Região (opcional), Cidade. Brasil = combos; outros = texto. |
| Persistência destino | Já em `MOTORISTA_COMPLEMENTO`. |
| Persistência origem | Novas colunas em `MOTORISTA_COMPLEMENTO` (PAIS_EMBARQUE_PREF, etc.). |
| Próximo passo | Aprovar o plano; em seguida: SQL de colunas de embarque → backend GET/PUT → aba no HTML → JS (visibilidade, preenchimento, salvar). |

Se quiser, na próxima etapa podemos detalhar o SQL exato das colunas e o nome dos campos no formulário (ids dos inputs e chaves do payload).

---

## 8. Dados externos (Paraguai)

**Não usar o SQL Server externo que foi avaliado:** a base foi considerada comprometida (“furada”), portanto **não será utilizada** para importar departamentos/distritos do Paraguai.

- **Paraguai na aba Locais preferidos:** manter como **texto livre** para Estado/Departamento, Região e Cidade (conforme item 2 do plano). Não há integração com banco externo.
- Se no futuro houver outra fonte confiável (API, CSV, ou outro banco seguro), pode-se definir carga para PAIS/ESTADO/CIDADE e então habilitar combos para Paraguai.

---

## 9. Implementação: lista registro a registro (atual)

- **Persistência:** tabela **`CADASTRO_LOCAL_PREFERIDO`** (script `backend/scripts/criar_tabela_cadastro_local_preferido_postgres.sql`).
  - Colunas: CDCADASTRO, SEQUENCIA, TIPO ('E'=origem, 'D'=destino), PAIS (obrigatório), CDUF (NULL = Todos), CDMESOREGIAO (NULL = Todos).
- **Tela:** um único bloco com combo **Tipo** (Origem/Destino), **País** (obrigatório), **Estado** (combo com opção "Todos"), **Mesorregião** (combo com opção "Todos"), botão **Adicionar e gravar**. Lista em baixo com os registros e botão para excluir cada linha.
- **Cascata:** País BR → carrega estados (API estados-brasil); Estado selecionado → carrega mesorregiões da tabela `MESOREGIAO` (API mesorregioes/:cduf). Outros países: apenas País (Estado/Mesorregião não aplicam).
- **Regra:** é necessário pelo menos uma origem e um destino (validação na tela e aviso na lista).
- **APIs:** GET/POST `/api/cadastros-gerais/:id/locais-preferidos`, DELETE `.../:sequencia`.

### Manutenção do cadastro MESOREGIAO

Fica previsto um **programa separado** para dar manutenção no cadastro de **MESOREGIAO** (consultar, incluir, alterar, inativar). Quando for implementado, utilizar a tabela `public."MESOREGIAO"` (CDUF, CDMESOREGIAO, DSMESOREGIAO, etc.).
