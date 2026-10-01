import { StyleSheet, Text, View } from 'react-native';
import type { PaymentStatus } from '../models';

const LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  successful: 'Successful',
  failed: 'Failed',
  refunded: 'Refunded',
};
const COLORS: Record<PaymentStatus, string> = {
  pending: '#B45309',
  successful: '#15803D',
  failed: '#DC2626',
  refunded: '#0E7490',
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const color = COLORS[status] ?? '#64748B';
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
