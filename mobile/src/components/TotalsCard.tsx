import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import type { TotalsRow } from '../utils/totals-rows';

export function TotalsCard({ rows }: { rows: TotalsRow[] }) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]} accessibilityLabel="Invoice totals">
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text
            style={{
              color: r.strong ? c.text : c.muted,
              fontWeight: r.strong ? '700' : '400',
              fontSize: r.strong ? 17 : 15,
            }}
          >
            {r.label}
          </Text>
          <Text
            style={{
              color: c.text,
              fontWeight: r.strong ? '700' : '500',
              fontSize: r.strong ? 17 : 15,
            }}
          >
            {r.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
