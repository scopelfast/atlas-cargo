import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import colors from '../styles/colors';
import AuthService from '../services/auth';
import MenuButton from '../components/MenuButton';

const DashboardScreen = ({navigation}) => {
  const [motorista, setMotorista] = useState(null);
  const APP_VERSION = '1.0.0';

  useEffect(() => {
    loadMotorista();
  }, []);

  const loadMotorista = async () => {
    const data = await AuthService.getMotorista();
    setMotorista(data);
  };

  const handleLogout = async () => {
    Alert.alert(
      'Sair',
      'Deseja realmente sair do aplicativo?',
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            await AuthService.logout();
            navigation.replace('Login');
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* HEADER - Dados do Motorista */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {motorista?.NMMOTORISTA?.charAt(0) || '?'}
              </Text>
            </View>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>
              {motorista?.NMMOTORISTA || 'Carregando...'}
            </Text>
            <Text style={styles.headerCpf}>
              CPF: {motorista?.NRCPF || '-'}
            </Text>
            <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Online</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutIcon}>🚪</Text>
          </TouchableOpacity>
        </View>
        
        {/* Versão do APP */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>Versão {APP_VERSION}</Text>
        </View>
      </View>

      {/* MENU PRINCIPAL - Grade de Botões */}
      <View style={styles.menuContainer}>
        <Text style={styles.sectionTitle}>Menu Principal</Text>
        
        <View style={styles.menuGrid}>
          {/* GPS Configurações */}
          <MenuButton
            icon="📍"
            title="GPS"
            color1="#667eea"
            color2="#764ba2"
            onPress={() => navigation.navigate('GPS')}
          />

          {/* Enviar Posição */}
          <MenuButton
            icon="📤"
            title="Enviar Posição"
            color1="#f093fb"
            color2="#f5576c"
            onPress={() => navigation.navigate('EnviarPosicao')}
          />

          {/* Macros/Ocorrências */}
          <MenuButton
            icon="📝"
            title="Macros"
            color1="#4facfe"
            color2="#00f2fe"
            onPress={() => navigation.navigate('Macros')}
            badge="13"
          />

          {/* Chat */}
          <MenuButton
            icon="💬"
            title="Chat"
            color1="#43e97b"
            color2="#38f9d7"
            onPress={() => navigation.navigate('Chat')}
          />

          {/* Viagens em Andamento */}
          <MenuButton
            icon="🚛"
            title="Viagens"
            color1="#fa709a"
            color2="#fee140"
            onPress={() => navigation.navigate('Viagens')}
          />

          {/* Convocações */}
          <MenuButton
            icon="📋"
            title="Convocações"
            color1="#30cfd0"
            color2="#330867"
            onPress={() => navigation.navigate('Convocacoes')}
          />

          {/* Cargas Disponíveis */}
          <MenuButton
            icon="📦"
            title="Cargas"
            color1="#a8edea"
            color2="#fed6e3"
            onPress={() => navigation.navigate('Cargas')}
          />

          {/* Configurações (extra) */}
          <MenuButton
            icon="⚙️"
            title="Configurações"
            color1="#d299c2"
            color2="#fef9d7"
            onPress={() => Alert.alert('Em breve', 'Funcionalidade em desenvolvimento')}
          />
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          © 2025 DivulgaCarga - Todos os direitos reservados
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  
  // ==================== HEADER ====================
  header: {
    backgroundColor: colors.white,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  
  avatarContainer: {
    marginRight: 15,
  },
  
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: colors.primary,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.white,
  },
  
  headerInfo: {
    flex: 1,
  },
  
  headerName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  
  headerCpf: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: 6,
  },
  
  statusText: {
    fontSize: 12,
    color: colors.success,
    fontWeight: '600',
  },
  
  logoutButton: {
    padding: 10,
  },
  
  logoutIcon: {
    fontSize: 24,
  },
  
  versionContainer: {
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  
  versionText: {
    fontSize: 12,
    color: colors.textLight,
    fontWeight: '500',
  },
  
  // ==================== MENU ====================
  menuContainer: {
    padding: 20,
  },
  
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 20,
  },
  
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  
  // ==================== FOOTER ====================
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  
  footerText: {
    fontSize: 11,
    color: colors.textLight,
    textAlign: 'center',
  },
});

export default DashboardScreen;
