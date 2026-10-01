import { parseQuery } from '../src/utils/url';

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
