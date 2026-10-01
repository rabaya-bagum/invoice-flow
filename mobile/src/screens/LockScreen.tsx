import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { Screen } from '../components/Screen';
import { useAuth } from '../store/auth';
import { useTheme } from '../theme/useTheme';

/** Shown on cold start / after time in background when biometric lock is enabled. */
export function LockScreen() {
  const { unlock, signOut } = useAuth();
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const prompting = useRef(false);

  const tryUnlock = async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      setFailed(!(await unlock()));
    } catch {
      setFailed(true);
    } finally {
      prompting.current = false;
    }
  };

  useEffect(() => {
    void tryUnlock();
  }, []);

  return (
    <Screen>
      <Text style={{ color: c.text, fontSize: 28, fontWeight: '700' }}>InvoiceFlow is locked</Text>
      {failed ? <Message kind="error">We could not verify it is you. Try again.</Message> : null}
      <Button title="Unlock" onPress={tryUnlock} />
      <Button title="Sign out" variant="link" onPress={() => void signOut()} />
    </Screen>
  );
}
