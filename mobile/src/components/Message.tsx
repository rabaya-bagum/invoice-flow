import { StyleSheet, Text } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

export function Message({ kind, children }: { kind: 'error' | 'info'; children: string }) {
  const c = useTheme();
  const color = kind === 'error' ? c.danger : c.primary;
  return (
    <Text
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.box, { color, borderColor: color, backgroundColor: c.surface }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.button, padding: spacing.md, fontSize: 14 },
});
