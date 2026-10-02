import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { PaymentStatus } from '../models';
import { statusColor, type StatusKey } from '../theme/status-colors';

const LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  successful: 'Successful',
  failed: 'Failed',
  refunded: 'Refunded',
};
const KEYS: Record<PaymentStatus, StatusKey> = {
  pending: 'partially_paid',
  successful: 'paid',
  failed: 'overdue',
  refunded: 'refunded',
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const color = statusColor(
    KEYS[status] ?? 'draft',
    useColorScheme() === 'dark' ? 'dark' : 'light',
  );
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1A` }]}>
      <Text
        style={[styles.text, { color }]}
        accessibilityLabel={`Payment status: ${LABELS[status] ?? status}`}
      >
        {LABELS[status] ?? status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '700' },
});
