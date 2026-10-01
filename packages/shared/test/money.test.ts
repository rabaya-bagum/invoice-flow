import fc from 'fast-check';
import {
  allocate,
  formatMoney,
  formatQuantity,
  minorToDecimalString,
  parseMoney,
  parseQuantity,
  isSupportedCurrency,
  parsePercent,
  formatPercent,
  MoneyError,
} from '../src';

describe('parseMoney / minorToDecimalString', () => {
  it('parses without float error', () => {
    expect(parseMoney('67.78', 'USD')).toBe(6778);
    expect(parseMoney('0.1', 'USD')).toBe(10);
    expect(parseMoney('1,250.5', 'USD')).toBe(125050);
    expect(parseMoney('1000', 'JPY')).toBe(1000);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
  });

  it('rejects bad input and too many decimals', () => {
    expect(() => parseMoney('-1', 'USD')).toThrow(MoneyError);
    expect(() => parseMoney('abc', 'USD')).toThrow(MoneyError);
    expect(() => parseMoney('1.234', 'USD')).toThrow(MoneyError);
    expect(() => parseMoney('1.5', 'JPY')).toThrow(MoneyError);
  });

  it('round-trips for any safe amount and currency exponent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom('USD', 'JPY', 'KWD'),
        (minor, cur) => {
          const c = cur as 'USD' | 'JPY' | 'KWD';
          expect(parseMoney(minorToDecimalString(minor, c), c)).toBe(minor);
        },
      ),
    );
  });
});

describe('formatMoney', () => {
  it('formats using locale', () => {
    expect(formatMoney(125000, 'USD')).toBe('$1,250.00');
    expect(formatMoney(6778, 'USD')).toBe('$67.78');
    expect(formatMoney(1000, 'JPY')).toBe('¥1,000');
  });
});

describe('quantity', () => {
  it('parses and formats thousandths', () => {
    expect(parseQuantity('1.5')).toBe(1500);
    expect(parseQuantity('2')).toBe(2000);
    expect(parseQuantity('0.001')).toBe(1);
    expect(formatQuantity(1500)).toBe('1.5');
    expect(formatQuantity(2000)).toBe('2');
    expect(formatQuantity(100000)).toBe('100');
    expect(() => parseQuantity('-1')).toThrow(MoneyError);
    expect(() => parseQuantity('1.0001')).toThrow(MoneyError);
  });
});

describe('allocate', () => {
  it('always sums to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const parts = allocate(BigInt(total), weights.map(BigInt));
          const sum = parts.reduce((a, b) => a + b, 0n);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          expect(sum).toBe(weightSum === 0 ? 0n : BigInt(total));
        },
      ),
    );
  });

  it('splits 100 three ways as 34/33/33', () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
  });
});

describe('currency', () => {
  it('recognises ISO codes', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('usd')).toBe(false);
    expect(isSupportedCurrency('XXX')).toBe(false);
    expect(isSupportedCurrency('toString')).toBe(false);
  });
});

describe('percent', () => {
  it('converts to and from basis points', () => {
    expect(parsePercent('5')).toBe(500);
    expect(parsePercent('13.5')).toBe(1350);
    expect(parsePercent('0.25%')).toBe(25);
    expect(parsePercent('100')).toBe(10000);
    expect(formatPercent(500)).toBe('5');
    expect(formatPercent(1350)).toBe('13.5');
    expect(formatPercent(25)).toBe('0.25');
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(10000)).toBe('100');
  });
  it('rejects bad input', () => {
    for (const bad of ['-1', '100.01', '1.234', 'abc', ''])
      expect(() => parsePercent(bad)).toThrow(MoneyError);
  });
  it('round-trips every valid value', () => {
    for (let bps = 0; bps <= 10000; bps += 7) expect(parsePercent(formatPercent(bps))).toBe(bps);
  });
});
