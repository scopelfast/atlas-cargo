import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import colors from '../styles/colors';
import GPSService from '../services/gps';

const EnviarPosicaoScreen = ({navigation}) => {
  const [enviando, setEnviando] = useState(false);
  const [ultimaPosicao, setUltimaPosicao] = useState(null);

  const handleEnviarPosicao = async () => {
    setEnviando(true);
    
    try {
      const resultado = await GPSService.enviarPosicao(true); // manual=true
      
      setUltimaPosicao(resultado.posicao);
      
      const mensagem = resultado.online
        ? '✅ Posição enviada com sucesso!'
        : '✅ Posição salva! (Será enviada quando houver conexão)';
      
      Alert.alert(
        'Sucesso',
        `${mensagem}\n\n` +
        `📍 Localização: ${resultado.posicao.latitude}, ${resultado.posicao.longitude}\n` +
        `${resultado.posicao.statusTexto}\n` +
        `🚗 Velocidade: ${resultado.posicao.velocidade || '0'} km/h`,
        [
          {
            text: 'Voltar ao Menu',
            onPress: () => navigation.goBack(),
          },
          {
            text: 'Enviar Outra',
            style: 'cancel',
          },
        ]
      );
    } catch (error) {
      Alert.alert(
        'Erro',
        error.message === 'Permissão de GPS negada'
          ? 'Você precisa permitir o acesso à localização'
          : 'Não foi possível obter sua localização',
      );
    } finally {
      setEnviando(false);
    }
  };

  const getStatusIcon = () => {
    if (!ultimaPosicao) return '📍';
    return ultimaPosicao.status === 'P' ? '🅿️' : '🚗';
  };

  const getStatusColor = () => {
    if (!ultimaPosicao) return colors.primary;
    return ultimaPosicao.status === 'P' ? colors.warning : colors.success;
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>📤 Enviar Posição</Text>
          <Text style={styles.subtitle}>
            Envie sua localização atual manualmente
          </Text>
        </View>

        {/* Card Principal */}
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Text style={styles.bigIcon}>{getStatusIcon()}</Text>
          </View>

          <Text style={styles.cardTitle}>Posição Manual</Text>
          <Text style={styles.cardDescription}>
            Clique no botão abaixo para enviar sua localização atual para a central
          </Text>

          {/* Última Posição */}
          {ultimaPosicao && (
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>📍 Última Posição Enviada:</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status:</Text>
                <Text style={[styles.infoValue, {color: getStatusColor()}]}>
                  {ultimaPosicao.statusTexto}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Velocidade:</Text>
                <Text style={styles.infoValue}>
                  {ultimaPosicao.velocidade || '0'} km/h
                </Text>
              </View>
              {ultimaPosicao.direcao && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Direção:</Text>
                  <Text style={styles.infoValue}>
                    {GPSService.obterDirecaoCardinal(parseFloat(ultimaPosicao.direcao))}
                  </Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Coordenadas:</Text>
                <Text style={styles.infoValue}>
                  {ultimaPosicao.latitude}, {ultimaPosicao.longitude}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Horário:</Text>
                <Text style={styles.infoValue}>
                  {new Date(ultimaPosicao.timestamp).toLocaleTimeString('pt-BR')}
                </Text>
              </View>
            </View>
          )}

          {/* Botão Enviar */}
          <TouchableOpacity
            style={styles.sendButtonWrapper}
            onPress={handleEnviarPosicao}
            disabled={enviando}
            activeOpacity={0.8}>
            <LinearGradient
              colors={['#f093fb', '#f5576c']}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 1}}
              style={styles.sendButton}>
              {enviando ? (
                <>
                  <ActivityIndicator color={colors.white} size="small" />
                  <Text style={styles.sendButtonText}>  Obtendo localização...</Text>
                </>
              ) : (
                <>
                  <Text style={styles.sendButtonIcon}>📤</Text>
                  <Text style={styles.sendButtonText}>Enviar Posição Agora</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Informações */}
        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>ℹ️ Como funciona:</Text>
          <Text style={styles.helpText}>
            • A posição é capturada instantaneamente{'\n'}
            • Inclui velocidade e status (parado/movimento){'\n'}
            • Funciona offline (sincroniza depois){'\n'}
            • Informações precisas em tempo real
          </Text>
        </View>

        {/* Card Rastreamento Automático */}
        <TouchableOpacity
          style={styles.autoTrackCard}
          onPress={() => navigation.navigate('GPS')}
          activeOpacity={0.8}>
          <Text style={styles.autoTrackIcon}>⚙️</Text>
          <View style={styles.autoTrackContent}>
            <Text style={styles.autoTrackTitle}>
              Quer rastreamento automático?
            </Text>
            <Text style={styles.autoTrackSubtitle}>
              Configure o GPS para enviar posições periodicamente
            </Text>
          </View>
          <Text style={styles.autoTrackArrow}>→</Text>
        </TouchableOpacity>
      </View>
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
    marginBottom: 5,
  },
  
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 25,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    alignItems: 'center',
  },
  
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  
  bigIcon: {
    fontSize: 50,
  },
  
  cardTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  
  cardDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  
  infoBox: {
    width: '100%',
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  
  infoValue: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  
  sendButtonWrapper: {
    width: '100%',
  },
  
  sendButton: {
    flexDirection: 'row',
    paddingVertical: 18,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f5576c',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  
  sendButtonIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  
  sendButtonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  
  helpCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  
  helpTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  
  helpText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  
  autoTrackCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  
  autoTrackIcon: {
    fontSize: 32,
    marginRight: 15,
  },
  
  autoTrackContent: {
    flex: 1,
  },
  
  autoTrackTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  
  autoTrackSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  
  autoTrackArrow: {
    fontSize: 24,
    color: colors.primary,
    marginLeft: 10,
  },
});

export default EnviarPosicaoScreen;

