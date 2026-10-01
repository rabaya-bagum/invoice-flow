import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled }: Props) {
  const c = useTheme();
  const inactive = disabled || loading;
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.danger : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? c.onPrimary : c.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      style={[
        styles.base,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? c.border : 'transparent' },
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48, // comfortable touch target
    borderRadius: radius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  inactive: { opacity: 0.6 },
  text: { fontSize: 16, fontWeight: '600' },
});
