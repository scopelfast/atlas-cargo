# Backlog WMS — Consulta de disponibilidade / reservas por produto

**Status:** planejado (não implementado)  
**Prioridade sugerida:** após fechar o ciclo piloto **recebimento → OPL → carga → NF saída → expedição**  
**Registrado em:** maio/2026 (piloto Nutriville)

---

## Problema

Hoje a informação de **quanto está reservado e para qual pedido/espelho** está fragmentada:

| Onde | O que mostra | Lacuna |
|------|----------------|--------|
| Separação → detalhe do espelho | Reserva daquele espelho (`CD_PRODUTO` + qtd) | Sem destino legível; sem visão de outros espelhos |
| Relatório → Posição de estoque | Reserva SKU **total** por produto | Sem “para onde”; `QTD_DISPONIVEL_SKU` existe na API mas não está no PDF/HTML padrão |
| Simulação OPL | Reserva de **outros** espelhos (agregado) | Sem drill-down |

Operador precisa abrir cada espelho para entender se ainda pode prometer quantidade em um SKU.

---

## Objetivo (produto)

Tela ou relatório **“Disponibilidade por produto”** (menu **5.0 Painel Estoque** ou **5.9 Relatórios**), filtros: **dono** + **código** (com ou sem máscara).

### Bloco 1 — Resumo SKU

- Entrada (NF-e encerrada, por SKU)
- Saída (`WMS_MOVIMENTO_ESTOQUE`, ex. expedição)
- Reserva OPL (soma `WMS_RESERVA_ESTOQUE_OPL`)
- **Disponível** = saldo SKU − reserva (mesma regra da posição)

### Bloco 2 — Detalhe “comprometido para”

| Coluna | Fonte |
|--------|--------|
| Espelho / arquivo | `WMS_RESERVA_ESTOQUE_OPL` → `WMS_OPL_ARQUIVO` |
| Pedido | `WMS_OPL_PEDIDO.NUM_PEDIDO` |
| Destino | razão social / código destinatário do pedido OPL |
| Qtd reservada | `QTD_RESERVADA` |
| Situação picking | espelho concluído / pendente |

### Evoluções (Fase 2+)

- NF-e recebimento **aberta** (pipeline), opcional
- Vínculo com **carga programada** / expedição em andamento
- Export CSV

---

## API sugerida (esboço)

`GET /api/wms/estoque/disponibilidade-produto?cdDono=&codigo=`

Resposta: `{ resumo, comprometidos: [] }` usando `resolverProdutoEstoque` + agregações já usadas em `wms-opl-cobertura-estoque` e `wms-relatorio-posicao-estoque`.

---

## Referências técnicas

- `WMS_RESERVA_ESTOQUE_OPL`
- `wms-opl-reserva-picking.service.js` — `listarReservasPorOplArquivo`
- `wms-relatorio-posicao-estoque.service.js` — `QTD_DISPONIVEL_SKU`
- Conversa piloto: após separação encerrada do espelho `espelho-separacao-piloto-nf13243-minimo.txt`

---

*Não bloqueia o piloto atual; implementar quando o fluxo carga/expedição estiver estável em homologação.*
