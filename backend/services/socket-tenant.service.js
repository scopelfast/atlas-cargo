// Resolve tenant a partir do JWT no handshake Socket.io (auth.token ou query.token).
// Sem token válido: fallback DEFAULT_TENANT_ID (compatível com clientes legados).

const jwt = require('jsonwebtoken');
const { getDefaultTenantId, tenantIdFromDecoded } = require('../middleware/tenant.middleware');

function socketTenantId(socket) {
  let raw = socket.handshake.auth && socket.handshake.auth.token;
  if (raw == null || raw === '') raw = socket.handshake.query && socket.handshake.query.token;
  if (raw == null || raw === '') return getDefaultTenantId();
  const s = String(raw).replace(/^Bearer\s+/i, '').trim();
  if (!s || !process.env.JWT_SECRET) return getDefaultTenantId();
  try {
    const decoded = jwt.verify(s, process.env.JWT_SECRET);
    const t = tenantIdFromDecoded(decoded);
    if (t != null && String(t).trim() !== '') return String(t).trim();
    return getDefaultTenantId();
  } catch (_) {
    return getDefaultTenantId();
  }
}

function normalizeTenantRoomId(tenantId) {
  return tenantId != null && String(tenantId).trim() !== ''
    ? String(tenantId).trim()
    : getDefaultTenantId();
}

/** Sala Socket.io da torre “todas as viagens” por tenant (alinhar com WebSocketTorreService). */
function torreAllViagensRoom(tenantId) {
  return `torre:all-viagens:${normalizeTenantRoomId(tenantId)}`;
}

/**
 * Sala do dashboard web para badge/notificação de mensagens do motorista (isolada por tenant).
 * Nunca usar sala global única — evita vazamento cross-tenant.
 */
function chatDashboardRoom(tenantId) {
  return `chat-dashboard:${normalizeTenantRoomId(tenantId)}`;
}

module.exports = { socketTenantId, torreAllViagensRoom, chatDashboardRoom };
