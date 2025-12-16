// =============================================
// GPS Automático - Serviço em Background
// =============================================

let gpsIntervalId = null;
let contadorEnvios = 0;
let ultimoEnvio = null;
let proximoEnvio = null;

// Inicializar GPS automático
function iniciarGPSAutomatico() {
  const ativo = localStorage.getItem('gps_ativo') === 'true';
  const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '5');
  const motorista = getMotorista();

  console.log(`📍 GPS Automático: ${ativo ? 'ATIVO' : 'INATIVO'}`);
  console.log(`⏱️ Intervalo: ${intervalo} minutos`);

  // Parar se já estiver rodando
  if (gpsIntervalId) {
    clearInterval(gpsIntervalId);
    gpsIntervalId = null;
  }

  // Se não está ativo, sair
  if (!ativo || !motorista) {
    console.log('❌ GPS automático não iniciado');
    return;
  }

  // Enviar primeira posição imediatamente
  enviarPosicaoAutomatica();

  // Configurar intervalo (minutos → milissegundos)
  const intervaloMs = intervalo * 60 * 1000;
  
  gpsIntervalId = setInterval(() => {
    enviarPosicaoAutomatica();
  }, intervaloMs);

  console.log(`✅ GPS automático iniciado! Enviando a cada ${intervalo} min`);
}

// Enviar posição automaticamente
async function enviarPosicaoAutomatica() {
  try {
    console.log('📍 [GPS AUTO] Iniciando captura...');

    const motorista = getMotorista();
    if (!motorista) {
      console.log('❌ [GPS AUTO] Motorista não autenticado');
      return;
    }

    // Buscar viagens em andamento
    let viagemId = null;
    try {
      const response = await fetch(`/api/motorista/viagens-andamento/${motorista.id}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (response.ok) {
        const viagens = await response.json();
        if (viagens.length > 0) {
          viagemId = viagens[0].IDVIAGEM; // Pega a primeira viagem
          console.log(`🚛 [GPS AUTO] Viagem associada: #${viagemId}`);
        }
      }
    } catch (error) {
      console.log('⚠️ [GPS AUTO] Sem viagem ativa:', error.message);
    }

    // Obter posição GPS
    if (!navigator.geolocation) {
      console.log('❌ [GPS AUTO] Geolocalização não disponível');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;

        console.log(`📍 [GPS AUTO] Posição capturada: ${latitude}, ${longitude}`);

        // Determinar status (parado ou movimento)
        const velocidadeKmh = speed ? (speed * 3.6).toFixed(2) : 0;
        const status = velocidadeKmh > 5 ? 'M' : 'P'; // M=Movimento, P=Parado

        // Enviar para o backend
        const dadosGPS = {
          cdMotorista: motorista.id,
          idViagem: viagemId,
          latitude: latitude.toFixed(8),
          longitude: longitude.toFixed(8),
          altitude: altitude ? altitude.toFixed(2) : null,
          precisao: Math.round(accuracy),
          velocidade: velocidadeKmh,
          status: status,
          direcao: heading ? heading.toFixed(2) : null,
          tipoEnvio: 'A', // A=Automático
          dtPosicao: new Date().toISOString(),
        };

        try {
          const response = await fetch('/api/motorista/gps', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getToken()}`,
            },
            body: JSON.stringify(dadosGPS),
          });

          if (response.ok) {
            contadorEnvios++;
            ultimoEnvio = new Date();
            
            // Calcular próximo envio
            const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '5');
            proximoEnvio = new Date(Date.now() + (intervalo * 60 * 1000));

            // Salvar estatísticas
            localStorage.setItem('gps_contador', contadorEnvios.toString());
            localStorage.setItem('gps_ultimo_envio', ultimoEnvio.toISOString());
            localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());

            console.log(`✅ [GPS AUTO] Posição enviada com sucesso! (${contadorEnvios} envios)`);
            console.log(`   🚗 ${velocidadeKmh} km/h (${status === 'P' ? 'Parado' : 'Em Movimento'})`);
            console.log(`   ⏱️ Próximo envio: ${proximoEnvio.toLocaleTimeString()}`);

            // Atualizar indicador visual se existir
            atualizarIndicadorGPS();

          } else {
            console.error('❌ [GPS AUTO] Erro ao enviar:', response.statusText);
          }
        } catch (error) {
          console.error('❌ [GPS AUTO] Erro de rede:', error);
          
          // Se offline, adicionar à fila
          if (typeof adicionarFila === 'function') {
            await adicionarFila('gps', dadosGPS);
            console.log('📦 [GPS AUTO] Adicionado à fila offline');
          }
        }
      },
      async (error) => {
        console.warn('⚠️ [GPS AUTO] Erro ao obter posição (tentativa 1):', error.message);
        
        // Se foi timeout, tentar novamente com configurações menos restritivas
        if (error.code === error.TIMEOUT || error.message.includes('Timeout')) {
          console.log('🔄 [GPS AUTO] Tentando novamente com configurações menos restritivas...');
          
          try {
            await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(
                async (position) => {
                  const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;
                  
                  console.log(`📍 [GPS AUTO] Posição capturada (tentativa 2): ${latitude}, ${longitude}`);
                  
                  const velocidadeKmh = speed ? (speed * 3.6).toFixed(2) : 0;
                  const status = velocidadeKmh > 5 ? 'M' : 'P';
                  
                  const dadosGPS = {
                    cdMotorista: motorista.id,
                    idViagem: viagemId,
                    latitude: latitude.toFixed(8),
                    longitude: longitude.toFixed(8),
                    altitude: altitude ? altitude.toFixed(2) : null,
                    precisao: Math.round(accuracy),
                    velocidade: velocidadeKmh,
                    status: status,
                    direcao: heading ? heading.toFixed(2) : null,
                    tipoEnvio: 'A',
                    dtPosicao: new Date().toISOString(),
                  };
                  
                  try {
                    const response = await fetch('/api/motorista/gps', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getToken()}`,
                      },
                      body: JSON.stringify(dadosGPS),
                    });
                    
                    if (response.ok) {
                      contadorEnvios++;
                      ultimoEnvio = new Date();
                      const intervalo = parseInt(localStorage.getItem('gps_intervalo') || '5');
                      proximoEnvio = new Date(Date.now() + (intervalo * 60 * 1000));
                      
                      localStorage.setItem('gps_contador', contadorEnvios.toString());
                      localStorage.setItem('gps_ultimo_envio', ultimoEnvio.toISOString());
                      localStorage.setItem('gps_proximo_envio', proximoEnvio.toISOString());
                      
                      console.log(`✅ [GPS AUTO] Posição enviada com sucesso (tentativa 2)!`);
                      atualizarIndicadorGPS();
                      resolve();
                    } else {
                      reject(new Error('Erro ao enviar posição'));
                    }
                  } catch (err) {
                    if (typeof adicionarFila === 'function') {
                      await adicionarFila('gps', dadosGPS);
                      console.log('📦 [GPS AUTO] Adicionado à fila offline');
                    }
                    resolve();
                  }
                },
                (error2) => {
                  console.error('❌ [GPS AUTO] Erro na tentativa 2:', error2.message);
                  reject(error2);
                },
                {
                  enableHighAccuracy: false, // Menos restritivo
                  timeout: 15000, // Timeout menor na segunda tentativa
                  maximumAge: 120000, // Aceitar posição com até 2 minutos de idade
                }
              );
            });
          } catch (retryError) {
            console.error('❌ [GPS AUTO] Falha após tentativa de retry:', retryError.message);
          }
        } else {
          console.error('❌ [GPS AUTO] Erro não recuperável:', error.message);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 30000, // Aumentado para 30 segundos (mais tolerante)
        maximumAge: 60000, // Aceitar posição com até 1 minuto de idade se disponível
      }
    );
  } catch (error) {
    console.error('❌ [GPS AUTO] Erro geral:', error);
  }
}

// Atualizar indicador visual
function atualizarIndicadorGPS() {
  // Disparar evento customizado para atualizar UI
  const evento = new CustomEvent('gpsEnviado', {
    detail: {
      contador: contadorEnvios,
      ultimoEnvio: ultimoEnvio,
      proximoEnvio: proximoEnvio
    }
  });
  window.dispatchEvent(evento);
}

// Parar GPS automático
function pararGPSAutomatico() {
  if (gpsIntervalId) {
    clearInterval(gpsIntervalId);
    gpsIntervalId = null;
    console.log('⏹️ GPS automático parado');
  }
}

// Obter estatísticas
function obterEstatisticasGPS() {
  return {
    ativo: localStorage.getItem('gps_ativo') === 'true',
    intervalo: parseInt(localStorage.getItem('gps_intervalo') || '5'),
    contador: parseInt(localStorage.getItem('gps_contador') || '0'),
    ultimoEnvio: localStorage.getItem('gps_ultimo_envio') ? new Date(localStorage.getItem('gps_ultimo_envio')) : null,
    proximoEnvio: localStorage.getItem('gps_proximo_envio') ? new Date(localStorage.getItem('gps_proximo_envio')) : null,
  };
}

// Iniciar quando a página carregar
if (typeof verificarAuth === 'function' && verificarAuth()) {
  console.log('🚀 Inicializando serviço de GPS automático...');
  
  // Aguardar um pouco para garantir que tudo está carregado
  setTimeout(() => {
    iniciarGPSAutomatico();
  }, 2000);
}

console.log('📍 gps-auto.js carregado!');

