import * as SecureStore from 'expo-secure-store';
import api from './api';

class AuthService {
  // Login do motorista
  async login(cpf, senha) {
    try {
      const response = await api.post('/api/motorista/login', {
        cpf: cpf.replace(/\D/g, ''), // Remove formatação
        senha,
      });

      if (response.data.success) {
        // Salvar token e dados do motorista
        await SecureStore.setItemAsync('token', response.data.token);
        await SecureStore.setItemAsync('motorista', JSON.stringify(response.data.motorista));
        
        return {
          success: true,
          motorista: response.data.motorista,
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Erro ao fazer login',
        };
      }
    } catch (error) {
      console.error('Erro no login:', error);
      return {
        success: false,
        message: error.message || 'Erro ao conectar com o servidor',
      };
    }
  }

  // Logout
  async logout() {
    try {
      await SecureStore.deleteItemAsync('token');
      await SecureStore.deleteItemAsync('motorista');
      return true;
    } catch (error) {
      console.error('Erro no logout:', error);
      return false;
    }
  }

  // Verificar se está logado
  async isLoggedIn() {
    try {
      const token = await SecureStore.getItemAsync('token');
      return !!token;
    } catch (error) {
      return false;
    }
  }

  // Obter dados do motorista
  async getMotorista() {
    try {
      const motorista = await SecureStore.getItemAsync('motorista');
      return motorista ? JSON.parse(motorista) : null;
    } catch (error) {
      console.error('Erro ao obter motorista:', error);
      return null;
    }
  }
}

export default new AuthService();

