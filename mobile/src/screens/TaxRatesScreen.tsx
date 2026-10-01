import { formatPercent, parsePercent, taxRateInputSchema } from '@invoiceflow/shared';
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useDeleteTaxRate, useSaveTaxRate, useTaxRates } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { fieldErrors } from '../validation/fields';

export function TaxRatesScreen() {
  const c = useTheme();
  const q = useTaxRates();
  const create = useSaveTaxRate();
  const remove = useDeleteTaxRate();
  const makeDefault = useSaveTaxRate();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useSubmit();

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const onAdd = async () => {
    const errs: Record<string, string> = {};
    let rateBps = 0;
    try {
      rateBps = parsePercent(rate);
    } catch {
      errs.rate = 'Enter a percentage from 0 to 100, e.g. 13.5';
    }
    const parsed = fieldErrors(taxRateInputSchema, { name, rateBps, isDefault });
    const merged = {
      ...errs,
      ...Object.fromEntries(Object.entries(parsed.errors).filter(([k]) => k !== 'rateBps')),
    };
    setErrors(merged);
    const data = parsed.data;
    if (!data || errs.rate) return;
    const ok = await submit.run(async () => {
      await create.mutateAsync(data);
      return true;
    });
    if (ok) {
      setName('');
      setRate('');
      setIsDefault(false);
    }
  };

  const options = (r: { id: string; name: string; rateBps: number; isDefault: boolean }) =>
    Alert.alert(r.name, `${formatPercent(r.rateBps)}%`, [
      ...(r.isDefault
        ? []
        : [
            {
              text: 'Make default',
              onPress: () =>
                void submit.run(() =>
                  makeDefault.mutateAsync({ name: r.name, rateBps: r.rateBps, isDefault: true }),
                ),
            },
          ]),
      {
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () => void submit.run(() => remove.mutateAsync(r.id)),
      },
      { text: 'Close', style: 'cancel' as const },
    ]);

  return (
    <Screen centered={false}>
      <Text style={{ color: c.muted }}>
        Named rates you can apply to invoice items. Existing invoices keep the rate they were
        created with.
      </Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      <View style={{ gap: spacing.sm }}>
        <TextField
          label="Tax name"
          value={name}
          onChangeText={setName}
          error={errors.name}
          placeholder="GST"
        />
        <TextField
          label="Rate (%)"
          value={rate}
          onChangeText={setRate}
          error={errors.rate}
          keyboardType="decimal-pad"
          placeholder="5"
        />
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: c.text, fontSize: 16 }}>Use as default</Text>
          <Switch
            value={isDefault}
            onValueChange={setIsDefault}
            accessibilityLabel="Use as default"
          />
        </View>
        <Button title="Add tax rate" onPress={onAdd} loading={submit.loading} />
      </View>
      <View>
        {q.data.map((r) => (
          <Row
            key={r.id}
            title={r.name}
            subtitle={r.isDefault ? 'Default' : null}
            right={`${formatPercent(r.rateBps)}%`}
            onPress={() => options(r)}
          />
        ))}
        {!q.data.length ? <Text style={{ color: c.muted }}>No tax rates yet.</Text> : null}
      </View>
    </Screen>
  );
}
