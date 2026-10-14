# WMS — Plano de testes E2E, demonstração e matriz de evidências

**Objetivo:** exercitar ponta a ponta o que está **implementado** no MVP (políticas dono, recebimento, OPL, carga, expedição, reserva, movimento, relatório vencimento, hub dashboard) e registrar **lacunas** para evolução (valorização, ABC, widgets densos).

**Posso “rodar tudo” daqui?**  
- **Sim (automatizável / já rodado):** script somente leitura `backend/scripts/wms-qa-snapshot-readonly.js` contra o PostgreSQL configurado em `backend/.env` (contagens por tabela WMS).  
- **Parcial:** chamadas HTTP com `curl`/Postman **exigem** token/sessão do seu auth (`getSgUser`, tenant).  
- **Não substituível remotamente:** cliques nas UIs (`estoque-recebimento`, `estoque-separacao`, `estoque-cargas`, `estoque-expedicao`), conferência visual de faróis e anexos de e-mail.

**Snapshot atual do ambiente ligado ao Cursor** (exemplo; os números mudam no seu banco):

| Tabela | Observação típica |
|--------|-------------------|
| `WMS_DONO_ESTOQUE` | ≥ 1 dono para testes |
| `WMS_PRODUTO_DONO` | Catálogo para conferência / de-para |
| `WMS_DEPARA_PRODUTO` | **Obrigatório** para simulação OPL + reserva mapeada |
| `WMS_NFE_ENTRADA` / `WMS_NFE_SAIDA` | Zerados após `wms_limpar` — normal antes de um ciclo de teste |
| `WMS_MOVIMENTO_ESTOQUE` | Só após DDL + expedição confirmada |

---

## 0. Pré-requisitos

1. **DDL:** scripts já aplicados (`wms_*`, `adicionar_wms_*`, `adicionar_wms_movimento_estoque_postgres.sql`, reserva OPL, etc.).  
2. **Usuário:** permissões aos programas de menu: recebimento, separação, cargas, expedição, **inventário** (`estoque-inventario`), cadastros WMS; para liberações: `wms-recebimento-liberar-validade-min`, `wms-expedicao-liberar-divergencia` quando aplicável.  
3. **Artefatos de teste:** XMLs NF-e **entrada** (recebimento) e **saída** (carga) válidos; arquivo **OPL** (txt) de separação; CNPJ destinatário alinhado ao dono (ou `CD_DONO` explícito na importação).  
4. **Reset controlado:** `backend/scripts/wms_limpar_movimento_operacional_postgres.sql` entre ciclos (não apaga dono/produto).

**Comando rápido de saúde (read-only):**

```bash
cd backend && node scripts/wms-qa-snapshot-readonly.js
```

---

## 1. Recebimento de mercadoria — fluxo e variações

| # | Cenário | Passos (API / UI) | Resultado esperado |
|---|---------|-------------------|---------------------|
| 1.1 | Importação OK | `POST /api/wms/recebimento/importar-xml` (campo `arquivo`, body `CD_DONO` se necessário) ou UI “Importar” | NF em `WMS_NFE_ENTRADA`, listagem em documentos |
| 1.2 | Conferência sem validade / mínima OK | `PUT …/documentos/:cdNfe/conferencia` com `CONFERENCIA_JSON` coerente (incl. `cdProduto`, `qtdConvertida`) | `FG_CONFERIDO`, bloqueios coerentes com política |
| 1.3 | Validade abaixo do mínimo **sem** override | datas inválidas vs `NU_DIAS_MIN_VALID_RECEB` | **422** / bloqueio; mensagem clara |
| 1.4 | Liberação supervisor | payload com `ignorarPoliticaValidadeMin` + justificativa + `autorizadoLogin`/`autorizadoSenha` + programa liberar | Gravação em `WMS_RECEBIMENTO_LIBERACAO_VALIDADE` |
| 1.5 | Encerrar recebimento | `PUT …/encerrar` | `ST_RECEBIMENTO = ENCERRADA`; saldo agregado da simulação OPL passa a considerar esta NF |
| 1.6 | Reabrir | `PUT …/reabrir` | Status reaberto; usar com parcimônia em produção |
| 1.7 | Listagem farol | `GET …/documentos?statusFarol=verde|amarelo|vermelho` | Filtros coerentes com estado |

**Simular “todas as possibilidades”:** combine 1.3×donos com políticas diferentes, NF com/sem itens perecíveis, de-para criado **antes** do OPL (ver §2).

---

## 2. Separação (OPL) — importação até reserva

| # | Cenário | Passos | Resultado esperado |
|---|---------|--------|---------------------|
| 2.1 | Importação OPL | `POST /api/wms/separacao/opl/importar` (txt + `CD_DONO`) | `WMS_OPL_ARQUIVO` + pedidos/itens |
| 2.2 | Simulação conservadora | `GET …/opl/importacoes/:cd` | `simulacaoEstoque`, avisos; sem de-para → linhas sem mapeamento |
| 2.3 | Pipeline (receb. abertos) | mesmo GET com `?incluirRecebimentosAbertos=1` | `saldoRecebimentosAbertos` / `saldoEstimadoUsado` quando NF não encerrada tem conferência |
| 2.4 | Picking parcial | `PUT …/picking` com subset de `QT_COLETADA` | Save OK; picking não “concluído” |
| 2.5 | Picking completo + reserva | último item coletado; todos com `QT_COLETADA` | `WMS_RESERVA_ESTOQUE_OPL` preenchida ou aviso sem de-para; **409** `RESERVA_CONFLITO` se saldo insuficiente |
| 2.6 | Conflito reserva | dois espelhos disputando mesmo SKU | Segundo save bloqueado com mensagem de negócio |

**Dependência crítica:** `WMS_DEPARA_PRODUTO` + códigos externos alinhados aos `COD_PRODUTO_OL` do OPL; sem isso o MVP de reserva/simulação **não** exercita o núcleo financeiro-operacional.

---

## 3. Programação de embarque (carga + NF saída)

| # | Cenário | Passos | Resultado esperado |
|---|---------|--------|---------------------|
| 3.1 | Importar NF saída | `POST /api/wms/cargas/nfes-saida/importar-xml` | `WMS_NFE_SAIDA` |
| 3.2 | Criar carga | `POST /api/wms/cargas/programadas` | `WMS_CARGA_PROGRAMADA` |
| 3.3 | Vincular NF à carga | `POST …/programadas/:cdCarga/nfes` | Junção em `WMS_CARGA_PROGRAMADA_NFE` |
| 3.4 | Validação carga × pedido/NF | `GET/POST …/validacao` | Divergências listadas; bloqueio expedição até override quando regra de produto |
| 3.5 | Importar separação na carga (se usado) | `POST …/separacao/importar` | Itens em `WMS_SEPARACAO_PEDIDO_ITEM` |
| 3.6 | Rota operacional (opcional) | planejar + calcular OSRM | Persistência rota; viagem rascunho se usado |

Variações: carga sem NF (erro esperado em fluxos dependentes); múltiplas NF; mesclar cargas (`mesclar`).

---

## 4. Expedição

| # | Cenário | Passos | Resultado esperado |
|---|---------|--------|---------------------|
| 4.1 | Iniciar | `POST /api/wms/expedicao/cargas/:cdCarga/iniciar` | `WMS_EXPEDICAO_CARGA` em andamento |
| 4.2 | Confirmar saída | `POST …/confirmar-saida` (motorista, placa, conferente) | `ST_EXPEDICAO=EXPEDIDA`; **mesma transação:** libera `WMS_RESERVA_ESTOQUE_OPL` (se espelho resolvível) + `INSERT` em `WMS_MOVIMENTO_ESTOQUE` (idempotente) |
| 4.3 | Idempotência | repetir confirmação | API rejeita saída já confirmada (não duplicar movimento) |
| 4.4 | Carga sem dono | `CD_DONO` nulo na carga | Movimento pode `skip sem_dono`; documentar expectativa |

---

## 5. Evidências pedidas (a–g) — **o que o MVP entrega hoje**

| Item | Estado no produto | Como evidenciar agora | Lacuna / Fase 2 |
|------|-------------------|------------------------|-----------------|
| **(a) Saldo estoque (qtd, valor)** | **Quantidade:** inferida por `CONFERENCIA_JSON` (encerradas) + `WMS_MOVIMENTO_ESTOQUE` (API interna da simulação/reserva). **Valor:** não há motor de custo médio / preço de estoque ligado ao WMS neste MVP. | SQL agregando `CONFERENCIA_JSON` por `cdProduto`; após expedição, somar `WMS_MOVIMENTO_ESTOQUE`. | Curva de valor, CMV, **integração fiscal-contábil**. |
| **(b) Vencendo / a vencer** | Relatório MVP em cima de **conferência** + `NU_DIAS_REL_VENCIMENTO`; job + CSV + histórico envios. | `GET /api/wms/recebimento/relatorio-vencimento`; CSV `?formato=csv`; UI Recebimento. | Saldo **por lote** e consumo FEFO (doc §4 item 1). |
| **(c) Pontos críticos** | Divergência carga; reserva conflito; política validade; pipeline “otimista”. | Forçar cada código de erro documentado; checklist de logs no servidor. | Matriz única “painel de riscos” ainda não é módulo dedicado. |
| **(d) Alertas importantes** | Farol recebimento; flags simulação OPL; e-mail job vencimento (se SMTP). | Filtros `statusFarol`; resposta `simulacaoEstoque`; `.env` SMTP. | Alertas push unificados, SLA por tenant. |
| **(e) Relatórios para o cliente** | CSV vencimento; romaneios HTML onde existir (carga/OPL); logs envio. | Download + anexo e-mail; guardar CSVs de homologação. | Pacote “executivo” PDF, branding, agendamento por cliente. |
| **(f) Dashboard inteligente** | **Hub** Estoque na home com atalhos por permissão (`DASHBOARD_MODULE_HUB_DEFS`). | Login com vários perfis; validar cards visíveis. | Widgets KPI, gráficos, drill-down — **não** no MVP. |
| **(g) Curva ABC** | **Não implementada** no backend WMS analisado. | N/A | BI externo (Metabase, Power BI) sobre NF/movimento futuro **ou** API dedicada Fase 2. |

---

## 6. Roteiro de demonstração de 25 minutos (para cliente)

1. **Cadastros (3 min):** dono com políticas; 2–3 produtos; **de-para** explícito para um código OL de teste.  
2. **Recebimento (8 min):** importar NF entrada → conferir com validade → encerrar → mostrar relatório vencimento na UI.  
3. **OPL (7 min):** importar picking → simulação sem e com pipeline → concluir picking e mostrar que reserva aparece (`WMS_RESERVA_ESTOQUE_OPL` via script snapshot).  
4. **Carga + expedição (7 min):** NF saída → carga → validação → iniciar expedição → confirmar saída → snapshot mostra `MOVIMENTO` e reserva zerada no espelho.

---

## 7. Próximo passo para “ferramenta de ponta” (produto)

Ordem sugerida de investimento **após** este plano de QA passar:

1. **Custo / valor** no `WMS_PRODUTO_DONO` ou tabela de preço + visão consolidada (somente leitura primeiro).  
2. **Saldo por lote** + movimentos com `CD_LOTE` / `DT_VALIDADE` → destrava FEFO e vencimento “real”.  
3. **API de posição de estoque** única para dashboard + export cliente.  
4. **ABC** (volume ou valor) como materialized view ou job noturno.  
5. **Widgets** no `dashboard.js` consumindo a API de posição.

---

## 7b. Inventário (Fase 1)

Roteiro dedicado (5 cenários): **`docs/WMS_INVENTARIO_ROTEIRO_TESTES.md`**

---

## 8. Registro de execução (preencher em homologação)

| Data | Executor | Build/commit | Snapshot antes | Snapshot depois | Observações |
|------|------------|--------------|----------------|-----------------|---------------|
|      |            |              |                |                 |               |

---

*Documento alinhado a `docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md` (MVP encerrado §0).*
