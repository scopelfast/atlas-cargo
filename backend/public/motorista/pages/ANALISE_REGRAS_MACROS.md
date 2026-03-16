# Análise: Regras de Macros e Script TIPOOCORRENCIA

## 1. Objetivo

- Organizar as macros por categoria na tela do motorista (`macros.html`).
- Garantir que a sequência de macros siga as regras de negócio descritas.
- Verificar se o script de ajuste da tabela **TIPOOCORRENCIA** (códigos 1–14, FGSITUACAO, SEQ) **fecha** com essas regras.

---

## 2. Dados propostos para TIPOOCORRENCIA

| CDTIPOOCORRENCIA | DSTIPOOCORRENCIA              | FGSITUACAO | SEQ |
|------------------|--------------------------------|------------|-----|
| 1                | Viagem - Início                | T          | 1   |
| 2                | Viagem - Fim                   | F          | 1   |
| 3                | Carga - Chegada                | C          | 1   |
| 4                | Carga - Início                 | C          | 2   |
| 5                | Carga - Fim                    | C          | 3   |
| 6                | Parada - Abastecimento         | P          | 1   |
| 7                | Parada - Alimentação/Banheiro  | P          | 1   |
| 8                | Parada - Manutenção            | P          | 1   |
| 9                | Retido - Posto Fiscal/Polícia  | P          | 1   |
| 10               | Parada - Descanso/Pernoite     | P          | 1   |
| 11               | Viagem - Reinício              | T          | 2   |
| 12               | Descarga - Chegada             | D          | 1   |
| 13               | Descarga - Início              | D          | 2   |
| 14               | Descarga - Fim                 | D          | 3   |

- **Partida (T):** 1 (Início), 11 (Reinício).  
- **Final (F):** 2 (Fim de rota).  
- **Carregamento (C):** 3, 4, 5 (Chegada, Início, Fim).  
- **Paradas (P):** 6, 7, 8, 9, 10 (todos SEQ=1).  
- **Descarga (D):** 12, 13, 14 (Chegada, Início, Fim).

---

## 3. Conferência regra a regra

### 3.1 Início de viagem (T, SEQ 1) – código 1

- **Regra:** Só pode ser enviada **uma vez** na viagem; até não ser informada, nenhuma outra macro é liberada; depois de informada, fica **desabilitada**.
- **Dados:** CDTIPOOCORRENCIA = 1, FGSITUACAO = T, SEQ = 1.
- **Conclusão:** Fecha. Basta na tela: (a) sem histórico → só o botão 1 habilitado; (b) com 1 já no histórico → botão 1 desabilitado (e demais conforme regras abaixo).

### 3.2 Reinício de viagem (T, SEQ 2) – código 11

- **Regra:** Disponível só quando a **última** macro for (FGSITUACAO = P) ou (FGSITUACAO em C/D e SEQ = 3).
- **Dados:** 11 com T, SEQ 2.
- **Conclusão:** Fecha. Lógica: `ultima.FGSITUACAO === 'P' || (ultima.FGSITUACAO === 'C' && ultima.SEQ === 3) || (ultima.FGSITUACAO === 'D' && ultima.SEQ === 3)`.

### 3.3 Paradas (P) – códigos 6 a 10

- **Regra:** Disponíveis só quando a **última** macro for (FGSITUACAO = T).
- **Dados:** Todos P com SEQ = 1.
- **Conclusão:** Fecha. Habilitar qualquer macro com FGSITUACAO = P quando `ultima.FGSITUACAO === 'T'`. Hoje o código trata P como “sempre permitido”; isso precisa ser alterado para “só quando última = T”.

### 3.4 Carregamento (C) – códigos 3, 4, 5

- **Regra:**  
  - C, SEQ 1 (Chegada): só quando última = T.  
  - C, SEQ 2 (Início): só quando última = C, SEQ 1.  
  - C, SEQ 3 (Fim): só quando última = C, SEQ 2.
- **Dados:** 3 (C,1), 4 (C,2), 5 (C,3).
- **Conclusão:** Fecha. A lógica atual por SEQ 1→2→3 já cobre; basta usar FGSITUACAO/SEQ (e não mais códigos antigos 151, 109, 110).

### 3.5 Descarga (D) – códigos 12, 13, 14

- **Regra:**  
  - D, SEQ 1: só quando última = T **e** já existir **um ciclo completo de C** (C SEQ 1, 2 e 3).  
  - D, SEQ 2: só quando última = D, SEQ 1.  
  - D, SEQ 3: só quando última = D, SEQ 2.
- **Dados:** 12 (D,1), 13 (D,2), 14 (D,3).
- **Conclusão:** Fecha. Falta na tela: exigir que no histórico exista pelo menos um registro com FGSITUACAO = C e SEQ = 3 antes de liberar D, SEQ 1.

### 3.6 Final (F) – código 2 (Fim de rota)

- **Regra:** “Fim de rota” ainda não estava cadastrado; no script proposto já existe como código 2, F, SEQ 1.
- **Quando habilitar:** Faz sentido liberar F, SEQ 1 quando a última macro for D, SEQ 3 (fim da descarga), ou em outra regra de “fim de viagem” que vocês definirem.
- **Conclusão:** Dados fecham; falta apenas definir na tela em que situações o botão “Viagem - Fim” fica habilitado (ex.: após D,3).

### 3.7 Resumo “quando última é T”

- **Regra:** Quando a última macro for T, devem estar disponíveis apenas macros com FGSITUACAO em (C, P, F) e **SEQ = 1**.
- **Com os dados:**  
  - C,1 (3), P (6–10), F,1 (2) → habilitados.  
  - T,2 (11) → não habilitado (Reinício só após P ou C/D,3).  
- **Conclusão:** Fecha. Na implementação: se `ultima.FGSITUACAO === 'T'`, habilitar só macros com FGSITUACAO in ('C','P','F') e SEQ === 1.

### 3.8 Sequência estrita C e D

- Dentro de C: após C,1 só C,2; após C,2 só C,3.  
- Dentro de D: após D,1 só D,2; após D,2 só D,3.  
- **Dados:** SEQ 1,2,3 para C e D.  
- **Conclusão:** Fecha; a ideia atual de “mesma situação, próxima SEQ” já atende.

---

## 4. Conclusão da análise

- **Sim, a regra das macros fecha com o script de TIPOOCORRENCIA proposto.**  
- Os códigos 1–14, com FGSITUACAO (T, F, C, P, D) e SEQ (1, 2, 3 onde aplicável), são suficientes para implementar todas as regras descritas.

O que falta é **só implementação na tela** (`macros.html` e API de listagem/histórico):

1. **Ajustes na validação (validarSequencia):**
   - Primeira macro da viagem: só T, SEQ 1 (código 1); depois desabilitar 1 quando já estiver no histórico.
   - Reinício (11): só quando última for P ou (C/D com SEQ 3).
   - Paradas (P): só quando última for T (remover “sempre permitido”).
   - C e D: manter sequência 1→2→3 por FGSITUACAO/SEQ (já quase pronto).
   - D, SEQ 1: além de “última = T”, exiger que exista no histórico pelo menos um registro C com SEQ = 3 (ciclo completo de carregamento).
   - F, SEQ 1 (2): definir quando habilitar (ex.: última = D, SEQ 3).

2. **Organização na tela:**  
   Agrupar os botões por categoria (Partida T, Paradas P, Carregamento C, Descarga D, Final F), usando FGSITUACAO (e eventualmente SEQ) vindo da API, que por sua vez deve refletir a tabela TIPOOCORRENCIA ajustada.

3. **API e histórico:**  
   - Listagem de macros para o motorista deve vir de TIPOOCORRENCIA (com FGSITUACAO e SEQ).  
   - Histórico (VIAGEMOCORRENCIA) deve retornar CDTIPOOCORRENCIA (e, se possível, FGSITUACAO/SEQ do tipo) para que a validação use apenas FGSITUACAO/SEQ (e não mais códigos fixos 103, 104, 151, etc.).

---

## 5. Script de ajuste da tabela TIPOOCORRENCIA

- O script que você descreveu (atualizar/inserir os 14 registros com os dados da tabela acima) é o que **padroniza** a base para essas regras.
- **Atenção:** Se hoje existem outros códigos (ex.: 26, 58, 103, 104, 151, 159, 192, …) e há registros em **VIAGEMOCORRENCIA** referenciando esses códigos, ao trocar para 1–14 será necessário:
  - Ou **atualizar** os registros em VIAGEMOCORRENCIA para os novos CDTIPOOCORRENCIA (mapeamento 103→1, 104→11, 151→3, etc.),  
  - Ou manter uma **tabela de equivalência** (código antigo → novo) e usar na leitura do histórico.

Resumo: **a regra das macros fecha com o script de TIPOOCORRENCIA; o passo seguinte é implementar a validação e a organização por categoria na tela e tratar a migração/equivalência do histórico (VIAGEMOCORRENCIA) se os códigos forem alterados.**
