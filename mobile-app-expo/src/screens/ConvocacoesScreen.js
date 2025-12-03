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

const ConvocacoesScreen = ({navigation}) => {
  const [convocacoes, setConvocacoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtro, setFiltro] = useState('TODAS'); // TODAS, PENDENTES, ACEITAS, RECUSADAS

  useEffect(() => {
    carregarConvocacoes();
  }, []);

  const carregarConvocacoes = async () => {
    try {
      const motorista = await SecureStore.getItemAsync('motorista');
      const motoristaData = JSON.parse(motorista);

      const response = await api.get(`/api/motorista/convocacoes/${motoristaData.CDCADASTRO}`);
      setConvocacoes(response.data);
    } catch (error) {
      console.error('Erro ao carregar convocações:', error);
      Alert.alert('Erro', 'Não foi possível carregar as convocações');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    carregarConvocacoes();
  };

  const handleAceitar = (convocacao) => {
    Alert.alert(
      'Aceitar Convocação',
      `Deseja aceitar a convocação para:\n${convocacao.ROTA}?`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Aceitar',
          onPress: () => aceitarConvocacao(convocacao.IDCONVOCACAO),
        },
      ],
    );
  };

  const handleRecusar = (convocacao) => {
    Alert.alert(
      'Recusar Convocação',
      `Deseja recusar a convocação para:\n${convocacao.ROTA}?`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Recusar',
          style: 'destructive',
          onPress: () => recusarConvocacao(convocacao.IDCONVOCACAO),
        },
      ],
    );
  };

  const aceitarConvocacao = async (id) => {
    try {
      await api.post(`/api/motorista/aceitar-convocacao/${id}`);
      Alert.alert('Sucesso!', 'Convocação aceita com sucesso!');
      carregarConvocacoes();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível aceitar a convocação');
    }
  };

  const recusarConvocacao = async (id) => {
    try {
      await api.post(`/api/motorista/recusar-convocacao/${id}`);
      Alert.alert('Convocação Recusada', 'A convocação foi recusada');
      carregarConvocacoes();
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível recusar a convocação');
    }
  };

  const getStatusColor = (status) => {
    const cores = {
      PENDENTE: ['#ffd89b', '#19547b'],
      ACEITA: ['#56ab2f', '#a8e063'],
      RECUSADA: ['#eb3349', '#f45c43'],
      CANCELADA: ['#757f9a', '#d7dde8'],
    };
    return cores[status] || ['#ccc', '#999'];
  };

  const getStatusIcon = (status) => {
    const icones = {
      PENDENTE: '⏳',
      ACEITA: '✅',
      RECUSADA: '❌',
      CANCELADA: '🚫',
    };
    return icones[status] || '📋';
  };

  const convocacoesFiltradas = convocacoes.filter(c => {
    if (filtro === 'TODAS') return true;
    return c.STATUS === filtro;
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Carregando convocações...</Text>
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
        <Text style={styles.title}>📋 Minhas Convocações</Text>
      </View>

      {/* Filtros */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.filtrosContainer}>
        {['TODAS', 'PENDENTES', 'ACEITAS', 'RECUSADAS'].map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filtroButton, filtro === f && styles.filtroAtivo]}
            onPress={() => setFiltro(f)}>
            <Text style={[styles.filtroText, filtro === f && styles.filtroTextoAtivo]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Lista de Convocações */}
      <ScrollView
        style={styles.lista}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {convocacoesFiltradas.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>Nenhuma convocação encontrada</Text>
          </View>
        ) : (
          convocacoesFiltradas.map((conv) => (
            <View key={conv.IDCONVOCACAO} style={styles.convocacaoCard}>
              {/* Header do Card */}
              <View style={styles.cardHeader}>
                <LinearGradient
                  colors={getStatusColor(conv.STATUS)}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 0}}
                  style={styles.statusBadge}>
                  <Text style={styles.statusIcon}>{getStatusIcon(conv.STATUS)}</Text>
                  <Text style={styles.statusText}>{conv.STATUS}</Text>
                </LinearGradient>
                <Text style={styles.dataConvocacao}>
                  {new Date(conv.DTCONVOCACAO).toLocaleDateString('pt-BR')}
                </Text>
              </View>

              {/* Conteúdo */}
              <View style={styles.cardContent}>
                <Text style={styles.rota}>🚚 {conv.ROTA}</Text>
                
                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Tipo:</Text>
                    <Text style={styles.infoValue}>{conv.TIPO}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Classe:</Text>
                    <Text style={styles.infoValue}>{conv.CLASSE}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Frete:</Text>
                    <Text style={styles.infoValue}>R$ {conv.FRETE}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Peso:</Text>
                    <Text style={styles.infoValue}>{conv.PESO} ton</Text>
                  </View>
                </View>

                <View style={styles.datasContainer}>
                  <Text style={styles.dataLabel}>
                    📅 Carregamento: {new Date(conv.CARREGAMENTO).toLocaleString('pt-BR')}
                  </Text>
                  <Text style={styles.dataLabel}>
                    📅 Descarga: {new Date(conv.DESCARGA).toLocaleString('pt-BR')}
                  </Text>
                </View>

                {conv.DETALHES && (
                  <Text style={styles.detalhes}>{conv.DETALHES}</Text>
                )}
              </View>

              {/* Botões de Ação */}
              {conv.STATUS === 'PENDENTE' && (
                <View style={styles.acoesContainer}>
                  <TouchableOpacity
                    style={styles.btnAceitar}
                    onPress={() => handleAceitar(conv)}>
                    <Text style={styles.btnTexto}>✅ Aceitar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnRecusar}
                    onPress={() => handleRecusar(conv)}>
                    <Text style={styles.btnTexto}>❌ Recusar</Text>
                  </TouchableOpacity>
                </View>
              )}
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
  
  filtrosContainer: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: colors.white,
  },
  
  filtroButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 10,
  },
  
  filtroAtivo: {
    backgroundColor: colors.primary,
  },
  
  filtroText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  
  filtroTextoAtivo: {
    color: colors.white,
  },
  
  lista: {
    flex: 1,
    padding: 20,
  },
  
  convocacaoCard: {
    backgroundColor: colors.white,
    borderRadius: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  
  statusIcon: {
    fontSize: 16,
    marginRight: 5,
  },
  
  statusText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: 'bold',
  },
  
  dataConvocacao: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  
  cardContent: {
    padding: 15,
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
    marginBottom: 10,
  },
  
  dataLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 5,
  },
  
  detalhes: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 10,
  },
  
  acoesContainer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  
  btnAceitar: {
    flex: 1,
    backgroundColor: colors.success,
    padding: 15,
    alignItems: 'center',
  },
  
  btnRecusar: {
    flex: 1,
    backgroundColor: colors.danger,
    padding: 15,
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#fff',
  },
  
  btnTexto: {
    color: colors.white,
    fontSize: 16,
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

export default ConvocacoesScreen;

