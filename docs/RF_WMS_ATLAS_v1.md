# RF — WMS / Estoque (Atlas Cargo) v1.0

**Tipo:** requisitos + matriz de escopo **MVP** (reunião de fechamento **~30 min**).  
**Relacionado:** `docs/PLANO_ESTOQUE_TERCEIROS_E_CROSSDOCKING_ATLAS_CARGO.md`, anexos OPL/NF-e e modelos de impressão.

---

## 1. Objetivo do documento

Registrar **o que entra na primeira entrega (MVP)** e o que fica para **fase 2+**, após a reunião em que cada responsável marcar **Sim / Não** (ou **Parcial**) por bloco.

**Legenda “Proposta pré-reunião”:** sugestão da análise já feita nos artefatos; **substituir** pela decisão oficial na coluna “Decisão reunião”.

---

## 2. Código de produto com pontos (máscara hierárquica)

**Regra de negócio (confirmada pelo cliente):** o código com **pontos** (ex.: `6.03.04.016.20`) **não é formatação cosmética**. Cada segmento corresponde a níveis do cadastro (**família, grupo, subgrupo, gênero**, etc., conforme convenção do dono do estoque / operador).

**Implicações para o Atlas:**

1. **Cadastro de produto** deve suportar essa **árvore** (campos ou tabelas hierárquicas alinhadas à máscara).  
2. **Importação NF-e / TXT OPL** pode trazer código **sem pontos** ou **outro formato** — o sistema deve **resolver** para o mesmo SKU via de-para ou regra de **reidratação** da máscara (ex.: inserir pontos nas posições fixas definidas por tenant), **sem perder o significado** dos níveis.  
3. **Comparação / busca:** definir **forma canônica interna** (ex.: armazenar segmentos em colunas + string exibição) e funções de equivalência para match com XML e com fornecedores que usam código “plano” ou com hífen.

---

## 3. Requisitos funcionais de alto nível (independente de fase)

| ID | Descrição |
|----|------------|
| RF-01 | Operar **estoque de terceiros** e **crossdocking** como modos configuráveis por tenant/dono do estoque. |
| RF-02 | **Entrada** com NF-e (XML), espelho de conferência, tratativa de divergência, **lote** e **validade** quando exigido pelo tipo de produto. |
| RF-03 | **De-para** entre código NF/fornecedor e **código do dono** (máscara hierárquica) + **fator de conversão** de unidades. |
| RF-04 | **Etiqueta de pallet** com campos alinhados ao modelo em `ANEXO_MODELOS_IMPRESSOS_WMS.md` §4. |
| RF-05 | **Pedido de separação** a partir do arquivo OPL (layout Teknisa / SUP07910) + **romaneio** (PDF espelhando modelos Mana/Nutriville). |
| RF-06 | **Separação** com quantidade coletada obrigatória; validade na linha quando política exigir (FEFO/FIFO — ver P3 no plano). |
| RF-07 | **Conferência** (espelho + registro sistêmico). |
| RF-08 | **Carga programada** com agregação peso/volume e vínculo com **viagem / rota** no Atlas. |
| RF-09 | **Saída** com apoio a XML de NF-e e uso do nó **`entrega`** quando endereço ≠ `dest`. |
| RF-10 | **RBAC**: módulo WMS, grupos (Entrada / Movimentação / Saída / Cadastros), funções e escopo por **dono / armazém / doca** quando aplicável. |

---

## 4. Matriz MVP — reunião ~30 min (preencher “Decisão reunião”)

Instruções: para cada linha, marcar **Sim** (entra no MVP), **Não** (fase 2+) ou **Parcial** (MVP reduzido — anotar no campo Notas).

| # | Bloco | Proposta pré-reunião | Decisão reunião | Notas |
|---|--------|----------------------|-----------------|-------|
| M1 | **Cadastros WMS** (dono estoque, armazém, área, doca, doca inativa?) | Sim (mínimo) | | |
| M2 | **Portaria / agenda** (fila caminhão doca) | Não → v1.1 | | *Proposta:* sem portaria o MVP ainda recebe/despacha; risco operacional a avaliar. |
| M3 | **Recebimento NF-e XML** + espelho + conferência entrada | Sim | | |
| M4 | **Cadastro rápido** fornecedor/produto na importação | Parcial | | *Proposta:* permitir “pendente cadastro” com alerta. |
| M5 | **De-para + máscara hierárquica** + conversão UM | Sim | | |
| M6 | **Etiqueta pallet** (impressão) | Sim | | Falta fechar mm/impressora (P1). |
| M7 | **Importação TXT OPL** (pedido separação) | Sim | | Depende de spec posicional fechada (P2). |
| M8 | **Romaneio picking PDF** (seco/frio, modelos atuais) | Sim | | |
| M9 | **Separação web** (coletar qtd, validade opcional) | Sim | | |
| M10 | **Coletor / mobile** picking | Não → v1.1 | | *Proposta:* depois do fluxo web estável. |
| M11 | **Conferência pós-separação** | Sim | | |
| M12 | **Inventário** (geral) | Parcial | | *Proposta:* ajuste manual mínimo no MVP; inventário “oficial” v1.1. |
| M13 | **Inventário cíclico** | Não → v2 | | |
| M14 | **Carga programada** + rota Waze / GPS no romaneio | Parcial | | *Proposta:* MVP com lista de paradas + totais; otimização “vizinho mais próximo” v1.1 se necessário. |
| M15 | **Vínculo com viagem** Atlas | Sim | | Após carga estável. |
| M16 | **Espelho nota descarga** (por perfil fornecedor) | Parcial | | *Proposta:* 1 template genérico + 2 perfis (TIROL / BIOMEDICA). |
| M17 | **NF saída** — leitura XML conferência | Sim | | |
| M18 | **Devoluções** (retorno ao armazém) | Não → v1.1 | | |
| M19 | **Integração SEFAZ** (consulta/manifesto online) | Não → v2 | | *Proposta:* arquivo XML autorizado continua fonte no MVP. |
| M20 | **Relatórios BI** pesados | Não → v2 | | |

---

## 5. Próximo passo após a reunião

1. Copiar a tabela da §4 para ata ou **preencher a coluna “Decisão reunião”** neste arquivo.  
2. Atualizar **`§15` do PLANO** com datas alvo se quiser versionar por sprint.  
3. Iniciar **ERD + DDL** só para os itens **Sim** do MVP.

---

*RF v1.0 — criado para suportar decisão Sim/Não; revisar após reunião.*
