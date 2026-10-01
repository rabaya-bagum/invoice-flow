import { useEffect } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { ErrorState, LoadingState } from '../components/ListStates';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { useConnectStatus, useStartConnectOnboarding } from '../hooks/queries';
import { useSubmit } from '../hooks/useSubmit';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';

/** Set up payouts with Stripe so customers can pay invoices by card, Apple Pay and Google Pay. */
export function OnlinePaymentsScreen() {
  const c = useTheme();
  const status = useConnectStatus();
  const start = useStartConnectOnboarding();
  const submit = useSubmit();

  // Coming back from Stripe's onboarding in the browser: check what changed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void status.refetch();
    });
    return () => sub.remove();
  }, [status]);

  if (status.isPending) return <LoadingState />;
  if (status.isError)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;

  const begin = () =>
    submit.run(async () => {
      const { url } = await start.mutateAsync();
      await Linking.openURL(url);
    });

  const ready = s.connected && s.chargesEnabled;
  return (
    <Screen centered={false}>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>Online payments</Text>
      <Text style={{ color: c.muted }}>
        Let customers pay invoices by card, Apple Pay and Google Pay. Money goes to your bank
        account through Stripe.
      </Text>
      {!s.configured ? (
        <Message kind="info">Online payments are not enabled on this server yet.</Message>
      ) : null}
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}

      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>
          {ready ? 'Ready to accept payments' : s.connected ? 'Setup not finished' : 'Not set up'}
        </Text>
        {s.connected && !ready ? (
          <Text style={{ color: c.muted }}>
            Stripe still needs a few details before you can take payments. Tap continue to finish.
          </Text>
        ) : null}
        {ready && !s.payoutsEnabled ? (
          <Text style={{ color: c.muted }}>
            Payments work, but payouts to your bank are paused until Stripe verifies your details.
          </Text>
        ) : null}
      </View>

      {s.configured && !ready ? (
        <Button
          title={s.connected ? 'Continue setup' : 'Set up online payments'}
          onPress={begin}
          loading={submit.loading}
        />
      ) : null}
      {s.configured && s.connected ? (
        <Button
          title="Refresh status"
          variant="secondary"
          onPress={() => void status.refetch()}
          disabled={submit.loading}
        />
      ) : null}
    </Screen>
  );
}
