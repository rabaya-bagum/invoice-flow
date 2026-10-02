import {
  ACCENT_PRESETS,
  businessUpdateSchema,
  contrastRatio,
  DISPLAY_OPTION_KEYS,
  isReadableAccent,
  normalizeDisplayOptions,
  optionOn,
} from '../src';

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 1);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(contrastRatio('#000000', '#FFFFFF'), 5);
  });

  it('accepts every preset and the default accent as readable text on white', () => {
    for (const c of ACCENT_PRESETS)
      expect([c, contrastRatio(c, '#FFFFFF') >= 4.5]).toEqual([c, true]);
  });

  it('refuses pale and malformed colours', () => {
    for (const c of ['#FFFFFF', '#FFFF00', '#EEEEEE', '#FFD700', '#abc', 'red', '#12345G', '']) {
      expect([c, isReadableAccent(c)]).toEqual([c, false]);
    }
    expect(isReadableAccent('#2563eb')).toBe(true);
  });
});

describe('display options', () => {
  it('shows everything unless explicitly switched off', () => {
    expect(optionOn(undefined, 'showLogo')).toBe(true);
    expect(optionOn({}, 'showNotes')).toBe(true);
    expect(optionOn({ showNotes: true }, 'showNotes')).toBe(true);
    expect(optionOn({ showNotes: false }, 'showNotes')).toBe(false);
  });

  it('drops unknown keys and non-boolean values', () => {
    expect(
      normalizeDisplayOptions({ showLogo: false, showNotes: 'no', evil: true, showTerms: true }),
    ).toEqual({ showLogo: false, showTerms: true });
    expect(normalizeDisplayOptions(null)).toEqual({});
    expect(normalizeDisplayOptions('x')).toEqual({});
  });

  it('knows the six switches', () => {
    expect([...DISPLAY_OPTION_KEYS].sort()).toEqual(
      [
        'showLogo',
        'showNotes',
        'showPaymentInfo',
        'showSignature',
        'showTaxColumn',
        'showTerms',
      ].sort(),
    );
  });
});

describe('business update: appearance', () => {
  const parse = (v: object) => businessUpdateSchema.safeParse(v);
  it('accepts a template, readable accent and known options', () => {
    expect(
      parse({ template: 'modern', accentColor: '#0F766E', displayOptions: { showLogo: false } })
        .success,
    ).toBe(true);
  });
  it('rejects an unknown template, a pale accent and unknown or non-boolean options', () => {
    expect(parse({ template: 'fancy' }).success).toBe(false);
    expect(parse({ accentColor: '#FFFF99' }).success).toBe(false);
    expect(parse({ displayOptions: { showEverything: true } }).success).toBe(false);
    expect(parse({ displayOptions: { showLogo: 'yes' } }).success).toBe(false);
  });
});
