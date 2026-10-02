import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { OfflineProvider } from '../src/offline/OfflineProvider';
import { useOffline, type OfflineValue } from '../src/offline/context';
import * as storage from '../src/offline/storage';
import * as vault from '../src/offline/vault';
import { ApiError } from '../src/services/api';
import { useAuth } from '../src/store/auth';
import { CUSTOMER_ID } from '../test-utils';

jest.mock('../src/store/auth');

let off: OfflineValue;
function Probe() {
  off = useOffline();
  return <Text>{`ops:${off.ops.length}`}</Text>;
}

describe('offline drafts on web', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps drafts in memory only: no files and no encryption key are touched', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const fileStore = jest.spyOn(storage, 'createFileStore');
    const secureVault = jest.spyOn(vault, 'createSecureStoreVault');
    (useAuth as jest.Mock).mockReturnValue({
      api: {
        listCustomers: jest.fn(),
        listProducts: jest.fn(),
        createInvoice: jest.fn().mockRejectedValue(new ApiError('network')),
      },
      status: 'signedIn',
      session: { user: { id: 'user-1' } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={client}>
        <OfflineProvider>
          <Probe />
        </OfflineProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(off.available).toBe(true));
    await act(async () => {
      await off.saveDraft({
        invoiceId: 'web-1',
        isNew: true,
        payload: {
          customerId: CUSTOMER_ID,
          number: null,
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          currency: 'USD',
          taxInclusive: false,
          discount: null,
          feesMinor: 0,
          notes: null,
          terms: null,
          items: [],
        } as never,
        baseVersion: null,
        summary: { customerName: 'Acme', currency: 'USD', totalMinor: 0, number: null },
      });
    });
    expect(screen.getByText('ops:1')).toBeTruthy();
    expect(fileStore).not.toHaveBeenCalled();
    expect(secureVault).not.toHaveBeenCalled();
  });
});
