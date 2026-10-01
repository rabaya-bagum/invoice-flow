import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Timeline } from '../src/components/Timeline';
import { openTarget } from '../src/navigation/ref';
import { NotificationsScreen } from '../src/screens/NotificationsScreen';
import { formatDayHeading, formatTime, timeAgo } from '../src/utils/time';
import { nav, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');
jest.mock('../src/navigation/ref', () => ({
  openTarget: jest.fn(),
  flushPendingTarget: jest.fn(),
  navigationRef: {},
}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-device', () => ({ isDevice: true }));

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  type: 'invoice_paid',
  title: 'Invoice paid',
  body: 'Payment of $1,000.00 received for INV-0001.',
  data: { invoiceId: 'inv-1' },
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});

describe('NotificationsScreen', () => {
  beforeEach(() => jest.clearAllMocks());
  const open = async (
    items = [
      note(),
      note({
        id: 'n2',
        title: 'Invoice viewed',
        body: 'Invoice INV-0002 has been viewed by Ann.',
        readAt: '2026-10-01T10:00:00Z',
        data: { invoiceId: 'inv-2' },
      }),
    ],
    unread = 1,
  ) => {
    const api = setupApi({
      listNotifications: jest.fn(async () => ({ items, total: items.length, unread })),
      markNotificationRead: jest.fn(async () => undefined),
      markAllNotificationsRead: jest.fn(async () => ({ updated: unread })),
    });
    await renderWithQuery(<NotificationsScreen navigation={nav() as never} route={{} as never} />);
    await screen.findByText('Invoice paid');
    return api;
  };

  it('lists notifications with unread state and relative time', async () => {
    await open();
    expect(screen.getByText('Payment of $1,000.00 received for INV-0001.')).toBeTruthy();
    expect(screen.getAllByText('5 min ago').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Unread\. Invoice paid/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Unread\. Invoice viewed/)).toBeNull();
  });

  it('marks one as read and opens its invoice when tapped', async () => {
    const api = await open();
    await fireEvent.press(screen.getByText('Invoice paid'));
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(openTarget).toHaveBeenCalledWith({
      tab: 'InvoicesTab',
      screen: 'Invoice',
      params: { id: 'inv-1' },
    });
  });

  it('does not re-mark an already-read notification, but still opens it', async () => {
    const api = await open();
    await fireEvent.press(screen.getByText('Invoice viewed'));
    expect(api.markNotificationRead).not.toHaveBeenCalled();
    expect(openTarget).toHaveBeenCalledWith({
      tab: 'InvoicesTab',
      screen: 'Invoice',
      params: { id: 'inv-2' },
    });
  });

  it('marks everything as read', async () => {
    const api = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark all 1 as read' }));
    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalled());
  });

  it('shows an empty state and hides the mark-all button with nothing unread', async () => {
    setupApi({ listNotifications: jest.fn(async () => ({ items: [], total: 0, unread: 0 })) });
    await renderWithQuery(<NotificationsScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark all/ })).toBeNull();
  });

  it('shows a friendly error with retry', async () => {
    setupApi({
      listNotifications: jest.fn(async () => {
        throw { kind: 'network', name: 'ApiError', message: 'x' };
      }),
    });
    await renderWithQuery(<NotificationsScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
  });
});

describe('Timeline', () => {
  const now = new Date(2026, 9, 1, 15, 0); // Oct 1, 2026, local
  const at = (d: Date) => d.toISOString();
  const e = (id: string, type: string, d: Date, message: string | null = null) => ({
    id,
    type,
    message,
    createdAt: at(d),
  });

  it('shows time and message, grouped by day, in the order given', async () => {
    await renderWithQuery(
      <Timeline
        now={now}
        entries={[
          e('1', 'created', new Date(2026, 8, 30, 10, 0), 'Invoice created'),
          e('2', 'sent', new Date(2026, 9, 1, 10, 15), 'Sent to billing@acme.test'),
          e('3', 'viewed', new Date(2026, 9, 1, 11, 40), 'Invoice viewed by customer'),
          e('4', 'payment_received', new Date(2026, 9, 1, 13, 20), 'Payment of $1,250.00 received'),
          e('5', 'paid', new Date(2026, 9, 1, 13, 21), 'Invoice marked as paid'),
        ]}
      />,
    );
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getAllByText('Today')).toHaveLength(1); // one heading for all four entries
    expect(screen.getByText(formatTime(at(new Date(2026, 9, 1, 13, 20))))).toBeTruthy();
    expect(screen.getByText('Invoice marked as paid')).toBeTruthy();
  });

  it('falls back to a readable label for missing messages and unknown types', async () => {
    await renderWithQuery(
      <Timeline
        now={now}
        entries={[
          e('1', 'overdue', new Date(2026, 9, 1, 9, 0)),
          e('2', 'mystery', new Date(2026, 9, 1, 9, 5)),
        ]}
      />,
    );
    expect(screen.getByText('Invoice overdue')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();
  });
});

describe('time formatting', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  it('labels days relative to now', () => {
    expect(formatDayHeading(new Date(2026, 9, 1, 0, 5).toISOString(), now)).toBe('Today');
    expect(formatDayHeading(new Date(2026, 8, 30, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(formatDayHeading(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toMatch(
      /Sep 20, 2026/,
    );
  });
  it('describes elapsed time', () => {
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(timeAgo(ago(10_000), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2 d ago');
    expect(timeAgo(ago(30 * 86_400_000), now)).toMatch(/Sep/);
    expect(timeAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe('just now'); // clock skew
  });
});
