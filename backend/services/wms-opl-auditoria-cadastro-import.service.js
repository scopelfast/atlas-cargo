'use strict';

/**
 * Auditoria de cadastro WMS após importação de espelho OPL.
 * Lista códigos sem produto, sem conservação ou com SECO no cadastro mas frio por NCM/descrição.
 */

const {
  chaveCanonicaDigitosOl,
  mascaraCodigoOl,
  classificarConservacaoDetalhe,
} = require('./wms-opl-relatorio-romaneio.service');

const LIMITE_LISTA = 80;

function motivoFrioInferido(det) {
  if (det.frioTipo === 'CONGELADO') return 'NCM ou descrição indicam congelado';
  if (det.frioTipo === 'RESFRIADO') return 'NCM ou descrição indicam refrigerado';
  return 'NCM ou descrição indicam produto de câmara fria';
}

/**
 * @param {{ pedidos: object[] }} data — pedidos com itens (COD_PRODUTO_OL, DESCRICAO)
 * @param {Record<string, { TIPO_ARMAZENAGEM?: string, NCM?: string }>} produtoPorDigitos — só dono do espelho
 * @param {{
 *   cdDonoEspelho?: number|null,
 *   nmDonoEspelho?: string,
 *   porDigitosOutrosDonos?: Record<string, Array<{ cdDono: number, nmDono: string }>>,
 * }} [opts]
 */
function auditarCadastroProdutosEspelhoOpl(data, produtoPorDigitos, opts) {
  const mapa = produtoPorDigitos && typeof produtoPorDigitos === 'object' ? produtoPorDigitos : {};
  const op = opts && typeof opts === 'object' ? opts : {};
  const outrosMap =
    op.porDigitosOutrosDonos && typeof op.porDigitosOutrosDonos === 'object'
      ? op.porDigitosOutrosDonos
      : {};
  const rotuloDonoEsp =
    op.nmDonoEspelho && op.cdDonoEspelho != null
      ? `${op.nmDonoEspelho} (${op.cdDonoEspelho})`
      : op.nmDonoEspelho || (op.cdDonoEspelho != null ? `dono ${op.cdDonoEspelho}` : 'dono do espelho');
  /** @type {Map<string, { codigoOl: string, digitos: string, descricao: string, ocorrencias: number }>} */
  const porCodigo = new Map();

  for (const p of data.pedidos || []) {
    for (const it of p.itens || []) {
      const cod = String(it.COD_PRODUTO_OL ?? it.codProdutoOl ?? '').trim();
      const dkey = chaveCanonicaDigitosOl(cod);
      if (!dkey) continue;
      const desc = String(it.DESCRICAO ?? it.descricao ?? '').trim();
      let row = porCodigo.get(dkey);
      if (!row) {
        row = { codigoOl: cod, digitos: dkey, descricao: desc, ocorrencias: 0 };
        porCodigo.set(dkey, row);
      }
      row.ocorrencias += 1;
      if (desc && (!row.descricao || row.descricao.length < desc.length)) row.descricao = desc;
    }
  }

  const sem_cadastro = [];
  const cadastrado_outro_dono = [];
  const sem_conservacao = [];
  const seco_suspeito_frio = [];

  for (const row of porCodigo.values()) {
    const cad = mapa[row.digitos] || null;
    const det = classificarConservacaoDetalhe(row.descricao, cad);
    const base = {
      codigoOl: row.codigoOl,
      codigoMascara: mascaraCodigoOl(row.codigoOl),
      descricao: row.descricao || '—',
      ocorrencias: row.ocorrencias,
      inferidoRomaneio:
        det.bucket === 'REFRIG_CONG'
          ? det.frioTipo === 'CONGELADO'
            ? 'CONGELADO'
            : det.frioTipo === 'RESFRIADO'
              ? 'REFRIGERADO'
              : 'FRIO'
          : 'SECO',
    };

    if (!cad) {
      const outros = Array.isArray(outrosMap[row.digitos]) ? outrosMap[row.digitos] : [];
      if (outros.length) {
        const listaDonos = outros.map((o) => `${o.nmDono || 'Dono'} (${o.cdDono})`).join(', ');
        cadastrado_outro_dono.push({
          ...base,
          cadastroOutrosDonos: outros,
          motivo: `Existe no WMS em outro dono (${listaDonos}), mas não no dono do espelho (${rotuloDonoEsp}).`,
          dica:
            'Duplique o produto (ou de-para) para o dono do espelho, ou altere o dono do espelho na importação se o arquivo for desse outro dono.',
        });
        continue;
      }
      const frio = det.bucket === 'REFRIG_CONG';
      sem_cadastro.push({
        ...base,
        motivo: frio
          ? `Sem cadastro no ${rotuloDonoEsp} — descrição indica ${base.inferidoRomaneio} (ex.: «fresca», «resfriado»).`
          : `Sem produto no cadastro WMS para este código no dono do espelho (${rotuloDonoEsp}).`,
        dica: frio
          ? `Cadastre no WMS (${rotuloDonoEsp}) com TIPO_ARMAZENAGEM = ${base.inferidoRomaneio}. Entra no romaneio «só refrigerado», não no «só seco».`
          : `Cadastre no WMS (código OL + ${rotuloDonoEsp}) e defina a conservação.`,
      });
      continue;
    }

    const tipoCad = String(cad.TIPO_ARMAZENAGEM || '').trim().toUpperCase();
    if (!tipoCad) {
      sem_conservacao.push({
        ...base,
        tipoCadastro: '—',
        motivo: 'Produto existe, mas TIPO_ARMAZENAGEM está vazio.',
        dica: `Sugestão: ${base.inferidoRomaneio}.`,
      });
      continue;
    }

    if (tipoCad === 'SECO' && det.bucket === 'REFRIG_CONG') {
      seco_suspeito_frio.push({
        ...base,
        tipoCadastro: 'SECO',
        ncm: cad.NCM ? String(cad.NCM).trim() : '',
        motivo: `Cadastro SECO, porém ${motivoFrioInferido(det)}.`,
        dica: 'Ajuste para REFRIGERADO ou CONGELADO no cadastro. No romaneio «só seco» este item não aparece.',
      });
    }
  }

  const sortFn = (a, b) => b.ocorrencias - a.ocorrencias || String(a.codigoOl).localeCompare(String(b.codigoOl));
  sem_cadastro.sort(sortFn);
  cadastrado_outro_dono.sort(sortFn);
  sem_conservacao.sort(sortFn);
  seco_suspeito_frio.sort(sortFn);

  const totalProblemas =
    sem_cadastro.length +
    cadastrado_outro_dono.length +
    sem_conservacao.length +
    seco_suspeito_frio.length;

  return {
    donoEspelho: {
      cdDono: op.cdDonoEspelho != null ? op.cdDonoEspelho : null,
      nmDono: op.nmDonoEspelho || null,
    },
    resumo: {
      totalCodigosUnicos: porCodigo.size,
      semCadastro: sem_cadastro.length,
      cadastradoOutroDono: cadastrado_outro_dono.length,
      semConservacao: sem_conservacao.length,
      secoSuspeitoFrio: seco_suspeito_frio.length,
      totalComAlerta: totalProblemas,
      ok: totalProblemas === 0,
    },
    itens: {
      cadastrado_outro_dono: cadastrado_outro_dono.slice(0, LIMITE_LISTA),
      sem_cadastro: sem_cadastro.slice(0, LIMITE_LISTA),
      sem_conservacao: sem_conservacao.slice(0, LIMITE_LISTA),
      seco_suspeito_frio: seco_suspeito_frio.slice(0, LIMITE_LISTA),
    },
    truncado: {
      cadastrado_outro_dono: cadastrado_outro_dono.length > LIMITE_LISTA,
      sem_cadastro: sem_cadastro.length > LIMITE_LISTA,
      sem_conservacao: sem_conservacao.length > LIMITE_LISTA,
      seco_suspeito_frio: seco_suspeito_frio.length > LIMITE_LISTA,
    },
    mensagem:
      totalProblemas === 0
        ? 'Todos os códigos do espelho estão cadastrados no dono correto e coerentes com a conservação inferida (NCM/descrição).'
        : cadastrado_outro_dono.length && !sem_cadastro.length
          ? `Vários códigos existem em outro dono, mas o espelho está no ${rotuloDonoEsp}. Ajuste o dono do espelho ou duplique cadastro/de-para.`
          : 'Revise o cadastro WMS no dono do espelho antes de imprimir romaneios por conservação. Itens «SECO» no cadastro mas frios na prática não entram no romaneio seco.',
  };
}

module.exports = {
  auditarCadastroProdutosEspelhoOpl,
};
