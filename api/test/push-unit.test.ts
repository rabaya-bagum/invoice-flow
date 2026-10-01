import { createExpoPushSender, createLogPushSender, EXPO_TOKEN } from '../src/services/push';
import { startSchedulers } from '../src/services/overdue-service';

const msg = (to: string) => ({ to, title: 'T', body: 'B', data: { invoiceId: 'i1' } });
const ok = (n: number) =>
  new Response(JSON.stringify({ data: Array.from({ length: n }, () => ({ status: 'ok' })) }), {
    status: 200,
  });

describe('Expo push sender', () => {
  it('posts the message with sound/priority and an optional bearer token', async () => {
    const f = jest.fn(async () => ok(1));
    await createExpoPushSender('tok', f as unknown as typeof fetch).send([
      msg('ExponentPushToken[a]'),
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual([
      {
        to: 'ExponentPushToken[a]',
        title: 'T',
        body: 'B',
        data: { invoiceId: 'i1' },
        sound: 'default',
        channelId: 'default',
        priority: 'high',
      },
    ]);
    const noAuth = jest.fn(async () => ok(1));
    await createExpoPushSender(undefined, noAuth as unknown as typeof fetch).send([
      msg('ExponentPushToken[a]'),
    ]);
    expect(
      (
        (noAuth.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
          string,
          string
        >
      ).Authorization,
    ).toBeUndefined();
  });

  it('chunks to 100 messages per request and keeps results in order', async () => {
    const f = jest.fn(async (_u: string, init: RequestInit) =>
      ok(JSON.parse(init.body as string).length),
    );
    const messages = Array.from({ length: 250 }, (_, i) => msg(`ExponentPushToken[${i}]`));
    const results = await createExpoPushSender(undefined, f as unknown as typeof fetch).send(
      messages,
    );
    expect(f).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(250);
    expect(results.map((r) => r.to)).toEqual(messages.map((m) => m.to));
  });

  it('maps per-message errors, and throws when the provider fails entirely', async () => {
    const f = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { status: 'ok' },
              { status: 'error', details: { error: 'DeviceNotRegistered' } },
            ],
          }),
          { status: 200 },
        ),
    );
    const r = await createExpoPushSender(undefined, f as unknown as typeof fetch).send([
      msg('ExponentPushToken[a]'),
      msg('ExponentPushToken[b]'),
    ]);
    expect(r).toEqual([
      { to: 'ExponentPushToken[a]', ok: true },
      { to: 'ExponentPushToken[b]', ok: false, error: 'DeviceNotRegistered' },
    ]);
    const bad = jest.fn(async () => new Response('x', { status: 503 }));
    await expect(
      createExpoPushSender(undefined, bad as unknown as typeof fetch).send([
        msg('ExponentPushToken[a]'),
      ]),
    ).rejects.toThrow('503');
    const down = jest.fn(async () => {
      throw new Error('ECONNRESET internal-host');
    });
    await expect(
      createExpoPushSender(undefined, down as unknown as typeof fetch).send([
        msg('ExponentPushToken[a]'),
      ]),
    ).rejects.toThrow('push provider unreachable');
  });

  it('log sender never prints message content', async () => {
    const log = jest.fn();
    const r = await createLogPushSender(log).send([msg('ExponentPushToken[a]')]);
    expect(r).toEqual([{ to: 'ExponentPushToken[a]', ok: true }]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('invoiceId');
  });

  it('validates token format', () => {
    for (const good of ['ExponentPushToken[abc-123_x]', 'ExpoPushToken[abc]'])
      expect(EXPO_TOKEN.test(good)).toBe(true);
    for (const bad of [
      '',
      'token',
      'ExponentPushToken[]',
      'ExponentPushToken[a b]',
      'ExponentPushToken[a]x',
      'x ExponentPushToken[a]',
    ])
      expect(EXPO_TOKEN.test(bad)).toBe(false);
  });
});

describe('startSchedulers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs jobs on their interval and once after the initial delay, and stops', async () => {
    const run = jest.fn(async () => undefined);
    const stop = startSchedulers([{ name: 'j', everyMs: 1000, initialDelayMs: 100, run }]);
    await jest.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never overlaps a slow run and survives failures', async () => {
    let release!: () => void;
    const slow = jest.fn(() => new Promise<void>((r) => (release = r)));
    const log = jest.fn();
    const stopSlow = startSchedulers([{ name: 'slow', everyMs: 100, run: slow }], log);
    await jest.advanceTimersByTimeAsync(450);
    expect(slow).toHaveBeenCalledTimes(1); // still running: later ticks skipped
    release();
    await jest.advanceTimersByTimeAsync(150);
    expect(slow.mock.calls.length).toBeGreaterThanOrEqual(2);
    stopSlow();

    const boom = jest.fn(async () => {
      throw new Error('db down');
    });
    const stopBoom = startSchedulers([{ name: 'boom', everyMs: 100, run: boom }], log);
    await jest.advanceTimersByTimeAsync(350);
    expect(boom.mock.calls.length).toBeGreaterThanOrEqual(3); // kept ticking after errors
    expect(log).toHaveBeenCalledWith('job boom failed: db down');
    stopBoom();
  });
});
