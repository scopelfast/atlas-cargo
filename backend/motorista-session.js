// backend/motorista-session.js
// Uma sessão ativa por motorista: ao logar de outro dispositivo, o token anterior deixa de ser válido.
// Em memória; para múltiplos servidores use Redis com a mesma lógica.

const sessaoAtivaPorMotorista = new Map();

function setCurrentToken(motoristaId, token) {
  const id = String(motoristaId);
  if (id) {
    sessaoAtivaPorMotorista.set(id, token);
    console.log('[SESSAO] setCurrentToken motoristaId=%s (store tem %d motoristas: %s)', id, sessaoAtivaPorMotorista.size, Array.from(sessaoAtivaPorMotorista.keys()).join(', '));
  }
}

function getCurrentToken(motoristaId) {
  const id = String(motoristaId);
  return id ? sessaoAtivaPorMotorista.get(id) : undefined;
}

// Retorna true se o token for aceito: quando não há sessão armazenada (ex.: após restart do servidor),
// aceita qualquer token válido; quando há sessão, só aceita o token atual (um login por motorista).
function isCurrentToken(motoristaId, token) {
  if (!motoristaId || !token) return false;
  const id = String(motoristaId);
  const current = getCurrentToken(motoristaId);
  const aceito = current === undefined ? true : current === token;
  if (!aceito) {
    console.log('[SESSAO] isCurrentToken REJEITADO motoristaId=%s (current existe? %s, mesmo token? %s)', id, current !== undefined, current === token);
  }
  return aceito;
}

module.exports = {
  setCurrentToken,
  getCurrentToken,
  isCurrentToken
};
