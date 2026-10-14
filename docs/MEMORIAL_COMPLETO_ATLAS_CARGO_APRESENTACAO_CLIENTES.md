# Atlas Cargo — Memorial completo para apresentação a clientes

**Versão do documento:** 1.0 · **Ano de referência:** 2026  

Este memorial descreve o produto comercial **Atlas Cargo** (plataforma web + app do motorista). O código-fonte e a documentação técnica interna podem usar o nome do repositório **SysScopel** — na comunicação com o mercado, o nome do produto é **Atlas Cargo**.

**Público:** decisores comerciais, operações, TI e segurança que avaliam uma solução de gestão de transporte de cargas com torre de controle e campo integrados.

**Objetivo:** ao final da leitura, o cliente deve enxergar *uma operação mais previsível, mais rápida e mais segura*, com menos atrito entre escritório e estrada — tudo sustentado por dados e comunicação no mesmo ecossistema.

---

## 1. Frase de abertura (elevator pitch)

**O Atlas Cargo é o elo digital entre a torre de operações e o motorista na estrada:** cadastros, viagens, mapa, convocações, chat, alertas, SOS, reputação e comprovante de entrega — num fluxo único, com a mesma base de dados e APIs modernas.

---

## 2. O problema que o mercado sente (e que o Atlas resolve)

| Dor comum | Como o Atlas Cargo responde |
|-----------|------------------------------|
| Planilhas, rádio e WhatsApp “soltos” sem histórico único | Registro centralizado de viagens, pessoas, frota e eventos |
| Torre sem visão geográfica da operação | Mapa de viagem, roteiros com pontos georreferenciados, GPS no app |
| Convocação lenta ou sem rastreio | Fluxo de convocações com relatório, links e integrações de mensageria (conforme ambiente) |
| Motorista desconectado da decisão | PWA/app alinhado ao backend: convocações, cargas, macros, POD |
| Incidentes sem canal formal | SOS, alertas configuráveis e chat torre–motorista |
| Qualidade da operação invisível | Ranking/reputação e indicadores no painel |
| Medo de “sistema frágil” | JWT, hardening HTTP (Helmet/CSP), caminho SaaS multi-tenant e logs de acesso |

---

## 3. O que é o Atlas Cargo (definição clara)

Plataforma **web** para **gestão de transporte de cargas**, com:

- **Portal da torre** (navegador): login, dashboard, módulos administrativos e operacionais carregados de forma modular.
- **Aplicativo / PWA do motorista**: páginas otimizadas para smartphone, mesma API (`/api/motorista`), com suporte a **notificações**, **modo offline** em partes do fluxo e **sincronização** de filas (ex.: comprovantes de entrega).
- **Backend** Node.js + Express, **PostgreSQL**, autenticação **JWT**, **tempo real** (WebSockets) onde aplicável, integrações com serviços de **mapas** (geocodificação, tiles, roteamento com OSRM e fallbacks configuráveis).

Ou seja: não é “só um cadastro”. É **operação de ponta a ponta** com foco em visibilidade, comunicação e rastreabilidade.

---

## 4. Para quem é o produto

- **Transportadoras** e **operadores de frota** que precisam padronizar cadastro, viagem e comunicação.
- **Centrais de despacho** que coordenam muitos motoristas e precisam de **mapa**, **alertas** e **SOS** sem trocar de ferramenta a cada etapa.
- **Contratantes / embarcadores** (via cadastro geral e vínculos operacionais) que exigem **prova de entrega** e histórico.
- **Gestão** que quer **indicadores**, **ranking** e **auditoria** (logs de acesso) para evoluir cultura e compliance.

---

## 5. Benefícios de usar o Atlas Cargo (mensagem para “brilhar os olhos”)

1. **Uma única verdade operacional** — Motorista, viagem, equipamento e documentos no mesmo repositório; menos versões conflitantes de “planilha mestre”.
2. **Velocidade na convocação** — Da necessidade à resposta do motorista, com trilha de status, relatórios e integração com ecossistema de mensageria quando habilitado (ex.: fluxos Meta/WhatsApp conforme contrato e ambiente).
3. **Visibilidade geográfica** — Roteiros vivos, mapa de viagem e posicionamento: a torre deixa de “imaginar” onde está a carga.
4. **Segurança jurídica e operacional** — Macros/ocorrências, comprovante de entrega (foto/POD), SOS e alertas: eventos **registrados**, não só conversados.
5. **Comunicação profissional** — Chat dedicado torre–motorista com indicadores no topo do painel (menos ruído em grupos informais).
6. **Cultura de qualidade** — Ranking e reputação incentivam bom desempenho e transparência.
7. **Experiência moderna** — Modo escuro, internacionalização (ex.: PT/ES em partes da interface), PWA instalável no celular do motorista.
8. **Escala e governança** — Perfis por **tipo de atividade**, módulos de produto (ex.: linhas de negócio), caminho **SaaS multi-tenant** e **administração de tenants** para quem opera a plataforma como serviço.
9. **Exportação e análise** — Excel em cadastros e equipamentos onde previsto; relatório dedicado de convocações.
10. **Continuidade no campo** — Fila offline para comprovantes e fluxos críticos: a operação não “morre” no primeiro túnel ou falha de sinal.

---

## 6. Visão em camadas (como o cliente imagina o sistema)

```
                    ┌─────────────────────────────────────┐
                    │   Decisão e governança (torre web)   │
                    │  Dashboard · módulos · relatórios    │
                    └─────────────────┬───────────────────┘
                                      │ API REST + tempo real
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   Cadastros & catálogos        Operação (viagens,            Confiança
   Empresa, frota, rotas        mapa, convocações)           Chat, alertas,
                                │                            SOS, ranking
                                ▼
                    ┌─────────────────────────────────────┐
                    │   Execução (motorista / PWA)         │
                    │  Convocações · viagens · GPS · POD   │
                    └─────────────────────────────────────┘
```

---

## 7. Telas e pontos de entrada principais (portal web)

| Tela / rota | Função |
|-------------|--------|
| **`/` ou `/login`** | Autenticação da torre; identidade visual configurável (logos). |
| **`/dashboard`** | Hub após login: menu lateral dinâmico (por perfil), **seletor de módulo de produto** quando aplicável, atalhos no cabeçalho para **Chat**, **Alertas**, **SOS** e **motoristas pendentes de aprovação**, badges de pendências. |
| **`/modulos/...`** | Cada funcionalidade carrega como módulo em `iframe` ou navegação interna (padrão do projeto). |
| **`/convocacao/:id`** | Página pública para o motorista **responder convocação** sem instalar app (fluxo por link). |

---

## 8. Catálogo de módulos da torre (o que cada um faz)

Os itens abaixo correspondem às pastas em `backend/public/modulos/`. Na prática, o menu exibido para cada usuário depende de **permissões** (tipos de atividade) e, quando configurado, de **módulo de produto** e **licenças SaaS**.

### 8.1 Operação e viagem

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Gerenciar viagens** | Criação, edição, acompanhamento de viagens; múltiplos veículos/motoristas; convocações; integração com disparo/webhook; WebSocket na torre para atualização em tempo quase real. | Menos retrabalho; status visível; convocação acoplada à viagem. |
| **Gerenciar roteiros** | Rotas com pontos (origem, passagem, destino, paradas), apoio a geocodificação e distâncias. | Planejamento alinhado ao mapa real; menos erro de “cidade errada”. |
| **Gerenciar mapa de viagem** | Visualização operacional das viagens no mapa. | Centro de comando visual; priorização rápida. |
| **Gerenciar situações de viagem** | Cadastro de situações (workflow operacional). | Linguagem única entre torre e relatórios. |
| **Gerenciar tipos de viagem** | Classificação das viagens. | Regras e relatórios consistentes. |
| **Relatório de convocações** | Análise e estatísticas do funil de convocação. | Gestão por dados; acerto de gargalos. |
| **Gerenciar disparo WhatsApp** | Apoio a fluxos de disparo/integração de convocação (conforme configuração). | Automação onde o ambiente permite; menos clique manual. |

### 8.2 Cadastro mestre e rede

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Gerenciar cadastro geral** | Motoristas, transportadores, contratadores; exportação Excel; campos operacionais e preferências (ex.: locais de embarque/desembarque documentados no projeto). | Base única de parceiros; due diligence mais simples. |
| **Gerenciar empresas** | Empresas do grupo. | Multiempresa organizada. |
| **Gerenciar filiais** | Unidades. | Rateio e visão por filial. |
| **Gerenciar cidades** | Cadastro municipal. | Endereços e rotas confiáveis. |
| **Gerenciar estados** | Unidades federativas. | Consistência com cidades e filtros. |
| **Gerenciar mesorregião** | Agrupamento geográfico intermediário. | Planejamento regional e convocação por região. |

### 8.3 Frota e equipamentos

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Gerenciar marcas** | Marcas de veículos/equipamentos. | Catálogo limpo. |
| **Gerenciar grupos** | Agrupamento de equipamentos/frota. | Políticas e buscas por grupo. |
| **Gerenciar classes de frota** | Classes/tipos de veículo da operação. | Compatibilidade viagem–veículo. |
| **Gerenciar tipos de equipamento** | Tipologia. | Padronização de cadastro. |
| **Gerenciar modelos de equipamento** | Modelos vinculados a marca/tipo. | Manutenção e especificação corretas. |
| **Gerenciar equipamentos** | Frota física; exportação Excel onde previsto. | Controle patrimonial e operacional. |

### 8.4 Pessoas, acesso e configuração

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Gerenciar usuários** | Usuários da torre, vínculo com atividades. | Menor risco de acesso indevido. |
| **Gerenciar tipos de atividade** | O que cada perfil pode acessar (menu granular). | Governança fina; onboarding de equipe rápido. |
| **Gerenciar configurações** | Parâmetros do sistema, URLs de mapas (Nominatim/ORS), **identidade visual** (logos retangular/quadrada), demais chaves operacionais. | Marca branca e ajuste sem recompilar código. |
| **Gerenciar logs de acesso** | Auditoria de acessos. | Compliance e investigação de incidentes. |

### 8.5 Qualidade, segurança e comunicação

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Alertas** | Central de alertas operacionais com regras e auditoria (documentação técnica extensa no próprio módulo). | Antecipação de risco; padronização de resposta. |
| **Chat** | Mensagens torre–motorista; badge no dashboard. | Menos telefone solto; histórico no sistema. |
| **SOS** | Registro e acompanhamento de ocorrências críticas. | Resposta coordenada em emergência. |
| **Ranking / reputação** | Visão de desempenho de motoristas (reputação). | Cultura de excelência; decisão de alocação mais justa. |

### 8.6 Validades e ocorrências

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Gerenciar tipos de validade** | Tipos de documento/certificação com validade. | Estrutura para compliance. |
| **Controle de validade** (API/backoffice conforme menu) | Acompanhamento de vencimentos. | Redução de multa e bloqueio operacional. |
| **Gerenciar tipo de ocorrência** | Catálogo para macros/eventos. | Dados homogêneos para BI. |

### 8.7 Crescimento comercial e plataforma SaaS

| Módulo | Para que serve | Benefício ao cliente |
|--------|----------------|----------------------|
| **Campanhas e oportunidades** | Divulgação de demandas/campanhas (linha evolutiva do produto). | Conectar oferta e motorista com governança. |
| **Gerenciar tenants SaaS** | Administração de clientes/organizações na plataforma multi-tenant. | Quem vende software escala com isolamento lógico. |

---

## 9. Aplicativo do motorista (PWA) — telas e funções

Base em `backend/public/motorista/`. O motorista acessa em geral por subcaminho dedicado (ex.: `/motorista/`), com **manifest** e **service worker** para experiência de app.

| Página / função | Para que serve |
|-------------------|----------------|
| **Entrada / login** | Autenticação do motorista; recuperação de senha. |
| **Cadastro** | Autocadastro com apoio a OCR (Tesseract) em documento, quando utilizado — reduz fricção na admissão. |
| **Dashboard** | Resumo da jornada e atalhos. |
| **Convocações** | Lista e resposta às convocações recebidas. |
| **Viagens** | Viagens em andamento e histórico. |
| **Detalhes da viagem** | Informações completas; integração com **fotos de comprovante** (`delivery-proof`) por viagem. |
| **Cargas** | Acompanhamento de cargas vinculadas à operação. |
| **Macros / eventos** | Registro estruturado de ocorrências no percurso. |
| **Comprovar entrega (POD)** | Envio de comprovante com foto; fila **offline** com sincronização posterior. |
| **GPS / enviar posição** | Captura e envio de localização conforme política do app. |
| **GPS visualização / rastreamento / ajuda GPS** | Apoio à transparência e troubleshooting de localização. |
| **Chat** | Comunicação com a torre (inclui variante standalone quando necessário). |
| **SOS** | Acionamento e acompanhamento de emergência. |
| **Notificações / configurações** | Preferências de alertas no dispositivo. |
| **Oportunidades públicas** | Visualização de oportunidades/campanhas quando liberado. |
| **Diagnóstico** | Apoio a suporte em campo. |

**Mensagem de venda:** o motorista não é um “usuário secundário” — é **protagonista** do mesmo modelo de dados que a torre, com continuidade offline onde importa.

---

## 10. Fluxos operacionais que o cliente reconhece imediatamente

1. **Abrir demanda → montar viagem → anexar roteiro → convocar motorista → acompanhar no mapa.**  
2. **Motorista aceita convocação (app ou link público) → inicia jornada → registra macros → entrega com POD.**  
3. **Torre vê alerta ou SOS → abre chat ou mapa → toma decisão com histórico.**  
4. **Gestão extrai relatório de convocações e ajusta SLA da central.**  
5. **Operação comercial publica oportunidade → motoristas engajados respondem dentro do ecossistema.**

---

## 11. Integrações e infraestrutura de mapas (mensagem técnica “de confiança”)

- **Geocodificação e roteamento:** integração com serviços configuráveis (incluindo **Nominatim** e **OpenRouteService** / espelhos), com **fallback** público (ex.: OSRM) quando apropriado — detalhes em variáveis de ambiente e módulo de configurações.
- **Convocações e Meta/DeskRio:** conforme documentação do projeto, há fluxo de **webhook** para envio/resposta automática de convocações quando o ambiente está habilitado — sempre alinhar expectativa ao **contrato** e à **configuração** efetiva.
- **Tempo real:** uso de WebSockets na torre (ex.: painel de viagens) para reduzir refresh manual.

---

## 12. Segurança, privacidade e governança (tópico obrigatório em RFP)

- **Autenticação JWT** e verificação de sessão na torre.
- **Headers de segurança** (Helmet), **CSP** elaborado para mapas, CDNs e recursos do app.
- **Isolamento multi-tenant** em evolução no código (middleware de tenant, entitlements, scripts SQL de adoção).
- **Logs de acesso** para auditoria.
- **CORS** configurável para produção (`CORS_ORIGINS`).

*Nenhum sistema substitui políticas internas de LGPD/GDPR — mas o Atlas oferece alavancas técnicas (controle de acesso, auditoria, segregação) para o programa de compliance da transportadora.*

---

## 13. Diferenciais em relação a “planilha + WhatsApp”

| Aspecto | Planilha + grupos de mensagem | Atlas Cargo |
|---------|------------------------------|-------------|
| Histórico | Fragmentado | Centralizado por viagem, motorista e módulo |
| Mapa | Inexistente ou manual | Mapa e roteiro integrados |
| Convocação | Sem métrica confiável | Relatório e status rastreáveis |
| Prova de entrega | Foto perdida no grupo | POD vinculado à viagem, com visualização na torre |
| Emergência | Telefone em cadeia | SOS e alertas com contexto |
| Escalabilidade | Difícil | Caminho SaaS, módulos e perfis |

---

## 14. Roteiro sugerido para uma apresentação comercial (45–60 min)

1. **Contexto** — dores da operação fragmentada.  
2. **Promessa** — uma frase: torre + estrada no mesmo sistema.  
3. **Demo torre** — dashboard → viagem → mapa → convocação.  
4. **Demo motorista** — convocação → viagem → POD (e offline, se for caso de uso).  
5. **Confiança** — chat, alertas, SOS, ranking.  
6. **Governança** — usuários, perfis, logs, tenant (se for B2B2B).  
7. **Integrações** — mapas + Meta/webhook conforme realidade do cliente.  
8. **Fechamento** — próximos passos (piloto, carga de cadastro, treinamento).

---

## 15. Mensagem final (slide de fechamento)

**Atlas Cargo não é só cadastro nem só rastreador — é o sistema em que a decisão da torre vira execução na estrada, com mapa, conversa, alerta e prova no mesmo lugar.**  

Quem opera transporte sabe: o margem vive no detalhe. **Detalhe com dado vira vantagem.**

---

## 16. Nota sobre evolução do produto

Funcionalidades e módulos podem ser **licenciados por tenant** ou **condicionados a tipo de atividade**. A lista deste memorial reflete a **base de código** do repositório na data da elaboração do documento; o **escopo contratual** comercial final pode ser um subconjunto — o que reforça flexibilidade de go-to-market.

---

*Documento gerado para apresentação a novos clientes. Para material enxuto de slides e prompts de imagem, ver também `docs/MEMORIAL_APRESENTACAO_ATLAS_CARGO.md`. Para visão técnica e instalação, ver `README.md` na raiz do repositório.*
