import type { CurrencyCode } from '@invoiceflow/shared';
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ChipRow } from '../components/ChipRow';
import { ErrorState, LoadingState } from '../components/ListStates';
import { QuickCreateFab } from '../components/QuickCreateFab';
import { StatCard } from '../components/StatCard';
import { useDashboard, useNotifications } from '../hooks/queries';
import type { CurrencyTotals, DashboardPeriod, Payment } from '../models';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';
import { methodLabel } from '../utils/payment-labels';
import { InvoiceRow } from './InvoiceListScreen';

type Nav = { navigate: (tab: string, p?: object) => void };

const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_year', label: 'This year' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function HomeScreen() {
  const c = useTheme();
  const navigation = useNavigation<Nav>();
  const [period, setPeriod] = useState<DashboardPeriod>('all');
  const q = useDashboard(period);
  const unread = useNotifications().data?.unread ?? 0;

  const openInvoices = (status?: string) =>
    navigation.navigate('InvoicesTab', { screen: 'InvoiceList', params: { status } });
  const newInvoice = () => navigation.navigate('InvoicesTab', { screen: 'Invoice' });
  const newCustomer = () => navigation.navigate('CustomersTab', { screen: 'CustomerForm' });

  const d = q.data;
  const primary = d?.currencies[0];
  const others = d?.currencies.slice(1) ?? [];
  const isEmpty = !!d && d.recentInvoices.length === 0 && !hasActivity(primary) && !others.length;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : d && primary ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
          }
        >
          <View style={styles.header}>
            <Text
              style={{ color: c.text, fontSize: 24, fontWeight: '700', flex: 1 }}
              numberOfLines={1}
            >
              {d.businessName}
            </Text>
            <Button
              title={unread > 0 ? `Notifications (${unread})` : 'Notifications'}
              variant="secondary"
              onPress={() => navigation.navigate('MoreTab', { screen: 'Notifications' })}
            />
          </View>

          {isEmpty ? (
            <View style={[styles.welcome, { backgroundColor: c.surface }]}>
              <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>
                Welcome to InvoiceFlow
              </Text>
              <Text style={{ color: c.muted }}>
                Add a customer, then create your first invoice. Your totals will show up here.
              </Text>
              <Button title="Create your first invoice" onPress={newInvoice} />
            </View>
          ) : null}

          <Totals totals={primary} onOpen={openInvoices} />

          <ChipRow label="Paid period" options={PERIODS} value={period} onChange={setPeriod} />
          <Text style={{ color: c.muted, fontSize: 12, marginTop: -spacing.sm }}>
            The period applies to Paid only; other totals are current.
          </Text>

          {others.map((o) => (
            <View key={o.currency} style={{ gap: spacing.sm }}>
              <Text style={[styles.section, { color: c.text }]}>{o.currency} invoices</Text>
              <Totals totals={o} onOpen={openInvoices} />
            </View>
          ))}

          {d.recentInvoices.length > 0 ? (
            <View>
              <View style={styles.sectionRow}>
                <Text style={[styles.section, { color: c.text }]}>Recent invoices</Text>
                <Pressable onPress={() => openInvoices()} accessibilityRole="button">
                  <Text style={{ color: c.primary, fontWeight: '600' }}>See all</Text>
                </Pressable>
              </View>
              {d.recentInvoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  onPress={() =>
                    navigation.navigate('InvoicesTab', {
                      screen: 'Invoice',
                      params: { id: inv.id },
                    })
                  }
                />
              ))}
            </View>
          ) : null}

          {d.recentPayments.length > 0 ? (
            <View>
              <View style={styles.sectionRow}>
                <Text style={[styles.section, { color: c.text }]}>Recent payments</Text>
                <Pressable
                  onPress={() => navigation.navigate('PaymentsTab', { screen: 'PaymentList' })}
                  accessibilityRole="button"
                >
                  <Text style={{ color: c.primary, fontWeight: '600' }}>See all</Text>
                </Pressable>
              </View>
              {d.recentPayments.map((p) => (
                <PaymentLine
                  key={p.id}
                  p={p}
                  onPress={() =>
                    navigation.navigate('PaymentsTab', {
                      screen: 'PaymentDetail',
                      params: { id: p.id },
                    })
                  }
                />
              ))}
            </View>
          ) : null}
          <View style={{ height: 88 }} />
        </ScrollView>
      ) : null}
      <QuickCreateFab
        actions={[
          { label: 'New invoice', icon: 'document-text-outline', onPress: newInvoice },
          { label: 'New customer', icon: 'person-add-outline', onPress: newCustomer },
        ]}
      />
    </SafeAreaView>
  );
}

const hasActivity = (t?: CurrencyTotals) =>
  !!t && (t.outstandingCount > 0 || t.draftCount > 0 || t.paidCount > 0 || t.overdueCount > 0);

function Totals({
  totals: t,
  onOpen,
}: {
  totals: CurrencyTotals;
  onOpen: (status?: string) => void;
}) {
  const c = useTheme();
  const cur = t.currency as CurrencyCode;
  return (
    <View style={styles.grid}>
      <StatCard
        label="Outstanding"
        amountMinor={t.outstandingMinor}
        currency={cur}
        detail={plural(t.outstandingCount, 'invoice')}
        onPress={() => onOpen('outstanding')}
      />
      <StatCard
        label="Overdue"
        amountMinor={t.overdueMinor}
        currency={cur}
        detail={plural(t.overdueCount, 'invoice')}
        tone={t.overdueMinor > 0 ? c.danger : undefined}
        onPress={() => onOpen('overdue')}
      />
      <StatCard
        label="Paid"
        amountMinor={t.paidMinor}
        currency={cur}
        detail={plural(t.paidCount, 'invoice')}
        onPress={() => onOpen('paid')}
      />
      <StatCard
        label="Draft"
        amountMinor={t.draftMinor}
        currency={cur}
        detail={plural(t.draftCount, 'draft')}
        onPress={() => onOpen('draft')}
      />
    </View>
  );
}

function PaymentLine({ p, onPress }: { p: Payment; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Payment of ${money(p.amountMinor, p.currency)} from ${p.customerName}`}
      style={[styles.payment, { borderBottomColor: c.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
          {p.customerName}
        </Text>
        <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
          {p.invoiceNumber} · {methodLabel(p.method)} ·{' '}
          {formatDate((p.paidAt ?? p.createdAt).slice(0, 10))}
        </Text>
      </View>
      <Text style={{ color: c.text, fontWeight: '700' }}>{money(p.amountMinor, p.currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  welcome: { padding: spacing.md, borderRadius: 12, gap: spacing.sm },
  section: { fontSize: 18, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payment: {
    minHeight: 60,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
