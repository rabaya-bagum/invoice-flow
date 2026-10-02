import { dateRangeFor, todayInTimezone, type DatePreset } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ChipRow } from '../components/ChipRow';
import { SyncBanner } from '../components/SyncBanner';
import { useOffline } from '../offline/context';
import { DateField } from '../components/DateField';
import { Fab } from '../components/Fab';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { StatusBadge } from '../components/StatusBadge';
import { TextField } from '../components/TextField';
import { useBusiness, useInvoices } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import type { InvoiceSummary } from '../models';
import { kindOf, type DraftOp } from '../offline/types';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing } from '../theme';
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

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <TextField
          label="Search invoices"
          value={search}
          onChangeText={setSearch}
          placeholder="Customer, number or amount"
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <SyncBanner onOpen={() => navigation.navigate('SyncStatus')} />
      <ChipRow label="Status filter" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <ChipRow
        label="Date filter"
        options={DATE_OPTIONS}
        value={dateFilter}
        onChange={setDateFilter}
      />
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
            <EmptyState
              title={filtered ? 'No matching invoices' : 'No invoices yet'}
              hint={filtered ? 'Try changing the filters.' : 'Tap + to create your first invoice.'}
            />
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
}: {
  inv: InvoiceSummary;
  onPress: () => void;
  /** Small note under the row, e.g. "Not synced". */
  badge?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Invoice ${inv.number}, ${inv.customerName}, ${money(inv.totalMinor, inv.currency)}`}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, backgroundColor: pressed ? c.surface : 'transparent' },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {inv.customerName}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
          {inv.number} · Due {formatDate(inv.dueDate)}
        </Text>
        {badge ? (
          <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>{badge}</Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: c.text, fontWeight: '700' }}>
          {money(inv.totalMinor, inv.currency)}
        </Text>
        {/* Wrapped: the badge sizes itself with alignSelf, which would undo the right alignment. */}
        <View>
          <StatusBadge status={inv.displayStatus} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
