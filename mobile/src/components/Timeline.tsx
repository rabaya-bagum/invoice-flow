import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { ActivityEntry } from '../models';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDayHeading, formatTime } from '../utils/time';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<string, { icon: IconName; color: string; label: string }> = {
  created: { icon: 'create-outline', color: '#64748B', label: 'Invoice created' },
  updated: { icon: 'pencil-outline', color: '#64748B', label: 'Invoice edited' },
  sent: { icon: 'paper-plane-outline', color: '#2563EB', label: 'Invoice sent' },
  viewed: { icon: 'eye-outline', color: '#7C3AED', label: 'Invoice viewed' },
  payment_received: { icon: 'card-outline', color: '#15803D', label: 'Payment received' },
  paid: { icon: 'checkmark-circle-outline', color: '#15803D', label: 'Invoice marked as paid' },
  payment_failed: { icon: 'alert-circle-outline', color: '#DC2626', label: 'Payment failed' },
  refund: { icon: 'return-down-back-outline', color: '#0E7490', label: 'Refund issued' },
  overdue: { icon: 'time-outline', color: '#DC2626', label: 'Invoice overdue' },
  cancelled: { icon: 'close-circle-outline', color: '#6B7280', label: 'Invoice cancelled' },
};
const FALLBACK = { icon: 'ellipse-outline' as IconName, color: '#64748B', label: 'Activity' };

/** Vertical timeline grouped by day, newest day last (chronological), time in the device's timezone. */
export function Timeline({ entries, now }: { entries: ActivityEntry[]; now?: Date }) {
  const c = useTheme();
  const groups: Array<{ heading: string; items: ActivityEntry[] }> = [];
  for (const e of entries) {
    const heading = formatDayHeading(e.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.items.push(e);
    else groups.push({ heading, items: [e] });
  }
  return (
    <View accessibilityLabel="Invoice activity timeline" style={{ gap: spacing.md }}>
      {groups.map((g) => (
        <View key={g.heading} style={{ gap: spacing.sm }}>
          <Text
            style={{ color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}
          >
            {g.heading}
          </Text>
          {g.items.map((e) => {
            const meta = ICONS[e.type] ?? FALLBACK;
            return (
              <View key={e.id} style={styles.row}>
                <View style={[styles.dot, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon} size={16} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.muted, fontSize: 12 }}>{formatTime(e.createdAt)}</Text>
                  <Text style={{ color: c.text, fontSize: 16 }}>{e.message ?? meta.label}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
