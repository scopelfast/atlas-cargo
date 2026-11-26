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
| 26/11 | No login da torre ficam duas portas: Sou motorista abre `/motorista/`. Cadastrar-se abre `/cadastro-empresa.html`. O link Cadastrar empresa saiu. O cadastro do motorista continua dentro do app. |
| 26/11 | Cadastro do motorista tem dois caminhos. O link da torre (`?empresa=`) nasce na empresa, inativo, e só ela vê. Sem empresa, cai no bolsão do `default`: as outras torres consultam, ligam a ficha sem segundo login, ou criam cadastro próprio com outro celular. |
| 26/11 | Recuperação de senha do motorista e do painel grava o que aconteceu. Configurações → Recuperação de senha, só no tenant padrão: WhatsApp enviado ou não, senha alterada ou não. Código e senha nova não entram no registro. |
| 26/11 | Pedido de acesso novo avisa o celular do cadastro do tenant padrão, pelo Switch do `default`. A fila Pedidos de acesso mostra se o aviso saiu ou o motivo da falha. |

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
| Link | No login da torre, “Cadastrar empresa” |
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

## Falta — WhatsApp do tenant padrão

A tela 9.4 Configurações → Switch / WhatsApp não tem recuperação de senha, suporte nem pedido de apoio. Ela guarda o canal: endpoint, método, token, fila, assinatura e teste. Não é uma lista de avisos.

O canal desses avisos é o do tenant padrão (`default`), o mesmo já usado no pedido de acesso da empresa. Não nasce uma segunda credencial.

| Aviso | Hoje | Para onde vai |
| --- | --- | --- |
| Recuperação de senha do motorista | A página segue o login: Celular, CPF ou CNPJ. O código sai no WhatsApp do celular do cadastro, pelo canal do `default` | Feito em 26/11 |
| Recuperação de senha do painel | O login da torre tem Esqueci minha senha em `/recuperar-senha.html`. O código sai no WhatsApp do celular ligado ao usuário, pelo mesmo canal | Feito em 26/11 |
| Suporte | Não existe | Mensagem pelo canal do `default` |
| Pedido de apoio | Não existe | Mensagem pelo canal do `default` |

Quando sair de falta para feito, o código de recuperação deixa de ficar só no log e a frase da tela deixa de prometer SMS ou e-mail.

### Como ficou a recuperação de senha

A página do motorista segue o login: Celular, CPF ou CNPJ. Um celular de 11 dígitos deixa de ser lido como CPF. O código de 6 dígitos vale 15 minutos e sai no WhatsApp do celular do cadastro, pelo tenant `default`. Se o token estiver vazio, a tela avisa e não finge que o código saiu.

O login da torre ganhou **Esqueci minha senha**, em `/recuperar-senha.html`. Vale o login, o nome ou o e-mail. O código vai no WhatsApp do celular do cadastro desse operador. Se o usuário não tem cadastro ligado, e é o contato da empresa, o código sai no celular desse cadastro.

Suporte e pedido de apoio continuam faltando. Usam o mesmo canal e precisam de um celular de destino da Atlas.
