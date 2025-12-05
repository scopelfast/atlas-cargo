import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import colors from '../styles/colors';
import commonStyles from '../styles/commonStyles';
import AuthService from '../services/auth';

const LoginScreen = ({navigation}) => {
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);

  // Formatar CPF (000.000.000-00)
  const formatCPF = text => {
    const cleaned = text.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,3})(\d{0,2})$/);
    
    if (match) {
      let formatted = match[1];
      if (match[2]) formatted += '.' + match[2];
      if (match[3]) formatted += '.' + match[3];
      if (match[4]) formatted += '-' + match[4];
      return formatted;
    }
    
    return text;
  };

  const handleCpfChange = text => {
    const formatted = formatCPF(text);
    setCpf(formatted);
  };

  const handleLogin = async () => {
    // Validações
    if (!cpf || !senha) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos');
      return;
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      Alert.alert('Erro', 'CPF inválido');
      return;
    }

    setLoading(true);

    try {
      const result = await AuthService.login(cpf, senha);

      if (result.success) {
        // Login bem-sucedido - navegar para Dashboard
        navigation.replace('Dashboard');
      } else {
        Alert.alert('Erro', result.message || 'CPF ou senha inválidos');
      }
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível conectar ao servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        
        {/* Logo e Título */}
        <View style={styles.logoSection}>
          <View style={styles.logoPlaceholder}>
            <Text style={styles.logoText}>🚚</Text>
          </View>
          <Text style={styles.title}>DivulgaCarga</Text>
          <Text style={styles.subtitle}>Motorista</Text>
        </View>

        {/* Formulário */}
        <View style={styles.formSection}>
          <Text style={styles.welcomeTitle}>Bem-vindo!</Text>
          <Text style={styles.description}>
            Entre com seus dados para acessar o sistema
          </Text>

          {/* Input CPF */}
          <View style={styles.inputGroup}>
            <Text style={commonStyles.label}>CPF</Text>
            <TextInput
              style={commonStyles.input}
              placeholder="000.000.000-00"
              value={cpf}
              onChangeText={handleCpfChange}
              keyboardType="numeric"
              maxLength={14}
              editable={!loading}
            />
          </View>

          {/* Input Senha */}
          <View style={styles.inputGroup}>
            <Text style={commonStyles.label}>Senha</Text>
            <TextInput
              style={commonStyles.input}
              placeholder="Digite sua senha"
              value={senha}
              onChangeText={setSenha}
              secureTextEntry
              editable={!loading}
            />
          </View>

          {/* Botão Entrar */}
          <TouchableOpacity
            style={[
              commonStyles.button,
              loading && styles.buttonDisabled,
            ]}
            onPress={handleLogin}
            disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={commonStyles.buttonText}>Entrar</Text>
            )}
          </TouchableOpacity>

          {/* Links */}
          <View style={styles.linksContainer}>
            <TouchableOpacity>
              <Text style={styles.link}>Cadastrar-se</Text>
            </TouchableOpacity>
            <TouchableOpacity>
              <Text style={styles.link}>Esqueci minha senha</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            © 2025 DivulgaCarga - Sistema para Motoristas
          </Text>
          <Text style={styles.version}>Versão 1.0.0</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },
  
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  
  logoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  
  logoText: {
    fontSize: 60,
  },
  
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 5,
  },
  
  subtitle: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  
  formSection: {
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 5,
  },
  
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 25,
  },
  
  inputGroup: {
    marginBottom: 15,
  },
  
  buttonDisabled: {
    opacity: 0.6,
  },
  
  linksContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  
  link: {
    color: colors.primary,
    fontSize: 14,
  },
  
  footer: {
    marginTop: 30,
    alignItems: 'center',
  },
  
  footerText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 5,
  },
  
  version: {
    fontSize: 11,
    color: colors.textLight,
  },
});

export default LoginScreen;

