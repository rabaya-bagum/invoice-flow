import { defaultEstimateEmail, sendInvoiceInputSchema } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useBusiness, useEstimate, useSendEstimate } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import type { Estimate } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { useTheme } from '../theme/useTheme';
import { fieldErrors } from '../validation/fields';

export function SendEstimateScreen({
  route,
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'SendEstimate'>) {
  const { id } = route.params;
  const estimate = useEstimate(id);
  const business = useBusiness();
  if (estimate.isPending || business.isPending) return <LoadingState />;
  if (estimate.isError)
    return <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  return (
    <SendForm
      estimate={estimate.data}
      businessName={business.data.name}
      onDone={() => navigation.goBack()}
    />
  );
}

function SendForm({
  estimate,
  businessName,
  onDone,
}: {
  estimate: Estimate;
  businessName: string;
  onDone: () => void;
}) {
  const c = useTheme();
  const defaults = defaultEstimateEmail({
    businessName,
    customerName: estimate.customerName,
    estimateNumber: estimate.number,
    totalMinor: estimate.totalMinor,
    currency: estimate.currency,
    expiryDate: estimate.expiryDate,
  });
  const [to, setTo] = useState(estimate.customerEmail ?? '');
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState(defaults.message);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = useSendEstimate(estimate.id);
  const submit = useSubmit();

  const onSend = async () => {
    const errs: Record<string, string> = {};
    if (!to.trim()) errs.to = 'Enter an email address';
    const parsed = fieldErrors(sendInvoiceInputSchema, { to, subject, message });
    const merged = { ...parsed.errors, ...errs };
    setErrors(merged);
    const data = parsed.data;
    if (!data || Object.keys(merged).length) return;
    const result = await submit.run(() => send.mutateAsync(data));
    if (result) setSentTo(result.sentTo);
  };

  if (sentTo) {
    return (
      <Screen centered={false}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>Estimate sent</Text>
        <Message kind="info">{`Estimate ${estimate.number} was emailed to ${sentTo} with the PDF attached.`}</Message>
        <Button title="Done" onPress={onDone} />
      </Screen>
    );
  }

  return (
    <Screen centered={false}>
      <Text style={{ color: c.muted }}>The estimate PDF is attached automatically.</Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      <TextField
        label="To"
        value={to}
        onChangeText={setTo}
        error={errors.to}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextField label="Subject" value={subject} onChangeText={setSubject} error={errors.subject} />
      <TextField
        label="Message"
        value={message}
        onChangeText={setMessage}
        error={errors.message}
        multiline
      />
      <Button title="Send estimate" onPress={onSend} loading={submit.loading} />
    </Screen>
  );
}
