# Atlas Cargo — o que é, e a logo nova

Documento para quem vai desenhar a marca e para quem acompanha a repaginação. A cara da tela está em `docs/REPAGINACAO_ATLAS_CARGO.md`. Aqui fica o produto e o encaixe da logo.

Atualizado em 25/11/2026.

## Para que serve

O Atlas Cargo é o sistema da operação logística. A torre, o cadastro e o estoque ficam no mesmo painel. O motorista entra pelo app. Quem contrata a viagem não precisa juntar planilha, WhatsApp e sistema de frota para saber se a carga saiu.

Serve para uma transportadora ou um operador logístico que:

- monta viagem, escolhe veículo e motorista e acompanha até o fim;
- convoca motorista e precisa guardar quem aceitou, quem recusou e por quê;
- quer a torre (pendências, chat, alerta, SOS) no mesmo lugar do cadastro;
- opera estoque (receber, separar, expedir, inventariar) junto da carga.

Idioma da tela: português e espanhol. O banco desta máquina é o Postgres local `atlas_cargo_prd`. O painel abre em `http://localhost:8083/`.

## O que ele resolve

| Problema | O que o sistema faz |
| --- | --- |
| Viagem combinada no telefone e perdida no dia seguinte | A viagem fica registrada, com situação, rota, veículo e motorista |
| Convocação no WhatsApp sem histórico | O convite sai com link, e a resposta (aceite, recusa, motivo) volta para a viagem |
| Frota e motorista em cadastros soltos | Cadastro geral, veículo, marca, modelo, tipo e classe de frota no mesmo menu |
| Torre sem número | A home da Torre mostra viagens, pendências e convocações, e abre mapa, chat, alerta e SOS |
| Estoque separado da carga | Módulo de estoque: recebimento, separação, expedição, inventário, transferência e relatório |
| Cada um olhando uma planilha | O mesmo login vê o painel; o motorista usa o app (`/motorista`) |

## O que tem hoje

Três recortes no seletor do menu: Módulo Base, Torre Logística e Gestão Estoque.

**Torre e viagem**

- Gerenciar viagens: filtros, grid, dados, histórico, mapa, motoristas compatíveis, convocações, veículo, motorista, rastreamento, integração e macros.
- Mapa de viagem, tipo e situação de viagem, roteiro, tipo de ocorrência.
- Campanha de oportunidades.
- Convocações, alertas, chat, SOS e ranking.

**Cadastro e frota**

- Cadastro geral (motorista, transportador, contratante).
- Estado, mesorregião, cidade, tipo de validade.
- Veículo, marca, tipo, modelo, grupo e classe de frota.

**Estoque**

- Recebimento, separação, expedição, inventário, cargas, baixas, transferências, cobrança e relatórios.

**Quem usa**

- Operador da torre, no navegador.
- Motorista, no app (viagem, GPS, convocação, comprovante, SOS, chat).

A logo atual também aparece no favicon, no login e no app do motorista. Em Configurações dá para trocar o arquivo pelo nome `logoRetangular` e `logoQuadrada`, mas os dois arquivos de hoje são a mesma ilustração larga.

## Por que a logo atual não serve

O arquivo do menu é `backend/public/img/logoAtlasTransparente.png`.

- Mede 1416×463 pixels. É uma cena: globo, anel, caminhão e o nome, em cima de uma placa cinza escura com canto arredondado.
- O nome “transparente” não se cumpre. A placa faz parte do desenho. No menu claro ela vira um adesivo escuro. No escuro, some no fundo.
- A “quadrada” (`logoAtlasTransparenteQuadrada.png`, 1536×1024) também é larga. Não existe símbolo para o menu recolhido.
- O CSS ainda aplica sombra (`drop-shadow`) na imagem, o que deixa a placa mais pesada.

Não vale redesenhar a mesma cena menor. A placa, o globo e o caminhão competem com o nome, e o nome é o que a pessoa precisa ler numa faixa de 32 pixels de altura.

## Como a logo encaixa hoje

O menu aberto tem 250 pixels de largura (o `dashboard-adminlte.css` vence o `dashboard.css`, que pedia 260). A caixa da logo tem 14 pixels de respiro de cada lado e no máximo 56 pixels de altura.

| Estado | Largura do menu | Área útil da logo | Altura máxima da imagem |
| --- | --- | --- | --- |
| Aberto | 250 px | 222 px | 56 px |
| Recolhido | 57 px | cerca de 45 px | 44 px |

Uma arte de 3:1 (a atual, 1416/463) a 56 pixels de altura ocupa uns 171 pixels. Cabe aberta. Recolhida, a mesma arte é espremida: 44 pixels de altura pediriam 135 de largura, e a coluna só tem 57. Por isso ela fica ilegível com o menu fechado.

## O que fazer — a lógica do Deskcomm

O Deskcomm (`C:\DeskcommCRM`) não usa uma ilustração. Usa duas peças, em SVG, e a cor muda com o tema:

- Menu aberto: símbolo + nome. Altura 32 pixels (`h-8`). O desenho tem proporção 732×211, cerca de 3,5:1, então a largura fica em torno de 111 pixels. Folga dentro da faixa.
- Menu recolhido: só o símbolo, 32×32.
- Cores do tema, não uma placa: sage `#506d48` no claro e `#82a077` no escuro; o nome em `#1c1a16` / `#f5f4ef`.
- Se alguém sobe um PNG próprio, a altura de exibição é 28 pixels e a largura não passa de 160, sem esticar.

É essa lógica que cabe no Atlas. Duas peças, fundo vazio, cor que acompanha o claro e o escuro.

## Tamanho para desenhar

Desenhar em SVG. Se precisar de PNG, exportar em 2×, fundo transparente, sem placa e sem sombra.

| Peça | Onde aparece | Proporção | Tamanho na tela | Arquivo |
| --- | --- | --- | --- | --- |
| Logotipo | Menu aberto, login | 3,5:1 (720×206 ou 732×211) | 32 px de altura, no máximo 200 px de largura | `logoAtlasTransparente.png` (substitui o atual) e um SVG ao lado |
| Símbolo | Menu recolhido, favicon, app | 1:1 | 32×32 no menu; 32 e 180 no ícone | `logoAtlasTransparenteQuadrada.png`, de verdade quadrado, 512×512 |

O logotipo a 32 pixels de altura e 3,5:1 mede cerca de 112×32. Cabe nos 222 pixels úteis e ainda sobra. Não desenhar mais largo que 5:1: a 32 pixels de altura isso já passa de 160 e começa a brigar com a coluna.

Duas versões de cor, se a arte não for SVG:

- Clara, para o menu claro: símbolo sage `#506d48`, nome `#1c1a16`.
- Escura, para o menu escuro: símbolo `#82a077`, nome `#f5f4ef`.

SVG único é melhor: uma arte, a cor vem do tema, como no Deskcomm. PNG fixo pede as duas versões, senão o nome some num dos temas.

## O que a marca precisa dizer

- Nome legível: Atlas. “Cargo” pode ser o sufixo, menor e mais discreto, como o “CRM” do Deskcomm.
- Um símbolo só, que ainda se entenda a 32×32. Uma letra, um monograma ou uma forma simples. Não globo + anel + caminhão + placa.
- Tom de operação, não de desenho animado. Quem compra é quem roda frota e estoque.
- Sem fundo, sem cantoneira, sem sombra gravada no arquivo. O menu já tem a cor.

## Onde trocar quando a arte existir

| Uso | Arquivo de hoje |
| --- | --- |
| Menu aberto e login | `backend/public/img/logoAtlasTransparente.png` |
| Favicon e o que o sistema chama de quadrada | `backend/public/img/logoAtlasTransparenteQuadrada.png` |
| Cópia na raiz do repositório | `logo\` (os mesmos dois nomes) |
| Regra de tamanho no menu | `backend/public/css/dashboard.css`, classes `.logo` e `.logo-img` |

A primeira versão já está no menu, feita aqui em SVG (não passou por outra IA):

- Menu aberto: `backend/public/img/logo-atlas.svg` — símbolo sage + Atlas + Cargo.
- Menu fechado e favicon: `backend/public/img/logo-atlas-simbolo.svg`.
- A cor do menu vem do tema (`face-deskcomm.css`). A placa escura do topo saiu.

A ilustração antiga continua em `logoAtlasTransparente.png` até a troca definitiva. Se Configurações apontar outro arquivo, o painel usa esse arquivo no lugar do SVG.

## Tela de login

A coluna da esquerda do cartão (cartão de até 1120 px, duas colunas) mede cerca de 590×600 px na tela. No celular ela vira uma faixa de uns 280 px de altura.

Não precisa de um PNG nessa medida. A vitrine é desenhada na página (`backend/public/css/login-vitrine.css`): símbolo, uma rota (Torre), um caminhão (Frota) e caixas (Estoque). Uma palavra em cada cena.

Se ainda quiser uma arte pronta para colar no lugar:

| Peça | Na tela | Arquivo, se for PNG |
| --- | --- | --- |
| Painel esquerdo | cerca de 590×600 | 1200×1200, fundo sage `#f5f3ee` ou vazio, sem placa |

O formulário da direita continua o login. Embaixo ficam os links do motorista e **Cadastrar empresa**. O pedido pede país, documento e celular com DDI. Depois do envio a tela volta ao login. A liberação avisa esse número no WhatsApp, e a Atlas vê o selo em Tenants e módulos e recebe o aviso no celular da central. O detalhe está em `docs/EVOLUCAO_ATLAS_CARGO.md`.
