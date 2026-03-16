# Ordem sugerida: Banco → Programa (Macros)

## Resumo

1. **Primeiro:** organizar o banco (TIPOOCORRENCIA 1–14 + migrar VIAGEMOCORRENCIA).
2. **Depois:** ajustar o programa (API de macros + tela `macros.html` com categorias e regras de sequência).

---

## Passo 1 – Banco (PostgreSQL)

### Script a executar

- **Arquivo:** `backend/scripts/ajustar_tipoocorrencia_postgres_1_a_14.sql`

### O que o script faz

1. **Inserir/atualizar** os 14 registros em `TIPOOCORRENCIA` com os códigos e descrições padronizados:
   - 1 = Viagem - Início (T, 1)
   - 2 = Viagem - Fim (F, 1)
   - 3–5 = Carga Chegada / Início / Fim (C, 1/2/3)
   - 6–10 = Paradas (P, 1)
   - 11 = Viagem - Reinício (T, 2)
   - 12–14 = Descarga Chegada / Início / Fim (D, 1/2/3)

2. **Migrar** a tabela `VIAGEMOCORRENCIA` (se existir): atualizar `CDTIPOOCORRENCIA` dos códigos antigos (26, 58, 103, 104, …) para os novos (1–14), conforme o mapeamento definido.

3. **Remover** de `TIPOOCORRENCIA` todos os códigos que não estejam entre 1 e 14.

### Como executar

- No cliente do PostgreSQL (psql, DBeaver, etc.), conectado ao banco do Atlas Cargo, executar o conteúdo do arquivo `ajustar_tipoocorrencia_postgres_1_a_14.sql`.

### Antes de rodar

- Fazer **backup** do banco (ou ao menos das tabelas `TIPOOCORRENCIA` e `VIAGEMOCORRENCIA`).
- Se houver outros códigos em uso (ex.: integrações ou relatórios que referenciem 103, 104, etc.), planejar ajuste nesses pontos após a migração.

---

## Passo 2 – Programa

Depois que o banco estiver com os 14 tipos e o histórico migrado:

### 2.1 API (backend)

- **Listar macros:** `GET /api/motorista/macros`  
  - Garantir que a query use apenas `TIPOOCORRENCIA` (já virão só 1–14).
  - Trocar a atribuição de **ícones** de `CDTIPOOCORRENCIA` fixo (103, 104, …) para **FGSITUACAO + SEQ** (ou para os novos códigos 1–14), para não depender mais de códigos antigos.

- **Histórico:** `GET /api/motorista/historico-macros/:idViagem`  
  - O histórico já estará com `CDTIPOOCORRENCIA` 1–14 após a migração. Garantir que o front e a validação usem **FGSITUACAO** e **SEQ** (ou os novos códigos) em vez de 103, 104, etc.

- **Validar sequência:**  
  - Se existir validação no backend (ex.: `validarSequenciaMacro` ou stored procedure), atualizar para as regras por **FGSITUACAO** e **SEQ** (e, se aplicável, para códigos 1–14).

### 2.2 Tela do motorista (`macros.html`)

- **Agrupar por categoria:**  
  Partida (T), Paradas (P), Carregamento (C), Descarga (D), Final (F), usando o campo `FGSITUACAO` (e, se quiser, `SEQ`) retornado pela API.

- **Regras de habilitação:**  
  Reescrever `validarSequencia(macro)` com base na **última macro do histórico** e em **FGSITUACAO + SEQ** (conforme `ANALISE_REGRAS_MACROS.md`), sem usar códigos 103, 104, 151, etc.

- **Comportamentos especiais:**  
  - Início de viagem (T, SEQ 1): uma vez por viagem; depois desabilitar.  
  - Reinício (T, SEQ 2): só após P ou C/D com SEQ 3.  
  - Paradas (P): só quando a última for T.  
  - Descarga, SEQ 1: só quando a última for T e já existir ciclo completo de C (C, SEQ 3).  
  - Fim de rota (F, SEQ 1): definir quando habilitar (ex.: última = D, SEQ 3).

---

## Ordem resumida

| # | O quê | Onde |
|---|--------|------|
| 1 | Rodar script de ajuste TIPOOCORRENCIA + migração VIAGEMOCORRENCIA | PostgreSQL |
| 2 | Ajustar API (listar macros, ícones, histórico, validação) | motorista-app.controller.js (e rotas) |
| 3 | Ajustar tela: categorias + validarSequencia por FGSITUACAO/SEQ | motorista/pages/macros.html |

Assim o banco fica consistente com os códigos 1–14 e o programa passa a depender só da estrutura nova (FGSITUACAO, SEQ e, se quiser, dos códigos 1–14).
