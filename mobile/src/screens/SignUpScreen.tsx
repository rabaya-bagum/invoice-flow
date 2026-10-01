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
import { fieldErrors, signUpSchema } from '../validation/auth';

export function SignUpScreen({ navigation }: NativeStackScreenProps<AuthStackParams, 'SignUp'>) {
  const { signUp } = useAuth();
  const c = useTheme();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useSubmit();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    const { data, errors: e } = fieldErrors(signUpSchema, form);
    setErrors(e);
    if (!data) return;
    const result = await submit.run(() =>
      signUp({ email: data.email, password: data.password, fullName: data.fullName }),
    );
    // With email confirmation on, there is no session yet: send them to the "check your inbox" screen.
    if (result?.needsVerification) navigation.replace('VerifyEmail', { email: data.email });
  };

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>Create your account</Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      <TextField
        label="Full name"
        value={form.fullName}
        onChangeText={set('fullName')}
        error={errors.fullName}
        autoComplete="name"
        textContentType="name"
      />
      <TextField
        label="Email"
        value={form.email}
        onChangeText={set('email')}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        value={form.password}
        onChangeText={set('password')}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label="Confirm password"
        value={form.confirmPassword}
        onChangeText={set('confirmPassword')}
        error={errors.confirmPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Button title="Sign up" onPress={onSubmit} loading={submit.loading} />
      <Button
        title="I already have an account"
        variant="link"
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}
