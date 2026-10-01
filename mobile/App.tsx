import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { getServices, type Services } from './src/services';
import { AuthProvider } from './src/store/auth';

function loadServices(): Services | null {
  try {
    return getServices();
  } catch (err) {
    console.error(err);
    return null;
  }
}

const services = loadServices();

export default function App() {
  if (!services) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>
          InvoiceFlow is not configured. Copy mobile/.env.example to mobile/.env and set the
          EXPO_PUBLIC_* values.
        </Text>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <AuthProvider services={services}>
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
