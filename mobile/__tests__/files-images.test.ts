import { ApiError, createApiClient } from '../src/services/api';
import { bytesToBase64 } from '../src/utils/base64';
import { prepareImage } from '../src/utils/prepare-image';

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async (_uri: string, _a: unknown, o: { format: string }) => ({
    uri: `file:///out.${o.format}`,
  })),
}));

const ref = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const utf8 = (s: string) =>
  Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));

describe('bytesToBase64', () => {
  it.each(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'Hello, 世界!'])(
    'matches a reference encoder for %p',
    (s) => {
      const bytes = utf8(s);
      expect(bytesToBase64(bytes)).toBe(ref(bytes));
    },
  );
  it('handles all byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(ref(all));
  });
});

describe('prepareImage', () => {
  it('keeps a PNG when it is small enough', async () => {
    expect(await prepareImage('file:///in.heic', async () => 100_000)).toEqual({
      uri: 'file:///out.png',
      contentType: 'image/png',
    });
  });
  it('falls back to JPEG when the PNG is too large', async () => {
    expect(await prepareImage('file:///in.jpg', async () => 5_000_000)).toEqual({
      uri: 'file:///out.jpeg',
      contentType: 'image/jpeg',
    });
  });
});

describe('api client: documents', () => {
  const res = (status: number, body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers });
  function client(fetchImpl: jest.Mock) {
    return createApiClient({
      baseUrl: 'http://api',
      getToken: async () => 't',
      refreshToken: async () => null,
      onSessionExpired: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  it('sends an invoice email', async () => {
    const f = jest.fn(async () =>
      res(200, JSON.stringify({ sentTo: 'a@b.co' }), { 'content-type': 'application/json' }),
    );
    await client(f).sendInvoice('i1', { to: 'a@b.co', subject: null, message: null });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/invoices/i1/send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ to: 'a@b.co', subject: null, message: null });
  });

  it('downloads a PDF as bytes with POST', async () => {
    const f = jest.fn(async () =>
      res(200, new Uint8Array([0x25, 0x50, 0x44, 0x46]) as unknown as BodyInit),
    );
    const bytes = await client(f).downloadInvoicePdf('i1');
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('POST');
  });

  it('uploads an image with its own content type (not JSON) and the bearer token', async () => {
    const f = jest.fn(async () => res(204, null));
    await client(f).uploadBusinessAsset('logo', new Blob(['x']), 'image/png');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/business/logo');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('returns a data URI for an existing image and null when there is none', async () => {
    const png = new Uint8Array([1, 2, 3]);
    const ok = jest.fn(async () =>
      res(200, png as unknown as BodyInit, { 'content-type': 'image/png' }),
    );
    expect(await client(ok).getBusinessAssetUri('logo')).toBe(`data:image/png;base64,${ref(png)}`);
    const missing = jest.fn(async () =>
      res(404, JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
        'content-type': 'application/json',
      }),
    );
    expect(await client(missing).getBusinessAssetUri('signature')).toBeNull();
    const broken = jest.fn(async () => res(500, '{}'));
    await expect(client(broken).getBusinessAssetUri('logo')).rejects.toBeInstanceOf(ApiError);
  });
});
