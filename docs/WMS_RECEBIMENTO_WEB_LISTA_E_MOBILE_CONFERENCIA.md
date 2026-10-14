# WMS — Recebimento (NF-e): escopo **web (Torre)** + lista + conferência **mobile** (acordado)

**Status:** fechamento de escopo operacional (documento vivo).  
**Relaciona com:** `docs/PLANO_ESTOQUE_TERCEIROS_E_CROSSDOCKING_ATLAS_CARGO.md`, `docs/RF_WMS_ATLAS_v1.md`.

---

## 1. Objetivo deste documento

Registrar **o que funciona na web (Torre)** no módulo **Recebimento (NF-e)**, com ênfase na **lista** (grid + documento impresso de conferência), e **o que está acordado** para a **conferência pelo aplicativo móvel** — sem implementar o mobile neste fechamento, apenas contrato de comportamento.

---

## 2. O que funciona na **web (Torre)** — Recebimento (NF-e)

### 2.1 Lista de recebimento = **grid de NF-e importadas**

| Funcionalidade | Comportamento acordado |
|----------------|-------------------------|
| **Filtros** | Dono do estoque (opcional); parte da chave NF-e; número NF; **período “Recebimento” (de/até)** usando `COALESCE(DH_CONFERENCIA, DH_IMPORTACAO)` em data; **situação (farol)** — `verde` (só importada), `amarelo` (conferência gravada e NF aberta), `vermelho` (encerrada), parâmetro API `statusFarol`. |
| **Grid** | Lista documentos; coluna **Status** única (**farol** + **✓/✗** conferência gravada; tooltip na célula; legenda na aba Grid); abre **detalhe** ao editar; exclusão de importação **permitida** (`DELETE` do documento), com confirmação. |
| **Importação** | XML NF-e; dono opcional com **vínculo automático** pelo CNPJ do destinatário quando aplicável. |
| **Detalhe / conferência** | Espelho dos itens; de-para e fator (preparados na torre / cadastros); **nome do conferente** obrigatório na web; validação de **lote/validade** conforme cadastro do produto dono. |
| **Impressão — lista de conferência** | Documento com metadados da NF, destinatário com CNPJ, emissão, **data/hora da impressão**, tabela dos itens conforme tela (inclui alterações ainda não salvas conforme texto atual do módulo). |
| **Impressão — etiquetas** | Layout **19 × 13 cm** por etiqueta; **2 etiquetas por folha A4 retrato** (agrupadas em folha lógica); quantidades principal/secundária (ex.: estoque × NF); validade em **DD/MM/AAAA**. |
| **Encerramento / reabertura** | **Encerrar NF** e **reabrir NF** na **web**; bloqueio de edição quando encerrada; reabertura com motivo. **Mobile não encerra** (ver §3). |
| **Autorização de faturamento / AF** (ou autorização de fornecimento) | **Não cadastrada no sistema.** Documento **externo** (papel/PDF) para o conferente **conferir com a nota**; processo e auditoria **operacional**, não tabela de AF no Atlas neste fechamento. |
| **Crossdocking em lote** | **UI desligada** por priorização do fluxo de **estoque de terceiros**; APIs e pendências de evolução registradas no plano (§15 do plano conceitual). |

### 2.2 “Lista de recebimento” — sentidos no produto

1. **Lista no sentido operacional (tela):** o **grid** após **Filtrar** — é a lista de recebimentos (importações) do tenant.  
2. **Lista no sentido documento:** **“Lista conferência”** (impressão/PDF) — espelho para assinatura e arquivo físico.

Ambos ficam **no escopo web** conforme tabela acima.

### 2.3 Fora do escopo web neste fechamento

- Integração automática de AF (PDF/planilha) — **não** há ingestão de AF.  
- Conferência completa **substituindo** a torre — **mobile** é complemento futuro (§3).  
- Etiqueta **só** pelo mobile — não acordado; impressão tratada na torre / PDF.

---

## 3. Conferência pelo **mobile** — acordado (MVP conceitual)

| Tema | Decisão |
|------|---------|
| **Campos na doca** | Principalmente **quantidade recebida**, **lote** e **validade** quando o cadastro do produto **exigir**; se **não** exigir, **não exibir** esses campos (evitar poluição e erro). |
| **De-para e fator** | **Sob controle na torre** antes da doca; mobile não substitui parametrização. Itens sem preparação adequada: política de **bloqueio** ou “resolver na torre” (detalhar na implementação). |
| **Conferente** | Identificação pelo **usuário logado** (nome/sessão); alinhado à política de sessões da torre (limite / confirmação de encerrar sessão anterior). |
| **Encerrar recebimento** | **Somente na web (Torre)** — não no mobile. |
| **AF** | **Somente conferência visual** com o documento que acompanha a operação; **sem registro** de AF no sistema neste desenho. |
| **Offline** | Fora do MVP inicial; primeira entrega **online**. |

### 3.1 Fluxo mobile resumido (4 passos)

1. Entrar na NF (lista de pendentes ou busca por chave/`CD_NFE` — detalhe técnico na implementação).  
2. Ver cabeçalho / itens (leitura).  
3. Preencher apenas o **físico** acordado por item; salvar via mesma API de conferência da torre.  
4. **Não** encerrar NF no aparelho.

### 3.2 Próximos passos técnicos (quando for implementar)

- Opcional no backend: se `nmConferente` vier vazio no `PUT .../conferencia`, preencher com **nome do usuário** do token (mobile).  
- Opcional: filtro `fgConferido=N` em `GET .../documentos` para lista de pendentes no app.  
- Tela(s) no PWA motorista ou módulo dedicado “doca”, reutilizando **JWT + tenant**.

---

## 4. Rastreabilidade

Alterações de código relacionadas a este fechamento devem referenciar este arquivo em PR/commit quando forem tocadas de novo (recebimento, impressões, exclusão, filtros de data, travas).

---

*Última atualização: acordo de escopo web + mobile conferência + AF apenas documental.*
