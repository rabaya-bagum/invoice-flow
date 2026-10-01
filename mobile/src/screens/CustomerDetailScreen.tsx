import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Screen } from '../components/Screen';
import { InvoiceRow } from './InvoiceListScreen';
import { useCustomer, useCustomerInvoices } from '../hooks/queries';
import { customerDisplayName } from '../models';
import type { CustomersStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export function CustomerDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<CustomersStackParams, 'CustomerDetail'>) {
  const c = useTheme();
  const q = useCustomer(route.params.id);
  const history = useCustomerInvoices(route.params.id);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const cust = q.data;
  const address = [
    cust.addressLine1,
    cust.addressLine2,
    [cust.city, cust.province, cust.postalCode].filter(Boolean).join(', '),
    cust.country,
  ].filter(Boolean);

  const Field = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <View style={styles.field}>
        <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: c.text, fontSize: 16 }}>{value}</Text>
      </View>
    ) : null;

  return (
    <Screen centered={false}>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>
        {customerDisplayName(cust)}
      </Text>
      <Field label="Email" value={cust.email} />
      <Field label="Phone" value={cust.phone} />
      <Field label="Address" value={address.join('\n')} />
      <Field label="Notes" value={cust.notes} />
      <View style={[styles.history, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Text style={{ color: c.text, fontWeight: '600' }}>Invoice history</Text>
        {history.isPending ? (
          <Text style={{ color: c.muted }}>Loading…</Text>
        ) : history.isError ? (
          <Text style={{ color: c.muted }}>Could not load invoices.</Text>
        ) : history.data.items.length === 0 ? (
          <Text style={{ color: c.muted }}>No invoices for this customer yet.</Text>
        ) : (
          history.data.items.map((inv) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              onPress={() =>
                (
                  navigation.getParent() as unknown as { navigate: (a: string, b: object) => void }
                )?.navigate('InvoicesTab', { screen: 'Invoice', params: { id: inv.id } })
              }
            />
          ))
        )}
      </View>
      <Button
        title="Edit customer"
        onPress={() => navigation.navigate('CustomerForm', { id: cust.id })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 2 },
  history: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
});
