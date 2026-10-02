import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { friendlyMessage } from '../utils/errors';
import { Button } from './Button';

export function LoadingState() {
  return (
    <View style={styles.center}>
      <ActivityIndicator accessibilityLabel="Loading" />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const c = useTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: c.text, textAlign: 'center' }}>{friendlyMessage(error)}</Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  /** A way out of the empty state, e.g. "Create your first invoice" or "Clear filters". */
  action?: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' };
}) {
  const c = useTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{title}</Text>
      {hint ? <Text style={{ color: c.muted, textAlign: 'center' }}>{hint}</Text> : null}
      {action ? (
        <Button title={action.label} variant={action.variant} onPress={action.onPress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: spacing.xl, alignItems: 'center', gap: spacing.md },
});
