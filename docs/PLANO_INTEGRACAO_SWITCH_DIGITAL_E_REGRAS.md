# Plano: Integração Switch Digital (WhatsApp) e Regras Configuráveis

Documento de alinhamento e visão. **Não implementar tudo de uma vez** — ir com calma para não atropelar.

---

## 1. WhatsApp somente via Switch Digital quando configurado

- **Regra:** Todo e qualquer envio de WhatsApp (convocações, confirmação, “não selecionado”, alertas, SOS, etc.) deve usar **apenas** a Integração Switch Digital (WhatsApp).
- **Quando não configurado:** Não tentar enviar. Exibir mensagem clara para o usuário, por exemplo:
  - *"O envio por WhatsApp não está disponível. Configure a Integração Switch Digital (WhatsApp) em Configurações do Sistema."*
- Não deve existir mais “processo de envio de WhatsApp padrão” fora da Switch Digital; quando habilitada e configurada, só ela é usada.

---

## 2. Mensagem “Parabéns, você foi selecionado”

- Incluir na mensagem: **com quem falar** e **número** (contratador).
- Opcional: rota, carregamento/descarga (já existem em outro trecho).
- Objetivo: motorista saber exatamente com quem falar e como.

---

## 3. Textos padrão em Configurações com variáveis `{variavel}`

### 3.1 Várias mensagens cadastradas

- Não apenas 2 ou 3 textos fixos: ter um **cadastro de modelos de mensagem** (inúmeros).
- Cada modelo com:
  - Nome/identificador (ex.: "Convite de convocação", "Motorista atrasado", "Não está usando o app", "Tempo parado excedido", "Não selecionado", etc.).
  - Texto com variáveis em `{variavel}`.
  - Onde/quando usar (opcional): convocação, alerta, SOS, atraso, etc.
- Permitir cenários como: mensagem quando não estiver usando o app do motorista; quando atrasado; quando exceder tempo parado; etc.

### 3.2 Bloco explicando cada variável

- Na tela de Configurações (ou ao lado do campo de texto), um **bloco fixo** “Variáveis disponíveis” com explicação simples, por exemplo:
  - `{id_viagem}` → Número da viagem
  - `{nome_motorista}` → Nome do motorista
  - `{contratador_nome}` → Nome do contratador
  - `{contratador_telefone}` → Telefone do contratador
  - `{rota}` → Descrição da rota
  - `{carregamento}` → Data/hora prevista de carregamento
  - `{descarga}` → Data/hora prevista de descarga
  - `{link_convocacao}` → Link para aceitar/recusar convocação
  - (outras conforme necessidade)
- Objetivo: o operador editar os textos sem precisar de documentação externa.

---

## 4. Ao aprovar motorista (Confirmar convocação)

- Além de marcar a convocação como CONFIRMADA e enviar WhatsApp (se Switch Digital configurada):
  - **Gravar o motorista aprovado** na tabela de “motoristas da viagem” (Gerenciar Viagens → Gerenciar Motorista da Viagem → Motoristas Cadastrados para esta Viagem).
  - Objetivo: não precisar adicionar o motorista manualmente depois.
- **FGSITVIAGEM:** ao aprovar, se ainda não estiver “programada”, atualizar para **programada**.

---

## 5. Ao Reativar convocações

- Além do que já existe (status das convocações, etc.):
  - **Retirar** da viagem o motorista que estava **confirmado** (remover de “Motoristas Cadastrados para esta Viagem”).
  - **FGSITVIAGEM:** voltar para **preparação**.

---

## 6. Tudo configurável em Configurações do Sistema

- As regras acima (adicionar motorista ao confirmar, remover ao reativar, mudar FGSITVIAGEM para programada/preparação) devem ser **ligadas/desligadas** (ou parametrizadas) no programa **Configurações do Sistema**, por exemplo:
  - Ao confirmar convocação:
    - [ ] Adicionar motorista automaticamente em “Motoristas da Viagem”
    - [ ] Atualizar FGSITVIAGEM para “programada”
  - Ao reativar convocações:
    - [ ] Remover motorista confirmado de “Motoristas da Viagem”
    - [ ] Voltar FGSITVIAGEM para “preparação”
- Textos padrão da Switch Digital (templates com variáveis) também configuráveis em Configurações.

---

## 7. Visão geral: várias integrações com Switch Digital

- **Um único canal configurável:** Switch Digital (WhatsApp).
- **Vários “gatilhos”:** convocação, confirmação, alerta, SOS, chat, atraso, tempo parado, não uso do app, etc.
- Para cada gatilho: qual mensagem (template) enviar, para quem, quando.
- Objetivo: facilitar a vida dos operadores e motoristas e ajudar a vender o sistema.
- **Multi-tenant (SaaS):** cada cliente pode ter sua própria configuração da Switch Digital, seu conjunto de mensagens e suas regras (quem acionar, como, por onde). Preparar para SaaS multi-tenant.

---

## 8. Workflow no próprio sistema

- **Sim, é possível** ter um “workflow” dentro do sistema.
- **Abordagem em fases:**
  - **Fase atual:** Cadastro de modelos de mensagem (inúmeros) com variáveis e bloco explicativo; integração única com Switch Digital; regras em Configurações (checkboxes e seleções) para cada ação (confirmar, reativar, eventos de alerta/SOS/atraso, etc.). Sem motor de workflow pesado.
  - **Próximo passo:** Motor de regras simples: “Evento X → aplicar regras (por tenant, no futuro) → executar ações (ex.: enviar mensagem Y por Switch Digital)”. Regras em banco, código só executa o configurado.
  - **Futuro (se fizer sentido):** Workflow mais visual (fluxo com passos e condições) para clientes com necessidades muito específicas.
- Ir com calma: primeiro regras configuráveis e templates; depois evoluir para motor de regras e, se necessário, workflow visual.

---

## Resumo rápido

| Tema | Decisão |
|------|--------|
| WhatsApp | Só via Switch Digital quando configurada; mensagem clara quando não configurado |
| Mensagem “Parabéns” | Incluir com quem falar e número (contratador) |
| Templates | Várias mensagens cadastradas; variáveis `{variavel}`; bloco explicando cada variável |
| Confirmar convocação | Gravar motorista na viagem; FGSITVIAGEM = programada (tudo configurável) |
| Reativar convocações | Remover motorista confirmado; FGSITVIAGEM = preparação (tudo configurável) |
| Configurações | Tudo ligado a Configurações do Sistema |
| Integrações | Alertas, SOS, chat, atraso, etc. usando Switch Digital; visão multi-tenant |
| Workflow | Possível; começar com regras configuráveis, depois motor de regras |

---

*Documento criado para não perdermos o alinhamento. Implementação em etapas, sem atropelar.*
