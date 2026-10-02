import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useOffline } from '../offline/context';
import { kindOf, type DraftOp } from '../offline/types';
import type { InvoicesStackParams } from '../navigation/types';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { money } from '../utils/format';

const LABEL: Record<DraftOp['state'], string> = {
  pending: 'Waiting to sync',
  conflict: 'Needs your attention',
  failed: 'Needs your attention',
};

export function SyncStatusScreen({
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'SyncStatus'>) {
  const c = useTheme();
  const off = useOffline();
  return (
    <Screen centered={false}>
      <Text style={{ color: c.muted }}>
        Drafts made without a connection are kept on this device and upload automatically when you
        are back online.
        {off.lastStop === 'offline' ? ' Right now the app cannot reach the server.' : ''}
        {off.lastStop === 'busy' ? ' The server is busy; it will try again shortly.' : ''}
      </Text>
      <Button
        title={off.syncing ? 'Syncing…' : 'Sync now'}
        onPress={() => void off.syncNow()}
        loading={off.syncing}
        disabled={off.pending === 0}
      />
      {off.ops.length === 0 ? (
        <Text style={{ color: c.text, fontSize: 16 }}>Everything is synced.</Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {off.ops.map((op) => (
          <Pressable
            key={op.invoiceId}
            onPress={() =>
              kindOf(op) === 'estimate'
                ? navigation.navigate('Estimate', { id: op.invoiceId })
                : navigation.navigate('Invoice', { id: op.invoiceId })
            }
            accessibilityRole="button"
            accessibilityLabel={`${op.summary.customerName}, ${op.payload === null ? 'deleting' : LABEL[op.state]}`}
            style={{
              padding: spacing.md,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: op.state === 'pending' ? c.border : c.danger,
              backgroundColor: c.surface,
              gap: 2,
            }}
          >
            <Text style={{ color: c.text, fontWeight: '700' }}>{op.summary.customerName}</Text>
            <Text style={{ color: c.muted }}>
              {op.payload === null
                ? `Delete ${kindOf(op)} draft`
                : `${op.isNew ? 'New' : 'Edited'} ${kindOf(op)} draft · ${money(op.summary.totalMinor, op.summary.currency)}`}
            </Text>
            <Text style={{ color: op.state === 'pending' ? c.muted : c.danger, fontSize: 13 }}>
              {op.problem?.message ?? LABEL[op.state]}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
