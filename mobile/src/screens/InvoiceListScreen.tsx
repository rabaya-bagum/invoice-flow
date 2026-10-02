import { dateRangeFor, todayInTimezone, type DatePreset } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ChipRow } from '../components/ChipRow';
import { SyncBanner } from '../components/SyncBanner';
import { useOffline } from '../offline/context';
import { DateField } from '../components/DateField';
import { Fab } from '../components/Fab';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { SearchField } from '../components/SearchField';
import { StatusBadge } from '../components/StatusBadge';
import { useBusiness, useDashboard, useInvoices } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import type { InvoiceSummary } from '../models';
import { kindOf, type DraftOp } from '../offline/types';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing, type as t } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';

type StatusFilter =
  | 'all'
  | 'outstanding'
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';
type DateFilter = 'any' | DatePreset | 'custom';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'partially_paid', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];
const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

export function InvoiceListScreen({
  navigation,
  route,
}: NativeStackScreenProps<InvoicesStackParams, 'InvoiceList'>) {
  const c = useTheme();
  const business = useBusiness();
  const today = todayInTimezone(business.data?.timezone ?? 'UTC');
  const [search, setSearch] = useState('');
  const preset = route?.params?.status;
  const [status, setStatus] = useState<StatusFilter>(preset ?? 'all');
  // A dashboard card can re-open this list with a different preset while it stays mounted.
  useEffect(() => {
    if (preset) setStatus(preset);
  }, [preset]);
  const [dateFilter, setDateFilter] = useState<DateFilter>('any');
  const [datesOpen, setDatesOpen] = useState(false);
  const [custom, setCustom] = useState({ from: today, to: today });

  const range = useMemo(
    () =>
      dateFilter === 'any'
        ? {}
        : dateFilter === 'custom'
          ? custom
          : dateRangeFor(dateFilter, today),
    [dateFilter, custom, today],
  );
  const q = useInvoices({
    search: useDebounced(search.trim()),
    status: status === 'all' ? undefined : status,
    ...range,
  });
  const off = useOffline();
  const server = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // Drafts created offline are not on the server yet: show them first, while they match the filters.
  const local = useMemo(() => {
    if (!off.available || (status !== 'all' && status !== 'draft') || dateFilter !== 'any')
      return [];
    const needle = search.trim().toLowerCase();
    return off.ops
      .filter((o) => kindOf(o) === 'invoice' && o.isNew && o.payload !== null)
      .filter(
        (o) =>
          !needle ||
          o.summary.customerName.toLowerCase().includes(needle) ||
          (o.summary.number ?? '').toLowerCase().includes(needle),
      )
      .map((o) => localSummary(o));
  }, [off.available, off.ops, status, dateFilter, search]);
  const items = useMemo(() => [...local, ...server], [local, server]);
  const filtered = search || status !== 'all' || dateFilter !== 'any';
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setDateFilter('any');
    setDatesOpen(false);
  };
  const total = q.data ? (q.data.pages[0]?.total ?? 0) + local.length : null;
  // The balance owed is business-wide, so it is only shown next to the unfiltered list.
  const owed = useDashboard('all').data?.currencies[0];
  const summary =
    total === null
      ? null
      : `${total} invoice${total === 1 ? '' : 's'}` +
        (!filtered && owed && owed.outstandingMinor > 0
          ? ` · ${money(owed.outstandingMinor, owed.currency)} outstanding`
          : '');
  const dateLabel = DATE_OPTIONS.find((o) => o.value === dateFilter)?.label ?? 'Any date';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={styles.search}>
        <SearchField
          label="Search invoices"
          value={search}
          onChangeText={setSearch}
          placeholder="Search customer, number or amount"
          autoCapitalize="none"
        />
      </View>
      <SyncBanner onOpen={() => navigation.navigate('SyncStatus')} />
      <ChipRow label="Status filter" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => setDatesOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={`Date filter: ${dateLabel}`}
          accessibilityState={{ expanded: datesOpen }}
          hitSlop={8}
          style={styles.dateButton}
        >
          <Ionicons
            name="calendar-outline"
            size={16}
            color={dateFilter === 'any' ? c.muted : c.primary}
          />
          <Text style={[t.label, { color: dateFilter === 'any' ? c.text : c.primary }]}>
            {dateLabel}
          </Text>
          <Ionicons name={datesOpen ? 'chevron-up' : 'chevron-down'} size={14} color={c.muted} />
        </Pressable>
        {summary ? (
          <Text style={[t.caption, { color: c.muted, flexShrink: 1 }]} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
      {datesOpen ? (
        <ChipRow
          label="Date filter"
          options={DATE_OPTIONS}
          value={dateFilter}
          onChange={(v) => {
            setDateFilter(v);
            if (v !== 'custom') setDatesOpen(false);
          }}
        />
      ) : null}
      {dateFilter === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md }}>
          <DateField
            label="From"
            value={custom.from}
            onChange={(from) => setCustom((r) => ({ ...r, from }))}
          />
          <DateField
            label="To"
            value={custom.to}
            onChange={(to) => setCustom((r) => ({ ...r, to }))}
          />
        </View>
      ) : null}

      {q.isPending && local.length === 0 ? (
        <LoadingState />
      ) : q.isError && local.length === 0 ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <InvoiceRow
              inv={item}
              today={today}
              badge={badgeFor(off.getOp(item.id))}
              onPress={() => navigation.navigate('Invoice', { id: item.id })}
            />
          )}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={q.isRefetching && !q.isFetchingNextPage}
              onRefresh={() => void q.refetch()}
            />
          }
          ListFooterComponent={
            q.isError && local.length > 0 ? (
              <Text style={{ color: c.muted, padding: spacing.md }}>
                Could not load your other invoices. Pull down to try again.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            filtered ? (
              <EmptyState
                title="No matching invoices"
                hint="Try a different search or filter."
                action={{ label: 'Clear filters', onPress: clearFilters, variant: 'secondary' }}
              />
            ) : (
              <EmptyState
                title="Create your first invoice"
                hint="Send a professional invoice and start getting paid."
                action={{ label: 'New invoice', onPress: () => navigation.navigate('Invoice') }}
              />
            )
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      )}
      <Fab label="New invoice" onPress={() => navigation.navigate('Invoice')} />
    </View>
  );
}

export function InvoiceRow({
  inv,
  onPress,
  badge,
  today = localToday(),
}: {
  inv: InvoiceSummary;
  onPress: () => void;
  /** Small note under the row, e.g. "Not synced". */
  badge?: string;
  /** YYYY-MM-DD in the business timezone, for "Due in 5 days" (defaults to the device's date). */
  today?: string;
}) {
  const c = useTheme();
  const timing = dueTiming(inv, today);
  const amount = money(inv.totalMinor, inv.currency);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Invoice ${inv.number}, ${inv.customerName}, ${amount}`}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, backgroundColor: pressed ? c.surface : 'transparent' },
      ]}
    >
      {/* Who and how much first, then what is happening with it. */}
      <View style={styles.line}>
        <Text style={[t.bodyStrong, { color: c.text, flex: 1 }]} numberOfLines={1}>
          {inv.customerName}
        </Text>
        <Text style={[styles.amount, { color: c.text }]}>{amount}</Text>
      </View>
      <View style={styles.line}>
        <Text style={[t.label, { color: c.muted, flex: 1 }]} numberOfLines={1}>
          {inv.number} ·{' '}
          <Text style={timing.urgent ? { color: c.danger, fontWeight: '600' } : undefined}>
            {timing.text}
          </Text>
        </Text>
        <StatusBadge status={inv.displayStatus} />
      </View>
      {badge ? (
        <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>{badge}</Text>
      ) : null}
    </Pressable>
  );
}

const OPEN = ['sent', 'viewed', 'partially_paid', 'overdue'];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** "Due in 5 days" / "Overdue by 12 days" for invoices still awaiting money; the due date otherwise. */
export function dueTiming(
  inv: Pick<InvoiceSummary, 'displayStatus' | 'dueDate'>,
  today: string,
): { text: string; urgent: boolean } {
  if (!OPEN.includes(inv.displayStatus))
    return { text: `Due ${formatDate(inv.dueDate)}`, urgent: false };
  const days = dayNumber(inv.dueDate) - dayNumber(today);
  const n = (k: number) => `${k} day${k === 1 ? '' : 's'}`;
  if (days < 0) return { text: `Overdue by ${n(-days)}`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  return { text: `Due in ${n(days)}`, urgent: false };
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  dateButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  row: {
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  amount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

const badgeFor = (op: DraftOp | undefined) =>
  !op
    ? undefined
    : op.state !== 'pending'
      ? 'Needs attention'
      : op.isNew
        ? 'Not synced'
        : 'Unsynced changes';

/** A queued draft shown as a list row. */
function localSummary(op: DraftOp): InvoiceSummary {
  const p = op.payload as NonNullable<DraftOp['payload']>;
  return {
    id: op.invoiceId,
    number: op.summary.number ?? 'New draft',
    status: 'draft',
    displayStatus: 'draft',
    customerId: p.customerId,
    customerName: op.summary.customerName,
    issueDate: p.issueDate,
    dueDate: p.dueDate,
    currency: op.summary.currency,
    totalMinor: op.summary.totalMinor,
    amountPaidMinor: 0,
    balanceDueMinor: op.summary.totalMinor,
    updatedAt: op.updatedAt,
  };
}
