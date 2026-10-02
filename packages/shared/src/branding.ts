import { z } from 'zod';

/** Invoice/estimate layouts. The PDF, the in-app preview and the customer pages all honour these. */
export const TEMPLATES = ['classic', 'modern', 'minimal'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export const TEMPLATE_INFO: Record<TemplateName, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'Tinted table header, accent title.' },
  modern: { label: 'Modern', description: 'Bold colour band across the top.' },
  minimal: { label: 'Minimal', description: 'Plain lines, no colour fills.' },
};

/** Parts of a document the owner can switch off. Everything is shown unless set to false. */
export const DISPLAY_OPTIONS = [
  { key: 'showLogo', label: 'Logo' },
  { key: 'showTaxColumn', label: 'Tax column' },
  { key: 'showPaymentInfo', label: 'Payment information' },
  { key: 'showNotes', label: 'Notes' },
  { key: 'showTerms', label: 'Terms and conditions' },
  { key: 'showSignature', label: 'Signature' },
] as const;
export type DisplayOptionKey = (typeof DISPLAY_OPTIONS)[number]['key'];
export const DISPLAY_OPTION_KEYS = DISPLAY_OPTIONS.map((o) => o.key) as DisplayOptionKey[];

export type DisplayOptions = Partial<Record<DisplayOptionKey, boolean>>;

/** True unless the owner explicitly switched the option off. */
export const optionOn = (opts: Record<string, boolean> | undefined | null, key: DisplayOptionKey) =>
  opts?.[key] !== false;

/** Only known keys with boolean values survive; anything else stored or sent is dropped. */
export function normalizeDisplayOptions(input: unknown): DisplayOptions {
  const out: DisplayOptions = {};
  if (input && typeof input === 'object') {
    for (const k of DISPLAY_OPTION_KEYS) {
      const v = (input as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export const displayOptionsSchema = z
  .object(
    Object.fromEntries(DISPLAY_OPTION_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      DisplayOptionKey,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

/** Ready-made accent colours, all readable as text on white (contrast >= 4.5:1). */
export const ACCENT_PRESETS = [
  '#2563EB',
  '#0F766E',
  '#15803D',
  '#B45309',
  '#B91C1C',
  '#BE185D',
  '#7C3AED',
  '#334155',
] as const;

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of "#RRGGBB". */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two "#RRGGBB" colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent is used as text on white (titles, table headings) and as a background under white text
 * (the "modern" band). Both need real contrast, so near-white and pastel colours are refused.
 */
export const MIN_ACCENT_CONTRAST = 3;
export function isReadableAccent(hex: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(hex) && contrastRatio(hex, '#FFFFFF') >= MIN_ACCENT_CONTRAST;
}

export const accentColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #2563EB')
  .refine(isReadableAccent, 'That colour is too light to read on white. Pick a darker one.');
