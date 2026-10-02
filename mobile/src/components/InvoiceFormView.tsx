import { formatPercent, isSupportedCurrency, minorToDecimalString } from '@invoiceflow/shared';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useBusiness, useSaveEstimate, useSaveInvoice, useTaxRates } from '../hooks/queries';
import type { Product } from '../models';
import { useOffline } from '../offline/context';
import { newInvoiceId } from '../offline/ids';
import { ApiError } from '../services/api';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { classifyError, friendlyMessage } from '../utils/errors';
import {
  buildInvoicePayload,
  emptyLine,
  previewTotals,
  type InvoiceForm,
  type LineForm,
} from '../utils/invoice-form';
import { rowsFromTotals } from '../utils/totals-rows';
import { Button } from './Button';
import { ChipRow } from './ChipRow';
import { DateField } from './DateField';
import { Message } from './Message';
import { CustomerPicker, ProductPicker } from './Pickers';
import { TextField } from './TextField';
import { TotalsCard } from './TotalsCard';

interface Props {
  initial: InvoiceForm;
  invoiceId?: string;
  onSaved: (saved: { id: string; queued?: boolean }) => void;
  /**
   * Drafts can be saved with no connection. `isNew`: not on the server yet. `baseVersion`: the server
   * version this edit started from. `local`: the draft already lives in the offline queue, so saving
   * goes through the queue (and uploads straight away when online).
   */
  offline?: { isNew: boolean; baseVersion: number | null; local?: boolean };
  /** Estimates share this form: "Valid until" replaces the due date and a different endpoint is used. */
  kind?: 'invoice' | 'estimate';
}

export function InvoiceFormView({
  initial,
  invoiceId,
  onSaved,
  kind = 'invoice',
  offline: offlineMode,
}: Props) {
  const estimate = kind === 'estimate';
  const c = useTheme();
  const business = useBusiness();
  const taxRates = useTaxRates();
  const saveInvoice = useSaveInvoice(invoiceId);
  const saveEstimate = useSaveEstimate(invoiceId);
  const off = useOffline();
  // A new invoice gets its id up front, so a retry after a dropped connection can never create two.
  const newId = useRef(invoiceId ?? newInvoiceId());
  const [form, setForm] = useState<InvoiceForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [pickProduct, setPickProduct] = useState(false);

  const set = <K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setLine = (key: string, patch: Partial<LineForm>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const preview = useMemo(() => previewTotals(form), [form]);
  const cur = form.currency.trim().toUpperCase();
  const defaultTaxes = (taxRates.data ?? []).find((r) => r.isDefault);

  const toggleTax = (line: LineForm, tax: { name: string; rateBps: number }) => {
    const has = line.taxes.some((t) => t.name === tax.name);
    setLine(line.key, {
      taxes: has ? line.taxes.filter((t) => t.name !== tax.name) : [...line.taxes, tax],
    });
  };

  const addProduct = (p: Product) => {
    setPickProduct(false);
    const sameCurrency = business.data?.defaultCurrency === cur;
    const rate = (taxRates.data ?? []).find((r) => r.rateBps === p.taxRateBps);
    const taxes = p.taxRateBps
      ? [
          rate
            ? { name: rate.name, rateBps: rate.rateBps }
            : { name: `Tax ${formatPercent(p.taxRateBps)}%`, rateBps: p.taxRateBps },
        ]
      : [];
    const line: LineForm = {
      ...emptyLine(taxes),
      productId: p.id,
      description: p.description ? `${p.name} - ${p.description}` : p.name,
      // Product prices are in the business currency; only prefill when currencies match.
      unitPrice:
        sameCurrency && isSupportedCurrency(cur) ? minorToDecimalString(p.priceMinor, cur) : '',
    };
    setForm((f) => ({
      ...f,
      // Replace the untouched starter line instead of leaving an empty row behind.
      lines: [...f.lines.filter((l) => l.description || l.unitPrice), line],
    }));
  };

  const onSave = async () => {
    setFormError(null);
    const { payload, errors: e } = buildInvoicePayload(form);
    setErrors(e);
    if (!payload) return;
    setSaving(true);
    try {
      const id = newId.current;
      const content = { ...payload, version: undefined };
      const queueIt = async () => {
        await off.saveDraft({
          invoiceId: id,
          kind,
          isNew: offlineMode?.isNew ?? !invoiceId,
          payload: content,
          baseVersion: offlineMode?.baseVersion ?? payload.version ?? null,
          summary: {
            customerName: form.customerName,
            currency: cur,
            totalMinor: preview && 'totals' in preview ? preview.totals.total : 0,
            number: payload.number,
          },
        });
        onSaved({ id, queued: true });
      };
      // The server call: invoices and estimates differ only in the date field's name and endpoint.
      const send = async () => {
        if (estimate) {
          const { dueDate, ...rest } = payload;
          return saveEstimate.mutateAsync(
            invoiceId ? { ...rest, expiryDate: dueDate } : { ...rest, expiryDate: dueDate, id },
          );
        }
        return saveInvoice.mutateAsync(invoiceId ? payload : { ...payload, id });
      };
      if (off.available && offlineMode?.local) {
        // Already queued: keep the queue as the source of truth and try to upload right away.
        await queueIt();
        void off.syncNow();
      } else {
        try {
          onSaved(await send());
        } catch (err) {
          // No connection (or a timeout that may have reached the server): keep the draft safe on
          // the device. The id makes the later upload idempotent.
          if (off.available && offlineMode && classifyError(err) === 'network') await queueIt();
          else throw err;
        }
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'NUMBER_EXISTS') setErrors({ number: friendlyMessage(err) });
      else if (code === 'INVALID_CUSTOMER') setErrors({ customerId: friendlyMessage(err) });
      else setFormError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {formError ? <Message kind="error">{formError}</Message> : null}

      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>Customer</Text>
        <Button
          title={form.customerName || 'Choose customer'}
          variant="secondary"
          onPress={() => setPickCustomer(true)}
        />
        {errors.customerId ? (
          <Text style={{ color: c.danger, fontSize: 13 }}>{errors.customerId}</Text>
        ) : null}
      </View>

      <TextField
        label={estimate ? 'Estimate number' : 'Invoice number'}
        value={form.number}
        onChangeText={(v) => set('number', v)}
        error={errors.number}
        placeholder="Automatic"
        autoCapitalize="characters"
      />
      <DateField
        label="Issue date"
        value={form.issueDate}
        onChange={(v) => set('issueDate', v)}
        error={errors.issueDate}
      />
      <DateField
        label={estimate ? 'Valid until' : 'Due date'}
        value={form.dueDate}
        onChange={(v) => set('dueDate', v)}
        error={errors.dueDate}
      />
      {form.dueDate < form.issueDate ? (
        <Message kind="info">{`The ${estimate ? 'expiry' : 'due'} date is before the issue date. You can still save.`}</Message>
      ) : null}
      <TextField
        label="Currency (ISO code)"
        value={form.currency}
        onChangeText={(v) => set('currency', v.toUpperCase())}
        error={errors.currency}
        autoCapitalize="characters"
        maxLength={3}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>Prices include tax</Text>
        <Switch
          value={form.taxInclusive}
          onValueChange={(v) => set('taxInclusive', v)}
          accessibilityLabel="Prices include tax"
        />
      </View>

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Items</Text>
      {errors.items ? <Message kind="error">{errors.items}</Message> : null}
      {form.lines.map((line, i) => {
        const options = [
          ...(taxRates.data ?? []).map((r) => ({ name: r.name, rateBps: r.rateBps })),
          ...line.taxes.filter((t) => !(taxRates.data ?? []).some((r) => r.name === t.name)),
        ];
        return (
          <View
            key={line.key}
            style={{
              gap: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: c.border,
              paddingTop: spacing.md,
            }}
          >
            <TextField
              label={`Item ${i + 1} description`}
              value={line.description}
              onChangeText={(v) => setLine(line.key, { description: v })}
              error={errors[`lines.${i}.description`]}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={`Item ${i + 1} quantity`}
                  value={line.quantity}
                  onChangeText={(v) => setLine(line.key, { quantity: v })}
                  error={errors[`lines.${i}.quantity`]}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label={`Item ${i + 1} unit price`}
                  value={line.unitPrice}
                  onChangeText={(v) => setLine(line.key, { unitPrice: v })}
                  error={errors[`lines.${i}.unitPrice`]}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            {options.length ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: c.muted, fontSize: 13 }}>Tax</Text>
                <ChipRow
                  label={`Item ${i + 1} taxes`}
                  options={options.map((o) => ({
                    value: o.name,
                    label: `${o.name} ${formatPercent(o.rateBps)}%`,
                  }))}
                  value={''}
                  onChange={(name) => {
                    const t = options.find((o) => o.name === name);
                    if (t) toggleTax(line, t);
                  }}
                  multiSelected={line.taxes.map((t) => t.name)}
                />
              </View>
            ) : null}
            {form.lines.length > 1 ? (
              <Pressable
                onPress={() =>
                  setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== line.key) }))
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove item ${i + 1}`}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: c.danger, fontWeight: '600' }}>Remove item</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Button
        title="Add item"
        variant="secondary"
        onPress={() =>
          setForm((f) => ({
            ...f,
            lines: [
              ...f.lines,
              emptyLine(
                defaultTaxes
                  ? [{ name: defaultTaxes.name, rateBps: defaultTaxes.rateBps }]
                  : (f.lines[0]?.taxes ?? []),
              ),
            ],
          }))
        }
      />
      <Button title="Add from catalog" variant="secondary" onPress={() => setPickProduct(true)} />

      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Discount and fees</Text>
      <ChipRow
        label="Discount type"
        options={[
          { value: 'none', label: 'No discount' },
          { value: 'percent', label: 'Percent' },
          { value: 'fixed', label: 'Fixed amount' },
        ]}
        value={form.discountType}
        onChange={(v) => set('discountType', v)}
      />
      {form.discountType !== 'none' ? (
        <TextField
          label={form.discountType === 'percent' ? 'Discount (%)' : `Discount amount (${cur})`}
          value={form.discountValue}
          onChangeText={(v) => set('discountValue', v)}
          error={errors.discount}
          keyboardType="decimal-pad"
        />
      ) : null}
      <TextField
        label={`Fees (${cur})`}
        value={form.fees}
        onChangeText={(v) => set('fees', v)}
        error={errors.fees}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />

      {preview && 'totals' in preview ? (
        <TotalsCard rows={rowsFromTotals(preview.totals, preview.currency, form.taxInclusive)} />
      ) : preview && 'error' in preview ? (
        <Message kind="error">{preview.error}</Message>
      ) : null}

      <TextField label="Notes" value={form.notes} onChangeText={(v) => set('notes', v)} multiline />
      <TextField
        label="Terms and conditions"
        value={form.terms}
        onChangeText={(v) => set('terms', v)}
        multiline
      />

      <Button
        title={invoiceId ? 'Save changes' : estimate ? 'Create estimate' : 'Create invoice'}
        onPress={onSave}
        loading={saving}
      />

      <CustomerPicker
        visible={pickCustomer}
        onClose={() => setPickCustomer(false)}
        onPick={(cust) => {
          setForm((f) => ({
            ...f,
            customerId: cust.id,
            customerName:
              cust.companyName || [cust.firstName, cust.lastName].filter(Boolean).join(' '),
          }));
          setPickCustomer(false);
        }}
      />
      <ProductPicker
        visible={pickProduct}
        onClose={() => setPickProduct(false)}
        onPick={addProduct}
      />
    </View>
  );
}
