# Processo de validação dos compatíveis – Gerenciar Viagens / Compatíveis

## Status das regras de embarque e desembarque (resumo)

| Regra | Projetada? | Funcionando? | Observação |
|-------|------------|--------------|------------|
| **Local de embarque** | Sim | Sim | **Locais preferidos** (`CADASTRO_LOCAL_PREFERIDO`, TIPO='E'): sem preferência = qualquer origem; com preferência = origem da viagem (País, CDUF, CDMESOREGIAO) deve bater. Não usa cidade. Não usa os campos “origem preferida” (PAIS_EMBARQUE_PREF, CIDADE_EMBARQUE_PREF, etc.) do MOTORISTA_COMPLEMENTO. |
| **Local de desembarque** | Sim | Sim | **Locais preferidos** (`CADASTRO_LOCAL_PREFERIDO`, TIPO='D'): sem preferência = qualquer destino; com preferência = destino da viagem (País, CDUF, CDMESOREGIAO) deve bater. Não usa cidade. Aceita lista separada por vírgula em estado/cidade. País do destino da viagem passou a vir do JOIN com PAIS (SGPAIS); antes caía sempre em 'BR'. |

---

## Visão geral

Na aba **Compatíveis** do Gerenciar Viagens, o sistema lista **motoristas compatíveis** com uma viagem selecionada. Quem entra na lista depende de **quatro regras** configuráveis, gravadas na tabela `CONFIGURACAO` e aplicadas na hora da busca.

---

## Onde acontece

| Camada | O quê |
|--------|--------|
| **Frontend** | Aba "Compatíveis" → card "Regras de compatibilidade" (4 checkboxes) → seleção de viagem → botão "Buscar Motoristas Compatíveis" |
| **Backend** | `GET /api/viagens/:idViagem/motoristas-compativel` → `viagemmestre.controller.js` → `buscarMotoristasCompatíveis` |
| **Regras** | Lidas em `CONFIGURACAO` pelas chaves abaixo; alterações auditadas em `REGRA_COMPATIVEL_AUDIT` |

---

## As quatro regras (validações)

Cada regra é uma chave em `CONFIGURACAO` com valor `S` (ativa) ou `N` (inativa). Na tela, o usuário marca/desmarca os checkboxes e clica em **Salvar regras**. Só depois disso é que a próxima busca de compatíveis usa as regras atualizadas.

| Regra | Chave em CONFIGURACAO | O que faz quando **ativa** |
|-------|------------------------|----------------------------|
| **Validar exigência de rastreamento** | `regra_compativel_rastreamento` | Se a viagem for rastreada (`FGRASTREADO = 'S'`), só entram motoristas com `FGRASTREADO = 'S'`. |
| **Validar classe de frota** | `regra_compativel_classe_frota` | Só motoristas que tenham na `CLASSEFROTA_CG` a mesma `CDCLASSEFROTA` da viagem. Se a viagem não tiver classe, a API retorna 400. |
| **Validar local de embarque / carregamento** | `regra_compativel_local_embarque` | **Locais preferidos** (`CADASTRO_LOCAL_PREFERIDO`, TIPO='E'). Sem registro de origem = qualquer origem; com registro = origem da viagem (País, CDUF, CDMESOREGIAO da cidade do roteiro) deve bater. Não usa cidade. |
| **Validar local de desembarque / descarga** | `regra_compativel_local_desembarque` | **Locais preferidos** (`CADASTRO_LOCAL_PREFERIDO`, TIPO='D'). Sem registro de destino = qualquer destino; com registro = destino da viagem (País, CDUF, CDMESOREGIAO) deve bater. Não usa cidade. |

Quando uma regra está **inativa**, o filtro correspondente **não é aplicado** (ex.: sem validar rastreamento, qualquer motorista ativo pode aparecer, desde que atenda às outras regras ativas).

---

## Fluxo na tela (Compatíveis)

1. Usuário abre a aba **Compatíveis**.
2. O frontend chama `GET /api/viagens/regras-compatibilidade` e preenche os 4 checkboxes com o estado atual das regras.
3. Usuário pode marcar/desmarcar as validações e clicar em **Salvar regras** → `PUT /api/viagens/regras-compatibilidade` grava em `CONFIGURACAO` e registra em `REGRA_COMPATIVEL_AUDIT`.
4. Usuário escolhe uma viagem no combo (ex.: “Carregar Viagens Pendentes” e depois seleciona uma).
5. Clica em **Buscar Motoristas Compatíveis** → `GET /api/viagens/:idViagem/motoristas-compativel`.
6. O backend lê de novo as quatro chaves em `CONFIGURACAO`, monta a query aplicando só os filtros das regras ativas, e devolve a lista de motoristas compatíveis.
7. A lista é exibida no grid; o usuário pode selecionar motoristas e usar “Preparar Anúncio” / “Disparar Convocações”.

---

## Critérios sempre aplicados (independentes das regras)

- Cadastro ativo: `FGACTIVE = 'A'`.
- Perfil de motorista: tipo de cadastro / flags que indiquem motorista (ex.: `FGTIPOCADASTRO`, `FGMOTORISTA`, `FGAGENTE`, `FGGRUPO`, `FGTRANSPORTADOR`) conforme a query em `buscarMotoristasCompatíveis`.
- Pelo menos uma classe de frota ativa em `CLASSEFROTA_CG` (quando a regra de classe está ativa, essa classe tem que ser a da viagem).

---

## APIs relacionadas

- `GET /api/viagens/:idViagem/motoristas-compativel` – busca compatíveis (aplica as 4 regras conforme CONFIGURACAO).
- `GET /api/viagens/regras-compatibilidade` – lê o estado atual das 4 regras para exibir na tela.
- `PUT /api/viagens/regras-compatibilidade` – salva as 4 regras em `CONFIGURACAO` e grava auditoria em `REGRA_COMPATIVEL_AUDIT`.

---

## Resumo

O “processo de validação” dos compatíveis é: **ler as 4 regras da CONFIGURACAO → aplicar só as que estiverem ativas na query de motoristas → retornar a lista**. A validação é toda feita no backend, no `buscarMotoristasCompatíveis`; a tela só configura as regras e dispara a busca.
