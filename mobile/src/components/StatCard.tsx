import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { formatMoney, type CurrencyCode } from '@invoiceflow/shared';
import { colors, radius, spacing } from '../theme';

interface Props {
  label: string;
  amountMinor: number;
  currency: CurrencyCode;
  /** e.g. "3 invoices" */
  detail?: string;
  /** Makes the card a button (e.g. open the matching invoice list). */
  onPress?: () => void;
  /** Colours the amount, e.g. red for overdue. */
  tone?: string;
}

/** Dashboard summary card: amounts arrive as integer minor units and are only formatted here. */
export function StatCard({ label, amountMinor, currency, detail, onPress, tone }: Props) {
  const c = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const body = (
    <>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <Text
        style={[styles.amount, { color: tone ?? c.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatMoney(amountMinor, currency)}
      </Text>
      {detail ? <Text style={[styles.detail, { color: c.muted }]}>{detail}</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatMoney(amountMinor, currency)}${detail ? `, ${detail}` : ''}`}
        style={[styles.card, { backgroundColor: c.surface }]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]} accessibilityRole="summary">
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.md,
    minWidth: 140,
    flexGrow: 1,
    flexBasis: '45%',
  },
  label: { fontSize: 14, marginBottom: spacing.xs },
  amount: { fontSize: 24, fontWeight: '700' },
  detail: { fontSize: 13, marginTop: 2 },
});
