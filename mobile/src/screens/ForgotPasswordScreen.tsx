import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useSubmit } from '../hooks/useSubmit';
import type { AuthStackParams } from '../navigation/types';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';
import { fieldErrors, forgotPasswordSchema } from '../validation/auth';

export function ForgotPasswordScreen({
  navigation,
}: NativeStackScreenProps<AuthStackParams, 'ForgotPassword'>) {
  const { requestPasswordReset } = useAuth();
  const c = useTheme();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const submit = useSubmit();

  const onSubmit = async () => {
    const { data, errors: e } = fieldErrors(forgotPasswordSchema, { email });
    setErrors(e);
    if (!data) return;
    const ok = await submit.run(async () => {
      await requestPasswordReset(data.email);
      return true;
    });
    if (ok) setSent(true);
  };

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>Reset your password</Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      {sent ? (
        // Same wording whether or not the address has an account: no account enumeration.
        <Message kind="info">
          If an account exists for that email, we have sent a link to reset your password.
        </Message>
      ) : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Button title="Send reset link" onPress={onSubmit} loading={submit.loading} />
      <Button title="Back to sign in" variant="link" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
