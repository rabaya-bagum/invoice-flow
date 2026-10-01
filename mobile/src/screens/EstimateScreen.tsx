import { todayInTimezone } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ChipRow } from '../components/ChipRow';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { InvoiceFormView } from '../components/InvoiceFormView';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { StatusBadge } from '../components/StatusBadge';
import {
  useBusiness,
  useConvertEstimate,
  useDeleteEstimate,
  useEstimate,
  useTaxRates,
  useTransitionEstimate,
} from '../hooks/queries';
import { useEstimateActions } from '../hooks/useEstimateActions';
import { useSubmit } from '../hooks/useSubmit';
import type { BusinessProfile, Estimate } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { estimateAsInvoice } from '../utils/estimate';
import { formatDate } from '../utils/format';
import { invoiceToForm, newInvoiceForm } from '../utils/invoice-form';

type Tab = 'edit' | 'preview';

export function EstimateScreen({
  route,
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'Estimate'>) {
  const id = route.params?.id;
  const c = useTheme();
  const [tab, setTab] = useState<Tab>('edit');
  const business = useBusiness();
  const rates = useTaxRates();
  const estimate = useEstimate(id);
  const transition = useTransitionEstimate();
  const convert = useConvertEstimate();
  const remove = useDeleteEstimate();
  const act = useSubmit();

  if (business.isPending || rates.isPending || (id && estimate.isPending)) return <LoadingState />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  if (rates.isError) return <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />;
  if (id && estimate.isError)
    return <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />;

  const est = estimate.data;
  const tabs: Array<{ value: Tab; label: string }> = id
    ? [
        { value: 'edit', label: 'Edit' },
        { value: 'preview', label: 'Preview' },
      ]
    : [{ value: 'edit', label: 'Edit' }];

  const confirm = (
    title: string,
    message: string,
    label: string,
    run: () => Promise<unknown>,
    destructive = true,
  ) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      {
        text: label,
        style: destructive ? 'destructive' : 'default',
        onPress: () => void act.run(run),
      },
    ]);

  const open = est && ['draft', 'sent', 'viewed'].includes(est.status) && !est.convertedInvoiceId;

  return (
    <Screen centered={false}>
      {est ? (
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{est.number}</Text>
          <StatusBadge status={est.displayStatus} />
        </View>
      ) : (
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>New estimate</Text>
      )}
      {id ? (
        <ChipRow label="Estimate sections" options={tabs} value={tab} onChange={setTab} />
      ) : null}
      {act.error ? <Message kind="error">{act.error}</Message> : null}
      {est && (est.status === 'accepted' || est.status === 'rejected') && est.decidedAt ? (
        <Message kind="info">{`${est.status === 'accepted' ? 'Accepted' : 'Declined'}${est.decidedByName ? ` by ${est.decidedByName}` : ''} on ${formatDate(est.decidedAt.slice(0, 10))}.`}</Message>
      ) : null}
      {est?.convertedInvoiceId ? (
        <Message kind="info">This estimate was turned into an invoice.</Message>
      ) : null}

      {tab === 'edit' &&
        (est && !est.editable ? (
          <Message kind="info">{`This estimate can no longer be edited because it is ${est.convertedInvoiceId ? 'converted' : est.status === 'rejected' ? 'declined' : est.status}. Open Preview to see it.`}</Message>
        ) : business.data ? (
          <InvoiceFormView
            kind="estimate"
            key={est ? `${est.id}-${est.version}` : 'new'}
            initial={
              est
                ? { ...invoiceToForm(estimateAsInvoice(est)), dueDate: est.expiryDate }
                : newInvoiceForm(
                    business.data,
                    rates.data ?? [],
                    todayInTimezone(business.data.timezone),
                  )
            }
            invoiceId={id}
            onSaved={(saved) => {
              if (id) setTab('preview');
              else navigation.replace('Estimate', { id: saved.id });
            }}
          />
        ) : null)}

      {tab === 'preview' && est && business.data ? (
        <EstimatePreview
          est={est}
          business={business.data}
          onSend={() => navigation.navigate('SendEstimate', { id: est.id })}
        />
      ) : null}

      {est ? (
        <View style={{ gap: spacing.sm }}>
          {est.convertedInvoiceId ? (
            <Button
              title="Open invoice"
              onPress={() =>
                navigation.navigate('Invoice', { id: est.convertedInvoiceId as string })
              }
            />
          ) : null}
          {est.status === 'draft' ? (
            <Button
              title="Mark as sent"
              variant="secondary"
              loading={act.loading}
              onPress={() => void act.run(() => transition.mutateAsync({ id: est.id, to: 'sent' }))}
            />
          ) : null}
          {open && est.status !== 'draft' ? (
            <>
              <Button
                title="Mark accepted"
                variant="secondary"
                loading={act.loading}
                onPress={() =>
                  void act.run(() => transition.mutateAsync({ id: est.id, to: 'accepted' }))
                }
              />
              <Button
                title="Mark declined"
                variant="secondary"
                onPress={() =>
                  confirm(
                    'Mark as declined?',
                    'The customer turned this estimate down. It can no longer be edited or converted.',
                    'Mark declined',
                    () => transition.mutateAsync({ id: est.id, to: 'rejected' }),
                  )
                }
              />
            </>
          ) : null}
          {est.convertible ? (
            <Button
              title="Convert to invoice"
              loading={act.loading}
              onPress={() =>
                confirm(
                  'Convert to invoice?',
                  'This creates a draft invoice with the same items. The estimate can no longer be edited.',
                  'Convert',
                  async () => {
                    const r = await convert.mutateAsync(est.id);
                    navigation.replace('Invoice', { id: r.invoice.id });
                  },
                  false,
                )
              }
            />
          ) : null}
          {est.status === 'draft' && !est.convertedInvoiceId ? (
            <Button
              title="Delete draft"
              variant="danger"
              onPress={() =>
                confirm('Delete this draft?', 'This cannot be undone.', 'Delete', async () => {
                  await remove.mutateAsync(est.id);
                  navigation.popToTop();
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function EstimatePreview({
  est,
  business,
  onSend,
}: {
  est: Estimate;
  business: BusinessProfile;
  onSend: () => void;
}) {
  const actions = useEstimateActions(est, business.name);
  const sendable = ['draft', 'sent', 'viewed'].includes(est.status) && !est.convertedInvoiceId;
  return (
    <View style={{ gap: spacing.md }}>
      <InvoiceDocument kind="estimate" invoice={estimateAsInvoice(est)} business={business} />
      {actions.error ? <Message kind="error">{actions.error}</Message> : null}
      {sendable ? <Button title="Email estimate" onPress={onSend} /> : null}
      <Button
        title="Preview PDF"
        variant="secondary"
        onPress={() => void actions.previewPdf()}
        loading={actions.loading}
      />
      <Button
        title="Share PDF"
        variant="secondary"
        onPress={() => void actions.sharePdf()}
        disabled={actions.loading}
      />
      {est.status !== 'draft' ? (
        <Button
          title="Share link"
          variant="secondary"
          onPress={() => void actions.shareLink()}
          disabled={actions.loading}
        />
      ) : null}
    </View>
  );
}
