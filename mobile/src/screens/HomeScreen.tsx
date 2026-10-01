import { ScrollView, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { colors, spacing } from '../theme';

/** Placeholder until the dashboard is built in Phase 3. Static numbers, no backend yet. */
export function HomeScreen() {
  const c = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <StatCard label="Outstanding" amountMinor={425000} currency="USD" />
          <StatCard label="Paid" amountMinor={1250000} currency="USD" />
          <StatCard label="Overdue" amountMinor={120000} currency="USD" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
