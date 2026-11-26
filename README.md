# Atlas Cargo

O painel da operação logística. A torre monta a viagem, convoca o motorista e acompanha a carga até o fim. O estoque recebe, separa e expede. O motorista responde pelo aplicativo. Várias empresas usam a mesma instalação: cada uma é um tenant e só vê o que é dela.

O tenant `default` é a instalação padrão. Ele libera o acesso das outras empresas e guarda o canal de WhatsApp da plataforma. Esse canal é o **Switch Digital**, em Configurações → Switch / WhatsApp. Convocação, recuperação de senha e pedido de acesso saem por ele.

[Instalar](#instalar) · [Atualizar um servidor que já roda](#atualizar) · [Telas](#o-que-voce-opera) · [Como a empresa e o motorista entram](#como-a-empresa-e-o-motorista-entram) · [Stack](#stack) · [Pastas](#pastas)

---

## Instalar

O guia longo da outra máquina está em [`INSTALACAO_OUTRO_SERVIDOR.md`](INSTALACAO_OUTRO_SERVIDOR.md). O restore do banco está em [`backups/README_RESTORE.md`](backups/README_RESTORE.md).

### O que você precisa ter em mãos

| Item | Onde conseguir |
| --- | --- |
| Git, Node.js LTS e PostgreSQL 14+ (16 ou 18) | Na máquina. No Windows, `psql` e `pg_restore` ficam em `C:\Program Files\PostgreSQL\18\bin\` |
| Código | `https://github.com/scopelfast/atlas-cargo` |
| `backend/.env` | Não vai no Git. Copiar do servidor que já funciona, ou montar com `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` e `JWT_SECRET` |
| Banco | Novo: dump `backups/atlas_cargo_prd_20261126.dump`. Já em uso: os scripts da seção [Atualizar](#atualizar). Não restaurar o dump por cima de um banco que já opera |
| WhatsApp | Token, fila e endpoint do Switch Digital, gravados em Configurações depois do primeiro login. Não ficam no README |

### Banco novo

```powershell
git clone https://github.com/scopelfast/atlas-cargo.git
cd atlas-cargo

$env:PGPASSWORD = "SUA_SENHA"
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" `
  -h localhost -p 5432 -U postgres -d atlas_cargo_prd `
  --no-owner --no-acl `
  backups\atlas_cargo_prd_20261126.dump
```

O banco `atlas_cargo_prd` precisa existir vazio antes do `pg_restore`. Se o usuário do `.env` não for `postgres`, troque o `-U`.

### Subir o processo

```powershell
cd atlas-cargo\backend
npm ci
npm start
```

`npm start` executa `node server.js`. O servidor lê `backend/.env` e recusa subir se faltar banco ou `JWT_SECRET`. Na máquina de desenvolvimento o painel abre em `http://localhost:8083/`. A porta de cada servidor é a do `.env`.

O app do motorista fica em `/motorista/`. O pedido de acesso da empresa fica em `/cadastro-empresa.html`.

---

## Atualizar

Servidor que já tem o Atlas em uso. Não restaure o dump por cima.

```powershell
cd C:\gitHub\SysScopel
git pull https://github.com/scopelfast/atlas-cargo.git main
git log -1 --oneline
```

No banco `atlas_cargo_prd`, nesta ordem. Os scripts podem rodar de novo: eles só criam o que ainda não existe.

```powershell
$env:PGPASSWORD = "SUA_SENHA"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\adicionar_viagem_lote_saldo_postgres.sql
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\adicionar_viagem_filha_auditoria_postgres.sql
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\menu_do_banco_local_postgres.sql
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\cadastro_tenant_vinculo_postgres.sql
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\recuperacao_senha_log_postgres.sql
& $psql -h localhost -U atlas -d atlas_cargo_prd -f backend\scripts\saas_pedido_acesso_postgres.sql
```

Se o usuário do banco nessa máquina não for `atlas`, use o usuário do `.env`.

Depois reinicie o Node. Com pm2:

```powershell
pm2 restart all
```

O `.env` não vem no pull. Não copie outro por cima.

---

## O que você opera

O menu tem três recortes: módulo base, torre e estoque. O número na frente do nome é o código do menu.

| Grupo | Telas |
| --- | --- |
| **Cadastro** | 1.0 Cadastro Geral · 1.1 Estados · 1.2 Mesorregião · 1.3 Cidade · 1.4 Tipo de validade |
| **Frota** | 2.0 Veículos · 2.1 Marca · 2.2 Tipo · 2.3 Modelo · 2.4 Grupo · 2.5 Classe de frota |
| **Viagem** | 3.0 Viagem · 3.1 Tipo · 3.2 Situação · 3.3 Roteiro · 3.4 Tipo de ocorrência · 3.5 Campanha de oportunidades |
| **Torre** | 4.0 Convocações · 4.1 Alertas · 4.2 Chat · 4.3 SOS · 4.4 Ranking · 4.5 Mapa de viagem · 4.6 Logs de acesso |
| **Estoque** | 5.0 Painel · 5.1 Cadastros · 5.2 Recebimento · 5.3 Separação · 5.4 Cargas · 5.5 Expedição · 5.8 Baixas / perdas · 5.9 Relatórios · 6.0 Inventário · 6.1 Transferências · 6.2 Valor de estoque · 7.1 Cobrança |
| **Sistema** | 9.0 Usuário · 9.1 Tipo de atividade · 9.2 Empresas · 9.3 Filiais · 9.4 Configurações · 9.5 Tenants e módulos · 9.6 Disparo WhatsApp |

A viagem, por dentro, tem filtros, grid, dados, histórico, mapa, motoristas compatíveis, convocações, veículo, motorista, rastreamento e macros.

O app do motorista não está nesse menu. Ele tem login, cadastro, recuperação de senha, convocação, viagem, GPS, comprovante, chat e SOS.

A tela fala português e espanhol. A hora segue o fuso gravado em Configurações. Claro e escuro acompanham o tema do navegador.

---

## Como a empresa e o motorista entram

### Empresa

`/cadastro-empresa.html` recebe o pedido: nome, documento, país, contato, e-mail, DDI, celular, usuário e senha. Brasil confere o CNPJ. Paraguai, o RUC. Argentina, o CUIT. Uruguai, o RUT. Celular inválido não entra. A senha fica só em hash.

A fila fica em **Tenants e módulos → Pedidos de acesso**. Liberar pede um identificador curto, cria o tenant e o usuário com a senha que a empresa escolheu, e copia as atividades de quem liberou, sem a tela de tenants e sem Tipos de Atividade. Recusar encerra o pedido.

Três avisos vão para o celular da empresa: recebido, liberado e recusado. O pedido novo também avisa o celular do cadastro do tenant padrão, para a liberação não ficar parada. As colunas **WhatsApp** e **Aviso ao responsável** dizem se saiu ou qual foi o erro.

Planos, módulos, limites de usuário e de sessão ficam na mesma tela: catálogo, planos, clientes e override por tenant.

### Motorista

Dois caminhos, e os dois deixam a ficha inativa até a torre liberar o aplicativo.

- **Link da empresa.** No Cadastro Geral, **Link do motorista** copia `/motorista/pages/cadastro.html?empresa=` com o tenant de quem está logado. A ficha nasce nessa empresa e só ela vê.
- **Bolsão.** Sem `empresa` no endereço, a ficha nasce no tenant padrão. As outras torres consultam, sem editar nome, documento nem celular. **Usar** grava a ligação em `CADASTRO_TENANT_VINCULO`: a campanha dessa torre passa a incluir a pessoa, e senha e celular continuam na ficha do Atlas. **Cadastro próprio** exige outro celular e nasce só naquela empresa. O mesmo celular do bolsão não vira um segundo login.

A planilha do Cadastro Geral usa o celular como chave. Célula vazia não apaga. Nome e celular já entram na campanha. O login do app fica pendente até existir senha.

No login, a pessoa escolhe celular, CPF ou CNPJ. Em espanhol, celular ou documento.

### Senha

O motorista pede o código em `/motorista/pages/recuperar-senha.html`. O operador pede em `/recuperar-senha.html`, com login, nome ou e-mail. O código tem 6 dígitos, vale 15 minutos e sai no WhatsApp do celular daquele cadastro. Usuário do painel sem celular ligado usa o celular do cadastro da empresa quando ele é o contato dela.

O registro fica em **Configurações → Recuperação de senha**, só no tenant padrão: se o WhatsApp saiu, se a senha mudou, ou por que não. O código e a senha nova não são gravados.

---

## Estoque

Recebimento, separação, carga programada, expedição, baixa, inventário, transferência entre donos, valor de estoque e cobrança. Dono, armazém, área, doca, produto, categoria e de-para são do tenant. Motivo de baixa global não é.

A limpeza de teste, em Tenants e módulos, apaga a operação da torre e do estoque do tenant escolhido. Cadastro de pessoas, veículos, usuários, plano, cidade e tipo de atividade ficam. O contador de uma tabela volta a 1 só quando ela fica vazia.

---

## Registro

| Acontecimento | Onde ver |
| --- | --- |
| Recuperação de senha | Configurações → Recuperação de senha. Tabela `RECUPERACAO_SENHA_LOG` |
| Pedido de acesso e o aviso ao responsável | Tenants e módulos → Pedidos de acesso. Tabela `SAAS_PEDIDO_ACESSO` |
| WhatsApp de uma convocação | Log da viagem, em `LOG_ENVIO_WHATSAPP` e `LOGSWEBHOOKMETA`. Envio de senha e de pedido de acesso não têm convocação, então não entram nessa lista |

---

## Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| API | Node.js e Express (`backend/server.js` sobe, `backend/app.js` monta as rotas) | Um processo serve o painel e a API |
| Banco | PostgreSQL `atlas_cargo_prd` | O dado operacional. Sessão do banco em `America/Sao_Paulo`; a tela converte a hora para o fuso de Configurações |
| Painel | HTML, CSS e JavaScript | Cada módulo é uma página em `backend/public/modulos` |
| Sessão | JWT | Torre e motorista. O tempo da sessão da torre vem do `.env` |
| WhatsApp | Switch Digital | Um canal no tenant padrão. Convocação, senha e pedido de acesso usam o mesmo token |
| Empresas | Tenant em `SAAS_CLIENTE_CONTRATANTE` | Plano, módulos e limites por empresa. O `default` administra |

---

## Pastas

```text
backend/server.js          sobe o processo e lê o .env
backend/app.js             rotas Express
backend/controllers/       torre, motorista e estoque
backend/services/          Switch Digital, bolsão, pedido de acesso, log de senha
backend/scripts/           SQL idempotente para banco que já existe
backend/public/modulos/    telas do painel
backend/public/motorista/  app do motorista
backups/                   dump para banco novo
docs/                      produto, evolução, WMS e SaaS
```

Uploads de CNH, CRLV, áudio e comprovante ficam em `backend/public/uploads` e não entram no Git.

---

## Documentação

| Assunto | Arquivo |
| --- | --- |
| O que o produto é | [`docs/PRODUTO_E_LOGO.md`](docs/PRODUTO_E_LOGO.md) |
| O que já mudou nesta linha | [`docs/EVOLUCAO_ATLAS_CARGO.md`](docs/EVOLUCAO_ATLAS_CARGO.md) |
| Outra máquina, do zero | [`INSTALACAO_OUTRO_SERVIDOR.md`](INSTALACAO_OUTRO_SERVIDOR.md) |
| Restore e scripts do banco | [`backups/README_RESTORE.md`](backups/README_RESTORE.md) |
| Licença de módulos por tenant | [`docs/SAAS_MODULOS_LICENCA.md`](docs/SAAS_MODULOS_LICENCA.md) |
| Switch Digital | [`docs/PLANO_INTEGRACAO_SWITCH_DIGITAL_E_REGRAS.md`](docs/PLANO_INTEGRACAO_SWITCH_DIGITAL_E_REGRAS.md) |
| Inventário, para quem opera | [`docs/WMS_INVENTARIO_MANUAL_OPERADOR.md`](docs/WMS_INVENTARIO_MANUAL_OPERADOR.md) |

---

## Licença

Uso interno da operação. Este repositório não traz senha, token nem documento de cliente.
