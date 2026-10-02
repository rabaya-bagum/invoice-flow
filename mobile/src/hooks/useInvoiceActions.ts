import { Linking } from 'react-native';
import { useAuth } from '../store/auth';
import { previewPdfFile, shareText, sharePdfFile } from '../utils/pdf-actions';
import { savePdfToCache } from '../utils/pdf-files';
import { useSubmit } from './useSubmit';

/** PDF preview / share and public-link actions for one invoice. Errors surface as friendly text. */
export function useInvoiceActions(invoice: { id: string; number: string }, businessName: string) {
  const { api } = useAuth();
  const state = useSubmit();

  const fetchPdf = async () =>
    savePdfToCache(invoice.number, await api.downloadInvoicePdf(invoice.id));

  return {
    loading: state.loading,
    error: state.error,

    /** Native PDF preview (print dialog with preview on both platforms). */
    previewPdf: () =>
      state.run(async () => {
        await previewPdfFile(await fetchPdf());
      }),

    /** Native share sheet with the PDF attached (Save to Files, Messages, Mail, other apps). */
    sharePdf: () =>
      state.run(async () => {
        await sharePdfFile(await fetchPdf(), invoice.number, `Invoice ${invoice.number}`);
      }),

    /** Share the customer-facing link through any messaging app. */
    shareLink: () =>
      state.run(async () => {
        const { url } = await api.createShareLink(invoice.id);
        await shareText(`Invoice ${invoice.number} from ${businessName}: ${url}`);
      }),

    /** Opens the customer payment page in the browser. */
    openPaymentPage: () =>
      state.run(async () => {
        const { url } = await api.createShareLink(invoice.id);
        await Linking.openURL(url);
      }),
  };
}
