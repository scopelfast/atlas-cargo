# Atlas Cargo

O sistema da operação logística. A torre monta a viagem, convoca o motorista e acompanha a carga. O estoque recebe, separa, carrega e expede. O motorista executa no celular. Cadastro, frota, torre e armazém ficam na mesma instalação e no mesmo banco.

Várias empresas usam a mesma instalação. Cada uma é um tenant e só vê o que é dela. O tenant `default` é a instalação padrão: libera o acesso das outras, guarda o canal de WhatsApp e consulta o registro de senha. O canal é o **Switch Digital**, em Configurações → Switch / WhatsApp. Convocação, recuperação de senha e pedido de acesso saem por ele.

O menu tem três produtos: **Módulo Base**, **Torre Logística** e **Gestão Estoque**. O seletor do painel troca a home. O que cada pessoa vê ainda passa por duas portas: o plano do tenant e o tipo de atividade do usuário.

[Diferencial](#o-que-diferencia) · [Módulos e funções](#modulos-e-funcoes) · [App do motorista](#app-do-motorista) · [Manuais](#manuais) · [Instalar](#instalar) · [Atualizar](#atualizar)

---

## O que diferencia

| O que a operação ganha | Como o Atlas faz |
| --- | --- |
| Torre e armazém no mesmo lugar | A carga programada do estoque vira parada e pode seguir para a viagem. O motorista da torre é o mesmo cadastro do app |
| Convocação com rastro | O convite sai no WhatsApp, o motorista responde pelo link público `/convocacao` ou pelo app, e a viagem guarda aceite, recusa e motivo. O relatório de convocações mede o funil |
| Motorista sem segundo login | Quem se cadastra sem empresa cai no bolsão do `default`. Outra torre consulta, usa a ficha na campanha, ou copia com outro celular. O celular é único no sistema inteiro |
| Empresa que pede a própria conta | `/cadastro-empresa.html` recebe o pedido. A fila fica em Tenants e módulos. Liberar cria o tenant e o usuário. O celular da empresa e o celular do responsável do `default` são avisados |
| Estoque de terceiro, com lote e validade | Entrada por NF-e, de-para do código do dono, separação por arquivo OPL, carga, expedição, inventário por corte e ajuste, transferência entre donos, valor e cobrança |
| Prova no sistema, não no grupo | GPS, macro, chat, SOS e comprovante de entrega ficam ligados à viagem |
| Cada empresa no seu recorte | Plano liga e desliga módulos. Tipo de atividade liga e desliga o menu. Os dois valem ao mesmo tempo |
| Hora e idioma da instalação | Português e espanhol. A hora da tela segue o fuso de Configurações. Claro e escuro acompanham o tema |

Suporte e pedido de apoio ainda não existem como tela. O canal do `default` já serve para senha e para pedido de acesso. Falta o destino e a página.

---

## Como a operação corre

1. A torre abre a viagem, escolhe tipo, situação e roteiro com pontos no mapa.
2. A aba Compatíveis lista quem pode fazer. A convocação sai no WhatsApp. O motorista aceita no app ou no link.
3. No caminho ele manda posição, macro e, no fim, o comprovante com foto. A torre vê mapa, rastreamento, chat, alerta e SOS.
4. No armazém, a NF-e entra, a conferência ajusta quantidade, lote e validade, a separação lê o pedido OPL, a carga junta as notas e a expedição confirma a saída.
5. Inventário corta o saldo, compara com a contagem e grava só a diferença. Transferência muda o dono. Cobrança lê armazenagem e expedição.

---

## Módulos e funções

O número é o código do menu. A pessoa só vê a linha se o plano do tenant e o tipo de atividade dela liberarem.

### Cadastro — quem é quem

| Menu | Função |
| --- | --- |
| **1.0 Cadastro Geral** | Pessoa e empresa da operação: motorista, transportador, contratante, cliente. Filtro, grid e ficha. No motorista: documentos (CNH e anexos), veículos, classes de frota, validades e locais preferidos de embarque e desembarque. No cliente pessoa jurídica: endereços de entrega. Consulta de CNPJ e CEP preenche razão e endereço. A planilha usa o celular como chave: célula vazia não apaga, nome e celular já entram na campanha, e o login do app fica pendente até existir senha. **Link do motorista** copia o cadastro já marcado com o tenant. Ficha do bolsão aparece para as outras torres como consulta: Usar liga a campanha sem segundo login; cadastro próprio exige outro celular |
| **1.1 Estados** | Unidades da federação usadas em cidade, endereço e filtro |
| **1.2 Mesorregião** | Agrupamento entre estado e cidade, para planejar e convocar por região |
| **1.3 Cidade** | Município com vínculo geográfico. Roteiro e endereço dependem dela |
| **1.4 Tipo de validade** | Catálogo do que vence: CNH, documento do veículo, certificação. A ficha do cadastro controla a data |

### Frota — com o que a carga anda

| Menu | Função |
| --- | --- |
| **2.0 Veículos** | O equipamento físico: placa, vínculo com marca, tipo, modelo e grupo. A viagem e o cadastro do motorista escolhem daqui |
| **2.1 Marca** | Marca do equipamento |
| **2.2 Tipo** | Tipo de equipamento |
| **2.3 Modelo** | Modelo ligado à marca e ao tipo |
| **2.4 Grupo** | Agrupamento da frota para busca e política |
| **2.5 Classe de frota** | Classe exigida pela viagem. O motorista, o transportador, o agente e o grupo recebem classes depois que a ficha está salva. A convocação usa isso para achar quem é compatível |

### Viagem — a demanda até a entrega

| Menu | Função |
| --- | --- |
| **3.0 Viagem** | A demanda. Abas: filtros, grid, dados, histórico, mapa, motoristas compatíveis, convocações, veículo, motorista, rastreamento, integração Switch e macros. A integração mostra o envio de WhatsApp daquela convocação. A macro é o evento do percurso (chegada, ocorrência, parada) |
| **3.1 Tipo de viagem** | Classifica a viagem para filtro e regra |
| **3.2 Situação de viagem** | O estado operacional (a linguagem única da torre e do relatório) |
| **3.3 Roteiro** | A rota: filtros, ficha, pontos (origem, passagem, destino, parada) e mapa. Distância e geocodificação usam o serviço gravado em Configurações |
| **3.4 Tipo de ocorrência** | Catálogo do que a macro pode registrar |
| **3.5 Campanha de oportunidades** | Publica demanda para motoristas. Quem está na campanha da torre — inclusive quem foi ligado pelo bolsão — entra no disparo |

### Torre — o dia da operação

| Menu | Função |
| --- | --- |
| **4.0 Convocações** | A fila dos convites: quem foi chamado, quem aceitou, quem recusou e por quê. O link público `/convocacao` responde sem instalar o app. A página mostra a distância programada em km |
| **4.1 Alertas** | Regras de viagem que avisam a torre (atraso, desvio, silêncio). O texto do aviso automático fica em Configurações → Alertas de viagem |
| **4.2 Chat** | Conversa da torre com o motorista, com histórico no sistema e selo de pendência no topo |
| **4.3 SOS** | Ocorrência crítica aberta pelo motorista, acompanhada pela torre |
| **4.4 Ranking** | Desempenho do motorista a partir da reputação da operação |
| **4.5 Mapa de viagem** | As viagens no mapa, com filtro e lista ao lado. É a visão da frota, não o mapa de um roteiro só |
| **4.6 Logs de acesso** | Quem entrou, quando e de onde |

O **Relatório de convocações** mede o funil: enviadas, aceitas, recusadas, tempo de resposta.

### Estoque — o armazém do dono da mercadoria

O dono do estoque é o cliente da mercadoria. Armazém, área, doca, produto, categoria e de-para são do tenant. Motivo de baixa é global.

| Menu | Função |
| --- | --- |
| **5.0 Painel** | Atalhos do armazém e os números da home quando o produto selecionado é Gestão Estoque |
| **5.1 Cadastros** | Dono, armazém, área, doca, categoria, produto com máscara hierárquica (o ponto do código é nível, não enfeite) e de-para entre o código da NF e o código do dono, com fator de conversão |
| **5.2 Recebimento** | Entrada por XML de NF-e. Filtro, grid e ficha. Conferência de quantidade, lote e validade. A busca de vencimento sai daqui |
| **5.3 Separação** | Pedido de separação a partir do arquivo OPL. Abas: filtros, programação (peso, volume, conservação, veículo), grid e dados da linha, com quantidade coletada |
| **5.4 Cargas** | Junta as notas numa carga programada, monta as paradas e prepara o vínculo com a viagem |
| **5.5 Expedição** | A saída: lista da carga, conferência do que embarcou e divergência |
| **5.8 Baixas / perdas** | Tira saldo por motivo (avaria, vencimento, falta), sem nota fictícia |
| **5.9 Relatórios** | Saldo, movimentação, separação OPL, demonstrativo, datas críticas, conversão de embalagem, NF × separação, divergência de expedição, auditoria de saúde e demanda do dia |
| **6.0 Inventário** | Iguala o sistema ao chão. Abre um corte (snapshot), recebe a contagem em planilha, e ao encerrar grava só a diferença. Tipo geral (ajuste) ou inicial (primeira carga). Item não contado pode ficar como está ou zerar, conforme a política. Consulta por item, planilha modelo e o texto do operador ficam na própria tela |
| **6.1 Transferências** | Move saldo de um dono para outro dentro do armazém |
| **6.2 Valor de estoque** | O saldo valorizado |
| **7.1 Cobrança** | Cobrança operacional do armazém: resumo, armazenagem e expedição |

A **Limpeza de teste**, em Tenants e módulos, apaga a operação da torre e do estoque do tenant escolhido. Cadastro de pessoas, veículos, usuários, plano, cidade e tipo de atividade ficam. O contador de uma tabela volta a 1 só quando ela fica vazia.

### Sistema — quem entra e o que a instalação sabe

| Menu | Função |
| --- | --- |
| **9.0 Usuário** | Login da torre, ativo ou inativo, e o tipo de atividade que define o menu |
| **9.1 Tipo de atividade** | O catálogo de permissão. Cada atividade aponta para um programa do menu e para um produto (Base, Torre ou Estoque) |
| **9.2 Empresas** | Empresas do grupo da instalação |
| **9.3 Filiais** | Unidades dessas empresas |
| **9.4 Configurações** | Contexto (fuso e idioma da instalação), marca e mapa, Switch / WhatsApp (endpoint, token, fila, assinatura e teste), app e transcrição, textos das mensagens de convocação, textos dos alertas de viagem, e o registro de recuperação de senha. Esse registro só aparece no tenant padrão: WhatsApp enviado ou não, senha alterada ou não. O código e a senha nova não são gravados |
| **9.5 Tenants e módulos** | A operação da plataforma. Pedidos de acesso (liberar, recusar, aviso no WhatsApp da empresa e aviso ao responsável). Catálogo de módulos. Planos. Clientes (documento, contato, limites, editar e excluir o tenant inteiro). Override por tenant. Limpeza de teste |
| **9.6 Disparo WhatsApp** | Envio em massa das oportunidades da campanha, pelo mesmo canal Switch |

---

## App do motorista

Fica em `/motorista/`. Não entra no menu da torre. A ficha nasce inativa: a torre libera o aplicativo no Cadastro Geral. O badge **Motoristas pendentes** conta quem espera.

| Tela | Função |
| --- | --- |
| Login | Celular, CPF ou CNPJ. A máscara muda com a opção. Em espanhol, celular ou documento |
| Cadastro | Dados, documento e pelo menos um veículo. Com `?empresa=` nasce naquela torre. Sem empresa, nasce no bolsão |
| Recuperar senha | Código de 6 dígitos, 15 minutos, no WhatsApp do celular da ficha |
| Painel | Atalhos da jornada |
| Convocações | Lista e resposta |
| Viagens e detalhe | A viagem em curso e o histórico, com o comprovante |
| Cargas | O que está embarcado |
| Macros | Evento estruturado do percurso |
| Comprovar entrega | Foto ligada à viagem |
| GPS, enviar posição, rastreamento | A torre passa a ver o ponto |
| Chat | Conversa com a torre |
| SOS | Emergência |
| Oportunidades | Campanhas liberadas para ele |
| Perfil, notificações, diagnóstico | Dados da pessoa, aviso no aparelho e apoio quando o GPS falha |

O operador da torre recupera a senha em `/recuperar-senha.html`, com login, nome ou e-mail. O código vai para o celular do cadastro ligado a ele. Se ele é o contato da empresa e não tem cadastro próprio, vai para o celular desse cadastro.

---

## Registro

| Acontecimento | Onde ver |
| --- | --- |
| Recuperação de senha | Configurações → Recuperação de senha. Tabela `RECUPERACAO_SENHA_LOG` |
| Pedido de acesso e o aviso ao responsável | Tenants e módulos → Pedidos de acesso. Tabela `SAAS_PEDIDO_ACESSO` |
| WhatsApp de uma convocação | Aba Integração Switch da viagem, em `LOG_ENVIO_WHATSAPP` e `LOGSWEBHOOKMETA`. Envio de senha e de pedido de acesso não têm convocação, então não entram nessa lista |
| Quem entrou no painel | 4.6 Logs de acesso |

---

## Manuais

A referência do que a tela faz hoje é este README e a própria tela. A pasta `docs/` não foi reescrita junto com os módulos. Parte dela é plano, parte é ata de piloto, parte é texto de apresentação anterior à operação que está no ar. Tratar esses arquivos como procedimento atual produz erro.

O que ainda serve para operar, com essa ressalva:

| Arquivo | O que é | Limite |
| --- | --- | --- |
| [`docs/WMS_INVENTARIO_MANUAL_OPERADOR.md`](docs/WMS_INVENTARIO_MANUAL_OPERADOR.md) | Passo a passo do inventário para o armazém | Também está na aba Manual operador da tela 6.0. Se a aba e o arquivo divergirem, vale a aba |
| [`docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md`](docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md) | Corte, política de não contados, validade fictícia, dividir linha | Orientação, não o passo de cada botão |
| [`docs/WMS_ONDE_RELATORIOS_E_DASHBOARD.md`](docs/WMS_ONDE_RELATORIOS_E_DASHBOARD.md) | Onde clicar para achar home e relatório de estoque | Confere o atalho; o conteúdo de cada relatório está na tela 5.9 |
| [`docs/EVOLUCAO_ATLAS_CARGO.md`](docs/EVOLUCAO_ATLAS_CARGO.md) | O que mudou em 25 e 26/11/2026 e o que ainda falta (suporte e pedido de apoio) | Diário, não manual |

O que não é manual de operação:

| Arquivo | Por que não usar como procedimento |
| --- | --- |
| [`docs/MEMORIAL_COMPLETO_ATLAS_CARGO_APRESENTACAO_CLIENTES.md`](docs/MEMORIAL_COMPLETO_ATLAS_CARGO_APRESENTACAO_CLIENTES.md) e os memoriais curtos | Texto de venda. O canal de mensagem descrito lá não é o que a tela chama hoje |
| [`docs/RF_WMS_ATLAS_v1.md`](docs/RF_WMS_ATLAS_v1.md) | Matriz de reunião. A coluna de decisão está vazia. Não diz o que a tela entrega |
| [`docs/PRODUTO_E_LOGO.md`](docs/PRODUTO_E_LOGO.md) | Produto em uma página e a troca da logo. Parado em 25/11/2026, antes do bolsão, do pedido de acesso e do registro de senha |
| Planos (`PLANO_*.md`, `WMS_BACKLOG_*.md`, `WMS_PLANO_TESTES_E2E_QA.md`) | Intenção e teste. Vários itens já estão na tela; outros não |
| Pilotos (`WMS_PILOTO_*.md`, `REGISTRO_CONFERENCIA_UBERLANDIA_20260722.md`, layouts OPL e NF-e) | Registro de uma carga e de um cliente. Não é o fluxo genérico |
| [`docs/PENDENCIAS_MELHORIAS.md`](docs/PENDENCIAS_MELHORIAS.md) | Lista de março de 2026 |

Não há manual do operador da torre, do cadastro, da convocação nem do app do motorista no mesmo nível do inventário. Até existir, a seção [Módulos e funções](#modulos-e-funcoes) é o catálogo.

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

## Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| API | Node.js e Express (`backend/server.js` sobe, `backend/app.js` monta as rotas) | Um processo serve o painel e a API |
| Banco | PostgreSQL `atlas_cargo_prd` | O dado operacional. A sessão do banco grava a hora de São Paulo; a tela mostra o fuso de Configurações |
| Painel | HTML, CSS e JavaScript em `backend/public/modulos` | Cada função do menu é uma página |
| Sessão | JWT | Torre e motorista. O tempo da sessão da torre vem do `.env` |
| Mapa | Serviço gravado em Configurações (geocodificação e rota) | O roteiro e o mapa de viagem não trazem chave no código |
| WhatsApp | Switch Digital | Um canal no tenant padrão |
| Empresas | `SAAS_CLIENTE_CONTRATANTE` e `MODULO_PRODUTO` | Plano, módulos e menu por produto |

---

## Pastas

```text
backend/server.js          sobe o processo e lê o .env
backend/app.js             rotas Express
backend/controllers/       torre, motorista e estoque
backend/services/          Switch Digital, bolsão, pedido de acesso, log de senha
backend/scripts/           SQL idempotente para banco que já existe
backend/public/modulos/    uma pasta por função do menu
backend/public/motorista/  app do motorista
backups/                   dump para banco novo
docs/                      planos, pilotos e o pouco de manual que existe
```

Uploads de CNH, CRLV, áudio e comprovante ficam em `backend/public/uploads` e não entram no Git.

---

## Licença

Uso interno da operação. Este repositório não traz senha, token nem documento de cliente.
