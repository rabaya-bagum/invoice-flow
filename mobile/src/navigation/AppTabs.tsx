import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BusinessProfileScreen } from '../screens/BusinessProfileScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';
import { CustomerFormScreen } from '../screens/CustomerFormScreen';
import { CustomerListScreen } from '../screens/CustomerListScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { ProductFormScreen } from '../screens/ProductFormScreen';
import { ProductListScreen } from '../screens/ProductListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { CustomersStackParams, MoreStackParams, TabParams } from './types';

const Tabs = createBottomTabNavigator<TabParams>();
const Customers = createNativeStackNavigator<CustomersStackParams>();
const More = createNativeStackNavigator<MoreStackParams>();

function CustomersStack() {
  return (
    <Customers.Navigator>
      <Customers.Screen
        name="CustomerList"
        component={CustomerListScreen}
        options={{ title: 'Customers' }}
      />
      <Customers.Screen
        name="CustomerDetail"
        component={CustomerDetailScreen}
        options={{ title: 'Customer' }}
      />
      <Customers.Screen
        name="CustomerForm"
        component={CustomerFormScreen}
        options={({ route }) => ({ title: route.params?.id ? 'Edit customer' : 'New customer' })}
      />
    </Customers.Navigator>
  );
}

function MoreStack() {
  return (
    <More.Navigator>
      <More.Screen name="More" component={MoreScreen} />
      <More.Screen
        name="BusinessProfile"
        component={BusinessProfileScreen}
        options={{ title: 'Business profile' }}
      />
      <More.Screen
        name="ProductList"
        component={ProductListScreen}
        options={{ title: 'Products & services' }}
      />
      <More.Screen
        name="ProductForm"
        component={ProductFormScreen}
        options={({ route }) => ({ title: route.params?.id ? 'Edit item' : 'New item' })}
      />
      <More.Screen name="Settings" component={SettingsScreen} />
    </More.Navigator>
  );
}

const icon =
  (name: React.ComponentProps<typeof Ionicons>['name']) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

export function AppTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: icon('home-outline') }}
      />
      <Tabs.Screen
        name="InvoicesTab"
        options={{ title: 'Invoices', tabBarIcon: icon('document-text-outline') }}
      >
        {() => (
          <PlaceholderScreen title="Invoices" hint="Invoice creation arrives in the next phase." />
        )}
      </Tabs.Screen>
      <Tabs.Screen
        name="CustomersTab"
        component={CustomersStack}
        options={{ title: 'Customers', tabBarIcon: icon('people-outline') }}
      />
      <Tabs.Screen
        name="PaymentsTab"
        options={{ title: 'Payments', tabBarIcon: icon('card-outline') }}
      >
        {() => (
          <PlaceholderScreen
            title="Payments"
            hint="Payment history appears once payments are enabled."
          />
        )}
      </Tabs.Screen>
      <Tabs.Screen
        name="MoreTab"
        component={MoreStack}
        options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }}
      />
    </Tabs.Navigator>
  );
}
