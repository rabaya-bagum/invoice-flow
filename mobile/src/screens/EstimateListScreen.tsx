import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ChipRow } from '../components/ChipRow';
import { Fab } from '../components/Fab';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { StatusBadge } from '../components/StatusBadge';
import { TextField } from '../components/TextField';
import { useEstimates } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import type { EstimateSummary } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';

type Filter = 'all' | 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
const OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

export function EstimateListScreen({
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'EstimateList'>) {
  const c = useTheme();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const q = useEstimates({
    search: useDebounced(search.trim()),
    status: status === 'all' ? undefined : status,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const filtered = search || status !== 'all';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <TextField
          label="Search estimates"
          value={search}
          onChangeText={setSearch}
          placeholder="Customer, number or amount"
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <ChipRow
        label="Estimate status filter"
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
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <EstimateRow
              est={item}
              onPress={() => navigation.navigate('Estimate', { id: item.id })}
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
              title={filtered ? 'No matching estimates' : 'No estimates yet'}
              hint={
                filtered
                  ? 'Try changing the filters.'
                  : 'Tap + to quote a customer, then turn it into an invoice when they accept.'
              }
            />
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      )}
      <Fab label="New estimate" onPress={() => navigation.navigate('Estimate')} />
    </View>
  );
}

function EstimateRow({ est, onPress }: { est: EstimateSummary; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Estimate ${est.number}, ${est.customerName}, ${money(est.totalMinor, est.currency)}`}
      style={[styles.row, { borderBottomColor: c.border }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {est.customerName}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
          {est.number} · Valid until {formatDate(est.expiryDate)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: c.text, fontWeight: '700' }}>
          {money(est.totalMinor, est.currency)}
        </Text>
        <StatusBadge status={est.displayStatus} />
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
