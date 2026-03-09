# Carga de tabelas geográficas: SQL Server → PostgreSQL

Scripts para extrair dados das tabelas geográficas no **SQL Server** e carregar no **PostgreSQL** (PAIS, ESTADO, MESOREGIAO, MICROREGIAO, CIDADE, REGIAOCIDADE, REGIAOFISCAL).

---

## Passo a passo

### 1. No PostgreSQL (antes de qualquer INSERT)

Rodar o script de **limpeza** (apaga os dados atuais dessas tabelas, na ordem que respeita FKs):

```bash
psql -U postgres -d atlas_cargo_prd -f scripts/carga_postgres_limpar_tabelas_geograficas.sql
```

Ou abra `carga_postgres_limpar_tabelas_geograficas.sql` no seu cliente PostgreSQL e execute.

**Ordem do TRUNCATE:** REGIAOCIDADE → CIDADE → MICROREGIAO → MESOREGIAO → ESTADO → REGIAOFISCAL → PAIS (filhas antes dos pais).

**Atenção:** O `TRUNCATE ... CASCADE` também **esvazia todas as tabelas que referenciam** CIDADE/ROTEIRO (ex.: ROTEIRO, ROTEIRO_CG, ROTEIROPONTOS, VIAGEMMESTRE, CONVOCACAO, ALERTS, MESSAGES, SOS_ALERTS, VIAGEMMOTORISTA, VIAGEMVEICULO, etc.). Use este fluxo apenas em **ambiente de desenvolvimento/teste** ou **carga inicial**. Se o banco já tiver viagens, roteiros e convocações que não podem ser perdidos, faça backup antes ou use carga incremental (merge por chave).

---

### 2. No SQL Server (gerar os INSERTs)

1. Abra o script **`carga_sqlserver_gerar_inserts_postgres.sql`** no SSMS.
2. Em **Query** → **Results to** → **Results to Text** (e, se existir, aumente o “Maximum number of characters” para 8192 ou mais).
3. Execute **um bloco por vez** (cada bloco é um `SELECT ... FROM TABELA`):
   - 1. PAIS  
   - 2. ESTADO  
   - 3. REGIAOFISCAL  
   - 4. MESOREGIAO  
   - 5. MICROREGIAO  
   - 6. CIDADE  
   - 7. REGIAOCIDADE  
4. Para cada bloco: copie **todo** o resultado (todas as linhas de INSERT) e guarde em um arquivo `.sql` ou na memória.

---

### 3. No PostgreSQL (rodar os INSERTs)

Execute os INSERTs **nessa ordem** (respeitando FKs):

1. PAIS  
2. ESTADO  
3. REGIAOFISCAL  
4. MESOREGIAO  
5. MICROREGIAO  
6. CIDADE  
7. REGIAOCIDADE  

Cole cada conjunto de INSERTs no cliente PostgreSQL (psql, DBeaver, etc.) e execute.

---

## Observações

- **Sim, é preciso limpar antes:** se já existir dados nessas tabelas no PostgreSQL, é necessário rodar o script de limpeza antes, senão pode haver duplicidade de chave (PAIS, ESTADO, CIDADE, etc.) ou violação de FK.
- As tabelas no PostgreSQL devem ter as **mesmas colunas** (e tipos compatíveis) que no SQL Server. Se no seu Postgres alguma coluna tiver sido removida ou renomeada, ajuste os INSERTs gerados (apague a coluna do `INSERT` ou renomeie).
- No SQL Server, **execute um bloco por vez** e copie só o resultado daquele bloco; assim você evita misturar INSERTs de tabelas diferentes.
- Se alguma tabela no SQL Server estiver **vazia**, o `SELECT` não retorna linhas; aí não há INSERT para essa tabela e você pode pular essa etapa no Postgres.
