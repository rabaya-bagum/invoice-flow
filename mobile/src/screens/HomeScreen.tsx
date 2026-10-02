import { Ionicons } from '@expo/vector-icons';
import type { CurrencyCode } from '@invoiceflow/shared';
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { QuickCreateFab } from '../components/QuickCreateFab';
import { Segmented } from '../components/Segmented';
import { SyncBanner } from '../components/SyncBanner';
import { StatCard } from '../components/StatCard';
import { useDashboard, useNotifications } from '../hooks/queries';
import type { CurrencyTotals, DashboardPeriod, Payment } from '../models';
import { radius, spacing, type as t } from '../theme';
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
  const newEstimate = () => navigation.navigate('InvoicesTab', { screen: 'Estimate' });
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
            <Text style={[t.title, { color: c.text, flex: 1 }]} numberOfLines={1}>
              {d.businessName}
            </Text>
            <Pressable
              onPress={() => navigation.navigate('MoreTab', { screen: 'Notifications' })}
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              style={({ pressed }) => [
                styles.bell,
                { backgroundColor: pressed ? c.surface : 'transparent' },
              ]}
            >
              <Ionicons name="notifications-outline" size={24} color={c.text} />
              {unread > 0 ? (
                <View style={[styles.unread, { backgroundColor: c.danger }]}>
                  <Text style={[styles.unreadText, { color: c.background }]}>
                    {unread > 99 ? '99+' : unread}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* The banner and lists carry their own side padding: let them span the screen edge. */}
          <View style={styles.bleed}>
            <SyncBanner
              onOpen={() => navigation.navigate('InvoicesTab', { screen: 'SyncStatus' })}
            />
          </View>

          {isEmpty ? (
            <View style={[styles.welcome, { backgroundColor: c.surface }]}>
              <Text style={[t.heading, { color: c.text }]}>Welcome to InvoiceFlow</Text>
              <Text style={{ color: c.muted }}>
                Add a customer, then create your first invoice. Your totals will show up here.
              </Text>
              <Button title="Create your first invoice" onPress={newInvoice} />
            </View>
          ) : null}

          {isEmpty ? null : (
            <Totals totals={primary} onOpen={openInvoices} period={period} onPeriod={setPeriod} />
          )}

          {others.map((o) => (
            <View key={o.currency} style={{ gap: spacing.sm }}>
              <Text style={[t.heading, { color: c.text }]}>{o.currency} invoices</Text>
              <Totals totals={o} onOpen={openInvoices} period={period} />
            </View>
          ))}

          {d.recentInvoices.length > 0 ? (
            <View>
              <View style={styles.sectionRow}>
                <Text style={[t.heading, { color: c.text }]}>Recent invoices</Text>
                <SeeAll label="See all invoices" onPress={() => openInvoices()} />
              </View>
              <View style={styles.bleed}>
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
            </View>
          ) : null}

          {d.recentPayments.length > 0 ? (
            <View>
              <View style={styles.sectionRow}>
                <Text style={[t.heading, { color: c.text }]}>Recent payments</Text>
                <SeeAll
                  label="See all payments"
                  onPress={() => navigation.navigate('PaymentsTab', { screen: 'PaymentList' })}
                />
              </View>
              <View style={styles.bleed}>
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
            </View>
          ) : null}
          <View style={{ height: 88 }} />
        </ScrollView>
      ) : null}
      <QuickCreateFab
        actions={[
          { label: 'New invoice', icon: 'document-text-outline', onPress: newInvoice },
          { label: 'New estimate', icon: 'clipboard-outline', onPress: newEstimate },
          { label: 'New customer', icon: 'person-add-outline', onPress: newCustomer },
        ]}
      />
    </SafeAreaView>
  );
}

const hasActivity = (t?: CurrencyTotals) =>
  !!t && (t.outstandingCount > 0 || t.draftCount > 0 || t.paidCount > 0 || t.overdueCount > 0);

function Totals({
  totals: tot,
  onOpen,
  period,
  onPeriod,
}: {
  totals: CurrencyTotals;
  onOpen: (status?: string) => void;
  period: DashboardPeriod;
  /** Shows the period picker on the Paid card (the primary currency only). */
  onPeriod?: (p: DashboardPeriod) => void;
}) {
  const c = useTheme();
  const cur = tot.currency as CurrencyCode;
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? '';
  const overdue = money(tot.overdueMinor, cur);
  return (
    <View style={styles.grid}>
      <StatCard
        size="hero"
        label="Outstanding"
        amountMinor={tot.outstandingMinor}
        currency={cur}
        detail={plural(tot.outstandingCount, 'invoice')}
        onPress={() => onOpen('outstanding')}
        footer={
          tot.overdueCount > 0 ? (
            <Pressable
              onPress={() => onOpen('overdue')}
              accessibilityRole="button"
              accessibilityLabel={`Overdue: ${overdue}, ${plural(tot.overdueCount, 'invoice')}`}
              style={({ pressed }) => [
                styles.footerRow,
                { borderTopColor: c.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="alert-circle" size={18} color={c.danger} />
              <Text style={[t.label, { color: c.danger, flex: 1 }]} numberOfLines={1}>
                {overdue} overdue · {plural(tot.overdueCount, 'invoice')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.muted} />
            </Pressable>
          ) : (
            <View style={[styles.footerRow, { borderTopColor: c.border }]}>
              <Ionicons name="checkmark-circle" size={18} color={c.muted} />
              <Text style={[t.label, { color: c.muted }]}>Nothing overdue</Text>
            </View>
          )
        }
      />
      <StatCard
        size="wide"
        label={onPeriod || period === 'all' ? 'Paid' : `Paid · ${periodLabel}`}
        amountMinor={tot.paidMinor}
        currency={cur}
        detail={plural(tot.paidCount, 'invoice')}
        onPress={() => onOpen('paid')}
        accessory={
          onPeriod ? (
            <Segmented label="Paid period" options={PERIODS} value={period} onChange={onPeriod} />
          ) : undefined
        }
      />
      <Pressable
        onPress={() => onOpen('draft')}
        accessibilityRole="button"
        accessibilityLabel={`Draft: ${money(tot.draftMinor, cur)}, ${plural(tot.draftCount, 'draft')}`}
        style={({ pressed }) => [
          styles.draft,
          { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="document-text-outline" size={20} color={c.muted} />
        <Text style={[t.bodyStrong, { color: c.text, flex: 1 }]}>
          {plural(tot.draftCount, 'draft')}
        </Text>
        <Text style={[t.bodyStrong, { color: c.text }]}>{money(tot.draftMinor, cur)}</Text>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </Pressable>
    </View>
  );
}

function SeeAll({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={styles.seeAll}
    >
      <Text style={[t.label, { color: c.primary, fontWeight: '600' }]}>See all</Text>
    </Pressable>
  );
}

function PaymentLine({ p, onPress }: { p: Payment; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Payment of ${money(p.amountMinor, p.currency)} from ${p.customerName}`}
      style={({ pressed }) => [
        styles.payment,
        { borderBottomColor: c.border, backgroundColor: pressed ? c.surface : 'transparent' },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.bodyStrong, { color: c.text }]} numberOfLines={1}>
          {p.customerName}
        </Text>
        <Text style={[t.caption, { color: c.muted }]} numberOfLines={1}>
          {p.invoiceNumber} · {methodLabel(p.method)} ·{' '}
          {formatDate((p.paidAt ?? p.createdAt).slice(0, 10))}
        </Text>
      </View>
      <Text style={[t.bodyStrong, { color: c.text, fontWeight: '700' }]}>
        {money(p.amountMinor, p.currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm, // optical: the glyph, not its touch area, lines up with the edge
  },
  unread: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { fontSize: 11, fontWeight: '700' },
  bleed: { marginHorizontal: -spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 4 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  draft: {
    flexBasis: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
  },
  welcome: { padding: spacing.md, borderRadius: radius.card, gap: spacing.sm },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  payment: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
