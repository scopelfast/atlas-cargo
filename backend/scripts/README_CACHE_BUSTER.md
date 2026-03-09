# Sistema de Cache Busting

## 📋 O que é?

Sistema automático para evitar problemas de cache quando você faz deploy de atualizações para o servidor. Os navegadores dos usuários sempre receberão a versão mais recente dos arquivos JavaScript e CSS.

## 🚀 Como Funciona

1. **Cache Buster Helper** (`/js/cache-buster.js`)
   - Adiciona automaticamente um parâmetro `?v=YYYYMMDDHHMM` em todos os arquivos JS/CSS
   - Processa scripts e links CSS já carregados na página
   - Também processa scripts dinâmicos adicionados depois

2. **Headers HTTP Otimizados** (`backend/app.js`)
   - CSS/JS: Cache curto com validação (ETag)
   - HTML: Sem cache (sempre atualizado)
   - Imagens: Cache longo (raramente mudam)

## 📝 Como Usar

### Antes de cada deploy:

1. **Atualizar a versão automaticamente:**
   ```bash
   node backend/scripts/atualizar-versao-cache.js
   ```

2. **Ou atualizar manualmente:**
   - Abra `backend/public/js/cache-buster.js`
   - Altere a linha: `const APP_VERSION = '202612091200';`
   - Use o formato: `YYYYMMDDHHMM` (ano, mês, dia, hora, minuto)
   - Exemplo: `202612091200` = 09/12/2026 12:00

3. **Fazer commit e deploy:**
   ```bash
   git add .
   git commit -m "Atualização: cache buster v202612091200"
   git push
   ```

## ✅ Módulos com Cache Buster Implementado

- ✅ Gerenciar Viagens
- ✅ Gerenciar Roteiros
- ✅ Gerenciar Marcas
- ✅ Gerenciar Equipamentos
- ✅ Gerenciar Cadastro Geral
- ✅ Gerenciar Tipos Validade
- ✅ Gerenciar Usuários
- ✅ Gerenciar Tipos Viagem
- ✅ Gerenciar Classes Frota
- ✅ Gerenciar Empresas
- ✅ Gerenciar Grupos
- ✅ Gerenciar Modelos Equipamento
- ✅ Gerenciar Situações Viagem
- ✅ Gerenciar Tipos Equipamento
- ✅ Gerenciar Filiais
- ✅ Gerenciar Cidades
- ✅ Gerenciar Tipos Atividade
- ✅ Relatório Convocações

## 🔍 Verificação

Após o deploy, verifique no navegador (F12 > Network):
- Os arquivos JS/CSS devem ter `?v=YYYYMMDDHHMM` na URL
- Exemplo: `/modulos/gerenciar-viagens/js/script.js?v=202612091200`

## 💡 Dica

Se ainda houver problemas de cache após o deploy:
1. Atualize a versão no `cache-buster.js`
2. Faça um novo deploy
3. Peça aos usuários para fazer **Ctrl+Shift+R** (hard refresh)

