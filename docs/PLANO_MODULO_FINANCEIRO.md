# Módulo financeiro — plano de desenvolvimento

Atualizado em 26/11/2026.

Este documento é a regra de negócio e a ordem de construção. A tela 7.1 Cobrança operacional do estoque continua sendo a conta do armazém. Ela não recebe o motorista nem o agenciador.

O texto de conversa que dizia “cobrança da conexão no aceite” está superado. A cobrança da conexão nasce na aprovação da torre.

## O que este plano corrige no material do ChatGPT

O chat “Automação de Pagamentos Atlas Cargo” descreve um núcleo financeiro, Pix, webhook e duas receitas. Isso continua válido como direção. Três pontos dele não valem:

| O chat escreveu | A regra que vale |
| --- | --- |
| A cobrança nasce quando o motorista aceita a carga | A cobrança nasce quando a torre aprova esse motorista na carga |
| Se a carga for cancelada, a comissão segue uma política configurável | Se a torre desiste do motorista, ou o motorista desiste da carga, não fica cobrança |
| R$ 100,00 como valor inicial da comissão | R$ 100,00 é só exemplo de tabela. Cada contrato tem o seu valor |

Pix, QR Code e webhook ficam para depois. A primeira entrega funciona com baixa manual.

## Duas modalidades

As duas dívidas entram no mesmo módulo. Não se misturam.

**Conexão.** O motorista aprovado paga o serviço de ter sido ligado àquela oferta. O pagador é o motorista. A referência é a convocação que a torre confirmou.

**Uso da plataforma.** O agenciador paga pelo uso. O pagador é o tenant. O contrato pode ter um componente ou a soma deles:

| Componente | O que conta |
| --- | --- |
| Valor fixo | Uma parcela no período, com ou sem carga anunciada |
| Valor por carga anunciada | Um valor cada vez que ele publica uma oferta |
| Percentual | Uma parte do frete da carga |
| Mix | A soma dos componentes marcados. Exemplo de tabela, não de preço: R$ 200 no mês, mais R$ 15 por carga anunciada, mais 2% do frete |

O valor é calculado no servidor e gravado em centavos. A cobrança guarda o número congelado. Mudar o contrato depois não altera cobrança já gerada.

## Quando a conexão cobra

Hoje a torre confirma uma convocação. Essa confirmação grava `CONFIRMADA` e passa as outras aceitas da mesma viagem para `ACEITA_DESCARTADA`. Esse é o momento da aprovação.

| Acontecimento | Efeito financeiro |
| --- | --- |
| Motorista aceita | Nenhum. Pode haver vários aceites |
| Torre confirma um motorista | Nasce uma cobrança de conexão, com o valor do contrato naquele instante. Uma confirmação, uma cobrança ativa |
| Outro aceite da mesma viagem vira `ACEITA_DESCARTADA` | Nenhuma cobrança para quem não foi escolhido |
| Torre desiste (reativar / desistir lote) ou remove motorista com convocação CONFIRMADA; ou registra desistência do motorista (origem MOTORISTA) | A cobrança ABERTA/PAGA de CONEXAO é cancelada (com reversão se PAGA). Remoção sem CONFIRMADA não gera efeito financeiro |
| Torre confirma de novo, depois de reativar | Nasce outra cobrança, ligada à nova confirmação |

A confirmação e a cobrança entram na mesma transação. Se a cobrança não gravar, a confirmação não fica pela metade. Com a regra financeira desligada para aquele tenant, a confirmação segue como hoje e não gera cobrança.

## Alerta e bloqueio, sem travar a plataforma

A inadimplência age sobre quem deve, no que ele ainda vai fazer. Não derruba a instalação, não desfaz carga que já está em rota e não mistura as duas dívidas.

A política padrão de toda regra nova é **alerta**. Bloqueio só vale se alguém marcar isso no contrato. Um erro de configuração nasce avisando, não fechando o uso.

| Política / situação | Motorista | Agenciador (tenant) |
| --- | --- | --- |
| `ABERTA` não vencida (qualquer política) | Aviso no app; continua aceitando | Aviso no painel; continua operando |
| `ABERTA` vencida + **ALERTA** | Aviso; continua aceitando (nunca 403) | Aviso; continua operando (nunca 403) |
| `ABERTA` vencida + **BLOQUEIO** | Não aceita oferta nova / campanha (403). Viagem já confirmada segue | Não publica oferta nova / não confirma motorista novo (403). Viagem em rota, estoque e consulta seguem |
| `PAGA` / `CANCELADA` / regra `N` | Sem aviso nem bloqueio | Sem aviso nem bloqueio |
| Falha financeira | Fail-open com log e aviso | Fail-open com log e aviso |

Regras de segurança:

- O tenant `default` não é bloqueado por uma cobrança gerada contra ele mesmo.
- Motorista inadimplente não bloqueia o agenciador. Agenciador inadimplente não é tratado como dívida do motorista.
- Bloqueio não apaga cadastro, não derruba a sessão de quem já está logado e não cancela viagem confirmada.
- Quitar ou cancelar a cobrança tira o alerta e o bloqueio na hora.
- A baixa manual é uma ação do módulo financeiro, com permissão própria. O motorista não marca a própria cobrança como paga.
- Se o módulo financeiro falhar numa tela que não é a confirmação, a falha aparece nessa tela. O login, o estoque e o mapa continuam.

## O que não entra agora

- Pix, QR Code, Copia e Cola, webhook e conta Asaas. A cobrança já nasce com lugar para isso, vazio.
- Boleto, cartão, split e Pix Automático.
- Estorno bancário. Na primeira entrega, desfazer é cancelar a cobrança ou reverter a baixa manual.
- Partida dobrada e ledger contábil. (O **FIXO pró-rata por dias** na competência do uso da plataforma é da Fase 3, não ledger.)
- Ligar este módulo à cobrança 7.1 do estoque.

## Onde encaixa no que já existe

| Peça de hoje | Uso |
| --- | --- |
| Confirmar convocação em `viagemmestre.controller.js` | Único lugar que cria a cobrança de conexão |
| `ACEITA_DESCARTADA` | Quem não foi escolhido não é cobrado |
| Reativar convocação, recusa ou desistência depois da confirmação | Cancela a cobrança daquela confirmação |
| `SAAS_PLANO` e `SAAS_CLIENTE_CONTRATANTE` | O agenciador já existe. O contrato financeiro é uma extensão desse cliente, não um segundo cadastro de empresa |
| Tipo de atividade | O menu do módulo entra como os outros. Ver, configurar contrato, dar baixa, cancelar |
| Switch / WhatsApp | Fora da primeira entrega. O alerta nasce na tela. O aviso no celular reutiliza o canal que já existe, numa fase seguinte |

## Estratégia de desenvolvimento

Uma fase só segue quando a anterior está usável com a regra desligada para quem não aderiu. Nada disso exige banco.

**Fase 1 — contrato e cobrança, sem efeito na torre.** Tabelas do contrato (componentes fixo, por carga anunciada, percentual, política de alerta ou bloqueio) e da cobrança (origem, pagador, referência, valor em centavos, status, baixa manual). Tela do módulo: contrato do tenant e lista de cobranças. Regra desligada. A torre não muda.

**Fase 2 — conexão na confirmação.** Ao confirmar, se a regra do tenant estiver ligada, nasce a cobrança. Desistência cancela. Aceite puro e `ACEITA_DESCARTADA` continuam sem cobrança. Testar os quatro caminhos antes de ligar para um tenant real: aceite sem cobrança, confirmação gera uma, desistência cancela, segundo aceite descartado não gera.

**Fase 3 — uso do agenciador.** O fechamento do período soma os componentes marcados e gera uma cobrança só, com o detalhe do que entrou na soma. Carga anunciada conta a publicação, não o aceite. **Status (26/11/2026):** concluída tecnicamente no local — competência/vencimento/lacunas em `America/Sao_Paulo` (independente do fuso do host); aprovar/gerar cobrança com `requireFinPerm` e testes HTTP 403. Detalhe: `docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md`.

**Fase 4 — alerta e bloqueio.** Só depois que a lista de em aberto estiver confiável. A política lida é a do contrato. O padrão permanece alerta. O bloqueio só aplica com `ABERTA` vencida (`DH_VENCIMENTO` &lt; agora SP); reversível ao quitar/cancelar. **Status (26/11/2026):** **CONCLUÍDA E VALIDADA TECNICAMENTE NO AMBIENTE LOCAL** — `docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md` (proposta: `ATLAS_PAY_FASE4_INADIMPLENCIA_PROPOSTA.md`). Produção externa não autorizada.

**Fase 5 — Pix.** O mesmo registro de cobrança recebe o identificador do gateway, o código e a confirmação por webhook. A baixa manual continua valendo para o que não passou pelo banco. Esta fase não começa sem uma conta de sandbox e sem a fase 2 estável.

Cada fase que criar tabela leva um script idempotente em `backend/scripts/`, o ajuste em `script_db_postgres.sql` se o banco novo precisar nascer com ela, e um dump novo em `backups/`, no mesmo envio do código.

## Pronto da primeira entrega

A primeira entrega é a fase 1 e a fase 2, com a regra desligada por padrão.

- Aceitar uma carga não gera cobrança.
- Confirmar o motorista gera uma cobrança, com o valor do contrato congelado. O exemplo de R$ 100 só aparece se o contrato estiver assim.
- Desistir dele, ou ele desistir da carga, cancela essa cobrança.
- Quem aceitou e não foi aprovado não tem cobrança.
- A baixa é manual.
- Nenhum tenant é bloqueado.
- Confirmar uma viagem de um tenant sem a regra ligada segue como hoje.
