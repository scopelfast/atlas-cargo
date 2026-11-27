# Capturas reais — Inventário de Telas Atlas Cargo

Geradas em **27/11/2026** a partir de `http://localhost:8083/` (headless Playwright).

| Pasta | Conteúdo |
|---|---|
| `00-publico/` | Login, recuperar senha, cadastro empresa, convocação pública, dashboard, BI, mobile |
| `01-cadastros/` | Cadastro Geral, Estados, Mesorregião, Cidades, Tipos Validade (+ abas) |
| `02-equipamentos/` | Veículos, marcas, tipos, modelos, grupos, classes (+ abas) |
| `03-logistica/` | Viagens, tipos, situações, roteiros, ocorrências, campanhas |
| `04-gestao/` | Convocações, alertas, chat, SOS, ranking, mapa, logs |
| `05-wms/` | Painel e submódulos de estoque |
| `06-sistema/` | Usuários, tipos atividade, empresas, filiais, configs, tenants, WhatsApp |
| `07-atlas-pay/` | Atlas Pay e abas |
| `08-motorista/` | App motorista (login + páginas) |

Manifesto: `_manifest.json` (180 capturas iniciais; arquivos adicionais podem existir após reexecuções).

Reexecução (opcional): `node docs/inventario_telas/_capture_screenshots.mjs` (requer `playwright` instalado localmente).
