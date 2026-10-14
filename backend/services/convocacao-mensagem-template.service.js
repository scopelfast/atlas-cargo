/**
 * Templates de mensagem WhatsApp (Switch) para convocações.
 * Chaves em CONFIGURACAO: msg_conv_* — se vazio/ausente, usa texto padrão (comportamento legado).
 */

const sql = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVE_DISPARO = 'msg_conv_disparo_corpo';
const CHAVE_CONF_SELECIONADO = 'msg_conv_confirmacao_selecionado_corpo';
const CHAVE_CONF_NAO_SELECIONADO = 'msg_conv_confirmacao_nao_selecionado_corpo';

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function aplicarPlaceholders(template, vars) {
  if (template == null) return '';
  let out = String(template);
  Object.keys(vars).forEach((key) => {
    const val = vars[key] == null ? '' : String(vars[key]);
    const re = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi');
    out = out.replace(re, val);
  });
  return out;
}

/** @param {object} pool pool PostgreSQL (poolPromise) com .request().query() */
async function carregarTemplatesConvocacao(pool, tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  const r = await pool.request().input('tenantId', sql.NVarChar(64), tid).query(`
    SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
    WHERE "TENANT_ID" = @tenantId
      AND "CHAVE" IN ('${CHAVE_DISPARO}', '${CHAVE_CONF_SELECIONADO}', '${CHAVE_CONF_NAO_SELECIONADO}')
  `);
  const map = { [CHAVE_DISPARO]: '', [CHAVE_CONF_SELECIONADO]: '', [CHAVE_CONF_NAO_SELECIONADO]: '' };
  (r.recordset || []).forEach((row) => {
    const k = row.CHAVE || row.chave;
    const v = row.VALOR != null ? row.VALOR : row.valor;
    if (k && map[k] !== undefined) map[k] = v != null ? String(v) : '';
  });
  return map;
}

function usarTemplateOuPadrao(rawTemplate, vars, montarPadrao) {
  if (rawTemplate == null) return montarPadrao();
  const s = String(rawTemplate);
  if (!s.trim()) return montarPadrao();
  const aplicado = aplicarPlaceholders(s, vars);
  if (!aplicado || !String(aplicado).trim()) return montarPadrao();
  return aplicado;
}

/**
 * Corpo padrão do disparo (igual ao histórico do enviarWebhookSwitchDigital).
 */
function montarCorpoDisparoPadrao({
  nomeMotoristaConv,
  viagemId,
  v,
  tipoViagemFmt,
  rotaLinha,
  pontosParada,
  formatarDataHora,
  valorFreteFmt,
  pesoFmt,
  cubagemFmt,
  linkConvocacao,
}) {
  let textoWhatsApp = `Olá *${nomeMotoristaConv}*, como está? Você está sendo convocado para uma viagem.\n\n`;
  textoWhatsApp += `  *CARGA DISPONÍVEL*\n\n`;
  textoWhatsApp += `  ID: ${v.IDVIAGEM || viagemId}\n`;
  textoWhatsApp += `  Tipo: ${tipoViagemFmt}\n`;
  textoWhatsApp += `  Classe: ${v.DSCLASSEFROTA || 'Não informado'}\n`;
  textoWhatsApp += `  Rota: ${rotaLinha}\n`;
  if (v.ORIGEM_PAIS || v.DESTINO_PAIS) {
    textoWhatsApp += `  País: ${(v.ORIGEM_PAIS || '-').toString().trim()} → ${(v.DESTINO_PAIS || '-').toString().trim()}\n`;
  }
  if (pontosParada && pontosParada.length > 0) {
    textoWhatsApp += `  *Pontos de parada:*\n`;
    pontosParada.forEach((pt) => {
      const partes = [pt.pais, pt.estado, pt.cidade].filter(Boolean);
      textoWhatsApp += `  • ${partes.length ? partes.join(', ') : '—'}\n`;
    });
    textoWhatsApp += `\n`;
  } else {
    textoWhatsApp += `\n`;
  }
  textoWhatsApp += `  *HORÁRIOS*\n`;
  textoWhatsApp += `  Carregamento: ${formatarDataHora(v.DTPREVINICIO)}\n`;
  textoWhatsApp += `  Descarga: ${formatarDataHora(v.DTPREVFINAL)}\n\n`;
  if (v.FGRASTREADO === 'S') {
    textoWhatsApp += `  *REQUISITOS*\n`;
    textoWhatsApp += `  ✅ Exige veículo rastreado: SIM\n\n`;
  }
  textoWhatsApp += `  *CONTRATADOR*\n`;
  textoWhatsApp += `${v.CONTRATADOR_NOME || 'Não informado'}\n\n`;
  textoWhatsApp += `  *VALORES*\n`;
  textoWhatsApp += `  Frete: ${valorFreteFmt}\n`;
  textoWhatsApp += `  Peso: ${pesoFmt} ton\n`;
  textoWhatsApp += `  Cubagem: ${cubagemFmt} m³\n\n`;
  if (v.OBSERV && String(v.OBSERV).trim()) {
    textoWhatsApp += `  *DETALHES DA VIAGEM*\n`;
    textoWhatsApp += `${String(v.OBSERV).trim()}\n\n`;
  }
  textoWhatsApp += `  Acesse o link para mais detalhes:\n\n`;
  textoWhatsApp += `${linkConvocacao}\n\n`;
  return textoWhatsApp;
}

function montarVariaveisDisparo({
  nomeMotoristaConv,
  viagemId,
  v,
  tipoViagemFmt,
  rotaLinha,
  pontosParada,
  formatarDataHora,
  valorFreteFmt,
  pesoFmt,
  cubagemFmt,
  linkConvocacao,
}) {
  let blocoPontos = '';
  if (pontosParada && pontosParada.length > 0) {
    pontosParada.forEach((pt) => {
      const partes = [pt.pais, pt.estado, pt.cidade].filter(Boolean);
      blocoPontos += `  • ${partes.length ? partes.join(', ') : '—'}\n`;
    });
  }
  const paisesLinha =
    v.ORIGEM_PAIS || v.DESTINO_PAIS
      ? `${(v.ORIGEM_PAIS || '-').toString().trim()} → ${(v.DESTINO_PAIS || '-').toString().trim()}`
      : '';
  const linhaPais =
    v.ORIGEM_PAIS || v.DESTINO_PAIS
      ? `  País: ${(v.ORIGEM_PAIS || '-').toString().trim()} → ${(v.DESTINO_PAIS || '-').toString().trim()}\n`
      : '';
  let blocoPontosParada = '';
  if (pontosParada && pontosParada.length > 0) {
    blocoPontosParada = `  *Pontos de parada:*\n`;
    pontosParada.forEach((pt) => {
      const partes = [pt.pais, pt.estado, pt.cidade].filter(Boolean);
      blocoPontosParada += `  • ${partes.length ? partes.join(', ') : '—'}\n`;
    });
    blocoPontosParada += `\n`;
  } else {
    blocoPontosParada = `\n`;
  }
  const reqRastreado =
    v.FGRASTREADO === 'S' ? `  *REQUISITOS*\n  ✅ Exige veículo rastreado: SIM\n\n` : '';
  const obsBloco =
    v.OBSERV && String(v.OBSERV).trim() ? `  *DETALHES DA VIAGEM*\n${String(v.OBSERV).trim()}\n\n` : '';
  const pn = String(nomeMotoristaConv || 'Motorista').trim();
  const primeiro = pn.split(/\s+/)[0] || pn;
  return {
    MOTORISTA_NOME: pn,
    PRIMEIRO_NOME: primeiro,
    ID_VIAGEM: String(v.IDVIAGEM != null ? v.IDVIAGEM : viagemId),
    TIPO_VIAGEM: tipoViagemFmt,
    DSCLASSEFROTA: v.DSCLASSEFROTA || 'Não informado',
    DSROTEIRO: rotaLinha,
    PAIS_ORIGEM_DESTINO: paisesLinha,
    LINHA_PAIS: linhaPais,
    PONTOS_PARADA: blocoPontos.trimEnd(),
    BLOCO_PONTOS_PARADA: blocoPontosParada,
    DTPREVINICIO: formatarDataHora(v.DTPREVINICIO),
    DTPREVFINAL: formatarDataHora(v.DTPREVFINAL),
    REQUISITOS_RASTREADO: reqRastreado,
    CONTRATADOR_NOME: v.CONTRATADOR_NOME || 'Não informado',
    VALOR_FRETE: valorFreteFmt,
    PESO_TON: pesoFmt,
    CUBAGEM_M3: cubagemFmt,
    OBSERV_BLOCO: obsBloco,
    LINK_CONVOCACAO: linkConvocacao,
  };
}

function resolverCorpoDisparo(templates, ctx) {
  const vars = montarVariaveisDisparo(ctx);
  return usarTemplateOuPadrao(templates[CHAVE_DISPARO], vars, () => montarCorpoDisparoPadrao(ctx));
}

function montarCorpoConfirmacaoSelecionadoPadrao(primeiroNome, idViagem, linkAppMotorista) {
  let textoMensagem =
    `🎉 *PARABÉNS! Você foi selecionado!*\n\n` +
    `Olá *${primeiroNome}*, como está?\n\n` +
    `Temos uma ótima notícia! Você foi *SELECIONADO* para realizar a viagem:\n\n` +
    `🆔 *ID da Viagem:* ${idViagem}\n` +
    `✅ *Sua convocação foi CONFIRMADA!*\n\n` +
    `Agora, por favor, aguarde o contato do nosso time, com mais instruções dos próximos passos.\n\n` +
    `Obrigado pela parceria! 🚛`;
  if (linkAppMotorista) {
    textoMensagem += `\n\n*Aplicativo do motorista:*\n${linkAppMotorista}`;
  }
  return textoMensagem;
}

function montarCorpoNaoSelecionadoPadrao(primeiroNomeDesc, idViagem) {
  return (
    `Olá *${primeiroNomeDesc}*, como está?\n\n` +
    `Para a viagem *${idViagem}* outro motorista foi selecionado.\n\n` +
    `Agradecemos seu interesse e não se preocupe! Você poderá ser convocado em novas viagens.\n\n` +
    `Obrigado pela parceria! 🚛`
  );
}

function blocoLinkAppMotorista(linkAppMotorista) {
  const link = linkAppMotorista != null ? String(linkAppMotorista).trim() : '';
  return link ? `\n\n*Aplicativo do motorista:*\n${link}` : '';
}

function resolverCorpoConfirmacaoSelecionado(templates, primeiroNome, idViagem, linkAppMotorista) {
  const link = linkAppMotorista != null ? String(linkAppMotorista).trim() : '';
  const vars = {
    PRIMEIRO_NOME: primeiroNome,
    ID_VIAGEM: String(idViagem),
    LINK_APP_MOTORISTA: link,
    BLOCO_LINK_APP: blocoLinkAppMotorista(linkAppMotorista),
  };
  return usarTemplateOuPadrao(templates[CHAVE_CONF_SELECIONADO], vars, () =>
    montarCorpoConfirmacaoSelecionadoPadrao(primeiroNome, idViagem, linkAppMotorista)
  );
}

function resolverCorpoNaoSelecionado(templates, primeiroNomeDesc, idViagem) {
  const vars = {
    PRIMEIRO_NOME: primeiroNomeDesc,
    ID_VIAGEM: String(idViagem),
  };
  return usarTemplateOuPadrao(templates[CHAVE_CONF_NAO_SELECIONADO], vars, () =>
    montarCorpoNaoSelecionadoPadrao(primeiroNomeDesc, idViagem)
  );
}

/** Contexto fictício para exibir na tela de configuração e na pré-visualização. */
function obterContextoExemploDisparo() {
  const v = {
    IDVIAGEM: 987654,
    CDTIPOVIAGEM: 'FR',
    DSTIPOVIAGEM: 'Carga fracionada',
    DSCLASSEFROTA: 'Truck',
    DSROTEIRO: 'Curitiba → Asunción',
    ORIGEM_PAIS: 'BR',
    DESTINO_PAIS: 'PY',
    DTPREVINICIO: '2026-06-15T08:00:00',
    DTPREVFINAL: '2026-06-17T14:00:00',
    FGRASTREADO: 'S',
    CONTRATADOR_NOME: 'TRANSPORTADORA EXEMPLO LTDA',
    VLFRETE: 15000,
    PESO: 12000,
    CUBAGEM: 45.5,
    OBSERV: 'Mercadoria seca. Documentação na portaria.',
  };
  const nomeMotoristaConv = 'João Motorista';
  const viagemId = v.IDVIAGEM;
  const tipoViagemFmt = [v.CDTIPOVIAGEM, v.DSTIPOVIAGEM].filter(Boolean).join(' - ') || 'Não informado';
  const rotaLinha = v.DSROTEIRO || 'Não informado';
  const pontosParada = [
    { pais: 'BR', estado: 'PR', cidade: 'Guaratuba' },
    { pais: 'PY', estado: 'Central', cidade: 'Caacupé' },
  ];
  const formatarDataHora = (dataHora) => {
    if (!dataHora) return 'Não informado';
    try {
      const s = String(dataHora).replace('Z', '').replace('T', ' ');
      const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
      const d = new Date(dataHora);
      if (isNaN(d.getTime())) return 'Data inválida';
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    } catch (e) {
      return 'Data inválida';
    }
  };
  const valorFreteFmt = Number(v.VLFRETE || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pesoNum = parseFloat(v.PESO || 0);
  const pesoEmTon = pesoNum >= 1000 ? pesoNum / 1000 : pesoNum;
  const pesoFmt = pesoEmTon.toFixed(2).replace('.', ',');
  const cubagemFmt = (parseFloat(v.CUBAGEM || 0)).toFixed(2).replace('.', ',');
  const linkConvocacao = 'https://exemplo.seudominio.com/convocacao/12345';
  return {
    nomeMotoristaConv,
    viagemId,
    v,
    tipoViagemFmt,
    rotaLinha,
    pontosParada,
    formatarDataHora,
    valorFreteFmt,
    pesoFmt,
    cubagemFmt,
    linkConvocacao,
  };
}

/** Modelos com {{variáveis}} equivalentes ao layout do padrão do sistema (para colar no campo e editar). */
const TEMPLATE_SUGERIDO_DISPARO = `Olá *{{MOTORISTA_NOME}}*, como está? Você está sendo convocado para uma viagem.

  *CARGA DISPONÍVEL*

  ID: {{ID_VIAGEM}}
  Tipo: {{TIPO_VIAGEM}}
  Classe: {{DSCLASSEFROTA}}
  Rota: {{DSROTEIRO}}
{{LINHA_PAIS}}{{BLOCO_PONTOS_PARADA}}  *HORÁRIOS*
  Carregamento: {{DTPREVINICIO}}
  Descarga: {{DTPREVFINAL}}

{{REQUISITOS_RASTREADO}}  *CONTRATADOR*
{{CONTRATADOR_NOME}}

  *VALORES*
  Frete: {{VALOR_FRETE}}
  Peso: {{PESO_TON}} ton
  Cubagem: {{CUBAGEM_M3}} m³

{{OBSERV_BLOCO}}  Acesse o link para mais detalhes:

{{LINK_CONVOCACAO}}

`;

const TEMPLATE_SUGERIDO_CONF_SELECIONADO = `🎉 *PARABÉNS! Você foi selecionado!*

Olá *{{PRIMEIRO_NOME}}*, como está?

Temos uma ótima notícia! Você foi *SELECIONADO* para realizar a viagem:

🆔 *ID da Viagem:* {{ID_VIAGEM}}
✅ *Sua convocação foi CONFIRMADA!*

Agora, por favor, aguarde o contato do nosso time, com mais instruções dos próximos passos.

Obrigado pela parceria! 🚛{{BLOCO_LINK_APP}}`;

const TEMPLATE_SUGERIDO_CONF_NAO_SELECIONADO = `Olá *{{PRIMEIRO_NOME}}*, como está?

Para a viagem *{{ID_VIAGEM}}* outro motorista foi selecionado.

Agradecemos seu interesse e não se preocupe! Você poderá ser convocado em novas viagens.

Obrigado pela parceria! 🚛`;

function obterTemplatesSugeridos() {
  return {
    disparo: TEMPLATE_SUGERIDO_DISPARO,
    confirmacaoSelecionado: TEMPLATE_SUGERIDO_CONF_SELECIONADO,
    confirmacaoNaoSelecionado: TEMPLATE_SUGERIDO_CONF_NAO_SELECIONADO,
  };
}

/**
 * Pré-visualização: template do campo (ou vazio = padrão) com variáveis de exemplo.
 * @param {'disparo'|'confirmacaoSel'|'confirmacaoNaoSel'} tipo
 * @param {string} corpo texto do textarea
 * @param {string} linkAppMotorista
 */
function previewComExemplo(tipo, corpo, linkAppMotorista) {
  const link = linkAppMotorista != null ? String(linkAppMotorista).trim() : '';
  const ctx = obterContextoExemploDisparo();
  const idV = String(ctx.v.IDVIAGEM);
  const corpoStr = corpo != null ? String(corpo) : '';

  if (tipo === 'disparo') {
    if (!corpoStr.trim()) return montarCorpoDisparoPadrao(ctx);
    const vars = montarVariaveisDisparo(ctx);
    const out = aplicarPlaceholders(corpoStr, vars);
    if (!String(out).trim()) return montarCorpoDisparoPadrao(ctx);
    return out;
  }
  if (tipo === 'confirmacaoSel') {
    if (!corpoStr.trim()) return montarCorpoConfirmacaoSelecionadoPadrao('João', idV, link);
    const vars = {
      PRIMEIRO_NOME: 'João',
      ID_VIAGEM: idV,
      LINK_APP_MOTORISTA: link,
      BLOCO_LINK_APP: blocoLinkAppMotorista(link),
    };
    const out = aplicarPlaceholders(corpoStr, vars);
    if (!String(out).trim()) return montarCorpoConfirmacaoSelecionadoPadrao('João', idV, link);
    return out;
  }
  if (tipo === 'confirmacaoNaoSel') {
    if (!corpoStr.trim()) return montarCorpoNaoSelecionadoPadrao('Maria', idV);
    const vars = { PRIMEIRO_NOME: 'Maria', ID_VIAGEM: idV };
    const out = aplicarPlaceholders(corpoStr, vars);
    if (!String(out).trim()) return montarCorpoNaoSelecionadoPadrao('Maria', idV);
    return out;
  }
  return '';
}

module.exports = {
  CHAVE_DISPARO,
  CHAVE_CONF_SELECIONADO,
  CHAVE_CONF_NAO_SELECIONADO,
  carregarTemplatesConvocacao,
  resolverCorpoDisparo,
  resolverCorpoConfirmacaoSelecionado,
  resolverCorpoNaoSelecionado,
  montarCorpoDisparoPadrao,
  montarCorpoConfirmacaoSelecionadoPadrao,
  montarCorpoNaoSelecionadoPadrao,
  obterTemplatesSugeridos,
  previewComExemplo,
};
