# Plano conceitual — Estoque de terceiros e crossdocking (Atlas Cargo)

**Status:** rascunho vivo (**v0.8** — código produto hierárquico + RF MVP)  
**Objetivo:** registrar requisitos e decisões de desenho **antes** da implementação; evoluir conforme novas informações (EDI, etiqueta, regras fiscais).

**Escopo declarado:** módulo(s) de **controle de estoque** dentro do Atlas Cargo, **genéricos** — aptos ao caso operacional Grupo Sinai (Mana, Nutriville, cozinhas industriais) e a **outros** cenários de CD (crossdocking e administração de estoque de terceiros).

---

## 1. Visão em duas linhas

1. **Crossdocking:** entrada e saída alinhadas à **mesma nota / mesmo eixo documental**; controle reforçado por **XML de NF**.  
2. **Estoque de terceiros:** entrada por **NF de fornecedor** (XML); saída por **NF do dono do estoque**; exige **saldo por titular**, **de-para de item**, **fator de conversão** e rastreio por **lote/validade** quando aplicável.  
3. **Armazenagem (guarda-moradia):** entrada e saída em momentos distintos, com ocupação de endereço e possivelmente faturamento de serviço de armazém — **mesmo núcleo** de saldo/lote/endereço; regras fiscais e de faturamento **pendentes** por contrato.

---

## 2. Caso de uso âncora (sem amarrar o produto só a ele)

- Operador logístico recebe mercadoria de fornecedores do grupo, **separa** pedidos, **entrega** em cozinhas industriais.  
- Pós-carregamento: acompanhamento pela **logística já existente** no Atlas (viagens, rotas, motorista).

---

## 3. Fluxos macro (ordem operacional)

| Etapa | Entrada de dados | Saídas esperadas | Observações |
|--------|------------------|------------------|-------------|
| **Recebimento** | XML NF fornecedor; conferência manual (espelho) e/ou sistêmica | Movimento de entrada; tratativa de divergência; **lote**, **validade** (se perecível), **código dono**, **fator conversão**; geração de **etiqueta(s) por pallet** | Quantidade padrão por pallet → N etiquetas |
| **Onda de separação** | EDI (.txt) — **modelo pendente** | Espelho de separação + picking sistêmico; **qtd coletada** obrigatória; validade opcional na linha se FEFO/FIFO no saldo | Crítico para NF de saída não “mentir” |
| **Conferência** | Pedido vs separado | Manual + sistêmico; bloqueio ou liberação para próxima etapa | |
| **Programação de entrega** | Pedidos conferidos agregados | Peso, pallets, volumes → **tipo de veículo**; rota com N paradas; **split** em mais de um veículo se limites | Integrar com conceito de rota/viagem Atlas |
| **Saída câmara (resfriado/congelado)** | Pós-confirmação separações / NF | Lista por **rota/veículo**; coleta no último instante; motorista acompanha carga | Lista manual e/ou sistêmica |
| **Expedição / logística** | Carga pronta | Módulo de logística Atlas (existente) | Estoque **alimenta** logística |

### 3.1 Mapa mental: Entrada × Movimentação × Saída (sua lista, consolidada)

| Bloco | Itens acordados |
|--------|-----------------|
| **Entrada** | Portaria (direcionar carga/descarga); **agenda** (janela — pode ser mesmo cadastro/serviço que portaria); recebimento **XML ou manual**; **de-para** produto (terceiros); **cadastro rápido** na importação (fornecedor, produto, de-para); espelho de conferência → **validar conferência** → **etiqueta** para alocação; tipos perecível / não perecível; vínculo **veículo + motorista + ajudante**; **devoluções** (mercadoria que saiu para entrega e **voltou** ao armazém). |
| **Movimentação** | Separação; **validade / vida útil** e **lote** (ver §4.4); **inventário**; demanda (**pedido de separação**); espelho para operador; **coleta via mobile**; ajustes manuais; relatórios (separação, conferência, picking); etiquetas de identificação de entrada (pallet). |
| **Saída** | Portaria + agenda (espelho da entrada); expedição **XML ou manual**; veículo/motorista/ajudante; **formar cargas**; **rotas de entrega**; tratar **CNPJ destino** vs **endereço de entrega** variável no XML (múltiplos pontos para mesmo tomador). |

---

## 4. Regras de negócio já explícitas

### 4.1 Produto / temperatura

- **Perecível** — validade **obrigatória** (subtipos: seco, resfriado, congelado).  
- **Não perecível** — validade **não obrigatória** (ex.: higiene/limpeza, embalagens).  
- **Veículo apto** conforme tipo de produto → provável evolução do **cadastro de equipamento/veículo** no Atlas.

### 4.2 Estoque de terceiros — de-para e conversão

- **Código do dono do estoque** + **fator de conversão** na entrada garantem que na saída o sistema fale a **mesma unidade lógica** que a operação/NF espera.  
- Exemplo acordado: entrada **15.000 kg** (total); operação em **caixas de 15 kg**; saída em **N caixas**.

### 4.3 Política de consumo de saldo

- Menção a **FIFO/FEFO** (texto original: “FIFFO”) — **PENDENTE:** definir regra exata por SKU/categoria e se validade na separação é sempre derivada do lote ou pode ser sobrescrita.

### 4.4 Validade operacional vs “vida útil” de produto (prática de mercado)

- **No cadastro do produto (mestre):** costuma-se guardar **categoria logística** (perecível / não), **temperatura** (seco, refrigerado, congelado), **unidade base de estoque**, opcionalmente **vida útil em dias** (quando o fabricante informa “consumir em X dias após aberto” ou “DVC”) — isso **orienta** relatórios e bloqueios, mas **não substitui** o lote.  
- **No estoque físico (lote / recebimento):** a **data de validade** (e o lote) vêm da **NF / etiqueta do fornecedor**; é isso que o **FEFO/FIFO** consome na baixa.  
- **Conclusão para o Atlas:** separar **atributos mestre do SKU** de **atributos da posição de estoque** (lote + validade + quantidade). O módulo atual **Tipos de validade / Controle de validade** no Atlas refere-se principalmente a **documentos e certificações de cadastros** (motorista, veículo, etc.), **não** a lote de produto alimentício — para WMS será preciso **modelo de produto + lote** (novas tabelas ou extensão clara), evitando misturar os dois conceitos no mesmo lugar.

---

## 5. Entidades conceituais (para futuro modelo de dados)

*(nomes internos sugeridos — revisar na fase de implementação)*

- **Titular do estoque** (dono contratual do saldo) — distinto do operador logístico quando for CD de terceiros.  
- **Depósito / local** (físico ou lógico).  
- **Documento de entrada** (cabeçalho + linhas espelhando NF/XML).  
- **Recebimento** (status: aberto, em conferência, divergência, fechado).  
- **Item de estoque** / **SKU operacional** (ligação fornecedor ↔ de-para dono).  
- **Lote** + **validade** + **quantidade em UOM interna**.  
- **Etiqueta de pallet** (1..N por recebimento de linha).  
- **Pedido / onda de separação** (origem EDI).  
- **Linha de separação** (qtd solicitada, qtd coletada, validade informada opcional).  
- **Conferência** (cabeçalho + linhas).  
- **Programação de entrega** (agregação carga ↔ veículo(s) ↔ rota).  
- **Reserva de estoque** (opcional, entre separação e NF) — **PENDENTE** se haverá reserva formal.  
- **Portaria / agenda** — fila de chegada/saída de veículos na operação (não confundir com “viagem” de longa distância; pode compartilhar **cadastro de motorista/veículo**).  
- **Devolução** — movimento de entrada que referencia expedição/separação original (tipo de nota ou avulso) — **PENDENTE** regra fiscal.  
- **Tomador vs local de entrega** — entidade **ponto de entrega** (CNPJ + endereço) quando o XML repetir tomador com endereços diferentes.

### 5.1 Cadastros mestre (sua hierarquia — alinhada ao desenho)

| Entidade | Papel |
|----------|--------|
| **Empresa (SaaS / operador da plataforma)** | Quem comercializa o Atlas; já existe no modelo multi-tenant. |
| **Cliente (licença / tenant operacional)** | Quem contrata o sistema para operar o CD. |
| **Dono do estoque** | Titular do saldo (administrado pelo cliente); **obrigatório** em terceiros; opcional ou igual ao tenant em cross “simples”. |
| **Fornecedor** | Origem das entradas (pode ser cadastro rápido na importação XML). |
| **Cliente (destino mercadoria)** | Destino comercial / cozinha; pode ter **N endereços** sob mesmo CNPJ. |
| **Área** | Subdivisão lógica do armazém (ex.: seco / frio). |
| **Armazém** | Unidade física ou lógica de estoque. |
| **Doca** | Ponto de recebimento/expedição. |
| **Motorista / Veículo / Ajudante** | Já existem cadastros de pessoas e frota; **ajudante** pode ser papel em **cadastro geral** ou tabela de tripulação — **PENDENTE**. |
| **Produto** | Família / grupo / subgrupo — alinhar a **padrão de mercado** (NCM opcional, UM compra / UM estoque / UM venda, flags perecível). |

---

## 6. Integração com o Atlas Cargo existente

- **Cadastro geral** — clientes, fornecedores, cozinhas como pontos de entrega.  
- **Roteiros / viagens** — programação de entrega e execução.  
- **Equipamentos** — capacidade e **aptidão** (refrigerado, etc.).  
- **Tenant / módulos de produto** — se o estoque for licenciável por cliente.

### 6.1 O que **já existe** no projeto (para acelerar evolução)

| Capacidade | Onde está (referência) | Limitação para WMS |
|------------|-------------------------|---------------------|
| **Multi-tenant / cliente SaaS** | `TENANT_ID`, `saas-admin`, entitlements, scripts em `backend/scripts/` | Só política de dados; não substitui tabelas de estoque. |
| **Menu modular + grupos + permissões** | `TIPOATIVIDADE`, `USUARIOATIVIDADE`, `MODULO_PRODUTO`, `menu.routes.js` | Já existe **grupo canônico `WMS`** reservado no código (`backend/utils/tipo-atividade-grupo.js` — rótulo “WMS”, ordem 35); basta cadastrar **tipos de atividade** com `FGGRUPO`/programa apontando para programas `gerenciar-*` do estoque quando existirem. |
| **Pessoas e papéis** | `CADASTROGERAL` (fornecedor, cliente, motorista, etc.) | Reaproveitar; eventualmente flag “ajudante” ou vínculo tripulação. |
| **Empresa / filial** | Módulos gerenciar-empresas, filiais | Bom para “quem é o operador do CD”; **dono do estoque** é entidade **nova** ou extensão contratual. |
| **Frota** | Marcas, tipos, classes, **equipamentos**, grupos | Estender com **aptidão térmica** (refrigerado/congelado) para casar com tipo de produto. |
| **Logística rodoviária** | Viagens, roteiros, mapa, motorista app | Formação de **carga/rota** no WMS deve **gerar ou alimentar** viagem com **múltiplas entregas** (hoje roteiro já tem múltiplos pontos — validar se cobre “N cozinhas mesma rota” sem gambiarra). |
| **Tipos de validade (cadastro)** | `TIPOVALIDADE`, `CONTROLEVALIDADE`, módulos gerenciar-tipos-validade | Foco em **certificações de pessoas/entidades**, não em **lote alimentar** — ver §4.4. |
| **Grupo (cadastro)** | `GRUPO` na frota | Nome colide com “grupo de produto”; no WMS talvez **família de produto** em tabela dedicada ou namespace claro. |

**Resumo:** a **casca** (tenant, menu, permissões, pessoas, frota, viagem) já ajuda muito. **Não há** hoje, pelo que o repositório expõe: **portaria**, **doca**, **armazém**, **posição de estoque**, **NFe entrada/saída XML**, **inventário WMS**, **picking mobile** — isso será **módulo novo** + DDL.

---

### 6.2 Modelo de permissões e menu (sua lista)

Objetivo: **escopo fino** para navegação e API.

| Nível | Exemplo |
|-------|---------|
| **Módulo de produto** | Ex.: `wms_torre` (nome interno a definir). |
| **Grupo no menu** | Entrada | Movimentação | Saída | Cadastros WMS | Relatórios. |
| **Função (programa)** | `wms-portaria`, `wms-recebimento`, `wms-separacao`, … | Um `DSPROGRAMA` por tela ou API agrupada. |
| **Permissão** | `TIPOATIVIDADE` + `USUARIOATIVIDADE` (padrão Atlas). |
| **Escopo de dados** | Filtro por **dono do estoque**, **armazém**, **doca** (usuário só vê o que opera) — **PENDENTE** desenho (claims ou tabela de vínculo usuário–armazém). |

---

## 7. Pendências (insumos e decisões)

| ID | Item | Responsável |
|----|------|----------------|
| P1 | Modelo de **etiqueta** (layout/campos) | **Campos levantados:** `docs/ANEXO_MODELOS_IMPRESSOS_WMS.md` §4 — pendente só **mm/fonte** se for térmica |
| P2 | Amostra **EDI** (.txt) + dicionário de campos | **Parcial:** `docs/LAYOUT_OPL_TEKNISA_INTEGRACAO_200593.md` (tipos 1 e 2 do PDF 200593) + `docs/LAYOUT_ESPELHO_SEPARACAO_MANA_TXT.md` + `docs/amostras/mana-espelho-separacao-lote10.txt` — falta **tipo 3** completo no repo e retorno **SUP07911** |
| P3 | Confirmar **FIFO vs FEFO** e exceções | Negócio |
| P4 | Multi-titular (Mana vs Nutriville vs …) — um tenant, vários saldos? | Negócio |
| P5 | Integração fiscal (SPED/NFe): só espelho operacional ou emissão assistida? | TI fiscal |
| P6 | Níveis de permissão (recebedor, separador, conferente, expedidor) | Segurança |
| P7 | Modelo de **portaria/agenda** (campos mínimos, integração com balança/cancela?) | Operação |
| P8 | **Devolução** — exige NF de retorno sempre ou permite ajuste interno? | Fiscal |
| P9 | **Índice de conversão** multi-UOM (tabela de fatores por par de UMs vs fator único na linha) | Negócio |

---

## 8. Próximos passos de documentação

1. Incorporar **P1** e **P2** neste arquivo (anexos ou seções).  
2. Derivar **documento de requisitos** (RF) e **mapa de telas/API** (v0.3).  
3. Só então **DDL + APIs** alinhados ao tenant.

### Anexos com insumos reais

- **`docs/RF_WMS_ATLAS_v1.md`** — Requisitos e **matriz MVP** (Sim/Não por bloco) para a reunião de 30 min.  
- **`docs/ANEXO_LAYOUTS_OPL_NFE_AMOSTRAS.md`** — Espelho de separação (linhas 1/2/3), referência ao PDF **200593 / SUP07910 / SUP07911**, mapeamento conceitual de **NF-e entrada** e **saída** (incl. nó `entrega` e `xPed` Teknisa).  
- **`docs/ANEXO_MODELOS_IMPRESSOS_WMS.md`** — PDFs: **romaneio picking** (seco / frio), **carga programada** (consolidado + frio por NF), **espelho de nota** (descarga), **etiqueta de pallet** (campos NF + lote + dono).

---

## 9. Reflexão rápida (redundância)

Grande parte do que você enviou **não é redundante**: reforça **simetria entrada/saída** (portaria, XML, espelho, veículo) e **cadastros** sem os quais o WMS vira fricção — isso foi absorvido acima sem duplicar parágrafos da v0.1.

---

## 10. Paridade com o que já existe no mercado (âncora de produto)

Sistemas **WMS / SCE** consolidados (ex.: TOTVS WMS, Senior, SAP EWM, Manhattan, Blue Yonder) costumam entregar, no mínimo, blocos comparáveis ao nosso escopo:

| Bloco | Mercado | Atlas-WMS (alvo) |
|--------|---------|------------------|
| Portaria / doca | Sim | §3.1 — entrada/saída |
| Recebimento + conferência | Sim | XML/manual, divergência, etiqueta |
| Separação / picking / expedição | Sim | EDI + espelho + mobile |
| Inventário (geral e cíclico) | Sim | §3 (macro); §11 (cíclico) |
| Relatórios / trilha | Sim | RF futuro + BI opcional |
| Crossdocking e armazenagem | Muitas vezes módulos ou “modos” | §1 e §3 |

No **Brasil**, **entrada de NF-e via XML** (leitura do arquivo autorizado / espelho operacional) é **prática comum** em integrações logísticas; o elo com **SEFAZ** (consulta, manifesto, etc.) é **camada fiscal** que pode ser faseada (P5).

**Controle de lote, validade e conversão de unidades** (caixa↔unidade, kg↔caixa) é **padrão** em WMS robustos — já está refletido nos §4 e §5 do plano.

---

## 11. Boas práticas de mercado — adotadas explicitamente neste plano

| Prática | Como o plano Atlas-WMS absorve |
|---------|----------------------------------|
| **Hierarquia de produto** (família → grupo → subgrupo → SKU) | §5.1 produto; relatórios e BI futuros |
| **Validade / vida útil** | §4.4 — mestre (política) vs lote (operacional) + FIFO/FEFO (P3) |
| **Espelho + etiquetas + coleta** | §3; integração futura **código de barras / QR / RFID** (P1) |
| **Inventário cíclico** | Além do geral: por **área**, **produto**, **dono do estoque** — **PENDENTE** regras de amostragem |
| **RBAC** (módulo → grupo → função → permissão) | §6.2 alinhado a `TIPOATIVIDADE` / tenant |

---

## 12. Pesquisa de UX/UI (ferramenta “de ponta” e profissional)

Objetivo: interface **densa mas legível**, padrão **SaaS B2B** (não parecer planilha com botões).

Referências sugeridas para **layout e navegação** (moodboard / critérios, não cópia):

- **Dribbble / Behance** — termos: `WMS dashboard`, `logistics SaaS UI`, `inventory management dashboard`.  
- **Material Design** (Google) / **Fluent** (Microsoft) — padrões de tabela, filtro, densidade, acessibilidade.  
- **Conteúdo setorial** — portais e cases de logística (tendências de armazém, coleta, traceabilidade).

**Diretrizes para o Atlas:** reutilizar **padrão visual dos módulos atuais** (`padrao-ui-modulos` no repositório) para o WMS não “parecer outro sistema” dentro do mesmo produto.

---

## 13. Open source e reutilização — postura técnica **responsável**

### 13.1 O que faz sentido **estudar**, não necessariamente **embutir**

Tabela consolidada (pesquisa focada em **PostgreSQL** + logística; uso no Atlas = **referência de domínio / telas / modelo de dados**, não fork obrigatório).

| Projeto | Stack (típica) | O que oferece (útil para nós) | Pontos de atenção no Atlas |
|---------|----------------|------------------------------|----------------------------|
| **[ERPNext](https://github.com/frappe/erpnext)** | Python (Frappe), PostgreSQL | Estoque, compras, vendas, inventário, relatórios; cadastros fortes (clientes, fornecedores, produtos, veículos) | **NF-e XML**, **portaria**, **cross/terceiros** não são “de fábrica” para o Brasil — seriam **reimplementados** no Node/Atlas. |
| **[Odoo](https://github.com/odoo/odoo)** Community | Python, PostgreSQL | ERP modular; WMS/picking, inventário, relatórios, **RBAC** | Fiscal Brasil = **módulos/loca** extras; stack Python, não acoplável como microserviço sem decisão explícita. |
| **[OCA/wms](https://github.com/OCA/wms)** | Odoo / Python | Padrões de **stock logistics** na vertical Odoo | Mesma ressalva fiscal/stack. |
| **[OpenBoxes](https://github.com/openboxes/openboxes)** | Java, PostgreSQL | Supply chain / armazém; estoque, movimentação, inventário, relatórios | UI mais simples; **Java** vs stack Atlas — útil para **fluxos** e **modelo relacional**, não copy-paste de código. |
| **[OpenWMS](https://openwms.org/)** / projetos satélite | Java, Spring, PostgreSQL | WMS **modular** (Europa); armazenagem, movimentação, inventário | Comunidade menor; documentação técnica densa; integração Brasil **por fora**. |
| **[infiniteoo/wms](https://github.com/infiniteoo/wms)** (“Great Blue”, MIT) | Next.js, React, PostgreSQL, Supabase | Inbound/outbound, doca, mobile, etiquetas, dashboards | Stack **Node front** mas **Supabase/Clerk** — ainda **não** é o padrão Atlas backend. |
| **[ModernWMS](https://github.com/fjykTec/ModernWMS)** | (ver repositório) | UI / fluxos WMS open source | Conferir **licença** e stack antes de qualquer reuso. |
| **Snipe-IT** | PHP, PostgreSQL | **Gestão de ativos**, permissões, etiquetas | **Não é WMS** de lotes/endereço; só **inspiração** para cadastro rigoroso / patrimônio — não confundir com picking alimentar. |

**Priorização sugerida (para estudo, não para substituir o Atlas):**

1. **ERPNext ou Odoo** — melhor **densidade** de cadastro + inventário + permissões para “mirar” regras de negócio.  
2. **OpenBoxes** — mais **enxuto** se a referência desejada for só **logística de armazém** sem ERP completo.  
3. **OpenWMS** — se a prioridade for **arquitetura modular** (conceitos de serviço/mensagem), com custo de curva de aprendizado.  
4. **infiniteoo/wms** — referência **moderna** de UX/fluxo; comunidade pequena.

**Como encaixa no Atlas (fixação):** tudo acima entra como **benchmark + ideias de modelo**; o produto continua **PostgreSQL + Express + módulos web Atlas** (§13.3). Integração **NF-e XML**, **portaria** e **cross/terceiros** são **diferenciais nacionais** a construir **no nosso código**, não dependência de um ERP Python paralelo.

### 13.2 “WarehousePG” / MPP

O nome costuma remeter a **data warehouse** ou **analytics em PostgreSQL** (grandes volumes, agregações), **não** a portaria/expedição em tempo real. Para o Atlas, separar: **OLTP** (WMS transacional no mesmo PG do Atlas) vs **camada analítica** (relatórios, painéis, particionamento) — eventual **BI** sem confundir com o núcleo operacional.

### 13.3 Decisão de arquitetura (recomendação)

- **Evoluir o Atlas** com **DDL + APIs + módulos** no padrão já usado (tenant, `TIPOATIVIDADE`, pastas `public/modulos/...`).  
- Usar open source como **referência de domínio e UX**, e bibliotecas **pontuais** (ex.: parser XML NF-e, geração de código de barras) onde fizer sentido **licença e stack**.  
- Evitar **acoplar** um segundo monólito (Supabase/Next) dentro do mesmo deploy sem um **motivo estratégico forte**.

---

## 14. Melhorias sugeridas (processo + produto)

| # | Sugestão | Motivo |
|---|-----------|--------|
| 1 | **Congelar “dicionário posicional”** do TXT OPL (larguras exatas linhas 1/2/3) numa tabela versionada (`layout_opl_v1`) | Evita parser frágil; PDF Teknisa é fonte da verdade. |
| 2 | **Serviço único de identidade de produto** (comparar, buscar, de-para) | Nos artefatos aparecem **código com pontos** (máscara do cliente: **família.grupo.subgrupo.gênero…** — cada trecho tem **significado**), **só dígitos** (ex.: NF/XML) e **hífen** (outro fornecedor). O sistema deve **preservar a semântica** da máscara e definir **forma canônica interna** + regras de equivalência (ex.: normalizar só para *match*, não apagar níveis). |
| 3 | **Dois templates de espelho de nota** (modelo TIROL vs BIOMEDICA) como metadado por fornecedor | Reduz customização “no código” por cliente. |
| 4 | **Separar “romaneio impresso” de “dados para coletor”** | O mesmo picking alimenta PDF (human) + JSON (mobile); um só motor de regras. |
| 5 | **Feature flags por tenant** (ex.: portaria, câmara fria, FEFO obrigatório) | Sinai liga tudo; outro CD liga só cross. |
| 6 | **Fixtures NF-e anonimizados** em `backend/tests/fixtures/nfe/` | Regressão de parser sem vazar dados reais. |
| 7 | **Checklist go-live** (impressora etiqueta mm, leitor 1D/2D, homologação SEFAZ se for além do XML arquivo) | Reduz surpresa em produção. |

---

## 15. Como seguir (ordem recomendada)

### Fase A — Fechar especificação (1–2 semanas, conforme disponibilidade)

1. Extrair do PDF **200593** a **tabela de colunas e larguras** das linhas 2 e 3 → encerrar **P2**.  
2. Definir **mm / impressora** da etiqueta → encerrar **P1**.  
3. Decidir **P3** (FIFO/FEFO), **P4** (multi-titular), **P8** (devolução fiscal) em reunião curta de negócio.

### Fase B — Documento de requisitos e arquitetura

4. Manter **`docs/RF_WMS_ATLAS_v1.md`** (requisitos + matriz MVP Sim/Não) alinhado à reunião de fechamento de escopo.  
5. **ERD** (diagrama): `dono_estoque`, `armazem`, `area`, `doca`, `nf_entrada`, `nf_saida`, `recebimento`, `movimento`, `saldo_lote`, `pedido_separacao`, `carga`, vínculo com `VIAGEM` / `ROTEIRO`.

### Fase C — Implementação incremental (sugestão de MVP)

6. **MVP-1:** importar XML NF-e entrada + espelho conferência + **de-para** na linha + gravar **lote/validade** + **imprimir etiqueta** (campos já mapeados no anexo).  
7. **MVP-2:** importar TXT OPL → **pedido de separação** + romaneio PDF (modelos já documentados).  
8. **MVP-3:** baixa de estoque por separação (qtd coletada) + leitura XML saída para **conferência** com NF.  
9. **MVP-4:** **carga programada** + agregação peso/volume + encaixe com **viagem** Atlas (já existente).  
10. **Depois:** portaria/agenda, inventário cíclico, mobile offline, integração SEFAZ se necessário.

### Fase D — Governança

11. Novo **`MODULO_PRODUTO`** (ex.: `wms_torre`) + tipos de atividade no grupo **WMS** (`tipo-atividade-grupo.js` já prevê o rótulo).  
12. **Spike** de 2–3 dias: biblioteca NF-e Node (parse + validação XSD opcional) em cima de **1 XML de cada tipo** que você já tem.

---

## 15. Pendências — UI “Crossdocking em lote” (pós foco recebimento / estoque de terceiros)

- **Painel desligado na tela** por enquanto; reativar quando o fluxo crossdock for prioridade (`WMS_REC_CROSSDOCK_UI_ENABLED` no `estoque-recebimento/js/script.js` + exibir `#painelCrossdock`).
- **Transporte na doca:** capturar **placa**, **motorista** (e eventual **ajudante**) no recebimento ou no vínculo ao lote — modelo de dados e obrigatoriedade a definir.
- **Anexar NF ao lote:** aceitar **chave 44 dígitos** (com ou sem prefixo `NFe`) além de `CD_NFE` — já previsto na API `PUT .../vincular-nfes`.
- **Visual:** `select` de lote/fase no mesmo padrão dos demais controles da aba Dados (revisar após reabilitar o painel).
- **Campo “previsão operacional”:** rótulo alinhado a recebimento + planejamento de saída no crossdock (evitar só “expedição” sem contexto).

*Última atualização: v0.8 — §14 item 2 (máscara hierárquica); RF_WMS_ATLAS_v1.md; v0.7 mantido.*
