# Repaginação do Atlas Cargo

Acompanhamento do que estamos fazendo nesta máquina para colocar o sistema no ar e trocar a cara, com meta de vender ainda neste mês. A mudança é visual. Regra de negócio, banco e módulos continuam os mesmos.

Atualizado em 25/11/2026.

## Objetivo

- Sistema local no ar, com atalho para subir sem ocupar porta de outro produto.
- Uma cara só, no claro e no escuro, no padrão do Deskcomm (`C:\DeskcommCRM`): sage, cinza quente, Atkinson Hyperlegible.
- Home e qualquer item do menu com a mesma fonte, os mesmos botões e os mesmos cartões.

## O que já está no ar

| Item | Valor |
| --- | --- |
| Código | `C:\atlas-cargo` (clone de `scopelfast/atlas-cargo`) |
| Banco | PostgreSQL do Windows, porta 5432, banco `atlas_cargo_prd` (dump de 06/11/2026, 124 tabelas) |
| App | `http://localhost:8083/` |
| Atalho | `C:\Dev\atlas-cargo\Subir Atlas Cargo.lnk` |
| Comando | `powershell -ExecutionPolicy Bypass -File C:\Dev\atlas-cargo\subir.ps1` |
| Login local | `admin` / `admin` (só neste banco; a senha do dump foi trocada) |

A porta 8083 é só do Atlas Cargo. Não usar 3000 e 3001 (FastFrete), 8080 (Apache), 3010 (Atlas Go) nem 3002, 3003, 3040 e 3041 (Logistics OS). O mapa está em `C:\Dev\portas-em-uso.md`.

O `backend/.env` fica só nesta máquina e não entra no Git.

## Por que a tela mudava ao clicar no menu

A home e o módulo não compartilhavam o mesmo CSS.

- A casca carrega `dashboard.css`, `dashboard-adminlte.css` e `dark-mode.css`. Fonte Source Sans Pro, menu AdminLTE, acento azul.
- Cada módulo (`modulos/*/index.html`) injeta o próprio `<style>` depois. Fonte Plus Jakarta Sans, botão azul, botão verde, cartão branco ou slate.
- Vários desses estilos usam `!important` e, em Viagens, o id `#tab-grid`. Isso vencia a folha nova.

Por isso o anexo da home e o anexo de Tipos de Validade pareciam produtos diferentes. E por isso Gerenciar Viagens, no claro e no escuro, continuava com Filtrar azul e Novo verde.

## Padrão adotado (Deskcomm)

Tokens em `backend/public/css/face-deskcomm.css`. Claro e escuro são desenhados à parte, não um invertido do outro.

| Papel | Claro | Escuro |
| --- | --- | --- |
| Fundo | `#faf9f6` | `#161510` |
| Cartão | `#ffffff` | `#1d1c17` |
| Campo | `#f5f3ee` | `#272620` |
| Texto | `#1c1a16` | `#f5f4ef` |
| Texto secundário | `#5d594f` | `#8e8b7f` |
| Borda | `#e7e3da` | `#33312a` |
| Acento (Filtrar, Novo, aba ativa) | `#506d48` | `#82a077` |
| Sair | `#a94a3c` | `#c87263` |

Fonte: Atkinson Hyperlegible. O menu, no claro, fica no cartão claro. No escuro, no cartão escuro. Os dois deixam de usar a barra azul-marinho do AdminLTE.

## O que já entrou no código

- `backend/public/css/face-deskcomm.css` — cara nova, carregada por último.
- `backend/public/dashboard.html` — liga essa folha e a fonte.
- `backend/public/js/dashboard.js` — depois que o módulo injeta o CSS dele, a folha nova volta para o fim do `<head>`.
- Atalho e guias em `C:\Dev\atlas-cargo\`, `C:\Dev\README.md` e `C:\Dev\portas-em-uso.md`.

Para ver a cara nova: recarregar `http://localhost:8083/dashboard.html` (Ctrl+F5). O HTML pede o CSS com um número novo a cada abertura.

## O que os anexos de claro e escuro ainda mostravam

Gerenciar Viagens, 25/11 por volta de 10:41:

- Menu escuro nos dois temas (AdminLTE).
- Conteúdo branco no claro e slate no escuro.
- Filtrar azul (`#0ea5e9`) e Novo verde (`#059669`).

Isso é o CSS antigo do módulo, em especial `#tab-grid .btn-filtro-novo` com `!important`. A folha nova agora cobre esses botões, os campos e o cartão de filtros nos dois temas.

## Fora desta leva

- O login (`index.html`) já saiu da ilustração do globo. A coluna da esquerda é a vitrine em `login-vitrine.css`. O app do motorista ainda tem o próprio CSS.
- Mapa, gráfico e selo de status de um módulo podem guardar uma cor antiga até a próxima passagem.
- Uploads (CNH, áudio, comprovante) não vieram no Git.

## Como retomar

1. Subir pelo atalho em `C:\Dev\atlas-cargo` se a 8083 estiver fechada.
2. Abrir o painel, alternar claro e escuro, e comparar a home com Gerenciar Viagens e com um cadastro (Tipos de Validade).
3. A aba ativa, Filtrar e Novo devem ser sage nos dois temas. Limpar fica só com borda.
4. O cadastro da empresa (pedido e liberação) e o do motorista estão em `docs/EVOLUCAO_ATLAS_CARGO.md`.

A logo e o que o produto é estão em `docs/PRODUTO_E_LOGO.md`. O acompanhamento do que entra e do que falta está em `docs/EVOLUCAO_ATLAS_CARGO.md`.
