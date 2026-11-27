# Atlas Pay — Fase 3: decisões comerciais (definitivas)

**Data:** 26/11/2026  
**Status:** **Aplicadas** na implementação (`docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md`).

| ID | Escolha | Resumo |
| --- | --- | --- |
| D1 | **C** | 1ª convocação por viagem (`DHCONVOCACAO`); mãe agrupadora fora; filhas contam; cancelamento posterior não remove |
| D2 | **A** | Base `%` = soma `VLFRETE` das anunciadas; inválido → exceção + bloqueio aprovação |
| D3 | **B** | Partir competência por vigência; FIXO pró-rata; eventos no contrato da data |
| D4 | **B** | Regra N: prévia diagnóstica; bloqueia aprovação e cobrança |
| D5 | Mensal SP | `[1º 00:00, 1º+1 00:00)`; vencimento = aprovação + 10 dias corridos |
| D6 | **A** | Beneficiário `default` |
| D7 | **A** | Sem USO ativo → prévia R$ 0 / `SEM_COMPONENTE_USO_PLATAFORMA` / sem cobrança |
