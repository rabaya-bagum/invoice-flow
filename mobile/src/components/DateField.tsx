import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { isValidDate } from '@invoiceflow/shared';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate } from '../utils/format';

interface Props {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  error?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
// Noon local time avoids DST edge cases when converting between Date and a calendar date.
const toDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function DateField({ label, value, onChange, error }: Props) {
  const c = useTheme();
  const date = isValidDate(value) ? toDate(value) : new Date();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={date}
          mode="date"
          display="compact"
          accessibilityLabel={label}
          onChange={(_e, d) => d && onChange(fromDate(d))}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${isValidDate(value) ? formatDate(value) : 'not set'}. Change`}
          onPress={() =>
            DateTimePickerAndroid.open({
              value: date,
              mode: 'date',
              onChange: (_e, d) => d && onChange(fromDate(d)),
            })
          }
          style={[
            styles.button,
            { borderColor: error ? c.danger : c.border, backgroundColor: c.surface },
          ]}
        >
          <Text style={{ color: c.text, fontSize: 16 }}>
            {isValidDate(value) ? formatDate(value) : 'Select date'}
          </Text>
        </Pressable>
      )}
      {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600' },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
  },
});
