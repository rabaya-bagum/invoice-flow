import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Linking, Share } from 'react-native';
import { useAuth } from '../store/auth';
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
        await Print.printAsync({ uri: await fetchPdf() });
      }),

    /** Native share sheet with the PDF attached (Save to Files, Messages, Mail, other apps). */
    sharePdf: () =>
      state.run(async () => {
        const uri = await fetchPdf();
        if (!(await Sharing.isAvailableAsync()))
          throw Object.assign(new Error('unavailable'), { code: 'PDF_FAILED' });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `Invoice ${invoice.number}`,
        });
      }),

    /** Share the customer-facing link through any messaging app. */
    shareLink: () =>
      state.run(async () => {
        const { url } = await api.createShareLink(invoice.id);
        await Share.share({ message: `Invoice ${invoice.number} from ${businessName}: ${url}` });
      }),

    /** Opens the customer payment page in the browser. */
    openPaymentPage: () =>
      state.run(async () => {
        const { url } = await api.createShareLink(invoice.id);
        await Linking.openURL(url);
      }),
  };
}
