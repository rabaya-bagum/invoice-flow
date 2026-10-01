import { businessUpdateSchema, formatPercent, parsePercent } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { ImageSetting } from '../components/ImageSetting';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useBusiness, useUpdateBusiness } from '../hooks/queries';
import { useFormFields } from '../hooks/useFormFields';
import { useSubmit } from '../hooks/useSubmit';
import type { MoreStackParams } from '../navigation/types';
import { useTheme } from '../theme/useTheme';
import { fieldErrors } from '../validation/fields';

const EMPTY = {
  name: '',
  ownerName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  country: '',
  website: '',
  taxNumber: '',
  paymentInstructions: '',
  defaultCurrency: 'USD',
  defaultTaxRate: '',
  defaultPaymentTermsDays: '14',
  timezone: 'UTC',
};

export function BusinessProfileScreen({
  navigation,
}: NativeStackScreenProps<MoreStackParams, 'BusinessProfile'>) {
  const c = useTheme();
  const q = useBusiness();
  const update = useUpdateBusiness();
  const { values, setValues, errors, setErrors, set } = useFormFields(EMPTY);
  const [saved, setSaved] = useState(false);
  const submit = useSubmit();

  useEffect(() => {
    const b = q.data;
    if (!b) return;
    setValues({
      name: b.name,
      ownerName: b.ownerName ?? '',
      email: b.email ?? '',
      phone: b.phone ?? '',
      addressLine1: b.addressLine1 ?? '',
      addressLine2: b.addressLine2 ?? '',
      city: b.city ?? '',
      province: b.province ?? '',
      postalCode: b.postalCode ?? '',
      country: b.country ?? '',
      website: b.website ?? '',
      taxNumber: b.taxNumber ?? '',
      paymentInstructions: b.paymentInstructions ?? '',
      defaultCurrency: b.defaultCurrency,
      defaultTaxRate: b.defaultTaxRateBps ? formatPercent(b.defaultTaxRateBps) : '',
      defaultPaymentTermsDays: String(b.defaultPaymentTermsDays),
      timezone: b.timezone,
    });
  }, [q.data, setValues]);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const onSave = async () => {
    setSaved(false);
    const errs: Record<string, string> = {};
    let defaultTaxRateBps = 0;
    if (values.defaultTaxRate.trim()) {
      try {
        defaultTaxRateBps = parsePercent(values.defaultTaxRate);
      } catch {
        errs.defaultTaxRate = 'Enter a percentage from 0 to 100';
      }
    }
    const terms = Number(values.defaultPaymentTermsDays);
    if (!Number.isInteger(terms)) errs.defaultPaymentTermsDays = 'Enter a whole number of days';

    // Free-text fields go straight through; the numeric ones are converted above.
    const NUMERIC = ['defaultTaxRate', 'defaultPaymentTermsDays', 'defaultCurrency'];
    const text = Object.fromEntries(Object.entries(values).filter(([k]) => !NUMERIC.includes(k)));
    const parsed = fieldErrors(businessUpdateSchema, {
      ...text,
      defaultCurrency: values.defaultCurrency.trim().toUpperCase(),
      defaultTaxRateBps,
      defaultPaymentTermsDays: terms,
    });
    const merged = { ...errs };
    for (const [k, v] of Object.entries(parsed.errors)) {
      const key = k === 'defaultTaxRateBps' ? 'defaultTaxRate' : k;
      if (!merged[key]) merged[key] = v;
    }
    setErrors(merged);
    const data = parsed.data;
    if (!data || Object.keys(errs).length) return;
    const ok = await submit.run(async () => {
      await update.mutateAsync(data);
      return true;
    });
    if (ok) setSaved(true);
  };

  const field = (key: keyof typeof EMPTY, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={values[key]}
      onChangeText={(v) => {
        setSaved(false);
        set(key)(v);
      }}
      error={errors[key]}
      {...extra}
    />
  );

  return (
    <Screen centered={false}>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {saved ? <Message kind="info">Business profile saved.</Message> : null}
      {field('name', 'Business name')}
      {field('ownerName', 'Owner name')}
      {field('email', 'Business email', { autoCapitalize: 'none', keyboardType: 'email-address' })}
      {field('phone', 'Phone', { keyboardType: 'phone-pad' })}
      {field('addressLine1', 'Address')}
      {field('addressLine2', 'Address line 2')}
      {field('city', 'City')}
      {field('province', 'Province / State')}
      {field('postalCode', 'Postal / ZIP code', { autoCapitalize: 'characters' })}
      {field('country', 'Country')}
      {field('website', 'Website', {
        autoCapitalize: 'none',
        keyboardType: 'url',
        placeholder: 'https://',
      })}
      {field('taxNumber', 'Tax number')}
      {field('paymentInstructions', 'Payment instructions', {
        multiline: true,
        placeholder: 'Bank details, e-transfer address…',
      })}
      <ImageSetting kind="logo" label="Logo" path={q.data.logoPath} />
      <ImageSetting kind="signature" label="Signature" path={q.data.signaturePath} />
      <Text style={{ color: c.muted, fontSize: 13 }}>
        Defaults for new invoices. Changing the currency does not change existing invoices.
      </Text>
      {field('defaultCurrency', 'Default currency (ISO code)', {
        autoCapitalize: 'characters',
        maxLength: 3,
      })}
      {field('defaultTaxRate', 'Default tax rate (%)', {
        keyboardType: 'decimal-pad',
        placeholder: '0',
      })}
      {field('defaultPaymentTermsDays', 'Payment terms (days)', { keyboardType: 'number-pad' })}
      {field('timezone', 'Timezone', { autoCapitalize: 'none', placeholder: 'America/Toronto' })}
      <Button title="Save" onPress={onSave} loading={submit.loading} />
      <Button title="Back" variant="link" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
