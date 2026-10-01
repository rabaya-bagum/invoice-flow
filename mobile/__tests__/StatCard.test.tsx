import { render, screen } from '@testing-library/react-native';
import { StatCard } from '../src/components/StatCard';

describe('StatCard', () => {
  it('formats integer minor units as currency without float error', async () => {
    await render(<StatCard label="Paid" amountMinor={6778} currency="USD" />);
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('$67.78')).toBeTruthy();
  });
});
