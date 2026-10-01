import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props {
  title: string;
  subtitle?: string | null;
  right?: string;
  onPress?: () => void;
  muted?: boolean;
}

export function Row({ title, subtitle, right, onPress, muted }: Props) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.row, { borderBottomColor: c.border }]}
    >
      <View style={styles.main}>
        <Text style={[styles.title, { color: muted ? c.muted : c.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <Text style={{ color: c.text, fontWeight: '600' }}>{right}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
});
