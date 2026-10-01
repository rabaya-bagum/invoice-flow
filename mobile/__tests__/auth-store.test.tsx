import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { Services } from '../src/services';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/store/auth';

function setup(
  opts: { session?: object | null; biometricEnabled?: boolean; authenticate?: boolean } = {},
) {
  let changeCb: ((e: string, s: unknown) => void) | undefined;
  let enabled = opts.biometricEnabled ?? false;
  const bio = {
    isBiometricAvailable: jest.fn(async () => true),
    authenticate: jest.fn(async () => opts.authenticate ?? true),
    getBiometricEnabled: jest.fn(async () => enabled),
    setBiometricEnabled: jest.fn(async (v: boolean) => void (enabled = v)),
  };
  const services = {
    auth: {
      getSession: jest.fn(async () => opts.session ?? null),
      onChange: jest.fn((cb) => ((changeCb = cb), () => {})),
      signOut: jest.fn(async () => {}),
      handleAuthUrl: jest.fn(),
    },
    biometrics: bio,
    push: { unregister: jest.fn(async () => {}) },
    api: {},
  } as unknown as Services;
  let ctx!: AuthContextValue;
  function Probe() {
    ctx = useAuth();
    return <Text>{ctx.status}</Text>;
  }
  return {
    services,
    bio,
    get ctx() {
      return ctx;
    },
    emit: (e: string, s: unknown = null) => changeCb?.(e, s),
    mount: () =>
      render(
        <AuthProvider services={services}>
          <Probe />
        </AuthProvider>,
      ),
  };
}

describe('AuthProvider', () => {
  it('is signed out without a stored session', async () => {
    const t = setup();
    await t.mount();
    expect(await screen.findByText('signedOut')).toBeTruthy();
    expect(t.ctx.locked).toBe(false);
  });

  it('starts locked when a session exists and biometric lock is on', async () => {
    const t = setup({ session: { user: { id: 'u' } }, biometricEnabled: true });
    await t.mount();
    await screen.findByText('signedIn');
    expect(t.ctx.locked).toBe(true);
  });

  it('does not lock when biometric lock is off', async () => {
    const t = setup({ session: { user: { id: 'u' } } });
    await t.mount();
    await screen.findByText('signedIn');
    expect(t.ctx.locked).toBe(false);
  });

  it('unlocks only after a successful biometric check', async () => {
    const t = setup({
      session: { user: { id: 'u' } },
      biometricEnabled: true,
      authenticate: false,
    });
    await t.mount();
    await screen.findByText('signedIn');
    await act(async () => void (await t.ctx.unlock()));
    expect(t.ctx.locked).toBe(true);
    t.bio.authenticate.mockResolvedValueOnce(true);
    await act(async () => void (await t.ctx.unlock()));
    expect(t.ctx.locked).toBe(false);
  });

  it('requires a successful scan to enable the lock', async () => {
    const t = setup({ session: { user: { id: 'u' } }, authenticate: false });
    await t.mount();
    await screen.findByText('signedIn');
    let ok = true;
    await act(async () => void (ok = await t.ctx.setBiometricEnabled(true)));
    expect(ok).toBe(false);
    expect(t.bio.setBiometricEnabled).not.toHaveBeenCalled();
  });

  it('moves to recovery on a PASSWORD_RECOVERY event', async () => {
    const t = setup({ session: { user: { id: 'u' } } });
    await t.mount();
    await screen.findByText('signedIn');
    await act(async () => t.emit('PASSWORD_RECOVERY', { user: { id: 'u' } }));
    expect(await screen.findByText('recovery')).toBeTruthy();
  });

  it('sign-out clears the biometric preference so the next user is not locked out', async () => {
    const t = setup({ session: { user: { id: 'u' } }, biometricEnabled: true });
    await t.mount();
    await screen.findByText('signedIn');
    await act(async () => t.ctx.signOut());
    expect(t.bio.setBiometricEnabled).toHaveBeenCalledWith(false);
    expect(t.ctx.biometricEnabled).toBe(false);
    expect(t.ctx.locked).toBe(false);
  });
});
