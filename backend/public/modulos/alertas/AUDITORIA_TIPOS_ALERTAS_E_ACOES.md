# Auditoria: Tipos de Alerta, Roteiro e Ações Configuráveis

Documento profissional de revisão dos alertas do sistema: o que já existe, o que falta e como ficam as **ações ao gerar alerta** (Switch/WhatsApp: motorista, programador, central).

---

## 1. Cenários solicitados vs estado atual

| Cenário | No sistema | Configurável? | Observação |
|--------|------------|---------------|------------|
| **Desvio de rota** | ✅ Sim | ✅ `alert_tipo_desvio_ativo`, `alert_desvio_metros` | verificarDesvioRota em alert-service.js |
| **Atraso para chegada → carregamento → descarga** | Parcial | ✅ | Ver seção 2 |
| **Atraso para iniciar a viagem** | ❌ Não | — | A implementar (DTPREVINICIO vs primeira posição/macro) |
| **Paradas indevidas** | ✅ Sim (parada prolongada) | ✅ `alert_tipo_parada_ativo`, tempos/janela | verificarParadaProlongada |
| **Excesso de velocidade** | ❌ Não | — | A implementar (VIAGEMRASTREAMENTO.VELOCIDADE > limite) |
| **Baixo rendimento da viagem** | ❌ Não | — | A definir (ex.: km/h médio vs esperado; ver seção 3) |

---

## 2. Roteiro: Início, Parada, Fim (carregamento / descarga)

- **VIAGEMMESTRE:** `DTPREVINICIO` = previsão início/carregamento; `DTPREVFINAL` = previsão entrega/descarga.
- **TIPOOCORRENCIA (macros do motorista):**  
  Viagem - Início (103), Carga - Início (109), Carga - Fim (110), Descarga - Início (192), Descarga - Fim (111), Paradas (105, 106, 107, 58).
- **ROTEIROPONTOS:** TPLOCAL `O` (origem) e `D` (destino) para pontos da rota.

**Atraso para chegada:**

- **Carregamento:** previsão = `DTPREVINICIO`. Hoje não há verificação específica “atraso para chegar ao carregamento”. O ETA preventivo e o atraso usam principalmente o destino final (`DTPREVFINAL`). **Recomendação:** tratar “atraso para iniciar viagem” como: após `DTPREVINICIO`, ainda sem movimento/macro “Viagem - Início” (ou primeira posição) → alerta “atraso para iniciar”.
- **Descarga/entrega:** já coberto por `verificarAtraso` e ETA preventivo usando `DTPREVFINAL`.

Assim, **Início** = DTPREVINICIO + início da viagem; **Parada** = macros de parada e parada prolongada; **Fim** = DTPREVFINAL + atraso/ETA. Com a inclusão de “atraso para iniciar viagem” e mantendo atraso/ETA para entrega, o roteiro fica coberto de forma configurável.

---

## 3. Baixo rendimento da viagem (boas práticas)

Em controle logístico e risco costuma-se usar:

- **Rendimento operacional:** distância percorrida / tempo (km/h médio) vs esperado para a rota.
- **Desvio de tempo:** tempo decorrido vs tempo planejado (ex.: OSRM ou tempo padrão).
- **Combustível:** km/l (quando houver dado).

Para o sistema, uma definição simples e configurável:

- **Alerta “baixo rendimento”:** velocidade média real (últimas N posições ou trecho) **abaixo** de um mínimo configurável (ex.: 40 km/h em trecho de rodovia), indicando possível parada não informada ou trecho muito lento.  
- Ou: **tempo em movimento** muito menor que **tempo decorrido** (muita parada não declarada).

Recomendação: implementar em fase seguinte, com chaves tipo `alert_rendimento_velocidade_min_kmh` e `alert_tipo_rendimento_ativo`, para não atrasar o restante.

---

## 4. Gerenciar Tipo de Ocorrência (tipos e tempos)

- **TIPOOCORRENCIA** já possui (script `adicionar_controle_tempo_tipoocorrencia_postgres.sql`):
  - `FG_CONTROLE_TEMPO` (S/N): se controla tempo para alerta.
  - `TEMPO_MAXIMO_MINUTOS`: tempo máximo nessa situação antes de alerta.
- Uso: macros do motorista (Carga Início/Fim, Descarga Início/Fim, Paradas) com controle de tempo. Os **alertas automáticos** (parada, atraso, offline, desvio, ETA) são ligados/desligados pelas chaves `alert_tipo_*_ativo` na CONFIGURACAO; os **tipos de ocorrência** definem eventos do motorista e seus tempos máximos. Ambos devem permanecer alinhados: ex.: “parada prolongada” do job usa `alert_parada_*`; “parada indevida” pode considerar também se há macro registrada (parada sem macro = indevida).

---

## 5. Ações ao gerar alerta (Switch/WhatsApp)

Requisito: ao gerar um alerta, poder disparar mensagem via **API Switch** para:

- **Motorista**
- **Programador** (operador/planejador)
- **Central**

Tudo **configurável** no programa (quem notificar, por tipo de alerta, e futuramente templates).

### 5.1 Onde encaixar

- **Ponto único:** após `salvarAlerta` em `alert-service.js` retornar `true` → chamar um **serviço de notificações de alertas** (ex.: `alert-notification-service.js`).
- Esse serviço:
  1. Lê da CONFIGURACAO se envio WhatsApp está habilitado para aquele tipo de alerta.
  2. Lê **para quem** enviar (motorista, programador, central) por tipo.
  3. Obtém números (motorista da viagem/convocação; programador/central de config ou cadastro).
  4. Monta a mensagem (template com variáveis: `{id_viagem}`, `{tipo_alerta}`, `{nome_motorista}`, etc.).
  5. Chama a mesma API Switch já usada em convocações (reutilizar padrão de `enviarUmaMensagemSwitchDigital` ou função compartilhada).

### 5.2 Configurações necessárias (CONFIGURACAO)

- **Habiliar envio por tipo:**  
  `alert_whatsapp_tipo_parada`, `alert_whatsapp_tipo_atraso`, `alert_whatsapp_tipo_offline`, `alert_whatsapp_tipo_desvio`, `alert_whatsapp_tipo_eta_prazo`, `alert_whatsapp_tipo_atraso_inicio`, `alert_whatsapp_tipo_excesso_velocidade` (valores S/N).
- **Cooldown/refratário:**  
  `alert_cooldown_minutos` (evita recriar o mesmo alerta na mesma viagem logo após tratar/cancelar) e  
  `alert_whatsapp_reenvio_minutos` (evita reenvio repetido do mesmo tipo para o mesmo destino).
  - Regra operacional: `0` = sem cooldown.
- **Destinatários por tipo (ou globais):**  
  Ex.: `alert_whatsapp_notificar_motorista`, `alert_whatsapp_notificar_programador`, `alert_whatsapp_notificar_central` (S/N). Ou por tipo: `alert_whatsapp_[tipo]_motorista`, etc.
- **Números quando não for motorista:**  
  `alert_whatsapp_celular_central`, `alert_whatsapp_celular_programador` (ou vindo de USUARIO/CADASTRO por perfil).
- **Templates (opcional na primeira versão):**  
  `alert_whatsapp_template_parada`, `alert_whatsapp_template_atraso`, etc., com placeholders `{id_viagem}`, `{tipo_alerta}`, `{mensagem_alerta}`, `{nome_motorista}`.

Assim, **tudo fica no programa de configuração** (card Alertas + card Switch ou seção “Ações ao gerar alerta”), sem hardcode.

---

## 6. Resumo do que fazer

1. **Implementar tipos faltantes:**
   - **Atraso para iniciar viagem:** após `DTPREVINICIO`, sem primeira posição/macro “Viagem - Início” dentro de X minutos → alerta; chave `alert_tipo_atraso_inicio_ativo` e parâmetros (ex.: margem minutos).
   - **Excesso de velocidade:** posições com `VELOCIDADE > alert_excesso_velocidade_kmh` (janela/configurável) → alerta; chave `alert_tipo_excesso_velocidade_ativo`.
2. **Baixo rendimento:** deixar para próxima fase com `alert_rendimento_*` e `alert_tipo_rendimento_ativo`.
3. **Ações configuráveis:**  
   Chaves `alert_whatsapp_*` na CONFIGURACAO; serviço de notificação após `salvarAlerta`; reutilizar Switch; configurar quem notificar (motorista, programador, central) e, se desejado, templates por tipo.

Com isso, todos os cenários listados ficam cobertos ou planejados, e as ações ao gerar alerta passam a ser totalmente configuráveis no sistema.

---

## 7. Uso de alertas para pontuar motoristas (Ranking)

Para o módulo **Ranking** em construção: os alertas gerados (parada, atraso, offline, desvio, atraso_inicio, excesso_velocidade, eta_prazo) podem ser usados para **pontuar motoristas** (driver score). Ver o documento **`RANKING_ALERTAS_PONTUACAO.md`** nesta mesma pasta, com critérios sugeridos e boas práticas de mercado (escala 0–100, pesos por tipo de evento, agregação por período).
