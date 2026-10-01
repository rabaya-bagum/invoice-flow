import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
} from '../src/validation/auth';

describe('auth validation', () => {
  it('normalises email and accepts valid login', () => {
    const r = fieldErrors(loginSchema, { email: '  Ann@Example.COM ', password: 'x' });
    expect(r.data?.email).toBe('ann@example.com');
  });

  it('rejects bad emails', () => {
    expect(fieldErrors(forgotPasswordSchema, { email: 'nope' }).errors.email).toMatch(/valid/);
    expect(fieldErrors(forgotPasswordSchema, { email: '' }).errors.email).toBeTruthy();
  });

  const base = {
    fullName: 'Ann',
    email: 'a@b.co',
    password: 'abcdefghi1',
    confirmPassword: 'abcdefghi1',
  };

  it('accepts a good sign-up', () => {
    expect(fieldErrors(signUpSchema, base).data).toBeDefined();
  });

  it.each([
    ['short', { password: 'abc123', confirmPassword: 'abc123' }, 'password'],
    ['no number', { password: 'abcdefghijk', confirmPassword: 'abcdefghijk' }, 'password'],
    ['no letter', { password: '12345678901', confirmPassword: '12345678901' }, 'password'],
    ['too long', { password: 'a1'.repeat(40), confirmPassword: 'a1'.repeat(40) }, 'password'],
    ['mismatch', { confirmPassword: 'different1' }, 'confirmPassword'],
    ['no name', { fullName: ' ' }, 'fullName'],
  ])('rejects %s', (_n, patch, field) => {
    expect(fieldErrors(signUpSchema, { ...base, ...patch }).errors[field]).toBeTruthy();
  });

  it('validates password reset', () => {
    expect(
      fieldErrors(resetPasswordSchema, { password: 'abcdefghi1', confirmPassword: 'abcdefghi1' })
        .data,
    ).toBeDefined();
    expect(
      fieldErrors(resetPasswordSchema, { password: 'abcdefghi1', confirmPassword: 'x' }).errors
        .confirmPassword,
    ).toBeTruthy();
  });
});
