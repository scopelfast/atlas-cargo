# 📘 SysScopel - Atualizações Recentes

## 🚀 Versão 1.4.0 - 04/12/2025

### **Novidades desta versão:**

---

## 1️⃣ Sistema de Gerenciamento de Validades

### **O que é?**
Sistema completo para gerenciar validades de documentos, certificações e licenças de:
- 👤 Motoristas
- 🚚 Equipamentos/Veículos
- 🏢 Transportadores
- 📋 Clientes

### **Onde usar?**

#### **Gerenciar Tipos de Validade** (Novo Módulo)
Menu: `1.2. Tipo Validade`

Configure os tipos de validade disponíveis:
- Gerenciamento de Risco
- MOPP
- Cronotacógrafo
- Licenças diversas
- etc.

#### **Aba Validades em Cadastro Geral**
Menu: `1.0. Cadastro Geral` → Aba `Validades`

Gerenciar validades de motoristas e transportadores.

#### **Aba Validades em Equipamentos**
Menu: `2.0. Equipamento` → Aba `Validades`

Gerenciar validades de veículos.

### **Funcionalidades:**
- ✅ Cadastrar validades com tipo, datas, certificadora
- ✅ Status visual (Válida/Vencendo/Vencida)
- ✅ Busca inteligente de certificadora
- ✅ Contador de dias restantes
- ✅ Observações e detalhes

---

## 2️⃣ Aba Histórico de Viagens

### **Onde usar?**
Menu: `3.0. Viagem` → `Gerenciar Viagens` → Aba `Histórico`

### **Funcionalidades:**
- ✅ Visualizar todas as viagens de um roteiro
- ✅ Resumo estatístico por classe de frota
- ✅ Links WhatsApp para motorista e contratador
- ✅ Filtro automático por roteiro selecionado

### **Como usar:**
1. Vá na aba `Dados`
2. Selecione um Roteiro
3. Clique na aba `Histórico`
4. Visualize todas as viagens daquele roteiro!

---

## 3️⃣ Correções Importantes

### **Busca de Motoristas Compatíveis**
**O que foi corrigido:**
- Motoristas de outros estados não aparecem mais incorretamente
- Busca agora considera Estado + Micro-região
- Resultados geograficamente precisos

**Impacto:**
Antes: Motorista do PR aparecia para viagem no RS ❌  
Agora: Apenas motoristas do estado correto ✅

---

## 4️⃣ Configurações de Mapas Centralizadas

### **Novo arquivo:**
`backend/public/js/map-config.js`

### **Por que?**
Antes: URLs de mapas espalhadas pelo código  
Agora: Tudo em UM LUGAR só! ✅

### **Como configurar:**
Edite APENAS o arquivo `map-config.js`:

```javascript
// Seu servidor de mapas
tileServer: 'http://186.250.92.131:8081/...',

// Seu servidor de roteamento  
osrmServer: 'http://186.250.92.131:8081/ors/...',

// Seu servidor de geocoding
nominatimServer: 'http://186.250.92.131:8082',
```

**Documentação completa:** `backend/CONFIGURACAO_MAPAS.md`

---

## 📚 Documentação Atualizada

- ✅ `CHANGELOG_2025-12-04.md` - Todas as mudanças detalhadas
- ✅ `CONFIGURACAO_MAPAS.md` - Como configurar mapas
- ✅ `LIMPEZA_RECOMENDADA.md` - Arquivos para limpar

---

## 🧹 Limpeza Necessária

⚠️ **Pasta duplicada encontrada:** `backend/backend/`

**Recomendação:** REMOVER (não está sendo usada)

Ver detalhes em: `LIMPEZA_RECOMENDADA.md`

---

## 🎯 Estrutura Atual do Projeto

```
backend/
├── controllers/          # Lógica de negócio
│   ├── viagemmestre.controller.js    (ATUALIZADO)
│   ├── cadastrogeral.controller.js   (ATUALIZADO)
│   ├── tipovalidade.controller.js    (NOVO)
│   └── controlevalidade.controller.js (NOVO)
├── routes/              # Rotas da API
│   ├── viagemmestre.routes.js        (ATUALIZADO)
│   ├── tipovalidade.routes.js        (NOVO)
│   └── controlevalidade.routes.js    (NOVO)
├── public/
│   ├── js/
│   │   └── map-config.js             (NOVO - IMPORTANTE!)
│   └── modulos/
│       ├── gerenciar-viagens/        (ATUALIZADO - Nova aba Histórico)
│       ├── gerenciar-cadastro-geral/ (ATUALIZADO - Nova aba Validades)
│       ├── gerenciar-equipamentos/   (ATUALIZADO - Nova aba Validades)
│       └── gerenciar-tipos-validade/ (NOVO)
├── scripts/             # Scripts SQL
│   ├── criar_tabelas_validade.sql    (NOVO)
│   ├── migrar_dados_validade.sql     (NOVO)
│   └── procedures_validade.sql       (NOVO)
├── CHANGELOG_2025-12-04.md           (NOVO)
├── CONFIGURACAO_MAPAS.md             (NOVO)
└── LIMPEZA_RECOMENDADA.md            (NOVO)
```

---

## 💡 Dicas de Uso

### **Sistema de Validades:**
1. Configure os tipos em `Tipo Validade`
2. Cadastre validades nos módulos principais
3. Monitore vencimentos pelas cores

### **Mapas:**
1. Edite `map-config.js` para mudar servidores
2. Ajuste timeouts se necessário
3. Use servidores alternativos em caso de falha

---

**Sistema atualizado e pronto para uso!** 🎉

