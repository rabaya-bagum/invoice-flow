import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/ListStates';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../hooks/queries';
import type { AppNotification } from '../models';
import { openTarget } from '../navigation/ref';
import type { MoreStackParams } from '../navigation/types';
import { routeForNotification } from '../services/push';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { timeAgo } from '../utils/time';

export function NotificationsScreen(
  _props: NativeStackScreenProps<MoreStackParams, 'Notifications'>,
) {
  const c = useTheme();
  const q = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    openTarget(routeForNotification(n.data));
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {q.data.unread > 0 ? (
        <View style={{ padding: spacing.md }}>
          <Button
            title={`Mark all ${q.data.unread} as read`}
            variant="secondary"
            onPress={() => markAll.mutate()}
            loading={markAll.isPending}
          />
        </View>
      ) : null}
      <FlatList
        data={q.data.items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.readAt ? '' : 'Unread. '}${item.title}. ${item.body}`}
            style={[
              styles.row,
              {
                borderBottomColor: c.border,
                backgroundColor: item.readAt ? 'transparent' : `${c.primary}10`,
              },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: item.readAt ? 'transparent' : c.primary }]}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{ color: c.text, fontSize: 16, fontWeight: item.readAt ? '500' : '700' }}
              >
                {item.title}
              </Text>
              <Text style={{ color: c.muted, fontSize: 14 }}>{item.body}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{timeAgo(item.createdAt)}</Text>
            </View>
          </Pressable>
        )}
        refreshControl={
          <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No notifications yet"
            hint="You'll see invoice activity here: sent, viewed, paid and overdue."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
});
