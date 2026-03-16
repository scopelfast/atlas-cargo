# Destino preferido na regra de compatíveis

## O que é

O motorista informa no cadastro (app ou web) sua **região de destino preferido** para divulgação de cargas:

- **País destino** (ex.: Brasil)
- **Estado / UF** (ex.: PR, SC, RS — pode ser mais de um, separados por vírgula)
- **Cidade (opcional)** (ex.: Curitiba, Joinville, Pelotas — pode ser mais de um, separados por vírgula)

Esses dados ficam em `MOTORISTA_COMPLEMENTO`: `PAIS_DESTINO_PREF`, `SIGLA_ESTADO_DESTINO_PREF`, `CIDADE_DESTINO_PREF`.

## Como entra na regra dos compatíveis

Na aba **Compatíveis** (Gerenciar Viagens), ao clicar em **Buscar Motoristas Compatíveis** para uma viagem, o sistema já aplica:

1. **Classe de frota** igual à da viagem  
2. **Veículo rastreado** (quando a viagem exige)  
3. **(Opcional)** **Destino preferido** — passou a ser o 4º critério, quando a viagem tem cidade de destino cadastrada.

### Regra do destino preferido

- Se o motorista **não** tiver nenhum destino preferido preenchido (país, estado e cidade vazios), ele **continua sendo considerado compatível** (não é filtrado por destino).
- Se o motorista tiver **ao menos um** destino preferido preenchido, ele só entra na lista de compatíveis se o **destino da viagem** “bater” com essa preferência:

| Campo do motorista   | Como compara com o destino da viagem |
|----------------------|--------------------------------------|
| **País destino**     | País da cidade de destino da viagem = país informado pelo motorista (ex.: BR). |
| **Estado / UF**      | UF da cidade de destino da viagem está na lista do motorista (ex.: PR, SC, RS). Vários UFs separados por vírgula. |
| **Cidade (opcional)**| Nome da cidade de destino da viagem está na lista do motorista (ex.: Curitiba, Joinville, Pelotas). Vários nomes separados por vírgula, comparação sem diferenciar maiúsculas/minúsculas. |

- **País:** se o motorista informou país, o destino da viagem deve ser desse mesmo país.  
- **Estado:** se o motorista informou estado(s), o destino da viagem deve estar em um desses estados.  
- **Cidade:** se o motorista informou cidade(s), o destino da viagem deve ser uma dessas cidades.

Assim, um motorista com **Brasil | PR, SC, RS | Curitiba, Joinville, Pelotas** só aparece como compatível para viagens cujo **destino** for no Brasil, em um dos estados PR/SC/RS e (quando ele informou cidades) em uma das cidades Curitiba, Joinville ou Pelotas.

## Onde está implementado

- **Backend:** `viagemmestre.controller.js` → método `buscarMotoristasCompatíveis`.  
- A viagem traz `CDCIDADEDESTINO`; a cidade de destino fornece **ESTADO** (UF) e **NMCIDADE**. O país do destino é considerado **BR** quando não houver campo de país na tabela de cidade.  
- O filtro por destino preferido só é aplicado quando a viagem tem cidade de destino cadastrada (`CDCIDADEDESTINO`).

## Resumo

O destino preferido **entra na regra dos compatíveis** como um filtro a mais: quem tem preferência preenchida só aparece para viagens cujo destino (país, estado e, se informado, cidade) estiver de acordo com essa preferência.
