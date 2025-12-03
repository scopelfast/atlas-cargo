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
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import colors from '../styles/colors';
import api from '../services/api';
import * as SecureStore from 'expo-secure-store';

const ViagensScreen = ({navigation}) => {
  const [viagens, setViagens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    carregarViagens();
  }, []);

  const carregarViagens = async () => {
    try {
      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = JSON.parse(motorista);

      const response = await api.get(`/api/motorista/viagens-andamento/${motoristaData.CDCADASTRO}`);
      setViagens(response.data);
    } catch (error) {
      console.error('Erro ao carregar viagens:', error);
      Alert.alert('Erro', 'Não foi possível carregar as viagens');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    carregarViagens();
  };

  const getStatusColor = (status) => {
    const cores = {
      'EM ANDAMENTO': ['#4facfe', '#00f2fe'],
      'CARREGANDO': ['#f093fb', '#f5576c'],
      'DESCARREGANDO': ['#ffd89b', '#19547b'],
      'FINALIZADA': ['#56ab2f', '#a8e063'],
    };
    return cores[status] || ['#ccc', '#999'];
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando viagens...</Text>
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
        <Text style={styles.title}>🚛 Minhas Viagens</Text>
        <Text style={styles.subtitle}>{viagens.length} viagen(s) em andamento</Text>
      </View>

      {/* Lista */}
      <ScrollView
        style={styles.lista}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {viagens.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🚛</Text>
            <Text style={styles.emptyText}>Nenhuma viagem em andamento</Text>
          </View>
        ) : (
          viagens.map((viagem) => (
            <View key={viagem.IDVIAGEM} style={styles.viagemCard}>
              {/* Header */}
              <LinearGradient
                colors={getStatusColor(viagem.STATUS)}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 0}}
                style={styles.cardHeader}>
                <View>
                  <Text style={styles.idViagem}>#{viagem.IDVIAGEM}</Text>
                  <Text style={styles.statusViagem}>{viagem.STATUS}</Text>
                </View>
                <Text style={styles.headerIcon}>🚚</Text>
              </LinearGradient>

              {/* Conteúdo */}
              <View style={styles.cardContent}>
                <Text style={styles.rota}>{viagem.ROTA}</Text>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Tipo:</Text>
                    <Text style={styles.infoValue}>{viagem.TIPO}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Classe:</Text>
                    <Text style={styles.infoValue}>{viagem.CLASSE}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Frete:</Text>
                    <Text style={styles.infoValue}>R$ {viagem.FRETE}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Peso:</Text>
                    <Text style={styles.infoValue}>{viagem.PESO} ton</Text>
                  </View>
                </View>

                <View style={styles.datasContainer}>
                  <Text style={styles.dataLabel}>
                    📅 Carregamento: {new Date(viagem.CARREGAMENTO).toLocaleString('pt-BR')}
                  </Text>
                  <Text style={styles.dataLabel}>
                    📅 Descarga: {new Date(viagem.DESCARGA).toLocaleString('pt-BR')}
                  </Text>
                </View>

                {/* Botões de Ação */}
                <View style={styles.acoesContainer}>
                  <TouchableOpacity
                    style={styles.btnAcao}
                    onPress={() =>
                      navigation.navigate('Macros', {idViagem: viagem.IDVIAGEM})
                    }>
                    <Text style={styles.btnAcaoTexto}>📝 Macros</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnAcao}
                    onPress={() => Alert.alert('Em breve', 'Função em desenvolvimento')}>
                    <Text style={styles.btnAcaoTexto}>📍 Ver no Mapa</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
  
  viagemCard: {
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
    alignItems: 'center',
    padding: 20,
  },
  
  idViagem: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  
  statusViagem: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.white,
  },
  
  headerIcon: {
    fontSize: 40,
  },
  
  cardContent: {
    padding: 20,
  },
  
  rota: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 15,
  },
  
  infoItem: {
    width: '50%',
    marginBottom: 10,
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
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 10,
    marginBottom: 15,
  },
  
  dataLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 5,
  },
  
  acoesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  
  btnAcao: {
    flex: 1,
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  
  btnAcaoTexto: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
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

export default ViagensScreen;

