'use strict';

/**
 * Placas esperadas: primeiro vínculos na viagem (VIAGEMVEICULO); se vazio, veículos aprovados no cadastro motorista (torre/app).
 * Alias de convocação na query externa deve ser `c`.
 */
function sqlCoalescePlacasEsperadasConvocacao() {
  return `COALESCE(
    (
      SELECT STRING_AGG(x.[placa], ', ' ORDER BY x.[placa])
      FROM (
        SELECT DISTINCT TRIM(BOTH FROM COALESCE(
          NULLIF(TRIM(BOTH FROM [vvpl].[REFEQUIPAMENTO]), ''),
          NULLIF(TRIM(BOTH FROM [eq].[REFEQUIPAMENTO]), '')
        )) AS [placa]
        FROM [dbo].[VIAGEMVEICULO] AS [vvpl]
        LEFT JOIN [dbo].[EQUIPAMENTO] AS [eq] ON [eq].[IDEQUIPAMENTO] = [vvpl].[IDEQUIPAMENTO]
          AND ([eq].[TENANT_ID] = c.[TENANT_ID] OR [eq].[TENANT_ID] = 'default')
        WHERE [vvpl].[IDVIAGEM] = c.[IDVIAGEM]
      ) AS x
      WHERE TRIM(COALESCE(x.[placa], '')) <> ''
    ),
    (
      SELECT STRING_AGG(mz.[placa], ', ' ORDER BY mz.[placa])
      FROM (
        SELECT DISTINCT TRIM(BOTH FROM COALESCE(
          NULLIF(TRIM(BOTH FROM mv.[PLACA]), ''),
          NULLIF(TRIM(BOTH FROM eqm.[REFEQUIPAMENTO]), '')
        )) AS [placa]
        FROM [dbo].[MOTORISTA_VEICULO] AS mv
        LEFT JOIN [dbo].[EQUIPAMENTO] AS eqm ON eqm.[IDEQUIPAMENTO] = mv.[CDEQUIPAMENTO]
          AND (eqm.[TENANT_ID] = c.[TENANT_ID] OR eqm.[TENANT_ID] = 'default')
        WHERE mv.[CDCADASTRO] = c.[CDCADASTRO_MOTORISTA]
          AND (mv.[TENANT_ID] = c.[TENANT_ID] OR mv.[TENANT_ID] IS NULL)
          AND COALESCE(mv.[FGACTIVE], 'S') = 'S'
          AND COALESCE(mv.[STATUSAPROVACAO], 'P') = 'A'
      ) AS mz
      WHERE TRIM(COALESCE(mz.[placa], '')) <> ''
    )
  )`;
}

/** Classes do conjunto: viagem primeiro; senão classes dos veículos aprovados do motorista (cadastro torre). */
function sqlCoalesceDsClasseConjuntoConvocacao() {
  return `COALESCE(
    (
      SELECT STRING_AGG(sub.[ds], ' | ' ORDER BY sub.[ds])
      FROM (
        SELECT DISTINCT TRIM(BOTH FROM [cfv].[DSCLASSEFROTA]) AS [ds]
        FROM [dbo].[VIAGEMVEICULO] AS [vv2]
        INNER JOIN [dbo].[EQUIPAMENTO] AS [eq2] ON [eq2].[IDEQUIPAMENTO] = [vv2].[IDEQUIPAMENTO]
          AND ([eq2].[TENANT_ID] = c.[TENANT_ID] OR [eq2].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] AS [cfv] ON [eq2].[CDCLASSEFROTA] = [cfv].[CDCLASSEFROTA]
          AND ([cfv].[TENANT_ID] = c.[TENANT_ID] OR [cfv].[TENANT_ID] = 'default')
        WHERE [vv2].[IDVIAGEM] = c.[IDVIAGEM]
          AND TRIM(COALESCE([cfv].[DSCLASSEFROTA], '')) <> ''
      ) AS sub
    ),
    (
      SELECT STRING_AGG(m2.[ds], ' | ' ORDER BY m2.[ds])
      FROM (
        SELECT DISTINCT TRIM(BOTH FROM [cfm].[DSCLASSEFROTA]) AS [ds]
        FROM [dbo].[MOTORISTA_VEICULO] AS [mv3]
        LEFT JOIN [dbo].[EQUIPAMENTO] AS [eq3] ON [eq3].[IDEQUIPAMENTO] = [mv3].[CDEQUIPAMENTO]
          AND ([eq3].[TENANT_ID] = c.[TENANT_ID] OR [eq3].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] AS [cfm] ON [cfm].[CDCLASSEFROTA] = COALESCE([eq3].[CDCLASSEFROTA], [mv3].[CDCLASSEFROTA])
          AND ([cfm].[TENANT_ID] = c.[TENANT_ID] OR [cfm].[TENANT_ID] = 'default')
        WHERE [mv3].[CDCADASTRO] = c.[CDCADASTRO_MOTORISTA]
          AND ([mv3].[TENANT_ID] = c.[TENANT_ID] OR [mv3].[TENANT_ID] IS NULL)
          AND COALESCE([mv3].[FGACTIVE], 'S') = 'S'
          AND COALESCE([mv3].[STATUSAPROVACAO], 'P') = 'A'
          AND TRIM(COALESCE([cfm].[DSCLASSEFROTA], '')) <> ''
      ) AS m2
    )
  )`;
}

/**
 * Mesma lógica de sqlCoalescePlacasEsperadasConvocacao, mas substituindo o alias `c` por parâmetros
 * (@TENANT_ID, @IDVIAGEM, @CDCADASTRO_MOTORISTA ou nomes passados em `map`).
 */
function sqlPlacasEsperadasPorViagemMotoristaParams(map = {}) {
  const t = map.tenant || '@TENANT_ID';
  const v = map.viagem || '@IDVIAGEM';
  const m = map.motorista || '@CDCADASTRO_MOTORISTA';
  return sqlCoalescePlacasEsperadasConvocacao()
    .replace(/\bc\.\[TENANT_ID\]/g, t)
    .replace(/\bc\.\[IDVIAGEM\]/g, v)
    .replace(/\bc\.\[CDCADASTRO_MOTORISTA\]/g, m);
}

function sqlDsClasseConjuntoPorViagemMotoristaParams(map = {}) {
  const t = map.tenant || '@TENANT_ID';
  const v = map.viagem || '@IDVIAGEM';
  const mot = map.motorista || '@CDCADASTRO_MOTORISTA';
  return sqlCoalesceDsClasseConjuntoConvocacao()
    .replace(/\bc\.\[TENANT_ID\]/g, t)
    .replace(/\bc\.\[IDVIAGEM\]/g, v)
    .replace(/\bc\.\[CDCADASTRO_MOTORISTA\]/g, mot);
}

/** Em SELECT com alias `c` = CONVOCACAO: preferir snapshot gravado na convocação. */
function sqlCoalescePlacasEsperadasConvocacaoComSnapshot() {
  return `COALESCE(NULLIF(TRIM(c.[TXT_PLACAS_SNAPSHOT]), ''), (${sqlCoalescePlacasEsperadasConvocacao()}))`;
}

function sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot() {
  return `COALESCE(NULLIF(TRIM(c.[TXT_CLASSES_CONJ_SNAPSHOT]), ''), (${sqlCoalesceDsClasseConjuntoConvocacao()}))`;
}

module.exports = {
  sqlCoalescePlacasEsperadasConvocacao,
  sqlCoalesceDsClasseConjuntoConvocacao,
  sqlPlacasEsperadasPorViagemMotoristaParams,
  sqlDsClasseConjuntoPorViagemMotoristaParams,
  sqlCoalescePlacasEsperadasConvocacaoComSnapshot,
  sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot,
};
