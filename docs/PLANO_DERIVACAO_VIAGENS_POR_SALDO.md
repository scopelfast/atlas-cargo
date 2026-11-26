# Plano - Derivacao de Viagens por Saldo

## Objetivo

Documentar a evolucao do fluxo de convocacoes/confirmacoes para suportar:

- bloqueio de aceite quando a viagem ja tiver motorista selecionado;
- modelo de "viagem mae" com saldo por embarques ou por toneladas;
- criacao de viagens derivadas ("filhas") a cada aceite aprovado;
- consumo progressivo do saldo ate zerar.

Este documento e guia de implementacao futura. A secao Registro da evolucao acompanha o que ja entrou no sistema.

## Registro da evolucao

### 25/11/2026 — Fase 2 gravada

Campos opcionais na viagem, sem derivar filha e sem debitar saldo no aceite.

- Tela: Gerenciar Viagens, aba Dados, card Lote na rota. Em branco, a viagem continua unica.
- Tipos: `EMBARQUES` (cargas) ou `TONELADAS`. Quantidade obrigatoria quando o tipo esta preenchido.
- Colunas em `VIAGEMMESTRE`: `TIPO_SALDO`, `SALDO_INICIAL_EMBARQUES`, `SALDO_ATUAL_EMBARQUES`, `SALDO_INICIAL_TON`, `SALDO_ATUAL_TON`, `STATUS_DISTRIBUICAO`, `PERMITE_EXCEDER_SALDO`.
- Na criacao, saldo atual nasce igual ao inicial e `STATUS_DISTRIBUICAO` fica `ABERTA`.
- Na edicao, o saldo atual so e reescrito enquanto ainda nao houve consumo (atual nulo ou igual ao inicial). Status `PARCIAL`, `ESGOTADA` ou `CANCELADA` nao volta para `ABERTA` so por salvar o cadastro.
- Script: `backend/scripts/adicionar_viagem_lote_saldo_postgres.sql`.

Ainda nao existe:

- tabela `VIAGEM_DERIVACAO_AUDITORIA` (nao ha trilha de saldo antes/depois);
- debito do saldo no aceite;
- viagem filha;
- painel de distribuicao.

### 25/11/2026 — Controle alinhado (ainda sem codigo)

A mae e a oferta da rota. Ela guarda o saldo e nao segue no mapa. Cada atendimento confirmado na torre vira uma viagem filha, normal, daquele motorista.

- O saldo baixa somente quando a torre confirma o motorista. Interesse ou aceite do motorista nao consome.
- Cargas: cada confirmacao tira 1 carga. Ninguem informa outra quantidade.
- Toneladas: na confirmacao, a torre informa as toneladas daquele caminhao (ex.: 30 t). O saldo desce esse valor. A filha nasce com esse peso.
- Se a quantidade pedida for maior que o saldo, a confirmacao para. O saldo nao fica negativo.
- Ao zerar, a mae fica `ESGOTADA` e nenhuma confirmacao nova passa. Os interesses ja recebidos continuam na lista, para reusar a mesma divulgacao se uma vaga voltar.
- Viagem sem lote continua um aceite e uma confirmacao, como hoje.

### 25/11/2026 — Divulgacao unica e desistencia (ainda sem codigo)

A divulgacao da mae sai uma vez. O saldo nao mexe nesse envio nem no aceite do motorista.

- Antes da confirmacao, o motorista desiste e nao ha o que devolver. A vaga nunca saiu.
- Depois da confirmacao, so a torre devolve a vaga, com motivo. O motorista nao estorna o saldo pelo app.
- A devolucao e uma transacao so: trava a mae, devolve exatamente o que foi debitado (1 carga, ou as toneladas gravadas na filha), cancela a filha e a confirmacao, grava auditoria (saldo antes e depois, usuario, motivo). Se um passo falha, nada muda.
- Segunda desistencia da mesma filha nao devolve de novo. Segunda confirmacao nao debita de novo.
- Se a filha ja saiu (rastreio depois da confirmacao ou comprovante), a devolucao para. A carga ja andou. Nao volta vaga com o caminhao na rua.
- Mae que estava `ESGOTADA` volta a `PARCIAL` quando a vaga retorna. A lista de quem ja aceitou segue valendo. Nao dispara outra divulgacao sozinha.

### 25/11/2026 — Fase 3 codada e testada

Na confirmacao da torre (`POST /api/convocacoes/:id/confirmar`):

- viagem sem `TIPO_SALDO` segue o fluxo de sempre;
- lote de cargas debita 1 e cria a filha;
- lote de toneladas exige `TONELADAS` no corpo e debita esse valor;
- saldo insuficiente responde 409 e nao grava;
- as outras aceitas da oferta continuam na lista.

Na desistencia da torre (`POST /api/convocacoes/:id/desistir-lote`), com motivo:

- devolve exatamente o que a filha consumiu e cancela a filha;
- segunda desistencia nao devolve de novo;
- rastreio depois da confirmacao (ou comprovante) bloqueia a devolucao.

Auditoria em `VIAGEM_DERIVACAO_AUDITORIA`. Teste automatico cobriu carga, tonelada, saldo insuficiente, desistencia dupla e rastreio, e desfez os dados de teste.

Na tela: confirmar uma aceita do lote; em toneladas o sistema pede a quantidade; na filha confirmada, o botao de desfazer devolve a vaga.

### Proximo passo

Fase 4: painel da mae com programado, atendido, restante e a lista das filhas.

## Regra imediata (curto prazo)

### Problema atual

Mesmo apos existir convocacao `CONFIRMADA` na viagem, outro motorista ainda pode visualizar tela com botoes de aceite.

### Regra correta

Se ja existir motorista confirmado para a viagem (ou se a convocacao estiver encerrada), o motorista nao pode mais aceitar.

### Implementacao recomendada

- **Backend (obrigatorio)**: bloquear aceite com validacao transacional.
  - antes de aceitar, consultar se ha `CONFIRMADA` para o `IDVIAGEM`;
  - se houver, retornar `409` com codigo de negocio (ex.: `CONVOCACAO_ENCERRADA`);
  - opcional: encerrar pendentes da viagem em lote (`ENCERRADA_POR_SELECAO`).
- **Frontend (recomendado)**:
  - ao carregar a convocacao, buscar estado consolidado da viagem;
  - se encerrada por selecao, ocultar/desabilitar botoes `Aceitar/Recusar`;
  - tratar `409` exibindo mensagem amigavel e recarregar estado.

## Visao futura (medio prazo)

## Conceitos

- **Viagem mae**: demanda principal (mesma rota/regras), com saldo.
- **Saldo por embarques**: quantidade restante de embarques.
- **Saldo por toneladas**: quantidade restante em toneladas.
- **Viagem filha**: viagem derivada para motorista aprovado.

## Cenarios

1. Viagem com `5` embarques:
   - cada aprovacao consome `1` embarque;
   - ao consumir, cria 1 viagem filha;
   - encerra quando saldo embarques = `0`.

2. Viagem com `270` toneladas:
   - cada aprovacao consome `X` toneladas aprovadas;
   - ao consumir, cria viagem filha vinculada;
   - encerra quando saldo toneladas = `0`.

## Modelo funcional proposto

### Atributos da viagem mae

- `tipo_saldo`: `EMBARQUES` ou `TONELADAS`;
- `saldo_inicial_embarques` / `saldo_atual_embarques`;
- `saldo_inicial_ton` / `saldo_atual_ton`;
- `status_distribuicao`: `ABERTA`, `PARCIAL`, `ESGOTADA`, `CANCELADA`;
- `permite_exceder_saldo` (padrao `N`).

### Atributos da viagem filha

- `id_viagem_mae`;
- `origem_derivacao`: `CONVOCACAO_APROVADA`;
- `valor_consumido_embarques` ou `valor_consumido_ton`;
- referencia ao motorista/convocacao que originou.

## Regras de negocio

1. Nao permitir aprovacao se saldo insuficiente.
2. Cada aprovacao valida deve:
   - consumir saldo da mae;
   - criar viagem filha;
   - vincular convocacao aprovada a filha;
   - registrar historico/auditoria.
3. Se saldo zerar:
   - marcar mae como `ESGOTADA`;
   - encerrar convocacoes pendentes da mae.
4. Operacao deve ser atomica (transacao unica).

## Fluxo transacional recomendado

1. Iniciar transacao.
2. Lock da viagem mae (`FOR UPDATE`) para evitar corrida.
3. Validar saldo disponivel.
4. Confirmar/aprovar convocacao.
5. Debitar saldo da mae.
6. Criar viagem filha.
7. Encerrar convocacoes nao elegiveis (se aplicavel).
8. Gravar auditoria.
9. Commit.

Se qualquer etapa falhar: rollback completo.

## API (proposta de evolucao)

- `POST /api/convocacoes/:id/aprovar-com-saldo`
  - input: `tipoConsumo`, `quantidade`, `idViagemMae`;
  - output: `idViagemFilha`, `saldoRestante`, `statusDistribuicao`.

- `GET /api/viagens/:id/distribuicao`
  - retorna resumo da viagem mae, saldo e filhas geradas.

## Dados e auditoria

Registrar eventos:

- tentativa de aprovacao;
- saldo antes/depois;
- viagem filha criada;
- motivo de bloqueio (saldo insuficiente, viagem esgotada, etc.).

Sugestao de tabela de auditoria:

- `VIAGEM_DERIVACAO_AUDITORIA`
  - `ID`, `IDVIAGEM_MAE`, `IDVIAGEM_FILHA`, `IDCONVOCACAO`, `EVENTO`,
    `SALDO_ANTES`, `SALDO_DEPOIS`, `USUARIO`, `DH_EVENTO`, `DETALHES`.

## Compatibilidade com fluxo atual

Para reduzir risco:

1. Fase 1: bloquear aceite indevido apos confirmacao. Ja existe no fluxo comum (`VIAGEM_JA_CONFIRMADA`); nao foi refeito nesta etapa.
2. Fase 2: introduzir campos de saldo na viagem mae (sem derivacao automatica). Feita em 25/11/2026. Ver Registro da evolucao.
3. Fase 3: habilitar derivacao automatica por feature flag. Nao iniciada.
4. Fase 4: migrar UI para painel de distribuicao (saldo + filhas). Nao iniciada.

## Riscos e cuidados

- corrida de aprovacao simultanea (obrigatorio lock transacional);
- duplicidade de filha por reenvio/retry;
- inconsistencias em integracoes (WhatsApp, alertas, ranking);
- reflexo no app motorista e relatorios.

## Criterios de aceite

- bloqueio de aceite apos confirmacao comprovado em teste;
- nao gerar filha sem debitar saldo;
- nao debitar saldo sem gerar filha;
- saldo nunca negativo;
- viagem mae muda para `ESGOTADA` ao zerar;
- trilha de auditoria completa por evento.

## Observacao final

Este plano preserva o comportamento operacional atual e prepara a arquitetura para "viagem com saldo", com distribuicao controlada e rastreavel ate o esgotamento total.

