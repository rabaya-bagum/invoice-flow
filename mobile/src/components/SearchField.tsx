import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> {
  /** Read by screen readers (there is no visible label, as in a native search bar). */
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}

/** iOS-style search bar: magnifier, no visible label, and a clear button once there is text. */
export function SearchField({ label, value, onChangeText, ...rest }: Props) {
  const c = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: c.surface }]}>
      <Ionicons name="search" size={18} color={c.muted} />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        returnKeyType="search"
        autoCorrect={false}
        style={[styles.input, { color: c.text }]}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
        >
          <Ionicons name="close-circle" size={18} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0, height: '100%' },
});
