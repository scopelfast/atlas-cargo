# 📋 Documentação: Tabela VIAGEMRASTREAMENTO

**Banco:** `DIVULGACARGA_PRD`  
**Tabela:** `VIAGEMRASTREAMENTO`  
**Descrição:** Armazena todas as posições GPS registradas durante uma viagem específica.

---

## 📊 Estrutura e Função dos Campos

### 🔑 **Campos de Identificação**

#### `IDRASTREAMENTO` (bigint, NOT NULL, IDENTITY)
- **Função:** Chave primária da tabela. Identificador único de cada registro de posição GPS.
- **Uso:** Auto-incremento. Não precisa ser informado no INSERT.
- **Exemplo:** `1, 2, 3, ...`

#### `IDVIAGEM` (decimal(15,0), NOT NULL)
- **Função:** Identifica a viagem à qual esta posição GPS pertence.
- **Relacionamento:** Foreign Key para `VIAGEMMESTRE.IDVIAGEM`
- **Uso:** Obrigatório. Sempre deve ser informado.
- **Exemplo:** `82911, 82930, 82893`

#### `CDCADASTRO` (decimal(15,0), NOT NULL)
- **Função:** Identifica o motorista que registrou esta posição GPS.
- **Relacionamento:** Foreign Key para `CADASTROGERAL.CDCADASTRO`
- **Uso:** Obrigatório. Identifica quem estava no veículo no momento do registro.
- **Exemplo:** `9436, 8560, 72655`

---

### 📍 **Campos de Localização GPS**

#### `LATITUDE` (decimal(10,8), NOT NULL)
- **Função:** Coordenada de latitude da posição GPS (em graus decimais).
- **Formato:** -90.00000000 a +90.00000000
- **Precisão:** 8 casas decimais (precisão de ~1mm)
- **Uso:** Obrigatório. Usado para plotar no mapa.
- **Exemplo:** `-25.42847234` (Canoas/RS), `-29.91780000` (Gravataí/RS)

#### `LONGITUDE` (decimal(11,8), NOT NULL)
- **Função:** Coordenada de longitude da posição GPS (em graus decimais).
- **Formato:** -180.00000000 a +180.00000000
- **Precisão:** 8 casas decimais (precisão de ~1mm)
- **Uso:** Obrigatório. Usado para plotar no mapa.
- **Exemplo:** `-49.27339123` (Canoas/RS), `-51.18360000` (Gravataí/RS)

#### `ALTITUDE` (decimal(10,2), NULL)
- **Função:** Altitude acima do nível do mar (em metros).
- **Uso:** Opcional. Pode ser NULL se o GPS não fornecer.
- **Exemplo:** `850.50` (metros acima do nível do mar)

---

### 🚗 **Campos de Movimento**

#### `VELOCIDADE` (decimal(5,2), NULL)
- **Função:** Velocidade do veículo no momento do registro (em km/h).
- **Formato:** 0.00 a 999.99
- **Uso:** Opcional. Útil para análise de comportamento e relatórios.
- **Exemplo:** `0.00` (parado), `85.50` (em movimento), `120.00` (rodovia)

#### `DIRECAO` (decimal(5,2), NULL)
- **Função:** Direção do movimento do veículo (em graus).
- **Formato:** 0.00 a 360.00 graus
  - `0°` ou `360°` = Norte
  - `90°` = Leste
  - `180°` = Sul
  - `270°` = Oeste
- **Uso:** Opcional. Útil para mostrar seta de direção no mapa.
- **Exemplo:** `45.00` (Nordeste), `180.00` (Sul), `270.00` (Oeste)

#### `FGSTATUS` (char(1), NULL)
- **Função:** Status do veículo no momento do registro.
- **Valores possíveis:**
  - `'P'` = Parado (Parked)
  - `'M'` = Em Movimento (Moving)
  - `'V'` = Validação/Verificado
  - `'X'` = Excluído/Inválido
- **Uso:** Opcional. Usado para filtrar posições válidas.
- **Exemplo:** `'P'`, `'M'`

---

### 📱 **Campos de Dispositivo**

#### `PRECISAO` (int, NULL)
- **Função:** Precisão do GPS no momento da captura (em metros).
- **Uso:** Opcional. Indica a confiabilidade da posição.
- **Interpretação:**
  - `5-10` = Excelente (GPS externo)
  - `10-20` = Boa (GPS do celular)
  - `20-50` = Aceitável
  - `>50` = Baixa precisão (pode estar em túnel/edifício)
- **Exemplo:** `10`, `25`, `50`

#### `BATERIA` (int, NULL)
- **Função:** Nível de bateria do dispositivo móvel no momento do envio (%).
- **Formato:** 0 a 100
- **Uso:** Opcional. Útil para monitorar se o dispositivo está com energia.
- **Exemplo:** `85` (85%), `20` (20% - bateria baixa)

---

### ⏰ **Campos de Data/Hora**

#### `DHREGISTRO` (datetime, NOT NULL)
- **Função:** Data e hora exata em que a posição GPS foi registrada no sistema.
- **Formato:** `YYYY-MM-DD HH:MM:SS.mmm`
- **Uso:** Obrigatório. Usado para ordenar as posições cronologicamente.
- **Default:** `GETDATE()` (data/hora atual do servidor)
- **Exemplo:** `2025-12-15 14:30:25.420`

---

### 🔧 **Campos de Controle e Origem**

#### `TIPO` (char(1), NULL)
- **Função:** Tipo de envio da posição GPS.
- **Valores possíveis:**
  - `'A'` = Automático (enviado pelo sistema automaticamente)
  - `'M'` = Manual (enviado pelo motorista manualmente)
- **Uso:** Opcional. Usado para distinguir envios automáticos de manuais.
- **Exemplo:** `'A'`, `'M'`

#### `FONTE` (varchar(20), NULL)
- **Função:** Origem do registro de posição GPS.
- **Valores possíveis:**
  - `'APP'` = Aplicativo móvel do motorista
  - `'WEB'` = Interface web
  - `'API'` = Integração via API externa
  - `'RASTER'` = Sistema de rastreamento externo (rastreador)
  - `'TESTE'` = Dados de teste
- **Uso:** Opcional. Usado para rastreabilidade e auditoria.
- **Exemplo:** `'APP'`, `'RASTER'`, `'API'`

#### `VERSAOAPP` (varchar(20), NULL)
- **Função:** Versão do aplicativo que enviou a posição GPS.
- **Uso:** Opcional. Útil para debug e suporte técnico.
- **Exemplo:** `'1.0.0'`, `'2.1.3'`, `'3.0.0-beta'`

---

### 🛠️ **Campos de Manutenção e Auditoria**

#### `FGACTIVE` (char(1), NULL)
- **Função:** Flag que indica se o registro está ativo ou foi desativado.
- **Valores possíveis:**
  - `'S'` = Sim (Ativo)
  - `'N'` = Não (Inativo/Excluído)
  - `'T'` = Temporário
- **Uso:** Opcional. Usado para soft delete (não apagar fisicamente, apenas marcar como inativo).
- **Exemplo:** `'S'`, `'N'`

#### `DHMAINTENANCE` (datetime, NULL)
- **Função:** Data e hora da última manutenção/alteração do registro.
- **Uso:** Opcional. Usado para auditoria e controle de alterações.
- **Exemplo:** `2025-12-15 10:00:00.000`

#### `SGUSER` (varchar(50), NULL)
- **Função:** Sigla/Login do usuário que criou ou modificou o registro.
- **Uso:** Opcional. Usado para auditoria (quem fez a alteração).
- **Exemplo:** `'ADMIN'`, `'SISTEMA'`, `'API_USER'`

#### `SERVERORIG` (varchar(50), NULL)
- **Função:** Nome do servidor/origem que inseriu o registro.
- **Uso:** Opcional. Útil em ambientes com múltiplos servidores ou replicação.
- **Exemplo:** `'SRVAPP01'`, `'CS-IBL-SRV001\\MSSQL2014'`, `'API_SERVER'`

---

## 📝 Resumo por Categoria

### **Campos Obrigatórios (NOT NULL):**
- `IDRASTREAMENTO` - Chave primária (auto-incremento)
- `IDVIAGEM` - Identifica a viagem
- `CDCADASTRO` - Identifica o motorista
- `LATITUDE` - Coordenada de latitude
- `LONGITUDE` - Coordenada de longitude
- `DHREGISTRO` - Data/hora do registro

### **Campos de Localização:**
- `LATITUDE`, `LONGITUDE`, `ALTITUDE`

### **Campos de Movimento:**
- `VELOCIDADE`, `DIRECAO`, `FGSTATUS`

### **Campos de Dispositivo:**
- `PRECISAO`, `BATERIA`

### **Campos de Controle:**
- `TIPO`, `FONTE`, `VERSAOAPP`

### **Campos de Auditoria:**
- `FGACTIVE`, `DHMAINTENANCE`, `SGUSER`, `SERVERORIG`

---

## 🔄 Fluxo de Uso

1. **App do Motorista** captura GPS → Envia para API
2. **API** recebe dados → Valida → Insere em `VIAGEMRASTREAMENTO`
3. **Sistema Web** consulta posições → Exibe no mapa de rastreamento
4. **Relatórios** analisam histórico de posições

---

## 📊 Exemplo de Registro

```sql
INSERT INTO VIAGEMRASTREAMENTO (
  IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE,
  VELOCIDADE, PRECISAO, ALTITUDE, DIRECAO,
  FGSTATUS, DHREGISTRO, TIPO, FONTE, VERSAOAPP, BATERIA
) VALUES (
  82911,                    -- IDVIAGEM
  9436,                     -- CDCADASTRO (Motorista)
  -25.42847234,             -- LATITUDE (Canoas/RS)
  -49.27339123,             -- LONGITUDE (Canoas/RS)
  85.50,                    -- VELOCIDADE (85.5 km/h)
  15,                       -- PRECISAO (15 metros)
  850.00,                   -- ALTITUDE (850m)
  180.00,                   -- DIRECAO (Sul)
  'M',                      -- FGSTATUS (Em Movimento)
  GETDATE(),                -- DHREGISTRO (Agora)
  'A',                      -- TIPO (Automático)
  'APP',                    -- FONTE (Aplicativo)
  '1.0.0',                  -- VERSAOAPP
  75                        -- BATERIA (75%)
);
```

---

## 🎯 Casos de Uso

### 1. **Rastreamento em Tempo Real**
- Consultar últimas posições: `WHERE IDVIAGEM = @idViagem ORDER BY DHREGISTRO DESC`
- Filtrar por status: `WHERE FGSTATUS = 'M'` (apenas em movimento)

### 2. **Análise de Rota**
- Traçar rota completa: `WHERE IDVIAGEM = @idViagem ORDER BY DHREGISTRO ASC`
- Calcular distância percorrida usando `LATITUDE` e `LONGITUDE`

### 3. **Relatórios**
- Velocidade média: `AVG(VELOCIDADE) WHERE FGSTATUS = 'M'`
- Tempo parado: `COUNT(*) WHERE FGSTATUS = 'P'`
- Precisão do GPS: `AVG(PRECISAO)`

### 4. **Auditoria**
- Rastrear origem: `WHERE FONTE = 'APP'` ou `FONTE = 'RASTER'`
- Verificar versão do app: `WHERE VERSAOAPP = '1.0.0'`

---

**Última atualização:** 2025-12-15  
**Versão:** 1.0

