import { StyleSheet, Text, View } from 'react-native';
import type { DisplayStatus } from '../models';

const LABELS: Record<DisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const COLORS: Record<DisplayStatus, string> = {
  draft: '#64748B',
  sent: '#2563EB',
  viewed: '#7C3AED',
  partially_paid: '#B45309',
  paid: '#15803D',
  overdue: '#DC2626',
  cancelled: '#6B7280',
  refunded: '#0E7490',
};

/** Always shows a text label, so status never depends on colour alone. */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  const color = COLORS[status] ?? COLORS.draft;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1A` }]}>
      <Text
        style={[styles.text, { color }]}
        accessibilityLabel={`Status: ${LABELS[status] ?? status}`}
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
