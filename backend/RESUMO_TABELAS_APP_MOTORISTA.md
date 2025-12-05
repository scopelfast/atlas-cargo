# 📊 RESUMO - TABELAS APP MOTORISTA

## ✅ TABELAS UTILIZADAS

Data: 03/12/2025  
Versão: 1.0.0

---

## 🗄️ **TABELAS CRIADAS/ATUALIZADAS:**

### **1. TIPOOCORRENCIA** (Nova)

**Descrição:** Tipos de macros/ocorrências que o motorista pode registrar

**Campos:**
```sql
CDTIPOOCORRENCIA (PK, smallint)
DSTIPOOCORRENCIA (varchar 100) - Nome da macro
CDEDIPADRAO (varchar 5)
FGSITUACAO (char 2) - T, C, D, P
SEQ (smallint) - 1, 2, 3
-- Auditoria:
DTCADASTRO, DTALTERACAO, CDCADASTRO, CDALTERACAO
-- Controle:
FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
```

**Dados:** 13 tipos de macro pré-cadastrados

**Stored Procedure:** `sp_ValidarSequenciaOcorrencia`

---

### **2. VIAGEMOCORRENCIA** (Nova)

**Descrição:** Registra as macros enviadas pelo motorista durante a viagem

**Campos:**
```sql
IDVIAGEM_OCORRENCIA (PK, bigint IDENTITY)
IDVIAGEM (FK)
CDTIPOOCORRENCIA (FK TIPOOCORRENCIA)
CDMOTORISTA (decimal 15,0)
DTOCORRENCIA (datetime)
DSOBSERVACAO (varchar 500)
-- GPS:
LATITUDE (decimal 10,7)
LONGITUDE (decimal 10,7)
NRPRECISAO (decimal 10,2)
-- Foto:
DSCAMINHOFOTO (varchar 500)
DSFOTOBASE64 (text)
-- Sincronização:
FGSINCRONIZADO (char 1)
DTSINCRONIZACAO (datetime)
-- Dados adicionais:
DSDEVICE (varchar 100)
DSVERSAO_APP (varchar 20)
-- Auditoria:
DTCADASTRO, DTALTERACAO, CDCADASTRO, CDALTERACAO
-- Controle:
FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
```

---

### **3. VIAGEMRASTREAMENTO** (Atualizada)

**Descrição:** Rastreamento GPS completo das viagens

**Campos Originais:**
```sql
IDRASTREAMENTO (PK, bigint IDENTITY)
IDVIAGEM (decimal 15,0 FK)
CDCADASTRO (decimal 15,0 FK)
LATITUDE (decimal 10,8)
LONGITUDE (decimal 11,8)
VELOCIDADE (decimal 5,2) - km/h
PRECISAO (int) - metros
BATERIA (int) - %
DHREGISTRO (datetime)
TIPO (char 1) - A=Automático, M=Manual
FONTE (varchar 20) - APP, WEB, API
VERSAOAPP (varchar 20)
```

**Campos Adicionados:** ⭐
```sql
ALTITUDE (decimal 10,2) - metros
FGSTATUS (char 1) - P=Parado, M=Movimento
DIRECAO (decimal 5,2) - 0-360 graus
FGACTIVE (char 1)
DHMAINTENANCE (datetime)
SGUSER (varchar 50)
SERVERORIG (varchar 50)
```

**View:** `vw_Rastreamento_Completo`

---

## 🎯 **USO DAS TABELAS:**

### **TIPOOCORRENCIA:**
- Cadastro dos tipos de macro
- Lida pela API: `GET /api/motorista/macros`
- Usada para validação de sequência

### **VIAGEMOCORRENCIA:**
- Registra cada macro enviada
- API: `POST /api/motorista/macro`
- Armazena GPS + foto da ocorrência
- Histórico: `GET /api/motorista/historico-macros/:id`

### **VIAGEMRASTREAMENTO:**
- Registra todas as posições GPS
- API: `POST /api/motorista/gps`
- Registrada automaticamente em cada macro
- Envio manual ou automático
- Detecta parado/movimento
- Armazena direção cardinal

---

## 📝 **RELACIONAMENTOS:**

```
VIAGEMMESTRE (já existe)
    ├── VIAGEMOCORRENCIA (macros da viagem)
    │   └── TIPOOCORRENCIA (tipos de macro)
    └── VIAGEMRASTREAMENTO (GPS da viagem)

CADASTROGERAL (já existe)
    ├── VIAGEMOCORRENCIA (motorista que enviou macro)
    └── VIAGEMRASTREAMENTO (motorista sendo rastreado)
```

---

## 🚀 **SCRIPTS SQL (ORDEM DE EXECUÇÃO):**

```sql
1. criar_tabela_tipoocorrencia.sql
2. criar_tabela_viagemocorrencia.sql
3. atualizar_viagemrastreamento.sql ⭐
```

---

## ✅ **PADRONIZAÇÃO:**

Todos os nomes de tabela **SEM UNDERLINE**:
- ✅ TIPOOCORRENCIA
- ✅ VIAGEMOCORRENCIA
- ✅ VIAGEMRASTREAMENTO
- ✅ VIAGEMCHAT
- ✅ VIAGEMCOMPROVANTE
- ✅ VIAGEMEVENTO

**Seguindo o padrão do sistema existente!**

---

## 📊 **RESUMO DE CAMPOS NOVOS:**

### **GPS Completo:**
- ✅ LATITUDE, LONGITUDE
- ✅ VELOCIDADE (km/h)
- ✅ **ALTITUDE** ⭐
- ✅ **FGSTATUS** ⭐ (Parado/Movimento)
- ✅ **DIRECAO** ⭐ (0-360 graus)
- ✅ PRECISAO

### **Controle Padrão:**
- ✅ FGACTIVE
- ✅ DHMAINTENANCE
- ✅ SGUSER
- ✅ SERVERORIG

---

**Estrutura completa e padronizada!** 🎉

