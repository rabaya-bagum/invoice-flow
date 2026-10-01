import { useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { useSubmit } from '../hooks/useSubmit';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';

export function SettingsScreen() {
  const auth = useAuth();
  const c = useTheme();
  const [available, setAvailable] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const del = useSubmit();

  useEffect(() => {
    void auth.isBiometricAvailable().then(setAvailable);
  }, [auth]);

  const toggle = async (next: boolean) => {
    setBioError(null);
    const ok = await auth.setBiometricEnabled(next);
    if (!ok) setBioError('Biometric unlock could not be changed. Check your device settings.');
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, customers, invoices and payment history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void del.run(async () => {
              await auth.api.deleteAccount();
              await auth.signOut();
            }),
        },
      ],
    );

  return (
    <Screen>
      <Text style={{ color: c.muted }}>{auth.session?.user.email}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 16 }}>Unlock with Face ID / fingerprint</Text>
        <Switch
          value={auth.biometricEnabled}
          onValueChange={toggle}
          disabled={!available && !auth.biometricEnabled}
          accessibilityLabel="Biometric unlock"
        />
      </View>
      {!available ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>
          Set up Face ID, Touch ID or a fingerprint in your device settings to enable this.
        </Text>
      ) : null}
      {bioError ? <Message kind="error">{bioError}</Message> : null}
      <Button title="Sign out" variant="secondary" onPress={() => void auth.signOut()} />
      {del.error ? <Message kind="error">{del.error}</Message> : null}
      <Button
        title="Delete account"
        variant="danger"
        onPress={confirmDelete}
        loading={del.loading}
      />
    </Screen>
  );
}
