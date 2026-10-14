/**
 * Normalização de placa BR (antiga e Mercosul) para comparação e unicidade.
 * Remove hífen/espaço, converte para maiúsculas, mantém só A-Z0-9.
 * @param {string} placa
 * @returns {string|null} null se vazio ou muito curto
 */
function normalizarPlacaBrasil(placa) {
  const s = String(placa || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length < 7) return null;
  return s.slice(0, 10);
}

/**
 * Exibição amigável: ABC1234 ou ABC1D34 (Mercosul) — sem hífen obrigatório.
 */
function formatarPlacaExibicao(normalizada) {
  const n = normalizarPlacaBrasil(normalizada);
  if (!n || n.length !== 7) return String(normalizada || '').toUpperCase();
  return n;
}

module.exports = { normalizarPlacaBrasil, formatarPlacaExibicao };
