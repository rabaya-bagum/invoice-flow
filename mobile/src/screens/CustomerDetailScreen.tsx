import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Screen } from '../components/Screen';
import { useCustomer } from '../hooks/queries';
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
        <Text style={{ color: c.muted }}>
          Invoices for this customer will appear here once invoicing is available.
        </Text>
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
