import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { flushPendingTarget, openTarget } from '../navigation/ref';
import {
  configureNotificationHandler,
  isPushPreferenceOn,
  registerForPush,
  routeForNotification,
} from '../services/push';
import { useAuth } from '../store/auth';
import { keys } from './queries';

/**
 * Mounted once while signed in and unlocked: registers the device (unless the user turned
 * notifications off), refreshes the notification list when one arrives, and opens the invoice when
 * one is tapped (including the tap that launched the app).
 */
export function usePushNotifications() {
  const { api } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    configureNotificationHandler();
    let cancelled = false;

    void (async () => {
      if (await isPushPreferenceOn()) await registerForPush(api);
      if (cancelled) return;
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) openTarget(routeForNotification(last.notification.request.content.data));
      flushPendingTarget();
    })();

    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.invoices }); // statuses may have changed
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      openTarget(routeForNotification(r.notification.request.content.data));
    });
    return () => {
      cancelled = true;
      received.remove();
      tapped.remove();
    };
  }, [api, qc]);
}
