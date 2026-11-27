# Inventário Funcional — Atlas Cargo

**Data:** 27/11/2026  
Descreve o comportamento real observado no código e nas capturas. Não inventa regras.

## Autenticação e shell

| Ação | API / efeito |
|---|---|
| Entrar (torre) | `POST /api/auth/login` → token + redirect `dashboard.html` |
| Alterar senha (modal login) | Fluxo de alteração autenticada no login (campos do modal) |
| Esqueci senha | `/recuperar-senha.html` → `/api/auth/recuperar-senha` + redefinir |
| Limite de sessão | Modal impede novo login até liberar vaga; registra em Logs de Acesso |
| Menu | `GET /api/menu/user-menu` filtrado por `USUARIOATIVIDADE` + módulo produto + licença |
| Tema | `data-theme` no documento; dark mode CSS global + por módulo |

## Cadastros e frota

CRUD padrão: Filtrar (GET lista) → Novo/editar (POST/PUT) → Excluir/inativar com confirmação.  
Cadastro Geral: aprovar motorista (`/api/motorista/aprovar-admin`), definir senha admin, vincular classes/veículos, import planilha.  
Equipamentos: ficha técnica (RENAVAM, chassi, capacidade tanque) — **não** gera OS de manutenção.

## Viagens e convocações

| Ação | O que acontece |
|---|---|
| Filtrar viagens | `GET /api/viagens` / pendentes |
| Salvar viagem | Persistência viagem + pontos/roteiro |
| Criar convocações | `aplicarGate` TENANT (Atlas Pay) → cria registros convocação / envio Switch |
| Confirmar convocação | Gate TENANT → TX confirmação + cobrança CONEXAO (se `FG_REGRA_ATIVA=S`) |
| Reativar / desistir lote | Cancela cobrança ABERTA ligada ao ciclo |
| Macros / prova entrega | APIs motorista + delivery-proof |

Motorista: `aceitarConvocacao` / `aceitarCarga` / interesse público → gate MOTORISTA.

## Campanhas
Disparar/pausar/retomar/reprocessar → `/api/oportunidades-campanhas/:id/*` com gate tenant no disparo.

## Gestão tempo real
- Alertas: listar/tratar/ler/histórico + contador no dashboard  
- Chat: conversas/mensagens/áudio/transcrição  
- SOS: listar/tratar/geocodificar  
- Mapa viagem: resumo + veículos em mapa  
- Ranking: **sem API** (incompleto)

## WMS

| Tela | Função-chave |
|---|---|
| Cadastros | Donos, armazéns, áreas, docas, produtos, de-para, import XML |
| Recebimento | Import NF-e XML, farol, validade mínima (perm. liberar) |
| Separação | Import OPL, programação, validação pedidos, reservas |
| Cargas | Programar/mesclar/distribuir NF × rota / vínculo viagem |
| Expedição | Conferência; bloqueio por divergência (perm. liberar) |
| Baixas | Preview + baixa + estorno |
| Inventário | Cíclico/manual/planilha |
| Transferências | Entre donos |
| Valor / Cobrança 7.1 | Dashboards e CSV — **distintos** do Atlas Pay |

## Sistema / SaaS / WhatsApp
- Usuários: atividades (=menus), empresas, filiais, tenant  
- Tipos Atividade: edita `DSPROGRAMA`/`FGGRUPO` (dono)  
- Configurações: Switch Digital, mensagens, contexto multipaís, mapa OSRM/Nominatim, OpenAI, app motorista  
- Tenants: planos, catálogo módulos, pedidos acesso, limpeza teste  
- Disparo WhatsApp: preview + enviar lista

## Atlas Pay (funcional)

| Aba | Capacidade |
|---|---|
| Visão geral | KPIs + warning inadimplência |
| Contratos | Versionar componentes; política ALERTA/BLOQUEIO; `FG_REGRA_ATIVA` |
| Fechamento de uso | Prévia → calcular → aprovar → gerar cobrança USO |
| Cobranças | Listar / baixa / cancelar (FIN_*) |
| Permissões | Perfis, overrides EFEITO, bootstrap admin, audit |

Gates Fase 4 (somente operações novas): aceitar convocação/carga/interesse; criar convocações; disparar campanha; confirmar. Fail-open com aviso. Sem status VENCIDA no banco.

## Dependências entre telas

- Viagens depende de Roteiros, Classes, Tipos/Situações, Cadastro Geral (contratador/motorista).  
- Campanhas depende de elegíveis (motoristas/viagens) + Switch.  
- WMS Expedição depende de Cargas + Separação.  
- Atlas Pay cobrança CONEXAO depende da confirmação em Viagens.  
- Cobrança WMS 7.1 **não** acopla Atlas Pay.

## Permissões
- Torre: `TIPOATIVIDADE` via `USUARIOATIVIDADE` (`DSPROGRAMA`).  
- Atlas Pay: atividade `atlas-pay` + catálogo FIN_* (STRICT após bootstrap).  
- WMS liberações: atividades específicas sem HTML próprio.
