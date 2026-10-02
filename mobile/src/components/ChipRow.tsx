import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Multi-select mode: values shown as selected (taps still call onChange to toggle). */
  multiSelected?: string[];
}

/** Horizontally scrolling single-select chips (filters, segmented choices). */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  label,
  multiSelected,
}: Props<T>) {
  const c = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      // Without this a horizontal ScrollView grows to fill the column on web, stretching the chips.
      style={styles.scroll}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((o) => {
        const selected = multiSelected ? multiSelected.includes(o.value) : o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              {
                borderColor: selected ? c.primary : c.surface,
                backgroundColor: selected ? c.primary : c.surface,
              },
            ]}
          >
            <Text style={[styles.text, { color: selected ? c.onPrimary : c.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: { fontSize: 14, fontWeight: '600' },
});
