import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '../src/services/api';
import { BusinessProfileScreen } from '../src/screens/BusinessProfileScreen';
import { ProductFormScreen } from '../src/screens/ProductFormScreen';
import { business, nav, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');

async function renderProductForm(api: Record<string, jest.Mock>, navigation = nav()) {
  setupApi({ getBusiness: jest.fn(async () => business), ...api });
  await renderWithQuery(
    <ProductFormScreen navigation={navigation as never} route={{ params: undefined } as never} />,
  );
  await screen.findByLabelText('Name');
  return navigation;
}

describe('ProductFormScreen', () => {
  it('converts price and tax rate to minor units / basis points', async () => {
    const createProduct = jest.fn(async () => ({}));
    const navigation = await renderProductForm({ createProduct });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Web Development');
    await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '125.50');
    await fireEvent.changeText(screen.getByLabelText('Unit'), 'hour');
    await fireEvent.changeText(screen.getByLabelText('Tax rate (%)'), '13.5');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Web Development',
        priceMinor: 12550,
        unit: 'hour',
        taxRateBps: 1350,
        isActive: true,
      }),
    );
  });

  it.each([
    ['abc', 'Enter a valid price'],
    ['-5', 'Enter a valid price'],
    ['1.234', 'Enter a valid price'],
    ['', 'Enter a valid price'],
  ])('rejects price %p', async (price, message) => {
    const createProduct = jest.fn();
    await renderProductForm({ createProduct });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'X');
    await fireEvent.changeText(screen.getByLabelText('Price (USD)'), price);
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(new RegExp(message))).toBeTruthy();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('rejects a tax rate over 100%', async () => {
    const createProduct = jest.fn();
    await renderProductForm({ createProduct });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'X');
    await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '1');
    await fireEvent.changeText(screen.getByLabelText('Tax rate (%)'), '101');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/percentage from 0 to 100/)).toBeTruthy();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('shows a SKU error on a 409 from the server', async () => {
    const createProduct = jest.fn(async () => {
      throw new ApiError('unknown', 409, 'SKU_EXISTS');
    });
    await renderProductForm({ createProduct });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'X');
    await fireEvent.changeText(screen.getByLabelText('Price (USD)'), '1');
    await fireEvent.changeText(screen.getByLabelText('SKU'), 'DUP');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('That SKU is already used')).toBeTruthy();
  });
});

describe('BusinessProfileScreen', () => {
  it('loads the profile and saves changes as a patch', async () => {
    const updateBusiness = jest.fn(async (p) => ({ ...business, ...p }));
    setupApi({ getBusiness: jest.fn(async () => business), updateBusiness });
    await renderWithQuery(
      <BusinessProfileScreen navigation={nav() as never} route={{} as never} />,
    );
    expect(await screen.findByDisplayValue('Acme')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy(); // 500 bps shown as 5%
    await fireEvent.changeText(screen.getByLabelText('Business name'), 'Acme Studio');
    await fireEvent.changeText(screen.getByLabelText('Default currency (ISO code)'), 'cad');
    await fireEvent.changeText(screen.getByLabelText('Default tax rate (%)'), '13');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Business profile saved.')).toBeTruthy();
    expect(updateBusiness).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Acme Studio',
        defaultCurrency: 'CAD',
        defaultTaxRateBps: 1300,
        defaultPaymentTermsDays: 14,
      }),
    );
  });

  it('validates currency, email and website locally', async () => {
    const updateBusiness = jest.fn();
    setupApi({ getBusiness: jest.fn(async () => business), updateBusiness });
    await renderWithQuery(
      <BusinessProfileScreen navigation={nav() as never} route={{} as never} />,
    );
    await screen.findByDisplayValue('Acme');
    await fireEvent.changeText(screen.getByLabelText('Default currency (ISO code)'), 'ZZZ');
    await fireEvent.changeText(screen.getByLabelText('Business email'), 'nope');
    await fireEvent.changeText(screen.getByLabelText('Website'), 'not a url');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unsupported currency')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText(/valid URL/)).toBeTruthy();
    expect(updateBusiness).not.toHaveBeenCalled();
  });
});
