# Atlas Cargo

O Atlas Cargo é o painel da operação logística. A torre monta a viagem, convoca o motorista e acompanha a carga. O estoque recebe, separa e expede. O motorista responde pelo aplicativo. Tudo isso numa instalação só, com várias empresas ao mesmo tempo.

Cada empresa é um tenant. Ela vê os próprios cadastros, viagens e estoque. O tenant `default` é a instalação padrão: libera o acesso das outras empresas e guarda o canal de WhatsApp usado pela plataforma.

O WhatsApp sai pelo **Switch Digital**, configurado em Configurações → Switch / WhatsApp. Recuperação de senha, pedido de acesso e convocação usam esse canal.

## Quem entra

| Pessoa | Onde | O que faz |
| --- | --- | --- |
| Operador da torre | Painel no navegador | Viagem, convocação, cadastro, mapa, alerta, chat e SOS |
| Motorista | `/motorista/` | Entra com celular, CPF ou CNPJ. Vê convocação, viagem, GPS, comprovante e chat |
| Empresa nova | `/cadastro-empresa.html` | Pede acesso. Fica pendente até o tenant padrão liberar |

O login da torre tem duas portas: **Sou motorista** abre o app. **Cadastrar-se** abre o pedido de acesso da empresa.

A tela fala português e espanhol. Datas e horas seguem o fuso gravado em Configurações.

## Torre e cadastro

O menu da torre cobre a viagem do começo ao fim: tipo, situação, roteiro, ocorrência, campanha de oportunidades, convocação, alerta, chat, SOS, ranking e mapa.

No Cadastro Geral a pessoa pode ser motorista, transportador ou contratante. Veículo, marca, modelo, grupo e classe de frota ficam no mesmo bloco. A planilha de motoristas entra por ali: celular é a chave, célula vazia não apaga dado.

O motorista chega por dois caminhos.

- **Link da empresa.** No Cadastro Geral, **Link do motorista** copia o endereço com `?empresa=`. Quem abre esse link nasce na empresa, inativo, até a torre liberar.
- **Bolsão.** Sem empresa no endereço, a ficha nasce no tenant padrão. As outras torres consultam. **Usar** liga a pessoa à empresa sem criar um segundo login. **Cadastro próprio** exige outro celular e nasce só naquela empresa.

## Aplicativo do motorista

O login aceita celular, CPF ou CNPJ. A máscara muda com a escolha. Em espanhol, a escolha é celular ou documento.

Esqueci a senha pede um código de 6 dígitos no WhatsApp do celular cadastrado. O código vale 15 minutos. A página do painel faz o mesmo para o operador: vale o login, o nome ou o e-mail, e o código vai para o celular daquele usuário.

## Estoque

Recebimento, separação, cargas, expedição, baixas, inventário, transferências, valor de estoque, cobrança e relatórios. O dono do estoque, o armazém, a doca e o produto ficam no cadastro do módulo. Motivos de baixa globais não são dados de uma empresa só.

## Empresas na mesma instalação

A empresa pede o tenant em `/cadastro-empresa.html`. Documento, país, DDI e celular são validados. A senha escolhida fica só em hash.

Quem opera o tenant padrão vê a fila em **Tenants e módulos → Pedidos de acesso**. Liberar pede um identificador curto, cria o tenant e o usuário, e copia as atividades de quem liberou, sem a tela de tenants e sem Tipos de Atividade. Recusar encerra o pedido.

Cada movimento avisa o celular da empresa. O pedido novo também avisa o celular do cadastro do tenant padrão, para ninguém ficar esperando a liberação. As duas colunas da fila dizem se o WhatsApp saiu ou qual foi o erro. O canal é sempre o Switch Digital do `default`.

Planos, módulos e limites ficam na mesma tela: catálogo, planos, clientes e override por tenant.

## Registro do que aconteceu

| Acontecimento | Onde ver |
| --- | --- |
| Recuperação de senha do motorista ou do painel | Configurações → Recuperação de senha. Só o tenant padrão. Código e senha nova não entram no registro. |
| Pedido de acesso e o aviso para o responsável | Tenants e módulos → Pedidos de acesso. A hora usa o fuso de Configurações. |
| WhatsApp de uma viagem | Log daquela viagem. Envio de senha e de pedido de acesso não aparecem ali, porque não têm convocação. |

A limpeza de teste, na mesma tela de tenants, apaga operação da torre e do estoque do tenant escolhido. Cadastro de pessoas, veículos, usuários, plano, cidade e tipo de atividade ficam.

## Tecnologias

Node.js e Express no `backend/`. PostgreSQL no banco `atlas_cargo_prd`. O painel é HTML, CSS e JavaScript. A sessão da torre e do motorista usa JWT.

## Como rodar

O guia da outra máquina é [`INSTALACAO_OUTRO_SERVIDOR.md`](INSTALACAO_OUTRO_SERVIDOR.md). O restore está em [`backups/README_RESTORE.md`](backups/README_RESTORE.md).

```powershell
git clone https://github.com/scopelfast/atlas-cargo.git
cd atlas-cargo\backend
npm ci
npm start
```

Crie `backend/.env` na máquina. Ele não vai no Git. O servidor exige `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` e `JWT_SECRET`. O token do Switch Digital fica em Configurações, no banco, não no README.

Banco novo: restaurar `backups/atlas_cargo_prd_20261126.dump` num banco vazio.

Banco que já está em uso: não restaurar o dump por cima. Rodar os scripts idempotentes, nesta ordem:

1. `backend/scripts/adicionar_viagem_lote_saldo_postgres.sql`
2. `backend/scripts/adicionar_viagem_filha_auditoria_postgres.sql`
3. `backend/scripts/menu_do_banco_local_postgres.sql`
4. `backend/scripts/cadastro_tenant_vinculo_postgres.sql`
5. `backend/scripts/recuperacao_senha_log_postgres.sql`
6. `backend/scripts/saas_pedido_acesso_postgres.sql`

Na máquina de desenvolvimento o painel abre em `http://localhost:8083/`. A porta de cada servidor é a do `.env`.

## Pastas

```text
backend/server.js          sobe o processo e lê o .env
backend/app.js             rotas Express
backend/controllers/       regras da torre, do motorista e do estoque
backend/services/          WhatsApp, bolsão, pedido de acesso, logs
backend/scripts/           SQL idempotente para banco que já existe
backend/public/            painel, módulos e app do motorista
backups/                   dump do PostgreSQL para banco novo
docs/                      produto, evolução e instalação visual
```

Uploads de CNH, CRLV e comprovante ficam em `backend/public/uploads` e não entram no Git.

## Licença

Uso interno da operação. Este repositório não traz senha, token nem documento de cliente.
