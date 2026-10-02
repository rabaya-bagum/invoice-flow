import { Pressable, Text, View } from 'react-native';
import { useOffline } from '../offline/context';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

/** "3 changes waiting to sync" / "1 needs your attention". Hidden when the queue is empty. */
export function SyncBanner({ onOpen }: { onOpen: () => void }) {
  const c = useTheme();
  const off = useOffline();
  if (!off.available || off.ops.length === 0) return null;
  const attention = off.attention > 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const text = attention
    ? `${plural(off.attention, 'draft')} need${off.attention === 1 ? 's' : ''} your attention`
    : off.syncing
      ? 'Syncing your drafts…'
      : `${plural(off.pending, 'draft')} saved on this device, waiting to sync`;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${text}`}
      style={{
        marginHorizontal: spacing.md,
        marginTop: spacing.sm,
        padding: spacing.md,
        borderRadius: 12,
        backgroundColor: attention ? '#FEF2F2' : '#EFF6FF',
        borderWidth: 1,
        borderColor: attention ? '#FCA5A5' : '#BFDBFE',
      }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ color: attention ? '#991B1B' : '#1E3A8A', fontWeight: '700' }}>{text}</Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>Tap for details</Text>
      </View>
    </Pressable>
  );
}
