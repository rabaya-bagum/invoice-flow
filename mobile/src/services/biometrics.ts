import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const FLAG_KEY = 'biometric_lock_enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

/** Prompts Face ID / Touch ID / Android biometrics (falls back to device passcode). */
export async function authenticate(reason = 'Unlock InvoiceFlow'): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
  });
  return result.success;
}

export async function getBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(FLAG_KEY)) === '1';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(FLAG_KEY, '1');
  else await SecureStore.deleteItemAsync(FLAG_KEY);
}
