# 🔗 Solução para Links de Convocação

## 📋 Problema

Os links de convocação precisam funcionar corretamente em dois ambientes:
- **Desenvolvimento**: `http://localhost:3000` ou IP local
- **Produção**: `http://cargas.integrabrasil.com:8083`

## ✅ Solução Implementada

### Detecção Automática de Ambiente

O sistema agora detecta **automaticamente** o ambiente baseado na URL atual do navegador:

1. **Ambiente LOCAL** (detectado automaticamente):
   - `localhost`
   - `127.0.0.1`
   - IPs privados: `192.168.x.x`, `10.x.x.x`, `172.x.x.x`
   - **URL usada**: `http://localhost:3000`

2. **Ambiente PRODUÇÃO** (detectado automaticamente):
   - Qualquer outro hostname (ex: `cargas.integrabrasil.com`)
   - **URL usada**: A URL atual do navegador (ex: `http://cargas.integrabrasil.com:8083`)

### Como Funciona

1. **Ao acessar o sistema**:
   - O sistema detecta automaticamente se está em localhost ou produção
   - Salva a URL de produção no `localStorage` se necessário

2. **Ao gerar links de convocação**:
   - Usa a URL correta baseada no ambiente detectado
   - Links sempre apontam para o servidor correto

3. **Ao motorista acessar**:
   - O link funciona independente de onde foi gerado
   - O sistema redireciona automaticamente se necessário

## 🎯 Vantagens

✅ **Detecção Automática**: Não precisa configurar manualmente  
✅ **Funciona em ambos os ambientes**: Desenvolvimento e Produção  
✅ **Links sempre corretos**: Baseados na URL atual do navegador  
✅ **Sem configuração extra**: Funciona "out of the box"  

## 📝 Como Usar

### Em Desenvolvimento

1. Acesse: `http://localhost:3000` ou `http://192.168.x.x:3000`
2. O sistema detecta automaticamente como **LOCAL**
3. Links gerados serão: `http://localhost:3000/convocacao/123`

### Em Produção

1. Acesse: `http://cargas.integrabrasil.com:8083`
2. O sistema detecta automaticamente como **PRODUÇÃO**
3. Links gerados serão: `http://cargas.integrabrasil.com:8083/convocacao/123`

## 🔧 Arquivos Envolvidos

- `backend/public/js/ambiente-utils.js` - Utilitário de detecção de ambiente
- `backend/public/modulos/gerenciar-viagens/js/script.js` - Geração de links
- `backend/public/convocacao.html` - Página de acesso do motorista

## 💡 Dica

Se precisar forçar uma URL específica, você pode:
1. Abrir o console do navegador (F12)
2. Executar: `localStorage.setItem('urlBaseProducao', 'http://sua-url-aqui:porta')`
3. Recarregar a página

## ⚠️ Importante

- O sistema **NÃO** precisa mais de configuração manual no login
- A detecção é **automática** baseada na URL atual
- Os links sempre funcionam corretamente no ambiente onde foram gerados

