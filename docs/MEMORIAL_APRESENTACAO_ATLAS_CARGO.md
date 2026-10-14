# Memorial para apresentação — Atlas Cargo (SysScopel)

Documento enxuto para montar slides (PPT) e alimentar uma IA de imagens. **Produto comercial no front:** *Atlas Cargo*; repositório/código: *SysScopel*.

---

## Frase de abertura (slide título)

**Atlas Cargo conecta a torre de operações ao motorista na estrada — em um só ecossistema: cadastros, viagens, mapa, convocações, chat, alertas, SOS e reputação.**

---

## O que é (30 segundos)

Plataforma **web** para **gestão de transporte de cargas**: cadastros mestre, planejamento de viagens, acompanhamento geográfico, comunicação em tempo quase real e segurança operacional. Inclui **aplicativo / PWA do motorista** alinhado ao mesmo backend (Node.js + API REST + tempo real).

---

## Pilares do produto (4 blocos)

| Pilar | O que entrega |
|--------|----------------|
| **Gestão** | Empresas, filiais, cadastro geral (clientes, transportadores, motoristas), frota (marcas, grupos, tipos, modelos, classes, equipamentos). |
| **Operação** | Viagens, situações e tipos de viagem, roteiros com pontos georreferenciados, mapa de viagem, relatório de convocações. |
| **Campo** | App motorista: login, convocações, cargas, viagens em andamento, GPS, macros/ocorrências, comprovante de entrega (POD), notificações. |
| **Confiança** | Chat torre–motorista, módulo de alertas configuráveis, SOS, ranking/reputação, logs de acesso, autenticação JWT, modo escuro e idiomas (ex.: PT / ES). |

---

## Funcionalidades em destaque (para “surpreender” no pitch)

1. **Roteiros vivos no mapa** — Pontos com origem, passagem, destino e paradas; apoio a **geocodificação** e **cálculo de rotas/distâncias** (OSRM com fallback), integrando o operacional ao mundo real, não só planilha.
2. **Convocações com fluxo digital** — Da torre ao motorista, com histórico e relatórios; integração com ecossistema de mensageria onde o produto evolui (ex.: Meta/WhatsApp em fluxos de convocação — conforme configuração do ambiente).
3. **Uma central que “enxerga” a operação** — Mapa de viagem, indicadores no dashboard, atalhos para **chat**, **alertas** e **SOS** no topo da interface.
4. **Motorista como protagonista** — Mesma base de dados: menos telefone solto, mais rastreio, resposta a convocação e registro de eventos no percurso.
5. **Segurança e governança em construção** — JWT, políticas HTTP (Helmet/CSP), caminho claro para **SaaS multi-tenant** (documentado no repositório) para escalar com isolamento de dados.

---

## Para quem é

- **Transportadoras e operações de frota** que precisam padronizar cadastro, viagem e comunicação.
- **Centrais** que coordenam muitos motoristas e querem **visibilidade** (mapa, alertas, SOS) sem trocar de ferramenta a cada etapa.

---

## Stack (slide técnico — opcional)

- **Backend:** Node.js, Express, PostgreSQL, JWT, Socket.io (tempo real).
- **Web torre:** HTML/CSS/JS modular (dashboard + módulos em `public/modulos`).
- **Motorista:** páginas web dedicadas + APIs `/api/motorista`.

---

## Roteiro sugerido de slides (10–12)

1. Título + tagline  
2. Problema: operação fragmentada (planilha + rádio + WhatsApp solto)  
3. Solução: Atlas Cargo em uma frase  
4. Torre: cadastros e gestão de frota (print ou ilustração)  
5. Operação: viagens + roteiros + mapa  
6. Convocações e relatório  
7. Motorista no celular (POD, GPS, convocações)  
8. Chat + alertas + SOS (ciclo fechado torre–campo)  
9. Ranking / reputação (cultura de qualidade)  
10. Segurança e evolução (JWT, roadmap SaaS)  
11. Fechamento: próximo passo / contato  

---

## Prompts para IA de imagens (copiar por slide)

Use no Midjourney, DALL·E, Ideogram, etc. Ajuste “Atlas Cargo” no texto da imagem só se a ferramenta permitir logo limpo.

| # | Ideia do slide | Prompt sugerido (inglês costuma funcionar melhor nas IAs) |
|---|----------------|------------------------------------------------------------|
| 1 | Capa premium | *Minimal corporate hero, logistics technology, semi truck and digital network lines, deep blue and emerald accents, dark background, no readable text, cinematic lighting, 16:9* |
| 2 | Caos operacional | *Split scene: messy spreadsheets and paper maps on one side, calm dashboard UI silhouette on the other, metaphor illustration, flat modern style, 16:9* |
| 3 | Visão única | *Isometric command center with large wall map, operators at desks, trucks on routes as glowing paths, clean vector 3D, professional, 16:9* |
| 4 | Cadastro / frota | *Fleet management abstract: rows of truck icons, gear and database cylinders, soft gradients, enterprise SaaS illustration, 16:9* |
| 5 | Mapa e roteiro | *GPS route on stylized map of South America outline subtle, winding path from origin to destination pins, night mode UI colors, 16:9* |
| 6 | Convocações | *Smartphone notification bubble + highway in background, friendly driver silhouette, green check and clock icons, modern illustration, 16:9* |
| 7 | App motorista | *Hand holding smartphone in truck cabin, dashboard blurred, app UI mockup abstract (no real logos), daylight, photorealistic, 16:9* |
| 8 | Chat tempo real | *Chat bubbles connecting office tower building to moving truck, dotted signal line, blue and teal, isometric, 16:9* |
| 9 | SOS / segurança | *Emergency alert beacon on map pin, ambulance subtle in distance, serious but hopeful palette, editorial illustration, 16:9* |
| 10 | Ranking | *Podium with three trucks as trophies, stars and upward chart, gamification but professional, 16:9* |
| 11 | Fechamento | *Sunrise over highway, single truck heading forward, text space on left third, inspirational corporate photo style, 16:9* |

---

## Mensagem final (último slide)

**Atlas Cargo não é só um cadastro — é o fio condutor entre a decisão na torre e a execução na estrada, com dados, mapa e pessoas no mesmo lugar.**

---

*Memorial derivado da estrutura do repositório (dashboard, módulos em `backend/public/modulos`, APIs em `backend/routes`, app motorista em `backend/public/motorista`). Ajuste números de módulos ou integrações conforme o contrato comercial da sua empresa.*
