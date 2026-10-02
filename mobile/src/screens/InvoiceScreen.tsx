import { todayInTimezone } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ChipRow } from '../components/ChipRow';
import { Timeline } from '../components/Timeline';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { InvoiceFormView } from '../components/InvoiceFormView';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { StatusBadge } from '../components/StatusBadge';
import {
  useBusiness,
  useDeleteInvoice,
  useInvoice,
  useInvoiceActivity,
  useTaxRates,
  useTransitionInvoice,
} from '../hooks/queries';
import { QueuedDraft } from '../components/QueuedDraft';
import { useInvoiceActions } from '../hooks/useInvoiceActions';
import { useOffline } from '../offline/context';
import { classifyError } from '../utils/errors';
import { useSubmit } from '../hooks/useSubmit';
import type { BusinessProfile, Invoice } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { invoiceToForm, newInvoiceForm } from '../utils/invoice-form';

type Tab = 'edit' | 'preview' | 'history';

export function InvoiceScreen({
  route,
  navigation,
}: NativeStackScreenProps<InvoicesStackParams, 'Invoice'>) {
  const id = route.params?.id;
  const c = useTheme();
  const [tab, setTab] = useState<Tab>('edit');
  const business = useBusiness();
  const rates = useTaxRates();
  const off = useOffline();
  const op = id ? off.getOp(id) : undefined;
  // With a copy saved on the device we do not wait for (or depend on) the server.
  const invoice = useInvoice(op || !off.loaded ? undefined : id);
  const transition = useTransitionInvoice();
  const remove = useDeleteInvoice();
  const act = useSubmit();

  if (!off.loaded || business.isPending || rates.isPending || (id && !op && invoice.isPending))
    return <LoadingState />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  if (rates.isError) return <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />;
  if (id && !op && invoice.isError)
    return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;

  if (op && id) {
    return (
      <QueuedDraft op={op} id={id} business={business.data} onGone={() => navigation.popToTop()} />
    );
  }

  const inv = invoice.data;
  const tabs: Array<{ value: Tab; label: string }> = id
    ? [
        { value: 'edit', label: 'Edit' },
        { value: 'preview', label: 'Preview' },
        { value: 'history', label: 'History' },
      ]
    : [{ value: 'edit', label: 'Edit' }];

  const confirm = (title: string, message: string, label: string, run: () => Promise<unknown>) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: label, style: 'destructive', onPress: () => void act.run(run) },
    ]);

  return (
    <Screen centered={false}>
      {inv ? (
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{inv.number}</Text>
          <StatusBadge status={inv.displayStatus} />
        </View>
      ) : (
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>New invoice</Text>
      )}
      {id ? (
        <ChipRow label="Invoice sections" options={tabs} value={tab} onChange={setTab} />
      ) : null}
      {act.error ? <Message kind="error">{act.error}</Message> : null}

      {tab === 'edit' &&
        (inv && !inv.editable ? (
          <Message kind="info">{`This invoice can no longer be edited because it is ${inv.status.replace('_', ' ')}${inv.amountPaidMinor > 0 ? ' and has payments' : ''}. Open Preview to see it.`}</Message>
        ) : business.data ? (
          <InvoiceFormView
            // Re-mount when the invoice changes (e.g. after a save) so the form reflects the server copy.
            key={inv ? `${inv.id}-${inv.version}` : 'new'}
            initial={
              inv
                ? invoiceToForm(inv)
                : newInvoiceForm(
                    business.data,
                    rates.data ?? [],
                    todayInTimezone(business.data.timezone),
                  )
            }
            invoiceId={id}
            offline={
              inv
                ? inv.status === 'draft'
                  ? { isNew: false, baseVersion: inv.version }
                  : undefined
                : { isNew: true, baseVersion: null }
            }
            onSaved={(saved) => {
              if (saved.queued || !id) navigation.replace('Invoice', { id: saved.id });
              else setTab('preview');
            }}
          />
        ) : null)}

      {tab === 'preview' && inv && business.data ? (
        <InvoicePreview
          inv={inv}
          business={business.data}
          onSend={() => navigation.navigate('SendInvoice', { id: inv.id })}
        />
      ) : null}
      {tab === 'history' && inv ? <History id={inv.id} /> : null}

      {inv ? (
        <View style={{ gap: spacing.sm }}>
          {inv.status === 'draft' ? (
            <Button
              title="Mark as sent"
              variant="secondary"
              loading={act.loading}
              onPress={() => void act.run(() => transition.mutateAsync({ id: inv.id, to: 'sent' }))}
            />
          ) : null}
          {['draft', 'sent', 'viewed'].includes(inv.status) && inv.amountPaidMinor === 0 ? (
            <Button
              title="Cancel invoice"
              variant="secondary"
              onPress={() =>
                confirm(
                  'Cancel this invoice?',
                  'It stays in your records but can no longer be edited or paid.',
                  'Cancel invoice',
                  () => transition.mutateAsync({ id: inv.id, to: 'cancelled' }),
                )
              }
            />
          ) : null}
          {inv.status === 'draft' ? (
            <Button
              title="Delete draft"
              variant="danger"
              onPress={() =>
                confirm('Delete this draft?', 'This cannot be undone.', 'Delete', async () => {
                  try {
                    await remove.mutateAsync(inv.id);
                  } catch (e) {
                    // No connection: remember the delete and send it when back online.
                    if (!off.available || classifyError(e) !== 'network') throw e;
                    await off.deleteDraft({
                      invoiceId: inv.id,
                      isNew: false,
                      summary: {
                        customerName: inv.customerName,
                        currency: inv.currency,
                        totalMinor: inv.totalMinor,
                        number: inv.number,
                      },
                    });
                  }
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

/** Professional preview of the saved invoice, with PDF, sharing, email and pay-page actions. */
function InvoicePreview({
  inv,
  business,
  onSend,
}: {
  inv: Invoice;
  business: BusinessProfile;
  onSend: () => void;
}) {
  const actions = useInvoiceActions(inv, business.name);
  const payable =
    ['sent', 'viewed', 'partially_paid'].includes(inv.status) && inv.balanceDueMinor > 0;
  const sendable = ['draft', 'sent', 'viewed', 'partially_paid'].includes(inv.status);
  return (
    <View style={{ gap: spacing.md }}>
      <InvoiceDocument invoice={inv} business={business} />
      {actions.error ? <Message kind="error">{actions.error}</Message> : null}
      {payable ? (
        <Button
          title="Pay invoice"
          onPress={() => void actions.openPaymentPage()}
          loading={actions.loading}
        />
      ) : null}
      {sendable ? (
        <Button
          title="Email invoice"
          onPress={onSend}
          variant={payable ? 'secondary' : 'primary'}
        />
      ) : null}
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
      {inv.status !== 'draft' ? (
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

function History({ id }: { id: string }) {
  const q = useInvoiceActivity(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Timeline entries={q.data.items} />;
}
