import {
  formatMoney,
  formatPercent,
  isSupportedCurrency,
  minorToDecimalString,
  parseMoney,
  parsePercent,
  productInputSchema,
  type CurrencyCode,
} from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useBusiness, useDeleteProduct, useProduct, useSaveProduct } from '../hooks/queries';
import { useFormFields } from '../hooks/useFormFields';
import { useSubmit } from '../hooks/useSubmit';
import type { MoreStackParams } from '../navigation/types';
import { ApiError } from '../services/api';
import { useTheme } from '../theme/useTheme';
import { friendlyMessage } from '../utils/errors';
import { fieldErrors } from '../validation/fields';

const EMPTY = {
  name: '',
  description: '',
  price: '',
  unit: '',
  taxRate: '',
  sku: '',
  category: '',
};

export function ProductFormScreen({
  route,
  navigation,
}: NativeStackScreenProps<MoreStackParams, 'ProductForm'>) {
  const id = route.params?.id;
  const c = useTheme();
  const business = useBusiness();
  const existing = useProduct(id);
  const save = useSaveProduct(id);
  const remove = useDeleteProduct();
  const { values, setValues, errors, setErrors, set } = useFormFields(EMPTY);
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useSubmit();

  const currency = business.data?.defaultCurrency;
  const code: CurrencyCode | null = currency && isSupportedCurrency(currency) ? currency : null;

  useEffect(() => {
    const p = existing.data;
    if (p && code) {
      setValues({
        name: p.name,
        description: p.description ?? '',
        price: minorToDecimalString(p.priceMinor, code),
        unit: p.unit,
        taxRate: p.taxRateBps ? formatPercent(p.taxRateBps) : '',
        sku: p.sku ?? '',
        category: p.category ?? '',
      });
      setIsActive(p.isActive);
    }
  }, [existing.data, code, setValues]);

  if (business.isPending || (id && existing.isPending)) return <LoadingState />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  if (id && existing.isError)
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  if (!code)
    return <ErrorState error={new Error('currency')} onRetry={() => void business.refetch()} />;

  const onSave = async () => {
    setFormError(null);
    const errs: Record<string, string> = {};
    let priceMinor: number | undefined;
    let taxRateBps = 0;
    try {
      priceMinor = parseMoney(values.price, code);
    } catch {
      errs.price = `Enter a valid price, e.g. 100.00 (${code})`;
    }
    if (values.taxRate.trim()) {
      try {
        taxRateBps = parsePercent(values.taxRate);
      } catch {
        errs.taxRate = 'Enter a percentage from 0 to 100, e.g. 13.5';
      }
    }
    const parsed = fieldErrors(productInputSchema, {
      name: values.name,
      description: values.description,
      priceMinor,
      unit: values.unit,
      taxRateBps,
      sku: values.sku,
      category: values.category,
      isActive,
    });
    const merged = { ...errs };
    for (const [k, v] of Object.entries(parsed.errors)) {
      const key = k === 'priceMinor' ? 'price' : k === 'taxRateBps' ? 'taxRate' : k;
      if (!merged[key]) merged[key] = v;
    }
    setErrors(merged);
    if (!parsed.data || Object.keys(errs).length) return;

    setBusy(true);
    try {
      await save.mutateAsync(parsed.data);
      navigation.goBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SKU_EXISTS')
        setErrors({ sku: 'That SKU is already used' });
      else setFormError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert('Delete product?', 'Existing invoices keep their line items.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void submit.run(async () => {
            await remove.mutateAsync(id as string);
            navigation.goBack();
          }),
      },
    ]);

  const field = (key: keyof typeof EMPTY, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={values[key]}
      onChangeText={set(key)}
      error={errors[key]}
      {...extra}
    />
  );

  return (
    <Screen centered={false}>
      {formError ? <Message kind="error">{formError}</Message> : null}
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {field('name', 'Name')}
      {field('description', 'Description', { multiline: true })}
      {field('price', `Price (${code})`, {
        keyboardType: 'decimal-pad',
        placeholder: formatMoney(10000, code),
      })}
      {field('unit', 'Unit', { placeholder: 'hour, day, item…', autoCapitalize: 'none' })}
      {field('taxRate', 'Tax rate (%)', { keyboardType: 'decimal-pad', placeholder: '0' })}
      {field('sku', 'SKU', { autoCapitalize: 'characters' })}
      {field('category', 'Category')}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 16 }}>Active (available on new invoices)</Text>
        <Switch value={isActive} onValueChange={setIsActive} accessibilityLabel="Active" />
      </View>
      <Button title={id ? 'Save changes' : 'Add'} onPress={onSave} loading={busy} />
      {id ? (
        <Button title="Delete" variant="danger" onPress={confirmDelete} disabled={busy} />
      ) : null}
    </Screen>
  );
}
