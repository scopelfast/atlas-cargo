# Piloto Nutriville — Carga, NF-e de saída e expedição

**Pré-requisitos já concluídos no piloto:**

- Recebimento NF **entrada** 13243 encerrada (4 SKUs, validade)
- Posição de estoque coerente
- Separação OPL **espelho mínimo** (`espelho-separacao-piloto-nf13243-minimo.txt`) — picking **4/4 encerrado**, reserva gravada
- De-para OPL em massa (`backend/scripts/wms_gerar_depara_opl_catalogo_postgres.sql`) — recomendado antes do espelho grande

**Este roteiro:** fecha o ciclo com **NF-e de saída (XML)** → **carga programada** → **validação** → **expedição** → conferir **saída no estoque**.

---

## Visão do fluxo

```text
[Entrada NF 13243]  →  saldo físico
        ↓
[OPL mínimo encerrado]  →  WMS_RESERVA_ESTOQUE_OPL (compromete o saldo)
        ↓
[NF saída XML]  →  WMS_NFE_SAIDA  (emitente = Nutriville)
        ↓
[Carga programada]  →  vincula NF(s), dono 2, validação pedido×produto×qtd
        ↓
[Expedição confirmar saída]  →  libera reserva OPL + WMS_MOVIMENTO_ESTOQUE (saída)
```

---

## Parte 1 — XML de saída (homologação)

### Arquivo de exemplo (repositório)

`docs/amostras/nfe-saida-piloto-nf13243-minimo.xml`

| Campo | Valor no exemplo |
|--------|------------------|
| **Emitente** | `08.742.760/0048-40` — dono WMS / quem expede (filial) |
| **Dest / entrega** | `08.742.760/0001-86` — **cadastro 11** + ponto **6013 HPMP** (ver `docs/WMS_NFE_SAIDA_CNPJ_EMITENTE_VS_ENTREGA.md`) |
| **Entrega** (`<entrega>`) | Nome, PREFEITO OMAR SABBAG 894, Curitiba/PR, CEP 80210000 — igual ao cadastro de endereços |
| Pedido (`xPed` em cada item) | `0069001200` — **igual** ao `NUM_PEDIDO` do espelho mínimo |
| Produtos (`cProd`) | Mesmos 4 SKUs (com ou sem máscara; validação normaliza dígitos) |
| Quantidades | 30, 30, 50, 50 (≤ saldo reservado) |

### Importar no Atlas

1. **WMS → Cargas programadas** → aba de **NF-e de saída** / importar XML.
2. Dono: **2 — Nutriville** (ou deixe em branco se o CNPJ do emitente bater com o cadastro do dono).
3. Envie `nfe-saida-piloto-nf13243-minimo.xml`.
4. Confira na lista: NF importada, emitente Nutriville, itens com pedido `0069001200`.

**Diferença da NF de entrada:** na **entrada**, Nutriville era **destinatário**; na **saída**, Nutriville é **emitente**.

**NF 9001 já importada com “RUA TESTE”:** execute `backend/scripts/wms_piloto_atualizar_nfe9001_endereco_entrega_postgres.sql` no pgAdmin **ou** remova a NF da carga e reimporte o XML atualizado. Depois: **Montar paradas** → status `[OK]` (coordenadas do cadastro).

**Match de rota:** CNPJ da NF = CNPJ do cadastro PJ; nome do ponto = `DS_PONTO_ENTREGA`; logradouro/número/CEP iguais ao cadastro (ver `docs/WMS_BACKLOG_PROGRAMACAO_ENTREGAS_CAPACIDADE.md` § endereços).

---

## Parte 2 — Carga programada

1. **Nova carga programada**
   - Dono estoque: **2 — Nutriville** (obrigatório para expedição/reserva).
   - Preencha data/rota conforme a tela (piloto pode ser mínimo).

2. **Vincular a NF de saída** importada (disponíveis → adicionar à carga).

3. **Validar carga**
   - O sistema cruza NF × separação OPL pelo **número do pedido** (`xPed` na NF = `NUM_PEDIDO` no espelho).
   - Espelho mínimo usa pedido `0069001200` — a NF de exemplo já vem com esse `xPed`.
   - Objetivo piloto: **sem divergências bloqueantes** (OK).
   - Se aparecer `PEDIDO_NAO_ENCONTRADO` ou `FALTA_PARA_ATENDER_NF`: confira pedido/código/qtd entre NF e OPL.

4. (Opcional) Rota / romaneio — não bloqueia o MVP de estoque.

---

## Parte 3 — Expedição

1. **WMS → Expedição** → selecione a carga.
2. **Iniciar** expedição (se a tela exigir).
3. **Confirmar saída** — informe motorista, placa, conferente (campos da tela).
4. Efeito esperado no banco (mesma transação):
   - `ST_EXPEDICAO` = expedida
   - **Remove** reservas `WMS_RESERVA_ESTOQUE_OPL` do espelho ligado aos pedidos da carga
   - **Insere** `WMS_MOVIMENTO_ESTOQUE` (QTD negativa, tipo expedição)

---

## Parte 4 — Conferir

| Onde | O que ver |
|------|-----------|
| **Posição de estoque** | **Saída SKU** > 0; **Saldo SKU** menor; reserva tende a **0** nos 4 produtos |
| **Demonstrativo (DRE)** | Linha de **saída** na data da expedição |
| **Separação** | Espelho mínimo continua “encerrado”; reserva não aparece mais no detalhe |

---

## O que ainda fica para depois (piloto amplo)

| Item | Doc / ação |
|------|------------|
| Consulta “quem reservou / para onde” por SKU | `docs/WMS_BACKLOG_CONSULTA_DISPONIBILIDADE_PRODUTO.md` |
| Espelho real `nutri 20.05` (24 itens) | Exige estoque + de-para em massa; não é passo deste mini-ciclo |
| Inventário geral | `docs/WMS_INVENTARIO_MANUAL_OPERADOR.md` |
| NF-e reais da SEFAZ | Substituir o XML de exemplo quando for produção |

---

## Ordem sugerida agora

1. Importar `nfe-saida-piloto-nf13243-minimo.xml`  
2. Criar carga + vincular NF + validar (OK)  
3. Expedir  
4. Posição + DRE  

Tempo estimado piloto: **30–45 min** na UI.

---

*Alinhado a `docs/WMS_PLANO_TESTES_E2E_QA.md` §§ 3–4 e `docs/WMS_PILOTO_ESPELHO_OPL_MINIMO.md`.*
