import {
  ACCENT_PRESETS,
  accentColorSchema,
  DISPLAY_OPTIONS,
  DISPLAY_OPTION_KEYS,
  optionOn,
  TEMPLATES,
  TEMPLATE_INFO,
  type DisplayOptionKey,
  type TemplateName,
} from '@invoiceflow/shared';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useBusiness, useUpdateBusiness } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import type { BusinessProfile, Invoice } from '../models';
import { radius, spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

const DEFAULT_ACCENT = '#2563EB';

/** Made-up document so the preview shows every part; it is never saved or sent anywhere. */
const SAMPLE: Invoice = {
  id: 'sample',
  number: 'INV-0001',
  status: 'sent',
  displayStatus: 'sent',
  customerId: 'sample',
  customerName: 'Sample Customer Ltd',
  customerEmail: 'billing@sample.test',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  taxInclusive: false,
  discountType: null,
  discountValue: null,
  feesMinor: 0,
  subtotalMinor: 150_000,
  discountTotalMinor: 0,
  taxTotalMinor: 7_500,
  totalMinor: 157_500,
  amountPaidMinor: 0,
  balanceDueMinor: 157_500,
  notes: 'Thank you for your business.',
  terms: 'Payment is due within 14 days of the invoice date.',
  version: 1,
  sentAt: null,
  updatedAt: '',
  warnings: [],
  editable: false,
  taxBreakdown: [{ name: 'GST', rateBps: 500, taxableAmount: 150_000, tax: 7_500 }],
  items: [
    {
      id: 's1',
      productId: null,
      description: 'Web Development',
      quantityMilli: 10_000,
      unitPriceMinor: 10_000,
      taxes: [{ name: 'GST', rateBps: 500 }],
      lineTotalMinor: 100_000,
      discountMinor: 0,
      taxMinor: 5_000,
    },
    {
      id: 's2',
      productId: null,
      description: 'Consulting',
      quantityMilli: 2_000,
      unitPriceMinor: 25_000,
      taxes: [{ name: 'GST', rateBps: 500 }],
      lineTotalMinor: 50_000,
      discountMinor: 0,
      taxMinor: 2_500,
    },
  ],
};

export function AppearanceScreen() {
  const q = useBusiness();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Editor business={q.data} />;
}

function Editor({ business }: { business: BusinessProfile }) {
  const c = useTheme();
  const update = useUpdateBusiness();
  const submit = useSubmit();
  const initialTemplate = (TEMPLATES as readonly string[]).includes(business.template)
    ? (business.template as TemplateName)
    : 'classic';
  const initialOptions = useMemo(
    () =>
      Object.fromEntries(
        DISPLAY_OPTION_KEYS.map((k) => [k, optionOn(business.displayOptions, k)]),
      ) as Record<DisplayOptionKey, boolean>,
    [business.displayOptions],
  );
  const [template, setTemplate] = useState<TemplateName>(initialTemplate);
  const [accent, setAccent] = useState(business.accentColor.toUpperCase());
  const [options, setOptions] = useState(initialOptions);
  const [saved, setSaved] = useState(false);

  // Follow the server copy after a save (or when it changes elsewhere).
  useEffect(() => {
    setTemplate(initialTemplate);
    setAccent(business.accentColor.toUpperCase());
    setOptions(initialOptions);
  }, [initialTemplate, business.accentColor, initialOptions]);

  const parsed = accentColorSchema.safeParse(accent.trim());
  const accentError = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const validAccent = parsed.success ? parsed.data.toUpperCase() : business.accentColor;

  const dirty =
    template !== initialTemplate ||
    validAccent.toUpperCase() !== business.accentColor.toUpperCase() ||
    DISPLAY_OPTION_KEYS.some((k) => options[k] !== initialOptions[k]);

  const preview: BusinessProfile = {
    ...business,
    template,
    accentColor: validAccent,
    displayOptions: options,
    paymentInstructions:
      business.paymentInstructions ?? 'Payment instructions from your profile appear here.',
  };

  const onSave = async () => {
    if (!parsed.success) return;
    setSaved(false);
    const out = await submit.run(() =>
      update.mutateAsync({
        template,
        accentColor: parsed.data.toUpperCase(),
        displayOptions: options,
      }),
    );
    if (out) setSaved(true);
  };

  const reset = () => {
    setSaved(false);
    setTemplate('classic');
    setAccent(DEFAULT_ACCENT);
    setOptions(Object.fromEntries(DISPLAY_OPTION_KEYS.map((k) => [k, true])) as typeof options);
  };

  return (
    <Screen centered={false}>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {saved && !dirty ? (
        <Message kind="info">
          Saved. Invoices, estimates, PDFs and customer pages use this look.
        </Message>
      ) : null}

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Layout</Text>
      <View style={{ gap: spacing.sm }}>
        {TEMPLATES.map((t) => {
          const selected = template === t;
          return (
            <Pressable
              key={t}
              onPress={() => {
                setSaved(false);
                setTemplate(t);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${TEMPLATE_INFO[t].label} layout`}
              style={{
                padding: spacing.md,
                borderRadius: radius.card,
                borderWidth: 2,
                borderColor: selected ? c.primary : c.border,
                backgroundColor: c.surface,
              }}
            >
              <Text style={{ color: c.text, fontWeight: '700' }}>{TEMPLATE_INFO[t].label}</Text>
              <Text style={{ color: c.muted }}>{TEMPLATE_INFO[t].description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Accent colour</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {ACCENT_PRESETS.map((hex) => {
          const selected = validAccent.toUpperCase() === hex;
          return (
            <Pressable
              key={hex}
              onPress={() => {
                setSaved(false);
                setAccent(hex);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Accent colour ${hex}`}
              accessibilityState={{ selected }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: hex,
                borderWidth: selected ? 4 : 1,
                borderColor: selected ? c.text : c.border,
              }}
            />
          );
        })}
      </View>
      <TextField
        label="Custom colour (hex)"
        value={accent}
        onChangeText={(v) => {
          setSaved(false);
          setAccent(v.startsWith('#') || v === '' ? v : `#${v}`);
        }}
        error={accentError}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
      />

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Show on documents</Text>
      <View style={{ gap: spacing.xs }}>
        {DISPLAY_OPTIONS.map((o) => (
          <View
            key={o.key}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              minHeight: 48,
            }}
          >
            <Text style={{ color: c.text }}>{o.label}</Text>
            <Switch
              value={options[o.key]}
              onValueChange={(v) => {
                setSaved(false);
                setOptions((cur) => ({ ...cur, [o.key]: v }));
              }}
              accessibilityLabel={o.label}
            />
          </View>
        ))}
      </View>

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Preview</Text>
      <Text style={{ color: c.muted }}>A sample invoice with your business details.</Text>
      <InvoiceDocument invoice={SAMPLE} business={preview} />

      <Button
        title="Save appearance"
        onPress={onSave}
        loading={submit.loading}
        disabled={!dirty || !parsed.success}
      />
      <Button title="Reset to defaults" variant="secondary" onPress={reset} />
    </Screen>
  );
}
