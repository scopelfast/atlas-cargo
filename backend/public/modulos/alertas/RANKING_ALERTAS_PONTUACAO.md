# Uso de alertas para pontuar motoristas (ranking)

Documento de apoio ao módulo **Ranking**: como usar os alertas gerados pelo sistema para avaliar e pontuar motoristas, com base em boas práticas de mercado.

---

## 1. Conceito: Driver Score

- **Driver Score** é uma métrica de 0 a 100 que reflete desempenho e segurança do motorista.
- Pontuação **maior** = melhor conduta (menos eventos negativos).
- Usado para: ranking, bonificações, treinamento, gestão de risco.

---

## 2. Eventos que podemos mapear a partir dos nossos alertas

| Alerta no sistema        | Uso no ranking                         | Peso sugerido (ex.) |
|---------------------------|----------------------------------------|----------------------|
| **Parada prolongada**     | Parada indevida / tempo parado excesso | -10 a -20 por evento |
| **Atraso**                | Atraso na entrega                      | -15 a -25 por evento |
| **ETA preventivo**        | Risco de atraso                        | -5 a -10 (preventivo)|
| **Offline**               | Falta de comunicação / rastreio       | -20 a -30 (crítico)  |
| **Desvio de rota**        | Desvio não autorizado                  | -15 a -25 por evento |
| **Atraso para iniciar**   | Atraso no início da viagem             | -10 a -15 por evento |
| **Excesso de velocidade** | Infração de velocidade                 | -20 a -30 (alto risco)|

Cada tipo pode ter **peso configurável** (ex.: excesso de velocidade penaliza mais que ETA preventivo).

---

## 3. Boas práticas de mercado (referências)

- **Escala 0–100:** pontuação base 100; cada evento **desconta** pontos conforme peso.
- **Período:** calcular score por período (ex.: mês, trimestre) e por viagem.
- **Ponderação por severidade:** alertas `high` penalizam mais que `medium`.
- **Agregação por motorista:** somar eventos do motorista no período e aplicar regra de desconto (ex.: até um teto máximo de desconto por tipo).
- **Transparência:** critérios e pesos configuráveis e visíveis para o motorista.

---

## 4. Sugestão de implementação no Ranking

1. **Tabela ou vista:** contar alertas por motorista e por tipo (e opcionalmente por severidade) no período.
2. **Fórmula configurável:**  
   - Pontos iniciais = 100.  
   - Para cada tipo de alerta: `desconto = min(quantidade × peso_tipo, teto_tipo)`.  
   - Score final = 100 - soma dos descontos (mínimo 0).
3. **Configuração:** pesos e tetos por tipo de alerta em CONFIGURACAO ou tabela de parâmetros do ranking.
4. **Exibição:** ranking ordenado por score; detalhamento por motorista (quantidade de cada tipo de alerta no período).

---

## 5. Referências rápidas

- Infleet, Cobli, Geotab, Ikonn, Ayvens: uso de driver score e eventos (excesso de velocidade, freadas, acelerações, desvios).
- Nossa tabela **ALERTS** já possui: IDVIAGEM, CDMOTORISTA, TYPE, SEVERITY, CREATED_AT — suficientes para agregação por motorista e tipo no período.

Documento criado para apoio à construção do programa de Ranking.  
Ver também: `AUDITORIA_TIPOS_ALERTAS_E_ACOES.md` (tipos de alerta e ações configuráveis).
