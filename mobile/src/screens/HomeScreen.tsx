import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { StatCard } from '../components/StatCard';
import type { AppStackParams } from '../navigation/types';
import type { MeResponse } from '../services/api';
import { useAuth } from '../store/auth';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { friendlyMessage } from '../utils/errors';

/** Placeholder dashboard until Phase 3: static numbers, real account header. */
export function HomeScreen({ navigation }: NativeStackScreenProps<AppStackParams, 'Home'>) {
  const { api } = useAuth();
  const c = useTheme();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((m) => !cancelled && setMe(m))
      .catch((e) => !cancelled && setError(friendlyMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>
          {me ? me.business.name : 'InvoiceFlow'}
        </Text>
        {error ? <Message kind="error">{error}</Message> : null}
        <View style={styles.row}>
          <StatCard label="Outstanding" amountMinor={425000} currency="USD" />
          <StatCard label="Paid" amountMinor={1250000} currency="USD" />
          <StatCard label="Overdue" amountMinor={120000} currency="USD" />
        </View>
        <Button
          title="Settings"
          variant="secondary"
          onPress={() => navigation.navigate('Settings')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
