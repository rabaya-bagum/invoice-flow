import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Fab } from '../components/Fab';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import { Row } from '../components/Row';
import { TextField } from '../components/TextField';
import { useCustomers } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import { customerDisplayName } from '../models';
import type { CustomersStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export function CustomerListScreen({
  navigation,
}: NativeStackScreenProps<CustomersStackParams, 'CustomerList'>) {
  const c = useTheme();
  const [search, setSearch] = useState('');
  const q = useCustomers(useDebounced(search.trim()));
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: spacing.md }}>
        <TextField
          label="Search customers"
          value={search}
          onChangeText={setSearch}
          placeholder="Name, company, email or phone"
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
              title={customerDisplayName(item)}
              subtitle={
                item.companyName
                  ? [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email
                  : item.email
              }
              onPress={() => navigation.navigate('CustomerDetail', { id: item.id })}
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
              title={search ? 'No matches' : 'No customers yet'}
              hint={search ? 'Try a different search.' : 'Tap + to add your first customer.'}
            />
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      )}
      <Fab label="Add customer" onPress={() => navigation.navigate('CustomerForm')} />
    </View>
  );
}
