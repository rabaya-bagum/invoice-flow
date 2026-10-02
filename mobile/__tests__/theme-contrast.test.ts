import { contrastRatio } from '@invoiceflow/shared';
import { colors } from '../src/theme';
import { STATUS_COLORS, type Scheme } from '../src/theme/status-colors';

const AA = 4.5;
const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** The badge background: the colour at 10% opacity over the page. */
const tint = (fg: string, bg: string, a = 0x1a / 255) => {
  const f = channels(fg);
  const b = channels(bg);
  return `#${f
    .map((v, i) =>
      Math.round(v * a + (b[i] as number) * (1 - a))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

describe.each(['light', 'dark'] as Scheme[])('%s theme contrast (WCAG AA, 4.5:1)', (scheme) => {
  const c = colors[scheme];
  it.each([
    ['text', 'background'],
    ['text', 'surface'],
    ['muted', 'background'],
    ['muted', 'surface'],
    ['primary', 'background'],
    ['primary', 'surface'],
    ['danger', 'background'],
    ['danger', 'surface'],
    ['onPrimary', 'primary'],
    ['onPrimary', 'danger'],
  ] as const)('%s on %s', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.entries(STATUS_COLORS))('status "%s" badge text', (_key, pair) => {
    const color = pair[scheme];
    for (const base of [c.background, c.surface]) {
      expect(contrastRatio(color, tint(color, base))).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps the field border visible against the page (non-text, 3:1 is not required but 1.3:1 is)', () => {
    expect(contrastRatio(c.border, c.background)).toBeGreaterThan(1.3);
  });
});
