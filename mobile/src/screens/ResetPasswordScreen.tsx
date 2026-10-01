import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useSubmit } from '../hooks/useSubmit';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';
import { fieldErrors, resetPasswordSchema } from '../validation/auth';

/** Shown after the user opens the reset link (a recovery session is active). */
export function ResetPasswordScreen() {
  const { updatePassword, signOut } = useAuth();
  const c = useTheme();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useSubmit();

  const onSubmit = () => {
    const { data, errors: e } = fieldErrors(resetPasswordSchema, { password, confirmPassword });
    setErrors(e);
    if (!data) return;
    void submit.run(() => updatePassword(data.password));
  };

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>Choose a new password</Text>
      {submit.error ? <Message kind="error">{submit.error}</Message> : null}
      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        error={errors.confirmPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Button title="Update password" onPress={onSubmit} loading={submit.loading} />
      <Button title="Cancel" variant="link" onPress={() => void signOut()} />
    </Screen>
  );
}
