# Manual do operador — Inventário WMS

**Público:** equipe de armazém e supervisão.  
**Sistema:** Atlas Cargo → **WMS — Inventário** (`estoque-inventario`).

---

## 1. O que é este inventário?

É o processo para **igualar o estoque do sistema à contagem física** do armazém, sem usar nota fiscal fictícia.

- O sistema mostra o que tinha no **momento do corte** (snapshot).
- Você informa o que **contou no chão** (planilha).
- Ao **encerrar**, o Atlas grava só a **diferença** (ajuste de saldo).

---

## 2. Antes de começar

1. Confirme o **dono do estoque** (cliente/conta) com o supervisor — um inventário = um dono.
2. Produtos contados devem estar **cadastrados** (Cadastros WMS → Produtos do dono). O código da planilha pode vir **com ou sem máscara** (ex.: `6010156800` na planilha = `6.01.01.568.00` no cadastro).
3. Combine com a equipe se haverá **pausa** de recebimento e expedição durante a contagem.
4. Baixe o **CSV modelo** na aba *Planilha modelo* do módulo Inventário.

---

## 3. Passo a passo (inventário geral)

### Passo 1 — Abrir inventário

1. Acesse **WMS — Inventário** → aba **Operação**.
2. Escolha o **Dono do estoque**.
3. Tipo: **Geral** (ajuste) ou **Inicial** (primeira carga).
4. Política *itens não contados*:
   - **Manter** — produto que estava no sistema mas não entrou na planilha **não é alterado** (mais seguro).
   - **Zerar** — produto do snapshot sem contagem na planilha vira **quantidade zero** (use só se o supervisor orientar).
5. Clique em **Novo inventário**.

### Passo 2 — Snapshot (corte do sistema)

1. Abra o inventário na lista (**Ver detalhe**).
2. Clique em **Gerar snapshot do sistema**.
3. O sistema registra a posição naquele instante. **Guarde a data/hora** informada na tela.

> Para testes após desenvolvimento, a TI pode rodar o script de limpeza operacional (ver seção 8).

### Passo 3 — Contagem física

1. Conte no armazém (endereço, pallet, câmara, etc.).
2. Preencha a planilha CSV (separador **;**):
   - **CODIGO_PRODUTO** — obrigatório
   - **QTD_CONTADA** — obrigatório
   - **LOTE** / **VALIDADE** — obrigatórios se o produto controlar
   - **FATOR_CONVERSAO** — normalmente `1`

### Passo 4 — Importar contagem

1. No detalhe do inventário, **Importar planilha CSV**.
2. Revise a tabela de linhas e o bloco **Resumo de ajustes (por produto)**.
3. Se aparecer o painel **Linhas não importadas**, cadastre o produto (**Cadastrar** + nome) ou corrija lote/validade e use **Reimportar linha** / **Reimportar CSV** (substitui a mesma chave, sem duplicar saldo).
4. Corrija demais erros antes de encerrar.

### Passo 4b — Ata para conferência e assinaturas

Use os botões no **detalhe do inventário** (não confundir com *WMS — Relatórios → Posição de estoque*, que mostra o saldo atual do sistema, não a lista contada deste documento).

| Botão | Quando usar |
|--------|-------------|
| **Ata prévia** | Antes de encerrar — conferência da equipe; o PDF traz faixa *PRÉVIA* (sem valor oficial). |
| **Ata / PDF** | Após **Encerrar** — documento para imprimir e coletar assinaturas (contagem, conferência, supervisão). |
| **Ata CSV** | Mesmos dados da ata em planilha (arquivo ou e-mail). |

O cabeçalho da ata mostra o inventário, dono, datas de corte/encerramento, quem alterou o documento por último e **quem emitiu o relatório** (usuário logado no Atlas).

> **Dica:** permita pop-up do navegador ao abrir **Ata prévia** ou **Ata / PDF**.

### Passo 5 — Encerrar

1. Supervisor confere divergências grandes (pode usar **Ata prévia**).
2. Clique em **Encerrar inventário** e confirme.
3. Gere **Ata / PDF** para arquivar e assinaturas.
4. Depois, confira o saldo em **WMS — Relatórios → Posição de estoque**.

**Atenção:** encerramento **não pode ser desfeito** na tela. Em caso de erro grave, chame a TI.

---

## 4. Carga inicial (sem estoque no sistema)

1. Tipo **Inicial**.
2. **Não** é obrigatório gerar snapshot (pode importar direto a planilha com as quantidades contadas).
3. Encerrar → o sistema cria saldo pelos ajustes positivos.

---

## 5. O que não fazer

- Não usar **Recebimento** com XML de nota “inventada” para corrigir saldo.
- Não misturar **dois donos** na mesma planilha.
- Não encerrar sem revisar o **resumo de ajustes**.
- Não alterar o arquivo CSV depois de importar sem reimportar (substitui as linhas da mesma chave produto+lote+validade).

---

## 5.1. Como decidir o que contar (reserva, expedição, divergência grande)

> **Regra de ouro:** você informa **sempre o que está fisicamente no armazém** no momento da contagem. O sistema é que se ajusta ao físico, não o contrário.

### A. Produto com reserva, mas ainda não separado

Reserva OPL (`QTD_RESERVA_SKU` no relatório de Posição de Estoque) é apenas uma **intenção lógica** — significa que algum espelho/picking tem aquele produto agendado para sair. Enquanto a carga não foi expedida, o produto continua **fisicamente** no armazém ocupando posição.

- **Conte normalmente.** Inclua tudo que estiver nas posições de armazenagem (pallet rack, câmara, refrigerado, congelado).
- A reserva continua válida após o ajuste. Quando o picking realmente sair (separação confirmada + expedição), o `EXPEDICAO_SAIDA` desconta do saldo já ajustado — sem gerar negativo.
- **Não contar o reservado gera saldo negativo no futuro** (porque a expedição vai descontar de um saldo menor do que o real).

### B. Produto em área de expedição/doca (já separado, aguardando carregamento)

Esse é o caso especial em que o produto **fisicamente saiu** do endereço de armazenagem para a área de carregamento, mas o `EXPEDICAO_SAIDA` ainda não foi gerado (carga não confirmada).

- Se está em **endereço de armazenagem** (rack/pallet/câmara identificado) → **conte**.
- Se está na **doca/expedição** (pallet identificado para a carga, aguardando o caminhão) → **NÃO inclua na contagem do inventário cíclico**. Anote em separado e fale com o supervisor antes de encerrar.
- Motivo: ele está em "trânsito interno" e o saldo do sistema ainda não desceu — contar duplicaria.

### C. Divergência grande entre sistema e físico

Diferenças enormes (sistema 5 / físico 214, p. ex.) são comuns no cíclico, principalmente nos primeiros meses pós carga inicial. Causas típicas:

1. **Carga inicial parcial** — a planilha de carga não cobriu todos os SKUs/quantidades.
2. **NF-e de entrada não encerrada** (status pendente no Recebimento) → não somou no saldo.
3. **Cadastro divergente** (fator/unidade diferente).
4. **Saídas registradas sem entrada** (movimento manual antigo).

**O que fazer:** **conte o físico real e ajuste**. O inventário cíclico existe exatamente para corrigir essas divergências sem parar a operação. Depois investigue a causa raiz para o próximo ciclo ter menos ruído.

### D. SKU com múltiplas validades reais (snapshot trouxe validade fictícia)

Quando o snapshot inicial carregou a validade como "fictícia" (ex.: `31/12/2026` para tudo) e em campo você encontra duas ou mais datas reais:

1. Edite a linha original — atualize a validade da primeira "porção" para a data real.
2. Use o ícone **Dividir lote/validade** (bifurcação na coluna Ações) para criar uma linha-irmã do mesmo SKU com a outra validade + quantidade.
3. Repita para cada combinação de lote/validade encontrada.

O sistema mostra `↑ mesmo SKU` na coluna "Sist. linha" das linhas adicionais (saldo do sistema é por SKU, não por validade). O ajuste no encerramento é consolidado: **soma de todas as contagens vs. saldo total do produto**.

### Decisão rápida (cheat-sheet)

| Situação | Conta? |
|----------|--------|
| Está no rack/câmara, sem reserva | **Sim** |
| Está no rack/câmara, com reserva OPL | **Sim** (reserva é lógica, não física) |
| Pallet identificado na doca esperando carregar | **Não** (trate à parte) |
| Bloqueado (avariado, vencido, isolado) | **Sim**, em linha separada ou observação |
| Produto avariado/quebrado | **Não conta como saldo** — separa para descarte/devolução |
| Produto sem cadastro WMS | **Sim**, mas cadastra antes de importar/digitar |

---

## 6. Dúvidas frequentes

| Situação | O que fazer |
|----------|-------------|
| Produto não importa | No painel **Linhas não importadas**: **Cadastrar** → **Salvar e reimportar**, ou corrigir o CSV e **Reimportar CSV** |
| Falta lote/validade | Preencher colunas ou ajustar cadastro do produto |
| “Nenhum ajuste a aplicar” | Planilha igual ao saldo, ou política **Manter** sem contagem |
| Entrada com NF-e real | Use **WMS — Recebimento**, não inventário |
| Preciso de lista para assinar | **Ata / PDF** no inventário (não o relatório de posição de estoque) |
| Pop-up bloqueado | Liberar pop-up no navegador e clicar de novo em **Ata / PDF** |

---

## 6.1. Inventário cíclico (rotina por amostra)

Diferente do inventário **Geral** (que conta o armazém inteiro), o **cíclico** conta uma pequena lista de SKUs por dia/semana, sem parar a operação. O sistema gera a lista automaticamente segundo o critério escolhido.

### Como gerar uma lista

1. Na tela **WMS — Inventário**, clique em **Gerar lista de ciclo** (botão azul ao lado de "Novo").
2. Escolha o **dono do estoque**.
3. Escolha um dos critérios:
   - **ABC (giro)** — top N SKUs mais movimentados na janela. Use semanal.
   - **Vencimento próximo** — SKUs com validade até X dias. Use diário em refrigerados/congelados.
   - **Não contados há mais tempo** — varre quem não foi contado há muito tempo. Use diário.
   - **Mais movimentados** — top N por volume sem classificação A/B/C.
   - **Aleatório** — amostragem para auditoria. Use mensal.
   - **Por conservação** — filtra todos do tipo (REFRIG, CONGEL, SECO…). Use rotina mensal por categoria.
4. Defina **Qtd. máx. de SKUs** (padrão 50; máximo 500) e **Janela (dias)** (padrão 30).
5. Filtros opcionais: **Conservação** (substring no tipo de armazenagem) e **Palavra-chave produto** (substring no nome).
6. Clique **Pré-visualizar lista** → confira os SKUs candidatos.
7. Clique **Criar inventário com esta lista** → o sistema cria um inventário **CICLICO** já com as linhas pré-populadas (snapshot por SKU).

### Como contar e encerrar

Depois de criar, o fluxo é igual ao Geral:
- Imprima/exporte a **Ata prévia** ou faça download da lista, conte fisicamente, preencha as colunas **QTD_CONTADA** no CSV modelo e **Importe CSV** no inventário.
- O sistema usa **política MANTER** (obrigatória no cíclico): só ajusta os SKUs listados.
- **Encerrar** gera `INVENTARIO_AJUSTE` apenas para os SKUs do ciclo.

### Boas práticas (sugestão de cronograma)

| Frequência | Critério | Limite | Observação |
|------------|----------|--------|-----------|
| Diário (manhã) | Vencimento próximo | 30 | Refrigerados/congelados primeiro |
| Diário (tarde) | Não contados há mais tempo | 30 | Garante cobertura mensal |
| Semanal | ABC (giro) | 50 | Top giro do dono |
| Mensal | Aleatório | 30 | Auditoria estatística |

### Status por linha e tolerância (passo a passo na tela)

Quando você abre um inventário cíclico, vê:

1. **Contadores no topo**: quantas linhas estão em cada status — *Pendentes / Contados / Divergentes / Recontar / Aprovados*.
2. **Campo "Tolerância (%)"**: aceita o desvio permitido sem ser divergência. Ex.: `1` aceita até 1% de diferença entre contado e sistema. Salvar com **Aplicar**.
3. **Tabela "Linhas"** com a coluna **Status** colorida:
   - `PENDENTE` (cinza) — ainda não foi contado.
   - `CONTADO` (verde) — bate com o sistema dentro da tolerância.
   - `DIVERGENTE` (vermelho) — desvio acima da tolerância. Precisa decisão.
   - `RECONTAR` (amarelo) — você marcou para contar de novo.
   - `APROVADO` (azul) — supervisor aprovou a divergência.
4. **Botões na coluna "Ações"**:
   - **Refresh (amarelo)**: marca a linha para nova contagem (apaga a quantidade atual).
   - **Escudo (azul)**: supervisor aprova divergência.

**Regra**: o sistema **não deixa encerrar** o inventário cíclico se houver linha em `PENDENTE`, `DIVERGENTE` ou `RECONTAR`. Mensagem do bloqueio diz quantas linhas falta resolver.

---

## 6.2. Edição direta na tabela (digitação rápida)

Para coletas de poucos itens (cíclico) ou correções pontuais, não é necessário importar CSV. Você pode digitar direto nas colunas da tabela **Linhas** dentro do detalhe do inventário, enquanto o status estiver `EM_CONTAGEM` ou `REVISAO`.

### O que pode editar

| Coluna | Como editar | Validações |
|--------|-------------|------------|
| **Contada** | Digite o número e pressione **Enter** (ou clique fora). `Esc` cancela. | ≥ 0; aceita decimais (use `.` ou `,`). |
| **Lote** | Digite e pressione **Enter** / clique fora. | Não pode haver outra linha com mesmo SKU + lote + validade no inventário. |
| **Validade** | Use o seletor de data (formato AAAA-MM-DD). | Pode ficar vazio (produto sem controle de validade). |

O **Status** muda automaticamente após salvar a contagem:
- `CONTADO` — está dentro da tolerância configurada (ex.: 1%).
- `DIVERGENTE` — fora da tolerância; precisa decisão.
- `PENDENTE` — voltou para pendente se você apagar o valor.

### Múltiplas validades no mesmo SKU (Dividir linha)

Acontece quando você sobe inventário inicial com **validade fictícia** (ex.: `31/12/2026`) e depois precisa **corrigir para as datas reais** observadas no chão.

Como fazer:

1. Encontre a linha do SKU com a validade fictícia.
2. Clique no ícone **Dividir** (bifurcação) na coluna **Ações**.
3. No modal que abre, informe:
   - **Lote** (opcional) e **Validade** reais do segundo grupo.
   - **Quantidade contada** dessa nova combinação.
4. Confirme. O sistema cria uma **linha-irmã** (mesmo SKU, lote/validade diferentes) com `Sist. linha = 0`. O ajuste no encerramento soma todas as contagens do SKU contra o saldo total do sistema.

> Quando o inventário tem ao menos um SKU com mais de uma linha, aparece um **banner azul** explicando que a coluna *Sist. linha* mostra o saldo só na **primeira linha** de cada SKU (linhas adicionais ficam com `↑ mesmo SKU`) — evita a confusão de achar que o saldo está duplicado.

### Adicionar SKU manualmente (fora do snapshot/CSV)

Use quando o operador encontra em campo um SKU que **não estava na lista** (cíclico ou geral). Em vez de criar outro inventário ou esperar a importação CSV, adicione a linha direto:

1. No detalhe do inventário aberto, clique em **Adicionar SKU** (botão na barra de ações da tabela, ao lado do **Importar CSV**).
2. Digite o **código do produto** (com ou sem máscara — ex.: `6031202020` ou `6.03.12.020.20`). À medida que digita, o sistema sugere até 25 produtos do **dono atual** que batem com o código ou parte do nome.
3. Confirme escolhendo um item da lista (ou termine de digitar — o resolvedor aceita variações de máscara).
4. Preencha **Lote** e **Validade** se aplicável (opcionais — produtos SECOs normalmente não exigem).
5. Preencha **Quantidade contada** (opcional — pode deixar em branco e contar depois).
6. Clique em **Adicionar SKU**. A linha aparece imediatamente na tabela com origem `MANUAL`, observação `ADICIONADA MANUAL por <usuário>` e `Sist. linha = 0`.

**Regras:**

- O produto **precisa estar cadastrado** para este dono em `Cadastros WMS → Produtos do dono`. Sem cadastro, o sistema mostra o erro com instrução clara — cadastre o produto e tente de novo.
- **Anti-duplicidade**: se já existe linha com mesmo SKU + lote + validade, o sistema bloqueia e te aponta o número da linha existente. Edite no lugar (Contada/Lote/Validade são editáveis na tabela) ou use **Dividir** se precisa de outra combinação.
- O ajuste no encerramento trata essa linha como qualquer outra: contado vs. saldo do sistema (que para esse SKU "não listado" pode ser 0 ou ter valor — o sistema busca a posição atual do dono).

> **Quando NÃO usar:** se você está movendo estoque entre donos (ex.: TALHARIM da Nutriville para a Mana), o caminho correto é **Transferência entre donos** (próxima seção). Adicionar SKU manualmente no inventário do destino dá um "ajuste positivo", mas não baixa o estoque na origem.

### Excluir uma linha do inventário

Útil em duas situações comuns:

1. **Linha-fantasma do snapshot**: depois que você desmembrou um SKU em múltiplas validades reais (via Dividir), sobra a linha original sem contagem. Em vez de digitar `0`, exclua direto.
2. **Linha digitada errada**: você criou uma linha por engano (lote/validade incorretos, SKU duplicado) e prefere remover em vez de editar.

Como fazer:

1. Encontre a linha na tabela **Linhas**.
2. Clique no ícone de **lixeira** (vermelho discreto) na coluna **Ações**.
3. Confirme no diálogo. Se a linha tem contagem registrada, o diálogo **avisa em vermelho** com a quantidade que será descartada.
4. A linha some imediatamente da lista. O contador no topo (PENDENTE/CONTADO/DIVERGENTE) é recalculado automaticamente.

> **Importante:** excluir uma linha **não afeta o saldo de estoque** — o inventário ainda não foi encerrado, então só estamos retirando dados de coleta. Após encerrar, o ajuste é calculado pela soma das **linhas restantes** vs. saldo do sistema.

**Restrições:**

- Não dá para excluir se o inventário está `ENCERRADO` ou `CANCELADO` (a "janela" operacional já fechou). Para inventário `CANCELADO`, reative-o antes.
- Linha em status `APROVADO` (supervisor aceitou a divergência) precisa ser destravada com **Recontar** antes de poder excluir.

### Data da entrada preservada após reabertura (DH_PRIMEIRO_ENCERRAMENTO)

**Sintoma:** você reabre uma NF para corrigir alguma coisa, salva, encerra de novo, e o relatório de Movimentação passa a mostrar a entrada com a data de **agora**, não a data original. Isso destrói a auditoria temporal do estoque ("essa NF entrou em maio, mas o relatório diz que foi em outubro porque ajustei depois").

**Causa:** o campo `DH_ENCERRAMENTO` é sobrescrito a cada encerramento.

**Correção (Fase 3b.7):** existe agora uma coluna `DH_PRIMEIRO_ENCERRAMENTO` que **só é gravada uma vez** (no primeiro encerramento da NF). Reaberturas seguintes mantêm o valor original. O relatório de Movimentação usa essa coluna como data oficial da entrada, com fallback para `DH_ENCERRAMENTO` em NFs antigas.

**Como ativar (uma vez só):**

1. Rode no pgAdmin: `backend/scripts/adicionar_dh_primeiro_encerramento_nfe_postgres.sql`. Esse script:
   - Adiciona a coluna `DH_PRIMEIRO_ENCERRAMENTO TIMESTAMPTZ`.
   - **Backfill automático**: para NFs já encerradas, copia o `DH_ENCERRAMENTO` atual (não temos o histórico real, mas é a melhor aproximação).
   - Cria índice para consulta rápida.
2. **Reinicie o backend** (o cache do relatório só detecta a coluna no startup).
3. A partir daí, cada reabertura mantém a data original do primeiro encerramento.

**Resiliente a schema antigo:** se o cliente ainda não rodou a migration, o sistema continua funcionando (cai no fallback `DH_ENCERRAMENTO`). Mas o problema da "data andando no tempo" persiste até rodar o script + reiniciar.

### Reservas OPL órfãs (trava de cobertura descontando 2x)

**Sintoma:** o SKU tem estoque físico no inventário/movimentação, mas a **trava da simulação OPL** diz `posição N − N = 0, falta X`. Você sabe que tem estoque (ex.: 2 unidades do detergente), mas o sistema reclama que falta.

**Causa:** a tabela `WMS_RESERVA_ESTOQUE_OPL` guarda quanto cada **espelho OPL** (arquivo de separação) reservou para cada produto quando o picking foi encerrado. Essa reserva é apagada quando **todas** as cargas vinculadas ao espelho são expedidas. Em alguns cenários (NF-saída importada antes do espelho, pedido reaproveitado, link parcial), a limpeza não acontece e a reserva fica órfã — descontando 2× da trava (uma na saída física, outra na reserva).

**Como detectar:**

1. **Por SKU**: clique na lupa 🔍 ao lado do código no relatório de **Posição** ou **Movimentação**. O modal mostra uma seção **"Reservas OPL"** com cada espelho que reserva esse produto e a classificação `ATIVA` ou `ÓRFA`.
2. **Por tenant**: vá em **Auditoria de Saúde** → cartão **"Reservas OPL órfãs"** + bloco **F**.

**Como limpar (operação segura):**

1. Abra a Auditoria de Saúde.
2. No bloco **F — Reservas OPL órfãs**, confira a lista.
3. Clique no botão vermelho **🧹 Limpar reservas órfãs** no cabeçalho do bloco.
4. Confirma. O sistema apaga **somente** as reservas dos espelhos cujas cargas já foram **todas** expedidas — reservas legítimas (com carga pendente) ficam intactas.
5. A página recarrega; veja se o contador zerou.

**API equivalente** (para automação):

- `GET /api/wms/reservas-opl?cdDono=N&cdProduto=X` — lista reservas de um SKU.
- `GET /api/wms/reservas-opl/orfas?cdDono=N` — varredura.
- `POST /api/wms/reservas-opl/limpar-orfas?cdDono=N` — limpa.

> **Não é resgate do passado, é prevenção também**: a limpeza não altera saldos físicos (a tabela `WMS_RESERVA_ESTOQUE_OPL` só desconta da trava, não da posição). Você pode rodar com tranquilidade — o pior que acontece é uma reserva legítima ser apagada, e ela é recriada na próxima vez que o picking daquele espelho rodar (o que provavelmente nunca vai acontecer se o espelho já completou todo o ciclo).

### Encerrar NF-e exige "Qtd recebida" preenchida (anti-"NF em branco")

A causa raiz do problema do PIPOCA DOCE era exatamente esta: a NF foi marcada como **ENCERRADA** sem que o operador tivesse digitado nada na coluna **Qtd recebida** das linhas. Quando isso acontece, `qtdConvertida` vale 0 e a entrada **não soma** na Posição de Estoque.

A partir de agora o sistema **bloqueia o encerramento** (botão "Encerrar NF") quando algum item tem:

- Produto resolvido (autocomplete preenchido, "Salvar de-para" usado, etc.)
- **MAS** a coluna "Qtd recebida" está em branco.

Operações suportadas:

| Situação | Comportamento |
|---|---|
| Operador digita `0` em "Qtd recebida" | **Permitido**. Vira `qtdConvertida = 0` registrado intencionalmente (item recusado / não veio na carga). |
| Operador deixa "Qtd recebida" vazia | **Bloqueado**. Mensagem aponta exatamente quais itens estão pendentes; o cursor pula para o primeiro item incompleto. |
| Operador clica em "Salvar conferência" | **Permitido mesmo vazio** — salvar é estado intermediário. Bloqueio só vale no **Encerrar**. |
| NF já encerrada errada (legado) | Use a aba **Auditoria de Saúde** (bloco D) para listá-las, depois **Reabrir NF** + preencher Qtd + Encerrar de novo. |

Tanto o front quanto o backend aplicam a regra (defesa em profundidade — o backend ainda barra mesmo se alguém chamar a API direto). Mensagem do erro: lista até 5 itens com `nItem` + `codigoProduto`.

### Auditoria de Saúde do Estoque (varredura geral do tenant)

Use **antes** de pensar em fechar mês, antes de subir um inventário grande, ou sempre que ficar com a impressão de que "tem coisa furada que não estou vendo". A auditoria varre o tenant inteiro (ou um dono específico) e lista, numa página só, **todos** os pontos com risco de divergência:

1. Abra **Estoque → Relatórios**, vá na aba **Auditoria de Saúde**.
2. Opcional: selecione um **Dono** (deixar em branco audita o tenant inteiro).
3. Defina o corte de **NF aberta há mais de N dias** (default: 7).
4. Clique em **Gerar auditoria**.

A página abre em popup com 5 cartões de resumo e 5 blocos detalhados:

| Bloco | O que mostra | Por que importa |
|---|---|---|
| **D) Conferência inválida** (vermelho) | NF-e ENCERRADAS com itens da conferência **zerados** ou **sem cdProduto** — agrupado por NF, mostrando quantos itens têm `Qtd = 0` e quantos têm `Sem cdProduto`. | É o caso clássico de NF "encerrada em branco" (operador encerrou sem digitar quantidade). Toda essa entrada **não está somando** no estoque. |
| **A) Só movimento** (amarelo) | SKUs que têm `Saldo SKU > 0` apenas por causa de movimentos (inventário/ajuste) — NF encerrada = 0. | É o caso PIPOCA DOCE. A posição existe mas não foi rastreada pelo recebimento. |
| **B) Saldo negativo** (vermelho) | SKUs onde saiu mais do que entrou (`Saldo SKU < 0`). | Indica conferência errada, separação sem lastro, ou expedição em produto sem estoque. |
| **C) NF abertas antigas** (amarelo) | NF-e ainda em conferência (não encerradas) há mais de N dias. | Cada uma dessas significa um saldo que **não está disponível** no relatório de Posição. |
| **E) Cadastros duplicados** (azul) | Mesmo NOME, vários CD_PRODUTO no mesmo dono. | Risco da NF apontar para o cadastro errado. |

**Em cada SKU da auditoria** há um botão **🔍** (lupa) que abre o diagnóstico completo daquele SKU sem fechar a auditoria.

**Como ler o resultado (rotina sugerida):**

1. Olhe primeiro o cartão **D)** — esse é o que normalmente esconde dezenas de NFs encerradas em branco.
2. Para cada NF listada em D, vá em **Recebimento WMS**, abra a NF, **Reabra**, preencha as quantidades / lotes corretos, e **encerre** de novo.
3. Depois passe para **A)** — SKUs sem entrada de NF encerrada. Em cada um, use a lupa para identificar se é caso de `NF_NO_DONO_ERRADO`, `NF_COM_CODIGO_DIFERENTE`, ou inventário antigo sem NF correspondente.
4. **B)** (saldo negativo) sempre exige ação: ou estorno de expedição indevida, ou ajuste por inventário.

> **Quando rodar**: pelo menos 1× por semana. Logo após receber muitas NF-e novas (fim do dia), rodar com filtro de dono ajuda a pegar erros enquanto o operador ainda lembra.

### Diagnóstico de SKU "por que esse produto não tem NF encerrada?"

Quando o relatório de **Posição de Estoque** mostra um SKU com a marca **(só mov.)** ou um saldo que não bate com o que você sabe que recebeu fisicamente, a causa quase sempre está na **conferência da NF-e**. Para investigar sem precisar abrir o pgAdmin:

1. Gere o relatório **Posição de Estoque** ou **Movimentação de itens** filtrado pelo dono.
2. Na linha do SKU em dúvida, clique no ícone de **lupa** (🔍) ao lado do código.
3. Um modal abre dentro do próprio relatório com 4 áreas:
   - **Resumo**: 3 cards com `NF encerrada`, `Movimentos (ledger)`, `Saldo SKU`. Os 3 somam = o que o relatório de Posição mostra.
   - **Ações sugeridas**: cartões amarelos com o motivo provável e o que fazer (ex.: `ENCERRAR_RECEBIMENTO`, `REABRIR_RECONFERIR`, `CADASTRAR_PRODUTO`, `IMPORTAR_NFE`).
   - **NF-e abertas e encerradas**: lista das notas com o número da NF, data de recebimento, status e quantas linhas cada uma tem (JSON / conferência).
   - **Linhas da conferência**: detalhe item-a-item do `CONFERENCIA_JSON` com a coluna **Diagnóstico** marcada em verde (OK) ou vermelho (problema).
   - **Movimentos do ledger**: últimas movimentações no `WMS_MOVIMENTO_ESTOQUE` (inventário, expedição, transferência etc.).

**Causas mais comuns que o diagnóstico identifica:**

| Código | O que significa | Como resolver |
|---|---|---|
| `ABERTA` | Recebimento ainda não foi encerrado | Vá em **Recebimento WMS**, abra a NF, encerre. |
| `SEM_CD_PRODUTO` | Operador conferiu sem mapear o produto no de-para | Reabra o recebimento, escolha o produto certo (autocompletar), encerre. |
| `QTD_ZERO` | Fator de conversão zerou a quantidade convertida | Corrija o fator no **cadastro do produto do dono** ou na conferência; reabra e reconfira. |
| `SEM_DONO` | NF-e foi importada sem CD_DONO no cabeçalho | Edite o cabeçalho da NF para apontar o dono correto; encerre. |
| `SEM_CADASTRO_DONO` | O código existe na NF mas não tem produto cadastrado para o dono | Cadastre em **Cadastros WMS → Produtos do dono** e refaça a conferência. |
| `NENHUMA_NF` | Não há NF-e no dono que mencione esse código | Verifique se o XML foi mesmo importado naquele dono e se o código bate. |
| `NF_NO_DONO_ERRADO` | NF do mesmo tenant **em outro dono** menciona o código | A NF foi importada no dono errado. Edite o cabeçalho da NF para apontar o dono correto, ou use **Transferência entre donos** se já encerrou. |
| `NF_COM_CODIGO_DIFERENTE` | NF no dono atual com o NOME do produto mas **sem o código que você procura** | O XML do fornecedor usa código diferente. Abra a NF, veja o código que veio do XML, crie o de-para em "Cadastros WMS → Produtos do dono". |
| `CADASTRO_DUPLICADO` | Existem 2+ produtos com o mesmo NOME no dono | A NF pode ter sido conferida apontando para o outro CD_PRODUTO. Unifique os cadastros (script de unificação) ou reconfira a NF com o código certo. |

> A página de relatório aberta em popup mantém suas credenciais (mesmo origin) — o botão da lupa chama `/api/wms/diagnostico-sku` direto sem precisar fechar o relatório.

### Transferência entre donos (mover saldo de um cliente para outro)

Use quando o produto foi recebido no **dono errado**, ou quando você precisa **migrar saldo** entre clientes do CD (ex.: "Cliente A perdeu o macarrão, vou passar do estoque do Cliente B"). É **diferente** de adicionar SKU manualmente:

| Cenário | Use |
|---|---|
| Encontrei SKU em campo que não estava na lista do inventário | **Adicionar SKU manualmente** (ajusta a contagem deste inventário) |
| Tenho saldo no dono A e quero mover para o dono B | **Transferência entre donos** (move saldo no estoque, sem inventário) |
| Lote/validade reais diferentes do snapshot | **Dividir linha** dentro do inventário |
| Inventário cancelado errado | **Reativar inventário** (mais abaixo) |

#### Como fazer uma transferência

1. Abra o módulo **Estoque → Inventário**. Na lista, clique no botão grande **Transferência entre donos** (no topo, antes do "Novo inventário").
2. No modal, preencha:
   - **Dono de origem**: quem vai perder saldo (ex.: Mana).
   - **Dono de destino**: quem vai ganhar (ex.: Nutriville).
   - **Código do produto**: comece a digitar o código ou parte do nome. O sistema lista até 25 produtos do **dono de origem** para você escolher.
   - **Lote / Validade**: informativos (ficam registrados no documento, mas o ledger MVP soma no nível do SKU).
   - **Quantidade**: quanto vai mover.
   - **Motivo**: texto livre, ajuda na auditoria.
3. Clique em **Pré-validar**. O sistema mostra um resumo:
   - Saldo atual na origem × quantidade solicitada.
   - Saldo da origem **após** a transferência (já calculado).
   - Se o **destino não tem o SKU cadastrado**, aparece um aviso amarelo dizendo que o sistema vai criar automaticamente um cadastro copiando origem.
4. Se tudo OK, clique em **Confirmar transferência**:
   - Caso o destino precise de cadastro, **uma janela de confirmação aparece** com o cadastro proposto. Diga **OK** para criar e efetivar; **Cancelar** para abortar.
   - Após confirmação, o sistema grava 2 movimentos no `WMS_MOVIMENTO_ESTOQUE` (SAÍDA na origem, ENTRADA no destino) + 1 documento em `WMS_TRANSFERENCIA_DONO`.
   - Um toast verde aparece: `Transferência #N efetivada · Q de Origem → Destino · Saldo origem: X`.

#### Regras de segurança

- **Saldo insuficiente bloqueia** por padrão. Se o supervisor precisa transferir "no negativo" (ex.: ajuste contábil), há flag `permitirNegativar` no payload — hoje só via API. Operação rotineira: garanta saldo suficiente.
- **Dono origem ≠ dono destino** (não dá para "transferir para o mesmo dono" — para correção de cadastro use Editar produto).
- **Auto-cadastro** copia: código, nome, unidade, código de barras, NCM, peso, tipo de armazenagem, controla lote/validade. Origem do cadastro fica marcada como `TRANSFERENCIA` para você identificar depois em "Cadastros WMS".

#### Módulo dedicado de Transferências

Há agora um **módulo próprio** no menu Estoque → **Transferências entre donos** com:

- **Lista paginada** das transferências (filtros: dono envolvido, status efetivada/cancelada, período, limite).
- **Comprovante imprimível (PDF)** por linha: documento A4 com cabeçalho, partes (origem/destino), item transferido, motivo e 4 espaços de assinatura (origem, destino, supervisão, auditoria). Se a transferência está cancelada, sai com marca d'água diagonal vermelha "CANCELADA".
- **Botão Nova transferência** no canto superior direito: mesmo modal de pré-validar/confirmar com auto-cadastro do destino.
- **Botão Cancelar (ícone reverter, vermelho discreto)** por linha: pede motivo do cancelamento e gera **estorno automático** (2 movimentos inversos no ledger: entrada na origem + saída no destino) numa única transação. Se o destino já consumiu o estoque (saldo < qtd), o sistema bloqueia e pede confirmação explícita via checkbox "Permitir saldo negativo no destino".

#### Cancelar uma transferência (estorno automático)

1. Abra **Estoque → Transferências entre donos**.
2. Encontre a transferência (filtros por dono/período ajudam).
3. Clique no ícone **reverter** (vermelho) na coluna **Ações**.
4. O modal mostra o detalhe (#, donos, produto, quantidade). Informe o **motivo do cancelamento** (obrigatório).
5. Se o destino já consumiu o estoque, marque "Permitir saldo negativo no destino" para forçar.
6. **Confirmar cancelamento**: o sistema grava 2 movimentos `TRANSFERENCIA_ESTORNO_ENTRADA` + `TRANSFERENCIA_ESTORNO_SAIDA` e marca o documento como `CANCELADA`. Já vem `DH_CANCELAMENTO`, `SG_USER_CANCEL` e o motivo concatenado no campo `MOTIVO`.

> O estorno é **idempotente**: a chave de idempotência usa o prefixo `EST|TRANSF|` para não colidir com os movimentos originais. Reexecutar não duplica.

#### O que ainda NÃO acontece (limitações conhecidas do MVP)

- **Não há baixa por lote/validade no destino**: o saldo destino ganha a quantidade total no SKU. O lote/validade ficam no documento da transferência, mas o relatório de Posição mostra o saldo agregado.
- **Sem fluxo de aprovação**: qualquer usuário autenticado consegue criar/cancelar. Para a fase seguinte: papel "supervisor WMS" exclusivo para cancelar.

> **Antes de transferir**, confirme no relatório **Posição de estoque** filtrando por cada dono — você vê quanto cada um tem hoje. Depois de confirmar a transferência, gere o mesmo relatório de novo: o saldo já está reduzido na origem e somado no destino.

### Reativar inventário cancelado por engano

Se você (ou outro operador) clicou em **Cancelar** sem querer, o supervisor pode reverter:

1. Abra o detalhe do inventário cancelado.
2. Clique em **Reativar** (botão amarelo, aparece só com status `CANCELADO`).
3. O sistema volta para `EM_CONTAGEM`, mantendo todas as linhas e contagens já registradas.

> A reativação fica registrada no histórico do inventário; use com critério.

---

## 7. Documentação técnica

Processo completo (TI / supervisão): `docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md`  
Roteiro de teste (5 cenários): `docs/WMS_INVENTARIO_ROTEIRO_TESTES.md`

---

## 8. Limpeza para testes (somente TI)

Para zerar movimentos e inventários de **homologação** sem apagar cadastros (produtos, dono, armazém):

```text
backend/scripts/wms_limpar_movimento_operacional_postgres.sql
```

**Não executar em produção** sem autorização. O script também limpa recebimentos, cargas e OPL.

---

*Manual v1.5 — Fase 1 (ajuste de saldo por SKU) + ata imprimível + Fase 3a (cíclico com geração automática) + Fase 3b (status/tolerância, edição inline, dividir lote, reativar, **excluir linha**) + Seção 5.1 "O que contar" (reserva, expedição, divergência grande, múltiplas validades).*
