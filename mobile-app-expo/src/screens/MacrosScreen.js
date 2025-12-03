import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import colors from '../styles/colors';
import api from '../services/api';
import OfflineService from '../services/offline';
import GPSService from '../services/gps';
import * as SecureStore from 'expo-secure-store';

const MacrosScreen = ({navigation}) => {
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viagens, setViagens] = useState([]);
  const [viagemSelecionada, setViagemSelecionada] = useState(null);
  const [showViagemModal, setShowViagemModal] = useState(false);
  const [historico, setHistorico] = useState([]);

  useEffect(() => {
    carregarMacros();
    verificarViagensEmAndamento();
  }, []);

  const carregarMacros = async () => {
    try {
      // Buscar macros do banco de dados
      const response = await api.get('/api/motorista/macros');
      console.log('✅ Macros carregadas do banco:', response.data.length);
      setMacros(response.data);
    } catch (error) {
      console.error('❌ Erro ao carregar macros:', error);
      Alert.alert('Erro', 'Não foi possível carregar as macros. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  const verificarViagensEmAndamento = async () => {
    try {
      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = JSON.parse(motorista);
      
      const response = await api.get(`/api/motorista/viagens-andamento/${motoristaData.CDCADASTRO}`);
      
      if (response.data.length > 1) {
        setViagens(response.data);
        setShowViagemModal(true);
      } else if (response.data.length === 1) {
        setViagemSelecionada(response.data[0]);
        carregarHistorico(response.data[0].IDVIAGEM);
      }
    } catch (error) {
      console.error('Erro ao verificar viagens:', error);
    }
  };

  const carregarHistorico = async (idViagem) => {
    try {
      const response = await api.get(`/api/motorista/historico-macros/${idViagem}`);
      setHistorico(response.data);
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
      setHistorico([]);
    }
  };

  const validarSequencia = (macro) => {
    // REGRA 1: Primeira macro DEVE ser "Viagem - Início" (103)
    if (historico.length === 0) {
      if (macro.CDTIPOOCORRENCIA === 103) {
        return {valido: true, mensagem: 'Primeira ocorrência válida'};
      }
      return {valido: false, mensagem: 'Primeira ocorrência deve ser: Viagem - Início'};
    }

    const ultimaMacro = historico[0]; // Mais recente

    // REGRA 2: Viagem - Reinício (104) só após PARADA
    if (macro.CDTIPOOCORRENCIA === 104) {
      const macrosParada = [110, 111, 105, 106, 107, 26, 58];
      if (macrosParada.includes(ultimaMacro.CDTIPOOCORRENCIA) || ultimaMacro.FGSITUACAO === 'P') {
        return {valido: true, mensagem: 'Reinício após parada válido'};
      }
      return {valido: false, mensagem: 'Viagem - Reinício só é permitido após uma PARADA'};
    }

    // REGRA 3: Sequência 2 só após Sequência 1 (mesma situação)
    if (macro.SEQ === 2) {
      if (ultimaMacro.FGSITUACAO === macro.FGSITUACAO && ultimaMacro.SEQ === 1) {
        return {valido: true, mensagem: 'Sequência 2 válida'};
      }
      return {valido: false, mensagem: `Sequência 2 só após Sequência 1 (${getSituacaoTexto(macro.FGSITUACAO)})`};
    }

    // REGRA 4: Sequência 3 só após Sequência 2 (mesma situação)
    if (macro.SEQ === 3) {
      if (ultimaMacro.FGSITUACAO === macro.FGSITUACAO && ultimaMacro.SEQ === 2) {
        return {valido: true, mensagem: 'Sequência 3 válida'};
      }
      return {valido: false, mensagem: `Sequência 3 só após Sequência 2 (${getSituacaoTexto(macro.FGSITUACAO)})`};
    }

    return {valido: true, mensagem: 'Macro válida'};
  };

  const getSituacaoTexto = (codigo) => {
    const situacoes = {
      T: 'TRÂNSITO',
      C: 'CARREGAMENTO',
      D: 'DESCARGA',
      P: 'PARADA',
    };
    return situacoes[codigo] || codigo;
  };

  const handleSelecionarMacro = async (macro) => {
    if (!viagemSelecionada) {
      Alert.alert('Erro', 'Selecione uma viagem primeiro');
      return;
    }

    // Validar sequência
    const validacao = validarSequencia(macro);
    if (!validacao.valido) {
      Alert.alert('Sequência Inválida', validacao.mensagem);
      return;
    }

    // Perguntar se quer tirar foto
    Alert.alert(
      macro.DSTIPOOCORRENCIA,
      'Deseja registrar esta ocorrência?',
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Sem Foto',
          onPress: () => registrarMacro(macro, null),
        },
        {
          text: 'Com Foto',
          onPress: () => tirarFoto(macro),
        },
      ],
    );
  };

  const tirarFoto = async (macro) => {
    // Solicitar permissão
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Erro', 'Permissão da câmera negada');
      return;
    }

    // Tirar foto
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets) {
      const foto = result.assets[0];
      registrarMacro(macro, foto.base64);
    }
  };

  const registrarMacro = async (macro, fotoBase64) => {
    try {
      console.log('📍 Capturando GPS para a macro...');
      
      // Capturar GPS completo
      const posicao = await GPSService.obterPosicaoAtual();
      
      console.log('✅ GPS capturado:', {
        lat: posicao.latitude,
        lon: posicao.longitude,
        velocidade: posicao.velocidade,
        status: posicao.statusTexto,
      });

      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = JSON.parse(motorista);

      const payload = {
        idViagem: viagemSelecionada.IDVIAGEM,
        cdMotorista: motoristaData.CDCADASTRO,
        cdTipoOcorrencia: macro.CDTIPOOCORRENCIA,
        // GPS completo
        latitude: posicao.latitude,
        longitude: posicao.longitude,
        altitude: posicao.altitude,
        precisao: posicao.precisao,
        velocidade: posicao.velocidade,
        status: posicao.status, // P=Parado, M=Movimento
        direcao: posicao.direcao,
        // Foto
        fotoBase64: fotoBase64,
      };

      // Tentar enviar online
      try {
        await api.post('/api/motorista/macro', payload);
        
        // Mensagem de sucesso detalhada
        Alert.alert(
          'Sucesso!',
          `${macro.DSTIPOOCORRENCIA} registrada!\n\n` +
          `📍 GPS: ${posicao.statusTexto}\n` +
          `🚗 Velocidade: ${posicao.velocidade || '0'} km/h\n` +
          `${fotoBase64 ? '📸 Com foto' : ''}`,
          [{text: 'OK', onPress: () => carregarHistorico(viagemSelecionada.IDVIAGEM)}]
        );
      } catch (error) {
        // Salvar offline
        await OfflineService.addToSyncQueue({
          tipo: 'macro',
          endpoint: '/api/motorista/macro',
          method: 'POST',
          data: payload,
        });
        
        Alert.alert(
          'Salvo Offline',
          `${macro.DSTIPOOCORRENCIA} salva!\n\n` +
          `📍 GPS capturado: ${posicao.statusTexto}\n` +
          `Será enviada quando houver conexão`,
          [{text: 'OK', onPress: () => carregarHistorico(viagemSelecionada.IDVIAGEM)}]
        );
      }
    } catch (error) {
      console.error('❌ Erro ao registrar macro:', error);
      
      if (error.message === 'Permissão de GPS negada') {
        Alert.alert(
          'GPS Necessário',
          'Para registrar a macro, precisamos da sua localização.\n\nPor favor, ative o GPS e permita o acesso.',
        );
      } else {
        Alert.alert('Erro', 'Não foi possível registrar a macro');
      }
    }
  };

  const getMacroColor = (situacao) => {
    const cores = {
      T: ['#667eea', '#764ba2'], // Trânsito
      C: ['#4facfe', '#00f2fe'], // Carregamento
      D: ['#43e97b', '#38f9d7'], // Descarga
      P: ['#fa709a', '#fee140'], // Parada
    };
    return cores[situacao] || ['#ccc', '#999'];
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando macros...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>📝 Macros / Ocorrências</Text>
        </View>

        {/* Viagem Selecionada */}
        {viagemSelecionada && (
          <View style={styles.viagemCard}>
            <Text style={styles.viagemTitle}>Viagem Selecionada:</Text>
            <Text style={styles.viagemInfo}>
              #{viagemSelecionada.IDVIAGEM} - {viagemSelecionada.ROTA}
            </Text>
            {viagens.length > 1 && (
              <TouchableOpacity onPress={() => setShowViagemModal(true)}>
                <Text style={styles.changeLink}>Trocar viagem</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Grid de Macros */}
        <View style={styles.macrosGrid}>
          {macros.map((macro) => {
            const validacao = validarSequencia(macro);
            const desabilitado = !validacao.valido;

            return (
              <TouchableOpacity
                key={macro.CDTIPOOCORRENCIA}
                style={[styles.macroWrapper, desabilitado && styles.macroDisabled]}
                onPress={() => handleSelecionarMacro(macro)}
                disabled={desabilitado}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={getMacroColor(macro.FGSITUACAO)}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 1}}
                  style={styles.macroButton}>
                  <Text style={styles.macroIcon}>{macro.icon}</Text>
                  <Text style={styles.macroText}>{macro.DSTIPOOCORRENCIA}</Text>
                  {desabilitado && (
                    <View style={styles.lockBadge}>
                      <Text style={styles.lockIcon}>🔒</Text>
                    </View>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Histórico */}
        {historico.length > 0 && (
          <View style={styles.historicoCard}>
            <Text style={styles.historicoTitle}>📋 Histórico (últimas 5):</Text>
            {historico.slice(0, 5).map((item, index) => (
              <View key={index} style={styles.historicoItem}>
                <Text style={styles.historicoTexto}>{item.DSTIPOOCORRENCIA}</Text>
                <Text style={styles.historicoHora}>
                  {new Date(item.DTOCORRENCIA).toLocaleString('pt-BR')}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Modal Selecionar Viagem */}
      <Modal visible={showViagemModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecione a Viagem:</Text>
            <ScrollView>
              {viagens.map((viagem) => (
                <TouchableOpacity
                  key={viagem.IDVIAGEM}
                  style={styles.viagemOption}
                  onPress={() => {
                    setViagemSelecionada(viagem);
                    carregarHistorico(viagem.IDVIAGEM);
                    setShowViagemModal(false);
                  }}>
                  <Text style={styles.viagemOptionTexto}>
                    #{viagem.IDVIAGEM} - {viagem.ROTA}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowViagemModal(false)}>
              <Text style={styles.modalCloseText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  
  content: {
    padding: 20,
    paddingTop: 50,
  },
  
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
  },
  
  loadingText: {
    marginTop: 10,
    color: colors.textSecondary,
  },
  
  header: {
    marginBottom: 20,
  },
  
  backButton: {
    fontSize: 16,
    color: colors.primary,
    marginBottom: 10,
  },
  
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  
  viagemCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
  },
  
  viagemTitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 5,
  },
  
  viagemInfo: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  
  changeLink: {
    fontSize: 14,
    color: colors.primary,
    marginTop: 5,
  },
  
  macrosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  
  macroWrapper: {
    width: '48%',
    marginBottom: 15,
  },
  
  macroDisabled: {
    opacity: 0.4,
  },
  
  macroButton: {
    aspectRatio: 1,
    borderRadius: 20,
    padding: 15,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  
  macroIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  
  macroText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  
  lockBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 4,
  },
  
  lockIcon: {
    fontSize: 16,
  },
  
  historicoCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 15,
  },
  
  historicoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  
  historicoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  historicoTexto: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  
  historicoHora: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  
  viagemOption: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  viagemOptionTexto: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  
  modalCloseButton: {
    marginTop: 15,
    padding: 15,
    backgroundColor: colors.danger,
    borderRadius: 10,
    alignItems: 'center',
  },
  
  modalCloseText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default MacrosScreen;

