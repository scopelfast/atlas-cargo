# 📋 Changelog - 04 de Dezembro de 2025

## 🎉 Implementações e Melhorias

### **1. 📊 Nova Aba: Histórico de Viagens** 
**Módulo:** Gerenciar Viagens

**Implementado:**
- ✅ Listagem de todas as viagens de um roteiro
- ✅ Resumo estatístico por classe de frota:
  - Valor mínimo (considera apenas valores ≥ R$ 1,00)
  - Valor máximo
  - Valor médio
  - Peso total
- ✅ Cards visuais com status, preços e informações
- ✅ Links WhatsApp clicáveis nos telefones
- ✅ Carregamento automático ao selecionar roteiro
- ✅ Contador de registros
- ✅ Layout responsivo e profissional

**Arquivos modificados:**
- `backend/controllers/viagemmestre.controller.js` - Novo método `buscarHistoricoRoteiro`
- `backend/routes/viagemmestre.routes.js` - Nova rota
- `backend/public/modulos/gerenciar-viagens/index.html` - Nova aba
- `backend/public/modulos/gerenciar-viagens/js/script.js` - Lógica da aba

---

### **2. 🐛 Correção Crítica: Busca de Motoristas Compatíveis**
**Módulo:** Gerenciar Viagens - Aba Compatíveis

**Problema identificado:**
- Motoristas de outros estados apareciam como compatíveis
- Query buscava apenas por `CDMICROREGIAO` sem considerar o estado
- Micro-região 26 existe em múltiplos estados (RS, PR, SP, MG, BA, CE)

**Solução aplicada:**
- ✅ Query agora considera `CDUF + CDMICROREGIAO`
- ✅ Busca geograficamente precisa
- ✅ Apenas motoristas do mesmo estado aparecem

**Arquivo modificado:**
- `backend/controllers/viagemmestre.controller.js` - Método `buscarMotoristasCompatíveis`

---

### **3. 📂 Novo Módulo: Gerenciar Tipos de Validade**

**Implementado:**
- ✅ CRUD completo de tipos de validade (TIPOVALIDADE)
- ✅ GridEditor profissional
- ✅ Campos configuráveis:
  - Aplicável para: Veículo, Motorista, Transportador, Cliente, Fornecedor
  - Exige Certificadora: Sim/Não
- ✅ Init.sql automático
- ✅ Scripts SQL de criação e migração de dados

**Arquivos criados:**
- `backend/controllers/tipovalidade.controller.js`
- `backend/routes/tipovalidade.routes.js`
- `backend/public/modulos/gerenciar-tipos-validade/index.html`
- `backend/public/modulos/gerenciar-tipos-validade/js/script.js`
- `backend/public/modulos/gerenciar-tipos-validade/sql/init.sql`
- `backend/scripts/criar_tabelas_validade.sql`
- `backend/scripts/migrar_dados_validade.sql`
- `backend/scripts/procedures_validade.sql`

**Arquivos modificados:**
- `backend/app.js` - Registrado novo módulo

---

### **4. 📋 Sistema de Controle de Validades**

**Implementado: Aba Validades em Cadastro Geral**
- ✅ Gerenciar validades de Motoristas, Transportadores, etc.
- ✅ Listar validades do cadastro selecionado
- ✅ Adicionar/Editar/Excluir validades
- ✅ Status visual com cores:
  - 🟢 Verde: Válida
  - 🟡 Amarelo: Vencendo (≤ 30 dias)
  - 🔴 Vermelho: Vencida
- ✅ Busca inteligente de certificadora:
  - Por CPF/CNPJ
  - Por Código
  - Por Nome (busca parcial)
- ✅ Modal profissional com cabeçalho gradiente
- ✅ Validações e feedback visual

**Implementado: Aba Validades em Equipamentos**
- ✅ Mesmas funcionalidades do Cadastro Geral
- ✅ Adaptado para veículos (tipo EQP)
- ✅ Mostra placa do equipamento

**Arquivos criados:**
- `backend/controllers/controlevalidade.controller.js`
- `backend/routes/controlevalidade.routes.js`

**Arquivos modificados:**
- `backend/app.js` - Registradas novas rotas
- `backend/public/modulos/gerenciar-cadastro-geral/index.html` - Nova aba
- `backend/public/modulos/gerenciar-cadastro-geral/js/script.js` - Lógica da aba
- `backend/public/modulos/gerenciar-equipamentos/index.html` - Nova aba
- `backend/public/modulos/gerenciar-equipamentos/js/script.js` - Lógica da aba
- `backend/controllers/cadastrogeral.controller.js` - Correção tipo SQL

---

### **5. 🗺️ Centralização de Configurações de Mapas**

**Implementado:**
- ✅ Arquivo centralizado de configurações
- ✅ Servidores próprios configurados:
  - Tiles: `http://186.250.92.131:8081`
  - Routing (OSRM/ORS): `http://186.250.92.131:8081`
  - Geocoding (Nominatim): `http://186.250.92.131:8082`
- ✅ Timeouts configuráveis
- ✅ Servidores alternativos documentados
- ✅ Funções auxiliares para facilitar uso

**Arquivos criados:**
- `backend/public/js/map-config.js` - Configurações centralizadas
- `backend/CONFIGURACAO_MAPAS.md` - Documentação completa

**Arquivos modificados:**
- `backend/public/modulos/gerenciar-viagens/index.html` - Inclusão do config
- `backend/public/modulos/gerenciar-viagens/js/script.js` - Uso das configurações

---

### **6. 🎨 Padronização Visual**

**Melhorias aplicadas:**
- ✅ Todos os botões "Salvar" padronizados (verde simples)
- ✅ Modais com cabeçalho gradiente consistente
- ✅ Layout de cards uniformizado
- ✅ Cores e espaçamentos consistentes
- ✅ Ícones padronizados

---

## 📊 Estatísticas

- **Arquivos criados:** 13
- **Arquivos modificados:** 12+
- **Linhas de código:** ~3.000+
- **Módulos novos:** 2 (Tipos de Validade, Sistema de Validades)
- **Funcionalidades novas:** 5
- **Bugs corrigidos:** 2 (Motoristas compatíveis, Micro-regiões)

---

## 🎯 Próximos Passos (Pendentes)

### **Fase 2: Módulo de Relatórios de Validades**
- [ ] Dashboard com alertas
- [ ] Relatório de vencidas/vencendo
- [ ] Filtros avançados
- [ ] Exportação Excel/PDF

### **Limpeza:**
- [ ] Remover pasta `backend/backend/` (duplicada)
- [ ] Revisar arquivos desnecessários

---

## ⚠️ Observações Importantes

### **Pasta Duplicada**
- Localização: `backend/backend/`
- Status: **NÃO UTILIZADA** pelo sistema atual
- Recomendação: **REMOVER** para evitar confusão

### **Configurações de Mapa**
- Agora centralizadas em: `backend/public/js/map-config.js`
- Para mudar servidores, edite APENAS esse arquivo
- Documentação em: `backend/CONFIGURACAO_MAPAS.md`

---

## ✅ Testes Realizados

- ✅ Aba Histórico: 128 viagens carregadas com sucesso
- ✅ Motoristas Compatíveis: Busca geográfica correta
- ✅ Tipos de Validade: CRUD completo funcionando
- ✅ Validades Cadastro Geral: Todas operações OK
- ✅ Validades Equipamentos: Implementado e testado

---

**Versão:** 1.4.0  
**Data:** 04/12/2025  
**Desenvolvedor:** Claude Sonnet 4.5 + Cleverson Scopel

