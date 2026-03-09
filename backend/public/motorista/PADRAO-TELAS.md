# Padrão das telas – App Motorista

Toda página interna do motorista **deve** seguir este layout para ficar igual em todas as telas.

## 1. CSS (sempre nesta ordem)

```html
<link rel="stylesheet" href="../css/design-system.css">
<link rel="stylesheet" href="../css/style.css">
<link rel="stylesheet" href="../css/padrao-telas.css">
```

## 2. Body

```html
<body class="motorista-page">
```

## 3. Navbar (uma única barra no topo)

Ordem: **Voltar** | **Ícone (título)** | **Status** (à direita). Não usar faixa de status separada em cima. **Não** colocar texto no título (apenas ícone Boxicons no `h1`).

```html
<div class="navbar">
  <button class="btn-voltar" onclick="voltar()">← Voltar</button>
  <h1><i class="bx bx-map"></i></h1>
  <div id="statusIndicador" class="status-badge-navbar status-online">Online - Sincronizado</div>
</div>
```

- **Título:** só ícone no `h1` (ex.: `<i class="bx bx-map"></i>`), sem texto, para manter todas as telas iguais.
- **Badge:** texto "Online - Sincronizado" (ou "Carregando...", "Offline" conforme estado). **Nunca** usar emoji (🟢/🔴) no badge; o ponto colorido é desenhado via CSS no `padrao-telas.css`.
- Manter `id="statusIndicador"` para o offline.js atualizar Online/Offline.
- Se a página tiver outro botão na navbar (ex.: atualizar), colocar **antes** do status: o status fica sempre à direita.

## 4. Conteúdo

```html
<div class="container">
  <!-- conteúdo: cards, listas, formulários -->
</div>
```

## 5. Não fazer

- Não usar `<div class="status-bar">` em cima da navbar (status vai **dentro** da navbar).
- Não colocar estilos inline na navbar ou no btn-voltar; usar só as classes do `padrao-telas.css`.
- Não sobrescrever `.navbar` ou `.btn-voltar` no `<style>` da página, a não ser que seja realmente necessário (evitar).

## 6. Resumo

| Elemento      | Classe / ID              | Onde fica |
|---------------|--------------------------|-----------|
| Barra topo    | `.navbar`                | Uma única barra: voltar + título + status |
| Voltar        | `.btn-voltar`            | Dentro da navbar |
| Título        | `h1` com `<i class="bx bx-*">` só (sem texto) | Dentro da navbar (flex: 1) |
| Status        | `#statusIndicador` + `.status-badge-navbar` | Dentro da navbar, à direita |
| Conteúdo      | `.container`             | Abaixo da navbar |

Seguindo isso, todas as páginas ficam com a **mesma cara** (como a tela de SOS).
