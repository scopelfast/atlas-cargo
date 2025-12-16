# 📍 Como Usar a Aba de Rastreamento GPS

## ✅ O que foi implementado

1. **Nova aba "📍 Rastreamento"** no módulo Gerenciar Viagens
2. **API para buscar posições GPS** da viagem
3. **API para buscar motorista** da viagem (mesmo sem posições GPS)
4. **Mapa interativo** com traçado da rota
5. **Lista de posições** com histórico completo

---

## 🚀 Como Usar

### **Passo 1: Criar a Tabela (se ainda não existe)**

Execute o script SQL:

```sql
-- Arquivo: backend/scripts/criar_tabelas_app_motorista.sql
-- Ou apenas a parte da tabela VIAGEM_RASTREAMENTO
```

### **Passo 2: Inserir Posições de Teste**

**Opção A: Script Node.js (Recomendado)**

```bash
# Busca automaticamente o motorista da viagem
node backend/scripts/inserir_posicoes_teste.js 82911

# Ou especifique o motorista
node backend/scripts/inserir_posicoes_teste.js 82911 9436
```

**Opção B: Script SQL**

```sql
-- Arquivo: backend/scripts/inserir_posicoes_teste.sql
-- Ajuste o @IDVIAGEM e @CDMOTORISTA no início do script
```

### **Passo 3: Visualizar no Sistema**

1. Acesse: `http://localhost:3000/modulos/gerenciar-viagens/`
2. Selecione uma viagem na aba **Dados** ou **Grid**
3. Clique na aba **📍 Rastreamento**
4. Visualize:
   - **Mapa**: Traçado da rota com marcadores
   - **Lista**: Histórico completo de posições

---

## 📋 Funcionalidades

### **Mapa**
- ✅ Traçado da rota conectando todas as posições
- ✅ Marcadores coloridos:
  - 🟢 Verde: Primeira posição (início)
  - 🔴 Vermelho: Última posição (fim)
  - 🔵 Azul: Posições intermediárias
- ✅ Popup com detalhes ao clicar no marcador
- ✅ Zoom automático para mostrar toda a rota

### **Lista de Posições**
- ✅ Histórico ordenado (mais recente primeiro)
- ✅ Destaque visual para primeira e última posição
- ✅ Informações: data/hora, velocidade, coordenadas, precisão
- ✅ Clique na posição centraliza o mapa e abre popup

### **Informações da Viagem**
- ✅ ID da viagem
- ✅ Nome do motorista (busca automaticamente)
- ✅ Total de posições
- ✅ Última atualização

---

## 🔧 Scripts Disponíveis

### **1. Verificar Tabela**
```sql
-- backend/scripts/verificar_tabela_rastreamento.sql
```

### **2. Inserir Posições de Teste (Node.js)**
```bash
node backend/scripts/inserir_posicoes_teste.js <ID_VIAGEM> [CD_MOTORISTA]
```

### **3. Inserir Posições de Teste (SQL)**
```sql
-- backend/scripts/inserir_posicoes_teste.sql
```

---

## 🎯 Exemplo de Uso

### **Inserir 10 posições de teste para viagem 82911:**

```bash
cd backend
node scripts/inserir_posicoes_teste.js 82911
```

O script vai:
1. ✅ Buscar o motorista da viagem automaticamente
2. ✅ Verificar se a tabela existe
3. ✅ Inserir 10 posições de teste (rota Curitiba -> São Paulo)
4. ✅ Mostrar confirmação

### **Visualizar no sistema:**

1. Acesse a aba **📍 Rastreamento**
2. Selecione a viagem **82911**
3. Veja o traçado da rota no mapa
4. Veja o histórico na lista lateral

---

## ⚠️ Notas Importantes

1. **Motorista**: O sistema busca automaticamente o motorista da viagem na tabela `VIAGEMMOTORISTA`
2. **Tabela**: A tabela `VIAGEM_RASTREAMENTO` deve existir antes de inserir posições
3. **Posições Reais**: As posições de teste são fictícias (rota Curitiba -> São Paulo)
4. **Atualização**: Use o botão "🔄 Atualizar Posições" para recarregar

---

## 🐛 Solução de Problemas

### "Motorista: -" (não mostra nome)

**Causa:** Motorista não está cadastrado na viagem

**Solução:**
1. Vá na aba **Motorista**
2. Adicione o motorista à viagem
3. Volte para a aba **📍 Rastreamento**

### "Nenhuma posição GPS registrada"

**Causa:** Não há posições na tabela `VIAGEM_RASTREAMENTO`

**Solução:**
1. Execute o script de inserir posições de teste
2. Ou aguarde o motorista enviar posições pelo app

### Erro 500 ao carregar

**Causa:** Tabela não existe ou estrutura diferente

**Solução:**
1. Execute `backend/scripts/criar_tabelas_app_motorista.sql`
2. Verifique com `backend/scripts/verificar_tabela_rastreamento.sql`

---

## 📊 Estrutura de Dados

A tabela `VIAGEM_RASTREAMENTO` armazena:
- ID da viagem
- Código do motorista (CDCADASTRO)
- Latitude e Longitude
- Velocidade (km/h)
- Precisão (metros)
- Data/hora do registro
- Tipo (Automático/Manual)
- Fonte (APP/WEB/API)

---

## 🎉 Pronto para Usar!

Agora você pode:
- ✅ Visualizar o rastreamento GPS de qualquer viagem
- ✅ Ver o traçado completo da rota no mapa
- ✅ Acompanhar o histórico de posições
- ✅ Identificar início e fim da viagem

