# Por que "Viagens em Andamento" mostra 0?

## Causa

A API **Viagens em Andamento** (`GET /api/motorista/viagens-andamento/:cdMotorista`) só retorna viagens que atendem **dois** critérios:

1. A viagem existe em **VIAGEMMESTRE** com situação considerada “em andamento”  
   (`FGSITVIAGEM` não é `'C'`, `'F'` nem `'E'`).
2. Existe um registro em **VIAGEMMOTORISTA** ligando essa viagem ao motorista  
   (`IDVIAGEM` + `CDMOTORISTA` = código do cadastro do motorista).

Se a viagem foi criada/aprovada mas **não foi vinculada ao motorista** na tabela **VIAGEMMOTORISTA**, ela não aparece no app.

## Solução

Inserir (ou garantir) o vínculo na tabela **VIAGEMMOTORISTA**:

- **IDVIAGEM**: id da viagem (ex.: 1).
- **CDMOTORISTA**: código do motorista (CDCADASTRO do CADASTROGERAL).

Use o script:

- **`vincular_viagem_motorista.sql`**  
  Ajuste o ID da viagem e o CPF (ou use o trecho que insere por `CDCADASTRO` conhecido) e execute no banco (PostgreSQL).

Depois de executar, atualize o dashboard do app; o contador e a lista de “Viagens em Andamento” devem refletir a viagem.

## Onde isso é feito no sistema

No módulo **Gerenciar Viagens** (web), ao aprovar/atribuir motorista à viagem, o sistema deve inserir ou atualizar **VIAGEMMOTORISTA**. Se a viagem foi criada manualmente no banco ou por outro processo que não preenche **VIAGEMMOTORISTA**, o vínculo precisa ser feito à mão com o script acima.
