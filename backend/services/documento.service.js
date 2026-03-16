// backend/services/documento.service.js
// Abstração de documento por país: getTipoDocumento, validarDocumento, formatarDocumento (Fase 0)
// Atlas Cargo - Plano Multimoeda/Multilíngua

// Validar CPF (Brasil)
function validarCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') return false;
  cpf = cpf.replace(/[^\d]+/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i)) * (10 - i);
  let resto = 11 - (soma % 11);
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i)) * (11 - i);
  resto = 11 - (soma % 11);
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) return false;
  return true;
}

// Validar CNPJ (Brasil)
function validarCNPJ(cnpj) {
  if (!cnpj || typeof cnpj !== 'string') return false;
  cnpj = cnpj.replace(/[^\d]+/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0, pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(0))) return false;
  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(1))) return false;
  return true;
}

// Validar RUC (Paraguai) - Registro Único de Contribuyentes: 8 ou 9 dígitos
function validarRUC(valor) {
  if (!valor || typeof valor !== 'string') return false;
  const n = valor.replace(/[^\d]+/g, '');
  return n.length >= 8 && n.length <= 9 && /^\d+$/.test(n);
}

// Validar CI (Paraguai) - Cédula de Identidad: tipicamente 5 a 9 dígitos
function validarCI(valor) {
  if (!valor || typeof valor !== 'string') return false;
  const n = valor.replace(/[^\d]+/g, '');
  return n.length >= 5 && n.length <= 9 && /^\d+$/.test(n);
}

/**
 * Retorna os tipos de documento (pessoa física e jurídica) para um país.
 * @param {string} pais - Código do país (ex.: BR, PY)
 * @returns {{ fisica: string, juridica: string, labelFisica: string, labelJuridica: string }}
 */
function getTipoDocumento(pais) {
  const p = (pais || 'BR').toUpperCase();
  const map = {
    BR: { fisica: 'CPF', juridica: 'CNPJ', labelFisica: 'CPF', labelJuridica: 'CNPJ' },
    PY: { fisica: 'CI', juridica: 'RUC', labelFisica: 'Cédula de Identidad', labelJuridica: 'RUC' },
    AR: { fisica: 'DNI', juridica: 'CUIT', labelFisica: 'DNI', labelJuridica: 'CUIT' },
    UY: { fisica: 'CI', juridica: 'RUT', labelFisica: 'Cédula', labelJuridica: 'RUT' }
  };
  return map[p] || map.BR;
}

/**
 * Valida o documento conforme país e tipo (F = física, J = jurídica).
 * Para BR usa validarCPF/validarCNPJ; outros países (PY, AR, UY) ainda não implementados → false para valores vazios, true para “aceitar qualquer” em Fase 0.
 * @param {string} pais - Código do país
 * @param {string} tipo - 'F' ou 'CPF' (física), 'J' ou 'CNPJ' (jurídica)
 * @param {string} valor - Valor do documento (com ou sem máscara)
 * @returns {{ valido: boolean, mensagem?: string }}
 */
function validarDocumento(pais, tipo, valor) {
  const p = (pais || 'BR').toUpperCase();
  const t = (tipo || '').toUpperCase();
  const isFisica = t === 'F' || t === 'CPF' || t === 'CI' || t === 'DNI';
  const isJuridica = t === 'J' || t === 'CNPJ' || t === 'RUC' || t === 'CUIT' || t === 'RUT';
  if (!valor || typeof valor !== 'string') {
    return { valido: false, mensagem: 'Documento não informado' };
  }
  if (p === 'BR') {
    if (isFisica) {
      const ok = validarCPF(valor);
      return ok ? { valido: true } : { valido: false, mensagem: 'CPF inválido' };
    }
    if (isJuridica) {
      const ok = validarCNPJ(valor);
      return ok ? { valido: true } : { valido: false, mensagem: 'CNPJ inválido' };
    }
  }
  // Paraguai (Fase 1): RUC e CI
  if (p === 'PY') {
    if (isFisica) {
      const ok = validarCI(valor);
      return ok ? { valido: true } : { valido: false, mensagem: 'Cédula de Identidad (CI) inválida. Use 5 a 9 dígitos.' };
    }
    if (isJuridica) {
      const ok = validarRUC(valor);
      return ok ? { valido: true } : { valido: false, mensagem: 'RUC inválido. Use 8 ou 9 dígitos.' };
    }
  }
  // AR, UY, PT e outros: formato mínimo (número/cartão cidadão, 3–20 caracteres)
  if (p === 'AR' || p === 'UY' || p === 'PT') {
    const limpo = String(valor).replace(/[^\d\w]/g, '');
    if (limpo.length < 3) return { valido: false, mensagem: 'Documento inválido' };
    if (limpo.length > 20) return { valido: false, mensagem: 'Documento muito longo' };
    return { valido: true };
  }
  // Outros países não mapeados: aceitar mínimo 3 dígitos para não bloquear cadastro
  const limpo = String(valor).replace(/[^\d\w]/g, '');
  if (limpo.length >= 3 && limpo.length <= 20) return { valido: true };
  // Fallback: Brasil
  if (isFisica) return validarCPF(valor) ? { valido: true } : { valido: false, mensagem: 'CPF inválido' };
  if (isJuridica) return validarCNPJ(valor) ? { valido: true } : { valido: false, mensagem: 'CNPJ inválido' };
  return { valido: false, mensagem: 'Tipo de documento não reconhecido' };
}

/**
 * Formata o documento para exibição conforme país e tipo.
 * BR: CPF 000.000.000-00, CNPJ 00.000.000/0000-00.
 * @param {string} pais - Código do país
 * @param {string} tipo - 'F' ou 'CPF', 'J' ou 'CNPJ', etc.
 * @param {string} valor - Valor só números (ou com máscara, será limpo)
 * @returns {string}
 */
function formatarDocumento(pais, tipo, valor) {
  if (!valor || typeof valor !== 'string') return '';
  const p = (pais || 'BR').toUpperCase();
  const t = (tipo || '').toUpperCase();
  const nums = valor.replace(/[^\d]+/g, '');
  const isFisica = t === 'F' || t === 'CPF' || t === 'CI' || t === 'DNI';
  const isJuridica = t === 'J' || t === 'CNPJ' || t === 'RUC' || t === 'CUIT' || t === 'RUT';
  if (p === 'BR') {
    if (isFisica && nums.length === 11) {
      return nums.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    if (isJuridica && nums.length === 14) {
      return nums.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
  }
  if (p === 'PY') {
    if (isJuridica && nums.length >= 8 && nums.length <= 9) {
      return nums.replace(/(\d{4})(\d{4,5})/, '$1-$2');
    }
  }
  return valor;
}

/**
 * Normaliza documento para gravação (só dígitos, ou padrão único por país).
 * @param {string} pais
 * @param {string} valor
 * @returns {string}
 */
function normalizarDocumento(pais, valor) {
  if (!valor || typeof valor !== 'string') return '';
  return valor.replace(/[^\d]+/g, '');
}

module.exports = {
  getTipoDocumento,
  validarDocumento,
  formatarDocumento,
  normalizarDocumento,
  validarCPF,
  validarCNPJ,
  validarRUC,
  validarCI
};
