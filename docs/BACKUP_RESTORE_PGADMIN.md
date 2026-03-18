# Backup e restauração pelo pgAdmin

Usar **formato Custom** no pgAdmin evita erros de `\N`, COPY e CRLF. O arquivo fica com extensão `.backup` e a restauração é feita pela própria interface.

---

## 1. Backup (na sua máquina ou no servidor)

1. Abra o **pgAdmin** e conecte ao servidor PostgreSQL.
2. No painel esquerdo, clique com o **botão direito** no banco **atlas_cargo_prd**.
3. Escolha **Backup...** e configure:

   **Aba General**
   - **Filename:** clique no ícone de pasta e escolha onde salvar, ex.:  
     `atlas_cargo_prd_backup_20260317.backup`
   - **Format:** **Custom**
   - **Encoding:** pode deixar em branco ou escolher **UTF8**
   - **Number of jobs** e **Role name:** deixe em branco

   **Aba Data Options**
   - **Blobs:** deixe **ON** (inclui Large Objects)
   - **Pre-data**, **Data**, **Post-data:** deixe como está (padrão inclui tudo)
   - **Do not save:** deixe tudo OFF (para incluir owner, privileges, etc.)

   **Aba Query Options**
   - Deixe tudo OFF (Custom usa COPY, não INSERT)

   **Aba Table Options**
   - Deixe em branco (backup completo)

   **Aba Options**
   - **Verbose messages:** ON (ajuda a acompanhar o progresso)

   **Aba Objects**
   - Marque o **esquema `public`** (caixa ao lado de "public") para incluir todas as tabelas (CADASTROGERAL, CIDADE, etc.). Se nenhum objeto estiver marcado, o backup pode ficar vazio ou incompleto.

4. Clique em **Backup**. Ao terminar, o arquivo `.backup` estará na pasta que você indicou.

---

## 2. Restaurar no servidor (pgAdmin)

1. Envie o arquivo **.backup** para o servidor (ex.: na pasta `db-script` ou em qualquer pasta acessível pela máquina onde o pgAdmin acessa o servidor).
2. No **pgAdmin**, conecte ao **PostgreSQL do servidor** (não ao banco local).
3. **Se o banco atlas_cargo_prd ainda não existir no servidor:**
   - Clique com o botão direito em **Databases** → **Create** → **Database...**
   - **Database:** `atlas_cargo_prd`
   - **Owner:** postgres (ou o usuário que você usa)
   - Salve.
4. Clique com o **botão direito** no banco **atlas_cargo_prd**.
5. Escolha **Restore...**.
6. Na aba **General**:
   - **Filename:** clique no ícone de pasta e **selecione o arquivo .backup** (o que você enviou para o servidor).
   - **Format:** deve aparecer **Custom** automaticamente.
7. Na aba **Options** (opcional):
   - **Clean before restore:** marque se quiser **apagar** os objetos existentes no banco antes (use com cuidado em produção).
   - Deixe as outras opções como padrão se não tiver necessidade específica.
8. Clique em **Restore**. A restauração usa `pg_restore` por baixo e não sofre com CRLF nem com comandos `\N`/COPY em texto.

---

## Resumo

| Ação     | Onde no pgAdmin              | Formato do arquivo |
|----------|------------------------------|---------------------|
| Backup   | Botão direito no banco → Backup... | **Custom** → `.backup` |
| Restore  | Botão direito no banco → Restore... | Selecionar o `.backup` |

Se você fizer backup em **Plain** (.sql), o pgAdmin **não** consegue restaurar por Restore... (só aceita Custom/Tar). Para Plain, é preciso usar o script `restaurar-backup-db.sh` no terminal do servidor (com o .sql já convertido de CRLF para LF).
