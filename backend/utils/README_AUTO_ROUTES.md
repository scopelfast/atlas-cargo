# 🚀 Sistema Automático de Rotas HTML

## 📋 O que é?

Sistema que **detecta automaticamente** todos os arquivos HTML na pasta `public/` e cria rotas Express automaticamente. **Não precisa mais adicionar rotas manualmente!**

## ✨ Benefícios

- ✅ **Zero configuração manual** - Adicione um arquivo HTML e a rota é criada automaticamente
- ✅ **Escalável** - Funciona com qualquer número de projetos/páginas
- ✅ **Mantém organização** - Rotas seguem a estrutura de pastas
- ✅ **Rotas especiais** - Suporta rotas customizadas quando necessário

## 🔧 Como Funciona

### Estrutura de Pastas → Rotas

```
public/
├── index.html              → / (raiz) e /login
├── dashboard.html          → /dashboard
├── teste-mobile.html       → /teste-mobile
├── convocacao.html         → /convocacao/:id (rota especial)
└── modulos/
    └── gerenciar-equipamentos/
        └── index.html      → /modulos/gerenciar-equipamentos
```

### Regras Automáticas

1. **Arquivos na raiz:**
   - `dashboard.html` → `/dashboard`
   - `teste-mobile.html` → `/teste-mobile`

2. **Arquivos index.html:**
   - `public/index.html` → `/` e `/login` (rotas especiais)
   - `public/modulos/gerenciar-equipamentos/index.html` → `/modulos/gerenciar-equipamentos`

3. **Pastas ignoradas:**
   - `css/`, `js/`, `img/`, `uploads/`, `sql/` não geram rotas

## 🎯 Rotas Especiais

Algumas rotas têm comportamento especial e são configuradas automaticamente:

- `/` → `index.html` (página de login)
- `/login` → `index.html` (mesma página de login)
- `/convocacao/:id` → `convocacao.html` (rota com parâmetro)

## ⚙️ Adicionar Rotas Especiais Customizadas

Se precisar de uma rota com comportamento especial, edite `backend/app.js`:

```javascript
setupAutoRoutes(app, publicPath, {
  '/minha-rota-custom': path.join(publicPath, 'arquivo-custom.html'),
  '/outra-rota/:param': path.join(publicPath, 'outro-arquivo.html')
});
```

## 📝 Exemplos

### Adicionar uma nova página

1. Crie o arquivo HTML em `public/`:
   ```bash
   public/nova-pagina.html
   ```

2. **Pronto!** A rota `/nova-pagina` será criada automaticamente quando o servidor reiniciar.

### Adicionar um novo módulo

1. Crie a estrutura:
   ```bash
   public/modulos/meu-novo-modulo/index.html
   ```

2. **Pronto!** A rota `/modulos/meu-novo-modulo` será criada automaticamente.

## 🔍 Ver Rotas Configuradas

Quando o servidor inicia, você verá no console:

```
🔍 Rotas HTML detectadas automaticamente:
  ✅ / -> index.html
  ✅ /login -> index.html
  ✅ /dashboard -> dashboard.html
  ✅ /teste-mobile -> teste-mobile.html
  ✅ /modulos/gerenciar-equipamentos -> modulos/gerenciar-equipamentos/index.html
  ...

📦 Total de rotas HTML configuradas: 25
```

## ⚠️ Importante

- Rotas são criadas **antes** do middleware de arquivos estáticos
- Headers de cache são configurados automaticamente
- Arquivos devem estar na pasta `public/` ou subpastas
- Pastas `css/`, `js/`, `img/`, `uploads/`, `sql/` são ignoradas

## 🐛 Troubleshooting

**Rota não funciona?**
1. Verifique se o arquivo HTML existe
2. Verifique se está na pasta `public/` ou subpastas
3. Reinicie o servidor (nodemon deve detectar automaticamente)
4. Verifique o console para ver se a rota foi detectada

**Rota especial não funciona?**
- Verifique se o arquivo existe no caminho especificado
- Verifique se a rota não conflita com uma rota de API (`/api/*`)

