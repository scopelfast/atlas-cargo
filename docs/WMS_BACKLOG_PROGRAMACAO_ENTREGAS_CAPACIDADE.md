# Backlog WMS — Programação de entregas (peso, volume, conservação, veículo)

**Status:** Fase 1 em implementação (resumo na tela de Cargas); fases 2–4 planejadas  
**Contexto:** operação real monta **rotas a partir das NF-e** (como planilha “Valores”: `DS_CARGA`, destinos por município, QT, valor NF, **Peso Produto**); se não cabe no veículo, **desmembra a rota** em mais de um caminhão. **Seco / refrigerado / congelado** entram na decisão e vêm das **notas + cadastro**.

---

## Processo alvo (como hoje na operação)

```text
NF-e de saída (por dono / emitente)
        ↓
Agrupar em “rota” (= carga programada / DS_CARGA)
        ↓
Resumo por destino (cidade, cliente, QT NF, peso)
        ↓
+ quebra seco × frio (das linhas da NF + cadastro)
        ↓
Escolher tipo de veículo (capacidade kg / m³ / temperatura)
        ↓
Se exceder → dividir rota (nova carga ou segunda viagem)
        ↓
Separação OPL → Expedição (placa real)
```

No Atlas, **carga programada** = unidade de “rota” para estoque e expedição; **viagem** (Torre) pode ser gerada depois com OSRM.

---

## O que já existe no sistema

| Recurso | Uso na programação |
|---------|-------------------|
| NF-e de saída importadas | Itens, `xPed`, NCM, endereço destino/entrega |
| Cadastro `WMS_PRODUTO_DONO.PESO_KG` | Peso estimado (× qtd NF); catálogo OL `VRPESOUNID` |
| Romaneio impresso ¹ / ² | Totais kg, seco/frio, cidades — **após** montar carga |
| `GET …/resumo-logistico` (Fase 1) | Mesmos totais **na tela** + por destino |
| Paradas / OSRM | Endereço da NF → match `CADASTRO_ENDERECO_ENTREGA` → coordenadas |
| Classificação conservação | NCM + `TIPO_ARMAZENAGEM` + descrição (romaneio) |

**Lacuna principal (antes da Fase 1 na UI):** programador dependia de **imprimir** para ver peso agregado estilo planilha.

---

## Fase 1 — Painel na carga (implementado)

- Tela: **Cargas programadas** → detalhe da carga → bloco **“Programação — peso e volumes (NF-e)”**
- Recarrega ao abrir o detalhe (e após vincular/remover NF, via reabertura do detalhe)

## Fase 1 — API (referência)

- API `GET /api/wms/cargas/programadas/:cdCarga/resumo-logistico`
- Card no detalhe da carga: peso total, unidades (soma qCom), seco/frio, % SKUs com peso, tabela por destino (município + nome entrega)
- Legenda: **“vol.” na impressão = unidades da NF**, não paletes nem m³

---

## Fase 2 — Cubagem (m³)

- Campo `CUBAGEM_M3` (ou dimensões) no produto; import OL se houver coluna
- Total m³ na carga + romaneio (modelo PDF já prevê M³ + kg)

---

## Fase 3 — Tipo de veículo e capacidade

- Cadastro: VUC, truck seco, bi-temp (kg máx, m³ máx, frio S/N)
- Semáforo na carga: verde / amarelo / vermelho vs totais
- Sugestão textual: “dividir carga” quando exceder

---

## Fase 4 — Viagem física multi-carga

- Entidade **Viagem** (1 placa) → N cargas (N donos) com totais consolidados para contratação
- Estoque/expedição permanece **por carga e por dono** (ver `docs/WMS_BACKLOG_CONSULTA_DISPONIBILIDADE_PRODUTO.md` e conversa multi-dono)

---

## Endereços de entrega e coordenadas (paradas OSRM)

**Fonte dos dados (sempre a NF-e vinculada à carga):**

| Campo NF (`WMS_NFE_SAIDA`) | Uso |
|----------------------------|-----|
| `CNPJ_ENTREGA` ou `CNPJ_DEST` | Match cadastro PJ |
| `XNOME_ENTREGA` / `XNOME_DEST` | Nome da parada (ex. HC UFPR) |
| `XLGR_DEST`, `NRO_DEST`, `CEP_DEST`, `XMUN_DEST`, `UF_DEST` | Endereço textual |

**Match para coordenadas:** `backend/services/cadastro-endereco-entrega-match.service.js` — tabela `CADASTRO_ENDERECO_ENTREGA` + `CADASTROGERAL` (mesmo CNPJ, 14 dígitos), por:

1. `CHAVE_IMPORT` (CNPJ + ponto + logradouro + número + CEP), ou  
2. UF + CEP + logradouro + número normalizado, ou  
3. CNPJ + nome do ponto (`DS_PONTO_ENTREGA` = `XNOME_ENTREGA` da NF)

**Correção maio/2026:** join não exige mais `CADASTROGERAL.TENANT_ID = endereço.TENANT_ID` (evitava achar o ponto). Diagnóstico SQL: `backend/scripts/wms_piloto_diagnostico_match_endereco_6013_postgres.sql`.

**Status `PENDENTE`:** endereço na NF existe, mas **não há** registro único no cadastro **com latitude/longitude** (piloto: CNPJ `00000000000191`, Curitiba, Rua Teste 1).

**Próximo passo operacional:** cadastrar ponto de entrega com coordenadas; **Montar paradas** → `OK` → **Calcular rota OSRM**.

---

## Referências

- `docs/ANEXO_MODELOS_IMPRESSOS_WMS.md` §2 (romaneio carga: kg, m³, rota)
- `backend/services/wms-carga-resumo-logistico.service.js`
- `backend/services/wms-nfe-saida-destino-display.service.js`

---

*Atualizado: maio/2026 — alinhado à planilha “Valores” e piloto NF 9001 / carga 1.*
