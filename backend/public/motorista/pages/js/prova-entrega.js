// backend/public/motorista/pages/js/prova-entrega.js
// Comprovação de Entrega (POD - Proof of Delivery)
// Versão: 1.0
// Data: 2025-01-16

(function() {
  if (!verificarAuth()) {
    window.location.href = '../index.html';
    return;
  }

  const motorista = getMotorista();
  // Obter ID do motorista corretamente
  const idMotorista = motorista?.CDCADASTRO || motorista?.id || motorista?.cdcadastro || null;
  let idViagem = null;
  let photoData = null;
  let signatureData = null;
  let canvas = null;
  let ctx = null;
  let isDrawing = false;

  // ==========================================
  // INICIALIZAÇÃO
  // ==========================================
  async function init() {
    // Buscar ID da viagem da URL ou localStorage
    const params = new URLSearchParams(window.location.search);
    idViagem = params.get('viagem') || localStorage.getItem('viagemAtual');

    if (!idViagem) {
      mostrarToast('Nenhuma viagem selecionada. Redirecionando...', 'warning');
      setTimeout(() => {
      window.location.href = 'viagens.html';
      }, 2000);
      return;
    }

    // Carregar informações da viagem
    await carregarViagem();

    // Inicializar canvas de assinatura
    initAssinatura();

    // Atualizar status bar
    await atualizarStatusBar();
  }

  // ==========================================
  // CARREGAR VIAGEM
  // ==========================================
  async function carregarViagem() {
    try {
      const token = localStorage.getItem('token');
      const baseUrl = window.__BASE_URL__ || ('http://' + window.location.host);
      
      const response = await fetch(`${baseUrl}/api/motorista/viagem/${idViagem}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        // A resposta pode vir como objeto direto ou dentro de 'viagem'
        const viagem = data.viagem || data;

        if (!viagem || !viagem.IDVIAGEM) {
          console.error('❌ Dados da viagem inválidos:', data);
          document.getElementById('viagemInfo').innerHTML = `
            <div style="color: #e74c3c; padding: 20px; text-align: center;">
              <strong>⚠️ Erro ao carregar dados da viagem</strong><br>
              <small>ID: ${idViagem}</small>
            </div>
          `;
          return;
        }

        document.getElementById('viagemInfo').innerHTML = `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <strong>ID Viagem:</strong><br>
              <span style="color: #667eea; font-size: 18px; font-weight: 700;">#${viagem.IDVIAGEM}</span>
            </div>
            <div>
              <strong>Roteiro:</strong><br>
              <span>${viagem.ROTEIRO || viagem.DSROTEIRO || '-'}</span>
            </div>
            <div>
              <strong>Origem:</strong><br>
              <span>${viagem.ORIGEM || viagem.ORIGEM_CIDADE || '-'}</span>
            </div>
            <div>
              <strong>Destino:</strong><br>
              <span>${viagem.DESTINO || viagem.DESTINO_CIDADE || '-'}</span>
            </div>
          </div>
        `;
      } else {
        const errorText = await response.text();
        console.error('❌ Erro ao carregar viagem:', response.status, errorText);
        document.getElementById('viagemInfo').innerHTML = `
          <div style="color: #e74c3c; padding: 20px; text-align: center;">
            <strong>⚠️ Erro ao carregar viagem</strong><br>
            <small>Status: ${response.status}</small>
          </div>
        `;
      }
    } catch (err) {
      console.error('Erro ao carregar viagem:', err);
    }
  }

  // ==========================================
  // CAPTURA DE FOTO
  // ==========================================
  function capturarFoto() {
    const input = document.getElementById('photoInput');
    input.click();

    input.onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;

      // Validar tipo
      if (!file.type.startsWith('image/')) {
        mostrarToast('Por favor, selecione uma imagem', 'warning');
        return;
      }

      // Validar tamanho (máximo 5MB)
      if (file.size > 5 * 1024 * 1024) {
        mostrarToast('Foto muito grande. Máximo 5MB.', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = function(e) {
        photoData = e.target.result; // Base64
        
        // Mostrar preview
        const preview = document.getElementById('photoPreview');
        preview.innerHTML = `<img src="${photoData}" alt="Foto da entrega">`;
        preview.classList.add('has-photo');
      };
      reader.readAsDataURL(file);
    };
  }

  // ==========================================
  // ASSINATURA DIGITAL
  // ==========================================
  function initAssinatura() {
    canvas = document.getElementById('signatureCanvas');
    ctx = canvas.getContext('2d');

    // Ajustar tamanho do canvas
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width - 20; // Margem
    canvas.height = 200;

    // Estilo do traço
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Eventos mouse
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Eventos touch (mobile)
    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('touchmove', handleTouch);
    canvas.addEventListener('touchend', stopDrawing);
  }

  function startDrawing(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function handleTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent(e.type === 'touchstart' ? 'mousedown' : 
                                      e.type === 'touchmove' ? 'mousemove' : 'mouseup', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }

  function stopDrawing() {
    if (isDrawing) {
      isDrawing = false;
      // Salvar assinatura como PNG base64 sempre que parar de desenhar
      try {
        signatureData = canvas.toDataURL('image/png');
      } catch (err) {
        console.error('Erro ao salvar assinatura:', err);
      }
    }
  }

  function limparAssinatura() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signatureData = null;
  }

  // ==========================================
  // SALVAR COMPROVANTE
  // ==========================================
  async function salvarComprovante() {
    // Validações
    const receiverName = document.getElementById('receiverName').value.trim();
    if (!receiverName) {
      mostrarToast('Por favor, informe o nome do recebedor', 'warning');
      return;
    }

    // Verificar se há assinatura no canvas (mesmo que signatureData não esteja salvo ainda)
    if (!photoData && !signatureData) {
      // Tentar capturar assinatura do canvas antes de validar
      try {
        signatureData = canvas.toDataURL('image/png');
      } catch (err) {
        console.warn('Erro ao capturar assinatura:', err);
      }
    }

    if (!photoData && !signatureData) {
      mostrarToast('Por favor, capture pelo menos uma foto ou uma assinatura', 'warning');
      return;
    }

    // Garantir que assinatura está salva
    if (!signatureData && canvas) {
      try {
        signatureData = canvas.toDataURL('image/png');
      } catch (err) {
        console.warn('Erro ao capturar assinatura antes de salvar:', err);
      }
    }

    // Obter coordenadas GPS
    let latitude = null;
    let longitude = null;

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    } catch (err) {
      console.warn('⚠️ Não foi possível obter coordenadas GPS:', err);
    }

    // Preparar dados
    const dados = {
      idviagem: idViagem,
      idmotorista: idMotorista,
      photoData: photoData,
      photoName: `entrega_${idViagem}_${Date.now()}.jpg`,
      signatureData: signatureData,
      receiverName: receiverName,
      receiverDocument: document.getElementById('receiverDocument').value.trim() || null,
      observations: document.getElementById('observations').value.trim() || null,
      latitude: latitude,
      longitude: longitude
    };

    // Desabilitar botão
    const btnSalvar = document.getElementById('btnSalvar');
    btnSalvar.disabled = true;
    btnSalvar.textContent = '⏳ Salvando...';

    const statusDiv = document.getElementById('submitStatus');
    statusDiv.style.display = 'block';
    statusDiv.className = 'status-indicator pending';
    statusDiv.textContent = '⏳ Salvando comprovante...';

    try {
      // Tentar salvar online
      if (window.OfflineDB && window.OfflineDB.isOnline()) {
        const token = localStorage.getItem('token');
        const baseUrl = window.__BASE_URL__ || ('http://' + window.location.host);
        
        const response = await fetch(`${baseUrl}/api/motorista/delivery-proof`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dados)
        });

        if (response.ok) {
          // Sucesso online
          statusDiv.className = 'status-indicator success';
          statusDiv.textContent = '✅ Comprovante salvo com sucesso!';
          
          setTimeout(() => {
            voltar();
          }, 1500);
          return;
        }
      }

      // Se chegou aqui, está offline ou falhou - adicionar à fila
      if (window.OfflineDB) {
        await window.OfflineDB.adicionarFila('filaComprovantes', {
          ...dados,
          endpoint: '/api/motorista/delivery-proof',
          method: 'POST'
        });

        statusDiv.className = 'status-indicator pending';
        statusDiv.textContent = '📴 Offline - Será enviado quando online';
        
        setTimeout(() => {
          voltar();
        }, 2000);
      } else {
        throw new Error('Sistema offline não disponível');
      }
    } catch (err) {
      console.error('Erro ao salvar comprovante:', err);
      mostrarToast('Erro ao salvar comprovante: ' + err.message, 'error');
      
      btnSalvar.disabled = false;
      btnSalvar.textContent = '✅ Salvar Comprovante de Entrega';
      statusDiv.style.display = 'none';
    }
  }

  // ==========================================
  // NAVEGAÇÃO
  // ==========================================
  window.voltar = function() {
    window.location.href = 'viagens.html';
  };

  // ==========================================
  // STATUS BAR
  // ==========================================
  async function atualizarStatusBar() {
    if (window.OfflineDB && window.OfflineDB.atualizarIndicador) {
      await window.OfflineDB.atualizarIndicador();
    }
  }

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
