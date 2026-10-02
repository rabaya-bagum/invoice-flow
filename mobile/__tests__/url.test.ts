import { parseQuery, resolveDevApiUrl } from '../src/utils/url';

describe('parseQuery', () => {
  it('parses params and ignores the fragment', () => {
    expect(parseQuery('invoiceflow://auth/callback?code=abc%20d&x=1#frag=2')).toEqual({
      code: 'abc d',
      x: '1',
    });
  });
  it('handles no query and malformed pairs', () => {
    expect(parseQuery('invoiceflow://auth/callback')).toEqual({});
    expect(parseQuery('a://b?%E0%A4%A&ok=1')).toEqual({ ok: '1' });
  });
});

describe('resolveDevApiUrl', () => {
  it('points localhost at the dev machine serving the bundle', () => {
    expect(resolveDevApiUrl('http://localhost:4000', '10.0.0.193:8081')).toBe(
      'http://10.0.0.193:4000',
    );
    expect(resolveDevApiUrl('http://127.0.0.1:4000/api', '10.0.0.193:8081')).toBe(
      'http://10.0.0.193:4000/api',
    );
  });

  it('leaves other hosts, and missing hostUri, alone', () => {
    expect(resolveDevApiUrl('https://api.example.com', '10.0.0.193:8081')).toBe(
      'https://api.example.com',
    );
    expect(resolveDevApiUrl('http://localhost.example.com', '10.0.0.193:8081')).toBe(
      'http://localhost.example.com',
    );
    expect(resolveDevApiUrl('http://localhost:4000', undefined)).toBe('http://localhost:4000');
  });
});
