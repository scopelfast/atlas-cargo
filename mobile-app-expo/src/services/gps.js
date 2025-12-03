import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import api from './api';
import OfflineService from './offline';

/**
 * Serviço de GPS - Captura e envio de posição (Expo)
 */
class GPSService {
  constructor() {
    this.watchId = null;
    this.intervaloId = null;
    this.ultimaPosicao = null;
  }

  /**
   * Solicitar permissões GPS
   */
  async solicitarPermissao() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  }

  /**
   * Obter posição atual
   */
  async obterPosicaoAtual() {
    const temPermissao = await this.solicitarPermissao();
    if (!temPermissao) {
      throw new Error('Permissão de GPS negada');
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return this.processarPosicao(location);
  }

  /**
   * Processar dados da posição GPS
   */
  processarPosicao(location) {
    const {coords} = location;
    
    // Velocidade em m/s -> km/h
    const velocidadeKmH = coords.speed !== null && coords.speed !== undefined
      ? (coords.speed * 3.6).toFixed(2)
      : null;

    // Determinar se está parado ou em movimento
    // Considera parado se velocidade < 5 km/h
    const status = !velocidadeKmH || parseFloat(velocidadeKmH) < 5 ? 'P' : 'M';

    return {
      latitude: coords.latitude.toFixed(7),
      longitude: coords.longitude.toFixed(7),
      altitude: coords.altitude ? coords.altitude.toFixed(2) : null,
      velocidade: velocidadeKmH,
      direcao: coords.heading !== null && coords.heading !== undefined 
        ? coords.heading.toFixed(2) 
        : null,
      precisao: coords.accuracy ? coords.accuracy.toFixed(2) : null,
      status: status, // P=Parado, M=Movimento
      statusTexto: status === 'P' ? 'Parado' : 'Em Movimento',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Enviar posição para o servidor
   */
  async enviarPosicao(manual = true) {
    try {
      const posicao = await this.obterPosicaoAtual();
      
      // Buscar configurações
      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = motorista ? JSON.parse(motorista) : null;

      if (!motoristaData) {
        throw new Error('Motorista não identificado');
      }

      // Montar payload
      const payload = {
        cdMotorista: motoristaData.CDCADASTRO,
        idViagem: null,
        latitude: posicao.latitude,
        longitude: posicao.longitude,
        altitude: posicao.altitude,
        precisao: posicao.precisao,
        velocidade: posicao.velocidade,
        status: posicao.status,
        direcao: posicao.direcao,
        tipoEnvio: manual ? 'M' : 'A',
        dtPosicao: posicao.timestamp,
      };

      // Tentar enviar online
      try {
        await api.post('/api/motorista/gps', payload);
        console.log('✅ Posição enviada online');
        return {success: true, posicao, online: true};
      } catch (error) {
        // Se falhar, adicionar à fila offline
        console.log('⚠️ Offline - adicionando à fila');
        await OfflineService.addToSyncQueue({
          tipo: 'gps',
          endpoint: '/api/motorista/gps',
          method: 'POST',
          data: payload,
        });
        return {success: true, posicao, online: false};
      }
    } catch (error) {
      console.error('❌ Erro ao enviar posição:', error);
      throw error;
    }
  }

  /**
   * Obter direção cardinal (N, S, L, O, NE, etc)
   */
  obterDirecaoCardinal(graus) {
    if (graus === null || graus === undefined) return null;

    const direcoes = ['Norte', 'Nordeste', 'Leste', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];
    const indice = Math.round(graus / 45) % 8;
    return direcoes[indice];
  }
}

export default new GPSService();

