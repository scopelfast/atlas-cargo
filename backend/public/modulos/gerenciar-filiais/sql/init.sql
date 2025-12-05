/******************************************************************************************
 * 12. FILIAL
 ******************************************************************************************/
MERGE INTO [dbo].[FILIAL] AS TARGET
USING (
    SELECT DISTINCT
        CDEMPRESA,
        CDFILIAL,
        NMFANTASIA,
        SGFILIAL,
        CGC,
        CDCADASTRO,
        ISNULL(FGPARCEIRO, 'N') AS FGPARCEIRO,
        ISNULL(FGACTIVE, 'A') AS FGACTIVE,
        ISNULL(DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
        ISNULL(SGUSER, 'SYSTEM') AS SGUSER,
        ISNULL(SERVERORIG, 'AppDVcargas') AS SERVERORIG
    FROM [INTEGRA_PRD].[dbo].[FILIAL]
    WHERE CDEMPRESA IS NOT NULL
      AND CDFILIAL IS NOT NULL
) AS SOURCE
ON TARGET.CDEMPRESA = SOURCE.CDEMPRESA 
   AND TARGET.CDFILIAL = SOURCE.CDFILIAL
WHEN NOT MATCHED BY TARGET THEN
    INSERT (
        CDEMPRESA,
        CDFILIAL,
        NMFANTASIA,
        SGFILIAL,
        CGC,
        CDCADASTRO,
        FGPARCEIRO,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    )
    VALUES (
        SOURCE.CDEMPRESA,
        SOURCE.CDFILIAL,
        SOURCE.NMFANTASIA,
        SOURCE.SGFILIAL,
        SOURCE.CGC,
        SOURCE.CDCADASTRO,
        SOURCE.FGPARCEIRO,
        SOURCE.FGACTIVE,
        SOURCE.DHMAINTENANCE,
        SOURCE.SGUSER,
        SOURCE.SERVERORIG
    );
GO