import { useEffect, useState } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { useSubmit } from '../hooks/useSubmit';
import {
  isPushPreferenceOn,
  registerForPush,
  setPushPreference,
  unregisterPush,
} from '../services/push';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';

export function SettingsScreen() {
  const auth = useAuth();
  const c = useTheme();
  const [available, setAvailable] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const del = useSubmit();
  const [pushOn, setPushOn] = useState(true);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushDenied, setPushDenied] = useState(false);

  useEffect(() => {
    void isPushPreferenceOn().then(setPushOn);
  }, []);

  const togglePush = async (next: boolean) => {
    setPushNote(null);
    setPushDenied(false);
    if (!next) {
      setPushOn(false);
      await setPushPreference(false);
      await unregisterPush(auth.api);
      return;
    }
    const outcome = await registerForPush(auth.api);
    if (outcome === 'registered') {
      await setPushPreference(true);
      setPushOn(true);
    } else if (outcome === 'denied') {
      setPushDenied(true);
      setPushNote('Notifications are blocked for InvoiceFlow. Allow them in your device settings.');
    } else if (outcome === 'unsupported') {
      setPushNote('Push notifications need a physical phone or tablet.');
    } else {
      setPushNote('Could not turn on notifications. Please try again.');
    }
  };

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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>Push notifications</Text>
        <Switch value={pushOn} onValueChange={togglePush} accessibilityLabel="Push notifications" />
      </View>
      {pushNote ? <Message kind="info">{pushNote}</Message> : null}
      {pushDenied ? (
        <Button
          title="Open device settings"
          variant="secondary"
          onPress={() => void Linking.openSettings()}
        />
      ) : null}
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
