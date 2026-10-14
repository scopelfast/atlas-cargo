# NF-e de saída WMS — Emitente × destino × entrega (cadastro)

Referência real: `41260508742760004840550010000018511000009629-nfe.xml` (Nutriville / Teknisa).

---

## Três papéis na nota (não misturar)

| Bloco XML | CNPJ exemplo Nutriville | Uso no Atlas |
|-----------|-------------------------|--------------|
| **emit** | `08.742.760/0048-40` (`08742760004840`) | **Dono do estoque WMS** na importação (quem fatura / filial que expede) |
| **dest** | `08.742.760/0001-86` (`08742760000186`) | Destinatário fiscal (matriz LTDA) |
| **entrega** | `08.742.760/0001-86` + endereço do ponto | **Parada da rota** — match com `CADASTRO_ENDERECO_ENTREGA` |

Os **pontos de entrega** no **Gerenciar Cadastro Geral** ficam no PJ do **dest/entrega** (`0001-86`, cadastro código **11**), **não** na filial emitente `0048-40`.

---

## Cadastro de pontos (operador)

1. Abra o cadastro PJ cujo CNPJ é o da **entrega** na NF (`CNPJ_ENTREGA` ou `dest`).
2. Aba **Endereços de entrega** → nome do ponto = `xNome` do bloco `<entrega>` (ex.: `…6013 - HPMP - CURITIBA PR MILI`).
3. Logradouro, número, CEP, UF, município e **coordenadas** iguais à nota.
4. Salvar.

---

## Montar paradas (Cargas programadas)

O sistema usa da NF gravada:

- `CNPJ_ENTREGA` (se houver) senão `CNPJ_DEST`
- `XNOME_ENTREGA` / endereço do bloco entrega (parser mescla `entrega` + `enderDest`)

Match: `CADASTRO_ENDERECO_ENTREGA` + `CADASTROGERAL` com **mesmo CNPJ 14 dígitos** do dest/entrega.

**Não** exige que o CNPJ da entrega seja igual ao **emitente**.

---

## Piloto NF 9001

- XML: `docs/amostras/nfe-saida-piloto-nf13243-minimo.xml` (estrutura como NF 1851, itens do espelho mínimo).
- Ajuste rápido no banco: `backend/scripts/wms_piloto_atualizar_nfe9001_endereco_entrega_postgres.sql`

---

*Maio/2026 — evita confundir filial emitente com matriz destino/entrega.*
