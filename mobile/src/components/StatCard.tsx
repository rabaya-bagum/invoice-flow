import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMoney, type CurrencyCode } from '@invoiceflow/shared';
import { radius, spacing, type as t } from '../theme';
import { useTheme } from '../theme/useTheme';

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
  /** `hero` is the screen's main figure (full width, display-size amount); `wide` is full width. */
  size?: 'hero' | 'wide' | 'regular';
  /** Control in the top-right corner (e.g. a period picker). Kept outside the card's button. */
  accessory?: ReactNode;
  /** Extra row under the figure (e.g. an overdue line). Kept outside the card's button. */
  footer?: ReactNode;
}

/** Dashboard summary card: amounts arrive as integer minor units and are only formatted here. */
export function StatCard({
  label,
  amountMinor,
  currency,
  detail,
  onPress,
  tone,
  size = 'regular',
  accessory,
  footer,
}: Props) {
  const c = useTheme();
  const hero = size === 'hero';
  const amount = formatMoney(amountMinor, currency);
  const body = (
    <>
      <Text style={[t.label, { color: c.muted }]}>{label}</Text>
      <Text
        style={[hero ? t.display : t.figure, styles.amount, { color: tone ?? c.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {amount}
      </Text>
      {detail ? <Text style={[t.caption, { color: c.muted }]}>{detail}</Text> : null}
    </>
  );
  return (
    <View
      style={[styles.card, size !== 'regular' && styles.full, { backgroundColor: c.surface }]}
      accessibilityRole={onPress ? undefined : 'summary'}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${amount}${detail ? `, ${detail}` : ''}`}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.body}>{body}</View>
      )}
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    minWidth: 140,
    flexGrow: 1,
    flexBasis: '45%',
    overflow: 'hidden',
  },
  full: { flexBasis: '100%' },
  body: { padding: spacing.md, gap: 2 },
  pressed: { opacity: 0.7 },
  amount: { marginTop: spacing.xs },
  accessory: { position: 'absolute', top: spacing.sm, right: spacing.sm },
});
