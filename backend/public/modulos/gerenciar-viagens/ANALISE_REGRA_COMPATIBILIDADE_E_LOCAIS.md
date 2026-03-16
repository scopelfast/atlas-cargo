# Análise: Regra de compatibilidade e locais (Gerenciar Viagens)

## 1. Premissa: o que a viagem sempre tem

Toda viagem possui obrigatoriamente:

- **Exige veículo rastreado:** Sim ou Não  
- **Classe de frota**  
- **Roteiro de embarque e desembarque** (origem e destino: `CDCIDADEORIGEM`, `CDCIDADEDESTINO` no roteiro)

As comparações e validações são feitas **a partir da viagem**, buscando motoristas que atendam a essas regras.

---

## 2. Como a compatibilidade está hoje no código

**Arquivo:** `backend/controllers/viagemmestre.controller.js` → método `buscarMotoristasCompatíveis`.

### Critérios aplicados hoje (todos obrigatórios quando existem)

| Critério | Fonte | Aplicado? |
|----------|--------|-----------|
| **Tipo de cadastro** | Viagem não define; lista quem é Motorista / Agente / Grupo / Transportador | ✅ Sim |
| **Classe de frota** | Viagem: `CDCLASSEFROTA` | ✅ Sim – motorista deve ter a mesma classe (CLASSEFROTA_CG ativa) |
| **Veículo rastreado** | Viagem: `FGRASTREADO` | ✅ Sim – se viagem exige, motorista deve ter `FGRASTREADO = 'S'` |
| **Destino preferido** | Viagem: cidade de destino (país, UF, cidade); Motorista: MOTORISTA_COMPLEMENTO (PAIS_DESTINO_PREF, SIGLA_ESTADO_DESTINO_PREF, CIDADE_DESTINO_PREF) | ✅ Sim – **somente quando a viagem tem cidade de destino**; quem tem preferência preenchida só entra se o destino da viagem bater |
| **Localização (micro-região)** | Viagem: origem e destino (CDCIDADEORIGEM, CDCIDADEDESTINO); Motorista: cidade do cadastro (CDCIDADE) | ❌ **Não** – no código há comentário explícito: *"Localização (cidade/micro-região) NÃO é critério obrigatório"* |

Ou seja: hoje **não** se filtra pela região do cadastro do motorista (embarque/desembarque). Só se filtra por tipo, classe, rastreado e (quando há destino) destino preferido.

---

## 3. O que a documentação diz vs código

- **DOCUMENTACAO_SISTEMA_CONVOCACOES.md** descreve **3** critérios: classe, rastreador e **localização (micro-região)** – motorista na mesma micro-região da **origem** ou do **destino**, ou na própria cidade de origem/destino.  
- **QUERY_MOTORISTAS_COMPATIVEIS.md** e o próprio código dizem que **localização não é critério** para listar.

Há, portanto, **inconsistência**: a regra de “locais” (micro-região / cidade do motorista vs embarque/desembarque) está documentada como desejada, mas **não está implementada** e não é configurável.

---

## 4. Regra dos locais: como entender e melhorar

### 4.1 Duas noções de “local”

1. **Região do cadastro do motorista (embarque / desembarque)**  
   - **Ideia:** motorista só é compatível se a **cidade dele** (cadastro) estiver “perto” do **embarque** ou do **desembarque** da viagem.  
   - **Implementação típica:** mesma **micro-região** da cidade de origem **ou** da cidade de destino; ou mesma **cidade** de origem ou destino.  
   - **Dados:** viagem → roteiro → `CDCIDADEORIGEM`, `CDCIDADEDESTINO`; motorista → `CADASTROGERAL.CDCIDADE`; cidades → `CIDADE.CDMICROREGIAO`, `ESTADO`, etc.  
   - **Limitação:** micro-região costuma existir para cidades brasileiras; para **Paraguai** (ou outros países) pode não haver CDMICROREGIAO, então essa regra sozinha não resolve o caso “cliente Paraguai”.

2. **Destino preferido do motorista**  
   - **Ideia:** motorista informa para onde **quer** ir (país, estado, cidades). Só aparece como compatível para viagens cujo **destino** bate com essa preferência.  
   - **Implementação:** já existe no código: quando a viagem tem `CDCIDADEDESTINO`, filtra por `PAIS_DESTINO_PREF`, `SIGLA_ESTADO_DESTINO_PREF`, `CIDADE_DESTINO_PREF`.  
   - **Vantagem:** funciona bem para **Paraguai** e qualquer país/estado/cidade, sem depender de micro-região.

### 4.2 Caso “cliente Paraguai”

- **Problema:** olhar só “região do cadastro” (micro-região de origem/destino) pode não incluir motoristas que **aceitam** ir ao Paraguai mas estão cadastrados no Brasil.  
- **Solução:** usar **destino preferido** como critério de “local”: motorista que informa país/estado/cidade de destino (ex.: PY ou BR + PR/SC/RS) só entra para viagens cujo destino bate. Assim, “locais” ficam claros em dois níveis:
  - **Onde o motorista “está” (cadastro):** micro-região da origem/destino (opcional, configurável).  
  - **Para onde o motorista “quer ir” (preferência):** destino preferido (já implementado; pode ser ligado/desligado por configuração).

---

## 5. Proposta: regras configuráveis no Gerenciar Viagens

Para deixar claro o que é usado e permitir evoluir (incluindo Paraguai) sem quebrar quem não usa micro-região:

### 5.1 Onde configurar

- **Local no programa:** módulo **Gerenciar Viagens**, em um ponto único de **configuração de regras** (aba “Regras de compatibilidade” ou seção dentro de “Compatíveis” ou de Configurações do módulo).  
- **Onde gravar:** tabela **CONFIGURACAO** (CHAVE / VALOR), como já é feito para outras opções do sistema.

### 5.2 Chaves sugeridas (CONFIGURACAO)

| CHAVE | VALOR | Descrição |
|-------|--------|-----------|
| `regra_compativel_filtro_local` | `nenhum` \| `microregiao` \| `destino_preferido` \| `ambos` | Qual regra de “local” usar ao buscar compatíveis. |
| `regra_compativel_microregiao_usa_origem` | `S` \| `N` | Se `microregiao` ou `ambos`: considerar origem do roteiro (embarque). |
| `regra_compativel_microregiao_usa_destino` | `S` \| `N` | Se `microregiao` ou `ambos`: considerar destino do roteiro (desembarque). |

**Comportamento resumido:**

- **`nenhum`:** não aplica nenhum filtro de local (comportamento atual de “locais” no código).  
- **`microregiao`:** só filtro por micro-região/cidade do cadastro do motorista (origem e/ou destino do roteiro, conforme os dois flags).  
- **`destino_preferido`:** só filtro por destino preferido (já implementado).  
- **`ambos`:** exige que o motorista atenda **micro-região** (quando ativa) **e** **destino preferido** (quando a viagem tem destino e o motorista tem preferência).

Assim, o “local” fica explícito: **embarque/desembarque** = micro-região (configurável); **destino desejado** = destino preferido (incluindo Paraguai).

---

## 6. Resumo para resposta direta

- **Como está sendo usada a regra de compatibilidade hoje:**  
  - **Sempre:** tipo de cadastro, classe de frota, veículo rastreado (quando a viagem exige).  
  - **Quando a viagem tem cidade de destino:** destino preferido (país/estado/cidade).  
  - **Não está sendo usada:** localização por micro-região/cidade do cadastro do motorista (embarque/desembarque).

- **O que melhorar nos locais:**  
  - Deixar **configurável** qual regra de “local” usar: nenhuma, micro-região (origem e/ou destino do roteiro), destino preferido, ou ambas.  
  - Manter destino preferido como regra que cobre bem o caso Paraguai (e outros países).

- **Onde configurar:**  
  - Em **Gerenciar Viagens**, em uma tela/seção dedicada a **“Regras de compatibilidade”**, gravando em **CONFIGURACAO** as chaves acima e lendo-as no endpoint que busca motoristas compatíveis.

Com isso, as viagens continuam obrigatoriamente com “exige rastreado”, “classe” e “roteiro”; as comparações continuam a partir da viagem; e a parte de “locais” fica clara e configurável, incluindo a melhoria para o cliente do Paraguai via destino preferido.
