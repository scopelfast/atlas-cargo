# 🔧 Solução: Erro 500 ao Carregar Rastreamento GPS

## 🔍 Problema

Ao tentar visualizar o rastreamento GPS na aba "📍 Rastreamento", ocorre erro 500:
```
GET http://localhost:3000/api/motorista/posicoes/82911 500 (Internal Server Error)
```

## ✅ Solução

O erro geralmente ocorre porque a tabela `VIAGEM_RASTREAMENTO` não existe no banco de dados.

### **Passo 1: Verificar se a Tabela Existe**

Execute o script SQL para verificar:

```sql
-- Arquivo: backend/scripts/verificar_tabela_rastreamento.sql
```

Ou execute diretamente:

```sql
USE [DIVULGACARGA_PRD]
GO

-- Verificar se existe
SELECT COUNT(*) as existe
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO';
```

### **Passo 2: Criar a Tabela (se não existir)**

Execute o script de criação:

```sql
-- Arquivo: backend/scripts/criar_tabelas_app_motorista.sql
```

Ou execute apenas a parte da tabela VIAGEM_RASTREAMENTO:

```sql
USE [DIVULGACARGA_PRD]
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_RASTREAMENTO')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_RASTREAMENTO] (
        IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        CDCADASTRO DECIMAL(15,0) NOT NULL,
        LATITUDE DECIMAL(10,8) NOT NULL,
        LONGITUDE DECIMAL(11,8) NOT NULL,
        VELOCIDADE DECIMAL(5,2),
        PRECISAO INT,
        BATERIA INT,
        DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),
        TIPO CHAR(1) DEFAULT 'A',
        FONTE VARCHAR(20) DEFAULT 'APP',
        VERSAOAPP VARCHAR(20),
        
        CONSTRAINT FK_RASTREAMENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
            REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        CONSTRAINT FK_RASTREAMENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );
    
    CREATE INDEX IDX_RASTREAMENTO_VIAGEM ON [dbo].[VIAGEM_RASTREAMENTO](IDVIAGEM);
    CREATE INDEX IDX_RASTREAMENTO_DATA ON [dbo].[VIAGEM_RASTREAMENTO](DHREGISTRO DESC);
    CREATE INDEX IDX_RASTREAMENTO_MOTORISTA ON [dbo].[VIAGEM_RASTREAMENTO](CDCADASTRO);
    
    PRINT '✅ Tabela VIAGEM_RASTREAMENTO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela VIAGEM_RASTREAMENTO já existe.';
END
GO
```

### **Passo 3: Verificar Dados**

Após criar a tabela, verifique se há posições para a viagem:

```sql
SELECT COUNT(*) as total
FROM [dbo].[VIAGEM_RASTREAMENTO]
WHERE IDVIAGEM = 82911;
```

Se retornar 0, significa que ainda não há posições GPS registradas para essa viagem.

## 📋 O que foi Melhorado no Código

1. ✅ Verificação se a tabela existe antes de consultar
2. ✅ Tratamento de erros mais detalhado
3. ✅ Suporte para estruturas alternativas (CDCADASTRO ou CDMOTORISTA)
4. ✅ Retorno de array vazio se a tabela não existir (em vez de erro)

## 🔍 Verificar Logs do Servidor

Se o erro persistir, verifique os logs do servidor Node.js. Eles mostrarão o erro específico:

```
Erro ao buscar posições da viagem: [detalhes do erro]
```

## 🎯 Próximos Passos

1. Execute o script SQL para criar a tabela
2. Reinicie o servidor Node.js
3. Tente acessar a aba de rastreamento novamente
4. Se ainda não houver posições, o sistema mostrará "Nenhuma posição GPS registrada"

---

**Nota:** A tabela será criada automaticamente quando o motorista começar a enviar posições GPS pelo app, mas é recomendado criá-la manualmente antes.

