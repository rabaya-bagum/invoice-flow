import { formatMoney, isSupportedCurrency } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Fab } from '../components/Fab';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { Row } from '../components/Row';
import { TextField } from '../components/TextField';
import { useBusiness, useProducts } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import type { MoreStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export function ProductListScreen({
  navigation,
}: NativeStackScreenProps<MoreStackParams, 'ProductList'>) {
  const c = useTheme();
  const [search, setSearch] = useState('');
  const q = useProducts(useDebounced(search.trim()));
  const business = useBusiness();
  const currency = business.data?.defaultCurrency;
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: spacing.md }}>
        <TextField
          label="Search products and services"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Row
              title={item.name}
              subtitle={
                [item.category, item.isActive ? null : 'Inactive'].filter(Boolean).join(' · ') ||
                item.sku
              }
              right={
                currency && isSupportedCurrency(currency)
                  ? `${formatMoney(item.priceMinor, currency)}/${item.unit}`
                  : undefined
              }
              muted={!item.isActive}
              onPress={() => navigation.navigate('ProductForm', { id: item.id })}
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
              title={search ? 'No matches' : 'No products or services yet'}
              hint={
                search
                  ? 'Try a different search.'
                  : 'Add reusable items like "Consulting, $150/hour".'
              }
            />
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      )}
      <Fab label="Add product or service" onPress={() => navigation.navigate('ProductForm')} />
    </View>
  );
}
