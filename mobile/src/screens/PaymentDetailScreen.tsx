import { parseMoney, isSupportedCurrency } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { PaymentBadge } from '../components/PaymentBadge';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { usePayment, useRefundPayment } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import type { PaymentsStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';
import { methodLabel, paymentRef } from '../utils/payment-labels';

export function PaymentDetailScreen({
  route,
}: NativeStackScreenProps<PaymentsStackParams, 'PaymentDetail'>) {
  const c = useTheme();
  const q = usePayment(route.params.id);
  const refund = useRefundPayment(route.params.id);
  const submit = useSubmit();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const remaining = p.amountMinor - p.refundedMinor;
  const canRefund = p.status === 'successful' && remaining > 0;

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <Text style={{ color: c.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );

  const startRefund = () => {
    setError(null);
    let minor: number | undefined;
    if (amount.trim()) {
      try {
        minor = isSupportedCurrency(p.currency) ? parseMoney(amount, p.currency) : undefined;
      } catch {
        setError(`Enter an amount like 25.00 (${p.currency})`);
        return;
      }
      if (minor === undefined || minor <= 0) return setError('Enter an amount greater than zero');
      if (minor > remaining)
        return setError(`The most you can refund is ${money(remaining, p.currency)}`);
    }
    const label = money(minor ?? remaining, p.currency);
    Alert.alert(
      'Refund this payment?',
      `${label} will be returned to the customer's card. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refund',
          style: 'destructive',
          onPress: () =>
            void submit.run(async () => {
              await refund.mutateAsync(minor);
              setRequested(label);
              setAmount('');
            }),
        },
      ],
    );
  };

  return (
    <Screen centered={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>
          {money(p.amountMinor, p.currency)}
        </Text>
        <PaymentBadge status={p.status} />
      </View>
      {row('Invoice', p.invoiceNumber)}
      {row('Customer', p.customerName)}
      {row('Method', methodLabel(p.method))}
      {row('Date', formatDate((p.paidAt ?? p.createdAt).slice(0, 10)))}
      {row('Payment ID', paymentRef(p))}
      {p.refundedMinor > 0 ? row('Refunded', money(p.refundedMinor, p.currency)) : null}
      {p.failureCode ? row('Reason', p.failureCode.replace(/_/g, ' ')) : null}
      {p.receiptUrl ? (
        <Button
          title="View receipt"
          variant="secondary"
          onPress={() => void Linking.openURL(p.receiptUrl as string)}
        />
      ) : null}

      {requested ? (
        <Message kind="info">{`Refund of ${requested} requested. It will show here once the payment provider confirms it.`}</Message>
      ) : null}
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {error ? <Message kind="error">{error}</Message> : null}
      {canRefund ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>Refund</Text>
          <TextField
            label={`Amount (${p.currency}), leave blank to refund ${money(remaining, p.currency)}`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="Full remaining amount"
          />
          <Button title="Refund" variant="danger" onPress={startRefund} loading={submit.loading} />
        </View>
      ) : null}
    </Screen>
  );
}
