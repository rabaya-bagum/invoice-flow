import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { useSubmit } from '../hooks/useSubmit';
import type { AuthStackParams } from '../navigation/types';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';

const COOLDOWN_SECONDS = 60;

export function VerifyEmailScreen({
  route,
  navigation,
}: NativeStackScreenProps<AuthStackParams, 'VerifyEmail'>) {
  const { email } = route.params;
  const { resendVerification } = useAuth();
  const c = useTheme();
  const submit = useSubmit();
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onResend = async () => {
    const ok = await submit.run(async () => {
      await resendVerification(email);
      return true;
    });
    if (ok) {
      setResent(true);
      setCooldown(COOLDOWN_SECONDS);
    }
  };

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>Check your inbox</Text>
      <Text style={{ color: c.muted, fontSize: 16 }}>
        We sent a verification link to {email}. Open it on this device to finish signing up.
      </Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {resent && !submit.error ? (
        <Message kind="info">Verification email sent again.</Message>
      ) : null}
      <Button
        title={cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
        variant="secondary"
        onPress={onResend}
        disabled={cooldown > 0}
        loading={submit.loading}
      />
      <Button title="Back to sign in" variant="link" onPress={() => navigation.popToTop()} />
    </Screen>
  );
}
