import { todayInTimezone } from '@invoiceflow/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ChipRow } from '../components/ChipRow';
import { InvoiceFormView } from '../components/InvoiceFormView';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { StatusBadge } from '../components/StatusBadge';
import { TotalsCard } from '../components/TotalsCard';
import {
  useBusiness,
  useDeleteInvoice,
  useInvoice,
  useInvoiceActivity,
  useTaxRates,
  useTransitionInvoice,
} from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import type { Invoice } from '../models';
import type { InvoicesStackParams } from '../navigation/types';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { formatDate, money } from '../utils/format';
import { invoiceToForm, newInvoiceForm } from '../utils/invoice-form';
import { rowsFromInvoice } from '../utils/totals-rows';

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
  const invoice = useInvoice(id);
  const transition = useTransitionInvoice();
  const remove = useDeleteInvoice();
  const act = useSubmit();

  if (business.isPending || rates.isPending || (id && invoice.isPending)) return <LoadingState />;
  if (business.isError)
    return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  if (rates.isError) return <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />;
  if (id && invoice.isError)
    return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;

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
            onSaved={(saved) => {
              if (id) setTab('preview');
              else navigation.replace('Invoice', { id: saved.id });
            }}
          />
        ) : null)}

      {tab === 'preview' && inv ? <InvoicePreview inv={inv} /> : null}
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
                  await remove.mutateAsync(inv.id);
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

/** Basic read-only view of the saved invoice (the designed preview and PDF come in the next phase). */
function InvoicePreview({ inv }: { inv: Invoice }) {
  const c = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{inv.customerName}</Text>
      <Text style={{ color: c.muted }}>
        Issued {formatDate(inv.issueDate)} · Due {formatDate(inv.dueDate)}
      </Text>
      {inv.items.map((it) => (
        <View
          key={it.id}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}
        >
          <Text style={{ color: c.text, flex: 1 }}>
            {it.description} ×{it.quantityMilli / 1000}
          </Text>
          <Text style={{ color: c.text, fontWeight: '600' }}>
            {money(it.lineTotalMinor, inv.currency)}
          </Text>
        </View>
      ))}
      <TotalsCard rows={rowsFromInvoice(inv)} />
      {inv.notes ? <Text style={{ color: c.muted }}>{inv.notes}</Text> : null}
      {inv.terms ? <Text style={{ color: c.muted }}>{inv.terms}</Text> : null}
    </View>
  );
}

function History({ id }: { id: string }) {
  const c = useTheme();
  const q = useInvoiceActivity(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <View style={{ gap: spacing.md }}>
      {q.data.items.map((a) => (
        <View key={a.id}>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {new Date(a.createdAt).toLocaleString()}
          </Text>
          <Text style={{ color: c.text, fontSize: 16 }}>{a.message ?? a.type}</Text>
        </View>
      ))}
    </View>
  );
}
