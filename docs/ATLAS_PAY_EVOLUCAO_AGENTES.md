# Atlas Pay — evolução: cobrança dos agentes

Atualizado em 27/11/2026.

**Caminho acordado** (ordem fixa). Fases 1–4 do motor estão fechadas no HML local (`docs/ATLAS_PAY_FECHAMENTO_FASES_1_A_4.md`). Pix (Fase 5) fica **depois** deste roteiro.

Regras de negócio: `docs/PLANO_MODULO_FINANCEIRO.md`.  
Fechamento de uso: `docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md` + decisões D1–D7.

## Ordem

| # | Etapa | Dono | Status |
| --- | --- | --- | --- |
| 0 | **Operação Atlas no 9.7:** logado no `default`, escolher o agente e publicar/ligar o contrato dele (sem login tenant a tenant) | Produto | **Feito (27/11)** — seletor + `X-Atlas-Pay-Tenant` |
| 1 | Tabela comercial Atlas (1–3 pacotes reais) | Negócio | **Pendente** — preencher abaixo |
| 2 | Cadastro operacional no 9.7 por agente piloto | Operação + Atlas Pay | Aguarda etapa 0 + 1 |
| 3 | Transparência no painel do tenant (contrato + fechamento + abertas) | Produto | Aguarda etapa 2 estável |
| 4 | WhatsApp opcional (fechamento / aprovação) | Produto | Depois da 3 |
| 5 | Pix / gateway (Fase 5) | Produto + sandbox | Fora deste roteiro até piloto OK |

### Etapa 0 — Sem login tenant a tenant (**feita**)

- Barra **Operar agente** no 9.7 (só sessão `default`).
- Header `X-Atlas-Pay-Tenant` nas chamadas de dados; `GET /api/financeiro/agentes` lista clientes SaaS.
- Permissões FIN_* continuam na sessão Atlas; dados (contrato/fechamento/cobrança/perms do agente) usam o tenant escolhido.
- Tenant comum: sem barra; header de outro tenant → 403.
- HML limpo: fixtures `atlas-pay-*` removidos; clientes: `default`, `cleverson-scopel`.
- **Início da vigência** (campo data, só Atlas): 1ª publicação pode nascer no 1º do mês; na vigente com a mesma tabela, antecipar o início cobre lacuna do fechamento (não inventa meses sem contrato).

## Etapa 1 — Tabela comercial (preencher)

Sem números reais a tela vira inventário de placeholders. Preencher **antes** de ligar regra em tenant real.

| Pacote | Componentes ativos | Fixo (R$/mês) | R$ por carga anunciada | % do frete | Política inadimplência | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| A — só fixo | FIXO | _preencher_ | — | — | ALERTA (padrão) | |
| B — fixo + carga | FIXO + POR_CARGA | _preencher_ | _preencher_ | — | ALERTA | |
| C — mix | FIXO + POR_CARGA + % | _preencher_ | _preencher_ | _preencher_ | ALERTA | |

Notas:

- Valores no contrato vão em **centavos** no servidor; a UI mostra reais.
- Mudar o contrato depois **não** altera cobrança / fechamento já gerados (versão nova).
- Beneficiário da cobrança de uso: tenant `default` (D6).
- Competência e vencimento: fuso `America/Sao_Paulo`; vencimento = aprovação + 10 dias (D5).

## Etapa 2 — Cadastro operacional (checklist por agente)

Pré-requisito: **etapa 0** (seletor de agente no 9.7 como `default`).

1. Confirmar o cliente em **9.5 → Clientes** (mesmo `SAAS_CLIENTE` / tenant; sem segundo cadastro).
2. Em **9.7**, com sessão Atlas (`default`): selecionar o agente → **Contratos** → publicar versão com o pacote escolhido.
3. Deixar **`FG_REGRA_ATIVA = N`** na primeira publicação.
4. Em **Fechamentos** (mesmo agente selecionado): prévia da competência e conferir totais.
5. Só então republicar / ajustar com **`FG_REGRA_ATIVA = S`**.
6. Aprovar fechamento → gerar cobrança (ações explícitas; permissões FIN_*).
7. Baixa manual enquanto não houver Pix.

Piloto sugerido: **1 tenant** real (ex.: `cleverson-scopel`), pacote A ou B, um mês fechado de ponta a ponta antes de escalar. **Não** recriar tenants `atlas-pay-*` no HML operacional.

## Etapa 3 — Transparência para o agente

Hoje só a Atlas vê preço/fechamento no 9.7. Próximo produto:

- Painel do tenant (sem menu Tenants SaaS): **contrato vigente**, **fechamento do mês**, **cobranças em aberto**.
- Somente leitura do próprio tenant; sem versionar contrato alheio.
- Reaproveitar API `/api/financeiro/*` com escopo do tenant da sessão.

## Etapa 4 — WhatsApp (opcional)

- Canal Switch do `default` (mesmo padrão de pedidos de acesso).
- Gatilhos: fechamento aprovado e/ou cobrança gerada.
- Sem inventar destino: usar celular do cadastro do cliente SaaS.

## Fora de escopo deste roteiro

- Misturar com Cobrança 7.1 do estoque.
- Segundo catálogo de preços fora de `FIN_CONTRATO`.
- Bloquear `default` por dívida gerada contra ele mesmo.
- Produção externa sem autorização explícita.
