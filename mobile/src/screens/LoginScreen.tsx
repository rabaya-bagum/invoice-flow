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
import { fieldErrors, loginSchema } from '../validation/auth';

export function LoginScreen({ navigation }: NativeStackScreenProps<AuthStackParams, 'Login'>) {
  const { signIn, resendVerification, notice, dismissNotice } = useAuth();
  const c = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useSubmit();
  const resend = useSubmit();
  const [resent, setResent] = useState(false);

  const onSubmit = () => {
    const { data, errors: e } = fieldErrors(loginSchema, { email, password });
    setErrors(e);
    if (!data) return;
    dismissNotice();
    void submit.run(() => signIn(data.email, data.password));
  };

  const onResend = async () => {
    await resend.run(() => resendVerification(email.trim().toLowerCase()));
    setResent(true);
  };

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>Welcome back</Text>
      {notice ? <Message kind="info">{notice}</Message> : null}
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
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
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={onSubmit}
      />
      <Button title="Sign in" onPress={onSubmit} loading={submit.loading} />
      {submit.kind === 'email_not_verified' && (
        <>
          <Button
            title="Resend verification email"
            variant="secondary"
            onPress={onResend}
            loading={resend.loading}
          />
          {resent && !resend.error ? <Message kind="info">Verification email sent.</Message> : null}
        </>
      )}
      <Button
        title="Forgot password?"
        variant="link"
        onPress={() => navigation.navigate('ForgotPassword')}
      />
      <Button
        title="Create an account"
        variant="secondary"
        onPress={() => navigation.navigate('SignUp')}
      />
    </Screen>
  );
}
