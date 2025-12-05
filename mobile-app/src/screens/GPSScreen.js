import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '../styles/colors';

const GPSScreen = ({navigation}) => {
  const [ativo, setAtivo] = useState(false);
  const [intervalo, setIntervalo] = useState('5');
  const [aceitoTermos, setAceitoTermos] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    carregarConfiguracoes();
  }, []);

  const carregarConfiguracoes = async () => {
    try {
      const configAtivo = await AsyncStorage.getItem('gps_ativo');
      const configIntervalo = await AsyncStorage.getItem('gps_intervalo');
      const configTermos = await AsyncStorage.getItem('gps_termos');

      if (configAtivo) setAtivo(configAtivo === 'true');
      if (configIntervalo) setIntervalo(configIntervalo);
      if (configTermos) setAceitoTermos(configTermos === 'true');
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
    }
  };

  const handleSalvar = async () => {
    // Validações
    if (!intervalo || parseInt(intervalo) < 1) {
      Alert.alert('Erro', 'Intervalo deve ser no mínimo 1 minuto');
      return;
    }

    if (ativo && !aceitoTermos) {
      Alert.alert('Erro', 'Você precisa aceitar os termos de utilização');
      return;
    }

    setLoading(true);

    try {
      // Salvar configurações
      await AsyncStorage.setItem('gps_ativo', ativo.toString());
      await AsyncStorage.setItem('gps_intervalo', intervalo);
      await AsyncStorage.setItem('gps_termos', aceitoTermos.toString());

      Alert.alert(
        'Sucesso!',
        `GPS ${ativo ? 'ativado' : 'desativado'} com sucesso!\nIntervalo: ${intervalo} minutos`,
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível salvar as configurações');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Voltar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>⚙️ Configurações GPS</Text>
        </View>

        {/* Card de Configurações */}
        <View style={styles.card}>
          {/* Toggle Ativar/Desativar */}
          <View style={styles.configItem}>
            <View style={styles.configLabel}>
              <Text style={styles.configTitle}>
                📍 Posicionamento Automático
              </Text>
              <Text style={styles.configDescription}>
                Enviar localização automaticamente
              </Text>
            </View>
            <Switch
              value={ativo}
              onValueChange={setAtivo}
              trackColor={{false: '#ccc', true: colors.success}}
              thumbColor={ativo ? colors.white : '#f4f3f4'}
            />
          </View>

          {/* Intervalo */}
          <View style={styles.configItem}>
            <View style={styles.configLabel}>
              <Text style={styles.configTitle}>⏱️ Intervalo de Envio</Text>
              <Text style={styles.configDescription}>
                Em minutos (mínimo 1)
              </Text>
            </View>
            <TextInput
              style={styles.input}
              value={intervalo}
              onChangeText={setIntervalo}
              keyboardType="numeric"
              placeholder="5"
              maxLength={3}
            />
          </View>

          {/* Termos */}
          {ativo && (
            <View style={styles.termsContainer}>
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => setAceitoTermos(!aceitoTermos)}
                activeOpacity={0.7}>
                <View style={[styles.checkbox, aceitoTermos && styles.checkboxChecked]}>
                  {aceitoTermos && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.termsText}>
                  Concordo com os termos de utilização do APP
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.viewTermsButton}
                onPress={() => Alert.alert(
                  'Termos de Utilização',
                  'Ao ativar o GPS, você concorda em compartilhar sua localização em tempo real para fins de rastreamento da viagem.'
                )}>
                <Text style={styles.viewTermsText}>Ver termos completos</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Informações */}
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>ℹ️ Informações:</Text>
            <Text style={styles.infoText}>
              • O GPS funcionará em segundo plano{'\n'}
              • Consumo moderado de bateria{'\n'}
              • Funciona offline (sincroniza depois){'\n'}
              • Você pode pausar a qualquer momento
            </Text>
          </View>
        </View>

        {/* Botão Salvar */}
        <TouchableOpacity
          style={[styles.saveButton, loading && styles.saveButtonDisabled]}
          onPress={handleSalvar}
          disabled={loading}>
          <Text style={styles.saveButtonText}>
            {loading ? 'Salvando...' : '💾 Salvar Configurações'}
          </Text>
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
  },
  
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  
  configItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  configLabel: {
    flex: 1,
    marginRight: 15,
  },
  
  configTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  
  configDescription: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  
  input: {
    width: 80,
    height: 45,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: '#f9f9f9',
  },
  
  termsContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 6,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  checkboxChecked: {
    backgroundColor: colors.primary,
  },
  
  checkmark: {
    color: colors.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  
  termsText: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  
  viewTermsButton: {
    alignSelf: 'flex-start',
  },
  
  viewTermsText: {
    fontSize: 13,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  
  infoBox: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
  },
  
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  
  saveButton: {
    backgroundColor: colors.success,
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    shadowColor: colors.success,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  
  saveButtonDisabled: {
    opacity: 0.6,
  },
  
  saveButtonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default GPSScreen;

