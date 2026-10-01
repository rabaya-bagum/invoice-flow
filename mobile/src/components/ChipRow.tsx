import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { radius, spacing } from '../theme';
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
                borderColor: selected ? c.primary : c.border,
                backgroundColor: selected ? c.primary : 'transparent',
              },
            ]}
          >
            <Text style={{ color: selected ? c.onPrimary : c.text, fontWeight: '600' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1,
  },
});
