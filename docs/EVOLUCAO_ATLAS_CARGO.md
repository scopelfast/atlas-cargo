# Evolução do Atlas Cargo

O que já mudou nesta máquina e o que ainda falta. Atualizar este arquivo quando um item sair de “falta” para “feito”.

Atualizado em 26/11/2026.

Como subir e o padrão visual: `docs/REPAGINACAO_ATLAS_CARGO.md`. Produto e logo: `docs/PRODUTO_E_LOGO.md`.

## Feito

| Quando | O quê |
| --- | --- |
| 25/11 | Sistema local em `http://localhost:8083/`, banco `atlas_cargo_prd`, atalho em `C:\Dev\atlas-cargo`. Login local `admin` / `admin`. |
| 25/11 | Cara do painel no padrão Deskcomm, claro e escuro (`face-deskcomm.css`). |
| 25/11 | Logo nova no menu: símbolo + Atlas Cargo aberto, só o A fechado. A imagem quebrada ao lado do nome saiu. |
| 25/11 | Menu recolhido: o painel que abre ao lado usa a cor do tema, não a placa cinza do AdminLTE. |
| 25/11 | Login sem o globo. Coluna esquerda mostra Torre, Frota e Estoque em desenho. Links “Sou motorista” e “Cadastrar-se”. |
| 25/11 | Menu Alertas: a linha não fica mais rosa. O número fica num selo de 18 px, também no menu fechado. |
| 25/11 | Empresa pede acesso em `/cadastro-empresa.html`. A fila fica em Tenants e módulos → Pedidos de acesso. |
| 25/11 | O cadastro da empresa tem idioma, país, DDI, máscara e validação do documento e do celular. Pedido, liberação e recusa avisam esse celular no WhatsApp. |
| 25/11 | Login e cadastro do motorista saíram do globo e do verde-água. Usam a marca nova e as cores sage. |
| 25/11 | O quadro esquerdo do login virou o painel: torre, convocações, viagens e estoque. |
| 26/11 | Planilha de motoristas no 1.0.Cadastro Geral: Baixar modelo e Importar. Celular é a chave. Célula vazia não apaga. Nome e celular já entram na campanha. O login do app fica pendente. |
| 26/11 | No login do motorista a pessoa escolhe Celular, CPF ou CNPJ. A máscara muda com a opção. Em espanhol, a escolha é Celular ou Documento. |
| 26/11 | No login da torre (`index.html`): **Sou motorista** → `/motorista/`; **Cadastrar-se** → `/cadastro-empresa.html` (pedido de acesso da empresa). O cadastro do motorista continua em `/motorista/pages/cadastro.html`. |
| 26/11 | Cadastro do motorista tem dois caminhos. O link da torre (`?empresa=`) nasce na empresa, inativo, e só ela vê. Sem empresa, cai no bolsão do `default`: as outras torres consultam, ligam a ficha sem segundo login, ou criam cadastro próprio com outro celular. |
| 26/11 | Recuperação de senha do motorista e do painel grava o que aconteceu. Configurações → Recuperação de senha, só no tenant padrão: WhatsApp enviado ou não, senha alterada ou não. Código e senha nova não entram no registro. |
| 26/11 | Pedido de acesso novo avisa o celular do cadastro do tenant padrão, pelo Switch do `default`. A fila Pedidos de acesso mostra se o aviso saiu ou o motivo da falha. |
| 26/11 | Atlas Pay fases 1 e 2: contrato financeiro versionado (`FIN_*`), cobrança de conexão na confirmação da convocação (regra desligada por padrão), cancelamento na reativação e no desistir lote, baixa manual, API `/api/financeiro`, menu 9.7 `atlas-pay`. UI no padrão dos módulos (abas com ícones, `filtros-box`, Limpar/Filtrar/Novo, overlay com yield, dark mode). Script `backend/scripts/financeiro_atlas_pay_postgres.sql`. Sem Pix e sem bloqueio. Detalhe: `docs/ATLAS_PAY.md`. |
| 26/11 | Auditoria pré-homologação Atlas Pay: `docs/RELATORIO_AUDITORIA_PRE_HOMOLOGACAO_ATLAS.md` (DDL incompleto no `script_db`, constraints dentro de `CREATE IF NOT EXISTS`, permissões, testes SKIP, dumps no Git). Sem alteração de código/banco. |
| 26/11 | *(histórico)* Plano P0 preparado (só documento). **Superado** pelo apply local no mesmo dia. |
| 26/11 | *(histórico)* Revisões P0/P0.2 e GO scratch PG14+PG18 (20/20 + D13). Na época: **ainda sem apply** em `atlas_cargo_prd`. **Superado** pelo apply HML operacional. |
| 26/11 | *(histórico)* Preparação operacional: `.env` apontava `atlas_cargo_prd`; HML isolado inexistente. **Superado** — local autorizado como HML operacional. |
| 26/11 | *(histórico)* P1 código + SQL revisado; script **ainda não aplicado**. **Superado** pelo apply + bootstrap. |
| 26/11 | P1 **aplicado e validado** em `atlas_cargo_prd`: backup `atlas_cargo_prd_pre_p1_permissoes_20261126_160511.dump`; SHA-256 `E120E07F…D4B0`; bootstrap `admin`/`default` → **STRICT**; auditoria gravando; unitário **23/23**; integrados OK. |
| 26/11 | P0 **aplicado e validado** em `atlas_cargo_prd`: backup `atlas_cargo_prd_pre_p0_constraints_20261126_161213.dump`; SHA-256 SQL `5AB0CF5E…C54D`; COMMIT + idempotência; D13 PASS; regressão OK. Sem DROP ROLE. Produção externa pendente (checklist item 11). |
| 26/11 | Atlas Pay **P2**: 5 SKIP fechados → fases 1–2 **21 PASS / 0 FAIL / 0 SKIP**; P1 **23/23**; regra `default` = **N**. (Resíduo `atlas-pay-p2-test` existiu até 27/11 — removido no HML.) |
| 26/11 | Fechamento documental P0+P1+P2: `docs/ATLAS_PAY.md` consolidado (endpoints incl. cancelar); recuperação de senha WhatsApp alinhada como **feita**. |
| 26/11 | Atlas Pay **Fase 3** (uso): fechamento periódico, D5 `America/Sao_Paulo`, geração explícita de cobrança; correções finais fuso + HTTP 403 FIN_*; testes **32/0/0**. |
| 26/11 | Atlas Pay **Fase 4** (inadimplência): **CONCLUÍDA E VALIDADA TECNICAMENTE NO AMBIENTE LOCAL** — regra definitiva (ABERTA não vencida → warning; 403 só vencida+BLOQUEIO); fail-open com warning; testes F4 **29/0/0** + regressão F3/P2/P1. Doc: `docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md`. Produção externa não autorizada. |
| 27/11 | Atlas Pay **Fases 1–4 ENCERRADAS no HML local**: D-01 (remoção motorista cancela CONEXAO se CONFIRMADA) + D-02 (origem TORRE/MOTORISTA); suíte D-01/D-02 **16/0**; homologação UI **13/13**; regressão P2/P1/F3/F4 verdes. Doc: `docs/ATLAS_PAY_FECHAMENTO_FASES_1_A_4.md`. Pix/Fase 5 não iniciada. |

## Login, o que a imagem precisaria ter

A vitrine já está desenhada na página, então não depende de outra IA. Se um dia for um arquivo no lugar do desenho: cerca de 590×600 px na tela, exportar 1200×1200, fundo `#f5f3ee` ou vazio, sem placa e sem a cena do globo.

## Cadastro do motorista

Já existe. Não estava no login da torre, por isso não aparecia.

| O quê | Onde |
| --- | --- |
| App do motorista | `http://localhost:8083/motorista/` |
| Cadastro sem login | `http://localhost:8083/motorista/pages/cadastro.html` |
| O que ele envia | Dados, documento e pelo menos um veículo |
| Quem libera | A empresa, no painel. O badge “Motoristas pendentes” já conta quem espera |
| Link novo | No login da torre, embaixo do formulário |

O login (`/motorista/`) e o cadastro (`/motorista/pages/cadastro.html`) já usam a marca nova e o sage. O painel, depois do login, também: creme, sage e Atkinson, sem o verde-água.

## Cadastro da empresa

A empresa pede o tenant por fora. Quem já opera vê a fila e libera.

| O quê | Onde |
| --- | --- |
| Página pública | `http://localhost:8083/cadastro-empresa.html` |
| Link | No login da torre, “Cadastrar-se” |
| Fila | Menu Sistema → Tenants e módulos, aba **Pedidos de acesso** |
| Ao liberar | Pede um identificador curto e confirmado (não usa o nome jurídico inteiro). Nasce o cliente (`SAAS_CLIENTE_CONTRATANTE`), o usuário com a senha que a empresa escolheu, e as atividades de quem liberou, sem Tenants e sem Tipos de Atividade |
| Ao recusar | O pedido fica recusado. A senha não aparece na fila |
| Idioma | Português e espanhol, a mesma escolha do login |
| Documento | Brasil confere o CNPJ. Paraguai, o RUC. Argentina, o CUIT. Uruguai, o RUT. A máscara acompanha o país |
| Celular | DDI do país. No Brasil, DDD separado e número `9XXXX-XXXX`. Número inválido não entra |
| WhatsApp | Três avisos no celular do pedido: recebido, liberado e recusado. Sai pelo Switch Digital do tenant padrão. A senha não vai na mensagem. Se o canal não estiver configurado, o pedido segue e a fila mostra “Canal não configurado” |
| Depois do pedido | A tela volta ao login e deixa o aviso “Pedido enviado” |
| Aviso da Atlas | O menu Tenants e módulos ganha o selo com a quantidade pendente. O topo do painel e a tela inicial mostram a mesma quantidade e abrem Pedidos de acesso. O WhatsApp do pedido novo sai para o celular do cadastro do tenant padrão, pelo Switch do `default`. A fila mostra se esse aviso foi enviado ou por que falhou. A hora do pedido aparece no fuso de Configurações |
| Cadastro do cliente | A aba Clientes mostra a empresa inteira e tem Editar. Documento, contato, e-mail e celular entram no cadastro. Plano, limites, salvar e excluir continuam |
| Limpeza de teste | Aba Limpeza de teste em Tenants e módulos, só para o dono. Cada tabela se marca à parte. Filho que trava o pai entra junto. O contador volta a 1 só se a tabela ficar vazia |
| Excluir cliente | Excluir o cliente apaga o identificador inteiro: ficha, pedido de acesso, usuários, cadastros, configuração, torre e estoque. Instalação padrão, cidades e estados ficam |
| Consulta de documento | CNPJ e CEP preenchem razão, endereço, e-mail e telefone (BrasilAPI, CEP também pelo ViaCEP). Cadastro Geral, Empresas, Filiais, dono do estoque, cliente SaaS e o pedido público. CPF só valida: nome de pessoa física não é público |
| Tipo Empresa licenciada | No Cadastro Geral, separa a empresa do Atlas de quem contrata o motorista da viagem. Gerenciar Classes só aparece depois de salvar, e só para motorista, transportador, agente ou grupo |
| Cliente no cadastro | A opção Cliente grava a própria marca e volta marcada ao abrir. Endereços de entrega só aparecem com Cliente marcado, pessoa jurídica e cadastro já salvo |
| Link da convocação | `/convocacao` usa a marca, o sage e a Atkinson. O celular da confirmação entra com máscara. A rota mostra a distância programada em km |
| Login do app | No app do motorista, a pessoa escolhe Celular, CPF ou CNPJ. A máscara muda com a opção. Em espanhol, a escolha é Celular ou Documento |

O motorista continua no app (`/motorista/pages/cadastro.html`). Não é o mesmo cadastro.

## Cadastro do motorista e a empresa

Quem abre o link sem empresa entra no bolsão do Atlas (`default`). A ficha fica inativa até a torre padrão liberar o aplicativo. As outras torres veem essa pessoa no Cadastro Geral, marcada como Bolsão, e não alteram nome, documento nem celular.

| Caminho | O que acontece |
| --- | --- |
| Link da torre | No Cadastro Geral, **Link do motorista** copia `/motorista/pages/cadastro.html?empresa=` com o tenant de quem está logado. A ficha nasce nessa empresa. |
| Bolsão | Sem `empresa` no endereço. Todas as torres consultam. **Usar** grava a ligação em `CADASTRO_TENANT_VINCULO`. Campanha dessa torre passa a incluir a pessoa. Senha e celular continuam na ficha do Atlas. |
| Cadastro próprio | Outro celular, obrigatório. Nasce um cadastro só daquela empresa. O mesmo celular do bolsão não vira um segundo login. |

Quem já tem o banco roda `backend/scripts/cadastro_tenant_vinculo_postgres.sql`. A tabela também é criada na primeira consulta.

## Atlas Pay — estado vigente (local)

| Fase | Situação | Próximo passo |
| --- | --- | --- |
| P0 constraints | **ATIVO** no `atlas_cargo_prd` local | Autorização específica para produção externa |
| P1 permissões | **ATIVO** STRICT (`admin` = `FINANCEIRO_ADMIN`) | Anti-elevação HTTP com 2º usuário: opcional histórico (já coberto em unitário `canGrantProfile`) |
| P2 testes | **FECHADO** — 21/0/0 + P1 23/0; regra `default` = **N** | — |
| Pix / gateway | Só baixa manual | Integração bancária (nova fase) |
| Uso da plataforma (Fase 3) | **CONCLUÍDA** (26/11) — D5 SP + HTTP 403 FIN_* | `docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md`; testes 32/0/0 |
| Inadimplência (Fase 4) | **ENCERRADA no HML** (27/11) com Fases 1–3 | `docs/ATLAS_PAY_FECHAMENTO_FASES_1_A_4.md`; F4 29/0/0; D-01/D-02 16/0; UI 13/13 |
| Cobrança dos agentes (pós F1–4) | **Etapa 0 feita 27/11** | Seletor de agente no 9.7 (`default`); demais etapas em `docs/ATLAS_PAY_EVOLUCAO_AGENTES.md` |
| 27/11 | HML SaaS limpo: removidos fixtures `atlas-pay-*` (f3/f4/d01/p2). Clientes: `default`, `cleverson-scopel`. |
| Pix / gateway (Fase 5) | **Não iniciada** | Conta sandbox + proposta; só após piloto de agentes OK |

## WhatsApp do tenant padrão

A tela Configurações → Switch / WhatsApp guarda o **canal** (endpoint, método, token, fila, assinatura e teste) e o **destino Atlas** (`whatsapp_destino_suporte`). O canal é o do tenant `default`; não nasce segunda credencial.

| Aviso | Situação |
| --- | --- |
| Recuperação de senha do motorista | **Feito (26/11)** — código no WhatsApp do celular do cadastro, canal `default` |
| Recuperação de senha do painel | **Feito (26/11)** — `/recuperar-senha.html`; código no WhatsApp do celular ligado ao operador (ou contato da empresa) |
| Suporte | **Feito (26/11)** — painel (ícone Ajuda) e app motorista (Configurações); API `/api/apoio/*` |
| Pedido de apoio | **Feito (26/11)** — mesmo canal; tipos OPERACIONAL / TECNICO / FINANCEIRO / OUTRO |

### Como ficou a recuperação de senha

Motorista: escolha Celular, CPF ou CNPJ; celular de 11 dígitos não é lido como CPF; código de 6 dígitos vale 15 minutos e **sai no WhatsApp** pelo tenant `default`. Se o token do canal estiver vazio, a tela avisa e não finge envio. O log de Configurações → Recuperação de senha registra se o WhatsApp saiu ou não; **código e senha nova não entram no registro**.

Torre: **Esqueci minha senha** em `/recuperar-senha.html` (login, nome ou e-mail). O código vai no WhatsApp do celular do cadastro do operador (ou do contato da empresa, se não houver cadastro ligado).

### Suporte e pedido de apoio

- Envio pelo Switch Digital do tenant `default` (mesmo token/canal).
- Destino: `CONFIGURACAO.whatsapp_destino_suporte` (tenant `default`) ou fallback `TELEFONE_SUPORTE` no `.env`. Sem destino → mensagem clara + log de falha.
- Tenant de origem sempre da sessão (body não altera).
- Log em `APOIO_WHATSAPP_LOG` (sucesso/falha, máscara do destino, sem token). Deduplicação 120s.
- Script: `backend/scripts/apoio_whatsapp_log_postgres.sql`. Teste: `node backend/scripts/test_apoio_whatsapp.js`.

**Ativação operacional (26/11, `atlas_cargo_prd` local):** canal Switch do `default` **ok** (endpoint oficial, método POST, token preenchido, userId/queueId presentes). `whatsapp_destino_suporte` = **vazio**; `TELEFONE_SUPORTE` = **vazio**. Destino mantido vazio (não inventado). Teste E2E de envio painel/motorista **não executado** — bloqueado até a Atlas informar o número.
