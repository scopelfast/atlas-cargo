/******************************************************************************************
 * 11. EMPRESA
 ******************************************************************************************/
PRINT '11. Migrando EMPRESA...';
GO

MERGE INTO [dbo].[EMPRESA] AS TARGET
USING (
    SELECT 
        CDEMPRESA,
        RZSOCIAL,
        NMREDUZIDO,
        CGCMATRIZ,
        IMAGEMLOGO,
        ISNULL(FGACTIVE, 'A') AS FGACTIVE,
        ISNULL(DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
        ISNULL(SGUSER, 'SYSTEM') AS SGUSER,
        ISNULL(SERVERORIG, 'AppDVcargas') AS SERVERORIG
    FROM (
        SELECT 
            CDEMPRESA,
            RZSOCIAL,
            NMREDUZIDO,
            CGCMATRIZ,
            IMAGEMLOGO,
            FGACTIVE,
            DHMAINTENANCE,
            SGUSER,
            SERVERORIG,
            ROW_NUMBER() OVER (PARTITION BY CDEMPRESA ORDER BY CDEMPRESA) AS RN
        FROM [INTEGRA_PRD].[dbo].[EMPRESA]
        WHERE CDEMPRESA IS NOT NULL
          AND RZSOCIAL IS NOT NULL
    ) E
    WHERE E.RN = 1
) AS SOURCE
ON TARGET.CDEMPRESA = SOURCE.CDEMPRESA
WHEN NOT MATCHED BY TARGET THEN
    INSERT (
        CDEMPRESA,
        RZSOCIAL,
        NMREDUZIDO,
        CGCMATRIZ,
        IMAGEMLOGO,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    )
    VALUES (
        SOURCE.CDEMPRESA,
        SOURCE.RZSOCIAL,
        SOURCE.NMREDUZIDO,
        SOURCE.CGCMATRIZ,
        SOURCE.IMAGEMLOGO,
        SOURCE.FGACTIVE,
        SOURCE.DHMAINTENANCE,
        SOURCE.SGUSER,
        SOURCE.SERVERORIG
    );

PRINT '   ✓ EMPRESA migrado: ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' registro(s)';
GO

