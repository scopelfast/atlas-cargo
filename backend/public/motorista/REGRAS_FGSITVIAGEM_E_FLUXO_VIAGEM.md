# Regras FGSITVIAGEM e fluxo da viagem

Documento de referência para o campo **FGSITVIAGEM** (situação da viagem) e transições. Usar nas implementações futuras (Gerenciar Viagens, macros, integrações).

---

## Significado dos códigos (FGSITVIAGEM)

| Código | Significado | Observação |
|--------|-------------|------------|
| **D** | Preparação | Estado inicial. Dados sendo alimentados. |
| **P** | Programada | Quando tem todos os dados cadastrados (regras do sistema) e **pelo menos um motorista** na aba Motorista. (Veículo: em definição se será obrigatório.) |
| **A** | Aprovada | Motorista com **todas as validades cadastradas e em dia**. A partir daqui: monitoramento, integração WhatsApp, torre de controle. |
| **T** | Em trânsito | Obrigatório para toda viagem “em andamento”: motorista rodando, em movimento. |
| **C** | Cancelada | Atualizado **automaticamente** ao clicar no botão **Desativar viagem** (ícone lixeira) em **Gerenciar Viagens > Viagens > Visualização em Grid**. |
| **E** | Final de rota | Alimentado pela **macro** que o motorista registrar, atrelada em **Gerenciar Tipo de Ocorrência**. |
| **F** | Finalizada | Só após conferir: dados da viagem, posição, macro, comprovante, avaliação do motorista. Será uma ação que valida tudo que foi acompanhado. Depois definir onde colocar botão de “baixa”. |
| **M** | Emissão de documentos | Por enquanto **não tratado** (ainda não há documentos no projeto). |

---

## Fluxo resumido

1. Viagem começa em **Preparação (D)**.
2. Com dados completos + ao menos 1 motorista → **Programada (P)**.
3. Com validades do motorista em dia → **Aprovada (A)**.
4. Durante a execução → **Em trânsito (T)**.
5. Motorista registra macro de fim de rota → **Final de rota (E)**.
6. Após conferência completa (dados, macro, comprovante, avaliação) → **Finalizada (F)**.
7. Desativar viagem na grid → **Cancelada (C)**.

---

## Regra na tela de macros (motorista)

- **Se o histórico da viagem tiver qualquer macro do tipo Final (F), Cancelada (C) ou Final de rota (E), nenhuma outra macro pode ser registrada.**  
- Implementado em `macros.html`: nesses casos todas as macros ficam desabilitadas, com a mensagem: *"Viagem encerrada. Não é permitido registrar mais macros."*

---

*Documento criado a partir das regras de negócio repassadas para uso em melhorias futuras (Gerenciar Viagens, botão baixa, obrigatoriedade de veículo, etc.).*
