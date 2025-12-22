// backend/public/motorista/pages/js/sos.js
// Sistema de SOS (Emergência) para Motoristas
// Versão: 1.0
// Data: 2025-01-16

if (!verificarAuth()) {
  window.location.href = '../index.html';
}

const motorista = getMotorista();
let pressTimer = null;
let pressStartTime = null;
const PRESS_DURATION = 3000; // 3 segundos
let idViagemAtual = null;
let currentLatitude = null;
let currentLongitude = null;

// Obter ID da viagem da URL ou localStorage
const urlParams = new URLSearchParams(window.location.search);
idViagemAtual = urlParams.get('idviagem') || localStorage.getItem('ultimaViagemSelecionada') || null;

if (idViagemAtual) {
  document.getElementById('viagemId').textContent = idViagemAtual;
} else {
  document.getElementById('viagemId').textContent = 'Não selecionada';
}

// Obter localização GPS
obterLocalizacao();

function voltar() {
  window.history.back();
}

function iniciarSOS() {
  const btn = document.getElementById('btnSOS');
  const progressBar = document.getElementById('progressBar');
  
  btn.classList.add('press-and-hold');
  pressStartTime = Date.now();
  
  pressTimer = setInterval(() => {
    const elapsed = Date.now() - pressStartTime;
    const progress = Math.min((elapsed / PRESS_DURATION) * 100, 100);
    progressBar.style.width = progress + '%';
    
    if (elapsed >= PRESS_DURATION) {
      clearInterval(pressTimer);
      enviarSOS();
    }
  }, 50); // Atualizar a cada 50ms para animação suave
}

function cancelarSOS() {
  const btn = document.getElementById('btnSOS');
  const progressBar = document.getElementById('progressBar');
  
  if (pressTimer) {
    clearInterval(pressTimer);
    pressTimer = null;
  }
  
  if (btn) {
    btn.classList.remove('press-and-hold');
  }
  
  if (progressBar) {
    progressBar.style.width = '0%';
  }
  
  pressStartTime = null;
}

async function obterLocalizacao() {
  const localizacaoEl = document.getElementById('localizacao');
  
  if (!navigator.geolocation) {
    localizacaoEl.textContent = 'GPS não disponível';
    return;
  }

  try {
    // Primeiro tentar com watchPosition para obter posição mais rapidamente
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        currentLatitude = position.coords.latitude;
        currentLongitude = position.coords.longitude;
        
        localizacaoEl.textContent = `${currentLatitude.toFixed(6)}, ${currentLongitude.toFixed(6)}`;
        localizacaoEl.style.color = '#2ecc71';
        
        // Parar de observar após obter primeira posição
        navigator.geolocation.clearWatch(watchId);
      },
      (error) => {
        console.warn('Erro no watchPosition, tentando getCurrentPosition...', error);
        navigator.geolocation.clearWatch(watchId);
        
        // Fallback para getCurrentPosition
        navigator.geolocation.getCurrentPosition(
          (position) => {
            currentLatitude = position.coords.latitude;
            currentLongitude = position.coords.longitude;
            localizacaoEl.textContent = `${currentLatitude.toFixed(6)}, ${currentLongitude.toFixed(6)}`;
            localizacaoEl.style.color = '#2ecc71';
          },
          (err) => {
            console.error('Erro ao obter localização:', err);
            localizacaoEl.textContent = 'Erro ao obter GPS. Verifique as permissões.';
            localizacaoEl.style.color = '#e74c3c';
          },
          {
            enableHighAccuracy: false,
            timeout: 20000,
            maximumAge: 120000 // Aceitar posição com até 2 minutos de idade
          }
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: 120000
      }
    );
    
    // Timeout de segurança: parar watch após 30 segundos
    setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
    }, 30000);
  } catch (error) {
    console.error('Erro ao obter localização:', error);
    localizacaoEl.textContent = 'Erro ao obter GPS';
    localizacaoEl.style.color = '#e74c3c';
  }
}

async function enviarSOS() {
  const btn = document.getElementById('btnSOS');
  const statusMessage = document.getElementById('statusMessage');
  const inputMensagem = document.getElementById('inputMensagem');
  
  // Verificar se temos GPS
  if (!currentLatitude || !currentLongitude) {
    mostrarMensagem('Erro: GPS não disponível. Ative a localização e tente novamente.', 'error');
    
    // Tentar obter GPS novamente
    await obterLocalizacao();
    
    if (!currentLatitude || !currentLongitude) {
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = '🔄 Enviando...';

  const message = inputMensagem.value.trim();

  // Obter ID do motorista corretamente
  const idMotorista = motorista?.CDCADASTRO || motorista?.id || motorista?.cdcadastro || null;
  
  if (!idMotorista) {
    mostrarMensagem('Erro: ID do motorista não encontrado. Faça login novamente.', 'error');
    btn.disabled = false;
    btn.textContent = '🆘 Pressione e Segure para SOS';
    return;
  }

  const dadosSOS = {
    idmotorista: idMotorista,
    idviagem: idViagemAtual || null,
    latitude: currentLatitude,
    longitude: currentLongitude,
    message: message || null
  };

  try {
    // Verificar se está online
    const online = navigator.onLine;
    const statusConexaoEl = document.getElementById('statusConexao');
    
    if (online) {
      // Tentar enviar online
      const response = await fetch('/api/motorista/sos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(dadosSOS)
      });

      if (response.ok) {
        const data = await response.json();
        mostrarMensagem('✅ Alerta SOS enviado com sucesso! A equipe foi notificada.', 'success');
        
        // Notificar via serviço unificado
        if (window.NotificacoesService) {
          window.NotificacoesService.mostrarInApp(
            'SOS Enviado',
            'Seu alerta de emergência foi enviado. A equipe foi notificada.',
            window.NotificacoesService.TIPOS.SOS,
            { acao: 'sos' }
          );
        }
        
        // Limpar mensagem
        inputMensagem.value = '';
        
        // Vibrar (se disponível)
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }

        // Notificação do navegador (se permitido)
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('SOS Enviado', {
            body: 'Seu alerta de emergência foi enviado com sucesso.',
            icon: '/motorista/favicon.ico'
          });
        }

        // Aguardar um pouco e voltar
        setTimeout(() => {
          voltar();
        }, 3000);
        
        return;
      } else {
        throw new Error('Erro ao enviar SOS');
      }
    }
    
    // Se offline, salvar na fila
    await adicionarFilaSOS(dadosSOS);
    mostrarMensagem('📦 Alerta SOS salvo offline. Será enviado quando houver conexão.', 'success');
    inputMensagem.value = '';
    setTimeout(() => voltar(), 3000);
    return;

  } catch (error) {
    console.error('Erro ao enviar SOS:', error);
    mostrarMensagem('❌ Erro ao enviar alerta SOS. Tente novamente.', 'error');
    
    // Se falhou online, tentar salvar offline
    try {
      const filaSOS = JSON.parse(localStorage.getItem('filaSOS') || '[]');
      filaSOS.push({
        ...dadosSOS,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem('filaSOS', JSON.stringify(filaSOS));
      mostrarMensagem('📦 Alerta salvo para envio quando houver conexão.', 'success');
    } catch (err) {
      console.error('Erro ao salvar SOS offline:', err);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'ENVIAR ALERTA DE EMERGÊNCIA<div id="progressBar" class="sos-progress" style="width: 0%;"></div>';
    cancelarSOS();
  }
}

function mostrarMensagem(texto, tipo) {
  const statusMessage = document.getElementById('statusMessage');
  statusMessage.textContent = texto;
  statusMessage.className = `status-message ${tipo} show`;
  
  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 5000);
}

// Atualizar status de conexão
function atualizarStatusConexao() {
  const statusConexaoEl = document.getElementById('statusConexao');
  const statusIndicador = document.getElementById('statusIndicador');
  
  if (navigator.onLine) {
    statusConexaoEl.textContent = 'Online';
    statusConexaoEl.style.color = '#28a745';
    if (statusIndicador) {
      statusIndicador.textContent = '🟢 Online';
      statusIndicador.className = 'status-bar status-online';
    }
  } else {
    statusConexaoEl.textContent = 'Offline';
    statusConexaoEl.style.color = '#dc3545';
    if (statusIndicador) {
      statusIndicador.textContent = '🔴 Offline';
      statusIndicador.className = 'status-bar status-offline';
    }
  }
}

// Monitorar status de conexão
window.addEventListener('online', atualizarStatusConexao);
window.addEventListener('offline', atualizarStatusConexao);
atualizarStatusConexao();

// Sincronizar fila SOS quando online (integração com offline.js)
if (typeof sincronizarTudo === 'function') {
  // A fila SOS será sincronizada junto com outras filas
  window.addEventListener('online', async () => {
    await sincronizarFilaSOS();
  });
}

// Função para adicionar SOS na fila offline (IndexedDB)
async function adicionarFilaSOS(dadosSOS) {
  if (typeof adicionarFila === 'function') {
    await adicionarFila('filaSOS', dadosSOS);
  } else {
    // Fallback: usar localStorage
    const filaSOS = JSON.parse(localStorage.getItem('filaSOS') || '[]');
    filaSOS.push({
      ...dadosSOS,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('filaSOS', JSON.stringify(filaSOS));
  }
}

async function sincronizarFilaSOS() {
  if (!navigator.onLine) return;
  if (typeof sincronizarTudo === 'function') {
    await sincronizarTudo();
  }
}
