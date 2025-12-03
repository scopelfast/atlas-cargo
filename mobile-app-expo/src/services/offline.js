import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Serviço de Offline - Cache e Sincronização (Expo)
 */
class OfflineService {
  constructor() {
    this.syncQueue = [];
  }

  // Salvar dados no cache
  async saveCache(key, data) {
    try {
      const cacheData = {
        data,
        timestamp: new Date().toISOString(),
      };
      await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(cacheData));
      return true;
    } catch (error) {
      console.error('Erro ao salvar cache:', error);
      return false;
    }
  }

  // Buscar dados do cache
  async getCache(key, maxAge = 3600000) {
    try {
      const cached = await AsyncStorage.getItem(`cache_${key}`);
      if (!cached) return null;

      const {data, timestamp} = JSON.parse(cached);
      const age = Date.now() - new Date(timestamp).getTime();

      if (age > maxAge) {
        await this.clearCache(key);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Erro ao buscar cache:', error);
      return null;
    }
  }

  // Adicionar item à fila de sincronização
  async addToSyncQueue(item) {
    try {
      const queue = await this.getSyncQueue();
      queue.push({
        ...item,
        id: Date.now(),
        timestamp: new Date().toISOString(),
        synced: false,
      });
      await AsyncStorage.setItem('sync_queue', JSON.stringify(queue));
      return true;
    } catch (error) {
      console.error('Erro ao adicionar à fila:', error);
      return false;
    }
  }

  // Obter fila de sincronização
  async getSyncQueue() {
    try {
      const queue = await AsyncStorage.getItem('sync_queue');
      return queue ? JSON.parse(queue) : [];
    } catch (error) {
      console.error('Erro ao obter fila:', error);
      return [];
    }
  }

  // Marcar item como sincronizado
  async markAsSynced(itemId) {
    try {
      const queue = await this.getSyncQueue();
      const updatedQueue = queue.filter(item => item.id !== itemId);
      await AsyncStorage.setItem('sync_queue', JSON.stringify(updatedQueue));
      return true;
    } catch (error) {
      console.error('Erro ao marcar como sincronizado:', error);
      return false;
    }
  }

  async clearCache(key) {
    try {
      await AsyncStorage.removeItem(`cache_${key}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async clearSyncQueue() {
    try {
      await AsyncStorage.removeItem('sync_queue');
      return true;
    } catch (error) {
      return false;
    }
  }

  async hasPendingSync() {
    const queue = await this.getSyncQueue();
    return queue.length > 0;
  }

  async getPendingCount() {
    const queue = await this.getSyncQueue();
    return queue.length;
  }
}

export default new OfflineService();
