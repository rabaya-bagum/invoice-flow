import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { formatMoney, type CurrencyCode } from '@invoiceflow/shared';
import { colors, radius, spacing } from '../theme';

interface Props {
  label: string;
  amountMinor: number;
  currency: CurrencyCode;
}

/** Dashboard summary card: amounts arrive as integer minor units and are only formatted here. */
export function StatCard({ label, amountMinor, currency }: Props) {
  const c = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]} accessibilityRole="summary">
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <Text style={[styles.amount, { color: c.text }]}>{formatMoney(amountMinor, currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: spacing.md, minWidth: 140 },
  label: { fontSize: 14, marginBottom: spacing.xs },
  amount: { fontSize: 24, fontWeight: '700' },
});
