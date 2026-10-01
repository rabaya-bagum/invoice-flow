import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
}

export function TextField({ label, error, secureTextEntry, ...rest }: Props) {
  const c = useTheme();
  const [hidden, setHidden] = useState(true);
  const isPassword = Boolean(secureTextEntry);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View
        style={[
          styles.row,
          { borderColor: error ? c.danger : c.border, backgroundColor: c.surface },
        ]}
      >
        <TextInput
          {...rest}
          accessibilityLabel={label}
          secureTextEntry={isPassword && hidden}
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text }]}
        />
        {isPassword && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={8}
          >
            <Text style={{ color: c.primary, fontWeight: '600' }}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        )}
      </View>
      {error ? (
        <Text style={[styles.error, { color: c.danger }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  error: { fontSize: 13 },
});
