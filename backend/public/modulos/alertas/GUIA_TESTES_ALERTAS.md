# 📋 Guia de Testes - Módulo Alertas

**Versão:** 1.0  
**Data:** 2025-01-18  
**Módulo:** Alertas do Sistema

---

## 📖 Índice

1. [Visão Geral](#visão-geral)
2. [Como Funciona](#como-funciona)
3. [Pré-requisitos](#pré-requisitos)
4. [Preparação do Ambiente](#preparação-do-ambiente)
5. [Cenários de Teste](#cenários-de-teste)
6. [Scripts SQL de Teste](#scripts-sql-de-teste)
7. [Checklist de Validação](#checklist-de-validação)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

O módulo **Alertas** permite visualizar, filtrar e tratar alertas gerados automaticamente pelo sistema. Os alertas são criados quando o sistema detecta situações que requerem atenção, como:

- ⏱️ **Atrasos** no ETA (tempo estimado de chegada)
- 🛑 **Paradas prolongadas** (>30 minutos)
- 📴 **Motorista offline** (>90 minutos sem atualização GPS)
- 🗺️ **Desvios de rota** (motorista fora da rota planejada)

---

## 🔧 Como Funciona

### Geração Automática de Alertas

Os alertas são gerados **automaticamente** pelo sistema através de um processo em background que:

1. **Verifica viagens ativas** periodicamente (a cada 5 minutos)
2. **Analisa dados de rastreamento** (GPS, velocidade, posição)
3. **Compara com parâmetros configurados** (tempo de parada, ETA, rota)
4. **Cria alertas** quando detecta situações anômalas
5. **Notifica em tempo real** via WebSocket

### Fluxo de Tratamento

```
1. Sistema detecta situação → Cria alerta (Status: "Pendente")
2. Operador visualiza alerta → Marca como lido (opcional)
3. Operador trata alerta → Muda status para "Em Análise" ou "Tratado"
4. Sistema registra histórico → Todas as ações são logadas
```

### Quem Gera os Alertas?

- **Sistema automático** (`alert-service.js`)
- **Verificação periódica** (job no servidor)
- **Baseado em dados de rastreamento** (tabela `VIAGEMRASTREAMENTO`)

---

## ✅ Pré-requisitos

Antes de testar, certifique-se de que:

- ✅ Banco de dados `DIVULGACARGA_PRD` está acessível
- ✅ Tabela `ALERTS` existe e está configurada
- ✅ Tabela `ALERT_HISTORY` existe
- ✅ Servidor Node.js está rodando
- ✅ Usuário tem permissão para acessar o módulo Alertas
- ✅ Há viagens ativas no sistema (para gerar alertas reais)

---

## 🚀 Preparação do Ambiente

### Passo 1: Verificar Estrutura do Banco

Execute no SQL Server Management Studio:

```sql
USE [DIVULGACARGA_PRD]
GO

-- Verificar se tabela ALERTS existe
SELECT TOP 1 * FROM [dbo].[ALERTS]

-- Verificar se tabela ALERT_HISTORY existe
SELECT TOP 1 * FROM [dbo].[ALERT_HISTORY]

-- Verificar estrutura
sp_help ALERTS
sp_help ALERT_HISTORY
```

### Passo 2: Criar Alertas de Teste

Execute o script SQL fornecido em `criar_alertas_teste.sql` (veja seção abaixo).

### Passo 3: Acessar o Módulo

1. Faça login no sistema
2. No menu lateral, clique em **"4.0.Alertas"**
3. O módulo deve carregar mostrando os alertas

---

## 🧪 Cenários de Teste

### Teste 1: Visualizar Lista de Alertas

**Objetivo:** Verificar se a lista de alertas é exibida corretamente.

**Passos:**
1. Acesse o módulo Alertas
2. Verifique se os cards de alertas aparecem
3. Verifique se as estatísticas no topo estão corretas

**Resultado Esperado:**
- ✅ Lista de alertas carregada
- ✅ Cards com cores diferentes por prioridade
- ✅ Estatísticas atualizadas (Pendentes, Em Análise, Tratados, Total)

---

### Teste 2: Filtrar Alertas

**Objetivo:** Testar os filtros de busca.

**Passos:**
1. Selecione um **Status** (ex: "Pendente")
2. Selecione um **Tipo** (ex: "ATRASO")
3. Selecione uma **Prioridade** (ex: "Urgente")
4. Clique em **"Filtrar"**

**Resultado Esperado:**
- ✅ Lista atualizada com apenas alertas que correspondem aos filtros
- ✅ Contadores atualizados

**Teste Limpar Filtros:**
1. Clique em **"Limpar"**
2. Verifique se todos os filtros foram resetados
3. Verifique se a lista voltou ao estado inicial

---

### Teste 3: Marcar Alerta como Lido

**Objetivo:** Testar a funcionalidade de marcar como lido.

**Passos:**
1. Identifique um alerta **não lido** (fundo amarelo claro)
2. Clique no botão **"Marcar como Lido"**
3. Aguarde a confirmação

**Resultado Esperado:**
- ✅ Mensagem de sucesso
- ✅ Alerta perde o destaque (fundo amarelo)
- ✅ Botão "Marcar como Lido" desaparece
- ✅ Contador de pendentes atualizado

---

### Teste 4: Tratar Alerta

**Objetivo:** Testar o tratamento completo de um alerta.

**Passos:**
1. Clique no botão **"Tratar"** de um alerta pendente
2. No modal que abrir:
   - Selecione um novo **Status** (ex: "Em Análise" ou "Tratado")
   - Digite **Observações** (ex: "Verificado com motorista")
3. Clique em **"Salvar"**

**Resultado Esperado:**
- ✅ Modal fecha
- ✅ Mensagem de sucesso
- ✅ Alerta atualizado na lista
- ✅ Status mudado
- ✅ Observações salvas
- ✅ Contadores atualizados

---

### Teste 5: Ver Histórico

**Objetivo:** Visualizar histórico de ações de um alerta.

**Passos:**
1. Clique no botão **"Histórico"** de um alerta
2. Verifique o modal com histórico

**Resultado Esperado:**
- ✅ Modal abre mostrando histórico
- ✅ Todas as ações são listadas (criação, leitura, tratamento)
- ✅ Datas e usuários são exibidos corretamente

---

### Teste 6: Paginação

**Objetivo:** Testar navegação entre páginas.

**Passos:**
1. Se houver mais de 20 alertas, verifique a paginação no rodapé
2. Clique em **"Próxima"**
3. Clique em **"Anterior"**

**Resultado Esperado:**
- ✅ Página atualiza mostrando próximos alertas
- ✅ Botões habilitados/desabilitados corretamente
- ✅ Informação de página atualizada

---

### Teste 7: Atualização em Tempo Real (WebSocket)

**Objetivo:** Verificar atualizações automáticas via WebSocket.

**Passos:**
1. Mantenha o módulo Alertas aberto
2. Em outra aba/terminal, execute um script que cria um novo alerta (ou aguarde geração automática)
3. Observe o módulo

**Resultado Esperado:**
- ✅ Novo alerta aparece automaticamente (sem recarregar página)
- ✅ Notificação aparece (se configurada)
- ✅ Contadores atualizados
- ✅ Badge no menu atualizado

---

### Teste 8: Badge no Menu

**Objetivo:** Verificar contador de alertas pendentes no menu.

**Passos:**
1. Observe o item **"4.0.Alertas"** no menu lateral
2. Verifique se há um badge vermelho com número
3. Trate alguns alertas pendentes
4. Verifique se o badge atualiza

**Resultado Esperado:**
- ✅ Badge aparece quando há alertas pendentes
- ✅ Número corresponde ao total de pendentes
- ✅ Badge desaparece quando não há pendentes
- ✅ Atualiza automaticamente

---

### Teste 9: Estatísticas

**Objetivo:** Verificar se as estatísticas estão corretas.

**Passos:**
1. Conte manualmente os alertas por status
2. Compare com os números exibidos nos cards de estatísticas

**Resultado Esperado:**
- ✅ Números correspondem à realidade
- ✅ Atualizam quando alertas são tratados

---

### Teste 10: Responsividade

**Objetivo:** Verificar se o módulo funciona em diferentes tamanhos de tela.

**Passos:**
1. Redimensione a janela do navegador
2. Teste em mobile (F12 > Device Toolbar)

**Resultado Esperado:**
- ✅ Layout se adapta ao tamanho da tela
- ✅ Cards não quebram
- ✅ Filtros continuam funcionais

---

## 💾 Scripts SQL de Teste

### Script 1: Criar Alertas de Teste

Crie o arquivo `criar_alertas_teste.sql` (veja seção abaixo).

### Script 2: Limpar Alertas de Teste

```sql
USE [DIVULGACARGA_PRD]
GO

-- Limpar alertas de teste (cuidado: remove todos os alertas!)
-- DELETE FROM [dbo].[ALERT_HISTORY]
-- DELETE FROM [dbo].[ALERTS]
-- GO
```

⚠️ **ATENÇÃO:** Descomente apenas se quiser limpar TODOS os alertas!

---

## ✅ Checklist de Validação

Use este checklist para validar todos os testes:

- [ ] Lista de alertas carrega corretamente
- [ ] Filtros funcionam (Status, Tipo, Prioridade, Datas)
- [ ] Botão "Limpar" reseta filtros
- [ ] Marcar como lido funciona
- [ ] Tratar alerta funciona (mudar status e adicionar observações)
- [ ] Histórico exibe corretamente
- [ ] Paginação funciona
- [ ] WebSocket atualiza em tempo real
- [ ] Badge no menu aparece/desaparece corretamente
- [ ] Estatísticas estão corretas
- [ ] Layout responsivo funciona
- [ ] Mensagens de erro são claras
- [ ] Loading aparece durante carregamento

---

## 🔍 Troubleshooting

### Problema: Nenhum alerta aparece

**Possíveis causas:**
1. Não há alertas no banco de dados
2. Filtros estão aplicados incorretamente
3. Erro na conexão com a API

**Solução:**
1. Verifique no banco: `SELECT * FROM [dbo].[ALERTS]`
2. Limpe os filtros e tente novamente
3. Abra o Console do navegador (F12) e verifique erros

---

### Problema: Badge não aparece no menu

**Possíveis causas:**
1. Não há alertas pendentes
2. Atributo `data-programa` não está correto
3. JavaScript não está executando

**Solução:**
1. Verifique: `SELECT COUNT(*) FROM [dbo].[ALERTS] WHERE STATUS = 'Pendente'`
2. Verifique no HTML do menu se há `data-programa="alertas"`
3. Abra o Console e verifique erros JavaScript

---

### Problema: WebSocket não conecta

**Possíveis causas:**
1. Socket.io não está carregado
2. Servidor não está rodando
3. Firewall bloqueando conexão

**Solução:**
1. Verifique no Console: `typeof io` (deve ser "function")
2. Verifique se o servidor está rodando
3. Verifique logs do servidor

---

### Problema: Erro ao tratar alerta

**Possíveis causas:**
1. Alerta não existe mais
2. Erro na API
3. Permissões insuficientes

**Solução:**
1. Recarregue a página e tente novamente
2. Verifique logs do servidor
3. Verifique permissões do usuário

---

## 📞 Suporte

Em caso de problemas não resolvidos:

1. Verifique os logs do servidor (`backend/logs/`)
2. Verifique o Console do navegador (F12)
3. Verifique o Network tab para erros de API
4. Consulte a documentação técnica em `PLANO_IMPLEMENTACAO_MODULOS_ALERTAS_CHAT_SOS_RANKING.md`

---

**Documento criado em:** 2025-01-18  
**Última atualização:** 2025-01-18
