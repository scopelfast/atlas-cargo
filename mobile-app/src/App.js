import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import GPSScreen from './screens/GPSScreen';
import EnviarPosicaoScreen from './screens/EnviarPosicaoScreen';
import MacrosScreen from './screens/MacrosScreen';
import ChatScreen from './screens/ChatScreen';
import ViagensScreen from './screens/ViagensScreen';
import ConvocacoesScreen from './screens/ConvocacoesScreen';
import CargasScreen from './screens/CargasScreen';

const Stack = createStackNavigator();

const App = () => {
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
};

export default App;

