import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { InvoiceDocument } from '../src/components/InvoiceDocument';
import { AppearanceScreen } from '../src/screens/AppearanceScreen';
import { ApiError } from '../src/services/api';
import { business, invoiceDetail, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');

const open = async (biz: Record<string, unknown> = {}, extra: Record<string, jest.Mock> = {}) => {
  const current = {
    ...business,
    template: 'classic',
    accentColor: '#2563EB',
    displayOptions: {},
    ...biz,
  };
  const api = setupApi({
    getBusiness: jest.fn(async () => current),
    updateBusiness: jest.fn(async (patch: object) => ({ ...current, ...patch })),
    getBusinessAssetUri: jest.fn(async () => null),
    ...extra,
  });
  await renderWithQuery(<AppearanceScreen />);
  await screen.findByText('Layout');
  return api;
};

const saveButton = () => screen.getByRole('button', { name: 'Save appearance' });

describe('AppearanceScreen', () => {
  it('shows the current layout, colour and switches, with Save disabled until something changes', async () => {
    await open({
      template: 'modern',
      accentColor: '#0F766E',
      displayOptions: { showNotes: false },
    });
    expect(screen.getByRole('radio', { name: 'Modern layout', selected: true })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Accent colour #0F766E', selected: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Notes').props.value).toBe(false);
    expect(screen.getByLabelText('Terms and conditions').props.value).toBe(true);
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
  });

  it('previews switches live: notes, tax column and payment info', async () => {
    await open({ paymentInstructions: 'E-transfer to pay@acme.test' });
    expect(screen.getByText('Thank you for your business.')).toBeTruthy();
    expect(screen.getAllByText(/GST 5%/).length).toBeGreaterThan(0);
    expect(screen.getByText('E-transfer to pay@acme.test')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Notes'), 'valueChange', false);
    await fireEvent(screen.getByLabelText('Tax column'), 'valueChange', false);
    await fireEvent(screen.getByLabelText('Payment information'), 'valueChange', false);
    expect(screen.queryByText('Thank you for your business.')).toBeNull();
    expect(screen.queryByText(/GST 5%/)).toBeNull();
    expect(screen.queryByText('E-transfer to pay@acme.test')).toBeNull();
    expect(screen.getByText('Web Development')).toBeTruthy();
  });

  it('saves the template, colour and the full set of switches', async () => {
    const api = await open();
    await fireEvent.press(screen.getByRole('radio', { name: 'Minimal layout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Accent colour #B91C1C' }));
    await fireEvent(screen.getByLabelText('Signature'), 'valueChange', false);
    await fireEvent.press(saveButton());
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalled());
    expect(api.updateBusiness).toHaveBeenCalledWith({
      template: 'minimal',
      accentColor: '#B91C1C',
      displayOptions: {
        showLogo: true,
        showTaxColumn: true,
        showPaymentInfo: true,
        showNotes: true,
        showTerms: true,
        showSignature: false,
      },
    });
    expect(await screen.findByText(/Saved\. Invoices, estimates, PDFs/)).toBeTruthy();
  });

  it('accepts a typed hex colour, with or without the #', async () => {
    const api = await open();
    await fireEvent.changeText(screen.getByLabelText('Custom colour (hex)'), '7c3aed');
    expect(screen.getByLabelText('Custom colour (hex)').props.value).toBe('#7c3aed');
    await fireEvent.press(saveButton());
    await waitFor(() =>
      expect(api.updateBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ accentColor: '#7C3AED' }),
      ),
    );
  });

  it('refuses colours that are malformed or too pale, and cannot save them', async () => {
    const api = await open();
    const field = screen.getByLabelText('Custom colour (hex)');
    await fireEvent.changeText(field, '#12');
    expect(await screen.findByText('Use a hex colour like #2563EB')).toBeTruthy();
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(field, '#FFFF99');
    expect(await screen.findByText(/too light to read on white/)).toBeTruthy();
    await fireEvent.press(saveButton());
    expect(api.updateBusiness).not.toHaveBeenCalled();
  });

  it('resets to the defaults', async () => {
    const api = await open({
      template: 'minimal',
      accentColor: '#B91C1C',
      displayOptions: { showNotes: false },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByRole('radio', { name: 'Classic layout', selected: true })).toBeTruthy();
    expect(screen.getByLabelText('Notes').props.value).toBe(true);
    await fireEvent.press(saveButton());
    await waitFor(() =>
      expect(api.updateBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'classic', accentColor: '#2563EB' }),
      ),
    );
  });

  it('shows the server explanation when saving fails and keeps the edits', async () => {
    await open(
      {},
      {
        updateBusiness: jest.fn(async () => {
          throw new ApiError('server', 400, 'VALIDATION_ERROR');
        }),
      },
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Modern layout' }));
    await fireEvent.press(saveButton());
    expect(await screen.findByText(/went wrong|try again|invalid/i)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Modern layout', selected: true })).toBeTruthy();
  });

  it('treats an unknown stored template as classic', async () => {
    await open({ template: 'retro' });
    expect(screen.getByRole('radio', { name: 'Classic layout', selected: true })).toBeTruthy();
  });
});

describe('InvoiceDocument appearance', () => {
  const doc = async (biz: Record<string, unknown>) =>
    renderWithQuery(
      <InvoiceDocument
        invoice={invoiceDetail({ notes: 'NOTE-MARKER', terms: 'TERMS-MARKER' }) as never}
        business={{ ...business, paymentInstructions: 'PAY-MARKER', ...biz } as never}
      />,
    );

  beforeEach(() => {
    setupApi({ getBusinessAssetUri: jest.fn(async () => null) });
  });

  it('shows every part by default', async () => {
    await doc({});
    for (const t of ['NOTE-MARKER', 'TERMS-MARKER', 'PAY-MARKER', /GST 5%/])
      expect(screen.getByText(t)).toBeTruthy();
  });

  it('hides parts switched off, whatever the template', async () => {
    for (const template of ['classic', 'modern', 'minimal']) {
      const { unmount } = await doc({
        template,
        displayOptions: {
          showNotes: false,
          showTerms: false,
          showPaymentInfo: false,
          showTaxColumn: false,
        },
      });
      expect(screen.queryByText('NOTE-MARKER')).toBeNull();
      expect(screen.queryByText('TERMS-MARKER')).toBeNull();
      expect(screen.queryByText('PAY-MARKER')).toBeNull();
      expect(screen.queryByText(/GST 5%/)).toBeNull();
      expect(screen.getByText('Web Development')).toBeTruthy();
      await unmount();
    }
  });

  it('still renders with a missing or unknown template and options', async () => {
    await doc({ template: 'retro', displayOptions: undefined });
    expect(screen.getByText('INVOICE')).toBeTruthy();
  });
});
