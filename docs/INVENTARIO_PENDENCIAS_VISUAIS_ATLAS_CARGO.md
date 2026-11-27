# Inventário de Pendências Visuais — Atlas Cargo

**Data:** 27/11/2026  
Somente documentação. Nenhum problema abaixo foi corrigido nesta etapa.

## Separação visual × funcional

| Item | Tipo | Situação | Evidência |
|---|---|---|---|
| Ranking | Funcional + visual | INCOMPLETA | Placeholder “módulo em construção”; captura `04-gestao/ranking.png` |
| Painel Estoque | Funcional parcial | PARCIAL | Hub de cards sem API própria; `05-wms/painel-estoque.png` |
| BI stubs | Funcional parcial | PARCIAL | Redirects `bi-*.html` |
| Manutenção / pneus / combustível | Funcional | NÃO IMPLEMENTADA | Sem pastas/telas |
| Pix Atlas Pay | Funcional | NÃO IMPLEMENTADA | Fase 5 não iniciada |
| App motorista (várias páginas) sem sessão | Funcional observação | PARCIAL | Capturas mostram UI/redirect; fluxos logados NÃO totalmente exercitados |
| Chat torre dark mode dedicado | Visual | Pendência possível | Depende do shell; CSS dark próprio do módulo não evidenciado como nos demais |
| Inconsistência de padrões de abas/botões entre módulos antigos e novos | Visual | Pendência de padronização | Redesign previsto em `REDESIGN_ATLAS_CARGO_RECOMENDACOES.md` |
| Overlay/filtros | Visual | Em evolução | Padrão oficial: Situações de Viagem (botões) e Cidades (overlay) — nem todos os módulos estão 100% alinhados |
| Mobile torre (módulos internos) | Visual | Gap | Captura mobile feita no login; módulos torre capturados em 1440×900 — responsividade completa NÃO IDENTIFICADA tela a tela |
| Tema escuro login | Visual | Capturado | `00-publico/login-torre-escuro.png` + claro + mobile |

## Problemas visuais observados (não corrigidos)

1. Densidade alta em módulos grandes (Viagens, Cadastro Geral, Relatórios WMS) — muitas abas e painéis no primeiro viewport.  
2. Ranking quebra a expectativa do menu 4.4 (entrada existe, produto não).  
3. Hub Estoque parece “menu dentro do menu”, diferente do padrão Filtros/Grid/Dados.  
4. App motorista: páginas GPS/ajuda/diagnóstico com hierarquia visual menos uniforme que dashboard/convocações.  
5. Documentação/manual WMS HTML interno (`estoque/manual-operacional-wms.html`) é conteúdo, não tela de operação — não confundir com módulo.

## Problemas funcionais observados (não corrigidos)

1. Ranking sem backend.  
2. Três atividades WMS de liberação sem tela dedicada (OK como permissão, mas o menu pode confundir).  
3. Capacidade de tanque em Equipamentos não implica gestão de combustível.  
4. Macro “Abastecimento” ≠ módulo de combustível.  
5. Sessão motorista não foi usada nas capturas autenticadas do app — validação profunda de SOS/POD/GPS logado fica como **NÃO IDENTIFICADO** nesta rodada.

## Fora de escopo desta etapa
- Não redesenhar, não padronizar CSS, não implementar Ranking/Pix/manutenção.  
- Produção externa permanece não autorizada para mudanças Atlas Pay.
