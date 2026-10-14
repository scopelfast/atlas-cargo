# Plano - Derivacao de Viagens por Saldo

## Objetivo

Documentar a evolucao do fluxo de convocacoes/confirmacoes para suportar:

- bloqueio de aceite quando a viagem ja tiver motorista selecionado;
- modelo de "viagem mae" com saldo por embarques ou por toneladas;
- criacao de viagens derivadas ("filhas") a cada aceite aprovado;
- consumo progressivo do saldo ate zerar.

Este documento e guia de implementacao futura.

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

1. Fase 1: bloquear aceite indevido apos confirmacao.
2. Fase 2: introduzir campos de saldo na viagem mae (sem derivacao automatica).
3. Fase 3: habilitar derivacao automatica por feature flag.
4. Fase 4: migrar UI para painel de distribuicao (saldo + filhas).

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

