import { defaultInvoiceEmail, sendInvoiceInputSchema } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useBusiness, useInvoice, useSendInvoice } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import type { Invoice } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { useTheme } from '../theme/useTheme';
import { fieldErrors } from '../validation/fields';

export function SendInvoiceScreen({
  route,
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'SendInvoice'>) {
  const { id } = route.params;
  const invoice = useInvoice(id);
  const business = useBusiness();
  if (invoice.isPending || business.isPending) return <LoadingState />;
  if (invoice.isError)
    return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  return (
    <SendForm
      invoice={invoice.data}
      businessName={business.data.name}
      onDone={() => navigation.goBack()}
    />
  );
}

function SendForm({
  invoice,
  businessName,
  onDone,
}: {
  invoice: Invoice;
  businessName: string;
  onDone: () => void;
}) {
  const c = useTheme();
  const defaults = defaultInvoiceEmail({
    businessName,
    customerName: invoice.customerName,
    invoiceNumber: invoice.number,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
  });
  const [to, setTo] = useState(invoice.customerEmail ?? '');
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState(defaults.message);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = useSendInvoice(invoice.id);
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
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>Invoice sent</Text>
        <Message kind="info">{`Invoice ${invoice.number} was emailed to ${sentTo} with the PDF attached.`}</Message>
        <Button title="Done" onPress={onDone} />
      </Screen>
    );
  }

  return (
    <Screen centered={false}>
      <Text style={{ color: c.muted }}>
        The invoice PDF and a link to view it online are attached automatically.
      </Text>
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
      <Button title="Send invoice" onPress={onSend} loading={submit.loading} />
    </Screen>
  );
}
