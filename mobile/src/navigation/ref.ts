import { createNavigationContainerRef } from '@react-navigation/native';
import type { NotificationTarget } from '../services/push';
import type { TabParams } from './types';

export const navigationRef = createNavigationContainerRef<TabParams>();

let pending: NotificationTarget | null = null;

/** Open the target now, or as soon as the navigator is ready (cold start from a notification). */
export function openTarget(target: NotificationTarget | null) {
  if (!target) return;
  if (!navigationRef.isReady()) {
    pending = target;
    return;
  }
  navigationRef.navigate(target.tab, { screen: target.screen, params: target.params } as never);
}

export function flushPendingTarget() {
  if (pending && navigationRef.isReady()) {
    const t = pending;
    pending = null;
    navigationRef.navigate(t.tab, { screen: t.screen, params: t.params } as never);
  }
}
