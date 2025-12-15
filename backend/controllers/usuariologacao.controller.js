// backend/controllers/usuariologacao.controller.js
const { registrarAcao, buscarLogs } = require('../models/usuariologacao.model');

/**
 * Registrar ação do usuário (endpoint)
 */
const registrarAcaoUsuario = async (req, res) => {
  try {
    const {
      tipoAcao,
      modulo,
      descricao,
      detalhes,
      idRegistro,
      tabela
    } = req.body;

    // Pegar usuário do token (se disponível) ou do header
    const sgUsuario = req.user?.login || req.headers['user-login'] || 'SISTEMA';
    
    // Função helper para buscar header case-insensitive
    const getHeader = (name) => {
      const lowerName = name.toLowerCase();
      const headerKey = Object.keys(req.headers).find(k => k.toLowerCase() === lowerName);
      return headerKey ? req.headers[headerKey] : null;
    };
    
    // Pegar IP real do cliente (priorizando headers de proxy)
    // X-Forwarded-For pode conter múltiplos IPs separados por vírgula (primeiro é o IP original)
    let ip = null;
    
    // Debug: Logar todos os headers relacionados a IP (temporário)
    const ipHeaders = {
      'x-forwarded-for': getHeader('x-forwarded-for'),
      'x-real-ip': getHeader('x-real-ip'),
      'x-forwarded': getHeader('x-forwarded'),
      'forwarded-for': getHeader('forwarded-for'),
      'cf-connecting-ip': getHeader('cf-connecting-ip'),
      'true-client-ip': getHeader('true-client-ip'),
      'req.ip': req.ip,
      'req.connection.remoteAddress': req.connection?.remoteAddress,
      'req.socket.remoteAddress': req.socket?.remoteAddress
    };
    
    // Tentar capturar IP em ordem de prioridade
    const xForwardedFor = getHeader('x-forwarded-for');
    if (xForwardedFor) {
      // Pegar o primeiro IP da lista (IP original do cliente)
      const forwardedIps = xForwardedFor.split(',');
      ip = forwardedIps[0].trim();
      console.log(`[IP DEBUG] Capturado via X-Forwarded-For: ${ip} (de: ${xForwardedFor})`);
    } else {
      const xRealIp = getHeader('x-real-ip');
      if (xRealIp) {
        ip = xRealIp.trim();
        console.log(`[IP DEBUG] Capturado via X-Real-IP: ${ip}`);
      } else {
        const cfConnectingIp = getHeader('cf-connecting-ip');
        if (cfConnectingIp) {
          ip = cfConnectingIp.trim();
          console.log(`[IP DEBUG] Capturado via CF-Connecting-IP: ${ip}`);
        } else if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1' && !req.ip.startsWith('172.')) {
          // req.ip funciona quando trust proxy está configurado, mas ignorar IPs locais/proxy
          ip = req.ip;
          console.log(`[IP DEBUG] Capturado via req.ip: ${ip}`);
        } else {
          // Fallback para conexão direta
          const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;
          if (remoteAddr && remoteAddr !== '::1' && remoteAddr !== '127.0.0.1' && !remoteAddr.startsWith('172.')) {
            ip = remoteAddr;
            console.log(`[IP DEBUG] Capturado via remoteAddress: ${ip}`);
          } else {
            // Se ainda não encontrou, usar o que tiver (mas logar para debug)
            ip = req.ip || remoteAddr || 'DESCONHECIDO';
            console.log(`[IP DEBUG] ⚠️ Usando IP fallback: ${ip}`);
            console.log(`[IP DEBUG] Headers disponíveis:`, JSON.stringify(ipHeaders, null, 2));
          }
        }
      }
    }
    
    // Limpar IPv6 prefix (::ffff:) se presente
    if (ip && ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    
    // Se ainda for IP interno do proxy (172.x.x.x), tentar buscar em outros headers
    if (ip && (ip.startsWith('172.') || ip.startsWith('10.') || ip === '127.0.0.1' || ip === '::1')) {
      console.log(`[IP DEBUG] ⚠️ IP interno detectado (${ip}), buscando em outros headers...`);
      // Tentar todos os headers possíveis
      const allHeaders = Object.keys(req.headers);
      for (const headerName of allHeaders) {
        const headerValue = req.headers[headerName];
        if (headerValue && typeof headerValue === 'string') {
          // Verificar se parece um IP público
          const ipMatch = headerValue.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
          if (ipMatch) {
            const foundIp = ipMatch[0];
            // Verificar se não é IP privado
            if (!foundIp.startsWith('172.') && !foundIp.startsWith('10.') && 
                !foundIp.startsWith('192.168.') && foundIp !== '127.0.0.1') {
              ip = foundIp;
              console.log(`[IP DEBUG] ✅ IP público encontrado no header ${headerName}: ${ip}`);
              break;
            }
          }
        }
      }
    }
    
    const userAgent = req.headers['user-agent'] || null;

    const idLog = await registrarAcao({
      sgUsuario,
      tipoAcao,
      modulo,
      descricao,
      detalhes,
      idRegistro,
      tabela,
      ip,
      userAgent
    });

    return res.json({
      success: true,
      idLog
    });
  } catch (err) {
    console.error('Erro ao registrar ação:', err);
    // Retornar sucesso mesmo em caso de erro para não quebrar o fluxo
    return res.json({
      success: true,
      message: 'Log registrado (com possível erro interno)'
    });
  }
};

/**
 * Buscar logs de um usuário
 */
const listarLogs = async (req, res) => {
  try {
    const { sgUsuario } = req.query;
    const { tipoAcao, modulo, dataInicio, dataFim, limit } = req.query;

    if (!sgUsuario) {
      return res.status(400).json({
        success: false,
        message: 'SGUSUARIO é obrigatório'
      });
    }

    const filtros = {
      tipoAcao: tipoAcao || null,
      modulo: modulo || null,
      dataInicio: dataInicio ? new Date(dataInicio) : null,
      dataFim: dataFim ? new Date(dataFim) : null,
      limit: limit ? parseInt(limit) : 1000
    };

    const logs = await buscarLogs(sgUsuario, filtros);

    return res.json({
      success: true,
      logs,
      total: logs.length
    });
  } catch (err) {
    console.error('Erro ao buscar logs:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar logs'
    });
  }
};

module.exports = {
  registrarAcaoUsuario,
  listarLogs
};

