import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { BusinessProfile } from '../models';
import { useOffline } from '../offline/context';
import { opToForm } from '../offline/form';
import { kindOf, type DraftOp } from '../offline/types';
import { useSubmit } from '../hooks/useSubmit';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { Button } from './Button';
import { InvoiceFormView } from './InvoiceFormView';
import { Message } from './Message';
import { Screen } from './Screen';
import { StatusBadge } from './StatusBadge';

const PROBLEM_HELP: Record<string, string> = {
  version_conflict:
    'You can keep your version (it replaces the one on the server) or use the server version (your changes are thrown away).',
  locked: 'You can save your changes as a new draft, or throw them away.',
  deleted: 'You can save your changes as a new draft, or throw them away.',
  rejected: 'Fix the problem below and save again, or throw the draft away.',
};

/** An invoice or estimate draft that lives in the offline queue: edit it, resolve a conflict, or discard it. */
export function QueuedDraft({
  op,
  id,
  business,
  onGone,
}: {
  op: DraftOp;
  id: string;
  business: BusinessProfile | undefined;
  onGone: () => void;
}) {
  const c = useTheme();
  const off = useOffline();
  const act = useSubmit();
  const [note, setNote] = useState<string | null>(null);
  const confirm = (title: string, message: string, label: string, run: () => Promise<unknown>) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: label, style: 'destructive', onPress: () => void act.run(run) },
    ]);

  if (op.payload === null) {
    return (
      <Screen centered={false}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
          {op.summary.customerName}
        </Text>
        <Message kind="info">This draft will be deleted when the app is back online.</Message>
        <Button
          title="Undo delete"
          variant="secondary"
          onPress={() => void act.run(async () => off.discard(id))}
        />
      </Screen>
    );
  }
  const kind = kindOf(op);
  const noun = kind === 'estimate' ? 'estimate' : 'invoice';
  const form = opToForm(op);
  const problem = op.state !== 'pending' ? op.problem : undefined;
  return (
    <Screen centered={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
          {op.isNew ? 'New draft' : (op.summary.number ?? 'Draft')}
        </Text>
        <StatusBadge status="draft" />
      </View>
      {act.error ? <Message kind="error">{act.error}</Message> : null}
      {note ? <Message kind="error">{note}</Message> : null}
      {problem ? (
        <Message kind="error">{`${problem.message} ${PROBLEM_HELP[problem.code] ?? ''}`}</Message>
      ) : (
        <Message kind="info">
          Saved on this device. It uploads automatically when you are back online.
        </Message>
      )}

      {business && form ? (
        <InvoiceFormView
          key={op.updatedAt}
          initial={form}
          invoiceId={id}
          kind={kind}
          offline={{ isNew: op.isNew, baseVersion: op.baseVersion, local: true }}
          onSaved={() => undefined}
        />
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {op.state === 'pending' ? (
          <Button
            title={off.syncing ? 'Syncing…' : 'Sync now'}
            variant="secondary"
            loading={off.syncing}
            onPress={() => void off.syncNow()}
          />
        ) : null}
        {op.problem?.code === 'version_conflict' ? (
          <>
            <Button
              title="Keep my version"
              loading={act.loading}
              onPress={() =>
                void act.run(async () => {
                  setNote(await off.keepMine(id));
                })
              }
            />
            <Button
              title="Use server version"
              variant="secondary"
              onPress={() =>
                confirm(
                  'Use the server version?',
                  'Your changes on this device will be thrown away.',
                  'Use server version',
                  async () => {
                    await off.discard(id);
                    onGone();
                  },
                )
              }
            />
          </>
        ) : null}
        {op.problem?.code === 'locked' || op.problem?.code === 'deleted' ? (
          <Button
            title="Save as new draft"
            onPress={() =>
              void act.run(async () => {
                await off.saveAsCopy(id);
                onGone();
              })
            }
          />
        ) : null}
        <Button
          title={op.isNew ? 'Delete draft' : 'Discard my changes'}
          variant="danger"
          onPress={() =>
            confirm(
              op.isNew ? 'Delete this draft?' : 'Discard your changes?',
              op.isNew
                ? 'It has not been uploaded yet. This cannot be undone.'
                : `The ${noun} on the server stays as it is.`,
              op.isNew ? 'Delete' : 'Discard',
              async () => {
                if (op.isNew)
                  await off.deleteDraft({ invoiceId: id, isNew: true, summary: op.summary });
                else await off.discard(id);
                onGone();
              },
            )
          }
        />
      </View>
    </Screen>
  );
}
