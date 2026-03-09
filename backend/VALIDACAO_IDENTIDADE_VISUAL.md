# Validação – Nova identidade visual (Atlas Cargo)

## Nomenclatura (ambas transparentes)

| Nome no sistema | Arquivo | Uso |
|-----------------|--------|-----|
| **Logo retangular** | `logoAtlasTransparente.png` | Login, sidebar, cabeçalhos |
| **Logo quadrada** | `logoAtlasTransparenteQuadrada.png` | Favicon, PWA, notificações |

Origem dos arquivos: `C:\gitHub\SysScopel\logo\` (copiar para `backend/public/img/` se necessário).

## Configuração no sistema

No módulo **Configurações do Sistema** (gerenciar-configuracoes) há a seção **Identidade visual (logos)**, onde é possível definir:

- **Logo retangular**: nome do arquivo em `/img/` (ex.: `logoAtlasTransparente.png`)
- **Logo quadrada**: nome do arquivo em `/img/` (ex.: `logoAtlasTransparenteQuadrada.png`)

Os valores são gravados na tabela `CONFIGURACAO` e aplicados no portal (login, dashboard), no App Motorista e no favicon.

## Ativos em public/img/

| Arquivo | Uso |
|--------|-----|
| `logoAtlasTransparente.png` | Logo retangular (padrão) |
| `logoAtlasTransparenteQuadrada.png` | Logo quadrada (padrão) |

---

## Já aplicado

| Onde | Arquivo/Referência | Status |
|------|--------------------|--------|
| **Portal – Login** | `index.html`: favicon + logo na tela de login | ✅ `logoAtlasTransparente.png` |
| **Portal – Dashboard** | `dashboard.html`: favicon + logo na sidebar | ✅ `logoAtlasTransparente.png` |
| **CSS** | `style.css` (login), `dashboard.css` (sidebar) | ✅ Estilos da identidade |

---

## Ajustado nesta validação (App Motorista)

O App Motorista ainda referenciava o logo antigo `logo7.png`. Todas as referências foram atualizadas para a nova identidade:

| Arquivo | Alteração |
|--------|-----------|
| `motorista/index.html` | Favicon e logo da tela inicial → `logoAtlasTransparente.png` |
| `motorista/manifest.json` | Ícone do PWA → `logoAtlasTransparente.png` |
| `motorista/sw.js` | Cache do Service Worker → `logoAtlasTransparente.png` |
| `motorista/sw-workbox.js` | Ícone de notificação push → `logoAtlasTransparente.png` |
| `motorista/js/notifications-service.js` | Ícone e badge de notificação → `logoAtlasTransparente.png` |
| `motorista/pages/js/chat.js` | Ícone e badge de notificação do chat → `logoAtlasTransparente.png` |

---

## Uso opcional dos outros ativos

- **logoQuadrada.jpeg**: usar em `manifest.json` como ícone quadrado (ex.: 192x192) se quiser ícone específico para “Add to Home Screen”. Hoje o manifest usa `logoAtlasTransparente.png` para manter consistência.
- **logoRetangular.jpeg**: usar em relatórios PDF, e-mails ou cabeçalhos onde caiba um logo horizontal.

---

## Referências antigas removidas

- `logo7.png` – não existe mais em `public/img/`; todas as referências foram trocadas por `logoAtlasTransparente.png`.

---

## Checklist final

- [x] Portal (login + dashboard): nova identidade aplicada
- [x] App Motorista: favicon, logo, manifest, SW e notificações atualizados
- [ ] (Opcional) Definir uso de `logoQuadrada.jpeg` e `logoRetangular.jpeg` em telas/relatórios específicos
