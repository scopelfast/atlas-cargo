import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// URL base da API (configurável)
const API_BASE_URL = 'http://192.168.1.173:3000'; // Alterar para seu servidor

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para adicionar token em todas as requisições
api.interceptors.request.use(
  async config => {
    const token = await AsyncStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  },
);

// Interceptor para tratar erros
api.interceptors.response.use(
  response => response,
  error => {
    console.error('Erro na API:', error);
    
    // Se não houver resposta (offline)
    if (!error.response) {
      throw new Error('Sem conexão com o servidor. Verifique sua internet.');
    }
    
    // Se erro 401 (não autorizado)
    if (error.response.status === 401) {
      // Redirecionar para login
      AsyncStorage.removeItem('token');
      AsyncStorage.removeItem('motorista');
    }
    
    return Promise.reject(error);
  },
);

export default api;
export {API_BASE_URL};

