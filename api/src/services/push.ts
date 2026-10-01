export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushResult {
  to: string;
  ok: boolean;
  /** Expo error code, e.g. DeviceNotRegistered, MessageRateExceeded. */
  error?: string;
}

export interface PushSender {
  /** Throws if the provider could not be reached at all (the caller retries later). */
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export const EXPO_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

const CHUNK = 100; // Expo accepts up to 100 messages per request

/** Sends through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export function createExpoPushSender(
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
): PushSender {
  return {
    async send(messages) {
      const results: PushResult[] = [];
      for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        let res: Response;
        try {
          res = await fetchImpl('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(
              chunk.map((m) => ({
                to: m.to,
                title: m.title,
                body: m.body,
                data: m.data,
                sound: 'default',
                channelId: 'default',
                priority: 'high',
              })),
            ),
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          throw new Error('push provider unreachable');
        }
        if (!res.ok) throw new Error(`push provider error ${res.status}`);
        const json = (await res.json()) as {
          data?: Array<{ status: string; details?: { error?: string }; message?: string }>;
        };
        chunk.forEach((m, k) => {
          const t = json.data?.[k];
          results.push(
            t?.status === 'ok'
              ? { to: m.to, ok: true }
              : { to: m.to, ok: false, error: t?.details?.error ?? 'unknown' },
          );
        });
      }
      return results;
    },
  };
}

/** Development fallback: says a push would be sent, never logs message content. */
export function createLogPushSender(log: (m: string) => void = console.log): PushSender {
  return {
    send: async (messages) => {
      log(`[push disabled] would send ${messages.length} notification(s)`);
      return messages.map((m) => ({ to: m.to, ok: true }));
    },
  };
}
