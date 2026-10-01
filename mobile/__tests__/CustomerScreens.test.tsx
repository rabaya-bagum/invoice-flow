import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { CustomerFormScreen } from '../src/screens/CustomerFormScreen';
import { CustomerListScreen } from '../src/screens/CustomerListScreen';
import { nav, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');

const customer = (over = {}) => ({
  id: 'c1',
  firstName: 'Ann',
  lastName: 'Lee',
  companyName: null,
  email: 'ann@x.co',
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  province: null,
  postalCode: null,
  country: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('CustomerListScreen', () => {
  it('lists customers and opens the detail screen', async () => {
    const api = setupApi({
      listCustomers: jest.fn(async () => ({
        items: [
          customer(),
          customer({
            id: 'c2',
            firstName: null,
            lastName: null,
            companyName: 'Acme Ltd',
            email: null,
          }),
        ],
        total: 2,
      })),
    });
    const navigation = nav();
    await renderWithQuery(
      <CustomerListScreen navigation={navigation as never} route={{} as never} />,
    );
    expect(await screen.findByText('Ann Lee')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ann Lee'));
    expect(navigation.navigate).toHaveBeenCalledWith('CustomerDetail', { id: 'c1' });
    expect(api.listCustomers).toHaveBeenCalledWith({ search: '', limit: 25, offset: 0 });
  });

  it('debounces search and sends it to the server', async () => {
    const api = setupApi({ listCustomers: jest.fn(async () => ({ items: [], total: 0 })) });
    await renderWithQuery(<CustomerListScreen navigation={nav() as never} route={{} as never} />);
    await screen.findByText('No customers yet');
    await fireEvent.changeText(screen.getByLabelText('Search customers'), 'amy');
    await waitFor(() =>
      expect(api.listCustomers).toHaveBeenCalledWith({ search: 'amy', limit: 25, offset: 0 }),
    );
    expect(await screen.findByText('No matches')).toBeTruthy();
  });

  it('shows a friendly error with retry', async () => {
    setupApi({
      listCustomers: jest.fn(async () => {
        throw { kind: 'network', name: 'ApiError', message: 'network' };
      }),
    });
    await renderWithQuery(<CustomerListScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('CustomerFormScreen', () => {
  it('requires a name or company before calling the API', async () => {
    const api = setupApi({ createCustomer: jest.fn() });
    await renderWithQuery(
      <CustomerFormScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.co');
    await fireEvent.press(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText('Enter a name or a company name')).toBeTruthy();
    expect(api.createCustomer).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    setupApi({ createCustomer: jest.fn() });
    await renderWithQuery(
      <CustomerFormScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Ann');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
  });

  it('creates a customer with a normalised payload and goes back', async () => {
    const api = setupApi({ createCustomer: jest.fn(async () => customer()) });
    const navigation = nav();
    await renderWithQuery(
      <CustomerFormScreen
        navigation={navigation as never}
        route={{ params: undefined } as never}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText('First name'), ' Ann ');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'ANN@X.CO');
    await fireEvent.press(screen.getByRole('button', { name: 'Add customer' }));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(api.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Ann', lastName: null, email: 'ann@x.co', phone: null }),
    );
  });

  it('loads an existing customer for editing and saves via update', async () => {
    const api = setupApi({
      getCustomer: jest.fn(async () => customer({ city: 'Austin' })),
      updateCustomer: jest.fn(async () => customer()),
    });
    const navigation = nav();
    await renderWithQuery(
      <CustomerFormScreen
        navigation={navigation as never}
        route={{ params: { id: 'c1' } } as never}
      />,
    );
    expect(await screen.findByDisplayValue('Austin')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('City'), 'Dallas');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.updateCustomer).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ city: 'Dallas', firstName: 'Ann' }),
      ),
    );
  });

  it('shows a friendly message when saving fails', async () => {
    setupApi({
      createCustomer: jest.fn(async () => {
        throw { kind: 'server', name: 'ApiError', status: 500, message: 'server' };
      }),
    });
    await renderWithQuery(
      <CustomerFormScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Ann');
    await fireEvent.press(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText(/servers are having trouble/)).toBeTruthy();
  });
});
