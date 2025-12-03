import 'react-native-gesture-handler';
import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';

// Importar telas
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import GPSScreen from './src/screens/GPSScreen';
import EnviarPosicaoScreen from './src/screens/EnviarPosicaoScreen';
import MacrosScreen from './src/screens/MacrosScreen';
import ChatScreen from './src/screens/ChatScreen';
import ViagensScreen from './src/screens/ViagensScreen';
import ConvocacoesScreen from './src/screens/ConvocacoesScreen';
import CargasScreen from './src/screens/CargasScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#f5f7fa' },
        }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="GPS" component={GPSScreen} />
        <Stack.Screen name="EnviarPosicao" component={EnviarPosicaoScreen} />
        <Stack.Screen name="Macros" component={MacrosScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Viagens" component={ViagensScreen} />
        <Stack.Screen name="Convocacoes" component={ConvocacoesScreen} />
        <Stack.Screen name="Cargas" component={CargasScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

