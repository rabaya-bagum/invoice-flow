import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { statusColor } from '../theme/status-colors';
import type { DisplayStatus, EstimateDisplayStatus } from '../models';

const LABELS: Record<DisplayStatus | EstimateDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  accepted: 'Accepted',
  rejected: 'Declined',
  expired: 'Expired',
};

/** Always shows a text label, so status never depends on colour alone. */
export function StatusBadge({ status }: { status: DisplayStatus | EstimateDisplayStatus }) {
  const color = statusColor(status, useColorScheme() === 'dark' ? 'dark' : 'light');
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
