import { screen } from '@testing-library/react-native';
import { Image, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { SyncBanner } from '../src/components/SyncBanner';
import { AppearanceScreen } from '../src/screens/AppearanceScreen';
import { BusinessProfileScreen } from '../src/screens/BusinessProfileScreen';
import { CustomerFormScreen } from '../src/screens/CustomerFormScreen';
import { CustomerListScreen } from '../src/screens/CustomerListScreen';
import { EstimateListScreen } from '../src/screens/EstimateListScreen';
import { EstimateScreen } from '../src/screens/EstimateScreen';
import { ForgotPasswordScreen } from '../src/screens/ForgotPasswordScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { InvoiceListScreen } from '../src/screens/InvoiceListScreen';
import { InvoiceScreen } from '../src/screens/InvoiceScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { MoreScreen } from '../src/screens/MoreScreen';
import { PaymentListScreen } from '../src/screens/PaymentListScreen';
import { ProductFormScreen } from '../src/screens/ProductFormScreen';
import { SignUpScreen } from '../src/screens/SignUpScreen';
import { TaxRatesScreen } from '../src/screens/TaxRatesScreen';
import {
  business,
  estimateDetail,
  estimateSummary,
  invoiceDetail,
  invoiceSummary,
  nav,
  renderWithQuery,
  setupApi,
} from '../test-utils';

jest.mock('../src/store/auth');
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'c/', document: 'd/' }, File: class {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-device', () => ({ isDevice: true }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<JsonNode | string> | null;
}

/** All text under a node, in order. */
function textOf(node: JsonNode | string): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(textOf).join('');
}

function walk(
  node: JsonNode | string | null | Array<JsonNode | string>,
  visit: (n: JsonNode) => void,
) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node === 'string') return;
  visit(node);
  (node.children ?? []).forEach((c) => walk(c, visit));
}

const ROLES = new Set(['button', 'radio', 'menuitem', 'link', 'switch']);

/**
 * Structural accessibility problems on the current screen: unnamed buttons, unlabelled text fields,
 * switches and images, and tappable elements without a role.
 */
function audit(): string[] {
  const problems: string[] = [];
  walk(screen.toJSON() as never, (n) => {
    const p = n.props;
    const label = String(p.accessibilityLabel ?? p['aria-label'] ?? '').trim();
    const role = p.accessibilityRole ?? p.role;
    if (typeof role === 'string' && ROLES.has(role) && !label && !textOf(n).trim())
      problems.push(`${role} without a name`);
    if (n.type === 'TextInput' && !label) problems.push('TextInput without a label');
    if (n.type === 'RCTSwitch' && !label) problems.push('Switch without a label');
    if (n.type === 'Image' && p.accessibilityLabel === undefined && p.accessible !== false)
      problems.push('Image without a label');
    if (typeof p.onClick === 'function' && !role)
      problems.push(`tappable ${n.type} without a role`);
  });
  return problems;
}

const items = <T,>(x: T[]) => ({ items: x, total: x.length });
const customer = {
  id: 'c1',
  firstName: null,
  lastName: null,
  companyName: 'Acme Ltd',
  email: 'a@acme.co',
  phone: null,
};

function baseApi(extra: Record<string, jest.Mock> = {}) {
  return setupApi({
    getBusiness: jest.fn(async () => business),
    listTaxRates: jest.fn(async () =>
      items([{ id: 'r1', name: 'GST', rateBps: 500, isDefault: true }]),
    ),
    listCustomers: jest.fn(async () => items([customer])),
    listProducts: jest.fn(async () => items([])),
    listInvoices: jest.fn(async () =>
      items([invoiceSummary(), invoiceSummary({ id: 'i2', displayStatus: 'overdue' })]),
    ),
    listEstimates: jest.fn(async () => items([estimateSummary()])),
    listPayments: jest.fn(async () => items([])),
    listNotifications: jest.fn(async () => ({ items: [], total: 0, unread: 0 })),
    getInvoice: jest.fn(async () => invoiceDetail({ status: 'draft', displayStatus: 'draft' })),
    getInvoiceActivity: jest.fn(async () => items([])),
    getEstimate: jest.fn(async () => estimateDetail()),
    getBusinessAssetUri: jest.fn(async () => null),
    getDashboard: jest.fn(async () => ({
      businessName: 'Acme',
      defaultCurrency: 'USD',
      period: 'all',
      currencies: [
        {
          currency: 'USD',
          outstandingMinor: 1000,
          outstandingCount: 1,
          overdueMinor: 500,
          overdueCount: 1,
          draftMinor: 0,
          draftCount: 0,
          paidMinor: 200,
          paidCount: 1,
        },
      ],
      recentInvoices: [invoiceSummary()],
      recentPayments: [],
    })),
    ...extra,
  });
}

const route = (params?: object) => ({ params }) as never;

const SCREENS: Array<[string, () => React.ReactElement, string]> = [
  ['Home dashboard', () => <HomeScreen />, 'Acme'],
  [
    'Invoice list',
    () => <InvoiceListScreen navigation={nav() as never} route={route()} />,
    'Acme Ltd',
  ],
  [
    'Estimate list',
    () => <EstimateListScreen navigation={nav() as never} route={route()} />,
    'Acme Ltd',
  ],
  [
    'New invoice',
    () => <InvoiceScreen navigation={nav() as never} route={route()} />,
    'New invoice',
  ],
  [
    'Existing invoice',
    () => <InvoiceScreen navigation={nav() as never} route={route({ id: 'i1' })} />,
    'INV-0001',
  ],
  [
    'New estimate',
    () => <EstimateScreen navigation={nav() as never} route={route()} />,
    'New estimate',
  ],
  [
    'Existing estimate',
    () => <EstimateScreen navigation={nav() as never} route={route({ id: 'e1' })} />,
    'EST-0001',
  ],
  [
    'Customer list',
    () => <CustomerListScreen navigation={nav() as never} route={route()} />,
    'Acme Ltd',
  ],
  [
    'Customer form',
    () => <CustomerFormScreen navigation={nav() as never} route={route()} />,
    'Add customer',
  ],
  ['Product form', () => <ProductFormScreen navigation={nav() as never} route={route()} />, 'Add'],
  [
    'Payment list',
    () => <PaymentListScreen navigation={nav() as never} route={route()} />,
    'No payments yet',
  ],
  [
    'Business profile',
    () => <BusinessProfileScreen navigation={nav() as never} route={route()} />,
    'Save',
  ],
  ['Tax rates', () => <TaxRatesScreen />, 'GST'],
  ['Appearance', () => <AppearanceScreen />, 'Layout'],
  ['More', () => <MoreScreen navigation={nav() as never} route={route()} />, 'Estimates'],
  ['Login', () => <LoginScreen navigation={nav() as never} route={route()} />, 'Sign in'],
  ['Sign up', () => <SignUpScreen navigation={nav() as never} route={route()} />, 'Sign up'],
  [
    'Forgot password',
    () => <ForgotPasswordScreen navigation={nav() as never} route={route()} />,
    'Email',
  ],
];

describe('the audit itself', () => {
  it('catches the problems it claims to catch', async () => {
    await renderWithQuery(
      <View>
        <TextInput placeholder="unlabelled" />
        <Pressable onPress={() => undefined} accessibilityRole="button" />
        <Pressable onPress={() => undefined}>
          <Text>no role</Text>
        </Pressable>
        <Image source={{ uri: 'x' }} />
        <Switch value={false} />
      </View>,
    );
    expect(audit().sort()).toEqual(
      [
        'Image without a label',
        'Switch without a label',
        'TextInput without a label',
        'button without a name',
        'switch without a name',
        'tappable View without a role',
      ].sort(),
    );
  });
});

describe('accessibility audit (structure)', () => {
  it.each(SCREENS)('%s', async (_name, ui, ready) => {
    baseApi();
    await renderWithQuery(ui());
    await screen.findAllByText(new RegExp(ready, 'i'));
    expect(audit()).toEqual([]);
  });

  it('the sync banner', async () => {
    baseApi();
    await renderWithQuery(<SyncBanner onOpen={jest.fn()} />);
    expect(audit()).toEqual([]);
  });
});
