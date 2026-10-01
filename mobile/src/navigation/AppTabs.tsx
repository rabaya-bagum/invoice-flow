import { Ionicons } from '@expo/vector-icons';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BusinessProfileScreen } from '../screens/BusinessProfileScreen';
import { EstimateListScreen } from '../screens/EstimateListScreen';
import { EstimateScreen } from '../screens/EstimateScreen';
import { InvoiceListScreen } from '../screens/InvoiceListScreen';
import { SendEstimateScreen } from '../screens/SendEstimateScreen';
import { InvoiceScreen } from '../screens/InvoiceScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { OnlinePaymentsScreen } from '../screens/OnlinePaymentsScreen';
import { PaymentDetailScreen } from '../screens/PaymentDetailScreen';
import { PaymentListScreen } from '../screens/PaymentListScreen';
import { SendInvoiceScreen } from '../screens/SendInvoiceScreen';
import { TaxRatesScreen } from '../screens/TaxRatesScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';
import { CustomerFormScreen } from '../screens/CustomerFormScreen';
import { CustomerListScreen } from '../screens/CustomerListScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { ProductFormScreen } from '../screens/ProductFormScreen';
import { ProductListScreen } from '../screens/ProductListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type {
  CustomersStackParams,
  InvoicesStackParams,
  MoreStackParams,
  PaymentsStackParams,
  TabParams,
} from './types';

const Tabs = createBottomTabNavigator<TabParams>();
const Customers = createNativeStackNavigator<CustomersStackParams>();
const Invoices = createNativeStackNavigator<InvoicesStackParams>();
const Payments = createNativeStackNavigator<PaymentsStackParams>();
const More = createNativeStackNavigator<MoreStackParams>();

function PaymentsStack() {
  return (
    <Payments.Navigator>
      <Payments.Screen
        name="PaymentList"
        component={PaymentListScreen}
        options={{ title: 'Payments' }}
      />
      <Payments.Screen
        name="PaymentDetail"
        component={PaymentDetailScreen}
        options={{ title: 'Payment' }}
      />
    </Payments.Navigator>
  );
}

function InvoicesStack() {
  return (
    <Invoices.Navigator>
      <Invoices.Screen
        name="InvoiceList"
        component={InvoiceListScreen}
        options={{ title: 'Invoices' }}
      />
      <Invoices.Screen
        name="Invoice"
        component={InvoiceScreen}
        options={({ route }) => ({ title: route.params?.id ? 'Invoice' : 'New invoice' })}
      />
      <Invoices.Screen
        name="SendInvoice"
        component={SendInvoiceScreen}
        options={{ title: 'Send invoice' }}
      />
      <Invoices.Screen
        name="EstimateList"
        component={EstimateListScreen}
        options={{ title: 'Estimates' }}
      />
      <Invoices.Screen
        name="Estimate"
        component={EstimateScreen}
        options={({ route }) => ({ title: route.params?.id ? 'Estimate' : 'New estimate' })}
      />
      <Invoices.Screen
        name="SendEstimate"
        component={SendEstimateScreen}
        options={{ title: 'Send estimate' }}
      />
    </Invoices.Navigator>
  );
}

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
      <More.Screen name="TaxRates" component={TaxRatesScreen} options={{ title: 'Tax rates' }} />
      <More.Screen
        name="OnlinePayments"
        component={OnlinePaymentsScreen}
        options={{ title: 'Online payments' }}
      />
      <More.Screen name="Notifications" component={NotificationsScreen} />
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
  usePushNotifications();
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: icon('home-outline') }}
      />
      <Tabs.Screen
        name="InvoicesTab"
        component={InvoicesStack}
        options={{ title: 'Invoices', tabBarIcon: icon('document-text-outline') }}
      />
      <Tabs.Screen
        name="CustomersTab"
        component={CustomersStack}
        options={{ title: 'Customers', tabBarIcon: icon('people-outline') }}
      />
      <Tabs.Screen
        name="PaymentsTab"
        component={PaymentsStack}
        options={{ title: 'Payments', tabBarIcon: icon('card-outline') }}
      />
      <Tabs.Screen
        name="MoreTab"
        component={MoreStack}
        options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }}
      />
    </Tabs.Navigator>
  );
}
