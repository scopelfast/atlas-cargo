# Atlas Cargo

Sistema de gestão logística. A torre, o cadastro, a frota e o estoque ficam no mesmo painel. O motorista entra pelo app. Várias empresas usam a mesma instalação: cada uma é um tenant e só vê o que é dela.

O canal de WhatsApp é o **Switch Digital**. O nome antigo DeskRio não faz parte do sistema.

## O que está no ar

- **Torre:** viagens, roteiro, convocações, campanha de oportunidades, mapa, alertas, chat, SOS e ranking.
- **Cadastro:** pessoas, veículos, classes de frota e planilha de motoristas. O link da empresa cria a ficha nela. Sem empresa, a ficha cai no bolsão do tenant padrão.
- **App do motorista:** login por celular, CPF ou CNPJ, cadastro e recuperação de senha no WhatsApp.
- **Estoque:** recebimento, separação, cargas, expedição, inventário, transferências e relatórios.
- **Empresas:** o pedido de acesso chega em `/cadastro-empresa.html`. O tenant padrão libera em Tenants e módulos e é avisado no WhatsApp. A fila mostra se o envio saiu ou por que falhou.
- **Idioma:** português e espanhol. O fuso das telas segue Configurações.

## Tecnologias

- Node.js e Express
- PostgreSQL
- HTML, CSS e JavaScript no navegador
- JWT

## Subir uma cópia

O passo a passo da outra máquina está em [`INSTALACAO_OUTRO_SERVIDOR.md`](INSTALACAO_OUTRO_SERVIDOR.md). O restore do banco está em [`backups/README_RESTORE.md`](backups/README_RESTORE.md).

```powershell
git clone https://github.com/scopelfast/atlas-cargo.git
cd atlas-cargo\backend
npm ci
npm start
```

O `backend/.env` não vai no Git. Ele guarda banco, `JWT_SECRET` e o token do Switch Digital. Sem esse arquivo o servidor não sobe.

Banco que **já existe** não recebe o dump por cima. Roda os scripts idempotentes listados no README do backup. Banco novo restaura `backups/atlas_cargo_prd_20261126.dump`.

Na máquina de desenvolvimento o painel abre em `http://localhost:8083/`. A porta de cada servidor é a do `.env`.

## Onde fica o registro

| O quê | Onde olhar |
| --- | --- |
| Recuperação de senha | Configurações → Recuperação de senha, só no tenant padrão. Código e senha nova não são gravados. |
| Pedido de acesso e aviso no WhatsApp | Tenants e módulos → Pedidos de acesso |
| Envio ligado a uma viagem | Log da viagem. Recuperação de senha e pedido de acesso não entram nessa lista. |

## Licença

Uso interno. O repositório público não traz senha, token nem documento de cliente.
