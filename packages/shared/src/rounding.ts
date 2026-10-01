import { MoneyError } from './errors';

/** Round half up for non-negative operands: round(a * b / d). All bigint, no floats. */
export function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new MoneyError('INVALID_INPUT', 'Divisor must be positive');
  if (a < 0n || b < 0n) throw new MoneyError('INVALID_INPUT', 'Operands must be non-negative');
  return (a * b * 2n + d) / (2n * d);
}

export function toMinor(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('INVALID_AMOUNT', 'Amount exceeds safe integer range');
  }
  return Number(value);
}

export function assertMinor(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError('INVALID_AMOUNT', `${label} must be a non-negative integer (minor units)`);
  }
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total`
 * (largest-remainder method; ties go to the earliest index).
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n) throw new MoneyError('INVALID_INPUT', 'Cannot allocate a negative total');
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0) return [];
  if (sum === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left <= 0n) break;
    parts[i] = (parts[i] as bigint) + 1n;
    left -= 1n;
  }
  return parts;
}
