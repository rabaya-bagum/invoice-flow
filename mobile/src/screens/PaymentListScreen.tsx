import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ChipRow } from '../components/ChipRow';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { PaymentBadge } from '../components/PaymentBadge';
import { TextField } from '../components/TextField';
import { usePayments } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import type { Payment } from '../models';
import type { PaymentsStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';
import { methodLabel, paymentRef } from '../utils/payment-labels';

type Filter = 'all' | 'pending' | 'successful' | 'failed' | 'refunded';
const OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'successful', label: 'Successful' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

export function PaymentListScreen({
  navigation,
}: NativeStackScreenProps<PaymentsStackParams, 'PaymentList'>) {
  const c = useTheme();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const q = usePayments({
    search: useDebounced(search.trim()),
    status: status === 'all' ? undefined : status,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <TextField
          label="Search payments"
          value={search}
          onChangeText={setSearch}
          placeholder="Invoice, customer or payment ID"
          autoCapitalize="none"
        />
      </View>
      <ChipRow
        label="Payment status filter"
        options={OPTIONS}
        value={status}
        onChange={setStatus}
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PaymentRow
              p={item}
              onPress={() => navigation.navigate('PaymentDetail', { id: item.id })}
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
          ListEmptyComponent={
            <EmptyState
              title={search || status !== 'all' ? 'No matching payments' : 'No payments yet'}
              hint={
                search || status !== 'all'
                  ? 'Try changing the filters.'
                  : 'Payments appear here when customers pay your invoices online.'
              }
            />
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

function PaymentRow({ p, onPress }: { p: Payment; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Payment of ${money(p.amountMinor, p.currency)} for invoice ${p.invoiceNumber}, ${p.status}`}
      style={[styles.row, { borderBottomColor: c.border }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {p.customerName}
        </Text>
        <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
          {p.invoiceNumber} · {methodLabel(p.method)} ·{' '}
          {formatDate((p.paidAt ?? p.createdAt).slice(0, 10))}
        </Text>
        <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
          {paymentRef(p)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: c.text, fontWeight: '700' }}>{money(p.amountMinor, p.currency)}</Text>
        <PaymentBadge status={p.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
