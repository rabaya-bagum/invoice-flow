import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing, type as t } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}

/** Compact single-select control for a few short options that sit inside a card. */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const c = useTheme();
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={[styles.track, { backgroundColor: c.background, borderColor: c.border }]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={{ top: 8, bottom: 8 }}
            style={[styles.segment, selected && { backgroundColor: c.primary }]}
          >
            <Text style={[t.caption, styles.text, { color: selected ? c.onPrimary : c.muted }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, padding: 2 },
  segment: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 999,
  },
  text: { fontWeight: '600' },
});
