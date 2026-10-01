import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { Row } from '../components/Row';
import type { MoreStackParams } from '../navigation/types';
import { useTheme } from '../theme/useTheme';

export function MoreScreen({ navigation }: NativeStackScreenProps<MoreStackParams, 'More'>) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Row
        title="Business profile"
        subtitle="Name, address, tax and defaults"
        onPress={() => navigation.navigate('BusinessProfile')}
      />
      <Row
        title="Products & services"
        subtitle="Reusable items with prices"
        onPress={() => navigation.navigate('ProductList')}
      />
      <Row
        title="Tax rates"
        subtitle="Named rates for invoice items"
        onPress={() => navigation.navigate('TaxRates')}
      />
      <Row
        title="Online payments"
        subtitle="Card, Apple Pay and Google Pay"
        onPress={() => navigation.navigate('OnlinePayments')}
      />
      <Row
        title="Settings"
        subtitle="Security and account"
        onPress={() => navigation.navigate('Settings')}
      />
    </View>
  );
}
