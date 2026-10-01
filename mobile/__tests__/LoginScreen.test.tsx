import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LoginScreen } from '../src/screens/LoginScreen';
import { useAuth } from '../src/store/auth';

jest.mock('../src/store/auth');
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockedUseAuth = useAuth as jest.Mock;
const navigation = { navigate: jest.fn() } as never;
const route = {} as never;

function setup(overrides: Record<string, unknown> = {}) {
  const auth = {
    signIn: jest.fn(async () => {}),
    resendVerification: jest.fn(async () => {}),
    notice: null,
    dismissNotice: jest.fn(),
    ...overrides,
  };
  mockedUseAuth.mockReturnValue(auth);
  return auth;
}

const fill = async (email: string, password: string) => {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
};

describe('LoginScreen', () => {
  it('shows validation errors and does not call signIn', async () => {
    const auth = setup();
    await render(<LoginScreen navigation={navigation} route={route} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('signs in with a normalised email', async () => {
    const auth = setup();
    await render(<LoginScreen navigation={navigation} route={route} />);
    await fill('  Ann@Example.com ', 'secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('ann@example.com', 'secret'));
  });

  it('shows a friendly message, not the raw backend error', async () => {
    setup({
      signIn: jest.fn(async () => {
        throw { code: 'invalid_credentials', message: 'Invalid login credentials' };
      }),
    });
    await render(<LoginScreen navigation={navigation} route={route} />);
    await fill('a@b.co', 'wrong');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
    expect(screen.queryByText(/Invalid login credentials/)).toBeNull();
  });

  it('offers to resend verification when the email is unverified', async () => {
    const auth = setup({
      signIn: jest.fn(async () => {
        throw { code: 'email_not_confirmed' };
      }),
    });
    await render(<LoginScreen navigation={navigation} route={route} />);
    await fill('a@b.co', 'pw');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Resend verification email' }));
    await waitFor(() => expect(auth.resendVerification).toHaveBeenCalledWith('a@b.co'));
  });

  it('shows the notice from an email link', async () => {
    setup({ notice: 'Email verified. You can now sign in.' });
    await render(<LoginScreen navigation={navigation} route={route} />);
    expect(screen.getByText('Email verified. You can now sign in.')).toBeTruthy();
  });
});
