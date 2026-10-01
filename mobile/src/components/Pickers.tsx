import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCustomers, useProducts } from '../hooks/queries';
import { useDebounced } from '../hooks/useDebounced';
import { customerDisplayName, type Customer, type Product } from '../models';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { EmptyState, ErrorState, LoadingState } from './ListStates';
import { Row } from './Row';
import { TextField } from './TextField';

function PickerShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={styles.header}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
          >
            <Text style={{ color: c.primary, fontSize: 16, fontWeight: '600' }}>Close</Text>
          </Pressable>
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

export function CustomerPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (c: Customer) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useCustomers(useDebounced(search.trim()));
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <PickerShell visible={visible} title="Choose customer" onClose={onClose}>
      <View style={{ padding: spacing.md }}>
        <TextField label="Search" value={search} onChangeText={setSearch} autoCapitalize="none" />
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
              subtitle={item.email}
              onPress={() => onPick(item)}
            />
          )}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState title="No customers" hint="Add a customer from the Customers tab first." />
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </PickerShell>
  );
}

export function ProductPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useProducts(useDebounced(search.trim()));
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.isActive);
  return (
    <PickerShell visible={visible} title="Add from catalog" onClose={onClose}>
      <View style={{ padding: spacing.md }}>
        <TextField label="Search" value={search} onChangeText={setSearch} autoCapitalize="none" />
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
              subtitle={item.category ?? item.sku}
              onPress={() => onPick(item)}
            />
          )}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState title="No products yet" hint="Add them under More → Products & services." />
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </PickerShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
});
