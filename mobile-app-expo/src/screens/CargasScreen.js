import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import colors from '../styles/colors';
import api from '../services/api';
import * as SecureStore from 'expo-secure-store';

const CargasScreen = ({navigation}) => {
  const [cargas, setCargas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    carregarCargas();
  }, []);

  const carregarCargas = async () => {
    try {
      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = JSON.parse(motorista);

      const response = await api.get(`/api/motorista/cargas-disponiveis/${motoristaData.CDCADASTRO}`);
      setCargas(response.data);
    } catch (error) {
      console.error('Erro ao carregar cargas:', error);
      Alert.alert('Erro', 'Não foi possível carregar as cargas disponíveis');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    carregarCargas();
  };

  const handleAceitarCarga = (carga) => {
    Alert.alert(
      'Aceitar Carga',
      `Deseja manifestar interesse nesta carga?\n\n${carga.ROTA}`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Aceitar',
          onPress: () => aceitarCarga(carga.IDVIAGEM),
        },
      ],
    );
  };

  const aceitarCarga = async (idViagem) => {
    try {
      await api.post(`/api/motorista/aceitar-carga/${idViagem}`);
      Alert.alert('Sucesso!', 'Interesse na carga registrado! Aguarde contato da central.');
      carregarCargas();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível aceitar a carga');
    }
  };

  const abrirGoogleMaps = (cidade) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cidade)}`;
    Linking.openURL(url);
  };

  const abrirWhatsApp = (telefone, mensagem) => {
    const telLimpo = telefone.replace(/\D/g, '');
    const url = `whatsapp://send?phone=55${telLimpo}&text=${encodeURIComponent(mensagem)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Erro', 'WhatsApp não está instalado');
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando cargas...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📦 Cargas Disponíveis</Text>
        <Text style={styles.subtitle}>{cargas.length} carga(s) disponível(is)</Text>
      </View>

      {/* Lista de Cargas */}
      <ScrollView
        style={styles.lista}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {cargas.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>Nenhuma carga disponível no momento</Text>
          </View>
        ) : (
          cargas.map((carga) => (
            <View key={carga.IDVIAGEM} style={styles.cargaCard}>
              {/* Header */}
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.idViagem}>#{carga.IDVIAGEM}</Text>
                  <Text style={styles.tipo}>{carga.TIPO}</Text>
                </View>
                <View style={styles.freteContainer}>
                  <Text style={styles.freteLabel}>Frete</Text>
                  <Text style={styles.freteValor}>R$ {carga.FRETE}</Text>
                </View>
              </View>

              {/* Rota */}
              <View style={styles.rotaContainer}>
                <View style={styles.rotaItem}>
                  <Text style={styles.rotaIcon}>📍</Text>
                  <View style={styles.rotaInfo}>
                    <Text style={styles.rotaLabel}>Origem</Text>
                    <Text style={styles.rotaCidade}>{carga.ORIGEM}</Text>
                  </View>
                  <TouchableOpacity onPress={() => abrirGoogleMaps(carga.ORIGEM)}>
                    <Text style={styles.mapIcon}>🗺️</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.rotaLinha}>
                  <Text style={styles.rotaSetinha}>↓</Text>
                </View>
                
                <View style={styles.rotaItem}>
                  <Text style={styles.rotaIcon}>🎯</Text>
                  <View style={styles.rotaInfo}>
                    <Text style={styles.rotaLabel}>Destino</Text>
                    <Text style={styles.rotaCidade}>{carga.DESTINO}</Text>
                  </View>
                  <TouchableOpacity onPress={() => abrirGoogleMaps(carga.DESTINO)}>
                    <Text style={styles.mapIcon}>🗺️</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Informações */}
              <View style={styles.infoGrid}>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Classe:</Text>
                  <Text style={styles.infoValue}>{carga.CLASSE}</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Peso:</Text>
                  <Text style={styles.infoValue}>{carga.PESO} ton</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Cubagem:</Text>
                  <Text style={styles.infoValue}>{carga.CUBAGEM} m³</Text>
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Rastreamento:</Text>
                  <Text style={styles.infoValue}>
                    {carga.EXIGERASTREAMENTO === 'S' ? '✅ Sim' : '❌ Não'}
                  </Text>
                </View>
              </View>

              {/* Datas */}
              <View style={styles.datasContainer}>
                <Text style={styles.dataItem}>
                  📅 Carregamento: {new Date(carga.CARREGAMENTO).toLocaleString('pt-BR')}
                </Text>
                <Text style={styles.dataItem}>
                  📅 Descarga: {new Date(carga.DESCARGA).toLocaleString('pt-BR')}
                </Text>
              </View>

              {/* Contratador */}
              {carga.CONTRATADOR && (
                <View style={styles.contratadorContainer}>
                  <Text style={styles.contratadorLabel}>Contratador:</Text>
                  <View style={styles.contratadorInfo}>
                    <Text style={styles.contratadorNome}>{carga.CONTRATADOR}</Text>
                    {carga.TELEFONE_CONTRATADOR && (
                      <TouchableOpacity
                        onPress={() =>
                          abrirWhatsApp(
                            carga.TELEFONE_CONTRATADOR,
                            `Olá! Tenho interesse na carga #${carga.IDVIAGEM} - ${carga.ROTA}`,
                          )
                        }>
                        <Text style={styles.whatsappIcon}>💬</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* Botão Aceitar */}
              <TouchableOpacity
                style={styles.btnAceitarWrapper}
                onPress={() => handleAceitarCarga(carga)}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={['#56ab2f', '#a8e063']}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 0}}
                  style={styles.btnAceitar}>
                  <Text style={styles.btnTexto}>✅ Tenho Interesse</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
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
    padding: 20,
    paddingTop: 50,
    backgroundColor: colors.white,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
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
  
  lista: {
    flex: 1,
    padding: 20,
  },
  
  cargaCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    overflow: 'hidden',
  },
  
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  idViagem: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  
  tipo: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  
  freteContainer: {
    alignItems: 'flex-end',
  },
  
  freteLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  
  freteValor: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.success,
  },
  
  rotaContainer: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  rotaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  rotaIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  
  rotaInfo: {
    flex: 1,
  },
  
  rotaLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  
  rotaCidade: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  
  mapIcon: {
    fontSize: 24,
  },
  
  rotaLinha: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  
  rotaSetinha: {
    fontSize: 24,
    color: colors.primary,
  },
  
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  infoItem: {
    width: '50%',
    marginBottom: 12,
  },
  
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  
  datasContainer: {
    padding: 20,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  dataItem: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  
  contratadorContainer: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  contratadorLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  
  contratadorInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  
  contratadorNome: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  
  whatsappIcon: {
    fontSize: 28,
  },
  
  btnAceitarWrapper: {
    margin: 20,
  },
  
  btnAceitar: {
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
  },
  
  btnTexto: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
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
    fontSize: 16,
    color: colors.textSecondary,
  },
});

export default CargasScreen;

