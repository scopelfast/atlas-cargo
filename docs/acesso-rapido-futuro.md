# Acesso Rápido – planejamento futuro

Documento de referência para evoluir o **Acesso Rápido** do dashboard (Atlas Cargo).

## Situação atual

- **Lista fixa** no código: 4 programas (Gerenciar Viagens, Relatório de Convocações, Gerenciar Equipamentos, Logs de Acesso).
- **Não é personalizável** pelo usuário.
- **Não usa** “mais acessados”; não há contagem de acessos por módulo.
- **Limite de cards**: na prática sempre 4, pois a lista é fixa; o layout em grid se adapta à quantidade.

## Opções para implementar no futuro

1. **Lista padrão expansível**  
   Manter lista fixa, mas ampliável no código e definir um **limite máximo de cards** (ex.: 6 ou 8).

2. **Personalização por usuário**  
   - Backend: tabela de preferências (ex.: `usuario_id`, `programa`, `ordem`).  
   - Front: tela/modal “Configurar Acesso Rápido” (escolher módulos permitidos, ordenar, salvar).  
   - Definir **limite de cards** (ex.: 4, 6 ou 8).

3. **“Mais acessados” (automático)**  
   - Backend: registrar cada abertura de módulo (log ou tabela de contagem).  
   - Dashboard: buscar os N mais acessados do usuário e montar o Acesso Rápido.  
   - Definir **limite de cards** (ex.: 4 ou 6).

4. **Híbrido**  
   Ex.: “mais acessados” como padrão + opção de fixar/remover atalhos, com limite máximo de cards.

## Onde está no código

- **Front:** `backend/public/js/dashboard.js` – `showWelcomeScreen()`, array `availableQuickLinks`, montagem do HTML do Acesso Rápido.
- **Estilos:** `backend/public/css/dashboard.css` – `.dashboard-quick-links`, `.quick-links-grid`, `.quick-link-btn`.

---

*Criado para referência em trabalho futuro. Retomar quando for priorizado.*
