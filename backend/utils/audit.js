/**
 * Retorna o login do usuário logado para auditoria (SGUSER/SGUSERINCLUSAO).
 * Usa JWT (req.user) ou header user-login. Não usa fallback SYSTEM (usuário deve existir no banco).
 * Retorna null quando não há usuário logado — o controller deve retornar 401 nesse caso.
 */
function getSgUser(req) {
  return (req && req.user && (req.user.login || req.user.SGUSUARIO)) || (req && req.headers && req.headers['user-login']) || null;
}

module.exports = { getSgUser };
