import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignUpScreen } from '../src/screens/SignUpScreen';
import { useAuth } from '../src/store/auth';

jest.mock('../src/store/auth');
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockedUseAuth = useAuth as jest.Mock;

async function fillForm(overrides: Record<string, string> = {}) {
  const v = {
    'Full name': 'Ann Lee',
    Email: 'ann@x.co',
    Password: 'abcdefghi1',
    'Confirm password': 'abcdefghi1',
    ...overrides,
  };
  for (const [label, value] of Object.entries(v)) {
    await fireEvent.changeText(screen.getByLabelText(label), value);
  }
}

describe('SignUpScreen', () => {
  it('blocks weak or mismatched passwords before calling the server', async () => {
    const signUp = jest.fn();
    mockedUseAuth.mockReturnValue({ signUp });
    await render(
      <SignUpScreen
        navigation={{ replace: jest.fn(), goBack: jest.fn() } as never}
        route={{} as never}
      />,
    );
    await fillForm({ Password: 'short', 'Confirm password': 'other' });
    await fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByText('Use at least 10 characters')).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('goes to the verify-email screen when confirmation is required', async () => {
    const signUp = jest.fn(async () => ({ needsVerification: true }));
    const replace = jest.fn();
    mockedUseAuth.mockReturnValue({ signUp });
    await render(
      <SignUpScreen navigation={{ replace, goBack: jest.fn() } as never} route={{} as never} />,
    );
    await fillForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('VerifyEmail', { email: 'ann@x.co' }));
    expect(signUp).toHaveBeenCalledWith({
      email: 'ann@x.co',
      password: 'abcdefghi1',
      fullName: 'Ann Lee',
    });
  });
});
