# Evolução do Atlas Cargo

O que já mudou nesta máquina e o que ainda falta. Atualizar este arquivo quando um item sair de “falta” para “feito”.

Atualizado em 25/11/2026.

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
| Aviso da Atlas | O menu Tenants e módulos ganha o selo com a quantidade pendente. O topo do painel e a tela inicial mostram a mesma quantidade e abrem Pedidos de acesso. O WhatsApp sai para o celular da central quando a sessão do Switch Digital está no ar |
| Cadastro do cliente | A aba Clientes mostra a empresa inteira e tem Editar. Documento, contato, e-mail e celular entram no cadastro. Plano, limites, salvar e excluir continuam |
| Limpeza de teste | Aba Limpeza de teste em Tenants e módulos, só para o dono. Cada tabela se marca à parte. Filho que trava o pai entra junto. O contador volta a 1 só se a tabela ficar vazia |
| Excluir cliente | Excluir o cliente apaga o identificador inteiro: ficha, pedido de acesso, usuários, cadastros, configuração, torre e estoque. Instalação padrão, cidades e estados ficam |
| Consulta de documento | CNPJ e CEP preenchem razão, endereço, e-mail e telefone (BrasilAPI, CEP também pelo ViaCEP). Cadastro Geral, Empresas, Filiais, dono do estoque, cliente SaaS e o pedido público. CPF só valida: nome de pessoa física não é público |
| Tipo Empresa licenciada | No Cadastro Geral, separa a empresa do Atlas de quem contrata o motorista da viagem. Gerenciar Classes só aparece depois de salvar, e só para motorista, transportador, agente ou grupo |
| Cliente no cadastro | A opção Cliente grava a própria marca e volta marcada ao abrir. Endereços de entrega só aparecem com Cliente marcado, pessoa jurídica e cadastro já salvo |
| Link da convocação | `/convocacao` usa a marca, o sage e a Atkinson. O celular da confirmação entra com máscara. A rota mostra a distância programada em km |
| Login do app | No app do motorista, o campo aceita CPF ou CNPJ. Até 11 dígitos fica `000.000.000-00`; com 14, `00.000.000/0000-00`. Dígito errado não entra |

O motorista continua no app (`/motorista/pages/cadastro.html`). Não é o mesmo cadastro.
