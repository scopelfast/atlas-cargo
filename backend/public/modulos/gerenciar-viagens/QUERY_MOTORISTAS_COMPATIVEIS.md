# Query: Motoristas Compatíveis (Aba Compatíveis)

**Endpoint:** `GET /api/viagens/:idViagem/motoristas-compativel`  
**Controller:** `viagemmestre.controller.js` → `buscarMotoristasCompatíveis`

---

## Regras para listar compatíveis

Podem ser listados na aba **Compatíveis** os cadastros que atendam **todas** as condições abaixo.

### 1. Quem pode ser listado (tipo de cadastro)

Atende **se** cumprir **qualquer** um:

- **Motorista:** FGTIPOCADASTRO = 'M' ou FGMOTORISTA = 'S'
- **Agente / Parceiro:** FGTIPOCADASTRO = 'A' ou FGAGENTE = 'S'
- **Grupo de Divulgação:** FGTIPOCADASTRO = 'G' ou FGGRUPO = 'S'
- **Transportador:** FGTIPOCADASTRO = 'T' ou FGTRANSPORTADOR = 'S'

(Assim, cadastros com tipo "P" ou outro que tenham Agente/Grupo/Transportador = 'S' também entram.)

### 2. Veículo rastreado

- **Se a viagem exige veículo rastreado:** o cadastro deve ter **Possui Veículo Rastreado = Sim** (FGRASTREADO = 'S').
- **Se a viagem não exige:** não há restrição; qualquer um dos tipos acima pode aparecer.

### 3. Classe de frota

- O cadastro deve ter **obrigatoriamente** a **mesma Classe Frota** definida na viagem (via tabela CLASSEFROTA_CG, registro ativo).

### 4. Outras condições da query

- Cadastro ativo: `FGACTIVE = 'A'`.
- Classe ativa no vínculo: `CLASSEFROTA_CG.FGACTIVE = 'S'`.
- **Localização:** não é critério para listar. A lista considera apenas tipo + classe + rastreado; assim, quem está em qualquer cidade pode aparecer (ex.: Juliana em Uberaba na viagem Colombo → Itajai).

---

## Trecho principal da query (SQL Server)

Parâmetros: `@IDVIAGEM`, `@CDCLASSEFROTA`, `@IDROTEIRO`; filtros dinâmicos de micro-região/cidade e de rastreado.

```sql
SELECT DISTINCT
  [cg].[CDCADASTRO] AS CDCADASTRO_MOTORISTA,
  [cg].[RZSOCIAL] AS NOME_MOTORISTA,
  [cg].[NRCELULAR] AS CELULAR,
  [cg].[ENDEMAIL] AS EMAIL,
  [cg].[CDTRANSPORTADOR],
  [t].[RZSOCIAL] AS TRANSPORTADOR_NOME,
  [t].[NRCELULAR] AS TRANSPORTADOR_CELULAR,
  [c].[CDCIDADE],
  [c].[NMCIDADE] AS CIDADE_NOME,
  [c].[ESTADO] AS CIDADE_ESTADO,
  [c].[CDMICROREGIAO],
  [cfcg].[CDCLASSEFROTA],
  [cf].[DSCLASSEFROTA] AS CLASSE_FROTA_NOME,
  CASE WHEN EXISTS (
    SELECT 1 FROM [dbo].[CONVOCACAO] conv
    WHERE [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] AND [conv].[IDVIAGEM] = @IDVIAGEM
  ) THEN 1 ELSE 0 END AS FOI_ACIONADO,
  (SELECT COUNT(*) FROM [dbo].[VIAGEMMESTRE] v INNER JOIN [dbo].[VIAGEMMOTORISTA] m ON [v].[IDVIAGEM] = [m].[IDVIAGEM] WHERE [m].[CDMOTORISTA] = [cg].[CDCADASTRO]) AS QTVIAGENS,
  (SELECT COUNT(*) FROM [dbo].[VIAGEMMESTRE] v2 INNER JOIN [dbo].[VIAGEMMOTORISTA] m2 ON [v2].[IDVIAGEM] = [m2].[IDVIAGEM] WHERE [m2].[CDMOTORISTA] = [cg].[CDCADASTRO] AND (@IDROTEIRO = 0 OR [v2].[IDROTEIRO] = @IDROTEIRO)) AS QTVIAGENS_NESTA_ROTA
FROM [dbo].[CADASTROGERAL] [cg]
INNER JOIN [dbo].[CIDADE] [c] ON [cg].[CDCIDADE] = [c].[CDCIDADE]
INNER JOIN [dbo].[CLASSEFROTA_CG] [cfcg] ON [cg].[CDCADASTRO] = [cfcg].[CDCADASTRO]
LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [cfcg].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
LEFT JOIN [dbo].[CADASTROGERAL] [t] ON [cg].[CDTRANSPORTADOR] = [t].[CDCADASTRO]
WHERE (
  [cg].[FGTIPOCADASTRO] IN ('M','A','G','T')
  OR ( [cg].[FGMOTORISTA] = 'S' OR ([cg].[FGMOTORISTA] IS NULL AND [cg].[FGTIPOCADASTRO] = 'M') )
  OR COALESCE([cg].[FGAGENTE], 'N') = 'S'
  OR COALESCE([cg].[FGGRUPO], 'N') = 'S'
  OR COALESCE([cg].[FGTRANSPORTADOR], 'N') = 'S'
)
  AND [cg].[FGACTIVE] = 'A'
  AND [cfcg].[FGACTIVE] = 'S'
  AND [cfcg].[CDCLASSEFROTA] = @CDCLASSEFROTA
  -- Se viagem exige rastreado: AND COALESCE([cg].[FGRASTREADO], 'N') = 'S'
  -- Localização não é mais filtro: listagem só por tipo + classe + rastreado
ORDER BY QTVIAGENS_NESTA_ROTA DESC, QTVIAGENS DESC, [cg].[RZSOCIAL];
```

A montagem completa (filtro de rastreado e de localização) está em `backend/controllers/viagemmestre.controller.js`, método `buscarMotoristasCompatíveis`.
