import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import colors from '../styles/colors';
import api from '../services/api';
import OfflineService from '../services/offline';
import * as SecureStore from 'expo-secure-store';

const ChatScreen = ({navigation}) => {
  const [mensagens, setMensagens] = useState([]);
  const [novaMensagem, setNovaMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const scrollViewRef = useRef();

  useEffect(() => {
    carregarMensagens();
    // Atualizar a cada 10 segundos
    const interval = setInterval(carregarMensagens, 10000);
    return () => clearInterval(interval);
  }, []);

  const carregarMensagens = async () => {
    try {
      const motorista = await AsyncStorage.getItem('motorista');
      const motoristaData = JSON.parse(motorista);

      const response = await api.get(`/api/motorista/chat/${motoristaData.CDCADASTRO}`);
      setMensagens(response.data);
      
      // Scroll para o final
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({animated: true});
      }, 100);
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    }
  };

  const enviarMensagem = async () => {
    if (!novaMensagem.trim()) return;

    const mensagemTexto = novaMensagem.trim();
    setNovaMensagem('');
    setEnviando(true);

    try {
      const motorista = await AsyncStorage.getItem('motorista');
      const motoristaData = JSON.parse(motorista);

      const payload = {
        cdMotorista: motoristaData.CDCADASTRO,
        mensagem: mensagemTexto,
      };

      // Adicionar mensagem localmente
      const novaMsgLocal = {
        IDMENSAGEM: Date.now(),
        MENSAGEM: mensagemTexto,
        REMETENTE: 'MOTORISTA',
        DTMENSAGEM: new Date().toISOString(),
        ENVIADO: false,
      };
      setMensagens(prev => [...prev, novaMsgLocal]);

      // Tentar enviar
      try {
        await api.post('/api/motorista/chat', payload);
        carregarMensagens();
      } catch (error) {
        // Salvar offline
        await OfflineService.addToSyncQueue({
          tipo: 'chat',
          endpoint: '/api/motorista/chat',
          method: 'POST',
          data: payload,
        });
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.title}>💬 Chat com Operador</Text>
      </View>

      {/* Mensagens */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.mensagensContainer}
        contentContainerStyle={styles.mensagensContent}>
        {mensagens.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>Nenhuma mensagem ainda</Text>
            <Text style={styles.emptySubtext}>Envie uma mensagem para começar</Text>
          </View>
        ) : (
          mensagens.map((msg, index) => {
            const isMotorista = msg.REMETENTE === 'MOTORISTA';
            return (
              <View
                key={msg.IDMENSAGEM || index}
                style={[
                  styles.mensagemBubble,
                  isMotorista ? styles.mensagemMotorista : styles.mensagemOperador,
                ]}>
                <Text style={styles.remetenteLabel}>
                  {isMotorista ? 'Você' : 'Operador'}
                </Text>
                <Text
                  style={[
                    styles.mensagemTexto,
                    isMotorista && styles.mensagemTextoMotorista,
                  ]}>
                  {msg.MENSAGEM}
                </Text>
                <View style={styles.mensagemFooter}>
                  <Text
                    style={[
                      styles.mensagemHora,
                      isMotorista && styles.mensagemHoraMotorista,
                    ]}>
                    {new Date(msg.DTMENSAGEM).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  {isMotorista && (
                    <Text style={styles.statusEnvio}>
                      {msg.ENVIADO === false ? '⏳' : '✓'}
                    </Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={novaMensagem}
          onChangeText={setNovaMensagem}
          placeholder="Digite sua mensagem..."
          multiline
          maxLength={500}
          onSubmitEditing={enviarMensagem}
        />
        <TouchableOpacity
          style={[styles.btnEnviar, enviando && styles.btnEnviarDisabled]}
          onPress={enviarMensagem}
          disabled={enviando || !novaMensagem.trim()}>
          <Text style={styles.btnEnviarTexto}>
            {enviando ? '⏳' : '📤'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  
  header: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: colors.white,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  
  backButton: {
    fontSize: 16,
    color: colors.primary,
    marginBottom: 10,
  },
  
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  
  mensagensContainer: {
    flex: 1,
  },
  
  mensagensContent: {
    padding: 20,
  },
  
  mensagemBubble: {
    maxWidth: '80%',
    marginBottom: 15,
    padding: 12,
    borderRadius: 15,
  },
  
  mensagemMotorista: {
    alignSelf: 'flex-end',
    backgroundColor: '#dcf8c6',
  },
  
  mensagemOperador: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
  },
  
  remetenteLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  
  mensagemTexto: {
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 5,
  },
  
  mensagemTextoMotorista: {
    color: '#000',
  },
  
  mensagemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  
  mensagemHora: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  
  mensagemHoraMotorista: {
    color: '#666',
  },
  
  statusEnvio: {
    fontSize: 12,
    marginLeft: 5,
  },
  
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    marginRight: 10,
  },
  
  btnEnviar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  btnEnviarDisabled: {
    opacity: 0.5,
  },
  
  btnEnviarTexto: {
    fontSize: 20,
  },
  
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  
  emptyIcon: {
    fontSize: 64,
    marginBottom: 15,
  },
  
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 5,
  },
  
  emptySubtext: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});

export default ChatScreen;

